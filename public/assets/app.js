// Studium: what it is (open to anyone), sign-in for the members of a community, the person's own space, the guides,
// the knowledge map, professors, contributing and the viewer. Guides and contributions live only in the database;
// nothing of their content is in this bundle.
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, applyActionCode, verifyPasswordResetCode, confirmPasswordReset,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { mailFrom } from './config.js';
import { auth, loadAll, loadGuide, loadLibrary, markPresence } from './data.js';
import { settings, communityOf, communityLabel } from './settings.js';
import { keyOf, themeStyle, courseThemes } from './themes.js';
import { LEVELS, QUESTION_KINDS, RELATIONS, countKind } from './prompts.js';
import { buildGraph, upcoming, GraphView } from './graph.js';
import { prepareGuide, showAnchor } from './viewer.js';
import { startScene, tilt, liquid, glassLight, transition, rise } from './fx.js';
import { mountContribute, renderPane } from './contribute.js';
import { prefs } from './prefs.js';
import { sfx } from './sfx.js';
import { play, springLetters, celebrate } from './play.js';
import { mountSpace, renderHome, renderSettings, renderAmbiences, remember, soonLabel, daysTo } from './space.js';
import { mountCommunity, loadCommunity, kudosRow, renderKudos, renderProfes } from './community.js';
import { mountDemos } from './demos.js';
import { mountScenes } from './scenes.js';
import { mountLibrary, renderLibrary } from './library.js';
import { mountEditor, openEditor } from './editor.js';
import * as ai from './ai.js';
import { setLang, t } from './i18n.js';
import { mountHints } from './hints.js';
import { mountEggs } from './eggs.js';
import { mountAdmin, renderAdmin } from './admin.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// An address of an active community (settings/app). Admins are members whatever their address.
const allowed = (email) => typeof email === 'string' && email.indexOf('@') > 0 && !!communityOf(email);
const role = { admin: false };
const confirmEmail = () => settings.get().confirmEmail;
// Where the e-mail links send the person back: this page, without the route.
const returnUrl = () => location.href.split('#')[0];
const root = document.documentElement;

/* ---------- the shared pieces of the landing and the about page ---------- */
for (const slot of document.querySelectorAll('[data-template]')) slot.replaceWith($(`#tpl-${slot.dataset.template}`).content.cloneNode(true));

startScene();
tilt();
glassLight();
play.start($('#play'), $('#fx-top'));
for (const el of document.querySelectorAll('[data-liquid]')) liquid(el, JSON.parse(el.dataset.liquid || '{}'));
springLetters($('#wordmark'));
mountDemos();
mountScenes();
mountHints();
for (const el of document.querySelectorAll('[data-ambience-picker]')) renderAmbiences(el);

/* ---------- the person's choices, applied everywhere ---------- */
let shownLang = '';
function applyPrefs(p) {
  if (p.lang !== shownLang) { shownLang = p.lang; setLang(p.lang); }
  sfx.enable(p.sound);
  play.setAmbience(p.ambience);
  for (const b of document.querySelectorAll('[data-sound-toggle]')) b.setAttribute('aria-pressed', String(p.sound));
}
applyPrefs(prefs.get());
prefs.on((p) => applyPrefs(p));
document.querySelectorAll('[data-sound-toggle]').forEach((b) => b.addEventListener('click', () => {
  const on = !prefs.get().sound;
  prefs.set({ sound: on });
  if (on) sfx.toggle(true);
  toast(on ? 'Sonidos activados.' : 'Sonidos apagados.');
}));
document.querySelectorAll('[data-lang-toggle]').forEach((b) => b.addEventListener('click', () => {
  prefs.set({ lang: prefs.get().lang === 'en' ? 'es' : 'en' });
  sfx.tick();
}));
document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  prefs.set({ theme: dark ? 'light' : 'dark' });
  sfx.tick();
}));
/* ---------- the sound of the pointer on glass ---------- */
// A faint glass note when the pointer arrives on a card, a panel, a row or a button (never twice for the same one),
// and a soft tap when something is pressed. Not in the calm ambiences.
const HOVERED = '[data-tilt], .tile, .gcard, .doc, .prof, .mini-guide, .set, .step, .pick, .amb, .source, tr, .chip, .button, .tabs a, .icon, .kudo, .seg span';
let hovered = null;
const calmAmbience = () => ['sereno', 'enfoque'].includes(root.dataset.ambience);
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !sfx.on || calmAmbience()) return;
  const el = e.target instanceof Element ? e.target.closest(HOVERED) : null;
  if (!el || el === hovered) return;
  hovered = el;
  sfx.hover(el.matches('.chip, .button, .tabs a, .icon, .kudo, .seg span') ? 'button' : 'card');
}, { passive: true });
document.addEventListener('pointerdown', (e) => {
  if (!sfx.on || calmAmbience() || !(e.target instanceof Element)) return;
  if (e.target.closest('button, .button, a[href], .chip, [role="tab"], .seg label')) sfx.press();
}, { passive: true });

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-scroll]');
  if (!a) return;
  e.preventDefault();
  document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- views ---------- */
const VIEWS = ['boot', 'landing', 'auth', 'verify', 'denied', 'home', 'catalog', 'map', 'library', 'profes', 'contribute', 'settings', 'about', 'sources', 'guide', 'admin'];
const TABS = { home: 'home', catalog: 'catalog', map: 'map', library: 'library', profes: 'profes', contribute: 'contribute', landing: 'landing', about: 'about', admin: 'admin' };
const PUBLIC = ['landing', 'auth', 'about', 'denied', 'verify'];
let current = 'boot';
function show(view) {
  const swap = () => {
    for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
    const member = isMember(auth.currentUser);
    const nav = $('#nav');
    nav.dataset.mode = member ? 'member' : 'public';
    nav.hidden = view === 'boot' || view === 'guide';
    $('#tabbar').hidden = !member || PUBLIC.includes(view) && view !== 'about' || view === 'guide' || view === 'boot';
    $('#foot-sources').hidden = !member;
    $('#foot').hidden = ['guide', 'map', 'boot'].includes(view);
    const quiet = view === 'map' || view === 'guide';
    root.classList.toggle('quiet', quiet);
    play.setQuiet(quiet);
    for (const a of document.querySelectorAll('[data-tab]')) a.setAttribute('aria-current', String(a.dataset.tab === TABS[view]));
    const user = auth.currentUser;
    $('#who-email').textContent = user?.email ?? '';
    $('#initial').textContent = (prefs.get().nickname || user?.email || '?')[0].toUpperCase();
    for (const a of document.querySelectorAll('#view-landing a[href="#/entrar"]')) a.textContent = t(member ? 'Ir a mi inicio' : 'Entrar');
    for (const el of document.querySelectorAll('[data-community]')) el.textContent = t(communityLabel(user?.email));
    current = view;
    requestAnimationFrame(moveDrop);
  };
  if (view === current) swap(); else { if (current !== 'boot' && !calmAmbience()) sfx.open(); transition(swap); if (view !== 'map' && view !== 'guide') scrollTo({ top: 0, behavior: 'instant' }); }
}
// The tab indicator: a drop of glass that slides to the current tab.
function moveDrop() {
  for (const tabs of document.querySelectorAll('#nav .tabs')) {
    const tab = tabs.querySelector('[aria-current="true"]');
    const drop = tabs.querySelector('.drop');
    if (!tab || !drop) { if (drop) drop.style.opacity = '0'; continue; }
    drop.style.opacity = '1';
    drop.style.width = `${tab.offsetWidth}px`;
    drop.style.transform = `translateX(${tab.offsetLeft - 4}px)`;
  }
}
addEventListener('resize', moveDrop);

const MESSAGES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'Ese correo no es válido.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Entra con tu contraseña o usa «Olvidé mi contraseña».',
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

/* ---------- account menu ---------- */
const menu = $('#account-menu');
$('#account').addEventListener('click', () => { menu.hidden = !menu.hidden; $('#account').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.account')) { menu.hidden = true; $('#account').setAttribute('aria-expanded', 'false'); } });
menu.addEventListener('click', (e) => { if (e.target.closest('a, button')) menu.hidden = true; });

/* ---------- sign in / create an account ---------- */
// Members of a community know which address to use; the page never names the domain.
const NOT_MEMBER = 'Ese correo no pertenece a ninguna comunidad de Studium. Si tu universidad ya está, entra con tu correo de estudiante.';
let mode = 'in';
function setMode(next) {
  mode = next;
  $('#tab-in').setAttribute('aria-selected', String(mode === 'in'));
  $('#tab-up').setAttribute('aria-selected', String(mode === 'up'));
  $('#auth-submit').textContent = mode === 'in' ? 'Entrar' : 'Crear cuenta';
  $('#password').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
  $('#pw-hint').hidden = mode === 'in';
  $('#forgot').hidden = mode === 'up';
  $('#auth-lead').textContent = mode === 'in'
    ? 'Entra con el correo de tu comunidad.'
    : `Crea tu cuenta con el correo de tu comunidad.${confirmEmail() ? ' Te enviaremos un enlace para confirmar que es tuyo.' : ''}`;
  $('#auth-msg').textContent = '';
}
$('#tab-in').addEventListener('click', () => setMode('in'));
$('#tab-up').addEventListener('click', () => setMode('up'));
setMode('in');

const say = (sel, text, ok = false) => { const el = $(sel); el.textContent = text; el.classList.toggle('ok', ok); };
async function busy(button, work) {
  button.disabled = true;
  try { await work(); } finally { button.disabled = false; }
}
$('#auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  // The accepted domains are read only after signing in, so that the page never reveals them: a new account is
  // checked right after it is created, and deleted at once when its address belongs to no community.
  if (password.length < 6) return say('#auth-msg', 'La contraseña debe tener al menos 6 caracteres.');
  say('#auth-msg', '');
  busy($('#auth-submit'), async () => {
    try {
      if (mode === 'in') await signInWithEmailAndPassword(auth, email, password);
      else {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await settings.load();
        if (!allowed(email)) { await user.delete().catch(() => signOut(auth)); say('#auth-msg', NOT_MEMBER); return; }
        if (confirmEmail()) await sendConfirmation(user);
      }
    } catch (error) { say('#auth-msg', explain(error)); }
  });
});
$('#forgot').addEventListener('click', () => {
  const email = $('#email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say('#auth-msg', 'Escribe arriba tu correo y vuelve a pulsar «Olvidé mi contraseña».');
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

const leave = () => signOut(auth).then(() => { prefs.detach(); location.hash = '#/'; });
for (const id of ['#sign-out', '#verify-other', '#denied-out']) $(id).addEventListener('click', leave);

/* ---------- data ---------- */
const state = { catalog: [], contributions: [], sources: [], tips: [], library: [], graph: null, themes: new Map(), loaded: false };
let loading = null;
async function load(force = false) {
  if (state.loaded && !force) return state;
  loading ??= (async () => {
    const [data, library] = await Promise.all([loadAll(auth.currentUser?.uid), loadLibrary(auth.currentUser?.uid).catch(() => []), loadCommunity(force)]);
    Object.assign(state, data, {
      library,
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
  if (current === 'home') renderHome();
  if (current === 'profes') renderProfes();
  if (map) map.setGraph(state.graph, { animate: false });
}
const context = { state, get user() { return { uid: auth.currentUser?.uid, email: auth.currentUser?.email ?? '' }; }, refresh, toast, explain };
mountSpace(context);
mountEggs({ toast });
mountAdmin(context);
mountCommunity(context);
mountLibrary(context);
mountEditor();

/* ---------- guides ---------- */
const day = (d) => (d ? new Date(`${d}T12:00:00`) : null);
function guideCard(g) {
  const theme = state.themes.get(keyOf(g.course)) ?? g.theme;
  const date = day(g.date);
  const soon = soonLabel(g.date);
  const n = daysTo(g.date);
  const done = prefs.get().progress[g.id] === 'done';
  return `<a class="gcard" data-tilt="6" href="#/guia/${encodeURIComponent(g.id)}" style="${themeStyle(theme)}">
    <div class="art" aria-hidden="true"></div>
    ${soon ? `<span class="soon ${n <= 2 ? 'hot' : ''}">${esc(soon)}</span>` : ''}
    ${date ? `<span class="when d" style="--d:34"><b>${date.getDate()}</b><small>${date.toLocaleDateString('es-EC', { month: 'short' }).replace('.', '')}</small></span>` : ''}
    <div class="body d" style="--d:16">
      <p class="course">${esc([g.code, g.course].filter(Boolean).join(' · '))}</p>
      <h3>${esc(g.title)}</h3>
      <p class="who">${esc([g.professor, g.term].filter(Boolean).join(' · '))}</p>
      <div class="flags">${g.level ? `<span class="level">${esc(LEVELS[g.level])}</span>` : ''}${g.visibility === 'private' ? '<span class="level private">Solo tú</span>' : ''}${g.mine ? '<span class="level private">Tuya</span>' : ''}${done ? '<span class="level done">La terminaste</span>' : ''}</div>
      ${g.by || g.ai?.provider ? `<p class="made">${g.by ? `Por <strong>${esc(g.by)}</strong>` : ''}${g.by && g.ai?.provider ? ' · ' : ''}${g.ai?.provider ? `Hecha con ${esc(ai.PROVIDERS[g.ai.provider]?.name ?? 'otra IA')}${g.ai.model ? ` <span class="model">${esc(g.ai.model)}</span>` : ''}${g.ai.effort ? `, esfuerzo ${esc((ai.EFFORTS[g.ai.effort] ?? g.ai.effort).toLowerCase())}` : ''}` : ''}</p>` : ''}
      <div class="tags">${(g.topics?.length ? g.topics : g.concepts ?? []).slice(0, 5).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      ${kudosRow(g.id)}
    </div>
  </a>`;
}
function renderCatalog() {
  const q = keyOf($('#q').value);
  const filter = document.querySelector('#g-filter input:checked')?.value ?? 'all';
  const progress = prefs.get().progress;
  let list = state.catalog.filter((g) => !q || keyOf(JSON.stringify([g.course, g.title, g.professor, g.term, g.topics, g.concepts, g.code])).includes(q));
  if (filter === 'soon') list = list.filter((g) => (daysTo(g.date) ?? -1) >= 0);
  if (filter === 'mine') list = list.filter((g) => g.mine);
  if (filter === 'done') list = list.filter((g) => progress[g.id] === 'done');
  // What is coming goes first, the closest at the top; then the rest, newest first.
  const rank = (g) => { const n = daysTo(g.date); return n !== null && n >= 0 ? n : 1e6 - (day(g.date)?.getTime() ?? 0) / 1e9; };
  list.sort((a, b) => rank(a) - rank(b));
  $('#gallery').innerHTML = list.length ? list.map(guideCard).join('') : `<div class="empty glass">${state.catalog.length
    ? `<h2>Nada por aquí</h2><p>${filter === 'all' ? 'Prueba con otra materia, tema o profe.' : 'Cambia el filtro para ver más guías.'}</p>`
    : '<h2>Studium está empezando</h2><p>Aporta tus exámenes, deberes o apuntes: con ellos se arma el mapa y se crean las guías.</p><a class="button primary" href="#/aportar">Aportar material</a>'}</div>`;
  rise($('#gallery'));
}
$('#q').addEventListener('input', renderCatalog);
$('#g-filter').addEventListener('change', () => { sfx.tick(); renderCatalog(); });

/* ---------- sources and credits ---------- */
const sourceOf = (id) => state.sources.find((x) => x.id === id);
function renderSources() {
  const el = $('#sources');
  if (!state.sources.length) { el.innerHTML = '<div class="empty glass"><h2>Todavía no hay fuentes registradas</h2><p>Cuando el mapa reciba material de una colección compartida, aparecerá aquí con su reconocimiento.</p></div>'; return; }
  el.innerHTML = state.sources.map((src) => {
    const items = state.contributions.filter((c) => c.source === src.id);
    const courses = new Set(items.map((c) => keyOf(c.course)));
    const paras = (text) => String(text ?? '').split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
    return `<article class="source glass" style="${themeStyle(src.theme ?? 'estrellas')}">
      <div class="course-art" aria-hidden="true"></div>
      ${src.by ? `<p class="course-code">${esc(src.by)}</p>` : ''}
      <h2>${esc(src.name)}</h2>
      ${src.thanks ? `<div class="thanks">${paras(src.thanks)}</div>` : ''}
      ${paras(src.description)}
      <p class="muted">${items.length ? `En Studium: ${items.length} ${items.length === 1 ? 'aporte' : 'aportes'} de ${courses.size} ${courses.size === 1 ? 'materia' : 'materias'}.` : 'Su material se está incorporando al mapa.'}</p>
      ${src.url ? `<div class="actions"><a class="button primary" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.linkLabel ?? 'Ver la fuente original')}</a></div>` : ''}
    </article>`;
  }).join('');
  rise(el);
}
const creditLine = (items) => {
  const ids = [...new Set(items.map((c) => c.source).filter(Boolean))];
  return ids.length ? ` Con material de ${ids.map((id) => `<a href="#/fuentes">${esc(sourceOf(id)?.name ?? id)}</a>`).join(' y ')}.` : '';
};

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
const mapPrefs = { get() { try { return JSON.parse(localStorage.getItem('studium-map') ?? '{}'); } catch { return {}; } }, set(v) { try { localStorage.setItem('studium-map', JSON.stringify(v)); } catch { /* not remembered */ } } };
function fillTools() {
  const g = state.graph;
  const careers = g.nodes.filter((n) => n.type === 'career');
  const p = mapPrefs.get();
  // The semester the person set in their settings is the default here.
  const semester = p.semester ?? prefs.get().semester;
  $('#map-career').innerHTML = `<option value="">Todas las carreras</option>${careers.map((c) => `<option value="${esc(c.id)}" ${p.career === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  $('#map-career').hidden = !careers.length;
  const plan = g.byId.get($('#map-career').value);
  const count = plan ? plan.semesters.length - 1 : 0;
  $('#map-semester').innerHTML = `<option value="0">Mi semestre</option>${Array.from({ length: Math.max(0, count) }, (_, i) => `<option value="${i + 1}" ${semester === i + 1 ? 'selected' : ''}>Estoy en ${i + 1}.º</option>`).join('')}`;
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
  mapPrefs.set({ career, semester });
  map?.setFilter({ courses: off.size ? new Set(all.filter((id) => !off.has(id))) : null, professor: $('#map-prof').value, career, semester });
}
function mapTools() {
  $('#map-career').addEventListener('change', () => { mapPrefs.set({ career: $('#map-career').value, semester: 0 }); fillTools(); setTimeout(() => map.fit(), 900); });
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
      ${n.contributions.length ? `<p>${Object.entries(counts).map(([k, c]) => esc(countKind(k, c))).join(', ')}${n.professors.size ? `, de ${esc([...n.professors.keys()].join(', '))}` : ''}.${creditLine(n.contributions)}</p>` : '<p class="muted">Nadie aportó material de esta materia todavía.</p>'}
      ${before.length ? `<h3>Se necesita antes</h3><div class="chips small">${chipsOf(before)}</div>` : ''}
      ${next.length ? `<h3>Lo que viene después</h3><ul class="next">${next.map((x) => `<li><button class="link" data-node="${esc(x.course.id)}">${esc(x.course.name)}</button>${x.shared.length ? `<span class="muted"> usa ${esc(x.shared.slice(0, 5).map((s) => s.name).join(', '))}${x.shared.length > 5 ? ` y ${x.shared.length - 5} más` : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${concepts.length ? `<h3>Conceptos más evaluados</h3><div class="chips small">${chipsOf(concepts.slice(0, 18))}</div>` : ''}
      <div class="actions">${n.guides.length ? `<a class="button ghost" href="#/guias">Ver ${plural(n.guides.length, 'guía', 'guías')}</a>` : ''}${n.contributions.length ? `<a class="button primary" href="#/aportar/guia/${encodeURIComponent(n.id)}">Crear una guía</a>` : '<a class="button primary" href="#/aportar">Aportar material</a>'}</div>`;
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
let openGuide = '';
$('#guide-full').addEventListener('click', () => $('#guide-frame').requestFullscreen?.());
function syncDone() {
  const done = prefs.get().progress[openGuide] === 'done';
  $('#guide-done').setAttribute('aria-pressed', String(done));
  $('#guide-done').textContent = done ? 'Terminada ✓' : 'La terminé';
}
$('#guide-done').addEventListener('click', (e) => {
  const progress = { ...prefs.get().progress };
  const done = progress[openGuide] !== 'done';
  progress[openGuide] = done ? 'done' : 'reading';
  // A goal tied to this guide is met with it.
  const goals = prefs.get().goals.map((g) => (g.guide === openGuide ? { ...g, done } : g));
  prefs.set({ progress, goals });
  syncDone();
  if (done) {
    const r = e.currentTarget.getBoundingClientRect();
    celebrate(r.left + r.width / 2, r.bottom, goals.length > 0 && goals.every((g) => g.done));
    toast('¡Guía terminada!');
  }
});

$('#guide-edit').addEventListener('click', () => {
  const entry = state.catalog.find((g) => g.id === openGuide);
  const guide = guides.get(openGuide);
  if (!entry || !guide) return;
  openEditor({
    id: openGuide, entry, html: guide.html, uid: auth.currentUser?.uid, toast,
    onSaved: (html, anchor) => {
      guides.set(openGuide, { ...guide, html });
      const frame = $('#guide-frame');
      frame.addEventListener('load', () => showAnchor(frame, anchor), { once: true });
      frame.srcdoc = prepareGuide(html);
      load(true).catch(() => {});
    },
  });
});

/* ---------- the admins' announcement ---------- */
// Shown to members while it is on; closing it hides that text for the rest of the visit.
function showAnnouncement() {
  const a = settings.get().announcement;
  const el = $('#announce');
  const closed = sessionStorage.getItem('studium-announce-closed') === a.text;
  el.hidden = !(a.on && a.text && !closed && isMember(auth.currentUser));
  root.classList.toggle('has-announce', !el.hidden);
  el.className = `announce ${a.level}`;
  $('#announce-text').textContent = a.text;
}
$('#announce-close').addEventListener('click', () => { sessionStorage.setItem('studium-announce-closed', settings.get().announcement.text); $('#announce').hidden = true; root.classList.remove('has-announce'); });

/* ---------- routing ---------- */
const isMember = (user) => !!user && (role.admin || (allowed(user.email) && (!confirmEmail() || user.emailVerified)));
let routing = 0;
let pending = '';
async function route() {
  const ticket = ++routing;
  const user = auth.currentUser;
  const [, page = '', ...rest] = location.hash.replace(/^#\/?/, '#/').split('/');
  const arg = rest.map(decodeURIComponent);
  root.style.removeProperty('--a');
  if (!user) {
    document.title = 'Studium';
    if (page === 'entrar') { document.title = `${t('Entrar')} · Studium`; show('auth'); }
    else if (page === 'acerca') { document.title = `${t('Acerca')} · Studium`; show('about'); }
    else if (!page || page === 'bienvenida') show('landing');
    // A link to something inside: sign in first, then go there.
    else { pending = location.hash; show('auth'); }
    return;
  }
  if (!role.admin && !allowed(user.email)) {
    $('#denied-text').textContent = `Esta sesión es de ${user.email ?? 'otra cuenta'}, que no pertenece a ninguna comunidad de Studium. Se entra con el correo de estudiante de tu universidad.`;
    show('denied'); return;
  }
  if (!role.admin && confirmEmail() && !user.emailVerified) { $('#verify-email').textContent = user.email; $('#verify-from').textContent = mailFrom; say('#verify-msg', verifyNote); show('verify'); return; }
  if (pending) { const to = pending; pending = ''; if (location.hash !== to) { location.hash = to; return; } }
  if (page === 'entrar' || (page === 'admin' && !role.admin)) { location.hash = '#/'; return; }
  showAnnouncement();
  try {
    if (page === 'guia' && arg[0]) {
      const id = arg[0];
      openGuide = id;
      show('guide');
      const known = state.catalog.find((g) => g.id === id);
      $('#guide-title').textContent = known ? `${known.course}: ${known.title}` : '';
      $('#guide-edit').hidden = !known?.mine;
      $('#guide-map').href = `#/mapa/guide:${encodeURIComponent(id)}`;
      $('#guide-status').textContent = 'Abriendo la guía…'; $('#guide-status').hidden = false;
      remember(id);
      if (!prefs.get().progress[id]) prefs.set({ progress: { ...prefs.get().progress, [id]: 'reading' } });
      syncDone();
      load().then(() => { if (openGuide === id) renderKudos(id); }).catch(() => {});
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
    const views = {
      biblioteca: ['library', 'Biblioteca', renderLibrary],
      mapa: ['map', 'Mapa', () => openMap(arg.join('/'))],
      fuentes: ['sources', 'Fuentes', renderSources],
      profes: ['profes', 'Profes', renderProfes],
      ajustes: ['settings', 'Ajustes', renderSettings],
      acerca: ['about', 'Acerca', null],
      guias: ['catalog', 'Guías', renderCatalog],
      // The logo: the public page, also for members, who reach their own space from «Inicio».
      bienvenida: ['landing', 'Qué es', null],
      admin: ['admin', 'Admin', () => renderAdmin(arg[0])],
      '': ['home', 'Inicio', renderHome],
    };
    if (page === 'aportar' || page === 'mis-aportes') {
      document.title = `${t('Aportar')} · Studium`;
      show('contribute');
      await load();
      if (ticket !== routing) return;
      mountContribute(context);
      const pane = page === 'mis-aportes' ? 'mine' : arg[0] === 'guia' ? 'guide' : 'material';
      renderPane(pane, arg[1] ? { course: arg[1] } : undefined);
      return;
    }
    const [view, title, render] = views[page] ?? views[''];
    document.title = `${t(title)} · Studium`;
    show(view);
    if (!render) return;
    if (!state.loaded && view === 'catalog') $('#gallery').innerHTML = '<p class="status">Cargando…</p>';
    if (!state.loaded && view === 'home') $('#dash').innerHTML = '<p class="status" style="grid-column:1/-1">Cargando tu espacio…</p>';
    await load();
    if (ticket !== routing) return;
    await render();
  } catch (error) {
    if (ticket !== routing) return;
    console.error(error);
    const where = page === 'guia' ? '#guide-status' : page === 'mapa' ? '#map-empty' : page === 'aportar' ? '#pane-material' : page === 'guias' ? '#gallery' : page === 'profes' ? '#profs' : '#dash';
    $(where).hidden = false;
    $(where).textContent = explain(error);
  }
}
// The guide's bar can be hidden; the choice is remembered on this device.
function bareReader(on) {
  $('#view-guide').classList.toggle('bare', on);
  $('#guide-show').hidden = !on;
  try { localStorage.setItem('studium-reader-bare', on ? '1' : ''); } catch { /* not remembered */ }
}
$('#guide-hide').addEventListener('click', () => bareReader(true));
$('#guide-show').addEventListener('click', () => bareReader(false));
try { bareReader(localStorage.getItem('studium-reader-bare') === '1'); } catch { /* the bar stays */ }

document.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => {
  location.hash = { material: '#/aportar', guide: '#/aportar/guia', mine: '#/mis-aportes' }[b.dataset.pane];
}));
/* ---------- the links of the account e-mails ---------- */
// They open Studium itself (?mode=…&oobCode=…), on the site students already use: confirming the address happens
// here, and so does choosing a new password.
async function handleEmailLink() {
  const q = new URLSearchParams(location.search);
  const mode = q.get('mode'); const code = q.get('oobCode');
  if (!mode || !code) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    if (mode === 'verifyEmail') {
      await applyActionCode(auth, code);
      toast('Correo confirmado. Bienvenido a Studium.');
      await auth.authStateReady?.();
      const user = auth.currentUser;
      if (user) { await user.reload(); await user.getIdToken(true); await route(); } else location.hash = '#/entrar';
    } else if (mode === 'resetPassword') {
      const email = await verifyPasswordResetCode(auth, code);
      $('#reset-email').textContent = email;
      $('#reset-msg').textContent = '';
      $('#reset-form').dataset.code = code;
      $('#reset-form').dataset.email = email;
      $('#reset-dialog').showModal();
    }
  } catch (error) {
    toast(['auth/invalid-action-code', 'auth/expired-action-code'].includes(error.code) ? 'Ese enlace ya se usó o venció. Pide otro desde Studium.' : explain(error));
  }
}
$('#reset-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const form = e.target;
  const password = form.password.value;
  const button = $('#reset-save');
  button.disabled = true;
  try {
    await confirmPasswordReset(auth, form.dataset.code, password);
    await signInWithEmailAndPassword(auth, form.dataset.email, password);
    $('#reset-dialog').close();
    toast('Listo: tienes contraseña nueva.');
  } catch (error) { say('#reset-msg', explain(error)); } finally { button.disabled = false; }
});
handleEmailLink();

addEventListener('hashchange', () => route());
onAuthStateChanged(auth, async (user) => {
  Object.assign(state, { catalog: [], contributions: [], tips: [], graph: null, loaded: false });
  guides.clear();
  role.admin = false;
  if (user) {
    const claims = (await user.getIdTokenResult()).claims;
    role.admin = claims.admin === true;
    await settings.load();
    // A token minted before the address was confirmed still says email_verified=false: refresh it once.
    if (confirmEmail() && user.emailVerified && !claims.email_verified) await user.getIdToken(true);
  }
  document.documentElement.classList.toggle('is-admin', role.admin);
  if (isMember(user)) { await prefs.attach(user.uid); seen(); } else prefs.detach();
  await route();
});
// Presence, on real events only: signing in (above), changing page and coming back to the tab.
function seen() {
  const user = auth.currentUser;
  if (isMember(user)) markPresence(user.uid, role.admin && !allowed(user.email) ? 'admin' : communityOf(user.email)?.id).catch(() => {});
}
addEventListener('hashchange', seen);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') seen(); });
