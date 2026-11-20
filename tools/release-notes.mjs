// The release notes of a version, from public/data/changelog.json: the same text the page shows in «Novedades».
// Usage: node tools/release-notes.mjs <version>   (prints Markdown; fails when the version is not in the changelog)
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const log = JSON.parse(readFileSync(new URL('../public/data/changelog.json', import.meta.url), 'utf8'));
const v = log.versions.find((x) => x.version === version);
if (!v) { console.error(`The changelog has no version ${version}: write it in public/data/changelog.json first.`); process.exit(1); }
const part = (title, list) => (list?.length ? `### ${title}\n${list.map((x) => `- ${x}`).join('\n')}\n` : '');
console.log([
  `## Studium v${v.version}${v.title ? `: ${v.title}` : ''}`,
  '',
  part('Nuevo', v.new),
  part('Mejoras', v.improved),
  part('Arreglos', v.fixed),
].filter((x) => x !== '').join('\n').trim());
