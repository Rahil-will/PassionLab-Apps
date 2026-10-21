-- Clean-up batch 2 (2026-10-15): the desktop app no longer calls these. The floor app reaches allocate / inspections
-- through mm_floor_call (SECURITY DEFINER), and mm_proc_return calls mm_dispatch_mill_rolls internally, so both keep working.
REVOKE EXECUTE ON FUNCTION
  public.mm_allocate_mill_rolls_to_style(uuid[],uuid,uuid,uuid),
  public.mm_allocate_rolls_to_style(uuid[],uuid,uuid,uuid),
  public.mm_dispatch_mill_rolls(uuid[],text,text,text,date,text),
  public.mm_get_unallocated_mill(),
  public.mm_save_inspections(text,uuid,jsonb),
  public.mm_save_unallocated_mill_batch_v2(uuid,text,text,date,text,text,text,jsonb),
  public.mm_set_batch_style_intents(uuid,uuid[]),
  public.mm_update_mill_batch(uuid,text,text,date,text,jsonb,integer,text,text,boolean)
FROM anon, authenticated, public;
