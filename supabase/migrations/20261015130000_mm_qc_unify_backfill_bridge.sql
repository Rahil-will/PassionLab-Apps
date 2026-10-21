-- QC unification (2026-10-15)
-- 2a: copy old warehouse Testing rows (mm_warehouse_inspections) into v4 QC (tests from field_values, inspections from result / 4-point).
-- 2b: trigger keeps mirroring new / changed rows (floor app + old Testing page still write the old table). A re-save supersedes the previous copy.
ALTER TABLE public.mm_qc_tests ADD COLUMN IF NOT EXISTS legacy_inspection_id uuid;

INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, stage_code, fabric_type_id, field_values, result,
                                origin, tested_at, remarks, created_by, legacy_inspection_id)
SELECT w.factory_id, CASE WHEN w.in_challan_id IS NOT NULL THEN 'in_challan' ELSE 'rolls' END, w.in_challan_id, 'warehouse',
       r.stage_code, COALESCE(u.fabric_type_id, r.fabric_type_id),
       w.field_values || CASE WHEN w.field_values ? 'width' OR NULLIF(w.field_values->>'inspected_width_in','') IS NULL THEN '{}'::jsonb
                              ELSE jsonb_build_object('width', w.field_values->>'inspected_width_in') END,
       CASE w.result WHEN 'fail' THEN 'fail' WHEN 'hold' THEN 'hold' ELSE 'pass' END,
       'migrated', COALESCE(w.inspected_at, w.created_at), 'Copied from warehouse testing', w.inspected_by, w.id
FROM public.mm_warehouse_inspections w
JOIN public.mm_stock_units u ON u.id = w.stock_unit_id
JOIN public.mm_rolls r ON r.id = u.roll_id
WHERE w.field_values IS NOT NULL AND w.field_values <> '{}'::jsonb AND w.result IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.mm_qc_tests t WHERE t.legacy_inspection_id = w.id);

INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test)
SELECT t.factory_id, t.id, u.roll_id, COALESCE(r.process_round, 0)
FROM public.mm_qc_tests t
JOIN public.mm_warehouse_inspections w ON w.id = t.legacy_inspection_id
JOIN public.mm_stock_units u ON u.id = w.stock_unit_id
JOIN public.mm_rolls r ON r.id = u.roll_id
WHERE NOT EXISTS (SELECT 1 FROM public.mm_qc_test_rolls x WHERE x.test_id = t.id);

INSERT INTO public.mm_qc_inspections (factory_id, roll_id, round_at_inspection, site_side, stage_code, inspected_length, length_uom,
  cuttable_width, width_uom, pts_1, pts_2, pts_3, pts_4, total_points, points_per_100_sqyd, threshold_used, result_computed,
  result_override, override_reason, result, origin, legacy_inspection_id, inspected_at, remarks, created_by)
SELECT w.factory_id, u.roll_id, COALESCE(r.process_round, 0), 'warehouse', r.stage_code, w.inspected_length, 'm',
       w.cuttable_width, COALESCE(CASE WHEN w.width_uom IN ('in','cm') THEN w.width_uom END, 'in'),
       w.pts_1, w.pts_2, w.pts_3, w.pts_4, w.total_points, w.points_per_100_sqyd, w.threshold_used,
       CASE WHEN w.result_computed IN ('pass','fail') THEN w.result_computed END,
       CASE WHEN w.result_override IN ('pass','fail') THEN w.result_override END, w.override_reason,
       w.result, 'migrated', w.id, COALESCE(w.inspected_at, w.created_at), 'Copied from warehouse testing', w.inspected_by
FROM public.mm_warehouse_inspections w
JOIN public.mm_stock_units u ON u.id = w.stock_unit_id
JOIN public.mm_rolls r ON r.id = u.roll_id
WHERE w.result IN ('pass','fail')
  AND NOT EXISTS (SELECT 1 FROM public.mm_qc_inspections q WHERE q.legacy_inspection_id = w.id);
