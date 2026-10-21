-- Expected board: fabric colour on the style line, separate from the colorway name.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_get_expected_board(text, text, integer, integer)'::regprocedure);
  IF position($$'fabric_color'$$ in d) > 0 THEN
    RETURN;
  END IF;
  d := replace(
    d,
    $old$c.name AS color_name,$old$,
    $new$c.name AS color_name,
        NULLIF(btrim(cm.fabric_color), '') AS fabric_color,$new$
  );
  d := replace(
    d,
    $old$'color_name', f.color_name,$old$,
    $new$'color_name', f.color_name,
          'fabric_color', f.fabric_color,$new$
  );
  d := replace(
    d,
    $old$style_name, style_ref, buyer_name, po_number, color_name, fabric_name, fabric_type$old$,
    $new$style_name, style_ref, buyer_name, po_number, color_name, fabric_color, fabric_name, fabric_type$new$
  );
  IF position($$AS fabric_color$$ in d) = 0 OR position($$'fabric_color', f.fabric_color$$ in d) = 0 THEN
    RAISE EXCEPTION 'expected board fabric colour replace failed';
  END IF;
  EXECUTE d;
END $mig$;
