-- =============================================================================
-- departments — canonical work-center table (locked schema)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sequence     integer NOT NULL DEFAULT 10,
  transaction_enabled boolean NOT NULL DEFAULT true,
  supervisor_enabled boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  worker_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  role         text NOT NULL DEFAULT 'standard'
    CHECK (role = ANY (ARRAY['origin'::text, 'standard'::text, 'terminal'::text])),
  planning_mode text NOT NULL DEFAULT 'production'
    CHECK (planning_mode = ANY (ARRAY[
      'production'::text,
      'storage'::text,
      'outsource'::text,
      'native_cutting'::text,
      'native_shipment'::text
    ])),
  is_native    boolean NOT NULL DEFAULT false,
  UNIQUE (factory_id, name)
);

CREATE INDEX IF NOT EXISTS departments_factory_idx ON public.departments(factory_id);
CREATE INDEX IF NOT EXISTS departments_factory_role_idx ON public.departments(factory_id, role);
CREATE INDEX IF NOT EXISTS departments_factory_sequence_idx ON public.departments(factory_id, sequence);

CREATE OR REPLACE TRIGGER departments_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_seed_department_defects ON public.departments;
CREATE TRIGGER trg_seed_department_defects
  AFTER INSERT ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.seed_department_defects();

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

DROP POLICY IF EXISTS departments_insert ON public.departments FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS departments_update ON public.departments FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS departments_delete ON public.departments FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO anon;

COMMENT ON COLUMN public.departments.sequence IS
  'Display order. origin = 1, terminal = 2147483647, standard = user-defined.';

COMMENT ON TABLE public.departments IS
  'Factory work centers. role = origin | standard | terminal. Operations live in operations catalog. Sort by sequence.';
