// Any file a person drops, made ready for their AI. Everything happens in this browser: the file is read here, split
// when it is long, and only goes to the person's own AI. prepare(file) returns the file's fingerprint and its units of
// work; each unit is one request to the AI and becomes one contribution.
//
// - PDF: one unit when short. A long one is split by its chapters (its outline) or in windows of pages that every
//   provider accepts; a book starts with its table of contents, and its chapters wait until the person picks them.
// - Photos: shrunk to a size every provider reads well. Pages of the same exam are joined with groupFiles().
// - Word, PowerPoint, Excel, OpenDocument and EPUB: unzipped and read here, as text per page, slide, sheet or chapter,
//   plus a few of their figures.
// - Notebooks, code, text, Markdown, LaTeX, CSV and HTML: text, in parts when long.
// - ZIP: every file inside, as above.
// - Video and audio: not read, and the person is told why.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs';
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

export const LIMITS = {
  partBytes: 12_000_000, // one PDF part: every provider accepts it inline, base64 included
  partPages: 50, // one PDF part: room for the AI to read every page with care
  bookPages: 150, // longer than this, a PDF is a book: its index first, its chapters on request
  splitInBrowser: 160_000_000, // larger PDFs are not rebuilt here: their pages go as pictures
  heavyPage: 1_500_000, // a PDF this heavy per page is photos or scans: its pages go as pictures, much lighter
  picturePages: 12, // pages per part when they go as pictures
  tileSide: 1100, // a page larger than this (in points, A4 is 842) is cut in four, so small writing stays legible
  tilePage: 4_000_000, // a PDF this heavy per page is high-resolution photos: its pages are cut in four too
  textChars: 120_000, // one text part
  imageSide: 1800, // the longest side of a picture sent to the AI
  figures: 8, // pictures taken from a presentation or a document
  zipEntries: 80,
};

const TEXT = /\.(txt|md|markdown|csv|tsv|json|tex|bib|py|c|cc|cpp|h|hpp|java|kt|js|mjs|ts|rs|go|rb|php|cs|swift|m|r|jl|sql|sh|ps1|yaml|yml|xml|css|asm|s|vhd|vhdl|v|sv|pl|hs|scala|lua|dart)$/i;
const MEDIA = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|mp3|wav|m4a|aac|ogg|flac|wma)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const CODE = /\.(py|c|cc|cpp|h|hpp|java|kt|js|mjs|ts|rs|go|rb|php|cs|swift|m|r|jl|sql|sh|ps1|asm|s|vhd|vhdl|v|sv|pl|hs|scala|lua|dart)$/i;
const SKIP_ENTRY = /(^|\/)(__MACOSX|\.git|node_modules|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|\/\._/;

const skipped = (name, reason) => ({ name, skipped: reason, units: [] });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const baseName = (name) => String(name).split('/').pop();

/* ---------- bytes ---------- */
export function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// The same file always has the same fingerprint, so it is never added twice. Very large files are fingerprinted by
// their beginning, their end and their size.
export async function fingerprint(file) {
  const big = file.size > 64_000_000;
  const data = big ? await new Blob([file.slice(0, 16_000_000), file.slice(file.size - 16_000_000), String(file.size)]).arrayBuffer() : await file.arrayBuffer();
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 24);
}

/* ---------- text ---------- */
function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const entities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));
// The text of an HTML or XHTML page, with its headings marked.
export function htmlText(html) {
  return entities(String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>/gi, (m, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ').replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
// Long text in parts, cut at a blank line when possible.
function chunks(text, max = LIMITS.textChars) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}
function textUnits(name, text, { note = '', figures = [] } = {}) {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean && !figures.length) return [];
  const parts = chunks(clean);
  return parts.map((t, i) => ({
    label: parts.length > 1 ? `${name} · parte ${i + 1} de ${parts.length}` : name,
    kind: parts.length > 1 ? 'pages' : 'whole',
    note: parts.length > 1 ? `Parte ${i + 1} de ${parts.length} del texto de «${baseName(name)}»${note ? `. ${note}` : ''}` : note,
    selected: true,
    make: async () => [{ name: baseName(name), type: 'text/plain', text: t }, ...(i === 0 ? figures : [])],
  }));
}

/* ---------- ZIP: the container of Office, OpenDocument and EPUB files ---------- */
// Reads the central directory and inflates entries on demand (DecompressionStream, no library).
export async function unzip(blob) {
  const size = blob.size;
  const tail = await bytesOf(blob.slice(Math.max(0, size - 65_557)));
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not-zip');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('zip64');
  const cd = await bytesOf(blob.slice(cdOffset, cdOffset + cdSize));
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const length = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? new TextDecoder().decode(rawName) : decodeText(rawName);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.set(name, {
      name, size: length,
      async bytes() {
        const head = await bytesOf(blob.slice(offset, offset + 30));
        const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
        const start = offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
        const raw = blob.slice(start, start + compressed);
        if (method === 0) return bytesOf(raw);
        if (method !== 8) throw new Error('zip-method');
        return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      },
      async text() { return decodeText(await this.bytes()); },
    });
  }
  return entries;
}

// A ZIP of several files, stored without compression: the parts Studium prepared, in one download.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i += 1) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipFiles(files) {
  const chunksOut = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const data = f.bytes;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
    chunksOut.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunksOut, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/* ---------- pictures ---------- */
// A picture the AI reads well: at most LIMITS.imageSide on its longest side, as JPEG (PNG and WebP that are already
// small go as they are, so diagrams keep their sharp lines).
export async function imagePart(blob, name) {
  const type = blob.type || (/\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/jpeg');
  if (typeof createImageBitmap !== 'function') return { name, type, data: base64(await bytesOf(blob)) };
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { return null; }
  const scale = Math.min(1, LIMITS.imageSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && blob.size < 3_500_000 && /image\/(png|jpeg|webp)/.test(type)) { bitmap.close?.(); return { name, type, data: base64(await bytesOf(blob)) }; }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 }) : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return { name: name.replace(/\.[a-z0-9]+$/i, '.jpg'), type: 'image/jpeg', data: base64(await bytesOf(out)) };
}
// The largest figures of a document or presentation, in their order, up to LIMITS.figures.
async function figures(entries, folder) {
  const media = [...entries.values()].filter((e) => e.name.startsWith(folder) && /\.(png|jpe?g|webp|gif)$/i.test(e.name) && e.size > 25_000)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).slice(0, LIMITS.figures * 2)
    .sort((a, b) => b.size - a.size).slice(0, LIMITS.figures)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const out = [];
  for (const e of media) {
    const part = await imagePart(new Blob([await e.bytes()], { type: /png$/i.test(e.name) ? 'image/png' : 'image/jpeg' }), baseName(e.name));
    if (part) out.push(part);
  }
  return out;
}

/* ---------- Office, OpenDocument, EPUB, notebooks ---------- */
const numbered = (entries, rx) => [...entries.values()].map((e) => ({ e, n: Number(e.name.match(rx)?.[1]) })).filter((x) => x.n)
  .sort((a, b) => a.n - b.n).map((x) => x.e);
const runs = (xml, tags) => [...xml.matchAll(new RegExp(`<(?:${tags})(?:\\s[^>]*)?>([^<]*)</(?:${tags})>|<(?:w:tab|a:tab|text:tab)/>|<(?:w:br|a:br|text:line-break)/>`, 'g'))]
  .map((m) => (m[1] != null ? entities(m[1]) : m[0].includes('tab') ? '\t' : '\n')).join('');

export async function officeText(entries, ext) {
  if (ext === 'docx') {
    const xml = await entries.get('word/document.xml')?.text() ?? '';
    return xml.split(/<\/w:p>/).map((p) => {
      const level = p.match(/<w:pStyle w:val="(?:Heading|Ttulo|Titulo)(\d)"/i)?.[1];
      const t = runs(p, 'w:t|m:t').trim();
      return t && level ? `${'#'.repeat(Number(level))} ${t}` : t;
    }).filter(Boolean).join('\n');
  }
  if (ext === 'pptx') {
    const slides = numbered(entries, /^ppt\/slides\/slide(\d+)\.xml$/);
    const notes = new Map(numbered(entries, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/).map((e) => [Number(e.name.match(/(\d+)\.xml$/)[1]), e]));
    const out = [];
    for (const [i, e] of slides.entries()) {
      const xml = await e.text();
      const text = xml.split(/<\/a:p>/).map((p) => runs(p, 'a:t').trim()).filter(Boolean).join('\n');
      const note = notes.get(i + 1) ? (await notes.get(i + 1).text()).split(/<\/a:p>/).map((p) => runs(p, 'a:t').trim()).filter((t) => t && !/^\d+$/.test(t)).join(' ') : '';
      out.push(`## Diapositiva ${i + 1}\n${text}${note ? `\nNotas: ${note}` : ''}`);
    }
    return out.join('\n\n');
  }
  if (ext === 'xlsx') {
    const shared = [...((await entries.get('xl/sharedStrings.xml')?.text()) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1], 't'));
    const names = [...((await entries.get('xl/workbook.xml')?.text()) ?? '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => entities(m[1]));
    const out = [];
    for (const [i, e] of numbered(entries, /^xl\/worksheets\/sheet(\d+)\.xml$/).entries()) {
      const rows = [...(await e.text()).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 400).map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].slice(0, 60).map((c) => {
        const type = c[1].match(/t="([^"]+)"/)?.[1];
        const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1] ?? '';
        if (type === 's') return shared[Number(v)] ?? '';
        if (type === 'inlineStr') return runs(c[2] ?? '', 't');
        const f = c[2]?.match(/<f>([^<]*)<\/f>/)?.[1];
        // Numbers as a person reads them (8.94, not 8.9399999999999995), at most six significant digits.
        const n = Number(v);
        const shown = v !== '' && Number.isFinite(n) ? String(Number(n.toPrecision(6))) : v;
        return entities(f ? `${shown} (=${f})` : shown);
      }).join('\t')).filter((r) => r.trim());
      if (rows.length) out.push(`## Hoja: ${names[i] ?? i + 1}\n${rows.join('\n')}`);
    }
    return out.join('\n\n');
  }
  if (/^od[tps]$/.test(ext)) {
    const xml = await entries.get('content.xml')?.text() ?? '';
    const pages = ext === 'odp' ? xml.split(/<\/draw:page>/) : [xml];
    return pages.map((page, i) => {
      const text = page.split(/<\/text:(?:p|h)>/).map((p) => entities(p.replace(/<text:tab\/>/g, '\t').replace(/<[^>]+>/g, '')).trim()).filter(Boolean).join('\n');
      return ext === 'odp' && text ? `## Diapositiva ${i + 1}\n${text}` : text;
    }).filter(Boolean).join('\n\n');
  }
  return '';
}
// An EPUB's chapters in reading order, and its table of contents.
export async function epubChapters(entries) {
  const container = await entries.get('META-INF/container.xml')?.text() ?? '';
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? await entries.get(opfPath)?.text() ?? '' : '';
  const dir = opfPath?.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map([...opf.matchAll(/<item\s[^>]*>/g)].map((m) => [m[0].match(/id="([^"]+)"/)?.[1], m[0].match(/href="([^"]+)"/)?.[1]]));
  const spine = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter(Boolean);
  const chapters = [];
  for (const href of spine) {
    const entry = entries.get(decodeURIComponent(dir + href.split('#')[0]));
    if (!entry) continue;
    const text = htmlText(await entry.text());
    if (text.length < 40) continue;
    const title = text.match(/^#{1,3} (.+)$/m)?.[1]?.trim().slice(0, 90) ?? '';
    chapters.push({ title, text });
  }
  return chapters;
}
export function notebookText(json) {
  let nb;
  try { nb = JSON.parse(json); } catch { return ''; }
  return (nb.cells ?? []).map((c) => {
    const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
    if (c.cell_type === 'markdown') return src;
    const out = (c.outputs ?? []).map((o) => (Array.isArray(o.text) ? o.text.join('') : o.data?.['text/plain'] ? [].concat(o.data['text/plain']).join('') : '')).join('').slice(0, 2000);
    return `\`\`\`${nb.metadata?.language_info?.name ?? 'python'}\n${src}\n\`\`\`${out.trim() ? `\nSalida:\n${out}` : ''}`;
  }).filter((x) => x.trim()).join('\n\n');
}

/* ---------- PDF ---------- */
let pdfjsReady = null;
let pdfLibReady = null;
const pdfjs = () => (pdfjsReady ??= import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }));
const pdfLib = () => (pdfLibReady ??= import(PDFLIB));

// The outline's chapters, as page ranges: the top level, or the second when the top is only the book's title.
async function outlineOf(doc) {
  const out = [];
  const walk = async (items, depth) => {
    for (const it of items ?? []) {
      let page = null;
      try {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
        if (dest?.[0] != null) page = typeof dest[0] === 'number' ? dest[0] + 1 : (await doc.getPageIndex(dest[0])) + 1;
      } catch { /* an entry without a page */ }
      if (page) out.push({ title: String(it.title ?? '').replace(/\s+/g, ' ').trim(), page, depth });
      if (depth < 1) await walk(it.items, depth + 1);
    }
  };
  try { await walk(await doc.getOutline(), 0); } catch { /* no outline */ }
  return out;
}
export function chapterRanges(outline, pages) {
  let level = outline.filter((o) => o.depth === 0);
  if (level.length < 3) level = outline.filter((o) => o.depth === 1).length >= 3 ? outline.filter((o) => o.depth === 1) : level;
  const marks = [...new Map(level.filter((o) => o.page >= 1 && o.page <= pages).sort((a, b) => a.page - b.page).map((o) => [o.page, o])).values()];
  if (marks.length < 2) return [];
  const ranges = [];
  if (marks[0].page > 1) ranges.push({ title: 'Inicio', from: 1, to: marks[0].page - 1 });
  marks.forEach((m, i) => ranges.push({ title: m.title, from: m.page, to: (marks[i + 1]?.page ?? pages + 1) - 1 }));
  return ranges.filter((r) => r.to >= r.from);
}
// Ranges no longer than max pages: a long chapter is cut in windows, tiny neighbours are joined.
export function fitRanges(ranges, max) {
  const out = [];
  for (const r of ranges) {
    const n = r.to - r.from + 1;
    if (n <= max) {
      const last = out.at(-1);
      if (last && last.to - last.from + 1 + n <= Math.min(max, 12) && n < 6) { last.to = r.to; last.title = `${last.title}; ${r.title}`.slice(0, 120); } else out.push({ ...r });
      continue;
    }
    const pieces = Math.ceil(n / max);
    for (let i = 0; i < pieces; i += 1) {
      const from = r.from + Math.floor((i * n) / pieces);
      const to = r.from + Math.floor(((i + 1) * n) / pieces) - 1;
      out.push({ title: pieces > 1 ? `${r.title} (${i + 1} de ${pieces})` : r.title, from, to });
    }
  }
  return out;
}
async function pageText(doc, from, to) {
  const out = [];
  for (let i = from; i <= to; i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it) => `${it.str}${it.hasEOL ? '\n' : ''}`).join(''));
  }
  return out.join('\n').replace(/[ \t]+/g, ' ').trim();
}
// Pages as pictures: for scans and photos (much lighter than the PDF's own images) and for files too large to rebuild
// here. A large page (a mind map, a poster, a photo of a whiteboard) is cut in four overlapping quarters, so writing
// that would be too small in one picture stays legible.
const QUARTERS = ['arriba a la izquierda', 'arriba a la derecha', 'abajo a la izquierda', 'abajo a la derecha'];
async function pagePictures(doc, from, to, name, { tile = null } = {}) {
  const out = [];
  const jpeg = async (canvas) => base64(await bytesOf(await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.84))));
  const stem = name.replace(/\.pdf$/i, '');
  for (let i = from; i <= to; i += 1) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const quarters = tile ?? Math.max(base.width, base.height) > LIMITS.tileSide;
    const side = quarters ? LIMITS.imageSide * 1.8 : LIMITS.imageSide;
    const viewport = page.getViewport({ scale: Math.min(4, side / Math.max(base.width, base.height)) });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(viewport.width), height: Math.round(viewport.height) });
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport, canvas }).promise;
    if (!quarters) { out.push({ name: `${stem} (página ${i}).jpg`, type: 'image/jpeg', data: await jpeg(canvas) }); continue; }
    const w = canvas.width; const h = canvas.height;
    const tw = Math.round(w * 0.54); const th = Math.round(h * 0.54);
    for (let q = 0; q < 4; q += 1) {
      const piece = Object.assign(document.createElement('canvas'), { width: tw, height: th });
      piece.getContext('2d').drawImage(canvas, q % 2 ? w - tw : 0, q > 1 ? h - th : 0, tw, th, 0, 0, tw, th);
      out.push({ name: `${stem} (página ${i}, ${QUARTERS[q]}).jpg`, type: 'image/jpeg', data: await jpeg(piece) });
    }
  }
  return out;
}

async function pdfUnits(file, name) {
  const lib = await pdfjs();
  let doc;
  try { doc = await lib.getDocument({ data: await bytesOf(file), isEvalSupported: false, useSystemFonts: true }).promise; }
  catch (error) {
    if (/password/i.test(error?.name ?? '') || /password/i.test(error?.message ?? '')) return skipped(name, 'el PDF tiene contraseña: quítasela y vuelve a subirlo');
    if (file.size <= LIMITS.partBytes) return { name, units: [{ label: name, kind: 'whole', note: '', selected: true, make: async () => [{ name: baseName(name), type: 'application/pdf', data: base64(await bytesOf(file)) }] }] };
    return skipped(name, 'no se pudo leer este PDF');
  }
  const pages = doc.numPages;
  const perPage = file.size / pages;
  // Scans and photos: every page as a picture, a dozen pages per part.
  const heavy = perPage > LIMITS.heavyPage;
  if (heavy && pages <= LIMITS.picturePages) {
    const big = Math.max(...(await Promise.all(Array.from({ length: Math.min(pages, 3) }, (_, i) => doc.getPage(i + 1).then((pg) => { const v = pg.getViewport({ scale: 1 }); return Math.max(v.width, v.height); })))));
    // Very heavy pages are high-resolution photos or scans, often with small writing: they go in quarters too.
    const tile = big > LIMITS.tileSide || perPage > LIMITS.tilePage;
    return { name, pages, units: [{ label: name, kind: 'whole', pages, selected: true,
      note: tile ? 'Cada página va en cuatro partes que se solapan un poco (arriba a la izquierda, arriba a la derecha, abajo a la izquierda, abajo a la derecha), para que la letra pequeña se lea: júntalas al leer' : '',
      make: () => pagePictures(doc, 1, pages, baseName(name), { tile }) }] };
  }
  if (!heavy && pages <= LIMITS.partPages && file.size <= LIMITS.partBytes) {
    return { name, pages, units: [{ label: name, kind: 'whole', note: '', pages, selected: true, make: async () => [{ name: baseName(name), type: 'application/pdf', data: base64(await bytesOf(file)) }] }] };
  }
  const outline = await outlineOf(doc);
  const maxPages = heavy ? LIMITS.picturePages : Math.max(1, Math.min(LIMITS.partPages, Math.floor(LIMITS.partBytes / perPage)));
  const chapters = chapterRanges(outline, pages);
  const ranges = fitRanges(chapters.length ? chapters : [{ title: '', from: 1, to: pages }], maxPages);
  const book = pages > LIMITS.bookPages;
  const rebuild = file.size <= LIMITS.splitInBrowser && !heavy;
  let source = null; // pdf-lib's copy of the file, read once, when the first part is made
  const pdfPart = async (from, to) => {
    if (rebuild) {
      try {
        const { PDFDocument } = await pdfLib();
        source ??= await PDFDocument.load(await bytesOf(file), { ignoreEncryption: true, updateMetadata: false });
        const out = await PDFDocument.create();
        const copied = await out.copyPages(source, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
        for (const p of copied) out.addPage(p);
        return [{ name: `${baseName(name).replace(/\.pdf$/i, '')} (pág. ${from}-${to}).pdf`, type: 'application/pdf', data: base64(await out.save({ useObjectStreams: true })) }];
      } catch { /* a PDF pdf-lib cannot rebuild: its pages go as pictures */ }
    }
    return pagePictures(doc, from, to, baseName(name));
  };
  const units = ranges.map((r, i) => ({
    label: `${name} · ${r.title || `páginas ${r.from}-${r.to}`}`,
    kind: chapters.length ? 'chapter' : 'pages', from: r.from, to: r.to, pages: r.to - r.from + 1,
    note: `Parte ${i + 1} de ${ranges.length} de «${baseName(name)}» (${pages} páginas): páginas ${r.from} a ${r.to}${r.title ? `, «${r.title}»` : ''}`,
    selected: !book,
    make: () => pdfPart(r.from, r.to),
  }));
  if (book) {
    // A book's index: its outline and the text of its first pages (or their pictures, when they have no text).
    // Its printed contents come before its first numbered chapter («1 …», «Capítulo 1», «Chapter 1», «Unidad 1»).
    const opening = outline.find((o) => /^(\d+[\s.:]|(cap[ií]tulo|chapter|unidad|unit|parte|part|tema|lecci[oó]n)\s*(1|i|uno|one))/i.test(o.title))?.page;
    const first = Math.min(30, pages, opening ? Math.max(8, opening - 1) : 25);
    units.unshift({
      label: `${name} · índice`, kind: 'toc', from: 1, to: first, pages: first, selected: true,
      note: `El índice de un libro de ${pages} páginas: su tabla de contenidos y sus primeras páginas. Extrae los conceptos de cada capítulo en orden, con sus relaciones (sobre todo lo que se necesita antes); las preguntas, solo si el índice trae ejercicios`,
      make: async () => {
        const text = await pageText(doc, 1, first);
        const marks = outline.map((o) => `${'  '.repeat(o.depth)}- ${o.title} (pág. ${o.page})`).join('\n');
        if (text.length > 400 || marks) return [{ name: `${baseName(name)} (índice).txt`, type: 'text/plain', text: `${marks ? `Tabla de contenidos (marcadores del PDF):\n${marks}\n\n` : ''}Texto de las páginas 1 a ${first}:\n${text}` }];
        return pdfPart(1, Math.min(first, 15));
      },
    });
  }
  return { name, pages, book, units };
}

/* ---------- any file ---------- */
async function sniff(file) {
  const head = await bytesOf(file.slice(0, 16));
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)) return 'zip';
  if ((head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') || (head[0] === 0xff && head[1] === 0xd8) || ascii.startsWith('GIF8') || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')) return 'image';
  if (ascii.slice(4, 8) === 'ftyp') return /heic|heix|hevc|mif1|msf1/.test(ascii.slice(8, 12)) ? 'heic' : 'media';
  return '';
}
const ext = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

// The units of work of one file. opts.depth guards ZIPs inside ZIPs.
export async function prepare(file, opts = {}) {
  const name = file.webkitRelativePath || file.relativePath || file.name;
  const e = ext(name);
  const kind = await sniff(file);
  if (MEDIA.test(name) || kind === 'media') return skipped(name, 'Studium todavía no lee video ni audio: si tienes las diapositivas o tus apuntes de esa clase, súbelos');
  if (kind === 'heic' || /^hei[cf]$/.test(e)) return skipped(name, 'las fotos HEIC no se leen en el navegador: expórtala como JPG');
  if (!file.size) return skipped(name, 'el archivo está vacío');
  if (kind === 'pdf' || e === 'pdf') return pdfUnits(file, name);
  if (kind === 'image' || IMAGE.test(name)) {
    return { name, units: [{ label: name, kind: 'whole', note: '', selected: true, make: async () => { const p = await imagePart(file, baseName(name)); if (!p) throw new Error('No se pudo leer la foto.'); return [p]; } }] };
  }
  if (kind === 'zip' || /^(docx|pptx|xlsx|odt|odp|ods|epub|zip)$/.test(e)) {
    let entries;
    try { entries = await unzip(file); } catch (error) { return skipped(name, error.message === 'zip64' ? 'el ZIP es demasiado grande: súbelo por partes' : 'no se pudo abrir el archivo comprimido'); }
    if (e === 'epub' || entries.has('META-INF/container.xml')) {
      const chapters = await epubChapters(entries);
      if (!chapters.length) return skipped(name, 'el libro no trae texto legible');
      const total = chapters.reduce((s, c) => s + c.text.length, 0);
      const book = total > LIMITS.textChars * 2;
      const groups = [];
      for (const c of chapters) {
        const last = groups.at(-1);
        if (last && last.text.length + c.text.length < LIMITS.textChars * 0.6) { last.text += `\n\n${c.text}`; last.titles.push(c.title); } else groups.push({ text: c.text, titles: [c.title] });
      }
      const units = groups.flatMap((g, i) => textUnits(`${name} · ${g.titles.filter(Boolean)[0] || `parte ${i + 1}`}`, g.text, { note: `Parte ${i + 1} de ${groups.length} del libro «${baseName(name)}»` })
        .map((u) => ({ ...u, kind: 'chapter', selected: !book })));
      if (book) {
        units.unshift({ label: `${name} · índice`, kind: 'toc', selected: true, note: 'El índice de un libro: los títulos de sus capítulos y el comienzo de cada uno. Extrae los conceptos de cada capítulo en orden, con sus relaciones',
          make: async () => [{ name: `${baseName(name)} (índice).txt`, type: 'text/plain', text: chapters.map((c, i) => `## ${c.title || `Capítulo ${i + 1}`}\n${c.text.slice(0, 600)}`).join('\n\n').slice(0, LIMITS.textChars) }] });
      }
      return { name, book, units };
    }
    if (/^(docx|pptx|xlsx|odt|odp|ods)$/.test(e) || entries.has('word/document.xml') || entries.has('ppt/presentation.xml') || entries.has('xl/workbook.xml')) {
      const type = e && e !== 'zip' ? e : entries.has('word/document.xml') ? 'docx' : entries.has('ppt/presentation.xml') ? 'pptx' : 'xlsx';
      const text = await officeText(entries, type);
      const figs = type === 'pptx' ? await figures(entries, 'ppt/media/') : type === 'docx' ? await figures(entries, 'word/media/') : [];
      const units = textUnits(name, text, { figures: figs, note: type === 'pptx' ? 'Diapositivas convertidas a texto, con algunas de sus figuras' : '' });
      return units.length ? { name, units } : skipped(name, 'no trae texto ni figuras legibles');
    }
    // A plain ZIP: every file inside.
    if ((opts.depth ?? 0) >= 2) return skipped(name, 'demasiados archivos comprimidos uno dentro de otro');
    const inside = [...entries.values()].filter((x) => !SKIP_ENTRY.test(x.name)).slice(0, LIMITS.zipEntries);
    const units = [];
    const notes = [];
    for (const x of inside) {
      const blob = new File([await x.bytes()], baseName(x.name));
      Object.defineProperty(blob, 'relativePath', { value: `${name}/${x.name}` });
      const sub = await prepare(blob, { depth: (opts.depth ?? 0) + 1 });
      if (sub.skipped) notes.push(`${x.name}: ${sub.skipped}`);
      units.push(...sub.units);
    }
    if (!units.length) return skipped(name, notes[0] ?? 'el ZIP no trae archivos que Studium sepa leer');
    return { name, units, notes };
  }
  if (e === 'ipynb') return { name, units: textUnits(name, notebookText(decodeText(await bytesOf(file)))) };
  if (/^(html?|xhtml)$/.test(e)) return { name, units: textUnits(name, htmlText(decodeText(await bytesOf(file)))) };
  if (TEXT.test(name) || file.type.startsWith('text/')) {
    const text = decodeText(await bytesOf(file));
    return { name, units: textUnits(name, /\.(java|py|c|cpp|cc|h|hpp|js|ts|kt|cs|go|rs|rb|php|sql|m|r|jl|dart|lua|hs|scala|swift)$/i.test(name) ? `\`\`\`${e}\n${text}\n\`\`\`` : text) };
  }
  if (/^(doc|ppt|xls|rtf|pages|key|numbers)$/.test(e)) return skipped(name, `los .${e} antiguos no se leen en el navegador: guárdalo como PDF o como .${e === 'doc' || e === 'rtf' || e === 'pages' ? 'docx' : e === 'ppt' || e === 'key' ? 'pptx' : 'xlsx'}`);
  return skipped(name, 'Studium no sabe leer este formato: expórtalo como PDF');
}

/* ---------- materials that belong together ---------- */
// Photos of the same exam arrive as several files («PrimerParcial1_2.jpg», «PrimerParcial2_2.jpg»): they join into one
// material when they sit in the same folder and their names differ only in the page.
const pageless = (name) => keyName(baseName(name).replace(/\.[a-z0-9]+$/i, '')
  .replace(/[\s_-]*(\(\d+\)|p(?:ag(?:ina)?)?\.?\s*\d+|hoja\s*\d+|\d+\s*(?:de|of|_|-)\s*\d+|\d+)$/i, ''));
const keyName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const folder = (name) => (String(name).includes('/') ? String(name).slice(0, String(name).lastIndexOf('/')) : '');
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Code files of the same folder (a library of classes, a project) are one material too: one class alone teaches little.
export function groupFiles(files) {
  const groups = [];
  for (const file of files) {
    const name = file.webkitRelativePath || file.relativePath || file.name;
    const photo = IMAGE.test(name);
    const code = CODE.test(name) && file.size < 200_000;
    const base = pageless(name);
    const home = photo && base.length >= 4 ? groups.find((g) => g.photo && folder(g.name) === folder(name)
      && (g.base === base || (base.length >= 8 && distance(g.base, base) <= 2)))
      : code ? groups.find((g) => g.code && folder(g.name) === folder(name)) : null;
    if (home) home.files.push(file); else groups.push({ name, base, photo, code, files: [file] });
  }
  for (const g of groups) g.files.sort((a, b) => (a.webkitRelativePath || a.relativePath || a.name).localeCompare(b.webkitRelativePath || b.relativePath || b.name, 'es', { numeric: true }));
  return groups.map((g) => ({
    name: g.files.length > 1 ? (g.code ? `${folder(g.name) || 'código'} (${g.files.length} archivos de código)` : `${g.name} (+${g.files.length - 1})`) : g.name,
    files: g.files, code: g.code && g.files.length > 1,
  }));
}
// The units of a group: one file as prepare() gives it; several photos as one unit with every page.
export async function prepareGroup(group) {
  if (group.files.length === 1) return prepare(group.files[0]);
  if (group.code) {
    const fence = '`'.repeat(3);
    const texts = [];
    for (const f of group.files) {
      const name = f.webkitRelativePath || f.relativePath || f.name;
      texts.push(`--- ${baseName(name)} ---\n${fence}${ext(name)}\n${decodeText(await bytesOf(f))}\n${fence}`);
    }
    return { name: group.name, units: textUnits(group.name, texts.join('\n\n'), { note: `Son ${plural(group.files.length, 'archivo', 'archivos')} de código de la misma carpeta: trátalos como un solo material` }) };
  }
  return {
    name: group.name,
    units: [{
      label: group.name, kind: 'whole', selected: true,
      note: `Son ${plural(group.files.length, 'foto', 'fotos')} del mismo material, en orden`,
      make: async () => (await Promise.all(group.files.map((f) => imagePart(f, baseName(f.webkitRelativePath || f.relativePath || f.name))))).filter(Boolean),
    }],
  };
}
// A PDF part as pictures of its pages, for an AI that reads pictures but not PDFs (Codex through the bridge, for
// example). Large pages go in quarters, as scans do.
export async function pdfPictures(part) {
  const lib = await pdfjs();
  const bytes = Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0));
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
  return pagePictures(doc, 1, doc.numPages, baseName(part.name));
}
// A PDF part as the text of its pages, for an AI that reads neither PDFs nor pictures (Antigravity through the bridge).
// A scan has no text: it comes back empty.
export async function pdfAsText(part) {
  const lib = await pdfjs();
  const bytes = Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0));
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
  const text = (await pageText(doc, 1, doc.numPages)).trim();
  return text.length > 200 ? { name: `${baseName(part.name).replace(/\.pdf$/i, '')}.txt`, type: 'text/plain', text } : null;
}
// What a unit's parts weigh, for the queue.
export const partsSize = (parts) => parts.reduce((s, p) => s + (p.data ? (p.data.length * 3) / 4 : p.text.length), 0);
// A unit's parts as files to download, for a person who takes them to their subscription's chat.
export function partFiles(parts) {
  const bin = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return parts.map((p) => ({ name: p.data ? p.name : p.name.replace(/\.[a-z0-9]+$/i, '') + (p.name.endsWith('.txt') ? '.txt' : '.md'), bytes: p.data ? bin(p.data) : new TextEncoder().encode(p.text) }));
}
