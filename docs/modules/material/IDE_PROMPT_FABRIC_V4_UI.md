ROLE: Senior frontend engineer on PRODIGI WEB (desktop admin SPA). Database work for Fabric v4 is DONE and live.
Your job is UI only: wire new and changed pages to the v4 RPCs, matching the existing app pixel for pixel.

READ FIRST (in this order):
1. docs/modules/material/MM_FABRIC_V4_DB_CONTRACT.md   ← save the attached contract here first. It is the ONLY source of truth for RPC names, payloads and return shapes.
2. docs/modules/material/FABRIC_MILL_WAREHOUSE_SPLIT_PLAN.md   ← the business model (v3). Save it here if it isn't already.
3. The existing Material module code: every page under the material routes (Fabric Mill, Fabric Warehouse, Material setup, rack ops,
   store challans, style materials) and the shared components they use.

══════════════════════════════════════════════════════════════════════
HARD RULES
══════════════════════════════════════════════════════════════════════
- NO database changes. Do not create migrations, tables, views or functions. If something is missing from the contract, STOP and list it in your report.
  Do not work around it in the client.
- NO direct table writes. Writes only through the RPCs in the contract. Reads: prefer the read RPCs. Only use
  `select` on mm_ tables if a contract read RPC truly doesn't cover it, and say so in the report.
- Desktop WEB SPA only. Do NOT touch PRODIGI FLOOR.
- Old pages keep working until the switch is flipped. Gate every v4 UI on `mm_get_v4_config().data.fabric_v4`
  (or on a route-level flag read once), so we can ship the pages before turning the switch on.
- Every RPC returns `{ok, data}` or `{ok:false, code, message}`. Use the app's EXISTING rpc wrapper / error toast pattern.
  Find it and reuse it; don't write a new one. `CUT_GATE` errors carry a `blocked[]` list that must be shown per roll (see Page 6).

══════════════════════════════════════════════════════════════════════
DESIGN CONSISTENCY — NON-NEGOTIABLE
══════════════════════════════════════════════════════════════════════
The new screens must look like they were always part of the app. Before writing ANY UI:

A. Build a component inventory (Phase 1 deliverable). For each UI element below, find how the existing app already does it
   and record the exact component/file + an example page that uses it:
   page header + breadcrumb · tabs · filter bar · search box · single select / dropdown · multi-select · searchable select
   (style/colorway pickers) · date picker · number input with unit suffix · data table (sorting, sticky header, row selection,
   bulk-action bar, empty state, loading skeleton) · inline-editable grid (the mill roll entry grid is the reference) ·
   modal / drawer / side panel · confirm dialog · toast · status badge / pill / chip colours · stat cards (warehouse landing) ·
   big navigation panels (warehouse Internal/External) · form layout + validation messages · print challan layout.
B. Reuse those components and tokens only. No new UI libraries, no new colour values, no new font sizes, no inline styles
   where the app uses classes/tokens. If two existing patterns differ, follow the one used on the Fabric Warehouse pages.
C. Dropdowns: copy the exact component and behaviour used in Material setup / Fabric Mill (same placeholder style, same
   clear button, same search behaviour, same disabled state). All dropdown options come from `mm_get_v4_config()`
   (stages, facilities by kind, machines filtered by facility, process types, unit_forms, width_forms, grades, machine_kinds).
D. Status badges: map passport and gate statuses onto the app's EXISTING badge variants. Don't invent colours:
   PASS → success · STALE / INCOMPLETE / HOLD → warning · FAILED → danger · NONE → neutral/muted · cut-ready → success.
   Stage chips (GREIGE/RFD/DYED/FINISHED…) use the neutral chip style used for fabric category today.
E. Tables follow the warehouse tables: same column density, number alignment (right), units shown the same way,
   same row-click → detail behaviour.
F. Copy tone: short, plain labels the app already uses ("Send to processing", "Record return", "Save results").
   User-visible errors come from the RPC `message`.
G. Zoom/layout: honour whatever global layout scale the app currently uses. Don't hard-code widths that break at that scale.

══════════════════════════════════════════════════════════════════════
PHASE 0 — Sync the database into the repo (no UI yet)
══════════════════════════════════════════════════════════════════════
1. Pull the remote migrations into the repo:
   `supabase migration fetch --linked` (or `supabase db pull` if that's the repo convention). Confirm these 11 files exist locally:
   mm_v4_feature_key, mm_v4_masters, mm_v4_roll_registry, mm_v4_processing, mm_v4_quality, mm_v4_gate_and_receipt,
   mm_v4_read_api, mm_v4_selftest, mm_v4_fix_roll_alive, mm_v4_fix_cut_blocks, mm_v4_fix_machine_report.
2. Regenerate the Supabase TypeScript types the repo uses. Add typed wrappers for every v4 RPC in the same place the
   existing mm_ RPC wrappers live (same naming style). Types for ROLL_ROW, passport, gate codes, etc. come from the contract.
3. Run `db:audit-schema`, `db:verify-functions` and the existing test suites. All must pass unchanged.

══════════════════════════════════════════════════════════════════════
PHASE 1 — Discovery report (read-only, no code changes)
══════════════════════════════════════════════════════════════════════
Write docs/modules/material/V4_UI_AUDIT.md with:
- The component inventory from section A (component → file → example page).
- The current Material route map and which page/component calls which old RPC (especially the old ones listed in
  contract §9).
- For each page below: which existing page it extends or sits next to, and which components it will reuse.
Stop after Phase 1 and post the audit summary in chat before continuing.

══════════════════════════════════════════════════════════════════════
PHASE 2 — Build (in this order; each step shippable on its own)
══════════════════════════════════════════════════════════════════════
PAGE 1 · Material setup → new sections (config permission)
- Facilities: list grouped by kind (Mills, Processing units, Warehouses, Fabric vendors), In-house/External badge.
  Add/edit with mm_save_facility; processing units get a multi-select of process types.
- Machines: shown under each IN-HOUSE facility only. Add/edit with mm_save_machine, kind dropdown, specs as simple key/value
  fields (knitting: dia, gauge, feeders · loom: reed, width · dyeing: capacity_kg).
- Fabric stages: ordered list, "Can be cut" toggle, add/edit with mm_save_fabric_stage.
- Process rules: extend the existing process-type list with output stage (dropdown), default return (Same rolls / Re-rolled),
  "Retest after" and "Re-inspect after" toggles, machine kinds (multi-select). Saved with mm_save_process_type_rules.
- Test field rules: in the existing per-fabric-type test-field editor, add "Level" (Per roll / Per lot) and
  "Required at stages" (multi-select of stages). Saved with mm_save_test_field_rules.

PAGE 2 · Fabric Mill (extend the existing page)
- Batch list from mm_mill_list_batches_v4. Filter by mill (only if more than one), kind (Style / General), fabric.
  Columns: batch no, kind, mill, fabric, style or intents, rolls at mill / at processing / dispatched, stage mix chips, machines.
- New batch form (mm_mill_save_batch_v4): Style batch / General batch toggle; mill dropdown (default the only in-house mill);
  for general batches, a fabric type plus "Styles under consideration" multi-select (intents); yarn lot / count;
  initial stage (default Greige).
  Roll grid = the existing mill roll grid + Machine (dropdown filtered to this mill's machines), Shift, Roll/Lap, Tubular/Open.
  "Add rolls" on an existing batch → mm_mill_add_rolls_v4.
- Batch detail (mm_mill_get_batch_v4): the roll table shows stage, machine, custody (At mill / At processing / Dispatched),
  style, Test badge, Inspection badge. Bulk actions on selected rolls:
  Send to processing (Page 3 modal) · Test (Page 4 modal, scope = batch or selected rolls) · Inspect (Page 4 grid) ·
  Allocate (existing allocate RPC/modal) · Dispatch to warehouse (existing dispatch modal) · Tag (mm_set_roll_tags).
  Lists process challans and tests for the batch.

PAGE 3 · Processing (NEW page under Material, sibling of Fabric Mill / Fabric Warehouse)
- Landing: tabs Pending / Returned / All (mm_proc_list_challans). Filters: unit, process, from (Mill/Warehouse),
  purpose (Fresh/Reprocess). Columns: challan, unit (+ In-house/External badge), process, from, rolls out/open, sent, age days,
  loss %, tested yes/no.
- "Send to processing" modal (reachable from mill batch rows, warehouse stock rows, and this page):
  rolls come from mm_list_rolls_v4({side, available_for:'process'}); unit dropdown (processing units only, filtered by the
  selected process if the unit has a list); process dropdown; unit ref no; sent date; Reprocess toggle → parent challan +
  reason (required). → mm_proc_send.
- Challan detail (mm_proc_get_challan):
  · Sent rolls table.
  · Lots panel (in-house units only): lot no, machine dropdown (that unit's machines), start/end, assign rolls → mm_proc_save_lots.
    Outsourced units: lots are optional, and there is no machine field at all.
  · "Record return" form, defaulting to the process type's return mode:
      Same rolls: one row per sent roll: qty, kg, shade; stage pre-filled from the process type (editable); roll/lap; width form; grade; dye lot.
      Re-rolled: pick the sent rolls → enter the new rolls (roll no, qty, kg, shade, stage, form, grade, dye lot).
      Write-off: pick a roll + reason.
      Mill-side challans only: "Deliver straight to warehouse" checkbox → dispatch challan no / ref.
    → mm_proc_return. On success, show the outputs with links to each roll passport.
  · Returns history, loss box (loss %, kg loss %), tests on this challan, reprocess children.
  · "Test this challan" → Page 4 test modal with scope process_challan. "Reprocess" → send modal pre-filled (purpose reprocess, parent).
  · Void (only when nothing came back) → mm_proc_void_challan.

PAGE 4 · Quality components (shared, used from Pages 2, 3 and 5)
- Test modal: opens with a scope (mill_batch / process_challan / process_lot / in_challan / selected rolls).
  Loads mm_qc_get_scope. Shows the roll count covered, the stage, and one input per test field (data_type → existing input component,
  required fields marked for the current stage, "per lot" fields grouped first), result Pass / Fail / Hold, remarks,
  "tested at", and where it was tested (Mill / Processing / Warehouse). → mm_qc_save_test. Shows that it replaces the previous test on this scope.
- Inspection grid: one row per roll (from the scope): inspected length + uom, cuttable width + uom, 1/2/3/4-point counts
  (or a defect-entry drawer with defect types), live points/100 sq yd and pass/fail, override + reason. → mm_qc_save_inspections.
- Roll passport drawer (mm_qc_get_roll), opened by clicking any roll code anywhere in v4 pages: header (code, stage, form,
  machine, batch, dye lot, round, custody), Test & Inspection badges with missing fields, test history (superseded/void greyed),
  inspections with defects, "Made from" ancestors (lineage), process history, allocation history, cut-at-risk approvals.
  Manager actions: Approve deviation (mm_qc_approve_deviation) and Void (mm_qc_void, with reason).
- QC queue page (tab under Fabric Warehouse and Fabric Mill): mm_qc_list_queue with need = Test / Inspection / Any.

PAGE 5 · Fabric Warehouse (extend existing)
- External GRN form → mm_wh_save_vendor_grn_v4: vendor dropdown (external vendor/mill facilities, with "add vendor" linking
  to setup), stage (default Finished), roll/lap, width form. Everything else stays as today.
- Stock / readiness tab: mm_wh_list_readiness. Columns: roll, style, location, stage, Test, Inspection, gate codes as chips,
  Cut-ready badge. "Only blocked" toggle.
- Bulk actions: Test, Inspect, Send to processing, Allocate (existing), Hold/Release (existing).

PAGE 6 · Store challan to cutting (existing modal)
- Before submit, show the readiness of the picked rolls (mm_wh_list_readiness filtered by style).
- When the RPC returns `code:'CUT_GATE'`, keep the modal open and mark each blocked roll with its codes in plain words:
  TEST_MISSING "Not tested" · TEST_STALE "Retest after processing" · TEST_INCOMPLETE "Missing: <fields>" ·
  TEST_FAILED "Test failed" · INSPECTION_* likewise · STAGE_NOT_CUTTABLE "Stage <x> can't be cut" ·
  NOT_ALLOCATED · ON_HOLD · NOT_AVAILABLE.
- Managers get a "Cut at risk" action on blocked rolls (only for TEST_*/INSPECTION_* codes): reason + optional expiry
  → mm_qc_approve_cut_at_risk, then retry.

PAGE 7 · Reports (inside the existing Material reports area, or as a tab on Processing)
- Process loss (mm_rpt_process_loss) by unit / process / both, with date range.
- Quality by machine (mm_rpt_quality_by_machine).

PAGE 8 · Settings switch (admin)
- In Material setup: "Fabric v4 (new quality gate)" toggle → mm_set_fabric_v4. Confirm dialog explaining: receiving no longer
  waits for QC; cutting requires a valid test + inspection for each roll's stage.

══════════════════════════════════════════════════════════════════════
TESTING
══════════════════════════════════════════════════════════════════════
- Existing Playwright + Vitest suites must pass unchanged.
- Add a Playwright smoke test per page (load, open main modal, submit a valid payload against a test factory, see success).
- End-to-end manual script (record a GIF or screenshots): general batch with 7 rolls on 2 machines → greige test on batch →
  2 dyeing challans to an in-house unit (one re-rolled 3→2, one same rolls) → test each challan (one fails) → reprocess →
  retest → inspect → allocate → dispatch → receive → putaway → readiness shows cut-ready → store challan succeeds.
  Then void one inspection → store challan shows CUT_GATE → cut at risk → succeeds.
- The DB self-test must still pass: `select public._mm_v4_selftest('<admin profile uuid>');` via the service role
  → error text starts with `SELFTEST PASS`.

══════════════════════════════════════════════════════════════════════
DONE WHEN / REPORT BACK
══════════════════════════════════════════════════════════════════════
- Phase 1 audit posted and accepted before Phase 2 starts.
- Every page above uses only existing components/tokens (list any exception and why).
- No old RPC from contract §9 is called by a v4 page.
- With fabric_v4 OFF the app behaves exactly as today. With it ON the full flow works end to end.
- Report: files changed per page, components reused, screenshots of each page next to the existing page it matches,
  any contract gaps found (do not patch the DB yourself).
