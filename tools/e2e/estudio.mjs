// Usage: node tools/e2e/estudio.mjs <account.json> <folder for screenshots> [port of the page, 5191]
// Needs: the emulators (auth, firestore), node tools/dev.mjs --port <port> --emulators, node tools/seed-emulators.mjs.
// End to end, as a person, at his screen (1463×746): Guías → «Hacer una guía» → every question of a study guide with
// a file of notes → «Crear la guía y escribirla después» (no AI in the emulators) → the guide not written yet; then a
// guide written by hand into the database (as an AI would return it) is drawn: section 0, a topic with a worked
// example, formulas, practice and exam questions, the final review and the flashcards; «Tus guías» lists it; a draft
// left with «Guardar y salir» waits there and comes back with «Seguir».
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { open } from './cdp.mjs';

const [, , ACCOUNT, SHOTS, PORT = '5191', READER = ''] = process.argv;
mkdirSync(SHOTS, { recursive: true });
const { email, password } = JSON.parse(readFileSync(ACCOUNT, 'utf8'));
const B = await open({ shots: SHOTS });
await B.send('Network.enable');
await B.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Safari/537.36', acceptLanguage: 'es-EC,es' });
await B.send('Emulation.setLocaleOverride', { locale: 'es-EC' }).catch(() => {});
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `http://localhost:${PORT}/studium/`;
const head = () => B.js(`return document.querySelector('#eg-body .tj-wizard h1')?.textContent ?? ''`);
const click = (text) => B.js(`const b = [...document.querySelectorAll('#eg-body .tj-wizard button')].find((x) => x.offsetParent && x.textContent.trim().startsWith(${JSON.stringify(text)})); b?.click(); return !!b;`);
const type = (sel, v) => B.js(`const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
try {
  await B.go(`${BASE}#/entrar`);
  await B.wait(`document.querySelector('input[type=password]')?.offsetParent`);
  await B.js(`const f = [...document.querySelectorAll('input')].filter((i) => i.offsetParent); const em = f.find((i) => i.type === 'email' || /mail/i.test(i.name)); const pw = f.find((i) => i.type === 'password'); em.value = ${JSON.stringify(email)}; pw.value = ${JSON.stringify(password)}; em.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('input', { bubbles: true })); pw.form.requestSubmit();`);
  await W(2500);
  await B.js(`localStorage.setItem('studium-lang', 'es');`);

  // Estudiar: the same page as Trabajos — a title, «Empezar una guía nueva», no tabs, no «en construcción» tape
  await B.js(`location.hash = '#/estudiar';`);
  await B.wait(`document.querySelector('#view-estudio:not([hidden]) [data-tj="study-new"]')`);
  const page = await B.js(`const v = document.querySelector('#view-estudio'); return { h1: v.querySelector('.page-head h1')?.textContent, tape: !!document.querySelector('#view-estudio .wip-tape, #view-catalog .wip-tape'), tabs: !!document.querySelector('.subtabs'), desk: !!v.querySelector('a[href="#/estudiar/escritorio"]'), trabajosLike: !!v.querySelector('.page-head .button.primary') && !!v.querySelector('.tj-lede') }`);
  ok('Estudiar opens as Trabajos: title, «Empezar una guía nueva», no tabs, no tape', page.h1 === 'Estudiar' && page.trabajosLike && !page.tape && !page.tabs && page.desk, JSON.stringify(page));
  await B.shot('01-estudiar');
  await B.js(`location.hash = '#/trabajos';`); await W(1500); await B.shot('01b-trabajos');
  await B.js(`location.hash = '#/estudiar';`); await W(1500);
  await B.js(`document.querySelector('#eg-body [data-tj="study-new"]').click();`);
  await B.wait(`document.querySelector('#eg-body .tj-wizard h1')`);
  ok('1 · asks what to study', /Qué vas a estudiar/.test(await head()), await head());
  await B.shot('02-materia');
  await click('Siguiente');
  await W(300);
  ok('the course is needed', /Escríbelo para seguir/.test(await B.js(`return document.querySelector('#eg-body .tj-warn')?.textContent ?? ''`)));
  await type('#eg-body input[name="v"]', 'Cálculo II');
  await click('Siguiente'); await W(300);
  ok('2 · for which evaluation', /Para qué evaluación/.test(await head()), await head());
  await type('#eg-body input[name="v"]', 'Examen 2');
  await click('Siguiente'); await W(300);
  ok('3 · when', /Cuándo es/.test(await head()), await head());
  await B.js(`const d = document.querySelector('#eg-body input[name="date"]'); d.value = '2026-12-04'; d.dispatchEvent(new Event('input', { bubbles: true }));`);
  await click('Siguiente'); await W(300);
  ok('4 · the material', /Trae tu material/.test(await head()), await head());
  const skipWord = await B.js(`return [...document.querySelectorAll('#eg-body [data-tj="skip"]')].map((b) => b.textContent.trim()).join('|')`);
  ok('with nothing brought, «No tengo material»', /No tengo material/.test(skipWord), skipWord);
  const notes = path.resolve(SHOTS, 'apuntes-calculo.txt');
  writeFileSync(notes, 'Semana 9: derivadas parciales. Semana 10: gradiente y derivada direccional. Semana 11: multiplicadores de Lagrange.\nEjercicio del examen 1: hallar el máximo de f(x,y)=xy sujeto a x+y=10.\n');
  await B.setFiles('#eg-body input[name="files"]', [notes]);
  await B.wait(`document.querySelector('#eg-body .tj-files li')`);
  await B.shot('03-material');
  await click('Siguiente'); await W(300);
  ok('5 · what enters', /Qué entra/.test(await head()), await head());
  await type('#eg-body textarea[name="scope"]', 'Desde derivadas parciales hasta Lagrange.');
  await B.js(`document.querySelector('#eg-body input[name="p-style"][value="problems"]').click();`);
  await W(300);
  await B.shot('04-que-entra');
  await click('Siguiente'); await W(300);
  ok('6 · how to study', /Cómo quieres estudiar/.test(await head()), await head());
  await B.js(`document.querySelector('#eg-body input[name="goal"][value="practice"]').click();`);
  await W(300);
  await B.shot('05-como-estudias');
  await click('Siguiente'); await W(300);
  ok('7 · the AI', /Tu IA para esta guía/.test(await head()), await head());
  await B.shot('06-tu-ia');
  await click('Siguiente'); await W(300);
  ok('8 · how the guide should be', /Cómo quieres la guía/.test(await head()), await head());
  await B.shot('07-como-la-quieres');
  await click('Siguiente'); await W(300);
  ok('9 · all set', /Todo listo/.test(await head()), await head());
  const sentence = await B.js(`return document.querySelector('#eg-body .tj-sentence')?.textContent ?? ''`);
  ok('the last screen says what will happen', /Cálculo II/.test(sentence) && /Examen 2/.test(sentence) && /1 archivo/.test(sentence), sentence);
  const prompt = await B.js(`return document.querySelector('#eg-body details pre, #eg-body .ai-prompt pre')?.textContent ?? ''`);
  ok('the instructions are a study guide\'s', /guía de estudio/.test(prompt) && /Problemas|problemas para resolver/.test(prompt) && /practicar mucho/.test(prompt), prompt.slice(0, 120));
  await B.shot('08-todo-listo');
  await click('Crear la guía');
  await B.wait(`/^#\\/estudio\\/[\\w-]{10,}/.test(location.hash)`, 20000);
  ok('created; opens #/estudio/<id>', true, await B.js('return location.hash'));
  await B.wait(`document.querySelector('#tjg-body .tjg-app')`);
  const empty = await B.js(`return document.querySelector('#tjg-body')?.innerText ?? ''`);
  ok('not written yet: says so, in a study guide\'s words', /todavía no está escrita/.test(empty) && /tu material/.test(empty) && !/Pide a un amigo/.test(empty), empty.slice(0, 200));
  await B.shot('09-sin-escribir');

  // A guide as an AI returns it, written into the database by its owner.
  const outline = { titulo: 'Examen 2', curso: 'Cálculo II', resumen: 'Optimización con varias variables.', de_que_trata: 'Entra la **optimización** de funciones de dos variables: dónde una función crece más rápido y cómo hallar máximos con una restricción.', diagrama: 'flowchart LR\n  A["eth0 gestión (ruta por defecto hacia Internet)"] --> B["Gradiente"] --> C["Lagrange"]', reglas: { entregables: [], calificacion: ['4 problemas de desarrollo, 25 % cada uno'], modalidad: 'Escrito, sin calculadora, 2 horas', defensa: '', fechas: ['4 de diciembre'] }, razonamiento: 'Tus apuntes cubren las semanas 9 a 11.', enunciado_textual: '', partes: [], requisitos: [{ id: 'R1', texto: 'Calcular el **gradiente** de una función', cita: 'Semana 10', peso: '25 %', material: 'apuntes, semana 10' }], fuentes: [{ id: 'F1', titulo: 'Clase 9: derivadas parciales', tipo: 'clase', archivo: 'apuntes-calculo.txt' }, { id: 'F2', titulo: 'Examen 1', tipo: 'examen' }], glosario: [{ termino: 'MCD', siglas: 'Máximo Común Divisor', definicion: 'El mayor número que divide a dos números a la vez.' }, { termino: 'gradiente', definicion: 'El vector de las derivadas parciales: apunta hacia donde la función crece más rápido.' }, { termino: 'multiplicador', definicion: 'El número λ que iguala los gradientes en el método de Lagrange.' }], hitos: [{ id: 'H1', titulo: 'Gradiente', entregable: 'podrás calcular el gradiente y la derivada direccional', listo_cuando: 'resuelves un ejercicio del examen 1 sin mirar', depende: [], fuentes: ['F1'], pasos: [{ id: 'H1.1', titulo: 'El gradiente', parte: 'A', requisitos: ['R1'] }] }, { id: 'H2', titulo: 'Multiplicadores de Lagrange', entregable: 'podrás hallar máximos con una restricción', listo_cuando: 'resuelves el ejercicio del examen 1', depende: ['H1'], pasos: [{ id: 'H2.1', titulo: 'El método', parte: 'A', requisitos: [] }] }], avisos: ['Olvidar comprobar los **bordes** del dominio.'], preguntas: [] };
  const h1 = { id: 'H1', pasos: [{ id: 'H1.1', objetivo: 'Calcular el gradiente de cualquier función de dos variables.', clave: 'El **gradiente** apunta hacia donde la función sube más rápido.', teoria: 'Para $f(x,y)$, el gradiente es $\\nabla f = (f_x, f_y)$.\n\nSu **longitud** dice qué tan rápido sube: $$|\\nabla f| = \\sqrt{f_x^2 + f_y^2}$$', diagrama: '', ejemplos: [{ enunciado: 'Halla $\\nabla f$ para $f(x,y) = x^2 y$.', solucion: 'Derivamos: $f_x = 2xy$ y $f_y = x^2$.\n\nEntonces **$\\nabla f = (2xy, x^2)$**.' }], tu_turno: ['Calcula $\\nabla f$ para $f = e^{xy}$.'], codigo: [{ archivo: 'calculo/gradiente.py', proposito: 'Calcula el gradiente con SymPy para comprobar tus cuentas.', lenguaje: 'python', codigo: 'import sympy as sp\nx, y = sp.symbols("x y")', lineas: [{ n: 1, explicacion: 'Importa **SymPy**.' }, { n: 2, explicacion: 'Crea los símbolos.' }] }, { archivo: 'terminal', proposito: 'Instala SymPy.', lenguaje: 'text', codigo: 'pip install sympy', lineas: [{ n: 1, explicacion: 'Lo instala.' }] }],
    escena: { titulo: 'Una tabla y sus celdas', ancho: 760, alto: 300, elementos: [
      { tipo: 'celdas', id: 'm', x: 40, y: 60, n: 6, w: 80, h: 44, textos: ['3', '7', '', '', '', ''], etiquetas: ['0', '1', '2', '3', '4', '5'], texto: 'Valores' },
      { tipo: 'tabla', id: 't', x: 40, y: 150, columnas: ['Clave', 'Lugar'], filas: [['a', '0'], ['b', '1']], anchoCol: 120 },
      { tipo: 'flecha', de: 't.1.1', a: 'm.1', texto: 'apunta' },
      { tipo: 'caja', id: 'nuevo', x: 520, y: 150, w: 160, h: 60, texto: 'c = 9', oculto: true, color: 'verde' } ],
      pasos: [{ texto: 'La tabla dice dónde está b.', resaltar: ['t.1.1'] }, { texto: 'Llega c y se guarda en el lugar 2.', mostrar: ['nuevo'], cambiar: [{ id: 'm.2', texto: '9', color: 'verde' }] }] },
    recorrido: { diagrama: 'flowchart LR\n  P["Punto"] --> G["Gradiente"] --> D["Dirección"]', pasos: [{ nodos: ['P'], texto: 'Partes de un punto.', comando: '' }, { nodos: ['P', 'G'], texto: 'Calculas el gradiente ahí.', comando: 'grad = (fx, fy)' }, { nodos: ['G', 'D'], texto: 'Apunta hacia donde sube más.', comando: '' }] }, librerias: [], esperado: '', comprueba: [{ pregunta: '¿Hacia dónde apunta el gradiente?', respuesta: 'Hacia donde la función **crece más rápido**.' }], defensa: [{ pregunta: 'Halla la derivada direccional de $f = xy$ en $(1,2)$ hacia $(3,4)/5$.', respuesta: '$\\nabla f = (2, 1)$; el producto con $(3,4)/5$ da **$2$**.' }], commit: '', reunion: '' }] };
  const id = (await B.js('return location.hash')).split('/')[2];
  // His case: generation broke before the guide was saved. A simulated bridge (paired; its answers faked in the page)
  // has a Claude Code session that wrote esquema.json and H1.json; «Recoger lo que hizo tu IA», folded under «Escribir la
  // guía», builds the guide from them with no AI request.
  await B.js(`const v = await import('/studium/assets/vault.js'); const ai = await import('/studium/assets/ai.js'); await v.set({ ...v.get(), bridge: 'prueba' });
    const raw = JSON.parse(localStorage.getItem('studium-ai') ?? '{}');
    const engines = [{ id: 'claude', name: 'Claude Code', ready: true, models: [{ id: 'claude-sonnet-5-5' }], accounts: [{ id: 'claude-a', email: 'a@prueba.ec', plan: 'pro', ready: true }] }];
    raw.bridge = { at: Date.now(), port: 41799, version: ai.BRIDGE_VERSION, cwd: '', account: 'claude-a', folders: [], engines }; localStorage.setItem('studium-ai', JSON.stringify(raw));
    window.__g = []; window.__f0 = window.fetch; const J = (o, st = 200) => Promise.resolve(new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }));
    const outputs = { 'esquema.json': ${JSON.stringify(JSON.stringify(outline))}, 'H1.json': ${JSON.stringify(JSON.stringify(h1))} };
    window.fetch = (u, o) => { const url = String(u); if (!/127\.0\.0\.1:41799/.test(url)) return window.__f0(u, o); const path = new URL(url).pathname; window.__g.push(path);
      if (path === '/v1/hello') return J({ name: 'studium-bridge', version: ai.BRIDGE_VERSION });
      if (path === '/v1/status') return J({ version: ai.BRIDGE_VERSION, cwd: '', engines });
      if (path === '/v1/recoverable') return J({ sessions: [{ session: 'abcd1234-0000-0000-0000-000000000000', at: '2026-11-24T04:47:07.591Z', cwd: 'C:\\\\Quiz 2', files: { 'esquema.json': 2000, 'H1.json': 3000 } }] });
      if (path === '/v1/recover') return J({ session: 'abcd1234-0000-0000-0000-000000000000', at: '2026-11-24T04:47:07.591Z', cwd: 'C:\\\\Quiz 2', outputs });
      if (path === '/v1/results') return J({ results: [] }); if (path === '/v1/folders') return J({ folders: [], modes: {} }); return J({}); };
    location.hash = '#/estudiar'; return 1;`);
  await W(800); await B.js(`history.back(); return 1;`);
  await B.wait(`document.querySelector('#tjg-body .tj-more [data-tj="collect-open"]')`, 15000).catch(() => {});
  const pre = await B.js(`const m = document.querySelector('#tjg-body .tj-more'); return { fold: !!m, closed: m ? !m.open : null, fab: !!document.querySelector('.tj-collectfab') }`);
  ok('before the guide exists, «Recoger lo que hizo tu IA» is folded under «Más opciones» of the write card (no button on the main screen)', pre.fold && pre.closed && !pre.fab, JSON.stringify(pre));
  await B.js(`const m = document.querySelector('#tjg-body .tj-more'); m.open = true; m.querySelector('[data-tj="collect-open"]').click(); return 1;`);
  await B.wait(`document.querySelector('.tj-collectpop [data-tj="collect-apply"]')`, 15000).catch(() => {});
  const preList = await B.js(`return document.querySelector('.tj-collectpop')?.innerText ?? ''`);
  ok('…its panel finds the session that wrote the outline and a chapter', /esquema, H1/.test(preList) && /Aplicar a esta guía \(2 partes\)/.test(preList), preList.slice(0, 300));
  await B.js(`document.querySelector('.tj-collectpop [data-tj="collect-apply"]').click(); return 1;`);
  await B.wait(`document.querySelector('#tjg-body #cap-H1')`, 20000).catch(() => {});
  const built = await B.js(`return { chapter: !!document.querySelector('#tjg-body #cap-H1'), gradient: /Gradiente|gradiente/.test(document.querySelector('#tjg-body')?.innerText ?? ''), runs: window.__g.filter((x) => x === '/v1/run').length }`);
  ok('…and «Aplicar» builds the guide from them, with no AI request', built.chapter && built.gradient && built.runs === 0, JSON.stringify(built));
  await B.shot('09b-recogida-antes');
  await B.js(`window.fetch = window.__f0; const v = await import('/studium/assets/vault.js'); await v.set({ ...v.get(), bridge: '' }); const raw = JSON.parse(localStorage.getItem('studium-ai') ?? '{}'); raw.bridge = null; localStorage.setItem('studium-ai', JSON.stringify(raw)); return 1;`);
  await B.js(`const F = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore-lite.js'); const { db, gzip, auth } = await import('/studium/assets/data.js');
    const pack = async (v) => F.Bytes.fromUint8Array(await gzip(JSON.stringify(v)));
    await F.setDoc(F.doc(db, 'trabajos', ${JSON.stringify(id)}), { outline: await pack(${JSON.stringify(outline)}), updated: F.serverTimestamp() }, { merge: true });
    await F.setDoc(F.doc(db, 'trabajos', ${JSON.stringify(id)}, 'hitos', 'H1'), { data: await pack(${JSON.stringify(h1)}), encoding: 'gzip', by: auth.currentUser.uid, updated: F.serverTimestamp() });
    return true;`);
  await B.js(`location.reload();`); // a fresh page reads the guide from the database
  await W(1500);
  await B.wait(`document.querySelector('#tjg-body #cap-entrega')`, 20000);
  await W(2500); // diagrams and formulas
  const text = await B.js(`return document.querySelector('#tjg-body')?.innerText ?? ''`);
  ok('the top bar says «GUÍA DE ESTUDIO» and its chapters', /GUÍA DE ESTUDIO/.test(text) && /Qué entra/.test(text) && /Repaso/.test(text));
  ok('section 0: Ojo con, Cómo es la evaluación, Lo que tienes que saber hacer', /Ojo con/.test(text) && /Cómo es la evaluación/.test(text) && /Lo que tienes que saber hacer/.test(text));
  ok('no group parts, GitHub or defense in a study guide', !/Cómo se reparten|GitHub|Persona A|Practicar la defensa/.test(text));
  ok('a worked example and exam questions', /Ejemplo resuelto/.test(text) && /Así te lo pueden preguntar/.test(text) && /Ahora tú, a mano/.test(text));
  ok('formulas drawn by KaTeX', await B.js(`return document.querySelectorAll('#tjg-body .katex').length`) > 3, String(await B.js(`return document.querySelectorAll('#tjg-body .katex').length`)));
  ok('the missing topic can be written', /Falta un tema por escribir/.test(text));
  ok('checks: «Lo practiqué», «Lo entiendo»', /Lo practiqué/.test(text) && /Lo entiendo/.test(text));
  ok('KaTeX styled (its stylesheet loaded)', await B.js(`return getComputedStyle(document.querySelector('#tjg-body .katex-mathml') ?? document.body).position === 'absolute'`));
  const wide = await B.js(`const v = document.querySelector('#view-trabajo'); return [v.scrollWidth, v.clientWidth, [...document.querySelectorAll('#tjg-body *')].filter((e) => e.getBoundingClientRect().right > v.clientWidth + 1).slice(0, 4).map((e) => e.tagName + '.' + e.className).join(' ')]`);
  ok('no sideways scroll in the guide', wide[0] <= wide[1] + 1, JSON.stringify(wide));
  await B.shot('10-guia-arriba');
  await B.js(`document.querySelector('#paso-H1\\\\.1').scrollIntoView();`); await W(600);
  await B.shot('11-concepto');
  await B.js(`document.querySelector('#paso-H1\\\\.1 input[data-tj="u"]').click();`); await W(1200);
  const pctNow = await B.js(`return document.querySelector('#tjg-body nav.top .pct')?.textContent ?? ''`);
  ok('«Lo entiendo» moves the top bar', pctNow === '50%', pctNow);
  await B.js(`document.querySelector('#cap-entrega').scrollIntoView();`); await W(600);
  await B.shot('12-repaso-final');
  const end = await B.js(`return document.querySelector('#cap-entrega')?.innerText ?? ''`);
  ok('final review: understood %, mock exam, flashcards', /Entiendes/.test(end) && /Simulacro/.test(end) && /Tarjetas de términos/.test(end), end.slice(0, 160));

  // Code says its file; a walkthrough moves; the general figure is at hand; diagrams are not cut
  const head1 = await B.js(`return [...document.querySelectorAll('#paso-H1\\\\.1 .fig.code .fh')].map((x) => x.innerText).join(' | ')`);
  ok('code says its file, its path and its language («text» is gone)', /calculo\/gradiente\.py/.test(head1) && /python/i.test(head1) && /terminal/i.test(head1) && !/\bTEXT\b/i.test(head1), head1);
  ok('…and what the file is for', /SymPy para comprobar/.test(await B.js(`return document.querySelector('#paso-H1\\\\.1 .fpurpose')?.textContent ?? ''`)));
  await B.js(`document.querySelector('#paso-H1\\\\.1 figure.walk').scrollIntoView({ block: 'center' });`); await W(800);
  const lit0 = await B.js(`return document.querySelectorAll('#paso-H1\\\\.1 figure.walk g.node.lit').length`);
  await B.js(`document.querySelector('#paso-H1\\\\.1 figure.walk [data-go="1"]').click();`); await W(500);
  const walk = await B.js(`const f = document.querySelector('#paso-H1\\\\.1 figure.walk'); return { lit: f.querySelectorAll('g.node.lit').length, edge: f.querySelectorAll('path.walk-edge').length, dot: f.querySelectorAll('.walk-dot').length, text: f.querySelector('.walk-steps li.on')?.innerText, n: f.querySelector('[data-walk-n]').textContent }`);
  ok('the walkthrough lights its first frame', lit0 === 1, String(lit0));
  ok('▶ moves to the next frame: two nodes, their edge, a travelling dot, the command', walk.lit === 2 && walk.edge === 1 && walk.dot === 1 && /gradiente ahí/.test(walk.text) && /grad =/.test(walk.text) && walk.n === '2 de 3', JSON.stringify(walk));
  await W(400); await B.shot('14-recorrido');
  await B.js(`document.querySelector('nav.top [data-tj="figure"]').click();`); await W(1500);
  ok('«🗺 Diagrama» shows the general figure over the guide', await B.js(`return !!document.querySelector('.tj-figpop svg')`));
  const cut = await B.js(`return [...document.querySelectorAll('.tj-figpop svg g.node')].map((g) => { const fo = g.querySelector('foreignObject'); const d = fo?.querySelector('div, span'); if (!fo || !d) return 0; return d.scrollWidth - fo.getBoundingClientRect().width; }).filter((x) => x > 2).length`);
  ok('a long label is not cut', cut === 0, String(cut));
  await B.shot('15-diagrama-general');
  await B.js(`document.querySelector('nav.top [data-tj="figure"]').click();`);
  // Every template, light and dark
  for (const tpl of ['cuaderno', 'pizarra', 'revista']) {
    for (const mode of ['light', 'dark']) {
      await B.js(`const a = document.querySelector('.tjg-app'); a.dataset.template = '${tpl}'; a.dataset.theme = '${mode}'; document.querySelector('#cap-inicio').scrollIntoView();`);
      await W(300);
      const c = await B.js(`const a = document.querySelector('.tjg-app'); const lum = (rgb) => { const [r, g, b] = rgb.match(/[\\d.]+/g).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }; const bg = getComputedStyle(a).backgroundColor; const trap = document.querySelector('.trap'); return { bg: lum(bg), trap: trap ? Math.abs(lum(getComputedStyle(trap).backgroundColor) - lum(getComputedStyle(trap).color)) : 1 };`);
      ok(`${tpl} ${mode}: the page is ${mode}, «Ojo con» readable`, (mode === 'dark' ? c.bg < 0.3 : c.bg > 0.7) && c.trap > 0.4, JSON.stringify(c));
      await B.shot(`16-${tpl}-${mode}`);
    }
  }
  await B.js(`const a = document.querySelector('.tjg-app'); a.dataset.template = 'cuaderno'; a.dataset.theme = 'light';`);

  // An escena is drawn as shapes and its steps change it; acronyms in the hover; the material with synced checks
  await B.js(`document.querySelector('#paso-H1\\\\.1 figure.escena').scrollIntoView({ block: 'center' });`); await W(500);
  const es0 = await B.js(`const f = document.querySelector('#paso-H1\\\\.1 figure.escena'); return { cells: f.querySelectorAll('.es-cell').length, tds: f.querySelectorAll('.es-td').length, arrows: f.querySelectorAll('.es-arrow line').length, hiddenNew: f.querySelector('[data-es="nuevo"]').classList.contains('es-hidden') && !f.querySelector('[data-es="nuevo"]').classList.contains('es-shown') }`);
  ok('an escena is drawn as cells, a table and an arrow from a cell to a cell', es0.cells === 6 && es0.tds === 4 && es0.arrows === 1 && es0.hiddenNew, JSON.stringify(es0));
  await B.js(`const f = document.querySelector('#paso-H1\\\\.1 figure.escena'); f.querySelector('[data-go="1"]').click(); f.querySelector('[data-go="1"]').click();`); await W(700);
  const es2 = await B.js(`const f = document.querySelector('#paso-H1\\\\.1 figure.escena'); return { val: f.querySelector('[data-es="m.2"] .es-t').textContent, shown: f.querySelector('[data-es="nuevo"]').classList.contains('es-shown'), lit: f.querySelector('[data-es="m.2"]').classList.contains('es-lit'), n: f.querySelector('[data-es-n]').textContent }`);
  ok('…and its steps change the drawing itself (a value appears in its cell, a shape appears)', es2.val === '9' && es2.shown && es2.lit && es2.n === '2 de 2', JSON.stringify(es2));
  await B.shot('19-escena');
  const dfn = await B.js(`return [...document.querySelectorAll('#tjg-body dfn')].map((d) => d.title).find((t) => /MCD/.test(t)) ?? ''`);
  const gl = await B.js(`return document.querySelector('#tjg-body .gloss')?.textContent ?? ''`);
  ok('an acronym says what it stands for (in the list of terms)', /Máximo Común Divisor/.test(gl), gl.slice(0, 120));
  const src = await B.js(`return { start: document.querySelectorAll('#cap-inicio .sources li').length, end: document.querySelectorAll('#cap-H1 .sources.at-end li').length }`);
  ok('the material of the guide at the start, and each chapter its own at its end', src.start === 2 && src.end === 1, JSON.stringify(src));
  await B.js(`document.querySelector('#cap-H1 .sources.at-end input[data-tj="u"]').click();`); await W(1200);
  const synced = await B.js(`return { start: document.querySelector('#cap-inicio .sources li input[data-tj="u"]').checked, count: document.querySelector('#cap-inicio .sources h4 small')?.textContent }`);
  ok('«Lo entendí» at a chapter\'s end is the same check as at the start', synced.start && /1 de 2/.test(synced.count), JSON.stringify(synced));
  await B.js(`document.querySelector('#cap-inicio .sources').scrollIntoView({ block: 'center' });`); await W(400); await B.shot('20-material');
  // the date is the calendar's
  ok('without a calendar event, the guide offers «Agregar a mi calendario»', await B.js(`return !!document.querySelector('[data-tj="cal-add"]')`));
  await B.js(`document.querySelector('[data-tj="cal-add"]').click();`); await W(1000);
  ok('…which links it: the guide says it is in the calendar', await B.js(`return /En tu calendario/.test(document.querySelector('#tjg-body header.hero').innerText) && (await import('/studium/assets/prefs.js')).prefs.get().deadlines.some((d) => d.guide)`));
  await B.js(`const m = await import('/studium/assets/prefs.js'); m.prefs.set({ deadlines: m.prefs.get().deadlines.map((d) => d.guide ? { ...d, date: '2026-12-10' } : d) }); return 1;`);
  await B.js(`location.hash = '#/estudiar';`); await W(1200); await B.js(`history.back();`); await W(2500);
  ok('…and when the calendar date changes, the guide shows the new one', /10 de diciembre/.test(await B.js(`return document.querySelector('#tjg-body header.hero')?.innerText ?? ''`)));
  // «Pedir un cambio a tu IA» in place of the tutorial
  const fab = await B.js(`const h = document.querySelector('.tour-help'); return { ask: !!document.querySelector('.tj-askai'), tour: h ? getComputedStyle(h).display : 'none' }`);
  ok('in a guide, «Pedir un cambio a tu IA» takes the tutorial\'s place', fab.ask && fab.tour === 'none', JSON.stringify(fab));
  // His case: Studium dark, the guide in a light template, Gemini connected and the bridge not connected at this address
  await B.js(`const ai = await import('/studium/assets/ai.js'); ai.setKey('gemini', 'AIza' + 'x'.repeat(35)); const { prefs } = await import('/studium/assets/prefs.js'); prefs.set({ theme: 'dark' }); const a = document.querySelector('.tjg-app'); a.dataset.template = 'cuaderno'; a.dataset.theme = 'light'; return 1;`); await W(600);
  await B.js(`document.querySelector('.tj-askai').click();`); await W(500);
  ok('…it asks about the whole guide, with «Rehacer las gráficas»', /toda la guía/.test(await B.js(`return document.querySelector('.tj-adjpop')?.innerText ?? ''`)) && /Rehacer las gráficas/.test(await B.js(`return document.querySelector('.tj-adjpop')?.innerText ?? ''`)));
  const how = await B.js(`const h = document.querySelector('.tj-adjpop .tj-howrun'); const lum = (c) => { const n = (c.match(/[0-9.]+/g) ?? []).map(Number); if (/^oklab|^oklch/.test(c)) return n[0] > 1 ? n[0] / 100 : n[0]; const [r, g, b] = n; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }; const pick = h?.querySelector('.ai-pick'); return { bgRaw: pick ? getComputedStyle(pick).backgroundColor : '', html: h ? h.innerHTML.slice(0, 300) : '', how: !!h, pickOpen: !!pick?.open, bridgeOffer: !!h?.querySelector('[data-tj="pair-guide"]'), opts: !!h?.querySelector('.tj-bridgeopts'), watch: !!h?.querySelector('[data-tj-watch]'), pickBg: pick ? lum(getComputedStyle(pick).backgroundColor) : -1 }`);
  ok('«Cómo lo hace»: the AI with its model and effort in sight, the bridge offered even when not connected here, its options shown', how.how && how.pickOpen && how.bridgeOffer && how.opts && how.watch, JSON.stringify(how));
  ok('…in the guide light colors though Studium is dark', how.pickBg > 0.75, JSON.stringify(how));
  await B.shot('21-pedir-cambio');
  await B.js(`document.querySelector('.tj-adjpop [data-tj="adj-close"]')?.click();`);
  // A failed adjustment: the error box closes, shows the exact error first and, for an error it knows, what to do
  await B.js(`window.__f = window.fetch; window.fetch = (u, o) => /generativelanguage/.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }), { status: 400, headers: { 'content-type': 'application/json' } })) : window.__f(u, o); const ai = await import('/studium/assets/ai.js'); ai.setChoice?.('solution', { provider: 'gemini' }); return 1;`);
  await B.js(`document.querySelector('.tj-askai').click();`); await W(400);
  await B.js(`const p = document.querySelector('.tj-adjpop'); const t = p.querySelector('textarea'); t.value = 'Haz más corta la introducción.'; t.dispatchEvent(new Event('input', { bubbles: true })); p.querySelector('[type=submit], [data-tj="adj-go"], .act').click();`);
  await B.wait(`document.querySelector('.tj-error')`, 20000).catch(() => {});
  const eb = await B.js(`const e = document.querySelector('.tj-error'); if (!e) return { box: false }; const pre = e.querySelector('.tj-error-msg'); return { box: true, x: !!e.querySelector('[data-tj="err-close"]'), exact: !!pre && pre.offsetParent !== null && !pre.closest('details') && /API key not valid/.test(pre.textContent), known: /clave o la cuenta/.test(e.innerText), generic: /Suele arreglarse solo|Mira la ventana del puente/.test(e.innerText) }`);
  ok('a failed request: the error box shows the exact error first, closes with ✕, and says what to do only for a known error', eb.box && eb.x && eb.exact && eb.known && !eb.generic, JSON.stringify(eb));
  await B.shot('22-error');
  await B.js(`document.querySelector('.tj-error [data-tj="err-close"]').click();`); await W(300);
  ok('…and ✕ closes it', await B.js(`return !document.querySelector('.tj-error')`));
  await B.js(`window.fetch = window.__f; document.querySelector('.tj-adjpop [data-tj="adj-close"]')?.click(); return 1;`);
  // His case: Claude Code by the bridge with several subscriptions. The card lists every account (one without a session
  // cannot be chosen) and «Dónde trabaja» is one list with one choice marked (a simulated bridge: nothing is sent to it)
  await B.js(`const v = await import('/studium/assets/vault.js'); const ai = await import('/studium/assets/ai.js'); await v.set({ ...v.get(), bridge: 'prueba' });
    const raw = JSON.parse(localStorage.getItem('studium-ai') ?? '{}');
    raw.bridge = { at: Date.now(), port: 41799, version: ai.BRIDGE_VERSION, cwd: 'C:\\\\Users\\\\Prueba\\\\OneDrive\\\\Quiz 2', account: 'claude-a', folders: [], engines: [{ id: 'claude', name: 'Claude Code', ready: true, models: [{ id: 'claude-sonnet-5-5' }], accounts: [{ id: 'claude-a', email: 'a@prueba.ec', plan: 'pro', ready: true }, { id: 'claude-b', email: 'b@prueba.ec', plan: 'max', ready: true }, { id: 'claude-c', email: 'c@prueba.ec', ready: false }] }] };
    raw.models = { ...(raw.models ?? {}), 'bridge:claude': ['claude-sonnet-5-5'] }; localStorage.setItem('studium-ai', JSON.stringify(raw));
    ai.setChoice('solution', { provider: 'bridge:claude', model: '', effort: '' }); return 1;`);
  await B.js(`window.__b = []; window.__open = false; window.__f2 = window.fetch; const ai = await import('/studium/assets/ai.js');
    const J = (o, st = 200) => Promise.resolve(new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }));
    const engines = JSON.parse(localStorage.getItem('studium-ai')).bridge.engines;
    const ch = (t) => JSON.stringify({ id: 'H1', pasos: [{ id: 'H1.1', objetivo: 'Calcular el gradiente', teoria: t, tu_turno: ['Hazlo'] }] });
    window.fetch = (u, o) => { const url = String(u); if (!/127\.0\.0\.1:41799/.test(url)) return window.__f2(u, o); if (!window.__open) return Promise.reject(new TypeError('Failed to fetch'));
      const path = new URL(url).pathname; window.__b.push(path + new URL(url).search);
      if (path === '/v1/hello') return J({ name: 'studium-bridge', version: ai.BRIDGE_VERSION });
      if (path === '/v1/status') return J({ version: ai.BRIDGE_VERSION, cwd: 'C:\\\\Users\\\\Prueba\\\\OneDrive\\\\Quiz 2', engines });
      if (path === '/v1/run') return window.__runOk ? J({ text: 'listo', outputs: { 'H1.json': ch('AJUSTADO-DOS') }, engine: 'claude', model: 'claude-sonnet-5-5' }) : J({ error: { code: 'failed', message: 'El puente tuvo un problema inesperado.' } }, 502);
      if (path === '/v1/result') return J({ id: new URL(url).searchParams.get('id'), text: 'listo', outputs: { 'H1.json': ch('RECOGIDO-UNO') }, engine: 'claude', model: 'claude-sonnet-5-5' });
      if (path === '/v1/recoverable') return J({ sessions: [{ session: 'f013abdd-0000-4d41-82af-77028a1919bb', at: '2026-11-24T04:47:07.591Z', cwd: 'C:\\Users\\Prueba\\OneDrive\\Quiz 2', files: { 'H1.json': 900, 'H9.json': 800 } }] });
      if (path === '/v1/recover') return J({ session: 'f013abdd-0000-4d41-82af-77028a1919bb', at: '2026-11-24T04:47:07.591Z', cwd: 'C:\\Users\\Prueba\\OneDrive\\Quiz 2', outputs: { 'H1.json': ch('DEL-REGISTRO-TRES') } });
      if (path === '/v1/results') return J({ results: [] });
      if (path === '/v1/progress') return J({ unknown: true }); if (path === '/v1/folders') return J({ folders: [], modes: {} }); return J({}); }; return 1;`);
  // His report: the bridge closed, and the card offered its models and no way to reconnect. Now its state comes first.
  await B.js(`document.querySelector('.tj-askai').click();`); await B.wait(`/no responde/.test(document.querySelector('.tj-adjpop [data-bridge-state]')?.innerText ?? '')`, 10000).catch(() => {});
  const closed = await B.js(`const p = document.querySelector('.tj-adjpop'); const st = p.querySelector('[data-bridge-state]'); return { state: st?.innerText ?? '', cmd: !!st?.querySelector('code'), recheck: !!st?.querySelector('[data-tj="bridge-recheck"]'), models: !!p.querySelector('.ai-pick .ai-opts'), accounts: !!p.querySelector('.tj-accounts'), arriba: /elígelo arriba/.test(p.innerText), first: st ? st.compareDocumentPosition(p.querySelector('.tj-bridgeopts')) & 4 : 0 }`);
  ok('with the bridge closed, «Cómo lo hace» says so first, with the command to open it and «Comprobar», and offers no Claude models', /no responde/.test(closed.state) && closed.cmd && closed.recheck && !closed.models && !closed.accounts && !closed.arriba && closed.first, JSON.stringify(closed));
  await B.shot('24-puente-cerrado');
  await B.js(`window.__open = true; return 1;`);
  await B.wait(`document.querySelector('.tj-adjpop .tj-accounts')`, 12000).catch(() => {});
  const opened = await B.js(`const p = document.querySelector('.tj-adjpop'); return { state: p.querySelector('[data-bridge-state]')?.innerText ?? '', accounts: !!p.querySelector('.tj-accounts'), models: !!p.querySelector('.ai-pick') }`);
  ok('…and when the bridge is opened, the card sees it by itself and shows its models and options', /responde/.test(opened.state) && /✓/.test(opened.state) && opened.accounts && opened.models, JSON.stringify(opened));
  const acc = await B.js(`const p = document.querySelector('.tj-adjpop'); const rows = [...p.querySelectorAll('.tj-accounts .tj-pick')]; const places = [...p.querySelectorAll('.tj-places .tj-pick')]; return { accounts: rows.length, disabled: rows.filter((r) => r.querySelector('input').disabled).length, on: rows.findIndex((r) => r.classList.contains('on')), places: places.map((r) => r.querySelector('input').value), placesOn: places.filter((r) => r.classList.contains('on')).length, checked: places.filter((r) => r.querySelector('input').checked).length, primaryButtons: p.querySelectorAll('.tj-places ~ p .primary, .tj-bridgeopts .button.primary').length }`);
  ok('with Claude Code: every Claude account is listed, the one in use marked, one without a session not choosable', acc.accounts === 3 && acc.disabled === 1 && acc.on === 0, JSON.stringify(acc));
  ok('«Dónde trabaja» is one list with exactly one choice marked: no folder, the bridge\'s folder, another folder', acc.places.join() === 'temp,here,pick' && acc.placesOn === 1 && acc.checked === 1 && acc.primaryButtons === 0, JSON.stringify(acc));
  await B.js(`const r = document.querySelector('.tj-adjpop input[data-tj-account][value="claude-b"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); return 1;`); await W(500);
  const acc2 = await B.js(`const p = document.querySelector('.tj-adjpop'); const ai = await import('/studium/assets/ai.js'); return { open: !!p, chosen: ai.bridgeOf()?.account, on: p ? [...p.querySelectorAll('.tj-accounts .tj-pick')].findIndex((r) => r.classList.contains('on')) : -1 }`);
  ok('…choosing another subscription keeps the card open and is the one used', acc2.open && acc2.chosen === 'claude-b' && acc2.on === 1, JSON.stringify(acc2));
  await B.js(`document.querySelector('.tj-adjpop .tj-places').scrollIntoView({ block: 'center' });`); await W(300); await B.shot('23-cuenta-carpeta');
  // His case: the AI finished, but the page could not apply it. The bridge (simulated: its answers are faked in the
  // page) failed the request; it kept what the AI wrote, and «Recoger lo que escribió tu IA» applies it without the AI.
  await B.js(`window.__b = []; window.__runOk = false; return 1;`);
  await B.js(`const p = document.querySelector('.tj-adjpop'); const t = p.querySelector('textarea'); t.value = 'Explica mejor el gradiente.'; p.querySelector('[type=submit][data-now]').click(); return 1;`);
  await B.wait(`document.querySelector('.tj-error [data-tj="adj-collect"]')`, 20000).catch(() => {});
  ok('a failed adjustment by the bridge offers «Recoger lo que escribió tu IA»', await B.js(`return !!document.querySelector('.tj-error [data-tj="adj-collect"]')`), await B.js(`return JSON.stringify({ calls: window.__b, live: document.querySelector('.tj-adjlive, [data-adj-live]')?.innerText?.slice(0, 300) ?? '', pop: !!document.querySelector('.tj-adjpop'), toast: document.querySelector('.toast, [role=status]')?.innerText ?? '' })`));
  await B.js(`document.querySelector('.tj-error [data-tj="adj-collect"]').click(); return 1;`);
  await B.wait(`/RECOGIDO-UNO/.test(document.querySelector('#tjg-body')?.innerText ?? '')`, 15000).catch(() => {});
  const col = await B.js(`return { applied: /RECOGIDO-UNO/.test(document.querySelector('#tjg-body').innerText), asked: window.__b.filter((x) => x.startsWith('/v1/result?id=r')).length, runs: window.__b.filter((x) => x === '/v1/run').length, pend: !!JSON.parse(localStorage.getItem('studium-tj-pending') ?? '{}')[location.hash.split('/').pop()], err: !!document.querySelector('.tj-error') }`);
  ok('…which takes the result the bridge kept for that request and applies it, without asking the AI again', col.applied && col.asked === 1 && col.runs === 1 && !col.pend && !col.err, JSON.stringify(col));
  // and a request that goes well applies its answer (it failed with «Cannot destructure property 'changed'»)
  await B.js(`window.__runOk = true; document.querySelector('.tj-askai').click(); return 1;`); await W(500);
  await B.js(`const p = document.querySelector('.tj-adjpop'); const t = p.querySelector('textarea'); t.value = 'Otra vez, más claro.'; p.querySelector('[type=submit][data-now]').click(); return 1;`);
  await B.wait(`/AJUSTADO-DOS/.test(document.querySelector('#tjg-body')?.innerText ?? '')`, 15000).catch(() => {});
  const okRun = await B.js(`return { applied: /AJUSTADO-DOS/.test(document.querySelector('#tjg-body').innerText), err: document.querySelector('.tj-error')?.innerText ?? '' }`);
  ok('an adjustment that goes well is applied, with no error', okRun.applied && !okRun.err, JSON.stringify(okRun));
  // «Recoger lo que hizo tu IA» is always in the guide, and lists what Claude Code wrote (rebuilt by the bridge from its
  // record) with when, where and which parts fit this guide; applying it needs no AI request
  const main = await B.js(`return { fab: !!document.querySelector('.tj-collectfab'), floating: [...document.querySelectorAll('.tjg-app > button')].map((x) => x.textContent.trim()) }`);
  ok('no «Recoger» button on the guide\'s main screen: one floating button, «Pedir un cambio a tu IA»', !main.fab && main.floating.length === 1 && /Pedir un cambio/.test(main.floating[0]), JSON.stringify(main));
  await B.js(`document.querySelector('.tj-askai').click(); return 1;`); await W(500);
  const fold = await B.js(`const p = document.querySelector('.tj-adjpop'); const m = p?.querySelector('.tj-more'); const last = p?.querySelector('.tj-adjcard')?.lastElementChild; return { fold: !!m, closed: m ? !m.open : null, atEnd: last === m, btn: !!m?.querySelector('[data-tj="collect-open"]') }`);
  ok('…it is folded at the end of «Pedir un cambio a tu IA», under «Más opciones»', fold.fold && fold.closed && fold.atEnd && fold.btn, JSON.stringify(fold));
  await B.js(`window.__b = []; const m = document.querySelector('.tj-adjpop .tj-more'); m.open = true; m.querySelector('[data-tj="collect-open"]').click(); return 1;`);
  await B.wait(`document.querySelector('.tj-collectpop [data-tj="collect-apply"]')`, 12000).catch(() => {});
  const list = await B.js(`const p = document.querySelector('.tj-collectpop'); return { state: p?.querySelector('[data-bridge-state]')?.innerText ?? '', row: p?.querySelector('.tj-collectitems li')?.innerText ?? '', btn: p?.querySelector('[data-tj="collect-apply"]')?.innerText ?? '' }`);
  ok('…its panel shows the bridge first, then each session: when, in which folder, what it wrote, and «Aplicar a esta guía»', /responde/.test(list.state) && /Quiz 2/.test(list.row) && /H1, H9/.test(list.row) && /Aplicar a esta guía \(1 parte\)/.test(list.btn), JSON.stringify(list));
  await B.shot('25-recoger');
  await B.js(`document.querySelector('.tj-collectpop [data-tj="collect-apply"]').click(); return 1;`);
  await B.wait(`/DEL-REGISTRO-TRES/.test(document.querySelector('#tjg-body')?.innerText ?? '')`, 15000).catch(() => {});
  const ap = await B.js(`return { applied: /DEL-REGISTRO-TRES/.test(document.querySelector('#tjg-body').innerText), runs: window.__b.filter((x) => x === '/v1/run').length, recover: window.__b.filter((x) => x.startsWith('/v1/recover?')).length, closed: !document.querySelector('.tj-collectpop'), undo: !!document.querySelector('[data-tj="adj-undo"]') }`);
  ok('…«Aplicar» puts it in the guide with no AI request, and it can be undone', ap.applied && ap.runs === 0 && ap.recover === 1 && ap.closed && ap.undo, JSON.stringify(ap));
  await B.js(`window.fetch = window.__f2; return 1;`);
  await B.js(`document.querySelector('.tj-adjpop [data-tj="adj-close"]')?.click(); const v = await import('/studium/assets/vault.js'); await v.set({ ...v.get(), bridge: '' }); const raw = JSON.parse(localStorage.getItem('studium-ai') ?? '{}'); raw.bridge = null; localStorage.setItem('studium-ai', JSON.stringify(raw)); const ai = await import('/studium/assets/ai.js'); ai.setChoice('solution', { provider: 'gemini', model: '', effort: '' }); return 1;`);

  // No emoji as icons (CASPIAN): the top bar's buttons are words
  const pict = await B.js(`return [...(document.querySelector('nav.top')?.innerText ?? '')].filter((c) => /\\p{Extended_Pictographic}/u.test(c) && !'✓✕'.includes(c)).join('')`);
  ok('the guide\'s top bar has no emoji', pict === '', pict);
  // «Studium recibió una nueva actualización»: a page left open is told when version.json changes
  await B.js(`window.__f9 = window.fetch; window.fetch = (u, o) => String(u).includes('/studium/version.json') ? Promise.resolve(new Response(JSON.stringify({ name: 'studium', version: '9.9.9-prueba' }), { status: 200, headers: { 'content-type': 'application/json' } })) : window.__f9(u, o); document.dispatchEvent(new Event('visibilitychange')); return 1;`);
  for (let i = 0; i < 12 && !(await B.js(`return !!document.querySelector('.update-bar')`)); i += 1) { await B.js(`document.dispatchEvent(new Event('visibilitychange')); return 1;`); await W(2000); }
  const upd = await B.js(`const b = document.querySelector('.update-bar'); return b ? { text: b.innerText, reload: !!b.querySelector('[data-update-reload]') } : null`);
  ok('a page left open says «Studium recibió una nueva actualización», with «Recargar ahora» and Ctrl+Shift+R', !!upd && /nueva actualización/.test(upd.text) && /Ctrl\+Shift\+R/.test(upd.text) && upd.reload, JSON.stringify(upd));
  await B.shot('26-actualizacion');
  await B.js(`window.fetch = window.__f9; document.querySelector('.update-bar [data-update-later]')?.click(); return 1;`);

  // Sharing: by link, read by another account; private again
  await B.js(`document.querySelector('nav.top [data-tj="share-open"]').click();`); await W(400);
  ok('the owner finds «¿Quién ve esta guía?» in the guide', /Quién ve esta guía/.test(await B.js(`return document.querySelector('.tj-sharepop')?.innerText ?? ''`)));
  ok('…and «¿Quién puede cambiarla?»: only the owner, unless they invite; readers make their own copy', await B.js(`const t = document.querySelector('.tj-sharepop')?.innerText ?? ''; return /Quién puede cambiarla/.test(t) && /Solo tú/.test(t) && /Hacer mi copia/.test(t) && !!document.querySelector('.tj-sharepop [data-tj="invite"]')`));
  await B.js(`document.querySelector('.tj-sharepop input[value="link"]').click(); document.querySelector('.tj-sharepop [type=submit]').click();`);
  await B.wait(`/Con enlace/.test(document.querySelector('nav.top [data-tj="share-open"]')?.textContent)`, 15000);
  ok('shared by link: the top bar says so', true);
  await B.shot('17-compartir');
  if (READER) {
    const R = JSON.parse(readFileSync(READER, 'utf8'));
    const C = await open({ shots: SHOTS, port: 9335 });
    await C.go(`${BASE}#/entrar`);
    await C.wait(`document.querySelector('input[type=password]')?.offsetParent`);
    await C.js(`const f = [...document.querySelectorAll('input')].filter((i) => i.offsetParent); const em = f.find((i) => i.type === 'email' || /mail/i.test(i.name)); const pw = f.find((i) => i.type === 'password'); em.value = ${JSON.stringify(R.email)}; pw.value = ${JSON.stringify(R.password)}; em.dispatchEvent(new Event('input', { bubbles: true })); pw.dispatchEvent(new Event('input', { bubbles: true })); pw.form.requestSubmit();`);
    await W(2500);
    await C.js(`location.hash = '#/estudio/${id}';`);
    await C.wait(`document.querySelector('#tjg-body .tjg-app')`, 20000); await W(1500);
    const rt = await C.js(`return document.querySelector('#tjg-body')?.innerText ?? ''`);
    ok('another account reads the shared guide', /Gradiente/.test(rt) && /(Solo|Only) lectura/i.test(rt) && /compartida por/.test(rt), rt.slice(0, 160));
    ok('…without the owner\'s marks, buttons or material', !/Lo practiqué|Tu material, tal cual|Ajustar/.test(rt));
    await C.shot('18-lector');
    // «Hacer mi copia»: the reader forks it; the copy is theirs and private, the original stays the owner's
    ok('the reader is offered «Hacer mi copia»', await C.js(`return !!document.querySelector('nav.top [data-tj="fork"]')`));
    await C.js(`document.querySelector('nav.top [data-tj="fork"]').click(); return 1;`);
    await C.wait(`/^#\/estudio\/[\w-]{10,}/.test(location.hash) && !location.hash.includes(${JSON.stringify(id)}) && document.querySelector('#tjg-body #cap-H1')`, 20000).catch(() => {});
    const fk = await C.js(`return { hash: location.hash, own: !!document.querySelector('nav.top [data-tj="share-open"]'), ro: /Solo lectura/.test(document.querySelector('nav.top')?.innerText ?? ''), text: /Gradiente|gradiente/.test(document.querySelector('#tjg-body')?.innerText ?? ''), ask: !!document.querySelector('.tj-askai') }`);
    ok('…which makes a private guide of their own, with the same chapters, that they can change', !fk.hash.includes(id) && fk.own && !fk.ro && fk.text && fk.ask, JSON.stringify(fk));
    await C.shot('18b-mi-copia');
    await B.js(`document.querySelector('nav.top [data-tj="share-open"]').click();`); await W(400);
    await B.js(`document.querySelector('.tj-sharepop input[value="private"]').click(); document.querySelector('.tj-sharepop [type=submit]').click();`);
    await B.wait(`/Privada/.test(document.querySelector('nav.top [data-tj="share-open"]')?.textContent)`, 15000);
    await C.js(`location.hash = '#/guias';`); await W(800); await C.js(`location.reload();`); await W(2500);
    await C.js(`location.hash = '#/estudio/${id}';`); await W(3000);
    ok('private again: the other account no longer reads it', /no existe, o no es tuya/.test(await C.js(`return document.querySelector('#tjg-body')?.innerText ?? ''`)));
    C.close();
  }

  // «Tus guías» and a draft, in Estudiar as in Trabajos
  await B.js(`location.hash = '#/estudiar';`);
  await B.wait(`document.querySelector('#eg-body .tj-card a[href^="#/estudio/"]')`);
  ok('Estudiar lists the guide, with the ⋯ menu', /Examen 2/.test(await B.js(`return document.querySelector('#eg-body')?.innerText ?? ''`)) && await B.js(`return !!document.querySelector('#eg-body .tj-card .tj-menu')`));
  await B.js(`document.querySelector('#eg-body [data-tj="study-new"]').click();`);
  await B.wait(`/Qué vas a estudiar/.test(document.querySelector('#eg-body .tj-wizard h1')?.textContent)`);
  await type('#eg-body input[name="v"]', 'Física I');
  await click('Guardar y salir');
  await B.wait(`location.hash === '#/estudiar' && document.querySelector('#eg-body .tj-draft')`, 15000);
  ok('«Guardar y salir» keeps it as a draft in Estudiar', /Física I/.test(await B.js(`return document.querySelector('#eg-body')?.innerText ?? ''`)));
  await B.shot('13-tus-guias');
  await B.js(`document.querySelector('#eg-body [data-tj="draft-resume"]').click();`);
  await B.wait(`document.querySelector('#eg-body .tj-wizard h1')`);
  ok('«Seguir» brings it back where it was', await B.js(`return document.querySelector('#eg-body input[name="v"]')?.value`) === 'Física I');

  // Trabajos does not show study guides
  await B.js(`location.hash = '#/trabajos';`); await W(2000);
  ok('Trabajos does not list study guides', !/Examen 2/.test(await B.js(`return document.querySelector('#tj-body')?.innerText ?? ''`)));
} catch (e) {
  ok('ran to the end', false, e.message);
  console.log('STATE', await B.js(`return JSON.stringify({ hash: location.hash, wiz: document.querySelector('#eg-body #tj-wizard')?.dataset.d, list: document.querySelector('#eg-body')?.innerText.slice(0, 300) })`).catch((x) => x.message));
  console.log(B.logs.slice(-8).join(' | '));
  await B.shot('99-error').catch(() => {});
} finally {
  const errs = B.logs.filter((l) => /EXCEPTION|ERROR/.test(l) && !/favicon|net::ERR|Failed to load resource/.test(l));
  ok('no exceptions on the page', !errs.length, errs.slice(0, 5).join(' | '));
  console.log(results.join('\n'));
  B.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
