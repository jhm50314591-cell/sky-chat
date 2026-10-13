const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT || 10000);
const maxUsers = Math.min(10, Math.max(2, Number(process.env.MAX_USERS) || 10));
const sessionDays = 30;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || '';
const pushConfigured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
let webpush = null;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000
});
const authAttempts = new Map();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin.host !== host) return res.status(403).json({ error: '요청 출처를 확인할 수 없습니다.' });
    } catch { return res.status(403).json({ error: '요청 출처를 확인할 수 없습니다.' }); }
  }
  next();
});

function cookieValue(req, name) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = row => ({ id: Number(row.id), username: row.username, name: row.display_name, handle: row.handle, bio: row.bio, photo: row.avatar_data, background: row.background_data });
const bad = (res, status, error) => res.status(status).json({ error });

function requireAuth(req, res, next) {
  const token = cookieValue(req, 'sauhoe_session');
  if (!token) return bad(res, 401, '로그인이 필요합니다.');
  const avatarColumn = req.query.light==='1' ? "''" : 'p.avatar_data';
  pool.query(`SELECT p.id,p.username,p.display_name,p.handle,p.bio,${avatarColumn} AS avatar_data,p.background_data
    FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`, [digest(token)])
    .then(({ rows }) => {
      if (!rows[0]) return bad(res, 401, '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
      req.user = rows[0];
      next();
    }).catch(next);
}
function limitAuthAttempts(req, res, next) {
  const now = Date.now(), key = req.ip || req.socket.remoteAddress || 'unknown';
  const attempt = authAttempts.get(key) || { start: now, count: 0 };
  if (now - attempt.start > 15 * 60 * 1000) { attempt.start = now; attempt.count = 0; }
  attempt.count++;
  authAttempts.set(key, attempt);
  if (attempt.count > 12) return bad(res, 429, '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.');
  if (authAttempts.size > 2000) for (const [ip, item] of authAttempts) if (now - item.start > 15 * 60 * 1000) authAttempts.delete(ip);
  next();
}

function newSession(res, userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expires = new Date(Date.now() + sessionDays * 86400000);
  return pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [digest(token), userId, expires])
    .then(() => res.cookie('sauhoe_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires }));
}

function checkedImage(data) {
  if (!data) return '';
  if (typeof data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(data) || data.length > 4_000_000) {
    throw Object.assign(new Error('이미지는 JPG, PNG, WebP 형식으로 3MB 이하만 올릴 수 있습니다.'), { status: 400 });
  }
  return data;
}
function limitedText(value, max, label, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw Object.assign(new Error(`${label}을(를) 입력해 주세요.`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${label}은(는) ${max}자 이하로 입력해 주세요.`), { status: 400 });
  return text;
}
async function notify(recipient, actor, kind, body, refs = {}) {
  if (Number(recipient) === Number(actor)) return;
  const saved = await pool.query(`INSERT INTO notifications(recipient_id,actor_id,kind,body,post_id,story_id,chat_id,message_id,comment_id,story_comment_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [recipient, actor, kind, body, refs.post_id || null, refs.story_id || null, refs.chat_id || null, refs.message_id || null, refs.comment_id || null, refs.story_comment_id || null]);
  if (pushConfigured) {
    void sendWebPush(recipient, {
      title: '중도일보 사우회',
      body,
      notificationId: Number(saved.rows[0].id),
      url: `/?notification=${Number(saved.rows[0].id)}`
    });
  }
}
async function sendWebPush(userId, payload) {
  try {
    const subscriptions = await pool.query('SELECT id,endpoint,subscription FROM push_subscriptions WHERE user_id=$1', [userId]);
    await Promise.allSettled(subscriptions.rows.map(async row => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      } catch (error) {
        if ([404, 410].includes(Number(error.statusCode))) {
          await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [row.id]);
        } else {
          console.error('푸시 알림 전송 실패:', error.statusCode || error.message);
        }
      }
    }));
  } catch (error) { console.error('푸시 알림 처리 실패:', error.message); }
}

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});
app.get('/api/session', requireAuth, (req, res) => res.json({ user: publicUser(req.user), groupName: process.env.GROUP_NAME || '중도일보 사우회' }));

app.post('/api/auth/register', limitAuthAttempts, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const username = limitedText(req.body.username, 24, '아이디', true).toLowerCase();
    const name = limitedText(req.body.name, 30, '이름', true);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return bad(res, 400, '아이디는 영문 소문자, 숫자, 밑줄로 3~24자 입력해 주세요.');
    if (password.length < 8 || password.length > 72) return bad(res, 400, '비밀번호는 8~72자로 입력해 주세요.');
    if (bcrypt.truncates(password)) return bad(res, 400, '한글 등 여러 바이트 문자는 비밀번호 길이를 짧게 설정해 주세요.');
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(740021)');
    const count = await client.query('SELECT COUNT(*)::int AS n FROM profiles');
    if (count.rows[0].n >= maxUsers) { await client.query('ROLLBACK'); return bad(res, 403, `가입 인원이 ${maxUsers}명으로 마감되었습니다.`); }
    const handle = username;
    const hash = await bcrypt.hash(password, 12);
    const inserted = await client.query(`INSERT INTO profiles(username,password_hash,display_name,handle)
      VALUES($1,$2,$3,$4) RETURNING *`, [username, hash, name, handle]);
    await client.query('COMMIT');
    await newSession(res, inserted.rows[0].id);
    res.status(201).json({ user: publicUser(inserted.rows[0]), groupName: process.env.GROUP_NAME || '중도일보 사우회' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return bad(res, 409, '이미 사용 중인 아이디입니다.');
    next(error);
  } finally { client.release(); }
});

app.post('/api/auth/login', limitAuthAttempts, async (req, res, next) => {
  try {
    const username = limitedText(req.body.username, 24, '아이디', true).toLowerCase();
    const password = String(req.body.password || '');
    if (bcrypt.truncates(password)) return bad(res, 400, '비밀번호가 너무 깁니다.');
    const row = (await pool.query('SELECT * FROM profiles WHERE username=$1', [username])).rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return bad(res, 401, '아이디 또는 비밀번호를 확인해 주세요.');
    await newSession(res, row.id);
    res.json({ user: publicUser(row), groupName: process.env.GROUP_NAME || '중도일보 사우회' });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = cookieValue(req, 'sauhoe_session');
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
    res.clearCookie('sauhoe_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/bootstrap', requireAuth, async (req, res, next) => {
  try {
    const [profiles, posts, stories, chats, notifications] = await Promise.all([
      pool.query(req.query.light==='1'
        ? `SELECT id,username,display_name,handle,bio,'' AS avatar_data,background_data,created_at FROM profiles ORDER BY created_at,id`
        : 'SELECT * FROM profiles ORDER BY created_at,id'),
      pool.query(`SELECT p.id,p.user_id,p.caption,${req.query.light==='1'?"''":"p.image_data"} AS image_data,${req.query.light==='1'?"'[]'::jsonb":"p.images_data"} AS images_data,p.emoji,p.created_at,pr.display_name,pr.handle,${req.query.light==='1'?"''":"pr.avatar_data"} AS avatar_data FROM posts p JOIN profiles pr ON pr.id=p.user_id ORDER BY p.created_at DESC LIMIT 80`),
      pool.query(`SELECT s.id,s.user_id,s.caption,${req.query.light==='1'?"''":"s.image_data"} AS image_data,s.emoji,s.created_at,s.expires_at,pr.display_name,pr.handle,${req.query.light==='1'?"''":"pr.avatar_data"} AS avatar_data FROM stories s JOIN profiles pr ON pr.id=s.user_id WHERE s.expires_at>NOW() ORDER BY s.created_at DESC`),
      pool.query(`SELECT c.id,c.title,c.is_group,c.created_at,ARRAY_AGG(cm.user_id ORDER BY cm.user_id) AS member_ids
        FROM chats c JOIN chat_members own ON own.chat_id=c.id AND own.user_id=$1
        JOIN chat_members cm ON cm.chat_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`, [req.user.id]),
      pool.query(`SELECT n.*,p.display_name AS actor_name,p.handle AS actor_handle,${req.query.light==='1'?"''":"p.avatar_data"} AS actor_avatar
        FROM notifications n JOIN profiles p ON p.id=n.actor_id WHERE n.recipient_id=$1 ORDER BY n.created_at DESC LIMIT 60`, [req.user.id])
    ]);
    const postIds = posts.rows.map(p => p.id), storyIds = stories.rows.map(s => s.id), chatIds = chats.rows.map(c => c.id);
    const [comments, likes, messages, storyComments, viewedStories] = await Promise.all([
      postIds.length ? pool.query(`SELECT c.*,p.display_name,p.handle FROM comments c JOIN profiles p ON p.id=c.user_id WHERE c.post_id=ANY($1::bigint[]) ORDER BY c.created_at`, [postIds]) : { rows: [] },
      postIds.length ? pool.query('SELECT post_id,user_id FROM post_likes WHERE post_id=ANY($1::bigint[])', [postIds]) : { rows: [] },
      chatIds.length ? pool.query(`SELECT m.*,p.display_name,p.handle,p.avatar_data FROM messages m JOIN profiles p ON p.id=m.user_id WHERE m.chat_id=ANY($1::bigint[]) ORDER BY m.created_at DESC LIMIT 600`, [chatIds]) : { rows: [] },
      storyIds.length ? pool.query(`SELECT sc.*,p.display_name,p.handle FROM story_comments sc JOIN profiles p ON p.id=sc.user_id WHERE sc.story_id=ANY($1::bigint[]) ORDER BY sc.created_at`, [storyIds]) : { rows: [] },
      storyIds.length ? pool.query('SELECT story_id FROM story_views WHERE user_id=$1 AND story_id=ANY($2::bigint[])', [req.user.id, storyIds]) : { rows: [] }
    ]);
    const commentMap = new Map(), likeMap = new Map(), messageMap = new Map(), storyCommentMap = new Map();
    for (const row of comments.rows) { const k = String(row.post_id); if (!commentMap.has(k)) commentMap.set(k, []); commentMap.get(k).push({ id: Number(row.id), user: Number(row.user_id), name: row.display_name, handle: row.handle, text: row.body, created: row.created_at }); }
    for (const row of storyComments.rows) { const k = String(row.story_id); if (!storyCommentMap.has(k)) storyCommentMap.set(k, []); storyCommentMap.get(k).push({ id: Number(row.id), user: Number(row.user_id), name: row.display_name, handle: row.handle, text: row.body, created: row.created_at }); }
    for (const row of likes.rows) { const k = String(row.post_id); if (!likeMap.has(k)) likeMap.set(k, []); likeMap.get(k).push(Number(row.user_id)); }
    for (const row of messages.rows.reverse()) { const k = String(row.chat_id); if (!messageMap.has(k)) messageMap.set(k, []); messageMap.get(k).push({ id: Number(row.id), user: Number(row.user_id), name: row.display_name, text: row.body, created: row.created_at }); }
    res.json({
      me: { ...publicUser(req.user), photo: req.query.light==='1' ? '' : req.user.avatar_data },
      users: profiles.rows.map(row => ({ ...publicUser(row), photo: req.query.light==='1' ? '' : row.avatar_data })),
      posts: posts.rows.map(p => { const images=Array.isArray(p.images_data)?[...p.images_data]:[]; if(!images.length&&p.image_data)images.push(p.image_data); return { id: Number(p.id), user: Number(p.user_id), name: p.display_name, handle: p.handle, photo: p.avatar_data, image: images[0]||'', images, emoji: p.emoji, caption: p.caption, created: p.created_at, likes: likeMap.get(String(p.id)) || [], comments: commentMap.get(String(p.id)) || [] }; }),
      stories: stories.rows.map(s => ({ id: Number(s.id), user: Number(s.user_id), name: s.display_name, photo: s.avatar_data, image: s.image_data, emoji: s.emoji, caption: s.caption, created: s.created_at, expires: s.expires_at, seen: viewedStories.rows.some(view => String(view.story_id)===String(s.id)), comments: storyCommentMap.get(String(s.id)) || [] })),
      chats: chats.rows.map(c => ({ id: Number(c.id), title: c.title, group: c.is_group, members: c.member_ids.map(Number), messages: messageMap.get(String(c.id)) || [] })),
      notifications: notifications.rows.map(n => ({ id: Number(n.id), user: Number(n.actor_id), name: n.actor_name, photo: n.actor_avatar, text: n.body, kind: n.kind, created: n.created_at, read: !!n.read_at, postId: n.post_id ? Number(n.post_id) : null, storyId: n.story_id ? Number(n.story_id) : null, chatId: n.chat_id ? Number(n.chat_id) : null, messageId: n.message_id ? Number(n.message_id) : null, commentId: n.comment_id ? Number(n.comment_id) : null, storyCommentId: n.story_comment_id ? Number(n.story_comment_id) : null }))
    });
  } catch (error) { next(error); }
});

app.patch('/api/profile', requireAuth, async (req, res, next) => {
  try {
    const name = limitedText(req.body.name, 30, '이름', true);
    const handle = limitedText(req.body.handle, 24, '사용자 이름', true).toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(handle)) return bad(res, 400, '사용자 이름은 영문 소문자, 숫자, 밑줄로 3~24자 입력해 주세요.');
    const bio = limitedText(req.body.bio, 120, '소개');
    const photo = checkedImage(req.body.photo || '');
    const background = ['aurora','sunset'].includes(req.body.background) ? req.body.background : checkedImage(req.body.background || '');
    const row = await pool.query(`UPDATE profiles SET display_name=$1,handle=$2,bio=$3,
      avatar_data=CASE WHEN $4='' THEN avatar_data ELSE $4 END,background_data=$5 WHERE id=$6 RETURNING *`, [name, handle, bio, photo, background, req.user.id]);
    res.json({ user: publicUser(row.rows[0]) });
  } catch (error) { if (error.code === '23505') return bad(res, 409, '이미 사용 중인 사용자 이름입니다.'); next(error); }
});

app.post('/api/posts', requireAuth, async (req, res, next) => {
  try {
    const caption = limitedText(req.body.caption, 500, '게시물 내용');
    const rawImages = Array.isArray(req.body.images) ? req.body.images : [req.body.image || ''];
    if (rawImages.length > 10) return bad(res, 400, '게시물 사진은 한 번에 10장까지 올릴 수 있습니다.');
    const images = rawImages.map(checkedImage).filter(Boolean);
    const image = images[0] || '';
    const emoji = limitedText(req.body.emoji, 8, '이모지');
    if (!caption && !images.length) return bad(res, 400, '사진이나 내용을 추가해 주세요.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const post = await client.query('INSERT INTO posts(user_id,caption,image_data,images_data,emoji) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id', [req.user.id, caption, image, JSON.stringify(images), emoji]);
      const storyCaption = caption.slice(0, 500);
      const story = await client.query(`INSERT INTO stories(user_id,caption,image_data,emoji,expires_at) VALUES($1,$2,$3,'',NOW()+INTERVAL '24 hours') RETURNING id`, [req.user.id, storyCaption, image]);
      await client.query('COMMIT');
      res.status(201).json({ id: Number(post.rows[0].id), storyId: Number(story.rows[0].id) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  } catch (error) { next(error); }
});
app.delete('/api/posts/:id', requireAuth, async (req, res, next) => {
  try { const r = await pool.query('DELETE FROM posts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); if (!r.rowCount) return bad(res, 404, '게시물을 찾지 못했습니다.'); res.json({ ok: true }); }
  catch (error) { next(error); }
});
app.post('/api/posts/:id/like', requireAuth, async (req, res, next) => {
  try {
    const post = (await pool.query('SELECT id,user_id FROM posts WHERE id=$1', [req.params.id])).rows[0];
    if (!post) return bad(res, 404, '게시물을 찾지 못했습니다.');
    const inserted = await pool.query('INSERT INTO post_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id', [post.id, req.user.id]);
    if (inserted.rowCount) await notify(post.user_id, req.user.id, 'like', '회원님의 게시물을 좋아합니다.', { post_id: post.id });
    else await pool.query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2', [post.id, req.user.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post('/api/posts/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const body = limitedText(req.body.text, 300, '댓글', true);
    const post = (await pool.query('SELECT id,user_id FROM posts WHERE id=$1', [req.params.id])).rows[0];
    if (!post) return bad(res, 404, '게시물을 찾지 못했습니다.');
    const comment = await pool.query('INSERT INTO comments(post_id,user_id,body) VALUES($1,$2,$3) RETURNING id', [post.id, req.user.id, body]);
    await notify(post.user_id, req.user.id, 'comment', '게시물에 댓글을 남겼습니다.', { post_id: post.id, comment_id: comment.rows[0].id });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/stories', requireAuth, async (req, res, next) => {
  try {
    const caption = limitedText(req.body.caption, 500, '스토리 내용');
    const image = checkedImage(req.body.image || '');
    const emoji = limitedText(req.body.emoji, 8, '이모지') || '🌷';
    if (!caption && !image) return bad(res, 400, '사진이나 내용을 추가해 주세요.');
    const result = await pool.query(`INSERT INTO stories(user_id,caption,image_data,emoji,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '24 hours') RETURNING id`, [req.user.id, caption, image, emoji]);
    res.status(201).json({ id: Number(result.rows[0].id) });
  } catch (error) { next(error); }
});

app.post('/api/stories/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const body = limitedText(req.body.text, 300, '스토리 댓글', true);
    const story = (await pool.query('SELECT id,user_id FROM stories WHERE id=$1 AND expires_at>NOW()', [req.params.id])).rows[0];
    if (!story) return bad(res, 404, '스토리가 만료되었거나 삭제되었습니다.');
    const result = await pool.query('INSERT INTO story_comments(story_id,user_id,body) VALUES($1,$2,$3) RETURNING id', [story.id, req.user.id, body]);
    await notify(story.user_id, req.user.id, 'story_comment', '스토리에 댓글을 남겼습니다.', { story_id: story.id, story_comment_id: result.rows[0].id });
    res.status(201).json({ id: Number(result.rows[0].id) });
  } catch (error) { next(error); }
});

app.post('/api/stories/:id/view', requireAuth, async (req, res, next) => {
  try {
    const story = (await pool.query('SELECT user_id FROM stories WHERE id=$1 AND expires_at>NOW()', [req.params.id])).rows[0];
    if (!story) return bad(res, 404, '스토리가 만료되었거나 삭제되었습니다.');
    await pool.query(`INSERT INTO story_views(story_id,user_id)
      SELECT id,$2 FROM stories WHERE user_id=$1 AND expires_at>NOW()
      ON CONFLICT(story_id,user_id) DO NOTHING`, [story.user_id, req.user.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

async function createChatForUsers(memberIds, title, creator) {
  const ids = [...new Set(memberIds.map(Number).concat(Number(creator)))];
  const found = await pool.query('SELECT id FROM profiles WHERE id=ANY($1::bigint[])', [ids]);
  if (found.rowCount !== ids.length) throw Object.assign(new Error('친구 목록을 확인해 주세요.'), { status: 400 });
  const isGroup = ids.length > 2;
  if (!isGroup && !title) {
    const recipient = ids.find(id => id !== Number(creator));
    title = (await pool.query('SELECT display_name FROM profiles WHERE id=$1', [recipient])).rows[0].display_name;
  }
  if (!isGroup) {
    const existing = await pool.query(`SELECT c.id FROM chats c JOIN chat_members cm ON cm.chat_id=c.id
      WHERE c.is_group=false AND cm.user_id=ANY($1::bigint[]) GROUP BY c.id HAVING COUNT(DISTINCT cm.user_id)=2`, [ids]);
    if (existing.rows[0]) return Number(existing.rows[0].id);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chat = await client.query('INSERT INTO chats(title,is_group,created_by) VALUES($1,$2,$3) RETURNING id', [title, isGroup, creator]);
    for (const id of ids) await client.query('INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2)', [chat.rows[0].id, id]);
    await client.query('COMMIT'); return Number(chat.rows[0].id);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

app.post('/api/chats', requireAuth, async (req, res, next) => {
  try {
    const members = Array.isArray(req.body.members) ? req.body.members.slice(0, maxUsers - 1) : [];
    const ids = [...new Set([...members.map(Number), Number(req.user.id)])];
    if (ids.length < 2) return bad(res, 400, '대화에 함께할 친구를 한 명 이상 선택해 주세요.');
    const group = ids.length > 2;
    let title = limitedText(req.body.title, 50, '대화 이름');
    if (!title && !group) title = (await pool.query('SELECT display_name FROM profiles WHERE id=$1', [ids.find(id => id !== Number(req.user.id))])).rows[0].display_name;
    if (!title) title = '우리 사우회';
    const id = await createChatForUsers(ids, title, req.user.id);
    res.status(201).json({ id });
  } catch (error) { next(error); }
});
app.post('/api/chats/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const body = limitedText(req.body.text, 2000, '메시지', true);
    const members = await pool.query('SELECT user_id FROM chat_members WHERE chat_id=$1', [req.params.id]);
    if (!members.rows.some(m => Number(m.user_id) === Number(req.user.id))) return bad(res, 404, '대화방을 찾지 못했습니다.');
    const message = await pool.query('INSERT INTO messages(chat_id,user_id,body) VALUES($1,$2,$3) RETURNING id', [req.params.id, req.user.id, body]);
    const chat = (await pool.query('SELECT title FROM chats WHERE id=$1', [req.params.id])).rows[0];
    for (const member of members.rows) await notify(member.user_id, req.user.id, 'message', `${chat.title} 대화방에 새 메시지가 있습니다.`, { chat_id: req.params.id, message_id: message.rows[0].id });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});
app.post('/api/chats/:id/members', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const chatId = Number(req.params.id);
    const requested = Array.isArray(req.body.members) ? req.body.members.map(Number).filter(Number.isInteger) : [];
    const chat = (await client.query('SELECT id,title,is_group FROM chats WHERE id=$1', [chatId])).rows[0];
    if (!chat) return bad(res, 404, '대화방을 찾지 못했습니다.');
    const members = await client.query('SELECT user_id FROM chat_members WHERE chat_id=$1', [chatId]);
    if (!members.rows.some(member => Number(member.user_id)===Number(req.user.id))) return bad(res, 404, '대화방을 찾지 못했습니다.');
    const currentIds = members.rows.map(member=>Number(member.user_id));
    const additions = [...new Set(requested)].filter(id=>!currentIds.includes(id));
    if (!additions.length) return bad(res, 400, '초대할 사우를 선택해 주세요.');
    if (currentIds.length + additions.length > maxUsers) return bad(res, 400, `대화방에는 최대 ${maxUsers}명까지 참여할 수 있습니다.`);
    const found = await client.query('SELECT id FROM profiles WHERE id=ANY($1::bigint[])', [additions]);
    if (found.rowCount !== additions.length) return bad(res, 400, '사우 목록을 확인해 주세요.');
    await client.query('BEGIN');
    for (const userId of additions) await client.query('INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [chatId,userId]);
    const nextTitle = chat.is_group ? chat.title : '단체 대화';
    await client.query('UPDATE chats SET is_group=TRUE,title=$1 WHERE id=$2', [nextTitle,chatId]);
    await client.query('COMMIT');
    for (const userId of additions) await notify(userId, req.user.id, 'invite', `${nextTitle} 대화방에 초대했습니다.`, { chat_id: chatId });
    res.status(201).json({ ok: true, added: additions.length });
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally { client.release(); }
});
app.delete('/api/chats/:id/members/me', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const removed = await client.query('DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2 RETURNING chat_id', [req.params.id,req.user.id]);
    if (!removed.rowCount) { await client.query('ROLLBACK'); return bad(res, 404, '대화방을 찾지 못했습니다.'); }
    const remaining = await client.query('SELECT COUNT(*)::int AS count FROM chat_members WHERE chat_id=$1', [req.params.id]);
    if (remaining.rows[0].count===0) await client.query('DELETE FROM chats WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally { client.release(); }
});
app.post('/api/stories/:id/reply', requireAuth, async (req, res, next) => {
  try {
    const body = limitedText(req.body.text, 300, '답장', true);
    const story = (await pool.query('SELECT id,user_id FROM stories WHERE id=$1 AND expires_at>NOW()', [req.params.id])).rows[0];
    if (!story) return bad(res, 404, '스토리가 만료되었거나 삭제되었습니다.');
    if (Number(story.user_id) === Number(req.user.id)) return bad(res, 400, '내 스토리에는 답장할 수 없습니다.');
    const chatId = await createChatForUsers([req.user.id, story.user_id], '', req.user.id);
    const message = await pool.query('INSERT INTO messages(chat_id,user_id,body) VALUES($1,$2,$3) RETURNING id', [chatId, req.user.id, `스토리에 답장: ${body}`]);
    await notify(story.user_id, req.user.id, 'story_reply', '스토리에 답장을 보냈습니다.', { story_id: story.id, chat_id: chatId, message_id: message.rows[0].id });
    res.status(201).json({ chatId });
  } catch (error) { next(error); }
});
app.patch('/api/notifications/read', requireAuth, async (req, res, next) => {
  try { await pool.query('UPDATE notifications SET read_at=NOW() WHERE recipient_id=$1 AND read_at IS NULL', [req.user.id]); res.json({ ok: true }); }
  catch (error) { next(error); }
});
app.patch('/api/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND recipient_id=$2', [req.params.id, req.user.id]);
    if (!result.rowCount) return bad(res, 404, '알림을 찾지 못했습니다.');
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get('/api/push/config', requireAuth, (req, res) => {
  res.json({ enabled: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : '' });
});
app.post('/api/push/subscriptions', requireAuth, async (req, res, next) => {
  try {
    if (!pushConfigured) return bad(res, 503, 'Render 푸시 알림 환경변수를 먼저 설정해 주세요.');
    const subscription = req.body;
    const endpoint = limitedText(subscription?.endpoint, 2048, '푸시 주소', true);
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== 'https:' || typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string') {
      return bad(res, 400, '푸시 구독 정보를 확인할 수 없습니다.');
    }
    await pool.query(`INSERT INTO push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription=EXCLUDED.subscription`, [req.user.id, endpoint, JSON.stringify(subscription)]);
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});
app.delete('/api/push/subscriptions', requireAuth, async (req, res, next) => {
  try {
    const endpoint = limitedText(req.body.endpoint, 2048, '푸시 주소', true);
    await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2', [req.user.id, endpoint]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) { if (['index.html','app.js','style.css','service-worker.js'].includes(path.basename(filePath))) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
});

async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 환경변수가 필요합니다.');
  if (pushConfigured) {
    webpush = await import('web-push');
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at<NOW(); DELETE FROM stories WHERE expires_at<NOW()').catch(console.error), 60 * 60 * 1000).unref();
  app.listen(port, '0.0.0.0', () => console.log(`중도일보 사우회 서버가 ${port} 포트에서 시작되었습니다.`));
}
start().catch(error => { console.error('서버 시작 실패:', error); process.exit(1); });
