// The person's own space: the home page (next exam, goals, focus timer, where they left off, what is new), the
// ambience picker, and the settings. Everything the person chooses lives in prefs.js.
import { careers, careerPicker } from './malla.js';
import { myClasses } from './schedule.js';
import * as vault from './vault.js';
import { prefs, MODES, AMBIENCES, THEMES, AVATARS } from './prefs.js';
import * as ai from './ai.js';
import { when, nextMidnight } from './aierror.js';
import { sfx } from './sfx.js';
import { celebrate } from './play.js';
import { themeStyle, keyOf } from './themes.js';
import { rise } from './fx.js';
import { auth } from './data.js';
import { communityLabel, communityOf, flag, settings } from './settings.js';
import { seen, markSeen, unmarkSeen, hintsOn, setHints } from './hints.js';
import { luckyHit, found, radioOn, openRadio, radioDocked, placeRadio, rescueRadio, critCount, eggCount, prop3d, poke, backdrop, EGGS, openStations } from './eggs.js';
import { props, pokeProp } from './props3d.js';
import { SKINS, skinOpen, specterSkin, setSpecterSkin } from './specter.js';
import { renderHomeSchedule } from './schedule.js';
import * as grid from './grid.js';
import * as decor from './decor.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let ctx = null;

/* ---------- dates ---------- */
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dayOf = (d) => (d ? new Date(`${d}T00:00:00`) : null);
export function daysTo(date) { const d = dayOf(date); return d ? Math.round((d - today()) / 86400000) : null; }
export function soonLabel(date) {
  const n = daysTo(date);
  if (n === null || n < 0) return '';
  return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n < 7 ? `En ${n} días` : n < 31 ? `En ${Math.round(n / 7)} ${Math.round(n / 7) === 1 ? 'semana' : 'semanas'}` : '';
}
const longDate = (d) => dayOf(d)?.toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }) ?? '';

/* ---------- the ambience picker (landing, home and settings) ---------- */
const ART = {
  jugueton: '<svg viewBox="0 0 100 100"><defs><radialGradient id="amb-orb" cx="36%" cy="28%" r="78%"><stop offset="0" stop-color="#f4f7ff"/><stop offset=".35" stop-color="#a9c0ff" stop-opacity=".8"/><stop offset="1" stop-color="#2f5bff"/></radialGradient></defs><circle cx="50" cy="52" r="36" fill="url(#amb-orb)"/><circle cx="50" cy="64" r="18" fill="var(--red)" opacity=".22"/><ellipse cx="37" cy="32" rx="11" ry="5" fill="#fff" opacity=".6" transform="rotate(-30 37 32)"/><rect x="38" y="46" width="7" height="12" rx="3.5" fill="#0b1020" opacity=".85"/><rect x="55" y="46" width="7" height="12" rx="3.5" fill="#0b1020" opacity=".85"/><path d="M46 64q4 3 8 0" fill="none" stroke="#0b1020" stroke-width="2.4" stroke-linecap="round"/></svg>',
  vivo: '<i class="marble" style="--c:var(--blue);left:22%;top:30%"></i><i class="marble" style="--c:var(--red);left:52%;top:46%;animation-delay:-.8s"></i><i class="marble" style="--c:var(--teal);left:72%;top:22%;width:20px;height:20px;animation-delay:-1.6s"></i>',
  sereno: '<svg class="wave" viewBox="0 0 120 40"><path d="M0 20c15-12 30-12 45 0s30 12 45 0 22-10 30-6" fill="none" stroke="var(--sky)" stroke-width="3" stroke-linecap="round"/></svg>',
  enfoque: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke="var(--ink)" stroke-width="4"/><path d="M50 20a30 30 0 0 1 0 60Z" fill="var(--ink)"/></svg>',
};
export function renderAmbiences(container) {
  const mini = container.dataset.ambiencePicker === 'mini';
  const current = prefs.get().ambience;
  container.setAttribute('role', 'radiogroup');
  container.innerHTML = Object.entries(AMBIENCES).map(([id, a]) => `<button type="button" class="amb" role="radio" aria-checked="${id === current}" data-set-ambience="${id}" title="${esc(a.text)}">
      ${mini ? '' : `<span class="art" aria-hidden="true">${ART[id]}</span>`}<strong>${esc(a.name)}</strong>${mini ? '' : `<span>${esc(a.text)}</span>`}</button>`).join('');
}
export function bindAmbiences() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-ambience]');
    if (!b) return;
    const id = b.dataset.setAmbience;
    const patch = { ambience: id };
    // Choosing the playful ambience is choosing its sounds too; they can be turned off from the bar.
    if (id === 'jugueton' && !prefs.get().sound) { patch.sound = true; ctx?.toast('Sonidos activados. Los apagas con el parlante de arriba.'); }
    if (id === 'sereno' || id === 'enfoque') patch.sound = false;
    prefs.set(patch);
    sfx.tick();
  });
  prefs.on(() => { for (const el of document.querySelectorAll('[data-ambience-picker]')) renderAmbiences(el); });
}

/* ---------- home ---------- */
const hello = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
};
const SUB = {
  examenes: 'Lo que viene, y lo que te falta para llegar.',
  gusto: 'Sin apuro: explora lo que te dé curiosidad.',
  intensivo: 'Un bloque de enfoque, y después un descanso.',
  metas: 'Paso a paso: una meta a la vez.',
};
function upcoming() {
  return ctx.state.catalog.filter((g) => (daysTo(g.date) ?? -1) >= 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function recent() {
  try { return JSON.parse(localStorage.getItem('studium-recent') ?? '[]'); } catch { return []; }
}
export function remember(id) {
  const list = [id, ...recent().filter((x) => x !== id)].slice(0, 8);
  try { localStorage.setItem('studium-recent', JSON.stringify(list)); } catch { /* not remembered */ }
}

/* ---------- the home page: tiles the person chooses ---------- */
// Every tile is optional, and each has its place and size in the grid of grid.js. With nothing chosen, the home page
// shows everything it can hold, the most important on the first screen; «Personalizar» lets the person move, resize,
// remove and add tiles.
export const TILE_NAMES = {
  todos: 'Pendientes', countdown: 'Tu próximo examen', schedule: 'Hoy en tu horario', deadlines: 'Fechas y entregas', week: 'Tu semana', goals: 'Metas', timer: 'Enfoque',
  notes: 'Bloc de notas', links: 'Accesos rápidos', recent: 'Sigue donde quedaste', news: 'Lo nuevo en tu comunidad', explore: 'Un concepto al azar',
  shelf: 'Easter eggs', decor: 'Decoración',
};
let editing = false;
// The Easter eggs join the home page by themselves once a secret is found (and can be removed like any tile).
const shelfWanted = () => found().size && !seen('shelf-removed');
const layout = () => {
  const p = prefs.get();
  let items = p.tiles.length ? grid.parse(p.tiles) : null;
  if (!items) {
    // Nothing chosen, or a list from before the grid (mostly what the page chose itself): the default layout.
    items = grid.DEFAULT.map((it) => ({ ...it }));
  }
  items = items.filter((it) => it.id !== 'shelf' || shelfWanted());
  if (shelfWanted() && !items.some((it) => it.id === 'shelf')) items.push(grid.place(items, 'shelf'));
  // The radio left on Inicio needs its room in the Easter eggs.
  const shelf = items.find((it) => it.id === 'shelf');
  if (shelf && radioDocked()) { shelf.h = Math.max(shelf.h, 5); shelf.w = Math.max(shelf.w, 6); shelf.x = Math.min(shelf.x, grid.COLS - shelf.w); }
  return grid.compact(items);
};
const chosen = () => layout().map((it) => it.id);
const tileId = (t) => String(t).split(/[:@]/)[0];

function tools(id) {
  if (!editing) return '';
  return `<div class="tile-tools"><span class="grip" aria-hidden="true" title="Arrástrala para moverla"><svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg></span>
    <button class="icon" data-tile-hide="${id}" aria-label="Quitar ${esc(TILE_NAMES[id])} del inicio" title="Quitar"><svg><use href="#i-x"/></svg></button></div>
    <span class="tile-resize" data-resize aria-hidden="true" title="Arrastra para cambiar el tamaño"></span>`;
}
// A tile: its size in columns (w) and rows (h) lets its content choose a compact or a wide form.
const tile = (id, it, inner, cls = 'glass', attrs = '') => `<section class="tile ${cls}${it.w <= 4 ? ' narrow' : ''}${it.h <= 2 ? ' short' : ''}" style="grid-area:${it.y + 1} / ${it.x + 1} / span ${it.h} / span ${it.w}" data-tile="${id}" ${editing ? `tabindex="0" aria-label="${esc(TILE_NAMES[id])}: flechas para mover, Mayús y flechas para el tamaño"` : ''} ${attrs}>${tools(id)}<div class="tile-body">${inner}</div></section>`;

// Exams of the guides and the person's own dates, together, from the nearest.
function agenda() {
  const own = prefs.get().deadlines.filter((d) => (daysTo(d.date) ?? -1) >= 0).map((d) => ({ ...d, own: true, title: d.text }));
  return [...upcoming().map((g) => ({ ...g, own: false })), ...own].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function countdownTile(span) {
  const next = agenda()[0];
  if (!next) {
    return tile('countdown', span, `<h2>Tu próximo examen</h2><p class="muted">No hay nada con fecha por venir. Agrega tus fechas en «Fechas y entregas», o crea la guía de tu próximo examen.</p>
      <div class="actions"><button class="button ghost" data-tile-add="deadlines">Agregar fechas</button><a class="button primary" href="#/estudiar/guia">Crear una guía</a></div>`);
  }
  const n = daysTo(next.date);
  const sub = next.own ? next.course ?? '' : [next.professor, next.term].filter(Boolean).join(' · ');
  return tile('countdown', span, `
    <p class="kicker d">${next.own ? 'Tu próxima fecha' : 'Tu próximo examen'} · ${esc(longDate(next.date))}</p>
    <div class="countdown d" style="--d:26"><span class="big">${n === 0 ? 'Hoy' : n}<small>${n === 0 ? '' : n === 1 ? ' día' : ' días'}</small></span>
      <h3>${next.own ? esc(next.text) : `${esc(next.course)}: ${esc(next.title)}`}</h3><p class="muted">${esc(sub)}</p></div>
    <div class="actions d" style="--d:14">${next.own ? '<a class="button ghost" href="#/estudiar/guia">Crear su guía</a>'
      : `<a class="button primary" href="#/guia/${encodeURIComponent(next.id)}">Abrir la guía</a><button class="button ghost" data-goal-for="${esc(next.id)}">Ponérmelo como meta</button>`}</div>`, 'solid-blue', 'data-tilt="3"');
}
function deadlinesTile(span) {
  const all = [...prefs.get().deadlines].sort((a, b) => a.date.localeCompare(b.date));
  const next = all.filter((d) => daysTo(d.date) >= 0);
  const past = all.length - next.length;
  const courses = uniqCourses();
  return tile('deadlines', span, `<h2>Fechas y entregas <small>${next.length ? `${next.length} por venir` : ''}</small></h2>
    ${next.length ? `<ul class="dlist">${next.map((d) => { const n = daysTo(d.date); return `<li class="${n <= 2 ? 'near' : ''}">
      <span class="when"><b>${n === 0 ? 'Hoy' : n}</b><small>${n === 0 ? '' : n === 1 ? 'día' : 'días'}</small></span>
      <span class="text"><strong>${esc(d.text)}</strong><span class="muted">${esc([d.course, longDate(d.date)].filter(Boolean).join(' · '))}</span></span>
      <button class="icon x" data-deadline-remove="${esc(d.id)}" aria-label="Quitar esta fecha"><svg><use href="#i-x"/></svg></button></li>`; }).join('')}</ul>`
      : '<p class="muted">Entregas, parciales, inscripciones: lo que tenga fecha, con cuánto falta.</p>'}
    <form class="dl-add" id="deadline-add">
      <input name="text" maxlength="100" placeholder="Entrega del proyecto, Parcial 2…" aria-label="Qué" required autocomplete="off">
      <input name="date" type="date" aria-label="Cuándo" required>
      <input name="course" maxlength="80" list="home-courses" placeholder="Materia (opcional)" aria-label="Materia" autocomplete="off">
      <button class="button primary">Agregar</button>
      <datalist id="home-courses">${courses.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </form>
    ${past ? `<button class="link" data-deadline-clear>Borrar ${past === 1 ? 'la fecha pasada' : `las ${past} fechas pasadas`}</button>` : ''}`);
}
const uniqCourses = () => [...new Set(ctx.state.catalog.map((g) => g.course).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
function weekTile(span) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = today(); d.setDate(d.getDate() + i); return d; });
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const items = agenda();
  return tile('week', span, `<h2>Tu semana</h2>
    <ol class="week">${days.map((d, i) => {
      const on = items.filter((x) => x.date === iso(d));
      return `<li class="${i === 0 ? 'today' : ''}"><span class="wd">${esc(d.toLocaleDateString(prefs.get().lang === 'en' ? 'en-US' : 'es-EC', { weekday: 'short' }))}</span><b>${d.getDate()}</b>
        ${on.map((x) => x.own ? `<span class="ev own">${esc(x.text)}</span>` : `<a class="ev" href="#/guia/${encodeURIComponent(x.id)}">${esc(x.title)}</a>`).join('')}</li>`;
    }).join('')}</ol>`);
}
function notesTile(span) {
  return tile('notes', span, `<h2>Bloc de notas <small id="notes-saved"></small></h2>
    <textarea id="home-notes" maxlength="4000" rows="7" placeholder="Lo que no quieres olvidar: una fórmula, una idea, el aula del examen…" aria-label="Bloc de notas">${esc(prefs.get().notes)}</textarea>`);
}
function linksTile(span) {
  const { links } = prefs.get();
  return tile('links', span, `<h2>Accesos rápidos</h2>
    ${links.length ? `<ul class="qlinks">${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><i aria-hidden="true">${esc(l.label[0]?.toUpperCase() ?? '·')}</i>${esc(l.label)}</a>
      <button class="icon x" data-link-remove="${esc(l.id)}" aria-label="Quitar ${esc(l.label)}"><svg><use href="#i-x"/></svg></button></li>`).join('')}</ul>`
      : '<p class="muted">Tus páginas de siempre a un clic: el aula virtual, tu correo, el horario, un Drive.</p>'}
    ${links.length < 12 ? `<form class="ql-add" id="link-add"><input name="label" maxlength="40" placeholder="Nombre" aria-label="Nombre" required autocomplete="off"><input name="url" type="url" maxlength="300" placeholder="https://…" aria-label="Dirección" required><button class="button primary">Agregar</button></form>` : ''}`);
}

// «Pendientes»: a post-it of to-dos. Each can have a time (overdue ones stand out) and a class of «Mi horario».
function dueText(due) {
  if (!due) return '';
  const d = new Date(due.length > 10 ? due : `${due}T23:59`);
  const today = new Date(); const tomorrow = new Date(Date.now() + 864e5);
  const day = d.toDateString() === today.toDateString() ? 'hoy' : d.toDateString() === tomorrow.toDateString() ? 'mañana' : d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  return due.length > 10 ? `${day} ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : day;
}
const overdue = (t) => !t.done && t.due && new Date(t.due.length > 10 ? t.due : `${t.due}T23:59`) < new Date();
function todosTile(span) {
  const { todos } = prefs.get();
  // Not done first, the ones with a time by their time, then the rest as written; done ones last.
  const order = [...todos].sort((a, b) => (a.done - b.done) || ((a.due ? 0 : 1) - (b.due ? 0 : 1)) || String(a.due ?? '').localeCompare(String(b.due ?? '')));
  const left = todos.filter((t) => !t.done).length;
  return tile('todos', span, `<div class="pi-paper"><h2>Pendientes <small>${left ? `${left} por hacer` : todos.length ? 'todo hecho' : ''}</small></h2>
    ${order.length ? `<ul class="pi-list">${order.map((t) => `<li class="${t.done ? 'done' : ''} ${overdue(t) ? 'late' : ''}" data-todo="${esc(t.id)}">
        <label><input type="checkbox" ${t.done ? 'checked' : ''} data-todo-check="${esc(t.id)}"><span class="pi-box" aria-hidden="true"></span><span class="pi-text">${esc(t.text)}</span></label>
        ${t.due || t.label ? `<span class="pi-meta">${t.due ? `<span class="pi-due">${overdue(t) ? 'venció · ' : ''}${esc(dueText(t.due))}</span>` : ''}${t.label ? `<a class="pi-cls" href="#/horario">${esc(t.label)}</a>` : ''}</span>` : ''}
        <button type="button" class="icon x" data-todo-remove="${esc(t.id)}" aria-label="Quitar este pendiente"><svg><use href="#i-x"/></svg></button></li>`).join('')}</ul>`
    : '<p class="pi-empty">Lo que tienes que hacer, a mano: «Leer el capítulo 3», «Entregar el deber de Redes»…</p>'}
    <form class="pi-add" data-todo-add><input name="text" maxlength="140" placeholder="Nuevo pendiente" aria-label="Nuevo pendiente" autocomplete="off" required>
      <details class="pi-more"><summary>Fecha o clase</summary>
        <label class="field"><span>Para cuándo</span><input type="datetime-local" name="due"></label>
        <label class="field"><span>Con una clase de tu horario</span><select name="cls" data-todo-classes><option value="">Ninguna</option></select></label>
      </details><button class="button primary small">Agregar</button></form></div>`, 'postit', 'id="todos-tile"');
}
function goalsTile(span) {
  const { goals } = prefs.get();
  const done = goals.filter((g) => g.done).length;
  const p = goals.length ? Math.round((done / goals.length) * 100) : 0;
  const suggestions = upcoming().slice(0, 3).filter((g) => !goals.some((x) => x.guide === g.id));
  return tile('goals', span, `<div class="goal-head"><div class="ring" style="--p:${p}">${done}/${goals.length}</div><div><h2>Metas</h2><p class="muted">${goals.length ? (done === goals.length ? 'Cumpliste todas. Pon la siguiente.' : 'Marca cada una cuando la cumplas.') : 'Pequeñas y concretas: «Subredes a mano», «Simulacro», «Repasar RIP».'}</p></div></div>
    ${goals.length ? `<ul class="goals">${goals.map((g) => `<li class="goal ${g.done ? 'done' : ''}" data-goal="${esc(g.id)}">
        <label><input type="checkbox" ${g.done ? 'checked' : ''} data-goal-check="${esc(g.id)}"><span class="box"><svg viewBox="0 0 24 24"><use href="#i-check"/></svg></span></label>
        <span class="text">${esc(g.text)}</span>
        <button class="icon x" data-goal-remove="${esc(g.id)}" aria-label="Quitar esta meta"><svg><use href="#i-x"/></svg></button></li>`).join('')}</ul>` : ''}
    <form class="goal-add" id="goal-add"><input name="text" maxlength="140" placeholder="Nueva meta" aria-label="Nueva meta" autocomplete="off"><button class="button primary">Agregar</button></form>
    ${suggestions.length ? `<div class="suggest">${suggestions.map((g) => `<button class="chip new" data-goal-for="${esc(g.id)}">+ Terminar ${esc(g.title)}</button>`).join('')}</div>` : ''}`, 'glass', 'id="goals-tile"');
}

function timerTile(span) {
  const f = prefs.get().focus;
  return tile('timer', span, `<h2>Enfoque</h2>
    <details class="timer-set"><summary title="Ajustar los tiempos">${f.study} + ${f.rest} min</summary><div class="grid">
      <label class="field"><span>Estudio (min)</span><input type="number" min="5" max="90" step="5" value="${f.study}" data-focus="study"></label>
      <label class="field"><span>Descanso (min)</span><input type="number" min="1" max="30" value="${f.rest}" data-focus="rest"></label></div></details>
    <div class="timer" id="timer"><div class="face" style="--p:100"><b id="timer-left">${String(f.study).padStart(2, '0')}:00</b><small id="timer-what">Estudio</small></div>
      <div class="actions"><button class="button primary" id="timer-go">Empezar</button><button class="button ghost" id="timer-reset">Reiniciar</button></div></div>`);
}

function guideRow(g) {
  const state = prefs.get().progress[g.id];
  return `<a class="mini-guide" href="#/guia/${encodeURIComponent(g.id)}" style="${themeStyle(ctx.state.themes.get(keyOf(g.course)) ?? g.theme)}">
    <span class="swatch-sq" aria-hidden="true"></span>
    <span><strong>${esc(g.title)}</strong><span class="muted">${esc(g.course)}</span></span>
    <span class="state ${state === 'done' ? 'done' : ''}">${state === 'done' ? 'Terminada' : state === 'reading' ? 'Leyendo' : soonLabel(g.date) || 'Abrir'}</span></a>`;
}
function recentTile(span) {
  const ids = recent();
  const list = ids.map((id) => ctx.state.catalog.find((g) => g.id === id)).filter(Boolean).slice(0, 4);
  return tile('recent', span, `<h2>Sigue donde quedaste</h2>
    ${list.length ? `<div class="mini-guides">${list.map(guideRow).join('')}</div>` : '<p class="muted">Las guías que abras aparecen aquí, con cuáles ya terminaste.</p>'}`);
}
function newsTile(span) {
  // A guide already in «Sigue donde quedaste» is not shown twice.
  const mine = chosen().includes('recent') ? new Set(recent().slice(0, 4)) : new Set();
  const latest = [...ctx.state.catalog].filter((g) => !mine.has(g.id)).sort((a, b) => b.updated - a.updated).slice(0, 4);
  const concepts = ctx.state.graph?.nodes.filter((n) => n.type === 'concept').length ?? 0;
  return tile('news', span, `<h2>Lo nuevo en tu comunidad <small>${ctx.state.catalog.length} ${ctx.state.catalog.length === 1 ? 'guía' : 'guías'} · ${ctx.state.contributions.length} aportes · ${concepts} conceptos en el grafo</small></h2>
    ${latest.length ? `<div class="mini-guides wide">${latest.map(guideRow).join('')}</div>` : `<p class="muted">${ctx.state.catalog.length ? 'Nada nuevo fuera de lo que ya estás leyendo.' : 'Todavía no hay guías. La primera puede ser la tuya.'}</p>`}
    <div class="actions"><a class="button ghost" href="#/guias">Todas las guías</a><a class="button ghost" href="#/grafo">El grafo</a><a class="button ghost" href="#/profes">Profes</a></div>`);
}
function exploreTile(span) {
  const concepts = ctx.state.graph?.nodes.filter((n) => n.type === 'concept' && !n.ghost && n.summaries?.length) ?? [];
  const c = concepts[Math.floor(Math.random() * concepts.length)];
  return tile('explore', span, `<h2>Un concepto al azar</h2>
    ${c ? `<h3 style="font-size:24px;letter-spacing:-.03em">${esc(c.name)}</h3><p class="muted">${esc(c.summaries[0].text)}</p><div class="actions"><a class="button primary" href="#/grafo/${encodeURIComponent(c.id)}">Verlo en el grafo</a><button class="button ghost" data-reroll>Otro</button></div>`
    : '<p class="muted">Cuando el grafo tenga conceptos, aquí aparece uno distinto cada vez.</p>'}`);
}
// What the easter eggs left on the home page: each find, to press, and a «?» for each secret still hidden.
function shelfTile(span) {
  const f = found();
  const crits = critCount();
  const items = [
    f.has('cake') ? `<button type="button" class="trinket" data-trinket="cake" aria-label="La torta: sopla la vela" title="Sopla la vela">${prop3d('cake')}<small>La torta</small></button>` : '',
    f.has('medic') ? `<button type="button" class="trinket" data-trinket="medic" aria-label="El monitor: tómate el pulso" title="Tómate el pulso">${prop3d('monitor')}<small>El monitor</small></button>` : '',
    f.has('portal') ? `<button type="button" class="trinket" data-trinket="portal" aria-label="Los portales: suelta una canica" title="Suelta una canica">${prop3d('portals')}<small>Portales</small></button>` : '',
    f.has('crit') ? `<button type="button" class="trinket" data-trinket="crit" aria-label="Golpes críticos: ${crits}" title="Golpes críticos">${prop3d('trophy')}<small>× ${crits} crítico${crits === 1 ? '' : 's'}</small></button>` : '',
    f.has('cafe') ? `<button type="button" class="trinket" data-trinket="cafe" aria-pressed="${backdrop() === 'cafe'}" title="Enciende o apaga la «Noche de estudio»">${prop3d('cup')}<small>Noche de estudio</small></button>` : '',
    f.has('starve') ? `<button type="button" class="trinket" data-trinket="starve" title="Pon el fonógrafo">${prop3d('gramophone')}<small>El fonógrafo</small></button>` : '',
    f.has('radio') ? (radioDocked() ? '<div class="radio-stand" data-radio-stand></div>' : `<div class="trinket radio-slot">${radioOn() ? '<small>La radio va contigo</small>' : '<button type="button" class="button ghost small" data-radio-add>Encender la radio</button>'}</div>`) : '',
  ].filter(Boolean);
  const hidden = eggCount() - f.size;
  return tile('shelf', span, `<h2>Easter eggs <small>${f.size} de ${eggCount()} encontrados</small></h2>
    <div class="shelf">${items.join('')}${Array.from({ length: hidden }, () => '<span class="trinket locked" title="Un secreto por encontrar">?</span>').join('')}</div>`);
}
// Today's classes (schedule.js fills it): what is on now and what comes next; wide, the whole week.
const scheduleTile = (span) => tile('schedule', span, '<div class="home-schedule" data-home-schedule></div>', 'glass sched-tile');
// «Decoración»: one 3D scene the Easter eggs unlocked, with no card behind it: purely decorative room. Pressed, it
// plays (the fire flares up, the cake's candle goes out…); «Cambiar», on hover, picks another one.
function decorTile(span) {
  const k = decor.current();
  const all = decor.unlocked();
  const POKE = { cake: 'cake', monitor: 'medic', portals: 'portal' };
  const menu = all.length ? `<details class="decor-add"><summary title="Elegir la decoración">${k ? 'Cambiar' : 'Elegir'}</summary><div class="decor-menu">${all.map((x) => `<button type="button" data-decor-add="${x}" aria-pressed="${x === k}">${prop3d(decor.sceneOf(x))}<span>${esc(decor.DECOR[x].name)}</span></button>`).join('')}${k ? '<button type="button" class="decor-none" data-decor-remove>Sin decoración</button>' : ''}</div></details>` : '';
  return tile('decor', span, `${menu}${k ? `<button type="button" class="decor-obj" ${POKE[k] ? `data-trinket="${POKE[k]}"` : 'data-decor-poke'} aria-label="${esc(decor.DECOR[k].name)}" title="${esc(decor.DECOR[k].name)}">${prop3d(decor.sceneOf(k))}</button>`
    : `<p class="decor-empty">${all.length ? 'Elige una decoración para este espacio.' : 'Los Easter eggs desbloquean escenas en 3D para este espacio: una fogata en la noche, un fonógrafo, una torta… Búscalos.'}</p>`}`, 'decor-tile');
}
const RENDER = { decor: decorTile, schedule: scheduleTile, shelf: shelfTile, todos: todosTile, countdown: countdownTile, deadlines: deadlinesTile, week: weekTile, goals: goalsTile, timer: timerTile, notes: notesTile, links: linksTile, recent: recentTile, news: newsTile, explore: exploreTile };

function onboardTile() {
  const p = prefs.get();
  return `<section class="tile glass onboard"><h2>Hazlo tuyo <small>Lo cambias cuando quieras en Ajustes</small></h2>
    <p class="muted">¿Cómo estudias? Eso decide qué ves primero aquí.</p>
    <div class="row" role="radiogroup">${Object.entries(MODES).map(([id, m]) => `<button type="button" class="pick" role="radio" aria-checked="${p.mode === id}" data-set-mode="${id}"><strong>${esc(m.name)}</strong><span>${esc(m.text)}</span></button>`).join('')}</div>
    <div class="actions"><button class="button primary" data-onboard-done>Listo</button></div></section>`;
}
function trayTile() {
  const have = new Set(chosen().map(tileId));
  const missing = Object.keys(TILE_NAMES).filter((id) => !have.has(id) && (id !== 'shelf' || found().size));
  return `<section class="tile glass tray"><h2>Personaliza tu inicio <small>Arrastra cada cosa para moverla, estírala desde su esquina, o quítala con la ×</small></h2>
    ${missing.length ? `<div class="chips">${missing.map((id) => `<button class="chip new" data-tile-add="${id}">+ ${esc(TILE_NAMES[id])}</button>`).join('')}${eggTray()}</div>` : `<p class="muted">Ya tienes todo a la vista.</p>${eggTray() ? `<div class="chips">${eggTray()}</div>` : ''}`}
    <div class="actions"><button class="button ghost" data-tile-reset>Como venía</button><button class="button primary" data-home-edit>Listo</button></div></section>`;
}
// Things found in the easter eggs that can live on the screen.
const eggTray = () => (found().has('radio') && !radioOn() ? '<button class="chip new" data-radio-add>+ Radio</button>' : '');
// A secret found: if the person chose their own tiles, «Tus hallazgos» joins them once, so the find is on Inicio.
export function unlocked(fresh) {
  const p = prefs.get();
  if (fresh && !seen('shelf-removed') && p.tiles.length && !p.tiles.some((x) => tileId(x) === 'shelf') && p.tiles.length < 16) prefs.set({ tiles: grid.serialize(layout()) });
}

export function renderHome() {
  const p = prefs.get();
  $('#home-hello').textContent = `${hello()}${p.nickname ? `, ${p.nickname}` : ''}.`;
  $('#home-where').textContent = [communityLabel(auth.currentUser?.email), p.semester ? `${p.semester}.º semestre` : '', p.career].filter(Boolean).join(' · ');
  $('#home-sub').textContent = SUB[p.mode];
  const items = layout();
  const tiles = items.map((it) => RENDER[it.id]?.(it) ?? '').join('');
  const top = prefs.fresh && !sessionStorage.getItem('studium-onboarded') ? onboardTile() : '';
  rescueRadio(); // the radio left on Inicio is taken out before Inicio is redrawn, so its music goes on
  // The welcome and the tray go above and below the grid of tiles, never inside it.
  $('#dash').innerHTML = `${top}${editing ? trayTile() : ''}<div class="dash-grid" id="dash-grid" style="--rows:${grid.rows(items)}">${tiles}</div>`;
  placeRadio();
  props($('#dash'));
  renderHomeSchedule($('#dash [data-home-schedule]'));
  $('#dash').classList.toggle('editing', editing);
  $('#home-edit').textContent = editing ? 'Listo' : 'Personalizar';
  $('#home-edit').setAttribute('aria-pressed', String(editing));
  for (const el of document.querySelectorAll('[data-ambience-picker]')) renderAmbiences(el);
  syncTimer();
  rise($('#dash'));
}
// One tile drawn again, in its place, without redrawing (and re-animating) the whole home page: the radio turned on
// or off, a find pressed.
export function refreshTile(id) {
  const el = document.querySelector(`#dash [data-tile="${id}"]`);
  const it = layout().find((x) => x.id === id);
  // A tile that changes size (the radio left in the Easter eggs) moves the others: then the whole grid.
  const area = `${it.y + 1} / ${it.x + 1} / span ${it.h} / span ${it.w}`;
  if (!el || !it || el.style.gridArea.replace(/\s+/g, '') !== area.replace(/\s+/g, '')) { renderHome(); return; }
  rescueRadio();
  el.outerHTML = RENDER[id](it);
  const fresh = document.querySelector(`#dash [data-tile="${id}"]`);
  placeRadio();
  if (fresh) props(fresh);
}
// Changing the tiles: from then on the home page keeps the person's own list.
function setTiles(items, focus) {
  prefs.set({ tiles: items.length ? grid.serialize(items) : [] }); markSeen('home-suggest'); renderHome();
  if (focus) document.querySelector(`#dash [data-tile="${focus}"]`)?.focus();
}

/* ---------- goals ---------- */
function addGoal(text, guide) {
  const goals = prefs.get().goals;
  if (!text.trim() || goals.length >= 60) return;
  prefs.set({ goals: [...goals, { id: Math.random().toString(36).slice(2, 10), text: text.trim(), done: false, ...(guide ? { guide } : {}) }] });
  sfx.tick();
  renderHome();
}

/* ---------- the focus timer ---------- */
const minutes = (mode) => prefs.get().focus[mode === 'study' ? 'study' : 'rest'] * 60;
const timer = { mode: 'study', left: minutes('study'), total: minutes('study'), running: false, id: 0, end: 0 };
function syncTimer() {
  const face = $('#timer .face');
  if (!face) return;
  const m = Math.floor(timer.left / 60); const s = timer.left % 60;
  $('#timer-left').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  $('#timer-what').textContent = timer.mode === 'study' ? 'Estudio' : 'Descanso';
  $('#timer').classList.toggle('break', timer.mode === 'break');
  face.style.setProperty('--p', String(Math.round((timer.left / timer.total) * 100)));
  $('#timer-go').textContent = timer.running ? 'Pausar' : timer.left === timer.total ? 'Empezar' : 'Seguir';
}
function tickTimer() {
  timer.left = Math.max(0, Math.round((timer.end - Date.now()) / 1000));
  if (!timer.left) {
    sfx.bell();
    const r = $('#timer .face')?.getBoundingClientRect();
    if (r) celebrate(r.left + r.width / 2, r.top + r.height / 2);
    timer.mode = timer.mode === 'study' ? 'break' : 'study';
    timer.total = timer.left = minutes(timer.mode);
    timer.end = Date.now() + timer.left * 1000;
    ctx?.toast(timer.mode === 'break' ? 'Bloque cumplido. Cinco minutos de descanso.' : 'Descanso terminado. Otro bloque.');
  }
  document.title = timer.running ? `${$('#timer-left')?.textContent ?? ''} · Studium` : document.title;
  syncTimer();
}

/* ---------- settings ---------- */
vault.onVault(() => { const box = document.querySelector('[data-vault]'); if (box && !box.contains(document.activeElement)) box.innerHTML = vaultHTML(); });
document.addEventListener('submit', async (e) => {
  const form = e.target.closest?.('[data-vault-confirm]');
  if (!form) return;
  e.preventDefault();
  const msg = form.parentElement.querySelector('[data-vault-msg]');
  const btn = form.querySelector('button');
  // Every step said, and never a silent wait: past 20 seconds the person is told what is going on.
  btn.disabled = true; msg.textContent = 'Comprobando tu contraseña…';
  const slow = setTimeout(() => { msg.textContent = 'Sigue trabajando: cifrar tus claves con tu contraseña tarda unos segundos, y luego se guardan en tu cuenta. Si no termina en un minuto, revisa tu conexión.'; }, 20000);
  try {
    await vault.confirm(form.password.value);
    msg.textContent = 'Guardando tus claves cifradas en tu cuenta…';
    const box = form.closest('[data-vault]');
    box.innerHTML = vaultHTML();
    const after = box.querySelector('[data-vault-msg]') ?? box;
    if (!vault.state().synced) after.insertAdjacentHTML('beforeend', '<p class="msg">No se pudieron guardar en tu cuenta ahora (sin conexión con ella). Siguen cifradas en este dispositivo; Studium lo intenta otra vez cuando vuelva la conexión.</p>');
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  finally { clearTimeout(slow); }
});
// «Pendientes»: add, check, remove; its class list is filled when «Fecha o clase» opens.
document.addEventListener('submit', (e) => {
  const form = e.target.closest?.('[data-todo-add]');
  if (!form) return;
  e.preventDefault();
  const f = new FormData(form);
  const text = String(f.get('text') ?? '').trim();
  if (!text) return;
  const due = String(f.get('due') ?? '');
  const sel = form.querySelector('[data-todo-classes]');
  const cls = String(f.get('cls') ?? '');
  const label = cls ? sel.selectedOptions[0]?.textContent ?? '' : '';
  prefs.set({ todos: [{ id: Math.random().toString(36).slice(2, 10), text, done: false, ...(due ? { due } : {}), ...(cls ? { cls, label } : {}) }, ...prefs.get().todos].slice(0, 80) });
  sfx.tick();
  renderHome();
  document.querySelector('[data-todo-add] input[name="text"]')?.focus();
});
document.addEventListener('change', (e) => {
  const box = e.target.closest?.('[data-todo-check]');
  if (!box) return;
  prefs.set({ todos: prefs.get().todos.map((t) => (t.id === box.dataset.todoCheck ? { ...t, done: box.checked } : t)) });
  if (box.checked) sfx.tick();
  renderHome();
});
document.addEventListener('click', (e) => {
  const x = e.target.closest?.('[data-todo-remove]');
  if (x) { prefs.set({ todos: prefs.get().todos.filter((t) => t.id !== x.dataset.todoRemove) }); renderHome(); }
});
document.addEventListener('toggle', async (e) => {
  const more = e.target;
  if (!more.classList?.contains('pi-more') || !more.open) return;
  const sel = more.querySelector('[data-todo-classes]');
  if (!sel || sel.options.length > 1) return;
  try {
    const list = await myClasses();
    sel.insertAdjacentHTML('beforeend', list.length ? list.map((c) => `<option value="${esc(c.id)}">${esc(`${c.name}${c.when ? ` (${c.when})` : ''}`)}</option>`).join('') : '<option value="" disabled>Tu horario está vacío</option>');
  } catch { /* without the schedule, no class */ }
}, true);
// The career, from the university's own list: it sets «Mi malla» too (his words, 2026-11-20).
async function fillCareer() {
  const box = document.querySelector('[data-career-pick]');
  if (!box) return;
  const list = await careers();
  if (list.length) box.innerHTML = careerPicker(list, prefs.get().malla, 'Carrera');
}
// The secrets in Ajustes: which ones were found and what each left, where to find them, and a «?» for the rest
// (how to find a hidden one is not told: that is the game).
function secretsSection() {
  const f = found();
  if (!f.size) return '';
  const stations = openStations();
  return `<section class="set glass" id="set-secrets"><h2>Tus secretos <small>${f.size} de ${EGGS.length}</small></h2>
    <p>Lo que desbloqueaste vive en tu Inicio, en «Easter eggs»: ahí se presiona cada cosa. La radio tiene ${stations.length} ${stations.length === 1 ? 'estación abierta' : 'estaciones abiertas'}; se cambia con su perilla del medio.</p>
    <ul class="secrets">${EGGS.map((e) => (f.has(e.id) ? `<li><strong>${esc(e.name)}</strong><span>${esc(e.what)}</span></li>` : '<li class="locked"><strong>?</strong><span>Un secreto por encontrar.</span></li>')).join('')}</ul>
    ${skinOpen('doctor') ? `<fieldset class="seg"><legend>Cómo se viste Specter</legend>${Object.entries(SKINS).filter(([id]) => skinOpen(id)).map(([id, k]) => `<label><input type="radio" name="specter-skin" value="${id}" data-specter-skin ${specterSkin() === id ? 'checked' : ''}><span>${esc(k.name)}</span></label>`).join('')}</fieldset>` : ''}
    <div class="actions"><button class="button primary" data-shelf-show>Ver los Easter eggs en Inicio</button>${f.has('radio') && !radioOn() ? '<button class="button ghost" data-radio-add>Encender la radio</button>' : ''}</div></section>`;
}
export function renderSettings() {
  const p = prefs.get();
  $('#settings').innerHTML = `
    <section class="set glass"><h2>Tú</h2><p>Esto lo ves solo tú, salvo tu nombre público: aparece únicamente en lo que decidas firmar.</p>
      <div class="grid3">
        <label class="field"><span>Cómo te llamamos</span><input data-pref="nickname" maxlength="40" value="${esc(p.nickname)}" placeholder="Opcional"></label>
        <div data-career-pick><label class="field"><span>Carrera</span><select disabled><option>${esc(p.career || 'Cargando las carreras…')}</option></select></label></div>
        <label class="field"><span>Semestre</span><select data-pref="semester"><option value="0">—</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${p.semester === i + 1 ? 'selected' : ''}>${i + 1}.º</option>`).join('')}</select></label>
      </div>
      <div class="grid3">
        <label class="field"><span>Nombre público (para firmar)</span><input data-pref="name" maxlength="60" value="${esc(p.name)}" placeholder="Opcional: como quieres que te reconozcan"></label>
        <fieldset class="avatars"><legend>Tu color</legend>${AVATARS.map((c) => `<label><input type="radio" name="avatar" value="${c}" data-pref="avatar" ${p.avatar === c ? 'checked' : ''}><span style="--c:var(--${c})" aria-label="${c}"></span></label>`).join('')}</fieldset>
        <fieldset class="seg"><legend>Idioma</legend><label><input type="radio" name="lang" value="es" data-pref="lang" ${p.lang === 'es' ? 'checked' : ''}><span>Español</span></label><label><input type="radio" name="lang" value="en" data-pref="lang" ${p.lang === 'en' ? 'checked' : ''}><span>English</span></label></fieldset>
      </div></section>
    ${aiSettings()}
    ${mapSettings()}
    <section class="set glass"><h2>Cómo estudias</h2><p>Cambia el orden de tu inicio.</p>
      <div class="picks" role="radiogroup">${Object.entries(MODES).map(([id, m]) => `<button type="button" class="pick" role="radio" aria-checked="${p.mode === id}" data-set-mode="${id}"><strong>${esc(m.name)}</strong><span>${esc(m.text)}</span></button>`).join('')}</div></section>
    <section class="set glass"><h2>Ambiente</h2><p>Cuánto se mueve la página, y qué tan tierna se pone.</p><div class="ambiences" data-ambience-picker></div>
      ${flag('bubbles') ? `<label class="toggle"><input type="checkbox" data-pref="bubbles" ${p.bubbles ? 'checked' : ''}><span class="knob"></span>Burbujas para reventar, en el ambiente juguetón</label>` : ''}</section>
    <section class="set glass"><h2>Sonidos</h2>
      <label class="toggle"><input type="checkbox" data-pref="sound" ${p.sound ? 'checked' : ''}><span class="knob"></span>Sonidos al lanzar cosas, al cumplir una meta y al terminar un bloque de enfoque</label>
      <div class="actions"><button class="button ghost" data-sound-test>Probar</button></div></section>
    ${secretsSection()}
    <section class="set glass"><h2>Pistas</h2>
      <label class="toggle"><input type="checkbox" data-hints-toggle ${hintsOn() ? 'checked' : ''}><span class="knob"></span>De vez en cuando, una burbuja con algo que quizá no sabías de Studium</label></section>
    <section class="set glass"><h2>Día o noche</h2>
      <fieldset class="seg"><legend class="sr">Tema</legend>${Object.entries(THEMES).map(([id, name]) => `<label><input type="radio" name="theme" value="${id}" data-pref="theme" ${p.theme === id ? 'checked' : ''}><span>${esc(name)}</span></label>`).join('')}</fieldset></section>
    <section class="set glass"><h2>Tu comunidad</h2>
      <p>${communityOf(auth.currentUser?.email) ? `Perteneces a la comunidad <strong>${esc(communityOf(auth.currentUser?.email).name)}</strong>.` : 'Entras como admin de Studium.'} Tus ajustes, metas y progreso se guardan en tu cuenta y solo los ves tú.</p></section>`;
  renderAmbiences($('#settings [data-ambience-picker]'));
  fillCareer();
  rise($('#settings'));
}

/* ---------- the map: courses, interests, what you know ---------- */
// The areas of the map as a person names their interests and hobbies (the same as the map's filters).
const AREAS = {
  vectores: 'Matemáticas', redes: 'Redes y sistemas', codigo: 'Programación', algoritmos: 'Programación competitiva',
  neuronas: 'IA y estadística', ondas: 'Física y electrónica', moleculas: 'Química', celulas: 'Biología y salud',
  mercados: 'Economía y negocios', palabras: 'Humanidades e idiomas', trazos: 'Arte y diseño',
};
function mapSettings() {
  const p = prefs.get();
  const courses = (ctx.state.graph?.courses ?? []).filter((c) => !c.planned).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return `<section class="set glass" id="set-map"><h2>Tu grafo</h2>
    <p>Tus materias de este semestre y lo que te interesa. En el grafo, «Solo mis materias e intereses» oculta las islas que no
      estudias: si viniste por Redes, IEEEXtreme no te estorba.</p>
    ${courses.length ? `<h3>Mis materias</h3><div class="chips">${courses.map((c) => `<button type="button" class="chip ${p.courses.includes(c.key) ? 'on' : ''}" data-my-course="${esc(c.key)}" style="${themeStyle(c.theme)}"><i></i>${esc(c.name)}</button>`).join('')}</div>` : ''}
    <h3>Intereses y hobbies</h3>
    <div class="chips">${Object.entries(AREAS).map(([k, label]) => `<button type="button" class="chip ${p.interests.includes(`area:${k}`) ? 'on' : ''}" data-my-area="${k}" style="${themeStyle(k)}"><i></i>${esc(label)}</button>`).join('')}</div>
    <p class="fine">${p.known.length ? `Marcaste ${p.known.length} ${p.known.length === 1 ? 'concepto' : 'conceptos'} como «Ya lo sé». <button type="button" class="link" data-known-reset>Empezar de cero</button>` : 'En el grafo, «Ya lo sé» en cada concepto te deja ver lo que te falta.'}</p>
  </section>`;
}

/* ---------- your AI ---------- */
// Every way to connect an AI, as many as the person wants. Which one, which model and how much effort is chosen each
// time the AI is used, and the page proposes the best of what is connected.
const aiMsg = (id, text = '') => `<p class="msg" data-ai-msg="${id}" role="status">${esc(text)}</p>`;
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// «Tu IA», read from the top: what Studium uses now; which AI you use (Gemini, ChatGPT, Claude or another), and for
// each, its ways from the easiest to the most technical; each says what it is, what it costs, and that it is another
// company's service. The bridge is advanced, and says what it does on the computer and how to stop it.
const VENDOR = 'studium-ai-vendor';
const VENDORS = {
  gemini: { name: 'Gemini', note: 'gratis' },
  openai: { name: 'ChatGPT', note: 'de OpenAI' },
  anthropic: { name: 'Claude', note: 'de Anthropic' },
  otras: { name: 'Otras', note: 'OpenRouter, Puter' },
};
const vendorOfWay = (w) => (w === 'gemini' ? 'gemini' : w === 'openai' || w === 'bridge:codex' ? 'openai' : w === 'anthropic' || w === 'bridge:claude' ? 'anthropic' : 'otras');
function shownVendor() {
  try { const v = localStorage.getItem(VENDOR); if (v in VENDORS) return v; } catch { /* the default */ }
  const now = ai.connected();
  return now.length ? vendorOfWay(ai.defaultWay()) : 'gemini';
}
const THEIRS = (who) => `<p class="ai-theirs">${who} es un servicio de otra empresa, con sus propias condiciones. Studium solo le envía lo que tú le pides procesar, y no se hace responsable del servicio.</p>`;
// A way that is connected: which model, how many requests today from here, when the free limit comes back.
function wayStatus(way) {
  if (!ai.connected().includes(way)) return '';
  const isDefault = ai.defaultWay() === way;
  const reset = way === 'gemini' ? `Su límite gratis se renueva ${when(nextMidnight('America/Los_Angeles'))}.` : way === 'openrouter' ? `Su límite gratis se renueva ${when(nextMidnight('UTC'))}.` : '';
  return `<div class="ai-status">
    <span class="badge ok">conectada</span>
    <span class="muted">Hoy: ${count(ai.usageToday(way), 'pedido', 'pedidos')} desde Studium.</span>${reset ? ` <span class="muted">${reset}</span>` : ''}
    ${isDefault ? '<span class="badge">la que usa Studium</span>' : `<button class="button ghost small" data-ai-default="${way}">Usar esta</button>`}
    ${taskModels(way)}
  </div>`;
}
// Which model each task uses with this AI, and how much it thinks: each task needs its own. Changed where it is used.
function taskModels(way) {
  const rows = Object.entries(ai.TASKS).map(([task, t]) => {
    const m = ai.ranked(task, way)[0];
    if (!m) return '';
    const think = ai.thinks(way, m.id) ? ` · piensa ${(ai.EFFORTS[t.effort] ?? '').toLowerCase()}` : '';
    return `<li><b>${esc(t.name)}</b><span>${esc(m.id)}${esc(think)} <span class="tag c-${esc(m.cost)}">${esc(ai.COST[m.cost])}</span></span></li>`;
  }).join('');
  return `<details class="ai-tasks"><summary>Qué modelo usa en cada tarea</summary>
    <p class="fine">Cada tarea necesita su propia capacidad: una guía, el modelo más capaz; una pregunta rápida, uno ligero. Studium elige solo lo mejor de lo que tienes gratis. Si quieres otro, lo cambias en el momento, con «Cambiar» junto a cada tarea.</p>
    <ul>${rows}</ul></details>`;
}
function keyBox(k, cost) {
  const pr = ai.PROVIDERS[k]; const key = ai.keyOf(k);
  return `<label class="field"><span>Tu clave de API de ${esc(pr.name)}</span><input type="password" data-ai-key="${k}" value="${esc(key)}" placeholder="${esc(pr.keyHint)}" autocomplete="off" spellcheck="false"></label>
    <div class="actions"><button class="button ghost small" data-ai-test="${k}" ${key ? '' : 'disabled'}>Probar</button>
      <a class="link" href="${esc(pr.keys)}" target="_blank" rel="noopener noreferrer">Conseguir una clave ↗</a>
      ${key ? `<button class="link" data-ai-forget="${k}">Borrar la clave</button>` : ''}</div>
    ${aiMsg(k)}<p class="fine">${cost}</p>`;
}
// The chat way: nothing to connect, with any account, free or paid.
const chatWay = (name, site) => `<article class="ai-way easy">
    <h3><span class="step">1</span> Por chat, con tu cuenta de ${name} <small>gratis o de pago · nada que configurar</small></h3>
    <p>Cuando Studium necesita la IA (leer tu horario, procesar apuntes, crear una guía), te da el pedido listo: lo copias, lo pegas en <a href="${site}" target="_blank" rel="noopener noreferrer">${name}</a> con tu archivo, y pegas la respuesta en Studium. Es la forma más fácil si ya pagas ${name}.</p>
  </article>`;
function bridgeWay(engine) {
  const way = `bridge:${engine}`;
  const b = ai.bridgeOf();
  const e = b?.engines?.find((x) => x.id === engine);
  const name = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' }[engine];
  return `<article class="ai-way ${ai.connected().includes(way) ? 'on' : ''}">
    <h3><span class="step">3</span> Automático, con tu suscripción <small>avanzado · el puente con ${name}</small></h3>
    <p>Studium usa el ${name} que ya tienes instalado en tu computadora, con tu suscripción, sin pagar por uso. Necesita el puente (abajo, en «Avanzado»).</p>
    ${b?.token ? (e ? `<p class="muted">${e.ready ? `${name} está listo en tu computadora.` : `${name}: ${esc(e.detail || 'no está listo')}.`}</p>` : `<p class="muted">El puente está enlazado, pero no encontró ${name} en tu computadora.</p>`) : ''}
    ${wayStatus(way)}
  </article>`;
}
function vendorPanel(v) {
  if (v === 'gemini') {
    const key = ai.keyOf('gemini');
    return `<article class="ai-way ${key ? 'on' : ''} easy">
      <h3>Gratis, automático <small>en un minuto, con cualquier cuenta de Google</small></h3>
      <ol class="howto">
        <li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio ↗</a> y entra con tu cuenta de Google.</li>
        <li>Pulsa «Create API key». No pide tarjeta.</li>
        <li>Copia la clave y pégala aquí.</li>
      </ol>
      <label class="field"><span>Tu clave de Gemini</span><input type="password" data-ai-key="gemini" value="${esc(key)}" placeholder="AIza…" autocomplete="off" spellcheck="false"></label>
      <div class="actions"><button class="button primary small" data-ai-test="gemini" ${key ? '' : 'disabled'}>Probar</button>${key ? '<button class="link" data-ai-forget="gemini">Borrar la clave</button>' : ''}</div>
      ${aiMsg('gemini')}${wayStatus('gemini')}
      <p class="fine">Google da un número de pedidos gratis por día y por modelo. Studium usa los modelos «flash», que son los que tienen uso gratis. En el plan gratis, Google puede usar lo que recibe para mejorar sus productos.</p>
      ${THEIRS('Gemini')}
    </article>`;
  }
  if (v === 'openai' || v === 'anthropic') {
    const name = v === 'openai' ? 'ChatGPT' : 'Claude';
    const site = v === 'openai' ? 'https://chatgpt.com' : 'https://claude.ai';
    const company = v === 'openai' ? 'OpenAI' : 'Anthropic';
    return `${chatWay(name, site)}
      <article class="ai-way ${ai.keyOf(v) ? 'on' : ''}">
        <h3><span class="step">2</span> Automático, pagando por uso <small>con una clave de API de ${company}</small></h3>
        <p>Studium lo hace todo solo. Cada pedido se cobra en tu cuenta de ${company}, aparte de tu suscripción: una suscripción de ${name} no incluye la API.</p>
        ${keyBox(v, 'La clave se guarda solo en este navegador. En un computador compartido, bórrala al terminar.')}
        ${wayStatus(v)}
      </article>
      ${ai.offered('bridge:claude') ? bridgeWay(v === 'openai' ? 'codex' : 'claude') : ''}
      ${THEIRS(name)}`;
  }
  const on = (w) => ai.connected().includes(w);
  return `<article class="ai-way ${on('openrouter') ? 'on' : ''}">
      <h3>OpenRouter <small>muchas IA en un solo lugar</small></h3>
      <p>Una empresa que da acceso a modelos de muchas IA con una sola cuenta. Sus modelos gratis no cuestan nada, pero aceptan pocos pedidos al día (unos 50): sirven para cosas pequeñas.</p>
      <div class="actions">${on('openrouter') ? '<button class="button ghost small" data-ai-test="openrouter">Probar</button><button class="link" data-ai-forget="openrouter">Desconectar</button>' : '<button class="button primary small" data-ai-login="openrouter">Conectar con OpenRouter</button>'}</div>
      ${aiMsg('openrouter')}${wayStatus('openrouter')}${THEIRS('OpenRouter')}
    </article>
    ${ai.offered('puter') ? `<article class="ai-way ${on('puter') ? 'on' : ''}">
      <h3>Puter <small>con un clic</small></h3>
      <p>Un servicio que da acceso a varias IA con su propia cuenta. Para funcionar, su código corre dentro de esta página mientras lo usas, y Studium no controla qué modelos ni cuántos pedidos te da.</p>
      <div class="actions">${on('puter') ? '<button class="button ghost small" data-ai-test="puter">Probar</button><button class="link" data-ai-forget="puter">Desconectar</button>' : '<button class="button ghost small" data-ai-login="puter">Conectar con Puter</button>'}</div>
      ${aiMsg('puter')}${wayStatus('puter')}${THEIRS('Puter')}
    </article>` : ''}`;
}
// The bridge, said plainly: what it is, what it can and cannot do, how to stop it, and which subscription it uses.
function bridgeAdvanced() {
  const b = ai.bridgeOf();
  const engines = b?.engines ?? [];
  const names = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };
  return `<details class="ai-advanced" ${b?.token ? 'open' : ''}><summary>Avanzado: el puente, para usar tu suscripción automáticamente</summary>
    <div class="ai-bridge">
      <p><b>Qué es.</b> Un programa pequeño que corre en tu computadora mientras lo tienes abierto. Conecta Studium con Claude Code, Codex o Antigravity, si ya los tienes instalados con tu sesión iniciada, para usar tu suscripción sin pagar por uso.</p>
      <ul>
        <li><b>Qué hace:</b> recibe un pedido de Studium, se lo pasa a tu IA en una carpeta temporal, y devuelve la respuesta. Después borra la carpeta.</li>
        <li><b>Qué no puede hacer:</b> no lee tus otros archivos ni cambia nada en tu computadora; solo responde a Studium, y solo con el código que muestra al abrirse.</li>
        <li><b>Cómo apagarlo:</b> cierra la ventana de la terminal, o pulsa Ctrl+C en ella.</li>
        <li><b>Para quién:</b> si nunca abriste una terminal, mejor usa la forma por chat: hace lo mismo, solo que a mano.</li>
      </ul>
      ${b?.token ? `<p><b>Tus IA en esta computadora.</b> Elige cuáles usa Studium y, en Claude, con qué cuenta:</p>
        <ul class="engines">${engines.length ? engines.map((e) => {
          const usable = e.ready && !e.paused;
          const on = usable && !(b.off ?? []).includes(e.id);
          const accounts = (e.accounts ?? []).filter((a) => a.ready);
          return `<li class="${on ? 'ok' : ''}"><strong>${esc(names[e.id] ?? e.name)}</strong>
          <span>${esc(e.ready && e.paused ? e.paused : e.ready ? `lista · ${count((e.models ?? []).length, 'modelo', 'modelos')}` : e.detail || 'no está lista')}</span>
          ${usable ? `<label class="check"><input type="checkbox" data-ai-bridge-use="${esc(e.id)}" ${on ? 'checked' : ''}> Usar en Studium</label>` : ''}
          ${on && accounts.length ? `<div class="bridge-accounts" role="radiogroup" aria-label="Cuenta de ${esc(names[e.id] ?? e.name)}">${accounts.map((a) => `<label class="check"><input type="radio" name="bridge-account" data-ai-bridge-account="${esc(a.id)}" ${a.id === b.account ? 'checked' : ''}> ${esc(a.email || a.id)}${a.plan ? ` <small>plan ${esc(a.plan)}</small>` : ''} <small>· carpeta ${esc(a.id)}</small></label>`).join('')}</div>` : ''}
          ${on ? (ai.defaultWay() === `bridge:${e.id}` ? '<span class="badge">la que usa Studium</span>' : `<button class="button ghost small" data-ai-default="bridge:${e.id}">Usar esta para todo</button>`) : ''}</li>`;
        }).join('') : '<li>Pulsa «Revisar» con el puente abierto.</li>'}</ul>
        <div class="actions"><button class="button ghost small" data-ai-bridge-check>Revisar</button><button class="link" data-ai-forget="bridge">Desenlazar</button></div>`
      : bridgeSteps()}
      ${aiMsg('bridge')}
    </div></details>`;
}
// How to open and pair the bridge, step by step; also used by «Trabajos» (trabajos.js).
export function bridgeSteps() {
  return `<ol class="howto">
        <li>Necesitas <a href="https://nodejs.org/" target="_blank" rel="noopener noreferrer">Node</a> 20 o más nuevo.</li>
        <li><a href="${esc(ai.BRIDGE_URL)}" download="studium-bridge.mjs">Descarga el puente</a> y guárdalo donde quieras (por ejemplo, en la carpeta de tu trabajo).</li>
        <li>Abre una terminal en esa carpeta y escribe: <code class="bridge-cmd">${esc(ai.bridgeCommand())}</code> <button type="button" class="link" data-ai-copy="${esc(ai.bridgeCommand())}">copiar</button></li>
        <li>Al instante te muestra un <b>código</b> que empieza con <code>41730.</code> seguido de letras. Cópialo entero y pégalo aquí abajo.</li>
      </ol>
      <label class="field"><span>Código de enlace del puente</span><input data-ai-pair-code placeholder="41730.AbCd…" autocomplete="off" spellcheck="false"></label>
      <div class="actions"><button class="button primary small" data-ai-pair>Enlazar</button><button class="link" data-ai-bridge-find>¿Está abierto? Comprobar</button></div>
      <p class="msg" data-ai-msg="bridge-find"></p>`;
}
function aiSettings() {
  const now = ai.connected();
  const v = shownVendor();
  const c = now.length ? ai.choice('guide') : null;
  return `<section class="set glass" id="set-ai"><h2>Tu IA</h2>
    <p class="ai-lede">Studium usa una IA para leer tus archivos, tu horario y crear guías. Tú eliges cuál. <strong>Studium no cobra nada.</strong></p>
    <div class="ai-now ${now.length ? 'on' : ''}">${c ? `Ahora Studium usa <b>${esc(ai.WAYS[c.provider]?.name ?? c.provider)}</b>, con el modelo adecuado para cada tarea. Hoy: ${count(ai.usageToday(c.provider), 'pedido', 'pedidos')}.`
      : 'Todavía no conectaste ninguna. <b>Para empezar, Gemini es gratis y toma un minuto.</b> Si usas ChatGPT o Claude, también sirven.'}</div>
    ${now.length ? `<div class="ai-status"><div class="ai-status-head"><div><h3>El estado de tus IA</h3><p class="fine">Qué está gratis, qué responde ahora, cuánto te queda y cuándo se reinicia, según cada proveedor.</p></div><div class="actions"><button type="button" class="button ghost small" data-ai-status>Revisar mis cuentas</button><button type="button" class="button ghost small" data-ai-full ${ai.connected().includes('bridge:claude') ? '' : 'disabled title="Necesita el puente con tu Claude Code"'}>Revisar el estado completo</button></div></div><div data-ai-status-out>${statusHTML(ai.lastStatus())}</div><div data-ai-full-out>${fullHTML(ai.lastCatalog())}</div></div>` : ''}
    <p class="ai-ask">¿Qué IA usas?</p>
    <div class="ai-vendors" role="tablist">${Object.entries(VENDORS).map(([k, x]) => `<button role="tab" class="ai-vendor" aria-selected="${k === v}" data-ai-vendor="${k}">${esc(x.name)}<small>${esc(x.note)}</small>${now.some((w) => vendorOfWay(w) === k) ? '<i class="dot" title="conectada"></i>' : ''}</button>`).join('')}</div>
    <div class="ai-panel">${vendorPanel(v)}</div>
    ${ai.offered('bridge:claude') ? bridgeAdvanced() : ''}
    <div class="vault" data-vault>${vaultHTML()}</div>
  </section>`;
}
// Where the keys are, said exactly (vault.js).
function vaultHTML() {
  const v = vault.state();
  const note = v.note ? `<p class="msg">${esc(v.note)}</p>` : '';
  if (v.synced) return `${note}<p class="vault-on"><b>🔒 Tus claves están cifradas</b>, en este dispositivo y en tu cuenta. Solo tu contraseña de Studium las abre: ni Studium ni sus admins pueden leerlas. En tu celular aparecen al iniciar sesión; al cerrar sesión se borran de aquí y vuelven cuando entras.</p>`;
  return `${note}<p><b>🔒 Tus claves están cifradas en este dispositivo.</b> No necesitas hacer nada más para usarlas aquí.</p>
    <details class="vault-more"><summary>Opcional: llevarlas también a tu celular y tus otros dispositivos</summary>
    <p class="fine">Para eso, confirma tu contraseña de Studium una vez: con ella se cifran en tu cuenta, y nadie más puede abrirlas, ni Studium ni sus admins.</p>
    <form class="vault-confirm" data-vault-confirm><label class="field"><span>Tu contraseña de Studium</span><input type="password" name="password" autocomplete="current-password" required></label><button class="button ghost small">Llevar mis claves a mis dispositivos</button></form></details><p class="msg" data-vault-msg></p>`;
}
// What «Revisar el estado» found: per AI, the lines it checked, its models with their cost and whether they answered.
function statusHTML(st) {
  if (!st) return '<p class="muted">Todavía no lo revisaste.</p>';
  const when = new Date(st.at).toLocaleString('es', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  // New models since the last check: a moment of their own, and their conditions before anything else.
  const fresh = (st.fresh ?? []).map((m) => `<div class="ai-new"><span class="ai-new-burst" aria-hidden="true"></span>
      <p class="ai-new-kicker">Nuevo en tu cuenta de ${esc(m.name)}</p><h4>${esc(m.id)}</h4>
      <p>${m.cost === 'free' ? 'Gratis según la página de precios de Google.' : m.cost === 'nofree' ? 'Sin uso gratis: cobra a tu cuenta.' : m.cost === 'paid' ? 'De pago por uso: cada pedido se cobra en tu cuenta.' : 'Sin verificar si es gratis: podría cobrarte si tu clave tiene facturación. Studium no lo usará sin tu permiso para este modelo.'}</p>
      <p class="fine">${m.way === 'gemini' ? '<a href="https://aistudio.google.com/docs/pricing" target="_blank" rel="noopener noreferrer">Sus condiciones en la página de precios de Google ↗</a>' : m.way === 'openrouter' ? '<a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">Sus condiciones en OpenRouter ↗</a>' : ''}</p></div>`).join('');
  return `${fresh}<p class="fine">Revisado el ${esc(when)}.</p>${st.ways.map((w) => `<div class="ai-status-way"><h4>${esc(w.name)}</h4>
      ${w.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${w.models.length ? `<ul class="ai-status-models">${w.models.map((m) => { const cost = ai.costOf(w.way, m.id); return `<li><span class="id">${esc(m.id)}</span> <span class="tag c-${esc(cost)}">${esc(ai.COST[cost] ?? cost)}</span>${ai.sourceLink(w.way, m.id)} ${m.testing ? '<span class="muted">probando…</span>' : m.ok === true ? `<span class="ok">respondió en ${(m.ms / 1000).toFixed(1)} s</span>` : m.ok === false ? `<span class="bad">no respondió: ${esc(m.error)}</span>` : ''}</li>`; }).join('')}</ul>` : ''}
      ${w.links.length ? `<p class="fine">${w.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · ')}</p>` : ''}</div>`).join('')}`;
}
// The full check: per provider, the pages read, the models with what each plan includes, quotas and extra charges,
// each with its exact quote and source; what changed since the last check first.
const PROVIDER = { gemini: 'Gemini (API de Google)', claude: 'Claude y Claude Code', antigravity: 'Antigravity', codex: 'Codex (ChatGPT)' };
const CHANGE = { new: 'Nuevo', 'now-free': 'Ahora es gratis', 'now-paid': 'Empieza a cobrar', plans: 'Cambió lo que incluye cada plan', temporary: 'Acceso temporal', gone: 'Ya no aparece', quotas: 'Cambió la cuota' };
function fullHTML(c) {
  if (!c) return '<p class="muted">La revisión completa lee las páginas oficiales de cada proveedor con tu Claude Code, por el puente, y verifica cada dato palabra por palabra.</p>';
  const cite = (x) => `<details class="ai-cite"><summary>Fuente</summary><blockquote>${esc(x.quote)}</blockquote><a href="${esc(x.source)}" target="_blank" rel="noopener noreferrer">${esc(x.source)} ↗</a></details>`;
  const changes = (c.changes ?? []).map((x) => `<div class="ai-new"><span class="ai-new-burst" aria-hidden="true"></span><p class="ai-new-kicker">${esc(CHANGE[x.kind] ?? x.kind)} · ${esc(PROVIDER[x.provider] ?? x.provider)}</p>
      <h4>${esc(x.id ?? '')}</h4>${x.model ? `<p>${esc(Object.entries(x.model.plans ?? {}).map(([p, v]) => `${p}: ${v}`).join(' · '))}${x.model.temporary ? ` · ${esc(x.model.temporary)}` : ''}</p>${cite(x.model)}` : ''}${x.quotas ? x.quotas.map((q) => `<p>${esc(q.plan)}: ${esc(q.text)}</p>`).join('') : ''}</div>`).join('');
  const when = new Date(c.checkedAt).toLocaleString('es', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `${changes}<p class="fine">Revisión completa del ${esc(when)}${c.plan ? ` · tu plan de Claude: ${esc(c.plan)}` : ''} · leída con ${esc(c.model)}. ${c.dropped ? `${c.dropped} datos descartados porque su cita no estaba, palabra por palabra, en la página.` : 'Todos los datos tienen su cita en la página.'}</p>
    ${Object.entries(c.providers).map(([p, x]) => `<div class="ai-status-way"><h4>${esc(PROVIDER[p] ?? p)}</h4>
      <p class="fine">${x.sources.map((s) => `<a href="${esc(s.finalUrl ?? s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.what)}</a> ${s.ok ? '✓' : `<span class="bad">(${esc(s.error)})</span>`}`).join(' · ')}</p>
      ${x.error ? `<p class="bad">${esc(x.error)}</p>` : ''}
      ${x.models.length ? `<ul class="ai-status-models">${x.models.map((m) => `<li><span class="id">${esc(m.id)}</span> ${m.free === true ? '<span class="tag c-free">Gratis</span>' : m.free === false ? '<span class="tag c-paid">Cobra</span>' : ''} <span class="muted">${esc(Object.entries(m.plans ?? {}).map(([pl, v]) => `${pl}: ${v}`).join(' · '))}</span>${m.temporary ? ` <span class="bad">${esc(m.temporary)}</span>` : ''}${cite(m)}</li>`).join('')}</ul>` : ''}
      ${x.quotas.map((q) => `<p>Cuota${q.plan ? ` (${esc(q.plan)})` : ''}: ${esc(q.text)}</p>${cite(q)}`).join('')}
      ${x.charges.map((q) => `<p>Cobro aparte: ${esc(q.text)}</p>${cite(q)}`).join('')}</div>`).join('')}`;
}
async function runFull(btn) {
  const out = document.querySelector('[data-ai-full-out]');
  btn.disabled = true; btn.textContent = 'Leyendo las páginas oficiales…';
  if (out) out.innerHTML = '<p class="muted">El puente descarga las páginas de cada proveedor y tu Claude Code las lee; puede tardar unos minutos. Cada dato se verifica palabra por palabra.</p>';
  try { const c = await ai.checkFull(); if (out) out.innerHTML = fullHTML(c); }
  catch (e) { if (out) out.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  finally { btn.disabled = false; btn.textContent = 'Revisar el estado completo'; }
}
async function runStatus(btn) {
  const out = document.querySelector('[data-ai-status-out]');
  btn.disabled = true; btn.textContent = 'Revisando…';
  try { await ai.checkStatus((st) => { if (out) out.innerHTML = statusHTML(st); }); }
  finally { btn.disabled = false; btn.textContent = 'Revisar mis cuentas'; }
}
async function testAI(way) {
  const msg = document.querySelector(`[data-ai-msg="${way}"]`);
  if (!msg) return;
  msg.classList.remove('ok');
  msg.textContent = 'Probando…';
  try {
    const list = await ai.models(way);
    msg.classList.add('ok');
    msg.textContent = `Conectada: ${count(list.length, 'modelo', 'modelos')}. Para crear guías se recomienda ${ai.recommend('guide', way) || list[0] || 'el de tu cuenta'}.`;
    sfx.chime();
  } catch (error) { msg.textContent = error.message; }
}
// «¿Está abierto?»: asks the bridge without its code, and says what to do next.
export async function findBridgeSay(scope = document) {
  const msg = scope.querySelector('[data-ai-msg="bridge-find"]');
  if (msg) msg.textContent = 'Buscando el puente…';
  const hello = await ai.findBridge();
  const say = !hello
    ? (ai.bridgeKnowsThisPage() ? 'No encuentro el puente abierto. ¿Escribiste el comando en la terminal? Si ya lo hiciste, espera un par de segundos y vuelve a comprobar.' : `No encuentro el puente, o no acepta esta página. Ábrelo con: ${ai.bridgeCommand()}`)
    : ai.bridgeOld(hello.version) ? `Tienes abierta una versión anterior del puente (${hello.version ?? '?'}). Ciérralo, descárgalo de nuevo y ábrelo otra vez.`
      : 'El puente está abierto. Ahora pega aquí el código que te muestra y pulsa «Enlazar».';
  if (msg) msg.textContent = say; else ctx?.toast(say);
  return !!hello;
}
// The bridge's link («#/ajustes?puente=41730.code») or its code, pasted.
export async function pairBridge(text) {
  const m = String(text ?? '').trim().match(/(?:puente=)?(\d{2,5})\.([A-Za-z0-9_-]{16,})/);
  if (!m) { ctx?.toast('Ese no es un código del puente: empieza con el puerto, un punto y el código.'); return false; }
  try {
    const engines = await ai.pairBridge(m[1], m[2]);
    const ready = engines.filter((e) => e.ready).map((e) => e.name);
    ctx?.toast(ready.length ? `Puente enlazado: ${ready.join(', ')}.` : 'Puente enlazado, pero ninguna IA está lista en tu computadora.');
    sfx.chime();
    return true;
  } catch (error) { ctx?.toast(error.message); return false; } finally { if ($('#set-ai')) renderSettings(); }
}
async function aiAction(t) {
  if (t.dataset.aiLogin === 'openrouter') { await ai.connectOpenRouter(); return; }
  if (t.dataset.aiLogin === 'puter') {
    t.disabled = true;
    try { await ai.connectPuter(); ctx.toast('Puter quedó conectado.'); sfx.chime(); } catch (error) { ctx.toast(error.message); }
    renderSettings();
    return;
  }
  if (t.dataset.aiPair !== undefined) { await pairBridge($('[data-ai-pair-code]')?.value); return; }
  if (t.dataset.aiBridgeFind !== undefined) { await findBridgeSay(t.closest('.ai-bridge, .tj-bridge') ?? document); return; }
  if (t.dataset.aiBridgeCheck !== undefined) {
    const msg = $('[data-ai-msg="bridge"]');
    if (msg) msg.textContent = 'Revisando…';
    try { await ai.bridgeStatus(); renderSettings(); } catch (error) { const m = $('[data-ai-msg="bridge"]'); if (m) m.textContent = error.message; }
  }
}

let savedTimer = 0;
export function mountSpace(context) {
  ctx = context;
  bindAmbiences();
  // A decoration added: into its tile; if the person's own layout has no «Decoración», it joins it.
  addEventListener('studium-decor', () => {
    if (document.querySelector('#dash [data-tile="decor"]')) { refreshTile('decor'); return; }
    const items = layout();
    if (prefs.get().tiles.length && !items.some((it) => it.id === 'decor') && decor.placed().length) {
      items.push(grid.place(items, 'decor'));
      prefs.set({ tiles: grid.serialize(items) });
      if (document.querySelector('#dash-grid')) renderHome();
    }
  });
  grid.bindGrid($('#dash'), { get: layout, save: (items, focus) => { sfx.tick(); setTiles(items, focus); }, editing: () => editing });
  prefs.on((p, patch) => {
    if (patch.saved) { const el = $('#saved'); el.classList.add('on'); clearTimeout(savedTimer); savedTimer = setTimeout(() => el.classList.remove('on'), 1600); }
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-goal-for], input[data-hints-toggle]');
    if (!t) return;
    if (t.dataset.setMode) {
      const patch = { mode: t.dataset.setMode };
      if (t.dataset.setMode === 'metas' && !prefs.get().sound) patch.sound = true;
      prefs.set(patch); sfx.tick();
      for (const b of document.querySelectorAll('[data-set-mode]')) b.setAttribute('aria-checked', String(b.dataset.setMode === patch.mode));
      if (!$('#view-home').hidden && !t.closest('.onboard')) renderHome();
    }
    if (t.dataset.onboardDone !== undefined) { sessionStorage.setItem('studium-onboarded', '1'); prefs.set({}); renderHome(); }
    if (t.dataset.goalFor) {
      const g = ctx.state.catalog.find((x) => x.id === t.dataset.goalFor);
      if (g && !prefs.get().goals.some((x) => x.guide === g.id)) { addGoal(`Terminar la guía «${g.title}» de ${g.course}`, g.id); ctx.toast('Meta agregada.'); }
    }
    if (t.dataset.goalRemove) { prefs.set({ goals: prefs.get().goals.filter((g) => g.id !== t.dataset.goalRemove) }); renderHome(); }
    if (t.dataset.reroll !== undefined) renderHome();
    if (t.dataset.aiVendor) { try { localStorage.setItem('studium-ai-vendor', t.dataset.aiVendor); } catch { /* shown now */ } renderSettings(); sfx.tick(); return; }
    if (t.dataset.aiDefault) { ai.setDefault(t.dataset.aiDefault); ctx?.toast(`Studium usará ${ai.WAYS[t.dataset.aiDefault]?.name ?? 'esta IA'}.`); renderSettings(); sfx.tick(); return; }
    if (t.dataset.aiTest) testAI(t.dataset.aiTest);
    if (t.dataset.aiStatus !== undefined) runStatus(t);
    if (t.dataset.aiFull !== undefined) runFull(t);
    if (t.closest('#set-map')) {
      const p = prefs.get();
      if (t.dataset.myCourse) prefs.set({ courses: p.courses.includes(t.dataset.myCourse) ? p.courses.filter((x) => x !== t.dataset.myCourse) : [...p.courses, t.dataset.myCourse] });
      if (t.dataset.myArea) { const id = `area:${t.dataset.myArea}`; prefs.set({ interests: p.interests.includes(id) ? p.interests.filter((x) => x !== id) : [...p.interests, id] }); }
      if (t.dataset.knownReset !== undefined) prefs.set({ known: [] });
      if (t.dataset.myCourse || t.dataset.myArea || t.dataset.knownReset !== undefined) { sfx.tick(); $('#set-map').outerHTML = mapSettings(); }
    }
    if (t.dataset.aiForget) {
      const way = t.dataset.aiForget;
      ai.forget(way); renderSettings();
      ctx?.toast(way === 'bridge' ? 'El puente quedó desenlazado.' : way === 'puter' || way === 'openrouter' ? 'Se desconectó de este navegador.' : 'La clave se borró de este navegador.');
    }
    if (t.dataset.aiLogin || t.dataset.aiPair !== undefined || t.dataset.aiBridgeCheck !== undefined || t.dataset.aiBridgeFind !== undefined) aiAction(t);
    if (t.dataset.aiCopy) { navigator.clipboard.writeText(t.dataset.aiCopy).then(() => ctx?.toast('Copiado.'), () => {}); }
    if (t.dataset.soundTest !== undefined) { sfx.enable(true); sfx.chime(); if (!prefs.get().sound) setTimeout(() => sfx.enable(false), 900); }
    if (t.id === 'timer-go') {
      timer.running = !timer.running;
      clearInterval(timer.id);
      if (timer.running) { timer.end = Date.now() + timer.left * 1000; timer.id = setInterval(tickTimer, 1000); sfx.tick(); }
      syncTimer();
    }
    if (t.id === 'timer-reset') { clearInterval(timer.id); Object.assign(timer, { mode: 'study', left: minutes('study'), total: minutes('study'), running: false }); syncTimer(); }
    // The home page's tiles.
    if (t.id === 'home-edit' || t.dataset.homeEdit !== undefined) { editing = !editing; markSeen('home-suggest'); renderHome(); sfx.toggle(editing); }
    if (t.dataset.tileAdd) {
      const items = layout();
      if (!items.some((it) => it.id === t.dataset.tileAdd)) items.push(grid.place(items, t.dataset.tileAdd));
      setTiles(items);
      ctx.toast(`${TILE_NAMES[t.dataset.tileAdd]}: en tu inicio.`);
      requestAnimationFrame(() => document.querySelector(`[data-tile="${t.dataset.tileAdd}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    if (t.dataset.tileHide) {
      const id = t.dataset.tileHide;
      if (id === 'shelf') markSeen('shelf-removed');
      const el = t.closest('[data-tile]');
      const gone = () => setTiles(grid.compact(layout().filter((it) => it.id !== id)));
      if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('leaving'); setTimeout(gone, 220); } else gone();
    }
    if (t.dataset.shelfShow !== undefined) { unmarkSeen('shelf-removed'); if (prefs.get().tiles.length) prefs.set({ tiles: grid.serialize(layout()) }); renderSettings(); location.hash = '#/inicio'; }
    if (t.dataset.tileReset !== undefined) setTiles([]);
    if (t.dataset.radioAdd !== undefined) { const home = !!t.closest('#dash'); openRadio(false, home ? true : undefined); if (home) refreshTile('shelf'); else renderSettings(); }
    if (t.dataset.trinket) poke(t.dataset.trinket, t);
    if (t.dataset.decorAdd) { decor.choose(t.dataset.decorAdd); sfx.tick(); }
    if (t.dataset.decorRemove !== undefined) decor.clear();
    if (t.dataset.decorPoke !== undefined) { const c = t.querySelector('canvas'); if (pokeProp(c) === undefined) { t.classList.remove('spun'); void t.offsetWidth; t.classList.add('spun'); } sfx.tick(); }
    if (t.dataset.deadlineRemove) { prefs.set({ deadlines: prefs.get().deadlines.filter((d) => d.id !== t.dataset.deadlineRemove) }); renderHome(); }
    if (t.dataset.deadlineClear !== undefined) { prefs.set({ deadlines: prefs.get().deadlines.filter((d) => daysTo(d.date) >= 0) }); renderHome(); }
    if (t.dataset.linkRemove) { prefs.set({ links: prefs.get().links.filter((l) => l.id !== t.dataset.linkRemove) }); renderHome(); }
    if (t.dataset.hintsToggle !== undefined) { setHints(!hintsOn()); renderSettings(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.specterSkin !== undefined) setSpecterSkin(t.value);
    // The bridge: which of its AIs Studium uses, and with which Claude account.
    if (t.dataset.aiBridgeUse) { ai.setBridgeUse(t.dataset.aiBridgeUse, t.checked); renderSettings(); return; }
    if (t.dataset.aiBridgeAccount) { ai.setBridgeAccount(t.dataset.aiBridgeAccount); ctx?.toast('Studium usará esa cuenta de Claude.'); renderSettings(); return; }
    if (t.dataset.goalCheck) {
      const goals = prefs.get().goals.map((g) => (g.id === t.dataset.goalCheck ? { ...g, done: t.checked } : g));
      prefs.set({ goals });
      if (t.checked) {
        const r = t.closest('.goal').getBoundingClientRect();
        const lucky = luckyHit(r.left + 60, r.top);
        celebrate(r.left + 30, r.top + r.height / 2, lucky || goals.every((g) => g.done));
      }
      setTimeout(renderHome, t.checked ? 650 : 0);
    }
    if (t.dataset.aiKey) {
      ai.setKey(t.dataset.aiKey, t.value);
      renderSettings();
      if (ai.keyOf(t.dataset.aiKey)) testAI(t.dataset.aiKey);
    }
    if (t.dataset.focus) {
      const f = { ...prefs.get().focus, [t.dataset.focus]: Number(t.value) };
      prefs.set({ focus: f });
      if (!timer.running) { Object.assign(timer, { mode: 'study', left: minutes('study'), total: minutes('study') }); }
      renderHome();
    }
    if (t.dataset.pref) {
      const k = t.dataset.pref;
      const v = t.type === 'checkbox' ? t.checked : k === 'semester' ? Number(t.value) : t.value;
      prefs.set({ [k]: v });
      if (k === 'sound' && v) { sfx.enable(true); sfx.chime(); }
    }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'goal-add') { e.preventDefault(); addGoal(f.text.value); }
    if (f.id === 'deadline-add') {
      e.preventDefault();
      const d = { id: rid(), text: f.text.value.trim(), date: f.date.value, ...(f.course.value.trim() ? { course: f.course.value.trim() } : {}) };
      if (!d.text || !d.date) return;
      prefs.set({ deadlines: [...prefs.get().deadlines, d] }); sfx.tick(); renderHome();
    }
    if (f.id === 'link-add') {
      e.preventDefault();
      const url = f.url.value.trim();
      if (!/^https?:\/\//i.test(url)) { ctx.toast('La dirección empieza con https://'); return; }
      prefs.set({ links: [...prefs.get().links, { id: rid(), label: f.label.value.trim(), url }] }); sfx.tick(); renderHome();
    }
  });
  let notesTimer = 0;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'home-notes') return;
    clearTimeout(notesTimer);
    const value = e.target.value;
    notesTimer = setTimeout(() => { prefs.set({ notes: value }); const el = $('#notes-saved'); if (el) el.textContent = 'Guardado'; }, 600);
  });
}
