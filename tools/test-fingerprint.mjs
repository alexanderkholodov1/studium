// Checks that tools/fingerprint.mjs gives the same fingerprint as the app, so a file uploaded with the admin tools and
// the same file dropped on the site are one: a small file and a file over 64 MB against public/assets/files.js
// fingerprint() itself, and a group of files and the parts of a file against the rules in contribute.js. contribute.js
// cannot load outside a browser, so its two rules are checked line by line: if they change, this fails until
// tools/fingerprint.mjs follows them. Temporary files go to the system's temporary folder and are deleted.
// Usage: node tools/test-fingerprint.mjs
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from '../public/assets/files.js';
import { filePrint, groupPrint, partPrint, printOf } from './fingerprint.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// The browser's rules for a group and for parts, written as contribute.js has them.
const app = readFileSync(new URL('../public/assets/contribute.js', import.meta.url), 'utf8');
const RULES = [
  "const unitPrint = (print, i, count) => (!print ? '' : count === 1 ? print : `${print.slice(0, 20)}${i.toString(16).padStart(4, '0')}`);",
  'if (prints.length === 1) return prints[0];',
  "const joined = new TextEncoder().encode(prints.join(''));",
  "return [...new Uint8Array(await crypto.subtle.digest('SHA-256', joined))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);",
];
for (const line of RULES) check(`contribute.js still has: ${line.slice(0, 60)}…`, app.includes(line));
const appGroup = async (prints) => (prints.length === 1 ? prints[0]
  : hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prints.join('')))).slice(0, 24));
const appPart = (print, i, count) => (!print ? '' : count === 1 ? print : `${print.slice(0, 20)}${i.toString(16).padStart(4, '0')}`);

const dir = mkdtempSync(join(tmpdir(), 'studium-print-'));
try {
  const write = (name, size) => { const path = join(dir, name); writeFileSync(path, randomBytes(size)); return path; };
  const browser = async (path) => fingerprint(new Blob([readFileSync(path)]));

  const small = write('small.bin', 300_000);
  const a = await browser(small);
  check('one small file', filePrint(small) === a, a);

  // Over 64 MB the app reads only the beginning, the end and the size; the edge (exactly 64 MB) reads everything.
  const edge = write('edge.bin', 64_000_000);
  const e = await browser(edge);
  check('one file of exactly 64 MB', filePrint(edge) === e, e);
  rmSync(edge);
  const big = write('big.bin', 70_000_000);
  const b = await browser(big);
  check('one file over 64 MB', filePrint(big) === b, b);
  rmSync(big);

  const photos = [write('p1.jpg', 120_000), write('p2.jpg', 90_000), write('p3.jpg', 150_000)];
  const g = await appGroup(await Promise.all(photos.map(browser)));
  check('a group of files (the photos of one exam)', printOf(photos) === g && groupPrint(photos.map(filePrint)) === g, g);

  const parts = [0, 1, 11].map((i) => [printOf([small], i, 12), appPart(a, i, 12)]);
  check('the parts of a file', parts.every(([mine, theirs]) => mine === theirs), parts.map(([x]) => x).join(' '));
  check('a file in one part keeps its own fingerprint', partPrint(a, 0, 1) === a && printOf([small], 0, 1) === a);
  check('no file, no fingerprint', printOf([]) === '');
  let refused = false;
  try { printOf([small], 3, 3); } catch { refused = true; }
  check('a part outside the file is refused', refused);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) { console.error(`${failed} check${failed === 1 ? '' : 's'} failed`); process.exit(1); }
console.log('The tools fingerprint files as the app does.');
