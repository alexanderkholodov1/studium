// Prepares a guide for the viewer's sandboxed frame. Every guide runs under the same content policy: its own inline
// code and styles, libraries and fonts from the public CDNs the guide instructions allow, and no form submissions.
// The frame has no persistent storage, so guides that save progress get an in-memory store for the visit.

const CDNS = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com';
export const POLICY = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDNS}`,
  `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
  `font-src data: ${CDNS} https://fonts.gstatic.com`,
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  `connect-src ${CDNS}`,
  'worker-src blob:',
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const HELPER = `<script>(() => {
  const memory = () => { const m = new Map(); return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear() }; };
  for (const name of ['localStorage', 'sessionStorage']) {
    try { window[name].length; } catch { try { Object.defineProperty(window, name, { value: memory(), configurable: true }); } catch {} }
  }
  addEventListener('click', (event) => {
    const link = event.target instanceof Element && event.target.closest('a[href]');
    if (!link || link.target || (link.getAttribute('href') || '').startsWith('#')) return;
    link.target = '_blank'; link.rel = 'noopener';
  }, true);
  addEventListener('message', (event) => {
    if (event.source !== parent || typeof event.data?.studiumAnchor !== 'string') return;
    const target = document.getElementById(event.data.studiumAnchor);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();</script>`;

// The policy and the helper go first, before anything of the guide, under the guide's own doctype.
export function prepareGuide(html) {
  const rest = String(html).replace(/^﻿?\s*<!doctype[^>]*>/i, '');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}">${HELPER}${rest}`;
}

export function showAnchor(frame, anchor) {
  if (!anchor) return;
  const send = () => frame.contentWindow?.postMessage({ studiumAnchor: anchor }, '*');
  send();
  setTimeout(send, 400);
}
