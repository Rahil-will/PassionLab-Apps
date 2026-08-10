# Floor access model — mobile (plapps) reaction guide

> **Context for plapps developers.** Schema and desktop admin are defined in migrations `202607147` + `202607148`. This doc describes how the PWA should read and react — **no plapps code changes are included here**.

---

## Mental model

Two primary floor personas, plus two department exceptions:

```
                    ┌─────────────────────────────────────────┐
                    │              profiles                    │
                    │  visit-level flags + department_id       │
                    │  preferred_resource_ids (line filter)      │
                    └─────────────────────────────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
   SUPERVISOR                    OPERATOR                    TERMINAL (Shipment/QA)
   can_produce = false           can_produce = true          shipment_qa_enabled = true
   handover = true (locked)     handover = false            handover/workforce/audit = false
   workforce = true*             workforce = false           can_produce = false
   audit = false (locked)       audit = true (default)      dispatch op in floor_user_access
          │                             │
          │                             ▼
          │              ┌──────────────────────────┐
          │              │   floor_user_access       │
          │              │   one row per operation   │
          │              └──────────────────────────┘
          ▼
   Visit-first nav: handover, workforce allocate, style KPIs (full)

   * Cutting native dept: workforce = false (handover + view only)
```

**Visit-level** = same capability for every visit in the user's work center (handover slips, workforce headcount, shipment buyer screens).

**Operation-level** = user picks an operation on Home, then line → style → capture (`?operationDef=`).

---

## `profiles` columns (source of truth)

| Column | Supervisor | Operator | Terminal | Cutting supervisor |
|--------|------------|----------|----------|------------------|
| `department_id` | required | required | required (terminal WC) | required |
| `can_produce` | `false` | `true` | `false` | `false` |
| `handover_enabled` | `true` | `false` | `false` | `true` |
| `workforce_enabled` | `true` | `false` | `false` | **`false`** |
| `audit_enabled` | `false` | `true` (default) | `false` | `false` |
| `shipment_qa_enabled` | `false` | `false` | `true` | `false` |
| `preferred_resource_ids` | `jsonb` uuid[] | same | same | same |

**Removed** (do not read): `shipment_apps`, `can_log_workforce`, `trg_profiles_enforce_floor_flags` trigger.

Flag locking is **RPC-only** (`replace_floor_user_access` + `profile_floor_flags_for_assignment`), not triggers.

**Derived at login** (still returned by RPCs for compatibility):

| Legacy field | New derivation |
|--------------|----------------|
| `can_log_workforce` | `user_role ∈ {supervisor, quality_manager}` **and** `workforce_enabled` |
| `assigned_apps` | `floor_user_derived_apps(profile_id)` |
| `assigned_operation_ids` | `floor_user_operation_ids_json(profile_id)` |

---

## `floor_user_access` (operation junction)

One row per assigned operation. No flags on this table.

| Persona | Rows |
|---------|------|
| Operator | One row per produce op (hourly, qc, batch, cutting_lay, …) |
| Terminal | Dispatch op (`capture_app = shipment_qa`) for routing into shipment module |
| Supervisor | Usually **empty** — visit apps do not need operation rows |
| Cutting operator | Cutting ops only; uses `/floor/cutting?operationDef=` |

Shipment capture (buyer audit, ship, reject) is **not** visit produce — it uses shipment routes under `/floor/shipment/...`, gated by `shipment_qa_enabled` + factory `shipment_apps` entitlement.

---

## How plapps should gate each module

### Home (`app/floor/home/page.tsx`)

Use **profile flags first**, not `assigned_apps` alone (`floorApi.ts` comment).

| Tile | Show when |
|------|-----------|
| Production groups (`buildOperationProductionGroups`) | `assignedOperationIds` non-empty; each op in user's `department_id` |
| Handover sub-tile / support tile | `handover_enabled` |
| Supervisory sub-tile / support tile | `workforce_enabled` (not cutting supervisor) |
| Audit sub-tile / support tile | `audit_enabled` **and** operator (`can_produce`) |
| Shipment / Rejection (`buildSupportFloorTiles`) | `shipment_qa_enabled` + factory shipment entitlement |
| Supervisor home tile (`shouldShowSupervisorHomeTile`) | supervisor role + (`workforce_enabled` or dept has supervisor app) |

**Stop** injecting handover/workforce/audit onto operation cards for operators — those flags are false for `can_produce` users except audit.

**Supervisor-only** (`userIsSupervisorOnly`): no production groups; supervisor + handover paths only.

### Navigation patterns

| App | Nav pattern | Primary gate |
|-----|-------------|--------------|
| Hourly / QC / Batch | Operation-first → line → style | `can_produce` + op in `floor_user_access` |
| Cutting native | `/floor/cutting?operationDef=` | cutting dept + assigned cutting op |
| Handover | Visit-first (`from=transaction`) | `handover_enabled` |
| Supervisor / workforce | Visit-first → line → allocate | `workforce_enabled` + supervisor role |
| Audit (AQL) | Operation-first or `from=audit` | `audit_enabled` + operator |
| Shipment / QA | Buyer/order routes, no `operationDef` | `shipment_qa_enabled` |

### Style detail performance (`stylePerformanceDetail`)

| Persona | Mode | UI |
|---------|------|-----|
| Supervisor (any) | `full` | Hour-wise KPIs, targets — **even cutting** (view only) |
| Batch operator | `batch` | Overall style performance |
| Hourly/QC operator | `basic` | Header only |

### Workforce allocate (`canLogWorkforce`)

Replace `profiles.can_log_workforce` reads with:

```ts
canLogWorkforce = isFloorSupervisorRole(role) && workforce_enabled === true
```

- **Cutting supervisor**: `workforce_enabled = false` → no allocate button, no `/allocate` route; still gets `full` style KPIs.
- **Operators**: never allocate — `workforce_enabled` is false.

### Preferred lines (`preferred_resource_ids`)

| Today (plapps) | Target |
|----------------|--------|
| Device-local `prefsStore.preferredResourceIds` | Read/write `profiles.preferred_resource_ids` |
| `PATCH /api/floor/preferences` validates but does not persist | Persist to profile (or keep local until API updated) |

Filter dept lines via `computeEffectiveResources()` — empty array means all lines in department.

### Login / session (`/api/floor/login`, `/api/floor/me`)

**Required changes in plapps** (when implemented):

1. Select from `profiles`: `handover_enabled`, `workforce_enabled`, `audit_enabled`, `shipment_qa_enabled`, `preferred_resource_ids`, `can_produce`.
2. **Do not** read `handover_enabled` / `workforce_enabled` from `floor_user_access` (columns removed).
3. `floor_user_access` select: `operation_id` only.
4. Session valid when `department_id IS NOT NULL` (terminal users have terminal work center).
5. Map `canLogWorkforce` from `workforce_enabled` + role, not `can_log_workforce` column.

### `operationAccess` array

Today: one entry per op with copied profile flags.

**Recommended**: profile flags are global per user; `operationAccess` only needs `operationId` for produce routing. Visit apps (handover, workforce, audit) should **not** appear per operation on operator cards.

---

## Department exceptions

### Cutting (native)

- **Supervisor**: `handover_enabled=true`, `workforce_enabled=false`. Opens handover + cutting style views; **cannot** log workforce or allocate headcount.
- **Operator**: assigned cutting ops; `audit_enabled` if entitled; uses cutting flow not hourly hub.
- Batch/hourly apps in same factory may have their own embedded workforce — that is **operation capture**, not the supervisor workforce app.

### Terminal / Shipment

- Single grant: `shipment_qa_enabled=true` unlocks **all** factory shipment screens (`shipment_log`, `final_rejection_log`, `shipment_audit` from `factories.shipment_apps`).
- `floor_user_access` holds **Dispatch** op for `shipment_qa` capture routing — not traditional produce.
- No visit handover, workforce, or line audit for terminal clerks.
- Routes: `/floor/shipment/styles?mode=audit|ship` → order/colorway buyer-level flows.

---

## RPC / capture auth (`profile_dept_has_app`)

Server enforces:

- `transaction` → `handover_enabled`
- `supervisor` / `workforce` → `workforce_enabled`
- `audit` → `audit_enabled` **and** `can_produce`
- Shipment apps → `shipment_qa_enabled` + factory entitlement
- Produce apps → `can_produce` + matching op in `floor_user_access`

Capture RPCs should continue to return `REQUIRE_APP_*` / `DEPT_MISMATCH` — surface via `friendlyAppError`.

---

## Desktop admin (PRODIGI) alignment

User Management (`pages/system/UserManagement.tsx`) saves via `replace_floor_user_access`:

| UI persona | Panel |
|------------|-------|
| **Operator** | Production ops (toggle) + **Other apps** (audit only — no handover/workforce labels) |
| **Supervisor** | **Visit apps** — Handover + Workforce shown as **locked-on** tiles (cutting native: Handover only) |
| **Terminal** | Dispatch op + `shipment_qa_enabled` on save |

- Supervisor / operator flags are **locked in the DB** by `profile_floor_flags_for_assignment` — no profile triggers.
- Table **Operations** column: operators show op names + audit only; supervisors show locked visit app labels.
- Removed `can_log_workforce` and `shipment_apps` from profiles (148).

---

## Migration apply order

Apply in SQL Editor (remote is behind local through June 26 — **142–148 not on remote yet** per `supabase migration list`):

1. `20260714200000_floor_user_access_unified.sql`
2. `20260714300000_terminal_dispatch_shipment_qa.sql`
3. `20260714400000_order_detail_bundle_visit_journey.sql`
4. `20260714500000_order_completion_bundle_visit_sync.sql`
5. `20260714600000_handover_scope_and_rpc_fixes.sql`
6. `20260714700000_profiles_floor_flags.sql`
7. `20260714800000_profiles_floor_access_simplify.sql` (drops `trg_profiles_enforce_floor_flags` first)
8. `NOTIFY pgrst, 'reload schema';`

Verify with `scripts/verify_profiles_floor_schema.sql`.

---

## Checklist for plapps parity

- [ ] Login/me read profile flags; junction table = op ids only
- [ ] `canLogWorkforce` derived from `workforce_enabled` + role
- [ ] Home: audit tile only for operators; no workforce on operator op cards
- [ ] Cutting supervisor: handover + full KPIs, no allocate
- [ ] Terminal: gate shipment tiles on `shipment_qa_enabled`
- [ ] Persist `preferred_resource_ids` on profile (optional phase 2)
- [ ] Remove references to `shipment_apps` and `can_log_workforce` on profiles
