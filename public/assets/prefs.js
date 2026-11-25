// The person's own Studium: how they study, the ambience, sounds, theme, semester and career, their goals and how far
// they got in each guide, their courses and interests, and what they already know. Kept in this browser for an instant start, and in the account (profiles/{uid}, readable only
// by its owner) so that it follows the person to any device.
import { loadProfile, saveProfile } from './data.js';

export const MODES = {
  examenes: { name: 'Para exámenes', text: 'Tus pendientes y el enfoque primero; cuánto falta para tu próximo examen, con su guía a mano.' },
  gusto: { name: 'Por gusto', text: 'Sin cuentas regresivas: el grafo y las guías para explorar a tu ritmo.' },
  intensivo: { name: 'Intensivo', text: 'Temporizador de enfoque al frente, y lo justo alrededor.' },
  metas: { name: 'Paso a paso', text: 'Metas pequeñas, tu progreso a la vista y un sonido cada vez que cumples una.' },
};
export const AMBIENCES = {
  jugueton: { name: 'Juguetón', text: 'Un compañero de vidrio que flota, burbujas para reventar y objetos que puedes mover.' },
  vivo: { name: 'Vivo', text: 'Profundidad, hojas que flotan y objetos con física.' },
  sereno: { name: 'Sereno', text: 'Todo se mueve lento. Sin sonidos.' },
  enfoque: { name: 'Enfoque', text: 'Blanco y negro, nada que se mueva. Solo lo esencial.' },
};
export const THEMES = { auto: 'Como tu sistema', light: 'Día', dark: 'Noche' };

export const AVATARS = ['blue', 'red', 'teal', 'butter', 'sky', 'peach'];
const LANG = /^en\b/i.test(globalThis.navigator?.language ?? '') ? 'en' : 'es';
const DEFAULTS = { mode: 'examenes', ambience: 'vivo', sound: false, theme: 'auto', lang: LANG, avatar: 'blue', semester: 0, career: '', nickname: '', name: '', goals: [], progress: {},
  deadlines: [], todos: [], tiles: [], notes: '', links: [], focus: { study: 25, rest: 5 }, bubbles: false, courses: [], interests: [], known: [], malla: '', passed: [], plan: [], planner: {} };
// The tiles the home page can show (space.js draws them).
const TILE_IDS = ['shelf', 'decor', 'schedule', 'todos', 'countdown', 'deadlines', 'week', 'goals', 'timer', 'notes', 'links', 'recent', 'news', 'explore', 'grade'];
// The kinds of a dated event (Fechas y entregas, the month of «Mi horario»).
export const EVENT_KINDS = { examen: 'Examen', entrega: 'Entrega', presentacion: 'Presentación', reunion: 'Reunión', otro: 'Otro' };
const rid = () => Math.random().toString(36).slice(2, 10);
const range = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const KEYS = Object.keys(DEFAULTS);
const LOCAL = 'studium-prefs';
const root = document.documentElement;

const clean = (p) => {
  const out = {};
  for (const k of KEYS) if (p[k] !== undefined) out[k] = p[k];
  if (!(out.mode in MODES)) out.mode = DEFAULTS.mode;
  if (!(out.ambience in AMBIENCES)) out.ambience = DEFAULTS.ambience;
  if (!(out.theme in THEMES)) out.theme = DEFAULTS.theme;
  out.sound = !!out.sound;
  out.bubbles = !!out.bubbles;
  out.semester = Math.max(0, Math.min(20, Number(out.semester) || 0));
  out.career = String(out.career ?? '').slice(0, 80);
  out.nickname = String(out.nickname ?? '').slice(0, 40);
  out.name = String(out.name ?? '').trim().slice(0, 60);
  if (!['es', 'en'].includes(out.lang)) out.lang = LANG;
  if (!AVATARS.includes(out.avatar)) out.avatar = 'blue';
  out.goals = (Array.isArray(out.goals) ? out.goals : []).slice(0, 60)
    .map((g) => ({ id: String(g.id ?? Math.random().toString(36).slice(2, 10)).slice(0, 16), text: String(g.text ?? '').slice(0, 140), done: !!g.done, ...(g.guide ? { guide: String(g.guide).slice(0, 100) } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(g.due ?? '') ? { due: g.due } : {}) }))
    .filter((g) => g.text);
  out.deadlines = (Array.isArray(out.deadlines) ? out.deadlines : []).slice(0, 60)
    .map((d) => ({ id: String(d.id ?? rid()).slice(0, 16), text: String(d.text ?? '').slice(0, 100), date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '', ...(d.course ? { course: String(d.course).slice(0, 80) } : {}),
      ...(d.kind in EVENT_KINDS ? { kind: d.kind } : {}), ...(/^[A-Za-z0-9]{20}$/.test(d.guide ?? '') ? { guide: d.guide } : {}), ...(/^\d{2}:\d{2}$/.test(d.time ?? '') ? { time: d.time } : {}) }))
    .filter((d) => d.text && d.date);
  // «Pendientes»: a to-do, done or not, with an optional time (a day, or a day and an hour) and an optional class of
  // «Mi horario» (its id and its name, as it was when linked).
  out.todos = (Array.isArray(out.todos) ? out.todos : []).slice(0, 80)
    .map((t) => ({
      id: String(t.id ?? rid()).slice(0, 16), text: String(t.text ?? '').slice(0, 140), done: !!t.done,
      ...(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(t.due ?? '') ? { due: t.due } : {}),
      ...(/^[a-z0-9]{1,24}$/i.test(t.cls ?? '') ? { cls: t.cls, label: String(t.label ?? '').slice(0, 80) } : {}),
      // With an exact hour it may be placed in the week of «Mi horario», for its duration (minutes).
      ...(t.sched && /T\d{2}:\d{2}$/.test(t.due ?? '') ? { sched: true, dur: range(t.dur, 10, 480, 60) } : {}),
      // A pendiente may count toward a meta (its id).
      ...(/^[a-z0-9]{1,16}$/i.test(t.goal ?? '') ? { goal: t.goal } : {}),
    }))
    .filter((t) => t.text);
  const tiles = new Set();
  // A tile is "id@x.y.w.h", its place and size in the home page's grid (grid.js); the older "id" and "id:s" are
  // still read, and laid out again.
  out.tiles = (Array.isArray(out.tiles) ? out.tiles : []).map(String).filter((t) => {
    const m = t.match(/^([a-z]+)(?::[sl]|@\d{1,3}\.\d{1,3}\.\d{1,2}\.\d{1,2})?$/);
    if (!m || !TILE_IDS.includes(m[1]) || tiles.has(m[1])) return false;
    tiles.add(m[1]); return true;
  }).slice(0, 16);
  out.notes = String(out.notes ?? '').slice(0, 4000);
  out.links = (Array.isArray(out.links) ? out.links : []).slice(0, 12)
    .map((l) => ({ id: String(l.id ?? rid()).slice(0, 16), label: String(l.label ?? '').slice(0, 40), url: /^https?:\/\//i.test(l.url ?? '') ? String(l.url).slice(0, 300) : '' }))
    .filter((l) => l.label && l.url);
  out.focus = { study: range(out.focus?.study, 5, 90, 25), rest: range(out.focus?.rest, 1, 30, 5) };
  // The map: the person's courses this term (course keys), their interests and hobbies (areas, as «area:redes», or
  // courses, as «course:…»), and the concepts they marked as known (concept keys).
  const keys = (v, max, rx) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => rx.test(x)))].slice(0, max);
  out.courses = keys(out.courses, 40, /^[a-z0-9-]{1,90}$/);
  out.interests = keys(out.interests, 40, /^(area|course):[a-z0-9-]{1,90}$/);
  out.known = keys(out.known, 1500, /^[a-z0-9-]{1,120}$/);
  // «Mi malla»: the career's code on the university's page (1CMP) and the classes the person marked as passed.
  out.malla = /^[0-9A-Z]{2,8}$/.test(out.malla ?? '') ? out.malla : '';
  out.passed = keys(out.passed, 150, /^[A-Z]{2,9}( [0-9]{1,4}[A-Z]?)?$/);
  // What the person plans to take next semester, from «Mi malla» (up to 12 classes).
  out.plan = keys(out.plan, 12, /^[A-Z]{2,9}( [0-9]{1,4}[A-Z]?)?$/);
  // The planner (Preparar mi inscripción): what the CAPP says is in progress, the minors chosen, how much each course
  // matters to the person (0 no, 1 si cabe, 2 me gustaría, 3 imprescindible), their own say on professors (1 sí, -1
  // mejor no; never shown to anyone), and their comfort (most credits, earliest hour, fewer days or fewer gaps).
  const pl = out.planner && typeof out.planner === 'object' ? out.planner : {};
  const code = /^[A-Z]{2,9}( [0-9]{1,4}[A-Z]?)?$/;
  const entries = (o, max, k, v) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([a, b]) => k.test(a) && v(b)).slice(0, max));
  const cf = pl.comfort && typeof pl.comfort === 'object' ? pl.comfort : {};
  out.planner = {
    cursando: keys(pl.cursando, 40, code),
    minors: keys(pl.minors, 3, /^[a-z0-9-]{2,80}$/),
    prio: entries(pl.prio, 60, code, (b) => [0, 1, 2, 3].includes(b)),
    profs: entries(pl.profs, 120, /^[a-z0-9 ]{3,80}$/, (b) => b === 1 || b === -1),
    comfort: { max: range(cf.max, 6, 22, 16), start: range(cf.start, 420, 1050, 420), prefer: ['dias', 'huecos', ''].includes(cf.prefer) ? cf.prefer : '' },
  };
  // Untouched, it is not written: a profile without it is accepted by the rules of every published version.
  const p = out.planner;
  if (!p.cursando.length && !p.minors.length && !Object.keys(p.prio).length && !Object.keys(p.profs).length && p.comfort.max === 16 && p.comfort.start === 420 && !p.comfort.prefer) delete out.planner;
  out.progress = Object.fromEntries(Object.entries(out.progress && typeof out.progress === 'object' ? out.progress : {})
    .filter(([, v]) => v === 'reading' || v === 'done').slice(0, 300));
  return out;
};

let state = (() => {
  try { return clean({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(LOCAL) ?? '{}') }); } catch { return { ...DEFAULTS }; }
})();
let uid = null;
let fresh = false;
let timer = 0;
const listeners = new Set();

function apply() {
  root.dataset.ambience = state.ambience;
  root.lang = state.lang;
  root.style.setProperty('--me', `var(--${state.avatar})`);
  if (state.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = state.theme;
  try { localStorage.setItem(LOCAL, JSON.stringify(state)); } catch { /* the browser does not keep it */ }
}
apply();
// Another tab changed something (a note, a goal, the theme): this tab takes it, so its next save never writes back an
// older copy of the profile over it.
addEventListener('storage', (e) => {
  if (e.key !== LOCAL || !e.newValue) return;
  try { state = clean({ ...DEFAULTS, ...JSON.parse(e.newValue) }); } catch { return; }
  root.dataset.ambience = state.ambience; root.lang = state.lang;
  if (state.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = state.theme;
  for (const fn of listeners) fn(state, { loaded: true });
});

export const prefs = {
  get: () => state,
  // A new account: nothing saved yet, so the home page offers to set it up.
  get fresh() { return fresh; },
  set(patch) {
    state = clean({ ...state, ...patch });
    apply();
    for (const fn of listeners) fn(state, patch);
    if (uid) {
      clearTimeout(timer);
      timer = setTimeout(() => saveProfile(uid, state).then(() => { fresh = false; for (const fn of listeners) fn(state, { saved: true }); }).catch((e) => console.warn('profile not saved', e)), 700);
    }
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // After sign-in: the saved profile wins over this browser's; without one, this browser's is kept and saved later.
  async attach(id) {
    uid = id;
    if (!id) return;
    try {
      const saved = await loadProfile(id);
      fresh = !saved;
      if (saved) { state = clean({ ...DEFAULTS, ...saved }); apply(); for (const fn of listeners) fn(state, { loaded: true }); }
    } catch (e) { console.warn('profile not loaded', e); }
  },
  detach() { uid = null; fresh = false; },
};
