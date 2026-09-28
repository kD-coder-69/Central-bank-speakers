// GET /api/feed/today  or  /api/feed/tomorrow  – returns the latest PDF.
// The page adds ?h=<hash>, so each version gets its own cache entry.
const { FEEDS, fetchFeed } = require('../_lib');

module.exports = async (req, res) => {
  const key = req.query.key;
  if (!FEEDS[key]) return res.status(404).send('Unknown feed');
  try {
    const f = await fetchFeed(key);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('ETag', `"${f.hash}"`);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
    res.status(200).send(f.buf);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Could not fetch feed: ' + err.message);
  }
};
