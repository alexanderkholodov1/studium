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
import { prefs } from './prefs.js';
import { parseOffer, termName } from './offer.js';

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
    id: c.id || rid(), name: text(c.name, 80) || 'Clase', code: text(c.code, 20), nrc: text(c.nrc, 12), prof: text(c.prof, 80), room: text(c.room, 20),
    kind: text(c.kind, 20), group: text(c.group, 30), section: text(c.section, 6),
    credits: Math.max(0, Math.min(10, Number(c.credits) || 0)), color: COLORS.includes(c.color) ? c.color : COLORS[i % COLORS.length], slots,
  };
}
const cleanList = (o, i, fallback) => ({ id: o?.id || rid(), name: text(o?.name, 24) || (fallback ?? draftName(i + 1)), classes: (Array.isArray(o?.classes) ? o.classes : []).slice(0, MAX_CLASSES).map(cleanClass) });
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
// «Mi horario» in the home page: the week, or one card to put it. Editing happens in its page.
let homeEl = null;
export async function renderHomeSchedule(el) {
  homeEl = el;
  if (!el) return;
  const uid = auth.currentUser?.uid ?? null;
  if (loadedFor !== uid) { await load(); loadedFor = uid; }
  paintHome();
}
function paintHome() {
  if (!homeEl) return;
  const o = state.mine;
  homeEl.classList.add('sched');
  homeEl.innerHTML = o.classes.length ? `
    <div class="hs-head"><h2>Mi horario</h2><span class="muted">${credits(o.classes)} de ${INCLUDED} créditos${state.term ? ` · ${esc(termName(state.term))}` : ''}</span>
      <div class="hs-actions"><a class="button ghost small" href="#/horario">Editar</a><button class="sched-special small" data-hs-prep>Preparar mi inscripción</button></div></div>
    ${week(o, true)}`
    : `<div class="hs-empty glass">
      <span class="sg-icon c-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg></span>
      <div><h2>Pon tu horario</h2><p>Súbelo una vez (una captura de Banner, una foto o tu Excel) y lo verás aquí cada día.</p></div>
      <div class="hs-actions"><button class="button primary" data-hs-upload>Subir mi horario</button><button class="link" data-hs-prep>o prepara tu inscripción</button></div>
    </div>`;
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
function week(o, compact = false) {
  const clash = conflicts(o.classes);
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) ? 6 : 5;
  const late = Math.max(0, ...o.classes.flatMap((c) => c.slots.map((s) => Math.ceil(rowOf(s.e)) - BLOCKS.length)));
  const rows = BLOCKS.length + late;
  const inClash = (c, d, s) => clash.some((x) => x.d === d && x.s < s.e && x.e > s.s && (x.a === c || x.b === c));
  return `<div class="sched-sheet${compact ? ' compact' : ''}" style="--days:${days};--rows:${rows}">
    <div class="sched-head"><span></span>${DAYS.slice(0, days).map((d, i) => `<b><span class="long">${d}</span><span class="short">${SHORT[i]}</span></b>`).join('')}</div>
    <div class="sched-grid">
      <div class="sched-hours">${Array.from({ length: rows }, (_, i) => { const b = BLOCKS[i]; return `<span style="--r:${i}">${b ? `<b>${hhmm(b.s)}</b><small>${hhmm(b.e)}</small>` : ''}</span>`; }).join('')}</div>
      ${DAYS.slice(0, days).map((_, d) => `<div class="sched-day" data-day="${d}">
        ${lanes(o.classes, d).map(({ c, s, lane, of }) => `<button class="sched-class c-${c.color}${inClash(c, d, s) ? ' clashing' : ''}${of > 1 ? ' narrow' : ''}" draggable="${mode === 'prep'}" data-drag="${c.id}" data-edit="${c.id}"
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
    ${ready ? '' : `<p class="sched-ai-note">Para leer capturas y archivos, Studium usa tu propia IA (con Gemini es gratis): <a href="#/ajustes">conéctala en Ajustes</a>, o <button class="link" data-chat-open>hazlo con cualquier chat</button>.</p>`}
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
  const groups = new Set(o.classes.filter((c) => c.group).map((c) => `${c.code}|${c.group}`));
  const row = (s) => {
    const cls = cleanClass(s, 0);
    const mine = chosen.has(s.nrc);
    const partner = !mine && s.group && groups.has(`${s.code}|${s.group}`);
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
    <div class="sched-picker-cols">${kinds.map((k) => `<section><h4>${esc(k)}</h4><ol>${catalog.filter((s) => (s.kind || 'Clase') === k).sort((a, b) => (groups.has(`${b.code}|${b.group}`) ? 1 : 0) - (groups.has(`${a.code}|${a.group}`) ? 1 : 0)).map(row).join('')}</ol></section>`).join('')}</div>
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
    excluded: () => `<b>${esc(which(a.cls))}</b> no está abierta para: ${a.excluded.map(esc).join('; ')}.${a.applies ? ' Según tu perfil, eso te incluye.' : ''}`,
  })[a.kind]();
  const actions = {
    dup: '<button class="button primary" data-ask="replace">Cambiarla</button><button class="button ghost" data-ask="draft">Llevarla a un borrador nuevo</button><button class="link" data-ask="cancel">Cancelar</button>',
    group: '<button class="button primary" data-ask="cancel">No agregarla</button><button class="button ghost" data-ask="add">Agregarla igual</button>',
    clash: '<button class="button ghost" data-ask="keep">Dejar el choque</button><button class="button primary" data-ask="draft">Llevarla a un borrador nuevo</button><button class="link" data-ask="remove">Quitarla</button>',
    excluded: '<button class="button ghost" data-ask="keep">Entendido</button><button class="link" data-ask="remove">Quitarla</button>',
  }[a.kind];
  const tone = a.kind === 'clash' || a.kind === 'group' ? 'red' : 'amber';
  return `<div class="sched-ask ${tone}" role="alertdialog" aria-live="assertive">
    <span class="sched-ask-icon" aria-hidden="true">!</span><p>${body}</p><div class="actions">${actions}</div></div>`;
}

function paint() {
  if (!root) return;
  const o = view();
  const has = o.classes.length > 0;
  root.dataset.mode = mode;
  root.innerHTML = mode === 'mine' ? `
  <div class="sched-top">
    <p class="muted">${has ? `Tu semana${state.term ? ` · ${esc(termName(state.term))}` : ''}` : ''}</p>
    <button class="sched-special" data-mode="prep"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M12 13v4M10 15h4"/></svg>Preparar mi inscripción</button>
  </div>
  ${has ? `<div class="sched-body">${week(o)}<div class="sched-col">
      <div class="sched-actions"><details class="sched-more"><summary class="button ghost">Opciones</summary><div class="menu glass">
        <button data-retranscribe>Volver a subir mi horario</button><button data-add>Agregar una clase</button>
        <button data-xlsx>Descargar Excel</button><button data-png>Descargar imagen</button><button data-mine-clear class="danger">Vaciar mi horario</button></div></details></div>
      ${side(o)}</div></div>`
    : `<div class="sched-empty glass"><h2>Pon tu horario</h2><p>Studium lo pasa completo a tu semana, por bloques de clase.</p>${transcribeBox('mine')}</div>`}`
  : `
  <div class="sched-banner"><div><b>Preparando tu inscripción</b><span>Prueba paralelos en borradores. Cuando te inscribas, el que quedó puede ser tu horario.</span></div>
    <button class="button ghost small" data-mode="mine">Volver a mi horario</button></div>
  ${pastePanel()}${pickerPanel()}${askCard()}
  <div class="sched-bar">
    <div class="sched-options" role="tablist" aria-label="Borradores">
      ${state.options.map((x, i) => `<button role="tab" class="sched-opt" aria-selected="${i === state.active}" data-opt="${i}" data-drop="${i}">${esc(x.name)}<small>${credits(x.classes)} cr</small></button>`).join('')}
      ${state.options.length < MAX_OPTIONS ? '<button class="sched-opt add" data-opt-add title="Otro borrador" aria-label="Otro borrador">+</button>' : ''}
    </div>
    <div class="sched-actions">
      ${has ? '<button class="button ghost" data-use-mine>Usar como mi horario</button>' : ''}
      <details class="sched-more"><summary class="button ghost" aria-label="Más opciones">···</summary><div class="menu glass">
        <button data-rename>Cambiar el nombre</button><button data-dup>Duplicar</button>
        ${has ? '<button data-xlsx>Descargar Excel</button><button data-png>Descargar imagen</button>' : ''}
        ${state.options.length > 1 ? '<button data-opt-remove class="danger">Quitar este borrador</button>' : ''}
      </div></details>
    </div>
  </div>
  <div class="sched-body">${week(o)}${side(o)}</div>`;
  paintWhere();
  const box = $('.sched-empty [data-transcribe]', root);
  if (box) mountTranscribe(box);
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
  note = raw?.code && raw?.nrc ? `Agregada: ${which(cls)}. Studium no puede ver sus prerrequisitos; revísalos en la Oferta de cursos («Ver Prerrequisitos»).` : '';
  save(); sfx.tick();
}
function addCandidate(raw, list = view()) {
  const cls = cleanClass(raw, list.classes.length);
  if (cls.nrc && list.classes.some((c) => c.nrc === cls.nrc)) { note = 'Esa clase ya está en este borrador.'; return; }
  note = '';
  const old = list.classes.find((c) => samePart(c, cls));
  if (old) { asks.push({ kind: 'dup', cls, old, raw, list }); return; }
  const other = cls.group && list.classes.find((c) => c.code === cls.code && c.group && c.group !== cls.group && !samePart(c, cls));
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
  const group = [c, ...from.classes.filter((x) => x !== c && x.code === c.code && c.group && x.group === c.group)];
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
        const res = await ai.run({ system: SYSTEM, text: txt ? `Mi horario:\n${txt}` : 'Mi horario está en lo adjunto.', files: parts, maxTokens: 6000, task: 'identify' });
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
  document.addEventListener('click', (e) => {
    if (!root || !root.contains(e.target)) return;
    const b = e.target.closest('button');
    if (!b || b.disabled || b.closest('[data-transcribe]')) return;
    b.closest('details')?.removeAttribute('open');
    const d = b.dataset;
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
