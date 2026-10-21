-- Phase 1A (Rahil 2026-10-12): ALLOCATE = finished (cuttable-stage) rolls only. Greige / pre-finished rolls are BOOKED
-- (reserved) for a style line instead. Booking lives on the roll registry so it follows the roll through mill,
-- processing (inherited by re-rolled children) and warehouse.

ALTER TABLE public.mm_rolls
  ADD COLUMN IF NOT EXISTS booked_style_material_id uuid REFERENCES public.mm_style_materials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booked_at timestamptz,
  ADD COLUMN IF NOT EXISTS booked_by uuid;
CREATE INDEX IF NOT EXISTS mm_rolls_booked_idx ON public.mm_rolls (booked_style_material_id) WHERE booked_style_material_id IS NOT NULL;

-- Spec tolerance on the fabric (used by the spec check in Phase 1C)
ALTER TABLE public.mm_fabrics
  ADD COLUMN IF NOT EXISTS gsm_tol_pct numeric NOT NULL DEFAULT 2.5 CHECK (gsm_tol_pct >= 0 AND gsm_tol_pct <= 50),
  ADD COLUMN IF NOT EXISTS width_tol_pct numeric NOT NULL DEFAULT 2.5 CHECK (width_tol_pct >= 0 AND width_tol_pct <= 50);

CREATE OR REPLACE FUNCTION public._mm_roll_can_cut(p_roll_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s.can_cut FROM public.mm_rolls r JOIN public.mm_fabric_stages s ON s.factory_id = r.factory_id AND s.code = r.stage_code
                   WHERE r.id = p_roll_id), false)
$function$;

-- Guard on both custody tables: a style stamp on a not-finished roll becomes a booking.
-- A stamp on a finished roll clears that roll's booking for the same line (booking fulfilled).
CREATE OR REPLACE FUNCTION public._mm_custody_finished_only()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.roll_id IS NULL OR NEW.style_material_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.style_material_id IS NOT DISTINCT FROM OLD.style_material_id AND NEW.roll_id IS NOT DISTINCT FROM OLD.roll_id THEN
    RETURN NEW;
  END IF;
  IF public._mm_roll_can_cut(NEW.roll_id) THEN
    UPDATE public.mm_rolls SET booked_style_material_id = NULL, booked_at = NULL, booked_by = NULL
    WHERE id = NEW.roll_id AND booked_style_material_id = NEW.style_material_id;
    RETURN NEW;
  END IF;
  UPDATE public.mm_rolls SET booked_style_material_id = NEW.style_material_id, booked_at = now(), booked_by = public._mm_actor_id()
  WHERE id = NEW.roll_id;
  NEW.style_material_id := NULL;
  RETURN NEW;
END $function$;

CREATE TRIGGER mm_mill_rolls_zzz_finished_only BEFORE INSERT OR UPDATE OF style_material_id, roll_id ON public.mm_mill_rolls
FOR EACH ROW EXECUTE FUNCTION public._mm_custody_finished_only();
CREATE TRIGGER mm_stock_units_zzz_finished_only BEFORE INSERT OR UPDATE OF style_material_id, roll_id ON public.mm_stock_units
FOR EACH ROW EXECUTE FUNCTION public._mm_custody_finished_only();

-- Re-rolled / split children inherit the parents' booking (when all parents share it)
CREATE OR REPLACE FUNCTION public._mm_roll_lineage_booking()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_b uuid; v_n int;
BEGIN
  SELECT count(DISTINCT p.booked_style_material_id), min(p.booked_style_material_id::text)::uuid INTO v_n, v_b
  FROM public.mm_roll_lineage l JOIN public.mm_rolls p ON p.id = l.parent_roll_id
  WHERE l.child_roll_id = NEW.child_roll_id AND p.booked_style_material_id IS NOT NULL;
  IF v_n = 1 AND NOT EXISTS (SELECT 1 FROM public.mm_roll_lineage l JOIN public.mm_rolls p ON p.id = l.parent_roll_id
                             WHERE l.child_roll_id = NEW.child_roll_id AND p.booked_style_material_id IS NULL) THEN
    UPDATE public.mm_rolls SET booked_style_material_id = v_b, booked_at = now()
    WHERE id = NEW.child_roll_id AND booked_style_material_id IS NULL;
  ELSIF v_n > 1 THEN
    UPDATE public.mm_rolls SET booked_style_material_id = NULL, booked_at = NULL WHERE id = NEW.child_roll_id;
  END IF;
  RETURN NULL;
END $function$;
CREATE TRIGGER mm_roll_lineage_booking_trg AFTER INSERT ON public.mm_roll_lineage
FOR EACH ROW EXECUTE FUNCTION public._mm_roll_lineage_booking();

-- Existing data: greige rolls that are stamped (not issued) → bookings
UPDATE public.mm_rolls r SET booked_style_material_id = u.style_material_id, booked_at = now()
FROM public.mm_stock_units u
WHERE u.roll_id = r.id AND u.style_material_id IS NOT NULL AND NOT public._mm_roll_can_cut(r.id)
  AND u.status NOT IN ('issued', 'issued_pending', 'partially_consumed', 'consumed', 'written_off', 'cancelled');
UPDATE public.mm_stock_units u SET style_material_id = NULL
WHERE u.style_material_id IS NOT NULL AND u.roll_id IS NOT NULL AND NOT public._mm_roll_can_cut(u.roll_id)
  AND u.status NOT IN ('issued', 'issued_pending', 'partially_consumed', 'consumed', 'written_off', 'cancelled');
UPDATE public.mm_rolls r SET booked_style_material_id = m.style_material_id, booked_at = now()
FROM public.mm_mill_rolls m
WHERE m.roll_id = r.id AND m.style_material_id IS NOT NULL AND m.status = 'draft' AND NOT public._mm_roll_can_cut(r.id)
  AND r.booked_style_material_id IS NULL;
UPDATE public.mm_mill_rolls m SET style_material_id = NULL
WHERE m.style_material_id IS NOT NULL AND m.status = 'draft' AND m.roll_id IS NOT NULL AND NOT public._mm_roll_can_cut(m.roll_id);
-- mill rolls whose warehouse unit lost the stamp above: keep custody records consistent
UPDATE public.mm_mill_rolls m SET style_material_id = NULL
FROM public.mm_stock_units u
WHERE u.mill_roll_id = m.id AND m.style_material_id IS NOT NULL AND u.style_material_id IS NULL AND NOT public._mm_roll_can_cut(m.roll_id);
