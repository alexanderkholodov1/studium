// «Cómo funciona»: Studium explained, every part of it, at #/como-funciona (public: transparency is seen before signing
// in; his decision 2026-11-25). Each entry is said in short steps; the same steps are what Specter says from the ⓘ beside
// the thing (explain), so there is one text. Every fact about the bridge is taken from bridge.mjs (1.12.0): when it
// changes, change it here too.
import { explainTour } from './tour.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// A step is { text } (said by Specter and shown on the page), with optional { sel } (what Specter lights up when it is
// on screen) and { more } (a detail only the page shows).
export const DOCS = [
  {
    id: 'puente', group: 'Tu IA y tu computadora', title: 'El puente: qué hace exactamente',
    lede: 'Un programa pequeño que corre en tu computadora mientras lo tienes abierto, para que Studium use el Claude Code que ya tienes, con tu suscripción.',
    steps: [
      { text: 'El puente es un archivo (studium-bridge.mjs) que abres tú en una terminal. Mientras su ventana está abierta, Studium puede pedirle cosas; si la cierras o pulsas Ctrl+C, se acaba.' },
      { text: 'Solo responde a las direcciones de Studium, y solo a pedidos que traen el código de enlace que te mostró al abrirse. Otra página, u otro programa sin ese código, no puede usarlo.' },
      { text: 'Cada pedido trabaja en una carpeta temporal nueva (studium-run-…, en la carpeta temporal del sistema), que se borra al terminar. Si una quedó de antes, se borra la próxima vez que lo abras.', sel: '[data-tj-ws][value="temp"]' },
      { text: 'Si tú le prestas una carpeta tuya, trabaja dentro de ella, en una subcarpeta propia (.studium/run-…), con el permiso que elegiste. Nunca acepta un disco entero ni tu carpeta personal.', sel: '.tj-places' },
      { text: 'Tu IA deja lo que escribe en «salida» (por ejemplo, esquema.json y un archivo por capítulo). Studium lee esos archivos tal cual y los revisa con reglas fijas, sin otra IA en medio.' },
      { text: 'Mientras trabaja, Studium solo le pregunta su avance para mostrártelo. La ventana de Claude Code, si la dejas activada, te muestra cada archivo que lee o cambia.' },
      { text: 'Tu IA no puede buscar en internet ni lanzar otros agentes, y solo abre páginas si trajiste enlaces (esos sitios). Fuera de su carpeta y de la que le prestaste, no toca nada; y ni ahí lee o cambia archivos de claves (.env, llaves, certificados, credenciales).' },
      { text: 'A Studium solo llega la guía escrita. Tu pedido y tus archivos van a la empresa de tu IA (Anthropic, con Claude Code), como cuando la usas tú.' },
      { text: '«Leer con el puente» (Preparar mi inscripción): abre una ventana de Chrome o Edge propia, solo en la Oferta de cursos de la U. Ahí inicias sesión tú, con tu cuenta; la ventana guarda la sesión como cualquier navegador, en ~/.studium-bridge-catalogo. Luego pide a la Oferta, una materia a la vez y con una pausa, lo mismo que su botón «Actualizar Cursos», y cierra la ventana. Solo lee: no inscribe ni cambia nada. Studium le manda solo los códigos y el periodo, nunca código que ejecutar. Necesita Node 22 o más nuevo.', sel: '[data-ar-bridge]' },
    ],
    more: [
      'Guarda en tu computadora: ~/.studium-bridge.json (el código de enlace y las últimas 40 sesiones de Claude Code con su carpeta) y ~/.studium-bridge-results (las respuestas de los últimos 7 días, hasta 20, también lo que tu IA alcanzó a escribir si el pedido falló).',
      'Las carpetas que prestas viven solo en su memoria: nunca se guardan en el disco, y se olvidan al cerrarlo.',
      'Un pedido espera hasta 20 minutos (una guía completa, hasta una hora); después se detiene y lo dice.',
      'No acepta pedidos de más de 64 MB.',
    ],
  },
  {
    id: 'carpeta', group: 'Tu IA y tu computadora', title: 'Dónde trabaja tu IA y qué puede hacer ahí',
    lede: 'Tú eliges dónde trabaja: sin carpeta tuya, o en una que le prestas, con un permiso.',
    steps: [
      { text: '«Sin carpeta tuya»: Studium copia lo que trajiste a una carpeta temporal, tu IA trabaja ahí y el puente la borra al terminar.', sel: '[data-tj-ws][value="temp"]' },
      { text: 'Una carpeta tuya se presta con la ventana de tu computadora (o, si es donde abriste el puente, con un toque). La página nunca ve la ruta hasta que tú la eliges.', sel: '.tj-places' },
      { text: '«Solo leer»: tu IA lee, busca y lista archivos; no cambia nada ni ejecuta comandos.', sel: '[data-tj-mode]' },
      { text: '«Leer y escribir archivos»: además crea y edita archivos de esa carpeta, nunca fuera de ella; tampoco ejecuta comandos.' },
      { text: '«Leer, escribir y usar git»: además puede usar git ahí, y solo estos comandos: status, diff, log, add, commit, push, pull, switch y branch.' },
      { text: 'El préstamo dura lo que elegiste (una hora, 8 horas o una semana; 8 por defecto) y Studium lo suelta cuando la guía queda escrita. Cerrar el puente también lo olvida.' },
    ],
  },
  {
    id: 'cuenta-claude', group: 'Tu IA y tu computadora', title: 'Con qué cuenta de Claude trabaja',
    lede: 'Si en tu computadora hay varias cuentas de Claude Code, eliges cuál usa cada pedido.',
    steps: [
      { text: 'El puente lista cada cuenta de Claude Code con su sesión iniciada en esta computadora, con su plan. La que no tiene sesión aparece, pero no se puede elegir.', sel: '.tj-accounts, .bridge-accounts' },
      { text: 'El pedido usa tu suscripción (Pro o Max), sin pagar por uso. Studium nunca elige un modelo que pueda cobrarte aparte.' },
      { text: 'Si una cuenta llega a su límite de uso, el error lo dice y puedes elegir otra aquí mismo.' },
    ],
  },
  {
    id: 'instalar', group: 'Tu IA y tu computadora', title: 'Lo que necesitas instalar',
    lede: 'Para el puente: Node. Para escribir con tu suscripción: Claude Code. Para git y GitHub: Git y GitHub CLI.',
    steps: [
      { text: 'Node 20 o más nuevo, para abrir el puente (22 o más para leer la Oferta de cursos): nodejs.org.' },
      { text: 'Claude Code: en Windows, en PowerShell, «irm https://claude.ai/install.ps1 | iex»; en Mac o Linux, «curl -fsSL https://claude.ai/install.sh | bash». Después escribe «claude» e inicia sesión.' },
      { text: 'Git, si tu IA va a usar git en tu carpeta: git-scm.com. Después dile quién eres: «git config --global user.name» y «user.email», con el correo de tu GitHub.' },
      { text: 'GitHub CLI, si tu IA va a crear un repositorio o subir el trabajo: cli.github.com, y «gh auth login». Lo que sube sale a tu nombre.' },
      { text: 'Studium comprueba todo esto con el puente y te dice exactamente qué falta, con el comando para copiar.', sel: '[data-tools-box], [data-bridge-state]' },
    ],
  },
  {
    id: 'recoger', group: 'Tus guías', title: 'Recoger lo que hizo tu IA',
    lede: 'Si tu IA escribió algo y no llegó a tu guía (se cortó, se cerró la página o falló al guardarlo), se recupera sin volver a pedírselo.',
    steps: [
      { text: 'Cada respuesta de tu IA para una guía (el esquema, cada capítulo, cada ajuste) se guarda en este navegador apenas llega, antes de leerla: las últimas 12 de cada guía, por 14 días.' },
      { text: 'Con el puente, además: lo que guardó él (7 días) y lo que Claude Code anotó en su propio registro, en tu computadora, archivo por archivo.' },
      { text: '«Aplicar a esta guía» lo pone tal cual, sin pedirle nada a tu IA, y lo puedes deshacer.', sel: '[data-tj="collect-apply"]' },
    ],
  },
  {
    id: 'ia', group: 'Tu IA y tu computadora', title: 'Tu IA: cuál usar y cuánto cuesta',
    lede: 'Studium no tiene IA propia ni cobra nada: usa la tuya, y te muestra siempre lo que le pide.',
    steps: [
      { text: 'Gemini con una clave de Google AI Studio es gratis, con un número de pedidos por día. Studium usa sus modelos gratis.' },
      { text: 'Con tu suscripción de Claude (o de ChatGPT), por el puente, sin pagar por uso.' },
      { text: 'Con una clave de API de pago, cada pedido se cobra en tu cuenta: Studium te avisa antes de usar un modelo que pueda costar.' },
      { text: 'Tus claves se guardan cifradas con tu cuenta; Studium no puede leerlas. Antes de enviar un texto a tu IA, se le quitan las claves y contraseñas que tenga.' },
      { text: 'En cada pedido puedes ver exactamente las instrucciones que se le mandan.' },
    ],
  },
  {
    id: 'fuentes', group: 'Tus guías', title: 'De dónde saca tu IA la información',
    lede: 'Una guía se escribe con lo que tú le das: archivos, una carpeta de tu computadora, enlaces, o una mezcla.',
    steps: [
      { text: 'Los archivos que subes se guardan con la guía: así las instrucciones originales del profesor quedan aunque cambie tu carpeta.' },
      { text: 'Una carpeta de tu computadora la lee tu IA ahí mismo, por el puente: no se sube nada a Studium.' },
      { text: 'Los enlaces los abre Claude Code por el puente: solo esos sitios (además de la documentación pública que Claude Code abre siempre sin pedir permiso), sin buscar en internet. La guía guarda una copia de lo que leyó y cuándo.' },
      { text: 'Cada fuente lleva lo que es: del profesor, tu avance o contexto. Así tu IA sabe qué manda.' },
    ],
  },
];
const byId = (id) => DOCS.find((d) => d.id === id);

// The ⓘ beside a control: Specter says the entry's steps, lighting up each thing when it is on screen.
export const infoButton = (id, label = '') => `<button type="button" class="info-i" data-explain="${esc(id)}" aria-label="${esc(label || `Cómo funciona: ${byId(id)?.title ?? ''}`)}" title="¿Cómo funciona?">i</button>`;
export function explain(id, at = null) {
  const d = byId(id);
  if (!d) return;
  explainTour([{ text: d.lede }, ...d.steps], { at, more: `#/como-funciona/${d.id}` });
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-explain]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    explain(b.dataset.explain, b.closest('h2, h3, h4, h5, legend, summary, p, label') ?? b);
  }, true);
}

// The page: every entry, grouped, each with its steps and its details; the one in the link opened and in view.
export function renderDocs(el, id = '') {
  const groups = [...new Set(DOCS.map((d) => d.group))];
  el.innerHTML = `<p class="lede-small">Cómo funciona cada parte de Studium, exactamente: qué se guarda, dónde, quién lo ve y qué hace tu IA. Lo mismo que te explica Specter con el botón «i».</p>
    <nav class="docs-index" aria-label="Temas">${groups.map((g) => `<div><h3>${esc(g)}</h3><ul>${DOCS.filter((d) => d.group === g).map((d) => `<li><a href="#/como-funciona/${d.id}">${esc(d.title)}</a></li>`).join('')}</ul></div>`).join('')}</nav>
    ${DOCS.map((d) => `<details class="docs-entry glass" id="doc-${d.id}" ${d.id === id ? 'open' : ''}><summary><h2>${esc(d.title)}</h2></summary>
      <p class="lede-small">${esc(d.lede)}</p><ol class="docs-steps">${d.steps.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol>
      ${d.more?.length ? `<h3>Además</h3><ul class="docs-more">${d.more.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</details>`).join('')}`;
  if (id) setTimeout(() => el.querySelector(`#doc-${CSS.escape(id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 450);
}
