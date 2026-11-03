// Studium: sign-in for verified accounts of one domain, a catalog read from Firestore, and a guide viewer.
// Guides live only in the database (gzip bytes in guides/{id}); nothing of their content is in this bundle.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { getFirestore, collection, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { firebaseConfig, allowedDomain, audience } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'es';
const db = getFirestore(app);

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const allowed = (email) => typeof email === 'string' && email.toLowerCase().endsWith(`@${allowedDomain}`) && email.indexOf('@') > 0;
// Where the e-mail links send the person back: this page, without the route.
const returnUrl = () => location.href.split('#')[0];

const VIEWS = ['boot', 'auth', 'verify', 'denied', 'catalog', 'guide'];
function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  const inGuide = view === 'guide';
  $('#top').hidden = inGuide;
  $('#foot').hidden = inGuide;
  document.body.classList.toggle('reading', inGuide);
  const user = auth.currentUser;
  $('#who-email').hidden = $('#sign-out').hidden = !user;
  $('#who-email').textContent = user?.email ?? '';
}

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
  'permission-denied': 'Tu cuenta todavía no tiene acceso. Si acabas de confirmar el correo, recarga la página.',
  unavailable: 'Sin conexión. Revisa tu internet y vuelve a probar.',
};
const explain = (error) => MESSAGES[error?.code] ?? 'Algo falló. Vuelve a intentarlo en un momento.';

/* ---------- theme ---------- */
document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('studium-theme', r.dataset.theme); } catch (e) { /* the choice just is not remembered */ }
}));

/* ---------- sign in / create account ---------- */
let mode = 'in';
function setMode(next) {
  mode = next;
  $('#tab-in').setAttribute('aria-selected', String(mode === 'in'));
  $('#tab-up').setAttribute('aria-selected', String(mode === 'up'));
  $('#auth-submit').textContent = mode === 'in' ? 'Entrar' : 'Crear cuenta';
  $('#password').autocomplete = mode === 'in' ? 'current-password' : 'new-password';
  $('#pw-hint').hidden = mode === 'in';
  $('#forgot').hidden = mode === 'up';
  $('#auth-lead').innerHTML = mode === 'in'
    ? `Para ${esc(audience)}. Entra con tu correo <span class="mono">@${esc(allowedDomain)}</span>.`
    : `Crea tu cuenta con tu correo <span class="mono">@${esc(allowedDomain)}</span>. Te enviaremos un enlace para confirmar que es tuyo.`;
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
  if (!allowed(email)) return say('#auth-msg', `Usa tu correo estudiantil: termina en @${allowedDomain}.`);
  if (password.length < 6) return say('#auth-msg', 'La contraseña debe tener al menos 6 caracteres.');
  say('#auth-msg', '');
  busy($('#auth-submit'), async () => {
    try {
      if (mode === 'in') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(user, { url: returnUrl() });
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
  try { await sendEmailVerification(auth.currentUser, { url: returnUrl() }); say('#verify-msg', 'Listo: enviamos otro enlace.', true); }
  catch (error) { say('#verify-msg', explain(error)); }
}));
// Coming back from the e-mail tab is the usual moment the address has just been confirmed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#view-verify').hidden) recheck().catch(() => {});
});

const leave = () => signOut(auth).then(() => { location.hash = ''; });
for (const id of ['#sign-out', '#verify-other', '#denied-out', '#guide-out']) $(id).addEventListener('click', leave);

/* ---------- catalog ---------- */
let catalog = null;
async function loadCatalog() {
  if (catalog) return catalog;
  const snap = await getDocs(collection(db, 'catalog'));
  catalog = snap.docs.map((d) => ({ id: d.id, topics: [], ...d.data() }));
  const uniq = (k) => [...new Set(catalog.map((g) => g[k]).filter(Boolean))].sort();
  const fill = (sel, k, label) => { $(sel).innerHTML = `<option value="">${label}</option>${uniq(k).map((v) => `<option>${esc(v)}</option>`).join('')}`; };
  fill('#f-course', 'course', 'Todas'); fill('#f-term', 'term', 'Todos'); fill('#f-prof', 'professor', 'Todos');
  return catalog;
}
const day = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' }) : '');
function renderCatalog() {
  const q = $('#q').value.trim().toLowerCase(); const c = $('#f-course').value; const t = $('#f-term').value; const p = $('#f-prof').value;
  const rows = catalog
    .filter((g) => (!c || g.course === c) && (!t || g.term === t) && (!p || g.professor === p) && (!q || JSON.stringify(g).toLowerCase().includes(q)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('#count').textContent = rows.length === 1 ? '1 guía' : `${rows.length} guías`;
  $('#list').innerHTML = rows.length ? rows.map((g) => `<article class="guide">
      <div><div class="code">${esc([g.university, g.code].filter(Boolean).join(' · '))}</div><div class="when">${esc(day(g.date))}</div></div>
      <div><h2>${esc(g.course)} · ${esc(g.title)}</h2><div class="meta">${esc([g.professor, g.term].filter(Boolean).join(' · '))}</div>
        <div class="tags">${g.topics.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>
      <a class="open" href="#/guia/${encodeURIComponent(g.id)}">Abrir guía →</a></article>`).join('')
    : `<div class="empty">${catalog.length ? 'Ninguna guía coincide con esos filtros.' : 'Todavía no hay guías publicadas.'}</div>`;
}
['#q', '#f-course', '#f-term', '#f-prof'].forEach((s) => $(s).addEventListener('input', renderCatalog));

/* ---------- guide viewer ---------- */
const guides = new Map();
async function loadGuide(id) {
  if (guides.has(id)) return guides.get(id);
  const snap = await getDoc(doc(db, 'guides', id));
  if (!snap.exists()) return null;
  const data = snap.data();
  const bytes = data.html.toUint8Array();
  const html = data.encoding === 'gzip'
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  const guide = { title: data.title ?? id, html };
  guides.set(id, guide);
  return guide;
}
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
  if (!user.emailVerified) { $('#verify-email').textContent = user.email; say('#verify-msg', ''); show('verify'); return; }
  const id = decodeURIComponent((location.hash.match(/^#\/guia\/([^/]+)$/) ?? [])[1] ?? '');
  try {
    if (id) {
      show('guide');
      const known = catalog?.find((g) => g.id === id);
      $('#guide-title').textContent = known ? `${known.course} · ${known.title}` : '';
      $('#guide-status').textContent = 'Abriendo la guía…'; $('#guide-status').hidden = false;
      const guide = await loadGuide(id);
      if (ticket !== routing) return;
      if (!guide) { $('#guide-status').textContent = 'Esa guía no existe o ya no está publicada.'; $('#guide-frame').removeAttribute('srcdoc'); return; }
      if (!known) $('#guide-title').textContent = guide.title;
      document.title = `${$('#guide-title').textContent} · Studium`;
      $('#guide-status').hidden = true;
      if ($('#guide-frame').srcdoc !== guide.html) $('#guide-frame').srcdoc = guide.html;
    } else {
      document.title = 'Studium';
      show('catalog');
      $('#count').textContent = 'Cargando guías…';
      await loadCatalog();
      if (ticket !== routing) return;
      renderCatalog();
    }
  } catch (error) {
    if (ticket !== routing) return;
    const where = id ? '#guide-status' : '#count';
    $(where).hidden = false; $(where).textContent = explain(error);
  }
}
window.addEventListener('hashchange', () => route());
onAuthStateChanged(auth, async (user) => {
  catalog = null; guides.clear();
  // A token minted before the address was confirmed still says email_verified=false: refresh it once.
  if (user?.emailVerified && !(await user.getIdTokenResult()).claims.email_verified) await user.getIdToken(true);
  await route();
});
