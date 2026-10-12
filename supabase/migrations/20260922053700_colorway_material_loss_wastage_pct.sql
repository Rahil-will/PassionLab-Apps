ALTER TABLE public.colorway_materials
  ADD COLUMN IF NOT EXISTS process_loss_pct numeric,
  ADD COLUMN IF NOT EXISTS wastage_pct numeric;

COMMENT ON COLUMN public.colorway_materials.process_loss_pct IS
  'Optional process-loss percent added on top of cons × qty. Null/empty is not applied.';
COMMENT ON COLUMN public.colorway_materials.wastage_pct IS
  'Optional wastage percent added on top of cons × qty. Null/empty is not applied.';

CREATE OR REPLACE FUNCTION public._upsert_colorway_material(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid,
  p_mat jsonb,
  p_seq integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_kind text;
  v_category text;
  v_type text;
  v_placement text;
  v_unit text;
  v_cons numeric;
  v_total numeric;
  v_loss numeric;
  v_waste numeric;
  v_extras jsonb;
  v_src jsonb;
  v_factory_id uuid;
  v_order_id uuid;
BEGIN
  SELECT cw.factory_id, cw.order_id
    INTO v_factory_id, v_order_id
    FROM public.colorways cw
    WHERE cw.id = p_colorway_id;

  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'colorway % not found', p_colorway_id;
  END IF;
  IF v_factory_id IS DISTINCT FROM p_factory_id THEN
    RAISE EXCEPTION 'colorway factory mismatch';
  END IF;
  IF p_order_id IS NOT NULL AND v_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'colorway order mismatch';
  END IF;

  BEGIN
    v_id := NULLIF(trim(p_mat->>'id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;
  IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

  IF EXISTS (
    SELECT 1 FROM public.colorway_materials
    WHERE id = v_id
      AND (factory_id IS DISTINCT FROM v_factory_id OR colorway_id IS DISTINCT FROM p_colorway_id)
  ) THEN
    v_id := gen_random_uuid();
  END IF;

  v_src := CASE WHEN jsonb_typeof(p_mat->'extras') = 'object' THEN p_mat->'extras' ELSE '{}'::jsonb END;

  v_kind := CASE
    WHEN trim(COALESCE(p_mat->>'kind', '')) IN ('Fabric', 'Trim') THEN trim(p_mat->>'kind')
    WHEN trim(COALESCE(p_mat->>'category', '')) IN ('Fabric', 'Trim') THEN trim(p_mat->>'category')
    ELSE 'Fabric'
  END;

  v_category := CASE
    WHEN trim(COALESCE(p_mat->>'kind', '')) IN ('Fabric', 'Trim')
      THEN COALESCE(p_mat->>'category', '')
    WHEN v_kind = 'Trim' THEN COALESCE(
      NULLIF(p_mat->>'trimCategory', ''),
      NULLIF(v_src->>'trimCategory', ''),
      ''
    )
    ELSE COALESCE(
      NULLIF(p_mat->>'fabricCategory', ''),
      NULLIF(v_src->>'fabricCategory', ''),
      ''
    )
  END;

  v_type := COALESCE(
    NULLIF(trim(p_mat->>'type'), ''),
    CASE WHEN v_kind = 'Trim' THEN NULLIF(trim(COALESCE(p_mat->>'trimType', v_src->>'trimType')), '') ELSE NULL END,
    ''
  );

  v_placement := CASE
    WHEN v_kind = 'Trim' THEN COALESCE(
      NULLIF(trim(p_mat->>'placement'), ''),
      NULLIF(trim(v_src->>'placement'), ''),
      ''
    )
    ELSE ''
  END;

  v_unit := COALESCE(
    NULLIF(trim(p_mat->>'unit'), ''),
    NULLIF(trim(v_src->>'unit'), ''),
    ''
  );

  v_cons := CASE
    WHEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc'))::numeric
    WHEN v_kind = 'Trim' AND (p_mat->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'perPc')::numeric
    WHEN v_kind = 'Fabric' AND (p_mat->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'avgCons')::numeric
    ELSE NULL
  END;

  v_total := CASE
    WHEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty'))::numeric
    ELSE NULL
  END;

  v_loss := CASE
    WHEN (COALESCE(p_mat->>'processLossPct', p_mat->>'process_loss_pct')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN NULLIF((COALESCE(p_mat->>'processLossPct', p_mat->>'process_loss_pct'))::numeric, 0)
    ELSE NULL
  END;

  v_waste := CASE
    WHEN (COALESCE(p_mat->>'wastagePct', p_mat->>'wastage_pct')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN NULLIF((COALESCE(p_mat->>'wastagePct', p_mat->>'wastage_pct'))::numeric, 0)
    ELSE NULL
  END;

  v_extras := jsonb_strip_nulls(jsonb_build_object(
    'paramValues', CASE
      WHEN jsonb_typeof(v_src->'paramValues') = 'object' AND v_src->'paramValues' <> '{}'::jsonb
        THEN v_src->'paramValues'
      WHEN jsonb_typeof(p_mat->'paramValues') = 'object' AND p_mat->'paramValues' <> '{}'::jsonb
        THEN p_mat->'paramValues'
      ELSE NULL
    END
  ));

  INSERT INTO public.colorway_materials (
    id, factory_id, order_id, colorway_id, seq,
    kind, category, name, type, placement, unit, cons_per_pc, total_cons,
    process_loss_pct, wastage_pct, extras, updated_at
  ) VALUES (
    v_id, v_factory_id, v_order_id, p_colorway_id, COALESCE(p_seq, 0),
    v_kind,
    COALESCE(v_category, ''),
    COALESCE(p_mat->>'name', ''),
    v_type,
    v_placement,
    v_unit,
    v_cons,
    v_total,
    v_loss,
    v_waste,
    COALESCE(v_extras, '{}'::jsonb),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    factory_id = EXCLUDED.factory_id,
    order_id = EXCLUDED.order_id,
    colorway_id = EXCLUDED.colorway_id,
    seq = EXCLUDED.seq,
    kind = EXCLUDED.kind,
    category = EXCLUDED.category,
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    placement = EXCLUDED.placement,
    unit = EXCLUDED.unit,
    cons_per_pc = EXCLUDED.cons_per_pc,
    total_cons = EXCLUDED.total_cons,
    process_loss_pct = EXCLUDED.process_loss_pct,
    wastage_pct = EXCLUDED.wastage_pct,
    extras = EXCLUDED.extras,
    updated_at = now();

  RETURN v_id;
END;
$fn$;
;
