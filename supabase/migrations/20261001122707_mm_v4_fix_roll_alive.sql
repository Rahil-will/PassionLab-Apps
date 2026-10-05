CREATE OR REPLACE FUNCTION public._mm_roll_alive(p_roll_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = p_roll_id AND l.line_status = 'out')
     AND (EXISTS (SELECT 1 FROM public.mm_mill_rolls m WHERE m.roll_id = p_roll_id AND m.status = 'draft')
       OR EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id
                  AND u.status NOT IN ('consumed','written_off','returned_to_supplier','missing','at_process')));
$$;;
