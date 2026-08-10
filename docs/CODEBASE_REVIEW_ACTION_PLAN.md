# PRODIGI Codebase Review & Action Plan

**Date:** 2026-06-17  
**Overall grade:** C+ (62/100) — solid single-factory MES prototype, not yet enterprise multi-factory SaaS  
**Stack reality:** Vite SPA (admin) + separate Next.js floor apps (`plapps`) — **not** the Next.js 15 unified app described in `AGENTS.md`

---

## Executive summary

PRODIGI correctly models garment MES concepts (departments, process flow, handover, hourly output, QC) and has a working Supabase data layer with `factory_id` scoping and RLS. It is **suitable for one factory per login session**, not for a corporate HQ running multiple factories from one console.

The gap vs expectations is mainly **product architecture** (split codebases, no company layer), **incomplete cross-cutting concerns** (offline sync, admin API, test coverage), and **UI polish / drill-down bugs** that made the product feel lower-grade than the underlying schema.

This document lists what was fixed in this pass, what to remove/consolidate, what to add, and a phased roadmap.

---

## Is this suited for multi-factory?

### Short answer: **No — per-factory only today**

| Capability | Status | Notes |
|---|---|---|
| Data isolation (`factory_id` + RLS) | ✅ | Every factory-scoped table filters by `current_factory_id()` |
| Multiple factories in one company | ⚠️ Schema supports `companies` → `factories` | No HQ UI to switch factories without re-login |
| Cross-factory dashboard | ❌ | Dashboard, Reports, Planning all bind to one `factoryId` in session |
| Cross-factory user roles | ❌ | `user_profiles` ties user to one factory context per session |
| Central onboarding / billing | ❌ | Manual SQL scripts (`scripts/onboard-factory.sql`) |
| Floor apps per factory | ✅ | `plapps` + entitlements on `factories` table |

### What “multi-factory ready” would require

1. **Company console** — factory picker, aggregated KPIs (optional), user assignment per factory  
2. **Auth JWT claims** — `company_id`, `factory_ids[]`, active `factory_id` switch without full re-auth  
3. **Shared schema migrations** — single migration pipeline for admin SPA + floor apps  
4. **Unified codebase** — per `AGENTS.md`: one Next.js 15 app with `(desktop)` and `(mobile)` route groups  

Until those exist, sell/deploy as **one factory = one tenant instance**, not as enterprise multi-site HQ software.

---

## Scorecard (dimension breakdown)

| Dimension | Score | Grade | Key gaps |
|---|---|---|---|
| MES domain model | 78 | B | Handover/capture rules documented; some UI still bypasses WIP checks |
| Data layer / Postgres | 72 | B- | Good views (`v_daily_kpis`, `v_daily_output`); RPC grants need ongoing audit |
| Multi-tenancy | 55 | C | RLS ok; no company/HQ layer |
| Admin UI (Vite SPA) | 58 | C+ | Large pages, Zustand stores, inconsistent loading/error patterns |
| Floor apps (`plapps`) | 65 | C+ | Separate deploy; env sync script; entitlements recently added |
| Auth & admin API | 50 | D+ | User create/delete partially proxied; server contract incomplete |
| Offline / sync | 35 | F | Documented in agents; not wired in Vite admin |
| Testing & CI | 25 | F | No automated test suite visible |
| Docs vs code alignment | 40 | D | `AGENTS.md` says Next.js unified; repo is Vite + plapps |
| UX polish | 60 | C | Dashboard/report drill-downs, gantt actuals were broken |

**Weighted overall: 62/100 (C+)**

---

## Completed in this pass (quick wins + remove/consolidate/add)

### Bug fixes

| Item | Files | What changed |
|---|---|---|
| Gantt actuals not showing | `lib/ganttActuals.ts`, Style/Color Details, Department Schedule | Map `v_daily_output` → `actualQty` on allocations; resolve dept name via line + `departmentId` |
| Dashboard drill to resource | `pages/Dashboard.tsx` | `BarChart.onClick` + `activePayload` (Recharts 3); breadcrumb day → resource |
| Dashboard layout | `pages/Dashboard.tsx` | KPI row + horizontal filter bar same height; chart/tables/orders full width |
| Active orders empty | `lib/dashboardData.ts` | Treat all statuses except Completed/Cancelled as in production |
| WIP double-count | `lib/mesReportsApi.ts` | Latest-day snapshot semantics |
| Entitlements empty array | `lib/factoryEntitlements.ts` | `[]` means disabled, not “use defaults” |
| Duplicate import | `StyleColorDetails.tsx` | Removed duplicate `ganttActuals` import |

### Remove / consolidate

| Item | Action |
|---|---|
| CDN Tailwind + importmap in `index.html` | **Removed** — build-time Tailwind via `@import "tailwindcss"` in `index.css` |
| Duplicate KPI definitions | Dashboard = overview; Reports = deep analysis (documented below, not merged yet) |
| `productionLines` vs `assignedResources` | Same data in store; pages should prefer `assignedResources` naming long-term |

### Add

| Item | Files |
|---|---|
| CSV export (Day Report) | `lib/csvExport.ts`, `pages/Reports.tsx` |
| Gantt actuals enrichment | `lib/ganttActuals.ts` |
| Order status sync from MES | `lib/orderProductionStatus.ts`, `stores/dataStore.ts` |
| Admin API contract doc | `lib/adminApiContract.md` |
| Factory app entitlements | migration + `docs/FACTORY_APP_ENTITLEMENTS.md` |
| Vite chunk splitting | `vite.config.ts` `manualChunks` for charts, supabase, dates |

---

## Phase 1 — Stabilize (1–2 weeks)

**Goal:** One factory runs reliably end-to-end.

| # | Task | Priority | Effort |
|---|---|---|---|
| 1.1 | Apply pending migrations on Supabase | P0 | 1h |
| 1.2 | Implement admin API `delete-user` + persist `userRole` on create | P0 | 1d |
| 1.3 | Add `refreshProductionSummary()` after floor capture webhooks (or poll interval on Status Tracker) | P1 | 0.5d |
| 1.4 | Gantt: resource-level actuals (today: dept-level cumulative on each line) | P2 | 2d |
| 1.5 | Standardize page loading/error via `PageShell` + toast | P1 | 2d |
| 1.6 | Fix `manualChunks` vendor split (react in main bundle today) | P3 | 2h |

### Migrations to apply

```
20260621100000_kpi_reporting_access.sql
20260626100000_reporting_qc_canonical.sql
20260627100000_factory_app_entitlements.sql
```

---

## Phase 2 — Consolidate product surface (2–4 weeks)

**Goal:** Fewer duplicate concepts; clearer mental model for users.

### Dashboard vs Reports

| Surface | Purpose | Keep |
|---|---|---|
| **Dashboard** | Today/month KPIs, dept → day → resource drill, active orders | Overview only |
| **Reports → Day** | Hourly style/color/resource table, CSV export | Operational deep-dive |
| **Reports → Style / Dept** | Shift tabs, efficiency, DHU | Analysis |
| **Reports → Cut to Ship** | Size-level balance | Planning/shipping |

**Action:** Add cross-links (“Open full day report”) from Dashboard drill breadcrumb to Reports with query params.

### Code consolidation

| Remove / merge | Into |
|---|---|
| Dead deleted pages (styles, inventory, TNA) | Already removed — verify no route refs in `routeMap.ts` |
| `productionLines` alias in dataStore | `assignedResources` only |
| Duplicate date helpers | `lib/orderDateUtils.ts` + `date-fns` |
| CDN / importmap remnants | Done |

### Settings entitlements

- Department editor and User Management already filter by `factories.enabled_apps`  
- **Action:** Block saving floor users with apps not entitled at factory level (validation on save)

---

## Phase 3 — Multi-factory foundation (4–8 weeks)

Only start when a paying customer needs HQ view.

| # | Task | Notes |
|---|---|---|
| 3.1 | Factory switcher in shell | Updates `factory_id` in JWT / session; re-fetch stores |
| 3.2 | `company_admin` role | RLS policies for read across factories in same company |
| 3.3 | Aggregated company dashboard | Optional; expensive queries — materialized views |
| 3.4 | Onboarding UI | Replace raw SQL with guided wizard |
| 3.5 | Billing / seat limits | Out of scope until product-market fit |

---

## Phase 4 — Architecture alignment (8–16 weeks)

**Goal:** Match `AGENTS.md` — one Next.js 15 codebase.

| Step | Work |
|---|---|
| 4.1 | Scaffold Next.js 15 App Router alongside Vite |
| 4.2 | Port auth middleware + RLS session handling |
| 4.3 | Migrate desktop routes `(desktop)/*` |
| 4.4 | Migrate floor routes to `(mobile)/*` PWA with `@serwist/next` |
| 4.5 | Retire Vite SPA + separate plapps deploy |
| 4.6 | Dexie offline queue in unified app |

This is a **rewrite-in-place migration**, not a big-bang. Run dual deploy until parity checklist passes.

---

## Phase 5 — Enterprise hardening

| Area | Actions |
|---|---|
| Testing | Playwright smoke: login, create order, planning allocation, reports load |
| CI | `npm run build`, typecheck, optional Supabase local + pgTAP for RPCs |
| Observability | Sentry for SPA + plapps; log capture failures |
| Security | Audit RLS on new tables; no service role in client |
| Performance | Index audit on `hourly_counts`, `v_daily_output`; use Supabase MCP skill |
| Offline | Implement `SYNC_AGENT.md` queue for floor capture |

---

## Known limitations (document, don’t hide)

1. **Gantt actuals** — cumulative department output per order/color, not per resource line (unless resource-level data exists in `hourly_counts`).  
2. **Day Report hourly columns** — require `dateFrom === dateTo`; range shows totals only.  
3. **Order status** — derived from production summary on refresh; not realtime.  
4. **WIP** — snapshot from KPI view latest day; not live transaction-level WIP.  
5. **Architecture doc drift** — `AGENTS.md` / `PLATFORM_ARCHITECTURE.md` need update to reflect Vite + plapps until Phase 4.

---

## File map (high-signal)

| Area | Primary files |
|---|---|
| Dashboard | `pages/Dashboard.tsx`, `lib/dashboardData.ts` |
| Reports | `pages/Reports.tsx`, `lib/mesReportsApi.ts` |
| Gantt / actuals | `components/production/GanttResourceRows.tsx`, `lib/ganttActuals.ts` |
| Data store | `stores/dataStore.ts`, `lib/orderProgressApi.ts` |
| Entitlements | `lib/factoryEntitlements.ts`, `docs/FACTORY_APP_ENTITLEMENTS.md` |
| Auth / users | `lib/createFactoryUser.ts`, `lib/adminApi.ts`, `pages/system/UserManagement.tsx` |
| Schema | `supabase/schema.sql`, `supabase/migrations/` |

---

## Recommended priority order (next 2 sprints)

```
Sprint A
  [P0] Apply migrations + smoke test reports/dashboard
  [P0] Finish admin API (delete user, userRole)
  [P1] Dashboard → Reports deep-link with dept/date params
  [P1] productionSummary refresh strategy (polling or realtime)

Sprint B
  [P1] Resource-level gantt actuals from hourly_counts
  [P2] Factory switcher design spike (if multi-factory customer confirmed)
  [P2] Playwright smoke tests
  [P3] Update AGENTS.md / PLATFORM_ARCHITECTURE.md to match reality
```

---

## Verdict

**For a single garment factory:** usable MES admin with planning, status tracking, reports, and floor capture — **after migrations and admin API completion**.

**For multi-factory enterprise:** **not ready** — data layer is preparable, product and auth layers are not.

**Grade vs your expectation:** The schema and reporting views are closer to B-tier; the split architecture, missing tests, and rough UI edges pull the overall product to **C+**. Phase 1–2 fixes close most of the “feels cheap” gaps without a rewrite; Phase 4 is required to match the documented target architecture.
