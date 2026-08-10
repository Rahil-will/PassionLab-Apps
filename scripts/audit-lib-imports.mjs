import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) acc.push(p);
  }
  return acc;
}

const libFiles = walk(path.join(root, 'lib')).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
);
const sources = walk(root).filter(
  (f) => !f.includes('node_modules') && !f.includes('dist') && !f.endsWith('.test.ts'),
);
const corpus = sources
  .map((f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const zero = [];
for (const f of libFiles) {
  const base = path.basename(f, '.ts');
  if (base === 'index' && f.includes(`${path.sep}reports${path.sep}`)) continue;
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const re = new RegExp(`(?:from ['"][^'"]*[/\\\\])?${base}['"]|/${base}['"]`);
  if (!re.test(corpus)) zero.push(rel);
}

console.log(JSON.stringify(zero.sort(), null, 2));
