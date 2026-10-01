// Telegram channel mein contest khud post: naya contest, result, giveaway winner.
// .env / Render mein TELEGRAM_BOT_TOKEN aur TELEGRAM_CHAT_ID chahiye (dono khali ho to ye sab band rehta hai).
const pool = require('../db');
const config = require('../config');
const card = require('./card');
const P = require('./polls');
const S = require('./sponsor');

const isConfigured = () => !!(config.telegramToken && config.telegramChat);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (msg) => String(msg || '').split(config.telegramToken || '\u0000').join('***');

async function api(method, payload) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* json nahi */ }
    return { ok: !!data.ok, status: res.status, error: data.description || null, retry: res.status === 429 || res.status >= 500 };
  } catch (err) {
    return { ok: false, status: 0, error: clean(err.message), retry: true };
  }
}

// Photo ke sath; photo na chale to sirf text
async function sendPost({ text, photo, buttonText, buttonUrl }) {
  const markup = buttonUrl ? { inline_keyboard: [[{ text: buttonText || 'Open', url: buttonUrl }]] } : undefined;
  if (photo) {
    const r = await api('sendPhoto', {
      chat_id: config.telegramChat, photo, caption: text.slice(0, 1000), parse_mode: 'HTML', reply_markup: markup,
    });
    if (r.ok || r.retry) return r;
  }
  return api('sendMessage', {
    chat_id: config.telegramChat, text: text.slice(0, 4000), parse_mode: 'HTML', reply_markup: markup,
    link_preview_options: { is_disabled: true },
  });
}

const when = (d) => new Date(d).toLocaleString('en-GB', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' });
const link = (id) => `${config.siteUrl}/votes/${id}?utm_source=telegram&utm_medium=channel`;
const photoOf = (id) => (card.isAvailable() ? `${config.siteUrl}/og/vote/${id}.png` : null);
const firstRound = (st) => st.matches.filter((m) => m.round === 1).flatMap((m) => m.options);

function sponsorLines(ex) {
  const out = [];
  if (ex.prize) out.push(`🎁 Prize: <b>${esc(ex.prize)}</b>`);
  if (ex.sponsor_name) out.push(`🤝 Sponsored by <b>${esc(ex.sponsor_name)}</b>`);
  return out;
}

function startText(st, ex) {
  const names = firstRound(st).map((o) => esc(o.name));
  const lines = [`🗳️ <b>${esc(st.title)}</b>`, ''];
  lines.push(st.kind === 'knockout' ? `🏆 Knockout: ${names.join(', ')}` : names.join(' <b>vs</b> '));
  lines.push(...sponsorLines(ex));
  if (st.endsAt) lines.push(`⏳ Voting ends: ${when(st.endsAt)}`);
  lines.push('', '👇 Tap the button and vote now!');
  return lines.join('\n');
}

function resultText(st, ex) {
  const lines = [`🏁 <b>Result: ${esc(st.title)}</b>`, ''];
  if (st.kind === 'knockout') {
    if (st.champion) lines.push(`🏆 Champion: <b>${esc(st.champion.name)}</b>`);
  } else {
    const opts = [...st.matches[0].options].sort((a, b) => b.votes - a.votes);
    const win = st.matches[0].winnerId;
    if (win) {
      const w = opts.find((o) => o.id === win);
      lines.push(`🏆 Winner: <b>${esc(w.name)}</b> (${w.pct}%)`);
    } else {
      lines.push('🤝 It ended in a tie!');
    }
    opts.slice(0, 4).forEach((o, i) => lines.push(`${i + 1}. ${esc(o.name)}: ${o.pct}% (${o.votes})`));
  }
  lines.push('', `Total votes: ${st.total}`);
  if (ex.prize && !ex.giveaway_username) lines.push('🎁 The giveaway winner will be announced soon!');
  if (ex.giveaway_username) lines.push(`🎉 Giveaway winner: <b>${esc(ex.giveaway_username)}</b>`);
  lines.push('', 'Thanks for voting! 🙏');
  return lines.join('\n');
}

async function post(id, kind) {
  const st = await P.loadState(id, null, config.siteUrl);
  if (!st) return { ok: false, retry: false, error: 'contest not found' };
  const ex = await S.extras(id);
  if (kind === 'start') {
    return sendPost({ text: startText(st, ex), photo: photoOf(id), buttonText: '🗳 Vote now', buttonUrl: link(id) });
  }
  if (st.total === 0) return { ok: true, skipped: true }; // kisi ne vote hi nahi diya: result ka kya post karna
  return sendPost({ text: resultText(st, ex), photo: photoOf(id), buttonText: '📊 See full results', buttonUrl: link(id) });
}

async function announceGiveaway(id, username) {
  if (!isConfigured() || !config.siteUrl) return;
  const st = await P.loadState(id, null, config.siteUrl);
  const ex = await S.extras(id);
  if (!st) return;
  const lines = [
    `🎉 <b>Giveaway winner!</b>`, '',
    `Contest: ${esc(st.title)}`,
    `🎁 Prize: <b>${esc(ex.prize || '')}</b>`,
    `🏅 Winner: <b>${esc(username)}</b>`,
  ];
  if (ex.sponsor_name) lines.push(`🤝 Sponsored by <b>${esc(ex.sponsor_name)}</b>`);
  const r = await sendPost({ text: lines.join('\n'), buttonText: 'See the contest', buttonUrl: link(id) });
  if (!r.ok) console.error('[telegram] giveaway post:', r.error);
}

async function sendTest() {
  if (!isConfigured()) return { ok: false, error: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first.' };
  return sendPost({ text: `✅ Telegram is connected to <b>${esc(config.siteName)}</b>. New contests and results will be posted here.` });
}

// Har minute: naye contests aur khatam hue contests ko channel mein bhejo (har ek sirf ek baar)
let running = false;
async function tick() {
  if (running || !isConfigured()) return;
  if (!config.siteUrl) { console.error('[telegram] SITE_URL set karein, warna links nahi ban sakte.'); return; }
  running = true;
  try {
    const fresh = await pool.query("SELECT id FROM polls WHERE tg_start_sent = false AND created_at > now() - interval '2 days' ORDER BY id");
    for (const { id } of fresh.rows) {
      const claim = await pool.query('UPDATE polls SET tg_start_sent = true WHERE id = $1 AND tg_start_sent = false RETURNING id', [id]);
      if (!claim.rows[0]) continue;
      const r = await post(id, 'start');
      if (r.ok) console.log(`[telegram] contest ${id}: channel mein post ho gaya`);
      else if (r.retry) await pool.query('UPDATE polls SET tg_start_sent = false WHERE id = $1', [id]); // baad mein dobara
      else {
        console.error(`[telegram] contest ${id}: ${r.error}`);
        await pool.query('UPDATE polls SET tg_end_sent = true WHERE id = $1', [id]); // channel theek na ho to result bhi na bhejo
      }
    }

    const ended = await pool.query(
      `SELECT id FROM polls
       WHERE tg_start_sent = true AND tg_end_sent = false AND created_at > now() - interval '60 days'
         AND (is_closed OR (kind = 'vote' AND ends_at IS NOT NULL AND ends_at <= now()) OR (kind = 'knockout' AND winner_option_id IS NOT NULL))
       ORDER BY id`);
    for (const { id } of ended.rows) {
      const claim = await pool.query('UPDATE polls SET tg_end_sent = true WHERE id = $1 AND tg_end_sent = false RETURNING id', [id]);
      if (!claim.rows[0]) continue;
      const r = await post(id, 'end');
      if (r.ok) { if (!r.skipped) console.log(`[telegram] contest ${id}: result post ho gaya`); }
      else if (r.retry) await pool.query('UPDATE polls SET tg_end_sent = false WHERE id = $1', [id]);
      else console.error(`[telegram] contest ${id} result: ${r.error}`);
    }
  } catch (err) {
    console.error('[telegram] tick:', clean(err.message));
  } finally {
    running = false;
  }
}

function startTelegramPoster() {
  if (!isConfigured()) return;
  setTimeout(tick, 20 * 1000);
  setInterval(tick, 60 * 1000);
}

module.exports = { isConfigured, sendTest, announceGiveaway, startTelegramPoster, tick, startText, resultText, api };
