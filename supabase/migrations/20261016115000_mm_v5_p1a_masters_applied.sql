-- v5 Phase 1A parts 1-2 (ALREADY APPLIED LIVE as mm_v5_p1a_vendors_constructions + mm_v5_p1a_reqfields_features). Repo record only; do not re-run.
-- =====================================================================
-- v5 Phase 1A (live, non-destructive): masters move to their new homes.
-- RPC outputs keep the same keys, so the app does not change.
-- Old tables / columns are dropped later by p1b (run by Rahil).
-- =====================================================================
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;
SET LOCAL check_function_bodies = off;

-- ---------- 1. vendors: two plain tables ----------
CREATE TABLE IF NOT EXISTS public.mm_fabric_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  ownership text NOT NULL DEFAULT 'external' CHECK (ownership IN ('internal','external')),
  contact text, address text, remarks text,
  is_active boolean NOT NULL DEFAULT true,
  row_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  UNIQUE (factory_id, code)
);
CREATE TABLE IF NOT EXISTS public.mm_processing_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  ownership text NOT NULL DEFAULT 'external' CHECK (ownership IN ('internal','external')),
  process_type_ids uuid[] NOT NULL DEFAULT '{}',
  contact text, address text, remarks text,
  is_active boolean NOT NULL DEFAULT true,
  row_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  UNIQUE (factory_id, code)
);
ALTER TABLE public.mm_fabric_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mm_processing_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY mm_fabric_vendors_mm_select ON public.mm_fabric_vendors FOR SELECT USING (factory_id = public.current_factory_id());
CREATE POLICY mm_processing_vendors_mm_select ON public.mm_processing_vendors FOR SELECT USING (factory_id = public.current_factory_id());
REVOKE ALL ON public.mm_fabric_vendors, public.mm_processing_vendors FROM anon;
GRANT SELECT ON public.mm_fabric_vendors, public.mm_processing_vendors TO authenticated;

-- same ids as before, so every existing reference stays valid
INSERT INTO public.mm_fabric_vendors (id, factory_id, code, name, ownership, contact, address, remarks, is_active, row_version, created_at, created_by, updated_at, updated_by)
SELECT id, factory_id, code, name, CASE WHEN kind = 'inhouse' THEN 'internal' ELSE 'external' END, contact, address, remarks, is_active, row_version, created_at, created_by, updated_at, updated_by
FROM public.mm_facilities WHERE kind IN ('vendor','inhouse')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.mm_processing_vendors (id, factory_id, code, name, ownership, process_type_ids, contact, address, remarks, is_active, row_version, created_at, created_by, updated_at, updated_by)
SELECT f.id, f.factory_id, f.code, f.name, CASE WHEN f.kind = 'inhouse' THEN 'internal' ELSE f.ownership END,
       COALESCE(ARRAY(SELECT x.process_type_id FROM public.mm_facility_process_types x WHERE x.facility_id = f.id), '{}'),
       f.contact, f.address, f.remarks, f.is_active, f.row_version, f.created_at, f.created_by, f.updated_at, f.updated_by
FROM public.mm_facilities f WHERE f.kind IN ('process_unit','inhouse')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.mm_in_challans ADD CONSTRAINT mm_in_challans_from_vendor_fkey FOREIGN KEY (from_facility_id) REFERENCES public.mm_fabric_vendors(id);
ALTER TABLE public.mm_rolls ADD CONSTRAINT mm_rolls_origin_vendor_fkey FOREIGN KEY (origin_facility_id) REFERENCES public.mm_fabric_vendors(id);
ALTER TABLE public.mm_process_challans ADD CONSTRAINT mm_process_challans_processing_vendor_fkey FOREIGN KEY (unit_facility_id) REFERENCES public.mm_processing_vendors(id);

CREATE OR REPLACE FUNCTION public._mm_vendor_next_code(p_factory uuid, p_table text, p_prefix text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int; v_code text; v_hit boolean;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE factory_id = $1', p_table) INTO v_n USING p_factory;
  LOOP
    v_n := v_n + 1;
    v_code := p_prefix || '-' || lpad(v_n::text, 3, '0');
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE factory_id = $1 AND code = $2)', p_table) INTO v_hit USING p_factory, v_code;
    EXIT WHEN NOT v_hit;
  END LOOP;
  RETURN v_code;
END $function$;

-- kept for compatibility (same name, same args): 'vendor' / 'inhouse' -> fabric vendors, 'process_unit' -> processing vendors
CREATE OR REPLACE FUNCTION public._mm_partner_next_code(p_factory uuid, p_fkind text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE p_fkind
    WHEN 'process_unit' THEN public._mm_vendor_next_code(p_factory, 'mm_processing_vendors', 'PV')
    WHEN 'inhouse' THEN public._mm_vendor_next_code(p_factory, 'mm_fabric_vendors', 'IH')
    ELSE public._mm_vendor_next_code(p_factory, 'mm_fabric_vendors', 'FV') END
$function$;

-- In-house: one internal fabric vendor + one internal processing vendor (same id)
CREATE OR REPLACE FUNCTION public._mm_inhouse_fabric_vendor(p_factory uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.mm_fabric_vendors
  WHERE factory_id = p_factory AND ownership = 'internal' AND is_active ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_fabric_vendors (factory_id, code, name, ownership, created_by, updated_by)
    VALUES (p_factory, public._mm_vendor_next_code(p_factory, 'mm_fabric_vendors', 'IH'), 'In-house', 'internal', public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public._mm_inhouse_process_vendor(p_factory uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_fab uuid;
BEGIN
  SELECT id INTO v_id FROM public.mm_processing_vendors
  WHERE factory_id = p_factory AND ownership = 'internal' AND is_active ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    v_fab := public._mm_inhouse_fabric_vendor(p_factory);
    INSERT INTO public.mm_processing_vendors (id, factory_id, code, name, ownership, created_by, updated_by)
    SELECT v.id, v.factory_id, v.code, v.name, 'internal', public._mm_actor_id(), public._mm_actor_id()
    FROM public.mm_fabric_vendors v WHERE v.id = v_fab
    ON CONFLICT (id) DO UPDATE SET is_active = true
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.mm_list_partners(p_kind text, p_include_inactive boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_kind text := public._mm_partner_kind(p_kind);
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF v_kind IS NULL THEN RETURN public._mm_err('INVALID', 'kind must be process_vendor, fabric_vendor or inhouse'); END IF;
  IF v_kind = 'process_unit' THEN
    RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'inhouse', false, 'contact', v.contact, 'address', v.address, 'is_active', v.is_active, 'row_version', v.row_version,
        'process_type_ids', to_jsonb(v.process_type_ids),
        'processes', COALESCE((SELECT jsonb_agg(t.name ORDER BY t.sort_order, t.name) FROM public.mm_process_types t WHERE t.id = ANY (v.process_type_ids)), '[]'::jsonb),
        'machine_count', NULL,
        'in_use', EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.unit_facility_id = v.id))
        ORDER BY v.is_active DESC, v.name)
      FROM public.mm_processing_vendors v
      WHERE v.factory_id = v_factory AND v.ownership = 'external' AND (p_include_inactive OR v.is_active)
    ), '[]'::jsonb)));
  END IF;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'name', v.name, 'inhouse', v.ownership = 'internal', 'contact', v.contact, 'address', v.address, 'is_active', v.is_active, 'row_version', v.row_version,
      'process_type_ids', NULL, 'processes', NULL,
      'machine_count', CASE WHEN v_kind = 'inhouse' THEN 0 END,
      'in_use', EXISTS (SELECT 1 FROM public.mm_in_challans c WHERE c.from_facility_id = v.id)
             OR EXISTS (SELECT 1 FROM public.mm_rolls r WHERE r.origin_facility_id = v.id)
             OR EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.unit_facility_id = v.id))
      ORDER BY v.is_active DESC, v.name)
    FROM public.mm_fabric_vendors v
    WHERE v.factory_id = v_factory AND v.ownership = CASE WHEN v_kind = 'inhouse' THEN 'internal' ELSE 'external' END
      AND (p_include_inactive OR v.is_active)
  ), '[]'::jsonb)));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_save_partner(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_kind text := public._mm_partner_kind(p_row->>'kind'); v_id uuid; v_name text; v_rv int; v_pts uuid[];
  v_contact text := NULLIF(btrim(COALESCE(p_row->>'contact', '')), ''); v_address text := NULLIF(btrim(COALESCE(p_row->>'address', '')), '');
  v_own text; v_actor uuid := public._mm_actor_id();
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF v_kind IS NULL THEN RETURN public._mm_err('INVALID', 'kind must be process_vendor, fabric_vendor or inhouse'); END IF;
  BEGIN v_id := NULLIF(p_row->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid id'); END;
  v_name := NULLIF(btrim(COALESCE(p_row->>'name', '')), '');
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Name is required'); END IF;

  IF v_kind = 'process_unit' THEN
    IF EXISTS (SELECT 1 FROM public.mm_processing_vendors v WHERE v.factory_id = v_factory AND lower(btrim(v.name)) = lower(v_name) AND v.id IS DISTINCT FROM v_id) THEN
      RETURN public._mm_err('DUPLICATE', 'That name is already used');
    END IF;
    IF p_row ? 'process_type_ids' THEN
      v_pts := ARRAY(SELECT t.id FROM public.mm_process_types t
                     WHERE t.factory_id = v_factory AND t.id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_row->'process_type_ids', '[]'::jsonb)) x));
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.mm_processing_vendors (factory_id, code, name, ownership, process_type_ids, contact, address, is_active, created_by, updated_by)
      VALUES (v_factory, public._mm_vendor_next_code(v_factory, 'mm_processing_vendors', 'PV'), v_name, 'external', COALESCE(v_pts, '{}'),
              v_contact, v_address, COALESCE((p_row->>'is_active')::boolean, true), v_actor, v_actor)
      RETURNING id INTO v_id;
    ELSE
      SELECT row_version INTO v_rv FROM public.mm_processing_vendors WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Not found'); END IF;
      IF p_row ? 'row_version' AND NULLIF(p_row->>'row_version', '')::int IS DISTINCT FROM v_rv THEN
        RETURN public._mm_err('STALE', 'Changed elsewhere. Reload and try again');
      END IF;
      UPDATE public.mm_processing_vendors SET name = v_name,
        contact = CASE WHEN p_row ? 'contact' THEN v_contact ELSE contact END,
        address = CASE WHEN p_row ? 'address' THEN v_address ELSE address END,
        process_type_ids = COALESCE(v_pts, process_type_ids),
        is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
    END IF;
    RETURN public._mm_ok(jsonb_build_object('id', v_id));
  END IF;

  v_own := CASE WHEN v_kind = 'inhouse' THEN 'internal' ELSE 'external' END;
  IF EXISTS (SELECT 1 FROM public.mm_fabric_vendors v WHERE v.factory_id = v_factory AND v.ownership = v_own
             AND lower(btrim(v.name)) = lower(v_name) AND v.id IS DISTINCT FROM v_id) THEN
    RETURN public._mm_err('DUPLICATE', 'That name is already used');
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_fabric_vendors (factory_id, code, name, ownership, contact, address, is_active, created_by, updated_by)
    VALUES (v_factory, public._mm_vendor_next_code(v_factory, 'mm_fabric_vendors', CASE WHEN v_own = 'internal' THEN 'IH' ELSE 'FV' END),
            v_name, v_own, v_contact, v_address, COALESCE((p_row->>'is_active')::boolean, true), v_actor, v_actor)
    RETURNING id INTO v_id;
  ELSE
    SELECT row_version INTO v_rv FROM public.mm_fabric_vendors WHERE id = v_id AND factory_id = v_factory AND ownership = v_own FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Not found'); END IF;
    IF p_row ? 'row_version' AND NULLIF(p_row->>'row_version', '')::int IS DISTINCT FROM v_rv THEN
      RETURN public._mm_err('STALE', 'Changed elsewhere. Reload and try again');
    END IF;
    UPDATE public.mm_fabric_vendors SET name = v_name,
      contact = CASE WHEN p_row ? 'contact' THEN v_contact ELSE contact END,
      address = CASE WHEN p_row ? 'address' THEN v_address ELSE address END,
      is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
      row_version = row_version + 1, updated_at = now(), updated_by = v_actor
    WHERE id = v_id;
  END IF;
  -- the in-house unit also processes: keep its processing-vendor twin in step
  IF v_own = 'internal' THEN
    INSERT INTO public.mm_processing_vendors (id, factory_id, code, name, ownership, is_active, created_by, updated_by)
    SELECT v.id, v.factory_id, v.code, v.name, 'internal', v.is_active, v_actor, v_actor FROM public.mm_fabric_vendors v WHERE v.id = v_id
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, updated_at = now(), updated_by = v_actor;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_default_warehouse()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok((SELECT jsonb_build_object('id', l.id, 'name', l.name) FROM public.mm_locations l
                        WHERE l.factory_id = v_factory AND l.code = 'WAREHOUSE' LIMIT 1));
END $function$;

-- ---------- 2. constructions live on the fabric type ----------
ALTER TABLE public.mm_fabric_types ADD COLUMN IF NOT EXISTS constructions jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.mm_fabric_types t SET constructions = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'seq', c.seq, 'is_active', c.is_active) ORDER BY c.seq, c.name)
  FROM public.mm_fabric_constructions c WHERE c.fabric_type_id = t.id), '[]'::jsonb);

CREATE OR REPLACE FUNCTION public._mm_construction_name(p_type uuid, p_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT e->>'name' FROM public.mm_fabric_types t, jsonb_array_elements(t.constructions) e
  WHERE t.id = p_type AND e->>'id' = p_id::text LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_fabric_constructions(p_fabric_type_id uuid DEFAULT NULL::uuid, p_include_inactive boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_guard_err(SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', (e->>'id')::uuid, 'fabric_type_id', t.id, 'fabric_type_name', t.name,
      'name', e->>'name', 'seq', (e->>'seq')::int, 'is_active', COALESCE((e->>'is_active')::boolean, true),
      'used_on_fabrics', (SELECT count(*) FROM public.mm_fabrics f WHERE f.construction_id::text = e->>'id')
    ) ORDER BY t.seq, t.name, (e->>'seq')::int, e->>'name')
    FROM public.mm_fabric_types t, jsonb_array_elements(t.constructions) e
    WHERE t.factory_id = v_factory
      AND (p_fabric_type_id IS NULL OR t.id = p_fabric_type_id)
      AND (p_include_inactive OR COALESCE((e->>'is_active')::boolean, true))
  ), '[]'::jsonb)));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_save_fabric_construction(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_id uuid; v_type uuid; v_name text := btrim(COALESCE(p_row->>'name', '')); v_list jsonb; v_seq int;
BEGIN
  BEGIN v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_guard_err(SQLERRM); END;
  BEGIN
    v_id := NULLIF(p_row->>'id', '')::uuid;
    v_type := NULLIF(p_row->>'fabric_type_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid id'); END;
  IF v_name = '' THEN RETURN public._mm_err('REQUIRED', 'Construction name is required'); END IF;
  IF v_id IS NOT NULL THEN
    SELECT t.id INTO v_type FROM public.mm_fabric_types t, jsonb_array_elements(t.constructions) e
    WHERE t.factory_id = v_factory AND e->>'id' = v_id::text;
    IF v_type IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Construction not found'); END IF;
  ELSIF v_type IS NULL OR NOT EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = v_type AND factory_id = v_factory) THEN
    RETURN public._mm_err('REQUIRED', 'Pick a fabric type');
  END IF;
  SELECT constructions INTO v_list FROM public.mm_fabric_types WHERE id = v_type FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e WHERE lower(e->>'name') = lower(v_name) AND e->>'id' IS DISTINCT FROM v_id::text) THEN
    RETURN public._mm_err('DUPLICATE', 'This construction already exists for the fabric type');
  END IF;
  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    v_seq := COALESCE(public._mm_num(p_row->>'seq')::int, (SELECT COALESCE(max((e->>'seq')::int), 0) + 10 FROM jsonb_array_elements(v_list) e));
    v_list := v_list || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name, 'seq', v_seq, 'is_active', COALESCE((p_row->>'is_active')::boolean, true)));
  ELSE
    v_list := (SELECT jsonb_agg(CASE WHEN e->>'id' = v_id::text
                 THEN e || jsonb_build_object('name', v_name,
                                              'seq', COALESCE(public._mm_num(p_row->>'seq')::int, (e->>'seq')::int),
                                              'is_active', COALESCE((p_row->>'is_active')::boolean, (e->>'is_active')::boolean, true))
                 ELSE e END) FROM jsonb_array_elements(v_list) e);
  END IF;
  UPDATE public.mm_fabric_types SET constructions = v_list WHERE id = v_type;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $function$;

CREATE OR REPLACE FUNCTION public._mm_seed_fabric_constructions(p_factory uuid, p_type_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_type text; v_names text[]; v_list jsonb; v_n int := 0; i int;
BEGIN
  SELECT lower(name), constructions INTO v_type, v_list FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = p_factory;
  IF v_type IS NULL THEN RETURN 0; END IF;
  v_names := CASE
    WHEN v_type LIKE '%non%wov%' THEN ARRAY['Non-woven']
    WHEN v_type LIKE '%denim%'   THEN ARRAY['Denim 3/1 RHT', 'Denim 3/1 LHT', 'Denim 2/1', 'Denim Satin']
    WHEN v_type LIKE '%knit%'    THEN ARRAY['Single Jersey', '1x1 Rib', '2x2 Rib', 'Interlock', 'Pique', 'Fleece', 'French Terry', 'Waffle']
    WHEN v_type LIKE '%wov%'     THEN ARRAY['Poplin', 'Twill', 'Denim', 'Oxford', 'Canvas', 'Satin', 'Dobby']
    ELSE ARRAY[]::text[] END;
  FOR i IN 1 .. COALESCE(array_length(v_names, 1), 0) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e WHERE lower(e->>'name') = lower(v_names[i])) THEN
      v_list := v_list || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', v_names[i], 'seq', i * 10, 'is_active', true));
      v_n := v_n + 1;
    END IF;
  END LOOP;
  UPDATE public.mm_fabric_types SET constructions = v_list WHERE id = p_type_id;
  RETURN v_n;
END $function$;

SELECT pg_temp.fx('_mm_fabric_json', $o$  JOIN public.mm_fabric_constructions c ON c.id = f.construction_id$o$,
  $n$  LEFT JOIN LATERAL (SELECT f.construction_id AS id, public._mm_construction_name(f.fabric_type_id, f.construction_id) AS name) c ON true$n$);
SELECT pg_temp.fx('mm_list_fabrics', $o$      JOIN public.mm_fabric_constructions c ON c.id = f.construction_id$o$,
  $n$      LEFT JOIN LATERAL (SELECT f.construction_id AS id, public._mm_construction_name(f.fabric_type_id, f.construction_id) AS name) c ON true$n$);
SELECT pg_temp.fx('mm_fabric_stock_summary', $o$(SELECT c.name FROM public.mm_fabric_constructions c WHERE c.id = f.construction_id)$o$,
  $n$public._mm_construction_name(f.fabric_type_id, f.construction_id)$n$);
SELECT pg_temp.fx('_mm_fabric_set_auto_name', $o$  SELECT c.name INTO v_cons
  FROM public.mm_fabric_constructions c
  WHERE c.id = NEW.construction_id;$o$, $n$  v_cons := public._mm_construction_name(NEW.fabric_type_id, NEW.construction_id);$n$);
SELECT pg_temp.fx('_mm_fabric_normalize', $o$  IF v_cons IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_constructions
    WHERE id = v_cons AND factory_id = p_factory AND fabric_type_id = v_type
  ) THEN$o$, $n$  IF v_cons IS NULL OR public._mm_construction_name(v_type, v_cons) IS NULL THEN$n$);

-- ---------- 3. requirement fields: gone (the fabric form builder replaces them) ----------
SELECT pg_temp.fx('mm_get_config_bundle', $o$    'requirement_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_requirement_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),$o$, $n$    'requirement_fields', '[]'::jsonb,$n$);
SELECT pg_temp.fx('mm_get_config_bundle', $o$    'attribute_defs', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(f) || jsonb_build_object(
          'applies_to', 'material',
          'data_type', 'text',
          'options', '[]'::jsonb
        )
        ORDER BY f.seq, f.label
      )
      FROM public.mm_type_requirement_fields f
      WHERE f.factory_id = v_factory AND f.is_active
    ), '[]'::jsonb)$o$, $n$    'attribute_defs', '[]'::jsonb$n$);
CREATE OR REPLACE FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public._mm_ok(jsonb_build_object('attribute_ids', '[]'::jsonb, 'note', 'Requirement fields moved to the fabric form builder'))
$function$;
SELECT pg_temp.fx('_mm_seed_fabric_form_schema', $o$  INSERT INTO public.mm_fabric_form_fields (
    factory_id, group_id, fabric_type_id, key, spec_key, label, input_type, options, required, col_span, seq,
    storage, column_name, locked_when_used, is_system, visible)
  SELECT p_factory, v_spec, r.type_id,
         lower(regexp_replace(btrim(r.key), '[^a-zA-Z0-9_]+', '_', 'g')),
         lower(regexp_replace(btrim(r.key), '[^a-zA-Z0-9_]+', '_', 'g')),
         r.label, 'text', '[]'::jsonb, false, 1, 100 + r.seq, 'spec_values', NULL, false, false, r.is_active
  FROM public.mm_type_requirement_fields r
  WHERE r.factory_id = p_factory
    AND lower(btrim(r.key)) NOT IN ('gsm', 'width', 'width_in')
    AND lower(regexp_replace(btrim(r.key), '[^a-zA-Z0-9_]+', '_', 'g')) ~ '^[a-z][a-z0-9_]{1,40}$'
  ON CONFLICT DO NOTHING;
$o$, '');

-- ---------- 4. feature switches live in factory_modules.config ----------
UPDATE public.factory_modules m SET config = COALESCE(m.config, '{}'::jsonb) || COALESCE((
  SELECT jsonb_object_agg(f.feature_key, f.enabled) FROM public.mm_factory_features f WHERE f.factory_id = m.factory_id), '{}'::jsonb)
WHERE m.module_key = 'material';

CREATE OR REPLACE FUNCTION public._mm_feature(p_factory uuid, p_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE p_key
    WHEN 'fabric_warehouse' THEN COALESCE((SELECT (config->>'fabric_warehouse')::boolean FROM public.factory_modules WHERE factory_id = p_factory AND module_key = 'material'), true)
    WHEN 'trims' THEN COALESCE((SELECT (config->>'trims')::boolean FROM public.factory_modules WHERE factory_id = p_factory AND module_key = 'material'), false)
    ELSE false END
$function$;

CREATE OR REPLACE FUNCTION public.mm_set_material_feature(p_key text, p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_on boolean := COALESCE(p_enabled, false);
BEGIN
  IF NOT public.is_factory_admin() THEN RETURN public._mm_err('NO_PERMISSION', 'Admin required'); END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  IF p_key NOT IN ('fabric_warehouse', 'trims') THEN RETURN public._mm_err('INVALID', 'Switch must be fabric_warehouse or trims'); END IF;
  UPDATE public.factory_modules SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(p_key, v_on), updated_at = now()
  WHERE factory_id = v_factory AND module_key = 'material' AND enabled;
  IF NOT FOUND THEN RETURN public._mm_err('MODULE_DISABLED', 'Turn on Material Management first'); END IF;
  IF v_on AND p_key = 'fabric_warehouse' THEN
    PERFORM public._mm_v4_seed_masters(v_factory);
    PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  END IF;
  RETURN public.mm_get_material_features();
END $function$;

CREATE OR REPLACE FUNCTION public.mm_set_fabric_v4(p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN RETURN public._mm_err('NO_PERMISSION','Admin required'); END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY','No factory'); END IF;
  PERFORM public._mm_v4_seed_masters(v_factory);
  RETURN public._mm_ok(jsonb_build_object('fabric_v4', true));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN RETURN public._mm_err('NO_PERMISSION', 'Admin required'); END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  PERFORM public.set_factory_module('material', true,
    jsonb_build_object('fabric_warehouse', true, 'trims', false) || COALESCE(p_config, '{}'::jsonb));
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  RETURN public._mm_ok(jsonb_build_object('factory_id', v_factory));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN NEW; END; $function$;

SELECT pg_temp.fx('mm_get_ops_context', $o$    'features', COALESCE((
      SELECT jsonb_object_agg(feature_key, enabled)
      FROM public.mm_factory_features WHERE factory_id = v_factory
    ), '{}'::jsonb),$o$, $n$    'features', COALESCE((SELECT config FROM public.factory_modules WHERE factory_id = v_factory AND module_key = 'material'), '{}'::jsonb),$n$);

