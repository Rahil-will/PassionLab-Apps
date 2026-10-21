-- Step 1 clean-up (2026-10-15): RPCs no page (web or floor) calls. Kept in the DB (still used internally by
-- SECURITY DEFINER callers: v6 -> v5 -> v4, vendor GRN v5 -> v4, opening stock -> unallocated GRN v2, floor call -> unallocate),
-- but no longer callable from the app.
REVOKE EXECUTE ON FUNCTION
  public.mm_get_mill_accuracy(uuid),
  public.mm_get_process_challan(uuid),
  public.mm_list_process_challans(),
  public.mm_list_process_types(),
  public.mm_list_process_vendors(),
  public.mm_mill_save_batch_v4(jsonb),
  public.mm_mill_save_batch_v5(jsonb),
  public.mm_proc_save_lots(uuid,jsonb),
  public.mm_receive_process_return(uuid,jsonb),
  public.mm_save_machine(jsonb),
  public.mm_save_mill_batch(uuid,uuid,uuid,text,text,date,text,jsonb),
  public.mm_save_process_type_rules(jsonb),
  public.mm_save_unallocated_mill_batch(uuid,text,text,date,text,text,text,jsonb,text),
  public.mm_save_unallocated_vendor_grn(uuid,text,text,text,text,jsonb),
  public.mm_save_unallocated_vendor_grn_v2(uuid,text,text,text,text,jsonb),
  public.mm_send_to_process(text,uuid,uuid,uuid[],text,text),
  public.mm_unallocate_rolls(uuid[]),
  public.mm_wh_save_vendor_grn_v4(jsonb)
FROM anon, authenticated, public;
