-- QC queue: roll rows (_mm_roll_row → mm_qc_list_queue, rolls lists, batch detail) now carry the ids needed for
-- manager actions, and why the roll is due:
--   failed_test_id        — latest valid failed test without an approved deviation (→ mm_qc_approve_deviation('test', id, reason))
--   inspection_id         — latest active inspection
--   failed_inspection_id  — same, only when it failed without deviation (→ mm_qc_approve_deviation('inspection', id, reason))
--   test_due_reason / inspection_due_reason — 'new' (never done) | 'reprocessed' (stale after processing) | 'failed' | 'hold' | 'incomplete' | null (passed)
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._mm_roll_row'::regproc);
  IF position($a$    'missing_keys', v_pp->'test'->'missing_keys',$a$ in d) = 0 THEN RAISE EXCEPTION 'roll_row pattern not found'; END IF;
  d := replace(d, $a$    'missing_keys', v_pp->'test'->'missing_keys',$a$,
    $b$    'missing_keys', v_pp->'test'->'missing_keys',
    'failed_test_id', (SELECT t->>'id' FROM jsonb_array_elements(COALESCE(v_pp->'test'->'tests', '[]'::jsonb)) t
                       WHERE t->>'result' = 'fail' AND NOT COALESCE((t->>'deviation')::boolean, false) LIMIT 1),
    'inspection_id', v_pp->'inspection'->>'id',
    'failed_inspection_id', CASE WHEN v_pp->'inspection'->>'status' = 'FAILED' THEN v_pp->'inspection'->>'id' END,
    'test_due_reason', CASE v_pp->'test'->>'status' WHEN 'NONE' THEN 'new' WHEN 'STALE' THEN 'reprocessed' WHEN 'FAILED' THEN 'failed'
                         WHEN 'HOLD' THEN 'hold' WHEN 'INCOMPLETE' THEN 'incomplete' END,
    'inspection_due_reason', CASE v_pp->'inspection'->>'status' WHEN 'NONE' THEN 'new' WHEN 'STALE' THEN 'reprocessed' WHEN 'FAILED' THEN 'failed' END,$b$);
  EXECUTE d;
END $mig$;
