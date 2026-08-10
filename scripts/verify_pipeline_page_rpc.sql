-- Behavioral verification for get_orders_pipeline_page (post 20260810190000).
DO $$
DECLARE
  v_factory uuid;
  v_delayed_all int;
  v_delayed_total bigint;
  v_page1_rows int;
  v_page1_total bigint;
  v_page2_rows int;
  v_page2_total bigint;
  v_active_total bigint;
  v_completed_total bigint;
  v_zero_rows int;
BEGIN
  SELECT f.id INTO v_factory
  FROM public.factories f
  ORDER BY (SELECT count(*) FROM public.style_orders so WHERE so.factory_id = f.id) DESC
  LIMIT 1;

  SELECT count(*)::int, coalesce(max(total_count), 0)
  INTO v_delayed_all, v_delayed_total
  FROM public.get_orders_pipeline_page(v_factory, 'Delayed', 1, 10000, NULL, NULL);

  SELECT count(*)::int, coalesce(max(total_count), 0)
  INTO v_page1_rows, v_page1_total
  FROM public.get_orders_pipeline_page(v_factory, 'Delayed', 1, 20, NULL, NULL);

  SELECT count(*)::int, coalesce(max(total_count), 0)
  INTO v_page2_rows, v_page2_total
  FROM public.get_orders_pipeline_page(v_factory, 'Delayed', 2, 20, NULL, NULL);

  SELECT coalesce(max(total_count), 0) INTO v_active_total
  FROM public.get_orders_pipeline_page(v_factory, 'Active', 1, 1, NULL, NULL);

  SELECT coalesce(max(total_count), 0) INTO v_completed_total
  FROM public.get_orders_pipeline_page(v_factory, 'Completed', 1, 1, NULL, NULL);

  SELECT count(*)::int INTO v_zero_rows
  FROM public.get_orders_pipeline_page(v_factory, 'Delayed', 1, 20, '___no_match___', NULL);

  IF v_page1_total <> v_delayed_total THEN
    RAISE EXCEPTION 'VERIFY FAIL: page1 total_count % <> full delayed %', v_page1_total, v_delayed_total;
  END IF;

  IF v_page1_rows > 20 THEN
    RAISE EXCEPTION 'VERIFY FAIL: page1 returned more than page_size';
  END IF;

  IF v_page2_rows > 0 AND v_page2_total <> v_page1_total THEN
    RAISE EXCEPTION 'VERIFY FAIL: page2 total_count % <> page1 %', v_page2_total, v_page1_total;
  END IF;

  IF v_zero_rows <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: zero-match search returned % rows', v_zero_rows;
  END IF;

  RAISE NOTICE 'VERIFY OK factory=% delayed=%/% active=% completed=% page2_rows=%',
    v_factory, v_delayed_all, v_delayed_total, v_active_total, v_completed_total, v_page2_rows;
END $$;
