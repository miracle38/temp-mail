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

// 세션 저장
function saveSession() {
  if (!currentEmail) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentEmail));
  // 히스토리에 추가 (중복 방지, 최대 10개)
  const history = getHistory();
  if (!history.find(h => h.address === currentEmail.address)) {
    history.unshift({ address: currentEmail.address, password: currentEmail.password, apiBase: currentEmail.apiBase, createdAt: new Date().toISOString() });
    if (history.length > 10) history.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }
  renderHistory();
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
    const tokenRes = await fetch(`${saved.apiBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: saved.address, password: saved.password }),
    });
    const tokenData = await safeJson(tokenRes);
    if (!tokenRes.ok || !tokenData?.token) return false;
    const account = { address: saved.address, password: saved.password, token: tokenData.token, apiBase: saved.apiBase };
    currentEmail = account;
    emailDisplay.innerHTML = `<span>${escapeHtml(account.address)}</span>`;
    copyBtn.disabled = false;
    refreshBtn.disabled = false;
    knownIds.clear();
    fetchInbox();
    startAutoRefresh();
    return true;
  } catch { return false; }
}

// 초기화
async function init() {
  await loadDomains();
  generateBtn.addEventListener('click', generateEmail);
  copyBtn.addEventListener('click', copyEmail);
  customBtn.addEventListener('click', toggleCustom);
  customApplyBtn.addEventListener('click', applyCustom);
  autoRefreshCheck.addEventListener('change', toggleAutoRefresh);
  refreshBtn.addEventListener('click', fetchInbox);
  backBtn.addEventListener('click', closeViewer);

  // 저장된 세션 복원
  const saved = loadSession();
  if (saved) {
    showToast('이전 메일 세션을 복원하는 중...');
    const ok = await restoreSession(saved);
    if (ok) {
      showToast(`${saved.address} 세션이 복원되었습니다`);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      showToast('이전 세션이 만료되었습니다. 새 메일을 생성해주세요.');
    }
  }
  renderHistory();
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

// 랜덤 문자열 생성
function randomString(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
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

  return { address, password, token: tokenData.token, apiBase };
}

// 랜덤 메일 생성
async function generateEmail() {
  if (domains.length === 0) {
    showToast('도메인 목록을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
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
    showToast('새 임시 메일이 생성되었습니다');
  } catch (err) {
    showToast('메일 생성에 실패했습니다: ' + err.message);
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
    showToast('아이디를 입력해주세요');
    customLogin.focus();
    return;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(login)) {
    showToast('아이디는 영문, 숫자, ., _, - 만 사용 가능합니다');
    return;
  }
  customApplyBtn.disabled = true;
  customApplyBtn.textContent = '생성 중...';
  try {
    const address = `${login}@${domain}`;
    const account = await createAccount(address);
    setEmail(account);
    customSection.style.display = 'none';
    showToast('커스텀 메일 주소가 설정되었습니다');
  } catch (err) {
    showToast('설정 실패: ' + err.message);
  } finally {
    customApplyBtn.disabled = false;
    customApplyBtn.textContent = '사용하기';
  }
}

// 받은 메일 가져오기
async function fetchInbox() {
  if (!currentEmail) return;
  try {
    const res = await fetch(`${currentEmail.apiBase}/messages`, {
      headers: { Authorization: `Bearer ${currentEmail.token}` },
    });
    const data = await safeJson(res);
    if (!data) return;
    const messages = data['hydra:member'] || [];
    if (!Array.isArray(messages)) return;

    // 새 메일 알림
    if (knownIds.size > 0) {
      const newMails = messages.filter(m => !knownIds.has(m.id));
      if (newMails.length > 0) {
        showToast(`새 메일 ${newMails.length}통이 도착했습니다!`);
      }
    }

    messages.forEach(m => knownIds.add(m.id));
    renderInbox(messages);
  } catch {
    // 자동 새로고침 중 에러는 무시
  }
}

// 메일 목록 렌더링
function renderInbox(messages) {
  mailCount.textContent = messages.length;
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
    item.className = 'mail-item';
    item.onclick = () => readMessage(msg.id);

    const fromAddr = msg.from?.address || msg.from?.name || '?';
    const initial = fromAddr[0].toUpperCase();
    item.innerHTML = `
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

// 메일 읽기
async function readMessage(id) {
  try {
    const res = await fetch(`${currentEmail.apiBase}/messages/${id}`, {
      headers: { Authorization: `Bearer ${currentEmail.token}` },
    });
    const msg = await safeJson(res);
    if (!msg) { showToast('메일을 불러오지 못했습니다'); return; }

    viewerSubject.textContent = msg.subject || '(제목 없음)';
    viewerFrom.textContent = msg.from?.address || msg.from?.name || '';
    viewerDate.textContent = formatDate(msg.createdAt);

    // HTML 본문 우선, 없으면 텍스트
    if (msg.html && msg.html.length > 0) {
      viewerBody.innerHTML = msg.html.join('');
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
        li.innerHTML = `<a href="${att.downloadUrl}" target="_blank" rel="noopener">${escapeHtml(att.filename)} (${formatSize(att.size)})</a>`;
        attachmentList.appendChild(li);
      });
    } else {
      viewerAttachments.style.display = 'none';
    }

    viewerSection.style.display = 'block';
    viewerSection.scrollIntoView({ behavior: 'smooth' });
  } catch {
    showToast('메일을 불러오지 못했습니다');
  }
}

// 뷰어 닫기
function closeViewer() {
  viewerSection.style.display = 'none';
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
  history.forEach(h => {
    const isActive = currentEmail && currentEmail.address === h.address;
    const item = document.createElement('div');
    item.className = 'history-item' + (isActive ? ' active' : '');
    item.innerHTML = `
      <span class="history-addr">${escapeHtml(h.address)}</span>
      <span class="history-date">${formatDate(h.createdAt)}</span>
      <button class="btn btn-outline btn-sm" ${isActive ? 'disabled' : ''}>${isActive ? '사용 중' : '전환'}</button>
    `;
    if (!isActive) {
      item.querySelector('button').onclick = async (e) => {
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
        }
      };
    }
    list.appendChild(item);
  });
}

// 받은 메일함 초기화
function clearInbox() {
  inbox.querySelectorAll('.mail-item').forEach(el => el.remove());
  emptyState.style.display = 'block';
  mailCount.textContent = '0';
  viewerSection.style.display = 'none';
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
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 유틸: 파일 크기 포맷
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// 유틸: 토스트 알림
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// 시작
init();
