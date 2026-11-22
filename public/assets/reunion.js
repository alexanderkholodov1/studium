// «¿Cuándo nos reunimos?» inside a trabajo (docs/v0.6.0.md §6, for a group): each member paints when they can on a week
// grid, as in when2meet (dragging), or fills it from their Studium schedule; the group's grid shows how many can at
// each half hour; «Las mejores horas» are computed here, deterministically; anyone proposes an hour and each member
// says yes or no. An hour everyone accepted is fixed, and each person adds it to «Fechas y entregas».
// Data (firestore.rules, «Trabajos»): trabajos/{tid}/disponible/{uid} {weeks: {'YYYY-MM-DD': [slot…]}} and
// trabajos/{tid}/reunion/{pid} {week, slot, len, by, si: [uid…], no: [uid…]}.
import {
  doc, getDocs, setDoc, deleteDoc, collection, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db, auth, loadSchedule } from './data.js';
import { prefs } from './prefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => auth.currentUser?.uid ?? '';
const FROM = 7 * 60; // 7:00
const ROWS = 30; // half hours until 22:00
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const LENS = [[2, '1 hora'], [1, '30 min'], [3, '1 h 30'], [4, '2 horas']];
const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const timeOf = (slot) => hhmm(FROM + (slot % ROWS) * 30);
const dayOf = (slot) => Math.floor(slot / ROWS);

// Weeks start on Monday, in the person's own time.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monday(d = new Date()) { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return x; };
const dateOf = (week, slot) => addDays(week, dayOf(slot));
const dayName = (week, slot) => { const d = dateOf(week, slot); return `${DAYS[dayOf(slot)].toLowerCase()} ${d.getDate()}`; };
const weekLabel = (week) => { const a = addDays(week, 0); const b = addDays(week, 6); const mo = (d) => d.toLocaleDateString('es', { month: 'short' }).replace('.', ''); return `${a.getDate()} ${mo(a)} – ${b.getDate()} ${mo(b)}`; };

let R = null; // { tid, week, all: {uid: {week: [..]}}, props: [], loading, sel: slot|null, len }
let repaint = () => {};
let tRef = null;
let members = () => [];

export function resetReunion() { R = null; }
async function load(T) {
  // From Saturday on, the week that matters is the next one.
  const start = monday(); if ([0, 6].includes(new Date().getDay())) start.setDate(start.getDate() + 7);
  R = { tid: T.id, week: iso(start), all: {}, props: [], loading: true, sel: null, len: 2, error: '' };
  try {
    const [disp, props] = await Promise.all([getDocs(collection(db, 'trabajos', T.id, 'disponible')), getDocs(collection(db, 'trabajos', T.id, 'reunion'))]);
    for (const d of disp.docs) R.all[d.id] = d.data().weeks ?? {};
    R.props = props.docs.map((p) => ({ id: p.id, ...p.data() }));
  } catch (e) { console.warn('reunion', e); R.error = 'No pude cargar las disponibilidades. Recarga la página.'; }
  R.loading = false;
  repaint();
}
const mine = () => new Set(R.all[uid()]?.[R.week] ?? []);
// How many members can at each slot of the week shown, and who.
function counts() {
  const ms = members();
  const n = new Array(7 * ROWS).fill(0);
  const who = Array.from({ length: 7 * ROWS }, () => []);
  for (const m of ms) for (const s of R.all[m.uid]?.[R.week] ?? []) { if (s >= 0 && s < n.length) { n[s] += 1; who[s].push(m.name); } }
  return { n, who, marked: ms.filter((m) => (R.all[m.uid]?.[R.week] ?? []).length) };
}
// The best windows of the chosen length: the most members free for the whole window, earliest first; never across days.
function best(len) {
  const { n } = counts();
  const out = [];
  for (let d = 0; d < 7; d += 1) {
    for (let r = 0; r + len <= ROWS; r += 1) {
      const s = d * ROWS + r;
      const at = dateOf(R.week, s); at.setMinutes(FROM + r * 30);
      if (at < new Date()) continue;
      const k = Math.min(...Array.from({ length: len }, (_, i) => n[s + i]));
      if (k > 0) out.push({ slot: s, k });
    }
  }
  out.sort((a, b) => b.k - a.k || a.slot - b.slot);
  const picked = [];
  for (const o of out) { if (picked.length >= 4) break; if (!picked.some((p) => dayOf(p.slot) === dayOf(o.slot) && Math.abs(p.slot - o.slot) < len)) picked.push(o); }
  return picked;
}

function grid(kind, set, c) {
  const total = Math.max(1, members().length);
  return `<div class="rn-grid" data-rn-grid="${kind}" role="grid" aria-label="${kind === 'me' ? 'Cuándo puedes tú' : 'Cuándo puede el grupo'}">
    <span></span>${SHORT.map((d, i) => `<b>${d}<small>${addDays(R.week, i).getDate()}</small></b>`).join('')}
    ${Array.from({ length: ROWS }, (_, r) => `<span class="rn-h">${r % 2 ? '' : hhmm(FROM + r * 30)}</span>${Array.from({ length: 7 }, (_, d) => {
    const s = d * ROWS + r;
    if (kind === 'me') return `<i data-rn-slot="${s}" class="${set.has(s) ? 'on' : ''}"></i>`;
    const k = c.n[s];
    const selected = R.sel !== null && s >= R.sel && s < R.sel + R.len && dayOf(s) === dayOf(R.sel);
    return `<i data-rn-pick="${s}" class="${selected ? 'sel' : ''}" style="--k:${(k / total).toFixed(2)}" title="${esc(`${DAYS[d]} ${hhmm(FROM + r * 30)}: ${k} de ${total}${k ? ` (${c.who[s].join(', ')})` : ''}`)}"></i>`;
  }).join('')}`).join('')}
  </div>`;
}

function proposalHTML(p) {
  const ms = members();
  const yes = ms.filter((m) => (p.si ?? []).includes(m.uid));
  const no = ms.filter((m) => (p.no ?? []).includes(m.uid));
  const fixed = ms.length > 0 && yes.length === ms.length;
  const me = uid();
  const when = `${dayName(p.week, p.slot)} · ${timeOf(p.slot)}–${hhmm(FROM + ((p.slot % ROWS) + p.len) * 30)}`;
  return `<li class="rn-prop ${fixed ? 'fixed' : ''}">
    <div><b>${esc(when)}</b> <small>${esc(weekLabel(p.week))}</small><br>
      <small>${fixed ? '✓ Fijada: todos pueden' : `${yes.length} de ${ms.length} dijeron que sí${no.length ? ` · no pueden: ${no.map((m) => esc(m.name)).join(', ')}` : ''}`}</small></div>
    <span class="rn-vote">${fixed
    ? `<button type="button" class="button primary small" data-rn="add-date" data-id="${esc(p.id)}">Agregar a mis fechas</button>`
    : `<button type="button" class="button small ${(p.si ?? []).includes(me) ? 'primary' : 'ghost'}" data-rn="si" data-id="${esc(p.id)}">Puedo</button><button type="button" class="button small ${(p.no ?? []).includes(me) ? 'red' : 'ghost'}" data-rn="no" data-id="${esc(p.id)}">No puedo</button>`}
    ${p.by === me ? `<button type="button" class="link mut" data-rn="drop" data-id="${esc(p.id)}">quitar</button>` : ''}</span>
  </li>`;
}

// The section of the guide. It paints from what is loaded; the first time it loads and repaints.
export function reunionSection(T, { repaint: rp, ref, people }) {
  repaint = rp; tRef = ref; members = people;
  if (R?.tid === T.id) R.title = T.title;
  if (!R || R.tid !== T.id) { load(T); return `<section class="sec" id="cap-reunion" style="--c:var(--green);--cs:var(--green-s)"><h2><span class="n">◷</span>¿Cuándo nos reunimos?</h2><p class="mut">Cargando…</p></section>`; }
  const c = counts();
  const ms = members();
  const missing = ms.filter((m) => !(R.all[m.uid]?.[R.week] ?? []).length);
  const props = R.props.filter((p) => p.week >= iso(monday())).sort((a, b) => a.week.localeCompare(b.week) || a.slot - b.slot);
  const tops = best(R.len).filter((o) => !R.props.some((p) => p.week === R.week && p.slot === o.slot && p.len === R.len)).slice(0, 3);
  return `<section class="sec" id="cap-reunion" style="--c:var(--green);--cs:var(--green-s)">
    <h2><span class="n">◷</span>¿Cuándo nos reunimos?</h2>
    <p>Si el trabajo pide reunirse (para repartir, juntar las partes o ensayar la defensa), cada uno marca cuándo puede y Studium encuentra la hora. Sin encuestas en el chat.</p>
    ${R.error ? `<p class="tj-warn">${esc(R.error)}</p>` : ''}
    <div class="rn-week"><button type="button" class="ask" data-rn="week" data-d="-7" aria-label="Semana anterior">←</button><b>Semana del ${esc(weekLabel(R.week))}</b><button type="button" class="ask" data-rn="week" data-d="7" aria-label="Semana siguiente">→</button>
      <span class="mut small">${missing.length ? `Falta que marquen: ${missing.map((m) => esc(m.name)).join(', ')}` : 'Todos marcaron esta semana'}</span></div>
    <div class="rn-two">
      <div><h3>Cuándo puedes tú</h3><p class="small mut">Arrastra para marcar las horas en que puedes; arrastra sobre lo marcado para quitarlo. Se guarda solo. <button type="button" class="ask" data-rn="fill">Llenar con mi horario de Studium</button> <button type="button" class="ask" data-rn="clear">Borrar mi semana</button></p>
        ${grid('me', mine(), c)}<p class="small mut" data-rn-status role="status">${esc(R.note ?? '')}</p></div>
      <div><h3>Cuándo puede el grupo</h3><p class="small mut">Más oscuro, más pueden (${c.marked.length} de ${ms.length} marcaron). Pulsa una hora para proponerla.</p>
        ${grid('group', null, c)}</div>
    <div class="rn-plan">
      <div><h3>Propuestas</h3>${props.length ? `<ul class="rn-props">${props.map(proposalHTML).join('')}</ul>` : '<p class="small mut">Todavía no hay. Propón una de las mejores horas.</p>'}</div>
      <div><h3>Las mejores horas</h3>
        <p class="small">Duración: ${LENS.map(([l, t]) => `<button type="button" class="ask ${R.len === l ? 'on' : ''}" data-rn="len" data-l="${l}">${t}</button>`).join(' ')}</p>
        ${tops.length ? `<ul class="rn-best">${tops.map((o) => `<li><span><b>${esc(dayName(R.week, o.slot))}</b> ${timeOf(o.slot)}–${hhmm(FROM + ((o.slot % ROWS) + R.len) * 30)} · <small>${o.k === ms.length ? 'pueden todos' : `pueden ${o.k} de ${ms.length}`}</small></span><button type="button" class="ask" data-rn="propose" data-s="${o.slot}">Proponer</button></li>`).join('')}</ul>` : '<p class="small mut">Cuando marquen sus horas, aquí aparecen las mejores.</p>'}
        ${R.sel !== null ? `<p class="small">Elegiste <b>${esc(dayName(R.week, R.sel))} ${timeOf(R.sel)}</b>. <button type="button" class="act" data-rn="propose" data-s="${R.sel}">Proponer esta hora</button></p>` : ''}
      </div>
    </div>
    </div>
  </section>`;
}

/* ---------- what the person does ---------- */
let painting = null; // { add: bool, changed: Set }
let saveTimer = 0;
const status = (root, t) => { if (R) R.note = t; const el = root.querySelector('[data-rn-status]'); if (el) el.textContent = t; };
async function saveMine(root) {
  const weeks = { ...(R.all[uid()] ?? {}) };
  // Only the weeks that are not past are kept, at most eight.
  const now = iso(monday());
  for (const k of Object.keys(weeks)) if (k < now || !weeks[k]?.length) delete weeks[k];
  const keys = Object.keys(weeks).sort().slice(0, 8);
  const keep = Object.fromEntries(keys.map((k) => [k, [...new Set(weeks[k])].sort((a, b) => a - b)]));
  R.all[uid()] = keep;
  status(root, 'Guardando…');
  try { await setDoc(tRef(R.tid, 'disponible', uid()), { weeks: keep, updated: serverTimestamp() }); status(root, 'Guardado.'); } catch (e) { console.warn(e); status(root, 'No se pudo guardar. Revisa tu conexión y vuelve a marcar.'); }
}
function setMine(set) { R.all[uid()] = { ...(R.all[uid()] ?? {}), [R.week]: [...set] }; }

// Free = every half hour from 7:00 to 22:00 that is not a class of the person's schedule in Studium.
async function fromSchedule() {
  const s = await loadSchedule(uid()).catch(() => null);
  const o = s?.mine?.classes?.length ? s.mine : s?.options?.[s.active ?? 0];
  const classes = o?.classes ?? [];
  if (!classes.length) return null;
  const free = new Set();
  for (let d = 0; d < 7; d += 1) {
    for (let r = 0; r < ROWS; r += 1) {
      const a = FROM + r * 30; const b = a + 30;
      if (!classes.some((c) => (c.slots ?? []).some((x) => x.d === d && Math.max(x.s, a) < Math.min(x.e, b)))) free.add(d * ROWS + r);
    }
  }
  return free;
}

export function wireReunion(root, toast) {
  const cell = (ev) => ev.target.closest?.('[data-rn-slot]');
  root.addEventListener('pointerdown', (ev) => {
    const c = cell(ev);
    if (!c || !R) return;
    ev.preventDefault();
    painting = { add: !c.classList.contains('on') };
    c.classList.toggle('on', painting.add);
  });
  root.addEventListener('pointerover', (ev) => { const c = cell(ev); if (c && painting) c.classList.toggle('on', painting.add); });
  const end = () => {
    if (!painting || !R) return;
    painting = null;
    const g = root.querySelector('[data-rn-grid="me"]');
    if (!g) return;
    setMine(new Set([...g.querySelectorAll('[data-rn-slot].on')].map((x) => Number(x.dataset.rnSlot))));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { await saveMine(root); const y = root.closest('#view-trabajo')?.scrollTop; repaint(); if (y !== undefined) root.closest('#view-trabajo').scrollTop = y; }, 500);
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest?.('[data-rn], [data-rn-pick]');
    if (!b || !R) return;
    if (b.dataset.rnPick !== undefined) { R.sel = Number(b.dataset.rnPick); if ((R.sel % ROWS) + R.len > ROWS) R.sel = dayOf(R.sel) * ROWS + ROWS - R.len; repaint(); return; }
    const kind = b.dataset.rn;
    const busy = async (fn) => { b.disabled = true; try { await fn(); } catch (e) { console.warn(e); toast(e.message || 'No se pudo: inténtalo otra vez.'); } finally { b.disabled = false; repaint(); } };
    if (kind === 'week') { const d = addDays(R.week, Number(b.dataset.d)); const k = iso(d); if (k >= iso(monday())) { R.week = k; R.sel = null; repaint(); } else toast('Esa semana ya pasó.'); return; }
    if (kind === 'len') { R.len = Number(b.dataset.l); R.sel = null; repaint(); return; }
    if (kind === 'fill') {
      await busy(async () => {
        const free = await fromSchedule();
        if (!free) { toast('Todavía no tienes tu horario en Studium: ármalo en Inicio → Mi horario, o marca aquí a mano.'); return; }
        setMine(free); await saveMine(root); toast('Marqué como libre todo lo que no es clase, de 7:00 a 22:00. Quita lo que no puedas.');
      });
      return;
    }
    if (kind === 'clear') { await busy(async () => { setMine(new Set()); await saveMine(root); }); return; }
    if (kind === 'propose') {
      await busy(async () => {
        const slot = Number(b.dataset.s);
        if (R.props.some((p) => p.week === R.week && p.slot === slot && p.len === R.len)) { toast('Esa hora ya está propuesta.'); return; }
        if (R.props.length >= 12) { toast('Hay muchas propuestas: quita alguna antes.'); return; }
        const ref = doc(collection(db, 'trabajos', R.tid, 'reunion'));
        const p = { week: R.week, slot, len: R.len, by: uid(), si: [uid()], no: [] };
        await setDoc(ref, { ...p, updated: serverTimestamp() });
        R.props.push({ id: ref.id, ...p }); R.sel = null;
        toast('Propuesta. Cada uno dice si puede.');
      });
      return;
    }
    const p = R.props.find((x) => x.id === b.dataset.id);
    if (!p) return;
    if (kind === 'si' || kind === 'no') {
      await busy(async () => {
        const si = new Set(p.si ?? []); const no = new Set(p.no ?? []);
        if (kind === 'si') { no.delete(uid()); if (si.has(uid())) si.delete(uid()); else si.add(uid()); } else { si.delete(uid()); if (no.has(uid())) no.delete(uid()); else no.add(uid()); }
        await setDoc(tRef(R.tid, 'reunion', p.id), { si: [...si], no: [...no], updated: serverTimestamp() }, { merge: true });
        p.si = [...si]; p.no = [...no];
      });
      return;
    }
    if (kind === 'drop') { await busy(async () => { await deleteDoc(tRef(R.tid, 'reunion', p.id)); R.props = R.props.filter((x) => x !== p); }); return; }
    if (kind === 'add-date') {
      const date = iso(dateOf(p.week, p.slot));
      const text = `Reunión ${timeOf(p.slot)}: ${R.title ?? 'trabajo'}`.slice(0, 120);
      const list = prefs.get().deadlines ?? [];
      if (list.some((d) => d.date === date && d.text === text)) { toast('Ya está en tus fechas.'); return; }
      prefs.set({ deadlines: [...list, { id: `r${Date.now().toString(36)}`, text, date }] });
      toast('Agregada a «Fechas y entregas» en tu Inicio.');
    }
  });
}
