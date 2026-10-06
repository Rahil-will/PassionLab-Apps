-- Process send. Greige can leave the mill or the warehouse for dyeing, printing,
-- or any other process, then come back. Shade bands are a later phase.
-- Recorded as mm_process_send_schema, mm_process_send_fns, mm_process_send_return,
-- and mm_process_send_guards.
-- mm_process_send is an empty row from a failed apply attempt. Do not delete it.

ALTER TABLE public.mm_mill_rolls DROP CONSTRAINT mm_mill_rolls_status_chk;
ALTER TABLE public.mm_mill_rolls
  ADD CONSTRAINT mm_mill_rolls_status_chk
  CHECK (status = ANY (ARRAY['draft'::text, 'dispatched'::text, 'processed'::text]));

ALTER TABLE public.mm_mill_rolls
  ADD COLUMN parent_mill_roll_id uuid REFERENCES public.mm_mill_rolls(id);

ALTER TABLE public.mm_stock_units DROP CONSTRAINT mm_stock_units_status_chk;
ALTER TABLE public.mm_stock_units
  ADD CONSTRAINT mm_stock_units_status_chk
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'in_transit'::text, 'pending_qc'::text, 'in_stock'::text,
    'rejected'::text, 'issued'::text, 'consumed'::text, 'returned_to_supplier'::text,
    'missing'::text, 'written_off'::text, 'at_process'::text
  ]));

ALTER TABLE public.mm_stock_units
  ADD COLUMN parent_stock_unit_id uuid REFERENCES public.mm_stock_units(id);

CREATE TABLE public.mm_process_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX mm_process_types_name_uidx
  ON public.mm_process_types (factory_id, lower(btrim(name)));

CREATE TABLE public.mm_process_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX mm_process_vendors_name_uidx
  ON public.mm_process_vendors (factory_id, lower(btrim(name)));

CREATE TABLE public.mm_process_vendor_types (
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.mm_process_vendors(id) ON DELETE CASCADE,
  process_type_id uuid NOT NULL REFERENCES public.mm_process_types(id) ON DELETE RESTRICT,
  PRIMARY KEY (vendor_id, process_type_id)
);

CREATE TABLE public.mm_process_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_no text NOT NULL,
  origin text NOT NULL CHECK (origin = ANY (ARRAY['mill'::text, 'warehouse'::text])),
  vendor_id uuid NOT NULL REFERENCES public.mm_process_vendors(id) ON DELETE RESTRICT,
  process_type_id uuid NOT NULL REFERENCES public.mm_process_types(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open'::text, 'partial'::text, 'returned'::text])),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  returned_at timestamptz
);

CREATE UNIQUE INDEX mm_process_challans_no_uidx
  ON public.mm_process_challans (factory_id, lower(btrim(challan_no)));

CREATE TABLE public.mm_process_out_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.mm_process_challans(id) ON DELETE CASCADE,
  mill_roll_id uuid REFERENCES public.mm_mill_rolls(id),
  stock_unit_id uuid REFERENCES public.mm_stock_units(id),
  unit_code text NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  uom text NOT NULL,
  shade text,
  lot_no text,
  color_ref text,
  line_status text NOT NULL DEFAULT 'out' CHECK (line_status = ANY (ARRAY['out'::text, 'returned'::text, 'replaced'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(mill_roll_id, stock_unit_id) = 1)
);

CREATE UNIQUE INDEX mm_process_out_open_mill_uidx
  ON public.mm_process_out_lines (mill_roll_id)
  WHERE line_status = 'out' AND mill_roll_id IS NOT NULL;

CREATE UNIQUE INDEX mm_process_out_open_stock_uidx
  ON public.mm_process_out_lines (stock_unit_id)
  WHERE line_status = 'out' AND stock_unit_id IS NOT NULL;

CREATE TABLE public.mm_process_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.mm_process_challans(id) ON DELETE CASCADE,
  out_line_id uuid NOT NULL REFERENCES public.mm_process_out_lines(id) ON DELETE RESTRICT,
  same_identity boolean NOT NULL,
  unit_code text NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  uom text NOT NULL,
  shade text,
  color_ref text,
  lot_no text,
  mill_roll_id uuid REFERENCES public.mm_mill_rolls(id),
  stock_unit_id uuid REFERENCES public.mm_stock_units(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

SELECT public._mm_lockdown_table('public.mm_process_types'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_vendors'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_vendor_types'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_challans'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_out_lines'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_return_lines'::regclass);

INSERT INTO public.mm_process_types (factory_id, name, sort_order, active)
SELECT f.factory_id, t.name, t.ord, true
FROM (
  SELECT DISTINCT factory_id
  FROM public.factory_modules
  WHERE module_key = 'material' AND enabled
) f
CROSS JOIN (
  VALUES ('Dyeing', 1), ('Printing', 2), ('Washing', 3), ('Embroidery', 4)
) AS t(name, ord)
ON CONFLICT (factory_id, lower(btrim(name))) DO NOTHING;

CREATE OR REPLACE FUNCTION public._mm_counts_as_received(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $fn$
  SELECT p_status IN ('pending_qc', 'in_stock', 'rejected', 'issued', 'consumed', 'at_process');
$fn$;

CREATE OR REPLACE FUNCTION public.mm_stock_unit_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $fn$
DECLARE
  v_type text;
BEGIN
  IF NEW.current_location_id IS NULL THEN
    v_type := NULL;
  ELSE
    SELECT location_type INTO v_type
    FROM public.mm_locations
    WHERE id = NEW.current_location_id;
  END IF;

  IF NEW.status IN ('draft', 'in_transit')
     AND NOT (NEW.current_location_id IS NULL OR v_type = 'virtual') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'pending_qc' AND v_type IS DISTINCT FROM 'receiving' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'in_stock' AND COALESCE(v_type, '') NOT IN ('receiving', 'rack', 'bin') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'rejected' AND v_type IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'issued' AND v_type IS DISTINCT FROM 'cutting' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'at_process' AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status IN ('consumed', 'returned_to_supplier', 'missing', 'written_off')
        AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  END IF;
  RETURN NEW;
END;
$fn$;

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

CREATE OR REPLACE FUNCTION public.mm_receive_process_return(p_id uuid, p_rolls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_ch public.mm_process_challans%ROWTYPE;
  v_elem jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_line_id uuid;
  v_same boolean;
  v_code text;
  v_qty numeric;
  v_shade text;
  v_color text;
  v_lot text;
  v_line public.mm_process_out_lines%ROWTYPE;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_child uuid;
  v_recv uuid;
  v_delta numeric;
  v_codes text[] := ARRAY[]::text[];
  v_row jsonb;
  v_grp record;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();

  IF p_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A process challan is required');
  END IF;
  IF p_rolls IS NULL OR jsonb_typeof(p_rolls) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Enter the rolls that came back');
  END IF;

  SELECT * INTO v_ch
  FROM public.mm_process_challans
  WHERE id = p_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Process challan was not found');
  END IF;
  IF v_ch.status = 'returned' THEN
    RETURN public._mm_err('CLOSED', 'This challan is already closed');
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_rolls)
  LOOP
    BEGIN
      v_line_id := NULLIF(v_elem->>'source_line_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A return row is missing its sent roll');
    END;
    v_same := COALESCE((v_elem->>'same')::boolean, false);
    v_code := NULLIF(btrim(v_elem->>'unit_code'), '');
    BEGIN
      v_qty := (v_elem->>'qty')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'Qty must be a number');
    END;
    v_shade := NULLIF(btrim(v_elem->>'shade'), '');
    v_color := NULLIF(btrim(v_elem->>'color_ref'), '');
    v_lot := NULLIF(btrim(v_elem->>'lot_no'), '');
    IF v_line_id IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each return row needs the sent roll');
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RETURN public._mm_err('INVALID', 'Return qty must be greater than zero');
    END IF;
    IF NOT v_same AND v_code IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'A new roll needs a roll number');
    END IF;
    IF NOT v_same THEN
      IF lower(v_code) = ANY (v_codes) THEN
        RETURN public._mm_err('DUPLICATE', 'Return roll numbers must be unique');
      END IF;
      v_codes := v_codes || lower(v_code);
    END IF;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'line_id', v_line_id,
      'same', v_same,
      'unit_code', v_code,
      'qty', v_qty,
      'shade', v_shade,
      'color_ref', v_color,
      'lot_no', v_lot
    ));
  END LOOP;

  FOR v_grp IN
    SELECT line_id, count(*) AS n, bool_or(same) AS any_same, bool_or(NOT same) AS any_new
    FROM jsonb_to_recordset(v_clean) AS x(line_id uuid, same boolean)
    GROUP BY line_id
  LOOP
    IF v_grp.any_same AND v_grp.n > 1 THEN
      RETURN public._mm_err('INVALID', 'A sent roll cannot come back as itself and as a new roll');
    END IF;
    SELECT * INTO v_line
    FROM public.mm_process_out_lines
    WHERE id = v_grp.line_id AND challan_id = v_ch.id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'A sent roll was not found on this challan');
    END IF;
    IF v_line.line_status <> 'out' THEN
      RETURN public._mm_err('INVALID', 'That roll is already back');
    END IF;
    IF v_grp.any_new THEN
      FOR v_row IN
        SELECT value FROM jsonb_array_elements(v_clean) value
        WHERE (value->>'line_id')::uuid = v_grp.line_id
      LOOP
        v_code := v_row->>'unit_code';
        IF v_ch.origin = 'mill' THEN
          SELECT * INTO v_roll FROM public.mm_mill_rolls
          WHERE id = v_line.mill_roll_id AND factory_id = v_factory;
          IF EXISTS (
            SELECT 1 FROM public.mm_mill_rolls r
            WHERE r.factory_id = v_factory
              AND r.mill_batch_id = v_roll.mill_batch_id
              AND lower(r.unit_code) = lower(v_code)
          ) THEN
            RETURN public._mm_err('DUPLICATE', 'That roll number is already used in this batch');
          END IF;
        ELSE
          SELECT * INTO v_unit FROM public.mm_stock_units
          WHERE id = v_line.stock_unit_id AND factory_id = v_factory;
          IF v_unit.mill_batch_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory
              AND u.mill_batch_id = v_unit.mill_batch_id
              AND lower(u.unit_code) = lower(v_code)
          ) THEN
            RETURN public._mm_err('DUPLICATE', 'That roll number is already used in this batch');
          END IF;
          IF v_unit.mill_batch_id IS NULL AND EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory
              AND u.mill_batch_id IS NULL
              AND u.unit_code = v_code
          ) THEN
            RETURN public._mm_err('DUPLICATE', 'That roll number is already used');
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF v_ch.origin = 'warehouse' THEN
    PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
    v_recv := public._mm_recv_loc(v_factory);
    IF v_recv IS NULL THEN
      RAISE EXCEPTION 'RECEIVING_MISSING';
    END IF;
  END IF;

  FOR v_grp IN
    SELECT line_id, bool_or(same) AS any_same
    FROM jsonb_to_recordset(v_clean) AS x(line_id uuid, same boolean)
    GROUP BY line_id
  LOOP
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_grp.line_id;
    IF v_grp.any_same THEN
      SELECT value INTO v_row FROM jsonb_array_elements(v_clean) value
      WHERE (value->>'line_id')::uuid = v_grp.line_id
      LIMIT 1;
      v_qty := (v_row->>'qty')::numeric;
      v_shade := NULLIF(v_row->>'shade', '');
      v_color := NULLIF(v_row->>'color_ref', '');
      v_lot := NULLIF(v_row->>'lot_no', '');
      IF v_ch.origin = 'mill' THEN
        UPDATE public.mm_mill_rolls
        SET length_m = v_qty,
            shade = v_shade,
            color_ref = v_color,
            lot_no = v_lot,
            updated_at = now(),
            updated_by = v_actor,
            row_version = row_version + 1
        WHERE id = v_line.mill_roll_id AND factory_id = v_factory;
        v_code := v_line.unit_code;
        v_child := v_line.mill_roll_id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units
        WHERE id = v_line.stock_unit_id AND factory_id = v_factory
        FOR UPDATE;
        v_delta := v_qty - public._mm_unit_qty_received(v_unit);
        IF v_delta < -0.001 THEN
          PERFORM public._mm_ledger(
            v_factory, v_unit.id, 'QC_DEDUCT', -v_delta, v_unit.status, 'pending_qc',
            NULL, v_recv, 'mm_process_challans', v_ch.id, 'process return'
          );
          PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
        ELSIF v_delta > 0.001 THEN
          PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
          PERFORM public._mm_ledger(
            v_factory, v_unit.id, 'ADJUST_PLUS', v_delta, v_unit.status, 'pending_qc',
            NULL, v_recv, 'mm_process_challans', v_ch.id, 'process return'
          );
        END IF;
        UPDATE public.mm_stock_units
        SET status = 'pending_qc',
            current_location_id = v_recv,
            shade = v_shade,
            color_ref = v_color,
            lot_no = v_lot,
            length_m = v_qty,
            qc_result = NULL,
            updated_at = now(),
            updated_by = v_actor,
            row_version = row_version + 1
        WHERE id = v_unit.id;
        IF abs(v_delta) <= 0.001 THEN
          PERFORM public._mm_ledger(
            v_factory, v_unit.id, 'TRANSFER', 0, 'at_process', 'pending_qc',
            NULL, v_recv, 'mm_process_challans', v_ch.id, 'process return'
          );
        END IF;
        v_code := v_unit.unit_code;
        v_child := v_unit.id;
      END IF;
      UPDATE public.mm_process_out_lines SET line_status = 'returned' WHERE id = v_line.id;
      INSERT INTO public.mm_process_return_lines (
        factory_id, challan_id, out_line_id, same_identity, unit_code, qty, uom,
        shade, color_ref, lot_no, mill_roll_id, stock_unit_id, created_by
      ) VALUES (
        v_factory, v_ch.id, v_line.id, true, v_code, v_qty, v_line.uom,
        v_shade, v_color, v_lot,
        CASE WHEN v_ch.origin = 'mill' THEN v_child ELSE NULL END,
        CASE WHEN v_ch.origin = 'warehouse' THEN v_child ELSE NULL END,
        v_actor
      );
    ELSE
      IF v_ch.origin = 'mill' THEN
        UPDATE public.mm_mill_rolls
        SET status = 'processed',
            updated_at = now(),
            updated_by = v_actor,
            row_version = row_version + 1
        WHERE id = v_line.mill_roll_id AND factory_id = v_factory;
        SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units
        WHERE id = v_line.stock_unit_id AND factory_id = v_factory
        FOR UPDATE;
        IF COALESCE(v_unit.qty_available, 0) > 0 THEN
          PERFORM public._mm_ledger(
            v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off',
            NULL, NULL, 'mm_process_challans', v_ch.id, 're-rolled at process'
          );
        END IF;
        UPDATE public.mm_stock_units
        SET status = 'written_off',
            current_location_id = NULL,
            updated_at = now(),
            updated_by = v_actor,
            row_version = row_version + 1
        WHERE id = v_unit.id;
      END IF;

      FOR v_row IN
        SELECT value FROM jsonb_array_elements(v_clean) value
        WHERE (value->>'line_id')::uuid = v_grp.line_id
      LOOP
        v_code := v_row->>'unit_code';
        v_qty := (v_row->>'qty')::numeric;
        v_shade := NULLIF(v_row->>'shade', '');
        v_color := NULLIF(v_row->>'color_ref', '');
        v_lot := NULLIF(v_row->>'lot_no', '');
        IF v_ch.origin = 'mill' THEN
          INSERT INTO public.mm_mill_rolls (
            factory_id, mill_batch_id, style_material_id, unit_code, length_m, shade, lot_no,
            color_ref, attributes, status, fabric_type_id, parent_mill_roll_id, created_by, updated_by
          ) VALUES (
            v_factory, v_roll.mill_batch_id, v_roll.style_material_id, v_code, v_qty, v_shade, v_lot,
            v_color, COALESCE(v_roll.attributes, '{}'::jsonb), 'draft', v_roll.fabric_type_id, v_roll.id, v_actor, v_actor
          ) RETURNING id INTO v_child;
          INSERT INTO public.mm_process_return_lines (
            factory_id, challan_id, out_line_id, same_identity, unit_code, qty, uom,
            shade, color_ref, lot_no, mill_roll_id, created_by
          ) VALUES (
            v_factory, v_ch.id, v_line.id, false, v_code, v_qty, v_line.uom,
            v_shade, v_color, v_lot, v_child, v_actor
          );
        ELSE
          INSERT INTO public.mm_stock_units (
            factory_id, unit_code, unit_kind, style_material_id, source, uom, qty_uom,
            length_m, shade, lot_no, color_ref, attributes, mill_snapshot, status,
            current_location_id, fabric_type_id, mill_batch_id, mill_roll_id, declared_width_in,
            qty_declared, qty_received, qty_available, parent_stock_unit_id, created_by, updated_by
          ) VALUES (
            v_factory, v_code, v_unit.unit_kind, v_unit.style_material_id, v_unit.source,
            v_unit.uom, COALESCE(v_unit.qty_uom, v_unit.uom),
            v_qty, v_shade, v_lot, v_color, COALESCE(v_unit.attributes, '{}'::jsonb), v_unit.mill_snapshot,
            'pending_qc', v_recv, v_unit.fabric_type_id, v_unit.mill_batch_id, v_unit.mill_roll_id,
            v_unit.declared_width_in, v_qty, v_qty, 0, v_unit.id, v_actor, v_actor
          ) RETURNING id INTO v_child;
          PERFORM public._mm_ledger(
            v_factory, v_child, 'RECEIPT_IN', v_qty, 'pending_qc', 'pending_qc',
            v_recv, v_recv, 'mm_process_challans', v_ch.id, 'process return'
          );
          INSERT INTO public.mm_process_return_lines (
            factory_id, challan_id, out_line_id, same_identity, unit_code, qty, uom,
            shade, color_ref, lot_no, stock_unit_id, created_by
          ) VALUES (
            v_factory, v_ch.id, v_line.id, false, v_code, v_qty, v_line.uom,
            v_shade, v_color, v_lot, v_child, v_actor
          );
        END IF;
      END LOOP;
      UPDATE public.mm_process_out_lines SET line_status = 'replaced' WHERE id = v_line.id;
    END IF;
  END LOOP;

  PERFORM public._mm_process_refresh(v_ch.id);
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_process_challans()
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
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT
        c.id,
        c.challan_no,
        c.origin,
        c.status,
        v.name AS vendor_name,
        t.name AS process_name,
        c.created_at,
        (SELECT count(*)::int FROM public.mm_process_out_lines l WHERE l.challan_id = c.id) AS roll_count,
        (SELECT COALESCE(sum(l.qty), 0) FROM public.mm_process_out_lines l WHERE l.challan_id = c.id) AS qty,
        (SELECT count(*)::int FROM public.mm_process_out_lines l WHERE l.challan_id = c.id AND l.line_status = 'out') AS still_out
      FROM public.mm_process_challans c
      JOIN public.mm_process_vendors v ON v.id = c.vendor_id AND v.factory_id = v_factory
      JOIN public.mm_process_types t ON t.id = c.process_type_id AND t.factory_id = v_factory
      WHERE c.factory_id = v_factory
      ORDER BY c.created_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_process_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_process_challans%ROWTYPE;
  v_vendor text;
  v_process text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A process challan is required');
  END IF;

  SELECT * INTO v_ch
  FROM public.mm_process_challans
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Process challan was not found');
  END IF;

  SELECT v.name INTO v_vendor
  FROM public.mm_process_vendors v
  WHERE v.id = v_ch.vendor_id AND v.factory_id = v_factory;
  SELECT t.name INTO v_process
  FROM public.mm_process_types t
  WHERE t.id = v_ch.process_type_id AND t.factory_id = v_factory;

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_ch.id,
    'challan_no', v_ch.challan_no,
    'origin', v_ch.origin,
    'status', v_ch.status,
    'vendor_name', v_vendor,
    'process_name', v_process,
    'remarks', v_ch.remarks,
    'created_at', v_ch.created_at,
    'returned_at', v_ch.returned_at,
    'out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'unit_code', l.unit_code,
        'qty', l.qty,
        'uom', l.uom,
        'shade', l.shade,
        'lot_no', l.lot_no,
        'color_ref', l.color_ref,
        'line_status', l.line_status,
        'style_name', NULLIF(btrim(o.style_name), '')
      ) ORDER BY l.unit_code)
      FROM public.mm_process_out_lines l
      LEFT JOIN public.mm_mill_rolls mr ON mr.id = l.mill_roll_id AND mr.factory_id = v_factory
      LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id AND su.factory_id = v_factory
      LEFT JOIN public.mm_style_materials sm ON sm.id = COALESCE(mr.style_material_id, su.style_material_id) AND sm.factory_id = v_factory
      LEFT JOIN public.style_orders o ON o.id = sm.order_id AND o.factory_id = v_factory
      WHERE l.challan_id = v_ch.id AND l.factory_id = v_factory
    ), '[]'::jsonb),
    'back', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'out_line_id', r.out_line_id,
        'same_identity', r.same_identity,
        'unit_code', r.unit_code,
        'qty', r.qty,
        'uom', r.uom,
        'shade', r.shade,
        'color_ref', r.color_ref,
        'lot_no', r.lot_no
      ) ORDER BY r.created_at, r.unit_code)
      FROM public.mm_process_return_lines r
      WHERE r.challan_id = v_ch.id AND r.factory_id = v_factory
    ), '[]'::jsonb)
  ));
END;
$fn$;

DO $patch$
DECLARE
  v_src text;
  v_next text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_dispatch_mill_rolls(uuid[],text,text,text,date,text)'::regprocedure);
  v_needle := $n$    IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'dispatch guard hits %', v_hits;
  END IF;
  v_next := replace(v_src, v_needle, v_needle || $n$
    IF public._mm_mill_at_process(v_roll.id) THEN
      RETURN public._mm_err('AT_PROCESS', 'A selected roll is at a process vendor');
    END IF;$n$);
  EXECUTE v_next;

  v_src := pg_get_functiondef('public.mm_list_mill_stock(text,text,text,integer,integer)'::regprocedure);
  v_needle := $n$OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL)$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 2 THEN
    RAISE EXCEPTION 'mill place hits %', v_hits;
  END IF;
  v_next := replace(
    v_src,
    v_needle,
    $n$OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) OR (v_place = 'at_process' AND public._mm_mill_at_process(r.id))$n$
  );
  v_needle := $n$WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'mill case hits %', v_hits;
  END IF;
  v_next := replace(
    v_next,
    v_needle,
    $n$WHEN public._mm_mill_at_process(r.id) THEN 'at_process' WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'$n$
  );
  v_needle := $n$'place', CASE$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'mill place field hits %', v_hits;
  END IF;
  v_next := replace(
    v_next,
    v_needle,
    $n$'process_challan_id', (
            SELECT l.challan_id FROM public.mm_process_out_lines l
            WHERE l.mill_roll_id = r.id AND l.line_status = 'out'
            LIMIT 1
          ), 'place', CASE$n$
  );
  EXECUTE v_next;
END;
$patch$;

REVOKE ALL ON FUNCTION public._mm_mill_at_process(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_mill_at_process(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_process_refresh(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_process_refresh(uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.mm_list_process_types() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_list_process_vendors() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_save_process_catalog(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_send_to_process(text, uuid, uuid, uuid[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_receive_process_return(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_list_process_challans() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_process_challan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_list_process_types() FROM anon;
REVOKE ALL ON FUNCTION public.mm_list_process_vendors() FROM anon;
REVOKE ALL ON FUNCTION public.mm_save_process_catalog(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mm_send_to_process(text, uuid, uuid, uuid[], text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mm_receive_process_return(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mm_list_process_challans() FROM anon;
REVOKE ALL ON FUNCTION public.mm_get_process_challan(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.mm_list_process_types() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_process_vendors() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_process_catalog(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_send_to_process(text, uuid, uuid, uuid[], text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_receive_process_return(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_process_challans() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_process_challan(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
