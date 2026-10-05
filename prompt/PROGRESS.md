# Fabric v4 UI — Progress

Source of truth: `PROMPT/IDE_PROMPT_FABRIC_V4_UI.md`, `PROMPT/MM_FABRIC_V4_DB_CONTRACT.md`, `PROMPT/FABRIC_MILL_WAREHOUSE_SPLIT_PLAN.md`.
Contract wins on any conflict. Obsolete prompt files mentioning mm_receipts / Phase 2–4 old model are ignored.
Mirrored into `PRODIGI WEB/docs/modules/material/` and state also at `PRODIGI WEB/prompt/PROGRESS.md` (git-tracked).

---

## Phase 0 — Sync DB into repo (no UI)

- [x] **0.1** Pull remote migrations; confirm 11 mm_v4_* files exist locally
  - Notes: Commit `534531a`.
- [x] **0.2** Regenerate Supabase TS types; add typed wrappers for every v4 RPC
  - Notes: Commit `11eed61`. Typecheck pass.
- [!] **0.3** Run `db:audit-schema`, `db:verify-functions`, existing test suites — all pass
  - Notes: audit-schema OK. verify-functions FAIL pre-existing (`_assert_desktop_factory_scope` on live). Vitest 226/227; 1 pre-existing rack-ops migration scan fail. Not blocking UI.

## Phase 1 — Discovery (read-only)

- [x] **1.0** Write `docs/modules/material/V4_UI_AUDIT.md`
  - Notes: Written. **WAITING FOR USER APPROVAL before Phase 2.**

## Phase 2 — Build pages

- [ ] **2.1** Page 1 — Material setup new sections
- [ ] **2.2** Page 2 — Fabric Mill extend
- [ ] **2.3** Page 3 — Processing (NEW)
- [ ] **2.4** Page 4 — Quality shared components
- [ ] **2.5** Page 5 — Fabric Warehouse extend
- [ ] **2.6** Page 6 — Store challan CUT_GATE + cut-at-risk
- [ ] **2.7** Page 7 — Reports
- [ ] **2.8** Page 8 — Settings fabric_v4 toggle

## Testing

- [ ] **T.1** Existing Playwright + Vitest pass unchanged
- [ ] **T.2** Playwright smoke per page
- [ ] **T.3** Manual E2E script recorded
- [ ] **T.4** DB self-test still `SELFTEST PASS`

## Final

- [ ] **F.1** Write `PROMPT/FINAL_REPORT.md`

---

## Contract gaps

(none yet)

## Decisions

- Progress in `PROMPT/PROGRESS.md` + `PRODIGI WEB/prompt/PROGRESS.md`. Docs in `docs/modules/material/`.
- Will not enable `fabric_v4` on any real factory.
- Phase 0.1 staged only `mm_v4_*` migrations (+ docs/progress).
- No `createClient<Database>` wiring; wrappers carry contract shapes.
- `mm_proc_void_challan` uses live Arg `p_challan_id`.
- Phase 0.3 verify/vitest failures treated as pre-existing drift.
- Passport UI will use `Modal` (no Drawer in Material). Multi-select follows process-vendors checkbox / SelectDropdown multiple pattern from setup.
