// «Estudia»: one place to drop anything you have for a course (files, folders, photos, links).
// What it does with a drop, in sight:
// - each folder is opened on the table and its things come out; a software project (or a repository) is one thing:
//   its files go back into it, it closes, and the whole folder goes to its place;
// - each thing flies to its pile; piles appear only when something arrives, and they are not fixed: the person's AI may
//   name a new one;
// - the folders' order and names are kept (Semana 1, Semana 2…, Deber 3/…): they travel as context to the graph, so
//   what was organized by weeks keeps that order and structure;
// - keys, passwords and certificates never reach the AI: files that are keys stay out, and any text has its keys
//   hidden before anything else reads it (secrets.js, and again in ai.run).
// Then the course, asked only when it cannot be deduced, and «¿Qué hacemos con esto?»: «Sumar al grafo de
// conocimiento» (on by default; only the anonymous summary leaves) and «Generar una guía de estudio».
// Everything dropped stays on this device (IndexedDB), on the desk of its course.
import { keyOf } from './themes.js';
import { sfx } from './sfx.js';
import * as ai from './ai.js';
import { SECRET_FILE, redact } from './secrets.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const natural = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

// The piles Studium knows; others are made when the person's AI names one.
export const PILES = {
  syllabus: { name: 'Sílabo', color: 'var(--red)' },
  prof: { name: 'Material del profe', color: 'var(--blue)' },
  notes: { name: 'Tus apuntes', color: 'var(--butter)' },
  homework: { name: 'Deberes', color: 'var(--teal)' },
  lab: { name: 'Laboratorios', color: '#5b6cff' },
  project: { name: 'Proyectos', color: '#e8590c' },
  exam: { name: 'Exámenes', color: 'var(--peach)' },
  book: { name: 'Libros', color: 'var(--sky)' },
  code: { name: 'Código y repos', color: '#4b5563' },
  web: { name: 'Páginas web', color: '#0ea5e9' },
};
const custom = new Map(); // key → { name, color } named by the AI in this visit
const pileOf = (k) => PILES[k] ?? custom.get(k) ?? { name: k, color: '#64748b' };
// The kind of material of the knowledge graph each pile is sent as.
const GRAPH_KIND = { syllabus: 'syllabus', prof: 'slides', notes: 'notes', homework: 'homework', lab: 'lab', project: 'other', exam: 'exam', book: 'book', code: 'other', web: 'other' };

/* ---------- what each thing is, from its name and its folders ---------- */
const RULES = [
  ['syllabus', /s[ií]labo|syllab|programa[ _-]?(anal[ií]tico|de[ _-]la[ _-]materia)|course[ _-]?outline/],
  ['exam', /\b(examen|ex[aá]menes|parcial|final|quiz|prueba|midterm|exam)\b|parcial[ _-]?\d|examen[ _-]?\d|quiz[ _-]?\d/],
  ['homework', /\b(deber|tarea|taller|homework|assignment|pset|problem[ _-]?set|ejercicios)\b|deber[ _-]?\d|tarea[ _-]?\d|hw[ _-]?\d/],
  ['lab', /laborator|\blab\b|lab[ _-]?\d|\binforme\b|evidencia|pr[aá]ctica/],
  ['project', /\bproyecto|\bproject\b/],
  ['notes', /apunte|\bnotas?\b|\bnotes\b|cuaderno|resumen|summary|cheat|formulario/],
  ['book', /\blibro\b|\bbook\b|edici[oó]n|edition|cap[ií]tulos? completos|textbook/],
  ['prof', /\bclase\b|clase[ _-]?\d|lecture|slides|diapositiva|cap[ií]tulo|chapter|\btema\b|unidad|semana[ _-]?\d|week[ _-]?\d|presentaci[oó]n/],
];
const CODE = /\.(py|c|cc|cpp|h|hpp|java|js|jsx|ts|tsx|ipynb|rs|go|rb|kt|swift|m|r|sql|cs|php|css|scss|vue|svelte)$/;
const SLIDES = /\.(ppt|pptx|key|odp)$/;
const PHOTO = /\.(jpe?g|png|heic|heif|webp)$/;
const TEXTISH = /\.(txt|md|json|ya?ml|properties|xml|toml|ini|conf|cfg|sh|ps1|env|example|http|sql|py|js|ts|java|kt|go|rs|rb|php|cs|c|cpp|h|gradle|html?|css|csv|b64)$/i;
// The name decides first; then the folders, from the nearest one up (a file in «Deber 3/capturas» is homework).
export function classify(name, path = '', size = 0) {
  const own = name.toLowerCase();
  if (/github\.com\//.test(own)) return { kind: 'code', sure: true };
  if (/^https?:\/\//.test(own)) return { kind: 'web', sure: true };
  for (const [kind, re] of RULES) if (re.test(own)) return { kind, sure: true };
  const dirs = path.toLowerCase().split('/').filter(Boolean).reverse();
  for (const d of dirs) for (const [kind, re] of RULES) if (kind !== 'prof' && re.test(d)) return { kind, sure: true };
  if (CODE.test(own)) return { kind: 'code', sure: true };
  if (SLIDES.test(own)) return { kind: 'prof', sure: true };
  for (const d of dirs) if (RULES.at(-1)[1].test(d)) return { kind: 'prof', sure: true };
  if (PHOTO.test(own)) return { kind: 'notes', sure: false };
  if (/\.pdf$/i.test(own) && size > 20_000_000) return { kind: 'book', sure: false };
  return { kind: '', sure: false };
}
// «Semana 3», «Week 03», «Unidad 2», «Clase 5»: the place of a thing in the course, from its folders and name.
const PLACE = /(semana|week|unidad|unit|cap[ií]tulo|chapter|tema|clase|lecture|m[oó]dulo|module)[ _-]?0*(\d{1,3})/i;
const placeOf = (path, name) => { for (const s of [...path.split('/').reverse(), name]) { const m = s.match(PLACE); if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`; } return ''; };

/* ---------- what is left out: build output, git's history, keys ---------- */
const JUNK_DIRS = new Set(['.git', 'target', 'node_modules', 'build', 'dist', 'out', 'bin', 'obj', '__pycache__', '.idea', '.vscode', '.gradle', '.next', '.venv', 'venv']);
const JUNK = /\.(class|jar|war|lst|original|pyc|pyo|o|obj|exe|dll|so|dylib|lock|log)$|^(\.ds_store|thumbs\.db|desktop\.ini)$/i;
// A folder with one of these is a software project: one thing, not hundreds of files.
const PROJECT = /^(pom\.xml|package\.json|build\.gradle(\.kts)?|settings\.gradle|cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|composer\.json|gemfile|makefile|cmakelists\.txt|[^/]+\.sln|[^/]+\.csproj|dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i;
const relOf = (f) => (f.webkitRelativePath || f.relativePath || '').replace(/^\/+/, '');
// A copy of a file with its keys hidden, keeping its place in the folders.
const cleaned = (f, text) => { const c = new File([text], f.name, { type: f.type || 'text/plain', lastModified: f.lastModified }); Object.defineProperty(c, 'relativePath', { value: relOf(f) }); return c; };

export async function units(files) {
  const rows = files.map((f) => ({ f, path: relOf(f), name: f.name }));
  // The folder that was dropped names the course; it is not part of each thing's path.
  const roots = new Set(rows.map((r) => r.path.split('/')[0]).filter(Boolean));
  const root = roots.size === 1 && rows.every((r) => r.path.includes('/')) ? [...roots][0] : '';
  for (const r of rows) r.rel = root ? r.path.slice(root.length + 1) : (r.path || r.name);
  const skipped = []; const secrets = []; const kept = []; const hidden = [];
  for (const r of rows) {
    const dirs = r.rel.split('/').slice(0, -1);
    if (dirs.some((d) => JUNK_DIRS.has(d.toLowerCase())) || JUNK.test(r.name)) { skipped.push(r); continue; }
    if (SECRET_FILE.test(r.name)) { secrets.push(r); continue; }
    kept.push(r);
  }
  // Keys inside text files are hidden here, before anything reads them.
  await Promise.all(kept.filter((r) => TEXTISH.test(r.name) && r.f.size < 2_000_000).map(async (r) => {
    try { const { text, found } = redact(await r.f.text()); if (found) { r.f = cleaned(r.f, text); hidden.push(r.name); } } catch { /* unreadable: left as it is */ }
  }));
  // Projects: the top-most folders that hold a project's marker (or whose .git was skipped).
  const projectDirs = new Set();
  for (const r of [...kept, ...skipped]) {
    const segs = r.rel.split('/');
    if (PROJECT.test(r.name) && segs.length > 1) projectDirs.add(segs.slice(0, -1).join('/'));
    const g = segs.indexOf('.git'); if (g > 0) projectDirs.add(segs.slice(0, g).join('/'));
  }
  const tops = [...projectDirs].filter((d) => ![...projectDirs].some((o) => o !== d && d.startsWith(`${o}/`)));
  const out = []; const byProject = new Map(); const loose = [];
  for (const r of kept) {
    const top = tops.find((d) => r.rel.startsWith(`${d}/`));
    if (top) { if (!byProject.has(top)) byProject.set(top, []); byProject.get(top).push(r.f); } else loose.push(r);
  }
  // Many photos or screenshots in one folder (a lab's evidence, a notebook's pages) are one thing too.
  const photosIn = new Map();
  for (const r of loose) { const dir = r.rel.split('/').slice(0, -1).join('/'); if (PHOTO.test(r.name.toLowerCase())) photosIn.set(dir, [...(photosIn.get(dir) ?? []), r]); }
  const grouped = new Set([...photosIn].filter(([dir, list]) => dir && list.length >= 4).map(([dir]) => dir));
  for (const r of loose) {
    const dir = r.rel.split('/').slice(0, -1).join('/');
    if (grouped.has(dir) && PHOTO.test(r.name.toLowerCase())) continue;
    out.push({ files: [r.f], name: r.name, path: dir });
  }
  for (const dir of grouped) out.push({ files: photosIn.get(dir).map((r) => r.f), name: dir.split('/').pop(), path: dir.split('/').slice(0, -1).join('/'), photos: true });
  for (const [dir, list] of byProject) out.push({ files: list, name: dir.split('/').pop(), path: dir.split('/').slice(0, -1).join('/'), project: true });
  // In the order of the folders, as a person reads them: Semana 2 before Semana 10.
  out.sort((a, b) => natural(`${a.path}/${a.name}`, `${b.path}/${b.name}`));
  return { units: out, skipped, secrets, hidden, root };
}
// «[CMP-4008.1656] Desarrollo de Software Moderno» → the course and its code.
const courseOfFolder = (name) => { const m = name.match(/^\s*\[([A-Z]{2,4})[ -]?(\d{3,4}[A-Z]?)[^\]]*\]\s*(.+)$/i); return m ? { course: m[3].trim(), code: `${m[1].toUpperCase()}-${m[2]}` } : { course: name.trim(), code: '' }; };

/* ---------- the course, from the folders and the names ---------- */
function guessCourse(item, known) {
  const hay = keyOf(`${item.path} ${item.name}`);
  const hit = known.find((c) => c.key.length > 3 && hay.includes(c.key));
  if (hit) return { course: hit.name, sure: true };
  // The first word of a course in the name («Parcial 2 Redes.pdf» → Redes de Computadores), when only one course has it.
  const words = known.filter((c) => { const w = c.key.split('-')[0]; return w.length >= 5 && hay.split('-').includes(w); });
  if (words.length === 1) return { course: words[0].name, sure: false };
  return { course: '', sure: false };
}

/* ---------- the desk: what was dropped, per course, on this device ---------- */
const DB = 'studium-estudia';
const openDb = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
async function tx(mode, fn) { const db = await openDb(); return new Promise((resolve, reject) => { const t = db.transaction('items', mode); const out = fn(t.objectStore('items')); t.oncomplete = () => resolve(out?.result ?? out); t.onerror = () => reject(t.error); }); }
export const desk = {
  all: async () => { try { return await tx('readonly', (s) => s.getAll()); } catch { return []; } },
  put: async (items) => { try { await tx('readwrite', (s) => { for (const i of items) s.put(i); }); } catch { /* it stays for this visit only */ } },
  remove: async (id) => { try { await tx('readwrite', (s) => s.delete(id)); } catch { /* nothing to remove */ } },
};

/* ---------- the page ---------- */
let api = null; // { ctx, shareToGraph(files, values), startGuide(files, preset), droppedFiles(dataTransfer) }
let batch = []; // this drop: { id, name, path, files, count, url, kind, sure, course, courseSure, code, place }
let run = 0; // a new drop or «Descartar» stops the animation of the one before

const knownCourses = () => {
  const g = api.ctx.state.graph;
  const names = new Set([...(g?.nodes ?? []).filter((n) => n.type === 'course').map((n) => n.name), ...api.ctx.state.catalog.map((x) => x.course), ...api.ctx.state.contributions.map((x) => x.course)].filter(Boolean));
  return [...names].map((name) => ({ name, key: keyOf(name) })).sort((a, b) => b.key.length - a.key.length);
};
const icon = (it) => {
  if (it.url) return '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  if (PHOTO.test(it.name.toLowerCase())) return '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="m5 17 5-5 4 4 2-2 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
  return '<path d="M7 3h7l4 4v14H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v4h4M10 12h5M10 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
};
const FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
const sheet = (it) => `<div class="es-sheet ${it.count > 1 ? 'folder' : ''}" data-item="${it.id}" title="${esc(it.path ? `${it.path}/${it.name}` : it.name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${it.count > 1 ? FOLDER : icon(it)}</svg><span>${esc(it.name)}${it.count > 1 ? ` <small>${it.project ? 'proyecto, ' : ''}${it.count} archivos</small>` : ''}${it.place ? ` <small class="es-place">${esc(it.place)}</small>` : ''}</span></div>`;
const node = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Moves an element to where it is now from where it was: the browser animates only transforms.
function flip(el, first, { rotate = 0, scale = 1, duration = 600 } = {}) {
  if (calm() || !first) return;
  const last = el.getBoundingClientRect();
  el.animate([{ transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) rotate(${rotate}deg) scale(${scale})` }, { transform: 'none' }], { duration, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
}

export async function renderEstudia(el, deps) {
  api = deps;
  const items = await desk.all();
  const byCourse = new Map();
  for (const it of items) { const k = it.course || 'Sin materia'; byCourse.set(k, [...(byCourse.get(k) ?? []), it]); }
  el.innerHTML = `
    <div class="es-drop glass" data-es-drop>
      <div class="es-drop-in">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14a4 4 0 0 1 4-4h8l4 4h12a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M24 20v12m-5-5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h2>Suelta aquí lo que tengas</h2>
        <p>Archivos, carpetas enteras, fotos del cuaderno. Mejor de una materia a la vez.</p>
        <div class="actions"><label class="button primary">Elegir archivos<input type="file" multiple hidden data-es-files></label><label class="button ghost">Elegir una carpeta<input type="file" webkitdirectory multiple hidden data-es-files></label></div>
        <form class="es-link" data-es-link><input type="url" placeholder="O pega un enlace: una página, un repo de GitHub…" aria-label="Pegar un enlace"><button class="button ghost small">Agregar</button></form>
      </div>
    </div>
    <section class="es-table" data-es-table hidden></section>
    ${byCourse.size ? `<section class="es-desks"><h2>Tus escritorios</h2><div class="es-desk-list">${[...byCourse].map(([c, list]) => `<a class="es-desk glass" href="#/estudia/materia/${encodeURIComponent(c)}"><strong>${esc(c)}</strong><span>${list.length} ${list.length === 1 ? 'cosa' : 'cosas'}</span><span class="es-mini">${[...new Set(list.map((x) => x.kind))].map((k) => `<i style="--c:${pileOf(k).color}" title="${esc(pileOf(k).name)}"></i>`).join('')}</span></a>`).join('')}</div></section>` : ''}
    <p class="fine es-mine"><a class="link" href="#/mis-aportes">Lo que publicaste</a>: cambia quién lo ve o bórralo.</p>`;
  wire(el);
}

function wire(el) {
  const zone = $('[data-es-drop]', el);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => { e.preventDefault(); zone.classList.remove('over'); take(el, await api.droppedFiles(e.dataTransfer)); });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-es-files]')) { take(el, [...e.target.files]); e.target.value = ''; } });
  $('[data-es-link]', el).addEventListener('submit', (e) => {
    e.preventDefault(); const input = e.target.querySelector('input'); const url = input.value.trim();
    if (!/^https?:\/\/\S+$/.test(url)) { api.ctx.toast('Eso no parece un enlace.'); return; }
    input.value = ''; take(el, [{ url, name: url, size: 0 }]);
  });
}

/* ---------- 1. sorting, in sight ---------- */
async function take(el, files) {
  if (!files.length) return;
  const ticket = ++run;
  const table = $('[data-es-table]', el);
  table.hidden = false;
  table.innerHTML = '<p class="es-reading">Abriendo…</p>';
  const known = knownCourses();
  const links = files.filter((f) => f.url);
  const { units: list, skipped, secrets, hidden, root } = await units(files.filter((f) => !f.url));
  if (ticket !== run) return;
  const folder = root ? courseOfFolder(root) : null;
  const fresh = [...list, ...links.map((l) => ({ files: [], name: l.url, path: '', url: l.url }))].slice(0, 400).map((u, i) => {
    const size = u.files.reduce((n, f) => n + (f.size ?? 0), 0);
    const it = { id: `e${Date.now().toString(36)}${i}`, name: u.name, path: u.path, size, files: u.files, count: u.files.length, url: u.url ?? '', project: !!u.project, added: Date.now(), place: placeOf(u.path, u.name) };
    const c = classify(u.name, u.path, size);
    // A project takes the kind its folders say (the project of «Deber 1» is homework); otherwise it is code.
    Object.assign(it, u.project ? (c.kind && c.kind !== 'code' && c.sure ? c : { kind: 'code', sure: true }) : c);
    const g = folder?.course ? { course: folder.course, sure: true } : guessCourse(it, known);
    return { ...it, course: g.course, courseSure: g.sure, code: folder?.code ?? '', order: i };
  });
  batch = [...batch, ...fresh];
  table.innerHTML = `
    <div data-es-left></div>
    <div class="es-mesa" data-es-mesa></div>
    <div class="es-piles" data-es-piles></div>
    <div class="es-unsure" data-es-unsure hidden><h3>Esto no lo tengo claro: ¿qué es?</h3><div class="es-unsure-list"></div></div>
    <div class="es-next" data-es-next></div>`;
  const left = [
    skipped.length && `${skipped.length} archivos de compilación o de git, que no le sirven a nadie`,
    secrets.length && `${secrets.length === 1 ? 'un archivo de claves o certificados' : `${secrets.length} archivos de claves o certificados`} (${secrets.slice(0, 3).map((r) => r.name).join(', ')}), que nunca salen de tu computadora`,
  ].filter(Boolean);
  const notes = [left.length && `Dejé fuera ${left.join(' y ')}.`, hidden.length && `Escondí las claves y contraseñas que había dentro de ${hidden.length === 1 ? hidden[0] : `${hidden.length} archivos`}: tu IA no las verá.`].filter(Boolean);
  if (notes.length) $('[data-es-left]', table).innerHTML = `<p class="note">${esc(notes.join(' '))}</p>`;
  table.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  await sort(table, fresh, ticket);
  if (ticket !== run) return;
  next(table);
  askAI(table);
}

// Folder by folder: it opens, its things come out onto the table, projects go back in and close, and each thing flies
// to its pile.
async function sort(table, items, ticket) {
  const mesa = $('[data-es-mesa]', table);
  // The pace follows the amount: a few things take their time; hundreds are sorted in a few seconds.
  const k = items.length <= 20 ? 1 : items.length <= 60 ? 0.6 : items.length <= 150 ? 0.35 : 0.2;
  const wait = (ms) => sleep(calm() ? 0 : ms * k);
  const groups = new Map();
  for (const it of items) { const top = it.path.split('/')[0] || ''; groups.set(top, [...(groups.get(top) ?? []), it]); }
  for (const [name, list] of groups) {
    if (ticket !== run) return;
    const box = node(`<div class="es-box"><div class="es-box-lid"></div><div class="es-box-body"><svg viewBox="0 0 24 24" aria-hidden="true">${FOLDER}</svg><b>${esc(name || 'Sueltos')}</b><small>${list.length} ${list.length === 1 ? 'cosa' : 'cosas'}</small></div></div>`);
    mesa.innerHTML = ''; mesa.append(box);
    if (!calm()) box.animate([{ transform: 'translateY(-30px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    await wait(380);
    box.classList.add('open'); sfx.pick?.();
    const spread = node('<div class="es-spread"></div>'); mesa.append(spread);
    const from = box.getBoundingClientRect();
    const shown = list.slice(0, 40);
    for (const it of shown) {
      const el = node(sheet(it)); spread.append(el);
      flip(el, from, { scale: 0.3, rotate: (Math.random() - 0.5) * 40, duration: 520 * Math.max(k, 0.5) });
      // A project shows its files for a moment, then they go back in and it closes.
      if (it.project && !calm() && k >= 0.35) {
        el.classList.add('spill');
        const peek = node(`<div class="es-peek">${it.files.slice(0, 5).map((f) => `<i>${esc(f.name)}</i>`).join('')}</div>`);
        el.append(peek);
        setTimeout(() => { peek.classList.add('back'); setTimeout(() => { peek.remove(); el.classList.remove('spill'); }, 500); }, 900);
      }
    }
    await wait(list.some((x) => x.project) && k >= 0.35 ? 1500 : 650);
    for (const [i, it] of list.entries()) {
      if (ticket !== run) return;
      const el = spread.querySelector(`[data-item="${it.id}"]`) ?? node(sheet(it));
      const first = el.isConnected ? el.getBoundingClientRect() : from;
      place(table, it, el);
      flip(el, first, { rotate: (Math.random() - 0.5) * 18, duration: 560 * Math.max(k, 0.5) });
      if (i % Math.ceil(3 / k) === 0) sfx.tick?.();
      await wait(Math.max(25, 90 - list.length));
    }
    box.classList.remove('open');
    await wait(260);
    if (!calm()) await box.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.85)' }], { duration: 220 }).finished.catch(() => {});
  }
  mesa.innerHTML = '';
}

// A pile appears when the first thing arrives, in the order Studium knows them; piles the AI names come after.
function pileEl(table, kind) {
  let pile = $(`[data-pile="${CSS.escape(kind)}"]`, table);
  if (pile) return pile;
  const p = pileOf(kind);
  pile = node(`<div class="pile" data-pile="${esc(kind)}" style="--c:${p.color}"><div class="pile-tab">${esc(p.name)} <b data-count>0</b></div><div class="pile-body"></div></div>`);
  const order = Object.keys(PILES);
  const piles = $('[data-es-piles]', table);
  const after = $$('.pile', piles).find((x) => { const a = order.indexOf(x.dataset.pile); const b = order.indexOf(kind); return (a < 0 ? 99 : a) > (b < 0 ? 99 : b); });
  piles.insertBefore(pile, after ?? null);
  if (!calm()) pile.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
  return pile;
}
function place(table, it, el) {
  if (!it.kind || !it.sure) {
    const box = $('[data-es-unsure]', table); box.hidden = false;
    const row = node(`<div class="es-ask" data-ask="${it.id}"><div class="chips small">${Object.entries(PILES).map(([k, p]) => `<button class="chip ${k === it.kind ? 'on' : ''}" data-set-kind="${k}" style="--a:${p.color}">${esc(p.name)}</button>`).join('')}</div></div>`);
    row.prepend(el);
    $('.es-unsure-list', box).append(row);
    return;
  }
  const pile = pileEl(table, it.kind);
  el.style.setProperty('--r', `${(Math.random() - 0.5) * 5}deg`);
  // In the pile, in the order of the folders.
  const body = $('.pile-body', pile);
  const after = $$('.es-sheet', body).find((x) => (batch.find((b) => b.id === x.dataset.item)?.order ?? 0) > it.order);
  body.insertBefore(el, after ?? null);
  $('[data-count]', pile).textContent = String(batch.filter((x) => x.kind === it.kind && x.sure).length);
}

/* ---------- what the names did not say, the person's AI says: one request for all of them ---------- */
async function askAI(table) {
  const unsure = batch.filter((x) => !x.sure);
  if (!unsure.length || !ai.ready()) return;
  const h = $('[data-es-unsure] h3', table);
  if (h) h.textContent = `Tu IA está mirando ${unsure.length === 1 ? 'una cosa' : `${unsure.length} cosas`}…`;
  const kinds = Object.entries(PILES).map(([k, p]) => `${k} (${p.name})`).join(', ');
  // Only names and folders go: never a file's content. Context: the course's folders around each thing.
  const tree = [...new Set(batch.map((x) => x.path).filter(Boolean))].sort(natural).slice(0, 80).join('\n');
  const list = unsure.slice(0, 120).map((x) => `${x.id}\t${x.path ? `${x.path}/` : ''}${x.name}${x.count > 1 ? ` [carpeta de ${x.count} archivos]` : ''}`).join('\n');
  try {
    const res = await ai.run({
      system: `Clasificas el material de una materia universitaria por su nombre y sus carpetas. Tipos que existen: ${kinds}. Responde solo un objeto JSON {"id": "tipo"}. Si nada de la lista le queda, inventa un tipo corto en español con el prefijo "nuevo:" (por ejemplo "nuevo:Facturas electrónicas"). Si de verdad no se puede saber, "?". Lo que está dentro de una carpeta «Deber», «Laboratorio», «Examen» o «Proyecto» es de ese tipo. Un documento con nombre de tema (por ejemplo «DDD, Hexagonal») suele ser material del profe; una «Solución» o un «Informe» es de la entrega que nombra; capturas de pantalla son evidencias de la entrega de su carpeta.`,
      text: `Carpetas de la materia:\n${tree || '(ninguna)'}\n\nPor clasificar (id, ruta):\n${list}`, maxTokens: 2000, use: ai.choice('ask'),
    });
    const answer = JSON.parse(String(res.text ?? res).match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    for (const x of unsure) {
      let k = String(answer[x.id] ?? '');
      if (k.startsWith('nuevo:')) { const name = k.slice(6).trim().slice(0, 40); k = `x-${keyOf(name)}`; if (!custom.has(k)) custom.set(k, { name, color: ['#0f766e', '#9333ea', '#b45309', '#475569'][custom.size % 4] }); }
      if (!PILES[k] && !custom.has(k)) continue;
      x.kind = k; x.sure = true;
      const row = $(`[data-ask="${x.id}"]`, table); const el = row?.querySelector('.es-sheet');
      if (!el) continue;
      const first = el.getBoundingClientRect(); place(table, x, el); row.remove(); flip(el, first);
    }
  } catch (error) { console.warn('[estudia] la IA no pudo clasificar', error); }
  const left = $$('.es-ask', table).length;
  if (h) h.textContent = left ? 'Esto no lo tengo claro: ¿qué es?' : '';
  if (!left) { $('[data-es-unsure]', table).hidden = true; $('.es-next > .note', table)?.remove(); }
}

/* ---------- 2. the course, asked only when it cannot be deduced ---------- */
function next(table) {
  const out = $('[data-es-next]', table);
  const unsure = batch.filter((x) => !x.sure);
  // The course most of the items point to: one course per drop is the usual case.
  const tally = new Map(); for (const x of batch) if (x.course) tally.set(x.course, (tally.get(x.course) ?? 0) + 1);
  const courses = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const sureCourse = batch.every((x) => x.courseSure) && courses.length === 1;
  const known = knownCourses();
  out.innerHTML = `
    ${unsure.length ? `<p class="note">Toca qué es cada cosa de arriba, o déjalo: tu IA lo mirará después.</p>` : ''}
    <div class="es-course glass">
      <label class="field"><span>${sureCourse ? 'Materia' : '¿De qué materia es?'}</span>
        <input data-es-course list="es-courses" value="${esc(courses[0] ?? '')}" placeholder="${courses.length > 1 ? `Encontré varias: ${esc(courses.slice(0, 3).join(', '))}…` : 'Redes de Computadores, Cálculo II…'}" autocomplete="off"></label>
      <datalist id="es-courses">${known.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      ${courses.length > 1 ? '<p class="fine">Parece de varias materias. Lo que pongas aquí vale para todo lo de esta vez; lo demás puedes soltarlo después, materia por materia.</p>' : ''}
    </div>
    <div class="es-what glass">
      <h3>¿Qué hacemos con esto?</h3>
      <label class="toggle"><input type="checkbox" checked disabled><span class="knob"></span>Agregar a tu escritorio de trabajo</label>
      <label class="toggle"><input type="checkbox" data-es-graph checked><span class="knob"></span>Sumar al grafo de conocimiento</label>
      <label class="toggle"><input type="checkbox" data-es-guide><span class="knob"></span>Generar una guía de estudio</label>
      <p class="fine">Al grafo va solo el resumen anónimo que hace tu IA, después de que lo revises, con el orden de tus carpetas. Tu escritorio guarda tus carpetas de cada materia en este dispositivo.</p>
      <div class="actions"><button class="button primary" data-es-go>Listo</button><button class="button ghost" data-es-cancel>Descartar</button></div>
    </div>`;
  if (!table.dataset.wired) {
    table.dataset.wired = '1';
    table.addEventListener('click', (e) => {
      const set = e.target.closest('[data-set-kind]');
      if (set) {
        const row = set.closest('[data-ask]'); const it = batch.find((x) => x.id === row.dataset.ask);
        it.kind = set.dataset.setKind; it.sure = true;
        const el = row.querySelector('.es-sheet'); const first = el.getBoundingClientRect();
        place(table, it, el); row.remove(); flip(el, first, { duration: 500 });
        if (!$('.es-ask', table)) { $('[data-es-unsure]', table).hidden = true; $('.es-next > .note', table)?.remove(); }
        sfx.pick?.();
      }
      if (e.target.closest('[data-es-cancel]')) { run += 1; batch = []; table.hidden = true; table.innerHTML = ''; delete table.dataset.wired; }
      if (e.target.closest('[data-es-go]')) go(table);
    });
  }
}

/* ---------- 3. what to do with it ---------- */
async function go(table) {
  const course = $('[data-es-course]', table).value.trim();
  if (!course) { $('[data-es-course]', table).focus(); api.ctx.toast('¿De qué materia es? Con eso basta.'); return; }
  const toGraph = $('[data-es-graph]', table).checked;
  const toGuide = $('[data-es-guide]', table).checked;
  for (const it of batch) { it.course = course; if (!it.kind) it.kind = 'notes'; }
  const code = batch.find((x) => x.code)?.code ?? '';
  // On the desk of the course, on this device. Links have no file to keep.
  await desk.put(batch.map(({ files: fs, ...rest }) => ({ ...rest, course, blobs: (fs ?? []).map((f) => ({ name: f.name, path: relOf(f), blob: f })), shared: toGraph })));
  const withFiles = batch.filter((x) => x.files?.length).sort((a, b) => a.order - b.order);
  const files = withFiles.flatMap((x) => x.files);
  // To the graph thing by thing, in the folders' order, each with where it was: «Semana 3/Clase 2», «Deber 1».
  if (toGraph && files.length) {
    for (const x of withFiles) await api.shareToGraph(x.files, { kind: GRAPH_KIND[x.kind] ?? 'other', course, code, folder: [x.path, x.count > 1 ? x.name : ''].filter(Boolean).join('/'), place: x.place });
  }
  const done = batch; batch = [];
  if (toGuide) api.startGuide(files, { course, piles: [...new Set(done.map((x) => x.kind))], exams: done.filter((x) => x.kind === 'exam').map((x) => x.name), links: done.filter((x) => x.url).map((x) => x.url) });
  else location.hash = toGraph && files.length ? '#/estudia/grafo' : `#/estudia/materia/${encodeURIComponent(course)}`;
}

/* ---------- the desk of a course ---------- */
export async function renderDesk(el, course, deps) {
  api = deps;
  const items = (await desk.all()).filter((x) => (x.course || 'Sin materia') === course).sort((a, b) => natural(`${a.path}/${a.name}`, `${b.path}/${b.name}`));
  const { catalog, contributions } = api.ctx.state;
  const mine = [...catalog.map((x) => ({ ...x, type: 'guide' })), ...contributions].filter((x) => x.mine && keyOf(x.course) === keyOf(course));
  const kinds = [...new Set(items.map((x) => x.kind))].sort((a, b) => { const o = Object.keys(PILES); return (o.indexOf(a) + 1 || 99) - (o.indexOf(b) + 1 || 99); });
  el.innerHTML = `
    <p class="kicker"><a class="link" href="#/estudia">← Estudia</a></p>
    <h2 class="es-desk-title">${esc(course)}</h2>
    <div class="es-piles desk">${kinds.map((k) => `<div class="pile" style="--c:${pileOf(k).color}"><div class="pile-tab">${esc(pileOf(k).name)} <b>${items.filter((x) => x.kind === k).length}</b></div><div class="pile-body">${items.filter((x) => x.kind === k).map((it) => sheet(it).replace('<div class="es-sheet', `<div data-open="${it.id}" class="es-sheet`)).join('')}</div></div>`).join('') || '<p class="muted">Este escritorio está vacío en este dispositivo.</p>'}</div>
    <div class="actions"><button class="button primary" data-desk-guide>Generar una guía con esto</button><a class="button ghost" href="#/estudia">Soltar más</a></div>
    ${mine.length ? `<h3>Lo que hiciste de esta materia</h3><ul class="es-made">${mine.map((x) => `<li>${x.type === 'guide' ? `<a href="#/guia/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <small class="muted">guía</small>` : `${esc(x.title)} <small class="muted">en el grafo</small>`}</li>`).join('')}</ul>` : ''}`;
  el.onclick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { const it = items.find((x) => x.id === open.dataset.open); const b = it?.blobs?.[0]?.blob ?? it?.blob; if (it?.url) window.open(it.url, '_blank', 'noopener'); else if (b && (it.count ?? 1) <= 1) window.open(URL.createObjectURL(b), '_blank', 'noopener'); }
    if (e.target.closest('[data-desk-guide]')) {
      api.startGuide(items.flatMap((x) => (x.blobs ?? (x.blob ? [{ name: x.name, blob: x.blob }] : [])).map((b) => new File([b.blob], b.name, { type: b.blob.type }))), { course, piles: [...new Set(items.map((x) => x.kind))], exams: items.filter((x) => x.kind === 'exam').map((x) => x.name), links: items.filter((x) => x.url).map((x) => x.url) });
    }
  };
}
