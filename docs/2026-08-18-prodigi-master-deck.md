# Prodigi Master Deck — Slide Bible

**Date:** 18 August 2026  
**Status:** Master content for a 56-slide product deck. Built from the live PRODIGI admin SPA plus floor contracts in this repo.  
**Audience of this file:** Anyone building, cutting, or presenting a Prodigi deck.  
**Output target:** Rebuild `docs/Prodigi_Master_Deck.pptx` from this file (ppt-mcp). Do not regenerate the 23-slide python-pptx client deck.

---

## Why this file exists

Older presentation sources conflict. Use this one.

| Source | Date | Role now |
|---|---|---|
| `docs/prodigi-presentation-strategy.md` | 13 Aug 2026 | Best *story*. 17-slide buyer cut. Keep the narrative. |
| `docs/Prodigi_Product_Presentation.pptx` | 13 Aug 2026 | Latest *buyer* PPT. Too short for a master. |
| `PRODUCT_PRESENTATION_MASTER.md` | 4–6 Aug 2026 | Product encyclopedia. Deep, partly stale (`viewer` still “roadmap”; Employee-ID floor login). |
| `PRODIGI_SLIDES_CONTENT.md` + `PRODIGI_Client_Presentation.pptx` | 4–6 Aug 2026 | Feature tour. Do not reuse sequence or CTA. |
| `docs/Prodigi_Master_Deck.pptx` | 4 Aug 2026 | 41-slide base. Strong ideas, weak story, fake dashboard %. |

This master keeps the 13 Aug story, expands it into a full product walk using **what the code actually ships**, and marks every claim.

---

## Honesty tags

| Tag | Meaning |
|---|---|
| **LIVE** | In the admin SPA and/or documented floor capture contract, with a route or table |
| **FLOOR** | Floor PWA (`plapps`, separate repo). Contract verified here; UI not in this repo |
| **PARTIAL** | Schema / entitlement / one surface exists; do not present as a complete console |
| **PLANNED** | Roadmap. Future slide only |
| **NEVER** | Out of scope. Do not put on any slide as a Prodigi capability |

Unknown items are omitted, not guessed.

---

## What we refuse to say

- Percentage gains (efficiency, WIP, productivity) with no factory evidence
- Dashboard hero KPIs that are not on `#/dashboard`
- Factory-level OTIF % as a dashboard card (OTIF is Yes/No on the **style report**)
- Audit as a shipped desktop module
- Buyer portal, vendor portal, IoT, AI copilot as current product
- “4-week implementation” unless sales confirms
- Floor login as Factory ID + Employee ID + PIN (removed July 2026)
- Floor as a Next.js app (floor is `plapps` PWA; this repo is Vite 6 + React 19)
- Pages that do not exist in the sidebar: WIP Board, Active Audits, Cut Plan, Quality report, Outhouse report
- Costing, BOM consumption, payroll, ERP finance, PLM tech packs

---

## How to cut this 56-slide master

| Cut | Slides | Duration |
|---|---|---|
| **Buyer / owner** | 01–09, 18, 23–26, 31, 33, 39–42, 51, 56 | ~18 min |
| **Sales + live demo** | 01–09, 18–28, 31–43, 51, 56 | ~35 min + demo |
| **Implementation workshop** | Full deck; skip 52–55 only if time-boxed | half day |
| **IT / security review** | 06–07, 17, 34, 44–48, 50, 55 | ~25 min |
| **Investor** | 01–09, 18, 31, 39, 49–51, 56 | ~15 min |

Never present the full 56 to a factory owner in one sitting.

---

## Shipped product map (verified 18 Aug 2026)

**Three apps, one Supabase project**

| App | Who | Login | Status |
|---|---|---|---|
| Onboarding (separate repo) | RBC superadmin | Email + password | **PARTIAL** in this repo (SQL + docs). Customer never sees it |
| Prodigi Web (this repo) | Admin, viewer | Email + password | **LIVE** |
| Prodigi Floor (`plapps`) | Operator, supervisor, auditor, quality_manager | Factory code → user list → PIN, or email + PIN | **FLOOR** |

**Desktop roles:** `admin` / `superadmin` (write) · `viewer` (read-only, **LIVE** as of `20260810200000_profiles_viewer_role.sql`)

**Sidebar (do not invent items)**

- Dashboard
- Production: Create Order · Status Tracker · Floor Day Board · Order Completion
- Planning: Planning Board · Dept. Schedule · Transaction Report
- Reports: Day Report · Style Report
- Config: Work Centers · User Management · Settings

**Dashboard cards that actually exist:** Today output · Period output · Efficiency · Floor WIP · Active orders · Order → Ship %. Charts: factory output trend, efficiency trend. List: orders with balance to ship.

**Style-report fulfillment that actually exists:** Order → Cut % · Order → Ship % · Cut → Ship % · On time (Yes/No) · In full (Yes/No) · On time in full (Yes/No) · Last shipment date.

**The MES engine (three rules)**

1. Output XOR QC — one capture mode per department+order. Never both at once.
2. Handover is mandatory — pieces cannot appear in department N+1 without a challan from N. Outsource uses two legs.
3. Audit is optional — AQL does not block flow unless configured as a gate. **PARTIAL.**

---

# SLIDE LIST

| # | Headline | Function |
|---|---|---|
| 01 | Plan the making. Capture the making. Know the making. | Title |
| 02 | The factory knows the plan. It cannot see the making. | Problem |
| 03 | The systems exist. Production is still disconnected. | Gap |
| 04 | Planned, produced and shipped are three different numbers. | Consequence |
| 05 | Prodigi is the production layer for the garment factory. | Introduce |
| 06 | Prodigi is not ERP, PLM, or costing. | Boundary |
| 07 | Three applications. One production spine. | Architecture |
| 08 | Configure → Plan → Capture → Handover → Report. | Loop |
| 09 | Production can be trusted because three rules are in the system. | Engine |
| 10 | Every factory has a different department chain. Prodigi does not assume one. | Config open |
| 11 | Departments have a kind: origin, standard, or terminal. | Taxonomy |
| 12 | Standard work is production, store, or outsource. | Modes |
| 13 | Capture matches the operation, not a generic counter. | Capture map |
| 14 | Loading is intake. Produce is the count that matters. | Steps |
| 15 | A process flow is a reusable path. The order freezes its own copy. | Flows |
| 16 | Shifts, buyers, and catalogs are factory-owned. | Masters |
| 17 | Each factory only gets the floor apps it is entitled to. | Entitlements |
| 18 | Follow one order through the factory. | Hero |
| 19 | The order is the spine: style, sizes, dates, buyer. | Create |
| 20 | Colorways are size-true. Planning never starts from a round number. | Colorways |
| 21 | Shipment dates live on the order, not in a side spreadsheet. | Ship plan |
| 22 | Routing is frozen onto the order. | Route |
| 23 | The plan becomes work on a line, on dates, with a target. | Plan |
| 24 | Factory load is the same allocations, seen across departments. | Gantt |
| 25 | The floor sees only the work assigned to it. | Floor home |
| 26 | Hourly capture is how sewing actually counts. | Hourly |
| 27 | QC is piece-wise. It is not a second output counter running at the same time. | QC |
| 28 | Cutting is the origin: lay, fabric, size-wise cut qty, bundles. | Cutting |
| 29 | Batch capture is for operations that do not run by the hour. | Batch |
| 30 | Efficiency is nothing without people on the floor. | Workforce |
| 31 | Every movement of WIP leaves a digital challan. | Handover |
| 32 | Send, receive, dispute, close. Missing pieces become records. | States |
| 33 | Outsourced work never leaves the order. | Outsource |
| 34 | The next department cannot invent pieces. | Integrity |
| 35 | Status tracker answers: where is each order in the pipeline? | Tracker |
| 36 | Floor day board answers: what moved today? | Floor day |
| 37 | Style details answer: this order, size by size, department by department. | Style drill |
| 38 | Order completion answers: cut, shipped, rejected, close. | Completion |
| 39 | The dashboard is a factory glance, not a fake scoreboard. | Dashboard |
| 40 | Day report: how did departments perform in this window? | Day |
| 41 | Style report: how did this order travel, produce, and fulfill? | Style |
| 42 | Fulfillment is measured on the order. On-time in-full is Yes or No. | OTIF |
| 43 | Transaction report is the WIP audit trail. | Transactions |
| 44 | A viewer can see the factory without changing it. | Viewer |
| 45 | Users get operations, not a pile of app checkboxes. | Users |
| 46 | Who uses what. | Roles |
| 47 | Desktop is email. Floor is PIN. Nobody self-registers. | Access |
| 48 | The database enforces the factory boundary. The UI is not the lock. | Security |
| 49 | What Prodigi will not become. | Out of scope |
| 50 | What is already live vs what is next. | Roadmap |
| 51 | What each role actually gains. | Value |
| 52 | Department kinds — implementer depth. | Appendix A |
| 53 | Capture catalogue — implementer depth. | Appendix B |
| 54 | KPI definitions — only formulas the product uses. | Appendix C |
| 55 | Stack — IT appendix only. | Appendix D |
| 56 | The operating system for garment production. | Close |

---

# SLIDE-BY-SLIDE

Visual system for the rebuild: 16:9; one headline insight per slide; one accent; industrial paper, not glassmorphism; product screens are real crops with 1–2 callouts; never invent percentages; never go below 16 pt.

Illustrative journey used in copy (replace with a real demo style before filming screenshots):

**Men’s Oxford shirt** · Cutting → Printing (outsource) → Sewing → Finishing → Packing → Shipment.

---

## 01 — Title

**Headline.** Plan the making. Capture the making. Know the making.

**Sub.** Prodigi · Manufacturing Execution System for garment factories  
Built by RBC (Rajesh Bheda Consulting)

**Spoken.** One place to plan production and track what actually happens on the floor.

**Visual.** Dark, quiet, photographic. Tagline in large type. No screenshot.

**Status.** Frame.

---

## 02 — The factory knows the plan. It cannot see the making.

**Sub.** Orders are clear. Execution is not.

**Message.** The pain is visibility of *execution*, not absence of planning.

**Body.**
- The order book is known.
- On the floor it becomes notebooks, WhatsApp photos, and end-of-day Excel.
- By the time the number is compiled, the shift is over.

**Questions on slide (not product UI):**
- What was actually produced yesterday?
- Where is the WIP?
- What left, and what came back?
- Will this order ship on time?

**Do not show.** A product screenshot. This is the world before Prodigi.

**Status.** Story.

---

## 03 — The systems exist. Production is still disconnected.

**Sub.** ERP owns the money. PLM owns development. The floor owns spreadsheets.

**Message.** The gap is structural. Keep this — it is the strongest idea in the original deck.

**Body.**
- ERP: orders, finance, payroll, materials.
- PLM: tech packs and BOM.
- Neither is built to run Cutting → Print → Sew → Finish → Pack, hour by hour, size by size, with a challan between every step.

**Do not say.** “We replace ERP.” Prodigi feeds ERP. It does not own money.

**Status.** Story. Inherited from `Prodigi_Master_Deck.pptx` slide 2.

---

## 04 — Planned, produced and shipped are three different numbers.

**Message.** That mismatch is why management meetings argue about whose Excel is right.

**Three columns.**

| Planned | Produced | Shipped |
|---|---|---|
| Order qty, sizes, dates | Hourly / QC / cut / batch actuals | What left the gate |
| Lives in ERP or a planner sheet | Lives in notebooks | Lives in a packing list |

**Close line.** Until these three sit on one spine, OTIF is a story, not a measurement.

**Status.** Story. Product later proves this with Order → Cut / Order → Ship / Cut → Ship on the style report (**LIVE**, `lib/fulfillmentMetrics.ts`).

---

## 05 — Prodigi is the production layer for the garment factory.

**One sentence.** The factory already knows what it has to make. Prodigi is how it knows what was actually made, where it is, and whether it will ship.

**Three beats.**
1. **Plan the making** — order, route, line, dates, target.
2. **Capture the making** — the way the operation actually works.
3. **Know the making** — same-day department and order insight, from the same data.

**Do not pack.** DHU, OTIF, and a module grid on this slide.

**Screenshot.** None yet. Product appears from slide 18.

**Status.** **LIVE** as positioning. Confirmed by admin SPA + floor contract.

---

## 06 — Prodigi is not ERP, PLM, or costing.

**Message.** Scope is a feature. Factories have been burned by platforms that promised everything.

**On the slide — Prodigi owns:**
- Production plan vs actual
- Department flow, including outsource
- WIP movement (mandatory handover)
- Same-day operational reports

**Off the slide / small type — Prodigi does not own:**
- BOM / fabric consumption / trim inventory
- Costing, CMT, quoting
- Payroll and incentives (export hooks only)
- ERP purchase → invoice → payment
- PLM / sample management beyond the style master

**Status.** **NEVER** for the right-hand list. `AGENTS.md` hard scope.

---

## 07 — Three applications. One production spine.

**Layout.** Three columns, customer language, no “one Supabase project” on this slide.

| | Onboarding | Prodigi Web | Prodigi Floor |
|---|---|---|---|
| Who | RBC | Factory admin, viewer | Operators, supervisors, QA |
| Job | Create the factory, set entitlements, first admin | Configure, order, plan, monitor, report | Capture, handover, workforce, ship |
| Login | Email + password | Email + password | Factory code → name → PIN, or email + PIN |
| Customer sees it? | No | Yes | Yes |

**Foot.** Shared backend. Each factory’s data is isolated.

**Do not say.** Employee ID login. Next.js floor. Self-service signup.

**Status.** Web **LIVE**. Floor **FLOOR**. Onboarding **PARTIAL** (documented; not in this repo’s UI).

**Evidence.** `docs/PLATFORM_ARCHITECTURE.md`, `docs/PLAPPS_MOBILE_AGENT_PIVOT.md`, `lib/routeAccess.ts`.

---

## 08 — Configure → Plan → Capture → Handover → Report.

**Message.** This loop is the product. Reports feed the next plan. That is why it is a system, not a toolkit.

```
CONFIGURE          PLAN                 CAPTURE              HANDOVER           REPORT
departments        order + routing      hourly / QC /        digital challan    day · style
flows · shifts     line × date          batch / cutting      send → receive     dashboard
users              SAM + targets        + workforce          dispute → close    fulfillment
```

**Screenshot.** None. Diagram only.

**Status.** **LIVE.** Every box has a shipped surface (floor for capture/handover send).

---

## 09 — Production can be trusted because three rules are in the system.

**The rules (factory language, then one line of why).**

1. **One capture at a time.** A department working an order is either counting output or inspecting QC. Never both. So produced qty and quality qty are not double-counted.
2. **Nothing moves without a challan.** Pieces cannot appear in the next department unless this one handed them over. Outsourced steps use out-challan and return-challan.
3. **Audit does not block the line** unless the factory configures it as a gate. Sampling is optional.

**Do not** make audit a twin pillar. It is **PARTIAL** (entitlement `audit`; floor app; no desktop audit console).

**Status.** 1–2 **LIVE**. 3 **PARTIAL**.

---

## 10 — Every factory has a different department chain. Prodigi does not assume one.

**Message.** Software that hard-codes Cutting → Sewing → Finish cannot fit printing, washing, embroidery, or a store hold.

**What admin configures first** (`#/work-centers`):
- Departments (work centers) and their operations catalog
- Process-flow templates
- Shifts and hour blocks
- Buyers and size groups

**Screenshot.** Work Centers landing / departments list. Route `#/work-centers/departments`.

**Status.** **LIVE.** `pages/system/WorkCenter*.tsx`.

---

## 11 — Departments have a kind: origin, standard, or terminal.

**Three cards.**

| Kind | Role in the order | Typical capture |
|---|---|---|
| **Origin** | Pieces enter the factory | Native cutting lay report |
| **Standard** | Work happens (or waits, or goes out) | Hourly, QC, batch, or handover-only |
| **Terminal** | Pieces leave | Shipment log, rejection, buyer audit |

**Line.** Origin and terminal are first-class — not flags on “sewing”.

**Do not** lecture loading vs produce here. That is slide 14.

**Status.** **LIVE.** Department `role` in the editor.

---

## 12 — Standard work is production, store, or outsource.

**Three modes on a standard department.**

| Mode | What happens | Capture |
|---|---|---|
| **Production** | The department makes or inspects | Hourly / QC / batch |
| **Store** | Passive hold | Handover only |
| **Outsource** | Vendor visit | Two-leg handover; no fake in-house counter |

**Status.** **LIVE.** `planning_mode` / `step_type` on operations and routing.

---

## 13 — Capture matches the operation, not a generic counter.

**Map (from `lib/floorApps.ts` — labels the factory sees).**

| Capture | When it is used | Where it runs |
|---|---|---|
| Hourly | Sewing, finishing, packing — size-wise per shift hour | **FLOOR** |
| QC Log | Piece-wise pass / fail / rework + defect codes | **FLOOR** |
| Batch | Washing, curing, ovens — one count per batch | **FLOOR** |
| Lay report | Origin cutting | **FLOOR** |
| Shipment / QA | Terminal ship, reject, buyer audit | **FLOOR** (+ desktop ship/reject for admin) |
| Transaction | Handover challan (almost every non-terminal dept) | **FLOOR** |
| Supervisory | Workforce + style performance | **FLOOR** |
| Audit | Optional AQL | **FLOOR** · **PARTIAL** |

**Line.** The factory does not force washing to pretend it is sewing.

**Status.** As tagged. Desktop monitors at `#/floor-day`; capture RPC `floor_capture`.

---

## 14 — Loading is intake. Produce is the count that matters.

**Message.** A department can receive work (loading) and then produce. Loading is optional. Produce is the output used for handover WIP.

**On slide.**
- **Loading** → Hourly input (what came onto the line)
- **Produce** → Hourly, QC, or batch (what was made)
- Handover WIP pool follows **primary output** on the route, not a catalog guess

**Audience.** Implementers and IE. Skip in a short buyer cut.

**Status.** **LIVE.** `step_type`: `loading` | `produce` | `store` | `outsource`. `docs/CAPTURE_CONTRACT.md`.

---

## 15 — A process flow is a reusable path. The order freezes its own copy.

**Message.** Templates are for setup. History is not rewritten when the template changes.

**Body.**
- Admin builds flows: e.g. Cut → Print (out) → Sew → Wash (out) → Finish → Pack → Ship
- On the order, that path is copied into `order_routing_steps` (operation name, step type, capture app frozen)
- Recurring origin or a second outsource leg is allowed because the chain is per order

**Screenshot.** Process flow editor `#/work-centers/process-flows` and routing on `#/planning-detail/:id`.

**Status.** **LIVE.** RPC `save_process_flow`, `save_order_routing`.

---

## 16 — Shifts, buyers, and catalogs are factory-owned.

**Work Centers + Settings, not a vendor spreadsheet.**

| Master | Route | What it unlocks |
|---|---|---|
| Buyers | `#/work-centers/buyers` | Order header, filters, reports |
| Shifts + hour blocks | Work Centers / Settings | Hourly grid columns, planning days |
| Size groups | Buyer / order | Colorway size grid |
| Support dropdowns | `#/settings` | Garment type, season, ship mode, destination, currency, packing rule, rejection audit type |

**Factory profile (Settings → Factory):** name, timezone, default shift, entitlement view.

**Status.** **LIVE.** `pages/Settings.tsx`, `lib/supportDropdownCatalog.ts`.

---

## 17 — Each factory only gets the floor apps it is entitled to.

**Message.** Tablets should not show apps the plant is not licensed to run.

**Entitlement buckets on `factories` (set at onboarding):**
- Transaction
- Production: hourly, QC, batch
- Workforce: supervisor
- Audit
- Shipment: shipment log, rejection log, shipment audit

**User Management** only lists apps that are both department-enabled and factory-entitled.

**Do not** show raw JSONB column names on a buyer slide. Keep this for RBC / IT.

**Status.** **LIVE.** `lib/factoryEntitlements.ts`, `docs/FACTORY_APP_ENTITLEMENTS.md`.

---

## 18 — Follow one order through the factory.

**This is the hero device. Do not present modules from here. Present one style.**

**Journey (copy + demo):**

```
CREATE ORDER          #/create-order
APPLY ROUTING         #/planning-detail/:id
ALLOCATE LINES        same page, planning table
FLOOR SEES PLAN       plapps home (one card per allocation)
CUT                   plapps cutting_lay
HANDOVER              plapps send
OUTSOURCE             out-challan → return-challan
SEW / QC / BATCH      plapps hourly | qc_log | batch
HANDOVER              send → receive / dispute
PACK / SHIP           terminal shipment
MANAGEMENT SEES       day · style · dashboard · completion
```

**On-slide questions (one each):**

| Stage | Question |
|---|---|
| Order | What was ordered, in which sizes, by when? |
| Plan | Which line, which dates, what target? |
| Floor | What is this person supposed to run today? |
| Cut | What was actually cut? |
| Outsource | What left / what returned? |
| Sew | What was produced, by whom? |
| Handover | What left this department? |
| Report | Will it ship? |

**Visual.** Horizontal spine. Not an icon grid.

**Status.** **LIVE** path. Floor steps **FLOOR**.

---

## 19 — The order is the spine: style, sizes, dates, buyer.

**Route.** `#/create-order` · `#/create-order/:id`  
**RPC.** `save_style_order`

**Fields that matter on the slide (from `OrderHeaderSection.tsx`):**
- Style name, style ref, PO, buyer
- Size group, product type, season, merchant
- Order received date, job card date
- Priority: Normal / High / Critical
- Cutting allowance %
- Sewing SAM (reference — planning SAM can differ per allocation)
- Order type: new / repeat

**Line.** Everything else in Prodigi hangs off this record. There is no second “real” qty in a side sheet.

**Screenshot.** Order header, not the whole form.

**Status.** **LIVE.**

---

## 20 — Colorways are size-true. Planning never starts from a round number.

**Message.** “5,000 pcs” is not a plan. XS–XXL by color is a plan.

**Body.**
- Each colorway has a size grid
- Adjusted qty (with cutting allowance) is what cutting and planning consume
- Reports and handovers stay size-wise

**Screenshot.** Colorway workspace on create-order.

**Status.** **LIVE.** `colorways`, `colorway_sizes`.

---

## 21 — Shipment dates live on the order, not in a side spreadsheet.

**Body.**
- Shipment plan on the order: quantities, dates, type (Main / Partial / Replacement / Sample / Rejection return), mode, destination
- Dashboard and style-report “on time” use these dates
- Multiple shipments are first-class (partials exist)

**Screenshot.** Shipment plan section.

**Status.** **LIVE.** `shipment_plan` JSONB, `lib/orderShipmentPlan.ts`.

---

## 22 — Routing is frozen onto the order.

**Route.** `#/planning-detail/:id` · `OrderRoutingEditor`

**Body.**
- Pick a process-flow template, then freeze
- This Oxford: Cutting → Printing (outsource) → Sewing → Finishing → Packing → Shipment
- Changing the template later does not rewrite this order’s history

**Screenshot.** Route chips / step list on planning detail.

**Status.** **LIVE.**

---

## 23 — The plan becomes work on a line, on dates, with a target.

**Route.** `#/line-assignment` → `#/planning-detail/:id`  
**RPC.** `save_line_plan`

**What the planner sets:**
- Resource / line
- Date range
- Daily target
- SAM
- Workforce inputs for efficiency

**Copy rule.** Allocate on the **planning board**. Do **not** say “drag allocations onto the Gantt” — that overstates the UX. Factory Gantt is a load view.

**Screenshot.** Planning table for one colorway.

**Status.** **LIVE.** `line_allocations`.

---

## 24 — Factory load is the same allocations, seen across departments.

**Route.** `#/dept-schedule`

**Message.** The Gantt is not a second planning system. It is the same plan, laid across the factory.

**Body.**
- Bars are allocations
- Actuals overlay where capture has landed
- Use it to see collisions and idle lines — then go back to the planning board to change work

**Screenshot.** Department schedule, highlight the demo order.

**Status.** **LIVE.** Read view.

---

## 25 — The floor sees only the work assigned to it.

**Surface.** `plapps` home.

**Message.** The operator does not hunt the ERP. They open today’s work.

**How tiles are built (canonical, July 2026):**
- Production tiles from `floor_user_access` × operation `capture_app`
- Handover / Supervisory / Audit from flags on those rows
- Supervisor-only users: no production tiles; handover + workforce
- One card per **line allocation** (visit × color × line), not one card per order

**Login (say this, not the old formula):** PIN on the floor. Pick factory, tap your name, enter PIN — or email + PIN.

**Screenshot.** Floor home for the sewing operator on the Oxford allocation. **FLOOR** — needs a real device capture.

**Status.** **FLOOR.** `docs/PLAPPS_MOBILE_AGENT_PIVOT.md`. Employee ID **removed**.

---

## 26 — Hourly capture is how sewing actually counts.

**Capture app.** `hourly`

**Body.**
- Size-wise qty in the current shift hour slot
- Tied to the line allocation and daily target
- Balance cap: cannot post more than the department is allowed to have
- Three taps from home: resource → style card → hour cell

**Screenshot.** Hour grid. One hero crop. Not four phones.

**Desktop proof if device fails.** `#/reports/day` hourly breakdown; `#/floor-day`.

**Status.** **FLOOR** capture, **LIVE** reporting.

---

## 27 — QC is piece-wise. It is not a second output counter running at the same time.

**Capture app.** `qc_log`

**Body.**
- Pass / fail / rework + defect codes
- Feeds DHU and pass % on the **day report** and **style report**
- Output XOR QC: if this department+order is in QC, hourly output is not running

**Do not** show a desktop “Quality module”. There isn’t one. QC lives on the floor and in reports.

**Status.** **FLOOR** + **LIVE** on DayDeptCard (`Pass %`, `DHU`).

---

## 28 — Cutting is the origin: lay, fabric, size-wise cut qty, bundles.

**Capture app.** `cutting_lay`

**Body.**
- Lay report is the source of truth for what entered the factory
- Fabric components (shell / lining) are cutting identity — **not** a BOM costing engine
- Size-wise cut qty feeds Order → Cut on the style report
- Bundles are an outcome of lay capture, not a separate licensed app in the current model

**Screenshot.** Lay capture **FLOOR**. Gantt can show fabric actuals on desktop.

**Status.** **FLOOR** / **LIVE** read-side. Do not call this PLM.

---

## 29 — Batch capture is for operations that do not run by the hour.

**Capture app.** `batch`

**Body.**
- One produced qty per batch (wash load, curing lot)
- Still on the same order route and still handed over
- Workforce can sit on the batch session

**Do not** give batch a solo buyer slide unless the demo factory is wash-led. In the Oxford story it is a callout: “If this were washing, the count would be a batch, not an hour.”

**Status.** **FLOOR.** No desktop batch form.

---

## 30 — Efficiency is nothing without people on the floor.

**Message.** The original deck’s gold line: no workforce, no efficiency.

**Formula the product uses:**  
`(output × SAM) ÷ (headcount × minutes)`  
If available minutes are zero, efficiency shows as **—**, not 0% theatre.

**Where it appears:**
- Dashboard Efficiency card (period, output vs plan / produced vs available mins)
- Day report department card
- Style report department analysis

**Who logs it.** Supervisor app on the floor (`supervisor`). Operators may embed headcount on hourly/QC if `can_log_workforce`.

**Status.** **LIVE** reporting. **FLOOR** capture.

---

## 31 — Every movement of WIP leaves a digital challan.

**Message.** Handover is not a nice-to-have. It is the WIP integrity spine.

**On the challan:**
- From department → to department
- Order, colorway, size-wise qty
- Who sent, when
- Receiver confirms or disputes

**Screenshot.** Floor send **or** `#/planning/transaction-report` row.

**Status.** **LIVE.** Table `handover_slips`.

---

## 32 — Send, receive, dispute, close. Missing pieces become records.

**States (DB → what the UI says):**

| Database | Screen |
|---|---|
| `pending` | In transit |
| `received` | Received |
| `disputed` | Disputed |
| `received_disputed` | Received disputed |

**Body.**
- Gap = sent minus received, once the slip is closed
- Disputes are closed with owner + remark — not deleted
- “Where did 40 pcs go?” is a row, not a meeting

**Screenshot.** Transaction report with a disputed row. `HandoverStatusBadge`.

**Status.** **LIVE.** `lib/handoverStatus.ts`.

---

## 33 — Outsourced work never leaves the order.

**Message.** Printing, washing, embroidery must not become a black hole at the gate.

**Body.**
- Route step `outsource` / planning mode outsource
- Leg 1: out-challan to vendor
- Leg 2: return-challan back into the factory
- Pieces stay on the Oxford’s spine the whole time
- There is **no vendor portal** (**PLANNED**)

**Screenshot.** Flow with an outsource visit + two challans on the transaction report or style journey.

**Status.** **LIVE** in routing + handover. Portal **PLANNED**.

---

## 34 — The next department cannot invent pieces.

**Five integrity rules (factory language):**

1. Output XOR QC on the same department+order
2. No WIP in N+1 without handover from N
3. Routing frozen on the order
4. Efficiency requires workforce minutes
5. Capture RPCs cap qty against what the department may hold — over-receive / over-count is rejected

**Do not** slogan “balance-capped entry” as if it were a button on screen. It is server-side.

**UI guards are convenience.** RLS and RPCs are the control (slide 48).

**Status.** **LIVE** for 1–5 in engine/RPCs. Audit gate **PARTIAL**.

---

## 35 — Status tracker answers: where is each order in the pipeline?

**Route.** `#/status-tracker`

**Body.**
- Order list with buyer, priority, delivery
- Visit cells along the frozen route (not a fake generic pipeline)
- Store visits do not pretend to be production
- Drill into style details

**Screenshot.** One page of the tracker, Oxford row expanded.

**Status.** **LIVE.** `pages/production/StatusTracker.tsx`.

---

## 36 — Floor day board answers: what moved today?

**Route.** `#/floor-day`

**Body.**
- By department: received, produced (per operation), sent
- Date range, not only “this instant”
- Proof that floor capture landed, if the tablet cannot be demoed

**Screenshot.** Floor day board, sewing + cutting columns.

**Status.** **LIVE.** `pages/production/FloorDayBoard.tsx`.

---

## 37 — Style details answer: this order, size by size, department by department.

**Routes.** `#/style-details/:id` · `#/style-color-details/:id/:colorId`

**Body.**
- One order, all colorways
- Size × department progress
- Path into planning and reports for the same id

**Status.** **LIVE.**

---

## 38 — Order completion answers: cut, shipped, rejected, close.

**Route.** `#/production/order-completion`

**Body.**
- Ongoing vs completed filter
- Cut vs shipped vs rejected
- Close colorways when the work is actually done
- This is the owner question: what still has to ship

**Screenshot.** Completion workspace for the Oxford.

**Status.** **LIVE.**

---

## 39 — The dashboard is a factory glance, not a fake scoreboard.

**Route.** `#/dashboard`

**Cards (only these):**

| Card | Meaning |
|---|---|
| Today output | All departments, today |
| Period output | vs period target |
| Efficiency | Output vs plan / produced mins vs available mins |
| Floor WIP | Pieces on floor (latest day in the KPI set) |
| Active orders | In production |
| Order → Ship % | Shipped / order qty in the filtered set |

**Also on the page:** output trend chart, efficiency trend chart, attention list of orders with balance to ship (exportable CSV).

**Filters.** Date range, buyer, search.

**Forbidden.** 82% / 94% / 88%. Factory OTIF % tile. DHU tile. Invented “Active Audits”.

**Status.** **LIVE.** `pages/Dashboard.tsx`.

---

## 40 — Day report: how did departments perform in this window?

**Route.** `#/reports/day`

**Department card KPIs (from `DayDeptCard.tsx`):**
- Output
- Efficiency
- Pass % (when QC exists)
- DHU (when QC exists)
- Hourly grid vs hourly target
- Handovers in / out
- Native cutting entries when origin

**Question it answers.** “How did sewing do yesterday morning?”

**Status.** **LIVE.** Excel export exists.

---

## 41 — Style report: how did this order travel, produce, and fulfill?

**Route.** `#/reports/style`

**Sections that exist in the page (do not invent more):**
- Order header
- Fulfillment metrics bar
- Journey (not started / in progress / complete per department)
- Production matrix (size × operation)
- Department analysis (output, SAM, efficiency, workforce)
- Daily charts
- Handover table for that order
- Fulfillment / cut-to-ship detail

**Question it answers.** “How is the Oxford, today, as one object?”

**Status.** **LIVE.** `pages/reports/StyleReport.tsx`.

---

## 42 — Fulfillment is measured on the order. On-time in-full is Yes or No.

**From `StyleFulfillmentMetricsBar` + `lib/fulfillmentMetrics.ts`:**

| Metric | Type |
|---|---|
| Order → Cut | % |
| Order → Ship | % |
| Cut → Ship | % |
| On time | Yes / No / — |
| In full | Yes / No / — |
| On time in full | Yes / No / — |
| Last shipment | Date |

**Copy rule.** On-time uses the order’s shipment plan dates. In-full uses shipped vs buyer order qty. Do not roll these into a fake factory OTIF gauge on the dashboard.

**Status.** **LIVE.**

---

## 43 — Transaction report is the WIP audit trail.

**Route.** `#/planning/transaction-report`

**Body.**
- Filter by date, department, status
- Size qty, from/to, sender, receiver
- Dispute cells in place
- This is what you hand a buyer auditor who asks “prove the challan”

**Status.** **LIVE.**

---

## 44 — A viewer can see the factory without changing it.

**Role.** `profiles.user_role = viewer`  
**Shipped.** 10 August 2026 migration `20260810200000_profiles_viewer_role.sql`

**Can open:** dashboard, status tracker, floor day, order completion, reports, planning views, transaction report, style/color details, planning detail (read).

**Cannot open:** create order, work centers, user management, settings. Mutation UIs are gated (`DesktopWriteGate`).

**Who it is for.** Production head, merchant, buyer-side observer inside the factory tenant — without giving them admin.

**Do not** still label viewer as “roadmap”. That is stale in `PRODUCT_PRESENTATION_MASTER.md`.

**Status.** **LIVE.** `lib/routeAccess.ts`.

---

## 45 — Users get operations, not a pile of app checkboxes.

**Route.** `#/user-management`  
**Writes.** Edge Functions `admin-create-user`, `admin-update-user`, `admin-delete-user` (not client table inserts).

**Assignment model:**
- Pick role: Operator (production capture) · Supervisor · Viewer (desktop)
- Operators: one or more catalog operations → capture tiles; optional handover / workforce / audit flags
- Supervisors: scope row, handover + workforce, no production
- Terminal QA: Dispatch / shipment apps
- PIN is 4 digits, stored hashed

**Status.** **LIVE.** `floor_user_access` grain `(profile_id, operation_id)`.

---

## 46 — Who uses what.

| Person | App | They do |
|---|---|---|
| RBC superadmin | Onboarding | Create factory, entitlements, first admin |
| Factory admin | Web | Configure, orders, planning, users, all reports |
| Viewer | Web | Read dashboard, tracker, planning, reports |
| Supervisor | Floor | Handover, workforce, style performance |
| Operator | Floor | Hourly / QC / batch / cutting on assigned operations |
| Auditor / quality_manager | Floor | Audit / QC as granted |
| Terminal clerk | Floor | Shipment, rejection, buyer audit |

**Status.** **LIVE** except onboarding UI **PARTIAL**.

---

## 47 — Desktop is email. Floor is PIN. Nobody self-registers.

**Desktop.** Email + password. Login is sign-in only. No “setup factory” on the product login.

**Floor.**
1. Factory code → list of users → PIN, or
2. Email + PIN  
RPCs: `get_floor_users`, `verify_floor_pin`, `verify_floor_login_by_email`

**Removed.** `verify_floor_login(factory_code, employee_id, pin)` and `profiles.employee_id`.

**Provisioning.** RBC creates factory + first admin with service role. Factory admin creates floor users. Anon cannot insert `factories`.

**Status.** **LIVE.** `docs/FACTORY_ONBOARDING.md`, pivot guide. Onboarding SQL examples that still show `employee_id` or `workforce_log` are **stale** — do not copy them onto slides.

---

## 48 — The database enforces the factory boundary. The UI is not the lock.

**Buyer-trust lines (keep short):**
- Every factory query is scoped by `factory_id`; RLS on tenant tables
- Floor PINs hashed
- User create/update/delete only via Edge Functions
- Route guards hide buttons; they are not security

**IT lines (appendix if needed):**
- Superadmin provisioning uses service role **outside** customer apps
- Service role never on tablets or in the Vite bundle
- Desktop offline = TanStack Query read-cache only (no mutation queue)

**Status.** **LIVE.**

---

## 49 — What Prodigi will not become.

**Stay off the product, on purpose:**
- Costing / CMT / quoting
- Fabric/trim BOM consumption
- Cutting-room CAD / marker optimisation
- Payroll / incentive computation (export only)
- ERP PO → invoice → payment
- PLM / 3D / tech packs beyond style master
- Warehouse inventory system

**Fabric components on a style (shell / lining) stay.** That is cutting identity.

**Status.** **NEVER.**

---

## 50 — What is already live vs what is next.

**Already live (do not put on a “coming soon” slide):**
- Viewer desktop role
- PIN floor login (name list or email)
- Day + style reports, dashboard cards listed in slide 39
- Mandatory handover + dispute
- Outsource as two-leg routing
- Entitlements per factory

**Near-term / honest next (only if still unshipped when presenting):**
- Deeper AQL / audit UX (**PARTIAL** today)
- Vendor / buyer portals (**PLANNED**)
- Multi-factory HQ switcher for a customer group (**PLANNED**)
- Richer offline floor behaviour — do not claim “works fully offline” without a current plapps check

**Not near-term product:** AI copilot, IoT machine signals, predictive OTIF as a shipped module.

**Do not** list “desktop RBAC / viewer” as future.

**Status.** As tagged. Re-verify this slide the week you present.

---

## 51 — What each role actually gains.

No fake time-savings. Operational value only.

| Role | Gain |
|---|---|
| Owner / GM | Planned vs produced vs shipped on one spine; attention list of what still must ship |
| Production manager | Line plan that hydrates the floor; department load; day report |
| Supervisor | Today’s allocations; handover queue; workforce-backed efficiency |
| Operator | Today’s work only; capture that matches the machine/line |
| Quality | QC on the same order as output; DHU the same day |
| IE / planner | SAM and targets tied to actuals |
| Auditor (buyer) | Challan trail, size-wise, disputed or closed — not a reconstructed Excel |

**Status.** Narrative, grounded in **LIVE** surfaces.

---

## 52 — Appendix A: Department kinds (implementer)

Keep out of buyer cuts. Use in workshops.

**Hierarchy:**

```
Work Center (Department)
├── Origin     → Cutting (Lay Report)
├── Standard Production
│     ├── Loading  → Hourly input
│     └── Produce  → Hourly | QC | Batch
├── Store      → Handover only
├── Outsource  → Two-leg handover
└── Terminal   → Shipment / QA

Every non-terminal department also: Transaction (handover) · Audit (optional) · Supervisory
```

**Four layers to answer:**
1. What kind of department?
2. What operation step?
3. How is data captured?
4. Which global capabilities (handover, audit, supervisor)?

**Status.** **LIVE** model.

---

## 53 — Appendix B: Capture catalogue (implementer)

One frame per capture, real screenshots, never a four-up fake phone grid.

| App ID | Label | Desktop proof |
|---|---|---|
| `hourly` | Hourly | Day report hour grid |
| `qc_log` | QC Log | Day/style DHU, pass % |
| `batch` | Batch | Style matrix / day native entries |
| `cutting_lay` | Lay report | Origin cut qty, fabric hint |
| `transaction` | Handover | Transaction report |
| `supervisor` | Supervisory | Efficiency denominator |
| `audit` | Audit | **PARTIAL** |
| `shipment_qa` | Shipment / QA | Order completion, style fulfillment |

**Status.** As tagged.

---

## 54 — Appendix C: KPI definitions (only what the code computes)

| KPI | Definition in product | Where |
|---|---|---|
| Output | Sum of captured produced qty in range | Dashboard, day, style |
| Period target | Sum of daily targets | Dashboard |
| Efficiency | Produced mins / available mins, else avg daily_efficiency_pct; produced mins from output × SAM | Dashboard, day, style |
| Floor WIP | WIP from latest KPI day | Dashboard |
| Active orders | Count in production | Dashboard, status |
| Order → Cut | Origin captured cut / adjusted order qty | Style report |
| Order → Ship | Shipped / buyer order qty | Dashboard aggregate, style |
| Cut → Ship | Shipped / cut | Style report |
| On time | Last shipment vs plan date (boolean) | Style report |
| In full | Shipped vs order qty (boolean) | Style report |
| On time in full | Both | Style report |
| DHU | Defects per hundred units from QC | Day / style dept cards |
| Pass % | QC pass ratio | Day dept card |
| Handover gap | Sent − received on closed slips | Transaction report |

**Do not** draw a KPI funnel the dashboard does not show.

**Status.** **LIVE.**

---

## 55 — Appendix D: Stack (IT only)

**This repo (Prodigi Web):** Vite 6 · React 19 · TypeScript · Tailwind v4 · TanStack Query · Zustand · hash routing · PWA.

**Floor:** separate `plapps` PWA; Dexie offline queue for capture; not in this repository.

**Backend:** Supabase (Postgres + RLS + Realtime + Storage) · Edge Functions for admin user mutations · RPCs for factory writes (`save_style_order`, `save_line_plan`, `floor_capture`, handover, etc.).

**Do not** put this in the buyer narrative. Do not say the floor is Next.js.

**Status.** **LIVE** for this repo.

---

## 56 — Close

**Headline.** The operating system for garment production.

**Sub.** Still not an ERP. Still not a PLM. The layer that owns the making.

**Whisper line.** CONFIGURE · PLAN · CAPTURE · HANDOVER · REPORT

**CTA (product-true):**
- Walk one live order (slides 18–42 as a demo)
- Contact RBC

**Do not** print “4-week go-live” unless commercial process is confirmed.

**Visual.** Dark close. One sentence. No screenshot.

---

# DEMO (8 minutes) — same order throughout

Prep: one style with colorways and a shipment date; route with origin cutting, one outsource visit, sewing hourly, terminal shipment; today’s allocations; at least one handover; workforce logged.

| Time | Beat | Click |
|---|---|---|
| 0:00 | The order | `#/create-order/:id` |
| 0:40 | Path + plan | `#/planning-detail/:id` |
| 1:30 | Load (optional) | `#/dept-schedule` |
| 2:00 | Floor | `plapps` PIN → hourly for that allocation |
| 3:20 | Move WIP | Floor send or `#/planning/transaction-report` |
| 4:20 | Outsource | Style journey or flow with out visit |
| 5:00 | Same day | `#/reports/day` then `#/reports/style` |
| 6:20 | Act | `#/dashboard` → balance to ship → `#/production/order-completion` |
| 7:20 | Trust | Disputed challan or stay on dashboard |

**Skip in 8 minutes:** user management, shift editor, defect catalog, stack, RLS, onboarding app.

**Backup if floor fails:** `#/floor-day` + day-report hourly grid.

---

# SCREENSHOT CHECKLIST

Priority. Real demo factory. Never fabricate UI.

| Slide | Screen | Route / app |
|---|---|---|
| 10–16 | Work centers, flow editor, settings | `#/work-centers*` `#/settings` |
| 19–21 | Create order | `#/create-order/:id` |
| 22–23 | Routing + planning table | `#/planning-detail/:id` |
| 24 | Dept schedule | `#/dept-schedule` |
| 25–30 | Floor home, hourly, QC, cutting, supervisor | `plapps` |
| 31–33 | Handover + transaction | `plapps` + `#/planning/transaction-report` |
| 35–38 | Tracker, floor day, style details, completion | as named |
| 39–42 | Dashboard, day, style | as named |
| 44–45 | Viewer session + user form | `#/user-management` |

**Do not invent:** WIP Board, Active Audits, Cut Plan page, Quality report page, Outhouse report, buyer portal, IoT dashboard.

---

# BUILD NOTES

1. Rebuild as a real PowerPoint via ppt-mcp / COM (`docs/_build_prodigi_deck.py` is the 17-slide buyer generator — extend or replace; do not go back to `scripts/generate_prodigi_presentation.py`).
2. Preserve useful lines from the 13 Aug buyer deck (ERP/PLM gap; three-beat title; loop; follow one order).
3. Re-verify slide 50 the week of presentation.
4. Replace Oxford placeholder with a real non-confidential style before screenshot day.

**Code evidence used for this file (18 Aug 2026):**  
`lib/routeAccess.ts` · `lib/floorApps.ts` · `lib/factoryEntitlements.ts` · `lib/fulfillmentMetrics.ts` · `lib/handoverStatus.ts` · `lib/supportDropdownCatalog.ts` · `components/Layout.tsx` · `pages/Dashboard.tsx` · `pages/reports/{Day,Style}Report.tsx` · `components/reports/{DayDeptCard,StyleFulfillmentMetricsBar}.tsx` · `pages/system/UserManagement.tsx` · `pages/production/{StatusTracker,FloorDayBoard,OrderCompletion,create-order/*}` · `docs/PLAPPS_MOBILE_AGENT_PIVOT.md` · `docs/PLATFORM_ARCHITECTURE.md` · `supabase/migrations/20260810200000_profiles_viewer_role.sql`.
