// GET /api/digest?type=morning|evening&key=YOUR_DIGEST_KEY
//   morning -> today's speakers with bias and their last 2 comments
//   evening -> tomorrow's speakers with bias and their last 2 comments
// Add &preview=1 to see the Teams card JSON without posting it.
//
// Vercel environment variables:
//   TEAMS_WEBHOOK_URL  – the URL from the Teams "Workflows" webhook
//   DIGEST_KEY         – any long random string; callers must pass it as ?key=
//   DASHBOARD_URL      – optional, link shown on the card (defaults to this site)

const { fetchFeed } = require('./_lib');
const { parseLineup } = require('./_parse');

const MAX_CARD_CHARS = 26000; // Teams rejects messages much above ~28 KB

function londonTodayKey() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return (+p.year) * 10000 + (+p.month) * 100 + (+p.day);
}

function tzParts(tz, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
const pad = n => String(n).padStart(2, '0');

// UK time on the lineup date -> IST ("+1" if it falls on the next day in India)
function ukToIst(dateKey, hhmm) {
  const y = Math.floor(dateKey / 10000), mo = Math.floor(dateKey / 100) % 100, d = dateKey % 100;
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const L = tzParts('Europe/London', new Date(guess));
  const offMin = (Date.UTC(L.y, L.mo - 1, L.d, L.h, L.mi) - guess) / 60000;
  const I = tzParts('Asia/Kolkata', new Date(guess - offMin * 60000));
  const next = I.y * 10000 + I.mo * 100 + I.d > dateKey ? ' +1' : '';
  return `${pad(I.h)}:${pad(I.mi)}${next}`;
}

function biasInfo(bias) {
  const l = (bias || '').toLowerCase();
  if (l.includes('hawk')) return { label: /slight|lean|mild/.test(l) ? bias : 'Hawk', color: 'Attention' };
  if (l.includes('dove')) return { label: /slight|lean|mild/.test(l) ? bias : 'Dove', color: 'Accent' };
  return { label: 'Neutral', color: 'Default' };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

function speakerBlock(sp, { withComments, commentChars, maxComments }, first) {
  const b = biasInfo(sp.bias);
  const extras = [sp.voter, sp.text ? `Text: ${sp.text}` : '', sp.qa ? `Q&A: ${sp.qa}` : ''].filter(Boolean).join(' · ');
  const details = [
    { type: 'TextBlock', text: `**${sp.bank ? sp.bank + ' · ' : ''}${sp.name || 'Speaker'}**`, wrap: true },
    { type: 'TextBlock', text: `${b.label}${extras ? '  ·  ' + extras : ''}`, color: b.color, weight: b.color === 'Default' ? 'Default' : 'Bolder', size: 'Small', spacing: 'None', wrap: true },
    { type: 'TextBlock', text: sp.event || '', wrap: true, spacing: 'Small' },
  ];
  if (withComments) {
    const cms = sp.comments.slice(0, maxComments);
    if (cms.length) {
      details.push({ type: 'TextBlock', text: 'Last comments', size: 'Small', isSubtle: true, weight: 'Bolder', spacing: 'Small' });
      for (const c of cms) details.push({ type: 'TextBlock', text: `**${c.date}:** ${clip(c.text, commentChars)}`, wrap: true, size: 'Small', spacing: 'None' });
    }
  }
  return {
    type: 'ColumnSet', separator: !first, spacing: first ? 'Medium' : 'Large',
    columns: [
      { type: 'Column', width: '70px', items: [
        { type: 'TextBlock', text: sp.uk, weight: 'Bolder', size: 'Large', spacing: 'None' },
        { type: 'TextBlock', text: 'UK', size: 'Small', isSubtle: true, spacing: 'None' },
        { type: 'TextBlock', text: `IST ${sp.ist}`, size: 'Small', isSubtle: true, spacing: 'Small' },
      ] },
      { type: 'Column', width: 'stretch', items: details },
    ],
  };
}

function buildCard({ title, data, note, dashboardUrl, opts }) {
  const body = [
    { type: 'TextBlock', text: title, size: 'Large', weight: 'Bolder', wrap: true },
    { type: 'TextBlock', text: `${data?.lineupDate || ''}${data ? `  ·  ${data.speakers.length} speaker${data.speakers.length === 1 ? '' : 's'}` : ''}`, isSubtle: true, spacing: 'None', wrap: true },
  ];
  if (note) body.push({ type: 'TextBlock', text: note, color: 'Warning', wrap: true });
  if (data && !data.speakers.length) body.push({ type: 'TextBlock', text: 'No central bank speakers scheduled.', wrap: true });
  if (data) data.speakers.forEach((sp, i) => body.push(speakerBlock(sp, opts, i === 0)));
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4', msteams: { width: 'Full' },
        body,
        actions: dashboardUrl ? [{ type: 'Action.OpenUrl', title: 'Open live dashboard', url: dashboardUrl }] : [],
      },
    }],
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = req.query.key || req.headers['x-digest-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.DIGEST_KEY || key !== process.env.DIGEST_KEY) return res.status(401).json({ error: 'Invalid or missing key' });

  const type = req.query.type === 'evening' ? 'evening' : 'morning';
  const preview = req.query.preview === '1';
  const dashboardUrl = process.env.DASHBOARD_URL || (req.headers.host ? `https://${req.headers.host}` : '');

  try {
    const today = londonTodayKey();
    const [tRaw, nRaw] = await Promise.all([fetchFeed('today'), fetchFeed('tomorrow')]);
    const [tData, nData] = await Promise.all([parseLineup(tRaw.buf), parseLineup(nRaw.buf)]);

    let data, note = '', title;
    if (type === 'morning') {
      title = "Today's Central Bank Speakers";
      data = tData;
      if (tData.dateKey !== today && nData.dateKey === today) data = nData;
      else if (tData.dateKey && tData.dateKey !== today) note = `The source still shows ${tData.lineupDate}; today's lineup may not be published yet.`;
    } else {
      title = "Tomorrow's Central Bank Speakers";
      data = nData;
      if (!nData.dateKey || nData.dateKey <= today || tRaw.hash === nRaw.hash) {
        note = "Tomorrow's lineup has not been published yet. Check the dashboard later.";
        data = null;
      }
    }

    if (data) for (const sp of data.speakers) sp.ist = ukToIst(data.dateKey || today, sp.uk);

    // Build the card, trimming comments if it gets too big for Teams.
    const attempts = [
      { withComments: true, maxComments: 2, commentChars: 450 },
      { withComments: true, maxComments: 2, commentChars: 220 },
      { withComments: true, maxComments: 1, commentChars: 160 },
      { withComments: false },
    ];
    let card;
    for (const opts of attempts) {
      card = buildCard({ title, data, note, dashboardUrl, opts });
      if (JSON.stringify(card).length <= MAX_CARD_CHARS) break;
    }

    if (preview) return res.status(200).json(card);

    const hook = process.env.TEAMS_WEBHOOK_URL;
    if (!hook) return res.status(500).json({ error: 'TEAMS_WEBHOOK_URL is not set' });
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Teams returned ${r.status}`, detail: text.slice(0, 500) });
    return res.status(200).json({ ok: true, type, lineupDate: data?.lineupDate || null, speakers: data?.speakers.length || 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
