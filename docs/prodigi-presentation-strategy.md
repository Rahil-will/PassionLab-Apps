# PRODIGI Presentation Strategy

**Status:** Strategy approved for build. Buyer deck generated.  
**Built deck:** `docs/Prodigi_Product_Presentation.pptx` (17 slides: title + 16-slide story). Base deck preserved at `docs/Prodigi_Master_Deck.pptx`.  
**Sources:** PRODIGI admin SPA (this repo), base deck `docs/Prodigi_Master_Deck.pptx` (41 slides), platform docs, parent agent files. Floor capture lives in a separate `plapps` repo and was verified only from contracts in this repo.  
**Date:** 2026-08-13  
**Audience:** Factory owners, production heads, operations leaders, apparel brands, investors / senior management.

---

## How to read this document

Every product claim is tagged:

| Tag | Meaning |
|---|---|
| **IMPLEMENTED** | Live in the admin SPA and/or documented floor capture contract with code evidence |
| **PARTIAL** | Exists in schema / entitlements / one surface, but not a complete customer-facing capability |
| **PLANNED** | Roadmap or agent-doc intent; not to be shown as live |
| **UNKNOWN** | Could not verify from this repo |

The main deck shows only **IMPLEMENTED** capability as live. **PARTIAL** appears only if labelled (e.g. optional audit). **PLANNED** lives on the future slide. **UNKNOWN** is never claimed.

---

# A. PRODUCT UNDERSTANDING

## What Prodigi is

Prodigi is a **garment-factory Manufacturing Execution System**. It plans what must be made, captures what actually happens on the floor, and turns that into same-day operational intelligence.

It is **not** an ERP, PLM, costing tool, or BOM system. It does not own money, materials, or product development. It owns **production**: the plan, the execution, the movement of WIP, and the numbers management reviews.

Positioning inherited from the base deck, and confirmed by the product:

> ERP owns the money. PLM owns development. The floor still owns spreadsheets. Prodigi owns production.

## Three applications, one spine

| App | Who | Job | Status |
|---|---|---|---|
| **Onboarding** (separate repo) | RBC superadmin | Create factory, set floor-app entitlements, create first admin | **PARTIAL** in this repo (documented workflow + SQL). Customer never sees this. |
| **Prodigi Web** (this repo: Vite 6 + React 19 SPA) | Factory admin, viewer | Configure, create orders, plan, monitor, report | **IMPLEMENTED** |
| **Prodigi Floor** (`plapps`, separate repo) | Operators, supervisors, QA | Capture output, QC, cutting, handover, workforce, shipment | **IMPLEMENTED** as a product surface; UI not in this repo |

Shared backend: one Supabase project. Tenants isolated by `factory_id` + RLS. **IMPLEMENTED.**

Desktop login: email + password. Floor login (canonical, July 2026): factory code → user list → PIN, or email + PIN. Older docs that say “Factory ID + Employee ID + PIN” are **stale**. Main deck should say **PIN login on the floor**, not the obsolete three-field formula.

## Desktop roles (this repo)

| Role | Access | Status |
|---|---|---|
| `admin` / `superadmin` | Full desktop: configure, create, plan, users | **IMPLEMENTED** |
| `viewer` | Read-only: dashboard, tracker, planning views, reports. No settings / create / users | **IMPLEMENTED** (`20260810200000_profiles_viewer_role.sql`) |
| Floor roles (`operator`, `supervisor`, `auditor`, `quality_manager`) | Floor PWA, not the desktop control room | **IMPLEMENTED** in access model |

## The MES engine (three rules)

These are the product, not architecture trivia. They belong in the main story as *why the numbers can be trusted*.

1. **Output XOR QC.** A department working an order has one active capture mode — hourly output **or** piece-wise QC — never both at once. **IMPLEMENTED** (engine + floor contract).
2. **Handover is mandatory.** Pieces cannot appear in department N+1 unless department N logged a handover. Outsourced steps use two legs (out-challan + return-challan). **IMPLEMENTED.**
3. **Audit is optional.** AQL sampling does not block flow unless configured as a gate. **PARTIAL** — app entitlement `audit` exists; capture is floor-only; no desktop audit console.

## Configure → Plan → Capture → Handover → Report

This loop is real in the product. Keep it as the spine of the deck.

```
CONFIGURE          PLAN                 CAPTURE              HANDOVER           REPORT
departments        order + routing      hourly / QC /        digital challan    day · style
flows · shifts     line × date          batch / cutting      send → receive     dashboard
users              SAM + targets        + workforce          dispute → close    fulfillment
```

Reports feed the next plan. That closed loop is what makes Prodigi a system rather than a toolkit.

## Module map

For each module: what / who / problem / data / decision / status / where.

### A1. Factory configuration (Work Centers)

**What.** The factory’s production topology: shifts, buyers, departments, operations catalog, process-flow templates.  
**Who.** Factory admin.  
**Problem.** Every factory’s department chain is different. Software that assumes Cutting → Sewing → Finish cannot fit printing, washing, embroidery, or store holds.  
**Data.** `departments`, `operations`, `process_flows`, `shifts`, `shift_hour_blocks`, `buyers`, `size_groups`.  
**Decision.** Which capture method each operation uses; which steps are origin / standard / terminal; which work is outsourced.  
**Status.** **IMPLEMENTED.**  
**Where.** `#/work-centers` · `#/work-centers/buyers` · `#/work-centers/departments` · `#/work-centers/process-flows`  
**Files.** `pages/system/WorkCenter*.tsx`, `components/settings/DepartmentEditor.tsx`, `ProcessFlowEditor.tsx`, `ShiftEditor.tsx`.  
**RPCs.** `save_department`, `save_process_flow`, `save_shift`, `save_buyer`.

Department kinds (**IMPLEMENTED**):

- **Origin** — pieces enter (usually cutting). Native cutting path available.
- **Standard** — working middle. Planning mode: production / storage / outsource.
- **Terminal** — pieces leave (shipment / dispatch).

Standard production steps: **Loading** (optional intake) and **Produce** (the captured output). Store is passive. Outsource is a two-leg vendor visit.

### A2. Order creation (the production spine)

**What.** One order record: header, colorways × sizes, shipment plan. This record drives routing, planning, capture, and every report.  
**Who.** Factory admin.  
**Problem.** Planned quantity lives in ERP or Excel; the floor never sees a single, size-true order.  
**Data.** `style_orders`, `colorways`, `colorway_sizes`, `order_delivery_targets`, `shipment_plan` JSONB.  
**Decision.** What must be made, in which sizes, by when, with what cutting / over-ship allowance.  
**Status.** **IMPLEMENTED** (create + edit).  
**Where.** `#/create-order`, `#/create-order/:id`  
**Files.** `pages/production/CreateOrderMaster.tsx`, `create-order/components/{OrderHeader,ColorwayWorkspace,ShipmentPlan}Section.tsx`.  
**RPC.** `save_style_order`.

### A3. Order routing

**What.** A process-flow template is applied to an order and **frozen**. History does not rewrite if the template later changes.  
**Who.** Admin, on the planning detail page.  
**Problem.** “What is this style’s actual path through the factory?” must be stable once production starts.  
**Data.** `order_routing_steps` (frozen `operation_name`, `step_type`, `capture_app`).  
**Decision.** Path for this order, including recurring origin or outsource legs.  
**Status.** **IMPLEMENTED.**  
**Where.** Embedded in `#/planning-detail/:id` — `components/planning/OrderRoutingEditor.tsx`.  
**RPC.** `save_order_routing`.

### A4. Planning (line / date / target)

**What.** Allocate colorways to lines/resources over date ranges. Set daily targets, SAM, workforce inputs. Factory-wide Gantt for load.  
**Who.** Planner / production manager.  
**Problem.** “Who makes what, where, when?” is still a whiteboard.  
**Data.** `line_allocations`, `assigned_resources`.  
**Decision.** Load balance, realistic targets, plan vs actual.  
**Status.** **IMPLEMENTED.** Planning table includes an embedded department Gantt. Factory Gantt at `#/dept-schedule` is a **read** view of allocations + actuals overlay — not a drag-from-scratch scheduler. Base-deck copy “drag allocations onto the Gantt” overstates the primary planning UX. Say: **allocate on the planning board; see load on the Gantt.**  
**Where.** `#/line-assignment` → `#/planning-detail/:id` · `#/dept-schedule`  
**Files.** `pages/planning/PlanningOrderList.tsx`, `ProductionPlanning.tsx`, `PlanningTable.tsx`, `DepartmentSchedule.tsx`.  
**RPC.** `save_line_plan`.

### A5. Floor capture

**What.** Operators capture the way the operation actually works.  
**Who.** Operators, supervisors, QC.  
**Problem.** Production actuals live in notebooks; they never meet the plan.  
**Data.** `hourly_production`, `inspection_sessions`, `batch_production`, `cutting_sessions`, `workforce_logs`.  
**Decision.** Hourly rate, quality, cut quantity, efficiency (output × SAM vs headcount × time).  
**Status.** **IMPLEMENTED** on the floor. Desktop is read-side + desktop shipment/rejection logging.

| Capture | Typical use | Status |
|---|---|---|
| Hourly | Sewing, finishing, packing — size-wise per shift hour | **IMPLEMENTED** |
| QC | Piece-wise pass / fail / rework + defect codes | **IMPLEMENTED** |
| Batch | Washing, curing, ovens — one count per batch | **IMPLEMENTED** (floor app; not a desktop form) |
| Native cutting | Lay → fabric/plies → size-wise cut qty → bundles | **IMPLEMENTED** (floor; desktop reads fabric actuals on Gantt) |
| Workforce | Headcount by category on the same allocation | **IMPLEMENTED** (supervisor app on floor; reports consume it) |
| Audit / AQL | Optional sampling | **PARTIAL** |

**Where (desktop monitors).** `#/floor-day` — today’s received / sent / produced.  
**Where (floor).** `plapps` home tiles composed from `floor_user_access` + operation `capture_app`.  
**RPC.** `floor_capture`. Desktop: `log_desktop_shipment`, `log_desktop_rejection`.

### A6. Handover / dispute / reconciliation

**What.** Digital challan: from → to, order, colorway, size-wise qty, sender, time. Receiver confirms or disputes. Gaps can be closed with owner + remark.  
**Who.** Floor send/receive; admin monitors.  
**Problem.** WIP is guessed. Missing pieces become arguments, not records.  
**Data.** `handover_slips` (`pending` / `received` / `disputed` / `received_disputed`; loss closure fields).  
**Decision.** What is in transit, what is missing, what loss is acknowledged.  
**Status.** **IMPLEMENTED.**  
**Where.** Floor send/receive. Desktop: `#/planning/transaction-report`.  
**Files.** `pages/planning/TransactionReport.tsx`, `lib/handoverStatus.ts`, `components/reports/HandoverDisputeCell.tsx`.

### A7. Outsourcing

**What.** `planning_mode = 'outsource'` / `step_type = 'outsource'`. Two-leg handover keeps pieces on the spine while physically off-site.  
**Who.** Admin (routing), floor (challans).  
**Problem.** Printing, washing, embroidery “disappear” the moment they leave the gate.  
**Data.** Outsource routing steps + paired handover slips.  
**Decision.** Vendor turnaround, returned vs sent, OTIF still computable.  
**Status.** **IMPLEMENTED** in routing + handover model. There is no separate vendor portal (**PLANNED**).  
**Where.** Process flow editor, order routing, transaction report, style journey.

### A8. Status, style drill-in, order completion

| Module | Route | Status | Decision |
|---|---|---|---|
| Status tracker | `#/status-tracker` | **IMPLEMENTED** | Where is each order in the pipeline? |
| Style details | `#/style-details/:id` | **IMPLEMENTED** | Size × department matrix for one order |
| Color details | `#/style-color-details/:id/:colorId` | **IMPLEMENTED** | One colorway’s progress |
| Floor day board | `#/floor-day` | **IMPLEMENTED** | What happened today by department |
| Order completion | `#/production/order-completion` | **IMPLEMENTED** | Cut vs shipped vs rejected; close colorways |

### A9. Reports and dashboard

| Surface | Route | What it answers | Status |
|---|---|---|---|
| Reports landing | `#/reports` | Entry | **IMPLEMENTED** |
| Day report | `#/reports/day` | How did departments perform in this date range? | **IMPLEMENTED** |
| Style report | `#/reports/style` | How did this order travel, produce, and fulfill? | **IMPLEMENTED** |
| Department report | `#/reports/department` | Reuses Day report | **IMPLEMENTED** |
| Dashboard | `#/dashboard` | Factory snapshot for the selected period | **IMPLEMENTED** |

**Dashboard KPIs actually shown (do not invent others):** Period output vs target, Efficiency, Floor WIP, Active orders, Order → Ship %. Charts: factory output trend, efficiency trend. List: orders with balance to ship.

**Fulfillment math (IMPLEMENTED in `lib/fulfillmentMetrics.ts`):**

- Order → Cut %, Order → Ship %, Cut → Ship %
- On-time, In-full, On-time in-full as **Yes / No** on the **style report**, not as a factory-level OTIF % card on the dashboard

Base-deck slide 32 showing “82% Fulfillment / 94% Cut-to-ship / 88% OTIF” is **fabricated demo numbers** and the wrong KPI set for the live dashboard. Do not repeat those figures.

**Efficiency (IMPLEMENTED):** output × SAM ÷ (headcount × minutes), and also output vs plan on the dashboard card. Workforce is the denominator; no workforce → no efficiency. That claim is true.

**DHU / first-pass (IMPLEMENTED)** on day and style reports from QC / audit metrics. Do not headline factory-wide DHU on the dashboard — it is not a dashboard card.

### A10. Users, security, entitlements

**What.** Factory admin creates floor users with operation grants, handover / workforce / audit flags, shipment QA. Entitlements on `factories` cap which apps a tenant may assign.  
**Who.** Admin (users); RBC (entitlements at onboarding).  
**Problem.** Tablets should show only the work that person may do. Factories should not see apps they are not licensed for.  
**Status.** **IMPLEMENTED.**  
**Where.** `#/user-management`, `#/settings`  
**Edge functions.** `admin-create-user`, `admin-update-user`, `admin-delete-user`.  
**RPCs.** `create_factory_floor_user`, `replace_floor_user_access`, `verify_floor_pin`.

Security claims that are true and belong in the trust chapter, not as a tech tour:

- RLS on tenant tables by factory
- Floor PINs stored hashed
- Superadmin provisioning uses service role outside customer apps
- UI route guards are convenience; database is the enforcement

### A11. Follow one order — actual UI path

Use this as the hero device. It is not a metaphor; it is the product path.

```
CREATE ORDER                         #/create-order
  header · colorways × sizes · shipment plan
        ↓
APPLY ROUTING                        #/planning-detail/:id  (OrderRoutingEditor)
  e.g. Cutting → Print (out) → Sewing → Finish → Pack → Ship
        ↓
ALLOCATE TO LINES / DATES            #/planning-detail/:id  (PlanningTable)
  daily target, SAM, workforce
        ↓
FLOOR SEES THE PLAN                  plapps home (allocation-scoped cards)
        ↓
CUT                                  plapps cutting_lay
  lay → plies → size-wise cut qty → bundles
        ↓
HANDOVER OUT                         plapps handover
        ↓
OUTSOURCE (if on route)              out-challan → vendor → return-challan
        ↓
SEW / QC / BATCH                     plapps hourly | qc_log | batch
  + supervisor workforce
        ↓
HANDOVER to next visit               send → receive / dispute
        ↓
PACK / SHIP                          terminal shipment_log / rejection
        ↓
MANAGEMENT SEES                      #/floor-day · #/status-tracker
                                     #/reports/day · #/reports/style
                                     #/dashboard · #/production/order-completion
```

### A12. Out of scope (never present as Prodigi)

Costing / CMT / quoting · fabric/trim BOM consumption · CAD / marker · payroll / incentives (export hooks only) · ERP PO → invoice → payment · PLM / tech packs beyond the style master · inventory as a warehouse system.

Fabric *components* on a style (shell / lining for cutting) **are** in the product. That is cutting identity, not a BOM costing engine.

### A13. Agent-doc vs shipped admin SPA

`DESKTOP_AGENT.md` still describes an older IA (WIP Board, Active Audits, Cut Plan, Quality / OTIF / Outhouse report pages). **Those pages are not the shipped sidebar.** Do not screenshot or promise them.

Shipped sidebar groups: Dashboard · Production (create order, status tracker, floor day, order completion) · Planning (planning board, department schedule, transaction report) · Reports · Config (work centers, users, settings).

---

# B. BASE PPT AUDIT

**File:** `docs/Prodigi_Master_Deck.pptx`  
**Count:** 41 slides · 16:9 (960 × 540 pt)  
**Theme:** Office default. Fonts: Calibri Light / Calibri. Accents: `#4472C4` and friends — not yet a distinctive RBC/Prodigi system.  
**Overall:** Strong *thinking*, weak *storytelling*. The ideas are right. The sequence is a product encyclopedia with section-divider slides. Feature titles dominate. Screenshots are placeholders (`SCREENSHOT` labels). Slide 32 invents KPI numbers. Tech and KPI-formula slides sit in the main narrative.

### Verdict by slide

| # | Current title / gist | Purpose | Useful | Weak | Action |
|---|---|---|---|---|---|
| 1 | Title: Plan / Capture / Know | Open | Tagline, three-beat promise, RBC brand | Generic “PRODUCT PRESENTATION”; Calibri; no factory image of the problem | **REWRITE** — keep Plan · Capture · Know as a whisper, not the whole story |
| 2 | ERP / PLM / Excel gap | Problem | Best slide in the deck. “Prodigi owns production” | Slightly long body | **KEEP** concept, **REWRITE** visually as slide 02 |
| 3 | What Prodigi is (Plan/Capture/Measure) | Definition | Comparable plan vs actual — the point | Repeats slide 1; “DHU, fulfillment and OTIF” over-packs | **MERGE** into intro (slide 04) |
| 4 | Icon grid of eight capabilities | Catalogue | Honest scope | Generic icon grid; no story | **DELETE** as a slide. Scatter capabilities into the journey |
| 5 | Configure → Plan → Capture → Handover → Report | Spine | The loop. “System not a set of tools” | Divider energy | **KEEP** as slide 05, make it a diagram not a chapter card |
| 6 | Section: It starts with departments | Divider | — | Burns a slide | **DELETE** |
| 7 | Origin / Standard / Terminal | Education | True and distinctive | Too early; too structural for owners | **MOVE** idea into follow-one-order + appendix |
| 8 | Production / Outsource / Store roles | Education | True | Same | **MERGE** into journey / outsource slide |
| 9 | Loading vs Produce + four capture types | Education | Loading optional is a real nuance | Too inside-baseball for main deck | **APPENDIX** (loading) / **MERGE** capture types into slide 09 |
| 10 | Four capture screenshot grid | Product | Right idea | Four screenshots at once; placeholders | **REWRITE** as one capture slide, 2–3 frames max |
| 11 | Native cutting | Product | Strong, apparel-specific | Dense bullets | **KEEP** as a callout *inside* capture, not a solo main-deck lecture unless demo factory is cutting-led |
| 12 | Workforce / efficiency formula | Trust | “No workforce = no efficiency” is gold | Formula-first | **MERGE** into capture + trust |
| 13 | Handover vs Audit | Engine | Handover copy is excellent | Audit as equal twin overstates **PARTIAL** | **REWRITE** — handover is the story; audit is a footnote |
| 14 | Section: Three applications | Divider | — | Burns a slide | **DELETE** |
| 15 | Onboarding / Web / Floor | Architecture | Clear separation | Too soon; “one Supabase project” is backstage | **MERGE** into intro (one line) + appendix |
| 16 | Onboarding steps | RBC process | True for RBC, not for factory buyers | Wrong audience for main deck | **APPENDIX** or leave out of factory-facing cut |
| 17 | Web = control room | Product | Sidebar screenshot intent | Feature list | **DELETE** as standalone; screenshots appear in situ |
| 18 | Creating a style | Product | “One record, whole lifecycle” | Feature tour before the journey | **MERGE** into follow-one-order (first beat) |
| 19 | Process flow template | Product | Frozen onto the order | Department lecture déjà vu | **MERGE** into follow-one-order / plan |
| 20 | Planning Gantt | Product | Plan → floor hydrate | “Drag onto Gantt” overstates UX | **REWRITE** as slide 07 |
| 21 | Section: Onto the floor | Divider | — | Burns a slide | **DELETE** |
| 22 | Floor home / roles | Product | Role-based tiles | Supervisor “not capture” is too absolute (supervisors have handover + workforce; some factories differ) | **REWRITE** as slide 08 |
| 23 | Capture screenshots again | Repeat of 10 | — | Duplicate | **DELETE** (merged into 09) |
| 24 | Section: Handover challan | Divider | — | Burns a slide | **DELETE** |
| 25 | Digital challan contents | Product | Size-wise, from/to, who/when | Listy | **REWRITE** as slide 10 |
| 26 | Pending → Received → Disputed → Reconciled | Product | Conformity is the insight | Long paragraph | **KEEP** concept on slide 10 |
| 27 | Outsource two-leg | Product | “Pieces never leave the system” | — | **KEEP** as slide 11 |
| 28 | Section: Reports | Divider | — | Burns a slide | **DELETE** |
| 29 | Day vs Style lenses | Insight | Best reports idea | — | **KEEP** as slide 12 |
| 30 | Day report | Product | Morning review questions | Bullet clone of 29 | **MERGE** with 29 |
| 31 | Style report | Product | Matrix + journey | Bullet clone of 29 | **MERGE** with 29 |
| 32 | Dashboard + invented KPIs | Product | Dashboard belongs | **Fake 82/94/88.** Wrong cards vs live dashboard | **REWRITE** as slide 13 with real KPI names, no fake % |
| 33 | Section: Built to be trusted | Divider | — | Burns a slide | **DELETE** |
| 34 | Integrity rules | Trust | XOR, handover-gated WIP, frozen routing, workforce KPIs, reconciled losses | “Balance-capped entry” needs careful wording (caps exist in capture RPCs; not a single slogan in the UI) | **REWRITE** as slide 14 — five rules, factory language |
| 35 | Hierarchy pyramid | Tech | True | Main-deck architecture | **APPENDIX** |
| 36 | Security | Trust | RLS, hashed PINs, service-role isolation | Mix of buyer-trust and engineer-trust | **MERGE** buyer-facing lines into 14; rest **APPENDIX** |
| 37 | Technology stack | Tech | Accurate for this repo | Irrelevant to factory owners | **APPENDIX** |
| 38 | KPI funnel + formulas | Education | Funnel idea is good | Formula sheet; dashboard does not show this funnel as drawn | **APPENDIX** (definitions). One line of funnel on slide 13 |
| 39 | What each role gains | Value | Role table is useful | “10 minutes”, “OTIF without a spreadsheet” are directional, not measured | **REWRITE** as slide 15 — operational value, no fake time savings |
| 40 | Roadmap | Future | Honest near-term vs intelligence vs ecosystem; costing stays out | Company/HQ, PIN rate-limit, desktop RBAC: some already moving (viewer role **IMPLEMENTED**) | **REWRITE** as slide 16 — do not list items already shipped; do not present AI as near-term product |
| 41 | Close / 4-week implementation | CTA | Loop reprise, RBC contact | “4-week implementation” and “Go-live the floor runs on Prodigi” are **UNKNOWN** / sales process, not product evidence | **REWRITE** CTA without an unearned timeline unless commercial team confirms |

### What to preserve (concepts, not sequence)

- ERP / PLM / production-floor gap
- Prodigi as the production layer that feeds ERP, never replaces it
- Configure → Plan → Capture → Handover → Report
- One order / one production spine
- Flexible departments (origin / standard / terminal; production / outsource / store)
- Multiple capture methods, including native cutting
- Workforce-backed efficiency
- Digital handovers + dispute/reconcile
- Outsourced work stays on the spine
- Day lens vs style lens
- Dashboard as factory glance
- Integrity rules (trust)
- Future: operating system for garment production; inventory/costing/finance stay out

### What not to preserve

- Eight section-divider slides (6, 14, 21, 24, 28, 33 and the “foundation/payoff” cards)
- Encyclopedic department lecture before the audience cares
- Duplicate capture grids (10 and 23)
- Invented dashboard percentages
- Stack slide in the main narrative
- “Drag onto Gantt” as the planning story
- Audit as a co-equal pillar
- Employee-ID floor login
- Unverified 4-week implementation promise
- Generic icon grids and Calibri-on-Office-theme look

### Visual audit (base deck)

| Dimension | Today | Target |
|---|---|---|
| Hierarchy | Title + subtitle + many equal bullets | One headline insight per slide |
| Density | High on 4, 11, 12, 26, 38, 39 | One visual idea; 3 supporting points max |
| Screenshots | Labelled placeholders, often four-up | One hero frame, cropped, with 1–2 callouts |
| Type | Calibri Light  — too thin when projected | RBC / Prodigi identity (confirm with brand: likely a grotesque + a display). Floor never below 16 pt; titles 32–44 pt |
| Color | Default Office blue | Prodigi/RBC ink + one accent. Industrial, not SaaS-purple |
| Rhythm | Divider → lecture → divider | Problem → product → journey → proof → future |
| Apparel specificity | Strong in copy, weak in image | Cutting, challan, Gantt, style matrix — real factory screens |

---

# C. CORE STORY

## The one sentence

**The factory already knows what it has to make. Prodigi is how it knows what was actually made, where it is, and whether it will ship.**

## Narrative arc

```
PROBLEM
  Planned work is clear. Actual production is not.
        ↓
WHY THE GAP EXISTS
  ERP, PLM and Excel each own a slice. Nobody owns the floor as a system.
        ↓
CONSEQUENCE
  Planned, produced and shipped are three different numbers.
        ↓
PRODIGI
  The production layer: plan the making, capture the making, measure the making.
        ↓
THE LOOP
  Configure → Plan → Capture → Handover → Report
        ↓
FOLLOW ONE ORDER
  Watch a single style move through the factory.
        ↓
PLAN → RUN → CAPTURE → HANDOVER → MEASURE → ACT
        ↓
TRUST
  The numbers are comparable because the rules are in the system.
        ↓
VALUE
  Visibility, accountability, same-day review, WIP control — not fake % gains.
        ↓
FUTURE
  The operating system for garment production. Still not an ERP.
```

## Hero device

Do not present modules. Present **one order**.

Working example for copy and demo (illustrative names only — replace with a real demo style before build):

**Style:** Men’s Oxford shirt · **Buyer:** (demo buyer) · **Qty:** size-broken colorways · **Route:** Cutting → Printing (outsource) → Sewing → Finishing → Packing → Shipment.

At each stage, one question:

| Stage | Question Prodigi answers |
|---|---|
| Order | What was ordered, in which sizes, by when? |
| Plan | Which line, which dates, what target? |
| Floor | What is this operator supposed to run today? |
| Cutting | What was actually cut? |
| Outsource | Where is the print work? What left / what returned? |
| Sewing | What was produced, by whom, how fast? |
| Handover | What left this department? What arrived next? |
| Report | What is the order’s status today? |
| Dashboard | Which orders still have balance to ship? |

## What we refuse to say

- Any “30% efficiency / 50% less WIP / 2× productivity” claim — **no evidence in repo**
- Dashboard OTIF % as a live hero number — **not how the dashboard works**
- Audit as a shipped management module
- Buyer portal, supplier portal, IoT, AI alerts as current product
- 4-week go-live unless sales confirms
- Stack (Vite, React, Supabase) in the main narrative

---

# D. DECK STRUCTURE

Built deck: **17 slides** — a title board plus the 16-slide story. Appendix stays out of the buyer cut.

| # | Headline | Function |
|---|---|---|
| 00 | Plan the making. Capture the making. Know the making. | Title |
| 01 | The factory knows the plan. It cannot see the making. | Problem |
| 02 | The systems exist. Production is still disconnected. | Why the gap |
| 03 | Planned, produced and shipped are three different numbers. | Consequence |
| 04 | Prodigi is the production layer for the garment factory. | Introduce |
| 05 | Plan goes to the floor. The floor comes back as insight. | System |
| 06 | Follow one order through the factory. | Hero map |
| 07 | The plan becomes work on the line. | Plan |
| 08 | The floor sees only the work assigned to it. | Run |
| 09 | Capture production the way the operation actually works. | Capture |
| 10 | Every movement of WIP leaves a digital trail. | Handover |
| 11 | Outsourced work never disappears from the picture. | Outsource |
| 12 | Production becomes management insight on the same day. | Measure |
| 13 | The factory can see the risk before the order is late. | Act |
| 14 | The numbers can be trusted because the factory cannot skip the truth. | Trust |
| 15 | One production spine. Not a stack of spreadsheets. | Value |
| 16 | The operating system for garment production. | Future + close |

Department taxonomy, onboarding, stack, and KPI formulas stay in appendix. Native cutting is a callout on capture, not a solo slide.

---

# E. SLIDE-BY-SLIDE CONTENT

Visual system for the rebuild (to apply at PPT generation, not now):

- 16:9, generous margins, one accent, dark ink on light industrial paper (not glassmorphism)
- Headlines 32–40 pt; body 18–22 pt; captions 16 pt minimum
- Product screens: one hero crop per slide, real data, thin device frame, 1–2 numbered callouts
- Diagrams: horizontal flows, not icon grids
- No fake percentages. Empty KPI tiles beat invented ones
- Screenshot source: a prepared demo factory. Never fabricate UI

---

### Title — Plan the making. Capture the making. Know the making.

**Spoken.** Prodigi. Built for garment factories. One place to plan production and track what actually happens.

---

### Slide 01 — The factory knows the plan. It cannot see the making.

**Subtitle.** Orders are clear. Execution is not.

**Central message.** The pain is visibility of *execution*, not absence of planning.

**Body copy.**  
The order book is known. On the floor it becomes notebooks, WhatsApp photos and end-of-day Excel. By the time the number is compiled, the shift is over.

**Do not show.** A product screenshot. This is the world *before* Prodigi.

**Visual.** Full-bleed quiet factory / cutting table / line (photographic, desaturated) with a short list of unanswered questions, set like a poem:

- What was actually produced yesterday?
- Where is the WIP?
- What left, and what came back?
- Will this order ship on time?

**Product screenshot.** None.

**Transition.** “This is not because factories lack software.”

---

### Slide 02 — The systems exist. Production is still disconnected.

**Subtitle.** ERP owns the money. PLM owns development. The floor owns spreadsheets.

**Central message.** The gap is structural. Preserve this — it is the strongest idea in the base deck.

**Body copy.**  
ERP is for orders, finance, payroll, materials. PLM is for tech packs and BOM. Neither is built to run Cutting → Print → Sew → Finish → Pack, hour by hour, size by size, with a challan between every step.

**Visual.** Three columns. ERP · PLM · Excel/paper. A void labelled **Production** beneath them. One line under the void: *Prodigi will sit here.* Do not name Prodigi loudly yet — a whisper is enough.

**Product screenshot.** None.

**Transition.** “The cost of that void is not ‘less digital’. It is three numbers that refuse to match.”

---

### Slide 03 — Planned, produced and shipped are three different numbers.

**Subtitle.** Management reconciles them after the fact. The floor cannot steer with them in the moment.

**Central message.** The consequence is incomparability — the insight from base slide 3, promoted earlier.

**Body copy.**  
When plan lives in one file, output in another, and dispatch in a third, nobody can say whether the line is behind, whether WIP is stuck, or whether the shipment plan is already broken.

**Visual.** Three large numerals as *labels*, not fake values:

| PLANNED | PRODUCED | SHIPPED |
|---|---|---|
| the order | the floor | the carton |

A broken equals sign between them. Caption: *Until these share one spine, OTIF is an argument.*

**Do not** put 82% or any sample KPI here.

**Product screenshot.** None.

**Transition.** “Prodigi exists to make those three numbers comparable — on the same day, on the same order.”

---

### Slide 04 — Prodigi is the production layer for the garment factory.

**Subtitle.** Plan the making. Capture the making. Know the making. It feeds the ERP. It never replaces it.

**Central message.** Category, not feature list.

**Body copy.**  
Prodigi is built for how garments actually move: colorways and sizes, departments you define, lines you load, output you capture, handovers you reconcile.

**Visual.** Quiet product hero (dashboard or status tracker, real demo data) occupying 60% of the slide. Left: the sentence above + three words from the title slide — **Plan · Capture · Know** — as captions, not a capability grid.

**Product screenshot.** `#/dashboard` — `pages/Dashboard.tsx`.  
**Highlight.** Period output, efficiency, floor WIP, active orders, Order → Ship. No invented OTIF tile.

**Why this screen.** It is the control-room first impression without dumping the sidebar.

**Status shown.** **IMPLEMENTED.**

**Transition.** “Every screen in Prodigi is a node on one loop.”

---

### Slide 05 — Plan goes to the floor. The floor comes back as insight.

**Subtitle.** Configure → Plan → Capture → Handover → Report. Nothing important sits outside this loop.

**Central message.** Base slide 5, kept. This is the map of the rest of the deck.

**Body copy.** One line: *Nothing important sits outside this loop. That is what makes Prodigi a system.*

**Visual.** Five-node horizontal loop with a return arrow from Report → Plan.

| Configure | Plan | Capture | Handover | Report |
|---|---|---|---|---|
| departments, flows, users | lines, dates, routing | output + people | WIP movement | day, style, dashboard |

**Product screenshot.** None (diagram). Optional tiny glyphs from real UI chrome, not a screenshot collage.

**Transition.** “The rest of this story is not a module list. It is one order walking that loop.”

---

### Slide 06 — Follow one order through the factory.

**Subtitle.** One record. One route. One trail of actuals.

**Central message.** Hero device. The audience should feel they are watching a garment move.

**Body copy.** Name the demo style. Show the route as a factory, not as software.

**Visual.** A single horizontal journey, apparel language on top, Prodigi capture underneath:

```
ORDER          CUT           PRINT (OUT)      SEW            FINISH / PACK      SHIP
created        lay & qty     two-leg challan  hourly / QC    produced           cartons
sizes live     origin count  still on spine   people + SAM   handed on          fulfillment
```

Small captions under two or three nodes: *What Prodigi records here.* Do not explain every node — later slides zoom.

**Product screenshot (secondary, cropped).** Create-order colorway grid — `#/create-order` · `ColorwayWorkspaceSection.tsx` — as the *start* of the spine: color × size quantities. Or status-tracker pipeline cells for that order — `#/status-tracker` / `#/style-details/:id`.

**Prefer** a stylised journey + one small order-header crop over two competing screenshots.

**Why.** Base slide 18’s “one record, whole lifecycle” belongs *here*, not as a form tour.

**Transition.** “First the order is planned onto real lines and dates.”

---

### Slide 07 — The plan becomes work on the line.

**Subtitle.** Who makes what, where, when — with a target the floor can be measured against.

**Central message.** Planning is not a Gantt trophy. It is how the order becomes executable.

**Body copy.**  
The routing is applied and frozen onto the order. Colorways are allocated to resources across dates. Daily targets come from SAM and how the line is staffed. Operators do not see a catalogue of styles. They see what was planned for them.

**Visual.** Hero: planning detail for the followed order.

**Product screenshot.** `#/planning-detail/:id` · `pages/planning/ProductionPlanning.tsx` + `PlanningTable.tsx` (allocation grid + embedded department Gantt).  
Optional supporting crop: `#/dept-schedule` factory load — only if it does not clutter.

**Highlight.** Line name, date range, daily target, the order’s route chips (Cutting → … → Ship).

**Do not say.** “Drag allocations onto the Gantt” as the primary gesture.

**Status.** **IMPLEMENTED.**

**Transition.** “That plan has to leave the office.”

---

### Slide 08 — The floor sees only the work assigned to it.

**Subtitle.** PIN login. Today’s allocations. Not the entire factory.

**Central message.** Execution starts when the operator’s home screen is a work list, not an ERP.

**Body copy.**  
A sewing operator sees sewing. A supervisor sees handover and workforce. Terminal QA sees shipment. The tile set is composed from the person’s operations, the department’s capabilities, and the factory’s entitlements.

**Visual.** Floor home, tablet frame, factory-light contrast (dark UI is acceptable if that is the real PWA; do not invent a marketing skin).

**Product screenshot.** `plapps` home after PIN login. **Must be captured from the live floor app.** This repo has no floor UI.

**Highlight.** One allocation card for the followed order; tiles that match that user’s grants.

**Route / component.** Floor PWA (separate repo). Access model: `lib/floorUserUtils.ts` → `resolveFloorTileAccess`. Desktop equivalent of “what the admin configured”: `#/user-management` · `pages/system/UserManagement.tsx`.

**If a floor screenshot cannot be taken in time:** show User Management grants for that operator and say the home screen is composed from them — do not mock the PWA.

**Status.** **IMPLEMENTED** (model + floor app). Screenshot availability: **UNKNOWN** until captured.

**Transition.** “Once the work is in hand, the capture has to match the operation — not the other way around.”

---

### Slide 09 — Capture production the way the operation actually works.

**Subtitle.** Hourly on the line. Piece-wise in QC. Batch on the machine. Cutting where pieces are born.

**Central message.** One data spine, four honest capture methods. Native cutting is the origin source of truth.

**Body copy.**  
The routing specifies the capture. The floor app renders that capture. Output and QC cannot run as two simultaneous truths on the same department and order.

**Visual.** One hero capture (hourly for sewing — it is the most recognizable) plus a *strip* of three small labels: QC · Batch · Cutting. Not four equal screenshots.

**Callout (cutting).** Lay → fabric & plies → cut qty by size → bundles. Cut quantity is the fulfillment denominator.

**Callout (workforce).** Supervisors log headcount on the same allocation. *No people logged, no efficiency. That is intentional.*

**Product screenshots.**

| Frame | App | Evidence in this repo |
|---|---|---|
| Hero hourly | plapps hourly | `DeptAppId` `hourly`; day report consumes `hourly_production` |
| QC (small) | plapps `qc_log` | `inspection_sessions`; DHU on reports |
| Cutting (small) | plapps `cutting_lay` | `cutting_sessions`; Gantt fabric actuals |

**Desktop supporting screen (if floor shots missing):** `#/floor-day` · `pages/production/FloorDayBoard.tsx` — received / sent / produced for today — as proof that capture lands in the control room.

**Status.** Hourly, QC, batch, cutting, workforce: **IMPLEMENTED**. Audit: **PARTIAL** — do not show as a fourth equal capture method. Mention only as “optional AQL, where entitled.”

**Transition.** “Output is not enough. Pieces still have to move.”

---

### Slide 10 — Every movement of WIP leaves a digital trail.

**Subtitle.** Nothing appears downstream unless the previous department handed it over.

**Central message.** Handover is the WIP spine. This is the slide that should make operations heads sit forward.

**Body copy.**  
Each send creates a challan: from, to, order, colorway, quantity by size, who sent it, when. The receiver confirms what arrived. If the counts differ, the slip is disputed. Loss is closed with an owner and a remark — not a silent edit.

**Visual.** Challan lifecycle as four states, then one screenshot:

`Pending → Received → Disputed → Closed`

**Product screenshot.** Floor handover send (size-wise) **or** desktop `#/planning/transaction-report` · `pages/planning/TransactionReport.tsx` showing in-transit / disputed rows for the followed order.

**Highlight.** Size breakdown, from/to departments, dispute/gap.

**Why the desktop report is a valid hero.** Buyers of the deck are managers; they will live in the transaction report. Use floor send as a supporting crop if available.

**Status.** **IMPLEMENTED.**

**Transition.** “The same spine does not stop at the factory gate.”

---

### Slide 11 — Outsourced work never disappears from the picture.

**Subtitle.** Printing, washing, embroidery — still on the order, still reconcilable.

**Central message.** Two-leg handover. Pieces never “leave the system” while they leave the building.

**Body copy.**  
Outsource is a department role, not a side spreadsheet. Out-challan to the vendor. Return-challan back into the flow. Sent, returned and short stay visible, so fulfillment is not fiction.

**Visual.** Four-step flow (in-house → vendor → return → next dept) using the followed order’s print (or wash) step. No vendor-portal screenshot — **that does not exist**.

**Product screenshot.** Process flow with an outsource visit — `#/work-centers/process-flows` · `ProcessFlowEditor.tsx` — **or** style report journey / transaction report filtered to the outsource legs.

**Highlight.** The outsource step on the route; paired challans.

**Status.** **IMPLEMENTED** (routing + challans). Vendor portal: **PLANNED** — do not imply a login for the printer.

**Transition.** “Now the same taps become the morning meeting.”

---

### Slide 12 — Production becomes management insight on the same day.

**Subtitle.** Two lenses. One set of actuals. No overnight warehouse.

**Central message.** Base slides 29–31, compressed.

**Body copy.**

- **Day** asks: how did the factory run? Output, efficiency, handovers, disputes — by department, for a date range.
- **Style** asks: how is this order progressing? Matrix across the route, daily trend, fulfillment, the handover journey.

**Visual.** Split: Day report crop (left) · Style report crop (right). Same followed order / same date if possible.

**Product screenshots.**

| Lens | Route | Component |
|---|---|---|
| Day | `#/reports/day` | `pages/reports/DayReport.tsx`, `DayDeptCard.tsx` |
| Style | `#/reports/style` | `pages/reports/StyleReport.tsx`, production matrix, fulfillment bar, journey |

**Highlight.** Efficiency only where workforce exists. Fulfillment bar: Order → Cut, Order → Ship, Cut → Ship, On-time / In-full as recorded.

**Do not** dump DHU formulas on this slide.

**Status.** **IMPLEMENTED.** Live operational tables; no separate warehouse — true, but say “same day,” not “Supabase.”

**Transition.** “Zoom out once. This is what the plant looks like from the office.”

---

### Slide 13 — The factory can see the risk before the order is late.

**Subtitle.** Output versus plan. Efficiency. Floor WIP. Orders that still have pieces to ship.

**Central message.** Act. The followed order should appear as an attention row if it still has balance.

**Body copy.**  
For the period you choose: output versus plan, efficiency, floor WIP, active orders, and order-to-ship. Under that, the orders with pieces still to go. Drill from here into the day report, the style, or the floor board.

**Visual.** Dashboard hero. Callouts only on **real** cards.

**Product screenshot.** `#/dashboard` · `pages/Dashboard.tsx`.

**Highlight.**

1. Order → Ship %
2. Floor WIP
3. “Orders with balance to ship”

**Forbidden.** Fake 82 / 94 / 88. An “OTIF %” tile that the page does not have. (On-time in-full is a style-level Yes/No on the style report — if OTIF is mentioned, point there, not here.)

**Supporting crop (optional).** `#/production/order-completion` — cut / shipped / rejected for the followed order.

**Status.** **IMPLEMENTED.**

**Transition.** “A dashboard is only as good as the rules behind the numbers.”

---

### Slide 14 — The numbers can be trusted because the factory cannot skip the truth.

**Subtitle.** Integrity is enforced in the system, not left to discipline.

**Central message.** Why Prodigi is not “Excel with a login.” Buyer-facing trust only.

**Five rules (rewrite of base 34, factory language):**

1. **One truth at a time.** A department does not count the same work as hourly output and QC at once.
2. **You cannot produce what has not arrived.** Downstream capture waits on handover. *(Origin / cutting is the exception that *creates* the piece count.)*
3. **Every gap has an owner.** Disputed challans close as acknowledged loss, not a quiet correction.
4. **History does not rewrite.** The route is frozen onto the order when planning applies it.
5. **Efficiency needs people.** Headcount is captured against the same allocation as output.

**Visual.** Five short lines. No pyramid. No Postgres.

**One trust sentence, small:** Each factory’s data is isolated. Floor PINs are stored hashed. Provisioning of new factories is done by RBC, not by public signup.

**Product screenshot.** None required. Optional: a disputed row on the transaction report — proof, not architecture.

**Appendix the rest:** RLS internals, stack, hierarchy, PIN implementation, KPI algebra.

**Status.** Rules 1–5 **IMPLEMENTED** in engine/RPCs. Wording of “cannot log more than planned minus produced” is **PARTIAL** — capture is capped by received / available-to-send logic in RPCs; do not sloganise a UI that does not display that sentence.

**Transition.** “So what actually changes in the factory?”

---

### Slide 15 — One production spine. Not a stack of spreadsheets.

**Subtitle.** Operational value you can inspect. Not a promised percentage.

**Central message.** Base slide 39 without fake time-savings.

**Visual.** Before / after, not a role grid of seven rows (too small on a projector).

| Before | After |
|---|---|
| Plan in Excel, output in notebooks | Plan and actuals on the same order |
| WIP as a guess | WIP as received − sent, with in-transit challans |
| Outsource as a phone call | Outsource as two-leg trace |
| Efficiency as an opinion | Efficiency only when workforce is logged |
| Morning meeting as compilation | Day report already compiled |
| OTIF as a dispute after dispatch | Size-level trail from cut to ship |

**Roles, as a quiet second line (not a table of seven):**  
Management sees risk earlier. Supervisors own disputes. Operators only capture planned work. Quality sees DHU where QC ran.

**Do not claim.** “Morning review in 10 minutes” unless a named factory testimonial exists (**UNKNOWN**).

**Product screenshot.** Optional thin strip of three crops already seen (planning, challan, day report) as a reprise — or none.

**Transition.** “This is the production system today. Here is the line we will not cross, and the line we will.”

---

### Slide 16 — The operating system for garment production.

**Subtitle.** Inventory, costing and finance stay out of scope. Prodigi will feed them, never duplicate them.

**Central message.** Ambition without fake product. Close on ownership.

**Body — two columns.**

**Already the spine (now).** Configure, plan, capture, handover, report — as shown.

**Next (only what the base deck named, still not shipped):**

| Horizon | Item | Status in code |
|---|---|---|
| Near-term | Company / HQ layer | **PLANNED** |
| Near-term | Richer desktop roles beyond admin / viewer | Viewer **IMPLEMENTED**; further RBAC **PLANNED** |
| Near-term | Audit event log, PIN rate-limiting | **PLANNED** / **UNKNOWN** |
| Later | Buyer read-only WIP, supplier portal | **PLANNED** |
| Later | Machine / IoT capture | **PLANNED** |
| Later | AI delay / efficiency insights | **PLANNED** — do not visualise a fake copilot |

Do not put “Desktop RBAC” as future if we show viewer as if it were future. Say: *read-only viewers exist; finer operational roles on desktop are next.*

**Close strip (full width).**  
**Own your production.** Plan it, capture it, measure it — in one system built for how garments are made.

RBC contact: `rbc@rajeshbheda.com` · `www.rajeshbheda.com`

**Do not** print “4-week implementation” unless commercial process is confirmed.

**Visual.** Dark closing slide, one sentence, loop in micro type: CONFIGURE · PLAN · CAPTURE · HANDOVER · REPORT.

**Product screenshot.** None.

---

## Screenshot mapping table

Priority list requested, mapped to the new deck. Floor rows require a capture session in `plapps`.

| Slide | Message | Product screen | Route / component | Why | Highlight |
|---|---|---|---|---|---|
| 04 | Production layer | Dashboard | `#/dashboard` · `pages/Dashboard.tsx` | Control room without a tour | Real KPI cards only |
| 06 | Follow one order | Create order colorways **or** style pipeline | `#/create-order` · `CreateOrderMaster.tsx` / `#/style-details/:id` | Spine starts with size-true qty | Color × size grid; route chips |
| 07 | Plan on the line | Planning detail | `#/planning-detail/:id` · `ProductionPlanning.tsx`, `PlanningTable.tsx` | Executable plan | Line, dates, target, frozen route |
| 07b | Factory load (optional) | Department schedule | `#/dept-schedule` · `DepartmentSchedule.tsx` | Visual load | Bars for the followed order |
| 08 | Floor sees assignments | Floor home | `plapps` home · grants from `#/user-management` | Plan in the operator’s hand | One allocation card, role tiles |
| 09 | Capture fits the operation | Hourly (hero) | `plapps` hourly · desktop `#/floor-day` | How sewing actually counts | Size-wise hour grid |
| 09 | QC | Piece inspection | `plapps` `qc_log` | Pass/fail/rework | Defect codes |
| 09 | Cutting | Lay report | `plapps` `cutting_lay` | Origin source of truth | Size-wise cut qty |
| 09 | Batch | Batch count | `plapps` `batch` | Non-hourly ops | One count per batch |
| 10 | WIP trail | Handover send + transaction report | `plapps` handover · `#/planning/transaction-report` | Mandatory movement | Size qty, status, dispute |
| 11 | Outsource | Flow with outsource visit | `#/work-centers/process-flows` · style journey | Two-leg still on spine | Outsource step + challans |
| 12 | Same-day insight | Day + Style reports | `#/reports/day` · `#/reports/style` | Two lenses | Dept cards; matrix; fulfillment bar |
| 13 | Act before late | Dashboard + completion | `#/dashboard` · `#/production/order-completion` | Risk list | Balance to ship |
| 14 | Trust | Transaction dispute row | `#/planning/transaction-report` | Proof of reconciliation | Disputed → closed |
| — | Onboarding (appendix / internal) | Factory create + entitlements | Separate onboarding app | RBC only | Entitlement toggles |
| — | Process builder (appendix or 06 inset) | Flow editor | `#/work-centers/process-flows` · `ProcessFlowEditor.tsx` | Flexible departments | Origin → outsource → sew → ship |
| — | QC / audit desktop | None as a console | — | Audit is floor **PARTIAL** | Do not fake a desktop audit page |

Screens explicitly **not** to invent: WIP Board, Active Audits, Cut Plan page, Quality report page, Outhouse report page, Buyer portal, IoT dashboard, AI copilot.

---

# F. DEMO STORY (5–8 minutes)

Goal: the live product should replay slides 06–13. Same order throughout. Do not wander into settings unless asked.

**Prep (off-stage).** One style with colorways and a shipment date, routing that includes origin cutting, one outsource visit, sewing (hourly), terminal shipment. Allocations on today’s date so the floor home is populated. At least one handover pending or received. Workforce logged so efficiency is not “—”. Viewer login optional to show read-only.

| Min | Beat | Click path | Say |
|---|---|---|---|
| 0:00–0:40 | The order | `#/create-order/:id` (already saved) | “This is the spine. Buyer, sizes, shipment plan. Everything else hangs off this record.” |
| 0:40–1:30 | The path + plan | `#/planning-detail/:id` | “The flow is frozen on the order. This colorway is on this line, these dates, this target.” |
| 1:30–2:00 | Load (optional) | `#/dept-schedule` | “The factory load is the same allocations, across departments.” |
| 2:00–3:20 | Floor | `plapps` PIN → home → hourly for that allocation | “The operator does not hunt the ERP. They open today’s work and tap the hour.” If QC or cutting is the story of this factory, do that capture instead — one capture, not four. |
| 3:20–4:20 | Move WIP | Floor handover send **or** `#/planning/transaction-report` | “Sewing cannot invent pieces. Cutting had to hand them over. If the count differs, it is disputed, not lost.” |
| 4:20–5:00 | Outsource | Journey on `#/reports/style` or flow editor | “Print is outside the building and still on this order — out and back.” Skip if the demo style has no outsource visit. |
| 5:00–6:20 | Same day | `#/reports/day` then `#/reports/style` for the same order | “Morning: departments. This meeting: the order. Matrix, fulfillment, journey.” |
| 6:20–7:20 | Act | `#/dashboard` → row with balance to ship → `#/production/order-completion` if needed | “This is the question owners actually ask: what still has to ship.” |
| 7:20–8:00 | Trust / close | Stay on dashboard or a disputed challan | “These numbers match because the factory cannot skip handover, and efficiency cannot be faked without people.” |

**Do not demo in 8 minutes:** user management, shift editor, defect catalog, stack, RLS, onboarding app.

**Backup if floor device fails:** `#/floor-day` proves capture landed; `#/reports/day` hourly breakdown still tells the capture story.

---

# G. APPENDIX (from the current deck)

Keep as a **technical / RBC appendix**, not the buyer main deck. Rebuild; do not copypaste Calibri slides.

| Appendix | Source slides | Audience | Notes |
|---|---|---|---|
| A. Department kinds & roles | 7, 8, 9 | Implementers, IE | Origin / standard / terminal; production / outsource / store; loading vs produce |
| B. Native cutting detail | 11 | Cutting room leads | Lay → bundles; multi-fabric components; recurring origin |
| C. Capture catalogue | 10, 23 | Floor champions | Hourly / QC / batch / cutting — real screenshots, one per slide |
| D. Onboarding & entitlements | 15, 16 | RBC only | Create factory → entitlements → first admin → handoff |
| E. Data hierarchy | 35 | IT / security review | Platform → factory → departments → resources → users → capture |
| F. Security | 36 | IT | Auth, RLS, hashed PINs, service-role isolation, “UI guards are not the control” |
| G. Stack | 37 | IT | Vite 6, React 19, TanStack Query, Zustand, Supabase, Edge Functions, PWA/offline floor |
| H. KPI definitions | 38 | Production / IE | Efficiency formula, DHU, FPY, dispute rate, Order→Cut, WIP identity. Label each as **IMPLEMENTED** where reports already show them |
| I. Three applications | 15 | Mixed | One diagram; no need for a buyer-facing deep dive |

**Main-deck leftovers to drop, not appendix:** dividers (6, 14, 21, 24, 28, 33), capability icon grid (4), duplicate web control-room list (17), invented dashboard KPIs (32 as-is).

---

# H. MISSING / UNCERTAIN INFORMATION

Explicit gaps. Do not paper over these in the PPT.

| Item | Why it matters | Status |
|---|---|---|
| Floor UI screenshots | Slides 08–10 need them; `plapps` is a different repo | **UNKNOWN** until a capture session. Do not mock. |
| Onboarding app screenshots | Appendix D | **UNKNOWN** in this repo |
| Live demo factory + style | Journey copy uses a placeholder Oxford shirt | Need a real style name, buyer, route, and non-confidential qtys |
| Brand fonts / logo files | Base deck is Office Calibri | Confirm RBC/Prodigi type and colour tokens with `DESIGN_AGENT.md` / brand kit before build |
| Floor login exact UX | Docs conflict: architecture doc still says employee ID; July pivot says user list or email + PIN | Verify against current `plapps` before writing login copy |
| “4-week implementation” | Close slide in base deck | **UNKNOWN** commercially. Omit until sales confirms |
| Named customer results | Value slide | None in repo. No % claims |
| Audit on the floor | Entitlement exists | **PARTIAL**. Depth of AQL UX in current `plapps` not verified here |
| Batch and cutting UX quality | Apps exist in the contract | Verified as productised IDs, not visually reviewed |
| Balance-cap UX copy | RPC rejects over-receive / over-count | How loudly the floor UI explains the cap is **UNKNOWN** |
| Offline behaviour of floor | Dexie queue documented for plapps | Do not claim “works fully offline” without a current plapps check |
| Superadmin factory switcher | Documented as future | **PLANNED** |
| Whether planning Gantt supports true drag-create | Drag *selection* exists in planning state; factory Gantt is primarily a view | Copy must stay: allocate in the planning board |
| Photo rights for slide 01 factory imagery | Need licensed or RBC-owned floor photography | **UNKNOWN** |
| Viewer role in customer narrative | Shipped in this repo | Confirm whether to mention in slide 16 “already” vs keep silent |

---

# QUALITY TEST (pre-build)

| Test | Result in this structure |
|---|---|
| Understand what Prodigi is within 3 slides? | Yes — gap (02), broken numbers (03), production layer (04) |
| Understand why it is needed within 5 slides? | Yes — 01–05 |
| Understand how an order moves? | Yes — 06, then 07–11 zoom |
| See why handover / WIP matters? | Yes — 10, prepared by 03 and 05 |
| See how production becomes management insight? | Yes — 12–13 |
| Every important claim from the actual product? | Yes, with tags; fake dashboard KPIs and 4-week go-live removed |
| Feels like a product, not a software project? | Yes if screenshots are real and stack stays in appendix |

If slide 06 is built as another icon row, the deck fails. If slide 13 shows invented OTIF %, the deck fails. If slide 09 shows four equal fake phones, the deck fails.

---

# BUILD GATE

**Stop here.** Next step after approval:

1. Confirm demo style + screenshot session (web + floor).
2. Confirm brand fonts and whether the close slide may name an implementation window.
3. Rebuild `docs/Prodigi_Master_Deck.pptx` as a 16-slide main deck + appendix, using ppt-mcp, preserving useful base-deck language where it still matches this document.

No PowerPoint has been generated in this phase.
