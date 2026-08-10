# PRODIGI — Schema Changes Plan

> **Generated:** 2026-08-07 · **Updated:** 2026-08-10  
> **Live project:** `xtfljldeceonqyzgkoyp` (MES, ap-northeast-2)  
> **Source:** `npx supabase db query --linked` via `scripts/audit_live_schema_inventory.sql`  
> **Companion:** `docs/SCHEMA_BACKLOG.md` (long-term platform backlog)

---

## Executive summary

Live Supabase is healthy for **desktop admin** MES flows (~182 public functions, **40 tables**, 15 views). **16 migrations applied on live** — local and remote are in sync. The `20260810170000` read-guard outage was rolled back by `20260810175000`, and `20260810180000` (audit coverage) landed after the read-path probe came back clean.

> **Actionable apply checklist:** see [`docs/SCHEMA_APPLY_PLAN.md`](./SCHEMA_APPLY_PLAN.md) — check-before-apply, status, SQL fixes.

**Migration status (2026-08-10):**

| Priority | Migration / change | Status |
|----------|-------------------|--------|
| **P0–P1** | `20260731160000` … `20260807100000` | **APPLIED** |
| **P3** | `20260808120000` audit/RPCs/indexes | **APPLIED** |
| **Remediation** | `20260808140000` desktop RLS + delete RPC | **APPLIED** |
| **Desktop finish** | `20260810120000` claims + fabric + audit | **APPLIED** |
| **Desktop finish fixes** | `20260810140000` profiles NULL + fabric primary | **APPLIED** |
| **Factory scope** | `20260810160000` view invoker + fulfillment wrap | **APPLIED** |
| **Read guards** | `20260810170000` read RPC wrappers | **APPLIED then REVERTED** — broke authenticated callers; do not re-apply |
| **Revert** | `20260810175000` undo read guards + PUBLIC revoke fix | **APPLIED** |
| **Audit coverage** | `20260810180000` log_audit_event on legacy write RPCs | **APPLIED** |
| **Skipped** | Company / HQ layer | Per user direction |

**History repair:** Done 2026-08-08 (`repair-migration-history.mjs`). Do not re-push baseline.

---

## How this audit was run

```bash
# Full inventory (tables, views, functions, RLS gaps, migration list)
npx supabase db query --linked --file scripts/audit_live_schema_inventory.sql -o json

# Migration local vs remote
npx supabase migration list --linked

# Architecture gate (required RPCs + defects policy)
npm run db:verify-functions

# Optional: refresh squashed baseline from live
npm run db:pull-baseline
```

Re-run after any live apply: `npm run db:audit-schema` (added to `package.json`).

---

## Live inventory (2026-08-10)

### Tables (40)

| Table | Est. size | Domain |
|-------|-----------|--------|
| `app_configuration` | 48 kB | Factory app config JSON |
| `assigned_resources` | 96 kB | Lines / outsource vendors |
| `audit_events` | — | Desktop admin mutation audit (RLS: admin SELECT only) |
| `audit_sessions` | 56 kB | Floor AQL audits |
| `batch_production` | 128 kB | Batch output capture |
| `buyers` | 32 kB | Master |
| `colorways` | 96 kB | Order colorways + planning remarks |
| `control_panel_audit_logs` | 32 kB | Superadmin audit |
| `cutting_bundles` | 208 kB | Cutting floor |
| `cutting_lays` | 80 kB | Cutting floor |
| `cutting_session_lots` | 64 kB | Cutting floor |
| `cutting_sessions` | 112 kB | Cutting floor |
| `dashboard_configs` | 32 kB | Dashboard widgets |
| `dashboard_links` | 16 kB | Dashboard deep links |
| `defects` | 112 kB | QC defect catalog |
| `department_workforce_rates` | 96 kB | Workforce rates |
| `departments` | 104 kB | Master |
| `fabric_components` | 128 kB | Cutting fabric types |
| `factories` | 48 kB | Tenant root |
| `floor_login_attempts` | — | PIN rate-limit (RLS on, zero policies — DEFINER only) |
| `floor_user_access` | 152 kB | Floor user dept/app access |
| `handover_slips` | 144 kB | Mandatory handover spine |
| `hourly_counts` | 168 kB | Output capture |
| `inspection_sessions` | 112 kB | QC capture |
| `line_allocations` | 184 kB | Planning / line plan |
| `operations` | 96 kB | Frozen routing op attrs |
| `order_delivery_target_history` | 40 kB | Shipment plan history |
| `order_delivery_targets` | 96 kB | Shipment plan |
| `order_routing_steps` | 264 kB | Per-order routing |
| `outsource_work_movements` | 88 kB | Outsource two-leg |
| `process_flows` | 88 kB | Master |
| `profiles` | 88 kB | Users |
| `rejections` | 144 kB | Rejection log |
| `shifts` | 32 kB | Master |
| `shipment_audits` | 64 kB | Shipment QA |
| `shipments` | 80 kB | Shipment log |
| `size_groups` | 32 kB | Master |
| `style_orders` | 112 kB | Orders |
| `support_dropdowns` | 48 kB | Settings dropdowns |
| `workforce_logs` | 96 kB | Attendance |

**RLS:** All 40 tables have RLS enabled (no `NO_RLS` rows in audit).

### Views (15)

`v_cut_to_ship_summary`, `v_cutting_component_progress`, `v_daily_audit`, `v_daily_production`, `v_daily_quality`, `v_daily_target`, `v_day_floor_board`, `v_department_kpis_by_shift`, `v_department_progress`, `v_operation_progress`, `v_order_journey_by_resource`, `v_order_rejected_qty_by_size`, `v_outsource_summary`, `v_shift_minutes`, `v_shift_workforce_summary`

### Functions (174)

- **SECURITY DEFINER:** 73 (floor capture, admin saves, reporting RPCs)
- **SECURITY INVOKER:** 101 (helpers, triggers, aggregations)

See [Appendix C — Function catalog](#appendix-c--function-catalog-174) for the full list by category.

---

## Migration sovereignty

### Current state

| Location | Count | Notes |
|----------|-------|-------|
| Remote `schema_migrations` | 16 | Through `20260810180000` |
| Local `supabase/migrations/` | 16 SQL files | Same set |
| Drift | **None** | Verified via `npx supabase migration list --linked` (2026-08-10) |

### Local migration files

| Version | File | Status |
|---------|------|--------|
| `20260731143000` | `baseline_live_public.sql` | Applied |
| `20260731160000`–`20260808123335` | incrementals | Applied on live |
| `20260808140000` | `audit_remediation_rls_rpc.sql` | Applied on live |
| `20260810120000` | `desktop_security_finish.sql` | Applied on live |
| `20260810140000` | `desktop_security_finish_fixes.sql` | Applied on live |
| `20260810160000` | `desktop_factory_scope_enforcement.sql` | Applied on live |
| `20260810170000` | `desktop_read_factory_guards.sql` | Applied — **superseded by `20260810175000`; do not re-apply** |
| `20260810175000` | `revert_read_factory_guards.sql` | Applied on live |
| `20260810180000` | `desktop_audit_coverage.sql` | Applied on live |

---

## Desktop security finish fixes (`20260810140000`)

Corrective pass after `20260810120000` live verification:

| Area | Fix |
|------|-----|
| `profiles_insert_own` | `COALESCE(user_role, '')` — NULL role no longer fails WITH CHECK |
| `save_fabric_components` | Reject payloads with >1 `is_primary` before unique-index violation |
| `log_audit_event` | No `factory_id` in WARNING text; explicit `REVOKE` from `PUBLIC`, `anon`, `authenticated`; owner-only EXECUTE gate in `verify_live_functions.sql` |

## Desktop security finish (`20260810120000`)

| Area | Change |
|------|--------|
| JWT claims | Remove `user_metadata` from `current_user_role` / `current_factory_id`; `is_factory_admin` / `is_superadmin` delegate to `current_user_role()` |
| RLS | `factories_select` scoped to tenant; `profiles_insert_own` blocks self-assigning admin/superadmin (`COALESCE` NULL-safe as of `20260810140000`) |
| `save_fabric_components` | Unique auto-generated codes; clear `is_primary` on soft-delete; reject multi-primary payloads (`20260810140000`) |
| `log_audit_event` | `RAISE WARNING` on skip (no silent drop); trust caller DEFINER RPCs; owner-only EXECUTE |
| Indexes | Drop duplicate `hourly_counts_operation_idx` |

Verify: `npm run db:verify-functions` (signature-aware desktop RPC checks + `log_audit_event` grant gate).

---

## Pending schema changes (detailed)

### Phase 1 — Apply existing repo migrations (P0–P1) — **COMPLETE**

#### 1.1 `defects_write` admin gate

**Live today (2026-08-07):** **APPLIED** — `defects_write` includes `is_factory_admin()`.

**Migration:** `20260731160000_defects_write_admin_only.sql` — no further action unless audit regresses.

#### 1.2 `save_support_dropdown` RPC

**Live today:** RPC **missing**. Table RLS already requires admin for direct DML.

**Change:** `20260731190000_save_support_dropdown_rpc.sql` (fixed: quote `"values"` — reserved word).

| | |
|--|--|
| **Effect if delayed** | Settings → Support Dropdown save fails at RPC call |
| **Risk** | Broken settings UX for admins |
| **Frontend** | `settingsStore` → `saveSupportDropdownRpc` in `lib/settingsRpc.ts` |
| **SQL error fix** | `RETURNS TABLE` line must use `"values" jsonb`, not `values jsonb` |

**Apply:** see [`SCHEMA_APPLY_PLAN.md`](./SCHEMA_APPLY_PLAN.md).

#### 1.3 Drop `get_orders_pipeline_page`

**Live today:** Function absent (good).

**Change:** Documented drop in `20260806130000` — idempotent.

---

### Phase 2 — RLS hardening (new migration needed)

Live audit found **18 `FOR ALL` policies** on factory-scoped tables. Split into two buckets:

#### Bucket A — Floor capture (keep factory-scoped `FOR ALL`)

These **should not** require `is_factory_admin()` — floor operators write via `floor_capture` RPCs and direct session tables:

| Table | Policy | Notes |
|-------|--------|-------|
| `hourly_counts` | `hourly_counts_factory_write` | Output capture |
| `inspection_sessions` | `inspection_sessions_write` | QC capture |
| `batch_production` | `batch_production_all` / `_factory_write` | Batch output |
| `cutting_bundles` | `cutting_bundles_factory` | Cutting PWA |
| `cutting_lays` | `cutting_lays_factory` | Cutting PWA |
| `cutting_sessions` | `cutting_sessions_factory` | Cutting PWA |
| `cutting_session_lots` | `cutting_session_lots_factory` | Cutting PWA |
| `audit_sessions` | `audit_sessions_factory_write` | Floor audit |
| `shipments` | `shipments_factory_write` | Floor shipment |
| `shipment_audits` | `shipment_audits_factory_write` | Floor shipment QA |
| `rejections` | `rejections_factory_write` | Floor + desktop |
| `workforce_logs` | `workforce_logs_factory_write` | Attendance |

**Action:** Belt-and-braces RLS only for desktop repo. Real floor writes bypass RLS via `floor_capture` DEFINER RPCs (out of PRODIGI scope). `is_floor_data_writer()` currently allows every role present in `profiles` (`admin`, `superadmin`, `operator`, `supervisor`, `quality_manager`); the `viewer` role it was written to block does not exist in the DB yet (see Backlog §D).

#### Bucket B — Master / settings tables (tighten)

| Table | Live write policy | Gap |
|-------|-------------------|-----|
| `defects` | `defects_write` ALL, no admin | **Fix in Phase 1** |
| `fabric_components` | insert/update/delete factory only | Any factory user can edit fabric catalog |
| `assigned_resources` | insert/update/delete factory only | Any factory user can edit lines/vendors |
| `department_workforce_rates` | insert/update no admin | Rates editable by non-admin |
| `process_flows` | insert/update/delete no admin | **Partially** — RPC `save_process_flow` checks admin; direct DML still open |
| `shifts` | insert/update/delete no admin | RPC `save_shift` checks admin; direct DML open |
| `size_groups` | insert/update/delete no admin | RPC `save_size_group` checks admin; direct DML open |
| `app_configuration` | `app_configuration_all` ALL | Non-admin can mutate app config JSON |

**Proposed migration:** `20260807100000_master_tables_admin_write_split.sql`

```sql
-- Pattern (per table): DROP broad write policies; CREATE admin-gated INSERT/UPDATE/DELETE;
-- SELECT unchanged: factory_id = current_factory_id()
-- Tables: fabric_components, assigned_resources, department_workforce_rates,
--         process_flows, shifts, size_groups, app_configuration
```

| | |
|--|--|
| **Priority** | P2 |
| **Effect if delayed** | Non-admin users could mutate masters if they bypass UI |
| **Risk** | IDOR via Supabase client if someone crafts requests |

---

### Phase 3 — New RPCs (client write surfaces) — **CLOSED 2026-08-10**

Verified by `docs/DESKTOP_DB_USAGE_REPORT.md`: **zero** query-builder insert/update/upsert/delete in the desktop app. All five former direct-write surfaces use RPCs (selects remain direct under RLS).

| Client file | Table | Live RPC | Status |
|-------------|-------|----------|--------|
| `lib/fabricComponentDb.ts` | `fabric_components` | `save_fabric_components` (+ `ensure_factory_fabric_components`) | Wired |
| `stores/dataStore.ts` | `colorways` | `save_colorway_planning_remarks` | Wired |
| `stores/settingsStore.ts` | `factories` | `save_factory_settings` | Wired |
| `lib/operationsDb.ts` | `operations` | `save_operation` | Wired |
| `lib/ensureSupportDropdowns.ts` | `support_dropdowns` | `save_support_dropdown` | Wired |

**Follow-ups (not Phase 3):** factory-scope enforcement (`20260810160000` **applied**); read RPC guards (`20260810170000` **reverted** — unnecessary on invoker RPCs); audit coverage (`20260810180000` **applied**).

---

### Phase 4 — Platform / scale (from SCHEMA_BACKLOG)

| Item | Schema work | Priority |
|------|-------------|----------|
| **Company / HQ layer** | `companies`, `factories.company_id`, `profile_factory_access`, JWT claims | Future |
| **`audit_events`** | Hook `log_audit_event` on legacy write RPCs | **Done** — `20260810180000` applied; all 14 RPCs verified on live |
| **PIN rate-limiting** | `floor_login_attempts` + throttle in `verify_floor_pin` | P2 security |
| **Performance indexes** | See SCHEMA_BACKLOG §G | When volume demands |
| **Desktop RBAC** | `profile_permissions` or JWT claims for planner/viewer | Future |
| **Pipeline status RPC** | Rebuild `get_orders_pipeline_page` correctly if server-side filter needed | P3 only |

---

## RPC inventory vs app expectations

### Required by `verify_live_functions.sql` — status on live

| RPC | Live |
|-----|------|
| `create_factory_floor_user` | OK |
| `replace_floor_user_access` | OK |
| `get_my_profile` | OK |
| `hash_floor_pin` | OK |
| `verify_floor_pin` | OK |
| `save_buyer` | OK |
| `save_department` | OK |
| `save_line_plan` | OK |
| `save_order_routing` | OK |
| `save_process_flow` | OK |
| `save_resource` | OK |
| `save_shift` | OK |
| `save_size_group` | OK |
| `save_style_order` | OK |
| `log_desktop_shipment` | OK |
| `log_desktop_rejection` | OK |
| `delete_style_order` | OK |
| `save_support_dropdown` | OK |
| `save_factory_settings` | OK |
| `save_fabric_components` | OK |
| `save_operation` | OK |
| `save_colorway_planning_remarks` | OK |
| `delete_desktop_shipment` | OK |

### Forbidden RPCs — status on live

| RPC | Live |
|-----|------|
| `save_factory_user` | Absent (good) |
| `update_factory_user` | Absent (good) |
| `get_orders_pipeline_page` | Absent (good) |

---

## Execution plan (ordered)

```
Week 0 (now)
  ├─ Apply 20260731160000 (defects admin)
  ├─ Apply 20260731190000 (save_support_dropdown)
  ├─ Apply 20260806130000 (drop pipeline RPC — no-op)
  ├─ npm run db:verify-functions
  └─ Smoke: Settings → Defects save, Support Dropdown save

Week 1
  ├─ repair-migration-history.mjs --apply
  ├─ Draft 20260807100000_master_tables_admin_write_split.sql
  └─ CI green on supabase db reset

Week 2–3
  ├─ Phase 3 client write RPCs — CLOSED (see above)
  ├─ Apply 20260810160000 factory-scope enforcement
  └─ Audit coverage pass: log_audit_event on remaining 15 write RPCs

Ongoing
  └─ Refresh baseline after material schema changes: npm run db:pull-baseline
```

---

## Verification checklist (after each apply)

| # | Check | Command / action |
|---|-------|------------------|
| 1 | Required RPCs exist | `npm run db:verify-functions` |
| 2 | No orphan forbidden RPCs | `npm run db:audit-schema` → `ORPHAN_RPC` empty |
| 3 | `defects_write` requires admin | audit → `defects_write` qual contains `is_factory_admin` |
| 4 | Support dropdown save | Settings UI smoke test |
| 5 | Order Completion desktop ship/reject | `log_desktop_*` smoke test |
| 6 | Floor capture still works | Floor PWA hourly + handover smoke |
| 7 | Migration list aligned | `supabase migration list --linked` — no drift |

---

## Appendix A — Function catalog (174)

### Auth, tenancy, users

`current_factory_id`, `is_factory_admin`, `is_superadmin`, `custom_access_token_hook`, `get_my_profile`, `hash_floor_pin`, `verify_floor_pin`, `verify_floor_login_by_email`, `create_factory_floor_user`, `replace_floor_user_access`, `get_floor_users`, `sync_profile_to_auth_metadata`, `profile_dept_can_capture_cutting`, `profile_dept_has_app`, `profile_floor_flags_for_assignment`, `profile_has_capture_app`, `floor_user_can_log_workforce`, `floor_user_department_id`, `floor_user_derived_apps`, `floor_user_operation_ids_json`

### Admin save RPCs

`save_buyer`, `save_department`, `save_shift`, `save_process_flow`, `save_size_group`, `save_resource`, `save_style_order`, `save_line_plan`, `save_order_routing`, `delete_style_order`, `ensure_department_defects`, `ensure_factory_fabric_components`, `log_desktop_shipment`, `log_desktop_rejection`  
**Audit coverage:** `save_support_dropdown` wired in `20260810180000` (applied on live).

### Floor capture (SECURITY DEFINER)

`floor_capture`, `floor_capture_batch_upsert`, `floor_capture_hourly_upsert`, `floor_capture_inspection_session_upsert`, `floor_capture_handover_amend`, `floor_capture_allocation_complete`, `floor_capture_allocation_reopen`, `floor_capture_audit_session`, `floor_capture_shipment_log`, `floor_capture_shipment_rejection_log`, `floor_capture_shipment_audit_session`, `floor_capture_colorway_*`, `floor_capture_cutting_*`, `floor_resolve_operation_step`, `floor_resolve_order_route_step`, `floor_validate_handover_steps`, `floor_capture_fail`

### Reporting / read RPCs

`get_factory_production_summary`, `get_order_detail_bundle`, `get_cut_to_ship_report`, `get_cut_to_ship_detail`, `get_cut_to_ship_journey`, `get_handover_report`, `get_audit_report`, `get_line_allocation_actuals`, `get_order_dept_progress`, `get_order_operation_progress`, `get_order_colorway_actuals`, `get_style_kpis`, `get_department_kpis_by_shift`, `get_dept_quality_for_date`, `get_factory_schedule_actuals`, `get_floor_bootstrap`, `get_today_rejections_for_order`, `operation_progress_rows`, `order_dept_progress_rows`, `order_journey_by_resource_rows`, `cutting_component_progress_rows`

### Handover / outsource / WIP

`handover_exit_operation_id`, `handover_short_qty_by_size`, `log_outsource_work_movement`, `void_outsource_work_movement`, `outsource_*` (12 helpers), `auto_reject_missing_pcs`, `sync_colorway_ready_to_ship`, `assert_colorway_allows_production`

### Triggers & KPI helpers

`hourly_counts_apply_kpi`, `inspection_sessions_apply_kpi`, `batch_production_apply_kpi`, `capture_fill_line_allocation`, `workforce_logs_fill_from_allocation`, `trg_sync_colorway_ready_*`, `set_updated_at`, `set_defects_updated_at`

### JSON / allocation math

`jsonb_*`, `allocation_grained_*`, `standard_production_alloc_grid`, `proportional_qty_by_size`, `colorway_planned_by_size`, `aggregate_order_cut_qty`

### Seeds (factory onboarding)

`seed_factory_app_configuration`, `seed_factory_native_departments`, `seed_department_defects`, `default_defects_for_department`

---

## Appendix B — Re-audit commands

```bash
npm run db:audit-schema          # writes scripts/_audit_live_full.json
npm run db:verify-functions      # architecture gate
npx supabase migration list --linked
```

Raw audit output is gitignored under `scripts/_audit_live_*.json` — regenerate anytime.
