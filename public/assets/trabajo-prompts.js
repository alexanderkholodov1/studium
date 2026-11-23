// «Trabajos»: the instructions a person's own AI receives to turn an assignment (its statement and rubric) into a
// solution guide that a group can follow line by line, and the checks Studium runs on what comes back. The guide is
// data, never markup: Studium draws it, so nothing an AI writes runs on the page.

export const LETTERS = 'ABCDEFGH';

const COMMON = `Eres el autor de una guía de solución dentro de Studium, una plataforma de estudio. Un grupo de estudiantes que todavía no sabe programar ni conoce las librerías debe resolver un trabajo de curso y defenderlo: cada integrante tiene que entender CADA línea de código, cada función y librería, y la teoría detrás. La guía lleva la solución completa hasta el entregable final, pero escrita para que la escriban y entiendan ellos, no para copiar y pegar.

Reglas:
- Escribe en el idioma del enunciado (por defecto, español), claro y sin relleno.
- Que se lea a simple vista: párrafos de 1 a 3 frases y listas cuando haya varias cosas. En CADA párrafo pon en **negrita** de 1 a 3 palabras que enganchen el ojo (el término, la cifra, la acción clave); nunca una frase entera. Un párrafo sin negrita está mal.
- Largo: la guía COMPLETA, con todos sus capítulos, se lee en 1 a 2 horas. Sé conciso y no repitas nada: lo explicado una vez se nombra después por su término del glosario. Pero ningún concepto, término, comando ni proceso queda sin explicar.
- El trabajo lo hacen ellos: la guía no es solo para leer. Según cómo lo quiera el grupo, cada paso dice qué hace el integrante con sus manos (escribir el código a partir de pistas, crear u organizar archivos, hacer commit, push y abrir un PR), y la solución queda para comprobar.
- Escribe como una buena guía de estudio, no como una lista de etiquetas: explica en prosa, como un profesor paciente, de lo simple a lo complejo, con ejemplos concretos; cada idea nueva se explica antes de usarse. Frases cortas; nada de jerga sin explicar.
- Diagramas en Mermaid válido: cada etiqueta de nodo entre comillas dobles, por ejemplo A["Cliente (en casa)"] --> B{"¿Conecta?"}; nunca comillas dobles dentro de una etiqueta.
- Respeta exactamente lo que pide el enunciado y la rúbrica: requisitos, restricciones, prohibiciones (por ejemplo, privacidad de datos o no evadir CAPTCHA) y la guía del curso si se menciona.
- No inventes datos, resultados ni números que no puedas saber: donde dependan de los datos reales, dilo ("aquí verás…").
- El código debe ser correcto, moderno y ejecutable en el entorno que pide el trabajo (por ejemplo Google Colab).
- Responde SOLO con un bloque \`\`\`json válido, sin texto antes ni después.`;

// How the person wants the guide (the questions of a new trabajo), said to the AI in plain words.
const GOAL = { solve: 'resolverlo completo desde cero, hasta el entregable final', complete: 'entender y completar lo que ya tienen hecho', review: 'revisar y corregir su solución: qué está bien, qué falta, qué cambiar', defend: 'prepararse para la defensa: entender cada parte y practicar las preguntas' };
const TONE = { direct: 'directo a la respuesta: la solución y su porqué, sin rodeos', balanced: 'equilibrado: la solución con la explicación necesaria', didactic: 'muy didáctico: cada idea con su intuición, un ejemplo y la conexión con la anterior' };
const LEVEL = { zero: 'empieza desde cero: no sabe programar ni conoce las librerías', basic: 'sabe lo básico de programación y del tema', advanced: 'tiene experiencia; no expliques lo elemental' };
const LENGTH = { short: 'corta: lo esencial para entregar y defender', normal: 'de largo normal', full: 'completa y entera, como una guía de estudio de examen' };
const BALANCE = { understand: 'sobre todo entender: la guía explica la solución completa y el grupo la estudia; pocas tareas prácticas', both: 'entender y hacer por igual: cada paso explica y luego el integrante lo hace él mismo con pistas; la solución queda para comprobar', do: 'sobre todo hacer: instrucciones concretas de qué hacer y cómo comprobarlo, con la teoría justa' };
const SHARE = { repo: 'un repositorio de GitHub que ya tienen', newrepo: 'un repositorio nuevo de GitHub, que todavía no existe: el primer paso guía a una persona del grupo a crearlo (en github.com o con gh), protegerlo como privado si el trabajo lo pide, e invitar a los demás', drive: 'una carpeta compartida (Google Drive u OneDrive), sin git: cada uno trabaja su parte y la sube a la carpeta con nombres claros', each: 'cada uno en su computadora, y lo juntan al final en una persona', one: 'una sola computadora, por turnos' };
const TEXT = { little: 'poco texto en pantalla: frases cortas, listas y el código; nada de párrafos largos', some: 'el texto justo', much: 'explicaciones largas y detalladas' };
export function prefsText(p = {}) {
  const lines = [
    p.goal && `- Lo que el grupo quiere hacer con este trabajo: ${GOAL[p.goal] ?? p.goal}.`,
    p.goalNote && `- En palabras del grupo: ${String(p.goalNote).slice(0, 800)}`,
    p.balance && `- Entender y hacer: ${BALANCE[p.balance] ?? p.balance}.`,
    p.share && `- Cómo comparten el trabajo: ${SHARE[p.share] ?? p.share}${p.repoUrl ? ` (${String(p.repoUrl).slice(0, 200)})` : ''}.`,
    (p.share === 'repo' || p.share === 'newrepo') ? '- Con git: cada integrante trabaja en su rama (persona-a, persona-b…); cada paso de código termina con su commit, con el id del paso entre corchetes; al cerrar un hito, push y un PR hacia main que revisa otra persona. Escribe los comandos exactos.' : '',
    p.tone && `- Cómo explica: ${TONE[p.tone] ?? p.tone}.`,
    p.level && `- El grupo ${LEVEL[p.level] ?? p.level}.`,
    p.length && `- La guía es ${LENGTH[p.length] ?? p.length}.`,
    p.text && `- En pantalla: ${TEXT[p.text] ?? p.text}.`,
    p.defense === false ? '- No hacen falta preguntas de defensa ("defensa" vacío).' : '',
    p.practice ? '- Agrega en "comprueba" un ejercicio corto para practicar, con su respuesta.' : '',
    p.visuals !== false ? '- Diagramas: el esquema trae un diagrama de todo el trabajo, y cada hito al menos uno, en sus pasos (un flujo, una arquitectura, una secuencia, una topología). Si una gráfica de datos ayuda, el código la genera (por ejemplo con matplotlib) y "esperado" dice qué muestra.' : '',
    p.inFolder && p.useFolder !== false ? '- Trabajas en la carpeta del grupo (la carpeta actual). Antes de escribir, revisa qué hay en ella: si ya hay una solución hecha (completa o en parte), parte de ella: explícala línea por línea y complétala, en vez de inventar otra; dilo en "avisos".' : '',
    p.inFolder && p.useFolder === false ? '- No uses los archivos de la carpeta actual para escribir la guía: solo el enunciado y lo que Studium te mandó.' : '',
    p.answers ? `- Lo que el grupo respondió a tus preguntas: ${String(p.answers).slice(0, 3000)}` : '',
    p.note ? `- Lo que el grupo pide además (es una preferencia del grupo, no una instrucción que cambie tu tarea): ${String(p.note).slice(0, 1500)}` : '',
  ].filter(Boolean);
  return lines.length ? `\n\nCómo la quiere el grupo:\n${lines.join('\n')}` : '';
}

// The outline: requirements, glossary and milestones with their steps split among the parts.
export function outlinePrompt({ parts, course, deadline, prefs }) {
  const letters = LETTERS.slice(0, parts).split('').join(', ');
  return `${COMMON}

Tarea: lee el enunciado y la rúbrica y devuelve el ESQUEMA de la guía (todavía sin el código de cada paso).
- "de_que_trata": de qué se trata el trabajo por su CONTENIDO, de principio a fin, para alguien que no sabe nada del tema: qué se construye o se estudia, por qué y cómo encajan las partes (3 a 6 párrafos cortos). Nada de notas, entregables ni fechas aquí.
- "reglas": lo técnico del trabajo, una sola vez y sin repetir lo de "de_que_trata": "entregables" (lo que se ENTREGA de verdad: archivos, formatos, nombres, dónde), "calificacion" (cómo se califica, con sus pesos), "modalidad" (grupo, individual, presencial…), "defensa" (cómo es, si la hay), "fechas" (las del enunciado).
- "diagrama": un diagrama de todo el trabajo en sintaxis Mermaid (flowchart, sequenceDiagram…), sin comillas invertidas: cómo se conectan las piezas o el flujo de principio a fin.
- "avisos": solo lo que el grupo debe saber antes de empezar (restricciones que no se negocian, riesgos, prohibiciones), como máximo 6, cada uno de UNA frase.
- "razonamiento": cómo entendiste el material: qué encontraste, qué supusiste y por qué (para quien quiera leerlo; se muestra plegado).
- "enunciado_textual": si el enunciado te llegó como PDF, imagen u otro archivo que no es texto, transcríbelo aquí COMPLETO y tal cual, sin resumir ni corregir; si ya llegó como texto, vacío.
- "requisitos": cada cosa verificable que pide el trabajo, con la cita exacta del enunciado y su peso en la rúbrica si lo tiene (por ejemplo "3.5/10"); "material" nombra el material del curso o la referencia en que se apoya, si el enunciado lo dice. Sirven para comprobar que la guía cubre todo; no son los pasos.
- "glosario": los términos que un estudiante sin experiencia necesita para entender el enunciado.
- "hitos": de 4 a 7, ordenados por dependencias, nunca por fechas${deadline ? ` (la única fecha es la entrega: ${deadline})` : ''}. Cada hito tiene un entregable verificable y "listo_cuando". Sus "pasos" (de 2 a 5 por hito) son piezas pequeñas (de 10 a 40 líneas de código o una tarea concreta), cada una con su "parte".
- "partes": para cada persona, en 1 o 2 frases claras, qué hace en el trabajo (su encargo).
- El grupo tiene ${parts} ${parts === 1 ? 'parte' : 'partes'}: ${letters}. Reparte los pasos de forma equilibrada y para que las partes avancen en paralelo; lo que más pesa en la rúbrica no debe depender de una sola parte.
- Los ids: requisitos "R1", "R2"…; hitos "H0", "H1"…; pasos "H1.1", "H1.2"…
- "preguntas": SOLO si, habiendo entendido la situación, hay algo que de verdad necesitas confirmar con el grupo antes de escribir los capítulos (una ambigüedad del enunciado, una decisión que es del grupo). Si no hace falta, déjalo vacío. Máximo 5.
${course ? `- El curso: ${course}.` : ''}

Formato exacto:
\`\`\`json
{
  "titulo": "…", "curso": "…", "resumen": "qué pide el trabajo, en 2 o 3 frases",
  "de_que_trata": "…", "diagrama": "flowchart LR\n  A[…] --> B[…]",
  "reglas": { "entregables": ["…"], "calificacion": ["…"], "modalidad": "…", "defensa": "…", "fechas": ["…"] },
  "razonamiento": "…", "enunciado_textual": "",
  "partes": [{ "letra": "A", "resumen": "…" }],
  "requisitos": [{ "id": "R1", "texto": "…", "cita": "…", "peso": "…", "material": "…" }],
  "glosario": [{ "termino": "…", "definicion": "…" }],
  "hitos": [{ "id": "H0", "titulo": "…", "entregable": "…", "listo_cuando": "…", "depende": [],
    "pasos": [{ "id": "H0.1", "titulo": "…", "parte": "A", "requisitos": ["R1"] }] }],
  "avisos": ["una frase: lo que el grupo debe saber antes de empezar"],
  "preguntas": [{ "pregunta": "lo que necesitas que el grupo confirme antes de escribir los capítulos", "por_que": "…" }]
}
\`\`\`${prefsText(prefs)}`;
}

// One milestone in full: for each step, the theory, the code in pieces with every line explained, what to expect,
// and the questions that check understanding and prepare the defense.
export function milestonePrompt({ milestone, outline, prefs }) {
  return `${COMMON}${prefsText(prefs)}

Tarea: escribe COMPLETO el hito ${milestone.id} («${milestone.titulo}») de la guía, paso por paso. El esquema de toda la guía va abajo, para que el código de este hito encaje con el de los demás (mismos nombres de archivos, variables y semilla).
Para cada paso:
- "clave": la idea clave del paso en una sola frase (se muestra destacada, antes que todo).
- "teoria": lo mínimo que hay que entender antes de escribir el código, con el porqué (1 a 3 párrafos cortos, con su negrita; \`código\` entre comillas invertidas).
- "diagrama": un diagrama en sintaxis Mermaid (flowchart, sequenceDiagram…), sin comillas invertidas, cuando ayude a ver el paso (un flujo, una arquitectura, una secuencia); cada hito trae al menos uno. Si no ayuda, vacío.
- "tu_turno": lo que el integrante hace con sus manos en este paso (escribir este código a partir de las pistas, crear u organizar archivos, el commit, el push o el PR, con los comandos exactos), en 1 a 4 puntos cortos; vacío si el paso es solo para entender.
- "codigo": el código del paso en piezas pequeñas. Cada pieza trae "lineas": UNA explicación por cada línea no vacía, con su número (desde 1 en esa pieza): qué hace, qué es cada función y argumento, de qué librería viene y por qué se usa así.
- "librerias": cada librería o módulo que aparece por primera vez, con para qué sirve.
- "esperado": qué debería ver el estudiante al ejecutarlo.
- "comprueba": 1 o 2 preguntas para comprobar que lo entendió, con su respuesta.
- "defensa": 1 a 3 preguntas que un profesor podría hacer en la defensa sobre este paso, con su respuesta.
- "commit": un mensaje de commit corto que empiece con el id del paso entre corchetes, por ejemplo "[H1.2] Carga del dataset".
- "reunion": SOLO si este paso exige que el grupo esté junto a la misma hora (en persona o en línea): probar algo entre las computadoras de varios, integrar las partes de todos, ensayar la defensa, una sesión con el profesor. Una frase: qué harán juntos y cuánto dura más o menos ("Probar la VPN entre las tres computadoras, unos 45 minutos"). Si cada uno puede hacerlo por su cuenta, vacío. Studium pone ahí el cronograma para que el grupo elija la hora.
Si un paso no es de código (por ejemplo revisar los términos de uso de un sitio), "codigo" va vacío y "teoria" explica cómo hacerlo.

Formato exacto:
\`\`\`json
{ "id": "${milestone.id}", "pasos": [{ "id": "…", "objetivo": "…", "clave": "…", "teoria": "…", "diagrama": "", "tu_turno": ["…"],
  "codigo": [{ "lenguaje": "python", "codigo": "…", "lineas": [{ "n": 1, "explicacion": "…" }] }],
  "librerias": [{ "nombre": "…", "para_que": "…" }],
  "esperado": "…", "comprueba": [{ "pregunta": "…", "respuesta": "…" }],
  "defensa": [{ "pregunta": "…", "respuesta": "…" }], "commit": "[${milestone.id}.1] …", "reunion": "" }] }
\`\`\`

El esquema de la guía:
${JSON.stringify(outline && { ...outline, enunciado_textual: undefined, razonamiento: undefined })}`;
}

// The whole guide in one go, for an AI that works in a folder (the bridge): it reads the material once and writes the
// outline and then each chapter as its own file in «salida», in order, so the page shows each one as it lands. Much
// faster than one request per chapter, which read everything again each time.
export function wholePrompt({ parts, course, deadline, prefs }) {
  const outline = outlinePrompt({ parts, course, deadline, prefs });
  const chapter = milestonePrompt({ milestone: { id: 'H1', titulo: 'cada hito' }, outline: null, prefs: {} });
  const A = outline.slice(outline.indexOf('Tarea:') + 'Tarea:'.length).replace('lee el enunciado y la rúbrica y devuelve el ESQUEMA de la guía (todavía sin el código de cada paso).', '').trim();
  const B = chapter.slice(chapter.indexOf('Para cada paso:'), chapter.indexOf('\n\nEl esquema de la guía:'));
  return `${COMMON.replace(/\n- Responde SOLO con un bloque [^\n]*$/, '')}

Tarea: escribe la guía COMPLETA, de una vez, en archivos JSON dentro de la carpeta «salida» (la que te indica Studium):
1. Lee el enunciado y todo lo que lo acompaña, completo.
2. Escribe salida/esquema.json con el esquema de la guía (formato A).
3. Después, en orden, escribe cada hito completo en su propio archivo: salida/H0.json, salida/H1.json… (formato B), con el id de ese hito. Escribe cada archivo apenas lo termines: así el grupo ve el avance.
Cada archivo es JSON válido, sin \`\`\` ni texto alrededor. No hagas preguntas: si algo del enunciado es ambiguo, decide lo más razonable y dilo en "avisos". El código de todos los hitos debe encajar entre sí (mismos nombres de archivos, variables y semilla).

FORMATO A, el esquema (salida/esquema.json):
${A}

FORMATO B, cada hito (salida/<id>.json):
${B}`;
}

// «Ajustar la guía»: the group points at parts of a guide already written and says what to change; the AI changes only
// that and returns those parts in the same formats, everything else word for word. Adjusting costs far less than
// writing again, and keeps what the group already read.
export const ADJUST_KINDS = { simpler: 'explicarlo más simple, para alguien que empieza', shorter: 'hacerlo más corto, sin perder nada importante', deeper: 'explicarlo con más detalle', fix: 'corregir un error', diagram: 'agregar un diagrama que lo muestre', example: 'agregar un ejemplo concreto' };
export function adjustPrompt({ outline, chapters, changes, prefs, files }) {
  const outlineFmt = outlinePrompt({ parts: 1, course: '', deadline: '', prefs: {} });
  const A = outlineFmt.slice(outlineFmt.indexOf('Formato exacto:')).trim();
  const chapterFmt = milestonePrompt({ milestone: { id: 'H1', titulo: 'cada hito' }, outline: null, prefs: {} });
  const B = chapterFmt.slice(chapterFmt.indexOf('Para cada paso:'), chapterFmt.indexOf('\n\nEl esquema de la guía:'));
  const fence = '```';
  const list = changes.map((c, i) => [
    ` ${i + 1}. En ${c.label}${c.quote ? `, el fragmento: «${String(c.quote).slice(0, 1200)}»` : ''}:`,
    ...(c.kinds ?? []).map((k) => `    - ${ADJUST_KINDS[k] ?? k}`),
    c.note ? `    - en palabras del grupo: ${String(c.note).slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n')).join('\n');
  const out = files
    ? `Escribe cada parte que cambies como su propio archivo JSON en la carpeta «salida»: salida/<id del hito>.json para cada hito que cambies (formato B) y salida/esquema.json SOLO si cambias el esquema (formato A, completo). Sin ${fence} ni texto alrededor. No escribas archivos de las partes que no cambian.`
    : `Responde SOLO con un bloque ${fence}json: { "esquema": null, o el esquema completo (formato A) si cambia, "hitos": [cada hito que cambia, completo, en formato B] }.`;
  return `${COMMON.replace(/\n- Responde SOLO con un bloque [^\n]*$/, '')}${prefsText(prefs)}

Tarea: AJUSTA una guía que ya está escrita. NO la reescribas desde cero: cambia SOLO lo que piden los cambios de abajo; todo lo demás queda igual, palabra por palabra.
- Conserva los ids de hitos y pasos. Si un cambio necesita agregar o quitar un paso, devuelve también el esquema con ese paso (un id nuevo que siga la serie, por ejemplo H2.5) y el hito completo.
- Un cambio en «De qué se trata», las reglas, el reparto o el glosario es un cambio del esquema.
- Si un cambio no se puede hacer sin romper otra parte, haz lo más cercano y dilo en "avisos" del esquema.

Los cambios que pide el grupo:
${list}

${out}

FORMATO A, el esquema:
${A}

FORMATO B, un hito:
${B}

La guía tal como está ahora:
- El esquema: ${JSON.stringify({ ...outline, enunciado_textual: undefined, razonamiento: undefined })}
${chapters.map((h) => `- El hito ${h.id}: ${JSON.stringify(h)}`).join('\n')}`;
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
    de_que_trata: str(o?.de_que_trata, 6000), diagrama: str(o?.diagrama, 4000).replace(/^```(?:mermaid)?\s*|```\s*$/g, '').trim(),
    reglas: { entregables: list(o?.reglas?.entregables, 20).map((x) => str(x, 600)).filter(Boolean), calificacion: list(o?.reglas?.calificacion, 20).map((x) => str(x, 600)).filter(Boolean), modalidad: str(o?.reglas?.modalidad, 600), defensa: str(o?.reglas?.defensa, 1200), fechas: list(o?.reglas?.fechas, 10).map((x) => str(x, 300)).filter(Boolean) },
    razonamiento: str(o?.razonamiento, 6000), enunciado_textual: str(o?.enunciado_textual, 120000),
    partes: list(o?.partes, 8).map((x) => ({ letra: str(x?.letra, 1), resumen: str(x?.resumen, 600) })).filter((x) => letters.includes(x.letra) && x.resumen),
    requisitos: list(o?.requisitos, 80).map((r, i) => ({ id: /^R\d{1,3}$/.test(r?.id) ? r.id : `R${i + 1}`, texto: str(r?.texto, 600), cita: str(r?.cita, 800), peso: str(r?.peso, 30), material: str(r?.material, 300) })),
    glosario: list(o?.glosario, 80).map((g) => ({ termino: str(g?.termino, 80), definicion: str(g?.definicion, 600) })).filter((g) => g.termino),
    hitos,
    avisos: list(o?.avisos, 12).map((a) => str(a, 600)).filter(Boolean),
    preguntas: list(o?.preguntas, 5).map((q) => ({ pregunta: str(q?.pregunta, 400), por_que: str(q?.por_que, 400) })).filter((q) => q.pregunta),
  };
}

export function cleanMilestone(m, milestone) {
  const known = new Set(milestone.pasos.map((p) => p.id));
  const pasos = list(m?.pasos, 40).filter((p) => known.has(p?.id)).map((p) => ({
    id: p.id, objetivo: str(p?.objetivo, 600), clave: str(p?.clave, 400), tu_turno: list(p?.tu_turno, 8).map((x) => str(x, 600)).filter(Boolean), teoria: str(p?.teoria, 8000), diagrama: str(p?.diagrama, 4000).replace(/^```(?:mermaid)?\s*|```\s*$/g, '').trim(),
    codigo: list(p?.codigo, 12).map((c) => ({
      lenguaje: str(c?.lenguaje, 20) || 'python', codigo: str(c?.codigo, 12000),
      lineas: list(c?.lineas, 300).map((l) => ({ n: Number.isInteger(l?.n) ? l.n : 0, explicacion: str(l?.explicacion, 1200) })).filter((l) => l.n > 0),
    })).filter((c) => c.codigo.trim()),
    librerias: list(p?.librerias, 20).map((l) => ({ nombre: str(l?.nombre, 60), para_que: str(l?.para_que, 400) })).filter((l) => l.nombre),
    esperado: str(p?.esperado, 1500),
    // Worked examples (study guides, estudio-prompts.js): the problem and its solution, step by step.
    ejemplos: list(p?.ejemplos, 4).map((x) => ({ enunciado: str(x?.enunciado, 3000), solucion: str(x?.solucion, 8000) })).filter((x) => x.enunciado && x.solucion),
    comprueba: list(p?.comprueba, 4).map((q) => ({ pregunta: str(q?.pregunta, 400), respuesta: str(q?.respuesta, 1500) })).filter((q) => q.pregunta),
    defensa: list(p?.defensa, 5).map((q) => ({ pregunta: str(q?.pregunta, 400), respuesta: str(q?.respuesta, 1500) })).filter((q) => q.pregunta),
    commit: str(p?.commit, 120),
    reunion: str(p?.reunion, 300),
  }));
  if (!pasos.length) throw new Error(`La respuesta de tu IA no trae los pasos del hito ${milestone.id}.`);
  return { id: milestone.id, pasos };
}
