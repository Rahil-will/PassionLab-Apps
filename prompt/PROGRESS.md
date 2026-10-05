# Fabric v4 UI — Progress

Source of truth: `PROMPT/IDE_PROMPT_FABRIC_V4_UI.md`, `PROMPT/MM_FABRIC_V4_DB_CONTRACT.md`, `PROMPT/FABRIC_MILL_WAREHOUSE_SPLIT_PLAN.md`.
Contract wins on any conflict. Obsolete prompt files mentioning mm_receipts / Phase 2–4 old model are ignored.
Mirrored into `PRODIGI WEB/docs/modules/material/` and state also at `PRODIGI WEB/prompt/PROGRESS.md` (git-tracked).

---

## Phase 0 — Sync DB into repo (no UI)

- [x] **0.1** Pull remote migrations; confirm 11 mm_v4_* files exist locally
  - Notes: `supabase migration fetch --linked --yes`. All 11 present under `supabase/migrations/` (+ 2 extras: `mm_v4_fix_wh_return_qty_order`, `mm_v4_selftest_wh_reprocess`). Fetch also materialised many other remote-only history files as untracked (not staged).
- [~] **0.2** Regenerate Supabase TS types; add typed wrappers for every v4 RPC
  - Notes: starting — wrappers go in `modules/material/lib/mmRpc.ts` (existing pattern); no prior generated Database types in repo
- [ ] **0.3** Run `db:audit-schema`, `db:verify-functions`, existing test suites — all pass
  - Notes:

## Phase 1 — Discovery (read-only)

- [ ] **1.0** Write `docs/modules/material/V4_UI_AUDIT.md` (component inventory, route/RPC map, page reuse plan)
  - Notes: STOP and wait for user approval before Phase 2

## Phase 2 — Build pages

- [ ] **2.1** Page 1 — Material setup new sections (facilities, machines, stages, process rules, test field rules)
  - Notes:
- [ ] **2.2** Page 2 — Fabric Mill extend (list/form/detail + bulk actions)
  - Notes:
- [ ] **2.3** Page 3 — Processing (NEW) — split if needed into 3a–3d
  - Notes:
- [ ] **2.4** Page 4 — Quality shared components (test modal, inspection grid, passport, QC queue)
  - Notes:
- [ ] **2.5** Page 5 — Fabric Warehouse extend (vendor GRN v4, readiness, bulk actions)
  - Notes:
- [ ] **2.6** Page 6 — Store challan CUT_GATE + cut-at-risk
  - Notes:
- [ ] **2.7** Page 7 — Reports (process loss, quality by machine)
  - Notes:
- [ ] **2.8** Page 8 — Settings fabric_v4 toggle (do not flip on real factory)
  - Notes:

## Testing

- [ ] **T.1** Existing Playwright + Vitest pass unchanged
  - Notes:
- [ ] **T.2** Playwright smoke per page
  - Notes:
- [ ] **T.3** Manual E2E script recorded (screenshots/GIF)
  - Notes:
- [ ] **T.4** DB self-test still `SELFTEST PASS`
  - Notes:

## Final

- [ ] **F.1** Write `PROMPT/FINAL_REPORT.md` from DONE WHEN / REPORT BACK
  - Notes:

---

## Contract gaps

(none yet)

## Decisions

- Progress + reports: keep workspace `PROMPT/PROGRESS.md` as user-facing state; git-tracked copy at `PRODIGI WEB/prompt/PROGRESS.md`. Contract/plan/prompt mirrored to `docs/modules/material/` per IDE prompt READ FIRST.
- Will not enable `fabric_v4` on any real factory from this agent.
- Phase 0.1 commit stages only the 13 `mm_v4_*` migration files (+ docs/progress), not the hundreds of other remote-only history files fetch wrote as untracked.
