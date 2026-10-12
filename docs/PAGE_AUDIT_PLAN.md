# PRODIGI Desktop — Full Page Audit Plan

> **Purpose:** Systematic walkthrough of every desktop route to find bugs, data gaps, UX regressions, and RLS issues before release.  
> **Execution:** One section per session, in order below. Log findings in `docs/PAGE_AUDIT_NOTES.md` (create on first audit pass).

---

## Audit checklist (apply to every page)

| Area | What to verify |
|------|----------------|
| **Load** | Page renders without console errors; no Rules-of-Hooks violations; loading skeletons show then dismiss |
| **Empty state** | No data → clear message, not blank or broken layout |
| **Data accuracy** | Values match Supabase / floor capture; date filters use correct attribution (`sent_at` vs `received_at`, shift hours, etc.) |
| **CRUD** | Create / edit / delete work; validation messages are correct; optimistic UI rolls back on error |
| **Filters** | Search, date range, department, colorway — each narrows results correctly; reset clears all |
| **Routing** | Deep links (`#/reports/style/:orderId`) resolve; back navigation; breadcrumb matches page |
| **Multi-tenant** | `factory_id` / `company_id` on every query; switching factory clears stale state |
| **Permissions** | Role-gated actions hidden or disabled for floor vs admin users |
| **Export** | Excel/CSV columns match on-screen data |
| **Performance** | No N+1 queries; large lists paginate or virtualize |
| **Regression** | Compare against known fixes in recent PRs (handover status, plan end, hourly target, hooks) |

---

## Pass order (recommended)

### Phase 1 — Foundation (masters & access)

| # | Route | File(s) | Focus |
|---|-------|---------|-------|
| 1 | Settings | `pages/Settings.tsx`, `components/settings/*` | Departments, process flow, buyers, defects, shifts, dropdowns — save/load round-trip |
| 2 | User Management | `pages/system/UserManagement.tsx` | Create/edit/delete floor users; entitlements; PIN flow |
| 3 | Workforce | `pages/Workforce.tsx` | Worker registry per department; assignment sync |
| 4 | Login | `pages/Login.tsx` | Auth, factory selection, session persistence |

### Phase 2 — Order lifecycle

| # | Route | File(s) | Focus |
|---|-------|---------|-------|
| 5 | Dashboard | `pages/Dashboard.tsx`, `lib/dashboardData.ts` | KPI cards, recent orders, links |
| 6 | Create Order | `pages/production/CreateOrderMaster.tsx` | Size labels, colorways, quantities, process flow, uniqueness validation |
| 7 | Status Tracker | `pages/production/StatusTracker.tsx` | Pipeline stages, WIP, dept progress |
| 8 | Order Details | `pages/production/StyleDetails.tsx` | Header, flow summary, navigation to colorways |
| 9 | Colorway Details | `pages/production/StyleColorDetails.tsx` | Per-color progress, dept breakdown |
| 10 | Order Completion | `pages/production/OrderCompletion.tsx`, `components/production/OrderCompletionWorkspace.tsx` | Size balance, rejections, shipments, disputes |

### Phase 3 — Planning & scheduling

| # | Route | File(s) | Focus |
|---|-------|---------|-------|
| 11 | Planning Board | `pages/planning/PlanningOrderList.tsx` | Order list, filters, navigation to detail |
| 12 | Production Planning | `pages/planning/ProductionPlanning.tsx`, `PlanningTable.tsx` | Allocations, SAM, daily/hourly target save, resource rows |
| 13 | Department Schedule | `pages/planning/DepartmentSchedule.tsx`, `DepartmentGanttChart.tsx` | Gantt bars, plan vs actual dates |
| 14 | Transaction Report | `pages/planning/TransactionReport.tsx` | Handover ledger, shift/hour grouping, filters |

### Phase 4 — Reports

| # | Route | File(s) | Focus |
|---|-------|---------|-------|
| 15 | Reports Landing | `pages/reports/ReportsLanding.tsx` | Card links |
| 16 | Day Report | `pages/reports/DayReport.tsx`, `DayDeptCard.tsx`, `DayHandoverTables.tsx` | Hourly by shift, handover In/Out + status, plan end, hr tgt, dept switch |
| 17 | Style Report | `pages/reports/StyleReport.tsx`, `StyleDeptAnalysisSection.tsx`, `StyleFulfillmentSection.tsx` | Journey, QC charts, dept audits vs buyer audits, fulfillment |

### Phase 5 — Shell & cross-cutting

| # | Area | File(s) | Focus |
|---|------|---------|-------|
| 18 | Layout / nav | `components/Layout.tsx`, `App.tsx`, `lib/routeMap.ts` | Sidebar links, active state, lazy routes |
| 19 | Breadcrumbs | `components/Breadcrumb.tsx` | Trail for parameterized routes |
| 20 | Shared UI | `components/ui.tsx`, `PageShell.tsx` | Buttons, tables, modals consistency |

---

## Known issues to re-verify (from recent work)

- [ ] Day Report handover: `received` vs `in transit` status column; RPC date attribution
- [ ] Day Report: handover section visible when empty; no hooks error on dept switch
- [ ] Planning: `hourly_target` persists on `line_allocations` (migration `20260629180000`)
- [ ] Style Report: department audits only in dept analysis; buyer audits only in fulfillment
- [ ] Transaction report shift attribution via `hour_slot`
- [ ] Order creation: `size_labels` snapshot (no `size_group_id` FK)

---

## Finding log template

```markdown
### [Page name] — YYYY-MM-DD

**Severity:** blocker | major | minor | polish  
**Area:** load | data | CRUD | filter | routing | RLS | UX  
**Steps:** 1. … 2. …  
**Expected:** …  
**Actual:** …  
**File:** `path/to/file.tsx`  
**Fix:** (filled when resolved)
```

---

## Next session

Start **Phase 1, #1 Settings** — open each settings tab, edit a value, refresh, confirm persistence and no console errors. Create `docs/PAGE_AUDIT_NOTES.md` and log findings as you go.
