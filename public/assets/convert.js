// «Convertir al formato actual»: a guide a person already has (any HTML, a PDF, Markdown or text), rebuilt in the
// current format by their own AI, keeping every piece of content. The original is never touched: a guide of Studium
// keeps its previous version in its history, and a file stays where it was.
//
// An HTML guide is read as it is drawn (its own code runs in the sandboxed frame first, so what it builds is read too),
// plus the texts its code keeps (cards, glossaries, questions). Short guides go in one request; long ones by parts:
// first the page around them (the shell), then each part. At the end Studium counts which words of the original are
// missing in the result and says so.
import * as ai from './ai.js';
import { showGuide } from './viewer.js';
import { codeStrings, coverage, pack, splitText } from './conversion.js';
import { CONVERT_ALL, CONVERT_PART, CONVERT_SHELL, convertAllText, convertPartText, convertShellText, parseGuide } from './prompts.js';

const ONE_SHOT = 36_000; // characters of original that one answer can rewrite whole
const PART_TOKENS = 16000;

const fences = (text) => String(text ?? '').replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();

/* ---------- in the browser: the guide as drawn, its parts, its pictures ---------- */

// The guide runs, hidden, in the same sandboxed frame as always, and its page comes back as it was drawn. If the
// frame does not answer, the guide is read as written.
export function drawn(html, wait = 2500) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1280px;height:800px;border:0;opacity:0;pointer-events:none';
    let over = false;
    const finish = (page) => { if (over) return; over = true; removeEventListener('message', heard); frame.remove(); resolve(page); };
    const heard = (event) => { if (event.source === frame.contentWindow && typeof event.data?.studiumSnapshot === 'string') finish(event.data.studiumSnapshot); };
    addEventListener('message', heard);
    document.body.append(frame);
    showGuide(frame, html);
    setTimeout(() => frame.contentWindow?.postMessage({ studiumSnapshot: true }, '*'), wait);
    setTimeout(() => finish(''), wait + 6000);
  });
}

const KEEP = new Set(['id', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'open', 'start', 'type', 'value', 'lang']);
// What of a page goes to the AI: its content, without its code, its styles or long attributes. Pictures travel as
// «studium-img:N» and get their image back at the end, so nothing heavy goes and nothing is lost.
function clean(doc, images) {
  for (const el of doc.querySelectorAll('script, style, link, meta, noscript, template, iframe, object, embed')) el.remove();
  for (const nav of doc.querySelectorAll('nav')) if (nav.querySelectorAll('a').length >= 3 && nav.textContent.length < 2000) nav.remove();
  for (const el of doc.querySelectorAll('*')) {
    const inSvg = el.closest('svg');
    for (const { name } of [...el.attributes]) {
      if (/^on/i.test(name) || name === 'style' || (!inSvg && !KEEP.has(name))) el.removeAttribute(name);
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (src) { images.push(src); el.setAttribute('src', `studium-img:${images.length - 1}`); }
    }
    if (el.tagName.toLowerCase() === 'image') {
      for (const attr of ['href', 'xlink:href']) {
        const src = el.getAttribute(attr) ?? '';
        if (src.length > 200) { images.push(src); el.setAttribute(attr, `studium-img:${images.length - 1}`); }
      }
    }
  }
}
const controlsOf = (el) => [...new Set([...el.querySelectorAll('button, input[type="range"], select, [role="button"]')]
  .map((c) => (c.textContent || c.getAttribute('aria-label') || c.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean))];
// A heading's words, with a space between its parts (a number badge and the title are separate elements).
const titleOf = (el) => {
  const h = el.matches?.('h1, h2, h3') ? el : el.querySelector?.('h1, h2, h3');
  return h ? [...h.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 90) : '';
};

// The parts of a drawn page: its top-level sections, or its content cut at its h2 (h1 when it has none).
export function htmlParts(page) {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  const controls = new Map();
  const sections = [...doc.body.querySelectorAll('section')].filter((s) => !s.parentElement.closest('section'));
  for (const s of sections) controls.set(s, controlsOf(s));
  const images = [];
  const all = controlsOf(doc.body);
  clean(doc, images);
  const kept = sections.filter((s) => s.isConnected);
  let parts;
  if (kept.length >= 2) {
    const intro = doc.body.cloneNode(true);
    for (const s of intro.querySelectorAll('section')) if (!s.parentElement.closest('section')) s.remove();
    parts = [
      ...(intro.textContent.trim().length > 40 ? [{ title: titleOf(intro) || 'Introducción', html: intro.innerHTML.trim() }] : []),
      ...kept.map((s) => ({ title: titleOf(s), html: s.outerHTML, controls: controls.get(s) ?? [] })),
    ];
  } else {
    let root = doc.body;
    while (root.children.length === 1 && !/^H[1-6]$/.test(root.children[0].tagName)) root = root.children[0];
    const level = root.querySelector(':scope > h2') ? 'H2' : 'H1';
    parts = [];
    let cur = null;
    for (const el of root.children) {
      if (el.tagName === level || !cur) { cur = { title: el.tagName === level ? titleOf(el) : '', html: '' }; parts.push(cur); }
      cur.html += `${el.outerHTML}\n`;
    }
    if (parts.length) parts[0].controls = all;
  }
  if (!parts.some((p) => p.html.trim()) && doc.body.textContent.trim()) parts = [{ title: '', html: doc.body.innerHTML, controls: all }];
  return { parts: parts.filter((p) => p.html.trim()), images, text: doc.body.textContent.replace(/\s+/g, ' ') };
}
const textOfPage = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, style')) el.remove();
  const titles = [...doc.querySelectorAll('[title], [data-answer], input[placeholder]')].map((el) => `${el.getAttribute('title') ?? ''} ${el.dataset?.answer ?? ''}`).join(' ');
  return `${doc.body?.textContent ?? ''} ${titles}`;
};
const scriptsOf = (html) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script:not([type="application/json"])')].map((s) => s.textContent).join('\n');
const restore = (html, images) => html.replace(/studium-img:(\d+)/g, (m, i) => images[Number(i)] ?? m);

// Each part takes the place of its empty section in the shell; a section the shell forgot goes at the end. The
// shell's own scripts must run after every part is in place: they go back to the end of the page.
export function assemble(shell, parts, done) {
  const doc = new DOMParser().parseFromString(shell, 'text/html');
  for (const part of parts) {
    const frag = new DOMParser().parseFromString(`<!doctype html><body>${done[part.id] ?? ''}</body>`, 'text/html');
    const nodes = [...frag.body.children].map((n) => doc.importNode(n, true));
    if (!nodes.length) continue;
    if (!nodes.some((n) => n.id === part.id)) nodes[0].id = part.id;
    const slot = doc.getElementById(part.id);
    if (slot) slot.replaceWith(...nodes);
    else (doc.querySelector('main') ?? doc.body).append(...nodes);
  }
  doc.body.append(...doc.body.querySelectorAll(':scope > script'));
  return `<!doctype html>
${doc.documentElement.outerHTML}`;
}

/* ---------- the plan and the run ---------- */

// source: { name, html } for a page, { name, text } for Markdown or text, { name, file } for a PDF (ai.readFile's).
// Returns what will go: one request or a shell plus parts, and the original's text to compare with at the end.
export async function plan(source) {
  if (source.file) return { mode: 'one', file: source.file, parts: [], images: [], original: '', extraParts: 0 };
  let parts;
  let images = [];
  let original;
  let extraParts = 0;
  if (source.html) {
    const page = (await drawn(source.html)) || source.html;
    const read = htmlParts(page);
    ({ images } = read);
    parts = read.parts;
    const strings = codeStrings(scriptsOf(source.html), read.text);
    original = `${read.text} ${strings.join(' ')}`;
    if (strings.length) {
      extraParts = 1;
      parts.push({ title: 'Lo que el original guardaba en su código', html: `<p>Textos que la guía original mostraba con sus botones, tarjetas o animaciones. Cada uno pertenece a la parte de la guía donde corresponde; ponlos en una sección de repaso (tarjetas, glosario o preguntas) si no encajan en otra.</p>\n<pre>${strings.map((s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])).join('\n')}</pre>` });
    }
  } else {
    parts = splitText(source.text);
    original = source.text;
  }
  const size = parts.reduce((n, p) => n + p.html.length, 0);
  if (!original.trim() && !size) throw new Error('Esta guía no tiene texto que convertir.');
  if (size <= ONE_SHOT) return { mode: 'one', parts, images, original, extraParts, size };
  return { mode: 'parts', parts: pack(parts), images, original, extraParts, size };
}

// What the person reads before anything runs: the exact instructions, with the guide in place of «[…]».
export function promptsHTML(p, meta, extra = '') {
  if (p.mode === 'one') return ai.promptHTML(CONVERT_ALL, convertAllText({ ...meta, file: !!p.file }, extra), 'más la guía original');
  return `${ai.promptHTML(CONVERT_SHELL, convertShellText(meta, p.parts, '[el comienzo de la guía original]', extra), '', 'Ver las instrucciones exactas: la página')}
    ${ai.promptHTML(CONVERT_PART, convertPartText({ title: meta.title, part: { id: 'p…', title: '[título de la parte]' }, styles: '[los estilos del armazón]', original: '[la parte original]', extra }), `y así con cada una de las ${p.parts.length} partes`, 'Ver las instrucciones exactas: cada parte')}`;
}

// Runs the plan. state keeps what is done (the shell and each part), so a failed part is retried without redoing the
// rest. onProgress(text) says where it goes. Returns { html, made, coverage }.
export async function run(p, { meta = {}, extra = '', use, onProgress = () => {}, state = {}, signal } = {}) {
  let made = null;
  let html;
  if (p.mode === 'one') {
    onProgress('Tu IA está convirtiendo la guía…');
    const res = await ai.run({
      system: CONVERT_ALL,
      text: `${convertAllText({ ...meta, file: !!p.file }, extra)}${p.file ? '' : `\n\n${p.parts.map((x) => x.html).join('\n\n')}`}`,
      files: p.file ? [p.file] : [], maxTokens: ai.longest(use), use, signal, label: 'Convertir una guía',
      onProgress: (n) => onProgress(n < 0 ? 'Tu IA está escribiendo…' : `Tu IA está escribiendo… ${n.toLocaleString('es')} caracteres`),
    });
    html = ai.htmlFrom(res.text);
    if (!html) throw new Error('Tu IA no devolvió una página completa. Vuelve a intentarlo.');
    made = res;
  } else {
    const total = p.parts.length + 1;
    if (!state.shell) {
      onProgress(`Paso 1 de ${total}: la página y su estilo…`);
      const sample = p.parts.slice(0, 2).map((x) => x.html).join('\n').slice(0, 6000);
      const res = await ai.run({ system: CONVERT_SHELL, text: convertShellText(meta, p.parts, sample, extra), maxTokens: PART_TOKENS, use, signal, label: 'Convertir una guía: la página' });
      const shell = ai.htmlFrom(res.text);
      if (!shell) throw new Error('Tu IA no devolvió la página de la guía. Vuelve a intentarlo: lo hecho se conserva.');
      state.shell = shell;
      state.made = res;
    }
    const doc = new DOMParser().parseFromString(state.shell, 'text/html');
    const styles = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n').slice(0, 7000);
    state.done ??= {};
    for (const [i, part] of p.parts.entries()) {
      if (state.done[part.id]) continue;
      onProgress(`Paso ${i + 2} de ${total}: «${part.title}»…`);
      const res = await ai.run({
        system: CONVERT_PART,
        text: convertPartText({ title: [meta.course, meta.title].filter(Boolean).join(' · '), part, styles, original: part.html, controls: part.controls ?? [], extra }),
        maxTokens: PART_TOKENS, use, signal, label: `Convertir una guía: ${part.title}`,
      });
      const body = fences(res.text);
      if (!/<section\b/i.test(body)) throw new Error(`Tu IA no devolvió la parte «${part.title}». Vuelve a intentarlo: lo hecho se conserva.`);
      state.done[part.id] = body;
      state.made = res;
    }
    html = assemble(state.shell, p.parts, state.done);
    made = state.made;
  }
  html = restore(html, p.images);
  const parsed = parseGuide(html, meta);
  if (parsed.error) throw new Error(parsed.error);
  const cov = p.file ? null : coverage(p.original, textOfPage(html));
  return { html, made, coverage: cov, parsed };
}

// What the person reads about the result: how much of the original's words are there, and a few that are missing.
export function coverageHTML(cov) {
  if (!cov) return '<p class="fine">Tu IA leyó el PDF directamente: compara tú mismo que esté todo.</p>';
  if (!cov.total) return '';
  const pct = Math.floor(cov.share * 100);
  const sample = cov.missing.slice(0, 12).join(', ');
  return pct >= 97
    ? `<p class="fine">Está ${pct} % de las palabras del original (${cov.kept.toLocaleString('es')} de ${cov.total.toLocaleString('es')}).</p>`
    : `<p class="note">Está ${pct} % de las palabras del original (${cov.kept.toLocaleString('es')} de ${cov.total.toLocaleString('es')}). Pueden ser palabras dichas de otra forma, o algo que quedó fuera: revisa antes de guardar. Por ejemplo, faltan: ${sample.replace(/[&<>]/g, '')}.</p>`;
}
