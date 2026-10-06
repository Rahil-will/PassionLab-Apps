DO $$
DECLARE
  v_src text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_save_lay_consumptions(uuid,jsonb,uuid)'::regprocedure);

  v_old := '  DELETE FROM public.mm_lay_unit_consumptions' || chr(10) || '  WHERE cutting_lay_id = v_lay.id AND factory_id = v_factory;';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'lay delete hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, v_old || chr(10) || '  DELETE FROM public.mm_end_bit_returns' || chr(10) || '  WHERE cutting_lay_id = v_lay.id AND factory_id = v_factory;');

  v_old := '    UPDATE public.mm_stock_units' || chr(10) || '    SET status = v_new_status,' || chr(10) || '        current_location_id = v_new_loc,' || chr(10) || '        is_remnant = (v_action = ''return''),' || chr(10) || '        updated_at = now(),' || chr(10) || '        updated_by = v_actor' || chr(10) || '    WHERE id = v_unit.id;';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'lay unit update hits %', v_hits; END IF;
  v_new := v_old || chr(10) || '    IF v_action = ''return'' AND v_end > 0 THEN' || chr(10) || '      INSERT INTO public.mm_end_bit_returns (' || chr(10) || '        factory_id, stock_unit_id, cutting_lay_id, store_challan_id, qty, qty_uom,' || chr(10) || '        mill_shade, tested_shade, unit_code, returned_by, created_by' || chr(10) || '      ) VALUES (' || chr(10) || '        v_factory, v_unit.id, v_lay.id, v_unit.store_challan_id, v_end, COALESCE(v_unit.qty_uom, ''m''),' || chr(10) || '        v_unit.shade, v_unit.tested_shade, v_unit.unit_code, v_actor, v_actor' || chr(10) || '      );' || chr(10) || '    END IF;';
  EXECUTE replace(v_src, v_old, v_new);
END;
$$;;
