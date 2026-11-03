// Publishes firestore.rules to the project in .firebaserc. Creating the ruleset compiles it on the server, so a
// rule that does not compile is reported and nothing changes. Publishing is skipped when the live rules are already
// identical. Usage: node tools/deploy-rules.mjs
import { readFileSync } from 'node:fs';
import { accessToken, call, project } from './google.mjs';

const id = project();
const api = 'https://firebaserules.googleapis.com/v1';
const content = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const release = `projects/${id}/releases/cloud.firestore`;
const token = await accessToken();

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
