-- Challan header: fabric colour separate from the style colorway.
-- fabric_color on the style line wins. When it is blank, the colorway name is the fabric colour.
-- A general (no style) challan uses the colour written on the rolls.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._mm_challan_header(public.mm_in_challans)'::regprocedure);
  IF position($$'fabric_color'$$ in d) > 0 THEN
    RETURN;
  END IF;
  d := replace(
    d,
    $old$'color_name', COALESCE(cw.name, 'Unallocated'),$old$,
    $new$'color_name', COALESCE(cw.name, 'Unallocated'),
    'fabric_color', COALESCE(
      NULLIF(btrim(cm.fabric_color), ''),
      NULLIF(btrim(cw.name), ''),
      (
        SELECT NULLIF(btrim(u.color_ref), '')
        FROM public.mm_stock_units u
        WHERE u.in_challan_id = p_ch.id
          AND NULLIF(btrim(COALESCE(u.color_ref, '')), '') IS NOT NULL
        GROUP BY btrim(u.color_ref)
        ORDER BY count(*) DESC
        LIMIT 1
      )
    ),$new$
  );
  IF position($$'fabric_color'$$ in d) = 0 THEN
    RAISE EXCEPTION 'challan header fabric colour replace failed';
  END IF;
  EXECUTE d;
END $mig$;
