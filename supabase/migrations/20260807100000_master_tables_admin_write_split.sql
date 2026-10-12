-- SCHEMA_BACKLOG B (continued): admin-only writes on remaining master/settings tables.
-- Idempotent — safe on live (partial apply) and local db reset.

-- app_configuration
DROP POLICY IF EXISTS app_configuration_all ON public.app_configuration;
DROP POLICY IF EXISTS app_configuration_select ON public.app_configuration;
DROP POLICY IF EXISTS app_configuration_insert ON public.app_configuration;
DROP POLICY IF EXISTS app_configuration_update ON public.app_configuration;
DROP POLICY IF EXISTS app_configuration_delete ON public.app_configuration;
CREATE POLICY app_configuration_select ON public.app_configuration
  FOR SELECT TO authenticated
  USING (factory_id = current_factory_id());
CREATE POLICY app_configuration_insert ON public.app_configuration
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY app_configuration_update ON public.app_configuration
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY app_configuration_delete ON public.app_configuration
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
-- assigned_resources
DROP POLICY IF EXISTS assigned_resources_insert ON public.assigned_resources;
DROP POLICY IF EXISTS assigned_resources_update ON public.assigned_resources;
DROP POLICY IF EXISTS assigned_resources_delete ON public.assigned_resources;
CREATE POLICY assigned_resources_insert ON public.assigned_resources
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY assigned_resources_update ON public.assigned_resources
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY assigned_resources_delete ON public.assigned_resources
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
-- department_workforce_rates
DROP POLICY IF EXISTS dept_workforce_rates_insert ON public.department_workforce_rates;
DROP POLICY IF EXISTS dept_workforce_rates_update ON public.department_workforce_rates;
CREATE POLICY dept_workforce_rates_insert ON public.department_workforce_rates
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY dept_workforce_rates_update ON public.department_workforce_rates
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
-- fabric_components
DROP POLICY IF EXISTS fabric_components_insert ON public.fabric_components;
DROP POLICY IF EXISTS fabric_components_update ON public.fabric_components;
DROP POLICY IF EXISTS fabric_components_delete ON public.fabric_components;
CREATE POLICY fabric_components_insert ON public.fabric_components
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY fabric_components_update ON public.fabric_components
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY fabric_components_delete ON public.fabric_components
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
-- process_flows (drop duplicate pf_* write policies; keep pf_select)
DROP POLICY IF EXISTS pf_insert ON public.process_flows;
DROP POLICY IF EXISTS pf_update ON public.process_flows;
DROP POLICY IF EXISTS pf_delete ON public.process_flows;
DROP POLICY IF EXISTS process_flows_insert ON public.process_flows;
DROP POLICY IF EXISTS process_flows_update ON public.process_flows;
DROP POLICY IF EXISTS process_flows_delete ON public.process_flows;
CREATE POLICY process_flows_insert ON public.process_flows
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY process_flows_update ON public.process_flows
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY process_flows_delete ON public.process_flows
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
-- shifts
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
DROP POLICY IF EXISTS shifts_update ON public.shifts;
DROP POLICY IF EXISTS shifts_delete ON public.shifts;
CREATE POLICY shifts_insert ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY shifts_update ON public.shifts
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY shifts_delete ON public.shifts
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
-- size_groups
DROP POLICY IF EXISTS size_groups_insert ON public.size_groups;
DROP POLICY IF EXISTS size_groups_update ON public.size_groups;
DROP POLICY IF EXISTS size_groups_delete ON public.size_groups;
CREATE POLICY size_groups_insert ON public.size_groups
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY size_groups_update ON public.size_groups
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin())
  WITH CHECK (factory_id = current_factory_id() AND is_factory_admin());
CREATE POLICY size_groups_delete ON public.size_groups
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
