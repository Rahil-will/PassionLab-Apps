# Schema Backlog (open items only)

> For brainstorming — **not** implemented by the Vite frontend improvement workstream.
> Live project: `xtfljldeceonqyzgkoyp` (MES). Verify with `scripts/verify_live_functions.sql`.
>
> **Actionable plan (live CLI audit):** see [`docs/SCHEMA_CHANGES_PLAN.md`](./SCHEMA_CHANGES_PLAN.md).

---

## Already shipped (do not re-implement)

| Item | Evidence |
|------|----------|
| `UNIQUE(factory_id, po_number)` (partial, non-empty) | Live index `style_orders_factory_po_number_unique` |
| `UNIQUE(factory_id, internal_order_no)` | Live index `style_orders_factory_internal_order_no_unique` |
| `line_allocations.line_id` FK → `assigned_resources` | `line_allocations_line_id_fkey` |
| `CHECK (qty >= 0)` on line allocations | `line_allocations_qty_nonneg` |
| `anon` revoked on **table** DML for tenant tables | RLS + revoked grants — does **not** close anon `EXECUTE` on floor RPCs (`plapps/` scope) |
| Floor PIN hashing on write | `create_factory_floor_user` + `hash_floor_pin` |
| `get_my_profile` strips `floor_pin` | Live |
| Plaintext PIN backfill | Completed |
| Desktop master RLS + `delete_desktop_shipment` | `20260807100000`, `20260808140000` |
| Desktop claims hygiene | `20260810120000` applied 2026-08-10 |

---

## Misleading repo files (not applied live)

Archived to `supabase/migrations/_archived/` (2026-07-31):

- `15_rpc_save_factory_user.sql` — do not implement; user create is Edge Function only
- `17_rpc_update_factory_user.sql` — do not implement; user update is `admin-update-user` Edge Function

User management architecture (locked):

```
admin-create-user | admin-update-user | admin-delete-user
        └─ caller JWT → replace_floor_user_access / create_factory_floor_user
```

---

## Open — A. Migration sovereignty (HIGH)

**Status (2026-08-10):** 16 migrations on live; local and remote in sync. `20260810170000` broke the desktop read path and was rolled back by `20260810175000`; `20260810180000` audit coverage applied afterwards. No drift, no pending pushes.

- Probe read path: `npm run db:probe-read-rpcs`
- Verify: `npm run db:verify-functions`
- Inventory: `npm run db:audit-schema`

**Do not re-apply `20260810170000`.** It guarded `SECURITY INVOKER` RPCs that RLS already scoped, and its invoker wrappers could not call the revoked helper.

---

## Open — B. Write authorization / RLS split (desktop)

**Desktop masters:** admin-gated via `20260731180000`, `20260807100000`, `20260808140000`.

**Floor capture RLS** (`is_floor_data_writer` in `20260808140000`): belt-and-braces for PRODIGI repo only; real floor path is `plapps/` + `floor_capture` RPCs.

---

## Open — C. Company / HQ layer

- `companies` table; `factories.company_id`
- JWT: `company_id` + active `factory_id`
- `profile_factory_access` for multi-plant users

---

## Open — D. Desktop RBAC expansion (DB side)

Beyond `admin` / `superadmin`: `planner`, `viewer`, `production_manager` via claims or `profile_permissions`.

---

## Open — E. `audit_events`

**Partial (2026-08-10):** Table + `log_audit_event()` wired in P3 save RPCs. Observability fixed in `20260810120000`; owner-only EXECUTE + multi-primary guard in `20260810140000`.

**Applied 2026-08-10:** `20260810180000_desktop_audit_coverage.sql` wires audit into 14 legacy write RPCs (`save_buyer` … `save_order_routing`, `save_support_dropdown`, `ensure_department_defects`, fulfillment inners). All 14 confirmed on live. Regenerate with `node scripts/build_desktop_audit_migration.mjs` if the baseline changes.

**Remaining gap:** the audit calls pass `'{}'::jsonb` as the payload for most entities, so `audit_events` records who/what/when but not the changed field values. Populating a real diff payload is a separate pass.

---

## Open — F. Onboarding app contract

Separate app; service role server-side only. APIs: create factory, create factory admin, set entitlements.

---

## Shipped — G. Performance indexes

Applied in `20260808120000` + duplicate drop in `20260810120000` (`hourly_counts_operation_idx`).

---

## Open — H. PIN rate-limiting (floor / plapps)

`floor_login_attempts` exists (`20260808120000`) but bypassable via `p_record_attempt` (`20260808140000`). **Out of PRODIGI repo scope** — fix in `plapps/` migration track.
