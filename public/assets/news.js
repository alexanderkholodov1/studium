// «Novedades»: what each version brought, from data/changelog.json (the same text as the GitHub release notes). The
// current version in full; the earlier ones folded. After an update, «Novedades de la vX» once, in this browser.
import { VERSION } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SEEN = 'studium-news-seen';
let log = null;
async function load() {
  if (log) return log;
  // From the mount's root, not from this file: a release moves the assets into assets/<version>/ (tools/pack.sh).
  const r = await fetch(import.meta.url.replace(/\/assets\/.*$/, '/data/changelog.json'), { cache: 'no-cache' });
  log = await r.json();
  return log;
}
const date = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : 'en camino');
const list = (title, items, cls) => (items?.length ? `<h3 class="${cls}">${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
const entry = (v) => `<header><span class="news-v">v${esc(v.version)}</span><span class="news-date">${esc(date(v.date))}</span></header>
  ${v.title ? `<h2>${esc(v.title)}</h2>` : ''}${list('Nuevo', v.new, 'n')}${list('Mejoras', v.improved, 'm')}${list('Arreglos', v.fixed, 'a')}`;

export async function renderNews(el) {
  el.innerHTML = '<p class="status">Cargando las novedades…</p>';
  try {
    const { versions, earlier, about } = await load();
    const [now, ...before] = versions;
    el.innerHTML = `<p class="lede-small">${esc(about)}</p>
      <article class="news-entry glass">${entry(now)}</article>
      ${before.length ? `<details class="news-older"><summary>Versiones anteriores</summary>${before.map((v) => `<article class="news-entry">${entry(v)}</article>`).join('')}${earlier ? `<p class="fine">${esc(earlier)}</p>` : ''}</details>` : ''}`;
  } catch {
    el.innerHTML = '<p class="status">No se pudieron cargar las novedades. Revisa tu conexión.</p>';
  }
}

// Once per version, in this browser: a short card with what is new, and a link to the whole page.
export async function newsOnce() {
  let seen = '';
  try { seen = localStorage.getItem(SEEN) ?? ''; } catch { return; }
  if (seen === VERSION) return;
  try { localStorage.setItem(SEEN, VERSION); } catch { return; }
  // Someone new does not need «what changed»: only those who had used an earlier version.
  if (!seen && !localStorage.getItem('studium-recent') && !localStorage.getItem('studium-seen')) return;
  try {
    const { versions } = await load();
    const v = versions.find((x) => x.version === VERSION);
    if (!v?.new?.length) return;
    const d = document.createElement('dialog');
    d.className = 'sheet-dialog news-dialog';
    d.innerHTML = `<h2>Novedades de la v${esc(v.version)}</h2>${v.title ? `<p class="lede-small">${esc(v.title)}</p>` : ''}
      <ul>${v.new.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="actions"><a class="button ghost" href="#/novedades">Ver todo</a><button class="button primary" type="button" data-close>Listo</button></div>`;
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target.closest('[data-close], a') || e.target === d) d.close(); });
    d.addEventListener('close', () => d.remove());
    d.showModal();
  } catch { /* the page works without it */ }
}
