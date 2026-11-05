// Small hints, now and then: a glass bubble in a corner that says one thing the person may not know («¿Sabías que…?»).
// Never in the focus ambience; in the serene one, later and without movement. At most two per visit, each hint once,
// only after the person has been on the page a while, and gone by itself. «No más pistas» turns them off.
// Also what the person has already seen (first-time suggestions), kept in this browser.
import { t } from './i18n.js';

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

// Each hint, and the pages where it makes sense ('' is the home page; '*' anywhere).
const HINTS = [
  { id: 'h-home', where: [''], text: '¿Sabías que puedes personalizar tu inicio? Agrega fechas, un bloc de notas o accesos rápidos con «Personalizar».' },
  { id: 'h-eggs', where: ['*'], text: '¿Sabías que Studium esconde algunos secretos? Toca las cosas pequeñas, o escribe alguna palabra mágica.' },
  { id: 'h-sub', where: ['guias', 'aportar'], text: '¿Sabías que puedes crear una guía con tu suscripción de Claude, ChatGPT o Gemini, sin clave?' },
  { id: 'h-bar', where: ['guias', 'guia'], text: 'En una guía, la flecha de la esquina oculta la barra de Studium, para leer a pantalla completa.' },
  { id: 'h-logo', where: ['', 'guias', 'mapa', 'profes'], text: 'El logo te lleva a la portada de Studium; «Inicio» es tu propio espacio.' },
  { id: 'h-calm', where: ['*'], text: 'Si algo se mueve demasiado, prueba el ambiente Sereno o Enfoque en Ajustes.' },
  { id: 'h-sound', where: ['*'], text: 'El parlante de arriba enciende sonidos de vidrio, suaves. Ninguno es obligatorio.' },
  { id: 'h-letters', where: ['bienvenida'], text: 'Las letras de «studium» se pueden arrastrar. Y lo que flota, también.' },
  { id: 'h-map', where: ['mapa'], text: 'En el mapa, cada punto es un concepto: púlsalo para ver qué lo explica y qué preguntan de él.' },
];

let shown = 0;
let timer = 0;
let lastShown = 0;
let bubble = null;
const page = () => location.hash.replace(/^#\/?/, '').split('/')[0];
const ambience = () => document.documentElement.dataset.ambience;

function pick() {
  const here = page();
  const done = read();
  return HINTS.find((h) => !done.has(h.id) && (h.where.includes('*') || h.where.includes(here)));
}
function close(mark) {
  if (!bubble) return;
  if (mark) markSeen(bubble.dataset.hint);
  const el = bubble;
  bubble = null;
  el.classList.add('out');
  setTimeout(() => el.remove(), 500);
}
function show() {
  if (bubble || shown >= 2 || !hintsOn() || ambience() === 'enfoque' || document.hidden) return;
  if (document.querySelector('dialog[open]') || document.getElementById('view-guide')?.hidden === false) return;
  const hint = pick();
  if (!hint) return;
  shown += 1; lastShown = Date.now();
  bubble = document.createElement('aside');
  bubble.className = `hint-bubble glass${ambience() === 'sereno' ? ' still' : ''}`;
  bubble.dataset.hint = hint.id;
  bubble.setAttribute('role', 'status');
  bubble.innerHTML = `<p></p><div class="actions"><button class="link" data-hint-ok>${t('Entendido')}</button><button class="link" data-hint-off>${t('No más pistas')}</button></div>`;
  bubble.querySelector('p').textContent = t(hint.text);
  document.body.append(bubble);
  bubble.querySelector('[data-hint-ok]').addEventListener('click', () => close(true));
  bubble.querySelector('[data-hint-off]').addEventListener('click', () => { setHints(false); close(true); });
  // Seen once it has been on screen; it leaves by itself.
  setTimeout(() => { if (bubble?.dataset.hint === hint.id) { markSeen(hint.id); close(false); } }, 14000);
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
  schedule();
}
