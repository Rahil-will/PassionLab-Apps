-- Remove garment-dyeing stage (PFGD) from fabric masters.
-- Fabric stages track fabric roll lifecycle only.

UPDATE public.mm_fabric_stages
SET is_active = false
WHERE code = 'PFGD'
  AND is_active IS DISTINCT FROM false;

-- Drop PFGD from required_at_stages on test fields.
UPDATE public.mm_type_test_fields
SET required_at_stages = array_remove(required_at_stages, 'PFGD')
WHERE 'PFGD' = ANY (required_at_stages);

CREATE OR REPLACE FUNCTION public._mm_v4_seed_masters(p_factory uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cut_stages text[] := ARRAY['DYED','PRINTED','FINISHED'];
BEGIN
  INSERT INTO public.mm_fabric_stages (factory_id, code, label, seq, can_cut, is_initial) VALUES
    (p_factory, 'GREIGE',   'Greige',                         10, false, true),
    (p_factory, 'RFD',      'RFD (ready for dyeing)',         20, false, false),
    (p_factory, 'PFD',      'PFD (prepared for dyeing)',      30, false, false),
    (p_factory, 'DYED',     'Dyed',                           50, true,  false),
    (p_factory, 'PRINTED',  'Printed',                        60, true,  false),
    (p_factory, 'FINISHED', 'Finished',                       70, true,  false)
  ON CONFLICT (factory_id, code) DO NOTHING;

  -- Keep existing PFGD rows inactive if present from older seeds.
  UPDATE public.mm_fabric_stages
  SET is_active = false
  WHERE factory_id = p_factory AND code = 'PFGD';

  INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name)
  VALUES (p_factory, 'mill', 'internal', 'MILL-1', 'In-house mill'),
         (p_factory, 'warehouse', 'internal', 'WH-1', 'Fabric warehouse')
  ON CONFLICT DO NOTHING;

  UPDATE public.mm_process_types SET output_stage_code = 'DYED', default_return_mode = 're_rolled',
         machine_kinds = ARRAY['jet_dyeing','softflow','jigger']
   WHERE factory_id = p_factory AND lower(name) = 'dyeing' AND output_stage_code IS NULL;
  UPDATE public.mm_process_types SET output_stage_code = 'PRINTED', machine_kinds = ARRAY['printing']
   WHERE factory_id = p_factory AND lower(name) = 'printing' AND output_stage_code IS NULL;
  UPDATE public.mm_process_types SET machine_kinds = ARRAY['washing']
   WHERE factory_id = p_factory AND lower(name) = 'washing' AND machine_kinds = '{}';

  INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code,
         default_return_mode, resets_testing, resets_inspection, machine_kinds)
  SELECT p_factory, v.name, v.so, true, v.stage, v.mode, v.rt, v.ri, v.mk
  FROM (VALUES
    ('Scouring & Bleaching', 5, 'RFD',      're_rolled',  true, true,  ARRAY['jet_dyeing','softflow','jigger']),
    ('Finishing',            6, 'FINISHED', 'same_rolls', true, true,  ARRAY['stenter','compactor','raising']),
    ('Compacting',           7, NULL,       'same_rolls', true, false, ARRAY['compactor'])
  ) AS v(name, so, stage, mode, rt, ri, mk)
  WHERE NOT EXISTS (SELECT 1 FROM public.mm_process_types t
                    WHERE t.factory_id = p_factory AND lower(t.name) = lower(v.name));

  UPDATE public.mm_type_test_fields SET required_at_stages = v_cut_stages
   WHERE factory_id = p_factory AND is_active AND required_at_stages = '{}';

  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (p_factory, 'fabric_v4', false) ON CONFLICT DO NOTHING;
END $$;
