-- Backfill mm_rolls.color_name from custody, then repair rolls that came back from a process still at the sent stage.
UPDATE public.mm_rolls r SET color_name = btrim(COALESCE(NULLIF(btrim(u.color_ref), ''), m.color_ref))
FROM public.mm_rolls r2
LEFT JOIN public.mm_stock_units u ON u.roll_id = r2.id
LEFT JOIN public.mm_mill_rolls m ON m.roll_id = r2.id
WHERE r.id = r2.id AND r.color_name IS NULL
  AND NULLIF(btrim(COALESCE(NULLIF(btrim(u.color_ref), ''), m.color_ref, '')), '') IS NOT NULL;

WITH last_ret AS (
  SELECT DISTINCT ON (rl.roll_id) rl.id, rl.roll_id, rl.stage_code AS ret_stage, rl.color_ref, ol.stage_code AS sent_stage,
         t.output_stage_code, NULLIF(btrim(c.target_color), '') AS target
  FROM public.mm_process_return_lines rl
  JOIN public.mm_process_out_lines ol ON ol.id = rl.out_line_id
  JOIN public.mm_process_challans c ON c.id = rl.challan_id
  JOIN public.mm_process_types t ON t.id = c.process_type_id
  WHERE rl.roll_id IS NOT NULL
  ORDER BY rl.roll_id, rl.created_at DESC
)
UPDATE public.mm_rolls r SET
  stage_code = CASE WHEN l.output_stage_code IS NOT NULL AND (l.ret_stage IS NULL OR upper(l.ret_stage) = upper(l.sent_stage))
                     AND r.stage_code = COALESCE(l.ret_stage, l.sent_stage) THEN l.output_stage_code ELSE r.stage_code END,
  color_name = COALESCE(r.color_name, NULLIF(btrim(l.color_ref), ''), l.target),
  updated_at = now()
FROM last_ret l
WHERE r.id = l.roll_id;

UPDATE public.mm_mill_rolls m SET color_ref = r.color_name, updated_at = now()
FROM public.mm_rolls r
WHERE m.roll_id = r.id AND NULLIF(btrim(COALESCE(m.color_ref, '')), '') IS NULL AND r.color_name IS NOT NULL;

UPDATE public.mm_stock_units u SET color_ref = r.color_name, updated_at = now()
FROM public.mm_rolls r
WHERE u.roll_id = r.id AND NULLIF(btrim(COALESCE(u.color_ref, '')), '') IS NULL AND r.color_name IS NOT NULL;
