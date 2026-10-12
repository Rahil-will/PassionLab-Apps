-- Phase 3a: every roll knows its fabric (mm_rolls.fabric_id).
-- Sources (first wins): explicit (v5 wrappers / assign RPCs) -> mill batch fabric -> parent roll (processing) ->
-- style line fabric on allocation. Allocating a roll to a style line of a different fabric is blocked.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.mm_rolls
  ADD COLUMN IF NOT EXISTS fabric_id uuid REFERENCES public.mm_fabrics (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS mm_rolls_fabric_idx ON public.mm_rolls (factory_id, fabric_id);

ALTER TABLE public.mm_mill_batches
  ADD COLUMN IF NOT EXISTS fabric_id uuid REFERENCES public.mm_fabrics (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS mm_mill_batches_fabric_idx ON public.mm_mill_batches (fabric_id) WHERE fabric_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- fabric id passed by a v5 wrapper for the current transaction (or NULL)
CREATE OR REPLACE FUNCTION public._mm_receipt_fabric_guc()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE v text := NULLIF(current_setting('mm.receipt_fabric_id', true), '');
BEGIN
  RETURN CASE WHEN v ~ '^[0-9a-f-]{36}$' THEN v::uuid ELSE NULL END;
END $$;

-- resolve a fabric for receipts: same factory, follows merges, not inactive
CREATE OR REPLACE FUNCTION public._mm_receipt_fabric(p_factory uuid, p_fabric_id uuid)
RETURNS public.mm_fabrics
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE f public.mm_fabrics%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.mm_fabrics WHERE id = p_fabric_id AND factory_id = p_factory;
  IF f.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND|Fabric not found'; END IF;
  IF f.merged_into_id IS NOT NULL THEN
    SELECT * INTO f FROM public.mm_fabrics WHERE id = f.merged_into_id;
  END IF;
  IF f.status = 'inactive' THEN RAISE EXCEPTION 'INVALID|Fabric % is inactive', f.code; END IF;
  RETURN f;
END $$;

-- style line currently holding a roll (warehouse custody first, then mill)
CREATE OR REPLACE FUNCTION public._mm_roll_style_material(p_roll_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT u.style_material_id FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id LIMIT 1),
    (SELECT m.style_material_id FROM public.mm_mill_rolls m WHERE m.roll_id = p_roll_id LIMIT 1));
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------
-- 3a new registry row: explicit receipt fabric, else mill batch fabric
CREATE OR REPLACE FUNCTION public._mm_rolls_fabric_inherit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fabric_id IS NULL THEN
    NEW.fabric_id := public._mm_receipt_fabric_guc();
  END IF;
  IF NEW.fabric_id IS NULL AND NEW.mill_batch_id IS NOT NULL THEN
    SELECT b.fabric_id INTO NEW.fabric_id FROM public.mm_mill_batches b WHERE b.id = NEW.mill_batch_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mm_rolls_fabric_inherit_trg
  BEFORE INSERT ON public.mm_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_rolls_fabric_inherit();

-- 3b mill batches created by a v5 wrapper get the fabric too
CREATE OR REPLACE FUNCTION public._mm_mill_batch_fabric_guc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fabric_id IS NULL THEN
    NEW.fabric_id := public._mm_receipt_fabric_guc();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mm_mill_batches_fabric_guc_trg
  BEFORE INSERT ON public.mm_mill_batches
  FOR EACH ROW EXECUTE FUNCTION public._mm_mill_batch_fabric_guc();

-- 3c re-rolled child inherits the parent's fabric
CREATE OR REPLACE FUNCTION public._mm_roll_lineage_fabric()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.mm_rolls c SET fabric_id = p.fabric_id
  FROM public.mm_rolls p
  WHERE c.id = NEW.child_roll_id AND p.id = NEW.parent_roll_id
    AND c.fabric_id IS NULL AND p.fabric_id IS NOT NULL;
  RETURN NULL;
END $$;

CREATE TRIGGER mm_roll_lineage_fabric_trg
  AFTER INSERT ON public.mm_roll_lineage
  FOR EACH ROW EXECUTE FUNCTION public._mm_roll_lineage_fabric();

-- 3d allocation: take the style line fabric, or block a different fabric
CREATE OR REPLACE FUNCTION public._mm_custody_fabric_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_line uuid;
  v_roll uuid;
  v_code text;
  v_line_code text;
  v_roll_code text;
BEGIN
  IF NEW.roll_id IS NULL OR NEW.style_material_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.style_material_id IS NOT DISTINCT FROM OLD.style_material_id
     AND NEW.roll_id IS NOT DISTINCT FROM OLD.roll_id THEN
    RETURN NEW;
  END IF;
  SELECT fabric_id INTO v_line FROM public.mm_style_materials WHERE id = NEW.style_material_id;
  IF v_line IS NULL THEN RETURN NEW; END IF;
  SELECT fabric_id, roll_code INTO v_roll, v_code FROM public.mm_rolls WHERE id = NEW.roll_id;
  IF v_roll IS NULL THEN
    UPDATE public.mm_rolls SET fabric_id = v_line, updated_at = now() WHERE id = NEW.roll_id;
  ELSIF v_roll <> v_line THEN
    SELECT code INTO v_line_code FROM public.mm_fabrics WHERE id = v_line;
    SELECT code INTO v_roll_code FROM public.mm_fabrics WHERE id = v_roll;
    RAISE EXCEPTION 'FABRIC_MISMATCH: roll % is % but this style line uses %', COALESCE(v_code, NEW.unit_code), v_roll_code, v_line_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mm_stock_units_zz_fabric_trg
  BEFORE INSERT OR UPDATE OF style_material_id, roll_id ON public.mm_stock_units
  FOR EACH ROW EXECUTE FUNCTION public._mm_custody_fabric_sync();
CREATE TRIGGER mm_mill_rolls_zz_fabric_trg
  BEFORE INSERT OR UPDATE OF style_material_id, roll_id ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_custody_fabric_sync();

-- 3e a style line gets (re)linked to a fabric: its rolls follow (unlinked ones, or ones on the old fabric)
CREATE OR REPLACE FUNCTION public._mm_style_material_fabric_rolls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.fabric_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.mm_rolls r SET fabric_id = NEW.fabric_id, updated_at = now()
  WHERE r.id IN (
          SELECT u.roll_id FROM public.mm_stock_units u WHERE u.style_material_id = NEW.id AND u.roll_id IS NOT NULL
          UNION
          SELECT m.roll_id FROM public.mm_mill_rolls m WHERE m.style_material_id = NEW.id AND m.roll_id IS NOT NULL)
    AND (r.fabric_id IS NULL OR r.fabric_id IS NOT DISTINCT FROM OLD.fabric_id);
  RETURN NULL;
END $$;

CREATE TRIGGER mm_style_materials_fabric_rolls_trg
  AFTER UPDATE OF fabric_id ON public.mm_style_materials
  FOR EACH ROW WHEN (OLD.fabric_id IS DISTINCT FROM NEW.fabric_id)
  EXECUTE FUNCTION public._mm_style_material_fabric_rolls();

REVOKE ALL ON FUNCTION public._mm_receipt_fabric_guc() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_receipt_fabric(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_roll_style_material(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_rolls_fabric_inherit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_mill_batch_fabric_guc() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_roll_lineage_fabric() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_custody_fabric_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_style_material_fabric_rolls() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: rolls on style lines that already point at a fabric
-- ---------------------------------------------------------------------------
UPDATE public.mm_rolls r SET fabric_id = sm.fabric_id
FROM public.mm_style_materials sm
WHERE r.fabric_id IS NULL
  AND sm.fabric_id IS NOT NULL
  AND sm.id = public._mm_roll_style_material(r.id);
