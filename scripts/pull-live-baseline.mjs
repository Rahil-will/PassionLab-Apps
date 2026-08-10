#!/usr/bin/env node
/**
 * Pull live public schema DDL into a versioned baseline migration.
 *
 * Preferred: `npx supabase db dump --linked -f <out> -s public` (requires Docker).
 * Fallback:  this script uses the Supabase Management API + pg_catalog queries.
 *
 * Usage:
 *   node scripts/pull-live-baseline.mjs
 *   node scripts/pull-live-baseline.mjs --out supabase/migrations/20260731143000_baseline_live_public.sql
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

const env = {
  ...parseEnvFile(path.join(root, '.env')),
  ...parseEnvFile(path.join(root, '.env.local')),
}

const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_TOKEN
const projectRef = process.env.SUPABASE_PROJECT_REF || env.SUPABASE_PROJECT_REF || 'xtfljldeceonqyzgkoyp'

const outArg = process.argv.indexOf('--out')
const defaultOut = path.join(root, 'supabase', 'migrations', '20260731143000_baseline_live_public.sql')
const outPath = outArg >= 0 ? path.resolve(process.argv[outArg + 1]) : defaultOut

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Management API ${res.status}: ${text}`)
  }
  return res.json()
}

function tryDockerDump() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['supabase', 'db', 'dump', '--linked', '-f', outPath, '-s', 'public', '--yes'],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
  )
  return result.status === 0
}

const HEADER = `-- Baseline migration: live public schema snapshot
-- Generated: ${new Date().toISOString()}
-- Project: ${projectRef}
-- Source: scripts/pull-live-baseline.mjs (Management API fallback)
--
-- User admin is edge-function-only. This baseline intentionally excludes
-- save_factory_user / update_factory_user (see supabase/migrations/_archived/).
--
-- Refresh: node scripts/pull-live-baseline.mjs
-- Verify:  npx supabase db query --linked --file scripts/verify_live_functions.sql

`

async function pullViaApi() {
  if (!token) {
    console.error('Missing SUPABASE_TOKEN in .env or SUPABASE_ACCESS_TOKEN env var.')
    process.exit(1)
  }

  console.log('Docker dump unavailable — pulling DDL via Management API…')

  const chunks = [HEADER]

  // Extensions used by public schema objects
  const extRows = await runQuery(`
    SELECT DISTINCT e.extname
    FROM pg_extension e
    WHERE e.extname IN ('pgcrypto', 'uuid-ossp', 'pg_trgm')
    ORDER BY 1;
  `)
  for (const row of extRows) {
    chunks.push(`CREATE EXTENSION IF NOT EXISTS "${row.extname}";\n`)
  }
  chunks.push('\n')

  // Tables: columns
  const columns = await runQuery(`
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
      a.attnum AS ord
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum;
  `)

  const pkCols = await runQuery(`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `)

  const pkByTable = new Map()
  for (const row of pkCols) {
    if (!pkByTable.has(row.table_name)) pkByTable.set(row.table_name, [])
    pkByTable.get(row.table_name).push(row.column_name)
  }

  const colsByTable = new Map()
  for (const row of columns) {
    if (!colsByTable.has(row.table_name)) colsByTable.set(row.table_name, [])
    colsByTable.get(row.table_name).push(row)
  }

  /** Defaults that call user functions must be applied after CREATE FUNCTION. */
  const deferredDefaults = []
  const builtinDefault = /^(gen_random_uuid\(\)|now\(\)|CURRENT_DATE|null::\w+|'[^']*'::[\w\[\]\s]+|\d+(::[\w\[\]\s]+)?)$/i
  function defaultForCreate(col) {
    if (!col.default_expr) return null
    const expr = col.default_expr.trim()
    if (builtinDefault.test(expr)) return expr
    if (/^[+-]?\d+(\.\d+)?$/.test(expr)) return expr
    deferredDefaults.push({ table: col.table_name, column: col.column_name, expr })
    return null
  }

  chunks.push('-- Tables\n')
  for (const tableName of [...colsByTable.keys()].sort()) {
    const tableCols = colsByTable.get(tableName)
    const pk = pkByTable.get(tableName) ?? []
    const colLines = tableCols.map((col) => {
      let line = `  ${col.column_name} ${col.data_type}`
      const def = defaultForCreate(col)
      if (def) line += ` DEFAULT ${def}`
      if (col.not_null) line += ' NOT NULL'
      return line
    })
    if (pk.length > 0) {
      colLines.push(`  PRIMARY KEY (${pk.join(', ')})`)
    }
    chunks.push(`CREATE TABLE IF NOT EXISTS public.${tableName} (\n${colLines.join(',\n')}\n);\n\n`)
  }

  // Non-constraint indexes + table constraints (FK, UNIQUE, CHECK)
  const indexes = await runQuery(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
    ORDER BY tablename, indexname;
  `)
  chunks.push('-- Indexes\n')
  for (const idx of indexes) {
    chunks.push(`${idx.indexdef};\n\n`)
  }

  const constraints = await runQuery(`
    SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid, true) AS definition,
      con.contype AS type
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype IN ('f', 'u', 'c')
    ORDER BY c.relname, con.conname;
  `)
  chunks.push('-- Constraints (FK / UNIQUE / CHECK)\n')
  for (const con of constraints) {
    chunks.push(
      `ALTER TABLE ONLY public.${con.table_name}\n` +
        `  ADD CONSTRAINT ${con.constraint_name} ${con.definition};\n\n`,
    )
  }

  const rlsTables = await runQuery(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname;
  `)
  chunks.push('-- Row level security\n')
  for (const row of rlsTables) {
    chunks.push(`ALTER TABLE public.${row.table_name} ENABLE ROW LEVEL SECURITY;\n`)
  }
  chunks.push('\n')

  // Functions before views (views may call functions)
  const funcs = await runQuery(`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT IN ('save_factory_user', 'update_factory_user')
    ORDER BY p.proname;
  `)
  chunks.push('-- Functions / RPCs\n')
  for (const f of funcs) {
    chunks.push(`${f.definition};\n\n`)
  }

  if (deferredDefaults.length > 0) {
    chunks.push('-- Deferred column defaults (depend on functions above)\n')
    for (const d of deferredDefaults) {
      chunks.push(
        `ALTER TABLE ONLY public.${d.table} ALTER COLUMN ${d.column} SET DEFAULT ${d.expr};\n`,
      )
    }
    chunks.push('\n')
  }

  // Views
  const views = await runQuery(`
    SELECT c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
    ORDER BY c.relname;
  `)
  chunks.push('-- Views\n')
  for (const v of views) {
    chunks.push(`CREATE OR REPLACE VIEW public.${v.view_name} AS\n${v.definition};\n\n`)
  }

  // RLS policies
  const policies = await runQuery(`
    SELECT
      c.relname AS table_name,
      pol.polname AS policy_name,
      CASE pol.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
        WHEN '*' THEN 'ALL'
      END AS cmd,
      pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, pol.polname;
  `)
  chunks.push('-- RLS policies\n')
  for (const p of policies) {
    const roles = 'TO authenticated'
    const usingClause = p.using_expr ? ` USING (${p.using_expr})` : ''
    const checkClause = p.with_check ? ` WITH CHECK (${p.with_check})` : ''
    chunks.push(
      `-- policy ${p.policy_name} on ${p.table_name} (${p.cmd})\n` +
        `CREATE POLICY "${p.policy_name}" ON public.${p.table_name}\n` +
        `  FOR ${p.cmd} ${roles}${usingClause}${checkClause};\n\n`,
    )
  }

  // Triggers on public tables
  const triggers = await runQuery(`
    SELECT pg_get_triggerdef(t.oid, true) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname;
  `)
  chunks.push('-- Triggers\n')
  for (const t of triggers) {
    chunks.push(`${t.definition};\n\n`)
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, chunks.join(''))
  console.log(
    `Wrote ${outPath} (${colsByTable.size} tables, ${funcs.length} functions, ${views.length} views, ${policies.length} policies, ${triggers.length} triggers)`,
  )
}

console.log('Attempting supabase db dump --linked (requires Docker)…')
if (tryDockerDump()) {
  console.log(`Wrote ${outPath} via pg_dump`)
  process.exit(0)
}

await pullViaApi()
