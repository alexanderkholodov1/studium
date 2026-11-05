// Studium's data: Firebase sign-in, and in Firestore (see firestore.rules) the guides and contributions, the person's own
// profile, the thanks students give to guides and what they know about their professors.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, writeBatch,
  serverTimestamp, Bytes, increment,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { firebaseConfig } from './config.js';
import { keyOf } from './themes.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'es';
export const db = getFirestore(app);
// Local development against the Firebase emulators, when the development server (tools/dev.mjs) asks for them.
const emulators = globalThis.STUDIUM_EMULATORS;
if (emulators) {
  connectAuthEmulator(auth, `http://127.0.0.1:${emulators.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', emulators.firestore);
}

// A Firestore document holds at most 1 MiB; this leaves room for the other fields.
export const LIMIT = 900_000;

export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes) {
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
const millis = (value) => (value?.toMillis ? value.toMillis() : (value ? Date.parse(value) || 0 : 0));

function entryOf(snap) {
  const d = snap.data();
  return {
    id: snap.id, type: 'guide', topics: [], concepts: [], anchors: [], visibility: 'public', ...d,
    updated: millis(d.updated ?? d.updatedAt),
  };
}
async function contributionOf(snap) {
  const d = snap.data();
  let body = {};
  try { body = JSON.parse(await gunzip(d.body.toUint8Array())); } catch { /* an unreadable body adds nothing to the map */ }
  return { id: snap.id, type: 'contribution', visibility: 'public', ...d, body: undefined, data: body, updated: millis(d.updated) };
}

// Everything public, plus the account's own private guides and contributions.
export async function loadAll(uid) {
  const visible = where('visibility', '==', 'public');
  const [cat, con, own, src] = await Promise.all([
    getDocs(query(collection(db, 'catalog'), visible)),
    getDocs(query(collection(db, 'contributions'), visible)),
    uid ? getDocs(query(collection(db, 'owners'), where('uid', '==', uid))) : null,
    getDocs(collection(db, 'sources')),
  ]);
  const sources = src.docs.map((d) => ({ id: d.id, order: 0, ...d.data() })).sort((a, b) => a.order - b.order);
  const catalog = cat.docs.map(entryOf);
  const contributions = await Promise.all(con.docs.map(contributionOf));
  const mine = new Set(own?.docs.map((d) => d.id) ?? []);
  const known = new Set([...catalog, ...contributions].map((x) => x.id));
  for (const id of [...mine].filter((x) => !known.has(x))) {
    const entry = await getDoc(doc(db, 'catalog', id));
    if (entry.exists()) { catalog.push(entryOf(entry)); continue; }
    const item = await getDoc(doc(db, 'contributions', id));
    if (item.exists()) contributions.push(await contributionOf(item));
  }
  for (const item of [...catalog, ...contributions]) item.mine = mine.has(item.id);
  return { catalog, contributions, sources };
}

export async function loadGuide(id) {
  const snap = await getDoc(doc(db, 'guides', id));
  if (!snap.exists()) return null;
  const d = snap.data();
  const bytes = d.html.toUint8Array();
  const html = d.encoding === 'gzip' ? await gunzip(bytes) : new TextDecoder().decode(bytes);
  return { title: d.title ?? id, html };
}

const DESCRIBED = ['course', 'code', 'university', 'term', 'professor', 'title', 'theme'];
const described = (meta) => Object.fromEntries(DESCRIBED.filter((k) => meta[k]).map((k) => [k, meta[k]]));

// Publishes a contribution (meta: its description; data: the compact extract), or replaces one of the account's own.
export async function publishContribution(uid, meta, data, replaceId) {
  const body = await gzip(JSON.stringify(data));
  if (body.length > LIMIT) throw Object.assign(new Error('too-large'), { code: 'too-large', size: body.length });
  const ref = replaceId ? doc(db, 'contributions', replaceId) : doc(collection(db, 'contributions'));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...described(meta), kind: meta.kind, visibility: meta.visibility,
    concepts: [...new Set((data.curriculum ? data.curriculum.semesters.flatMap((sem) => sem.courses) : data.concepts)
      .map((c) => keyOf(c.name)))].slice(0, 300),
    questions: data.questions.length, examples: data.examples.length,
    body: Bytes.fromUint8Array(body), encoding: 'gzip', updated: serverTimestamp(),
  });
  if (!replaceId) batch.set(doc(db, 'owners', ref.id), { uid });
  await batch.commit();
  return ref.id;
}

// Publishes a guide (meta: its catalog entry; html: the page), or replaces one of the account's own.
export async function publishGuide(uid, meta, html, replaceId) {
  const packed = await gzip(html);
  if (packed.length > LIMIT) throw Object.assign(new Error('too-large'), { code: 'too-large', size: packed.length });
  const id = replaceId ?? doc(collection(db, 'catalog')).id;
  const batch = writeBatch(db);
  batch.set(doc(db, 'guides', id), {
    title: `${meta.course} · ${meta.title}`.slice(0, 220), html: Bytes.fromUint8Array(packed), encoding: 'gzip',
    size: new TextEncoder().encode(html).length, visibility: meta.visibility, updated: serverTimestamp(),
  });
  batch.set(doc(db, 'catalog', id), {
    ...described(meta), date: meta.date, topics: meta.topics, concepts: meta.concepts, anchors: meta.anchors,
    ...(meta.level ? { level: meta.level } : {}), visibility: meta.visibility, updated: serverTimestamp(),
    // Optional: the name the author chose to sign with, and the AI that made the guide.
    ...(meta.by ? { by: String(meta.by).slice(0, 60) } : {}),
    ...(meta.ai?.provider ? { ai: { provider: meta.ai.provider, model: String(meta.ai.model ?? '').slice(0, 80), effort: meta.ai.effort ?? '' } } : {}),
  });
  if (!replaceId) batch.set(doc(db, 'owners', id), { uid });
  await batch.commit();
  return id;
}

export async function setVisibility(item, visibility) {
  const batch = writeBatch(db);
  const change = { visibility, updated: serverTimestamp() };
  if (item.type === 'guide') {
    batch.update(doc(db, 'guides', item.id), change);
    batch.update(doc(db, 'catalog', item.id), change);
  } else batch.update(doc(db, 'contributions', item.id), change);
  await batch.commit();
}

export async function remove(item) {
  const batch = writeBatch(db);
  if (item.type === 'guide') {
    batch.delete(doc(db, 'guides', item.id));
    batch.delete(doc(db, 'catalog', item.id));
  } else batch.delete(doc(db, item.type === 'document' ? 'library' : 'contributions', item.id));
  batch.delete(doc(db, 'owners', item.id));
  await batch.commit();
}

/* ---------- the library: shared course documents, as links ---------- */
export const DOC_KINDS = { syllabus: 'Sílabo', reading: 'Texto de apoyo', lab: 'Guía de laboratorio', assignment: 'Enunciado', slides: 'Diapositivas', other: 'Otro' };
export async function loadLibrary(uid) {
  const [snap, own] = await Promise.all([
    getDocs(collection(db, 'library')),
    uid ? getDocs(query(collection(db, 'owners'), where('uid', '==', uid))) : null,
  ]);
  const mine = new Set(own?.docs.map((d) => d.id) ?? []);
  return snap.docs.map((d) => ({ id: d.id, type: 'document', ...d.data(), updated: millis(d.data().updated), mine: mine.has(d.id) }));
}
export async function publishDocument(uid, meta, replaceId) {
  const ref = replaceId ? doc(db, 'library', replaceId) : doc(collection(db, 'library'));
  const keep = (k, max) => (meta[k] ? { [k]: String(meta[k]).trim().slice(0, max) } : {});
  const batch = writeBatch(db);
  batch.set(ref, {
    course: meta.course.trim().slice(0, 80), kind: meta.kind, title: meta.title.trim().slice(0, 140), url: meta.url.trim(),
    ...keep('code', 30), ...keep('professor', 80), ...keep('term', 60), ...keep('note', 200), ...keep('by', 60),
    updated: serverTimestamp(),
  });
  if (!replaceId) batch.set(doc(db, 'owners', ref.id), { uid });
  await batch.commit();
  return ref.id;
}

/* ---------- the person's profile (only its owner reads it) ---------- */
export async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'profiles', uid));
  if (!snap.exists()) return null;
  const { updated, ...data } = snap.data();
  return data;
}
export async function saveProfile(uid, profile) {
  await setDoc(doc(db, 'profiles', uid), { ...profile, updated: serverTimestamp() });
}

/* ---------- thanks: only positive reactions, one document per guide and account ---------- */
export const KUDOS = ['salvo', 'entendi', 'examen', 'gracias'];
export async function loadKudos(uid) {
  const snap = await getDocs(collection(db, 'kudos'));
  const counts = new Map();
  const mine = new Map();
  for (const d of snap.docs) {
    const { guide, kinds = [] } = d.data();
    const tally = counts.get(guide) ?? Object.fromEntries(KUDOS.map((k) => [k, 0]));
    for (const k of kinds) if (k in tally) tally[k] += 1;
    counts.set(guide, tally);
    if (uid && d.id === `${guide}__${uid}`) mine.set(guide, new Set(kinds));
  }
  return { counts, mine };
}
export async function setKudos(uid, guide, kinds) {
  const ref = doc(db, 'kudos', `${guide}__${uid}`);
  if (kinds.length) await setDoc(ref, { guide, kinds, updated: serverTimestamp() });
  else await deleteDoc(ref);
}

/* ---------- what students know about their professors: fixed, constructive tags, no free text ---------- */
export async function loadTips() {
  const snap = await getDocs(collection(db, 'tips'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), updated: millis(d.data().updated) }));
}
export async function setTip(uid, tip) {
  const ref = doc(db, 'tips', `${tip.prof}__${uid}`);
  if (tip.tags.length) {
    await setDoc(ref, { prof: tip.prof, professor: tip.professor, ...(tip.course ? { course: tip.course } : {}), tags: tip.tags, updated: serverTimestamp() });
  } else await deleteDoc(ref);
}

/* ---------- presence: when an account was last seen ---------- */
// Written on real events only (signing in, opening the page, coming back to it, changing page), at most once every five
// minutes, and never by a timer. «since» keeps the first time the account was seen.
const SEEN_EVERY = 5 * 60_000;
let lastSeen = 0;
export async function markPresence(uid, community) {
  if (!uid || Date.now() - lastSeen < SEEN_EVERY) return;
  lastSeen = Date.now();
  const ref = doc(db, 'presence', uid);
  let since = null;
  try { const snap = await getDoc(ref); since = snap.exists() ? snap.data().since ?? null : null; } catch { /* first time */ }
  await setDoc(ref, { at: serverTimestamp(), community: String(community ?? '').slice(0, 30), since: since ?? serverTimestamp() });
}

/* ---------- easter eggs: how many people found each one ---------- */
export async function countEgg(id) {
  await setDoc(doc(db, 'eggs', id), { count: increment(1) }, { merge: true });
}
