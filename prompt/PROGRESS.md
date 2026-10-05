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
- [x] **2.2b** New batch form (`mm_mill_save_batch_v4` + roll grid + machine/shift/forms) — general batch; style create deferred to Allocated fabrics / next pass — `67f1147`
- [x] **2.2c** Batch detail (`mm_mill_get_batch_v4`) + add rolls / allocate / dispatch / tag; Test/Inspect stub until Page 4 — `21bf886`
- [x] **2.3** Processing v4 list/detail/send/return/lots/void; OFF keeps existing process pages — `98933a1`
- [x] **2.4** Quality: test/inspect/passport modals + mill/warehouse QC queues — `67f61f7`
- [x] **2.5** Warehouse: v4 vendor GRN fields + readiness tab + v4 send from stock — `81700c5`
- [x] **2.6** Store challan CUT_GATE + readiness preview + cut-at-risk — `ece55db`
- [x] **2.7** Process reports tab (loss + quality by machine)
- [x] **2.8** fabric_v4 toggle next to In-house mill (admin confirm; do not flip real factories)

## Testing / Final

- [x] **T** typecheck green after Phase 2; vitest migration-scan / verify-functions left as pre-existing `[!]`
- [x] **F.1** `prompt/FINAL_REPORT.md`

---

## Contract gaps

(none blocking)

## Decisions

- Untracked remote-only migrations from fetch: leave untracked; never stage in fabric v4 commits.
- Passport = Modal (max-w-5xl); process/mill v4 UIs gated on `fabric_v4`; OFF keeps today.
- Do not flip `fabric_v4` on real factories (toggle UI only).
- Vitest rack-ops pre-existing at `b258dcb` (`20260922290000_mm_live_stale_replay.sql`, `\bVOLATILE\b`).
- Smoke skips placeholder admin creds.
- Style mill batch create deferred on form (general batch + Allocated fabrics path).
