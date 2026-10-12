-- Per-factory Material feature flags (read-only in UI for v1).
-- Seed: all existing factories get receive_goods + test_rolls = true.

CREATE TABLE public.mm_factory_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mm_factory_features_key_chk CHECK (
    feature_key = ANY (ARRAY['receive_goods'::text, 'test_rolls'::text])
  ),
  CONSTRAINT mm_factory_features_factory_key_uidx UNIQUE (factory_id, feature_key)
);

CREATE INDEX mm_factory_features_factory_idx ON public.mm_factory_features (factory_id);

COMMENT ON TABLE public.mm_factory_features IS
  'Factory-scoped Material capabilities (Receive goods, Test the rolls). UI is read-only in v1; mutate via SQL/admin RPC later.';

-- Prefer lockdown helper when present (Phase 2+); otherwise mirror its grants/policies.
DO $$
BEGIN
  IF to_regprocedure('public._mm_lockdown_table(regclass)') IS NOT NULL THEN
    PERFORM public._mm_lockdown_table('public.mm_factory_features'::regclass);
  ELSE
    ALTER TABLE public.mm_factory_features ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS mm_factory_features_mm_select ON public.mm_factory_features;
    CREATE POLICY mm_factory_features_mm_select ON public.mm_factory_features
      FOR SELECT TO authenticated
      USING (factory_id = public.current_factory_id());
    REVOKE ALL ON TABLE public.mm_factory_features FROM PUBLIC;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mm_factory_features FROM authenticated, anon;
    GRANT SELECT ON TABLE public.mm_factory_features TO authenticated;
    GRANT ALL ON TABLE public.mm_factory_features TO service_role;
  END IF;
END $$;

-- Backfill every factory with both features ON
INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
SELECT f.id, k.feature_key, true
FROM public.factories f
CROSS JOIN (VALUES ('receive_goods'), ('test_rolls')) AS k(feature_key)
ON CONFLICT (factory_id, feature_key) DO NOTHING;;
