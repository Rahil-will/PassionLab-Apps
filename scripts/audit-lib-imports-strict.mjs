import fs from 'fs';
import path from 'path';

const root = path.resolve('c:/Users/Rahil/Downloads/PRODIGI');
const skip = new Set(['node_modules', 'dist', '.git']);

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

const allFiles = walk(root);
const contents = new Map(allFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

function importPatterns(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  const noExt = norm.replace(/\.tsx?$/, '');
  const base = path.basename(noExt);
  const escaped = base.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const dirPath = path.dirname(noExt).replace(/\\/g, '/');

  const res = [
    new RegExp(`from ['"]@/${noExt}['"]`),
    new RegExp(`from ['"]@/${dirPath}/${escaped}['"]`),
    new RegExp(`from ['"]\\.\\.?/[^'"]*/${escaped}['"]`),
    new RegExp(`from ['"]\\./${escaped}['"]`),
    new RegExp(`from ['"]\\.\\./${escaped}['"]`),
    new RegExp(`from ['"]${noExt.replace(/\//g, '/')}['"]`),
  ];
  if (dirPath !== '.') {
    res.push(new RegExp(`from ['"][^'"]*${dirPath}/${escaped}['"]`));
  }
  return res;
}

function countImports(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  const patterns = importPatterns(norm);
  const importers = new Set();
  for (const [file, text] of contents) {
    const fileNorm = file.replace(/\\/g, '/').slice(root.length + 1);
    if (fileNorm === norm) continue;
    if (patterns.some((re) => re.test(text))) importers.add(fileNorm);
  }
  return importers.size;
}

function listLib(relPrefix) {
  const dir = path.join(root, relPrefix);
  const out = [];
  function rec(d, prefix) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = `${prefix}/${ent.name}`;
      if (ent.isDirectory()) rec(path.join(d, ent.name), rel);
      else if (/\.tsx?$/.test(ent.name)) out.push(rel);
    }
  }
  rec(dir, relPrefix);
  return out.sort();
}

for (const rel of listLib('lib')) {
  console.log(`${countImports(rel)}\t${rel}`);
}
