-- Fabric master <-> order lines (applied on MES 2026-10-07 as:
--   mm_fabric_order_line_triggers, mm_fabric_upsert_colorway_material,
--   mm_fabric_link_by_id, mm_fabric_helpers_search_path)

-- ===========================================================================
-- 1. BEFORE trigger: fabric snapshot, fabric colour normalise, line_key default,
--    total_cons = cons_per_pc x colorways.adj_qty x (1 + PL% + W%)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.colorway_materials_fabric_calc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f public.mm_fabrics%ROWTYPE;
  v_type text;
  v_cw_name text;
  v_adj numeric;
BEGIN
  IF NEW.line_key IS NULL THEN NEW.line_key := gen_random_uuid(); END IF;
  SELECT c.name, c.adj_qty INTO v_cw_name, v_adj FROM public.colorways c WHERE c.id = NEW.colorway_id;

  IF NEW.fabric_id IS NOT NULL THEN
    IF NEW.kind IS DISTINCT FROM 'Fabric' THEN
      RAISE EXCEPTION 'Only fabric lines can link to the fabric master';
    END IF;
    SELECT * INTO f FROM public.mm_fabrics WHERE id = NEW.fabric_id;
    IF f.id IS NULL OR f.factory_id IS DISTINCT FROM NEW.factory_id THEN
      RAISE EXCEPTION 'Fabric not found for this factory';
    END IF;
    IF f.merged_into_id IS NOT NULL THEN
      NEW.fabric_id := f.merged_into_id;
      SELECT * INTO f FROM public.mm_fabrics WHERE id = NEW.fabric_id;
    END IF;
    IF f.status = 'inactive' AND (TG_OP = 'INSERT' OR OLD.fabric_id IS DISTINCT FROM NEW.fabric_id) THEN
      RAISE EXCEPTION 'Fabric % is inactive', f.code;
    END IF;
    SELECT t.name INTO v_type FROM public.mm_fabric_types t WHERE t.id = f.fabric_type_id;
    NEW.name := f.name;
    NEW.type := v_type;
    NEW.unit := f.uom;
    NEW.extras := jsonb_set(
      COALESCE(NEW.extras, '{}'::jsonb), '{paramValues}',
      COALESCE(NEW.extras->'paramValues', '{}'::jsonb) || f.spec_values
        || jsonb_build_object('gsm', trim_scale(f.gsm)::text, 'width', trim_scale(f.width_in)::text),
      true);
    IF f.color_method IN ('yarn_dyed', 'melange', 'print') THEN
      NEW.fabric_color := NULL;
      NEW.fabric_color_ref := f.design_ref;
    END IF;
  END IF;

  NEW.fabric_color := NULLIF(btrim(NEW.fabric_color), '');
  IF NEW.fabric_color IS NOT NULL AND lower(NEW.fabric_color) = lower(btrim(COALESCE(v_cw_name, ''))) THEN
    NEW.fabric_color := NULL;
  END IF;
  NEW.fabric_color_ref := NULLIF(btrim(NEW.fabric_color_ref), '');

  NEW.total_cons := CASE
    WHEN NEW.cons_per_pc IS NULL THEN NULL
    ELSE round(NEW.cons_per_pc * COALESCE(v_adj, 0)
               * (1 + COALESCE(NEW.process_loss_pct, 0) / 100 + COALESCE(NEW.wastage_pct, 0) / 100), 3)
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER colorway_materials_zz_fabric_calc_trg
  BEFORE INSERT OR UPDATE ON public.colorway_materials
  FOR EACH ROW EXECUTE FUNCTION public.colorway_materials_fabric_calc();

-- ===========================================================================
-- 2. Colorway qty / name change -> recompute its material rows
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.colorways_recalc_materials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.colorway_materials SET updated_at = now() WHERE colorway_id = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER colorways_recalc_materials_trg
  AFTER UPDATE OF adj_qty, name ON public.colorways
  FOR EACH ROW
  WHEN (OLD.adj_qty IS DISTINCT FROM NEW.adj_qty OR OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.colorways_recalc_materials();

-- ===========================================================================
-- 3. Deferred LINE_MISMATCH check (linked fabric lines only)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.colorway_materials_check_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.line_key IS NULL OR NEW.kind IS DISTINCT FROM 'Fabric' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.colorway_materials WHERE id = NEW.id AND fabric_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  SELECT count(DISTINCT COALESCE(fabric_id::text, '-')) AS nf,
         count(DISTINCT lower(btrim(category))) AS nc,
         count(DISTINCT unit) AS nu,
         count(DISTINCT COALESCE(process_loss_pct, 0)) AS nl,
         count(DISTINCT COALESCE(wastage_pct, 0)) AS nw,
         count(DISTINCT cons_per_pc) FILTER (WHERE NOT cons_overridden) AS ncons,
         count(*) - count(DISTINCT colorway_id) AS dupcw,
         min(name) AS fname
  INTO r
  FROM public.colorway_materials
  WHERE order_id = NEW.order_id AND line_key = NEW.line_key;
  IF r.nf > 1 OR r.nc > 1 OR r.nu > 1 OR r.nl > 1 OR r.nw > 1 OR r.ncons > 1 OR r.dupcw > 0 THEN
    RAISE EXCEPTION 'LINE_MISMATCH: fabric line "%" must have the same fabric, placement, UOM, PL%%, W%% and cons (unless overridden) in every colour, once per colour', r.fname
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER colorway_materials_line_check
  AFTER INSERT OR UPDATE ON public.colorway_materials
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.colorway_materials_check_line();

-- ===========================================================================
-- 4. Keep mm_style_materials.fabric_id in step with the order line
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.colorway_materials_sync_style_material()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.mm_style_materials sm SET
    fabric_id = NEW.fabric_id,
    fabric_type_id = CASE
      WHEN NEW.fabric_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.mm_stock_units x WHERE x.style_material_id = sm.id)
       AND NOT EXISTS (SELECT 1 FROM public.mm_mill_rolls x WHERE x.style_material_id = sm.id)
       AND NOT EXISTS (SELECT 1 FROM public.mm_mill_batches x WHERE x.style_material_id = sm.id)
       AND NOT EXISTS (SELECT 1 FROM public.mm_in_challans x WHERE x.style_material_id = sm.id)
       AND NOT EXISTS (SELECT 1 FROM public.mm_store_challans x WHERE x.style_material_id = sm.id)
      THEN (SELECT f.fabric_type_id FROM public.mm_fabrics f WHERE f.id = NEW.fabric_id)
      ELSE sm.fabric_type_id
    END,
    updated_at = now()
  WHERE sm.colorway_material_id = NEW.id
    AND sm.fabric_id IS DISTINCT FROM NEW.fabric_id;
  RETURN NULL;
END $$;

CREATE TRIGGER colorway_materials_sync_style_material_trg
  AFTER UPDATE OF fabric_id ON public.colorway_materials
  FOR EACH ROW
  WHEN (OLD.fabric_id IS DISTINCT FROM NEW.fabric_id)
  EXECUTE FUNCTION public.colorway_materials_sync_style_material();

REVOKE ALL ON FUNCTION public.colorway_materials_fabric_calc() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.colorways_recalc_materials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.colorway_materials_check_line() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.colorway_materials_sync_style_material() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 5. _upsert_colorway_material: new keys fabricId, fabricColor, fabricColorRef,
--    lineKey, consOverridden. Kept as-is when the payload does not send them.
--    totalCons from the client is ignored (trigger computes it).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._upsert_colorway_material(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_mat jsonb, p_seq integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_kind text;
  v_category text;
  v_type text;
  v_placement text;
  v_unit text;
  v_cons numeric;
  v_total numeric;
  v_loss numeric;
  v_waste numeric;
  v_extras jsonb;
  v_src jsonb;
  v_factory_id uuid;
  v_order_id uuid;
  v_has_fabric boolean := p_mat ? 'fabricId' OR p_mat ? 'fabric_id';
  v_has_color boolean := p_mat ? 'fabricColor' OR p_mat ? 'fabric_color';
  v_has_ref boolean := p_mat ? 'fabricColorRef' OR p_mat ? 'fabric_color_ref';
  v_has_line boolean := p_mat ? 'lineKey' OR p_mat ? 'line_key';
  v_has_ovr boolean := p_mat ? 'consOverridden' OR p_mat ? 'cons_overridden';
  v_fabric uuid;
  v_color text;
  v_ref text;
  v_line uuid;
  v_ovr boolean;
BEGIN
  SELECT cw.factory_id, cw.order_id
    INTO v_factory_id, v_order_id
    FROM public.colorways cw
    WHERE cw.id = p_colorway_id;

  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'colorway % not found', p_colorway_id;
  END IF;
  IF v_factory_id IS DISTINCT FROM p_factory_id THEN
    RAISE EXCEPTION 'colorway factory mismatch';
  END IF;
  IF p_order_id IS NOT NULL AND v_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'colorway order mismatch';
  END IF;

  BEGIN
    v_id := NULLIF(trim(p_mat->>'id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;
  IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

  IF EXISTS (
    SELECT 1 FROM public.colorway_materials
    WHERE id = v_id
      AND (factory_id IS DISTINCT FROM v_factory_id OR colorway_id IS DISTINCT FROM p_colorway_id)
  ) THEN
    v_id := gen_random_uuid();
  END IF;

  v_src := CASE WHEN jsonb_typeof(p_mat->'extras') = 'object' THEN p_mat->'extras' ELSE '{}'::jsonb END;

  v_kind := CASE
    WHEN trim(COALESCE(p_mat->>'kind', '')) IN ('Fabric', 'Trim') THEN trim(p_mat->>'kind')
    WHEN trim(COALESCE(p_mat->>'category', '')) IN ('Fabric', 'Trim') THEN trim(p_mat->>'category')
    ELSE 'Fabric'
  END;

  v_category := CASE
    WHEN trim(COALESCE(p_mat->>'kind', '')) IN ('Fabric', 'Trim')
      THEN COALESCE(p_mat->>'category', '')
    WHEN v_kind = 'Trim' THEN COALESCE(
      NULLIF(p_mat->>'trimCategory', ''),
      NULLIF(v_src->>'trimCategory', ''),
      ''
    )
    ELSE COALESCE(
      NULLIF(p_mat->>'fabricCategory', ''),
      NULLIF(v_src->>'fabricCategory', ''),
      ''
    )
  END;

  v_type := COALESCE(
    NULLIF(trim(p_mat->>'type'), ''),
    CASE WHEN v_kind = 'Trim' THEN NULLIF(trim(COALESCE(p_mat->>'trimType', v_src->>'trimType')), '') ELSE NULL END,
    ''
  );

  v_placement := CASE
    WHEN v_kind = 'Trim' THEN COALESCE(
      NULLIF(trim(p_mat->>'placement'), ''),
      NULLIF(trim(v_src->>'placement'), ''),
      ''
    )
    ELSE ''
  END;

  v_unit := COALESCE(
    NULLIF(trim(p_mat->>'unit'), ''),
    NULLIF(trim(v_src->>'unit'), ''),
    ''
  );

  v_cons := CASE
    WHEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc'))::numeric
    WHEN v_kind = 'Trim' AND (p_mat->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'perPc')::numeric
    WHEN v_kind = 'Fabric' AND (p_mat->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'avgCons')::numeric
    ELSE NULL
  END;

  v_total := CASE
    WHEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty'))::numeric
    ELSE NULL
  END;

  v_loss := CASE
    WHEN (COALESCE(p_mat->>'processLossPct', p_mat->>'process_loss_pct')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN NULLIF((COALESCE(p_mat->>'processLossPct', p_mat->>'process_loss_pct'))::numeric, 0)
    ELSE NULL
  END;

  v_waste := CASE
    WHEN (COALESCE(p_mat->>'wastagePct', p_mat->>'wastage_pct')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN NULLIF((COALESCE(p_mat->>'wastagePct', p_mat->>'wastage_pct'))::numeric, 0)
    ELSE NULL
  END;

  v_extras := jsonb_strip_nulls(jsonb_build_object(
    'paramValues', CASE
      WHEN jsonb_typeof(v_src->'paramValues') = 'object' AND v_src->'paramValues' <> '{}'::jsonb
        THEN v_src->'paramValues'
      WHEN jsonb_typeof(p_mat->'paramValues') = 'object' AND p_mat->'paramValues' <> '{}'::jsonb
        THEN p_mat->'paramValues'
      ELSE NULL
    END
  ));

  BEGIN
    v_fabric := NULLIF(trim(COALESCE(p_mat->>'fabricId', p_mat->>'fabric_id')), '')::uuid;
    v_line := NULLIF(trim(COALESCE(p_mat->>'lineKey', p_mat->>'line_key')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid fabricId or lineKey on material line';
  END;
  IF v_kind <> 'Fabric' THEN v_fabric := NULL; END IF;
  v_color := NULLIF(trim(COALESCE(p_mat->>'fabricColor', p_mat->>'fabric_color')), '');
  v_ref := NULLIF(trim(COALESCE(p_mat->>'fabricColorRef', p_mat->>'fabric_color_ref')), '');
  v_ovr := COALESCE(NULLIF(COALESCE(p_mat->>'consOverridden', p_mat->>'cons_overridden'), '')::boolean, false);

  INSERT INTO public.colorway_materials (
    id, factory_id, order_id, colorway_id, seq,
    kind, category, name, type, placement, unit, cons_per_pc, total_cons,
    process_loss_pct, wastage_pct, extras,
    fabric_id, fabric_color, fabric_color_ref, line_key, cons_overridden,
    updated_at
  ) VALUES (
    v_id, v_factory_id, v_order_id, p_colorway_id, COALESCE(p_seq, 0),
    v_kind,
    COALESCE(v_category, ''),
    COALESCE(p_mat->>'name', ''),
    v_type,
    v_placement,
    v_unit,
    v_cons,
    v_total,
    v_loss,
    v_waste,
    COALESCE(v_extras, '{}'::jsonb),
    v_fabric, v_color, v_ref, v_line, v_ovr,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    factory_id = EXCLUDED.factory_id,
    order_id = EXCLUDED.order_id,
    colorway_id = EXCLUDED.colorway_id,
    seq = EXCLUDED.seq,
    kind = EXCLUDED.kind,
    category = EXCLUDED.category,
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    placement = EXCLUDED.placement,
    unit = EXCLUDED.unit,
    cons_per_pc = EXCLUDED.cons_per_pc,
    total_cons = EXCLUDED.total_cons,
    process_loss_pct = EXCLUDED.process_loss_pct,
    wastage_pct = EXCLUDED.wastage_pct,
    extras = EXCLUDED.extras,
    fabric_id = CASE WHEN v_has_fabric OR v_kind <> 'Fabric' THEN EXCLUDED.fabric_id ELSE colorway_materials.fabric_id END,
    fabric_color = CASE WHEN v_has_color THEN EXCLUDED.fabric_color ELSE colorway_materials.fabric_color END,
    fabric_color_ref = CASE WHEN v_has_ref THEN EXCLUDED.fabric_color_ref ELSE colorway_materials.fabric_color_ref END,
    line_key = CASE WHEN v_has_line AND EXCLUDED.line_key IS NOT NULL THEN EXCLUDED.line_key ELSE colorway_materials.line_key END,
    cons_overridden = CASE WHEN v_has_ovr THEN EXCLUDED.cons_overridden ELSE colorway_materials.cons_overridden END,
    updated_at = now();

  RETURN v_id;
END;
$function$;

-- ===========================================================================
-- 6. MM link by fabric_id (legacy name match only for unlinked rows)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._mm_resolve_style_material(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_type_name text;
  v_type_id uuid;
  v_kind text;
  v_bom uuid;
  v_fabric uuid;
  v_out public.mm_style_materials%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    RETURN public._mm_err('NO_PERMISSION', 'Not allowed');
  END;

  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric line are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o
    WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.colorways c
    WHERE c.id = p_colorway_id AND c.order_id = p_order_id AND c.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Colorway not found');
  END IF;

  SELECT cm.id, cm.kind, NULLIF(trim(cm.type), ''), cm.fabric_id
    INTO v_bom, v_kind, v_type_name, v_fabric
  FROM public.colorway_materials cm
  WHERE cm.id = p_colorway_material_id AND cm.factory_id = v_factory
    AND cm.order_id = p_order_id AND cm.colorway_id = p_colorway_id;
  IF v_bom IS NOT NULL AND v_kind IS DISTINCT FROM 'Fabric' THEN
    RETURN public._mm_err('INVALID', 'Pick a fabric line, not trim');
  END IF;

  IF v_bom IS NULL THEN
    SELECT id, name INTO v_type_id, v_type_name
    FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
    END IF;
  ELSIF v_fabric IS NOT NULL THEN
    SELECT f.fabric_type_id INTO v_type_id FROM public.mm_fabrics f WHERE f.id = v_fabric;
  ELSE
    IF v_type_name IS NULL OR v_type_name = '' THEN
      RETURN public._mm_err('REQUIRED', 'This fabric line has no fabric. Pick one from the fabric master on the order first');
    END IF;
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric type "' || v_type_name || '" is not in Material setup');
    END IF;
  END IF;

  IF v_bom IS NOT NULL THEN
    INSERT INTO public.mm_style_materials (
      factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, fabric_id, created_by, updated_by
    ) VALUES (
      v_factory, p_order_id, p_colorway_id, v_bom, v_type_id, v_fabric, public._mm_actor_id(), public._mm_actor_id()
    )
    ON CONFLICT (factory_id, colorway_material_id) WHERE colorway_material_id IS NOT NULL
    DO UPDATE SET
      fabric_type_id = CASE
        WHEN mm_style_materials.fabric_type_id = EXCLUDED.fabric_type_id THEN mm_style_materials.fabric_type_id
        WHEN EXISTS (SELECT 1 FROM public.mm_stock_units x WHERE x.style_material_id = mm_style_materials.id)
          OR EXISTS (SELECT 1 FROM public.mm_mill_rolls x WHERE x.style_material_id = mm_style_materials.id)
          OR EXISTS (SELECT 1 FROM public.mm_mill_batches x WHERE x.style_material_id = mm_style_materials.id)
          THEN mm_style_materials.fabric_type_id
        ELSE EXCLUDED.fabric_type_id
      END,
      fabric_id = COALESCE(EXCLUDED.fabric_id, mm_style_materials.fabric_id),
      colorway_id = EXCLUDED.colorway_id,
      order_id = EXCLUDED.order_id,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    RETURNING * INTO v_out;
  ELSE
    INSERT INTO public.mm_style_materials (
      factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
    ) VALUES (
      v_factory, p_order_id, p_colorway_id, NULL, v_type_id, public._mm_actor_id(), public._mm_actor_id()
    )
    ON CONFLICT (factory_id, order_id, colorway_id, fabric_type_id) WHERE colorway_material_id IS NULL
    DO UPDATE SET
      updated_at = now(),
      updated_by = public._mm_actor_id()
    RETURNING * INTO v_out;
  END IF;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_order_fabric_lines(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_colorways jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT EXISTS (SELECT 1 FROM public.style_orders WHERE id = p_order_id AND factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'color_code', c.color_code,
    'fabrics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cm.id,
        'name', COALESCE(f.name, NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), 'Fabric'),
        'type', cm.type,
        'fabric_category', cm.category,
        'fabric_type_id', COALESCE(f.fabric_type_id, ft.id),
        'fabric_id', f.id,
        'fabric_code', f.code,
        'fabric_name', f.name,
        'fabric_color', COALESCE(cm.fabric_color, c.name),
        'fabric_color_ref', cm.fabric_color_ref,
        'line_key', cm.line_key,
        'uom', cm.unit,
        'required', cm.total_cons
      ) ORDER BY cm.seq, cm.name)
      FROM public.colorway_materials cm
      LEFT JOIN public.mm_fabrics f ON f.id = cm.fabric_id
      LEFT JOIN public.mm_fabric_types ft
        ON cm.fabric_id IS NULL AND ft.factory_id = v_factory AND ft.is_active
       AND lower(ft.name) = lower(NULLIF(trim(cm.type), ''))
      WHERE cm.colorway_id = c.id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
    ), '[]'::jsonb)
  ) ORDER BY c.name), '[]'::jsonb)
  INTO v_colorways
  FROM public.colorways c
  WHERE c.order_id = p_order_id AND c.factory_id = v_factory;

  RETURN public._mm_ok(jsonb_build_object('colorways', v_colorways));
END;
$function$;

-- ===========================================================================
-- 7. Advisor fix
-- ===========================================================================
ALTER FUNCTION public._mm_num(text) SET search_path TO 'public';
ALTER FUNCTION public._mm_guard_err(text) SET search_path TO 'public';
