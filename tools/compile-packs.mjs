// Compiles the packs of the map (see public/assets/packs.js) with the service account: every public contribution in a
// few documents, then the index that points at them, then the previous parts go. The admin panel does the same with
// «Compilar ahora»; this is for after an upload from the tools. Nothing runs it on a timer.
// Usage: node tools/compile-packs.mjs [--dry-run]
import { gzipSync, gunzipSync } from 'node:zlib';
import { accessToken, call, project } from './google.mjs';
import { packJSON, slices, buildId } from '../public/assets/packs.js';
import { fromFields, toValue } from './settings.mjs';

const id = project();
const base = `projects/${id}/databases/(default)/documents`;
const api = `https://firestore.googleapis.com/v1/${base}`;
const token = await accessToken();
const dry = process.argv.includes('--dry-run');

const items = [];
let page = '';
do {
  const r = await call(token, 'GET', `${api}/contributions?pageSize=300${page ? `&pageToken=${page}` : ''}`);
  for (const d of r.documents ?? []) {
    const f = d.fields ?? {};
    if (f.visibility?.stringValue !== 'public') continue;
    const { body, encoding, updated, ...rest } = fromFields(f);
    let data = {};
    try { data = JSON.parse(gunzipSync(Buffer.from(f.body.bytesValue, 'base64')).toString('utf8')); } catch { /* an unreadable body adds nothing */ }
    items.push({ id: d.name.split('/').pop(), ...rest, data, updated: Date.parse(f.updated?.timestampValue ?? d.updateTime) || 0 });
  }
  page = r.nextPageToken;
} while (page);

const build = buildId();
const bytes = gzipSync(Buffer.from(packJSON(build, items)), { level: 9 });
const parts = slices(new Uint8Array(bytes));
const newest = items.reduce((m, x) => Math.max(m, x.updated), 0);
console.log(`${items.length} public contributions, ${bytes.length} bytes compressed, ${parts.length} part${parts.length === 1 ? '' : 's'}`);
if (dry) process.exit(0);

const old = await call(token, 'GET', `${api}/packs/index`).catch((e) => { if (e.status === 404) return null; throw e; });
for (let i = 0; i < parts.length; i += 8) {
  await call(token, 'POST', `${api}:commit`, { writes: parts.slice(i, i + 8).map((part, j) => ({ update: { name: `${base}/packs/${build}-${i + j}`, fields: {
    build: toValue(build), i: { integerValue: String(i + j) }, of: { integerValue: String(parts.length) }, data: { bytesValue: Buffer.from(part).toString('base64') },
  } } })) });
}
await call(token, 'POST', `${api}:commit`, { writes: [{
  update: { name: `${base}/packs/index`, fields: {
    build: toValue(build), parts: { integerValue: String(parts.length) }, count: { integerValue: String(items.length) },
    at: { timestampValue: new Date(newest).toISOString() }, by: toValue('tools/compile-packs.mjs'),
  } },
  updateTransforms: [{ fieldPath: 'built', setToServerValue: 'REQUEST_TIME' }],
}] });
const oldBuild = old?.fields?.build?.stringValue;
const oldParts = Number(old?.fields?.parts?.integerValue ?? 0);
if (oldBuild && oldBuild !== build && oldParts) {
  await call(token, 'POST', `${api}:commit`, { writes: Array.from({ length: oldParts }, (_, i) => ({ delete: `${base}/packs/${oldBuild}-${i}` })) });
}
console.log(`Compiled pack ${build} in ${id}`);
