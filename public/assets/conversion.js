// The pure parts of «Convertir al formato actual» (convert.js): how a guide is cut into parts, which texts its code
// keeps, and how much of the original made it to the result. No page, no network: the tests use the same functions.

const PART = 22_000; // characters of original per part

const plain = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function wordsOf(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/[\p{L}\p{N}]{5,}/gu)) out.add(plain(m[0]));
  return out;
}
// How much of the original's vocabulary made it to the result: a loose check that nothing was left out.
export function coverage(before, after) {
  const a = wordsOf(before);
  const b = wordsOf(after);
  const missing = [...a].filter((w) => !b.has(w));
  return { total: a.size, kept: a.size - missing.length, share: a.size ? (a.size - missing.length) / a.size : 1, missing };
}

// Markdown or plain text, by its headings (# and ##).
export function splitText(text) {
  const parts = [];
  let cur = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const h = line.match(/^#{1,2}\s+(.+?)\s*#*\s*$/);
    if (h || !cur) { cur = { title: h ? h[1].trim() : '', lines: [] }; parts.push(cur); }
    cur.lines.push(line);
  }
  return parts.map((p) => ({ title: p.title, html: p.lines.join('\n') })).filter((p) => p.html.trim());
}

// A part too long for one request is cut where a block starts (a paragraph, a table, a figure…).
function cut(s, max) {
  const bits = s.split(/(?=<(?:h[3-6]|p|div|table|tr|li|dt|ul|ol|figure|pre|details|section|article|aside|blockquote)\b)|(?<=\n\s*\n)/i);
  const out = [''];
  for (let bit of bits) {
    while (bit.length > max) { out.push(bit.slice(0, max)); bit = bit.slice(max); }
    if (out[out.length - 1].length + bit.length > max && out[out.length - 1]) out.push('');
    out[out.length - 1] += bit;
  }
  return out.filter((x) => x.trim());
}
// The parts as they go to the AI: each with its id (p1, p2…) and a title; untitled pieces join the one before.
export function pack(parts, max = PART) {
  const joined = [];
  for (const p of parts) {
    const last = joined[joined.length - 1];
    if (last && !p.title && last.html.length + p.html.length <= max) { last.html += `\n${p.html}`; last.controls = [...(last.controls ?? []), ...(p.controls ?? [])]; } else joined.push({ ...p });
  }
  const out = [];
  for (const p of joined) {
    const pieces = p.html.length <= max ? [p.html] : cut(p.html, max);
    pieces.forEach((html, i) => out.push({
      title: `${p.title || (out.length ? `Parte ${out.length + 1}` : 'Introducción')}${pieces.length > 1 ? ` (${i + 1} de ${pieces.length})` : ''}`,
      html, controls: i === 0 ? (p.controls ?? []) : [],
    }));
  }
  return out.map((p, i) => ({ ...p, id: `p${i + 1}` }));
}

// The texts a guide's code keeps (cards, glossaries, questions, steps of an animation) that the drawn page does not
// show at once: string literals that read like sentences and add words the page does not have.
export function codeStrings(code, shown = '') {
  const seen = wordsOf(shown);
  const out = [];
  const have = new Set();
  let size = 0;
  for (const m of String(code ?? '').matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const s = m[2].replace(/\$\{[^}]*\}/g, '…').replace(/\\(.)/g, '$1').trim();
    if (s.length < 20 || !/\s/.test(s) || (s.match(/[\p{L}]{3,}/gu) ?? []).length < 3) continue;
    if (/[{};]|=>|^\s*[.#]?[\w-]+\s*[:{]|<\/?[a-z]/i.test(s) && !/[.!?¿¡]/.test(s)) continue; // code, CSS or markup
    if (have.has(s) || ![...wordsOf(s)].some((w) => !seen.has(w))) continue;
    have.add(s);
    out.push(s);
    size += s.length;
    if (size > 60_000) break;
  }
  return out;
}
