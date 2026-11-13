// Tests the local bridge (public/assets/bridge.mjs) with fake CLIs, never the real ones: on Windows they are .cmd
// shims, as npm installs them, so the shim resolution is tested too. Each fake writes what it received (arguments,
// working folder, input, the files of its folder) to a log, so the tests see exactly how the bridge called it.
// node tools/test-bridge.mjs
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const WIN = platform() === 'win32';
const BRIDGE = path.resolve('public/assets/bridge.mjs');
const PORT = 42000 + Math.floor(Math.random() * 2000);
const SITE = 'https://alexanderkholodov.web.app';
const results = [];
const check = (cond, what) => { if (!cond) throw new Error(what); };

/* ---------- fake CLIs ---------- */
const fakes = mkdtempSync(path.join(tmpdir(), 'bridge-fakes-'));
const log = path.join(fakes, 'calls.jsonl');
// Every fake: records its call, then behaves as the scenario file says (scenario.json, rewritten by each test).
const common = `
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
const args = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(${JSON.stringify(path.join(fakes, 'scenario.json'))}, 'utf8'));
let input = '';
const record = () => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cli: CLI, args, cwd: process.cwd(), input, files: readdirSync(process.cwd()), instructions: (() => { try { return readFileSync('INSTRUCCIONES.md', 'utf8'); } catch { return ''; } })() }) + '\\n');
const s = scenario[CLI] ?? {};
const out = (x) => process.stdout.write(typeof x === 'string' ? x : JSON.stringify(x));
`;
const scripts = {
  claude: `const CLI = 'claude';${common}
if (args[0] === 'auth') { out({ loggedIn: s.signedIn !== false, authMethod: 'claude.ai' }); process.exit(0); }
record();
if (s.sleep) { setTimeout(() => {}, s.sleep); } else {
  if (s.limit) { out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1894614400' }); process.exit(1); }
  out({ type: 'result', subtype: 'success', is_error: false, result: s.answer ?? 'respuesta de claude' }); process.exit(0);
}`,
  codex: `const CLI = 'codex';${common}
if (args[0] === 'login') { process.stderr.write(s.signedIn === false ? 'Not logged in\\n' : 'Logged in using ChatGPT\\n'); process.exit(s.signedIn === false ? 1 : 0); }
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  record();
  out({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Model metadata for x not found.' } }); out('\\n');
  if (s.refuse) { out({ type: 'turn.failed', error: { message: "The 'x' model is not supported when using Codex with a ChatGPT account." } }); process.exit(1); }
  out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: s.answer ?? 'respuesta de codex' } }); out('\\n');
  out({ type: 'turn.completed' }); process.exit(0);
});`,
  agy: `const CLI = 'agy';${common}
if (args[0] === 'models') { process.stderr.write('Fetching available models...\\n'); out('gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)\\nclaude-opus-4-6-thinking\\tClaude Opus 4.6 (Thinking)\\n'); process.exit(0); }
record();
if (s.quota) { out({ status: 'ERROR', response: '', error: 'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 68h22m9s.' }); process.exit(3); }
out({ status: 'SUCCESS', response: s.answer ?? 'respuesta de antigravity' }); process.exit(0);`,
};
for (const [name, body] of Object.entries(scripts)) {
  const impl = path.join(fakes, `${name}-impl.mjs`);
  writeFileSync(impl, body);
  if (WIN) writeFileSync(path.join(fakes, `${name}.cmd`), `@ECHO off\r\nnode "${impl}" %*\r\n`);
  else { const p = path.join(fakes, name); writeFileSync(p, `#!/bin/sh\nexec node "${impl}" "$@"\n`); chmodSync(p, 0o755); }
}
const scenario = (s) => { writeFileSync(path.join(fakes, 'scenario.json'), JSON.stringify(s)); rmSync(log, { force: true }); };
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/* ---------- the bridge ---------- */
// The fakes must have a scenario before the bridge first looks at them.
scenario({});
const home = mkdtempSync(path.join(tmpdir(), 'bridge-home-'));
const temp = mkdtempSync(path.join(tmpdir(), 'bridge-temp-'));
// Only the fakes on the PATH (plus the folder of node itself), so a real CLI can never be called.
const PATH = [fakes, path.dirname(process.execPath), ...(WIN ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'])].join(path.delimiter);
const env = { ...process.env, PATH, Path: PATH, HOME: home, USERPROFILE: home, TMPDIR: temp, TEMP: temp, TMP: temp };
let printed = '';
const bridge = spawn(process.execPath, [BRIDGE, '--port', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
bridge.stdout.on('data', (d) => { printed += d; });
bridge.stderr.on('data', (d) => { printed += d; });
const token = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`the bridge did not start:\n${printed}`)), 20000);
  const look = () => { const m = printed.match(/puente=\d+\.([\w-]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } };
  bridge.stdout.on('data', look);
  bridge.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the bridge exited (${code}):\n${printed}`)); });
});

function call(method, url, { body, auth = token, origin = SITE, raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${auth}`;
    if (origin) headers.origin = origin;
    const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
    if (payload) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString(); let data = t; try { data = JSON.parse(t); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, data }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const run = (body, opts) => call('POST', '/v1/run', { body: { system: 'Instrucciones de Studium', text: 'Procesa el material', files: [], ...body }, ...opts });
const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');
const leftovers = () => readdirSync(temp).filter((n) => n.startsWith('studium-run-'));

async function test(name, fn) {
  try { await fn(); results.push([true, name]); } catch (e) { results.push([false, `${name}: ${e.message}`]); }
}

await test('it prints a pairing link and keeps the code in the home folder', async () => {
  check(printed.includes(`${SITE}/studium/#/ajustes?puente=${PORT}.${token}`), 'no pairing link');
  check(JSON.parse(readFileSync(path.join(home, '.studium-bridge.json'), 'utf8')).token === token, 'code not kept');
});
await test('hello answers without the code, with CORS for Studium', async () => {
  const r = await call('GET', '/v1/hello', { auth: null });
  check(r.status === 200 && r.data.name === 'studium-bridge', `status ${r.status}`);
  check(r.headers['access-control-allow-origin'] === SITE, 'no CORS header');
});
await test('another origin is refused, without CORS headers', async () => {
  const r = await call('GET', '/v1/status', { origin: 'https://evil.example' });
  check(r.status === 403 && r.data.error.code === 'origin', `status ${r.status}`);
  check(!r.headers['access-control-allow-origin'], 'CORS header leaked');
  const pre = await call('OPTIONS', '/v1/run', { origin: 'https://studium101.web.app.evil.example' });
  check(pre.status === 403, `preflight ${pre.status}`);
});
await test('a preview channel and the local preview are allowed', async () => {
  for (const origin of ['https://studium101--v0-6-0-abc123.web.app', 'http://localhost:5173']) {
    const r = await call('GET', '/v1/hello', { origin, auth: null });
    check(r.headers['access-control-allow-origin'] === origin, origin);
  }
});
await test('the preflight says what Chrome needs', async () => {
  const r = await call('OPTIONS', '/v1/run', { auth: null });
  check(r.status === 204, `status ${r.status}`);
  check(r.headers['access-control-allow-private-network'] === 'true', 'no private-network header');
  check(/authorization/.test(r.headers['access-control-allow-headers']), 'authorization not allowed');
});
await test('a wrong or missing code is refused', async () => {
  check((await call('GET', '/v1/status', { auth: 'x'.repeat(43) })).status === 401, 'wrong code');
  check((await call('GET', '/v1/status', { auth: null })).status === 401, 'missing code');
});
await test('status lists the three CLIs, signed in, without calling a model', async () => {
  scenario({});
  const r = await call('GET', '/v1/status');
  const by = Object.fromEntries(r.data.engines.map((e) => [e.id, e]));
  check(by.claude.ready && by.claude.reads.pdf && by.claude.models.length === 3, 'claude');
  check(by.codex.ready && !by.codex.reads.pdf && by.codex.models[0].id === 'default', 'codex');
  check(by.antigravity.ready && by.antigravity.models.some((m) => m.id === 'claude-opus-4-6-thinking' && m.tier === 'strong'), 'antigravity models');
  check(by.antigravity.efforts.length === 0, 'antigravity must not take --effort');
  check(calls().length === 0, 'a model was called during detection');
});
await test('claude runs read-only in a folder with the material and the instructions', async () => {
  scenario({ claude: { answer: '{"concepts":[]}' } });
  const r = await run({ engine: 'claude', model: 'claude-haiku-5-5', effort: 'low', files: [{ name: 'examen.pdf', type: 'application/pdf', data: pdf }, { name: 'notas.txt', type: 'text/plain', text: 'hola' }] });
  check(r.status === 200 && r.data.text === '{"concepts":[]}', JSON.stringify(r.data));
  const [c] = calls();
  check(c.files.includes('examen.pdf') && c.files.includes('notas.txt') && c.files.includes('INSTRUCCIONES.md'), c.files.join());
  check(c.instructions.includes('Instrucciones de Studium') && c.instructions.includes('Procesa el material'), 'instructions');
  check(c.args.includes('--allowedTools') && c.args[c.args.indexOf('--allowedTools') + 1] === 'Read', 'Read only');
  for (const tool of ['Bash', 'Edit', 'Write', 'WebFetch']) check(c.args.includes(tool), `${tool} not disallowed`);
  check(c.args.includes('claude-haiku-5-5') && c.args.includes('low'), 'model or effort');
  check(!c.args.includes('--bare'), '--bare breaks macOS sign-in');
  check(leftovers().length === 0, 'folder left behind');
});
await test('an answer that talks about limits is an answer, not a usage limit', async () => {
  scenario({ claude: { answer: 'El límite de una función: usage limit reached en la nota del profe' } });
  const r = await run({ engine: 'claude' });
  check(r.status === 200, `status ${r.status}: ${JSON.stringify(r.data)}`);
});
await test('a usage limit of Claude is a 429 with its reset time', async () => {
  scenario({ claude: { limit: true } });
  const r = await run({ engine: 'claude' });
  check(r.status === 429 && r.data.error.code === 'limit', `status ${r.status}`);
  check(r.data.error.resetsAt === new Date(1894614400 * 1000).toISOString(), `resetsAt ${r.data.error.resetsAt}`);
  check(leftovers().length === 0, 'folder left behind');
});
await test('codex gets its prompt on stdin, pictures with -i, and its answer is read from the events', async () => {
  scenario({ codex: { answer: 'respuesta' } });
  const img = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const r = await run({ engine: 'codex', model: 'default', effort: 'medium', files: [{ name: 'hoja 1.png', type: 'image/png', data: img }] });
  check(r.status === 200 && r.data.text === 'respuesta', JSON.stringify(r.data));
  const [c] = calls();
  check(c.input.includes('INSTRUCCIONES.md'), 'prompt not on stdin');
  check(c.args.includes('-i') && c.args.some((a) => a.endsWith('hoja 1.png')), 'picture not attached');
  check(!c.args.includes('-m'), 'the default model must not be forced');
  check(c.args.includes('read-only'), 'not read-only');
});
await test('a model the ChatGPT account refuses is a 424', async () => {
  scenario({ codex: { refuse: true } });
  const r = await run({ engine: 'codex', model: 'gpt-x' });
  check(r.status === 424 && r.data.error.code === 'model', `status ${r.status}: ${JSON.stringify(r.data)}`);
});
await test('antigravity runs in plan mode, without --effort', async () => {
  scenario({});
  const r = await run({ engine: 'antigravity', model: 'gemini-3.8-flash-low', effort: 'high' });
  check(r.status === 200 && r.data.text === 'respuesta de antigravity', JSON.stringify(r.data));
  const [c] = calls();
  check(c.args.includes('plan') && !c.args.includes('--effort'), c.args.join(' '));
});
await test('the quota of Antigravity is a 429 that resets in 68 hours', async () => {
  scenario({ agy: { quota: true } });
  const r = await run({ engine: 'antigravity' });
  check(r.status === 429, `status ${r.status}`);
  const hours = (Date.parse(r.data.error.resetsAt) - Date.now()) / 3600000;
  check(hours > 68 && hours < 68.5, `resets in ${hours} h`);
});
await test('a hostile file name stays inside the folder', async () => {
  scenario({});
  const names = ['../../escape.txt', '..\\..\\escape2.txt', 'CON', 'a:b?.txt', '', 'INSTRUCCIONES.md'];
  const r = await run({ engine: 'claude', files: names.map((name) => ({ name, type: 'text/plain', text: 'x' })) });
  check(r.status === 200, `status ${r.status}`);
  const [c] = calls();
  check(c.files.length === names.length + 1, `files ${c.files.join(' | ')}`);
  check(c.files.every((f) => !f.includes('..') && !/[\\/:?]/.test(f)), c.files.join(' | '));
  check(c.instructions.includes('Instrucciones de Studium'), 'a file overwrote the instructions');
  check(!existsSync(path.join(temp, 'escape.txt')) && !existsSync(path.join(path.dirname(temp), 'escape.txt')), 'escaped');
});
await test('a timeout ends the CLI and answers 504', async () => {
  scenario({ claude: { sleep: 60000 } });
  const r = await run({ engine: 'claude', timeoutMs: 5000 });
  check(r.status === 504 && r.data.error.code === 'timeout', `status ${r.status}`);
  check(leftovers().length === 0, 'folder left behind');
});
await test('two runs at once take turns', async () => {
  scenario({});
  const [a, b] = await Promise.all([run({ engine: 'claude' }), run({ engine: 'claude' })]);
  check(a.status === 200 && b.status === 200, `${a.status} ${b.status}`);
  check(calls().length === 2, 'both ran');
});
await test('a body over 64 MB, a malformed body and an unknown CLI are refused', async () => {
  const big = await call('POST', '/v1/run', { raw: `{"engine":"claude","text":"${'x'.repeat(65 * 1024 * 1024)}"}` }).catch((e) => ({ status: 413, error: e }));
  check(big.status === 413, `big ${big.status}`);
  check((await call('POST', '/v1/run', { raw: '{nope' })).status === 400, 'malformed');
  check((await run({ engine: 'gemini-cli' })).status === 400, 'unknown CLI');
});
await test('a CLI that is not signed in is a 424 before any run', async () => {
  scenario({ codex: { signedIn: false } });
  // The detection is kept for a minute: a new bridge reads it fresh.
  const fresh = spawn(process.execPath, [BRIDGE, '--port', String(PORT + 1)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve) => { fresh.stdout.on('data', (d) => { if (/puente=/.test(String(d))) resolve(); }); });
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: PORT + 1, path: '/v1/run', method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
        let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(t) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ engine: 'codex', text: 'x' }));
    });
    check(r.status === 424 && r.data.error.code === 'not-signed-in', `status ${r.status}`);
    check(calls().length === 0, 'it ran anyway');
  } finally { fresh.kill(); }
});

bridge.kill();
for (const dir of [fakes, home, temp]) rmSync(dir, { recursive: true, force: true });
for (const [ok, name] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
