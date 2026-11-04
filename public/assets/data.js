// Studium's data: Firebase sign-in, and the guides and contributions in Firestore (see firestore.rules).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp, Bytes,
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
  const [cat, con, own] = await Promise.all([
    getDocs(query(collection(db, 'catalog'), visible)),
    getDocs(query(collection(db, 'contributions'), visible)),
    uid ? getDocs(query(collection(db, 'owners'), where('uid', '==', uid))) : null,
  ]);
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
  return { catalog, contributions };
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
  } else batch.delete(doc(db, 'contributions', item.id));
  batch.delete(doc(db, 'owners', item.id));
  await batch.commit();
}
