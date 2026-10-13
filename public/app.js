const appRoot = document.querySelector('#app');
let currentUser = null;
let state = null;
let page = 'home';
let activeChat = null;
let activeCommentPost = null;
let activeLikesPost = null;
let viewingProfileId = null;
let targetStoryCommentId = null;
const galleryIndexByPost = new Map();
let modal = null;
let modalDraft = {};
let activeStory = null;
let storyQueue = [];
let storyIndex = 0;
let storyUserQueues = [];
let storyUserIndex = 0;
let storyTimer = null;
let storyDeadline = 0;
let storyRemaining = 5000;
let storyProgress = 0;
let storyPaused = false;
let storyTouchPaused = false;
let storyTouchStartedAt = 0;
let storyIgnoreNextTap = false;
let storyPausedByInput = false;
let authMode = 'login';
let busy = false;
let pollTimer = null;
let pushConfig = { loaded:false, enabled:false, publicKey:'' };
let pushRegistration = null;
let pushSubscribed = false;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const iconPaths = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  friends:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3A4.5 4.5 0 0 1 15 18.5V20M16 5.2a3.2 3.2 0 0 1 0 6.1M18 14.4a4 4 0 0 1 3 3.9V20"/>',
  messages:'<path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.1-.6L4 20l1.6-4.5A7.5 7.5 0 1 1 20.5 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  bell:'<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  profile:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  heart:'<path d="M20.8 8.8c0 5.2-8.8 11-8.8 11s-8.8-5.8-8.8-11A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z"/>',
  comment:'<path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.1-.6L4 20l1.6-4.5A7.5 7.5 0 1 1 20.5 11.5Z"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  logout:'<path d="M10 17l5-5-5-5M15 12H3M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>',
  left:'<path d="m15 18-6-6 6-6"/>',
  right:'<path d="m9 18 6-6-6-6"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
  group:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20"/>'
};
function iconSvg(name, className='') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.profile}</svg>`;
}
const byId = id => state?.users.find(user => Number(user.id) === Number(id)) || { id, name:'사우', handle:'', bio:'', photo:'', color:'#767882' };
function profileLink(user,size='',label=false) {
  return `<button type="button" class="profile-link" data-profile-user="${Number(user.id)}" aria-label="${esc(user.name)} 프로필 보기">${avatar(user,size)}${label?`<span><b>${esc(user.name)}</b><small>@${esc(user.handle||'')}</small></span>':''}</button>`;
}
const me = () => currentUser;
const api = async (url, options = {}) => {
  const response = await fetch(url, { credentials:'same-origin', headers:{ 'Content-Type':'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
};

function avatar(user, size = '') {
  return user.photo
    ? `<img class="avatar ${size}" src="${user.photo}" alt="${esc(user.name)}">`
    : `<div class="avatar ${size}" style="background:linear-gradient(140deg,#67718a,#a25d83)">${esc(user.name?.slice(0,1) || '사')}</div>`;
}
function when(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}
function toast(message) {
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div');
  element.className = 'toast'; element.textContent = message; document.body.append(element);
  setTimeout(() => element.remove(), 2600);
}
function setBackground() {
  const value = me()?.background || '';
  document.body.style.backgroundImage = value.startsWith('data:image')
    ? `linear-gradient(#08090be6,#08090be6),url("${value}")`
    : value === 'aurora'
      ? 'radial-gradient(ellipse at 75% 0%,#303034 0%,#151518 45%,#0b0c0f 78%)'
      : value === 'sunset'
        ? 'radial-gradient(ellipse at 70% 0%,#363638 0%,#18181a 48%,#0b0c0f 80%)'
        : '';
}

async function start() {
  try {
    const session = await api('/api/session');
    currentUser = session.user;
    await refresh(false);
    render();
    startPolling();
    loadPushConfiguration();
    const notificationId = Number(new URLSearchParams(location.search).get('notification'));
    if (notificationId) openNotification(notificationId);
  } catch (error) {
    if (/로그인|만료/.test(error.message)) renderAuth();
    else renderError(error.message);
  }
}
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!document.hidden && !modal && !activeStory && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) refresh(true,true).catch(() => {});
  }, 6000);
}
async function refresh(shouldRender = true, light = false) {
  if (busy) return;
  busy = true;
  try {
    const old = state;
    let data = await api(`/api/bootstrap${light?'?light=1':''}`);
    if (light && old) {
      const knownPosts = new Set(old.posts.map(post=>Number(post.id)));
      const knownStories = new Set(old.stories.map(story=>Number(story.id)));
      if (data.posts.some(post=>!knownPosts.has(Number(post.id))) || data.stories.some(story=>!knownStories.has(Number(story.id)))) data = await api('/api/bootstrap');
    }
    if (light && old) {
      const oldUsers = new Map(old.users.map(user=>[Number(user.id),user]));
      const oldPosts = new Map(old.posts.map(post=>[Number(post.id),post]));
      const oldStories = new Map(old.stories.map(story=>[Number(story.id),story]));
      data.users=data.users.map(user=>({...user,photo:oldUsers.get(Number(user.id))?.photo||''}));
      data.me={...data.me,photo:old.me.photo||''};
      data.posts=data.posts.map(post=>({...post,image:post.image||oldPosts.get(Number(post.id))?.image||'',images:post.images?.length?post.images:(oldPosts.get(Number(post.id))?.images||[])}));
      data.stories=data.stories.map(story=>({...story,image:story.image||oldStories.get(Number(story.id))?.image||''}));
    }
    state = data;
    currentUser = data.me;
    if (!activeChat || !state.chats.some(chat => Number(chat.id) === Number(activeChat))) activeChat = state.chats[0]?.id ?? null;
    setBackground();
    if (shouldRender) render();
  } finally { busy = false; }
}
function renderAuth(errorText = '') {
  clearInterval(pollTimer);
  document.body.style.backgroundImage = '';
  appRoot.innerHTML = `<main class="auth"><section class="auth-card"><img class="auth-logo" src="/joongdo-logo.png" alt="중도일보 로고"><div class="eyebrow">중도일보 사우 전용 공간</div><h1>중도일보 사우회</h1><p>${authMode === 'login' ? '사우들과 일상을 나누고 소식을 확인하세요.' : '아이디와 비밀번호를 만들면 바로 가입할 수 있습니다.'}</p><div class="auth-tabs"><button class="${authMode==='login'?'selected':''}" data-auth-mode="login">로그인</button><button class="${authMode==='register'?'selected':''}" data-auth-mode="register">계정 만들기</button></div>${errorText?`<div class="form-error">${esc(errorText)}</div>`:''}<form id="auth-form">${authMode==='register'?'<label class="field">이름<input name="name" maxlength="30" autocomplete="name" required placeholder="이름"></label>':''}<label class="field">아이디<input name="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" autocomplete="username" required placeholder="영문 소문자, 숫자, 밑줄"></label><label class="field">비밀번호<input name="password" type="password" minlength="8" maxlength="72" autocomplete="${authMode==='login'?'current-password':'new-password'}" required placeholder="8자 이상"></label><button class="button full">${authMode==='login'?'로그인':'계정 만들기'}</button></form><div class="auth-note">사우회 계정은 최대 10명까지 가입할 수 있습니다.</div></section></main>`;
  document.querySelectorAll('[data-auth-mode]').forEach(button => button.onclick = () => { authMode = button.dataset.authMode; renderAuth(); });
  document.querySelector('#auth-form')?.addEventListener('submit', submitAuth);
}
function renderError(message) {
  appRoot.innerHTML = `<main class="auth"><section class="auth-card"><img class="auth-logo" src="/joongdo-logo.png" alt="중도일보 로고"><h1>서버에 연결할 수 없습니다</h1><p>${esc(message)}</p><p>Render에 서버와 데이터베이스가 배포된 뒤 이 페이지를 사용할 수 있습니다.</p></section></main>`;
}
async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const result = await api(`/api/auth/${authMode==='register'?'register':'login'}`, { method:'POST', body:JSON.stringify(data) });
    currentUser = result.user;
    await refresh(false); page = 'home'; render(); startPolling();loadPushConfiguration();
    const notificationId=Number(new URLSearchParams(location.search).get('notification'));
    if(notificationId)openNotification(notificationId);
  } catch (error) { renderAuth(error.message); }
}

const navItems = [['home','home','홈'],['friends','friends','사우'],['messages','messages','메시지'],['notifications','bell','알림'],['profile','profile','프로필']];
function render() {
  if (!state || !me()) return renderAuth();
  setBackground();
  document.title = '중도일보 사우회';
  appRoot.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand" title="중도일보 사우회"><img class="brand-logo" src="/joongdo-logo.png" alt="중도일보 사우회">중도일보 사우회</div><nav class="nav">${navItems.map(([id,icon,label])=>`<button title="${label}" aria-label="${label}" class="${page===id?'active':''}" data-page="${id}"><span class="ico">${iconSvg(icon)}</span>${label}${id==='notifications'&&state.notifications.some(n=>!n.read)?'<i class="notification-dot"></i>':''}</button>`).join('')}</nav><div class="side-bottom"><button class="profile-mini" title="프로필" aria-label="프로필" data-page="profile">${avatar(me(),'small')}</button><button class="side-logout" title="로그아웃" aria-label="로그아웃" data-logout>${iconSvg('logout')}</button></div></aside><main class="main">${page==='home'?homePage():page==='messages'?messagesPage():page==='profile'?profilePage():page==='friends'?friendsPage():notificationsPage()}</main><aside class="right">${rightRail()}</aside></div><nav class="mobile-nav">${navItems.map(([id,icon,label])=>`<button aria-label="${label}" title="${label}" class="${page===id?'active':''}" data-page="${id}">${iconSvg(icon)}</button>`).join('')}</nav>${modal?modalHtml():''}${activeStory?storyHtml():''}`;
  bind();
}
function homePage() {
  const storiesByUser = new Map();
  for (const story of state.stories) {
    const key = Number(story.user);
    if (!storiesByUser.has(key)) storiesByUser.set(key, []);
    storiesByUser.get(key).push(story);
  }
  const storyUsers = state.users.filter(user => Number(user.id) === Number(me().id) || storiesByUser.has(Number(user.id)));
  return `<div class="topbar"><div><div class="eyebrow">중도일보 사우회</div><h1>안녕하세요, ${esc(me().name)}님</h1></div><button class="button create-post" data-modal="post">${iconSvg('plus')} 게시물</button></div><section class="stories">${storyUsers.map(user=>{const userStories=storiesByUser.get(Number(user.id))||[],own=Number(user.id)===Number(me().id),unseen=userStories.some(story=>!story.seen);return `<div class="story-tile"><button class="story" data-story-user="${user.id}"><div class="story-ring ${unseen?'has-story':'seen'}">${avatar(user)}</div><span>${own?'내 스토리':esc(user.name)}</span></button>${own?`<button class="story-add-trigger" data-modal="story" aria-label="새 스토리 올리기">${iconSvg('plus')}</button>`:''}</div>`;}).join('')}</section><div class="feed-head"><h2>사우들의 게시물</h2><span>함께 나누는 하루</span></div><button class="compose" data-modal="post">지금 소식을 나눠보세요…</button>${state.posts.map(postCard).join('')||'<div class="empty">아직 게시물이 없습니다. 첫 소식을 나눠보세요.</div>'}`;
}
function postCard(post) {
  const owner = byId(post.user), liked = post.likes.includes(Number(me().id));
  const images=post.images?.length?post.images:(post.image?[post.image]:[]),index=Math.min(galleryIndexByPost.get(Number(post.id))||0,Math.max(0,images.length-1));
  const media=images.length?`<div class="post-gallery" data-post-gallery="${post.id}"><img class="post-image" src="${images[index]}" alt="게시물 이미지 ${index+1}${images.length>1?` / ${images.length}`:''}">${images.length>1?`<button class="gallery-arrow prev" data-gallery-step="-1" data-gallery-post="${post.id}" aria-label="이전 사진">${iconSvg('left')}</button><button class="gallery-arrow next" data-gallery-step="1" data-gallery-post="${post.id}" aria-label="다음 사진">${iconSvg('right')}</button><span class="gallery-count">${index+1} / ${images.length}</span><div class="gallery-dots">${images.map((_,dot)=>`<i class="${dot===index?'active':''}"></i>`).join('')}</div>`:''}</div>`:`<div class="post-placeholder text-only"><span>${esc(post.caption)}</span></div>`;
  return `<article class="post" id="post-${post.id}"><div class="post-head">${profileLink(owner,'small')}<div class="post-author"><button class="profile-name" data-profile-user="${owner.id}">${esc(owner.name)}</button><small>@${esc(owner.handle)} · ${when(post.created)}</small></div>${Number(post.user)===Number(me().id)?`<button class="more" aria-label="게시물 삭제" data-delete-post="${post.id}">${iconSvg('more')}</button>`:''}</div>${media}<div class="post-actions"><button class="${liked?'liked':''}" aria-label="좋아요" data-like="${post.id}">${iconSvg('heart')}</button><button aria-label="댓글 ${post.comments.length}개 보기" data-open-comments="${post.id}">${iconSvg('comment')}</button><button class="post-like-count" data-likes-post="${post.id}">${post.likes.length}명이 좋아합니다</button></div><div class="post-content"><div><strong>${esc(owner.name)}</strong><span class="caption">${esc(post.caption)}</span></div><button class="comment-open-link" data-open-comments="${post.id}">${post.comments.length?`댓글 ${post.comments.length}개 모두 보기`:'댓글 남기기'}</button></div></article>`;
}
function notificationCard(item) {
  const text = `${item.name||byId(item.user).name} ${item.text}`;
  return `<a class="notification notification-button ${item.read?'':'unread'}" href="/?notification=${item.id}" data-notification="${item.id}" aria-label="${esc(text)}">${avatar(byId(item.user),'small')}<span class="notification-copy"><span><b>${esc(item.name||byId(item.user).name)}</b> ${esc(item.text)}</span><em>${when(item.created)}</em></span><span class="notification-chevron">${iconSvg('right')}</span></a>`;
}
function rightRail() {
  const newNotifications=state.notifications.filter(item=>!item.read).slice(0,3);
  return `<div class="right-card"><div style="display:flex;align-items:center;justify-content:space-between"><h3>내 프로필</h3><button class="follow" data-page="profile">편집</button></div><button class="user-row user-row-button" data-profile-user="${me().id}">${avatar(me(),'small')}<span><b>${esc(me().name)}</b><small>@${esc(me().handle)}</small></span></button><div class="eyebrow">${esc(me().bio||'소개를 추가해 보세요.')}</div></div><div class="right-card"><h3>사우회 회원 <span class="muted">· ${state.users.length}명</span></h3>${state.users.filter(user=>Number(user.id)!==Number(me().id)).slice(0,5).map(user=>`<div class="user-row">${profileLink(user,'small',true)}<button class="follow" data-dm="${user.id}">메시지</button></div>`).join('')||'<div class="eyebrow">아직 다른 회원이 가입하지 않았어요.</div>'}</div><div class="right-card"><h3>새 소식</h3>${newNotifications.map(notificationCard).join('')||'<div class="eyebrow">새 알림이 없습니다.</div>'}<button class="follow" data-page="notifications">모두 보기 →</button></div><div class="eyebrow" style="line-height:1.8">중도일보 사우회 · 2026<br>사우들과 일상을 나누는 공간</div>`;
}
function friendsPage() {
  return `<div class="topbar"><div><div class="eyebrow">함께 소식을 나누는 사람들</div><h1>사우회 회원</h1></div><span class="pill">${state.users.length} / 10명</span></div>${state.users.map(user=>`<article class="right-card friend-card">${profileLink(user)}<button class="friend-info friend-profile" data-profile-user="${user.id}"><b>${esc(user.name)}</b><span class="eyebrow">@${esc(user.handle)}</span><span class="eyebrow">${esc(user.bio||'')}</span></button>${Number(user.id)!==Number(me().id)?`<button class="button ghost" data-dm="${user.id}">메시지</button>`:'<span class="pill">나</span>'}</article>`).join('')}`;
}
function messagesPage() {
  const chat=state.chats.find(item=>Number(item.id)===Number(activeChat));
  return `<div class="topbar"><div><div class="eyebrow">사우들과 이야기 나누기</div><h1>메시지</h1></div><button class="button create-post" data-modal="chat">${iconSvg('plus')} 대화 시작</button></div><div class="chat-layout"><div class="chat-list">${state.chats.map(item=>{const other=byId(item.members.find(id=>Number(id)!==Number(me().id))),last=item.messages.at(-1);return `<button class="chat-person ${Number(item.id)===Number(activeChat)?'selected':''}" data-chat="${item.id}">${item.group?`<span class="avatar small group-avatar">${iconSvg('group')}</span>`:avatar(other,'small')}<span>${esc(item.title)}${last?`<small>${esc(last.text)}</small>`:''}</span></button>`}).join('')||'<div class="empty">아직 대화가 없습니다.</div>'}</div>${chat?`<section class="chat-window"><div class="chat-top"><span><b>${esc(chat.title)}</b><small>${chat.members.length}명 참여</small></span><span class="chat-manage"><button class="button ghost" data-invite-chat>초대하기</button><button class="button ghost" data-leave-chat>나가기</button></span></div><div class="messages" id="messages">${chat.messages.map(message=>`<div id="message-${message.id}" class="bubble ${Number(message.user)===Number(me().id)?'mine':''}">${Number(message.user)===Number(me().id)?'':`<small><button class="profile-name" data-profile-user="${message.user}">${esc(message.name||byId(message.user).name)}</button></small>`}${esc(message.text)}</div>`).join('')||'<div class="empty" style="margin:auto">첫 인사를 건네 보세요.</div>'}</div><form class="chat-send" id="chat-send"><input placeholder="메시지를 입력하세요…" aria-label="메시지" maxlength="2000"><button class="button">보내기</button></form></section>`:'<section class="chat-window"><div class="empty" style="margin:auto">대화를 선택하거나 새 대화를 시작하세요.</div></section>'}</div>`;
}
function profilePage() {
  const profile=byId(viewingProfileId||me().id),isMe=Number(profile.id)===Number(me().id),posts=state.posts.filter(post=>Number(post.user)===Number(profile.id)),storyCount=state.stories.filter(story=>Number(story.user)===Number(profile.id)).length;
  return `<div class="topbar"><div><div class="eyebrow">${isMe?'내 정보를 관리합니다':'사우의 프로필'}</div><h1>${isMe?'프로필':esc(profile.name)}</h1></div><div class="profile-actions">${isMe?`<button class="button ghost" data-logout>로그아웃</button><button class="button" data-modal="profile">프로필 편집</button>`:`<button class="button ghost" data-page="friends">사우 목록</button><button class="button" data-dm="${profile.id}">메시지 보내기</button>`}</div></div><section class="profile-hero">${avatar(profile,'big')}<div><h2>${esc(profile.name)}</h2><div class="eyebrow">@${esc(profile.handle)}</div><div class="profile-numbers"><span><b>${posts.length}</b>게시물</span><span><b>${storyCount}</b>스토리</span><span><b>${Math.max(0,state.users.length-1)}</b>사우</span></div></div></section><p class="profile-bio">${esc(profile.bio||'소개를 추가해 보세요.')}</p>${isMe?`<div class="right-card"><h3>화면 배경</h3><div class="eyebrow" style="margin-bottom:12px">배경 설정은 내 계정에 저장됩니다.</div><div class="background-options"><button class="button ghost" data-bg="">기본 다크</button><button class="button ghost" data-bg="aurora">오로라</button><button class="button ghost" data-bg="sunset">노을</button><label class="button ghost upload-label">사진 선택<input type="file" hidden accept="image/*" id="bg-upload"></label></div></div>`:''}<div class="feed-head"><h2>${isMe?'내 게시물':`${esc(profile.name)}님의 게시물`}</h2><span>${posts.length}개</span></div>${posts.map(postCard).join('')||'<div class="empty">아직 게시물이 없습니다.</div>'}`;
}
function notificationsPage() {
  const iosNeedsInstall = isIosDevice() && !isStandaloneApp();
  const pushMessage = iosNeedsInstall
    ? '아이폰은 Safari 공유 메뉴에서 홈 화면에 추가한 뒤 앱 아이콘으로 열어야 배너 알림을 받을 수 있어요.'
    : !pushSupported() ? '현재 브라우저에서는 휴대폰 배너 알림 기능을 지원하지 않습니다.'
    : !pushConfig.loaded ? '푸시 알림 설정을 확인하고 있어요.'
      : !pushConfig.enabled ? '휴대폰 배너 알림을 켜려면 Render에 VAPID 키를 설정해야 해요. 배포 안내를 확인해 주세요.'
        : pushSubscribed ? '이 기기에서 새 댓글과 메시지 배너를 받고 있어요.' : '이 기기에서 새 댓글과 메시지 배너를 받아 보세요.';
  const canTogglePush = pushConfig.enabled && pushSupported() && (!isIosDevice() || isStandaloneApp());
  return `<div class="topbar notification-topbar"><div><div class="eyebrow">사우들의 소식</div><h1>알림</h1></div>${canTogglePush?`<button class="button ghost push-toggle" data-push-toggle>${pushSubscribed?'알림 끄기':'알림 켜기'}</button>`:''}</div><div class="push-note">${iconSvg('bell')}<span>${pushMessage}</span></div><div class="right-card notifications-list">${state.notifications.map(notificationCard).join('')||'<div class="empty">아직 알림이 없습니다.</div>'}</div>`;
}
function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
}
function isStandaloneApp() {
  return navigator.standalone===true || window.matchMedia('(display-mode: standalone)').matches;
}
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function base64UrlBytes(value) {
  const padded=value+'='.repeat((4-value.length%4)%4);
  const binary=atob(padded.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
}
async function loadPushConfiguration() {
  try { pushConfig={...await api('/api/push/config'),loaded:true}; }
  catch { pushConfig={loaded:true,enabled:false,publicKey:''}; }
  if(pushConfig.enabled&&pushSupported()&&(!isIosDevice()||isStandaloneApp())) {
    try {
      pushRegistration=await navigator.serviceWorker.register('/service-worker.js');
      const subscription=await pushRegistration.pushManager.getSubscription();
      pushSubscribed=Boolean(subscription);
      if(subscription) await api('/api/push/subscriptions',{method:'POST',body:JSON.stringify(subscription.toJSON())});
    } catch { pushSubscribed=false; }
  }
  if(page==='notifications')render();
}
async function togglePushNotifications() {
  if(!pushConfig.enabled) { toast('Render에서 푸시 알림 환경변수를 먼저 설정해 주세요.'); return; }
  if(!pushSupported()) { toast('현재 브라우저에서는 푸시 알림을 지원하지 않습니다.'); return; }
  if(isIosDevice()&&!isStandaloneApp()) { toast('Safari 공유 메뉴에서 홈 화면에 추가한 뒤 앱 아이콘으로 열어 주세요.'); return; }
  try {
    pushRegistration ||= await navigator.serviceWorker.register('/service-worker.js');
    const existing=await pushRegistration.pushManager.getSubscription();
    if(pushSubscribed&&existing) {
      await api('/api/push/subscriptions',{method:'DELETE',body:JSON.stringify({endpoint:existing.endpoint})});
      await existing.unsubscribe();pushSubscribed=false;render();toast('이 기기의 푸시 알림을 껐습니다.');return;
    }
    const permission=await Notification.requestPermission();
    if(permission!=='granted') { toast('휴대폰 설정에서 사이트 알림을 허용해 주세요.');return; }
    const subscription=existing||await pushRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlBytes(pushConfig.publicKey)});
    await api('/api/push/subscriptions',{method:'POST',body:JSON.stringify(subscription.toJSON())});
    pushSubscribed=true;render();toast('이 기기의 푸시 알림을 켰습니다.');
  } catch(error) { toast(error.message||'푸시 알림을 설정하지 못했습니다.'); }
}
async function openNotification(notificationId) {
  const notification=state?.notifications.find(item=>Number(item.id)===Number(notificationId));
  const targetUrl=new URL(location.href);targetUrl.searchParams.delete('notification');
  history.replaceState({},'',targetUrl.pathname+targetUrl.search+targetUrl.hash);
  if(!notification)return;
  try {
    if(!notification.read) await api(`/api/notifications/${notification.id}/read`,{method:'PATCH',body:'{}'});
    await refresh(false);
  } catch {}
  modal=null;activeCommentPost=null;
  if(notification.chatId) {
    page='messages';activeChat=notification.chatId;activeStory=null;render();
    requestAnimationFrame(()=>{
      const message=document.getElementById(notification.messageId?`message-${notification.messageId}`:'');
      if(message)message.scrollIntoView({behavior:'smooth',block:'center'});
      else document.querySelector('#messages')?.scrollTo(0,999999);
    });
    return;
  }
  if(notification.storyId) {
    page='home';activeStory=null;render();
    targetStoryCommentId=notification.storyCommentId||null;
    if(!openStoryById(notification.storyId))toast('해당 스토리는 만료되었거나 삭제되었습니다.');
    return;
  }
  if(notification.postId) {
    page='home';activeStory=null;
    const postExists=state.posts.some(post=>Number(post.id)===Number(notification.postId));
    const shouldOpenComments=notification.kind==='comment'&&postExists;
    activeCommentPost=shouldOpenComments?notification.postId:null;modal=shouldOpenComments?'comments':null;render();
    requestAnimationFrame(()=>{
      document.getElementById(`post-${notification.postId}`)?.scrollIntoView({behavior:'smooth',block:'center'});
      if(shouldOpenComments&&notification.commentId)document.getElementById(`comment-${notification.commentId}`)?.scrollIntoView({behavior:'smooth',block:'center'});
    });
    if(!postExists)toast('해당 게시물이 피드에서 보이지 않습니다.');
    return;
  }
  page='notifications';render();
}

function modalHtml() {
  const titles={post:'새 게시물',story:'스토리 올리기',profile:'프로필 편집',chat:'새 대화',comments:'댓글',likes:'좋아요',invite:'사우 초대'};
  let content='';
  if (modal==='post'||modal==='story') content=`<form id="create-form"><label class="field">사진<input type="file" name="image" accept="image/*" ${modal==='post'?'multiple':''}><span class="eyebrow">${modal==='post'?'사진은 최대 10장까지 올릴 수 있고, 게시물은 24시간 스토리에도 자동으로 공유됩니다.':'사진 없이 글과 이모지를 올릴 수도 있습니다.'}</span></label><label class="field">내용<textarea name="caption" maxlength="500" placeholder="사우들과 나누고 싶은 이야기를 적어 주세요."></textarea></label>${modal==='story'?'<label class="field">이모지<input name="emoji" maxlength="8" value="🌷"></label>':''}<div id="file-preview"></div><button class="button full">${modal==='post'?'게시하기':'스토리 공유하기'}</button></form>`;
  if (modal==='comments') {
    const post=state.posts.find(item=>Number(item.id)===Number(activeCommentPost));
    const images=post?.images?.length?post.images:(post?.image?[post.image]:[]);
    content=post?`<div class="comment-modal-content"><aside class="comment-post-preview">${images[0]?`<img src="${images[0]}" alt="게시물 사진">`:''}<div><b>${esc(byId(post.user).name)}</b><p>${esc(post.caption)}</p></div></aside><div class="comment-modal-pane"><div class="comment-modal-list">${post.comments.map(comment=>`<div class="comment-row" id="comment-${comment.id}">${profileLink(byId(comment.user),'small')}<p><button class="profile-name" data-profile-user="${comment.user}">${esc(comment.name||byId(comment.user).name)}</button> ${esc(comment.text)}<small>${when(comment.created)}</small></p></div>`).join('')||'<div class="empty">아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.</div>'}</div><form class="comment-modal-form" id="post-comment-form"><input maxlength="300" placeholder="댓글을 입력하세요…" aria-label="댓글"><button class="button">게시</button></form></div></div>`:'<div class="empty">게시물을 찾지 못했습니다.</div>';
  }
  if (modal==='likes') { const post=state.posts.find(item=>Number(item.id)===Number(activeLikesPost));content=post?`<div class="likes-list">${post.likes.map(id=>{const user=byId(id);return `<div class="user-row">${profileLink(user,'small',true)}${Number(user.id)!==Number(me().id)?`<button class="follow" data-dm="${user.id}">메시지</button>`:''}</div>`}).join('')||'<div class="empty">아직 좋아요를 누른 사우가 없습니다.</div>'}</div>`:'<div class="empty">게시물을 찾지 못했습니다.</div>'; }
  if (modal==='profile') content=`<form id="profile-form"><label class="field">이름<input name="name" required maxlength="30" value="${esc(me().name)}"></label><label class="field">사용자 이름<input name="handle" required maxlength="24" value="${esc(me().handle)}"></label><label class="field">소개<textarea name="bio" maxlength="120">${esc(me().bio)}</textarea></label><label class="field">프로필 사진<input name="photo" type="file" accept="image/*"></label><div id="profile-preview"></div><button class="button full">저장하기</button></form>`;
  if (modal==='chat') content=`<form id="chat-form"><label class="field">대화 이름<input name="title" maxlength="50" placeholder="예: 주말 약속"></label><div class="field">함께할 사우들${state.users.filter(user=>Number(user.id)!==Number(me().id)).map(user=>`<label class="member-option"><input type="checkbox" name="members" value="${user.id}">${esc(user.name)}</label>`).join('')||'<p class="eyebrow">아직 다른 회원이 가입하지 않았습니다.</p>'}</div><button class="button full">대화 만들기</button></form>`;
  if (modal==='invite') { const chat=state.chats.find(item=>Number(item.id)===Number(activeChat)),available=state.users.filter(user=>Number(user.id)!==Number(me().id)&&!chat?.members.includes(Number(user.id)));content=chat?`<form id="invite-form"><div class="field">초대할 사우 선택${available.map(user=>`<label class="member-option"><input type="checkbox" name="members" value="${user.id}">${esc(user.name)} <small>@${esc(user.handle)}</small></label>`).join('')||'<p class="eyebrow">초대할 수 있는 사우가 없습니다.</p>'}</div><button class="button full" ${available.length?'':'disabled'}>초대하기</button></form>`:'<div class="empty">대화방을 찾지 못했습니다.</div>'; }
  return `<div class="modal-backdrop" id="modal-bg"><section class="modal ${['comments','likes','invite'].includes(modal)?`${modal}-modal`:''}"><header class="modal-head"><h2>${titles[modal]}</h2><button class="close" data-close aria-label="닫기">${iconSvg('close')}</button></header>${content}</section></div>`;
}
function storyHtml() {
  const story=state.stories.find(item=>Number(item.id)===Number(activeStory));
  if (!story) { activeStory=null; return ''; }
  const owner=byId(story.user);
  const currentIndex=storyQueue.findIndex(item=>Number(item.id)===Number(story.id));
  const segments=storyQueue.map((item,index)=>`<span class="story-progress-segment ${index<currentIndex?'completed':index===currentIndex?'current':'future'}"><i style="--story-progress:${index<currentIndex?1:index===currentIndex?storyProgress:0};--story-remaining:${index===currentIndex?storyRemaining:0}ms;--story-play-state:${storyPaused?'paused':'running'}"></i></span>`).join('');
  const storyComments=story.comments||[];
  const canMessage=Number(story.user)!==Number(me().id);
  return `<div class="modal-backdrop" id="story-bg"><button class="story-arrow story-arrow-prev" data-story-prev aria-label="이전 스토리" ${!hasPreviousStory()?'disabled':''}>${iconSvg('left')}</button><section class="story-view" style="${story.image?`background-image:linear-gradient(#0005,#0005),url('${story.image}')`:''}"><div><div class="story-progress">${segments}</div><div class="story-owner">${profileLink(owner,'small')}<b>${esc(owner.name)}</b><small>${when(story.created)}</small><button class="story-play-toggle" data-story-toggle aria-label="${storyPaused?'스토리 재생':'스토리 일시정지'}">${storyPaused?'▶':'■'}</button><button class="close" data-close-story aria-label="닫기">${iconSvg('close')}</button></div></div><div class="story-content">${!story.image&&story.emoji?`<div class="story-emoji">${esc(story.emoji)}</div>`:''}<div>${esc(story.caption)}</div></div><div class="story-footer"><div class="story-comment-list">${storyComments.map(comment=>`<div id="story-comment-${comment.id}"><button class="profile-name" data-profile-user="${comment.user}">${esc(comment.name||byId(comment.user).name)}</button> ${esc(comment.text)}</div>`).join('')}</div><form class="story-comment-form" id="story-comment"><input maxlength="300" placeholder="스토리에 댓글 남기기…" aria-label="스토리 댓글"><button aria-label="댓글 보내기">${iconSvg('send')}</button></form>${canMessage?`<button class="story-private-toggle" data-story-private-toggle>비공개 메시지로 답장</button><form class="story-msg" id="story-reply" hidden><input maxlength="300" placeholder="${esc(owner.name)}님에게 비공개 답장…"><button>보내기</button></form>`:''}</div></section><button class="story-arrow story-arrow-next" data-story-next aria-label="다음 스토리" ${!hasNextStory()?'disabled':''}>${iconSvg('right')}</button></div>`;
}

function buildStoryUserQueues() {
  const grouped=new Map();
  for(const story of state.stories){const id=Number(story.user);if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(story);}
  return [...grouped.entries()].map(([userId,stories])=>({userId,stories:stories.sort((a,b)=>new Date(a.created)-new Date(b.created))})).sort((a,b)=>new Date(b.stories.at(-1).created)-new Date(a.stories.at(-1).created));
}
function hasPreviousStory() { return storyIndex>0||storyUserIndex>0; }
function hasNextStory() { return storyIndex<storyQueue.length-1||storyUserIndex<storyUserQueues.length-1; }
function openStoryUser(userId) {
  storyUserQueues=buildStoryUserQueues();
  storyUserIndex=storyUserQueues.findIndex(group=>group.userId===Number(userId));
  if (storyUserIndex<0) { modal='story';modalDraft={};render();return; }
  storyQueue=storyUserQueues[storyUserIndex].stories;showStory(0);
}
function openStoryById(storyId) {
  storyUserQueues=buildStoryUserQueues();
  storyUserIndex=storyUserQueues.findIndex(group=>group.stories.some(item=>Number(item.id)===Number(storyId)));
  if(storyUserIndex<0)return false;
  storyQueue=storyUserQueues[storyUserIndex].stories;
  const index=storyQueue.findIndex(item=>Number(item.id)===Number(storyId));
  if(index<0)return false;
  showStory(index);return true;
}
function startStoryTimer() {
  clearTimeout(storyTimer);
  if (!activeStory||storyPaused) return;
  storyDeadline=Date.now()+storyRemaining;
  storyTimer=setTimeout(advanceStory,storyRemaining);
}
function advanceStory() {
  if(storyIndex+1<storyQueue.length)return moveStoryTo(storyUserIndex,storyIndex+1);
  if(storyUserIndex+1<storyUserQueues.length)return moveStoryTo(storyUserIndex+1,0);
  closeStory();
}
function previousStory() {
  if(storyIndex>0)return moveStoryTo(storyUserIndex,storyIndex-1);
  if(storyUserIndex>0){const previousIndex=storyUserIndex-1;return moveStoryTo(previousIndex,storyUserQueues[previousIndex].stories.length-1);}
}
function moveStoryTo(userIndex,index) {
  if(index<0||userIndex<0)return;
  if(userIndex>=storyUserQueues.length)return closeStory();
  storyUserIndex=userIndex;storyQueue=storyUserQueues[storyUserIndex].stories;
  if(index>=storyQueue.length)return closeStory();
  showStory(index);
}
function showStory(index) {
  storyIndex=index;activeStory=storyQueue[storyIndex].id;markStoryUserViewed(storyQueue[storyIndex].user);storyPaused=false;storyPausedByInput=false;storyProgress=0;storyRemaining=5000;render();startStoryTimer();
  if(targetStoryCommentId){const id=targetStoryCommentId;targetStoryCommentId=null;requestAnimationFrame(()=>document.getElementById(`story-comment-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'}));}
}
function markStoryUserViewed(userId) {
  const unseen=state.stories.filter(story=>Number(story.user)===Number(userId)&&!story.seen);
  if(!unseen.length)return;
  for(const story of state.stories)if(Number(story.user)===Number(userId))story.seen=true;
  api(`/api/stories/${unseen[0].id}/view`,{method:'POST',body:'{}'}).catch(()=>{});
}
function pauseStory(redraw=true) {
  if (!activeStory||storyPaused) return;
  storyRemaining=Math.max(0,storyDeadline-Date.now());
  storyProgress=Math.min(1,1-storyRemaining/5000);
  storyPaused=true;clearTimeout(storyTimer);
  if (redraw) render();
  else document.querySelector('.story-progress-segment.current>i')?.getAnimations().forEach(animation=>animation.pause());
}
function resumeStory(redraw=true) {
  if (!activeStory||!storyPaused) return;
  storyPaused=false;
  if (redraw) render();
  else document.querySelector('.story-progress-segment.current>i')?.getAnimations().forEach(animation=>animation.play());
  startStoryTimer();
}
function closeStory() {
  clearTimeout(storyTimer);activeStory=null;storyQueue=[];storyIndex=0;storyUserQueues=[];storyUserIndex=0;storyDeadline=0;storyRemaining=5000;storyProgress=0;storyPaused=false;storyTouchPaused=false;storyTouchStartedAt=0;storyIgnoreNextTap=false;storyPausedByInput=false;render();
}

function bind() {
  document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>{
    page=button.dataset.page;
    viewingProfileId=null;
    render();
  });
  document.querySelectorAll('[data-notification]').forEach(button=>button.onclick=event=>{
    if(!state?.notifications.some(item=>Number(item.id)===Number(button.dataset.notification)))return;
    event.preventDefault();openNotification(button.dataset.notification).catch(()=>location.assign(button.href));
  });
  document.querySelectorAll('[data-profile-user]').forEach(button=>button.onclick=()=>{
    if(activeStory){clearTimeout(storyTimer);activeStory=null;storyQueue=[];storyUserQueues=[];storyUserIndex=0;storyPaused=false;storyPausedByInput=false;}
    viewingProfileId=Number(button.dataset.profileUser);page='profile';modal=null;render();
  });
  document.querySelectorAll('[data-push-toggle]').forEach(button=>button.onclick=togglePushNotifications);
  document.querySelectorAll('[data-modal]').forEach(button=>button.onclick=()=>{modal=button.dataset.modal;modalDraft={};render();});
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{modal=null;activeCommentPost=null;render();});
  document.querySelector('#modal-bg')?.addEventListener('click',event=>{if(event.target.id==='modal-bg'){modal=null;activeCommentPost=null;render();}});
  document.querySelectorAll('[data-close-story]').forEach(button=>button.onclick=closeStory);
  document.querySelector('#story-bg')?.addEventListener('click',event=>{if(event.target.id==='story-bg')closeStory();});
  document.querySelectorAll('[data-story-user]').forEach(button=>button.onclick=()=>openStoryUser(button.dataset.storyUser));
  document.querySelectorAll('[data-story-toggle]').forEach(button=>button.onclick=()=>storyPaused?resumeStory():pauseStory());
  document.querySelector('[data-story-prev]')?.addEventListener('click',previousStory);
  document.querySelector('[data-story-next]')?.addEventListener('click',advanceStory);
  document.querySelector('.story-view')?.addEventListener('click',event=>{
    if (storyIgnoreNextTap) { storyIgnoreNextTap=false; return; }
    if (!window.matchMedia('(max-width: 680px)').matches||event.target.closest('button,input,form,a,.story-footer')) return;
    const bounds=event.currentTarget.getBoundingClientRect();
    if (event.clientX<bounds.left+bounds.width/2) previousStory(); else advanceStory();
  });
  document.querySelector('.story-view')?.addEventListener('pointerdown',event=>{storyIgnoreNextTap=false;if(event.pointerType==='touch'&&!event.target.closest('button,input,form,.story-footer')){storyTouchPaused=true;storyTouchStartedAt=Date.now();pauseStory(false);}});
  const storyInputs=document.querySelectorAll('#story-comment input,#story-reply input');
  storyInputs.forEach(input=>{
    input.addEventListener('focus',()=>{if(!storyPaused){storyPausedByInput=true;pauseStory(false);}});
    input.addEventListener('blur',()=>{if(storyPausedByInput){storyPausedByInput=false;resumeStory(false);}});
  });
  document.querySelector('[data-story-private-toggle]')?.addEventListener('click',event=>{
    const form=document.querySelector('#story-reply');form.hidden=!form.hidden;
    event.currentTarget.textContent=form.hidden?'비공개 메시지로 답장':'비공개 답장 닫기';
    if(!form.hidden)form.querySelector('input')?.focus();
  });
  document.querySelectorAll('[data-like]').forEach(button=>button.onclick=async()=>mutate(`/api/posts/${button.dataset.like}/like`,{},'좋아요를 저장했습니다.'));
  document.querySelectorAll('[data-likes-post]').forEach(button=>button.onclick=()=>{activeLikesPost=Number(button.dataset.likesPost);modal='likes';render();});
  document.querySelectorAll('[data-open-comments]').forEach(button=>button.onclick=()=>{activeCommentPost=Number(button.dataset.openComments);modal='comments';render();});
  document.querySelectorAll('[data-gallery-step]').forEach(button=>button.onclick=()=>{const postId=Number(button.dataset.galleryPost),post=state.posts.find(item=>Number(item.id)===postId),images=post?.images?.length?post.images:(post?.image?[post.image]:[]);if(!images.length)return;const index=(galleryIndexByPost.get(postId)||0)+Number(button.dataset.galleryStep);galleryIndexByPost.set(postId,(index+images.length)%images.length);render();});
  document.querySelector('#post-comment-form')?.addEventListener('submit',event=>{
    event.preventDefault();const text=event.currentTarget.querySelector('input').value.trim();
    if(text&&activeCommentPost)mutate(`/api/posts/${activeCommentPost}/comments`,{text},'댓글을 남겼습니다.');
  });
  document.querySelector('#story-comment')?.addEventListener('submit',submitStoryComment);
  document.querySelectorAll('[data-delete-post]').forEach(button=>button.onclick=async()=>{if(!confirm('이 게시물을 삭제할까요?'))return;await mutate(`/api/posts/${button.dataset.deletePost}`,{},'게시물을 삭제했습니다.','DELETE');});
  document.querySelectorAll('[data-chat]').forEach(button=>button.onclick=()=>{activeChat=button.dataset.chat;render();});
  document.querySelector('[data-invite-chat]')?.addEventListener('click',()=>{modal='invite';modalDraft={};render();});
  document.querySelector('[data-leave-chat]')?.addEventListener('click',leaveChat);
  document.querySelectorAll('[data-dm]').forEach(button=>button.onclick=async()=>{try{const result=await api('/api/chats',{method:'POST',body:JSON.stringify({members:[Number(button.dataset.dm)]})});activeChat=result.id;page='messages';modal=null;await refresh(false);render();}catch(error){toast(error.message);}});
  document.querySelectorAll('[data-bg]').forEach(button=>button.onclick=()=>saveBackground(button.dataset.bg));
  document.querySelector('#bg-upload')?.addEventListener('change',async event=>{if(event.target.files[0])await saveBackground(await imageData(event.target.files[0],1200));});
  document.querySelector('#create-form')?.addEventListener('submit',submitContent);
  document.querySelector('#create-form [name=image]')?.addEventListener('change',async event=>{
    const selected=[...event.target.files];if(!selected.length)return;
    if(modal==='post'&&selected.length>10){toast('사진은 한 번에 10장까지 선택할 수 있습니다.');event.target.value='';return;}
    try {
      const files=modal==='post'?selected:selected.slice(0,1),images=await Promise.all(files.map(file=>imageData(file,1400)));
      modalDraft.images=images;modalDraft.image=images[0]||'';
      document.querySelector('#file-preview').innerHTML=images.length?`<div class="preview-gallery">${images.map((image,index)=>`<img class="preview-image" src="${image}" alt="선택한 사진 ${index+1}">`).join('')}</div>`:'';
    } catch(error) { toast(error.message||'사진을 불러오지 못했습니다.'); }
  });
  document.querySelector('#profile-form')?.addEventListener('submit',saveProfile);
  document.querySelector('#profile-form [name=photo]')?.addEventListener('change',async event=>{if(event.target.files[0]){modalDraft.photo=await imageData(event.target.files[0],512);document.querySelector('#profile-preview').innerHTML=`<img class="preview-image avatar-preview" src="${modalDraft.photo}">`;}});
  document.querySelector('#chat-form')?.addEventListener('submit',createChat);
  document.querySelector('#invite-form')?.addEventListener('submit',inviteMembers);
  document.querySelector('#chat-send')?.addEventListener('submit',sendMessage);
  document.querySelector('#story-reply')?.addEventListener('submit',sendStoryReply);
  document.querySelector('[data-logout]')?.addEventListener('click',logout);
}
async function mutate(url,body,message,method='POST') { try { await api(url,{method,body:JSON.stringify(body)}); await refresh(false);render();toast(message); } catch(error) { toast(error.message); } }
async function submitContent(event) {
  event.preventDefault(); const form=event.currentTarget,fd=new FormData(form),kind=modal;
  try {
    await api(kind==='post'?'/api/posts':'/api/stories',{method:'POST',body:JSON.stringify(kind==='post'?{caption:fd.get('caption'),images:modalDraft.images||[]}:{caption:fd.get('caption'),emoji:fd.get('emoji'),image:modalDraft.image||''})});
    modal=null;modalDraft={};await refresh(false);render();toast(kind==='post'?'게시물과 스토리를 올렸습니다.':'스토리를 공유했습니다.');
  } catch(error) { toast(error.message); }
}
async function submitStoryComment(event) {
  event.preventDefault();
  const text=event.currentTarget.querySelector('input').value.trim();
  if(!text||!activeStory)return;
  const storyId=activeStory,resumeAfter=!storyPaused||storyPausedByInput;
  storyPausedByInput=false;
  if(!storyPaused)pauseStory(false);
  try {
    await api(`/api/stories/${storyId}/comments`,{method:'POST',body:JSON.stringify({text})});
    await refresh(false);render();
    if(resumeAfter&&storyPaused)resumeStory();
    toast('스토리에 댓글을 남겼습니다.');
  } catch(error) {
    if(resumeAfter&&storyPaused)resumeStory(false);
    toast(error.message);
  }
}
async function saveProfile(event) {
  event.preventDefault();const fd=new FormData(event.currentTarget);
  try {
    const result=await api('/api/profile',{method:'PATCH',body:JSON.stringify({name:fd.get('name'),handle:fd.get('handle'),bio:fd.get('bio'),photo:modalDraft.photo||'',background:me().background||''})});
    currentUser=result.user;modal=null;modalDraft={};await refresh(false);render();toast('프로필을 저장했습니다.');
  } catch(error) { toast(error.message); }
}
async function saveBackground(value) {
  try {
    const result=await api('/api/profile',{method:'PATCH',body:JSON.stringify({name:me().name,handle:me().handle,bio:me().bio,background:value,photo:''})});
    currentUser=result.user;await refresh(false);render();toast('배경을 저장했습니다.');
  } catch(error) { toast(error.message); }
}
async function createChat(event) {
  event.preventDefault();const fd=new FormData(event.currentTarget),members=fd.getAll('members').map(Number);
  try { const result=await api('/api/chats',{method:'POST',body:JSON.stringify({title:fd.get('title'),members})});activeChat=result.id;page='messages';modal=null;await refresh(false);render(); }
  catch(error) { toast(error.message); }
}
async function inviteMembers(event) {
  event.preventDefault();
  if(!activeChat)return;
  const members=new FormData(event.currentTarget).getAll('members').map(Number);
  if(!members.length){toast('초대할 사우를 선택해 주세요.');return;}
  try { await api(`/api/chats/${activeChat}/members`,{method:'POST',body:JSON.stringify({members})});modal=null;await refresh(false);render();toast('대화방에 초대했습니다.'); }
  catch(error) { toast(error.message); }
}
async function leaveChat() {
  if(!activeChat)return;
  if(!confirm('이 대화방에서 나갈까요? 나간 뒤에는 새 메시지를 볼 수 없습니다.'))return;
  const chatId=activeChat;
  try { await api(`/api/chats/${chatId}/members/me`,{method:'DELETE',body:'{}'});activeChat=null;await refresh(false);render();toast('대화방에서 나왔습니다.'); }
  catch(error) { toast(error.message); }
}
async function sendMessage(event) {
  event.preventDefault();const input=event.currentTarget.querySelector('input'),text=input.value.trim();if(!text||!activeChat)return;
  try { await api(`/api/chats/${activeChat}/messages`,{method:'POST',body:JSON.stringify({text})});await refresh(false);render();document.querySelector('#messages')?.scrollTo(0,999999); }
  catch(error) { toast(error.message); }
}
async function sendStoryReply(event) {
  event.preventDefault();const text=event.currentTarget.querySelector('input').value.trim();if(!text)return;
  try { const result=await api(`/api/stories/${activeStory}/reply`,{method:'POST',body:JSON.stringify({text})});clearTimeout(storyTimer);activeStory=null;storyQueue=[];storyUserQueues=[];storyUserIndex=0;page='messages';activeChat=result.chatId;await refresh(false);render();toast('스토리에 답장했습니다.'); }
  catch(error) { if(storyPaused)resumeStory(false);toast(error.message); }
}
async function logout() {
  try {
    const subscription=await pushRegistration?.pushManager.getSubscription();
    if(subscription){await api('/api/push/subscriptions',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe();}
  } catch {}
  try { await api('/api/auth/logout',{method:'POST',body:'{}'}); } catch {}
  currentUser=null;state=null;activeChat=null;clearInterval(pollTimer);authMode='login';renderAuth();
}
async function imageData(file,max=1200) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onerror=reject;
    reader.onload=()=>{const image=new Image();image.onerror=()=>reject(new Error('이미지를 읽을 수 없습니다.'));image.onload=()=>{let scale=Math.min(1,max/Math.max(image.width,image.height)),quality=.72,data='';const canvas=document.createElement('canvas'),context=canvas.getContext('2d');for(let attempt=0;attempt<6;attempt++){canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));context.drawImage(image,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/jpeg',quality);if(data.length<1_200_000)break;scale*=.78;quality=Math.max(.45,quality-.05);}resolve(data);};image.src=reader.result;};
    reader.readAsDataURL(file);
  });
}

document.addEventListener('pointerup',()=>{if(storyTouchPaused){storyIgnoreNextTap=Date.now()-storyTouchStartedAt>=250;storyTouchPaused=false;resumeStory(false);}});
document.addEventListener('pointercancel',()=>{if(storyTouchPaused){storyTouchPaused=false;resumeStory(false);}});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='open-notification')openNotification(Number(event.data.notificationId));
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(modal||activeStory)){modal=null;activeCommentPost=null;if(activeStory){clearTimeout(storyTimer);activeStory=null;storyQueue=[];storyUserQueues=[];storyUserIndex=0;storyPaused=false;storyPausedByInput=false;}render();}else if(activeStory&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&event.code==='Space'){event.preventDefault();storyPaused?resumeStory():pauseStory();}else if(activeStory&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&event.key==='ArrowRight')advanceStory();else if(activeStory&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&event.key==='ArrowLeft')previousStory();});
start();
