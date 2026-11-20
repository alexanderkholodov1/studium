// The reading of Google's pricing page (tools/verify-models.mjs) on a small page of the same shape, written here (not
// a copy of Google's): each section's own models, their state, the exact line and the note.
import { parsePricing } from './verify-models.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok) => { if (ok) { passed += 1; console.log(`ok   ${name}`); } else { failed += 1; console.log(`FAIL ${name}`); } };
const section = (title, id, codes, cell, callout = '') => `## ${title}  {% id="${id}" %}

{% two-column-layout %}
${codes.map((c) => `  *[\`${c}\`](/docs/models/${c})*`).join('\n')}
{% /two-column-layout %}

{% hr /%}

Text that mentions \`gemini-other-model\` in passing.
${callout ? `{% callout type="note" %}\n  ${callout}\n{% /callout %}` : ''}
{% table %}
  * Feature
  * Free Tier
  * Paid Tier

  ---

  * Input price
  * ${cell}
  * $1.00
{% /table %}
`;
const page = ['# Pricing', section('Model A', 'model-a', ['gemini-a'], 'Free of charge'), section('Model B', 'model-b', ['gemini-b', 'gemini-b-tools'], 'Not available'),
  section('Model C', 'model-c', ['gemini-c'], 'Free of charge', 'Gemini C is deprecated. Requests are redirected to gemini-a and billed at its rates.')].join('\n');
const m = parsePricing(page);
check('a free model is free', m['gemini-a']?.state === 'free');
check('a model without a free tier is paid', m['gemini-b']?.state === 'paid');
check('every code of a section gets its state', m['gemini-b-tools']?.state === 'paid');
check('a code only mentioned in the text is not a model of that section', !('gemini-other-model' in m));
check('a model being retired is marked so, even with a free tier', m['gemini-c']?.state === 'deprecated');
check('each model keeps the exact line', m['gemini-a']?.quote === 'Input price — Free Tier: Free of charge');
check('each model links to its section', m['gemini-b']?.url.endsWith('#model-b'));
check('the note is kept', /redirected/.test(m['gemini-c']?.note ?? ''));
console.log(`\n${passed} of ${passed + failed} passed`);
process.exit(failed ? 1 : 0);
