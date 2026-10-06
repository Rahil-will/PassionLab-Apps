/**
 * Module boundary checker (Phase 1) — zero new runtime deps.
 * Enforces: modules/X may import core/*, own folder, or other-module contracts.ts.
 *
 * Usage: node scripts/check-module-boundaries.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesRoot = path.join(root, 'modules');

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function moduleNameFromFile(file) {
  const rel = path.relative(modulesRoot, file).replace(/\\/g, '/');
  return rel.split('/')[0];
}

function isAllowed(importerModule, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) {
    // package import
    return true;
  }

  const normalized = spec.replace(/\\/g, '/');

  // core/*
  if (
    normalized.includes('/core/')
    || normalized.startsWith('@/core/')
    || /(^|\/)\.\.\/(\.\.\/)*core\//.test(normalized)
  ) {
    return true;
  }

  // own module
  if (
    normalized.includes(`/modules/${importerModule}/`)
    || normalized.startsWith(`@/modules/${importerModule}/`)
    || normalized.startsWith('./')
    || normalized.startsWith('../') && !normalized.includes('/modules/')
  ) {
    // Relative within same tree — resolve roughly
    if (!normalized.includes('/modules/')) return true;
  }

  // other module contracts only
  if (/\/modules\/[^/]+\/contracts(?:\.ts)?$/.test(normalized) || /@\/modules\/[^/]+\/contracts(?:\.ts)?$/.test(normalized)) {
    return true;
  }

  if (normalized.includes('/modules/') && !normalized.includes(`/modules/${importerModule}/`)) {
    return false;
  }

  // Deep relative escape into pages/lib/components without going through core
  if (/(^|\/)\.\.\/(\.\.\/)*(pages|components|lib|stores)\//.test(normalized)) {
    return false;
  }

  return true;
}

const files = walk(modulesRoot);
const violations = [];

for (const file of files) {
  const mod = moduleNameFromFile(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!isAllowed(mod, spec)) {
      violations.push(`${path.relative(root, file)}: forbidden import '${spec}'`);
    }
  }
}

if (violations.length > 0) {
  console.error('Module boundary violations:\n' + violations.join('\n'));
  process.exit(1);
}

console.log(`OK module boundaries (${files.length} files under modules/)`);
