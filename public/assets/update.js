// «Studium recibió una nueva actualización»: a page left open does not run the new code until it is reloaded (his
// words, 2026-11-24: with frequent updates, people with the page open must be told to reload). Each deploy writes
// /studium/version.json (production: tools/pack.sh; the beta: tools/beta.mjs); the page reads it at start, every five
// minutes and when its tab comes back, and when it changes (or is not this page's version) it says so, with a button
// to reload. Locally there is no version.json, and nothing is said.
import { VERSION } from './config.js';

const SOURCE = new URL('/studium/version.json', location.origin);
let first = null;
let shown = false;
let last = 0;

async function check() {
  if (shown || Date.now() - last < 15_000) return;
  last = Date.now();
  let v;
  try {
    const r = await fetch(`${SOURCE.href}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    v = await r.json();
  } catch { return; }
  if (!v || typeof v.version !== 'string') return;
  const key = `${v.version}|${v.commit ?? ''}|${v.builtAt ?? ''}`;
  if (first === null) {
    first = key;
    if (v.version !== VERSION) show(v);
    return;
  }
  if (key !== first) show(v);
}

function show(v) {
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'alert');
  bar.innerHTML = `<p><b>Studium recibió una nueva actualización.</b> Recarga la página para usarla. <small>Si después de recargar sigue igual, pulsa Ctrl+Shift+R (en Mac, Cmd+Shift+R).</small></p>
    <p class="update-acts"><button type="button" class="button primary small" data-update-reload>Recargar ahora</button> <button type="button" class="button ghost small" data-update-later>Más tarde</button></p>`;
  bar.querySelector('[data-update-reload]').addEventListener('click', () => location.reload());
  bar.querySelector('[data-update-later]').addEventListener('click', () => bar.remove());
  bar.dataset.version = v.version;
  document.body.append(bar);
}

export function watchUpdates() {
  setTimeout(check, 8000);
  setInterval(() => { last = 0; check(); }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
