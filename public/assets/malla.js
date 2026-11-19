// «Mi malla»: the person's career as the university publishes it, semester by semester. They mark what they passed,
// and Studium says what they can take now and what each class asks for. The mallas come from USFQ's public page
// (tools/malla.mjs), with the date they were read; the person's career and what they passed live in their profile.
// Advice, never orders: the malla is a guide, the student decides, and the registry office has the last word.
import { prefs } from './prefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DATA = () => new URL('data/mallas/', document.baseURI);
const OFFER_URL = 'https://catalogodecursos.usfq.edu.ec/';
let index = null;
const cache = new Map();
export function careers() {
  index ??= fetch(new URL('index.json', DATA())).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return index;
}
export function mallaOf(code) {
  if (!code) return Promise.resolve(null);
  if (!cache.has(code)) cache.set(code, fetch(new URL(`${encodeURIComponent(code)}.json`, DATA())).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(code);
}
export const myMalla = () => mallaOf(prefs.get().malla);

/* ---------- what a class asks for ---------- */
// «MAT-1202» from the course offering and «MAT 1202» from the malla are the same class; «CMP 4004E» is its English
// version, and counts as the same.
export const norm = (code) => String(code ?? '').toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const base = (code) => norm(code).replace(/^([A-Z]+ \d{3,4})E$/, '$1');
const passedSet = () => new Set(prefs.get().passed.map(base));
// Whether a prerequisite tree is met by what the person passed. The English exam (ESLEXO) is not something Studium
// knows, so it never counts by itself.
export function meets(tree, passed = passedSet()) {
  if (!tree) return true;
  if (tree.all) return tree.all.every((t) => meets(t, passed));
  if (tree.any) return tree.any.some((t) => meets(t, passed));
  return tree.code !== 'ESLEXO' && passed.has(base(tree.code));
}
const GRADE = (g) => (/^[A-D]$/.test(g) ? ` con ${g} o más` : '');
const one = (t) => (t.code === 'ESLEXO' ? 'tu examen de ubicación de inglés' : `${t.name || t.code} (${t.code})${GRADE(t.grade)}`);
// A prerequisite in words: «Estructuras de Datos (CMP 3002) con C o más, o …».
export function words(tree) {
  if (!tree) return '';
  if (tree.all) return tree.all.map((t) => (t.any ? `(${words(t)})` : words(t))).join(' y ');
  if (tree.any) return tree.any.map((t) => (t.all ? `(${words(t)})` : words(t))).join(' o ');
  return one(tree);
}
// What is still missing of a tree, said as briefly as it can: the first alternative that belongs to this malla.
function missing(tree, malla, passed = passedSet()) {
  if (!tree || meets(tree, passed)) return '';
  if (tree.all) return tree.all.filter((t) => !meets(t, passed)).map((t) => missing(t, malla, passed)).join(' y ');
  if (tree.any) {
    const inMalla = tree.any.find((t) => !t.any && !t.all && classOf(malla, t.code));
    return inMalla ? one(inMalla) : words(tree);
  }
  return one(tree);
}
const all = (malla) => malla?.semesters.flatMap((s, i) => s.classes.map((c) => ({ ...c, sem: i }))) ?? [];
export const classOf = (malla, code) => all(malla).find((c) => base(c.code) === base(code));
const mentions = (tree, code) => !!tree && (tree.code ? base(tree.code) === base(code) : (tree.all ?? tree.any).some((t) => mentions(t, code)));
const opens = (malla, code) => all(malla).filter((c) => mentions(c.pre, code));
// For a class someone adds to a draft: what their malla says it needs, if they have not marked it passed.
export async function prereqNote(code) {
  const malla = await myMalla();
  const c = malla && classOf(malla, code);
  if (!c?.pre || meets(c.pre)) return null;
  return { name: c.name, needs: missing(c.pre, malla) };
}

/* ---------- the page ---------- */
const semName = (malla, i) => {
  const s = malla.semesters[i];
  if (/VERANO/i.test(s.term)) return 'Verano';
  const n = malla.semesters.slice(0, i + 1).filter((x) => !/VERANO/i.test(x.term)).length;
  return `Semestre ${n}`;
};
const SLOTS = { optativa: 'Optativa', electiva: 'Electiva libre', humanidades: 'Humanidades', arte: 'Arte', ccss: 'Ciencias sociales' };
// «Optativa 2/3» says «2 de 3»; «Humanidades: LIT/FIL/ARH/ESC» says which areas count.
const slotNote = (c) => { const n = c.name.match(/(\d)\/(\d)\s*$/); return n ? `${n[1]} de ${n[2]}` : c.name.split(':')[1]?.trim() ?? ''; };
// The practicum (PAS) asks for 75 credits passed, as the malla's notes say; nothing else is known beyond the tree.
let creditsDone = 0;
const PRACTICUM = 75;
const practicum = (c) => /^PAS /.test(c.code);
// The capstone is for the last semester: it is never proposed as «puedes tomar ahora».
const last = (c) => /proyecto integrador|trabajo de titulaci|tesis/i.test(c.name);
const stateOf = (c, passed) => (passed.has(base(c.code)) ? 'passed' : meets(c.pre, passed) && !(practicum(c) && creditsDone < PRACTICUM) ? 'ready' : 'locked');
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
let root = null;
let open = '';

// «INGENIERÍA EN CIENCIAS DE LA COMPUTACIÓN» reads «Ingeniería en Ciencias de la Computación».
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'con', 'para', 'a']);
export const title = (s) => String(s ?? '').toLowerCase().replace(/[\p{L}]+/gu, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
function picker(list, current) {
  return `<label class="field malla-career"><span>Tu carrera</span><select data-malla-career>
    <option value="">Elige tu carrera…</option>
    ${list.map((c) => `<option value="${esc(c.code)}" ${c.code === current ? 'selected' : ''}>${esc(title(c.name))}</option>`).join('')}
  </select></label>`;
}
function card(c, passed, malla) {
  const st = stateOf(c, passed);
  const label = st === 'passed' ? 'aprobada' : st === 'ready' ? 'puedes tomarla' : 'te falta un prerrequisito';
  return `<div class="malla-class ${st} ${c.slot ? 'slot' : ''} ${open === c.code ? 'open' : ''}">
    <button class="malla-mark" data-malla-mark="${esc(c.code)}" aria-pressed="${st === 'passed'}" title="${st === 'passed' ? 'Quitar de aprobadas' : 'Marcar como aprobada'}">
      <span class="malla-state" aria-hidden="true">${st === 'passed' ? CHECK : st === 'locked' ? LOCK : ''}</span>
      <span class="malla-name">${esc(c.slot ? SLOTS[c.slot] ?? c.name : c.name)}</span>
      <small>${esc(c.slot ? slotNote(c) : c.code)} · ${c.credits} cr</small>
      <span class="sr-only">, ${label}</span>
    </button>
    ${c.pre || opens(malla, c.code).length ? `<button class="malla-info" data-malla-info="${esc(c.code)}" aria-label="Qué pide y qué abre ${esc(c.name)}" aria-expanded="${open === c.code}">?</button>` : ''}
  </div>`;
}
function detail(malla, passed) {
  const c = open && classOf(malla, open);
  if (!c) return '';
  const next = opens(malla, c.code);
  const st = stateOf(c, passed);
  return `<aside class="malla-detail glass" aria-live="polite">
    <button class="link close" data-malla-info="">Cerrar</button>
    <h3>${esc(c.name)} <small>${esc(c.code)} · ${c.credits} créditos · ${esc(semName(malla, c.sem))}</small></h3>
    ${c.pre ? `<p><b>Pide:</b> ${esc(words(c.pre))}.</p>` : practicum(c) ? `<p><b>Pide:</b> ${PRACTICUM} créditos aprobados, o estar desde el sexto semestre. Llevas ${creditsDone}.</p>` : last(c) ? '<p>Se toma en el último semestre de la carrera.</p>' : '<p>No pide prerrequisitos.</p>'}
    ${st === 'locked' && c.pre ? `<p class="malla-missing">Según lo que marcaste, te falta ${esc(missing(c.pre, malla, passed))}.</p>` : ''}
    ${next.length ? `<p><b>Abre:</b> ${next.map((x) => esc(x.name)).join(', ')}.</p>` : ''}
  </aside>`;
}
function now(malla, passed) {
  const ready = all(malla).filter((c) => stateOf(c, passed) === 'ready' && !last(c));
  if (!ready.length) return '';
  // Each kind of free place once: «una optativa», not three.
  const seen = new Set();
  const list = ready.filter((c) => !c.slot || (!seen.has(c.slot) && seen.add(c.slot)));
  return `<section class="malla-now">
    <h2>Puedes tomar ahora <small>${list.length}</small></h2>
    <p class="fine">Según lo que marcaste, ya cumples lo que piden. No todas se abren cada semestre: revisa la <a href="${OFFER_URL}" target="_blank" rel="noopener">Oferta de cursos ↗</a>.</p>
    <ul>${list.slice(0, 18).map((c) => `<li><b>${esc(c.slot ? SLOTS[c.slot] ?? c.name : c.name)}</b> <small>${esc([c.slot ? slotNote(c).replace(/^\d de \d$/, '') : c.code, semName(malla, c.sem)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>
  </section>`;
}
function notes(malla) {
  if (!malla.notes?.length) return '';
  return `<details class="malla-notes"><summary>Requisitos de tu carrera <small>${malla.notes.length}</small></summary>
    <ul>${malla.notes.map((n) => `<li>${n.title ? `<b>${esc(n.title)}</b> ` : ''}${esc(n.text.replace(/^\*\s*/, ''))}</li>`).join('')}</ul>
    <p class="fine">Copiado de la <a href="${esc(malla.source.url)}" target="_blank" rel="noopener">malla publicada por la U ↗</a>.</p></details>`;
}

export async function renderMalla() {
  root = document.querySelector('#malla');
  if (!root) return;
  const [list, malla] = await Promise.all([careers(), myMalla()]);
  const p = prefs.get();
  if (!malla) {
    root.innerHTML = `<div class="malla-empty glass">
      <h2>Tu carrera, materia por materia</h2>
      <p>Elige tu carrera y marca lo que ya aprobaste. Studium te dice qué puedes tomar ahora y qué pide cada materia.</p>
      ${list.length ? picker(list, p.malla) : '<p class="msg">Las mallas no se pudieron cargar. Vuelve a intentar en un rato.</p>'}
      <p class="fine">Las mallas vienen de la página pública de la U. Son una guía: si algo no cuadra, la última palabra la tiene la U.</p>
    </div>`;
    return;
  }
  const passed = passedSet();
  const done = all(malla).filter((c) => passed.has(base(c.code)));
  const cr = done.reduce((a, c) => a + c.credits, 0);
  creditsDone = cr;
  const pct = malla.total ? Math.min(100, Math.round((cr / malla.total) * 100)) : 0;
  root.innerHTML = `
    <div class="malla-top">
      <div class="malla-where"><a class="back" href="#/horario">← Mi horario</a><h1 class="sched-title">Mi malla</h1><span class="muted">${esc(title(malla.name))}</span></div>
      <div class="malla-progress"><b>${cr}</b> de ${malla.total} créditos <span class="bar"><i style="width:${pct}%"></i></span></div>
      <details class="sched-more"><summary class="button ghost small">Opciones</summary><div class="menu glass">
        ${picker(list, p.malla)}
        <a href="${esc(malla.source.url)}" target="_blank" rel="noopener">Ver la malla en la página de la U ↗</a>
        ${passed.size ? '<button class="danger" data-malla-clear>Desmarcar todo</button>' : ''}</div></details>
    </div>
    <p class="malla-help">${done.length ? 'Toca una materia para marcarla o desmarcarla. El «?» dice qué pide y qué abre.' : 'Toca cada materia que ya aprobaste, o el círculo de un semestre para marcarlo entero. El «?» dice qué pide y qué abre.'}</p>
    <div class="malla-grid" style="--cols:${malla.semesters.length}">
      ${malla.semesters.map((s, i) => `<section class="malla-sem" aria-label="${esc(semName(malla, i))}">
        <header><b>${esc(semName(malla, i))}</b>${((on) => `<button class="malla-all ${on ? 'on' : ''}" data-malla-sem="${i}" aria-pressed="${on}" title="${on ? 'Desmarcar este semestre' : 'Marcar todo este semestre como aprobado'}" aria-label="${on ? 'Desmarcar' : 'Marcar todo'} ${esc(semName(malla, i))}">${CHECK}</button>`)(s.classes.every((c) => passed.has(base(c.code))))}</header>
        ${s.classes.map((c) => card({ ...c, sem: i }, passed, malla)).join('')}
      </section>`).join('')}
    </div>
    ${detail(malla, passed)}
    <div class="malla-below">${now(malla, passed)}${notes(malla)}
      <p class="fine">Leída de la página pública de la U el ${esc(malla.source.read)}. Es una guía para planear: tú decides, y la última palabra la tiene la U.</p></div>`;
}

function mark(codes, on) {
  const p = new Set(prefs.get().passed);
  for (const c of codes) { if (on) p.add(norm(c)); else { p.delete(norm(c)); for (const x of [...p]) if (base(x) === base(c)) p.delete(x); } }
  prefs.set({ passed: [...p] });
}
export function mountMalla() {
  document.addEventListener('change', (e) => {
    if (!e.target.matches?.('[data-malla-career]')) return;
    open = '';
    prefs.set({ malla: e.target.value });
    renderMalla();
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest?.('[data-malla-mark],[data-malla-info],[data-malla-sem],[data-malla-clear]');
    if (!t || !t.closest('#malla')) return;
    const malla = await myMalla();
    if (!malla) return;
    if (t.dataset.mallaMark !== undefined) { const code = t.dataset.mallaMark; mark([code], !passedSet().has(base(code))); }
    else if (t.dataset.mallaInfo !== undefined) open = open === t.dataset.mallaInfo ? '' : t.dataset.mallaInfo;
    else if (t.dataset.mallaSem !== undefined) {
      const codes = malla.semesters[Number(t.dataset.mallaSem)].classes.map((c) => c.code);
      mark(codes, !codes.every((c) => passedSet().has(base(c))));
    } else if (t.dataset.mallaClear !== undefined) prefs.set({ passed: [] });
    const y = scrollY;
    await renderMalla();
    scrollTo(0, y);
  });
}
