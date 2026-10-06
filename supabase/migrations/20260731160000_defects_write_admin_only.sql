-- SCHEMA_BACKLOG B: defects write must require factory admin (match dashboard_links_write).
DROP POLICY IF EXISTS defects_write ON public.defects;
CREATE POLICY defects_write ON public.defects
  FOR ALL TO authenticated
  USING ((factory_id = current_factory_id()) AND is_factory_admin())
  WITH CHECK ((factory_id = current_factory_id()) AND is_factory_admin());
