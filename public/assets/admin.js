// The admin panel (#/admin), for accounts with the admin role. Everything is fetched when a section opens or when
// «Actualizar» is pressed, and every action runs when it is pressed: nothing here runs by itself on a timer.
// Two levels:
// - the database, through the admin claim in the rules: settings, communities, switches, the announcement, counts,
//   presence, moderation, the easter eggs' counters and the audit log;
// - Google Cloud, with the admin's own Google sign-in, straight from the browser (no server, no key in the page):
//   the accounts and what can be done to them, Firestore's usage against the free quota, the live rules and the
//   e-mail configuration. It needs an OAuth client ID, set from the panel.
import {
  collection, query, where, orderBy, limit, getDocs, getCount, doc, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js';
import { db, auth, compilePacks, packInfo } from './data.js';
import { firebaseConfig, mailFrom } from './config.js';
import { settings, normalize, domainOf } from './settings.js';
import { EGGS } from './eggs.js';
import { rise } from './fx.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = (v) => (v == null ? '—' : Number(v).toLocaleString('es'));
const PROJECT = firebaseConfig.projectId;
const SECTIONS = {
  resumen: 'Resumen', acceso: 'Acceso y comunidades', pagina: 'La página', cuentas: 'Cuentas', contenido: 'Contenido',
  uso: 'Uso de Firebase', eggs: 'Easter eggs', correo: 'Correo', registro: 'Registro',
};
// Firestore's free daily quota (Spark plan) and storage.
const QUOTA = { reads: 50_000, writes: 20_000, deletes: 20_000, storage: 1024 ** 3 };
let ctx = null;
let section = 'resumen';
let draft = null;
let accounts = null; // the list from Google Cloud, once loaded
let contentKind = 'guides';

const millis = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'string' ? (Number(v) || Date.parse(v) || 0) : Number(v) || 0);
function when(v) {
  const ms = millis(v);
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 60_000) return 'hace un momento';
  if (d < 3_600_000) return `hace ${Math.round(d / 60_000)} min`;
  if (d < 86_400_000) return `hace ${Math.round(d / 3_600_000)} h`;
  if (d < 30 * 86_400_000) return `hace ${Math.round(d / 86_400_000)} días`;
  return new Date(ms).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' });
}
const bytes = (b) => (b == null ? '—' : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
const stat = (label, value, note = '') => `<div class="stat"><span>${esc(label)}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
const meter = (label, used, max, fmt = n) => {
  const p = used == null ? 0 : Math.min(100, (used / max) * 100);
  return `<div class="meter ${p > 80 ? 'high' : p > 50 ? 'mid' : ''}"><div class="meter-head"><span>${esc(label)}</span><b>${used == null ? '—' : fmt(used)} <small>de ${fmt(max)}</small></b></div>
    <i style="--p:${p.toFixed(1)}%"></i></div>`;
};
const email = () => auth.currentUser?.email ?? '';

// Every admin action leaves a line in the audit log.
async function audit(action, detail = '') {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'audit')), { action: action.slice(0, 60), detail: String(detail).slice(0, 2000), by: email(), at: serverTimestamp() });
  await batch.commit();
}

/* ---------- Google Cloud, with the admin's own sign-in ---------- */
const SCOPES = ['https://www.googleapis.com/auth/identitytoolkit', 'https://www.googleapis.com/auth/monitoring.read',
  'https://www.googleapis.com/auth/firebase.readonly'].join(' ');
const google = { token: '', expires: 0 };
class GoogleError extends Error { constructor(status, message) { super(message); this.status = status; } }
function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el inicio de sesión de Google.'));
    document.head.append(s);
  });
}
const connected = () => !!google.token && Date.now() < google.expires - 60_000;
// Opens Google's window; call it from a click.
async function connect() {
  const clientId = settings.get().googleClientId;
  if (!clientId) throw new Error('Falta el ID de cliente de Google: pégalo en «Conexión con Google Cloud».');
  await loadGis();
  await new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES,
      callback: (r) => { if (r.error) reject(new Error(r.error_description || r.error)); else { google.token = r.access_token; google.expires = Date.now() + Number(r.expires_in) * 1000; resolve(); } },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : e?.message || 'Google no respondió.')),
    });
    client.requestAccessToken();
  });
}
async function gapi(method, url, body) {
  if (!connected()) throw new GoogleError(401, 'Conéctate con Google para ver esto.');
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${google.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const hint = r.status === 403 ? ' Tu cuenta de Google necesita acceso al proyecto con ese permiso (por ejemplo, Propietario, o Lector de Monitoring y Administrador de Firebase Authentication).' : '';
    throw new GoogleError(r.status, `${data.error?.message ?? `HTTP ${r.status}`}.${hint}`);
  }
  return data;
}
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
function googleCard() {
  const s = settings.get();
  if (!s.googleClientId) {
    return `<section class="set glass google-setup"><h2>Conexión con Google Cloud</h2>
      <p>Las cuentas y el uso de Firebase se leen con tu propio inicio de sesión de Google, en el momento, sin servidor. Hace falta un ID de cliente OAuth, una sola vez:</p>
      <ol class="howto">
        <li>En <a href="https://console.cloud.google.com/apis/credentials?project=${esc(PROJECT)}" target="_blank" rel="noopener noreferrer">Google Cloud → Credenciales</a>, «Crear credenciales» → «ID de cliente de OAuth» → «Aplicación web».</li>
        <li>En «Orígenes autorizados de JavaScript», agrega <code>https://alexanderkholodov.web.app</code> (y <code>http://localhost:5173</code> para probar).</li>
        <li>Si te lo pide, configura la pantalla de consentimiento como «Externa», en modo de prueba, con tu correo como usuario de prueba.</li>
        <li>Copia el ID de cliente (termina en <code>.apps.googleusercontent.com</code>) y pégalo aquí.</li>
      </ol>
      <form class="inline-form" id="adm-gclient"><input name="clientId" placeholder="123456789-abc.apps.googleusercontent.com" required aria-label="ID de cliente de Google"><button class="button primary">Guardar</button></form>
      <p class="fine">El ID de cliente es público por diseño, como la clave web de Firebase. La cuenta de Google con la que te conectes necesita acceso al proyecto ${esc(PROJECT)}.</p></section>`;
  }
  return `<section class="set glass google-link"><div><h2>Conexión con Google Cloud</h2>
      <p class="muted">${connected() ? 'Conectado. La conexión dura una hora.' : 'Para ver cuentas y uso de Firebase, conéctate con una cuenta de Google con acceso al proyecto.'}</p></div>
    <div class="actions">${connected() ? '<button class="button ghost" data-adm-disconnect>Desconectar</button>' : '<button class="button primary" data-adm-connect>Conectar con Google</button>'}
      <button class="link" data-adm-clientid>Cambiar el ID de cliente</button></div></section>`;
}

/* ---------- sections ---------- */
async function summary() {
  const now = Date.now();
  const pres = collection(db, 'presence');
  const since = (ms) => getCount(query(pres, where('at', '>=', new Date(now - ms))));
  const count = (col, vis) => getCount(vis ? query(collection(db, col), where('visibility', '==', vis)) : collection(db, col)).then((r) => r.data().count).catch(() => null);
  const s = settings.get();
  const [all, live, day, week, month, ...rest] = await Promise.all([
    getCount(pres), since(10 * 60_000), since(86_400_000), since(7 * 86_400_000), since(30 * 86_400_000),
    count('catalog', 'public'), count('catalog', 'private'), count('contributions', 'public'), count('contributions', 'private'),
    count('library'), count('tips'), count('kudos'), count('sources'),
    ...s.communities.map((c) => getCount(query(pres, where('community', '==', c.id))).then((r) => r.data().count).catch(() => null)),
  ]);
  const [gPub, gPriv, cPub, cPriv, docs, tips, kudos, sources, ...byCommunity] = rest;
  const v = (r) => r.data().count;
  const version = await fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const latest = await fetch('https://api.github.com/repos/alexanderkholodov1/studium/releases/latest').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return `<div class="stats">
      ${stat('Personas vistas', n(v(all)), 'desde v0.5.0')}${stat('Activas ahora', n(v(live)), 'últimos 10 min')}
      ${stat('Hoy', n(v(day)), 'últimas 24 h')}${stat('Esta semana', n(v(week)), '7 días')}${stat('Este mes', n(v(month)), '30 días')}
    </div>
    <section class="set glass"><h2>Por comunidad</h2><div class="stats">${s.communities.map((c, i) => stat(c.name, n(byCommunity[i]), c.active ? `${c.domains.length} ${c.domains.length === 1 ? 'dominio' : 'dominios'}` : 'apagada')).join('')}</div></section>
    <section class="set glass"><h2>Contenido</h2><div class="stats">
      ${stat('Guías públicas', n(gPub))}${stat('Guías privadas', n(gPriv))}${stat('Aportes públicos', n(cPub))}${stat('Aportes privados', n(cPriv))}
      ${stat('Documentos', n(docs))}${stat('Datos de profes', n(tips))}${stat('Agradecimientos', n(kudos))}${stat('Fuentes', n(sources))}</div></section>
    <section class="set glass"><h2>Estado</h2><div class="stats">
      ${stat('Confirmar el correo', s.confirmEmail ? 'Exigido' : 'Apagado')}
      ${stat('Comunidades activas', n(s.communities.filter((c) => c.active).length), `de ${s.communities.length}`)}
      ${stat('Anuncio', s.announcement.on ? 'Visible' : 'Apagado')}
      ${stat('Versión en este sitio', version ? `v${esc(version.version)}` : 'desarrollo', version ? esc(when(version.builtAt)) : '')}
      ${stat('Último release', latest ? esc(latest.tag_name) : '—', latest ? esc(when(latest.published_at)) : '')}
      ${stat('Ajustes cambiados', esc(when(s.updated)), s.by ? esc(s.by) : '')}</div></section>`;
}

function accessSection() {
  draft ??= structuredClone(settings.get());
  return `<section class="set glass"><h2>Confirmar el correo</h2>
      <label class="toggle"><input type="checkbox" data-adm-confirm ${draft.confirmEmail ? 'checked' : ''}><span class="knob"></span>Exigir que cada cuenta confirme su correo antes de entrar</label>
      <p class="fine">Apagado desde v0.4.5: Microsoft 365 (el correo de la USFQ) retiene los correos de confirmación. Si lo enciendes, las reglas lo exigen de inmediato.</p></section>
    <section class="set glass"><h2>Comunidades <small>Quién puede entrar, según el dominio de su correo</small></h2>
      <div class="communities">${draft.communities.map((c, i) => `<article class="community ${c.active ? '' : 'off'}" data-i="${i}">
        <div class="grid3">
          <label class="field"><span>Nombre corto</span><input data-c="name" maxlength="40" value="${esc(c.name)}"></label>
          <label class="field"><span>Nombre completo</span><input data-c="full" maxlength="120" value="${esc(c.full)}"></label>
          <label class="field"><span>Identificador</span><input data-c="id" maxlength="30" value="${esc(c.id)}" ${settings.get().communities.some((x) => x.id === c.id) ? 'readonly title="No cambia una vez creada"' : ''}></label>
        </div>
        <div class="domains"><span class="fine">Dominios aceptados</span><div class="chips">${c.domains.map((d) => `<span class="chip on">@${esc(d)}<button class="x" data-c-remove="${esc(d)}" aria-label="Quitar ${esc(d)}">×</button></span>`).join('')}
          <form class="inline-form" data-c-add><input name="domain" placeholder="estud.universidad.edu" aria-label="Nuevo dominio"><button class="button ghost small">Agregar</button></form></div></div>
        <div class="actions"><label class="toggle"><input type="checkbox" data-c="active" ${c.active ? 'checked' : ''}><span class="knob"></span>Activa</label>
          ${draft.communities.length > 1 ? '<button class="link danger" data-c-delete>Eliminar comunidad</button>' : ''}</div>
      </article>`).join('')}</div>
      <div class="actions"><button class="button ghost" data-c-new>Agregar una comunidad</button></div></section>
    ${saveBar()}`;
}

function pageSection() {
  draft ??= structuredClone(settings.get());
  const f = draft.flags;
  const sw = (key, label, hint) => `<label class="toggle"><input type="checkbox" data-flag="${key}" ${f[key] !== false ? 'checked' : ''}><span class="knob"></span><span>${esc(label)}<small class="fine"> · ${esc(hint)}</small></span></label>`;
  const a = draft.announcement;
  return `<section class="set glass"><h2>Funciones de la página</h2><div class="switches">
      ${sw('hints', 'Pistas', 'las burbujas de «¿Sabías que…?»')}
      ${sw('eggs', 'Easter eggs', 'los secretos de la página')}
      ${sw('radio', 'La radio', 'el easter egg de la radio')}
      ${sw('bubbles', 'Burbujas del modo juguetón', 'apagadas por defecto')}</div></section>
    <section class="set glass"><h2>Proveedores de IA que se ofrecen</h2><div class="switches">
      ${[['anthropic', 'Claude (Anthropic)'], ['openai', 'ChatGPT (OpenAI)'], ['gemini', 'Gemini (Google)']].map(([k, label]) => `<label class="toggle"><input type="checkbox" data-provider="${k}" ${draft.providers.includes(k) ? 'checked' : ''}><span class="knob"></span>${esc(label)}</label>`).join('')}</div></section>
    <section class="set glass"><h2>Anuncio <small>Arriba de la página, para todos los miembros</small></h2>
      <label class="toggle"><input type="checkbox" data-ann="on" ${a.on ? 'checked' : ''}><span class="knob"></span>Mostrar el anuncio</label>
      <label class="field"><span>Texto</span><textarea data-ann="text" maxlength="280" rows="2" class="plain">${esc(a.text)}</textarea></label>
      <fieldset class="seg"><legend>Tono</legend>${[['info', 'Aviso'], ['good', 'Buena noticia'], ['warn', 'Importante']].map(([k, l]) => `<label><input type="radio" name="ann-level" data-ann="level" value="${k}" ${a.level === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
      ${a.text ? `<div class="announce ${esc(a.level)} preview">${esc(a.text)}</div>` : ''}</section>
    ${saveBar()}`;
}
function saveBar() {
  const before = JSON.stringify(normalize(settings.get())); const after = JSON.stringify(normalize(draft));
  return `<div class="save-bar ${before === after ? '' : 'dirty'}"><span>${before === after ? 'Sin cambios' : 'Hay cambios sin guardar'}</span>
    <button class="button ghost" data-adm-discard ${before === after ? 'disabled' : ''}>Descartar</button><button class="button primary" data-adm-save ${before === after ? 'disabled' : ''}>Guardar</button></div>`;
}
// What changed, in words, for the audit log.
function changes(a, b) {
  const out = [];
  if (a.confirmEmail !== b.confirmEmail) out.push(`confirmar el correo: ${b.confirmEmail ? 'exigido' : 'apagado'}`);
  const ids = new Set([...a.communities, ...b.communities].map((c) => c.id));
  for (const id of ids) {
    const x = a.communities.find((c) => c.id === id); const y = b.communities.find((c) => c.id === id);
    if (!x) out.push(`comunidad nueva ${y.name} (${y.domains.join(', ')})`);
    else if (!y) out.push(`comunidad eliminada ${x.name}`);
    else {
      if (x.active !== y.active) out.push(`${y.name}: ${y.active ? 'activada' : 'apagada'}`);
      const add = y.domains.filter((d) => !x.domains.includes(d)); const del = x.domains.filter((d) => !y.domains.includes(d));
      if (add.length) out.push(`${y.name}: + ${add.join(', ')}`);
      if (del.length) out.push(`${y.name}: − ${del.join(', ')}`);
      if (x.name !== y.name || x.full !== y.full) out.push(`${y.name}: nombre`);
    }
  }
  for (const k of Object.keys({ ...a.flags, ...b.flags })) if (a.flags[k] !== b.flags[k]) out.push(`${k}: ${b.flags[k] ? 'encendido' : 'apagado'}`);
  if (a.providers.join() !== b.providers.join()) out.push(`proveedores: ${b.providers.join(', ') || 'ninguno'}`);
  if (JSON.stringify(a.announcement) !== JSON.stringify(b.announcement)) out.push(`anuncio: ${b.announcement.on ? `«${b.announcement.text}»` : 'apagado'}`);
  if (a.googleClientId !== b.googleClientId) out.push('ID de cliente de Google');
  return out.join('; ');
}

async function accountsSection() {
  if (!settings.get().googleClientId || !connected()) return googleCard();
  if (!accounts) {
    const list = [];
    let token = '';
    do {
      const page = await gapi('GET', `${IDT}/accounts:batchGet?maxResults=1000${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`);
      list.push(...(page.users ?? []));
      token = page.nextPageToken ?? '';
    } while (token && list.length < 20_000);
    accounts = list;
  }
  const s = settings.get();
  const community = (u) => s.communities.find((c) => c.domains.includes(domainOf(u.email)))?.name ?? '—';
  const isAdmin = (u) => JSON.parse(u.customAttributes || '{}').admin === true;
  const week = Date.now() - 7 * 86_400_000;
  return `${googleCard()}
    <div class="stats">${stat('Cuentas', n(accounts.length))}${stat('Nuevas esta semana', n(accounts.filter((u) => Number(u.createdAt) > week).length))}
      ${stat('Entraron esta semana', n(accounts.filter((u) => Number(u.lastLoginAt) > week).length))}${stat('Confirmadas', n(accounts.filter((u) => u.emailVerified).length))}
      ${stat('Desactivadas', n(accounts.filter((u) => u.disabled).length))}${stat('Admins', n(accounts.filter(isAdmin).length))}</div>
    <section class="set glass"><div class="table-tools"><input type="search" id="adm-q" placeholder="Buscar por correo" aria-label="Buscar cuentas"></div>
      <div class="table-wrap"><table class="adm-table" id="adm-accounts"><thead><tr><th>Correo</th><th>Comunidad</th><th>Creada</th><th>Último ingreso</th><th>Estado</th><th></th></tr></thead><tbody>
      ${[...accounts].sort((a, b) => Number(b.lastLoginAt ?? 0) - Number(a.lastLoginAt ?? 0)).map((u) => `<tr data-uid="${esc(u.localId)}" data-email="${esc(u.email ?? '')}">
        <td><strong>${esc(u.email ?? '(sin correo)')}</strong>${isAdmin(u) ? ' <span class="badge">admin</span>' : ''}</td><td>${esc(community(u))}</td>
        <td>${esc(when(Number(u.createdAt)))}</td><td>${esc(when(Number(u.lastLoginAt)))}</td>
        <td>${u.disabled ? '<span class="badge bad">desactivada</span>' : u.emailVerified ? '<span class="badge ok">confirmada</span>' : '<span class="badge">sin confirmar</span>'}</td>
        <td class="row-actions"><button class="link" data-acc="${u.disabled ? 'enable' : 'disable'}">${u.disabled ? 'Activar' : 'Desactivar'}</button>
          <button class="link" data-acc="${isAdmin(u) ? 'unadmin' : 'admin'}">${isAdmin(u) ? 'Quitar admin' : 'Hacer admin'}</button>
          <button class="link danger" data-acc="delete">Borrar</button></td></tr>`).join('')}
      </tbody></table></div></section>`;
}

const KINDS = { guides: 'Guías', contributions: 'Aportes', library: 'Biblioteca', tips: 'Datos de profes' };
// A whole collection, the most recent first. Some entries published with the admin tools have no «updated», so the
// sorting happens here rather than in the query, which would leave them out.
async function recent(name) {
  const snap = await getDocs(collection(db, name));
  const at = (d) => millis(d.data().updated ?? d.data().updatedAt);
  return { docs: [...snap.docs].sort((a, b) => at(b) - at(a)).slice(0, 300), empty: snap.empty };
}
async function contentSection() {
  const tabs = `<div class="seg adm-sub">${Object.entries(KINDS).map(([k, l]) => `<label><input type="radio" name="adm-kind" value="${k}" ${k === contentKind ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const row = (cells, id, actions) => `<tr data-id="${esc(id)}">${cells.map((c) => `<td>${c}</td>`).join('')}<td class="row-actions">${actions}</td></tr>`;
  const vis = (d) => (d.visibility === 'private' ? '<span class="badge">privada</span>' : '<span class="badge ok">pública</span>');
  let body = '';
  let packCard = '';
  if (contentKind === 'guides') {
    const snap = await recent('catalog');
    body = `<thead><tr><th>Guía</th><th>Materia</th><th>Fecha</th><th>Visibilidad</th><th>Cambiada</th><th></th></tr></thead><tbody>${snap.docs.map((d) => { const g = d.data(); return row([
      `<a href="#/guia/${encodeURIComponent(d.id)}"><strong>${esc(g.title)}</strong></a>${g.by ? `<small> · ${esc(g.by)}</small>` : ''}`, esc(g.course), esc(g.date ?? ''), vis(g), esc(when(g.updated))], d.id,
      `<button class="link" data-mod="${g.visibility === 'private' ? 'show' : 'hide'}" data-kind="guides">${g.visibility === 'private' ? 'Mostrar' : 'Ocultar'}</button><button class="link danger" data-mod="delete" data-kind="guides">Borrar</button>`); }).join('')}</tbody>`;
  } else if (contentKind === 'contributions') {
    const [snap, pack] = await Promise.all([recent('contributions'), packInfo().catch(() => null)]);
    packCard = `<section class="set glass"><h2>Paquetes del mapa <small>${pack ? `compilados ${esc(when(pack.built))}` : 'todavía no hay'}</small></h2>
      <div class="stats">${stat('Aportes en el paquete', n(pack?.count))}${stat('Partes', n(pack?.parts))}${stat('Publicados después', n(pack?.since))}</div>
      <p class="fine">Cada visita lee el paquete (unos pocos documentos, guardados en el navegador) y solo lo que se publicó después, en lugar de una lectura por aporte. Compílalo después de subir muchos aportes; lo que se borra u oculta desaparece del mapa al instante aunque siga en el paquete.</p>
      <div class="actions"><button class="button primary" data-compile>Compilar ahora</button></div></section>`;
    body = `<thead><tr><th>Aporte</th><th>Materia</th><th>Tipo</th><th>Visibilidad</th><th>Cambiado</th><th></th></tr></thead><tbody>${snap.docs.map((d) => { const c = d.data(); return row([
      `<strong>${esc(c.title)}</strong><small> · ${n(c.questions)} preguntas${c.stage ? ` · ${esc(c.stage)}` : ''}${c.source ? ` · ${esc(c.source)}` : ''}</small>`, esc(c.course), esc(c.kind), vis(c), esc(when(c.updated))], d.id,
      `<button class="link" data-mod="${c.visibility === 'private' ? 'show' : 'hide'}" data-kind="contributions">${c.visibility === 'private' ? 'Mostrar' : 'Ocultar'}</button><button class="link danger" data-mod="delete" data-kind="contributions">Borrar</button>`); }).join('')}</tbody>`;
  } else if (contentKind === 'library') {
    const snap = await recent('library');
    body = `<thead><tr><th>Documento</th><th>Materia</th><th>Tipo</th><th>Enlace</th><th>Cambiado</th><th></th></tr></thead><tbody>${snap.docs.map((d) => { const x = d.data(); return row([
      `<strong>${esc(x.title)}</strong>${x.by ? `<small> · ${esc(x.by)}</small>` : ''}`, esc(x.course), esc(x.kind), `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(x.url).host)}</a>`, esc(when(x.updated))], d.id,
      '<button class="link danger" data-mod="delete" data-kind="library">Borrar</button>'); }).join('')}</tbody>`;
  } else {
    const snap = await recent('tips');
    body = `<thead><tr><th>Profe</th><th>Materia</th><th>Etiquetas</th><th>Cambiado</th><th></th></tr></thead><tbody>${snap.docs.map((d) => { const x = d.data(); return row([
      `<strong>${esc(x.professor)}</strong>`, esc(x.course ?? ''), `<span class="fine">${esc((x.tags ?? []).join(', '))}</span>`, esc(when(x.updated))], d.id,
      '<button class="link danger" data-mod="delete" data-kind="tips">Borrar</button>'); }).join('')}</tbody>`;
  }
  return `${tabs}${packCard}<section class="set glass"><div class="table-wrap"><table class="adm-table">${body}</table></div>
    <p class="fine">Lo más reciente primero. Ocultar deja el contenido solo para quien lo publicó; borrar no se deshace.</p></section>`;
}

// Firestore's usage against the free quota, from Cloud Monitoring. The quota resets at midnight in California.
function sinceMidnightPacific() {
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return new Date(now - ((+p.hour * 3600 + +p.minute * 60 + +p.second) * 1000));
}
async function metric(types, start, end, reducer = 'ALIGN_SUM', period = null) {
  for (const type of types) {
    const seconds = period ?? Math.max(60, Math.ceil((end - start) / 1000));
    const q = new URLSearchParams({ filter: `metric.type="${type}"`, 'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString(),
      'aggregation.alignmentPeriod': `${seconds}s`, 'aggregation.perSeriesAligner': reducer, 'aggregation.crossSeriesReducer': 'REDUCE_SUM' });
    const r = await gapi('GET', `https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${q}`);
    const points = r.timeSeries?.[0]?.points ?? [];
    if (points.length) return points.map((pt) => ({ at: pt.interval.endTime, value: Number(pt.value.int64Value ?? pt.value.doubleValue ?? 0) }));
  }
  return [];
}
async function usageSection() {
  if (!settings.get().googleClientId || !connected()) return googleCard();
  const end = new Date(); const start = sinceMidnightPacific();
  const READS = ['firestore.googleapis.com/document/read_ops_count', 'firestore.googleapis.com/document/read_count'];
  const WRITES = ['firestore.googleapis.com/document/write_ops_count', 'firestore.googleapis.com/document/write_count'];
  const DELETES = ['firestore.googleapis.com/document/delete_ops_count', 'firestore.googleapis.com/document/delete_count'];
  const sum = (pts) => pts.reduce((s, p) => s + p.value, 0);
  const [reads, writes, deletes, storage, week, users, rules] = await Promise.all([
    metric(READS, start, end), metric(WRITES, start, end), metric(DELETES, start, end),
    metric(['firestore.googleapis.com/storage/data_and_index_storage_bytes'], new Date(end - 2 * 86_400_000), end, 'ALIGN_MAX', 86_400).catch(() => []),
    metric(READS, new Date(end - 7 * 86_400_000), end, 'ALIGN_SUM', 86_400),
    gapi('POST', `${IDT}/accounts:query`, { returnUserInfo: false }).catch(() => null),
    gapi('GET', `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`).catch(() => null),
  ]);
  const max = Math.max(1, ...week.map((p) => p.value));
  return `${googleCard()}
    <section class="set glass"><h2>Hoy <small>desde la medianoche de California, cuando se reinicia la cuota gratis</small></h2>
      ${meter('Lecturas', sum(reads), QUOTA.reads)}${meter('Escrituras', sum(writes), QUOTA.writes)}${meter('Borrados', sum(deletes), QUOTA.deletes)}
      ${meter('Almacenamiento', storage.length ? storage[storage.length - 1].value : null, QUOTA.storage, bytes)}
      <p class="fine">Plan gratuito de Firebase (Spark): 50.000 lecturas, 20.000 escrituras y 20.000 borrados por día, y 1 GB guardado. Monitoring publica los datos con unos minutos de retraso.</p></section>
    <section class="set glass"><h2>Lecturas de los últimos 7 días</h2>
      <div class="bars">${week.slice().reverse().map((p) => `<div class="bar" style="--h:${((p.value / max) * 100).toFixed(1)}%" title="${n(p.value)}"><i></i><span>${esc(new Date(p.at).toLocaleDateString('es-EC', { weekday: 'short' }))}</span></div>`).join('') || '<p class="muted">Sin datos todavía.</p>'}</div></section>
    <div class="stats">${stat('Cuentas en Firebase Authentication', n(users?.recordsCount))}${stat('Reglas en vivo', rules ? esc(when(rules.updateTime)) : '—', rules ? esc(rules.rulesetName.split('/').pop()) : '')}</div>`;
}

async function eggsSection() {
  const snap = await getDocs(collection(db, 'eggs')).catch(() => null);
  const counts = Object.fromEntries((snap?.docs ?? []).map((d) => [d.id, d.data().count]));
  const f = settings.get().flags;
  return `<section class="set glass"><h2>Los easter eggs <small>${f.eggs === false ? 'apagados en «La página»' : 'encendidos'}</small></h2>
    <div class="table-wrap"><table class="adm-table"><thead><tr><th>Secreto</th><th>Cómo se encuentra</th><th>Qué pasa</th><th>Lo encontraron</th></tr></thead><tbody>
    ${EGGS.map((e) => `<tr><td><strong>${esc(e.name)}</strong></td><td>${esc(e.how)}</td><td>${esc(e.what)}</td><td><b>${n(counts[e.id] ?? 0)}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="fine">Cada navegador cuenta una vez por secreto, sin decir quién. Los sonidos, los dibujos y la música son originales.</p></section>`;
}

async function mailSection() {
  const s = settings.get();
  let live = '';
  if (s.googleClientId && connected()) {
    const cfg = await gapi('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`).catch((e) => ({ error: e.message }));
    const send = cfg.notification?.sendEmail ?? {};
    live = cfg.error ? `<p class="msg">${esc(cfg.error)}</p>` : `<div class="stats">${stat('Envío', send.method === 'CUSTOM_SMTP' ? 'Gmail (SMTP propio)' : 'Firebase')}${stat('Remitente', esc(send.smtp?.senderEmail ?? 'noreply@' + PROJECT + '.firebaseapp.com'))}${stat('Los enlaces abren', esc(new URL(send.callbackUri || `https://${PROJECT}.firebaseapp.com`).host))}</div>`;
  }
  return `${s.googleClientId ? googleCard() : ''}
    <section class="set glass"><h2>Correos de la cuenta</h2>
      <div class="stats">${stat('Confirmar el correo', s.confirmEmail ? 'Exigido' : 'Apagado')}${stat('Remitente esperado', esc(mailFrom))}</div>
      ${live}
      <p>Microsoft 365 (el correo de la USFQ) retiene los correos con enlaces a <code>${esc(PROJECT)}.firebaseapp.com</code>, y Firebase no deja cambiar el texto ni el destino de esos enlaces en este proyecto. Studium ya abre los enlaces de confirmar el correo y de cambiar la contraseña por sí mismo; falta que el correo los lleve, con un envío propio.</p></section>`;
}

async function logSection() {
  const snap = await getDocs(query(collection(db, 'audit'), orderBy('at', 'desc'), limit(150)));
  return `<section class="set glass"><h2>Registro <small>Cada cambio hecho desde este panel</small></h2>
    ${snap.empty ? '<p class="muted">Todavía no hay cambios.</p>' : `<ol class="audit">${snap.docs.map((d) => { const x = d.data(); return `<li><time>${esc(when(x.at))}</time><div><strong>${esc(x.action)}</strong>${x.detail ? `<p>${esc(x.detail)}</p>` : ''}<small>${esc(x.by)}</small></div></li>`; }).join('')}</ol>`}</section>`;
}

const RENDER = { resumen: summary, acceso: accessSection, pagina: pageSection, cuentas: accountsSection, contenido: contentSection, uso: usageSection, eggs: eggsSection, correo: mailSection, registro: logSection };

export async function renderAdmin(which = section) {
  section = SECTIONS[which] ? which : 'resumen';
  $('#adm-tabs').innerHTML = Object.entries(SECTIONS).map(([k, l]) => `<a href="#/admin/${k}" aria-current="${k === section}">${esc(l)}</a>`).join('');
  $('#adm-refreshed').textContent = '';
  const body = $('#adm-body');
  body.innerHTML = '<p class="status">Cargando…</p>';
  try {
    body.innerHTML = await RENDER[section]();
    $('#adm-refreshed').textContent = `Actualizado ${new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}`;
    rise(body, ':scope > *');
  } catch (error) {
    console.error(error);
    body.innerHTML = `<section class="set glass"><p class="msg">${esc(error.message || 'No se pudo cargar.')}</p>${error instanceof GoogleError ? googleCard() : ''}</section>`;
  }
}

/* ---------- actions ---------- */
async function saveSettings() {
  const before = settings.get();
  const what = changes(normalize(before), normalize(draft));
  if (!what) return;
  await settings.save(draft, email(), 'Ajustes', what);
  draft = null;
  ctx.toast('Ajustes guardados.');
  renderAdmin();
}
async function accountAction(kind, uid, mail) {
  const u = accounts?.find((x) => x.localId === uid);
  const claims = JSON.parse(u?.customAttributes || '{}');
  if (kind === 'delete') await gapi('POST', `${IDT}/accounts:delete`, { localId: uid });
  if (kind === 'disable' || kind === 'enable') await gapi('POST', `${IDT}/accounts:update`, { localId: uid, disableUser: kind === 'disable' });
  if (kind === 'admin' || kind === 'unadmin') {
    if (kind === 'admin') claims.admin = true; else delete claims.admin;
    await gapi('POST', `${IDT}/accounts:update`, { localId: uid, customAttributes: JSON.stringify(claims) });
  }
  const words = { delete: 'Cuenta borrada', disable: 'Cuenta desactivada', enable: 'Cuenta activada', admin: 'Admin nuevo', unadmin: 'Admin quitado' };
  await audit(words[kind], mail);
  accounts = null;
  ctx.toast(`${words[kind]}: ${mail}`);
  renderAdmin('cuentas');
}
async function moderate(kind, id, action) {
  const batch = writeBatch(db);
  if (action === 'delete') {
    if (kind === 'guides') { batch.delete(doc(db, 'catalog', id)); batch.delete(doc(db, 'guides', id)); batch.delete(doc(db, 'owners', id)); }
    else if (kind === 'contributions' || kind === 'library') { batch.delete(doc(db, kind, id)); batch.delete(doc(db, 'owners', id)); }
    else batch.delete(doc(db, kind, id));
  } else {
    const visibility = action === 'hide' ? 'private' : 'public';
    if (kind === 'guides') { batch.update(doc(db, 'catalog', id), { visibility, updated: serverTimestamp() }); batch.update(doc(db, 'guides', id), { visibility, updated: serverTimestamp() }); }
    else batch.update(doc(db, kind, id), { visibility, updated: serverTimestamp() });
  }
  // A contribution that stops being public leaves every map at once, even while it is still in the pack.
  if (kind === 'contributions' && action !== 'show') batch.set(doc(db, 'removed', id), { at: serverTimestamp() });
  batch.set(doc(collection(db, 'audit')), { action: { delete: 'Contenido borrado', hide: 'Contenido ocultado', show: 'Contenido mostrado' }[action], detail: `${KINDS[kind]}: ${id}`, by: email(), at: serverTimestamp() });
  await batch.commit();
  ctx.toast({ delete: 'Borrado.', hide: 'Ocultado.', show: 'Visible otra vez.' }[action]);
  await ctx.refresh?.();
  renderAdmin('contenido');
}
// A destructive button asks once more before acting.
function armed(button, label) {
  if (button.dataset.armed === '1') return true;
  button.dataset.armed = '1';
  const before = button.textContent;
  button.textContent = label;
  setTimeout(() => { if (button.isConnected) { button.dataset.armed = ''; button.textContent = before; } }, 4000);
  return false;
}

export function mountAdmin(context) {
  ctx = context;
  const view = $('#view-admin');
  $('#adm-refresh').addEventListener('click', () => { accounts = null; renderAdmin(); });
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.admConnect !== undefined) { await connect(); accounts = null; renderAdmin(); }
      if (t.dataset.admDisconnect !== undefined) { globalThis.google?.accounts?.oauth2?.revoke?.(google.token); google.token = ''; accounts = null; renderAdmin(); }
      if (t.dataset.admClientid !== undefined) { draft = structuredClone(settings.get()); draft.googleClientId = ''; await settings.save(draft, email(), 'Ajustes', 'ID de cliente de Google quitado'); draft = null; renderAdmin(); }
      if (t.dataset.admSave !== undefined) await saveSettings();
      if (t.dataset.admDiscard !== undefined) { draft = null; renderAdmin(); }
      if (t.dataset.cNew !== undefined) { draft.communities.push({ id: `comunidad-${draft.communities.length + 1}`, name: 'Nueva', full: '', domains: [], active: false }); renderAdmin(); }
      const card = t.closest('.community');
      if (card && t.dataset.cRemove) { const c = draft.communities[Number(card.dataset.i)]; c.domains = c.domains.filter((d) => d !== t.dataset.cRemove); renderAdmin(); }
      if (card && t.dataset.cDelete !== undefined && armed(t, '¿Eliminarla? Pulsa otra vez')) { draft.communities.splice(Number(card.dataset.i), 1); renderAdmin(); }
      const row = t.closest('tr');
      if (row && t.dataset.acc && (t.dataset.acc !== 'delete' || armed(t, '¿Borrar? Pulsa otra vez'))) { t.disabled = true; await accountAction(t.dataset.acc, row.dataset.uid, row.dataset.email); }
      if (row && t.dataset.mod && (t.dataset.mod !== 'delete' || armed(t, '¿Borrar? Pulsa otra vez'))) { t.disabled = true; await moderate(t.dataset.kind, row.dataset.id, t.dataset.mod); }
      if (t.dataset.compile !== undefined) {
        t.disabled = true;
        const r = await compilePacks(email(), (step) => { t.textContent = step; });
        await audit('Paquetes compilados', `${r.count} aportes en ${r.parts} partes (${Math.round(r.bytes / 1000)} KB)`);
        ctx.toast(`Listo: ${r.count} aportes en ${r.parts} ${r.parts === 1 ? 'parte' : 'partes'}.`);
        renderAdmin('contenido');
      }
    } catch (error) { t.disabled = false; ctx.toast(error.message || ctx.explain(error)); }
  });
  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      if (form.id === 'adm-gclient') {
        const id = form.querySelector('[name="clientId"]').value.trim();
        if (!/\.apps\.googleusercontent\.com$/.test(id)) { ctx.toast('Ese no parece un ID de cliente de Google.'); return; }
        const next = structuredClone(settings.get()); next.googleClientId = id;
        await settings.save(next, email(), 'Ajustes', 'ID de cliente de Google'); renderAdmin();
      }
      if (form.dataset.cAdd !== undefined) {
        const input = form.querySelector('[name="domain"]');
        const d = input.value.trim().toLowerCase().replace(/^@/, '');
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) { ctx.toast('Escribe un dominio, como estud.universidad.edu'); return; }
        const c = draft.communities[Number(form.closest('.community').dataset.i)];
        if (!c.domains.includes(d)) c.domains.push(d);
        renderAdmin();
      }
    } catch (error) { ctx.toast(error.message || ctx.explain(error)); }
  });
  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'adm-kind') { contentKind = t.value; renderAdmin('contenido'); return; }
    if (!draft) return;
    if (t.dataset.admConfirm !== undefined) draft.confirmEmail = t.checked;
    if (t.dataset.flag) draft.flags[t.dataset.flag] = t.checked;
    if (t.dataset.provider) draft.providers = t.checked ? [...new Set([...draft.providers, t.dataset.provider])] : draft.providers.filter((p) => p !== t.dataset.provider);
    if (t.dataset.ann) draft.announcement[t.dataset.ann] = t.type === 'checkbox' ? t.checked : t.value;
    const card = t.closest('.community');
    if (card && t.dataset.c) draft.communities[Number(card.dataset.i)][t.dataset.c] = t.type === 'checkbox' ? t.checked : t.value;
    const bar = $('.save-bar', view);
    if (bar) bar.outerHTML = saveBar();
  });
  view.addEventListener('input', (e) => {
    const q = e.target.id === 'adm-q' ? e.target.value.trim().toLowerCase() : null;
    if (q !== null) for (const tr of view.querySelectorAll('#adm-accounts tbody tr')) tr.hidden = !!q && !tr.dataset.email.toLowerCase().includes(q);
  });
}
