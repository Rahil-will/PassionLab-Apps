# IDE PROMPT (LAST): Fabric inspection rules page + staged inspection flow + wrap-up
Backend is LIVE (`mm_inspection_rules_staged` on top of `mm_inspection_sampling`). **Do NOT change the DB. No migrations.**
Keep existing layouts (CLAUDE.md UI baseline). Fabric detail page stays read-only.

---------------------------------------------------------------
## A. New page: Material Management → Fabric tab → "Fabric inspection rules"
Put it right after "Fabric testing parameters". Hint: "How rolls are sampled and passed on 4-point inspection."

### Backend
- `rpc('mm_get_inspection_rules')` → `{ steps: number[], types: [{ fabric_type_id, fabric_type_name, roll_max_points, lot_avg_max_points, inspection_required, steps: number[]|null }] }`
- `rpc('mm_save_inspection_rules', { p_row: { steps?, types?: [ ...same shape... ] } })` → same payload as get.
- Errors (show `message`): steps must rise, 1–100%, max 5 steps; points > 0; lot average ≤ roll max.

### Layout: two cards
**Card 1: "Inspection flow (all fabric types)"**, drawn as a flow chart (left → right):
`[ Step 1: 10% of rolls ] —fail→ [ Step 2: 20% ] —fail→ [ Step 3: 100% ] —fail→ [ Supervisor decides: accept / reject ]`
- Under every step: a green "pass → lot cleared" arrow.
- Each step box has an editable % input. Buttons: "+ Add step" (max 5) and remove a step (min 1).
- The last box is fixed text.
- Below: "A step fails when any inspected roll is over its roll limit, or the average of inspected rolls is over the lot limit. Failing moves to the next step; the sample grows, and rolls already inspected stay."
- Default `[10, 20, 100]`. Save sends `steps`.

**Card 2: "Points by fabric type"** table, one row per active fabric type:
- **Inspection required:** toggle. Off = rolls need no inspection: they show "Not required" and aren't blocked.
- **Roll max (pts / 100 sq yd):** number, default 40.
- **Lot average max:** number, optional.
- **Flow:** "Default" chip, or "Custom…" which opens a small modal with the same step editor; saved as that type's `steps` (null = default).
- One Save for the page → `mm_save_inspection_rules({ steps, types })`.

### Remove from Fabric types page
Remove "4 point max" and "Inspection sampling" (inputs, columns, payload keys `fpt_max_points`, `inspection_sample_pct`). They live on the rules page now.

---------------------------------------------------------------
## B. Inspection page: staged flow (adjust the session UI already built)
Session JSON now also has `steps`, `step_no`, `roll_max_points`, `lot_avg_max_points`, `lot_avg_points`. The save response has `needs_decision`.
1. **Header card:**
   - Show the steps as a mini stepper (e.g. "10% → **20%** → 100%"), current step bold.
   - Show "Sample 2 of 10 rolls".
   - Show "Lot average 26.3 / max 28" (red when over).
2. **After save:**
   - **Escalated, `needs_decision` false:** amber banner "Step 1 failed — sample grown to 20% (2 rolls). Inspect the new rolls." The new rolls are pre-checked; rolls already inspected stay read-only and checked.
   - **Escalated, `needs_decision` true:** red banner "Last step failed — decide". Buttons Accept deviation / Reject lot → reason modal → `mm_insp_decide`.
   - **Passed:** green banner "Lot cleared at step N (X of Y rolls inspected)".
   - **Closed:** neutral banner "All rolls inspected — each roll stands on its own result" plus the count of failed rolls.
3. **Selection swaps** are allowed in any open step (`mm_insp_set_selection`). Rolls already inspected can't be unchecked; the count stays = `sample_size`.
4. **Past sessions list:** show "Passed at step 2 (20%)" / "Closed after 100%" / "Rejected" / "Accepted with deviation".

---------------------------------------------------------------
## C. Wrap-up
1. Commit the pending untracked files as records:
   - `supabase/migrations/20261021140000_mm_roll_row_last_test_values.sql`
   - `docs/material/*`
2. `npx tsc --noEmit`, `npx vitest run`. Add tests: the step editor validation (rising, 1–100, max 5) and the banner state mapping.
3. Commit + push on mm-fabric-v4: "MM: fabric inspection rules page, staged inspection flow". Report done / not done.

---------------------------------------------------------------
## D. Click test (Rahil, in the browser, after this prompt)
| # | Do | Expect |
|---|---|---|
| 1 | Fabric types → Knit → "+ Add unit…" Bale = 25 KG | Bale saved and selected |
| 2 | Inspection rules → flow 10/20/100; Knit roll max 40, lot avg 28 | Saves; Fabric types no longer shows 4pt / sampling |
| 3 | Fabric vendors → RK Mills GSTIN 27ABCDE1234F1Z5 | Saves |
| 4 | Processes → Dyeing expected loss 10% | Saves |
| 5 | Receive → External → RK Mills → 3 rolls at Greige | "Booked, not allocated" note; receipt created |
| 6 | Inspection on MDC-2610-0001: fail the 1 sampled roll | Moves to 20% (2 rolls); fail again → 100%; pass the rest → "All rolls inspected" |
| 7 | Inspection on receipt "1": pass the sampled roll | "Lot cleared at step 1"; other rolls "Pass · sampled" |
| 8 | Send the 3 greige rolls to Dyeing → return "Comes back as Dyed" | Stage Dyed + "Dyeing done"; challan loss vs 10% norm |
| 9 | Allocate 2 finished rolls to a style | Toast with AL number → Allocations → Cancel note frees them |
| 10 | Reports → ITC-04 this quarter | Dyeing challan with RK Mills GSTIN |
