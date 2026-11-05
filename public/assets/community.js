// The community's positive side: thanks for guides (four fixed reactions, no comments) and what students know about
// their professors (fixed constructive tags, counted, never signed). There is no way to write anything negative here:
// the database only accepts the kinds and tags listed below.
import { KUDOS, loadKudos, setKudos, loadTips, setTip } from './data.js';
import { keyOf, themeStyle } from './themes.js';
import { sfx } from './sfx.js';
import { burst } from './play.js';
import { rise } from './fx.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let ctx = null;

export const KUDO_INFO = {
  salvo: { name: 'Me salvó', color: 'var(--red)' },
  entendi: { name: 'Por fin lo entendí', color: 'var(--butter)' },
  examen: { name: 'Me sirvió en el examen', color: 'var(--blue)' },
  gracias: { name: 'Gracias', color: 'var(--peach)' },
};
// The same tags firestore.rules accepts, by group. Each group has its highlighter color.
export const TIP_GROUPS = [
  { name: 'Cómo enseña', color: 'var(--blue)', tags: { 'explica-claro': 'Explica con mucha claridad', ejemplos: 'Usa muchos ejemplos', practico: 'Clases prácticas', teorico: 'Clases teóricas', responde: 'Responde dudas y correos', tutorias: 'Disponible en tutorías' } },
  { name: 'Cómo evalúa', color: 'var(--sky)', tags: { 'examen-deberes': 'Los exámenes se parecen a los deberes', 'examen-clase': 'Los exámenes salen de lo visto en clase', 'examenes-largos': 'Exámenes largos: practica con tiempo', procedimiento: 'Valora el procedimiento, no solo el resultado', formato: 'Cuida el formato y la presentación', participacion: 'Cuenta la participación', proyectos: 'Mucho peso en proyectos' } },
  { name: 'Lo que suma', color: 'var(--teal)', tags: { 'puntos-extra': 'Da puntos extra', recuperar: 'Da oportunidades para recuperar', reclamos: 'Revisa reclamos con apertura', material: 'Comparte su material' } },
  { name: 'Ten en cuenta', color: 'var(--red)', tags: { asistencia: 'Toma asistencia', puntual: 'No acepta entregas tarde', 'sin-formulas': 'Exámenes sin hoja de fórmulas', 'leer-antes': 'Pide leer antes de clase', ritmo: 'Avanza rápido: no te atrases', exigente: 'Exigente: vale la pena prepararse' } },
  { name: 'Ideal para ti si…', color: 'var(--butter)', tags: { 'ideal-teoria': 'te gusta la teoría', 'ideal-practica': 'aprendes haciendo', 'ideal-autonomo': 'estudias por tu cuenta', 'ideal-guiado': 'prefieres que te guíen paso a paso' } },
];
const TAG = Object.fromEntries(TIP_GROUPS.flatMap((g) => Object.entries(g.tags).map(([id, name]) => [id, { name, group: g }])));

/* ---------- thanks ---------- */
const kudos = { counts: new Map(), mine: new Map(), loaded: false };
export async function loadCommunity(force = false) {
  if (kudos.loaded && !force) return;
  const uid = ctx.user.uid;
  const [k, tips] = await Promise.all([loadKudos(uid).catch(() => ({ counts: new Map(), mine: new Map() })), loadTips().catch(() => [])]);
  Object.assign(kudos, k, { loaded: true });
  ctx.state.tips = tips;
}
export function kudosRow(guideId) {
  const c = kudos.counts.get(guideId);
  if (!c) return '';
  const parts = KUDOS.filter((k) => c[k]).map((k) => `<span title="${esc(KUDO_INFO[k].name)}" style="color:${KUDO_INFO[k].color}"><svg><use href="#k-${k}"/></svg><b style="color:var(--ink-2)">${c[k]}</b></span>`);
  return parts.length ? `<div class="kudos-row">${parts.join('')}</div>` : '';
}
export function renderKudos(guideId) {
  const el = $('#guide-kudos');
  const c = kudos.counts.get(guideId) ?? {};
  const mine = kudos.mine.get(guideId) ?? new Set();
  el.innerHTML = KUDOS.map((k) => `<button class="kudo" data-kudo="${k}" data-guide="${esc(guideId)}" aria-pressed="${mine.has(k)}" style="--k:${KUDO_INFO[k].color}" title="${esc(KUDO_INFO[k].name)}">
    <svg aria-hidden="true"><use href="#k-${k}"/></svg><span>${esc(KUDO_INFO[k].name)}</span>${c[k] ? `<b>${c[k]}</b>` : ''}</button>`).join('');
}
async function toggleKudo(button) {
  const { kudo, guide } = button.dataset;
  const mine = new Set(kudos.mine.get(guide) ?? []);
  const on = !mine.has(kudo);
  if (on) mine.add(kudo); else mine.delete(kudo);
  const tally = kudos.counts.get(guide) ?? Object.fromEntries(KUDOS.map((k) => [k, 0]));
  tally[kudo] = Math.max(0, tally[kudo] + (on ? 1 : -1));
  kudos.counts.set(guide, tally); kudos.mine.set(guide, mine);
  renderKudos(guide);
  if (on) { const r = button.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 14); sfx.chime(); }
  try { await setKudos(ctx.user.uid, guide, KUDOS.filter((k) => mine.has(k))); }
  catch (error) {
    // Put it back as it was.
    if (on) mine.delete(kudo); else mine.add(kudo);
    tally[kudo] = Math.max(0, tally[kudo] + (on ? -1 : 1));
    renderKudos(guide);
    ctx.toast(ctx.explain(error));
  }
}

/* ---------- professors ---------- */
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// Everyone the community knows: from guides, contributions and tips. A name only one student typed, with nothing
// else behind it, is not shown, so that a single entry cannot put a name on the page.
function professors() {
  const all = new Map();
  const add = (name, course) => {
    const key = keyOf(name);
    if (!key) return null;
    const p = all.get(key) ?? { key, name, courses: new Set(), sources: 0, tips: [], questions: 0 };
    if (course) p.courses.add(course);
    all.set(key, p);
    return p;
  };
  for (const x of [...ctx.state.catalog, ...ctx.state.contributions]) {
    if (!x.professor) continue;
    const p = add(x.professor, x.course);
    p.sources += 1;
    p.questions += x.questions && Number.isInteger(x.questions) ? x.questions : 0;
  }
  for (const t of ctx.state.tips ?? []) {
    const p = add(t.professor, t.course);
    p.tips.push(t);
  }
  return [...all.values()].filter((p) => p.sources || p.tips.length >= 2).sort((a, b) => b.tips.length - a.tips.length || a.name.localeCompare(b.name));
}
function profCard(p) {
  const counts = {};
  for (const t of p.tips) for (const tag of t.tags) counts[tag] = (counts[tag] ?? 0) + 1;
  const people = p.tips.length;
  const theme = ctx.state.themes.get(keyOf([...p.courses][0] ?? '')) ?? 'estrellas';
  const groups = TIP_GROUPS.map((g) => {
    const tags = Object.keys(g.tags).filter((t) => counts[t]).sort((a, b) => counts[b] - counts[a]);
    if (!tags.length) return '';
    return `<div class="group"><h4>${esc(g.name)}</h4><div class="chips">${tags.map((t) => `<span class="tagc" style="--t:${g.color};--w:${Math.round((counts[t] / people) * 30)}">${esc(g.tags[t])}<b>${counts[t]}</b></span>`).join('')}</div></div>`;
  }).join('');
  return `<article class="prof glass" style="${themeStyle(theme)}">
    <header><span class="face" aria-hidden="true">${esc(initials(p.name))}</span><div><h3>${esc(p.name)}</h3>
      <p class="muted">${esc([...p.courses].slice(0, 3).join(' · '))}${p.courses.size ? ' · ' : ''}${people ? `${people} ${people === 1 ? 'estudiante contó' : 'estudiantes contaron'} lo que sabe` : 'Nadie contó nada todavía'}${p.questions ? ` · ${p.questions} preguntas de sus exámenes en el mapa` : ''}</p></div></header>
    ${groups || '<p class="muted">¿Tomaste clases con este profe? Lo que sabes le sirve a quien se inscribe el próximo semestre.</p>'}
    <div class="actions"><button class="button ghost small" data-tip-for="${esc(p.name)}" data-tip-course="${esc([...p.courses][0] ?? '')}">${p.tips.some((t) => t.id.endsWith(`__${ctx.user.uid}`)) ? 'Cambiar lo que conté' : 'Contar lo que sé'}</button>
      ${p.questions ? `<a class="button ghost small" href="#/mapa">Sus preguntas en el mapa</a>` : ''}</div>
  </article>`;
}
export function renderProfes() {
  $('#profes-where').textContent = 'Comunidad USFQ';
  const q = keyOf($('#p-q').value);
  const list = professors().filter((p) => !q || keyOf(`${p.name} ${[...p.courses].join(' ')}`).includes(q));
  $('#profs').innerHTML = list.length ? list.map(profCard).join('')
    : `<div class="empty glass"><h2>${q ? 'Nadie coincide con esa búsqueda' : 'Todavía nadie contó nada'}</h2><p>${q ? 'Prueba con otro nombre o materia, o cuenta tú lo que sabes.' : 'Sé el primero: ¿qué te hubiera servido saber de tu profe antes de inscribirte?'}</p></div>`;
  rise($('#profs'));
}

function openTip(professor = '', course = '') {
  const dialog = $('#tip-dialog');
  const form = $('#tip-form');
  form.professor.value = professor;
  form.course.value = course;
  const all = professors();
  $('#tip-profs').innerHTML = all.map((p) => `<option value="${esc(p.name)}">`).join('');
  $('#tip-courses').innerHTML = [...new Set([...ctx.state.catalog, ...ctx.state.contributions].map((x) => x.course).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('');
  fillTags();
  $('#tip-msg').textContent = '';
  dialog.showModal();
}
function myTip(name) {
  const key = keyOf(name);
  return (ctx.state.tips ?? []).find((t) => t.prof === key && t.id.endsWith(`__${ctx.user.uid}`));
}
function fillTags() {
  const form = $('#tip-form');
  const mine = myTip(form.professor.value);
  const on = new Set(mine?.tags ?? []);
  $('#tip-title').textContent = mine ? 'Cambia lo que contaste' : 'Lo que sabes de un profe';
  $('#tip-remove').hidden = !mine;
  $('#tip-tags').innerHTML = TIP_GROUPS.map((g) => `<fieldset><legend>${esc(g.name)}</legend><div>${Object.entries(g.tags).map(([id, name]) => `<label style="--t:${g.color}"><input type="checkbox" name="tag" value="${id}" ${on.has(id) ? 'checked' : ''}><span>${esc(name)}</span></label>`).join('')}</div></fieldset>`).join('');
}
const NAME_OK = (s) => s.length >= 3 && s.length <= 80 && !/[0-9@/<>{}]/.test(s);
async function saveTip(remove = false) {
  const form = $('#tip-form');
  const professor = form.professor.value.trim().replace(/\s+/g, ' ');
  const course = form.course.value.trim().replace(/\s+/g, ' ');
  const tags = remove ? [] : [...form.querySelectorAll('input[name="tag"]:checked')].map((i) => i.value);
  if (!NAME_OK(professor)) { $('#tip-msg').textContent = 'Escribe el nombre del profe, sin números ni enlaces.'; return; }
  if (course && !NAME_OK(course)) { $('#tip-msg').textContent = 'Escribe la materia sin números ni enlaces, o déjala vacía.'; return; }
  if (!remove && !tags.length) { $('#tip-msg').textContent = 'Marca al menos un dato.'; return; }
  const prof = keyOf(professor).slice(0, 90);
  const button = $('#tip-save');
  button.disabled = true;
  try {
    await setTip(ctx.user.uid, { prof, professor, course, tags });
    const id = `${prof}__${ctx.user.uid}`;
    ctx.state.tips = (ctx.state.tips ?? []).filter((t) => t.id !== id);
    if (tags.length) ctx.state.tips.push({ id, prof, professor, course, tags, updated: Date.now() });
    $('#tip-dialog').close();
    if (!remove) { burst(innerWidth / 2, innerHeight / 2, 24); sfx.chime(); }
    ctx.toast(remove ? 'Quitamos lo que habías contado.' : '¡Gracias! Quien se inscriba después te lo agradece.');
    renderProfes();
  } catch (error) { $('#tip-msg').textContent = ctx.explain(error); }
  finally { button.disabled = false; }
}

export function mountCommunity(context) {
  ctx = context;
  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kudo]');
    if (k) toggleKudo(k);
    const t = e.target.closest('[data-tip-for]');
    if (t) openTip(t.dataset.tipFor, t.dataset.tipCourse);
  });
  $('#tip-new').addEventListener('click', () => openTip());
  $('#p-q').addEventListener('input', renderProfes);
  $('#tip-form').professor.addEventListener('change', fillTags);
  $('#tip-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    saveTip();
  });
  $('#tip-remove').addEventListener('click', () => saveTip(true));
}
