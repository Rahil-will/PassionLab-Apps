ALTER TABLE public.mm_material_types
  ADD COLUMN IF NOT EXISTS remarks text;

CREATE OR REPLACE FUNCTION public.mm_save_material_type(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_group uuid;
  v_existing record;
  v_rv integer;
  v_out public.mm_material_types%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_id := NULLIF(p_row->>'id', '')::uuid;
  v_group := NULLIF(p_row->>'group_id', '')::uuid;
  v_rv := COALESCE((p_row->>'row_version')::integer, 1);

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.mm_material_types WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Type not found'); END IF;
    IF v_existing.row_version IS DISTINCT FROM v_rv THEN
      RETURN public._mm_err('STALE_VERSION', 'Type was updated by another user');
    END IF;
    UPDATE public.mm_material_types SET
      name = COALESCE(NULLIF(trim(p_row->>'name'), ''), name),
      remarks = CASE WHEN p_row ? 'remarks' THEN NULLIF(trim(p_row->>'remarks'), '') ELSE remarks END,
      test_template_id = CASE WHEN p_row ? 'test_template_id' THEN NULLIF(p_row->>'test_template_id', '')::uuid ELSE test_template_id END,
      test_scope = COALESCE(NULLIF(p_row->>'test_scope', ''), test_scope),
      sample_pct = CASE WHEN p_row ? 'sample_pct' THEN NULLIF(p_row->>'sample_pct', '')::numeric ELSE sample_pct END,
      is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_id
    RETURNING * INTO v_out;
  ELSE
    IF v_group IS NULL OR NULLIF(trim(p_row->>'name'), '') IS NULL THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'group_id and name are required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mm_material_groups g WHERE g.id = v_group AND g.factory_id = v_factory) THEN
      RETURN public._mm_err('NOT_FOUND', 'Group not found');
    END IF;
    INSERT INTO public.mm_material_types (
      factory_id, group_id, name, remarks, test_template_id, test_scope, sample_pct, is_active, created_by, updated_by
    ) VALUES (
      v_factory, v_group, trim(p_row->>'name'),
      NULLIF(trim(p_row->>'remarks'), ''),
      NULLIF(p_row->>'test_template_id', '')::uuid,
      COALESCE(NULLIF(p_row->>'test_scope', ''), 'per_unit'),
      NULLIF(p_row->>'sample_pct', '')::numeric,
      COALESCE((p_row->>'is_active')::boolean, true), auth.uid(), auth.uid()
    )
    RETURNING * INTO v_out;
  END IF;

  RETURN public._mm_ok(to_jsonb(v_out));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'Type name already exists in group');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_material_type(jsonb) TO authenticated, service_role;

CREATE TABLE public.mm_trim_requirement_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  category text NOT NULL,
  types jsonb NOT NULL DEFAULT '[]'::jsonb,
  seq integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT mm_trim_requirement_params_category_chk CHECK (length(trim(category)) > 0),
  CONSTRAINT mm_trim_requirement_params_types_arr_chk CHECK (jsonb_typeof(types) = 'array'),
  CONSTRAINT mm_trim_requirement_params_factory_category_uidx UNIQUE (factory_id, category)
);

CREATE INDEX mm_trim_requirement_params_factory_idx ON public.mm_trim_requirement_params (factory_id);

COMMENT ON TABLE public.mm_trim_requirement_params IS
  'Factory-scoped trim requirement catalog: one category per row, types stored as jsonb string array.';

SELECT public._mm_lockdown_table('public.mm_trim_requirement_params'::regclass);

CREATE OR REPLACE FUNCTION public.mm_save_trim_requirement_param(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_existing record;
  v_rv integer;
  v_types jsonb;
  v_out public.mm_trim_requirement_params%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_id := NULLIF(p_row->>'id', '')::uuid;
  v_rv := COALESCE((p_row->>'row_version')::integer, 1);
  v_types := COALESCE(p_row->'types', '[]'::jsonb);
  IF jsonb_typeof(v_types) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'types must be a JSON array');
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.mm_trim_requirement_params WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Trim category not found'); END IF;
    IF v_existing.row_version IS DISTINCT FROM v_rv THEN
      RETURN public._mm_err('STALE_VERSION', 'Trim category was updated by another user');
    END IF;
    UPDATE public.mm_trim_requirement_params SET
      category = COALESCE(NULLIF(trim(p_row->>'category'), ''), category),
      types = v_types,
      seq = COALESCE((p_row->>'seq')::integer, seq),
      is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_id
    RETURNING * INTO v_out;
  ELSE
    IF NULLIF(trim(p_row->>'category'), '') IS NULL THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'category is required');
    END IF;
    INSERT INTO public.mm_trim_requirement_params (
      factory_id, category, types, seq, is_active, created_by, updated_by
    ) VALUES (
      v_factory, trim(p_row->>'category'), v_types,
      COALESCE((p_row->>'seq')::integer, 0),
      COALESCE((p_row->>'is_active')::boolean, true),
      auth.uid(), auth.uid()
    )
    RETURNING * INTO v_out;
  END IF;

  RETURN public._mm_ok(to_jsonb(v_out));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'Trim category already exists');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_delete_trim_requirement_param(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_out public.mm_trim_requirement_params%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  DELETE FROM public.mm_trim_requirement_params
  WHERE id = p_id AND factory_id = v_factory
  RETURNING * INTO v_out;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Trim category not found'); END IF;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_trim_requirement_param(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_delete_trim_requirement_param(uuid) TO authenticated, service_role;;
