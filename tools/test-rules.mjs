// Tests the Firestore rules as real accounts meet them: creates temporary accounts, guides and contributions, signs in
// like the browser does, reads and writes through the public REST API, then deletes everything it created.
// Usage: node tools/test-rules.mjs               the live rules of the project in .firebaserc
//        node tools/test-rules.mjs --emulators   the local emulators of firebase.json (firebase emulators:start)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { accessToken, call, project } from './google.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const config = read('public/assets/config.js');
const domain = config.match(/allowedDomain\s*=\s*'([a-z0-9.-]+)'/)[1];
// What an unconfirmed account of the domain may do follows the confirmEmail setting.
const confirmEmail = config.match(/confirmEmail\s*=\s*(true|false)/)[1] === 'true';

const emulated = process.argv.includes('--emulators');
const ports = JSON.parse(read('firebase.json')).emulators;
const id = project();
const base = `projects/${id}/databases/(default)/documents`;
const firestore = emulated ? `http://127.0.0.1:${ports.firestore.port}/v1/${base}` : `https://firestore.googleapis.com/v1/${base}`;
const identity = emulated ? `http://127.0.0.1:${ports.auth.port}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1';
const webKey = emulated ? 'emulator' : config.match(/apiKey:\s*'(AIza[0-9A-Za-z_-]{30,})'/)[1];
// The emulators accept "owner" as the administrator's token.
const admin = emulated ? 'owner' : await accessToken();

const tag = `rules-test-${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('base64url');
const appId = () => [...randomBytes(20)].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');

const accounts = {
  student: { email: `${tag}@${domain}`, emailVerified: true },
  classmate: { email: `${tag}-c@${domain}`, emailVerified: true },
  unverified: { email: `${tag}-u@${domain}`, emailVerified: false },
  otherDomain: { email: `${tag}@example.com`, emailVerified: true },
  lookalike: { email: `${tag}@${domain}.example.com`, emailVerified: true },
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
async function status(token, method, path, body) {
  const response = await fetch(`${firestore}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  await response.arrayBuffer();
  return response.status;
}

// Firestore REST values and writes.
const value = (v) => {
  if (Buffer.isBuffer(v)) return { bytesValue: v.toString('base64') };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  return { stringValue: String(v) };
};
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
function put(path, data, { stamp = true, create = false } = {}) {
  touched.add(path);
  return {
    update: { name: `${base}/${path}`, fields: fields(data) },
    ...(stamp ? { updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }] } : {}),
    ...(create ? { currentDocument: { exists: false } } : {}),
  };
}
const remove = (path) => ({ delete: `${base}/${path}` });
const commit = (token, writes) => status(token, 'POST', ':commit', { writes });
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
const entry = (visibility = 'public') => ({ course: 'Curso de prueba', title: 'Guía de prueba', date: '2026-01-01', topics: [], concepts: ['Concepto A'], anchors: [''], theme: 'vectores', visibility });
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
  for (const [name, account] of Object.entries(accounts).filter(([name]) => !['student', 'classmate'].includes(name))) {
    const allowedToo = name === 'unverified' && !confirmEmail;
    const verb = allowedToo ? 'can' : 'cannot';
    expect(`${name} ${verb} list the catalog`, await publicList(account.token, 'catalog'), allowedToo ? 200 : 403);
    expect(`${name} ${verb} open a guide`, await status(account.token, 'GET', `/guides/${tag}`), allowedToo ? 200 : 403);
    expect(`${name} ${verb} list the contributions`, await publicList(account.token, 'contributions'), allowedToo ? 200 : 403);
  }
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
  expect('student changes its contribution', await commit(s.token, [put(`contributions/${mine}`, contribution({ title: 'cambiada' }))]), 200);
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
  expect('student replaces its guide', await commit(s.token, [put(`guides/${g}`, guide('<!doctype html><title>nueva</title>')), put(`catalog/${g}`, entry())]), 200);
  expect('student cannot keep the entry while deleting the guide', await commit(s.token, [remove(`guides/${g}`)]), 403);
  expect('student deletes its guide', await commit(s.token, [remove(`guides/${g}`), remove(`catalog/${g}`), remove(`owners/${g}`)]), 200);
  expect('student deletes its contribution', await commit(s.token, [remove(`contributions/${mine}`), remove(`owners/${mine}`)]), 200);
  expect('nobody writes elsewhere', await status(s.token, 'PATCH', `/other/${tag}`, write), 403);
} finally {
  for (const localId of created) await call(admin, 'POST', `${identity}/projects/${id}/accounts:delete`, { localId }).catch(() => { failures += 1; console.log('FAIL could not delete a test account'); });
  await call(admin, 'POST', `${firestore}:commit`, { writes: [...touched].map(remove) }).catch(() => { failures += 1; console.log('FAIL could not delete the test documents'); });
  console.log(`Cleaned up ${created.length} test accounts and ${touched.size} test documents`);
}
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log(`All ${checks} rule checks passed`);
