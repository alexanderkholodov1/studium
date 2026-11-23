// The judgement every guide is written with, Trabajos' and Estudiar's alike (his words, 2026-11-23: the AI needs
// CRITERIA to follow — pedagogical, of friendly and very understandable design, graphics that strengthen the
// understanding of processes, simplifying what is redundant or hard to read — not blind restrictions). The prompts
// add only what is particular to their kind and the exact format; the reasons live here, once.

const PRIORITY = {
  trabajo: `1. Lo que dio el PROFESOR (el enunciado, la rúbrica, sus archivos de inicio, sus figuras) manda siempre. La guía cumple exactamente lo que pide, con sus nombres de archivos, comandos, direcciones y formatos.
2. El material del curso, como apoyo.
3. Lo que ya hizo el grupo, o archivos que escribió una IA: son un AVANCE, no la verdad. Úsalos si cumplen el enunciado; si se apartan de él, dilo, sigue al enunciado y, si la diferencia es una decisión del grupo, pregúntala en "preguntas".`,
  estudio: `1. Lo que dio el PROFESOR (su temario, sus diapositivas, sus exámenes anteriores, sus deberes) marca qué entra y cómo se pregunta.
2. El libro y el material del curso, como apoyo.
3. Los apuntes del estudiante y cualquier texto escrito por una IA: son su avance, útil para saber cómo lo entiende, pero no la verdad. Si contradicen al profesor, sigue al profesor y dilo con tacto.`,
};
// Studium marks each file the person brought with who made it («del profe», «nuestro avance»…).
const LABELS = 'En el material, cada archivo viene marcado con su origen ("[del profesor]", "[avance del grupo]", "[apuntes del estudiante]"…), como lo marcó la persona.';

export function criteria(kind) {
  const study = kind === 'estudio';
  const goal = study ? 'que el estudiante resuelva solo las preguntas del examen' : 'que el grupo entregue lo que pide el enunciado y lo defienda entendiendo cada parte';
  return `Criterios (no son casillas que llenar: son el juicio con que decides cada párrafo, cada diagrama y cada actividad).

QUÉ MANDA
${PRIORITY[study ? 'estudio' : 'trabajo']}
${LABELS}

PARA QUÉ SIRVE CADA COSA
- Todo lo que escribes sirve a un fin: ${goal}. Antes de poner una actividad, una pregunta o un párrafo, pregúntate a qué ${study ? 'parte del examen' : 'requisito o parte del entregable'} acerca. Si no acerca a nada, no va: nada de tareas de relleno (copiar a mano algo que ya está hecho, repetir lo que otro paso ya hizo, "explícaselo a un compañero" sin propósito).
- Lo que el estudiante hace con sus manos produce algo que ${study ? 'se evalúa' : 'se entrega o se comprueba'}, y dice cómo saber que salió bien.

CÓMO SE APRENDE
- Primero la intuición y el para qué, después el detalle. Una idea nueva a la vez, explicada antes de usarse y conectada con la anterior.
- Lo concreto antes que lo abstracto: un ejemplo real del propio trabajo o del propio curso vale más que una definición.
- Lo difícil se parte en pasos pequeños; lo fácil no se alarga.
- Escribe como un profesor paciente que habla con una persona: frases cortas, prosa clara, sin jerga sin explicar. Si un párrafo se puede decir con la mitad de palabras, dilo con la mitad. Si algo te quedó redundante o difícil de leer, reescríbelo más simple.
- Que se lea a simple vista: párrafos de 1 a 3 frases, listas cuando hay varias cosas, y en cada párrafo 1 a 3 palabras en **negrita** que lleven el ojo a lo importante (nunca una frase entera).

LO QUE SE VE
- Si el material tiene una figura (una topología de red, un circuito, una arquitectura, un diagrama de clases, un mapa), la guía la DIBUJA al principio, con los mismos nombres e interfaces que usa el profesor, porque todo lo demás se refiere a ella. Cuando un paso habla de una parte de esa figura ("la interfaz eth1 de borde"), su diagrama la muestra en su lugar.
- Cada diagrama explica UNA idea y elige la forma que la hace evidente: la estructura (qué hay y cómo está conectado) como un grafo pequeño; un intercambio de mensajes como una secuencia; un proceso que avanza como un recorrido animado ("recorrido": cómo viaja un paquete, cómo se aplica una configuración comando por comando, cómo corre un algoritmo). Nada de diagramas que intentan meter TODO el proceso en una sola caja de cajas.
- Pocos nodos (de 3 a 8), etiquetas cortas (de 1 a 4 palabras; el detalle va en el texto), sin repetir en el diagrama lo que ya dice la prosa.
- Mermaid válido: cada etiqueta entre comillas dobles, por ejemplo A["Borde (eth1)"] --> B{"¿Llega?"}; nunca comillas dobles dentro de una etiqueta; ids de nodo simples (letras y números).

EL CÓDIGO Y LOS ARCHIVOS
- Cada pieza de código dice a qué archivo pertenece, con su ruta tal como queda en la carpeta ("lab/topologia.yml"), o que es un comando de la terminal; y en una frase qué es ese archivo y para qué existe. Su "lenguaje" es el real (yaml, bash, python, cisco…), nunca "text".

ANTES DE ENTREGAR
- Relee la guía como la leería ${study ? 'el estudiante la noche antes del examen' : 'un integrante que no sabe nada del tema'}: ¿hay algo redundante, confuso, sin para qué, o una figura que falta para entender? Arréglalo antes de responder.`;
}
