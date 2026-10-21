-- Warehouse-only lean-up (2026-10-15): list_rolls receipt/fabric filters + revoke mill / old-inbound RPCs for the app.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_list_rolls_v4(jsonb)'::regprocedure);
  IF position('receipt_id' in d) = 0 THEN
    d := replace(d, $a$      AND (NULLIF(p_filter->>'batch_id','') IS NULL OR r.mill_batch_id = (p_filter->>'batch_id')::uuid)$a$,
      $b$      AND (NULLIF(p_filter->>'batch_id','') IS NULL OR r.mill_batch_id = (p_filter->>'batch_id')::uuid)
      AND (NULLIF(p_filter->>'receipt_id','') IS NULL OR u.in_challan_id = (p_filter->>'receipt_id')::uuid)
      AND (NULLIF(p_filter->>'fabric_id','') IS NULL OR r.fabric_id = (p_filter->>'fabric_id')::uuid)
      AND (NULLIF(p_filter->>'booked_style_material_id','') IS NULL OR r.booked_style_material_id = (p_filter->>'booked_style_material_id')::uuid)$b$);
    IF position('receipt_id' in d) = 0 THEN RAISE EXCEPTION 'list_rolls patch failed'; END IF;
    EXECUTE d;
  END IF;
END $mig$;

REVOKE EXECUTE ON FUNCTION
  public.mm_get_mill_board(uuid[]), public.mm_get_mill_line(uuid,uuid,uuid), public.mm_list_mill_stock(text,text,text,integer,integer),
  public.mm_mill_add_rolls_v4(uuid,jsonb), public.mm_mill_dispatch_v2(jsonb), public.mm_mill_get_batch_v4(uuid),
  public.mm_mill_list_batches_v4(jsonb), public.mm_mill_order_get(uuid), public.mm_mill_order_link_batches(uuid,uuid[]),
  public.mm_mill_order_save(jsonb), public.mm_mill_order_set_status(uuid,text,text), public.mm_mill_orders_list(jsonb),
  public.mm_mill_save_batch_v6(jsonb), public.mm_mill_update_batch_v4(uuid,jsonb), public.mm_receive_mill_bundle(jsonb),
  public.mm_receive_mill_floor(uuid,jsonb,integer,uuid[]), public.mm_receive_mill_in_challan(uuid,jsonb,integer),
  public.mm_receive_mill_in_challan(uuid,jsonb,integer,uuid[]), public.mm_set_batch_fabric(uuid,uuid),
  public.mm_set_mill_short_close(uuid,uuid,uuid,boolean,text), public.mm_get_expected_board(text,text,integer,integer),
  public.mm_wh_save_vendor_grn_v5(jsonb), public.mm_save_vendor_grn(jsonb,uuid,text,text,date,text,text,text,jsonb,text),
  public.mm_confirm_received_lengths(uuid,jsonb), public.mm_short_close_in_challan(uuid,text),
  public.mm_list_floor_grns(text), public.mm_list_receive_catalog()
FROM anon, authenticated, public;
