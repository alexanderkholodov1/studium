// Studium: sign-in for accounts of one domain, the guides by course, the knowledge map, contributing, and the viewer.
// Guides and contributions live only in the database; nothing of their content is in this bundle.
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { allowedDomain, audience, confirmEmail } from './config.js';
import { auth, loadAll, loadGuide } from './data.js';
import { keyOf, themeStyle, courseThemes } from './themes.js';
import { LEVELS, QUESTION_KINDS, RELATIONS, countKind } from './prompts.js';
import { buildGraph, upcoming, GraphView } from './graph.js';
import { prepareGuide, showAnchor } from './viewer.js';
import { startSky, liquid, glassLight, transition, rise } from './fx.js';
import { mountContribute, renderPane } from './contribute.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const allowed = (email) => typeof email === 'string' && email.toLowerCase().endsWith(`@${allowedDomain}`) && email.indexOf('@') > 0;
// Where the e-mail links send the person back: this page, without the route.
const returnUrl = () => location.href.split('#')[0];
const root = document.documentElement;

startSky();
glassLight();
for (const el of document.querySelectorAll('[data-liquid]')) liquid(el, JSON.parse(el.dataset.liquid || '{}'));

const VIEWS = ['boot', 'auth', 'verify', 'denied', 'catalog', 'map', 'contribute', 'guide'];
const TABS = { catalog: 'guides', map: 'map', contribute: 'contribute' };
let current = 'boot';
function show(view) {
  const swap = () => {
    for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
    const inside = !!TABS[view] || view === 'guide';
    $('#nav').hidden = !inside || view === 'guide';
    $('#tabbar').hidden = !TABS[view];
    $('#foot').hidden = view === 'guide' || view === 'map';
    root.classList.toggle('quiet', view === 'map' || view === 'guide');
    for (const a of document.querySelectorAll('[data-tab]')) a.setAttribute('aria-current', String(a.dataset.tab === TABS[view]));
    moveDrop();
    const user = auth.currentUser;
    $('#who-email').textContent = user?.email ?? '';
    $('#initial').textContent = (user?.email ?? '?')[0].toUpperCase();
    current = view;
  };
  if (view === current) swap(); else transition(swap);
}
// The tab indicator: a drop of glass that slides to the current tab.
function moveDrop() {
  const tab = document.querySelector('#nav [aria-current="true"]');
  const drop = $('#nav .drop');
  if (!tab || !drop) { if (drop) drop.style.opacity = '0'; return; }
  drop.style.opacity = '1';
  drop.style.width = `${tab.offsetWidth}px`;
  drop.style.transform = `translateX(${tab.offsetLeft}px)`;
}
addEventListener('resize', moveDrop);

const MESSAGES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'Ese correo no es válido.',
  'auth/email-already-in-use': `Ya existe una cuenta con ese correo. Entra con tu contraseña${confirmEmail ? ' o usa «Olvidé mi contraseña»' : ''}.`,
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/password-does-not-meet-requirements': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.',
  'auth/network-request-failed': 'Sin conexión. Revisa tu internet y vuelve a probar.',
  'auth/user-disabled': 'Esta cuenta está desactivada.',
  'permission-denied': 'Tu cuenta no tiene permiso para esto. Recarga la página; si sigue igual, sal y vuelve a entrar.',
  unavailable: 'Sin conexión. Revisa tu internet y vuelve a probar.',
};
const explain = (error) => MESSAGES[error?.code] ?? 'Algo falló. Vuelve a intentarlo en un momento.';

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  el.classList.remove('out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 400); }, 3600);
}

/* ---------- theme ---------- */
document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('studium-theme', root.dataset.theme); } catch { /* the choice just is not remembered */ }
}));

/* ---------- account menu ---------- */
const menu = $('#account-menu');
$('#account').addEventListener('click', () => { menu.hidden = !menu.hidden; $('#account').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.account')) { menu.hidden = true; $('#account').setAttribute('aria-expanded', 'false'); } });
menu.addEventListener('click', (e) => { if (e.target.closest('a, button')) menu.hidden = true; });

/* ---------- sign in / create account ---------- */
let mode = 'in';
function setMode(next) {
  mode = next;
  $('#tab-in').setAttribute('aria-selected', String(mode === 'in'));
  $('#tab-up').setAttribute('aria-selected', String(mode === 'up'));
  $('#auth-submit').textContent = mode === 'in' ? 'Entrar' : 'Crear cuenta';
  $('#password').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
  $('#pw-hint').hidden = mode === 'in';
  // Password recovery is part of the e-mail flow.
  $('#forgot').hidden = mode === 'up' || !confirmEmail;
  $('#auth-lead').innerHTML = mode === 'in'
    ? `Entra con tu correo <strong>@${esc(allowedDomain)}</strong>.`
    : `Crea tu cuenta con tu correo <strong>@${esc(allowedDomain)}</strong>.${confirmEmail ? ' Te enviaremos un enlace para confirmar que es tuyo.' : ''}`;
  $('#auth-msg').textContent = '';
}
$('#tab-in').addEventListener('click', () => setMode('in'));
$('#tab-up').addEventListener('click', () => setMode('up'));
setMode('in');
$('#auth-audience').textContent = `Para ${audience}.`;

const say = (sel, text, ok = false) => { const el = $(sel); el.textContent = text; el.classList.toggle('ok', ok); };
async function busy(button, work) {
  button.disabled = true;
  try { await work(); } finally { button.disabled = false; }
}
$('#auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!allowed(email)) return say('#auth-msg', `Usa tu correo estudiantil: termina en @${allowedDomain}.`);
  if (password.length < 6) return say('#auth-msg', 'La contraseña debe tener al menos 6 caracteres.');
  say('#auth-msg', '');
  busy($('#auth-submit'), async () => {
    try {
      if (mode === 'in') await signInWithEmailAndPassword(auth, email, password);
      else {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        if (confirmEmail) await sendConfirmation(user);
      }
    } catch (error) { say('#auth-msg', explain(error)); }
  });
});
$('#forgot').addEventListener('click', () => {
  const email = $('#email').value.trim();
  if (!allowed(email)) return say('#auth-msg', `Escribe arriba tu correo @${allowedDomain} y vuelve a pulsar «Olvidé mi contraseña».`);
  busy($('#forgot'), async () => {
    try {
      await sendPasswordResetEmail(auth, email, { url: returnUrl() });
      say('#auth-msg', `Si existe una cuenta con ${email}, te llegará un enlace para elegir una contraseña nueva.`, true);
    } catch (error) { say('#auth-msg', explain(error)); }
  });
});

/* ---------- confirm the address ---------- */
// The account exists as soon as it is created, so the app has already moved to the confirmation screen when the
// e-mail is sent: a failure is reported there, and kept so that a re-render does not wipe it.
let verifyNote = '';
async function sendConfirmation(user) {
  try { await sendEmailVerification(user, { url: returnUrl() }); verifyNote = ''; }
  catch (error) { verifyNote = `No pudimos enviar el enlace: ${explain(error)} Pulsa «Reenviar enlace».`; }
  say('#verify-msg', verifyNote);
}
// Firebase only writes email_verified into a new ID token: after the link is opened, reload the user and refresh it.
async function recheck() {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (!user.emailVerified) return false;
  await user.getIdToken(true);
  await route();
  return true;
}
$('#verify-check').addEventListener('click', () => busy($('#verify-check'), async () => {
  try { if (!await recheck()) say('#verify-msg', 'Todavía no aparece confirmado. Abre el enlace del correo y vuelve a pulsar.'); }
  catch (error) { say('#verify-msg', explain(error)); }
}));
$('#verify-resend').addEventListener('click', () => busy($('#verify-resend'), async () => {
  try { await sendEmailVerification(auth.currentUser, { url: returnUrl() }); verifyNote = ''; say('#verify-msg', 'Listo: enviamos otro enlace.', true); }
  catch (error) { verifyNote = explain(error); say('#verify-msg', verifyNote); }
}));
// Coming back from the e-mail tab is the usual moment the address has just been confirmed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#view-verify').hidden) recheck().catch(() => {});
});

const leave = () => signOut(auth).then(() => { location.hash = ''; });
for (const id of ['#sign-out', '#verify-other', '#denied-out']) $(id).addEventListener('click', leave);

/* ---------- data ---------- */
const state = { catalog: [], contributions: [], graph: null, themes: new Map(), loaded: false };
let loading = null;
async function load(force = false) {
  if (state.loaded && !force) return state;
  loading ??= (async () => {
    const data = await loadAll(auth.currentUser?.uid);
    Object.assign(state, data, {
      graph: buildGraph(data),
      themes: courseThemes([...data.catalog, ...data.contributions.filter((c) => c.kind !== 'curriculum')]),
      loaded: true,
    });
    return state;
  })().finally(() => { loading = null; });
  return loading;
}
async function refresh() {
  await load(true);
  if (current === 'catalog') renderCatalog();
  if (map) map.setGraph(state.graph, { animate: false });
}
const context = { state, get user() { return { uid: auth.currentUser?.uid, email: auth.currentUser?.email ?? '' }; }, refresh, toast, explain };

/* ---------- guides by course ---------- */
const day = (d) => (d ? new Date(`${d}T12:00:00`) : null);
const monthDay = (d) => {
  const date = day(d);
  return date ? `<span class="d">${date.getDate()}</span><span class="m">${date.toLocaleDateString('es-EC', { month: 'short' }).replace('.', '')}</span>` : '';
};
let courseFilter = '';
function renderCatalog() {
  const q = keyOf($('#q').value);
  const courses = state.graph.nodes.filter((n) => n.type === 'course' && (n.guides.length || n.contributions.length));
  const matches = (x) => !q || keyOf(JSON.stringify([x.course, x.title, x.professor, x.term, x.topics, x.concepts, x.code])).includes(q);
  $('#course-chips').innerHTML = courses.length > 1
    ? [`<button class="chip ${courseFilter ? '' : 'on'}" data-course="">Todas</button>`, ...courses.map((c) => `<button class="chip ${courseFilter === c.id ? 'on' : ''}" data-course="${esc(c.id)}" style="${themeStyle(c.theme)}"><i></i>${esc(c.name)}</button>`)].join('')
    : '';
  const shown = courses.filter((c) => (!courseFilter || c.id === courseFilter) && (matches({ course: c.name, code: c.code }) || c.guides.some(matches)));
  $('#courses').innerHTML = shown.length ? shown.map((c) => {
    const guides = c.guides.filter((g) => matches(g) || matches({ course: c.name })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const concepts = state.graph.links.filter((l) => l.kind === 'in' && l.source === c).length;
    const people = [...c.professors.keys()];
    return `<section class="course" style="${themeStyle(c.theme)}">
      <div class="course-art" aria-hidden="true"></div>
      <header>
        <div>
          <p class="course-code">${esc([c.code, c.contributions.find((x) => x.university)?.university ?? c.guides.find((x) => x.university)?.university].filter(Boolean).join(' · '))}</p>
          <h2>${esc(c.name)}</h2>
          <p class="course-meta">${people.length ? `${esc(people.slice(0, 3).join(', '))}${people.length > 3 ? ` y ${people.length - 3} más` : ''}. ` : ''}${c.contributions.length} ${c.contributions.length === 1 ? 'aporte' : 'aportes'}, ${concepts} conceptos.</p>
        </div>
        <div class="course-actions">
          <a class="button ghost" href="#/mapa/${encodeURIComponent(c.id)}">Ver en el mapa</a>
          <a class="button primary" href="#/aportar/guia/${encodeURIComponent(c.id)}">Crear una guía</a>
        </div>
      </header>
      ${guides.length ? `<ul class="guides">${guides.map((g) => `<li><a class="guide-row lit" href="#/guia/${encodeURIComponent(g.id)}">
          <span class="when">${monthDay(g.date)}</span>
          <span class="body"><strong>${esc(g.title)}</strong>
            <span class="muted">${esc([g.professor, g.term].filter(Boolean).join(', '))}${g.level ? ` <span class="level">${esc(LEVELS[g.level])}</span>` : ''}${g.visibility === 'private' ? ' <span class="level private">Solo tú</span>' : ''}</span>
            <span class="tags">${(g.topics?.length ? g.topics : g.concepts ?? []).slice(0, 6).map((t) => `<span>${esc(t)}</span>`).join('')}</span></span>
          <svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a></li>`).join('')}</ul>`
        : `<p class="no-guides">Todavía no hay guías de ${esc(c.name)}. Con ${c.contributions.length === 1 ? 'el aporte que hay' : `los ${c.contributions.length} aportes que hay`}, tu IA puede crear la primera.</p>`}
    </section>`;
  }).join('') : `<div class="empty glass">${courses.length
    ? '<h2>Nada coincide con esa búsqueda</h2><p>Prueba con otra materia, tema o profesor.</p>'
    : '<h2>Studium está empezando</h2><p>Aporta tus exámenes, deberes o apuntes: con ellos se arma el mapa de tu materia y se crean las guías.</p><a class="button primary" href="#/aportar">Aportar material</a>'}</div>`;
  rise($('#courses'));
}
$('#q').addEventListener('input', renderCatalog);
$('#course-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-course]'); if (b) { courseFilter = b.dataset.course; renderCatalog(); } });

/* ---------- map ---------- */
let map = null;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
async function openMap(nodeId) {
  if (!map) {
    map = new GraphView($('#map-canvas'), {
      onSelect: (n) => panel(n),
      onOpen: (n) => { if (n.type === 'guide') location.hash = `#/guia/${encodeURIComponent(n.entry.id)}`; },
    });
    mapTools();
  }
  const empty = !state.graph.nodes.length;
  $('#map-empty').hidden = !empty;
  fillTools();
  if (map.graph !== state.graph) map.setGraph(state.graph);
  const node = nodeId && state.graph.byId.get(nodeId);
  if (node) setTimeout(() => map.select(node, { fly: true }), 300);
}
const prefs = { get() { try { return JSON.parse(localStorage.getItem('studium-map') ?? '{}'); } catch { return {}; } }, set(v) { try { localStorage.setItem('studium-map', JSON.stringify(v)); } catch { /* not remembered */ } } };
function fillTools() {
  const g = state.graph;
  const careers = g.nodes.filter((n) => n.type === 'career');
  const p = prefs.get();
  $('#map-career').innerHTML = `<option value="">Todas las carreras</option>${careers.map((c) => `<option value="${esc(c.id)}" ${p.career === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  $('#map-career').hidden = !careers.length;
  const plan = g.byId.get($('#map-career').value);
  const count = plan ? plan.semesters.length - 1 : 0;
  $('#map-semester').innerHTML = `<option value="0">Mi semestre</option>${Array.from({ length: Math.max(0, count) }, (_, i) => `<option value="${i + 1}" ${p.semester === i + 1 ? 'selected' : ''}>Estoy en ${i + 1}.º</option>`).join('')}`;
  $('#map-semester').hidden = !plan;
  const profs = [...new Set(g.nodes.filter((n) => n.type === 'course').flatMap((n) => [...n.professors.keys()]))].sort();
  $('#map-prof').innerHTML = `<option value="">Todos los profesores</option>${profs.map((x) => `<option>${esc(x)}</option>`).join('')}`;
  $('#map-names').innerHTML = g.nodes.filter((n) => n.type !== 'guide').map((n) => `<option value="${esc(n.name)}">`).join('');
  const courses = g.nodes.filter((n) => n.type === 'course' && !n.planned);
  $('#map-legend').innerHTML = courses.map((c) => `<button class="chip on" data-legend="${esc(c.id)}" style="${themeStyle(c.theme)}"><i></i>${esc(c.name)}</button>`).join('');
  applyTools();
}
function applyTools() {
  const off = new Set([...document.querySelectorAll('#map-legend .chip:not(.on)')].map((b) => b.dataset.legend));
  const all = state.graph.nodes.filter((n) => n.type === 'course').map((n) => n.id);
  const career = $('#map-career').value;
  const semester = Number($('#map-semester').value) || 0;
  prefs.set({ career, semester });
  map?.setFilter({ courses: off.size ? new Set(all.filter((id) => !off.has(id))) : null, professor: $('#map-prof').value, career, semester });
}
function mapTools() {
  $('#map-career').addEventListener('change', () => { prefs.set({ career: $('#map-career').value, semester: 0 }); fillTools(); setTimeout(() => map.fit(), 900); });
  $('#map-semester').addEventListener('change', applyTools);
  $('#map-prof').addEventListener('change', applyTools);
  $('#map-legend').addEventListener('click', (e) => { const b = e.target.closest('[data-legend]'); if (b) { b.classList.toggle('on'); applyTools(); } });
  $('#map-fit').addEventListener('click', () => map.fit());
  $('#map-grow').addEventListener('click', () => map.playGrowth());
  $('#map-zoom-in').addEventListener('click', () => map.zoomBy(1.3));
  $('#map-zoom-out').addEventListener('click', () => map.zoomBy(0.77));
  $('#map-q').addEventListener('change', () => {
    const key = keyOf($('#map-q').value);
    const node = state.graph.nodes.find((n) => keyOf(n.name) === key) ?? state.graph.nodes.find((n) => keyOf(n.name).includes(key));
    if (node) map.select(node, { fly: true });
  });
  $('#map-panel').addEventListener('click', (e) => {
    const go = e.target.closest('[data-node]');
    if (go) { map.select(state.graph.byId.get(go.dataset.node), { fly: true }); return; }
    if (e.target.closest('#panel-close')) map.select(null);
  });
}
const chipsOf = (nodes) => nodes.map((n) => `<button class="chip" data-node="${esc(n.id)}" style="${themeStyle(n.theme ?? state.graph.byId.get([...(n.courses ?? [])][0] ?? '')?.theme)}"><i></i>${esc(n.name)}</button>`).join('');
function panel(n) {
  const el = $('#map-panel');
  if (!n) { el.hidden = true; return; }
  const g = state.graph;
  const close = '<button class="icon" id="panel-close" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>';
  let html = '';
  if (n.type === 'concept') {
    const courses = [...n.courses].map((id) => g.byId.get(id)).filter(Boolean);
    const byWho = new Map();
    for (const q of n.questions) {
      const who = [q.professor || q.course, q.term].filter(Boolean).join(', ');
      byWho.set(who, [...(byWho.get(who) ?? []), q]);
    }
    const rel = n.relations.filter((r, i, all) => all.findIndex((x) => x.key === r.key && x.kind === r.kind) === i);
    html = `<p class="kicker">${n.ghost ? 'Concepto mencionado' : 'Concepto'}</p><h2>${esc(n.name)}</h2>
      <div class="chips small">${chipsOf(courses)}</div>
      ${n.summaries.slice(0, 2).map((s) => `<p>${esc(s.text)}</p>`).join('') || (n.ghost ? '<p class="muted">Otros conceptos lo mencionan, pero ningún aporte lo explica todavía.</p>' : '')}
      ${rel.length ? `<h3>Relaciones</h3><ul class="rel">${rel.slice(0, 14).map((r) => {
        const other = `<button class="link" data-node="concept:${esc(r.key)}">${esc(g.byId.get(`concept:${r.key}`)?.name ?? r.name)}</button>`;
        const verb = esc(RELATIONS[r.kind] ?? 'se relaciona con');
        return `<li>${r.out ? `<span class="muted">${verb[0].toUpperCase()}${verb.slice(1)}</span> ${other}` : `${other} <span class="muted">${verb} este concepto</span>`}</li>`;
      }).join('')}</ul>` : ''}
      ${byWho.size ? `<h3>Cómo lo preguntan</h3>${[...byWho].map(([who, qs]) => {
        const kinds = {};
        for (const q of qs) kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
        return `<details class="asked"><summary><strong>${esc(who || 'Sin profesor')}</strong> <span class="muted">${plural(qs.length, 'pregunta', 'preguntas')}: ${Object.entries(kinds).map(([k, c]) => `${esc(QUESTION_KINDS[k] ?? k).toLowerCase()} ${c}`).join(', ')}</span></summary>
          <ul>${qs.slice(0, 5).map((q) => `<li><span class="muted">${esc(q.title)}: ${esc(QUESTION_KINDS[q.kind] ?? '').toLowerCase()}, dificultad ${q.difficulty} de 5</span><p>${esc(q.text)}</p>${q.solution ? `<details><summary>Ver solución</summary><p>${esc(q.solution)}</p></details>` : ''}</li>`).join('')}</ul></details>`;
      }).join('')}` : ''}
      ${n.examples.length ? `<h3>Ejemplos</h3><ul class="ex">${n.examples.slice(0, 3).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
      ${n.guides.length ? `<h3>En guías</h3><ul class="links">${n.guides.map((x) => `<li><a href="#/guia/${encodeURIComponent(x.id)}${x.anchor ? `/${encodeURIComponent(x.anchor)}` : ''}">${esc(x.course)}: ${esc(x.title)}</a></li>`).join('')}</ul>` : ''}`;
  } else if (n.type === 'course') {
    const concepts = g.links.filter((l) => l.kind === 'in' && l.source === n).map((l) => l.target).sort((a, b) => b.weight - a.weight);
    const next = upcoming(g, n);
    const before = g.links.filter((l) => l.kind === 'prerequisite' && l.target === n).map((l) => l.source);
    const counts = {};
    for (const c of n.contributions) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    html = `<p class="kicker">${n.planned ? 'Materia de la malla' : 'Materia o competencia'}</p><h2>${esc(n.name)}</h2>
      <p class="muted">${esc([n.code, ...n.careers.map((c) => `${g.byId.get(c.career)?.name}, semestre ${c.semester}`)].filter(Boolean).join('. '))}</p>
      ${n.contributions.length ? `<p>${Object.entries(counts).map(([k, c]) => esc(countKind(k, c))).join(', ')}${n.professors.size ? `, de ${esc([...n.professors.keys()].join(', '))}` : ''}.</p>` : '<p class="muted">Nadie aportó material de esta materia todavía.</p>'}
      ${before.length ? `<h3>Se necesita antes</h3><div class="chips small">${chipsOf(before)}</div>` : ''}
      ${next.length ? `<h3>Lo que viene después</h3><ul class="next">${next.map((x) => `<li><button class="link" data-node="${esc(x.course.id)}">${esc(x.course.name)}</button>${x.shared.length ? `<span class="muted"> usa ${esc(x.shared.slice(0, 5).map((s) => s.name).join(', '))}${x.shared.length > 5 ? ` y ${x.shared.length - 5} más` : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${concepts.length ? `<h3>Conceptos más evaluados</h3><div class="chips small">${chipsOf(concepts.slice(0, 18))}</div>` : ''}
      <div class="actions">${n.guides.length ? `<a class="button ghost" href="#/">Ver ${plural(n.guides.length, 'guía', 'guías')}</a>` : ''}${n.contributions.length ? `<a class="button primary" href="#/aportar/guia/${encodeURIComponent(n.id)}">Crear una guía</a>` : '<a class="button primary" href="#/aportar">Aportar material</a>'}</div>`;
  } else if (n.type === 'guide') {
    const e = n.entry;
    html = `<p class="kicker">Guía</p><h2>${esc(e.title)}</h2><p class="muted">${esc([n.course.name, e.professor, e.term].filter(Boolean).join(', '))}</p>
      ${e.level ? `<p><span class="level">${esc(LEVELS[e.level])}</span></p>` : ''}
      <div class="actions"><a class="button primary" href="#/guia/${encodeURIComponent(e.id)}">Abrir la guía</a></div>`;
  } else if (n.type === 'career') {
    html = `<p class="kicker">Carrera</p><h2>${esc(n.name)}</h2><p class="muted">${esc(n.university)}</p>
      ${n.semesters.map((ids, s) => (ids?.length ? `<h3>Semestre ${s}</h3><div class="chips small">${chipsOf(ids.map((id) => g.byId.get(id)).filter(Boolean))}</div>` : '')).join('')}`;
  }
  el.innerHTML = close + html;
  el.setAttribute('style', themeStyle(n.type === 'course' ? n.theme : n.type === 'guide' ? n.course.theme : g.byId.get([...(n.courses ?? [])][0] ?? '')?.theme));
  el.hidden = false;
  el.scrollTop = 0;
}

/* ---------- guide viewer ---------- */
const guides = new Map();
$('#guide-full').addEventListener('click', () => $('#guide-frame').requestFullscreen?.());

/* ---------- routing ---------- */
let routing = 0;
async function route() {
  const ticket = ++routing;
  const user = auth.currentUser;
  if (!user) { show('auth'); return; }
  if (!allowed(user.email)) {
    $('#denied-text').textContent = `Studium es para ${audience}: entra con un correo que termine en @${allowedDomain}. Esta sesión es de ${user.email ?? 'otra cuenta'}.`;
    show('denied'); return;
  }
  if (confirmEmail && !user.emailVerified) { $('#verify-email').textContent = user.email; say('#verify-msg', verifyNote); show('verify'); return; }
  const [, page = '', ...rest] = location.hash.replace(/^#\/?/, '#/').split('/');
  const arg = rest.map(decodeURIComponent);
  root.style.removeProperty('--sky-a'); root.style.removeProperty('--sky-b');
  try {
    if (page === 'guia' && arg[0]) {
      const id = arg[0];
      show('guide');
      const known = state.catalog.find((g) => g.id === id);
      $('#guide-title').textContent = known ? `${known.course}: ${known.title}` : '';
      $('#guide-map').href = `#/mapa/guide:${encodeURIComponent(id)}`;
      $('#guide-status').textContent = 'Abriendo la guía…'; $('#guide-status').hidden = false;
      const guide = guides.get(id) ?? await loadGuide(id);
      if (ticket !== routing) return;
      if (!guide) { $('#guide-status').textContent = 'Esa guía no existe o ya no está publicada.'; $('#guide-frame').removeAttribute('srcdoc'); return; }
      guides.set(id, guide);
      if (!known) $('#guide-title').textContent = guide.title;
      if (known) $('#view-guide').setAttribute('style', themeStyle(state.themes.get(keyOf(known.course)) ?? known.theme));
      document.title = `${$('#guide-title').textContent} · Studium`;
      $('#guide-status').hidden = true;
      const frame = $('#guide-frame');
      const html = prepareGuide(guide.html);
      if (frame.dataset.guide !== id) {
        frame.dataset.guide = id;
        frame.addEventListener('load', () => showAnchor(frame, arg[1]), { once: true });
        frame.srcdoc = html;
      } else showAnchor(frame, arg[1]);
      return;
    }
    if (page === 'mapa') {
      document.title = 'Mapa · Studium';
      show('map');
      await load();
      if (ticket !== routing) return;
      await openMap(arg.join('/'));
      return;
    }
    if (page === 'aportar' || page === 'mis-aportes') {
      document.title = 'Aportar · Studium';
      show('contribute');
      await load();
      if (ticket !== routing) return;
      mountContribute(context);
      const pane = page === 'mis-aportes' ? 'mine' : arg[0] === 'guia' ? 'guide' : 'material';
      renderPane(pane, arg[1] ? { course: arg[1] } : undefined);
      return;
    }
    document.title = 'Studium';
    show('catalog');
    if (!state.loaded) $('#courses').innerHTML = '<p class="status">Cargando…</p>';
    await load();
    if (ticket !== routing) return;
    renderCatalog();
  } catch (error) {
    if (ticket !== routing) return;
    console.error(error);
    const where = page === 'guia' ? '#guide-status' : page === 'mapa' ? '#map-empty' : page === 'aportar' ? '#pane-material' : '#courses';
    $(where).hidden = false;
    $(where).textContent = explain(error);
  }
}
document.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => {
  location.hash = { material: '#/aportar', guide: '#/aportar/guia', mine: '#/mis-aportes' }[b.dataset.pane];
}));
addEventListener('hashchange', () => route());
onAuthStateChanged(auth, async (user) => {
  Object.assign(state, { catalog: [], contributions: [], graph: null, loaded: false });
  guides.clear();
  // A token minted before the address was confirmed still says email_verified=false: refresh it once.
  if (confirmEmail && user?.emailVerified && !(await user.getIdTokenResult()).claims.email_verified) await user.getIdToken(true);
  await route();
});
