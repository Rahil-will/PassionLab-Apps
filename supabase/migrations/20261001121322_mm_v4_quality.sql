-- Fabric v4 · 4/6 · Quality: tests (per scope, many rolls) and 4-point inspections (per roll), passport, deviations, cut-at-risk

CREATE TABLE IF NOT EXISTS public.mm_qc_tests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id            uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  scope_kind            text NOT NULL CHECK (scope_kind IN ('mill_batch','process_challan','process_lot','in_challan','rolls')),
  scope_id              uuid,
  site_side             text NOT NULL CHECK (site_side IN ('mill','processing','warehouse')),
  site_facility_id      uuid REFERENCES public.mm_facilities(id),
  stage_code            text,
  fabric_type_id        uuid REFERENCES public.mm_fabric_types(id),
  field_values          jsonb NOT NULL DEFAULT '{}'::jsonb,
  result                text NOT NULL CHECK (result IN ('pass','fail','hold')),
  deviation_approved_by uuid,
  deviation_approved_at timestamptz,
  deviation_reason      text,
  origin                text NOT NULL DEFAULT 'own' CHECK (origin IN ('own','vendor_certificate','process_unit_report','migrated')),
  supersedes_id         uuid REFERENCES public.mm_qc_tests(id),
  tested_at             timestamptz NOT NULL DEFAULT now(),
  remarks               text,
  voided_at             timestamptz,
  voided_by             uuid,
  void_reason           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  CONSTRAINT mm_qc_tests_scope_chk CHECK (scope_kind = 'rolls' OR scope_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS mm_qc_tests_scope_idx ON public.mm_qc_tests (factory_id, scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS mm_qc_tests_supersedes_idx ON public.mm_qc_tests (supersedes_id);
SELECT public._mm_lockdown_table('public.mm_qc_tests');

CREATE TABLE IF NOT EXISTS public.mm_qc_test_rolls (
  factory_id    uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  test_id       uuid NOT NULL REFERENCES public.mm_qc_tests(id) ON DELETE CASCADE,
  roll_id       uuid NOT NULL REFERENCES public.mm_rolls(id) ON DELETE CASCADE,
  round_at_test integer NOT NULL,
  PRIMARY KEY (test_id, roll_id)
);
CREATE INDEX IF NOT EXISTS mm_qc_test_rolls_roll_idx ON public.mm_qc_test_rolls (roll_id);
SELECT public._mm_lockdown_table('public.mm_qc_test_rolls');

CREATE TABLE IF NOT EXISTS public.mm_qc_inspections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id            uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  roll_id               uuid NOT NULL REFERENCES public.mm_rolls(id) ON DELETE CASCADE,
  round_at_inspection   integer NOT NULL,
  site_side             text NOT NULL CHECK (site_side IN ('mill','processing','warehouse')),
  site_facility_id      uuid REFERENCES public.mm_facilities(id),
  stage_code            text,
  inspected_length      numeric,
  length_uom            text NOT NULL DEFAULT 'm' CHECK (length_uom IN ('m','yd')),
  cuttable_width        numeric,
  width_uom             text NOT NULL DEFAULT 'in' CHECK (width_uom IN ('in','cm')),
  pts_1                 integer NOT NULL DEFAULT 0,
  pts_2                 integer NOT NULL DEFAULT 0,
  pts_3                 integer NOT NULL DEFAULT 0,
  pts_4                 integer NOT NULL DEFAULT 0,
  total_points          integer NOT NULL DEFAULT 0,
  points_per_100_sqyd   numeric,
  threshold_used        numeric,
  result_computed       text CHECK (result_computed IN ('pass','fail')),
  result_override       text CHECK (result_override IN ('pass','fail')),
  override_reason       text,
  result                text NOT NULL CHECK (result IN ('pass','fail')),
  deviation_approved_by uuid,
  deviation_approved_at timestamptz,
  deviation_reason      text,
  origin                text NOT NULL DEFAULT 'own' CHECK (origin IN ('own','process_unit_report','migrated')),
  supersedes_id         uuid REFERENCES public.mm_qc_inspections(id),
  legacy_inspection_id  uuid,
  inspected_at          timestamptz NOT NULL DEFAULT now(),
  remarks               text,
  voided_at             timestamptz,
  voided_by             uuid,
  void_reason           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid
);
CREATE INDEX IF NOT EXISTS mm_qc_inspections_roll_idx ON public.mm_qc_inspections (roll_id, inspected_at DESC);
SELECT public._mm_lockdown_table('public.mm_qc_inspections');

CREATE TABLE IF NOT EXISTS public.mm_qc_inspection_defects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id     uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  inspection_id  uuid NOT NULL REFERENCES public.mm_qc_inspections(id) ON DELETE CASCADE,
  defect_type_id uuid REFERENCES public.mm_defect_types(id),
  defect_code    text,
  points         integer NOT NULL CHECK (points BETWEEN 1 AND 4),
  position_from  numeric,
  hole           boolean NOT NULL DEFAULT false,
  size_band      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mm_qc_inspection_defects_insp_idx ON public.mm_qc_inspection_defects (inspection_id);
SELECT public._mm_lockdown_table('public.mm_qc_inspection_defects');

CREATE TABLE IF NOT EXISTS public.mm_qc_cut_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  roll_id     uuid NOT NULL REFERENCES public.mm_rolls(id) ON DELETE CASCADE,
  codes       text[] NOT NULL,
  reason      text NOT NULL,
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid
);
CREATE INDEX IF NOT EXISTS mm_qc_cut_approvals_roll_idx ON public.mm_qc_cut_approvals (roll_id);
SELECT public._mm_lockdown_table('public.mm_qc_cut_approvals');

-- ── helpers ──
CREATE OR REPLACE FUNCTION public._mm_roll_custody(p_roll_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('side','processing','process_challan_id', l.challan_id, 'out_line_id', l.id)
       FROM public.mm_process_out_lines l WHERE l.roll_id = p_roll_id AND l.line_status = 'out' LIMIT 1),
    (SELECT jsonb_build_object('side','warehouse','stock_unit_id', u.id, 'status', u.status, 'style_material_id', u.style_material_id,
            'qty', u.qty_available, 'uom', COALESCE(u.qty_uom, u.uom), 'on_hold', u.on_hold, 'location_id', u.current_location_id,
            'alive', u.status NOT IN ('consumed','written_off','returned_to_supplier','missing'))
       FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id),
    (SELECT jsonb_build_object('side','mill','mill_roll_id', m.id, 'status', m.status, 'style_material_id', m.style_material_id,
            'qty', m.length_m, 'uom', 'm', 'alive', m.status = 'draft')
       FROM public.mm_mill_rolls m WHERE m.roll_id = p_roll_id),
    jsonb_build_object('side','none','alive', false));
$$;

CREATE OR REPLACE FUNCTION public._mm_roll_alive(p_roll_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mm_mill_rolls m WHERE m.roll_id = p_roll_id AND m.status = 'draft')
      OR EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id
                 AND u.status NOT IN ('consumed','written_off','returned_to_supplier','missing','at_process'));
$$;

CREATE OR REPLACE FUNCTION public._mm_qc_scope_rolls(p_factory uuid, p_kind text, p_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT x.roll_id FROM (
    SELECT r.id AS roll_id FROM public.mm_rolls r
     WHERE p_kind = 'mill_batch' AND r.factory_id = p_factory AND r.mill_batch_id = p_id
    UNION ALL
    SELECT rl.roll_id FROM public.mm_process_return_lines rl
     WHERE p_kind = 'process_challan' AND rl.factory_id = p_factory AND rl.challan_id = p_id
    UNION ALL
    SELECT rl.roll_id FROM public.mm_process_return_lines rl
     WHERE p_kind = 'process_lot' AND rl.factory_id = p_factory AND rl.lot_id = p_id
    UNION ALL
    SELECT u.roll_id FROM public.mm_in_challan_lines cl JOIN public.mm_stock_units u ON u.id = cl.stock_unit_id
     WHERE p_kind = 'in_challan' AND cl.factory_id = p_factory AND cl.challan_id = p_id
  ) x WHERE x.roll_id IS NOT NULL AND public._mm_roll_alive(x.roll_id);
$$;

CREATE OR REPLACE FUNCTION public._mm_qc_threshold(p_roll_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_r public.mm_rolls%ROWTYPE; v_sm uuid; v_buyer uuid; v_pts numeric;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id;
  v_sm := COALESCE((SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = p_roll_id),
                   (SELECT style_material_id FROM public.mm_mill_rolls WHERE roll_id = p_roll_id));
  SELECT o.buyer_id INTO v_buyer FROM public.mm_style_materials sm JOIN public.style_orders o ON o.id = sm.order_id WHERE sm.id = v_sm;
  SELECT t.max_points INTO v_pts FROM public.mm_fpt_thresholds t
   WHERE t.factory_id = v_r.factory_id AND t.fabric_type_id = v_r.fabric_type_id AND t.buyer_id IS NOT DISTINCT FROM v_buyer LIMIT 1;
  IF v_pts IS NULL THEN
    SELECT t.max_points INTO v_pts FROM public.mm_fpt_thresholds t
     WHERE t.factory_id = v_r.factory_id AND t.fabric_type_id = v_r.fabric_type_id AND t.buyer_id IS NULL LIMIT 1;
  END IF;
  IF v_pts IS NULL THEN SELECT fpt_max_points INTO v_pts FROM public.mm_fabric_types WHERE id = v_r.fabric_type_id; END IF;
  RETURN COALESCE(v_pts, 40);
END $$;

-- ── Passport: derived, never stored ──
CREATE OR REPLACE FUNCTION public._mm_qc_passport(p_roll_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_r public.mm_rolls%ROWTYPE; v_any boolean; v_valid_n int; v_fail boolean; v_hold boolean; v_values jsonb;
  v_required text[]; v_missing text[]; v_status text; v_ids jsonb; v_last timestamptz;
  v_i public.mm_qc_inspections%ROWTYPE; v_istatus text;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  WITH cur AS (
    SELECT t.*, tr.round_at_test FROM public.mm_qc_test_rolls tr JOIN public.mm_qc_tests t ON t.id = tr.test_id
    WHERE tr.roll_id = v_r.id AND t.voided_at IS NULL AND t.origin IN ('own','migrated')
      AND NOT EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL)
  ), val AS (SELECT * FROM cur WHERE round_at_test >= v_r.test_valid_from_round)
  SELECT EXISTS (SELECT 1 FROM cur), (SELECT count(*) FROM val),
         EXISTS (SELECT 1 FROM val WHERE result = 'fail' AND deviation_approved_at IS NULL),
         EXISTS (SELECT 1 FROM val WHERE result = 'hold'),
         COALESCE((SELECT jsonb_object_agg(k, v) FROM (
            SELECT DISTINCT ON (e.key) e.key AS k, e.value AS v FROM val, jsonb_each(val.field_values) e
            WHERE e.value NOT IN ('null'::jsonb, '""'::jsonb) ORDER BY e.key, val.tested_at DESC) z), '{}'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'scope_kind', scope_kind, 'result', result, 'tested_at', tested_at,
                    'site_side', site_side, 'deviation', deviation_approved_at IS NOT NULL) ORDER BY tested_at DESC) FROM val), '[]'::jsonb),
         (SELECT max(tested_at) FROM val)
    INTO v_any, v_valid_n, v_fail, v_hold, v_values, v_ids, v_last;

  v_required := ARRAY(SELECT f.key FROM public.mm_type_test_fields f
                      WHERE f.factory_id = v_r.factory_id AND f.type_id = v_r.fabric_type_id AND f.is_active
                        AND v_r.stage_code = ANY (f.required_at_stages) ORDER BY f.seq);
  v_missing := ARRAY(SELECT k FROM unnest(v_required) k WHERE NOT (v_values ? k));

  v_status := CASE
    WHEN NOT v_any THEN 'NONE'
    WHEN v_valid_n = 0 THEN 'STALE'
    WHEN v_fail THEN 'FAILED'
    WHEN v_hold THEN 'HOLD'
    WHEN array_length(v_missing,1) > 0 THEN 'INCOMPLETE'
    ELSE 'PASS' END;

  SELECT i.* INTO v_i FROM public.mm_qc_inspections i
  WHERE i.roll_id = v_r.id AND i.voided_at IS NULL AND i.origin IN ('own','migrated')
  ORDER BY i.inspected_at DESC, i.created_at DESC LIMIT 1;
  v_istatus := CASE
    WHEN v_i.id IS NULL THEN 'NONE'
    WHEN v_i.round_at_inspection < v_r.insp_valid_from_round THEN 'STALE'
    WHEN v_i.result = 'fail' AND v_i.deviation_approved_at IS NULL THEN 'FAILED'
    ELSE 'PASS' END;

  RETURN jsonb_build_object(
    'roll_id', v_r.id, 'roll_code', v_r.roll_code, 'stage_code', v_r.stage_code, 'process_round', v_r.process_round,
    'test', jsonb_build_object('status', v_status, 'values', v_values, 'required_keys', to_jsonb(v_required),
            'missing_keys', to_jsonb(v_missing), 'tests', v_ids, 'last_tested_at', v_last),
    'inspection', jsonb_build_object('status', v_istatus, 'id', v_i.id, 'result', v_i.result,
            'points_per_100_sqyd', v_i.points_per_100_sqyd, 'threshold_used', v_i.threshold_used,
            'inspected_at', v_i.inspected_at, 'site_side', v_i.site_side, 'deviation', v_i.deviation_approved_at IS NOT NULL));
END $$;

-- ════════════ Quality RPCs ════════════
-- payload: { scope_kind, scope_id?, roll_ids?:[registry ids], site_side, site_facility_id?, tested_at?, field_values:{key:value},
--            result:'pass'|'fail'|'hold', remarks?, origin?:'own'|'vendor_certificate'|'process_unit_report', supersedes_test_id? }
CREATE OR REPLACE FUNCTION public.mm_qc_save_test(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_factory uuid; v_actor uuid; v_kind text; v_sid uuid; v_given uuid[]; v_rolls uuid[]; v_ft uuid; v_n_ft int;
  v_vals jsonb; v_k text; v_v jsonb; v_dt text; v_res text; v_origin text; v_sup uuid; v_test uuid; v_stage text; v_side text;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  v_kind := p_payload->>'scope_kind';
  v_sid := NULLIF(p_payload->>'scope_id','')::uuid;
  v_side := p_payload->>'site_side';
  v_res := p_payload->>'result';
  v_origin := COALESCE(NULLIF(p_payload->>'origin',''), 'own');
  IF v_kind IS NULL OR v_kind NOT IN ('mill_batch','process_challan','process_lot','in_challan','rolls') THEN RETURN public._mm_err('INVALID','Unknown test scope'); END IF;
  IF v_side IS NULL OR v_side NOT IN ('mill','processing','warehouse') THEN RETURN public._mm_err('INVALID','Where was it tested?'); END IF;
  IF v_res IS NULL OR v_res NOT IN ('pass','fail','hold') THEN RETURN public._mm_err('REQUIRED','Pick pass, fail or hold'); END IF;
  IF v_origin NOT IN ('own','vendor_certificate','process_unit_report') THEN RETURN public._mm_err('INVALID','Unknown origin'); END IF;
  v_given := ARRAY(SELECT DISTINCT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'roll_ids','[]'::jsonb)) x);

  IF v_kind = 'rolls' THEN
    IF COALESCE(array_length(v_given,1),0) = 0 THEN RETURN public._mm_err('REQUIRED','Select rolls'); END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_given) g WHERE NOT EXISTS (SELECT 1 FROM public.mm_rolls r WHERE r.id = g AND r.factory_id = v_factory)) THEN
      RETURN public._mm_err('NOT_FOUND','A selected roll was not found');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_given) g WHERE NOT public._mm_roll_alive(g)) THEN
      RETURN public._mm_err('INVALID','A selected roll is at a processing unit or no longer in stock');
    END IF;
    v_rolls := v_given;
  ELSE
    IF v_sid IS NULL THEN RETURN public._mm_err('REQUIRED','Scope is required'); END IF;
    v_rolls := ARRAY(SELECT public._mm_qc_scope_rolls(v_factory, v_kind, v_sid));
    IF COALESCE(array_length(v_given,1),0) > 0 THEN
      v_rolls := ARRAY(SELECT x FROM unnest(v_rolls) x WHERE x = ANY (v_given));
    END IF;
    IF COALESCE(array_length(v_rolls,1),0) = 0 THEN RETURN public._mm_err('EMPTY','No rolls in this scope can be tested right now'); END IF;
  END IF;

  SELECT count(DISTINCT fabric_type_id), min(fabric_type_id::text)::uuid INTO v_n_ft, v_ft FROM public.mm_rolls WHERE id = ANY (v_rolls);
  IF v_n_ft > 1 THEN RETURN public._mm_err('INVALID','Rolls in one test must be the same fabric type'); END IF;
  SELECT mode() WITHIN GROUP (ORDER BY stage_code) INTO v_stage FROM public.mm_rolls WHERE id = ANY (v_rolls);

  v_vals := COALESCE(p_payload->'field_values','{}'::jsonb);
  IF jsonb_typeof(v_vals) <> 'object' THEN RETURN public._mm_err('INVALID','field_values must be an object'); END IF;
  FOR v_k, v_v IN SELECT * FROM jsonb_each(v_vals) LOOP
    SELECT data_type INTO v_dt FROM public.mm_type_test_fields WHERE factory_id = v_factory AND type_id = v_ft AND key = v_k AND is_active;
    IF v_dt IS NULL THEN RETURN public._mm_err('INVALID','Unknown test field: ' || v_k); END IF;
    IF v_dt IN ('number','decimal') AND v_v NOT IN ('null'::jsonb,'""'::jsonb) AND public._mm_safe_numeric(v_v #>> '{}') IS NULL THEN
      RETURN public._mm_err('INVALID', v_k || ' must be a number');
    END IF;
  END LOOP;

  v_sup := NULLIF(p_payload->>'supersedes_test_id','')::uuid;
  IF v_sup IS NULL AND v_kind <> 'rolls' THEN
    SELECT t.id INTO v_sup FROM public.mm_qc_tests t
    WHERE t.factory_id = v_factory AND t.scope_kind = v_kind AND t.scope_id = v_sid AND t.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL)
    ORDER BY t.tested_at DESC LIMIT 1;
  ELSIF v_sup IS NULL AND array_length(v_rolls,1) = 1 THEN
    SELECT t.id INTO v_sup FROM public.mm_qc_tests t JOIN public.mm_qc_test_rolls tr ON tr.test_id = t.id
    WHERE tr.roll_id = v_rolls[1] AND t.scope_kind = 'rolls' AND t.voided_at IS NULL
      AND (SELECT count(*) FROM public.mm_qc_test_rolls z WHERE z.test_id = t.id) = 1
      AND NOT EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL)
    ORDER BY t.tested_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, site_facility_id, stage_code, fabric_type_id,
    field_values, result, origin, supersedes_id, tested_at, remarks, created_by)
  VALUES (v_factory, v_kind, v_sid, v_side, NULLIF(p_payload->>'site_facility_id','')::uuid, v_stage, v_ft,
    v_vals, v_res, v_origin, v_sup, COALESCE(NULLIF(p_payload->>'tested_at','')::timestamptz, now()),
    NULLIF(p_payload->>'remarks',''), v_actor)
  RETURNING id INTO v_test;
  INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test)
  SELECT v_factory, v_test, r.id, r.process_round FROM public.mm_rolls r WHERE r.id = ANY (v_rolls);

  RETURN public._mm_ok(jsonb_build_object('id', v_test, 'roll_count', array_length(v_rolls,1), 'supersedes_id', v_sup));
END $$;

-- payload: { site_side, site_facility_id?, inspected_at?, origin?,
--   rows:[{ roll_id, inspected_length, length_uom?, cuttable_width, width_uom?, pts_1?..pts_4?,
--           defects?:[{defect_type_id?, defect_code?, points, position_from?, hole?, size_band?}],
--           result_override?, override_reason?, remarks? }] }
CREATE OR REPLACE FUNCTION public.mm_qc_save_inspections(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_factory uuid; v_actor uuid; v_side text; v_row jsonb; v_d jsonb; v_r public.mm_rolls%ROWTYPE; v_id uuid; v_prev uuid;
  p1 int; p2 int; p3 int; p4 int; v_total int; v_score numeric; v_thr numeric; v_comp text; v_ovr text; v_final text;
  v_len numeric; v_wid numeric; v_lu text; v_wu text; v_out jsonb := '[]'::jsonb; v_origin text;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  v_side := p_payload->>'site_side';
  v_origin := COALESCE(NULLIF(p_payload->>'origin',''), 'own');
  IF v_side IS NULL OR v_side NOT IN ('mill','processing','warehouse') THEN RETURN public._mm_err('INVALID','Where was it inspected?'); END IF;
  IF v_origin NOT IN ('own','process_unit_report') THEN RETURN public._mm_err('INVALID','Unknown origin'); END IF;
  IF jsonb_array_length(COALESCE(p_payload->'rows','[]'::jsonb)) = 0 THEN RETURN public._mm_err('REQUIRED','Add at least one roll'); END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payload->'rows') LOOP
    SELECT * INTO v_r FROM public.mm_rolls WHERE id = NULLIF(v_row->>'roll_id','')::uuid AND factory_id = v_factory;
    IF NOT FOUND THEN RAISE EXCEPTION 'A roll was not found'; END IF;
    IF NOT public._mm_roll_alive(v_r.id) THEN RAISE EXCEPTION '% is at a processing unit or no longer in stock', v_r.roll_code; END IF;
    v_len := NULLIF(v_row->>'inspected_length','')::numeric;
    v_wid := NULLIF(v_row->>'cuttable_width','')::numeric;
    v_lu := COALESCE(NULLIF(v_row->>'length_uom',''), 'm');
    v_wu := COALESCE(NULLIF(v_row->>'width_uom',''), 'in');
    IF jsonb_typeof(v_row->'defects') = 'array' AND jsonb_array_length(v_row->'defects') > 0 THEN
      SELECT count(*) FILTER (WHERE (d->>'points')::int = 1), count(*) FILTER (WHERE (d->>'points')::int = 2),
             count(*) FILTER (WHERE (d->>'points')::int = 3), count(*) FILTER (WHERE (d->>'points')::int = 4)
        INTO p1, p2, p3, p4 FROM jsonb_array_elements(v_row->'defects') d;
    ELSE
      p1 := COALESCE(NULLIF(v_row->>'pts_1','')::int, 0); p2 := COALESCE(NULLIF(v_row->>'pts_2','')::int, 0);
      p3 := COALESCE(NULLIF(v_row->>'pts_3','')::int, 0); p4 := COALESCE(NULLIF(v_row->>'pts_4','')::int, 0);
    END IF;
    IF LEAST(p1,p2,p3,p4) < 0 THEN RAISE EXCEPTION '%: defect counts cannot be negative', v_r.roll_code; END IF;
    v_total := p1 + 2*p2 + 3*p3 + 4*p4;
    v_score := public._mm_fpt_score(v_total, v_len, v_lu, v_wid, v_wu);
    v_thr := public._mm_qc_threshold(v_r.id);
    v_comp := CASE WHEN v_score IS NULL THEN NULL WHEN v_score <= v_thr THEN 'pass' ELSE 'fail' END;
    v_ovr := NULLIF(v_row->>'result_override','');
    IF v_ovr IS NOT NULL AND v_ovr NOT IN ('pass','fail') THEN RAISE EXCEPTION '%: override must be pass or fail', v_r.roll_code; END IF;
    IF v_ovr IS NOT NULL AND v_ovr IS DISTINCT FROM v_comp AND NULLIF(btrim(COALESCE(v_row->>'override_reason','')),'') IS NULL THEN
      RAISE EXCEPTION '%: give a reason for the override', v_r.roll_code;
    END IF;
    v_final := COALESCE(v_ovr, v_comp);
    IF v_final IS NULL THEN RAISE EXCEPTION '%: enter inspected length and cuttable width', v_r.roll_code; END IF;
    SELECT id INTO v_prev FROM public.mm_qc_inspections WHERE roll_id = v_r.id AND voided_at IS NULL
      ORDER BY inspected_at DESC, created_at DESC LIMIT 1;
    INSERT INTO public.mm_qc_inspections (factory_id, roll_id, round_at_inspection, site_side, site_facility_id, stage_code,
      inspected_length, length_uom, cuttable_width, width_uom, pts_1, pts_2, pts_3, pts_4, total_points, points_per_100_sqyd,
      threshold_used, result_computed, result_override, override_reason, result, origin, supersedes_id, inspected_at, remarks, created_by)
    VALUES (v_factory, v_r.id, v_r.process_round, v_side, NULLIF(p_payload->>'site_facility_id','')::uuid, v_r.stage_code,
      v_len, v_lu, v_wid, v_wu, p1, p2, p3, p4, v_total, v_score, v_thr, v_comp, v_ovr, NULLIF(v_row->>'override_reason',''),
      v_final, v_origin, v_prev, COALESCE(NULLIF(p_payload->>'inspected_at','')::timestamptz, now()), NULLIF(v_row->>'remarks',''), v_actor)
    RETURNING id INTO v_id;
    IF jsonb_typeof(v_row->'defects') = 'array' THEN
      FOR v_d IN SELECT * FROM jsonb_array_elements(v_row->'defects') LOOP
        INSERT INTO public.mm_qc_inspection_defects (factory_id, inspection_id, defect_type_id, defect_code, points, position_from, hole, size_band)
        VALUES (v_factory, v_id, NULLIF(v_d->>'defect_type_id','')::uuid, NULLIF(v_d->>'defect_code',''), (v_d->>'points')::int,
          NULLIF(v_d->>'position_from','')::numeric, COALESCE((v_d->>'hole')::boolean, false), NULLIF(v_d->>'size_band',''));
      END LOOP;
    END IF;
    v_out := v_out || jsonb_build_object('roll_id', v_r.id, 'inspection_id', v_id, 'result', v_final,
                                         'points_per_100_sqyd', v_score, 'threshold', v_thr);
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('rows', v_out));
EXCEPTION
  WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
  WHEN check_violation THEN RETURN public._mm_err('INVALID','Check units and defect points (1-4)');
END $$;

-- p_kind: 'test' | 'inspection'
CREATE OR REPLACE FUNCTION public.mm_qc_approve_deviation(p_kind text, p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN RETURN public._mm_err('REQUIRED','Give a reason'); END IF;
  IF p_kind = 'test' THEN
    UPDATE public.mm_qc_tests SET deviation_approved_by = public._mm_actor_id(), deviation_approved_at = now(), deviation_reason = btrim(p_reason)
    WHERE id = p_id AND factory_id = v_factory AND result = 'fail' AND voided_at IS NULL;
  ELSIF p_kind = 'inspection' THEN
    UPDATE public.mm_qc_inspections SET deviation_approved_by = public._mm_actor_id(), deviation_approved_at = now(), deviation_reason = btrim(p_reason)
    WHERE id = p_id AND factory_id = v_factory AND result = 'fail' AND voided_at IS NULL;
  ELSE RETURN public._mm_err('INVALID','kind must be test or inspection'); END IF;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','No failed, active record found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id));
END $$;

CREATE OR REPLACE FUNCTION public.mm_qc_void(p_kind text, p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN RETURN public._mm_err('REQUIRED','Give a reason'); END IF;
  IF p_kind = 'test' THEN
    UPDATE public.mm_qc_tests SET voided_at = now(), voided_by = public._mm_actor_id(), void_reason = btrim(p_reason)
    WHERE id = p_id AND factory_id = v_factory AND voided_at IS NULL;
  ELSIF p_kind = 'inspection' THEN
    UPDATE public.mm_qc_inspections SET voided_at = now(), voided_by = public._mm_actor_id(), void_reason = btrim(p_reason)
    WHERE id = p_id AND factory_id = v_factory AND voided_at IS NULL;
  ELSE RETURN public._mm_err('INVALID','kind must be test or inspection'); END IF;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Record not found or already void'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id));
END $$;

-- Cut at risk: only quality codes can be overridden
CREATE OR REPLACE FUNCTION public.mm_qc_approve_cut_at_risk(p_roll_ids uuid[], p_codes text[], p_reason text, p_expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_n int;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN RETURN public._mm_err('REQUIRED','Give a reason'); END IF;
  IF COALESCE(array_length(p_codes,1),0) = 0 OR EXISTS (SELECT 1 FROM unnest(p_codes) c WHERE c !~ '^(TEST|INSPECTION)_(MISSING|STALE|FAILED|HOLD|INCOMPLETE)$') THEN
    RETURN public._mm_err('INVALID','Only test and inspection blocks can be approved to cut at risk');
  END IF;
  INSERT INTO public.mm_qc_cut_approvals (factory_id, roll_id, codes, reason, approved_by, expires_at)
  SELECT v_factory, r.id, p_codes, btrim(p_reason), public._mm_actor_id(), p_expires_at
  FROM public.mm_rolls r WHERE r.factory_id = v_factory AND r.id = ANY (COALESCE(p_roll_ids,'{}'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN public._mm_ok(jsonb_build_object('approved', v_n));
END $$;

CREATE OR REPLACE FUNCTION public.mm_qc_revoke_cut_at_risk(p_approval_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  UPDATE public.mm_qc_cut_approvals SET revoked_at = now(), revoked_by = public._mm_actor_id()
  WHERE id = p_approval_id AND factory_id = v_factory AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Approval not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_approval_id));
END $$;

-- ── Migrate legacy quality data (originals untouched) ──
DO $$
DECLARE r record; v_t uuid; v_vals jsonb;
BEGIN
  FOR r IN SELECT mr.*, rr.process_round FROM public.mm_mill_rolls mr JOIN public.mm_rolls rr ON rr.id = mr.roll_id
           WHERE jsonb_typeof(mr.attributes) = 'object' LOOP
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_vals
    FROM jsonb_each(r.attributes) e
    WHERE EXISTS (SELECT 1 FROM public.mm_type_test_fields f WHERE f.factory_id = r.factory_id AND f.type_id = r.fabric_type_id
                  AND f.key = e.key AND f.is_active)
      AND e.value NOT IN ('null'::jsonb, '""'::jsonb);
    IF v_vals = '{}'::jsonb THEN CONTINUE; END IF;
    INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, stage_code, fabric_type_id, field_values, result,
      origin, tested_at, remarks, created_at, created_by)
    VALUES (r.factory_id, 'rolls', NULL, 'mill', 'FINISHED', r.fabric_type_id, v_vals, 'pass', 'migrated', r.created_at,
      'Migrated from mill roll entry', now(), r.created_by)
    RETURNING id INTO v_t;
    INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test) VALUES (r.factory_id, v_t, r.roll_id, r.process_round);
  END LOOP;

  INSERT INTO public.mm_qc_inspections (factory_id, roll_id, round_at_inspection, site_side, stage_code, inspected_length, length_uom,
    cuttable_width, width_uom, pts_1, pts_2, pts_3, pts_4, total_points, points_per_100_sqyd, threshold_used, result_computed,
    result_override, override_reason, result, deviation_approved_by, deviation_approved_at, deviation_reason, origin,
    legacy_inspection_id, inspected_at, remarks, created_at, created_by)
  SELECT i.factory_id, COALESCE(u.roll_id, m.roll_id), 0, i.site, 'FINISHED', i.inspected_length, 'm',
    i.cuttable_width, CASE WHEN i.width_uom = 'cm' THEN 'cm' ELSE 'in' END,
    COALESCE(i.pts_1,0), COALESCE(i.pts_2,0), COALESCE(i.pts_3,0), COALESCE(i.pts_4,0),
    COALESCE(i.total_points, COALESCE(i.pts_1,0) + 2*COALESCE(i.pts_2,0) + 3*COALESCE(i.pts_3,0) + 4*COALESCE(i.pts_4,0)),
    i.points_per_100_sqyd, i.threshold_used,
    CASE WHEN i.result_computed IN ('pass','fail') THEN i.result_computed END,
    CASE WHEN i.result_override IN ('pass','fail') THEN i.result_override END, i.override_reason, i.result,
    i.deviation_approved_by, i.deviation_approved_at, i.deviation_reason, 'migrated', i.id,
    COALESCE(i.inspected_at, i.created_at), i.remarks, now(), i.created_by
  FROM public.mm_warehouse_inspections i
  LEFT JOIN public.mm_stock_units u ON u.id = i.stock_unit_id
  LEFT JOIN public.mm_mill_rolls m ON m.id = i.mill_roll_id
  WHERE COALESCE(u.roll_id, m.roll_id) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.mm_qc_inspections q WHERE q.legacy_inspection_id = i.id);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public._mm_roll_custody(uuid)','public._mm_roll_alive(uuid)','public._mm_qc_scope_rolls(uuid,text,uuid)',
    'public._mm_qc_threshold(uuid)','public._mm_qc_passport(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.mm_qc_save_test(jsonb)','public.mm_qc_save_inspections(jsonb)',
    'public.mm_qc_approve_deviation(text,uuid,text)','public.mm_qc_void(text,uuid,text)',
    'public.mm_qc_approve_cut_at_risk(uuid[],text[],text,timestamptz)','public.mm_qc_revoke_cut_at_risk(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;;
