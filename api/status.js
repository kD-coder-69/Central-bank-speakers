// GET /api/status – checks both feeds and returns a fingerprint of each.
// Vercel's edge cache shares the answer between viewers for 10 seconds.
const { FEEDS, fetchFeed } = require('./_lib');

module.exports = async (req, res) => {
  const now = new Date().toISOString();
  const feeds = {};
  await Promise.all(Object.keys(FEEDS).map(async key => {
    try {
      const f = await fetchFeed(key);
      feeds[key] = { ready: true, hash: f.hash, size: f.buf.length, lastModified: f.lastModified, fetchedAt: now, error: null, sourceUrl: f.sourceUrl, shortUrl: FEEDS[key].short };
    } catch (err) {
      feeds[key] = { ready: false, hash: null, fetchedAt: now, error: err.message, sourceUrl: FEEDS[key].fallback, shortUrl: FEEDS[key].short };
    }
  }));
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=5');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ serverTime: now, feeds }));
};
