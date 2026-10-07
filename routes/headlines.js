// /headlines.json?cat=Cricket : new headlines when the bar's category changes (no page reload)
const express = require('express');
const H = require('../lib/headlines');
const router = express.Router();

router.get('/headlines.json', async (req, res) => {
  try {
    const cats = await H.categories();
    const q = String(req.query.cat || '');
    const cat = cats.includes(q) ? q : '';
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ cat, items: await H.forCategory(cat) });
  } catch (err) {
    console.error('[headlines]', err.message);
    res.status(500).json({ cat: '', items: [] });
  }
});
module.exports = router;
