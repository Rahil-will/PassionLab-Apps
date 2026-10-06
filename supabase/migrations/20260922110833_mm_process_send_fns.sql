CREATE OR REPLACE FUNCTION public._mm_mill_at_process(p_roll uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.mm_process_out_lines l
    WHERE l.mill_roll_id = p_roll
      AND l.line_status = 'out'
  );
$fn$;

CREATE OR REPLACE FUNCTION public._mm_process_refresh(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_open integer;
  v_closed integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE line_status = 'out'),
    count(*) FILTER (WHERE line_status <> 'out')
  INTO v_open, v_closed
  FROM public.mm_process_out_lines
  WHERE challan_id = p_id;

  UPDATE public.mm_process_challans
  SET status = CASE
        WHEN v_open = 0 THEN 'returned'
        WHEN v_closed > 0 THEN 'partial'
        ELSE 'open'
      END,
      returned_at = CASE WHEN v_open = 0 THEN COALESCE(returned_at, now()) ELSE NULL END,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_process_types()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'active', t.active,
      'sort_order', t.sort_order
    ) ORDER BY t.sort_order, t.name)
    FROM public.mm_process_types t
    WHERE t.factory_id = v_factory
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_process_vendors()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'active', v.active,
      'type_ids', COALESCE((
        SELECT jsonb_agg(vt.process_type_id ORDER BY t.sort_order, t.name)
        FROM public.mm_process_vendor_types vt
        JOIN public.mm_process_types t ON t.id = vt.process_type_id
        WHERE vt.vendor_id = v.id AND vt.factory_id = v_factory
      ), '[]'::jsonb)
    ) ORDER BY v.name)
    FROM public.mm_process_vendors v
    WHERE v.factory_id = v_factory
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_process_catalog(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_type jsonb;
  v_vendor jsonb;
  v_key text;
  v_name text;
  v_id uuid;
  v_map jsonb := '{}'::jsonb;
  v_type_key text;
  v_type_id uuid;
  v_names text[] := ARRAY[]::text[];
  v_vnames text[] := ARRAY[]::text[];
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN public._mm_err('REQUIRED', 'Process setup is required');
  END IF;

  FOR v_type IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'types', '[]'::jsonb))
  LOOP
    v_key := NULLIF(btrim(v_type->>'key'), '');
    v_name := NULLIF(btrim(v_type->>'name'), '');
    IF v_key IS NULL OR v_name IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each process type needs a name');
    END IF;
    IF v_map ? v_key OR lower(v_name) = ANY (v_names) THEN
      RETURN public._mm_err('DUPLICATE', 'Process type names must be unique');
    END IF;
    v_names := v_names || lower(v_name);
    IF EXISTS (
      SELECT 1 FROM public.mm_process_types t
      WHERE t.factory_id = v_factory
        AND lower(btrim(t.name)) = lower(v_name)
        AND t.id IS DISTINCT FROM NULLIF(v_type->>'id', '')::uuid
    ) THEN
      RETURN public._mm_err('DUPLICATE', 'A process type with that name already exists');
    END IF;
    v_map := v_map || jsonb_build_object(v_key, COALESCE(NULLIF(v_type->>'id', ''), v_key));
  END LOOP;

  FOR v_vendor IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'vendors', '[]'::jsonb))
  LOOP
    v_name := NULLIF(btrim(v_vendor->>'name'), '');
    IF v_name IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each process vendor needs a name');
    END IF;
    IF lower(v_name) = ANY (v_vnames) THEN
      RETURN public._mm_err('DUPLICATE', 'Process vendor names must be unique');
    END IF;
    v_vnames := v_vnames || lower(v_name);
    IF EXISTS (
      SELECT 1 FROM public.mm_process_vendors v
      WHERE v.factory_id = v_factory
        AND lower(btrim(v.name)) = lower(v_name)
        AND v.id IS DISTINCT FROM NULLIF(v_vendor->>'id', '')::uuid
    ) THEN
      RETURN public._mm_err('DUPLICATE', 'A process vendor with that name already exists');
    END IF;
    FOR v_type_key IN SELECT jsonb_array_elements_text(COALESCE(v_vendor->'type_keys', '[]'::jsonb))
    LOOP
      IF NOT (v_map ? v_type_key) THEN
        RETURN public._mm_err('INVALID', 'Pick a process type that belongs to this factory');
      END IF;
    END LOOP;
  END LOOP;

  v_map := '{}'::jsonb;
  FOR v_type IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'types', '[]'::jsonb))
  LOOP
    v_key := btrim(v_type->>'key');
    v_name := btrim(v_type->>'name');
    v_id := NULLIF(v_type->>'id', '')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, created_by, updated_by)
      VALUES (v_factory, v_name, COALESCE((v_type->>'sort_order')::integer, 0), COALESCE((v_type->>'active')::boolean, true), v_actor, v_actor)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.mm_process_types
      SET name = v_name,
          sort_order = COALESCE((v_type->>'sort_order')::integer, sort_order),
          active = COALESCE((v_type->>'active')::boolean, active),
          updated_at = now(),
          updated_by = v_actor
      WHERE id = v_id AND factory_id = v_factory;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
      END IF;
    END IF;
    v_map := v_map || jsonb_build_object(v_key, v_id);
  END LOOP;

  FOR v_vendor IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'vendors', '[]'::jsonb))
  LOOP
    v_name := btrim(v_vendor->>'name');
    v_id := NULLIF(v_vendor->>'id', '')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.mm_process_vendors (factory_id, name, active, created_by, updated_by)
      VALUES (v_factory, v_name, COALESCE((v_vendor->>'active')::boolean, true), v_actor, v_actor)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.mm_process_vendors
      SET name = v_name,
          active = COALESCE((v_vendor->>'active')::boolean, active),
          updated_at = now(),
          updated_by = v_actor
      WHERE id = v_id AND factory_id = v_factory;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND';
      END IF;
    END IF;

    DELETE FROM public.mm_process_vendor_types
    WHERE vendor_id = v_id AND factory_id = v_factory;

    FOR v_type_key IN SELECT jsonb_array_elements_text(COALESCE(v_vendor->'type_keys', '[]'::jsonb))
    LOOP
      v_type_id := (v_map->>v_type_key)::uuid;
      INSERT INTO public.mm_process_vendor_types (factory_id, vendor_id, process_type_id)
      VALUES (v_factory, v_id, v_type_id);
    END LOOP;
  END LOOP;

  RETURN public._mm_ok('{}'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_send_to_process(
  p_origin text,
  p_vendor_id uuid,
  p_type_id uuid,
  p_ids uuid[],
  p_challan_no text,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_no text;
  v_vendor public.mm_process_vendors%ROWTYPE;
  v_type public.mm_process_types%ROWTYPE;
  v_ch uuid;
  v_id uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_qty numeric;
  v_uom text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();

  IF p_origin IS DISTINCT FROM 'mill' AND p_origin IS DISTINCT FROM 'warehouse' THEN
    RETURN public._mm_err('INVALID', 'Send from the mill or the warehouse');
  END IF;
  v_no := NULLIF(btrim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Enter a challan number');
  END IF;
  IF p_ids IS NULL OR COALESCE(array_length(p_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mm_process_challans c
    WHERE c.factory_id = v_factory AND lower(btrim(c.challan_no)) = lower(v_no)
  ) THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number is already used');
  END IF;

  SELECT * INTO v_vendor
  FROM public.mm_process_vendors
  WHERE id = p_vendor_id AND factory_id = v_factory;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Process vendor was not found');
  END IF;
  IF NOT v_vendor.active THEN
    RETURN public._mm_err('INACTIVE', 'That process vendor is inactive');
  END IF;

  SELECT * INTO v_type
  FROM public.mm_process_types
  WHERE id = p_type_id AND factory_id = v_factory;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Process type was not found');
  END IF;
  IF NOT v_type.active THEN
    RETURN public._mm_err('INACTIVE', 'That process type is inactive');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_process_vendor_types vt
    WHERE vt.vendor_id = v_vendor.id AND vt.process_type_id = v_type.id AND vt.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('INVALID', 'That vendor does not do this process');
  END IF;

  IF p_origin = 'mill' THEN
    FOREACH v_id IN ARRAY p_ids LOOP
      SELECT * INTO v_roll FROM public.mm_mill_rolls
      WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
      IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
        RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
      END IF;
      IF public._mm_mill_at_process(v_roll.id) THEN
        RETURN public._mm_err('AT_PROCESS', 'A selected roll is already at a process vendor');
      END IF;
      IF COALESCE(v_roll.length_m, 0) <= 0 THEN
        RETURN public._mm_err('INVALID', 'A selected roll has no qty');
      END IF;
    END LOOP;
  ELSE
    FOREACH v_id IN ARRAY p_ids LOOP
      SELECT * INTO v_unit FROM public.mm_stock_units
      WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
      IF v_unit.status NOT IN ('in_stock', 'pending_qc') THEN
        RETURN public._mm_err('INVALID', 'Only warehouse rolls that are still here can be sent');
      END IF;
      IF v_unit.on_hold THEN
        RETURN public._mm_err('HOLD', 'Release the hold before sending this roll');
      END IF;
      IF COALESCE(v_unit.qty_available, 0) <= 0 THEN
        RETURN public._mm_err('INVALID', 'A selected roll has no qty on hand');
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.mm_process_out_lines l
        WHERE l.stock_unit_id = v_unit.id AND l.line_status = 'out'
      ) THEN
        RETURN public._mm_err('AT_PROCESS', 'A selected roll is already at a process vendor');
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.mm_process_challans (
    factory_id, challan_no, origin, vendor_id, process_type_id, remarks, created_by, updated_by
  ) VALUES (
    v_factory, v_no, p_origin, v_vendor.id, v_type.id, NULLIF(btrim(COALESCE(p_remarks, '')), ''), v_actor, v_actor
  ) RETURNING id INTO v_ch;

  IF p_origin = 'mill' THEN
    FOREACH v_id IN ARRAY p_ids LOOP
      SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_id AND factory_id = v_factory;
      INSERT INTO public.mm_process_out_lines (
        factory_id, challan_id, mill_roll_id, unit_code, qty, uom, shade, lot_no, color_ref
      ) VALUES (
        v_factory, v_ch, v_roll.id, v_roll.unit_code, v_roll.length_m, 'm', v_roll.shade, v_roll.lot_no, v_roll.color_ref
      );
    END LOOP;
  ELSE
    PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
    FOREACH v_id IN ARRAY p_ids LOOP
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
      v_qty := v_unit.qty_available;
      v_uom := COALESCE(v_unit.qty_uom, v_unit.uom, 'm');
      INSERT INTO public.mm_process_out_lines (
        factory_id, challan_id, stock_unit_id, unit_code, qty, uom, shade, lot_no, color_ref
      ) VALUES (
        v_factory, v_ch, v_unit.id, v_unit.unit_code, v_qty, v_uom, v_unit.shade, v_unit.lot_no, v_unit.color_ref
      );
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'TRANSFER', 0, v_unit.status, 'at_process',
        v_unit.current_location_id, NULL, 'mm_process_challans', v_ch, 'sent to process'
      );
      UPDATE public.mm_stock_units
      SET status = 'at_process',
          current_location_id = NULL,
          updated_at = now(),
          updated_by = v_actor,
          row_version = row_version + 1
      WHERE id = v_unit.id;
    END LOOP;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_mill_at_process(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_mill_at_process(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_process_refresh(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_process_refresh(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_list_process_types() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_list_process_vendors() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_save_process_catalog(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_send_to_process(text, uuid, uuid, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_list_process_types() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_process_vendors() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_process_catalog(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_send_to_process(text, uuid, uuid, uuid[], text, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
;
