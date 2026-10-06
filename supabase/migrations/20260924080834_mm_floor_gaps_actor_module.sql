CREATE OR REPLACE FUNCTION public.mm_floor_gaps()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_on boolean := false;
BEGIN
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR public._mm_actor_id() IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  v_on := COALESCE(public.module_enabled(v_factory, 'material'), false);
  RETURN public._mm_ok(jsonb_build_object(
    'module_on', v_on,
    'p1_on_hand', EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_mm_is_on_hand'),
    'p2_qty', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_stock_units' AND column_name='qty_available'),
    'p3_defects', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mm_inspection_defects'),
    'p4_lines', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_in_challan_lines' AND column_name='line_status'),
    'p5_hold', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_stock_units' AND column_name='on_hold'),
    'issued_status', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'mm_stock_units_status_chk'
        AND pg_get_constraintdef(oid) LIKE '%issued%'
    )
  ));
END;
$function$;;
