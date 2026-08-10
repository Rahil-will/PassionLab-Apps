-- =============================================================================
-- order_delivery_targets
-- One row per (order, colorway, shipment date).
-- This is the LIVE source of truth for shipment planning — replaces the old
-- shipment_plan jsonb column that was removed from style_orders.
--
-- order_delivery_target_history
-- Append-only audit log automatically written by trigger on every UPDATE
-- that changes target_date, qty_by_size, ship_mode, or shipment_type.
--
-- DROP CASCADE for clean re-run (testing only)
-- =============================================================================
DROP TABLE IF EXISTS public.order_delivery_target_history CASCADE;
DROP TABLE IF EXISTS public.order_delivery_targets CASCADE;
DROP FUNCTION IF EXISTS public.odt_log_history() CASCADE;
DROP FUNCTION IF EXISTS public.odt_set_total_qty() CASCADE;
DROP FUNCTION IF EXISTS public.odt_check_date() CASCADE;

-- ---------------------------------------------------------------------------
-- Main table
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_delivery_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES public.style_orders(id) ON DELETE CASCADE,
  colorway_id     uuid REFERENCES public.colorways(id) ON DELETE CASCADE,  -- NULL = all colours
  target_date     date NOT NULL,
  ship_mode       text,
  shipment_type   text,
  qty_by_size          jsonb NOT NULL DEFAULT '{}',   -- {size_key: qty}
  total_qty            integer NOT NULL DEFAULT 0,    -- maintained by trigger odt_set_total_qty
  destination_country  text,
  status               text    NOT NULL DEFAULT 'planned',  -- 'planned' | 'replanned'
  change_history       jsonb   NOT NULL DEFAULT '[]', -- append-only log of date changes
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Unique: same colorway can only have one row per date per order
CREATE UNIQUE INDEX IF NOT EXISTS odt_natural_key_idx
  ON public.order_delivery_targets (order_id, colorway_id, destination_country, target_date)
  WHERE colorway_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS odt_factory_idx ON public.order_delivery_targets(factory_id);
CREATE INDEX IF NOT EXISTS odt_order_idx   ON public.order_delivery_targets(order_id);
CREATE INDEX IF NOT EXISTS odt_date_idx    ON public.order_delivery_targets(target_date);

-- Trigger: keep total_qty in sync and validate target_date >= job_card_date
CREATE OR REPLACE FUNCTION public.odt_set_total_qty()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_qty := COALESCE(
    (SELECT SUM(value::integer)
     FROM jsonb_each_text(NEW.qty_by_size)),
    0
  );
  -- Enforce: shipment date must not be before the order's job_card_date
  IF NEW.target_date IS NOT NULL THEN
    PERFORM 1 FROM public.style_orders
    WHERE id = NEW.order_id
      AND job_card_date IS NOT NULL
      AND NEW.target_date < job_card_date;
    IF FOUND THEN
      RAISE EXCEPTION 'Shipment date (%) cannot be before the job card date of this order.', NEW.target_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER odt_set_total_qty
  BEFORE INSERT OR UPDATE ON public.order_delivery_targets
  FOR EACH ROW EXECUTE FUNCTION public.odt_set_total_qty();

CREATE OR REPLACE TRIGGER odt_updated_at
  BEFORE UPDATE ON public.order_delivery_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.order_delivery_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY odt_select ON public.order_delivery_targets FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());
CREATE POLICY odt_insert ON public.order_delivery_targets FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());
CREATE POLICY odt_update ON public.order_delivery_targets FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());
CREATE POLICY odt_delete ON public.order_delivery_targets FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_delivery_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_delivery_targets TO anon;

-- ---------------------------------------------------------------------------
-- History / audit table
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_delivery_target_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id        uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  target_id         uuid NOT NULL REFERENCES public.order_delivery_targets(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES public.style_orders(id) ON DELETE CASCADE,
  colorway_id       uuid REFERENCES public.colorways(id) ON DELETE SET NULL,
  old_target_date   date,
  new_target_date   date,
  old_qty_by_size   jsonb,
  new_qty_by_size   jsonb,
  old_ship_mode     text,
  new_ship_mode     text,
  old_shipment_type text,
  new_shipment_type text,
  change_reason     text,   -- set via SET LOCAL "app.change_reason" = '...' before the update
  changed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS odth_target_idx  ON public.order_delivery_target_history(target_id);
CREATE INDEX IF NOT EXISTS odth_order_idx   ON public.order_delivery_target_history(order_id);
CREATE INDEX IF NOT EXISTS odth_factory_idx ON public.order_delivery_target_history(factory_id);

ALTER TABLE public.order_delivery_target_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY odth_select ON public.order_delivery_target_history FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());
CREATE POLICY odth_insert ON public.order_delivery_target_history FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id());

GRANT SELECT, INSERT ON public.order_delivery_target_history TO authenticated;

-- ---------------------------------------------------------------------------
-- Auto-history trigger: fires on every meaningful UPDATE to ODT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.odt_log_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.target_date     IS DISTINCT FROM OLD.target_date)
  OR (NEW.qty_by_size     IS DISTINCT FROM OLD.qty_by_size)
  OR (NEW.ship_mode       IS DISTINCT FROM OLD.ship_mode)
  OR (NEW.shipment_type   IS DISTINCT FROM OLD.shipment_type)
  THEN
    INSERT INTO public.order_delivery_target_history (
      factory_id, target_id, order_id, colorway_id,
      old_target_date, new_target_date,
      old_qty_by_size, new_qty_by_size,
      old_ship_mode,   new_ship_mode,
      old_shipment_type, new_shipment_type,
      change_reason, changed_by
    ) VALUES (
      NEW.factory_id, NEW.id, NEW.order_id, NEW.colorway_id,
      OLD.target_date,   NEW.target_date,
      OLD.qty_by_size,   NEW.qty_by_size,
      OLD.ship_mode,     NEW.ship_mode,
      OLD.shipment_type, NEW.shipment_type,
      current_setting('app.change_reason', true),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER odt_history_trigger
  AFTER UPDATE ON public.order_delivery_targets
  FOR EACH ROW EXECUTE FUNCTION public.odt_log_history();
