// Serves public/ at http://localhost:<port>/studium/ as the portfolio mounts it.
// Usage: node tools/dev.mjs [--port 5173] [--emulators]
// With --emulators the app talks to the local Firebase emulators of firebase.json (firebase emulators:start).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 5173;
const emulators = args.includes('--emulators')
  ? JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8')).emulators : null;
const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/studium') { res.writeHead(302, { location: '/studium/' }); res.end(); return; }
  if (!url.pathname.startsWith('/studium/')) { res.writeHead(404); res.end('Not found'); return; }
  const rel = decodeURIComponent(url.pathname.slice('/studium/'.length)) || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
  try {
    let body = await readFile(file);
    if (rel === 'index.html' && emulators) {
      const flag = `<script>globalThis.STUDIUM_EMULATORS = ${JSON.stringify({ auth: emulators.auth.port, firestore: emulators.firestore.port })};</script>`;
      body = Buffer.from(body.toString('utf8').replace('<head>', `<head>\n${flag}`));
    }
    res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log(`Studium at http://localhost:${port}/studium/${emulators ? ' (emulators)' : ''}`));
