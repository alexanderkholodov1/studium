// The map's controls, around the canvas of graph.js:
// - a bar under the menu: search that also answers questions in words (with the person's AI, or a simple reader
//   when none is connected), filters, views and routes;
// - a drawer of filters: courses, professors, terms, «hasta» an evaluation, sources, kinds of material, what is
//   shown, and the person's own courses and interests;
// - views that light the map up differently, and layouts (a route, a course's timeline, a curriculum);
// - selection of one or many nodes, with what can be done with them;
// - the panel: a node, a selection, a route or a path.
// Active filters show as chips in the corner; «¿Para qué sirve?» and «Créditos» sit in the other, like a map's credits.
import { GraphView, upcoming } from './graph.js';
import { routeTo, routeLayout, pathBetween, neighbourhood, readAsk, mapIndex, askInstructions, readAskAnswer } from './route.js';
import { keyOf, themeStyle, THEMES } from './themes.js';
import { looseKey, stageOf, termKey, termLabel, sameProfessor } from './standard.js';
import { RELATIONS, QUESTION_KINDS, KINDS, countKind, LEVELS } from './prompts.js';
import { DOC_KINDS } from './data.js';
import { prefs } from './prefs.js';
import * as ai from './ai.js';
import { t } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many) => `${n.toLocaleString('es')} ${n === 1 ? one : many}`;
const STORE = 'studium-map';
// The areas of the map, as a person names their interests.
const AREAS = {
  vectores: 'Matemáticas', redes: 'Redes y sistemas', codigo: 'Programación', algoritmos: 'Programación competitiva',
  neuronas: 'IA y estadística', ondas: 'Física y electrónica', moleculas: 'Química', celulas: 'Biología y salud',
  mercados: 'Economía y negocios', palabras: 'Humanidades e idiomas', trazos: 'Arte y diseño', estrellas: 'Otras',
};

let ctx = null; // { state, toast, explain, presetGuide }
let view = null;
let lens = 'normal';
let route = null; // routeTo()'s result, while a route is shown
let special = null; // { kind: 'path' | 'focus' | 'timeline' | 'concepts', nodes, label, ... }
let say = '';

/* ---------- filters, kept in this browser ---------- */
const BLANK = { coursesOff: [], professors: [], terms: [], until: '', sources: [], kinds: [], mine: false, hidden: [],
  show: { guide: true, material: false, document: false, ghost: true, more: false }, career: '', semester: 0, lens: 'normal', routeRest: false, routeMissing: false };
let F = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return { ...structuredClone(BLANK), ...saved, show: { ...BLANK.show, ...(saved.show ?? {}) } };
  } catch { return structuredClone(BLANK); }
})();
lens = F.lens ?? 'normal';
const keep = () => { try { localStorage.setItem(STORE, JSON.stringify({ ...F, lens })); } catch { /* not remembered */ } };

const graph = () => ctx.state.graph;
const itemById = () => {
  const g = graph();
  if (g.items) return g.items;
  g.items = new Map([...ctx.state.contributions.map((x) => [x.id, x]), ...ctx.state.catalog.map((x) => [x.id, { ...x, kind: 'guide' }])]);
  return g.items;
};
const sourceName = (id) => ctx.state.sources.find((s) => s.id === id)?.name ?? id;
const known = () => new Set(prefs.get().known);
// Questions that are the same question (in another version of the exam, or another term): most of their words match.
const wordsOf = (text) => new Set(keyOf(text).split('-').filter((w) => w.length > 3));
function similar(a, b) {
  let same = 0;
  for (const w of a) if (b.has(w)) same += 1;
  return same / Math.max(1, Math.min(a.size, b.size));
}
export function bank(questions) {
  const groups = [];
  for (const q of questions) {
    const w = wordsOf(q.text);
    const home = groups.find((g) => similar(g.words, w) >= 0.6);
    if (home) { home.seen.push(q); continue; }
    groups.push({ q, words: w, seen: [q] });
  }
  return groups.sort((a, b) => b.seen.length - a.seen.length);
}

// The courses of the person and of their interests (areas and courses), or null when they chose none.
function mineCourses() {
  const p = prefs.get();
  if (!p.courses.length && !p.interests.length) return null;
  const areas = new Set(p.interests.filter((x) => x.startsWith('area:')).map((x) => x.slice(5)));
  const picked = new Set([...p.courses, ...p.interests.filter((x) => x.startsWith('course:')).map((x) => x.slice(7))]);
  return new Set(graph().courses.filter((c) => picked.has(c.key) || areas.has(c.theme)).map((c) => c.id));
}
const itemFilters = () => F.professors.length || F.terms.length || F.sources.length || F.kinds.length;
function itemOk(x) {
  if (!x) return false;
  if (F.professors.length && !F.professors.some((p) => sameProfessor(x.professor ?? '', p))) return false;
  if (F.terms.length && !F.terms.includes(termKey(x.term ?? ''))) return false;
  if (F.kinds.length && !F.kinds.includes(x.kind ?? 'guide')) return false;
  if (F.sources.length && !((x.source && F.sources.includes(x.source)) || (!x.source && F.sources.includes('community')) || (x.mine && F.sources.includes('mine')))) return false;
  return true;
}
const untilOrder = () => (F.until ? stageOf(F.until)?.order ?? null : null);

// Whether each node is shown, from the filters, the route or the special view; then the view's emphasis.
function compute() {
  const g = graph();
  const items = itemById();
  const off = new Set(F.coursesOff);
  const mine = F.mine ? mineCourses() : null;
  const plan = F.career && g.byId.get(F.career);
  const inPlan = plan ? new Set(plan.semesters.flat()) : null;
  const filtering = itemFilters();
  const limit = untilOrder();
  const hidden = new Set(F.hidden);
  const courseOk = new Map();
  for (const c of g.courses) {
    let ok = !off.has(c.id) && (!mine || mine.has(c.id)) && (!inPlan || inPlan.has(c.id));
    if (ok && filtering) ok = [...c.contributions, ...c.guides.map((x) => ({ ...x, kind: 'guide' }))].some((x) => itemOk(items.get(x.id) ?? x));
    courseOk.set(c.id, ok);
  }
  const conceptOk = (n) => {
    if (!F.show.ghost && n.ghost) return false;
    if (![...n.courses].some((id) => courseOk.get(id))) return false;
    if (filtering && ![...n.items, ...n.guides.map((x) => x.id)].some((id) => itemOk(items.get(id)))) return false;
    if (limit != null) {
      const places = [...n.stageBy].filter(([id]) => courseOk.get(id));
      if (places.length && places.every(([, o]) => o > limit)) return false;
    }
    return true;
  };
  const shown = new Map();
  for (const n of g.nodes) {
    let ok;
    if (n.type === 'course') ok = courseOk.get(n.id);
    else if (n.type === 'concept') ok = conceptOk(n);
    else if (n.type === 'guide') ok = F.show.guide && courseOk.get(n.course.id) && itemOk({ ...n.entry, kind: 'guide' });
    else if (n.type === 'material') ok = courseOk.get(n.course.id) && itemOk(n.item);
    else if (n.type === 'document') ok = courseOk.get(n.course.id);
    else if (n.type === 'career') ok = !plan || n === plan;
    shown.set(n, ok && !hidden.has(n.id));
  }
  const inRoute = route?.nodes;
  const focusSet = special?.kind === 'focus' || special?.kind === 'timeline' ? special.nodes : null;
  const hide = (n) => {
    if (!shown.get(n)) return true;
    if (focusSet && !focusSet.has(n)) return true;
    if (inRoute && !inRoute.has(n) && !F.routeRest) return true;
    if (inRoute && F.routeMissing && known().has(n.key)) return true;
    return false;
  };
  const showTypes = new Set([F.show.material && 'material', F.show.document && 'document'].filter(Boolean));
  const L = LENSES[lens] ?? LENSES.normal;
  const knownSet = known();
  view.setState({
    showTypes,
    labels: F.show.more ? 'more' : 'auto',
    hide,
    dim: (n) => {
      let d = L.dim?.(n, knownSet) ?? 0;
      if (inRoute && !inRoute.has(n)) d = Math.max(d, 0.9);
      if (special?.kind === 'path' && !special.nodes.has(n)) d = Math.max(d, 0.85);
      if (special?.kind === 'concepts' && !special.nodes.has(n)) d = Math.max(d, 0.7);
      if (limit != null && n.type === 'concept' && !n.stageBy.size) d = Math.max(d, 0.45);
      return d;
    },
    tint: (n) => L.tint?.(n) ?? null,
    size: (n) => L.size?.(n) ?? 1,
    mark: (n) => (special?.kind === 'path' || special?.kind === 'concepts' ? special.nodes.has(n) : false) || (L.mark?.(n, knownSet) ?? false),
  });
  layout();
  renderChips();
  renderCount();
}

/* ---------- views ---------- */
const HEAT = ['#2ee59d', '#a6e34a', '#ffd23f', '#ff9a3d', '#ff4f6d'];
const PALETTE = ['#3d7bff', '#ff6a3d', '#2ee59d', '#ffd23f', '#b86bff', '#16b5d0', '#ff4f9a', '#a6e34a'];
let paletteOf = new Map();
const LENSES = {
  normal: { name: 'Normal', text: 'Cada materia con su color.' },
  asked: { name: 'Lo más preguntado', text: 'Más grande, lo que más aparece en evaluaciones; lo que nadie preguntó, tenue.',
    size: (n) => (n.type === 'concept' ? 0.7 + Math.min(2.4, Math.sqrt(n.questions.length) * 0.55) : 1),
    dim: (n) => (n.type === 'concept' && !n.questions.length ? 0.6 : 0),
    tint: (n) => (n.type === 'concept' && n.questions.length ? HEAT[Math.min(4, Math.floor(Math.log2(1 + n.questions.length)))] : null) },
  difficulty: { name: 'Dificultad', text: 'De verde (fácil) a rojo (difícil), según las preguntas de cada concepto.',
    tint: (n) => (n.type === 'concept' && n.difficulty ? HEAT[Math.max(0, Math.min(4, Math.round(n.difficulty) - 1))] : null),
    dim: (n) => (n.type === 'concept' && !n.difficulty ? 0.65 : 0) },
  bridges: { name: 'Puentes entre materias', text: 'Los conceptos que comparten varias materias: lo que te sirve en más de un lado.',
    dim: (n) => (n.type === 'concept' && !n.bridge ? 0.75 : 0), mark: (n) => n.type === 'concept' && n.bridge },
  mine: { name: 'Lo que hiciste crecer', text: 'Lo que vino de tus guías y tus aportes.',
    dim: (n) => (n.mine ? 0 : 0.8), mark: (n) => !!n.mine && n.type !== 'course' },
  missing: { name: 'Lo que te falta', text: 'Lo que todavía no marcaste como «Ya lo sé». Lo que ya sabes queda tenue.',
    dim: (n, k) => (n.type === 'concept' && k.has(n.key) ? 0.85 : 0), mark: (n, k) => n.type === 'concept' && !k.has(n.key) && n.questions.length > 0 },
  gaps: { name: 'Huecos', text: 'Conceptos que otros mencionan pero ningún material explica todavía: lo que falta aportar.',
    dim: (n) => (n.type === 'concept' && !n.ghost ? 0.8 : 0), mark: (n) => n.type === 'concept' && n.ghost },
  recent: { name: 'Lo nuevo', text: 'Lo que llegó en los últimos 30 días.',
    dim: (n) => (n.type === 'concept' && !n.recent ? 0.8 : 0), mark: (n) => n.type === 'concept' && n.recent },
  professor: { name: 'Por profesor', text: 'Un color por profesor: qué toma cada uno.',
    tint: (n) => (n.type === 'concept' && n.professors.size ? paletteOf.get([...n.professors][0]) ?? null : null),
    dim: (n) => (n.type === 'concept' && !n.professors.size ? 0.7 : 0) },
  timeline: { name: 'Línea de tiempo', text: 'Una materia, con sus evaluaciones en columnas: qué entra en cada una.', layout: true },
  career: { name: 'Malla', text: 'Las materias de una carrera, por semestre.', layout: true },
};
function setLens(id) {
  lens = LENSES[id] ? id : 'normal';
  if (lens === 'professor') {
    const profs = [...new Set(graph().courses.flatMap((c) => [...c.professors.keys()]))];
    paletteOf = new Map(profs.map((p, i) => [p, PALETTE[i % PALETTE.length]]));
  }
  if (lens === 'timeline') {
    const c = pickedCourse();
    if (!c) { lens = 'normal'; ctx.toast('Elige primero una materia: tócala en el mapa o búscala.'); }
    else startTimeline(c);
  } else if (special?.kind === 'timeline') special = null;
  if (lens === 'career' && !F.career) {
    const career = graph().nodes.find((n) => n.type === 'career');
    if (career) F.career = career.id; else { lens = 'normal'; ctx.toast('Todavía no hay una malla en el mapa: apórtala en «Aportar».'); }
  }
  if (lens !== 'career' && F.career && LENSES[id] && id !== 'career') F.career = '';
  keep();
  renderViews();
  compute();
  if (LENSES[lens]?.layout) setTimeout(() => view.fit(), 50);
}

/* ---------- layouts: route, timeline, curriculum ---------- */
function layout() {
  if (route) {
    const { pins, rows } = routeLayout(route);
    view.setPins(pins, { rows: rows.map((r) => ({ ...r, label: t(r.label), left: -760 })) });
    return;
  }
  if (special?.kind === 'timeline') {
    view.setPins(special.pins, { columns: special.columns.map((c) => ({ ...c, label: t(c.label) })) });
    return;
  }
  const plan = F.career && graph().byId.get(F.career);
  if (plan && lens === 'career') {
    const pins = new Map();
    const columns = [];
    const sems = plan.semesters.map((ids, s) => [s, ids]).filter(([, ids]) => ids?.length);
    sems.forEach(([s, ids], i) => {
      const x = (i - (sems.length - 1) / 2) * 280;
      columns.push({ x, label: `Semestre ${s}`, top: -((ids.length - 1) / 2) * 150 - 130 });
      ids.forEach((id, j) => pins.set(id, { x, y: (j - (ids.length - 1) / 2) * 150 }));
    });
    pins.set(plan.id, { x: -((sems.length + 1) / 2) * 280, y: 0 });
    view.setPins(pins, { columns: columns.map((c) => ({ ...c, label: t(c.label) })) });
    return;
  }
  view.setPins(null);
}
function startTimeline(c) {
  const g = graph();
  const placed = (c.stageList ?? []).filter((s) => s.order != null);
  const own = g.nodes.filter((n) => n.type === 'concept' && n.courses.has(c.id));
  const loose = own.some((n) => !n.stageBy.has(c.id));
  const cols = [...placed.map((s) => ({ label: s.label, order: s.order })), ...(loose ? [{ label: 'Sin evaluación', order: null }] : [])];
  const pins = new Map();
  const columns = [];
  const W = 0; // each column takes what it needs
  let at = 0;
  cols.forEach((col, i) => {
    const members = own.filter((n) => (col.order == null ? !n.stageBy.has(c.id) : n.stageBy.get(c.id) === col.order))
      .sort((a, b) => b.questions.length - a.questions.length || a.name.localeCompare(b.name, 'es'));
    const per = Math.max(1, Math.ceil(members.length / 22));
    const x = at + (per * 190) / 2;
    at += per * 190 + 90 + W;
    members.forEach((n, j) => pins.set(n.id, { x: x + ((j % per) - (per - 1) / 2) * 190, y: (Math.floor(j / per) - Math.floor((members.length / per - 1) / 2)) * 46 }));
    columns.push({ x, label: col.label, top: -Math.ceil(members.length / per) * 23 - 70, width: Math.max(240, per * 190 + 40) });
  });
  special = { kind: 'timeline', course: c, nodes: new Set(own), pins, columns };
}
function pickedCourse() {
  const p = view.primary;
  if (p?.type === 'course') return p;
  if (p?.type === 'concept') return graph().byId.get([...p.courses][0]);
  if (p?.course) return p.course;
  const shown = graph().courses.filter((c) => !c.hidden);
  return shown.length === 1 ? shown[0] : route?.course ?? null;
}

/* ---------- routes ---------- */
export function startRoute(opts) {
  const r = routeTo(graph(), opts);
  if (!r.steps.length) { ctx.toast('No hay conceptos para esa ruta todavía.'); return; }
  route = r;
  special = null;
  if (lens === 'timeline' || lens === 'career') lens = 'normal';
  view.select(null);
  compute();
  renderRoute();
  setTimeout(() => view.fit([...r.nodes]), 80);
}
function endRoute() {
  route = null;
  compute();
  panel(null);
  setTimeout(() => view.fit(), 60);
}
function routeCounts(r) {
  const nodes = [...r.nodes];
  const items = new Set(nodes.flatMap((n) => [...n.items]));
  const guides = new Set(nodes.flatMap((n) => n.guides.map((x) => x.id)));
  return {
    concepts: nodes.length, questions: nodes.reduce((s, n) => s + n.questions.length, 0), examples: nodes.reduce((s, n) => s + n.examples.length, 0),
    items: items.size, guides: guides.size,
  };
}
function renderRoute() {
  const r = route;
  const n = routeCounts(r);
  const k = known();
  const title = r.course ? `${r.stage ? `${r.stage.label} · ` : ''}${r.course.name}` : r.steps.filter((s) => s.target).map((s) => s.node.name).slice(0, 3).join(', ');
  const bands = new Map();
  for (const s of r.steps) { if (!bands.has(s.band)) bands.set(s.band, []); bands.get(s.band).push(s); }
  const el = $('#map-panel');
  el.innerHTML = `${closeButton()}<p class="kicker">Ruta de estudio</p><h2>${esc(title)}</h2>
    ${r.professor || r.term ? `<p class="muted">${esc([r.professor && `Con ${r.professor}`, r.term && termLabel(r.term)].filter(Boolean).join(' · '))}</p>` : ''}
    ${say ? `<p class="said">${esc(say)}</p>` : ''}
    <div class="route-stats">${[[n.concepts, 'concepto', 'conceptos'], [n.questions, 'pregunta', 'preguntas'], [n.examples, 'ejemplo', 'ejemplos'], [n.items + n.guides, 'fuente', 'fuentes']]
      .map(([v, one, many]) => `<span><b>${v.toLocaleString('es')}</b> ${v === 1 ? one : many}</span>`).join('')}</div>
    ${r.notes.map((x) => `<p class="note">${esc(x)}</p>`).join('')}
    <div class="actions"><button class="button primary" data-route-guide>Crear una guía con esta ruta</button></div>
    <div class="route-opts">
      <label class="toggle small"><input type="checkbox" data-route-rest ${F.routeRest ? 'checked' : ''}><span class="knob"></span>Ver el resto del mapa, tenue</label>
      <label class="toggle small"><input type="checkbox" data-route-missing ${F.routeMissing ? 'checked' : ''}><span class="knob"></span>Solo lo que todavía no sé</label>
    </div>
    <ol class="route-steps">${[...bands].map(([b, steps]) => `<li><h3>${esc(r.bandLabels[b] ?? '')} <small>${steps.length}</small></h3><ul>${steps.map((s) => `<li class="${k.has(s.node.key) ? 'known' : ''}">
      <button class="link" data-node="${esc(s.node.id)}">${esc(s.node.name)}</button>${s.node.questions.length ? `<small>${plural(s.node.questions.length, 'pregunta', 'preguntas')}</small>` : ''}${s.node.courses.size && r.course && !s.node.courses.has(r.course.id) ? `<small class="from">${esc(graph().byId.get([...s.node.courses][0])?.name ?? '')}</small>` : ''}
      <button class="tick" data-know="${esc(s.node.key)}" aria-pressed="${k.has(s.node.key)}" title="Ya lo sé"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></li>`).join('')}</ul></li>`).join('')}</ol>
    <div class="actions"><button class="link" data-route-exit>Salir de la ruta</button></div>`;
  el.setAttribute('style', themeStyle(r.course?.theme ?? 'estrellas'));
  el.hidden = false;
  el.scrollTop = 0;
}
// The route builder: a course, an evaluation, and if wanted a professor and a term.
function routeForm(c = pickedCourse()) {
  const g = graph();
  const courses = g.courses.filter((x) => !x.planned).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const course = c ?? courses[0];
  if (!course) { ctx.toast('El mapa todavía no tiene materias.'); return; }
  const stages = (course.stageList ?? []).filter((s) => s.order != null);
  const el = $('#map-panel');
  el.innerHTML = `${closeButton()}<p class="kicker">Ruta de estudio</p><h2>¿Qué vas a rendir?</h2>
    <p class="muted">La ruta junta lo que entra hasta esa evaluación y todo lo que necesitas antes, de cualquier materia. Lo de evaluaciones posteriores queda fuera.</p>
    <form class="grid route-form" id="route-form">
      <label class="field wide"><span>Materia</span><select name="course">${courses.map((x) => `<option value="${esc(x.id)}" ${x === course ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Hasta</span><select name="stage"><option value="">Toda la materia</option>${stages.map((s) => `<option value="${esc(s.label)}">${esc(s.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Profesor</span><select name="professor"><option value="">Cualquiera</option>${[...course.professors.keys()].map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label class="field"><span>Semestre</span><select name="term"><option value="">Cualquiera</option>${[...new Set([...course.terms].map(termKey))].sort().reverse().map((x) => `<option value="${esc(x)}">${esc(termLabel(x))}</option>`).join('')}</select></label>
      <div class="actions wide"><button class="button primary">Trazar la ruta</button></div>
    </form>
    ${stages.length ? '' : `<p class="note">Ningún material de ${esc(course.name)} dice todavía a qué evaluación pertenece. Al aportar, completa «Evaluación» y la ruta podrá detenerse donde corresponde.</p>`}`;
  el.setAttribute('style', themeStyle(course.theme));
  el.hidden = false;
  el.querySelector('[name="course"]').addEventListener('change', (e) => routeForm(g.byId.get(e.target.value)));
}

/* ---------- asking in words ---------- */
async function ask(text, withAI) {
  const g = graph();
  say = '';
  let answer = null;
  if (withAI && ai.ready()) {
    const status = $('#map-said');
    status.hidden = false; status.textContent = 'Tu IA está leyendo el mapa…';
    try {
      const res = await ai.run({ system: askInstructions(), text: `Índice del mapa de Studium:\n\n${mapIndex(g)}\n\nPregunta: ${text}`, maxTokens: 1500, use: ai.choice('ask') });
      answer = readAskAnswer(g, res.text);
    } catch (error) { ctx.toast(error.message || 'Tu IA no respondió; respondo yo.'); }
    status.hidden = true;
  }
  answer ??= readAsk(g, text);
  say = answer.say ?? '';
  act(answer);
}
function act(a) {
  const g = graph();
  if (a.action === 'route') {
    startRoute({ course: a.course, stage: a.stage, professor: a.professor, term: a.term, to: a.to });
  } else if (a.action === 'path') {
    const path = pathBetween(g, a.from, a.to);
    if (!path.length) { ctx.toast(`No hay un camino entre ${a.from.name} y ${a.to.name} todavía.`); return; }
    route = null;
    special = { kind: 'path', nodes: new Set(path), path, label: `${a.from.name} → ${a.to.name}` };
    compute();
    renderPath();
    setTimeout(() => view.fit(path), 60);
  } else if (a.action === 'concepts') {
    route = null;
    special = { kind: 'concepts', nodes: new Set(a.concepts), label: a.say };
    compute();
    view.selectMany(a.concepts);
    setTimeout(() => view.fit(a.concepts.length > 1 ? a.concepts : [...neighbourhood(g, a.concepts[0], 1)]), 60);
  } else if (a.action === 'course') {
    route = null; special = null;
    compute();
    view.select(a.course, { fly: true });
  } else ctx.toast(a.say);
}
function renderPath() {
  const p = special.path;
  const el = $('#map-panel');
  el.innerHTML = `${closeButton()}<p class="kicker">Camino</p><h2>${esc(special.label)}</h2>${say ? `<p class="said">${esc(say)}</p>` : ''}
    <ol class="path">${p.map((n) => `<li><button class="link" data-node="${esc(n.id)}">${esc(n.name)}</button> <small class="muted">${esc({ concept: 'concepto', course: 'materia', guide: 'guía' }[n.type] ?? '')}</small></li>`).join('')}</ol>
    <div class="actions"><button class="button ghost" data-route-to-selection>Ruta hasta ${esc(p.at(-1).name)}</button><button class="link" data-clear-special>Volver al mapa</button></div>`;
  el.removeAttribute('style');
  el.hidden = false;
}

/* ---------- search ---------- */
let results = [];
let active = -1;
function search(text) {
  const q = keyOf(text);
  const list = $('#map-results');
  if (!q) { list.hidden = true; results = []; return; }
  const g = graph();
  const has = (s) => keyOf(s).includes(q);
  const out = [];
  const wordsIn = q.split('-').length;
  if (wordsIn >= 2) {
    out.push({ kind: 'ask', label: `Preguntarle al mapa: «${text.trim()}»`, ai: false });
    if (ai.ready()) out.push({ kind: 'ask', label: `Preguntarle a tu IA (${ai.PROVIDERS[ai.choice('ask').provider]?.name ?? 'IA'})`, ai: true });
  }
  for (const c of g.courses) if (has(c.name) || has(c.code)) out.push({ kind: 'node', node: c, label: c.name, tag: 'Materia' });
  const concepts = g.nodes.filter((n) => n.type === 'concept' && (has(n.name) || [...n.aliases].some(has))).sort((a, b) => (keyOf(a.name).startsWith(q) ? 0 : 1) - (keyOf(b.name).startsWith(q) ? 0 : 1) || b.weight - a.weight);
  for (const n of concepts.slice(0, 8)) out.push({ kind: 'node', node: n, label: n.name, tag: [...n.courses].map((id) => g.byId.get(id)?.name).filter(Boolean).slice(0, 2).join(', ') || 'Concepto' });
  for (const n of g.nodes.filter((x) => x.type === 'guide' && has(x.name)).slice(0, 3)) out.push({ kind: 'node', node: n, label: n.name, tag: `Guía · ${n.course.name}` });
  const profs = [...new Set(g.courses.flatMap((c) => [...c.professors.keys()]))].filter(has);
  for (const p of profs.slice(0, 3)) out.push({ kind: 'prof', label: p, tag: 'Profesor: filtrar' });
  if (!out.length) out.push({ kind: 'ask', label: `Preguntarle al mapa: «${text.trim()}»`, ai: false });
  results = out.slice(0, 12);
  active = 0;
  list.innerHTML = results.map((r, i) => `<li role="option" id="mr-${i}" aria-selected="${i === active}" data-i="${i}" class="${r.kind}"><span>${esc(r.label)}</span>${r.tag ? `<small>${esc(r.tag)}</small>` : ''}</li>`).join('');
  list.hidden = false;
}
function choose(i) {
  const r = results[i];
  const input = $('#map-q');
  $('#map-results').hidden = true;
  if (!r) return;
  if (r.kind === 'ask') { ask(input.value, r.ai); input.blur(); return; }
  if (r.kind === 'prof') { F.professors = [r.label]; keep(); compute(); renderDrawer(); input.value = ''; return; }
  route = null; special = null;
  if (r.node.hidden) { F.hidden = F.hidden.filter((id) => id !== r.node.id); for (const id of r.node.courses ?? [r.node.course?.id]) F.coursesOff = F.coursesOff.filter((x) => x !== id); keep(); }
  compute();
  view.select(r.node, { fly: true });
  input.value = '';
}

/* ---------- the drawer of filters ---------- */
const check = (name, value, label, on, extra = '') => `<label class="opt"><input type="checkbox" data-f="${name}" value="${esc(value)}" ${on ? 'checked' : ''}><span>${label}</span>${extra}</label>`;
function renderDrawer() {
  const g = graph();
  const el = $('#map-drawer');
  if (!el || el.hidden) return;
  const p = prefs.get();
  const off = new Set(F.coursesOff);
  const byTheme = new Map();
  for (const c of [...g.courses].sort((a, b) => a.name.localeCompare(b.name, 'es'))) { if (!byTheme.has(c.theme)) byTheme.set(c.theme, []); byTheme.get(c.theme).push(c); }
  const count = (c) => g.nodes.filter((n) => n.type === 'concept' && n.courses.has(c.id)).length;
  const profs = new Map();
  for (const c of g.courses) for (const prof of c.professors.keys()) profs.set(prof, [...(profs.get(prof) ?? []), c.name]);
  const terms = [...new Set(g.courses.flatMap((c) => [...c.terms].map(termKey)))].filter(Boolean).sort().reverse();
  const stages = [...new Map(g.courses.flatMap((c) => c.stageList ?? []).filter((s) => s.order != null).map((s) => [s.label, s])).values()].sort((a, b) => a.order - b.order);
  const kinds = [...new Set(ctx.state.contributions.map((x) => x.kind).filter((k) => k !== 'curriculum'))];
  const areas = [...new Set(g.courses.map((c) => c.theme))];
  const mineChosen = p.courses.length || p.interests.length;
  el.innerHTML = `<header><h2>Filtros</h2><button class="link" data-f-reset>Quitar todos</button><button class="icon" data-drawer-close aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></header>
    <section><h3>Lo tuyo</h3>
      <label class="toggle small"><input type="checkbox" data-f-mine ${F.mine ? 'checked' : ''} ${mineChosen ? '' : 'disabled'}><span class="knob"></span>Solo mis materias e intereses</label>
      <details ${mineChosen ? '' : 'open'}><summary>${mineChosen ? 'Cambiar mis materias e intereses' : 'Elige tus materias e intereses para ocultar lo que no estudias'}</summary>
        <p class="fine">Mis materias de este semestre</p>
        <div class="chips small">${g.courses.filter((c) => !c.planned).map((c) => `<button class="chip ${p.courses.includes(c.key) ? 'on' : ''}" data-my-course="${esc(c.key)}" style="${themeStyle(c.theme)}"><i></i>${esc(c.name)}</button>`).join('')}</div>
        <p class="fine">Intereses y hobbies</p>
        <div class="chips small">${Object.keys(THEMES).filter((k) => k !== 'estrellas').map((k) => `<button class="chip ${p.interests.includes(`area:${k}`) ? 'on' : ''}" data-my-area="${k}" style="${themeStyle(k)}"><i></i>${esc(AREAS[k])}</button>`).join('')}</div>
      </details></section>
    <section><h3>Materias <small>${g.courses.length - off.size} de ${g.courses.length}</small></h3>
      <input class="filter-q" type="search" placeholder="Buscar una materia" data-course-q>
      <div class="links-row"><button class="link" data-courses="all">Todas</button><button class="link" data-courses="none">Ninguna</button>${areas.length > 1 ? areas.map((a) => `<button class="link" data-courses-area="${esc(a)}">Solo ${esc(AREAS[a] ?? a)}</button>`).join('') : ''}</div>
      <div class="opts" data-course-list>${[...byTheme].map(([theme, list]) => `<p class="group" style="${themeStyle(theme)}">${esc(AREAS[theme] ?? theme)}</p>${list.map((c) => check('course', c.id, `<i style="${themeStyle(c.theme)}"></i>${esc(c.name)}`, !off.has(c.id), `<small>${count(c)}</small>`)).join('')}`).join('')}</div></section>
    ${stages.length ? `<section><h3>Hasta la evaluación</h3><p class="fine">Oculta lo que entra después. Lo que no tiene evaluación asignada queda tenue.</p>
      <select data-f-until><option value="">Todo</option>${stages.map((s) => `<option ${F.until === s.label ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></section>` : ''}
    ${profs.size ? `<section><h3>Profesor</h3><div class="opts">${[...profs].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([name, courses]) => check('professor', name, esc(name), F.professors.includes(name), `<small>${esc(courses.slice(0, 2).join(', '))}</small>`)).join('')}</div></section>` : ''}
    ${terms.length ? `<section><h3>Semestre académico</h3><div class="opts">${terms.map((x) => check('term', x, esc(termLabel(x)), F.terms.includes(x), `<small>${esc(x)}</small>`)).join('')}</div></section>` : ''}
    <section><h3>De dónde viene</h3><div class="opts">${ctx.state.sources.map((s) => check('source', s.id, esc(s.name), F.sources.includes(s.id))).join('')}${check('source', 'community', 'Aportes de estudiantes', F.sources.includes('community'))}${check('source', 'mine', 'Lo que aporté yo', F.sources.includes('mine'))}</div></section>
    ${kinds.length ? `<section><h3>Tipo de material</h3><div class="opts">${kinds.map((k) => check('kind', k, esc(KINDS[k] ?? k), F.kinds.includes(k))).join('')}${check('kind', 'guide', 'Guías', F.kinds.includes('guide'))}</div></section>` : ''}
    <section><h3>Qué se ve</h3>
      ${['guide', 'material', 'document', 'ghost', 'more'].map((k) => `<label class="toggle small"><input type="checkbox" data-f-show="${k}" ${F.show[k] ? 'checked' : ''}><span class="knob"></span>${{ guide: 'Guías', material: 'Materiales (exámenes, deberes, libros…)', document: 'Sílabos y documentos de la biblioteca', ghost: 'Conceptos mencionados que nadie explicó', more: 'Más nombres a la vez' }[k]}</label>`).join('')}
      ${F.hidden.length ? `<p class="fine">${plural(F.hidden.length, 'elemento ocultado', 'elementos ocultados')} a mano. <button class="link" data-unhide>Mostrarlos</button></p>` : ''}</section>
    <footer class="drawer-credits"><button class="link" data-map-info>¿Para qué sirve el mapa?</button><a class="link" href="#/fuentes">Créditos</a></footer>`;
}
function renderChips() {
  const el = $('#map-chips');
  const g = graph();
  const chips = [];
  if (F.mine) chips.push(['mine', 'Solo lo mío']);
  if (F.coursesOff.length) chips.push(['courses', `${g.courses.length - F.coursesOff.length} de ${g.courses.length} materias`]);
  if (F.until) chips.push(['until', `Hasta ${F.until}`]);
  for (const p of F.professors) chips.push([`professor:${p}`, p]);
  for (const x of F.terms) chips.push([`term:${x}`, termLabel(x)]);
  for (const s of F.sources) chips.push([`source:${s}`, s === 'community' ? 'Aportes de estudiantes' : s === 'mine' ? 'Lo mío' : sourceName(s)]);
  for (const k of F.kinds) chips.push([`kind:${k}`, k === 'guide' ? 'Guías' : KINDS[k] ?? k]);
  if (F.hidden.length) chips.push(['hidden', `${F.hidden.length} ocultos`]);
  if (lens !== 'normal') chips.push(['lens', LENSES[lens].name]);
  if (special?.kind === 'focus') chips.push(['special', `Alrededor de ${special.label}`]);
  el.innerHTML = chips.map(([id, label]) => `<button class="chip on" data-chip="${esc(id)}">${esc(label)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>`).join('');
  $('#map-filter-count').textContent = String(chips.filter(([id]) => id !== 'lens').length);
  $('#map-filter-count').hidden = !chips.filter(([id]) => id !== 'lens').length;
}
function dropChip(id) {
  const [kind, value] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)];
  if (kind === 'mine') F.mine = false;
  if (kind === 'courses') F.coursesOff = [];
  if (kind === 'until') F.until = '';
  if (kind === 'professor') F.professors = F.professors.filter((x) => x !== value);
  if (kind === 'term') F.terms = F.terms.filter((x) => x !== value);
  if (kind === 'source') F.sources = F.sources.filter((x) => x !== value);
  if (kind === 'kind') F.kinds = F.kinds.filter((x) => x !== value);
  if (kind === 'hidden') F.hidden = [];
  if (kind === 'lens') { setLens('normal'); return; }
  if (kind === 'special') special = null;
  keep(); compute(); renderDrawer();
}
function renderCount() {
  const el = $('#map-count');
  if (!el) return;
  const shown = view.active?.filter((n) => n.type === 'concept').length ?? 0;
  const all = graph().nodes.filter((n) => n.type === 'concept').length;
  el.textContent = shown === all ? plural(all, 'concepto', 'conceptos') : `${shown.toLocaleString('es')} de ${plural(all, 'concepto', 'conceptos')}`;
}
function renderViews() {
  const el = $('#map-views');
  el.innerHTML = Object.entries(LENSES).filter(([id]) => id !== 'career' || graph().nodes.some((n) => n.type === 'career'))
    .map(([id, l]) => `<button role="menuitemradio" aria-checked="${id === lens}" data-lens="${id}"><strong>${esc(l.name)}</strong><span>${esc(l.text)}</span></button>`).join('');
  $('#map-view-name').textContent = LENSES[lens].name;
}

/* ---------- the panel ---------- */
const closeButton = () => '<button class="icon" id="panel-close" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>';
const chipsOf = (nodes) => nodes.map((n) => `<button class="chip" data-node="${esc(n.id)}" style="${themeStyle(n.theme ?? graph().byId.get(n.home)?.theme)}"><i></i>${esc(n.name)}</button>`).join('');
const credit = (ids) => { const list = [...ids].filter(Boolean); return list.length ? ` Con material de ${list.map((id) => `<a href="#/fuentes">${esc(sourceName(id))}</a>`).join(' y ')}.` : ''; };
function nodeActions(n) {
  const k = known();
  return `<div class="node-actions">
    ${n.type === 'concept' ? `<button class="button ghost small ${k.has(n.key) ? 'on' : ''}" data-know="${esc(n.key)}" aria-pressed="${k.has(n.key)}">${k.has(n.key) ? 'Ya lo sé ✓' : 'Ya lo sé'}</button>` : ''}
    ${n.type === 'concept' ? '<button class="button ghost small" data-act="route-to">Qué necesito antes</button>' : ''}
    <button class="button ghost small" data-act="focus">Solo lo de alrededor</button>
    <button class="button ghost small" data-act="hide">Ocultar</button>
  </div>`;
}
function panel(n) {
  const el = $('#map-panel');
  const sel = view.selection;
  if (!n && sel.size > 1) { selectionPanel(); return; }
  if (!n) {
    if (route) { renderRoute(); return; }
    if (special?.kind === 'path') { renderPath(); return; }
    el.hidden = true;
    return;
  }
  const g = graph();
  let html = '';
  if (n.type === 'concept') {
    const courses = [...n.courses].map((id) => g.byId.get(id)).filter(Boolean);
    // The question bank, by professor (or by evaluation when the professor is not known); a question asked again in
    // other evaluations counts once, with how often it came.
    const byWho = new Map();
    for (const q of n.questions) {
      const who = q.professor ? [q.professor, q.term && termLabel(q.term)].filter(Boolean).join(', ') : [q.stage || q.title, 'profesor sin indicar'].filter(Boolean).join(', ');
      byWho.set(who, [...(byWho.get(who) ?? []), q]);
    }
    const rel = n.relations.filter((r, i, all) => all.findIndex((x) => x.key === r.key && x.kind === r.kind) === i);
    const places = [...n.stageBy].map(([id, o]) => { const c = g.byId.get(id); const s = c?.stageList?.find((x) => x.order === o); return c && s ? `${c.name}: ${s.label}` : ''; }).filter(Boolean);
    const items = itemById();
    const materials = [...n.items].map((id) => items.get(id)).filter(Boolean);
    html = `<p class="kicker">${n.ghost ? 'Concepto mencionado' : 'Concepto'}</p><h2>${esc(n.name)}</h2>
      ${n.aliases.size ? `<p class="muted aka">También: ${esc([...n.aliases].slice(0, 6).join(', '))}</p>` : ''}
      <div class="chips small">${chipsOf(courses)}</div>
      ${places.length ? `<p class="muted">Entra en ${esc(places.join(' · '))}</p>` : ''}
      ${nodeActions(n)}
      ${n.summaries.length ? `<p>${esc([...n.summaries].slice(0, 4).sort((a, b) => b.text.length - a.text.length)[0].text)}</p>` : n.ghost ? '<p class="muted">Otros conceptos lo mencionan, pero ningún aporte lo explica todavía.</p>' : ''}
      ${rel.length ? `<h3>Relaciones</h3><ul class="rel">${rel.slice(0, 14).map((r) => {
        const other = `<button class="link" data-node="concept:${esc(r.key)}">${esc(g.byId.get(`concept:${r.key}`)?.name ?? r.name)}</button>`;
        const verb = esc(RELATIONS[r.kind] ?? 'se relaciona con');
        return `<li>${r.out ? `<span class="muted">${verb[0].toUpperCase()}${verb.slice(1)}</span> ${other}` : `${other} <span class="muted">${verb} este concepto</span>`}</li>`;
      }).join('')}</ul>` : ''}
      ${byWho.size ? `<h3>Cómo lo preguntan <small>${plural(n.questions.length, 'pregunta', 'preguntas')}</small></h3>${[...byWho].map(([who, qs]) => {
        const groups = bank(qs);
        const kinds = {};
        for (const { q } of groups) kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
        return `<details class="asked"><summary><strong>${esc(who || 'Sin profesor')}</strong> <span class="muted">${plural(groups.length, 'pregunta', 'preguntas')}: ${Object.entries(kinds).map(([k, c]) => `${esc(QUESTION_KINDS[k] ?? k).toLowerCase()} ${c}`).join(', ')}</span></summary>
          <ul>${groups.slice(0, 10).map(({ q, seen }) => `<li><span class="muted">${esc([q.stage || q.title, q.number && `pregunta ${q.number}`].filter(Boolean).join(', '))}: ${esc(QUESTION_KINDS[q.kind] ?? '').toLowerCase()}, dificultad ${q.difficulty} de 5</span>${seen.length > 1 ? `<span class="again">Salió en ${seen.length} evaluaciones</span>` : ''}<p>${esc(q.text)}</p>${q.solution ? `<details><summary>Ver solución</summary><p>${esc(q.solution)}</p></details>` : ''}</li>`).join('')}</ul></details>`;
      }).join('')}` : ''}
      ${n.examples.length ? `<h3>Ejemplos</h3><ul class="ex">${n.examples.slice(0, 3).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
      ${n.guides.length ? `<h3>En guías</h3><ul class="links">${n.guides.map((x) => `<li><a href="#/guia/${encodeURIComponent(x.id)}${x.anchor ? `/${encodeURIComponent(x.anchor)}` : ''}">${esc(x.course)}: ${esc(x.title)}</a></li>`).join('')}</ul>` : ''}
      ${materials.length ? `<h3>Sale de</h3><ul class="links">${materials.slice(0, 8).map((x) => `<li><button class="link" data-node="material:${esc(x.id)}">${esc(x.title)}</button> <small class="muted">${esc([KINDS[x.kind], x.professor, x.term].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul><p class="fine">${credit(n.sources)}</p>` : ''}`;
  } else if (n.type === 'course') {
    const concepts = g.links.filter((l) => l.kind === 'in' && l.source === n).map((l) => l.target).sort((a, b) => b.weight - a.weight);
    const next = upcoming(g, n);
    const before = g.links.filter((l) => l.kind === 'prerequisite' && l.target === n).map((l) => l.source);
    const counts = {};
    for (const c of n.contributions) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    const stages = n.stageList ?? [];
    html = `<p class="kicker">${n.planned ? 'Materia de la malla' : 'Materia o competencia'}</p><h2>${esc(n.name)}</h2>
      <p class="muted">${esc([n.code, ...n.careers.map((c) => `${g.byId.get(c.career)?.name}, semestre ${c.semester}`)].filter(Boolean).join('. '))}</p>
      ${n.contributions.length ? `<p>${Object.entries(counts).map(([k, c]) => esc(countKind(k, c))).join(', ')}.${credit(n.sources)}</p>` : '<p class="muted">Nadie aportó material de esta materia todavía.</p>'}
      ${n.professors.size ? `<h3>Profesores</h3><ul class="profs">${[...n.professors].map(([p, terms]) => `<li><button class="link" data-prof="${esc(p)}">${esc(p)}</button>${terms.size ? ` <small class="muted">${esc([...terms].map(termLabel).join(', '))}</small>` : ''}</li>`).join('')}</ul>` : ''}
      ${stages.length ? `<h3>Evaluaciones <small>toca una para ver su ruta</small></h3><div class="stages">${stages.map((s) => `<button class="stage ${s.order == null ? 'loose' : ''}" data-stage="${esc(s.label)}" ${s.order == null ? 'disabled' : ''}><b>${esc(s.label)}</b><small>${plural(s.concepts.size, 'concepto', 'conceptos')}</small></button>`).join('')}</div>` : ''}
      <div class="actions">
        <button class="button primary" data-act="route">Trazar una ruta</button>
        <button class="button ghost" data-act="timeline">Línea de tiempo</button>
        ${n.contributions.length || n.guides.length ? `<a class="button ghost" href="#/aportar/guia/${encodeURIComponent(n.id)}">Crear una guía</a>` : '<a class="button ghost" href="#/aportar">Aportar material</a>'}
      </div>
      ${nodeActions(n)}
      ${before.length ? `<h3>Se necesita antes</h3><div class="chips small">${chipsOf(before)}</div>` : ''}
      ${next.length ? `<h3>Lo que viene después</h3><ul class="next">${next.map((x) => `<li><button class="link" data-node="${esc(x.course.id)}">${esc(x.course.name)}</button>${x.shared.length ? `<span class="muted"> usa ${esc(x.shared.slice(0, 5).map((s) => s.name).join(', '))}${x.shared.length > 5 ? ` y ${x.shared.length - 5} más` : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${concepts.length ? `<h3>Conceptos más evaluados</h3><div class="chips small">${chipsOf(concepts.slice(0, 18))}</div>` : ''}
      ${n.contributions.length ? `<h3>Materiales <small>${n.contributions.length}</small></h3><ul class="links">${[...n.contributions].sort((a, b) => (stageOf(a.stage || a.title)?.order ?? 1e6) - (stageOf(b.stage || b.title)?.order ?? 1e6)).slice(0, 30).map((x) => `<li><button class="link" data-node="material:${esc(x.id)}">${esc(x.title)}</button> <small class="muted">${esc([KINDS[x.kind], x.stage, x.professor, x.term].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>` : ''}
      ${n.documents.length ? `<h3>Sílabo y documentos</h3><ul class="links">${n.documents.map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a> <small class="muted">${esc(DOC_KINDS[d.kind] ?? '')}</small></li>`).join('')}</ul>` : ''}
      ${n.guides.length ? `<h3>Guías</h3><ul class="links">${n.guides.map((e) => `<li><a href="#/guia/${encodeURIComponent(e.id)}">${esc(e.title)}</a> <small class="muted">${esc([e.professor, e.term].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>` : ''}`;
  } else if (n.type === 'guide') {
    const e = n.entry;
    html = `<p class="kicker">Guía</p><h2>${esc(e.title)}</h2><p class="muted">${esc([n.course.name, e.professor, e.term].filter(Boolean).join(', '))}</p>
      ${e.level ? `<p><span class="level">${esc(LEVELS[e.level])}</span></p>` : ''}
      <div class="actions"><a class="button primary" href="#/guia/${encodeURIComponent(e.id)}">Abrir la guía</a>${n.stage?.order != null ? `<button class="button ghost" data-stage="${esc(n.stage.label)}" data-course="${esc(n.course.id)}">Ruta hasta ${esc(n.stage.label)}</button>` : ''}</div>`;
  } else if (n.type === 'material') {
    const x = n.item;
    const concepts = g.links.filter((l) => l.kind === 'teaches' && l.source === n).map((l) => l.target);
    html = `<p class="kicker">${esc(KINDS[x.kind] ?? 'Material')}</p><h2>${esc(x.title)}</h2>
      <p class="muted">${esc([n.course.name, x.stage, x.professor, x.term && termLabel(x.term)].filter(Boolean).join(' · '))}</p>
      <p>${plural(x.data?.concepts?.length ?? 0, 'concepto', 'conceptos')}, ${plural(x.data?.questions?.length ?? 0, 'pregunta', 'preguntas')}, ${plural(x.data?.examples?.length ?? 0, 'ejemplo', 'ejemplos')}.${credit([x.source])}</p>
      ${x.data?.style ? `<h3>Cómo evalúa</h3><p>${esc(x.data.style)}</p>` : ''}
      ${x.data?.source?.title ? `<p class="muted">${esc([x.data.source.title, x.data.source.author, x.data.source.chapter].filter(Boolean).join(', '))}</p>` : ''}
      <div class="actions"><button class="button ghost" data-act="select-taught">Ver sus conceptos</button></div>
      <h3>Conceptos</h3><div class="chips small">${chipsOf(concepts.slice(0, 40))}</div>`;
  } else if (n.type === 'document') {
    const d = n.doc;
    html = `<p class="kicker">${esc(DOC_KINDS[d.kind] ?? 'Documento')}</p><h2>${esc(d.title)}</h2>
      <p class="muted">${esc([n.course.name, d.professor, d.term].filter(Boolean).join(' · '))}</p>${d.note ? `<p>${esc(d.note)}</p>` : ''}
      <div class="actions"><a class="button primary" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Abrir</a></div>`;
  } else if (n.type === 'career') {
    html = `<p class="kicker">Carrera</p><h2>${esc(n.name)}</h2><p class="muted">${esc(n.university)}</p>
      ${n.semesters.map((ids, s) => (ids?.length ? `<h3>Semestre ${s}</h3><div class="chips small">${chipsOf(ids.map((id) => g.byId.get(id)).filter(Boolean))}</div>` : '')).join('')}`;
  }
  el.innerHTML = closeButton() + html;
  el.setAttribute('style', themeStyle(n.type === 'course' ? n.theme : n.course?.theme ?? g.byId.get(n.home)?.theme));
  el.hidden = false;
  el.scrollTop = 0;
}
function selectionPanel() {
  const sel = [...view.selection];
  const g = graph();
  const byType = {};
  for (const n of sel) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const words = { concept: ['concepto', 'conceptos'], course: ['materia', 'materias'], guide: ['guía', 'guías'], material: ['material', 'materiales'], document: ['documento', 'documentos'], career: ['carrera', 'carreras'] };
  const el = $('#map-panel');
  el.innerHTML = `${closeButton()}<p class="kicker">Selección</p><h2>${plural(sel.length, 'elemento', 'elementos')}</h2>
    <p class="muted">${Object.entries(byType).map(([k, c]) => plural(c, ...words[k])).join(', ')}</p>
    <div class="sel-actions">
      <button class="button primary" data-sel="guide">Crear una guía con esto</button>
      <button class="button ghost" data-sel="route">Qué necesito antes</button>
      <button class="button ghost" data-sel="neighbours">Sumar lo de alrededor</button>
      <button class="button ghost" data-sel="island">Sumar sus materias enteras</button>
      <button class="button ghost" data-sel="invert">Invertir</button>
      <button class="button ghost" data-sel="only">Mostrar solo esto</button>
      <button class="button ghost" data-sel="hide">Ocultar</button>
      <button class="button ghost" data-sel="know">Ya lo sé</button>
      <button class="link" data-sel="clear">Deseleccionar</button>
    </div>
    <p class="fine">Mayús o Ctrl + clic suma o quita un punto. Mayús + arrastrar en el fondo selecciona un área.</p>
    <div class="chips small">${chipsOf(sel.slice(0, 60))}${sel.length > 60 ? `<span class="chip">y ${sel.length - 60} más</span>` : ''}</div>`;
  el.removeAttribute('style');
  el.hidden = false;
  if (!g) return;
}
function selectionAct(kind) {
  const g = graph();
  const sel = [...view.selection];
  const concepts = sel.filter((n) => n.type === 'concept');
  if (kind === 'clear') view.select(null);
  if (kind === 'neighbours') view.selectMany(sel.flatMap((n) => [...(view.adjacent.get(n) ?? [])]), { add: true });
  if (kind === 'island') {
    const courses = new Set(sel.flatMap((n) => (n.type === 'course' ? [n.id] : [...(n.courses ?? []), n.course?.id].filter(Boolean))));
    view.selectMany(g.nodes.filter((n) => courses.has(n.id) || [...(n.courses ?? [])].some((id) => courses.has(id)) || courses.has(n.course?.id)), { add: true });
  }
  if (kind === 'invert') { const set = new Set(sel); view.selectMany(view.active.filter((n) => !set.has(n))); }
  if (kind === 'hide') { F.hidden = [...new Set([...F.hidden, ...sel.map((n) => n.id)])]; keep(); view.select(null); compute(); }
  if (kind === 'only') { special = { kind: 'focus', nodes: new Set(sel), label: plural(sel.length, 'elemento', 'elementos') }; compute(); setTimeout(() => view.fit(sel), 60); }
  if (kind === 'know') { const k = known(); for (const n of concepts) k.add(n.key); prefs.set({ known: [...k] }); ctx.toast(`${plural(concepts.length, 'concepto marcado', 'conceptos marcados')} como sabidos.`); compute(); }
  if (kind === 'route') { if (!concepts.length) { ctx.toast('Selecciona al menos un concepto.'); return; } startRoute({ to: concepts }); }
  if (kind === 'guide') guideFrom(concepts.length ? concepts : sel.flatMap((n) => (n.type === 'course' ? g.nodes.filter((m) => m.type === 'concept' && m.courses.has(n.id)) : [])), null);
}
// A guide from the map: the course the concepts belong to most, and exactly these concepts as its source.
function guideFrom(concepts, r) {
  if (!concepts.length) { ctx.toast('No hay conceptos para la guía.'); return; }
  const g = graph();
  const votes = new Map();
  for (const n of concepts) for (const id of n.courses) votes.set(id, (votes.get(id) ?? 0) + 1);
  const course = r?.course ?? g.byId.get([...votes].sort((a, b) => b[1] - a[1])[0]?.[0]);
  ctx.presetGuide({
    course: course?.name ?? '', code: course?.code ?? '', title: r?.stage?.label ?? '', professor: r?.professor ?? '', term: r?.term ?? '', graph: true,
    route: { keys: concepts.map((n) => n.key), label: r ? `${r.stage ? `hasta ${r.stage.label}` : 'completa'}` : '', bands: r ? Object.fromEntries(r.steps.map((s) => [s.node.key, r.bandLabels[s.band]])) : null },
  });
  location.hash = '#/aportar/guia';
}

/* ---------- mounting ---------- */
export function mountMap(context) {
  ctx = context;
}
function setup() {
  view = new GraphView($('#map-canvas'), {
    onSelect: (n, sel) => { panel(sel.size > 1 ? null : n); },
    onOpen: (n) => { if (n.type === 'guide') location.hash = `#/guia/${encodeURIComponent(n.entry.id)}`; if (n.type === 'document') window.open(n.doc.url, '_blank', 'noopener'); },
  });
  // What covers the canvas, so fitting keeps the map in the free part of the screen.
  view.insets = () => {
    const bar = $('#map-bar').getBoundingClientRect();
    const drawer = $('#map-drawer');
    const pan = $('#map-panel');
    const wide = innerWidth > 820;
    return {
      top: bar.bottom + 8, bottom: wide ? 70 : 150,
      left: wide && !drawer.hidden ? drawer.getBoundingClientRect().right : 0,
      right: wide && !pan.hidden ? innerWidth - pan.getBoundingClientRect().left : 0,
    };
  };
  const root = $('#view-map');
  const input = $('#map-q');
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('focus', () => { if (input.value) search(input.value); });
  input.addEventListener('blur', () => setTimeout(() => { $('#map-results').hidden = true; }, 150));
  input.addEventListener('keydown', (e) => {
    const list = $('#map-results');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) search(input.value);
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
      for (const li of list.children) li.setAttribute('aria-selected', String(Number(li.dataset.i) === active));
      input.setAttribute('aria-activedescendant', `mr-${active}`);
    }
    if (e.key === 'Enter') { e.preventDefault(); if (!results.length) search(input.value); choose(Math.max(0, active)); }
    if (e.key === 'Escape') { list.hidden = true; input.blur(); }
  });
  $('#map-results').addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choose(Number(li.dataset.i)); } });
  $('#map-filters-open').addEventListener('click', () => {
    const d = $('#map-drawer');
    d.hidden = !d.hidden;
    $('#map-filters-open').setAttribute('aria-expanded', String(!d.hidden));
    renderDrawer();
  });
  $('#map-view-open').addEventListener('click', (e) => {
    const m = $('#map-views');
    m.hidden = !m.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!m.hidden));
    if (!m.hidden) renderViews();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#map-views, #map-view-open')) $('#map-views').hidden = true; });
  $('#map-route-open').addEventListener('click', () => routeForm());
  $('#map-grow').addEventListener('click', () => view.playGrowth());
  $('#map-fit').addEventListener('click', () => view.fit());
  $('#map-zoom-in').addEventListener('click', () => view.zoomBy(1.3));
  $('#map-zoom-out').addEventListener('click', () => view.zoomBy(0.77));
  $('#map-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (b) dropChip(b.dataset.chip); });
  $('#map-views').addEventListener('click', (e) => { const b = e.target.closest('[data-lens]'); if (b) { $('#map-views').hidden = true; setLens(b.dataset.lens); } });

  const drawer = $('#map-drawer');
  drawer.addEventListener('change', (e) => {
    const tgt = e.target;
    const f = tgt.dataset.f;
    if (f === 'course') { F.coursesOff = tgt.checked ? F.coursesOff.filter((x) => x !== tgt.value) : [...new Set([...F.coursesOff, tgt.value])]; }
    if (f === 'professor') F.professors = tgt.checked ? [...F.professors, tgt.value] : F.professors.filter((x) => x !== tgt.value);
    if (f === 'term') F.terms = tgt.checked ? [...F.terms, tgt.value] : F.terms.filter((x) => x !== tgt.value);
    if (f === 'source') F.sources = tgt.checked ? [...F.sources, tgt.value] : F.sources.filter((x) => x !== tgt.value);
    if (f === 'kind') F.kinds = tgt.checked ? [...F.kinds, tgt.value] : F.kinds.filter((x) => x !== tgt.value);
    if (tgt.dataset.fUntil !== undefined) F.until = tgt.value;
    if (tgt.dataset.fShow) F.show[tgt.dataset.fShow] = tgt.checked;
    if (tgt.dataset.fMine !== undefined) F.mine = tgt.checked;
    keep(); compute();
    if (f === 'course') { const h = drawer.querySelector('section h3 small'); if (h) h.textContent = `${graph().courses.length - F.coursesOff.length} de ${graph().courses.length}`; }
  });
  drawer.addEventListener('input', (e) => {
    if (e.target.dataset.courseQ === undefined) return;
    const q = keyOf(e.target.value);
    for (const opt of drawer.querySelectorAll('[data-course-list] .opt')) opt.hidden = !!q && !keyOf(opt.textContent).includes(q);
  });
  drawer.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const g = graph();
    if (b.dataset.drawerClose !== undefined) { drawer.hidden = true; $('#map-filters-open').setAttribute('aria-expanded', 'false'); return; }
    if (b.dataset.fReset !== undefined) { F = { ...structuredClone(BLANK), show: F.show }; lens = 'normal'; special = null; }
    if (b.dataset.courses === 'all') F.coursesOff = [];
    if (b.dataset.courses === 'none') F.coursesOff = g.courses.map((c) => c.id);
    if (b.dataset.coursesArea) F.coursesOff = g.courses.filter((c) => c.theme !== b.dataset.coursesArea).map((c) => c.id);
    if (b.dataset.unhide !== undefined) F.hidden = [];
    if (b.dataset.mapInfo !== undefined) { $('#map-info').showModal(); return; }
    if (b.dataset.myCourse) { const p = prefs.get(); prefs.set({ courses: p.courses.includes(b.dataset.myCourse) ? p.courses.filter((x) => x !== b.dataset.myCourse) : [...p.courses, b.dataset.myCourse] }); }
    if (b.dataset.myArea) { const p = prefs.get(); const id = `area:${b.dataset.myArea}`; prefs.set({ interests: p.interests.includes(id) ? p.interests.filter((x) => x !== id) : [...p.interests, id] }); }
    keep(); compute(); renderDrawer();
  });

  const pan = $('#map-panel');
  pan.addEventListener('click', (e) => {
    const g = graph();
    const go = e.target.closest('[data-node]');
    if (go) { const n = g.byId.get(go.dataset.node); if (n) { if (n.hidden && n.type === 'material' && !F.show.material) { F.show.material = true; keep(); compute(); } view.select(n, { fly: true }); } return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'panel-close') { if (route && !view.primary) { endRoute(); return; } if (special?.kind === 'path' && !view.primary) { special = null; compute(); pan.hidden = true; return; } view.select(null); return; }
    const n = view.primary;
    if (b.dataset.know) {
      const k = known();
      if (k.has(b.dataset.know)) k.delete(b.dataset.know); else k.add(b.dataset.know);
      prefs.set({ known: [...k] });
      if (route && !view.primary) renderRoute(); else panel(n);
      if (lens === 'missing' || F.routeMissing) compute();
      return;
    }
    if (b.dataset.prof) { F.professors = [b.dataset.prof]; keep(); compute(); renderDrawer(); return; }
    if (b.dataset.stage) { startRoute({ course: g.byId.get(b.dataset.course) ?? (n?.type === 'course' ? n : pickedCourse()), stage: b.dataset.stage }); return; }
    if (b.dataset.sel) { selectionAct(b.dataset.sel); return; }
    if (b.dataset.routeGuide !== undefined) { guideFrom([...route.nodes], route); return; }
    if (b.dataset.routeExit !== undefined) { endRoute(); return; }
    if (b.dataset.routeToSelection !== undefined) { startRoute({ to: [special.path.at(-1)].filter((x) => x.type === 'concept') }); return; }
    if (b.dataset.clearSpecial !== undefined) { special = null; compute(); pan.hidden = true; return; }
    const act = b.dataset.act;
    if (act === 'route') routeForm(n?.type === 'course' ? n : pickedCourse());
    if (act === 'route-to' && n) startRoute({ to: [n] });
    if (act === 'timeline') { view.select(n); setLens('timeline'); }
    if (act === 'focus' && n) { special = { kind: 'focus', nodes: neighbourhood(g, n, 1, view.adjacent), label: n.name }; compute(); setTimeout(() => view.fit([...special.nodes]), 60); }
    if (act === 'hide' && n) { F.hidden = [...new Set([...F.hidden, n.id])]; keep(); view.select(null); compute(); }
    if (act === 'select-taught' && n) view.selectMany(g.links.filter((l) => l.kind === 'teaches' && l.source === n).map((l) => l.target));
  });
  pan.addEventListener('change', (e) => {
    if (e.target.dataset.routeRest !== undefined) { F.routeRest = e.target.checked; keep(); compute(); }
    if (e.target.dataset.routeMissing !== undefined) { F.routeMissing = e.target.checked; keep(); compute(); }
  });
  pan.addEventListener('submit', (e) => {
    if (e.target.id !== 'route-form') return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    say = '';
    startRoute({ course: graph().byId.get(v.course), stage: v.stage || null, professor: v.professor, term: v.term });
  });
  $('#map-info-open').addEventListener('click', () => $('#map-info').showModal());
  // Keys: «/» searches, Esc lets go, H hides what is selected.
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === '/') { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') { if (view.selection.size) view.select(null); else if (special) { special = null; compute(); } else if (route) endRoute(); }
    if ((e.key === 'h' || e.key === 'H' || e.key === 'Delete') && view.selection.size) selectionAct('hide');
  });
}

// Opens the map (and a node, or a route: «ruta/<course>/<evaluation>»).
export function openMap(arg = '') {
  if (!view) setup();
  const g = graph();
  const empty = !g.nodes.length;
  $('#map-empty').hidden = !empty;
  if (view.graph !== g) {
    // A graph built again keeps the route and the special view on the new nodes.
    if (route) route = route.course ? routeTo(g, { course: g.byId.get(route.course.id), stage: route.stage, professor: route.professor, term: route.term }) : routeTo(g, { to: [...route.nodes].map((n) => g.byId.get(n.id)).filter(Boolean) });
    if (special) special = null;
    view.setGraph(g);
    compute();
  } else compute();
  renderViews();
  renderDrawer();
  const [head, courseId, stage] = String(arg).split('/');
  if (head === 'ruta' && courseId) {
    const c = g.byId.get(decodeURIComponent(courseId));
    if (c) setTimeout(() => startRoute({ course: c, stage: stage ? decodeURIComponent(stage).replace(/-/g, ' ') : null }), 300);
    return;
  }
  const node = arg && g.byId.get(arg);
  if (node) setTimeout(() => view.select(node, { fly: true }), 300);
}
export function refreshMap() {
  if (!view) return;
  const g = graph();
  if (route) route = route.course ? routeTo(g, { course: g.byId.get(route.course.id), stage: route.stage, professor: route.professor, term: route.term }) : null;
  special = null;
  view.setGraph(g, { animate: false });
  compute();
}
