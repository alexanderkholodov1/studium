// Keys, passwords and private keys never reach anyone's AI. Two layers, both in the browser, before anything is read
// by an AI:
// - by name: files that are keys or certificates (.p12, .pem, .env, id_rsa…) are left out altogether (SECRET_FILE);
// - by content: in any text a file carries, keys and passwords are replaced by «[CLAVE OCULTA]» (redact), so code and
//   configuration stay useful without them.
// What cannot be read as text here (PDF, images) is not scanned; the person is told so where it matters.

export const SECRET_FILE = /\.(p12|pfx|pem|key|jks|keystore|kdbx|ovpn|ppk|asc|gpg)$|^\.env(\.(?!example|sample|template)[\w-]+)?$|^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$|^(credentials|secrets?)(\.(json|ya?ml|txt))?$|^\.(npmrc|pypirc|netrc|git-credentials)$/i;

const HIDDEN = '[CLAVE OCULTA]';
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI, Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\bhf_[A-Za-z0-9]{30,}\b/g, // Hugging Face
];
// «password = …», «api_key: "…"», «SECRET=…»: the value goes, the name stays so the code still reads.
const ASSIGN = /((?:pass(?:word|wd)?|pwd|secret|api[_-]?key|apikey|token|auth[_-]?token|access[_-]?key|private[_-]?key|client[_-]?secret)[\w-]*["']?\s*[:=]\s*)(["']?)([^\s"'#,;]{4,})\2/gi;
// A connection string with its password: protocol://user:password@host
const URL_CRED = /(\b[a-z][\w+.-]*:\/\/[^:\s/@]+:)([^@\s/]{3,})(@)/gi;

export function redact(text) {
  let found = 0;
  let out = String(text);
  for (const re of PATTERNS) out = out.replace(re, () => { found += 1; return HIDDEN; });
  out = out.replace(ASSIGN, (all, name, q, value) => {
    // Placeholders and references are not secrets: ${VAR}, <tu-clave>, changeme, xxx…
    if (/^(\$\{|<|%|changeme|example|your|tu[_-]|xxx|\*+$|null$|none$|true$|false$|\[CLAVE)/i.test(value)) return all;
    found += 1; return `${name}${q}${HIDDEN}${q}`;
  });
  out = out.replace(URL_CRED, (all, head, pass, at) => { found += 1; return `${head}${HIDDEN}${at}`; });
  return { text: out, found };
}
