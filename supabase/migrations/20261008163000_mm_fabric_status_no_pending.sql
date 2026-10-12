-- Fabric status: drop pending_review (Rahil 2026-10-08). Fabrics are active or inactive (UI: Archive).
-- Quick-create saves active; dedupe at create already blocks duplicates.
-- Back-compat: filters may still pass 'pending_review' (harmless IN match); mm_set_fabric_status maps it to active.

UPDATE public.mm_fabrics SET status = 'active', row_version = row_version + 1, updated_at = now()
WHERE status = 'pending_review';

ALTER TABLE public.mm_fabrics DROP CONSTRAINT IF EXISTS mm_fabrics_status_check;
ALTER TABLE public.mm_fabrics ADD CONSTRAINT mm_fabrics_status_check CHECK (status IN ('active', 'inactive'));

CREATE OR REPLACE FUNCTION public.mm_quick_create_fabric(p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_norm jsonb;
  v_dup uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('quick');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  v_norm := public._mm_fabric_normalize_full(v_factory, p_row - 'id');
  IF v_norm ? 'error' THEN RETURN v_norm->'error'; END IF;
  v_dup := public._mm_fabric_duplicate_of(v_factory, v_norm->>'dedupe_key', NULL);
  IF v_dup IS NOT NULL THEN
    RETURN public._mm_err('DUPLICATE', 'Already exists as ' || (SELECT code FROM public.mm_fabrics WHERE id = v_dup))
           || jsonb_build_object('existing', public._mm_fabric_json(v_dup));
  END IF;
  BEGIN
    v_id := public._mm_fabric_insert(v_factory, v_norm, 'active');
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'A fabric with the same specification already exists');
  END;
  RETURN public._mm_ok(public._mm_fabric_json(v_id));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_set_fabric_status(p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_cur public.mm_fabrics%ROWTYPE;
  v_dup uuid;
  v_status text := CASE WHEN p_status = 'pending_review' THEN 'active' ELSE p_status END;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  IF v_status IS NULL OR v_status NOT IN ('active', 'inactive') THEN
    RETURN public._mm_err('INVALID', 'Status must be active or inactive');
  END IF;
  SELECT * INTO v_cur FROM public.mm_fabrics WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric not found'); END IF;
  IF v_cur.merged_into_id IS NOT NULL THEN
    RETURN public._mm_err('INVALID', 'This fabric was merged into another and stays inactive');
  END IF;
  IF v_status <> 'inactive' THEN
    v_dup := public._mm_fabric_duplicate_of(v_factory, v_cur.dedupe_key, p_id);
    IF v_dup IS NOT NULL THEN
      RETURN public._mm_err('DUPLICATE', 'Already exists as ' || (SELECT code FROM public.mm_fabrics WHERE id = v_dup) || '. Merge instead.')
             || jsonb_build_object('existing', public._mm_fabric_json(v_dup));
    END IF;
  END IF;
  UPDATE public.mm_fabrics SET status = v_status, row_version = row_version + 1,
    updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = p_id;
  RETURN public._mm_ok(public._mm_fabric_json(p_id));
END $function$;
