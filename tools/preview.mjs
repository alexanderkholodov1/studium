// A private preview of Studium on this computer, to try a version before it reaches production: the Firebase
// emulators (a database and accounts of their own, separate from the real ones), demo data, and the page at
// http://localhost:5173/studium/. Nothing here touches the live project.
// Usage: node tools/preview.mjs                       start everything and load the demo data
//        node tools/preview.mjs --guide <file.html>    use that HTML file as one of the demo guides
// Accounts (password prueba123): prueba@estud.usfq.edu.ec (a student), otra@estud.usfq.edu.ec (a classmate),
// studiumplatform@gmail.com (an admin). Stop it with Ctrl+C.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { defaultDocument, toFields } from './settings.mjs';

const ROOT = new URL('..', import.meta.url);
const ports = JSON.parse(readFileSync(new URL('firebase.json', ROOT), 'utf8')).emulators;
const P = JSON.parse(readFileSync(new URL('.firebaserc', ROOT), 'utf8')).projects.default;
const FS = `http://127.0.0.1:${ports.firestore.port}`;
const AUTH = `http://127.0.0.1:${ports.auth.port}`;
const args = process.argv.slice(2);
const guideFile = args.includes('--guide') ? args[args.indexOf('--guide') + 1] : null;
const children = [];
const run = (cmd, list) => {
  const child = spawn(cmd, list, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  children.push(child);
  return child;
};
// Stopping takes the whole tree down: on Windows the emulators run under a shell and Java would stay behind.
const stop = () => {
  for (const c of children) {
    try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill(); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);

console.log('Starting the Firebase emulators…');
const emulators = run('npx', ['--yes', 'firebase-tools@15.11.0', 'emulators:start', '--only', 'auth,firestore', '--project', P]);
emulators.stderr.on('data', (d) => { if (/port taken|Error/i.test(String(d))) console.error(String(d).trim()); });
const up = async (url) => { try { await fetch(url); return true; } catch { return false; } };
for (let i = 0; i < 90 && !((await up(FS)) && (await up(AUTH))); i += 1) await new Promise((r) => setTimeout(r, 1000));
if (!((await up(FS)) && (await up(AUTH)))) { console.error('The emulators did not start: are ports free?'); stop(); }

/* ---------- demo data ---------- */
const H = { 'content-type': 'application/json', authorization: 'Bearer owner' };
const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t}`); return t ? JSON.parse(t) : {}; };
const ID = `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${P}`;
const base = `projects/${P}/databases/(default)/documents`;
const put = (path, data) => ({ update: { name: `${base}/${path}`, fields: toFields(data) } });
await fetch(`${AUTH}/emulator/v1/projects/${P}/accounts`, { method: 'DELETE' });
await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });
const account = async (email, claims) => {
  const u = await post(`${ID}/accounts`, { email, password: 'prueba123', emailVerified: true });
  if (claims) await post(`${ID}/accounts:update`, { localId: u.localId, customAttributes: JSON.stringify(claims) });
  return u.localId;
};
const uid = await account('prueba@estud.usfq.edu.ec');
const other = await account('otra@estud.usfq.edu.ec');
await account('studiumplatform@gmail.com', { admin: true });
const page = (title) => Buffer.from(`<!doctype html><html lang="es"><meta charset="utf-8"><title>${title}</title><body style="font:20px system-ui;padding:40px;max-width:760px;margin:auto"><h1>${title}</h1><section id="intro"><h2>Una sección</h2><p>Guía de prueba de la vista previa.</p></section></body></html>`);
const now = new Date();
const soon = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const guides = [
  { id: 'demo-redes', course: 'Redes de Computadores', code: 'CMP-4005', university: 'USFQ', term: '202610', professor: 'Docente de Prueba', title: 'Examen 2', date: soon(1), theme: 'redes', level: 'standard', topics: ['VLAN', 'Subredes', 'Dijkstra', 'RIP', 'OSPF'], html: guideFile ? readFileSync(guideFile) : page('Redes · Examen 2') },
  { id: 'demo-algebra', by: 'Nombre de Prueba', ai: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }, course: 'Álgebra Lineal', code: 'MAT-2101', university: 'USFQ', term: '202610', professor: 'Docente de Prueba', title: 'Parcial 2', date: soon(14), theme: 'vectores', level: 'standard', topics: ['Matrices', 'Determinantes', 'Diagonalización'], html: page('Álgebra · Parcial 2') },
  { id: 'demo-bd', course: 'Bases de Datos', code: 'CMP-3002', university: 'USFQ', term: '202610', professor: 'Otra Docente de Prueba', title: 'Parcial 1', date: soon(-20), theme: 'codigo', level: 'advanced', topics: ['SQL', 'Normalización', 'Álgebra relacional'], html: page('Bases de Datos · Parcial 1') },
  { id: 'demo-bio', course: 'Biología Celular', code: 'BIO-1001', university: 'USFQ', term: '202610', professor: 'Docente de Prueba', title: 'Final', date: soon(35), theme: 'celulas', level: 'standard', topics: ['Mitosis', 'Membrana', 'ADN'], html: page('Biología · Final') },
];
const writes = [];
for (const { id, html, ...meta } of guides) {
  writes.push(put(`catalog/${id}`, { ...meta, concepts: meta.topics, anchors: meta.topics.map(() => ''), visibility: 'public', updated: now }));
  writes.push(put(`guides/${id}`, { title: `${meta.course} · ${meta.title}`, html: gzipSync(html), encoding: 'gzip', size: html.length, visibility: 'public', updated: now }));
}
writes.push(put('owners/demo-redes', { uid }));
writes.push(put(`kudos/demo-redes__${other}`, { guide: 'demo-redes', kinds: ['salvo', 'examen', 'gracias'], updated: now }));
writes.push(put(`tips/docente-de-prueba__${other}`, { prof: 'docente-de-prueba', professor: 'Docente de Prueba', course: 'Álgebra Lineal', tags: ['explica-claro', 'examen-deberes', 'ideal-guiado'], updated: now }));
const body = gzipSync(Buffer.from(JSON.stringify({ version: 1, style: 'Exámenes cortos con cálculo a mano.',
  concepts: [{ name: 'Subredes', summary: 'Dividir una red con una máscara más larga.' }, { name: 'OSPF', summary: 'Protocolo de estado de enlace que usa Dijkstra.' }],
  questions: [
    { concepts: ['Subredes'], kind: 'computation', difficulty: 3, points: 10, text: 'Divide 192.168.10.0/24 en 4 subredes y da la red y el broadcast de cada una.', solution: '/26: .0, .64, .128, .192; broadcast .63, .127, .191, .255.' },
    { concepts: ['OSPF'], kind: 'short-answer', difficulty: 2, text: '¿Qué algoritmo usa OSPF para calcular rutas?', solution: 'Dijkstra.' }],
  examples: [] })));
writes.push(put('contributions/demo-aporte', { kind: 'exam', course: 'Redes de Computadores', professor: 'Docente de Prueba', term: '202610', title: 'Parcial 1', theme: 'redes', concepts: ['subredes', 'ospf'], questions: 2, examples: 0, body, encoding: 'gzip', visibility: 'public', updated: now }));
writes.push(put('owners/demo-aporte', { uid }));
writes.push(put('library/demo-doc', { course: 'Redes de Computadores', code: 'CMP-4005', professor: 'Docente de Prueba', term: '202610', kind: 'syllabus', title: 'Sílabo de Redes', url: 'https://drive.google.com/file/d/demo/view', updated: now }));
writes.push(put('owners/demo-doc', { uid }));
writes.push({ update: { name: `${base}/settings/app`, fields: toFields(defaultDocument('tools/preview.mjs')) } });
writes.push(put('presence/' + uid, { at: now, community: 'usfq', since: now }));
await post(`${FS}/v1/${base}:commit`, { writes });

console.log('Starting the page…');
const dev = run('node', ['tools/dev.mjs', '--emulators']);
dev.stdout.on('data', (d) => process.stdout.write(d));
console.log(`
Studium preview: http://localhost:5173/studium/
  student   prueba@estud.usfq.edu.ec   / prueba123
  classmate otra@estud.usfq.edu.ec     / prueba123
  admin     studiumplatform@gmail.com  / prueba123
Everything here lives in the emulators, never in the live project. Ctrl+C stops it.`);
