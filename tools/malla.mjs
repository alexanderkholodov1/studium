// Reads the curricula («mallas») USFQ publishes on its public page, into Studium's own format: every class with its
// semester, credits and prerequisites (with the minimum grade), the places a student chooses (optativas, electivas,
// humanidades…), and the general requirements as the page words them. Run by an admin, never from members' browsers:
//
//   node tools/malla.mjs 1CMP            one career (its code, as the page names it)
//   node tools/malla.mjs --all           every undergraduate career
//
// Writes public/data/mallas/<code>.json and public/data/mallas/index.json. Requests go one at a time with a pause,
// and a class's prerequisites are asked once even when many careers share it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://wsexternal.usfq.edu.ec/MallaCurricular-USFQ';
const OUT = new URL('../public/data/mallas/', import.meta.url);
const PAUSE = 600;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const text = (html) => String(html ?? '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(\w+);/g, (m, n) => ENT[n] ?? m)
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'user-agent': 'Mozilla/5.0 (Studium malla reader)' } });
      if (res.ok) { await wait(PAUSE); return await res.text(); }
    } catch { /* tried again */ }
    await wait(2000 * (i + 1));
  }
  throw new Error(`Sin respuesta: ${path}`);
}

// A place of the malla where the student chooses: its kind, and what it accepts when the page says it.
const SLOT = [
  [/^OPT\b/i, 'optativa'], [/^ELECTIVA\b/i, 'electiva'], [/^HUM\b/i, 'humanidades'], [/^ARTE?\b/i, 'arte'], [/^CCSS\b/i, 'ccss'],
];
const slotOf = (code) => SLOT.find(([re]) => re.test(code))?.[1] ?? '';
// «CMP 4004E» is taught in English: the same class as CMP 4004 for its prerequisites.
const split = (code) => { const m = code.match(/^([A-Z]{2,4})\s*(\d{3,4})([A-Z]?)$/); return m ? { subj: m[1], crse: m[2], en: !!m[3] } : null; };

// Banner's prerequisite table: rows of «(», AND/OR, subject, number, name, grade, «)». It becomes a tree: { all: [...] },
// { any: [...] } or { code, name, grade }, with AND binding closer than OR, as Banner reads it.
function prereqTree(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1])));
  const tokens = [];
  for (const r of rows) {
    const [open, op, subj, crse, name, grade, close] = r;
    if (op) tokens.push(op.toUpperCase().startsWith('O') ? 'OR' : 'AND');
    for (const ch of open ?? '') if (ch === '(') tokens.push('(');
    if (subj) tokens.push({ code: `${subj} ${crse}`.trim(), name: name ?? '', grade: grade || '' });
    for (const ch of close ?? '') if (ch === ')') tokens.push(')');
  }
  let i = 0;
  const flat = (kind, xs) => (xs.length === 1 ? xs[0] : { [kind]: xs.flatMap((x) => (x[kind] ? x[kind] : [x])) });
  const atom = () => { const t = tokens[i++]; if (t === '(') { const e = or(); if (tokens[i] === ')') i++; return e; } return t; };
  const and = () => { const xs = [atom()]; while (tokens[i] === 'AND') { i++; xs.push(atom()); } return flat('all', xs.filter(Boolean)); };
  const or = () => { const xs = [and()]; while (tokens[i] === 'OR') { i++; xs.push(and()); } return flat('any', xs.filter(Boolean)); };
  return tokens.length ? or() : null;
}

const prereqCache = new Map();
async function prereqs(code) {
  const s = split(code);
  if (!s) return null;
  const key = `${s.subj} ${s.crse}`;
  if (!prereqCache.has(key)) {
    const html = await get(`/DetalleMallaCurricular/PreRequisitos?materia=x&area=${s.subj}&curso=${s.crse}&codigoMalla=${encodeURIComponent(key)}`);
    prereqCache.set(key, prereqTree(html));
  }
  return prereqCache.get(key);
}

// The page's notes (Colegio General, the guide to the specialization), in Spanish: each a title and its text.
function notesOf(html) {
  const out = [];
  const re = /font-weight:\s*bold;padding-top:\s*5px[^>]*>([\s\S]*?)<\/div>\s*<div style="text-align:\s*justify[^>]*>([\s\S]*?)<\/div>/gi;
  for (const m of html.matchAll(re)) {
    const title = text(m[1]).replace(/\n/g, ' '); const body = text(m[2]);
    // The page says everything twice, in Spanish and in English: Studium keeps the Spanish.
    const english = /\b(the|students?|must|courses?)\b/i.test(body) && !/\b(los|las|estudiantes?|deben?|materias?)\b/i.test(body);
    if (title && body && !english && !out.some((n) => n.title === title)) out.push({ title, text: body });
  }
  for (const m of html.matchAll(/>\s*(\*\s*[^<]{20,})</g)) {
    const t = text(m[1]);
    const english = /\b(the|students?|must|courses?)\b/i.test(t) && !/\b(los|las|estudiantes?|deben?|materias?)\b/i.test(t);
    if (!english && !out.some((n) => n.text === t)) out.push({ title: '', text: t });
  }
  return out;
}

async function career(code, about = {}) {
  const html = (await get(`/DetalleMallaCurricular/DetalleMalla?codigoCarrera=${encodeURIComponent(code)}&out=1`)).replace(/<!--[\s\S]*?-->/g, '');
  const info = [...(html.match(/<div class="col-md-6 text-center info">([\s\S]*?)<\/div>/i)?.[1] ?? '').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => text(m[1]));
  const [, college = '', name = about.Descripcion ?? code, modality = ''] = info;
  const semesters = [];
  let year = '';
  const parts = html.split(/(<h4>[\s\S]*?<\/h4>|<table class="table table-usfq[\s\S]*?<\/table>)/i);
  for (const part of parts) {
    if (/^<h4>/i.test(part)) { year = text(part); continue; }
    if (!/^<table class="table table-usfq/i.test(part)) continue;
    const term = text(part.match(/<th>[\s\S]*?<\/th>\s*<th>([\s\S]*?)<\/th>/i)?.[1]);
    const classes = [];
    for (const row of part.matchAll(/<tr>\s*<td class="descripcionmateria">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/gi)) {
      const c = text(row[1]); const [es = '', en = ''] = text(row[2]).split('\n');
      const credits = Number((text(row[3]).match(/\d+(?:[.,]\d+)?/)?.[0] ?? '0').replace(',', '.'));
      const slot = slotOf(c);
      const item = { code: c, name: es, ...(en && en !== es ? { en } : {}), credits };
      if (slot) item.slot = slot;
      else { const s = split(c); if (s?.en) item.english = true; const pre = await prereqs(c); if (pre) item.pre = pre; }
      classes.push(item);
    }
    semesters.push({ year: year.split(' / ')[0], term: term.split(' / ')[0], classes });
  }
  const total = Number(html.match(/TOTAL DE CR[ÉE]DITOS:\s*<span>(\d+)/i)?.[1] ?? 0);
  return {
    code, name: name.split(' / ')[0], title: about.Titulo ?? '', college, modality, total, semesters, notes: notesOf(html),
    source: { url: `${BASE}/DetalleMallaCurricular/DetalleMalla?codigoCarrera=${code}`, read: new Date().toISOString().slice(0, 10) },
  };
}

const args = process.argv.slice(2);
const list = JSON.parse(await get('/MallaCurricular/ObtenerCarreras?selectedValue=UG'));
const codes = args.includes('--all') ? list.map((c) => c.Codigo) : args.filter((a) => !a.startsWith('--'));
if (!codes.length) { console.log('Uso: node tools/malla.mjs <código de carrera> | --all'); process.exit(1); }
await mkdir(OUT, { recursive: true });
let index = [];
try { index = JSON.parse(await readFile(new URL('index.json', OUT), 'utf8')); } catch { /* the first one */ }
for (const code of codes) {
  const about = list.find((c) => c.Codigo === code) ?? {};
  try {
    const m = await career(code, about);
    const n = m.semesters.reduce((a, s) => a + s.classes.length, 0);
    if (!n) { console.log(`${code}: la página no tiene materias, se omite`); continue; }
    await writeFile(new URL(`${code}.json`, OUT), JSON.stringify(m, null, 1) + '\n');
    index = [...index.filter((c) => c.code !== code), { code, name: m.name, title: m.title, college: m.college, modality: m.modality, read: m.source.read }].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    await writeFile(new URL('index.json', OUT), JSON.stringify(index, null, 1) + '\n');
    console.log(`${code}: ${m.name}, ${m.semesters.length} semestres, ${n} materias, ${m.total} créditos`);
  } catch (e) { console.log(`${code}: ${e.message}`); }
}
