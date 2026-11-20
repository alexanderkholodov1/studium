// The student guide's tips: advice, never orders. Studium suggests what to consider and the student decides; where a
// rule is the university's, the tip says so and names where it comes from. Written to be understood on first reading:
// short sentences, every term explained the first time, steps as points (lines starting with «• »), the words that
// matter in **bold**. Each tip has its idea in a few words (key), said big, and the detail one tap away.
// Sources: the Manual del Estudiante de Grado USFQ (abril de 2023), page by page; USFQ's own pages (cite + url); the
// course offering itself (Cursos y horarios disponibles), read on 2026-11-20.
export const SOURCE = 'Manual del Estudiante de Grado USFQ (abril de 2023)';

export const TOPICS = {
  inscripcion: { name: 'Inscribirte', color: 'blue' },
  horario: { name: 'Armar tu horario', color: 'red' },
  notas: { name: 'Tus notas y tu GPA', color: 'butter' },
  carrera: { name: 'Tu carrera', color: 'teal' },
  vida: { name: 'Reglas, ayudas y prácticas', color: 'peach' },
};

export const TIPS = [
  /* ---------- inscribirte ---------- */
  { id: 'como', topic: 'inscripcion', icon: 'clock', key: 'Tu turno: un día y una hora', title: 'Cuándo te inscribes',
    body: 'No todos se inscriben a la vez: **Banner** (el sistema de la U, desde MiUSFQ) te da un día y una hora.\n• **El día** sale de tus créditos: los aprobados más los que estás cursando.\n• **La hora** sale de tu **GPA ponderado**: el promedio entre tu GPA acumulado y el de tu último semestre. Mejor GPA, hora más temprana.\n• Tu día y tu hora aparecen en MiUSFQ cuando se abre el registro, junto con lo que te impida inscribirte.',
    source: 'pág. 79' },
  { id: 'antes', topic: 'inscripcion', icon: 'check', key: 'Tres cosas antes de tu turno', title: 'Qué necesitas para inscribirte',
    body: 'Si falta una, Banner no te deja:\n• **Matrícula pagada** del semestre.\n• **Sin deudas** ni trámites pendientes con la U.\n• **La evaluación de tus profes**, llena. Al terminarla, la inscripción se desbloquea sola.\nRevísalo unos días antes, no en tu hora.',
    source: 'pág. 79–80' },
  { id: 'nrc', topic: 'inscripcion', icon: 'layers', key: 'Te inscribes con números (NRC)', title: 'El NRC de cada clase',
    body: 'Cada paralelo de una materia tiene su número, el **NRC**. En la inscripción pones esos números.\n• Si la materia tiene ejercicios o laboratorio, **cada parte tiene su NRC**: son dos o tres números.\n• Prepara la lista antes de tu hora; Studium te la da desde tu borrador.\n• Ten uno o dos **de repuesto**, por si un paralelo se llena.',
    source: 'pág. 35' },
  { id: 'grupo', topic: 'inscripcion', icon: 'link', key: '«+ Ej»: teoría y ejercicios, misma letra', title: 'Teoría con ejercicios o laboratorio',
    visual: 'grupo',
    body: '«Cálculo Integral + Ej» son **dos clases**: la teoría y los ejercicios, y te inscribes en las dos.\n• No cualquier par sirve. En Cursos y horarios cada una dice **«Agrupado con | XC | | XD |»**: van juntas **las que tienen las mismas letras**.\n• Ejemplo real (202610): la teoría del paralelo 1 (NRC 3730, lunes y miércoles 10:00) dice «| XC | | XD |»; los ejercicios del paralelo 8 (NRC 3735, jueves 16:00) también. Esa es la pareja.\n• Los ejercicios suelen valer **0 créditos**: los créditos van en la teoría.\n• Studium te marca cuáles son «de tu grupo» al armar tu horario.',
    cite: 'Cursos y horarios disponibles, USFQ (leído el 20-11-2026)', url: 'https://catalogodecursos.usfq.edu.ec/' },
  { id: 'oferta', topic: 'inscripcion', icon: 'search', key: 'Cómo usar Cursos y horarios', title: 'Cursos y horarios disponibles',
    body: 'Es la página de la U con **todos los paralelos** del semestre (entras con tu cuenta USFQ).\n• Elige el **Periodo** (por ejemplo 202620) y, si quieres, el Colegio, el Área, el Lugar, los Días o la Hora.\n• En **Buscar** escribe el nombre de la materia (por ejemplo «Cálculo Integral») y pulsa **Actualizar Cursos**.\n• Cada fila dice código, **NRC**, paralelo, **horario**, edificio y aula, profesor, créditos, **cupos e inscritos**, y restricciones.\n• Las casillas de arriba muestran solo cursos en inglés, «Writing Intensive» o **con cupo**.\n• Copia los resultados y pégalos en «Preparar mi inscripción»: Studium los ordena y eliges con un clic.',
    cite: 'Cursos y horarios disponibles, USFQ (leído el 20-11-2026)', url: 'https://catalogodecursos.usfq.edu.ec/' },
  { id: 'periodo', topic: 'inscripcion', icon: 'calendar', key: '202610, 202620, 202630', title: 'Los números de los semestres',
    body: 'Cada semestre tiene seis números: el año en que empieza y uno al final.\n• **202610**: Primer Semestre, agosto a diciembre de 2026.\n• **202620**: Segundo Semestre, enero a mayo de 2027.\n• **202630**: Verano, fines de mayo a fines de julio de 2027.',
    cite: 'Cursos y horarios disponibles, USFQ', url: 'https://catalogodecursos.usfq.edu.ec/' },

  /* ---------- armar tu horario ---------- */
  { id: 'creditos', topic: 'horario', icon: 'credit', key: 'Entre 12 y 16 créditos', title: 'Los créditos del semestre',
    body: 'En Cumbayá tomas **entre 12 y 16 créditos** por semestre. **Con beca o asistencia financiera, el mínimo es 15**.\n• Lo normal son 5 materias de 3 créditos: 15. Si quieres, te queda espacio para una de 1 crédito (Deportes, Cultura Gastronómica).\n• Un crédito es **1 hora de clase y unas 2 de trabajo por tu cuenta** a la semana: 15 créditos son unas 45 horas.',
    source: 'pág. 35, 64' },
  { id: 'horas', topic: 'horario', icon: 'clock', key: 'Las clases terminan 10 minutos antes', title: 'Las horas de clase',
    body: 'Las clases empiezan cada hora y media desde las 7:00 (7:00, 8:30, 10:00…) y terminan **10 minutos antes** de la siguiente: tiempo para cambiar de edificio.',
    source: 'pág. 68' },
  { id: 'elegir', topic: 'horario', icon: 'map', key: 'Mira la hora, el profe y el lugar', title: 'Antes de elegir un paralelo',
    body: 'Tres cosas que se pasan fácil:\n• Que no sea un paralelo de **Galápagos** u otra ciudad (columna Lugar).\n• Algunas materias **empiezan en otra fecha** que el semestre.\n• Algunos paralelos son solo para ciertas carreras: lo dice la columna **Restricciones**, y Studium te avisa.' },
  { id: 'primero', topic: 'horario', icon: 'star', key: 'Primer año: reglas propias', title: 'Si estás en primer año',
    body: '• Tu **primer semestre viene con el horario armado** y no se puede cambiar.\n• En primer año tomas materias cuyo código empieza en **1 o 2**.\n• Las materias en línea se abren desde el segundo año.',
    source: 'pág. 17, 79–80' },
  { id: 'despues', topic: 'horario', icon: 'check', key: 'Inscrito: guarda una copia', title: 'Después de inscribirte',
    body: '• Revisa tu horario en Banner y **guarda una captura**: si algo sale mal, es tu prueba.\n• El primer día, confirma que estás **en la lista de cada profe**. Si no estás, no te puede poner notas.',
    source: 'pág. 67, 81' },

  /* ---------- tus notas y tu GPA ---------- */
  { id: 'escala', topic: 'notas', icon: 'star', key: 'A, B, C, D, F: qué vale cada una', title: 'La escala de notas',
    visual: 'escala',
    body: '• **A** (sobresaliente): 91 a 100 % · vale 4.\n• **B** (bueno): 81 a 90,99 % · vale 3.\n• **C** (regular): 71 a 80,99 % · vale 2.\n• **D** (deficiente): 61 a 70,99 % · vale 1.\n• **F** (no aprueba): 60,99 % o menos · vale 0. **N** (dejaste de ir sin retirarte) también vale 0.\nUn profe puede usar otra escala si **está en el syllabus**. Las notas P, W, R, I y H **no cuentan** en el GPA.',
    source: 'pág. 48–49' },
  { id: 'gpa', topic: 'notas', icon: 'credit', key: 'Calcula tu GPA', title: 'Cómo se calcula el GPA',
    visual: 'calc',
    body: 'Cada materia te da **puntos = valor de la nota × créditos** (una B de 3 créditos: 3 × 3 = 9).\n• **Promedio del semestre**: suma de puntos del semestre ÷ créditos del semestre.\n• **GPA acumulado**: suma de todos tus puntos ÷ todos tus créditos. Por eso, cuantos más créditos llevas, **más cuesta moverlo**.\nPruébalo arriba con tus materias.',
    source: 'pág. 49–50' },
  { id: 'minimo', topic: 'notas', icon: 'check', key: 'GPA mínimo: 2,00', title: 'El GPA que te piden',
    body: '• Toda la U pide **al menos 2,00/4,00** acumulado. Por debajo entras en **condición académica**: reuniones obligatorias con Consejería y reglas extra.\n• Con **1,00 o menos** (desde tu segundo periodo), **te separan** de la U.\n• Algunas carreras piden más: **3,00** Medicina, Odontología, Veterinaria y Jurisprudencia; **2,50** Arquitectura y Diseño de Interiores.\n• Una segunda carrera pide **2,80** (Derecho, 3,00).',
    source: 'pág. 46, 50, 93' },
  { id: 'nota', topic: 'notas', icon: 'star', key: 'Tu carrera pide C o más', title: 'La nota mínima para aprobar',
    body: '• Las materias **de tu carrera** se aprueban con **C o más**; algunas carreras piden más.\n• Las de **Colegio General** aceptan **D**, salvo si esa materia también es de tu malla.\n• **Escritura Académica (ESP 1001)** pide C, y se toma en la USFQ.\n• **Inglés (ESL)** pide P o C.\n«Mi malla» te dice qué nota pide cada prerrequisito.',
    source: 'pág. 51' },
  { id: 'repetir', topic: 'notas', icon: 'layers', key: 'Máximo tres veces la misma materia', title: 'Repetir una materia',
    body: '• Puedes registrarte **dos veces** en una materia sin pedir permiso.\n• La **tercera** necesita autorización del Decano de Grado (MiUSFQ/Banner/Alumnos/Solicitud Tercera Matrícula), y **puede negarla**.\n• **No hay cuarta**: lo dice la ley (LOES).\n• Un **retiro con W** no cuenta como matrícula; solo se admiten dos retiros de la misma materia.',
    source: 'pág. 48–49, 52' },
  { id: 'honores', topic: 'notas', icon: 'star', key: 'Listas de Honor: 3,50 y 3,70', title: 'Reconocimientos por tus notas',
    body: 'Si tomas la carga completa de tu malla:\n• **Lista de Honor del Canciller**: promedio del semestre de **3,70 o más**.\n• **Lista de Honor del Decano**: de **3,50 a 3,69**.\nSe publican desde la tercera semana del semestre siguiente.\n• **Mejor graduado** de cada promoción: entre los mejores promedios, **sin haber reprobado, repetido ni retirado** ninguna materia.',
    source: 'pág. 50–51' },
  { id: 'society', topic: 'notas', icon: 'star', key: 'Honor Society: pregunta la convocatoria', title: 'Honor Society USFQ',
    body: 'La U tiene un **Honor Society Program** que, según su página, reconoce «el compromiso académico, el liderazgo y la participación activa».\n• Sus requisitos **dependen de cada convocatoria**; la página no da un GPA mínimo y la única fecha publicada fue **abril de 2026**.\n• Para saber cuándo abre la próxima, pregunta en el **Decanato de Estudiantes**: decanatoestudiantes@usfq.edu.ec.',
    cite: 'Honor Society Program, usfq.edu.ec (leído el 20-11-2026)', url: 'https://www.usfq.edu.ec/es/honor-society-program' },

  /* ---------- tu carrera ---------- */
  { id: 'malla', topic: 'carrera', icon: 'map', key: 'Tu malla es una guía, no una jaula', title: 'El orden de tu malla',
    body: 'El orden de tu malla es una **sugerencia**: puedes tomar cualquier materia **cuyos prerrequisitos cumplas**.\n• Si una se cruza o no se abre, puede convenirte adelantar otra.\n• En **«Mi malla»** marcas lo que aprobaste y ves qué ya puedes tomar y qué te falta.',
    cite: 'La malla publicada por la U' },
  { id: 'ingles', topic: 'carrera', icon: 'check', key: 'Inglés: hasta el nivel 6 (B2)', title: 'El requisito de inglés',
    body: '• La U pide **suficiencia hasta el nivel 6** de inglés (ESL), que equivale a **B2**.\n• En la orientación rindes un **examen de ubicación**. También valen **TOEFL iBT, IELTS o Cambridge** de hasta **dos años** de antigüedad.\n• El nivel 6 es prerrequisito de **Writing and Rhetoric** y de las **materias «E»**: si lo dejas para tarde, **puede retrasar tu graduación**.\n• Los niveles ESL no dan créditos; puedes tomar hasta dos por semestre.',
    source: 'pág. 35–38' },
  { id: 'requisitos', topic: 'carrera', icon: 'check', key: 'Lo que la U pide a todos', title: 'Requisitos que se olvidan fácil',
    body: 'Además de tu malla, conviene revisarlos con tiempo:\n• **Una materia en inglés**: código terminado en **E** (pide Inglés Nivel 6).\n• **Writing and Rhetoric** (ENG 1001E), obligatoria para todos.\n• **PASEC** (servicio comunitario) y **PASEM** (prácticas).\nLo de tu carrera está en «Mi malla», en «Requisitos de tu carrera».',
    source: 'pág. 36–38, 95–98' },
  { id: 'doble', topic: 'carrera', icon: 'link', key: 'Una materia, dos requisitos', title: 'Requisitos que se combinan',
    body: 'Una materia en inglés («E») puede ser también una de **Colegio General** (Humanidades, Ciencias Sociales). **Ojo**: si una materia de tu carrera cumple un requisito de Colegio General, sus créditos **cuentan una sola vez** y te faltarán créditos que completar con otra.',
    source: 'pág. 35, 51' },
  { id: 'minor', topic: 'carrera', icon: 'layers', key: 'Tus optativas pueden ser un minor', title: 'Los minors',
    body: 'Un **minor** son 15 a 18 créditos de otra área, al menos la mitad en la USFQ.\n• Con tus optativas y electivas bien elegidas, puede salirte **sin semestres extra**.\n• Lo declaras **al pedir tu graduación** (no después). Hasta dos.',
    source: 'pág. 39–40' },

  /* ---------- reglas, ayudas y prácticas ---------- */
  { id: 'codigo', topic: 'vida', icon: 'help', key: 'Código de Honor: no copies', title: 'El Código de Honor y Convivencia',
    body: 'Todos en la U se comprometen a **no copiar, plagiar, mentir ni robar**, a no difamar a nadie (tampoco en redes), a respetar a la comunidad y el campus, y a no compartir exámenes.\n• Romperlo puede terminar en **suspensión** o **separación** de la U.\n• **Ir a clases estando suspendido es falta muy grave**, y los créditos que cursas suspendido **no valen** para graduarte.\n• Falsificar documentos académicos se **denuncia a la Fiscalía** (LOES, art. 206).',
    source: 'pág. 30–31' },
  { id: 'pasec', topic: 'vida', icon: 'link', key: 'PASEC: servicio comunitario', title: 'Aprendizaje y Servicio (PASEC)',
    body: 'Es **obligatorio para todas las carreras**: tomas la materia **Aprendizaje y Servicio** y, al mismo tiempo, haces **horas de servicio comunitario**.\n• Es la parte comunitaria de tus prácticas preprofesionales; la otra es PASEM.',
    source: 'pág. 97–98' },
  { id: 'pasem', topic: 'vida', icon: 'layers', key: 'PASEM: tus prácticas laborales', title: 'Prácticas preprofesionales (PASEM)',
    body: 'También es **obligatoria**. Tiene dos partes:\n• **Académica**: te registras en **PAS 4000**.\n• **Práctica**: **horas en un trabajo real**, como practicante (sin pago) o pasante, y participar en la **Feria Laboral USFQ**.\n• Tu malla dice desde cuándo: en muchas, desde el **sexto semestre o con 75 créditos**.',
    source: 'pág. 95–96' },
  { id: 'ayuda-fin', topic: 'vida', icon: 'credit', key: 'Asistencia financiera: se renueva cada año', title: 'Asistencia financiera y becas',
    body: '• Aplicas en línea al **formulario de Asistencia Financiera (AF)** con tus documentos, en las fechas del **Calendario Académico**.\n• Se **renueva cada año académico**, también en las fechas del calendario. Para el verano puedes pedir una extensión, con anticipación.\n• Con beca o AF, la carga mínima es **15 créditos**.\n• Las **becas de excelencia y deportivas** piden mantener el promedio de su instructivo.\n• Antes de graduarte o retirarte, pasa por la **Oficina de Asistencia Financiera y Becas**.',
    source: 'pág. 23–25, 64' },
  { id: 'ayuda', topic: 'vida', icon: 'help', key: 'Hay quien te ayuda a elegir', title: 'Quién te puede ayudar',
    body: '• **Consejería Académica**: elegir materias y armar tu horario, sobre todo al empezar. consejeriaacademica@usfq.edu.ec.\n• **OASA**: trámites de registro, cambios de carrera, retiros.\n• **Ombudsman**: quejas y apelaciones de nota.\n• **Learning Center**: apoyo académico **gratuito** en matemáticas, física, química, inglés, escritura, economía y más, y talleres de técnicas de estudio.',
    source: 'pág. 34, 104' },
];
export const tipLink = (id) => `#/guia-estudiante/${id}`;
