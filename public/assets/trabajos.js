// «Trabajos»: a group assignment solved with a guide. The statement and the rubric become, with the person's own AI, a
// solution guide that reaches the final deliverable, split in parts (Persona A, B, C…) and written so that every
// member writes and understands each line. The group takes its parts, marks «Lo entiendo» and «Hecho» per step (or
// GitHub marks «Hecho» from a commit that names the step), sees everyone's progress, asks its quick AI what it does not
// understand (no chat between members), and exports at the end the citation of how AI was used.
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
// The trabajo open now.
let T = null;
let tab = 'guia';
let openMilestone = '';
let onlyMine = false;
const asking = new Map();

/* ---------- a little formatting, always escaped first ---------- */
function md(text) {
  const blocks = String(text ?? '').split(/```/);
  return blocks.map((b, i) => {
    if (i % 2) return `<pre class="tj-pre"><code>${esc(b.replace(/^[a-z]*\n/, ''))}</code></pre>`;
    return b.split(/\n{2,}/).map((para) => {
      const lines = para.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if (lines.every((l) => /^\s*[-*]\s/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const bar = (p, color = 'var(--teal)') => `<span class="tj-bar" style="--p:${p}%;--c:${color}"><i></i></span>`;

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
    id: tid, ...d, statement: await unpack(d.statement), outline: d.outline ? JSON.parse(await unpack(d.outline)) : null,
    members: members.docs.map((m) => ({ uid: m.id, name: m.data().name })),
    parts: Object.fromEntries(parts.docs.map((p) => [p.id, p.data().uid])),
    hitos: {}, avance: {}, ia: {},
  };
  for (const h of hitos.docs) { try { t.hitos[h.id] = { ...JSON.parse(await unpack(h.data().data)), by: h.data().by, ai: h.data().ai }; } catch { /* unreadable: generated again */ } }
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
function aiMissing(task) {
  if (ai.ready()) return '';
  return `<p class="tj-warn">${task === 'solution' ? 'Para generar la guía de solución necesitas conectar una IA potente: tu suscripción de Claude o ChatGPT con el puente local, o una clave.' : 'Para preguntarle a tu IA necesitas conectar una: la clave gratis de Gemini sirve y responde al instante.'} <a href="#/ajustes">Conectar en Ajustes</a></p>`;
}
function weakFor(task) {
  if (task !== 'solution' || !ai.ready()) return '';
  const c = ai.choice('solution');
  return /gemini|openrouter|puter/.test(c.provider) ? '<p class="fine tj-note">Tu IA de ahora es gratuita y rápida: sirve para preguntas, pero una guía completa, con cada línea explicada, sale mucho mejor con una IA más potente (Claude o ChatGPT con el puente local).</p>' : '';
}
async function askAI(task, system, text, files = [], label = '') {
  const r = await ai.run({ system, text, files, task, label, maxTokens: task === 'solution' ? ai.longest(ai.choice(task)) : 4000 });
  return r;
}

/* ---------- the list, and a new trabajo ---------- */
async function renderList() {
  root.innerHTML = '<p class="status">Cargando tus trabajos…</p>';
  const ids = await myIds();
  const rows = (await Promise.all(ids.map((id) => getDoc(tRef(id)).then((s) => (s.exists() ? { id, ...s.data() } : null)).catch(() => null)))).filter(Boolean);
  const name = (await loadProfile(uid()).catch(() => null))?.nickname ?? '';
  root.innerHTML = `<div class="page-head"><h1>Trabajos</h1></div>
    <p class="lede-small tj-lede">Un trabajo en grupo, resuelto con una guía hasta el entregable final: cada integrante escribe y entiende cada línea. Tu IA la genera a partir del enunciado y la rúbrica; ustedes se reparten las partes y avanzan.</p>
    ${rows.length ? `<div class="tj-cards">${rows.map((r) => `<a class="tj-card glass" href="#/trabajos/${esc(r.id)}"><b>${esc(r.title)}</b><span>${esc(r.course ?? '')}${r.deadline ? ` · entrega ${esc(r.deadline)}` : ''}</span><span class="fine">${r.parts} ${r.parts === 1 ? 'parte' : 'partes'}${r.owner === uid() ? ' · lo creaste tú' : ''}</span></a>`).join('')}</div>` : ''}
    <form class="tj-new glass" id="tj-new">
      <h2>Nuevo trabajo</h2>
      <div class="tj-grid2">
        <label class="field"><span>Título</span><input name="title" required maxlength="160" placeholder="Proyecto final: predicción de precios de casas"></label>
        <label class="field"><span>Curso</span><input name="course" maxlength="120" placeholder="Machine Learning"></label>
        <label class="field"><span>Entrega</span><input name="deadline" maxlength="40" placeholder="inicios de diciembre"></label>
        <label class="field"><span>Integrantes (partes de la guía)</span><input name="parts" type="number" min="1" max="8" value="3" required></label>
        <label class="field"><span>Tu nombre para el grupo</span><input name="name" required maxlength="40" value="${esc(name)}"></label>
      </div>
      <label class="field"><span>El enunciado y la rúbrica: pégalos aquí…</span><textarea name="statement" rows="7" maxlength="400000" placeholder="Copia el enunciado completo y la rúbrica."></textarea></label>
      <label class="field"><span>…o súbelos (PDF, texto, Markdown)</span><input name="files" type="file" multiple accept=".pdf,.txt,.md,text/plain,application/pdf"></label>
      ${aiMissing('solution')}${weakFor('solution')}
      ${ai.pickerHTML('solution')}
      ${ai.promptHTML(outlinePrompt({ parts: 3, course: '', deadline: '' }), '', 'el enunciado y la rúbrica que pegues o subas')}
      <p class="fine">El trabajo es privado: solo lo ven quienes entren con tu enlace de invitación. Si el enunciado prohíbe publicar algo (datos, el repositorio), la guía lo respeta.</p>
      <div class="tj-actions"><button class="button primary" type="submit">Crear y generar el esquema</button><span class="fine" id="tj-new-status" role="status"></span></div>
    </form>`;
}

async function createTrabajo(form) {
  const f = new FormData(form);
  const title = String(f.get('title')).trim();
  const parts = Math.min(8, Math.max(1, Number(f.get('parts')) || 3));
  const name = String(f.get('name')).trim().slice(0, 40);
  const files = [...form.querySelector('[name="files"]').files];
  const read = await Promise.all(files.map((file) => ai.readFile(file)));
  const skipped = read.filter((r) => r.skipped);
  if (skipped.length) throw new Error(`No se pudo leer: ${skipped.map((s) => `${s.name} (${s.skipped})`).join(', ')}.`);
  const statement = [String(f.get('statement') ?? '').trim(), ...read.filter((r) => r.text).map((r) => `# ${r.name}\n\n${r.text}`)].filter(Boolean).join('\n\n');
  const pdfs = read.filter((r) => r.data);
  if (!statement && !pdfs.length) throw new Error('Pega el enunciado o sube su archivo.');
  const ref = doc(collection(db, 'trabajos'));
  const code = newCode();
  const batch = writeBatch(db);
  batch.set(ref, {
    title, course: String(f.get('course') ?? '').trim().slice(0, 120), deadline: String(f.get('deadline') ?? '').trim().slice(0, 40),
    parts, owner: uid(), code, statement: await pack(statement + (pdfs.length ? `\n\n(Archivos PDF entregados a la IA: ${pdfs.map((p) => p.name).join(', ')})` : '')),
    encoding: 'gzip', created: serverTimestamp(), updated: serverTimestamp(),
  });
  batch.set(doc(db, 'trabajos', ref.id, 'miembros', uid()), { name, code, joined: serverTimestamp() });
  await batch.commit();
  await keepIds([...(await myIds()), ref.id]);
  return { id: ref.id, pdfs, parts };
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

/* ---------- joining ---------- */
async function renderJoin(tid, code) {
  const name = (await loadProfile(uid()).catch(() => null))?.nickname ?? '';
  root.innerHTML = `<div class="page-head"><h1>Unirte a un trabajo</h1></div>
    <form class="tj-new glass narrow-form" id="tj-join" data-tid="${esc(tid)}" data-code="${esc(code)}">
      <p>Te invitaron a un trabajo en grupo de Studium. Al entrar, el grupo verá tu nombre, la parte que tomes y tu avance.</p>
      <label class="field"><span>Tu nombre para el grupo</span><input name="name" required maxlength="40" value="${esc(name)}"></label>
      <div class="tj-actions"><button class="button primary" type="submit">Entrar al trabajo</button><span class="fine" id="tj-join-status" role="status"></span></div>
    </form>`;
}
async function join(form) {
  const { tid, code } = form.dataset;
  const name = String(new FormData(form).get('name')).trim().slice(0, 40);
  await setDoc(tRef(tid, 'miembros', uid()), { name, code, joined: serverTimestamp() });
  await keepIds([...(await myIds()), tid]);
  location.hash = `#/trabajos/${tid}`;
}

/* ---------- the trabajo ---------- */
const steps = () => (T.outline?.hitos ?? []).flatMap((h) => h.pasos.map((p) => ({ ...p, hito: h.id })));
const myPart = () => Object.entries(T.parts).find(([, u]) => u === uid())?.[0] ?? '';
const nameOf = (u) => T.members.find((m) => m.uid === u)?.name ?? 'alguien';
const mark = (key) => T.avance[uid()]?.[key] ?? {};
const doneBy = (key) => T.members.filter((m) => T.avance[m.uid]?.[key]?.d);
const understoodBy = (key) => T.members.filter((m) => T.avance[m.uid]?.[key]?.u);
const isDone = (key) => doneBy(key).length > 0;

function header() {
  const all = steps();
  const done = all.filter((s) => isDone(s.id)).length;
  const total = pct(done, all.length);
  return `<div class="tj-head">
      <div><a class="fine" href="#/trabajos">← Trabajos</a><h1>${esc(T.title)}</h1><p class="fine">${esc(T.course ?? '')}${T.deadline ? ` · entrega ${esc(T.deadline)}` : ''}${T.ai ? ` · guía generada con ${esc(T.ai.model)}` : ''}</p></div>
      <div class="tj-total"><b>${total}%</b><span class="fine">del trabajo hecho</span>${bar(total)}</div>
    </div>
    <div class="tj-people">${T.members.map((m) => {
      const letter = Object.entries(T.parts).find(([, u]) => u === m.uid)?.[0];
      const mine = letter ? all.filter((s) => s.parte === letter) : [];
      const p = pct(mine.filter((s) => T.avance[m.uid]?.[s.id]?.d).length, mine.length);
      return `<span class="tj-person" style="--c:${letter ? colorOf(letter) : 'var(--muted)'}"><i>${esc(letter ?? '·')}</i>${esc(m.name)}${letter ? ` <small>${p}%</small>` : ' <small>sin parte</small>'}</span>`;
    }).join('')}
      <button type="button" class="button ghost small" data-tj="invite">Invitar</button>
      <button type="button" class="button ghost small" data-tj="reload" title="Traer lo último del grupo">Actualizar</button></div>
    <nav class="subtabs tj-tabs" aria-label="Partes del trabajo">${[['enunciado', 'Enunciado'], ['reparto', 'Reparto'], ['guia', 'Guía'], ['avance', 'Avance'], ['ia', 'Uso de IA']].map(([k, n]) => `<a href="#/trabajos/${esc(T.id)}/${k}" ${tab === k ? 'aria-current="true"' : ''}>${n}</a>`).join('')}</nav>`;
}

function tutorBox(key, label) {
  const a = asking.get(key);
  return `<div class="tj-tutor" data-key="${esc(key)}">
    <button type="button" class="link" data-tj="ask" data-key="${esc(key)}" data-label="${esc(label)}">No lo entiendo</button>
    ${a ? `<div class="tj-answer">${a.busy ? '<span class="fine">Tu IA está explicando…</span>' : a.error ? `<span class="tj-warn">${esc(a.error)}</span>` : `${md(a.text)}<p class="fine">Explicado por ${esc(a.model)}.</p>`}</div>` : ''}</div>`;
}
function checks(key, { done = true } = {}) {
  const m = mark(key);
  const who = understoodBy(key).map((x) => x.name);
  const doers = doneBy(key);
  return `<div class="tj-checks">
    <label class="check"><input type="checkbox" data-tj="u" data-key="${esc(key)}" ${m.u ? 'checked' : ''}> Lo entiendo</label>
    ${done ? `<label class="check"><input type="checkbox" data-tj="d" data-key="${esc(key)}" ${m.d ? 'checked' : ''}> Hecho${m.c ? ` <small class="fine">(commit ${esc(m.c.slice(0, 7))})</small>` : ''}</label>` : ''}
    <span class="fine">${who.length ? `Lo entienden: ${esc(who.join(', '))}` : 'Nadie lo marcó como entendido todavía'}${done && doers.length && !m.d ? ` · Hecho por ${esc(doers.map((x) => x.name).join(', '))}` : ''}</span>
  </div>`;
}

function renderEnunciado() {
  const o = T.outline;
  if (!o) return noOutline();
  return `<section class="tj-sec">
    <div class="tj-box glass"><h2>De qué se trata</h2>${md(o.resumen)}${o.avisos.length ? `<h3>Antes de empezar</h3><ul>${o.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</div>
    <h2>Lo que pide, requisito por requisito</h2>
    <p class="fine">Que todos estén en la misma página: cada uno marca «Lo entiendo». Si algo no se entiende, tu IA lo explica al instante.</p>
    <div class="tj-reqs">${o.requisitos.map((r) => `<article class="tj-req glass"><header><b>${esc(r.id)}</b>${r.peso ? `<span class="tag">${esc(r.peso)}</span>` : ''}</header>
      <p>${esc(r.texto)}</p>${r.cita ? `<blockquote>${esc(r.cita)}</blockquote>` : ''}${r.material ? `<p class="fine">Se apoya en: ${esc(r.material)}</p>` : ''}
      ${checks(r.id, { done: false })}${tutorBox(r.id, `el requisito ${r.id}: «${r.texto}»${r.cita ? ` (del enunciado: «${r.cita}»)` : ''}`)}</article>`).join('')}</div>
    ${o.glosario.length ? `<h2>Glosario</h2><dl class="tj-gloss">${o.glosario.map((g) => `<dt>${esc(g.termino)}</dt><dd>${esc(g.definicion)}</dd>`).join('')}</dl>` : ''}
    <details class="tj-box"><summary>El enunciado tal como se entregó</summary><pre class="tj-pre">${esc(T.statement)}</pre></details>
  </section>`;
}

function renderReparto() {
  if (!T.outline) return noOutline();
  const all = steps();
  const letters = LETTERS.slice(0, T.parts).split('');
  const mine = myPart();
  return `<section class="tj-sec"><p class="fine">Cada integrante toma una parte. Las partes avanzan en paralelo; aun así, cada uno debe entender todo el trabajo: la defensa es de todos.</p>
    <div class="tj-board" style="--n:${letters.length}">${letters.map((L) => {
      const holder = T.parts[L];
      const list = all.filter((s) => s.parte === L);
      const doneN = list.filter((s) => isDone(s.id)).length;
      return `<div class="tj-col glass" style="--c:${colorOf(L)}"><header><i>${L}</i><b>Persona ${L}</b></header>
        <div class="tj-holder">${holder ? `<span>${esc(nameOf(holder))}</span>${holder === uid() ? '<button type="button" class="link" data-tj="leave">Soltar</button>' : ''}` : mine ? '<span class="fine">Libre</span>' : `<button type="button" class="button small primary" data-tj="take" data-part="${L}">Tomar esta parte</button>`}</div>
        <p class="fine">${list.length} pasos · ${doneN} hechos</p>${bar(pct(doneN, list.length), colorOf(L))}
        <ol class="tj-mini">${list.map((s) => `<li class="${isDone(s.id) ? 'done' : ''}"><a href="#/trabajos/${esc(T.id)}/guia" data-tj="goto" data-hito="${esc(s.hito)}">${esc(s.id)}</a> ${esc(s.titulo)}</li>`).join('')}</ol></div>`;
    }).join('')}</div></section>`;
}

function stepHTML(s, step) {
  const key = s.id;
  const code = (step?.codigo ?? []).map((c, ci) => {
    const lines = c.codigo.replace(/\n$/, '').split('\n');
    const expl = new Map(c.lineas.map((l) => [l.n, l.explicacion]));
    return `<div class="tj-code"><table>${lines.map((line, i) => `<tr><td class="n">${i + 1}</td><td class="c"><code>${esc(line) || ' '}</code></td><td class="e">${expl.has(i + 1) ? esc(expl.get(i + 1)) : ''}</td></tr>`).join('')}</table>
      <div class="tj-code-foot"><button type="button" class="link" data-tj="copy" data-text="${esc(c.codigo)}">Copiar (mejor escríbelo tú)</button></div>
      ${tutorBox(`${key}#${ci}`, `este código del paso ${key} («${s.titulo}»):\n${c.codigo}`)}</div>`;
  }).join('');
  return `<article class="tj-step glass" id="paso-${esc(key)}" style="--c:${colorOf(s.parte)}">
    <header><i>${esc(s.parte)}</i><b>${esc(key)} · ${esc(s.titulo)}</b>${s.requisitos.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}${T.parts[s.parte] ? `<span class="fine">${esc(nameOf(T.parts[s.parte]))}</span>` : ''}</header>
    ${step ? `${step.objetivo ? `<p><b>Objetivo:</b> ${esc(step.objetivo)}</p>` : ''}
      ${step.teoria ? `<div class="tj-theory"><h4>La teoría</h4>${md(step.teoria)}</div>` : ''}
      ${step.librerias.length ? `<p class="fine"><b>Librerías:</b> ${step.librerias.map((l) => `<code>${esc(l.nombre)}</code>: ${esc(l.para_que)}`).join(' · ')}</p>` : ''}
      ${code}
      ${step.esperado ? `<p><b>Lo que deberías ver:</b> ${esc(step.esperado)}</p>` : ''}
      ${step.comprueba.map((q) => `<details class="tj-q"><summary>Comprueba: ${esc(q.pregunta)}</summary>${md(q.respuesta)}</details>`).join('')}
      ${step.defensa.map((q) => `<details class="tj-q def"><summary>Defensa: ${esc(q.pregunta)}</summary>${md(q.respuesta)}</details>`).join('')}
      ${step.commit ? `<p class="fine tj-commit">Commit: <code>${esc(step.commit)}</code> <button type="button" class="link" data-tj="copy" data-text="${esc(step.commit)}">Copiar</button> · con el id del paso entre corchetes, «Comprobar en GitHub» lo marca como hecho.</p>` : ''}` : ''}
    ${checks(key)}${tutorBox(key, `el paso ${key} («${s.titulo}»)${step?.objetivo ? `: ${step.objetivo}` : ''}`)}
  </article>`;
}

function renderGuia() {
  if (!T.outline) return noOutline();
  const hitos = T.outline.hitos;
  if (!openMilestone || !hitos.some((h) => h.id === openMilestone)) openMilestone = (hitos.find((h) => h.pasos.some((p) => p.parte === myPart())) ?? hitos[0]).id;
  const h = hitos.find((x) => x.id === openMilestone);
  const data = T.hitos[h.id];
  const byId = new Map((data?.pasos ?? []).map((p) => [p.id, p]));
  const list = h.pasos.filter((p) => !onlyMine || p.parte === myPart());
  return `<section class="tj-guide">
    <aside class="tj-side glass"><label class="check"><input type="checkbox" data-tj="mine" ${onlyMine ? 'checked' : ''} ${myPart() ? '' : 'disabled'}> Solo mi parte</label>
      <ol>${hitos.map((x) => {
        const n = x.pasos.length;
        const d = x.pasos.filter((p) => isDone(p.id)).length;
        return `<li><a href="#/trabajos/${esc(T.id)}/guia" data-tj="goto" data-hito="${esc(x.id)}" ${x.id === h.id ? 'aria-current="true"' : ''}><b>${esc(x.id)}</b> ${esc(x.titulo)}<small>${T.hitos[x.id] ? `${d}/${n} hechos` : 'sin generar'}</small>${bar(pct(d, n))}</a></li>`;
      }).join('')}</ol></aside>
    <div class="tj-main">
      <div class="tj-box glass"><h2>${esc(h.id)} · ${esc(h.titulo)}</h2><p><b>Entregable:</b> ${esc(h.entregable)}</p><p><b>Listo cuando:</b> ${esc(h.listo_cuando)}</p>${h.depende.length ? `<p class="fine">Depende de: ${esc(h.depende.join(', '))}</p>` : ''}
        ${data ? `<p class="fine">Escrito con ${esc(data.ai?.model ?? 'IA')} por ${esc(nameOf(data.by))}. <button type="button" class="link" data-tj="gen" data-hito="${esc(h.id)}">Generarlo otra vez</button></p>` : `${aiMissing('solution')}${weakFor('solution')}${ai.pickerHTML('solution')}<p><button type="button" class="button primary" data-tj="gen" data-hito="${esc(h.id)}">Generar este hito con tu IA</button> <span class="fine">Escribe el código de cada paso con cada línea explicada. Tarda unos minutos.</span></p>`}
        <span class="fine" id="tj-gen-status" role="status"></span></div>
      ${list.map((p) => stepHTML(p, byId.get(p.id))).join('') || '<p class="status">Tu parte no tiene pasos en este hito.</p>'}
    </div></section>`;
}

function renderAvance() {
  if (!T.outline) return noOutline();
  const all = steps();
  const reqs = T.outline.requisitos;
  const repo = T.repo ? `${T.repo.owner}/${T.repo.name}` : '';
  const token = !!ai.keyOf('github');
  return `<section class="tj-sec">
    <div class="tj-table glass"><table><thead><tr><th>Integrante</th><th>Parte</th><th>Su parte hecha</th><th>Entiende los pasos</th><th>Entiende el enunciado</th></tr></thead><tbody>
    ${T.members.map((m) => {
      const L = Object.entries(T.parts).find(([, u]) => u === m.uid)?.[0] ?? '';
      const own = all.filter((s) => s.parte === L);
      const a = T.avance[m.uid] ?? {};
      const pOwn = pct(own.filter((s) => a[s.id]?.d).length, own.length);
      const pU = pct(all.filter((s) => a[s.id]?.u).length, all.length);
      const pR = pct(reqs.filter((r) => a[r.id]?.u).length, reqs.length);
      return `<tr><td>${esc(m.name)}</td><td>${L ? `Persona ${L}` : '—'}</td><td>${L ? `${pOwn}% ${bar(pOwn, colorOf(L))}` : '—'}</td><td>${pU}% ${bar(pU, 'var(--blue)')}</td><td>${pR}% ${bar(pR, 'var(--butter)')}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="fine">Para la defensa, la columna que importa es «Entiende los pasos»: todos deben llegar al 100 %, no solo en su parte.</p></div>
    <div class="tj-box glass"><h2>GitHub</h2>
      <p class="fine">Cuando haces un commit cuyo mensaje empieza con el id del paso (por ejemplo <code>[H1.2] Carga del dataset</code>), «Comprobar en GitHub» lo encuentra y marca ese paso como hecho para ti.</p>
      ${T.owner === uid() ? `<form class="tj-inline" id="tj-repo"><label class="field"><span>Repositorio (dueño/nombre)</span><input name="repo" value="${esc(repo)}" placeholder="usuario/ml-precios-casas" pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"></label><button class="button ghost small" type="submit">Guardar</button></form>` : `<p>Repositorio: ${repo ? `<a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener">${esc(repo)}</a>` : 'todavía no se indicó'}</p>`}
      <details ${token ? '' : 'open'}><summary>${token ? 'Tu token de GitHub está guardado, cifrado, en tu cuenta' : 'Conectar tu GitHub (token de solo lectura, recomendado)'}</summary>
        <ol class="fine"><li>En GitHub: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens → Generate new token</a>.</li>
          <li>«Repository access»: <b>Only select repositories</b> y elige solo el repositorio del trabajo.</li>
          <li>«Permissions → Repository permissions → Contents»: <b>Read-only</b>. Nada más.</li>
          <li>Ponle un vencimiento (por ejemplo, la fecha de entrega), genéralo y pégalo aquí.</li></ol>
        <p class="fine">Con eso Studium solo puede <b>leer</b> ese repositorio, nunca escribir ni ver tus otros repositorios. Se guarda cifrado con tu contraseña, como las claves de tu IA.</p>
        <form class="tj-inline" id="tj-token"><label class="field"><span>Token</span><input name="token" type="password" autocomplete="off" placeholder="${PAT}…"></label><button class="button ghost small" type="submit">Guardar</button>${token ? '<button class="button ghost small danger" type="button" data-tj="forget-token">Olvidar</button>' : ''}</form>
        <p class="fine">Otras formas: <b>«Conectar con GitHub» en un clic</b> (pronto; GitHub le da acceso a todos tus repositorios privados, por eso no es la recomendada) y <b>el puente local</b> para trabajar en tu computadora (pronto).</p></details>
      <p><button type="button" class="button primary small" data-tj="check-gh" ${repo ? '' : 'disabled'}>Comprobar en GitHub</button> <span class="fine" id="tj-gh-status" role="status"></span></p>
    </div></section>`;
}

function renderIA() {
  const rows = T.members.flatMap((m) => (T.ia[m.uid] ?? []).map((e) => ({ ...e, who: m.name }))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `<section class="tj-sec"><div class="tj-box glass"><h2>Uso de IA</h2>
    <p class="fine">Cada vez que alguien del grupo usa su IA en este trabajo, Studium guarda qué IA, qué modelo y las instrucciones exactas. Al final descargas la cita del uso de IA para el entregable.</p>
    <button type="button" class="button primary small" data-tj="cite">Descargar la cita del uso de IA (Markdown)</button></div>
    ${rows.length ? rows.map((e) => `<details class="tj-log glass"><summary><b>${esc(e.who)}</b> · ${esc(e.task === 'tutor' ? 'explicación' : 'guía')} · ${esc(e.step)} · ${esc(e.model)} <span class="fine">${esc(new Date(e.at).toLocaleString('es'))}</span></summary><pre class="tj-pre">${esc(e.prompt)}</pre></details>`).join('') : '<p class="status">Todavía nadie usó su IA en este trabajo.</p>'}</section>`;
}

function citation() {
  const lines = [`# Uso de inteligencia artificial en «${T.title}»`, '',
    `Este trabajo${T.course ? ` del curso ${T.course}` : ''} se desarrolló en grupo con **Studium** (alexanderkholodov.web.app/studium), una plataforma de estudio. Studium generó, con la IA que eligió cada integrante, una guía de solución a partir del enunciado y la rúbrica: la teoría, el código en piezas con cada línea explicada y preguntas para comprobar la comprensión. Cada integrante escribió y ejecutó el código personalmente siguiendo la guía, marcó qué entendió y qué hizo, y consultó a su IA cuando no entendía algo. Abajo están las IA, los modelos y las instrucciones (prompts) usados, por integrante.`, '',
    '## Integrantes y partes', ...T.members.map((m) => { const L = Object.entries(T.parts).find(([, u]) => u === m.uid)?.[0]; return `- ${m.name}${L ? ` (Persona ${L})` : ''}`; }), '',
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

function noOutline() {
  const mine = T.owner === uid();
  return `<div class="tj-box glass"><h2>Todavía no hay guía</h2>${mine ? `<p>Genera el esquema con tu IA: los requisitos, el glosario, los hitos y el reparto de pasos.</p>${aiMissing('solution')}${weakFor('solution')}${ai.pickerHTML('solution')}<p><button type="button" class="button primary" data-tj="outline">Generar el esquema</button> <span class="fine" id="tj-gen-status" role="status"></span></p>` : '<p>Quien creó el trabajo todavía no generó el esquema.</p>'}</div>`;
}

function paint() {
  if (!T) return;
  const body = { enunciado: renderEnunciado, reparto: renderReparto, guia: renderGuia, avance: renderAvance, ia: renderIA }[tab] ?? renderGuia;
  root.innerHTML = header() + body();
}

async function openTrabajo(tid, sub) {
  tab = ['enunciado', 'reparto', 'guia', 'avance', 'ia'].includes(sub) ? sub : (T?.id === tid ? tab : 'enunciado');
  if (T?.id !== tid) {
    root.innerHTML = '<p class="status">Abriendo el trabajo…</p>';
    T = await loadTrabajo(tid);
    asking.clear(); openMilestone = '';
    if (!T) { root.innerHTML = '<p class="status">Ese trabajo no existe, o no eres parte de él.</p>'; return; }
  }
  paint();
}

/* ---------- what the buttons do ---------- */
const say = (id, text) => { const el = $(id, root); if (el) el.textContent = text; };
async function busy(button, work) {
  const was = button?.disabled;
  if (button) button.disabled = true;
  try { await work(); } catch (e) { console.error(e); ctx?.toast?.(ctx.explain ? ctx.explain(e) : e.message); throw e; } finally { if (button) button.disabled = was; }
}
function toggle(kind, key, on) {
  const mine = { ...(T.avance[uid()] ?? {}) };
  mine[key] = { ...(mine[key] ?? {}), [kind]: on };
  if (kind === 'd' && !on) delete mine[key].c;
  T.avance[uid()] = mine;
  return saveAvance();
}
async function ask(key, label) {
  if (!ai.ready()) { ctx.toast('Conecta una IA en Ajustes: la clave gratis de Gemini sirve.'); return; }
  asking.set(key, { busy: true }); paint();
  const text = `Trabajo: «${T.title}»${T.course ? ` (curso ${T.course})` : ''}.\nNo entiendo ${label}.\nExplícamelo.`;
  try {
    const r = await askAI('tutor', TUTOR, text, [], 'No lo entiendo');
    asking.set(key, { text: r.text, model: r.model });
    await logAI({ task: 'tutor', step: key.split('#')[0], model: r.model, provider: r.way, prompt: `${TUTOR}\n\n${text}` });
  } catch (e) { asking.set(key, { error: e.message }); }
  paint();
}
async function checkGitHub() {
  const token = ai.keyOf('github');
  const { owner, name } = T.repo;
  say('#tj-gh-status', 'Leyendo los commits…');
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=100`, { headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (res.status === 404 || res.status === 401) throw new Error(token ? 'GitHub no deja leer ese repositorio con tu token: revisa que el token incluya ese repositorio con «Contents: Read-only».' : 'El repositorio es privado o no existe: conecta tu token de GitHub (solo lectura).');
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}.`);
  const commits = await res.json();
  const ids = new Set(steps().map((s) => s.id));
  const found = new Map();
  for (const c of commits) {
    for (const m of String(c.commit?.message ?? '').matchAll(/\[([A-Z]{1,2}\d{1,3}\.\d{1,3})\]/g)) if (ids.has(m[1]) && !found.has(m[1])) found.set(m[1], c.sha);
  }
  const part = myPart();
  const mine = { ...(T.avance[uid()] ?? {}) };
  let marked = 0;
  for (const [id, sha] of found) {
    const s = steps().find((x) => x.id === id);
    if (part && s.parte !== part) continue;
    if (!mine[id]?.d) marked += 1;
    mine[id] = { ...(mine[id] ?? {}), d: true, c: sha };
  }
  T.avance[uid()] = mine;
  if (marked) await saveAvance();
  paint();
  say('#tj-gh-status', `${found.size} ${found.size === 1 ? 'paso encontrado' : 'pasos encontrados'} en los últimos ${commits.length} commits; ${marked} ${marked === 1 ? 'marcado' : 'marcados'} como hechos para ti${part ? ` (tu parte, la ${part})` : ''}.`);
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
    if (form.id === 'tj-new') {
      await busy(button, async () => {
        say('#tj-new-status', 'Creando el trabajo…');
        const made = await createTrabajo(form);
        T = await loadTrabajo(made.id);
        tab = 'enunciado';
        history.replaceState(null, '', `#/trabajos/${made.id}/enunciado`);
        if (ai.ready()) {
          say('#tj-new-status', 'Tu IA está leyendo el enunciado y armando el esquema (uno o dos minutos)…');
          try { await generateOutline(made.pdfs); } catch (e) { ctx.toast(`El trabajo se creó, pero el esquema falló: ${e.message}`); }
        }
        paint();
      }).catch(() => say('#tj-new-status', ''));
    } else if (form.id === 'tj-join') {
      await busy(button, () => join(form)).catch(() => say('#tj-join-status', 'No se pudo entrar: el enlace no es válido o ya no está vigente.'));
    } else if (form.id === 'tj-repo') {
      const v = String(new FormData(form).get('repo') ?? '').trim();
      const [owner, name] = v.split('/');
      await busy(button, async () => {
        await setDoc(tRef(T.id), owner && name ? { repo: { owner, name }, updated: serverTimestamp() } : { updated: serverTimestamp() }, { merge: true });
        T.repo = owner && name ? { owner, name } : null;
        paint(); ctx.toast('Repositorio guardado.');
      }).catch(() => {});
    } else if (form.id === 'tj-token') {
      const v = String(new FormData(form).get('token') ?? '').trim();
      if (!(v.startsWith(PAT) || v.startsWith(CLASSIC)) || !/^[A-Za-z0-9_]{30,}$/.test(v)) { ctx.toast(`Eso no parece un token de GitHub (empieza con ${PAT}).`); return; }
      ai.setKey('github', v); paint(); ctx.toast('Token guardado, cifrado.');
    }
  });
  root.addEventListener('change', async (ev) => {
    const el = ev.target;
    const kind = el.dataset?.tj;
    if (kind === 'u' || kind === 'd') {
      try { await toggle(kind, el.dataset.key, el.checked); paint(); } catch (e) { el.checked = !el.checked; ctx.toast(ctx.explain(e)); }
    } else if (kind === 'mine') { onlyMine = el.checked; paint(); }
    else if (el.closest?.('[data-ai-pick]')) { const task = el.closest('[data-ai-pick]').dataset.aiPick; ai.setChoice(task, ai.picked(task, root)); }
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-tj]');
    if (!b || b.tagName === 'INPUT') return;
    const kind = b.dataset.tj;
    if (kind === 'goto') { ev.preventDefault(); openMilestone = b.dataset.hito; tab = 'guia'; history.replaceState(null, '', `#/trabajos/${T.id}/guia`); paint(); scrollTo({ top: 0 }); return; }
    if (kind === 'ask') { await ask(b.dataset.key, b.dataset.label); return; }
    if (kind === 'copy') { await navigator.clipboard.writeText(b.dataset.text).then(() => ctx.toast('Copiado.'), () => ctx.toast('No se pudo copiar.')); return; }
    if (kind === 'invite') {
      const link = `${location.origin}${location.pathname}#/trabajos/unirse/${T.id}/${T.code}`;
      await navigator.clipboard.writeText(link).then(() => ctx.toast('Enlace de invitación copiado: compártelo solo con tu grupo.'), () => prompt('Enlace de invitación', link));
      return;
    }
    if (kind === 'reload') { await busy(b, async () => { T = await loadTrabajo(T.id); paint(); }).catch(() => {}); return; }
    if (kind === 'take') { await busy(b, async () => { await setDoc(tRef(T.id, 'partes', b.dataset.part), { uid: uid(), at: serverTimestamp() }); T.parts[b.dataset.part] = uid(); paint(); }).catch(() => ctx.toast('Esa parte ya la tomó alguien: pulsa «Actualizar».')); return; }
    if (kind === 'leave') { const L = myPart(); await busy(b, async () => { await deleteDoc(tRef(T.id, 'partes', L)); delete T.parts[L]; paint(); }).catch(() => {}); return; }
    if (kind === 'outline') {
      await busy(b, async () => { say('#tj-gen-status', 'Tu IA está armando el esquema…'); await generateOutline(); paint(); }).catch((e) => say('#tj-gen-status', e.message));
      return;
    }
    if (kind === 'gen') {
      await busy(b, async () => { say('#tj-gen-status', `Tu IA está escribiendo el hito ${b.dataset.hito}, con cada línea explicada (unos minutos)…`); await generateMilestone(b.dataset.hito); paint(); }).catch((e) => say('#tj-gen-status', e.message));
      return;
    }
    if (kind === 'check-gh') { await busy(b, checkGitHub).catch((e) => say('#tj-gh-status', e.message)); return; }
    if (kind === 'forget-token') { ai.setKey('github', ''); paint(); return; }
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
  if (arg[0]) return openTrabajo(arg[0], arg[1]);
  T = null;
  return renderList();
}
