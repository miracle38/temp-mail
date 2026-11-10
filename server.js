const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 메일 API 범용 프록시 (/api/mt/* → api.mail.tm, /api/gw/* → api.mail.gw)
// mail.tm이 자사 도메인 외 Origin에는 CORS 헤더를 주지 않아 브라우저 직접 호출이 막히므로 서버에서 대신 호출.
// 첨부파일(바이너리)까지 그대로 전달하려고 express.json 보다 먼저, raw body로 받는다.
const PROXY_TARGETS = { mt: 'https://api.mail.tm', gw: 'https://api.mail.gw' };
app.all('/api/:provider(mt|gw)/*', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  const target = PROXY_TARGETS[req.params.provider] + req.originalUrl.replace(/^\/api\/(mt|gw)/, '');
  try {
    const headers = {};
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body && req.body.length;
    const upstream = await fetch(target, { method: req.method, headers, body: hasBody ? req.body : undefined });
    res.status(upstream.status);
    for (const h of ['content-type', 'content-disposition', 'retry-after']) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error(`[proxy] ${req.method} ${target}`, err);
    res.status(502).json({ error: '메일 서버에 연결할 수 없습니다.' });
  }
});

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
    console.error(`[fetchApi] non-JSON response from ${url}, status=${res.status}:`, text.slice(0, 300));
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
    console.error(err);
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
    console.error(err);
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
    console.error(err);
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
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: '메일을 읽을 수 없습니다.' });
  }
});

// 로컬 실행 시에만 서버를 띄움 (Vercel에서는 require로 app만 가져다 서버리스 함수로 감쌈)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`임시메일 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

module.exports = app;
