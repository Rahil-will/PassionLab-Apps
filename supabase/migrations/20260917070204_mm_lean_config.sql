-- Lean Material config: only what Work Centers captures.
-- fabric types, per-type test KPIs, per-type requirement params, trim categories.
-- fabric_components stays the categories catalog (existing production table).

CREATE OR REPLACE FUNCTION public._mm_ok(p_data jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_data IS NULL THEN jsonb_build_object('ok', true)
              ELSE jsonb_build_object('ok', true, 'data', p_data) END;
$$;

CREATE OR REPLACE FUNCTION public._mm_err(p_code text, p_message text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ok', false, 'code', p_code, 'message', p_message);
$$;
;
