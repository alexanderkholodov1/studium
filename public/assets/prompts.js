// What Studium asks of a person's own AI (any of them: ChatGPT, Gemini, Claude, Copilot, NotebookLM…), and how it
// reads back what the AI returns: a contribution (JSON) or a guide (one HTML file with its data in a JSON block).
import { THEMES, keyOf, validTheme } from './themes.js';
import { conceptName, looseKey, stageLabel, stageOf } from './standard.js';

export const KINDS = {
  exam: 'Examen', homework: 'Deber', lab: 'Laboratorio', slides: 'Diapositivas', notes: 'Apuntes', summary: 'Resumen',
  book: 'Libro o texto', syllabus: 'Sílabo', contest: 'Problemas de competencia', curriculum: 'Malla curricular', other: 'Otro',
};
const KIND_PLURALS = {
  exam: 'exámenes', homework: 'deberes', lab: 'laboratorios', slides: 'presentaciones', notes: 'archivos de apuntes', summary: 'resúmenes',
  book: 'libros o textos', syllabus: 'sílabos', contest: 'problemas de competencia', curriculum: 'mallas curriculares', other: 'otros',
};
// What each kind is, for the person choosing it and for their AI.
export const KIND_HINTS = {
  exam: 'parciales, finales, quizzes y pruebas, resueltos o no', homework: 'deberes, tareas y talleres',
  lab: 'prácticas, laboratorios e informes', slides: 'diapositivas y material de clase', notes: 'apuntes de clase, a mano o no',
  summary: 'resúmenes, formularios, cheatsheets y tarjetas', book: 'libros, capítulos y lecturas',
  syllabus: 'el programa de la materia: unidades, semanas y qué entra en cada evaluación',
  contest: 'problemas de IEEEXtreme, ICPC y otras competencias', curriculum: 'la malla de una carrera', other: 'cualquier otro material',
};
const KIND_ONE = {
  exam: 'examen', homework: 'deber', lab: 'laboratorio', slides: 'presentación', notes: 'archivo de apuntes', summary: 'resumen',
  book: 'libro o texto', syllabus: 'sílabo', contest: 'conjunto de problemas de competencia', curriculum: 'malla curricular', other: 'otro',
};
// "1 examen", "3 exámenes".
export const countKind = (kind, n) => `${n} ${n === 1 ? KIND_ONE[kind] ?? 'otro' : KIND_PLURALS[kind] ?? 'otros'}`;
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

const SPANISH_KINDS = { examen: 'exam', parcial: 'exam', prueba: 'exam', quiz: 'exam', final: 'exam', deber: 'homework', tarea: 'homework',
  taller: 'homework', laboratorio: 'lab', practica: 'lab', informe: 'lab', diapositivas: 'slides', clase: 'slides', libro: 'book',
  texto: 'book', lectura: 'book', apuntes: 'notes', resumen: 'summary', formulario: 'summary', cheatsheet: 'summary',
  silabo: 'syllabus', syllabus: 'syllabus', programa: 'syllabus', competencia: 'contest', problemas: 'contest', malla: 'curriculum',
  otro: 'other' };
const SPANISH_LEVELS = { 'desde cero': 'basic', basico: 'basic', intermedio: 'standard', avanzado: 'advanced' };

const clip = (value, max) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '');
const list = (value) => (Array.isArray(value) ? value : []);
const field = (label, value) => `- ${label}: ${value || '(dedúcelo del material; si no se puede saber, deja "")'}`;

/* ---------- contributions ---------- */

// m: what the person already knows of the material (kind, course, code, university, professor, term, stage), the concepts
// the map already has for that course (known), and, when a long file was split, which part this is (part).
export function contributionInstructions(m = {}) {
  const contest = m.kind === 'contest';
  const syllabus = m.kind === 'syllabus';
  const book = m.kind === 'book';
  const known = (m.known ?? []).slice(0, 400);
  const part = m.part ? `\n\n## Esta es una parte de un archivo más grande\n${m.part}. Extrae solo lo que trae esta parte; las otras van en otros aportes.` : '';
  return `# Instrucciones de Studium: convertir material de estudio en un aporte

Studium es un mapa de conocimiento que comparten estudiantes. Un aporte describe, de forma compacta y anónima, lo que
enseña o evalúa un material: sus conceptos en el orden en que se enseñan, cómo se relacionan, las preguntas o problemas
que trae y la forma de enseñar o evaluar de quien lo preparó. Con los aportes de muchas personas, Studium arma rutas de
estudio (todo lo que hace falta para rendir, por ejemplo, el Examen 2 de una materia), bancos de preguntas por concepto
y guías de estudio.

Te adjunto el material. Léelo completo (todas las páginas, diapositivas, hojas o problemas) antes de responder.${part}

## Lo que sé del material
${field('Tipo', m.kind ? `${KINDS[m.kind]} (${KIND_HINTS[m.kind]})` : '')}
${field('Materia o competencia', m.course)}
${field('Código de la materia', m.code)}
${field('Universidad u organizador', m.university)}
${field('Profesor', contest ? 'no aplica: deja ""' : m.professor)}
${field(contest ? 'Edición' : 'Semestre', m.term)}
${field('Evaluación a la que pertenece', contest ? 'no aplica: deja ""' : m.stage)}

## Anónimo, siempre
Otros estudiantes verán este aporte.
- Quita todo dato de estudiantes: nombres, firmas, códigos o números de estudiante, cédulas, correos, teléfonos,
  calificaciones obtenidas y comentarios del profesor dirigidos a una persona. Esto vale también para el nombre del
  archivo y para lo escrito a mano en los márgenes.
- Conserva el nombre del profesor, la materia, la universidad y el semestre o edición: sirven para saber qué se evalúa.
- Si el material trae respuestas de un estudiante, no las copies: escribe tú la solución correcta. Si una respuesta del
  estudiante muestra un error típico, descríbelo sin decir de quién es.
- No copies párrafos de libros, diapositivas o enunciados largos: resume con tus palabras y conserva los datos que hacen
  falta para resolver (números, matrices, restricciones, código corto).

## Si está escrito a mano, fotografiado o escaneado
Transcribe con cuidado los números, fórmulas y diagramas. Lo que no se lea con certeza no lo inventes: escribe
[ilegible] en ese lugar. Describe en palabras las figuras, tablas y diagramas que hagan falta para resolver.

## Qué extraer
- **concepts**: cada concepto que el material enseña, usa o evalúa (definiciones, teoremas, métodos, técnicas,
  algoritmos, herramientas), **en el orden en que el material los enseña**. Para cada uno:
  - **name**: un nombre corto y estándar en español, sin paréntesis ni siglas añadidas («Búsqueda en anchura», no
    «Búsqueda en anchura (BFS)»).
  - **aka**: sus otros nombres: el término en inglés, siglas y variantes («BFS», «Breadth-first search»).
  - **unit**: la unidad, capítulo, semana o tema donde aparece, si el material lo dice.
  - **summary**: una o dos frases con tu redacción.
  - **related**: sus relaciones con otros conceptos; sobre todo lo que se necesita saber antes («prerequisite»).
- **stage**: ${contest ? 'deja ""' : 'la evaluación a la que pertenece o para la que prepara el material, tal como la nombra: "Examen 2", "Parcial 1", "Final", "Quiz 3", "Deber 4". Si no se puede saber, "".'}
- **questions**: ${contest
    ? 'cada problema de la competencia. kind "algorithmic"; text: el enunciado resumido con entrada, salida y restricciones; solution: la idea, el algoritmo y su complejidad (y código breve si se conoce); concepts: las técnicas y temas que pide (programación dinámica, BFS, árboles de segmentos, teoría de números…).'
    : book
      ? 'los ejercicios más representativos de esta parte (como máximo 25), con los conceptos que evalúan; la solución breve solo si la conoces con certeza.'
      : syllabus
        ? 'ninguna: deja [].'
        : 'cada pregunta, ejercicio o problema, con su número tal como aparece (number), los conceptos que evalúa, su tipo, su dificultad, su puntaje si aparece, el enunciado en paráfrasis compacta y la solución correcta breve si la conoces con certeza (si no, deja ""). Si un mismo archivo trae varias evaluaciones, pon en cada pregunta su stage.'}
- **examples**: ejemplos resueltos o casos que el material usa para explicar, en pocas líneas.
- **style**: de 2 a 5 frases sobre cómo ${contest ? 'son los problemas de esta competencia (formato, dificultad, temas frecuentes, trampas)' : syllabus ? 'se evalúa la materia según el sílabo (pesos, tipo de evaluaciones, reglas)' : 'enseña o evalúa este profesor según este material: formato, qué pesa más, nivel de rigor, trampas habituales, notación'}.
- **source**: solo para libros o textos publicados: título, autor y capítulo.${syllabus ? `
- **plan**: el programa de la materia.
  - units: cada unidad con su nombre, sus semanas, la evaluación que la cubre (stage) y sus conceptos.
  - assessments: cada evaluación con su nombre, su semana y su peso en la nota si aparecen.` : ''}

## Formato de la respuesta
Devuelve un archivo \`studium-aporte.json\` para descargar. Si no puedes crear archivos (por ejemplo en NotebookLM),
responde solo con un bloque de código JSON, sin texto antes ni después.

\`\`\`json
{
  "studium": "aporte",
  "version": 2,
  "kind": "exam",
  "course": "Álgebra Lineal",
  "code": "MAT-0000",
  "university": "Universidad",
  "professor": "Nombre Apellido",
  "term": "202610",
  "title": "Examen parcial 1",
  "stage": "Examen 1",
  "theme": "vectores",
  "style": "Evalúa sobre todo cálculos a mano con matrices de 3x3 y una demostración corta por examen.",
  "source": { "title": "", "author": "", "chapter": "" },
  "concepts": [
    { "name": "Espacio vectorial", "aka": ["Vector space"], "unit": "Unidad 2",
      "summary": "Conjunto con suma y producto por escalar que cumplen ocho axiomas.",
      "related": [ { "to": "Subespacio", "kind": "prerequisite" } ] },
    { "name": "Subespacio", "aka": ["Subspace"], "unit": "Unidad 2",
      "summary": "Subconjunto de un espacio vectorial que es espacio vectorial con las mismas operaciones.", "related": [] }
  ],
  "questions": [
    { "number": "3", "concepts": ["Subespacio"], "kind": "proof", "difficulty": 3, "points": 10,
      "text": "Probar que el conjunto de matrices simétricas de 2x2 es un subespacio de M2x2.",
      "solution": "Contiene la matriz cero y es cerrado bajo suma y producto por escalar porque (A+B)^T = A^T + B^T." }
  ],
  "examples": [ { "concepts": ["Espacio vectorial"], "text": "R^2 con la suma y el producto usuales es un espacio vectorial." } ]${syllabus ? `,
  "plan": {
    "units": [ { "name": "Espacios vectoriales", "weeks": "4-6", "stage": "Examen 1", "concepts": ["Espacio vectorial", "Subespacio"] } ],
    "assessments": [ { "name": "Examen 1", "week": 7, "weight": 20 } ]
  }` : ''}
}
\`\`\`

Reglas:
- JSON válido: comillas dobles, sin comentarios, sin comas al final.
- kind del aporte: ${Object.keys(KINDS).filter((k) => k !== 'curriculum').map((k) => `"${k}"`).join(', ')}.
- kind de una pregunta: ${Object.keys(QUESTION_KINDS).map((k) => `"${k}"`).join(', ')}.
- kind de una relación: ${Object.entries(RELATIONS).map(([k, v]) => `"${k}" (${v})`).join(', ')}.
- difficulty: 1 (muy fácil) a 5 (muy difícil), según el nivel del curso o de la competencia.
- theme, el estilo visual de la materia: ${Object.entries(THEMES).map(([k, t]) => `"${k}" (${t.hint})`).join('; ')}.
- Cada nombre en "concepts" de una pregunta, un ejemplo, una relación o una unidad debe aparecer también como concepto
  en la lista, escrito igual.
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

// Concepts in the order the material teaches them, one per name: «Subredes» and «Subred (subnet)» are one concept, and
// what a name carried in parentheses becomes an alias.
function cleanConcepts(raw, warnings) {
  const byKey = new Map();
  for (const item of list(raw)) {
    const c = typeof item === 'string' ? { name: item } : item ?? {};
    const { name, aliases } = conceptName(clip(c.name, 120), list(c.aka ?? c.aliases).map((a) => clip(a, 80)));
    const key = looseKey(name);
    if (!key) continue;
    const prior = byKey.get(key) ?? { name, aka: [], unit: '', summary: '', related: [] };
    for (const a of aliases) if (!prior.aka.some((x) => looseKey(x) === looseKey(a)) && looseKey(a) !== key) prior.aka.push(a);
    prior.aka = prior.aka.slice(0, 8);
    prior.unit ||= clip(c.unit, 60);
    prior.summary ||= clip(c.summary, 600);
    for (const r of list(c.related)) {
      const to = conceptName(clip(typeof r === 'string' ? r : r?.to, 120)).name;
      const kind = r?.kind in RELATIONS ? r.kind : 'related';
      if (looseKey(to) && looseKey(to) !== key && !prior.related.some((x) => looseKey(x.to) === looseKey(to) && x.kind === kind)) prior.related.push({ to, kind });
    }
    prior.related = prior.related.slice(0, 20);
    byKey.set(key, prior);
  }
  const concepts = [...byKey.values()].map(({ aka, unit, ...c }) => ({ ...c, ...(aka.length ? { aka } : {}), ...(unit ? { unit } : {}) }));
  if (concepts.length > 300) warnings.push(`Trae ${concepts.length} conceptos; se guardan los primeros 300.`);
  return concepts.slice(0, 300);
}
const conceptNames = (value, max) => list(value).map((x) => conceptName(clip(x, 120)).name).filter((x) => keyOf(x)).slice(0, max);
const names = (value) => conceptNames(value, 12);
// A syllabus: its units (with their weeks, the evaluation that covers them and their concepts) and its evaluations.
function cleanPlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
  const units = list(raw.units).map((u) => ({
    name: clip(typeof u === 'string' ? u : u?.name, 100), weeks: clip(u?.weeks, 20), stage: stageLabel(clip(u?.stage, 40)),
    concepts: conceptNames(u?.concepts, 40),
  })).filter((u) => u.name).slice(0, 40);
  const assessments = list(raw.assessments).map((a) => ({
    name: stageLabel(clip(typeof a === 'string' ? a : a?.name, 40)),
    ...(number(a?.week) != null ? { week: number(a.week) } : {}), ...(number(a?.weight) != null ? { weight: number(a.weight) } : {}),
  })).filter((a) => a.name).slice(0, 30);
  return units.length || assessments.length ? { units, assessments } : null;
}

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
  const plan = kind === 'syllabus' || obj.plan ? cleanPlan(obj.plan) : null;
  if (!concepts.length && !plan) return { error: 'No trae conceptos. Pide a tu IA que siga el formato de las instrucciones de Studium.' };
  const questions = list(obj.questions).map((q) => ({
    ...(clip(q?.number, 12) ? { number: clip(q.number, 12) } : {}),
    ...(clip(q?.stage, 40) ? { stage: stageLabel(clip(q.stage, 40)) } : {}),
    concepts: names(q?.concepts), kind: q?.kind in QUESTION_KINDS ? q.kind : 'problem',
    difficulty: Math.min(5, Math.max(1, Math.round(Number(q?.difficulty)) || 3)),
    ...(Number.isFinite(Number(q?.points)) && q?.points !== '' && q?.points != null ? { points: Number(q.points) } : {}),
    text: clip(q?.text, 2500), solution: clip(q?.solution, 3000),
  })).filter((q) => q.text);
  const examples = list(obj.examples).map((e) => ({ concepts: names(e?.concepts), text: clip(e?.text, 2000) })).filter((e) => e.text);
  if (questions.length > 200) warnings.push(`Trae ${questions.length} preguntas; se guardan las primeras 200.`);
  if (examples.length > 150) warnings.push(`Trae ${examples.length} ejemplos; se guardan los primeros 150.`);
  // Every concept a question, an example or a unit names is a concept of the contribution: the ones the AI forgot to
  // list join the list, so the map knows them as taught and not only as mentioned.
  const listed = new Set(concepts.map((c) => looseKey(c.name)));
  const missing = [];
  for (const n of [...questions, ...examples, ...(plan?.units ?? [])].flatMap((x) => x.concepts)) {
    if (!listed.has(looseKey(n))) { listed.add(looseKey(n)); missing.push(n); }
  }
  if (missing.length) {
    for (const n of missing) concepts.push({ name: n, summary: '', related: [] });
    warnings.push(missing.length === 1 ? `«${missing[0]}» no estaba en la lista de conceptos: se agregó.` : `${missing.length} conceptos de las preguntas o ejemplos no estaban en la lista: se agregaron.`);
  }
  const source = obj.source && typeof obj.source === 'object'
    ? { title: clip(obj.source.title, 160), author: clip(obj.source.author, 160), chapter: clip(obj.source.chapter, 160) } : null;
  const title = pick('title', 120) || KINDS[kind];
  // The stage as the AI or the person wrote it, read the standard way; or the one the title names.
  const stage = kind === 'contest' ? '' : stageLabel(pick('stage', 40)) || stageOf(title)?.label || '';
  return {
    meta: {
      kind, course: pick('course', 80), code: pick('code', 30), university: pick('university', 60),
      professor: pick('professor', 80), term: pick('term', 60), title, stage,
      theme: validTheme(obj.theme) ?? validTheme(fallback.theme) ?? '',
    },
    data: {
      version: 2, concepts: concepts.slice(0, 300), questions: questions.slice(0, 200), examples: examples.slice(0, 150), style: clip(obj.style, 1500),
      ...(source?.title ? { source } : {}), ...(plan ? { plan } : {}),
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

// What each extra section the student asks for adds to the instructions.
const SECTION_TEXT = {
  flashcards: 'Tarjetas de términos: al final, un mazo de tarjetas que se voltean al pulsarlas (término al frente; definición y un ejemplo atrás), con botones «La sé» y «Repasar» y un contador de las que faltan.',
  mock: 'Simulacro: al final, un examen de práctica con el formato, la cantidad de preguntas y la dificultad de la evaluación real, con cronómetro, que se corrige al terminar y explica cada respuesta.',
  cheatsheet: 'Resumen de una página: fórmulas, definiciones y pasos clave en una sola pantalla, lista para imprimir.',
  mistakes: 'Errores comunes: en cada tema, los errores típicos y las trampas habituales de la evaluación, con el razonamiento correcto.',
  solved: 'Ejercicios resueltos paso a paso: cada paso se revela con un botón, con su justificación.',
  conceptmap: 'Mapa de conceptos: un diagrama SVG interactivo de cómo se relacionan los conceptos, que lleva a la sección de cada uno.',
  selfcheck: 'Autoevaluación: al final de cada tema, de 3 a 5 preguntas con puntaje y un mensaje según el resultado.',
};
const DECOR_TEXT = {
  notebook: 'Cuaderno: papel claro con líneas azules y margen rojo, y los consejos como anotaciones a mano (fuente Caveat de Google Fonts); en modo oscuro, papel azul noche.',
  minimal: 'Minimal: blanco y negro con un solo color de acento, tipografía limpia, nada de adornos.',
  playful: 'Tierna: colores suaves, esquinas muy redondeadas y pequeñas ilustraciones SVG simpáticas y originales; emojis con moderación.',
  night: 'Nocturna: fondo oscuro profundo, acentos brillantes y brillos suaves alrededor de lo importante.',
};

// The instructions for a guide. They name only what the student gave: the subject, and the evaluation, date,
// professor or term when there are any. The student's own notes come first; the map's context is an extra.
// o.api: the AI is called from Studium (o.notes says how many files are attached); otherwise the text goes to a chat.
// o.graph: the map's context goes along, inline or as o.contextFile. o.until: the guide follows a route of the map
// («hasta Examen 2»): its concepts, in the order they are learnt, and nothing of later evaluations.
export function guideInstructions(o) {
  const contest = o.contest;
  const theme = THEMES[o.theme] ?? THEMES.estrellas;
  const what = o.title ? `«${o.title}» de ${o.course}` : o.course;
  const about = [o.professor && `con ${o.professor}`, o.term && (contest ? `edición ${o.term}` : `semestre ${o.term}`), o.date && `es el ${o.date}`].filter(Boolean);
  const meta = {
    studium: 'guia', version: 1, course: o.course, title: o.title || 'Guía de estudio', theme: o.theme, level: o.level,
    ...(o.code ? { code: o.code } : {}), ...(o.university ? { university: o.university } : {}), ...(o.professor ? { professor: o.professor } : {}),
    ...(o.term ? { term: o.term } : {}), ...(o.date ? { date: o.date } : {}),
    topics: ['…'], concepts: [{ name: '…', anchor: '…' }],
  };
  const sources = [];
  if (!o.api || o.notes) sources.push(`${o.api ? 'Te adjunto mis apuntes' : 'Te adjunto mis apuntes (PDF, fotos o texto)'}: son la fuente principal. Cubre lo que contienen, con su notación, su orden y su nivel.`);
  if (o.graph) {
    sources.push(`${o.contextFile ? `También te adjunto \`${o.contextFile}\` con` : 'Al final va'} el contexto de Studium: lo que otros estudiantes aportaron de esta ${contest ? 'competencia' : 'materia'}, de forma anónima (conceptos, relaciones y preguntas reales en paráfrasis${o.professor ? `, y cómo evalúa ${o.professor}` : ''}). Úsalo para decidir qué pesa más y para practicar con preguntas del mismo estilo, sin copiarlas.`);
  }
  if (o.api && !o.notes && !o.graph) sources.push('No hay apuntes: usa lo que sabes del tema, al nivel de un curso universitario.');
  else if (!o.api) sources.push('Si no adjunto nada, usa lo que sabes del tema, al nivel de un curso universitario.');
  if (o.graph && o.until) sources.push(`La guía sigue la ruta ${o.until} del mapa: cubre sus conceptos en el orden del contexto (de lo que se necesita antes a lo último que entra), y nada de evaluaciones posteriores.`);
  if (o.focus) sources.push(`Quiero reforzar: ${o.focus}.`);
  if (o.goal) sources.push(`Mi objetivo: ${o.goal}.`);
  const sections = (o.sections ?? []).filter((k) => SECTION_TEXT[k]);
  const english = o.lang === 'en';
  return `# Una guía de estudio de ${what}

Hazme una guía de estudio interactiva de ${what}${about.length ? ` (${about.join(', ')})` : ''}.

## De dónde sale
${sources.map((x) => `- ${x}`).join('\n')}

## Para mí
- Nivel: ${AUDIENCE[o.level] ?? AUDIENCE.standard}
- Extensión: ${LENGTH[o.length] ?? LENGTH.medium}.
- Práctica: ${PRACTICE[o.practice] ?? PRACTICE.normal}, ${CHALLENGE[o.challenge] ?? CHALLENGE.same}.
- Ejemplos: ${EXAMPLES[o.examples] ?? EXAMPLES.normal}.
- Idioma: ${english ? 'inglés. Write the whole guide in English, keeping the technical terms the course uses.' : 'español.'}
- Estilo: ${DECOR_TEXT[o.decor] ?? DECOR_TEXT.notebook}
${sections.length ? sections.map((k) => `- ${SECTION_TEXT[k]}`).join('\n') + '\n' : ''}
## Cómo escribirla
1. Cada término se explica cuando aparece: primero la definición precisa, después, si ayuda, una analogía. Da el
   término en inglés cuando es el usual.
2. Sin relleno: nada de índice, «cómo usar esta guía» ni introducciones que anuncian lo que viene.
3. Autocontenida: nunca «en la diapositiva», «el PDF» o «la pregunta 8»; describe la figura o el problema.
4. ${o.graph ? `Más espacio para lo que ${contest ? 'más aparece en los problemas' : 'más se evalúa'} (el contexto dice cuántas preguntas tiene cada concepto).` : 'Más espacio para lo que más pesa en mis apuntes y en una evaluación típica del tema.'}
5. La práctica va dentro del texto, justo después de cada idea: preguntas cortas, cada una con «Comprobar» (cuando
   se puede corregir sola: opción múltiple, número, verdadero o falso) y «Ver respuesta» con la solución explicada.
6. Aprovecha que es una página: diagramas SVG, animaciones paso a paso con pausa y paso atrás, simulaciones cuando
   ayuden y descripciones al pasar el cursor. Cada figura cabe en la misma pantalla que su explicación.
7. Ningún dato personal: ni nombres de estudiantes, ni notas, ni nada que identifique a alguien.${contest ? `
8. Programación competitiva: para cada técnica, un problema modelo con enunciado, entrada, salida y restricciones;
   la idea, la complejidad, el código completo en ${o.language || 'C++'} con resaltado, casos de prueba y errores
   típicos (desbordamiento, límites, casos borde).` : ''}

## Formato, para que Studium la muestre
- Un solo archivo HTML que empieza con <!doctype html>, ${english ? 'en inglés (lang="en")' : 'en español (lang="es")'}, con todo dentro: CSS,
  JavaScript e imágenes (SVG o data: URLs).
- Bibliotecas solo de cdnjs.cloudflare.com, cdn.jsdelivr.net o unpkg.com (KaTeX, highlight.js…) y fuentes solo de
  Google Fonts. Sin formularios que envíen datos; localStorage dura solo mientras la guía está abierta.
- Celular y computadora, sin desplazamiento horizontal, en modo claro y oscuro. Menos de 2 MB.
- Colores característicos: ${theme.a} y ${theme.b}, más los neutros que necesites.
- Cada parte en su propio <section id="…"> con un solo <h2>${o.graph ? '; para un concepto del contexto, usa el id que da el contexto' : ''}.
- Al inicio de <head>, este bloque, completado ("concepts": cada concepto que explica la guía, con el id de su
  sección; "topics": los temas en pocas palabras):

<script type="application/json" id="studium">
${JSON.stringify(meta, null, 2)}
</script>

## Entrega
${o.api
    ? 'Responde solo con el HTML completo, desde <!doctype html> hasta </html>, sin texto antes ni después.'
    : 'Devuélveme el archivo `guia.html` para descargar. Si no puedes crear archivos, escribe el HTML completo en un solo\nbloque de código; si no cabe en una respuesta, divídelo en partes y espera a que te pida la siguiente.'}
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
// ordered: the concepts come in the order of a route (each with its band: «Lo que necesitas antes», «Examen 1»…) and
// keep it; otherwise the most asked go first.
export function contextPack({ course, professor, term, concepts, contributions, guides, contest, ordered = false }) {
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
  for (const c of contributions) for (const q of c.data.questions ?? []) for (const n of q.concepts) asked.set(looseKey(n), (asked.get(looseKey(n)) ?? 0) + 1);
  const chosen = ordered ? [...concepts] : [...concepts].sort((x, y) => (asked.get(y.key) ?? 0) - (asked.get(x.key) ?? 0));
  lines.push('## Conceptos', '', ordered ? 'En el orden de la ruta: de lo que se necesita antes a lo último que entra. Usa el id como id de su sección en la guía.' : 'Ordenados por cuántas preguntas los evalúan. Usa el id como id de su sección en la guía.', '');
  let band = null;
  for (const c of chosen) {
    if (ordered && c.band && c.band !== band) { band = c.band; lines.push(`#### ${band}`, ''); }
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
    if (q.concepts.some((n) => wanted.has(looseKey(n))) || (!q.concepts.length && !ordered)) questions.push({ q, c });
  }
  if (questions.length) {
    lines.push('## Preguntas de evaluaciones anteriores (paráfrasis anónima)', '');
    for (const { q, c } of questions.slice(0, 220)) {
      const other = professor && c.professor && c.professor !== professor ? ', otro profesor' : '';
      const tags = [q.stage || c.stage || c.title, c.term, c.professor, QUESTION_KINDS[q.kind], `dificultad ${q.difficulty} de 5`, q.points != null ? plural(q.points, 'punto', 'puntos') : ''].filter(Boolean).join(', ');
      lines.push(`- [${tags}${other}; conceptos: ${q.concepts.join(', ') || 'sin indicar'}] ${q.text}`);
      if (q.solution) lines.push(`  Solución: ${q.solution}`);
    }
    lines.push('');
  }
  const examples = [];
  for (const c of sources) for (const e of c.data.examples ?? []) if (e.concepts.some((n) => wanted.has(looseKey(n)))) examples.push(e);
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
  // Ten digits (an ID card) or 00 + six digits (a student code); constants such as 1000000007 are not IDs.
  for (const m of text.matchAll(/\b\d{10}\b|\b00\d{6}\b/g)) {
    if (!/0{5}/.test(m[0].slice(1))) add(m[0], 'número que parece una cédula o un código de estudiante', false);
  }
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
