-- Setup simplification (Rahil 2026-10-12): no "Facilities" in the UI.
-- Three setup lists: Process vendors (+ processes), Fabric vendors, Mills. Warehouse = one default, hidden.
-- mm_facilities stays as the single store (kind process_unit | vendor | mill | warehouse); codes + ownership automatic.
-- Old mm_process_vendors / mm_process_vendor_types merged into facilities and frozen.

-- 1. Merge old process vendors into facilities (match by name), copy their processes
INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name, is_active, created_by, updated_by)
SELECT v.factory_id, 'process_unit', 'external',
       'PV-' || lpad((row_number() OVER (PARTITION BY v.factory_id ORDER BY v.created_at)
                      + (SELECT count(*) FROM public.mm_facilities f2 WHERE f2.factory_id = v.factory_id AND f2.kind = 'process_unit'))::text, 3, '0'),
       btrim(v.name), v.active, v.created_by, v.updated_by
FROM public.mm_process_vendors v
WHERE NOT EXISTS (SELECT 1 FROM public.mm_facilities f WHERE f.factory_id = v.factory_id AND f.kind = 'process_unit'
                  AND lower(btrim(f.name)) = lower(btrim(v.name)));

INSERT INTO public.mm_facility_process_types (factory_id, facility_id, process_type_id)
SELECT vt.factory_id, f.id, vt.process_type_id
FROM public.mm_process_vendor_types vt
JOIN public.mm_process_vendors v ON v.id = vt.vendor_id
JOIN public.mm_facilities f ON f.factory_id = v.factory_id AND f.kind = 'process_unit' AND lower(btrim(f.name)) = lower(btrim(v.name))
ON CONFLICT DO NOTHING;

-- 2. One default warehouse per factory that has Material on
INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name, is_active)
SELECT fm.factory_id, 'warehouse', 'internal', 'WH-1', 'Fabric warehouse', true
FROM public.factory_modules fm
WHERE fm.module_key = 'material' AND fm.enabled
  AND NOT EXISTS (SELECT 1 FROM public.mm_facilities f WHERE f.factory_id = fm.factory_id AND f.kind = 'warehouse');

-- 3. Helpers
CREATE OR REPLACE FUNCTION public._mm_partner_kind(p_kind text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE p_kind WHEN 'process_vendor' THEN 'process_unit' WHEN 'fabric_vendor' THEN 'vendor' WHEN 'mill' THEN 'mill' END
$function$;

CREATE OR REPLACE FUNCTION public._mm_partner_next_code(p_factory uuid, p_fkind text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prefix text := CASE p_fkind WHEN 'process_unit' THEN 'PV' WHEN 'vendor' THEN 'FV' WHEN 'mill' THEN 'MILL' ELSE 'WH' END;
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

-- 4. List: kind = 'process_vendor' | 'fabric_vendor' | 'mill'
CREATE OR REPLACE FUNCTION public.mm_list_partners(p_kind text, p_include_inactive boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_fkind text := public._mm_partner_kind(p_kind);
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF v_fkind IS NULL THEN RETURN public._mm_err('INVALID', 'kind must be process_vendor, fabric_vendor or mill'); END IF;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'contact', f.contact, 'address', f.address, 'is_active', f.is_active, 'row_version', f.row_version,
      'process_type_ids', CASE WHEN v_fkind = 'process_unit' THEN COALESCE((SELECT jsonb_agg(x.process_type_id) FROM public.mm_facility_process_types x WHERE x.facility_id = f.id), '[]'::jsonb) END,
      'processes', CASE WHEN v_fkind = 'process_unit' THEN COALESCE((SELECT jsonb_agg(t.name ORDER BY t.sort_order, t.name) FROM public.mm_facility_process_types x JOIN public.mm_process_types t ON t.id = x.process_type_id WHERE x.facility_id = f.id), '[]'::jsonb) END,
      'machine_count', CASE WHEN v_fkind = 'mill' THEN (SELECT count(*) FROM public.mm_machines m WHERE m.facility_id = f.id) END,
      'in_use', EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.unit_facility_id = f.id)
             OR EXISTS (SELECT 1 FROM public.mm_mill_batches b WHERE b.facility_id = f.id)
             OR EXISTS (SELECT 1 FROM public.mm_rolls r WHERE r.origin_facility_id = f.id))
      ORDER BY f.is_active DESC, f.name)
    FROM public.mm_facilities f
    WHERE f.factory_id = v_factory AND f.kind = v_fkind AND (p_include_inactive OR f.is_active)
  ), '[]'::jsonb)));
END $function$;

-- 5. Save: { id?, kind*, name*, contact?, address?, is_active?, row_version?, process_type_ids? (process_vendor) }
CREATE OR REPLACE FUNCTION public.mm_save_partner(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_fkind text := public._mm_partner_kind(p_row->>'kind'); v_id uuid; v_name text; v_cur public.mm_facilities%ROWTYPE; v_pt uuid;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF v_fkind IS NULL THEN RETURN public._mm_err('INVALID', 'kind must be process_vendor, fabric_vendor or mill'); END IF;
  BEGIN v_id := NULLIF(p_row->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid id'); END;
  v_name := NULLIF(btrim(COALESCE(p_row->>'name', '')), '');
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Name is required'); END IF;
  IF EXISTS (SELECT 1 FROM public.mm_facilities f WHERE f.factory_id = v_factory AND f.kind = v_fkind
             AND lower(btrim(f.name)) = lower(v_name) AND f.id IS DISTINCT FROM v_id) THEN
    RETURN public._mm_err('DUPLICATE', 'That name is already used');
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name, contact, address, is_active, created_by, updated_by)
    VALUES (v_factory, v_fkind, CASE WHEN v_fkind = 'mill' THEN 'internal' ELSE 'external' END,
            public._mm_partner_next_code(v_factory, v_fkind), v_name,
            NULLIF(btrim(COALESCE(p_row->>'contact', '')), ''), NULLIF(btrim(COALESCE(p_row->>'address', '')), ''),
            COALESCE((p_row->>'is_active')::boolean, true), public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_cur FROM public.mm_facilities WHERE id = v_id AND factory_id = v_factory AND kind = v_fkind FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Not found'); END IF;
    IF p_row ? 'row_version' AND NULLIF(p_row->>'row_version', '')::int IS DISTINCT FROM v_cur.row_version THEN
      RETURN public._mm_err('STALE', 'Changed elsewhere. Reload and try again');
    END IF;
    UPDATE public.mm_facilities SET name = v_name,
      contact = CASE WHEN p_row ? 'contact' THEN NULLIF(btrim(COALESCE(p_row->>'contact', '')), '') ELSE contact END,
      address = CASE WHEN p_row ? 'address' THEN NULLIF(btrim(COALESCE(p_row->>'address', '')), '') ELSE address END,
      is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
  END IF;
  IF v_fkind = 'process_unit' AND p_row ? 'process_type_ids' THEN
    DELETE FROM public.mm_facility_process_types WHERE facility_id = v_id;
    FOR v_pt IN SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_row->'process_type_ids', '[]'::jsonb)) x LOOP
      INSERT INTO public.mm_facility_process_types (factory_id, facility_id, process_type_id)
      SELECT v_factory, v_id, t.id FROM public.mm_process_types t WHERE t.id = v_pt AND t.factory_id = v_factory
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $function$;

-- 6. Processes: list + save (name, output stage, comes back as, active, order). Testing/inspection resets follow the output stage.
CREATE OR REPLACE FUNCTION public.mm_list_processes()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'output_stage_code', t.output_stage_code,
      'output_stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory AND s.code = t.output_stage_code),
      'output_unit_form', COALESCE(t.output_unit_form, 'keep'), 'active', t.active, 'sort_order', t.sort_order,
      'vendor_count', (SELECT count(*) FROM public.mm_facility_process_types x JOIN public.mm_facilities f ON f.id = x.facility_id
                       WHERE x.process_type_id = t.id AND f.kind = 'process_unit' AND f.is_active),
      'in_use', EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.process_type_id = t.id))
      ORDER BY t.active DESC, t.sort_order, t.name)
    FROM public.mm_process_types t WHERE t.factory_id = v_factory
  ), '[]'::jsonb)));
END $function$;

-- p_row: { id?, name*, output_stage_code? (null = stage unchanged), output_unit_form? ('keep'|'roll'|'lap'), active?, sort_order? }
CREATE OR REPLACE FUNCTION public.mm_save_process(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_id uuid; v_name text; v_stage text; v_form text;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  BEGIN v_id := NULLIF(p_row->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid id'); END;
  v_name := NULLIF(btrim(COALESCE(p_row->>'name', '')), '');
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Process name is required'); END IF;
  IF EXISTS (SELECT 1 FROM public.mm_process_types t WHERE t.factory_id = v_factory AND lower(btrim(t.name)) = lower(v_name) AND t.id IS DISTINCT FROM v_id) THEN
    RETURN public._mm_err('DUPLICATE', 'A process with that name already exists');
  END IF;
  v_stage := NULLIF(upper(btrim(COALESCE(p_row->>'output_stage_code', ''))), '');
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory AND s.code = v_stage) THEN
    RETURN public._mm_err('INVALID', 'Unknown stage');
  END IF;
  v_form := COALESCE(NULLIF(p_row->>'output_unit_form', ''), 'keep');
  IF v_form NOT IN ('keep', 'roll', 'lap') THEN RETURN public._mm_err('INVALID', 'Comes back as must be keep, roll or lap'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, default_return_mode,
                                         resets_testing, resets_inspection, output_unit_form, created_by, updated_by)
    VALUES (v_factory, v_name, COALESCE(NULLIF(p_row->>'sort_order', '')::int, (SELECT COALESCE(max(sort_order), 0) + 1 FROM public.mm_process_types WHERE factory_id = v_factory)),
            COALESCE((p_row->>'active')::boolean, true), v_stage, 'same_rolls',
            v_stage IS NOT NULL, v_stage IS NOT NULL, NULLIF(v_form, 'keep'), public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.mm_process_types SET name = v_name, output_stage_code = v_stage, output_unit_form = NULLIF(v_form, 'keep'),
      resets_testing = v_stage IS NOT NULL, resets_inspection = v_stage IS NOT NULL,
      active = COALESCE((p_row->>'active')::boolean, active),
      sort_order = COALESCE(NULLIF(p_row->>'sort_order', '')::int, sort_order),
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process not found'); END IF;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $function$;

-- 7. Default warehouse for dispatch pickers
CREATE OR REPLACE FUNCTION public.mm_default_warehouse()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok((SELECT jsonb_build_object('id', f.id, 'name', f.name) FROM public.mm_facilities f
                        WHERE f.factory_id = v_factory AND f.kind = 'warehouse' AND f.is_active ORDER BY f.created_at LIMIT 1));
END $function$;

-- 8. Old writer mm_save_process_catalog: no longer used by the UI (revoke after the IDE run).

GRANT EXECUTE ON FUNCTION public.mm_list_partners(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_partner(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_processes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_process(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_default_warehouse() TO authenticated;
