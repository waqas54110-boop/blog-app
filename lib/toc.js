// Post ke h2/h3 headings mein id lagata hai aur "Table of contents" ki list banata hai.
// Input wo HTML hai jo pehle hi sanitize ho chuki, isliye headings ka text already escaped hota hai.

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function addToc(html) {
  const used = new Set();
  const toc = [];

  const out = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (match, level, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim(); // escaped text, HTML mein safe
    if (!text) return match;

    let slug = decode(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (!slug) slug = 'section';
    let id = 'sec-' + slug;
    let n = 1;
    while (used.has(id)) { n += 1; id = `sec-${slug}-${n}`; }
    used.add(id);

    toc.push({ id, text, level: Number(level) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });

  return { html: out, toc };
}

module.exports = { addToc };
