// Where the AI keys live, encrypted (his request, 2026-11-20: encrypted, the same account on the computer and the
// phone without an extra step, and impossible to decrypt from the Firebase project "hasta si me hackean el Firebase").
// - On each device: AES-GCM with a key this browser made and cannot export (IndexedDB). Nothing to remember.
// - In the account (vaults/{uid}): AES-GCM with a key derived, on the device, from the person's own Studium password
//   (PBKDF2-SHA-256, 600 000 rounds, its own salt). Firebase never receives that key: it keeps only ciphertext, and its
//   own hash of the password, which is not this key. The device keeps the derived key (not exportable) after signing
//   in, so the keys follow the account with no extra step: sign in on the phone and they are there.
// - Signing out forgets the keys on that device; signing in brings them back.
// - A reset password cannot open the old copy: a device that still has the keys encrypts them again with the new one;
//   otherwise they are entered again, and the page says so.
// The bridge's token never travels: the bridge belongs to one computer. What no encryption in a page can stop is a
// foreign script running inside the page; that is the content policy's job.
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { db, auth } from './data.js';

const LOCAL = 'studium-vault';
const ITER = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let secrets = { keys: {}, bridge: '' };
let device = null; // this browser's key
let account = null; // the key derived from the password, for this uid
let uid = '';
let note = ''; // what the person should know (a reset password, an error)
const hearers = new Set();
export const onVault = (fn) => { hearers.add(fn); return () => hearers.delete(fn); };
const tell = () => { for (const fn of hearers) { try { fn(state()); } catch { /* a closed view */ } } };
export const state = () => ({ synced: !!account, any: Object.keys(secrets.keys).length > 0, note });
export const get = () => ({ keys: { ...secrets.keys }, bridge: secrets.bridge });

/* ---------- keys that cannot leave the device ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('studium-vault', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('k');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function stored(name, value) {
  const base = await idb();
  if (value === undefined) return new Promise((r) => { const q = base.transaction('k').objectStore('k').get(name); q.onsuccess = () => r(q.result ?? null); q.onerror = () => r(null); });
  return new Promise((r, j) => { const t = base.transaction('k', 'readwrite'); const s = t.objectStore('k'); if (value === null) s.delete(name); else s.put(value, name); t.oncomplete = r; t.onerror = () => j(t.error); });
}
async function deviceKey() {
  let k = await stored('device');
  if (!k) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await stored('device', k); }
  return k;
}
async function derive(password, salt, iter = ITER) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  // Not exportable: once made, not even this page can read its bytes.
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(k, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), data: b64(data) };
}
async function open(k, box) {
  const v = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.data))));
  return { keys: v.keys ?? {}, bridge: v.bridge ?? '' };
}

/* ---------- this device ---------- */
// At start, before anything uses a key: open what this browser keeps.
export async function init() {
  try {
    device = await deviceKey();
    const box = JSON.parse(localStorage.getItem(LOCAL) ?? 'null');
    if (box?.data) secrets = await open(device, box);
  } catch { secrets = { keys: {}, bridge: '' }; }
}
async function saveLocal() {
  device ??= await deviceKey();
  try { localStorage.setItem(LOCAL, JSON.stringify(await seal(device, secrets))); } catch { /* not kept */ }
}
async function saveAccount() {
  if (!account || !uid) return;
  const salt = (await stored(`salt:${uid}`)) ?? '';
  if (!Object.keys(secrets.keys).length) { await deleteDoc(doc(db, 'vaults', uid)).catch(() => {}); return; }
  await setDoc(doc(db, 'vaults', uid), { salt, iter: ITER, ...(await seal(account, { keys: secrets.keys })), updated: serverTimestamp() });
}

let writing = Promise.resolve();
// Keep the keys: on this device, and in the account (without the bridge's token).
export function set(next) {
  secrets = { keys: { ...(next.keys ?? {}) }, bridge: String(next.bridge ?? '') };
  writing = writing.then(saveLocal).then(saveAccount).catch(() => {});
  tell();
  return writing;
}

/* ---------- the account ---------- */
// The account's copy, merged into this device's: what the other device added arrives here.
async function pull() {
  if (!account || !uid) return;
  let snap = null;
  try { snap = await getDoc(doc(db, 'vaults', uid)); } catch { return; }
  if (!snap?.exists()) { if (Object.keys(secrets.keys).length) await saveAccount(); return; }
  try {
    const remote = await open(account, snap.data());
    secrets = { keys: { ...remote.keys, ...secrets.keys }, bridge: secrets.bridge };
    await saveLocal();
    if (Object.keys(secrets.keys).length > Object.keys(remote.keys).length) await saveAccount();
  } catch {
    // Encrypted with another password (it was reset): this device's keys replace it; with none, it is gone.
    if (Object.keys(secrets.keys).length) { await saveAccount(); note = ''; }
    else { await deleteDoc(doc(db, 'vaults', uid)).catch(() => {}); note = 'Tus claves guardadas usaban tu contraseña anterior y ya no se pueden abrir: vuelve a ponerlas una vez.'; }
  }
}
// Signing in with the password: the key is derived here, on the device, and kept here (not exportable).
export async function signedIn(id, password) {
  uid = id;
  try {
    let snap = null;
    try { snap = await getDoc(doc(db, 'vaults', uid)); } catch { /* offline: a new salt */ }
    const salt = snap?.exists() ? snap.data().salt : b64(crypto.getRandomValues(new Uint8Array(16)));
    account = await derive(password, unb64(salt), snap?.exists() ? snap.data().iter ?? ITER : ITER);
    await stored(`acc:${uid}`, account); await stored(`salt:${uid}`, salt);
    await pull();
  } catch { /* the keys stay on this device only */ }
  tell();
}
// On every start with a session: this device's key for the account, if it signed in here before.
export async function attach(id) {
  uid = id ?? '';
  account = uid ? await stored(`acc:${uid}`).catch(() => null) : null;
  await pull();
  tell();
}
// A session opened before this existed: the password, once, checked by Firebase, so the keys follow the account.
export async function confirm(password) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Inicia sesión primero.');
  try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)); }
  catch { throw new Error('Esa no es tu contraseña de Studium.'); }
  await signedIn(user.uid, password);
}
// Signing out: this device forgets the keys and the account's key; the account keeps its encrypted copy.
export async function signedOut() {
  if (uid) { await stored(`acc:${uid}`, null).catch(() => {}); await stored(`salt:${uid}`, null).catch(() => {}); }
  secrets = { keys: {}, bridge: secrets.bridge }; account = null; uid = ''; note = '';
  await saveLocal();
  tell();
}
