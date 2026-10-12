-- Slim colorway_materials: fixed columns + extras jsonb.
-- Fixed: seq (s.no), name, category, type, cons_per_pc, total_cons.
-- Parent ids always taken from colorways (colorway_id FK).

ALTER TABLE public.colorway_materials
  ADD COLUMN IF NOT EXISTS cons_per_pc numeric,
  ADD COLUMN IF NOT EXISTS total_cons numeric,
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'colorway_materials' AND column_name = 'placement'
  ) THEN
    EXECUTE $sql$
      UPDATE public.colorway_materials SET
        type = CASE
          WHEN category = 'Trim' AND COALESCE(NULLIF(type, ''), '') = '' THEN COALESCE(trim_type, '')
          ELSE type
        END,
        cons_per_pc = CASE
          WHEN category = 'Trim' THEN per_pc
          ELSE avg_cons
        END,
        total_cons = req_qty,
        extras = jsonb_strip_nulls(jsonb_build_object(
          'placement', NULLIF(placement, ''),
          'trimType', NULLIF(trim_type, ''),
          'trimCategory', NULLIF(trim_category, ''),
          'fabricCategory', NULLIF(fabric_category, ''),
          'composition', composition,
          'unit', NULLIF(unit, ''),
          'wastage', wastage,
          'rcvdQty', rcvd_qty,
          'balanceQty', balance_qty,
          'totalRolls', total_rolls,
          'status', NULLIF(status, ''),
          'supplier', NULLIF(supplier, ''),
          'supplierRef', NULLIF(supplier_ref, ''),
          'colorCode', NULLIF(color_code, ''),
          'remarks', NULLIF(remarks, ''),
          'paramValues', CASE
            WHEN jsonb_typeof(param_values) = 'object' AND param_values <> '{}'::jsonb
            THEN param_values
            ELSE NULL
          END
        ))
    $sql$;
  END IF;
END;
$backfill$;

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
  v_type text;
  v_cons numeric;
  v_total numeric;
  v_extras jsonb;
  v_factory_id uuid;
  v_order_id uuid;
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

  v_cat := CASE WHEN trim(COALESCE(p_mat->>'category', '')) = 'Trim' THEN 'Trim' ELSE 'Fabric' END;
  v_type := COALESCE(
    NULLIF(trim(p_mat->>'type'), ''),
    CASE WHEN v_cat = 'Trim' THEN NULLIF(trim(p_mat->>'trimType'), '') ELSE NULL END,
    ''
  );

  v_cons := CASE
    WHEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc'))::numeric
    WHEN v_cat = 'Trim' AND (p_mat->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'perPc')::numeric
    WHEN v_cat = 'Fabric' AND (p_mat->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'avgCons')::numeric
    ELSE NULL
  END;

  v_total := CASE
    WHEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty'))::numeric
    ELSE NULL
  END;

  v_extras := CASE
    WHEN jsonb_typeof(p_mat->'extras') = 'object' THEN p_mat->'extras'
    ELSE '{}'::jsonb
  END;
  v_extras := v_extras || jsonb_strip_nulls(jsonb_build_object(
    'placement', NULLIF(p_mat->>'placement', ''),
    'trimType', NULLIF(p_mat->>'trimType', ''),
    'trimCategory', NULLIF(p_mat->>'trimCategory', ''),
    'fabricCategory', NULLIF(p_mat->>'fabricCategory', ''),
    'composition', NULLIF(p_mat->>'composition', ''),
    'unit', NULLIF(p_mat->>'unit', ''),
    'wastage', CASE WHEN (p_mat->>'wastage') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'wastage')::numeric ELSE NULL END,
    'rcvdQty', CASE WHEN (p_mat->>'rcvdQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'rcvdQty')::numeric ELSE NULL END,
    'balanceQty', CASE WHEN (p_mat->>'balanceQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'balanceQty')::numeric ELSE NULL END,
    'totalRolls', CASE WHEN (p_mat->>'totalRolls') ~ '^-?[0-9]+$' THEN (p_mat->>'totalRolls')::integer ELSE NULL END,
    'status', NULLIF(p_mat->>'status', ''),
    'supplier', NULLIF(p_mat->>'supplier', ''),
    'supplierRef', NULLIF(p_mat->>'supplierRef', ''),
    'colorCode', NULLIF(p_mat->>'colorCode', ''),
    'remarks', NULLIF(p_mat->>'remarks', ''),
    'paramValues', CASE
      WHEN jsonb_typeof(p_mat->'paramValues') = 'object' AND p_mat->'paramValues' <> '{}'::jsonb
      THEN p_mat->'paramValues'
      ELSE NULL
    END
  ));

  INSERT INTO public.colorway_materials (
    id, factory_id, order_id, colorway_id, seq,
    category, name, type, cons_per_pc, total_cons, extras, updated_at
  ) VALUES (
    v_id, v_factory_id, v_order_id, p_colorway_id, COALESCE(p_seq, 0),
    v_cat,
    COALESCE(p_mat->>'name', ''),
    v_type,
    v_cons,
    v_total,
    COALESCE(v_extras, '{}'::jsonb),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    factory_id = EXCLUDED.factory_id,
    order_id = EXCLUDED.order_id,
    colorway_id = EXCLUDED.colorway_id,
    seq = EXCLUDED.seq,
    category = EXCLUDED.category,
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    cons_per_pc = EXCLUDED.cons_per_pc,
    total_cons = EXCLUDED.total_cons,
    extras = EXCLUDED.extras,
    updated_at = now();

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._upsert_colorway_material(uuid, uuid, uuid, jsonb, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.colorway_materials_sync_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  SELECT cw.factory_id, cw.order_id
    INTO STRICT NEW.factory_id, NEW.order_id
    FROM public.colorways cw
    WHERE cw.id = NEW.colorway_id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS colorway_materials_sync_parent_trg ON public.colorway_materials;
CREATE TRIGGER colorway_materials_sync_parent_trg
  BEFORE INSERT OR UPDATE OF colorway_id, factory_id, order_id
  ON public.colorway_materials
  FOR EACH ROW EXECUTE FUNCTION public.colorway_materials_sync_parent();

ALTER TABLE public.colorway_materials
  DROP COLUMN IF EXISTS placement,
  DROP COLUMN IF EXISTS trim_type,
  DROP COLUMN IF EXISTS trim_category,
  DROP COLUMN IF EXISTS fabric_category,
  DROP COLUMN IF EXISTS composition,
  DROP COLUMN IF EXISTS unit,
  DROP COLUMN IF EXISTS avg_cons,
  DROP COLUMN IF EXISTS per_pc,
  DROP COLUMN IF EXISTS wastage,
  DROP COLUMN IF EXISTS req_qty,
  DROP COLUMN IF EXISTS rcvd_qty,
  DROP COLUMN IF EXISTS balance_qty,
  DROP COLUMN IF EXISTS total_rolls,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS supplier,
  DROP COLUMN IF EXISTS supplier_ref,
  DROP COLUMN IF EXISTS color_code,
  DROP COLUMN IF EXISTS remarks,
  DROP COLUMN IF EXISTS param_values;

COMMENT ON TABLE public.colorway_materials IS
  'Per-colorway material lines. Fixed: seq, name, category, type, cons_per_pc, total_cons. All other attributes in extras jsonb.';
COMMENT ON COLUMN public.colorway_materials.colorway_id IS
  'Parent colorways.id. factory_id and order_id are copied from that row.';
COMMENT ON COLUMN public.colorway_materials.seq IS 'S.No within the colorway.';
COMMENT ON COLUMN public.colorway_materials.category IS 'Fabric or Trim.';
COMMENT ON COLUMN public.colorway_materials.type IS 'Fabric type (Knit/Woven/…) or trim type.';
COMMENT ON COLUMN public.colorway_materials.cons_per_pc IS 'Cons / pc (fabric) or qty / pc (trim).';
COMMENT ON COLUMN public.colorway_materials.total_cons IS 'Total cons / total qty for the colorway.';
COMMENT ON COLUMN public.colorway_materials.extras IS
  'Variable fields: placement, fabricCategory, trimCategory, paramValues, unit, and other non-fixed attributes.';

NOTIFY pgrst, 'reload schema';
