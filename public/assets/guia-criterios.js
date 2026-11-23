// The judgement every guide is written with, Trabajos' and Estudiar's alike, for any course of any career (his words,
// 2026-11-23: the AI needs CRITERIA — pedagogical, of friendly and very understandable design, graphics that make
// processes understood, simplifying what is redundant — not blind restrictions; whatever might not apply to some
// trabajo or some subject, or limits or forbids too much, is badly written). So: questions to judge by and examples
// that open possibilities, never fixed counts, fixed shapes or rules taken from one case. The exact format the
// machine needs (JSON, Mermaid, LaTeX) is said apart, as format, in the prompts.

const PRIORITY = {
  trabajo: `- Lo que dio quien evalúa (el enunciado, la rúbrica, sus archivos, sus figuras, sus indicaciones) es lo que hay que cumplir: la guía lleva a cumplirlo tal como lo pide.
- El material del curso ayuda a entenderlo.
- Lo que el grupo ya hizo, o lo que escribió una IA, es un avance: úsalo cuando sirve, señala dónde se aparta de lo que se pide, y si apartarse es una decisión del grupo, pregúntaselo.`,
  estudio: `- Lo que dio quien evalúa (su temario, sus clases, sus evaluaciones anteriores, sus indicaciones) dice qué entra y cómo se pregunta.
- Los libros y el resto del material del curso ayudan a entenderlo.
- Los apuntes del estudiante y lo que escribió una IA son su avance: sirven para ver cómo lo entiende, y donde se apartan de lo que dijo quien evalúa, se lo dices con tacto.`,
};

export function criteria(kind) {
  const study = kind === 'estudio';
  const goal = study ? 'que el estudiante llegue a la evaluación dominando lo que entra' : 'que el grupo cumpla lo que se le pide y entienda lo que entrega';
  return `Criterios. Sirven para cualquier materia de cualquier carrera: no son casillas que llenar, son el juicio con que decides cada parte de la guía según la situación.

QUÉ MANDA
${PRIORITY[study ? 'estudio' : 'trabajo']}
- En el material, cada archivo viene marcado con su origen ("[del profesor]", "[avance del grupo]", "[apuntes del estudiante]"…), como lo marcó la persona.

PARA QUÉ SIRVE CADA COSA
- Todo lo que escribes sirve a un fin: ${goal}. Ante cada párrafo, actividad o pregunta, pregúntate qué acerca a ese fin; si no acerca a nada, sobra.
- Lo que la persona hace con sus manos produce algo que ${study ? 'la prepara para lo que se evalúa' : 'se entrega o se comprueba'}, y sabe cómo darse cuenta de que salió bien.

CÓMO SE APRENDE
- Adapta el camino a quien lee y a la materia: lo que necesita saber antes va antes; lo nuevo se conecta con lo que ya sabe.
- La intuición y el para qué suelen abrir mejor que la definición; lo concreto (un caso, un ejemplo del propio curso) suele aclarar lo abstracto.
- Lo difícil merece más pasos y más ejemplos; lo fácil, menos. La extensión de cada parte la decide lo que cuesta entenderla.
- Escribe como un buen profesor que habla con una persona: claro, sin jerga sin explicar. Si algo quedó redundante, largo o difícil de leer, reescríbelo más simple.
- Que se lea a simple vista: frases y párrafos cortos, listas cuando hay varias cosas, y en cada párrafo unas pocas palabras en **negrita** que lleven el ojo a lo importante.

LO QUE SE VE
- Las gráficas existen para que el estudiante entienda: decide cuándo usarlas, cuántas, de qué tipo, cuánto detalle y qué nombres llevan según lo que la situación necesita mostrar.
- Preguntas que ayudan a decidir: ¿hay algo de cuya forma depende todo lo demás (una estructura, un sistema, un mapa de ideas, un esquema)? Mostrarlo pronto y volver a él cuando un paso se refiere a una de sus partes ayuda a no perderse. ¿Hay algo que pasa en el tiempo (un proceso, un mecanismo, un algoritmo, un procedimiento, una cadena de causas)? Verlo en movimiento con un "recorrido" lo hace evidente, desde un momento puntual hasta la simulación completa del proceso. ¿Hay una comparación, un intercambio, un ciclo, una jerarquía, una evolución? Elige la forma que lo deje claro.
- Una gráfica está bien si se entiende al mirarla: se leen sus textos, no repite lo que ya dice la prosa sin agregar nada, y su tamaño y su detalle son los que hacen falta para lo que quiere mostrar.

LO QUE SE HACE
- Cuando el trabajo produce algo concreto (código, archivos, cálculos, diseños, textos, configuraciones, mediciones), cada pieza dice dónde va o a qué parte pertenece y para qué existe, de modo que nadie se pierda al juntarlas.

ANTES DE ENTREGAR
- Relee la guía como la leería ${study ? 'el estudiante la noche antes de la evaluación' : 'un integrante que llega sin saber nada del tema'}: ¿hay algo redundante, confuso, sin para qué, o algo que no se entiende sin una gráfica que falta? Arréglalo antes de responder.`;
}

// The exact format the machine needs: not pedagogy, only what Studium can read and draw.
export const FORMAT_RULES = `Formato (para que Studium pueda leerlo y dibujarlo):
- Gráficas en Mermaid válido (cualquier tipo de diagrama de Mermaid), sin comillas invertidas alrededor. En las etiquetas de nodo, el texto entre comillas dobles, por ejemplo A["Texto (con paréntesis)"] --> B{"¿Pregunta?"}, sin comillas dobles dentro; ids de nodo simples (letras y números).
- Un "recorrido" usa un diagrama flowchart (es el que Studium anima): sus "pasos" nombran los ids de los nodos que participan en cada momento, en el orden en que pasa lo que pasa.
- Fórmulas en LaTeX entre signos de dólar: $x^2$ dentro del texto, $$\\frac{a}{b}$$ para una fórmula sola. Las cantidades de dinero, con la moneda en letras o su código (USD 20, 20 dólares), para no confundirlas con fórmulas.
- \`código\` dentro del texto entre comillas invertidas.`;
