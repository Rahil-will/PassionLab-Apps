# PRODIGI V2: notes for Claude Code

## Repo layout
- This repo (PRODIGI WEB): main web app (Vite + React + TS + Tailwind). Material Management lives in `modules/material/` and `pages/system/WorkCenterMaterial.tsx`. Branch `mm-fabric-v4`.
- PRODIGI FLOOR (separate, not in this repo): floor PWA. **Owned by a colleague. Don't change it.**
- Create Order UI (`pages/production/create-order/*`): **don't change it.**
- `docs/material/`: current status (`MM_STATUS_2026-10-21.md`). Older IDE prompts/SQL live outside this repo (Rahil's PROMPT folder).
- Docs and decisions: the claude.ai project "PRODIGI V2" → `material/` (latest: `MM_STATUS_2026-10-21.md`).

## Supabase
- Project `xtfljldeceonqyzgkoyp`. Test factory "abc" `8202873b-1003-4fee-9970-9a2ef4fa9fd3`. Test profile `82d8b35b-7e7b-4b12-9b87-06c9b63927b0`.
- All writes go through `mm_*` RPCs returning `{ok, data | code, message}` (`_mm_ok` / `_mm_err`).
- **Patching functions:** use the CRLF-safe `pg_temp.fx(name, old, new, n)` helper (definition in docs/material/MM_STATUS_2026-10-21.md appendix). It refuses if the match count is wrong.
- **Self-tests:** a DO block with `set_config('request.jwt.claims', …)` that ends in `RAISE EXCEPTION concat(...)` so it rolls back.
- Before dropping a column, grep `pg_proc.prosrc` for it. Drops / DROP FUNCTION / DELETE go in a file for Rahil to run.
- **Never change the DB from a UI task.** The 10-16 IDE migration `mm_stage_keep_initial` broke stage save.

## Data model rules (decided)
- Storage units: qty in kg or m, width in inches. Display / input via `mm_units.factor` (`lib/units.ts` reads `mm_list_units`).
- A fabric type lists its allowed units; a fabric picks one of each. A type is weight **or** length, never both.
- `can_cut` stage = "Finished (ready to cut)": allocate (finished) vs book (not finished), QC tolerance, stock buckets. Stage `seq` = display order only.
- Process status and receipt status are computed from challans (`_mm_roll_process_status`, `_mm_receipt_process_summary`).

## Checks
- `npx tsc --noEmit && npx vitest run`
- Rahil prefers paste-ready output, terse and direct.
