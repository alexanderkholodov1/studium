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

const [, , ACCOUNT, SHOTS, PORT = '5191'] = process.argv;
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

  // Guías: one action to make a guide
  await B.js(`location.hash = '#/guias';`);
  await B.wait(`document.querySelector('#view-catalog:not([hidden]) a[href="#/estudiar/guia"]')`);
  ok('Guías offers «Hacer una guía» → the new questions', true);
  await B.shot('01-guias');
  await B.js(`document.querySelector('#view-catalog a[href="#/estudiar/guia"]').click();`);
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
  const outline = { titulo: 'Examen 2', curso: 'Cálculo II', resumen: 'Optimización con varias variables.', de_que_trata: 'Entra la **optimización** de funciones de dos variables: dónde una función crece más rápido y cómo hallar máximos con una restricción.', diagrama: 'flowchart LR\n  A["Derivadas parciales"] --> B["Gradiente"] --> C["Lagrange"]', reglas: { entregables: [], calificacion: ['4 problemas de desarrollo, 25 % cada uno'], modalidad: 'Escrito, sin calculadora, 2 horas', defensa: '', fechas: ['4 de diciembre'] }, razonamiento: 'Tus apuntes cubren las semanas 9 a 11.', enunciado_textual: '', partes: [], requisitos: [{ id: 'R1', texto: 'Calcular el **gradiente** de una función', cita: 'Semana 10', peso: '25 %', material: 'apuntes, semana 10' }], glosario: [{ termino: 'gradiente', definicion: 'El vector de las derivadas parciales: apunta hacia donde la función crece más rápido.' }, { termino: 'multiplicador', definicion: 'El número λ que iguala los gradientes en el método de Lagrange.' }], hitos: [{ id: 'H1', titulo: 'Gradiente', entregable: 'podrás calcular el gradiente y la derivada direccional', listo_cuando: 'resuelves un ejercicio del examen 1 sin mirar', depende: [], pasos: [{ id: 'H1.1', titulo: 'El gradiente', parte: 'A', requisitos: ['R1'] }] }, { id: 'H2', titulo: 'Multiplicadores de Lagrange', entregable: 'podrás hallar máximos con una restricción', listo_cuando: 'resuelves el ejercicio del examen 1', depende: ['H1'], pasos: [{ id: 'H2.1', titulo: 'El método', parte: 'A', requisitos: [] }] }], avisos: ['Olvidar comprobar los **bordes** del dominio.'], preguntas: [] };
  const h1 = { id: 'H1', pasos: [{ id: 'H1.1', objetivo: 'Calcular el gradiente de cualquier función de dos variables.', clave: 'El **gradiente** apunta hacia donde la función sube más rápido.', teoria: 'Para $f(x,y)$, el gradiente es $\\nabla f = (f_x, f_y)$.\n\nSu **longitud** dice qué tan rápido sube: $$|\\nabla f| = \\sqrt{f_x^2 + f_y^2}$$', diagrama: '', ejemplos: [{ enunciado: 'Halla $\\nabla f$ para $f(x,y) = x^2 y$.', solucion: 'Derivamos: $f_x = 2xy$ y $f_y = x^2$.\n\nEntonces **$\\nabla f = (2xy, x^2)$**.' }], tu_turno: ['Calcula $\\nabla f$ para $f = e^{xy}$.'], codigo: [], librerias: [], esperado: '', comprueba: [{ pregunta: '¿Hacia dónde apunta el gradiente?', respuesta: 'Hacia donde la función **crece más rápido**.' }], defensa: [{ pregunta: 'Halla la derivada direccional de $f = xy$ en $(1,2)$ hacia $(3,4)/5$.', respuesta: '$\\nabla f = (2, 1)$; el producto con $(3,4)/5$ da **$2$**.' }], commit: '', reunion: '' }] };
  const id = (await B.js('return location.hash')).split('/')[2];
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

  // «Tus guías» and a draft
  await B.js(`location.hash = '#/guias';`);
  await B.wait(`document.querySelector('#my-guides .tj-card')`);
  ok('«Tus guías» lists it on Guías', /Examen 2/.test(await B.js(`return document.querySelector('#my-guides')?.innerText ?? ''`)));
  await B.js(`location.hash = '#/estudiar/guia';`);
  await B.wait(`/Qué vas a estudiar/.test(document.querySelector('#eg-body .tj-wizard h1')?.textContent)`);
  await type('#eg-body input[name="v"]', 'Física I');
  await click('Guardar y salir');
  await B.wait(`location.hash === '#/guias' && document.querySelector('#my-guides .tj-draft')`, 15000);
  ok('«Guardar y salir» keeps it in «Tus guías»', /Física I/.test(await B.js(`return document.querySelector('#my-guides')?.innerText ?? ''`)));
  await B.shot('13-tus-guias');
  await B.js(`document.querySelector('#my-guides [data-eg="resume"]').click();`);
  await B.wait(`document.querySelector('#eg-body .tj-wizard h1')`);
  ok('«Seguir» brings it back where it was', await B.js(`return document.querySelector('#eg-body input[name="v"]')?.value`) === 'Física I');

  // Trabajos does not show study guides
  await B.js(`location.hash = '#/trabajos';`); await W(2000);
  ok('Trabajos does not list study guides', !/Examen 2/.test(await B.js(`return document.querySelector('#tj-body')?.innerText ?? ''`)));
} catch (e) {
  ok('ran to the end', false, e.message);
  await B.shot('99-error').catch(() => {});
} finally {
  const errs = B.logs.filter((l) => /EXCEPTION|ERROR/.test(l) && !/favicon|net::ERR|Failed to load resource/.test(l));
  ok('no exceptions on the page', !errs.length, errs.slice(0, 5).join(' | '));
  console.log(results.join('\n'));
  B.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
