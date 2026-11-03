// Checks that public/ is a valid Studium release before anything is packed:
// an entry page, every root-absolute resource inside the /studium/ mount, every catalog guide present,
// no key material and no symbolic links.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'public';
const MOUNT = 'studium';
const errors = [];

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const file = path.join(dir, name);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) { errors.push(`symbolic link: ${file}`); return []; }
  return stat.isDirectory() ? walk(file) : [file];
});
const files = walk(ROOT);

if (!existsSync(path.join(ROOT, 'index.html'))) errors.push('public/index.html is missing');

// Same rule the portfolio applies to every mounted app: src, <link href> and CSS url() stay inside the mount.
const rootRefs = (html) => [...html.matchAll(/(?:\bsrc\s*=\s*["']|<link\b[^>]*?\bhref\s*=\s*["']|url\(\s*["']?)(\/(?!\/)[^"')\s]*)/gi)].map((m) => m[1]);
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const outside = rootRefs(readFileSync(file, 'utf8')).filter((ref) => ref !== `/${MOUNT}` && !ref.startsWith(`/${MOUNT}/`));
  if (outside.length) errors.push(`${file} loads root paths outside /${MOUNT}/: ${outside.slice(0, 3).join(', ')}`);
}

const KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:|AIza[0-9A-Za-z_-]{35}/;
for (const file of files) if (KEY.test(readFileSync(file, 'latin1'))) errors.push(`key material in ${file}`);

const catalog = readFileSync(path.join(ROOT, 'assets', 'catalog.js'), 'utf8');
const guides = [...catalog.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
if (!guides.length) errors.push('the catalog lists no guides');
for (const guide of guides) if (!existsSync(path.join(ROOT, guide, 'index.html'))) errors.push(`catalog entry ${guide} has no index.html`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} files, ${guides.length} guide(s), every resource inside /${MOUNT}/`);
