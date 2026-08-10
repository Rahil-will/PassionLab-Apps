-- =============================================================================
-- colorways
-- One row per colour per order.  sizes jsonb is the live denormalised cache;
-- colorway_sizes holds the normalised rows for query flexibility.
-- DROP CASCADE for clean re-run (testing only)
-- =============================================================================
DROP TABLE IF EXISTS public.colorways CASCADE;

CREATE TABLE public.colorways (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.style_orders(id) ON DELETE CASCADE,
  factory_id          uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name                text NOT NULL DEFAULT 'Color',
  color_code          text,
  qty                 integer NOT NULL DEFAULT 0,   -- denorm: sum of order sizes
  adj_qty             integer NOT NULL DEFAULT 0,   -- denorm: sum of adjusted sizes
  sizes               jsonb NOT NULL DEFAULT '[]',  -- [{size, order_qty, adj_qty}]
  planning_remarks    text,
  completion_status   text NOT NULL DEFAULT 'in_progress'
    CHECK (completion_status IN ('in_progress','completed','closed')),
  closed_at           timestamptz,
  close_reason        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS colorways_order_idx   ON public.colorways(order_id);
CREATE INDEX IF NOT EXISTS colorways_factory_idx ON public.colorways(factory_id);

CREATE OR REPLACE TRIGGER colorways_updated_at
  BEFORE UPDATE ON public.colorways
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.colorways ENABLE ROW LEVEL SECURITY;

CREATE POLICY colorways_select ON public.colorways FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

CREATE POLICY colorways_insert ON public.colorways FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());

CREATE POLICY colorways_update ON public.colorways FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

CREATE POLICY colorways_delete ON public.colorways FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colorways TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.colorways TO anon;
