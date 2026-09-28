// Turns the ITC speaker-preview PDF into structured data (server side).
// Same logic as the dashboard page, so both always agree.

let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Loading the worker module first lets pdf.js run in-process on Node (no worker thread).
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      globalThis.pdfjsWorker = worker;
      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
  }
  return pdfjsPromise;
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function lineupDateKey(s) {
  const m = s && s.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  return mo ? (+m[3]) * 10000 + mo * 100 + (+m[1]) : null;
}

async function parseLineup(buf) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const H = pg.getViewport({ scale: 1 }).height;
    const tc = await pg.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      items.push({ x: it.transform[4], y: (p - 1) * 100000 + (H - it.transform[5]), s });
    }
  }
  await doc.destroy();

  items.sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y);
  const rows = [];
  for (const it of items) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.y - it.y) < 2) r.cells.push(it); else rows.push({ y: it.y, cells: [it] });
  }

  const DATE_RE = /^\d{1,2} [A-Z][a-z]{2}$/, TIME_RE = /^\d{1,2}:\d{2}$/, DAY_RE = /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/;
  let lineupDate = null; const speakers = []; let cur = null, curC = null;
  for (const r of rows) {
    const c = r.cells, txt = c.map(x => x.s).join(' ');
    if (!lineupDate && DAY_RE.test(txt) && /\d{4}/.test(txt)) { lineupDate = txt; continue; }
    if (/^NY UK Region Event$/.test(txt) || /^Date Prior Comments$/.test(txt) || txt === 'Central Bank Speakers') continue;
    if (c.length >= 3 && TIME_RE.test(c[0].s) && TIME_RE.test(c[1].s)) {
      const rest = c.slice(2); let region = '', ev;
      if (rest.length >= 2 && rest[0].x < 135) { region = rest[0].s; ev = rest.slice(1).map(x => x.s).join(' '); }
      else ev = rest.map(x => x.s).join(' ');
      cur = { ny: c[0].s, uk: c[1].s, region, raw: ev, comments: [] }; speakers.push(cur); curC = null; continue;
    }
    if (!cur) continue;
    for (const cell of c) {
      if (cell.x < 80 && DATE_RE.test(cell.s)) { curC = { date: cell.s, lines: [] }; cur.comments.push(curC); }
      else if (curC) curC.lines.push(cell.s);
    }
  }

  for (const sp of speakers) {
    const m = sp.raw.match(/^(.*?)\s*Speaker:\s*([^()]+?)\s*\(([^)]*)\)\s*(.*)$/);
    if (m) {
      sp.bank = m[1]; sp.name = m[2];
      const tags = m[3].split(',').map(s => s.trim());
      sp.voter = tags.includes('NV') ? 'Non-voter' : (tags.includes('V') ? 'Voter' : '');
      sp.bias = tags.filter(t => t !== 'NV' && t !== 'V').join(', ');
      sp.event = m[4];
    } else { sp.bank = ''; sp.name = ''; sp.bias = ''; sp.voter = ''; sp.event = sp.raw; }
    const tx = sp.raw.match(/Text (yes|no)/i), qa = sp.raw.match(/Q&A (yes|no)/i);
    sp.text = tx ? tx[1].toLowerCase() : null; sp.qa = qa ? qa[1].toLowerCase() : null;
    sp.event = sp.event.replace(/\s*Text (yes|no)[.,]?/i, '').replace(/\s*Q&A (yes|no)[.,]?/i, '').replace(/[\s,]+$/, '').trim();
    sp.comments = sp.comments.map(cm => ({ date: cm.date, text: cm.lines.reduce((a, l) => a ? (/[-‐]$/.test(a) ? a + l : a + ' ' + l) : l, '').trim() }));
  }
  return { lineupDate, dateKey: lineupDateKey(lineupDate), speakers };
}

module.exports = { parseLineup };
