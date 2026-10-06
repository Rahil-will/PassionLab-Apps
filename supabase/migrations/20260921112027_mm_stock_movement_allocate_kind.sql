CREATE OR REPLACE FUNCTION public._mm_stock_movement_kind(
  p_entry_type text,
  p_note text,
  p_ref_table text,
  p_status_after text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('ALLOCATE', 'UNALLOCATE') THEN 'allocation'
    WHEN COALESCE(p_note, '') ILIKE '%4-point%'
      OR p_ref_table = 'mm_warehouse_inspections'
      THEN 'qc'
    WHEN COALESCE(p_note, '') ILIKE '%dispatched to cutting%'
      OR p_ref_table = 'mm_store_challans'
      THEN 'dispatch'
    WHEN COALESCE(p_note, '') ILIKE '%red label%'
      OR COALESCE(p_note, '') ILIKE '%rack move%'
      OR p_ref_table = 'mm_locations'
      THEN 'putaway'
    WHEN p_entry_type IN ('INHOUSE_IN', 'RECEIPT_IN')
      OR COALESCE(p_note, '') ILIKE '%warehouse receive%'
      OR p_ref_table = 'mm_in_challans'
      THEN 'received'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public._mm_stock_movement_action(
  p_entry_type text,
  p_note text,
  p_ref_table text,
  p_status_after text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type = 'ALLOCATE' THEN 'Allocated'
    WHEN p_entry_type = 'UNALLOCATE' THEN 'Unallocated'
    WHEN COALESCE(p_note, '') ILIKE '%4-point pass%'
      OR (p_ref_table = 'mm_warehouse_inspections' AND p_status_after = 'in_stock')
      THEN '4-point pass'
    WHEN COALESCE(p_note, '') ILIKE '%4-point fail%'
      OR (p_ref_table = 'mm_warehouse_inspections' AND p_status_after = 'rejected')
      THEN '4-point fail'
    WHEN COALESCE(p_note, '') ILIKE '%dispatched to cutting%'
      OR p_ref_table = 'mm_store_challans'
      THEN 'Dispatched to cutting'
    WHEN COALESCE(p_note, '') ILIKE '%red label%' THEN 'Moved to red label'
    WHEN COALESCE(p_note, '') ILIKE '%rack move%' OR p_ref_table = 'mm_locations' THEN 'Putaway'
    WHEN COALESCE(p_note, '') ILIKE '%warehouse receive%' THEN 'Received into warehouse'
    WHEN p_entry_type = 'INHOUSE_IN' THEN 'Mill inbound'
    WHEN p_entry_type = 'RECEIPT_IN' THEN 'Vendor inbound'
    WHEN p_ref_table = 'mm_in_challans' AND p_status_after = 'in_transit' THEN 'Mill dispatched'
    WHEN p_ref_table = 'mm_in_challans' THEN 'Received into warehouse'
    WHEN NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL THEN btrim(p_note)
    ELSE 'Move'
  END
$$;;
