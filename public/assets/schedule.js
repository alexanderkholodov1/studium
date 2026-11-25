// «Tu horario». Two things that are not the same:
// - «Mi horario»: the semester's week, the one that stays. Empty, it asks for one thing only: put your schedule, from
//   anything (a Banner screenshot, a photo, an Excel, a PDF, pasted text), and Studium transcribes it whole.
// - «Preparar mi inscripción»: a special mode, entered once a semester, with drafts to try classes before enrolling.
//   Its quickest way in is pasting USFQ's course offering (offer.js reads it; no AI needed).
// Adding a class checks what a student would want to know: the same course twice, exercises of another group, a
// clash, a section closed to them. Each asks once, with what can be done. The week is drawn by class blocks, as
// USFQ's day is lived, not by an hourly ruler. Private: schedules/{uid}, only its owner.
import { auth, loadSchedule, saveSchedule } from './data.js';
import * as ai from './ai.js';
import { sfx } from './sfx.js';
import { prefs, EVENT_KINDS } from './prefs.js';
import { parseOffer, termName, linked, codesOf } from './offer.js';
import { prereqNote, norm, sameTermPrereqs } from './malla.js';
import { dayStatus, classesThisWeek, weekOff, longDay, iso, TERMS, finalFor, examTable, keepOwnTable } from './calendario.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s, r = document) => r.querySelector(s);
const rid = () => Math.random().toString(36).slice(2, 10);

export const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// USFQ's blocks: one every hour and a half from 7:00; each class ends ten minutes before the next block begins.
export const BLOCKS = [420, 510, 600, 690, 780, 870, 960, 1050].map((s) => ({ s, e: s + 80 }));
const COLORS = ['blue', 'red', 'teal', 'butter', 'sky', 'peach'];
const MAX_OPTIONS = 6; const MAX_CLASSES = 40; const INCLUDED = 16;
const OFFER_URL = 'https://catalogodecursos.usfq.edu.ec/';
const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s) => { const m = String(s).trim().match(/^(\d{1,2})[:h.](\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const draftName = (n) => `Borrador ${n}`;

/* ---------- the model ---------- */
const blankDraft = (n = 1) => ({ id: rid(), name: draftName(n), classes: [] });
const blank = () => ({ mine: { id: 'mine', name: 'Mi horario', classes: [] }, options: [blankDraft()], active: 0, term: '' });
// A slot written as whole blocks (7:00–8:30) is kept with its real end (8:20). Any other hours are kept as they are.
export function realEnd(s, e) {
  const startsBlock = BLOCKS.some((b) => b.s === s);
  const endsOnBlockStart = BLOCKS.some((b) => b.s === e) || e === 1140;
  return startsBlock && endsOnBlockStart && e - s >= 90 ? e - 10 : e;
}
const text = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
function cleanClass(c, i) {
  const slots = (Array.isArray(c.slots) ? c.slots : []).map((x) => {
    const d = Number.isInteger(x.d) ? x.d : DAYS.findIndex((n) => n.toLowerCase().startsWith(String(x.day ?? '').toLowerCase().slice(0, 2)));
    const s = typeof x.s === 'number' ? x.s : toMin(x.start); const e0 = typeof x.e === 'number' ? x.e : toMin(x.end);
    if (!(d >= 0 && d < 6) || !Number.isFinite(s) || !Number.isFinite(e0) || e0 <= s) return null;
    return { d, s, e: realEnd(s, e0) };
  }).filter(Boolean).slice(0, 12);
  return {
    // An id lands in attributes: only the page's own shape is kept (a schedule can come from what an AI read).
    id: /^[a-z0-9]{1,24}$/i.test(String(c.id ?? '')) ? c.id : rid(), name: text(c.name, 80) || 'Clase', code: text(c.code, 20), nrc: text(c.nrc, 12), prof: text(c.prof, 80), room: text(c.room, 20),
    kind: text(c.kind, 20), group: text(c.group, 30), section: text(c.section, 6),
    credits: Math.max(0, Math.min(10, Number(c.credits) || 0)), color: COLORS.includes(c.color) ? c.color : COLORS[i % COLORS.length], slots,
  };
}
const cleanList = (o, i, fallback) => ({ id: /^[a-z0-9]{1,24}$/i.test(String(o?.id ?? '')) ? o.id : rid(), name: text(o?.name, 24) || (fallback ?? draftName(i + 1)), classes: (Array.isArray(o?.classes) ? o.classes : []).slice(0, MAX_CLASSES).map(cleanClass) });
export function clean(raw) {
  const options = (Array.isArray(raw?.options) ? raw.options : []).slice(0, MAX_OPTIONS).map((o, i) => cleanList(o, i));
  return {
    mine: { ...cleanList(raw?.mine ?? {}, 0, 'Mi horario'), id: 'mine' },
    options: options.length ? options : [blankDraft()],
    active: Math.max(0, Math.min(Math.max(0, options.length - 1), Number(raw?.active) || 0)),
    term: /^\d{6}$/.test(raw?.term ?? '') ? raw.term : '',
  };
}
export function conflicts(classes) {
  const out = [];
  const all = classes.flatMap((c) => c.slots.map((s) => ({ c, ...s })));
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i]; const b = all[j];
      if (a.c === b.c || a.d !== b.d) continue;
      const s = Math.max(a.s, b.s); const e = Math.min(a.e, b.e);
      if (s < e) out.push({ d: a.d, s, e, a: a.c, b: b.c });
    }
  }
  return out;
}
const meets = (a, b) => a.slots.some((x) => b.slots.some((y) => x.d === y.d && Math.max(x.s, y.s) < Math.min(x.e, y.e)));
// Classes that meet on a day share its width: each gets a lane, so both stay visible where they clash.
export function lanes(classes, d) {
  const items = classes.flatMap((c) => c.slots.filter((s) => s.d === d).map((s) => ({ c, s }))).sort((a, b) => a.s.s - b.s.s || b.s.e - a.s.e);
  const out = []; let group = []; let groupEnd = -1;
  const close = () => { const n = Math.max(1, ...group.map((g) => g.lane + 1)); for (const g of group) g.of = n; out.push(...group); group = []; };
  for (const it of items) {
    if (it.s.s >= groupEnd && group.length) close();
    const used = new Set(group.filter((g) => g.s.e > it.s.s).map((g) => g.lane));
    let lane = 0; while (used.has(lane)) lane += 1;
    group.push({ ...it, lane, of: 1 }); groupEnd = Math.max(groupEnd, it.s.e);
  }
  if (group.length) close();
  return out;
}
export const credits = (classes) => classes.reduce((n, c) => n + (c.credits || 0), 0);
const isTheory = (c) => !c.kind || /^teor/i.test(c.kind);
const label = (c) => (isTheory(c) ? c.name : `${c.name} · ${c.kind}`);
const shortLabel = (c) => `${c.code || c.name.split(/\s+/)[0]}${isTheory(c) ? '' : ` ${c.kind.slice(0, 3)}`}`;
// Two classes with the same name told apart: their section, or their NRC.
const which = (c) => `${label(c)}${c.section ? ` (paralelo ${c.section})` : c.nrc ? ` (NRC ${c.nrc})` : ''}`;
// The same part of the same course: two theories of Cálculo Integral, or two of its exercises.
const samePart = (a, b) => a.code && a.code === b.code && isTheory(a) === isTheory(b) && (isTheory(a) || a.kind === b.kind);
// A course with exercises or a lab («+ Ej», «+ Lab», or a group) that has only one of its parts in this list.
function missingPart(c, list) {
  if (!c.code) return '';
  const others = list.filter((x) => x !== c && x.code === c.code && !samePart(x, c));
  // With the group's codes: each code is a part it needs (a theory «Z3 Z4» needs its lab and its exercises).
  const open = codesOf(c).filter((k) => !others.some((x) => codesOf(x).includes(k)));
  if (others.length && open.length && isTheory(c) && codesOf(c).length > 1 && /lab/i.test(c.name) && /ej/i.test(c.name)) return `Le falta un NRC de su grupo (${open.join(', ')}): su ${others.some((x) => /lab/i.test(x.kind)) ? 'ejercicio' : /ej/i.test(others.map((x) => x.kind).join(' ')) ? 'laboratorio' : 'ejercicio o laboratorio'}.`;
  if (others.length || !(/\+\s*(ej|lab)/i.test(c.name) || c.group)) return '';
  return isTheory(c) ? 'Le falta su NRC de ejercicios o laboratorio.' : 'Le falta su NRC de teoría.';
}

/* ---------- kept: in the account, or on this device until the rules reach the database ---------- */
// The copy on this device belongs to one account: on a shared computer nobody sees another person's schedule.
const localKey = () => `studium-schedule:${auth.currentUser?.uid ?? 'anon'}`;
try { localStorage.removeItem('studium-schedule'); } catch { /* the old shared copy, gone */ }
let state = blank();
let where = 'account';
async function load() {
  const uid = auth.currentUser?.uid;
  try { const doc = uid ? await loadSchedule(uid) : null; state = clean(doc ?? {}); where = 'account'; } catch {
    state = clean(local() ?? {}); where = 'device';
  }
}
function local() { try { return JSON.parse(localStorage.getItem(localKey()) ?? 'null'); } catch { return null; } }
let saveTimer = 0;
function save() {
  try { localStorage.setItem(localKey(), JSON.stringify(state)); } catch { /* the account keeps it */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!auth.currentUser?.uid) return;
    try { await saveSchedule(auth.currentUser.uid, state); if (where !== 'account') { where = 'account'; paintWhere(); } } catch { if (where !== 'device') { where = 'device'; paintWhere(); } }
  }, 700);
}

/* ---------- what the page shows ---------- */
let root = null;
let loadedFor = null;
let mode = 'mine'; // 'mine', or 'prep' while preparing enrollment
let catalog = []; // the sections of the last paste with several, to choose from
let asks = []; // what adding a class asks, one at a time: { kind, cls, ... }
let clashOpen = false;
let note = ''; // one line after an action
const view = () => (mode === 'mine' ? state.mine : state.options[state.active]);

// Drawn once per account: the route may call this again while the rest of the app loads, and redrawing then would lose
// a click in progress.
let nextMode = null; // asked from the home: open straight into preparing enrollment
let stale = false; // changed from the home since the page was drawn
export async function renderSchedule() {
  root = $('#horario');
  const uid = auth.currentUser?.uid ?? null;
  if (loadedFor === uid && root.childElementCount && !stale && !nextMode) return;
  if (!root.childElementCount) root.innerHTML = '<p class="status">Cargando tu horario…</p>';
  if (loadedFor !== uid) { await load(); loadedFor = uid; }
  mode = nextMode ?? (loadedFor === uid && root.dataset.mode ? root.dataset.mode : 'mine');
  nextMode = null; stale = false;
  paint();
}
// From anywhere (Mi malla): open «Mi horario» straight into preparing enrollment.
export function prepareEnrollment() { nextMode = 'prep'; location.hash = '#/horario'; }
// The classes of «Mi horario», for a to-do to be linked to one: id, name, and its first day and hour.
export async function myClasses() {
  const uid = auth.currentUser?.uid ?? null;
  if (loadedFor !== uid) { await load(); loadedFor = uid; }
  return state.mine.classes.map((c) => ({ id: c.id, name: c.name, when: c.slots[0] ? `${DAYS[c.slots[0].d]?.slice(0, 3) ?? ''} ${hhmm(c.slots[0].s)}` : '' }));
}
// «Mi horario» in the home page: the week, or one card to put it. Editing happens in its page.
let homeEl = null;
export async function renderHomeSchedule(el) {
  homeEl = el;
  if (!el) return;
  const uid = auth.currentUser?.uid ?? null;
  if (loadedFor !== uid) { await load(); loadedFor = uid; }
  paintHome();
}
// Today, in a narrow tile: each class of the day by its time; the one on now stands out, the ones gone fade.
function todayList(o) {
  const t = today();
  const list = o.classes.flatMap((c) => c.slots.filter((s) => s.d === t.d).map((s) => ({ c, s }))).sort((a, b) => a.s.s - b.s.s);
  const next = list.find(({ s }) => s.s > t.m);
  const day = DAYS[t.d] ?? 'Domingo';
  if (!list.length) return `<p class="hs-free">${day}: sin clases. ${t.d >= 5 ? 'Disfruta el fin de semana.' : 'Un buen día para adelantar.'}</p>`;
  return `<ol class="hs-today">${list.map(({ c, s }) => {
    const now = s.s <= t.m && t.m < s.e; const past = s.e <= t.m;
    return `<li class="${now ? 'now' : past ? 'past' : ''}" style="--c:var(--${c.color})"><time>${hhmm(s.s)}<small>${hhmm(s.e)}</small></time>
      <span>${now ? '<em>Ahora</em>' : next && next.s === s ? '<em>Sigue</em>' : ''}<b>${esc(label(c))}</b><small>${esc([c.room, c.prof].filter(Boolean).join(' · '))}</small></span></li>`;
  }).join('')}</ol>`;
}
// What the schedule says when the week has no classes: a holiday week, the finals, the end of the semester.
function noClassesNote() {
  const st = dayStatus();
  const t = TERMS[0];
  if (st.kind === 'finals') return `<p class="hs-term"><b>Semana de exámenes finales</b>: del ${esc(longDay(st.term.finals[0]))} al ${esc(longDay(st.term.finals[1]))}. Las clases terminaron el ${esc(longDay(st.term.classes[1]))}. <a href="#/horario">Tus exámenes, en el calendario</a></p>`;
  if (st.kind === 'after') return `<p class="hs-term"><b>El semestre terminó.</b> Las clases terminaron el ${esc(longDay(st.term.classes[1]))}.</p>`;
  if (st.kind === 'off') return `<p class="hs-term"><b>${esc(st.name)}</b>: no hay clases hasta después del ${esc(longDay(st.until))}.</p>`;
  if (st.kind === 'none' && st.next) return `<p class="hs-term">Las clases empiezan el ${esc(longDay(st.next.classes[0]))}.</p>`;
  return t ? '' : '';
}
function paintHome() {
  if (!homeEl) return;
  const o = state.mine;
  homeEl.classList.add('sched');
  const wide = homeEl.clientWidth >= 640;
  const live = classesThisWeek();
  homeEl.innerHTML = o.classes.length ? (wide ? `
    <div class="hs-head"><h2>Mi horario</h2><span class="muted">${credits(o.classes)} de ${INCLUDED} créditos${state.term ? ` · ${esc(termName(state.term))}` : ''}</span>
      <div class="hs-actions"><a class="button ghost small" href="#/malla">Mi malla</a><a class="button ghost small" href="#/horario">Editar</a><button class="sched-special small" data-hs-prep>Preparar mi inscripción</button></div></div>
    ${live ? '' : noClassesNote()}${week(o, true)}` : `
    <div class="hs-head"><h2>Hoy</h2><a class="link" href="#/horario">La semana</a></div>
    ${dayStatus().kind === 'classes' ? todayList(o) : noClassesNote()}`)
    : `<div class="hs-empty glass">
      <span class="sg-icon c-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg></span>
      <div><h2>Tu horario, aquí</h2><p>Una captura de Banner, una foto o tu Excel: lo subes una vez y cada día ves qué clase sigue.</p></div>
      <div class="hs-actions"><button class="button primary" data-hs-upload>Subir mi horario</button><button class="link" data-hs-prep>o arma tu inscripción</button></div>
    </div>`;
  fitWeek();
}
// The week fills the tile it was given (his words: the whole schedule, using the space it needs): the height of a
// block follows the tile's height, so a taller tile shows bigger blocks and a shorter one still shows every block.
function fitWeek() {
  const sheet = homeEl?.querySelector('.sched-sheet.compact');
  if (!sheet) return;
  const tileBody = homeEl.closest('.tile-body') ?? homeEl;
  const rows = Number(getComputedStyle(sheet).getPropertyValue('--rows')) || BLOCKS.length;
  const head = sheet.querySelector('.sched-head')?.offsetHeight ?? 30;
  const used = sheet.getBoundingClientRect().top - tileBody.getBoundingClientRect().top;
  const free = tileBody.clientHeight - used - head - 24;
  sheet.style.setProperty('--rowh', `${Math.max(22, Math.min(64, Math.floor(free / rows)))}px`);
}
// Whatever changed, both places show it.
function refresh() {
  if (root?.isConnected && !$('#view-horario').hidden) paint(); else stale = true;
  paintHome();
}
function paintWhere() {
  const el = $('#sched-where', root);
  if (el) el.textContent = where === 'device' ? 'Por ahora se guarda en este dispositivo.' : 'Se guarda en tu cuenta. Solo tú lo ves.';
}

// The week by class blocks: each row is a block (7:00–8:20, 8:30–9:50…), the way the day is lived at USFQ. A time
// inside a block falls where it is in it; the ten minutes between blocks fold into the line between rows.
function rowOf(t) {
  for (let i = 0; i < BLOCKS.length; i += 1) {
    const b = BLOCKS[i];
    if (t < b.s) return i;
    if (t <= b.e) return i + (t - b.s) / 80;
  }
  return BLOCKS.length + Math.max(0, t - BLOCKS.at(-1).e - 10) / 90;
}
// «Ahora»: the column of today (Monday is 0), and the minute of the day.
const today = () => { const d = new Date(); return { d: (d.getDay() + 6) % 7, m: d.getHours() * 60 + d.getMinutes() }; };
const nowLine = (rows) => { const t = today(); const r = rowOf(t.m); return r <= 0 || r >= rows ? '' : `<div class="sched-now" style="--top:${r}" aria-hidden="true"><span>${hhmm(t.m)}</span></div>`; };
// Every minute the line moves and the class in progress changes, without drawing the week again.
setInterval(() => {
  const t = today();
  if (homeEl?.isConnected && homeEl.querySelector('.hs-today, .hs-free')) paintHome();
  for (const sheet of document.querySelectorAll('.sched-sheet')) {
    const rows = Number(getComputedStyle(sheet).getPropertyValue('--rows')) || BLOCKS.length;
    for (const day of sheet.querySelectorAll('.sched-day')) {
      const isToday = Number(day.dataset.day) === t.d;
      day.classList.toggle('today', isToday);
      day.querySelector('.sched-now')?.remove();
      if (isToday) day.insertAdjacentHTML('afterbegin', nowLine(rows));
      for (const b of day.querySelectorAll('.sched-class[data-span]')) { const [s, e] = b.dataset.span.split('-').map(Number); b.classList.toggle('now', isToday && s <= t.m && t.m < e); }
    }
  }
}, 60_000);
// The pendientes with an exact hour that the person put in «Mi horario», for this week (Monday first).
function weekTodos() {
  const now = new Date();
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 7);
  return prefs.get().todos.filter((x) => x.sched && x.due?.length > 10).map((x) => {
    const at = new Date(x.due);
    if (at < monday || at >= sunday) return null;
    const s = at.getHours() * 60 + at.getMinutes();
    return { id: x.id, d: (at.getDay() + 6) % 7, s, e: Math.min(s + (x.dur || 60), 23 * 60), text: x.text, done: x.done };
  }).filter((x) => x && x.d < 6);
}
// Why a day of a week with classes has none: a holiday's name, the end of classes, the finals.
const offName = (k) => ({ after: 'Terminaron las clases', finals: 'Exámenes finales', none: 'Sin clases' })[k] ?? k;
function week(o, compact = false) {
  const t = today();
  const todos = weekTodos();
  const off = weekOff();
  // After the last day of classes (or before the first), the week shows no classes: only what the person put in it.
  const live = classesThisWeek();
  o = live ? o : { ...o, classes: [] };
  const clash = conflicts(o.classes);
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) || todos.some((x) => x.d === 5) ? 6 : 5;
  const late = Math.max(0, ...o.classes.flatMap((c) => c.slots.map((s) => Math.ceil(rowOf(s.e)) - BLOCKS.length)), ...todos.map((x) => Math.ceil(rowOf(x.e)) - BLOCKS.length));
  const rows = BLOCKS.length + late;
  const inClash = (c, d, s) => clash.some((x) => x.d === d && x.s < s.e && x.e > s.s && (x.a === c || x.b === c));
  return `<div class="sched-sheet${compact ? ' compact' : ''}" style="--days:${days};--rows:${rows}">
    <div class="sched-head"><span></span>${DAYS.slice(0, days).map((d, i) => `<b class="${i === t.d ? 'today' : ''}"><span class="long">${d}</span><span class="short">${SHORT[i]}</span></b>`).join('')}</div>
    <div class="sched-grid">
      <div class="sched-hours">${Array.from({ length: rows }, (_, i) => { const b = BLOCKS[i]; return `<span style="--r:${i}">${b ? `<b>${hhmm(b.s)}</b><small>${hhmm(b.e)}</small>` : ''}</span>`; }).join('')}</div>
      ${DAYS.slice(0, days).map((_, d) => `<div class="sched-day${d === t.d ? ' today' : ''}${off[d] && live ? ' off' : ''}" data-day="${d}">${d === t.d ? nowLine(rows) : ''}
        ${off[d] && live ? `<span class="sched-off" title="${esc(offName(off[d]))}">${esc(offName(off[d]))}</span>` : ''}
        ${todos.filter((x) => x.d === d).map((x) => `<a class="sched-todo${x.done ? ' done' : ''}" href="#/" title="Pendiente: ${esc(x.text)} · ${hhmm(x.s)}–${hhmm(x.e)}" style="--top:${rowOf(x.s)};--bottom:${rowOf(x.e)}"><b>${esc(x.text)}</b><small>${hhmm(x.s)}</small></a>`).join('')}
        ${(off[d] && live ? [] : lanes(o.classes, d)).map(({ c, s, lane, of }) => `<button class="sched-class c-${c.color}${inClash(c, d, s) ? ' clashing' : ''}${of > 1 ? ' narrow' : ''}${d === t.d && s.s <= t.m && t.m < s.e ? ' now' : ''}" data-span="${s.s}-${s.e}" draggable="${mode === 'prep'}" data-drag="${c.id}" data-edit="${c.id}"
          style="--top:${rowOf(s.s)};--bottom:${rowOf(s.e)};--lane:${lane};--of:${of}" title="${esc(which(c))}${c.nrc ? ` · NRC ${esc(c.nrc)}` : ''} · ${hhmm(s.s)}–${hhmm(s.e)}">
          <b>${esc(label(c))}</b><i class="code">${esc(shortLabel(c))}</i><small>${c.room ? esc(c.room) : `${hhmm(s.s)}–${hhmm(s.e)}`}</small></button>`).join('')}
      </div>`).join('')}
    </div></div>`;
}
function side(o) {
  const clash = conflicts(o.classes);
  const pairs = [...new Map(clash.map((x) => [[x.a.id, x.b.id].sort().join(), x])).values()];
  const total = credits(o.classes);
  return `<aside class="sched-side">
    <div class="sched-total"><span class="big">${total}</span><span class="of">de ${INCLUDED} créditos</span>
      <span class="bar" aria-hidden="true"><i style="width:${Math.min(100, (total / INCLUDED) * 100)}%"></i></span></div>
    ${pairs.length ? `<div class="sched-clashes${clashOpen ? ' open' : ''}"><button class="sched-clash-chip" data-clash-toggle aria-expanded="${clashOpen}">${pairs.length === 1 ? '1 cruce' : `${pairs.length} cruces`}</button>
      ${clashOpen ? `<ul>${pairs.map((x) => `<li>${esc(which(x.a))} <span>×</span> ${esc(which(x.b))} <small>${SHORT[x.d]} ${hhmm(x.s)}</small></li>`).join('')}</ul>` : ''}</div>` : ''}
    <ol class="sched-list">${o.classes.map((c) => {
      const miss = missingPart(c, o.classes);
      return `<li class="c-${c.color}"><button class="item" draggable="${mode === 'prep'}" data-drag="${c.id}" data-edit="${c.id}"><i></i><span><b>${esc(label(c))}</b><small>${[c.section && `paralelo ${esc(c.section)}`, c.nrc && `NRC ${esc(c.nrc)}`, c.prof && esc(c.prof)].filter(Boolean).join(' · ')}</small>${miss ? `<em class="miss">${miss}</em>` : ''}</span><strong>${c.credits || '–'}</strong></button>
        <button class="remove" data-remove="${c.id}" aria-label="Quitar ${esc(label(c))}" title="Quitar">×</button></li>`;
    }).join('')}</ol>
    ${mode === 'prep' && o.classes.length ? '<p class="muted small">En Banner, «Pendiente» aún no es inscrito: pulsa <b>Enviar</b>. <a href="#/guia-estudiante/errores">Si Banner no te deja</a> · <a href="#/guia-estudiante/cupos">Si no hay cupo</a></p>' : ''}
    <p class="muted small" id="sched-where"></p>
  </aside>`;
}

// «Pon tu horario»: one box for anything. Used in the empty «Mi horario», and to bring a schedule into a draft.
function transcribeBox(target) {
  const ready = ai.ready();
  return `<div class="sched-transcribe" data-transcribe="${target}">
    <label class="sched-drop" data-drop-zone>
      <input type="file" accept="image/*,.pdf,.xlsx,.csv,.txt,.tsv" multiple data-files hidden>
      <span class="sg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg></span>
      <b>Sube tu horario</b><small>Una captura de Banner, una foto, tu Excel o un PDF</small>
      <span class="files" data-file-names></span>
    </label>
    <textarea data-text rows="3" placeholder="…o pega aquí el texto de tu horario"></textarea>
    <div class="actions"><button class="button primary" data-read>Leer mi horario</button></div>
    ${ready ? `${ai.pickerHTML('schedule')}${ai.promptHTML(SYSTEM, '', 'más tu captura, tu archivo o el texto que pegaste')}` : `<p class="sched-ai-note">Para leer capturas y archivos, Studium usa tu propia IA (con Gemini es gratis): <a href="#/ajustes">conéctala en Ajustes</a>, o <button class="link" data-chat-open>hazlo con cualquier chat</button>.</p>`}
    <div class="sched-chat" data-chat hidden>
      <ol><li><button class="link" data-copy>Copia estas instrucciones</button> y llévalas a cualquier chat (Claude, ChatGPT, Gemini…) junto con tu captura o archivo.</li>
        <li>Pega aquí lo que te responda:</li></ol>
      <textarea data-answer rows="3" placeholder='{"options": …}'></textarea>
    </div>
    <p class="msg" data-msg role="status"></p>
    <div class="sched-found" data-preview></div>
  </div>`;
}
function pastePanel() {
  return `<div class="sched-paste glass">
    <h3>Agregar clases a ${esc(view().name)}</h3>
    <textarea data-paste rows="2" aria-label="Pega lo que copiaste de la Oferta de cursos" placeholder="Pega aquí lo que copiaste de la Oferta de cursos: una clase o toda la búsqueda"></textarea>
    <button class="button primary" data-paste-add>Agregar</button>
    <p class="sched-ways"><a class="link" href="${OFFER_URL}" target="_blank" rel="noopener">Abrir la Oferta de cursos ↗</a> · <button class="link" data-add>agregar a mano</button> · <button class="link" data-import>desde una captura o un archivo</button></p>
    ${note ? `<p class="sched-note">${note}</p>` : ''}
  </div>`;
}
function pickerPanel() {
  if (!catalog.length) return '';
  const o = view();
  const kinds = [...new Set(catalog.map((s) => s.kind || 'Clase'))];
  const chosen = new Set(o.classes.map((c) => c.nrc));
  const ours = (s) => !!s.group && o.classes.some((c) => c.nrc !== s.nrc && c.code === s.code && (c.kind || '') !== (s.kind || '') && linked(c, s));
  const row = (s) => {
    const cls = cleanClass(s, 0);
    const mine = chosen.has(s.nrc);
    const partner = !mine && ours(s);
    const clashes = !mine && o.classes.some((c) => c.nrc !== s.nrc && !samePart(c, cls) && meets(c, cls));
    return `<li><button class="sched-pick${mine ? ' on' : ''}${partner ? ' partner' : ''}" data-pick="${esc(s.nrc)}" ${mine ? 'disabled' : ''}>
      <b>Paralelo ${esc(s.section)} <small>NRC ${esc(s.nrc)}</small></b>
      <span>${cls.slots.map((x) => `${SHORT[x.d]} ${hhmm(x.s)}–${hhmm(x.e)}`).join(' · ')}</span>
      <small>${[s.prof, s.room].filter(Boolean).map(esc).join(' · ')}</small>
      ${mine ? '<em class="tag">en tu borrador</em>' : partner ? '<em class="tag">de tu grupo</em>' : clashes ? '<em class="tag red">choca</em>' : ''}${s.excluded?.length ? '<em class="tag amber">restringido</em>' : ''}</button></li>`;
  };
  return `<div class="sched-picker glass">
    <div class="sched-picker-head"><h3>${esc(catalog[0].code)} · ${esc(catalog[0].name)}${state.term ? ` <small>${esc(termName(state.term))}</small>` : ''}</h3><button class="link" data-picker-close>Cerrar</button></div>
    <p class="muted small">Elige un paralelo. Los ejercicios o el laboratorio que van con tu teoría aparecen «de tu grupo».</p>
    <div class="sched-picker-cols">${kinds.map((k) => `<section><h4>${esc(k)}</h4><ol>${catalog.filter((s) => (s.kind || 'Clase') === k).sort((a, b) => (ours(b) ? 1 : 0) - (ours(a) ? 1 : 0)).map(row).join('')}</ol></section>`).join('')}</div>
  </div>`;
}
// What adding a class asks: the first of the queue, with what can be done.
function askCard() {
  const a = asks[0];
  if (!a) return '';
  const body = ({
    dup: () => `Ya tienes <b>${esc(which(a.old))}</b> en este borrador. ¿Cambiarla por <b>${esc(which(a.cls))}</b>?`,
    group: () => `<b>${esc(which(a.cls))}</b> es de otro grupo que tu ${isTheory(a.cls) ? 'ejercicio o laboratorio' : 'teoría'} <b>${esc(which(a.other))}</b>: no van juntos y no te dejarán inscribirte así.`,
    clash: () => `<b>${esc(which(a.cls))}</b> choca con ${a.with.map((c) => `<b>${esc(which(c))}</b>`).join(', ')}.`,
    prereq: () => `Según tu malla, <b>${esc(which(a.cls))}</b> pide ${esc(a.needs)}, y no lo tienes marcado como aprobado. Si ya lo aprobaste o lo estás cursando, puedes dejarla.`,
    together: () => `<b>${esc(which(a.needer))}</b> pide ${esc(a.needs)}, y está en este mismo borrador. No se pueden tomar en el mismo semestre: Banner rechaza <b>${esc(which(a.needer))}</b> («Requiere Curso Prerrequisito»). Busca otra materia para ese espacio.`,
    excluded: () => `<b>${esc(which(a.cls))}</b> no está abierta para: ${a.excluded.map(esc).join('; ')}.${a.applies ? ' Según tu perfil, eso te incluye.' : ''}`,
  })[a.kind]();
  const actions = {
    dup: '<button class="button primary" data-ask="replace">Cambiarla</button><button class="button ghost" data-ask="draft">Llevarla a un borrador nuevo</button><button class="link" data-ask="cancel">Cancelar</button>',
    group: '<button class="button primary" data-ask="cancel">No agregarla</button><button class="button ghost" data-ask="add">Agregarla igual</button>',
    clash: '<button class="button ghost" data-ask="keep">Dejar el choque</button><button class="button primary" data-ask="draft">Llevarla a un borrador nuevo</button><button class="link" data-ask="remove">Quitarla</button>',
    excluded: '<button class="button ghost" data-ask="keep">Entendido</button><button class="link" data-ask="remove">Quitarla</button>',
    together: '<button class="button primary" data-ask="remove">Quitar la que acabo de agregar</button><button class="link" data-ask="keep">Dejarla igual</button>',
    prereq: '<button class="button primary" data-ask="keep">Dejarla</button><a class="button ghost" href="#/malla">Ver Mi malla</a><button class="link" data-ask="remove">Quitarla</button>',
  }[a.kind];
  const tone = a.kind === 'clash' || a.kind === 'group' || a.kind === 'together' ? 'red' : 'amber';
  return `<div class="sched-ask ${tone}" role="alertdialog" aria-live="assertive">
    <span class="sched-ask-icon" aria-hidden="true">!</span><p>${body}</p><div class="actions">${actions}</div></div>`;
}

// The page opens on the week: one thin bar above it (where you are, what you can do), everything else below it or
// floating, so the whole week is in sight without scrolling.
const PREP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M12 13v4M10 15h4"/></svg>';
function paint() {
  if (!root) return;
  const o = view();
  const has = o.classes.length > 0;
  root.dataset.mode = mode;
  root.innerHTML = mode === 'mine' ? `
  <div class="sched-toolbar">
    <div class="sched-where"><a class="back" href="#/">← Inicio</a><h1 class="sched-title">Mi horario</h1>${has ? `<span class="muted">${credits(o.classes)} de ${INCLUDED} créditos${state.term ? ` · ${esc(termName(state.term))}` : ''}</span>` : ''}</div>
    <div class="sched-actions">
      <button class="sched-special small" data-mode="prep">${PREP_ICON}Preparar mi inscripción</button>
      ${has ? `<details class="sched-more"><summary class="button ghost small">Opciones</summary><div class="menu glass">
        <button data-add>Agregar una clase</button><button data-retranscribe>Volver a subir mi horario</button>
        <button data-xlsx>Descargar Excel</button><button data-png>Descargar imagen</button>
        <a href="#/malla">Mi malla</a><a href="#/guia-estudiante">Guía del estudiante</a>
        <button data-mine-clear class="danger">Vaciar mi horario</button></div></details>` : ''}
    </div>
  </div>
  ${has ? `${classesThisWeek() ? '' : noClassesNote()}<div class="sched-body">${week(o)}${side(o)}</div>${finalsHTML()}`
    : `<div class="sched-empty glass"><h2>Pon tu horario</h2><p>Studium lo pasa completo a tu semana, por bloques de clase.</p>${transcribeBox('mine')}</div>`}
  ${monthHTML()}`
  : `
  <div class="sched-toolbar prep">
    <div class="sched-where"><span class="sched-mode-pill">${PREP_ICON}Preparando tu inscripción</span>
      <div class="sched-options" role="tablist" aria-label="Borradores">
        ${state.options.map((x, i) => `<button role="tab" class="sched-opt" aria-selected="${i === state.active}" data-opt="${i}" data-drop="${i}">${esc(x.name)}<small>${credits(x.classes)} cr</small></button>`).join('')}
        ${state.options.length < MAX_OPTIONS ? '<button class="sched-opt add" data-opt-add title="Otro borrador" aria-label="Otro borrador">+</button>' : ''}
      </div></div>
    <div class="sched-actions">
      ${has ? '<button class="button primary small" data-use-mine>Usar como mi horario</button>' : ''}
      <details class="sched-more"><summary class="button ghost small" aria-label="Más opciones">···</summary><div class="menu glass">
        <button data-rename>Cambiar el nombre</button><button data-dup>Duplicar este borrador</button>
        ${has ? '<button data-xlsx>Descargar Excel</button><button data-png>Descargar imagen</button>' : ''}
        <a href="#/guia-estudiante">Guía del estudiante</a>
        ${state.options.length > 1 ? '<button data-opt-remove class="danger">Quitar este borrador</button>' : ''}
      </div></details>
      <button class="button ghost small" data-mode="mine">Volver a mi horario</button>
    </div>
  </div>
  <div class="sched-body">${week(o)}${side(o)}</div>
  ${pastePanel()}${pickerPanel()}${askCard()}`;
  paintWhere();
  const box = $('.sched-empty [data-transcribe]', root);
  if (box) mountTranscribe(box);
}

/* ---------- final exams, computed from the official table ---------- */
// His words: depending on the course, Studium helps to work out when each final is. USFQ assigns it by the days and
// the hour of the class (calendario.js); departmental exams by course; any other schedule is coordinated with the
// professor. Not every course follows the table (his words, 2026-11-23), so these are SUGGESTIONS: the person adds
// the ones that apply with a tap, and only then are they exams of their calendar and of «Tu próximo examen».
const termNow = () => TERMS.find((t) => iso(new Date()) <= t.end) ?? null;
export function myFinals() {
  const term = termNow();
  if (!term || loadedFor === null) return [];
  const own = prefs.get().deadlines.filter((d) => d.kind === 'examen');
  return state.mine.classes.map((c) => ({ c, f: finalFor(c, term) })).filter((x) => x.f)
    .map((x) => ({ ...x, added: own.some((d) => d.course && norm(d.course) === norm(x.c.name) && d.date >= term.finals[0] && d.date <= term.finals[1]) }));
}
// A suggested final, added as an exam of the person's own (Fechas y entregas), which they can change or remove.
export function addFinal(classId) {
  const x = myFinals().find((y) => y.c.id === classId && y.f.date && !y.added);
  if (!x) return false;
  prefs.set({ deadlines: [...prefs.get().deadlines, { id: rid(), kind: 'examen', text: `Final de ${x.c.name}`.slice(0, 100), date: x.f.date, time: x.f.from, course: x.c.name.slice(0, 80) }] });
  return true;
}
function finalsHTML() {
  const term = termNow();
  if (!term || !state.mine.classes.length || iso(new Date()) > term.finals[1]) return '';
  const table = examTable(term);
  if (!table) {
    return `<section class="sched-finals glass"><h2>Tus exámenes finales</h2>
      <p>Studium todavía no tiene el calendario de exámenes finales de este semestre. Si tú lo tienes (una captura o el PDF de Registro), súbelo: tu IA lo lee y Studium calcula el día y la hora del final de cada materia.</p>
      ${transcribeFinalsBox()}</section>`;
  }
  const rows = myFinals();
  const perDay = rows.filter((x) => x.f.date).reduce((m, x) => m.set(x.f.date, (m.get(x.f.date) ?? 0) + 1), new Map());
  const busy = [...perDay].filter(([, n]) => n > 3);
  const line = ({ c, f, added }) => f.kind === 'coordinar'
    ? `<li class="fx-coord"><b>${esc(label(c))}</b><span>Tu clase tiene otro horario que los de la tabla: <b>tu profesor coordina contigo</b> la hora del final.</span></li>`
    : `<li class="${f.kind === 'departamental' ? 'fx-dep' : ''}${added ? ' fx-added' : ''}"><b>${esc(label(c))}</b><span>${esc(longDay(f.date))}, <b>${esc(f.from)}–${esc(f.to)}</b>${f.kind === 'departamental' ? ` · examen departamental de ${esc(f.name)}${f.choose ? `. ${esc(f.choose)}` : ''}` : ''}</span>
        ${added ? '<span class="fx-ok">✓ En tu calendario</span>' : `<button class="button ghost small" data-final-add="${esc(c.id)}">Agregar</button>`}</li>`;
  const open = rows.filter((x) => x.f.date && !x.added);
  return `<section class="sched-finals glass"><h2>Tus exámenes finales, sugeridos <small>del ${esc(longDay(term.finals[0]))} al ${esc(longDay(term.finals[1]))}</small></h2>
    <p class="muted">Según el calendario de exámenes finales y tu horario, así te tocarían. <b>No todas las materias siguen esta tabla</b>: agrega los que tu profesor confirme.</p>
    ${rows.length ? `<ul class="fx-list">${rows.sort((a, b) => String(a.f.date ?? 'z').localeCompare(String(b.f.date ?? 'z')) || String(a.f.from).localeCompare(String(b.f.from))).map(line).join('')}</ul>` : '<p class="muted">Tus clases de este semestre no tienen un final en la tabla.</p>'}
    ${open.length > 1 ? `<p><button class="button ghost small" data-final-all>Agregar los ${open.length} sugeridos a mi calendario</button></p>` : ''}
    ${busy.length ? `<p class="tj-warn">Según la tabla, te tocarían más de 3 exámenes el ${busy.map(([d]) => esc(longDay(d))).join(' y el ')}: el reglamento permite hasta 3 por día. Habla con tus profesores para buscar alternativas.</p>` : ''}
    <p class="fine">Calculado con ${table.own ? 'el calendario que subiste' : `el ${esc(table.source)}`}. Lo que agregas queda en tu calendario de abajo y en «Tu próximo examen» de Inicio; ahí lo cambias o lo quitas.</p>
  </section>`;
}
// When Studium has no finals table for the term: the person's AI reads the one they have, once, on this device.
function transcribeFinalsBox() {
  return `<div class="fx-up" data-finals-up>
    <label class="button ghost small"><input type="file" accept="image/*,.pdf" hidden data-finals-file> Subir el calendario de exámenes</label>
    ${ai.ready() ? ai.pickerHTML('schedule') : '<span class="fine">Necesitas una IA conectada en Ajustes (Gemini es gratis).</span>'}
    <span class="fine" data-finals-msg role="status"></span></div>`;
}
const FINALS_SYSTEM = `Lees el calendario de exámenes finales de una universidad (una imagen o un PDF) y lo devuelves en JSON.
Devuelve SOLO un objeto JSON, sin texto antes ni después, con esta forma:
{"byClass":[{"days":["Lunes","Miércoles"],"start":"11:30","date":"2026-12-14","from":"09:00","to":"11:00"}],"departmental":[{"name":"Química","date":"2026-12-11","from":"09:00","to":"12:00"}],"notes":["…"]}
- "byClass": cada fila que asigna el examen según el horario de la clase: los días en que se dicta la clase ("LI" es Lunes y Miércoles, "MJ" es Martes y Jueves; usa los nombres completos), la hora en que empieza la clase, y el día (fecha completa, AAAA-MM-DD) y las horas del examen.
- "departmental": los exámenes comunes por materia o área, con su nombre como aparece.
- "notes": las consideraciones importantes, tal como aparecen.
- Horas en 24 h, "HH:MM". No inventes nada: lo que no aparezca, déjalo fuera.`;
async function transcribeFinals(file, box) {
  const msg = $('[data-finals-msg]', box);
  const term = termNow();
  msg.textContent = 'Tu IA está leyendo el calendario…';
  try {
    const part = await ai.readFile(file);
    if (part.skipped) throw new Error(`No pude abrir ${file.name}: ${part.skipped}.`);
    const parts = [part];
    const res = await ai.run({ system: FINALS_SYSTEM, text: 'El calendario de exámenes finales está en lo adjunto.', files: parts, maxTokens: 4000, use: ai.picked('schedule', box) });
    const j = parseAnswer(res.text);
    const dayIx = (n) => DAYS.findIndex((d) => d.toLowerCase().startsWith(String(n).toLowerCase().slice(0, 2)));
    const ok = (t) => /^\d{2}:\d{2}$/.test(t ?? '');
    const table = {
      byClass: (j.byClass ?? []).map((r) => ({ days: (r.days ?? []).map(dayIx).filter((d) => d >= 0).sort(), start: r.start, date: r.date, from: r.from, to: r.to }))
        .filter((r) => r.days.length && ok(r.start) && /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') && ok(r.from) && ok(r.to)).slice(0, 80),
      departmental: (j.departmental ?? []).filter((d) => d.name && /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '')).map((d) => ({ name: String(d.name).slice(0, 60), date: d.date, from: d.from, to: d.to })).slice(0, 20),
      notes: (j.notes ?? []).map((x) => String(x).slice(0, 300)).slice(0, 6),
      source: `el calendario que subiste (${file.name})`,
    };
    if (!table.byClass.length) throw new Error('Tu IA no encontró filas de exámenes por horario en ese archivo.');
    keepOwnTable(term, table);
    paint();
  } catch (e) { msg.textContent = e.message === 'json' ? 'Tu IA no devolvió la tabla. Prueba con una captura más nítida.' : e.message || 'No se pudo leer.'; }
}

/* ---------- the month: exams, presentations, meetings and the official calendar ---------- */
// His words: under «Mi horario», the month, where exams, presentations, meetings and other events stand out. Its
// events are the person's own dates (Fechas y entregas: the same list as Inicio), the pendientes with a date, and the
// official calendar (calendario.js). «Descargar .ics» takes them to Google Calendar or Outlook (import once);
// a live sync needs an app registered with Google or Microsoft (his decision, later).
let monthAt = null; // the first day of the month shown
// No emoji as icons (CASPIAN): an event's kind is its color (k-<kind>) and its name.
const KIND_ICON = { examen: '', entrega: '', presentacion: '', reunion: '', otro: '' };
function monthEvents(from, to) {
  const p = prefs.get();
  const out = [];
  for (const d of p.deadlines) if (d.date >= from && d.date <= to) out.push({ day: d.date, time: d.time ?? '', text: d.text, course: d.course ?? '', kind: d.kind ?? 'otro', id: d.id, own: true });
  for (const t of p.todos) if (t.due && !t.done && t.due.slice(0, 10) >= from && t.due.slice(0, 10) <= to) out.push({ day: t.due.slice(0, 10), time: t.due.slice(11, 16), text: t.text, kind: 'pendiente', todo: t.id });
  for (const term of TERMS) {
    for (const [day, text] of term.dates) if (day >= from && day <= to) out.push({ day, text, kind: 'oficial' });
    for (const [a, b, text] of term.off) for (let d = new Date(`${a}T12:00`); iso(d) <= b; d.setDate(d.getDate() + 1)) if (iso(d) >= from && iso(d) <= to) out.push({ day: iso(d), text, kind: 'feriado' });
  }
  return out.sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
}
function monthHTML() {
  const now = new Date();
  monthAt ??= new Date(now.getFullYear(), now.getMonth(), 1);
  const y = monthAt.getFullYear(); const m = monthAt.getMonth();
  const first = new Date(y, m, 1); const last = new Date(y, m + 1, 0);
  const lead = (first.getDay() + 6) % 7;
  const events = monthEvents(iso(first), iso(last));
  const todayIso = iso(now);
  const cells = [...Array.from({ length: lead }, () => '<div class="mc-day out"></div>'), ...Array.from({ length: last.getDate() }, (_, i) => {
    const day = iso(new Date(y, m, i + 1));
    const st = dayStatus(day);
    const on = events.filter((e) => e.day === day);
    const holiday = on.find((e) => e.kind === 'feriado');
    return `<div class="mc-day${day === todayIso ? ' today' : ''}${holiday ? ' off' : ''}${st.kind === 'finals' ? ' finals' : ''}"><b>${i + 1}</b>
      ${on.filter((e) => e.kind !== 'feriado').slice(0, 4).map((e) => `<span class="mc-ev k-${e.kind}" title="${esc([EVENT_KINDS[e.kind] ?? (e.kind === 'pendiente' ? 'Pendiente' : 'Calendario oficial'), e.time, e.text, e.course].filter(Boolean).join(' · '))}">${KIND_ICON[e.kind] ?? ''}${e.time ? `<i>${esc(e.time)}</i> ` : ''}${esc(e.text)}</span>`).join('')}
      ${on.filter((e) => e.kind !== 'feriado').length > 4 ? `<span class="mc-more">+${on.filter((e) => e.kind !== 'feriado').length - 4}</span>` : ''}
      ${holiday ? `<span class="mc-hol">${esc(holiday.text)}</span>` : ''}</div>`;
  })].join('');
  const mine = events.filter((e) => e.own);
  const label = monthAt.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
  return `<section class="sched-month glass" id="sched-month">
    <div class="mc-head"><h2>${esc(label[0].toUpperCase() + label.slice(1))}</h2>
      <div class="mc-nav"><button class="button ghost small" data-month="-1" aria-label="Mes anterior">←</button><button class="button ghost small" data-month="0">Hoy</button><button class="button ghost small" data-month="1" aria-label="Mes siguiente">→</button></div>
      <button class="button ghost small" data-ics title="Para importarlo en Google Calendar u Outlook">Descargar para Google u Outlook (.ics)</button></div>
    <div class="mc-grid"><div class="mc-wd">Lun</div><div class="mc-wd">Mar</div><div class="mc-wd">Mié</div><div class="mc-wd">Jue</div><div class="mc-wd">Vie</div><div class="mc-wd">Sáb</div><div class="mc-wd">Dom</div>${cells}</div>
    <form class="mc-add" data-event-add>
      <select name="kind" aria-label="Qué es">${Object.entries(EVENT_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input name="text" maxlength="100" required placeholder="Examen final de Cálculo, presentación del proyecto…" aria-label="Qué" autocomplete="off">
      <input name="date" type="date" required aria-label="Día"><input name="time" type="time" aria-label="Hora (opcional)">
      <input name="course" maxlength="80" placeholder="Materia (opcional)" aria-label="Materia" list="mc-courses" autocomplete="off">
      <datalist id="mc-courses">${[...new Set(state.mine.classes.map((c) => c.name))].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <button class="button primary small">Agregar</button></form>
    ${mine.length ? `<ul class="mc-list">${mine.map((e) => `<li><span class="k-${e.kind}">${esc(EVENT_KINDS[e.kind])}</span> <b>${esc(e.text)}</b> <span class="muted">${esc([longDay(e.day), e.time, e.course].filter(Boolean).join(' · '))}</span> <button class="icon x" data-event-remove="${esc(e.id)}" aria-label="Quitar"><svg><use href="#i-x"/></svg></button></li>`).join('')}</ul>` : ''}
    <p class="fine">Los días sin clases y las fechas del semestre vienen del <a href="${esc(TERMS[0].source)}" target="_blank" rel="noopener noreferrer">calendario académico oficial</a>. Lo que agregues aquí también aparece en Inicio.</p>
  </section>`;
}
// An .ics file (RFC 5545) with the person's dates, the pendientes with a date and the official calendar.
function icsFile() {
  const now = new Date();
  const from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const to = iso(new Date(now.getFullYear() + 1, now.getMonth(), 1));
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const txt = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studium//Mi horario//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Studium'];
  monthEvents(from, to).forEach((e, i) => {
    const d = e.day.replace(/-/g, '');
    const next = new Date(`${e.day}T12:00`); next.setDate(next.getDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:studium-${d}-${i}-${(e.id ?? e.todo ?? e.kind).replace(/[^\w-]/g, '')}@studium`, `DTSTAMP:${stamp}`,
      ...(e.time ? [`DTSTART:${d}T${e.time.replace(':', '')}00`, `DURATION:PT1H`] : [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${iso(next).replace(/-/g, '')}`]),
      `SUMMARY:${txt(`${e.kind === 'feriado' ? 'Sin clases: ' : ''}${e.text}`)}`, ...(e.course ? [`DESCRIPTION:${txt(e.course)}`] : []), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ---------- adding a class, with what a student would want to know ---------- */
const semesterIn = (excluded) => {
  const sem = prefs.get().semester;
  if (!sem) return false;
  const year = Math.ceil(sem / 2);
  const names = ['Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto'];
  return excluded.some((x) => new RegExp(`^${names[year - 1] ?? '-'} Año, Semestre ${sem % 2 === 1 ? 1 : 2}`, 'i').test(x));
};
// Puts the class in the list and queues what it should ask about.
function place(cls, list, raw) {
  list.classes.push(cls);
  const hits = list.classes.filter((c) => c !== cls && meets(c, cls) && !samePart(c, cls));
  if (hits.length) asks.push({ kind: 'clash', cls, with: hits, list });
  if (raw?.excluded?.length) asks.push({ kind: 'excluded', cls, excluded: raw.excluded, applies: semesterIn(raw.excluded), list });
  note = raw?.code && raw?.nrc ? `Agregada: ${esc(which(cls))}.` : '';
  if (cls.code) checkPrereq(cls, list);
  save(); sfx.tick();
}
// What the person's malla says the class needs, once per class: a question they answer, never a block.
const warned = new Set();
async function checkPrereq(cls, list) {
  if (!prefs.get().malla) {
    if (note.startsWith('Agregada') && !note.includes('malla')) { note += ' Si eliges tu carrera en <a href="#/malla">Mi malla</a>, Studium revisa sus prerrequisitos.'; paint(); }
    return;
  }
  // A class and its own prerequisite in the same draft: Banner refuses the first one. Said every time, in red.
  const others = list.classes.filter((c) => c !== cls && c.code && norm(c.code) !== norm(cls.code));
  const mine = await sameTermPrereqs(cls.code, others.map((c) => c.code));
  const theirs = [];
  for (const c of others) if ((await sameTermPrereqs(c.code, [cls.code])).length) theirs.push(c);
  if (list.classes.includes(cls) && (mine.length || theirs.length)) {
    asks.push(mine.length ? { kind: 'together', cls, needer: cls, needs: mine.join(' y '), list } : { kind: 'together', cls, needer: theirs[0], needs: which(cls), list });
    paint();
    return;
  }
  const n = await prereqNote(cls.code);
  if (!n || warned.has(norm(cls.code)) || !list.classes.includes(cls)) return;
  warned.add(norm(cls.code));
  asks.push({ kind: 'prereq', cls, needs: n.needs, list });
  paint();
}
function addCandidate(raw, list = view()) {
  const cls = cleanClass(raw, list.classes.length);
  if (cls.nrc && list.classes.some((c) => c.nrc === cls.nrc)) { note = 'Esa clase ya está en este borrador.'; return; }
  note = '';
  const old = list.classes.find((c) => samePart(c, cls));
  if (old) { asks.push({ kind: 'dup', cls, old, raw, list }); return; }
  const other = cls.group && list.classes.find((c) => c.code === cls.code && c.group && !samePart(c, cls) && !linked(c, cls));
  if (other) { asks.push({ kind: 'group', cls, other, raw, list }); return; }
  place(cls, list, raw);
}
function answer(how) {
  const a = asks.shift();
  if (!a) return;
  const { cls, list } = a;
  if (a.kind === 'dup' && how === 'replace') { list.classes = list.classes.filter((c) => c !== a.old); place(cls, list, a.raw); }
  if (a.kind === 'dup' && how === 'draft') { draftDialog(cls, [a.old]); return; }
  if (a.kind === 'group' && how === 'add') place(cls, list, a.raw);
  if (how === 'remove') { list.classes = list.classes.filter((c) => c !== cls); asks = asks.filter((x) => x.cls !== cls); save(); }
  if (a.kind === 'clash' && how === 'draft') { draftDialog(cls, a.with); return; }
  paint();
}
function pasteAdd() {
  const box = $('[data-paste]', root);
  const { term, sections } = parseOffer(box.value);
  if (!sections.length) {
    note = box.value.trim() ? 'No reconocí una clase de la Oferta de cursos en ese texto. Para otra cosa, usa «desde una captura o un archivo».' : 'Copia en la Oferta de cursos una clase, o toda la búsqueda, y pégala aquí.';
    paint(); return;
  }
  if (term) state.term = term;
  if (sections.length === 1) { catalog = []; addCandidate(sections[0]); } else { catalog = sections; note = ''; }
  save(); paint();
}
// A new draft around a class: with nothing else, with what does not clash, or with what the person picks.
function draftDialog(cls, against) {
  const from = view();
  if (state.options.length >= MAX_OPTIONS) { from.classes = from.classes.filter((c) => c !== cls); note = 'Ya tienes seis borradores: quita uno para crear otro.'; paint(); return; }
  const others = from.classes.filter((c) => c !== cls);
  const fits = (c) => !against.includes(c) && !meets(c, cls) && !samePart(c, cls);
  const dlg = $('#sched-dialog');
  dlg.innerHTML = `<form method="dialog" class="sched-form small">
    <h2>Un borrador nuevo con ${esc(which(cls))}</h2>
    <label class="field"><span>Nombre</span><input name="name" value="${esc(draftName(state.options.length + 1))}" maxlength="24"></label>
    ${others.length ? `<div class="field"><span>¿Qué más llevas?</span>
      <div class="quick"><button type="button" class="link" data-none>Nada más</button> · <button type="button" class="link" data-fits>Lo que no choca</button></div>
      <ul class="pick-list">${others.map((c) => `<li><label><input type="checkbox" value="${c.id}" ${fits(c) ? 'checked' : ''}><span>${esc(which(c))}</span>${fits(c) ? '' : '<em>choca</em>'}</label></li>`).join('')}</ul></div>` : ''}
    <div class="actions"><button class="button primary" value="save">Crear el borrador</button><button class="button ghost" value="cancel" formnovalidate>Cancelar</button></div></form>`;
  const form = $('form', dlg);
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-none]')) form.querySelectorAll('.pick-list input').forEach((x) => { x.checked = false; });
    if (e.target.closest('[data-fits]')) form.querySelectorAll('.pick-list input').forEach((x) => { x.checked = fits(others.find((c) => c.id === x.value)); });
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') { paint(); return; }
    const keep = new Set([...form.querySelectorAll('.pick-list input:checked')].map((x) => x.value));
    from.classes = from.classes.filter((c) => c !== cls);
    const next = { id: rid(), name: text(new FormData(form).get('name'), 24) || draftName(state.options.length + 1), classes: [...others.filter((c) => keep.has(c.id)).map((c) => ({ ...c, id: rid(), slots: c.slots.map((s) => ({ ...s })) })), cls] };
    state.options.push(next); state.active = state.options.length - 1;
    asks = asks.filter((x) => !(x.cls === cls && x.kind === 'clash'));
    for (const x of asks) if (x.cls === cls) x.list = next;
    note = `${next.name}: ${next.classes.length} ${next.classes.length === 1 ? 'clase' : 'clases'}.`;
    save(); paint(); sfx.chime?.();
  }, { once: true });
  dlg.showModal();
}
// Takes a class, and the parts of its group with it, from this draft to another (or to «Mi horario»).
function moveTo(id, target) {
  const from = view();
  const c = from.classes.find((x) => x.id === id);
  if (!c || target === from) return 0;
  const group = [c, ...from.classes.filter((x) => x !== c && x.code === c.code && linked(x, c))];
  for (const g of group) if (!target.classes.some((x) => g.nrc && x.nrc === g.nrc)) target.classes.push({ ...g, id: rid(), slots: g.slots.map((s) => ({ ...s })) });
  from.classes = from.classes.filter((x) => !group.includes(x));
  save();
  return group.length;
}

/* ---------- a class by hand: the name, the days and the block ---------- */
function classDialog(id) {
  const o = view();
  const c = o.classes.find((x) => x.id === id) ?? cleanClass({ credits: 3, slots: [] }, o.classes.length);
  const isNew = !o.classes.some((x) => x.id === id);
  const dlg = $('#sched-dialog');
  const first = c.slots[0];
  const days = first ? c.slots.filter((s) => s.s === first.s && s.e === first.e).map((s) => s.d) : [];
  const extra = first ? c.slots.filter((s) => !(s.s === first.s && s.e === first.e)) : [];
  const start = first?.s ?? null; const end = first?.e ?? null;
  dlg.innerHTML = `<form method="dialog" class="sched-form quick">
    <h2>${isNew ? 'Agregar una clase' : esc(label(c))}</h2>
    <label class="field"><span>Materia</span><input name="name" value="${esc(isNew ? '' : c.name)}" maxlength="80" required autocomplete="off" placeholder="Cálculo Integral"></label>
    <div class="field"><span>Días</span><div class="days">${DAYS.map((d, k) => `<label><input type="checkbox" value="${k}" ${days.includes(k) ? 'checked' : ''}><span>${SHORT[k]}</span></label>`).join('')}</div></div>
    <div class="field"><span>Bloque</span><div class="blocks">${BLOCKS.map((b) => `<label><input type="radio" name="block" value="${b.s}" ${start === b.s && end === b.e ? 'checked' : ''}><span>${hhmm(b.s)}</span></label>`).join('')}</div></div>
    <details ${!isNew && (c.nrc || c.prof || c.room) ? 'open' : ''}><summary>Más detalles</summary><div class="more">
      <div class="grid three">
        <label class="field"><span>Créditos</span><input name="credits" type="number" min="0" max="10" value="${c.credits}"></label>
        <label class="field"><span>Código</span><input name="code" value="${esc(c.code)}" maxlength="20" placeholder="MAT-1202"></label>
        <label class="field"><span>NRC</span><input name="nrc" value="${esc(c.nrc)}" maxlength="12"></label>
      </div>
      <div class="grid"><label class="field"><span>Profe</span><input name="prof" value="${esc(c.prof)}" maxlength="80"></label>
        <label class="field"><span>Aula</span><input name="room" value="${esc(c.room)}" maxlength="20"></label></div>
      <div class="times">Otra hora: <label>de <input type="time" data-s value="${start !== null ? hhmm(start).padStart(5, '0') : ''}"></label><label>a <input type="time" data-e value="${end !== null ? hhmm(end).padStart(5, '0') : ''}"></label></div>
    </div></details>
    <p class="msg" role="alert"></p>
    <div class="actions"><button class="button primary" value="save">${isNew ? 'Agregar' : 'Guardar'}</button><button class="button ghost" value="cancel" formnovalidate>Cancelar</button>
      ${isNew ? '' : '<button type="button" class="button ghost danger" data-class-remove>Quitar esta clase</button>'}</div></form>`;
  const form = $('form', dlg);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'block') { const s = Number(e.target.value); $('[data-s]', form).value = hhmm(s).padStart(5, '0'); $('[data-e]', form).value = hhmm(s + 80).padStart(5, '0'); sfx.tick(); }
    if (e.target.matches('[data-s], [data-e]')) form.querySelectorAll('[name=block]').forEach((x) => { x.checked = false; });
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-class-remove]')) { o.classes = o.classes.filter((x) => x.id !== c.id); save(); dlg.close(); paint(); sfx.drop?.(); }
  });
  form.addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    const f = new FormData(form);
    const s = toMin($('[data-s]', form).value); const en = toMin($('[data-e]', form).value);
    const picked = [...form.querySelectorAll('.days input:checked')].map((x) => Number(x.value));
    if (!picked.length || !Number.isFinite(s) || !Number.isFinite(en) || en <= s) { e.preventDefault(); $('.msg', form).textContent = 'Elige al menos un día y un bloque.'; return; }
    const next = { ...c, name: f.get('name'), credits: f.get('credits'), code: f.get('code'), nrc: f.get('nrc'), prof: f.get('prof'), room: f.get('room'), slots: [...picked.map((d) => ({ d, s, e: en })), ...extra] };
    if (isNew) addCandidate(next, o); else { o.classes[o.classes.findIndex((x) => x.id === c.id)] = cleanClass(next, 0); save(); }
    paint(); sfx.tick();
  });
  dlg.showModal();
}

/* ---------- transcribing a whole schedule: the person's own AI, or any chat ---------- */
const FORMAT = `{"options":[{"name":"Mi horario","classes":[{"name":"Cálculo Integral","code":"MAT-1202","nrc":"4361","kind":"Teoría","prof":"","room":"H313","credits":3,"slots":[{"day":"Martes","start":"08:30","end":"09:50"}]}]}]}`;
const SYSTEM = `Lees el horario de clases de un estudiante universitario, en cualquier formato (captura de pantalla, foto, hoja de cálculo, PDF o texto), y lo devuelves en JSON.
Reglas:
- Devuelve SOLO un objeto JSON, sin texto antes ni después, con esta forma: ${FORMAT}
- Si el documento muestra varias alternativas de horario, cada una es una opción en "options", con el nombre que tenga en el documento. Si hay una sola, devuelve una sola opción.
- day: Lunes, Martes, Miércoles, Jueves, Viernes o Sábado. start y end en 24 h, "HH:MM".
- Una clase que se repite en varios días lleva un slot por día. Ejercicios o laboratorio con su propio NRC son otra clase, con su kind.
- Copia código, NRC, profe y aula solo si aparecen; si no, déjalos vacíos. No inventes nada. credits: el número si aparece; si no, 3 para materias normales y 0 para ejercicios, laboratorios y niveles de inglés.
- Si el código y el NRC aparecen juntos (por ejemplo "CMP-4005.1652"), sepáralos.`;
const parseAnswer = (txt) => { const m = String(txt).match(/\{[\s\S]*\}/); if (!m) throw new Error('json'); return JSON.parse(m[0]); };
let found = null;
function mountTranscribe(box) {
  const target = box.dataset.transcribe; // 'mine' or 'draft'
  const msg = $('[data-msg]', box); const input = $('[data-files]', box);
  const names = () => { $('[data-file-names]', box).textContent = [...input.files].map((f) => f.name).join(' · '); };
  const zone = $('[data-drop-zone]', box);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); input.files = e.dataTransfer.files; names(); });
  input.addEventListener('change', names);
  const show = (raw) => {
    found = clean(raw);
    const n = found.options.reduce((s, o) => s + o.classes.length, 0);
    if (!n) { msg.textContent = 'No encontré clases en eso. Prueba con una captura más nítida o pega el texto.'; found = null; return; }
    msg.textContent = '';
    $('[data-preview]', box).innerHTML = `${found.options.map((o) => `<div><b>${esc(o.name)}</b> · ${credits(o.classes)} créditos<ul>${o.classes.map((c) => `<li>${esc(label(c))} <small>${c.slots.map((s) => `${SHORT[s.d]} ${hhmm(s.s)}–${hhmm(s.e)}`).join(', ')}</small></li>`).join('')}</ul></div>`).join('')}
      <div class="actions"><button class="button primary" data-use-found>${target === 'mine' ? 'Usar como mi horario' : 'Agregar como borrador'}</button></div>`;
  };
  const gather = async () => {
    const parts = [];
    for (const f of input.files) {
      if (/\.xlsx$/i.test(f.name)) { const { unzip, officeText } = await import('./files.js'); parts.push({ name: f.name, type: 'text/plain', text: await officeText(await unzip(f), 'xlsx') }); } else parts.push(await ai.readFile(f));
    }
    return { parts: parts.filter((p) => !p.skipped), skipped: parts.filter((p) => p.skipped), txt: $('[data-text]', box).value.trim() };
  };
  box.addEventListener('input', (e) => {
    if (!e.target.matches('[data-answer]') || !e.target.value.trim()) return;
    try { show(parseAnswer(e.target.value)); } catch { msg.textContent = 'Eso no parece la respuesta del chat: pega todo lo que te devolvió.'; }
  });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-chat-open]')) { $('[data-chat]', box).hidden = false; return; }
    if (e.target.closest('[data-copy]')) {
      const { txt } = await gather();
      try { await navigator.clipboard.writeText(`${SYSTEM}\n\n${txt ? `Mi horario:\n${txt}` : 'Mi horario está en el archivo que adjunto.'}`); msg.textContent = 'Copiado. Llévalo a tu chat con tu archivo y pega aquí la respuesta.'; } catch { msg.textContent = 'No se pudo copiar.'; }
      return;
    }
    if (e.target.closest('[data-read]')) {
      // Always an answer: busy while it works, and a sentence when it cannot.
      const btn = e.target.closest('[data-read]');
      const say = (t, tone = '') => { msg.textContent = t; msg.dataset.tone = tone; };
      btn.disabled = true; btn.classList.add('busy'); say('Leyendo…');
      try {
        const { parts, skipped, txt } = await gather();
        if (!parts.length && !txt) { say(skipped.length ? `No pude abrir ${skipped.map((s) => `${s.name}: ${s.skipped}`).join('; ')}.` : 'Primero sube un archivo o pega el texto.', 'warn'); return; }
        // Text from the course offering needs no AI.
        const offer = parts.length ? null : parseOffer(txt);
        if (offer && offer.sections.length) { say(''); show({ options: [{ name: target === 'mine' ? 'Mi horario' : draftName(state.options.length + 1), classes: offer.sections }] }); return; }
        if (!ai.ready()) {
          $('[data-chat]', box).hidden = false;
          say('Para leer una captura o un archivo, Studium necesita tu IA, y todavía no tienes una conectada. Conéctala en Ajustes (con Gemini es gratis), o usa cualquier chat con los dos pasos de aquí abajo.', 'warn');
          return;
        }
        say('Tu IA está leyendo tu horario. Puede tardar un minuto…');
        const res = await ai.run({ system: SYSTEM, text: txt ? `Mi horario:\n${txt}` : 'Mi horario está en lo adjunto.', files: parts, maxTokens: 6000, use: ai.picked('schedule', box) });
        say(skipped.length ? `No se leyó: ${skipped.map((s) => `${s.name} (${s.skipped})`).join(', ')}` : '');
        show(parseAnswer(res.text));
      } catch (error) {
        say(error instanceof ai.AIError ? error.message : `No se pudo leer (${error?.message ?? 'error'}). Prueba de nuevo, con otra IA o con un chat.`, 'warn');
      } finally { btn.disabled = false; btn.classList.remove('busy'); }
      return;
    }
    if (e.target.closest('[data-use-found]') && found) {
      if (target === 'mine') state.mine.classes = found.options[0].classes;
      else {
        const empty = state.options.length === 1 && !state.options[0].classes.length;
        const incoming = found.options.slice(0, Math.max(1, MAX_OPTIONS - (empty ? 0 : state.options.length)));
        state.options = empty ? incoming : [...state.options, ...incoming].slice(0, MAX_OPTIONS);
        state.active = empty ? 0 : state.options.length - incoming.length;
      }
      found = null; save();
      if ($('#sched-dialog').open) $('#sched-dialog').close();
      refresh(); sfx.chime?.();
    }
  });
}
function transcribeDialog(target) {
  const dlg = $('#sched-dialog');
  dlg.innerHTML = `<form method="dialog" class="sched-form wide"><h2>${target === 'mine' ? 'Volver a subir mi horario' : 'Un borrador desde una captura o un archivo'}</h2>
    ${target === 'mine' ? '<p class="muted">Reemplaza las clases de «Mi horario» cuando lo uses.</p>' : ''}
    ${transcribeBox(target)}<div class="actions"><button class="button ghost" value="cancel" formnovalidate>Cerrar</button></div></form>`;
  mountTranscribe($('[data-transcribe]', dlg));
  dlg.showModal();
}

/* ---------- export: an Excel of the week and the classes, and a picture ---------- */
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const colName = (i) => String.fromCharCode(65 + i);
function sheetXML(rows, widths) {
  const cell = (v, r, c) => {
    const ref = `${colName(c)}${r + 1}`;
    if (v === '' || v == null) return '';
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
const fileName = (name) => `horario-${name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}`;
async function downloadXlsx() {
  const o = view();
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) ? 6 : 5;
  const title = mode === 'mine' ? 'Mi horario' : o.name;
  const weekRows = [[`${title}${state.term ? ` · ${termName(state.term)}` : ''}`], ['Bloque', ...DAYS.slice(0, days)],
    ...BLOCKS.map((b) => [`${hhmm(b.s)}–${hhmm(b.e)}`, ...DAYS.slice(0, days).map((_, d) => o.classes.filter((c) => c.slots.some((x) => x.d === d && x.s < b.e && x.e > b.s)).map((c) => `${label(c)}${c.room ? ` [${c.room}]` : ''}`).join(' / '))])];
  const list = [['Materia', 'Tipo', 'Código', 'NRC', 'Paralelo', 'Créditos', 'Profe', 'Aula', 'Horario'],
    ...o.classes.map((c) => [c.name, c.kind, c.code, c.nrc, c.section, c.credits, c.prof, c.room, c.slots.map((s) => `${SHORT[s.d]} ${hhmm(s.s)}–${hhmm(s.e)}`).join(', ')]),
    [], ['Total', '', '', '', '', credits(o.classes)]];
  const enc = (s) => new TextEncoder().encode(s);
  const { zipFiles } = await import('./files.js');
  const blob = zipFiles([
    { name: '[Content_Types].xml', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Semana" sheetId="1" r:id="rId1"/><sheet name="Clases" sheetId="2" r:id="rId2"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', bytes: enc(sheetXML(weekRows, [14, ...Array(days).fill(30)])) },
    { name: 'xl/worksheets/sheet2.xml', bytes: enc(sheetXML(list, [32, 12, 12, 8, 9, 9, 28, 10, 40])) },
  ]);
  give(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName(title)}.xlsx`);
}
async function downloadPng() {
  const o = view();
  const title = mode === 'mine' ? 'Mi horario' : o.name;
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) ? 6 : 5;
  const rows = BLOCKS.length + Math.max(0, ...o.classes.flatMap((c) => c.slots.map((s) => Math.ceil(rowOf(s.e)) - BLOCKS.length)));
  const css = getComputedStyle(document.documentElement); const v = (n) => css.getPropertyValue(n).trim();
  const W = 1400; const left = 110; const top = 150; const colW = (W - left - 40) / days; const R = 92;
  const H = top + rows * R + 40;
  const cv = Object.assign(document.createElement('canvas'), { width: W * 2, height: H * 2 });
  const g = cv.getContext('2d'); g.scale(2, 2);
  g.fillStyle = '#fffdf8'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(36,83,230,.16)'; g.lineWidth = 1;
  for (let i = 0; i <= rows; i += 1) { const y = top + i * R; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(226,59,43,.5)'; g.beginPath(); g.moveTo(left - 12, 0); g.lineTo(left - 12, H); g.stroke();
  g.fillStyle = '#131722'; g.font = '800 34px "Bricolage Grotesque", system-ui, sans-serif'; g.fillText(title, left, 52);
  g.font = '600 15px "Atkinson Hyperlegible Next", system-ui, sans-serif'; g.fillStyle = '#676e82';
  g.fillText(`${credits(o.classes)} de ${INCLUDED} créditos${state.term ? ` · ${termName(state.term)}` : ''}`, left, 82);
  g.fillStyle = '#131722'; g.font = '700 16px "Bricolage Grotesque", system-ui, sans-serif';
  DAYS.slice(0, days).forEach((d, i) => g.fillText(d, left + i * colW + 8, top - 14));
  BLOCKS.forEach((b, i) => { g.fillStyle = '#131722'; g.font = '700 14px "Bricolage Grotesque", system-ui, sans-serif'; g.fillText(hhmm(b.s), 22, top + i * R + 24); g.fillStyle = '#676e82'; g.font = '600 12px "Atkinson Hyperlegible Next", system-ui, sans-serif'; g.fillText(hhmm(b.e), 22, top + i * R + 42); });
  for (let d = 0; d < days; d += 1) {
    for (const { c, s, lane, of } of lanes(o.classes, d)) {
      const col = v(`--${c.color}`) || '#2453e6';
      const w = (colW - 8) / of - (of > 1 ? 4 : 0); const x = left + s.d * colW + 4 + lane * (w + (of > 1 ? 4 : 0));
      const y = top + rowOf(s.s) * R + 3; const h = (rowOf(s.e) - rowOf(s.s)) * R - 6;
      g.fillStyle = col; g.globalAlpha = 0.18; roundRect(g, x, y, w, h, 12); g.fill(); g.globalAlpha = 1;
      g.fillStyle = col; roundRect(g, x, y, 6, h, 3); g.fill();
      g.fillStyle = '#131722'; g.font = '700 15px "Bricolage Grotesque", system-ui, sans-serif'; wrap(g, label(c), x + 14, y + 22, w - 20, 18, Math.max(1, Math.floor((h - 26) / 18)));
      g.fillStyle = '#343b4c'; g.font = '600 12px "Atkinson Hyperlegible Next", system-ui, sans-serif'; g.fillText(`${hhmm(s.s)}–${hhmm(s.e)}${c.room ? ` · ${c.room}` : ''}`, x + 14, y + h - 10);
    }
  }
  cv.toBlob((b) => give(b, `${fileName(title)}.png`), 'image/png');
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
function wrap(g, txt, x, y, w, lh, max) {
  const words = String(txt).split(/\s+/); let line = ''; let n = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > w && line) { g.fillText(line, x, y + n * lh); n += 1; line = word; if (n >= max) return; } else line = test;
  }
  if (n < max) g.fillText(line, x, y + n * lh);
}
function give(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- a draft's name, taking one away, «Mi horario» from a draft, emptying it ---------- */
function confirmDialog(what) {
  const o = view(); const dlg = $('#sched-dialog');
  const forms = {
    rename: `<h2>Nombre de este borrador</h2><label class="field"><span>Nombre</span><input name="name" value="${esc(o.name)}" maxlength="24" required></label>
      <div class="actions"><button class="button primary" value="save">Guardar</button><button class="button ghost" value="cancel" formnovalidate>Cancelar</button></div>`,
    remove: `<h2>¿Quitar ${esc(o.name)}?</h2><p class="muted">${o.classes.length ? `Sus ${o.classes.length} clases se van con él.` : 'No tiene clases.'}</p>
      <div class="actions"><button class="button primary red" value="save">Quitarlo</button><button class="button ghost" value="cancel" formnovalidate>Cancelar</button></div>`,
    mine: `<h2>¿Usar ${esc(o.name)} como tu horario?</h2><p class="muted">Reemplaza las clases de «Mi horario». Tus borradores se quedan como están.</p>
      <div class="actions"><button class="button primary" value="save">Usarlo</button><button class="button ghost" value="cancel" formnovalidate>Cancelar</button></div>`,
    clear: '<h2>¿Vaciar tu horario?</h2><p class="muted">Se quitan todas sus clases. Tus borradores se quedan como están.</p><div class="actions"><button class="button primary red" value="save">Vaciarlo</button><button class="button ghost" value="cancel" formnovalidate>Cancelar</button></div>',
  };
  const useMine = () => { state.mine.classes = o.classes.map((c) => ({ ...c, id: rid(), slots: c.slots.map((s) => ({ ...s })) })); mode = 'mine'; asks = []; catalog = []; };
  if (what === 'mine' && !state.mine.classes.length) { useMine(); save(); paint(); sfx.chime?.(); return; }
  dlg.innerHTML = `<form method="dialog" class="sched-form small">${forms[what]}</form>`;
  $('form', dlg).addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    if (what === 'rename') o.name = text(new FormData(e.target).get('name'), 24) || o.name;
    if (what === 'remove') { state.options.splice(state.active, 1); state.active = Math.max(0, state.active - 1); }
    if (what === 'mine') useMine();
    if (what === 'clear') state.mine.classes = [];
    save(); refresh();
  });
  dlg.showModal();
}

/* ---------- events ---------- */
export function mountSchedule() {
  addEventListener('resize', () => { clearTimeout(fitWeek.t); fitWeek.t = setTimeout(fitWeek, 150); });
  document.addEventListener('click', (e) => {
    if (!root || !root.contains(e.target)) return;
    const b = e.target.closest('button');
    if (!b || b.disabled || b.closest('[data-transcribe]')) return;
    b.closest('details')?.removeAttribute('open');
    const d = b.dataset;
    if (d.month !== undefined) { const n = Number(d.month); const t = new Date(); monthAt = n ? new Date(monthAt.getFullYear(), monthAt.getMonth() + n, 1) : new Date(t.getFullYear(), t.getMonth(), 1); paint(); $('#sched-month', root)?.scrollIntoView({ block: 'nearest' }); return; }
    if (d.finalAdd) { if (addFinal(d.finalAdd)) { sfx.tick?.(); paint(); } return; }
    if ('finalAll' in d) { let n = 0; for (const x of myFinals()) if (x.f.date && !x.added && addFinal(x.c.id)) n += 1; if (n) sfx.tick?.(); paint(); return; }
    if ('ics' in d) { give(new Blob([icsFile()], { type: 'text/calendar;charset=utf-8' }), 'studium-calendario.ics'); return; }
    if (d.eventRemove) { prefs.set({ deadlines: prefs.get().deadlines.filter((x) => x.id !== d.eventRemove) }); paint(); return; }
    if (d.mode) { mode = d.mode; catalog = []; asks = []; note = ''; paint(); sfx.tick(); scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (d.opt !== undefined) { state.active = Number(d.opt); asks = []; save(); paint(); sfx.tick(); return; }
    if ('optAdd' in d) { state.options.push(blankDraft(state.options.length + 1)); state.active = state.options.length - 1; save(); paint(); return; }
    if ('dup' in d) { const o = view(); state.options.push({ id: rid(), name: `${o.name} (copia)`.slice(0, 24), classes: o.classes.map((c) => ({ ...c, id: rid(), slots: c.slots.map((s) => ({ ...s })) })) }); state.active = state.options.length - 1; save(); paint(); return; }
    if ('rename' in d) return confirmDialog('rename');
    if ('optRemove' in d) return confirmDialog('remove');
    if ('useMine' in d) return confirmDialog('mine');
    if ('mineClear' in d) return confirmDialog('clear');
    if ('retranscribe' in d) return transcribeDialog('mine');
    if ('xlsx' in d) return void downloadXlsx();
    if ('png' in d) return void downloadPng();
    if ('add' in d) return classDialog(null);
    if ('import' in d) return transcribeDialog('draft');
    if ('pasteAdd' in d) return pasteAdd();
    if ('pickerClose' in d) { catalog = []; paint(); return; }
    if (d.pick) { const s = catalog.find((x) => x.nrc === d.pick); if (s) { addCandidate(s); paint(); } return; }
    if ('clashToggle' in d) { clashOpen = !clashOpen; paint(); return; }
    if (d.ask) return answer(d.ask);
    if (d.remove) { const o = view(); o.classes = o.classes.filter((c) => c.id !== d.remove); asks = asks.filter((x) => x.cls.id !== d.remove); save(); paint(); sfx.drop?.(); return; }
    if (d.edit) classDialog(d.edit);
  });
  document.addEventListener('change', (e) => {
    const input = e.target.closest?.('[data-finals-file]');
    if (!input || !root?.contains(input) || !input.files[0]) return;
    transcribeFinals(input.files[0], input.closest('[data-finals-up]'));
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!root?.contains(f) || !f.matches('[data-event-add]')) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const ev = { id: rid(), text: String(v.text).trim().slice(0, 100), date: v.date, kind: v.kind, ...(v.time ? { time: v.time } : {}), ...(String(v.course).trim() ? { course: String(v.course).trim().slice(0, 80) } : {}) };
    if (!ev.text || !ev.date) return;
    prefs.set({ deadlines: [...prefs.get().deadlines, ev] });
    monthAt = new Date(Number(ev.date.slice(0, 4)), Number(ev.date.slice(5, 7)) - 1, 1);
    sfx.tick?.(); paint(); $('#sched-month', root)?.scrollIntoView({ block: 'nearest' });
  });
  // The home's «Mi horario»: upload, go prepare enrollment, or open the page to edit.
  document.addEventListener('click', (e) => {
    if (!homeEl || !homeEl.contains(e.target)) return;
    if (e.target.closest('[data-hs-upload]')) { transcribeDialog('mine'); return; }
    if (e.target.closest('[data-hs-prep]')) { nextMode = 'prep'; location.hash = '#/horario'; return; }
    if (e.target.closest('.sched-class')) location.hash = '#/horario';
  });
  // Dragging a class onto another draft's tab passes it there, with its exercises or lab.
  let dragged = null;
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-drag]');
    if (!el || !root?.contains(el) || mode !== 'prep') return;
    dragged = el.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragged);
    root.classList.add('dragging');
  });
  document.addEventListener('dragend', () => { dragged = null; root?.classList.remove('dragging'); root?.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on')); });
  document.addEventListener('dragover', (e) => {
    const tgt = dragged && e.target.closest?.('[data-drop]');
    if (!tgt || !root.contains(tgt)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.drop-on').forEach((x) => x !== tgt && x.classList.remove('drop-on')); tgt.classList.add('drop-on');
  });
  document.addEventListener('drop', (e) => {
    const tgt = dragged && e.target.closest?.('[data-drop]');
    if (!tgt || !root.contains(tgt)) return;
    e.preventDefault();
    const target = state.options[Number(tgt.dataset.drop)];
    const n = moveTo(dragged, target);
    dragged = null; root.classList.remove('dragging');
    note = n ? `${n === 1 ? 'Pasada' : 'Pasadas'} a ${target.name}.` : '';
    paint(); if (n) sfx.chime?.();
  });
}
// For the home: the classes of «Mi horario».
export async function weekClasses() {
  await load();
  return state.mine.classes;
}
