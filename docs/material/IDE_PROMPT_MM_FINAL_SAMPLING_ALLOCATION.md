# IDE PROMPT (FINAL): inspection sampling + allocation notes
Backend is LIVE (migrations `mm_inspection_sampling`, `mm_allocation_notes`). **Do NOT change the DB. No migrations.**
Keep the existing layouts (CLAUDE.md UI baseline). The fabric detail page stays read-only: no actions there.

---------------------------------------------------------------
## A. Inspection sampling

### Backend contract
- `mm_fabric_types.inspection_sample_pct`: 100 (default, every roll) | 20 | 10 | 0 (not required). Sent via `mm_save_fabric_type` as `inspection_sample_pct`.
- `rpc('mm_insp_open_session', { p_scope_kind: 'in_challan'|'process_challan', p_scope_id })` → session (reopens an open one).
  - Returns `NOT_REQUIRED` when the type is 0%.
- `rpc('mm_insp_get_session', { p_session_id })`, `rpc('mm_insp_list_sessions', { p_scope_kind, p_scope_id })` (past sessions, no rolls).
- `rpc('mm_insp_set_selection', { p_session_id, p_roll_ids })`: swap which rolls are sampled. The count must equal `sample_size`. Draft only.
- `rpc('mm_insp_save_session', { p_session_id, p_rows, p_inspected_at? })`:
  - `p_rows` has the same row shape as today's inspection save (`roll_id, inspected_length, length_uom, cuttable_width, width_uom, pts_1..pts_4, remarks, result_override?, override_reason?`).
  - Only rolls in the sample are allowed. Partial saves are fine.
  - Once every selected roll has a result, the backend sets the verdict:
    - all pass → `passed`
    - any fail (sample < all) → `escalated`: every roll is now selected; inspect the rest
    - 100% done → `closed` (each roll stands on its own result)
- `rpc('mm_insp_decide', { p_session_id, p_decision: 'accept_deviation'|'reject', p_reason })`: only on `escalated` sessions.
- **Session JSON:**
  - Fields: `id, status, sample_pct, total_rolls, sample_size, selected_count, inspected_count, failed_count, escalated_at, decision_reason`.
  - `rolls[]`: `{ seq, selected, inspection | null, roll: <roll row> }`.
- **Passport** `inspection` adds: `sampled` (passed via sample), `not_required` (0% type), `session_id`, `session_status`.
  - Status can now be `HOLD` (escalated, not yet inspected).
  - The cutting gate already treats anything other than PASS as blocked.

### UI
1. **Fabric types page:** "Inspection sampling" select next to 4pt max: 100% / 20% / 10% / Not required. Add a table column. Hydrate and send `inspection_sample_pct`.
2. **Inspection page** (receipt or process challan): on open, call `mm_insp_open_session` and drive the page from the session (replace the current every-roll list).
   - **Header card:** "Sample 3 of 12 rolls (20%)", plus a status chip (Draft / Escalated – inspect all / Passed / Passed – deviation / Closed / Rejected).
   - **First column:** a checkbox selector.
     - Draft: pre-checked as returned. The user can swap rolls, but the checked count must stay = `sample_size` (disable checking more). A "Save sample" button calls `mm_insp_set_selection`.
     - Escalated: all rows checked and locked.
   - Only selected rows are editable (current cells: length, width, 1–4 points, remarks). Unselected rows are greyed with "Not sampled".
   - Save → `mm_insp_save_session` with the edited selected rows. Then re-render from the response:
     - `escalated` → amber banner "1 sampled roll failed — inspect all remaining rolls, or decide". The two buttons Accept deviation / Reject lot open a reason modal → `mm_insp_decide`.
     - `passed` → green banner "Sample passed — all 12 rolls cleared (sampled)".
   - `NOT_REQUIRED` → info card "Inspection not required for this fabric type".
   - **Past sessions:** list from `mm_insp_list_sessions`, same card style as Testing's past sessions.
3. **Inspection column/chips** (receipt rolls table, fabric detail rolls, passport) from `passport.inspection` / roll row:
   - PASS + sampled → "Pass · sampled"
   - not_required → "Not required"
   - HOLD → amber "On hold – sample failed"
   - Rejected session → FAILED
4. **Receipt header:** a verdict chip from the latest session (`mm_insp_list_sessions(...)[0].status`).

---------------------------------------------------------------
## B. Allocation notes (AL-YYMM-NNNN)

### Backend contract
- Every allocate / book is recorded on a numbered note automatically:
  - one note per allocate/book action per style line;
  - unallocate / unbook closes the line; dispatch to cutting marks it dispatched;
  - a booking that becomes an allocation is marked converted.
  - Existing allocations were backfilled as **AL-2610-0001**.
- `mm_allocate_rolls_v4` and `mm_book_rolls` responses now include `note: { id, note_no, status, counts, style }`.
- `rpc('mm_list_allocation_notes', { p_filter: { style_material_id?, order_id?, status?: 'open'|'dispatched'|'closed', search? } })`
  → rows `{ id, note_no, created_at, created_by_name, remarks, status, style{style_name, style_ref, order_no, colorway_name, fabric_code, fabric_name}, counts{lines, active, allocated, booked, dispatched, released, qty_active} }`.
- `rpc('mm_get_allocation_note', { p_id })` → note + `lines[] { id, kind: allocate|book, status: active|released|dispatched|converted, qty, uom, created_at, closed_at, close_reason, store_challan_no, roll: <roll row> }`.
- `rpc('mm_cancel_allocation_note', { p_id, p_reason })`: releases every active line (through the normal unallocate / unbook).

### UI
1. **After Allocate / Book succeeds:** toast "Allocated 12 rolls on AL-2610-0002" with a link to the note.
2. **Fabric Warehouse → Quick access → new "Allocations" card** → list page `#/material/warehouse/allocations`.
   - Search, status tabs (Open / Dispatched / Closed).
   - Columns: Note no, Date, Style · colourway, Fabric, Allocated, Booked, Dispatched, Qty open, Status, By.
3. **Note detail page** `#/material/warehouse/allocations/:id`:
   - Header card: note no, date, by, style, fabric, status, counts.
   - Lines table: Roll, Kind chip (Allocate / Book), Qty, Status chip, Store challan no (link), Closed reason. Roll → passport.
   - Actions:
     - "Dispatch to cutting": opens the existing store-challan flow, prefilled with this note's active allocate lines' rolls and style line.
     - "Cancel note": reason modal → `mm_cancel_allocation_note`.
   - Print: the same print component style as challans.
4. **Style-wise fabric page:** under each style line, show its notes (`mm_list_allocation_notes({ style_material_id })`) as chips linking to the note.

---------------------------------------------------------------
## C. Check and commit
- `npx tsc --noEmit`, `npx vitest run` (add tests for the selection-count rule and the note-status mapping).
- Click test:
  - Knit → Inspection sampling 20%.
  - Open inspection on receipt "1": 3 of 12 pre-selected → enter all pass → "Sample passed".
  - Receipt MDC-2610-0001: fail one sampled roll → banner "inspect all", unsampled rolls show "On hold" → Accept deviation → they show "Pass · sampled".
  - Allocate 2 rolls → toast shows the AL number → Allocations list shows it → Cancel note → rolls are free.
- Commit everything on mm-fabric-v4: "MM: inspection sampling sessions, allocation notes" and push. Report done / not done.
