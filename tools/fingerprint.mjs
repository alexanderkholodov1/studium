// The fingerprint of an original file, computed from its path exactly as the app computes it in the browser, so a file
// uploaded with the admin tools and the same file dropped on the site are recognized as one:
// - one file: public/assets/files.js fingerprint(): SHA-256 of its bytes, or of its first and last 16 MB and its size
//   when it is over 64 MB; the first 24 hex digits;
// - several files that are one material (the photos of one exam): contribute.js printOf();
// - part i of a file split in n parts (a book's chapters): contribute.js unitPrint().
// tools/test-fingerprint.mjs checks all three against the app's code.
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 24);
const read = (fd, position, length) => {
  const out = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, out, done, length - done, position + done);
    if (!n) break;
    done += n;
  }
  return out.subarray(0, done);
};

export function filePrint(path) {
  const { size } = statSync(path);
  const fd = openSync(path, 'r');
  try {
    if (size <= 64_000_000) return sha(read(fd, 0, size));
    return sha(Buffer.concat([read(fd, 0, 16_000_000), read(fd, size - 16_000_000, 16_000_000), Buffer.from(String(size))]));
  } finally { closeSync(fd); }
}

export const groupPrint = (prints) => (prints.length === 1 ? prints[0] : sha(Buffer.from(prints.join(''))));

export const partPrint = (print, i, count) => (!print ? '' : count === 1 ? print : `${print.slice(0, 20)}${i.toString(16).padStart(4, '0')}`);

// paths: the original files of one material; part, of: which part of how many (0 <= part < of).
export function printOf(paths, part = 0, of = 1) {
  if (!Number.isInteger(of) || !Number.isInteger(part) || of < 1 || part < 0 || part >= of) throw new Error('part i of n: 0 <= i < n');
  if (!paths.length) return '';
  return partPrint(groupPrint(paths.map(filePrint)), part, of);
}
