// «Trabajos»: a group assignment solved with a guide. The statement and the rubric become, with the person's own AI, a
// solution guide that reaches the final deliverable, split in parts (Persona A, B, C…) and written so that every
// member writes and understands each line. It reads like a study guide, top to bottom, one chapter after another
// (rules/one-path-step-by-step in caspian-kb): no tabs, no forms. A new trabajo is a short conversation, one question
// per screen. Each step ends with two quiet checks («Lo hice», «Lo entiendo») and «No lo entiendo», which the person's
// quick AI answers at once (no chat between members). GitHub marks a step done from a commit that names it; at the end
// the group downloads the citation of how AI was used.
// Data (firestore.rules, «Trabajos»): trabajos/{tid} with miembros, partes, hitos, avance and ia; misTrabajos/{uid}.
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, serverTimestamp, Bytes,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db, auth, gzip, gunzip, loadProfile } from './data.js';
import * as ai from './ai.js';
import { prepare } from './files.js';
import * as amigos from './amigos.js';
import { reunionSection, wireReunion, resetReunion } from './reunion.js';
import { bridgeSteps, pairBridge, findBridgeSay } from './space.js';
import { LETTERS, outlinePrompt, milestonePrompt, wholePrompt, adjustPrompt, ADJUST_KINDS, TUTOR, parseJSON, cleanOutline, cleanMilestone } from './trabajo-prompts.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => auth.currentUser?.uid ?? '';
const tRef = (tid, ...rest) => doc(db, 'trabajos', tid, ...rest);
const pack = async (value) => Bytes.fromUint8Array(await gzip(typeof value === 'string' ? value : JSON.stringify(value)));
const unpack = async (bytes) => (bytes ? gunzip(bytes.toUint8Array()) : '');
const COLORS = ['var(--blue)', 'var(--red)', 'var(--teal)', 'var(--butter)', 'var(--sky)', 'var(--peach)', 'var(--blue-2)', 'var(--red-2)'];
const colorOf = (letter) => COLORS[Math.max(0, LETTERS.indexOf(letter))];
const MAX_LOG = 150;
const MAX_PROMPT = 3000;
// GitHub's token prefixes, built so that no token-looking text sits in the code (tools/check.mjs looks for keys).
const PAT = ['github', 'pat', ''].join('_');
const CLASSIC = ['gh', 'p_'].join('');

let ctx = null;
let root = null;
// The trabajo open now, and how it is being read.
let T = null;
let onlyMine = false;
const asking = new Map();
// A new trabajo, one question at a time.
let draft = null;

/* ---------- a little formatting, always escaped first ---------- */
// Terms of the glossary get their definition on hover, the first time they appear in each paragraph.
let terms = [];
function withTerms(html) {
  let out = html;
  const low = html.toLowerCase();
  for (const g of terms) {
    if (!low.includes(g.low)) continue;
    out = out.replace(g.rx, (m, pre, word) => `${pre}<dfn title="${g.def}">${word}</dfn>`);
  }
  return out;
}
let termsOf = null;
function prepareTerms() {
  if (termsOf === T.outline) return;
  termsOf = T.outline;
  terms = (T.outline?.glosario ?? []).filter((g) => g.termino.length > 2).map((g) => ({
    low: g.termino.toLowerCase(), def: esc(g.definicion),
    rx: new RegExp(`(^|[^\\wáéíóúñ])(${g.termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^\\wáéíóúñ]|$)`, 'i'),
  }));
}
function inline(s) {
  return String(s).split('`').map((part, i) => (i % 2 ? `<code>${esc(part)}</code>` : withTerms(esc(part).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')))).join('');
}
function md(text) {
  const blocks = String(text ?? '').split(/```/);
  return blocks.map((b, i) => {
    if (i % 2) return `<pre class="tj-pre"><code>${esc(b.replace(/^[a-z]*\n/, ''))}</code></pre>`;
    return b.split(/\n{2,}/).map((para) => {
      const lines = para.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      if (lines.every((l) => /^\s*[-*]\s/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const bar = (p, color = 'var(--teal)') => `<span class="tj-bar" style="--tj-p:${p}%;--tj-c:${color}"><i></i></span>`;
const lower = (s) => { const t = String(s ?? '').trim(); return t ? t[0].toLowerCase() + t.slice(1) : ''; };

/* ---------- data ---------- */
async function myIds() {
  const s = await getDoc(doc(db, 'misTrabajos', uid())).catch(() => null);
  return s?.exists() ? s.data().ids ?? [] : [];
}
async function keepIds(ids) {
  await setDoc(doc(db, 'misTrabajos', uid()), { ids: [...new Set(ids)].slice(0, 60), updated: serverTimestamp() });
}
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const madeBy = (r) => ({ provider: ['anthropic', 'openai', 'gemini'].includes(r.provider) ? r.provider : 'other', model: String(r.model ?? '').slice(0, 80), effort: ['', 'low', 'medium', 'high', 'xhigh'].includes(r.effort) ? r.effort : '' });

async function loadTrabajo(tid) {
  const snap = await getDoc(tRef(tid));
  if (!snap.exists()) return null;
  const d = snap.data();
  const [members, parts, hitos, avance, ia] = await Promise.all(['miembros', 'partes', 'hitos', 'avance', 'ia'].map((c) => getDocs(collection(db, 'trabajos', tid, c))));
  const t = {
    id: tid, viewer: uid(), ...d, statement: await unpack(d.statement), outline: d.outline ? JSON.parse(await unpack(d.outline)) : null,
    members: members.docs.map((m) => ({ uid: m.id, name: m.data().name })),
    taken: Object.fromEntries(parts.docs.map((p) => [p.id, p.data().uid])),
    hitos: {}, avance: {}, ia: {},
  };
  for (const h of hitos.docs) { try { t.hitos[h.id] = { ...JSON.parse(await unpack(h.data().data)), by: h.data().by, ai: h.data().ai }; } catch { /* unreadable: written again */ } }
  for (const a of avance.docs) t.avance[a.id] = a.data().steps ?? {};
  for (const l of ia.docs) t.ia[l.id] = l.data().log ?? [];
  return t;
}
async function saveAvance() {
  await setDoc(tRef(T.id, 'avance', uid()), { steps: T.avance[uid()] ?? {}, updated: serverTimestamp() });
}
async function logAI(entry) {
  const log = [...(T.ia[uid()] ?? []), { at: new Date().toISOString(), ...entry, prompt: String(entry.prompt ?? '').slice(0, MAX_PROMPT) }].slice(-MAX_LOG);
  T.ia[uid()] = log;
  await setDoc(tRef(T.id, 'ia', uid()), { log, updated: serverTimestamp() }).catch((e) => console.warn('ia log', e));
}

/* ---------- the person's AI, for this situation ---------- */
// What is needed depends on the trabajo and on what was brought, never a fixed «use a strong AI»: a few pages of text
// go with any AI (the free Gemini key is enough); PDFs and photos need one that reads them; a ZIP, code, a notebook or
// many files are read best on the person's own computer, through the bridge, in the folder of the trabajo.
const NAMES = { gemini: 'Gemini (gratis)', anthropic: 'Claude', openai: 'ChatGPT', otras: 'OpenRouter o Puter' };
function sizeText(n) { return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`; }
function analyze(files, text, kept = 0) {
  const k = { text: 0, pdf: 0, image: 0, office: 0, archive: 0, code: 0, other: 0 };
  let size = text.length + kept;
  for (const f of files) {
    size += f.size;
    const e = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
    if (e === 'pdf') k.pdf += 1;
    else if (/^(png|jpe?g|webp|gif|bmp)$/.test(e)) k.image += 1;
    else if (/^(docx|pptx|xlsx|odt|odp|ods|epub)$/.test(e)) k.office += 1;
    else if (/^(zip|rar|7z|tar|gz)$/.test(e)) k.archive += 1;
    else if (/^(ipynb|py|java|c|cpp|h|js|ts|r|m|sql|pkt|pka|pcap|pcapng)$/.test(e)) k.code += 1;
    else if (/^(txt|md|csv|json|html?)$/.test(e)) k.text += 1;
    else k.other += 1;
  }
  return { k, size, count: files.length + (text || kept ? 1 : 0) };
}
// The options for this situation, the recommended one first, each with why.
function options(an) {
  const { k, size, count } = an;
  const heavy = k.archive || k.code || k.other || count > 10 || size > 25e6;
  const reads = k.pdf || k.image || k.office;
  const bridge = { id: 'bridge', name: 'Trabajar en tu computadora', how: 'Con tu Claude o tu ChatGPT, por el puente de Studium, en la carpeta del trabajo.', vendor: 'anthropic', bridge: true,
    why: heavy ? 'Trajiste archivos comprimidos, código o muchos archivos: tu IA los lee mejor ahí mismo, en tu computadora, sin subirlos.' : 'Usa tu suscripción, sin pagar por uso, y lee tus archivos tal como son.' };
  const gemini = { id: 'gemini', name: 'Gemini, gratis', how: 'Con una clave gratis de Google, en un minuto.', vendor: 'gemini',
    why: reads ? 'Lee PDF y fotos, y para un enunciado de pocas páginas alcanza.' : 'Para un enunciado de texto alcanza, y no cuesta nada.' };
  const claude = { id: 'anthropic', name: 'Claude', how: 'Con tu cuenta de Claude: el puente o, si la tienes, una clave.', vendor: 'anthropic', bridge: true,
    why: 'Lee los PDF tal como son, con sus tablas y figuras.' };
  if (heavy) return [bridge, claude, gemini];
  if (reads && size > 8e6) return [claude, bridge, gemini];
  return [gemini, claude, bridge];
}
// Every way to connect an AI, as the settings offer them: the suggested one is marked, the connected ones say so.
const ALL_WAYS = [
  { key: 'bridge', name: 'Tu computadora, por el puente', note: 'Claude Code, Codex o Antigravity, con tu suscripción', vendor: 'anthropic', bridge: true, is: (w) => w.startsWith('bridge:') },
  { key: 'gemini', name: 'Gemini', note: 'gratis, con una clave de Google', vendor: 'gemini', is: (w) => w === 'gemini' },
  { key: 'anthropic', name: 'Claude, con clave', note: 'pagas por uso en tu cuenta de Anthropic', vendor: 'anthropic', is: (w) => w === 'anthropic' },
  { key: 'openai', name: 'ChatGPT, con clave', note: 'pagas por uso en tu cuenta de OpenAI', vendor: 'openai', is: (w) => w === 'openai' },
  { key: 'openrouter', name: 'OpenRouter', note: 'modelos gratis de varias empresas', vendor: 'otras', is: (w) => w === 'openrouter' },
  { key: 'puter', name: 'Puter', note: 'con tu cuenta de Puter', vendor: 'otras', is: (w) => w === 'puter' },
];
function allWays(best) {
  const now = ai.connected();
  const sugg = best.id === 'bridge' ? 'bridge' : best.id;
  return `<div class="tj-ways" id="tj-ways"><h3>Todas las formas de conectar tu IA</h3><div class="tj-ways-grid">${ALL_WAYS.map((w) => {
    const on = now.some(w.is);
    const btn = on ? '<span class="tj-ok">Conectada ✓</span>' : w.bridge ? '<button type="button" class="button ghost small" data-tj="pair-here">Conectar</button>'
      : `<button type="button" class="button ghost small" data-tj="connect" data-vendor="${w.vendor}">Conectar</button>`;
    return `<div class="tj-way ${w.key === sugg ? 'sugg' : ''} ${on ? 'on' : ''}"><b>${esc(w.name)}${w.key === sugg ? ' <em>sugerida</em>' : ''}</b><small>${esc(w.note)}</small>${btn}</div>`;
  }).join('')}</div></div>`;
}
const usable = (o) => (o.bridge ? ai.connected().some((w) => w.startsWith('bridge:')) : o.vendor === 'gemini' ? ai.connected().includes('gemini') : ai.connected().some((w) => w === o.vendor || w === (o.vendor === 'anthropic' ? 'bridge:claude' : 'bridge:codex')));
function aiLine(task) {
  if (!ai.ready()) return `<p class="fine">Todavía no conectaste una IA. <button type="button" class="link" data-tj="connect" data-vendor="${task === 'tutor' ? 'gemini' : 'anthropic'}" data-bridge="${task === 'tutor' ? '' : '1'}">Conectar ${task === 'tutor' ? 'Gemini, gratis' : 'tu Claude'}</button></p>`;
  return ai.pickerHTML(task);
}
// «Detener»: every request of the guide listens to one switch, which the button of the live view turns off. Stopping
// closes the request; the bridge then stops the AI (or closes Claude Code's window).
let ctl = null;
const stopped = () => !!ctl?.signal.aborted;
function startWork() { ctl = new AbortController(); return ctl; }
async function askAI(task, system, text, files = [], label = '', live = null) {
  // The trabajo's own folder, when its writer is Claude through the bridge.
  const folder = task === 'solution' && T && ai.choice(task).provider === 'bridge:claude' ? folderOf(T.id) : '';
  try {
    return await ai.run({ system, text, files, task, label, folder, signal: task === 'solution' ? ctl?.signal : undefined, maxTokens: task === 'solution' ? ai.longest(ai.choice(task)) : 4000, onEvent: live?.onEvent, onProgress: live?.onProgress });
  } finally { live?.stop(); }
}
// «Conectar» opens exactly the recommended option in the settings, and the answers given so far wait here.
async function connectWay(vendor, bridge) {
  try { sessionStorage.setItem('studium-return', location.hash); } catch { /* back by hand */ }
  try { localStorage.setItem('studium-ai-vendor', vendor); } catch { /* the settings open on their default */ }
  location.hash = '#/ajustes';
  for (let i = 0; i < 40 && !document.querySelector('#set-ai'); i += 1) await new Promise((r) => setTimeout(r, 100));
  const target = bridge ? document.querySelector('#set-ai .ai-advanced') : document.querySelector('#set-ai .ai-panel');
  if (!target) return;
  if (bridge) target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.add('tj-glow');
  setTimeout(() => target.classList.remove('tj-glow'), 2600);
  ctx.toast('Cuando termines, vuelve a «Trabajos»: tus respuestas siguen ahí.');
}

// While the computer's own folder window is open, the page says so in large, for everyone to see at once.
function pickingNotice() {
  const el = document.createElement('div');
  el.className = 'tj-picking'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-live', 'assertive');
  el.innerHTML = `<div class="tj-picking-card glass"><div class="tj-picking-icon" aria-hidden="true">📁</div>
    <h2>Elige la carpeta en la ventana de tu computadora</h2>
    <p>Se abrió encima de esta página una ventana de Windows: <b>«Studium: elige la carpeta donde trabajará tu IA»</b>. Busca la carpeta del trabajo y pulsa <b>«Elegir esta carpeta»</b>.</p>
    <p class="fine">¿No la ves? Está en la barra de tareas, con ese mismo nombre. Para no elegir ninguna, ciérrala.</p></div>`;
  document.body.append(el);
  return () => el.remove();
}

// «Ver a mi IA en una terminal», wherever the bridge writes.
const watchBox = () => `<label class="tj-pick ${ai.watchTerminal() ? 'on' : ''}"><input type="checkbox" data-tj-watch ${ai.watchTerminal() ? 'checked' : ''}> <span><b>Ver a Claude Code trabajando, en su propia ventana</b><br><small>Se abre Claude Code en tu computadora con el pedido de Studium ya escrito: ves todo lo que hace, lo detienes con Esc y al terminar sigues hablándole ahí.</small></span></label>`;

/* ---------- «Ajustar la guía»: point at a part, say what to change, the AI changes only that ---------- */
// His words: «ajustar es más fácil que hacer desde 0». A member selects a fragment (or presses ✎ on a step, a chapter
// or section 0), chooses what to change and writes a comment. The requests gather in a tray on this device; «Aplicar»
// sends only the parts they touch to the person's AI, which returns those parts adjusted, the rest word for word.
// The last adjustment can be undone.
const ADJ = 'studium-tj-ajustes';
const adjList = () => { try { return JSON.parse(localStorage.getItem(ADJ) ?? '{}')[T?.id] ?? []; } catch { return []; } };
function adjKeep(list) {
  try { const m = JSON.parse(localStorage.getItem(ADJ) ?? '{}'); if (list.length) m[T.id] = list; else delete m[T.id]; localStorage.setItem(ADJ, JSON.stringify(m)); } catch { /* this time only */ }
  paintTray();
}
let undo = null;
function targetOf(key) {
  if (key.startsWith('paso:')) {
    const s = steps().find((x) => x.id === key.slice(5));
    return s ? { key, kind: 'paso', hito: s.hito, label: `el paso ${s.num} «${s.titulo}»` } : null;
  }
  if (key.startsWith('hito:')) {
    const i = T.outline.hitos.findIndex((h) => h.id === key.slice(5));
    return i >= 0 ? { key, kind: 'hito', hito: T.outline.hitos[i].id, label: `el capítulo ${i + 1} «${T.outline.hitos[i].titulo}»` } : null;
  }
  if (key === 'glosario') return { key, kind: 'esquema', label: 'el glosario (las tarjetas de términos)' };
  return { key: 'esquema', kind: 'esquema', label: 'la sección 0 (de qué se trata, las reglas, el reparto)' };
}
const adjButton = (key) => `<button type="button" class="adj" data-tj="adj" data-key="${esc(key)}" title="Pedir un cambio a tu IA">✎ <span>Ajustar</span></button>`;
// Which part of the guide a node belongs to.
function keyOfNode(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const step = el?.closest?.('article.step');
  if (step?.id?.startsWith('paso-')) return `paso:${step.id.slice(5)}`;
  const sec = el?.closest?.('section.sec');
  if (!sec) return '';
  if (sec.id === 'cap-inicio') return 'esquema';
  if (sec.id === 'cap-entrega') return el.closest('.fc-trainer, .gloss') ? 'glosario' : '';
  return sec.id.startsWith('cap-') ? `hito:${sec.id.slice(4)}` : '';
}
function adjOpen(key, quote = '') {
  const t = targetOf(key);
  if (!t) return;
  hideSelButton();
  gRoot().querySelector('.tj-adjpop')?.remove();
  const box = document.createElement('div');
  box.className = 'tj-adjpop';
  box.innerHTML = `<form data-adj-form data-key="${esc(t.key)}" class="tj-adjcard">
      <h4>Ajustar ${esc(t.label)}</h4>
      ${quote ? `<blockquote class="no-i18n">${esc(quote.slice(0, 600))}${quote.length > 600 ? '…' : ''}</blockquote><input type="hidden" name="quote" value="${esc(quote.slice(0, 1200))}">` : ''}
      <div class="tj-adjkinds">${Object.entries({ simpler: 'Más simple', shorter: 'Más corto', deeper: 'Más detalle', fix: 'Hay un error', diagram: 'Un diagrama', example: 'Un ejemplo' }).map(([k, v]) => `<label><input type="checkbox" name="kinds" value="${k}"> ${esc(v)}</label>`).join('')}</div>
      <textarea name="note" rows="3" maxlength="1500" placeholder="Qué cambiar, mejorar o corregir, en tus palabras (opcional si marcaste algo arriba)"></textarea>
      <p class="tj-adjbtns"><button type="submit" class="act" data-now="1">Ajustar ahora</button><button type="submit" class="ask">Agregar a la lista</button><button type="button" class="ask" data-tj="adj-close">Cancelar</button></p>
      <p class="mut small">Tu IA cambia solo esto; el resto de la guía queda igual. Puedes juntar varios cambios y aplicarlos de una vez.</p>
    </form>`;
  gRoot().querySelector('.tjg-app')?.append(box);
  box.querySelector('textarea')?.focus();
}
// The floating «✎ Ajustar esto» over a selection inside the guide.
let selButton = null;
function hideSelButton() { selButton?.remove(); selButton = null; }
function showSelButton() {
  const sel = getSelection();
  const text = String(sel ?? '').trim();
  if (!T?.outline || !sel?.rangeCount || text.length < 3 || sel.anchorNode?.parentElement?.closest('.tj-adjpop, .tj-tray, nav.top, textarea, input')) { hideSelButton(); return; }
  const key = keyOfNode(sel.anchorNode);
  if (!key) { hideSelButton(); return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  hideSelButton();
  selButton = document.createElement('button');
  selButton.type = 'button';
  selButton.className = 'tj-selbtn';
  selButton.textContent = '✎ Ajustar esto';
  selButton.style.left = `${Math.max(8, Math.min(innerWidth - 150, r.left + r.width / 2 - 60))}px`;
  selButton.style.top = `${Math.max(60, r.top - 44)}px`;
  selButton.addEventListener('mousedown', (e) => e.preventDefault());
  selButton.addEventListener('click', () => adjOpen(key, text));
  gRoot().querySelector('.tjg-app')?.append(selButton);
}
// The tray: the changes waiting, and «Deshacer» after an adjustment.
function trayHTML() {
  const list = adjList();
  if (!list.length && !undo) return '';
  return `<div class="tj-traybar">${list.length ? `<button type="button" class="act" data-tj="tray-open">✎ ${list.length} ${list.length === 1 ? 'cambio' : 'cambios'} por aplicar</button>` : ''}
      ${undo ? `<button type="button" class="ask" data-tj="adj-undo">Deshacer el último ajuste</button>` : ''}</div>
    <div class="tj-traypanel" hidden><h4>Cambios por aplicar</h4><ol>${list.map((c, i) => `<li><b>${esc(c.label)}</b>${c.quote ? `<q class="no-i18n">${esc(c.quote.slice(0, 160))}${c.quote.length > 160 ? '…' : ''}</q>` : ''}<span class="mut small">${esc([...(c.kinds ?? []).map((k) => ADJUST_KINDS[k] ?? k), c.note].filter(Boolean).join(' · '))}</span><button type="button" class="ask" data-tj="adj-drop" data-i="${i}" aria-label="Quitar este cambio">quitar</button></li>`).join('')}</ol>
      ${aiBlock('solution')}
      <p class="tj-adjbtns"><button type="button" class="act" data-tj="adj-apply">Aplicar con tu IA</button><button type="button" class="ask" data-tj="adj-clear">Descartar todos</button><button type="button" class="ask" data-tj="tray-close">Cerrar</button></p>
      <div data-adj-live></div></div>`;
}
function paintTray() {
  const app = gRoot()?.querySelector('.tjg-app');
  if (!app) return;
  let tray = app.querySelector('.tj-tray');
  if (!tray) { tray = document.createElement('div'); tray.className = 'tj-tray'; app.append(tray); }
  const open = !tray.querySelector('.tj-traypanel')?.hidden;
  tray.innerHTML = trayHTML();
  if (open && tray.querySelector('.tj-traypanel')) tray.querySelector('.tj-traypanel').hidden = false;
}
async function applyAdjust(list, box) {
  const hids = [...new Set(list.filter((c) => c.kind !== 'esquema').map((c) => c.hito))].filter((h) => T.hitos[h]);
  const files = ai.choice('solution').provider === 'bridge:claude' && !ai.bridgeOld();
  const chapters = hids.map((h) => { const { by: _by, ai: _ai, ...d } = T.hitos[h]; return d; });
  const system = adjustPrompt({ outline: T.outline, chapters, changes: list, prefs: T.prefs, files });
  startWork();
  box.innerHTML = liveHTML('Tu IA ajusta la guía');
  const r = await askAI('solution', system, 'Aplica los cambios pedidos a la guía.', [], `Ajustes a «${T.title}»`, liveFeed(box));
  let esquema = null;
  let chaptersBack = [];
  if (files && Object.keys(r.outputs ?? {}).length) {
    esquema = r.outputs['esquema.json'] ? parseJSON(r.outputs['esquema.json']) : null;
    chaptersBack = Object.entries(r.outputs).filter(([n]) => /^H\w{0,4}\.json$/.test(n)).map(([, t]) => parseJSON(t));
  } else {
    const j = parseJSON(r.text);
    esquema = j?.esquema ?? null;
    chaptersBack = Array.isArray(j?.hitos) ? j.hitos : [];
  }
  const before = { outline: T.outline, hitos: {} };
  const notes = [];
  let outline = T.outline;
  if (esquema) {
    if (T.owner === uid()) outline = cleanOutline(esquema, T.parts);
    else notes.push('Tu IA también cambió la sección 0 o la estructura, pero eso solo lo guarda quien creó el trabajo.');
  }
  const changed = [];
  for (const raw of chaptersBack) {
    const def = outline.hitos.find((h) => h.id === raw?.id);
    if (!def) continue;
    const data = cleanMilestone(raw, def);
    if (!data.pasos.length) continue;
    before.hitos[def.id] = T.hitos[def.id] ?? null;
    await setDoc(tRef(T.id, 'hitos', def.id), { data: await pack(data), encoding: 'gzip', by: uid(), ai: madeBy(r), updated: serverTimestamp() });
    T.hitos[def.id] = { ...data, by: uid(), ai: madeBy(r) };
    changed.push(def.id);
  }
  if (outline !== T.outline) {
    await setDoc(tRef(T.id), { outline: await pack(outline), updated: serverTimestamp() }, { merge: true });
    T.outline = outline;
    changed.push('esquema');
  }
  if (!changed.length) throw new Error('Tu IA no devolvió ninguna parte cambiada. Prueba a decir el cambio con otras palabras.');
  undo = { ...before, changed };
  await logAI({ task: 'solution', step: 'ajuste', model: r.model, provider: r.way, prompt: `${system.split('La guía tal como está ahora:')[0]}[la guía como estaba]` });
  return { changed, notes };
}
async function undoAdjust() {
  if (!undo) return;
  const u = undo;
  undo = null;
  if (u.changed.includes('esquema') && T.owner === uid()) { await setDoc(tRef(T.id), { outline: await pack(u.outline), updated: serverTimestamp() }, { merge: true }); T.outline = u.outline; }
  for (const [hid, prev] of Object.entries(u.hitos)) {
    if (!prev) continue;
    const { by: _by, ai: aiOf, ...d } = prev;
    await setDoc(tRef(T.id, 'hitos', hid), { data: await pack(d), encoding: 'gzip', by: uid(), ...(aiOf ? { ai: aiOf } : {}), updated: serverTimestamp() });
    T.hitos[hid] = prev;
  }
}
async function runAdjust(list, button) {
  if (!list.length) return;
  paintTray();
  const tray = gRoot().querySelector('.tj-tray');
  const pnl = tray?.querySelector('.tj-traypanel');
  if (pnl) pnl.hidden = false;
  let box = pnl?.querySelector('[data-adj-live]');
  if (!box) { box = document.createElement('div'); box.className = 'tj-adjlive'; gRoot().querySelector('.tjg-app')?.append(box); }
  try {
    const { changed, notes } = await (button ? busy(button, () => applyAdjust(list, box)) : applyAdjust(list, box));
    if (button) adjKeep([]); else paintTray();
    repaint();
    lit(changed);
    ctx.toast(`Ajustado: ${changed.map((x) => (x === 'esquema' ? 'la sección 0' : `el capítulo ${T.outline.hitos.findIndex((h) => h.id === x) + 1}`)).join(', ')}.${notes.length ? ` ${notes.join(' ')}` : ''}`);
  } catch (e) {
    box.innerHTML = errorBox(errInfo(e, 'Ajustar la guía'), '');
    if (!button) adjKeep([...adjList(), ...list.filter((c) => !adjList().some((x) => x.at === c.at))]);
  }
}
const lit = (ids) => { for (const id of ids) gRoot().querySelector(id === 'esquema' ? '#cap-inicio' : `#cap-${CSS.escape(id)}`)?.classList.add('just-adjusted'); };

/* ---------- when the AI fails: what happened, what to do, and a report ---------- */
// His words: never an error with no explanation, no help and no way to tell Studium. Each failure says which AI it
// was, what it means in plain words, what to try for that AI, the exact text folded, and sends a report (with the
// AI's log of that request) to Studium's feedback, where the admins see it.
const failed = new Map();
const errInfo = (e, what) => ({ what, message: String(e?.message || e || 'sin detalle'), kind: e?.kind ?? '', way: e?.way || ai.choice('solution').provider, at: Date.now() });
const MEANS = {
  account: 'Studium no pudo usar esa IA: falta conectarla, su sesión venció, o su clave ya no sirve.',
  transient: 'Fue un problema pasajero de esa IA o de la conexión. Suele arreglarse solo.',
  rate: 'Esa IA pidió una pausa: recibió muchos pedidos seguidos.',
  daily: 'Esa IA llegó a su límite de uso por ahora. No se cobró nada.',
  model: 'El modelo elegido no sirve con esa cuenta.',
  cancel: 'Lo detuviste tú.',
};
function tryThis(way) {
  if (way.startsWith('bridge:')) return ['Mira la ventana del puente en tu computadora: ahí está, línea por línea, lo que hizo tu IA y dónde falló.', `Si dice que no hay sesión, abre una terminal, escribe <code>${way === 'bridge:codex' ? 'codex' : 'claude'}</code> e inicia sesión; luego vuelve aquí.`, 'Inténtalo otra vez. Si falla igual, elige otra IA para escribir la guía, aquí abajo.'];
  if (way === 'gemini') return ['En Ajustes → Tu IA, pulsa «Probar» junto a Gemini: dice si tu clave sigue activa.', 'Elige un modelo «flash», que tiene uso gratis.', 'Inténtalo otra vez, o elige otra IA aquí abajo.'];
  if (way === 'puter') return ['Vuelve a conectar Puter en Ajustes: su sesión a veces vence sin avisar.', 'Inténtalo otra vez, o elige otra IA aquí abajo.'];
  if (way === 'openrouter') return ['Elige otro modelo gratis de OpenRouter: algunos se caen o cambian.', 'Inténtalo otra vez, o elige otra IA aquí abajo.'];
  return ['Inténtalo otra vez en un momento.', 'Si falla igual, elige otra IA aquí abajo o revísala en Ajustes → Tu IA.'];
}
function errorBox(info, retry = '') {
  if (!info) return '';
  if (info.kind === 'cancel') return `<p class="tj-ok">Lo detuviste tú. Puedes volver a escribirla cuando quieras.</p>`;
  const who = ai.WAYS[info.way]?.name ?? 'tu IA';
  const means = MEANS[info.kind] ?? `${who} recibió el pedido, pero devolvió un error en vez de la guía.`;
  const report = `${info.what} en «${T?.title ?? ''}», con ${who}. Studium mostró: ${info.message}`;
  return `<div class="tj-error" role="alert" data-ctx="${esc(`${info.what} en un trabajo de Studium, con ${who} (${info.way}). Error: ${info.message}`)}">
      <h4>${esc(info.what)}: no se pudo</h4>
      <p><b>Qué pasó.</b> ${esc(means)} <span class="mut">(IA: ${esc(who)})</span></p>
      <p><b>Qué puedes hacer:</b></p><ol>${tryThis(info.way).map((t) => `<li>${t}</li>`).join('')}</ol>
      <details><summary>El error exacto</summary><pre class="src">${esc(info.message)}\n\nIA: ${esc(info.way)} · ${esc(new Date(info.at).toLocaleString('es'))}</pre></details>
      <div class="tj-err-ai" data-err-ai></div>
      <p class="tj-error-act">${retry ? `<button type="button" class="act" data-tj="${esc(retry)}">Intentarlo otra vez</button> ` : ''}<button type="button" class="ask" data-tj="err-explain">Pedir a tu IA que lo explique</button> <button type="button" class="ask" data-feedback="ia" data-feedback-text="${esc(report.slice(0, 300))}">Enviar reporte a Studium</button> <span class="mut small">El reporte va con el registro de ese pedido; los admins lo ven y te responden.</span></p>
    </div>`;
}
// A problem that is not the AI's (reading files, saving, the network…), in the same shape: what happened in plain
// words, what to do, the exact error folded, «Pedir a tu IA que lo explique» and «Enviar reporte a Studium».
function problemBox(err, what) {
  const name = String(err?.name ?? '');
  const msg = String(err?.message ?? err ?? '');
  const known = name === 'NotReadableError' || /could not be read/i.test(msg)
    ? { means: 'Uno de los archivos que trajiste cambió, se movió o se estaba sincronizando (por ejemplo con OneDrive) después de elegirlo, y el navegador ya no podía leerlo.', todo: ['Vuelve a «Trae el enunciado», quita los archivos y tráelos de nuevo: ahora se leen en el momento.', 'Si están en una carpeta que se sincroniza, espera a que termine.'] }
    : /insufficient permissions|permission-denied|PERMISSION_DENIED/i.test(msg)
      ? { means: 'La base de datos de Studium no aceptó guardar el trabajo.', todo: ['Inténtalo otra vez.', 'Si se repite, envía el reporte: es un problema de Studium, no tuyo.'] }
      : /Failed to fetch|NetworkError|network|offline/i.test(msg)
        ? { means: 'No hubo conexión con Studium o con GitHub en ese momento.', todo: ['Revisa tu internet e inténtalo otra vez.'] }
        : { means: msg || 'Algo falló sin dar detalles.', todo: ['Inténtalo otra vez.', 'Si se repite, pide a tu IA que lo explique o envía el reporte.'] };
  const inGuide = !!T && !draft;
  const btn = inGuide ? 'ask' : 'button ghost small';
  return `<div class="tj-error" role="alert" data-ctx="${esc(`${what} en Studium. Error: ${name ? `${name}: ` : ''}${msg}`)}">
      <h4>${esc(what)}: no se pudo</h4>
      <p><b>Qué pasó.</b> ${esc(known.means)}</p>
      <p><b>Qué puedes hacer:</b></p><ol>${known.todo.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <details><summary>El error exacto</summary><pre class="src">${esc(`${name ? `${name}: ` : ''}${msg}`)}</pre></details>
      <div class="tj-err-ai" data-err-ai></div>
      <p class="tj-error-act"><button type="button" class="${btn}" data-tj="err-explain">Pedir a tu IA que lo explique</button> <button type="button" class="${btn}" data-feedback="error" data-feedback-text="${esc(`${what}: ${name ? `${name}: ` : ''}${msg}`.slice(0, 300))}">Enviar reporte a Studium</button></p>
    </div>`;
}
// «Pedir a tu IA que lo explique»: the person's quick AI reads the error and says, plainly, what it means and what to do.
const SUPPORT = 'Eres el soporte de Studium, una plataforma de estudio. Una persona que no es técnica vio este error. Explícale en español, en 2 a 4 frases simples, qué significa y por qué pasa lo más probable; después, como máximo 3 pasos concretos para resolverlo. Si no puedes saber la causa exacta, dilo. Sin jerga; si usas un término técnico, explícalo. Texto simple, con **negrita** en lo importante.';
async function explainError(box) {
  const out = box?.querySelector('[data-err-ai]');
  if (!out) return;
  if (!ai.ready()) { out.innerHTML = '<p>Para que tu IA te lo explique, conecta una en Ajustes → Tu IA (Gemini es gratis).</p>'; return; }
  out.innerHTML = '<p class="mut">Tu IA lo está leyendo…</p>';
  try {
    const r = await ai.run({ system: SUPPORT, text: box.dataset.ctx, task: 'tutor', label: 'Explicar un error', maxTokens: 900 });
    out.innerHTML = `<div class="tj-err-answer">${md(r.text)}</div>`;
  } catch (e) { out.innerHTML = `<p>Tu IA no pudo explicarlo: ${esc(e.message)}</p>`; }
}

/* ---------- live: what the AI is doing, while it works ---------- */
// The bridge says each file it reads or changes; other AIs say how much they have written. Shown as a small swarm of
// lit spheres around the AI (it can be turned off) and as a list, with the time, so the person always knows it works.
const SWARM = 'studium-tj-swarm';
const swarmOn = () => { try { return localStorage.getItem(SWARM) !== 'off'; } catch { return true; } };
const VERB = { Read: 'Lee', Glob: 'Busca archivos', Grep: 'Busca en los archivos', Edit: 'Edita', Write: 'Escribe', MultiEdit: 'Edita', NotebookEdit: 'Edita el notebook', Bash: 'Ejecuta', think: 'Piensa', write: 'Escribe la respuesta' };
function liveHTML(title) {
  return `<div class="tj-live" data-live>
      <div class="tj-live-head"><b>${esc(title)}</b><span class="tj-live-time" data-live-time>0 s</span></div>
      ${swarmOn() ? '<div class="tj-swarm" data-live-swarm><i class="core"></i></div>' : ''}
      <p class="tj-live-now" data-live-now>Preparando el pedido…</p>
      <ol class="tj-live-log" data-live-log></ol>
      <p class="tj-live-act"><button type="button" class="button danger small" data-tj="stop">■ Detener</button>
      <button type="button" class="link small" data-tj="swarm">${swarmOn() ? 'Ocultar la animación' : 'Mostrar la animación'}</button></p>
    </div>`;
}
function liveFeed(scope) {
  const el = scope.querySelector('[data-live]');
  const t0 = Date.now();
  let seen = 0;
  let files = 0;
  let last = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    const time = el.querySelector('[data-live-time]');
    if (time) time.textContent = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
    if (Date.now() - last > 20000) { const now = el.querySelector('[data-live-now]'); if (now) now.textContent = 'Sigue trabajando: está pensando o escribiendo una parte larga…'; }
  }, 1000);
  const add = (kind, target) => {
    last = Date.now();
    const log = el.querySelector('[data-live-log]');
    const now = el.querySelector('[data-live-now]');
    const text = `${VERB[kind] ?? kind}${target ? ` ${target}` : ''}`;
    if (now) now.textContent = `${text}…`;
    if (log && kind !== 'write' && kind !== 'think') { log.insertAdjacentHTML('afterbegin', `<li>${esc(text)}</li>`); while (log.children.length > 8) log.lastElementChild.remove(); }
    const swarm = el.querySelector('[data-live-swarm]');
    if (swarm && (kind === 'Read' || kind === 'Glob' || kind === 'Grep' || kind === 'Edit' || kind === 'Write') && files < 14) {
      files += 1;
      const r = 60 + (files % 4) * 22;
      swarm.insertAdjacentHTML('beforeend', `<i class="sat ${kind === 'Edit' || kind === 'Write' ? 'w' : ''}" style="--r:${r}px;--d:${7 + (files % 5) * 2}s;--a:${files * 47}deg" title="${esc(target)}"><span>${esc(String(target).split('/').pop().slice(0, 18))}</span></i>`);
    }
    if (swarm && (kind === 'write' || kind === 'think')) { swarm.classList.remove('pulse'); void swarm.offsetWidth; swarm.classList.add('pulse'); }
  };
  return {
    onEvent(p) {
      if (p.waiting) { const now = el.querySelector('[data-live-now]'); if (now) now.textContent = 'Esperando su turno en el puente…'; return; }
      if (p.lost) { const now = el.querySelector('[data-live-now]'); if (now) now.textContent = 'No se pudo leer el avance del puente; el pedido sigue.'; return; }
      for (const e of p.events ?? []) { seen += 1; add(e.kind, e.target); }
      if (!seen) { const now = el.querySelector('[data-live-now]'); if (now) now.textContent = 'Tu IA leyó las instrucciones y está pensando…'; }
    },
    onProgress(n) {
      const now = el.querySelector('[data-live-now]');
      if (now && n >= 0) { last = Date.now(); now.textContent = `Escribiendo: ${n.toLocaleString('es')} caracteres…`; }
      if (now && n < 0) now.textContent = 'Esperando la primera respuesta…';
    },
    stop() { clearInterval(tick); },
  };
}

/* ---------- the list ---------- */
const deadlineText = (d) => {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return String(d);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) + (m[4] ? `, ${m[4]}:${m[5]}` : '');
};
/* ---------- drafts: a new trabajo left halfway is kept on this device, to resume or delete ---------- */
// Kept in this browser's IndexedDB with the files themselves (they never leave the device until the trabajo is made).
const DRAFTS = 'borradores';
function draftDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('studium-trabajos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DRAFTS);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function draftStore(mode, fn) {
  const db = await draftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS, mode);
    const req = fn(tx.objectStore(DRAFTS));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
let saving = null;
function saveDraft() {
  if (!draft || !uid()) return;
  clearTimeout(saving);
  saving = setTimeout(() => {
    if (!draft) return;
    const keep = { ...draft, pairing: false, owner: uid(), saved: Date.now() };
    draftStore('readwrite', (st) => st.put(keep, draft.id)).catch((e) => console.warn('draft', e));
  }, 300);
}
const listDrafts = () => draftStore('readonly', (st) => st.getAll()).then((all) => (all ?? []).filter((d) => d.owner === uid() && d.kind !== 'files').sort((a, b) => b.saved - a.saved)).catch(() => []);
const dropDraft = (id) => draftStore('readwrite', (st) => st.delete(id)).catch(() => {});
const getDraft = (id) => draftStore('readonly', (st) => st.get(id)).catch(() => null);
function draftsHTML(list) {
  if (!list.length) return '';
  const when = (t) => new Date(t).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<h2 class="tj-sub">Borradores</h2><div class="tj-cards">${list.map((d) => `<div class="tj-card tj-draft glass">
      <div class="tj-card-main"><b>${esc(d.title || 'Trabajo sin nombre')}</b><span class="fine">Te quedaste en «${esc(QUESTIONS[d.at]?.ask ?? '')}» · ${esc(when(d.saved))}${d.files?.length ? ` · ${d.files.length} ${d.files.length === 1 ? 'archivo' : 'archivos'}` : ''}</span></div>
      <p class="tj-draft-act"><button type="button" class="button primary small" data-tj="draft-resume" data-id="${esc(d.id)}">Retomar</button> <button type="button" class="link danger" data-tj="draft-drop" data-id="${esc(d.id)}">Eliminar</button></p></div>`).join('')}</div>`;
}

async function renderList() {
  root.innerHTML = '<p class="status">Cargando…</p>';
  const drafts = await listDrafts();
  const ids = await myIds();
  const invs = await amigos.invitations();
  for (const i of invs.filter((x) => ids.includes(x.tid))) amigos.dropInvitation(i.tid).catch(() => {});
  const invited = invs.filter((x) => !ids.includes(x.tid));
  const rows = (await Promise.all(ids.map((id) => getDoc(tRef(id)).then((s) => (s.exists() ? { id, ...s.data() } : null)).catch(() => null)))).filter(Boolean);
  root.innerHTML = `<div class="page-head"><h1>Trabajos</h1><button type="button" class="button primary" data-tj="new">Empezar un trabajo nuevo</button></div>
    <p class="lede-small tj-lede">Resuelve un trabajo en grupo con una guía, paso a paso, entendiendo cada línea.</p>
    ${invited.length ? `<h2 class="tj-sub">Te invitaron</h2><div class="tj-cards">${invited.map((i) => `<div class="tj-card tj-invited glass">
      <p><b class="no-i18n">${esc(i.name)}</b> te invitó a <b class="no-i18n">${esc(i.title)}</b>.</p>
      <p class="fine">Al entrar, el grupo verá tu nombre, la parte que tomes y tu avance.</p>
      <p class="tj-draft-act"><button type="button" class="button primary small" data-tj="inv-join" data-tid="${esc(i.tid)}" data-code="${esc(i.code)}">Entrar al trabajo</button> <button type="button" class="link" data-tj="inv-drop" data-tid="${esc(i.tid)}">Ahora no</button></p></div>`).join('')}</div>` : ''}
    ${draftsHTML(drafts)}${(drafts.length || invited.length) && rows.length ? '<h2 class="tj-sub">Tus trabajos</h2>' : ''}
    ${rows.length ? `<div class="tj-cards">${rows.map((r) => `<div class="tj-card glass" data-id="${esc(r.id)}">
        <a class="tj-card-main" href="#/trabajos/${esc(r.id)}"><b class="no-i18n">${esc(r.title)}</b><span class="fine"><span class="no-i18n">${esc([r.course, r.group].filter(Boolean).join(' · '))}</span>${r.deadline ? `<br>entrega: ${esc(deadlineText(r.deadline))}` : ''}</span></a>
        <details class="tj-menu"><summary aria-label="Más opciones de ${esc(r.title)}">⋯</summary><div class="tj-menu-list glass">
          <a href="#/trabajos/${esc(r.id)}">Abrir la guía</a>
          <button type="button" data-tj="share" data-id="${esc(r.id)}" data-code="${esc(r.code)}">Invitar a mi grupo</button>
          ${r.owner === uid() ? `<button type="button" data-tj="edit-open" data-id="${esc(r.id)}">Editar los datos</button>` : ''}
          <span class="tj-menu-note">Lo ven <b>solo los miembros</b> del grupo: quienes invitas.</span>
          ${r.owner === uid() ? `<button type="button" class="danger" data-tj="delete-ask" data-id="${esc(r.id)}">Eliminar…</button>` : `<button type="button" class="danger" data-tj="leave-ask" data-id="${esc(r.id)}">Salir del trabajo…</button>`}
        </div></details>
        <div class="tj-card-extra" data-extra></div></div>`).join('')}</div>` : '<p class="fine">Todavía no tienes trabajos.</p>'}`;
  listRows = rows;
}

let listRows = [];
function cardExtra(id, html) { const el = root.querySelector(`.tj-card[data-id="${CSS.escape(id)}"] [data-extra]`); if (el) el.innerHTML = html; root.querySelectorAll('.tj-menu[open]').forEach((m) => { m.open = false; }); }
// Deleting a trabajo: its parts the owner may remove first (the rules let the owner clean them), then the trabajo.
async function deleteTrabajo(id) {
  for (const sub of ['hitos', 'partes', 'avance', 'ia', 'disponible', 'reunion', 'miembros']) {
    const snap = await getDocs(collection(db, 'trabajos', id, sub)).catch(() => null);
    for (const d of snap?.docs ?? []) if (sub !== 'miembros' || d.id !== uid()) await deleteDoc(d.ref).catch(() => {});
  }
  await deleteDoc(tRef(id));
  await deleteDoc(tRef(id, 'miembros', uid())).catch(() => {});
  await keepIds((await myIds()).filter((x) => x !== id));
  dropDraft(`files:${id}`);
}
async function leaveTrabajo(id) {
  const r = listRows.find((x) => x.id === id);
  const part = (await getDocs(collection(db, 'trabajos', id, 'partes')).catch(() => null))?.docs.find((d) => d.data().uid === uid());
  if (part) await deleteDoc(part.ref).catch(() => {});
  await deleteDoc(tRef(id, 'miembros', uid()));
  await keepIds((await myIds()).filter((x) => x !== id));
  return r;
}

// Inviting to a trabajo: friends of Studium with one tap (they find it in their Trabajos), or the link for anyone else.
async function invitePanel(tid, title, code) {
  const [friends, members] = await Promise.all([amigos.listFriends().catch(() => []), getDocs(collection(db, 'trabajos', tid, 'miembros')).then((s) => s.docs.map((d) => d.id)).catch(() => [])]);
  const out = friends.filter((f) => !members.includes(f.uid));
  const inside = friends.filter((f) => members.includes(f.uid));
  return `<div class="tj-invite" data-tid="${esc(tid)}" data-title="${esc(title)}" data-code="${esc(code)}">
    <h3>Invitar a «<span class="no-i18n">${esc(title)}</span>»</h3>
    ${out.length ? `<p class="fine">Tus amigos de Studium: lo verán en sus Trabajos, con «Entrar al trabajo».</p>
      <div class="tj-friends">${out.map((f) => `<label class="tj-pick"><input type="checkbox" data-tj-friend value="${esc(f.uid)}" data-name="${esc(f.name)}"> <i class="am-av" aria-hidden="true">${esc(String(f.name).trim()[0]?.toUpperCase() ?? '?')}</i> <span class="no-i18n">${esc(f.name)}</span></label>`).join('')}</div>
      <p><button type="button" class="button primary small" data-tj="invite-send">Invitar</button> <span class="fine" data-invite-status role="status"></span></p>`
    : `<p class="fine">${friends.length ? 'Todos tus amigos ya están en este trabajo.' : 'Todavía no tienes amigos en Studium.'} <a href="#/comunidad">Agrégalos en Comunidad</a> con tu enlace de amigo, y vuelve aquí.</p>`}
    ${inside.length ? `<p class="fine">Ya están: ${inside.map((f) => `<span class="no-i18n">${esc(f.name)}</span>`).join(', ')}.</p>` : ''}
    <p class="fine">¿Alguien que no es tu amigo en Studium? <button type="button" class="link" data-tj="invite-link">Copiar el enlace de invitación</button>: quien lo tenga puede entrar, así que pásalo solo a tu grupo.</p>
    <p><button type="button" class="link mut" data-tj="invite-close">Cerrar</button></p>
  </div>`;
}
const inviteLink = (tid, code) => `${location.origin}${location.pathname}#/trabajos/unirse/${tid}/${code}`;

/* ---------- a new trabajo: one question at a time ---------- */
const QUESTIONS = [
  { key: 'title', ask: '¿Cómo se llama el trabajo?', hint: 'Como aparece en el enunciado, o como lo llaman ustedes.', input: 'text', placeholder: 'Proyecto final de Machine Learning', required: true },
  { key: 'course', ask: '¿De qué materia es?', input: 'text', placeholder: 'Machine Learning', optional: true },
  { key: 'statement', ask: 'Trae el enunciado', hint: 'Y todo lo que lo acompaña: la rúbrica, archivos de inicio, un ZIP. Puedes traer varios.', input: 'files', required: true },
  { key: 'goal', ask: '¿Qué quieres hacer con este trabajo?', hint: 'Así tu IA sabe desde dónde partir.', input: 'goal' },
  { key: 'work', ask: '¿Cómo van a trabajar?', hint: 'Así la guía sabe cuánto explicar y cómo comparten el trabajo.', input: 'work' },
  { key: 'ai', ask: 'Tu IA para este trabajo', input: 'ai' },
  { key: 'prefs', ask: '¿Cómo quieres la guía?', hint: 'Elige lo que prefieras; lo demás queda como viene.', input: 'prefs' },
  { key: 'parts', ask: '¿Cuántos son en el grupo?', hint: 'La guía se divide en una parte por persona.', input: 'count' },
  { key: 'group', ask: '¿Cómo se llama el grupo?', hint: 'Algunos trabajos lo piden en el informe.', input: 'text', placeholder: 'Grupo 4', optional: true },
  { key: 'deadline', ask: '¿Cuándo es la entrega?', input: 'date', optional: true },
  { key: 'ready', ask: 'Todo listo', input: 'ready' },
];
export const PREF_DEFAULT = { goal: 'solve', goalNote: '', balance: 'both', share: 'each', repoUrl: '', template: 'cuaderno', writeAll: 'all', tone: 'balanced', level: 'zero', length: 'normal', text: 'some', cards: true, defense: true, practice: false, visuals: true, note: '' };
// Which Claude account writes (several may be signed in on this computer).
function accountPick() {
  const b = ai.bridgeOf();
  const accounts = (b?.engines ?? []).find((e) => e.id === 'claude')?.accounts?.filter((a) => a.ready) ?? [];
  if (accounts.length < 2) return '';
  return `<div class="tj-accounts"><p class="fine">Con qué cuenta de Claude:</p>${accounts.map((a) => `<label class="tj-pick ${a.id === b.account ? 'on' : ''}"><input type="radio" name="claude-account" value="${esc(a.id)}" data-tj-account ${a.id === b.account ? 'checked' : ''}> <span class="tj-wrap">${esc(a.email || a.id)}</span> <small>${a.plan ? `plan ${esc(a.plan)} · ` : ''}carpeta ${esc(a.id)}</small></label>`).join('')}</div>`;
}
const FOLDERS = 'studium-tj-folders';
const RESUME = 'studium-tj-resume';
const resumeOf = (tid) => { try { return JSON.parse(localStorage.getItem(RESUME) ?? '{}')[tid] ?? ''; } catch { return ''; } };
function keepResume(tid, cmd) { if (!cmd) return; try { const m = JSON.parse(localStorage.getItem(RESUME) ?? '{}'); m[tid] = cmd; localStorage.setItem(RESUME, JSON.stringify(m)); } catch { /* this device only */ } }
const folderOf = (tid) => { try { return JSON.parse(localStorage.getItem(FOLDERS) ?? '{}')[tid] ?? ''; } catch { return ''; } };
function keepFolder(tid, id) {
  try { const m = JSON.parse(localStorage.getItem(FOLDERS) ?? '{}'); if (id && id !== 'temp') m[tid] = id; else delete m[tid]; localStorage.setItem(FOLDERS, JSON.stringify(m)); } catch { /* this device only */ }
}
// A folder is lent for one task: once the guide is written, the bridge forgets it (his words: «acceso único»).
async function releaseFolder(tid) {
  const id = folderOf(tid);
  if (!id) return;
  keepFolder(tid, '');
  await ai.changeBridgeFolder(id, { remove: true }).catch(() => {});
}
// The trabajo's lent folder as the bridge sees it now: 'none', 'ok', or 'gone' (the bridge was restarted, the lending
// ran out, or the folder moved). A guide sent to a gone folder fails after the request: it is checked before.
function folderState(id) {
  if (!id || id === 'temp') return 'none';
  const f = (ai.bridgeOf()?.folders ?? []).find((x) => x.id === id);
  return f && !f.expired && f.exists !== false ? 'ok' : 'gone';
}
async function folderStateNow(id) {
  if (!id || id === 'temp') return 'none';
  await ai.bridgeFolders().catch(() => {});
  return folderState(id);
}
const usesFolder = () => ai.choice('solution').provider === 'bridge:claude' && !ai.bridgeOld();
const FOLDER_GONE = 'Tu carpeta se desconectó del puente (se cerró o reinició el puente, o pasó el tiempo que la prestaste). Elígela otra vez aquí abajo, o sigue solo con lo que trajiste.';
const MODE_TEXT = { read: 'Solo leer', write: 'Leer y escribir archivos', git: 'Leer, escribir y usar git' };
const MODE_WHY = { read: 'lee tus archivos; no cambia nada', write: 'también crea y edita archivos de esta carpeta, nunca fuera de ella; no ejecuta comandos', git: 'también usa git aquí (commits y push a tu nombre); nada más' };
// The choice of where the AI works: a temporary folder, or one of the person's folders with its permission.
function placeHTML(now) {
  // One folder for this trabajo, lent only while the guide is written (the bridge forgets it after).
  const f = (ai.bridgeOf()?.folders ?? []).find((x) => x.id === now && !x.expired && x.exists !== false);
  const modeSel = (x) => `<select data-tj-mode="${esc(x.id)}" aria-label="Permiso en ${esc(x.name)}">${Object.entries(MODE_TEXT).map(([k, v]) => `<option value="${k}" ${x.mode === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  if (ai.bridgeOld()) return `<p class="tj-warn">Para usar tus carpetas, actualiza el puente: <a href="${esc(ai.BRIDGE_URL)}" download="studium-bridge.mjs">descárgalo</a>, ciérralo (Ctrl+C) y ábrelo con <code>${esc(ai.bridgeCommand())}</code>. <button type="button" class="link" data-tj="bridge-recheck">Ya lo abrí</button></p>`;
  return `<div class="tj-seg" role="radiogroup">
      <label class="${f ? '' : 'on'}"><input type="radio" name="workspace" value="temp" data-tj-ws ${f ? '' : 'checked'}>Solo lo que trajiste</label>
      ${f ? `<label class="on"><input type="radio" name="workspace" value="${esc(f.id)}" data-tj-ws checked>📁 ${esc(f.name)}</label>` : ''}
    </div>
    ${f ? `<p class="tj-folder-now">${modeSel(f)} <small>${esc(MODE_WHY[f.mode] ?? '')}</small> <button type="button" class="link" data-tj="folder-pick">otra carpeta</button></p>`
    : `<p><button type="button" class="button ghost small" data-tj="folder-pick">${draft?.broughtFolder ? `Trabajar en la carpeta «${esc(draft.broughtFolder)}» de mi computadora…` : 'Trabajar en una carpeta de mi computadora…'}</button> <span class="fine" id="tj-folder-status" role="status">Solo mientras escribe la guía.</span></p>`}`;
}
async function myName() {
  const p = await loadProfile(uid()).catch(() => null);
  const u = auth.currentUser;
  return String(p?.nickname || u?.displayName || (u?.email ?? '').split('@')[0] || 'Yo').slice(0, 40);
}
function startDraft() {
  draft = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: 0, title: '', course: '', text: '', files: [], parts: 3, group: '', date: '', time: '', pasting: false, workspace: 'temp', prefs: { ...PREF_DEFAULT } };
  renderDraft();
}
const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
// A folder brought whole: its files keep their place in it («carpeta/sub/archivo.py»). Skipped: hidden files and the
// folders that are never material (git, dependencies, caches); at most 400 files and 40 MB.
const SKIP_DIR = /^(\.|node_modules$|__pycache__$|venv$|\.venv$|env$|dist$|build$|target$)/;
const FOLDER_MAX = { files: 400, bytes: 40e6 }; // the bridge takes 64 MB per request, and files travel as base64 (+33 %)
async function addFolderFiles(files, rootName) {
  let n = 0; let bytes = 0; let skipped = 0;
  const keep = [];
  for (const f of files) {
    const rel = f.webkitRelativePath || f.relPath || f.name;
    if (rel.split('/').slice(0, -1).some((d) => SKIP_DIR.test(d)) || f.name.startsWith('.')) { skipped += 1; continue; }
    if (n >= FOLDER_MAX.files || bytes + f.size > FOLDER_MAX.bytes) { skipped += 1; continue; }
    n += 1; bytes += f.size;
    keep.push(new File([f], rel, { type: f.type, lastModified: f.lastModified }));
  }
  await addFiles(keep);
  draft.broughtFolder = rootName;
  draft.folderNote = skipped ? `${n} archivos; dejé fuera ${skipped} (ocultos, dependencias o por tamaño)` : `${n} archivos`;
}
// Dropped folders: read through the browser's entries, recursively.
async function readEntry(entry, prefix = '') {
  if (entry.isFile) return [await new Promise((res, rej) => entry.file((f) => { f.relPath = prefix + f.name; res(f); }, rej))];
  if (!entry.isDirectory || SKIP_DIR.test(entry.name)) return [];
  const reader = entry.createReader();
  const all = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    all.push(...batch);
  }
  const out = [];
  for (const e of all) out.push(...await readEntry(e, `${prefix}${entry.name}/`));
  return out;
}
// Each file is read into memory the moment it is brought: a file the browser only points to on disk cannot be read
// later if it changed, moved or is being synced (OneDrive), which made «Escribir mi guía» fail with «The requested
// file could not be read». A file that cannot be read now is named, with what to do.
// While files are read: the drop area says so.
const reading = () => { const d = root.querySelector('[data-tj-drop] b'); if (d) d.textContent = 'Leyendo tus archivos…'; };
async function addFiles(list) {
  const unread = [];
  for (const f of list) {
    if (draft.files.some((g) => sameFile(f, g))) continue;
    try {
      const data = await f.arrayBuffer();
      draft.files.push(new File([data], f.name, { type: f.type, lastModified: f.lastModified }));
    } catch { unread.push(f.name); }
  }
  if (unread.length) draft.unread = unread;
}
function renderDraft(error = '') {
  saveDraft();
  const q = QUESTIONS[draft.at];
  const dots = QUESTIONS.map((_, i) => `<i class="${i < draft.at ? 'done' : i === draft.at ? 'now' : ''}"></i>`).join('');
  let control = '';
  let hint = q.hint ?? '';
  if (q.input === 'text') control = `<input class="tj-input" name="v" value="${esc(draft[q.key])}" placeholder="${esc(q.placeholder ?? '')}" maxlength="${q.key === 'group' ? 80 : 160}" autocomplete="off">`;
  if (q.input === 'count') control = `<div class="tj-count">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button type="button" class="button ${n === draft.parts ? 'primary' : 'ghost'}" data-tj="count" data-n="${n}">${n}</button>`).join('')}</div>`;
  if (q.input === 'date') {
    control = `<div class="tj-when"><label class="field"><span>Día</span><input type="date" name="date" value="${esc(draft.date)}"></label>
      <label class="field"><span>Hora (si la sabes)</span><input type="time" name="time" value="${esc(draft.time)}"></label></div>`;
  }
  if (q.input === 'files') {
    control = `<label class="tj-drop" data-tj-drop>
        <input type="file" name="files" multiple hidden>
        <b>Suelta aquí tus archivos o una carpeta</b>
        <span class="fine">o pulsa para elegir archivos · puedes traer varios, de una vez o uno por uno</span>
      </label>
      <p class="tj-folderpick"><label class="button ghost small"><input type="file" name="folder" webkitdirectory multiple hidden> Elegir una carpeta…</label>
        ${draft.broughtFolder ? `<span class="fine">Trajiste la carpeta <b>${esc(draft.broughtFolder)}</b>${draft.folderNote ? ` (${esc(draft.folderNote)})` : ''}. Si tu IA trabaja con el puente, en «Tu IA» puedes hacer que trabaje directamente en ella.</span>` : ''}</p>
      ${draft.kept ? `<p class="tj-kept">Ya está guardado el enunciado que trajiste${draft.kept.files.length ? `, con ${draft.kept.files.slice(0, 4).map((f) => `«${esc(f.name)}»`).join(', ')}${draft.kept.files.length > 4 ? ` y ${draft.kept.files.length - 4} más` : ''}` : ''}. Lo que traigas ahora se agrega a eso.</p>` : ''}
      ${draft.unread?.length ? `<p class="tj-warn">No pude leer ${draft.unread.map((n) => `«${esc(n)}»`).join(', ')}: puede que esté abierto en otro programa, se haya movido o se esté sincronizando (OneDrive). Ciérralo o espera, y vuelve a traerlo.</p>` : ''}
      ${draft.files.length ? `<ul class="tj-files">${draft.files.slice(0, 8).map((f, i) => `<li><span>${esc(f.name)}</span><small>${sizeText(f.size)}</small><button type="button" class="link" data-tj="drop-file" data-i="${i}" aria-label="Quitar ${esc(f.name)}">quitar</button></li>`).join('')}${draft.files.length > 8 ? `<li class="fine">y ${draft.files.length - 8} archivos más · <button type="button" class="link" data-tj="drop-all">quitar todos</button></li>` : ''}</ul>` : ''}
      ${draft.pasting || draft.text ? `<textarea class="tj-paste plain" name="text" rows="5" placeholder="Pega aquí el enunciado y la rúbrica">${esc(draft.text)}</textarea>` : '<button type="button" class="link" data-tj="paste">Prefiero pegar el texto</button>'}`;
  }
  if (q.input === 'ai') {
    // Short on purpose (his words: «muy larga, mucho texto»): who writes, who answers, where; the rest folded.
    if (!draft.foldersRead && ai.connected().some((w) => w.startsWith('bridge:'))) { draft.foldersRead = true; ai.bridgeFolders().then(() => { if (draft && QUESTIONS[draft.at].input === 'ai') renderDraft(); }).catch(() => {}); }
    const an = analyze([...draft.files, ...(draft.kept?.files ?? [])], draft.text, draft.kept?.chars ?? 0);
    const best = options(an)[0];
    const ways = ai.connected();
    const writer = ai.choice('solution').provider;
    const tutor = ai.choice('tutor').provider;
    hint = '';
    const pick = (task, now) => `<select data-tj-use="${task}">${ways.map((w) => `<option value="${esc(w)}" ${w === now ? 'selected' : ''}>${esc(ai.WAYS[w]?.name ?? w)}</option>`).join('')}</select>`;
    const sugg = usable(best) ? '' : `<p class="tj-sugg">Sugerida para esto: <b>${esc(best.name)}</b>. ${best.id === 'bridge' ? '<button type="button" class="button primary small" data-tj="pair-here">Conectar</button>' : `<button type="button" class="button primary small" data-tj="connect" data-vendor="${best.vendor}">Conectar</button>`}</p>`;
    const roles = ways.length ? `<div class="tj-roles2">
        <label><span>Escribe la guía</span>${pick('solution', writer)}</label>${writer === 'bridge:claude' ? accountPick() : ''}
        <label><span>Responde tus dudas</span>${pick('tutor', tutor)}</label>
      </div>` : '';
    const where = writer.startsWith('bridge:') ? `<div class="tj-where"><h3>Dónde trabaja</h3>${placeHTML(draft.workspace)}${watchBox()}</div>` : '';
    control = `${sugg}${roles}${where}
      ${best.id === 'bridge' && draft.pairing && !usable(best) ? `<div class="tj-bridge ai-bridge">${bridgeSteps().replace('data-ai-pair>', 'data-tj="pair-code">')}</div>` : ''}
      <details class="tj-more" ${ways.length ? '' : 'open'}><summary>Conectar otra IA</summary>${allWays(best)}</details>`;
  }
  if (q.input === 'work') {
    const seg = (key, choices) => `<div class="tj-seg" role="radiogroup">${choices.map(([v, label]) => `<label class="${draft.prefs[key] === v ? 'on' : ''}"><input type="radio" name="p-${key}" value="${v}" data-tj-pref="${key}" ${draft.prefs[key] === v ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>`;
    // Only what exists (his words: «no prometas las cosas que aún no están hechas»): with GitHub (a repo they have, or a
    // new one) or without it. One question at a time on this screen, each answer opening the next.
    const share = ['repo', 'newrepo'].includes(draft.prefs.share) ? 'github' : draft.prefs.share === 'each' ? 'none' : '';
    const pick = (name, v, label, note, on) => `<label class="tj-pick ${on ? 'on' : ''}"><input type="radio" name="${name}" value="${v}" data-tj="${name}" ${on ? 'checked' : ''}> <span><b>${esc(label)}</b><br><small>${esc(note)}</small></span></label>`;
    control = `<h3>¿Entender o hacer?</h3>${seg('balance', [['understand', 'Sobre todo entender'], ['both', 'Los dos'], ['do', 'Sobre todo hacer']])}
      <h3>¿Van a usar GitHub?</h3><div class="tj-goals">
        ${pick('share-git', 'github', 'Sí, con GitHub', 'el código vive en un repo; la guía les da cada commit, push y PR', share === 'github')}
        ${pick('share-git', 'none', 'No, sin GitHub', 'cada uno en su computadora; la guía les dice cómo juntar el trabajo', share === 'none')}</div>
      ${share === 'github' ? `<h3>¿Ya tienen el repo?</h3><div class="tj-goals">
        ${pick('share-repo', 'repo', 'Sí, ya lo tenemos', 'pegas su enlace', draft.prefs.share === 'repo')}
        ${pick('share-repo', 'newrepo', 'No, hay que crearlo', 'eliges quién lo crea', draft.prefs.share === 'newrepo')}</div>` : ''}
      ${draft.prefs.share === 'repo' ? `<label class="field"><span>El enlace del repo</span><input class="tj-input" name="repoUrl" value="${esc(draft.prefs.repoUrl)}" placeholder="https://github.com/usuario/repo" autocomplete="off"></label>` : ''}
      ${draft.prefs.share === 'newrepo' ? newRepoHTML() : ''}`;
  }
  if (q.input === 'goal') {
    const goals = [['solve', 'Resolverlo desde cero', 'la solución completa, hasta el entregable'], ['complete', 'Entender y completar lo que ya tenemos', 'parte de lo que ya hicieron'], ['review', 'Revisar y corregir nuestra solución', 'qué está bien, qué falta, qué cambiar'], ['defend', 'Prepararme para la defensa', 'entender cada parte y practicar preguntas']];
    control = `<div class="tj-goals">${goals.map(([v, label, why]) => `<label class="tj-pick ${draft.prefs.goal === v ? 'on' : ''}"><input type="radio" name="goal" value="${v}" data-tj-pref="goal" ${draft.prefs.goal === v ? 'checked' : ''}> <span><b>${esc(label)}</b><br><small>${esc(why)}</small></span></label>`).join('')}</div>
      <label class="field"><span>Cuéntale más, si quieres <small>(opcional)</small></span><textarea class="tj-paste plain" name="goalNote" rows="2" maxlength="800" placeholder="Por ejemplo: ya tenemos el scraper; nos falta el modelado y la defensa.">${esc(draft.prefs.goalNote)}</textarea></label>`;
  }
  if (q.input === 'prefs') {
    const seg = (key, choices) => `<div class="tj-seg" role="radiogroup">${choices.map(([v, label]) => `<label class="${draft.prefs[key] === v ? 'on' : ''}"><input type="radio" name="p-${key}" value="${v}" data-tj-pref="${key}" ${draft.prefs[key] === v ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>`;
    const box = (key, label) => `<label class="tj-pick ${draft.prefs[key] ? 'on' : ''}"><input type="checkbox" data-tj-pref="${key}" ${draft.prefs[key] ? 'checked' : ''}> ${esc(label)}</label>`;
    control = `<div class="tj-prefs">
        <div><h3>Cómo se ve</h3><div class="tpl-pick">${Object.entries(TEMPLATES).map(([k, v]) => `<label class="tpl-card ${draft.prefs.template === k ? 'on' : ''}"><input type="radio" name="template" value="${k}" data-tj-pref="template" ${draft.prefs.template === k ? 'checked' : ''}><span class="tpl-prev">${templateSample(k)}</span><b>${esc(v.name)}</b><small>${esc(v.note)}</small></label>`).join('')}</div></div>
        <div><h3>Al terminar el esquema</h3>${seg('writeAll', [['all', 'Escribir todos los capítulos de una vez'], ['outline', 'Primero el esquema, para revisarlo']])}</div>
        <div><h3>Algo más que tu IA deba saber <small>(opcional)</small></h3><textarea class="tj-paste plain" name="note" rows="3" maxlength="1500" placeholder="Por ejemplo: el profesor pide todo en inglés; ya tenemos el scraper hecho.">${esc(draft.prefs.note)}</textarea></div>
        <details class="tj-more" data-tj-more ${draft.moreOpen ? 'open' : ''}><summary>Más opciones <small>cómo explica, desde dónde parte, qué tan larga, cuánto texto y qué incluye</small></summary><div class="tj-prefs">
        <div><h3>Cómo explica</h3>${seg('tone', [['direct', 'Directo a la respuesta'], ['balanced', 'Equilibrado'], ['didactic', 'Muy didáctico']])}</div>
        <div><h3>Desde dónde parte</h3>${seg('level', [['zero', 'Desde cero'], ['basic', 'Sé lo básico'], ['advanced', 'Tengo experiencia']])}</div>
        <div><h3>Qué tan larga</h3>${seg('length', [['short', 'Corta'], ['normal', 'Normal'], ['full', 'Completa']])}</div>
        <div><h3>Texto en pantalla</h3>${seg('text', [['little', 'Poco, al grano'], ['some', 'Lo justo'], ['much', 'Explicaciones largas']])}</div>
        <div><h3>Qué incluye</h3><div class="tj-boxes">${box('cards', 'Tarjetas de términos al final')}${box('defense', 'Preguntas de defensa')}${box('practice', 'Ejercicios para practicar')}${box('visuals', 'Gráficas y diagramas, cuando ayuden')}</div></div>
        </div></details>
      </div>`;
  }
  if (q.input === 'ready') {
    control = `<p class="tj-sentence">Tu IA va a leer el enunciado de <b>${esc(draft.title)}</b> y escribir una guía de solución para <b>${draft.parts} ${draft.parts === 1 ? 'persona' : 'personas'}</b>, paso a paso, con cada línea explicada.</p>
      ${ai.ready() ? ai.pickerHTML('solution') : ''}
      ${ai.promptHTML((ai.choice('solution').provider === 'bridge:claude' && draft.prefs.writeAll !== 'outline' && !ai.bridgeOld() ? wholePrompt : outlinePrompt)({ parts: draft.parts, course: draft.course, deadline: deadlineText(draftDeadline()), prefs: draft.prefs }), '', 'el enunciado y lo que trajiste')}
      <p class="tj-vis">🔒 Lo ven solo tú y quienes invites después: tus amigos de Studium, o quien tenga su enlace.</p>`;
  }
  root.innerHTML = `<form class="tj-wizard panel glass" id="tj-wizard">
      <div class="tj-dots" aria-hidden="true">${dots}</div>
      ${draft.tid ? '<p class="tj-editing">Estás cambiando las respuestas de un trabajo que ya creaste: «Atrás» llega a cualquier pregunta, y al final tu IA escribe la guía con lo nuevo.</p>' : ''}
      <h1>${esc(q.ask)}</h1>
      ${hint ? `<p class="lede-small">${esc(hint)}</p>` : ''}
      ${error === FOLDER_GONE ? `<p class="tj-warn" role="alert">${esc(error)}</p>` : ''}
      ${control}
      ${error && error !== FOLDER_GONE ? (typeof error === 'string' ? `<p class="tj-warn">${esc(error)}</p>` : problemBox(error, 'Crear el trabajo')) : ''}
      <div class="tj-wizard-nav">
        ${draft.at ? '<button type="button" class="link" data-tj="back">← Atrás</button>' : ''}
        <button type="button" class="link mut" data-tj="cancel">Guardar y salir</button>
        <span></span>
        ${q.optional ? `<button type="button" class="link" data-tj="skip">${q.input === 'date' ? 'Todavía no sabemos' : 'Saltar'}</button>` : ''}
        ${q.input === 'ready'
    ? `${ai.ready() ? '<button class="button primary big" type="submit">Escribir mi guía</button>' : `<button class="button ghost" type="submit" data-later="1">${draft.tid ? 'Guardar y escribir la guía después' : 'Crear el trabajo y escribir la guía después'}</button>`}`
    : '<button class="button primary" type="submit">Siguiente →</button>'}
      </div>
    </form>`;
  root.querySelector('.tj-input, .tj-paste')?.focus();
}
const draftDeadline = () => (draft.date ? `${draft.date}${draft.time ? `T${draft.time}` : ''}` : '');
function keepAnswer() {
  const q = QUESTIONS[draft.at];
  const form = $('#tj-wizard', root);
  if (!form) return;
  if (q.input === 'text') draft[q.key] = String(form.v.value).trim();
  if (q.input === 'files' && form.text) draft.text = String(form.text.value).trim();
  if (q.input === 'prefs' && form.note) draft.prefs.note = String(form.note.value).trim().slice(0, 1500);
  if (q.input === 'work' && form.repoUrl) draft.prefs.repoUrl = String(form.repoUrl.value).trim().slice(0, 200);
  if (q.input === 'work' && form.repoName) draft.prefs.repoName = String(form.repoName.value).trim().slice(0, 100);
  if (q.input === 'work' && form.ghCreate?.value.trim()) { ai.setKey(GH_CREATE, form.ghCreate.value.trim()); form.ghCreate.value = ''; }
  if (q.input === 'goal' && form.goalNote) draft.prefs.goalNote = String(form.goalNote.value).trim().slice(0, 800);
  if (q.input === 'date') { draft.date = form.date.value; draft.time = form.time.value; }
}
function nextQuestion() {
  keepAnswer();
  const q = QUESTIONS[draft.at];
  if (q.required && q.input === 'text' && !draft[q.key]) return renderDraft('Escríbelo para seguir.');
  if (q.input === 'files' && !draft.files.length && !draft.text && !draft.kept) return renderDraft('Trae el enunciado para seguir: uno o varios archivos, o el texto pegado.');
  // What can be checked here is checked here, not at the end.
  if (q.input === 'work' && draft.prefs.share === 'repo' && !repoOf(draft.prefs).repo) return renderDraft('Pega el enlace del repo, como https://github.com/usuario/repo, o elige «No, hay que crearlo».');
  if (q.input === 'work' && draft.prefs.share === 'newrepo' && !/^[A-Za-z0-9._-]{1,100}$/.test(String(draft.prefs.repoName || slug(draft.title)))) return renderDraft('El nombre del repo solo puede tener letras, números, puntos, guiones y guiones bajos, sin espacios.');
  if (q.input === 'work' && draft.prefs.share === 'newrepo' && draft.prefs.repoBy === 'token' && !ai.keyOf(GH_CREATE)) return renderDraft('Pega la clave de GitHub que puede crear repos (los pasos están arriba), o elige otra forma de crearlo.');
  draft.at = Math.min(QUESTIONS.length - 1, draft.at + 1);
  renderDraft();
}

// Everything brought, read in the browser as Studium reads any material (files.js): its text goes in the statement,
// its PDFs and pictures go to the AI as they are.
async function readAll(files) {
  const texts = [];
  const binaries = [];
  const notes = [];
  for (const file of files) {
    let p;
    try { p = await prepare(file); } catch (e) { notes.push(`«${file.name}» no se pudo leer (${e.name === 'NotReadableError' ? 'cambió en tu computadora después de traerlo' : e.message}): quítalo y tráelo de nuevo`); continue; }
    if (p.skipped) { notes.push(`${p.name}: ${p.skipped}`); continue; }
    for (const u of p.units.filter((x) => x.selected !== false)) {
      for (const part of await u.make()) {
        if (part.text) texts.push(`# ${part.name}\n\n${part.text}`);
        else binaries.push(part);
      }
    }
    for (const n of p.notes ?? []) notes.push(n);
  }
  return { texts, binaries, notes };
}
// «Un repo nuevo de GitHub»: who creates it, chosen by the person. The guide can explain it; Studium can create it with
// a GitHub key that may create repositories; or the bridge can, with GitHub CLI (gh) signed in on the computer.
const slug = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'trabajo';
const GH_CREATE = 'github-create';
function newRepoHTML() {
  const by = draft.prefs.repoBy || 'guide';
  const has = !!ai.keyOf(GH_CREATE);
  const opt = (v, label, note) => `<label class="tj-pick ${by === v ? 'on' : ''}"><input type="radio" name="repoBy" value="${v}" data-tj-pref="repoBy" ${by === v ? 'checked' : ''}> <span><b>${label}</b><br><small>${note}</small></span></label>`;
  return `<label class="field"><span>Nombre del repo</span><input class="tj-input" name="repoName" value="${esc(draft.prefs.repoName || slug(draft.title))}" maxlength="100" autocomplete="off" spellcheck="false"></label>
    <h3>Quién lo crea</h3>
    ${opt('guide', 'La guía me explica cómo', 'el primer paso: crearlo privado e invitar al grupo')}
    ${opt('token', 'Studium, con mi clave de GitHub', has ? 'ya guardaste una clave que puede crear repos' : 'pegas una clave que pueda crear repos; se guarda cifrada')}
    ${opt('bridge', 'Mi computadora, con el puente', 'GitHub CLI (gh) lo crea a tu nombre; necesitas gh con tu sesión iniciada')}
    ${by === 'token' && !has ? `<div class="tj-ghkey"><ol class="tight"><li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">una clave nueva en GitHub</a>.</li>
      <li>En «Repository access», <b>All repositories</b>; en «Permissions», <b>Administration: Read and write</b>. Es amplia: puede administrar todos tus repos. Puedes borrarla al terminar.</li>
      <li>Genérala y pégala aquí.</li></ol><input class="tj-input" name="ghCreate" type="password" autocomplete="off" placeholder="${PAT}…" aria-label="Clave de GitHub que puede crear repos"></div>` : ''}
    ${by === 'bridge' && !ai.connected().some((w) => w.startsWith('bridge:')) ? '<p class="tj-warn">Primero conecta el puente (en «Tu IA», la pregunta siguiente).</p>' : ''}
    <p class="fine">Se crea <b>privado</b> al crear el trabajo, y la guía usa sus comandos.</p>`;
}
// Creates the repository when the trabajo is created; on success the trabajo uses it as «a repo we already have».
async function makeRepo(p) {
  if (p.share !== 'newrepo' || !p.repoBy || p.repoBy === 'guide') return;
  const name = String(p.repoName || slug(draft.title)).trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error('El nombre del repo solo puede tener letras, números, puntos, guiones y guiones bajos (sin espacios).');
  let url = '';
  if (p.repoBy === 'bridge') {
    url = (await ai.bridgeCreateRepo({ name, description: draft.title })).url;
  } else {
    const key = ai.keyOf(GH_CREATE);
    if (!key) throw new Error('Pega la clave de GitHub que puede crear repos, o elige otra forma.');
    const res = await fetch('https://api.github.com/user/repos', { method: 'POST', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, private: true, auto_init: true, description: draft.title.slice(0, 300) }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'GitHub no aceptó la clave: revisa que esté bien copiada y no haya vencido.'
        : res.status === 403 ? 'La clave no tiene permiso para crear repos: en GitHub, dale «Administration: Read and write» con «All repositories».'
          : res.status === 422 ? `Ya tienes un repo llamado «${name}», o el nombre no es válido. Elige otro.`
            : `GitHub respondió ${res.status}: ${body.message ?? 'sin detalle'}.`);
    }
    url = body.html_url;
  }
  if (!url) throw new Error('El repo se pidió, pero no llegó su dirección. Revísalo en tu GitHub.');
  draft.prefs.share = 'repo';
  draft.prefs.repoUrl = url;
  draft.prefs.repoCreated = true;
  saveDraft();
}
// «https://github.com/usuario/repo» → the trabajo's repository, for «Comprobar en GitHub».
function repoOf(p) {
  const m = p?.share === 'repo' && String(p.repoUrl ?? '').match(/github\.com[/:]([\w.-]{1,100})\/([\w.-]{1,100}?)(?:\.git)?(?:[/?#]|$)/i);
  return m ? { repo: { owner: m[1], name: m[2] } } : {};
}
// The statement as the database keeps it (at most 600 KB compressed, firestore.rules): a statement too long is cut,
// and says so, instead of failing with «Missing or insufficient permissions».
async function fitStatement(text) {
  let t = String(text);
  let packed = await pack(t);
  while (packed.toUint8Array().length > 580_000 && t.length > 1000) {
    t = `${t.slice(0, Math.floor(t.length * 0.8))}

[… Studium guardó solo esta parte: el material completo es demasiado largo para guardarlo; tu IA sí lo recibe entero al escribir la guía.]`;
    packed = await pack(t);
  }
  return packed;
}
// The PDFs, pictures and other files of the statement, kept on this device next to the trabajo: a guide written again
// (after a failure or «Intentarlo otra vez») gets them too, not only their names.
const keepFiles = (tid, files) => draftStore('readwrite', (st) => st.put({ kind: 'files', owner: uid(), files, saved: Date.now() }, `files:${tid}`)).catch(() => {});
const filesOf = (tid) => draftStore('readonly', (st) => st.get(`files:${tid}`)).then((x) => x?.files ?? []).catch(() => []);
async function createTrabajo() {
  const { texts, binaries, notes } = await readAll(draft.files);
  const statement = [draft.text, ...texts].filter(Boolean).join('\n\n');
  if (!statement && !binaries.length) throw new Error(`No se pudo leer lo que trajiste${notes.length ? `: ${notes.join('; ')}` : ''}.`);
  const ref = doc(collection(db, 'trabajos'));
  const code = newCode();
  const batch = writeBatch(db);
  batch.set(ref, {
    title: draft.title.slice(0, 160), course: draft.course.slice(0, 120), group: draft.group.slice(0, 80), deadline: draftDeadline(), prefs: { ...draft.prefs, inFolder: !!(draft.workspace && draft.workspace !== 'temp') },
    parts: draft.parts, owner: uid(), code, ...repoOf(draft.prefs), statement: await fitStatement(statement + (binaries.length ? `\n\n(Archivos entregados a la IA tal como son: ${binaries.map((p) => p.name).join(', ')})` : '')),
    encoding: 'gzip', created: serverTimestamp(), updated: serverTimestamp(),
  });
  batch.set(doc(db, 'trabajos', ref.id, 'miembros', uid()), { name: await myName(), code, joined: serverTimestamp() });
  await batch.commit();
  await keepIds([...(await myIds()), ref.id]);
  keepFolder(ref.id, draft.workspace);
  if (binaries.length) await keepFiles(ref.id, binaries);
  return { id: ref.id, pdfs: binaries, notes };
}
// The questions answered again for a trabajo already created (its guide not written yet): the same trabajo, changed.
// What is brought now is added to the statement kept; nothing of the group (members, parts) changes.
async function updateTrabajo() {
  const tid = draft.tid;
  const snap = await getDoc(tRef(tid));
  if (!snap.exists()) throw new Error('Ese trabajo ya no existe: quizá se eliminó. Empieza uno nuevo.');
  const old = await unpack(snap.data().statement);
  let pdfs = await filesOf(tid);
  let statement = '';
  const { texts, binaries, notes } = await readAll(draft.files);
  const add = [draft.text, ...texts].filter(Boolean).join('\n\n');
  if (binaries.length) { pdfs = [...pdfs, ...binaries]; await keepFiles(tid, pdfs); }
  if (add || binaries.length) statement = `${old}\n\n${add}${binaries.length ? `\n\n(Archivos agregados, entregados a la IA tal como son: ${binaries.map((x) => x.name).join(', ')})` : ''}`;
  await setDoc(tRef(tid), {
    title: draft.title.slice(0, 160), course: draft.course.slice(0, 120), group: draft.group.slice(0, 80), deadline: draftDeadline(), prefs: { ...draft.prefs, inFolder: !!(draft.workspace && draft.workspace !== 'temp') },
    parts: draft.parts, ...repoOf(draft.prefs), ...(statement ? { statement: await fitStatement(statement) } : {}), updated: serverTimestamp(),
  }, { merge: true });
  keepFolder(tid, draft.workspace);
  return { id: tid, pdfs, notes };
}
// Back to the questions from a trabajo whose guide is not written (his words: going back in the draft even from
// «generar», for when the folder got disconnected). Every answer comes back as it was; it opens on «Tu IA» when the
// folder is the problem, else on the last question, and «Atrás» reaches all of them.
async function draftFromTrabajo(at = QUESTIONS.length - 1) {
  const [date = '', time = ''] = String(T.deadline ?? '').split('T');
  const kept = await filesOf(T.id);
  const prefs = { ...PREF_DEFAULT, ...(T.prefs ?? {}) };
  delete prefs.inFolder;
  const folder = folderOf(T.id);
  draft = {
    id: `e${T.id}`, tid: T.id, at, title: T.title ?? '', course: T.course ?? '', text: '', files: [], parts: T.parts ?? 3, group: T.group ?? '', date, time: time.slice(0, 5), pasting: false,
    workspace: folderState(folder) === 'ok' ? folder : 'temp', prefs, kept: { chars: T.statement?.length ?? 0, files: kept.map((f) => ({ name: f.name, size: f.data?.length ?? 0 })) },
  };
  T = null;
  location.hash = '#/trabajos';
}
function working(text, live = false) {
  root.innerHTML = `<div class="tj-wizard tj-working panel glass">${live ? '' : '<div class="tj-spinner" aria-hidden="true"></div>'}<h1>${esc(text)}</h1>${live ? liveHTML('Lo que hace tu IA, ahora') : ''}<p class="lede-small">Puedes dejar esta pestaña abierta y volver en un rato.</p></div>`;
  return live ? liveFeed(root) : null;
}

async function generateOutline(files = [], live = null) {
  const system = outlinePrompt({ parts: T.parts, course: T.course, deadline: deadlineText(T.deadline), prefs: T.prefs });
  const text = `El enunciado del trabajo «${T.title}»${T.group ? ` (grupo: ${T.group})` : ''} y lo que lo acompaña:\n\n${T.statement}`;
  let r;
  try { r = await askAI('solution', system, text, files, `Esquema de «${T.title}»`, live); T.lastError = null; failed.delete(T.id); } catch (e) { T.lastError = errInfo(e, 'Escribir la guía'); failed.set(T.id, T.lastError); throw e; }
  keepResume(T.id, r.resume);
  const outline = cleanOutline(parseJSON(r.text), T.parts);
  await setDoc(tRef(T.id), { outline: await pack(outline), ai: madeBy(r), updated: serverTimestamp() }, { merge: true });
  T.outline = outline; T.ai = madeBy(r);
  await logAI({ task: 'solution', step: 'esquema', model: r.model, provider: r.way, prompt: `${system}\n\n[el enunciado y lo que lo acompaña: ${T.statement.length} caracteres]` });
}
// The whole guide in one request, when the writer works in a folder (the bridge): the outline and every chapter come
// back as files. Otherwise (an AI with no folder), the outline and then one chapter per request, as before.
// An older bridge cannot hand back files: with it, the guide goes chapter by chapter (and the page asks to update it).
const wholeAtOnce = () => ai.choice('solution').provider === 'bridge:claude' && T.prefs?.writeAll !== 'outline' && !ai.bridgeOld();
async function generateWhole(files = [], live = null) {
  const system = wholePrompt({ parts: T.parts, course: T.course, deadline: deadlineText(T.deadline), prefs: T.prefs });
  const text = `El enunciado del trabajo «${T.title}»${T.group ? ` (grupo: ${T.group})` : ''} y lo que lo acompaña:

${T.statement}`;
  let r;
  try { r = await askAI('solution', system, text, files, `Guía completa de «${T.title}»`, live); T.lastError = null; failed.delete(T.id); } catch (e) { T.lastError = errInfo(e, 'Escribir la guía'); failed.set(T.id, T.lastError); throw e; }
  keepResume(T.id, r.resume);
  const got = r.outputs ?? {};
  if (!got['esquema.json']) {
    const e = new Error(`Tu IA terminó sin escribir el esquema de la guía (salida/esquema.json).${Object.keys(got).length ? ` Escribió: ${Object.keys(got).join(', ')}.` : ''}`);
    T.lastError = errInfo(e, 'Escribir la guía'); failed.set(T.id, T.lastError); throw e;
  }
  const outline = cleanOutline(parseJSON(got['esquema.json']), T.parts);
  await setDoc(tRef(T.id), { outline: await pack(outline), ai: madeBy(r), updated: serverTimestamp() }, { merge: true });
  T.outline = outline; T.ai = madeBy(r);
  for (const h of outline.hitos) {
    const file = got[`${h.id}.json`];
    if (!file) continue; // written later with «Escribir el capítulo que falta»
    try {
      const data = cleanMilestone(parseJSON(file), h);
      await setDoc(tRef(T.id, 'hitos', h.id), { data: await pack(data), encoding: 'gzip', by: uid(), ai: madeBy(r), updated: serverTimestamp() });
      T.hitos[h.id] = { ...data, by: uid(), ai: madeBy(r) };
    } catch (e) { console.warn('chapter', h.id, e); }
  }
  await logAI({ task: 'solution', step: 'guía completa', model: r.model, provider: r.way, prompt: `${system}

[el enunciado y lo que lo acompaña: ${T.statement.length} caracteres]` });
}
async function generateMilestone(hid, live = null) {
  const milestone = T.outline.hitos.find((h) => h.id === hid);
  const system = milestonePrompt({ milestone, outline: T.outline, prefs: T.prefs });
  const r = await askAI('solution', system, `Escribe el hito ${hid} completo.`, [], `Hito ${hid} de «${T.title}»`, live);
  keepResume(T.id, r.resume);
  const data = cleanMilestone(parseJSON(r.text), milestone);
  await setDoc(tRef(T.id, 'hitos', hid), { data: await pack(data), encoding: 'gzip', by: uid(), ai: madeBy(r), updated: serverTimestamp() });
  T.hitos[hid] = { ...data, by: uid(), ai: madeBy(r) };
  await logAI({ task: 'solution', step: hid, model: r.model, provider: r.way, prompt: `${system.split('El esquema de la guía:')[0]}[el esquema de la guía]` });
}

/* ---------- joining: one tap, with the person's own name ---------- */
async function renderJoin(tid, code) {
  root.innerHTML = `<form class="tj-wizard panel glass" id="tj-join" data-tid="${esc(tid)}" data-code="${esc(code)}">
      <h1>Te invitaron a un trabajo en grupo</h1>
      <p class="lede-small">Al entrar, el grupo verá tu nombre, la parte que tomes y tu avance.</p>
      <div class="tj-wizard-nav"><a class="link" href="#/trabajos">Ahora no</a><span></span><button class="button primary" type="submit">Entrar al trabajo</button></div>
      <p class="fine" id="tj-join-status" role="status"></p>
    </form>`;
}
async function join(form) {
  const { tid, code } = form.dataset;
  await setDoc(tRef(tid, 'miembros', uid()), { name: await myName(), code, joined: serverTimestamp() });
  await keepIds([...(await myIds()), tid]);
  T = null;
  location.hash = `#/trabajos/${tid}`;
}

/* ---------- the guide: an environment of its own, laid out like a study guide ---------- */
// It opens apart from Studium's page (no Studium bar, no decoration), as the study guides do: a dark top bar with the
// chapters and a progress line, a hero, numbered chapter bands, steps with the theory beside what to expect, the code
// with each line explained, and the questions folded. Its own light and dark theme, kept in this browser.
const THEME = 'studium-tjg-theme';
const steps = () => (T.outline?.hitos ?? []).flatMap((h, i) => h.pasos.map((p, j) => ({ ...p, hito: h.id, num: `${i + 1}.${j + 1}` })));
const partOf = (u) => Object.entries(T.taken).find(([, x]) => x === u)?.[0] ?? '';
const myPart = () => partOf(uid());
const nameOf = (u) => T.members.find((m) => m.uid === u)?.name ?? 'alguien';
const mark = (key) => T.avance[uid()]?.[key] ?? {};
const doneBy = (key) => T.members.filter((m) => T.avance[m.uid]?.[key]?.d);
const isDone = (key) => doneBy(key).length > 0;
const avatar = (letter, title = '') => `<i class="av" style="--pc:${letter ? colorOf(letter) : 'var(--muted)'}" ${title ? `title="${esc(title)}"` : ''}>${esc(letter || '·')}</i>`;
const short = (t, n = 22) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const gRoot = () => $('#tjg-body');
const scroller = () => $('#view-trabajo');

function fonts() {
  if (document.getElementById('tjg-fonts')) return;
  const link = document.createElement('link');
  link.id = 'tjg-fonts'; link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&family=Fraunces:opsz,wght@9..144,500..800&display=swap';
  document.head.append(link);
}
// The guide's look: three templates, chosen when the guide is made and changeable by each reader (kept on their device).
export const TEMPLATES = {
  cuaderno: { name: 'Cuaderno', note: 'claro y cálido, con resaltador: como tus apuntes' },
  pizarra: { name: 'Pizarra', note: 'oscuro y sereno, para concentrarse de noche' },
  revista: { name: 'Revista', note: 'editorial, con aire y títulos grandes' },
};
const TPL = 'studium-tjg-template';
function templateOf() {
  try { const m = JSON.parse(localStorage.getItem(TPL) ?? '{}'); if (TEMPLATES[m[T.id]]) return m[T.id]; } catch { /* the trabajo's */ }
  return TEMPLATES[T.prefs?.template] ? T.prefs.template : 'cuaderno';
}
function keepTemplate(id) { try { const m = JSON.parse(localStorage.getItem(TPL) ?? '{}'); m[T.id] = id; localStorage.setItem(TPL, JSON.stringify(m)); } catch { /* this time only */ } }
// A small, real sample of a guide in a template, for choosing it.
function templateSample(id) {
  return `<div class="tjg-app tpl-sample" data-template="${id}" aria-hidden="true"><div class="wrap">
    <header class="hero"><div><h1>Proyecto final</h1><p>Guía de solución · Machine Learning</p></div></header>
    <section class="sec" style="--c:var(--blue);--cs:var(--blue-s)"><h2><span class="n">1</span>Preparar los datos</h2>
      <article class="step" style="--pc:var(--teal)"><h3><span class="num">1.1</span>Cargar el dataset</h3>
        <p class="key">La idea: <b>separar el test antes de todo</b>, para que nada se filtre.</p>
        <div class="prose"><p>Un <b>pipeline</b> encadena cada paso, así el preprocesamiento aprende solo del entrenamiento.</p></div>
        <div class="fig code"><div class="fh"><span>python</span></div><table><tr><td class="ln">1</td><td class="cd">df = pd.read_csv("casas.csv")</td><td class="ex">Lee el archivo en una tabla.</td></tr></table></div>
      </article></section></div></div>`;
}

function topbar() {
  const all = steps();
  const total = pct(all.filter((s) => isDone(s.id)).length, all.length);
  const caps = T.outline ? [['inicio', '0 · El trabajo'], ['reunion', '◷ · Reunirse'], ...T.outline.hitos.map((h, i) => [h.id, `${i + 1} · ${short(h.titulo)}`]), ['entrega', '✓ · Entregar']] : [];
  return `<nav class="top"><div class="in">
      <a class="back" href="#/trabajos" title="Volver a Studium">← Studium</a>
      <span class="brand">${esc(short((T.course || T.title).toUpperCase(), 26))} · GUÍA DE SOLUCIÓN</span>
      ${caps.map(([id, label]) => `<a href="#cap-${esc(id)}" data-tj="jump" data-cap="${esc(id)}">${esc(label)}</a>`).join('')}
      <span class="sp"></span>
      ${myPart() ? `<label class="mine"><input type="checkbox" data-tj="mine" ${onlyMine ? 'checked' : ''}> Solo mi parte</label>` : ''}
      <span class="pct" title="Pasos hechos por el grupo">${total}%</span>
      <select data-tj-template aria-label="Plantilla de la guía">${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}" ${templateOf() === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
      <button type="button" data-tj="theme">Claro / oscuro</button>
    </div><div class="prog" style="width:${total}%"></div></nav>`;
}

function hero() {
  const all = steps();
  return `<header class="hero">
      <div><h1 class="no-i18n">${esc(T.title)}</h1>
      <p>Guía de solución${T.course ? ` · ${esc(T.course)}` : ''}${T.group ? ` · ${esc(T.group)}` : ''}${T.deadline ? ` · entrega: ${esc(deadlineText(T.deadline))}` : ''} · pasa el cursor sobre lo subrayado con puntos para ver su definición</p></div>
      <div class="team">${T.members.map((m) => {
        const L = partOf(m.uid);
        const own = all.filter((s) => s.parte === L);
        const p = pct(own.filter((s) => T.avance[m.uid]?.[s.id]?.d).length, own.length);
        return `<span>${avatar(L)}${esc(m.name)}${L ? ` <small>${p}%</small>` : ''}</span>`;
      }).join('')}<button type="button" class="ghost" data-tj="invite">+ Invitar</button></div>
    </header>`;
}

function stepChecks(key, label, doneWord = 'Lo hice') {
  const m = mark(key);
  const others = doneBy(key).filter((x) => x.uid !== uid()).map((x) => x.name);
  const a = asking.get(key);
  return `<div class="checks">
      <label class="tick ${m.d ? 'on' : ''}"><input type="checkbox" data-tj="d" data-key="${esc(key)}" ${m.d ? 'checked' : ''}> ${doneWord}</label>
      <label class="tick ${m.u ? 'on' : ''}"><input type="checkbox" data-tj="u" data-key="${esc(key)}" ${m.u ? 'checked' : ''}> Lo entiendo</label>
      <button type="button" class="ask" data-tj="ask" data-key="${esc(key)}" data-label="${esc(label)}">No lo entiendo</button>
      ${others.length ? `<span class="mut">Ya lo hizo ${esc(others.join(', '))}</span>` : ''}${m.c ? `<span class="mut mono">commit ${esc(m.c.slice(0, 7))}</span>` : ''}
    </div>${a ? `<div class="answer">${a.busy ? '<span class="mut">Tu IA te lo está explicando…</span>' : a.error ? `<span class="bad">${esc(a.error)}</span>` : `${md(a.text)}<p class="mut small">Explicado por ${esc(a.model)}.</p>`}</div>` : ''}`;
}

function aiBlock(task) {
  if (!ai.ready()) return `<p>Todavía no conectaste una IA en Studium. <button type="button" class="ask" data-tj="connect" data-vendor="${task === 'tutor' ? 'gemini' : 'anthropic'}" data-bridge="${task === 'tutor' ? '' : '1'}">Conectar ${task === 'tutor' ? 'Gemini, gratis' : 'tu Claude'}</button></p>`;
  return `<div class="pick">${ai.pickerHTML(task)}</div>${task === 'solution' && ai.choice(task).provider.startsWith('bridge:') ? watchBox() : ''}`;
}

function intro() {
  const o = T.outline;
  const letters = LETTERS.slice(0, T.parts).split('');
  const all = steps();
  const missing = o.hitos.filter((h) => !T.hitos[h.id]).length;
  // A guide made before «razonamiento» existed mixed what to know with how the AI read the material: all of it folds.
  const older = o.razonamiento === undefined;
  const notices = older ? [] : o.avisos;
  const reading = older ? o.avisos.map((x) => `- ${x}`).join('\n') : o.razonamiento;
  return `<section class="sec" id="cap-inicio" style="--c:var(--blue);--cs:var(--blue-s)">
      <h2><span class="n">0</span>De qué se trata ${adjButton('esquema')}</h2>
      <div class="row"><div class="prose no-i18n">${md(o.de_que_trata || o.resumen)}
          ${o.diagrama ? `<figure class="diagram"><pre class="mermaid">${esc(o.diagrama)}</pre></figure>` : ''}</div>
        <div>${notices.length ? `<div class="trap"><b>Antes de empezar</b><ul class="tight">${notices.map((x) => `<li>${inline(x)}</li>`).join('')}</ul></div>` : ''}
          ${reading ? `<details class="q reading"><summary class="qh">Cómo entendió tu IA el material</summary><div class="ans no-i18n">${md(reading)}</div></details>` : ''}</div></div>
      ${statementBlock()}
      ${rulesBlock()}
      <h3>Cómo se reparten</h3>
      <p>Cada uno toma una parte y avanza en paralelo. Aun así, <b>todos entienden toda la guía</b>: la defensa es de todos.</p>
      <div class="parts">${letters.map((L) => {
        const holder = T.taken[L];
        const mine = all.filter((s) => s.parte === L);
        const what = (o.partes ?? []).find((x) => x.letra === L)?.resumen ?? '';
        return `<div class="part" style="--pc:${colorOf(L)}">${avatar(L)}<div class="part-body"><b>Persona ${L}</b>${what ? `<p class="part-what no-i18n">${inline(what)}</p>` : ''}
            <details ${holder === uid() ? 'open' : ''}><summary class="mut">${mine.length} ${mine.length === 1 ? 'paso' : 'pasos'}</summary><ol class="part-steps">${mine.map((s) => `<li><a href="#paso-${esc(s.id)}" data-tj="jump"><span class="num">${esc(s.num)}</span> ${esc(s.titulo)}</a>${isDone(s.id) ? ' ✓' : ''}</li>`).join('')}</ol></details></div>
          ${holder ? `<span class="who">${esc(nameOf(holder))}${holder === uid() ? ' <button type="button" class="ask" data-tj="leave">soltar</button>' : ''}</span>` : myPart() ? '<span class="mut">libre</span>' : `<button type="button" class="act" data-tj="take" data-part="${L}">Es la mía</button>`}</div>`;
      }).join('')}</div>
      ${missing ? `<div class="card soft"><p>${missing === o.hitos.length ? 'Los capítulos todavía no están escritos.' : missing === 1 ? 'Falta un capítulo por escribir.' : `Faltan ${missing} capítulos por escribir.`} Quedó lo que tu IA alcanzó a escribir.</p>${aiBlock('solution')}<p><button type="button" class="act" data-tj="gen-all">Escribir ${missing === 1 ? 'el capítulo que falta' : `los ${missing} capítulos`}</button> <span class="mut" id="tj-gen-status" role="status"></span></p></div>` : ''}
      ${(o.preguntas ?? []).length && !T.prefs?.answers ? `<div class="card soft questions"><h4>Antes de seguir, tu IA quiere confirmar contigo</h4>
        ${o.preguntas.map((q, i) => `<label class="qa"><b>${esc(q.pregunta)}</b>${q.por_que ? `<span class="mut small">${esc(q.por_que)}</span>` : ''}<textarea data-tj-answer="${i}" rows="2" placeholder="Tu respuesta"></textarea></label>`).join('')}
        ${T.owner === uid() ? '<p><button type="button" class="act" data-tj="answer">Responder y rehacer el esquema</button> <button type="button" class="ask" data-tj="answer-skip">Seguir sin responder</button> <span class="mut" id="tj-answer-status" role="status"></span></p>' : '<p class="mut small">Quien creó el trabajo responde estas preguntas.</p>'}</div>` : ''}
    </section>`;
}
// The source itself, whole and as it came: what an AI summarizes can lose things (his words).
function statementBlock() {
  const o = T.outline ?? { resumen: '', enunciado_textual: '' };
  const words = String(T.statement ?? '').split(/\s+/).filter(Boolean).length;
  return `<div class="card source"><h3>El enunciado, tal cual</h3>
      <p class="mut">La fuente original y completa${T.outline ? '. Lo de arriba es la lectura de tu IA; esto es lo que dice el profesor' : ', tal como la trajiste'}.</p>
      <details class="q"><summary class="qh">Leer el enunciado completo${words ? ` · ${words.toLocaleString('es')} ${words === 1 ? 'palabra' : 'palabras'}` : ''}</summary><pre class="src">${esc(T.statement)}</pre>
        ${o.enunciado_textual ? `<h4>Lo que dicen los archivos (transcrito por tu IA)</h4><pre class="src">${esc(o.enunciado_textual)}</pre>` : ''}</details>
      ${stepChecks('enunciado', `el enunciado de «${T.title}»: ${o.resumen}`, 'Lo leí completo')}</div>`;
}
// The technical part of the work, once: what is handed in, how it is graded, how, the defense, the dates.
function rulesBlock() {
  const r = T.outline.reglas;
  const has = r && (r.entregables.length || r.calificacion.length || r.modalidad || r.defensa || r.fechas.length);
  const reqs = T.outline.requisitos.filter((x) => x.texto);
  if (!has) {
    return reqs.length ? `<details class="q"><summary class="qh">Lo que pide el enunciado, punto por punto</summary><div class="ans"><ul class="tight">${reqs.map((x) => `<li>${inline(x.texto)}${x.peso ? ` <span class="wt">${esc(x.peso)}</span>` : ''}</li>`).join('')}</ul></div></details>` : '';
  }
  const li = (xs) => `<ul class="tight">${xs.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`;
  return `<h3>Las reglas del trabajo</h3><div class="rules no-i18n">
      ${r.entregables.length ? `<div class="rule"><h4>Se entrega</h4>${li(r.entregables)}</div>` : ''}
      ${r.calificacion.length ? `<div class="rule"><h4>Se califica</h4>${li(r.calificacion)}</div>` : ''}
      ${r.modalidad ? `<div class="rule"><h4>Modalidad</h4><p>${inline(r.modalidad)}</p></div>` : ''}
      ${r.defensa ? `<div class="rule"><h4>Defensa</h4><p>${inline(r.defensa)}</p></div>` : ''}
      ${r.fechas.length ? `<div class="rule"><h4>Fechas</h4>${li(r.fechas)}</div>` : ''}
    </div>
    ${reqs.length ? `<details class="q"><summary class="qh">Lo que pide el enunciado, punto por punto</summary><div class="ans"><ul class="tight">${reqs.map((x) => `<li>${inline(x.texto)}${x.peso ? ` <span class="wt">${esc(x.peso)}</span>` : ''}</li>`).join('')}</ul></div></details>` : ''}`;
}

function stepHTML(s, step) {
  const holder = T.taken[s.parte];
  const code = (step?.codigo ?? []).map((c) => {
    const lines = c.codigo.replace(/\n$/, '').split('\n');
    const expl = new Map(c.lineas.map((l) => [l.n, l.explicacion]));
    return `<div class="fig code"><div class="fh"><span>${esc(c.lenguaje)}</span><span class="sp"></span><button type="button" class="ask" data-tj="copy" data-text="${esc(c.codigo)}">copiar</button></div>
      <table>${lines.map((line, i) => `<tr><td class="ln">${i + 1}</td><td class="cd">${esc(line) || ' '}</td><td class="ex">${expl.has(i + 1) ? inline(expl.get(i + 1)) : ''}</td></tr>`).join('')}</table></div>`;
  }).join('');
  return `<article class="step" id="paso-${esc(s.id)}" style="--pc:${colorOf(s.parte)}">
      <h3><span class="num">${esc(s.num)}</span>${esc(s.titulo)} ${avatar(s.parte, holder ? nameOf(holder) : `Persona ${s.parte}`)} ${step ? adjButton(`paso:${s.id}`) : ''}</h3>
      ${step ? `${step.clave ? `<p class="key no-i18n">${inline(step.clave)}</p>` : ''}<div class="row"><div class="prose no-i18n">${step.objetivo ? `<p class="lead">${inline(step.objetivo)}</p>` : ''}${md(step.teoria)}
          ${step.diagrama ? `<figure class="diagram"><pre class="mermaid">${esc(step.diagrama)}</pre></figure>` : ''}
          ${step.librerias.length ? `<p class="small mut">Usa ${step.librerias.map((l) => `<code title="${esc(l.para_que)}">${esc(l.nombre)}</code>`).join(', ')}.</p>` : ''}</div>
        <div>${step.esperado ? `<div class="def"><h4>Al correrlo verás</h4>${md(step.esperado)}</div>` : ''}
          ${step.comprueba.map((q) => `<details class="q"><summary class="qh">${inline(q.pregunta)}</summary><div class="ans">${md(q.respuesta)}</div></details>`).join('')}
          ${step.commit ? `<p class="small mut">Al guardarlo en GitHub: <code>${esc(step.commit)}</code> <button type="button" class="ask" data-tj="copy" data-text="${esc(step.commit)}">copiar</button></p>` : ''}</div></div>
        ${code}${(step.tu_turno ?? []).length ? `<div class="turn no-i18n"><h4>✋ Tu turno</h4><ul>${step.tu_turno.map((x) => `<li>${inline(x)}</li>`).join('')}</ul></div>` : ''}${stepChecks(s.id, `el paso «${s.titulo}»${step.objetivo ? `: ${step.objetivo}` : ''}`)}` : ''}
    </article>`;
}

function chapter(h, i) {
  const data = T.hitos[h.id];
  const byId = new Map((data?.pasos ?? []).map((p) => [p.id, p]));
  const list = steps().filter((s) => s.hito === h.id && (!onlyMine || s.parte === myPart()));
  const done = steps().filter((s) => s.hito === h.id && isDone(s.id)).length;
  const hue = ['--blue', '--green', '--orange', '--violet', '--rose', '--brown'][i % 6];
  return `<section class="sec" id="cap-${esc(h.id)}" style="--c:var(${hue});--cs:var(${hue}-s)">
      <h2><span class="n">${i + 1}</span>${esc(h.titulo)} ${data ? adjButton(`hito:${h.id}`) : ''}</h2>
      <p class="lead">${h.entregable ? `Al terminar este capítulo tendrán ${esc(lower(h.entregable))}.` : ''} ${h.listo_cuando ? `Está listo cuando ${esc(lower(h.listo_cuando))}.` : ''}</p>
      ${data ? '' : `<div class="card soft"><p>Este capítulo todavía no está escrito. Sus pasos:</p><ol class="tight">${list.map((s) => `<li>${esc(s.titulo)} ${avatar(s.parte)}</li>`).join('')}</ol>${aiBlock('solution')}<p><button type="button" class="act" data-tj="gen" data-hito="${esc(h.id)}">Escribirlo con tu IA</button> <span class="mut" data-status="${esc(h.id)}"></span></p></div>`}
      ${data ? list.map((s) => stepHTML(s, byId.get(s.id))).join('') || '<p class="mut">Tu parte no tiene pasos en este capítulo.</p>' : ''}
      ${data ? `<p class="small mut capfoot">${done} de ${h.pasos.length} pasos hechos · escrito con ${esc(data.ai?.model ?? 'IA')} · <button type="button" class="ask" data-tj="gen" data-hito="${esc(h.id)}">escribirlo otra vez</button></p>` : ''}
    </section>`;
}

// The flashcard trainer: shuffled deck, flip, «Lo sabía» or «Repasar» (that card comes back), the tally.
let fc = null;
const shuffle = (a) => { for (let k = a.length - 1; k > 0; k -= 1) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
function flashDeal(dir = fc?.dir ?? 'term') { fc = { dir, deck: shuffle([...T.outline.glosario]), i: 0, known: 0, seen: 0, open: false, of: T.id }; }
function flashHTML() {
  if (!fc || fc.of !== T.id) flashDeal();
  const c = fc.deck[fc.i];
  const head = `<div class="fc-bar"><label>Sentido <select data-fc-dir><option value="term" ${fc.dir === 'term' ? 'selected' : ''}>término → qué es</option><option value="def" ${fc.dir === 'def' ? 'selected' : ''}>qué es → término</option></select></label><button type="button" class="ask" data-tj="fc-deal">Barajar de nuevo</button></div>`;
  if (!c) return `${head}<div class="flashcard done" tabindex="0"><div class="fc-big">¡Vuelta completa!</div><p>Sabías ${fc.known} de ${fc.seen}. Las que marcaste para repasar volvieron hasta que las supiste.</p></div>`;
  const front = fc.dir === 'term' ? `<div class="fc-big">${esc(c.termino)}</div><div class="mut">¿Qué es y para qué sirve?</div>` : `<div class="fc-q">${esc(c.definicion)}</div><div class="mut">¿Qué término es?</div>`;
  const back = fc.open ? `<div class="fc-back">${fc.dir === 'term' ? `<div class="fc-def">${inline(c.definicion)}</div>` : `<div class="fc-big2">${esc(c.termino)}</div>`}</div>` : '';
  return `${head}<div class="flashcard ${fc.open ? 'open' : ''}" tabindex="0" data-fc-card>${front}${back}</div>
    <div class="fc-btns">${fc.open ? '<button type="button" class="act ok" data-tj="fc-ok">✓ Lo sabía <small>1</small></button><button type="button" class="act again" data-tj="fc-no">↻ Repasar <small>2</small></button>' : '<button type="button" class="act" data-tj="fc-flip">Voltear <small>espacio</small></button>'}</div>
    <p class="mut small">Tarjeta ${fc.i + 1} de ${fc.deck.length} · sabías ${fc.known} de ${fc.seen}</p>`;
}
function flashDo(what) {
  if (!fc) return;
  const c = fc.deck[fc.i];
  if (what === 'flip' && c) fc.open = true;
  if ((what === 'ok' || what === 'no') && c && fc.open) { fc.seen += 1; if (what === 'ok') fc.known += 1; else fc.deck.push(c); fc.i += 1; fc.open = false; }
  if (what === 'deal') flashDeal();
  const el = gRoot().querySelector('[data-fc]');
  if (el) { el.innerHTML = flashHTML(); el.querySelector('[data-fc-card]')?.focus(); }
}
function closing() {
  const all = steps();
  const repo = T.repo ? `${T.repo.owner}/${T.repo.name}` : '';
  const token = !!ai.keyOf('github');
  const defense = T.outline.hitos.flatMap((h) => (T.hitos[h.id]?.pasos ?? []).flatMap((p) => p.defensa));
  const used = T.members.reduce((n, m) => n + (T.ia[m.uid]?.length ?? 0), 0);
  return `<section class="sec" id="cap-entrega" style="--c:var(--rose);--cs:var(--rose-s)">
      <h2><span class="n">✓</span>Entregar y defender</h2>
      <div class="row"><div>
        <h3>Cómo va cada uno</h3>
        <div class="progress">${T.members.map((m) => {
          const L = partOf(m.uid);
          const own = all.filter((s) => s.parte === L);
          const a = T.avance[m.uid] ?? {};
          const pOwn = pct(own.filter((s) => a[s.id]?.d).length, own.length);
          const pU = pct(all.filter((s) => a[s.id]?.u).length, all.length);
          return `<div class="prow">${avatar(L)}<b>${esc(m.name)}</b><span>${L ? `hizo ${pOwn}% de su parte` : 'sin parte'}</span>${bar(pOwn, L ? colorOf(L) : 'var(--muted)')}<span>entiende ${pU}% de la guía</span>${bar(pU, 'var(--blue)')}</div>`;
        }).join('')}</div>
        <p class="small mut">Para la defensa, todos tienen que llegar a entender el 100 % de la guía, no solo su parte.</p>
        <h3>La cita del uso de IA</h3>
        <p>El curso pide decir cómo usaron la IA. Studium guardó qué IA usó cada uno y con qué instrucciones (${used} ${used === 1 ? 'vez' : 'veces'}) y lo arma en un documento para el entregable.</p>
        <p><button type="button" class="act" data-tj="cite">Descargar la cita</button></p>
        ${used ? `<details class="q"><summary class="qh">Ver lo que se usó</summary><div class="ans">${T.members.flatMap((m) => (T.ia[m.uid] ?? []).map((e) => `<details class="q"><summary class="qh">${esc(m.name)} · ${esc(e.task === 'tutor' ? 'explicación' : 'guía')} · ${esc(e.model)}</summary><pre class="src">${esc(e.prompt)}</pre></details>`)).join('')}</div></details>` : ''}
      </div><div>
        ${ai.connected().includes('bridge:claude') ? `<h3>Dónde trabaja tu IA</h3><p class="small mut">En esta computadora, para este trabajo.</p><div class="place">${placeHTML(folderOf(T.id) || 'temp')}</div>
          ${resumeOf(T.id) ? `<p class="small">Para seguir hablando con tu IA sobre este trabajo en tu terminal: <code class="tj-wrap">${esc(resumeOf(T.id))}</code> <button type="button" class="ask" data-tj="copy" data-text="${esc(resumeOf(T.id))}">copiar</button></p>` : ''}` : ''}
        <h3>GitHub</h3>
        <p>Si el commit empieza con el número del paso entre corchetes, Studium lo encuentra y marca ese paso como hecho para ti.</p>
        ${T.owner === uid() ? `<form class="inline" id="tj-repo"><input name="repo" value="${esc(repo)}" placeholder="usuario/repositorio" pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" aria-label="Repositorio"><button class="act" type="submit">Guardar</button></form>` : repo ? `<p><a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener">${esc(repo)}</a></p>` : ''}
        <details class="q"><summary class="qh">${token ? 'Tu GitHub está conectado (solo lectura)' : 'Conectar tu GitHub'}</summary><div class="ans">
          <ol class="tight"><li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">un token nuevo en GitHub</a>.</li>
            <li>Elige <b>solo el repositorio del trabajo</b> y, en «Contents», <b>Read-only</b>. Nada más.</li>
            <li>Genéralo y pégalo aquí. Se guarda cifrado, como tus claves de IA.</li></ol>
          <form class="inline" id="tj-token"><input name="token" type="password" autocomplete="off" placeholder="${PAT}…" aria-label="Token de GitHub"><button class="act" type="submit">Guardar</button>${token ? '<button class="ask" type="button" data-tj="forget-token">olvidar</button>' : ''}</form></div></details>
        ${repo ? '<p><button type="button" class="act" data-tj="check-gh">Revisar mis commits</button> <span class="mut" id="tj-gh-status" role="status"></span></p>' : ''}
      </div></div>
      ${defense.length ? `<h3>Practicar la defensa</h3><p>Las preguntas que les podrían hacer. Respóndanlas en voz alta antes de abrir la respuesta.</p><div class="cols2">${defense.map((q) => `<details class="q"><summary class="qh">${inline(q.pregunta)}</summary><div class="ans">${md(q.respuesta)}</div></details>`).join('')}</div>` : ''}
      ${T.outline.glosario.length ? (T.prefs?.cards === false
    ? `<h3>Términos</h3><dl class="gloss">${T.outline.glosario.map((g) => `<dt>${esc(g.termino)}</dt><dd>${esc(g.definicion)}</dd>`).join('')}</dl>`
    : `<h3>Tarjetas de términos ${adjButton('glosario')}</h3><p>Di en voz alta qué significa y voltea. <span class="mut small">Espacio voltea · 1 lo sabía · 2 repasar</span></p><div class="fc-trainer" data-fc>${flashHTML()}</div>
      <details class="q"><summary class="qh">Ver todos los términos</summary><dl class="gloss">${T.outline.glosario.map((g) => `<dt>${esc(g.termino)}</dt><dd>${esc(g.definicion)}</dd>`).join('')}</dl></details>`) : ''}
    </section>`;
}

function noOutline() {
  const gone = usesFolder() && folderState(folderOf(T.id)) === 'gone';
  return `<section class="sec" id="cap-inicio" style="--c:var(--blue);--cs:var(--blue-s)"><h2><span class="n">0</span>La guía todavía no está escrita</h2><div class="card soft">${T.owner === uid()
    ? `${gone ? `<div class="tj-gone"><p><b>Tu carpeta se desconectó del puente.</b> Se cerró o reinició el puente, o pasó el tiempo que la prestaste. Sin ella, tu IA no puede trabajar ahí.</p>
        <p><button type="button" class="act" data-tj="folder-pick">Elegir la carpeta otra vez</button> <button type="button" class="ask" data-tj="folder-forget">Seguir sin ella</button> <button type="button" class="ask" data-tj="edit-questions" data-at="ai">Volver a las preguntas</button></p><p class="fine" id="tj-folder-status" role="status"></p></div>` : ''}
      ${errorBox(T.lastError ?? failed.get(T.id))}<p>Tu IA lee el enunciado y arma los capítulos: qué pide el trabajo, cómo se reparten y cada paso explicado.</p>${aiBlock('solution')}${ai.ready() ? `${ai.choice('solution').provider === 'bridge:claude' ? accountPick() : ''}<p><button type="button" class="act" data-tj="outline">${(T.lastError ?? failed.get(T.id)) ? 'Intentarlo otra vez' : 'Escribir la guía'}</button> <span class="mut" id="tj-gen-status" role="status"></span></p>` : ''}
      <p class="small"><button type="button" class="ask" data-tj="edit-questions">← Volver a las preguntas</button> <span class="mut">cambia lo que elegiste (la IA, la carpeta, cómo quieres la guía…) antes de escribirla</span></p>`
    : '<p>Quien creó el trabajo todavía no escribió la guía.</p>'}</div></section>`;
}

function paint() {
  if (!T) return;
  prepareTerms();
  const theme = localStorage.getItem(THEME) ?? '';
  const meet = reunionSection(T, { repaint, ref: tRef, people: () => T?.members ?? [] });
  gRoot().innerHTML = `<div class="tjg-app" data-template="${templateOf()}" ${theme ? `data-theme="${theme}"` : ''}>${topbar()}<div class="wrap">${hero()}${T.outline ? intro() + meet + T.outline.hitos.map(chapter).join('') + closing() : noOutline() + meet}</div></div>`;
  markChapter();
  drawDiagrams();
  paintTray();
}
// Diagrams the AI wrote in Mermaid, drawn by Mermaid itself (jsDelivr, pinned), only when there are some. Each one is
// drawn once and kept: the guide repaints whenever someone marks a step or takes a part, and redrawing every diagram
// each time made the page feel slow.
// Node labels in quotes: A[Cliente (casa)] → A["Cliente (casa)"], also in { } and ( ); quotes inside become ’.
const SHAPES = [['[[', ']]'], ['[(', ')]'], ['([', '])'], ['((', '))'], ['{{', '}}'], ['[', ']'], ['(', ')'], ['{', '}']];
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function quoteLabels(t) {
  return String(t).split('\n').map((line) => {
    let out = '';
    let i = 0;
    const id = /\b[A-Za-z_][\w-]*/g;
    for (;;) {
      id.lastIndex = i;
      const m = id.exec(line);
      if (!m) { out += line.slice(i); break; }
      out += line.slice(i, m.index + m[0].length);
      i = m.index + m[0].length;
      const shape = SHAPES.find(([open]) => line.startsWith(open, i));
      if (!shape || line[i + shape[0].length] === '"') continue;
      // Its own closing, where an arrow, «&», «;», «:::» or the end of the line follows.
      const from = i + shape[0].length;
      const end = new RegExp(`${reEsc(shape[1])}(?=\\s*(?:-|=|&|;|:::|$))`, 'g');
      end.lastIndex = from;
      const c = end.exec(line);
      if (!c) continue;
      const label = line.slice(from, c.index);
      out += /[()"'{}[\]]/.test(label) ? `${shape[0]}"${label.replace(/"/g, '’')}"${shape[1]}` : `${shape[0]}${label}${shape[1]}`;
      i = c.index + shape[1].length;
    }
    return out;
  }).join('\n');
}
let mermaidLib = null;
const drawn = new Map();
async function drawDiagrams() {
  const nodes = [];
  for (const n of gRoot().querySelectorAll('pre.mermaid:not([data-processed])')) {
    const svg = drawn.get(n.textContent);
    if (svg) { n.innerHTML = svg; n.dataset.processed = 'true'; } else nodes.push(n);
  }
  if (!nodes.length) return;
  const sources = nodes.map((n) => n.textContent);
  try {
    mermaidLib ??= import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs').then((m) => { m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' }); return m.default; });
    const mermaid = await mermaidLib;
    // A diagram with a mistake is never drawn as Mermaid's «Syntax error» bomb: first its labels are put in quotes (the
    // usual mistake: parentheses or quotes inside [ ] or { }); if it still does not parse, the figure is left out.
    const ok = [];
    for (const n of nodes) {
      const text = n.textContent;
      const valid = async (t) => (await mermaid.parse(t, { suppressErrors: true })) !== false;
      let use = (await valid(text)) ? text : '';
      if (!use) { const fixed = quoteLabels(text); if (await valid(fixed)) use = fixed; }
      if (use) { n.textContent = use; ok.push(n); } else n.closest('figure')?.remove();
    }
    if (ok.length) await mermaid.run({ nodes: ok, suppressErrors: true });
    ok.forEach((n) => { if (n.isConnected && n.querySelector('svg') && !/Syntax error/.test(n.textContent)) drawn.set(sources[nodes.indexOf(n)], n.innerHTML); else n.closest('figure')?.remove(); });
  } catch { for (const n of nodes) n.closest('figure')?.classList.add('as-text'); }
}
// The chapter being read is lit in the top bar.
function markChapter() {
  const sc = scroller();
  if (!sc) return;
  let current = 'inicio';
  for (const s of gRoot().querySelectorAll('section.sec')) if (s.getBoundingClientRect().top < 140) current = s.id.slice(4);
  for (const a of gRoot().querySelectorAll('nav.top a[data-cap]')) a.classList.toggle('on', a.dataset.cap === current);
}

async function openTrabajo(tid) {
  fonts();
  if (T?.id !== tid || T.viewer !== uid()) {
    gRoot().innerHTML = '<p class="tjg-status">Abriendo el trabajo…</p>';
    T = await loadTrabajo(tid);
    asking.clear();
    resetReunion();
    if (!T) { gRoot().innerHTML = '<p class="tjg-status">Ese trabajo no existe, o no eres parte de él. <a href="#/trabajos">Volver</a></p>'; return; }
  }
  paint();
  scroller()?.scrollTo({ top: 0 });
  if (ai.connected().includes('bridge:claude')) ai.bridgeFolders().then(() => { if (T?.id === tid) repaint(); }).catch(() => {});
}

/* ---------- what the buttons do ---------- */
const say = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
async function busy(button, work) {
  const was = button?.disabled;
  if (button) button.disabled = true;
  try { await work(); } catch (e) { console.error(e); ctx?.toast?.(e?.code && ctx.explain ? ctx.explain(e) : e?.message || 'No se pudo: vuelve a intentarlo.'); throw e; } finally { if (button && button.isConnected) button.disabled = was; }
}
// Repaint, keeping the place on the page.
function repaint() { const sc = scroller(); const y = sc?.scrollTop ?? 0; paint(); if (sc) sc.scrollTop = y; }
function toggle(kind, key, on) {
  const mine = { ...(T.avance[uid()] ?? {}) };
  mine[key] = { ...(mine[key] ?? {}), [kind]: on };
  if (kind === 'd' && !on) delete mine[key].c;
  T.avance[uid()] = mine;
  return saveAvance();
}
async function ask(key, label) {
  if (!ai.ready()) { ctx.toast('Conecta una IA en Ajustes: la clave gratis de Gemini sirve.'); return; }
  asking.set(key, { busy: true }); repaint();
  const text = `Trabajo: «${T.title}»${T.course ? ` (curso ${T.course})` : ''}.\nNo entiendo ${label}.\nExplícamelo.`;
  try {
    const r = await askAI('tutor', TUTOR, text, [], 'No lo entiendo');
    asking.set(key, { text: r.text, model: r.model });
    await logAI({ task: 'tutor', step: key, model: r.model, provider: r.way, prompt: `${TUTOR}\n\n${text}` });
  } catch (e) { asking.set(key, { error: e.message }); }
  repaint();
}
async function writeAll(button) {
  const missing = T.outline.hitos.filter((h) => !T.hitos[h.id]);
  const box = button.closest('.card') ?? gRoot();
  startWork();
  for (const [i, h] of missing.entries()) {
    if (stopped()) break;
    box.querySelector('[data-live]')?.remove();
    box.insertAdjacentHTML('beforeend', liveHTML(`Capítulo ${T.outline.hitos.indexOf(h) + 1} (${i + 1} de ${missing.length}): ${h.titulo}`));
    await generateMilestone(h.id, liveFeed(box));
  }
  repaint();
}
async function checkGitHub() {
  const token = ai.keyOf('github');
  const { owner, name } = T.repo;
  say('#tj-gh-status', 'Leyendo tus commits…');
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=100`, { headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (res.status === 404 || res.status === 401) throw new Error(token ? 'GitHub no deja leer ese repositorio con tu token: revisa que incluya ese repositorio con «Contents: Read-only».' : 'El repositorio es privado: conecta tu GitHub (solo lectura) arriba.');
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}.`);
  const commits = await res.json();
  const all = steps();
  const ids = new Set(all.map((s) => s.id));
  const found = new Map();
  for (const c of commits) {
    for (const m of String(c.commit?.message ?? '').matchAll(/\[([A-Z]{1,2}\d{1,3}\.\d{1,3})\]/g)) if (ids.has(m[1]) && !found.has(m[1])) found.set(m[1], c.sha);
  }
  const part = myPart();
  const mine = { ...(T.avance[uid()] ?? {}) };
  let marked = 0;
  for (const [id, sha] of found) {
    if (part && all.find((x) => x.id === id).parte !== part) continue;
    if (!mine[id]?.d) marked += 1;
    mine[id] = { ...(mine[id] ?? {}), d: true, c: sha };
  }
  T.avance[uid()] = mine;
  if (marked) await saveAvance();
  repaint();
  say('#tj-gh-status', marked ? `Listo: ${marked} ${marked === 1 ? 'paso marcado como hecho' : 'pasos marcados como hechos'}.` : 'No hay pasos nuevos en tus commits.');
}

function citation() {
  const lines = [`# Uso de inteligencia artificial en «${T.title}»`, '',
    `Este trabajo${T.course ? ` del curso ${T.course}` : ''} se desarrolló en grupo con **Studium** (alexanderkholodov.web.app/studium), una plataforma de estudio. Studium generó, con la IA que eligió cada integrante, una guía de solución a partir del enunciado y la rúbrica: la teoría, el código en piezas con cada línea explicada y preguntas para comprobar la comprensión. Cada integrante escribió y ejecutó el código personalmente siguiendo la guía, marcó qué entendió y qué hizo, y consultó a su IA cuando no entendía algo. Abajo están las IA, los modelos y las instrucciones (prompts) usados, por integrante.`, '',
    '## Integrantes y partes', ...T.members.map((m) => { const L = partOf(m.uid); return `- ${m.name}${L ? ` (Persona ${L})` : ''}`; }), '',
    '## Modelos usados', ...[...new Set(T.members.flatMap((m) => (T.ia[m.uid] ?? []).map((e) => `${e.model} (${e.provider})`)))].map((x) => `- ${x}`), ''];
  for (const m of T.members) {
    const log = T.ia[m.uid] ?? [];
    if (!log.length) continue;
    lines.push(`## ${m.name}`, '');
    for (const e of log) lines.push(`### ${new Date(e.at).toLocaleString('es')} · ${e.task === 'tutor' ? 'Explicación' : 'Guía de solución'} · ${e.step} · ${e.model}`, '', '```text', String(e.prompt ?? ''), '```', '');
  }
  lines.push('## Créditos', '', '- Studium, plataforma de estudio en la que se generó y siguió la guía: alexanderkholodov.web.app/studium', `- Fecha de esta cita: ${new Date().toLocaleDateString('es')}`);
  return lines.join('\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function wire(root) {
  root.addEventListener('mouseup', () => { if (T?.outline && root.querySelector('.tjg-app')) setTimeout(showSelButton, 0); });
  root.addEventListener('mousedown', (e) => { if (!e.target.closest?.('.tj-selbtn')) hideSelButton(); });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && root.querySelector('.tj-adjpop')) { root.querySelector('.tj-adjpop').remove(); return; }
    if (!ev.target.closest?.('[data-fc]')) return;
    if (ev.key === ' ') { ev.preventDefault(); flashDo('flip'); } else if (ev.key === '1') flashDo('ok'); else if (ev.key === '2') flashDo('no');
  });
  root.addEventListener('change', (ev) => { if (ev.target.matches?.('[data-fc-dir]')) { flashDeal(ev.target.value); flashDo(''); } });
  root.addEventListener('input', () => { if (draft && root.querySelector('.tj-wizard')) { keepAnswer(); saveDraft(); } });
  root.addEventListener('toggle', (ev) => { if (draft && ev.target.matches?.('[data-tj-more]')) draft.moreOpen = ev.target.open; }, true);
  root.addEventListener('submit', async (ev) => {
    const form = ev.target;
    ev.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (form.matches('[data-adj-form]')) {
      const f = new FormData(form);
      const t = targetOf(form.dataset.key);
      const c = { ...t, quote: String(f.get('quote') ?? ''), kinds: f.getAll('kinds').map(String), note: String(f.get('note') ?? '').trim(), at: Date.now() };
      if (!c.kinds.length && !c.note) { form.querySelector('textarea').placeholder = 'Marca qué cambiar o escríbelo aquí'; form.querySelector('textarea').focus(); return; }
      form.closest('.tj-adjpop')?.remove();
      getSelection()?.removeAllRanges();
      if (ev.submitter?.dataset.now) { await runAdjust([c], null); return; }
      adjKeep([...adjList(), c]);
      ctx.toast('Agregado a los cambios por aplicar.');
      return;
    }
    if (form.id === 'tj-wizard') {
      if (QUESTIONS[draft.at].input !== 'ready') { nextQuestion(); return; }
      const later = !!ev.submitter?.dataset.later;
      if (!later && usesFolder() && (await folderStateNow(draft.workspace)) === 'gone') {
        draft.workspace = 'temp';
        draft.at = QUESTIONS.findIndex((x) => x.input === 'ai');
        renderDraft(FOLDER_GONE);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      try {
        if (draft.prefs.share === 'newrepo' && draft.prefs.repoBy && draft.prefs.repoBy !== 'guide') { working('Creando el repo en tu GitHub…'); await makeRepo(draft.prefs); }
        working(draft.tid ? 'Guardando tus respuestas…' : 'Creando el trabajo…');
        const made = draft.tid ? await updateTrabajo() : await createTrabajo();
        T = await loadTrabajo(made.id);
        dropDraft(draft.id);
        draft = null;
        if (!later && ai.ready()) {
          const live = working('Tu IA está leyendo el enunciado y armando la guía', true);
          startWork();
          try {
            if (wholeAtOnce()) await generateWhole(made.pdfs, live);
            else await generateOutline(made.pdfs, live);
            // Everything at once, unless the group wanted to review the outline first or the AI has questions.
            if (!wholeAtOnce() && T.prefs?.writeAll !== 'outline' && !(T.outline?.preguntas ?? []).length) {
              for (const [i, h] of T.outline.hitos.entries()) {
                if (stopped()) break;
                const feed = working(`Capítulo ${i + 1} de ${T.outline.hitos.length}: ${h.titulo}`, true);
                await generateMilestone(h.id, feed);
              }
            }
            if (!stopped()) await releaseFolder(made.id);
          } catch (e) { const info = T.lastError?.message === e.message ? T.lastError : errInfo(e, 'Escribir la guía'); failed.set(made.id, info); }
        }
        location.hash = `#/trabajos/${made.id}`;
      } catch (e) { console.error(e); renderDraft(e); }
    } else if (form.dataset.edit) {
      const f = new FormData(form);
      const date = String(f.get('date') ?? ''); const time = String(f.get('time') ?? '');
      await busy(button, async () => {
        await setDoc(tRef(form.dataset.edit), { title: String(f.get('title')).trim().slice(0, 160), course: String(f.get('course') ?? '').trim().slice(0, 120), group: String(f.get('group') ?? '').trim().slice(0, 80), deadline: date ? `${date}${time ? `T${time}` : ''}` : '', updated: serverTimestamp() }, { merge: true });
        ctx.toast('Guardado.'); await renderList();
      }).catch(() => {});
    } else if (form.id === 'tj-join') {
      await busy(button, () => join(form)).catch(() => say('#tj-join-status', 'No se pudo entrar: el enlace no es válido o ya no está vigente.'));
    } else if (form.id === 'tj-repo') {
      const [owner, name] = String(new FormData(form).get('repo') ?? '').trim().split('/');
      await busy(button, async () => {
        await setDoc(tRef(T.id), owner && name ? { repo: { owner, name }, updated: serverTimestamp() } : { updated: serverTimestamp() }, { merge: true });
        T.repo = owner && name ? { owner, name } : null;
        repaint(); ctx.toast('Repositorio guardado.');
      }).catch(() => {});
    } else if (form.id === 'tj-token') {
      const v = String(new FormData(form).get('token') ?? '').trim();
      if (!(v.startsWith(PAT) || v.startsWith(CLASSIC)) || !/^[A-Za-z0-9_]{30,}$/.test(v)) { ctx.toast(`Eso no parece un token de GitHub (empieza con ${PAT}).`); return; }
      ai.setKey('github', v); repaint(); ctx.toast('Conectado, solo lectura.');
    }
  });
  root.addEventListener('change', async (ev) => {
    const el = ev.target;
    const kind = el.dataset?.tj;
    if (kind === 'u' || kind === 'd') {
      try { await toggle(kind, el.dataset.key, el.checked); repaint(); } catch (e) { el.checked = !el.checked; ctx.toast(ctx.explain(e)); }
    } else if (kind === 'mine') { onlyMine = el.checked; repaint(); }
    else if (el.name === 'files' && draft) { keepAnswer(); const list = [...el.files]; reading(); addFiles(list).then(() => renderDraft()); }
    else if (el.name === 'folder' && draft && el.files.length) { keepAnswer(); const list = [...el.files]; reading(); addFolderFiles(list, list[0].webkitRelativePath.split('/')[0]).then(() => renderDraft()); }
    else if (el.dataset?.tjUse) { ai.setChoice(el.dataset.tjUse, { provider: el.value, model: '', effort: '' }); keepAnswer(); renderDraft(); }
    else if (el.dataset?.tjWatch !== undefined) { ai.setWatchTerminal(el.checked); el.closest(".tj-pick")?.classList.toggle("on", el.checked); }
    else if (el.dataset?.tjTemplate !== undefined) { keepTemplate(el.value); gRoot().querySelector('.tjg-app')?.setAttribute('data-template', el.value); }
    else if (el.dataset?.tjAccount !== undefined) { ai.setBridgeAccount(el.value); if (draft) { keepAnswer(); renderDraft(); } else repaint(); }
    else if (el.dataset?.tjWs !== undefined) { if (draft) { draft.workspace = el.value; renderDraft(); } else if (T) { keepFolder(T.id, el.value); repaint(); } }
    else if (el.dataset?.tjMode) {
      try { await ai.changeBridgeFolder(el.dataset.tjMode, { mode: el.value }); ctx.toast(`Permiso cambiado: ${MODE_TEXT[el.value]}.`); } catch (e) { ctx.toast(e.message); }
      if (draft) { keepAnswer(); renderDraft(); } else repaint();
    }
    else if (el.dataset?.tj === 'share-git' && draft) { keepAnswer(); draft.prefs.share = el.value === 'none' ? 'each' : (['repo', 'newrepo'].includes(draft.prefs.share) ? draft.prefs.share : 'repo'); renderDraft(); }
    else if (el.dataset?.tj === 'share-repo' && draft) { keepAnswer(); draft.prefs.share = el.value; renderDraft(); }
    else if (el.dataset?.tjPref) { keepAnswer(); draft.prefs[el.dataset.tjPref] = el.type === 'checkbox' ? el.checked : el.value; renderDraft(); }
    else if (el.closest?.('[data-ai-pick]')) { const task = el.closest('[data-ai-pick]').dataset.aiPick; ai.setChoice(task, ai.picked(task, root)); }
  });
  // Files dropped on the question that asks for them.
  root.addEventListener('dragover', (ev) => { if (ev.target.closest?.('[data-tj-drop]')) { ev.preventDefault(); ev.target.closest('[data-tj-drop]').classList.add('over'); } });
  root.addEventListener('dragleave', (ev) => ev.target.closest?.('[data-tj-drop]')?.classList.remove('over'));
  root.addEventListener('drop', (ev) => {
    if (!ev.target.closest?.('[data-tj-drop]') || !draft) return;
    ev.preventDefault();
    keepAnswer();
    const entries = [...ev.dataTransfer.items ?? []].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    const dirs = entries.filter((e) => e.isDirectory);
    if (!dirs.length) { const list = [...ev.dataTransfer.files]; reading(); addFiles(list).then(() => renderDraft()); return; }
    (async () => {
      reading();
      for (const e of entries.filter((x) => x.isFile)) await addFiles(await readEntry(e));
      for (const d of dirs) await addFolderFiles(await readEntry(d), d.name);
      renderDraft();
    })().catch((e) => renderDraft(e));
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-tj]');
    if (!b || b.tagName === 'INPUT') return;
    const kind = b.dataset.tj;
    if (kind === 'new') { startDraft(); return; }
    if (kind === 'cancel') { keepAnswer(); saveDraft(); draft = null; ctx.toast('Quedó en tus borradores: puedes retomarlo cuando quieras.'); setTimeout(renderList, 400); return; }
    if (kind === 'draft-resume') { const d = await getDraft(b.dataset.id); if (d) { draft = d; renderDraft(); } return; }
    if (kind === 'draft-drop') {
      const card = b.closest('.tj-card');
      if (b.dataset.sure) { await dropDraft(b.dataset.id); await renderList(); return; }
      b.dataset.sure = '1'; b.textContent = '¿Eliminar este borrador? Pulsa otra vez'; card?.classList.add('asking');
      return;
    }
    if (kind === 'back') { keepAnswer(); draft.at = Math.max(0, draft.at - 1); renderDraft(); return; }
    if (kind === 'skip') { const k = QUESTIONS[draft.at].key; if (k === 'deadline') { draft.date = ''; draft.time = ''; } else draft[k] = ''; draft.at += 1; renderDraft(); return; }
    if (kind === 'count') { draft.parts = Number(b.dataset.n); draft.at += 1; renderDraft(); return; }
    if (kind === 'pair-code') {
      const code = b.closest('.tj-bridge')?.querySelector('[data-ai-pair-code]')?.value;
      await busy(b, async () => { if (await pairBridge(code)) { draft.pairing = false; renderDraft(); } }).catch(() => {});
      return;
    }
    if (kind === 'answer' || kind === 'answer-skip') {
      const answers = kind === 'answer' ? T.outline.preguntas.map((q, i) => `${q.pregunta} → ${String(gRoot().querySelector(`[data-tj-answer="${i}"]`)?.value ?? '').trim() || '(sin respuesta)'}`).join('\n') : '(el grupo prefirió seguir sin responder)';
      await busy(b, async () => {
        T.prefs = { ...(T.prefs ?? {}), answers: answers.slice(0, 3000) };
        await setDoc(tRef(T.id), { prefs: T.prefs, updated: serverTimestamp() }, { merge: true });
        if (kind === 'answer') { say('#tj-answer-status', 'Tu IA rehace el esquema con tus respuestas…'); await generateOutline(); }
        repaint();
      }).catch((e) => say('#tj-answer-status', e.message));
      return;
    }
    if (kind === 'swarm') {
      try { localStorage.setItem(SWARM, swarmOn() ? 'off' : 'on'); } catch { /* this time only */ }
      const s = b.closest('[data-live]')?.querySelector('[data-live-swarm]');
      if (s) s.remove(); else b.closest('[data-live]')?.querySelector('.tj-live-head')?.insertAdjacentHTML('afterend', '<div class="tj-swarm" data-live-swarm><i class="core"></i></div>');
      b.textContent = swarmOn() ? 'Ocultar la animación' : 'Mostrar la animación';
      return;
    }
    if (kind === 'share') {
      const r = listRows.find((x) => x.id === b.dataset.id);
      cardExtra(b.dataset.id, '<p class="fine">Cargando tus amigos…</p>');
      cardExtra(b.dataset.id, await invitePanel(b.dataset.id, r?.title ?? 'el trabajo', b.dataset.code));
      return;
    }
    if (kind === 'invite-link') {
      const box = b.closest('.tj-invite');
      const link = inviteLink(box.dataset.tid, box.dataset.code);
      await navigator.clipboard.writeText(link).then(() => ctx.toast('Enlace copiado: pásalo solo a tu grupo.'), () => ctx.toast(`No pude copiarlo. El enlace: ${link}`));
      return;
    }
    if (kind === 'invite-close') { const box = b.closest('.tj-invite'); (box.closest('.tj-invite-pop') ?? box).remove(); return; }
    if (kind === 'invite-send') {
      const box = b.closest('.tj-invite');
      const picked = [...box.querySelectorAll('[data-tj-friend]:checked')];
      const status = box.querySelector('[data-invite-status]');
      if (!picked.length) { status.textContent = 'Marca a quién invitar.'; return; }
      await busy(b, async () => {
        const { done, failed } = await amigos.invite(picked.map((x) => x.value), { tid: box.dataset.tid, title: box.dataset.title, code: box.dataset.code });
        const names = (list) => picked.filter((x) => list.includes(x.value)).map((x) => x.dataset.name).join(', ');
        for (const x of picked) if (done.includes(x.value)) x.closest('label').remove();
        if (!box.querySelector('[data-tj-friend]')) { box.querySelector('.tj-friends')?.remove(); b.remove(); }
        status.textContent = `${done.length ? `Invitaste a ${names(done)}: lo verán en sus Trabajos.` : ''}${failed.length ? ` No pude invitar a ${names(failed)}: quizá ya no son amigos; recarga e inténtalo otra vez.` : ''}`;
      }).catch(() => { status.textContent = 'No se pudo invitar. Inténtalo otra vez.'; });
      return;
    }
    if (kind === 'inv-join') {
      await busy(b, async () => {
        const { tid, code } = b.dataset;
        await setDoc(tRef(tid, 'miembros', uid()), { name: await myName(), code, joined: serverTimestamp() });
        await keepIds([...(await myIds()), tid]);
        await amigos.dropInvitation(tid).catch(() => {});
        T = null;
        location.hash = `#/trabajos/${tid}`;
      }).catch(() => ctx.toast('No se pudo entrar: quizá el trabajo se eliminó o cambió su invitación.'));
      return;
    }
    if (kind === 'inv-drop') { await busy(b, async () => { await amigos.dropInvitation(b.dataset.tid); await renderList(); }).catch(() => {}); return; }
    if (kind === 'edit-open') {
      const r = listRows.find((x) => x.id === b.dataset.id);
      const [date, time] = String(r.deadline ?? '').split('T');
      cardExtra(r.id, `<form class="tj-edit" data-edit="${esc(r.id)}"><label class="field"><span>Título</span><input name="title" maxlength="160" required value="${esc(r.title)}"></label>
        <label class="field"><span>Materia</span><input name="course" maxlength="120" value="${esc(r.course ?? '')}"></label>
        <label class="field"><span>Grupo</span><input name="group" maxlength="80" value="${esc(r.group ?? '')}"></label>
        <div class="tj-when"><label class="field"><span>Entrega</span><input type="date" name="date" value="${esc(date ?? '')}"></label><label class="field"><span>Hora</span><input type="time" name="time" value="${esc(time ?? '')}"></label></div>
        <div class="tj-wizard-nav"><button type="button" class="link" data-tj="extra-close">Cancelar</button><span></span><button class="button primary small" type="submit">Guardar</button></div></form>`);
      return;
    }
    if (kind === 'delete-ask' || kind === 'leave-ask') {
      const r = listRows.find((x) => x.id === b.dataset.id);
      cardExtra(r.id, kind === 'delete-ask'
        ? `<p><b>¿Eliminar «${esc(r.title)}» para todo el grupo?</b> Se borran su guía, el reparto, el avance y el registro de uso de IA. No se puede deshacer.</p><p><button type="button" class="button small red" data-tj="delete" data-id="${esc(r.id)}">Sí, eliminarlo</button> <button type="button" class="link" data-tj="extra-close">No</button></p>`
        : `<p><b>¿Salir de «${esc(r.title)}»?</b> Tu parte queda libre; para volver necesitas otra vez el enlace.</p><p><button type="button" class="button small red" data-tj="leave-trabajo" data-id="${esc(r.id)}">Sí, salir</button> <button type="button" class="link" data-tj="extra-close">No</button></p>`);
      return;
    }
    if (kind === 'extra-close') { b.closest('[data-extra]').innerHTML = ''; return; }
    if (kind === 'delete' || kind === 'leave-trabajo') {
      await busy(b, async () => { if (kind === 'delete') await deleteTrabajo(b.dataset.id); else await leaveTrabajo(b.dataset.id); ctx.toast(kind === 'delete' ? 'Trabajo eliminado.' : 'Saliste del trabajo.'); await renderList(); }).catch(() => {});
      return;
    }
    if (kind === 'bridge-recheck') {
      await busy(b, async () => { await ai.bridgeStatus(); if (draft) { keepAnswer(); renderDraft(); } else repaint(); ctx.toast(ai.bridgeOld() ? 'Sigue abierta la versión anterior del puente.' : `Puente ${ai.bridgeOf()?.version} listo.`); }).catch(() => {});
      return;
    }
    if (kind === 'folder-pick') {
      const mode = 'read';
      const hours = 1; // lent for writing the guide; the page releases it when the guide is written
      say('#tj-folder-status', '');
      const close = pickingNotice();
      await busy(b, async () => {
        const f = await ai.pickBridgeFolder(mode, { hours }).finally(close);
        if (draft) { keepAnswer(); draft.workspace = f.id; renderDraft(); } else if (T) { keepFolder(T.id, f.id); repaint(); }
        ctx.toast(`Carpeta lista: ${f.name} (${MODE_TEXT[f.mode]}).`);
      }).catch((e) => say('#tj-folder-status', e.message));
      return;
    }
    if (kind === 'folder-forget') { keepFolder(T.id, ''); repaint(); ctx.toast('Tu IA trabajará solo con lo que trajiste.'); return; }
    if (kind === 'edit-questions') { await busy(b, () => draftFromTrabajo(b.dataset.at === 'ai' ? QUESTIONS.findIndex((x) => x.input === 'ai') : undefined)).catch(() => {}); return; }
    if (kind === 'folder-renew') {
      say('#tj-folder-status', '');
      const close = pickingNotice();
      await busy(b, async () => {
        const f = await ai.pickBridgeFolder('', { renew: b.dataset.id }).finally(close);
        if (draft) { keepAnswer(); draft.workspace = f.id; renderDraft(); } else repaint();
        ctx.toast(`Carpeta lista otra vez: ${f.name}.`);
      }).catch((e) => say('#tj-folder-status', e.message));
      return;
    }
    if (kind === 'folder-remove') {
      await busy(b, async () => { await ai.changeBridgeFolder(b.dataset.id, { remove: true }); if (draft) { if (draft.workspace === b.dataset.id) draft.workspace = 'temp'; keepAnswer(); renderDraft(); } else repaint(); }).catch(() => {});
      return;
    }
    if (kind === 'err-explain') { await busy(b, () => explainError(b.closest('.tj-error'))).catch(() => {}); return; }
    if (kind === 'adj') { adjOpen(b.dataset.key); return; }
    if (kind === 'adj-close') { b.closest('.tj-adjpop')?.remove(); return; }
    if (kind === 'tray-open' || kind === 'tray-close') { const pnl = gRoot().querySelector('.tj-traypanel'); if (pnl) pnl.hidden = kind === 'tray-close'; return; }
    if (kind === 'adj-drop') { const l = adjList(); l.splice(Number(b.dataset.i), 1); adjKeep(l); const pnl = gRoot().querySelector('.tj-traypanel'); if (pnl && l.length) pnl.hidden = false; return; }
    if (kind === 'adj-clear') { adjKeep([]); return; }
    if (kind === 'adj-undo') { await busy(b, async () => { await undoAdjust(); repaint(); ctx.toast('Volvió como estaba antes del último ajuste.'); }).catch((e) => ctx.toast(e.message)); return; }
    if (kind === 'adj-apply') { await runAdjust(adjList(), b); return; }
    if (kind === 'fc-flip' || kind === 'fc-ok' || kind === 'fc-no' || kind === 'fc-deal') { flashDo(kind.slice(3)); return; }
    if (kind === 'stop') {
      if (ctl && !ctl.signal.aborted) { ctl.abort(); b.disabled = true; b.textContent = 'Deteniendo…'; ctx.toast('Detenido. Tu IA se detuvo en tu computadora.'); }
      return;
    }
    if (kind === 'all-ways') { document.getElementById('tj-ways')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (kind === 'pair-here') { keepAnswer(); draft.pairing = true; renderDraft(); return; }
    if (kind === 'drop-all') { keepAnswer(); draft.files = []; draft.broughtFolder = ''; draft.folderNote = ''; renderDraft(); return; }
    if (kind === 'drop-file') { keepAnswer(); draft.files.splice(Number(b.dataset.i), 1); renderDraft(); return; }
    if (kind === 'connect') { if (draft) keepAnswer(); await connectWay(b.dataset.vendor, !!b.dataset.bridge); return; }
    if (kind === 'paste') { draft.pasting = true; renderDraft(); return; }
    if (kind === 'jump') { ev.preventDefault(); const el = document.getElementById(b.getAttribute('href').slice(1)); if (el) scroller().scrollTo({ top: el.offsetTop - 56, behavior: 'smooth' }); return; }
    if (kind === 'theme') {
      const app = gRoot().querySelector('.tjg-app');
      const dark = app.dataset.theme ? app.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      app.dataset.theme = dark ? 'light' : 'dark';
      localStorage.setItem(THEME, app.dataset.theme);
      return;
    }
    if (kind === 'ask') { await ask(b.dataset.key, b.dataset.label); return; }
    if (kind === 'copy') { await navigator.clipboard.writeText(b.dataset.text).then(() => ctx.toast('Copiado.'), () => ctx.toast('No se pudo copiar.')); return; }
    if (kind === 'invite') {
      const head = b.closest('header') ?? gRoot().querySelector('header');
      const open = gRoot().querySelector('.tj-invite');
      if (open) { open.remove(); return; }
      await busy(b, async () => head.insertAdjacentHTML('afterend', `<div class="tj-invite-pop">${await invitePanel(T.id, T.title, T.code)}</div>`)).catch(() => {});
      return;
    }
    if (kind === 'take') { await busy(b, async () => { await setDoc(tRef(T.id, 'partes', b.dataset.part), { uid: uid(), at: serverTimestamp() }); T.taken[b.dataset.part] = uid(); repaint(); }).catch(() => ctx.toast('Esa parte ya la tomó alguien.')); return; }
    if (kind === 'leave') { const L = myPart(); await busy(b, async () => { await deleteDoc(tRef(T.id, 'partes', L)); delete T.taken[L]; repaint(); }).catch(() => {}); return; }
    if (kind === 'outline') {
      if (usesFolder() && (await folderStateNow(folderOf(T.id))) === 'gone') { repaint(); gRoot().querySelector('.tj-gone')?.scrollIntoView({ block: 'center' }); return; }
      const box = b.closest('.card') ?? gRoot();
      box.insertAdjacentHTML('beforeend', liveHTML('Tu IA está armando la guía'));
      startWork(); await busy(b, async () => { const files = await filesOf(T.id); if (wholeAtOnce()) { await generateWhole(files, liveFeed(box)); await releaseFolder(T.id); } else await generateOutline(files, liveFeed(box)); repaint(); }).catch(() => repaint());
      return;
    }
    if (kind === 'gen-all') { await busy(b, () => writeAll(b)).catch((e) => { const box = b.closest('.card') ?? gRoot(); box.querySelector('[data-live]')?.remove(); box.querySelector('.tj-error')?.remove(); box.insertAdjacentHTML('beforeend', errorBox(errInfo(e, 'Escribir los capítulos'), 'gen-all')); }); return; }
    if (kind === 'gen') {
      const status = (t) => { const el = gRoot().querySelector(`[data-status="${b.dataset.hito}"]`); if (el) el.textContent = t; };
      const box = b.closest('.card, section') ?? gRoot();
      box.insertAdjacentHTML('beforeend', liveHTML('Tu IA escribe este capítulo, con cada línea explicada'));
      startWork(); await busy(b, async () => { await generateMilestone(b.dataset.hito, liveFeed(box)); repaint(); }).catch((e) => { status(''); box.querySelector('[data-live]')?.remove(); box.querySelector('.tj-error')?.remove(); box.insertAdjacentHTML('beforeend', errorBox(errInfo(e, 'Escribir este capítulo'))); });
      return;
    }
    if (kind === 'check-gh') { await busy(b, checkGitHub).catch((e) => say('#tj-gh-status', e.message)); return; }
    if (kind === 'forget-token') { ai.setKey('github', ''); repaint(); return; }
    if (kind === 'cite') { download(`uso-de-ia-${T.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.md`, citation()); }
  });
}

export function mountTrabajos(context) {
  ctx = context;
  root = $('#tj-body');
  wire(root);
  wire($('#tjg-body'));
  wireReunion($('#tjg-body'), (t) => ctx.toast(t));
  $('#view-trabajo').addEventListener('scroll', () => requestAnimationFrame(markChapter), { passive: true });
}

export async function renderTrabajos(arg = []) {
  if (arg[0] === 'unirse' && arg[1] && arg[2]) {
    const ids = await myIds();
    if (ids.includes(arg[1])) { location.hash = `#/trabajos/${arg[1]}`; return; }
    return renderJoin(arg[1], arg[2]);
  }
  if (arg[0]) return openTrabajo(arg[0]);
  T = null;
  if (draft) return renderDraft();
  return renderList();
}
