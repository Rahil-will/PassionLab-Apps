-- Mill stock is one style_material per colorway fabric line, not per fabric type.
-- Same type on the same color (e.g. two Knit fabrics) must not share mill rolls.

ALTER TABLE public.mm_style_materials
  DROP CONSTRAINT IF EXISTS mm_style_materials_line_uidx;
DROP INDEX IF EXISTS public.mm_style_materials_line_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mm_style_materials_fabric_line_uidx
  ON public.mm_style_materials (factory_id, colorway_material_id)
  WHERE colorway_material_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mm_style_materials_legacy_type_uidx
  ON public.mm_style_materials (factory_id, order_id, colorway_id, fabric_type_id)
  WHERE colorway_material_id IS NULL;

COMMENT ON INDEX public.mm_style_materials_fabric_line_uidx IS
  'One mill/warehouse stock row per order color fabric. Fabric type may repeat.';
COMMENT ON INDEX public.mm_style_materials_legacy_type_uidx IS
  'Legacy mill rows with no colorway material stay unique by fabric type.';

CREATE OR REPLACE FUNCTION public._mm_lookup_style_material_id(
  p_factory uuid,
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid,
  p_type_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT sm.id
  FROM public.mm_style_materials sm
  WHERE sm.factory_id = p_factory
    AND sm.order_id = p_order_id
    AND sm.colorway_id = p_colorway_id
    AND (
      (p_colorway_material_id IS NOT NULL AND sm.colorway_material_id = p_colorway_material_id)
      OR (
        sm.colorway_material_id IS NULL
        AND p_type_id IS NOT NULL
        AND sm.fabric_type_id = p_type_id
      )
    )
  ORDER BY (sm.colorway_material_id IS NOT NULL) DESC
  LIMIT 1
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

  IF v_bom IS NOT NULL THEN
    INSERT INTO public.mm_style_materials (
      factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
    ) VALUES (
      v_factory, p_order_id, p_colorway_id, v_bom, v_type_id, auth.uid(), auth.uid()
    )
    ON CONFLICT (factory_id, colorway_material_id) WHERE colorway_material_id IS NOT NULL
    DO UPDATE SET
      fabric_type_id = EXCLUDED.fabric_type_id,
      colorway_id = EXCLUDED.colorway_id,
      order_id = EXCLUDED.order_id,
      updated_at = now(),
      updated_by = auth.uid()
    RETURNING * INTO v_out;
  ELSE
    INSERT INTO public.mm_style_materials (
      factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
    ) VALUES (
      v_factory, p_order_id, p_colorway_id, NULL, v_type_id, auth.uid(), auth.uid()
    )
    ON CONFLICT (factory_id, order_id, colorway_id, fabric_type_id) WHERE colorway_material_id IS NULL
    DO UPDATE SET
      updated_at = now(),
      updated_by = auth.uid()
    RETURNING * INTO v_out;
  END IF;
  RETURN public._mm_ok(to_jsonb(v_out));
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
  v_fabric_category text;
  v_required numeric;
  v_uom text;
  v_sm uuid;
  v_mill uuid;
  v_short_closed boolean := false;
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
  v_uom := NULL;
  v_fabric_category := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
                cm.total_cons, NULLIF(trim(cm.type), ''''), NULLIF(trim(cm.unit), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_fabric_name, v_required, v_type_name, v_uom
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_name := NULL;
    END;

    BEGIN
      SELECT CASE
        WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
          THEN NULLIF(trim(cm.extras->>$$fabricCategory$$), '')
        ELSE COALESCE(
          NULLIF(trim(cm.category), ''),
          NULLIF(trim(cm.extras->>$$fabricCategory$$), '')
        )
      END
      INTO v_fabric_category
      FROM public.colorway_materials cm
      WHERE cm.id = p_colorway_material_id
        AND cm.factory_id = v_factory
        AND cm.order_id = p_order_id
        AND cm.colorway_id = p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_category := NULL;
    END;

    BEGIN
      EXECUTE
        'SELECT COALESCE(cm.mill_short_closed, false)
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_short_closed
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_short_closed := false;
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

  v_sm := public._mm_lookup_style_material_id(
    v_factory, p_order_id, p_colorway_id, p_colorway_material_id, v_type_id
  );

  IF NULLIF(trim(COALESCE(v_uom, '')), '') IS NULL AND v_sm IS NOT NULL THEN
    SELECT NULLIF(trim(u.uom), '') INTO v_uom
    FROM public.mm_stock_units u
    WHERE u.style_material_id = v_sm
    ORDER BY u.created_at
    LIMIT 1;
  END IF;

  v_mill := public._mm_loc(v_factory, 'MILL');

  RETURN public._mm_ok(jsonb_build_object(
    'order_id', p_order_id,
    'colorway_id', p_colorway_id,
    'fabric_line_id', p_colorway_material_id,
    'fabric_type_id', v_type_id,
    'style_material_id', v_sm,
    'required_m', v_required,
    'mill_short_closed', COALESCE(v_short_closed, false),
    'uom', v_uom,
    'style_name', (SELECT style_name FROM public.style_orders WHERE id = p_order_id),
    'style_ref', (SELECT style_ref FROM public.style_orders WHERE id = p_order_id),
    'po_number', (SELECT po_number FROM public.style_orders WHERE id = p_order_id),
    'buyer_name', (SELECT buyer_name FROM public.style_orders WHERE id = p_order_id),
    'image_url', (SELECT image_url FROM public.style_orders WHERE id = p_order_id),
    'color_name', (SELECT name FROM public.colorways WHERE id = p_colorway_id),
    'fabric_name', v_fabric_name,
    'fabric_type', COALESCE((SELECT name FROM public.mm_fabric_types WHERE id = v_type_id), v_type_name, v_fabric_name),
    'fabric_category', v_fabric_category,
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
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'dispatched'
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      WHERE b.factory_id = v_factory AND b.style_material_id = v_sm
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'unit_code', r.unit_code,
        'mill_batch_id', r.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', r.length_m,
        'weight_kg', r.weight_kg,
        'shade', r.shade,
        'lot_no', r.lot_no,
        'attributes', r.attributes,
        'status', r.status,
        'in_challan_id', r.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL)
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      LEFT JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id = v_sm
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_lookup_style_material_id(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_resolve_style_material(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_resolve_style_material(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
