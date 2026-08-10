# PRODIGI Remediation Plan

Sequenced so architecture is built once and pages consume it, not the reverse. Do not start Phase 2 for a page until the Phase 1 items it depends on exist -- check the "depends on" line at the top of each page's section.

---

## Phase 0 -- Corrections to the original audit

Verified directly against the live database this session. Apply these corrections before triaging anything else, so effort isn't spent on a non-issue or a false claim.

1. **`anon` DML grants ("Critical" in the audit)** -- the grants are real, but every one of those 8 tables has RLS enabled with policies scoped to `{authenticated}` only, and zero policies for `anon`. In Postgres, RLS enabled + no matching policy = full deny for that role. **This is currently non-exploitable.** Still fix it (defense-in-depth -- a future RLS mistake elsewhere could turn this into something real), but it belongs in Phase 1 as hygiene, not as an emergency ahead of everything else.
2. **`line_allocations.department_id` "has no FK"** -- false. Verified: `line_allocations_department_id_fkey -> departments(id)` already exists. Drop this specific claim. `line_id` (no FK to `assigned_resources`) and `qty` (no `CHECK`) are both real and confirmed -- keep those.
3. Treat every other DB-schema claim in the audit as unverified until checked the same way -- several were confirmed correct (`process_flow_steps` genuinely doesn't exist; `po_number`/`internal_order_no` genuinely have no unique constraint), but the pattern of "real observation, wrong or incomplete conclusion" showed up twice already, so verify before fixing, not after.

---

## Phase 1 -- Architecture (build once, every page consumes this)

### 1.1 Settings/mutation RPC pattern
Direct `supabase.from(...).insert/update/delete` calls in `settingsStore.ts` (buyers, departments, shifts, process flows, size groups, resources) and `UserManagement.tsx` (user + department flag writes) all bypass server-side validation and audit. Build ONE pattern -- an RPC per entity (`save_buyer`, `save_department`, `save_shift`, `save_process_flow`, `save_factory_user`, etc.) each doing its own validation/tenant-scoping server-side -- then swap every store method to call its RPC. Do this once, here; every page section below just says "already fixed by 1.1."

### 1.2 Route/component role guard
No role enforcement exists anywhere in `App.tsx`/`Layout.tsx` -- any authenticated user can open `/admin`, `/settings`, `/user-management`, `/work-centers`, `/create-order`, `OrderCompletion`, regardless of role. Build one `<RequireRole roles={[...]}>` wrapper, apply it at the route level in `App.tsx`, and hide disallowed sidebar items based on `userProfile.userRole`. Every "no role check" item in Phase 2 below is solved by wrapping that one route with this component -- not a per-page fix.

### 1.3 `floorPin` handling
Currently appears to be stored/displayed in plain text. Hash server-side (or move to Supabase auth metadata), and never return it in a `select()`. One change, in the user/auth layer -- fixes User Management's exposure entirely.

### 1.4 `current_factory_id()` -- decide, then apply once
The function falls back to reading `profiles.factory_id` when JWT claims are absent. It's `SECURITY DEFINER`, so it does NOT depend on `profiles`' own RLS being correct -- the audit's exact framing ("if profiles RLS is misconfigured...") doesn't hold as written. The real question to settle once: should a user ever be able to change their own `profiles.factory_id` directly? If writes to that column are already properly restricted elsewhere, the fallback is fine as-is and this item closes with no code change. Verify write-access to `profiles.factory_id` specifically before touching this function.

### 1.5 Shared pagination
Status Tracker, Planning Order List, and User Management all hard-cap at `PAGE_SIZE = 20` via `.slice()` with no controls. Build one pagination hook/component (cursor or offset, your call) once, wire all three list pages to it. Same effort as fixing one, reused three times.shared hook not ui.

### 1.6 Accessible `SelectDropdown` + `Modal`
`components/ui.tsx` -- no keyboard nav, no focus trap, no `aria-*`. Fixed once here; every page using these components (most of them) inherits the fix automatically, no page-level work needed.

### 1.7 Mobile-responsive shell
`Layout.tsx`'s fixed 208px sidebar has no collapse/drawer. One responsive shell change fixes this for every page simultaneously.

### 1.8 Real breadcrumb component
`Breadcrumb.tsx` currently only renders a title/subtitle. Build a real clickable trail from the route's parent chain once; every page already using `<Breadcrumb>` gets it for free.

### 1.9 Search debounce utility
Dashboard's search re-renders on every keystroke; likely true elsewhere too. One `useDebouncedValue` hook, reused anywhere a search box exists.

### 1.10 Typed domain layer
Widespread `any[]` / `Record<string, unknown>` casts across `settingsStore.ts`, `dataStore.ts`, `CreateOrderMaster.tsx`, `StatusTracker.tsx`, `WorkCenter*.tsx`. Derive one set of concrete types from the DB schema (or Zod schemas) once; apply across all of the above as part of whatever page-level refactor touches that file anyway -- don't do this as a standalone sweep, fold it into each page's Phase 2 work so it's verified against real usage, not typed blind.

### 1.11 Database constraints -- one migration
Add in a single pass: `FOREIGN KEY (line_id) REFERENCES assigned_resources`, `CHECK (qty >= 0)` on `line_allocations`; `UNIQUE (factory_id, po_number)` and `UNIQUE (factory_id, internal_order_no)` on `style_orders` (factory-scoped, not global -- two factories can legitimately reuse a PO number); `CHECK (order_qty >= 0)`, `CHECK (adj_qty >= 0)`. Revoke the `anon` DML grants from Phase 0 in the same migration.

### 1.12 Tooling pipeline
Add `test` (vitest), `lint` (eslint), `typecheck` (`tsc --noEmit`), `format` (prettier) to `package.json`, wire into CI. Do this early -- everything else in this plan is safer to build with a type-check gate already in place, not after.

### 1.13 `getProcessFlowJourney` dead code
`dataStore.ts` queries `process_flow_steps`, which doesn't exist (confirmed in Phase 0). Fix or remove now, in the shared data layer, before any page that might call it gets touched in Phase 2.

---

## Phase 2 -- Pages (only what's genuinely page-specific)

### Dashboard
*Depends on: 1.9 (debounce)*
- Fix date filter to read `activeShipmentDeliveryDates(shipmentPlan)` -- `deliveryDate` was dropped from the DB, current filter is querying a dead column.
- `buyerOptions` should come from the `buyers` table, not derived from in-memory `orders` (empty until an order exists for that buyer).
- Add CSV export, clickable KPI/order drill-through, "today" quick-select.
- Show partial UI/per-widget skeletons instead of blocking the whole page.

### Create Order (`CreateOrderMaster.tsx`)
*Depends on: 1.10 (types), 1.12 (typecheck)*
- Remove `washType` state entirely -- column is dropped, this risks a save failure.
- Remove hardcoded `setCuttingAllowance(2)` -- read from order data, allow override.
- Split the 1,496-line component into sub-components (header, colorways, shipment plan, validation) with a reducer -- this is the one page-level item big enough to treat as its own project, not a quick pass.
- Add field-level error messages (`Record<string,string>`, not `Record<string,boolean>`).
- Add draft persistence (localStorage or a `draft_orders` table) so a refresh doesn't lose new-order work.
- Add Supabase Storage image upload for `styleImage` instead of a raw URL field.

### Status Tracker
*Depends on: 1.5 (pagination), 1.6 (accessible components)*
- Wire to the shared pagination component (removes the 20-item hard cap).
- Fix status derivation to use shipment-plan delivery targets, not the current `terminalProduced >= totalAdj` / `daysLeft < 0` logic (orders with no terminal visit can currently never show Delayed).
- Add `aria-expanded`/`aria-controls` to expand/collapse rows (or confirm 1.6 already covers this pattern).
- Replace the carousel's `/2.5` width math with a proper scrollable list with visible affordance.

### Floor Day Board
- Enforce `dateFrom <= dateTo`, add "Today"/"Yesterday"/"Last 7 days" presets.
- Add print/CSV export for floor supervisors.

### Style Details / Style Color Details
*Depends on: 1.10 (types)*
- Fix the `step_type`/`capture_app` type cast that narrows the real enum (DB allows `loading`, `outsource`, `store` -- the cast hides these).
- Add horizontal-scroll shadow + sticky first column for the production matrix on small screens (or defer to 1.7 if the responsive shell handles it).
- Add `onError` fallback for broken `image_url`.

### Production Planning
*Depends on: 1.1 (RPC pattern) if any planning writes still go direct*
- **Integrate `ColorwayRoutingPanel`** -- it exists in `components/planning/` but isn't imported/rendered anywhere. This is a missing feature, not a bug -- confirm the intended UX (color section after routing, size×qty table alongside) before wiring it in.
- Consolidate the sprawl of separate state (`planningRows`, `planningBuffer`, `dirtyColorIds`, `pendingAllocations`, `deletedAllocationIds`, plus refs) into one reducer or state machine. Remove the `setTimeout` used to auto-open the print modal.
- Merge `showDiscardPlanModal`/`showColorUnsavedModal` into a single unsaved-changes flow.
- Surface routing-fetch errors instead of silently falling back to `order?.routingSteps`.

### Planning Order List
*Depends on: 1.5 (pagination)*
- Wire to shared pagination.
- Simplify the `plannedQty` fallback chain -- it's currently hard to reason about and can mislabel Partial/Planned status.

### Department Schedule
- Batch `fetchGanttFabricActuals` into one `get_factory_fabric_actuals`-style RPC instead of calling it once per order on mount (real N+1).
- Add zoom/pan controls for the Gantt view (longer-term item, not urgent).

### Order Completion
*Depends on: 1.2 (role guard)*
- Apply the role guard here specifically -- currently no check before rendering the completion workspace at all.
- Fix the buyer-filter race condition (`meta` is `null` on first render).
- Consider decomposing `OrderCompletionWorkspace.tsx` (69KB) into list/detail/action components -- lower priority than Create Order's split, same category of problem.

### Reports (Landing / Day Report / Style Report)
- Day Report: replace the `'__loading__'` magic-string department placeholder with a typed loading state; add "export all departments" workbook option.
- Style Report: fix `selectedOrderId` resetting on every factory switch; simplify the `reportDataStale` boolean logic.
- Landing: add recent/saved reports and a KPI summary instead of a bare link list.

### Work Centers -- Buyers
*Depends on: 1.1 (RPC pattern)*
- Block (or soft-delete) buyer deletion when orders still reference it -- currently silently orphans `buyer_id`.

### Work Centers -- Departments
*Depends on: 1.1 (RPC pattern), 1.10 (types)*
- Extract one `deriveDepartmentSavePayload` function used by both `validateBeforeSave` and `handleSave` -- currently duplicated, can silently diverge (validated-but-fails-to-save).
- Replace the imperative `defectsSaveRef`/`fabricSaveRef`/`ratesSaveRef` pattern with a single form reducer.
- Guarantee `ensureReferenceOperationForDepartment` always runs as part of the save RPC, not conditionally from the client.

### Work Centers -- Process Flows
- Fix `normalizeStepsForSave` regenerating step IDs via `crypto.randomUUID()` on both select and save -- IDs must stay stable from the DB; only generate new ones for genuinely new steps.
- Remove the archive tab (already flagged as an explicit pending requirement separate from this audit).
- Scope the duplicate-operation-label validation to `visit_id`, not globally across the whole flow.

### Work Centers -- Shifts
- Add overnight-shift (24h wrap) handling to `validateShiftTimeOverlap`.

### User Management
*Depends on: 1.1, 1.2, 1.3, 1.5*
- Role guard (1.2) closes the "any authenticated user can open this page" issue.
- `floorPin` fix (1.3) closes the plaintext-credential issue.
- Pagination (1.5) closes the "client-side filter over the full list" issue.
- Page-specific remainder: add CSV import/export, bulk enable/disable, password-reset action, column sorting.

### Settings
- Add a genuine Factory Settings panel (name, timezone, default shift, entitlements) -- currently just support dropdowns, with department/buyer/shift/process-flow management having moved to Work Centers already.

---

## Phase 3 -- Longer-term, sequence after Phase 1 + 2 are stable

- Adopt React Query/TanStack Query for server state and caching.
- Normalize `colorway_sizes`/size-level reporting instead of parsing JSONB ad hoc.
- Formal permission/entitlement service enforced server-side, not just RLS.
- Audit-log table for order/settings changes.
- Real-time subscriptions for floor capture.
- End-to-end tests (Playwright) covering create-order -> plan -> capture -> report.
- Mobile/touch-optimized floor capture, offline/PWA support -- genuinely new feature work, not remediation, and should be scoped separately from this plan once Phases 1-2 are shipped.
