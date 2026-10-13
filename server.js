const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

// ===== 설정 =====
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.CHAT_PASSWORD || '1234'; // 꼭 바꾸세요!
const MAX_HISTORY = 60;          // 새로 들어온 사람에게 보여줄 최근 메시지 수
const MAX_STORIES = 40;          // 보관할 스토리 수
const STORY_TTL = 24 * 60 * 60 * 1000; // 스토리 유지 시간 (24시간)

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 }); // 이미지 전송용 8MB

app.use(express.static(path.join(__dirname, 'public')));

// ===== 메모리 저장소 (서버를 끄면 사라져요) =====
const users = new Map(); // socket.id -> { name, cid }
let history = [];
let stories = [];
let seq = 0;

const isImage = (v) =>
  typeof v === 'string' &&
  v.length < 6e6 &&
  /^data:image\/(jpeg|png|webp|gif);base64,/.test(v);

const userList = () => [...users.values()].map((u) => ({ name: u.name, cid: u.cid }));
const liveStories = () => {
  const t = Date.now();
  stories = stories.filter((s) => t - s.ts < STORY_TTL);
  return stories;
};

function uniqueName(base) {
  const taken = new Set([...users.values()].map((u) => u.name));
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  return name;
}

io.on('connection', (socket) => {
  // 입장 (비밀번호 확인)
  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    const { name, password, cid } = data || {};

    if (users.has(socket.id)) return ack({ ok: false, error: '이미 입장한 상태예요' });
    if (password !== PASSWORD) {
      // 비밀번호 무작위 대입을 조금 느리게 만들기
      return setTimeout(() => ack({ ok: false, error: '비밀번호가 맞지 않아요' }), 800);
    }

    const nick = uniqueName(String(name || '').trim().slice(0, 12) || '익명');
    const user = { name: nick, cid: String(cid || socket.id).slice(0, 64) };
    users.set(socket.id, user);
    socket.join('chat');

    ack({
      ok: true,
      name: nick,
      history,
      stories: liveStories(),
      users: userList(),
    });

    socket.to('chat').emit('system', { text: `${nick}님이 들어왔어요`, ts: Date.now() });
    io.to('chat').emit('users', userList());
  });

  // 메시지 (글 / 사진)
  socket.on('message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    let { text, image } = data || {};
    text = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
    image = isImage(image) ? image : null;
    if (!text && !image) return;

    const msg = { id: ++seq, name: user.name, cid: user.cid, text, image, ts: Date.now() };
    history.push(msg);
    if (history.length > MAX_HISTORY) history.shift();
    io.to('chat').emit('message', msg);
  });

  // 스토리 올리기
  socket.on('story', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const { image, caption } = data || {};
    if (!isImage(image)) return;

    const story = {
      id: ++seq,
      name: user.name,
      cid: user.cid,
      image,
      caption: typeof caption === 'string' ? caption.trim().slice(0, 100) : '',
      ts: Date.now(),
    };
    stories.push(story);
    if (stories.length > MAX_STORIES) stories.shift();
    io.to('chat').emit('story', story);
  });

  // 퇴장
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;
    users.delete(socket.id);
    io.to('chat').emit('system', { text: `${user.name}님이 나갔어요`, ts: Date.now() });
    io.to('chat').emit('users', userList());
  });
});

setInterval(liveStories, 10 * 60 * 1000); // 오래된 스토리 정리

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n☁️  스카이챗 실행 중!');
  console.log(`  내 컴퓨터:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log(`  같은 와이파이: http://${n.address}:${PORT}`);
      }
    }
  }
  if (!process.env.CHAT_PASSWORD) {
    console.log('\n⚠️  비밀번호가 기본값(1234)이에요. 바꾸려면:');
    console.log('   CHAT_PASSWORD=원하는비번 node server.js');
  }
  console.log('');
});
