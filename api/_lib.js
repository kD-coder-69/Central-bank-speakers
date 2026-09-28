// Shared helpers for the Vercel functions (files starting with "_" are not routes).
const crypto = require('crypto');

const FEEDS = {
  today:    { short: 'https://itc-m.co/SpeakerPrev',  fallback: 'https://itc-m.objects.xtenit.com/itc/ITC-Speaker-Preview.pdf' },
  tomorrow: { short: 'https://itc-m.co/SpeakerPrev1', fallback: 'https://itc-m.objects.xtenit.com/itc/ITC-Speaker-Preview1.pdf' },
};
const UA = 'Mozilla/5.0 (CentralBankSpeakers dashboard)';

// Short links redirect to a CDN file cached for up to an hour, so resolve the
// redirect and add a cache-buster to always get the latest copy.
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
  const target = await resolveTarget(feed);
  const url = target + (target.includes('?') ? '&' : '?') + '_=' + Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Response was not a PDF');
  return {
    buf,
    hash: crypto.createHash('sha1').update(buf).digest('hex'),
    lastModified: r.headers.get('last-modified'),
    sourceUrl: target,
  };
}

module.exports = { FEEDS, fetchFeed };
