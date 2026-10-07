// Trend Radar (V38): /trends - pick a niche + platform, get a report of what is trending in Pakistan.
const express = require('express');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const T = require('../lib/trends');

const router = express.Router();
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanKeyword = (v) => oneLine(v, 40).replace(/[^\p{L}\p{N} ]/gu, '').trim();
const pick = (q) => {
  const niche = Object.prototype.hasOwnProperty.call(T.NICHES, q.niche) ? q.niche : '';
  const platform = T.PLATFORMS.includes(q.platform) ? q.platform : 'youtube';
  return { niche, platform, keyword: cleanKeyword(q.keyword) };
};

router.get('/trends', async (req, res, next) => {
  try {
    const { niche, platform, keyword } = pick(req.query);
    let report = null;
    if (niche) {
      if (!req.session.user) { req.session.returnTo = req.originalUrl; return res.redirect('/login'); }
      report = await T.getReport({ platform, niche, keyword });
    }
    res.render('trends', {
      title: report ? `${report.nicheLabel} trends in Pakistan - Trend Radar` : 'Trend Radar - What should I post about today?',
      metaDescription: 'See what is trending in Pakistan on YouTube and Google right now, and get 10 video ideas, titles, hashtags and the best time to post for your niche.',
      niches: T.NICHES, f: { niche, platform, keyword }, report,
      aiEnabled: T.aiEnabled(), langs: Object.keys(T.LANGS), hasKey: T.hasYouTubeKey,
      robots: report ? 'noindex,follow' : undefined,
    });
  } catch (err) { next(err); }
});

// AI write-up: fetch() se aata hai (CSRF token header mein), HTML tukda wapas deta hai
router.post('/trends/ai', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in first.' });
  if (!T.aiEnabled()) return res.status(400).json({ error: 'AI write-up is not switched on for this site.' });
  try {
    const { niche, platform, keyword } = pick(req.body || {});
    if (!niche) return res.status(400).json({ error: 'Choose a niche first.' });
    const lang = Object.prototype.hasOwnProperty.call(T.LANGS, req.body.lang) ? req.body.lang : 'english';
    const report = await T.getReport({ platform, niche, keyword });
    const out = await T.aiWriteup(report, lang);
    if (out.error) return res.status(502).json({ error: out.error });
    const html = sanitizeHtml(marked.parse(out.text, { async: false }), {
      allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'hr', 'code'],
      allowedAttributes: {},
    });
    res.json({ html, rtl: lang === 'urdu' });
  } catch (err) {
    console.error('[trends/ai]', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
