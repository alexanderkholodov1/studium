// Publishes one guide to the project's database: its catalog entry and its HTML (gzip), in one atomic write.
// Usage: node tools/upload-guide.mjs <meta.json> <guide.html>
//        node tools/upload-guide.mjs --remove <id>
// meta.json: { "id", "course", "code", "university", "term", "professor", "title", "date": "YYYY-MM-DD", "topics": [] }
// The guide must be one self-contained HTML file; the site shows it in a sandboxed frame.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { accessToken, call, project } from './google.mjs';

const LIMIT = 1_000_000; // a Firestore document holds at most 1 MiB, field names and metadata included
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
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));

const args = process.argv.slice(2);
const token = await accessToken();

if (args[0] === '--remove') {
  const guide = args[1];
  if (!guide) throw new Error('Usage: node tools/upload-guide.mjs --remove <id>');
  await call(token, 'POST', `${api}:commit`, { writes: [{ delete: `${base}/catalog/${guide}` }, { delete: `${base}/guides/${guide}` }] });
  console.log(`Removed ${guide} from ${id}`);
  process.exit(0);
}

const [metaPath, htmlPath] = args;
if (!metaPath || !htmlPath) throw new Error('Usage: node tools/upload-guide.mjs <meta.json> <guide.html>');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const html = readFileSync(htmlPath);
const problems = [];
if (!/^[a-z0-9][a-z0-9-]{2,99}$/.test(meta.id ?? '')) problems.push('id: lowercase letters, digits and hyphens');
for (const k of ['course', 'title']) if (typeof meta[k] !== 'string' || !meta[k].trim()) problems.push(`${k}: required`);
for (const k of ['code', 'university', 'term', 'professor']) if (meta[k] !== undefined && typeof meta[k] !== 'string') problems.push(`${k}: text`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '')) problems.push('date: YYYY-MM-DD');
if (meta.topics !== undefined && !(Array.isArray(meta.topics) && meta.topics.every((t) => typeof t === 'string'))) problems.push('topics: list of text');
if (!/^\s*<!doctype html>/i.test(html.subarray(0, 200).toString('utf8'))) problems.push('the guide must be an HTML document starting with <!doctype html>');
const packed = gzipSync(html, { level: 9 });
if (packed.length > LIMIT) problems.push(`the compressed guide is ${packed.length} bytes; the limit is ${LIMIT}`);
if (problems.length) { console.error(`Not uploaded:\n- ${problems.join('\n- ')}`); process.exit(1); }

const now = new Date();
const sha256 = createHash('sha256').update(html).digest('hex');
const entry = { course: meta.course, title: meta.title, date: meta.date, topics: meta.topics ?? [], sha256, updatedAt: now };
for (const k of ['code', 'university', 'term', 'professor']) if (meta[k]) entry[k] = meta[k];
await call(token, 'POST', `${api}:commit`, {
  writes: [
    { update: { name: `${base}/catalog/${meta.id}`, fields: fields(entry) } },
    { update: { name: `${base}/guides/${meta.id}`, fields: fields({ title: `${meta.course} · ${meta.title}`, encoding: 'gzip', html: packed, sha256, size: html.length, updatedAt: now }) } },
  ],
});
console.log(`Uploaded ${meta.id} to ${id}: ${html.length} bytes, ${packed.length} compressed, sha256 ${sha256.slice(0, 12)}`);
