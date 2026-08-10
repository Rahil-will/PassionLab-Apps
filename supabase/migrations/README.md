# Migrations

**Live Supabase is the source of truth.** Git holds a **squashed baseline** plus future incremental migrations.

## Layout

| Path | Purpose |
|------|---------|
| `20260731143000_baseline_live_public.sql` | Full public schema snapshot from live (tables, RPCs, views, RLS, triggers) |
| `current/` | Curated reference for core tables/RPCs when editing — not auto-applied |
| `_archived/` | Misleading drafts (`save_factory_user`, `update_factory_user`) — never apply |

## Refresh baseline from live

```bash
# Preferred (Docker + pg_dump):
npx supabase db dump --linked -f supabase/migrations/20260731143000_baseline_live_public.sql -s public

# Fallback (Management API — no Docker):
node scripts/pull-live-baseline.mjs
```

## Verify (must pass before merging migration changes)

```bash
# Against live
npx supabase db query --linked --file scripts/verify_live_functions.sql
npm run db:audit-schema   # full table/view/function/RLS inventory

# Against local after reset
supabase db reset --yes
npx supabase db query --local --file scripts/verify_live_functions.sql
```

**Pending live applies:** see `docs/SCHEMA_CHANGES_PLAN.md`.

## CI

`.github/workflows/supabase-migrations.yml` runs `supabase db reset` + `verify_live_functions.sql` on every `supabase/**` change.

## Remote history repair (one-time)

Remote project still lists ~160 pre-squash migrations. After baseline is committed:

```bash
node scripts/repair-migration-history.mjs --dry-run
node scripts/repair-migration-history.mjs --apply   # marks old reverted, baseline applied
```

Only run `--apply` when live schema already matches the baseline file.

## User admin (locked)

Do **not** add `save_factory_user` / `update_factory_user` RPCs. User admin is edge-function-only — see `supabase/migrations/_archived/README.md`.
