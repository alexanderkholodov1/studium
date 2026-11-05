// Small hints, now and then: a glass bubble next to the thing it talks about, with something the person may not know
// («¿Sabías que…?»). It appears and leaves with a soft animation, scrolls with the page, and points at its subject.
// Never in the focus ambience, and never when the admins turned hints off; in the serene one, later. At most two per
// visit, each hint once, only after the person has been on the page a while. «No más pistas» turns them off.
// Also what the person has already seen (first-time suggestions), kept in this browser.
import { t } from './i18n.js';
import { flag } from './settings.js';

const SEEN = 'studium-seen';
const OFF = 'studium-hints';
const read = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN) ?? '[]')); } catch { return new Set(); } };
export const seen = (key) => read().has(key);
export function markSeen(key) {
  const s = read(); s.add(key);
  try { localStorage.setItem(SEEN, JSON.stringify([...s].slice(-200))); } catch { /* not remembered */ }
}
export const hintsOn = () => { try { return localStorage.getItem(OFF) !== 'off'; } catch { return true; } };
export function setHints(on) { try { localStorage.setItem(OFF, on ? 'on' : 'off'); } catch { /* not remembered */ } }

// Each hint: the pages where it makes sense ('' is the home page), and the thing it points at. Only what is not
// obvious from the page itself.
const HINTS = [
  { id: 'h-home', where: [''], anchor: '#home-edit', text: '¿Sabías que tu inicio se arma a tu gusto? Fechas de entrega, tu semana, un bloc de notas, accesos rápidos…' },
  { id: 'h-sub', where: ['aportar'], anchor: '[data-chat="claude"]', text: '¿Sabías que puedes crear la guía con tu suscripción de Claude, ChatGPT o Gemini, sin ninguna clave?' },
  { id: 'h-folder', where: ['aportar'], anchor: '[data-ai-drop], .dropzone', text: '¿Sabías que puedes soltar una carpeta entera de apuntes, no solo un archivo?' },
  { id: 'h-bar', where: ['guias'], anchor: '.gcard', text: 'Dentro de una guía, la flecha de la esquina esconde la barra de Studium para leer a pantalla completa.' },
  { id: 'h-keys', where: ['ajustes'], anchor: '#set-ai', text: '¿Sabías que puedes conectar varias IA a la vez y elegir el modelo cada vez que la usas?' },
  { id: 'h-eggs', where: ['', 'guias', 'bienvenida'], anchor: '.brand', text: 'Studium esconde algunos secretos. Toca las cosas pequeñas, o escribe alguna palabra mágica.' },
  { id: 'h-letters', where: ['bienvenida'], anchor: '#wordmark', text: 'Las letras de «studium» se pueden arrastrar.' },
];

let shown = 0;
let timer = 0;
let lastShown = 0;
let bubble = null;
const page = () => location.hash.replace(/^#\/?/, '').split('/')[0];
const ambience = () => document.documentElement.dataset.ambience;
// The first element of the selector that is on screen now.
function visible(selector) {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height && r.bottom > 60 && r.top < innerHeight - 60 && el.closest('[hidden]') === null) return el;
  }
  return null;
}
function pick() {
  const here = page();
  const done = read();
  for (const h of HINTS) {
    if (done.has(h.id) || !h.where.includes(here)) continue;
    const anchor = visible(h.anchor);
    if (anchor) return { hint: h, anchor };
  }
  return null;
}
function close(mark) {
  if (!bubble) return;
  if (mark) markSeen(bubble.dataset.hint);
  const el = bubble;
  bubble = null;
  el.classList.add('out');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 900);
}
// Next to its subject, below it when there is room, above it otherwise; in page coordinates, so it scrolls with it.
function place(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth; const h = el.offsetHeight;
  const below = r.bottom + 14 + h < innerHeight;
  const x = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  const y = below ? r.bottom + 14 : r.top - h - 14;
  el.style.left = `${x + scrollX}px`;
  el.style.top = `${y + scrollY}px`;
  el.style.setProperty('--arrow', `${Math.max(18, Math.min(w - 18, r.left + r.width / 2 - x))}px`);
  el.classList.toggle('above', !below);
}
function show() {
  if (bubble || shown >= 2 || !hintsOn() || !flag('hints') || ambience() === 'enfoque' || document.hidden) return;
  if (document.querySelector('dialog[open]') || document.getElementById('view-guide')?.hidden === false) return;
  const found = pick();
  if (!found) return;
  const { hint, anchor } = found;
  shown += 1; lastShown = Date.now();
  bubble = document.createElement('aside');
  bubble.className = `hint-bubble glass${ambience() === 'sereno' ? ' still' : ''}`;
  bubble.dataset.hint = hint.id;
  bubble.setAttribute('role', 'status');
  bubble.innerHTML = `<p></p><div class="actions"><button class="link" data-hint-ok>${t('Entendido')}</button><button class="link" data-hint-off>${t('No más pistas')}</button></div>`;
  bubble.querySelector('p').textContent = t(hint.text);
  document.body.append(bubble);
  place(bubble, anchor);
  bubble.querySelector('[data-hint-ok]').addEventListener('click', () => close(true));
  bubble.querySelector('[data-hint-off]').addEventListener('click', () => { setHints(false); close(true); });
  // Seen once it has been on screen; it leaves by itself.
  setTimeout(() => { if (bubble?.dataset.hint === hint.id) { markSeen(hint.id); close(false); } }, 16000);
}
// Wait until the person has been on a page for a while, and leave several minutes between hints.
function schedule() {
  clearTimeout(timer);
  const wait = ambience() === 'sereno' ? 70000 : 35000;
  const gap = Math.max(0, lastShown + 240000 - Date.now());
  timer = setTimeout(show, Math.max(wait, gap));
}
export function mountHints() {
  addEventListener('hashchange', () => { close(false); schedule(); });
  addEventListener('resize', () => close(false));
  schedule();
}
