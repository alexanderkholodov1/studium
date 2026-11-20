// Contributions are cleaned on reading (prompts.js cleanStored), alone and from a pack. Pure: no network, no page.
import { cleanStored } from '../public/assets/prompts.js';
import { readPack } from '../public/assets/packs.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => { if (ok) { passed += 1; console.log(`ok   ${name}`); } else { failed += 1; console.log(`FAIL ${name}`); } };

const hostile = {
  concepts: [{ name: 'Subred', summary: 'x'.repeat(5000), related: 'no es una lista' }, { name: 42 }, null],
  questions: [
    { text: '¿Cuántos hosts?', difficulty: '<b>9</b>', kind: '<script>alert(1)</script>', points: 'mucho', concepts: ['Subred'], number: '<img src=x>' },
    { text: '', difficulty: 2 },
    'no es un objeto',
  ],
  examples: [{ text: 'Ejemplo', concepts: 'Subred' }],
  activity: { objective: 'Medir', steps: [{ text: 'Paso' }, 7], files: [{ name: 'a.pcap', from: 'atacante' }] },
  style: { not: 'text' },
  extra: '<iframe src="https://example.com">',
};
const c = cleanStored('exam', hostile);
const q = c.questions?.[0] ?? {};
check('a difficulty that is not a number becomes a number from 1 to 5', Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 5);
check('an unknown question kind becomes a known one', q.kind === 'problem');
check('points that are not a number are dropped', !('points' in q));
check('questions without text are dropped', c.questions.length === 1);
check('a question number is clipped to 12 characters', (q.number ?? '').length <= 12);
check('unknown fields are dropped', !('extra' in c));
check('the style is text', typeof c.style === 'string');
check('a file of a lab is from the professor or a student, nothing else', c.activity.files.every((f) => f.from === 'profesor' || f.from === 'alumno'));
check('a long summary is clipped', c.concepts.every((x) => String(x.summary ?? '').length <= 1000));
check('a body that is not an object reads as empty', JSON.stringify(cleanStored('exam', 'texto')) === '{}' && JSON.stringify(cleanStored('exam', [1])) === '{}' && JSON.stringify(cleanStored('exam', null)) === '{}');
const pack = JSON.stringify({ studium: 'pack', version: 1, build: 'b', items: [{ id: 'a', kind: 'exam', data: hostile }] });
const fromPack = readPack(pack)[0].data.questions[0];
check('a pack is cleaned the same way', fromPack.kind === 'problem' && Number.isInteger(fromPack.difficulty));

console.log(`\n${passed} of ${passed + failed} passed`);
process.exit(failed ? 1 : 0);
