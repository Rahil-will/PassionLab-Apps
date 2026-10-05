# Fabric v4 UI — Progress

Source of truth: `PROMPT/IDE_PROMPT_FABRIC_V4_UI.md`, `PROMPT/MM_FABRIC_V4_DB_CONTRACT.md`, `PROMPT/FABRIC_MILL_WAREHOUSE_SPLIT_PLAN.md`.

---

## Phase 0 — Sync DB into repo (no UI)

- [x] **0.1** Pull remote migrations — `534531a`
- [x] **0.2** Types + v4 RPC wrappers — `11eed61`
- [!] **0.3** verify-functions / vitest — pre-existing (see Decisions)

## Phase 1 — Discovery (read-only)

- [x] **1.0** `V4_UI_AUDIT.md` — APPROVED 2026-10-05

## Phase 2 — Build pages

- [x] **2.1a** Facilities + Machines — `14e8896`
- [x] **2.1b** Fabric stages — `14e8896`
- [x] **2.1c** Process type rules — extended `MmProcessVendorsPage` with output stage / return mode / retest / re-inspect / machine kinds → `mm_save_process_type_rules`
- [x] **2.1d** Test field rules — Level + Required-at-stages on fabric testing editor → `mm_save_test_field_rules`
- [~] **2.2** Page 2 — Fabric Mill extend
- [ ] **2.3** Page 3 — Processing (gate v4 on fabric_v4)
- [ ] **2.4** Page 4 — Quality shared
- [ ] **2.5** Page 5 — Fabric Warehouse extend
- [ ] **2.6** Page 6 — Store challan CUT_GATE
- [ ] **2.7** Page 7 — Reports
- [ ] **2.8** Page 8 — fabric_v4 toggle

## Testing / Final

- [ ] **T.1–T.4**, **F.1**

---

## Contract gaps

(none)

## Decisions

- Untracked remote-only migrations from fetch: leave untracked; never stage in fabric v4 commits.
- Passport = largest Modal; process v4 gated on `fabric_v4`.
- Do not flip `fabric_v4` on real factories.
- Vitest rack-ops failure pre-existing at `b258dcb` (culprit untracked `20260922290000_mm_live_stale_replay.sql`, rule `\bVOLATILE\b`).
- Smoke skips placeholder `VITE_TEST_ADMIN_*` creds.
