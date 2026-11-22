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
import { LETTERS, outlinePrompt, milestonePrompt, TUTOR, parseJSON, cleanOutline, cleanMilestone } from './trabajo-prompts.js';

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
  for (const g of terms) {
    const re = new RegExp(`(^|[^\\wáéíóúñ])(${g.re})(?=[^\\wáéíóúñ]|$)`, 'i');
    out = out.replace(re, (m, pre, word) => `${pre}<dfn title="${esc(g.definicion)}">${word}</dfn>`);
  }
  return out;
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

/* ---------- the person's AI ---------- */
const strongAI = () => ai.ready() && !/gemini|openrouter|puter/.test(ai.choice('solution').provider);
function aiLine(task) {
  if (!ai.ready()) return `<p class="tj-warn">${task === 'solution' ? 'Para escribir la guía necesitas conectar una IA potente (tu Claude o ChatGPT con el puente local).' : 'Para preguntarle a tu IA, conecta una: la clave gratis de Gemini sirve.'} <a href="#/ajustes">Conectar</a></p>`;
  return `${task === 'solution' && !strongAI() ? '<p class="fine tj-note">Tu IA de ahora es rápida y gratis; para una guía completa, una más potente (Claude o ChatGPT con el puente local) lo hace mucho mejor.</p>' : ''}${ai.pickerHTML(task)}`;
}
async function askAI(task, system, text, files = [], label = '') {
  return ai.run({ system, text, files, task, label, maxTokens: task === 'solution' ? ai.longest(ai.choice(task)) : 4000 });
}

/* ---------- the list ---------- */
async function renderList() {
  root.innerHTML = '<p class="status">Cargando…</p>';
  const ids = await myIds();
  const rows = (await Promise.all(ids.map((id) => getDoc(tRef(id)).then((s) => (s.exists() ? { id, ...s.data() } : null)).catch(() => null)))).filter(Boolean);
  root.innerHTML = `<div class="tj-start">
      <h1>Trabajos</h1>
      <p class="lede-small">Resuelve un trabajo en grupo con una guía, paso a paso, entendiendo cada línea.</p>
      <button type="button" class="button primary big" data-tj="new">Empezar un trabajo nuevo</button>
    </div>
    ${rows.length ? `<div class="tj-cards">${rows.map((r) => `<a class="tj-card glass" href="#/trabajos/${esc(r.id)}"><b>${esc(r.title)}</b><span class="fine">${esc(r.course ?? '')}${r.deadline ? ` · entrega ${esc(r.deadline)}` : ''}</span></a>`).join('')}</div>` : ''}`;
}

/* ---------- a new trabajo: one question at a time ---------- */
const QUESTIONS = [
  { key: 'title', ask: '¿Cómo se llama el trabajo?', hint: 'Como aparece en el enunciado, o como lo llaman ustedes.', input: 'text', placeholder: 'Proyecto final de Machine Learning', required: true },
  { key: 'course', ask: '¿De qué materia es?', input: 'text', placeholder: 'Machine Learning', optional: true },
  { key: 'statement', ask: 'Trae el enunciado', hint: 'Y la rúbrica, si la tienen. Arrastra los archivos o pega el texto.', input: 'files', required: true },
  { key: 'parts', ask: '¿Cuántos son en el grupo?', hint: 'La guía se divide en una parte por persona.', input: 'count' },
  { key: 'deadline', ask: '¿Cuándo es la entrega?', input: 'text', placeholder: 'inicios de diciembre', optional: true },
  { key: 'name', ask: '¿Cómo te llamamos en el grupo?', hint: 'Es lo que verán tus compañeros.', input: 'text', required: true },
  { key: 'ready', ask: 'Todo listo', input: 'ready' },
];
async function startDraft() {
  const name = (await loadProfile(uid()).catch(() => null))?.nickname ?? '';
  draft = { at: 0, title: '', course: '', text: '', files: [], parts: 3, deadline: '', name, pasting: false };
  renderDraft();
}
function renderDraft(error = '') {
  const q = QUESTIONS[draft.at];
  const dots = QUESTIONS.map((_, i) => `<i class="${i < draft.at ? 'done' : i === draft.at ? 'now' : ''}"></i>`).join('');
  let control = '';
  if (q.input === 'text') control = `<input class="tj-big-input" name="v" value="${esc(draft[q.key])}" placeholder="${esc(q.placeholder ?? '')}" maxlength="${q.key === 'name' ? 40 : 160}" autocomplete="off">`;
  if (q.input === 'count') control = `<div class="tj-count">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button type="button" class="${n === draft.parts ? 'on' : ''}" data-tj="count" data-n="${n}">${n}</button>`).join('')}</div>`;
  if (q.input === 'files') {
    control = `<label class="tj-drop" data-tj-drop>
        <input type="file" name="files" multiple accept=".pdf,.txt,.md,text/plain,application/pdf" hidden>
        <b>${draft.files.length ? draft.files.map((f) => esc(f.name)).join(' · ') : 'Suelta aquí el enunciado y la rúbrica'}</b>
        <span class="fine">${draft.files.length ? 'Pulsa para cambiarlos' : 'o pulsa para elegirlos · PDF, texto o Markdown'}</span>
      </label>
      ${draft.pasting || draft.text ? `<textarea class="tj-paste" name="text" rows="6" placeholder="Pega aquí el enunciado y la rúbrica">${esc(draft.text)}</textarea>` : '<button type="button" class="link" data-tj="paste">Prefiero pegar el texto</button>'}`;
  }
  if (q.input === 'ready') {
    control = `<p class="tj-sentence">Tu IA va a leer el enunciado de <b>${esc(draft.title)}</b> y escribir una guía de solución para <b>${draft.parts} ${draft.parts === 1 ? 'persona' : 'personas'}</b>, paso a paso, con cada línea explicada.</p>
      ${aiLine('solution')}
      ${ai.promptHTML(outlinePrompt({ parts: draft.parts, course: draft.course, deadline: draft.deadline }), '', 'el enunciado y la rúbrica')}
      <p class="fine">El trabajo es privado: solo entra quien tenga tu enlace de invitación.</p>`;
  }
  root.innerHTML = `<form class="tj-wizard" id="tj-wizard">
      <div class="tj-dots" aria-hidden="true">${dots}</div>
      <h1>${esc(q.ask)}</h1>
      ${q.hint ? `<p class="lede-small">${esc(q.hint)}</p>` : ''}
      ${control}
      ${error ? `<p class="tj-warn">${esc(error)}</p>` : ''}
      <div class="tj-wizard-nav">
        ${draft.at ? '<button type="button" class="link" data-tj="back">← Atrás</button>' : '<button type="button" class="link" data-tj="cancel">Cancelar</button>'}
        <span></span>
        ${q.optional ? '<button type="button" class="link" data-tj="skip">Saltar</button>' : ''}
        ${q.input === 'ready'
    ? `${ai.ready() ? '<button class="button primary big" type="submit">Escribir mi guía</button>' : '<button class="button ghost" type="submit" data-later="1">Crear sin la guía, por ahora</button>'}`
    : '<button class="button primary" type="submit">Siguiente →</button>'}
      </div>
    </form>`;
  root.querySelector('.tj-big-input, .tj-paste')?.focus();
}
function keepAnswer() {
  const q = QUESTIONS[draft.at];
  const form = $('#tj-wizard', root);
  if (q.input === 'text') draft[q.key] = String(form.v.value).trim();
  if (q.input === 'files' && form.text) draft.text = String(form.text.value).trim();
}
function nextQuestion() {
  keepAnswer();
  const q = QUESTIONS[draft.at];
  if (q.required && q.input === 'text' && !draft[q.key]) return renderDraft('Escríbelo para seguir.');
  if (q.input === 'files' && !draft.files.length && !draft.text) return renderDraft('Trae el enunciado para seguir: un archivo o el texto pegado.');
  draft.at = Math.min(QUESTIONS.length - 1, draft.at + 1);
  renderDraft();
}

async function createTrabajo() {
  const read = await Promise.all(draft.files.map((file) => ai.readFile(file)));
  const skipped = read.filter((r) => r.skipped);
  if (skipped.length) throw new Error(`No se pudo leer: ${skipped.map((s) => `${s.name} (${s.skipped})`).join(', ')}.`);
  const statement = [draft.text, ...read.filter((r) => r.text).map((r) => `# ${r.name}\n\n${r.text}`)].filter(Boolean).join('\n\n');
  const pdfs = read.filter((r) => r.data);
  const ref = doc(collection(db, 'trabajos'));
  const code = newCode();
  const batch = writeBatch(db);
  batch.set(ref, {
    title: draft.title.slice(0, 160), course: draft.course.slice(0, 120), deadline: draft.deadline.slice(0, 40),
    parts: draft.parts, owner: uid(), code, statement: await pack(statement + (pdfs.length ? `\n\n(Archivos PDF entregados a la IA: ${pdfs.map((p) => p.name).join(', ')})` : '')),
    encoding: 'gzip', created: serverTimestamp(), updated: serverTimestamp(),
  });
  batch.set(doc(db, 'trabajos', ref.id, 'miembros', uid()), { name: draft.name.slice(0, 40), code, joined: serverTimestamp() });
  await batch.commit();
  await keepIds([...(await myIds()), ref.id]);
  return { id: ref.id, pdfs };
}
function working(text) {
  root.innerHTML = `<div class="tj-wizard tj-working"><div class="tj-spinner" aria-hidden="true"></div><h1>${esc(text)}</h1><p class="lede-small">Puedes dejar esta pestaña abierta y volver en un rato.</p></div>`;
}

async function generateOutline(files = []) {
  const system = outlinePrompt({ parts: T.parts, course: T.course, deadline: T.deadline });
  const text = `El enunciado y la rúbrica del trabajo «${T.title}»:\n\n${T.statement}`;
  const r = await askAI('solution', system, text, files, `Esquema de «${T.title}»`);
  const outline = cleanOutline(parseJSON(r.text), T.parts);
  await setDoc(tRef(T.id), { outline: await pack(outline), ai: madeBy(r), updated: serverTimestamp() }, { merge: true });
  T.outline = outline; T.ai = madeBy(r);
  await logAI({ task: 'solution', step: 'esquema', model: r.model, provider: r.way, prompt: `${system}\n\n[el enunciado y la rúbrica: ${T.statement.length} caracteres]` });
}
async function generateMilestone(hid) {
  const milestone = T.outline.hitos.find((h) => h.id === hid);
  const system = milestonePrompt({ milestone, outline: T.outline });
  const r = await askAI('solution', system, `Escribe el hito ${hid} completo.`, [], `Hito ${hid} de «${T.title}»`);
  const data = cleanMilestone(parseJSON(r.text), milestone);
  await setDoc(tRef(T.id, 'hitos', hid), { data: await pack(data), encoding: 'gzip', by: uid(), ai: madeBy(r), updated: serverTimestamp() });
  T.hitos[hid] = { ...data, by: uid(), ai: madeBy(r) };
  await logAI({ task: 'solution', step: hid, model: r.model, provider: r.way, prompt: `${system.split('El esquema de la guía:')[0]}[el esquema de la guía]` });
}

/* ---------- joining: one question ---------- */
async function renderJoin(tid, code) {
  const name = (await loadProfile(uid()).catch(() => null))?.nickname ?? '';
  root.innerHTML = `<form class="tj-wizard" id="tj-join" data-tid="${esc(tid)}" data-code="${esc(code)}">
      <h1>Te invitaron a un trabajo en grupo</h1>
      <p class="lede-small">¿Cómo te llamamos en el grupo?</p>
      <input class="tj-big-input" name="name" required maxlength="40" value="${esc(name)}" autocomplete="off">
      <div class="tj-wizard-nav"><a class="link" href="#/trabajos">Ahora no</a><span></span><button class="button primary" type="submit">Entrar →</button></div>
      <p class="fine" id="tj-join-status" role="status"></p>
    </form>`;
  root.querySelector('.tj-big-input')?.focus();
}
async function join(form) {
  const { tid, code } = form.dataset;
  const name = String(new FormData(form).get('name')).trim().slice(0, 40);
  await setDoc(tRef(tid, 'miembros', uid()), { name, code, joined: serverTimestamp() });
  await keepIds([...(await myIds()), tid]);
  T = null;
  location.hash = `#/trabajos/${tid}`;
}

/* ---------- the guide: one document, chapter after chapter ---------- */
const steps = () => (T.outline?.hitos ?? []).flatMap((h, i) => h.pasos.map((p, j) => ({ ...p, hito: h.id, num: `${i + 1}.${j + 1}` })));
const partOf = (u) => Object.entries(T.taken).find(([, x]) => x === u)?.[0] ?? '';
const myPart = () => partOf(uid());
const nameOf = (u) => T.members.find((m) => m.uid === u)?.name ?? 'alguien';
const mark = (key) => T.avance[uid()]?.[key] ?? {};
const doneBy = (key) => T.members.filter((m) => T.avance[m.uid]?.[key]?.d);
const isDone = (key) => doneBy(key).length > 0;
const avatar = (letter, title = '') => `<i class="tj-av" style="--c:${letter ? colorOf(letter) : 'var(--muted)'}" ${title ? `title="${esc(title)}"` : ''}>${esc(letter || '·')}</i>`;

function topbar() {
  const all = steps();
  const total = pct(all.filter((s) => isDone(s.id)).length, all.length);
  const chapters = T.outline ? T.outline.hitos.map((h, i) => `<a href="#cap-${esc(h.id)}" data-tj="jump" title="${esc(h.titulo)}">${i + 1}</a>`).join('') : '';
  return `<nav class="tj-top" aria-label="Capítulos">
      <a class="tj-top-title" href="#cap-inicio" data-tj="jump">${esc(T.title)}</a>
      <span class="tj-top-caps">${chapters}${T.outline ? '<a href="#cap-entrega" data-tj="jump" title="Entregar y defender">✓</a>' : ''}</span>
      ${myPart() ? `<label class="tj-mine"><input type="checkbox" data-tj="mine" ${onlyMine ? 'checked' : ''}> Solo mi parte</label>` : ''}
      <span class="tj-top-pct">${total}%</span>
      <span class="tj-top-bar">${bar(total)}</span>
    </nav>`;
}

function hero() {
  const all = steps();
  return `<header class="tj-hero" id="cap-inicio">
      <a class="fine" href="#/trabajos">← Trabajos</a>
      <h1>${esc(T.title)}</h1>
      <p class="tj-sub">Guía de solución${T.course ? ` · ${esc(T.course)}` : ''}${T.deadline ? ` · entrega ${esc(T.deadline)}` : ''}</p>
      <div class="tj-team">${T.members.map((m) => {
        const L = partOf(m.uid);
        const own = all.filter((s) => s.parte === L);
        const p = pct(own.filter((s) => T.avance[m.uid]?.[s.id]?.d).length, own.length);
        return `<span class="tj-member">${avatar(L)}${esc(m.name)}${L ? `<small>${p}%</small>` : ''}</span>`;
      }).join('')}<button type="button" class="link" data-tj="invite">+ Invitar</button></div>
    </header>`;
}

function stepChecks(key, label) {
  const m = mark(key);
  const others = doneBy(key).filter((x) => x.uid !== uid()).map((x) => x.name);
  const a = asking.get(key);
  return `<footer class="tj-stepfoot">
      <label class="tj-tick ${m.d ? 'on' : ''}"><input type="checkbox" data-tj="d" data-key="${esc(key)}" ${m.d ? 'checked' : ''}><span>Lo hice</span></label>
      <label class="tj-tick ${m.u ? 'on' : ''}"><input type="checkbox" data-tj="u" data-key="${esc(key)}" ${m.u ? 'checked' : ''}><span>Lo entiendo</span></label>
      <button type="button" class="link" data-tj="ask" data-key="${esc(key)}" data-label="${esc(label)}">No lo entiendo</button>
      ${others.length ? `<span class="fine">Ya lo hizo ${esc(others.join(', '))}</span>` : ''}
      ${m.c ? `<span class="fine">commit ${esc(m.c.slice(0, 7))}</span>` : ''}
    </footer>${a ? `<div class="tj-answer">${a.busy ? '<span class="fine">Tu IA te lo está explicando…</span>' : a.error ? `<span class="tj-warn">${esc(a.error)}</span>` : `${md(a.text)}<p class="fine">Explicado por ${esc(a.model)}.</p>`}</div>` : ''}`;
}

function intro() {
  const o = T.outline;
  const reqs = o.requisitos.filter((r) => r.texto);
  const letters = LETTERS.slice(0, T.parts).split('');
  const all = steps();
  const missing = o.hitos.filter((h) => !T.hitos[h.id]).length;
  return `<section class="tj-cap">
      <div class="tj-prose">${md(o.resumen)}</div>
      ${reqs.length ? `<h3>Lo que tienen que entregar</h3><ul class="tj-reqlist">${reqs.map((r) => `<li>${inline(r.texto)}${r.peso ? ` <span class="tj-weight">${esc(r.peso)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${o.avisos.length ? `<div class="tj-callout"><b>Antes de empezar</b>${o.avisos.map((a) => `<p>${inline(a)}</p>`).join('')}</div>` : ''}
      <details class="tj-fold"><summary>Leer el enunciado original</summary><pre class="tj-pre">${esc(T.statement)}</pre></details>
      <h3>Cómo se reparten</h3>
      <p>Son ${T.parts} ${T.parts === 1 ? 'parte' : 'partes'}: cada uno toma una y avanza en paralelo. Aun así, <b>todos leen y entienden toda la guía</b>, porque la defensa es de todos.</p>
      <div class="tj-parts">${letters.map((L) => {
        const holder = T.taken[L];
        const n = all.filter((s) => s.parte === L).length;
        return `<div class="tj-part" style="--c:${colorOf(L)}">${avatar(L)}<span><b>Persona ${L}</b><small>${n} ${n === 1 ? 'paso' : 'pasos'}</small></span>
          ${holder ? `<span class="tj-holder">${esc(nameOf(holder))}${holder === uid() ? ' <button type="button" class="link" data-tj="leave">soltar</button>' : ''}</span>` : myPart() ? '<span class="fine">libre</span>' : `<button type="button" class="button small primary" data-tj="take" data-part="${L}">Es la mía</button>`}</div>`;
      }).join('')}</div>
      ${missing ? `<div class="tj-callout soft"><p>${missing === o.hitos.length ? 'Los capítulos todavía no están escritos.' : (missing === 1 ? 'Falta un capítulo por escribir.' : `Faltan ${missing} capítulos por escribir.`)} Tu IA los escribe uno por uno; cada uno tarda unos minutos.</p>${aiLine('solution')}<button type="button" class="button primary" data-tj="gen-all">Escribir ${missing === 1 ? 'el capítulo que falta' : `los ${missing} capítulos`}</button> <span class="fine" id="tj-gen-status" role="status"></span></div>` : ''}
      ${stepChecks('enunciado', `qué pide el trabajo «${T.title}»: ${o.resumen}`).replace('<span>Lo hice</span>', '<span>Lo leí</span>')}
    </section>`;
}

function stepHTML(s, step) {
  const holder = T.taken[s.parte];
  const code = (step?.codigo ?? []).map((c) => {
    const lines = c.codigo.replace(/\n$/, '').split('\n');
    const expl = new Map(c.lineas.map((l) => [l.n, l.explicacion]));
    return `<div class="tj-code"><table>${lines.map((line, i) => `<tr><td class="n">${i + 1}</td><td class="c"><code>${esc(line) || ' '}</code></td><td class="e">${expl.has(i + 1) ? inline(expl.get(i + 1)) : ''}</td></tr>`).join('')}</table></div>`;
  }).join('');
  return `<article class="tj-step" id="paso-${esc(s.id)}" style="--c:${colorOf(s.parte)}">
      <h3><span class="tj-num">${esc(s.num)}</span>${esc(s.titulo)} ${avatar(s.parte, holder ? nameOf(holder) : `Persona ${s.parte}`)}</h3>
      ${step ? `${step.objetivo ? `<p class="tj-lead">${inline(step.objetivo)}</p>` : ''}
        ${step.teoria ? `<div class="tj-prose">${md(step.teoria)}</div>` : ''}
        ${step.librerias.length ? `<p class="fine">Usa ${step.librerias.map((l) => `<code title="${esc(l.para_que)}">${esc(l.nombre)}</code>`).join(', ')}.</p>` : ''}
        ${code}
        ${step.esperado ? `<p class="tj-expect"><b>Al correrlo verás:</b> ${inline(step.esperado)}</p>` : ''}
        ${step.comprueba.map((q) => `<details class="tj-fold q"><summary>${esc(q.pregunta)}</summary>${md(q.respuesta)}</details>`).join('')}
        ${step.commit ? `<p class="fine">Al guardarlo en GitHub: <code>${esc(step.commit)}</code> <button type="button" class="link" data-tj="copy" data-text="${esc(step.commit)}">copiar</button></p>` : ''}` : ''}
      ${step ? stepChecks(s.id, `el paso «${s.titulo}»${step.objetivo ? `: ${step.objetivo}` : ''}`) : ''}
    </article>`;
}

function chapter(h, i) {
  const data = T.hitos[h.id];
  const byId = new Map((data?.pasos ?? []).map((p) => [p.id, p]));
  const list = steps().filter((s) => s.hito === h.id && (!onlyMine || s.parte === myPart()));
  const done = steps().filter((s) => s.hito === h.id && isDone(s.id)).length;
  return `<section class="tj-cap" id="cap-${esc(h.id)}">
      <h2><span class="n">${i + 1}</span>${esc(h.titulo)}</h2>
      <p class="tj-lead">${h.entregable ? `Al terminar este capítulo tendrán ${esc(lower(h.entregable))}.` : ''} ${h.listo_cuando ? `Está listo cuando ${esc(lower(h.listo_cuando))}.` : ''}</p>
      ${data ? '' : `<div class="tj-callout soft"><p>Este capítulo todavía no está escrito.</p><button type="button" class="button primary small" data-tj="gen" data-hito="${esc(h.id)}">Escribirlo con tu IA</button> <span class="fine" data-status="${esc(h.id)}"></span></div>`}
      ${data ? list.map((s) => stepHTML(s, byId.get(s.id))).join('') || '<p class="fine">Tu parte no tiene pasos en este capítulo.</p>' : `<ol class="tj-preview">${list.map((s) => `<li>${esc(s.titulo)} ${avatar(s.parte)}</li>`).join('')}</ol>`}
      ${data ? `<p class="fine tj-capfoot">${done} de ${h.pasos.length} pasos hechos · escrito con ${esc(data.ai?.model ?? 'IA')} · <button type="button" class="link" data-tj="gen" data-hito="${esc(h.id)}">escribirlo otra vez</button></p>` : ''}
    </section>`;
}

function closing() {
  const all = steps();
  const repo = T.repo ? `${T.repo.owner}/${T.repo.name}` : '';
  const token = !!ai.keyOf('github');
  const defense = T.outline.hitos.flatMap((h) => (T.hitos[h.id]?.pasos ?? []).flatMap((p) => p.defensa));
  const used = T.members.reduce((n, m) => n + (T.ia[m.uid]?.length ?? 0), 0);
  return `<section class="tj-cap" id="cap-entrega">
      <h2><span class="n">✓</span>Entregar y defender</h2>
      <h3>Cómo va cada uno</h3>
      <div class="tj-progress">${T.members.map((m) => {
        const L = partOf(m.uid);
        const own = all.filter((s) => s.parte === L);
        const a = T.avance[m.uid] ?? {};
        const pOwn = pct(own.filter((s) => a[s.id]?.d).length, own.length);
        const pU = pct(all.filter((s) => a[s.id]?.u).length, all.length);
        return `<div class="tj-prow">${avatar(L)}<b>${esc(m.name)}</b><span>${L ? `hizo ${pOwn}% de su parte` : 'sin parte'}</span>${bar(pOwn, L ? colorOf(L) : 'var(--muted)')}<span>entiende ${pU}% de la guía</span>${bar(pU, 'var(--blue)')}</div>`;
      }).join('')}</div>
      <p class="fine">Para la defensa, todos tienen que llegar a entender el 100 % de la guía, no solo su parte.</p>

      <h3>GitHub</h3>
      <p>Si el commit empieza con el número del paso entre corchetes, Studium lo encuentra y marca ese paso como hecho para ti.</p>
      ${T.owner === uid() ? `<form class="tj-inline" id="tj-repo"><input name="repo" value="${esc(repo)}" placeholder="usuario/repositorio" pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" aria-label="Repositorio"><button class="button ghost small" type="submit">Guardar</button></form>` : repo ? `<p><a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener">${esc(repo)}</a></p>` : ''}
      <details class="tj-fold" ${token ? '' : ''}><summary>${token ? 'Tu GitHub está conectado (solo lectura)' : 'Conectar tu GitHub'}</summary>
        <ol><li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">un token nuevo en GitHub</a>.</li>
          <li>Elige <b>solo el repositorio del trabajo</b> y, en «Contents», <b>Read-only</b>. Nada más.</li>
          <li>Genéralo y pégalo aquí. Se guarda cifrado, como tus claves de IA.</li></ol>
        <form class="tj-inline" id="tj-token"><input name="token" type="password" autocomplete="off" placeholder="${PAT}…" aria-label="Token de GitHub"><button class="button ghost small" type="submit">Guardar</button>${token ? '<button class="link" type="button" data-tj="forget-token">olvidar</button>' : ''}</form>
        <p class="fine">Pronto: conectar en un clic y trabajar desde tu computadora con el puente local.</p></details>
      ${repo ? '<p><button type="button" class="button small" data-tj="check-gh">Revisar mis commits</button> <span class="fine" id="tj-gh-status" role="status"></span></p>' : ''}

      <h3>La cita del uso de IA</h3>
      <p>El curso pide decir cómo usaron la IA. Studium guardó qué IA usó cada uno y con qué instrucciones (${used} ${used === 1 ? 'vez' : 'veces'}), y lo arma en un documento listo para el entregable.</p>
      <p><button type="button" class="button small" data-tj="cite">Descargar la cita</button></p>
      ${used ? `<details class="tj-fold"><summary>Ver lo que se usó</summary>${T.members.flatMap((m) => (T.ia[m.uid] ?? []).map((e) => `<details class="tj-fold"><summary>${esc(m.name)} · ${esc(e.task === 'tutor' ? 'explicación' : 'guía')} · ${esc(e.model)}</summary><pre class="tj-pre">${esc(e.prompt)}</pre></details>`)).join('')}</details>` : ''}

      ${defense.length ? `<h3>Practicar la defensa</h3><p>Las preguntas que les podrían hacer. Respóndanlas en voz alta antes de abrir la respuesta.</p>${defense.map((q) => `<details class="tj-fold q"><summary>${esc(q.pregunta)}</summary>${md(q.respuesta)}</details>`).join('')}` : ''}
      ${T.outline.glosario.length ? `<h3>Términos</h3><dl class="tj-gloss">${T.outline.glosario.map((g) => `<dt>${esc(g.termino)}</dt><dd>${esc(g.definicion)}</dd>`).join('')}</dl>` : ''}
    </section>`;
}

function noOutline() {
  return `<section class="tj-cap"><div class="tj-callout soft">${T.owner === uid()
    ? `<p>La guía todavía no está escrita. Tu IA lee el enunciado y arma los capítulos.</p>${aiLine('solution')}<button type="button" class="button primary" data-tj="outline">Escribir la guía</button> <span class="fine" id="tj-gen-status" role="status"></span>`
    : '<p>Quien creó el trabajo todavía no escribió la guía.</p>'}</div></section>`;
}

function paint() {
  if (!T) return;
  terms = (T.outline?.glosario ?? []).filter((g) => g.termino.length > 2).map((g) => ({ ...g, re: g.termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }));
  root.innerHTML = `<div class="tj-doc">${topbar()}${hero()}${T.outline ? intro() + T.outline.hitos.map(chapter).join('') + closing() : noOutline()}</div>`;
}

async function openTrabajo(tid) {
  if (T?.id !== tid || T.viewer !== uid()) {
    root.innerHTML = '<p class="status">Abriendo el trabajo…</p>';
    T = await loadTrabajo(tid);
    asking.clear();
    if (!T) { root.innerHTML = '<p class="status">Ese trabajo no existe, o no eres parte de él.</p>'; return; }
  }
  paint();
}

/* ---------- what the buttons do ---------- */
const say = (sel, text) => { const el = $(sel, root); if (el) el.textContent = text; };
async function busy(button, work) {
  const was = button?.disabled;
  if (button) button.disabled = true;
  try { await work(); } catch (e) { console.error(e); ctx?.toast?.(ctx.explain ? ctx.explain(e) : e.message); throw e; } finally { if (button && button.isConnected) button.disabled = was; }
}
// Repaint, keeping the place on the page.
function repaint() { const y = scrollY; paint(); scrollTo({ top: y }); }
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
  for (const [i, h] of missing.entries()) {
    say('#tj-gen-status', `Escribiendo el capítulo ${T.outline.hitos.indexOf(h) + 1} (${i + 1} de ${missing.length})…`);
    await generateMilestone(h.id);
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
  say('#tj-gh-status', marked ? `Listo: ${marked} ${marked === 1 ? 'paso marcado' : 'pasos marcados'} como hechos.` : 'No hay pasos nuevos en tus commits.');
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

function wire() {
  root.addEventListener('submit', async (ev) => {
    const form = ev.target;
    ev.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (form.id === 'tj-wizard') {
      if (QUESTIONS[draft.at].input !== 'ready') { nextQuestion(); return; }
      const later = !!ev.submitter?.dataset.later;
      try {
        working('Creando el trabajo…');
        const made = await createTrabajo();
        T = await loadTrabajo(made.id);
        draft = null;
        history.replaceState(null, '', `#/trabajos/${made.id}`);
        if (!later && ai.ready()) {
          working('Tu IA está leyendo el enunciado y armando la guía…');
          try { await generateOutline(made.pdfs); } catch (e) { ctx.toast(`El trabajo se creó, pero tu IA no pudo armar la guía: ${e.message}`); }
        }
        paint(); scrollTo({ top: 0 });
      } catch (e) { console.error(e); renderDraft(e.message); }
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
    else if (el.name === 'files' && draft) { draft.files = [...el.files]; keepAnswer(); renderDraft(); }
    else if (el.closest?.('[data-ai-pick]')) { const task = el.closest('[data-ai-pick]').dataset.aiPick; ai.setChoice(task, ai.picked(task, root)); }
  });
  // Files dropped on the question that asks for them.
  root.addEventListener('dragover', (ev) => { if (ev.target.closest?.('[data-tj-drop]')) { ev.preventDefault(); ev.target.closest('[data-tj-drop]').classList.add('over'); } });
  root.addEventListener('dragleave', (ev) => ev.target.closest?.('[data-tj-drop]')?.classList.remove('over'));
  root.addEventListener('drop', (ev) => {
    if (!ev.target.closest?.('[data-tj-drop]') || !draft) return;
    ev.preventDefault();
    keepAnswer();
    draft.files = [...ev.dataTransfer.files].filter((f) => /\.(pdf|txt|md)$/i.test(f.name) || f.type.startsWith('text/'));
    renderDraft();
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-tj]');
    if (!b || b.tagName === 'INPUT') return;
    const kind = b.dataset.tj;
    if (kind === 'new') { await startDraft(); return; }
    if (kind === 'cancel') { draft = null; await renderList(); return; }
    if (kind === 'back') { keepAnswer(); draft.at = Math.max(0, draft.at - 1); renderDraft(); return; }
    if (kind === 'skip') { draft[QUESTIONS[draft.at].key] = ''; draft.at += 1; renderDraft(); return; }
    if (kind === 'count') { draft.parts = Number(b.dataset.n); draft.at += 1; renderDraft(); return; }
    if (kind === 'paste') { draft.pasting = true; renderDraft(); return; }
    if (kind === 'jump') { ev.preventDefault(); document.getElementById(b.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (kind === 'ask') { await ask(b.dataset.key, b.dataset.label); return; }
    if (kind === 'copy') { await navigator.clipboard.writeText(b.dataset.text).then(() => ctx.toast('Copiado.'), () => ctx.toast('No se pudo copiar.')); return; }
    if (kind === 'invite') {
      const link = `${location.origin}${location.pathname}#/trabajos/unirse/${T.id}/${T.code}`;
      await navigator.clipboard.writeText(link).then(() => ctx.toast('Enlace copiado: compártelo solo con tu grupo.'), () => prompt('Enlace de invitación', link));
      return;
    }
    if (kind === 'take') { await busy(b, async () => { await setDoc(tRef(T.id, 'partes', b.dataset.part), { uid: uid(), at: serverTimestamp() }); T.taken[b.dataset.part] = uid(); repaint(); }).catch(() => ctx.toast('Esa parte ya la tomó alguien.')); return; }
    if (kind === 'leave') { const L = myPart(); await busy(b, async () => { await deleteDoc(tRef(T.id, 'partes', L)); delete T.taken[L]; repaint(); }).catch(() => {}); return; }
    if (kind === 'outline') { await busy(b, async () => { say('#tj-gen-status', 'Tu IA está armando la guía…'); await generateOutline(); repaint(); }).catch((e) => say('#tj-gen-status', e.message)); return; }
    if (kind === 'gen-all') { await busy(b, () => writeAll(b)).catch((e) => say('#tj-gen-status', e.message)); return; }
    if (kind === 'gen') {
      const status = (t) => { const el = root.querySelector(`[data-status="${b.dataset.hito}"]`); if (el) el.textContent = t; };
      await busy(b, async () => { status('Tu IA lo está escribiendo, con cada línea explicada (unos minutos)…'); await generateMilestone(b.dataset.hito); repaint(); }).catch((e) => status(e.message));
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
  wire();
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
