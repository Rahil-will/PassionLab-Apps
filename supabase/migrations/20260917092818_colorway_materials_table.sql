-- Replace colorways.materials jsonb with a real colorway_materials table.
CREATE TABLE IF NOT EXISTS public.colorway_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.style_orders (id) ON DELETE CASCADE,
  colorway_id uuid NOT NULL REFERENCES public.colorways (id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 0,
  category text NOT NULL CHECK (category = ANY (ARRAY['Fabric'::text, 'Trim'::text])),
  name text NOT NULL DEFAULT '',
  placement text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  trim_type text NOT NULL DEFAULT '',
  trim_category text NOT NULL DEFAULT '',
  fabric_category text NOT NULL DEFAULT '',
  composition text,
  unit text NOT NULL DEFAULT '',
  avg_cons numeric,
  per_pc numeric,
  wastage numeric,
  req_qty numeric,
  rcvd_qty numeric,
  balance_qty numeric,
  total_rolls integer,
  status text,
  supplier text,
  supplier_ref text,
  color_code text,
  remarks text,
  param_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS colorway_materials_colorway_idx
  ON public.colorway_materials (colorway_id, seq);
CREATE INDEX IF NOT EXISTS colorway_materials_order_idx
  ON public.colorway_materials (order_id);
CREATE INDEX IF NOT EXISTS colorway_materials_factory_idx
  ON public.colorway_materials (factory_id);

COMMENT ON TABLE public.colorway_materials IS
  'Per-color fabric/trim requirement lines for a style order. One row per material line.';
COMMENT ON COLUMN public.colorway_materials.placement IS
  'Where the trim sits on the garment. Empty on fabric lines.';

ALTER TABLE public.colorway_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS colorway_materials_select ON public.colorway_materials;
CREATE POLICY colorway_materials_select ON public.colorway_materials
  FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

DROP POLICY IF EXISTS colorway_materials_insert ON public.colorway_materials;
CREATE POLICY colorway_materials_insert ON public.colorway_materials
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS colorway_materials_update ON public.colorway_materials;
CREATE POLICY colorway_materials_update ON public.colorway_materials
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS colorway_materials_delete ON public.colorway_materials;
CREATE POLICY colorway_materials_delete ON public.colorway_materials
  FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colorway_materials TO authenticated;

DO $trg$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS colorway_materials_updated_at ON public.colorway_materials;
    CREATE TRIGGER colorway_materials_updated_at
      BEFORE UPDATE ON public.colorway_materials
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$trg$;

DO $migrate$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'colorways' AND column_name = 'materials'
  ) THEN
    EXECUTE $sql$
      INSERT INTO public.colorway_materials (
        id, factory_id, order_id, colorway_id, seq, category, name, placement, type,
        trim_type, trim_category, fabric_category, composition, unit,
        avg_cons, per_pc, wastage, req_qty, rcvd_qty, balance_qty, total_rolls,
        status, supplier, supplier_ref, color_code, remarks, param_values
      )
      SELECT
        CASE
          WHEN (elem->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (elem->>'id')::uuid
          ELSE gen_random_uuid()
        END,
        cw.factory_id,
        cw.order_id,
        cw.id,
        x.ord::integer,
        CASE WHEN elem->>'category' = 'Trim' THEN 'Trim' ELSE 'Fabric' END,
        COALESCE(elem->>'name', ''),
        COALESCE(elem->>'placement', ''),
        COALESCE(elem->>'type', ''),
        COALESCE(elem->>'trimType', ''),
        COALESCE(elem->>'trimCategory', ''),
        COALESCE(elem->>'fabricCategory', ''),
        NULLIF(elem->>'composition', ''),
        COALESCE(NULLIF(elem->>'unit', ''), CASE WHEN elem->>'category' = 'Trim' THEN 'pc' ELSE 'mtr' END),
        CASE WHEN (elem->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'avgCons')::numeric ELSE NULL END,
        CASE WHEN (elem->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'perPc')::numeric ELSE NULL END,
        CASE WHEN (elem->>'wastage') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'wastage')::numeric ELSE NULL END,
        CASE WHEN (elem->>'reqQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'reqQty')::numeric ELSE NULL END,
        CASE WHEN (elem->>'rcvdQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'rcvdQty')::numeric ELSE NULL END,
        CASE WHEN (elem->>'balanceQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'balanceQty')::numeric ELSE NULL END,
        CASE WHEN (elem->>'totalRolls') ~ '^-?[0-9]+$' THEN (elem->>'totalRolls')::integer ELSE NULL END,
        NULLIF(elem->>'status', ''),
        NULLIF(elem->>'supplier', ''),
        NULLIF(elem->>'supplierRef', ''),
        NULLIF(elem->>'colorCode', ''),
        NULLIF(elem->>'remarks', ''),
        CASE
          WHEN jsonb_typeof(elem->'paramValues') = 'object' THEN elem->'paramValues'
          ELSE '{}'::jsonb
        END
      FROM public.colorways cw
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cw.materials, '[]'::jsonb)) WITH ORDINALITY AS x(elem, ord)
      WHERE jsonb_typeof(COALESCE(cw.materials, '[]'::jsonb)) = 'array'
        AND cw.materials <> '[]'::jsonb
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END;
$migrate$;

CREATE OR REPLACE FUNCTION public._upsert_colorway_material(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid,
  p_mat jsonb,
  p_seq integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_cat text;
BEGIN
  BEGIN
    v_id := NULLIF(trim(p_mat->>'id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;
  IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

  IF EXISTS (
    SELECT 1 FROM public.colorway_materials
    WHERE id = v_id
      AND (factory_id IS DISTINCT FROM p_factory_id OR order_id IS DISTINCT FROM p_order_id)
  ) THEN
    v_id := gen_random_uuid();
  END IF;

  v_cat := CASE WHEN trim(COALESCE(p_mat->>'category', '')) = 'Trim' THEN 'Trim' ELSE 'Fabric' END;

  INSERT INTO public.colorway_materials (
    id, factory_id, order_id, colorway_id, seq, category, name, placement, type,
    trim_type, trim_category, fabric_category, composition, unit,
    avg_cons, per_pc, wastage, req_qty, rcvd_qty, balance_qty, total_rolls,
    status, supplier, supplier_ref, color_code, remarks, param_values, updated_at
  ) VALUES (
    v_id, p_factory_id, p_order_id, p_colorway_id, COALESCE(p_seq, 0), v_cat,
    COALESCE(p_mat->>'name', ''),
    COALESCE(p_mat->>'placement', ''),
    COALESCE(p_mat->>'type', ''),
    COALESCE(p_mat->>'trimType', ''),
    COALESCE(p_mat->>'trimCategory', ''),
    COALESCE(p_mat->>'fabricCategory', ''),
    NULLIF(p_mat->>'composition', ''),
    COALESCE(NULLIF(p_mat->>'unit', ''), CASE WHEN v_cat = 'Trim' THEN 'pc' ELSE 'mtr' END),
    CASE WHEN (p_mat->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'avgCons')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'perPc')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'wastage') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'wastage')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'reqQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'reqQty')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'rcvdQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'rcvdQty')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'balanceQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'balanceQty')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'totalRolls') ~ '^-?[0-9]+$' THEN (p_mat->>'totalRolls')::integer ELSE NULL END,
    NULLIF(p_mat->>'status', ''),
    NULLIF(p_mat->>'supplier', ''),
    NULLIF(p_mat->>'supplierRef', ''),
    NULLIF(p_mat->>'colorCode', ''),
    NULLIF(p_mat->>'remarks', ''),
    CASE
      WHEN jsonb_typeof(p_mat->'paramValues') = 'object' THEN p_mat->'paramValues'
      ELSE '{}'::jsonb
    END,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    factory_id = EXCLUDED.factory_id,
    order_id = EXCLUDED.order_id,
    colorway_id = EXCLUDED.colorway_id,
    seq = EXCLUDED.seq,
    category = EXCLUDED.category,
    name = EXCLUDED.name,
    placement = EXCLUDED.placement,
    type = EXCLUDED.type,
    trim_type = EXCLUDED.trim_type,
    trim_category = EXCLUDED.trim_category,
    fabric_category = EXCLUDED.fabric_category,
    composition = EXCLUDED.composition,
    unit = EXCLUDED.unit,
    avg_cons = EXCLUDED.avg_cons,
    per_pc = EXCLUDED.per_pc,
    wastage = EXCLUDED.wastage,
    req_qty = EXCLUDED.req_qty,
    rcvd_qty = EXCLUDED.rcvd_qty,
    balance_qty = EXCLUDED.balance_qty,
    total_rolls = EXCLUDED.total_rolls,
    status = EXCLUDED.status,
    supplier = EXCLUDED.supplier,
    supplier_ref = EXCLUDED.supplier_ref,
    color_code = EXCLUDED.color_code,
    remarks = EXCLUDED.remarks,
    param_values = EXCLUDED.param_values,
    updated_at = now();

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._upsert_colorway_material(uuid, uuid, uuid, jsonb, integer) FROM PUBLIC;;
