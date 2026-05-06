require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// DB初期化
// =============================================
let db;
(async () => {
  db = await open({ filename: './allergy_cache.db', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS shop_cache (
      place_id  TEXT PRIMARY KEY,
      name      TEXT,
      color     TEXT,
      comment   TEXT,
      links     TEXT,
      created_at INTEGER,
      allergens TEXT
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id   TEXT,
      place_name TEXT,
      reviewer   TEXT,
      body       TEXT,
      rating     INTEGER,
      created_at INTEGER
    );
  `);
  console.log('✅ DB ready');
})();

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

// =============================================
// キャッシュ取得（複数店を1リクエストで）
// =============================================
app.get('/api/cache', async (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (!ids.length) return res.json({});
  try {
    const rows = await db.all(
      `SELECT * FROM shop_cache WHERE place_id IN (${ids.map(()=>'?').join(',')}) AND created_at > ?`,
      [...ids, Date.now() - CACHE_TTL_MS]
    );
    const result = {};
    rows.forEach(r => {
      result[r.place_id] = {
        color: r.color, comment: r.comment,
        links: JSON.parse(r.links || '[]'),
        name: r.name, source: 'cache', _ts: r.created_at
      };
    });
    res.json(result);
  } catch(e) { res.json({}); }
});

// キャッシュ保存
app.post('/api/cache', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const stmt = await db.prepare(`
      INSERT INTO shop_cache (place_id,name,color,comment,links,created_at,allergens)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(place_id) DO UPDATE SET
        color=excluded.color, comment=excluded.comment,
        links=excluded.links, created_at=excluded.created_at, allergens=excluded.allergens
    `);
    for (const item of items) {
      await stmt.run(
        item.place_id, item.name, item.color, item.comment,
        JSON.stringify(item.links||[]), Date.now(), item.allergens||''
      );
    }
    await stmt.finalize();
    res.json({ saved: items.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// キャッシュ統計
app.get('/api/cache-stats', async (req, res) => {
  try {
    const total = (await db.get('SELECT COUNT(*) as n FROM shop_cache')).n;
    res.json({ total });
  } catch(e) { res.json({ total: 0 }); }
});

// =============================================
// 口コミ
// =============================================
app.get('/api/reviews', async (req, res) => {
  const { place_id } = req.query;
  try {
    const query = place_id && place_id !== 'all'
      ? `SELECT * FROM reviews WHERE place_id=? ORDER BY created_at DESC LIMIT 20`
      : `SELECT * FROM reviews ORDER BY created_at DESC LIMIT 100`;
    const rows = place_id && place_id !== 'all'
      ? await db.all(query, [place_id])
      : await db.all(query);
    res.json(rows);
  } catch(e) { res.json([]); }
});

app.post('/api/reviews', async (req, res) => {
  const { place_id, place_name, reviewer, body, rating } = req.body;
  if (!place_id || !body) return res.status(400).json({ error: 'place_id and body required' });
  try {
    await db.run(
      `INSERT INTO reviews (place_id,place_name,reviewer,body,rating,created_at) VALUES (?,?,?,?,?,?)`,
      [place_id, place_name||'', reviewer||'匿名', body, rating||5, Date.now()]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// =============================================
// URLバリデーション（CORS回避・HEADチェック）
// =============================================
app.post('/api/check-links', async (req, res) => {
  const { links } = req.body;
  if (!Array.isArray(links)) return res.json({ links: [] });
  const results = await Promise.all(links.map(async link => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(link.url, {
        method: 'HEAD', signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AllerSearch/1.0)', 'Accept': '*/*' },
        redirect: 'follow'
      });
      return r.status < 400 ? link : null;
    } catch(e) { return null; }
  }));
  res.json({ links: results.filter(Boolean) });
});

// =============================================
// Webページプロキシ（iframeでアレルギーページ表示）
// =============================================
app.get('/api/web-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).send('invalid url');
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!r.ok) return res.status(r.status).send(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || 'text/html';
    let body = await r.text();
    // 相対URLを絶対URLに変換
    const base = new URL(url);
    body = body.replace(/(href|src|action)=["'](?!https?:\/\/|\/\/|#|data:|javascript:)([^"']+)["']/gi,
      (m, attr, p) => { try { return `${attr}="${new URL(p, base).href}"`; } catch { return m; } }
    );
    body = body.replace(/<meta[^>]+x-frame-options[^>]*>/gi, '');
    res.set('Content-Type', ct);
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.send(body);
  } catch(e) { res.status(500).send(e.message); }
});

// =============================================
// PDFプロキシ（iframeでPDF表示）
// =============================================
app.get('/api/pdf-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).send('invalid url');
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AllerSearch/1.0)' }
    });
    if (!r.ok) return res.status(r.status).send('fetch failed');
    res.set('Content-Type', r.headers.get('content-type') || 'application/pdf');
    res.set('Content-Disposition', 'inline');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', '');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch(e) { res.status(500).send(e.message); }
});

// =============================================
// Gemini 2.5 Flash（メイン）
// =============================================
app.post('/api/gemini', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY未設定' });
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        })
      }
    );
    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Gemini ${r.status}`, detail: raw.slice(0,300) });
    res.status(200).send(raw);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// =============================================
// Claude（個別深掘り用）
// =============================================
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY未設定' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(req.body)
    });
    res.status(r.status).send(await r.text());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 管理用
app.get('/api/admin', async (req, res) => {
  try {
    const shops   = await db.all(`SELECT * FROM shop_cache ORDER BY created_at DESC`);
    const reviews = await db.all(`SELECT * FROM reviews ORDER BY created_at DESC`);
    res.json({ total_shops: shops.length, total_reviews: reviews.length, shops, reviews });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ping', (_, res) => res.json({ ok: true }));
app.listen(3000, () => {
  console.log('✅ AllerSearch http://localhost:3000');
  console.log('💡 AI調査回数リセット: http://localhost:3000/app.html?reset');
});