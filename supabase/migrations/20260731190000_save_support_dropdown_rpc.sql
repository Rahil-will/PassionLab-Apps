-- Support dropdown writes via RPC (admin-only, matches save_buyer pattern).
-- Note: column name "values" is a reserved word — must be quoted.

CREATE OR REPLACE FUNCTION public.save_support_dropdown(
  p_action text,
  p_factory_id uuid,
  p_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_app_name text DEFAULT NULL,
  p_values jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(
  id uuid,
  factory_id uuid,
  category text,
  app_name text,
  "values" jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  IF p_action = 'delete' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'id is required for delete'; END IF;
    DELETE FROM public.support_dropdowns sd
    WHERE sd.id = p_id AND sd.factory_id = p_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_action = 'insert' THEN
    IF p_category IS NULL OR trim(p_category) = '' THEN
      RAISE EXCEPTION 'category is required';
    END IF;
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.support_dropdowns (id, factory_id, category, app_name, "values")
    VALUES (
      v_id,
      p_factory_id,
      trim(p_category),
      NULLIF(trim(p_app_name), ''),
      COALESCE(p_values, '[]'::jsonb)
    );
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.support_dropdowns sd SET
      app_name = COALESCE(NULLIF(trim(p_app_name), ''), sd.app_name),
      "values" = COALESCE(p_values, sd."values"),
      updated_at = now()
    WHERE sd.id = v_id AND sd.factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Support dropdown not found'; END IF;
  END IF;

  RETURN QUERY
  SELECT sd.id, sd.factory_id, sd.category, sd.app_name, sd."values", sd.created_at, sd.updated_at
  FROM public.support_dropdowns sd
  WHERE sd.id = v_id AND sd.factory_id = p_factory_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_support_dropdown(text, uuid, uuid, text, text, jsonb) TO authenticated;
