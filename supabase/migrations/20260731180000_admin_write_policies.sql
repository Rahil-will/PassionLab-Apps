-- SCHEMA_BACKLOG B: admin-only writes on master/planning tables (SELECT stays factory-scoped).

-- style_orders
DROP POLICY IF EXISTS style_orders_all ON public.style_orders;
CREATE POLICY style_orders_select ON public.style_orders
  FOR SELECT TO authenticated
  USING (factory_id = current_factory_id());
CREATE POLICY style_orders_insert ON public.style_orders
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY style_orders_update ON public.style_orders
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY style_orders_delete ON public.style_orders
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());

-- line_allocations
DROP POLICY IF EXISTS la_all ON public.line_allocations;
CREATE POLICY line_allocations_select ON public.line_allocations
  FOR SELECT TO authenticated
  USING (factory_id = current_factory_id());
CREATE POLICY line_allocations_insert ON public.line_allocations
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY line_allocations_update ON public.line_allocations
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY line_allocations_delete ON public.line_allocations
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());

-- buyers (writes only — select unchanged)
DROP POLICY IF EXISTS buyers_insert ON public.buyers;
DROP POLICY IF EXISTS buyers_update ON public.buyers;
DROP POLICY IF EXISTS buyers_delete ON public.buyers;
CREATE POLICY buyers_insert ON public.buyers
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY buyers_update ON public.buyers
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY buyers_delete ON public.buyers
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());

-- departments (writes only)
DROP POLICY IF EXISTS departments_insert ON public.departments;
DROP POLICY IF EXISTS departments_update ON public.departments;
DROP POLICY IF EXISTS departments_delete ON public.departments;
CREATE POLICY departments_insert ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY departments_update ON public.departments
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY departments_delete ON public.departments
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());

-- operations
DROP POLICY IF EXISTS operations_all ON public.operations;
CREATE POLICY operations_select ON public.operations
  FOR SELECT TO authenticated
  USING (factory_id = current_factory_id());
CREATE POLICY operations_insert ON public.operations
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY operations_update ON public.operations
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY operations_delete ON public.operations
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
