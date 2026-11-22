// The tours, guided by Specter: a short general one, offered once, and one for each section, from the «?» button
// that is always at hand. Each step lights up one thing (the rest of the page dims) and Specter, in 3D, says what it
// is for, in a sentence or two. A step whose thing is not on screen is skipped. Esc leaves; the arrows move.
// Tips suggest, never order (his rule).
import { props } from './props3d.js';
import { specterSkin } from './specter.js';
import { seen, markSeen } from './hints.js';
import { sfx } from './sfx.js';
import { specter } from './play.js';

const GENERAL = [
  { sel: '#nav [data-tab="home"]', text: 'Hola, soy Specter. Te muestro Studium en un minuto. Inicio es tu espacio: lo que viene, tus pendientes, tu enfoque y lo que vas encontrando.' },
  { sel: '#nav [data-tab="contribute"]', text: 'Estudiar: todo lo de tus materias en un solo lugar, y las guías que tu IA hace con eso.' },
  { sel: '#nav [data-tab="map"]', text: 'El Grafo: lo que aportamos entre todos, unido por conceptos, materias y evaluaciones. Puedes buscar y seguir rutas.' },
  { sel: '#nav [data-tab="profes"]', text: 'Profes: lo que la comunidad sabe de cada profe, para que elijas sabiendo qué esperar.' },
  { sel: '#nav [data-tab="comunidad"]', text: 'Comunidad: lo que piden y ofrecen los demás.' },
  { sel: '#account', text: 'Tu cuenta: el modo de la página, tu horario, tu malla, lo que subiste, Ajustes (tu IA, tus secretos) y Acerca.' },
  { sel: '.fb-fab', text: 'Si algo falla o se te ocurre algo, cuéntalo aquí. Lo lee una persona.' },
  { sel: '.tour-help', text: 'Y si te pierdes en cualquier parte, pulsa este «?»: te explico esa parte.' },
];
const SECTIONS = {
  'view-home': [
    { sel: '#home-sub', text: 'Tu inicio cambia según cómo estudias. Lo eliges en Ajustes.' },
    { sel: '#home-edit', text: 'Con «Personalizar» agregas, quitas, mueves y cambias de tamaño cada cosa.' },
    { sel: '#dash', text: 'Tus recuadros: pendientes, metas, enfoque, tu próximo examen y más.' },
    { sel: '[data-tile="shelf"]', text: 'Easter eggs: lo que dejaron los secretos que encontraste. Cada cosa se presiona.' },
    { sel: '[data-tile="schedule"]', text: 'Tu horario de hoy, si lo subiste.' },
  ],
  'view-catalog': [
    { sel: '#q', text: 'Busca una guía por materia, profe o tema.' },
    { sel: '#g-filter', text: 'Filtra las guías por lo que te sirve ahora.' },
    { sel: '#gallery', text: 'Las guías de tu comunidad. Ábrelas, márcalas como terminadas y agradece las que te sirvieron.' },
  ],
  'view-map': [
    { sel: '#map-q', text: 'Busca un concepto, una materia o un profe en el grafo.' },
    { sel: '#map-filters-open', text: 'Filtra lo que se ve: por tipo, por materia, por evaluación.' },
    { sel: '#map-route-open', text: 'Una ruta junta lo que necesitas para una evaluación, en el orden en que se aprende.' },
    { sel: '#map-canvas', text: 'Arrastra para moverte, rueda para acercarte y toca un nodo para ver lo que tiene.' },
    { sel: '#map-info-open', text: 'Qué significa cada color y cada línea.' },
  ],
  'view-horario': [{ sel: '#horario', text: 'Tu semana por bloques. Súbela una vez desde una captura, una foto o tu Excel, y aquí la ves cada día.' }],
  'view-malla': [{ sel: '#malla', text: 'Tu malla: lo que aprobaste, lo que puedes tomar ahora y lo que te falta para abrir cada materia.' }],
  'view-student': [{ sel: '#student-guide', text: 'La Guía del estudiante: las reglas y trámites de la universidad, en corto, con su página del manual.' }],
  'view-profes': [
    { sel: '#p-q', text: 'Busca un profe o una materia.' },
    { sel: '#tip-new', text: 'Cuenta lo que sabes de un profe: cómo evalúa, qué recomiendas.' },
    { sel: '#profs', text: 'Lo que la comunidad dice de cada profe.' },
  ],
  'view-library': [
    { sel: '#l-q', text: 'Busca documentos de tus materias.' },
    { sel: '#doc-new', text: 'Suma un documento: tu IA lo reconoce y lo ordena.' },
    { sel: '#docs', text: 'Los documentos de tu comunidad.' },
  ],
  'view-comunidad': [{ sel: '#cm-body', text: 'Lo que piden y ofrecen los demás. Todo entre miembros, con buena onda.' }],
  'view-contribute': [
    { sel: '#pane-estudia:not([hidden]) [data-es-drop]', text: 'Tu escritorio: todo lo de tus materias en un solo lugar. Suelta aquí lo que tengas, archivos, carpetas enteras o fotos del cuaderno, sin llenar nada.' },
    { sel: '#pane-estudia:not([hidden]) [data-es-link]', text: 'Un enlace también vale: una página del profe o un repositorio de GitHub.' },
    { sel: '#pane-estudia:not([hidden]) .es-how, #pane-estudia:not([hidden]) .es-workdesk', text: 'Yo lo ordeno: cada cosa a su montón y cada materia a su carpeta. Lo que no sepa de qué es, te lo pregunto una sola vez.' },
    { sel: '#pane-estudia:not([hidden]) [data-es-table]:not([hidden])', text: 'Al final eliges qué hacemos: guardarlo, hacer una guía de estudio o sumarlo al grafo. Puedes volver a tus carpetas y decidir después.' },
    { sel: '#pane-estudia:not([hidden]) .es-surface', text: 'Toca una carpeta para ver lo de esa materia y hacer una guía con eso cuando la necesites.' },
    { sel: '#view-contribute .subtabs [data-sub="guias"]', text: 'Guías: las que hizo tu comunidad, para estudiar ya.' },
    { sel: '#pane-estudia:not([hidden]) .es-mine', text: 'Lo que subiste: ahí cambias quién lo ve, o lo borras.' },
    { sel: '#pane-guide:not([hidden]) .q-progress', text: 'Tu guía se arma con unas pocas preguntas, una a la vez. Esta barra es lo que falta.' },
    { sel: '#pane-guide:not([hidden]) [data-q].now', text: 'Responde lo que sepas; lo opcional se salta. La última pregunta crea la guía con tu IA.' },
    { sel: '#pane-mine:not([hidden]) .mine', text: 'Lo que subiste: tus guías y lo que sumaste al grafo. Cambia quién lo ve, o bórralo.' },
    { sel: '#pane-mine:not([hidden]) [data-history]', text: 'Tu historial: cómo estaba cada cosa antes de cambiarla o borrarla. Puedes volver atrás.' },
  ],
  'view-settings': [
    { sel: '#settings', text: 'Tus ajustes: tu nombre, tu carrera, tu ambiente, los sonidos y más.' },
    { sel: '#set-ai', text: 'Tu IA: conectas la que tengas (también gratis) y eliges cuál usar para cada cosa.' },
    { sel: '#set-secrets', text: 'Tus secretos: los que encontraste, lo que dejó cada uno y cómo me visto.' },
  ],
};

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
const currentView = () => [...document.querySelectorAll('main.view, section.view')].find((v) => !v.hidden && visible(v))?.id ?? '';
let tour = null; // { steps, i, root }

function close() {
  if (!tour) return;
  // It goes out the way it came in; Specter comes back to the page.
  const gone = tour.root;
  gone.classList.add('out');
  setTimeout(() => gone.remove(), 320);
  specter.comeBack();
  removeEventListener('keydown', onKey, true);
  removeEventListener('resize', place);
  removeEventListener('scroll', place, true);
  tour = null;
}
function onKey(e) {
  if (!tour) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(tour.i + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(tour.i - 1); }
}
function place() {
  if (!tour) return;
  const { root } = tour; const step = tour.steps[tour.i];
  const el = document.querySelector(step.sel);
  const hole = root.querySelector('.tour-hole'); const card = root.querySelector('.tour-card');
  const r = el.getBoundingClientRect(); const pad = 8;
  Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const cw = card.offsetWidth; const ch = card.offsetHeight;
  // Below the thing if there is room, above if not, beside when it fills the screen; always on screen.
  let x = Math.min(innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
  let y = r.bottom + 16;
  if (y + ch > innerHeight - 12) y = r.top - ch - 16;
  if (y < 12) { y = Math.max(12, Math.min(innerHeight - ch - 12, r.top + 12)); x = r.right + 16 + cw < innerWidth ? r.right + 16 : Math.max(12, r.left - cw - 16); }
  card.style.left = `${x}px`; card.style.top = `${y}px`;
}
function go(i) {
  if (!tour) return;
  if (i < 0) return;
  if (i >= tour.steps.length) { close(); return; }
  tour.i = i;
  const step = tour.steps[i];
  const el = document.querySelector(step.sel);
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const card = tour.root.querySelector('.tour-card');
  card.querySelector('.tour-text').textContent = step.text;
  // Each step's words come in, and Specter nods.
  const body = card.querySelector('.tour-body'); body.classList.remove('step-in'); void body.offsetWidth; body.classList.add('step-in');
  const pic = card.querySelector('.tour-specter'); pic.classList.remove('nod'); void pic.offsetWidth; pic.classList.add('nod');
  pic.dataset.mood = i === 0 ? 'glad' : i === tour.steps.length - 1 ? 'wink' : ['glad', '', 'surprised', ''][i % 4];
  pic.dataset.talk = '1'; clearTimeout(pic._talk); pic._talk = setTimeout(() => { pic.dataset.talk = ''; }, 300 + step.text.length * 45);
  card.querySelector('.tour-count').textContent = `${i + 1} de ${tour.steps.length}`;
  card.querySelector('[data-tour-prev]').disabled = i === 0;
  card.querySelector('[data-tour-next]').textContent = i === tour.steps.length - 1 ? 'Listo' : 'Siguiente';
  sfx.tick();
  place();
  setTimeout(place, 420); // after the smooth scroll
}
export function startTour(kind = 'section') {
  if (tour) { tour.root.remove(); tour = null; specter.comeBack(); }
  const list = kind === 'general' ? GENERAL : SECTIONS[currentView()] ?? GENERAL;
  const steps = list.filter((s) => visible(document.querySelector(s.sel)));
  if (!steps.length) return;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `<div class="tour-hole"></div>
    <section class="tour-card" role="dialog" aria-label="Recorrido con Specter">
      <canvas class="prop tour-specter" data-prop="specter" data-skin="${specterSkin()}" aria-hidden="true"></canvas>
      <div class="tour-body"><p class="tour-text" aria-live="polite"></p>
        <div class="tour-actions"><span class="tour-count"></span><button type="button" class="button ghost small" data-tour-prev>Anterior</button><button type="button" class="button primary small" data-tour-next>Siguiente</button></div>
        <button type="button" class="link tour-close" data-tour-close>Salir del recorrido</button></div>
    </section>`;
  document.body.append(root);
  tour = { steps, i: 0, root };
  // Only one Specter: the one of the page spins away, and is the one in the card now.
  specter.leave();
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-tour-next]')) go(tour.i + 1);
    else if (e.target.closest('[data-tour-prev]')) go(tour.i - 1);
    else if (e.target.closest('[data-tour-close]') || !e.target.closest('.tour-card')) close();
  });
  addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  addEventListener('scroll', place, { capture: true, passive: true });
  props(root);
  go(0);
  root.querySelector('[data-tour-next]').focus();
}

// The «?» at hand in every section, and the general tour offered once, the first time Inicio is seen.
export function mountTour() {
  const help = document.createElement('button');
  help.type = 'button';
  help.className = 'tour-help';
  help.setAttribute('aria-label', '¿Cómo funciona esta parte? Specter te la muestra');
  help.title = '¿Cómo funciona esta parte?';
  help.textContent = '?';
  help.addEventListener('click', () => startTour('section'));
  document.body.append(help);
}
// The offer, once: Specter himself asks, outside any box. In the playful ambience the Specter of the page flies to
// the card; elsewhere he floats beside it. «Ahora no»: he waves and flies off (in the playful ambience he comes back,
// playfully, a while later); the card folds away.
export function offerTour(tries = 0) {
  if (seen('tour-offered') || tour || document.querySelector('.tour-offer')) return;
  setTimeout(() => {
    if (currentView() !== 'view-home' || seen('tour-offered')) return;
    // One thing at a time: while another notice is open (the news of a version), the offer waits for it.
    if (document.querySelector('dialog[open]')) { if (tries < 20) offerTour(tries + 1); return; }
    markSeen('tour-offered');
    const live = specter.here();
    const card = document.createElement('div');
    card.className = `tour-offer glass${live ? ' live' : ''}`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Specter');
    card.innerHTML = `${live ? '' : `<canvas class="prop offer-specter" data-prop="specter" data-skin="${specterSkin()}" aria-hidden="true"></canvas>`}
      <p>Hola, soy Specter. ¿Te muestro Studium en un minuto?</p>
      <div class="tour-actions"><button type="button" class="button primary small" data-yes>Sí, muéstrame</button><button type="button" class="button ghost small" data-no>Ahora no</button></div>
      <small>Cuando quieras, el «?» de abajo te explica cada parte.</small>`;
    document.body.append(card);
    props(card);
    // Only one Specter: where the page's own one cannot come to the card (not in the playful ambience), he steps out
    // while the card shows him, and comes back when it closes.
    if (!live) specter.leave();
    if (live) {
      const r = card.getBoundingClientRect();
      specter.visit(r.left - 46, r.top + r.height / 2);
    }
    const fold = () => { card.classList.add('out'); setTimeout(() => card.remove(), 450); if (!live) specter.comeBack(); };
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-yes]')) { card.remove(); if (live) specter.home(); else specter.comeBack(); startTour('general'); }
      else if (e.target.closest('[data-no]')) {
        sfx.tick();
        if (live) { specter.say('¡Va! Aquí estaré.', 1400); setTimeout(() => specter.away(9000), 700); }
        else card.querySelector('.offer-specter')?.classList.add('away');
        fold();
      }
    });
  }, 2500);
}
