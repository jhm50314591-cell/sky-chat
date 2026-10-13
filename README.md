# ☁️ 스카이챗

친구들끼리 쓰는 실시간 채팅. (Node.js 필요)

## 실행
```bash
npm install
CHAT_PASSWORD=원하는비번 npm start      # Mac/Linux
# Windows(PowerShell):  $env:CHAT_PASSWORD="원하는비번"; npm start
# Windows(cmd):         set CHAT_PASSWORD=원하는비번 && npm start
```
브라우저에서 http://localhost:3000

## 친구들 접속시키기
- 같은 와이파이: 터미널에 나온 `같은 와이파이` 주소로 접속
- 밖에서도 접속(임시): 서버 켠 상태에서 다른 터미널에 `npx localtunnel --port 3000`
  → 나온 https 주소를 친구들에게 공유
- 컴퓨터 꺼도 항상 열어두기: Render / Railway 같은 곳에 올리고
  환경변수 `CHAT_PASSWORD`를 설정

## 참고
- 메시지/스토리는 서버 메모리에 저장돼요. 서버를 끄면 사라져요.
- 스토리는 24시간 뒤 자동으로 사라져요.
- 새 메시지 알림음은 처음 화면을 한 번 터치/클릭한 뒤부터 울려요.
