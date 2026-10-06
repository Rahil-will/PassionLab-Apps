# Fabric v4 UI — Progress

Source of truth: `PROMPT/IDE_PROMPT_FABRIC_V4_UI.md`, `PROMPT/MM_FABRIC_V4_DB_CONTRACT.md`, `PROMPT/FABRIC_MILL_WAREHOUSE_SPLIT_PLAN.md`.

---

## Phase 0 — Sync DB into repo (no UI)

- [x] **0.1** Pull remote migrations — `534531a`
- [x] **0.2** Types + v4 RPC wrappers — `11eed61`
- [!] **0.3** verify-functions / vitest
  - Notes: verify-functions pre-existing (`_assert_desktop_factory_scope`). Vitest rack-ops **pre-existing**: fails at `534531a~1` (`b258dcb`) with untracked kept; latest def `20260922290000_mm_live_stale_replay.sql` omits `\bVOLATILE\b`. Leave; no migration edits.

## Phase 1 — Discovery (read-only)

- [x] **1.0** `V4_UI_AUDIT.md` — APPROVED 2026-10-05

## Phase 2 — Build pages

- [x] **2.1a** Page 1 — Facilities + Machines
  - Notes: `MmFacilitiesPage.tsx`, `useMmV4Config.ts`, section in `WorkCenterMaterial`. Smoke `e2e/smoke/fabric-v4-facilities.spec.ts` (skips placeholder admin creds). typecheck + module-boundaries OK.
- [x] **2.1b** Page 1 — Fabric stages section
  - Notes: `MmFabricStagesPage.tsx` wired in Material setup.
- [~] **2.1c** Page 1 — Process type rules
  - Notes: next
- [ ] **2.1d** Page 1 — Test field rules (level + required-at-stages)
- [ ] **2.2** Page 2 — Fabric Mill extend
- [ ] **2.3** Page 3 — Processing (gate v4 on fabric_v4)
- [ ] **2.4** Page 4 — Quality shared
- [ ] **2.5** Page 5 — Fabric Warehouse extend
- [ ] **2.6** Page 6 — Store challan CUT_GATE
- [ ] **2.7** Page 7 — Reports
- [ ] **2.8** Page 8 — fabric_v4 toggle (ModuleSelectorPanel)

## Testing / Final

- [ ] **T.1–T.4**, **F.1**

---

## Contract gaps

(none blocking — test field rules columns live on `mm_type_test_fields`; read via config bundle once typed)

## Decisions

- Untracked remote-only migrations from fetch: leave untracked; never stage in fabric v4 commits.
- Passport = largest Modal, warehouse-testing header/footer.
- `#/material/process` v4 gated on `fabric_v4`; OFF = today.
- Do not flip `fabric_v4` on real factories.
- Smoke tests skip when `VITE_TEST_ADMIN_*` are placeholders (`your-admin@email`).
- Vitest rack-ops failure confirmed pre-existing at `b258dcb`.
