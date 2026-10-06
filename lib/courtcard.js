// People's Court ki share-card (1200x630). Emoji PNG mein nahi (font mein nahi hote), sirf text.
const card = require('./card');

const INK = '#0f172a', BRASS = '#d9b45a';
const SIDE = { a: { panel: '#0f3d4a', accent: '#35d0c0' }, b: { panel: '#4a1d2c', accent: '#ff7a7a' } };

function panel(side, x, c, lawyer, shown, win) {
  const { wrap, esc } = card;
  const S = SIDE[side];
  const W = 500, Y = 196, H = 330;
  const label = wrap(side === 'a' ? c.side_a : c.side_b, 34, W - 56, 2);
  const labelSvg = label.map((l, i) => `<text x="${x + 28}" y="${Y + 58 + i * 40}" font-size="34" fill="#fff">${esc(l)}</text>`).join('');
  const who = lawyer ? `Lawyer: ${lawyer.username}` : 'Seat open - be the lawyer';
  const whoLines = wrap(who, 22, W - 56, 1);
  const tag = lawyer ? wrap('"' + lawyer.tagline + '"', 22, W - 56, 3) : [];
  const tagTop = Y + 58 + label.length * 40 + 34;
  const tagSvg = tag.map((l, i) => `<text x="${x + 28}" y="${tagTop + i * 30}" font-size="22" fill="#fff" fill-opacity="0.82">${esc(l)}</text>`).join('');
  const pct = shown
    ? `<text x="${x + 28}" y="${Y + H - 28}" font-size="76" fill="${win ? BRASS : S.accent}">${shown.p}%</text>
       <text x="${x + W - 28}" y="${Y + H - 32}" font-size="24" fill="#fff" fill-opacity="0.75" text-anchor="end">${shown.n} vote${shown.n === 1 ? '' : 's'}</text>`
    : '';
  return `<rect x="${x}" y="${Y}" width="${W}" height="${H}" rx="26" fill="${S.panel}" stroke="${win ? BRASS : S.accent}" stroke-width="${win ? 8 : 3}"/>
    <rect x="${x}" y="${Y}" width="12" height="${H}" rx="6" fill="${S.accent}"/>
    ${labelSvg}
    <text x="${x + 28}" y="${Y + 28}" font-size="20" fill="${S.accent}">${esc(whoLines[0] || '')}</text>
    ${tagSvg}
    ${pct}`;
}

function svg(d, siteName) {
  const { wrap, esc } = card;
  const { c, lawyers, phase, result, verdict } = d;
  const title = wrap(c.title, 44, 1080, 2);
  const titleSvg = title.map((l, i) => `<text x="600" y="${84 + i * 52}" font-size="44" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  const closed = phase === 'closed' && result;
  const shownA = closed ? { p: result.pa, n: result.a } : null;
  const shownB = closed ? { p: result.pb, n: result.b } : null;
  let foot = phase === 'jury' ? 'The jury is out - cast your vote' : phase === 'recruiting' ? 'Two lawyers needed' : 'Read both sides and vote';
  if (closed) foot = verdict === 'none' ? 'No jurors voted' : verdict === 'tie' ? 'Verdict: hung jury (tie)' : `Verdict: ${verdict === 'a' ? c.side_a : c.side_b}`;
  const footLine = wrap(foot, 30, 1000, 1)[0] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16213f"/><stop offset="1" stop-color="${INK}"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="0" y="0" width="1200" height="8" fill="${BRASS}"/>
  <g font-family="DejaVu Sans" font-weight="bold">
    <text x="600" y="40" font-size="20" fill="${BRASS}" text-anchor="middle">People's Court</text>
    ${titleSvg}
    ${panel('a', 60, c, lawyers.a, shownA, closed && verdict === 'a')}
    ${panel('b', 640, c, lawyers.b, shownB, closed && verdict === 'b')}
    <circle cx="600" cy="361" r="46" fill="${INK}" stroke="${BRASS}" stroke-width="5"/>
    <text x="600" y="376" font-size="40" fill="${BRASS}" text-anchor="middle">VS</text>
    <text x="600" y="580" font-size="30" fill="${closed ? BRASS : '#fff'}" text-anchor="middle">${esc(footLine)}</text>
    <text x="600" y="612" font-size="20" fill="#fff" fill-opacity="0.6" text-anchor="middle">${esc(siteName)}</text>
  </g>
</svg>`;
}

async function renderCourtCard(d, siteName) {
  if (!card.isAvailable()) throw new Error('sharp not available');
  const { c, lawyers, phase, result, verdict } = d;
  const key = ['court', c.id, c.title, c.side_a, c.side_b, phase, verdict || '', siteName,
    lawyers.a ? lawyers.a.username + lawyers.a.tagline : '-', lawyers.b ? lawyers.b.username + lawyers.b.tagline : '-',
    result ? `${result.a}/${result.b}` : ''].join('|');
  return card.cached(key, () => card.toPng(svg(d, siteName)));
}

module.exports = { renderCourtCard };
