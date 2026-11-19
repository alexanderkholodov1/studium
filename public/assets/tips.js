// The student guide's tips: advice, never orders. Studium suggests what to consider and the student decides; where a
// rule is the university's, the tip says so and names where it comes from. Written to be understood on first reading:
// short sentences, every term explained the first time, steps as points (lines starting with «• »). Each tip has its
// idea in a few words (key), said big, and the detail one tap away.
export const SOURCE = 'Manual del Estudiante de Grado USFQ (abril de 2023)';

export const TOPICS = {
  inscripcion: { name: 'Inscribirte', color: 'blue' },
  horario: { name: 'Armar tu horario', color: 'red' },
  carrera: { name: 'Tu carrera', color: 'teal' },
};

export const TIPS = [
  { id: 'como', topic: 'inscripcion', icon: 'clock', key: 'Cada uno tiene su turno para inscribirse',
    title: 'Cómo es la inscripción',
    body: 'No todos se inscriben al mismo tiempo. Banner, el sistema de la U (lo abres desde MiUSFQ), le da a cada estudiante un día y una hora.\n• El día depende de cuántos créditos llevas: los que ya aprobaste más los que estás cursando.\n• La hora depende de tus notas: Banner usa el promedio entre tu GPA de toda la carrera y tu GPA del último semestre.\n• Tu día y tu hora aparecen en MiUSFQ unos días antes. Ahí también ves si tienes algo que te impide inscribirte.',
    source: 'pág. 79–81' },
  { id: 'antes', topic: 'inscripcion', icon: 'check', key: 'Tres cosas antes de tu turno',
    title: 'Qué necesitas para poder inscribirte',
    body: 'Si falta una, Banner no te deja inscribirte:\n• Haber pagado la matrícula del semestre.\n• No tener deudas ni trámites pendientes con la U.\n• Haber llenado la evaluación de tus profes del semestre. Al terminarla, la inscripción se desbloquea sola.\nRevísalo unos días antes, no en tu hora.',
    source: 'pág. 79–80' },
  { id: 'nrc', topic: 'inscripcion', icon: 'layers', key: 'Te inscribes con números, no con nombres',
    title: 'El NRC de cada clase',
    body: 'Cada paralelo de una materia tiene su número, el NRC. En la inscripción pones esos números, uno por uno.\n• Si la materia tiene ejercicios o laboratorio, cada parte tiene su propio NRC: son dos o tres números.\n• Prepara esa lista antes de tu hora. Studium te la da en Excel desde tu borrador.\n• Ten también uno o dos de repuesto, por si un paralelo se llena.',
    source: 'pág. 35' },
  { id: 'grupo', topic: 'inscripcion', icon: 'link', key: '«+ Ej» quiere decir dos clases que van juntas',
    title: 'Teoría con ejercicios o laboratorio',
    body: 'Una materia como «Cálculo Integral + Ej» son dos clases: la teoría y los ejercicios. Tienes que inscribirte en las dos.\n• No cualquier par sirve: los ejercicios deben ser del mismo grupo que tu teoría. Studium te marca cuáles son «de tu grupo».\n• Cuentan como una sola materia: si repruebas los ejercicios, por lo general repruebas la materia entera. El syllabus dice cuánto vale cada parte.',
    source: 'pág. 51–52' },
  { id: 'oferta', topic: 'inscripcion', icon: 'search', key: 'Copia la lista de horarios y pégala en Studium',
    title: 'Cómo usar la Oferta de cursos',
    body: 'La Oferta de cursos es la página de la U donde aparecen todos los horarios de cada materia.\n• Busca la materia por su código, por ejemplo MAT-1202.\n• Selecciona y copia la lista que aparece (Ctrl+A y Ctrl+C sirve).\n• Pégala en «Preparar mi inscripción». Studium te muestra todos los horarios y eliges uno con un clic.',
    link: 'https://catalogodecursos.usfq.edu.ec/' },
  { id: 'periodo', topic: 'inscripcion', icon: 'calendar', key: '202610, 202620, 202630: qué semestre es',
    title: 'Los números de los semestres',
    body: 'La U nombra cada semestre con seis números: el año en que empieza y un número al final.\n• 202610: Primer Semestre, de agosto a diciembre de 2026.\n• 202620: Segundo Semestre, de enero a mayo de 2027.\n• 202630: Verano, de fines de mayo a fines de julio de 2027.' },
  { id: 'creditos', topic: 'horario', icon: 'credit', key: 'Te sobra un crédito que ya pagaste',
    title: 'Los créditos del semestre',
    body: 'Lo que pagas cada semestre incluye 16 créditos. Lo normal son 5 materias de 3 créditos: 15. Así que te queda uno.\n• Si quieres, puedes usarlo en una materia de 1 crédito de tu malla, como Deportes o Cultura Gastronómica.\n• Si la tomas en verano, se paga aparte.' },
  { id: 'horas', topic: 'horario', icon: 'clock', key: 'Las clases terminan 10 minutos antes',
    title: 'Las horas de clase',
    body: 'Las clases empiezan cada hora y media desde las 7:00: 7:00, 8:30, 10:00 y así. Cada una termina 10 minutos antes de la siguiente (8:30 a 9:50, por ejemplo). Esos 10 minutos son para cambiarte de edificio.',
    source: 'pág. 68' },
  { id: 'elegir', topic: 'horario', icon: 'map', key: 'Mira la hora, el profe y el lugar',
    title: 'Antes de elegir un horario',
    body: 'Tres cosas que se pasan fácil:\n• Que no sea un paralelo de Galápagos.\n• Cultura Gastronómica y otras empiezan en otra fecha que el semestre.\n• Algunos paralelos no están abiertos para todos: la Oferta de cursos lo dice en «Clases excluidos», y Studium te avisa.' },
  { id: 'primero', topic: 'horario', icon: 'star', key: 'En primer año hay reglas propias',
    title: 'Si estás en primer año',
    body: '• Tu primer semestre viene con el horario ya armado y no se puede cambiar.\n• Durante el primer año solo tomas materias cuyo código empieza en 1 o 2 (por ejemplo MAT-1202).\n• Las materias en línea se abren desde el segundo año.',
    source: 'pág. 17, 80' },
  { id: 'despues', topic: 'horario', icon: 'check', key: 'Después de inscribirte, guarda una copia',
    title: 'Después de inscribirte',
    body: '• Revisa tu horario final en Banner y guarda una captura: si algo sale mal, es tu prueba.\n• El primer día de clases, confirma que tu nombre está en la lista de cada profe. Si no estás, el profe no te puede poner notas.',
    source: 'pág. 81' },
  { id: 'minor', topic: 'carrera', icon: 'layers', key: 'Tus optativas pueden ser un minor',
    title: 'Los minors',
    body: 'Un minor es un grupo de 5 o 6 materias de otra área (de 15 a 18 créditos). Al graduarte te dan un certificado que lo dice.\n• En muchas mallas hay 3 optativas y 2 electivas generales: cinco materias, justo lo que pide un minor.\n• Si las eliges con intención, puedes salir con un minor sin estudiar más semestres.\n• Lo declaras al pedir tu graduación. Puedes tener hasta dos.',
    source: 'pág. 39–40' },
  { id: 'ayuda', topic: 'carrera', icon: 'help', key: 'Hay una oficina para ayudarte a elegir',
    title: 'Quién te puede ayudar',
    body: '• Consejería Académica te ayuda a elegir materias y armar tu horario, sobre todo en primer semestre: consejeriaacademica@usfq.edu.ec.\n• Para trámites de inscripción, la oficina OASA.',
    source: 'pág. 34' },
];
export const tipLink = (id) => `#/guia-estudiante/${id}`;
