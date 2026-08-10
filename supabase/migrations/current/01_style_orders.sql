-- =============================================================================
-- style_orders
-- Core order master record.  One row per PO / style combination.
-- NOTE: shipment_plan (jsonb) was removed — use order_delivery_targets instead.
-- DROP CASCADE for clean re-run (testing only)
-- =============================================================================
DROP TABLE IF EXISTS public.style_orders CASCADE;

CREATE TABLE public.style_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  internal_order_no   text,
  style_name          text NOT NULL,
  style_ref           text,
  buyer_id            uuid REFERENCES public.buyers(id) ON DELETE SET NULL,
  buyer_name          text,
  po_number           text NOT NULL DEFAULT '',
  order_qty           integer NOT NULL DEFAULT 0,
  adj_qty             integer NOT NULL DEFAULT 0,
  order_date          date,
  job_card_date       date,
  season              text,
  garment_type        text,
  sewing_sam          numeric(8,2),
  priority            text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal','high','critical')),
  order_type          text NOT NULL DEFAULT 'new'
    CHECK (order_type IN ('new','repeat')),
  merchant_name       text,
  size_group_name     text,
  size_labels         text,           -- comma-separated size snapshot
  current_dept        text,
  status              text NOT NULL DEFAULT 'Not Started',
  image_url           text,
  remarks             text,
  cutting_allowance   numeric(5,2) NOT NULL DEFAULT 2,
  shipment_allowance  numeric(5,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS style_orders_factory_idx ON public.style_orders(factory_id);
CREATE INDEX IF NOT EXISTS style_orders_buyer_idx   ON public.style_orders(buyer_id);
CREATE INDEX IF NOT EXISTS style_orders_status_idx  ON public.style_orders(status);

CREATE OR REPLACE TRIGGER style_orders_updated_at
  BEFORE UPDATE ON public.style_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.style_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY style_orders_all ON public.style_orders TO authenticated
  USING (factory_id = public.current_factory_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.style_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.style_orders TO anon;
