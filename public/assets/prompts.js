// What Studium asks of a person's own AI (any of them: ChatGPT, Gemini, Claude, Copilot, NotebookLM…), and how it
// reads back what the AI returns: a contribution (JSON) or a guide (one HTML file with its data in a JSON block).
import { THEMES, keyOf, validTheme } from './themes.js';

export const KINDS = {
  exam: 'Examen', homework: 'Deber', slides: 'Diapositivas', book: 'Libro o texto', notes: 'Apuntes',
  contest: 'Problemas de competencia', curriculum: 'Malla curricular', other: 'Otro',
};
const KIND_PLURALS = {
  exam: 'exámenes', homework: 'deberes', slides: 'diapositivas', book: 'libros o textos', notes: 'apuntes',
  contest: 'problemas de competencia', curriculum: 'mallas curriculares', other: 'otros',
};
// "1 examen", "3 exámenes".
export const countKind = (kind, n) => `${n} ${n === 1 ? (KINDS[kind] ?? 'otro').toLowerCase() : KIND_PLURALS[kind] ?? 'otros'}`;
export const QUESTION_KINDS = {
  'multiple-choice': 'Opción múltiple', 'true-false': 'Verdadero o falso', 'short-answer': 'Respuesta corta',
  computation: 'Cálculo', proof: 'Demostración', problem: 'Problema', code: 'Código', algorithmic: 'Problema de programación',
  diagram: 'Diagrama', essay: 'Desarrollo', oral: 'Oral',
};
export const RELATIONS = {
  prerequisite: 'se necesita antes de', part: 'es parte de', uses: 'se usa en', example: 'es un ejemplo de',
  contrast: 'se confunde con', related: 'se relaciona con',
};
export const LEVELS = { basic: 'Desde cero', standard: 'Intermedio', advanced: 'Avanzado y técnico' };

const SPANISH_KINDS = { examen: 'exam', deber: 'homework', tarea: 'homework', diapositivas: 'slides', libro: 'book', texto: 'book',
  apuntes: 'notes', competencia: 'contest', problemas: 'contest', malla: 'curriculum', otro: 'other' };
const SPANISH_LEVELS = { 'desde cero': 'basic', basico: 'basic', intermedio: 'standard', avanzado: 'advanced' };

const clip = (value, max) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '');
const list = (value) => (Array.isArray(value) ? value : []);
const field = (label, value) => `- ${label}: ${value || '(dedúcelo del material; si no se puede saber, deja "")'}`;

/* ---------- contributions ---------- */

export function contributionInstructions(m = {}) {
  const contest = m.kind === 'contest';
  const known = (m.known ?? []).slice(0, 400);
  return `# Instrucciones de Studium: convertir material de estudio en un aporte

Studium es un mapa de conocimiento que comparten estudiantes. Un aporte describe, de forma compacta y anónima, lo que
enseña o evalúa un material: sus conceptos, cómo se relacionan, las preguntas o problemas que trae y la forma de enseñar
o evaluar de quien lo preparó. Con los aportes de muchas personas, Studium muestra qué toma cada profesor en cada
semestre (o cada competencia en cada edición) y sirve para crear guías de estudio.

Te adjunto el material. Léelo completo (todas las páginas, diapositivas o problemas) antes de responder.

## Lo que sé del material
${field('Tipo', KINDS[m.kind])}
${field('Materia o competencia', m.course)}
${field('Código de la materia', m.code)}
${field('Universidad u organizador', m.university)}
${field('Profesor', contest ? 'no aplica: deja ""' : m.professor)}
${field(contest ? 'Edición' : 'Semestre', m.term)}

## Anónimo, siempre
Otros estudiantes verán este aporte.
- Quita todo dato de estudiantes: nombres, firmas, códigos o números de estudiante, cédulas, correos, teléfonos,
  calificaciones obtenidas y comentarios del profesor dirigidos a una persona.
- Conserva el nombre del profesor, la materia, la universidad y el semestre o edición: sirven para saber qué se evalúa.
- Si el material trae respuestas de un estudiante, no las copies: escribe tú la solución correcta. Si una respuesta del
  estudiante muestra un error típico, descríbelo sin decir de quién es.
- No copies párrafos de libros, diapositivas o enunciados largos: resume con tus palabras y conserva los datos que hacen
  falta para resolver (números, matrices, restricciones, código corto).

## Qué extraer
- **concepts**: cada concepto que el material enseña, usa o evalúa (definiciones, teoremas, métodos, técnicas,
  herramientas). Para cada uno: un nombre corto y estándar en español (el término en inglés entre paréntesis si es el
  usual), un resumen de una o dos frases con tu redacción, y sus relaciones con otros conceptos.
- **questions**: ${contest
    ? 'cada problema de la competencia. kind "algorithmic"; text: el enunciado resumido con entrada, salida y restricciones; solution: la idea, el algoritmo y su complejidad (y código breve si se conoce); concepts: las técnicas y temas que pide (programación dinámica, BFS, árboles de segmentos, teoría de números…).'
    : 'cada pregunta, ejercicio o problema, con los conceptos que evalúa, su tipo, su dificultad, su puntaje si aparece, el enunciado en paráfrasis compacta y la solución correcta breve si la conoces con certeza (si no, deja "").'}
- **examples**: ejemplos resueltos o casos que el material usa para explicar, en pocas líneas.
- **style**: de 2 a 5 frases sobre cómo ${contest ? 'son los problemas de esta competencia (formato, dificultad, temas frecuentes, trampas)' : 'enseña o evalúa este profesor según este material: formato, qué pesa más, nivel de rigor, trampas habituales, notación'}.
- **source**: solo para libros o textos publicados: título, autor y capítulo.

## Formato de la respuesta
Devuelve un archivo \`studium-aporte.json\` para descargar. Si no puedes crear archivos (por ejemplo en NotebookLM),
responde solo con un bloque de código JSON, sin texto antes ni después.

\`\`\`json
{
  "studium": "aporte",
  "version": 1,
  "kind": "exam",
  "course": "Álgebra Lineal",
  "code": "MAT-0000",
  "university": "Universidad",
  "professor": "Nombre Apellido",
  "term": "202610",
  "title": "Examen parcial 1",
  "theme": "vectores",
  "style": "Evalúa sobre todo cálculos a mano con matrices de 3x3 y una demostración corta por examen.",
  "source": { "title": "", "author": "", "chapter": "" },
  "concepts": [
    { "name": "Espacio vectorial", "summary": "Conjunto con suma y producto por escalar que cumplen ocho axiomas.",
      "related": [ { "to": "Subespacio", "kind": "prerequisite" } ] }
  ],
  "questions": [
    { "concepts": ["Subespacio"], "kind": "proof", "difficulty": 3, "points": 10,
      "text": "Probar que el conjunto de matrices simétricas de 2x2 es un subespacio de M2x2.",
      "solution": "Contiene la matriz cero y es cerrado bajo suma y producto por escalar porque (A+B)^T = A^T + B^T." }
  ],
  "examples": [ { "concepts": ["Base"], "text": "{(1,0),(0,1)} es base de R^2: genera y es linealmente independiente." } ]
}
\`\`\`

Reglas:
- JSON válido: comillas dobles, sin comentarios, sin comas al final.
- kind del aporte: ${Object.keys(KINDS).map((k) => `"${k}"`).join(', ')}.
- kind de una pregunta: ${Object.keys(QUESTION_KINDS).map((k) => `"${k}"`).join(', ')}.
- kind de una relación: ${Object.entries(RELATIONS).map(([k, v]) => `"${k}" (${v})`).join(', ')}.
- difficulty: 1 (muy fácil) a 5 (muy difícil), según el nivel del curso o de la competencia.
- theme, el estilo visual de la materia: ${Object.entries(THEMES).map(([k, t]) => `"${k}" (${t.hint})`).join('; ')}.
- Cada nombre en "concepts" de una pregunta, un ejemplo o una relación debe aparecer también como concepto en la lista.
- Matemáticas en texto plano o en LaTeX entre $…$.
- Como máximo 300 conceptos, 200 preguntas y 150 ejemplos. Si el material no cabe en una respuesta, entrega varias
  partes completas y válidas (studium-aporte-1.json, studium-aporte-2.json…).
${known.length ? `
## Conceptos que Studium ya tiene de esta materia
Cuando hables de uno de ellos, usa exactamente el mismo nombre, para que el mapa los una:
${known.join('; ')}
` : ''}`;
}

export function curriculumInstructions(m = {}) {
  return `# Instrucciones de Studium: convertir una malla curricular en un aporte

Studium es un mapa de conocimiento que comparten estudiantes. La malla de una carrera le dice qué materias vienen en
cada semestre y cuáles se necesitan antes de otras, para que cada estudiante sepa qué le espera y llegue preparado.

Te adjunto la malla. Léela completa antes de responder.

## Lo que sé de la malla
${field('Carrera', m.course)}
${field('Universidad', m.university)}
${field('Versión o año de la malla', m.title)}

## Qué extraer
- Cada semestre, con su número, y cada materia con su nombre exacto, su código y sus créditos si aparecen.
- Los prerrequisitos de cada materia, con los nombres exactos de las materias que pide (o sus códigos).
- Las materias optativas o electivas también, marcadas con "elective": true.

## Formato de la respuesta
Devuelve un archivo \`studium-malla.json\` para descargar. Si no puedes crear archivos, responde solo con un bloque de
código JSON, sin texto antes ni después.

\`\`\`json
{
  "studium": "aporte",
  "version": 1,
  "kind": "curriculum",
  "course": "Ingeniería en Ciencias de la Computación",
  "university": "Universidad",
  "title": "Malla 2024",
  "semesters": [
    { "number": 1, "courses": [ { "name": "Cálculo I", "code": "MAT-0001", "credits": 4, "prerequisites": [] } ] },
    { "number": 2, "courses": [ { "name": "Cálculo II", "code": "MAT-0002", "credits": 4, "prerequisites": ["Cálculo I"] } ] }
  ]
}
\`\`\`

Reglas: JSON válido (comillas dobles, sin comentarios, sin comas al final); los nombres de las materias, iguales a los
de la malla.
`;
}

function parseCurriculum(obj, pick) {
  const semesters = list(obj.semesters).map((sem, i) => ({
    number: Math.max(1, Math.round(Number(sem?.number)) || i + 1),
    courses: list(sem?.courses).map((c) => ({
      name: clip(typeof c === 'string' ? c : c?.name, 80), code: clip(c?.code, 30),
      ...(Number.isFinite(Number(c?.credits)) && c?.credits !== '' && c?.credits != null ? { credits: Number(c.credits) } : {}),
      prerequisites: names(c?.prerequisites), ...(c?.elective ? { elective: true } : {}),
    })).filter((c) => keyOf(c.name)).slice(0, 40),
  })).filter((sem) => sem.courses.length).slice(0, 20);
  if (!semesters.length) return { error: 'La malla no trae semestres con materias. Pide a tu IA que siga el formato de las instrucciones.' };
  return {
    meta: { kind: 'curriculum', course: pick('course', 80), code: '', university: pick('university', 60), professor: '', term: '',
      title: pick('title', 120) || 'Malla curricular', theme: validTheme(obj.theme) ?? '' },
    data: { version: 1, curriculum: { semesters }, concepts: [], questions: [], examples: [], style: '' },
    warnings: [],
  };
}

function cleanConcepts(raw, warnings) {
  const byKey = new Map();
  for (const item of list(raw)) {
    const c = typeof item === 'string' ? { name: item } : item ?? {};
    const name = clip(c.name, 80);
    const key = keyOf(name);
    if (!key) continue;
    const prior = byKey.get(key) ?? { name, summary: '', related: [] };
    prior.summary ||= clip(c.summary, 600);
    for (const r of list(c.related)) {
      const to = clip(typeof r === 'string' ? r : r?.to, 80);
      if (keyOf(to) && keyOf(to) !== key) prior.related.push({ to, kind: r?.kind in RELATIONS ? r.kind : 'related' });
    }
    prior.related = prior.related.slice(0, 20);
    byKey.set(key, prior);
  }
  const concepts = [...byKey.values()];
  if (concepts.length > 300) warnings.push(`Trae ${concepts.length} conceptos; se guardan los primeros 300.`);
  return concepts.slice(0, 300);
}
const names = (value) => list(value).map((x) => clip(x, 80)).filter((x) => keyOf(x)).slice(0, 12);

// Reads what an AI returned for a contribution: tolerant of code fences and text around the JSON.
export function parseContribution(text, fallback = {}) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const body = fenced ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let obj;
  try { obj = JSON.parse(body); } catch {
    return { error: 'No es un JSON válido. Pide a tu IA: «Devuélvelo como JSON válido, en un solo bloque de código».' };
  }
  if (obj?.studium === 'guia') return { error: 'Este archivo es una guía: súbela como guía (.html).' };
  const warnings = [];
  let kind = String(obj.kind ?? fallback.kind ?? '').toLowerCase();
  kind = kind in KINDS ? kind : SPANISH_KINDS[keyOf(kind).split('-')[0]] ?? (fallback.kind || 'other');
  const pick = (k, max) => clip(obj[k], max) || clip(fallback[k], max);
  if (kind === 'curriculum' || Array.isArray(obj.semesters)) return parseCurriculum(obj, pick);
  const concepts = cleanConcepts(obj.concepts, warnings);
  if (!concepts.length) return { error: 'No trae conceptos. Pide a tu IA que siga el formato de las instrucciones de Studium.' };
  const questions = list(obj.questions).map((q) => ({
    concepts: names(q?.concepts), kind: q?.kind in QUESTION_KINDS ? q.kind : 'problem',
    difficulty: Math.min(5, Math.max(1, Math.round(Number(q?.difficulty)) || 3)),
    ...(Number.isFinite(Number(q?.points)) && q?.points !== '' && q?.points != null ? { points: Number(q.points) } : {}),
    text: clip(q?.text, 2500), solution: clip(q?.solution, 3000),
  })).filter((q) => q.text);
  const examples = list(obj.examples).map((e) => ({ concepts: names(e?.concepts), text: clip(e?.text, 2000) })).filter((e) => e.text);
  if (questions.length > 200) warnings.push(`Trae ${questions.length} preguntas; se guardan las primeras 200.`);
  if (examples.length > 150) warnings.push(`Trae ${examples.length} ejemplos; se guardan los primeros 150.`);
  const source = obj.source && typeof obj.source === 'object'
    ? { title: clip(obj.source.title, 160), author: clip(obj.source.author, 160), chapter: clip(obj.source.chapter, 160) } : null;
  return {
    meta: {
      kind, course: pick('course', 80), code: pick('code', 30), university: pick('university', 60),
      professor: pick('professor', 80), term: pick('term', 60), title: pick('title', 120) || KINDS[kind],
      theme: validTheme(obj.theme) ?? validTheme(fallback.theme) ?? '',
    },
    data: {
      version: 1, concepts, questions: questions.slice(0, 200), examples: examples.slice(0, 150), style: clip(obj.style, 1500),
      ...(source?.title ? { source } : {}),
    },
    warnings,
  };
}

/* ---------- guides ---------- */

const PRACTICE = { few: 'unas 6 preguntas en total', normal: 'unas 15 preguntas en total', lots: '30 preguntas o más' };
const EXAMPLES = { few: 'un ejemplo resuelto por idea central', normal: 'dos o tres ejemplos resueltos por idea', lots: 'muchos ejemplos resueltos, de fáciles a difíciles' };
const LENGTH = { short: 'un repaso de una hora como máximo', medium: 'unas tres horas de estudio', complete: 'cubrir todo a fondo, sin límite de tiempo' };
const CHALLENGE = { easier: 'más fáciles que la evaluación, para empezar', same: 'del mismo nivel que la evaluación', harder: 'un poco más difíciles que la evaluación' };
const AUDIENCE = {
  basic: 'Desde cero: no supongas nada. Antes de usar una palabra técnica, muestra qué es con algo concreto (una figura, una tabla, un caso) y luego da la definición formal. Una idea por frase.',
  standard: 'Intermedio: el estudiante vio la materia, pero necesita ordenarla y practicar. Define cada término la primera vez que aparece, con la definición formal primero, y ve directo a lo que se evalúa.',
  advanced: 'Avanzado y técnico: el estudiante domina lo básico. Usa lenguaje técnico preciso, demostraciones, casos límite, complejidad y trampas; no expliques lo elemental.',
};

export function guideInstructions(o) {
  const contest = o.contest;
  const theme = THEMES[o.theme] ?? THEMES.estrellas;
  const who = [o.professor && `profesor ${o.professor}`, o.term && (contest ? `edición ${o.term}` : `semestre ${o.term}`)].filter(Boolean).join(', ');
  const meta = {
    studium: 'guia', version: 1, course: o.course, code: o.code ?? '', university: o.university ?? '', professor: o.professor ?? '',
    term: o.term ?? '', title: o.title || 'Guía de estudio', date: o.date || '', theme: o.theme, level: o.level,
    topics: ['…'], concepts: [{ name: '…', anchor: '…' }],
  };
  return `# Instrucciones de Studium: crear una guía de estudio

Escribe una guía de estudio interactiva para «${meta.title}» de ${o.course}${who ? ` (${who})` : ''}${o.date ? `, que es el ${o.date}` : ''}.
Te adjunto \`${o.contextFile}\`: lo que Studium sabe de esta ${contest ? 'competencia' : 'materia'}, sacado de material que
aportaron estudiantes de forma anónima: conceptos, relaciones, preguntas reales en paráfrasis y ${contest ? 'cómo son los problemas' : 'cómo evalúa el profesor'}.
Si adjunto más material mío, úsalo también.${o.focus ? `\n\nEnfócate en: ${o.focus}.` : ''}

## Para quién es
- Nivel: ${AUDIENCE[o.level] ?? AUDIENCE.standard}
- Extensión: ${LENGTH[o.length] ?? LENGTH.medium}.
- Práctica: ${PRACTICE[o.practice] ?? PRACTICE.normal}, ${CHALLENGE[o.challenge] ?? CHALLENGE.same}.
- Ejemplos: ${EXAMPLES[o.examples] ?? EXAMPLES.normal}.

## Cómo debe ser
1. Explica cada término en el momento en que aparece: primero la definición formal y técnica, después, si ayuda, una
   analogía. Da el término original en inglés cuando sea el usual.
2. Concisa: sin índice, sin «cómo usar esta guía», sin introducciones que anuncian lo que viene. Si al borrar una frase
   no cambia nada, bórrala.
3. Autocontenida: nunca escribas «en la diapositiva», «el PDF» o «la pregunta 8»; describe la figura o el problema.
4. Calibrada: dedica más espacio a lo que ${contest ? 'más aparece en los problemas' : 'el profesor evalúa más'} (el contexto dice cuántas preguntas tiene cada
   concepto) y practica con preguntas del mismo tipo y estilo. No copies preguntas del contexto: escribe otras parecidas.
5. La práctica va dentro del texto, justo después de cada idea: preguntas cortas y directas, como las de un
   ${contest ? 'juez de competencia' : 'profesor'}, cada una con un botón «Comprobar» (que corrige la respuesta cuando se puede: opción múltiple,
   número, verdadero o falso) y un botón «Ver respuesta» con la solución explicada.
6. Aprovecha el medio: diagramas SVG, animaciones paso a paso con controles de velocidad, pausa y paso atrás,
   simulaciones cuando ayuden, y descripciones al pasar el cursor sobre términos y partes de figuras. Pon una
   definición breve antes de cada figura; la figura y su explicación caben en la misma pantalla.
7. Sin datos personales: ningún nombre de estudiante ni dato que identifique a alguien.${contest ? `
8. Programación competitiva: para cada técnica, un problema modelo con enunciado, entrada, salida y restricciones;
   la idea, la complejidad, el código completo en ${o.language || 'C++'} con resaltado, casos de prueba y errores típicos
   (desbordamiento, límites, casos borde).` : ''}

## Requisitos técnicos de Studium
- Un solo archivo HTML completo que empieza con <!doctype html>, en español (lang="es"), con todo dentro: CSS,
  JavaScript e imágenes (SVG o data: URLs).
- Bibliotecas externas solo de cdnjs.cloudflare.com, cdn.jsdelivr.net o unpkg.com (por ejemplo KaTeX para
  matemáticas o highlight.js para código) y fuentes solo de Google Fonts. Nada más se carga.
- localStorage solo dura mientras la guía está abierta. No uses formularios que envíen datos.
- Funciona en celular y computadora, sin desplazamiento horizontal, en modo claro y oscuro.
- Usa como colores característicos los del tema «${theme.name}»: ${theme.a} y ${theme.b}, más los neutros que necesites.
- Menos de 2 MB.
- Cada concepto que la guía explica tiene su sección con un atributo id (usa el id que da el contexto).
- Al inicio de <head>, este bloque con los datos de la guía, completado ("concepts" lista cada concepto que la guía
  explica con el id de su sección; "topics", los temas en pocas palabras):

<script type="application/json" id="studium">
${JSON.stringify(meta, null, 2)}
</script>

## Entrega
Devuélveme el archivo \`guia.html\` para descargar. Si no puedes crear archivos, escribe el HTML completo en un solo
bloque de código; si no cabe en una respuesta, divídelo en partes y espera a que te pida la siguiente.
`;
}

// Reads a guide's HTML: its data block, its sections, and what would not load in the viewer.
export function parseGuide(html, fallback = {}) {
  const text = String(html ?? '').replace(/^﻿/, '');
  if (!/^\s*<!doctype html/i.test(text)) return { error: 'No es una página HTML completa: debe empezar con <!doctype html>.' };
  const page = new DOMParser().parseFromString(text, 'text/html');
  const warnings = [];
  let meta = {};
  const block = page.querySelector('script#studium[type="application/json"]');
  if (block) {
    try { meta = JSON.parse(block.textContent); } catch { warnings.push('El bloque de datos de la guía no es JSON válido; completa los datos aquí.'); }
  } else warnings.push('La guía no trae su bloque de datos de Studium; completa los datos aquí.');
  const ids = new Set([...page.querySelectorAll('[id]')].map((el) => el.id));
  let concepts = list(meta.concepts).map((c) => ({ name: clip(typeof c === 'string' ? c : c?.name, 80), anchor: clip(c?.anchor, 80) }))
    .filter((c) => keyOf(c.name));
  if (!concepts.length) {
    concepts = [...page.querySelectorAll('h2[id], h3[id], section[id] > h2, section[id] > h3')]
      .map((h) => ({ name: clip(h.textContent, 80), anchor: h.id || h.parentElement.id })).filter((c) => keyOf(c.name));
  }
  const missing = concepts.filter((c) => c.anchor && !ids.has(c.anchor)).length;
  if (missing) warnings.push(missing === 1 ? 'Un concepto apunta a una sección que no existe; se abrirá al inicio de la guía.' : `${missing} conceptos apuntan a secciones que no existen; se abrirán al inicio de la guía.`);
  concepts = concepts.map((c) => ({ ...c, anchor: ids.has(c.anchor) ? c.anchor : '' })).slice(0, 200);
  const allowed = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
  const external = [...page.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
    .map((el) => el.getAttribute('src') ?? el.getAttribute('href')).filter((u) => /^(https?:)?\/\//.test(u) && !allowed.test(u));
  if (external.length) warnings.push(`No se cargará: ${external.slice(0, 3).join(', ')}. Studium solo carga bibliotecas de cdnjs, jsDelivr y unpkg.`);
  if (page.querySelector('form[action]')) warnings.push('La guía tiene formularios que envían datos; en Studium no envían nada.');
  const pick = (k, max) => clip(meta[k], max) || clip(fallback[k], max);
  let level = String(meta.level ?? fallback.level ?? '');
  level = level in LEVELS ? level : SPANISH_LEVELS[keyOf(level).replaceAll('-', ' ')] ?? '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '') ? meta.date : (fallback.date ?? '');
  return {
    meta: {
      course: pick('course', 80), code: pick('code', 30), university: pick('university', 60), professor: pick('professor', 80),
      term: pick('term', 60), title: pick('title', 120) || clip(page.title, 120), date, level,
      theme: validTheme(meta.theme) ?? validTheme(fallback.theme) ?? '',
      topics: list(meta.topics).map((t) => clip(t, 60)).filter((t) => t && t !== '…').slice(0, 40),
    },
    concepts, warnings, text: page.body?.textContent ?? '',
  };
}

/* ---------- context for a new guide ---------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The part of the map a guide is built from, as a Markdown file the person attaches in their AI.
export function contextPack({ course, professor, term, concepts, contributions, guides, contest }) {
  const mineFirst = (c) => (professor && c.professor === professor ? 0 : 1) + (term && c.term === term ? 0 : 0.5);
  const sources = [...contributions].sort((x, y) => mineFirst(x) - mineFirst(y));
  const kinds = {};
  for (const c of contributions) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  const people = new Map();
  for (const c of contributions) if (c.professor) people.set(c.professor, new Set([...(people.get(c.professor) ?? []), c.term].filter(Boolean)));
  const lines = [
    `# Studium: contexto de ${course.name}`,
    '',
    'Material anónimo que aportaron estudiantes: conceptos, relaciones, preguntas reales en paráfrasis y ejemplos.',
    '',
    `## ${contest ? 'La competencia' : 'La materia'}`,
    `- Nombre: ${course.name}${course.code ? ` (${course.code})` : ''}${course.university ? `, ${course.university}` : ''}`,
    ...(people.size ? [`- ${contest ? 'Autores' : 'Profesores'} con aportes: ${[...people].map(([p, t]) => `${p}${t.size ? ` (${[...t].join(', ')})` : ''}`).join('; ')}`] : []),
    `- Aportes: ${Object.entries(kinds).map(([k, n]) => countKind(k, n)).join(', ') || 'ninguno todavía'}`,
    ...(guides.length ? [`- Guías publicadas: ${guides.map((g) => g.title).join('; ')}`] : []),
    ...(professor || term ? [`- Esta guía es para: ${[professor, term].filter(Boolean).join(', ')}. Lo de otros profesores o semestres aparece marcado.`] : []),
    '',
  ];
  const styles = sources.filter((c) => c.data.style);
  if (styles.length) {
    lines.push(contest ? '## Cómo son los problemas' : '## Cómo evalúan', '');
    for (const c of styles) lines.push(`- ${[c.professor, c.term, c.title].filter(Boolean).join(', ')}: ${c.data.style}`);
    lines.push('');
  }
  const asked = new Map();
  for (const c of contributions) for (const q of c.data.questions ?? []) for (const n of q.concepts) asked.set(keyOf(n), (asked.get(keyOf(n)) ?? 0) + 1);
  const chosen = [...concepts].sort((x, y) => (asked.get(y.key) ?? 0) - (asked.get(x.key) ?? 0));
  lines.push('## Conceptos', '', 'Ordenados por cuántas preguntas los evalúan. Usa el id como id de su sección en la guía.', '');
  for (const c of chosen) {
    lines.push(`### ${c.name} (id: ${c.key})`);
    const n = asked.get(c.key) ?? 0;
    if (n) lines.push(`Preguntas: ${n}.`);
    for (const s of c.summaries.slice(0, 2)) lines.push(s);
    const rel = c.relations.slice(0, 12).map((r) => `${RELATIONS[r.kind] ?? 'se relaciona con'} ${r.name}`);
    if (rel.length) lines.push(`Relaciones: ${rel.join('; ')}.`);
    lines.push('');
  }
  const wanted = new Set(chosen.map((c) => c.key));
  const questions = [];
  for (const c of sources) for (const q of c.data.questions ?? []) {
    if (q.concepts.some((n) => wanted.has(keyOf(n))) || !q.concepts.length) questions.push({ q, c });
  }
  if (questions.length) {
    lines.push('## Preguntas de evaluaciones anteriores (paráfrasis anónima)', '');
    for (const { q, c } of questions.slice(0, 220)) {
      const other = professor && c.professor && c.professor !== professor ? ', otro profesor' : '';
      const tags = [c.title, c.term, c.professor, QUESTION_KINDS[q.kind], `dificultad ${q.difficulty} de 5`, q.points != null ? plural(q.points, 'punto', 'puntos') : ''].filter(Boolean).join(', ');
      lines.push(`- [${tags}${other}; conceptos: ${q.concepts.join(', ') || 'sin indicar'}] ${q.text}`);
      if (q.solution) lines.push(`  Solución: ${q.solution}`);
    }
    lines.push('');
  }
  const examples = [];
  for (const c of sources) for (const e of c.data.examples ?? []) if (e.concepts.some((n) => wanted.has(keyOf(n)))) examples.push(e);
  if (examples.length) {
    lines.push('## Ejemplos', '');
    for (const e of examples.slice(0, 120)) lines.push(`- [${e.concepts.join(', ')}] ${e.text}`);
    lines.push('');
  }
  const books = contributions.map((c) => c.data.source).filter((s) => s?.title);
  if (books.length) {
    lines.push('## Libros y textos', '');
    for (const b of books) lines.push(`- ${[b.title, b.author, b.chapter].filter(Boolean).join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ---------- personal data ---------- */

const EXAMPLE_DOMAINS = /@(example|ejemplo|test|prueba|dominio|correo|empresa|mail)\.(com|org|net|edu|ec)\b/i;
// Possible personal data in text an AI returned: what must go, and what to look at.
export function findPersonal(text, email = '') {
  const found = [];
  const add = (match, label, block) => {
    if (!found.some((f) => f.match === match)) found.push({ match, label, block });
  };
  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) if (!EXAMPLE_DOMAINS.test(m[0])) add(m[0], 'correo', true);
  for (const m of text.matchAll(/(?:\+?593[\s.-]?|\b0)9\d(?:[\s.-]?\d){7}\b/g)) add(m[0], 'teléfono', true);
  for (const m of text.matchAll(/\b\d{10}\b|\b00\d{6}\b/g)) add(m[0], 'número que parece una cédula o un código de estudiante', false);
  for (const m of text.matchAll(/\b(?:nombre(?: del estudiante| completo)?|apellidos?|estudiante|alumn[oa]|c[oó]digo(?: banner| de estudiante)?|c[eé]dula|id banner|calificaci[oó]n|nota obtenida|firma)\s*:\s*[^\s,;"][^\n",;]{0,40}/gi)) {
    add(m[0], 'dato con etiqueta personal', false);
  }
  const user = email.split('@')[0]?.toLowerCase();
  if (user && user.length >= 4) {
    for (const m of text.matchAll(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))) add(m[0], 'tu usuario de correo', false);
  }
  return found;
}
export const redact = (text, findings) => findings.reduce((t, f) => t.split(f.match).join('[anónimo]'), text);
