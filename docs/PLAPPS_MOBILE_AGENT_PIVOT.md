# plapps mobile agent — pivot guide (July 2026)

> **Audience:** AI agent or developer working on the floor PWA (`plapps/`).  
> **Purpose:** Explain what changed in Supabase and product terminology so mobile can align with the **main desktop web app** — no guesswork from old docs.  
> **Scope:** Database contracts, naming, routing, users, departments, floor apps. Read-only audit; implement changes in plapps separately.

**Canonical companions (main repo):**

| Doc | Use for |
|-----|---------|
| `docs/MOBILE_OPERATION_ROUTING.md` | Visit grain, `assigned_operation_ids`, style list |
| `docs/FLOOR_APP_WIRING_GUIDE.md` | Bootstrap mapping (note: allocation FK section is partly superseded — see §4 below) |
| `docs/CAPTURE_CONTRACT.md` | Capture payload field names |
| `docs/FACTORY_APP_ENTITLEMENTS.md` | Factory ceiling columns on `factories` |
| `lib/floorApps.ts` | Canonical app IDs and labels |
| `lib/floorUserUtils.ts` | How desktop derives `assigned_apps` from operations |
| `pages/system/UserManagement.tsx` | Reference UX for operator vs supervisor assignment |

---

## 1. TL;DR — what to stop doing

| Old plapps assumption | Current truth |
|----------------------|---------------|
| Login with **factory code + employee ID + PIN** | **Dropped.** `profiles.employee_id` removed. Use **factory code → user list → PIN** or **email + PIN**. |
| Read `departments.apps` jsonb for capability | **Column dropped.** Apps come from **operations catalog** + `transaction_enabled` / `supervisor_enabled` on department. |
| Read `departments.production_path` from DB | **Column dropped.** Path is **derived** in desktop from operations (`hourly` / `batch` / `cutting_lay`). |
| Home tiles from `profiles.assigned_apps` checkboxes | **Read canonical access:** `floor_user_access` rows (one per operation). Each row has `can_produce`, `handover_enabled`, `workforce_enabled`, `audit_enabled`. Login RPCs still return derived `assigned_apps` / `assigned_operation_ids`. |
| `workforce_log`, `attendance` apps | **Removed.** Replaced by **`supervisor`** (supervisory / workforce allocation app). |
| One style card per order + colorway | **One card per `line_allocations` row** (visit × color × line). Same order+color can appear multiple times. |
| Planning FK: `line_allocations.order_route_id` | **Dropped.** Planning links route only via **`visit_id`**. Capture still uses **`order_routing_steps.id`**. |
| Template `process_flows` as live route | **Live route** = `order_routing_steps` per order (all colorways share one route). |
| Synthetic email `floor.{employeeId}.{factory}@prodigi.local` | **Real email** required; floor login uses that email + PIN. |

---

## 2. Login and floor user access (canonical model)

> **Migrations:** `20260714000000_floor_user_operations.sql` (legacy), `20260714100000_profiles_slim_floor_user_access.sql` (legacy), **`20260714200000_floor_user_access_unified.sql`** (canonical)  
> **Verify:** `scripts/verify_floor_user_access.sql`  
> **Mobile helper:** `resolveFloorTileAccess()` in `lib/floorUserUtils.ts`

### Single table model

| Table | Grain | Holds |
|-------|-------|--------|
| **`profiles`** | 1 per user | `id`, `factory_id`, `full_name`, `email`, `user_role`, `floor_pin`, `status`, `created_at`, `updated_at` |
| **`floor_user_access`** | 1 per operation (or 1 scope row) | `profile_id`, `operation_id`, `department_id`, `can_produce`, `handover_enabled`, `workforce_enabled`, `audit_enabled`, `can_log_workforce`, `shipment_apps` |

**Grain:** `(profile_id, operation_id)` unique (`NULLS NOT DISTINCT`).

- **Operator with ops:** one `floor_user_access` row per operation (`can_produce`) + handover/workforce/audit flags on those rows.
- **Terminal QA:** one row for **Dispatch** (`capture_app = shipment_qa`) — grants all factory shipment screens (log, rejection, buyer audit).
- **Supervisor:** one scope row (`operation_id` null); handover + workforce flags, no production.

**Dropped:** `floor_user_operations` junction table. Floor columns removed from `profiles`.

Login RPCs return `assigned_apps` and `assigned_operation_ids` as **computed fields** (`floor_user_derived_apps`, `floor_user_operation_ids_json`).

### How to build the home screen (mobile)

```
access = resolveFloorTileAccess(loginProfile)

// 1) Production — only if user has operation rows
for opId in access.productionOperationIds:
  op = operations.find(opId)
  show tile for op.capture_app (hourly | qc_log | batch | cutting_lay)

// 2) Support apps — explicit booleans (not mixed into operations)
if access.showHandover:  show Handover tile
if access.showWorkforce: show Supervisory / workforce tile
if access.showAudit:     show Audit tile

// 3) Supervisor-only users: productionOperationIds is empty;
//    showHandover + showWorkforce are typically both true.

// 4) Terminal: scope row (operation_id null); shipment apps on that row or derived assigned_apps.
```

`assigned_apps` and `assigned_operation_ids` returned by login RPCs are **derived** for legacy clients. New plapps code should read `floor_user_access` rows (or the booleans in the login payload built from them).

### How floor users sign in

Two supported paths (updated in `20260714000000_floor_user_operations.sql`):

1. **Factory picker + PIN**  
   - `get_floor_users(factory_code)` → users with `handover_enabled`, `workforce_enabled`, `audit_enabled`, plus derived `assigned_apps` / `assigned_operation_ids`  
   - User taps name → `verify_floor_pin(user_id, pin)`

2. **Email + PIN**  
   - `verify_floor_login_by_email(email, pin)` → same fields in session json

**Removed:** `verify_floor_login(factory_code, employee_id, pin)` and column `profiles.employee_id`.

### `profiles` columns the floor app must understand

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid | Same as `auth.users.id` |
| `factory_id` | uuid | Tenant |
| `full_name`, `email` | text | Display; email used for login |
| `user_role` | text | `operator` \| `supervisor` \| `auditor` \| `quality_manager` |
| `floor_pin` | text | 4-digit PIN |
| `status` | text | `Active` \| `Inactive` |

Floor assignment is **not** on `profiles`. Login RPCs add derived `department_id`, `assigned_operation_ids`, `assigned_apps`, `handover_enabled`, `workforce_enabled`, `audit_enabled`, `can_log_workforce`.

### `floor_user_access` (canonical)

| Column | Meaning |
|--------|---------|
| `profile_id` | User |
| `operation_id` | Catalog operation (`operations.id`); **NULL** = supervisor/terminal scope row |
| `department_id` | Work center |
| `can_produce` | May capture production on this operation |
| `handover_enabled` | May use Handover app (aggregated with `bool_or` across rows) |
| `workforce_enabled` | May use Supervisory / workforce app |
| `audit_enabled` | May use Audit app |
| `can_log_workforce` | Embedded headcount on hourly/QC sessions |
| `shipment_apps` | Terminal-only shipment tile IDs (scope row) |

Operators: **≥1 row** with `can_produce` and non-null `operation_id`. Supervisors: **one scope row**, no operation rows.

### User creation (desktop)

`create_factory_floor_user` writes profile flags + junction rows, then `sync_profile_floor_access` refreshes derived jsonb.

---

## 3. Terminology map (UI ↔ database)

| User-facing label (desktop) | DB / code id | Floor meaning |
|----------------------------|--------------|---------------|
| Work center | `departments` row | Was called "department"; same table |
| Handover | `transaction` | Challan send/receive between work centers — **mandatory** for WIP integrity |
| Hourly | `hourly` | Hourly output count on a route step |
| QC Log | `qc_log` | Piece-wise inspection |
| Batch | `batch` | Batch session capture |
| Audit | `audit` | Optional AQL audit (department capability + per-user grant) |
| Supervisory app / Workforce | `supervisor` | Supervisors allocate headcount; **not** `workforce_log` or `attendance` |
| Lay report | `cutting_lay` | Origin / native cutting work center |
| Shipment Log | `shipment_log` | Terminal work center |
| Rejection Log | `final_rejection_log` | Terminal / QA |
| Buyer Audit | `shipment_audit` | Terminal shipment QA |

### Floor roles vs floor apps

| `user_role` | Typical assignment |
|-------------|-------------------|
| `operator` | One `floor_user_access` row per operation (`can_produce`) + handover/workforce/audit flags on those rows |
| `supervisor` | One scope row (`operation_id` null); `handover_enabled` + `workforce_enabled` |
| `auditor` | Audit-focused (legacy; same login path) |
| `quality_manager` | Often terminal work center — shipment / rejection apps |

**Rule:** A user is either **operator** (operations-first) or **supervisor** (handover + workforce), not both.

---

## 4. Work centers (`departments`) — refactored

### What changed

| Before | After |
|--------|-------|
| `departments.apps` jsonb listed enabled apps | **Dropped** (`20260713000000_departments_drop_apps_native_planning.sql`) |
| `departments.production_path` column | **Dropped** — derived from operations in desktop |
| App toggles in department settings | **`transaction_enabled`**, **`supervisor_enabled`** booleans + **operations catalog** per work center |

### `planning_mode` (work center type)

| Value | Meaning | Floor impact |
|-------|---------|--------------|
| `production` | Standard in-house sewing/finishing | Full capture path |
| `storage` | Store step in route | Window planning only on desktop |
| `outsource` | Outsourced work center | Window planning; handover still applies |
| `native_cutting` | Origin role (`role = origin`) | `cutting_lay` capture |
| `native_shipment` | Terminal role (`role = terminal`) | Shipment / rejection apps |

Legacy: `role = origin` → `native_cutting`; `role = terminal` → `native_shipment`.

### How to know what apps a work center supports (mobile)

Do **not** read `departments.apps`. Instead:

1. Load **`operations`** where `department_id = user.department_id` (include **`is_active = false`** when resolving ids already on open orders).
2. Each operation has `capture_app`: `hourly` \| `qc_log` \| `batch` \| `cutting_lay` \| `transaction` (via step type).
3. Read department flags: `transaction_enabled`, `supervisor_enabled`.
4. Intersect with factory entitlements from `factories.transaction_apps`, `production_apps`, `workforce_apps`, `audit_apps`, `shipment_apps` (returned in `get_floor_bootstrap`).

Desktop composes this in `lib/departmentAppColumns.ts` → `composeDepartmentApps()`.

---

## 5. Operations catalog vs order routing

Two layers — do not confuse them.

### `operations` (catalog, per factory)

- Master list of named steps per work center (Settings → Work center → Operations).
- Fields: `name`, `step_type` (`loading` \| `produce` \| `store` \| `outsource`), `capture_app`, `department_id`, `is_active`.
- **Archive model:** editing an in-use operation **archives** the old row and creates a successor (`superseded_by_id`). Open orders keep frozen `operation_def_id` on the route.

### `order_routing_steps` (live route, per order)

- One ordered chain per order; **all colorways** share it.
- Key columns: `id` (capture FK), `order_id`, `seq`, `dept_id`, `step_label`, `operation_def_id`, **`visit_id`**, `is_primary_output`.
- Display `capture_app` / labels: join `operations` on `operation_def_id`.

### `visit_id` — the grouping unit

- Consecutive steps in the **same work center** share one `visit_id`.
- Example: Loading + Produce in Sewing = **one visit**, two route steps.
- **Planning** allocates per visit; **floor** may still capture each step separately using `order_routing_steps.id`.

---

## 6. Planning → floor style list (`line_allocations`)

### Current grain (July 2026)

| Column | Use |
|--------|-----|
| `id` | **Unique list key** for style cards |
| `order_id`, `colorway_id`, `line_id` | Order, color, resource (line) |
| **`visit_id`** | **Only** link to routing — join `order_routing_steps` |
| `qty`, `daily_target`, `sam`, `start_date`, `end_date` | Targets |

**Removed from allocations:** `order_route_id`, `loading_route_id`, `operation_name`.

### Resolve operations for a card

```sql
SELECT * FROM order_routing_steps
WHERE order_id = :order_id AND visit_id = :visit_id
ORDER BY seq;
```

- **Card title:** join operation names in the visit (e.g. `Sewing (Line Loading + Final Sew)`).
- **Which step to capture:** pick the step whose `operation_def_id` is in user's `assigned_operation_ids` and whose `capture_app` matches the open app (hourly, qc_log, batch).
- **Capture write FK:** `order_routing_steps.id` (called `order_route_id` in capture tables and payloads).

Helper RPC: `visit_primary_route_step_id(order_id, visit_id)` for WIP / handover exit step.

---

## 7. User access control (home screen + capture)

### Operators

1. Read `profile.assigned_operation_ids`.
2. For each id, load `operations` → get `capture_app` and `name`.
3. Build **one tile per assigned operation** (group by capture_app if you want fewer tiles).
4. Add tiles if `assigned_apps` contains `audit` (and factory + work center allow).
5. Add **Handover** if `transaction` in `assigned_apps`.

### Supervisors

- `assigned_operation_ids` is **empty**.
- `assigned_apps` typically `["transaction", "supervisor"]`.
- Show **Handover** + **Supervisory app** tiles (workforce allocation UI).
- `can_log_workforce` on profile is usually true when workforce toggle is on.

### Terminal (shipment) users

- Work center `role = terminal`.
- Apps: `shipment_log`, `final_rejection_log`, `shipment_audit` (from `assigned_apps` + factory `shipment_apps`).

### Capture gate (all roles)

User may capture only if:

```
operation_def_id ∈ assigned_operation_ids   -- operators
AND step exists on order_routing_steps for this order
AND step.dept_id matches user's department (or supervisor override rules)
AND capture_app allowed for factory + work center
```

---

## 8. Bootstrap / data load

### `get_floor_bootstrap(factory_id)` returns

Departments, orders+colorways, resources, shifts, template flows, capture history (hourly, slips, inspections, workforce_logs, audits), **line_allocations**, shipments, rejections, factory entitlement JSONB columns.

**Stubs (empty):** `workers`, `attendance` — legacy tables removed.

### What bootstrap does NOT return (fetch separately)

| Dataset | Why mobile needs it |
|---------|---------------------|
| **`order_routing_steps`** | Live route, `visit_id`, `operation_def_id` |
| **`operations`** | Resolve `capture_app`, labels, archived defs |

**Action for plapps:** extend bootstrap load with parallel queries (or extend the RPC in a future migration). Without these, visit-based style lists and operation-based tiles will not work.

### Suggested client types

```ts
interface PlanTarget {
  id: string;           // line_allocations.id — list key
  visitId: string;      // line_allocations.visit_id
  lineId: string;
  colorwayId: string;
  styleOrderId: string;
  qty: number;
  dailyTarget: number;
  // resolve labels via routingSteps + operations, not allocation columns
}
```

---

## 9. Capture writes (unchanged grain)

| Table | FK column | Value |
|-------|-----------|--------|
| `hourly_counts` | `order_route_id` | `order_routing_steps.id` |
| `inspection_sessions` | `order_route_id` | same |
| `batch_production` | `order_route_id` | same |
| `handover_slips` | `from_order_route_id` / `to_order_route_id` | step ids |

Payload alias in app code: `operationId` = `order_route_id` = route step id.

### Embedded workforce (hourly / QC)

- Permission: `profiles.can_log_workforce`
- Grain: `workforce_logs` keyed by **`line_allocation_id`** × shift × `log_date`
- Flow: pick resource → pick allocation row → show visit ops → enter headcount
- **Batch** operators: headcount on batch session row, not standalone workforce tile

---

## 10. Factory entitlements (ceiling)

On `public.factories` (jsonb arrays):

| Column | Valid IDs (current) |
|--------|---------------------|
| `transaction_apps` | `transaction` |
| `production_apps` | `hourly`, `qc_log`, `batch` |
| `workforce_apps` | **`supervisor`** only |
| `audit_apps` | `audit` |
| `shipment_apps` | `shipment_log`, `final_rejection_log`, `shipment_audit` |

Even if a profile has an app id, hide the tile if the factory entitlement array does not include it.

---

## 11. Desktop-only concepts (mobile can ignore)

- Production planning board, `save_line_plan`, auto-schedule — desktop `/planning`
- `planning_mode` affects **desktop planning UI** only; floor cares about `capture_app` on operations and route steps
- Process flow **templates** (`process_flows`) — used to apply a route to an order; floor reads **saved** `order_routing_steps`
- User Management UI — reference only; data lives in `profiles` as above

---

## 12. Migration checklist (apply on Supabase before mobile pivot)

Minimum set for floor parity:

| Migration | Topic |
|-----------|--------|
| `20260704100000_v3_foundation.sql` | `order_route_id` on capture tables; operations catalog |
| `20260706100000_order_route_visits.sql` | `visit_id` on route + allocations |
| `20260709100000_visit_allocations_operation_users.sql` | Drop allocation route FKs; `assigned_operation_ids` |
| `20260711400000_profiles_cleanup.sql` | Drop `employee_id`; new login RPCs; bootstrap update |
| `20260713000000_departments_drop_apps_native_planning.sql` | Drop `departments.apps`; `planning_mode` |
| `20260713100000_drop_departments_production_path.sql` | Drop `production_path` column |
| `20260713300000_create_factory_floor_user_rpc.sql` | Desktop user create |
| `20260714000000_floor_user_operations.sql` | Legacy junction (superseded) |
| `20260714100000_profiles_slim_floor_user_access.sql` | Legacy two-table split (superseded) |
| **`20260714200000_floor_user_access_unified.sql`** | **Canonical:** one `floor_user_access` table, per-operation rows |
| **`20260714300000_terminal_dispatch_shipment_qa.sql`** | Dispatch `shipment_qa` capture; terminal grants via operation row |

After pull: `NOTIFY pgrst, 'reload schema'` runs in migrations; if errors persist, reload API schema in Supabase dashboard.

---

## 13. plapps implementation checklist

Use this as the mobile agent task list:

- [ ] **Login:** Remove all `employee_id` UI and RPC calls. Implement factory list + PIN and/or email + PIN.
- [ ] **Profile parse:** Read `assigned_operation_ids`, `can_log_workforce`; strip `workforce_log` / `attendance` if present in old rows.
- [ ] **Bootstrap:** Add `order_routing_steps` + `operations` queries; keep `line_allocations`.
- [ ] **Departments:** Stop reading `apps` jsonb; use operations + `transaction_enabled` / `supervisor_enabled`.
- [ ] **Home tiles:** Operation-based for operators; handover + supervisor for supervisors; shipment apps for terminal.
- [ ] **Style list:** One row per `line_allocations.id`; filter by `visit_id` + assigned operations + `capture_app`.
- [ ] **Labels:** From `operations.name` / route `step_label`, not allocation `operation_name`.
- [ ] **Capture:** Send `order_route_id` (= step `id`); include `line_allocation_id` where workforce applies.
- [ ] **Archived ops:** When resolving `operation_def_id` on route, do not filter `is_active = true` only.
- [ ] **React keys:** Use `allocation.id`, never `orderId-colorwayId` alone.

---

## 14. Mental model diagram

```
FACTORY (entitlements on factories.*_apps)
  └── WORK CENTER / department
        ├── operations catalog (capture_app per named step)
        ├── transaction_enabled, supervisor_enabled
        └── users (profiles)
              ├── assigned_operation_ids  → operator tiles
              └── assigned_apps (derived) → handover, audit, supervisor, shipment

ORDER
  └── order_routing_steps (live route, visit_id groups steps)
        └── linked from line_allocations.visit_id (planning / style list)

FLOOR SESSION
  └── pick app → pick line → pick allocation row (visit)
        └── pick route step (order_routing_steps.id) → write capture
```

---

## 15. Stale docs to distrust

These files may still mention `employee_id`, `departments.apps`, `workforce_log`, or allocation `order_route_id`:

- `docs/ONBOARDING_FLOOR_USERS.md`
- `docs/FACTORY_ONBOARDING.md` (partial)
- `docs/PRODIGI_OS_ui_flow.md` (old tile map)
- `docs/FACTORY_APP_ENTITLEMENTS.md` (onboarding example still lists `workforce_log`)
- `scripts/onboard-floor-user.sql`
- `docs/FLOOR_APP_WIRING_GUIDE.md` §1 allocation columns (prefer this doc + `MOBILE_OPERATION_ROUTING.md`)

**Trust order:** migrations in `supabase/migrations/` → `lib/floorApps.ts` / `lib/floorUserUtils.ts` → this document.

---

*Generated from main PRODIGI web app state, July 2026. Update this file when floor contracts change again.*
