# Schema Apply Plan — P0 (live MES)

> **Project:** `xtfljldeceonqyzgkoyp`  
> **Last updated:** 2026-08-10 (desktop security finish)  
> **Full inventory:** [`SCHEMA_CHANGES_PLAN.md`](./SCHEMA_CHANGES_PLAN.md)

---

## Rule: check before apply

```
1. CHECK  — query live for object/policy
2. FIX    — fix migration SQL if needed (e.g. quote "values")
3. APPLY  — npx supabase db push --linked --yes
4. VERIFY — npm run db:verify-functions && npm run db:audit-schema
5. RECORD — update apply log below
```

Never run `20260731143000_baseline_live_public.sql` on live — use `repair-migration-history.mjs` for history only.

---

## Manual Auth dashboard checks (cannot fix in SQL)

Verify in Supabase Dashboard → Authentication:

| Check | Why |
|-------|-----|
| `custom_access_token_hook` is **enabled** | Top-level `user_role` / `factory_id` claims come from the hook |
| **Public signup** is **disabled** | Prevents orphan auth users self-inserting privileged `profiles` rows |

---

## Status summary (2026-08-10)

| # | Migration | Live | Notes |
|---|-----------|------|-------|
| 1–8 | `20260731160000` … `20260808120000` | **APPLIED** | P0–P3 desktop migrations |
| 9 | `20260808140000` audit remediation | **APPLIED** | delete_desktop_shipment, master RLS |
| 10 | `20260808123335` floor_login VOLATILE | **APPLIED** | floor hotfix (synced to repo) |
| 11 | `20260810120000` desktop security finish | **APPLIED** | claims, fabric, audit warnings |
| 12 | `20260810140000` desktop security finish fixes | **APPLIED** | NULL profiles_insert_own; fabric multi-primary guard |
| 13 | `20260810160000` desktop factory scope enforcement | **APPLIED** | view invoker; fulfillment wrap; fabric seed; revoke unvalidated RPCs |
| 14 | `20260810170000` desktop read factory guards | **APPLIED then REVERTED** | Broke authenticated callers — rolled back by `20260810175000`. Do not re-apply |
| 15 | `20260810175000` revert read factory guards | **APPLIED** | Restored 12 report RPCs; fixed PUBLIC grants; dropped `_assert_desktop_factory_scope` |
| 16 | `20260810180000` desktop audit coverage | **APPLIED** | `log_audit_event` on 14 legacy write RPCs |

All 16 migrations are in sync local ↔ remote (`npx supabase migration list --linked`).

---

## Check queries

### Claims hygiene (after `20260810120000`)

```sql
SELECT strpos(pg_get_functiondef(p.oid), 'user_metadata') = 0 AS no_user_metadata
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'current_factory_id';
```

**Pass:** `no_user_metadata` is true.

### log_audit_event not client-callable

```sql
SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'log_audit_event';
```

**Pass:** both false.

### delete_desktop_shipment

```sql
SELECT proname, pronargs FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'delete_desktop_shipment';
```

**Pass:** exists with `pronargs = 2`.

---

## Apply log

| Date | Item | Result |
|------|------|--------|
| prior | P0–P1 migrations | Applied on live |
| 2026-08-08 | Baseline history squash | Done |
| 2026-08-08 | `20260808120000` P3 | Applied via `db push` |
| 2026-08-10 | `20260808140000` audit remediation | Applied via `db push` |
| 2026-08-10 | `20260808123335` floor_login VOLATILE | Synced to repo |
| 2026-08-10 | `20260810120000` desktop security finish | Applied via `db push` |
| 2026-08-10 | `20260810140000` desktop security finish fixes | Applied via `db push` |
| 2026-08-10 | `20260810160000` desktop factory scope enforcement | Applied via `db push` |
| 2026-08-10 | `20260810170000` desktop read factory guards | Applied via `db push` — **broke desktop** (authenticated permission denied) |
| 2026-08-10 | `20260810175000` revert read factory guards | Applied via `db push` — desktop read path restored |
| 2026-08-10 | `20260810180000` desktop audit coverage | Applied via `db push` after probe came back clean |

---

## Emergency revert (`20260810175000`) — resolved 2026-08-10

`20260810170000` wrapped twelve already-`SECURITY INVOKER` report RPCs in invoker wrappers that call `_assert_desktop_factory_scope` and revoked `_inner` bodies from `authenticated`. Every signed-in user got `permission denied for function _assert_desktop_factory_scope`.

Recovery, in the order it was executed:

| Step | Command | Result |
|------|---------|--------|
| 1 | `npx supabase db push --linked --yes` (`20260810175000` only) | Applied |
| 2 | `npm run db:probe-read-rpcs` | `PROBE OK` |
| 3 | `npx supabase db push --linked --yes` (`20260810180000`) | Applied |
| 4 | `npm run db:verify-functions` | All checks pass |

Also fixes `20260810160000` §5 no-op: `REVOKE … FROM PUBLIC` on six desktop save RPCs (PUBLIC grant was bypassing `REVOKE … FROM anon`). Confirmed live: `has_function_privilege('anon', …, 'EXECUTE')` is false for all eighteen desktop write RPCs.

**Rule to carry forward:** before adding a `current_factory_id()` guard to an RPC, check `prosecdef`. A `SECURITY INVOKER` function is already RLS-scoped and the guard adds nothing. A `SECURITY DEFINER` function needs the guard, and the wrapper must itself be `SECURITY DEFINER` — otherwise it executes as the caller and cannot reach the revoked helper.

---

## Desktop security finish fixes (`20260810140000`)

| Item | Fix |
|------|-----|
| `profiles_insert_own` | `COALESCE(user_role, '') NOT IN (...)` — signup with NULL role allowed |
| `save_fabric_components` | `RAISE EXCEPTION` when payload has >1 `is_primary` |
| `log_audit_event` | No session factory in WARNING; `REVOKE` from PUBLIC/anon/authenticated; verify gate checks owner-only ACL |

**Out of scope:** floor session tokens, `plapps/` changes, anon RPC allowlist (separate repo).

---

## Desktop factory scope (`20260810160000`) — applied (keep)

| Item | Change |
|------|--------|
| `v_department_kpis_by_shift`, `v_department_progress` | `security_invoker = on` (`v_daily_audit` / `v_daily_quality` already had it on live) |
| Eight KPI/board views | `REVOKE SELECT … FROM anon` |
| `log_desktop_shipment` / `log_desktop_rejection` | Rename-and-wrap with `current_factory_id()` check (`SECURITY DEFINER` wrappers) |
| `ensure_factory_fabric_components` | Factory + admin guards plus `log_audit_event` on seed — all three confirmed on the live function body |
| Unvalidated unused RPCs | `REVOKE` from `authenticated` (incl. `get_department_kpis_by_shift`) |
| Desktop save RPCs §5 | `REVOKE FROM anon` only — **no-op** when PUBLIC grant exists; fixed in `20260810175000` |

## Desktop read factory guards (`20260810170000`) — reverted

Wrapped twelve `SECURITY INVOKER` read RPCs unnecessarily; broke every authenticated caller. **Do not re-apply.** Rolled back by `20260810175000` (twelve wrapper drops + inner renames + `get_department_kpis` recreated without the guard call).

## Desktop audit coverage (`20260810180000`) — applied

Regenerate before any re-apply: `node scripts/build_desktop_audit_migration.mjs`

| Item | Change |
|------|--------|
| 10 baseline save/delete RPCs | `PERFORM log_audit_event` on insert/update/delete |
| `save_support_dropdown`, `ensure_department_defects` | Audit wired |
| `log_desktop_shipment_inner`, `log_desktop_rejection_inner` | Audit on insert |

Exactly 14 `CREATE OR REPLACE FUNCTION` statements, none targeting a read `_inner` name renamed by the revert. All 14 confirmed on live to contain `log_audit_event`.

**Builder fixes (2026-08-10):**

- CRLF-safe `$function$` extraction — prior output accidentally bundled `seed_department_defects`, `department_effective_apps`, and a duplicate `save_order_routing`.
- `normalizeFunctionTerminator` appends the statement-terminating `;` to the **closing** `\n$function$` only. An earlier version matched the opening `AS $function$` as well, which turned the whole file into one broken statement (`syntax error at or near "CREATE"`).
- `delete_style_order` audit patch matches the baseline's two-line `DELETE FROM public.style_orders` / `WHERE id = … AND factory_id = …` form.
