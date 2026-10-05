# Fabric v4 UI — Progress

Source of truth: `PROMPT/IDE_PROMPT_FABRIC_V4_UI.md`, `PROMPT/MM_FABRIC_V4_DB_CONTRACT.md`, `PROMPT/FABRIC_MILL_WAREHOUSE_SPLIT_PLAN.md`.

---

## Phase 0

- [x] **0.1** migrations — `534531a`
- [x] **0.2** types/wrappers — `11eed61`
- [!] **0.3** verify-functions / vitest pre-existing (see Decisions)

## Phase 1

- [x] **1.0** audit APPROVED

## Phase 2

- [x] **2.1a–d** Material setup (facilities, stages, process rules, test field rules) — `14e8896`, `29435dd`
- [x] **2.2a** Mill batches list (`mm_mill_list_batches_v4`), routes, hub link when fabric_v4 ON
- [x] **2.2b** New batch form (`mm_mill_save_batch_v4` + roll grid + machine/shift/forms) — general batch; style create deferred to Allocated fabrics / next pass
- [ ] **2.2c** Batch detail + bulk actions
- [ ] **2.3** Processing (gate v4 on fabric_v4)
- [ ] **2.4** Quality shared
- [ ] **2.5** Warehouse extend
- [ ] **2.6** Store challan CUT_GATE
- [ ] **2.7** Reports
- [ ] **2.8** fabric_v4 toggle

## Testing / Final

- [ ] **T.1–T.4**, **F.1**

---

## Contract gaps

(none)

## Decisions

- Untracked remote-only migrations from fetch: leave untracked; never stage in fabric v4 commits.
- Passport = Modal; process/mill v4 UIs gated on `fabric_v4`; OFF keeps today.
- Do not flip `fabric_v4` on real factories.
- Vitest rack-ops pre-existing at `b258dcb` (`20260922290000_mm_live_stale_replay.sql`, `\bVOLATILE\b`).
- Smoke skips placeholder admin creds.
