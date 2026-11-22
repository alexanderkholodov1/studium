// «Trabajos»: the instructions a person's own AI receives to turn an assignment (its statement and rubric) into a
// solution guide that a group can follow line by line, and the checks Studium runs on what comes back. The guide is
// data, never markup: Studium draws it, so nothing an AI writes runs on the page.

export const LETTERS = 'ABCDEFGH';

const COMMON = `Eres el autor de una guía de solución dentro de Studium, una plataforma de estudio. Un grupo de estudiantes que todavía no sabe programar ni conoce las librerías debe resolver un trabajo de curso y defenderlo: cada integrante tiene que entender CADA línea de código, cada función y librería, y la teoría detrás. La guía lleva la solución completa hasta el entregable final, pero escrita para que la escriban y entiendan ellos, no para copiar y pegar.

Reglas:
- Escribe en el idioma del enunciado (por defecto, español), claro y sin relleno.
- Respeta exactamente lo que pide el enunciado y la rúbrica: requisitos, restricciones, prohibiciones (por ejemplo, privacidad de datos o no evadir CAPTCHA) y la guía del curso si se menciona.
- No inventes datos, resultados ni números que no puedas saber: donde dependan de los datos reales, dilo ("aquí verás…").
- El código debe ser correcto, moderno y ejecutable en el entorno que pide el trabajo (por ejemplo Google Colab).
- Responde SOLO con un bloque \`\`\`json válido, sin texto antes ni después.`;

// The outline: requirements, glossary and milestones with their steps split among the parts.
export function outlinePrompt({ parts, course, deadline }) {
  const letters = LETTERS.slice(0, parts).split('').join(', ');
  return `${COMMON}

Tarea: lee el enunciado y la rúbrica y devuelve el ESQUEMA de la guía (todavía sin el código de cada paso).
- "requisitos": cada cosa verificable que pide el trabajo, con la cita exacta del enunciado y su peso en la rúbrica si lo tiene (por ejemplo "3.5/10"); "material" nombra el material del curso o la referencia en que se apoya, si el enunciado lo dice.
- "glosario": los términos que un estudiante sin experiencia necesita para entender el enunciado.
- "hitos": ordenados por dependencias, nunca por fechas${deadline ? ` (la única fecha es la entrega: ${deadline})` : ''}. Cada hito tiene un entregable verificable y "listo_cuando". Sus "pasos" son piezas pequeñas (de 10 a 40 líneas de código o una tarea concreta), cada una con su "parte".
- El grupo tiene ${parts} ${parts === 1 ? 'parte' : 'partes'}: ${letters}. Reparte los pasos de forma equilibrada y para que las partes avancen en paralelo; lo que más pesa en la rúbrica no debe depender de una sola parte.
- Los ids: requisitos "R1", "R2"…; hitos "H0", "H1"…; pasos "H1.1", "H1.2"…
${course ? `- El curso: ${course}.` : ''}

Formato exacto:
\`\`\`json
{
  "titulo": "…", "curso": "…", "resumen": "qué pide el trabajo, en 3 a 5 frases",
  "requisitos": [{ "id": "R1", "texto": "…", "cita": "…", "peso": "…", "material": "…" }],
  "glosario": [{ "termino": "…", "definicion": "…" }],
  "hitos": [{ "id": "H0", "titulo": "…", "entregable": "…", "listo_cuando": "…", "depende": [],
    "pasos": [{ "id": "H0.1", "titulo": "…", "parte": "A", "requisitos": ["R1"] }] }],
  "avisos": ["lo que el grupo debe saber antes de empezar (riesgos, prohibiciones, dudas del enunciado)"]
}
\`\`\``;
}

// One milestone in full: for each step, the theory, the code in pieces with every line explained, what to expect,
// and the questions that check understanding and prepare the defense.
export function milestonePrompt({ milestone, outline }) {
  return `${COMMON}

Tarea: escribe COMPLETO el hito ${milestone.id} («${milestone.titulo}») de la guía, paso por paso. El esquema de toda la guía va abajo, para que el código de este hito encaje con el de los demás (mismos nombres de archivos, variables y semilla).
Para cada paso:
- "teoria": lo mínimo que hay que entender antes de escribir el código, con el porqué (2 a 6 párrafos cortos; \`código\` entre comillas invertidas).
- "codigo": el código del paso en piezas pequeñas. Cada pieza trae "lineas": UNA explicación por cada línea no vacía, con su número (desde 1 en esa pieza): qué hace, qué es cada función y argumento, de qué librería viene y por qué se usa así.
- "librerias": cada librería o módulo que aparece por primera vez, con para qué sirve.
- "esperado": qué debería ver el estudiante al ejecutarlo.
- "comprueba": 1 o 2 preguntas para comprobar que lo entendió, con su respuesta.
- "defensa": 1 a 3 preguntas que un profesor podría hacer en la defensa sobre este paso, con su respuesta.
- "commit": un mensaje de commit corto que empiece con el id del paso entre corchetes, por ejemplo "[H1.2] Carga del dataset".
Si un paso no es de código (por ejemplo revisar los términos de uso de un sitio), "codigo" va vacío y "teoria" explica cómo hacerlo.

Formato exacto:
\`\`\`json
{ "id": "${milestone.id}", "pasos": [{ "id": "…", "objetivo": "…", "teoria": "…",
  "codigo": [{ "lenguaje": "python", "codigo": "…", "lineas": [{ "n": 1, "explicacion": "…" }] }],
  "librerias": [{ "nombre": "…", "para_que": "…" }],
  "esperado": "…", "comprueba": [{ "pregunta": "…", "respuesta": "…" }],
  "defensa": [{ "pregunta": "…", "respuesta": "…" }], "commit": "[${milestone.id}.1] …" }] }
\`\`\`

El esquema de la guía:
${JSON.stringify(outline)}`;
}

// «No lo entiendo»: a short explanation from the person's quick AI, about one requirement, step or line.
export const TUTOR = `Eres un tutor paciente dentro de Studium. Un estudiante que está aprendiendo a programar no entiende una parte de su trabajo de curso. Explícasela de forma breve y concreta (máximo 200 palabras), con un ejemplo si ayuda, en el idioma del estudiante. No cambies la solución: ayúdale a entenderla. Termina con una pregunta corta para que compruebe que lo entendió. Texto simple; \`código\` entre comillas invertidas.`;

/* ---------- reading what came back ---------- */
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const ID = /^[A-Z]{1,2}\d{1,3}(\.\d{1,3})?$/;

export function parseJSON(text) {
  const raw = String(text ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

// Only the fields Studium knows, with their lengths capped: anything else the AI adds is dropped.
export function cleanOutline(o, parts) {
  const letters = LETTERS.slice(0, parts);
  const hitos = list(o?.hitos, 30).map((h, i) => ({
    id: ID.test(h?.id) ? h.id : `H${i}`,
    titulo: str(h?.titulo, 160), entregable: str(h?.entregable, 600), listo_cuando: str(h?.listo_cuando, 400),
    depende: list(h?.depende, 10).filter((d) => typeof d === 'string' && ID.test(d)),
    pasos: list(h?.pasos, 40).map((p, j) => ({
      id: ID.test(p?.id) ? p.id : `${h?.id ?? `H${i}`}.${j + 1}`,
      titulo: str(p?.titulo, 160),
      parte: letters.includes(p?.parte) && p.parte.length === 1 ? p.parte : letters[j % letters.length],
      requisitos: list(p?.requisitos, 10).filter((r) => typeof r === 'string' && /^R\d{1,3}$/.test(r)),
    })),
  }));
  if (!hitos.length || !hitos.some((h) => h.pasos.length)) throw new Error('La respuesta de tu IA no trae hitos con pasos.');
  return {
    titulo: str(o?.titulo, 160), curso: str(o?.curso, 120), resumen: str(o?.resumen, 2000),
    requisitos: list(o?.requisitos, 80).map((r, i) => ({ id: /^R\d{1,3}$/.test(r?.id) ? r.id : `R${i + 1}`, texto: str(r?.texto, 600), cita: str(r?.cita, 800), peso: str(r?.peso, 30), material: str(r?.material, 300) })),
    glosario: list(o?.glosario, 80).map((g) => ({ termino: str(g?.termino, 80), definicion: str(g?.definicion, 600) })).filter((g) => g.termino),
    hitos,
    avisos: list(o?.avisos, 20).map((a) => str(a, 600)).filter(Boolean),
  };
}

export function cleanMilestone(m, milestone) {
  const known = new Set(milestone.pasos.map((p) => p.id));
  const pasos = list(m?.pasos, 40).filter((p) => known.has(p?.id)).map((p) => ({
    id: p.id, objetivo: str(p?.objetivo, 600), teoria: str(p?.teoria, 8000),
    codigo: list(p?.codigo, 12).map((c) => ({
      lenguaje: str(c?.lenguaje, 20) || 'python', codigo: str(c?.codigo, 12000),
      lineas: list(c?.lineas, 300).map((l) => ({ n: Number.isInteger(l?.n) ? l.n : 0, explicacion: str(l?.explicacion, 1200) })).filter((l) => l.n > 0),
    })).filter((c) => c.codigo.trim()),
    librerias: list(p?.librerias, 20).map((l) => ({ nombre: str(l?.nombre, 60), para_que: str(l?.para_que, 400) })).filter((l) => l.nombre),
    esperado: str(p?.esperado, 1500),
    comprueba: list(p?.comprueba, 4).map((q) => ({ pregunta: str(q?.pregunta, 400), respuesta: str(q?.respuesta, 1500) })).filter((q) => q.pregunta),
    defensa: list(p?.defensa, 5).map((q) => ({ pregunta: str(q?.pregunta, 400), respuesta: str(q?.respuesta, 1500) })).filter((q) => q.pregunta),
    commit: str(p?.commit, 120),
  }));
  if (!pasos.length) throw new Error(`La respuesta de tu IA no trae los pasos del hito ${milestone.id}.`);
  return { id: milestone.id, pasos };
}
