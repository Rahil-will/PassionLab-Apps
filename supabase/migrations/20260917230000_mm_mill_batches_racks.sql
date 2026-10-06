-- Mill batches (assign rolls) vs mill dispatch (select rolls → inbound challan).
-- Warehouse receiving + rack putaway; store challan only from pickable rack/bin.

CREATE TABLE IF NOT EXISTS public.mm_mill_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  style_material_id uuid NOT NULL REFERENCES public.mm_style_materials (id) ON DELETE RESTRICT,
  batch_no text NOT NULL,
  mill_ref text,
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  remarks text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_mill_batches_factory_line_no_uidx UNIQUE (factory_id, style_material_id, batch_no)
);
CREATE INDEX IF NOT EXISTS mm_mill_batches_style_idx ON public.mm_mill_batches (style_material_id);
SELECT public._mm_lockdown_table('public.mm_mill_batches'::regclass);

ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS mill_batch_id uuid;
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mm_stock_units_mill_batch_fk'
  ) THEN
    ALTER TABLE public.mm_stock_units
      ADD CONSTRAINT mm_stock_units_mill_batch_fk
      FOREIGN KEY (mill_batch_id) REFERENCES public.mm_mill_batches (id) ON DELETE SET NULL;
  END IF;
END;
$fk$;
CREATE INDEX IF NOT EXISTS mm_stock_units_mill_batch_idx ON public.mm_stock_units (mill_batch_id);

CREATE OR REPLACE FUNCTION public._mm_loc_is_under(p_loc uuid, p_root uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_loc IS NULL OR p_root IS NULL THEN false
    ELSE EXISTS (
      WITH RECURSIVE chain AS (
        SELECT id, parent_id FROM public.mm_locations WHERE id = p_loc
        UNION ALL
        SELECT p.id, p.parent_id
        FROM public.mm_locations p
        JOIN chain c ON p.id = c.parent_id
      )
      SELECT 1 FROM chain WHERE id = p_root
    )
  END
$$;

CREATE OR REPLACE FUNCTION public._mm_recv_loc(p_factory uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    public._mm_loc(p_factory, 'WAREHOUSE_RECV'),
    public._mm_loc(p_factory, 'WAREHOUSE')
  )
$$;

CREATE OR REPLACE FUNCTION public._mm_is_pickable_loc(p_loc uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT loc.is_pickable AND loc.is_active AND loc.location_type IN ('rack', 'bin')
    FROM public.mm_locations loc
    WHERE loc.id = p_loc
  ), false)
$$;

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
END;
$fn$;

INSERT INTO public.mm_locations (factory_id, code, name, location_type, is_pickable, is_active)
SELECT f.id, loc.code, loc.name, loc.location_type, loc.pickable, true
FROM public.factories f
CROSS JOIN (
  VALUES
    ('MILL', 'Mill', 'virtual', false),
    ('WAREHOUSE', 'Fabric warehouse', 'store', false),
    ('CUTTING_STORE', 'Cutting store', 'cutting', true)
) AS loc(code, name, location_type, pickable)
ON CONFLICT (factory_id, code) DO UPDATE SET
  is_pickable = CASE WHEN public.mm_locations.code = 'WAREHOUSE' THEN false ELSE public.mm_locations.is_pickable END;

INSERT INTO public.mm_locations (factory_id, parent_id, code, name, location_type, is_pickable, is_active)
SELECT w.factory_id, w.id, 'WAREHOUSE_RECV', 'Warehouse receiving', 'receiving', false, true
FROM public.mm_locations w
WHERE w.code = 'WAREHOUSE'
ON CONFLICT (factory_id, code) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  location_type = 'receiving',
  is_pickable = false,
  is_active = true;

CREATE OR REPLACE FUNCTION public.mm_get_ops_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_mill boolean;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'Not allowed'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  SELECT COALESCE(bool_or(enabled), true) INTO v_mill
  FROM public.mm_factory_features
  WHERE factory_id = v_factory AND feature_key = 'in_house_mill';
  RETURN public._mm_ok(jsonb_build_object(
    'in_house_mill', COALESCE(v_mill, true),
    'features', COALESCE((
      SELECT jsonb_object_agg(feature_key, enabled)
      FROM public.mm_factory_features WHERE factory_id = v_factory
    ), '{}'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'name', name, 'location_type', location_type,
        'parent_id', parent_id, 'is_pickable', is_pickable
      ) ORDER BY code)
      FROM public.mm_locations WHERE factory_id = v_factory AND is_active
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_mill_cell_status(p_at_mill integer, p_dispatched integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_at_mill, 0) = 0 AND COALESCE(p_dispatched, 0) = 0 THEN 'none'
    WHEN COALESCE(p_at_mill, 0) > 0 AND COALESCE(p_dispatched, 0) = 0 THEN 'at_mill'
    WHEN COALESCE(p_at_mill, 0) > 0 AND COALESCE(p_dispatched, 0) > 0 THEN 'partial'
    ELSE 'dispatched'
  END
$$;

CREATE OR REPLACE FUNCTION public.mm_resolve_style_material(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_type_name text;
  v_type_id uuid;
  v_kind text;
  v_bom uuid;
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

  v_bom := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT cm.id, cm.kind, NULLIF(trim(cm.type), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_bom, v_kind, v_type_name
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_bom := NULL;
    END;
    IF v_bom IS NOT NULL AND v_kind IS DISTINCT FROM 'Fabric' THEN
      RETURN public._mm_err('INVALID', 'Pick a fabric line, not trim');
    END IF;
  END IF;

  IF v_bom IS NULL THEN
    SELECT id, name INTO v_type_id, v_type_name
    FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
    END IF;
  ELSE
    IF v_type_name IS NULL OR v_type_name = '' THEN
      RETURN public._mm_err('REQUIRED', 'This fabric line has no fabric type. Set it on the order first');
    END IF;
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric type "' || v_type_name || '" is not in Material setup');
    END IF;
  END IF;

  INSERT INTO public.mm_style_materials (
    factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
  ) VALUES (
    v_factory, p_order_id, p_colorway_id, v_bom, v_type_id, auth.uid(), auth.uid()
  )
  ON CONFLICT (factory_id, order_id, colorway_id, fabric_type_id) DO UPDATE SET
    colorway_material_id = COALESCE(EXCLUDED.colorway_material_id, public.mm_style_materials.colorway_material_id),
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_order_fabric_lines(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  v_colorways := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(jsonb_agg(jsonb_build_object(
           ''id'', c.id, ''name'', c.name, ''color_code'', c.color_code,
           ''fabrics'', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               ''id'', cm.id,
               ''name'', COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
               ''type'', cm.type,
               ''fabric_category'', cm.category,
               ''fabric_type_id'', ft.id
             ) ORDER BY cm.seq, cm.name)
             FROM public.colorway_materials cm
             LEFT JOIN public.mm_fabric_types ft
               ON ft.factory_id = $2 AND ft.is_active
              AND lower(ft.name) = lower(NULLIF(trim(cm.type), ''''))
             WHERE cm.colorway_id = c.id AND cm.factory_id = $2 AND cm.kind = ''Fabric''
           ), ''[]''::jsonb)
         ) ORDER BY c.name), ''[]''::jsonb)
         FROM public.colorways c
         WHERE c.order_id = $1 AND c.factory_id = $2'
      INTO v_colorways
      USING p_order_id, v_factory;
    EXCEPTION WHEN OTHERS THEN
      v_colorways := NULL;
    END;
  END IF;

  IF v_colorways IS NULL THEN
    SELECT COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'color_code', c.color_code,
        'fabrics', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'type', t.name, 'fabric_category', '',
            'fabric_type_id', t.id
          ) ORDER BY t.seq, t.name)
          FROM public.mm_fabric_types t
          WHERE t.factory_id = v_factory AND t.is_active
        ), '[]'::jsonb)
      ) ORDER BY c.name)
      FROM public.colorways c
      WHERE c.order_id = p_order_id AND c.factory_id = v_factory
    ), '[]'::jsonb) INTO v_colorways;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('colorways', v_colorways));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_mill_board(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_orders jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_ids IS NULL OR COALESCE(array_length(p_order_ids, 1), 0) = 0 THEN
    RETURN public._mm_ok(jsonb_build_object('orders', '[]'::jsonb));
  END IF;

  v_orders := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(ord.obj ORDER BY ord.style_name), '[]'::jsonb) INTO v_orders
      FROM (
        SELECT
          cells.order_id,
          max(o.style_name) AS style_name,
          jsonb_build_object(
            'order_id', cells.order_id,
            'fabrics', COALESCE(jsonb_agg(jsonb_build_object(
              'colorway_id', cells.colorway_id,
              'color_name', cells.color_name,
              'fabric_line_id', cells.fabric_line_id,
              'fabric_type_id', cells.fabric_type_id,
              'fabric_name', cells.fabric_name,
              'fabric_type', cells.fabric_type,
              'required_m', cells.required_m,
              'style_material_id', cells.style_material_id,
              'rolls_at_mill', cells.rolls_at_mill,
              'qty_at_mill_m', cells.qty_at_mill_m,
              'rolls_dispatched', cells.rolls_dispatched,
              'qty_dispatched_m', cells.qty_dispatched_m,
              'status', public._mm_mill_cell_status(cells.rolls_at_mill, cells.rolls_dispatched)
            ) ORDER BY cells.color_name, cells.fabric_name), '[]'::jsonb)
          ) AS obj
        FROM (
          SELECT
            o.id AS order_id,
            c.id AS colorway_id,
            c.name AS color_name,
            cm.id AS fabric_line_id,
            ft.id AS fabric_type_id,
            COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_name,
            COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
            cm.total_cons AS required_m,
            sm.id AS style_material_id,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.status = 'draft' AND u.in_challan_id IS NULL
            ), 0) AS rolls_at_mill,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.status = 'draft' AND u.in_challan_id IS NULL
            ), 0) AS qty_at_mill_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.in_challan_id IS NOT NULL
            ), 0) AS rolls_dispatched,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.in_challan_id IS NOT NULL
            ), 0) AS qty_dispatched_m
          FROM public.style_orders o
          JOIN public.colorways c
            ON c.order_id = o.id AND c.factory_id = v_factory
          JOIN public.colorway_materials cm
            ON cm.colorway_id = c.id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
          LEFT JOIN public.mm_fabric_types ft
            ON ft.factory_id = v_factory AND ft.is_active
           AND lower(ft.name) = lower(NULLIF(trim(cm.type), ''))
          LEFT JOIN public.mm_style_materials sm
            ON sm.factory_id = v_factory
           AND sm.order_id = o.id
           AND sm.colorway_id = c.id
           AND (
             sm.colorway_material_id = cm.id
             OR (sm.colorway_material_id IS NULL AND sm.fabric_type_id IS NOT DISTINCT FROM ft.id)
           )
          WHERE o.factory_id = v_factory AND o.id = ANY (p_order_ids)
        ) cells
        JOIN public.style_orders o ON o.id = cells.order_id
        GROUP BY cells.order_id
      ) ord;
    EXCEPTION WHEN OTHERS THEN
      v_orders := NULL;
    END;
  END IF;

  IF v_orders IS NULL THEN
    SELECT COALESCE(jsonb_agg(ord.obj ORDER BY ord.style_name), '[]'::jsonb) INTO v_orders
    FROM (
      SELECT
        cells.order_id,
        max(o.style_name) AS style_name,
        jsonb_build_object(
          'order_id', cells.order_id,
          'fabrics', COALESCE(jsonb_agg(jsonb_build_object(
            'colorway_id', cells.colorway_id,
            'color_name', cells.color_name,
            'fabric_line_id', cells.fabric_line_id,
            'fabric_type_id', cells.fabric_type_id,
            'fabric_name', cells.fabric_name,
            'fabric_type', cells.fabric_type,
            'required_m', cells.required_m,
            'style_material_id', cells.style_material_id,
            'rolls_at_mill', cells.rolls_at_mill,
            'qty_at_mill_m', cells.qty_at_mill_m,
            'rolls_dispatched', cells.rolls_dispatched,
            'qty_dispatched_m', cells.qty_dispatched_m,
            'status', public._mm_mill_cell_status(cells.rolls_at_mill, cells.rolls_dispatched)
          ) ORDER BY cells.color_name, cells.fabric_name), '[]'::jsonb)
        ) AS obj
      FROM (
        SELECT
          o.id AS order_id,
          c.id AS colorway_id,
          c.name AS color_name,
          t.id AS fabric_line_id,
          t.id AS fabric_type_id,
          t.name AS fabric_name,
          t.name AS fabric_type,
          NULL::numeric AS required_m,
          sm.id AS style_material_id,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.status = 'draft' AND u.in_challan_id IS NULL
          ), 0) AS rolls_at_mill,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.status = 'draft' AND u.in_challan_id IS NULL
          ), 0) AS qty_at_mill_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.in_challan_id IS NOT NULL
          ), 0) AS rolls_dispatched,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.in_challan_id IS NOT NULL
          ), 0) AS qty_dispatched_m
        FROM public.style_orders o
        JOIN public.colorways c ON c.order_id = o.id AND c.factory_id = v_factory
        JOIN public.mm_fabric_types t ON t.factory_id = v_factory AND t.is_active
        LEFT JOIN public.mm_style_materials sm
          ON sm.factory_id = v_factory AND sm.order_id = o.id
         AND sm.colorway_id = c.id AND sm.fabric_type_id = t.id
        WHERE o.factory_id = v_factory AND o.id = ANY (p_order_ids)
      ) cells
      JOIN public.style_orders o ON o.id = cells.order_id
      GROUP BY cells.order_id
    ) ord;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('orders', COALESCE(v_orders, '[]'::jsonb)));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_mill_line(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_type_id uuid;
  v_type_name text;
  v_fabric_name text;
  v_required numeric;
  v_sm uuid;
  v_mill uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.colorways c
    WHERE c.id = p_colorway_id AND c.order_id = p_order_id AND c.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Colorway not found');
  END IF;

  v_fabric_name := NULL;
  v_required := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
                cm.total_cons, NULLIF(trim(cm.type), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4
           AND cm.kind = ''Fabric'''
      INTO v_fabric_name, v_required, v_type_name
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_name := NULL;
    END;
  END IF;

  IF v_fabric_name IS NULL THEN
    SELECT name INTO v_type_name FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_name IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Fabric line not found'); END IF;
    v_fabric_name := v_type_name;
    v_type_id := p_colorway_material_id;
  ELSE
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
  END IF;

  SELECT sm.id INTO v_sm
  FROM public.mm_style_materials sm
  WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND sm.colorway_id = p_colorway_id
    AND (
      sm.colorway_material_id = p_colorway_material_id
      OR (v_type_id IS NOT NULL AND sm.fabric_type_id = v_type_id)
    )
  LIMIT 1;

  v_mill := public._mm_loc(v_factory, 'MILL');

  RETURN public._mm_ok(jsonb_build_object(
    'order_id', p_order_id,
    'colorway_id', p_colorway_id,
    'fabric_line_id', p_colorway_material_id,
    'fabric_type_id', v_type_id,
    'style_material_id', v_sm,
    'required_m', v_required,
    'style_name', (SELECT style_name FROM public.style_orders WHERE id = p_order_id),
    'po_number', (SELECT po_number FROM public.style_orders WHERE id = p_order_id),
    'buyer_name', (SELECT buyer_name FROM public.style_orders WHERE id = p_order_id),
    'image_url', (SELECT image_url FROM public.style_orders WHERE id = p_order_id),
    'color_name', (SELECT name FROM public.colorways WHERE id = p_colorway_id),
    'fabric_name', v_fabric_name,
    'fabric_type', COALESCE((SELECT name FROM public.mm_fabric_types WHERE id = v_type_id), v_type_name, v_fabric_name),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type_id AND f.is_active
    ), '[]'::jsonb),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'production_date', b.production_date,
        'remarks', b.remarks,
        'roll_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.mill_batch_id = b.id AND u.status = 'draft' AND u.in_challan_id IS NULL
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.mill_batch_id = b.id AND u.in_challan_id IS NOT NULL
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      WHERE b.factory_id = v_factory AND b.style_material_id = v_sm
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'mill_batch_id', u.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', u.length_m,
        'weight_kg', u.weight_kg,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'attributes', u.attributes,
        'status', u.status,
        'in_challan_id', u.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'at_mill', (u.status = 'draft' AND u.in_challan_id IS NULL)
      ) ORDER BY b.production_date DESC NULLS LAST, u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.style_material_id = v_sm AND u.source = 'mill'
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_insert_mill_batch_rolls(
  p_factory uuid, p_sm uuid, p_batch uuid, p_loc uuid, p_rolls jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_attrs jsonb;
  v_n integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    v_code := public.next_doc_no('ROLL');
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, mill_batch_id, source,
      uom, length_m, weight_kg, shade, lot_no, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, p_batch, 'mill', 'm',
      v_len, v_wt, v_shade, v_lot, v_attrs, NULL, 'draft', p_loc, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    PERFORM public._mm_ledger(
      p_factory, v_id, 'INHOUSE_IN', v_len, NULL, 'draft', NULL, p_loc,
      'mm_mill_batches', p_batch, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_mill_batch(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid,
  p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, v_sm_id, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), auth.uid(), auth.uid()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, v_sm_id, v_batch, v_mill, p_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_dispatch_mill_rolls(p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm uuid;
  v_ch uuid;
  v_no text;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
  v_batch public.mm_mill_batches%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to dispatch');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.source <> 'mill' OR v_unit.status <> 'draft' OR v_unit.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;
    IF v_sm IS NULL THEN v_sm := v_unit.style_material_id; END IF;
    IF v_unit.style_material_id IS DISTINCT FROM v_sm THEN
      RETURN public._mm_err('INVALID', 'Select rolls from the same style, color, and fabric');
    END IF;
  END LOOP;

  v_no := public.next_doc_no('MILL');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, status, sent_at, sent_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'mill', v_sm, 'pending', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_ch;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_uid;
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = v_unit.mill_batch_id;
    UPDATE public.mm_stock_units SET
      status = 'in_transit',
      in_challan_id = v_ch,
      mill_snapshot = jsonb_build_object(
        'length_m', length_m,
        'weight_kg', weight_kg,
        'shade', shade,
        'lot_no', lot_no,
        'attributes', attributes,
        'mill_batch_id', mill_batch_id,
        'batch_no', v_batch.batch_no,
        'mill_ref', v_batch.mill_ref,
        'production_date', v_batch.production_date
      ),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_uid;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_ch, v_uid, auth.uid());
    PERFORM public._mm_ledger(
      v_factory, v_uid, 'TRANSFER', v_unit.length_m, 'draft', 'in_transit',
      v_unit.current_location_id, v_unit.current_location_id, 'mm_in_challans', v_ch, 'Mill dispatch'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_edit jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'mill' THEN RETURN public._mm_err('INVALID', 'Not a mill challan'); END IF;
  IF v_ch.status = 'received' THEN RETURN public._mm_err('ALREADY', 'Already received'); END IF;
  IF v_ch.row_version IS DISTINCT FROM COALESCE(p_row_version, v_ch.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  FOR v_edit IN SELECT * FROM jsonb_array_elements(COALESCE(p_roll_edits, '[]'::jsonb))
  LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = (v_edit->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.mm_stock_units SET
      length_m = COALESCE(NULLIF(v_edit->>'length_m', '')::numeric, length_m),
      weight_kg = COALESCE(NULLIF(v_edit->>'weight_kg', '')::numeric, weight_kg),
      shade = COALESCE(NULLIF(trim(v_edit->>'shade'), ''), shade),
      lot_no = COALESCE(NULLIF(trim(v_edit->>'lot_no'), ''), lot_no),
      attributes = CASE WHEN jsonb_typeof(v_edit->'attributes') = 'object' THEN v_edit->'attributes' ELSE attributes END,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
  END LOOP;
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
  LOOP
    UPDATE public.mm_stock_units SET
      status = 'in_stock', current_location_id = v_recv,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, 'in_stock',
      v_unit.current_location_id, v_recv, 'mm_in_challans', v_ch.id, 'Warehouse receive'
    );
  END LOOP;
  UPDATE public.mm_in_challans SET
    status = 'received', received_at = now(), received_by = auth.uid(),
    row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_ch.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', 'received'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_in_challan(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid,
  p_supplier_name text, p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ch uuid;
  v_no text;
  v_n integer;
  v_recv uuid;
  v_sup text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_sup := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
  IF v_sup IS NULL THEN RETURN public._mm_err('REQUIRED', 'Supplier name is required'); END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  v_no := public.next_doc_no('GRN');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, supplier_name, status,
    received_at, received_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'vendor', v_sm_id, v_sup, 'received', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, v_sm_id, v_ch, 'vendor', 'pending_qc', v_recv, p_rolls, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_roll_tests(p_id uuid, p_roll_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_row jsonb;
  v_pass boolean;
  v_status text;
  v_qc text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'vendor' THEN RETURN public._mm_err('INVALID', 'Not a vendor challan'); END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_roll_results, '[]'::jsonb))
  LOOP
    v_pass := COALESCE((v_row->>'pass')::boolean, false);
    v_qc := CASE WHEN v_row->>'pass' IS NULL THEN NULL WHEN v_pass THEN 'pass' ELSE 'fail' END;
    v_status := CASE WHEN v_qc IS NULL THEN 'pending_qc' WHEN v_pass THEN 'in_stock' ELSE 'rejected' END;
    UPDATE public.mm_stock_units SET
      length_m = COALESCE(NULLIF(v_row->>'length_m', '')::numeric, length_m),
      weight_kg = COALESCE(NULLIF(v_row->>'weight_kg', '')::numeric, weight_kg),
      shade = COALESCE(NULLIF(trim(v_row->>'shade'), ''), shade),
      lot_no = COALESCE(NULLIF(trim(v_row->>'lot_no'), ''), lot_no),
      attributes = CASE WHEN jsonb_typeof(v_row->'attributes') = 'object' THEN v_row->'attributes' ELSE attributes END,
      qc_result = v_qc,
      status = v_status,
      current_location_id = v_recv,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id));
END;
$fn$;

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
        AND NOT public._mm_is_pickable_loc(u.current_location_id)
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
               AND NOT public._mm_is_pickable_loc(u.current_location_id)
            )::text || ' rolls waiting for rack putaway',
            'ts', now()
          ) AS x, now() AS ts
          WHERE EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
              AND NOT public._mm_is_pickable_loc(u.current_location_id)
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

CREATE OR REPLACE FUNCTION public.mm_list_store_stock(p_style_material_id uuid)
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
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'style_material_id', sm.id,
        'style_name', o.style_name,
        'color_name', cw.name,
        'fabric_type', ft.name,
        'rolls', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND u.store_challan_id IS NULL
            AND public._mm_is_pickable_loc(u.current_location_id)
        )
      ) ORDER BY o.style_name, cw.name)
      FROM public.mm_style_materials sm
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      WHERE sm.factory_id = v_factory
        AND (p_style_material_id IS NULL OR sm.id = p_style_material_id)
        AND EXISTS (
          SELECT 1 FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND u.store_challan_id IS NULL
            AND public._mm_is_pickable_loc(u.current_location_id)
        )
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (p_style_material_id IS NULL OR u.style_material_id = p_style_material_id)
    ), '[]'::jsonb)
  ));
END;
$fn$;

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
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, auth.uid());
    UPDATE public.mm_stock_units SET
      store_challan_id = v_id, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_uid;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_warehouse_locations()
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
    'warehouse_id', v_wh,
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id,
        'parent_id', loc.parent_id,
        'code', loc.code,
        'name', loc.name,
        'location_type', loc.location_type,
        'is_pickable', loc.is_pickable,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.location_type, loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND (loc.id = v_wh OR public._mm_loc_is_under(loc.id, v_wh))
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_warehouse_location(p_row jsonb)
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
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
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
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Name is required'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Location must be a zone, rack, or bin');
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
      factory_id, parent_id, code, name, location_type, is_pickable, is_active, created_by, updated_by
    ) VALUES (
      v_factory, v_parent, v_code, v_name, v_type, v_pick, true, auth.uid(), auth.uid()
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
      is_pickable = v_pick, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_id;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'code', v_code));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE', 'That location code already exists');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_deactivate_warehouse_location(p_id uuid)
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
    v_factory := public._mm_require_ops('mm_inventory');
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
    RETURN public._mm_err('IN_USE', 'Move or putaway rolls before removing this location');
  END IF;
  UPDATE public.mm_locations SET is_active = false, updated_at = now(), updated_by = auth.uid()
  WHERE factory_id = v_factory AND (
    id = v_loc.id OR public._mm_loc_is_under(id, v_loc.id)
  ) AND location_type IN ('zone', 'rack', 'bin');
  RETURN public._mm_ok(jsonb_build_object('id', v_loc.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_putaway_queue()
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
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin')
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'length_m', u.length_m,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'source', u.source,
        'style_name', o.style_name,
        'color_name', cw.name,
        'fabric_type', ft.name,
        'location_code', loc.code,
        'location_name', loc.name
      ) ORDER BY o.style_name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND NOT public._mm_is_pickable_loc(u.current_location_id)
    ), '[]'::jsonb)
  ));
END;
$fn$;

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
    RETURN public._mm_err('REQUIRED', 'Select rolls and a rack or bin');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_location_id AND factory_id = v_factory AND is_active;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('rack', 'bin') OR NOT v_loc.is_pickable THEN
    RETURN public._mm_err('INVALID', 'Putaway target must be a rack or bin');
  END IF;
  IF NOT public._mm_loc_is_under(v_loc.id, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Putaway target must be in the warehouse');
  END IF;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.status <> 'in_stock' OR v_unit.store_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not available for putaway');
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
      v_unit.current_location_id, v_loc.id, 'mm_locations', v_loc.id, 'Putaway'
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'location_id', v_loc.id));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_loc_is_under(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_recv_loc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_is_pickable_loc(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_mill_cell_status(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_insert_mill_batch_rolls(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mm_get_mill_board(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_mill_batch(uuid, uuid, uuid, text, text, date, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_dispatch_mill_rolls(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_warehouse_locations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_location(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_deactivate_warehouse_location(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_putaway_queue() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_putaway_rolls(uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_in_challan(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_roll_tests(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dashboard() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_store_stock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(uuid, uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
