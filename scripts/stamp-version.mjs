// Writes version.json: a short content hash for every script and stylesheet.
// The pages load files as `file.js?v=<hash>`, so browsers fetch a file again
// exactly when it changes, and open tabs can tell when a new version is live.
// Run before committing code changes (`npm run stamp`; the pre-commit hook in
// scripts/install-hooks.sh does it automatically).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['js', 'css', 'debug'];
const EXTRA = ['config.js'];

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) return walk(rel);
    return /\.(js|css)$/.test(d.name) ? [rel] : [];
  });
}

const hash = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 10);
const files = Object.fromEntries([...EXTRA, ...DIRS.flatMap(walk)].sort().map((f) => [f, hash(fs.readFileSync(path.join(ROOT, f)))]));
const v = hash(JSON.stringify(files));
const out = `${JSON.stringify({ v, files }, null, 2)}\n`;
const target = path.join(ROOT, 'version.json');
if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== out) fs.writeFileSync(target, out);
console.log(`version.json: ${v} (${Object.keys(files).length} files)`);
