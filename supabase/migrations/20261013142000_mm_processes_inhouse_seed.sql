-- In-house unit renamed; Knitting / Weaving processes from existing knitting / loom machines; default challan fields.
UPDATE public.mm_facilities SET name = 'In-house', updated_at = now()
WHERE kind = 'mill' AND ownership = 'internal' AND name = 'In-house mill';

INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, default_return_mode, resets_testing, resets_inspection,
                                     makes_fabric, done_inhouse, done_external, machine_kinds)
SELECT DISTINCT m.factory_id, CASE m.machine_kind WHEN 'loom' THEN 'Weaving' ELSE 'Knitting' END, 0, true, 'same_rolls', false, false,
       true, true, true, ARRAY[m.machine_kind]
FROM public.mm_machines m
WHERE m.machine_kind IN ('knitting', 'loom') AND m.process_type_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.mm_process_types t WHERE t.factory_id = m.factory_id
                  AND lower(t.name) = CASE m.machine_kind WHEN 'loom' THEN 'weaving' ELSE 'knitting' END);

UPDATE public.mm_process_types SET makes_fabric = true, done_inhouse = true
WHERE lower(name) IN ('knitting', 'weaving') AND NOT makes_fabric;

UPDATE public.mm_machines m SET process_type_id = t.id
FROM public.mm_process_types t
WHERE m.process_type_id IS NULL AND t.factory_id = m.factory_id
  AND lower(t.name) = CASE m.machine_kind WHEN 'loom' THEN 'weaving' WHEN 'knitting' THEN 'knitting' END;

UPDATE public.mm_process_types SET challan_fields = CASE
    WHEN lower(name) LIKE '%dye%' THEN '[{"key":"target_color","label":"Target colour","type":"text","required":false},{"key":"target_shade","label":"Target shade","type":"text","required":false}]'::jsonb
    WHEN lower(name) LIKE '%print%' THEN '[{"key":"design_ref","label":"Design ref","type":"text","required":false},{"key":"target_color","label":"Ground colour","type":"text","required":false}]'::jsonb
    WHEN lower(name) LIKE '%finish%' OR lower(name) LIKE '%compact%' THEN '[{"key":"target_gsm","label":"Target GSM","type":"number","required":false},{"key":"target_width","label":"Target width (in)","type":"number","required":false}]'::jsonb
  END
WHERE challan_fields = '[]'::jsonb
  AND (lower(name) LIKE '%dye%' OR lower(name) LIKE '%print%' OR lower(name) LIKE '%finish%' OR lower(name) LIKE '%compact%');
