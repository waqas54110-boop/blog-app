// /headlines.json?cat=Cricket : bar ki category badalne par naye headlines (bina page reload)
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
