# Fabric v4 UI — Final report

## Status

Phase 0–2 UI loop complete on `main`. `fabric_v4` was **not** flipped on any factory. Untracked fetch-only migrations were **never staged**.

## Commits (fabric v4)

| Commit | Slice |
|---|---|
| `534531a` | 0.1 migrations |
| `11eed61` | 0.2 types/wrappers |
| `148b900` | Phase 1 audit |
| `14e8896` / `29435dd` | Page 1 setup |
| `6cc6d84` | 2.2a mill batches list |
| `67f1147` | 2.2b mill batch form |
| `21bf886` | 2.2c mill batch detail |
| `98933a1` | Page 3 processing |
| `67f61f7` | Page 4 quality |
| `81700c5` | Page 5 warehouse |
| `ece55db` | Page 6 CUT_GATE |
| `e8798e8` | Pages 7–8 reports + toggle |

## Pages / gating

| Page | When `fabric_v4` OFF | When ON |
|---|---|---|
| Process `#/material/process` | Legacy list/detail/send | V4 list/detail/send/return/lots/void + reports |
| Mill batches / form / detail | Hidden / not used | V4 RPCs |
| Warehouse GRN unallocated | Text supplier + old RPC | Vendor facility + stage/forms + `mm_wh_save_vendor_grn_v4` |
| Stock | On hand + movements | + Readiness tab |
| Dispatch to cutting | Same create flow | Readiness preview + CUT_GATE + cut-at-risk |
| Settings modules | In-house mill only | + Fabric v4 toggle (admin confirm) |

## Components reused

`PageShell`, `Badge`, `Button`, `Input`, `SelectDropdown`, `Modal`, `LabeledDatePicker`, `MmSegmentControl`, `MmRollEntryGrid`, `MmSheetGrid`, `MmAllocateRollsModal`, `DesktopWriteGate`, warehouse table density / status badge mapping from audit.

## Known pre-existing / deferred

- `db:verify-functions` `_assert_desktop_factory_scope` — pre-existing (logged 0.3 `[!]`).
- Vitest migration-scan `\bVOLATILE\b` in `20260922290000_mm_live_stale_replay.sql` — pre-existing at `b258dcb`.
- Style batch create on mill form still deferred (use Allocated fabrics / general batch).
- Smoke e2e skips when admin creds are placeholders.
- Untracked remote-only migrations from fetch: leave for separate decision (see PROGRESS Decisions).

## Contract gaps

None that blocked UI. Live arg names followed generated types (`mm_proc_void_challan` uses `p_challan_id`).

## Manual E2E

Not run against a live test factory in this loop (no factory flip; placeholder smoke creds). Recommended script remains the prompt’s general-batch → process → QC → allocate → dispatch → CUT_GATE path on a dedicated test factory with `fabric_v4` on.
