-- Unallocated stock: nullable style, fabric_type_id + color_ref, ALLOCATE/UNALLOCATE ledger,
-- fabric-type trigger. Mill writes stamp fabric_type_id. Dispatch rejects mixed null/style.

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS fabric_type_id uuid REFERENCES public.mm_fabric_types (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS color_ref text;

ALTER TABLE public.mm_mill_rolls
  ADD COLUMN IF NOT EXISTS fabric_type_id uuid REFERENCES public.mm_fabric_types (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS color_ref text;

ALTER TABLE public.mm_mill_batches
  ADD COLUMN IF NOT EXISTS fabric_type_id uuid REFERENCES public.mm_fabric_types (id) ON DELETE RESTRICT;

UPDATE public.mm_stock_units u
SET fabric_type_id = sm.fabric_type_id
FROM public.mm_style_materials sm
WHERE sm.id = u.style_material_id AND u.fabric_type_id IS NULL;

UPDATE public.mm_mill_rolls r
SET fabric_type_id = sm.fabric_type_id
FROM public.mm_style_materials sm
WHERE sm.id = r.style_material_id AND r.fabric_type_id IS NULL;

UPDATE public.mm_mill_batches b
SET fabric_type_id = sm.fabric_type_id
FROM public.mm_style_materials sm
WHERE sm.id = b.style_material_id AND b.fabric_type_id IS NULL;

ALTER TABLE public.mm_stock_units ALTER COLUMN fabric_type_id SET NOT NULL;
ALTER TABLE public.mm_mill_rolls ALTER COLUMN fabric_type_id SET NOT NULL;
ALTER TABLE public.mm_mill_batches ALTER COLUMN fabric_type_id SET NOT NULL;

ALTER TABLE public.mm_stock_units ALTER COLUMN style_material_id DROP NOT NULL;
ALTER TABLE public.mm_in_challans ALTER COLUMN style_material_id DROP NOT NULL;
ALTER TABLE public.mm_mill_rolls ALTER COLUMN style_material_id DROP NOT NULL;
ALTER TABLE public.mm_mill_batches ALTER COLUMN style_material_id DROP NOT NULL;

ALTER TABLE public.mm_mill_batches
  DROP CONSTRAINT IF EXISTS mm_mill_batches_factory_line_no_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mm_mill_batches_style_batch_uidx
  ON public.mm_mill_batches (factory_id, style_material_id, batch_no)
  WHERE style_material_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mm_mill_batches_unalloc_batch_uidx
  ON public.mm_mill_batches (factory_id, fabric_type_id, batch_no)
  WHERE style_material_id IS NULL;

CREATE INDEX IF NOT EXISTS mm_stock_units_unalloc_idx
  ON public.mm_stock_units (factory_id)
  WHERE style_material_id IS NULL;

ALTER TABLE public.mm_stock_ledger DROP CONSTRAINT IF EXISTS mm_stock_ledger_entry_type_chk;
ALTER TABLE public.mm_stock_ledger
  ADD CONSTRAINT mm_stock_ledger_entry_type_chk CHECK (
    entry_type = ANY (ARRAY[
      'RECEIPT_IN'::text, 'INHOUSE_IN'::text, 'QC_DEDUCT'::text, 'QC_REJECT'::text,
      'PUTAWAY'::text, 'TRANSFER'::text, 'HOLD'::text, 'RELEASE'::text,
      'ISSUE_TO_CUTTING'::text, 'ISSUE_TO_DEPT'::text, 'CONSUME'::text, 'WASTE'::text,
      'RETURN_FROM_CUTTING'::text, 'RETURN_FROM_DEPT'::text,
      'ADJUST_PLUS'::text, 'ADJUST_MINUS'::text,
      'RETURN_TO_SUPPLIER'::text, 'WRITE_OFF'::text, 'REVERSAL'::text,
      'ALLOCATE'::text, 'UNALLOCATE'::text
    ])
  );

CREATE OR REPLACE FUNCTION public.mm_fabric_type_matches_style()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_ft uuid;
BEGIN
  IF NEW.fabric_type_id IS NULL THEN
    RAISE EXCEPTION 'Fabric type is required';
  END IF;
  IF NEW.style_material_id IS NOT NULL THEN
    SELECT fabric_type_id INTO v_ft
    FROM public.mm_style_materials
    WHERE id = NEW.style_material_id;
    IF v_ft IS NULL THEN
      RAISE EXCEPTION 'Style fabric was not found';
    END IF;
    IF NEW.fabric_type_id IS DISTINCT FROM v_ft THEN
      RAISE EXCEPTION 'Fabric type must match the style fabric';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_stock_units_fabric_type_trg ON public.mm_stock_units;
CREATE TRIGGER mm_stock_units_fabric_type_trg
  BEFORE INSERT OR UPDATE OF fabric_type_id, style_material_id
  ON public.mm_stock_units
  FOR EACH ROW EXECUTE FUNCTION public.mm_fabric_type_matches_style();

DROP TRIGGER IF EXISTS mm_mill_rolls_fabric_type_trg ON public.mm_mill_rolls;
CREATE TRIGGER mm_mill_rolls_fabric_type_trg
  BEFORE INSERT OR UPDATE OF fabric_type_id, style_material_id
  ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public.mm_fabric_type_matches_style();

DROP TRIGGER IF EXISTS mm_mill_batches_fabric_type_trg ON public.mm_mill_batches;
CREATE TRIGGER mm_mill_batches_fabric_type_trg
  BEFORE INSERT OR UPDATE OF fabric_type_id, style_material_id
  ON public.mm_mill_batches
  FOR EACH ROW EXECUTE FUNCTION public.mm_fabric_type_matches_style();

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
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_mill_batch(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid,
  p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ft uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, v_sm_id, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), auth.uid(), auth.uid()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, v_sm_id, v_batch, v_mill, p_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_update_mill_batch(
  p_batch_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_no text;
  v_date date;
  v_mill uuid;
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_color text;
  v_attrs jsonb;
  v_new jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_roll public.mm_mill_rolls%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  IF p_batch_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Mill batch is required');
  END IF;
  SELECT * INTO v_batch
  FROM public.mm_mill_batches
  WHERE id = p_batch_id AND factory_id = v_factory;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Mill batch not found');
  END IF;

  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, v_batch.production_date, CURRENT_DATE);

  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;

  BEGIN
    UPDATE public.mm_mill_batches SET
      batch_no = v_no,
      mill_ref = NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      production_date = v_date,
      remarks = NULLIF(trim(COALESCE(p_remarks, '')), ''),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_batch.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
  END;

  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN
      RETURN public._mm_err('INVALID', 'Each roll needs quantity greater than 0');
    END IF;
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each roll needs a roll number');
    END IF;
    v_id := NULL;
    BEGIN
      v_id := NULLIF(trim(COALESCE(v_row->>'id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN
      v_new := v_new || jsonb_build_array(v_row);
      CONTINUE;
    END IF;

    SELECT * INTO v_roll
    FROM public.mm_mill_rolls
    WHERE id = v_id AND factory_id = v_factory AND mill_batch_id = v_batch.id;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'A roll on this batch was not found');
    END IF;
    IF v_roll.in_challan_id IS NOT NULL OR v_roll.status IS DISTINCT FROM 'draft' THEN
      CONTINUE;
    END IF;

    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;

    BEGIN
      UPDATE public.mm_mill_rolls SET
        unit_code = v_code,
        length_m = v_len,
        weight_kg = v_wt,
        shade = v_shade,
        lot_no = v_lot,
        color_ref = v_color,
        attributes = v_attrs,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_roll.id;
    EXCEPTION WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'Roll ' || v_code || ' already exists in this batch');
    END;
    v_n := v_n + 1;
  END LOOP;

  IF jsonb_array_length(v_new) > 0 THEN
    BEGIN
      v_n := v_n + public._mm_insert_mill_batch_rolls(v_factory, v_batch.style_material_id, v_batch.id, v_mill, v_new);
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
    END;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('id', v_batch.id, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_insert_rolls(
  p_factory uuid, p_sm uuid, p_challan uuid, p_source text,
  p_status text, p_loc uuid, p_rolls jsonb, p_freeze boolean
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
  v_sm_ft uuid;
  v_attrs jsonb;
  v_snap jsonb;
  v_n integer := 0;
BEGIN
  IF p_source IS DISTINCT FROM 'vendor' THEN
    RAISE EXCEPTION 'Only vendor GRNs may insert new inbound rolls';
  END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;
  IF p_sm IS NOT NULL THEN
    SELECT fabric_type_id INTO v_sm_ft FROM public.mm_style_materials WHERE id = p_sm;
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');
    v_ft := COALESCE(v_sm_ft, NULLIF(trim(COALESCE(v_row->>'fabric_type_id', '')), '')::uuid);
    IF v_ft IS NULL THEN RAISE EXCEPTION 'Fabric type is required'; END IF;
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    v_code := public.next_doc_no('ROLL');
    IF p_freeze THEN
      v_snap := jsonb_build_object(
        'length_m', v_len, 'weight_kg', v_wt, 'shade', v_shade, 'lot_no', v_lot,
        'color_ref', v_color, 'attributes', v_attrs
      );
    ELSE
      v_snap := NULL;
    END IF;
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, in_challan_id, source,
      uom, length_m, weight_kg, shade, lot_no, color_ref, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, v_ft, p_challan, p_source,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'),
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, v_snap, p_status, p_loc, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (p_factory, p_challan, v_id, auth.uid());
    PERFORM public._mm_ledger(
      p_factory, v_id, 'RECEIPT_IN',
      v_len, NULL, p_status, NULL, p_loc, 'mm_in_challans', p_challan, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_dispatch_mill_rolls(
  p_unit_ids uuid[],
  p_challan_no text,
  p_reference_no text DEFAULT NULL,
  p_to_location text DEFAULT 'Warehouse',
  p_sent_at date DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm uuid;
  v_ft uuid;
  v_ch uuid;
  v_no text;
  v_ref text;
  v_to text;
  v_uid uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_n integer := 0;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_mill uuid;
  v_uom text;
  v_stock uuid;
  v_snap jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  v_no := NULLIF(trim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Enter a challan number');
  END IF;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to dispatch');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');
  v_to := COALESCE(NULLIF(trim(COALESCE(p_to_location, '')), ''), 'Warehouse');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;
    IF v_sm IS NULL AND v_ft IS NULL THEN
      v_sm := v_roll.style_material_id;
      v_ft := v_roll.fabric_type_id;
    END IF;
    IF (v_roll.style_material_id IS NULL) IS DISTINCT FROM (v_sm IS NULL) THEN
      RETURN public._mm_err('INVALID', 'Select either unallocated rolls or rolls from the same style, not both');
    END IF;
    IF v_roll.style_material_id IS DISTINCT FROM v_sm THEN
      RETURN public._mm_err('INVALID', 'Select rolls from the same style, color, and fabric');
    END IF;
    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Select rolls of the same fabric type');
    END IF;
  END LOOP;

  IF v_sm IS NOT NULL AND public._mm_mill_short_closed(v_sm) THEN
    RETURN public._mm_err('CLOSED', 'This fabric is short closed. Cancel short close to dispatch.');
  END IF;

  SELECT COALESCE(
    (
      SELECT NULLIF(trim(u.uom), '')
      FROM public.mm_stock_units u
      WHERE (v_sm IS NOT NULL AND u.style_material_id = v_sm)
         OR (v_sm IS NULL AND u.fabric_type_id = v_ft)
      ORDER BY u.created_at
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(cm.unit), '')
      FROM public.mm_style_materials sm
      JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.id = v_sm
      LIMIT 1
    ),
    'm'
  ) INTO v_uom;

  BEGIN
    INSERT INTO public.mm_in_challans (
      factory_id, challan_no, source, style_material_id, status, sent_at, sent_by,
      remarks, reference_no, to_location, created_by, updated_by
    ) VALUES (
      v_factory, v_no, 'mill', v_sm, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      auth.uid(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      v_to,
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_ch;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_uid;
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = v_roll.mill_batch_id;
    v_snap := jsonb_build_object(
      'length_m', v_roll.length_m,
      'weight_kg', v_roll.weight_kg,
      'shade', v_roll.shade,
      'lot_no', v_roll.lot_no,
      'color_ref', v_roll.color_ref,
      'attributes', v_roll.attributes,
      'mill_batch_id', v_roll.mill_batch_id,
      'batch_no', v_batch.batch_no,
      'mill_ref', v_batch.mill_ref,
      'production_date', v_batch.production_date
    );
    BEGIN
      INSERT INTO public.mm_stock_units (
        factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, mill_batch_id, mill_roll_id,
        in_challan_id, source, uom, length_m, weight_kg, shade, lot_no, color_ref, attributes,
        mill_snapshot, status, current_location_id, created_by, updated_by
      ) VALUES (
        v_factory, v_roll.unit_code, 'roll', v_roll.style_material_id, v_roll.fabric_type_id,
        v_roll.mill_batch_id, v_roll.id,
        v_ch, 'mill', v_uom, v_roll.length_m, v_roll.weight_kg, v_roll.shade, v_roll.lot_no, v_roll.color_ref,
        v_roll.attributes,
        v_snap, 'in_transit', v_mill, auth.uid(), auth.uid()
      ) RETURNING id INTO v_stock;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Roll % already exists in warehouse stock for this mill batch', v_roll.unit_code;
    END;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_ch, v_stock, auth.uid());
    UPDATE public.mm_mill_rolls SET
      status = 'dispatched',
      in_challan_id = v_ch,
      dispatched_at = now(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_roll.id AND status = 'draft' AND in_challan_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected roll is not waiting at the mill';
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_stock, 'TRANSFER', v_roll.length_m, 'draft', 'in_transit',
      v_mill, v_mill, 'mm_in_challans', v_ch, 'Mill dispatch'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;
