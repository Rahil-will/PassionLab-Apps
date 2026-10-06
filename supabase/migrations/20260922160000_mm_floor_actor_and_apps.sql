-- Floor material actor, clearance, vendor GRN, length confirm, lay consumption.
-- Live function bodies are rewritten from pg_get_functiondef inside this migration.

CREATE OR REPLACE FUNCTION public._mm_actor_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_set text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN auth.uid();
  END IF;
  IF auth.role() = 'service_role' THEN
    v_set := NULLIF(current_setting('mm.actor_user', true), '');
    IF v_set IS NOT NULL THEN
      RETURN v_set::uuid;
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_actor_factory_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_set text;
  v_actor uuid;
  v_profile uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN public.current_factory_id();
  END IF;
  IF auth.role() = 'service_role' THEN
    v_actor := public._mm_actor_id();
    v_set := NULLIF(current_setting('mm.actor_factory', true), '');
    IF v_actor IS NOT NULL AND v_set IS NOT NULL THEN
      SELECT p.factory_id INTO v_profile
      FROM public.profiles p
      WHERE p.id = v_actor;
      IF v_profile IS NOT NULL AND v_profile = v_set::uuid THEN
        RETURN v_profile;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_actor_factory_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_actor_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mm_actor_factory_id() TO authenticated, service_role;

-- Replace auth.uid() in live mm bodies so floor service-role calls record the floor user.
DO $sweep$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'mm\_%' OR p.proname LIKE '\_mm\_%')
      AND p.proname NOT IN ('_mm_actor_id', '_mm_actor_factory_id')
      AND pg_get_functiondef(p.oid) LIKE '%auth.uid()%'
  LOOP
    def := replace(pg_get_functiondef(r.oid), 'auth.uid()', 'public._mm_actor_id()');
    EXECUTE def;
  END LOOP;
END;
$sweep$;

CREATE OR REPLACE FUNCTION public._mm_require_ops(p_key text DEFAULT 'mm_roll_entry')
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_apps jsonb;
BEGIN
  PERFORM public.assert_module_enabled('material');
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;
  IF public.is_factory_admin() THEN
    RETURN v_factory;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.factory_id = v_factory
      AND p.user_role IN ('admin', 'superadmin')
  ) THEN
    RETURN v_factory;
  END IF;
  SELECT COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_apps
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.factory_id = v_factory;
  IF v_apps IS NULL OR NOT (
    v_apps @> to_jsonb(ARRAY[p_key])
    OR v_apps @> '["mm_inventory"]'::jsonb
    OR v_apps @> '["mm_roll_entry"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  RETURN v_factory;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_require_config()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_apps jsonb;
BEGIN
  PERFORM public.assert_module_enabled('material');
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;
  IF public.is_factory_admin() THEN
    RETURN v_factory;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.factory_id = v_factory
      AND p.user_role IN ('admin', 'superadmin')
  ) THEN
    RETURN v_factory;
  END IF;
  SELECT COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_apps
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.factory_id = v_factory;
  IF v_apps IS NULL OR NOT (v_apps @> '["mm_config"]'::jsonb) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  RETURN v_factory;
END;
$fn$;

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS declared_width_in numeric,
  ADD COLUMN IF NOT EXISTS is_remnant boolean NOT NULL DEFAULT false;

ALTER TABLE public.mm_in_challans
  ADD COLUMN IF NOT EXISTS invoice_ref text,
  ADD COLUMN IF NOT EXISTS grn_no text;

CREATE UNIQUE INDEX IF NOT EXISTS mm_in_challans_factory_grn_no_uidx
  ON public.mm_in_challans (factory_id, grn_no)
  WHERE grn_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mm_doc_sequences (
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  next_no integer NOT NULL DEFAULT 0,
  PRIMARY KEY (factory_id, doc_type),
  CONSTRAINT mm_doc_sequences_next_chk CHECK (next_no >= 0)
);

ALTER TABLE public.mm_doc_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mm_doc_sequences_factory ON public.mm_doc_sequences;
CREATE POLICY mm_doc_sequences_factory ON public.mm_doc_sequences
  FOR ALL TO authenticated
  USING (factory_id = public.current_factory_id())
  WITH CHECK (factory_id = public.current_factory_id());

CREATE TABLE IF NOT EXISTS public.mm_lay_unit_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  cutting_lay_id uuid NOT NULL REFERENCES public.cutting_lays (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  movement_line_id uuid,
  seq integer NOT NULL DEFAULT 1,
  plies integer,
  opening_qty numeric NOT NULL,
  closing_qty numeric NOT NULL,
  consumed_qty numeric GENERATED ALWAYS AS (opening_qty - closing_qty) STORED,
  used_qty numeric,
  shortage_qty numeric,
  end_bit_action text NOT NULL DEFAULT 'none',
  recorded_by uuid REFERENCES public.profiles (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_lay_unit_consumptions_end_bit_chk CHECK (
    end_bit_action = ANY (ARRAY['none', 'waste', 'return', 'continue'])
  ),
  CONSTRAINT mm_lay_unit_consumptions_lay_unit_uidx UNIQUE (cutting_lay_id, stock_unit_id),
  CONSTRAINT mm_lay_unit_consumptions_row_version_chk CHECK (row_version >= 1),
  CONSTRAINT mm_lay_unit_consumptions_closing_chk CHECK (closing_qty <= opening_qty)
);

ALTER TABLE public.mm_lay_unit_consumptions
  ADD COLUMN IF NOT EXISTS used_qty numeric,
  ADD COLUMN IF NOT EXISTS shortage_qty numeric;

ALTER TABLE public.mm_lay_unit_consumptions DROP CONSTRAINT IF EXISTS mm_lay_unit_consumptions_end_bit_chk;
ALTER TABLE public.mm_lay_unit_consumptions
  ADD CONSTRAINT mm_lay_unit_consumptions_end_bit_chk CHECK (
    end_bit_action = ANY (ARRAY['none', 'waste', 'return', 'continue'])
  );

ALTER TABLE public.mm_lay_unit_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mm_lay_unit_consumptions_factory ON public.mm_lay_unit_consumptions;
CREATE POLICY mm_lay_unit_consumptions_factory ON public.mm_lay_unit_consumptions
  FOR ALL TO authenticated
  USING (factory_id = public.current_factory_id())
  WITH CHECK (factory_id = public.current_factory_id());

CREATE OR REPLACE FUNCTION public._mm_unit_on_hand(p_unit public.mm_stock_units)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_available'
  ) THEN
    RETURN NULLIF(to_jsonb(p_unit)->>'qty_available', '')::numeric;
  END IF;
  RETURN p_unit.length_m;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_set_on_hand(p_unit_id uuid, p_qty numeric, p_received boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE public.mm_stock_units
  SET length_m = p_qty,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit_id;

  IF p_received AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_received'
  ) THEN
    EXECUTE 'UPDATE public.mm_stock_units SET qty_received = $1 WHERE id = $2'
      USING p_qty, p_unit_id;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_unit_on_hold(p_unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hold boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'on_hold'
  ) THEN
    EXECUTE 'SELECT COALESCE(on_hold, false) FROM public.mm_stock_units WHERE id = $1'
      INTO v_hold USING p_unit_id;
  END IF;
  RETURN COALESCE(v_hold, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_unit_clearance(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_unit public.mm_stock_units%ROWTYPE;
  v_block text;
  v_tested boolean;
  v_inspected boolean := false;
  v_result text;
  v_hold boolean;
  v_cleared boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = p_unit_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tested', false, 'inspected', false, 'inspection_result', NULL,
      'cleared', false, 'blocking_reason', 'Roll not found'
    );
  END IF;

  v_block := public._mm_cutting_param_block(v_unit);
  v_tested := v_block IS NULL;
  SELECT (i.result IS NOT NULL), i.result
    INTO v_inspected, v_result
  FROM public.mm_warehouse_inspections i
  WHERE i.stock_unit_id = v_unit.id
  ORDER BY i.inspected_at DESC NULLS LAST
  LIMIT 1;
  v_inspected := COALESCE(v_inspected, false);
  v_hold := public._mm_unit_on_hold(v_unit.id);

  IF v_hold THEN
    v_reason := 'On hold';
  ELSIF v_result = 'fail' THEN
    v_reason := 'Inspection failed';
  ELSIF v_unit.source = 'vendor' THEN
    v_cleared := v_tested AND v_inspected AND v_result = 'pass';
    IF NOT v_cleared THEN
      v_reason := 'Vendor roll needs testing and a passing inspection';
    END IF;
  ELSE
    v_cleared := v_tested;
    IF NOT v_tested THEN
      v_reason := COALESCE(v_block, 'Testing required');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'tested', v_tested,
    'inspected', v_inspected,
    'inspection_result', v_result,
    'cleared', v_cleared,
    'blocking_reason', v_reason
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_apply_clearance(p_unit_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_clear jsonb;
BEGIN
  IF p_unit_ids IS NULL THEN
    RETURN;
  END IF;
  FOREACH v_id IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_unit.status IS DISTINCT FROM 'pending_qc' THEN
      CONTINUE;
    END IF;
    v_clear := public._mm_unit_clearance(v_id);
    IF COALESCE(v_clear->>'cleared', 'false') = 'true' THEN
      UPDATE public.mm_stock_units
      SET status = 'in_stock',
          updated_at = now(),
          updated_by = public._mm_actor_id()
      WHERE id = v_id;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_unit_clearance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_apply_clearance(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_unit_clearance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mm_apply_clearance(uuid[]) TO authenticated, service_role;

DO $patch$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_save_warehouse_inspections';
  IF def IS NOT NULL AND def NOT LIKE '%_mm_apply_clearance%' THEN
    def := replace(
      def,
      'v_new_status := CASE WHEN v_result = ''pass'' THEN ''in_stock'' ELSE ''rejected'' END;',
      'v_new_status := CASE WHEN v_result = ''fail'' THEN ''rejected'' ELSE v_unit.status END;'
    );
    def := replace(
      def,
      'v_new_loc := CASE WHEN v_result = ''pass'' THEN v_recv ELSE v_red END;',
      'v_new_loc := CASE WHEN v_result = ''fail'' THEN v_red ELSE v_unit.current_location_id END;'
    );
    def := replace(
      def,
      'RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''saved'', v_n));',
      'PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id)); RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''saved'', v_n));'
    );
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_receive_mill_in_challan';
  IF def IS NOT NULL AND def NOT LIKE '%_mm_apply_clearance%' THEN
    def := replace(
      def,
      'RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''status'', ''received''));',
      'PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id)); RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''status'', ''received''));'
    );
    EXECUTE def;
  END IF;
END;
$patch$;
