// The person's own space: the home page (next exam, goals, focus timer, where they left off, what is new), the
// ambience picker, and the settings. Everything the person chooses lives in prefs.js.
import { prefs, MODES, AMBIENCES, THEMES, AVATARS } from './prefs.js';
import * as ai from './ai.js';
import { sfx } from './sfx.js';
import { celebrate } from './play.js';
import { themeStyle, keyOf } from './themes.js';
import { rise } from './fx.js';

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
  jugueton: '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="58" rx="40" ry="36" fill="var(--blue)"/><ellipse cx="38" cy="56" rx="7" ry="9" fill="#fff"/><ellipse cx="62" cy="56" rx="7" ry="9" fill="#fff"/><circle cx="39" cy="58" r="4" fill="#0b1020"/><circle cx="63" cy="58" r="4" fill="#0b1020"/><path d="M45 72q5 5 10 0" fill="none" stroke="#0b1020" stroke-width="3" stroke-linecap="round"/><circle cx="58" cy="12" r="6" fill="var(--red)"/><path d="M50 22c0-6 3-9 7-10" fill="none" stroke="var(--blue)" stroke-width="3"/></svg>',
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

function countdownTile() {
  const next = upcoming()[0];
  if (!next) {
    return `<section class="tile glass" style="--span:7"><h2>Tu próximo examen</h2><p class="muted">No hay guías con una fecha por venir. Cuando alguien publique la guía de tu próximo examen, aquí verás cuánto falta.</p>
      <div class="actions"><a class="button ghost" href="#/guias">Ver todas las guías</a><a class="button primary" href="#/aportar/guia">Crear una guía</a></div></section>`;
  }
  const n = daysTo(next.date);
  return `<section class="tile solid-blue" style="--span:7" data-tilt="3">
    <p class="kicker d">Tu próximo examen · ${esc(longDate(next.date))}</p>
    <div class="countdown d" style="--d:26"><span class="big" data-countdown="${esc(next.date)}">${n === 0 ? 'Hoy' : n}<small>${n === 0 ? '' : n === 1 ? ' día' : ' días'}</small></span>
      <h3>${esc(next.course)}: ${esc(next.title)}</h3><p class="muted">${esc([next.professor, next.term].filter(Boolean).join(' · '))}</p></div>
    <div class="actions d" style="--d:14"><a class="button primary" href="#/guia/${encodeURIComponent(next.id)}">Abrir la guía</a>
      <button class="button ghost" data-goal-for="${esc(next.id)}">Ponérmelo como meta</button></div>
  </section>`;
}

function goalsTile() {
  const { goals } = prefs.get();
  const done = goals.filter((g) => g.done).length;
  const p = goals.length ? Math.round((done / goals.length) * 100) : 0;
  const suggestions = upcoming().slice(0, 3).filter((g) => !goals.some((x) => x.guide === g.id));
  return `<section class="tile glass" style="--span:5" id="goals-tile">
    <div class="goal-head"><div class="ring" style="--p:${p}">${done}/${goals.length}</div><div><h2>Metas</h2><p class="muted">${goals.length ? (done === goals.length ? 'Cumpliste todas. Pon la siguiente.' : 'Marca cada una cuando la cumplas.') : 'Pequeñas y concretas: «Subredes a mano», «Simulacro», «Repasar RIP».'}</p></div></div>
    ${goals.length ? `<ul class="goals">${goals.map((g) => `<li class="goal ${g.done ? 'done' : ''}" data-goal="${esc(g.id)}">
        <label><input type="checkbox" ${g.done ? 'checked' : ''} data-goal-check="${esc(g.id)}"><span class="box"><svg viewBox="0 0 24 24"><use href="#i-check"/></svg></span></label>
        <span class="text">${esc(g.text)}</span>
        <button class="icon x" data-goal-remove="${esc(g.id)}" aria-label="Quitar esta meta"><svg><use href="#i-x"/></svg></button></li>`).join('')}</ul>` : ''}
    <form class="goal-add" id="goal-add"><input name="text" maxlength="140" placeholder="Nueva meta" aria-label="Nueva meta" autocomplete="off"><button class="button primary">Agregar</button></form>
    ${suggestions.length ? `<div class="suggest">${suggestions.map((g) => `<button class="chip new" data-goal-for="${esc(g.id)}">+ Terminar ${esc(g.title)}</button>`).join('')}</div>` : ''}
  </section>`;
}

function timerTile(span = 4) {
  return `<section class="tile glass" style="--span:${span}"><h2>Enfoque <small>25 min de estudio, 5 de descanso</small></h2>
    <div class="timer" id="timer"><div class="face" style="--p:100"><b id="timer-left">25:00</b><small id="timer-what">Estudio</small></div>
      <div class="actions"><button class="button primary" id="timer-go">Empezar</button><button class="button ghost" id="timer-reset">Reiniciar</button></div></div></section>`;
}

function guideRow(g) {
  const state = prefs.get().progress[g.id];
  return `<a class="mini-guide" href="#/guia/${encodeURIComponent(g.id)}" style="${themeStyle(ctx.state.themes.get(keyOf(g.course)) ?? g.theme)}">
    <span class="swatch-sq" aria-hidden="true"></span>
    <span><strong>${esc(g.title)}</strong><span class="muted">${esc(g.course)}</span></span>
    <span class="state ${state === 'done' ? 'done' : ''}">${state === 'done' ? 'Terminada' : state === 'reading' ? 'Leyendo' : soonLabel(g.date) || 'Abrir'}</span></a>`;
}
function recentTile(span = 8) {
  const ids = recent();
  const list = ids.map((id) => ctx.state.catalog.find((g) => g.id === id)).filter(Boolean).slice(0, 4);
  return `<section class="tile glass" style="--span:${span}"><h2>Sigue donde quedaste</h2>
    ${list.length ? `<div class="mini-guides">${list.map(guideRow).join('')}</div>` : '<p class="muted">Las guías que abras aparecen aquí, con cuáles ya terminaste.</p>'}</section>`;
}
function newsTile() {
  const latest = [...ctx.state.catalog].sort((a, b) => b.updated - a.updated).slice(0, 4);
  const concepts = ctx.state.graph?.nodes.filter((n) => n.type === 'concept').length ?? 0;
  return `<section class="tile glass" style="--span:12"><h2>Lo nuevo en tu comunidad <small>${ctx.state.catalog.length} ${ctx.state.catalog.length === 1 ? 'guía' : 'guías'} · ${ctx.state.contributions.length} aportes · ${concepts} conceptos en el mapa</small></h2>
    ${latest.length ? `<div class="mini-guides" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${latest.map(guideRow).join('')}</div>` : '<p class="muted">Todavía no hay guías. La primera puede ser la tuya.</p>'}
    <div class="actions"><a class="button ghost" href="#/guias">Todas las guías</a><a class="button ghost" href="#/mapa">El mapa</a><a class="button ghost" href="#/profes">Profes</a></div></section>`;
}
function exploreTile() {
  const concepts = ctx.state.graph?.nodes.filter((n) => n.type === 'concept' && !n.ghost && n.summaries?.length) ?? [];
  const c = concepts[Math.floor(Math.random() * concepts.length)];
  return `<section class="tile glass" style="--span:5"><h2>Un concepto al azar</h2>
    ${c ? `<h3 style="font-size:30px;letter-spacing:-.03em">${esc(c.name)}</h3><p class="muted">${esc(c.summaries[0].text)}</p><div class="actions"><a class="button primary" href="#/mapa/${encodeURIComponent(c.id)}">Verlo en el mapa</a><button class="button ghost" data-reroll>Otro</button></div>`
    : '<p class="muted">Cuando el mapa tenga conceptos, aquí aparece uno distinto cada vez.</p>'}</section>`;
}
function onboardTile() {
  const p = prefs.get();
  return `<section class="tile glass onboard"><h2>Hazlo tuyo <small>Lo cambias cuando quieras en Ajustes</small></h2>
    <p class="muted">¿Cómo estudias? Eso decide qué ves primero aquí.</p>
    <div class="row" role="radiogroup">${Object.entries(MODES).map(([id, m]) => `<button type="button" class="pick" role="radio" aria-checked="${p.mode === id}" data-set-mode="${id}"><strong>${esc(m.name)}</strong><span>${esc(m.text)}</span></button>`).join('')}</div>
    <div class="actions"><button class="button primary" data-onboard-done>Listo</button></div></section>`;
}

export function renderHome() {
  const p = prefs.get();
  $('#home-hello').textContent = `${hello()}${p.nickname ? `, ${p.nickname}` : ''}.`;
  $('#home-where').textContent = ['Comunidad USFQ', p.semester ? `${p.semester}.º semestre` : '', p.career].filter(Boolean).join(' · ');
  $('#home-sub').textContent = SUB[p.mode];
  const order = {
    examenes: [countdownTile, goalsTile, () => timerTile(4), () => recentTile(8), newsTile],
    gusto: [exploreTile, () => recentTile(7), newsTile, goalsTile, () => timerTile(7)],
    intensivo: [() => timerTile(5), countdownTile, goalsTile, () => recentTile(7), newsTile],
    metas: [goalsTile, countdownTile, () => recentTile(7), () => timerTile(5), newsTile],
  }[p.mode];
  const html = order.map((f) => f()).join('');
  $('#dash').innerHTML = (prefs.fresh && !sessionStorage.getItem('studium-onboarded') ? onboardTile() : '') + html;
  for (const el of document.querySelectorAll('[data-ambience-picker]')) renderAmbiences(el);
  syncTimer();
  rise($('#dash'));
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
const timer = { mode: 'study', left: 25 * 60, total: 25 * 60, running: false, id: 0, end: 0 };
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
    timer.total = timer.left = (timer.mode === 'study' ? 25 : 5) * 60;
    timer.end = Date.now() + timer.left * 1000;
    ctx?.toast(timer.mode === 'break' ? 'Bloque cumplido. Cinco minutos de descanso.' : 'Descanso terminado. Otro bloque.');
  }
  document.title = timer.running ? `${$('#timer-left')?.textContent ?? ''} · Studium` : document.title;
  syncTimer();
}

/* ---------- settings ---------- */
export function renderSettings() {
  const p = prefs.get();
  const careers = ctx.state.graph?.nodes.filter((n) => n.type === 'career').map((n) => n.name) ?? [];
  $('#settings').innerHTML = `
    <section class="set glass"><h2>Tú</h2><p>Esto lo ves solo tú, salvo tu nombre público: aparece únicamente en lo que decidas firmar.</p>
      <div class="grid3">
        <label class="field"><span>Cómo te llamamos</span><input data-pref="nickname" maxlength="40" value="${esc(p.nickname)}" placeholder="Opcional"></label>
        <label class="field"><span>Carrera</span><input data-pref="career" maxlength="80" list="careers" value="${esc(p.career)}" placeholder="Por ejemplo, Computación"><datalist id="careers">${careers.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Semestre</span><select data-pref="semester"><option value="0">—</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${p.semester === i + 1 ? 'selected' : ''}>${i + 1}.º</option>`).join('')}</select></label>
      </div>
      <div class="grid3">
        <label class="field"><span>Nombre público (para firmar)</span><input data-pref="name" maxlength="60" value="${esc(p.name)}" placeholder="Opcional: como quieres que te reconozcan"></label>
        <fieldset class="avatars"><legend>Tu color</legend>${AVATARS.map((c) => `<label><input type="radio" name="avatar" value="${c}" data-pref="avatar" ${p.avatar === c ? 'checked' : ''}><span style="--c:var(--${c})" aria-label="${c}"></span></label>`).join('')}</fieldset>
        <fieldset class="seg"><legend>Idioma</legend><label><input type="radio" name="lang" value="es" data-pref="lang" ${p.lang === 'es' ? 'checked' : ''}><span>Español</span></label><label><input type="radio" name="lang" value="en" data-pref="lang" ${p.lang === 'en' ? 'checked' : ''}><span>English</span></label></fieldset>
      </div></section>
    ${aiSettings()}
    <section class="set glass"><h2>Cómo estudias</h2><p>Cambia el orden de tu inicio.</p>
      <div class="picks" role="radiogroup">${Object.entries(MODES).map(([id, m]) => `<button type="button" class="pick" role="radio" aria-checked="${p.mode === id}" data-set-mode="${id}"><strong>${esc(m.name)}</strong><span>${esc(m.text)}</span></button>`).join('')}</div></section>
    <section class="set glass"><h2>Ambiente</h2><p>Cuánto se mueve la página, y qué tan tierna se pone.</p><div class="ambiences" data-ambience-picker></div></section>
    <section class="set glass"><h2>Sonidos</h2>
      <label class="toggle"><input type="checkbox" data-pref="sound" ${p.sound ? 'checked' : ''}><span class="knob"></span>Sonidos al lanzar cosas, al cumplir una meta y al terminar un bloque de enfoque</label>
      <div class="actions"><button class="button ghost" data-sound-test>Probar</button></div></section>
    <section class="set glass"><h2>Día o noche</h2>
      <fieldset class="seg"><legend class="sr">Tema</legend>${Object.entries(THEMES).map(([id, name]) => `<label><input type="radio" name="theme" value="${id}" data-pref="theme" ${p.theme === id ? 'checked' : ''}><span>${esc(name)}</span></label>`).join('')}</fieldset></section>
    <section class="set glass"><h2>Tu comunidad</h2>
      <p>Perteneces a la comunidad <strong>USFQ</strong>. Tus ajustes, metas y progreso se guardan en tu cuenta y solo los ves tú.</p></section>`;
  renderAmbiences($('#settings [data-ambience-picker]'));
  rise($('#settings'));
}

/* ---------- your AI ---------- */
function aiSettings() {
  const c = ai.config();
  const pr = ai.PROVIDERS[c.provider];
  return `<section class="set glass" id="set-ai"><h2>Tu IA</h2>
    <p>Conecta tu propia IA y Studium la usa para procesar tu material, crear guías a tu medida, identificar documentos y
      editar tus guías por partes. <strong>Studium no cobra nada</strong>: tu proveedor cobra lo que use tu clave, según su tarifa.</p>
    <div class="grid3">
      <label class="field"><span>Proveedor</span><select data-ai="provider">${Object.entries(ai.PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === c.provider ? 'selected' : ''}>${esc(v.name)} (${esc(v.by)})</option>`).join('')}</select></label>
      <label class="field"><span>Tu clave de API</span><input data-ai="key" type="password" autocomplete="off" spellcheck="false" value="${esc(c.key)}" placeholder="${esc(pr.keyHint)}"></label>
      <label class="field"><span>Esfuerzo</span><select data-ai="effort">${Object.entries(ai.EFFORTS).map(([k, v]) => `<option value="${k}" ${k === c.effort ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    </div>
    <div class="grid3">
      <label class="field" style="grid-column:span 2"><span>Modelo</span><input data-ai="model" list="ai-models" value="${esc(c.model || pr.model)}" placeholder="Pulsa «Probar» para ver los modelos de tu cuenta"><datalist id="ai-models"></datalist></label>
      <div class="actions" style="align-self:end"><button class="button primary" data-ai-test>Probar</button><button class="link" data-ai-forget>Borrar mi clave</button></div>
    </div>
    <p class="msg" id="ai-msg" role="status"></p>
    <p class="hint">La clave se guarda solo en este navegador: no llega a la base de datos de Studium ni a su creador. En un
      computador compartido, bórrala al terminar. <a href="${esc(pr.keys)}" target="_blank" rel="noopener noreferrer">¿Dónde consigo una clave de ${esc(pr.name)}?</a></p>
    <p class="fine">Con tu suscripción de Claude o ChatGPT, sin clave: llega con el conector de Studium.</p>
  </section>`;
}
async function testAI() {
  const msg = $('#ai-msg');
  msg.classList.remove('ok');
  msg.textContent = 'Probando…';
  try {
    const list = await ai.models();
    $('#ai-models').innerHTML = list.map((m) => `<option value="${esc(m)}">`).join('');
    const c = ai.config();
    if (!c.model || !list.includes(c.model)) {
      const pick = list.includes(ai.PROVIDERS[c.provider].model) ? ai.PROVIDERS[c.provider].model : list[0];
      ai.save({ ...c, model: pick ?? '' });
      const input = document.querySelector('[data-ai="model"]');
      if (input) input.value = pick ?? '';
    }
    msg.classList.add('ok');
    msg.textContent = `Conectada: tu cuenta tiene ${list.length} ${list.length === 1 ? 'modelo' : 'modelos'}. Usará ${ai.label()}.`;
    sfx.chime();
  } catch (error) { msg.textContent = error.message; }
}

let savedTimer = 0;
export function mountSpace(context) {
  ctx = context;
  bindAmbiences();
  prefs.on((p, patch) => {
    if (patch.saved) { const el = $('#saved'); el.classList.add('on'); clearTimeout(savedTimer); savedTimer = setTimeout(() => el.classList.remove('on'), 1600); }
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-goal-for]');
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
    if (t.dataset.aiTest !== undefined) testAI();
    if (t.dataset.aiForget !== undefined) { ai.forget(); renderSettings(); ctx?.toast('Tu clave se borró de este navegador.'); }
    if (t.dataset.soundTest !== undefined) { sfx.enable(true); sfx.chime(); if (!prefs.get().sound) setTimeout(() => sfx.enable(false), 900); }
    if (t.id === 'timer-go') {
      timer.running = !timer.running;
      clearInterval(timer.id);
      if (timer.running) { timer.end = Date.now() + timer.left * 1000; timer.id = setInterval(tickTimer, 1000); sfx.tick(); }
      syncTimer();
    }
    if (t.id === 'timer-reset') { clearInterval(timer.id); Object.assign(timer, { mode: 'study', left: 1500, total: 1500, running: false }); syncTimer(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.goalCheck) {
      const goals = prefs.get().goals.map((g) => (g.id === t.dataset.goalCheck ? { ...g, done: t.checked } : g));
      prefs.set({ goals });
      if (t.checked) {
        const r = t.closest('.goal').getBoundingClientRect();
        celebrate(r.left + 30, r.top + r.height / 2, goals.every((g) => g.done));
      }
      setTimeout(renderHome, t.checked ? 650 : 0);
    }
    if (t.dataset.ai) {
      const c = ai.config();
      const next = ai.save({ ...c, [t.dataset.ai]: t.value, ...(t.dataset.ai === 'provider' ? { model: '' } : {}) });
      if (t.dataset.ai === 'provider') renderSettings();
      else if (t.dataset.ai === 'key' && next.key) testAI();
    }
    if (t.dataset.pref) {
      const k = t.dataset.pref;
      const v = t.type === 'checkbox' ? t.checked : k === 'semester' ? Number(t.value) : t.value;
      prefs.set({ [k]: v });
      if (k === 'sound' && v) { sfx.enable(true); sfx.chime(); }
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'goal-add') return;
    e.preventDefault();
    addGoal(e.target.text.value);
  });
}
