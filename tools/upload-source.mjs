// Publishes or updates a source: a collection that material comes from, with its credits, shown on the Sources page.
// Usage: node tools/upload-source.mjs <source.json>
// source.json: { "id", "name", "by", "description", "thanks", "url", "linkLabel", "theme", "order" }
// Paragraphs in description and thanks are separated by a blank line.
import { readFileSync } from 'node:fs';
import { accessToken, call, project } from './google.mjs';

const [file] = process.argv.slice(2);
if (!file) throw new Error('Usage: node tools/upload-source.mjs <source.json>');
const src = JSON.parse(readFileSync(file, 'utf8'));
if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(src.id ?? '')) throw new Error('id: lowercase letters, digits and hyphens');
if (!src.name) throw new Error('name: required');
if (src.url && !/^https:\/\//.test(src.url)) throw new Error('url: must start with https://');
const id = project();
const base = `projects/${id}/databases/(default)/documents`;
const fields = {};
for (const k of ['name', 'by', 'description', 'thanks', 'url', 'linkLabel', 'theme']) if (src[k]) fields[k] = { stringValue: String(src[k]) };
fields.order = { integerValue: String(src.order ?? 0) };
await call(await accessToken(), 'POST', `https://firestore.googleapis.com/v1/${base}:commit`, { writes: [{ update: { name: `${base}/sources/${src.id}`, fields } }] });
console.log(`Published source ${src.id} to ${id}`);
