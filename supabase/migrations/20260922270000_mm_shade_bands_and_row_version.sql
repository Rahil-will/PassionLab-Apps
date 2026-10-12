-- Warehouse shade bands and optimistic concurrency.
-- Cutting and store-challan create do not refuse a lay or a dispatch
-- when a shade band is missing or mixed. Mill shade stays the declared value.
-- Live bodies were read with pg_get_functiondef before these edits.

ALTER TABLE public.mm_fabric_types
  ADD COLUMN IF NOT EXISTS requires_shade_band boolean NOT NULL DEFAULT false;

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS shade_band text,
  ADD COLUMN IF NOT EXISTS shade_band_by uuid,
  ADD COLUMN IF NOT EXISTS shade_band_at timestamptz;

CREATE OR REPLACE FUNCTION public.mm_set_shade_bands(p_assignments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_item jsonb;
  v_id uuid;
  v_band text;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  IF jsonb_typeof(COALESCE(p_assignments, 'null'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('INVALID', 'Assignments must be a list');
  END IF;
  IF jsonb_array_length(p_assignments) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to assign a shade band');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignments)
  LOOP
    BEGIN
      v_id := NULLIF(trim(COALESCE(v_item->>'unit_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each assignment needs a roll');
    END IF;
    v_band := NULLIF(upper(trim(COALESCE(v_item->>'band', ''))), '');
    IF v_band IS NOT NULL AND v_band !~ '^[A-Z0-9]([A-Z0-9-]{0,15})$' THEN
      RETURN public._mm_err('INVALID', 'Shade band must be a short code such as A or B');
    END IF;

    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'Roll not found');
    END IF;
    IF v_unit.style_material_id IS NULL THEN
      RETURN public._mm_err('INVALID', 'Allocate the roll to a style before setting a shade band');
    END IF;
    IF v_unit.status NOT IN ('pending_qc', 'in_stock') THEN
      RETURN public._mm_err('INVALID', 'Shade band can be set while the roll is in stock or waiting for test');
    END IF;

    UPDATE public.mm_stock_units SET
      shade_band = v_band,
      shade_band_by = CASE WHEN v_band IS NULL THEN NULL ELSE v_actor END,
      shade_band_at = CASE WHEN v_band IS NULL THEN NULL ELSE now() END,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = v_actor
    WHERE id = v_unit.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('updated', v_n));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_set_shade_bands(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_set_shade_bands(jsonb) TO authenticated, service_role;

-- Read payloads. Anchors were counted on the live bodies before this migration.
DO $mm$
DECLARE
  v_def text;
  v_next text;
  v_hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_style_warehouse';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_style_warehouse missing';
  END IF;
  IF position('u.shade_band' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''shade'',\s*u\.shade,\s*''lot_no'',\s*u\.lot_no,',
      '''shade'', u.shade, ''shade_band'', u.shade_band, ''qty_available'', u.qty_available, ''lot_no'', u.lot_no,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'u.shade_band', ''))) / length('u.shade_band');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'style warehouse shade_band hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_store_challan';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_store_challan missing';
  END IF;
  IF position('u.shade_band' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''shade'',\s*u\.shade,\s*''lot_no'',\s*u\.lot_no,',
      '''shade'', u.shade, ''shade_band'', u.shade_band, ''lot_no'', u.lot_no,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'u.shade_band', ''))) / length('u.shade_band');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'store challan shade_band hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_warehouse_dispatch_board';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_warehouse_dispatch_board missing';
  END IF;
  IF position('u.is_remnant' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''lot_no'',\s*u\.lot_no,\s*''attributes'',\s*u\.attributes,',
      '''lot_no'', u.lot_no, ''is_remnant'', u.is_remnant, ''attributes'', u.attributes,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'u.is_remnant', ''))) / length('u.is_remnant');
    IF v_hits <> 2 THEN
      RAISE EXCEPTION 'dispatch remnant hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_rack_master';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_list_rack_master missing';
  END IF;
  IF position('loc.row_version' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''capacity_rolls'',\s*loc\.capacity_rolls,',
      '''capacity_rolls'', loc.capacity_rolls, ''row_version'', loc.row_version,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'loc.row_version', ''))) / length('loc.row_version');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'rack master row_version hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_mill_line';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_mill_line missing';
  END IF;
  IF position('b.row_version' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''remarks'',\s*b\.remarks,',
      '''remarks'', b.remarks, ''row_version'', b.row_version,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'b.row_version', ''))) / length('b.row_version');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'mill line row_version hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_unallocated_mill';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_unallocated_mill missing';
  END IF;
  IF position('b.row_version' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''remarks'',\s*b\.remarks,',
      '''remarks'', b.remarks, ''row_version'', b.row_version,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'b.row_version', ''))) / length('b.row_version');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'unallocated mill row_version hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;
END
$mm$;

-- mm_update_roll already compares row_version (code STALE_VERSION, null skips). Left unchanged.
-- mm_update_mill_batch incremented row_version and did not compare an incoming version.

DROP FUNCTION IF EXISTS public.mm_update_mill_batch(uuid, text, text, date, text, jsonb);

CREATE OR REPLACE FUNCTION public.mm_update_mill_batch(
  p_batch_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_rolls jsonb,
  p_row_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      updated_by = public._mm_actor_id()
    WHERE id = v_batch.id
      AND (p_row_version IS NULL OR row_version = p_row_version);
    IF NOT FOUND THEN
      RETURN public._mm_err('STALE', 'This batch was changed elsewhere. Reload and try again');
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
  END;

  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
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
        updated_by = public._mm_actor_id()
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

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_batch.id,
    'batch_no', v_no,
    'roll_count', v_n,
    'row_version', (SELECT b.row_version FROM public.mm_mill_batches b WHERE b.id = v_batch.id)
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer) TO authenticated, service_role;

-- mm_save_rack_location did not read row_version.

DROP FUNCTION IF EXISTS public.mm_save_rack_location(jsonb);

CREATE OR REPLACE FUNCTION public.mm_save_rack_location(p_row jsonb, p_row_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_id uuid;
  v_parent uuid;
  v_code text;
  v_name text;
  v_type text;
  v_pick boolean;
  v_parent_type text;
  v_capacity integer;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_id := NULLIF(p_row->>'id', '')::uuid;
  v_code := upper(NULLIF(trim(COALESCE(p_row->>'code', '')), ''));
  v_name := NULLIF(trim(COALESCE(p_row->>'name', '')), '');
  v_type := NULLIF(trim(COALESCE(p_row->>'location_type', '')), '');
  v_parent := COALESCE(NULLIF(p_row->>'parent_id', '')::uuid, v_wh);
  v_capacity := NULLIF(p_row->>'capacity_rolls', '')::integer;
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Name is required'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Location must be a zone, rack, or bin');
  END IF;
  IF v_capacity IS NOT NULL AND v_capacity < 0 THEN
    RETURN public._mm_err('INVALID', 'Capacity cannot be negative');
  END IF;
  IF v_code IS NULL THEN
    v_code := upper(left(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'), 24));
  END IF;
  IF v_parent IS DISTINCT FROM v_wh AND NOT public._mm_loc_is_under(v_parent, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Parent must be under the warehouse');
  END IF;
  SELECT location_type INTO v_parent_type FROM public.mm_locations WHERE id = v_parent AND factory_id = v_factory;
  IF v_type = 'zone' AND v_parent_type NOT IN ('store', 'zone') THEN
    RETURN public._mm_err('INVALID', 'A zone sits under the warehouse or another zone');
  END IF;
  IF v_type = 'rack' AND v_parent_type NOT IN ('store', 'zone') THEN
    RETURN public._mm_err('INVALID', 'A rack sits under the warehouse or a zone');
  END IF;
  IF v_type = 'bin' AND v_parent_type IS DISTINCT FROM 'rack' THEN
    RETURN public._mm_err('INVALID', 'A bin sits under a rack');
  END IF;
  v_pick := v_type IN ('rack', 'bin');
  IF v_id IS NULL THEN
    INSERT INTO public.mm_locations (
      factory_id, parent_id, code, name, location_type, is_pickable, capacity_rolls, is_active, created_by, updated_by
    ) VALUES (
      v_factory, v_parent, v_code, v_name, v_type, v_pick, v_capacity, true, public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id, row_version INTO v_id, v_rv;
  ELSE
    UPDATE public.mm_locations SET
      parent_id = v_parent, code = v_code, name = v_name, location_type = v_type,
      is_pickable = v_pick, capacity_rolls = v_capacity,
      row_version = row_version + 1,
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id AND factory_id = v_factory AND location_type IN ('zone', 'rack', 'bin')
      AND (p_row_version IS NULL OR row_version = p_row_version)
    RETURNING row_version INTO v_rv;
    IF NOT FOUND THEN
      IF p_row_version IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.mm_locations
        WHERE id = v_id AND factory_id = v_factory AND location_type IN ('zone', 'rack', 'bin')
      ) THEN
        RETURN public._mm_err('STALE', 'This location was changed elsewhere. Reload and try again');
      END IF;
      RETURN public._mm_err('NOT_FOUND', 'Location not found');
    END IF;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'code', v_code, 'row_version', v_rv));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE', 'That location code already exists');
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_save_rack_location(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_rack_location(jsonb, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
