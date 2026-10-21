-- Processes own everything (Rahil 2026-10-13):
--  * each process says where it is done: in-house and/or external (process vendors)
--  * in-house machines belong to a process (one hidden In-house unit holds them, like the default warehouse)
--  * each process has a challan-field template; the challan stores the values
--  * Knitting / Weaving are processes that make fabric (New mill batch "Made at"), so the Mills page goes away
--  * a process challan may name an in-house machine (optional; never for external)

ALTER TABLE public.mm_process_types
  ADD COLUMN IF NOT EXISTS makes_fabric boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS done_inhouse boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS done_external boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challan_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mm_machines
  ADD COLUMN IF NOT EXISTS process_type_id uuid REFERENCES public.mm_process_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS mm_machines_process_idx ON public.mm_machines (process_type_id) WHERE process_type_id IS NOT NULL;

ALTER TABLE public.mm_process_challans
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.mm_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS field_values jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The one in-house unit of a factory (oldest active internal mill). Created when missing.
CREATE OR REPLACE FUNCTION public._mm_inhouse_unit(p_factory uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.mm_facilities
  WHERE factory_id = p_factory AND kind = 'mill' AND ownership = 'internal' AND is_active
  ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name, is_active, created_by, updated_by)
    VALUES (p_factory, 'mill', 'internal', public._mm_partner_next_code(p_factory, 'mill'), 'In-house', true,
            public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $function$;
REVOKE EXECUTE ON FUNCTION public._mm_inhouse_unit(uuid) FROM anon, public, authenticated;

-- Can this facility make fabric (mill batches)? In-house unit, any mill, or a process vendor doing a fabric-making process.
CREATE OR REPLACE FUNCTION public._mm_is_fabric_maker(p_fac uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.mm_facilities f WHERE f.id = p_fac AND (
      f.kind = 'mill'
      OR (f.kind = 'process_unit' AND EXISTS (
            SELECT 1 FROM public.mm_facility_process_types x JOIN public.mm_process_types t ON t.id = x.process_type_id
            WHERE x.facility_id = f.id AND t.makes_fabric AND t.active))))
$function$;
REVOKE EXECUTE ON FUNCTION public._mm_is_fabric_maker(uuid) FROM anon, public;

-- Validate / normalise a challan-field template. Raises on bad input.
-- Field: {key, label, type: text|number|select, required: bool, options: [..] (select only)}
CREATE OR REPLACE FUNCTION public._mm_clean_challan_fields(p jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb := '[]'::jsonb; v_f jsonb; v_key text; v_label text; v_type text; v_keys text[] := '{}'; v_opts jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p) <> 'array' THEN RAISE EXCEPTION 'Challan fields must be a list'; END IF;
  FOR v_f IN SELECT * FROM jsonb_array_elements(p) LOOP
    v_label := NULLIF(btrim(COALESCE(v_f->>'label', '')), '');
    IF v_label IS NULL THEN RAISE EXCEPTION 'Every challan field needs a label'; END IF;
    v_key := NULLIF(btrim(COALESCE(v_f->>'key', '')), '');
    IF v_key IS NULL THEN v_key := btrim(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'), '_'); END IF;
    IF v_key = '' OR v_key !~ '^[a-z][a-z0-9_]*$' THEN RAISE EXCEPTION 'Field "%" needs a key made of letters, digits and _', v_label; END IF;
    IF v_key = ANY (v_keys) THEN RAISE EXCEPTION 'Two challan fields use the key %', v_key; END IF;
    v_keys := array_append(v_keys, v_key);
    v_type := COALESCE(NULLIF(v_f->>'type', ''), 'text');
    IF v_type NOT IN ('text', 'number', 'select') THEN RAISE EXCEPTION 'Field "%" type must be text, number or select', v_label; END IF;
    v_opts := NULL;
    IF v_type = 'select' THEN
      v_opts := COALESCE((SELECT jsonb_agg(DISTINCT btrim(o)) FROM jsonb_array_elements_text(COALESCE(v_f->'options', '[]'::jsonb)) o
                          WHERE btrim(o) <> ''), '[]'::jsonb);
      IF jsonb_array_length(v_opts) = 0 THEN RAISE EXCEPTION 'Field "%" needs options', v_label; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'label', v_label, 'type', v_type,
      'required', COALESCE((v_f->>'required')::boolean, false), 'options', v_opts)));
  END LOOP;
  RETURN v_out;
END $function$;
REVOKE EXECUTE ON FUNCTION public._mm_clean_challan_fields(jsonb) FROM anon, public;
