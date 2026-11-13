#!/usr/bin/env node
// Studium's local bridge: lets Studium's page use the AI CLIs a student already has signed in on their own computer
// (Claude Code, Codex, Antigravity), with their subscription instead of an API key. The student downloads this file
// from Studium and runs `node studium-bridge.mjs`. Node 20 or newer, no dependencies, Windows, macOS and Linux.
//
// It listens on 127.0.0.1 only, answers only Studium's own origins, and only with the pairing code it prints. Each
// request runs the chosen CLI read-only, in a fresh folder of its own that is deleted afterwards, one request at a
// time per CLI. The material never leaves this computer except toward the student's own AI.
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import path from 'node:path';

const VERSION = '1.0.0';
const NAME = 'studium-bridge';
const DEFAULT_PORT = 41730;
const MAX_BODY = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT = 20 * 60 * 1000;
const MAX_TIMEOUT = 60 * 60 * 1000;
const DETECT_CACHE_MS = 60_000;
const TEMP_PREFIX = 'studium-run-';
const WIN = platform() === 'win32';
const SITE = 'https://alexanderkholodov.web.app';

/* ---------- command line ---------- */
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const option = (name) => { const i = argv.indexOf(name); if (i < 0 || i + 1 >= argv.length) return null; const [, v] = argv.splice(i, 2); return v; };
const reset = flag('--reset');
const dev = flag('--dev');
const extraOrigins = [];
for (let o = option('--origin'); o !== null; o = option('--origin')) extraOrigins.push(o.replace(/\/+$/, ''));
const port = Number(option('--port') ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('El puerto debe ser un número entre 1024 y 65535.'); process.exit(1); }

/* ---------- who may ask ---------- */
const ORIGINS = new Set([SITE, 'http://localhost:5173', 'http://127.0.0.1:5173']);
// Firebase preview channels of Studium's project.
const PREVIEW = /^https:\/\/studium101--[a-z0-9-]+\.web\.app$/;
const originAllowed = (origin) => !!origin && (ORIGINS.has(origin) || PREVIEW.test(origin) || extraOrigins.includes(origin));

/* ---------- the pairing code ---------- */
// Kept in the home folder, so a restart keeps the pairing; --reset makes a new one.
const CONFIG = path.join(homedir(), '.studium-bridge.json');
function pairingCode() {
  if (!reset) {
    try { const { token } = JSON.parse(readFileSync(CONFIG, 'utf8')); if (typeof token === 'string' && token.length >= 32) return token; } catch { /* a new one */ }
  }
  const token = randomBytes(32).toString('base64url');
  writeFileSync(CONFIG, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(CONFIG, 0o600); } catch { /* Windows keeps its own permissions */ }
  return token;
}
const TOKEN = pairingCode();
const TOKEN_BYTES = Buffer.from(TOKEN);
function tokenValid(header) {
  const m = String(header ?? '').match(/^Bearer (\S+)$/);
  if (!m) return false;
  const given = Buffer.from(m[1]);
  return given.length === TOKEN_BYTES.length && timingSafeEqual(given, TOKEN_BYTES);
}

/* ---------- responses ---------- */
const cors = (origin) => ({
  'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600',
});
function send(res, status, body, origin) {
  res.writeHead(status, { 'content-type': 'application/json', ...(origin ? cors(origin) : {}) });
  res.end(JSON.stringify(body));
}
// A failure to tell the page: an HTTP status, a code the page acts on, and a message for the student.
class Failure extends Error {
  constructor(status, code, message, resetsAt = null) { super(message); Object.assign(this, { status, code, resetsAt }); }
}
const fail = (res, f, origin) => send(res, f.status, { error: { code: f.code, message: f.message, ...(f.resetsAt ? { resetsAt: f.resetsAt } : {}) } }, origin);

/* ---------- folders of one run ---------- */
// Folders left by a crash of an earlier run are removed on start.
function cleanOldFolders() {
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(TEMP_PREFIX)) continue;
      const full = path.join(tmpdir(), name);
      try { if (statSync(full).isDirectory() && Date.now() - statSync(full).mtimeMs > 5 * 60_000) rmSync(full, { recursive: true, force: true }); } catch { /* gone */ }
    }
  } catch { /* nothing to clean */ }
}
// Windows keeps a folder busy for a moment after a process in it ends: a few retries.
const removeFolder = (dir) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort; removed on the next start */ } };
// A file name that is valid on every OS and stays inside the folder.
function safeName(name, taken) {
  let base = String(name ?? '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/\.\.+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = `_${base}`;
  if (!base) base = 'archivo';
  if (base.length > 120) { const ext = path.extname(base).slice(0, 12); base = base.slice(0, 120 - ext.length) + ext; }
  // Two parts with the same name keep both.
  let out = base; let i = 2;
  while (taken.has(out.toLowerCase())) { const ext = path.extname(base); out = `${base.slice(0, base.length - ext.length)} (${i})${ext}`; i += 1; }
  taken.add(out.toLowerCase());
  return out;
}
// The material, and the instructions plus the request in INSTRUCCIONES.md.
function writeRun(dir, body) {
  const taken = new Set(['instrucciones.md']);
  const names = [];
  for (const f of Array.isArray(body.files) ? body.files : []) {
    const name = safeName(f?.name, taken);
    const full = path.join(dir, name);
    if (path.dirname(path.resolve(full)) !== path.resolve(dir)) continue;
    if (typeof f.data === 'string') writeFileSync(full, Buffer.from(f.data, 'base64'));
    else writeFileSync(full, String(f.text ?? ''), 'utf8');
    names.push(name);
  }
  writeFileSync(path.join(dir, 'INSTRUCCIONES.md'), `${String(body.system ?? '')}\n\n---\n\n${String(body.text ?? '')}\n`, 'utf8');
  return names;
}
const prompt = (names) => `Sigue las instrucciones de INSTRUCCIONES.md, en esta carpeta.${names.length ? ` El material está en estos archivos de la misma carpeta, en este orden: ${names.join(', ')}. Léelos todos, completos.` : ''} Responde solo con el resultado final que piden las instrucciones, sin comentarios antes ni después.`;

/* ---------- finding and running a CLI ---------- */
// Windows: npm installs CLIs as .cmd shims, which Node cannot start without a shell. The shim names its real target
// (an .exe, or a script run with node): that target is run directly, so no argument ever passes through cmd.exe.
function lines(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? [] : String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean))));
}
async function resolveBin(name) {
  if (!WIN) { const [p] = await lines('which', [name]); return p ? { cmd: p, pre: [] } : null; }
  const found = await lines('where.exe', [name]);
  const exe = found.find((p) => /\.exe$/i.test(p));
  if (exe) return { cmd: exe, pre: [] };
  for (const shim of found.filter((p) => /\.(cmd|bat)$/i.test(p))) {
    let text = '';
    try { text = readFileSync(shim, 'utf8'); } catch { continue; }
    const dir = path.dirname(shim);
    const targets = [...text.matchAll(/"([^"]+\.(?:exe|js|mjs|cjs))"/gi)].map((m) => m[1].replace(/%~?dp0%?\\?/gi, `${dir}\\`));
    const target = targets.find((t) => !/node\.exe$/i.test(t));
    if (!target) continue;
    if (/\.exe$/i.test(target)) return { cmd: target, pre: [] };
    return { cmd: process.execPath, pre: [target] };
  }
  return null;
}
const binCache = new Map();
const bin = async (name) => { if (!binCache.has(name)) binCache.set(name, await resolveBin(name)); return binCache.get(name); };
function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (WIN) spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch { /* already gone */ }
}
// Runs a CLI without a shell. Resolves with its exit code and output; a timeout kills its whole process tree.
function runCli(b, args, { cwd, input = null, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(b.cmd, [...b.pre, ...args], { cwd, shell: false, windowsHide: true, detached: !WIN, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    let done = false;
    // On a timeout the whole tree ends, and the answer waits until it has ended, so its folder can be removed.
    const timer = setTimeout(() => {
      if (done) return; done = true;
      const timedOut = () => reject(new Failure(504, 'timeout', 'Tu IA tardó demasiado en responder.'));
      const grace = setTimeout(timedOut, 5000);
      child.once('close', () => { clearTimeout(grace); timedOut(); });
      killTree(child);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new Failure(502, 'failed', `No se pudo abrir la IA: ${e.message}`)); });
    child.on('close', (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err }); });
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
const lastLine = (text) => String(text ?? '').trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) ?? '';

/* ---------- when a usage limit resets ---------- */
// «resets 3pm», «resets at 15:00», «try again at 3:00 PM», «Resets in 68h22m9s», «|1794614400» (Claude's epoch).
function resetOf(text, now = new Date()) {
  const s = String(text ?? '');
  const epoch = s.match(/\|(\d{10})\b/);
  if (epoch) return new Date(Number(epoch[1]) * 1000).toISOString();
  const span = s.match(/(?:resets?|try again) in\s+(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?!s))?\s*(?:(\d+)\s*s)?/i);
  if (span && span.slice(1).some(Boolean)) {
    const [d, h, m, sec] = span.slice(1).map((x) => Number(x ?? 0));
    return new Date(now.getTime() + (((d * 24 + h) * 60 + m) * 60 + sec) * 1000).toISOString();
  }
  const at = s.match(/(?:resets?|try again)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!at) return null;
  let hour = Number(at[1]);
  const min = Number(at[2] ?? 0);
  const ampm = (at[3] ?? '').toLowerCase();
  if (hour > 23 || min > 59) return null;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  const when = new Date(now);
  when.setHours(hour, min, 0, 0);
  if (when <= now) when.setDate(when.getDate() + 1);
  return when.toISOString();
}
// What an error text of a CLI means. Only ever applied to an error, never to an answer: material about «límites» is
// not a usage limit.
function failureOf(engine, text) {
  const name = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' }[engine];
  const t = String(text ?? '');
  if (/not supported when using codex with a chatgpt account|not recognized as a known model|invalid model|model.{0,40}not (?:available|found|supported)/i.test(t)) {
    return new Failure(424, 'model', `${name} no acepta ese modelo con tu cuenta. Elige otro en Studium, o deja el que viene por defecto.`);
  }
  if (/not logged in|please run \/?login|log ?in again|authentication|unauthorized|invalid api key|oauth token/i.test(t)) {
    return new Failure(424, 'not-signed-in', `${name} no tiene una sesión iniciada. Ábrelo una vez en una terminal e inicia sesión.`);
  }
  if (/usage limit|limit reached|rate limit|quota (?:reached|exceeded)|too many requests|hit your .{0,20}limit/i.test(t)) {
    return new Failure(429, 'limit', `Tu suscripción de ${name} llegó a su límite de uso.`, resetOf(t));
  }
  return new Failure(502, 'failed', `${name} terminó con un error: ${lastLine(t) || 'sin detalle'}`);
}

/* ---------- the three CLIs ---------- */
const tierOf = (id) => (/opus/i.test(id) ? 'strong' : /flash-low|haiku|mini|nano|gpt-oss|lite/i.test(id) ? 'light' : 'mid');
const ENGINES = {
  claude: {
    name: 'Claude Code', reads: { pdf: true, images: true },
    async detect(b) {
      const auth = await runCli(b, ['auth', 'status'], { timeoutMs: 15000 }).catch(() => null);
      let info = null;
      try { info = JSON.parse(auth?.out ?? ''); } catch { /* an older Claude Code */ }
      const ready = info ? info.loggedIn === true : auth?.code === 0;
      return {
        ready, detail: ready ? `con tu sesión de ${info?.authMethod === 'claude.ai' ? 'claude.ai' : 'Claude'}` : 'sin sesión iniciada: abre claude una vez e inicia sesión',
        models: [
          { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'strong' },
          { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'mid' },
          { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', tier: 'light' },
        ],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      };
    },
    // Read-only: it may read the files of its folder and nothing else.
    async run(b, dir, body, names, timeoutMs) {
      const args = ['-p', prompt(names), '--output-format', 'json', '--allowedTools', 'Read',
        '--disallowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent'];
      if (body.model) args.push('--model', String(body.model));
      if (body.effort) args.push('--effort', String(body.effort));
      const r = await runCli(b, args, { cwd: dir, timeoutMs });
      let result = null;
      try { result = JSON.parse(r.out.trim()); } catch { /* not the JSON result */ }
      if (result && !result.is_error && result.subtype !== 'error' && typeof result.result === 'string') return result.result;
      throw failureOf('claude', result?.result || `${r.err}\n${r.out}`);
    },
  },
  codex: {
    name: 'Codex', reads: { pdf: false, images: true },
    async detect(b) {
      const r = await runCli(b, ['login', 'status'], { timeoutMs: 15000 }).catch(() => null);
      const said = `${r?.out ?? ''} ${r?.err ?? ''}`;
      const ready = /logged in/i.test(said) && !/not logged in/i.test(said);
      return {
        ready, detail: ready ? (/chatgpt/i.test(said) ? 'con tu cuenta de ChatGPT' : 'con tu cuenta') : 'sin sesión iniciada: escribe codex login',
        // The model and effort the student set in Codex; the account decides which models it accepts.
        models: [{ id: 'default', label: 'El modelo de tu Codex', tier: 'mid' }],
        efforts: ['low', 'medium', 'high'],
      };
    },
    async run(b, dir, body, names, timeoutMs) {
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-C', dir];
      if (body.model && body.model !== 'default') args.push('-m', String(body.model));
      if (body.effort) args.push('-c', `model_reasoning_effort=${String(body.effort).replace(/[^a-z]/g, '')}`);
      for (const n of names) if (/\.(png|jpe?g|webp|gif)$/i.test(n)) args.push('-i', path.join(dir, n));
      args.push('-');
      const r = await runCli(b, args, { cwd: dir, input: prompt(names), timeoutMs });
      let answer = ''; let error = '';
      for (const line of r.out.split(/\r?\n/)) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string') answer = e.item.text;
        if (e.type === 'turn.failed') error = e.error?.message ?? 'turn failed';
        if (e.type === 'error' && e.message && !/metadata/i.test(e.message)) error = e.message;
      }
      if (answer && !error) return answer;
      throw failureOf('codex', error || `${r.err}\n${r.out}`);
    },
  },
  antigravity: {
    name: 'Antigravity', reads: { pdf: false, images: false },
    async detect(b) {
      const r = await runCli(b, ['models'], { timeoutMs: 30000 }).catch(() => null);
      const models = String(r?.out ?? '').split(/\r?\n/).map((l) => l.split('\t')).filter((p) => p.length >= 2 && /^[\w.-]+$/.test(p[0].trim()))
        .map(([id, label]) => ({ id: id.trim(), label: label.trim(), tier: tierOf(id) }));
      return {
        ready: models.length > 0, detail: models.length ? 'lee texto; para fotos y escaneos usa otra IA' : 'sin modelos: abre agy una vez e inicia sesión',
        // The effort is part of each model's name («Flash (Low)»); agy refuses --effort for some models.
        models, efforts: [],
      };
    },
    async run(b, dir, body, names, timeoutMs) {
      const args = ['-p', prompt(names), '--output-format', 'json', '--mode', 'plan', '--sandbox'];
      if (body.model) args.push('--model', String(body.model));
      const r = await runCli(b, args, { cwd: dir, timeoutMs });
      let result = null;
      try { result = JSON.parse(r.out.trim()); } catch { /* not the JSON result */ }
      if (result?.status === 'SUCCESS' && typeof result.response === 'string') return result.response;
      throw failureOf('antigravity', result?.error || `${r.err}\n${r.out}`);
    },
  },
};

// What this computer has, read without spending the student's quota; kept for a minute.
let detected = null;
let detectedAt = 0;
async function detectAll() {
  if (detected && Date.now() - detectedAt < DETECT_CACHE_MS) return detected;
  detected = await Promise.all(Object.entries(ENGINES).map(async ([id, e]) => {
    const b = await bin(id === 'antigravity' ? 'agy' : id);
    const base = { id, name: e.name, reads: e.reads };
    if (!b) return { ...base, found: false, ready: false, detail: 'no está instalado en esta computadora', models: [], efforts: [] };
    try { return { ...base, found: true, ...(await e.detect(b)) }; } catch { return { ...base, found: true, ready: false, detail: 'no respondió', models: [], efforts: [] }; }
  }));
  detectedAt = Date.now();
  return detected;
}

/* ---------- one request at a time per CLI ---------- */
const lanes = new Map();
function inLane(id, fn) {
  const before = lanes.get(id) ?? Promise.resolve();
  const run = before.then(fn, fn);
  lanes.set(id, run.catch(() => {}));
  return run;
}
async function handleRun(body) {
  const engine = ENGINES[body.engine];
  if (!engine) throw new Failure(400, 'bad-request', 'Esa IA no existe en el puente.');
  const status = (await detectAll()).find((e) => e.id === body.engine);
  if (!status.found) throw new Failure(424, 'not-installed', `${engine.name} no está instalado en esta computadora.`);
  if (!status.ready) throw new Failure(424, 'not-signed-in', `${engine.name} no está listo: ${status.detail}.`);
  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || DEFAULT_TIMEOUT, 5000), MAX_TIMEOUT);
  const started = Date.now();
  const dir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
  try {
    const names = writeRun(dir, body);
    const text = await engine.run(await bin(body.engine === 'antigravity' ? 'agy' : body.engine), dir, body, names, timeoutMs);
    return { text, engine: body.engine, model: String(body.model ?? ''), effort: String(body.effort ?? ''), ms: Date.now() - started };
  } finally { removeFolder(dir); }
}

/* ---------- the server ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Failure(413, 'too-large', 'Esta parte es demasiado grande para el puente (más de 64 MB).')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new Failure(400, 'bad-request', 'El pedido llegó incompleto.')));
  });
}
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) return fail(res, new Failure(403, 'origin', 'El puente solo responde a Studium.'), null);
  const ok = origin || null;
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') { res.writeHead(204, ok ? cors(ok) : {}); return res.end(); }
  if (req.method === 'GET' && pathname === '/v1/hello') return send(res, 200, { name: NAME, version: VERSION }, ok);
  if (!tokenValid(req.headers.authorization)) return fail(res, new Failure(401, 'token', 'El código de enlace no coincide. Vuelve a enlazar el puente en Ajustes.'), ok);
  try {
    if (req.method === 'GET' && pathname === '/v1/status') return send(res, 200, { name: NAME, version: VERSION, engines: await detectAll() }, ok);
    if (req.method === 'POST' && pathname === '/v1/run') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch (e) { throw e instanceof Failure ? e : new Failure(400, 'bad-request', 'El pedido no es JSON.'); }
      if (!body || typeof body.engine !== 'string' || !ENGINES[body.engine]) throw new Failure(400, 'bad-request', 'Falta la IA que debe responder, o no existe en el puente.');
      return send(res, 200, await inLane(body.engine, () => handleRun(body)), ok);
    }
    throw new Failure(404, 'not-found', 'Esa dirección no existe en el puente.');
  } catch (e) {
    return fail(res, e instanceof Failure ? e : new Failure(502, 'failed', 'El puente tuvo un problema inesperado.'), ok);
  }
});

cleanOldFolders();
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${port} ya está ocupado: quizá el puente ya está abierto. Para usar otro, escribe node studium-bridge.mjs --port ${port + 1}` : e.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', async () => {
  console.log(`\nEl puente de Studium está abierto en este computador (puerto ${port}).\n`);
  for (const e of await detectAll()) console.log(`  ${e.ready ? '✓' : '·'} ${e.name}: ${e.ready ? `lista, ${e.detail}` : e.detail}`);
  console.log('\nPara enlazarlo, abre este enlace con tu sesión de Studium iniciada:');
  console.log(`  ${SITE}/studium/#/ajustes?puente=${port}.${TOKEN}`);
  if (dev) console.log(`  http://localhost:5173/studium/#/ajustes?puente=${port}.${TOKEN}`);
  console.log('\nDéjalo abierto mientras Studium usa tu IA. Al cerrar esta ventana, el puente se apaga.\n');
});
