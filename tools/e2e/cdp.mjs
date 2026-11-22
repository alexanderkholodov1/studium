// A small Chrome DevTools Protocol driver: headless Chrome with its own profile, nothing downloaded.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export async function open({ port = 9333, width = 1463, height = 746, shots = '.' } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'studium-e2e-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60 && !list; i += 1) { await new Promise((r) => setTimeout(r, 250)); list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => null); }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { resolve, reject } = waiting.get(msg.id); waiting.delete(msg.id); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type.toUpperCase()} ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { id += 1; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const wait = async (cond, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(`return !!(${cond});`).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)); } throw new Error(`timed out waiting for ${cond}`); };
  const go = async (url) => { await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 800)); };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const file = path.join(shots, `${name}.png`); writeFileSync(file, Buffer.from(r.data, 'base64')); return file; };
  const setFiles = async (selector, files) => {
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no ${selector}`);
    await send('DOM.setFileInputFiles', { nodeId, files });
  };
  const close = () => { try { ws.close(); } catch { /* gone */ } chrome.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ } }, 1500); };
  return { send, js, wait, go, shot, setFiles, logs, close };
}
