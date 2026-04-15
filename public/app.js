// 멀티 API 지원 (mail.tm + mail.gw)
const API_PROVIDERS = [
  { name: 'mail.tm', base: 'https://api.mail.tm' },
  { name: 'mail.gw', base: 'https://api.mail.gw' },
];

// 상태
let currentEmail = null;   // { address, password, token, apiBase }
let refreshTimer = null;
let countdown = 5;
let domains = [];          // { domain, apiBase }[]
let knownIds = new Set();

// DOM 요소
const emailDisplay = document.getElementById('emailDisplay');
const generateBtn = document.getElementById('generateBtn');
const copyBtn = document.getElementById('copyBtn');
const customBtn = document.getElementById('customBtn');
const customSection = document.getElementById('customSection');
const customLogin = document.getElementById('customLogin');
const domainSelect = document.getElementById('domainSelect');
const customApplyBtn = document.getElementById('customApplyBtn');
const autoRefreshCheck = document.getElementById('autoRefresh');
const refreshBtn = document.getElementById('refreshBtn');
const timerSpan = document.getElementById('timer');
const inbox = document.getElementById('inbox');
const emptyState = document.getElementById('emptyState');
const mailCount = document.getElementById('mailCount');
const viewerSection = document.getElementById('viewerSection');
const viewerSubject = document.getElementById('viewerSubject');
const viewerFrom = document.getElementById('viewerFrom');
const viewerDate = document.getElementById('viewerDate');
const viewerBody = document.getElementById('viewerBody');
const viewerAttachments = document.getElementById('viewerAttachments');
const attachmentList = document.getElementById('attachmentList');
const backBtn = document.getElementById('backBtn');
const toast = document.getElementById('toast');

// localStorage 키
const STORAGE_KEY = 'tempmail_current';
const HISTORY_KEY = 'tempmail_history';

// Firebase 상태
let db = null;
let currentUser = null;
let fbSyncTimer = null;

// 인증 관련 DOM
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');
const userEmailSpan = document.getElementById('userEmail');
const loginModal = document.getElementById('loginModal');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const emailLoginBtn = document.getElementById('emailLoginBtn');
const googleLoginBtn = document.getElementById('googleLoginBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const syncStatus = document.getElementById('syncStatus');

// Firebase 초기화
try {
  db = firebase.database();
} catch (e) { console.error('Firebase 초기화 실패', e); }

// 세션 저장 (로컬 + Firebase)
function saveSession() {
  if (!currentEmail) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentEmail));
  // 히스토리에 추가/업데이트 (중복 방지, 최대 10개)
  const history = getHistory();
  const idx = history.findIndex(h => h.address === currentEmail.address);
  const entry = {
    address: currentEmail.address,
    password: currentEmail.password,
    apiBase: currentEmail.apiBase,
    retentionAt: currentEmail.retentionAt,
    createdAt: idx >= 0 ? history[idx].createdAt : new Date().toISOString(),
  };
  if (idx >= 0) {
    // 기존 항목: 같은 위치에서 업데이트 (넘버링 유지)
    history[idx] = entry;
  } else {
    // 새 항목: 맨 앞에 추가
    history.unshift(entry);
    if (history.length > 10) history.pop();
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
  // Firebase 동기화
  syncToFirebase();
}

// Firebase에 동기화
function syncToFirebase() {
  if (!currentUser || !db) return;
  clearTimeout(fbSyncTimer);
  fbSyncTimer = setTimeout(() => {
    const data = {
      current: currentEmail,
      history: getHistory(),
      updatedAt: Date.now(),
    };
    db.ref(`tempmail/${currentUser.uid}`).set(data).catch(err => {
      console.error('Firebase 저장 실패', err);
    });
  }, 500);
}

// Firebase에서 불러오기
async function loadFromFirebase() {
  if (!currentUser || !db) return null;
  try {
    const snap = await db.ref(`tempmail/${currentUser.uid}`).get();
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    console.error('Firebase 로드 실패', err);
    return null;
  }
}

// 세션 복원
function loadSession() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data);
  } catch { return null; }
}

// 히스토리 조회
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

// 저장된 세션으로 토큰 재발급 후 복원
async function restoreSession(saved) {
  try {
    // 이전 세션의 자동 새로고침 즉시 중단 (이전 계정 데이터로 덮어쓰기 방지)
    stopAutoRefresh();

    const tokenRes = await fetch(`${saved.apiBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: saved.address, password: saved.password }),
    });
    const tokenData = await safeJson(tokenRes);
    if (!tokenRes.ok || !tokenData?.token) return false;
    // 계정 정보 가져와서 retentionAt 업데이트
    const info = await fetchAccountInfo(saved.apiBase, tokenData.token);
    const retentionAt = computeRetentionAt(info) || saved.retentionAt || null;
    const account = { address: saved.address, password: saved.password, token: tokenData.token, apiBase: saved.apiBase, retentionAt };
    currentEmail = account;
    emailDisplay.innerHTML = `<span>${escapeHtml(account.address)}</span>`;
    copyBtn.disabled = false;
    refreshBtn.disabled = false;
    knownIds.clear();
    clearInbox();  // 이전 목록 비우고 로딩 상태로
    // 첫 fetch는 반드시 완료 후 자동 새로고침 시작 (경쟁 조건 방지)
    await fetchInbox();
    startAutoRefresh();
    updateRetentionDisplay();
    renderHistory();  // 활성 표시 갱신
    return true;
  } catch { return false; }
}

// 인증 이벤트 바인딩
function bindAuthEvents() {
  loginBtn.addEventListener('click', () => { loginModal.style.display = 'flex'; });
  closeModalBtn.addEventListener('click', () => { loginModal.style.display = 'none'; });
  logoutBtn.addEventListener('click', () => firebase.auth().signOut());
  emailLoginBtn.addEventListener('click', () => {
    const email = loginEmail.value.trim();
    const pw = loginPassword.value;
    if (!email) { showToast('이메일을 입력해주세요.', 'error'); loginEmail.focus(); return; }
    if (!pw) { showToast('비밀번호를 입력해주세요.', 'error'); loginPassword.focus(); return; }
    emailLoginBtn.disabled = true;
    const originalText = emailLoginBtn.textContent;
    emailLoginBtn.innerHTML = '<span class="loading"></span>로그인 중...';
    firebase.auth().signInWithEmailAndPassword(email, pw)
      .then(() => {
        loginModal.style.display = 'none';
        loginEmail.value = '';
        loginPassword.value = '';
        showToast('로그인되었습니다', 'success');
      })
      .catch(err => showToast(firebaseErrorMessage(err), 'error'))
      .finally(() => {
        emailLoginBtn.disabled = false;
        emailLoginBtn.textContent = originalText;
      });
  });
  googleLoginBtn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
      .then(() => {
        loginModal.style.display = 'none';
        showToast('로그인되었습니다', 'success');
      })
      .catch(err => {
        // 사용자가 팝업을 닫은 경우는 에러 표시하지 않음
        if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') return;
        showToast(firebaseErrorMessage(err), 'error');
      });
  });
}

// 인증 상태 변경 처리
let initialFirebaseSyncDone = false;

function handleAuthStateChange() {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user && ALLOWED_EMAILS.indexOf(user.email) === -1) {
      showToast(`접근 권한이 없는 계정입니다 (${user.email})`, 'error');
      // 권한 없는 계정은 즉시 로그아웃하고 데이터 접근 차단
      currentUser = null;
      try { await firebase.auth().signOut(); } catch {}
      return;
    }
    currentUser = user;
    if (user) {
      loginBtn.style.display = 'none';
      userInfo.style.display = 'flex';
      userEmailSpan.textContent = user.email;
      syncStatus.innerHTML = '<span class="sync-on">☁️ 클라우드 동기화 중</span>';
      // 최초 인증 시에만 원격 세션으로 자동 복원 (그 후에는 사용자가 선택한 세션 유지)
      if (!initialFirebaseSyncDone) {
        initialFirebaseSyncDone = true;
        await syncFromFirebase();
      }
    } else {
      initialFirebaseSyncDone = false;
      loginBtn.style.display = 'inline-block';
      userInfo.style.display = 'none';
      syncStatus.innerHTML = '<span class="sync-off">💾 로컬 저장소 사용 중 (로그인 시 동기화)</span>';
    }
  });
}

// Firebase 데이터와 로컬 데이터 병합
async function syncFromFirebase() {
  const remote = await loadFromFirebase();
  if (!remote) {
    // Firebase에 데이터가 없으면 로컬 데이터를 업로드
    syncToFirebase();
    return;
  }
  const localHistory = getHistory();
  const remoteHistory = remote.history || [];
  // 히스토리 병합 (주소 기준 중복 제거, 최신순)
  const merged = [...remoteHistory];
  localHistory.forEach(l => {
    if (!merged.find(r => r.address === l.address)) merged.push(l);
  });
  merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const finalHistory = merged.slice(0, 10);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(finalHistory));

  // 현재 세션: remote 우선 (최신 사용 기기의 것)
  const targetCurrent = remote.current || loadSession();
  if (targetCurrent && (!currentEmail || currentEmail.address !== targetCurrent.address)) {
    showToast('클라우드에서 세션을 복원하는 중...');
    const ok = await restoreSession(targetCurrent);
    if (!ok) showToast('클라우드 세션이 만료되어 있습니다');
  }
  renderHistory();
  // 병합 결과를 Firebase에 다시 저장
  syncToFirebase();
}

// 초기화
async function init() {
  // UI 이벤트는 가장 먼저 바인딩 (네트워크 오류와 무관하게 동작하도록)
  generateBtn.addEventListener('click', generateEmail);
  copyBtn.addEventListener('click', copyEmail);
  customBtn.addEventListener('click', toggleCustom);
  customApplyBtn.addEventListener('click', applyCustom);
  autoRefreshCheck.addEventListener('change', toggleAutoRefresh);
  refreshBtn.addEventListener('click', () => fetchInbox({ manual: true }));
  backBtn.addEventListener('click', closeViewer);
  bindAuthEvents();
  handleAuthStateChange();
  renderHistory();

  // 네트워크 의존 작업들
  try { await loadDomains(); } catch (e) { console.error(e); }

  // 저장된 세션 복원
  const saved = loadSession();
  if (saved) {
    showToast('이전 메일 세션을 복원하는 중...');
    try {
      const ok = await restoreSession(saved);
      if (ok) {
        showToast(`${saved.address} 세션이 복원되었습니다`);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        showToast('이전 세션이 만료되었습니다. 새 메일을 생성해주세요.');
      }
    } catch (e) { console.error(e); }
  }
}

// 도메인 목록 로드 (모든 API에서 수집)
async function loadDomains() {
  domains = [];
  const results = await Promise.allSettled(
    API_PROVIDERS.map(async (provider) => {
      const res = await fetch(`${provider.base}/domains`);
      const data = await res.json();
      return (data['hydra:member'] || []).map(d => ({
        domain: d.domain,
        apiBase: provider.base,
      }));
    })
  );
  results.forEach(r => {
    if (r.status === 'fulfilled') domains.push(...r.value);
  });
  if (domains.length === 0) {
    showToast('도메인 목록을 불러오지 못했습니다');
    return;
  }
  domainSelect.innerHTML = '';
  domains.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.domain;
    opt.textContent = d.domain;
    domainSelect.appendChild(opt);
  });
}

// 랜덤 문자열 생성 (crypto 기반 - 암호학적으로 안전)
function randomString(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars[arr[i] % chars.length];
  }
  return result;
}

// 도메인으로 API base URL 찾기
function getApiBase(domain) {
  const entry = domains.find(d => d.domain === domain);
  return entry ? entry.apiBase : API_PROVIDERS[0].base;
}

// 안전한 JSON 파싱
async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// 계정 정보 조회 (retentionAt 포함)
async function fetchAccountInfo(apiBase, token) {
  try {
    const res = await fetch(`${apiBase}/me`, { headers: { Authorization: `Bearer ${token}` } });
    return await safeJson(res);
  } catch { return null; }
}

// retention 날짜 계산 (응답에 없으면 createdAt + 7일로 추정)
function computeRetentionAt(info) {
  if (!info) return null;
  if (info.retentionAt) return info.retentionAt;
  if (info.createdAt) {
    const d = new Date(info.createdAt);
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  return null;
}

// 계정 생성 및 토큰 발급
async function createAccount(address) {
  const domain = address.split('@')[1];
  const apiBase = getApiBase(domain);
  const password = randomString(16);

  // 계정 생성
  const createRes = await fetch(`${apiBase}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!createRes.ok) {
    const err = await safeJson(createRes);
    throw new Error(err?.['hydra:description'] || err?.detail || '계정 생성 실패');
  }
  const createData = await safeJson(createRes);

  // 토큰 발급
  const tokenRes = await fetch(`${apiBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  const tokenData = await safeJson(tokenRes);
  if (!tokenRes.ok || !tokenData?.token) {
    throw new Error('토큰 발급 실패');
  }

  const retentionAt = computeRetentionAt(createData);
  return { address, password, token: tokenData.token, apiBase, retentionAt };
}

// 랜덤 메일 생성
async function generateEmail() {
  if (domains.length === 0) {
    showToast('도메인 목록을 불러오지 못했습니다. 네트워크를 확인 후 페이지를 새로고침 해주세요.', 'error');
    return;
  }
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<span class="loading"></span>생성 중...';
  try {
    const entry = domains[Math.floor(Math.random() * domains.length)];
    const login = randomString(10);
    const address = `${login}@${entry.domain}`;
    const account = await createAccount(address);
    setEmail(account);
    showToast('새 임시 메일이 생성되었습니다', 'success');
  } catch (err) {
    showToast(mailApiErrorMessage(err), 'error');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = '새 메일 생성';
  }
}

// 이메일 설정
function setEmail(account) {
  currentEmail = account;
  emailDisplay.innerHTML = `<span>${escapeHtml(account.address)}</span>`;
  copyBtn.disabled = false;
  refreshBtn.disabled = false;
  knownIds.clear();
  clearInbox();
  fetchInbox();
  startAutoRefresh();
  saveSession();
  updateRetentionDisplay();
}

// 남은 기간 표시
function updateRetentionDisplay() {
  const el = document.getElementById('retentionInfo');
  if (!el) return;
  if (!currentEmail || !currentEmail.retentionAt) {
    el.textContent = '';
    return;
  }
  const now = new Date();
  const expiry = new Date(currentEmail.retentionAt);
  const diff = expiry - now;
  if (diff <= 0) {
    el.innerHTML = '<span class="retention-expired">만료됨</span>';
    return;
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  let remaining;
  if (days > 0) remaining = `${days}일 ${hours}시간 남음`;
  else if (hours > 0) remaining = `${hours}시간 ${minutes}분 남음`;
  else remaining = `${minutes}분 남음`;
  const expiryStr = formatDate(expiry.toISOString());
  el.innerHTML = `<span class="retention-label">삭제 예정:</span> <span class="retention-remaining">${remaining}</span> <span class="retention-date">(${expiryStr})</span>`;
}

// 클립보드 복사
async function copyEmail() {
  if (!currentEmail) return;
  try {
    await navigator.clipboard.writeText(currentEmail.address);
    showToast('메일 주소가 복사되었습니다');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = currentEmail.address;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('메일 주소가 복사되었습니다');
  }
}

// 커스텀 입력 토글
function toggleCustom() {
  const visible = customSection.style.display !== 'none';
  customSection.style.display = visible ? 'none' : 'flex';
  if (!visible) customLogin.focus();
}

// 커스텀 메일 적용
async function applyCustom() {
  const login = customLogin.value.trim();
  const domain = domainSelect.value;
  if (!login) {
    showToast('아이디를 입력해주세요', 'error');
    customLogin.focus();
    return;
  }
  if (login.length < 3) {
    showToast('아이디는 3자 이상 입력해주세요', 'error');
    customLogin.focus();
    return;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(login)) {
    showToast('아이디는 영문, 숫자, . _ - 만 사용 가능합니다', 'error');
    customLogin.focus();
    return;
  }
  if (!domain) {
    showToast('도메인을 선택해주세요', 'error');
    return;
  }
  customApplyBtn.disabled = true;
  customApplyBtn.textContent = '생성 중...';
  try {
    const address = `${login}@${domain}`;
    const account = await createAccount(address);
    setEmail(account);
    customSection.style.display = 'none';
    customLogin.value = '';
    showToast('커스텀 메일 주소가 설정되었습니다', 'success');
  } catch (err) {
    showToast(mailApiErrorMessage(err), 'error');
  } finally {
    customApplyBtn.disabled = false;
    customApplyBtn.textContent = '사용하기';
  }
}

// 토큰 재발급
async function refreshToken() {
  if (!currentEmail) return false;
  try {
    const res = await fetch(`${currentEmail.apiBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: currentEmail.address, password: currentEmail.password }),
    });
    const data = await safeJson(res);
    if (!res.ok || !data?.token) return false;
    currentEmail.token = data.token;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentEmail));
    return true;
  } catch { return false; }
}

// 재시도 + 토큰 자동 재발급 + Rate limit 대응
async function apiFetch(url, options = {}, { maxRetries = 2, silentOn429 = false } = {}) {
  if (!currentEmail) return null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${currentEmail.token}`,
          ...(options.headers || {}),
        },
      });
      // 401: 토큰 만료 → 재발급 후 재시도
      if (res.status === 401 && attempt < maxRetries) {
        const ok = await refreshToken();
        if (ok) continue;
        return { error: 'unauthorized', status: 401 };
      }
      // 429: Rate limit → 백오프 후 재시도
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      if (!res.ok) {
        return { error: 'http', status: res.status };
      }
      const data = await safeJson(res);
      return { data, status: res.status };
    } catch (err) {
      // 네트워크 오류 → 재시도
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return { error: 'network', message: err.message };
    }
  }
  return { error: 'unknown' };
}

// 받은 메일 가져오기
async function fetchInbox({ manual = false } = {}) {
  if (!currentEmail) return;
  const result = await apiFetch(`${currentEmail.apiBase}/messages`);
  if (!result) return;
  if (result.error) {
    // 에러 처리
    if (manual) {
      // 수동 새로고침일 때만 사용자에게 알림
      if (result.error === 'unauthorized') {
        showToast('세션이 만료되어 재로그인이 필요합니다', 'error');
      } else if (result.error === 'network') {
        showToast('네트워크 오류: 연결을 확인해주세요', 'error');
      } else if (result.status === 429) {
        showToast('요청이 너무 많습니다. 잠시 후 다시 시도해주세요', 'error');
      } else {
        showToast(`메일 목록을 불러오지 못했습니다 (오류 ${result.status || ''})`, 'error');
      }
    }
    return;
  }
  const data = result.data;
  if (!data) return;
  const messages = data['hydra:member'] || [];
  if (!Array.isArray(messages)) return;

  // 새 메일 알림
  if (knownIds.size > 0) {
    const newMails = messages.filter(m => !knownIds.has(m.id));
    if (newMails.length > 0) {
      showToast(`새 메일 ${newMails.length}통이 도착했습니다!`, 'info');
    }
  }

  messages.forEach(m => knownIds.add(m.id));
  renderInbox(messages);
}

// 메일 목록 렌더링
function renderInbox(messages) {
  const unreadCount = messages.filter(m => !m.seen).length;
  // 배지에 "안읽음/전체" 표시
  if (unreadCount > 0) {
    mailCount.innerHTML = `<span class="unread-count">${unreadCount}</span> / ${messages.length}`;
  } else {
    mailCount.textContent = messages.length;
  }
  if (messages.length === 0) {
    emptyState.style.display = 'block';
    inbox.querySelectorAll('.mail-item').forEach(el => el.remove());
    return;
  }
  emptyState.style.display = 'none';
  inbox.querySelectorAll('.mail-item').forEach(el => el.remove());

  messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  messages.forEach(msg => {
    const item = document.createElement('div');
    const isUnread = !msg.seen;
    item.className = 'mail-item' + (isUnread ? ' unread' : ' read');
    item.onclick = () => readMessage(msg.id, item);

    const fromAddr = msg.from?.address || msg.from?.name || '?';
    const initial = fromAddr[0].toUpperCase();
    item.innerHTML = `
      <div class="mail-indicator" title="${isUnread ? '읽지 않음' : '읽음'}"></div>
      <div class="mail-avatar">${initial}</div>
      <div class="mail-content">
        <div class="mail-from">${escapeHtml(fromAddr)}</div>
        <div class="mail-subject">${escapeHtml(msg.subject || '(제목 없음)')}</div>
      </div>
      <div class="mail-date">${formatDate(msg.createdAt)}</div>
    `;
    inbox.appendChild(item);
  });
}

// 메일 읽음 처리 (서버 + UI)
async function markAsRead(id, itemEl) {
  if (itemEl && itemEl.classList.contains('unread')) {
    itemEl.classList.remove('unread');
    itemEl.classList.add('read');
    // 배지 카운트 갱신
    const unreadEls = inbox.querySelectorAll('.mail-item.unread');
    const totalEls = inbox.querySelectorAll('.mail-item');
    if (unreadEls.length > 0) {
      mailCount.innerHTML = `<span class="unread-count">${unreadEls.length}</span> / ${totalEls.length}`;
    } else {
      mailCount.textContent = totalEls.length;
    }
  }
  await apiFetch(`${currentEmail.apiBase}/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify({ seen: true }),
  });
}

// 메일 읽기
async function readMessage(id, itemEl) {
  try {
    const result = await apiFetch(`${currentEmail.apiBase}/messages/${id}`);
    if (!result || result.error) {
      if (result?.error === 'unauthorized') {
        showToast('세션이 만료되어 재로그인이 필요합니다', 'error');
      } else if (result?.error === 'network') {
        showToast('네트워크 오류: 연결을 확인해주세요', 'error');
      } else if (result?.status === 404) {
        showToast('메일이 삭제되었거나 존재하지 않습니다', 'error');
      } else {
        showToast(`메일을 불러오지 못했습니다 (오류 ${result?.status || ''})`, 'error');
      }
      return;
    }
    const msg = result.data;
    if (!msg) { showToast('메일을 불러오지 못했습니다', 'error'); return; }

    // 읽음 처리
    markAsRead(id, itemEl);

    viewerSubject.textContent = msg.subject || '(제목 없음)';
    viewerFrom.textContent = msg.from?.address || msg.from?.name || '';
    viewerDate.textContent = formatDate(msg.createdAt);

    // HTML 본문은 샌드박스 iframe으로 격리 (XSS 방어)
    viewerBody.innerHTML = '';
    if (msg.html && msg.html.length > 0) {
      const iframe = document.createElement('iframe');
      // sandbox=""로 모든 권한 차단: script 실행, form 제출, popup, top 이동 모두 금지
      // (이미지/CSS는 정상 렌더링됨)
      iframe.setAttribute('sandbox', '');
      iframe.srcdoc = msg.html.join('');
      iframe.className = 'mail-html-frame';
      viewerBody.appendChild(iframe);
    } else if (msg.text) {
      viewerBody.textContent = msg.text;
    } else {
      viewerBody.textContent = '(본문 없음)';
    }

    // 첨부파일
    if (msg.attachments && msg.attachments.length > 0) {
      viewerAttachments.style.display = 'block';
      attachmentList.innerHTML = '';
      msg.attachments.forEach(att => {
        const li = document.createElement('li');
        const fileIcon = getFileIcon(att.filename, att.contentType);
        li.innerHTML = `
          <button class="attachment-btn" data-id="${att.id}" data-filename="${escapeHtml(att.filename)}" data-url="${att.downloadUrl}">
            <span class="attachment-icon">${fileIcon}</span>
            <span class="attachment-name">${escapeHtml(att.filename)}</span>
            <span class="attachment-size">${formatSize(att.size)}</span>
            <span class="attachment-download">⬇</span>
          </button>
        `;
        const btn = li.querySelector('.attachment-btn');
        btn.addEventListener('click', () => downloadAttachment(msg.id, att));
        attachmentList.appendChild(li);
      });
    } else {
      viewerAttachments.style.display = 'none';
    }

    // 사이드바 레이아웃: 뷰어 표시 시 목록 숨김
    inbox.style.display = 'none';
    viewerSection.style.display = 'flex';
  } catch {
    showToast('메일을 불러오지 못했습니다');
  }
}

// 뷰어 닫기 (목록으로 복귀)
function closeViewer() {
  viewerSection.style.display = 'none';
  inbox.style.display = 'block';
}

// 자동 새로고침
function startAutoRefresh() {
  stopAutoRefresh();
  if (!autoRefreshCheck.checked || !currentEmail) return;
  countdown = 5;
  timerSpan.textContent = `${countdown}초 후 새로고침`;
  refreshTimer = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      fetchInbox();
      countdown = 5;
    }
    timerSpan.textContent = `${countdown}초 후 새로고침`;
    updateRetentionDisplay();
  }, 1000);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  timerSpan.textContent = '';
}

function toggleAutoRefresh() {
  if (autoRefreshCheck.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

// 히스토리 렌더링
function renderHistory() {
  const section = document.getElementById('historySection');
  const list = document.getElementById('historyList');
  const history = getHistory();
  if (history.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = '';
  history.forEach((h, index) => {
    const isActive = currentEmail && currentEmail.address === h.address;
    const item = document.createElement('div');
    item.className = 'history-item' + (isActive ? ' active' : '');
    item.innerHTML = `
      <span class="history-num">${index + 1}</span>
      <span class="history-addr">${escapeHtml(h.address)}</span>
      <span class="history-date">${formatDate(h.createdAt)}</span>
      <button class="btn btn-outline btn-sm history-switch" ${isActive ? 'disabled' : ''}>${isActive ? '사용 중' : '전환'}</button>
      <button class="btn btn-danger btn-sm history-delete" title="삭제">✕</button>
    `;
    if (!isActive) {
      item.querySelector('.history-switch').onclick = async (e) => {
        e.stopPropagation();
        showToast('세션 전환 중...');
        const ok = await restoreSession(h);
        if (ok) {
          saveSession();
          showToast(`${h.address}로 전환되었습니다`);
        } else {
          showToast('세션이 만료되었습니다. 새 메일을 생성해주세요.');
          // 만료된 항목 제거
          const updated = getHistory().filter(x => x.address !== h.address);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
          renderHistory();
          syncToFirebase();
        }
      };
    }
    item.querySelector('.history-delete').onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`${h.address}를 목록에서 삭제할까요?`)) return;
      // 현재 사용 중인 메일이면 현재 세션도 해제
      if (isActive) {
        currentEmail = null;
        localStorage.removeItem(STORAGE_KEY);
        emailDisplay.innerHTML = '<span class="placeholder">메일 주소를 생성하세요</span>';
        copyBtn.disabled = true;
        refreshBtn.disabled = true;
        clearInbox();
        stopAutoRefresh();
        updateRetentionDisplay();
      }
      const updated = getHistory().filter(x => x.address !== h.address);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      renderHistory();
      syncToFirebase();
      showToast('삭제되었습니다');
    };
    list.appendChild(item);
  });
}

// 받은 메일함 초기화
function clearInbox() {
  inbox.querySelectorAll('.mail-item').forEach(el => el.remove());
  emptyState.style.display = 'block';
  mailCount.textContent = '0';
  viewerSection.style.display = 'none';
  inbox.style.display = 'block';
}

// 유틸: HTML 이스케이프
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 유틸: 날짜 포맷
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

// 파일 확장자/타입에 따른 아이콘
function getFileIcon(filename, contentType) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const ct = (contentType || '').toLowerCase();
  if (ct.startsWith('image/') || /^(png|jpe?g|gif|bmp|webp|svg)$/.test(ext)) return '🖼️';
  if (ct.startsWith('video/') || /^(mp4|mov|avi|mkv|webm)$/.test(ext)) return '🎬';
  if (ct.startsWith('audio/') || /^(mp3|wav|flac|ogg|m4a)$/.test(ext)) return '🎵';
  if (ct === 'application/pdf' || ext === 'pdf') return '📕';
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return '🗜️';
  if (/^(doc|docx)$/.test(ext)) return '📘';
  if (/^(xls|xlsx|csv)$/.test(ext)) return '📗';
  if (/^(ppt|pptx)$/.test(ext)) return '📙';
  if (/^(txt|md|log)$/.test(ext)) return '📄';
  if (/^(js|ts|py|java|c|cpp|cs|go|rs|rb|html|css|json|xml)$/.test(ext)) return '📃';
  return '📎';
}

// 첨부파일 다운로드 (인증 토큰 필요하므로 blob으로 받아서 저장)
async function downloadAttachment(msgId, att) {
  if (!currentEmail) return;
  showToast(`${att.filename} 다운로드 중...`, 'info');
  // downloadUrl이 상대경로면 apiBase 붙임
  let url = att.downloadUrl || `/messages/${msgId}/attachment/${att.id}`;
  if (!/^https?:\/\//.test(url)) {
    url = currentEmail.apiBase + (url.startsWith('/') ? url : '/' + url);
  }
  try {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${currentEmail.token}` } });
    // 401: 토큰 재발급 후 재시도
    if (res.status === 401) {
      const ok = await refreshToken();
      if (ok) {
        res = await fetch(url, { headers: { Authorization: `Bearer ${currentEmail.token}` } });
      }
    }
    if (!res.ok) {
      showToast(`첨부파일을 다운로드할 수 없습니다 (오류 ${res.status})`, 'error');
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = att.filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    showToast(`${att.filename} 다운로드 완료`, 'success');
  } catch (err) {
    showToast('다운로드 실패: ' + (err.message || '네트워크 오류'), 'error');
  }
}

// 유틸: 파일 크기 포맷
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// 유틸: 토스트 알림 (type: 'info' | 'success' | 'error')
function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = 'toast show toast-' + type;
  const duration = type === 'error' ? 4500 : 2500;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// Firebase 인증 에러 → 친절한 한국어 메시지
function firebaseErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': '올바른 이메일 형식이 아닙니다.',
    'auth/user-not-found': '등록되지 않은 계정입니다.',
    'auth/wrong-password': '비밀번호가 일치하지 않습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/invalid-login-credentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/missing-password': '비밀번호를 입력해주세요.',
    'auth/too-many-requests': '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    'auth/user-disabled': '비활성화된 계정입니다. 관리자에게 문의하세요.',
    'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
    'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.',
    'auth/popup-blocked': '팝업이 차단되었습니다. 브라우저 설정을 확인해주세요.',
    'auth/cancelled-popup-request': '이전 로그인 요청이 취소되었습니다.',
    'auth/unauthorized-domain': '이 도메인에서는 로그인이 허용되지 않습니다.',
  };
  return map[code] || (err?.message ? `로그인 실패: ${err.message}` : '로그인에 실패했습니다.');
}

// mail.tm/mail.gw 에러 → 친절한 한국어 메시지
function mailApiErrorMessage(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('address') && msg.includes('already')) return '이미 사용 중인 이메일 주소입니다. 다른 아이디를 시도해주세요.';
  if (msg.includes('invalid email')) return '유효하지 않은 이메일 형식입니다.';
  if (msg.includes('domain') && msg.includes('not valid')) return '선택한 도메인을 사용할 수 없습니다. 다시 시도해주세요.';
  if (msg.includes('password') && msg.includes('short')) return '비밀번호가 너무 짧습니다.';
  if (msg.includes('rate') || msg.includes('too many')) return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  if (msg.includes('network') || msg.includes('failed to fetch')) return '네트워크 연결을 확인해주세요.';
  if (msg.includes('토큰')) return '인증 토큰 발급에 실패했습니다. 잠시 후 다시 시도해주세요.';
  return err?.message ? `메일 생성 실패: ${err.message}` : '메일 생성에 실패했습니다.';
}

// 시작
init();
