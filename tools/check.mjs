// Checks that public/ is a valid Studium release before anything is packed:
// - only the app shell ships: public/index.html and public/assets/ (guides live in the database, never here);
// - every root-absolute resource stays inside the /studium/ mount (the portfolio's rule for mounted apps);
// - no key material, except the public Firebase web key, and only in public/assets/config.js;
// - config.js has default settings with at least one active community, and firestore.rules reads the live ones;
// - no symbolic links.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'public';
const MOUNT = 'studium';
const CONFIG = path.join(ROOT, 'assets', 'config.js');
const errors = [];

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const file = path.join(dir, name);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) { errors.push(`symbolic link: ${file}`); return []; }
  return stat.isDirectory() ? walk(file) : [file];
});
const files = walk(ROOT);
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

if (!existsSync(path.join(ROOT, 'index.html'))) errors.push('public/index.html is missing');
for (const file of files) {
  const name = rel(file);
  if (name !== 'index.html' && !name.startsWith('assets/')) errors.push(`${file}: only index.html and assets/ ship; guides go to the database`);
  if (name.startsWith('assets/') && name.endsWith('.html')) errors.push(`${file}: no HTML pages in assets/; guides go to the database`);
}

// Same rule the portfolio applies to every mounted app: src, <link href> and CSS url() stay inside the mount.
const rootRefs = (text) => [...text.matchAll(/(?:\bsrc\s*=\s*["']|<link\b[^>]*?\bhref\s*=\s*["']|url\(\s*["']?)(\/(?!\/)[^"')\s]*)/gi)].map((m) => m[1]);
for (const file of files.filter((f) => /\.(html|css)$/.test(f))) {
  const outside = rootRefs(readFileSync(file, 'utf8')).filter((ref) => ref !== `/${MOUNT}` && !ref.startsWith(`/${MOUNT}/`));
  if (outside.length) errors.push(`${file} loads root paths outside /${MOUNT}/: ${outside.slice(0, 3).join(', ')}`);
}

const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key(_id)?"\s*:|"client_email"\s*:|\bgh[pousr]_[A-Za-z\d]{20,}|\bgithub_pat_/;
const WEB_KEY = /AIza[0-9A-Za-z_-]{30,}/g;
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  if (SECRET.test(text)) errors.push(`key material in ${file}`);
  const keys = text.match(WEB_KEY) ?? [];
  if (keys.length && path.resolve(file) !== path.resolve(CONFIG)) errors.push(`a web API key outside ${CONFIG}: ${file}`);
}

if (existsSync(CONFIG)) {
  const config = readFileSync(CONFIG, 'utf8');
  if ((config.match(WEB_KEY) ?? []).length > 1) errors.push(`${CONFIG} holds more than one web API key`);
  if (!/apiKey:\s*'AIza[0-9A-Za-z_-]{30,}'/.test(config)) errors.push(`${CONFIG} has no apiKey`);
  // The communities and the confirmation live in settings/app, which the rules read; config.js holds their defaults.
  const rules = readFileSync('firestore.rules', 'utf8');
  const { DEFAULT_SETTINGS, domainsOf } = await import(pathToFileURL(path.resolve(CONFIG)).href);
  if (!DEFAULT_SETTINGS?.communities?.length) errors.push(`${CONFIG} has no default communities`);
  else if (!domainsOf(DEFAULT_SETTINGS).length) errors.push(`${CONFIG}: no active default community has a domain`);
  if (typeof DEFAULT_SETTINGS?.confirmEmail !== 'boolean') errors.push(`${CONFIG}: confirmEmail is not true or false`);
  if (!rules.includes('in settings().domains')) errors.push('firestore.rules does not take the accepted domains from settings/app');
  if (!rules.includes("settings().get('confirmEmail', false)")) errors.push('firestore.rules does not take the confirmation from settings/app');
} else errors.push(`${CONFIG} is missing`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} files, every resource inside /${MOUNT}/, rules and config agree`);
