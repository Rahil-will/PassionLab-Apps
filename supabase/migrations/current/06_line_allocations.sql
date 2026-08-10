-- =============================================================================
-- line_allocations
-- Planning board rows: one allocation per colorway × department × date range.
-- operation_id references order_routing_steps.id (nullable FK, deferrable).
-- operation_name is optional — the canonical name lives on the routing step.
-- DROP CASCADE for clean re-run (testing only)
-- =============================================================================
DROP TABLE IF EXISTS public.line_allocations CASCADE;

CREATE TABLE public.line_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id        uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES public.style_orders(id) ON DELETE CASCADE,
  colorway_id       uuid REFERENCES public.colorways(id) ON DELETE CASCADE,
  line_id           uuid,             -- references assigned_resources line
  department_id     uuid,
  department_name   text,
  operation_name    text,             -- optional display label
  operation_id      uuid REFERENCES public.order_routing_steps(id) ON DELETE SET NULL
                      DEFERRABLE INITIALLY DEFERRED,
  qty               integer NOT NULL DEFAULT 0,
  daily_target      integer NOT NULL DEFAULT 0,
  hourly_target     numeric(8,2),
  start_date        date,
  end_date          date,
  completed_is_true boolean NOT NULL DEFAULT false,
  sam               numeric(8,2),
  kpi_inputs        jsonb,
  status            text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','completed','cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS la_factory_idx  ON public.line_allocations(factory_id);
CREATE INDEX IF NOT EXISTS la_order_idx    ON public.line_allocations(order_id);
CREATE INDEX IF NOT EXISTS la_colorway_idx ON public.line_allocations(colorway_id);
CREATE INDEX IF NOT EXISTS la_date_idx     ON public.line_allocations(start_date, end_date);
CREATE INDEX IF NOT EXISTS la_op_idx       ON public.line_allocations(operation_id);

CREATE OR REPLACE TRIGGER la_updated_at
  BEFORE UPDATE ON public.line_allocations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.line_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY la_all ON public.line_allocations TO authenticated
  USING (factory_id = public.current_factory_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_allocations TO anon;
