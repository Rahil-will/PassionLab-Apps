-- Fabric rack management split: master (create racks + capacity) moves to Material Management
-- config; warehouse "Rack" page becomes ops-only (unassigned -> rack, rack -> rack, rack -> red
-- label). Dispatch to cutting now relocates rolls off the warehouse rack (store challan create).

ALTER TABLE public.mm_locations ADD COLUMN IF NOT EXISTS capacity_rolls integer;
ALTER TABLE public.mm_locations DROP CONSTRAINT IF EXISTS mm_locations_capacity_chk;
ALTER TABLE public.mm_locations
  ADD CONSTRAINT mm_locations_capacity_chk CHECK (capacity_rolls IS NULL OR capacity_rolls >= 0);

-- ---------------------------------------------------------------------------
-- Seed a red-label (rejected) area alongside MILL/WAREHOUSE/CUTTING_STORE/WAREHOUSE_RECV.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_seed_ops_locations(p_factory uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cut uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_cut := public.get_cutting_department_id(p_factory);
  EXCEPTION WHEN OTHERS THEN
    v_cut := NULL;
  END;

  INSERT INTO public.mm_locations AS loc (
    factory_id, code, name, location_type, department_id, is_pickable, is_active, created_by, updated_by
  ) VALUES
    (p_factory, 'MILL', 'Mill', 'virtual', NULL, false, true, p_actor, p_actor),
    (p_factory, 'WAREHOUSE', 'Fabric warehouse', 'store', NULL, false, true, p_actor, p_actor),
    (p_factory, 'CUTTING_STORE', 'Cutting store', 'cutting', v_cut, true, true, p_actor, p_actor)
  ON CONFLICT (factory_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    location_type = EXCLUDED.location_type,
    is_pickable = CASE WHEN loc.code = 'WAREHOUSE' THEN false ELSE EXCLUDED.is_pickable END,
    is_active = true,
    updated_at = now(),
    updated_by = p_actor;

  SELECT id INTO v_wh
  FROM public.mm_locations
  WHERE factory_id = p_factory AND code = 'WAREHOUSE'
  LIMIT 1;

  INSERT INTO public.mm_locations AS recv (
    factory_id, parent_id, code, name, location_type, is_pickable, is_active, created_by, updated_by
  ) VALUES (
    p_factory, v_wh, 'WAREHOUSE_RECV', 'Warehouse receiving', 'receiving', false, true, p_actor, p_actor
  )
  ON CONFLICT (factory_id, code) DO UPDATE SET
    parent_id = EXCLUDED.parent_id,
    name = EXCLUDED.name,
    location_type = 'receiving',
    is_pickable = false,
    is_active = true,
    updated_at = now(),
    updated_by = p_actor;

  INSERT INTO public.mm_locations AS red (
    factory_id, parent_id, code, name, location_type, is_pickable, is_active, created_by, updated_by
  ) VALUES (
    p_factory, v_wh, 'WAREHOUSE_REDLABEL', 'Red label area', 'rejected', false, true, p_actor, p_actor
  )
  ON CONFLICT (factory_id, code) DO UPDATE SET
    parent_id = EXCLUDED.parent_id,
    name = EXCLUDED.name,
    location_type = 'rejected',
    is_pickable = false,
    is_active = true,
    updated_at = now(),
    updated_by = p_actor;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- "Unassigned" = received, not pickable, and not deliberately red-labelled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_is_unassigned_loc(p_loc uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT NOT loc.is_pickable AND loc.location_type <> 'rejected'
    FROM public.mm_locations loc
    WHERE loc.id = p_loc
  ), false)
$$;

REVOKE ALL ON FUNCTION public._mm_is_unassigned_loc(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Dashboard: swap "not pickable" for "unassigned" so red-labelled rolls stop
-- showing up as waiting-for-putaway noise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_get_warehouse_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'rolls_in_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'qty_m', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'qty_kg', (
      SELECT COALESCE(sum(u.weight_kg), 0) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'rolls_pickable', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
    ),
    'pending_putaway', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ),
    'red_label_count', (
      SELECT count(*) FROM public.mm_stock_units u
      JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND loc.location_type = 'rejected'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'by_fabric_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', t.name, 'rolls', t.n) ORDER BY t.n DESC)
      FROM (
        SELECT ft.name, count(*)::int AS n
        FROM public.mm_stock_units u
        JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
        JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
        WHERE u.factory_id = v_factory AND u.status = 'in_stock'
          AND public._mm_loc_is_under(u.current_location_id, v_wh)
        GROUP BY ft.name
        ORDER BY count(*) DESC
        LIMIT 6
      ) t
    ), '[]'::jsonb),
    'pending', COALESCE((
      SELECT jsonb_agg(s.x ORDER BY s.ts DESC NULLS LAST)
      FROM (
        SELECT q.x, q.ts
        FROM (
          SELECT jsonb_build_object(
            'kind', 'mill', 'id', c.id, 'label',
            'Batch ' || c.challan_no || ' — ' || o.style_name || ' / ' || cw.name || ' — ' ||
            (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = c.id) || ' rolls — sent ' ||
            CASE WHEN c.sent_at IS NULL THEN 'today'
                 WHEN c.sent_at > now() - interval '1 day' THEN 'today'
                 ELSE (EXTRACT(DAY FROM now() - c.sent_at)::int)::text || ' days ago' END,
            'ts', c.sent_at
          ) AS x, c.sent_at AS ts
          FROM public.mm_in_challans c
          JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          JOIN public.style_orders o ON o.id = sm.order_id
          JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'mill' AND c.status = 'pending'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'vendor', 'id', c.id, 'label',
            c.challan_no || ' — ' || o.style_name || ' / ' || cw.name || ' — ' ||
            (SELECT count(*) FILTER (WHERE u.qc_result IS NOT NULL) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' of ' ||
            (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' rolls tested',
            'ts', c.received_at
          ) AS x, c.received_at AS ts
          FROM public.mm_in_challans c
          JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          JOIN public.style_orders o ON o.id = sm.order_id
          JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'vendor'
            AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'putaway', 'id', 'queue', 'label',
            (SELECT count(*) FROM public.mm_stock_units u
             WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
               AND public._mm_loc_is_under(u.current_location_id, v_wh)
               AND public._mm_is_unassigned_loc(u.current_location_id)
            )::text || ' rolls waiting for rack putaway',
            'ts', now()
          ) AS x, now() AS ts
          WHERE EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
              AND public._mm_is_unassigned_loc(u.current_location_id)
          )
        ) q
        ORDER BY q.ts DESC NULLS LAST
        LIMIT 8
      ) s
    ), '[]'::jsonb),
    'internal_pending', (
      SELECT count(*) FROM public.mm_in_challans
      WHERE factory_id = v_factory AND source = 'mill' AND status = 'pending'
    ),
    'internal_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.source = 'mill' AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'external_pending', (
      SELECT count(*) FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory AND c.source = 'vendor'
        AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
    ),
    'external_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.source = 'vendor' AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'store_pending', (
      SELECT count(*) FROM public.mm_store_challans
      WHERE factory_id = v_factory AND status = 'pending'
    ),
    'store_sent', (
      SELECT count(*) FROM public.mm_store_challans WHERE factory_id = v_factory
    ),
    'rack_count', (
      SELECT count(*) FROM public.mm_locations
      WHERE factory_id = v_factory AND is_active AND location_type IN ('rack', 'bin')
        AND public._mm_loc_is_under(id, v_wh)
    )
  ));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Store challan create = the warehouse->cutting dispatch. Rolls relocate off
-- the rack to the cutting store immediately (D29 revision 2026-09-17b).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_id uuid;
  v_no text;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL OR p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = v_uid AND u.factory_id = v_factory AND u.style_material_id = p_style_material_id
        AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ) THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not on a warehouse rack');
    END IF;
  END LOOP;
  v_no := public.next_doc_no('SC');
  INSERT INTO public.mm_store_challans (
    factory_id, challan_no, style_material_id, from_location_id, to_location_id,
    status, sent_at, sent_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, p_style_material_id, v_wh, v_cut, 'pending', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_id;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, auth.uid());
    UPDATE public.mm_stock_units SET
      store_challan_id = v_id, current_location_id = v_cut,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_uid;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_cut, 'mm_store_challans', v_id, 'Dispatched to cutting'
    );
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- mm_putaway_rolls: one generic "move" RPC used by all three warehouse rack
-- ops (add unassigned to rack, rack -> rack, rack -> red label).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_putaway_rolls(p_unit_ids uuid[], p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_loc public.mm_locations%ROWTYPE;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_location_id IS NULL OR p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls and a target location');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_location_id AND factory_id = v_factory AND is_active;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('rack', 'bin', 'rejected') THEN
    RETURN public._mm_err('INVALID', 'Choose a rack, bin, or the red-label area');
  END IF;
  IF v_loc.location_type IN ('rack', 'bin') AND NOT v_loc.is_pickable THEN
    RETURN public._mm_err('INVALID', 'That rack or bin is not active');
  END IF;
  IF NOT public._mm_loc_is_under(v_loc.id, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Target must be in the warehouse');
  END IF;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.status <> 'in_stock' OR v_unit.store_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not available to move');
    END IF;
    IF NOT public._mm_loc_is_under(v_unit.current_location_id, v_wh) THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not in the warehouse');
    END IF;
    UPDATE public.mm_stock_units SET
      current_location_id = v_loc.id,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_loc.id, 'mm_locations', v_loc.id,
      CASE WHEN v_loc.location_type = 'rejected' THEN 'Moved to red label' ELSE 'Rack move' END
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'location_id', v_loc.id));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Rack MASTER (Material Management config) — create/edit/deactivate racks
-- and set roll capacity. Config permission, not ops permission.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_list_rack_master()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id,
        'parent_id', loc.parent_id,
        'code', loc.code,
        'name', loc.name,
        'location_type', loc.location_type,
        'is_pickable', loc.is_pickable,
        'capacity_rolls', loc.capacity_rolls,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.location_type, loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('zone', 'rack', 'bin')
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_rack_location(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_id uuid;
  v_parent uuid;
  v_code text;
  v_name text;
  v_type text;
  v_pick boolean;
  v_parent_type text;
  v_capacity integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_id := NULLIF(p_row->>'id', '')::uuid;
  v_code := upper(NULLIF(trim(COALESCE(p_row->>'code', '')), ''));
  v_name := NULLIF(trim(COALESCE(p_row->>'name', '')), '');
  v_type := NULLIF(trim(COALESCE(p_row->>'location_type', '')), '');
  v_parent := COALESCE(NULLIF(p_row->>'parent_id', '')::uuid, v_wh);
  v_capacity := NULLIF(p_row->>'capacity_rolls', '')::integer;
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Name is required'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Location must be a zone, rack, or bin');
  END IF;
  IF v_capacity IS NOT NULL AND v_capacity < 0 THEN
    RETURN public._mm_err('INVALID', 'Capacity cannot be negative');
  END IF;
  IF v_code IS NULL THEN
    v_code := upper(left(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'), 24));
  END IF;
  IF v_parent IS DISTINCT FROM v_wh AND NOT public._mm_loc_is_under(v_parent, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Parent must be under the warehouse');
  END IF;
  SELECT location_type INTO v_parent_type FROM public.mm_locations WHERE id = v_parent AND factory_id = v_factory;
  IF v_type = 'zone' AND v_parent_type NOT IN ('store', 'zone') THEN
    RETURN public._mm_err('INVALID', 'A zone sits under the warehouse or another zone');
  END IF;
  IF v_type = 'rack' AND v_parent_type NOT IN ('store', 'zone') THEN
    RETURN public._mm_err('INVALID', 'A rack sits under the warehouse or a zone');
  END IF;
  IF v_type = 'bin' AND v_parent_type IS DISTINCT FROM 'rack' THEN
    RETURN public._mm_err('INVALID', 'A bin sits under a rack');
  END IF;
  v_pick := v_type IN ('rack', 'bin');
  IF v_id IS NULL THEN
    INSERT INTO public.mm_locations (
      factory_id, parent_id, code, name, location_type, is_pickable, capacity_rolls, is_active, created_by, updated_by
    ) VALUES (
      v_factory, v_parent, v_code, v_name, v_type, v_pick, v_capacity, true, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_locations
      WHERE id = v_id AND factory_id = v_factory AND location_type IN ('zone', 'rack', 'bin')
    ) THEN
      RETURN public._mm_err('NOT_FOUND', 'Location not found');
    END IF;
    UPDATE public.mm_locations SET
      parent_id = v_parent, code = v_code, name = v_name, location_type = v_type,
      is_pickable = v_pick, capacity_rolls = v_capacity, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_id;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'code', v_code));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE', 'That location code already exists');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_deactivate_rack_location(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_loc public.mm_locations%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Cannot remove this location');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.status = 'in_stock'
      AND (
        u.current_location_id = v_loc.id
        OR public._mm_loc_is_under(u.current_location_id, v_loc.id)
      )
  ) THEN
    RETURN public._mm_err('IN_USE', 'Move rolls off this rack before removing it');
  END IF;
  UPDATE public.mm_locations SET is_active = false, updated_at = now(), updated_by = auth.uid()
  WHERE factory_id = v_factory AND (
    id = v_loc.id OR public._mm_loc_is_under(id, v_loc.id)
  ) AND location_type IN ('zone', 'rack', 'bin');
  RETURN public._mm_ok(jsonb_build_object('id', v_loc.id));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Rack OPS board (warehouse-side) — everything the ops page needs in one call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_red uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_red := public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'red_label_id', v_red,
    'rack_targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type,
        'capacity_rolls', loc.capacity_rolls,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin') AND loc.is_pickable
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'unassigned_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY o.style_name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ), '[]'::jsonb),
    'racked_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY loc.code, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb)
  ));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_list_rack_master() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_rack_location(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_deactivate_rack_location(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_rack_ops_board() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_putaway_rolls(uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dashboard() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
;
