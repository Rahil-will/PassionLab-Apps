# Mobile floor app — process flow changes

Simple guide for what changed in **routing / process flows** and what the floor (mobile) app must do for **department + operation** logging.

---

## What stayed the same

### Login

No change to login.

1. Operator enters factory code + employee ID + PIN (or email + PIN).
2. `verify_floor_login` returns the same profile fields:
   - `department_id` — user's work center (one department per user)
   - `assigned_apps` — which apps they may open (`hourly`, `qc_log`, `transaction`, etc.)
   - `user_role`, `factory_id`, `employee_id`

Home screen still shows tiles only for `assigned_apps`.

### User assignment

Users are still assigned to a **department**, not to individual operations. Operations come from the order's process flow at capture time.

---

## What changed (desktop / planning)

### Before — department only

```
Order → Process flow (list of departments)
Floor: pick Order → Department → log output/QC
```

One step in the flow = one department. Capture was keyed by `order_id` + `department_id`.

### After — department + operation

```
Order → Process flow (ordered visits)
Each visit = department + operation label + capture_app
```

| New / updated | Where | Meaning |
|---------------|--------|---------|
| `process_flow_steps.step_label` | Routing template | Operation name (e.g. Block Cut, Final Sew) |
| `process_flow_steps.capture_app` | Routing template | Which floor app for **this visit**: `hourly`, `qc_log`, `transaction`, `audit` |
| `colorways.process_flow_id` | Per color on order | Routing lives on colorway, not order header |
| `line_allocations.flow_step_id` | Planning | Which operation row is being planned |

**Department `apps`** = capability pool (what the work center *can* run).  
**Step `capture_app`** = which app runs for *this operation visit* on the route.

A department can have both `hourly` and `qc_log` enabled. Block Cut might use `hourly`; Final QC on the same department might use `qc_log`.

---

## What the mobile app must do

### Reading (before capture)

1. **Login** — unchanged.
2. **Pick order** — unchanged.
3. **Pick operation** — **new step**  
   Load process flow steps for the order's colorway(s) where `department_id` = user's department.  
   Show list of **operations** (`step_label`), not just department name.
4. **Open the right app** — use `capture_app` on the selected step (not a fixed app per department).

### Writing (capture payload)

When saving hourly output, QC, or handover, include:

| Field | Required | Notes |
|-------|----------|--------|
| `orderId` | Yes | Same as today |
| `departmentId` | Yes | Must match user's `department_id` |
| `flowStepId` | **Yes (new)** | `process_flow_steps.id` for the chosen operation |
| `colorwayId` | Yes | When order is color-scoped |
| Other fields | Per app | `hourSlot`, sizes, qty, etc. — unchanged |

**Rule:** Pieces are logged against **department + operation** (`flow_step_id`), not department alone.

### Handover

Handover still mandatory between steps. Sender/receiver steps should align with **flow step order** (operation N → operation N+1), not only department sequence.

---

## What is NOT in scope for this doc

- Create Order shipment plan (desktop only, `style_orders.shipment_plan` jsonb)
- Buyer shipment dropdowns (per buyer on `buyers` table)
- Reporting views rebuild

---

## Quick checklist for mobile dev

- [ ] After order select, show **operations** for user's department from `process_flow_steps`
- [ ] Launch app from step's `capture_app`, not hard-coded per department
- [ ] Send `flowStepId` on every capture write
- [ ] Keep `departmentId` validation against user profile
- [ ] Login and `assigned_apps` home tiles — no change

---

## Reference files

| Topic | Path |
|-------|------|
| Floor app IDs | `lib/floorApps.ts` |
| Routing / operations UI | `components/settings/ProcessFlowEditor.tsx` |
| Planning by operation | `pages/planning/components/PlanningTable.tsx` |
| Floor login RPC | `supabase/schema.sql` → `verify_floor_login` |
| Mobile login API | `plapps/app/api/floor/login/route.ts` |
| Onboarding doc (broader) | `docs/ONBOARDING_FLOOR_USERS.md` |
