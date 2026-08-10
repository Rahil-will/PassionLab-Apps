-- =============================================================================
-- process_flows — routing templates (steps inline as jsonb)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.process_flows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pf_factory_idx ON public.process_flows(factory_id);

CREATE OR REPLACE TRIGGER pf_updated_at
  BEFORE UPDATE ON public.process_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.process_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pf_select ON public.process_flows;
CREATE POLICY pf_select ON public.process_flows FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

DROP POLICY IF EXISTS pf_insert ON public.process_flows;
CREATE POLICY pf_insert ON public.process_flows FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS pf_update ON public.process_flows;
CREATE POLICY pf_update ON public.process_flows FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS pf_delete ON public.process_flows;
CREATE POLICY pf_delete ON public.process_flows FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.process_flows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.process_flows TO anon;
