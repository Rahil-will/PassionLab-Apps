# Mobile floor apps — operation-based routing

Use this after applying migration `20260709100000_visit_allocations_operation_users.sql`.

**Related:** `docs/FLOOR_APP_WIRING_GUIDE.md`, `docs/FACTORY_APP_ENTITLEMENTS.md`, `docs/MOBILE_FLOOR_PROCESS_FLOW.md`

---

## What changed (July 2026)

| Area | Before | After |
|------|--------|-------|
| Planning row FK | `line_allocations.order_route_id` (+ `loading_route_id`) | **`line_allocations.visit_id` only** |
| Operation details | Denormalized on allocation | **Join `order_routing_steps` by `visit_id`** |
| Catalog edits | In-place update on `operations` | **Archive + supersede** (frozen `operation_def_id` on orders) |
| User access | `profiles.assigned_apps` checkboxes | **`profiles.assigned_operation_ids`** (+ workforce/audit flags) |
| Derived apps | Admin picked hourly/qc/batch | **`assigned_apps` auto-derived** from operations on save |

---

## 1. Data model

### `line_allocations` (planning → style list)

| Column | Meaning |
|--------|---------|
| `id` | Unique allocation row — use as list key |
| `order_id`, `colorway_id`, `line_id` | Order, color, resource |
| **`visit_id`** | **Only routing link** — one row per visit × color × resource |
| `qty`, `daily_target`, `sam`, dates | Planning fields |

**Removed (July 2026):** `order_route_id`, `loading_route_id`, `operation_name` — live DB had `order_route_id` (v3 rename of legacy `operation_id` on this table only; capture tables still use `order_route_id` meaning `order_routing_steps.id`).

### Resolve operations for a visit

```sql
SELECT ors.*
FROM order_routing_steps ors
WHERE ors.order_id = :order_id
  AND ors.visit_id = :visit_id
ORDER BY ors.seq;
```

- **Produce step** (primary capture / WIP exit): `is_primary_output = true`, or last `produce` step in visit.
- **Loading step** (if any): `step_type = 'loading'` in same `visit_id`.
- **Capture FK** remains `order_routing_steps.id` on `hourly_counts`, `inspection_sessions`, etc. — not `visit_id`.

Helper RPC:

```sql
SELECT public.visit_primary_route_step_id(order_id, visit_id);
```

### `order_routing_steps` (live route)

| Column | Meaning |
|--------|---------|
| `id` | Step id — **capture grain** |
| `visit_id` | Groups loading + produce in one dept visit |
| `operation_def_id` | FK to `operations` catalog (may be archived) |
| `dept_id`, `dept_name` | Snapshotted work center |

Display fields (`step_label`, `capture_app`, `step_type`) come from **joining `operations`** on `operation_def_id`. Include **inactive** rows for open orders.

### `operations` catalog (approach B)

- Never change `capture_app` in place on a live row.
- Edit in Settings → archive old row, insert successor with new id (`superseded_by_id` on archived row).
- Orders keep frozen `operation_def_id` pointing at archived operation until replanned.

### `profiles` (floor users)

| Column | Meaning |
|--------|---------|
| `assigned_operation_ids` | `jsonb` array of catalog operation UUIDs |
| `assigned_apps` | **Derived** on save: capture apps from operations + `transaction` + optional `audit` |
| `can_log_workforce` | Hourly/QC only — may enter headcount at session start (batch uses built-in session headcount) |

`audit` is assigned explicitly in User Management when the work center enables it.

### Embedded workforce (hourly / QC)

1. Operator picks **resource** (line).
2. Style list = `line_allocations` for that resource — one row per planned visit × colorway.
3. Card subtitle = operation names in the visit (`visit_id` → `order_routing_steps`).
4. Headcount upsert keyed by **`line_allocation_id`** × shift × `log_date` (`workforce_logs`).

Batch operators skip this — headcount is on each `batch_production` session.

---

## 2. Bootstrap load

Minimum datasets (unchanged entry point: `get_floor_bootstrap` or equivalent):

| Dataset | Usage |
|---------|--------|
| `order_routing_steps` | Full route per order — group by `visit_id` |
| `line_allocations` | Planned visits per line — **keyed by `visit_id`** |
| `operations` | Resolve `capture_app` / labels for `operation_def_id` (include archived) |
| `profiles` | `assigned_operation_ids` + `assigned_apps` |
| `style_orders` + `colorways` | Style selection header |

### Map allocation → floor card

```ts
interface PlanTarget {
  id: string;              // line_allocations.id
  visitId: string;         // line_allocations.visit_id
  lineId: string;
  colorwayId: string;
  styleOrderId: string;
  qty: number;
  dailyTarget: number;
  sam?: number | null;
  startDate?: string;
  endDate?: string;
}
```

### Resolve steps for a visit

```ts
function stepsForVisit(
  routingSteps: OrderRoutingStep[],
  visitId: string,
): OrderRoutingStep[] {
  return routingSteps
    .filter((s) => s.visit_id === visitId)
    .sort((a, b) => a.seq - b.seq);
}

function produceStep(steps: OrderRoutingStep[]): OrderRoutingStep | undefined {
  const produce = steps.filter((s) => s.step_type === 'produce');
  return produce.at(-1) ?? steps.at(-1);
}

function loadingStep(steps: OrderRoutingStep[]): OrderRoutingStep | undefined {
  return steps.find((s) => s.step_type === 'loading');
}
```

Label for the card: join all operation names in the visit, e.g. `Cutting (Fixed Cut + Loading)`.

---

## 3. Operation-based user access

### What the user can open

```
visible_operations =
  profile.assigned_operation_ids
  ∪ operations on open WIP orders at user's department (including archived defs)
  − hide when order visit completed / no WIP
```

### App tiles (home screen)

Do **not** build tiles from raw `assigned_apps` alone for production capture.

1. Load user's `assigned_operation_ids`.
2. For each id, read `operations.capture_app` and `operations.step_type`.
3. Build one tile per **(operation_def_id, capture_app)** the user may run.
4. Add a tile if `assigned_apps` contains `audit`.
5. Factory-function users (no department): still use `shipment_log` / `final_rejection_log` from `assigned_apps`.

### Intersection at capture time

User may capture an operation only if:

```
operation_def_id ∈ profile.assigned_operation_ids
AND operation appears on order's route (order_routing_steps)
AND user's department matches step dept (or supervisor role)
AND capture_app enabled for factory + work center
```

For **legacy orders** with archived `operation_def_id`: show if user still has that id assigned or order has WIP at that step.

---

## 4. Style selection flow

```
1. Login (email + PIN) → profile + department
2. Home → tiles from assigned operations (+ workforce/audit if enabled)
3. User picks capture mode (e.g. Hourly)
4. Style list:
   - Filter allocations on user's line(s) where visit has a step with matching capture_app
   - Match operation_def_id against assigned_operation_ids
5. User picks order + colorway (allocation row)
6. If visit has multiple steps (loading + produce):
   - Show sub-picker or auto-route by app (hourly on loading vs produce)
7. Capture writes to order_routing_steps.id (step id), not visit_id
```

### Pseudocode: styles for hourly app

```ts
function listHourlyTargets(
  profile: Profile,
  allocations: PlanTarget[],
  routingSteps: OrderRoutingStep[],
  operations: OperationRow[],
): PlanTarget[] {
  const assigned = new Set(profile.assigned_operation_ids ?? []);
  return allocations.filter((alloc) => {
    const steps = stepsForVisit(routingSteps, alloc.visitId);
    return steps.some((step) => {
      const op = operations.find((o) => o.id === step.operation_def_id);
      if (!op || op.capture_app !== 'hourly') return false;
      return assigned.has(op.id);
    });
  });
}
```

---

## 5. Capture writes (unchanged grain)

| Table | FK column | Value |
|-------|-----------|--------|
| `hourly_counts` | `order_route_id` | `order_routing_steps.id` for the step being captured |
| `inspection_sessions` | `order_route_id` | same |
| `batch_production` | `order_route_id` | same |
| `handover_slips` | `from_order_route_id` / `to_order_route_id` | step ids |

Planning KPI lookup uses `visit_id` on allocations; reporting resolves `operation_id` via `visit_primary_route_step_id()`.

---

## 6. Migration checklist (mobile)

- [ ] Stop reading `order_route_id` / `loading_route_id` from `line_allocations`
- [ ] Group route steps by `visit_id` when showing operation detail on a planned visit
- [ ] Read `profiles.assigned_operation_ids` for access control
- [ ] Join `operations` without filtering `is_active` when resolving route `operation_def_id`
- [ ] Style list: filter by visit + assigned operations, not allocation operation FK
- [ ] Keep capture payloads using `order_routing_steps.id`

---

## 7. Apply migrations

Minimum new migration:

```
20260709100000_visit_allocations_operation_users.sql
```

Also ensure prior visit migrations are applied (`20260706100000`, `20260708100000`, etc.).

Redeploy edge function after pull:

```
supabase functions deploy admin-create-user
```
