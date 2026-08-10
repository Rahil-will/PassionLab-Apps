# Floor app wiring guide (desktop → mobile)

Use this document to prompt the mobile/floor IDE (`plapps/`) after desktop + Supabase changes through July 2026.

**Related:** `docs/MOBILE_FLOOR_PROCESS_FLOW.md`, `plapps/agents/OPERATION_TERMINOLOGY_AGENT.md`, `docs/FACTORY_APP_ENTITLEMENTS.md`

---

## TL;DR

| Area | Before | After |
|------|--------|-------|
| Routing | Template `process_flows` per colorway | **Live** `order_routing_steps` per order (one route, all colorways) |
| Planning grain | One row per color × dept × line | **One row per visit** (`visit_id`) per color × line |
| Operation FK | `operation_id` on capture/plan rows | **`order_route_id`** (= `order_routing_steps.id`) — accept both names in reads |
| Floor list | One card per order+colorway | **One card per allocation/visit** when multiple ops planned on same line |
| Capture scope | Department only | **Department + operation** (`order_route_id` / `operationId` in app) |
| Login / users | `profiles` + `assigned_apps` | **Unchanged** — same auth, same bootstrap |

---

## 1. Schema changes (Supabase)

Apply migrations in order (minimum set for floor):

| Migration | What it does |
|-----------|----------------|
| `20260704100000_v3_foundation.sql` | Renames `operation_id` → `order_route_id` on capture tables; adds `operations` catalog |
| `20260706100000_order_route_visits.sql` | Adds `visit_id` on `order_routing_steps` + `line_allocations`; `loading_route_id` on allocations; updates `save_order_routing` + `save_line_plan` |
| `20260707100000_save_order_routing_seq_bump.sql` | Fixes route save seq conflicts |
| `20260708100000_profiles_rls_route_save_plan_reset.sql` | Route save clears `line_allocations` + `batch_production`; fixes profiles RLS recursion |
| `20260708200000_profiles_factory_visibility.sql` | Admins see all factory users in User Management |

### `order_routing_steps` (live route)

| Column | Meaning |
|--------|---------|
| `id` | **Operation id** — FK on all capture + planning |
| `order_id` | Style order |
| `seq` | Global sequence |
| `dept_id` | Department UUID |
| `dept_name` | Snapshot label |
| `step_label` | **Display name** (Block Cut, Final Sew, …) |
| `step_type` | `loading`, `produce`, `store`, `outsource`, `inspect`, `move`, `delay` |
| `capture_app` | `hourly`, `qc_log`, `batch`, `audit`, `transaction` |
| `operation_def_id` | Link to `operations` catalog |
| `visit_id` | Groups loading + produce in same dept visit |
| `is_primary_output` | Produce step used for WIP / handover exit |

### `line_allocations` (planning → floor list)

| Column | Meaning |
|--------|---------|
| `id` | Allocation row id — **use as React list key** |
| `order_id`, `colorway_id`, `line_id` | Order, color, resource |
| `order_route_id` | Produce step for this visit |
| `visit_id` | One planning row per visit |
| `loading_route_id` | Optional loading op in same visit (capture only, not a second allocation) |
| `daily_target`, `sam`, `qty`, dates | Planning targets |

**Rule:** Consecutive steps in the same department share one `visit_id`. Loading + produce appear as one visit card on the planning board; floor may still capture loading vs produce as separate route steps.

---

## 2. Bootstrap / data load

Floor loads via `get_floor_bootstrap` RPC or server `loadFloorBootstrap()` (`plapps/lib/loadFloorBootstrap.ts`).

### Must read from bootstrap

| Dataset | Table | Floor usage |
|---------|-------|-------------|
| `routing_steps` | `order_routing_steps` | Resolve operation labels, capture_app, handover exit |
| `allocations` | `line_allocations` | Style list per line — **one entry per allocation row** |
| `orders` + `colorways` | `style_orders`, `colorways` | Order header, sizes |
| `departments` | `departments` | Dept names, `apps` capability pool |
| `hourly`, `batch_production`, `slips` | capture tables | Progress / handover state |

### Allocation mapping (fix applied in plapps)

When mapping `line_allocations` → `PlanTarget`:

```ts
{
  id: row.id,                                    // NEW — unique list key
  operationId: row.order_route_id ?? row.operation_id,  // prefer order_route_id
  visitId: row.visit_id,                         // NEW
  lineId: row.line_id,
  colorwayId: row.colorway_id,
  styleOrderId: row.order_id,
  // ...qty, dailyTarget, sam, dates
}
```

**Do not** display `operation_name` from allocation rows — join `operationId` → `routing_steps.step_label`.

### Routing step mapping

Include `visit_id` on `OrderRoutingStep` in client types.

---

## 3. UI flow changes

### Style selection list (`/floor/hourly`, `/floor/batch`, etc.)

**Before:** One button per order + colorway on the selected line.

**After:** One button per **allocation** (visit). Same order+colorway can appear **multiple times** when planning allocated multiple visits (e.g. two sewing operations on one line).

**React key (bug fix):** Do not use `orderId-colorwayId-op`. Use:

```ts
allocation.id ?? `${orderId}-${colorwayId}-${visitId ?? operationId}`
```

Duplicate key warning `...-op` meant multiple allocations had null `operationId` because mapper read deprecated `operation_id` column instead of `order_route_id`.

### After tapping a card

1. Navigate with `?colorway={uuid}&operation={order_routing_steps.id}`.
2. Resolve flow: `order_routing_steps` for order (not template `process_flows` unless no route saved).
3. Filter steps where `department_id === user.department_id` and `capture_app` matches current app (`hourly`, `qc_log`, …).
4. Open capture screen for the selected operation.

### Transaction / handover

- Handover dispatches from **exit operation** in user's department (`is_primary_output` / last op in dept on route).
- Send payload: `fromOperationId`, `toOperationId`, `fromDepartmentId`, `toDepartmentId`.
- WIP integrity: next department cannot capture until handover received.

### Department `apps` vs step `capture_app`

| Source | Meaning |
|--------|---------|
| `departments.apps` | What the work center **can** run (capability pool) |
| `order_routing_steps.capture_app` | Which app runs for **this visit** on the route |

A department with both `hourly` and `qc_log` may route Block Cut → `hourly` and Inline QC → `qc_log`.

---

## 4. Capture write payloads

All writes must include **`order_route_id`** (app field name may still be `operationId` / `orderRouteId`).

| App | Table | Required ids |
|-----|-------|----------------|
| Hourly | `hourly_counts` | `orderId`, `colorwayId`, `departmentId`, **`orderRouteId`**, `shiftId`, `hourSlot`, qty |
| Batch | `batch_production` | `orderId`, `colorwayId`, `departmentId`, **`orderRouteId`**, `resourceId`, time window, size output |
| QC | `inspection_sessions` | `orderId`, `colorwayId`, `departmentId`, **`orderRouteId`**, pass/fail counts |
| Audit | `audit_sessions` | `orderId`, `colorwayId`, `departmentId`, **`orderRouteId`**, AQL fields |
| Handover | `handover_slips` | `fromOrderRouteId`, `toOrderRouteId`, dept ids, qty |

RPCs accept legacy JSON keys (`operationId`, `flowStepId`) but DB column is `order_route_id`.

---

## 5. Users and entitlements (unchanged login)

| Piece | Location |
|-------|----------|
| Login | `verify_floor_login` — factory code + employee ID + PIN |
| Profile | `profiles`: `factory_id`, `department_id`, `user_role`, `assigned_apps`, `floor_pin` |
| Home tiles | Show only apps in `assigned_apps` |
| Factory apps | `factories.production_apps`, `transaction_apps`, etc. — caps what admin can assign |

Desktop **User Management** creates users via edge functions; floor only reads profile at login.

**Admin visibility fix:** `current_factory_id()` now falls back to profile row if JWT lacks `factory_id` — affects desktop, not floor login.

---

## 6. Desktop behaviors floor should expect

| Desktop action | Floor impact |
|----------------|--------------|
| Save order routing | Replaces `order_routing_steps`; **deletes existing `line_allocations`** for that order — styles disappear from floor until replanned |
| Save line plan | Upserts allocations per visit; sets `order_route_id` + `visit_id` |
| Route overwrite confirm | Planning warns before wipe — floor sees empty list until new plan saved |
| Visit rules | Same dept can't be consecutive visits; first origin pinned; loading left / produce right in UI only |

---

## 7. Known issues fixed in plapps (apply same in your branch)

| Issue | Fix |
|-------|-----|
| Duplicate React key `...-op` on hourly list | Map `order_route_id`; use `allocation.id` as key |
| Null `operationId` on allocations | Read `order_route_id` with fallback to `operation_id` |
| Multiple cards same style | Intentional — one per visit/allocation |

---

## 8. Mobile IDE checklist

Copy into your prompt:

```
Wire floor app to visit-based routing:

1. Bootstrap: map line_allocations.id, order_route_id, visit_id; map order_routing_steps.visit_id
2. Style list: one row per allocation (not per order+colorway); unique key = allocation.id
3. Operation label: join order_route_id → order_routing_steps.step_label (never allocation.operation_name)
4. Navigation: ?operation={order_routing_steps.id}&colorway={uuid}
5. Capture writes: include order_route_id on hourly, batch, QC, audit, handover
6. Flow resolution: prefer order_routing_steps over process_flows template
7. Filter operations: user.department_id + step.capture_app matches current floor app
8. Handover: use is_primary_output / exit op in dept; from/to order_route_id
9. After desktop route save: allocations cleared — expect empty list until replan
10. Login, assigned_apps, department assignment — no change
```

---

## 9. Reference files

| Topic | Path |
|-------|------|
| Floor terminology | `plapps/agents/OPERATION_TERMINOLOGY_AGENT.md` |
| Process flow overview | `docs/MOBILE_FLOOR_PROCESS_FLOW.md` |
| Visit planning (desktop) | `lib/visitPlanning.ts`, `lib/processFlowStepFlags.ts` |
| Bootstrap mapper | `plapps/lib/floorBootstrapMapper.ts` |
| Style list | `plapps/app/floor/hourly/page.tsx` |
| Operation helpers | `plapps/lib/processFlowSteps.ts`, `plapps/lib/operationDisplay.ts` |
| Route save RPC | `supabase/migrations/20260706100000_order_route_visits.sql` |
| Line plan save | `lib/buildLinePlanPayload.ts`, `lib/saveLinePlan.ts` |

---

*Last updated: July 2026 — after visit-based routing, order_route_id rename, and hourly list key fix.*
