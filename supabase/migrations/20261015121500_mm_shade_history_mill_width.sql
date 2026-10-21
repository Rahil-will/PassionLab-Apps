-- Mill width is a column, separate from warehouse declared_width_in / inspection cuttable_width.
-- Shade changes on the mill roll and on the warehouse unit are kept as history.

ALTER TABLE public.mm_mill_rolls
  ADD COLUMN IF NOT EXISTS width_in numeric;

COMMENT ON COLUMN public.mm_mill_rolls.width_in IS 'Mill measured width in inches. Warehouse width stays on mm_stock_units.declared_width_in and mm_warehouse_inspections.cuttable_width.';

CREATE TABLE IF NOT EXISTS public.mm_shade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL,
  mill_roll_id uuid REFERENCES public.mm_mill_rolls(id) ON DELETE CASCADE,
  stock_unit_id uuid REFERENCES public.mm_stock_units(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('mill', 'warehouse')),
  shade_field text NOT NULL CHECK (shade_field IN ('shade', 'tested_shade')),
  old_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

CREATE INDEX IF NOT EXISTS mm_shade_history_mill_idx
  ON public.mm_shade_history (mill_roll_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS mm_shade_history_stock_idx
  ON public.mm_shade_history (stock_unit_id, changed_at DESC);

ALTER TABLE public.mm_shade_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mm_shade_history_select ON public.mm_shade_history;
CREATE POLICY mm_shade_history_select ON public.mm_shade_history
  FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

GRANT SELECT ON public.mm_shade_history TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mm_log_shade_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'mm_mill_rolls' THEN
    IF NEW.shade IS DISTINCT FROM OLD.shade THEN
      INSERT INTO public.mm_shade_history (
        factory_id, mill_roll_id, side, shade_field, old_value, new_value, changed_by
      ) VALUES (
        NEW.factory_id, NEW.id, 'mill', 'shade', OLD.shade, NEW.shade, public._mm_actor_id()
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'mm_stock_units' THEN
    IF NEW.shade IS DISTINCT FROM OLD.shade THEN
      INSERT INTO public.mm_shade_history (
        factory_id, stock_unit_id, side, shade_field, old_value, new_value, changed_by
      ) VALUES (
        NEW.factory_id, NEW.id, 'warehouse', 'shade', OLD.shade, NEW.shade, public._mm_actor_id()
      );
    END IF;
    IF NEW.tested_shade IS DISTINCT FROM OLD.tested_shade THEN
      INSERT INTO public.mm_shade_history (
        factory_id, stock_unit_id, side, shade_field, old_value, new_value, changed_by
      ) VALUES (
        NEW.factory_id, NEW.id, 'warehouse', 'tested_shade', OLD.tested_shade, NEW.tested_shade, public._mm_actor_id()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_mill_rolls_shade_history ON public.mm_mill_rolls;
CREATE TRIGGER mm_mill_rolls_shade_history
  AFTER UPDATE OF shade ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_log_shade_change();

DROP TRIGGER IF EXISTS mm_stock_units_shade_history ON public.mm_stock_units;
CREATE TRIGGER mm_stock_units_shade_history
  AFTER UPDATE OF shade, tested_shade ON public.mm_stock_units
  FOR EACH ROW EXECUTE FUNCTION public._mm_log_shade_change();

CREATE OR REPLACE FUNCTION public._mm_sync_mill_width()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE v_width numeric;
BEGIN
  BEGIN
    v_width := NULLIF(btrim(COALESCE(NEW.attributes->>'actual_width_in', '')), '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_width := NULL;
  END;
  IF v_width IS NULL THEN
    BEGIN
      v_width := NULLIF(btrim(COALESCE(NEW.attributes->>'width', '')), '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_width := NULL;
    END;
  END IF;
  IF v_width IS NOT NULL THEN
    NEW.width_in := v_width;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_mill_rolls_sync_width ON public.mm_mill_rolls;
CREATE TRIGGER mm_mill_rolls_sync_width
  BEFORE INSERT OR UPDATE OF attributes ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_sync_mill_width();

UPDATE public.mm_mill_rolls
SET attributes = attributes
WHERE width_in IS NULL
  AND attributes IS NOT NULL
  AND (attributes ? 'actual_width_in' OR attributes ? 'width');

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
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND public._mm_is_on_hand(u.status, loc.location_type)
        )
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin') AND loc.is_pickable
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'unassigned_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg, 'uom', u.uom,
        'shade', u.shade, 'tested_shade', u.tested_shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY COALESCE(o.style_name, 'Unallocated'), cw.name, ch.challan_no NULLS LAST, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ), '[]'::jsonb),
    'racked_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg, 'uom', u.uom,
        'shade', u.shade, 'tested_shade', u.tested_shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY loc.code, COALESCE(o.style_name, 'Unallocated'), cw.name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb),
    'red_label_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg, 'uom', u.uom,
        'shade', u.shade, 'tested_shade', u.tested_shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (u.status = 'rejected' OR loc.location_type = 'rejected')
    ), '[]'::jsonb)
  ));
END;
$fn$;
