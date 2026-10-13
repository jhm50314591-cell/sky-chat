const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

// ===== 설정 =====
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.CHAT_PASSWORD || '1234'; // 꼭 바꾸세요!
const MAX_HISTORY = 60;
const MAX_STORIES = 40;
const STORY_TTL = 24 * 60 * 60 * 1000;
const LEAVE_GRACE = 6000; // 새로고침/재연결로 잠깐 끊긴 건 "나갔어요"로 안 치는 유예시간

// ===== 푸시 알림 (web-push가 없으면 알림만 빼고 정상 동작) =====
let webpush = null;
let VAPID_PUBLIC = null;
try {
  webpush = require('web-push');
  const keys =
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : webpush.generateVAPIDKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:skychat@example.com', keys.publicKey, keys.privateKey);
  VAPID_PUBLIC = keys.publicKey;
} catch (e) {
  console.log('web-push를 쓸 수 없어요. 푸시 알림 없이 실행합니다.', e.message);
  webpush = null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 });

app.get('/health', (req, res) => res.send('ok')); // 잠자기 방지 핑용
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ===== 메모리 저장소 (서버가 재시작되면 사라져요) =====
const profiles = new Map();    // cid -> { cid, name, status, avatar }
const conns = new Map();       // socket.id -> cid
const leaveTimers = new Map(); // cid -> timeout
const visibleSockets = new Set();
const pushSubs = new Map();    // cid -> Map(endpoint -> subscription)
let history = [];
let stories = [];
let seq = 0;

// ===== 유틸 =====
const isImage = (v) =>
  typeof v === 'string' && v.length < 6e6 && /^data:image\/(jpeg|png|webp|gif);base64,/.test(v);
const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 12) : '') || '익명';
const cleanStatus = (v) => (typeof v === 'string' ? v.trim().slice(0, 40) : '');
const cleanAvatar = (v) => (isImage(v) && v.length < 200000 ? v : '');

const onlineCids = () => [...new Set(conns.values())];
const presentCids = () => new Set([...conns.values(), ...leaveTimers.keys()]);
const socketsOf = (cid) => [...conns].filter(([, c]) => c === cid).map(([id]) => id);
const isVisible = (cid) => socketsOf(cid).some((id) => visibleSockets.has(id));
const publicProfile = (p) => ({ cid: p.cid, name: p.name, status: p.status, avatar: p.avatar });
const allProfiles = () => Object.fromEntries([...profiles].map(([k, p]) => [k, publicProfile(p)]));

function liveStories() {
  const t = Date.now();
  stories = stories.filter((s) => t - s.ts < STORY_TTL);
  return stories;
}
// 본 사람 목록은 스토리 주인에게만 보내요
const publicStory = (s, viewerCid) => ({
  id: s.id, cid: s.cid, name: s.name, image: s.image, caption: s.caption, ts: s.ts,
  comments: s.comments,
  viewers: s.cid === viewerCid ? s.viewers : undefined,
});

function uniqueName(base, cid) {
  const taken = new Set(
    [...presentCids()].filter((c) => c !== cid).map((c) => profiles.get(c) && profiles.get(c).name)
  );
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  return name;
}

// ===== 푸시 보내기 =====
function sendPush(cids, payload) {
  if (!webpush) return;
  const data = JSON.stringify(payload);
  for (const cid of cids) {
    if (isVisible(cid)) continue; // 화면을 보고 있는 사람에겐 안 보냄
    const subs = pushSubs.get(cid);
    if (!subs) continue;
    for (const [endpoint, sub] of subs) {
      webpush.sendNotification(sub, data, { TTL: 3600 }).catch((err) => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) subs.delete(endpoint);
      });
    }
  }
}
const pushOthers = (exceptCid, payload) =>
  sendPush([...pushSubs.keys()].filter((c) => c !== exceptCid), payload);

// ===== 소켓 =====
io.on('connection', (socket) => {
  // 입장
  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    const d = data || {};
    if (d.password !== PASSWORD) {
      return setTimeout(() => ack({ ok: false, error: '비밀번호가 맞지 않아요' }), 800);
    }
    if (conns.has(socket.id)) return ack({ ok: false, error: '이미 입장한 상태예요' });

    // 같은 사람(같은 기기·브라우저)은 탭이 여러 개여도 cid가 같아서 한 명으로 계산돼요
    const cid = /^[\w-]{6,64}$/.test(String(d.cid || '')) ? String(d.cid) : socket.id;
    const wasPresent = presentCids().has(cid);

    const profile = profiles.get(cid) || { cid };
    profile.name = uniqueName(cleanName(d.name), cid);
    profile.status = cleanStatus(d.status);
    profile.avatar = cleanAvatar(d.avatar);
    profiles.set(cid, profile);

    conns.set(socket.id, cid);
    socket.join('chat');
    if (leaveTimers.has(cid)) {
      clearTimeout(leaveTimers.get(cid));
      leaveTimers.delete(cid);
    }

    ack({
      ok: true,
      me: publicProfile(profile),
      profiles: allProfiles(),
      online: onlineCids(),
      history,
      stories: liveStories().map((s) => publicStory(s, cid)),
      vapid: VAPID_PUBLIC,
    });

    if (!wasPresent) {
      socket.to('chat').emit('system', { text: `${profile.name}님이 들어왔어요`, ts: Date.now() });
    }
    socket.to('chat').emit('profile', publicProfile(profile));
    io.to('chat').emit('presence', onlineCids());
  });

  // 프로필 수정
  socket.on('profile:update', (d, ack) => {
    const cid = conns.get(socket.id);
    if (!cid) return;
    const p = profiles.get(cid);
    d = d || {};
    if (typeof d.name === 'string') p.name = uniqueName(cleanName(d.name), cid);
    if (typeof d.status === 'string') p.status = cleanStatus(d.status);
    if (typeof d.avatar === 'string') p.avatar = cleanAvatar(d.avatar);
    io.to('chat').emit('profile', publicProfile(p));
    if (typeof ack === 'function') ack(publicProfile(p));
  });

  // 화면 보고 있는지 (보고 있으면 푸시 안 보내려고)
  socket.on('visibility', (v) => {
    if (!conns.has(socket.id)) return;
    if (v) visibleSockets.add(socket.id);
    else visibleSockets.delete(socket.id);
  });

  // 푸시 구독 등록
  socket.on('push:subscribe', (sub) => {
    const cid = conns.get(socket.id);
    if (!cid || !webpush) return;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys) return;
    if (!pushSubs.has(cid)) pushSubs.set(cid, new Map());
    pushSubs.get(cid).set(sub.endpoint, sub);
  });

  // 메시지
  socket.on('message', (data) => {
    const cid = conns.get(socket.id);
    if (!cid) return;
    const p = profiles.get(cid);
    let { text, image } = data || {};
    text = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
    image = isImage(image) ? image : null;
    if (!text && !image) return;

    const msg = { id: ++seq, cid, name: p.name, text, image, ts: Date.now() };
    history.push(msg);
    if (history.length > MAX_HISTORY) history.shift();
    io.to('chat').emit('message', msg);
    pushOthers(cid, { title: p.name, body: text ? text.slice(0, 80) : '📷 사진을 보냈어요', tag: 'chat' });
  });

  // 스토리 올리기
  socket.on('story', (data) => {
    const cid = conns.get(socket.id);
    if (!cid) return;
    const p = profiles.get(cid);
    const { image, caption } = data || {};
    if (!isImage(image)) return;

    const story = {
      id: ++seq, cid, name: p.name, image,
      caption: typeof caption === 'string' ? caption.trim().slice(0, 100) : '',
      ts: Date.now(), comments: [], viewers: [],
    };
    stories.push(story);
    if (stories.length > MAX_STORIES) stories.shift();
    io.to('chat').emit('story', publicStory(story, null));
    pushOthers(cid, { title: p.name, body: '새 스토리를 올렸어요', tag: 'story' });
  });

  // 스토리 봤어요 (주인에게만 알려줘요)
  socket.on('story:view', (id) => {
    const cid = conns.get(socket.id);
    if (!cid) return;
    const s = liveStories().find((x) => x.id === id);
    if (!s || s.cid === cid || s.viewers.some((v) => v.cid === cid)) return;
    s.viewers.push({ cid, ts: Date.now() });
    for (const sid of socketsOf(s.cid)) io.to(sid).emit('story:viewers', { id: s.id, viewers: s.viewers });
  });

  // 스토리 댓글
  socket.on('story:comment', (d) => {
    const cid = conns.get(socket.id);
    if (!cid) return;
    const p = profiles.get(cid);
    const s = liveStories().find((x) => x.id === (d && d.id));
    const text = d && typeof d.text === 'string' ? d.text.trim().slice(0, 200) : '';
    if (!s || !text) return;
    const comment = { id: ++seq, cid, name: p.name, text, ts: Date.now() };
    s.comments.push(comment);
    if (s.comments.length > 100) s.comments.shift();
    io.to('chat').emit('story:comment', { sid: s.id, comment });
    if (s.cid !== cid) sendPush([s.cid], { title: p.name, body: `스토리 댓글: ${text.slice(0, 60)}`, tag: 'comment' });
  });

  // 퇴장 (같은 사람의 연결이 전부 끊기면 유예시간 뒤에 "나갔어요")
  socket.on('disconnect', () => {
    visibleSockets.delete(socket.id);
    const cid = conns.get(socket.id);
    if (!cid) return;
    conns.delete(socket.id);
    if (onlineCids().includes(cid)) return;

    const t = setTimeout(() => {
      leaveTimers.delete(cid);
      if (onlineCids().includes(cid)) return;
      const p = profiles.get(cid);
      io.to('chat').emit('system', { text: `${p ? p.name : '누군가'}님이 나갔어요`, ts: Date.now() });
      io.to('chat').emit('presence', onlineCids());
    }, LEAVE_GRACE);
    leaveTimers.set(cid, t);
  });
});

setInterval(liveStories, 10 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n☁️  스카이챗 실행 중!');
  console.log(`  내 컴퓨터:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  같은 와이파이: http://${n.address}:${PORT}`);
    }
  }
  console.log(`  푸시 알림: ${webpush ? '사용 가능' : '사용 안 함'}`);
  if (!process.env.CHAT_PASSWORD) {
    console.log('\n⚠️  비밀번호가 기본값(1234)이에요. CHAT_PASSWORD 환경변수로 바꿔주세요.');
  }
  console.log('');
});
