const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const API_BASE = 'https://api.mail.tm';

// mail.tm API 프록시 (CORS 우회)
async function fetchApi(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

// 사용 가능한 도메인 목록
app.get('/api/domains', async (req, res) => {
  try {
    const result = await fetchApi(`${API_BASE}/domains`);
    const domains = result.data['hydra:member'].map(d => d.domain);
    res.json(domains);
  } catch (err) {
    res.status(500).json({ error: '도메인 목록을 가져올 수 없습니다.' });
  }
});

// 계정 생성 (메일 주소 생성)
app.post('/api/accounts', async (req, res) => {
  try {
    const { address, password } = req.body;
    const result = await fetchApi(`${API_BASE}/accounts`, {
      method: 'POST',
      body: JSON.stringify({ address, password }),
    });
    if (result.status >= 400) {
      return res.status(result.status).json(result.data);
    }
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: '계정을 생성할 수 없습니다.' });
  }
});

// 토큰 발급
app.post('/api/token', async (req, res) => {
  try {
    const { address, password } = req.body;
    const result = await fetchApi(`${API_BASE}/token`, {
      method: 'POST',
      body: JSON.stringify({ address, password }),
    });
    if (result.status >= 400) {
      return res.status(result.status).json(result.data);
    }
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: '토큰을 발급할 수 없습니다.' });
  }
});

// 받은 메일 목록
app.get('/api/messages', async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }
    const result = await fetchApi(`${API_BASE}/messages`, {
      headers: { Authorization: token },
    });
    if (result.status >= 400) {
      return res.status(result.status).json(result.data);
    }
    const messages = result.data['hydra:member'] || [];
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: '메일 목록을 가져올 수 없습니다.' });
  }
});

// 개별 메일 읽기
app.get('/api/messages/:id', async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }
    const result = await fetchApi(`${API_BASE}/messages/${req.params.id}`, {
      headers: { Authorization: token },
    });
    if (result.status >= 400) {
      return res.status(result.status).json(result.data);
    }
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: '메일을 읽을 수 없습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`임시메일 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
