# PRODIGI — Remaining Work Plan

> Generated 2026-07-31 after query/pagination migration, desktop fulfillment RPCs, planning single-order scope, and admin write RLS.
> Verification baseline: `npm run typecheck` · `npm run test` (21/21) · `npm run build`

---

## Shipped in this workstream

| Area | Status |
|------|--------|
| Paginated list pages (Dashboard, Status Tracker, Planning Board) | Done |
| Order Completion scoped catalog (cut-to-ship + completion map) | Done |
| Style Details / Color Details query-first (no store order fallback) | Done |
| Production Planning single-order scope + gantt peer context | Done |
| Desktop fulfillment (`log_desktop_shipment` / `log_desktop_rejection`) | Done (SQL applied) |
| Defects + master-table admin write RLS | Done (SQL applied) |
| RBAC route guard + sidebar filtering | Done |
| Orphan component/hook cleanup | Done |
| Reports canonical entry (`lib/reports/index.ts`) | Done; shim kept |

---

## Page audit (2026-07-31)

| Page | Data loading | Notes |
|------|----------------|-------|
| **Dashboard** | TanStack Query + `lib/reports` | Uses enriched page for cut-order IDs only. `orders.find` is scoped to that page — OK. |
| **Status Tracker** | `useOrdersList` + enriched page; client pipeline filter on current page | OK |
| **Planning Board** | `useOrdersList` + enriched page; client planning-status filter + unplanned-first sort | OK |
| **Production Planning** | `useOrderForEdit` + `usePlanningGanttContext` + `useAssignedResources` | OK — no full factory bundle |
| **Dept Schedule** | `useGanttScheduleWindow` | Window-scoped active orders + date overlap |
| **Create Order** | `useOrderForEdit` + form queries | Mutations via `dataStore` |
| **Style Details / Color** | `useOrderForEdit` + `useOrderAllocations` | OK |
| **Order Completion** | Cut-to-ship report + completion map + `useOrderForEdit` | OK |
| **Floor Day Board** | Report RPCs | OK |
| **Day / Style Report** | `lib/reports` | Migrated from `mesReportsApi` shim on main pages |
| **Transaction Report** | Dedicated API | OK |
| **Settings** | Lazy settings slices + `settingsStore` writes | **RPC target** (Phase 2) |
| **Work Centers** | Settings slices + store mutations | **RPC target** |
| **User Management** | Edge functions for users; some direct table writes | **RPC target** for dept flags |

### Still on Zustand `dataStore` (by design)

- Create Order / planning save: `addOrder`, `updateOrder`, `refreshOrderAndAllocations`
- WIP order draft: `wipOrder`
- Assigned resource CRUD from Work Centers

These are **mutation paths**, not full-catalog reads. Keep until Settings/Resource RPCs land.

---

## Phase 1 — Settings → RPC mutations (next big project)

**Goal:** Replace direct `supabase.from(...).insert/update/delete` in client with validated RPCs. RLS already restricts writes to admin; RPCs add validation, audit hooks, and a single security boundary.

### 1.1 Inventory (client write surfaces)

| Surface | File(s) | Tables touched |
|---------|---------|----------------|
| Settings store | `stores/settingsStore.ts` | buyers, departments, shifts, process_flows, size_groups, support_dropdowns, defects, fabric_components, workforce rates, factories |
| Data store | `stores/dataStore.ts` | assigned_resources |
| User management | `pages/system/UserManagement.tsx` | profiles, floor access (partially edge functions) |
| Colorway routing | `lib/colorwayRouting.ts` | order_routing_steps (via RPC today?) |
| Line plan save | `lib/saveLinePlan.ts` | line_allocations (RPC `save_line_plan`?) |

**Action:** Grep `supabase.from` + `.insert|.update|.delete` across `stores/`, `pages/system/`, `lib/` and produce one RPC per entity following `save_style_order` / `save_line_plan` patterns.

### 1.2 Recommended RPC order

1. `save_buyer` / `delete_buyer` (soft-delete if orders reference)
2. `save_department` / `delete_department` (block if allocations exist)
3. `save_shift`, `save_process_flow`, `save_size_group`
4. `save_support_dropdown`, `save_defect`, `save_fabric_component`
5. `save_assigned_resource` / `delete_assigned_resource`
6. `save_factory_settings` (factory row + app config JSON)
7. Wire `settingsStore` methods one entity at a time; keep reads on TanStack Query slices

### 1.3 Migration template per entity

```sql
CREATE OR REPLACE FUNCTION public.save_<entity>(p_factory_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_factory_id <> current_factory_id() THEN RAISE EXCEPTION 'Wrong factory'; END IF;
  -- validate payload, upsert, optional audit_events insert
END;
$$;
```

### 1.4 Frontend swap pattern

1. Add `lib/settingsRpc.ts` with typed wrappers
2. Replace one `settingsStore` method → RPC + `invalidateFactorySettings(factoryId)`
3. Vitest: mock RPC response + store method
4. Manual: Settings page smoke test for that entity

**Estimate:** 2–3 days per entity batch; full settings layer ~2 weeks.

---

## Phase 2 — Reports consolidation

| Task | Priority |
|------|----------|
| Migrate `DayReport.tsx`, `StyleReport.tsx`, `OrderCompletion.tsx` imports → `lib/reports` | P2 |
| Split `lib/reports/dayReport.ts` (2774 lines) into dept sections + shared utils | P3 |
| Remove `lib/mesReportsApi.ts` shim after zero importers | P3 |
| Remove `lib/styleReportDailyDebug.ts` from production builds | P3 |

---

## Phase 3 — Production Planning polish

| Task | Priority |
|------|----------|
| Consolidate `planningRows` / `planningBuffer` / `dirtyColorIds` into one reducer | P3 |
| Status Tracker / Planning Board: client-side filter on paginated pages (accepted) | Done |

---

## Phase 4 — Schema / platform backlog

From `docs/SCHEMA_BACKLOG.md`:

| Item | Priority |
|------|----------|
| Migration history repair (`repair-migration-history.mjs --apply`) | P1 ops |
| Remaining `FOR ALL` policies (cutting_bundles, workforce_logs, …) | P2 |
| Company / HQ multi-tenant layer | Future |
| Desktop RBAC expansion (planner, viewer roles) | Future |
| `audit_events` from all save RPCs | With Phase 1 RPCs |
| PIN rate-limiting on floor login | P2 security |
| Performance indexes at scale | When volume demands |

---

## Phase 5 — UX / remediation (from PRODIGI_Remediation_Plan.md)

| Task | Page |
|------|------|
| Status filter uses shipment-plan dates, not terminal-produced heuristic | Status Tracker |
| Accessible SelectDropdown + Modal focus trap | `components/ui.tsx` |
| Create Order: draft persistence (localStorage) | Create Order |
| Style Report: fix factory-switch selectedOrderId reset | Style Report |
| Day Report: typed loading state (remove magic strings) | Day Report |

---

## Apply checklist (Supabase)

Confirm applied on live:

- [x] `20260731160000_defects_write_admin_only.sql`
- [x] `20260731170000_desktop_fulfillment_capture.sql`
- [ ] `20260731180000_admin_write_policies.sql` ← apply if not yet run
- [ ] `node scripts/repair-migration-history.mjs --apply`

Verify: `scripts/verify_live_functions.sql` + Settings save smoke test after admin write migration.

---

## Suggested execution order

```
Week 1  → Apply 20260731180000 if pending · smoke test all pages · start save_buyer/save_department RPCs
Week 2  → Remaining settings RPCs · wire settingsStore · tests
Week 3  → assigned_resources RPC · reports import migration · Status Tracker filter RPC (optional)
Week 4  → dayReport split · audit_events · remediation UX items
```

---

## Smoke test matrix (run after each phase)

| # | Flow | Pass criteria |
|---|------|----------------|
| 1 | Login → Dashboard | KPIs load, no full-page reload |
| 2 | Status Tracker → Style Details | Single click, Gantt visible |
| 3 | Planning Board → Production Planning | Peer Gantt bars, save plan |
| 4 | Order Completion | Shipment + rejection save |
| 5 | Settings → edit department | Saves as admin |
| 6 | Create Order → save | New order appears in Status Tracker |
| 7 | Day Report / Style Report | Loads for date range + order |
