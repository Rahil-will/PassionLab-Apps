-- =====================================================================
-- Fabric receiving form (2026-10-16)
-- Same model as the fabric form: one field list per factory, each field
-- applied to some or all fabric types. Two sections: receipt (asked once)
-- and roll (one grid column each).
--   tier core   = locked, always shown (backend needs it)
--   tier system = writes a roll column too (shade, dye lot, colour); can be hidden / required
--   tier custom = free field
-- Receipt values -> mm_in_challans.field_values. Roll values -> roll attributes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mm_receipt_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('receipt', 'roll')),
  key text NOT NULL,
  label text NOT NULL,
  help text,
  data_type text NOT NULL DEFAULT 'text' CHECK (data_type IN ('text', 'number', 'decimal', 'select', 'checkbox', 'date')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  fabric_type_ids uuid[] NOT NULL DEFAULT '{}',
  tier text NOT NULL DEFAULT 'custom' CHECK (tier IN ('core', 'system', 'custom')),
  seq int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  row_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (factory_id, section, key)
);
ALTER TABLE public.mm_receipt_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY mm_receipt_fields_select ON public.mm_receipt_fields FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());
GRANT SELECT ON public.mm_receipt_fields TO authenticated;

ALTER TABLE public.mm_in_challans ADD COLUMN IF NOT EXISTS field_values jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------- seed: locked + system fields ----------
CREATE OR REPLACE FUNCTION public._mm_seed_receipt_form(p_factory uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  INSERT INTO public.mm_receipt_fields (factory_id, section, key, label, data_type, required, tier, seq)
  SELECT p_factory, v.section, v.key, v.label, v.dt, v.req, v.tier, v.seq
  FROM (VALUES
    ('receipt', 'purpose',         'Purpose',            'select', true,  'core',   10),
    ('receipt', 'source',          'Source',             'select', true,  'core',   20),
    ('receipt', 'vendor',          'From',               'select', true,  'core',   30),
    ('receipt', 'challan_invoice', 'Challan / Invoice',  'text',   false, 'core',   40),
    ('receipt', 'reference_no',    'Reference no',       'text',   false, 'core',   50),
    ('receipt', 'received_on',     'Received on',        'date',   true,  'core',   60),
    ('receipt', 'roll_count',      'Rolls',              'number', true,  'core',   70),
    ('receipt', 'remarks',         'Remarks',            'text',   false, 'core',   80),
    ('roll',    'roll_no',         'Roll no',            'text',   false, 'core',   10),
    ('roll',    'qty',             'Qty',                'decimal',true,  'core',   20),
    ('roll',    'color',           'Colour',             'text',   false, 'system', 30),
    ('roll',    'shade',           'Shade',              'text',   false, 'system', 40),
    ('roll',    'dye_lot',         'Dye lot',            'text',   false, 'system', 50)
  ) AS v(section, key, label, dt, req, tier, seq)
  ON CONFLICT (factory_id, section, key) DO NOTHING;
$function$;

SELECT public._mm_seed_receipt_form(m.factory_id) FROM public.factory_modules m WHERE m.module_key = 'material';

-- ---------- read: the form (all fields, or the ones that apply to one fabric type) ----------
CREATE OR REPLACE FUNCTION public._mm_receipt_field_json(f public.mm_receipt_fields)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('id', f.id, 'section', f.section, 'key', f.key, 'label', f.label, 'help', f.help,
    'data_type', f.data_type, 'options', f.options, 'required', f.required, 'visible', f.visible, 'tier', f.tier, 'seq', f.seq,
    'fabric_type_ids', to_jsonb(f.fabric_type_ids),
    'fabric_types', COALESCE((SELECT jsonb_agg(t.name ORDER BY t.seq, t.name) FROM public.mm_fabric_types t WHERE t.id = ANY (f.fabric_type_ids)), '[]'::jsonb),
    'has_values', CASE f.section
      WHEN 'receipt' THEN EXISTS (SELECT 1 FROM public.mm_in_challans c WHERE c.factory_id = f.factory_id AND c.field_values ? f.key)
      ELSE f.tier = 'custom' AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = f.factory_id AND u.attributes ? f.key) END);
$function$;

CREATE OR REPLACE FUNCTION public._mm_receipt_form_json(p_factory uuid, p_fabric_type_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'fabric_type_id', p_fabric_type_id,
    'sections', jsonb_build_array(
      jsonb_build_object('key', 'receipt', 'label', 'Receipt information', 'fields', COALESCE((
        SELECT jsonb_agg(public._mm_receipt_field_json(f) ORDER BY f.seq, f.label) FROM public.mm_receipt_fields f
        WHERE f.factory_id = p_factory AND f.section = 'receipt' AND f.is_active
          AND (p_fabric_type_id IS NULL OR ((f.visible OR f.tier = 'core') AND (cardinality(f.fabric_type_ids) = 0 OR p_fabric_type_id = ANY (f.fabric_type_ids))))), '[]'::jsonb)),
      jsonb_build_object('key', 'roll', 'label', 'Roll information', 'fields', COALESCE((
        SELECT jsonb_agg(public._mm_receipt_field_json(f) ORDER BY f.seq, f.label) FROM public.mm_receipt_fields f
        WHERE f.factory_id = p_factory AND f.section = 'roll' AND f.is_active
          AND (p_fabric_type_id IS NULL OR ((f.visible OR f.tier = 'core') AND (cardinality(f.fabric_type_ids) = 0 OR p_fabric_type_id = ANY (f.fabric_type_ids))))), '[]'::jsonb))));
$function$;

-- p_fabric_type_id NULL = the full list for Settings; a type = what the receive page shows
CREATE OR REPLACE FUNCTION public.mm_get_receipt_form(p_fabric_type_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  PERFORM public._mm_seed_receipt_form(v_factory);
  RETURN public._mm_ok(public._mm_receipt_form_json(v_factory, p_fabric_type_id));
END $function$;

-- Save the whole list from Settings (like the fabric form editor's Save).
-- fields: [{id?, section, label, help, data_type, options, required, visible, fabric_type_ids, seq}]
-- core: only seq may change. system: label, help, required, visible, fabric_type_ids, seq. custom: everything.
-- A custom field left out of the list is switched off (its stored values stay).
CREATE OR REPLACE FUNCTION public.mm_save_receipt_form(p_fields jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_actor uuid := public._mm_actor_id(); v_f jsonb; v_row public.mm_receipt_fields%ROWTYPE;
  v_id uuid; v_ids uuid[] := '{}'; v_label text; v_key text; v_sec text; v_dt text; v_opts jsonb; v_types uuid[]; v_seq int := 0;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF jsonb_typeof(COALESCE(p_fields, 'null'::jsonb)) <> 'array' THEN RETURN public._mm_err('INVALID', 'fields must be a list'); END IF;
  PERFORM public._mm_seed_receipt_form(v_factory);

  FOR v_f IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
    v_seq := v_seq + 10;
    v_label := NULLIF(btrim(COALESCE(v_f->>'label', '')), '');
    v_sec := COALESCE(NULLIF(v_f->>'section', ''), 'roll');
    IF v_sec NOT IN ('receipt', 'roll') THEN RETURN public._mm_err('INVALID', 'Section must be receipt or roll'); END IF;
    v_dt := COALESCE(NULLIF(v_f->>'data_type', ''), 'text');
    IF v_dt NOT IN ('text', 'number', 'decimal', 'select', 'checkbox', 'date') THEN RETURN public._mm_err('INVALID', COALESCE(v_label, 'A field') || ': unknown input type'); END IF;
    v_opts := CASE WHEN v_dt = 'select' AND jsonb_typeof(v_f->'options') = 'array' THEN v_f->'options' ELSE '[]'::jsonb END;
    v_types := ARRAY(SELECT t.id FROM public.mm_fabric_types t WHERE t.factory_id = v_factory
                     AND t.id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(v_f->'fabric_type_ids', '[]'::jsonb)) x));
    v_id := NULLIF(v_f->>'id', '')::uuid;
    v_row := NULL;
    IF v_id IS NOT NULL THEN
      SELECT * INTO v_row FROM public.mm_receipt_fields WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', COALESCE(v_label, 'A field') || ' was not found'); END IF;
    END IF;

    IF v_row.tier = 'core' THEN
      UPDATE public.mm_receipt_fields SET seq = v_seq, row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_id;
    ELSIF v_row.tier = 'system' THEN
      UPDATE public.mm_receipt_fields SET label = COALESCE(v_label, label), help = NULLIF(btrim(COALESCE(v_f->>'help', '')), ''),
        required = COALESCE((v_f->>'required')::boolean, required), visible = COALESCE((v_f->>'visible')::boolean, visible),
        fabric_type_ids = v_types, seq = v_seq, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
    ELSE
      IF v_label IS NULL THEN RETURN public._mm_err('REQUIRED', 'Each field needs a label'); END IF;
      IF v_dt = 'select' AND jsonb_array_length(v_opts) = 0 THEN RETURN public._mm_err('REQUIRED', v_label || ': add at least one choice'); END IF;
      v_key := COALESCE(v_row.key, NULLIF(replace(public._mm_slugify(v_label), '-', '_'), ''), 'field');
      IF v_row.id IS NULL AND EXISTS (SELECT 1 FROM public.mm_receipt_fields WHERE factory_id = v_factory AND section = v_sec AND key = v_key AND is_active) THEN
        RETURN public._mm_err('DUPLICATE', v_label || ' is already on the form');
      END IF;
      IF v_row.id IS NOT NULL AND v_row.data_type <> v_dt AND (public._mm_receipt_field_json(v_row)->>'has_values')::boolean THEN
        RETURN public._mm_err('LOCKED', v_label || ' already has values; its input type cannot change');
      END IF;
      INSERT INTO public.mm_receipt_fields AS r (id, factory_id, section, key, label, help, data_type, options, required, visible,
        fabric_type_ids, tier, seq, is_active, created_by, updated_by)
      VALUES (COALESCE(v_row.id, gen_random_uuid()), v_factory, COALESCE(v_row.section, v_sec), v_key, v_label,
        NULLIF(btrim(COALESCE(v_f->>'help', '')), ''), v_dt, v_opts, COALESCE((v_f->>'required')::boolean, false),
        COALESCE((v_f->>'visible')::boolean, true), v_types, 'custom', v_seq, true, v_actor, v_actor)
      ON CONFLICT (factory_id, section, key) DO UPDATE SET label = EXCLUDED.label, help = EXCLUDED.help, data_type = EXCLUDED.data_type,
        options = EXCLUDED.options, required = EXCLUDED.required, visible = EXCLUDED.visible, fabric_type_ids = EXCLUDED.fabric_type_ids,
        seq = EXCLUDED.seq, is_active = true, row_version = r.row_version + 1, updated_at = now(), updated_by = v_actor
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_receipt_fields SET is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
   WHERE factory_id = v_factory AND tier = 'custom' AND is_active AND NOT (id = ANY (v_ids));
  RETURN public._mm_ok(public._mm_receipt_form_json(v_factory, NULL));
EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'A value in the form is not valid');
END $function$;

-- ---------- check values against the form (custom + system fields; core ones are checked by mm_wh_receive) ----------
CREATE OR REPLACE FUNCTION public._mm_receipt_form_check(p_factory uuid, p_fabric_type_id uuid, p_section text, p_values jsonb, p_roll text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE f public.mm_receipt_fields%ROWTYPE; v jsonb; v_pre text := CASE WHEN p_roll IS NULL THEN '' ELSE 'Roll ' || p_roll || ': ' END;
BEGIN
  FOR f IN SELECT * FROM public.mm_receipt_fields
           WHERE factory_id = p_factory AND section = p_section AND is_active AND visible AND tier <> 'core'
             AND (cardinality(fabric_type_ids) = 0 OR p_fabric_type_id = ANY (fabric_type_ids)) ORDER BY seq LOOP
    v := p_values -> f.key;
    IF v IS NULL OR v = 'null'::jsonb OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '') THEN
      IF f.required THEN RETURN v_pre || f.label || ' is required'; END IF;
      CONTINUE;
    END IF;
    IF f.data_type IN ('number', 'decimal') AND public._mm_safe_numeric(v #>> '{}') IS NULL THEN RETURN v_pre || f.label || ' must be a number'; END IF;
    IF f.data_type = 'checkbox' AND jsonb_typeof(v) <> 'boolean' THEN RETURN v_pre || f.label || ' must be ticked or not'; END IF;
    IF f.data_type = 'select' AND NOT (f.options ? (v #>> '{}')) THEN RETURN v_pre || f.label || ': pick one of the choices'; END IF;
    IF f.data_type = 'date' THEN
      BEGIN PERFORM (v #>> '{}')::date;
      EXCEPTION WHEN others THEN RETURN v_pre || f.label || ' must be a date'; END;
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;

-- roll values that also feed roll columns (system fields) are lifted to the top level; top level wins
CREATE OR REPLACE FUNCTION public._mm_receipt_roll_flat(p_roll jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $function$
  SELECT COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(CASE WHEN jsonb_typeof(p_roll->'values') = 'object' THEN p_roll->'values' ELSE '{}'::jsonb END) e(k, v)
                   WHERE k IN ('color', 'shade', 'dye_lot')), '{}'::jsonb) || p_roll
$function$;

REVOKE EXECUTE ON FUNCTION public._mm_seed_receipt_form(uuid), public._mm_receipt_form_json(uuid, uuid),
  public._mm_receipt_form_check(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_receipt_form(uuid), public.mm_save_receipt_form(jsonb) TO authenticated;

-- ---------- mm_wh_receive: read the form's values ----------
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

SELECT pg_temp.fx('mm_wh_receive', $o$v_on date; v_attrs jsonb;$o$, $n$v_on date; v_attrs jsonb; v_fv jsonb; v_err text;$n$);
SELECT pg_temp.fx('mm_wh_receive',
  $o$FOR v_r IN SELECT * FROM jsonb_array_elements(p_payload->'rolls') LOOP$o$,
  $n$FOR v_r IN SELECT * FROM jsonb_array_elements(p_payload->'rolls') LOOP
    v_r := public._mm_receipt_roll_flat(v_r);$n$, 2);
SELECT pg_temp.fx('mm_wh_receive',
  $o$    v_code := NULLIF(btrim(COALESCE(v_r->>'roll_no', '')), '');
    IF v_code IS NOT NULL THEN$o$,
  $n$    v_code := NULLIF(btrim(COALESCE(v_r->>'roll_no', '')), '');
    v_err := public._mm_receipt_form_check(v_factory, f.fabric_type_id, 'roll',
               CASE WHEN jsonb_typeof(v_r->'values') = 'object' THEN v_r->'values' ELSE '{}'::jsonb END, COALESCE(v_code, '?'));
    IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
    IF v_code IS NOT NULL THEN$n$);
SELECT pg_temp.fx('mm_wh_receive',
  $o$  v_on := COALESCE(NULLIF(p_payload->>'received_at', '')::date, CURRENT_DATE);$o$,
  $n$  v_fv := CASE WHEN jsonb_typeof(p_payload->'field_values') = 'object' THEN jsonb_strip_nulls(p_payload->'field_values') ELSE '{}'::jsonb END;
  v_err := public._mm_receipt_form_check(v_factory, f.fabric_type_id, 'receipt', v_fv, NULL);
  IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
  v_on := COALESCE(NULLIF(p_payload->>'received_at', '')::date, CURRENT_DATE);$n$);
SELECT pg_temp.fx('mm_wh_receive',
  $o$    fabric_id, stage_code, color_ref)
  VALUES$o$,
  $n$    fabric_id, stage_code, color_ref, field_values)
  VALUES$n$);
SELECT pg_temp.fx('mm_wh_receive',
  $o$    f.id, v_stage, v_colour)
  RETURNING id INTO v_ch;$o$,
  $n$    f.id, v_stage, v_colour, v_fv)
  RETURNING id INTO v_ch;$n$);
SELECT pg_temp.fx('mm_wh_receive',
  $o$      || CASE WHEN jsonb_typeof(v_r->'attributes') = 'object' THEN v_r->'attributes' ELSE '{}'::jsonb END;$o$,
  $n$      || CASE WHEN jsonb_typeof(v_r->'attributes') = 'object' THEN v_r->'attributes' ELSE '{}'::jsonb END
      || CASE WHEN jsonb_typeof(v_r->'values') = 'object' THEN jsonb_strip_nulls(v_r->'values') ELSE '{}'::jsonb END;$n$);

-- receipt detail carries the form for its fabric type (values are in receipt.field_values and roll attributes)
SELECT pg_temp.fx('mm_wh_get_receipt',
  $o$    'tests', COALESCE((SELECT$o$,
  $n$    'form', public._mm_receipt_form_json(v_c.factory_id, (SELECT fb.fabric_type_id FROM public.mm_fabrics fb WHERE fb.id = v_c.fabric_id)),
    'tests', COALESCE((SELECT$n$);

-- new factories get the form when the fabric warehouse is seeded
SELECT pg_temp.fx('_mm_v4_seed_masters',
  $o$  PERFORM public._mm_inhouse_process_vendor(p_factory);$o$,
  $n$  PERFORM public._mm_inhouse_process_vendor(p_factory);
  PERFORM public._mm_seed_receipt_form(p_factory);$n$);

NOTIFY pgrst, 'reload schema';

-- ---------- follow-up (applied as mm_receipt_form_save_atomic): the settings save is all or nothing ----------
-- mm_save_receipt_form was redefined so every check RAISEs inside one block whose handler
-- returns {ok:false, code:'INVALID', message} and rolls back every write of that save.
-- See the live definition (pg_get_functiondef('public.mm_save_receipt_form'::regproc)).
