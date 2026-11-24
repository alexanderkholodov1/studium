// A beta: this branch on the Hosting preview channel «beta» of studium101 (studium101--beta-<hash>.web.app), with the
// same accounts and the same database as production (caspian-kb, decisions/2026-11-22-beta-channel-same-project.md).
// Usage: node tools/beta.mjs --dry      build the beta rules and the site in a temporary folder; publish nothing
//        node tools/beta.mjs            publish the beta rules on the live project, then the site on the channel
// Needs GOOGLE_APPLICATION_CREDENTIALS (the service account) and the Firebase CLI signed in.
//
// The rules published for a beta are this branch's, except that replacing or deleting a guide or a contribution does
// not yet demand a kept version: the code in production does not keep versions, and those rules would break its
// «Reemplazar» and «Borrar» (work/2026-11-20-release-deploy-rules-with-0.6.0.md). Everything else in the branch only
// adds collections or accepts more fields, which the code in production never notices. The release publishes the
// branch's rules as they are.
// The page's version is the build name, `git describe` (v0.6.0-beta.1-7-g487fe2c), written into the packed config.js;
// the page shows «Studium beta» with it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dry = process.argv.includes('--dry');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

if (!dry && git('status', '--porcelain', '--', 'public', 'firestore.rules')) { console.error('public/ or firestore.rules has uncommitted changes: commit them first, so the beta is a commit.'); process.exit(1); }
const name = git('describe', '--tags', '--match', 'v*', '--always');
if (!/beta/.test(name)) console.warn(`The build name is ${name}: tag the commit (git tag -a v0.6.0-beta.<n>) to name the beta.`);

// The beta rules.
const branch = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const rules = branch
  .replace(/ && \(onlyWho\(\) \|\| kept\('(?:catalog|guides|contributions)', id\)\)/g, '')
  .replace(/ && kept\('(?:catalog|guides|contributions)', id\)\)/g, ')');
const relaxed = (branch.match(/kept\('(?:catalog|guides|contributions)', id\)/g) ?? []).length;
if (relaxed !== 6 || /kept\('(?:catalog|guides|contributions)', id\)/.test(rules)) { console.error(`Expected to relax 6 version checks; found ${relaxed}. Look at firestore.rules before publishing a beta.`); process.exit(1); }

// The site: /studium/ as the portfolio serves it, and / sends there.
const out = mkdtempSync(path.join(tmpdir(), 'studium-beta-'));
const site = path.join(out, 'site');
mkdirSync(site, { recursive: true });
cpSync(path.join(ROOT, 'public'), path.join(site, 'studium'), { recursive: true });
const config = path.join(site, 'studium', 'assets', 'config.js');
const before = readFileSync(config, 'utf8');
const version = name.replace(/^v/, '');
const after = before.replace(/export const VERSION = '[^']*';/, `export const VERSION = '${version}';`);
if (after === before && !before.includes(`'${version}'`)) { console.error('config.js has no VERSION to write the build name into.'); process.exit(1); }
writeFileSync(config, after);
// What a page left open compares with its own version, to say «Studium recibió una nueva actualización» (update.js).
writeFileSync(path.join(site, 'studium', 'version.json'), `${JSON.stringify({ name: 'studium', version, builtAt: new Date().toISOString() })}\n`);
writeFileSync(path.join(site, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Studium beta</title><meta http-equiv="refresh" content="0; url=/studium/"><a href="/studium/">Studium beta</a>\n');
writeFileSync(path.join(out, 'firestore.beta.rules'), rules);
writeFileSync(path.join(out, 'firebase.json'), JSON.stringify({
  hosting: { site: 'studium101', public: 'site', cleanUrls: false, headers: [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] },
}, null, 2));
console.log(`Beta ${name}: site and rules in ${out}`);
if (dry) process.exit(0);

// The rules first: the site must not run before its collections are allowed.
const { accessToken, call, project } = await import(new URL('./google.mjs', import.meta.url));
const id = project();
const api = 'https://firebaserules.googleapis.com/v1';
const token = await accessToken();
const release = `projects/${id}/releases/cloud.firestore`;
const live = await call(token, 'GET', `${api}/${release}`);
const ruleset = await call(token, 'POST', `${api}/projects/${id}/rulesets`, { source: { files: [{ name: 'firestore.rules', content: rules }] } });
await call(token, 'PATCH', `${api}/${release}`, { release: { name: release, rulesetName: ruleset.name } });
console.log(`Beta rules published (${ruleset.name.split('/').pop()}); the previous ones were ${live.rulesetName.split('/').pop()} (to go back: PATCH the release to it).`);

const r = spawnSync('firebase', ['hosting:channel:deploy', 'beta', '--project', id, '--config', path.join(out, 'firebase.json'), '--expires', '30d', '--json'], { cwd: out, encoding: 'utf8', shell: process.platform === 'win32' });
if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
const url = JSON.parse(r.stdout).result?.studium101?.url ?? JSON.parse(r.stdout).result?.[Object.keys(JSON.parse(r.stdout).result)[0]]?.url;
console.log(`Beta ${name} at ${url}/studium/ (for 30 days; publishing again extends it)`);
