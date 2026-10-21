-- =====================================================================
-- Remove the Fabric Mill completely (2026-10-15)
-- Runs as ONE transaction. If anything fails (patch mismatch, compile error,
-- leftover 'mill', self-test), everything rolls back and nothing changes.
-- =====================================================================
BEGIN;
-- temp patch helper: replace exact text in one public function; asserts the expected count.
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  -- the SQL editor on Windows may hand us CRLF; function bodies are stored with LF
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := pg_get_functiondef(v_oid);
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN
    RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120);
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;
CREATE OR REPLACE FUNCTION pg_temp.recheck(p_name text) RETURNS void LANGUAGE plpgsql AS $rc$
DECLARE v_oid oid;
BEGIN
  FOR v_oid IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name LOOP
    EXECUTE pg_get_functiondef(v_oid);
  END LOOP;
END $rc$;

SET LOCAL check_function_bodies = off;

-- ---------- 1. carry mill links over to the warehouse copy ----------
ALTER TABLE public.mm_process_out_lines DROP CONSTRAINT IF EXISTS mm_process_out_lines_check;  -- one-of(mill_roll_id, stock_unit_id) check would block the remap
UPDATE public.mm_process_out_lines l SET stock_unit_id = u.id
FROM public.mm_mill_rolls m JOIN public.mm_stock_units u ON u.roll_id = m.roll_id
WHERE l.mill_roll_id = m.id AND l.stock_unit_id IS NULL;
UPDATE public.mm_process_return_lines l SET stock_unit_id = u.id
FROM public.mm_mill_rolls m JOIN public.mm_stock_units u ON u.roll_id = m.roll_id
WHERE l.mill_roll_id = m.id AND l.stock_unit_id IS NULL;
UPDATE public.mm_roll_allocations a SET stock_unit_id = u.id
FROM public.mm_mill_rolls m JOIN public.mm_stock_units u ON u.roll_id = m.roll_id
WHERE a.mill_roll_id = m.id AND a.stock_unit_id IS NULL;
UPDATE public.mm_shade_history h SET stock_unit_id = u.id
FROM public.mm_mill_rolls m JOIN public.mm_stock_units u ON u.roll_id = m.roll_id
WHERE h.mill_roll_id = m.id AND h.stock_unit_id IS NULL;
-- keep the old batch numbers on the receipt as a note
UPDATE public.mm_in_challans c SET remarks = concat_ws(' · ', NULLIF(btrim(c.remarks), ''), 'Old batch ' || x.nos)
FROM (SELECT u.in_challan_id, string_agg(DISTINCT b.batch_no, ', ') AS nos
      FROM public.mm_stock_units u JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      WHERE u.in_challan_id IS NOT NULL GROUP BY u.in_challan_id) x
WHERE x.in_challan_id = c.id;
-- the virtual MILL location stays only for ledger history
UPDATE public.mm_locations SET code = 'INHOUSE', name = 'In-house (old)', is_active = false WHERE code = 'MILL';

-- ---------- 2. values: mill -> inhouse / warehouse ----------
ALTER TABLE public.mm_facilities DROP CONSTRAINT mm_facilities_kind_check;
UPDATE public.mm_facilities SET kind = 'inhouse', name = CASE WHEN name ILIKE '%mill%' THEN 'In-house' ELSE name END,
  code = regexp_replace(code, '^MILL-', 'IH-') WHERE kind = 'mill';
ALTER TABLE public.mm_facilities ADD CONSTRAINT mm_facilities_kind_check CHECK (kind = ANY (ARRAY['inhouse','process_unit','warehouse','vendor']));

-- roll origin / stock source / receipt source: mill -> inhouse
ALTER TABLE public.mm_rolls DROP CONSTRAINT mm_rolls_origin_check;
UPDATE public.mm_rolls SET origin = 'inhouse' WHERE origin = 'mill';
ALTER TABLE public.mm_rolls ADD CONSTRAINT mm_rolls_origin_check CHECK (origin = ANY (ARRAY['inhouse','vendor','process']));

ALTER TABLE public.mm_stock_units DROP CONSTRAINT mm_stock_units_source_chk;
UPDATE public.mm_stock_units SET source = 'inhouse' WHERE source = 'mill';
ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_source_chk CHECK (source = ANY (ARRAY['inhouse','vendor']));

ALTER TABLE public.mm_in_challans DROP CONSTRAINT mm_in_challans_source_chk;
UPDATE public.mm_in_challans SET source = 'inhouse' WHERE source = 'mill';
ALTER TABLE public.mm_in_challans ADD CONSTRAINT mm_in_challans_source_chk CHECK (source = ANY (ARRAY['inhouse','vendor']));

-- processing is sent from the warehouse only
ALTER TABLE public.mm_process_challans DROP CONSTRAINT mm_process_challans_origin_check;
UPDATE public.mm_process_challans SET origin = 'warehouse' WHERE origin = 'mill';
ALTER TABLE public.mm_process_challans ADD CONSTRAINT mm_process_challans_origin_check CHECK (origin = 'warehouse');

-- QC: no mill site, no mill_batch scope (old batch tests become receipt tests)
ALTER TABLE public.mm_qc_tests DROP CONSTRAINT mm_qc_tests_site_side_check;
ALTER TABLE public.mm_qc_tests DROP CONSTRAINT mm_qc_tests_scope_kind_check;
UPDATE public.mm_qc_tests t SET scope_kind = 'in_challan',
  scope_id = (SELECT u.in_challan_id FROM public.mm_qc_test_rolls tr JOIN public.mm_stock_units u ON u.roll_id = tr.roll_id
              WHERE tr.test_id = t.id AND u.in_challan_id IS NOT NULL LIMIT 1)
WHERE t.scope_kind = 'mill_batch';
UPDATE public.mm_qc_tests SET site_side = 'warehouse' WHERE site_side = 'mill';
ALTER TABLE public.mm_qc_tests ADD CONSTRAINT mm_qc_tests_site_side_check CHECK (site_side = ANY (ARRAY['processing','warehouse']));
ALTER TABLE public.mm_qc_tests ADD CONSTRAINT mm_qc_tests_scope_kind_check CHECK (scope_kind = ANY (ARRAY['process_challan','process_lot','in_challan','rolls']));

ALTER TABLE public.mm_qc_inspections DROP CONSTRAINT mm_qc_inspections_site_side_check;
UPDATE public.mm_qc_inspections SET site_side = 'warehouse' WHERE site_side = 'mill';
ALTER TABLE public.mm_qc_inspections ADD CONSTRAINT mm_qc_inspections_site_side_check CHECK (site_side = ANY (ARRAY['processing','warehouse']));

-- history sides
ALTER TABLE public.mm_roll_allocations DROP CONSTRAINT mm_roll_allocations_side_check;
UPDATE public.mm_roll_allocations SET side = 'warehouse' WHERE side = 'mill';
ALTER TABLE public.mm_roll_allocations ADD CONSTRAINT mm_roll_allocations_side_check CHECK (side = 'warehouse');
ALTER TABLE public.mm_shade_history DROP CONSTRAINT mm_shade_history_side_check;
UPDATE public.mm_shade_history SET side = 'warehouse' WHERE side = 'mill';
ALTER TABLE public.mm_shade_history ADD CONSTRAINT mm_shade_history_side_check CHECK (side = 'warehouse');

-- legacy inspections: warehouse site, receipt scope only
ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT mm_warehouse_inspections_site_chk;
ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT mm_warehouse_inspections_scope_kind_chk;
ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT mm_warehouse_inspections_scope_shape_chk;
UPDATE public.mm_warehouse_inspections SET site = 'warehouse' WHERE site = 'mill';
ALTER TABLE public.mm_warehouse_inspections ADD CONSTRAINT mm_warehouse_inspections_site_chk CHECK (site = 'warehouse');
ALTER TABLE public.mm_warehouse_inspections ADD CONSTRAINT mm_warehouse_inspections_scope_kind_chk CHECK (scope_kind = ANY (ARRAY['in_challan','process_challan']));
ALTER TABLE public.mm_warehouse_inspections ADD CONSTRAINT mm_warehouse_inspections_scope_shape_chk CHECK (
  ((scope_kind = 'in_challan') AND (in_challan_id = scope_id) AND (stock_unit_id IS NOT NULL))
  OR ((scope_kind = 'process_challan') AND (process_challan_id = scope_id) AND (stock_unit_id IS NOT NULL)));

-- test fields: one capture site (the warehouse) -> column goes
ALTER TABLE public.mm_type_test_fields DROP CONSTRAINT mm_type_test_fields_capture_site_chk;

-- feature flags + doc sequence
DELETE FROM public.mm_factory_features WHERE feature_key IN ('in_house_mill','fabric_mill');
ALTER TABLE public.mm_factory_features DROP CONSTRAINT mm_factory_features_key_chk;
ALTER TABLE public.mm_factory_features ADD CONSTRAINT mm_factory_features_key_chk CHECK (feature_key = ANY (ARRAY['receive_goods','test_rolls','fabric_v4','fabric_warehouse','trims']));
DELETE FROM public.doc_sequences WHERE doc_type = 'MILL';
ALTER TABLE public.doc_sequences DROP CONSTRAINT doc_sequences_type_check;
ALTER TABLE public.doc_sequences ADD CONSTRAINT doc_sequences_type_check CHECK (doc_type = ANY (ARRAY['GRN','MV','ROLL','PACK','SC']));

-- ---------- 3. functions: last 'mill' literals ----------
CREATE OR REPLACE FUNCTION public._mm_inhouse_unit(p_factory uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.mm_facilities
  WHERE factory_id = p_factory AND kind = 'inhouse' AND ownership = 'internal' AND is_active
  ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name, is_active, created_by, updated_by)
    VALUES (p_factory, 'inhouse', 'internal', public._mm_partner_next_code(p_factory, 'inhouse'), 'In-house', true,
            public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public._mm_is_fabric_maker(p_fac uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.mm_facilities f WHERE f.id = p_fac AND (
      f.kind = 'inhouse'
      OR (f.kind = 'process_unit' AND EXISTS (
            SELECT 1 FROM public.mm_facility_process_types x JOIN public.mm_process_types t ON t.id = x.process_type_id
            WHERE x.facility_id = f.id AND t.makes_fabric AND t.active))))
$function$;

CREATE OR REPLACE FUNCTION public._mm_partner_kind(p_kind text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_kind WHEN 'process_vendor' THEN 'process_unit' WHEN 'fabric_vendor' THEN 'vendor' WHEN 'inhouse' THEN 'inhouse' END
$function$;

CREATE OR REPLACE FUNCTION public._mm_partner_next_code(p_factory uuid, p_fkind text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prefix text := CASE p_fkind WHEN 'process_unit' THEN 'PV' WHEN 'vendor' THEN 'FV' WHEN 'inhouse' THEN 'IH' ELSE 'WH' END;
  v_n int; v_code text;
BEGIN
  SELECT count(*) INTO v_n FROM public.mm_facilities WHERE factory_id = p_factory AND kind = p_fkind;
  LOOP
    v_n := v_n + 1;
    v_code := v_prefix || '-' || lpad(v_n::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.mm_facilities WHERE factory_id = p_factory AND code = v_code);
  END LOOP;
  RETURN v_code;
END $function$;


SELECT pg_temp.fx('_mm_v4_seed_masters', $o$(p_factory, 'mill', 'internal', 'MILL-1', 'In-house mill')$o$, $n$(p_factory, 'inhouse', 'internal', 'IH-001', 'In-house')$n$);

SELECT pg_temp.fx('mm_save_facility', $o$v_kind NOT IN ('mill','process_unit','warehouse','vendor')$o$, $n$v_kind NOT IN ('inhouse','process_unit','warehouse','vendor')$n$);

SELECT pg_temp.fx('next_doc_no', $o$('GRN', 'MV', 'ROLL', 'PACK', 'MILL', 'SC')$o$, $n$('GRN', 'MV', 'ROLL', 'PACK', 'SC')$n$);

SELECT pg_temp.fx('_mm_registry_on_stock_unit', $o$CASE WHEN NEW.source = 'mill' THEN 'mill' ELSE 'vendor' END$o$, $n$CASE WHEN NEW.source = 'inhouse' THEN 'inhouse' ELSE 'vendor' END$n$);

SELECT pg_temp.fx('mm_list_partners', $o$'mill'$o$, $n$'inhouse'$n$, 3);
SELECT pg_temp.fx('mm_list_partners', $o$fabric_vendor or mill'$o$, $n$fabric_vendor or inhouse'$n$);
SELECT pg_temp.fx('mm_save_partner', $o$'mill'$o$, $n$'inhouse'$n$);
SELECT pg_temp.fx('mm_save_partner', $o$fabric_vendor or mill'$o$, $n$fabric_vendor or inhouse'$n$);
SELECT pg_temp.fx('mm_list_inspection_queue', $o$u.source = 'mill'$o$, $n$u.source = 'inhouse'$n$, 2);
SELECT pg_temp.fx('mm_wh_list_receipts', $o$c.source = 'mill'$o$, $n$c.source = 'inhouse'$n$, 2);
SELECT pg_temp.fx('mm_wh_get_receipt', $o$v_c.source = 'mill'$o$, $n$v_c.source = 'inhouse'$n$);
SELECT pg_temp.fx('mm_proc_get_challan', $o$f.kind = 'mill'$o$, $n$f.kind = 'inhouse'$n$);
SELECT pg_temp.fx('mm_proc_list_challans', $o$f.kind = 'mill'$o$, $n$f.kind = 'inhouse'$n$);
SELECT pg_temp.fx('mm_proc_send', $o$v_fac.kind = 'mill'$o$, $n$v_fac.kind = 'inhouse'$n$);
SELECT pg_temp.fx('mm_list_processes', $o$kind = 'mill'$o$, $n$kind = 'inhouse'$n$);
SELECT pg_temp.fx('mm_list_in_challans', $o$p_source = 'mill'$o$, $n$p_source = 'inhouse'$n$);
SELECT pg_temp.fx('mm_get_warehouse_dashboard', $o$u.source = 'mill'$o$, $n$u.source = 'inhouse'$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$THEN 'mill' ELSE 'vendor'$o$, $n$THEN 'inhouse' ELSE 'vendor'$n$);
-- roll numbers are unique per receipt (the receipt is the batch), not factory-wide
SELECT pg_temp.fx('mm_wh_receive', $o$      IF EXISTS (SELECT 1 FROM public.mm_stock_units WHERE factory_id = v_factory AND unit_code = v_code) THEN
        RETURN public._mm_err('DUPLICATE', 'Roll ' || v_code || ' already exists');
      END IF;
$o$, '');

-- end-bit returns: mill_shade -> issued_shade
ALTER TABLE public.mm_end_bit_returns RENAME COLUMN mill_shade TO issued_shade;
SELECT pg_temp.fx('mm_list_end_bit_returns', $o$r.mill_shade,$o$, $n$r.issued_shade,$n$);
SELECT pg_temp.fx('mm_save_lay_consumptions', $o$mill_shade, tested_shade, unit_code$o$, $n$issued_shade, tested_shade, unit_code$n$);

-- ---------- 4. drop the mill ----------
DROP TRIGGER IF EXISTS trg_mm_inherit_mill_inspection ON public.mm_stock_units;

DO $d$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname ILIKE '%mill%' OR p.proname IN (
        'mm_get_process_challan','mm_receive_process_return','mm_send_to_process','mm_set_batch_fabric',
        'mm_set_batch_style_intents','_mm_apply_roll_tags_from_payload','_mm_v4_selftest','mm_receive_in_challan_lines',
        'mm_set_factory_feature','mm_wh_save_vendor_grn_v5','mm_wh_save_vendor_grn_v4'))
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
  END LOOP;
END $d$;

DROP VIEW IF EXISTS public.mm_v_mill_accuracy_summary;
DROP VIEW IF EXISTS public.mm_v_mill_field_accuracy;

DROP FUNCTION public._mm_roll_stock(uuid);
CREATE FUNCTION public._mm_roll_stock(p_factory uuid)
 RETURNS TABLE(roll_id uuid, roll_code text, fabric_id uuid, fabric_type_id uuid, side text, bucket text, style_material_id uuid, colour text, qty_kg numeric, qty_m numeric, qty numeric, uom text, stock_unit_id uuid, out_line_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH proc AS (
    SELECT l.roll_id, l.id AS out_line_id, l.qty, l.uom, l.qty_kg, l.color_ref,
           su.style_material_id AS sm_id, l.stock_unit_id
    FROM public.mm_process_out_lines l
    LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id
    WHERE l.factory_id = p_factory AND l.line_status = 'out' AND l.roll_id IS NOT NULL
  ), base AS (
    SELECT p.roll_id, 'processing'::text AS side, 'at_processing'::text AS bucket, p.sm_id, p.color_ref,
           CASE WHEN lower(COALESCE(p.uom, '')) = 'kg' THEN p.qty ELSE p.qty_kg END AS kg,
           CASE WHEN lower(COALESCE(p.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN p.qty END AS m,
           p.stock_unit_id, p.out_line_id
    FROM proc p
    UNION ALL
    SELECT u.roll_id, 'warehouse',
           CASE WHEN u.on_hold THEN 'on_hold'
                WHEN u.status = 'pending_qc' THEN 'qc_pending'
                WHEN u.status = 'rejected' THEN 'rejected'
                WHEN u.status IN ('issued', 'issued_pending', 'partially_consumed') THEN 'issued'
                ELSE 'in_stock' END,
           u.style_material_id, u.color_ref,
           CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) = 'kg' THEN u.qty_available ELSE u.weight_kg END,
           CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN u.qty_available ELSE u.length_m END,
           u.id, NULL::uuid
    FROM public.mm_stock_units u
    WHERE u.factory_id = p_factory AND u.roll_id IS NOT NULL
      AND u.status NOT IN ('consumed', 'written_off', 'returned_to_supplier', 'missing', 'cancelled', 'draft')
      AND COALESCE(u.qty_available, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM proc p WHERE p.roll_id = u.roll_id)
  )
  SELECT b.roll_id, r.roll_code, r.fabric_id, r.fabric_type_id, b.side, b.bucket, b.sm_id,
         COALESCE(NULLIF(btrim(cm.fabric_color), ''), cw.name, NULLIF(btrim(b.color_ref), '')) AS colour,
         b.kg, b.m,
         CASE f.uom WHEN 'kg' THEN b.kg WHEN 'm' THEN b.m ELSE NULL END,
         COALESCE(f.uom, 'mixed'),
         b.stock_unit_id, b.out_line_id
  FROM base b
  JOIN public.mm_rolls r ON r.id = b.roll_id
  LEFT JOIN public.mm_fabrics f ON f.id = r.fabric_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = b.sm_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id;
$function$;
REVOKE ALL ON FUNCTION public._mm_roll_stock(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.mm_process_out_lines DROP COLUMN mill_roll_id;
ALTER TABLE public.mm_process_out_lines ALTER COLUMN stock_unit_id SET NOT NULL;
ALTER TABLE public.mm_process_return_lines DROP COLUMN mill_roll_id;
ALTER TABLE public.mm_roll_allocations DROP COLUMN mill_roll_id;
ALTER TABLE public.mm_shade_history DROP COLUMN mill_roll_id;
ALTER TABLE public.mm_warehouse_inspections DROP COLUMN mill_batch_id, DROP COLUMN mill_roll_id;
ALTER TABLE public.mm_stock_units DROP COLUMN mill_batch_id, DROP COLUMN mill_roll_id, DROP COLUMN mill_snapshot;
ALTER TABLE public.mm_rolls DROP COLUMN mill_batch_id;
ALTER TABLE public.colorway_materials DROP COLUMN mill_short_closed, DROP COLUMN mill_short_closed_at,
  DROP COLUMN mill_short_closed_by, DROP COLUMN mill_short_closed_reason;
ALTER TABLE public.mm_type_test_fields DROP COLUMN capture_site;
CREATE UNIQUE INDEX IF NOT EXISTS mm_stock_units_receipt_code_uidx
  ON public.mm_stock_units (factory_id, in_challan_id, lower(unit_code)) WHERE in_challan_id IS NOT NULL;

DROP TABLE public.mm_mill_batch_style_intents;
DROP TABLE public.mm_mill_rolls CASCADE;
DROP TABLE public.mm_mill_batches CASCADE;
DROP TABLE public.mm_mill_orders CASCADE;

-- ---------- 5. checks ----------
SET LOCAL check_function_bodies = on;
SELECT pg_temp.recheck(x) FROM unnest(ARRAY[
  '_mm_inhouse_unit','_mm_is_fabric_maker','_mm_partner_kind','_mm_partner_next_code','_mm_registry_on_stock_unit',
  '_mm_v4_seed_masters','mm_save_facility','next_doc_no','mm_list_partners','mm_save_partner','mm_list_inspection_queue',
  'mm_wh_list_receipts','mm_wh_get_receipt','mm_proc_get_challan','mm_proc_list_challans','mm_proc_send','mm_list_processes',
  'mm_list_in_challans','mm_get_warehouse_dashboard','mm_wh_receive','mm_list_end_bit_returns','mm_save_lay_consumptions']) x;

DO $c$
DECLARE v text;
BEGIN
  SELECT string_agg(proname, ', ') INTO v FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname ILIKE '%mill%' OR prosrc ~* 'mill');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'mill still in functions: %', v; END IF;
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v FROM information_schema.columns
  WHERE table_schema = 'public' AND (table_name ILIKE '%mill%' OR column_name ILIKE '%mill%');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'mill still in tables/columns: %', v; END IF;
  SELECT string_agg(conrelid::regclass || '.' || conname, ', ') INTO v FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace AND pg_get_constraintdef(oid) ~* 'mill';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'mill still in constraints: %', v; END IF;
  SELECT string_agg(c.relname, ', ') INTO v FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m') AND pg_get_viewdef(c.oid) ~* 'mill';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'mill still in views: %', v; END IF;
END $c$;

-- ---------- 6. self-test (rolled back inside a savepoint) ----------
DO $t$
DECLARE r jsonb; v_rc uuid; v_rc2 uuid; v_v uuid; v_roll uuid; v_ch uuid; v_line uuid; v_out text := '';
  v_fac uuid; v_sm uuid; v_fab uuid; v_unit uuid; v_dye uuid;
BEGIN
  BEGIN
    SELECT f.id, f.factory_id INTO v_fab, v_fac FROM public.mm_fabrics f WHERE f.code = 'FAB-RBC-0003' LIMIT 1;
    IF v_fab IS NULL THEN RAISE EXCEPTION 'SELFTEST SKIP (no FAB-RBC-0003)'; END IF;
    SELECT sm.id INTO v_sm FROM public.mm_style_materials sm WHERE sm.fabric_id = v_fab LIMIT 1;
    SELECT t.id INTO v_dye FROM public.mm_process_types t WHERE t.factory_id = v_fac AND t.name = 'Dyeing';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT p.id FROM public.profiles p WHERE p.factory_id = v_fac AND p.user_role IN ('admin','superadmin') LIMIT 1), 'role', 'authenticated')::text, true);
    INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name) VALUES (v_fac, 'vendor', 'external', 'FV-ZZ1', 'Selftest vendor') RETURNING id INTO v_v;
    r := public.mm_wh_receive(jsonb_build_object('source','external','from_facility_id',v_v,'fabric_id',v_fab,'stage_code','DYED','color','Navy',
          'purpose','style','style_material_id',v_sm,'uom','kg','rolls', jsonb_build_array(jsonb_build_object('roll_no','ZZ-1','weight_kg',20))));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'receive external: %', r; END IF;
    v_rc := (r->'data'->>'id')::uuid;
    IF (r->'data'->>'allocated')::int <> 1 THEN RAISE EXCEPTION 'finished roll not allocated: %', r; END IF;
    r := public.mm_wh_receive(jsonb_build_object('source','internal','fabric_id',v_fab,'stage_code','GREIGE','purpose','style','style_material_id',v_sm,
          'uom','kg','rolls', jsonb_build_array(jsonb_build_object('roll_no','ZG-1','weight_kg',25))));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'receive internal: %', r; END IF;
    v_rc2 := (r->'data'->>'id')::uuid;
    r := public.mm_list_rolls_v4(jsonb_build_object('receipt_id', v_rc2));
    v_roll := (r->'data'->'rows'->0->>'roll_id')::uuid;
    IF r->'data'->'rows'->0->>'origin' <> 'inhouse' THEN RAISE EXCEPTION 'internal roll origin: %', r->'data'->'rows'->0->>'origin'; END IF;
    IF (r->'data'->'rows'->0)::text ~* 'mill' THEN RAISE EXCEPTION 'roll row still says mill'; END IF;
    r := public.mm_proc_send(jsonb_build_object('inhouse', true, 'process_type_id', v_dye, 'roll_ids', jsonb_build_array(v_roll), 'target_color', 'Navy'));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'send in-house: %', r; END IF;
    v_ch := (r->'data'->>'id')::uuid;
    SELECT id INTO v_line FROM public.mm_process_out_lines WHERE challan_id = v_ch;
    r := public.mm_proc_return(jsonb_build_object('challan_id', v_ch, 'same_rolls', jsonb_build_array(jsonb_build_object('out_line_id', v_line, 'qty', 24))));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'return: %', r; END IF;
    r := public.mm_unbook_rolls(jsonb_build_object('roll_ids', jsonb_build_array(v_roll)));
    r := public.mm_allocate_rolls_v4(jsonb_build_object('style_material_id', v_sm, 'roll_ids', jsonb_build_array(v_roll), 'confirm', true, 'override_reason', 'selftest'));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'allocate after dyeing: %', r; END IF;
    r := public.mm_unallocate_rolls_v4(jsonb_build_object('roll_ids', jsonb_build_array(v_roll)));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'unallocate: %', r; END IF;
    FOR r IN SELECT x FROM (VALUES (public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_sm))),
                                    (public.mm_fabric_stock_summary('{}'::jsonb)), (public.mm_fabric_stock_rolls(jsonb_build_object('fabric_id', v_fab))),
                                    (public.mm_get_warehouse_dashboard()), (public.mm_get_rack_ops_board()), (public.mm_get_in_challan_rolls(v_rc)),
                                    (public.mm_wh_get_receipt(v_rc)), (public.mm_wh_list_receipts('{}'::jsonb)), (public.mm_list_partners('inhouse', true)),
                                    (public.mm_qc_list_queue('{}'::jsonb)), (public.mm_list_test_fields(NULL)), (public.mm_get_material_features()),
                                    (public.mm_proc_list_challans('{}'::jsonb)), (public.mm_list_processes()), (public.mm_list_end_bit_returns()),
                                    (public.mm_list_inspection_queue()), (public.mm_list_in_challans('inhouse', 'all'))) v(x) LOOP
      IF NOT COALESCE((r->>'ok')::boolean, false) THEN RAISE EXCEPTION 'reader failed: %', left(r::text, 300); END IF;
    END LOOP;
    SELECT id INTO v_unit FROM public.mm_stock_units WHERE in_challan_id = v_rc LIMIT 1;
    r := public.mm_save_inspections('in_challan', v_rc, jsonb_build_array(jsonb_build_object('id', v_unit, 'result', 'pass')));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'legacy inspection: %', r; END IF;
    IF EXISTS (SELECT 1 FROM public.mm_roll_drift) THEN RAISE EXCEPTION 'roll drift not empty'; END IF;
    RAISE EXCEPTION 'SELFTEST PASS';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('SELFTEST PASS') AND SQLERRM NOT LIKE 'SELFTEST SKIP%' THEN RAISE; END IF;
    RAISE NOTICE '%', SQLERRM;
  END;
END $t$;

DROP SCHEMA IF EXISTS zz_tmp CASCADE;

COMMIT;
