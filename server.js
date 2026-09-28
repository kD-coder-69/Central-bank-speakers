// Central Bank Speakers – live lineup server
// Zero dependencies. Requires Node.js 18+ (built-in fetch).
// Run:  node server.js     then open http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;

const FEEDS = {
  today:    { short: 'https://itc-m.co/SpeakerPrev',  fallback: 'https://itc-m.objects.xtenit.com/itc/ITC-Speaker-Preview.pdf' },
  tomorrow: { short: 'https://itc-m.co/SpeakerPrev1', fallback: 'https://itc-m.objects.xtenit.com/itc/ITC-Speaker-Preview1.pdf' },
};

// Poll every 60s normally, every 15s around the 15:00 UK publish time.
const NORMAL_MS = 60 * 1000;
const FAST_MS = 15 * 1000;
const FAST_WINDOW = { from: 14 * 60 + 55, to: 15 * 60 + 30 }; // minutes after midnight, London time

const state = { today: null, tomorrow: null };
const UA = 'Mozilla/5.0 (CentralBankSpeakers dashboard)';

function londonMinutes(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour').value);
  const m = Number(parts.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

function stamp() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
}

// The short links redirect to a CDN object that is cached for up to an hour.
// Resolve the redirect ourselves, then add a cache-buster so we always get the latest file.
async function resolveTarget(feed) {
  try {
    const r = await fetch(feed.short, { redirect: 'manual', headers: { 'User-Agent': UA } });
    const loc = r.headers.get('location');
    if (loc) return new URL(loc, feed.short).toString();
  } catch (_) { /* fall back */ }
  return feed.fallback;
}

async function fetchFeed(key) {
  const feed = FEEDS[key];
  const prev = state[key];
  try {
    const target = await resolveTarget(feed);
    const url = target + (target.includes('?') ? '&' : '?') + '_=' + Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Response was not a PDF');
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    const now = new Date().toISOString();
    const changed = !prev || prev.hash !== hash;
    state[key] = {
      buf, hash, size: buf.length,
      sourceUrl: target,
      lastModified: r.headers.get('last-modified'),
      fetchedAt: now,
      changedAt: changed ? now : prev.changedAt,
      error: null,
    };
    if (changed) console.log(`[${stamp()}] ${key}: ${prev ? 'NEW VERSION' : 'loaded'} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(`[${stamp()}] ${key}: fetch failed – ${err.message}`);
    if (prev) { prev.error = err.message; prev.errorAt = new Date().toISOString(); }
    else state[key] = { error: err.message, errorAt: new Date().toISOString() };
  }
}

async function pollLoop() {
  await Promise.all(Object.keys(FEEDS).map(fetchFeed));
  const m = londonMinutes();
  const delay = m >= FAST_WINDOW.from && m <= FAST_WINDOW.to ? FAST_MS : NORMAL_MS;
  setTimeout(pollLoop, delay);
}

function statusJson() {
  const feeds = {};
  for (const k of Object.keys(FEEDS)) {
    const s = state[k] || {};
    feeds[k] = {
      ready: !!s.buf, hash: s.hash || null, size: s.size || null,
      lastModified: s.lastModified || null, fetchedAt: s.fetchedAt || null,
      changedAt: s.changedAt || null, error: s.error || null,
      sourceUrl: s.sourceUrl || FEEDS[k].fallback, shortUrl: FEEDS[k].short,
    };
  }
  return { serverTime: new Date().toISOString(), feeds };
}

const INDEX = path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const noStore = { 'Cache-Control': 'no-store, max-age=0' };

  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...noStore });
      res.end(data);
    });
    return;
  }

  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...noStore });
    return res.end(JSON.stringify(statusJson()));
  }

  const m = url.pathname.match(/^\/api\/feed\/(today|tomorrow)$/);
  if (m) {
    const s = state[m[1]];
    if (!s || !s.buf) { res.writeHead(503, noStore); return res.end('Feed not loaded yet'); }
    res.writeHead(200, { 'Content-Type': 'application/pdf', ETag: `"${s.hash}"`, ...noStore });
    return res.end(s.buf);
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nCentral Bank Speakers dashboard running`);
  console.log(`  This computer:  http://localhost:${PORT}`);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) console.log(`  On your network: http://${i.address}:${PORT}`);
  }
  console.log(`\nChecking feeds every 60s (every 15s between 14:55 and 15:30 UK time). Press Ctrl+C to stop.\n`);
  pollLoop();
});
