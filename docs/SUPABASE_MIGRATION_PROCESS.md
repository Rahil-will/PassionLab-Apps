# Supabase migration process (mandatory for RPC / view changes)

Live Supabase is the source of truth. Git holds a squashed baseline:

- `supabase/migrations/20260731143000_baseline_live_public.sql` — full public schema from live
- `supabase/migrations/current/` — curated reference slices when editing core tables/RPCs
- `supabase/migrations/_archived/` — drafts that must never ship (`save_factory_user`, etc.)

## Before writing or applying any migration that touches RPCs or views

1. **Pull live definitions** — Supabase SQL editor or MCP:
   ```sql
   SELECT pg_get_functiondef(p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'order_dept_progress_rows';

   SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'handover_slips'
   ORDER BY ordinal_position;
   ```
   Or run `scripts/verify_live_handover_schema.sql`.

2. **Never copy an old dated migration** as the base for `CREATE OR REPLACE FUNCTION` unless you have confirmed it matches live (`pg_get_functiondef` diff).

3. **Patch minimally** — add columns/CTEs on the **live** function body; do not rebuild from `20260721140000_*` or `schema.sql` unless verified.

4. **Check dependents** — e.g. `v_department_progress` selects from `order_dept_progress_rows`; dropping return columns breaks the view.

5. **Verify after apply** — run `npm run db:verify-functions` (live) or `npm run db:verify-functions:local` after `supabase db reset`.

## Refresh baseline from live

```bash
npx supabase db dump --linked -f supabase/migrations/20260731143000_baseline_live_public.sql -s public   # needs Docker
node scripts/pull-live-baseline.mjs   # Management API fallback
```

CI (`.github/workflows/supabase-migrations.yml`) runs `supabase db reset` + `scripts/verify_live_functions.sql` on every `supabase/**` change.

## Known live vs stale repo gaps (2026-07-30)

| Area | Live | Stale repo drafts |
|------|------|-------------------|
| `handover_slips` visit keys | `from_visit_id`, `to_visit_id` | `from_order_route_id`, `to_order_route_id`, bare `visit_id` |
| `order_dept_progress_rows` | Delegates to `operation_progress_rows()`; returns `planned_qty`, `remaining_qty`, `available_to_send`; loading guard on produced sum | Monolithic hourly/QC/batch copy from older migration |
| Received qty on pending slips | `COALESCE(NULLIF(received_qty,0), sent_qty)` | Some drafts used `CASE WHEN pending THEN 0` (different semantics) |
| Missing in transit | New columns `qty_in_transit`, `qty_missing_in_transit` + `missing_in_transit` on report RPC | Applied on live; see `20260719240100_*` note migration |

## Incident: `20260719240000_handover_missing_in_transit.sql`

Deleted from repo. Would have caused column errors and RPC regressions. Correct fix applied on live first, then documented here.
