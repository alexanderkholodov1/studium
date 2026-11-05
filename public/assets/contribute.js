// "Aportar": instructions for the person's own AI, the review of what it returns (contributions and guides), and the
// account's own items. Nothing of the original material reaches Studium: only what the AI extracted, after review.
import { THEMES, keyOf, themeStyle, guessTheme, validTheme } from './themes.js';
import {
  KINDS, LEVELS, contributionInstructions, curriculumInstructions, guideInstructions, parseContribution, parseGuide,
  contextPack, findPersonal, redact,
} from './prompts.js';
import { publishContribution, publishGuide, setVisibility, remove, LIMIT } from './data.js';
import { prepareGuide } from './viewer.js';
import { rise } from './fx.js';
import * as ai from './ai.js';
import { prefs } from './prefs.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* the draft is just not remembered */ } },
};
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

let ctx = null; // { state, user, refresh, toast, go }

export function download(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); ctx.toast(`${what} copiadas. Pégalas en tu IA.`); }
  catch { ctx.toast('No se pudo copiar: descarga el archivo y adjúntalo en tu IA.'); }
}

function known() {
  const { catalog, contributions } = ctx.state;
  const lessons = contributions.filter((c) => c.kind !== 'curriculum');
  return {
    courses: uniq([...catalog, ...lessons].map((x) => x.course)),
    professors: uniq([...catalog, ...lessons].map((x) => x.professor)),
    terms: uniq([...catalog, ...lessons].map((x) => x.term)),
    universities: uniq(contributions.concat(catalog).map((x) => x.university)),
  };
}
// The display name already used for the same course or person, so that variants join the same node.
function canonical(value, options) {
  const key = keyOf(value);
  return options.find((o) => keyOf(o) === key) ?? value;
}
const canonicalCourse = (value) => ctx.state.graph.byId.get(`course:${keyOf(value)}`)?.name ?? value;

const datalists = () => {
  const k = known();
  const opts = (xs) => xs.map((x) => `<option value="${esc(x)}">`).join('');
  return `<datalist id="dl-courses">${opts(k.courses)}</datalist><datalist id="dl-profs">${opts(k.professors)}</datalist>
    <datalist id="dl-terms">${opts(k.terms)}</datalist><datalist id="dl-unis">${opts(k.universities)}</datalist>`;
};
const input = (name, label, value, attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const segmented = (name, options, value, label) => `<fieldset class="seg" aria-label="${esc(label)}"><legend>${esc(label)}</legend>${
  Object.entries(options).map(([k, v]) => `<label><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}</fieldset>`;
const themePicker = (name, value) => `<fieldset class="themes" aria-label="Estilo visual"><legend>Estilo visual de la materia</legend>${
  Object.entries(THEMES).map(([k, t]) => `<label class="swatch" style="${themeStyle(k)}" title="${esc(t.hint)}"><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</fieldset>`;
const dropzone = (id) => `<div class="dropzone" data-drop="${id}">
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 31V11m0 0-8 8m8-8 8 8M10 30v5a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4v-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <p><strong>Suelta aquí los archivos</strong> que te devolvió tu IA (.json o .html), o</p>
    <label class="button ghost">Elegir archivos<input type="file" accept=".json,.html,.htm,.txt,.md,application/json,text/html" multiple hidden data-files="${id}"></label>
  </div>
  <details class="paste"><summary>O pega aquí la respuesta de tu IA</summary>
    <textarea rows="7" data-paste="${id}" placeholder="Pega el bloque de código JSON, o la página HTML completa"></textarea>
    <button class="button ghost" data-review-paste="${id}">Revisar</button>
  </details>
  <div class="reviews" data-reviews="${id}"></div>`;

/* ---------- your AI, inside Studium ---------- */
const PROMPT_URL = 'https://github.com/alexanderkholodov1/studium/blob/main/public/assets/prompts.js';
const promise = () => `<aside class="anon glass">
    <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-shield"/></svg>
    <div><h2>Todo se anonimiza. Siempre.</h2>
      <p>Tus archivos van solo a tu IA. Ella saca las notas, nombres, códigos, correos y comentarios personales, y a
        Studium llega solo lo que se estudia: conceptos, preguntas y ejemplos. Antes de publicar, Studium vuelve a buscar
        datos personales y te muestra lo que encuentre.</p>
      <p class="fine">El único propósito es armar el conocimiento más amplio posible para otros estudiantes como tú.
        <a href="${PROMPT_URL}" target="_blank" rel="noopener noreferrer">Puedes leer las instrucciones exactas que recibe tu IA</a>.</p></div>
  </aside>`;
function aiStep(zone) {
  if (!ai.ready()) {
    return `<li class="step glass ai-step off"><h2>Con tu IA, sin copiar ni pegar</h2>
      <p>Conecta Claude, ChatGPT o Gemini en <a href="#/ajustes">Ajustes</a> con tu propia clave, y Studium hace todo el
        camino: le pasa tus archivos a tu IA con estas instrucciones y te muestra el resultado para que lo revises.
        Studium no cobra nada; tu proveedor cobra lo que use tu clave.</p>
      <div class="actions"><a class="button primary" href="#/ajustes">Conectar mi IA</a></div></li>`;
  }
  return `<li class="step glass ai-step"><h2>Con tu IA, sin copiar ni pegar</h2>
    <p>Usará <strong>${esc(ai.label())}</strong>. Suelta uno o varios archivos, o una carpeta entera: cada archivo va a
      tu IA con las instrucciones de Studium y vuelve aquí para que lo revises.</p>
    <div class="dropzone" data-ai-drop="${zone}">
      <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14a4 4 0 0 1 4-4h8l4 4h12a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M24 30V20m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p><strong>Suelta aquí tus archivos o una carpeta</strong>: PDF, fotos o texto.</p>
      <div class="actions"><label class="button primary">Elegir archivos<input type="file" multiple hidden data-ai-files="${zone}" accept=".pdf,image/*,.txt,.md,.tex,.csv,.json,.py,.c,.cpp,.java,.js"></label>
        <label class="button ghost">Elegir una carpeta<input type="file" multiple hidden webkitdirectory data-ai-files="${zone}"></label></div>
    </div>
    <ul class="ai-queue" data-ai-queue="${zone}"></ul>
  </li>`;
}
const queue = [];
let working = false;
function enqueue(zone, files) {
  const list = $(`[data-ai-queue="${zone}"]`);
  for (const file of files) {
    const id = `q${serial += 1}`;
    list.insertAdjacentHTML('beforeend', `<li id="${id}"><span class="name">${esc(file.webkitRelativePath || file.name)}</span><span class="state">En espera</span></li>`);
    queue.push({ id, zone, file });
  }
  work();
}
const setRow = (id, text, cls = '') => { const row = document.getElementById(id); if (row) { row.className = cls; row.querySelector('.state').textContent = text; } };
async function work() {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      setRow(job.id, 'Leyendo…', 'busy');
      const file = await ai.readFile(job.file);
      if (file.skipped) { setRow(job.id, `Saltado: ${file.skipped}`, 'skip'); continue; }
      setRow(job.id, 'Tu IA lo está leyendo…', 'busy');
      const v = materialValues();
      const system = v.kind === 'curriculum' ? curriculumInstructions(v) : contributionInstructions(v);
      const res = await ai.run({
        system, files: [file], maxTokens: 32000,
        text: 'Procesa el material adjunto siguiendo las instrucciones de Studium. Responde solo con el JSON, en un bloque de código.',
        onProgress: (n) => setRow(job.id, n < 0 ? 'Tu IA está escribiendo…' : `Tu IA está escribiendo… ${n.toLocaleString('es')} caracteres`, 'busy'),
      });
      const item = addReview('material', res.text, job.file.webkitRelativePath || job.file.name, { provider: res.provider, model: res.model, effort: res.effort });
      setRow(job.id, item.parsed.error ? 'Tu IA no devolvió un aporte válido: revisa abajo' : res.truncated ? 'Listo, pero quedó cortado: revisa abajo' : 'Listo: revísalo abajo', item.parsed.error ? 'bad' : 'ok');
    } catch (error) {
      setRow(job.id, error.message || 'Algo falló', 'bad');
      if (/clave|saldo|límite/.test(error.message || '')) { for (const j of queue.splice(0)) setRow(j.id, 'Detenido', 'skip'); }
    }
  }
  working = false;
}
// A dropped folder arrives as entries: walk it.
async function droppedFiles(dataTransfer) {
  const out = [];
  const walk = (entry) => new Promise((resolve) => {
    if (entry.isFile) entry.file((f) => { out.push(f); resolve(); }, () => resolve());
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const more = () => reader.readEntries(async (batch) => { if (!batch.length) { for (const e of all) await walk(e); resolve(); } else { all.push(...batch); more(); } }, () => resolve());
      more();
    } else resolve();
  });
  const entries = [...(dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  for (const e of entries) await walk(e);
  return out;
}

/* ---------- material ---------- */
function materialPane() {
  const d = store.get('studium-draft-material') ?? { kind: 'exam' };
  return `${datalists()}
  ${promise()}
  <ol class="flow">
    <li class="step glass">
      <h2>Cuéntale a tu IA qué es</h2>
      <p>Lo que completes va en las instrucciones; lo que dejes vacío, tu IA lo saca del material.</p>
      <form class="grid" id="m-form">
        ${segmented('kind', KINDS, d.kind, 'Qué material es')}
        ${input('course', 'Materia, competencia o carrera', d.course, 'list="dl-courses" autocomplete="off"')}
        ${input('code', 'Código', d.code, 'autocomplete="off"')}
        ${input('university', 'Universidad u organizador', d.university, 'list="dl-unis" autocomplete="off"')}
        ${input('professor', 'Profesor', d.professor, 'list="dl-profs" autocomplete="off"')}
        ${input('term', 'Semestre o edición', d.term, 'list="dl-terms" autocomplete="off" placeholder="202610, IEEEXtreme 19.0…"')}
      </form>
      <details class="prompt"><summary>Ver las instrucciones que recibe tu IA</summary><pre id="m-prompt"></pre></details>
    </li>
    ${aiStep('material')}
    <li class="step glass">
      <h2>${ai.ready() ? 'O hazlo a mano, con cualquier IA' : 'Pásale tu material a tu IA'}</h2>
      <p>Sirve con cualquier IA que lea archivos: ChatGPT, Gemini, Claude, Copilot o NotebookLM.</p>
      <div class="actions">
        <button class="button ${ai.ready() ? 'ghost' : 'primary'}" id="m-copy">Copiar instrucciones</button>
        <button class="button ghost" id="m-download">Descargar instrucciones</button>
      </div>
      <ol class="howto">
        <li>Abre un chat nuevo en tu IA.</li>
        <li>Adjunta tu material: PDF, fotos, diapositivas, enunciados o la malla. Varios archivos a la vez está bien.</li>
        <li>Pega las instrucciones y envía.</li>
        <li>Descarga el archivo <code>.json</code> que te devuelve. Si tu IA no crea archivos, copia su bloque de código.</li>
      </ol>
      <p class="note">Tu material no se sube a Studium: solo el resumen anónimo que hace tu IA, después de que lo revises.</p>
    </li>
    <li class="step glass">
      <h2>Sube lo que te devolvió</h2>
      ${dropzone('material')}
    </li>
  </ol>`;
}
function materialValues() {
  const f = new FormData($('#m-form'));
  const v = Object.fromEntries(f.entries());
  store.set('studium-draft-material', v);
  const k = known();
  const course = v.course?.trim();
  const lessons = ctx.state.contributions.filter((c) => keyOf(c.course) === keyOf(course));
  const knownConcepts = uniq(lessons.flatMap((c) => (c.data.concepts ?? []).map((x) => x.name)));
  return { ...v, course: canonicalCourse(course), professor: canonical(v.professor?.trim(), k.professors), known: knownConcepts };
}
const materialPrompt = () => { const v = materialValues(); return v.kind === 'curriculum' ? curriculumInstructions(v) : contributionInstructions(v); };

/* ---------- guide ---------- */
function coursesWithMaterial() {
  const g = ctx.state.graph;
  return g.nodes.filter((n) => n.type === 'course' && (n.contributions.length || n.guides.length))
    .sort((a, b) => b.contributions.length - a.contributions.length || a.name.localeCompare(b.name, 'es'));
}
function guidePane(preset = {}) {
  const courses = coursesWithMaterial();
  const d = { level: 'standard', length: 'medium', practice: 'normal', challenge: 'same', examples: 'normal', language: 'C++', ...(store.get('studium-draft-guide') ?? {}), ...preset };
  if (!courses.length) {
    return `<div class="empty glass"><h2>Todavía no hay material para crear guías</h2>
      <p>Una guía se crea con lo que otros aportaron de una materia. Aporta el primer material y vuelve aquí.</p>
      <a class="button primary" href="#/aportar">Aportar material</a></div>`;
  }
  const chosen = courses.find((c) => c.id === d.course) ?? courses[0];
  return `<ol class="flow">
    <li class="step glass" style="${themeStyle(chosen.theme)}">
      <h2>Elige qué vas a estudiar</h2>
      <form class="grid" id="g-form">
        <label class="field wide"><span>Materia o competencia</span><select name="course">${courses.map((c) => `<option value="${esc(c.id)}" ${c === chosen ? 'selected' : ''}>${esc(c.name)} (${c.contributions.length} ${c.contributions.length === 1 ? 'aporte' : 'aportes'})</option>`).join('')}</select></label>
        <label class="field"><span>Profesor</span><select name="professor"><option value="">Todos</option>${[...chosen.professors.keys()].sort().map((p) => `<option ${p === d.professor ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label class="field"><span>Semestre o edición</span><select name="term"><option value="">Todos</option>${[...chosen.terms].sort().map((t) => `<option ${t === d.term ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        ${input('title', 'Evaluación', d.title ?? '', 'placeholder="Examen final, Parcial 2, Ronda 1…"')}
        ${input('date', 'Fecha', d.date ?? '', 'type="date"')}
        <div class="wide"><h3>Hazla a tu medida</h3></div>
        ${segmented('level', LEVELS, d.level, 'Nivel de explicación')}
        ${segmented('length', { short: 'Repaso corto', medium: 'Media', complete: 'Completa' }, d.length, 'Extensión')}
        ${segmented('practice', { few: 'Poca', normal: 'Normal', lots: 'Mucha' }, d.practice, 'Práctica')}
        ${segmented('challenge', { easier: 'Más fácil', same: 'Como la evaluación', harder: 'Más difícil' }, d.challenge, 'Dificultad de la práctica')}
        ${segmented('examples', { few: 'Pocos', normal: 'Normal', lots: 'Muchos' }, d.examples, 'Ejemplos resueltos')}
        ${chosen.theme === 'algoritmos' || chosen.contributions.some((c) => c.kind === 'contest') ? segmented('language', { 'C++': 'C++', Python: 'Python', Java: 'Java' }, d.language, 'Lenguaje del código') : ''}
        ${input('focus', 'Quiero reforzar (opcional)', d.focus ?? '', 'placeholder="Ej.: demostraciones, programación dinámica…"')}
        ${input('goal', 'Tu objetivo con esta guía (opcional)', d.goal ?? '', 'placeholder="Sacar más de 18, entender desde cero, repasar en una noche…"')}
        ${segmented('lang', { es: 'Español', en: 'English' }, d.lang ?? (prefs.get().lang || 'es'), 'Idioma de la guía')}
        ${segmented('decor', DECOR, d.decor ?? 'notebook', 'Estilo y decoración')}
        <fieldset class="tagpick wide"><legend>Secciones extra: cada una suma instrucciones para tu IA</legend><div>${Object.entries(SECTIONS).map(([k, label]) => {
          const rec = (RECOMMENDED[prefs.get().mode] ?? []).includes(k);
          const on = d.sections ? d.sections.includes(k) : rec;
          return `<label><input type="checkbox" name="sections" value="${k}" ${on ? 'checked' : ''}><span>${esc(label)}${rec ? ' <small>· recomendada para ti</small>' : ''}</span></label>`;
        }).join('')}</div></fieldset>
      </form>
      <div class="scope">
        <div class="scope-head"><h3>Conceptos que entran</h3><button class="link" data-scope="all">Todos</button><button class="link" data-scope="none">Ninguno</button></div>
        <div class="chips" id="g-scope"></div>
      </div>
      <p class="note" id="g-summary"></p>
    </li>
    <li class="step glass">
      <h2>Pídesela a tu IA</h2>
      ${ai.ready() ? `<div class="ai-make"><button class="button primary big" id="g-ai">Crear con mi IA</button>
        <span class="hint">Usará ${esc(ai.label())}. Una guía larga puede tardar varios minutos; no cierres la página.</span>
        <p class="ai-progress" id="g-ai-progress" role="status" hidden></p></div>
        <p class="note">O hazlo a mano con cualquier IA:</p>`
        : '<p class="note">Con tu IA conectada en <a href="#/ajustes">Ajustes</a>, Studium la crea por ti sin copiar ni pegar. Mientras, hazlo a mano:</p>'}
      <div class="actions">
        <button class="button ${ai.ready() ? 'ghost' : 'primary'}" id="g-download">Descargar contexto</button>
        <button class="button ghost" id="g-copy">Copiar instrucciones</button>
      </div>
      <ol class="howto">
        <li>Abre un chat nuevo en tu IA.</li>
        <li>Adjunta el archivo de contexto que descargaste (y tu propio material, si quieres).</li>
        <li>Pega las instrucciones y envía.</li>
        <li>Descarga el archivo <code>guia.html</code> que te devuelve.</li>
      </ol>
      <p class="note">Para escribir la guía conviene una IA que cree archivos o escriba mucho código seguido, como ChatGPT,
        Claude o Gemini. NotebookLM sirve para aportar material y para estudiar el contexto en audio o con tarjetas.</p>
      <details class="prompt"><summary>Ver las instrucciones</summary><pre id="g-prompt"></pre></details>
    </li>
    <li class="step glass">
      <h2>Sube la guía</h2>
      ${dropzone('guide')}
    </li>
  </ol>`;
}
const SECTIONS = {
  flashcards: 'Tarjetas de términos para repasar',
  mock: 'Simulacro de la prueba, con tiempo',
  cheatsheet: 'Resumen de una página para el último repaso',
  mistakes: 'Errores comunes y trampas',
  solved: 'Ejercicios resueltos paso a paso',
  conceptmap: 'Mapa de conceptos interactivo',
  selfcheck: 'Autoevaluación con puntaje al final de cada tema',
};
// What fits each way of studying (the person's setting), checked by default.
const RECOMMENDED = { examenes: ['mock', 'cheatsheet', 'mistakes'], gusto: ['conceptmap', 'solved'], intensivo: ['flashcards', 'mock'], metas: ['selfcheck', 'flashcards'] };
const DECOR = { notebook: 'Cuaderno', minimal: 'Minimal', playful: 'Tierna', night: 'Nocturna' };
let scope = null;
function guideValues() {
  const form = $('#g-form');
  if (!form) return null;
  const f = new FormData(form);
  const v = Object.fromEntries(f.entries());
  v.sections = f.getAll('sections');
  store.set('studium-draft-guide', v);
  const g = ctx.state.graph;
  const course = g.byId.get(v.course);
  const concepts = g.links.filter((l) => l.kind === 'in' && l.source === course).map((l) => l.target)
    .concat(g.links.filter((l) => l.kind === 'has' && l.source === course).flatMap((l) => g.links.filter((m) => m.source === l.target).map((m) => m.target)))
    .filter((n, i, all) => n.type === 'concept' && all.indexOf(n) === i);
  return { v, course, concepts };
}
function renderScope() {
  const values = guideValues();
  if (!values) return;
  const { v, course, concepts } = values;
  const key = `${course.id}`;
  if (!scope || scope.key !== key) scope = { key, off: new Set() };
  const ranked = [...concepts].sort((a, b) => b.questions.length - a.questions.length || a.name.localeCompare(b.name, 'es'));
  $('#g-scope').innerHTML = ranked.map((n) => `<button type="button" class="chip ${scope.off.has(n.key) ? '' : 'on'}" data-concept="${esc(n.key)}">${esc(n.name)}${n.questions.length ? `<small>${n.questions.length}</small>` : ''}</button>`).join('');
  const lessons = course.contributions;
  const qs = lessons.reduce((s, c) => s + (c.data.questions?.length ?? 0), 0);
  const ex = lessons.reduce((s, c) => s + (c.data.examples?.length ?? 0), 0);
  const prof = v.professor ? lessons.filter((c) => c.professor === v.professor).length : 0;
  $('#g-summary').textContent = `Studium tiene ${concepts.length} conceptos, ${qs} preguntas y ${ex} ejemplos de ${course.name}${v.professor ? `; ${prof} de esos aportes son de ${v.professor}` : ''}.`;
  $('#g-prompt').textContent = guidePrompt();
}
function guideRequest() {
  const { v, course, concepts } = guideValues();
  const picked = concepts.filter((n) => !scope?.off.has(n.key));
  const contest = course.theme === 'algoritmos' || course.contributions.some((c) => c.kind === 'contest');
  const file = `studium-contexto-${keyOf(course.name).slice(0, 40)}.md`;
  return { v, course, picked, contest, file };
}
function guidePrompt(api = false) {
  const { v, course, contest, file } = guideRequest();
  return guideInstructions({
    ...v, course: course.name, code: course.code, university: course.contributions.find((c) => c.university)?.university ?? '',
    theme: course.theme, contest, contextFile: file, api, mode: prefs.get().mode,
  });
}
let making = null;
async function generateGuide() {
  const button = $('#g-ai');
  const out = $('#g-ai-progress');
  if (making) { making.abort(); return; }
  making = new AbortController();
  button.textContent = 'Cancelar';
  out.hidden = false;
  out.textContent = 'Tu IA está leyendo el contexto…';
  try {
    const { file } = guideRequest();
    const res = await ai.run({
      system: guidePrompt(true),
      text: `Este es el archivo ${file}, con el contexto de Studium:\n\n${guideContext()}\n\nEscribe la guía completa. Responde solo con el HTML completo, desde <!doctype html> hasta </html>.`,
      maxTokens: ai.config().provider === 'anthropic' ? 64000 : 32000,
      signal: making.signal,
      onProgress: (n) => { out.textContent = n < 0 ? 'Tu IA está escribiendo la guía…' : `Tu IA está escribiendo la guía… ${n.toLocaleString('es')} caracteres`; },
    });
    const html = ai.htmlFrom(res.text);
    if (!html) throw new Error('Tu IA no devolvió una página HTML completa. Vuelve a intentarlo.');
    const item = addReview('guide', html, `Guía creada con ${ai.PROVIDERS[res.provider]?.name ?? 'tu IA'}`, { provider: res.provider, model: res.model, effort: res.effort });
    out.textContent = res.truncated ? 'Lista, pero quedó cortada: elige una extensión más corta y vuelve a crearla.' : 'Lista: revísala abajo y publícala.';
    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    out.textContent = error.message || 'Algo falló.';
  } finally {
    making = null;
    button.textContent = 'Crear con mi IA';
  }
}
function guideContext() {
  const { v, course, picked, contest } = guideRequest();
  return contextPack({
    course: { name: course.name, code: course.code, university: course.contributions.find((c) => c.university)?.university ?? '' },
    professor: v.professor, term: v.term, contest,
    concepts: picked.map((n) => ({ key: n.key, name: n.name, summaries: n.summaries.map((s) => s.text), relations: n.relations })),
    contributions: course.contributions, guides: course.guides,
  });
}

/* ---------- review ---------- */
const reviews = new Map(); // review id -> item
let serial = 0;

async function readFiles(zone, files) {
  for (const file of files) {
    if (file.size > 8_000_000) { ctx.toast(`${file.name} pesa más de 8 MB: no es un archivo de Studium.`); continue; }
    addReview(zone, await file.text(), file.name);
  }
}
function addReview(zone, text, name, made = null) {
  const html = /^\s*<!doctype html/i.test(text.replace(/^﻿/, ''));
  const preset = zone === 'guide' ? guideValues() : null;
  const fallback = zone === 'guide' && preset
    ? { course: preset.course.name, code: preset.course.code, professor: preset.v.professor, term: preset.v.term, title: preset.v.title, date: preset.v.date, level: preset.v.level, theme: preset.course.theme }
    : materialValues();
  const parsed = html ? parseGuide(text, fallback) : parseContribution(text, fallback);
  const id = `r${serial += 1}`;
  const item = { id, zone, name, html, text, parsed, visibility: 'public', confirmed: false, replace: zone.startsWith('replace:') ? zone.slice(8) : '', ai: made, sign: false };
  reviews.set(id, item);
  const list = $(`[data-reviews="${zone.startsWith('replace:') ? 'mine' : zone}"]`);
  list.insertAdjacentHTML('afterbegin', `<article class="review glass" id="${id}"></article>`);
  renderReview(item);
  rise(list, ':scope > :first-child');
  return item;
}
function renderReview(item) {
  const el = document.getElementById(item.id);
  const { parsed } = item;
  if (parsed.error) {
    el.innerHTML = `<header><span class="badge bad">No se pudo leer</span><strong>${esc(item.name)}</strong><button class="link" data-discard="${item.id}">Quitar</button></header><p class="msg">${esc(parsed.error)}</p>`;
    return;
  }
  const k = known();
  const m = parsed.meta;
  m.course = canonicalCourse(m.course);
  m.professor = canonical(m.professor, k.professors);
  m.theme = validTheme(m.theme) ?? ctx.state.themes.get(keyOf(m.course)) ?? guessTheme(m.course);
  const findings = findPersonal(item.html ? parsed.text : item.text, ctx.user.email);
  const blocking = findings.filter((f) => f.block);
  const needsLook = findings.filter((f) => !f.block);
  const isGuide = item.html;
  const curriculum = !isGuide && m.kind === 'curriculum';
  const conceptNames = isGuide ? parsed.concepts.map((c) => c.name) : (parsed.data.concepts ?? []).map((c) => c.name);
  const inMap = new Set(ctx.state.graph.nodes.filter((n) => n.type === 'concept' && !n.ghost).map((n) => n.key));
  const fresh = conceptNames.filter((n) => !inMap.has(keyOf(n))).length;
  const summary = isGuide
    ? `Explica ${conceptNames.length} conceptos (${fresh} nuevos en el mapa). ${kb(new TextEncoder().encode(item.text).length)}.`
    : curriculum
      ? `${parsed.data.curriculum.semesters.length} semestres, ${parsed.data.curriculum.semesters.reduce((s, x) => s + x.courses.length, 0)} materias.`
      : `${conceptNames.length} conceptos (${fresh} nuevos en el mapa), ${parsed.data.questions.length} preguntas, ${parsed.data.examples.length} ejemplos.`;
  const ready = m.course && m.title && !blocking.length && (!needsLook.length || item.confirmed) && (!isGuide || /^\d{4}-\d{2}-\d{2}$/.test(m.date || ''));
  el.setAttribute('style', themeStyle(m.theme));
  el.innerHTML = `<header>
      <span class="badge">${isGuide ? 'Guía' : curriculum ? 'Malla' : `Aporte: ${esc(KINDS[m.kind] ?? 'Otro')}`}</span>
      <strong>${esc(item.name)}</strong>
      <button class="link" data-discard="${item.id}">Quitar</button>
    </header>
    ${item.done ? `<p class="done">${item.done}</p>` : `
    <form class="grid" data-meta="${item.id}">
      ${isGuide ? '' : `<label class="field"><span>Tipo</span><select name="kind">${Object.entries(KINDS).map(([key, v]) => `<option value="${key}" ${key === m.kind ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`}
      ${input('course', curriculum ? 'Carrera' : 'Materia o competencia', m.course, 'list="dl-courses" required')}
      ${curriculum ? '' : input('code', 'Código', m.code)}
      ${input('university', 'Universidad u organizador', m.university, 'list="dl-unis"')}
      ${curriculum ? '' : input('professor', 'Profesor', m.professor, 'list="dl-profs"')}
      ${curriculum ? '' : input('term', 'Semestre o edición', m.term, 'list="dl-terms"')}
      ${input('title', isGuide ? 'Evaluación' : 'Título', m.title, 'required')}
      ${isGuide ? input('date', 'Fecha de la evaluación', m.date, 'type="date" required') : ''}
      ${isGuide ? `<label class="field"><span>Nivel</span><select name="level"><option value="">Sin indicar</option>${Object.entries(LEVELS).map(([key, v]) => `<option value="${key}" ${key === m.level ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>` : ''}
      ${curriculum ? '' : themePicker(`theme-${item.id}`, m.theme)}
      ${isGuide ? `<label class="field"><span>Hecha con</span><select name="aiprov"><option value="">No lo digo</option>${Object.entries(ai.PROVIDERS).map(([k, pr]) => `<option value="${k}" ${item.ai?.provider === k ? 'selected' : ''}>${esc(pr.name)}</option>`).join('')}<option value="other" ${item.ai?.provider === 'other' ? 'selected' : ''}>Otra IA</option></select></label>
        ${input('aimodel', 'Modelo', item.ai?.model ?? '', 'maxlength="80" placeholder="Ej.: claude-opus-5-5"')}
        <label class="field"><span>Esfuerzo</span><select name="aieffort"><option value="">Sin indicar</option>${Object.entries(ai.EFFORTS).map(([k, label]) => `<option value="${k}" ${item.ai?.effort === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>` : ''}
      ${isGuide
        ? segmented(`vis-${item.id}`, { public: 'Para todos los estudiantes', private: 'Solo para mí' }, item.visibility, 'Quién la ve')
        : segmented(`vis-${item.id}`, { public: 'Sí, aportar al grafo', private: 'No, solo para mí' }, item.visibility, '¿Aportar al grafo de conocimiento?')}
      ${isGuide ? (prefs.get().name
        ? `<label class="check wide"><input type="checkbox" data-sign="${item.id}" ${item.sign ? 'checked' : ''}> Firmar con mi nombre: <strong>${esc(prefs.get().name)}</strong></label>`
        : '<p class="hint wide">Para firmar tus guías con tu nombre, escríbelo en <a href="#/ajustes">Ajustes</a>.</p>') : ''}
    </form>
    <p class="summary">${summary}</p>
    ${parsed.warnings.length ? `<ul class="warnings">${parsed.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${findings.length ? `<div class="personal">
      <p><strong>${blocking.length ? 'Hay datos personales: quítalos antes de publicar.' : 'Revisa estos datos antes de publicar.'}</strong></p>
      <ul>${findings.map((f) => `<li><span>${esc(f.label)}</span> <mark>${esc(f.match)}</mark></li>`).join('')}</ul>
      <div class="actions"><button class="button ghost" data-redact="${item.id}">Quitar estos datos</button>
      ${!blocking.length ? `<label class="check"><input type="checkbox" data-confirm="${item.id}" ${item.confirmed ? 'checked' : ''}> Lo revisé: no son datos personales</label>` : ''}</div>
    </div>` : '<p class="clean">Sin datos personales a la vista.</p>'}
    ${conceptNames.length ? `<div class="chips small">${conceptNames.slice(0, 40).map((n) => `<span class="chip ${inMap.has(keyOf(n)) ? '' : 'new'}">${esc(n)}</span>`).join('')}${conceptNames.length > 40 ? `<span class="chip">y ${conceptNames.length - 40} más</span>` : ''}</div>` : ''}
    <div class="actions">
      ${isGuide ? `<button class="button ghost" data-preview="${item.id}">Vista previa</button>` : ''}
      <button class="button primary" data-publish="${item.id}" ${ready ? '' : 'disabled'}>${item.replace ? 'Reemplazar' : 'Publicar'}</button>
      ${!ready && !blocking.length && isGuide && !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? '<span class="hint">Falta la fecha de la evaluación.</span>' : ''}
    </div>`}`;
}
function readMeta(item) {
  const form = $(`[data-meta="${item.id}"]`);
  if (!form) return;
  const v = Object.fromEntries(new FormData(form).entries());
  const m = item.parsed.meta;
  for (const k of ['kind', 'course', 'code', 'university', 'professor', 'term', 'title', 'date', 'level']) if (k in v) m[k] = v[k].trim();
  if (v[`theme-${item.id}`]) m.theme = v[`theme-${item.id}`];
  if (v[`vis-${item.id}`]) item.visibility = v[`vis-${item.id}`];
  if ('aiprov' in v) item.ai = v.aiprov ? { provider: v.aiprov, model: String(v.aimodel ?? '').trim().slice(0, 80), effort: v.aieffort ?? '' } : null;
}
async function publish(item) {
  readMeta(item);
  const m = item.parsed.meta;
  const button = $(`[data-publish="${item.id}"]`);
  button.disabled = true;
  button.textContent = 'Publicando…';
  try {
    let id;
    if (item.html) {
      const concepts = item.parsed.concepts;
      id = await publishGuide(ctx.user.uid, {
        ...m, theme: m.theme, topics: m.topics?.length ? m.topics : concepts.slice(0, 12).map((c) => c.name),
        concepts: concepts.map((c) => c.name), anchors: concepts.map((c) => c.anchor), visibility: item.visibility,
        by: item.sign ? prefs.get().name : '', ai: item.ai?.provider ? item.ai : null,
      }, item.text, item.replace || undefined);
      item.done = `Publicada${item.visibility === 'private' ? ' solo para ti' : ''}. <a href="#/guia/${encodeURIComponent(id)}">Abrir la guía</a> · <a href="#/mapa/guide:${encodeURIComponent(id)}">Verla en el mapa</a>`;
    } else {
      id = await publishContribution(ctx.user.uid, { ...m, theme: m.kind === 'curriculum' ? 'estrellas' : m.theme, visibility: item.visibility }, item.parsed.data);
      item.done = `Publicado${item.visibility === 'private' ? ' solo para ti' : ''}. <a href="#/mapa">Verlo en el mapa</a>`;
    }
    renderReview(item);
    await ctx.refresh();
    ctx.toast(item.html ? 'Guía publicada.' : 'Aporte publicado.');
  } catch (error) {
    button.disabled = false;
    button.textContent = item.replace ? 'Reemplazar' : 'Publicar';
    ctx.toast(error.code === 'too-large' ? `Pesa ${kb(error.size)} comprimido; el límite es ${kb(LIMIT)}. Pide a tu IA una versión más corta.` : ctx.explain(error));
  }
}
function preview(item) {
  const dialog = $('#preview');
  $('#preview-frame').srcdoc = prepareGuide(item.text);
  dialog.showModal();
}

/* ---------- mine ---------- */
function minePane() {
  const { catalog, contributions } = ctx.state;
  const items = [...catalog, ...contributions].filter((x) => x.mine).sort((a, b) => b.updated - a.updated);
  if (!items.length) {
    return `<div class="empty glass"><h2>Todavía no aportaste nada</h2><p>Tus aportes y guías aparecen aquí: puedes cambiar quién los ve, reemplazarlos o borrarlos.</p>
      <a class="button primary" href="#/aportar">Aportar material</a></div>`;
  }
  return `<ul class="mine">${items.map((x) => `<li class="glass" style="${themeStyle(x.theme)}" data-item="${esc(x.type)}:${esc(x.id)}">
      <div class="what"><span class="badge">${x.type === 'guide' ? 'Guía' : esc(KINDS[x.kind] ?? 'Aporte')}</span>
        <strong>${esc(x.title)}</strong><span class="muted">${esc([x.course, x.professor, x.term].filter(Boolean).join(', '))}</span></div>
      ${segmented(`mv-${x.id}`, { public: 'Para todos', private: 'Solo yo' }, x.visibility, 'Quién lo ve')}
      <div class="actions">
        ${x.type === 'guide' ? `<a class="button ghost" href="#/guia/${encodeURIComponent(x.id)}">Abrir</a><label class="button ghost">Reemplazar<input type="file" accept=".html,.htm,text/html" hidden data-replace="${esc(x.id)}"></label>` : ''}
        <button class="button ghost danger" data-remove="${esc(x.type)}:${esc(x.id)}">Borrar</button>
      </div>
    </li>`).join('')}</ul><div class="reviews" data-reviews="mine"></div>`;
}
const findItem = (ref) => {
  const [type, id] = ref.split(':');
  return (type === 'guide' ? ctx.state.catalog : ctx.state.contributions).find((x) => x.id === id);
};

/* ---------- mount ---------- */
export function mountContribute(context) {
  ctx = context;
  const view = $('#view-contribute');
  if (view.dataset.ready) return;
  view.dataset.ready = '1';

  view.addEventListener('input', (e) => {
    if (e.target.closest('#m-form')) $('#m-prompt').textContent = materialPrompt();
    if (e.target.closest('#g-form')) {
      if (e.target.name === 'course') { store.set('studium-draft-guide', { ...(store.get('studium-draft-guide') ?? {}), course: e.target.value, professor: '', term: '' }); renderPane('guide'); return; }
      renderScope();
    }
    const meta = e.target.closest('[data-meta]');
    if (meta) {
      const item = reviews.get(meta.dataset.meta);
      readMeta(item);
      if (e.target.type === 'radio' || e.target.tagName === 'SELECT') renderReview(item);
      else $(`[data-publish="${item.id}"]`).disabled = !(item.parsed.meta.course && item.parsed.meta.title) || $(`[data-publish="${item.id}"]`).disabled;
    }
  });
  view.addEventListener('change', async (e) => {
    const files = e.target.dataset.files;
    if (files) { await readFiles(files, e.target.files); e.target.value = ''; }
    const aiFiles = e.target.dataset.aiFiles;
    if (aiFiles) { enqueue(aiFiles, [...e.target.files]); e.target.value = ''; }
    const sign = e.target.dataset.sign;
    if (sign) { const item = reviews.get(sign); item.sign = e.target.checked; }
    const replaceId = e.target.dataset.replace;
    if (replaceId) { const [file] = e.target.files; if (file) addReview(`replace:${replaceId}`, await file.text(), file.name); e.target.value = ''; }
    const confirm = e.target.dataset.confirm;
    if (confirm) { const item = reviews.get(confirm); item.confirmed = e.target.checked; renderReview(item); }
    const meta = e.target.closest('[data-meta]');
    if (meta && e.target.tagName === 'INPUT' && e.target.type !== 'radio') renderReview(reviews.get(meta.dataset.meta));
    const vis = e.target.name?.startsWith('mv-') && e.target.closest('[data-item]');
    if (vis) {
      const item = findItem(vis.dataset.item);
      try { await setVisibility(item, e.target.value); item.visibility = e.target.value; ctx.toast(e.target.value === 'private' ? 'Ahora solo tú lo ves.' : 'Ahora lo ven todos los estudiantes.'); await ctx.refresh(); }
      catch (error) { ctx.toast(ctx.explain(error)); renderPane('mine'); }
    }
  });
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-concept]');
    if (!t) return;
    if (t.id === 'm-copy') copy(materialPrompt(), 'Instrucciones');
    if (t.id === 'm-download') download(materialValues().kind === 'curriculum' ? 'studium-instrucciones-malla.md' : 'studium-instrucciones-aporte.md', materialPrompt());
    if (t.id === 'g-copy') copy(guidePrompt(), 'Instrucciones');
    if (t.id === 'g-ai') generateGuide();
    if (t.id === 'g-download') { const r = guideRequest(); download(r.file, guideContext()); }
    if (t.dataset.concept) { scope.off.has(t.dataset.concept) ? scope.off.delete(t.dataset.concept) : scope.off.add(t.dataset.concept); renderScope(); }
    if (t.dataset.scope) {
      const { concepts } = guideValues();
      scope.off = t.dataset.scope === 'none' ? new Set(concepts.map((n) => n.key)) : new Set();
      renderScope();
    }
    if (t.dataset.reviewPaste) {
      const area = $(`[data-paste="${t.dataset.reviewPaste}"]`);
      if (area.value.trim()) { addReview(t.dataset.reviewPaste, area.value, 'Respuesta pegada'); area.value = ''; }
    }
    if (t.dataset.discard) { reviews.delete(t.dataset.discard); document.getElementById(t.dataset.discard)?.remove(); }
    if (t.dataset.redact) {
      const item = reviews.get(t.dataset.redact);
      readMeta(item);
      const findings = findPersonal(item.html ? item.parsed.text : item.text, ctx.user.email);
      item.text = redact(item.text, findings);
      const meta = item.parsed.meta;
      item.parsed = item.html ? parseGuide(item.text, meta) : parseContribution(item.text, meta);
      if (!item.parsed.error) Object.assign(item.parsed.meta, meta);
      renderReview(item);
    }
    if (t.dataset.publish) publish(reviews.get(t.dataset.publish));
    if (t.dataset.preview) preview(reviews.get(t.dataset.preview));
    if (t.dataset.remove) {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = '¿Borrar? Pulsa otra vez'; setTimeout(() => { if (t.isConnected) { t.dataset.armed = ''; t.textContent = 'Borrar'; } }, 4000); return; }
      t.disabled = true;
      try { await remove(findItem(t.dataset.remove)); ctx.toast('Borrado.'); await ctx.refresh(); renderPane('mine'); }
      catch (error) { t.disabled = false; ctx.toast(ctx.explain(error)); }
    }
  });
  for (const type of ['dragenter', 'dragover']) view.addEventListener(type, (e) => { const z = e.target.closest('[data-drop], [data-ai-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  view.addEventListener('dragleave', (e) => e.target.closest('[data-drop], [data-ai-drop]')?.classList.remove('over'));
  view.addEventListener('drop', async (e) => {
    const zone = e.target.closest('[data-ai-drop]');
    if (zone) { e.preventDefault(); zone.classList.remove('over'); enqueue(zone.dataset.aiDrop, await droppedFiles(e.dataTransfer)); return; }
    const z = e.target.closest('[data-drop]');
    if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    readFiles(z.dataset.drop, e.dataTransfer.files);
  });
  $('#preview-close').addEventListener('click', () => $('#preview').close());
}

export function renderPane(pane, preset) {
  const panes = { material: materialPane, guide: () => guidePane(preset), mine: minePane };
  for (const name of Object.keys(panes)) {
    $(`#pane-${name}`).hidden = name !== pane;
    $(`[data-pane="${name}"]`).setAttribute('aria-selected', String(name === pane));
  }
  const el = $(`#pane-${pane}`);
  el.innerHTML = panes[pane]();
  for (const item of reviews.values()) {
    const zone = item.zone.startsWith('replace:') ? 'mine' : item.zone;
    const list = $(`[data-reviews="${zone}"]`, el);
    if (list) { list.insertAdjacentHTML('beforeend', `<article class="review glass" id="${item.id}"></article>`); renderReview(item); }
  }
  if (pane === 'material') $('#m-prompt').textContent = materialPrompt();
  if (pane === 'guide' && $('#g-form')) renderScope();
  rise(el, '.flow > li, .mine > li, .empty');
}
