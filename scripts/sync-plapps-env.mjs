#!/usr/bin/env node
/**
 * Copy Supabase credentials from the main Vite app (.env.local) into plapps/.env.local.
 * Main app: VITE_SUPABASE_*  →  plapps: NEXT_PUBLIC_SUPABASE_*
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const srcPath = path.join(root, '.env.local')
const destPath = path.join(root, 'plapps', '.env.local')

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

if (!fs.existsSync(srcPath)) {
  console.error(`Missing ${srcPath}. Create it from .env.example first.`)
  process.exit(1)
}

const src = parseEnv(fs.readFileSync(srcPath, 'utf8'))
const url = src.VITE_SUPABASE_URL || src.NEXT_PUBLIC_SUPABASE_URL
const anon =
  src.VITE_SUPABASE_ANON_KEY ||
  src.VITE_SUPABASE_PUBLISHABLE_KEY ||
  src.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.error('Root .env.local must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or publishable key).')
  process.exit(1)
}

const existing = fs.existsSync(destPath) ? parseEnv(fs.readFileSync(destPath, 'utf8')) : {}
const serviceRole = existing.SUPABASE_SERVICE_ROLE_KEY || src.SUPABASE_SERVICE_ROLE_KEY || ''
const floorSecret = existing.FLOOR_SESSION_SECRET || src.FLOOR_SESSION_SECRET || ''

const lines = [
  '# Auto-synced from root .env.local — run: npm run sync:plapps-env',
  `NEXT_PUBLIC_SUPABASE_URL=${url}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
  '',
]

if (serviceRole) lines.push(`SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`, '')
if (floorSecret) lines.push(`FLOOR_SESSION_SECRET=${floorSecret}`, '')

fs.writeFileSync(destPath, lines.join('\n'))
console.log(`Wrote ${destPath}`)
