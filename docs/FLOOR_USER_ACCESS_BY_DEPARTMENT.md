# Floor user access by department type

> Reference for **User Management**, **floor PWA (plapps)**, and **RLS/RPC** work.  
> Canonical write path: `replace_floor_user_access` → `profile_floor_flags_for_assignment`  
> (migrations `202607148`, workforce rule in `202607152`).

Related: [PLAPPS_FLOOR_ACCESS_MODEL.md](./PLAPPS_FLOOR_ACCESS_MODEL.md) · [ONBOARDING_FLOOR_USERS.md](./ONBOARDING_FLOOR_USERS.md)

---

## Core rule

Every work center on the floor needs **operators** (capture) and/or **supervisors** (handover), except **terminal** which uses **Shipment/QA** users instead of supervisors.

```
OPERATOR   = production operations assigned  → can_produce = true
SUPERVISOR = no production operations        → handover (always); workforce (production only)
TERMINAL   = Dispatch op + shipment_qa       → no supervisor role
```

**Operators never get handover or workforce.** Those are visit-level supervisor capabilities.  
**Supervisors never capture production.** They are assigned **operations for visit scope** (which handover/workforce applies to), not for hourly/QC/batch capture.

---

## Department types

Departments are identified by **`role`** (seeded work centers) and **`planning_mode`** (standard work center behaviour).

| Type | `role` | `planning_mode` | Floor capture | Needs supervisor? |
|------|--------|-----------------|---------------|-------------------|
| **Production** | `standard` | `production` | Hourly, QC, or batch | Yes — handover + workforce |
| **Origin (cutting)** | `origin` | `native_cutting` | Lay report (`cutting_lay`) | Yes — **handover only** |
| **Store** | `standard` | `storage` | None (store steps) | Yes — **handover only** |
| **Outsource** | `standard` | `outsource` | None (outsource steps) | Yes — **handover only** |
| **Terminal** | `terminal` | `native_shipment` | Shipment / QA | **No** — use `quality_manager` + Dispatch |

Outsource departments use a **two-leg handover** (out-challan to vendor, return-challan on receipt) before pieces move to the next in-house step. Store departments hand over stored/WIP pieces the same way supervisors do elsewhere — without hourly capture on the floor.

---

## User personas and profile flags

Set by `profile_floor_flags_for_assignment` when saving via User Management.

### Operator (all non-terminal departments)

| Flag | Value |
|------|-------|
| `can_produce` | `true` |
| `handover_enabled` | `false` |
| `workforce_enabled` | `false` |
| `audit_enabled` | `true` (default; optional off) |
| `shipment_qa_enabled` | `false` |
| `floor_user_access` rows | One per assigned operation |

### Supervisor — by department type

| Department type | `handover_enabled` | `workforce_enabled` | `floor_user_access` rows |
|-----------------|-------------------|---------------------|--------------------------|
| Production | `true` | **`true`** | **One per supervised operation** |
| Origin (cutting) | `true` | **`false`** | **One per supervised operation** |
| Store | `true` | **`false`** | **One per supervised operation** (usually Store) |
| Outsource | `true` | **`false`** | **One per supervised operation** |
| Terminal | — | — | **Not assignable** |

Supervisors always have `can_produce = false` and `audit_enabled = false`.

### Terminal (Shipment / QA)

| Flag | Value |
|------|-------|
| `user_role` | `quality_manager` (not `supervisor`) |
| `can_produce` | `false` |
| `handover_enabled` | `false` |
| `workforce_enabled` | `false` |
| `audit_enabled` | `false` |
| `shipment_qa_enabled` | `true` |
| `floor_user_access` rows | Dispatch operation (`capture_app = shipment_qa`) |

---

## Capability matrix (what each user can do)

| Capability | Production operator | Production supervisor | Origin operator | Origin supervisor | Store / outsource supervisor | Terminal user |
|------------|--------------------|-----------------------|-----------------|-------------------|------------------------------|---------------|
| Hourly / QC / batch capture | Yes | No | — | — | — | — |
| Lay report (cutting) | — | — | Yes | No | — | — |
| Handover challans | No | **Yes** | No | **Yes** | **Yes** | No |
| Workforce headcount log | No | **Yes** | No | No | No | No |
| Optional audit (AQL) | Optional | No | Optional | No | No | No |
| Shipment / buyer QA | No | No | No | No | No | **Yes** |
| Style supervisory KPIs | Basic | Full | Basic | View + handover | Handover only | Shipment scope |

**Workforce logging** applies only where in-house sewing/finishing lines run attendance-driven efficiency — i.e. **`planning_mode = production`**. Origin cutting, store, and outsource supervisors move pieces via handover; they do not log line headcount.

---

## User Management assignment rules

Desktop: **System → User Management**.

| Work center type | Floor role options | Production operations | Visit apps (supervisor) |
|------------------|-------------------|----------------------|-------------------------|
| Production | Operator or Supervisor | Operator: pick ops for capture | Supervisor: pick ops for scope + Handover + Workforce |
| Origin | Operator or Supervisor | Operator: cutting ops | Supervisor: pick ops for scope + Handover only |
| Store | Operator or Supervisor | Usually none | Supervisor: Handover only (locked) |
| Outsource | Operator or Supervisor | Usually none | Supervisor: Handover only (locked) |
| Terminal | Shipment/QA only | Dispatch (auto) | N/A |

Validation (`validateFloorUserPayload`):

- Supervisor with zero operations → error  
- Operator + zero operations (non-terminal) → error  
- Supervisor on terminal work center → not offered  

UI labels:

- **Supervisor — handover & workforce** → production departments  
- **Supervisor — handover only** → origin, store, outsource  

---

## Floor home screen (plapps)

Gate tiles from **profile flags**, not `assigned_apps` alone.

| Tile | Show when |
|------|-----------|
| Production groups (hourly, QC, batch, cutting) | `can_produce` + assigned operations |
| Handover | `handover_enabled` — per-operation tiles when ops assigned |
| Supervisory / workforce | `workforce_enabled` — per-operation tiles when ops assigned |
| Audit | `audit_enabled` + operator |
| Shipment / rejection / buyer audit | `shipment_qa_enabled` + factory entitlement |

Origin operators see **cutting** tiles only. Origin supervisors see **handover** only — no workforce tile, no lay capture.

---

## Department editor (work center settings)

| `planning_mode` | Operations tab | Reference operation | Workforce rate categories | Supervisor app on dept |
|-----------------|----------------|---------------------|---------------------------|------------------------|
| `production` | Yes | User-defined (loading / produce only) | Yes | Yes |
| `native_cutting` | Yes | Fixed cutting ops | No | Yes |
| `storage` | Yes | **Store** (auto-seeded) | No | Yes |
| `outsource` | Yes | **Outsource** minimum (auto-seeded; more allowed) | No | Yes |
| `native_shipment` | Terminal ops | **Dispatch** (auto-seeded) | No | No |

Store and outsource work centers are **passive** for capture — transaction (handover) is the floor activity, driven by supervisor users.

---

## Code references

| Concern | Location |
|---------|----------|
| Supervisor eligible departments | `lib/departmentFilters.ts` → `departmentSupervisorEligible` |
| Supervisor visit apps per dept | `lib/floorUserUtils.ts` → `supervisorFloorExtrasForDepartment` |
| Save validation | `lib/floorUserUtils.ts` → `validateFloorUserPayload` |
| DB flag derivation | `profile_floor_flags_for_assignment` in `20260715200000_supervisor_workforce_production_only.sql` |
| User Management UI | `pages/system/UserManagement.tsx` |
| Mobile reaction guide | `docs/PLAPPS_FLOOR_ACCESS_MODEL.md` |

---

## Quick decision tree

```
Which work center?
├─ Terminal → quality_manager + Dispatch + shipment_qa_enabled
├─ Origin cutting
│   ├─ Operator → cutting operations, no handover
│   └─ Supervisor → handover only, no workforce
├─ Store or Outsource
│   └─ Supervisor → handover only (required for flow)
└─ Production (standard)
    ├─ Operator → hourly/QC/batch ops, optional audit
    └─ Supervisor → handover + workforce
```

---

## Minimum staffing expectation

| Work center | Minimum floor users |
|-------------|---------------------|
| Production | ≥1 operator per active operation; ≥1 supervisor for handover + workforce |
| Origin | ≥1 operator (lay capture); ≥1 supervisor (handover out of cutting) |
| Store / Outsource | ≥1 supervisor (handover / challan legs) |
| Terminal | ≥1 Shipment/QA user per factory entitlement |

Missing a supervisor on a non-terminal work center blocks handover — pieces cannot appear in the next department without a logged challan.
