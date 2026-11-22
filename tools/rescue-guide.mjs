// A guide your AI finished on your computer that never reached Studium (the page gave up, the tab closed…): its files
// in <folder>/.studium/run-<id>/salida (esquema.json, H0.json…) become the guide of a trabajo of an account, on the live
// project. The trabajo's data (title, statement, preferences) is copied from a trabajo in the local emulators, where it
// was created; the account named receives it as owner and member, with a new invitation code.
// Usage: node tools/rescue-guide.mjs --salida <dir> --from <emulator trabajo id> --to <e-mail> [--dry]
// Needs GOOGLE_APPLICATION_CREDENTIALS (the service account) and, for --from, the emulators running.
// The guide goes through the same checks as one written in the page (cleanOutline, cleanMilestone).
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const dry = process.argv.includes('--dry');
const salida = arg('--salida'); const from = arg('--from'); const to = arg('--to').toLowerCase();
if (!salida || !from || !to) { console.error('Usage: node tools/rescue-guide.mjs --salida <dir> --from <emulator trabajo id> --to <e-mail> [--dry]'); process.exit(1); }

// The app's own cleaners, loaded as a module.
const P = await import(new URL('../public/assets/trabajo-prompts.js', import.meta.url));
const { accessToken, call, project } = await import(new URL('./google.mjs', import.meta.url));
const id = project();
const ports = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).emulators;

// The trabajo as created in the emulators.
const emu = await fetch(`http://127.0.0.1:${ports.firestore.port}/v1/projects/${id}/databases/(default)/documents/trabajos/${from}`, { headers: { authorization: 'Bearer owner' } }).then((r) => r.json());
if (!emu.fields) { console.error(`No trabajo ${from} in the emulators.`); process.exit(1); }
const F = emu.fields;
const parts = Number(F.parts.integerValue);
const read = (f) => P.parseJSON(readFileSync(path.join(salida, f), 'utf8'));
const outline = P.cleanOutline(read('esquema.json'), parts);
const hitos = outline.hitos.filter((h) => existsSync(path.join(salida, `${h.id}.json`))).map((h) => ({ id: h.id, data: P.cleanMilestone(read(`${h.id}.json`), h) }));
const instructions = existsSync(path.join(salida, '..', 'INSTRUCCIONES.md')) ? readFileSync(path.join(salida, '..', 'INSTRUCCIONES.md'), 'utf8') : '';
console.log(`«${F.title.stringValue}»: ${outline.hitos.length} chapters (${hitos.length} written), ${outline.hitos.reduce((n, h) => n + h.pasos.length, 0)} steps, for ${parts} people`);

const token = await accessToken();
const look = await call(token, 'POST', `https://identitytoolkit.googleapis.com/v1/projects/${id}/accounts:lookup`, { email: [to] });
const user = look.users?.[0];
if (!user) { console.error(`No account ${to} in ${id}.`); process.exit(1); }
const uid = user.localId;
const docs = `projects/${id}/databases/(default)/documents`;
const base = `https://firestore.googleapis.com/v1/${docs}`;
const profile = await call(token, 'GET', `${base}/profiles/${uid}`).catch(() => null);
const name = String(profile?.fields?.nickname?.stringValue || to.split('@')[0]).slice(0, 40);
const tid = [...randomBytes(20)].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
const code = randomBytes(24).toString('base64url');
const now = new Date().toISOString();
const bytes = (v) => ({ bytesValue: gzipSync(Buffer.from(typeof v === 'string' ? v : JSON.stringify(v))).toString('base64') });
const ai = { mapValue: { fields: { provider: { stringValue: 'anthropic' }, model: { stringValue: 'claude-opus-5-5' }, effort: { stringValue: '' } } } };
const keep = ['title', 'course', 'group', 'deadline', 'prefs', 'statement', 'encoding'];
const writes = [
  { update: { name: `${docs}/trabajos/${tid}`, fields: { ...Object.fromEntries(keep.filter((k) => F[k]).map((k) => [k, F[k]])), parts: { integerValue: String(parts) }, owner: { stringValue: uid }, code: { stringValue: code }, outline: bytes(outline), ai, created: { timestampValue: now }, updated: { timestampValue: now } } } },
  { update: { name: `${docs}/trabajos/${tid}/miembros/${uid}`, fields: { name: { stringValue: name }, code: { stringValue: code }, joined: { timestampValue: now } } } },
  ...hitos.map((h) => ({ update: { name: `${docs}/trabajos/${tid}/hitos/${h.id}`, fields: { data: bytes(h.data), encoding: { stringValue: 'gzip' }, by: { stringValue: uid }, ai, updated: { timestampValue: now } } } })),
  ...(instructions ? [{ update: { name: `${docs}/trabajos/${tid}/ia/${uid}`, fields: { log: { arrayValue: { values: [{ mapValue: { fields: { at: { stringValue: now }, task: { stringValue: 'solution' }, step: { stringValue: 'guía completa' }, model: { stringValue: 'claude-opus-5-5' }, provider: { stringValue: 'bridge:claude' }, prompt: { stringValue: instructions.slice(0, 3000) } } } }] } }, updated: { timestampValue: now } } } }] : []),
];
const mine = await call(token, 'GET', `${base}/misTrabajos/${uid}`).catch(() => null);
const ids = [...(mine?.fields?.ids?.arrayValue?.values ?? []).map((v) => v.stringValue), tid].slice(-60);
writes.push({ update: { name: `${docs}/misTrabajos/${uid}`, fields: { ids: { arrayValue: { values: ids.map((x) => ({ stringValue: x })) } }, updated: { timestampValue: now } } } });
console.log(`To ${to} (${name}): trabajo ${tid}, ${writes.length} documents`);
if (dry) { console.log('--dry: nothing written'); process.exit(0); }
await call(token, 'POST', `${base}:commit`, { writes });
console.log(`Written. It opens at #/trabajos/${tid}`);
