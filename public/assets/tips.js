// The student guide's tips: advice, never orders. Studium suggests what to consider and the student decides; where a
// rule is the university's, the tip says so and names where it comes from. The same tips appear in their page (#/guia-estudiante)
// and, one at a time, next to the thing they talk about (hints.js), with a link to read them whole.
export const SOURCE = 'Manual del Estudiante de Grado USFQ (actualizado a abril de 2023)';

export const TIPS = [
  { id: 'periodo', topic: 'inscripcion', title: 'Qué significan 202610, 202620 y 202630',
    body: 'El periodo se escribe con seis cifras: el año en que empieza el año académico y el periodo. 202610 es el Primer Semestre (agosto a diciembre), 202620 el Segundo Semestre (enero a mayo) y 202630 el Verano (de fines de mayo a fines de julio).' },
  { id: 'como', topic: 'inscripcion', title: 'Cómo es la inscripción',
    body: 'Te inscribes durante el semestre anterior, en Banner (MiUSFQ), con tu ID de estudiante y tu clave. Banner te da un día y una hora: el día según los créditos que llevas (los aprobados y los que cursas), y la hora según tu GPA ponderado, el promedio de tu GPA acumulado y el del último semestre. Puedes ver tu día, tu hora y si tienes alguna retención en MiUSFQ, en el resumen de tu estatus.',
    source: 'pág. 79–81' },
  { id: 'antes', topic: 'inscripcion', title: 'Qué te habilita para inscribirte',
    body: 'Tener pagada la matrícula y los aranceles, no tener retenciones de ningún tipo y haber hecho la evaluación de tus profes y cursos del semestre. La inscripción se desbloquea sola cuando completas las evaluaciones en MiUSFQ. Conviene revisarlo unos días antes, no en tu hora.',
    source: 'pág. 79–80' },
  { id: 'nrc', topic: 'inscripcion', title: 'Un NRC a la vez',
    body: 'Cada paralelo tiene su número, el NRC, y cada uno se agrega por separado: la teoría, sus ejercicios, su laboratorio. Considera tener lista la de tu borrador (la descargas en Excel) y alguna alternativa por si un paralelo se llena.',
    source: 'pág. 35' },
  { id: 'grupo', topic: 'inscripcion', title: 'Teoría con ejercicios o laboratorio',
    body: 'Las materias con «+ Ej» o «+ Lab» tienen dos partes, cada una con su NRC. Van juntas: en la Oferta de cursos comparten el mismo grupo («Agrupado con»), y Studium te marca cuáles son «de tu grupo». Cuentan como una sola materia: si te quedas en los ejercicios o el laboratorio, por lo general te quedas también en la teoría. Mira en el syllabus cómo pesa cada parte.',
    source: 'pág. 51–52' },
  { id: 'oferta', topic: 'inscripcion', title: 'Cómo usar la Oferta de cursos',
    body: 'En la Oferta de cursos busca por código (por ejemplo, MAT-1202), copia el resultado, una clase o la página entera, y pégalo en «Preparar la inscripción». Eliges el paralelo sin escribir nada. Si la búsqueda tiene varias páginas, puedes pegarlas una tras otra.',
    link: 'https://catalogodecursos.usfq.edu.ec/' },
  { id: 'creditos', topic: 'horario', title: 'El crédito que suele sobrar',
    body: 'El semestre incluye 16 créditos y lo usual son 15, cinco materias de 3. Así que suele sobrar uno que ya está pagado. Si quieres, puedes aprovecharlo con una materia de 1 crédito de tu malla, como Deportes o Cultura Gastronómica; fuera del semestre, esas se pagan por crédito.' },
  { id: 'horas', topic: 'horario', title: 'Las horas de clase',
    body: 'Las clases empiezan cada hora y media desde las 7:00 y terminan diez minutos antes del siguiente bloque: 8:30 a 9:50, 10:00 a 11:20, y así. Esos diez minutos son para moverte de un edificio a otro.',
    source: 'pág. 68' },
  { id: 'elegir', topic: 'horario', title: 'Antes de elegir un paralelo',
    body: 'Mira la hora, el profe y el lugar. Que no sea un paralelo de Galápagos; que materias como Cultura Gastronómica empiezan en otra fecha que el semestre; y que los idiomas van en dos módulos por semestre.' },
  { id: 'primero', topic: 'horario', title: 'Si estás en primer año',
    body: 'Tu primer semestre viene con el horario armado según tu malla, y no se cambia. Después, en primer año se toman materias cuyo código empieza en 1 o 2, y todavía no se pueden tomar cursos en línea; eso se abre desde el segundo año.',
    source: 'pág. 17, 80' },
  { id: 'despues', topic: 'horario', title: 'Después de inscribirte',
    body: 'Revisa tu horario definitivo en Banner y guarda una copia: es tu respaldo si algo sale mal. El primer día de clases, confirma que tu nombre está en la lista oficial de cada curso; si no está, no te pueden poner notas.',
    source: 'pág. 81' },
  { id: 'ayuda', topic: 'horario', title: 'Quién te puede ayudar',
    body: 'La Oficina de Consejería Académica ayuda a elegir materias y a planificar el horario, sobre todo en primer semestre: consejeriaacademica@usfq.edu.ec. Para trámites de registro, la oficina OASA.',
    source: 'pág. 34' },
];
export const TOPICS = { inscripcion: 'Inscribirte', horario: 'Armar tu horario' };
export const tipLink = (id) => `#/guia-estudiante/${id}`;
