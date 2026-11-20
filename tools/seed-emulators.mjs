// Prepares the local emulators for trying the page by hand (node tools/dev.mjs --emulators): the settings the rules
// read (the default communities) and one test member, which exist only in the emulators. Its password is new on every
// run and is written to the file given (default: private/emulator-account.json, never committed), not printed.
// Usage: node tools/seed-emulators.mjs [file]   (with `firebase emulators:start --only firestore,auth` running)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_SETTINGS, domainsOf, toFields } from './settings.mjs';

const { emulators } = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
const project = 'studium101';
const fs = `http://127.0.0.1:${emulators.firestore.port}/v1/projects/${project}/databases/(default)/documents`;
const idt = `http://127.0.0.1:${emulators.auth.port}/identitytoolkit.googleapis.com/v1`;
const out = path.resolve(process.argv[2] ?? 'private/emulator-account.json');
const call = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};

await call('PATCH', `${fs}/settings/app`, { fields: toFields({ ...DEFAULT_SETTINGS, domains: domainsOf(DEFAULT_SETTINGS), by: 'emulator seed', updated: new Date() }) });
const email = `prueba-${randomBytes(3).toString('hex')}@${domainsOf(DEFAULT_SETTINGS)[0]}`;
const password = randomBytes(12).toString('base64url');
const user = await call('POST', `${idt}/projects/${project}/accounts`, { email, password, emailVerified: true });
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ email, password, uid: user.localId, note: 'Exists only in the local emulators.' }, null, 2));
console.log(`Settings written; a test member created in the emulators (${email}); its password is in ${out}`);
