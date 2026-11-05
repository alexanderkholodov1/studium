// The person's own Studium: how they study, the ambience, sounds, theme, semester and career, their goals and how far
// they got in each guide. Kept in this browser for an instant start, and in the account (profiles/{uid}, readable only
// by its owner) so that it follows the person to any device.
import { loadProfile, saveProfile } from './data.js';

export const MODES = {
  examenes: { name: 'Para exámenes', text: 'Lo primero que ves es cuánto falta para tu próximo examen, con su guía a mano.' },
  gusto: { name: 'Por gusto', text: 'Sin cuentas regresivas: el mapa y las guías para explorar a tu ritmo.' },
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
  deadlines: [], tiles: [], notes: '', links: [], focus: { study: 25, rest: 5 }, bubbles: false };
// The tiles the home page can show (space.js draws them).
const TILE_IDS = ['countdown', 'deadlines', 'week', 'goals', 'timer', 'notes', 'links', 'recent', 'news', 'explore'];
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
    .map((g) => ({ id: String(g.id ?? Math.random().toString(36).slice(2, 10)).slice(0, 16), text: String(g.text ?? '').slice(0, 140), done: !!g.done, ...(g.guide ? { guide: String(g.guide).slice(0, 100) } : {}) }))
    .filter((g) => g.text);
  out.deadlines = (Array.isArray(out.deadlines) ? out.deadlines : []).slice(0, 60)
    .map((d) => ({ id: String(d.id ?? rid()).slice(0, 16), text: String(d.text ?? '').slice(0, 100), date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '', ...(d.course ? { course: String(d.course).slice(0, 80) } : {}) }))
    .filter((d) => d.text && d.date);
  const tiles = new Set();
  out.tiles = (Array.isArray(out.tiles) ? out.tiles : []).map(String).filter((t) => {
    const [id, size] = t.split(':');
    if (!TILE_IDS.includes(id) || (size && !['s', 'l'].includes(size)) || tiles.has(id)) return false;
    tiles.add(id); return true;
  }).slice(0, 16);
  out.notes = String(out.notes ?? '').slice(0, 4000);
  out.links = (Array.isArray(out.links) ? out.links : []).slice(0, 12)
    .map((l) => ({ id: String(l.id ?? rid()).slice(0, 16), label: String(l.label ?? '').slice(0, 40), url: /^https?:\/\//i.test(l.url ?? '') ? String(l.url).slice(0, 300) : '' }))
    .filter((l) => l.label && l.url);
  out.focus = { study: range(out.focus?.study, 5, 90, 25), rest: range(out.focus?.rest, 1, 30, 5) };
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
