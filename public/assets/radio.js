// The radio's stations as the admins set them in the panel (Firestore stations/{id}): a tune generated live
// (stations.js), a YouTube upload with or without its caption, or an audio file the admin uploaded, kept in pieces
// under 1 MB (stations/{id}/audio/{n}) and played in a seamless loop. Until the admins set any, the radio has the
// stations of stations.js. The list is kept in this browser too, so the radio has its stations at once.
import {
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, Bytes, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db } from './data.js';
import { STATIONS as DEFAULTS } from './stations.js';

const CACHE = 'studium-stations';
const PIECE = 900_000; // bytes per piece, under Firestore's 1 MiB per document
export const MAX_AUDIO = 10 * PIECE; // about 9 MB

// A station as the radio uses it: { id, freq, name, opens, kind, gen?, video?, credit?, audio? }.
const fromDefault = (s) => ({ ...s, kind: s.video ? 'youtube' : 'gen', gen: s.video ? undefined : s.id, showCaption: !!s.credit, caption: s.credit ?? '', on: true });
const fromDoc = (id, d) => ({
  id, name: d.name, freq: d.freq10 / 10, opens: d.opens, kind: d.kind, on: d.on !== false,
  ...(d.kind === 'gen' ? { gen: d.gen || 'bossa' } : {}),
  ...(d.kind === 'youtube' ? { video: d.video, caption: d.caption ?? '', showCaption: !!d.showCaption, credit: d.showCaption ? d.caption ?? '' : '' } : {}),
  ...(d.kind === 'audio' ? { audio: d.audio, caption: d.caption ?? '', showCaption: !!d.showCaption, credit: d.showCaption ? d.caption ?? '' : '' } : {}),
});
let list = (() => {
  try { const v = JSON.parse(localStorage.getItem(CACHE) ?? 'null'); if (Array.isArray(v) && v.length) return v; } catch { /* the defaults */ }
  return DEFAULTS.map(fromDefault);
})();
let configured = false;
const listeners = new Set();
export const onStations = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// The stations on the dial (the ones switched on), by frequency.
export const stations = () => list.filter((s) => s.on !== false).sort((a, b) => a.freq - b.freq);
export const allStations = () => [...list].sort((a, b) => a.freq - b.freq);
export const isConfigured = () => configured;

// From the database, once per visit (and again after an admin saves).
export async function loadStations() {
  try {
    const snap = await getDocs(query(collection(db, 'stations'), orderBy('freq10')));
    configured = !snap.empty;
    list = snap.empty ? DEFAULTS.map(fromDefault) : snap.docs.map((d) => fromDoc(d.id, d.data()));
    try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch { /* not kept */ }
    for (const fn of listeners) fn(list);
  } catch { /* offline or not a member: the stations kept here */ }
  return list;
}

/* ---------- the audio of a station: its pieces, joined; kept for the visit ---------- */
const audioCache = new Map();
export async function audioOf(id) {
  if (audioCache.has(id)) return audioCache.get(id);
  const job = (async () => {
    const snap = await getDocs(query(collection(db, 'stations', id, 'audio'), orderBy('i')));
    const parts = snap.docs.map((d) => d.data().b.toUint8Array());
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
    return out.buffer;
  })();
  audioCache.set(id, job);
  job.catch(() => audioCache.delete(id));
  return job;
}

/* ---------- the admins: save, upload, delete ---------- */
// A YouTube link or id, as its id.
export function videoId(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,20})/) ?? t.match(/^([A-Za-z0-9_-]{6,20})$/);
  return m ? m[1] : '';
}
export const slug = (name) => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'estacion';

// Saves a station (its file, if a new one is given, goes first, in pieces). The first save writes every station of
// the radio as it is, so the dial keeps the ones that were already there.
export async function saveStation(st, file = null, onProgress = () => {}) {
  if (!configured) {
    for (const s of list) if (s.id !== st.id) await setDoc(doc(db, 'stations', s.id), toDoc(s));
  }
  let audio = st.audio;
  if (st.kind === 'audio' && file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_AUDIO) throw new Error(`El archivo pesa ${(bytes.length / 1e6).toFixed(1)} MB; el máximo es ${(MAX_AUDIO / 1e6).toFixed(0)} MB.`);
    const pieces = Math.ceil(bytes.length / PIECE);
    for (let i = 0; i < pieces; i += 1) {
      onProgress(i / pieces);
      await setDoc(doc(db, 'stations', st.id, 'audio', String(i)), { b: Bytes.fromUint8Array(bytes.subarray(i * PIECE, (i + 1) * PIECE)), i });
    }
    // Pieces left from a longer file before.
    for (let i = pieces; i < (st.audio?.pieces ?? 0); i += 1) await deleteDoc(doc(db, 'stations', st.id, 'audio', String(i))).catch(() => {});
    audio = { pieces, type: (file.type || 'audio/mpeg').slice(0, 40), size: bytes.length, name: file.name.slice(0, 120) };
    audioCache.delete(st.id);
    onProgress(1);
  }
  await setDoc(doc(db, 'stations', st.id), toDoc({ ...st, audio }));
  await loadStations();
}
export async function deleteStation(id) {
  const s = list.find((x) => x.id === id);
  if (!configured) for (const x of list) if (x.id !== id) await setDoc(doc(db, 'stations', x.id), toDoc(x));
  for (let i = 0; i < (s?.audio?.pieces ?? 0); i += 1) await deleteDoc(doc(db, 'stations', id, 'audio', String(i))).catch(() => {});
  await deleteDoc(doc(db, 'stations', id));
  await loadStations();
}
function toDoc(s) {
  const d = { name: String(s.name).slice(0, 80), freq10: Math.round(Number(s.freq) * 10), opens: s.opens, kind: s.kind, on: s.on !== false, updated: serverTimestamp() };
  if (s.kind === 'gen') d.gen = s.gen || 'bossa';
  if (s.kind === 'youtube') { d.video = s.video; d.caption = String(s.caption ?? '').slice(0, 400); d.showCaption = !!s.showCaption; }
  if (s.kind === 'audio') { if (s.audio) d.audio = s.audio; d.caption = String(s.caption ?? '').slice(0, 400); d.showCaption = !!s.showCaption; }
  return d;
}

/* ---------- the secrets' sounds (sounds/{id}): an audio file the admins upload replaces the page's own sound ---------- */
// Which sounds can be replaced: the shout of «¡Médico!» (by default, the browser's own voice).
export const SOUND_SLOTS = { medic: { name: 'El grito de «¡Médico!»', fallback: 'la voz del navegador diciendo «¡Médico!»' } };
const SOUNDS = 'studium-sounds';
let soundList = (() => { try { return JSON.parse(localStorage.getItem(SOUNDS) ?? '{}'); } catch { return {}; } })();
export const sounds = () => soundList;
export async function loadSounds() {
  try {
    const snap = await getDocs(collection(db, 'sounds'));
    soundList = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]).filter(([id]) => id in SOUND_SLOTS).map(([id, d]) => [id, { name: d.name, size: d.size, pieces: d.pieces, type: d.type }]));
    try { localStorage.setItem(SOUNDS, JSON.stringify(soundList)); } catch { /* not kept */ }
  } catch { /* offline or not a member: the ones kept here */ }
  return soundList;
}
const soundCache = new Map();
export function soundBytes(id) {
  if (soundCache.has(id)) return soundCache.get(id);
  const job = (async () => {
    const snap = await getDocs(query(collection(db, 'sounds', id, 'audio'), orderBy('i')));
    const parts = snap.docs.map((d) => d.data().b.toUint8Array());
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
    return out.buffer;
  })();
  soundCache.set(id, job);
  job.catch(() => soundCache.delete(id));
  return job;
}
export async function saveSound(id, file, onProgress = () => {}) {
  if (!(id in SOUND_SLOTS)) throw new Error('Ese sonido no existe.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 3 * PIECE) throw new Error(`El archivo pesa ${(bytes.length / 1e6).toFixed(1)} MB; para un efecto, el máximo es ${(3 * PIECE / 1e6).toFixed(1)} MB.`);
  const pieces = Math.ceil(bytes.length / PIECE);
  const old = soundList[id]?.pieces ?? 0;
  for (let i = 0; i < pieces; i += 1) { onProgress(i / pieces); await setDoc(doc(db, 'sounds', id, 'audio', String(i)), { b: Bytes.fromUint8Array(bytes.subarray(i * PIECE, (i + 1) * PIECE)), i }); }
  for (let i = pieces; i < old; i += 1) await deleteDoc(doc(db, 'sounds', id, 'audio', String(i))).catch(() => {});
  await setDoc(doc(db, 'sounds', id), { name: file.name.slice(0, 120), type: (file.type || 'audio/mpeg').slice(0, 40), size: bytes.length, pieces, updated: serverTimestamp() });
  soundCache.delete(id); onProgress(1);
  await loadSounds();
}
export async function deleteSound(id) {
  for (let i = 0; i < (soundList[id]?.pieces ?? 0); i += 1) await deleteDoc(doc(db, 'sounds', id, 'audio', String(i))).catch(() => {});
  await deleteDoc(doc(db, 'sounds', id));
  soundCache.delete(id);
  await loadSounds();
}
