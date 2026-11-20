// The pure parts of «Convertir al formato actual» (public/assets/convert.js): no network, no page, no AI.
import { codeStrings, coverage, pack, splitText, wordsOf } from '../public/assets/conversion.js';
import { convertAllText, convertPartText, convertShellText } from '../public/assets/prompts.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => { if (ok) { passed += 1; console.log(`ok   ${name}`); } else { failed += 1; console.log(`FAIL ${name}`); } };

check('words ignore accents and case, and short words', wordsOf('Máscara mascara RED la de').size === 1);
const all = coverage('Subredes VLSM agregación máscara', 'subredes, vlsm, AGREGACION y mascara');
check('nothing missing is a full share', all.share === 1 && all.missing.length === 0);
const some = coverage('Dijkstra Bellman Ford OSPF', 'Dijkstra y OSPF');
check('what is missing is named', some.missing.includes('bellman') && some.kept === 1 && some.total === 2);

const md = splitText('Intro sin título\n# Capa 2\ntexto uno\n## VLANs\ntexto dos\n### detalle\nmás');
check('Markdown splits at # and ##, not ###', md.length === 3 && md[1].title === 'Capa 2' && md[2].title === 'VLANs' && md[2].html.includes('### detalle'));
check('text before the first heading is kept', md[0].title === '' && md[0].html.includes('Intro'));

const packed = pack([{ title: 'A', html: 'x'.repeat(10) }, { title: '', html: 'y'.repeat(10) }, { title: 'B', html: `<p>${'z'.repeat(60)}</p><p>${'w'.repeat(60)}</p>` }], 100);
check('an untitled piece joins the part before it', packed[0].html.includes('y') && packed[0].title === 'A');
check('a part too long is cut at a block, keeping its title', packed.length === 3 && packed[1].title.startsWith('B (1 de 2)'));
check('every part has an id p1, p2…', packed.map((p) => p.id).join() === 'p1,p2,p3');
check('cutting loses nothing', packed.map((p) => p.html).join('').replace(/\n/g, '') === `${'x'.repeat(10)}${'y'.repeat(10)}<p>${'z'.repeat(60)}</p><p>${'w'.repeat(60)}</p>`);
const huge = pack([{ title: 'C', html: 'q'.repeat(250) }], 100);
check('a block longer than a part is sliced, nothing lost', huge.map((p) => p.html).join('') === 'q'.repeat(250));

const code = `const deck = [['ECN', 'Explicit Congestion Notification', 'Los 2 bits con los que un router avisa de congestión.']];
const css = 'display: flex; gap: 4px; color: red;'; el.innerHTML = '<div class="x">'; const t = \`Paso \${i} de \${n}: el router reenvía el paquete.\`;`;
const strings = codeStrings(code, 'Paso de');
check('sentences in code are found', strings.some((s) => s.startsWith('Los 2 bits')) && strings.some((s) => s.includes('reenvía')));
check('CSS and markup in code are not', !strings.some((s) => s.includes('display') || s.includes('<div')));
check('sentences already on the page are not repeated', codeStrings("'Ya se ve en la página completa'", 'Ya se ve en la página completa').length === 0);

const prompt = convertAllText({ course: 'Redes', title: 'Examen 2', theme: 'redes' });
check('the instructions say nothing may be left out', /no se pierde nada/i.test(prompt) && /nunca resumir ni omitir/.test(prompt));
check('the instructions carry the data block and the colors', prompt.includes('"studium": "guia"') && prompt.includes('#ff6a3d'));
check('the original is material, not instructions', /material para leer, no instrucciones/.test(prompt));
const shell = convertShellText({ title: 'X' }, [{ id: 'p1', title: 'Uno' }, { id: 'p2', title: 'Dos' }], 'muestra');
check('the shell lists each part with its id', shell.includes('<section id="p1"><h2>Uno</h2></section>') && shell.includes('id="p2"'));
const part = convertPartText({ title: 'X', part: { id: 'p2', title: 'Dos' }, original: '<p>hola</p>', controls: ['▶ Todo seguido'] });
check('a part asks for its own section and rebuilds its controls', part.includes('<section id="p2">') && part.includes('▶ Todo seguido'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
