// Your schedule, in two places that are not the same thing:
// - «Mi horario»: the semester's definitive week, the one that stays.
// - «Preparar la inscripción»: drafts, as many variants as help, to try classes before enrolling.
// The quickest way in is to paste what you copied from USFQ's course offering: one section or a whole search, read
// by Studium itself (offer.js), no AI needed. A theory section brings its exercises or lab of the same group to the
// front. A class that clashes asks once: leave the clash, or take it to a new draft and build around it. Classes can be
// dragged from one draft to another. Screenshots, PDFs or any file go through the person's own AI; by hand also works.
// Tips appear one at a time next to what they talk about (hints.js) and lead to the student guide. It is private: schedules/{uid}, only its owner.
import { auth, loadSchedule, saveSchedule } from './data.js';
import * as ai from './ai.js';
import { sfx } from './sfx.js';
import { t } from './i18n.js';
import { parseOffer, partners, termName } from './offer.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (s, r = document) => r.querySelector(s);
const rid = () => Math.random().toString(36).slice(2, 10);

export const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// USFQ's blocks: one every hour and a half from 7:00; each class ends ten minutes before the next block begins.
export const BLOCKS = [420, 510, 600, 690, 780, 870, 960, 1050].map((s) => ({ s, e: s + 80 }));
const COLORS = ['blue', 'red', 'teal', 'butter', 'sky', 'peach'];
const MAX_OPTIONS = 6; const MAX_CLASSES = 40;
const OFFER_URL = 'https://catalogodecursos.usfq.edu.ec/';
const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s) => { const m = String(s).trim().match(/^(\d{1,2})[:h.](\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const draftName = (n) => `${t('Borrador')} ${n}`;

/* ---------- the model ---------- */
const blankDraft = (n = 1) => ({ id: rid(), name: draftName(n), classes: [] });
const blank = () => ({ mine: { id: 'mine', name: 'Mi horario', classes: [] }, options: [blankDraft()], active: 0, term: '' });
// A slot written as whole blocks (7:00–8:30) is kept with its real end (8:20): a class ends ten minutes before the next
// block. Any other hours are kept as they are.
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
// Where two classes meet: every overlap of two slots on the same day.
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
// Classes that meet on a day share its width: each gets a lane, and the lanes of a group of overlapping classes divide
// the column, so both names stay readable where they clash.
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
// A class's name as the list shows it: «Cálculo Integral + Ej» and its kind, «Ejercicios», when it is not the theory.
const label = (c) => (c.kind && !/^teor/i.test(c.kind) ? `${c.name} · ${c.kind}` : c.name);
// On a phone's narrow column: the code, and «Ej» or «Lab» for the second part; a name without a code, its first word.
const shortLabel = (c) => `${c.code || c.name.split(/\s+/)[0]}${c.kind && !/^teor/i.test(c.kind) ? ` ${c.kind.slice(0, 3)}` : ''}`;
// Two classes with the same name told apart: their section, or their NRC.
const which = (c) => `${label(c)}${c.section ? ` (paralelo ${c.section})` : c.nrc ? ` (NRC ${c.nrc})` : ''}`;
// A course that has exercises or a lab («+ Ej», «+Lab», or a group) but has only one of its parts in this list.
function missingPart(c, list) {
  if (!c.code) return '';
  const same = list.filter((x) => x !== c && x.code === c.code);
  const needs = /\+\s*(ej|lab)/i.test(c.name) || (c.group && catalog.some((x) => x.code === c.code && x.group === c.group && x.kind !== c.kind));
  if (!needs || same.length) return '';
  return /^teor/i.test(c.kind) || !c.kind ? t('Le falta su NRC de ejercicios o laboratorio.') : t('Le falta su NRC de teoría.');
}

/* ---------- kept: in the account, or on this device until the rules reach the database ---------- */
// The copy on this device belongs to one account: on a shared computer nobody sees another person's schedule. It is
// read only when the account cannot be reached (or, on a preview, before the rules reach the database).
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
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try { await saveSchedule(uid, state); if (where !== 'account') { where = 'account'; paintWhere(); } } catch { if (where !== 'device') { where = 'device'; paintWhere(); } }
  }, 700);
}

/* ---------- what the page shows ---------- */
let root = null;
let loadedFor = null;
let mode = 'prep'; // 'mine' or 'prep'
let catalog = []; // the sections of the last paste with several, to choose from
let pending = null; // a class that clashed when added: { list, cls, with: [names] }
let clashOpen = false;
const view = () => (mode === 'mine' ? state.mine : state.options[state.active]);
const ui = (k, v) => { try { if (v === undefined) return localStorage.getItem(`studium-sched-${k}`); localStorage.setItem(`studium-sched-${k}`, v); } catch { return null; } return null; };

// Drawn once per account: the route may call this again while the rest of the app loads, and redrawing then would lose
// a click in progress. What is in memory is the truth after the first load; every change repaints by itself.
export async function renderSchedule() {
  root = $('#horario');
  const uid = auth.currentUser?.uid ?? null;
  if (loadedFor === uid && root.childElementCount) return;
  if (!root.childElementCount) root.innerHTML = `<p class="status">${t('Cargando tu horario…')}</p>`;
  await load();
  loadedFor = uid;
  mode = state.mine.classes.length ? 'mine' : 'prep';
  paint();
}
function paintWhere() {
  const el = $('#sched-where', root);
  if (el) el.textContent = where === 'device' ? t('Por ahora se guarda en este dispositivo.') : t('Se guarda en tu cuenta. Solo tú lo ves.');
}

function week(o) {
  const clash = conflicts(o.classes);
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) ? 6 : 5;
  const first = Math.min(420, ...o.classes.flatMap((c) => c.slots.map((s) => Math.floor(s.s / 30) * 30)));
  const last = Math.max(1140, ...o.classes.flatMap((c) => c.slots.map((s) => Math.ceil(s.e / 30) * 30)));
  const px = 0.9; // pixels per minute
  const inClash = (c, d, s) => clash.some((x) => x.d === d && x.s < s.e && x.e > s.s && (x.a === c || x.b === c));
  return `<div class="sched-sheet" style="--px:${px};--days:${days}">
    <div class="sched-head"><span></span>${DAYS.slice(0, days).map((d, i) => `<b><span class="long">${t(d)}</span><span class="short">${t(SHORT[i])}</span></b>`).join('')}</div>
    <div class="sched-grid" style="height:${(last - first) * px}px">
      <div class="sched-hours">${Array.from({ length: Math.floor((last - first) / 60) + 1 }, (_, i) => first + i * 60).filter((m) => m < last).map((m) => `<span style="top:${(m - first) * px}px">${hhmm(m)}</span>`).join('')}</div>
      ${DAYS.slice(0, days).map((_, d) => `<div class="sched-day" data-day="${d}">
        ${lanes(o.classes, d).map(({ c, s, lane, of }) => `<button class="sched-class c-${c.color}${inClash(c, d, s) ? ' clashing' : ''}${of > 1 ? ' narrow' : ''}" draggable="true" data-drag="${c.id}" data-edit="${c.id}" style="top:${(s.s - first) * px}px;height:${Math.max(26, (s.e - s.s) * px)}px;--lane:${lane};--of:${of}" title="${esc(label(c))}${c.nrc ? ` · NRC ${esc(c.nrc)}` : ''}">
          <b>${esc(label(c))}</b><i class="code">${esc(shortLabel(c))}</i><small>${hhmm(s.s)}–${hhmm(s.e)}${c.room ? ` · ${esc(c.room)}` : ''}</small></button>`).join('')}
        ${clash.filter((x) => x.d === d).map((x) => `<span class="sched-clash" style="top:${(x.s - first) * px}px;height:${(x.e - x.s) * px}px"></span>`).join('')}
      </div>`).join('')}
    </div></div>`;
}
function side(o) {
  const clash = conflicts(o.classes);
  const pairs = [...new Map(clash.map((x) => [[x.a.id, x.b.id].sort().join(), x])).values()];
  return `<aside class="sched-side">
    <div class="sched-total"><span class="big">${credits(o.classes)}</span><span>créditos</span></div>
    ${pairs.length ? `<div class="sched-clashes${clashOpen ? ' open' : ''}"><button class="sched-clash-chip" data-clash-toggle aria-expanded="${clashOpen}">${pairs.length === 1 ? '1 cruce' : `${pairs.length} cruces`}</button>
      ${clashOpen ? `<ul>${pairs.map((x) => `<li>${esc(label(x.a))} <span>×</span> ${esc(label(x.b))} <small>${SHORT[x.d]} ${hhmm(x.s)}</small></li>`).join('')}</ul>` : ''}</div>` : ''}
    <ol class="sched-list">${o.classes.map((c) => {
      const miss = missingPart(c, o.classes);
      return `<li><button class="c-${c.color}" draggable="true" data-drag="${c.id}" data-edit="${c.id}"><i></i><span><b>${esc(label(c))}</b><small>${[c.code && `${esc(c.code)}${c.nrc ? ` · NRC ${esc(c.nrc)}` : ''}`, c.prof && esc(c.prof)].filter(Boolean).join(' · ')}</small>${miss ? `<em class="miss">${miss}</em>` : ''}</span><strong>${c.credits || '–'}</strong></button></li>`;
    }).join('')}</ol>
    <p class="muted small" id="sched-where"></p>
  </aside>`;
}
function pastePanel() {
  return `<div class="sched-paste glass">
    <textarea data-paste rows="2" aria-label="Pega lo que copiaste de la Oferta de cursos" placeholder="Pega aquí lo que copiaste de la Oferta de cursos: una clase o toda la búsqueda"></textarea>
    <button class="button primary" data-paste-add>Agregar</button>
    <p class="sched-ways">o <button class="link" data-add>agrégala a mano</button> · <button class="link" data-import>desde una captura o un archivo</button> · <a class="link" href="${OFFER_URL}" target="_blank" rel="noopener">abrir la Oferta de cursos ↗</a></p>
    <p class="msg" data-paste-msg role="status"></p>
  </div>`;
}
function pickerPanel() {
  if (!catalog.length) return '';
  const o = view();
  const kinds = [...new Set(catalog.map((s) => s.kind || t('Clase')))];
  const chosen = new Set(o.classes.map((c) => c.nrc));
  const partnersOf = new Set(o.classes.flatMap((c) => (c.group ? catalog.filter((s) => s.code === c.code && s.group === c.group && s.kind !== c.kind).map((s) => s.nrc) : [])));
  const row = (s) => {
    const cls = cleanClass(s, 0);
    const clashes = o.classes.some((c) => c.nrc !== s.nrc && meets(c, cls));
    return `<li><button class="sched-pick${chosen.has(s.nrc) ? ' on' : ''}${partnersOf.has(s.nrc) ? ' partner' : ''}" data-pick="${esc(s.nrc)}" ${chosen.has(s.nrc) ? 'disabled' : ''}>
      <b>${t('Paralelo')} ${esc(s.section)} <small>NRC ${esc(s.nrc)}</small></b>
      <span>${cls.slots.map((x) => `${t(SHORT[x.d])} ${hhmm(x.s)}–${hhmm(x.e)}`).join(' · ')}</span>
      <small>${[s.prof, s.room].filter(Boolean).map(esc).join(' · ')}</small>
      ${partnersOf.has(s.nrc) ? `<em class="tag">${t('de tu grupo')}</em>` : clashes ? `<em class="tag red">${t('choca')}</em>` : ''}</button></li>`;
  };
  return `<div class="sched-picker glass">
    <div class="sched-picker-head"><h3>${esc(catalog[0].code)} · ${esc(catalog[0].name)}${state.term ? ` <small>${esc(termName(state.term))}</small>` : ''}</h3><button class="link" data-picker-close>${t('Cerrar')}</button></div>
    <p class="muted small">${t('Elige un paralelo. Los ejercicios o el laboratorio que van con tu teoría aparecen marcados «de tu grupo».')}</p>
    <div class="sched-picker-cols">${kinds.map((k) => `<section><h4>${esc(k)}</h4><ol>${catalog.filter((s) => (s.kind || t('Clase')) === k).sort((a, b) => partnersOf.has(b.nrc) - partnersOf.has(a.nrc)).map(row).join('')}</ol></section>`).join('')}</div>
  </div>`;
}
function clashPrompt() {
  if (!pending) return '';
  return `<div class="sched-ask glass" role="alertdialog" aria-live="polite">
    <p><b>${esc(which(pending.cls))}</b> choca con ${pending.with.map((n) => `<b>${esc(n)}</b>`).join(', ')}.</p>
    <div class="actions"><button class="button ghost" data-ask="keep">${t('Dejar el choque')}</button><button class="button primary" data-ask="move">${t('Llevarla a un borrador nuevo')}</button></div>
  </div>`;
}

function paint() {
  const o = view();
  const has = o.classes.length > 0;
  root.innerHTML = `
  <div class="sched-modes" role="tablist">
    <button role="tab" aria-selected="${mode === 'mine'}" data-mode="mine" data-drop="mine">Mi horario</button>
    <button role="tab" aria-selected="${mode === 'prep'}" data-mode="prep">Preparar la inscripción</button>
  </div>
  ${mode === 'prep' ? pastePanel() + pickerPanel() + clashPrompt() : ''}
  ${mode === 'mine' && !has ? `<div class="sched-empty glass">
      <h3>Aún no tienes tu horario del semestre</h3>
      <p>Arma borradores en «Preparar la inscripción» y, cuando te inscribas, usa el que quedó. O agrega tus clases aquí.</p>
      <div class="actions"><button class="button primary" data-mode="prep">Preparar la inscripción</button><button class="button ghost" data-add>Agregar una clase</button></div>
    </div>` : `
  <div class="sched-bar">
    ${mode === 'prep' ? `<div class="sched-options" role="tablist" aria-label="Borradores">
      ${state.options.map((x, i) => `<button role="tab" class="sched-opt" aria-selected="${i === state.active}" data-opt="${i}" data-drop="${i}">${esc(x.name)}<small>${credits(x.classes)} cr</small></button>`).join('')}
      ${state.options.length < MAX_OPTIONS ? '<button class="sched-opt add" data-opt-add title="Otro borrador" aria-label="Otro borrador">+</button>' : ''}
    </div>` : '<span></span>'}
    <div class="sched-actions">
      ${mode === 'prep' && has ? '<button class="button ghost" data-use-mine>Usar como mi horario</button>' : ''}
      ${mode === 'mine' ? '<button class="button ghost" data-add>Agregar una clase</button>' : ''}
      <details class="sched-more"><summary class="button ghost" aria-label="Más">···</summary><div class="menu glass">
        ${mode === 'prep' ? '<button data-rename>Cambiar el nombre</button><button data-dup>Duplicar</button>' : ''}
        ${has ? '<button data-xlsx>Descargar Excel</button><button data-png>Descargar imagen</button>' : ''}
        ${mode === 'prep' && state.options.length > 1 ? '<button data-opt-remove class="danger">Quitar este borrador</button>' : ''}
        ${mode === 'mine' && has ? '<button data-mine-clear class="danger">Vaciar mi horario</button>' : ''}
      </div></details>
    </div>
  </div>
  <div class="sched-body">${week(o)}${side(o)}</div>`}`;
  paintWhere();
}

/* ---------- adding: a pasted section, a picked one, or by hand ---------- */
function addClass(raw, list = view()) {
  const cls = cleanClass(raw, list.classes.length);
  if (cls.nrc && list.classes.some((c) => c.nrc === cls.nrc)) return { added: false };
  const hits = list.classes.filter((c) => meets(c, cls));
  list.classes.push(cls);
  if (hits.length && list === state.options[state.active] && mode === 'prep') pending = { cls, with: hits.map(which) };
  save(); sfx.tick();
  return { added: true, cls };
}
function pasteAdd() {
  const box = $('[data-paste]', root); const msg = $('[data-paste-msg]', root);
  const { term, sections } = parseOffer(box.value);
  if (!sections.length) {
    msg.textContent = box.value.trim() ? t('No reconocí clases de la Oferta de cursos en ese texto. Para una captura u otro formato, usa «Otras formas».') : t('Copia en la Oferta de cursos el bloque de una clase, o toda la búsqueda, y pégalo aquí.');
    return;
  }
  if (term) state.term = term;
  box.value = '';
  if (sections.length === 1) {
    const r = addClass(sections[0]);
    catalog = [];
    paint();
    if (!r.added) $('[data-paste-msg]', root).textContent = t('Esa clase ya está en este borrador.');
    return;
  }
  catalog = sections;
  save(); paint();
}
function moveToNewDraft() {
  const from = state.options[state.active];
  const cls = pending.cls;
  if (state.options.length >= MAX_OPTIONS) { pending = null; paint(); $('[data-paste-msg]', root).textContent = t('Ya tienes seis borradores: quita uno para crear otro.'); return; }
  // The new draft keeps everything that does not meet the class, and is built around it.
  from.classes = from.classes.filter((c) => c !== cls);
  const next = { id: rid(), name: draftName(state.options.length + 1), classes: [...from.classes.filter((c) => !meets(c, cls)).map((c) => ({ ...c, id: rid() })), cls] };
  state.options.push(next); state.active = state.options.length - 1;
  pending = null; save(); paint(); sfx.chime?.();
}
// Takes a class, and the parts of its group with it, from this list to another: «pasar clases de un horario
// preliminar a otro».
function moveTo(id, target) {
  const from = view();
  const c = from.classes.find((x) => x.id === id);
  if (!c || target === from) return 0;
  const group = [c, ...from.classes.filter((x) => x !== c && x.code === c.code && c.group && x.group === c.group)];
  let n = 0;
  for (const g of group) {
    const there = target.classes.some((x) => (g.nrc && x.nrc === g.nrc) || (!g.nrc && x.name === g.name && JSON.stringify(x.slots) === JSON.stringify(g.slots)));
    if (!there) { target.classes.push({ ...g, id: rid(), slots: g.slots.map((s) => ({ ...s })) }); n += 1; }
  }
  from.classes = from.classes.filter((x) => !group.includes(x));
  save();
  return n || group.length;
}

/* ---------- a class by hand ---------- */
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
    <h2>${isNew ? 'Agregar una clase' : 'Editar la clase'}</h2>
    <label class="field"><span>Materia</span><input name="name" value="${esc(isNew ? '' : c.name)}" maxlength="80" required autocomplete="off" placeholder="Cálculo Integral"></label>
    <div class="field"><span>Días</span><div class="days">${DAYS.map((d, k) => `<label><input type="checkbox" value="${k}" ${days.includes(k) ? 'checked' : ''}><span>${SHORT[k]}</span></label>`).join('')}</div></div>
    <div class="field"><span>Hora</span><div class="blocks">${BLOCKS.map((b) => `<label><input type="radio" name="block" value="${b.s}" ${start === b.s && end === b.e ? 'checked' : ''}><span>${hhmm(b.s)}</span></label>`).join('')}</div></div>
    <details ${!isNew && (c.nrc || c.prof || c.room || extra.length || (start !== null && !BLOCKS.some((b) => b.s === start && b.e === end))) ? 'open' : ''}><summary>Más detalles</summary><div class="more">
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
      ${isNew ? '' : '<button type="button" class="link danger" data-class-remove>Quitar</button>'}</div></form>`;
  const form = $('form', dlg);
  // A block picked sets the hours; hours typed clear the block.
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
    if (!picked.length || !Number.isFinite(s) || !Number.isFinite(en) || en <= s) { e.preventDefault(); $('.msg', form).textContent = 'Elige al menos un día y una hora.'; return; }
    const next = { ...c, name: f.get('name'), credits: f.get('credits'), code: f.get('code'), nrc: f.get('nrc'), prof: f.get('prof'), room: f.get('room'), slots: [...picked.map((d) => ({ d, s, e: en })), ...extra] };
    if (isNew) addClass(next, o); else { o.classes[o.classes.findIndex((x) => x.id === c.id)] = cleanClass(next, 0); save(); }
    paint(); sfx.tick();
  });
  dlg.showModal();
}

/* ---------- from a screenshot, a photo or any file: the person's own AI ---------- */
const FORMAT = `{"options":[{"name":"Borrador 1","classes":[{"name":"Cálculo Integral","code":"MAT-1202","nrc":"4361","kind":"Teoría","prof":"","room":"H313","credits":3,"slots":[{"day":"Martes","start":"08:30","end":"09:50"}]}]}]}`;
const SYSTEM = `Lees el horario de clases de un estudiante universitario, en cualquier formato (captura de pantalla, foto, hoja de cálculo, PDF o texto), y lo devuelves en JSON.
Reglas:
- Devuelve SOLO un objeto JSON, sin texto antes ni después, con esta forma: ${FORMAT}
- Si el documento muestra varias alternativas de horario, cada una es una opción en "options", con el nombre que tenga en el documento. Si hay una sola, devuelve una sola opción.
- day: Lunes, Martes, Miércoles, Jueves, Viernes o Sábado. start y end en 24 h, "HH:MM".
- Una clase que se repite en varios días lleva un slot por día. Ejercicios o laboratorio con su propio NRC son otra clase, con su kind.
- Copia código, NRC, profe y aula solo si aparecen; si no, déjalos vacíos. No inventes nada. credits: el número si aparece; si no, 3 para materias normales y 0 para ejercicios, laboratorios y niveles de inglés.
- Si el código y el NRC aparecen juntos (por ejemplo "CMP-4005.1652"), sepáralos.`;
function importDialog() {
  const dlg = $('#sched-dialog');
  const ready = ai.ready();
  dlg.innerHTML = `<form method="dialog" class="sched-form import">
    <h2>${t('Desde una captura, foto o archivo')}</h2>
    <p class="muted">${t('Una captura de la página de la U, una foto, un Excel, un PDF o texto copiado. Lo lee tu navegador y tu IA; el archivo no se sube a Studium. Revisas el resultado antes de guardarlo.')}</p>
    <label class="drop"><input type="file" accept="image/*,.pdf,.xlsx,.csv,.txt,.tsv" multiple data-files><span>${t('Elige archivos o arrástralos aquí')}</span></label>
    <label class="field"><span>${t('O pega el texto')}</span><textarea data-text rows="4"></textarea></label>
    ${ready ? ai.pickerHTML('identify') : `<p class="muted">${t('Sin una IA conectada también se puede: copia las instrucciones, llévalas con tu archivo a cualquier chat (Claude, ChatGPT, Gemini…) y pega aquí lo que te responda.')}</p>`}
    <div class="actions">${ready ? `<button type="button" class="button primary" data-read>${t('Leerlo con mi IA')}</button>` : ''}
      <button type="button" class="button ${ready ? 'ghost' : 'primary'}" data-copy>${t('Copiar instrucciones para un chat')}</button></div>
    <label class="field"><span>${t('Respuesta del chat (si usaste uno)')}</span><textarea data-answer rows="3" placeholder='{"options": …}'></textarea></label>
    <p class="msg" role="alert"></p>
    <div class="preview" data-preview></div>
    <div class="actions"><button type="button" class="button primary" data-use hidden>${t('Usar esto')}</button><button class="button ghost" value="cancel" formnovalidate>${t('Cerrar')}</button></div>
  </form>`;
  const form = $('form', dlg); const msg = $('.msg', form);
  let found = null;
  const show = (raw) => {
    found = clean(raw);
    const n = found.options.reduce((s, o) => s + o.classes.length, 0);
    if (!n) { msg.textContent = t('No encontré clases en eso. Prueba con una captura más nítida o pega el texto.'); found = null; return; }
    msg.textContent = '';
    $('[data-preview]', form).innerHTML = found.options.map((o) => `<div><b>${esc(o.name)}</b> · ${credits(o.classes)} cr<ul>${o.classes.map((c) => `<li>${esc(label(c))} <small>${c.slots.map((s) => `${t(SHORT[s.d])} ${hhmm(s.s)}–${hhmm(s.e)}`).join(', ')}</small></li>`).join('')}</ul></div>`).join('');
    $('[data-use]', form).hidden = false;
  };
  const parse = (txt) => { const m = String(txt).match(/\{[\s\S]*\}/); if (!m) throw new Error('json'); return JSON.parse(m[0]); };
  const gather = async () => {
    const files = [...($('[data-files]', form).files ?? [])];
    const parts = [];
    for (const f of files) {
      if (/\.xlsx$/i.test(f.name)) { const { unzip, officeText } = await import('./files.js'); parts.push({ name: f.name, type: 'text/plain', text: await officeText(await unzip(f), 'xlsx') }); } else parts.push(await ai.readFile(f));
    }
    return { parts: parts.filter((p) => !p.skipped), skipped: parts.filter((p) => p.skipped), text: $('[data-text]', form).value.trim() };
  };
  form.addEventListener('input', (e) => {
    if (!e.target.matches('[data-answer]') || !e.target.value.trim()) return;
    try { show(parse(e.target.value)); } catch { msg.textContent = t('Eso no parece la respuesta del chat: pega todo lo que te devolvió.'); }
  });
  form.addEventListener('click', async (e) => {
    if (e.target.closest('[data-copy]')) {
      const { text: txt } = await gather();
      try { await navigator.clipboard.writeText(`${SYSTEM}\n\n${txt ? `Mi horario:\n${txt}` : 'Mi horario está en el archivo que adjunto.'}`); msg.textContent = t('Copiado. Llévalo a tu chat junto con tu archivo, y pega aquí la respuesta.'); } catch { msg.textContent = t('No se pudo copiar.'); }
    }
    if (e.target.closest('[data-read]')) {
      const btn = e.target.closest('[data-read]');
      const { parts, skipped, text: txt } = await gather();
      if (!parts.length && !txt) { msg.textContent = t('Elige un archivo o pega el texto primero.'); return; }
      btn.disabled = true; msg.textContent = t('Tu IA está leyendo tu horario…');
      try {
        const res = await ai.run({ system: SYSTEM, text: txt ? `Mi horario:\n${txt}` : 'Mi horario está en lo adjunto.', files: parts, maxTokens: 6000, use: ai.picked('identify', form), task: 'identify' });
        show(parse(res.text));
        if (skipped.length) msg.textContent = `${t('No se leyó')}: ${skipped.map((s) => `${s.name} (${s.skipped})`).join(', ')}`;
      } catch (error) { msg.textContent = error instanceof ai.AIError ? error.message : t('No se pudo leer. Prueba con otra IA o con el chat.'); } finally { btn.disabled = false; }
    }
    if (e.target.closest('[data-use]') && found) {
      if (mode === 'mine') {
        // In «Mi horario», what comes in joins the week (its first option, if it brought several).
        for (const c of found.options[0].classes) addClass(c, state.mine);
      } else {
        // As new drafts next to the ones already there, never over them.
        const empty = state.options.length === 1 && !state.options[0].classes.length;
        const incoming = found.options.slice(0, Math.max(1, MAX_OPTIONS - (empty ? 0 : state.options.length)));
        state.options = empty ? incoming : [...state.options, ...incoming].slice(0, MAX_OPTIONS);
        state.active = empty ? 0 : state.options.length - incoming.length;
      }
      save(); dlg.close(); paint(); sfx.chime?.();
    }
  });
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
const fileName = (o) => `horario-${o.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}`;
async function downloadXlsx() {
  const o = view();
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) ? 6 : 5;
  const starts = [...new Set([...BLOCKS.map((b) => b.s), ...o.classes.flatMap((c) => c.slots.map((s) => s.s))])].sort((a, b) => a - b);
  const title = mode === 'mine' ? 'Mi horario' : o.name;
  const weekRows = [[`${title}${state.term ? ` · ${termName(state.term)}` : ''}`], ['Hora', ...DAYS.slice(0, days)],
    ...starts.map((s) => {
      const end = BLOCKS.find((b) => b.s === s)?.e ?? s + 80;
      return [`${hhmm(s)}–${hhmm(end)}`, ...DAYS.slice(0, days).map((_, d) => o.classes.filter((c) => c.slots.some((x) => x.d === d && x.s < end && x.e > s)).map((c) => `${label(c)}${c.room ? ` [${c.room}]` : ''}`).join(' / '))];
    })];
  const list = [['Materia', 'Tipo', 'Código', 'NRC', 'Créditos', 'Profe', 'Aula', 'Horario'],
    ...o.classes.map((c) => [c.name, c.kind, c.code, c.nrc, c.credits, c.prof, c.room, c.slots.map((s) => `${SHORT[s.d]} ${hhmm(s.s)}–${hhmm(s.e)}`).join(', ')]),
    [], ['Total', '', '', '', credits(o.classes)]];
  const enc = (s) => new TextEncoder().encode(s);
  const { zipFiles } = await import('./files.js');
  const blob = zipFiles([
    { name: '[Content_Types].xml', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Semana" sheetId="1" r:id="rId1"/><sheet name="Clases" sheetId="2" r:id="rId2"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', bytes: enc(sheetXML(weekRows, [14, ...Array(days).fill(30)])) },
    { name: 'xl/worksheets/sheet2.xml', bytes: enc(sheetXML(list, [32, 12, 12, 8, 9, 28, 10, 40])) },
  ]);
  give(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName({ name: title })}.xlsx`);
}
async function downloadPng() {
  const o = view();
  const title = mode === 'mine' ? t('Mi horario') : o.name;
  const days = o.classes.some((c) => c.slots.some((s) => s.d === 5)) ? 6 : 5;
  const first = Math.min(420, ...o.classes.flatMap((c) => c.slots.map((s) => s.s)));
  const last = Math.max(1140, ...o.classes.flatMap((c) => c.slots.map((s) => s.e)));
  const css = getComputedStyle(document.documentElement); const v = (n) => css.getPropertyValue(n).trim();
  const W = 1400; const left = 90; const top = 150; const colW = (W - left - 40) / days; const px = 1.25;
  const H = top + (last - first) * px + 50;
  const cv = Object.assign(document.createElement('canvas'), { width: W * 2, height: H * 2 });
  const g = cv.getContext('2d'); g.scale(2, 2);
  g.fillStyle = '#fffdf8'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(36,83,230,.16)'; g.lineWidth = 1;
  for (let m = Math.ceil(first / 30) * 30; m <= last; m += 30) { const y = top + (m - first) * px; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(226,59,43,.5)'; g.beginPath(); g.moveTo(left - 10, 0); g.lineTo(left - 10, H); g.stroke();
  g.fillStyle = '#131722'; g.font = '800 34px "Bricolage Grotesque", system-ui, sans-serif'; g.fillText(title, left, 52);
  g.font = '600 15px "Atkinson Hyperlegible Next", system-ui, sans-serif'; g.fillStyle = '#676e82';
  g.fillText(`${credits(o.classes)} ${t('créditos')}${state.term ? ` · ${termName(state.term)}` : ''}`, left, 82);
  g.fillStyle = '#131722'; g.font = '700 16px "Bricolage Grotesque", system-ui, sans-serif';
  DAYS.slice(0, days).forEach((d, i) => g.fillText(t(d), left + i * colW + 8, top - 14));
  g.fillStyle = '#676e82'; g.font = '600 13px "Atkinson Hyperlegible Next", system-ui, sans-serif';
  for (let m = Math.ceil(first / 60) * 60; m < last; m += 60) g.fillText(hhmm(m), 18, top + (m - first) * px + 4);
  for (let d = 0; d < days; d += 1) {
    for (const { c, s, lane, of } of lanes(o.classes, d)) {
      const col = v(`--${c.color}`) || '#2453e6';
      const w = (colW - 8) / of - (of > 1 ? 4 : 0); const x = left + s.d * colW + 4 + lane * (w + (of > 1 ? 4 : 0)); const y = top + (s.s - first) * px + 2; const h = (s.e - s.s) * px - 4;
      g.fillStyle = col; g.globalAlpha = 0.18; roundRect(g, x, y, w, h, 12); g.fill(); g.globalAlpha = 1;
      g.fillStyle = col; roundRect(g, x, y, 6, h, 3); g.fill();
      g.fillStyle = '#131722'; g.font = '700 15px "Bricolage Grotesque", system-ui, sans-serif'; wrap(g, label(c), x + 14, y + 22, w - 20, 18, Math.max(1, Math.floor((h - 26) / 18)));
      g.fillStyle = '#343b4c'; g.font = '600 12px "Atkinson Hyperlegible Next", system-ui, sans-serif'; g.fillText(`${hhmm(s.s)}–${hhmm(s.e)}${c.room ? ` · ${c.room}` : ''}`, x + 14, y + h - 10);
    }
  }
  cv.toBlob((b) => give(b, `${fileName({ name: title })}.png`), 'image/png');
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

/* ---------- a draft's name, taking one away, and «Mi horario» from a draft ---------- */
function confirmDialog(what) {
  const o = view(); const dlg = $('#sched-dialog');
  const forms = {
    rename: `<h2>${t('Nombre de este borrador')}</h2><label class="field"><span>${t('Nombre')}</span><input name="name" value="${esc(o.name)}" maxlength="24" required></label>
      <div class="actions"><button class="button primary" value="save">${t('Guardar')}</button><button class="button ghost" value="cancel" formnovalidate>${t('Cancelar')}</button></div>`,
    remove: `<h2>${t('¿Quitar')} ${esc(o.name)}?</h2><p class="muted">${o.classes.length ? `${o.classes.length} ${t('clases se van con él.')}` : t('No tiene clases.')}</p>
      <div class="actions"><button class="button primary red" value="save">${t('Quitarlo')}</button><button class="button ghost" value="cancel" formnovalidate>${t('Cancelar')}</button></div>`,
    mine: `<h2>${t('¿Usar')} ${esc(o.name)} ${t('como tu horario?')}</h2><p class="muted">${t('Reemplaza las clases que tienes en «Mi horario». Tus borradores se quedan como están.')}</p>
      <div class="actions"><button class="button primary" value="save">${t('Usarlo')}</button><button class="button ghost" value="cancel" formnovalidate>${t('Cancelar')}</button></div>`,
    clear: `<h2>${t('¿Vaciar tu horario?')}</h2><p class="muted">${t('Se quitan todas sus clases. Tus borradores se quedan como están.')}</p>
      <div class="actions"><button class="button primary red" value="save">${t('Vaciarlo')}</button><button class="button ghost" value="cancel" formnovalidate>${t('Cancelar')}</button></div>`,
  };
  const useMine = () => { state.mine.classes = o.classes.map((c) => ({ ...c, id: rid(), slots: c.slots.map((s) => ({ ...s })) })); mode = 'mine'; };
  if (what === 'mine' && !state.mine.classes.length) { useMine(); save(); paint(); sfx.chime?.(); return; }
  dlg.innerHTML = `<form method="dialog" class="sched-form small">${forms[what]}</form>`;
  $('form', dlg).addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    if (what === 'rename') o.name = String(new FormData(e.target).get('name')).trim().slice(0, 24) || o.name;
    if (what === 'remove') { state.options.splice(state.active, 1); state.active = Math.max(0, state.active - 1); }
    if (what === 'mine') useMine();
    if (what === 'clear') state.mine.classes = [];
    save(); paint();
  });
  dlg.showModal();
}

/* ---------- events ---------- */
export function mountSchedule() {
  document.addEventListener('click', (e) => {
    if (!root || !root.contains(e.target)) return;
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    b.closest('details')?.removeAttribute('open');
    const d = b.dataset;
    if (d.mode) { mode = d.mode; catalog = mode === 'prep' ? catalog : []; pending = null; paint(); sfx.tick(); return; }
    if (d.opt !== undefined) { state.active = Number(d.opt); pending = null; save(); paint(); sfx.tick(); return; }
    if ('optAdd' in d) { state.options.push(blankDraft(state.options.length + 1)); state.active = state.options.length - 1; save(); paint(); return; }
    if ('dup' in d) { const o = view(); state.options.push({ id: rid(), name: `${o.name} (2)`.slice(0, 24), classes: o.classes.map((c) => ({ ...c, id: rid(), slots: c.slots.map((s) => ({ ...s })) })) }); state.active = state.options.length - 1; save(); paint(); return; }
    if ('rename' in d) return confirmDialog('rename');
    if ('optRemove' in d) return confirmDialog('remove');
    if ('useMine' in d) return confirmDialog('mine');
    if ('mineClear' in d) return confirmDialog('clear');
    if ('xlsx' in d) return void downloadXlsx();
    if ('png' in d) return void downloadPng();
    if ('add' in d) return classDialog(null);
    if ('import' in d) return importDialog();
    if ('pasteAdd' in d) return pasteAdd();
    if ('pickerClose' in d) { catalog = []; paint(); return; }
    if (d.pick) { const s = catalog.find((x) => x.nrc === d.pick); if (s) { addClass(s); paint(); } return; }
    if ('clashToggle' in d) { clashOpen = !clashOpen; paint(); return; }
    if (d.ask) { if (d.ask === 'move') moveToNewDraft(); else { pending = null; paint(); } return; }
    if (d.edit) classDialog(d.edit);
  });
  // Pasting into the box adds at once: the button is there for those who look for it.
  document.addEventListener('paste', (e) => {
    if (!root?.contains(e.target) || !e.target.matches('[data-paste]')) return;
    setTimeout(() => { if (parseOffer(e.target.value).sections.length) pasteAdd(); }, 0);
  });
  // Dragging a class onto another draft's tab, or onto «Mi horario», copies it there with its group.
  let dragged = null;
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-drag]');
    if (!el || !root?.contains(el)) return;
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
    const target = tgt.dataset.drop === 'mine' ? state.mine : state.options[Number(tgt.dataset.drop)];
    const n = moveTo(dragged, target);
    dragged = null; root.classList.remove('dragging');
    paint();
    const msg = $('[data-paste-msg]', root); if (msg) msg.textContent = `${n === 1 ? 'Pasada' : 'Pasadas'} a ${target === state.mine ? 'Mi horario' : target.name}.`;
    if (n) sfx.chime?.();
  });
}
// For the home: the classes of «Mi horario».
export async function weekClasses() {
  await load();
  return state.mine.classes;
}
