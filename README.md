# 스카이챗 v2

친구들끼리 쓰는 실시간 채팅 (Node.js).

## 실행
```bash
npm install
CHAT_PASSWORD=원하는비번 npm start      # Mac/Linux
# Windows(PowerShell):  $env:CHAT_PASSWORD="원하는비번"; npm start
```
브라우저에서 http://localhost:3000

## 기능
- 인스타 스타일 화면 / 사람별 스토리 동그라미 / 스토리 댓글 / 스토리 본 사람(주인만 보임)
- 프로필 사진 · 이름 · 상태메시지
- 내 화면 배경 커스텀 (프리셋 + 내 사진)
- 새 메시지·스토리·댓글 푸시 알림 (앱을 닫아도 와요)
- 같은 사람은 탭/새로고침/재연결해도 한 명으로만 표시

## 푸시 알림 참고
- 알림은 https 주소(Render 등)에서만 동작해요. localhost에서는 테스트 가능.
- 아이폰: Safari → 공유 → "홈 화면에 추가"로 설치한 앱에서만 알림이 와요.
- 서버가 재시작되면 구독 정보가 사라져서, 친구가 앱을 한 번 열어야 알림이 다시 등록돼요.

## 서버가 잠들지 않게 (선택)
무료 호스팅은 15분간 접속이 없으면 잠들어요. UptimeRobot 같은 무료 서비스로
`https://내주소.onrender.com/health` 를 5분마다 호출하면 계속 깨어 있어서,
대화 기록과 알림 등록이 유지돼요.

## 환경변수
- `CHAT_PASSWORD` : 접속 비밀번호 (필수로 바꾸기)
- `VAPID_SUBJECT` : (선택) 푸시용 연락처. 예: `mailto:내이메일@gmail.com`
