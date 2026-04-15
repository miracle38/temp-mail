// 상태
let currentEmail = null;   // { address, password, token }
let refreshTimer = null;
let countdown = 5;
let domains = [];
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
}

// 도메인 목록 로드
async function loadDomains() {
  try {
    const res = await fetch('/api/domains');
    domains = await res.json();
    domainSelect.innerHTML = '';
    domains.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      domainSelect.appendChild(opt);
    });
  } catch {
    showToast('도메인 목록을 불러오지 못했습니다');
  }
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

// 계정 생성 및 토큰 발급
async function createAccount(address) {
  const password = randomString(16);

  // 계정 생성
  const createRes = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!createRes.ok) {
    const err = await createRes.json();
    throw new Error(err['hydra:description'] || err.error || '계정 생성 실패');
  }

  // 토큰 발급
  const tokenRes = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!tokenRes.ok) {
    throw new Error('토큰 발급 실패');
  }
  const tokenData = await tokenRes.json();

  return { address, password, token: tokenData.token };
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
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const login = randomString(10);
    const address = `${login}@${domain}`;
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
    const res = await fetch('/api/messages', {
      headers: { Authorization: `Bearer ${currentEmail.token}` },
    });
    const messages = await res.json();
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
    const res = await fetch(`/api/messages/${id}`, {
      headers: { Authorization: `Bearer ${currentEmail.token}` },
    });
    const msg = await res.json();

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
