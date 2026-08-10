#!/usr/bin/env node
/**
 * One-time repair: align remote supabase_migrations history with the squashed baseline.
 *
 * After adding 20260731143000_baseline_live_public.sql locally, remote still lists
 * ~160 historical migrations with no matching files. This script marks them reverted
 * and marks the baseline as applied — WITHOUT re-running SQL on live.
 *
 * Prerequisites:
 *   - Baseline migration file committed
 *   - Live schema already matches baseline (live IS source of truth)
 *   - Review output before confirming
 *
 * Usage:
 *   node scripts/repair-migration-history.mjs --dry-run
 *   node scripts/repair-migration-history.mjs --apply
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const BASELINE = '20260731143000'
const dryRun = process.argv.includes('--dry-run')
const apply = process.argv.includes('--apply')

if (!dryRun && !apply) {
  console.error('Pass --dry-run or --apply')
  process.exit(1)
}

function run(args) {
  const result = spawnSync('npx', ['supabase', ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status ?? 1
}

const result = spawnSync('npx', ['supabase', 'migration', 'list', '--linked'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
})

const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
const marker = '{"migrations":'
const jsonStart = raw.indexOf(marker)
if (jsonStart < 0) {
  console.error('Failed to list remote migrations (no migrations JSON in output)')
  process.stderr.write(raw.slice(0, 2000))
  process.exit(1)
}

const jsonEnd = raw.indexOf('}', jsonStart)
// Find closing brace of root object — migrations list ends with }],"message":...}
const messageIdx = raw.indexOf('"message":', jsonStart)
const rootEnd = raw.indexOf('}', messageIdx)
const jsonText = raw.slice(jsonStart, rootEnd + 1)
const json = JSON.parse(jsonText)
const remoteVersions = (json.migrations ?? [])
  .map((m) => m.remote)
  .filter(Boolean)
  .filter((v) => v !== BASELINE)

console.log(`Remote migrations to mark reverted: ${remoteVersions.length}`)
console.log(`Baseline to mark applied: ${BASELINE}`)

if (dryRun) {
  console.log('\nDry run — no changes. Re-run with --apply to repair.')
  process.exit(0)
}

for (const version of remoteVersions) {
  console.log(`Reverting ${version}…`)
  const code = run(['migration', 'repair', '--status', 'reverted', version, '--linked', '--yes'])
  if (code !== 0) process.exit(code)
}

console.log(`Marking baseline ${BASELINE} applied…`)
const applied = run(['migration', 'repair', '--status', 'applied', BASELINE, '--linked', '--yes'])
process.exit(applied)
