ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_by uuid,
  ADD COLUMN IF NOT EXISTS hold_at timestamptz;

ALTER TABLE public.mm_warehouse_inspections
  ADD COLUMN IF NOT EXISTS deviation_approved_by uuid,
  ADD COLUMN IF NOT EXISTS deviation_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS deviation_reason text,
  ADD COLUMN IF NOT EXISTS deviation_reference text;

CREATE TABLE IF NOT EXISTS public.mm_supplier_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  return_no text NOT NULL,
  supplier_name text,
  reason text NOT NULL,
  debit_note_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (factory_id, return_no)
);

CREATE TABLE IF NOT EXISTS public.mm_supplier_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  return_id uuid NOT NULL REFERENCES public.mm_supplier_returns(id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units(id),
  qty numeric(12,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_id, stock_unit_id)
);

ALTER TABLE public.mm_supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mm_supplier_return_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_supplier_returns_factory ON public.mm_supplier_returns;
DROP POLICY IF EXISTS mm_supplier_return_lines_factory ON public.mm_supplier_return_lines;
CREATE POLICY mm_supplier_returns_factory ON public.mm_supplier_returns FOR ALL
  USING (factory_id = public.current_factory_id()) WITH CHECK (factory_id = public.current_factory_id());
CREATE POLICY mm_supplier_return_lines_factory ON public.mm_supplier_return_lines FOR ALL
  USING (factory_id = public.current_factory_id()) WITH CHECK (factory_id = public.current_factory_id());

CREATE OR REPLACE FUNCTION public.mm_exclude_roll(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  UPDATE public.mm_stock_units
  SET on_hold = true,
      hold_reason = 'excluded at inspection',
      hold_by = public._mm_actor_id(),
      hold_at = now(),
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_unit_id, 'on_hold', true));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_hold_rolls(p_unit_ids uuid[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_n integer := 0;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A reason is required');
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_unit_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status NOT IN ('pending_qc', 'in_stock') THEN
      RETURN public._mm_err('INVALID', 'Only rolls in the warehouse can be held');
    END IF;
    UPDATE public.mm_stock_units
    SET on_hold = true, hold_reason = btrim(p_reason), hold_by = public._mm_actor_id(), hold_at = now(),
        updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'HOLD', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_stock_units', v_id, btrim(p_reason)
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('held', v_n));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_release_rolls(p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_n integer := 0;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  FOREACH v_id IN ARRAY COALESCE(p_unit_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    UPDATE public.mm_stock_units
    SET on_hold = false, hold_reason = NULL, hold_by = NULL, hold_at = NULL,
        updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'RELEASE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_stock_units', v_id, 'released'
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('released', v_n));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_disposition_rejected(
  p_unit_ids uuid[], p_action text, p_reason text, p_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_role text;
  v_apps jsonb;
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_return uuid;
  v_no text;
  v_recv uuid;
  v_supplier text;
  v_n integer := 0;
  v_qty numeric;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_action NOT IN ('return_to_supplier', 'accept_deviation', 'write_off') THEN
    RETURN public._mm_err('INVALID', 'Unknown disposition');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A reason is required');
  END IF;
  v_actor := public._mm_actor_id();
  IF p_action = 'accept_deviation' THEN
    SELECT p.user_role, COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_role, v_apps
    FROM public.profiles p WHERE p.id = v_actor AND p.factory_id = v_factory;
    IF COALESCE(v_role, '') NOT IN ('admin', 'superadmin')
       AND NOT (COALESCE(v_apps, '[]'::jsonb) @> '["mm_qc_approve"]'::jsonb)
       AND NOT public.is_factory_admin() THEN
      RETURN public._mm_err('FORBIDDEN', 'Deviation needs an approver');
    END IF;
  END IF;
  IF p_action = 'return_to_supplier' AND EXISTS (
    SELECT 1 FROM public.mm_stock_units a
    WHERE a.id = ANY (p_unit_ids) AND a.style_material_id IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.mm_stock_units b
    WHERE b.id = ANY (p_unit_ids) AND b.style_material_id IS NOT NULL
  ) THEN
    RETURN public._mm_err('INVALID', 'Do not mix unallocated rolls with style rolls on one return');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
  v_recv := public._mm_recv_loc(v_factory);
  IF p_action = 'return_to_supplier' THEN
    SELECT c.supplier_name INTO v_supplier
    FROM public.mm_stock_units u
    LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
    WHERE u.id = p_unit_ids[1];
    v_no := public.next_doc_no('SR');
    INSERT INTO public.mm_supplier_returns (factory_id, return_no, supplier_name, reason, debit_note_ref, created_by)
    VALUES (v_factory, v_no, v_supplier, btrim(p_reason), NULLIF(btrim(COALESCE(p_reference, '')), ''), v_actor)
    RETURNING id INTO v_return;
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_unit_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status <> 'rejected' THEN
      RETURN public._mm_err('INVALID', 'Only rejected rolls can be dispositioned');
    END IF;
    v_qty := COALESCE(v_unit.qty_available, 0);
    IF p_action = 'return_to_supplier' THEN
      PERFORM public._mm_ledger(
        v_factory, v_id, 'RETURN_TO_SUPPLIER', v_qty, v_unit.status, 'returned_to_supplier',
        v_unit.current_location_id, NULL, 'mm_supplier_returns', v_return, btrim(p_reason)
      );
      INSERT INTO public.mm_supplier_return_lines (factory_id, return_id, stock_unit_id, qty)
      VALUES (v_factory, v_return, v_id, v_qty);
      UPDATE public.mm_stock_units
      SET status = 'returned_to_supplier', current_location_id = NULL, on_hold = false,
          updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
    ELSIF p_action = 'write_off' THEN
      PERFORM public._mm_ledger(
        v_factory, v_id, 'WRITE_OFF', v_qty, v_unit.status, 'written_off',
        v_unit.current_location_id, NULL, 'mm_stock_units', v_id, btrim(p_reason)
      );
      UPDATE public.mm_stock_units
      SET status = 'written_off', current_location_id = NULL, on_hold = false,
          updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
    ELSE
      UPDATE public.mm_warehouse_inspections
      SET deviation_approved_by = v_actor, deviation_approved_at = now(),
          deviation_reason = btrim(p_reason),
          deviation_reference = NULLIF(btrim(COALESCE(p_reference, '')), '')
      WHERE stock_unit_id = v_id AND factory_id = v_factory;
      UPDATE public.mm_stock_units
      SET status = 'in_stock', current_location_id = v_recv, on_hold = false,
          updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
      PERFORM public._mm_ledger(
        v_factory, v_id, 'RELEASE', 0, 'rejected', 'in_stock',
        v_unit.current_location_id, v_recv, 'mm_warehouse_inspections', v_id, 'accepted under deviation'
      );
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('action', p_action, 'rolls', v_n, 'return_id', v_return, 'return_no', v_no));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_hold_rolls(uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_release_rolls(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_disposition_rejected(uuid[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_hold_rolls(uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_release_rolls(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_disposition_rejected(uuid[], text, text, text) TO authenticated, service_role;;
