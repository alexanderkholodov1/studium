// «¿Cuándo nos reunimos?» inside a trabajo's guide, where the AI says the group must work together (a step with
// «reunion»), or at «Entregar y defender» when no step says so. ONE timeline (his words): the week, with layers each
// person turns on and off — my classes, and each teammate (what they shared of their schedule, and the hours they
// marked) — on which I mark when I can (dragging, as in when2meet) or choose the hour to propose. The best hours are
// computed here, deterministically; each member says yes or no to a proposal; one everyone accepts is fixed and goes
// to «Fechas y entregas».
// Sharing one's schedule is chosen per trabajo: not at all (default), only the busy hours, or in detail (with the
// classes' names). Only the group reads it.
// Data (firestore.rules, «Trabajos»): trabajos/{tid}/disponible/{uid} {weeks: {'YYYY-MM-DD': [slot…]}, share, busy:
// [{d, s, e, n?}]} and trabajos/{tid}/reunion/{pid} {week, slot, len, by, si: [uid…], no: [uid…]}.
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
const COLORS = ['#2563c9', '#c23149', '#23875a', '#d06a10', '#7b4bb7', '#8a5a3a', '#0e7490', '#b45309'];
const SHARES = { none: 'No compartir mi horario', busy: 'Solo mis horas ocupadas', detail: 'Mi horario detallado (con las materias)' };
const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const timeOf = (slot) => hhmm(FROM + (slot % ROWS) * 30);
const endOf = (slot, len) => hhmm(FROM + ((slot % ROWS) + len) * 30);
const dayOf = (slot) => Math.floor(slot / ROWS);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function monday(d = new Date()) { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return x; };
const dateOf = (week, slot) => addDays(week, dayOf(slot));
const dayName = (week, slot) => `${DAYS[dayOf(slot)].toLowerCase()} ${dateOf(week, slot).getDate()}`;
const weekLabel = (week) => { const a = addDays(week, 0); const b = addDays(week, 6); const mo = (d) => d.toLocaleDateString('es', { month: 'short' }).replace('.', ''); return `${a.getDate()} ${mo(a)} – ${b.getDate()} ${mo(b)}`; };
// A block of a schedule {d, s, e} covers the half hour of a slot.
const covers = (b, slot) => b.d === dayOf(slot) && Math.max(b.s, FROM + (slot % ROWS) * 30) < Math.min(b.e, FROM + (slot % ROWS) * 30 + 30);

let R = null;
let repaint = () => {};
let tRef = null;
let members = () => [];

export function resetReunion() { R = null; }
async function load(T) {
  const start = monday(); if ([0, 6].includes(new Date().getDay())) start.setDate(start.getDate() + 7);
  R = { tid: T.id, title: T.title, week: iso(start), all: {}, props: [], sel: null, len: 2, mode: 'paint', off: new Set(), classes: null, note: '', error: '' };
  try {
    const [disp, props, sched] = await Promise.all([getDocs(collection(db, 'trabajos', T.id, 'disponible')), getDocs(collection(db, 'trabajos', T.id, 'reunion')), loadSchedule(uid()).catch(() => null)]);
    for (const d of disp.docs) R.all[d.id] = { weeks: d.data().weeks ?? {}, share: d.data().share ?? 'none', busy: d.data().busy ?? [] };
    R.props = props.docs.map((p) => ({ id: p.id, ...p.data() }));
    const o = sched?.mine?.classes?.length ? sched.mine : sched?.options?.[sched.active ?? 0];
    R.classes = (o?.classes ?? []).flatMap((c) => (c.slots ?? []).map((x) => ({ d: x.d, s: x.s, e: x.e, n: String(c.name ?? '').slice(0, 40) })));
  } catch (e) { console.warn('reunion', e); R.error = 'No pude cargar las horas del grupo. Recarga la página.'; }
  repaint();
}
const me = () => R.all[uid()] ?? { weeks: {}, share: 'none', busy: [] };
const mine = () => new Set(me().weeks?.[R.week] ?? []);
const colorOf = (m) => COLORS[Math.max(0, members().findIndex((x) => x.uid === m.uid)) % COLORS.length];
const shown = (m) => !R.off.has(m.uid);

// For each half hour: who marked they can, and who is busy by their shared schedule (among the people shown).
function cells() {
  const ms = members().filter(shown);
  const out = [];
  for (let s = 0; s < 7 * ROWS; s += 1) {
    const can = ms.filter((m) => (R.all[m.uid]?.weeks?.[R.week] ?? []).includes(s));
    const busy = ms.filter((m) => m.uid !== uid() && (R.all[m.uid]?.busy ?? []).some((b) => covers(b, s)));
    out.push({ can, busy });
  }
  return { ms, out };
}
function best(len) {
  const { ms, out } = cells();
  const res = [];
  for (let d = 0; d < 7; d += 1) {
    for (let r = 0; r + len <= ROWS; r += 1) {
      const s = d * ROWS + r;
      const at = dateOf(R.week, s); at.setMinutes(FROM + r * 30);
      if (at < new Date()) continue;
      const k = Math.min(...Array.from({ length: len }, (_, i) => out[s + i].can.length));
      if (k > 0) res.push({ slot: s, k });
    }
  }
  res.sort((a, b) => b.k - a.k || a.slot - b.slot);
  const picked = [];
  for (const o of res) { if (picked.length >= 3) break; if (!picked.some((p) => dayOf(p.slot) === dayOf(o.slot) && Math.abs(p.slot - o.slot) < len)) picked.push(o); }
  return { picked, of: ms.length };
}

function timeline() {
  const { ms, out } = cells();
  const own = mine();
  const total = Math.max(1, ms.length);
  const fixed = R.props.filter((p) => p.week === R.week && members().length && members().every((m) => (p.si ?? []).includes(m.uid)));
  const showClasses = !R.off.has('classes') && R.classes?.length;
  return `<div class="rn-grid ${R.mode === 'pick' ? 'picking' : ''}" data-rn-grid role="grid" aria-label="Cronograma de la semana">
    <span></span>${SHORT.map((d, i) => `<b>${d}<small>${addDays(R.week, i).getDate()}</small></b>`).join('')}
    ${Array.from({ length: ROWS }, (_, r) => `<span class="rn-h">${r % 2 ? '' : hhmm(FROM + r * 30)}</span>${Array.from({ length: 7 }, (_, d) => {
    const s = d * ROWS + r;
    const c = out[s];
    const cls = showClasses ? R.classes.filter((b) => covers(b, s)) : [];
    const sel = R.sel !== null && s >= R.sel && s < R.sel + R.len && dayOf(s) === dayOf(R.sel);
    const fix = fixed.some((p) => s >= p.slot && s < p.slot + p.len && dayOf(s) === dayOf(p.slot));
    const tip = [`${DAYS[d]} ${hhmm(FROM + r * 30)}`, c.can.length ? `pueden: ${c.can.map((m) => m.name).join(', ')}` : '',
      c.busy.length ? `ocupados: ${c.busy.map((m) => { const b = (R.all[m.uid]?.busy ?? []).find((x) => covers(x, s)); return b?.n ? `${m.name} (${b.n})` : m.name; }).join(', ')}` : '',
      cls.length ? `tu clase: ${cls.map((b) => b.n).join(', ')}` : ''].filter(Boolean).join(' · ');
    return `<i data-rn-slot="${s}" class="${own.has(s) ? 'me' : ''} ${cls.length ? 'cls' : ''} ${sel ? 'sel' : ''} ${fix ? 'fix' : ''}" style="--k:${(c.can.length / total).toFixed(2)}" title="${esc(tip)}">${c.busy.slice(0, 4).map((m) => `<u style="--mc:${colorOf(m)}"></u>`).join('')}</i>`;
  }).join('')}`).join('')}
  </div>`;
}

function proposalHTML(p) {
  const ms = members();
  const yes = ms.filter((m) => (p.si ?? []).includes(m.uid));
  const no = ms.filter((m) => (p.no ?? []).includes(m.uid));
  const fixed = ms.length > 0 && yes.length === ms.length;
  const when = `${dayName(p.week, p.slot)} · ${timeOf(p.slot)}–${endOf(p.slot, p.len)}`;
  const added = (prefs.get().deadlines ?? []).some((d) => d.date === iso(dateOf(p.week, p.slot)) && String(d.text).startsWith(`Reunión ${timeOf(p.slot)}`));
  return `<li class="rn-prop ${fixed ? 'fixed' : ''}">
    <div><b>${esc(when)}</b><br><small>${fixed ? '✓ Fijada: todos pueden' : `${yes.length} de ${ms.length} pueden${no.length ? ` · no: ${no.map((m) => esc(m.name)).join(', ')}` : ''}`}</small></div>
    <span class="rn-vote">${fixed
    ? (added ? '<small>✓ en tus fechas</small>' : `<button type="button" class="button primary small" data-rn="add-date" data-id="${esc(p.id)}">Agregar a mis fechas</button>`)
    : `<button type="button" class="button small ${(p.si ?? []).includes(uid()) ? 'primary' : 'ghost'}" data-rn="si" data-id="${esc(p.id)}">Puedo</button><button type="button" class="button small ${(p.no ?? []).includes(uid()) ? 'red' : 'ghost'}" data-rn="no" data-id="${esc(p.id)}">No puedo</button>`}
    ${p.by === uid() ? `<button type="button" class="link mut" data-rn="drop" data-id="${esc(p.id)}">quitar</button>` : ''}</span>
  </li>`;
}

// The block, wherever the guide places it. «why» is what the AI said the group does together there.
export function reunionBlock(T, { repaint: rp, ref, people, why = '' }) {
  repaint = rp; tRef = ref; members = people;
  if (!R || R.tid !== T.id) { load(T); return '<div class="rn" id="cap-reunion"><h3 class="rn-title">👥 ¿Cuándo nos reunimos?</h3><p class="mut">Cargando…</p></div>'; }
  R.title = T.title;
  const ms = members();
  const missing = ms.filter((m) => !(R.all[m.uid]?.weeks?.[R.week] ?? []).length);
  const props = R.props.filter((p) => p.week >= iso(monday())).sort((a, b) => a.week.localeCompare(b.week) || a.slot - b.slot);
  const { picked, of } = best(R.len);
  const tops = picked.filter((o) => !R.props.some((p) => p.week === R.week && p.slot === o.slot && p.len === R.len));
  const share = me().share ?? 'none';
  const chip = (key, label, color, on, note = '') => `<button type="button" class="rn-chip ${on ? 'on' : ''}" data-rn="layer" data-k="${esc(key)}" aria-pressed="${on}" style="--mc:${color}"><i></i>${esc(label)}${note ? ` <small>${esc(note)}</small>` : ''}</button>`;
  const noteOf = (m) => { const a = R.all[m.uid]; const marked = (a?.weeks?.[R.week] ?? []).length; const sh = a?.share ?? 'none'; return `${marked ? 'marcó' : 'sin marcar'}${sh === 'detail' ? ' · horario' : sh === 'busy' ? ' · ocupado' : ''}`; };
  return `<div class="rn" id="cap-reunion">
    <h3 class="rn-title">👥 ¿Cuándo nos reunimos?</h3>
    ${why ? `<p class="rn-why"><b>Este paso se hace juntos:</b> ${esc(why)}</p>` : '<p class="rn-why">Si necesitan reunirse (repartir, juntar las partes, ensayar la defensa), cada uno marca cuándo puede y Studium encuentra la hora.</p>'}
    ${R.error ? `<p class="tj-warn">${esc(R.error)}</p>` : ''}
    <div class="rn-bar">
      <span class="rn-week"><button type="button" class="ask" data-rn="week" data-d="-7" aria-label="Semana anterior">←</button><b>${esc(weekLabel(R.week))}</b><button type="button" class="ask" data-rn="week" data-d="7" aria-label="Semana siguiente">→</button></span>
      <span class="rn-mode"><button type="button" class="${R.mode === 'paint' ? 'on' : ''}" data-rn="mode" data-m="paint">✎ Marcar cuándo puedo</button><button type="button" class="${R.mode === 'pick' ? 'on' : ''}" data-rn="mode" data-m="pick">◎ Elegir la hora</button></span>
    </div>
    <div class="rn-layers"><span class="small mut">Ver:</span>
      ${R.classes?.length ? chip('classes', 'Mis clases', '#62728a', !R.off.has('classes')) : '<a class="rn-chip" href="#/horario">＋ Arma tu horario en Studium</a>'}
      ${ms.map((m) => chip(m.uid, m.uid === uid() ? 'Yo' : m.name, colorOf(m), shown(m), m.uid === uid() ? '' : noteOf(m))).join('')}
    </div>
    <div class="rn-two">
      <div>
        ${timeline()}
        <p class="small mut rn-legend"><span class="lg me"></span> tú puedes · <span class="lg heat"></span> más oscuro, más pueden · <span class="lg cls"></span> tus clases · <span class="lg busy"></span> compañero ocupado · pasa el cursor sobre una hora para ver quién</p>
        <p class="small">${R.classes?.length ? '<button type="button" class="ask" data-rn="fill">Marcar libre todo lo que no es clase</button> · ' : ''}<button type="button" class="ask" data-rn="clear">Borrar lo que marqué esta semana</button> <span class="mut" data-rn-status role="status">${esc(R.note)}</span></p>
        <div class="rn-share"><b>Mi horario en este trabajo:</b> ${Object.entries(SHARES).map(([k, t]) => `<label><input type="radio" name="rn-share" value="${k}" data-rn-share ${share === k ? 'checked' : ''} ${k !== 'none' && !R.classes?.length ? 'disabled' : ''}> ${esc(t)}</label>`).join('')}
          <small class="mut">Lo ven solo los miembros de este trabajo.${R.classes?.length ? '' : ' Para compartirlo, primero ármalo en Studium.'}</small></div>
      </div>
      <div class="rn-plan">
        ${R.sel !== null ? `<p class="rn-picked">Elegiste <b>${esc(dayName(R.week, R.sel))}, ${timeOf(R.sel)}–${endOf(R.sel, R.len)}</b><br><button type="button" class="button primary small" data-rn="propose" data-s="${R.sel}">Proponer esta hora</button> <button type="button" class="link" data-rn="unsel">cancelar</button></p>` : R.mode === 'pick' ? '<p class="rn-picked">Pulsa en el cronograma la hora en que empezaría la reunión.</p>' : ''}
        <div><h4>Propuestas</h4>${props.length ? `<ul class="rn-props">${props.map(proposalHTML).join('')}</ul>` : '<p class="small mut">Todavía no hay.</p>'}</div>
        <div><h4>Las mejores horas</h4>
          <p class="small">Duración: ${LENS.map(([l, t]) => `<button type="button" class="ask ${R.len === l ? 'on' : ''}" data-rn="len" data-l="${l}">${t}</button>`).join(' ')}</p>
          ${tops.length ? `<ul class="rn-best">${tops.map((o) => `<li><span><b>${esc(dayName(R.week, o.slot))}</b> ${timeOf(o.slot)}–${endOf(o.slot, R.len)}<br><small>${o.k === of ? 'pueden todos' : `pueden ${o.k} de ${of}`}</small></span><button type="button" class="ask" data-rn="propose" data-s="${o.slot}">Proponer</button></li>`).join('')}</ul>`
    : `<p class="small mut">${missing.length ? `Falta que marquen: ${missing.map((m) => esc(m.name)).join(', ')}.` : 'No hay horas en que puedan.'}</p>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- what the person does ---------- */
let painting = null;
let saveTimer = 0;
const status = (root, t) => { if (R) R.note = t; const el = root.querySelector('[data-rn-status]'); if (el) el.textContent = t; };
async function saveMine(root) {
  const m = me();
  const now = iso(monday());
  const weeks = Object.fromEntries(Object.entries(m.weeks ?? {}).filter(([k, v]) => k >= now && v?.length).sort().slice(0, 8).map(([k, v]) => [k, [...new Set(v)].sort((a, b) => a - b)]));
  R.all[uid()] = { ...m, weeks };
  status(root, 'Guardando…');
  try {
    await setDoc(tRef(R.tid, 'disponible', uid()), { weeks, share: m.share ?? 'none', busy: m.busy ?? [], updated: serverTimestamp() });
    status(root, 'Guardado.');
  } catch (e) { console.warn(e); status(root, 'No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.'); }
}
function setMine(set) { const m = me(); R.all[uid()] = { ...m, weeks: { ...(m.weeks ?? {}), [R.week]: [...set] } }; }
const keepScroll = (root) => { const sc = root.closest('#view-trabajo'); const y = sc?.scrollTop; repaint(); if (sc) sc.scrollTop = y; };

export function wireReunion(root, toast) {
  const cell = (ev) => ev.target.closest?.('[data-rn-slot]');
  root.addEventListener('pointerdown', (ev) => {
    const c = cell(ev);
    if (!c || !R) return;
    ev.preventDefault();
    if (R.mode === 'pick') {
      let s = Number(c.dataset.rnSlot);
      if ((s % ROWS) + R.len > ROWS) s = dayOf(s) * ROWS + ROWS - R.len;
      R.sel = s; keepScroll(root); return;
    }
    painting = { add: !c.classList.contains('me') };
    c.classList.toggle('me', painting.add);
  });
  root.addEventListener('pointerover', (ev) => { const c = cell(ev); if (c && painting) c.classList.toggle('me', painting.add); });
  const end = () => {
    if (!painting || !R) return;
    painting = null;
    const g = root.querySelector('[data-rn-grid]');
    if (!g) return;
    setMine(new Set([...g.querySelectorAll('[data-rn-slot].me')].map((x) => Number(x.dataset.rnSlot))));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { await saveMine(root); keepScroll(root); }, 500);
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);

  root.addEventListener('change', async (ev) => {
    const r = ev.target.closest?.('[data-rn-share]');
    if (!r || !R) return;
    const share = r.value;
    const busy = share === 'none' ? [] : (R.classes ?? []).slice(0, 80).map((b) => ({ d: b.d, s: b.s, e: b.e, ...(share === 'detail' && b.n ? { n: b.n } : {}) }));
    R.all[uid()] = { ...me(), share, busy };
    await saveMine(root);
    toast(share === 'none' ? 'Tu horario ya no se comparte en este trabajo.' : share === 'busy' ? 'El grupo ve tus horas ocupadas, sin las materias.' : 'El grupo ve tu horario con las materias.');
    keepScroll(root);
  });

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest?.('[data-rn]');
    if (!b || !R) return;
    const kind = b.dataset.rn;
    const busy = async (fn) => { b.disabled = true; try { await fn(); } catch (e) { console.warn(e); toast(e.message || 'No se pudo: inténtalo otra vez.'); } finally { b.disabled = false; keepScroll(root); } };
    if (kind === 'week') { const k = iso(addDays(R.week, Number(b.dataset.d))); if (k >= iso(monday())) { R.week = k; R.sel = null; keepScroll(root); } else toast('Esa semana ya pasó.'); return; }
    if (kind === 'len') { R.len = Number(b.dataset.l); R.sel = null; keepScroll(root); return; }
    if (kind === 'mode') { R.mode = b.dataset.m; if (R.mode === 'paint') R.sel = null; keepScroll(root); return; }
    if (kind === 'unsel') { R.sel = null; keepScroll(root); return; }
    if (kind === 'layer') { const k = b.dataset.k; if (R.off.has(k)) R.off.delete(k); else R.off.add(k); keepScroll(root); return; }
    if (kind === 'fill') {
      await busy(async () => {
        const free = new Set();
        for (let s = 0; s < 7 * ROWS; s += 1) if (!R.classes.some((c) => covers(c, s))) free.add(s);
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
        R.props.push({ id: ref.id, ...p }); R.sel = null; R.mode = 'paint';
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
      if (!list.some((d) => d.date === date && d.text === text)) prefs.set({ deadlines: [...list, { id: `r${Date.now().toString(36)}`, text, date }] });
      toast('Agregada a «Fechas y entregas» en tu Inicio.');
      keepScroll(root);
    }
  });
}
