# 중도일보 사우회

중도일보 사우 최대 10명이 계정을 만들고 함께 쓰는 반응형 소셜 웹앱입니다. Node.js 서버와 Render Postgres를 사용하며, 외부 Supabase 계정은 필요하지 않습니다.

## 들어 있는 기능

- 아이디와 비밀번호로 가입/로그인, 최대 10개 계정
- 프로필 이름, 사용자 이름, 소개, 사진 편집
- 사진을 최대 10장까지 원본 비율로 올리는 게시물, 댓글, 좋아요와 좋아요한 회원 목록
- 다른 회원 프로필과 게시물 보기, 프로필 이름·사진으로 프로필 페이지 이동
- 게시물 댓글은 PC에서 사진과 댓글을 좌우로 나눠 보기
- 회원별 한 칸으로 모이는 스토리, 5초 자동 넘김과 진행 막대, 모바일 전체 화면 및 좌우 터치 이동, 길게 누르기 일시정지, PC 큰 화면·좌우 화살표·`▶`/`■` 재생 제어
- 스토리 댓글과 댓글 알림, 게시물 댓글 버튼을 누르면 열리는 댓글 모달
- 스토리는 한 회원당 한 칸으로 표시, 한 번 본 스토리 링은 회색으로 변경
- 알림을 누르면 해당 게시물·댓글·스토리·메시지로 이동
- 사우 간 1:1 채팅 및 그룹 채팅, 대화방 초대와 나가기
- 댓글·좋아요·스토리 댓글/답장·채팅 알림
- 흑백 선형 아이콘, 모바일 글쓰기 중 화면 확대 방지
- 권한을 켠 기기에 댓글·좋아요·스토리 답장·메시지 웹 푸시 배너 알림
- 계정별 배경 설정, 중도일보 로고, 흑백 UI와 스토리 무지개 테두리, 모바일/PC 반응형 화면
- 비밀번호 해시 저장, HTTPS 전용 세션 쿠키, 계정 권한이 확인된 API

사진은 브라우저에서 크기를 줄인 뒤 Postgres에 저장됩니다. 별도 파일 저장 서비스는 필요하지 않습니다.

## GitHub와 Render에 배포

1. 이 ZIP을 풀고, **안의 파일과 `public` 폴더**를 GitHub 저장소 최상위에 올립니다. 최상위에 `render.yaml`, `package.json`, `server.js`, `schema.sql`, `public/`이 있어야 합니다.
2. Render에서 **New → Blueprint**를 열고 해당 GitHub 저장소를 연결합니다.
3. Render가 `render.yaml`을 읽어 웹 서버와 Postgres를 구성하도록 진행합니다. `DATABASE_URL`은 Blueprint가 자동으로 연결합니다.
4. 배포가 끝나면 Render가 제공하는 `onrender.com` 링크를 사우들에게 공유합니다. 사우들은 링크를 열어 **계정 만들기**에서 가입하면 됩니다. 최대 10개 계정까지 가입을 받습니다.

일반 사용에는 Supabase나 별도 환경변수 설정이 필요하지 않습니다. 휴대폰 상단 배너 알림을 사용하려면 아래의 VAPID 키 설정이 추가로 필요합니다. 공개 링크를 가진 누구나 계정을 만들 수 있으므로 링크를 공개 게시판에는 올리지 마세요. 10개 가입이 차면 신규 가입이 자동으로 닫힙니다.

## 휴대폰 상단 배너 알림 켜기

웹 푸시 알림은 사용자가 기기별로 허용해야 합니다. Render 서비스의 **Environment**에 다음 세 변수를 설정하고 재배포하세요.

1. 프로젝트 폴더에서 `npm install` 후 `npm run generate-vapid-keys`를 실행합니다. 출력된 `publicKey`와 `privateKey`를 각각 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`로 Render에 저장합니다. 개인 키는 GitHub 파일에 넣지 마세요.
2. `VAPID_SUBJECT`에는 실제 Render 사이트 주소(예: `https://내-사이트.onrender.com`)를 넣습니다.
3. 배포 후 사이트의 **알림** 화면에서 **알림 켜기**를 누르고 브라우저 알림을 허용합니다.

아이폰·아이패드는 iOS/iPadOS 16.4 이상에서 Safari 공유 메뉴의 **홈 화면에 추가**로 설치한 뒤, 홈 화면 아이콘으로 앱을 열어야 웹 푸시를 받을 수 있습니다. Android에서는 지원 브라우저에서 사이트 알림을 허용하면 됩니다. [Apple 웹 푸시 안내](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

## Render 무료 플랜의 주의점

`render.yaml`은 비용이 청구되지 않는 무료 웹 서비스와 무료 Postgres를 선택합니다. 무료 웹 서비스는 15분 동안 요청이 없으면 잠들며, 다시 접속할 때 깨어나는 데 약 1분 걸릴 수 있습니다. 무료 Postgres는 생성 후 30일이 지나면 만료되므로 장기 사용 전에 Render에서 데이터베이스를 유료 플랜으로 올려야 합니다. 무료 DB를 영구 저장소로 사용하지 마세요. [Render 무료 플랜 제한](https://render.com/docs/free)

## 로컬 실행

Node.js 22 이상과 로컬 Postgres가 필요합니다. 데이터베이스를 만든 뒤 `DATABASE_URL` 환경 변수를 설정하고 실행합니다.

```powershell
npm install
$env:DATABASE_URL="postgresql://사용자:비밀번호@localhost:5432/jungdo_sauhoe"
npm start
```

브라우저에서 `http://localhost:10000`을 엽니다. 첫 실행 때 `schema.sql`이 필요한 테이블을 만듭니다.

## 파일 구성

- `server.js` — 로그인 세션, API, Postgres 연결, 사진 처리
- `schema.sql` — 계정, 게시물, 좋아요, 댓글, 스토리, 대화, 알림 및 푸시 구독 테이블
- `public/` — 웹 화면과 반응형 스타일
- `render.yaml` — Render 웹 서비스와 Postgres 배포 설정

화면이 열려 있을 때는 약 6초마다 새 소식을 확인하고, 푸시 알림을 켠 기기에는 새 알림 배너를 보냅니다. 이메일/비밀번호 찾기 기능은 아직 없으므로 각자 로그인 정보를 안전하게 보관하세요.
