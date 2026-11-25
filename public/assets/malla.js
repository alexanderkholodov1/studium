// «Mi malla»: the person's career as the university publishes it, semester by semester. They mark what they passed,
// and Studium says what they can take now and what each class asks for. The mallas come from USFQ's public page
// (tools/malla.mjs), with the date they were read; the person's career and what they passed live in their profile.
// Advice, never orders: the malla is a guide, the student decides, and the registry office has the last word.
import { prefs } from './prefs.js';
import { sfx } from './sfx.js';
import { prepareEnrollment } from './schedule.js';

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
// What the person is taking this semester (from their CAPP): it counts for next semester's prerequisites, as Banner
// counts it (seen in his registration, 2026-11-25: Redes, in progress, did not block Aplicaciones Distribuidas).
const doingSet = () => new Set((prefs.get().planner?.cursando ?? []).map(base));
const has = (passed, code) => passed.has(base(code)) || doingSet().has(base(code));
// Whether a prerequisite tree is met by what the person passed. The English exam (ESLEXO) is not something Studium
// knows, so it never counts by itself.
export function meets(tree, passed = passedSet()) {
  if (!tree) return true;
  if (tree.all) return tree.all.every((t) => meets(t, passed));
  if (tree.any) return tree.any.some((t) => meets(t, passed));
  return tree.code !== 'ESLEXO' && has(passed, tree.code);
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

// The prerequisites of a class that are in the same plan, to be taken in the same semester: Banner checks a
// prerequisite against what was already passed or is in progress, so the two cannot go together (seen in a real
// registration, 2026-11-25: Aplicaciones Distribuidas planned with Base de Datos, its prerequisite, was refused).
export async function sameTermPrereqs(code, codes) {
  const malla = await myMalla();
  const c = malla && classOf(malla, code);
  if (!c?.pre || meets(c.pre)) return [];
  const set = new Set(codes.map(base));
  const out = [];
  const walk = (t) => { if (!t) return; if (t.code) { if (set.has(base(t.code))) out.push(one(t)); return; } (t.all ?? t.any).forEach(walk); };
  walk(c.pre);
  return out;
}

/* ---------- the CAPP: what the person passed and is taking, from the university's own record ---------- */
// His registration (2026-11-25): he looked at his CAPP («Resultados de Evaluación CAPP», kardex-registro) three times,
// and Studium knew only what he marked by hand. The person copies the CAPP page (Ctrl+A, Ctrl+C) and pastes it here.
// Each row of the table: the malla's requirement («CMP 4005» or «ELECTIVA 2»), the course that fills it
// («CMP - 4005»), its credits, the term and NRC; a row with no course («-») is still missing. A term from the current
// one on is «cursando»; an earlier one, passed. No AI and nothing sent: the text is read here.
const termNow = (d = new Date()) => { const y = d.getFullYear(); const m = d.getMonth() + 1; return m >= 8 ? `${y}10` : m <= 5 ? `${y - 1}20` : `${y - 1}30`; };
export function parseCapp(text) {
  const now = termNow();
  const passed = new Set(); const doing = new Set(); const left = new Set();
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const req = line.match(/^([A-Z]{2,4})[ -]?(\d{4}[A-Z]?)\b/) ?? line.match(/^(ELECTIVA|OPT|HUM|ARTE|CCSS)\s*(\d?)(?=\s|$)/i);
    if (!req) continue;
    const code = norm(`${req[1]} ${req[2]}`.trim());
    const used = line.match(/\b([A-Z]{2,4})\s+-\s+(\d{4}[A-Z]?)\b/);
    const term = line.match(/\b(20\d{2}[1-3]0)\b/)?.[1];
    if (!used || !term) { left.add(code); continue; }
    const usedCode = norm(`${used[1]} ${used[2]}`);
    const into = term >= now ? doing : passed;
    into.add(code); if (usedCode !== code) into.add(usedCode);
  }
  return { passed: [...passed], doing: [...doing], missing: [...left].filter((c) => !passed.has(c) && !doing.has(c)) };
}
function cappBox() {
  const doing = prefs.get().planner?.cursando ?? [];
  return `<details class="mm-box mm-capp"><summary><h3>Traer mi CAPP <small>${doing.length ? `${doing.length} cursando` : ''}</small></h3></summary>
    <p class="fine">Abre tu <a href="https://kardex-registro.usfq.edu.ec/" target="_blank" rel="noopener">evaluación CAPP ↗</a>, copia toda la página (Ctrl+A, Ctrl+C) y pégala aquí. Studium marca lo que aprobaste y lo que estás cursando, que cuenta como prerrequisito para el próximo semestre.</p>
    <textarea data-capp rows="3" placeholder="Pega aquí tu CAPP"></textarea>
    <div class="actions"><button class="button primary small" data-capp-read>Leer mi CAPP</button></div>
    <p class="msg" data-capp-msg role="status"></p></details>`;
}

/* ---------- minors ---------- */
// The minors USFQ publishes (tools/minors.mjs, from each minor's page and PDF). The person chooses up to three; their
// classes are listed here and weigh in the planner. The PDF has the last word: the rules differ by minor.
let minorsIndex = null;
export const minors = () => (minorsIndex ??= fetch(new URL('data/minors/index.json', document.baseURI)).then((r) => (r.ok ? r.json() : { minors: [] })).catch(() => ({ minors: [] })));
let minorList = [];
export const myMinors = () => minorList.filter((m) => (prefs.get().planner?.minors ?? []).includes(m.id));
export const inMyMinor = (code) => myMinors().find((m) => m.classes.some((c) => base(c.code) === base(code)));
function minorBox() {
  const mine = myMinors();
  const chosen = new Set(mine.map((m) => m.id));
  const short = (m) => m.name.replace(/^Minor en /, '');
  return `<details class="mm-box mm-minors" ${mine.length ? 'open' : ''}><summary><h3>Tu minor <small>${mine.length || ''}</small></h3></summary>
    ${mine.map((m) => `<div class="mm-minor"><p><b>${esc(short(m))}</b> <button class="link" data-minor-off="${esc(m.id)}">quitar</button></p>
      <p class="fine">${[m.credits ? `${m.credits} créditos` : '', esc(m.audience)].filter(Boolean).join(' · ')}</p>
      ${m.classes.length ? `<div class="mm-chips">${m.classes.map((c) => `<span class="mm-chip ${passedSet().has(base(c.code)) ? 'ok' : 'opens'}">${esc(c.name)} <small>${esc(c.code)}</small></span>`).join('')}</div>` : ''}
      ${m.rules.length ? `<p class="fine">${m.rules.map(esc).join(' ')}</p>` : ''}
      <p class="fine">${m.pdf ? `<a href="${esc(m.pdf)}" target="_blank" rel="noopener">Su malla en PDF ↗</a> · ` : ''}<a href="${esc(m.url)}" target="_blank" rel="noopener">Su página ↗</a>${m.classes.length ? '' : ' · Sus materias están en su página.'}</p></div>`).join('')}
    ${mine.length < 3 && minorList.length ? `<label class="field"><span>${mine.length ? 'Otro minor' : 'Elige tu minor'}</span><select data-minor-add><option value="">…</option>${minorList.filter((m) => !chosen.has(m.id)).map((m) => `<option value="${esc(m.id)}">${esc(short(m))}</option>`).join('')}</select></label>` : ''}
    <p class="fine">De la <a href="https://www.usfq.edu.ec/es/oferta-academica/minors" target="_blank" rel="noopener">página de minors de la U ↗</a>. Un minor pide de 15 a 18 créditos, la mitad en la USFQ.</p></details>`;
}

// For the planner: what the malla knows of each course (by code): its name, passed or in progress, whether its
// prerequisites are met and what is missing, how many classes it opens, planned for next semester, a minor.
export async function courseFacts(codes) {
  const malla = await myMalla();
  minorList = (await minors()).minors ?? [];
  const passed = passedSet();
  const out = new Map();
  for (const code of codes) {
    const c = malla && classOf(malla, code);
    const minor = inMyMinor(code);
    out.set(base(code), {
      inMalla: !!c, name: c?.name ?? '', passed: passed.has(base(code)), doing: doingSet().has(base(code)),
      met: !c?.pre || meets(c.pre), needs: c?.pre && !meets(c.pre) ? missing(c.pre, malla) : '',
      opens: c ? opens(malla, c.code).length : 0, planned: planned().has(base(code)), minor: minor ? minor.name.replace(/^Minor en /, '') : '',
    });
  }
  return out;
}
export const baseOf = (code) => base(code);
export const plannedCodes = () => [...planned()];

/* ---------- the page ---------- */
// His words (2026-11-20): the career comes from the profile; mark what you took; see with colors, lines and animations
// what you can take and what is still closed, and what is missing for it to open next semester; the malla recommends
// an order but only the prerequisites decide; save what you plan for next semester and go to the schedules; the
// student guide, the English requirement, the minimum grade and tips at hand.
const semName = (malla, i) => {
  const s = malla.semesters[i];
  if (/VERANO/i.test(s.term)) return 'Verano';
  const n = malla.semesters.slice(0, i + 1).filter((x) => !/VERANO/i.test(x.term)).length;
  return `Semestre ${n}`;
};
const SLOTS = { optativa: 'Optativa', electiva: 'Electiva libre', humanidades: 'Humanidades', arte: 'Arte', ccss: 'Ciencias sociales' };
// «Optativa 2/3» says «2 de 3»; «Humanidades: LIT/FIL/ARH/ESC» says which areas count.
const slotNote = (c) => { const n = c.name.match(/(\d)\/(\d)\s*$/); return n ? `${n[1]} de ${n[2]}` : c.name.split(':')[1]?.trim() ?? ''; };
const nameOf = (c) => (c.slot ? SLOTS[c.slot] ?? c.name : c.name);
// The practicum (PAS) asks for 75 credits passed, as the malla's notes say; nothing else is known beyond the tree.
let creditsDone = 0;
const PRACTICUM = 75;
const practicum = (c) => /^PAS /.test(c.code);
// The capstone is for the last semester: it is never proposed as «puedes tomar ahora».
const last = (c) => /proyecto integrador|trabajo de titulaci|tesis/i.test(c.name);
const stateOf = (c, passed) => (passed.has(base(c.code)) ? 'passed' : doingSet().has(base(c.code)) ? 'doing' : meets(c.pre, passed) && !(practicum(c) && creditsDone < PRACTICUM) ? 'ready' : 'locked');
const STATE = { passed: 'Aprobada', doing: 'La estás cursando', ready: 'Puedes tomarla', locked: 'Te falta algo' };
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
let root = null;
let open = '';
let opened = new Set(); // classes that just opened, to celebrate them once

// «INGENIERÍA EN CIENCIAS DE LA COMPUTACIÓN» reads «Ingeniería en Ciencias de la Computación».
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'con', 'para', 'a']);
export const title = (s) => String(s ?? '').toLowerCase().replace(/[\p{L}]+/gu, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
const mode = (c) => String(c.modality ?? '').toLowerCase().replace(/^modalidad\s*/, '').replace(/\s+-\s+/, ', ');
export function careerLabel(c, list) {
  const same = list.filter((x) => x.name === c.name);
  if (same.length < 2) return title(c.name);
  const m = mode(c);
  return `${title(c.name)} · ${m}${same.filter((x) => mode(x) === m).length > 1 ? ` (${c.code})` : ''}`;
}
// The career select, the same in the profile (Ajustes) and here: choosing sets both the profile's career and its malla.
export function careerPicker(list, current, label = 'Tu carrera') {
  return `<label class="field malla-career"><span>${esc(label)}</span><select data-malla-career>
    <option value="">Elige tu carrera…</option>
    ${list.map((c) => `<option value="${esc(c.code)}" ${c.code === current ? 'selected' : ''}>${esc(careerLabel(c, list))}</option>`).join('')}
  </select></label>`;
}
const planned = () => new Set(prefs.get().plan ?? []);

function card(c, passed) {
  const st = stateOf(c, passed);
  const inPlan = planned().has(base(c.code));
  return `<button class="mm-card ${st}${c.slot ? ' slot' : ''}${open === c.code ? ' open' : ''}${inPlan ? ' planned' : ''}${opened.has(base(c.code)) ? ' just-opened' : ''}" data-mm="${esc(c.code)}" aria-pressed="${open === c.code}">
    <span class="mm-icon" aria-hidden="true">${st === 'passed' ? CHECK : st === 'locked' ? LOCK : ''}</span>
    <b>${esc(nameOf(c))}</b>
    <small>${esc(c.slot ? slotNote(c) || c.code : c.code)} · ${c.credits} cr${inPlan ? ' · próximo semestre' : ''}</small>
    <span class="sr-only">, ${STATE[st]}</span>
  </button>`;
}
// The chain of what a class asks for, as chips: each one green if passed, red if missing; tap to see it.
// Within «esto o aquello» already met, the other options are just options (grey), not something missing.
function chips(tree, passed, malla, met = false) {
  if (!tree) return '';
  if (tree.all) return tree.all.map((t) => chips(t, passed, malla, met)).join('<span class="mm-and">y</span>');
  if (tree.any) return `<span class="mm-any">${tree.any.map((t) => chips(t, passed, malla, met || meets(tree, passed))).join('<span class="mm-or">o</span>')}</span>`;
  if (tree.code === 'ESLEXO') return '<span class="mm-chip ext">Examen de ubicación de inglés</span>';
  const c = classOf(malla, tree.code);
  const ok = has(passed, tree.code);
  return `<button class="mm-chip ${ok ? 'ok' : met ? 'alt' : 'miss'}" ${c ? `data-mm="${esc(c.code)}"` : 'disabled'}>${ok ? '✓ ' : ''}${esc(c ? nameOf(c) : tree.name || tree.code)}${GRADE(tree.grade)}</button>`;
}
function detail(malla, passed) {
  const c = open && classOf(malla, open);
  if (!c) return `<div class="mm-detail mm-hint"><p><b>Toca una materia</b> para ver qué pide, qué abre, y marcarla como aprobada o para tu próximo semestre.</p></div>`;
  const st = stateOf(c, passed);
  const next = opens(malla, c.code);
  const inPlan = planned().has(base(c.code));
  return `<div class="mm-detail ${st}" aria-live="polite">
    <p class="mm-kicker">${esc(STATE[st])} · ${esc(semName(malla, c.sem))}</p>
    <h3>${esc(nameOf(c))}</h3><p class="fine">${esc(c.code)} · ${c.credits} créditos</p>
    <div class="actions">
      <button class="button ${st === 'passed' ? 'ghost' : 'primary'} small" data-mm-pass="${esc(c.code)}">${st === 'passed' ? 'Quitar de aprobadas' : 'Ya la aprobé'}</button>
      ${st === 'ready' && !last(c) ? `<button class="button ghost small" data-mm-plan="${esc(c.code)}">${inPlan ? 'Quitar del próximo semestre' : 'Para mi próximo semestre'}</button>` : ''}
    </div>
    ${c.pre ? `<p class="mm-label">Pide</p><div class="mm-chips">${chips(c.pre, passed, malla)}</div>` : practicum(c) ? `<p><b>Pide:</b> ${PRACTICUM} créditos aprobados, o estar desde el sexto semestre. Llevas ${creditsDone}.</p>` : last(c) ? '<p>Se toma en el último semestre de la carrera.</p>' : '<p class="fine">No pide prerrequisitos.</p>'}
    ${st === 'locked' && c.pre ? `<p class="mm-missing">Para que se abra, te falta: <b>${esc(missing(c.pre, malla, passed))}</b>.</p>` : ''}
    ${next.length ? `<p class="mm-label">Abre</p><div class="mm-chips">${next.map((x) => `<button class="mm-chip opens" data-mm="${esc(x.code)}">${esc(nameOf(x))}</button>`).join('')}</div>` : ''}
  </div>`;
}
function readyList(malla, passed) {
  const ready = all(malla).filter((c) => stateOf(c, passed) === 'ready' && !last(c));
  const seen = new Set();
  return ready.filter((c) => !c.slot || (!seen.has(c.slot) && seen.add(c.slot)));
}
function side(malla, passed) {
  const ready = readyList(malla, passed);
  const plan = all(malla).filter((c) => planned().has(base(c.code)));
  const planCr = plan.reduce((a, c) => a + c.credits, 0);
  return `<aside class="mm-side">
    ${detail(malla, passed)}
    <section class="mm-box mm-plan"><h3>Tu próximo semestre <small>${plan.length ? `${planCr} créditos` : ''}</small></h3>
      ${plan.length ? `<ul>${plan.map((c) => `<li><button class="link" data-mm="${esc(c.code)}">${esc(nameOf(c))}</button><small>${c.credits} cr</small><button class="icon x" data-mm-plan="${esc(c.code)}" aria-label="Quitar"><svg><use href="#i-x"/></svg></button></li>`).join('')}</ul>`
        : '<p class="fine">Elige entre las que puedes tomar ahora: tócalas y pulsa «Para mi próximo semestre».</p>'}
      <div class="actions"><button class="button primary small" data-mm-prep ${plan.length ? '' : 'disabled'}>Armar mi horario con esto</button><a class="button ghost small" href="${OFFER_URL}" target="_blank" rel="noopener">Cursos y horarios disponibles ↗</a></div></section>
    <section class="mm-box"><h3>Puedes tomar ahora <small>${ready.length}</small></h3>
      ${ready.length ? `<div class="mm-chips">${ready.slice(0, 24).map((c) => `<button class="mm-chip ready" data-mm="${esc(c.code)}">${esc(nameOf(c))}</button>`).join('')}</div>` : '<p class="fine">Marca lo que ya aprobaste para verlo.</p>'}
      <p class="fine">No todas se abren cada semestre: revisa la oferta.</p></section>
    ${malla.notes?.length ? `<details class="mm-box mm-notes" open><summary><h3>Requisitos de tu carrera <small>${malla.notes.length}</small></h3></summary>
      <ul>${malla.notes.map((n) => `<li>${n.title ? `<b>${esc(n.title)}</b> ` : ''}${esc(n.text.replace(/^\*\s*/, ''))}</li>`).join('')}</ul>
      <p class="fine">Copiado de la <a href="${esc(malla.source.url)}" target="_blank" rel="noopener">malla publicada por la U ↗</a>.</p></details>` : ''}
    ${cappBox()}
    ${minorBox()}
    <section class="mm-box"><h3>Antes de inscribirte</h3><ul class="mm-links">
      <li><a href="#/guia-estudiante">Guía del estudiante: inglés, notas mínimas, inscripción y más</a></li>
      <li><a href="${OFFER_URL}" target="_blank" rel="noopener">Cursos y horarios disponibles ↗</a></li>
      <li><a href="${esc(malla.source.url)}" target="_blank" rel="noopener">Tu malla en la página de la U ↗</a></li></ul></section>
  </aside>`;
}

export async function renderMalla() {
  root = document.querySelector('#malla');
  if (!root) return;
  const [list, malla] = await Promise.all([careers(), myMalla(), minors().then((x) => { minorList = x.minors ?? []; })]);
  const p = prefs.get();
  if (!malla) {
    root.innerHTML = `<div class="malla-empty glass">
      <h2>Tu carrera, materia por materia</h2>
      <p>Elige tu carrera: queda en tu perfil, y aquí ves qué aprobaste, qué puedes tomar ahora y qué te falta para lo demás.</p>
      ${list.length ? careerPicker(list, p.malla) : '<p class="msg">Las mallas no se pudieron cargar. Vuelve a intentar en un rato.</p>'}
      <p class="fine">Las mallas vienen de la página pública de la U. Son una guía: si algo no cuadra, la última palabra la tiene la U.</p>
    </div>`;
    return;
  }
  const passed = passedSet();
  const done = all(malla).filter((c) => passed.has(base(c.code)));
  const cr = done.reduce((a, c) => a + c.credits, 0);
  creditsDone = cr;
  const pct = malla.total ? Math.min(100, Math.round((cr / malla.total) * 100)) : 0;
  const counts = { passed: 0, doing: 0, ready: 0, locked: 0 };
  for (const c of all(malla)) counts[stateOf(c, passed)] += 1;
  root.innerHTML = `
    <div class="mm-head">
      <div><a class="back" href="#/horario">← Mi horario</a><h1 class="sched-title">Mi malla</h1>
        <p class="muted">${esc(title(malla.name))} · <a href="#/ajustes">cambiar en tu perfil</a></p></div>
      <div class="mm-ring" style="--mmp:${pct}"><b>${pct}%</b><small>${cr} de ${malla.total} créditos</small></div>
    </div>
    <div class="mm-legend"><span class="mm-dot passed"></span>Aprobadas ${counts.passed}${counts.doing ? `<span class="mm-dot doing"></span>Cursando ${counts.doing}` : ''}<span class="mm-dot ready"></span>Puedes tomarlas ${counts.ready}<span class="mm-dot locked"></span>Te falta algo ${counts.locked}
      <span class="fine">Cada materia está en el semestre que la U recomienda; lo que decide si puedes tomarla son sus prerrequisitos.</span></div>
    <div class="mm-body">
      <div class="mm-map">
        <svg class="mm-lines" aria-hidden="true"></svg>
        ${malla.semesters.map((s, i) => `<section class="mm-row" aria-label="${esc(semName(malla, i))}">
          <header><b>${esc(semName(malla, i))}</b>${((on) => `<button class="malla-all ${on ? 'on' : ''}" data-malla-sem="${i}" aria-pressed="${on}" title="${on ? 'Desmarcar este semestre' : 'Marcar todo este semestre como aprobado'}">${CHECK}</button>`)(s.classes.every((c) => passed.has(base(c.code))))}</header>
          <div class="mm-cards">${s.classes.map((c) => card({ ...c, sem: i }, passed)).join('')}</div>
        </section>`).join('')}
      </div>
      ${side(malla, passed)}
    </div>
    <p class="fine">Leída de la página pública de la U el ${esc(malla.source.read)}. Es una guía para planear: tú decides, y la última palabra la tiene la U.</p>`;
  requestAnimationFrame(() => drawLines(malla));
  opened = new Set();
}

// When a class is open: lines from what it asks for (green if passed, red if missing) and to what it opens.
function drawLines(malla) {
  const svg = root?.querySelector('.mm-lines');
  if (!svg) return;
  const map = svg.parentElement;
  const c = open && classOf(malla, open);
  svg.innerHTML = '';
  if (!c) return;
  const at = (code) => map.querySelector(`.mm-card[data-mm="${CSS.escape(code)}"]`);
  const box = map.getBoundingClientRect();
  svg.setAttribute('width', map.scrollWidth); svg.setAttribute('height', map.scrollHeight);
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, top: r.top - box.top, bottom: r.bottom - box.top }; };
  const me = at(c.code);
  if (!me) return;
  const m = center(me);
  const passed = passedSet();
  const codes = (tree) => (!tree ? [] : tree.code ? [tree.code] : (tree.all ?? tree.any).flatMap(codes));
  const line = (a, b, cls) => {
    const y1 = a.bottom; const y2 = b.top; const mid = (y1 + y2) / 2;
    svg.insertAdjacentHTML('beforeend', `<path class="${cls}" d="M${a.x},${y1} C${a.x},${mid} ${b.x},${mid} ${b.x},${y2}"/>`);
  };
  // A requirement already met leaves its other options grey, not red.
  const met = meets(c.pre, passed);
  for (const code of codes(c.pre)) {
    const el = at(classOf(malla, code)?.code ?? '');
    if (!el) continue;
    const kind = has(passed, code) ? 'ok' : met ? 'alt' : 'miss';
    line(center(el), m, kind);
    if (kind !== 'alt') el.classList.add(kind === 'ok' ? 'is-req' : 'is-miss');
  }
  for (const x of opens(malla, c.code)) { const el = at(x.code); if (el) { line(m, center(el), 'opens'); el.classList.add('is-opens'); } }
}

function mark(codes, on) {
  const p = new Set(prefs.get().passed);
  for (const c of codes) { if (on) p.add(norm(c)); else { p.delete(norm(c)); for (const x of [...p]) if (base(x) === base(c)) p.delete(x); } }
  // A class passed leaves the plan for next semester.
  const plan = (prefs.get().plan ?? []).filter((x) => !(on && codes.some((c) => base(c) === x)));
  prefs.set({ passed: [...p], plan });
}
export function mountMalla() {
  document.addEventListener('change', (e) => {
    if (!e.target.matches?.('[data-malla-career]')) return;
    open = '';
    const code = e.target.value;
    const label = e.target.selectedOptions[0]?.textContent ?? '';
    prefs.set({ malla: code, ...(code ? { career: label.split(' · ')[0].slice(0, 80) } : {}) });
    if (e.target.closest('#malla')) renderMalla();
  });
  document.addEventListener('change', (e) => {
    const sel = e.target.closest?.('[data-minor-add]');
    if (!sel || !sel.closest('#malla') || !sel.value) return;
    const pl = prefs.get().planner ?? {};
    prefs.set({ planner: { ...pl, minors: [...(pl.minors ?? []), sel.value].slice(0, 3) } });
    sfx.tick?.(); renderMalla();
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-minor-off],[data-capp-read]');
    if (!t || !t.closest('#malla')) return;
    const pl = prefs.get().planner ?? {};
    if (t.dataset.minorOff !== undefined) { prefs.set({ planner: { ...pl, minors: (pl.minors ?? []).filter((x) => x !== t.dataset.minorOff) } }); renderMalla(); return; }
    const box = t.closest('.mm-capp');
    const r = parseCapp(box.querySelector('[data-capp]').value);
    const msg = box.querySelector('[data-capp-msg]');
    if (!r.passed.length && !r.doing.length) { msg.textContent = 'No reconocí tu CAPP en ese texto. Copia toda la página de «Resultados de Evaluación CAPP» y pégala aquí.'; return; }
    const now = new Set(prefs.get().passed.map(norm));
    for (const c of r.passed) now.add(norm(c));
    for (const c of r.doing) now.delete(norm(c));
    const touched = new Set([...r.passed, ...r.doing].map(base));
    prefs.set({ passed: [...now].slice(0, 150), planner: { ...pl, cursando: r.doing.slice(0, 40) }, plan: (prefs.get().plan ?? []).filter((x) => !touched.has(x)) });
    sfx.tick?.();
    renderMalla().then(() => { const m = root?.querySelector('[data-capp-msg]'); if (m) { m.closest('details').open = true; m.textContent = `Listo: ${r.passed.length} aprobadas y ${r.doing.length} cursando, según tu CAPP.`; } });
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest?.('[data-mm],[data-mm-pass],[data-mm-plan],[data-mm-prep],[data-malla-sem]');
    if (!t || !t.closest('#malla')) return;
    const malla = await myMalla();
    if (!malla) return;
    const before = new Set(readyList(malla, passedSet()).map((c) => base(c.code)));
    if (t.dataset.mm !== undefined) open = open === t.dataset.mm && t.classList.contains('mm-card') ? '' : t.dataset.mm;
    else if (t.dataset.mmPass !== undefined) { const code = t.dataset.mmPass; const on = !passedSet().has(base(code)); mark([code], on); if (on) sfx.tick?.(); }
    else if (t.dataset.mmPlan !== undefined) {
      const code = base(t.dataset.mmPlan); const plan = new Set(prefs.get().plan ?? []);
      if (plan.has(code)) plan.delete(code); else if (plan.size < 12) plan.add(code);
      prefs.set({ plan: [...plan] });
    } else if (t.dataset.mmPrep !== undefined) { prepareEnrollment(); return; }
    else if (t.dataset.mallaSem !== undefined) {
      const codes = malla.semesters[Number(t.dataset.mallaSem)].classes.map((c) => c.code);
      mark(codes, !codes.every((c) => passedSet().has(base(c))));
    }
    // What a change just opened shines once.
    opened = new Set(readyList(malla, passedSet()).map((c) => base(c.code)).filter((c) => !before.has(c)));
    const y = scrollY;
    await renderMalla();
    scrollTo(0, y);
  });
  addEventListener('resize', () => { if (root?.isConnected && open) myMalla().then((m) => m && drawLines(m)); });
}
