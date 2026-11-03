// Tests the live Firestore rules of the project in .firebaserc as real accounts would meet them.
// Creates temporary accounts and one temporary guide, signs in like the browser does, reads and writes through the
// public REST API, then deletes everything it created. Usage: node tools/test-rules.mjs
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accessToken, call, project } from './google.mjs';

const id = project();
const config = readFileSync(new URL('../public/assets/config.js', import.meta.url), 'utf8');
const webKey = config.match(/apiKey:\s*'(AIza[0-9A-Za-z_-]{30,})'/)[1];
const domain = config.match(/allowedDomain\s*=\s*'([a-z0-9.-]+)'/)[1];
const base = `projects/${id}/databases/(default)/documents`;
const firestore = `https://firestore.googleapis.com/v1/${base}`;
const admin = await accessToken();
const tag = `rules-test-${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('base64url');

const accounts = {
  student: { email: `${tag}@${domain}`, emailVerified: true },
  unverified: { email: `${tag}-u@${domain}`, emailVerified: false },
  otherDomain: { email: `${tag}@example.com`, emailVerified: true },
  lookalike: { email: `${tag}@${domain}.example.com`, emailVerified: true },
};
const created = [];
let failures = 0;

async function signIn(email) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`sign-in failed for a test account: ${body.error?.message ?? response.status}`);
  return body.idToken;
}
async function status(token, method, path, body) {
  const response = await fetch(`${firestore}/${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  await response.arrayBuffer();
  return response.status;
}
function expect(label, actual, wanted) {
  const ok = actual === wanted;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: HTTP ${actual}${ok ? '' : ` (expected ${wanted})`}`);
}

try {
  await call(admin, 'PATCH', `${firestore}/guides/${tag}`, { fields: { title: { stringValue: 'rules test' } } });
  for (const account of Object.values(accounts)) {
    const user = await call(admin, 'POST', `https://identitytoolkit.googleapis.com/v1/projects/${id}/accounts`, { ...account, password });
    created.push(user.localId);
    account.token = await signIn(account.email);
  }
  const write = { fields: { title: { stringValue: 'x' } } };
  const s = accounts.student.token;
  expect('verified student lists the catalog', await status(s, 'GET', 'catalog'), 200);
  expect('verified student opens one guide', await status(s, 'GET', `guides/${tag}`), 200);
  expect('verified student cannot list every guide', await status(s, 'GET', 'guides'), 403);
  expect('verified student cannot write the catalog', await status(s, 'PATCH', `catalog/${tag}`, write), 403);
  expect('verified student cannot write a guide', await status(s, 'PATCH', `guides/${tag}`, write), 403);
  expect('verified student cannot read other collections', await status(s, 'GET', `other/${tag}`), 403);
  for (const [name, account] of Object.entries(accounts).filter(([name]) => name !== 'student')) {
    expect(`${name} cannot list the catalog`, await status(account.token, 'GET', 'catalog'), 403);
    expect(`${name} cannot open a guide`, await status(account.token, 'GET', `guides/${tag}`), 403);
  }
  expect('no account cannot list the catalog', await status(null, 'GET', 'catalog'), 403);
  expect('no account cannot open a guide', await status(null, 'GET', `guides/${tag}`), 403);
} finally {
  for (const localId of created) await call(admin, 'POST', `https://identitytoolkit.googleapis.com/v1/projects/${id}/accounts:delete`, { localId }).catch(() => { failures += 1; console.log('FAIL could not delete a test account'); });
  await call(admin, 'DELETE', `${firestore}/guides/${tag}`).catch(() => { failures += 1; console.log('FAIL could not delete the test guide'); });
  console.log(`Cleaned up ${created.length} test accounts and the test guide`);
}
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('All rule checks passed');
