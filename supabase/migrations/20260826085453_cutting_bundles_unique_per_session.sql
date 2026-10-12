-- Drop old unique index that blocks same bundle_no across different operations
DROP INDEX IF EXISTS idx_cutting_bundles_factory_bundle_no;

-- Recreate: bundle_no only needs to be unique within a session, not globally
CREATE UNIQUE INDEX idx_cutting_bundles_factory_bundle_no
  ON public.cutting_bundles (factory_id, session_id, bundle_no);;
