// Publishes firestore.rules to the project in .firebaserc. Creating the ruleset compiles it on the server, so a
// rule that does not compile is reported and nothing changes. Publishing is skipped when the live rules are already
// identical. The rules read the app's settings (settings/app): when that document does not exist yet, it is created
// first with the defaults of public/assets/config.js; an existing one is never changed here. The composite indexes of
// firestore.indexes.json are created when missing (the database builds them in a few minutes; until then the app reads
// the slower way).
// Usage: node tools/deploy-rules.mjs
import { readFileSync } from 'node:fs';
import { accessToken, call, project } from './google.mjs';
import { defaultDocument, toFields } from './settings.mjs';

const id = project();
const api = 'https://firebaserules.googleapis.com/v1';
const content = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const release = `projects/${id}/releases/cloud.firestore`;
const token = await accessToken();

const settingsUrl = `https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/documents/settings/app`;
const found = await fetch(settingsUrl, { headers: { authorization: `Bearer ${token}` } });
if (found.status === 404) {
  await call(token, 'PATCH', `${settingsUrl}?currentDocument.exists=false`, { fields: toFields(defaultDocument('tools/deploy-rules.mjs')) });
  console.log(`Created settings/app in ${id} with the defaults of public/assets/config.js`);
} else if (!found.ok) {
  console.error(`Could not read settings/app: HTTP ${found.status}`);
  process.exit(1);
}

const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes;
for (const index of indexes) {
  const url = `https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/collectionGroups/${index.collectionGroup}/indexes`;
  const same = (x) => x.queryScope === index.queryScope && JSON.stringify(x.fields.filter((f) => f.fieldPath !== '__name__').map((f) => [f.fieldPath, f.order]))
    === JSON.stringify(index.fields.map((f) => [f.fieldPath, f.order]));
  const existing = (await call(token, 'GET', url)).indexes ?? [];
  if (existing.some(same)) continue;
  await call(token, 'POST', url, { queryScope: index.queryScope, fields: index.fields });
  console.log(`Creating the index ${index.collectionGroup}(${index.fields.map((f) => f.fieldPath).join(', ')}) in ${id}`);
}

const live = await call(token, 'GET', `${api}/${release}`);
const current = await call(token, 'GET', `${api}/${live.rulesetName}`);
if (current.source?.files?.[0]?.content === content) {
  console.log(`The live rules of ${id} are already up to date`);
  process.exit(0);
}
let ruleset;
try {
  ruleset = await call(token, 'POST', `${api}/projects/${id}/rulesets`, { source: { files: [{ name: 'firestore.rules', content }] } });
} catch (error) {
  console.error(`firestore.rules was not published: ${error.message}`);
  process.exit(1);
}
await call(token, 'PATCH', `${api}/${release}`, { release: { name: release, rulesetName: ruleset.name } });
console.log(`Published firestore.rules to ${id} (${ruleset.name.split('/').pop()})`);
