CREATE OR REPLACE FUNCTION public._mm_insert_mill_batch_rolls(
  p_factory uuid, p_sm uuid, p_batch uuid, p_loc uuid, p_rolls jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_attrs jsonb;
  v_uom text;
  v_n integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;
  SELECT COALESCE(
    (SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u WHERE u.style_material_id = p_sm ORDER BY u.created_at LIMIT 1),
    (SELECT NULLIF(trim(cm.unit), '') FROM public.mm_style_materials sm JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id WHERE sm.id = p_sm LIMIT 1),
    'm'
  ) INTO v_uom;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN RAISE EXCEPTION 'Each roll needs a roll number'; END IF;
    v_key := lower(v_code);
    IF v_key = ANY (v_seen) THEN RAISE EXCEPTION 'Roll % already exists in this batch', v_code; END IF;
    v_seen := array_append(v_seen, v_key);
    IF EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = p_factory AND u.mill_batch_id = p_batch AND lower(u.unit_code) = v_key) THEN
      RAISE EXCEPTION 'Roll % already exists in this batch', v_code;
    END IF;
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, mill_batch_id, source,
      uom, length_m, weight_kg, shade, lot_no, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, p_batch, 'mill', v_uom,
      v_len, v_wt, v_shade, v_lot, v_attrs, NULL, 'draft', p_loc, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    PERFORM public._mm_ledger(
      p_factory, v_id, 'INHOUSE_IN', v_len, NULL, 'draft', NULL, p_loc,
      'mm_mill_batches', p_batch, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;;
