// Publishes a contribution as an administrator: the JSON an AI returned with Studium's instructions, read and checked
// with the same code the app uses. It is public. Without --owner it has no owner (no account can change it from the
// site); with --owner it belongs to that account, as if published from the site.
// --original <file> (repeat it for the photos of one exam): the original file, read only to compute its fingerprint
// exactly as the app does (tools/fingerprint.mjs); --part <i> --of <n> for part i (from 0) of a file split in n parts;
// or --print <hex> directly. A fingerprint already in the database stops the upload, also in a dry run (which then
// needs the key), so the same file is never added twice.
// Usage: node tools/upload-contribution.mjs <aporte.json> [--source <source id>] [--id <document id>]
//          [--original <file>]... [--part <i> --of <n>] [--print <hex>] [--owner <e-mail>] [--dry-run]
//        node tools/upload-contribution.mjs --remove <document id>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { accessToken, call, project } from './google.mjs';
import { printOf } from './fingerprint.mjs';
import { parseContribution, findPersonal } from '../public/assets/prompts.js';
import { keyOf, validTheme, guessTheme } from '../public/assets/themes.js';
import { looseKey } from '../public/assets/standard.js';

const LIMIT = 900_000;
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flags = (name) => args.flatMap((a, i) => (a === name && args[i + 1] !== undefined ? [args[i + 1]] : []));
const VALUED = ['--source', '--id', '--original', '--part', '--of', '--print', '--owner'];
const valueAt = new Set(args.flatMap((a, i) => (VALUED.includes(a) ? [i + 1] : [])));

const id = project();
const base = `projects/${id}/databases/(default)/documents`;
const api = `https://firestore.googleapis.com/v1/${base}`;

const value = (v) => {
  if (Buffer.isBuffer(v)) return { bytesValue: v.toString('base64') };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  return { stringValue: String(v) };
};
const fields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, value(v)]));

if (args[0] === '--remove') {
  if (!args[1]) throw new Error('Usage: node tools/upload-contribution.mjs --remove <document id>');
  await call(await accessToken(), 'POST', `${api}:commit`, { writes: [{ delete: `${base}/contributions/${args[1]}` }] });
  console.log(`Removed contribution ${args[1]} from ${id}`);
  process.exit(0);
}

const file = args.find((a, i) => !a.startsWith('--') && !valueAt.has(i));
if (!file) throw new Error('Usage: node tools/upload-contribution.mjs <aporte.json> [--source <id>] [--id <id>] [--original <file>]... [--part <i> --of <n>] [--print <hex>] [--owner <e-mail>] [--dry-run]');
const print = flag('--print') ?? printOf(flags('--original'), Number(flag('--part') ?? 0), Number(flag('--of') ?? 1));
if (print && !/^[0-9a-f]{16,40}$/.test(print)) throw new Error('--print: 16 to 40 hex digits');
const text = readFileSync(file, 'utf8');
const parsed = parseContribution(text);
if (parsed.error) { console.error(`Not uploaded: ${parsed.error}`); process.exit(1); }
const personal = findPersonal(text);
if (personal.some((f) => f.block)) {
  console.error(`Not uploaded: possible personal data (${personal.filter((f) => f.block).map((f) => f.label).join(', ')}). Remove it from the file first.`);
  process.exit(1);
}
const { meta, data, warnings } = parsed;
if (!meta.course || !meta.title) { console.error('Not uploaded: the contribution needs a course and a title'); process.exit(1); }
const body = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
if (body.length > LIMIT) { console.error(`Not uploaded: ${body.length} bytes compressed; the limit is ${LIMIT}`); process.exit(1); }

const names = data.curriculum ? data.curriculum.semesters.flatMap((s) => s.courses) : data.concepts;
const doc = {
  kind: meta.kind, course: meta.course, code: meta.code, university: meta.university, professor: meta.professor, term: meta.term,
  title: meta.title, stage: meta.stage, theme: validTheme(meta.theme) ?? (meta.kind === 'curriculum' ? 'estrellas' : guessTheme(meta.course)),
  // The same keys the app writes: loose keys for concepts (plurals and articles do not matter), plain keys for courses.
  concepts: [...new Set(names.map((c) => (data.curriculum ? keyOf(c.name) : looseKey(c.name))))].filter(Boolean).slice(0, 300),
  questions: data.questions.length, examples: data.examples.length,
  body, encoding: 'gzip', visibility: 'public', source: flag('--source'), print: print || undefined, updated: new Date(),
};
const docId = flag('--id') ?? `${keyOf(meta.course).slice(0, 40)}-${createHash('sha256').update(text).digest('hex').slice(0, 10)}`;
const summary = `${meta.kind} · ${meta.course}${meta.professor ? ` · ${meta.professor}` : ''}${meta.term ? ` · ${meta.term}` : ''} · ${meta.title}: ${data.concepts.length} concepts, ${data.questions.length} questions, ${data.examples.length} examples, ${body.length} bytes compressed`;
for (const w of warnings) console.log(`warning: ${w}`);
for (const f of personal) console.log(`check: ${f.label}`);
const token = print || flag('--owner') ? await accessToken() : null;
if (print) {
  const found = await call(token, 'POST', `${api}:runQuery`, { structuredQuery: {
    from: [{ collectionId: 'contributions' }], limit: 1,
    where: { fieldFilter: { field: { fieldPath: 'print' }, op: 'EQUAL', value: { stringValue: print } } },
  } });
  const twin = found.find((r) => r.document)?.document.name.split('/').pop();
  if (twin) { console.error(`Not uploaded: the same file (fingerprint ${print}) is already in the map as ${twin}`); process.exit(1); }
}
let uid = '';
if (flag('--owner')) {
  const who = await call(token, 'POST', `https://identitytoolkit.googleapis.com/v1/projects/${id}/accounts:lookup`, { email: [flag('--owner')] });
  uid = who.users?.[0]?.localId ?? '';
  if (!uid) { console.error(`Not uploaded: no account with the e-mail ${flag('--owner')}`); process.exit(1); }
}
const extra = `${print ? `, fingerprint ${print}` : ', no fingerprint'}${uid ? `, owner ${flag('--owner')}` : ', no owner'}`;
if (args.includes('--dry-run')) { console.log(`Dry run, not uploaded: ${docId} — ${summary}${extra}`); process.exit(0); }
const writes = [{ update: { name: `${base}/contributions/${docId}`, fields: fields(doc) } }];
// The owner record, as the site writes it with the contribution; never over an owner that is already there.
if (uid) writes.push({ update: { name: `${base}/owners/${docId}`, fields: { uid: { stringValue: uid } } }, currentDocument: { exists: false } });
await call(token ?? await accessToken(), 'POST', `${api}:commit`, { writes });
console.log(`Uploaded ${docId} to ${id} — ${summary}${extra}`);
