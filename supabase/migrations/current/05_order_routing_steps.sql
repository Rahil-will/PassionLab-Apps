-- =============================================================================
-- order_routing_steps
-- Per-order operation route (all colorways share one route).
-- Frozen operation attributes are captured at route save time.
-- =============================================================================
DROP TABLE IF EXISTS public.order_routing_steps CASCADE;

CREATE TABLE public.order_routing_steps (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id            uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  order_id              uuid NOT NULL REFERENCES public.style_orders(id) ON DELETE CASCADE,
  seq                   integer NOT NULL,
  operation_def_id      uuid REFERENCES public.operations(id) ON DELETE RESTRICT,
  operation_name        text,
  visit_id              uuid,
  visit_no              integer,
  dept_id               uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  dept_name             text NOT NULL,
  step_type             text NOT NULL DEFAULT 'produce'
    CHECK (step_type IN ('loading','produce','store','outsource')),
  capture_app           text NOT NULL DEFAULT 'transaction',
  transaction_app       boolean NOT NULL DEFAULT true,
  is_primary_output     boolean NOT NULL DEFAULT false,
  is_dept_exit_operation boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

CREATE INDEX IF NOT EXISTS ors_factory_idx ON public.order_routing_steps(factory_id);
CREATE INDEX IF NOT EXISTS ors_order_idx   ON public.order_routing_steps(order_id);
CREATE INDEX IF NOT EXISTS ors_order_visit_idx ON public.order_routing_steps(order_id, visit_id);

CREATE OR REPLACE TRIGGER ors_updated_at
  BEFORE UPDATE ON public.order_routing_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.order_routing_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY ors_select ON public.order_routing_steps FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());
CREATE POLICY ors_insert ON public.order_routing_steps FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());
CREATE POLICY ors_update ON public.order_routing_steps FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());
CREATE POLICY ors_delete ON public.order_routing_steps FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_routing_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_routing_steps TO anon;
