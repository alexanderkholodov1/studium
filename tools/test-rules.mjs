// Tests the Firestore rules as real accounts meet them: creates temporary accounts, guides and contributions, signs in
// like the browser does, reads and writes through the public REST API, then deletes everything it created.
// Usage: node tools/test-rules.mjs               the live rules of the project in .firebaserc
//        node tools/test-rules.mjs --emulators   the local emulators of firebase.json (firebase emulators:start)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { accessToken, call, project, customToken } from './google.mjs';
import { DEFAULT_SETTINGS, domainsOf, fromFields, toFields } from './settings.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const config = read('public/assets/config.js');

const emulated = process.argv.includes('--emulators');
const ports = JSON.parse(read('firebase.json')).emulators;
const id = project();
const base = `projects/${id}/databases/(default)/documents`;
const firestore = emulated ? `http://127.0.0.1:${ports.firestore.port}/v1/${base}` : `https://firestore.googleapis.com/v1/${base}`;
const identity = emulated ? `http://127.0.0.1:${ports.auth.port}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1';
const webKey = emulated ? 'emulator' : config.match(/apiKey:\s*'(AIza[0-9A-Za-z_-]{30,})'/)[1];
// The emulators accept "owner" as the administrator's token.
const admin = emulated ? 'owner' : await accessToken();

// The settings the rules read (settings/app): in the emulators the defaults of config.js are written first; live, the
// project's own are only read, never changed. The test accounts use the accepted domains, and what an unconfirmed
// account may do follows the confirmation setting.
const settingsPath = `${firestore}/settings/app`;
const settingsDoc = (over = {}) => {
  const next = { ...DEFAULT_SETTINGS, ...over };
  return { ...next, domains: over.domains ?? domainsOf(next) };
};
let settings;
if (emulated) {
  settings = settingsDoc();
  await call(admin, 'PATCH', settingsPath, { fields: toFields({ ...settings, by: 'test', updated: new Date() }) });
} else settings = fromFields((await call(admin, 'GET', settingsPath)).fields);
const [domain, second] = settings.domains;
const confirmEmail = settings.confirmEmail === true;

const tag = `rules-test-${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('base64url');
const appId = () => [...randomBytes(20)].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');

const accounts = {
  student: { email: `${tag}@${domain}`, emailVerified: true },
  classmate: { email: `${tag}-c@${domain}`, emailVerified: true },
  unverified: { email: `${tag}-u@${domain}`, emailVerified: false },
  otherDomain: { email: `${tag}@example.com`, emailVerified: true },
  lookalike: { email: `${tag}@${domain}.example.com`, emailVerified: true },
  // An admin: an address of no community, with the custom claim admin: true.
  admin: { email: `${tag}-admin@example.com`, emailVerified: true, claims: { admin: true } },
  // A second accepted domain, when there is one (USFQ's alumni).
  ...(second ? { second: { email: `${tag}-2@${second}`, emailVerified: true } } : {}),
};
const created = [];
const touched = new Set();
let failures = 0;
let checks = 0;

async function signIn(email) {
  const response = await fetch(`${identity}/accounts:signInWithPassword?key=${webKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`sign-in failed for a test account: ${body.error?.message ?? response.status}`);
  return body.idToken;
}
// Signing in with a custom token, as the admin tools do for an account. The emulators take an unsigned one.
async function signInAs(uid) {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const token = emulated ? `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ uid, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit' })}.` : customToken(uid);
  const response = await fetch(`${identity}/accounts:signInWithCustomToken?key=${webKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`custom sign-in failed for a test account: ${body.error?.message ?? response.status}`);
  return body.idToken;
}
// A request's status. A momentary server error (500, 502, 503, 504) is not a verdict of the rules: it is retried,
// up to three times, a moment apart.
async function status(token, method, path, body) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${firestore}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    await response.arrayBuffer();
    if (![500, 502, 503, 504].includes(response.status) || attempt >= 3) return response.status;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

// Firestore REST values and writes.
const value = (v) => {
  if (Buffer.isBuffer(v)) return { bytesValue: v.toString('base64') };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v && typeof v === 'object') return { mapValue: { fields: fields(v) } };
  return { stringValue: String(v) };
};
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
// stamp: the field that gets the request's time ('updated' unless told otherwise); mask: change only these fields.
function put(path, data, { stamp = 'updated', create = false, mask = null } = {}) {
  touched.add(path);
  return {
    update: { name: `${base}/${path}`, fields: fields(data) },
    ...(mask ? { updateMask: { fieldPaths: [...mask, ...(stamp ? [stamp] : [])] } } : {}),
    ...(stamp ? { updateTransforms: [{ fieldPath: stamp, setToServerValue: 'REQUEST_TIME' }] } : {}),
    ...(create ? { currentDocument: { exists: false } } : {}),
  };
}
const remove = (path) => ({ delete: `${base}/${path}` });
const commit = (token, writes) => status(token, 'POST', ':commit', { writes });
// The kept copy of an item as it is now (the rules demand one before its owner changes or deletes it): read with the
// administrator's token, written as versions/{id}__{collection}__{millis of its last change}.
async function keep(col, docId, uid, action = 'replaced', over = {}) {
  const current = await call(admin, 'GET', `${firestore}/${col}/${docId}`);
  const ms = String(Date.parse(current.fields?.updated?.timestampValue ?? '') || 0);
  const vid = `${docId}__${col}__${ms}`;
  touched.add(`versions/${vid}`);
  return { vid, write: {
    update: { name: `${base}/versions/${vid}`, fields: { of: { stringValue: docId }, col: { stringValue: col }, uid: { stringValue: uid }, action: { stringValue: action }, data: { mapValue: { fields: { ...current.fields, ...over } } } } },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
  }, fields: current.fields };
}
// A list as the app asks for it (public documents only), or one that asks for everything.
const where = (field, v) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: v } } });
const list = (token, collection, filter) => status(token, 'POST', ':runQuery', { structuredQuery: { from: [{ collectionId: collection }], ...(filter ? { where: filter } : {}) } });
const publicList = (token, collection) => list(token, collection, where('visibility', 'public'));

const gz = (text) => gzipSync(Buffer.from(text));
const contribution = (extra = {}) => ({
  kind: 'exam', course: 'Curso de prueba', professor: 'Docente de prueba', term: 'Semestre de prueba', title: 'Prueba',
  theme: 'vectores', concepts: ['concepto-a', 'concepto-b'], questions: 1, examples: 0,
  body: gz(JSON.stringify({ concepts: [{ name: 'Concepto A' }] })), encoding: 'gzip', visibility: 'public', ...extra,
});
const entry = (visibility = 'public', extra = {}) => ({ course: 'Curso de prueba', title: 'Guía de prueba', date: '2026-01-01', topics: [], concepts: ['Concepto A'], anchors: [''], theme: 'vectores', visibility, ...extra });
const guide = (html = '<!doctype html><title>prueba</title>', visibility = 'public') => ({ title: 'Guía de prueba', html: gz(html), encoding: 'gzip', size: html.length, visibility });
const owner = (uid) => ({ uid });

function expect(label, actual, wanted) {
  const ok = actual === wanted;
  checks += 1;
  if (!ok) failures += 1;
  // Logs of a public repository's CI are public: there, only failures are itemized.
  if (!ok || !process.env.CI) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: HTTP ${actual}${ok ? '' : ` (expected ${wanted})`}`);
}

try {
  // A guide published with the admin tool (no owner), under a hyphenated id and under an app-style id.
  const adminGuide = appId();
  touched.add(`guides/${tag}`); touched.add(`guides/${adminGuide}`); touched.add(`catalog/${adminGuide}`);
  await call(admin, 'POST', `${firestore}:commit`, { writes: [
    { update: { name: `${base}/guides/${tag}`, fields: fields({ title: 'rules test' }) } },
    { update: { name: `${base}/guides/${adminGuide}`, fields: fields({ title: 'rules test' }) } },
    { update: { name: `${base}/catalog/${adminGuide}`, fields: fields({ course: 'Curso de prueba', title: 'rules test', visibility: 'public' }) } },
  ] });
  for (const account of Object.values(accounts)) {
    const user = await call(admin, 'POST', `${identity}/projects/${id}/accounts`, { email: account.email, emailVerified: account.emailVerified, password });
    created.push(user.localId);
    account.uid = user.localId;
    if (account.claims) await call(admin, 'POST', `${identity}/projects/${id}/accounts:update`, { localId: user.localId, customAttributes: JSON.stringify(account.claims) });
    account.token = await signIn(account.email);
  }
  const write = { fields: { title: { stringValue: 'x' } } };
  const { student: s, classmate: c } = accounts;

  // Reading
  expect('student lists the public catalog', await publicList(s.token, 'catalog'), 200);
  expect('student opens one guide', await status(s.token, 'GET', `/guides/${tag}`), 200);
  expect('student lists the public contributions', await publicList(s.token, 'contributions'), 200);
  expect('student cannot list the catalog without asking for public entries', await list(s.token, 'catalog'), 403);
  expect('student cannot list the contributions without asking for public ones', await list(s.token, 'contributions'), 403);
  expect('student cannot list every guide', await status(s.token, 'GET', '/guides'), 403);
  expect('student cannot list every owner', await status(s.token, 'GET', '/owners'), 403);
  expect('student cannot read other collections', await status(s.token, 'GET', `/other/${tag}`), 403);
  expect('student lists the sources', await list(s.token, 'sources'), 200);
  expect('student cannot write a source', await status(s.token, 'PATCH', `/sources/${tag}`, write), 403);
  expect('otherDomain cannot list the sources', await list(accounts.otherDomain.token, 'sources'), 403);
  for (const [name, account] of Object.entries(accounts).filter(([name]) => !['student', 'classmate', 'admin', 'second'].includes(name))) {
    const allowedToo = name === 'unverified' && !confirmEmail;
    const verb = allowedToo ? 'can' : 'cannot';
    expect(`${name} ${verb} list the catalog`, await publicList(account.token, 'catalog'), allowedToo ? 200 : 403);
    expect(`${name} ${verb} open a guide`, await status(account.token, 'GET', `/guides/${tag}`), allowedToo ? 200 : 403);
    expect(`${name} ${verb} list the contributions`, await publicList(account.token, 'contributions'), allowedToo ? 200 : 403);
  }
  if (accounts.second) expect('an account of the second accepted domain lists the catalog', await publicList(accounts.second.token, 'catalog'), 200);
  expect('no account cannot list the catalog', await publicList(null, 'catalog'), 403);
  expect('no account cannot open a guide', await status(null, 'GET', `/guides/${tag}`), 403);
  expect('no account cannot list the contributions', await publicList(null, 'contributions'), 403);

  // Contributions
  const mine = appId();
  expect('student publishes a contribution with its owner', await commit(s.token, [
    put(`contributions/${mine}`, contribution(), { create: true }), put(`owners/${mine}`, owner(s.uid), { stamp: false, create: true })]), 200);
  const loose = appId();
  expect('a contribution without an owner is refused', await commit(s.token, [put(`contributions/${loose}`, contribution(), { create: true })]), 403);
  const forged = appId();
  expect('a contribution owned by another account is refused', await commit(s.token, [
    put(`contributions/${forged}`, contribution(), { create: true }), put(`owners/${forged}`, owner(c.uid), { stamp: false, create: true })]), 403);
  const signed = appId();
  expect('a contribution that names its author is refused', await commit(s.token, [
    put(`contributions/${signed}`, contribution({ author: s.email }), { create: true }), put(`owners/${signed}`, owner(s.uid), { stamp: false, create: true })]), 403);
  const huge = appId();
  expect('a contribution over the size limit is refused', await commit(s.token, [
    put(`contributions/${huge}`, contribution({ body: randomBytes(900_001) }), { create: true }), put(`owners/${huge}`, owner(s.uid), { stamp: false, create: true })]), 403);
  const odd = appId();
  expect('a contribution of an unknown kind is refused', await commit(s.token, [
    put(`contributions/${odd}`, contribution({ kind: 'secret' }), { create: true }), put(`owners/${odd}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('classmate cannot change it', await commit(c.token, [put(`contributions/${mine}`, contribution({ title: 'cambiada' }))]), 403);
  expect('classmate cannot delete it', await commit(c.token, [remove(`contributions/${mine}`)]), 403);
  expect('classmate cannot take its owner record', await commit(c.token, [put(`owners/${mine}`, owner(c.uid), { stamp: false })]), 403);
  expect('classmate cannot read its owner record', await status(c.token, 'GET', `/owners/${mine}`), 403);
  expect('student reads its own owner record', await status(s.token, 'GET', `/owners/${mine}`), 200);
  expect('student lists its own owner records', await list(s.token, 'owners', where('uid', s.uid)), 200);
  expect('student cannot list the owner records of another account', await list(s.token, 'owners', where('uid', c.uid)), 403);
  // History: a change or a deletion by the owner keeps the current version first; only its owner and the admins read it.
  expect('changing a contribution without keeping its version is refused', await commit(s.token, [put(`contributions/${mine}`, contribution({ title: 'cambiada' }))]), 403);
  const first = await keep('contributions', mine, s.uid);
  expect('a kept version that is not an exact copy is refused', await commit(s.token, [(await keep('contributions', mine, s.uid, 'replaced', { title: { stringValue: 'falsa' } })).write, put(`contributions/${mine}`, contribution({ title: 'cambiada' }))]), 403);
  expect('a kept version in the name of another owner is refused', await commit(s.token, [(await keep('contributions', mine, c.uid)).write, put(`contributions/${mine}`, contribution({ title: 'cambiada' }))]), 403);
  expect('classmate cannot keep a version of it', await commit(c.token, [(await keep('contributions', mine, s.uid)).write]), 403);
  expect('student changes its contribution, keeping its version', await commit(s.token, [first.write, put(`contributions/${mine}`, contribution({ title: 'cambiada' }))]), 200);
  expect('student reads its kept version', await status(s.token, 'GET', `/versions/${first.vid}`), 200);
  expect('student lists its kept versions', await list(s.token, 'versions', where('uid', s.uid)), 200);
  expect('classmate cannot read the kept version', await status(c.token, 'GET', `/versions/${first.vid}`), 403);
  expect('admin reads the kept version', await status(accounts.admin.token, 'GET', `/versions/${first.vid}`), 200);
  expect('changing only who sees it needs no kept version', await commit(s.token, [put(`contributions/${mine}`, { visibility: 'private' }, { mask: ['visibility'] })]), 200);
  expect('and back', await commit(s.token, [put(`contributions/${mine}`, { visibility: 'public' }, { mask: ['visibility'] })]), 200);
  {
    // The admin restores exactly the kept version, keeping the current one first.
    const now = await keep('contributions', mine, s.uid, 'restored');
    const { updated, ...old } = first.fields;
    const restore = { update: { name: `${base}/contributions/${mine}`, fields: old }, updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }] };
    touched.add(`restores/${mine}`);
    expect('admin cannot restore without naming the version', await commit(accounts.admin.token, [now.write, restore]), 403);
    const changed = { update: { name: `${base}/contributions/${mine}`, fields: { ...old, title: { stringValue: 'del admin' } } }, updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }] };
    expect('admin cannot write anything else than the kept version', await commit(accounts.admin.token, [now.write, put(`restores/${mine}`, { contributions: first.vid }, { stamp: false }), changed]), 403);
    expect('admin restores the kept version', await commit(accounts.admin.token, [now.write, put(`restores/${mine}`, { contributions: first.vid }, { stamp: false }), restore]), 200);
    expect('classmate cannot restore anything', await commit(c.token, [put(`restores/${mine}`, { contributions: first.vid }, { stamp: false })]), 403);
  }
  for (const [name, account] of [['otherDomain', accounts.otherDomain], ['lookalike', accounts.lookalike]]) {
    const theirs = appId();
    expect(`${name} cannot publish a contribution`, await commit(account.token, [
      put(`contributions/${theirs}`, contribution(), { create: true }), put(`owners/${theirs}`, owner(account.uid), { stamp: false, create: true })]), 403);
  }
  for (const kind of ['contest', 'curriculum']) {
    const other = appId();
    expect(`student publishes a contribution of kind ${kind}`, await commit(s.token, [
      put(`contributions/${other}`, contribution({ kind }), { create: true }), put(`owners/${other}`, owner(s.uid), { stamp: false, create: true })]), 200);
  }
  const hidden = appId();
  expect('student publishes a private contribution', await commit(s.token, [
    put(`contributions/${hidden}`, contribution({ visibility: 'private' }), { create: true }), put(`owners/${hidden}`, owner(s.uid), { stamp: false, create: true })]), 200);
  expect('student opens its private contribution', await status(s.token, 'GET', `/contributions/${hidden}`), 200);
  expect('classmate cannot open a private contribution', await status(c.token, 'GET', `/contributions/${hidden}`), 403);
  expect('classmate opens a public contribution', await status(c.token, 'GET', `/contributions/${mine}`), 200);
  expect('a contribution of an unknown visibility is refused', await commit(s.token, [
    put(`contributions/${odd}`, contribution({ visibility: 'friends' }), { create: true }), put(`owners/${odd}`, owner(s.uid), { stamp: false, create: true })]), 403);
  const unverified = appId();
  expect(`unverified ${confirmEmail ? 'cannot' : 'can'} publish a contribution`, await commit(accounts.unverified.token, [
    put(`contributions/${unverified}`, contribution(), { create: true }), put(`owners/${unverified}`, owner(accounts.unverified.uid), { stamp: false, create: true })]), confirmEmail ? 403 : 200);

  // v0.5.1: the evaluation a contribution belongs to, the collection it comes from, the fingerprint of its file, the new
  // kinds, and what a contribution leaves when it stops being public.
  const source = `${tag}-coleccion`;
  touched.add(`sources/${source}`);
  await call(admin, 'POST', `${firestore}:commit`, { writes: [{ update: { name: `${base}/sources/${source}`, fields: fields({ name: 'Colección de prueba', order: 9 }) } }] });
  const full = appId();
  expect('student publishes a contribution with its evaluation, source and fingerprint', await commit(s.token, [
    put(`contributions/${full}`, contribution({ stage: 'Examen 2', source, print: 'a1b2c3d4e5f60718293a4b5c' }), { create: true }), put(`owners/${full}`, owner(s.uid), { stamp: false, create: true })]), 200);
  const nosource = appId();
  expect('a contribution that names an unregistered source is refused', await commit(s.token, [
    put(`contributions/${nosource}`, contribution({ source: `${tag}-inventada` }), { create: true }), put(`owners/${nosource}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('a contribution with a malformed fingerprint is refused', await commit(s.token, [
    put(`contributions/${nosource}`, contribution({ print: 'Nombre del archivo.pdf' }), { create: true }), put(`owners/${nosource}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('a contribution with an overlong evaluation is refused', await commit(s.token, [
    put(`contributions/${nosource}`, contribution({ stage: 'x'.repeat(41) }), { create: true }), put(`owners/${nosource}`, owner(s.uid), { stamp: false, create: true })]), 403);
  for (const kind of ['lab', 'summary', 'syllabus']) {
    const other = appId();
    expect(`student publishes a contribution of kind ${kind}`, await commit(s.token, [
      put(`contributions/${other}`, contribution({ kind }), { create: true }), put(`owners/${other}`, owner(s.uid), { stamp: false, create: true })]), 200);
  }
  expect('student makes its contribution private and leaves a removal record', await commit(s.token, [(await keep('contributions', full, s.uid)).write,
    put(`contributions/${full}`, contribution({ visibility: 'private', stage: 'Examen 2', source })), put(`removed/${full}`, {}, { stamp: 'at' })]), 200);
  expect('classmate cannot leave a removal record for it', await commit(c.token, [put(`removed/${full}`, {}, { stamp: 'at' })]), 403);
  expect('a removal record with other fields is refused', await commit(s.token, [put(`removed/${full}`, { why: 'x' }, { stamp: 'at' })]), 403);
  expect('a removal record with another time is refused', await commit(s.token, [put(`removed/${full}`, { at: new Date(Date.now() - 86_400_000) }, { stamp: false })]), 403);
  expect('classmate reads the removal records', await list(c.token, 'removed'), 200);
  expect('no account cannot read the removal records', await list(null, 'removed'), 403);
  // Acting for an account with a custom token (the upload tools).
  const actingToken = await signInAs(s.uid);
  const acted = appId();
  expect('a custom-token sign-in publishes in the account\'s name', await commit(actingToken, [
    put(`contributions/${acted}`, contribution({ source }), { create: true }), put(`owners/${acted}`, owner(s.uid), { stamp: false, create: true })]), 200);
  const claimed = appId();
  expect('a custom-token sign-in cannot publish in another account\'s name', await commit(actingToken, [
    put(`contributions/${claimed}`, contribution(), { create: true }), put(`owners/${claimed}`, owner(c.uid), { stamp: false, create: true })]), 403);

  // Guides
  expect('student cannot claim a guide published without an owner', await commit(s.token, [put(`owners/${adminGuide}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('student cannot change a guide published without an owner', await commit(s.token, [put(`guides/${adminGuide}`, guide())]), 403);
  expect('student cannot change a catalog entry published without an owner', await status(s.token, 'PATCH', `/catalog/${adminGuide}`, write), 403);
  expect('student cannot delete a guide published without an owner', await commit(s.token, [remove(`guides/${adminGuide}`), remove(`catalog/${adminGuide}`)]), 403);
  const g = appId();
  expect('student publishes a guide with its entry and owner', await commit(s.token, [
    put(`guides/${g}`, guide(), { create: true }), put(`catalog/${g}`, entry(), { create: true }), put(`owners/${g}`, owner(s.uid), { stamp: false, create: true })]), 200);
  const secret = appId();
  expect('student publishes a private guide', await commit(s.token, [
    put(`guides/${secret}`, guide(undefined, 'private'), { create: true }), put(`catalog/${secret}`, entry('private'), { create: true }), put(`owners/${secret}`, owner(s.uid), { stamp: false, create: true })]), 200);
  expect('student opens its private guide', await status(s.token, 'GET', `/guides/${secret}`), 200);
  expect('student opens its private catalog entry', await status(s.token, 'GET', `/catalog/${secret}`), 200);
  expect('classmate cannot open a private guide', await status(c.token, 'GET', `/guides/${secret}`), 403);
  expect('classmate cannot open a private catalog entry', await status(c.token, 'GET', `/catalog/${secret}`), 403);
  expect('student makes its private guide public', await commit(s.token, [put(`guides/${secret}`, guide()), put(`catalog/${secret}`, entry())]), 200);
  expect('classmate opens it once public', await status(c.token, 'GET', `/guides/${secret}`), 200);
  expect('a guide and its entry with different visibility are refused', await commit(s.token, [put(`guides/${secret}`, guide(undefined, 'private'))]), 403);
  expect('a missing guide reads as missing', await status(s.token, 'GET', `/guides/${appId()}`), 404);
  const bare = appId();
  expect('a guide without a catalog entry is refused', await commit(s.token, [
    put(`guides/${bare}`, guide(), { create: true }), put(`owners/${bare}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('classmate cannot replace the guide', await commit(c.token, [put(`guides/${g}`, guide('<!doctype html><title>otra</title>'))]), 403);
  expect('replacing a guide without keeping its version is refused', await commit(s.token, [put(`guides/${g}`, guide('<!doctype html><title>nueva</title>')), put(`catalog/${g}`, entry())]), 403);
  const keptPage = await keep('guides', g, s.uid);
  const keptEntry = await keep('catalog', g, s.uid);
  expect('student replaces its guide, keeping both parts', await commit(s.token, [keptPage.write, keptEntry.write,
    put(`guides/${g}`, guide('<!doctype html><title>nueva</title>')), put(`catalog/${g}`, entry())]), 200);
  {
    const back = (k, col) => { const { updated, ...old } = k.fields; return { update: { name: `${base}/${col}/${g}`, fields: old }, updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }] }; };
    touched.add(`restores/${g}`);
    expect('admin cannot write a page that is not a kept version', await commit(accounts.admin.token, [(await keep('guides', g, s.uid, 'restored')).write,
      put(`restores/${g}`, { guides: keptEntry.vid }, { stamp: false }), back(keptPage, 'guides')]), 403);
    expect('admin restores one part, exactly as kept', await commit(accounts.admin.token, [(await keep('guides', g, s.uid, 'restored')).write,
      put(`restores/${g}`, { guides: keptPage.vid }, { stamp: false }), back(keptPage, 'guides')]), 200);
    expect('admin restores both parts of a guide', await commit(accounts.admin.token, [(await keep('guides', g, s.uid, 'restored')).write, (await keep('catalog', g, s.uid, 'restored')).write,
      put(`restores/${g}`, { guides: keptPage.vid, catalog: keptEntry.vid }, { stamp: false }), back(keptPage, 'guides'), back(keptEntry, 'catalog')]), 200);
  }
  expect('student cannot keep the entry while deleting the guide', await commit(s.token, [remove(`guides/${g}`)]), 403);
  const signed2 = appId();
  expect('student publishes a guide signed with its name and the AI that made it', await commit(s.token, [
    put(`guides/${signed2}`, guide(), { create: true }),
    put(`catalog/${signed2}`, entry('public', { by: 'Nombre de Prueba', ai: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' } }), { create: true }),
    put(`owners/${signed2}`, owner(s.uid), { stamp: false, create: true })]), 200);
  const oddAi = appId();
  expect('a guide naming an unknown kind of AI is refused', await commit(s.token, [
    put(`guides/${oddAi}`, guide(), { create: true }),
    put(`catalog/${oddAi}`, entry('public', { ai: { provider: 'skynet', model: 'x' } }), { create: true }),
    put(`owners/${oddAi}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('deleting a contribution without keeping it is refused', await commit(s.token, [remove(`contributions/${mine}`), remove(`owners/${mine}`)]), 403);
  expect('student deletes its guide, keeping it', await commit(s.token, [(await keep('guides', g, s.uid, 'deleted')).write, (await keep('catalog', g, s.uid, 'deleted')).write,
    remove(`guides/${g}`), remove(`catalog/${g}`), remove(`owners/${g}`)]), 200);
  const gone = await keep('contributions', mine, s.uid, 'deleted');
  expect('student deletes its contribution, keeping it', await commit(s.token, [gone.write, remove(`contributions/${mine}`), remove(`owners/${mine}`)]), 200);
  expect('student still reads what it deleted', await status(s.token, 'GET', `/versions/${gone.vid}`), 200);
  expect('student deletes its kept version for good', await commit(s.token, [remove(`versions/${gone.vid}`)]), 200);
  // The person's own space
  const profile = (extra = {}) => ({ mode: 'metas', ambience: 'jugueton', sound: true, theme: 'dark', semester: 7, career: 'Carrera de prueba',
    nickname: 'Prueba', goals: [{ id: 'a1', text: 'Terminar la guía', done: false }], progress: { [adminGuide]: 'done' }, ...extra });
  expect('student saves its profile', await commit(s.token, [put(`profiles/${s.uid}`, profile())]), 200);
  expect('student reads its profile', await status(s.token, 'GET', `/profiles/${s.uid}`), 200);
  expect('classmate cannot read the profile of another account', await status(c.token, 'GET', `/profiles/${s.uid}`), 403);
  expect('classmate cannot write the profile of another account', await commit(c.token, [put(`profiles/${s.uid}`, profile())]), 403);
  expect('a profile with an unknown ambience is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ ambience: 'neon' }))]), 403);
  expect('a profile with other fields is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ email: s.email }))]), 403);
  expect('student saves its career and the classes it passed', await commit(s.token, [put(`profiles/${s.uid}`, profile({ malla: '1CMP', passed: ['MAT 1201', 'CMP 4004E', 'OPT 1'] }))]), 200);
  expect('a career code with other characters is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ malla: '1cmp/../x' }))]), 403);
  expect('more than 150 passed classes is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ passed: Array.from({ length: 151 }, (_, i) => `MAT ${1000 + i}`) }))]), 403);
  expect('student saves its courses, interests and known concepts', await commit(s.token, [put(`profiles/${s.uid}`, profile({ courses: ['redes-de-computadores'], interests: ['area:redes'], known: ['subred', 'vlan'] }))]), 200);
  expect('student saves its to-dos', await commit(s.token, [put(`profiles/${s.uid}`, profile({ todos: [{ id: 't1', text: 'Leer el capítulo 3', done: false, due: '2026-11-25T15:00', cls: 'abc123', label: 'Redes' }] }))]), 200);
  expect('student saves its plan for next semester', await commit(s.token, [put(`profiles/${s.uid}`, profile({ plan: ['CMP 4005', 'MAT 2203'] }))]), 200);
  expect('a plan of more than 12 classes is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ plan: Array.from({ length: 13 }, (_, i) => `MAT ${1000 + i}`) }))]), 403);
  expect('more than 80 to-dos is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ todos: Array.from({ length: 81 }, (_, i) => ({ id: `t${i}`, text: 'x', done: false })) }))]), 403);
  expect('a profile whose known concepts are not a list is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ known: 'subred' }))]), 403);
  expect('student keeps its drafts of «Crea tu guía»', await commit(s.token, [put(`drafts/${s.uid}`, { material: { course: 'Redes' }, guide: { course: 'Cálculo II', level: 'standard' } })]), 200);
  expect('student reads its drafts', await status(s.token, 'GET', `/drafts/${s.uid}`), 200);
  // An admin manages Studium, not people's private things: no admin path reads them.
  expect('an admin cannot read the drafts of a member', await status(accounts.admin.token, 'GET', `/drafts/${s.uid}`), 403);
  expect('an admin cannot read the profile of a member', await status(accounts.admin.token, 'GET', `/profiles/${s.uid}`), 403);
  expect('an admin cannot read the schedule of a member', await status(accounts.admin.token, 'GET', `/schedules/${s.uid}`), 403);
  expect('an admin cannot list the drafts', await list(accounts.admin.token, 'drafts'), 403);
  expect('an admin cannot list the profiles', await list(accounts.admin.token, 'profiles'), 403);
  expect('an admin cannot list the vaults', await list(accounts.admin.token, 'vaults'), 403);
  expect('classmate cannot read the drafts of another account', await status(c.token, 'GET', `/drafts/${s.uid}`), 403);
  expect('classmate cannot write the drafts of another account', await commit(c.token, [put(`drafts/${s.uid}`, { guide: {} })]), 403);
  expect('drafts with other fields are refused', await commit(s.token, [put(`drafts/${s.uid}`, { notes: 'x' })]), 403);
  // The encrypted keys: only their owner.
  {
    const box = (extra = {}) => ({ salt: 'c2FsdA==', iter: 600000, iv: 'aXY=', data: 'ZGF0YQ==', ...extra });
    expect('student keeps its encrypted keys', await commit(s.token, [put(`vaults/${s.uid}`, box())]), 200);
    expect('student reads its encrypted keys', await status(s.token, 'GET', `/vaults/${s.uid}`), 200);
    expect('classmate cannot read the keys of another', await status(c.token, 'GET', `/vaults/${s.uid}`), 403);
    expect('an admin cannot read the keys of a member', await status(accounts.admin.token, 'GET', `/vaults/${s.uid}`), 403);
    expect('classmate cannot write the keys of another', await commit(c.token, [put(`vaults/${s.uid}`, box())]), 403);
    expect('keys with another field are refused', await commit(s.token, [put(`vaults/${s.uid}`, box({ plain: 'sk-x' }))]), 403);
    expect('too few rounds are refused', await commit(s.token, [put(`vaults/${s.uid}`, box({ iter: 1000 }))]), 403);
    expect('student deletes its encrypted keys', await commit(s.token, [remove(`vaults/${s.uid}`)]), 200);
  }
  // «Yo quiero»: each person counts once, the counter and the mark change together.
  {
    await call(admin, 'POST', `${firestore}:commit`, { writes: [remove('wants/grupos'), remove(`wanted/grupos__${s.uid}`), remove(`wanted/grupos__${c.uid}`)] });
    const want = (who, n) => commit(who.token, [put('wants/grupos', { count: n }, { stamp: false }), put(`wanted/grupos__${who.uid}`, { idea: 'grupos' }, { stamp: false, create: true })]);
    const unwant = (who, n) => commit(who.token, [put('wants/grupos', { count: n }, { stamp: false }), remove(`wanted/grupos__${who.uid}`)]);
    expect('student wants an idea', await want(s, 1), 200);
    expect('student cannot want it twice', await want(s, 2), 403);
    expect('classmate wants it too', await want(c, 2), 200);
    expect('a count without its mark is refused', await commit(s.token, [put('wants/grupos', { count: 3 }, { stamp: false })]), 403);
    expect('a mark in the name of another account is refused', await commit(s.token, [put('wants/grupos', { count: 3 }, { stamp: false }), put(`wanted/grupos__${accounts.admin.uid}`, { idea: 'grupos' }, { stamp: false, create: true })]), 403);
    expect('an unknown idea is refused', await commit(s.token, [put('wants/spam', { count: 1 }, { stamp: false }), put(`wanted/spam__${s.uid}`, { idea: 'spam' }, { stamp: false, create: true })]), 403);
    expect('student reads the count', await status(s.token, 'GET', '/wants/grupos'), 200);
    expect('student reads its own mark', await status(s.token, 'GET', `/wanted/grupos__${s.uid}`), 200);
    expect('student cannot read the mark of another', await status(s.token, 'GET', `/wanted/grupos__${c.uid}`), 403);
    expect('student takes its «Yo quiero» back', await unwant(s, 1), 200);
    expect('the count cannot drop without a mark', await unwant(s, 0), 403);
    expect('otherDomain cannot want', await want(accounts.otherDomain, 2), 403);
  }
  // Feedback: written by its sender with its day's count, read by the sender and the admins, at most 10 a day.
  {
    const day = Math.floor(Date.now() / 86400000);
    const fb = (extra = {}) => ({ uid: s.uid, kind: 'error', text: 'Algo falló', page: '#/estudia', status: 'nuevo', ...extra });
    const send = (token, id, data, n, opts = {}) => commit(token, [put(`feedback/${id}`, data, { stamp: 'created', create: true }), put(`feedbackDay/${opts.uid ?? s.uid}`, { day, n }, { stamp: false })]);
    await call(admin, 'POST', `${firestore}:commit`, { writes: [remove(`feedbackDay/${s.uid}`)] });
    const f1 = `${tag}-fb1`;
    expect('student sends feedback, counted for the day', await send(s.token, f1, fb(), 1), 200);
    expect('student reads its feedback', await status(s.token, 'GET', `/feedback/${f1}`), 200);
    expect('classmate cannot read the feedback of another account', await status(c.token, 'GET', `/feedback/${f1}`), 403);
    expect('admin reads the feedback', await status(accounts.admin.token, 'GET', `/feedback/${f1}`), 200);
    expect('feedback without its count is refused', await commit(s.token, [put(`feedback/${tag}-fb2`, fb(), { stamp: 'created', create: true })]), 403);
    expect('a count that jumps is refused', await send(s.token, `${tag}-fb3`, fb(), 5), 403);
    expect('feedback in the name of another account is refused', await send(s.token, `${tag}-fb4`, fb({ uid: c.uid }), 2), 403);
    expect('feedback of an unknown kind is refused', await send(s.token, `${tag}-fb5`, fb({ kind: 'spam' }), 2), 403);
    expect('feedback with an answer already is refused', await send(s.token, `${tag}-fb6`, fb({ answer: 'x' }), 2), 403);
    expect('feedback with a picture that is not an image is refused', await send(s.token, `${tag}-fb7`, fb({ shot: 'javascript:alert(1)' }), 2), 403);
    expect('feedback with its log and a picture', await send(s.token, `${tag}-fb8`, fb({ kind: 'ia', log: '[{"model":"x"}]', shot: 'data:image/jpeg;base64,AAAA' }), 2), 200);
    expect('feedback with the largest picture allowed', await send(s.token, `${tag}-fb11`, fb({ shot: `data:image/jpeg;base64,${'A'.repeat(449000)}`, log: 'x'.repeat(149000) }), 3), 200);
    expect('a picture over the limit is refused', await send(s.token, `${tag}-fb12`, fb({ shot: `data:image/jpeg;base64,${'A'.repeat(451000)}` }), 4), 403);
    expect('an answer dated by the browser is refused', await commit(accounts.admin.token, [put(`feedback/${tag}-fb8`, { status: 'visto', answered: new Date(0) }, { stamp: false, mask: ['status', 'answered'] })]), 403);
    expect('the sender cannot answer its own feedback', await commit(s.token, [put(`feedback/${f1}`, { status: 'resuelto' }, { stamp: false, mask: ['status'] })]), 403);
    expect('admin answers the feedback', await commit(accounts.admin.token, [put(`feedback/${f1}`, { status: 'resuelto', answer: 'Gracias, arreglado' }, { stamp: 'answered', mask: ['status', 'answer'] })]), 200);
    expect('admin cannot change what was sent', await commit(accounts.admin.token, [put(`feedback/${f1}`, { text: 'otra cosa' }, { stamp: false, mask: ['text'] })]), 403);
    await call(admin, 'POST', `${firestore}:commit`, { writes: [put(`feedbackDay/${s.uid}`, { day, n: 10 }, { stamp: false })] });
    expect('the eleventh of the day is refused', await send(s.token, `${tag}-fb9`, fb(), 11), 403);
    expect('otherDomain cannot send feedback', await send(accounts.otherDomain.token, `${tag}-fb10`, fb({ uid: accounts.otherDomain.uid }), 1, { uid: accounts.otherDomain.uid }), 403);
    expect('student deletes its feedback', await commit(s.token, [remove(`feedback/${f1}`)]), 200);
  }
  expect('otherDomain cannot save a profile', await commit(accounts.otherDomain.token, [put(`profiles/${accounts.otherDomain.uid}`, profile())]), 403);

  // Thanks: only fixed, positive kinds
  const kudo = (guideId, kinds, extra = {}) => ({ guide: guideId, kinds, ...extra });
  expect('classmate thanks a guide', await commit(c.token, [put(`kudos/${adminGuide}__${c.uid}`, kudo(adminGuide, ['salvo', 'gracias']))]), 200);
  expect('student lists the thanks', await list(s.token, 'kudos'), 200);
  expect('otherDomain cannot list the thanks', await list(accounts.otherDomain.token, 'kudos'), 403);
  expect('thanks in the name of another account are refused', await commit(c.token, [put(`kudos/${adminGuide}__${s.uid}`, kudo(adminGuide, ['salvo']))]), 403);
  expect('a reaction that is not one of the positive kinds is refused', await commit(s.token, [put(`kudos/${adminGuide}__${s.uid}`, kudo(adminGuide, ['malo']))]), 403);
  expect('a repeated reaction is refused', await commit(s.token, [put(`kudos/${adminGuide}__${s.uid}`, kudo(adminGuide, ['salvo', 'salvo']))]), 403);
  expect('thanks with a comment are refused', await commit(s.token, [put(`kudos/${adminGuide}__${s.uid}`, kudo(adminGuide, ['salvo'], { comment: 'texto' }))]), 403);
  const ghost = appId();
  expect('thanks for a guide that does not exist are refused', await commit(s.token, [put(`kudos/${ghost}__${s.uid}`, kudo(ghost, ['salvo']))]), 403);
  expect('student cannot delete the thanks of another account', await commit(s.token, [remove(`kudos/${adminGuide}__${c.uid}`)]), 403);
  expect('classmate takes back its thanks', await commit(c.token, [remove(`kudos/${adminGuide}__${c.uid}`)]), 200);

  // What students know about a professor: fixed constructive tags, no free text
  const prof = `docente-${tag}`;
  const tip = (extra = {}) => ({ prof, professor: 'Docente de Prueba', course: 'Curso de prueba', tags: ['puntos-extra', 'asistencia'], ...extra });
  expect('student shares what it knows of a professor', await commit(s.token, [put(`tips/${prof}__${s.uid}`, tip())]), 200);
  expect('classmate lists the tips', await list(c.token, 'tips'), 200);
  expect('otherDomain cannot list the tips', await list(accounts.otherDomain.token, 'tips'), 403);
  expect('a tag that is not one of the fixed ones is refused', await commit(s.token, [put(`tips/${prof}__${s.uid}`, tip({ tags: ['es pésimo'] }))]), 403);
  expect('a tip with a comment is refused', await commit(s.token, [put(`tips/${prof}__${s.uid}`, tip({ comment: 'texto' }))]), 403);
  expect('a professor name with a link is refused', await commit(s.token, [put(`tips/${prof}__${s.uid}`, tip({ professor: 'https://example.com' }))]), 403);
  expect('a tip in the name of another account is refused', await commit(c.token, [put(`tips/${prof}__${s.uid}`, tip())]), 403);
  expect('classmate cannot delete the tip of another account', await commit(c.token, [remove(`tips/${prof}__${s.uid}`)]), 403);
  expect('otherDomain cannot share a tip', await commit(accounts.otherDomain.token, [put(`tips/${prof}__${accounts.otherDomain.uid}`, tip())]), 403);
  expect('student takes back its tip', await commit(s.token, [remove(`tips/${prof}__${s.uid}`)]), 200);
  expect('student saves its language and avatar color', await commit(s.token, [put(`profiles/${s.uid}`, profile({ lang: 'en', avatar: 'red', name: 'Nombre de Prueba' }))]), 200);
  expect('a profile with an unknown avatar color is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ avatar: 'purple' }))]), 403);
  const home = { deadlines: [{ id: 'd1', text: 'Entrega del proyecto', date: '2026-12-01', course: 'Redes' }], tiles: ['deadlines', 'notes:l', 'goals'],
    notes: 'El aula del examen es la 204.', links: [{ id: 'l1', label: 'Aula virtual', url: 'https://example.org' }], focus: { study: 50, rest: 10 }, bubbles: true };
  expect('student saves its home page (dates, tiles, notes, links, timer)', await commit(s.token, [put(`profiles/${s.uid}`, profile(home))]), 200);
  expect('a notepad over 4000 characters is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ notes: 'x'.repeat(4001) }))]), 403);
  expect('more than 12 quick links are refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ links: Array.from({ length: 13 }, (_, i) => ({ id: `l${i}`, label: 'x', url: 'https://example.org' })) }))]), 403);
  expect('a focus timer outside its range is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ focus: { study: 300, rest: 5 } }))]), 403);
  expect('a focus timer with other fields is refused', await commit(s.token, [put(`profiles/${s.uid}`, profile({ focus: { study: 25, rest: 5, nap: 60 } }))]), 403);
  expect('student deletes its profile', await commit(s.token, [remove(`profiles/${s.uid}`)]), 200);
  // The person's schedule: private, options to compare, nothing shared yet.
  const sched = (extra = {}) => ({ mine: { id: 'mine', name: 'Mi horario', classes: [] }, options: [{ id: 'o1', name: 'Borrador 1', classes: [{ id: 'c1', name: 'Redes', credits: 3, color: 'blue', slots: [{ d: 1, s: 870, e: 950 }] }] }], active: 0, term: '202620', share: [], ...extra });
  expect('student saves its schedule', await commit(s.token, [put(`schedules/${s.uid}`, sched())]), 200);
  expect('student reads its schedule', await status(s.token, 'GET', `/schedules/${s.uid}`), 200);
  expect('classmate cannot read the schedule of another account', await status(c.token, 'GET', `/schedules/${s.uid}`), 403);
  expect('classmate cannot write the schedule of another account', await commit(c.token, [put(`schedules/${s.uid}`, sched())]), 403);
  expect('a schedule shared with someone is refused before friends exist', await commit(s.token, [put(`schedules/${s.uid}`, sched({ share: [c.uid] }))]), 403);
  expect('a schedule with more than six options is refused', await commit(s.token, [put(`schedules/${s.uid}`, sched({ options: Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, name: 'X', classes: [] })) }))]), 403);
  expect('a schedule pointing at an option it does not have is refused', await commit(s.token, [put(`schedules/${s.uid}`, sched({ active: 3 }))]), 403);
  expect('a schedule with other fields is refused', await commit(s.token, [put(`schedules/${s.uid}`, sched({ email: s.email }))]), 403);
  expect('a schedule whose term is not a term code is refused', await commit(s.token, [put(`schedules/${s.uid}`, sched({ term: 'segundo' }))]), 403);
  expect('a schedule whose «mine» carries other fields is refused', await commit(s.token, [put(`schedules/${s.uid}`, sched({ mine: { id: 'mine', name: 'x', classes: [], email: s.email } }))]), 403);
  expect('otherDomain cannot save a schedule', await commit(accounts.otherDomain.token, [put(`schedules/${accounts.otherDomain.uid}`, sched())]), 403);
  expect('student deletes its schedule', await commit(s.token, [remove(`schedules/${s.uid}`)]), 200);

  // The library: course documents as links
  const shared = (extra = {}) => ({ course: 'Curso de prueba', kind: 'syllabus', title: 'Sílabo de prueba', url: 'https://drive.google.com/file/d/abc123/view', professor: 'Docente de Prueba', term: '202610', ...extra });
  const lib = appId();
  expect('student shares a document by its Drive link', await commit(s.token, [
    put(`library/${lib}`, shared(), { create: true }), put(`owners/${lib}`, owner(s.uid), { stamp: false, create: true })]), 200);
  expect('classmate lists the library', await list(c.token, 'library'), 200);
  expect('otherDomain cannot list the library', await list(accounts.otherDomain.token, 'library'), 403);
  for (const [label, url] of [['another site', 'https://example.com/file.pdf'], ['a script', 'javascript:alert(1)'], ['plain http', 'http://drive.google.com/file/d/x']]) {
    const bad = appId();
    expect(`a document linking to ${label} is refused`, await commit(s.token, [
      put(`library/${bad}`, shared({ url }), { create: true }), put(`owners/${bad}`, owner(s.uid), { stamp: false, create: true })]), 403);
  }
  const loose2 = appId();
  expect('a document without an owner is refused', await commit(s.token, [put(`library/${loose2}`, shared(), { create: true })]), 403);
  const kindless = appId();
  expect('a document of an unknown kind is refused', await commit(s.token, [
    put(`library/${kindless}`, shared({ kind: 'book' }), { create: true }), put(`owners/${kindless}`, owner(s.uid), { stamp: false, create: true })]), 403);
  expect('classmate cannot change the document', await commit(c.token, [put(`library/${lib}`, shared({ title: 'otro' }))]), 403);
  expect('classmate cannot delete the document', await commit(c.token, [remove(`library/${lib}`)]), 403);
  expect('student changes its document', await commit(s.token, [put(`library/${lib}`, shared({ title: 'Sílabo corregido' }))]), 200);
  expect('student deletes its document', await commit(s.token, [remove(`library/${lib}`), remove(`owners/${lib}`)]), 200);

  // Admins, the settings, presence and the easter eggs
  // Fresh items for the admin to see and moderate: earlier sections already deleted theirs.
  const g2 = appId(); const pg = appId(); const m2 = appId(); const p2 = appId();
  expect('student publishes a guide for the admin checks', await commit(s.token, [
    put(`guides/${g2}`, guide(), { create: true }), put(`catalog/${g2}`, entry(), { create: true }), put(`owners/${g2}`, owner(s.uid), { stamp: false, create: true })]), 200);
  expect('student publishes a private guide for the admin checks', await commit(s.token, [
    put(`guides/${pg}`, guide(undefined, 'private'), { create: true }), put(`catalog/${pg}`, entry('private'), { create: true }), put(`owners/${pg}`, owner(s.uid), { stamp: false, create: true })]), 200);
  expect('student publishes contributions for the admin checks', await commit(s.token, [
    put(`contributions/${m2}`, contribution(), { create: true }), put(`owners/${m2}`, owner(s.uid), { stamp: false, create: true }),
    put(`contributions/${p2}`, contribution({ visibility: 'private' }), { create: true }), put(`owners/${p2}`, owner(s.uid), { stamp: false, create: true })]), 200);
  const A = accounts.admin;
  const signedSettings = (by, over = {}) => ({ ...settingsDoc(over), by });
  expect('student reads the settings', await status(s.token, 'GET', '/settings/app'), 200);
  expect('otherDomain reads the settings (to learn it is not a member)', await status(accounts.otherDomain.token, 'GET', '/settings/app'), 200);
  expect('no account cannot read the settings', await status(null, 'GET', '/settings/app'), 403);
  expect('student cannot change the settings', await commit(s.token, [put('settings/app', signedSettings(s.email))]), 403);
  expect('admin lists the whole catalog, private entries too', await list(A.token, 'catalog'), 200);
  expect('admin opens a private contribution', await status(A.token, 'GET', `/contributions/${p2}`), 200);
  expect('admin opens a private guide', await status(A.token, 'GET', `/guides/${pg}`), 200);
  expect('admin lists the library', await list(A.token, 'library'), 200);
  expect('admin lists its own owner records (the app loads them)', await list(A.token, 'owners', where('uid', A.uid)), 200);
  expect('admin cannot publish as a student', await commit(A.token, [
    put(`contributions/${tag}x`, contribution(), { create: true })]), 403);
  expect('admin hides a guide, entry and page together', await commit(A.token, [
    put(`catalog/${g2}`, { visibility: 'private' }, { mask: ['visibility'] }), put(`guides/${g2}`, { visibility: 'private' }, { mask: ['visibility'] })]), 200);
  expect('admin cannot hide only half of a guide', await commit(A.token, [put(`catalog/${g2}`, { visibility: 'public' }, { mask: ['visibility'] })]), 403);
  expect('admin cannot change anything else of a guide', await commit(A.token, [
    put(`catalog/${g2}`, { visibility: 'public', title: 'otra' }, { mask: ['visibility', 'title'] }), put(`guides/${g2}`, { visibility: 'public' }, { mask: ['visibility'] })]), 403);
  expect('student cannot hide a classmate\'s contribution', await commit(c.token, [put(`contributions/${m2}`, { visibility: 'private' }, { mask: ['visibility'] })]), 403);
  expect('admin hides a contribution', await commit(A.token, [put(`contributions/${m2}`, { visibility: 'private' }, { mask: ['visibility'] })]), 200);
  expect('admin deletes a student\'s contribution with its owner record', await commit(A.token, [remove(`contributions/${m2}`), remove(`owners/${m2}`)]), 200);
  expect('admin leaves a removal record for a contribution it took down', await commit(A.token, [put(`removed/${m2}`, {}, { stamp: 'at' })]), 200);
  // Packs: compiled by admins, read by every member.
  const build = `t${randomBytes(4).toString('hex')}`;
  expect('admin writes a pack part', await commit(A.token, [put(`packs/${build}-0`, { build, i: 0, of: 1, data: randomBytes(64) }, { stamp: false })]), 200);
  expect('a pack part under the wrong id is refused', await commit(A.token, [put(`packs/${build}-7`, { build, i: 0, of: 1, data: randomBytes(64) }, { stamp: false })]), 403);
  expect('student reads a pack part', await status(s.token, 'GET', `/packs/${build}-0`), 200);
  expect('no account cannot read a pack part', await status(null, 'GET', `/packs/${build}-0`), 403);
  expect('student cannot write a pack part', await commit(s.token, [put(`packs/${build}-1`, { build, i: 1, of: 2, data: randomBytes(64) }, { stamp: false })]), 403);
  expect('student cannot write the pack index', await commit(s.token, [put('packs/index', { build, parts: 1, count: 1, at: new Date(), by: s.email }, { stamp: 'built' })]), 403);
  // The live index is the project's own: it is written only in the emulators.
  if (emulated) {
    expect('admin writes the pack index', await commit(A.token, [put('packs/index', { build, parts: 1, count: 1, at: new Date(), by: A.email }, { stamp: 'built' })]), 200);
    expect('the pack index signed by someone else is refused', await commit(A.token, [put('packs/index', { build, parts: 1, count: 1, at: new Date(), by: 'otra@example.com' }, { stamp: 'built' })]), 403);
  } else touched.delete('packs/index');
  expect('admin deletes a pack part', await commit(A.token, [remove(`packs/${build}-0`)]), 200);
  expect('admin cannot read a student\'s profile', await status(A.token, 'GET', `/profiles/${s.uid}`), 403);
  // The audit log
  expect('admin writes the audit log', await commit(A.token, [put(`audit/${tag}`, { action: 'prueba', detail: 'una prueba', by: A.email }, { stamp: 'at', create: true })]), 200);
  expect('an audit entry signed by another address is refused', await commit(A.token, [put(`audit/${tag}b`, { action: 'prueba', detail: '', by: s.email }, { stamp: 'at', create: true })]), 403);
  expect('admin cannot rewrite the audit log', await commit(A.token, [put(`audit/${tag}`, { action: 'otra', detail: '', by: A.email }, { stamp: 'at' })]), 403);
  expect('student cannot write the audit log', await commit(s.token, [put(`audit/${tag}c`, { action: 'prueba', detail: '', by: s.email }, { stamp: 'at', create: true })]), 403);
  expect('student cannot read the audit log', await status(s.token, 'GET', `/audit/${tag}`), 403);
  expect('admin reads the audit log', await list(A.token, 'audit'), 200);
  // Presence: written by each account for itself, on real events; counted by admins.
  const seen = (since = new Date()) => ({ community: 'usfq', since });
  expect('student records its presence', await commit(s.token, [put(`presence/${s.uid}`, seen(), { stamp: 'at' })]), 200);
  expect('student reads its presence', await status(s.token, 'GET', `/presence/${s.uid}`), 200);
  expect('student cannot record presence for another account', await commit(s.token, [put(`presence/${c.uid}`, seen(), { stamp: 'at' })]), 403);
  expect('a presence with a made-up time is refused', await commit(s.token, [put(`presence/${s.uid}`, { ...seen(), at: new Date(0) }, { stamp: false })]), 403);
  expect('student cannot list presence', await list(s.token, 'presence'), 403);
  expect('admin counts presence', await list(A.token, 'presence'), 200);
  expect('otherDomain cannot record presence', await commit(accounts.otherDomain.token, [put(`presence/${accounts.otherDomain.uid}`, seen(), { stamp: 'at' })]), 403);
  if (emulated) {
    // Only in the emulators: these change the live settings and counters.
    expect('admin changes the settings', await commit(A.token, [put('settings/app', signedSettings(A.email))]), 200);
    expect('settings signed by another address are refused', await commit(A.token, [put('settings/app', signedSettings(s.email))]), 403);
    expect('settings without a community are refused', await commit(A.token, [put('settings/app', signedSettings(A.email, { communities: [] }))]), 403);
    expect('settings with an unknown field are refused', await commit(A.token, [put('settings/app', { ...signedSettings(A.email), secret: 'x' })]), 403);
    expect('admin turns the confirmation on', await commit(A.token, [put('settings/app', signedSettings(A.email, { confirmEmail: true }))]), 200);
    expect('with the confirmation on, unverified cannot list the catalog', await publicList(accounts.unverified.token, 'catalog'), 403);
    expect('with the confirmation on, student still lists the catalog', await publicList(s.token, 'catalog'), 200);
    expect('admin turns a community off', await commit(A.token, [put('settings/app', signedSettings(A.email, { communities: DEFAULT_SETTINGS.communities.map((x) => ({ ...x, active: false })) }))]), 200);
    expect('with its community off, student cannot list the catalog', await publicList(s.token, 'catalog'), 403);
    expect('with every community off, the admin still reads', await list(A.token, 'catalog'), 200);
    expect('admin restores the settings', await commit(A.token, [put('settings/app', signedSettings(A.email))]), 200);
    // The counter starts from nothing, whatever the emulators held before.
    await call(admin, 'POST', `${firestore}:commit`, { writes: [remove('eggs/radio')] });
    expect('a member counts a found easter egg', await commit(s.token, [put('eggs/radio', { count: 1 }, { stamp: false, create: true })]), 200);
    expect('the count goes up by one', await commit(c.token, [put('eggs/radio', { count: 2 }, { stamp: false })]), 200);
    expect('the count cannot jump', await commit(c.token, [put('eggs/radio', { count: 9 }, { stamp: false })]), 403);
    expect('an unknown egg is refused', await commit(s.token, [put(`eggs/${tag}`, { count: 1 }, { stamp: false, create: true })]), 403);
    expect('otherDomain cannot count an egg', await commit(accounts.otherDomain.token, [put('eggs/portal', { count: 1 }, { stamp: false, create: true })]), 403);
    expect('student cannot read the counts', await status(s.token, 'GET', '/eggs/radio'), 403);
    expect('admin reads the counts', await list(A.token, 'eggs'), 200);
    // The radio's stations: admins set them, members read them; an audio file goes in pieces of under 1 MB.
    const st = { name: 'Prueba', freq10: 990, opens: 'radio', kind: 'audio', on: true, showCaption: false, audio: { pieces: 1, type: 'audio/mpeg', size: 4, name: 'a.mp3' } };
    expect('admin sets a station', await commit(A.token, [put(`stations/t-${tag}`.toLowerCase(), st)]), 200);
    expect('admin uploads a piece of its audio', await commit(A.token, [put(`stations/t-${tag}/audio/0`.toLowerCase(), { b: Buffer.from('abcd'), i: 0 }, { stamp: false })]), 200);
    expect('a member reads the station', await status(s.token, 'GET', `/stations/t-${tag}`.toLowerCase()), 200);
    expect('a member reads its audio', await status(s.token, 'GET', `/stations/t-${tag}/audio/0`.toLowerCase()), 200);
    expect('a member cannot set a station', await commit(s.token, [put(`stations/m-${tag}`.toLowerCase(), st)]), 403);
    expect('a member cannot upload audio', await commit(s.token, [put(`stations/t-${tag}/audio/1`.toLowerCase(), { b: Buffer.from('x'), i: 1 }, { stamp: false })]), 403);
    expect('a station off the dial is refused', await commit(A.token, [put(`stations/t-${tag}`.toLowerCase(), { ...st, freq10: 1200 })]), 403);
    expect('a station with an unknown field is refused', await commit(A.token, [put(`stations/t-${tag}`.toLowerCase(), { ...st, secret: 'x' })]), 403);
    expect('a piece over 1 MB is refused', await commit(A.token, [put(`stations/t-${tag}/audio/2`.toLowerCase(), { b: Buffer.alloc(1000001), i: 2 }, { stamp: false })]), 403);
    expect('otherDomain cannot read the stations', await status(accounts.otherDomain.token, 'GET', `/stations/t-${tag}`.toLowerCase()), 403);
    // A secret's sound: admins upload it, members read it.
    const snd = { name: 'grito.mp3', type: 'audio/mpeg', size: 4, pieces: 1 };
    expect('admin sets the shout of the medic', await commit(A.token, [put('sounds/medic', snd)]), 200);
    expect('admin uploads its audio', await commit(A.token, [put('sounds/medic/audio/0', { b: Buffer.from('abcd'), i: 0 }, { stamp: false })]), 200);
    expect('a member reads it', await status(s.token, 'GET', '/sounds/medic/audio/0'), 200);
    expect('a member cannot change it', await commit(s.token, [put('sounds/medic', snd)]), 403);
    expect('an unknown sound is refused', await commit(A.token, [put(`sounds/${tag}`, snd)]), 403);
  }

  // «Trabajos»: an assignment, its group (joined with the invitation's code), its parts, milestones, progress and AI log.
  {
    const tid = appId();
    const code = randomBytes(24).toString('base64url');
    const stamped = (path, data, stamps, create = false) => {
      touched.add(path);
      return { update: { name: `${base}/${path}`, fields: fields(data) }, updateTransforms: stamps.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })), ...(create ? { currentDocument: { exists: false } } : {}) };
    };
    const trabajoDoc = (over = {}) => ({ title: 'Trabajo de prueba', course: 'Curso de prueba', group: 'Grupo 4', deadline: '2026-12-05T23:59', prefs: { tone: 'didactic', cards: true, note: 'Todo en inglés' }, parts: 3, owner: s.uid, code, statement: gz('enunciado'), encoding: 'gzip', ...over });
    const at = (path) => `/trabajos/${tid}${path}`;
    expect('a trabajo without its creator as member is refused', await commit(s.token, [stamped(`trabajos/${tid}`, trabajoDoc(), ['created', 'updated'], true)]), 403);
    expect('student creates a trabajo, joining it in the same write', await commit(s.token, [
      stamped(`trabajos/${tid}`, trabajoDoc(), ['created', 'updated'], true), stamped(`trabajos/${tid}/miembros/${s.uid}`, { name: 'Ana', code }, ['joined'], true)]), 200);
    const forged = appId();
    expect('a trabajo in someone else\'s name is refused', await commit(s.token, [
      stamped(`trabajos/${forged}`, trabajoDoc({ owner: c.uid }), ['created', 'updated'], true), stamped(`trabajos/${forged}/miembros/${s.uid}`, { name: 'Ana', code }, ['joined'], true)]), 403);
    expect('classmate cannot read a trabajo before joining', await status(c.token, 'GET', at('')), 403);
    expect('classmate cannot join with a wrong code', await commit(c.token, [stamped(`trabajos/${tid}/miembros/${c.uid}`, { name: 'Bea', code: 'x'.repeat(32) }, ['joined'], true)]), 403);
    expect('classmate cannot join someone else', await commit(c.token, [stamped(`trabajos/${tid}/miembros/${tag}`, { name: 'Otro', code }, ['joined'], true)]), 403);
    expect('otherDomain cannot join even with the code', await commit(accounts.otherDomain.token, [stamped(`trabajos/${tid}/miembros/${accounts.otherDomain.uid}`, { name: 'X', code }, ['joined'], true)]), 403);
    expect('classmate joins with the code', await commit(c.token, [stamped(`trabajos/${tid}/miembros/${c.uid}`, { name: 'Bea', code }, ['joined'], true)]), 200);
    expect('classmate reads the trabajo', await status(c.token, 'GET', at('')), 200);
    expect('classmate lists the members', await status(c.token, 'GET', at('/miembros')), 200);
    expect('classmate cannot change the trabajo', await commit(c.token, [put(`trabajos/${tid}`, { title: 'Otro título' }, { mask: ['title'] })]), 403);
    expect('owner changes the trabajo', await commit(s.token, [put(`trabajos/${tid}`, { repo: { owner: 'alguien', name: 'repo' } }, { mask: ['repo'] })]), 200);
    expect('otherDomain cannot read the trabajo', await status(accounts.otherDomain.token, 'GET', at('')), 403);
    expect('classmate takes part B', await commit(c.token, [stamped(`trabajos/${tid}/partes/B`, { uid: c.uid }, ['at'], true)]), 200);
    expect('student cannot take part B too', await commit(s.token, [stamped(`trabajos/${tid}/partes/B`, { uid: s.uid }, ['at'])]), 403);
    expect('part D does not exist in a trabajo of 3 parts', await commit(s.token, [stamped(`trabajos/${tid}/partes/D`, { uid: s.uid }, ['at'], true)]), 403);
    expect('a part taken in someone else\'s name is refused', await commit(s.token, [stamped(`trabajos/${tid}/partes/A`, { uid: c.uid }, ['at'], true)]), 403);
    expect('classmate writes a milestone of the guide', await commit(c.token, [put(`trabajos/${tid}/hitos/H1`, { data: gz('{}'), encoding: 'gzip', by: c.uid })]), 200);
    expect('a milestone signed by someone else is refused', await commit(c.token, [put(`trabajos/${tid}/hitos/H2`, { data: gz('{}'), encoding: 'gzip', by: s.uid })]), 403);
    expect('classmate writes their own progress', await commit(c.token, [put(`trabajos/${tid}/avance/${c.uid}`, { steps: { 'H1.1': { d: true, u: true } } })]), 200);
    expect('classmate cannot write the progress of someone else', await commit(c.token, [put(`trabajos/${tid}/avance/${s.uid}`, { steps: {} })]), 403);
    expect('student reads the progress of the group', await status(s.token, 'GET', at(`/avance/${c.uid}`)), 200);
    expect('classmate keeps their own log of AI use', await commit(c.token, [put(`trabajos/${tid}/ia/${c.uid}`, { log: [{ step: 'H1', prompt: 'x' }] })]), 200);
    expect('classmate marks when they can meet', await commit(c.token, [put(`trabajos/${tid}/disponible/${c.uid}`, { weeks: { '2026-11-23': [1, 2, 3] } })]), 200);
    expect('nobody marks the availability of someone else', await commit(c.token, [put(`trabajos/${tid}/disponible/${s.uid}`, { weeks: {} })]), 403);
    const pid = appId();
    const meet = { week: '2026-11-23', slot: 40, len: 2 };
    expect('a proposal with someone else’s yes is refused', await commit(c.token, [stamped(`trabajos/${tid}/reunion/${pid}`, { ...meet, by: c.uid, si: [s.uid], no: [] }, ['updated'], true)]), 403);
    expect('classmate proposes an hour', await commit(c.token, [stamped(`trabajos/${tid}/reunion/${pid}`, { ...meet, by: c.uid, si: [c.uid], no: [] }, ['updated'], true)]), 200);
    expect('student says yes for themself', await commit(s.token, [stamped(`trabajos/${tid}/reunion/${pid}`, { ...meet, by: c.uid, si: [c.uid, s.uid], no: [] }, ['updated'])]), 200);
    expect('student cannot remove the classmate’s yes', await commit(s.token, [stamped(`trabajos/${tid}/reunion/${pid}`, { ...meet, by: c.uid, si: [s.uid], no: [] }, ['updated'])]), 403);
    expect('student cannot move the hour', await commit(s.token, [stamped(`trabajos/${tid}/reunion/${pid}`, { ...meet, slot: 41, by: c.uid, si: [c.uid, s.uid], no: [] }, ['updated'])]), 403);
    expect('otherDomain cannot read the proposals', await status(accounts.otherDomain.token, 'GET', at('/reunion')), 403);
    expect('classmate keeps their list of trabajos', await commit(c.token, [put(`misTrabajos/${c.uid}`, { ids: [tid] })]), 200);
    expect('student cannot read the list of someone else', await status(s.token, 'GET', `/misTrabajos/${c.uid}`), 403);
    expect('classmate cannot delete the progress of someone else', await commit(c.token, [remove(`trabajos/${tid}/avance/${s.uid}`)]), 403);
    expect('the owner deletes a member\'s progress (deleting the trabajo)', await commit(s.token, [remove(`trabajos/${tid}/avance/${c.uid}`)]), 200);
    expect('the owner deletes a member\'s AI log (deleting the trabajo)', await commit(s.token, [remove(`trabajos/${tid}/ia/${c.uid}`)]), 200);
    expect('the owner removes a member', await commit(s.token, [remove(`trabajos/${tid}/miembros/${c.uid}`)]), 200);
    expect('a removed member cannot read the trabajo', await status(c.token, 'GET', at('')), 403);
    expect('a removed member cannot write progress', await commit(c.token, [put(`trabajos/${tid}/avance/${c.uid}`, { steps: {} })]), 403);
    expect('the owner deletes the trabajo', await commit(s.token, [remove(`trabajos/${tid}`)]), 200);
  }

  // «Amigos»: a code, a friendship written on both sides by whoever accepts the other's link, ended by either side,
  // and an invitation to a trabajo between friends.
  {
    const stamped = (path, data, stamps, create = false) => {
      touched.add(path);
      return { update: { name: `${base}/${path}`, fields: fields(data) }, updateTransforms: stamps.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })), ...(create ? { currentDocument: { exists: false } } : {}) };
    };
    const sCode = randomBytes(24).toString('base64url');
    const cCode = randomBytes(24).toString('base64url');
    const myCode = (who, code) => [stamped(`amigos/${who.uid}`, { code }, ['updated']), stamped(`amigoCodes/${code}`, { uid: who.uid, name: 'Nombre' }, ['updated'], true)];
    expect('a code that is not the person\'s current one is refused', await commit(s.token, [stamped(`amigoCodes/${sCode}`, { uid: s.uid, name: 'Ana' }, ['updated'], true)]), 403);
    expect('student makes a friend code', await commit(s.token, myCode(s, sCode)), 200);
    expect('a code in someone else\'s name is refused', await commit(c.token, [stamped(`amigos/${c.uid}`, { code: cCode }, ['updated']), stamped(`amigoCodes/${cCode}`, { uid: s.uid, name: 'Ana' }, ['updated'], true)]), 403);
    expect('classmate makes a friend code', await commit(c.token, myCode(c, cCode)), 200);
    expect('a member reads whose a code is', await status(c.token, 'GET', `/amigoCodes/${sCode}`), 200);
    expect('otherDomain cannot read a code', await status(accounts.otherDomain.token, 'GET', `/amigoCodes/${sCode}`), 403);
    expect('nobody reads someone else\'s current code', await status(c.token, 'GET', `/amigos/${s.uid}`), 403);
    const pair = (who, other, code) => [stamped(`amigos/${who.uid}/lista/${other.uid}`, { name: 'Ana', code }, ['since'], true), stamped(`amigos/${other.uid}/lista/${who.uid}`, { name: 'Bea', code }, ['since'], true)];
    expect('a friendship without the other\'s code is refused', await commit(c.token, pair(c, s, cCode)), 403);
    expect('a friendship with a made-up code is refused', await commit(c.token, pair(c, s, 'z'.repeat(32))), 403);
    expect('otherDomain cannot befriend with the code', await commit(accounts.otherDomain.token, [stamped(`amigos/${accounts.otherDomain.uid}/lista/${s.uid}`, { name: 'X', code: sCode }, ['since'], true)]), 403);
    expect('classmate accepts the student\'s link: friends on both sides', await commit(c.token, pair(c, s, sCode)), 200);
    expect('student lists their friends', await status(s.token, 'GET', `/amigos/${s.uid}/lista`), 200);
    expect('classmate cannot list the student\'s friends', await status(c.token, 'GET', `/amigos/${s.uid}/lista`), 403);
    // An invitation to a trabajo, between friends.
    const tid = appId();
    const tcode = randomBytes(24).toString('base64url');
    expect('student creates a trabajo to invite to', await commit(s.token, [
      stamped(`trabajos/${tid}`, { title: 'T', parts: 2, owner: s.uid, code: tcode, statement: gz('e'), encoding: 'gzip' }, ['created', 'updated'], true), stamped(`trabajos/${tid}/miembros/${s.uid}`, { name: 'Ana', code: tcode }, ['joined'], true)]), 200);
    const invite = (code = tcode, from = s.uid) => [stamped(`amigos/${c.uid}/invitaciones/${tid}`, { title: 'T', from, name: 'Ana', code }, ['at'], true)];
    expect('an invitation with a wrong code is refused', await commit(s.token, invite('y'.repeat(32))), 403);
    expect('an invitation in someone else\'s name is refused', await commit(s.token, invite(tcode, c.uid)), 403);
    expect('a friend invites to a trabajo', await commit(s.token, invite()), 200);
    expect('the invited reads their invitations', await status(c.token, 'GET', `/amigos/${c.uid}/invitaciones`), 200);
    expect('the invited joins with the invitation\'s code', await commit(c.token, [stamped(`trabajos/${tid}/miembros/${c.uid}`, { name: 'Bea', code: tcode }, ['joined'], true), remove(`amigos/${c.uid}/invitaciones/${tid}`)]), 200);
    expect('classmate ends the friendship, on both sides', await commit(c.token, [remove(`amigos/${c.uid}/lista/${s.uid}`), remove(`amigos/${s.uid}/lista/${c.uid}`)]), 200);
    expect('no invitation once they are not friends', await commit(s.token, invite()), 403);
    expect('a renewed code voids the old one', await commit(s.token, [stamped(`amigos/${s.uid}`, { code: `${sCode}x` }, ['updated']), remove(`amigoCodes/${sCode}`), stamped(`amigoCodes/${sCode}x`, { uid: s.uid, name: 'Ana' }, ['updated'], true)]), 200);
    expect('the old link no longer makes friends', await commit(c.token, pair(c, s, sCode)), 403);
  }

  expect('nobody writes elsewhere', await status(s.token, 'PATCH', `/other/${tag}`, write), 403);
} finally {
  // The settings stay: the emulators keep the defaults the tests wrote, and live they were never touched.
  touched.delete('settings/app');
  for (const localId of created) await call(admin, 'POST', `${identity}/projects/${id}/accounts:delete`, { localId }).catch(() => { failures += 1; console.log('FAIL could not delete a test account'); });
  await call(admin, 'POST', `${firestore}:commit`, { writes: [...touched].map(remove) }).catch(() => { failures += 1; console.log('FAIL could not delete the test documents'); });
  console.log(`Cleaned up ${created.length} test accounts and ${touched.size} test documents`);
}
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log(`All ${checks} rule checks passed`);
