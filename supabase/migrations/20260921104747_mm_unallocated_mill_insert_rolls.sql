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
  v_color text;
  v_ft uuid;
  v_attrs jsonb;
  v_n integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  SELECT fabric_type_id INTO v_ft FROM public.mm_mill_batches WHERE id = p_batch;
  IF v_ft IS NULL THEN RAISE EXCEPTION 'Fabric type is required'; END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN RAISE EXCEPTION 'Each roll needs a roll number'; END IF;
    v_key := lower(v_code);
    IF v_key = ANY (v_seen) THEN RAISE EXCEPTION 'Roll % already exists in this batch', v_code; END IF;
    v_seen := array_append(v_seen, v_key);
    IF EXISTS (
      SELECT 1 FROM public.mm_mill_rolls r
      WHERE r.factory_id = p_factory AND r.mill_batch_id = p_batch AND lower(r.unit_code) = v_key
    ) THEN
      RAISE EXCEPTION 'Roll % already exists in this batch', v_code;
    END IF;
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    INSERT INTO public.mm_mill_rolls (
      factory_id, mill_batch_id, style_material_id, fabric_type_id, unit_code,
      length_m, weight_kg, shade, lot_no, color_ref, attributes, status,
      created_by, updated_by
    ) VALUES (
      p_factory, p_batch, p_sm, v_ft, v_code,
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, 'draft',
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;;
