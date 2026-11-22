// «Amigos» (docs/v0.6.0.md §4): a friend is added with a link or a code. The link is its owner's proposal; whoever
// opens it and presses «Aceptar» writes the friendship on both sides at once, proving it with the code (firestore.rules,
// «Amigos»). Either side ends it alone, on both sides. A new link voids the old one. Friends see each other only by the
// name each one chose («Cómo te llamamos» in Inicio), and can invite each other to a trabajo without passing links.
// Data: amigoCodes/{code} {uid, name}; amigos/{uid} {code}; amigos/{uid}/lista/{other} {name, code, since};
// amigos/{uid}/invitaciones/{tid} {title, from, name, code, at}.
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db, auth, loadProfile } from './data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => auth.currentUser?.uid ?? '';
const CODE = /^[A-Za-z0-9_-]{24,64}$/;

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function myName() {
  const p = await loadProfile(uid()).catch(() => null);
  const u = auth.currentUser;
  return String(p?.nickname || u?.displayName || (u?.email ?? '').split('@')[0] || 'Yo').slice(0, 40);
}
export const linkOf = (code) => `${location.origin}${location.pathname}#/amigos/${code}`;
// A link or a bare code, as pasted: the code in it.
export const codeIn = (text) => String(text ?? '').trim().split(/[#/?\s]+/).filter(Boolean).pop() ?? '';

// The person's own link: made the first time it is needed; its name follows the person's current name.
export async function myCode() {
  const me = await getDoc(doc(db, 'amigos', uid()));
  const name = await myName();
  const code = me.exists() ? me.data().code : '';
  if (code) {
    const c = await getDoc(doc(db, 'amigoCodes', code)).catch(() => null);
    if (c?.exists()) {
      if (c.data().name !== name) await setDoc(doc(db, 'amigoCodes', code), { name, updated: serverTimestamp() }, { merge: true }).catch(() => {});
      return { code, name };
    }
  }
  return renewCode(code, name);
}
// A new link; the old one stops working at once.
export async function renewCode(old = '', name = '') {
  const code = newCode();
  const batch = writeBatch(db);
  batch.set(doc(db, 'amigos', uid()), { code, updated: serverTimestamp() });
  if (old) batch.delete(doc(db, 'amigoCodes', old));
  batch.set(doc(db, 'amigoCodes', code), { uid: uid(), name: name || await myName(), updated: serverTimestamp() });
  await batch.commit();
  return { code, name };
}
export async function codeInfo(code) {
  if (!CODE.test(code)) return null;
  const s = await getDoc(doc(db, 'amigoCodes', code)).catch(() => null);
  return s?.exists() ? { code, ...s.data() } : null;
}
// Accepting someone's link: the friendship, written on both sides in one write.
export async function accept(code) {
  const who = await codeInfo(code);
  if (!who) throw new Error('Ese enlace ya no sirve: quizá tu amigo lo cambió. Pídele el nuevo.');
  if (who.uid === uid()) throw new Error('Ese es tu propio enlace: compártelo con quien quieras agregar.');
  const mine = await getDoc(doc(db, 'amigos', uid(), 'lista', who.uid)).catch(() => null);
  if (mine?.exists()) return { ...who, already: true };
  const batch = writeBatch(db);
  batch.set(doc(db, 'amigos', uid(), 'lista', who.uid), { name: who.name, code, since: serverTimestamp() });
  batch.set(doc(db, 'amigos', who.uid, 'lista', uid()), { name: await myName(), code, since: serverTimestamp() });
  await batch.commit();
  return who;
}
export async function listFriends() {
  if (!uid()) return [];
  const s = await getDocs(collection(db, 'amigos', uid(), 'lista'));
  return s.docs.map((d) => ({ uid: d.id, name: d.data().name, since: d.data().since?.toDate?.() ?? null })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
export async function end(other) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'amigos', uid(), 'lista', other));
  batch.delete(doc(db, 'amigos', other, 'lista', uid()));
  await batch.commit();
}

/* ---------- invitations to a trabajo ---------- */
export async function invite(friendUids, { tid, title, code }) {
  const name = await myName();
  const done = [];
  const failed = [];
  for (const f of friendUids) {
    try {
      await setDoc(doc(db, 'amigos', f, 'invitaciones', tid), { title: String(title).slice(0, 160), from: uid(), name, code, at: serverTimestamp() });
      done.push(f);
    } catch (e) { failed.push(f); console.warn('invite', e); }
  }
  return { done, failed };
}
export async function invitations() {
  if (!uid()) return [];
  const s = await getDocs(collection(db, 'amigos', uid(), 'invitaciones')).catch(() => null);
  return (s?.docs ?? []).map((d) => ({ tid: d.id, ...d.data() }));
}
export const dropInvitation = (tid) => deleteDoc(doc(db, 'amigos', uid(), 'invitaciones', tid));

/* ---------- the panel, on top of «Comunidad» ---------- */
let mount = null;
let state = { code: '', name: '', friends: [], offer: null, error: '', ending: '' };
const since = (d) => (d ? d.toLocaleDateString('es', { day: 'numeric', month: 'long' }) : '');
const initial = (n) => esc(String(n || '?').trim()[0]?.toUpperCase() ?? '?');

function html() {
  const { code, name, friends, offer, error } = state;
  return `<section class="am-panel glass" aria-labelledby="am-title">
    ${offer ? `<div class="am-offer" role="alert">${offer.self
    ? '<p><b>Ese es tu propio enlace.</b> Compártelo con quien quieras agregar.</p><p><button type="button" class="link" data-am="offer-close">Entendido</button></p>'
    : offer.bad
      ? '<p><b>Ese enlace de amigo ya no sirve.</b> Quizá lo cambió quien te lo pasó: pídele el nuevo.</p><p><button type="button" class="link" data-am="offer-close">Entendido</button></p>'
      : `<i class="am-av big" aria-hidden="true">${initial(offer.name)}</i><div><p><b class="no-i18n">${esc(offer.name)}</b> te propone ser amigos en Studium.</p>
        <p class="fine">Al aceptar, cada uno ve el nombre del otro y pueden invitarse a trabajos. Nada más: no ven tu correo, tu horario ni tus notas.</p>
        <p><button type="button" class="button primary" data-am="accept">Aceptar</button> <button type="button" class="link" data-am="offer-close">Ahora no</button></p></div>`}</div>` : ''}
    <div class="am-head"><h2 id="am-title">Tus amigos</h2><span class="fine">${friends.length ? `${friends.length} ${friends.length === 1 ? 'amigo' : 'amigos'}` : ''}</span></div>
    ${friends.length ? `<ul class="am-list">${friends.map((f) => `<li><i class="am-av" aria-hidden="true">${initial(f.name)}</i><span><b class="no-i18n">${esc(f.name)}</b>${f.since ? `<small>amigos desde el ${esc(since(f.since))}</small>` : ''}</span>
        ${state.ending === f.uid
    ? `<span class="am-sure">¿Dejar de ser amigos? <button type="button" class="button small red" data-am="end" data-uid="${esc(f.uid)}">Sí</button> <button type="button" class="link" data-am="end-no">No</button></span>`
    : `<button type="button" class="link mut" data-am="end-ask" data-uid="${esc(f.uid)}">Dejar de ser amigos</button>`}</li>`).join('')}</ul>`
    : '<p class="am-empty">Todavía no tienes amigos en Studium. Pásales tu enlace: quien lo abra y acepte queda como tu amigo.</p>'}
    <div class="am-share">
      <h3>Tu enlace de amigo</h3>
      ${code ? `<p class="am-link"><code class="no-i18n">${esc(linkOf(code))}</code></p>
        <p><button type="button" class="button primary small" data-am="copy">Copiar mi enlace</button> <button type="button" class="link" data-am="renew">Cambiar mi enlace</button></p>
        <p class="fine">Quien lo abra y acepte queda como tu amigo: compártelo solo con quien quieras. Si se lo pasaste a alguien por error, cámbialo: el anterior deja de servir. Tus amigos te ven como <b class="no-i18n">${esc(name)}</b> (lo cambias en Inicio, en «Cómo te llamamos»).</p>`
    : '<p class="fine">Preparando tu enlace…</p>'}
      <form class="am-code" data-am-form><label class="field"><span>¿Te pasaron un enlace o un código?</span><input name="code" autocomplete="off" spellcheck="false" placeholder="Pégalo aquí"></label><button type="submit" class="button ghost small">Agregar</button></form>
      ${error ? `<p class="tj-warn" role="alert">${esc(error)}</p>` : ''}
    </div>
  </section>`;
}
const paint = () => { if (mount?.isConnected) mount.innerHTML = html(); };

export async function renderFriends(box, offerCode = '') {
  mount = box;
  state = { ...state, offer: null, error: '', ending: '' };
  box.innerHTML = '<p class="status">Cargando tus amigos…</p>';
  try {
    const [mine, friends] = await Promise.all([myCode(), listFriends()]);
    state.code = mine.code; state.name = mine.name; state.friends = friends;
  } catch (e) { console.warn('amigos', e); state.error = 'No pude cargar tus amigos. Recarga la página; si se repite, envía un reporte.'; }
  if (offerCode) {
    const who = await codeInfo(offerCode);
    state.offer = !who ? { bad: true } : who.uid === uid() ? { self: true } : state.friends.some((f) => f.uid === who.uid) ? null : who;
    if (who && state.friends.some((f) => f.uid === who.uid)) state.error = '';
  }
  paint();
  if (offerCode) box.scrollIntoView?.({ block: 'start' });
}

export function mountFriends(toast) {
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest?.('[data-am]');
    if (!b || !mount?.contains(b)) return;
    const kind = b.dataset.am;
    const work = async (fn) => { b.disabled = true; try { await fn(); } catch (e) { console.warn(e); state.error = e.message || 'No se pudo: inténtalo otra vez.'; } finally { paint(); } };
    if (kind === 'copy') { await navigator.clipboard.writeText(linkOf(state.code)).then(() => toast('Enlace copiado. Pásalo solo a quien quieras agregar.'), () => toast('No pude copiarlo: selecciónalo y cópialo a mano.')); return; }
    if (kind === 'renew') { await work(async () => { const r = await renewCode(state.code, state.name); state.code = r.code; toast('Listo: tu enlace anterior ya no sirve.'); }); return; }
    if (kind === 'offer-close') { state.offer = null; history.replaceState(null, '', `${location.pathname}#/comunidad`); paint(); return; }
    if (kind === 'accept') {
      await work(async () => {
        const who = await accept(state.offer.code);
        state.offer = null; state.error = '';
        state.friends = await listFriends();
        history.replaceState(null, '', `${location.pathname}#/comunidad`);
        toast(who.already ? `Ya eras amigo de ${who.name}.` : `Ahora tú y ${who.name} son amigos.`);
      });
      return;
    }
    if (kind === 'end-ask') { state.ending = b.dataset.uid; paint(); return; }
    if (kind === 'end-no') { state.ending = ''; paint(); return; }
    if (kind === 'end') { await work(async () => { await end(b.dataset.uid); state.ending = ''; state.friends = state.friends.filter((f) => f.uid !== b.dataset.uid); toast('Ya no son amigos.'); }); }
  });
  document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest?.('[data-am-form]');
    if (!form) return;
    ev.preventDefault();
    const code = codeIn(form.code.value);
    if (!code) return;
    const who = await codeInfo(code);
    state.error = '';
    state.offer = !who ? { bad: true } : who.uid === uid() ? { self: true } : who;
    if (who && state.friends.some((f) => f.uid === who.uid)) { state.offer = null; state.error = `Ya eres amigo de ${who.name}.`; }
    paint();
  });
}
