// Reads the minors USFQ publishes on its public page (www.usfq.edu.ec/es/oferta-academica/minors): each minor's page
// and its PDF, into Studium's own format: name, who it is open to, the credits it asks for, its classes (code, name),
// the rules the PDF words in a sentence («aprobar 5 materias del siguiente listado»), and where it was read. Run by an
// admin, never from members' browsers; needs `pdftotext` (poppler) on the PATH:
//
//   node tools/minors.mjs
//
// Writes public/data/minors/index.json. Requests go one at a time with a pause. The PDFs are made by each college and
// differ: what is not clear stays as the PDF's link, and the person reads it there.
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SITE = 'https://www.usfq.edu.ec';
const LIST = `${SITE}/es/oferta-academica/minors`;
const OUT = new URL('../public/data/minors/', import.meta.url);
const PAUSE = 700;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&(\w+);/g, (m, n) => ENT[n] ?? m);

async function get(url, binary = false) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Studium minors reader)' } });
      if (res.ok) { const out = binary ? Buffer.from(await res.arrayBuffer()) : await res.text(); await wait(PAUSE); return out; }
      if (res.status === 404) return null;
    } catch { /* tried again */ }
    await wait(2000 * (i + 1));
  }
  return null;
}
const pdfText = (file) => new Promise((resolve) => execFile('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 8 << 20 }, (e, out) => resolve(e ? '' : out)));

// A class row starts at the left margin with its code; the prerequisites, further right, are not classes of the minor.
const ROW = /^\s{0,3}([A-Z]{3,4})\s*-?\s*(\d{4}[A-Z]?)\s+(.+?)(?:\s{3,}|$)/;
function read(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const classes = [];
  const seen = new Set();
  for (const l of lines) {
    const m = l.match(ROW);
    if (!m) continue;
    // Two columns side by side leave another code at the start of the name («MAT 3002 MAT 1302 Cálculo…»): that
    // second code is the class named; the first one belongs to the other column.
    const inner = m[3].match(/^([A-Z]{3,4})\s*-?\s*(\d{4}[A-Z]?)\s+(.*)$/);
    const code = inner ? `${inner[1]} ${inner[2]}` : `${m[1]} ${m[2]}`;
    const name = (inner ? inner[3] : m[3]).replace(/\s+\d{1,2}$/, '').trim();
    if (seen.has(code) || name.length < 3 || /^(cursos?|escoger|electiv|optativ|obligatori)/i.test(name)) continue;
    seen.add(code);
    classes.push({ code, name });
  }
  const flat = lines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const credits = Number(flat.match(/N[úu]mero de cr[ée]ditos:?\s*(\d{1,2})/i)?.[1] ?? 0) || 0;
  const audience = flat.match(/Dirigido a:?\s*(.+?)(?=N[úu]mero de cr[ée]ditos|C[ÓO]DIGO|Prerrequisitos|$)/i)?.[1].trim().slice(0, 300) ?? '';
  // Sentences that say how to choose: «el estudiante debe aprobar 5 materias del siguiente listado».
  const rules = [...flat.matchAll(/(El estudiante debe[^.]{5,220}\.|Escoger \d+ cursos?[^.]{0,160}?(?=\s(?:C[ÓO]DIGO|Cursos|Informaci)|\.|$)|No aplican[^.]{5,220}\.|\d+ cursos? de [A-Z]{3} nivel \d{4} o mayor)/gi)]
    .map((m) => m[0].trim()).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);
  return { classes, credits, audience, rules };
}

const links = new Set();
for (let p = 0; p < 20; p++) {
  const html = await get(`${LIST}?page=${p}`);
  const found = [...(html ?? '').matchAll(/href="(\/es\/oferta-academica\/minors\/[^"#?]+)"/g)].map((m) => m[1]);
  const before = links.size;
  for (const f of found) links.add(f);
  if (links.size === before) break;
}
console.log(`${links.size} minors`);
const dir = await mkdtemp(path.join(tmpdir(), 'studium-minors-'));
const minors = [];
for (const href of [...links].sort()) {
  const url = SITE + href;
  const html = await get(url);
  if (!html) continue;
  const name = unent(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1].replace(/<[^>]+>/g, '').trim() ?? '') || unent(html.match(/"name":\s*"(Minor[^"]+)"/)?.[1] ?? '');
  // The minor's own PDF (a link may carry «?itok=…»); a page with several takes the newest («2026-10/…»).
  // (some pages link it through the site's content server, drupalnuevodev…: the same file is on www.usfq.edu.ec).
  const pdfs = [...html.matchAll(/href="(?:https:\/\/[a-z0-9.-]+)?(\/sites\/default\/files\/[^"?]+\.pdf)(?:\?[^"]*)?"/gi)].map((m) => SITE + m[1]).filter((u, i, a) => a.indexOf(u) === i);
  const pdf = pdfs.sort((a, b) => b.localeCompare(a))[0] ?? '';
  const college = unent(html.match(/Colegio de [^<"]{3,80}/)?.[0] ?? '');
  let info = { classes: [], credits: 0, audience: '', rules: [] };
  if (pdf) {
    const buf = await get(pdf, true);
    if (buf) { const f = path.join(dir, 'm.pdf'); await writeFile(f, buf); info = read(await pdfText(f)); }
  }
  const id = href.split('/').pop().replace(/^minor-en-/, '');
  minors.push({ id, name: name.replace(/\s+/g, ' '), college, url, pdf, ...info });
  console.log(`${info.classes.length ? '✓' : '·'} ${name} (${info.classes.length} clases, ${info.credits} cr)`);
}
await rm(dir, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await writeFile(new URL('index.json', OUT), `${JSON.stringify({ read: new Date().toISOString().slice(0, 10), source: LIST, minors }, null, 1)}\n`);
console.log(`Escrito public/data/minors/index.json: ${minors.length} minors, ${minors.filter((m) => m.classes.length).length} con su lista de clases.`);
