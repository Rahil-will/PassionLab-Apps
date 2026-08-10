-- Baseline migration: live public schema snapshot
-- Generated: 2026-07-31T09:43:11.425Z
-- Project: xtfljldeceonqyzgkoyp
-- Source: scripts/pull-live-baseline.mjs (Management API fallback)
--
-- User admin is edge-function-only. This baseline intentionally excludes
-- save_factory_user / update_factory_user (see supabase/migrations/_archived/).
--
-- Refresh: node scripts/pull-live-baseline.mjs
-- Verify:  npx supabase db query --linked --file scripts/verify_live_functions.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tables
CREATE TABLE IF NOT EXISTS public.app_configuration (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  step_type text NOT NULL,
  allowed_apps jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.assigned_resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid,
  resource_name text NOT NULL,
  resource_type text DEFAULT 'inhouse'::text NOT NULL,
  capacity integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  description text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.audit_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  department_id uuid NOT NULL,
  lot_size integer DEFAULT 0 NOT NULL,
  sample_size integer DEFAULT 0 NOT NULL,
  aql_level text,
  passed integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  result text,
  logged_by uuid,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  colorway_id uuid,
  status text DEFAULT 'completed'::text NOT NULL,
  major_failed integer DEFAULT 0 NOT NULL,
  minor_failed integer DEFAULT 0 NOT NULL,
  pieces_json jsonb DEFAULT '[]'::jsonb NOT NULL,
  completed_at timestamp with time zone,
  resource_id uuid,
  order_route_id uuid NOT NULL,
  line_allocation_id uuid,
  shift_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.batch_production (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  order_route_id uuid NOT NULL,
  department_id uuid NOT NULL,
  resource_id uuid,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  log_date date DEFAULT CURRENT_DATE NOT NULL,
  headcount_by_category jsonb DEFAULT '{}'::jsonb NOT NULL,
  produced_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  produced_qty integer DEFAULT 0 NOT NULL,
  activity_no text,
  ref_no text,
  comment text,
  worker_count integer,
  duration_mins numeric,
  available_mins numeric,
  sam numeric,
  produced_mins numeric,
  logged_by uuid,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  efficiency_pct numeric,
  shift_id uuid,
  line_allocation_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.buyers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  country text,
  type text,
  status text DEFAULT 'Active'::text,
  contact_name text,
  contact_email text,
  contact_role text,
  over_shipment_pct numeric(5,2) DEFAULT 0,
  under_shipment_pct numeric(5,2) DEFAULT 0,
  packing_rule text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  ship_mode text,
  destination text,
  currency text,
  ship_mode_options jsonb DEFAULT '[]'::jsonb NOT NULL,
  shipment_type_options jsonb DEFAULT '[]'::jsonb NOT NULL,
  contact_phone text,
  destination_countries text[] DEFAULT '{}'::text[] NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.colorways (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL,
  factory_id uuid NOT NULL,
  name text DEFAULT 'Color'::text NOT NULL,
  qty integer DEFAULT 0 NOT NULL,
  adj_qty integer DEFAULT 0 NOT NULL,
  sizes jsonb DEFAULT '[]'::jsonb NOT NULL,
  planning_remarks text,
  completion_status text DEFAULT 'in_progress'::text NOT NULL,
  closed_at timestamp with time zone,
  close_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  color_code text,
  shipment_floor_status text DEFAULT 'active'::text NOT NULL,
  ready_to_ship_at timestamp with time zone,
  ready_to_ship_by uuid,
  reaudit_opened_at timestamp with time zone,
  reaudit_opened_by uuid,
  reaudit_reason text,
  shipped_closed_at timestamp with time zone,
  shipped_closed_by uuid,
  close_comment text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.control_panel_audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  factory_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cutting_bundles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  lay_id uuid NOT NULL,
  session_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  bundle_no text NOT NULL,
  bundle_sequence integer NOT NULL,
  session_no text NOT NULL,
  lot_no text NOT NULL,
  lay_no integer NOT NULL,
  size text NOT NULL,
  qty integer NOT NULL,
  piece_from integer NOT NULL,
  piece_to integer NOT NULL,
  fabric_type text NOT NULL,
  status text DEFAULT 'available'::text NOT NULL,
  handover_slip_id uuid,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fabric_component_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cutting_lays (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  session_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  lay_no integer NOT NULL,
  fabric_shade text,
  marker text,
  marker_length numeric,
  ply_count integer,
  number_of_plies integer,
  fabric_consumption numeric,
  comments text,
  qty_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  total_qty integer DEFAULT 0 NOT NULL,
  bundles_generated boolean NOT NULL,
  logged_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fabric_component_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cutting_session_lots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  session_id uuid NOT NULL,
  lot_no text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  total_qty integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  lot_type text,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cutting_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  department_id uuid NOT NULL,
  order_route_id uuid,
  session_no text NOT NULL,
  ref_no text,
  fabric_type text DEFAULT 'main_fabric'::text NOT NULL,
  comments text,
  log_date date DEFAULT CURRENT_DATE NOT NULL,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  headcount_by_category jsonb DEFAULT '{}'::jsonb NOT NULL,
  total_headcount integer DEFAULT 0 NOT NULL,
  total_qty integer DEFAULT 0 NOT NULL,
  logged_by uuid NOT NULL,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  resource_id uuid,
  size_ratio jsonb DEFAULT '{}'::jsonb NOT NULL,
  line_allocation_id uuid,
  fabric_component_id uuid,
  cumulative_cut_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  cutting_table text,
  shift_id uuid,
  sam numeric,
  produced_mins numeric,
  available_mins numeric,
  duration_mins numeric,
  efficiency_pct numeric(8,2),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.dashboard_configs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  dashboard_type text NOT NULL,
  name text NOT NULL,
  department_id uuid,
  resource_id uuid,
  access_token text NOT NULL,
  created_by uuid,
  is_active boolean NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.dashboard_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  target_url text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  is_active boolean NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.defects (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid,
  defects jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.department_workforce_rates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid NOT NULL,
  label text NOT NULL,
  shift_id uuid NOT NULL,
  cost_per_hour numeric(10,2) DEFAULT 0 NOT NULL,
  effective_month date NOT NULL,
  is_current boolean NOT NULL,
  superseded_by uuid,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  role text DEFAULT 'standard'::text NOT NULL,
  is_native boolean NOT NULL,
  sequence integer DEFAULT 10 NOT NULL,
  planning_mode text DEFAULT 'production'::text NOT NULL,
  transaction_enabled boolean NOT NULL,
  supervisor_enabled boolean NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.fabric_components (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid NOT NULL,
  code text NOT NULL,
  fabric_type text NOT NULL,
  remarks text,
  is_primary boolean NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_active boolean NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.factories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  country text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  type text,
  transaction_apps jsonb DEFAULT '["transaction"]'::jsonb NOT NULL,
  production_apps jsonb DEFAULT '["hourly", "qc_log"]'::jsonb NOT NULL,
  workforce_apps jsonb DEFAULT '["workforce_log", "attendance"]'::jsonb NOT NULL,
  audit_apps jsonb DEFAULT '["audit"]'::jsonb NOT NULL,
  shipment_apps jsonb DEFAULT '["shipment_log", "final_rejection_log", "shipment_audit"]'::jsonb NOT NULL,
  timezone text DEFAULT 'UTC'::text NOT NULL,
  default_shift_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.floor_user_access (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid,
  operation_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  grant_ended_at timestamp with time zone,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.handover_slips (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  sent_qty integer DEFAULT 0 NOT NULL,
  received_qty integer,
  sent_by uuid,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  received_by uuid,
  received_at timestamp with time zone,
  notes text,
  status text DEFAULT 'pending'::text NOT NULL,
  challan_number text,
  colorway_id uuid,
  qty_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  received_qty_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  received_notes text,
  from_line_allocation_id uuid,
  from_visit_id uuid,
  to_visit_id uuid,
  from_department_id uuid NOT NULL,
  to_department_id uuid NOT NULL,
  loss_closed_by uuid,
  loss_closed_at timestamp with time zone,
  loss_remark text,
  loss_rejection_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.hourly_counts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  department_id uuid NOT NULL,
  resource_id uuid,
  shift_id uuid,
  hour_slot text NOT NULL,
  log_date date DEFAULT CURRENT_DATE NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  logged_by uuid,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  count_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  sam numeric(8,2),
  produced_mins numeric(10,2),
  order_route_id uuid NOT NULL,
  line_allocation_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.inspection_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  department_id uuid NOT NULL,
  resource_id uuid,
  shift_id uuid,
  hour_slot text NOT NULL,
  log_date date DEFAULT CURRENT_DATE NOT NULL,
  total_inspected integer DEFAULT 0 NOT NULL,
  passed integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  rework_passed integer DEFAULT 0 NOT NULL,
  passed_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  failed_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  rework_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  defect_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  logged_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  dhu numeric(6,2),
  defective_pct numeric(6,2),
  ftr_pct numeric(6,2),
  first_time_pass integer DEFAULT 0 NOT NULL,
  first_time_pass_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  order_route_id uuid NOT NULL,
  line_allocation_id uuid,
  sam numeric,
  produced_mins numeric,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.line_allocations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  line_id uuid,
  department_id uuid,
  qty integer DEFAULT 0 NOT NULL,
  daily_target integer DEFAULT 0 NOT NULL,
  hourly_target numeric(8,2),
  start_date date,
  end_date date,
  completed_is_true boolean NOT NULL,
  sam numeric(8,2),
  kpi_inputs jsonb,
  status text DEFAULT 'planned'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  department_name text,
  visit_id uuid,
  production_completed_at timestamp with time zone,
  production_completed_by uuid,
  production_comments text,
  production_planned_qty integer,
  production_produced_qty integer,
  handover_completed_at timestamp with time zone,
  handover_completed_by uuid,
  handover_comments text,
  handover_produced_qty integer,
  handover_sent_qty integer,
  handover_available_qty integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.operations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid NOT NULL,
  name text NOT NULL,
  step_type text DEFAULT 'produce'::text NOT NULL,
  capture_app text,
  is_active boolean NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.order_delivery_target_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  target_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  old_target_date date,
  new_target_date date,
  old_qty_by_size jsonb,
  new_qty_by_size jsonb,
  old_ship_mode text,
  new_ship_mode text,
  old_shipment_type text,
  new_shipment_type text,
  change_reason text,
  changed_by uuid,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.order_delivery_targets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  target_date date NOT NULL,
  ship_mode text,
  shipment_type text,
  qty_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  total_qty integer DEFAULT 0 NOT NULL,
  destination_country text,
  status text DEFAULT 'planned'::text NOT NULL,
  change_history jsonb DEFAULT '[]'::jsonb NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.order_routing_steps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  seq integer NOT NULL,
  dept_id uuid NOT NULL,
  dept_name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  transaction_app boolean NOT NULL,
  operation_def_id uuid,
  is_primary_output boolean NOT NULL,
  visit_id uuid,
  operation_name text,
  step_type text,
  capture_app text,
  is_dept_exit_operation boolean NOT NULL,
  visit_no integer,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.outsource_work_movements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  department_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  order_route_id uuid,
  vendor_resource_id uuid NOT NULL,
  line_allocation_id uuid,
  movement_type text NOT NULL,
  qty integer NOT NULL,
  qty_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  linked_send_id uuid,
  challan_number text,
  notes text,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  logged_by uuid,
  idempotency_key text,
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.process_flows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  steps jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  factory_id uuid NOT NULL,
  full_name text,
  email text,
  user_role text DEFAULT 'operator'::text NOT NULL,
  floor_pin text,
  status text DEFAULT 'Active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  department_id uuid,
  can_produce boolean NOT NULL,
  handover_enabled boolean NOT NULL,
  workforce_enabled boolean NOT NULL,
  audit_enabled boolean NOT NULL,
  shipment_qa_enabled boolean NOT NULL,
  preferred_resource_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.rejections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  size text,
  qty integer NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  stage text NOT NULL,
  rejected_date date DEFAULT CURRENT_DATE NOT NULL,
  notes text,
  logged_by uuid,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  defect_summary jsonb DEFAULT '{}'::jsonb,
  rejected_qty_by_size jsonb DEFAULT '{}'::jsonb,
  image_urls text[] DEFAULT '{}'::text[],
  order_route_id uuid,
  visit_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  name text NOT NULL,
  type text DEFAULT 'Regular'::text NOT NULL,
  start_time time without time zone,
  end_time time without time zone,
  break_start time without time zone,
  break_end time without time zone,
  hours jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  productive_mins numeric DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.shipment_audits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid NOT NULL,
  audit_type text NOT NULL,
  audit_date date DEFAULT CURRENT_DATE NOT NULL,
  lot_size integer NOT NULL,
  sample_size integer NOT NULL,
  aql_level text,
  passed integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  major_failed integer DEFAULT 0 NOT NULL,
  minor_failed integer DEFAULT 0 NOT NULL,
  result text,
  pieces_json jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'completed'::text NOT NULL,
  notes text,
  logged_by uuid NOT NULL,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  reaudit_of uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  order_id uuid NOT NULL,
  colorway_id uuid,
  po_number text,
  shipped_qty integer NOT NULL,
  shipment_date date DEFAULT CURRENT_DATE NOT NULL,
  invoice_number text,
  awb_number text,
  destination text,
  shipment_type text NOT NULL,
  notes text,
  logged_by uuid,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  shipped_qty_by_size jsonb DEFAULT '{}'::jsonb NOT NULL,
  order_route_id uuid,
  visit_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.size_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  buyer_id uuid,
  name text NOT NULL,
  sizes jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.style_orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  internal_order_no text,
  style_name text NOT NULL,
  style_ref text,
  buyer_id uuid,
  buyer_name text,
  po_number text DEFAULT ''::text NOT NULL,
  order_qty integer DEFAULT 0 NOT NULL,
  adj_qty integer DEFAULT 0 NOT NULL,
  order_date date,
  job_card_date date,
  season text,
  garment_type text,
  sewing_sam numeric(8,2),
  priority text DEFAULT 'normal'::text NOT NULL,
  order_type text DEFAULT 'new'::text NOT NULL,
  merchant_name text,
  size_group_name text,
  size_labels text,
  current_dept text,
  status text DEFAULT 'Not Started'::text NOT NULL,
  image_url text,
  remarks text,
  cutting_allowance numeric(5,2) DEFAULT 2 NOT NULL,
  shipment_allowance numeric(5,2) DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.support_dropdowns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  category text NOT NULL,
  app_name text,
  values jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.workforce_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  factory_id uuid NOT NULL,
  department_id uuid NOT NULL,
  shift_id uuid,
  log_date date DEFAULT CURRENT_DATE NOT NULL,
  logged_by uuid,
  logged_at timestamp with time zone DEFAULT now() NOT NULL,
  headcount_by_category jsonb DEFAULT '{}'::jsonb NOT NULL,
  resource_id uuid,
  line_allocation_id uuid,
  visit_id uuid,
  colorway_id uuid,
  order_route_id uuid,
  order_id uuid,
  PRIMARY KEY (id)
);

-- Indexes
CREATE UNIQUE INDEX app_configuration_factory_id_step_type_key ON public.app_configuration USING btree (factory_id, step_type);

CREATE INDEX assigned_resources_factory_dept_idx ON public.assigned_resources USING btree (factory_id, department_id);

CREATE UNIQUE INDEX assigned_resources_outsource_name_uidx ON public.assigned_resources USING btree (department_id, lower(resource_name)) WHERE ((resource_type = 'outsourced'::text) AND (status = 'active'::text));

CREATE INDEX audit_sessions_factory_dept_logged_at_idx ON public.audit_sessions USING btree (factory_id, department_id, logged_at);

CREATE INDEX audit_sessions_factory_order_colorway_dept_date_idx ON public.audit_sessions USING btree (factory_id, order_id, colorway_id, department_id, logged_at DESC) WHERE (colorway_id IS NOT NULL);

CREATE INDEX audit_sessions_operation_idx ON public.audit_sessions USING btree (factory_id, order_id, colorway_id, order_route_id);

CREATE UNIQUE INDEX idx_audit_sessions_one_pause_per_user ON public.audit_sessions USING btree (factory_id, order_id, colorway_id, department_id, resource_id, logged_by) WHERE (status = 'in_progress'::text);

CREATE INDEX idx_audit_sessions_order_colorway ON public.audit_sessions USING btree (factory_id, order_id, colorway_id, logged_at DESC);

CREATE INDEX batch_production_dept_date_idx ON public.batch_production USING btree (factory_id, department_id, log_date);

CREATE INDEX batch_production_resource_date_idx ON public.batch_production USING btree (factory_id, resource_id, log_date);

CREATE INDEX batch_production_route_idx ON public.batch_production USING btree (factory_id, order_id, colorway_id, order_route_id);

CREATE INDEX idx_batch_production_factory_logged ON public.batch_production USING btree (factory_id, logged_at DESC);

CREATE INDEX idx_batch_production_order_route ON public.batch_production USING btree (factory_id, order_id, colorway_id, order_route_id, resource_id, log_date);

CREATE INDEX idx_batch_production_shift ON public.batch_production USING btree (factory_id, shift_id, log_date);

CREATE INDEX colorways_factory_idx ON public.colorways USING btree (factory_id);

CREATE INDEX colorways_order_idx ON public.colorways USING btree (order_id);

CREATE INDEX idx_colorways_factory_id ON public.colorways USING btree (factory_id);

CREATE INDEX idx_colorways_order_id ON public.colorways USING btree (order_id);

CREATE INDEX idx_control_panel_audit_logs_created_at ON public.control_panel_audit_logs USING btree (created_at DESC);

CREATE INDEX idx_control_panel_audit_logs_factory_id ON public.control_panel_audit_logs USING btree (factory_id);

CREATE UNIQUE INDEX idx_cutting_bundles_factory_bundle_no ON public.cutting_bundles USING btree (factory_id, bundle_no);

CREATE INDEX idx_cutting_bundles_lay ON public.cutting_bundles USING btree (lay_id);

CREATE INDEX idx_cutting_bundles_session ON public.cutting_bundles USING btree (session_id);

CREATE UNIQUE INDEX cutting_lays_lay_unique ON public.cutting_lays USING btree (lot_id, lay_no);

CREATE INDEX idx_cutting_lays_lot ON public.cutting_lays USING btree (lot_id);

CREATE INDEX idx_cutting_lays_session ON public.cutting_lays USING btree (session_id);

CREATE INDEX idx_cutting_session_lots_session ON public.cutting_session_lots USING btree (session_id);

CREATE UNIQUE INDEX idx_cutting_session_lots_unique ON public.cutting_session_lots USING btree (factory_id, session_id, lot_no);

CREATE INDEX idx_cutting_sessions_factory_logged ON public.cutting_sessions USING btree (factory_id, logged_at DESC);

CREATE UNIQUE INDEX idx_cutting_sessions_factory_order_session ON public.cutting_sessions USING btree (factory_id, order_id, colorway_id, session_no);

CREATE INDEX idx_cutting_sessions_resource ON public.cutting_sessions USING btree (factory_id, resource_id, order_id);

CREATE UNIQUE INDEX dashboard_configs_access_token_key ON public.dashboard_configs USING btree (access_token);

CREATE INDEX dashboard_configs_token_idx ON public.dashboard_configs USING btree (access_token) WHERE is_active;

CREATE INDEX defects_department_id_idx ON public.defects USING btree (department_id);

CREATE UNIQUE INDEX defects_factory_id_department_id_key ON public.defects USING btree (factory_id, department_id);

CREATE INDEX defects_factory_id_idx ON public.defects USING btree (factory_id);

CREATE UNIQUE INDEX dept_workforce_rates_current_uidx ON public.department_workforce_rates USING btree (department_id, label, shift_id) WHERE (is_current = true);

CREATE INDEX idx_dept_workforce_rates_dept_current ON public.department_workforce_rates USING btree (department_id) WHERE (is_current = true);

CREATE UNIQUE INDEX departments_factory_id_name_key ON public.departments USING btree (factory_id, name);

CREATE INDEX departments_factory_sequence_idx ON public.departments USING btree (factory_id, sequence);

CREATE INDEX fabric_components_dept_idx ON public.fabric_components USING btree (department_id);

CREATE INDEX fabric_components_factory_created_idx ON public.fabric_components USING btree (factory_id, created_at);

CREATE UNIQUE INDEX fabric_components_factory_id_code_key ON public.fabric_components USING btree (factory_id, code);

CREATE INDEX fabric_components_factory_idx ON public.fabric_components USING btree (factory_id);

CREATE UNIQUE INDEX fabric_components_primary_uidx ON public.fabric_components USING btree (factory_id) WHERE is_primary;

CREATE INDEX idx_fabric_components_factory_id_is_active ON public.fabric_components USING btree (factory_id, is_active);

CREATE UNIQUE INDEX factories_code_key ON public.factories USING btree (code);

CREATE UNIQUE INDEX floor_user_access_unified_profile_operation_key ON public.floor_user_access USING btree (profile_id, operation_id) NULLS NOT DISTINCT;

CREATE INDEX idx_floor_user_access_current_profile ON public.floor_user_access USING btree (profile_id) WHERE (grant_ended_at IS NULL);

CREATE INDEX idx_floor_user_access_factory ON public.floor_user_access USING btree (factory_id);

CREATE INDEX idx_floor_user_access_operation ON public.floor_user_access USING btree (operation_id) WHERE (operation_id IS NOT NULL);

CREATE INDEX idx_floor_user_access_profile ON public.floor_user_access USING btree (profile_id);

CREATE INDEX handover_slips_factory_order_idx ON public.handover_slips USING btree (factory_id, order_id);

CREATE INDEX handover_slips_from_allocation_idx ON public.handover_slips USING btree (from_line_allocation_id) WHERE (from_line_allocation_id IS NOT NULL);

CREATE INDEX idx_handover_slips_factory_order_colorway ON public.handover_slips USING btree (factory_id, order_id, colorway_id);

CREATE INDEX hourly_counts_factory_log_date_idx ON public.hourly_counts USING btree (factory_id, log_date);

CREATE INDEX hourly_counts_line_allocation_idx ON public.hourly_counts USING btree (line_allocation_id) WHERE (line_allocation_id IS NOT NULL);

CREATE INDEX hourly_counts_operation_idx ON public.hourly_counts USING btree (factory_id, order_id, colorway_id, order_route_id);

CREATE INDEX hourly_counts_order_route_idx ON public.hourly_counts USING btree (factory_id, order_id, colorway_id, order_route_id);

CREATE UNIQUE INDEX hourly_counts_slot_unique ON public.hourly_counts USING btree (factory_id, order_id, department_id, COALESCE(colorway_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(order_route_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid), hour_slot, log_date);

CREATE INDEX idx_inspection_sessions_lookup ON public.inspection_sessions USING btree (factory_id, order_id, department_id, log_date);

CREATE INDEX idx_inspection_sessions_resource ON public.inspection_sessions USING btree (resource_id, log_date);

CREATE INDEX inspection_sessions_line_allocation_idx ON public.inspection_sessions USING btree (line_allocation_id) WHERE (line_allocation_id IS NOT NULL);

CREATE INDEX inspection_sessions_operation_idx ON public.inspection_sessions USING btree (factory_id, order_id, colorway_id, order_route_id);

CREATE UNIQUE INDEX inspection_sessions_slot_unique ON public.inspection_sessions USING btree (factory_id, order_id, department_id, log_date, COALESCE(hour_slot, ''::text), COALESCE(colorway_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX la_colorway_idx ON public.line_allocations USING btree (colorway_id);

CREATE INDEX la_date_idx ON public.line_allocations USING btree (start_date, end_date);

CREATE INDEX la_factory_idx ON public.line_allocations USING btree (factory_id);

CREATE INDEX la_order_color_visit_idx ON public.line_allocations USING btree (order_id, colorway_id, visit_id);

CREATE INDEX la_order_idx ON public.line_allocations USING btree (order_id);

CREATE INDEX la_order_visit_idx ON public.line_allocations USING btree (order_id, visit_id);

CREATE INDEX la_visit_idx ON public.line_allocations USING btree (visit_id);

CREATE INDEX operations_dept_idx ON public.operations USING btree (department_id);

CREATE UNIQUE INDEX operations_factory_dept_name_active_uidx ON public.operations USING btree (factory_id, department_id, lower(name)) WHERE (is_active = true);

CREATE INDEX odth_factory_idx ON public.order_delivery_target_history USING btree (factory_id);

CREATE INDEX odth_order_idx ON public.order_delivery_target_history USING btree (order_id);

CREATE INDEX odth_target_idx ON public.order_delivery_target_history USING btree (target_id);

CREATE INDEX odt_date_idx ON public.order_delivery_targets USING btree (target_date);

CREATE INDEX odt_factory_idx ON public.order_delivery_targets USING btree (factory_id);

CREATE UNIQUE INDEX odt_natural_key_idx ON public.order_delivery_targets USING btree (order_id, colorway_id, destination_country, target_date) WHERE (colorway_id IS NOT NULL);

CREATE INDEX odt_order_idx ON public.order_delivery_targets USING btree (order_id);

CREATE INDEX idx_order_routing_steps_dept_id ON public.order_routing_steps USING btree (dept_id);

CREATE INDEX idx_ors_operation_def_id ON public.order_routing_steps USING btree (operation_def_id);

CREATE INDEX ors_factory_idx ON public.order_routing_steps USING btree (factory_id);

CREATE INDEX ors_order_idx ON public.order_routing_steps USING btree (order_id);

CREATE UNIQUE INDEX ors_order_seq_uidx ON public.order_routing_steps USING btree (order_id, seq);

CREATE INDEX ors_order_visit_idx ON public.order_routing_steps USING btree (order_id, visit_id);

CREATE INDEX outsource_work_movements_factory_date_idx ON public.outsource_work_movements USING btree (factory_id, occurred_at DESC);

CREATE UNIQUE INDEX outsource_work_movements_idempotency_uidx ON public.outsource_work_movements USING btree (factory_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (voided_at IS NULL));

CREATE INDEX outsource_work_movements_linked_send_idx ON public.outsource_work_movements USING btree (linked_send_id) WHERE ((linked_send_id IS NOT NULL) AND (voided_at IS NULL));

CREATE INDEX outsource_work_movements_visit_vendor_idx ON public.outsource_work_movements USING btree (factory_id, order_id, visit_id, vendor_resource_id) WHERE (voided_at IS NULL);

CREATE INDEX pf_factory_idx ON public.process_flows USING btree (factory_id);

CREATE INDEX profiles_factory_id_idx ON public.profiles USING btree (factory_id);

CREATE INDEX idx_rejections_operation_id ON public.rejections USING btree (order_route_id);

CREATE INDEX rejections_factory_date_idx ON public.rejections USING btree (factory_id, rejected_date);

CREATE INDEX rejections_factory_order_idx ON public.rejections USING btree (factory_id, order_id);

CREATE INDEX rejections_factory_reason_idx ON public.rejections USING btree (factory_id, reason_code);

CREATE UNIQUE INDEX idx_shipment_audits_one_pause_per_user ON public.shipment_audits USING btree (factory_id, order_id, colorway_id, logged_by) WHERE (status = 'in_progress'::text);

CREATE INDEX idx_shipment_audits_order_colorway ON public.shipment_audits USING btree (factory_id, order_id, colorway_id, logged_at DESC);

CREATE INDEX idx_shipments_operation_id ON public.shipments USING btree (order_route_id);

CREATE INDEX shipments_factory_date_idx ON public.shipments USING btree (factory_id, shipment_date);

CREATE INDEX shipments_factory_order_idx ON public.shipments USING btree (factory_id, order_id);

CREATE INDEX style_orders_buyer_idx ON public.style_orders USING btree (buyer_id);

CREATE INDEX style_orders_factory_idx ON public.style_orders USING btree (factory_id);

CREATE UNIQUE INDEX style_orders_factory_internal_order_no_unique ON public.style_orders USING btree (factory_id, internal_order_no);

CREATE UNIQUE INDEX style_orders_factory_po_number_unique ON public.style_orders USING btree (factory_id, po_number) WHERE (po_number <> ''::text);

CREATE INDEX style_orders_status_idx ON public.style_orders USING btree (status);

CREATE UNIQUE INDEX support_dropdowns_factory_id_category_key ON public.support_dropdowns USING btree (factory_id, category);

CREATE INDEX idx_workforce_logs_resource_id ON public.workforce_logs USING btree (resource_id);

CREATE UNIQUE INDEX workforce_logs_allocation_shift_date_uidx ON public.workforce_logs USING btree (line_allocation_id, shift_id, log_date) WHERE (line_allocation_id IS NOT NULL);

CREATE INDEX workforce_logs_factory_log_date_idx ON public.workforce_logs USING btree (factory_id, log_date);

CREATE INDEX workforce_logs_line_allocation_idx ON public.workforce_logs USING btree (line_allocation_id) WHERE (line_allocation_id IS NOT NULL);

-- Constraints (FK / UNIQUE / CHECK)
ALTER TABLE ONLY public.app_configuration
  ADD CONSTRAINT app_configuration_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_configuration
  ADD CONSTRAINT app_configuration_factory_id_step_type_key UNIQUE (factory_id, step_type);

ALTER TABLE ONLY public.app_configuration
  ADD CONSTRAINT app_configuration_step_type_check CHECK (step_type = ANY (ARRAY['loading'::text, 'produce'::text, 'store'::text, 'outsource'::text]));

ALTER TABLE ONLY public.assigned_resources
  ADD CONSTRAINT assigned_resources_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assigned_resources
  ADD CONSTRAINT assigned_resources_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id);

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_result_check CHECK (result = ANY (ARRAY['pass'::text, 'fail'::text]));

ALTER TABLE ONLY public.audit_sessions
  ADD CONSTRAINT audit_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id);

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_qty_chk CHECK (produced_qty >= 0);

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batch_production
  ADD CONSTRAINT batch_production_time_chk CHECK (end_time > start_time);

ALTER TABLE ONLY public.buyers
  ADD CONSTRAINT buyers_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.colorways
  ADD CONSTRAINT colorways_completion_status_check CHECK (completion_status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'closed'::text]));

ALTER TABLE ONLY public.colorways
  ADD CONSTRAINT colorways_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.colorways
  ADD CONSTRAINT colorways_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.colorways
  ADD CONSTRAINT colorways_shipment_floor_status_check CHECK (shipment_floor_status = ANY (ARRAY['active'::text, 'ready_to_ship'::text, 'shipped_closed'::text, 'reaudit_open'::text]));

ALTER TABLE ONLY public.control_panel_audit_logs
  ADD CONSTRAINT control_panel_audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.control_panel_audit_logs
  ADD CONSTRAINT control_panel_audit_logs_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id);

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_bundle_no_nonempty CHECK (length(TRIM(BOTH FROM bundle_no)) > 0);

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_bundle_sequence_check CHECK (bundle_sequence > 0);

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_check CHECK (piece_to >= piece_from);

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_fabric_component_id_fkey FOREIGN KEY (fabric_component_id) REFERENCES fabric_components(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_handover_slip_id_fkey FOREIGN KEY (handover_slip_id) REFERENCES handover_slips(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_lay_id_fkey FOREIGN KEY (lay_id) REFERENCES cutting_lays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES cutting_session_lots(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_piece_from_check CHECK (piece_from > 0);

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_qty_check CHECK (qty > 0);

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_session_id_fkey FOREIGN KEY (session_id) REFERENCES cutting_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_bundles
  ADD CONSTRAINT cutting_bundles_status_check CHECK (status = ANY (ARRAY['available'::text, 'sent'::text, 'received'::text]));

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_fabric_component_id_fkey FOREIGN KEY (fabric_component_id) REFERENCES fabric_components(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_lay_no_check CHECK (lay_no > 0);

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_lay_unique UNIQUE (lot_id, lay_no);

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES cutting_session_lots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_number_of_plies_check CHECK (number_of_plies IS NULL OR number_of_plies > 0);

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_ply_count_check CHECK (ply_count IS NULL OR ply_count > 0);

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_session_id_fkey FOREIGN KEY (session_id) REFERENCES cutting_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_lays
  ADD CONSTRAINT cutting_lays_total_qty_check CHECK (total_qty >= 0);

ALTER TABLE ONLY public.cutting_session_lots
  ADD CONSTRAINT cutting_session_lots_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_session_lots
  ADD CONSTRAINT cutting_session_lots_lot_no_nonempty CHECK (length(TRIM(BOTH FROM lot_no)) > 0);

ALTER TABLE ONLY public.cutting_session_lots
  ADD CONSTRAINT cutting_session_lots_session_id_fkey FOREIGN KEY (session_id) REFERENCES cutting_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_session_lots
  ADD CONSTRAINT cutting_session_lots_total_qty_check CHECK (total_qty >= 0);

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_end_after_start CHECK (end_time > start_time);

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_fabric_component_id_fkey FOREIGN KEY (fabric_component_id) REFERENCES fabric_components(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id);

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_session_no_nonempty CHECK (length(TRIM(BOTH FROM session_no)) > 0);

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id);

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_total_headcount_check CHECK (total_headcount >= 0);

ALTER TABLE ONLY public.cutting_sessions
  ADD CONSTRAINT cutting_sessions_total_qty_check CHECK (total_qty >= 0);

ALTER TABLE ONLY public.dashboard_configs
  ADD CONSTRAINT dashboard_configs_access_token_key UNIQUE (access_token);

ALTER TABLE ONLY public.dashboard_configs
  ADD CONSTRAINT dashboard_configs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);

ALTER TABLE ONLY public.dashboard_configs
  ADD CONSTRAINT dashboard_configs_dashboard_type_check CHECK (dashboard_type = ANY (ARRAY['floor'::text, 'pm_cabin'::text, 'overall'::text]));

ALTER TABLE ONLY public.dashboard_configs
  ADD CONSTRAINT dashboard_configs_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dashboard_configs
  ADD CONSTRAINT dashboard_configs_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dashboard_configs
  ADD CONSTRAINT dashboard_configs_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dashboard_links
  ADD CONSTRAINT dashboard_links_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.defects
  ADD CONSTRAINT defects_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE ONLY public.defects
  ADD CONSTRAINT defects_factory_id_department_id_key UNIQUE (factory_id, department_id);

ALTER TABLE ONLY public.defects
  ADD CONSTRAINT defects_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id);

ALTER TABLE ONLY public.department_workforce_rates
  ADD CONSTRAINT department_workforce_rates_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.department_workforce_rates
  ADD CONSTRAINT department_workforce_rates_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.department_workforce_rates
  ADD CONSTRAINT department_workforce_rates_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.department_workforce_rates
  ADD CONSTRAINT department_workforce_rates_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES department_workforce_rates(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.departments
  ADD CONSTRAINT departments_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.departments
  ADD CONSTRAINT departments_factory_id_name_key UNIQUE (factory_id, name);

ALTER TABLE ONLY public.departments
  ADD CONSTRAINT departments_planning_mode_check CHECK (planning_mode = ANY (ARRAY['production'::text, 'storage'::text, 'outsource'::text, 'native_cutting'::text, 'native_shipment'::text]));

ALTER TABLE ONLY public.departments
  ADD CONSTRAINT departments_role_chk CHECK (role = ANY (ARRAY['origin'::text, 'standard'::text, 'terminal'::text]));

ALTER TABLE ONLY public.fabric_components
  ADD CONSTRAINT fabric_components_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fabric_components
  ADD CONSTRAINT fabric_components_factory_id_code_key UNIQUE (factory_id, code);

ALTER TABLE ONLY public.fabric_components
  ADD CONSTRAINT fabric_components_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_audit_apps_is_array CHECK (jsonb_typeof(audit_apps) = 'array'::text);

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_code_key UNIQUE (code);

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_default_shift_id_fkey FOREIGN KEY (default_shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_production_apps_is_array CHECK (jsonb_typeof(production_apps) = 'array'::text);

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_shipment_apps_is_array CHECK (jsonb_typeof(shipment_apps) = 'array'::text);

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_transaction_apps_is_array CHECK (jsonb_typeof(transaction_apps) = 'array'::text);

ALTER TABLE ONLY public.factories
  ADD CONSTRAINT factories_workforce_apps_is_array CHECK (jsonb_typeof(workforce_apps) = 'array'::text);

ALTER TABLE ONLY public.floor_user_access
  ADD CONSTRAINT floor_user_access_unified_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.floor_user_access
  ADD CONSTRAINT floor_user_access_unified_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.floor_user_access
  ADD CONSTRAINT floor_user_access_unified_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.floor_user_access
  ADD CONSTRAINT floor_user_access_unified_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.floor_user_access
  ADD CONSTRAINT floor_user_access_unified_profile_operation_key UNIQUE NULLS NOT DISTINCT (profile_id, operation_id);

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id);

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_from_department_id_fkey FOREIGN KEY (from_department_id) REFERENCES departments(id);

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_from_line_allocation_id_fkey FOREIGN KEY (from_line_allocation_id) REFERENCES line_allocations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_loss_closed_by_fkey FOREIGN KEY (loss_closed_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_loss_rejection_id_fkey FOREIGN KEY (loss_rejection_id) REFERENCES rejections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id);

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_received_by_fkey FOREIGN KEY (received_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_status_check CHECK (status = ANY (ARRAY['pending'::text, 'received'::text, 'disputed'::text, 'received_disputed'::text]));

ALTER TABLE ONLY public.handover_slips
  ADD CONSTRAINT handover_slips_to_department_id_fkey FOREIGN KEY (to_department_id) REFERENCES departments(id);

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id);

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id);

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.hourly_counts
  ADD CONSTRAINT hourly_counts_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id);

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id);

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id);

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id);

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id);

ALTER TABLE ONLY public.inspection_sessions
  ADD CONSTRAINT inspection_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id);

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_line_id_fkey FOREIGN KEY (line_id) REFERENCES assigned_resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_qty_nonneg CHECK (qty >= 0);

ALTER TABLE ONLY public.line_allocations
  ADD CONSTRAINT line_allocations_status_check CHECK (status = ANY (ARRAY['planned'::text, 'active'::text, 'completed'::text, 'cancelled'::text]));

ALTER TABLE ONLY public.operations
  ADD CONSTRAINT operations_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.operations
  ADD CONSTRAINT operations_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.operations
  ADD CONSTRAINT operations_step_type_check CHECK (step_type = ANY (ARRAY['loading'::text, 'produce'::text, 'store'::text, 'outsource'::text]));

ALTER TABLE ONLY public.order_delivery_target_history
  ADD CONSTRAINT order_delivery_target_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.order_delivery_target_history
  ADD CONSTRAINT order_delivery_target_history_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.order_delivery_target_history
  ADD CONSTRAINT order_delivery_target_history_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_delivery_target_history
  ADD CONSTRAINT order_delivery_target_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_delivery_target_history
  ADD CONSTRAINT order_delivery_target_history_target_id_fkey FOREIGN KEY (target_id) REFERENCES order_delivery_targets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_delivery_targets
  ADD CONSTRAINT order_delivery_targets_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_delivery_targets
  ADD CONSTRAINT order_delivery_targets_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_delivery_targets
  ADD CONSTRAINT order_delivery_targets_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_routing_steps
  ADD CONSTRAINT order_routing_steps_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES departments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.order_routing_steps
  ADD CONSTRAINT order_routing_steps_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_routing_steps
  ADD CONSTRAINT order_routing_steps_operation_def_id_fkey FOREIGN KEY (operation_def_id) REFERENCES operations(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.order_routing_steps
  ADD CONSTRAINT order_routing_steps_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_routing_steps
  ADD CONSTRAINT order_routing_steps_step_type_check CHECK (step_type = ANY (ARRAY['loading'::text, 'produce'::text, 'store'::text, 'outsource'::text]));

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_linked_send_id_fkey FOREIGN KEY (linked_send_id) REFERENCES outsource_work_movements(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_movement_type_check CHECK (movement_type = ANY (ARRAY['vendor_send'::text, 'vendor_receive'::text]));

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_qty_check CHECK (qty > 0);

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_receive_requires_send CHECK (movement_type = 'vendor_send'::text OR linked_send_id IS NOT NULL);

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_vendor_resource_id_fkey FOREIGN KEY (vendor_resource_id) REFERENCES assigned_resources(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.outsource_work_movements
  ADD CONSTRAINT outsource_work_movements_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.process_flows
  ADD CONSTRAINT process_flows_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profiles
  ADD CONSTRAINT profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.profiles
  ADD CONSTRAINT profiles_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (status = ANY (ARRAY['Active'::text, 'Inactive'::text]));

ALTER TABLE ONLY public.profiles
  ADD CONSTRAINT profiles_user_role_check CHECK (user_role = ANY (ARRAY['superadmin'::text, 'admin'::text, 'quality_manager'::text, 'supervisor'::text, 'auditor'::text, 'operator'::text]));

ALTER TABLE ONLY public.rejections
  ADD CONSTRAINT rejections_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.rejections
  ADD CONSTRAINT rejections_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rejections
  ADD CONSTRAINT rejections_order_id_fkey FOREIGN KEY (order_id) REFERENCES style_orders(id);

ALTER TABLE ONLY public.rejections
  ADD CONSTRAINT rejections_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rejections
  ADD CONSTRAINT rejections_qty_check CHECK (qty > 0);

ALTER TABLE ONLY public.shifts
  ADD CONSTRAINT shifts_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_audit_type_check CHECK (audit_type = ANY (ARRAY['midline'::text, 'internal_final'::text, 'shipment'::text, 'reaudit'::text]));

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id);

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_reaudit_of_fkey FOREIGN KEY (reaudit_of) REFERENCES shipment_audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_result_check CHECK (result IS NULL OR (result = ANY (ARRAY['pass'::text, 'fail'::text])));

ALTER TABLE ONLY public.shipment_audits
  ADD CONSTRAINT shipment_audits_status_check CHECK (status = ANY (ARRAY['in_progress'::text, 'completed'::text]));

ALTER TABLE ONLY public.shipments
  ADD CONSTRAINT shipments_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shipments
  ADD CONSTRAINT shipments_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.shipments
  ADD CONSTRAINT shipments_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.shipments
  ADD CONSTRAINT shipments_shipment_type_check CHECK (shipment_type = ANY (ARRAY['main'::text, 'partial'::text, 'replacement'::text, 'sample'::text, 'rejection_return'::text]));

ALTER TABLE ONLY public.shipments
  ADD CONSTRAINT shipments_shipped_qty_check CHECK (shipped_qty > 0);

ALTER TABLE ONLY public.size_groups
  ADD CONSTRAINT size_groups_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.size_groups
  ADD CONSTRAINT size_groups_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_adj_qty_nonneg CHECK (adj_qty >= 0);

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_factory_internal_order_no_unique UNIQUE (factory_id, internal_order_no);

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_order_qty_nonneg CHECK (order_qty >= 0);

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_order_type_check CHECK (order_type = ANY (ARRAY['new'::text, 'repeat'::text]));

ALTER TABLE ONLY public.style_orders
  ADD CONSTRAINT style_orders_priority_check CHECK (priority = ANY (ARRAY['normal'::text, 'high'::text, 'critical'::text]));

ALTER TABLE ONLY public.support_dropdowns
  ADD CONSTRAINT support_dropdowns_factory_id_category_key UNIQUE (factory_id, category);

ALTER TABLE ONLY public.support_dropdowns
  ADD CONSTRAINT support_dropdowns_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_colorway_id_fkey FOREIGN KEY (colorway_id) REFERENCES colorways(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES factories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_line_allocation_id_fkey FOREIGN KEY (line_allocation_id) REFERENCES line_allocations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_order_route_id_fkey FOREIGN KEY (order_route_id) REFERENCES order_routing_steps(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES assigned_resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workforce_logs
  ADD CONSTRAINT workforce_logs_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

-- Row level security
ALTER TABLE public.app_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assigned_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colorways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_panel_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_lays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_session_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_workforce_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fabric_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handover_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_target_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_routing_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outsource_work_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.size_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.style_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_dropdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_logs ENABLE ROW LEVEL SECURITY;

-- Functions / RPCs
CREATE OR REPLACE FUNCTION public.aggregate_order_cut_qty(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_primary_id uuid;
  v_planned_by_size jsonb;
  v_planned_qty integer;
  v_primary_by_size jsonb;
  v_primary_qty integer;
  v_by_component jsonb;
  v_has_capture boolean;
BEGIN
  v_primary_id := public.get_factory_primary_fabric_component(p_factory_id);

  SELECT
    COALESCE(
      (
        SELECT jsonb_object_agg(elem->>'size', (COALESCE(NULLIF(elem->>'adj_qty', ''), elem->>'order_qty', '0'))::integer)
        FROM jsonb_array_elements(COALESCE(cw.sizes, '[]'::jsonb)) elem
        WHERE COALESCE(elem->>'size', '') <> ''
      ),
      '{}'::jsonb
    ),
    COALESCE(so.adj_qty, so.order_qty, 0)
  INTO v_planned_by_size, v_planned_qty
  FROM public.style_orders so
  LEFT JOIN public.colorways cw
    ON cw.order_id = so.id
   AND cw.factory_id = so.factory_id
   AND (p_colorway_id IS NULL OR cw.id = p_colorway_id)
  WHERE so.factory_id = p_factory_id
    AND so.id = p_order_id
  LIMIT 1;

  v_planned_by_size := COALESCE(v_planned_by_size, '{}'::jsonb);
  v_planned_qty := COALESCE(v_planned_qty, 0);

  -- Resolve every bundle to its ORIGIN visit (same resolution order_dept_progress_rows'
  -- cutting_prod CTE already uses correctly), then per fabric component, keep only
  -- that component's EARLIEST origin visit. A component that re-enters Cutting later
  -- in the routing (e.g. Block Cutting -> Printing -> Fixed Cutting) must not have both
  -- passes summed as if they were separate garments -- they're the same physical pieces.
  WITH route AS (
    SELECT ors.id AS operation_id, ors.seq AS route_seq, ors.visit_id,
           COALESCE(d.role, 'standard') AS dept_role,
           COALESCE(ors.capture_app, CASE WHEN ors.step_type = 'loading' THEN 'hourly' WHEN ors.step_type = 'outsource' THEN 'outsource' ELSE 'transaction' END) AS capture_app,
           COALESCE(ors.is_primary_output, false) AS is_primary_output
    FROM public.order_routing_steps ors
    LEFT JOIN public.departments d ON d.id = ors.dept_id
    WHERE ors.factory_id = p_factory_id AND ors.order_id = p_order_id
  ),
  bundle_resolved AS (
    SELECT
      cb.fabric_component_id AS component_id,
      COALESCE(NULLIF(trim(cb.size), ''), 'TOTAL') AS size_key,
      cb.qty::integer AS qty,
      resolved.operation_id,
      resolved.visit_id,
      resolved.route_seq
    FROM public.cutting_bundles cb
    LEFT JOIN public.cutting_sessions cs ON cs.id = cb.session_id
    JOIN LATERAL (
      SELECT r.operation_id, r.visit_id, r.route_seq
      FROM route r
      WHERE r.dept_role = 'origin'
        AND r.capture_app IN ('cutting_lay', 'cutting_bundle')
        AND (cs.order_route_id IS NULL OR r.operation_id = cs.order_route_id)
      ORDER BY (r.operation_id = cs.order_route_id) DESC, r.is_primary_output DESC, r.route_seq
      LIMIT 1
    ) resolved ON true
    WHERE cb.factory_id = p_factory_id
      AND cb.order_id = p_order_id
      AND (p_colorway_id IS NULL OR cb.colorway_id IS NOT DISTINCT FROM p_colorway_id)
      AND COALESCE(cb.qty, 0) > 0
      AND cb.fabric_component_id IS NOT NULL
  ),
  component_entry_visit AS (
    SELECT DISTINCT ON (br.component_id) br.component_id, br.visit_id AS entry_visit_id
    FROM bundle_resolved br
    ORDER BY br.component_id, br.route_seq ASC
  ),
  bundle_rows AS (
    SELECT br.component_id, br.size_key, br.qty
    FROM bundle_resolved br
    JOIN component_entry_visit cev ON cev.component_id = br.component_id AND cev.entry_visit_id = br.visit_id
  ),
  component_sizes AS (
    SELECT br.component_id, br.size_key, SUM(br.qty)::integer AS qty
    FROM bundle_rows br
    GROUP BY br.component_id, br.size_key
  ),
  component_totals AS (
    SELECT cs.component_id, jsonb_object_agg(cs.size_key, cs.qty) AS by_size, SUM(cs.qty)::integer AS total
    FROM component_sizes cs
    GROUP BY cs.component_id
  )
  SELECT
    EXISTS (SELECT 1 FROM bundle_rows),
    COALESCE(
      (SELECT jsonb_object_agg(cs.size_key, cs.qty) FROM component_sizes cs WHERE cs.component_id = v_primary_id),
      '{}'::jsonb
    ),
    COALESCE(
      (SELECT ct.total FROM component_totals ct WHERE ct.component_id = v_primary_id),
      0
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'component_id', fc.id,
            'fabric_type', fc.fabric_type,
            'is_primary', fc.is_primary,
            'remarks', fc.remarks,
            'by_size', COALESCE(ct.by_size, '{}'::jsonb),
            'total', COALESCE(ct.total, 0)
          )
          ORDER BY fc.created_at, fc.fabric_type
        )
        FROM public.fabric_components fc
        LEFT JOIN component_totals ct ON ct.component_id = fc.id
        WHERE fc.factory_id = p_factory_id
          AND (ct.component_id IS NOT NULL OR fc.id = v_primary_id)
      ),
      '[]'::jsonb
    )
  INTO v_has_capture, v_primary_by_size, v_primary_qty, v_by_component;

  IF v_has_capture AND v_primary_qty > 0 THEN
    RETURN jsonb_build_object(
      'cut_qty', v_primary_qty,
      'cut_qty_by_size', v_primary_by_size,
      'cut_qty_by_component', COALESCE(v_by_component, '[]'::jsonb),
      'cut_qty_source', 'captured'
    );
  END IF;

  RETURN jsonb_build_object(
    'cut_qty', COALESCE(public.jsonb_sum_int_values(v_planned_by_size), v_planned_qty),
    'cut_qty_by_size', v_planned_by_size,
    'cut_qty_by_component', COALESCE(v_by_component, '[]'::jsonb),
    'cut_qty_source', 'planned'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aggregate_top_defects(summaries jsonb[], p_limit integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('defect_name', defect_name, 'count', cnt)
        ORDER BY cnt DESC, defect_name
      )
      FROM (
        SELECT d.k AS defect_name, SUM(d.v::integer) AS cnt
        FROM unnest(COALESCE(summaries, ARRAY[]::jsonb[])) AS s(summary)
        CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.summary, '{}'::jsonb)) AS d(k, v)
        GROUP BY d.k
        ORDER BY cnt DESC, defect_name
        LIMIT GREATEST(COALESCE(p_limit, 7), 1)
      ) ranked
    ),
    '[]'::jsonb
  );
$function$
;

CREATE OR REPLACE FUNCTION public.allocation_grained_batch_agg(p_factory_id uuid, p_order_id uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, qty_produced integer, qty_produced_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    g.factory_id,
    g.order_id,
    g.colorway_id,
    g.operation_id,
    SUM(COALESCE(bp.produced_qty, 0))::integer AS qty_produced,
    public.jsonb_merge_sum_maps(ARRAY_AGG(COALESCE(bp.produced_by_size, '{}'::jsonb))) AS qty_produced_by_size
  FROM public.standard_production_alloc_grid(p_factory_id, p_order_id) g
  JOIN public.batch_production bp
    ON bp.factory_id = g.factory_id
   AND bp.order_id = g.order_id
   AND bp.colorway_id IS NOT DISTINCT FROM g.colorway_id
   AND bp.order_route_id = g.operation_id
   AND bp.line_allocation_id = g.line_allocation_id
  WHERE g.capture_app = 'batch'
    AND COALESCE(bp.produced_qty, 0) > 0
  GROUP BY g.factory_id, g.order_id, g.colorway_id, g.operation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.allocation_grained_hourly_agg(p_factory_id uuid, p_order_id uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, qty_produced integer, qty_produced_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    g.factory_id,
    g.order_id,
    g.colorway_id,
    g.operation_id,
    SUM(h.count)::integer AS qty_produced,
    public.jsonb_merge_sum_maps(ARRAY_AGG(COALESCE(h.count_by_size, '{}'::jsonb))) AS qty_produced_by_size
  FROM public.standard_production_alloc_grid(p_factory_id, p_order_id) g
  JOIN public.hourly_counts h
    ON h.factory_id = g.factory_id
   AND h.order_id = g.order_id
   AND h.colorway_id IS NOT DISTINCT FROM g.colorway_id
   AND h.order_route_id = g.operation_id
   AND h.line_allocation_id = g.line_allocation_id
  WHERE g.capture_app = 'hourly' OR g.step_type IN ('loading', 'produce')
  GROUP BY g.factory_id, g.order_id, g.colorway_id, g.operation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.allocation_grained_outsource_agg(p_factory_id uuid, p_order_id uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, qty_produced integer, qty_produced_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    g.factory_id,
    g.order_id,
    g.colorway_id,
    g.operation_id,
    SUM(owm.qty)::integer AS qty_produced,
    public.jsonb_merge_sum_maps(ARRAY_AGG(
      COALESCE(
        NULLIF(owm.qty_by_size, '{}'::jsonb),
        jsonb_build_object('TOTAL', owm.qty)
      )
    )) AS qty_produced_by_size
  FROM public.standard_production_alloc_grid(p_factory_id, p_order_id) g
  JOIN public.outsource_work_movements owm
    ON owm.factory_id = g.factory_id
   AND owm.order_id = g.order_id
   AND owm.colorway_id IS NOT DISTINCT FROM g.colorway_id
   AND owm.order_route_id = g.operation_id
   AND owm.line_allocation_id = g.line_allocation_id
  WHERE (g.capture_app = 'outsource' OR g.step_type = 'outsource')
    AND owm.movement_type = 'vendor_receive'
    AND owm.voided_at IS NULL
  GROUP BY g.factory_id, g.order_id, g.colorway_id, g.operation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.allocation_grained_qc_agg(p_factory_id uuid, p_order_id uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, qty_produced integer, qty_produced_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    g.factory_id,
    g.order_id,
    g.colorway_id,
    g.operation_id,
    SUM(COALESCE(s.passed, 0))::integer AS qty_produced,
    public.jsonb_merge_sum_maps(ARRAY_AGG(COALESCE(s.passed_by_size, '{}'::jsonb))) AS qty_produced_by_size
  FROM public.standard_production_alloc_grid(p_factory_id, p_order_id) g
  JOIN public.inspection_sessions s
    ON s.factory_id = g.factory_id
   AND s.order_id = g.order_id
   AND s.colorway_id IS NOT DISTINCT FROM g.colorway_id
   AND s.order_route_id = g.operation_id
   AND s.line_allocation_id = g.line_allocation_id
  WHERE g.capture_app IN ('qc_log', 'shipment_qa')
  GROUP BY g.factory_id, g.order_id, g.colorway_id, g.operation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_colorway_allows_production(p_colorway_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_colorway_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT shipment_floor_status INTO v_status
  FROM public.colorways
  WHERE id = p_colorway_id;

  IF v_status IN ('shipped_closed', 'reaudit_open') THEN
    RETURN public.floor_capture_fail(
      'This colorway is closed for production. Use Shipment / QA to re-audit.',
      'COLORWAY_SHIPPED_CLOSED',
      jsonb_build_object('shipmentFloorStatus', v_status)
    );
  END IF;

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_outsource_vendor_resource(p_vendor_resource_id uuid, p_department_id uuid)
 RETURNS assigned_resources
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.assigned_resources%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.assigned_resources ar
  WHERE ar.id = p_vendor_resource_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor resource not found';
  END IF;

  IF v_row.resource_type <> 'outsourced' THEN
    RAISE EXCEPTION 'Resource % is not an outsourced vendor', p_vendor_resource_id;
  END IF;

  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'Vendor resource is not active';
  END IF;

  IF v_row.department_id IS DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'Vendor resource does not belong to this outsource work center';
  END IF;

  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_pieces_defect_lines(pieces_json jsonb)
 RETURNS TABLE(defect_name text, defect_count integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT d.k AS defect_name, SUM(d.v::integer)::integer AS defect_count
  FROM jsonb_array_elements(COALESCE(pieces_json, '[]'::jsonb)) AS piece
  CROSS JOIN LATERAL (
    SELECT key AS k, value AS v
    FROM jsonb_each_text(COALESCE(piece->'majorDefects', '{}'::jsonb))
    UNION ALL
    SELECT key AS k, value AS v
    FROM jsonb_each_text(COALESCE(piece->'minorDefects', '{}'::jsonb))
  ) d
  WHERE d.k IS NOT NULL AND d.k <> ''
  GROUP BY d.k;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_reject_missing_pcs(p_factory_id uuid, p_order_id uuid DEFAULT NULL::uuid, p_colorway_id uuid DEFAULT NULL::uuid, p_visit_id uuid DEFAULT NULL::uuid, p_slip_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_slip public.handover_slips%ROWTYPE;
  v_short_by_size jsonb;
  v_short_total integer;
  v_from_name text;
  v_to_name text;
  v_reason text;
  v_size_key text;
  v_size_qty integer;
  v_already integer;
  v_need integer;
  v_order_route_id uuid;
  v_rejection_id uuid;
  v_visit record;
  v_cw record;
  v_in_map jsonb;
  v_out_map jsonb;
  v_pending_out integer;
  v_dept_name text;
  v_op_name text;
  v_total_in integer;
  v_total_out integer;
  v_total_budget integer;
BEGIN
  FOR v_slip IN
    SELECT hs.* FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id
      AND (p_order_id IS NULL OR hs.order_id = p_order_id)
      AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id)
      AND (p_slip_id IS NULL OR hs.id = p_slip_id)
      AND hs.received_qty IS NOT NULL
      AND hs.sent_qty > COALESCE(hs.received_qty, 0)
      AND hs.status IN ('disputed', 'received_disputed', 'received')
  LOOP
    v_short_by_size := public.handover_short_qty_by_size(
      COALESCE(v_slip.qty_by_size, '{}'::jsonb),
      COALESCE(v_slip.received_qty_by_size, '{}'::jsonb)
    );
    v_short_total := GREATEST(v_slip.sent_qty - COALESCE(v_slip.received_qty, 0), 0);
    IF v_short_by_size = '{}'::jsonb AND v_short_total > 0 THEN
      v_short_by_size := jsonb_build_object('Total', v_short_total);
    END IF;
    SELECT d.name INTO v_from_name FROM public.departments d WHERE d.id = v_slip.from_department_id;
    SELECT d.name INTO v_to_name FROM public.departments d WHERE d.id = v_slip.to_department_id;
    v_reason := format('Missing in transit · %s -> %s',
      COALESCE(NULLIF(trim(v_from_name), ''), 'Sending dept'),
      COALESCE(NULLIF(trim(v_to_name), ''), 'Receiving dept'));
    v_order_route_id := NULL;
    IF v_slip.from_visit_id IS NOT NULL THEN
      SELECT ors.id INTO v_order_route_id FROM public.order_routing_steps ors
      WHERE ors.order_id = v_slip.order_id AND ors.visit_id = v_slip.from_visit_id
      ORDER BY COALESCE(ors.is_dept_exit_operation, false) DESC,
               COALESCE(ors.is_primary_output, false) DESC, ors.seq DESC LIMIT 1;
    END IF;
    FOR v_size_key, v_size_qty IN
      SELECT key, value::integer FROM jsonb_each_text(v_short_by_size) WHERE value::integer > 0
    LOOP
      SELECT COALESCE(SUM(r.qty), 0)::integer INTO v_already FROM public.rejections r
      WHERE r.factory_id = p_factory_id AND r.order_id = v_slip.order_id
        AND r.colorway_id IS NOT DISTINCT FROM v_slip.colorway_id
        AND r.stage = 'handover_transit_loss'
        AND (r.notes ILIKE '%' || COALESCE(v_slip.challan_number, v_slip.id::text) || '%'
          OR (v_slip.loss_rejection_id IS NOT NULL AND r.id = v_slip.loss_rejection_id))
        AND ((NULLIF(v_size_key, 'Total') IS NULL AND r.size IS NULL)
          OR r.size IS NOT DISTINCT FROM NULLIF(v_size_key, 'Total'));
      v_need := GREATEST(v_size_qty - v_already, 0);
      IF v_need <= 0 THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'kind','handover_transit_loss','slip_id',v_slip.id,'size',v_size_key,'qty',v_size_qty,'reason','already_logged'));
        CONTINUE;
      END IF;
      IF p_dry_run THEN
        v_inserted := v_inserted || jsonb_build_array(jsonb_build_object(
          'kind','handover_transit_loss','dry_run',true,'slip_id',v_slip.id,'order_id',v_slip.order_id,
          'colorway_id',v_slip.colorway_id,'size',v_size_key,'qty',v_need,'reason_code',v_reason));
        CONTINUE;
      END IF;
      INSERT INTO public.rejections (
        factory_id, order_id, colorway_id, size, qty, reason_code, reason_detail,
        defect_summary, rejected_qty_by_size, stage, rejected_date, notes, logged_by,
        logged_at, order_route_id, visit_id
      ) VALUES (
        p_factory_id, v_slip.order_id, v_slip.colorway_id, NULLIF(v_size_key,'Total'), v_need,
        v_reason, 'missing', jsonb_build_object(v_reason,v_need), jsonb_build_object(v_size_key,v_need),
        'handover_transit_loss', CURRENT_DATE,
        trim(both from concat_ws(' ', format('[%s %s lost in transit · slip %s]', v_need,
          CASE WHEN v_size_key='Total' THEN 'pcs' ELSE v_size_key END,
          COALESCE(v_slip.challan_number, v_slip.id::text)), '[auto_reject_missing_pcs]')),
        p_user_id, now(), v_order_route_id, v_slip.from_visit_id
      ) RETURNING id INTO v_rejection_id;
      IF v_slip.loss_rejection_id IS NULL THEN
        UPDATE public.handover_slips SET loss_rejection_id = v_rejection_id
        WHERE id = v_slip.id AND loss_rejection_id IS NULL;
      END IF;
      v_inserted := v_inserted || jsonb_build_array(jsonb_build_object(
        'kind','handover_transit_loss','rejection_id',v_rejection_id,'slip_id',v_slip.id,
        'size',v_size_key,'qty',v_need,'reason_code',v_reason));
    END LOOP;
  END LOOP;

  FOR v_visit IN
    SELECT ors.visit_id, ors.order_id, ors.dept_id,
      (ARRAY_AGG(ors.id ORDER BY COALESCE(ors.is_dept_exit_operation,false) DESC,
        COALESCE(ors.is_primary_output,false) DESC, ors.seq DESC))[1] AS exit_route_id,
      (ARRAY_AGG(ors.operation_name ORDER BY COALESCE(ors.is_dept_exit_operation,false) DESC,
        COALESCE(ors.is_primary_output,false) DESC, ors.seq DESC))[1] AS operation_name
    FROM public.order_routing_steps ors
    JOIN public.style_orders so ON so.id = ors.order_id
    WHERE so.factory_id = p_factory_id
      AND (p_order_id IS NULL OR ors.order_id = p_order_id)
      AND (p_visit_id IS NULL OR ors.visit_id = p_visit_id)
      AND ors.visit_id IS NOT NULL
    GROUP BY ors.visit_id, ors.order_id, ors.dept_id
  LOOP
    SELECT COUNT(*)::integer INTO v_pending_out FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id AND hs.order_id = v_visit.order_id
      AND hs.from_visit_id = v_visit.visit_id
      AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id)
      AND hs.status = 'pending';
    IF v_pending_out > 0 THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'kind','dept_process_loss','visit_id',v_visit.visit_id,'reason','outgoing_pending'));
      CONTINUE;
    END IF;
    IF public.auto_reject_missing_pcs_skip_qc_visit(v_visit.order_id, v_visit.visit_id) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'kind','dept_process_loss','visit_id',v_visit.visit_id,'reason','skipped_qc_visit'));
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.handover_slips hs
      WHERE hs.factory_id = p_factory_id AND hs.order_id = v_visit.order_id
        AND hs.from_visit_id = v_visit.visit_id
        AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id)
    ) THEN CONTINUE; END IF;

    FOR v_cw IN
      SELECT DISTINCT hs.colorway_id FROM public.handover_slips hs
      WHERE hs.factory_id = p_factory_id AND hs.order_id = v_visit.order_id
        AND hs.from_visit_id = v_visit.visit_id
        AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id)
    LOOP
      SELECT public.jsonb_sum_size_maps(ARRAY_AGG(COALESCE(hs.received_qty_by_size,'{}'::jsonb)))
      INTO v_in_map FROM public.handover_slips hs
      WHERE hs.factory_id = p_factory_id AND hs.order_id = v_visit.order_id
        AND hs.to_visit_id = v_visit.visit_id AND hs.colorway_id IS NOT DISTINCT FROM v_cw.colorway_id
        AND hs.received_qty IS NOT NULL AND hs.status IN ('received','received_disputed','disputed');
      SELECT public.jsonb_sum_size_maps(ARRAY_AGG(COALESCE(hs.qty_by_size,'{}'::jsonb)))
      INTO v_out_map FROM public.handover_slips hs
      WHERE hs.factory_id = p_factory_id AND hs.order_id = v_visit.order_id
        AND hs.from_visit_id = v_visit.visit_id AND hs.colorway_id IS NOT DISTINCT FROM v_cw.colorway_id;
      v_in_map := COALESCE(v_in_map,'{}'::jsonb);
      v_out_map := COALESCE(v_out_map,'{}'::jsonb);
      IF v_in_map = '{}'::jsonb THEN CONTINUE; END IF;
      SELECT COALESCE(SUM((value)::integer),0)::integer INTO v_total_in FROM jsonb_each_text(v_in_map);
      SELECT COALESCE(SUM((value)::integer),0)::integer INTO v_total_out FROM jsonb_each_text(v_out_map);
      v_total_budget := GREATEST(v_total_in - v_total_out, 0);
      IF v_total_budget <= 0 THEN CONTINUE; END IF;
      v_short_by_size := public.handover_short_qty_by_size(v_in_map, v_out_map);
      IF v_short_by_size = '{}'::jsonb THEN
        v_short_by_size := jsonb_build_object('Total', v_total_budget);
      END IF;
      SELECT d.name INTO v_dept_name FROM public.departments d WHERE d.id = v_visit.dept_id;
      v_op_name := NULLIF(trim(COALESCE(v_visit.operation_name,'')), '');
      v_reason := format('Missing in department · %s%s',
        COALESCE(NULLIF(trim(v_dept_name),''),'Department'),
        CASE WHEN v_op_name IS NOT NULL THEN ' · ' || v_op_name ELSE '' END);
      FOR v_size_key, v_size_qty IN
        SELECT key, value::integer FROM jsonb_each_text(v_short_by_size)
        WHERE value::integer > 0 ORDER BY key
      LOOP
        IF v_total_budget <= 0 THEN EXIT; END IF;
        v_size_qty := LEAST(v_size_qty, v_total_budget);
        SELECT COALESCE(SUM(r.qty),0)::integer INTO v_already FROM public.rejections r
        WHERE r.factory_id = p_factory_id AND r.order_id = v_visit.order_id
          AND r.colorway_id IS NOT DISTINCT FROM v_cw.colorway_id
          AND r.stage = 'dept_process_loss'
          AND r.visit_id IS NOT DISTINCT FROM v_visit.visit_id
          AND ((NULLIF(v_size_key,'Total') IS NULL AND r.size IS NULL)
            OR r.size IS NOT DISTINCT FROM NULLIF(v_size_key,'Total'));
        v_need := GREATEST(LEAST(v_size_qty - v_already, v_total_budget), 0);
        IF v_need <= 0 THEN
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'kind','dept_process_loss','visit_id',v_visit.visit_id,'size',v_size_key,'qty',v_size_qty,'reason','already_logged'));
          CONTINUE;
        END IF;
        v_total_budget := v_total_budget - v_need;
        IF p_dry_run THEN
          v_inserted := v_inserted || jsonb_build_array(jsonb_build_object(
            'kind','dept_process_loss','dry_run',true,'visit_id',v_visit.visit_id,
            'order_id',v_visit.order_id,'colorway_id',v_cw.colorway_id,
            'size',v_size_key,'qty',v_need,'reason_code',v_reason));
          CONTINUE;
        END IF;
        INSERT INTO public.rejections (
          factory_id, order_id, colorway_id, size, qty, reason_code, reason_detail,
          defect_summary, rejected_qty_by_size, stage, rejected_date, notes, logged_by,
          logged_at, order_route_id, visit_id
        ) VALUES (
          p_factory_id, v_visit.order_id, v_cw.colorway_id, NULLIF(v_size_key,'Total'), v_need,
          v_reason, 'missing', jsonb_build_object(v_reason,v_need), jsonb_build_object(v_size_key,v_need),
          'dept_process_loss', CURRENT_DATE,
          format('[%s %s retained in %s · visit auto-tracked]', v_need,
            CASE WHEN v_size_key='Total' THEN 'pcs' ELSE v_size_key END,
            COALESCE(NULLIF(trim(v_dept_name),''),'department')),
          p_user_id, now(), v_visit.exit_route_id, v_visit.visit_id
        ) RETURNING id INTO v_rejection_id;
        v_inserted := v_inserted || jsonb_build_array(jsonb_build_object(
          'kind','dept_process_loss','rejection_id',v_rejection_id,'visit_id',v_visit.visit_id,
          'size',v_size_key,'qty',v_need,'reason_code',v_reason));
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run,
    'inserted_count', jsonb_array_length(v_inserted),
    'skipped_count', jsonb_array_length(v_skipped),
    'inserted', v_inserted, 'skipped', v_skipped);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_reject_missing_pcs_skip_qc_visit(p_order_id uuid, p_visit_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.order_routing_steps ors
    WHERE ors.order_id = p_order_id
      AND ors.visit_id = p_visit_id
      AND COALESCE(ors.capture_app, '') = 'qc_log'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.batch_production_apply_kpi()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kpi record;
  v_size_sum integer;
BEGIN
  NEW.duration_mins := ROUND(
    EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60.0,
    2
  );
  NEW.worker_count := public.jsonb_sum_int_values(COALESCE(NEW.headcount_by_category, '{}'::jsonb));

  NEW.available_mins := ROUND(
    COALESCE(NEW.worker_count, 0)::numeric * COALESCE(NEW.duration_mins, 0),
    2
  );

  v_size_sum := public.jsonb_sum_int_values(COALESCE(NEW.produced_by_size, '{}'::jsonb));
  IF v_size_sum > 0 AND NEW.produced_qty IS DISTINCT FROM v_size_sum THEN
    NEW.produced_qty := v_size_sum;
  END IF;

  SELECT * INTO v_kpi
  FROM public.lookup_line_allocation_kpi(
    NEW.factory_id,
    NEW.order_id,
    NEW.colorway_id,
    NEW.department_id,
    NEW.resource_id,
    NEW.log_date,
    NEW.order_route_id
  );

  NEW.sam := COALESCE(v_kpi.sam, 0);
  NEW.produced_mins := ROUND(COALESCE(NEW.produced_qty, 0)::numeric * COALESCE(v_kpi.sam, 0), 2);

  IF COALESCE(NEW.available_mins, 0) > 0 THEN
    NEW.efficiency_pct := ROUND(100.0 * NEW.produced_mins / NEW.available_mins, 2);
  ELSE
    NEW.efficiency_pct := NULL;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.batch_production_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.capture_app_for_route_step(p_factory_id uuid, p_operation_def_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT COALESCE(
        op.capture_app,
        CASE WHEN op.step_type = 'inspect' THEN 'qc_log' END
      )
      FROM public.operations op
      WHERE op.factory_id = p_factory_id
        AND op.id = p_operation_def_id
      LIMIT 1
    ),
    'hourly'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.capture_fill_line_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_route uuid;
  v_alloc uuid;
  v_hour_slot text;
  v_shift uuid;
BEGIN
  -- Hourly only: persist shift_id from hour_slot
  IF TG_TABLE_NAME = 'hourly_counts' THEN
    v_shift := NULLIF(v_row->>'shift_id', '')::uuid;
    v_hour_slot := NULLIF(v_row->>'hour_slot', '');
    IF v_shift IS NULL AND v_hour_slot IS NOT NULL THEN
      NEW.shift_id := public.get_shift_for_hour_slot(NEW.factory_id, v_hour_slot);
      v_row := to_jsonb(NEW);
    END IF;
  END IF;

  IF NULLIF(v_row->>'line_allocation_id', '') IS NOT NULL THEN
     RETURN NEW;
  END IF;

  v_route := public.capture_route_step_id(v_row);
  IF v_route IS NULL THEN
    RETURN NEW;
  END IF;

  v_alloc := public.resolve_line_allocation_id(
    NEW.order_id,
    NULLIF(v_row->>'colorway_id', '')::uuid,
    NULLIF(v_row->>'resource_id', '')::uuid,
    v_route
  );

  IF v_alloc IS NOT NULL THEN
    NEW.line_allocation_id := v_alloc;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.capture_matches_alloc_grid(p_capture_route_id uuid, p_capture_alloc_id uuid, p_capture_dept_id uuid, p_grid_route_id uuid, p_grid_alloc_id uuid, p_grid_dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT
    p_capture_route_id = p_grid_route_id
    AND p_capture_alloc_id = p_grid_alloc_id;
$function$
;

CREATE OR REPLACE FUNCTION public.capture_route_step_id(p_row jsonb)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(p_row->>'order_route_id', '')::uuid,
    NULLIF(p_row->>'operation_id', '')::uuid,
    NULLIF(p_row->>'flow_step_id', '')::uuid
  );
$function$
;

CREATE OR REPLACE FUNCTION public.colorway_planned_by_size(p_colorway_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(
        elem->>'size',
        COALESCE(
          NULLIF(elem->>'plannedQty', '')::integer,
          NULLIF(elem->>'adj_qty', '')::integer,
          NULLIF(elem->>'qty', '')::integer,
          0
        )
      )
      FROM public.colorways cw
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cw.sizes, '[]'::jsonb)) AS elem
      WHERE cw.id = p_colorway_id
    ),
    '{}'::jsonb
  );
$function$
;

CREATE OR REPLACE FUNCTION public.compute_capture_session_kpi(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_resource_id uuid, p_log_date date, p_order_route_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_headcount_by_category jsonb, p_produced_qty integer)
 RETURNS TABLE(duration_mins numeric, worker_count integer, available_mins numeric, sam numeric, produced_mins numeric, efficiency_pct numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_duration numeric;
  v_workers integer;
  v_available numeric;
  v_kpi record;
  v_sam numeric;
  v_produced numeric;
  v_eff numeric;
BEGIN
  v_duration := ROUND(
    EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60.0,
    2
  );
  v_workers := public.jsonb_sum_int_values(COALESCE(p_headcount_by_category, '{}'::jsonb));
  v_available := ROUND(
    COALESCE(v_workers, 0)::numeric * COALESCE(v_duration, 0),
    2
  );

  SELECT * INTO v_kpi
  FROM public.lookup_line_allocation_kpi(
    p_factory_id,
    p_order_id,
    p_colorway_id,
    p_department_id,
    p_resource_id,
    p_log_date,
    p_order_route_id
  );

  v_sam := COALESCE(v_kpi.sam, 0);
  v_produced := ROUND(COALESCE(p_produced_qty, 0)::numeric * v_sam, 2);

  IF COALESCE(v_available, 0) > 0 THEN
    v_eff := ROUND(100.0 * v_produced / v_available, 2);
  ELSE
    v_eff := NULL;
  END IF;

  duration_mins := v_duration;
  worker_count := v_workers;
  available_mins := v_available;
  sam := v_sam;
  produced_mins := v_produced;
  efficiency_pct := v_eff;
  RETURN NEXT;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_inspection_session_kpi(p_total_inspected integer, p_passed integer, p_failed integer, p_rework_passed integer, p_passed_by_size jsonb, p_rework_by_size jsonb, p_defect_summary jsonb)
 RETURNS TABLE(first_time_pass integer, first_time_pass_by_size jsonb, ftr_pct numeric, defective_pct numeric, dhu numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ftp integer;
  v_ftp_by_size jsonb;
  v_defects integer;
  v_ftr numeric;
  v_def numeric;
  v_dhu numeric;
BEGIN
  v_ftp := GREATEST(COALESCE(p_passed, 0) - COALESCE(p_rework_passed, 0), 0);
  v_ftp_by_size := public.jsonb_map_subtract_nonneg(
    COALESCE(p_passed_by_size, '{}'::jsonb),
    COALESCE(p_rework_by_size, '{}'::jsonb)
  );

  IF COALESCE(p_total_inspected, 0) > 0 THEN
    v_ftr := ROUND(100.0 * v_ftp / p_total_inspected, 2);
    v_def := ROUND(100.0 * COALESCE(p_failed, 0) / p_total_inspected, 2);
    SELECT COALESCE(SUM(v::integer), 0)::integer
    INTO v_defects
    FROM jsonb_each_text(COALESCE(p_defect_summary, '{}'::jsonb)) AS d(k, v);
    v_dhu := ROUND(100.0 * v_defects / p_total_inspected, 2);
  ELSE
    v_ftr := NULL;
    v_def := NULL;
    v_dhu := NULL;
  END IF;

  first_time_pass := v_ftp;
  first_time_pass_by_size := v_ftp_by_size;
  ftr_pct := v_ftr;
  defective_pct := v_def;
  dhu := v_dhu;
  RETURN NEXT;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_factory_floor_user(p_factory_id uuid, p_full_name text, p_email text, p_floor_pin text, p_department_id uuid, p_user_role text DEFAULT 'operator'::text, p_assigned_apps jsonb DEFAULT '[]'::jsonb, p_assigned_operation_ids jsonb DEFAULT '[]'::jsonb, p_status text DEFAULT 'Active'::text, p_handover_enabled boolean DEFAULT NULL::boolean, p_workforce_enabled boolean DEFAULT NULL::boolean, p_audit_enabled boolean DEFAULT NULL::boolean, p_shipment_qa_enabled boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id      uuid;
  v_password     text;
  v_encrypted_pw text;
  v_email        text;
  v_role         text;
  v_handover     boolean;
  v_workforce    boolean;
  v_audit        boolean;
  v_shipment_qa  boolean;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized to create users';
  END IF;
  IF p_factory_id IS NULL OR p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
  IF trim(coalesce(p_full_name, '')) = '' OR trim(coalesce(p_email, '')) = '' THEN
    RAISE EXCEPTION 'Full name and email are required';
  END IF;
  IF length(trim(coalesce(p_floor_pin, ''))) <> 4 THEN
    RAISE EXCEPTION 'PIN must be 4 digits';
  END IF;

  v_email := lower(trim(p_email));
  v_role  := coalesce(nullif(trim(p_user_role), ''), 'operator');
  v_handover := COALESCE(p_handover_enabled, COALESCE(p_assigned_apps, '[]'::jsonb) @> '"transaction"'::jsonb, false);
  v_workforce := COALESCE(p_workforce_enabled, COALESCE(p_assigned_apps, '[]'::jsonb) @> '"supervisor"'::jsonb OR COALESCE(p_assigned_apps, '[]'::jsonb) @> '"workforce"'::jsonb, false);
  v_audit := COALESCE(p_audit_enabled, COALESCE(p_assigned_apps, '[]'::jsonb) @> '"audit"'::jsonb, false);
  v_shipment_qa := COALESCE(
    p_shipment_qa_enabled,
    COALESCE(p_assigned_apps, '[]'::jsonb) ?| array['shipment_log', 'final_rejection_log', 'shipment_audit'],
    false
  );

  IF NOT EXISTS (SELECT 1 FROM public.factories WHERE id = p_factory_id) THEN
    RAISE EXCEPTION 'Factory not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE factory_id = p_factory_id AND lower(email) = v_email) THEN
    RAISE EXCEPTION 'A user with this email already exists in this factory';
  END IF;

  v_user_id  := gen_random_uuid();
  v_password := encode(extensions.gen_random_bytes(32), 'hex');
  v_encrypted_pw := extensions.crypt(v_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, v_encrypted_pw, now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'factory_id', p_factory_id::text, 'user_role', v_role),
    jsonb_build_object('full_name', trim(p_full_name)),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', v_user_id::text, now(), now(), now()
  );

  INSERT INTO public.profiles (id, factory_id, full_name, email, user_role, floor_pin, status)
  VALUES (v_user_id, p_factory_id, trim(p_full_name), v_email, v_role, nullif(trim(p_floor_pin), ''), coalesce(nullif(trim(p_status), ''), 'Active'));

  PERFORM public.replace_floor_user_access(
    v_user_id,
    p_department_id,
    v_handover,
    v_workforce,
    v_audit,
    COALESCE(
      ARRAY(SELECT (elem)::uuid FROM jsonb_array_elements_text(coalesce(p_assigned_operation_ids, '[]'::jsonb)) AS elem WHERE elem ~ '^[0-9a-fA-F-]{36}$'),
      '{}'::uuid[]
    ),
    v_shipment_qa
  );

  RETURN v_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_factory_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT COALESCE(
    NULLIF(
      COALESCE(
        current_setting('request.jwt.claims', true)::jsonb->>'factory_id',
        current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'factory_id',
        current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'factory_id'
      ),
      ''
    )::uuid,
    (SELECT p.factory_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  claims    jsonb;
  v_factory uuid;
  v_role    text;
BEGIN
  claims := event->'claims';
  BEGIN
    SELECT p.factory_id, p.user_role INTO v_factory, v_role
    FROM public.profiles p
    WHERE p.id = (event->>'user_id')::uuid LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN event;
  END;
  IF v_factory IS NOT NULL THEN
    claims := jsonb_set(claims, '{factory_id}', to_jsonb(v_factory::text));
  END IF;
  IF v_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  END IF;
  RETURN jsonb_set(event, '{claims}', claims);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cutting_bundles_fill_fabric_component()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.fabric_component_id IS NULL THEN
    NEW.fabric_component_id := public.resolve_fabric_component_id(NEW.factory_id, NEW.fabric_type);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cutting_component_progress_rows(p_factory_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, visit_id uuid, fabric_component_id uuid, fabric_code text, fabric_type text, is_primary boolean, qty integer, qty_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Deliberately NOT deduplicated across re-entrant cutting visits (unlike
  -- aggregate_order_cut_qty's headline total) -- this answers "what did THIS
  -- specific cutting station actually produce," not "how many distinct garments
  -- exist." Block Cutting and Fixed Cutting on the same order correctly show
  -- their own real, independent numbers here, even when one of them is a
  -- re-cut of the other's output.
  SELECT
    cb.factory_id, cb.order_id, cb.colorway_id,
    cs.order_route_id AS operation_id,
    ors.visit_id,
    cb.fabric_component_id,
    fc.code AS fabric_code,
    fc.fabric_type,
    COALESCE(fc.is_primary, false) AS is_primary,
    SUM(cb.qty)::integer AS qty,
    public.jsonb_merge_sum_maps(ARRAY_AGG(jsonb_build_object(COALESCE(NULLIF(trim(cb.size), ''), 'TOTAL'), cb.qty))) AS qty_by_size
  FROM public.cutting_bundles cb
  LEFT JOIN public.cutting_sessions cs ON cs.id = cb.session_id
  LEFT JOIN public.order_routing_steps ors ON ors.id = cs.order_route_id
  LEFT JOIN public.fabric_components fc ON fc.id = cb.fabric_component_id
  WHERE COALESCE(cb.qty, 0) > 0
    AND cb.fabric_component_id IS NOT NULL
    AND cs.order_route_id IS NOT NULL
    AND (p_factory_id IS NULL OR cb.factory_id = p_factory_id)
    AND (p_order_id IS NULL OR cb.order_id = p_order_id)
  GROUP BY cb.factory_id, cb.order_id, cb.colorway_id, cs.order_route_id, ors.visit_id,
           cb.fabric_component_id, fc.code, fc.fabric_type, fc.is_primary;
$function$
;

CREATE OR REPLACE FUNCTION public.cutting_primary_fabric_type(p_factory_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT NULLIF(trim(fc.fabric_type), '')
      FROM public.fabric_components fc
      WHERE fc.factory_id = p_factory_id
        AND fc.is_primary = true
      ORDER BY fc.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(sd.values->>0), '')
      FROM public.support_dropdowns sd
      WHERE sd.factory_id = p_factory_id
        AND sd.category = 'cutting_fabric_type'
      ORDER BY sd.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    'Shell'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.cutting_refresh_lot_total(p_lot_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.cutting_session_lots l
  SET total_qty = COALESCE((
    SELECT SUM(cl.total_qty)::integer FROM public.cutting_lays cl WHERE cl.lot_id = p_lot_id
  ), 0)
  WHERE l.id = p_lot_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cutting_refresh_session_total(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.cutting_sessions s
  SET total_qty = COALESCE((
    SELECT SUM(l.total_qty)::integer FROM public.cutting_session_lots l WHERE l.session_id = p_session_id
  ), 0)
  WHERE s.id = p_session_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.default_defects_for_department(p_dept_name text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN lower(trim(coalesce(p_dept_name, ''))) LIKE '%cut%' THEN
      '[
        {"category":"Fabric","name":"Shading","code":"CUT-F-01"},
        {"category":"Fabric","name":"Hole","code":"CUT-F-02"},
        {"category":"Fabric","name":"Stain","code":"CUT-F-03"},
        {"category":"Fabric","name":"Weaving fault","code":"CUT-F-04"},
        {"category":"Cutting","name":"Wrong size cut","code":"CUT-C-01"},
        {"category":"Cutting","name":"Missing notch","code":"CUT-C-02"},
        {"category":"Cutting","name":"Overcut","code":"CUT-C-03"},
        {"category":"Cutting","name":"Undercut","code":"CUT-C-04"}
      ]'::jsonb
    WHEN lower(trim(coalesce(p_dept_name, ''))) LIKE '%sew%' THEN
      '[
        {"category":"Stitching","name":"Open seam","code":"SEW-S-01"},
        {"category":"Stitching","name":"Skipped stitch","code":"SEW-S-02"},
        {"category":"Stitching","name":"Broken stitch","code":"SEW-S-03"},
        {"category":"Stitching","name":"Uneven stitch","code":"SEW-S-04"},
        {"category":"Assembly","name":"Wrong label","code":"SEW-A-01"},
        {"category":"Assembly","name":"Missing trim","code":"SEW-A-02"},
        {"category":"Assembly","name":"Puckering","code":"SEW-A-03"},
        {"category":"Assembly","name":"Raw edge","code":"SEW-A-04"}
      ]'::jsonb
    WHEN lower(trim(coalesce(p_dept_name, ''))) LIKE '%finish%' THEN
      '[
        {"category":"Pressing","name":"Shiny mark","code":"FIN-P-01"},
        {"category":"Pressing","name":"Crease mark","code":"FIN-P-02"},
        {"category":"Pressing","name":"Burn mark","code":"FIN-P-03"},
        {"category":"Appearance","name":"Stain","code":"FIN-A-01"},
        {"category":"Appearance","name":"Loose thread","code":"FIN-A-02"},
        {"category":"Appearance","name":"Wrong button","code":"FIN-A-03"},
        {"category":"Appearance","name":"Color bleeding","code":"FIN-A-04"}
      ]'::jsonb
    ELSE
      '[
        {"category":"General","name":"Defect","code":"GEN-01"},
        {"category":"General","name":"Rework needed","code":"GEN-02"}
      ]'::jsonb
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_style_order(p_factory_id uuid, p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_colorway_ids uuid[];
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'factory_id and order_id are required';
  END IF;

  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;

  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized to delete orders';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = p_order_id AND factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
  INTO v_colorway_ids
  FROM public.colorways c
  WHERE c.order_id = p_order_id;

  -- Capture / floor data (explicit delete for tables without CASCADE or without client DELETE policies)
  IF to_regclass('public.inspection_sessions') IS NOT NULL THEN
    DELETE FROM public.inspection_sessions
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.hourly_counts') IS NOT NULL THEN
    DELETE FROM public.hourly_counts
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.handover_slips') IS NOT NULL THEN
    DELETE FROM public.handover_slips
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.inspections') IS NOT NULL THEN
    DELETE FROM public.inspections
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.audit_sessions') IS NOT NULL THEN
    DELETE FROM public.audit_sessions
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.rejections') IS NOT NULL THEN
    DELETE FROM public.rejections
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.shipments') IS NOT NULL THEN
    DELETE FROM public.shipments
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  IF to_regclass('public.order_department_mode') IS NOT NULL THEN
    DELETE FROM public.order_department_mode WHERE order_id = p_order_id;
  END IF;

  IF to_regclass('public.line_allocations') IS NOT NULL THEN
    DELETE FROM public.line_allocations
    WHERE factory_id = p_factory_id
      AND (
        order_id = p_order_id
        OR (cardinality(v_colorway_ids) > 0 AND colorway_id = ANY (v_colorway_ids))
        OR (cardinality(v_colorway_ids) > 0 AND order_id = ANY (v_colorway_ids))
      );
  END IF;

  DELETE FROM public.style_orders
  WHERE id = p_order_id AND factory_id = p_factory_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.department_effective_apps(p_apps jsonb, p_transaction boolean, p_audit boolean, p_supervisor boolean)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE((
    SELECT jsonb_agg(DISTINCT k ORDER BY k)
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(p_apps, '[]'::jsonb)) AS k
      UNION ALL SELECT 'transaction' WHERE COALESCE(p_transaction, true)
      UNION ALL SELECT 'audit' WHERE COALESCE(p_audit, false)
      UNION ALL SELECT 'supervisor' WHERE COALESCE(p_supervisor, false)
    ) s
    WHERE k NOT IN ('workforce', 'workforce_log', 'attendance', 'none', 'none_workforce')
  ), '[]'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.dept_is_floor_production(p_role text, p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE(p_role, 'standard') <> 'terminal'
    AND lower(trim(COALESCE(p_name, ''))) NOT IN ('quality audit', 'shipment');
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_department_defects(p_factory_id uuid, p_department_id uuid, p_default_defects jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing jsonb;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_department_id IS NULL THEN RAISE EXCEPTION 'department_id is required'; END IF;

  SELECT df.defects INTO v_existing
  FROM public.defects df
  WHERE df.department_id = p_department_id AND df.factory_id = p_factory_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF p_default_defects IS NULL OR jsonb_typeof(p_default_defects) <> 'array' OR jsonb_array_length(p_default_defects) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  INSERT INTO public.defects (factory_id, department_id, defects)
  VALUES (p_factory_id, p_department_id, p_default_defects);

  RETURN p_default_defects;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_factory_fabric_components(p_factory_id uuid, p_origin_department_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_factory_id IS NULL OR p_origin_department_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.fabric_components fc WHERE fc.factory_id = p_factory_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.fabric_components (
    factory_id, department_id, code, fabric_type, is_primary
  ) VALUES (
    p_factory_id, p_origin_department_id, 'PRIMARY', 'Primary fabric', true
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.factory_rejection_stage_allowed(p_factory_id uuid, p_stage text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.support_dropdowns sd,
         LATERAL jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(sd.values) = 'array' THEN sd.values
             WHEN sd.values IS NULL THEN '[]'::jsonb
             ELSE sd.values::text::jsonb
           END
         ) AS label
    WHERE sd.factory_id = p_factory_id
      AND sd.category = 'rejection_audit_type'
      AND public.rejection_audit_label_to_stage(label) = p_stage
  );
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture(p_factory_id uuid, p_user_id uuid, p_type text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_existing uuid;
  v_challan text;
  v_po text;
  v_colorway_id uuid;
  v_profile_department_id uuid;
  v_user_role text;
  v_log_date date;
  v_shift_id uuid;
  v_shift_type text;
  v_count integer;
  v_sent_qty integer;
  v_available_wip integer;
  v_slip public.handover_slips%ROWTYPE;
  v_payload_dept uuid;
  v_qty_by_size jsonb;
  v_recv_by_size jsonb;
  v_ship_by_size jsonb;
  v_size_sum integer;
  v_bad_key text;
  v_headcount jsonb;
  v_resource_id uuid;
  v_step_guard jsonb;
  v_operation_id uuid;
  v_ho_guard jsonb;
  v_from_operation_id uuid;
  v_to_operation_id uuid;
  v_prod_guard jsonb;
  v_terminal_op uuid;
  v_from_visit_id uuid;
  v_to_visit_id uuid;
  v_from_line_alloc_id uuid;
  v_order_id2 uuid;
  v_line_alloc_id uuid;
BEGIN
  IF p_factory_id IS NULL OR p_user_id IS NULL THEN
    RETURN public.floor_capture_fail('Invalid session', 'INVALID_SESSION');
  END IF;

  SELECT p.user_role INTO v_user_role
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active';

  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('User profile not found in factory', 'INVALID_SESSION');
  END IF;

  v_profile_department_id := public.floor_user_department_id(p_user_id);

  IF v_profile_department_id IS NULL AND v_user_role NOT IN ('admin', 'superadmin') AND NOT EXISTS (
    SELECT 1 FROM public.floor_user_access fa
    WHERE fa.profile_id = p_user_id AND fa.factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('User access not found in factory', 'INVALID_SESSION');
  END IF;

  -- =========================================================================
  -- HOURLY UPSERT
  -- =========================================================================
  IF p_type = 'hourly_upsert' THEN
    RETURN public.floor_capture_hourly_upsert(p_factory_id, p_user_id, p_payload);
  END IF;

  IF p_type = 'hourly_upsert__legacy_inlined' THEN
    IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'hourly') THEN
      RETURN public.floor_capture_fail('Department not authorized for hourly capture', 'REQUIRE_APP_HOURLY');
    END IF;
    IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
      RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.style_orders WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id) THEN
      RETURN public.floor_capture_fail('Order not found in factory', 'INVALID_ORDER');
    END IF;
    v_payload_dept := (p_payload->>'departmentId')::uuid;
    IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    IF p_payload->>'hourSlot' IS NULL OR btrim(p_payload->>'hourSlot') = '' THEN
      RETURN public.floor_capture_fail('hourSlot is required', 'MISSING_HOUR_SLOT');
    END IF;
    BEGIN
      v_shift_id := public.get_shift_for_hour_slot(p_factory_id, p_payload->>'hourSlot');
    EXCEPTION WHEN OTHERS THEN
      v_shift_id := NULL;
    END;
    IF v_shift_id IS NULL THEN
      RETURN public.floor_capture_fail('hourSlot does not match any active shift slot', 'INVALID_HOUR_SLOT',
        jsonb_build_object('hourSlot', p_payload->>'hourSlot'));
    END IF;
    IF COALESCE(p_payload->'countBySize', '{}'::jsonb) <> '{}'::jsonb THEN
      v_count := public.jsonb_sum_int_values(p_payload->'countBySize');
    ELSE
      BEGIN
        v_count := (p_payload->>'count')::integer;
      EXCEPTION WHEN OTHERS THEN
        RETURN public.floor_capture_fail('count must be an integer', 'INVALID_COUNT');
      END;
    END IF;
    IF v_count IS NULL OR v_count < 0 THEN
      RETURN public.floor_capture_fail('count must be a non-negative integer', 'INVALID_COUNT');
    END IF;
    v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
    IF v_log_date < CURRENT_DATE - 7 THEN
      RETURN public.floor_capture_fail('logDate cannot be more than 7 days in the past', 'BACKFILL_TOO_OLD',
        jsonb_build_object('logDate', v_log_date));
    END IF;
    SELECT s.type INTO v_shift_type FROM public.shifts s WHERE s.id = v_shift_id;
    IF upper(COALESCE(v_shift_type, '')) = 'OT' AND NOT EXISTS (
      SELECT 1 FROM public.workforce_logs wl
      WHERE wl.factory_id = p_factory_id AND wl.department_id = v_profile_department_id
        AND wl.log_date = v_log_date AND wl.shift_id = v_shift_id
        AND public.jsonb_sum_int_values(COALESCE(wl.headcount_by_category, '{}'::jsonb)) > 0
    ) THEN
      RETURN public.floor_capture_fail('OT hourly output requires OT workforce logged for this date',
        'OT_OUTPUT_WITHOUT_WORKFORCE', jsonb_build_object('logDate', v_log_date, 'shiftId', v_shift_id));
    END IF;
    v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
    v_prod_guard := public.assert_colorway_allows_production(v_colorway_id);
    IF v_prod_guard IS NOT NULL THEN RETURN v_prod_guard; END IF;
    v_step_guard := public.floor_resolve_operation_step(
      p_factory_id, p_user_id, v_colorway_id,
      COALESCE(
        NULLIF(p_payload->>'orderRouteId', '')::uuid,
        NULLIF(p_payload->>'operationId', '')::uuid,
        NULLIF(p_payload->>'flowStepId', '')::uuid
      ), 'hourly');
    IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
    v_operation_id := (v_step_guard->>'operation_id')::uuid;
    SELECT id INTO v_existing FROM public.hourly_counts
    WHERE factory_id = p_factory_id AND order_id = (p_payload->>'orderId')::uuid AND department_id = v_payload_dept
      AND COALESCE(colorway_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_colorway_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(NULLIF(p_payload->>'resourceId', '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND hour_slot = p_payload->>'hourSlot' AND log_date = v_log_date
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.hourly_counts
      SET count = v_count, count_by_size = COALESCE(p_payload->'countBySize', '{}'::jsonb),
          logged_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
          shift_id = NULLIF(p_payload->>'shiftId', '')::uuid, resource_id = NULLIF(p_payload->>'resourceId', '')::uuid,
          logged_by = p_user_id, order_route_id = v_operation_id
      WHERE id = v_existing;
      RETURN jsonb_build_object('id', v_existing);
    END IF;
    INSERT INTO public.hourly_counts (
      factory_id, order_id, colorway_id, department_id, resource_id, shift_id,
      hour_slot, log_date, count, count_by_size, logged_by, logged_at, order_route_id
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, v_payload_dept,
      NULLIF(p_payload->>'resourceId', '')::uuid, NULLIF(p_payload->>'shiftId', '')::uuid,
      p_payload->>'hourSlot', v_log_date, v_count, COALESCE(p_payload->'countBySize', '{}'::jsonb),
      p_user_id, COALESCE((p_payload->>'loggedAt')::timestamptz, now()), v_operation_id
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  -- =========================================================================
  -- BATCH UPSERT
  -- =========================================================================
  IF p_type = 'batch_upsert' THEN
    RETURN public.floor_capture_batch_upsert(p_factory_id, p_user_id, p_payload);
  END IF;

  IF p_type = 'batch_upsert__legacy_inlined' THEN
    IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'batch') THEN
      RETURN public.floor_capture_fail('Department not authorized for batch capture', 'REQUIRE_APP_BATCH');
    END IF;
    IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
      RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.style_orders WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id) THEN
      RETURN public.floor_capture_fail('Order not found in factory', 'INVALID_ORDER');
    END IF;
    v_payload_dept := (p_payload->>'departmentId')::uuid;
    IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
    IF p_payload->>'startTime' IS NULL OR p_payload->>'endTime' IS NULL THEN
      RETURN public.floor_capture_fail('startTime and endTime are required', 'MISSING_FIELDS');
    END IF;
    BEGIN
      IF (p_payload->>'endTime')::timestamptz <= (p_payload->>'startTime')::timestamptz THEN
        RETURN public.floor_capture_fail('endTime must be after startTime', 'INVALID_TIME_RANGE');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN public.floor_capture_fail('startTime and endTime must be valid timestamps', 'INVALID_TIME_RANGE');
    END;
    v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
    IF v_log_date < CURRENT_DATE - 7 THEN
      RETURN public.floor_capture_fail('logDate cannot be more than 7 days in the past', 'BACKFILL_TOO_OLD',
        jsonb_build_object('logDate', v_log_date));
    END IF;
    v_headcount := COALESCE(p_payload->'headcountByCategory', '{}'::jsonb);
    IF public.jsonb_sum_int_values(v_headcount) <= 0 THEN
      RETURN public.floor_capture_fail('At least one headcount category must be greater than zero', 'MISSING_HEADCOUNT');
    END IF;
    IF COALESCE(p_payload->'producedBySize', '{}'::jsonb) <> '{}'::jsonb THEN
      v_count := public.jsonb_sum_int_values(p_payload->'producedBySize');
    ELSE
      BEGIN
        v_count := (p_payload->>'producedQty')::integer;
      EXCEPTION WHEN OTHERS THEN
        RETURN public.floor_capture_fail('producedQty must be an integer', 'INVALID_COUNT');
      END;
    END IF;
    IF v_count IS NULL OR v_count <= 0 THEN
      RETURN public.floor_capture_fail('producedQty must be a positive integer', 'INVALID_COUNT');
    END IF;
    IF COALESCE(p_payload->'producedBySize', '{}'::jsonb) <> '{}'::jsonb
       AND public.jsonb_sum_int_values(p_payload->'producedBySize') IS DISTINCT FROM v_count THEN
      RETURN public.floor_capture_fail('producedQty must equal the sum of producedBySize', 'SIZE_TOTAL_MISMATCH');
    END IF;
    IF p_payload->>'orderRouteId' IS NULL AND p_payload->>'flowStepId' IS NULL AND p_payload->>'operationId' IS NULL THEN
      RETURN public.floor_capture_fail('orderRouteId is required', 'MISSING_OPERATION');
    END IF;
    v_step_guard := public.floor_resolve_order_route_step(
      p_factory_id, p_user_id, (p_payload->>'orderId')::uuid,
      COALESCE(NULLIF(p_payload->>'orderRouteId', '')::uuid, NULLIF(p_payload->>'flowStepId', '')::uuid, NULLIF(p_payload->>'operationId', '')::uuid),
      'batch');
    IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
    INSERT INTO public.batch_production (
      factory_id, order_id, colorway_id, order_route_id, department_id, resource_id,
      start_time, end_time, log_date, headcount_by_category, produced_by_size, produced_qty,
      activity_no, ref_no, comment, logged_by, logged_at
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, (v_step_guard->>'order_route_id')::uuid,
      v_payload_dept, NULLIF(p_payload->>'resourceId', '')::uuid,
      (p_payload->>'startTime')::timestamptz, (p_payload->>'endTime')::timestamptz, v_log_date,
      v_headcount, COALESCE(p_payload->'producedBySize', '{}'::jsonb), v_count,
      NULLIF(btrim(p_payload->>'activityNo'), ''), NULLIF(btrim(p_payload->>'refNo'), ''),
      NULLIF(btrim(p_payload->>'comment'), ''), p_user_id, COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    ) RETURNING id, worker_count, duration_mins, available_mins, sam, produced_mins, efficiency_pct
    INTO v_id, v_count, v_sent_qty, v_available_wip, v_shift_type, v_po, v_challan;
    RETURN jsonb_build_object('id', v_id, 'workerCount', v_count, 'durationMins', v_sent_qty, 'availableMins', v_available_wip,
      'sam', v_shift_type, 'producedMins', v_po, 'efficiencyPct', v_challan);
  END IF;

  -- =========================================================================
  -- WORKFORCE UPSERT
  -- =========================================================================
  IF p_type = 'workforce_upsert' THEN
    IF NOT (public.profile_dept_has_app(p_user_id, p_factory_id, 'supervisor')
            OR v_user_role IN ('supervisor', 'admin', 'superadmin', 'quality_manager')) THEN
      RETURN public.floor_capture_fail('Department not authorized for workforce log', 'REQUIRE_APP_WORKFORCE');
    END IF;
    v_payload_dept := (p_payload->>'departmentId')::uuid;
    IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    IF NULLIF(p_payload->>'shiftId', '') IS NULL THEN
      RETURN public.floor_capture_fail('shiftId is required', 'MISSING_SHIFT');
    END IF;
    v_log_date := (p_payload->>'logDate')::date;
    IF v_log_date IS NULL THEN
      RETURN public.floor_capture_fail('logDate is required', 'BACKFILL_TOO_OLD');
    END IF;
    IF v_log_date < CURRENT_DATE - 7 THEN
      RETURN public.floor_capture_fail('logDate cannot be more than 7 days in the past', 'BACKFILL_TOO_OLD',
        jsonb_build_object('logDate', v_log_date));
    END IF;
    v_resource_id := NULLIF(p_payload->>'resourceId', '')::uuid;
    v_headcount := COALESCE(p_payload->'headcountByCategory', '{}'::jsonb);
    IF public.jsonb_sum_int_values(v_headcount) <= 0 THEN
      RETURN public.floor_capture_fail('At least one headcount field must be > 0', 'EMPTY_HEADCOUNT');
    END IF;
    v_order_id2 := NULLIF(p_payload->>'orderId', '')::uuid;
    v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
    v_line_alloc_id := NULLIF(p_payload->>'lineAllocationId', '')::uuid;
    v_operation_id := NULL;
    IF NULLIF(p_payload->>'orderRouteId', '') IS NOT NULL THEN
      IF v_order_id2 IS NULL THEN
        RETURN public.floor_capture_fail('orderId is required with orderRouteId', 'INVALID_ORDER');
      END IF;
      v_step_guard := public.floor_resolve_order_route_step(
        p_factory_id, p_user_id, v_order_id2, NULLIF(p_payload->>'orderRouteId', '')::uuid, NULL, true);
      IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
      v_operation_id := (v_step_guard->>'order_route_id')::uuid;
      IF v_line_alloc_id IS NULL THEN
        v_line_alloc_id := public.resolve_line_allocation_id(v_order_id2, v_colorway_id, v_resource_id, v_operation_id);
      END IF;
    END IF;
    SELECT id INTO v_existing FROM public.workforce_logs
    WHERE factory_id = p_factory_id AND department_id = v_payload_dept AND log_date = v_log_date
      AND shift_id IS NOT DISTINCT FROM NULLIF(p_payload->>'shiftId', '')::uuid
      AND resource_id IS NOT DISTINCT FROM v_resource_id
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.workforce_logs SET resource_id = v_resource_id, headcount_by_category = v_headcount,
        logged_by = p_user_id, logged_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        order_id = COALESCE(v_order_id2, order_id), colorway_id = COALESCE(v_colorway_id, colorway_id),
        order_route_id = COALESCE(v_operation_id, order_route_id),
        line_allocation_id = COALESCE(v_line_alloc_id, line_allocation_id)
      WHERE id = v_existing;
      RETURN jsonb_build_object('id', v_existing);
    END IF;
    INSERT INTO public.workforce_logs (
      factory_id, resource_id, department_id, shift_id, log_date, headcount_by_category, logged_by, logged_at,
      order_id, colorway_id, order_route_id, line_allocation_id
    ) VALUES (
      p_factory_id, v_resource_id, v_payload_dept, NULLIF(p_payload->>'shiftId', '')::uuid, v_log_date, v_headcount, p_user_id, COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
      v_order_id2, v_colorway_id, v_operation_id, v_line_alloc_id
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  -- =========================================================================
  -- HANDOVER SEND (WIP check REMOVED — just records the transaction)
  -- =========================================================================
  IF p_type = 'handover_send' THEN
    IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'transaction') THEN
      RETURN public.floor_capture_fail('Department not authorized for handover', 'REQUIRE_APP_TRANSACTION');
    END IF;
    IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
      RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.style_orders WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id) THEN
      RETURN public.floor_capture_fail('Order not found in factory', 'INVALID_ORDER');
    END IF;
    IF v_profile_department_id IS NULL OR (p_payload->>'fromDepartmentId')::uuid IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('fromDepartmentId must match user department', 'CANT_SEND_FROM_OTHER_DEPT',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = (p_payload->>'toDepartmentId')::uuid AND d.factory_id = p_factory_id) THEN
      RETURN public.floor_capture_fail('Destination department not found', 'INVALID_DESTINATION');
    END IF;
    v_sent_qty := COALESCE((p_payload->>'sentQty')::integer, 0);
    IF v_sent_qty <= 0 THEN
      RETURN public.floor_capture_fail('sentQty must be a positive integer', 'INVALID_QTY');
    END IF;
    v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
    v_ho_guard := public.floor_validate_handover_steps(
      p_factory_id, v_colorway_id,
      COALESCE(NULLIF(p_payload->>'fromOrderRouteId', '')::uuid, NULLIF(p_payload->>'orderRouteId', '')::uuid, NULLIF(p_payload->>'operationId', '')::uuid, NULLIF(p_payload->>'flowStepId', '')::uuid),
      COALESCE(NULLIF(p_payload->>'toOrderRouteId', '')::uuid, NULLIF(p_payload->>'toOperationId', '')::uuid, NULLIF(p_payload->>'toFlowStepId', '')::uuid));
    IF v_ho_guard ? 'error' THEN RETURN v_ho_guard; END IF;
    v_from_operation_id := (v_ho_guard->>'from_operation_id')::uuid;
    v_to_operation_id := (v_ho_guard->>'to_operation_id')::uuid;
    v_from_visit_id := (v_ho_guard->>'from_visit_id')::uuid;
    IF (p_payload->>'toDepartmentId')::uuid IS DISTINCT FROM (v_ho_guard->>'to_department_id')::uuid THEN
      RETURN public.floor_capture_fail('toDepartmentId must match next operation department', 'INVALID_DESTINATION');
    END IF;
    SELECT COALESCE(ors.visit_id, ors.id) INTO v_to_visit_id
    FROM public.order_routing_steps ors WHERE ors.id = v_to_operation_id;
    v_from_line_alloc_id := public.resolve_line_allocation_for_route(
      (p_payload->>'orderId')::uuid, v_colorway_id, v_from_operation_id);
    -- NO WIP CHECK: just record the handover transaction
    v_qty_by_size := COALESCE(p_payload->'qtyBySize', '{}'::jsonb);
    IF v_qty_by_size <> '{}'::jsonb THEN
      v_size_sum := public.jsonb_sum_int_values(v_qty_by_size);
      IF v_size_sum <> v_sent_qty THEN
        RETURN public.floor_capture_fail('qtyBySize sum must equal sentQty', 'SIZE_TOTAL_MISMATCH',
          jsonb_build_object('sentQty', v_sent_qty, 'sizeSum', v_size_sum));
      END IF;
    END IF;
    v_challan := 'CH-' || to_char(now(), 'YYYY') || '-' || upper(substr(md5(random()::text), 1, 5));
    INSERT INTO public.handover_slips (
      factory_id, order_id, colorway_id, from_department_id, to_department_id,
      from_visit_id, to_visit_id, from_line_allocation_id, sent_qty, received_qty, qty_by_size,
      sent_by, sent_at, notes, status, challan_number
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, v_profile_department_id, (p_payload->>'toDepartmentId')::uuid,
      v_from_visit_id, v_to_visit_id, v_from_line_alloc_id, v_sent_qty, NULL, v_qty_by_size,
      p_user_id, COALESCE((p_payload->>'sentAt')::timestamptz, now()), NULLIF(p_payload->>'notes', ''), 'pending', v_challan
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'challanNumber', v_challan);
  END IF;

  -- =========================================================================
  -- HANDOVER RECEIVE (no view dependency)
  -- =========================================================================
  IF p_type = 'handover_receive' THEN
    SELECT * INTO v_slip FROM public.handover_slips WHERE id = (p_payload->>'slipId')::uuid AND factory_id = p_factory_id;
    IF NOT FOUND THEN RETURN public.floor_capture_fail('Handover slip not found', 'SLIP_NOT_FOUND'); END IF;
    IF v_slip.status IS DISTINCT FROM 'pending' THEN RETURN public.floor_capture_fail('Handover slip is not pending', 'SLIP_NOT_PENDING'); END IF;
    IF v_profile_department_id IS NULL OR v_slip.to_department_id IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('Receiving department must match user department', 'CANT_RECEIVE_ELSEWHERE',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    IF COALESCE((p_payload->>'receivedQty')::integer, 0) <= 0 THEN
      RETURN public.floor_capture_fail('receivedQty must be a positive integer', 'INVALID_QTY');
    END IF;
    v_recv_by_size := COALESCE(p_payload->'receivedQtyBySize', '{}'::jsonb);
    IF v_recv_by_size <> '{}'::jsonb THEN
      v_size_sum := public.jsonb_sum_int_values(v_recv_by_size);
      IF v_size_sum <> (p_payload->>'receivedQty')::integer THEN
        RETURN public.floor_capture_fail('receivedQtyBySize sum must equal receivedQty', 'SIZE_TOTAL_MISMATCH',
          jsonb_build_object('receivedQty', (p_payload->>'receivedQty')::integer, 'sizeSum', v_size_sum));
      END IF;
      IF COALESCE(v_slip.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN
        FOR v_bad_key IN SELECT key FROM jsonb_each_text(v_recv_by_size) LOOP
          IF NOT (COALESCE(v_slip.qty_by_size, '{}'::jsonb) ? v_bad_key) THEN
            RETURN public.floor_capture_fail('Receive size not defined on send slip', 'NO_SIZE_DEFINED',
              jsonb_build_object('size', v_bad_key));
          END IF;
        END LOOP;
      END IF;
    END IF;
    IF (p_payload->>'receivedQty')::integer > v_slip.sent_qty THEN
      RETURN public.floor_capture_fail('receivedQty cannot exceed sentQty', 'OVER_RECEIVED',
        jsonb_build_object('sentQty', v_slip.sent_qty, 'receivedQty', (p_payload->>'receivedQty')::integer));
    END IF;
    UPDATE public.handover_slips
    SET received_qty = (p_payload->>'receivedQty')::integer, received_qty_by_size = v_recv_by_size,
        received_by = p_user_id, received_at = now(),
        received_notes = trim(both from concat_ws(' ',
          CASE WHEN (p_payload->>'receivedQty')::integer IS DISTINCT FROM v_slip.sent_qty
            OR (v_recv_by_size <> '{}'::jsonb AND COALESCE(v_slip.qty_by_size, '{}'::jsonb) <> '{}'::jsonb
                AND v_recv_by_size IS DISTINCT FROM COALESCE(v_slip.qty_by_size, '{}'::jsonb))
            THEN format('[Disputed - %s pcs short]', v_slip.sent_qty - (p_payload->>'receivedQty')::integer) END,
          NULLIF(p_payload->>'notes', ''))),
        status = CASE WHEN (p_payload->>'receivedQty')::integer IS DISTINCT FROM v_slip.sent_qty
            OR (v_recv_by_size <> '{}'::jsonb AND COALESCE(v_slip.qty_by_size, '{}'::jsonb) <> '{}'::jsonb
                AND v_recv_by_size IS DISTINCT FROM COALESCE(v_slip.qty_by_size, '{}'::jsonb))
          THEN 'disputed' ELSE 'received' END
    WHERE id = v_slip.id;
    RETURN jsonb_build_object('ok', true, 'disputed', (SELECT status = 'disputed' FROM public.handover_slips WHERE id = v_slip.id));
  END IF;

  -- =========================================================================
  -- AUDIT SESSION
  -- =========================================================================
  IF p_type = 'audit_session' THEN
    RETURN public.floor_capture_audit_session(p_payload, p_factory_id, p_user_id);
  END IF;

  -- =========================================================================
  -- REJECTION LOG
  -- =========================================================================
  IF p_type = 'rejection_log' THEN
    RETURN public.floor_capture_shipment_rejection_log(p_payload, p_factory_id, p_user_id);
  END IF;

  -- =========================================================================
  -- SHIPMENT LOG
  -- =========================================================================
  IF p_type = 'shipment_log' THEN
    IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
      RETURN public.floor_capture_fail('Department not authorized for shipment log', 'APP_NOT_ALLOWED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.style_orders WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id) THEN
      RETURN public.floor_capture_fail('Order not found in factory', 'ORDER_NOT_FOUND');
    END IF;
    IF COALESCE((p_payload->>'shippedQty')::integer, 0) <= 0 THEN
      RETURN public.floor_capture_fail('shippedQty must be a positive integer', 'INVALID_QTY');
    END IF;
    IF p_payload->>'shipmentType' IS NULL OR p_payload->>'shipmentType' NOT IN ('main', 'partial', 'replacement', 'sample', 'rejection_return') THEN
      RETURN public.floor_capture_fail('Invalid shipment type', 'INVALID_SHIPMENT_TYPE');
    END IF;
    v_ship_by_size := COALESCE(p_payload->'shippedQtyBySize', '{}'::jsonb);
    IF v_ship_by_size <> '{}'::jsonb THEN
      v_size_sum := public.jsonb_sum_int_values(v_ship_by_size);
      IF v_size_sum <> (p_payload->>'shippedQty')::integer THEN
        RETURN public.floor_capture_fail('shippedQtyBySize sum must equal shippedQty', 'SIZE_TOTAL_MISMATCH',
          jsonb_build_object('shippedQty', (p_payload->>'shippedQty')::integer, 'sizeSum', v_size_sum));
      END IF;
    END IF;
    SELECT po_number INTO v_po FROM public.style_orders WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id;
    SELECT id INTO v_terminal_op FROM public.order_routing_steps
    WHERE order_id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id
    ORDER BY seq DESC LIMIT 1;
    INSERT INTO public.shipments (
      factory_id, order_id, colorway_id, po_number, shipped_qty, shipped_qty_by_size,
      shipment_date, invoice_number, awb_number, destination, shipment_type, notes, logged_by, logged_at, order_route_id
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, NULLIF(p_payload->>'colorwayId', '')::uuid, v_po,
      (p_payload->>'shippedQty')::integer, v_ship_by_size, COALESCE((p_payload->>'shipmentDate')::date, CURRENT_DATE),
      NULLIF(p_payload->>'invoiceNumber', ''), NULLIF(p_payload->>'awbNumber', ''), NULLIF(p_payload->>'destination', ''),
      p_payload->>'shipmentType', NULLIF(p_payload->>'notes', ''), p_user_id, COALESCE((p_payload->>'loggedAt')::timestamptz, now()), v_terminal_op
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  -- =========================================================================
  -- INSPECTION SESSION UPSERT
  -- =========================================================================
  IF p_type = 'inspection_session_upsert' THEN
    RETURN public.floor_capture_inspection_session_upsert(p_factory_id, p_user_id, p_payload);
  END IF;

  IF p_type = 'inspection_session_upsert__legacy_inlined' THEN
    IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'qc_log') THEN
      RETURN public.floor_capture_fail('Department not authorized for QC capture', 'REQUIRE_APP_QC');
    END IF;
    IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
      RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
    END IF;
    v_payload_dept := (p_payload->>'departmentId')::uuid;
    IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
    v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
    v_prod_guard := public.assert_colorway_allows_production(v_colorway_id);
    IF v_prod_guard IS NOT NULL THEN RETURN v_prod_guard; END IF;
    v_step_guard := public.floor_resolve_operation_step(
      p_factory_id, p_user_id, v_colorway_id,
      COALESCE(NULLIF(p_payload->>'orderRouteId', '')::uuid, NULLIF(p_payload->>'operationId', '')::uuid, NULLIF(p_payload->>'flowStepId', '')::uuid),
      'qc_log');
    IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
    v_operation_id := (v_step_guard->>'operation_id')::uuid;
    SELECT id INTO v_existing FROM public.inspection_sessions
    WHERE factory_id = p_factory_id AND order_id = (p_payload->>'orderId')::uuid AND department_id = v_payload_dept
      AND log_date = v_log_date AND hour_slot IS NOT DISTINCT FROM NULLIF(p_payload->>'hourSlot', '')
      AND colorway_id IS NOT DISTINCT FROM v_colorway_id
      AND COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(NULLIF(p_payload->>'resourceId', '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.inspection_sessions SET
        resource_id = NULLIF(p_payload->>'resourceId', '')::uuid, shift_id = NULLIF(p_payload->>'shiftId', '')::uuid,
        total_inspected = COALESCE((p_payload->>'totalInspected')::integer, 0), passed = COALESCE((p_payload->>'passed')::integer, 0),
        failed = COALESCE((p_payload->>'failed')::integer, 0), rework_passed = COALESCE((p_payload->>'reworkPassed')::integer, 0),
        passed_by_size = COALESCE(p_payload->'passedBySize', '{}'::jsonb), failed_by_size = COALESCE(p_payload->'failedBySize', '{}'::jsonb),
        rework_by_size = COALESCE(p_payload->'reworkBySize', '{}'::jsonb), defect_summary = COALESCE(p_payload->'defectSummary', '{}'::jsonb),
        started_at = COALESCE((p_payload->>'startedAt')::timestamptz, started_at), ended_at = COALESCE((p_payload->>'endedAt')::timestamptz, now()),
        logged_by = p_user_id, logged_at = now(), order_route_id = v_operation_id
      WHERE id = v_existing;
      RETURN jsonb_build_object('id', v_existing);
    END IF;
    INSERT INTO public.inspection_sessions (
      factory_id, order_id, colorway_id, department_id, resource_id, shift_id,
      hour_slot, log_date, total_inspected, passed, failed, rework_passed,
      passed_by_size, failed_by_size, rework_by_size, defect_summary,
      started_at, ended_at, logged_by, logged_at, order_route_id
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, v_payload_dept,
      NULLIF(p_payload->>'resourceId', '')::uuid, NULLIF(p_payload->>'shiftId', '')::uuid,
      NULLIF(p_payload->>'hourSlot', ''), v_log_date, COALESCE((p_payload->>'totalInspected')::integer, 0),
      COALESCE((p_payload->>'passed')::integer, 0), COALESCE((p_payload->>'failed')::integer, 0), COALESCE((p_payload->>'reworkPassed')::integer, 0),
      COALESCE(p_payload->'passedBySize', '{}'::jsonb), COALESCE(p_payload->'failedBySize', '{}'::jsonb),
      COALESCE(p_payload->'reworkBySize', '{}'::jsonb), COALESCE(p_payload->'defectSummary', '{}'::jsonb),
      COALESCE((p_payload->>'startedAt')::timestamptz, now()), COALESCE((p_payload->>'endedAt')::timestamptz, now()),
      p_user_id, now(), v_operation_id
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  -- =========================================================================
  -- ALLOCATION COMPLETE / REOPEN
  -- =========================================================================
  IF p_type = 'allocation_complete' THEN
    IF p_payload->>'orderId' IS NULL OR p_payload->>'resourceId' IS NULL OR p_payload->>'departmentId' IS NULL THEN
      RETURN public.floor_capture_fail('orderId, resourceId and departmentId are required', 'MISSING_FIELDS');
    END IF;
    IF v_profile_department_id IS NULL OR (p_payload->>'departmentId')::uuid IS DISTINCT FROM v_profile_department_id THEN
      RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH',
        jsonb_build_object('expectedDepartmentId', v_profile_department_id));
    END IF;
    RETURN public.floor_capture_allocation_complete(p_payload || jsonb_build_object('factoryId', p_factory_id, 'userId', p_user_id));
  END IF;

  IF p_type = 'allocation_reopen' THEN
    IF p_payload->>'orderId' IS NULL OR p_payload->>'resourceId' IS NULL THEN
      RETURN public.floor_capture_fail('orderId and resourceId are required', 'MISSING_FIELDS');
    END IF;
    RETURN public.floor_capture_allocation_reopen(p_payload || jsonb_build_object('factoryId', p_factory_id));
  END IF;

  -- =========================================================================
  -- HANDOVER AMEND
  -- =========================================================================
  IF p_type = 'handover_amend' THEN
    RETURN public.floor_capture_handover_amend(p_payload, p_factory_id, p_user_id);
  END IF;

  RETURN public.floor_capture_fail('Unknown capture type', 'UNKNOWN_CAPTURE_TYPE');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_allocation_complete(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factory_id uuid := (p_payload->>'factoryId')::uuid;
  v_user_id uuid := (p_payload->>'userId')::uuid;
  v_allocation_id uuid := NULLIF(p_payload->>'allocationId', '')::uuid;
  v_line_id uuid := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_order_id uuid := (p_payload->>'orderId')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_department_id uuid := (p_payload->>'departmentId')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_completion_type text := COALESCE(NULLIF(p_payload->>'completionType', ''), 'production');
  v_updated integer;
BEGIN
  -- If allocationId is provided, use it directly (most precise)
  IF v_allocation_id IS NOT NULL THEN
    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        production_completed_by = v_user_id,
        production_comments = NULLIF(p_payload->>'comments', ''),
        production_planned_qty = NULLIF(p_payload->>'plannedQty', '')::integer,
        production_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        handover_completed_by = v_user_id,
        handover_comments = NULLIF(p_payload->>'comments', ''),
        handover_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer,
        handover_sent_qty = NULLIF(p_payload->>'sentQty', '')::integer,
        handover_available_qty = NULLIF(p_payload->>'availableQty', '')::integer
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    END IF;
  ELSE
    -- Fallback to composite key with visitId for backward compatibility
    IF v_line_id IS NULL OR v_order_id IS NULL OR v_department_id IS NULL THEN
      RETURN public.floor_capture_fail('allocationId or (resourceId, orderId and departmentId) are required', 'MISSING_FIELDS');
    END IF;

    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        production_completed_by = v_user_id,
        production_comments = NULLIF(p_payload->>'comments', ''),
        production_planned_qty = NULLIF(p_payload->>'plannedQty', '')::integer,
        production_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND department_id = v_department_id
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        handover_completed_by = v_user_id,
        handover_comments = NULLIF(p_payload->>'comments', ''),
        handover_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer,
        handover_sent_qty = NULLIF(p_payload->>'sentQty', '')::integer,
        handover_available_qty = NULLIF(p_payload->>'availableQty', '')::integer
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND department_id = v_department_id
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    END IF;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN public.floor_capture_fail('No matching line allocation found', 'ALLOCATION_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_allocation_reopen(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factory_id uuid := (p_payload->>'factoryId')::uuid;
  v_allocation_id uuid := NULLIF(p_payload->>'allocationId', '')::uuid;
  v_line_id uuid := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_order_id uuid := (p_payload->>'orderId')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_department_id uuid := NULLIF(p_payload->>'departmentId', '')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_completion_type text := COALESCE(NULLIF(p_payload->>'completionType', ''), 'production');
BEGIN
  -- If allocationId is provided, use it directly
  IF v_allocation_id IS NOT NULL THEN
    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = NULL,
        production_completed_by = NULL,
        production_comments = NULL,
        production_planned_qty = NULL,
        production_produced_qty = NULL
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = NULL,
        handover_completed_by = NULL,
        handover_comments = NULL,
        handover_produced_qty = NULL,
        handover_sent_qty = NULL,
        handover_available_qty = NULL
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    END IF;
  ELSE
    -- Fallback to composite key
    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = NULL,
        production_completed_by = NULL,
        production_comments = NULL,
        production_planned_qty = NULL,
        production_produced_qty = NULL
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND (v_department_id IS NULL OR department_id = v_department_id)
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = NULL,
        handover_completed_by = NULL,
        handover_comments = NULL,
        handover_produced_qty = NULL,
        handover_sent_qty = NULL,
        handover_available_qty = NULL
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND (v_department_id IS NULL OR department_id = v_department_id)
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_audit_session(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_guard jsonb;
  v_step_guard jsonb;
  v_operation_id uuid;
  v_id uuid;
  v_user_role text;
  v_status text := COALESCE(NULLIF(p_payload->>'status',''),'completed');
  v_session_id uuid := NULLIF(p_payload->>'sessionId','')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId','')::uuid;
  v_resource_id uuid := NULLIF(p_payload->>'resourceId','')::uuid;
  v_passed integer := COALESCE((p_payload->>'passed')::integer,0);
  v_failed integer := COALESCE((p_payload->>'failed')::integer,0);
  v_major integer := COALESCE((p_payload->>'majorFailed')::integer,0);
  v_minor integer := COALESCE((p_payload->>'minorFailed')::integer,0);
  v_sample integer := COALESCE((p_payload->>'sampleSize')::integer,0);
  v_updated integer;
BEGIN
  v_guard := public.assert_colorway_allows_production(v_colorway_id);
  IF v_guard IS NOT NULL THEN RETURN v_guard; END IF;

  v_step_guard := public.floor_resolve_operation_step(
    p_factory_id, p_user_id, v_colorway_id,
    COALESCE(
      NULLIF(p_payload->>'orderRouteId', '')::uuid,
      NULLIF(p_payload->>'operationId','')::uuid,
      NULLIF(p_payload->>'flowStepId', '')::uuid
    ), NULL, true);
  IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
  v_operation_id := (v_step_guard->>'operation_id')::uuid;

  SELECT p.user_role INTO v_user_role FROM public.profiles p WHERE p.id = p_user_id AND p.factory_id = p_factory_id;
  IF v_user_role IS NULL THEN RETURN public.floor_capture_fail('Invalid session','INVALID_SESSION'); END IF;

  IF NOT (public.profile_dept_has_app(p_user_id, p_factory_id, 'audit')
          OR v_user_role IN ('auditor','admin','superadmin','quality_manager')) THEN
    RETURN public.floor_capture_fail('Department not authorized for audit','REQUIRE_APP_AUDIT');
  END IF;

  IF v_colorway_id IS NULL THEN RETURN public.floor_capture_fail('colorwayId is required','INVALID_COLORWAY'); END IF;
  IF v_resource_id IS NULL THEN RETURN public.floor_capture_fail('resourceId is required','INVALID_RESOURCE'); END IF;

  IF COALESCE((p_payload->>'lotSize')::integer,0) <= 0 OR v_sample <= 0
     OR v_sample > COALESCE((p_payload->>'lotSize')::integer,0) THEN
    RETURN public.floor_capture_fail('Invalid lot or sample size','INVALID_LOT');
  END IF;
  IF v_passed + v_failed > v_sample THEN
    RETURN public.floor_capture_fail('passed + failed cannot exceed sampleSize','INVALID_COUNT');
  END IF;
  IF v_status NOT IN ('in_progress','completed') THEN
    RETURN public.floor_capture_fail('Invalid audit status','INVALID_STATUS');
  END IF;

  IF v_status='completed' AND v_session_id IS NOT NULL THEN
    UPDATE public.audit_sessions SET colorway_id=v_colorway_id, resource_id=v_resource_id, order_route_id=v_operation_id,
      lot_size=COALESCE((p_payload->>'lotSize')::integer,0), sample_size=v_sample, aql_level=NULLIF(p_payload->>'aqlLevel',''),
      passed=v_passed, failed=v_failed, major_failed=v_major, minor_failed=v_minor, result=NULLIF(p_payload->>'result',''),
      pieces_json=COALESCE(p_payload->'pieces','[]'::jsonb), status='completed',
      completed_at=COALESCE((p_payload->>'completedAt')::timestamptz, now()), logged_at=COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    WHERE id=v_session_id AND factory_id=p_factory_id AND logged_by=p_user_id AND status='in_progress' AND colorway_id IS NOT DISTINCT FROM v_colorway_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN RETURN jsonb_build_object('id', v_session_id); END IF;
  END IF;

  IF v_status='in_progress' AND v_session_id IS NOT NULL THEN
    UPDATE public.audit_sessions SET colorway_id=v_colorway_id, resource_id=v_resource_id, order_route_id=v_operation_id,
      lot_size=COALESCE((p_payload->>'lotSize')::integer,0), sample_size=v_sample, aql_level=NULLIF(p_payload->>'aqlLevel',''),
      pieces_json=COALESCE(p_payload->'pieces','[]'::jsonb), passed=v_passed, failed=v_failed, major_failed=v_major, minor_failed=v_minor,
      logged_at=COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    WHERE id=v_session_id AND factory_id=p_factory_id AND logged_by=p_user_id AND status='in_progress' AND colorway_id IS NOT DISTINCT FROM v_colorway_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN RETURN jsonb_build_object('id', v_session_id); END IF;
  END IF;

  INSERT INTO public.audit_sessions (
    factory_id, order_id, colorway_id, department_id, resource_id, order_route_id,
    lot_size, sample_size, aql_level, passed, failed, major_failed, minor_failed,
    result, pieces_json, status, logged_by, logged_at, completed_at
  ) VALUES (
    p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, (v_step_guard->>'department_id')::uuid, v_resource_id, v_operation_id,
    COALESCE((p_payload->>'lotSize')::integer,0), v_sample, NULLIF(p_payload->>'aqlLevel',''), v_passed, v_failed, v_major, v_minor,
    CASE WHEN v_status='completed' THEN NULLIF(p_payload->>'result','') ELSE NULL END,
    COALESCE(p_payload->'pieces','[]'::jsonb), v_status, p_user_id,
    COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
    CASE WHEN v_status='completed' THEN COALESCE((p_payload->>'completedAt')::timestamptz, now()) ELSE NULL END
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_batch_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_department_id uuid;
  v_payload_dept uuid;
  v_colorway_id uuid;
  v_log_date date;
  v_headcount jsonb;
  v_count integer;
  v_step_guard jsonb;
  v_kpi record;
  v_id uuid;
  v_shift_id uuid;
  v_line_allocation_id uuid;
  v_order_route_id uuid;
  v_duration_generated boolean;
  v_resource_id uuid;
BEGIN
  SELECT p.department_id INTO v_profile_department_id
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active';

  IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'batch') THEN
    RETURN public.floor_capture_fail(
      'Department not authorized for batch capture',
      'REQUIRE_APP_BATCH'
    );
  END IF;

  IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
    RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('Order not found in factory', 'INVALID_ORDER');
  END IF;

  v_payload_dept := (p_payload->>'departmentId')::uuid;
  IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail(
      'departmentId must match user department',
      'DEPT_MISMATCH',
      jsonb_build_object('expectedDepartmentId', v_profile_department_id)
    );
  END IF;

  v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_shift_id := NULLIF(p_payload->>'shiftId', '')::uuid;
  v_resource_id := NULLIF(p_payload->>'resourceId', '')::uuid;

  IF p_payload->>'startTime' IS NULL OR p_payload->>'endTime' IS NULL THEN
    RETURN public.floor_capture_fail('startTime and endTime are required', 'MISSING_FIELDS');
  END IF;

  BEGIN
    IF (p_payload->>'endTime')::timestamptz <= (p_payload->>'startTime')::timestamptz THEN
      RETURN public.floor_capture_fail('endTime must be after startTime', 'INVALID_TIME_RANGE');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN public.floor_capture_fail('startTime and endTime must be valid timestamps', 'INVALID_TIME_RANGE');
  END;

  v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
  IF v_log_date < CURRENT_DATE - 7 THEN
    RETURN public.floor_capture_fail(
      'logDate cannot be more than 7 days in the past',
      'BACKFILL_TOO_OLD',
      jsonb_build_object('logDate', v_log_date)
    );
  END IF;

  v_headcount := COALESCE(p_payload->'headcountByCategory', '{}'::jsonb);
  IF public.jsonb_sum_int_values(v_headcount) <= 0 THEN
    RETURN public.floor_capture_fail(
      'At least one headcount category must be greater than zero',
      'MISSING_HEADCOUNT'
    );
  END IF;

  IF COALESCE(p_payload->'producedBySize', '{}'::jsonb) <> '{}'::jsonb THEN
    v_count := public.jsonb_sum_int_values(p_payload->'producedBySize');
  ELSE
    BEGIN
      v_count := (p_payload->>'producedQty')::integer;
    EXCEPTION WHEN OTHERS THEN
      RETURN public.floor_capture_fail('producedQty must be an integer', 'INVALID_COUNT');
    END;
  END IF;

  IF v_count IS NULL OR v_count <= 0 THEN
    RETURN public.floor_capture_fail('producedQty must be a positive integer', 'INVALID_COUNT');
  END IF;

  IF COALESCE(p_payload->'producedBySize', '{}'::jsonb) <> '{}'::jsonb
     AND public.jsonb_sum_int_values(p_payload->'producedBySize') IS DISTINCT FROM v_count THEN
    RETURN public.floor_capture_fail(
      'producedQty must equal the sum of producedBySize',
      'SIZE_TOTAL_MISMATCH'
    );
  END IF;

  IF p_payload->>'orderRouteId' IS NULL
     AND p_payload->>'flowStepId' IS NULL
     AND p_payload->>'operationId' IS NULL THEN
    RETURN public.floor_capture_fail('orderRouteId is required', 'MISSING_OPERATION');
  END IF;

  v_step_guard := public.floor_resolve_order_route_step(
    p_factory_id,
    p_user_id,
    (p_payload->>'orderId')::uuid,
    COALESCE(
      NULLIF(p_payload->>'orderRouteId', '')::uuid,
      NULLIF(p_payload->>'flowStepId', '')::uuid,
      NULLIF(p_payload->>'operationId', '')::uuid
    ),
    'batch'
  );
  IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;

  v_order_route_id := (v_step_guard->>'order_route_id')::uuid;

  -- Same path as capture_fill_line_allocation on batch_production:
  -- prefer payload id, else resolve via order+colorway+resource+route.
  v_line_allocation_id := public.resolve_capture_line_allocation_id(
    NULLIF(p_payload->>'lineAllocationId', '')::uuid,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_resource_id,
    v_order_route_id
  );

  SELECT * INTO v_kpi
  FROM public.compute_capture_session_kpi(
    p_factory_id,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_payload_dept,
    v_resource_id,
    v_log_date,
    v_order_route_id,
    (p_payload->>'startTime')::timestamptz,
    (p_payload->>'endTime')::timestamptz,
    v_headcount,
    v_count
  );

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'batch_production'
      AND c.column_name = 'duration_mins'
      AND c.is_generated = 'ALWAYS'
  ) INTO v_duration_generated;

  IF v_duration_generated THEN
    INSERT INTO public.batch_production (
      factory_id, order_id, colorway_id, order_route_id, department_id, resource_id,
      start_time, end_time, log_date, shift_id, line_allocation_id,
      headcount_by_category, produced_by_size, produced_qty,
      sam, produced_mins,
      activity_no, ref_no, comment, logged_by, logged_at
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, v_order_route_id,
      v_payload_dept, v_resource_id,
      (p_payload->>'startTime')::timestamptz, (p_payload->>'endTime')::timestamptz, v_log_date,
      v_shift_id, v_line_allocation_id,
      v_headcount, COALESCE(p_payload->'producedBySize', '{}'::jsonb), v_count,
      v_kpi.sam, v_kpi.produced_mins,
      NULLIF(btrim(p_payload->>'activityNo'), ''), NULLIF(btrim(p_payload->>'refNo'), ''),
      NULLIF(btrim(p_payload->>'comment'), ''), p_user_id,
      COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    )
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.batch_production (
      factory_id, order_id, colorway_id, order_route_id, department_id, resource_id,
      start_time, end_time, log_date, shift_id, line_allocation_id,
      headcount_by_category, produced_by_size, produced_qty,
      worker_count, duration_mins, available_mins, sam, produced_mins, efficiency_pct,
      activity_no, ref_no, comment, logged_by, logged_at
    ) VALUES (
      p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, v_order_route_id,
      v_payload_dept, v_resource_id,
      (p_payload->>'startTime')::timestamptz, (p_payload->>'endTime')::timestamptz, v_log_date,
      v_shift_id, v_line_allocation_id,
      v_headcount, COALESCE(p_payload->'producedBySize', '{}'::jsonb), v_count,
      v_kpi.worker_count, v_kpi.duration_mins, v_kpi.available_mins,
      v_kpi.sam, v_kpi.produced_mins, v_kpi.efficiency_pct,
      NULLIF(btrim(p_payload->>'activityNo'), ''), NULLIF(btrim(p_payload->>'refNo'), ''),
      NULLIF(btrim(p_payload->>'comment'), ''), p_user_id,
      COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'workerCount', v_kpi.worker_count,
    'durationMins', v_kpi.duration_mins,
    'availableMins', v_kpi.available_mins,
    'sam', v_kpi.sam,
    'producedMins', v_kpi.produced_mins,
    'efficiencyPct', v_kpi.efficiency_pct,
    'shiftId', v_shift_id,
    'lineAllocationId', v_line_allocation_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_colorway_reaudit_complete(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
BEGIN
  IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
    RETURN public.floor_capture_fail('Not authorized', 'APP_NOT_ALLOWED');
  END IF;

  UPDATE public.colorways
  SET shipment_floor_status = 'ready_to_ship',
      ready_to_ship_at = now(),
      ready_to_ship_by = p_user_id
  WHERE id = v_colorway_id
    AND order_id = v_order_id
    AND shipment_floor_status = 'reaudit_open';

  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('Colorway is not in re-audit', 'REAUDIT_NOT_OPEN');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_colorway_reaudit_open(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_reason text := NULLIF(p_payload->>'reason', '');
BEGIN
  IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
    RETURN public.floor_capture_fail('Not authorized', 'APP_NOT_ALLOWED');
  END IF;

  IF v_colorway_id IS NULL OR v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId and colorwayId are required', 'MISSING_FIELDS');
  END IF;

  IF v_reason IS NULL OR length(trim(v_reason)) < 3 THEN
    RETURN public.floor_capture_fail('Re-audit reason is required', 'MISSING_REASON');
  END IF;

  UPDATE public.colorways
  SET
    shipment_floor_status = 'reaudit_open',
    reaudit_opened_at = now(),
    reaudit_opened_by = p_user_id,
    reaudit_reason = v_reason
  WHERE id = v_colorway_id
    AND order_id = v_order_id
    AND shipment_floor_status = 'shipped_closed';

  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('Colorway must be shipped closed to open re-audit', 'REAUDIT_NOT_ALLOWED');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_colorway_ship_close(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_comment text := NULLIF(p_payload->>'comment', '');
BEGIN
  IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
    RETURN public.floor_capture_fail('Not authorized', 'APP_NOT_ALLOWED');
  END IF;

  IF v_colorway_id IS NULL OR v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId and colorwayId are required', 'MISSING_FIELDS');
  END IF;

  UPDATE public.colorways
  SET
    shipment_floor_status = 'shipped_closed',
    shipped_closed_at = now(),
    shipped_closed_by = p_user_id,
    close_comment = v_comment
  WHERE id = v_colorway_id
    AND order_id = v_order_id
    AND shipment_floor_status IN ('active', 'ready_to_ship');

  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('Colorway not eligible to close', 'CLOSE_NOT_ALLOWED');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_balance(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_order_id uuid;
  v_colorway_id uuid;
  v_department_id uuid;
  v_fabric_type text;
  v_already_cut jsonb := '{}'::jsonb;
  v_planned jsonb := '{}'::jsonb;
  v_planned_total integer := 0;
BEGIN
  v_order_id := (p_payload->>'orderId')::uuid;
  v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_department_id := NULLIF(p_payload->>'departmentId', '')::uuid;
  v_fabric_type := p_payload->>'fabricType';

  IF v_order_id IS NULL OR v_department_id IS NULL OR v_fabric_type IS NULL OR v_fabric_type = '' THEN
    RETURN jsonb_build_object('alreadyCutBySize', '{}'::jsonb, 'plannedBySize', '{}'::jsonb, 'plannedTotal', 0);
  END IF;

  -- Sum qty_by_size from all cutting_lays in matching sessions
  SELECT COALESCE(
    public.jsonb_merge_sum_maps(ARRAY_AGG(cl.qty_by_size)),
    '{}'::jsonb
  )
  INTO v_already_cut
  FROM public.cutting_lays cl
  JOIN public.cutting_sessions cs ON cs.id = cl.session_id
  WHERE cs.factory_id = p_factory_id
    AND cs.order_id = v_order_id
    AND cs.colorway_id IS NOT DISTINCT FROM v_colorway_id
    AND cs.department_id = v_department_id
    AND cs.fabric_type = v_fabric_type
    AND cl.qty_by_size <> '{}'::jsonb;

  -- Get planned from colorway
  v_planned := COALESCE(public.colorway_planned_by_size(v_colorway_id), '{}'::jsonb);
  v_planned_total := public.jsonb_sum_int_values(v_planned);

  RETURN jsonb_build_object(
    'alreadyCutBySize', v_already_cut,
    'plannedBySize', v_planned,
    'plannedTotal', v_planned_total
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_bundle(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.cutting_bundles (
    factory_id, lay_id, bundle_no, size, qty, fabric_aspect, status, logged_by
  ) VALUES (
    (p_payload->>'factory_id')::uuid,
    (p_payload->>'lay_id')::uuid,
    COALESCE(p_payload->>'bundle_no', '1'),
    NULLIF(p_payload->>'size', ''),
    COALESCE((p_payload->>'qty')::integer, 0),
    COALESCE(NULLIF(p_payload->>'fabric_aspect', ''), 'shell'),
    COALESCE(NULLIF(p_payload->>'status', ''), 'open'),
    NULLIF(p_payload->>'logged_by', '')::uuid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_bundles_generate(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lay_id uuid;
  v_bundle_size integer;
  v_regenerate boolean;
  v_lay record;
  v_session record;
  v_lot record;
  v_fc_id uuid;
  v_fabric_type text;
  v_size text;
  v_size_qty integer;
  v_seq integer := 0;
  v_remaining integer;
  v_chunk integer;
  v_piece_from integer;
  v_piece_to integer;
  v_bundle_no text;
BEGIN
  IF NOT public.profile_dept_can_capture_cutting(p_user_id, p_factory_id) THEN
    RETURN public.floor_capture_fail('Not authorized', 'REQUIRE_APP_LAY_REPORT');
  END IF;

  v_lay_id := NULLIF(p_payload->>'layId', '')::uuid;
  v_bundle_size := COALESCE((p_payload->>'bundleSize')::integer, 20);
  v_regenerate := COALESCE((p_payload->>'regenerate')::boolean, false);

  IF v_lay_id IS NULL THEN
    RETURN public.floor_capture_fail('layId is required', 'MISSING_FIELDS');
  END IF;

  SELECT l.* INTO v_lay
  FROM public.cutting_lays l
  WHERE l.id = v_lay_id AND l.factory_id = p_factory_id;

  IF v_lay IS NULL THEN
    RETURN public.floor_capture_fail('Lay not found', 'INVALID_LAY');
  END IF;

  SELECT s.* INTO v_session
  FROM public.cutting_sessions s
  WHERE s.id = v_lay.session_id AND s.factory_id = p_factory_id;

  IF v_session IS NULL THEN
    RETURN public.floor_capture_fail('Session not found', 'INVALID_SESSION');
  END IF;

  SELECT sl.* INTO v_lot
  FROM public.cutting_session_lots sl
  WHERE sl.id = v_lay.lot_id;

  -- Prefer lay → session, then resolve from fabric_type (ex-trigger behavior).
  v_fc_id := COALESCE(v_lay.fabric_component_id, v_session.fabric_component_id);
  v_fabric_type := COALESCE(NULLIF(btrim(v_session.fabric_type), ''), 'Shell');
  IF v_fc_id IS NULL THEN
    v_fc_id := public.resolve_fabric_component_id(p_factory_id, v_fabric_type);
  END IF;

  IF v_regenerate THEN
    DELETE FROM public.cutting_bundles
    WHERE lay_id = v_lay_id AND factory_id = p_factory_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.cutting_bundles WHERE lay_id = v_lay_id) THEN
      RETURN public.floor_capture_fail('Bundles already exist for this lay', 'BUNDLES_EXIST');
    END IF;
  END IF;

  FOR v_size, v_size_qty IN
    SELECT key, value::integer
    FROM jsonb_each_text(COALESCE(v_lay.qty_by_size, '{}'::jsonb))
    WHERE value::integer > 0
    ORDER BY key
  LOOP
    v_remaining := v_size_qty;
    v_piece_from := 1;
    WHILE v_remaining > 0 LOOP
      v_seq := v_seq + 1;
      v_chunk := LEAST(v_remaining, v_bundle_size);
      v_piece_to := v_piece_from + v_chunk - 1;
      v_bundle_no := v_session.session_no || '-' || v_lay.lay_no || '-' || v_size || '-' || v_seq;

      INSERT INTO public.cutting_bundles (
        factory_id, lay_id, session_id, lot_id, order_id, colorway_id,
        bundle_no, bundle_sequence, session_no, lot_no, lay_no,
        size, qty, piece_from, piece_to, fabric_type, fabric_component_id,
        status, created_by
      ) VALUES (
        p_factory_id, v_lay_id, v_session.id, v_lay.lot_id, v_session.order_id, v_session.colorway_id,
        v_bundle_no, v_seq, v_session.session_no, COALESCE(v_lot.lot_no, ''), v_lay.lay_no,
        v_size, v_chunk, v_piece_from, v_piece_to, v_fabric_type, v_fc_id,
        'available', p_user_id
      );

      v_piece_from := v_piece_to + 1;
      v_remaining := v_remaining - v_chunk;
    END LOOP;
  END LOOP;

  UPDATE public.cutting_lays SET bundles_generated = true WHERE id = v_lay_id;

  RETURN jsonb_build_object(
    'ok', true,
    'count', v_seq,
    'fabricComponentId', v_fc_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_fabric_lot_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.floor_capture_cutting_session_lot_upsert(p_factory_id, p_user_id, p_payload);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_lay(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.cutting_lays (
    factory_id, order_id, colorway_id, resource_id, line_allocation_id,
    lay_no, fabric_aspect, planned_pcs, notes, logged_by
  ) VALUES (
    (p_payload->>'factory_id')::uuid,
    (p_payload->>'order_id')::uuid,
    NULLIF(p_payload->>'colorway_id', '')::uuid,
    NULLIF(p_payload->>'resource_id', '')::uuid,
    NULLIF(p_payload->>'line_allocation_id', '')::uuid,
    COALESCE(p_payload->>'lay_no', '1'),
    COALESCE(NULLIF(p_payload->>'fabric_aspect', ''), 'shell'),
    COALESCE((p_payload->>'planned_pcs')::integer, 0),
    NULLIF(p_payload->>'notes', ''),
    NULLIF(p_payload->>'logged_by', '')::uuid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_lay_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_lot_id uuid;
  v_lay_no integer;
  v_qty_by_size jsonb;
  v_total_qty integer;
  v_id uuid;
BEGIN
  IF NOT public.profile_dept_can_capture_cutting(p_user_id, p_factory_id) THEN
    RETURN public.floor_capture_fail('Not authorized', 'REQUIRE_APP_LAY_REPORT');
  END IF;

  v_session_id := NULLIF(p_payload->>'sessionId', '')::uuid;
  v_lot_id := NULLIF(p_payload->>'lotId', '')::uuid;
  IF v_session_id IS NULL OR v_lot_id IS NULL THEN
    RETURN public.floor_capture_fail('sessionId and lotId are required', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cutting_session_lots l
    WHERE l.id = v_lot_id AND l.session_id = v_session_id AND l.factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('Lot not found', 'INVALID_LOT');
  END IF;

  v_qty_by_size := COALESCE(p_payload->'qtyBySize', '{}'::jsonb);
  v_total_qty := COALESCE((p_payload->>'totalQty')::integer, public.jsonb_sum_int_values(v_qty_by_size));
  IF v_total_qty <= 0 THEN
    RETURN public.floor_capture_fail('Enter cut quantity by size', 'INVALID_QTY');
  END IF;

  v_id := NULLIF(p_payload->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    SELECT cl.lay_no INTO v_lay_no FROM public.cutting_lays cl WHERE cl.id = v_id AND cl.lot_id = v_lot_id;
    IF v_lay_no IS NULL THEN
      RETURN public.floor_capture_fail('Lay not found', 'INVALID_LAY');
    END IF;
  ELSE
    SELECT COALESCE(MAX(cl.lay_no), 0) + 1 INTO v_lay_no
    FROM public.cutting_lays cl WHERE cl.lot_id = v_lot_id;
  END IF;

  v_id := COALESCE(v_id, gen_random_uuid());

  INSERT INTO public.cutting_lays (
    id, factory_id, session_id, lot_id, lay_no,
    fabric_shade, marker, marker_length, ply_count, number_of_plies,
    fabric_consumption, comments, qty_by_size, total_qty, logged_by
  )
  VALUES (
    v_id, p_factory_id, v_session_id, v_lot_id, v_lay_no,
    NULLIF(trim(COALESCE(p_payload->>'fabricShade', '')), ''),
    NULLIF(trim(COALESCE(p_payload->>'marker', '')), ''),
    NULLIF(p_payload->>'markerLength', '')::numeric,
    NULLIF((p_payload->>'plyCount')::integer, 0),
    NULLIF((p_payload->>'numberOfPlies')::integer, 0),
    NULLIF(p_payload->>'fabricConsumption', '')::numeric,
    NULLIF(trim(COALESCE(p_payload->>'comments', '')), ''),
    v_qty_by_size, v_total_qty, p_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    fabric_shade = EXCLUDED.fabric_shade,
    marker = EXCLUDED.marker,
    marker_length = EXCLUDED.marker_length,
    ply_count = EXCLUDED.ply_count,
    number_of_plies = EXCLUDED.number_of_plies,
    fabric_consumption = EXCLUDED.fabric_consumption,
    comments = EXCLUDED.comments,
    qty_by_size = EXCLUDED.qty_by_size,
    total_qty = EXCLUDED.total_qty,
    logged_by = EXCLUDED.logged_by;

  PERFORM public.cutting_refresh_lot_total(v_lot_id);
  PERFORM public.cutting_refresh_session_total(v_session_id);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'layNo', v_lay_no);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_session_lot_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_lot_no text;
  v_lot_type text;
  v_sort_order integer;
  v_id uuid;
BEGIN
  IF NOT public.profile_dept_can_capture_cutting(p_user_id, p_factory_id) THEN
    RETURN public.floor_capture_fail('Not authorized', 'REQUIRE_APP_LAY_REPORT');
  END IF;

  v_session_id := NULLIF(p_payload->>'sessionId', '')::uuid;
  v_lot_no := trim(COALESCE(p_payload->>'lotNo', ''));
  v_lot_type := NULLIF(trim(COALESCE(p_payload->>'lotType', '')), '');
  IF v_session_id IS NULL OR v_lot_no = '' THEN
    RETURN public.floor_capture_fail('sessionId and lotNo are required', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cutting_sessions s
    WHERE s.id = v_session_id AND s.factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('Session not found', 'INVALID_SESSION');
  END IF;

  SELECT l.id INTO v_id
  FROM public.cutting_session_lots l
  WHERE l.factory_id = p_factory_id AND l.session_id = v_session_id AND l.lot_no = v_lot_no;

  v_sort_order := COALESCE(
    (p_payload->>'sortOrder')::integer,
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.cutting_session_lots WHERE session_id = v_session_id)
  );

  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO public.cutting_session_lots (id, factory_id, session_id, lot_no, lot_type, sort_order)
    VALUES (v_id, p_factory_id, v_session_id, v_lot_no, v_lot_type, v_sort_order);
  ELSE
    UPDATE public.cutting_session_lots
    SET lot_type = COALESCE(v_lot_type, lot_type)
    WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_session_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_department_id uuid;
  v_payload_dept uuid;
  v_order_id uuid;
  v_colorway_id uuid;
  v_order_route_id uuid;
  v_resource_id uuid;
  v_session_no text;
  v_ref_no text;
  v_fabric_type text;
  v_fabric_component_id uuid;
  v_comments text;
  v_size_ratio jsonb;
  v_log_date date;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_headcount jsonb;
  v_total_headcount integer;
  v_existing_id uuid;
  v_id uuid;
  v_cumulative jsonb;
  v_line_allocation_id uuid;
  v_shift_id uuid;
  v_produced_qty integer;
  v_kpi record;
  v_row jsonb;
BEGIN
  SELECT p.department_id INTO v_profile_department_id
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active';

  IF v_profile_department_id IS NULL THEN
    RETURN public.floor_capture_fail('Active profile required', 'NO_PROFILE');
  END IF;

  IF NOT public.profile_dept_can_capture_cutting(p_user_id, p_factory_id) THEN
    RETURN public.floor_capture_fail('Not authorized for cutting', 'REQUIRE_APP_LAY_REPORT');
  END IF;

  v_payload_dept := NULLIF(p_payload->>'departmentId', '')::uuid;
  IF v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH');
  END IF;

  v_order_id := NULLIF(p_payload->>'orderId', '')::uuid;
  IF v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId is required', 'INVALID_ORDER');
  END IF;

  v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_order_route_id := NULLIF(p_payload->>'orderRouteId', '')::uuid;
  v_resource_id := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_shift_id := NULLIF(p_payload->>'shiftId', '')::uuid;
  v_session_no := trim(COALESCE(p_payload->>'sessionNo', p_payload->>'cutNo', ''));
  IF v_session_no = '' THEN
    RETURN public.floor_capture_fail('sessionNo is required', 'MISSING_SESSION_NO');
  END IF;

  v_fabric_component_id := NULLIF(p_payload->>'fabricComponentId', '')::uuid;
  v_fabric_type := trim(COALESCE(NULLIF(p_payload->>'fabricType', ''), 'Shell'));
  IF v_fabric_type = '' THEN
    RETURN public.floor_capture_fail('fabricType is required', 'INVALID_FABRIC_TYPE');
  END IF;

  IF v_fabric_component_id IS NOT NULL THEN
    SELECT fc.fabric_type INTO v_fabric_type
    FROM public.fabric_components fc
    WHERE fc.id = v_fabric_component_id AND fc.factory_id = p_factory_id;
    IF v_fabric_type IS NULL THEN
      RETURN public.floor_capture_fail('Invalid fabric component', 'INVALID_FABRIC_COMPONENT');
    END IF;
  ELSIF v_fabric_type IS NOT NULL THEN
    -- Mirror session-side fabric resolve when client only sent fabricType
    v_fabric_component_id := public.resolve_fabric_component_id(p_factory_id, v_fabric_type);
  END IF;

  v_ref_no := NULLIF(trim(COALESCE(p_payload->>'refNo', '')), '');
  v_comments := NULLIF(trim(COALESCE(p_payload->>'comments', '')), '');
  v_size_ratio := COALESCE(p_payload->'sizeRatio', '{}'::jsonb);
  v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
  v_headcount := COALESCE(p_payload->'headcountByCategory', '{}'::jsonb);
  v_total_headcount := public.jsonb_sum_int_values(v_headcount);

  v_start_time := (p_payload->>'startTime')::timestamptz;
  v_end_time := (p_payload->>'endTime')::timestamptz;
  IF v_start_time IS NULL OR v_end_time IS NULL OR v_end_time <= v_start_time THEN
    RETURN public.floor_capture_fail('Invalid start/end time', 'INVALID_TIME');
  END IF;

  -- Same path as capture_fill_line_allocation on cutting_sessions:
  -- prefer payload id, else capture_route_step_id(row) → resolve_line_allocation_id.
  v_line_allocation_id := NULLIF(p_payload->>'lineAllocationId', '')::uuid;
  IF v_line_allocation_id IS NULL THEN
    v_row := jsonb_build_object(
      'order_route_id', v_order_route_id,
      'operation_id', NULLIF(p_payload->>'operationId', '')::uuid,
      'flow_step_id', NULLIF(p_payload->>'flowStepId', '')::uuid,
      'colorway_id', v_colorway_id,
      'resource_id', v_resource_id,
      'line_allocation_id', NULL
    );
    v_order_route_id := COALESCE(v_order_route_id, public.capture_route_step_id(v_row));
    v_line_allocation_id := public.resolve_line_allocation_id(
      v_order_id, v_colorway_id, v_resource_id, v_order_route_id
    );
  END IF;

  SELECT s.id INTO v_existing_id
  FROM public.cutting_sessions s
  WHERE s.factory_id = p_factory_id
    AND s.order_id = v_order_id
    AND s.colorway_id IS NOT DISTINCT FROM v_colorway_id
    AND s.session_no = v_session_no;

  v_id := COALESCE(NULLIF(p_payload->>'id', '')::uuid, v_existing_id, gen_random_uuid());

  v_cumulative := COALESCE(p_payload->'sessionCutBySize', '{}'::jsonb);
  v_produced_qty := public.jsonb_sum_int_values(v_cumulative);

  SELECT * INTO v_kpi
  FROM public.compute_capture_session_kpi(
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_profile_department_id,
    v_resource_id,
    v_log_date,
    v_order_route_id,
    v_start_time,
    v_end_time,
    v_headcount,
    v_produced_qty
  );

  INSERT INTO public.cutting_sessions (
    id, factory_id, order_id, colorway_id, department_id, order_route_id, resource_id,
    line_allocation_id, shift_id, session_no, ref_no, fabric_type, fabric_component_id, cutting_table,
    comments, size_ratio, log_date, start_time, end_time, headcount_by_category, total_headcount,
    cumulative_cut_by_size,
    duration_mins, available_mins, sam, produced_mins, efficiency_pct,
    logged_by, logged_at
  )
  VALUES (
    v_id, p_factory_id, v_order_id, v_colorway_id, v_profile_department_id, v_order_route_id, v_resource_id,
    v_line_allocation_id, v_shift_id, v_session_no, v_ref_no, v_fabric_type, v_fabric_component_id, NULL,
    v_comments, v_size_ratio, v_log_date, v_start_time, v_end_time, v_headcount, v_total_headcount,
    v_cumulative,
    v_kpi.duration_mins, v_kpi.available_mins, v_kpi.sam, v_kpi.produced_mins, v_kpi.efficiency_pct,
    p_user_id, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    ref_no = EXCLUDED.ref_no,
    fabric_type = EXCLUDED.fabric_type,
    fabric_component_id = COALESCE(EXCLUDED.fabric_component_id, public.cutting_sessions.fabric_component_id),
    resource_id = EXCLUDED.resource_id,
    line_allocation_id = COALESCE(EXCLUDED.line_allocation_id, public.cutting_sessions.line_allocation_id),
    shift_id = EXCLUDED.shift_id,
    comments = EXCLUDED.comments,
    size_ratio = EXCLUDED.size_ratio,
    log_date = EXCLUDED.log_date,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    headcount_by_category = EXCLUDED.headcount_by_category,
    total_headcount = EXCLUDED.total_headcount,
    cumulative_cut_by_size = EXCLUDED.cumulative_cut_by_size,
    duration_mins = EXCLUDED.duration_mins,
    available_mins = EXCLUDED.available_mins,
    sam = EXCLUDED.sam,
    produced_mins = EXCLUDED.produced_mins,
    efficiency_pct = EXCLUDED.efficiency_pct,
    logged_by = EXCLUDED.logged_by,
    logged_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'cumulativeCutBySize', v_cumulative,
    'durationMins', v_kpi.duration_mins,
    'availableMins', v_kpi.available_mins,
    'sam', v_kpi.sam,
    'producedMins', v_kpi.produced_mins,
    'efficiencyPct', v_kpi.efficiency_pct,
    'shiftId', v_shift_id,
    'lineAllocationId', v_line_allocation_id,
    'fabricComponentId', v_fabric_component_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_fail(p_message text, p_code text, p_details jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'ok', false,
    'error', p_message,
    'code', p_code,
    'details', p_details
  );
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_handover_amend(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slip public.handover_slips%ROWTYPE;
  v_profile_department_id uuid;
  v_qty_by_size jsonb;
  v_size_sum integer;
  v_short integer;
  v_short_by_size jsonb;
  v_from_name text;
  v_to_name text;
  v_reason text;
  v_remark text;
  v_rejection_id uuid;
  v_first_rejection_id uuid;
  v_order_route_id uuid;
  v_visit_id uuid;
  v_size_key text;
  v_size_qty integer;
  v_accept_sent boolean := COALESCE((p_payload->>'acceptSent')::boolean, false);
  v_close_loss boolean := COALESCE((p_payload->>'closeTransitLoss')::boolean, false);
  v_legacy_accept boolean := COALESCE((p_payload->>'acceptReceived')::boolean, false);
BEGIN
  SELECT department_id INTO v_profile_department_id
  FROM public.profiles
  WHERE id = p_user_id AND factory_id = p_factory_id;

  SELECT * INTO v_slip
  FROM public.handover_slips
  WHERE id = (p_payload->>'slipId')::uuid
    AND factory_id = p_factory_id;

  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('Handover slip not found', 'SLIP_NOT_FOUND');
  END IF;

  IF v_slip.status IS DISTINCT FROM 'disputed' THEN
    RETURN public.floor_capture_fail(
      'Only disputed slips can be amended or closed this way',
      'SLIP_NOT_DISPUTED',
      jsonb_build_object('status', v_slip.status)
    );
  END IF;

  IF v_slip.received_qty IS NULL THEN
    RETURN public.floor_capture_fail('Slip has not been received yet', 'NOT_RECEIVED');
  END IF;

  IF v_legacy_accept AND NOT v_accept_sent AND NOT v_close_loss THEN
    IF v_profile_department_id = v_slip.from_department_id THEN
      v_close_loss := true;
    ELSIF v_profile_department_id = v_slip.to_department_id THEN
      RETURN public.floor_capture_fail(
        'Receiver cannot close short receipt alone. Accept sent qty or amend received sizes; sender must close lost pieces.',
        'RECEIVER_CANNOT_CLOSE_SHORT'
      );
    END IF;
  END IF;

  IF v_accept_sent THEN
    IF v_profile_department_id IS DISTINCT FROM v_slip.to_department_id THEN
      RETURN public.floor_capture_fail(
        'Only the receiving department may accept sent qty',
        'DEPT_MISMATCH'
      );
    END IF;

    UPDATE public.handover_slips
    SET
      received_qty = v_slip.sent_qty,
      received_qty_by_size = COALESCE(v_slip.qty_by_size, '{}'::jsonb),
      status = 'received',
      received_notes = trim(both from concat_ws(' ',
        '[Accepted sent qty]',
        NULLIF(p_payload->>'notes', ''),
        received_notes
      ))
    WHERE id = v_slip.id;

    RETURN jsonb_build_object('ok', true, 'resolved', true, 'action', 'accept_sent');
  END IF;

  IF v_close_loss THEN
    IF v_profile_department_id IS DISTINCT FROM v_slip.from_department_id THEN
      RETURN public.floor_capture_fail(
        'Only the sending department may close lost-in-transit pieces',
        'DEPT_MISMATCH'
      );
    END IF;

    v_remark := NULLIF(trim(COALESCE(p_payload->>'remark', p_payload->>'notes', '')), '');
    IF v_remark IS NULL THEN
      RETURN public.floor_capture_fail(
        'Remark is required to close with pieces lost in transit',
        'MISSING_REMARK'
      );
    END IF;

    v_short := GREATEST(v_slip.sent_qty - COALESCE(v_slip.received_qty, 0), 0);
    IF v_short <= 0 THEN
      UPDATE public.handover_slips
      SET status = 'received'
      WHERE id = v_slip.id;
      RETURN jsonb_build_object('ok', true, 'resolved', true, 'action', 'no_short');
    END IF;

    v_short_by_size := public.handover_short_qty_by_size(
      COALESCE(v_slip.qty_by_size, '{}'::jsonb),
      COALESCE(v_slip.received_qty_by_size, '{}'::jsonb)
    );
    IF v_short_by_size = '{}'::jsonb THEN
      v_short_by_size := jsonb_build_object('Total', v_short);
    END IF;

    SELECT d.name INTO v_from_name
    FROM public.departments d WHERE d.id = v_slip.from_department_id;
    SELECT d.name INTO v_to_name
    FROM public.departments d WHERE d.id = v_slip.to_department_id;

    v_reason := format(
      'Missing in transit · %s → %s',
      COALESCE(NULLIF(trim(v_from_name), ''), 'Sending dept'),
      COALESCE(NULLIF(trim(v_to_name), ''), 'Receiving dept')
    );

    v_visit_id := v_slip.from_visit_id;
    IF v_visit_id IS NOT NULL THEN
      SELECT ors.id
      INTO v_order_route_id
      FROM public.order_routing_steps ors
      WHERE ors.order_id = v_slip.order_id
        AND ors.visit_id = v_visit_id
      ORDER BY
        COALESCE(ors.is_dept_exit_operation, false) DESC,
        COALESCE(ors.is_primary_output, false) DESC,
        ors.seq DESC
      LIMIT 1;
    END IF;

    v_first_rejection_id := NULL;

    FOR v_size_key, v_size_qty IN
      SELECT key, value::integer
      FROM jsonb_each_text(v_short_by_size)
      WHERE value::integer > 0
    LOOP
      INSERT INTO public.rejections (
        factory_id,
        order_id,
        colorway_id,
        size,
        qty,
        reason_code,
        reason_detail,
        defect_summary,
        rejected_qty_by_size,
        stage,
        rejected_date,
        notes,
        logged_by,
        logged_at,
        order_route_id,
        visit_id
      ) VALUES (
        p_factory_id,
        v_slip.order_id,
        v_slip.colorway_id,
        NULLIF(v_size_key, 'Total'),
        v_size_qty,
        v_reason,
        'missing',
        jsonb_build_object(v_reason, v_size_qty),
        jsonb_build_object(v_size_key, v_size_qty),
        'handover_transit_loss',
        CURRENT_DATE,
        trim(both from concat_ws(' ',
          format(
            '[%s %s lost in transit · slip %s]',
            v_size_qty,
            CASE WHEN v_size_key = 'Total' THEN 'pcs' ELSE v_size_key END,
            COALESCE(v_slip.challan_number, v_slip.id::text)
          ),
          v_remark
        )),
        p_user_id,
        now(),
        v_order_route_id,
        v_visit_id
      )
      RETURNING id INTO v_rejection_id;

      IF v_first_rejection_id IS NULL THEN
        v_first_rejection_id := v_rejection_id;
      END IF;
    END LOOP;

    UPDATE public.handover_slips
    SET
      status = 'received_disputed',
      loss_closed_by = p_user_id,
      loss_closed_at = now(),
      loss_remark = v_remark,
      loss_rejection_id = v_first_rejection_id,
      received_notes = trim(both from concat_ws(' ',
        format('[%s pcs lost in transit]', v_short),
        format('[%s]', v_reason),
        v_remark,
        received_notes
      ))
    WHERE id = v_slip.id;

    RETURN jsonb_build_object(
      'ok', true,
      'resolved', true,
      'action', 'close_transit_loss',
      'rejectionId', v_first_rejection_id,
      'shortQty', v_short,
      'shortBySize', v_short_by_size,
      'reasonCode', v_reason,
      'orderRouteId', v_order_route_id,
      'visitId', v_visit_id
    );
  END IF;

  v_qty_by_size := COALESCE(p_payload->'amendedSizes', '{}'::jsonb);
  IF v_qty_by_size = '{}'::jsonb THEN
    RETURN public.floor_capture_fail(
      'amendedSizes, acceptSent, or closeTransitLoss is required',
      'MISSING_FIELDS'
    );
  END IF;

  v_size_sum := public.jsonb_sum_int_values(v_qty_by_size);
  IF v_size_sum <= 0 THEN
    RETURN public.floor_capture_fail('Amended qty must be positive', 'INVALID_QTY');
  END IF;

  IF v_profile_department_id = v_slip.from_department_id THEN
    UPDATE public.handover_slips
    SET sent_qty = v_size_sum, qty_by_size = v_qty_by_size
    WHERE id = v_slip.id;
  ELSIF v_profile_department_id = v_slip.to_department_id THEN
    UPDATE public.handover_slips
    SET received_qty = v_size_sum, received_qty_by_size = v_qty_by_size
    WHERE id = v_slip.id;
  ELSE
    RETURN public.floor_capture_fail('Only sender or receiver may amend', 'DEPT_MISMATCH');
  END IF;

  SELECT * INTO v_slip FROM public.handover_slips WHERE id = v_slip.id;

  IF v_slip.received_qty IS NOT NULL
     AND v_slip.sent_qty = v_slip.received_qty
     AND COALESCE(v_slip.qty_by_size, '{}'::jsonb)
         = COALESCE(v_slip.received_qty_by_size, '{}'::jsonb) THEN
    UPDATE public.handover_slips SET status = 'received' WHERE id = v_slip.id;
    RETURN jsonb_build_object('ok', true, 'resolved', true, 'action', 'amend_matched');
  END IF;

  IF v_slip.received_qty IS NOT NULL AND v_slip.sent_qty = v_slip.received_qty THEN
    UPDATE public.handover_slips SET status = 'received' WHERE id = v_slip.id;
    RETURN jsonb_build_object('ok', true, 'resolved', true, 'action', 'amend_matched_total');
  END IF;

  UPDATE public.handover_slips SET status = 'disputed' WHERE id = v_slip.id;
  RETURN jsonb_build_object('ok', true, 'resolved', false, 'action', 'amend_still_disputed');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_hourly_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_department_id uuid;
  v_payload_dept uuid;
  v_colorway_id uuid;
  v_log_date date;
  v_shift_id uuid;
  v_shift_type text;
  v_count integer;
  v_step_guard jsonb;
  v_prod_guard jsonb;
  v_operation_id uuid;
  v_resource_id uuid;
  v_line_allocation_id uuid;
  v_existing uuid;
  v_id uuid;
  v_kpi record;
  v_sam numeric;
  v_produced_mins numeric;
BEGIN
  SELECT p.department_id INTO v_profile_department_id
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active';

  IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'hourly') THEN
    RETURN public.floor_capture_fail('Department not authorized for hourly capture', 'REQUIRE_APP_HOURLY');
  END IF;
  IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
    RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = (p_payload->>'orderId')::uuid AND factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('Order not found in factory', 'INVALID_ORDER');
  END IF;

  v_payload_dept := (p_payload->>'departmentId')::uuid;
  IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail(
      'departmentId must match user department',
      'DEPT_MISMATCH',
      jsonb_build_object('expectedDepartmentId', v_profile_department_id)
    );
  END IF;

  IF p_payload->>'hourSlot' IS NULL OR btrim(p_payload->>'hourSlot') = '' THEN
    RETURN public.floor_capture_fail('hourSlot is required', 'MISSING_HOUR_SLOT');
  END IF;

  -- Fill-trigger equivalent: prefer payload shiftId, else resolve from hour_slot.
  v_shift_id := NULLIF(p_payload->>'shiftId', '')::uuid;
  IF v_shift_id IS NULL THEN
    BEGIN
      v_shift_id := public.get_shift_for_hour_slot(p_factory_id, p_payload->>'hourSlot');
    EXCEPTION WHEN OTHERS THEN
      v_shift_id := NULL;
    END;
  END IF;
  IF v_shift_id IS NULL THEN
    RETURN public.floor_capture_fail(
      'hourSlot does not match any active shift slot',
      'INVALID_HOUR_SLOT',
      jsonb_build_object('hourSlot', p_payload->>'hourSlot')
    );
  END IF;

  IF COALESCE(p_payload->'countBySize', '{}'::jsonb) <> '{}'::jsonb THEN
    v_count := public.jsonb_sum_int_values(p_payload->'countBySize');
  ELSE
    BEGIN
      v_count := (p_payload->>'count')::integer;
    EXCEPTION WHEN OTHERS THEN
      RETURN public.floor_capture_fail('count must be an integer', 'INVALID_COUNT');
    END;
  END IF;
  IF v_count IS NULL OR v_count < 0 THEN
    RETURN public.floor_capture_fail('count must be a non-negative integer', 'INVALID_COUNT');
  END IF;

  v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
  IF v_log_date < CURRENT_DATE - 7 THEN
    RETURN public.floor_capture_fail(
      'logDate cannot be more than 7 days in the past',
      'BACKFILL_TOO_OLD',
      jsonb_build_object('logDate', v_log_date)
    );
  END IF;

  SELECT s.type INTO v_shift_type FROM public.shifts s WHERE s.id = v_shift_id;
  IF upper(COALESCE(v_shift_type, '')) = 'OT' AND NOT EXISTS (
    SELECT 1 FROM public.workforce_logs wl
    WHERE wl.factory_id = p_factory_id
      AND wl.department_id = v_profile_department_id
      AND wl.log_date = v_log_date
      AND wl.shift_id = v_shift_id
      AND public.jsonb_sum_int_values(COALESCE(wl.headcount_by_category, '{}'::jsonb)) > 0
  ) THEN
    RETURN public.floor_capture_fail(
      'OT hourly output requires OT workforce logged for this date',
      'OT_OUTPUT_WITHOUT_WORKFORCE',
      jsonb_build_object('logDate', v_log_date, 'shiftId', v_shift_id)
    );
  END IF;

  v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_resource_id := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_prod_guard := public.assert_colorway_allows_production(v_colorway_id);
  IF v_prod_guard IS NOT NULL THEN RETURN v_prod_guard; END IF;

  v_step_guard := public.floor_resolve_operation_step(
    p_factory_id, p_user_id, v_colorway_id,
    COALESCE(
      NULLIF(p_payload->>'orderRouteId', '')::uuid,
      NULLIF(p_payload->>'operationId', '')::uuid,
      NULLIF(p_payload->>'flowStepId', '')::uuid
    ),
    'hourly'
  );
  IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
  v_operation_id := (v_step_guard->>'operation_id')::uuid;

  -- Fill-trigger equivalent: prefer payload lineAllocationId, else resolve.
  v_line_allocation_id := public.resolve_capture_line_allocation_id(
    NULLIF(p_payload->>'lineAllocationId', '')::uuid,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_resource_id,
    v_operation_id
  );

  -- Apply-kpi trigger equivalent.
  SELECT * INTO v_kpi
  FROM public.lookup_line_allocation_kpi(
    p_factory_id,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_payload_dept,
    v_resource_id,
    v_log_date,
    v_operation_id
  );
  v_sam := COALESCE(v_kpi.sam, 0);
  v_produced_mins := ROUND(COALESCE(v_count, 0)::numeric * v_sam, 2);

  -- Must match hourly_counts_slot_unique. order_route_id keeps sibling
  -- operations in one department (line loading vs produce) on separate rows.
  SELECT id INTO v_existing FROM public.hourly_counts
  WHERE factory_id = p_factory_id
    AND order_id = (p_payload->>'orderId')::uuid
    AND department_id = v_payload_dept
    AND COALESCE(colorway_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(v_colorway_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(order_route_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(v_operation_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(v_resource_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND hour_slot = p_payload->>'hourSlot'
    AND log_date = v_log_date
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.hourly_counts
    SET
      count = v_count,
      count_by_size = COALESCE(p_payload->'countBySize', '{}'::jsonb),
      logged_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
      shift_id = v_shift_id,
      resource_id = v_resource_id,
      logged_by = p_user_id,
      order_route_id = v_operation_id,
      line_allocation_id = COALESCE(v_line_allocation_id, line_allocation_id),
      sam = v_sam,
      produced_mins = v_produced_mins
    WHERE id = v_existing;
    RETURN jsonb_build_object(
      'id', v_existing,
      'shiftId', v_shift_id,
      'lineAllocationId', v_line_allocation_id,
      'sam', v_sam,
      'producedMins', v_produced_mins
    );
  END IF;

  INSERT INTO public.hourly_counts (
    factory_id, order_id, colorway_id, department_id, resource_id, shift_id,
    hour_slot, log_date, count, count_by_size, logged_by, logged_at,
    order_route_id, line_allocation_id, sam, produced_mins
  ) VALUES (
    p_factory_id, (p_payload->>'orderId')::uuid, v_colorway_id, v_payload_dept,
    v_resource_id, v_shift_id,
    p_payload->>'hourSlot', v_log_date, v_count,
    COALESCE(p_payload->'countBySize', '{}'::jsonb),
    p_user_id, COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
    v_operation_id, v_line_allocation_id,
    v_sam, v_produced_mins
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'shiftId', v_shift_id,
    'lineAllocationId', v_line_allocation_id,
    'sam', v_sam,
    'producedMins', v_produced_mins
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_inspection_session_upsert(p_factory_id uuid, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_id uuid;
  v_log_date date;
  v_colorway_id uuid;
  v_payload_dept uuid;
  v_operation_id uuid;
  v_step_guard jsonb;
  v_prod_guard jsonb;
  v_profile_department_id uuid;
  v_resource_id uuid;
  v_line_allocation_id uuid;
  v_total integer;
  v_passed integer;
  v_failed integer;
  v_rework integer;
  v_passed_by jsonb;
  v_failed_by jsonb;
  v_rework_by jsonb;
  v_defects jsonb;
  v_kpi record;
  v_alloc_kpi record;
  v_sam numeric;
  v_produced_mins numeric;
BEGIN
  SELECT department_id INTO v_profile_department_id
  FROM public.profiles WHERE id = p_user_id AND factory_id = p_factory_id AND status = 'Active';

  IF NOT public.profile_dept_has_app(p_user_id, p_factory_id, 'qc_log') THEN
    RETURN public.floor_capture_fail('Department not authorized for QC capture', 'REQUIRE_APP_QC');
  END IF;

  v_payload_dept := COALESCE(
    NULLIF(p_payload->>'departmentId', '')::uuid,
    v_profile_department_id
  );

  IF v_payload_dept IS NULL THEN
    RETURN public.floor_capture_fail('departmentId is required', 'MISSING_FIELDS');
  END IF;
  IF v_profile_department_id IS NULL OR v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail(
      'departmentId must match user department',
      'DEPT_MISMATCH',
      jsonb_build_object('expectedDepartmentId', v_profile_department_id)
    );
  END IF;

  IF p_payload->>'orderId' IS NULL OR p_payload->>'orderId' !~* '^[0-9a-f-]{36}$' THEN
    RETURN public.floor_capture_fail('orderId must be a valid UUID', 'INVALID_ORDER');
  END IF;

  v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
  v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_resource_id := NULLIF(p_payload->>'resourceId', '')::uuid;

  v_prod_guard := public.assert_colorway_allows_production(v_colorway_id);
  IF v_prod_guard IS NOT NULL THEN RETURN v_prod_guard; END IF;

  v_step_guard := public.floor_resolve_operation_step(
    p_factory_id, p_user_id, v_colorway_id,
    COALESCE(
      NULLIF(p_payload->>'orderRouteId', '')::uuid,
      NULLIF(p_payload->>'operationId', '')::uuid,
      NULLIF(p_payload->>'flowStepId', '')::uuid
    ),
    'qc_log'
  );
  IF v_step_guard ? 'error' THEN RETURN v_step_guard; END IF;
  v_operation_id := (v_step_guard->>'operation_id')::uuid;

  -- Fill-trigger equivalent: prefer payload lineAllocationId, else resolve.
  v_line_allocation_id := public.resolve_capture_line_allocation_id(
    NULLIF(p_payload->>'lineAllocationId', '')::uuid,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_resource_id,
    v_operation_id
  );

  -- Same SAM path as hourly_counts_apply_kpi / floor_capture_hourly_upsert.
  SELECT * INTO v_alloc_kpi
  FROM public.lookup_line_allocation_kpi(
    p_factory_id,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_payload_dept,
    v_resource_id,
    v_log_date,
    v_operation_id
  );
  v_sam := COALESCE(v_alloc_kpi.sam, 0);

  SELECT id INTO v_existing FROM public.inspection_sessions
  WHERE factory_id = p_factory_id
    AND order_id = (p_payload->>'orderId')::uuid
    AND department_id = v_payload_dept
    AND log_date = v_log_date
    AND hour_slot IS NOT DISTINCT FROM NULLIF(p_payload->>'hourSlot', '')
    AND colorway_id IS NOT DISTINCT FROM v_colorway_id
    AND COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(v_resource_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Merge incremental QC pieces into the existing session, then recompute KPI.
    UPDATE public.inspection_sessions SET
      resource_id = v_resource_id,
      shift_id = NULLIF(p_payload->>'shiftId', '')::uuid,
      total_inspected = total_inspected + COALESCE((p_payload->>'totalInspected')::integer, 0),
      passed = passed + COALESCE((p_payload->>'passed')::integer, 0),
      failed = failed + COALESCE((p_payload->>'failed')::integer, 0),
      rework_passed = rework_passed + COALESCE((p_payload->>'reworkPassed')::integer, 0),
      passed_by_size = public.jsonb_sum_merge(passed_by_size, COALESCE(p_payload->'passedBySize', '{}'::jsonb)),
      failed_by_size = public.jsonb_sum_merge(failed_by_size, COALESCE(p_payload->'failedBySize', '{}'::jsonb)),
      rework_by_size = public.jsonb_sum_merge(rework_by_size, COALESCE(p_payload->'reworkBySize', '{}'::jsonb)),
      defect_summary = public.jsonb_sum_merge(defect_summary, COALESCE(p_payload->'defectSummary', '{}'::jsonb)),
      started_at = LEAST(started_at, COALESCE((p_payload->>'startedAt')::timestamptz, started_at)),
      ended_at = GREATEST(ended_at, COALESCE((p_payload->>'endedAt')::timestamptz, now())),
      logged_by = p_user_id,
      logged_at = now(),
      order_route_id = v_operation_id,
      line_allocation_id = COALESCE(v_line_allocation_id, line_allocation_id)
    WHERE id = v_existing
    RETURNING
      total_inspected, passed, failed, rework_passed,
      passed_by_size, rework_by_size, defect_summary
    INTO v_total, v_passed, v_failed, v_rework, v_passed_by, v_rework_by, v_defects;

    SELECT * INTO v_kpi
    FROM public.compute_inspection_session_kpi(
      v_total, v_passed, v_failed, v_rework, v_passed_by, v_rework_by, v_defects
    );

    v_produced_mins := ROUND(COALESCE(v_passed, 0)::numeric * v_sam, 2);

    UPDATE public.inspection_sessions SET
      first_time_pass = v_kpi.first_time_pass,
      first_time_pass_by_size = v_kpi.first_time_pass_by_size,
      ftr_pct = v_kpi.ftr_pct,
      defective_pct = v_kpi.defective_pct,
      dhu = v_kpi.dhu,
      sam = v_sam,
      produced_mins = v_produced_mins
    WHERE id = v_existing;

    RETURN jsonb_build_object(
      'id', v_existing,
      'lineAllocationId', v_line_allocation_id,
      'firstTimePass', v_kpi.first_time_pass,
      'ftrPct', v_kpi.ftr_pct,
      'defectivePct', v_kpi.defective_pct,
      'dhu', v_kpi.dhu,
      'sam', v_sam,
      'producedMins', v_produced_mins
    );
  END IF;

  v_total := COALESCE((p_payload->>'totalInspected')::integer, 0);
  v_passed := COALESCE((p_payload->>'passed')::integer, 0);
  v_failed := COALESCE((p_payload->>'failed')::integer, 0);
  v_rework := COALESCE((p_payload->>'reworkPassed')::integer, 0);
  v_passed_by := COALESCE(p_payload->'passedBySize', '{}'::jsonb);
  v_failed_by := COALESCE(p_payload->'failedBySize', '{}'::jsonb);
  v_rework_by := COALESCE(p_payload->'reworkBySize', '{}'::jsonb);
  v_defects := COALESCE(p_payload->'defectSummary', '{}'::jsonb);

  SELECT * INTO v_kpi
  FROM public.compute_inspection_session_kpi(
    v_total, v_passed, v_failed, v_rework, v_passed_by, v_rework_by, v_defects
  );

  v_produced_mins := ROUND(COALESCE(v_passed, 0)::numeric * v_sam, 2);

  INSERT INTO public.inspection_sessions (
    factory_id, order_id, colorway_id, department_id, resource_id, shift_id,
    hour_slot, log_date, total_inspected, passed, failed, rework_passed,
    first_time_pass, first_time_pass_by_size,
    passed_by_size, failed_by_size, rework_by_size, defect_summary,
    ftr_pct, defective_pct, dhu, sam, produced_mins,
    started_at, ended_at, logged_by, logged_at, order_route_id, line_allocation_id
  ) VALUES (
    p_factory_id,
    (p_payload->>'orderId')::uuid,
    v_colorway_id,
    v_payload_dept,
    v_resource_id,
    NULLIF(p_payload->>'shiftId', '')::uuid,
    NULLIF(p_payload->>'hourSlot', ''),
    v_log_date,
    v_total, v_passed, v_failed, v_rework,
    v_kpi.first_time_pass, v_kpi.first_time_pass_by_size,
    v_passed_by, v_failed_by, v_rework_by, v_defects,
    v_kpi.ftr_pct, v_kpi.defective_pct, v_kpi.dhu, v_sam, v_produced_mins,
    COALESCE((p_payload->>'startedAt')::timestamptz, now()),
    COALESCE((p_payload->>'endedAt')::timestamptz, now()),
    p_user_id,
    now(),
    v_operation_id,
    v_line_allocation_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'lineAllocationId', v_line_allocation_id,
    'firstTimePass', v_kpi.first_time_pass,
    'ftrPct', v_kpi.ftr_pct,
    'defectivePct', v_kpi.defective_pct,
    'dhu', v_kpi.dhu,
    'sam', v_sam,
    'producedMins', v_produced_mins
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_shipment_audit_session(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_audit_type text := NULLIF(p_payload->>'auditType', '');
  v_status text := COALESCE(NULLIF(p_payload->>'status', ''), 'completed');
  v_session_id uuid := NULLIF(p_payload->>'sessionId', '')::uuid;
  v_floor_status text;
  v_passed integer := COALESCE((p_payload->>'passed')::integer, 0);
  v_failed integer := COALESCE((p_payload->>'failed')::integer, 0);
  v_major integer := COALESCE((p_payload->>'majorFailed')::integer, 0);
  v_minor integer := COALESCE((p_payload->>'minorFailed')::integer, 0);
  v_sample integer := COALESCE((p_payload->>'sampleSize')::integer, 0);
  v_updated integer;
  v_guard jsonb;
BEGIN
  IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
    RETURN public.floor_capture_fail(
      'Not authorized for Shipment / QA audit',
      'APP_NOT_ALLOWED'
    );
  END IF;

  IF v_colorway_id IS NULL OR v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId and colorwayId are required', 'MISSING_FIELDS');
  END IF;

  IF v_audit_type IS NULL OR v_audit_type NOT IN ('midline', 'internal_final', 'shipment', 'reaudit') THEN
    RETURN public.floor_capture_fail('Invalid shipment audit type', 'INVALID_AUDIT_TYPE');
  END IF;

  SELECT shipment_floor_status INTO v_floor_status
  FROM public.colorways
  WHERE id = v_colorway_id AND order_id = v_order_id;

  IF v_floor_status = 'shipped_closed' THEN
    RETURN public.floor_capture_fail(
      'Colorway is closed. Open for re-audit first.',
      'COLORWAY_SHIPPED_CLOSED'
    );
  END IF;

  IF v_floor_status = 'reaudit_open' AND v_audit_type <> 'reaudit' THEN
    RETURN public.floor_capture_fail(
      'Only re-audit sessions are allowed while colorway is open for buyer re-audit',
      'REAUDIT_ONLY'
    );
  END IF;

  IF v_floor_status IN ('active', 'ready_to_ship') AND v_audit_type = 'reaudit' THEN
    RETURN public.floor_capture_fail(
      'Re-audit type is only for buyer rejection reopen',
      'INVALID_AUDIT_TYPE'
    );
  END IF;

  IF COALESCE((p_payload->>'lotSize')::integer, 0) <= 0
     OR v_sample <= 0
     OR v_sample > COALESCE((p_payload->>'lotSize')::integer, 0) THEN
    RETURN public.floor_capture_fail('Invalid lot or sample size', 'INVALID_LOT');
  END IF;

  IF v_status NOT IN ('in_progress', 'completed') THEN
    RETURN public.floor_capture_fail('Invalid audit status', 'INVALID_STATUS');
  END IF;

  IF v_status = 'completed' AND v_session_id IS NOT NULL THEN
    UPDATE public.shipment_audits
    SET
      audit_type = v_audit_type,
      audit_date = COALESCE((p_payload->>'auditDate')::date, CURRENT_DATE),
      lot_size = COALESCE((p_payload->>'lotSize')::integer, 0),
      sample_size = v_sample,
      aql_level = NULLIF(p_payload->>'aqlLevel', ''),
      passed = v_passed,
      failed = v_failed,
      major_failed = v_major,
      minor_failed = v_minor,
      result = NULLIF(p_payload->>'result', ''),
      pieces_json = COALESCE(p_payload->'pieces', '[]'::jsonb),
      status = 'completed',
      notes = NULLIF(p_payload->>'notes', ''),
      completed_at = COALESCE((p_payload->>'completedAt')::timestamptz, now()),
      logged_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    WHERE id = v_session_id
      AND factory_id = p_factory_id
      AND logged_by = p_user_id
      AND status = 'in_progress';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      RETURN jsonb_build_object('id', v_session_id);
    END IF;
  END IF;

  IF v_status = 'in_progress' AND v_session_id IS NOT NULL THEN
    UPDATE public.shipment_audits
    SET
      pieces_json = COALESCE(p_payload->'pieces', '[]'::jsonb),
      passed = v_passed,
      failed = v_failed,
      major_failed = v_major,
      minor_failed = v_minor,
      logged_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now())
    WHERE id = v_session_id
      AND factory_id = p_factory_id
      AND logged_by = p_user_id
      AND status = 'in_progress';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      RETURN jsonb_build_object('id', v_session_id);
    END IF;
  END IF;

  INSERT INTO public.shipment_audits (
    factory_id, order_id, colorway_id, audit_type, audit_date,
    lot_size, sample_size, aql_level, passed, failed, major_failed, minor_failed,
    result, pieces_json, status, notes, logged_by, logged_at, completed_at
  ) VALUES (
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_audit_type,
    COALESCE((p_payload->>'auditDate')::date, CURRENT_DATE),
    COALESCE((p_payload->>'lotSize')::integer, 0),
    v_sample,
    NULLIF(p_payload->>'aqlLevel', ''),
    v_passed,
    v_failed,
    v_major,
    v_minor,
    CASE WHEN v_status = 'completed' THEN NULLIF(p_payload->>'result', '') ELSE NULL END,
    COALESCE(p_payload->'pieces', '[]'::jsonb),
    v_status,
    NULLIF(p_payload->>'notes', ''),
    p_user_id,
    COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
    CASE WHEN v_status = 'completed' THEN COALESCE((p_payload->>'completedAt')::timestamptz, now()) ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_shipment_log(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_operation_id uuid := NULLIF(p_payload->>'operationId', '')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_ship_by_size jsonb := COALESCE(p_payload->'shippedQtyBySize', '{}'::jsonb);
  v_size_sum integer;
  v_po text;
  v_floor_status text;
BEGIN
  IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
    RETURN public.floor_capture_fail(
      'Department not authorized for shipment log',
      'APP_NOT_ALLOWED'
    );
  END IF;

  IF v_order_id IS NULL OR v_colorway_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId and colorwayId are required', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = v_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('Order not found in factory', 'ORDER_NOT_FOUND');
  END IF;

  SELECT c.shipment_floor_status
  INTO v_floor_status
  FROM public.colorways c
  WHERE c.id = v_colorway_id AND c.order_id = v_order_id;

  IF v_floor_status IS NULL THEN
    RETURN public.floor_capture_fail('Colorway not found', 'INVALID_COLORWAY');
  END IF;

  IF v_floor_status NOT IN ('ready_to_ship', 'reaudit_open') THEN
    RETURN public.floor_capture_fail(
      'Colorway is not ready to ship',
      'COLORWAY_NOT_READY',
      jsonb_build_object('shipmentFloorStatus', v_floor_status)
    );
  END IF;

  v_operation_id := COALESCE(v_operation_id, public.terminal_route_operation_id(v_order_id));
  IF v_operation_id IS NULL THEN
    RETURN public.floor_capture_fail(
      'Order has no routing steps — cannot log shipment',
      'MISSING_ROUTE'
    );
  END IF;

  IF v_visit_id IS NULL THEN
    SELECT ors.visit_id INTO v_visit_id
    FROM public.order_routing_steps ors
    WHERE ors.id = v_operation_id;
  END IF;

  IF COALESCE((p_payload->>'shippedQty')::integer, 0) <= 0 THEN
    RETURN public.floor_capture_fail('shippedQty must be a positive integer', 'INVALID_QTY');
  END IF;

  IF p_payload->>'shipmentType' IS NULL OR p_payload->>'shipmentType' NOT IN (
    'main', 'partial', 'replacement', 'sample', 'rejection_return'
  ) THEN
    RETURN public.floor_capture_fail('Invalid shipment type', 'INVALID_SHIPMENT_TYPE');
  END IF;

  IF v_ship_by_size <> '{}'::jsonb THEN
    v_size_sum := public.jsonb_sum_int_values(v_ship_by_size);
    IF v_size_sum <> (p_payload->>'shippedQty')::integer THEN
      RETURN public.floor_capture_fail(
        'shippedQtyBySize sum must equal shippedQty',
        'SIZE_TOTAL_MISMATCH',
        jsonb_build_object(
          'shippedQty', (p_payload->>'shippedQty')::integer,
          'sizeSum', v_size_sum
        )
      );
    END IF;
  END IF;

  SELECT po_number INTO v_po
  FROM public.style_orders
  WHERE id = v_order_id AND factory_id = p_factory_id;

  INSERT INTO public.shipments (
    factory_id,
    order_id,
    colorway_id,
    order_route_id,
    visit_id,
    po_number,
    shipped_qty,
    shipped_qty_by_size,
    shipment_date,
    invoice_number,
    awb_number,
    destination,
    shipment_type,
    notes,
    logged_by,
    logged_at
  ) VALUES (
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_operation_id,
    v_visit_id,
    v_po,
    (p_payload->>'shippedQty')::integer,
    v_ship_by_size,
    COALESCE((p_payload->>'shipmentDate')::date, CURRENT_DATE),
    NULLIF(p_payload->>'invoiceNumber', ''),
    NULLIF(p_payload->>'awbNumber', ''),
    NULLIF(p_payload->>'destination', ''),
    p_payload->>'shipmentType',
    NULLIF(p_payload->>'notes', ''),
    p_user_id,
    COALESCE((p_payload->>'loggedAt')::timestamptz, now())
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'operationId', v_operation_id,
    'visitId', v_visit_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_capture_shipment_rejection_log(p_payload jsonb, p_factory_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_first_id uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_operation_id uuid := NULLIF(p_payload->>'operationId', '')::uuid;
  v_qty integer := COALESCE((p_payload->>'qty')::integer, 0);
  v_reject_by_size jsonb := COALESCE(p_payload->'rejectedQtyBySize', '{}'::jsonb);
  v_size_sum integer;
  v_floor_status text;
  v_stage text := NULLIF(trim(p_payload->>'stage'), '');
  v_reason_code text := COALESCE(NULLIF(p_payload->>'reasonCode', ''), 'Other');
  v_reason_detail text := NULLIF(p_payload->>'reasonDetail', '');
  v_payload_size text := NULLIF(p_payload->>'size', '');
  v_logged_at timestamptz := COALESCE((p_payload->>'loggedAt')::timestamptz, now());
  v_rejected_date date := COALESCE((p_payload->>'rejectedDate')::date, CURRENT_DATE);
  v_notes text := NULLIF(p_payload->>'notes', '');
  v_image_urls text[];
  v_size_key text;
  v_size_qty integer;
  v_defect_summary jsonb;
  v_inserted integer := 0;
BEGIN
  IF NOT public.profile_has_capture_app(p_user_id, p_factory_id, 'shipment_log') THEN
    RETURN public.floor_capture_fail(
      'Not authorized for shipment QA rejection',
      'APP_NOT_ALLOWED'
    );
  END IF;

  IF v_order_id IS NULL OR v_colorway_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId and colorwayId are required', 'MISSING_FIELDS');
  END IF;

  IF v_stage IS NULL THEN
    RETURN public.floor_capture_fail('stage is required', 'MISSING_STAGE');
  END IF;

  IF NOT public.factory_rejection_stage_allowed(p_factory_id, v_stage) THEN
    RETURN public.floor_capture_fail(
      'Invalid rejection stage — configure audit types in support_dropdowns',
      'INVALID_STAGE'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = v_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN public.floor_capture_fail('Order not found in factory', 'ORDER_NOT_FOUND');
  END IF;

  SELECT c.shipment_floor_status
  INTO v_floor_status
  FROM public.colorways c
  WHERE c.id = v_colorway_id AND c.order_id = v_order_id;

  IF v_floor_status IS NULL THEN
    RETURN public.floor_capture_fail('Colorway not found', 'INVALID_COLORWAY');
  END IF;

  IF v_floor_status = 'shipped_closed' THEN
    RETURN public.floor_capture_fail('Colorway is closed for rejection', 'COLORWAY_CLOSED');
  END IF;

  v_operation_id := COALESCE(v_operation_id, public.terminal_route_operation_id(v_order_id));
  IF v_operation_id IS NULL THEN
    RETURN public.floor_capture_fail(
      'Order has no routing steps — cannot log rejection',
      'MISSING_ROUTE'
    );
  END IF;

  IF v_qty <= 0 THEN
    RETURN public.floor_capture_fail('qty must be a positive integer', 'INVALID_QTY');
  END IF;

  IF v_reject_by_size <> '{}'::jsonb THEN
    v_size_sum := public.jsonb_sum_int_values(v_reject_by_size);
    IF v_size_sum <> v_qty THEN
      RETURN public.floor_capture_fail(
        'rejectedQtyBySize sum must equal qty',
        'SIZE_TOTAL_MISMATCH',
        jsonb_build_object('qty', v_qty, 'sizeSum', v_size_sum)
      );
    END IF;
  END IF;

  v_image_urls := COALESCE(
    ARRAY(
      SELECT jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(p_payload->'imageUrls') = 'array' THEN p_payload->'imageUrls'
          ELSE '[]'::jsonb
        END
      )
    ),
    ARRAY[]::text[]
  );

  v_first_id := NULL;
  v_inserted := 0;

  IF v_reject_by_size <> '{}'::jsonb THEN
    FOR v_size_key, v_size_qty IN
      SELECT key, value::integer
      FROM jsonb_each_text(v_reject_by_size)
      WHERE value::integer > 0
    LOOP
      v_defect_summary := COALESCE(p_payload->'defectSummary', '{}'::jsonb);
      IF v_defect_summary = '{}'::jsonb OR v_defect_summary ? v_reason_code THEN
        v_defect_summary := jsonb_build_object(v_reason_code, v_size_qty);
      END IF;

      INSERT INTO public.rejections (
        factory_id,
        order_id,
        colorway_id,
        order_route_id,
        size,
        qty,
        reason_code,
        reason_detail,
        defect_summary,
        rejected_qty_by_size,
        image_urls,
        stage,
        rejected_date,
        notes,
        logged_by,
        logged_at
      ) VALUES (
        p_factory_id,
        v_order_id,
        v_colorway_id,
        v_operation_id,
        v_size_key,
        v_size_qty,
        v_reason_code,
        v_reason_detail,
        v_defect_summary,
        jsonb_build_object(v_size_key, v_size_qty),
        v_image_urls,
        v_stage,
        v_rejected_date,
        v_notes,
        p_user_id,
        v_logged_at
      )
      RETURNING id INTO v_id;

      IF v_first_id IS NULL THEN
        v_first_id := v_id;
      END IF;
      v_inserted := v_inserted + 1;
    END LOOP;
  ELSE
    v_defect_summary := COALESCE(p_payload->'defectSummary', '{}'::jsonb);
    IF v_defect_summary = '{}'::jsonb THEN
      v_defect_summary := jsonb_build_object(v_reason_code, v_qty);
    END IF;

    INSERT INTO public.rejections (
      factory_id,
      order_id,
      colorway_id,
      order_route_id,
      size,
      qty,
      reason_code,
      reason_detail,
      defect_summary,
      rejected_qty_by_size,
      image_urls,
      stage,
      rejected_date,
      notes,
      logged_by,
      logged_at
    ) VALUES (
      p_factory_id,
      v_order_id,
      v_colorway_id,
      v_operation_id,
      v_payload_size,
      v_qty,
      v_reason_code,
      v_reason_detail,
      v_defect_summary,
      CASE
        WHEN v_payload_size IS NOT NULL THEN jsonb_build_object(v_payload_size, v_qty)
        ELSE '{}'::jsonb
      END,
      v_image_urls,
      v_stage,
      v_rejected_date,
      v_notes,
      p_user_id,
      v_logged_at
    )
    RETURNING id INTO v_id;

    v_first_id := v_id;
    v_inserted := 1;
  END IF;

  RETURN jsonb_build_object(
    'id', v_first_id,
    'operationId', v_operation_id,
    'inserted', v_inserted
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_resolve_operation_step(p_factory_id uuid, p_user_id uuid, p_colorway_id uuid, p_flow_step_id uuid, p_expected_capture_app text DEFAULT NULL::text, p_skip_app_check boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_department_id uuid;
  v_order_id uuid;
  v_ctx record;
BEGIN
  IF p_flow_step_id IS NULL THEN
    RETURN public.floor_capture_fail('operationId is required', 'MISSING_OPERATION');
  END IF;
  IF p_colorway_id IS NULL THEN
    RETURN public.floor_capture_fail('colorwayId is required', 'INVALID_COLORWAY');
  END IF;

  SELECT p.department_id INTO v_profile_department_id
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active';

  SELECT so.id INTO v_order_id
  FROM public.colorways cw JOIN public.style_orders so ON so.id = cw.order_id
  WHERE cw.id = p_colorway_id AND so.factory_id = p_factory_id;

  IF v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('Colorway not found in factory', 'INVALID_COLORWAY');
  END IF;

  SELECT * INTO v_ctx FROM public.resolve_order_route_context(p_factory_id, p_flow_step_id);

  IF v_ctx.order_route_id IS NULL OR v_ctx.order_id IS DISTINCT FROM v_order_id THEN
    RETURN public.floor_capture_fail('operationId is not part of this order route', 'INVALID_OPERATION');
  END IF;

  IF v_profile_department_id IS NULL OR v_ctx.department_id IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail('Operation department must match user department', 'DEPT_MISMATCH',
      jsonb_build_object('expectedDepartmentId', v_profile_department_id));
  END IF;

  IF p_expected_capture_app IS NOT NULL AND v_ctx.capture_app IS DISTINCT FROM p_expected_capture_app THEN
    RETURN public.floor_capture_fail('Operation capture_app does not match this capture type', 'CAPTURE_APP_MISMATCH',
      jsonb_build_object('expectedCaptureApp', p_expected_capture_app, 'stepCaptureApp', v_ctx.capture_app));
  END IF;

  IF NOT p_skip_app_check AND NOT public.profile_dept_has_app(p_user_id, p_factory_id, v_ctx.capture_app) THEN
    RETURN public.floor_capture_fail('Department not authorized for this operation app', 'REQUIRE_APP',
      jsonb_build_object('captureApp', v_ctx.capture_app));
  END IF;

  RETURN jsonb_build_object('ok', true, 'operation_id', v_ctx.order_route_id,
    'department_id', v_ctx.department_id, 'capture_app', v_ctx.capture_app, 'route_seq', v_ctx.route_seq);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_resolve_order_route_step(p_factory_id uuid, p_user_id uuid, p_order_id uuid, p_order_route_id uuid, p_expected_capture_app text DEFAULT NULL::text, p_skip_app_check boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_department_id uuid;
  v_ctx record;
BEGIN
  IF p_order_route_id IS NULL THEN
    RETURN public.floor_capture_fail('orderRouteId is required', 'MISSING_OPERATION');
  END IF;

  IF p_order_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId is required', 'INVALID_ORDER');
  END IF;

  SELECT p.department_id
  INTO v_profile_department_id
  FROM public.profiles p
  WHERE p.id = p_user_id
    AND p.factory_id = p_factory_id
    AND p.status = 'Active';

  SELECT *
  INTO v_ctx
  FROM public.resolve_order_route_context(p_factory_id, p_order_route_id);

  IF v_ctx.order_route_id IS NULL OR v_ctx.order_id IS DISTINCT FROM p_order_id THEN
    RETURN public.floor_capture_fail(
      'orderRouteId is not on this order route',
      'INVALID_OPERATION'
    );
  END IF;

  IF v_profile_department_id IS NULL
     OR v_ctx.department_id IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail(
      'Operation department must match user department',
      'DEPT_MISMATCH',
      jsonb_build_object('expectedDepartmentId', v_profile_department_id)
    );
  END IF;

  IF p_expected_capture_app IS NOT NULL
     AND v_ctx.capture_app IS DISTINCT FROM p_expected_capture_app THEN
    RETURN public.floor_capture_fail(
      'Operation capture_app does not match this capture type',
      'CAPTURE_APP_MISMATCH',
      jsonb_build_object(
        'expectedCaptureApp', p_expected_capture_app,
        'stepCaptureApp', v_ctx.capture_app
      )
    );
  END IF;

  IF NOT p_skip_app_check AND NOT public.profile_dept_has_app(
    p_user_id,
    p_factory_id,
    COALESCE(v_ctx.capture_app, p_expected_capture_app, 'hourly')
  ) THEN
    RETURN public.floor_capture_fail(
      'Department not authorized for this capture app',
      'REQUIRE_APP',
      jsonb_build_object('captureApp', v_ctx.capture_app)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_route_id', v_ctx.order_route_id,
    'department_id', v_ctx.department_id,
    'capture_app', v_ctx.capture_app,
    'step_label', v_ctx.step_label
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_user_can_log_workforce(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_profile_id
      AND p.user_role IN ('supervisor', 'quality_manager')
      AND COALESCE(p.workforce_enabled, false)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.floor_user_department_id(p_profile_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.department_id FROM public.profiles p WHERE p.id = p_profile_id;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_user_derived_apps(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_apps     jsonb := '[]'::jsonb;
  v_cap      text;
  v_prof     public.profiles%ROWTYPE;
  v_shipment jsonb;
BEGIN
  SELECT * INTO v_prof FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_cap IN
    SELECT DISTINCT o.capture_app
    FROM public.floor_user_access fa
    JOIN public.operations o ON o.id = fa.operation_id
    WHERE fa.profile_id = p_profile_id
      AND fa.grant_ended_at IS NULL
      AND o.is_active = true
      AND v_prof.can_produce
      AND o.capture_app IS NOT NULL
      AND o.capture_app NOT IN ('transaction', 'none', 'shipment_qa')
  LOOP
    IF NOT v_apps @> to_jsonb(v_cap) THEN
      v_apps := v_apps || to_jsonb(v_cap);
    END IF;
  END LOOP;

  IF COALESCE(v_prof.handover_enabled, false) THEN
    v_apps := v_apps || '"transaction"'::jsonb;
  END IF;
  IF COALESCE(v_prof.workforce_enabled, false) THEN
    v_apps := v_apps || '"supervisor"'::jsonb;
  END IF;
  IF COALESCE(v_prof.audit_enabled, false) THEN
    v_apps := v_apps || '"audit"'::jsonb;
  END IF;

  IF COALESCE(v_prof.shipment_qa_enabled, false) THEN
    SELECT COALESCE(f.shipment_apps, '[]'::jsonb)
    INTO v_shipment
    FROM public.factories f
    WHERE f.id = v_prof.factory_id;
    v_apps := v_apps || COALESCE(v_shipment, '[]'::jsonb);
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(DISTINCT val ORDER BY val), '[]'::jsonb)
    FROM (SELECT jsonb_array_elements_text(v_apps) AS val) s
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_user_operation_ids_json(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    jsonb_agg(DISTINCT to_jsonb(fa.operation_id)),
    '[]'::jsonb
  )
  FROM public.floor_user_access fa
  WHERE fa.profile_id = p_profile_id
    AND fa.grant_ended_at IS NULL;
$function$
;

CREATE OR REPLACE FUNCTION public.floor_validate_handover_steps(p_factory_id uuid, p_colorway_id uuid, p_from_flow_step_id uuid, p_to_flow_step_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_from public.order_routing_steps%ROWTYPE;
  v_to public.order_routing_steps%ROWTYPE;
  v_next_id uuid;
BEGIN
  IF p_colorway_id IS NULL THEN
    RETURN public.floor_capture_fail('colorwayId is required', 'INVALID_COLORWAY');
  END IF;
  IF p_from_flow_step_id IS NULL OR p_to_flow_step_id IS NULL THEN
    RETURN public.floor_capture_fail('operationId and toOperationId are required', 'MISSING_OPERATION');
  END IF;

  SELECT so.id INTO v_order_id
  FROM public.colorways cw JOIN public.style_orders so ON so.id = cw.order_id
  WHERE cw.id = p_colorway_id AND so.factory_id = p_factory_id;
  IF v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('Colorway not found in factory', 'INVALID_COLORWAY');
  END IF;

  SELECT * INTO v_from FROM public.order_routing_steps
  WHERE id = p_from_flow_step_id AND order_id = v_order_id AND factory_id = p_factory_id;
  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('Invalid from operationId', 'INVALID_OPERATION');
  END IF;

  SELECT * INTO v_to FROM public.order_routing_steps
  WHERE id = p_to_flow_step_id AND order_id = v_order_id AND factory_id = p_factory_id;
  IF NOT FOUND THEN
    RETURN public.floor_capture_fail('Invalid to operationId', 'INVALID_OPERATION');
  END IF;

  SELECT s.id INTO v_next_id FROM public.order_routing_steps s
  WHERE s.order_id = v_order_id AND s.factory_id = p_factory_id AND s.seq > v_from.seq
  ORDER BY s.seq ASC LIMIT 1;

  IF v_next_id IS NULL OR v_next_id IS DISTINCT FROM p_to_flow_step_id THEN
    RETURN public.floor_capture_fail('toOperationId must be the next operation in the route', 'INVALID_HANDOVER_ROUTE',
      jsonb_build_object('expectedToOperationId', v_next_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'from_department_id', v_from.dept_id, 'to_department_id', v_to.dept_id,
    'from_operation_id', v_from.id, 'to_operation_id', v_to.id, 'from_visit_id', v_from.visit_id, 'order_id', v_order_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_audit_report(p_factory_id uuid, p_date_from date, p_date_to date, p_colorway_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, department_id uuid, log_date date, lots integer, total_samples integer, total_passed integer, total_failed integer, total_major_failed integer, total_minor_failed integer, aql_level text, aql_pass_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT a.factory_id, a.order_id, a.colorway_id, a.department_id, a.log_date,
         sum(a.lots)::integer AS lots,
         sum(a.samples_inspected)::integer AS total_samples,
         sum(a.passed)::integer AS total_passed,
         sum(a.failed)::integer AS total_failed,
         sum(a.major_failed)::integer AS total_major_failed,
         sum(a.minor_failed)::integer AS total_minor_failed,
         (array_agg(a.aql_level ORDER BY a.log_date DESC))[1] AS aql_level,
         CASE WHEN sum(a.samples_inspected)=0 THEN NULL::numeric
              ELSE round(100.0*sum(a.passed)::numeric/sum(a.samples_inspected)::numeric,2) END AS aql_pass_pct
  FROM v_daily_audit a
  WHERE a.factory_id = p_factory_id
    AND a.log_date >= p_date_from
    AND a.log_date <= p_date_to
    AND (p_colorway_id IS NULL OR a.colorway_id = p_colorway_id)
    AND (p_order_id IS NULL OR a.order_id = p_order_id)
    AND (p_department_id IS NULL OR a.department_id = p_department_id)
  GROUP BY a.factory_id, a.order_id, a.colorway_id, a.department_id, a.log_date
  ORDER BY a.log_date, a.department_id, a.order_id, a.colorway_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cut_to_ship_detail(p_factory_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT public.get_order_detail_bundle(p_factory_id, p_order_id);
$function$
;

CREATE OR REPLACE FUNCTION public.get_cut_to_ship_journey(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, dept_id uuid, dept_name text, flow_step integer, is_in_flow boolean, qty_received integer, qty_produced integer, qty_sent integer, qty_rejected integer, wip_qty integer, wip_qty_by_size jsonb, qty_received_by_size jsonb, qty_produced_by_size jsonb, qty_sent_by_size jsonb, qty_rejected_by_size jsonb, status text, operation_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    j.factory_id, j.order_id, j.colorway_id, j.dept_id, j.dept_name,
    j.flow_step, j.is_in_flow, j.qty_received, j.qty_produced, j.qty_sent,
    j.qty_rejected, j.wip_qty, j.wip_qty_by_size, j.qty_received_by_size,
    j.qty_produced_by_size, j.qty_sent_by_size, j.qty_rejected_by_size, j.status, j.operation_id
  FROM public.v_cut_to_ship_dept_journey j
  WHERE j.factory_id = p_factory_id AND j.order_id = p_order_id
    AND (p_colorway_id IS NULL OR j.colorway_id IS NOT DISTINCT FROM p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.get_cut_to_ship_report(p_factory_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_buyer_id uuid DEFAULT NULL::uuid, p_balanced_only boolean DEFAULT NULL::boolean)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, style_name text, buyer_name text, po_number text, order_qty integer, cut_qty integer, cut_qty_source text, shipped_qty integer, rejected_qty integer, wip_qty integer, reconciliation_gap integer, is_balanced boolean, completion_pct numeric, order_status text, last_shipment_date date, cut_qty_by_size jsonb, cut_qty_by_component jsonb, shipped_qty_by_size jsonb, rejected_qty_by_size jsonb, wip_qty_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cw_base AS (
    SELECT
      so.factory_id,
      so.id AS order_id,
      cw.id AS colorway_id,
      so.style_name,
      so.buyer_name,
      so.po_number,
      so.status AS order_status,
      COALESCE(so.adj_qty, so.order_qty, 0) AS order_qty,
      public.aggregate_order_cut_qty(so.factory_id, so.id, cw.id) AS cut_agg
    FROM public.style_orders so
    JOIN public.colorways cw ON cw.order_id = so.id
    WHERE so.factory_id = p_factory_id
      AND (p_buyer_id IS NULL OR so.buyer_id = p_buyer_id)
  ),
  ship_agg AS (
    SELECT
      s.order_id,
      s.colorway_id,
      SUM(s.shipped_qty)::integer AS shipped_qty,
      MAX(s.shipment_date) AS last_shipment_date,
      public.jsonb_merge_sum_maps(array_agg(COALESCE(s.shipped_qty_by_size, '{}'::jsonb))) AS shipped_qty_by_size
    FROM public.shipments s
    WHERE s.factory_id = p_factory_id
      AND (p_date_from IS NULL OR s.shipment_date >= p_date_from)
      AND (p_date_to IS NULL OR s.shipment_date <= p_date_to)
    GROUP BY s.order_id, s.colorway_id
  ),
  rej_size AS (
    SELECT
      r.order_id,
      r.colorway_id,
      COALESCE(NULLIF(r.size, ''), 'TOTAL') AS size_key,
      SUM(r.qty)::integer AS qty
    FROM public.rejections r
    WHERE r.factory_id = p_factory_id
    GROUP BY r.order_id, r.colorway_id, COALESCE(NULLIF(r.size, ''), 'TOTAL')
  ),
  rej_agg AS (
    SELECT
      order_id,
      colorway_id,
      SUM(qty)::integer AS rejected_qty,
      jsonb_object_agg(size_key, qty) AS rejected_qty_by_size
    FROM rej_size
    GROUP BY order_id, colorway_id
  ),
  combined AS (
    SELECT
      cb.factory_id,
      cb.order_id,
      cb.colorway_id,
      cb.style_name,
      cb.buyer_name,
      cb.po_number,
      cb.order_qty,
      cb.order_status,
      COALESCE((cb.cut_agg->>'cut_qty')::integer, cb.order_qty) AS cut_qty,
      COALESCE(cb.cut_agg->>'cut_qty_source', 'planned') AS cut_qty_source,
      COALESCE(cb.cut_agg->'cut_qty_by_size', '{}'::jsonb) AS cut_qty_by_size,
      COALESCE(cb.cut_agg->'cut_qty_by_component', '[]'::jsonb) AS cut_qty_by_component,
      COALESCE(sa.shipped_qty, 0) AS shipped_qty,
      COALESCE(sa.shipped_qty_by_size, '{}'::jsonb) AS shipped_qty_by_size,
      sa.last_shipment_date,
      COALESCE(ra.rejected_qty, 0) AS rejected_qty,
      COALESCE(ra.rejected_qty_by_size, '{}'::jsonb) AS rejected_qty_by_size
    FROM cw_base cb
    LEFT JOIN ship_agg sa ON sa.order_id = cb.order_id AND sa.colorway_id = cb.colorway_id
    LEFT JOIN rej_agg ra ON ra.order_id = cb.order_id AND ra.colorway_id = cb.colorway_id
  )
  SELECT
    c.factory_id,
    c.order_id,
    c.colorway_id,
    c.style_name,
    c.buyer_name,
    c.po_number,
    c.order_qty,
    c.cut_qty,
    c.cut_qty_source,
    c.shipped_qty,
    c.rejected_qty,
    GREATEST(c.cut_qty - c.shipped_qty - c.rejected_qty, 0) AS wip_qty,
    GREATEST(c.cut_qty - c.shipped_qty - c.rejected_qty, 0) AS reconciliation_gap,
    (c.cut_qty - c.shipped_qty - c.rejected_qty) <= 0 AS is_balanced,
    CASE WHEN c.cut_qty > 0 THEN ROUND(100.0 * (c.shipped_qty + c.rejected_qty) / c.cut_qty, 1) ELSE NULL END AS completion_pct,
    c.order_status,
    c.last_shipment_date,
    c.cut_qty_by_size,
    c.cut_qty_by_component,
    c.shipped_qty_by_size,
    c.rejected_qty_by_size,
    '{}'::jsonb AS wip_qty_by_size
  FROM combined c
  WHERE p_balanced_only IS NULL
     OR ((c.cut_qty - c.shipped_qty - c.rejected_qty) <= 0) = p_balanced_only
  ORDER BY c.po_number, c.style_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cutting_department_id(p_factory_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT ors.dept_id
      FROM public.order_routing_steps ors
      WHERE ors.factory_id = p_factory_id
        AND COALESCE(ors.step_type, 'produce') = 'produce'
        AND ors.dept_id IS NOT NULL
      ORDER BY ors.seq
      LIMIT 1
    ),
    (
      SELECT d.id FROM public.departments d
      WHERE d.factory_id = p_factory_id AND d.name ILIKE 'cutting'
      ORDER BY d.id LIMIT 1
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_cutting_department_id_for_order(p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ors.dept_id FROM public.order_routing_steps ors
     WHERE ors.order_id = p_order_id AND ors.step_type = 'produce' AND ors.dept_id IS NOT NULL
     ORDER BY ors.seq LIMIT 1),
    (SELECT d.id FROM public.style_orders so
     JOIN public.departments d ON d.factory_id = so.factory_id AND d.name ILIKE 'cutting' AND d.is_production = true
     WHERE so.id = p_order_id ORDER BY d.id LIMIT 1)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_department_kpis_by_shift(p_factory_id uuid, p_department_id uuid, p_date_from date, p_date_to date)
 RETURNS TABLE(factory_id uuid, order_id uuid, department_id uuid, operation_id uuid, log_date date, shift_id uuid, shift_name text, daily_target integer, shift_output integer, shift_produced_mins numeric, shift_headcount integer, shift_available_mins integer, has_workforce boolean, has_output boolean, data_completeness text, shift_efficiency_pct numeric, shift_productivity numeric, dhu numeric, defective_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$SELECT
    s.factory_id, s.order_id, s.department_id, s.operation_id, s.log_date,
    s.shift_id, s.shift_name, s.daily_target, s.shift_output, s.shift_produced_mins,
    s.shift_headcount, s.shift_available_mins, s.has_workforce, s.has_output,
    s.data_completeness, s.shift_efficiency_pct, s.shift_productivity, s.dhu, s.defective_pct
  FROM public.v_department_kpis_by_shift s
  WHERE s.factory_id = p_factory_id
    AND s.department_id = p_department_id
    AND s.log_date BETWEEN p_date_from AND p_date_to;$function$
;

CREATE OR REPLACE FUNCTION public.get_dept_quality_for_date(p_factory_id uuid, p_department_id uuid, p_log_date date)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, department_id uuid, operation_id uuid, resource_id uuid, log_date date, shift_id uuid, inspected integer, first_time_pass integer, rework_pass integer, total_pass integer, failed integer, dhu numeric, defective_pct numeric, ftr_pct numeric, top_defects jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    q.factory_id, q.order_id, q.colorway_id, q.department_id, q.operation_id,
    q.resource_id, q.log_date, q.shift_id, q.inspected, q.first_time_pass,
    q.rework_pass, q.total_pass, q.failed, q.dhu, q.defective_pct, q.ftr_pct,
    q.top_defects
  FROM public.v_daily_quality q
  WHERE q.factory_id = p_factory_id
    AND q.department_id = p_department_id
    AND q.log_date = p_log_date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_factory_primary_fabric_component(p_factory_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT fc.id
  FROM public.fabric_components fc
  WHERE fc.factory_id = p_factory_id
    AND fc.is_primary IS TRUE
  ORDER BY fc.created_at
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_factory_production_summary(p_factory_id uuid)
 RETURNS TABLE(order_id uuid, colorway_id uuid, department_id uuid, operation_id uuid, output_qty integer, log_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH route AS (
    SELECT
      ors.factory_id,
      ors.order_id,
      ors.id AS operation_id,
      ors.dept_id AS department_id,
      COALESCE(ors.capture_app, CASE WHEN ors.step_type = 'loading' THEN 'hourly' WHEN ors.step_type = 'outsource' THEN 'outsource' ELSE 'transaction' END) AS capture_app,
      COALESCE(d.role, 'standard') AS dept_role,
      ors.seq,
      COALESCE(ors.is_primary_output, false) AS is_primary_output,
      COALESCE(ors.step_type, 'produce') AS step_type
    FROM public.order_routing_steps ors
        LEFT JOIN public.departments d ON d.id = ors.dept_id
    WHERE ors.factory_id = p_factory_id
  ),
  hourly AS (
    SELECT h.order_id, h.colorway_id, r.department_id, resolved.operation_id,
      h.log_date, SUM(h.count)::integer AS output_qty
    FROM public.hourly_counts h
    CROSS JOIN LATERAL (
      SELECT public.resolve_capture_order_route_id(
        h.factory_id, h.order_id, h.department_id, h.order_route_id, h.line_allocation_id, ARRAY['hourly']
      ) AS operation_id
    ) resolved
    JOIN route r ON r.operation_id = resolved.operation_id
    WHERE h.factory_id = p_factory_id
      AND COALESCE(h.count, 0) > 0
      AND r.dept_role NOT IN ('origin', 'terminal')
      AND (
        r.capture_app = 'hourly'
        OR r.step_type IN ('loading', 'produce')
      )
    GROUP BY h.order_id, h.colorway_id, r.department_id, resolved.operation_id, h.log_date
  ),
  qc AS (
    SELECT s.order_id, s.colorway_id, r.department_id, resolved.operation_id,
      s.log_date, SUM(COALESCE(s.passed, 0))::integer AS output_qty
    FROM public.inspection_sessions s
    CROSS JOIN LATERAL (
      SELECT public.resolve_capture_order_route_id(
        s.factory_id, s.order_id, s.department_id, s.order_route_id, s.line_allocation_id, ARRAY['qc_log']
      ) AS operation_id
    ) resolved
    JOIN route r ON r.operation_id = resolved.operation_id
    WHERE s.factory_id = p_factory_id
      AND r.dept_role NOT IN ('origin', 'terminal')
      AND r.capture_app IN ('qc_log', 'shipment_qa')
    GROUP BY s.order_id, s.colorway_id, r.department_id, resolved.operation_id, s.log_date
  ),
  batch AS (
    SELECT bp.order_id, bp.colorway_id, r.department_id, resolved.operation_id,
      bp.log_date, SUM(COALESCE(bp.produced_qty, 0))::integer AS output_qty
    FROM public.batch_production bp
    CROSS JOIN LATERAL (
      SELECT public.resolve_capture_order_route_id(
        bp.factory_id, bp.order_id, bp.department_id, bp.order_route_id, bp.line_allocation_id, ARRAY['batch']
      ) AS operation_id
    ) resolved
    JOIN route r ON r.operation_id = resolved.operation_id
    WHERE bp.factory_id = p_factory_id
      AND COALESCE(bp.produced_qty, 0) > 0
      AND r.dept_role NOT IN ('origin', 'terminal')
      AND r.capture_app = 'batch'
    GROUP BY bp.order_id, bp.colorway_id, r.department_id, resolved.operation_id, bp.log_date
  ),
  cutting AS (
    SELECT
      cb.order_id,
      cb.colorway_id,
      r.department_id,
      r.operation_id,
      COALESCE(cs.log_date, (cb.created_at AT TIME ZONE 'UTC')::date) AS log_date,
      SUM(cb.qty)::integer AS output_qty
    FROM public.cutting_bundles cb
    LEFT JOIN public.cutting_sessions cs ON cs.id = cb.session_id
    JOIN LATERAL (
      SELECT r2.department_id, r2.operation_id
      FROM route r2
      WHERE r2.factory_id = cb.factory_id
        AND r2.order_id = cb.order_id
        AND r2.dept_role = 'origin'
        AND r2.capture_app IN ('cutting_lay', 'cutting_bundle')
        AND (cs.order_route_id IS NULL OR r2.operation_id = cs.order_route_id)
      ORDER BY (r2.operation_id = cs.order_route_id) DESC, r2.is_primary_output DESC, r2.seq
      LIMIT 1
    ) r ON true
    WHERE cb.factory_id = p_factory_id
      AND COALESCE(cb.qty, 0) > 0
      AND (
        cb.fabric_component_id = public.get_factory_primary_fabric_component(cb.factory_id)
        OR (
          cb.fabric_component_id IS NULL
          AND public.get_factory_primary_fabric_component(cb.factory_id) IS NOT NULL
        )
      )
    GROUP BY cb.order_id, cb.colorway_id, r.department_id, r.operation_id, COALESCE(cs.log_date, (cb.created_at AT TIME ZONE 'UTC')::date)
  ),
  shipment AS (
    SELECT
      s.order_id,
      s.colorway_id,
      r.department_id,
      r.operation_id,
      s.shipment_date AS log_date,
      SUM(s.shipped_qty)::integer AS output_qty
    FROM public.shipments s
    JOIN LATERAL (
      SELECT r2.department_id, r2.operation_id
      FROM route r2
      WHERE r2.factory_id = s.factory_id
        AND r2.order_id = s.order_id
        AND r2.dept_role = 'terminal'
        AND (s.order_route_id IS NULL OR r2.operation_id = s.order_route_id)
      ORDER BY (r2.operation_id = s.order_route_id) DESC, r2.is_primary_output DESC, r2.seq DESC
      LIMIT 1
    ) r ON true
    WHERE s.factory_id = p_factory_id
      AND COALESCE(s.shipped_qty, 0) > 0
    GROUP BY s.order_id, s.colorway_id, r.department_id, r.operation_id, s.shipment_date
  ),
  outsource AS (
    SELECT
      owm.order_id,
      owm.colorway_id,
      r.department_id,
      resolved.operation_id,
      (owm.occurred_at AT TIME ZONE 'UTC')::date AS log_date,
      SUM(owm.qty)::integer AS output_qty
    FROM public.outsource_work_movements owm
    CROSS JOIN LATERAL (
      SELECT public.resolve_capture_order_route_id(
        owm.factory_id, owm.order_id, owm.department_id, owm.order_route_id, owm.line_allocation_id, ARRAY['outsource']
      ) AS operation_id
    ) resolved
    JOIN route r ON r.operation_id = resolved.operation_id
    WHERE owm.factory_id = p_factory_id
      AND owm.movement_type = 'vendor_receive'
      AND owm.voided_at IS NULL
      AND r.dept_role NOT IN ('origin', 'terminal')
      AND (r.capture_app = 'outsource' OR r.step_type = 'outsource')
    GROUP BY owm.order_id, owm.colorway_id, r.department_id, resolved.operation_id, (owm.occurred_at AT TIME ZONE 'UTC')::date
  )
  SELECT order_id, colorway_id, department_id, operation_id, output_qty, log_date FROM hourly
  UNION ALL
  SELECT order_id, colorway_id, department_id, operation_id, output_qty, log_date FROM qc
  UNION ALL
  SELECT order_id, colorway_id, department_id, operation_id, output_qty, log_date FROM batch
  UNION ALL
  SELECT order_id, colorway_id, department_id, operation_id, output_qty, log_date FROM cutting
  UNION ALL
  SELECT order_id, colorway_id, department_id, operation_id, output_qty, log_date FROM shipment
  UNION ALL
  SELECT order_id, colorway_id, department_id, operation_id, output_qty, log_date FROM outsource;
$function$
;

CREATE OR REPLACE FUNCTION public.get_factory_schedule_actuals(p_factory_id uuid)
 RETURNS TABLE(line_allocation_id uuid, order_id uuid, colorway_id uuid, department_id uuid, operation_id uuid, qty integer, first_output_date date, last_output_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_line_allocation_actuals(p_factory_id, NULL::uuid, NULL::uuid);
$function$
;

CREATE OR REPLACE FUNCTION public.get_floor_bootstrap(p_factory_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_factory_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.factories f WHERE f.id = p_factory_id) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'departments', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.sequence)
      FROM public.departments d
      WHERE d.factory_id = p_factory_id
    ), '[]'::jsonb),
    'orders', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(o) || jsonb_build_object(
          'colorways', COALESCE((
            SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
            FROM public.colorways c
            WHERE c.order_id = o.id
          ), '[]'::jsonb)
        )
        ORDER BY o.created_at DESC
      )
      FROM public.style_orders o
      WHERE o.factory_id = p_factory_id
    ), '[]'::jsonb),
    'resources', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resource_name)
      FROM public.assigned_resources r
      WHERE r.factory_id = p_factory_id
    ), '[]'::jsonb),
    'shifts', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name)
      FROM public.shifts s
      WHERE s.factory_id = p_factory_id
    ), '[]'::jsonb),
    'workers', '[]'::jsonb,
    'flows', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(f) || jsonb_build_object(
          'process_flow_steps', COALESCE((
            SELECT jsonb_agg(to_jsonb(s) ORDER BY s.flow_step)
            FROM public.process_flow_steps s
            WHERE s.flow_id = f.id
          ), '[]'::jsonb)
        )
      )
      FROM public.process_flows f
      WHERE f.factory_id = p_factory_id
    ), '[]'::jsonb),
    'hourly', COALESCE((
      SELECT jsonb_agg(to_jsonb(h) ORDER BY h.logged_at DESC)
      FROM (
        SELECT * FROM public.hourly_counts
        WHERE factory_id = p_factory_id
        ORDER BY logged_at DESC
        LIMIT 500
      ) h
    ), '[]'::jsonb),
    'slips', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sent_at DESC)
      FROM (
        SELECT * FROM public.handover_slips
        WHERE factory_id = p_factory_id
        ORDER BY sent_at DESC
        LIMIT 500
      ) s
    ), '[]'::jsonb),
    'inspections', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.logged_at DESC)
      FROM (
        SELECT * FROM public.inspections
        WHERE factory_id = p_factory_id
        ORDER BY logged_at DESC
        LIMIT 500
      ) i
    ), '[]'::jsonb),
    'workforce', COALESCE((
      SELECT jsonb_agg(to_jsonb(w) ORDER BY w.logged_at DESC)
      FROM (
        SELECT * FROM public.workforce_logs
        WHERE factory_id = p_factory_id
        ORDER BY logged_at DESC
        LIMIT 200
      ) w
    ), '[]'::jsonb),
    'attendance', '[]'::jsonb,
    'audits', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.logged_at DESC)
      FROM (
        SELECT * FROM public.audit_sessions
        WHERE factory_id = p_factory_id
        ORDER BY logged_at DESC
        LIMIT 200
      ) a
    ), '[]'::jsonb),
    'allocations', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.line_allocations a
      WHERE a.factory_id = p_factory_id
    ), '[]'::jsonb),
    'shipments', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.logged_at DESC)
      FROM (
        SELECT * FROM public.shipments
        WHERE factory_id = p_factory_id
        ORDER BY logged_at DESC
        LIMIT 200
      ) s
    ), '[]'::jsonb),
    'rejections', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.logged_at DESC)
      FROM (
        SELECT * FROM public.rejections
        WHERE factory_id = p_factory_id
        ORDER BY logged_at DESC
        LIMIT 200
      ) r
    ), '[]'::jsonb),
    'transaction_apps', COALESCE((SELECT f.transaction_apps FROM public.factories f WHERE f.id = p_factory_id), '[]'::jsonb),
    'production_apps', COALESCE((SELECT f.production_apps FROM public.factories f WHERE f.id = p_factory_id), '[]'::jsonb),
    'workforce_apps', COALESCE((SELECT f.workforce_apps FROM public.factories f WHERE f.id = p_factory_id), '[]'::jsonb),
    'audit_apps', COALESCE((SELECT f.audit_apps FROM public.factories f WHERE f.id = p_factory_id), '[]'::jsonb),
    'shipment_apps', COALESCE((SELECT f.shipment_apps FROM public.factories f WHERE f.id = p_factory_id), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_floor_users(p_factory_code text)
 RETURNS TABLE(id uuid, full_name text, user_role text, department_id uuid, handover_enabled boolean, workforce_enabled boolean, audit_enabled boolean, assigned_apps jsonb, assigned_operation_ids jsonb, can_log_workforce boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.full_name,
    p.user_role,
    p.department_id,
    COALESCE(p.handover_enabled, false),
    COALESCE(p.workforce_enabled, false),
    COALESCE(p.audit_enabled, false),
    public.floor_user_derived_apps(p.id),
    public.floor_user_operation_ids_json(p.id),
    public.floor_user_can_log_workforce(p.id)
  FROM public.profiles p
  JOIN public.factories f ON f.id = p.factory_id
  WHERE lower(f.code) = lower(trim(p_factory_code))
    AND p.status = 'Active'
    AND p.user_role IN ('operator', 'supervisor', 'auditor', 'quality_manager')
    AND p.department_id IS NOT NULL
  ORDER BY p.full_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_handover_report(p_factory_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_from_department_id uuid DEFAULT NULL::uuid, p_to_department_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid, p_colorway_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, order_id uuid, colorway_id uuid, from_department_id uuid, to_department_id uuid, sent_qty integer, received_qty integer, qty_by_size jsonb, received_qty_by_size jsonb, sent_at timestamp with time zone, received_at timestamp with time zone, status text, challan_number text, notes text, received_notes text, sent_by uuid, received_by uuid, style_name text, po_number text, colorway_name text, color_code text, from_department_name text, to_department_name text, sent_by_name text, received_by_name text, from_produce_operation_names text, to_produce_operation_names text, from_resource_name text, to_resource_name text, log_date date, shift_id uuid, shift_name text, hour_slot text, loss_closed_by uuid, loss_closed_by_name text, loss_closed_at timestamp with time zone, loss_remark text, loss_rejection_id uuid, missing_in_transit integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    hs.id, hs.order_id, hs.colorway_id, hs.from_department_id, hs.to_department_id,
    hs.sent_qty, hs.received_qty, COALESCE(hs.qty_by_size, '{}'::jsonb),
    COALESCE(hs.received_qty_by_size, '{}'::jsonb), hs.sent_at, hs.received_at,
    hs.status, hs.challan_number, hs.notes, hs.received_notes, hs.sent_by, hs.received_by,
    so.style_name, so.po_number, cw.name, cw.color_code, fd.name, td.name, sp.full_name,
    rp.full_name, COALESCE(from_produce_ops.names, from_route_op.name),
    COALESCE(to_produce_ops.names, to_route_op.name), from_resource.resource_name,
    to_resource.resource_name, hs.sent_at::date,
    public.infer_shift_id_for_inspection(p_factory_id, hs.sent_at), sh.name,
    public.infer_hour_slot_for_timestamp(p_factory_id, hs.sent_at),
    hs.loss_closed_by, lcp.full_name, hs.loss_closed_at, hs.loss_remark, hs.loss_rejection_id,
    -- New: missing-in-transit qty. Pending slips haven't arrived yet (NULL,
    -- not applicable); a non-pending slip where received < sent means real
    -- loss on arrival.
    CASE
      WHEN hs.status = 'pending' THEN NULL
      WHEN COALESCE(hs.received_qty, 0) < COALESCE(hs.sent_qty, 0)
      THEN COALESCE(hs.sent_qty, 0) - COALESCE(hs.received_qty, 0)
      ELSE 0
    END AS missing_in_transit
  FROM public.handover_slips hs
  JOIN public.style_orders so ON so.id = hs.order_id
  LEFT JOIN public.colorways cw ON cw.id = hs.colorway_id
  JOIN public.departments fd ON fd.id = hs.from_department_id
  JOIN public.departments td ON td.id = hs.to_department_id
  LEFT JOIN public.profiles sp ON sp.id = hs.sent_by
  LEFT JOIN public.profiles rp ON rp.id = hs.received_by
  LEFT JOIN public.profiles lcp ON lcp.id = hs.loss_closed_by
  LEFT JOIN public.line_allocations from_allocation ON from_allocation.id = hs.from_line_allocation_id
  LEFT JOIN public.assigned_resources from_resource ON from_resource.id = from_allocation.line_id
  LEFT JOIN LATERAL (
    SELECT ors.id, ors.visit_id
    FROM public.order_routing_steps ors
    WHERE ors.visit_id = hs.from_visit_id OR ors.id = hs.from_visit_id
    ORDER BY ors.is_primary_output DESC, ors.seq
    LIMIT 1
  ) from_route ON true
  LEFT JOIN public.operations from_route_op ON from_route_op.id = from_route.id
  LEFT JOIN LATERAL (
    SELECT ors.id, ors.visit_id
    FROM public.order_routing_steps ors
    WHERE ors.visit_id = hs.to_visit_id OR ors.id = hs.to_visit_id
    ORDER BY ors.is_primary_output DESC, ors.seq
    LIMIT 1
  ) to_route ON true
  LEFT JOIN public.operations to_route_op ON to_route_op.id = to_route.id
  LEFT JOIN LATERAL (
    SELECT target_resource.resource_name
    FROM public.line_allocations target_allocation
    JOIN public.assigned_resources target_resource ON target_resource.id = target_allocation.line_id
    WHERE target_allocation.order_id = hs.order_id
      AND target_allocation.visit_id = hs.to_visit_id
      AND target_allocation.colorway_id IS NOT DISTINCT FROM hs.colorway_id
    ORDER BY target_allocation.updated_at DESC, target_allocation.created_at DESC
    LIMIT 1
  ) to_resource ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT op.name, ', ' ORDER BY op.name) AS names
    FROM public.order_routing_steps step
    JOIN public.operations op ON op.id = step.operation_def_id
    WHERE step.order_id = hs.order_id
      AND step.visit_id = hs.from_visit_id
      AND op.step_type = 'produce'
  ) from_produce_ops ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT op.name, ', ' ORDER BY op.name) AS names
    FROM public.order_routing_steps step
    JOIN public.operations op ON op.id = step.operation_def_id
    WHERE step.order_id = hs.order_id
      AND step.visit_id = hs.to_visit_id
      AND op.step_type = 'produce'
  ) to_produce_ops ON true
  LEFT JOIN public.shifts sh ON sh.id = public.infer_shift_id_for_inspection(p_factory_id, hs.sent_at)
  WHERE hs.factory_id = p_factory_id
    AND hs.sent_at::date >= COALESCE(p_date_from, CURRENT_DATE - 30)
    AND hs.sent_at::date <= COALESCE(p_date_to, CURRENT_DATE)
    AND (p_from_department_id IS NULL OR hs.from_department_id = p_from_department_id)
    AND (p_to_department_id IS NULL OR hs.to_department_id = p_to_department_id)
    AND (p_status IS NULL OR hs.status = p_status)
    AND (p_order_id IS NULL OR hs.order_id = p_order_id)
    AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id)
    AND (
      p_search IS NULL OR trim(p_search) = ''
      OR so.style_name ILIKE '%' || trim(p_search) || '%'
      OR so.po_number ILIKE '%' || trim(p_search) || '%'
      OR hs.challan_number ILIKE '%' || trim(p_search) || '%'
      OR fd.name ILIKE '%' || trim(p_search) || '%'
      OR td.name ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(from_produce_ops.names, from_route_op.name, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(to_produce_ops.names, to_route_op.name, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(from_resource.resource_name, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(to_resource.resource_name, '') ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY hs.sent_at DESC
  LIMIT 2000;
$function$
;

CREATE OR REPLACE FUNCTION public.get_line_allocation_actuals(p_factory_id uuid, p_order_id uuid DEFAULT NULL::uuid, p_colorway_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(line_allocation_id uuid, order_id uuid, colorway_id uuid, department_id uuid, operation_id uuid, qty integer, first_output_date date, last_output_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH grid AS (
    SELECT g.*
    FROM public.standard_production_alloc_grid(p_factory_id, p_order_id) g
    WHERE (p_colorway_id IS NULL OR g.colorway_id = p_colorway_id)
  ),
  cutting_grid AS (
    SELECT
      la.factory_id,
      la.order_id,
      ors.id AS operation_id,
      ors.visit_id,
      la.department_id,
      d.name AS dept_name,
      COALESCE(ors.capture_app, 'cutting_bundle') AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type,
      d.role AS dept_role,
      d.planning_mode,
      COALESCE(ors.is_primary_output, false) AS is_primary_output,
      la.id AS line_allocation_id,
      la.colorway_id
    FROM public.line_allocations la
    JOIN public.order_routing_steps ors
      ON ors.order_id = la.order_id
     AND ors.factory_id = la.factory_id
     AND ors.visit_id IS NOT DISTINCT FROM la.visit_id
        LEFT JOIN public.departments d ON d.id = la.department_id
    WHERE la.factory_id = p_factory_id
      AND (p_order_id IS NULL OR la.order_id = p_order_id)
      AND (p_colorway_id IS NULL OR la.colorway_id = p_colorway_id)
      AND COALESCE(d.role, 'standard') = 'origin'
  ),
  captured AS (
    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      h.count AS qty,
      h.log_date AS output_date
    FROM grid g
    JOIN public.hourly_counts h
      ON h.factory_id = g.factory_id
      AND h.order_id = g.order_id
      AND h.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND h.order_route_id = g.operation_id
      AND h.line_allocation_id = g.line_allocation_id
    WHERE (g.capture_app = 'hourly' OR g.step_type IN ('loading', 'produce'))
      AND g.step_type <> 'loading'
      AND COALESCE(h.count, 0) > 0

    UNION ALL

    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      s.passed AS qty,
      s.log_date AS output_date
    FROM grid g
    JOIN public.inspection_sessions s
      ON s.factory_id = g.factory_id
      AND s.order_id = g.order_id
      AND s.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND s.order_route_id = g.operation_id
      AND s.line_allocation_id = g.line_allocation_id
    WHERE g.capture_app IN ('qc_log', 'shipment_qa')
      AND g.step_type <> 'loading'
      AND COALESCE(s.passed, 0) > 0

    UNION ALL

    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      bp.produced_qty AS qty,
      bp.log_date AS output_date
    FROM grid g
    JOIN public.batch_production bp
      ON bp.factory_id = g.factory_id
      AND bp.order_id = g.order_id
      AND bp.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND bp.order_route_id = g.operation_id
      AND bp.line_allocation_id = g.line_allocation_id
    WHERE g.capture_app = 'batch'
      AND g.step_type <> 'loading'
      AND COALESCE(bp.produced_qty, 0) > 0

    UNION ALL

    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      owm.qty AS qty,
      (owm.occurred_at AT TIME ZONE 'UTC')::date AS output_date
    FROM grid g
    JOIN public.outsource_work_movements owm
      ON owm.factory_id = g.factory_id
      AND owm.order_id = g.order_id
      AND owm.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND owm.order_route_id = g.operation_id
      AND owm.line_allocation_id = g.line_allocation_id
    WHERE (g.capture_app = 'outsource' OR g.step_type = 'outsource')
      AND g.step_type <> 'loading'
      AND owm.movement_type = 'vendor_receive'
      AND owm.voided_at IS NULL
      AND COALESCE(owm.qty, 0) > 0

    UNION ALL

    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      cb.qty AS qty,
      cs.log_date AS output_date
    FROM cutting_grid g
    JOIN public.cutting_sessions cs
      ON cs.factory_id = g.factory_id
      AND cs.order_id = g.order_id
      AND cs.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND cs.order_route_id = g.operation_id
      AND cs.line_allocation_id = g.line_allocation_id
    JOIN public.cutting_bundles cb
      ON cb.session_id = cs.id
      AND cb.factory_id = g.factory_id
      AND cb.order_id = g.order_id
      AND cb.colorway_id IS NOT DISTINCT FROM g.colorway_id
    WHERE COALESCE(cb.qty, 0) > 0
  )
  SELECT
    line_allocation_id,
    order_id,
    colorway_id,
    department_id,
    operation_id,
    SUM(qty)::integer AS qty,
    MIN(output_date) AS first_output_date,
    MAX(output_date) AS last_output_date
  FROM captured
  GROUP BY line_allocation_id, order_id, colorway_id, department_id, operation_id
  ORDER BY order_id, line_allocation_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_profile()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(p) - 'floor_pin'
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_colorway_actuals(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(line_allocation_id uuid, order_id uuid, colorway_id uuid, department_id uuid, operation_id uuid, qty integer, first_output_date date, last_output_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_line_allocation_actuals(p_factory_id, p_order_id, p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_dept_progress(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_planned jsonb;
  v_planned_total integer;
  v_cutting_id uuid;
  v_is_cutting boolean;
  v_primary_fabric text;
  v_cum_produced integer := 0;
  v_today_produced integer := 0;
  v_cum_sent integer := 0;
  v_today_sent integer := 0;
  v_produced_by_size jsonb := '{}'::jsonb;
  v_sent_by_size jsonb := '{}'::jsonb;
  v_session_total integer := 0;
  v_today_target integer := 0;
  v_remaining integer;
  v_session_output integer := 0;
  v_produced_from_sizes integer := 0;
BEGIN
  v_planned := COALESCE(public.colorway_planned_by_size(p_colorway_id), '{}'::jsonb);
  v_planned_total := public.jsonb_sum_int_values(v_planned);
  v_cutting_id := public.get_cutting_department_id(p_factory_id);
  v_is_cutting := (p_department_id = v_cutting_id);
  v_primary_fabric := public.cutting_primary_fabric_type(p_factory_id);

  SELECT COALESCE(SUM(t.daily_target), 0)::integer INTO v_today_target
  FROM public.v_daily_target t
  WHERE t.factory_id = p_factory_id AND t.order_id = p_order_id
    AND t.department_id = p_department_id AND t.log_date = p_date
    AND t.colorway_id IS NOT DISTINCT FROM p_colorway_id;

  IF NOT v_is_cutting THEN
    SELECT COALESCE(SUM(o.output_qty), 0)::integer INTO v_cum_produced
    FROM public.v_daily_output o
    WHERE o.factory_id = p_factory_id AND o.order_id = p_order_id
      AND o.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND o.department_id = p_department_id;

    SELECT COALESCE(SUM(o.output_qty), 0)::integer INTO v_today_produced
    FROM public.v_daily_output o
    WHERE o.factory_id = p_factory_id AND o.order_id = p_order_id
      AND o.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND o.department_id = p_department_id AND o.log_date = p_date;
  END IF;

  SELECT COALESCE(SUM(hs.sent_qty), 0)::integer INTO v_cum_sent
  FROM public.handover_slips hs
  WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
    AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
    AND hs.from_department_id = p_department_id;

  SELECT COALESCE(SUM(hs.sent_qty), 0)::integer INTO v_today_sent
  FROM public.handover_slips hs
  WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
    AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
    AND hs.from_department_id = p_department_id
    AND hs.sent_at::date = p_date;

  SELECT COALESCE(public.jsonb_merge_sum_maps(ARRAY_AGG(hs.qty_by_size)), '{}'::jsonb)
  INTO v_sent_by_size
  FROM public.handover_slips hs
  WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
    AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
    AND hs.from_department_id = p_department_id
    AND hs.qty_by_size <> '{}'::jsonb;

  IF v_is_cutting THEN
    SELECT COALESCE(public.jsonb_merge_sum_maps(ARRAY_AGG(cl.qty_by_size)), '{}'::jsonb)
    INTO v_produced_by_size
    FROM public.cutting_lays cl
    JOIN public.cutting_sessions cs ON cs.id = cl.session_id
    WHERE cs.factory_id = p_factory_id AND cs.order_id = p_order_id
      AND cs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND cs.department_id = p_department_id
      AND (
        cs.fabric_type = v_primary_fabric
        OR cs.fabric_component_id IN (
          SELECT fc.id
          FROM public.fabric_components fc
          WHERE fc.factory_id = p_factory_id AND fc.is_primary = true
        )
      )
      AND cl.qty_by_size <> '{}'::jsonb;

    SELECT COALESCE(SUM(cl.total_qty), 0)::integer INTO v_session_total
    FROM public.cutting_lays cl
    JOIN public.cutting_sessions cs ON cs.id = cl.session_id
    WHERE cs.factory_id = p_factory_id AND cs.order_id = p_order_id
      AND cs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND cs.department_id = p_department_id
      AND (
        cs.fabric_type = v_primary_fabric
        OR cs.fabric_component_id IN (
          SELECT fc.id
          FROM public.fabric_components fc
          WHERE fc.factory_id = p_factory_id AND fc.is_primary = true
        )
      );

    v_produced_from_sizes := public.jsonb_sum_int_values(COALESCE(v_produced_by_size, '{}'::jsonb));
    IF v_produced_from_sizes > 0 THEN
      v_cum_produced := v_produced_from_sizes;
    ELSE
      v_cum_produced := v_session_total;
      IF v_session_total > 0 THEN
        v_produced_by_size := public.proportional_qty_by_size(v_session_total, v_planned);
      END IF;
    END IF;

    SELECT COALESCE(SUM(cl.total_qty), 0)::integer INTO v_today_produced
    FROM public.cutting_lays cl
    JOIN public.cutting_sessions cs ON cs.id = cl.session_id
    WHERE cs.factory_id = p_factory_id AND cs.order_id = p_order_id
      AND cs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND cs.department_id = p_department_id
      AND (
        cs.fabric_type = v_primary_fabric
        OR cs.fabric_component_id IN (
          SELECT fc.id
          FROM public.fabric_components fc
          WHERE fc.factory_id = p_factory_id AND fc.is_primary = true
        )
      )
      AND cs.log_date = p_date;
  ELSE
    SELECT COALESCE(SUM(COALESCE(s.passed, 0) + COALESCE(s.rework_passed, 0)), 0)::integer
    INTO v_session_output
    FROM public.inspection_sessions s
    WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id
      AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND s.department_id = p_department_id;

    IF v_session_output > 0 THEN
      SELECT COALESCE(
        public.jsonb_merge_sum_maps(ARRAY_AGG(COALESCE(s.passed_by_size, '{}'::jsonb))),
        '{}'::jsonb
      )
      INTO v_produced_by_size
      FROM public.inspection_sessions s
      WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id
        AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND s.department_id = p_department_id;
      IF v_produced_by_size = '{}'::jsonb OR v_produced_by_size IS NULL THEN
        v_produced_by_size := public.proportional_qty_by_size(v_session_output, v_planned);
      END IF;
    ELSE
      SELECT COALESCE(public.jsonb_merge_sum_maps(ARRAY_AGG(hs.qty_by_size)), '{}'::jsonb)
      INTO v_produced_by_size
      FROM public.handover_slips hs
      WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
        AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND hs.from_department_id = p_department_id
        AND hs.qty_by_size <> '{}'::jsonb;
      IF v_produced_by_size = '{}'::jsonb AND v_cum_produced > 0 THEN
        v_produced_by_size := public.proportional_qty_by_size(v_cum_produced, v_planned);
      END IF;
    END IF;
  END IF;

  v_remaining := GREATEST(v_planned_total - GREATEST(v_cum_produced, v_cum_sent), 0);

  RETURN jsonb_build_object(
    'cumulative_produced', v_cum_produced,
    'today_produced', v_today_produced,
    'today_target', v_today_target,
    'cumulative_sent', v_cum_sent,
    'today_sent', v_today_sent,
    'available_to_send', GREATEST(v_cum_produced - v_cum_sent, 0),
    'planned_qty_by_size', v_planned,
    'produced_qty_by_size', COALESCE(v_produced_by_size, '{}'::jsonb),
    'sent_qty_by_size', COALESCE(v_sent_by_size, '{}'::jsonb),
    'remaining_qty', v_remaining
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_detail_bundle(p_factory_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_routing_cells jsonb;
  v_journey jsonb;
  v_size_produced jsonb;
  v_planned jsonb;
  v_reconciliation jsonb;
  v_shipments jsonb;
  v_rejections jsonb;
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'factory_id and order_id required');
  END IF;

  WITH steps AS (
    SELECT
      ors.id,
      ors.seq,
      ors.dept_id AS dept_id,
      COALESCE(ors.dept_name, '') AS dept_name,
      COALESCE(NULLIF(ors.operation_name,''), ors.dept_name, '') AS step_label,
      COALESCE(ors.capture_app, 'transaction') AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type,
      COALESCE(ors.is_primary_output, false) AS is_primary_output,
      COALESCE(
        ors.visit_id,
        (
          SELECT p.id FROM public.order_routing_steps p
          WHERE p.order_id = ors.order_id
            AND p.dept_id IS NOT DISTINCT FROM ors.dept_id
            AND p.is_primary_output IS TRUE
          ORDER BY p.seq LIMIT 1
        ),
        ors.id
      ) AS visit_id
    FROM public.order_routing_steps ors
        LEFT JOIN public.departments d ON d.id = ors.dept_id
    WHERE ors.factory_id = p_factory_id AND ors.order_id = p_order_id
  ),
  lagged AS (
    SELECT
      s.*,
      CASE
        WHEN LAG(s.dept_id) OVER (ORDER BY s.seq) IS DISTINCT FROM s.dept_id THEN 1
        ELSE 0
      END AS dept_break
    FROM steps s
  ),
  spaced AS (
    SELECT
      l.*,
      SUM(l.dept_break) OVER (ORDER BY l.seq) AS visit_grp
    FROM lagged l
  ),
  grouped AS (
    SELECT
      g.visit_grp,
      COALESCE(
        (array_agg(g.visit_id ORDER BY g.seq) FILTER (WHERE g.visit_id IS NOT NULL))[1],
        (array_agg(g.id ORDER BY g.seq))[1]
      ) AS visit_id,
      (array_agg(g.dept_id ORDER BY g.seq))[1] AS dept_id,
      (array_agg(g.dept_name ORDER BY g.seq))[1] AS dept_name,
      MIN(g.seq) AS flow_step,
      (
        SELECT s2.id
        FROM spaced s2
        WHERE s2.visit_grp = g.visit_grp
          AND (s2.is_primary_output OR s2.step_type = 'produce')
        ORDER BY s2.is_primary_output DESC, s2.seq DESC
        LIMIT 1
      ) AS primary_route_id,
      jsonb_agg(g.id ORDER BY g.seq) AS route_ids,
      jsonb_agg(
        jsonb_build_object(
          'route_id', g.id,
          'operation_name', g.step_label,
          'step_type', g.step_type,
          'is_primary_output', g.is_primary_output
        ) ORDER BY g.seq
      ) AS operations,
      jsonb_agg(DISTINCT g.capture_app) FILTER (
        WHERE g.capture_app IS NOT NULL AND g.capture_app NOT IN ('transaction', 'none')
      ) AS capture_apps
    FROM spaced g
    GROUP BY g.visit_grp, g.dept_id, g.dept_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'visit_id', visit_id,
      'dept_id', dept_id,
      'dept_name', dept_name,
      'seq', flow_step,
      'primary_route_id', primary_route_id,
      'route_ids', route_ids,
      'operations', COALESCE(operations, '[]'::jsonb),
      'capture_apps', COALESCE(capture_apps, '[]'::jsonb),
      'is_qc', COALESCE(capture_apps, '[]'::jsonb) ? 'qc_log'
    )
    ORDER BY flow_step
  ), '[]'::jsonb)
  INTO v_routing_cells
  FROM grouped;

  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.flow_step, j.colorway_id NULLS FIRST), '[]'::jsonb)
  INTO v_journey
  FROM public.order_dept_progress_rows(p_factory_id, p_order_id) j;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'colorway_id', cw.id,
      'planned_by_size', COALESCE(
        (
          SELECT jsonb_object_agg(elem->>'size', (COALESCE(NULLIF(elem->>'adj_qty', ''), elem->>'order_qty', '0'))::numeric)
          FROM jsonb_array_elements(COALESCE(cw.sizes, '[]'::jsonb)) elem
          WHERE COALESCE(elem->>'size', '') <> ''
        ),
        '{}'::jsonb
      )
    )
  ), '[]'::jsonb)
  INTO v_planned
  FROM public.colorways cw
  WHERE cw.order_id = p_order_id AND cw.factory_id = p_factory_id;

  -- size_produced: routes whose capture type is hourly/qc_log/shipment_qa/batch/outsource
  -- now read directly from operation_progress_rows (single source of truth, already
  -- computed once for the journey above) instead of re-deriving the same numbers
  -- from allocation_grained_* a second time. Cutting and shipment (origin/terminal)
  -- keep their own route-specific, non-deduplicated logic below -- deliberately
  -- different semantics from operation_progress_rows' deduplicated cutting total,
  -- not a duplicate of it. Store/loading sent-received rows are a different concept
  -- (handover qty, not produced qty) and are also left untouched.
  WITH route_map AS (
    SELECT
      ors.id AS route_id,
      ors.seq,
      COALESCE(
        ors.visit_id,
        (
          SELECT p.id FROM public.order_routing_steps p
          WHERE p.order_id = ors.order_id
            AND p.dept_id IS NOT DISTINCT FROM ors.dept_id
            AND p.is_primary_output IS TRUE
          ORDER BY p.seq LIMIT 1
        ),
        ors.id
      ) AS visit_id,
      ors.dept_id AS dept_id,
      COALESCE(ors.dept_name, '') AS dept_name,
      COALESCE(d.role, 'standard') AS dept_role,
      COALESCE(ors.capture_app, CASE WHEN ors.step_type = 'loading' THEN 'hourly' WHEN ors.step_type = 'outsource' THEN 'outsource' ELSE 'transaction' END) AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type
    FROM public.order_routing_steps ors
        LEFT JOIN public.departments d ON d.id = ors.dept_id
    WHERE ors.factory_id = p_factory_id AND ors.order_id = p_order_id
  ),
  op_prod_agg AS (
    SELECT op.colorway_id, op.operation_id AS route_id, op.visit_id, op.dept_id, op.dept_name,
           op.qty_produced_by_size AS produced_by_size, op.qty_produced AS total
    FROM public.operation_progress_rows(p_factory_id, p_order_id) op
    WHERE op.capture_app IN ('hourly', 'qc_log', 'shipment_qa', 'batch', 'outsource')
  ),
  shipment_rows AS (
    SELECT s.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           e.key AS size_key, e.value::numeric AS qty
    FROM public.shipments s
    JOIN route_map rm ON rm.route_id = COALESCE(s.order_route_id, public.terminal_route_operation_id(s.order_id))
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(s.shipped_qty_by_size, '{}'::jsonb)) AS e(key, value)
    WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id
      AND COALESCE(s.shipped_qty, 0) > 0
      AND COALESCE(e.key, '') <> '' AND e.value ~ '^[0-9]+(\.[0-9]+)?$'
    UNION ALL
    SELECT s.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           'TOTAL'::text, COALESCE(s.shipped_qty, 0)::numeric
    FROM public.shipments s
    JOIN route_map rm ON rm.route_id = COALESCE(s.order_route_id, public.terminal_route_operation_id(s.order_id))
    WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id
      AND COALESCE(s.shipped_qty, 0) > 0
      AND (s.shipped_qty_by_size IS NULL OR s.shipped_qty_by_size = '{}'::jsonb)
  ),
  cutting_rows AS (
    SELECT
      cb.colorway_id,
      rm.route_id,
      rm.visit_id,
      rm.dept_id,
      rm.dept_name,
      COALESCE(NULLIF(trim(cb.size), ''), 'TOTAL') AS size_key,
      cb.qty::numeric AS qty
    FROM public.cutting_bundles cb
    JOIN public.cutting_sessions cs ON cs.id = cb.session_id
    JOIN route_map rm ON rm.route_id = cs.order_route_id
    WHERE cb.factory_id = p_factory_id
      AND cb.order_id = p_order_id
      AND cs.order_route_id IS NOT NULL
      AND COALESCE(cb.qty, 0) > 0
      AND cb.fabric_component_id = public.get_factory_primary_fabric_component(p_factory_id)
  ),
  store_sent_rows AS (
    SELECT hs.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           e.key AS size_key, e.value::numeric AS qty
    FROM public.handover_slips hs
    JOIN route_map rm ON rm.visit_id = hs.from_visit_id AND rm.step_type = 'store'
    CROSS JOIN LATERAL jsonb_each_text(
      CASE
        WHEN COALESCE(hs.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.qty_by_size
        ELSE '{}'::jsonb
      END
    ) AS e(key, value)
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND COALESCE(hs.sent_qty, 0) > 0
      AND COALESCE(e.key, '') <> '' AND e.value ~ '^[0-9]+(\.[0-9]+)?$'
    UNION ALL
    SELECT hs.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           'TOTAL'::text, COALESCE(hs.sent_qty, 0)::numeric
    FROM public.handover_slips hs
    JOIN route_map rm ON rm.visit_id = hs.from_visit_id AND rm.step_type = 'store'
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND COALESCE(hs.sent_qty, 0) > 0
      AND (hs.qty_by_size IS NULL OR hs.qty_by_size = '{}'::jsonb)
  ),
  produce_sent_rows AS (
    SELECT hs.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           e.key AS size_key, e.value::numeric AS qty
    FROM public.handover_slips hs
    JOIN route_map rm ON rm.visit_id = hs.from_visit_id
      AND rm.step_type = 'produce' AND rm.capture_app = 'hourly'
    CROSS JOIN LATERAL jsonb_each_text(
      CASE
        WHEN COALESCE(hs.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.qty_by_size
        ELSE '{}'::jsonb
      END
    ) AS e(key, value)
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND COALESCE(hs.sent_qty, 0) > 0
      AND COALESCE(e.key, '') <> '' AND e.value ~ '^[0-9]+(\.[0-9]+)?$'
    UNION ALL
    SELECT hs.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           'TOTAL'::text, COALESCE(hs.sent_qty, 0)::numeric
    FROM public.handover_slips hs
    JOIN route_map rm ON rm.visit_id = hs.from_visit_id
      AND rm.step_type = 'produce' AND rm.capture_app = 'hourly'
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND COALESCE(hs.sent_qty, 0) > 0
      AND (hs.qty_by_size IS NULL OR hs.qty_by_size = '{}'::jsonb)
  ),
  loading_recv_rows AS (
    SELECT hs.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           e.key AS size_key, e.value::numeric AS qty
    FROM public.handover_slips hs
    JOIN route_map rm ON rm.visit_id = hs.to_visit_id AND rm.step_type = 'loading'
    CROSS JOIN LATERAL jsonb_each_text(
      CASE
        WHEN COALESCE(hs.received_qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.received_qty_by_size
        WHEN COALESCE(hs.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.qty_by_size
        ELSE '{}'::jsonb
      END
    ) AS e(key, value)
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND COALESCE(hs.received_qty, hs.sent_qty, 0) > 0
      AND COALESCE(e.key, '') <> '' AND e.value ~ '^[0-9]+(\.[0-9]+)?$'
    UNION ALL
    SELECT hs.colorway_id, rm.route_id, rm.visit_id, rm.dept_id, rm.dept_name,
           'TOTAL'::text, COALESCE(NULLIF(hs.received_qty, 0), hs.sent_qty, 0)::numeric
    FROM public.handover_slips hs
    JOIN route_map rm ON rm.visit_id = hs.to_visit_id AND rm.step_type = 'loading'
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND (hs.qty_by_size IS NULL OR hs.qty_by_size = '{}'::jsonb)
      AND (hs.received_qty_by_size IS NULL OR hs.received_qty_by_size = '{}'::jsonb)
      AND COALESCE(NULLIF(hs.received_qty, 0), hs.sent_qty, 0) > 0
  ),
  shipment_agg AS (
    SELECT colorway_id, route_id, visit_id, dept_id, dept_name,
           jsonb_object_agg(size_key, qty) AS produced_by_size, SUM(qty) AS total
    FROM (
      SELECT colorway_id, route_id, visit_id, dept_id, dept_name, size_key, SUM(qty) AS qty
      FROM shipment_rows WHERE qty > 0 GROUP BY 1, 2, 3, 4, 5, 6
    ) x GROUP BY 1, 2, 3, 4, 5
  ),
  cutting_agg AS (
    SELECT colorway_id, route_id, visit_id, dept_id, dept_name,
           jsonb_object_agg(size_key, qty) AS produced_by_size, SUM(qty) AS total
    FROM (
      SELECT colorway_id, route_id, visit_id, dept_id, dept_name, size_key, SUM(qty) AS qty
      FROM cutting_rows GROUP BY 1, 2, 3, 4, 5, 6
    ) x GROUP BY 1, 2, 3, 4, 5
  ),
  store_sent_agg AS (
    SELECT colorway_id, route_id, visit_id, dept_id, dept_name,
           jsonb_object_agg(size_key, qty) AS produced_by_size, SUM(qty) AS total
    FROM (
      SELECT colorway_id, route_id, visit_id, dept_id, dept_name, size_key, SUM(qty) AS qty
      FROM store_sent_rows WHERE qty > 0 GROUP BY 1, 2, 3, 4, 5, 6
    ) x GROUP BY 1, 2, 3, 4, 5
  ),
  loading_recv_agg AS (
    SELECT colorway_id, route_id, visit_id, dept_id, dept_name,
           jsonb_object_agg(size_key, qty) AS produced_by_size, SUM(qty) AS total
    FROM (
      SELECT colorway_id, route_id, visit_id, dept_id, dept_name, size_key, SUM(qty) AS qty
      FROM loading_recv_rows GROUP BY 1, 2, 3, 4, 5, 6
    ) x GROUP BY 1, 2, 3, 4, 5
  ),
  produce_sent_agg AS (
    SELECT colorway_id, route_id, visit_id, dept_id, dept_name,
           jsonb_object_agg(size_key, qty) AS produced_by_size, SUM(qty) AS total
    FROM (
      SELECT colorway_id, route_id, visit_id, dept_id, dept_name, size_key, SUM(qty) AS qty
      FROM produce_sent_rows WHERE qty > 0 GROUP BY 1, 2, 3, 4, 5, 6
    ) x GROUP BY 1, 2, 3, 4, 5
  ),
  route_keys AS (
    SELECT colorway_id, route_id, visit_id, dept_id, dept_name FROM op_prod_agg
    UNION SELECT colorway_id, route_id, visit_id, dept_id, dept_name FROM shipment_agg
    UNION SELECT colorway_id, route_id, visit_id, dept_id, dept_name FROM cutting_agg
    UNION SELECT colorway_id, route_id, visit_id, dept_id, dept_name FROM store_sent_agg
    UNION SELECT colorway_id, route_id, visit_id, dept_id, dept_name FROM loading_recv_agg
    UNION SELECT colorway_id, route_id, visit_id, dept_id, dept_name FROM produce_sent_agg
  ),
  merged AS (
    SELECT
      k.colorway_id,
      k.route_id,
      k.visit_id,
      k.dept_id,
      k.dept_name,
      CASE
        WHEN COALESCE(op.total, 0) > 0 THEN COALESCE(op.produced_by_size, '{}'::jsonb)
        WHEN COALESCE(sh.total, 0) > 0 THEN COALESCE(sh.produced_by_size, '{}'::jsonb)
        WHEN COALESCE(c.total, 0) > 0 THEN COALESCE(c.produced_by_size, '{}'::jsonb)
        WHEN COALESCE(st.total, 0) > 0 THEN COALESCE(st.produced_by_size, '{}'::jsonb)
        WHEN COALESCE(ps.total, 0) > 0 THEN COALESCE(ps.produced_by_size, '{}'::jsonb)
        ELSE COALESCE(l.produced_by_size, '{}'::jsonb)
      END AS produced_by_size
    FROM route_keys k
    LEFT JOIN op_prod_agg op
      ON op.colorway_id = k.colorway_id AND op.route_id = k.route_id
     AND op.visit_id = k.visit_id AND op.dept_id IS NOT DISTINCT FROM k.dept_id AND op.dept_name = k.dept_name
    LEFT JOIN shipment_agg sh
      ON sh.colorway_id = k.colorway_id AND sh.route_id = k.route_id
     AND sh.visit_id = k.visit_id AND sh.dept_id IS NOT DISTINCT FROM k.dept_id AND sh.dept_name = k.dept_name
    LEFT JOIN cutting_agg c
      ON c.colorway_id = k.colorway_id AND c.route_id = k.route_id
     AND c.visit_id = k.visit_id AND c.dept_id IS NOT DISTINCT FROM k.dept_id AND c.dept_name = k.dept_name
    LEFT JOIN store_sent_agg st
      ON st.colorway_id = k.colorway_id AND st.route_id = k.route_id
     AND st.visit_id = k.visit_id AND st.dept_id IS NOT DISTINCT FROM k.dept_id AND st.dept_name = k.dept_name
    LEFT JOIN produce_sent_agg ps
      ON ps.colorway_id = k.colorway_id AND ps.route_id = k.route_id
     AND ps.visit_id = k.visit_id AND ps.dept_id IS NOT DISTINCT FROM k.dept_id AND ps.dept_name = k.dept_name
    LEFT JOIN loading_recv_agg l
      ON l.colorway_id = k.colorway_id AND l.route_id = k.route_id
     AND l.visit_id = k.visit_id AND l.dept_id IS NOT DISTINCT FROM k.dept_id AND l.dept_name = k.dept_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'colorway_id', colorway_id,
      'route_id', route_id,
      'visit_id', visit_id,
      'dept_id', dept_id,
      'dept_name', dept_name,
      'produced_by_size', COALESCE(produced_by_size, '{}'::jsonb)
    )
  ), '[]'::jsonb)
  INTO v_size_produced
  FROM merged WHERE colorway_id IS NOT NULL;

  SELECT COALESCE(jsonb_agg(row_json), '[]'::jsonb)
  INTO v_reconciliation
  FROM (
    SELECT jsonb_build_object(
      'factory_id', so.factory_id,
      'order_id', so.id,
      'colorway_id', cw.id,
      'style_name', so.style_name,
      'buyer_name', so.buyer_name,
      'po_number', so.po_number,
      'order_qty', COALESCE(so.adj_qty, so.order_qty, 0),
      'cut_qty', COALESCE((cut_agg->>'cut_qty')::int, COALESCE(so.adj_qty, so.order_qty, 0)),
      'cut_qty_source', COALESCE(cut_agg->>'cut_qty_source', 'planned'),
      'cut_qty_by_size', COALESCE(cut_agg->'cut_qty_by_size', '{}'::jsonb),
      'cut_qty_by_component', COALESCE(cut_agg->'cut_qty_by_component', '[]'::jsonb),
      'shipped_qty', COALESCE((
        SELECT SUM(s.shipped_qty)::int FROM public.shipments s
        WHERE s.order_id = so.id AND s.colorway_id IS NOT DISTINCT FROM cw.id
      ), 0),
      'shipped_qty_by_size', COALESCE((
        SELECT public.jsonb_merge_sum_maps(array_agg(COALESCE(s.shipped_qty_by_size, '{}'::jsonb)))
        FROM public.shipments s
        WHERE s.order_id = so.id AND s.colorway_id IS NOT DISTINCT FROM cw.id
      ), '{}'::jsonb),
      'rejected_qty', COALESCE((
        SELECT SUM(r.qty)::int FROM public.rejections r
        WHERE r.order_id = so.id AND r.colorway_id IS NOT DISTINCT FROM cw.id
      ), 0),
      'rejected_qty_by_size', COALESCE((
        SELECT jsonb_object_agg(x.size_key, x.qty)
        FROM (
          SELECT COALESCE(NULLIF(r.size, ''), 'TOTAL') AS size_key, SUM(r.qty)::int AS qty
          FROM public.rejections r
          WHERE r.order_id = so.id AND r.colorway_id IS NOT DISTINCT FROM cw.id
          GROUP BY 1
        ) x
      ), '{}'::jsonb),
      'wip_qty', GREATEST(0,
        COALESCE((cut_agg->>'cut_qty')::int, 0)
        - COALESCE((SELECT SUM(s.shipped_qty)::int FROM public.shipments s
          WHERE s.order_id = so.id AND s.colorway_id IS NOT DISTINCT FROM cw.id), 0)
        - COALESCE((SELECT SUM(r.qty)::int FROM public.rejections r
          WHERE r.order_id = so.id AND r.colorway_id IS NOT DISTINCT FROM cw.id), 0)
      ),
      'reconciliation_gap', 0,
      'is_balanced', false,
      'completion_pct', null,
      'order_status', so.status,
      'last_shipment_date', (
        SELECT MAX(s.shipment_date) FROM public.shipments s
        WHERE s.order_id = so.id AND s.colorway_id IS NOT DISTINCT FROM cw.id
      )
    ) AS row_json
    FROM public.style_orders so
    LEFT JOIN public.colorways cw ON cw.order_id = so.id
    CROSS JOIN LATERAL (
      SELECT public.aggregate_order_cut_qty(so.factory_id, so.id, cw.id) AS cut_agg
    ) cut
    WHERE so.factory_id = p_factory_id AND so.id = p_order_id
  ) recon;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.shipment_date DESC), '[]'::jsonb)
  INTO v_shipments
  FROM public.shipments s
  WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.rejected_date DESC), '[]'::jsonb)
  INTO v_rejections
  FROM public.rejections r
  WHERE r.factory_id = p_factory_id AND r.order_id = p_order_id;

  RETURN jsonb_build_object(
    'factory_id', p_factory_id,
    'order_id', p_order_id,
    'routing_cells', COALESCE(v_routing_cells, '[]'::jsonb),
    'journey', COALESCE(v_journey, '[]'::jsonb),
    'size_produced', COALESCE(v_size_produced, '[]'::jsonb),
    'planned_by_colorway', COALESCE(v_planned, '[]'::jsonb),
    'reconciliation', COALESCE(v_reconciliation, '[]'::jsonb),
    'shipments', COALESCE(v_shipments, '[]'::jsonb),
    'rejections', COALESCE(v_rejections, '[]'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_order_operation_progress(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_operation_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_department_id uuid;
  v_visit_id uuid;
  v_capture_app text;
  v_planned jsonb := '{}'::jsonb;
  v_planned_total integer := 0;
  v_cum_produced integer := 0;
  v_today_produced integer := 0;
  v_cum_sent integer := 0;
  v_today_sent integer := 0;
  v_today_target integer := 0;
  v_remaining integer := 0;
BEGIN
  SELECT
    COALESCE(ors.dept_id, op.department_id),
    ors.visit_id,
    lower(COALESCE(NULLIF(ors.capture_app, ''), NULLIF(op.capture_app, ''), ''))
  INTO v_department_id, v_visit_id, v_capture_app
  FROM public.order_routing_steps ors
  LEFT JOIN public.operations op ON op.id = ors.operation_def_id
  WHERE ors.id = p_operation_id
    AND ors.factory_id = p_factory_id
    AND ors.order_id = p_order_id;

  -- Planned sizes: never abort the RPC if helper is missing/broken.
  BEGIN
    v_planned := COALESCE(public.colorway_planned_by_size(p_colorway_id), '{}'::jsonb);
    v_planned_total := public.jsonb_sum_int_values(v_planned);
  EXCEPTION WHEN OTHERS THEN
    v_planned := '{}'::jsonb;
    v_planned_total := 0;
  END;

  -- Daily target: best-effort only.
  BEGIN
    SELECT COALESCE(SUM(t.daily_target), 0)::integer INTO v_today_target
    FROM public.v_daily_target t
    WHERE t.factory_id = p_factory_id
      AND t.order_id = p_order_id
      AND t.department_id = v_department_id
      AND t.log_date = p_date
      AND t.colorway_id IS NOT DISTINCT FROM p_colorway_id;
  EXCEPTION WHEN OTHERS THEN
    v_today_target := 0;
  END;

  IF v_capture_app = 'hourly'
     OR (
       v_capture_app = ''
       AND EXISTS (
         SELECT 1 FROM public.hourly_counts h
         WHERE h.factory_id = p_factory_id
           AND h.order_id = p_order_id
           AND h.colorway_id IS NOT DISTINCT FROM p_colorway_id
           AND h.order_route_id = p_operation_id
         LIMIT 1
       )
     )
  THEN
    SELECT COALESCE(SUM(h.count), 0)::integer INTO v_cum_produced
    FROM public.hourly_counts h
    WHERE h.factory_id = p_factory_id
      AND h.order_id = p_order_id
      AND h.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND h.order_route_id = p_operation_id;

    SELECT COALESCE(SUM(h.count), 0)::integer INTO v_today_produced
    FROM public.hourly_counts h
    WHERE h.factory_id = p_factory_id
      AND h.order_id = p_order_id
      AND h.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND h.order_route_id = p_operation_id
      AND h.log_date = p_date;

  ELSIF v_capture_app = 'qc_log' THEN
    SELECT COALESCE(SUM(COALESCE(s.passed, 0)), 0)::integer INTO v_cum_produced
    FROM public.inspection_sessions s
    WHERE s.factory_id = p_factory_id
      AND s.order_id = p_order_id
      AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND s.order_route_id = p_operation_id;

    SELECT COALESCE(SUM(COALESCE(s.passed, 0)), 0)::integer INTO v_today_produced
    FROM public.inspection_sessions s
    WHERE s.factory_id = p_factory_id
      AND s.order_id = p_order_id
      AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND s.order_route_id = p_operation_id
      AND s.log_date = p_date;

  ELSIF v_capture_app = 'batch' THEN
    SELECT COALESCE(SUM(bp.produced_qty), 0)::integer INTO v_cum_produced
    FROM public.batch_production bp
    WHERE bp.factory_id = p_factory_id
      AND bp.order_id = p_order_id
      AND bp.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND bp.order_route_id = p_operation_id;

    SELECT COALESCE(SUM(bp.produced_qty), 0)::integer INTO v_today_produced
    FROM public.batch_production bp
    WHERE bp.factory_id = p_factory_id
      AND bp.order_id = p_order_id
      AND bp.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND bp.order_route_id = p_operation_id
      AND bp.log_date = p_date;

  ELSE
    -- Unknown capture_app: use whichever capture table has rows for this step.
    IF EXISTS (
      SELECT 1 FROM public.hourly_counts h
      WHERE h.factory_id = p_factory_id
        AND h.order_id = p_order_id
        AND h.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND h.order_route_id = p_operation_id
      LIMIT 1
    ) THEN
      SELECT COALESCE(SUM(h.count), 0)::integer INTO v_cum_produced
      FROM public.hourly_counts h
      WHERE h.factory_id = p_factory_id
        AND h.order_id = p_order_id
        AND h.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND h.order_route_id = p_operation_id;

      SELECT COALESCE(SUM(h.count), 0)::integer INTO v_today_produced
      FROM public.hourly_counts h
      WHERE h.factory_id = p_factory_id
        AND h.order_id = p_order_id
        AND h.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND h.order_route_id = p_operation_id
        AND h.log_date = p_date;

    ELSIF EXISTS (
      SELECT 1 FROM public.inspection_sessions s
      WHERE s.factory_id = p_factory_id
        AND s.order_id = p_order_id
        AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND s.order_route_id = p_operation_id
      LIMIT 1
    ) THEN
      SELECT COALESCE(SUM(COALESCE(s.passed, 0)), 0)::integer INTO v_cum_produced
      FROM public.inspection_sessions s
      WHERE s.factory_id = p_factory_id
        AND s.order_id = p_order_id
        AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND s.order_route_id = p_operation_id;

      SELECT COALESCE(SUM(COALESCE(s.passed, 0)), 0)::integer INTO v_today_produced
      FROM public.inspection_sessions s
      WHERE s.factory_id = p_factory_id
        AND s.order_id = p_order_id
        AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND s.order_route_id = p_operation_id
        AND s.log_date = p_date;

    ELSE
      SELECT COALESCE(SUM(bp.produced_qty), 0)::integer INTO v_cum_produced
      FROM public.batch_production bp
      WHERE bp.factory_id = p_factory_id
        AND bp.order_id = p_order_id
        AND bp.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND bp.order_route_id = p_operation_id;

      SELECT COALESCE(SUM(bp.produced_qty), 0)::integer INTO v_today_produced
      FROM public.batch_production bp
      WHERE bp.factory_id = p_factory_id
        AND bp.order_id = p_order_id
        AND bp.colorway_id IS NOT DISTINCT FROM p_colorway_id
        AND bp.order_route_id = p_operation_id
        AND bp.log_date = p_date;
    END IF;
  END IF;

  -- Live handover_slips: from_visit_id / to_visit_id (no from_operation_id).
  -- Match route step visit; fall back to from_department_id when visit is null.
  IF v_visit_id IS NOT NULL THEN
    SELECT COALESCE(SUM(hs.sent_qty), 0)::integer INTO v_cum_sent
    FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id
      AND hs.order_id = p_order_id
      AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND hs.from_visit_id IS NOT DISTINCT FROM v_visit_id;

    SELECT COALESCE(SUM(hs.sent_qty), 0)::integer INTO v_today_sent
    FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id
      AND hs.order_id = p_order_id
      AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND hs.from_visit_id IS NOT DISTINCT FROM v_visit_id
      AND hs.sent_at::date = p_date;
  ELSE
    SELECT COALESCE(SUM(hs.sent_qty), 0)::integer INTO v_cum_sent
    FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id
      AND hs.order_id = p_order_id
      AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND hs.from_department_id IS NOT DISTINCT FROM v_department_id;

    SELECT COALESCE(SUM(hs.sent_qty), 0)::integer INTO v_today_sent
    FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id
      AND hs.order_id = p_order_id
      AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND hs.from_department_id IS NOT DISTINCT FROM v_department_id
      AND hs.sent_at::date = p_date;
  END IF;

  v_remaining := GREATEST(v_planned_total - GREATEST(v_cum_produced, v_cum_sent), 0);

  RETURN jsonb_build_object(
    'operation_id', p_operation_id,
    'department_id', v_department_id,
    'cumulative_produced', v_cum_produced,
    'today_produced', v_today_produced,
    'today_target', v_today_target,
    'cumulative_sent', v_cum_sent,
    'today_sent', v_today_sent,
    'available_to_send', GREATEST(v_cum_produced - v_cum_sent, 0),
    'planned_qty_by_size', v_planned,
    'remaining_qty', v_remaining
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_shift_for_hour_slot(p_factory_id uuid, p_hour_slot text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT s.id
  FROM public.shifts s
  WHERE s.factory_id = p_factory_id
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(s.hours, '[]'::jsonb)) slot
      WHERE slot->>'type' = 'active'
        AND (slot->>'start')::time = public.normalize_hour_slot_start(p_hour_slot)
    )
  ORDER BY s.id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_style_kpis(p_factory_id uuid, p_order_id uuid)
 RETURNS SETOF v_department_kpis_by_shift
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT *
  FROM public.v_department_kpis_by_shift
  WHERE factory_id = p_factory_id AND order_id = p_order_id
  ORDER BY log_date, shift_name, department_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_today_rejections_for_order(p_factory_id uuid, p_order_id uuid, p_rejected_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total_qty', COALESCE((
      SELECT SUM(qty)::integer
      FROM public.rejections
      WHERE factory_id = p_factory_id
        AND order_id = p_order_id
        AND rejected_date = p_rejected_date
    ), 0),
    'by_reason', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason_code', reason_code, 'qty', qty) ORDER BY qty DESC)
      FROM (
        SELECT reason_code, SUM(qty)::integer AS qty
        FROM public.rejections
        WHERE factory_id = p_factory_id
          AND order_id = p_order_id
          AND rejected_date = p_rejected_date
        GROUP BY reason_code
      ) x
    ), '[]'::jsonb),
    'by_stage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', stage, 'qty', qty) ORDER BY qty DESC)
      FROM (
        SELECT stage, SUM(qty)::integer AS qty
        FROM public.rejections
        WHERE factory_id = p_factory_id
          AND order_id = p_order_id
          AND rejected_date = p_rejected_date
        GROUP BY stage
      ) y
    ), '[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.handover_exit_operation_id(p_order_id uuid, p_department_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ors.id
  FROM public.order_routing_steps ors
  WHERE ors.order_id = p_order_id
    AND ors.dept_id = p_department_id
    AND ors.is_dept_exit_operation = true
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.handover_short_qty_by_size(p_sent jsonb, p_received jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(key, diff)
      FROM (
        SELECT
          k.key,
          GREATEST(
            COALESCE((p_sent ->> k.key)::integer, 0)
              - COALESCE((p_received ->> k.key)::integer, 0),
            0
          ) AS diff
        FROM (
          SELECT DISTINCT key
          FROM (
            SELECT key FROM jsonb_each_text(COALESCE(p_sent, '{}'::jsonb))
            UNION
            SELECT key FROM jsonb_each_text(COALESCE(p_received, '{}'::jsonb))
          ) u
        ) k
      ) d
      WHERE d.diff > 0
    ),
    '{}'::jsonb
  );
$function$
;

CREATE OR REPLACE FUNCTION public.hash_floor_pin(p_pin text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT extensions.crypt(nullif(trim(p_pin), ''), extensions.gen_salt('bf'));
$function$
;

CREATE OR REPLACE FUNCTION public.hourly_counts_apply_kpi()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kpi record;
BEGIN
  SELECT * INTO v_kpi
  FROM public.lookup_line_allocation_kpi(
    NEW.factory_id,
    NEW.order_id,
    NEW.colorway_id,
    NEW.department_id,
    NEW.resource_id,
    NEW.log_date,
    NEW.order_route_id
  );
  NEW.sam := COALESCE(v_kpi.sam, 0);
  NEW.produced_mins := ROUND(COALESCE(NEW.count, 0)::numeric * COALESCE(v_kpi.sam, 0), 2);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.infer_hour_slot_for_timestamp(p_factory_id uuid, p_ts timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT (slot->>'start') || '-' || (slot->>'end')
      FROM public.shifts s
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.hours, '[]'::jsonb)) slot
      WHERE s.factory_id = p_factory_id
        AND slot->>'type' = 'active'
        AND (
          ((slot->>'start')::time <= (slot->>'end')::time
            AND p_ts::time >= (slot->>'start')::time
            AND p_ts::time < (slot->>'end')::time)
          OR
          ((slot->>'start')::time > (slot->>'end')::time
            AND (p_ts::time >= (slot->>'start')::time OR p_ts::time < (slot->>'end')::time))
        )
      ORDER BY (slot->>'start')::time
      LIMIT 1
    ),
    to_char(date_trunc('hour', p_ts), 'HH24:MI') || '-' ||
      to_char(date_trunc('hour', p_ts) + interval '1 hour', 'HH24:MI')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.infer_shift_id_for_inspection(p_factory_id uuid, p_logged_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT s.id
  FROM public.shifts s
  WHERE s.factory_id = p_factory_id
    AND public.inspection_time_in_active_slot(
      s.hours,
      (p_logged_at AT TIME ZONE 'Asia/Kolkata')::time
    )
  ORDER BY s.id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.inspection_sessions_apply_kpi()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_defects integer;
BEGIN
  NEW.first_time_pass := GREATEST(
    COALESCE(NEW.passed, 0) - COALESCE(NEW.rework_passed, 0),
    0
  );

  IF NEW.first_time_pass_by_size IS NULL
     OR NEW.first_time_pass_by_size = '{}'::jsonb THEN
    NEW.first_time_pass_by_size := public.jsonb_map_subtract_nonneg(
      COALESCE(NEW.passed_by_size, '{}'::jsonb),
      COALESCE(NEW.rework_by_size, '{}'::jsonb)
    );
  END IF;

  IF COALESCE(NEW.total_inspected, 0) > 0 THEN
    IF NEW.ftr_pct IS NULL THEN
      NEW.ftr_pct := ROUND(100.0 * NEW.first_time_pass / NEW.total_inspected, 2);
    END IF;
    IF NEW.defective_pct IS NULL THEN
      NEW.defective_pct := ROUND(100.0 * COALESCE(NEW.failed, 0) / NEW.total_inspected, 2);
    END IF;
    IF NEW.dhu IS NULL THEN
      SELECT COALESCE(SUM(v::integer), 0)::integer
      INTO v_defects
      FROM jsonb_each_text(COALESCE(NEW.defect_summary, '{}'::jsonb)) AS d(k, v);
      NEW.dhu := ROUND(100.0 * v_defects / NEW.total_inspected, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.inspection_time_in_active_slot(p_hours jsonb, p_t time without time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) slot
    WHERE slot->>'type' = 'active'
      AND (
        ((slot->>'start')::time <= (slot->>'end')::time
          AND p_t >= (slot->>'start')::time AND p_t < (slot->>'end')::time)
        OR
        ((slot->>'start')::time > (slot->>'end')::time
          AND (p_t >= (slot->>'start')::time OR p_t < (slot->>'end')::time))
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_factory_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT COALESCE(
    COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'user_role',
      current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'user_role',
      current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'user_role'
    ) IN ('admin', 'superadmin'),
    (SELECT p.user_role IN ('admin', 'superadmin') FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT COALESCE(
    COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'user_role',
      current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'user_role',
      current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'user_role'
    ) = 'superadmin',
    (SELECT p.user_role = 'superadmin' FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.jsonb_map_subtract_nonneg(p_minuend jsonb, p_subtrahend jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    jsonb_object_agg(
      k,
      GREATEST(COALESCE((p_minuend ->> k)::integer, 0) - COALESCE((p_subtrahend ->> k)::integer, 0), 0)
    ),
    '{}'::jsonb
  )
  FROM (
    SELECT DISTINCT key AS k
    FROM jsonb_object_keys(COALESCE(p_minuend, '{}'::jsonb) || COALESCE(p_subtrahend, '{}'::jsonb)) AS key
  ) keys;
$function$
;

CREATE OR REPLACE FUNCTION public.jsonb_merge_sum_maps(p_maps jsonb[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(key, sum_val)
      FROM (
        SELECT key, SUM(value::integer) AS sum_val
        FROM unnest(COALESCE(p_maps, ARRAY[]::jsonb[])) AS m
        CROSS JOIN LATERAL jsonb_each_text(COALESCE(m, '{}'::jsonb))
        GROUP BY key
      ) s
    ),
    '{}'::jsonb
  );
$function$
;

CREATE OR REPLACE FUNCTION public.jsonb_subtract_maps_nonneg(p_a jsonb, p_b jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(
        k,
        GREATEST(
          COALESCE((COALESCE(p_a, '{}'::jsonb) ->> k)::integer, 0)
          - COALESCE((COALESCE(p_b, '{}'::jsonb) ->> k)::integer, 0),
          0
        )
      )
      FROM (
        SELECT key AS k FROM jsonb_each_text(COALESCE(p_a, '{}'::jsonb))
        UNION
        SELECT key AS k FROM jsonb_each_text(COALESCE(p_b, '{}'::jsonb))
      ) keys
    ),
    '{}'::jsonb
  );
$function$
;

CREATE OR REPLACE FUNCTION public.jsonb_sum_int_values(p_obj jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(SUM((value)::integer), 0)
  FROM jsonb_each_text(COALESCE(p_obj, '{}'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.jsonb_sum_merge(existing jsonb, incoming jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_object_agg(
      key,
      COALESCE((existing->>key)::integer, 0) + COALESCE(value::integer, 0)
    )
    FROM jsonb_each_text(incoming)),
    existing
  ) || (
    -- Include keys from existing that aren't in incoming (preserve untouched sizes)
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(existing)
    WHERE NOT incoming ? key
  );
$function$
;

CREATE OR REPLACE FUNCTION public.jsonb_sum_size_maps(p_maps jsonb[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(k, total)
      FROM (
        SELECT e.key AS k, SUM((e.value)::integer) AS total
        FROM unnest(p_maps) m,
             LATERAL jsonb_each_text(COALESCE(m, '{}'::jsonb)) e
        GROUP BY e.key
      ) s
      WHERE total <> 0
    ),
    '{}'::jsonb
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_outsource_work_movement(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_visit_id uuid, p_order_route_id uuid, p_vendor_resource_id uuid, p_line_allocation_id uuid, p_movement_type text, p_qty integer, p_qty_by_size jsonb DEFAULT '{}'::jsonb, p_linked_send_id uuid DEFAULT NULL::uuid, p_challan_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id         uuid;
  v_planning_mode   text;
  v_existing_id     uuid;
  v_send_row        public.outsource_work_movements%ROWTYPE;
  v_size_sum        integer;
  v_available       integer;
  v_returned_so_far integer;
  v_new_id          uuid;
  v_order_route_id  uuid := p_order_route_id;
  v_line_alloc_id   uuid := p_line_allocation_id;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;

  IF p_movement_type NOT IN ('vendor_send', 'vendor_receive') THEN
    RAISE EXCEPTION 'Invalid movement_type';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive';
  END IF;

  v_size_sum := public.outsource_movement_size_sum(p_qty_by_size);
  IF v_size_sum > 0 AND v_size_sum <> p_qty THEN
    RAISE EXCEPTION 'qty_by_size must sum to qty';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.outsource_work_movements
    WHERE factory_id = p_factory_id
      AND idempotency_key = p_idempotency_key
      AND voided_at IS NULL;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT d.planning_mode INTO v_planning_mode
  FROM public.departments d
  WHERE d.id = p_department_id AND d.factory_id = p_factory_id;

  IF COALESCE(v_planning_mode, '') <> 'outsource' THEN
    RAISE EXCEPTION 'Department is not an outsource work center';
  END IF;

  PERFORM public.assert_outsource_vendor_resource(p_vendor_resource_id, p_department_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.factory_id = p_factory_id
      AND p.status = 'Active'
      AND COALESCE(p.handover_enabled, false) = true
      AND p.department_id = p_department_id
  ) THEN
    RAISE EXCEPTION 'Not authorized — active outsource supervisor required';
  END IF;

  IF v_order_route_id IS NULL AND p_visit_id IS NOT NULL THEN
    v_order_route_id := public.visit_primary_route_step_id(p_order_id, p_visit_id);
  END IF;

  IF v_line_alloc_id IS NULL AND p_visit_id IS NOT NULL THEN
    v_line_alloc_id := public.resolve_outsource_line_allocation_id(
      p_order_id,
      p_visit_id,
      p_colorway_id,
      p_vendor_resource_id
    );
  END IF;

  IF p_movement_type = 'vendor_send' THEN
    v_available := public.outsource_visit_available_for_vendor_send(
      p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id
    );
    IF p_qty > v_available THEN
      RAISE EXCEPTION 'Insufficient visit WIP for vendor send (available %)', v_available;
    END IF;
  ELSE
    IF p_linked_send_id IS NULL THEN
      RAISE EXCEPTION 'vendor_receive requires linked_send_id';
    END IF;
    SELECT * INTO v_send_row
    FROM public.outsource_work_movements
    WHERE id = p_linked_send_id
      AND factory_id = p_factory_id
      AND movement_type = 'vendor_send'
      AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked vendor send not found';
    END IF;
    IF v_send_row.vendor_resource_id IS DISTINCT FROM p_vendor_resource_id THEN
      RAISE EXCEPTION 'Receive vendor must match linked send';
    END IF;
    IF v_send_row.visit_id IS DISTINCT FROM p_visit_id THEN
      RAISE EXCEPTION 'Receive visit must match linked send';
    END IF;
    v_returned_so_far := public.outsource_send_returned_qty(p_linked_send_id);
    IF v_returned_so_far + p_qty > v_send_row.qty THEN
      RAISE EXCEPTION 'Cumulative vendor receive exceeds linked send (remaining %)',
        v_send_row.qty - v_returned_so_far;
    END IF;
    v_order_route_id := COALESCE(v_order_route_id, v_send_row.order_route_id);
    v_line_alloc_id := COALESCE(v_line_alloc_id, v_send_row.line_allocation_id);
  END IF;

  INSERT INTO public.outsource_work_movements (
    factory_id, order_id, colorway_id, department_id, visit_id, order_route_id,
    vendor_resource_id, line_allocation_id, movement_type, qty, qty_by_size,
    linked_send_id, challan_number, notes, occurred_at, logged_by, idempotency_key
  ) VALUES (
    p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id, v_order_route_id,
    p_vendor_resource_id, v_line_alloc_id, p_movement_type, p_qty, COALESCE(p_qty_by_size, '{}'::jsonb),
    p_linked_send_id, NULLIF(trim(p_challan_number), ''), NULLIF(trim(p_notes), ''),
    COALESCE(p_occurred_at, now()), v_user_id, NULLIF(trim(p_idempotency_key), '')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_outsource_work_movement(p_factory_id uuid, p_user_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_visit_id uuid, p_order_route_id uuid, p_vendor_resource_id uuid, p_line_allocation_id uuid, p_movement_type text, p_qty integer, p_qty_by_size jsonb DEFAULT '{}'::jsonb, p_linked_send_id uuid DEFAULT NULL::uuid, p_challan_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_planning_mode   text;
  v_existing_id     uuid;
  v_send_row        public.outsource_work_movements%ROWTYPE;
  v_size_sum        integer;
  v_available       integer;
  v_returned_so_far integer;
  v_new_id          uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Factory mismatch check removed — factory validated by all subsequent queries

  IF p_movement_type NOT IN ('vendor_send', 'vendor_receive') THEN
    RAISE EXCEPTION 'Invalid movement_type';
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive';
  END IF;

  v_size_sum := public.outsource_movement_size_sum(p_qty_by_size);
  IF v_size_sum > 0 AND v_size_sum <> p_qty THEN
    RAISE EXCEPTION 'qty_by_size must sum to qty';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.outsource_work_movements
    WHERE factory_id = p_factory_id
      AND idempotency_key = p_idempotency_key
      AND voided_at IS NULL;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT d.planning_mode INTO v_planning_mode
  FROM public.departments d
  WHERE d.id = p_department_id AND d.factory_id = p_factory_id;

  IF COALESCE(v_planning_mode, '') <> 'outsource' THEN
    RAISE EXCEPTION 'Department is not an outsource work center';
  END IF;

  PERFORM public.assert_outsource_vendor_resource(p_vendor_resource_id, p_department_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.factory_id = p_factory_id
      AND p.status = 'Active'
      AND COALESCE(p.handover_enabled, false) = true
      AND p.department_id = p_department_id
  ) THEN
    RAISE EXCEPTION 'Not authorized — active outsource supervisor required';
  END IF;

  IF p_movement_type = 'vendor_send' THEN
    v_available := public.outsource_visit_available_for_vendor_send(
      p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id
    );
    IF p_qty > v_available THEN
      RAISE EXCEPTION 'Insufficient visit WIP for vendor send (available %)', v_available;
    END IF;
  ELSE
    IF p_linked_send_id IS NULL THEN
      RAISE EXCEPTION 'vendor_receive requires linked_send_id';
    END IF;
    SELECT * INTO v_send_row
    FROM public.outsource_work_movements
    WHERE id = p_linked_send_id
      AND factory_id = p_factory_id
      AND movement_type = 'vendor_send'
      AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked vendor send not found';
    END IF;
    IF v_send_row.vendor_resource_id IS DISTINCT FROM p_vendor_resource_id THEN
      RAISE EXCEPTION 'Receive vendor must match linked send';
    END IF;
    IF v_send_row.visit_id IS DISTINCT FROM p_visit_id THEN
      RAISE EXCEPTION 'Receive visit must match linked send';
    END IF;
    v_returned_so_far := public.outsource_send_returned_qty(p_linked_send_id);
    IF v_returned_so_far + p_qty > v_send_row.qty THEN
      RAISE EXCEPTION 'Cumulative vendor receive exceeds linked send (remaining %)',
        v_send_row.qty - v_returned_so_far;
    END IF;
  END IF;

  INSERT INTO public.outsource_work_movements (
    factory_id, order_id, colorway_id, department_id, visit_id, order_route_id,
    vendor_resource_id, line_allocation_id, movement_type, qty, qty_by_size,
    linked_send_id, challan_number, notes, occurred_at, logged_by, idempotency_key
  ) VALUES (
    p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id, p_order_route_id,
    p_vendor_resource_id, p_line_allocation_id, p_movement_type, p_qty, COALESCE(p_qty_by_size, '{}'::jsonb),
    p_linked_send_id, NULLIF(trim(p_challan_number), ''), NULLIF(trim(p_notes), ''),
    COALESCE(p_occurred_at, now()), p_user_id, NULLIF(trim(p_idempotency_key), '')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.lookup_line_allocation_kpi(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_resource_id uuid, p_log_date date, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sam numeric, daily_target integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sam numeric;
  v_line_target integer;
  v_visit_id uuid;
BEGIN
  IF p_operation_id IS NOT NULL THEN
    SELECT ors.visit_id INTO v_visit_id
    FROM public.order_routing_steps ors
    WHERE ors.id = p_operation_id;
  END IF;

  SELECT
    COALESCE(NULLIF(la.sam, 0), NULLIF((la.kpi_inputs->>'sam')::numeric, 0)),
    COALESCE(NULLIF(la.daily_target, 0), NULLIF(la.qty, 0))::integer
  INTO v_sam, v_line_target
  FROM public.line_allocations la
  WHERE la.factory_id = p_factory_id
    AND la.order_id = p_order_id
    AND la.department_id = p_department_id
    AND la.colorway_id IS NOT DISTINCT FROM p_colorway_id
    AND la.line_id IS NOT DISTINCT FROM p_resource_id
    AND (
      p_operation_id IS NULL
      OR la.visit_id IS NOT DISTINCT FROM v_visit_id
    )
    AND (
      (la.start_date IS NOT NULL AND la.end_date IS NOT NULL AND p_log_date BETWEEN la.start_date AND la.end_date)
      OR (la.start_date IS NULL AND la.end_date IS NULL)
      OR (la.start_date IS NOT NULL AND la.end_date IS NULL AND p_log_date >= la.start_date)
      OR (la.start_date IS NULL AND la.end_date IS NOT NULL AND p_log_date <= la.end_date)
    )
  ORDER BY
    CASE
      WHEN p_operation_id IS NOT NULL AND la.visit_id IS NOT DISTINCT FROM v_visit_id THEN 0
      WHEN la.visit_id IS NOT NULL THEN 1
      ELSE 2
    END,
    CASE WHEN la.line_id IS NOT DISTINCT FROM p_resource_id THEN 0 ELSE 1 END,
    COALESCE(NULLIF(la.daily_target, 0), NULLIF(la.qty, 0)) DESC NULLS LAST
  LIMIT 1;

  IF COALESCE(v_sam, 0) = 0 THEN
    SELECT NULLIF(so.sewing_sam, 0) INTO v_sam
    FROM public.style_orders so
    WHERE so.id = p_order_id AND so.factory_id = p_factory_id;
  END IF;

  sam := COALESCE(v_sam, 0);
  daily_target := COALESCE(v_line_target, 0);
  RETURN NEXT;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.next_internal_order_no(p_factory_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next integer;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(internal_order_no,'\D','','g'),'')::integer), 0) + 1
  INTO v_next
  FROM public.style_orders
  WHERE factory_id = p_factory_id;
  RETURN lpad(v_next::text, 5, '0');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_hour_slot_start(p_hour_slot text)
 RETURNS time without time zone
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT split_part(trim(p_hour_slot), '-', 1)::time;
$function$
;

CREATE OR REPLACE FUNCTION public.odt_log_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.target_date     IS DISTINCT FROM OLD.target_date)
  OR (NEW.qty_by_size     IS DISTINCT FROM OLD.qty_by_size)
  OR (NEW.ship_mode       IS DISTINCT FROM OLD.ship_mode)
  OR (NEW.shipment_type   IS DISTINCT FROM OLD.shipment_type)
  THEN
    INSERT INTO public.order_delivery_target_history (
      factory_id, target_id, order_id, colorway_id,
      old_target_date, new_target_date,
      old_qty_by_size, new_qty_by_size,
      old_ship_mode,   new_ship_mode,
      old_shipment_type, new_shipment_type,
      change_reason, changed_by
    ) VALUES (
      NEW.factory_id, NEW.id, NEW.order_id, NEW.colorway_id,
      OLD.target_date,   NEW.target_date,
      OLD.qty_by_size,   NEW.qty_by_size,
      OLD.ship_mode,     NEW.ship_mode,
      OLD.shipment_type, NEW.shipment_type,
      current_setting('app.change_reason', true),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.odt_set_total_qty()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.total_qty := COALESCE(
    (SELECT SUM(value::integer)
     FROM jsonb_each_text(NEW.qty_by_size)),
    0
  );
  -- Enforce: shipment date must not be before the order's job_card_date
  IF NEW.target_date IS NOT NULL THEN
    PERFORM 1 FROM public.style_orders
    WHERE id = NEW.order_id
      AND job_card_date IS NOT NULL
      AND NEW.target_date < job_card_date;
    IF FOUND THEN
      RAISE EXCEPTION 'Shipment date (%) cannot be before the job card date of this order.', NEW.target_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.operation_progress_rows(p_factory_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, visit_id uuid, dept_id uuid, dept_name text, capture_app text, step_type text, dept_role text, is_primary_output boolean, route_seq integer, qty_produced integer, qty_produced_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH route AS (
    SELECT
      ors.factory_id, ors.order_id, ors.id AS operation_id, ors.seq AS route_seq,
      COALESCE(
        ors.visit_id,
        (SELECT p.id FROM public.order_routing_steps p
         WHERE p.order_id = ors.order_id AND p.dept_id IS NOT DISTINCT FROM ors.dept_id AND p.is_primary_output IS TRUE
         ORDER BY p.seq LIMIT 1),
        ors.id
      ) AS visit_id,
      ors.dept_id AS department_id, ors.dept_name AS dept_name,
      COALESCE(ors.capture_app, CASE WHEN ors.step_type = 'loading' THEN 'hourly' WHEN ors.step_type = 'outsource' THEN 'outsource' ELSE 'transaction' END) AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type,
      COALESCE(d.role, 'standard') AS dept_role,
      COALESCE(ors.is_primary_output, false) AS is_primary_output
    FROM public.order_routing_steps ors
    LEFT JOIN public.departments d ON d.id = ors.dept_id
    WHERE (p_factory_id IS NULL OR ors.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR ors.order_id = p_order_id)
  ),
  colorway_scope AS (
    SELECT so.factory_id, so.id AS order_id, cw.id AS colorway_id
    FROM public.style_orders so JOIN public.colorways cw ON cw.order_id = so.id
    WHERE (p_factory_id IS NULL OR so.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR so.id = p_order_id)
  ),
  grid AS (
    SELECT r.*, cs.colorway_id AS resolved_colorway_id
    FROM route r JOIN colorway_scope cs ON cs.order_id = r.order_id AND cs.factory_id = r.factory_id
  ),
  hourly_prod AS (SELECT * FROM public.allocation_grained_hourly_agg(p_factory_id, p_order_id)),
  qc_prod AS (SELECT * FROM public.allocation_grained_qc_agg(p_factory_id, p_order_id)),
  batch_prod AS (SELECT * FROM public.allocation_grained_batch_agg(p_factory_id, p_order_id)),
  outsource_prod AS (SELECT * FROM public.allocation_grained_outsource_agg(p_factory_id, p_order_id)),
  cutting_bundles_resolved AS (
    SELECT
      cb.id AS bundle_id, cb.factory_id, cb.order_id, cb.colorway_id, cb.qty, cb.size,
      cb.fabric_component_id,
      resolved.operation_id
    FROM public.cutting_bundles cb
    LEFT JOIN public.cutting_sessions cs ON cs.id = cb.session_id
    JOIN LATERAL (
      SELECT r.operation_id FROM route r
      WHERE r.factory_id = cb.factory_id AND r.order_id = cb.order_id
        AND r.dept_role = 'origin' AND r.capture_app IN ('cutting_lay', 'cutting_bundle')
        AND (cs.order_route_id IS NULL OR r.operation_id = cs.order_route_id)
      ORDER BY (r.operation_id = cs.order_route_id) DESC, r.is_primary_output DESC, r.route_seq
      LIMIT 1
    ) resolved ON true
    WHERE COALESCE(cb.qty, 0) > 0
      AND (p_factory_id IS NULL OR cb.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR cb.order_id = p_order_id)
  ),
  -- Tagged-primary total per operation, computed first so the untagged
  -- fallback below can check whether real tagged data already exists --
  -- prevents double-counting when both a correctly-tagged bundle and a
  -- separately-logged untagged (fabric_component_id IS NULL) bundle exist
  -- for the same operation (confirmed live: both exist for the same
  -- cutting route in real data, and the old per-row OR fallback summed
  -- both instead of treating them as alternatives).
  cutting_tagged AS (
    SELECT
      cbr.factory_id, cbr.order_id, cbr.colorway_id, cbr.operation_id,
      SUM(cbr.qty)::integer AS qty_produced,
      public.jsonb_merge_sum_maps(ARRAY_AGG(jsonb_build_object(COALESCE(NULLIF(trim(cbr.size), ''), 'TOTAL'), cbr.qty))) AS qty_produced_by_size
    FROM cutting_bundles_resolved cbr
    WHERE cbr.fabric_component_id = public.get_factory_primary_fabric_component(cbr.factory_id)
    GROUP BY cbr.factory_id, cbr.order_id, cbr.colorway_id, cbr.operation_id
  ),
  cutting_untagged AS (
    SELECT
      cbr.factory_id, cbr.order_id, cbr.colorway_id, cbr.operation_id,
      SUM(cbr.qty)::integer AS qty_produced,
      public.jsonb_merge_sum_maps(ARRAY_AGG(jsonb_build_object(COALESCE(NULLIF(trim(cbr.size), ''), 'TOTAL'), cbr.qty))) AS qty_produced_by_size
    FROM cutting_bundles_resolved cbr
    WHERE cbr.fabric_component_id IS NULL
      AND public.get_factory_primary_fabric_component(cbr.factory_id) IS NOT NULL
    GROUP BY cbr.factory_id, cbr.order_id, cbr.colorway_id, cbr.operation_id
  ),
  cutting_prod AS (
    SELECT
      COALESCE(t.factory_id, u.factory_id) AS factory_id,
      COALESCE(t.order_id, u.order_id) AS order_id,
      COALESCE(t.colorway_id, u.colorway_id) AS colorway_id,
      COALESCE(t.operation_id, u.operation_id) AS operation_id,
      -- Untagged bundles only count when this operation has NO tagged
      -- primary bundles at all -- otherwise they'd double the real total.
      CASE WHEN t.qty_produced IS NOT NULL THEN t.qty_produced ELSE COALESCE(u.qty_produced, 0) END AS qty_produced,
      CASE WHEN t.qty_produced_by_size IS NOT NULL THEN t.qty_produced_by_size ELSE COALESCE(u.qty_produced_by_size, '{}'::jsonb) END AS qty_produced_by_size
    FROM cutting_tagged t
    FULL JOIN cutting_untagged u
      ON u.factory_id = t.factory_id AND u.order_id = t.order_id
     AND u.colorway_id IS NOT DISTINCT FROM t.colorway_id AND u.operation_id = t.operation_id
  ),
  shipment_prod AS (
    SELECT
      s.factory_id, s.order_id, s.colorway_id,
      COALESCE(s.order_route_id, public.terminal_route_operation_id(s.order_id)) AS operation_id,
      SUM(s.shipped_qty)::integer AS qty_produced,
      public.jsonb_merge_sum_maps(ARRAY_AGG(COALESCE(s.shipped_qty_by_size, '{}'::jsonb))) AS qty_produced_by_size
    FROM public.shipments s
    WHERE COALESCE(s.shipped_qty, 0) > 0
      AND (p_factory_id IS NULL OR s.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR s.order_id = p_order_id)
    GROUP BY s.factory_id, s.order_id, s.colorway_id, COALESCE(s.order_route_id, public.terminal_route_operation_id(s.order_id))
  )
  SELECT
    g.factory_id, g.order_id, g.resolved_colorway_id AS colorway_id, g.operation_id, g.visit_id,
    g.department_id AS dept_id, g.dept_name, g.capture_app, g.step_type, g.dept_role,
    g.is_primary_output, g.route_seq,
    COALESCE(prod.qty, 0) AS qty_produced,
    COALESCE(prod.qty_by_size, '{}'::jsonb) AS qty_produced_by_size
  FROM grid g
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        CASE
          WHEN g.dept_role = 'origin' THEN cp.qty_produced
          WHEN g.dept_role = 'terminal' THEN sp.qty_produced
          WHEN g.capture_app = 'hourly' THEN hp.qty_produced
          WHEN g.capture_app IN ('qc_log', 'shipment_qa') THEN qp.qty_produced
          WHEN g.capture_app = 'batch' THEN btp.qty_produced
          WHEN g.capture_app = 'outsource' THEN out.qty_produced
          ELSE COALESCE(hp.qty_produced, qp.qty_produced, btp.qty_produced, out.qty_produced)
        END, 0
      ) AS qty,
      COALESCE(
        CASE
          WHEN g.dept_role = 'origin' THEN cp.qty_produced_by_size
          WHEN g.dept_role = 'terminal' THEN sp.qty_produced_by_size
          WHEN g.capture_app = 'hourly' THEN hp.qty_produced_by_size
          WHEN g.capture_app IN ('qc_log', 'shipment_qa') THEN qp.qty_produced_by_size
          WHEN g.capture_app = 'batch' THEN btp.qty_produced_by_size
          WHEN g.capture_app = 'outsource' THEN out.qty_produced_by_size
          ELSE public.jsonb_merge_sum_maps(ARRAY[
            COALESCE(hp.qty_produced_by_size, '{}'::jsonb), COALESCE(qp.qty_produced_by_size, '{}'::jsonb),
            COALESCE(btp.qty_produced_by_size, '{}'::jsonb), COALESCE(out.qty_produced_by_size, '{}'::jsonb)
          ])
        END, '{}'::jsonb
      ) AS qty_by_size
    FROM (SELECT 1) AS dummy
    LEFT JOIN hourly_prod hp ON hp.factory_id = g.factory_id AND hp.order_id = g.order_id AND hp.colorway_id IS NOT DISTINCT FROM g.resolved_colorway_id AND hp.operation_id = g.operation_id
    LEFT JOIN qc_prod qp ON qp.factory_id = g.factory_id AND qp.order_id = g.order_id AND qp.colorway_id IS NOT DISTINCT FROM g.resolved_colorway_id AND qp.operation_id = g.operation_id
    LEFT JOIN batch_prod btp ON btp.factory_id = g.factory_id AND btp.order_id = g.order_id AND btp.colorway_id IS NOT DISTINCT FROM g.resolved_colorway_id AND btp.operation_id = g.operation_id
    LEFT JOIN outsource_prod out ON out.factory_id = g.factory_id AND out.order_id = g.order_id AND out.colorway_id IS NOT DISTINCT FROM g.resolved_colorway_id AND out.operation_id = g.operation_id
    LEFT JOIN cutting_prod cp ON cp.factory_id = g.factory_id AND cp.order_id = g.order_id AND cp.colorway_id IS NOT DISTINCT FROM g.resolved_colorway_id AND cp.operation_id = g.operation_id
    LEFT JOIN shipment_prod sp ON sp.factory_id = g.factory_id AND sp.order_id = g.order_id AND sp.colorway_id IS NOT DISTINCT FROM g.resolved_colorway_id AND sp.operation_id = g.operation_id
  ) prod ON true
  ORDER BY g.route_seq;
$function$
;

CREATE OR REPLACE FUNCTION public.order_dept_progress_rows(p_factory_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, visit_id uuid, dept_id uuid, dept_name text, flow_step integer, is_in_flow boolean, qty_received integer, qty_produced integer, qty_sent integer, qty_rejected integer, wip_qty integer, wip_qty_by_size jsonb, qty_received_by_size jsonb, qty_produced_by_size jsonb, qty_sent_by_size jsonb, qty_rejected_by_size jsonb, qty_in_transit integer, qty_missing_in_transit integer, status text, planned_qty integer, remaining_qty integer, available_to_send integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH op AS (
    SELECT * FROM public.operation_progress_rows(p_factory_id, p_order_id)
  ),
  audit_rej AS (
    SELECT
      a.factory_id, a.order_id, a.colorway_id, resolved.operation_id,
      SUM(COALESCE(a.failed, 0))::integer AS qty_rejected,
      public.jsonb_merge_sum_maps(ARRAY_AGG(jsonb_build_object('TOTAL', COALESCE(a.failed, 0)))) AS qty_rejected_by_size
    FROM public.audit_sessions a
    LEFT JOIN public.line_allocations la ON la.id = a.line_allocation_id
    JOIN LATERAL (
      SELECT COALESCE(
        a.order_route_id,
        CASE WHEN la.visit_id IS NOT NULL THEN public.visit_primary_route_step_id(a.order_id, la.visit_id) ELSE NULL END,
        (SELECT ors.id FROM public.order_routing_steps ors
         WHERE ors.order_id = a.order_id AND ors.dept_id = a.department_id
         ORDER BY CASE WHEN COALESCE(ors.is_primary_output, false) THEN 0 ELSE 1 END,
                  CASE WHEN COALESCE(ors.step_type, 'produce') = 'produce' THEN 0 ELSE 1 END, ors.seq DESC
         LIMIT 1)
      ) AS operation_id
    ) resolved ON true
    WHERE resolved.operation_id IS NOT NULL AND COALESCE(a.failed, 0) > 0
      AND (a.status = 'completed' OR a.result IS NOT NULL)
      AND (p_factory_id IS NULL OR a.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR a.order_id = p_order_id)
    GROUP BY a.factory_id, a.order_id, a.colorway_id, resolved.operation_id
  ),
  recv AS (
    SELECT hs.factory_id, hs.order_id, hs.colorway_id,
      public.visit_primary_route_step_id(hs.order_id, hs.to_visit_id) AS operation_id,
      SUM(COALESCE(NULLIF(hs.received_qty, 0), hs.sent_qty))::integer AS qty_received,
      public.jsonb_merge_sum_maps(ARRAY_AGG(
        CASE WHEN COALESCE(hs.received_qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.received_qty_by_size
             WHEN COALESCE(hs.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.qty_by_size
             ELSE '{}'::jsonb END
      )) AS qty_received_by_size
    FROM public.handover_slips hs
    WHERE hs.to_visit_id IS NOT NULL
      AND (p_factory_id IS NULL OR hs.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR hs.order_id = p_order_id)
    GROUP BY hs.factory_id, hs.order_id, hs.colorway_id, public.visit_primary_route_step_id(hs.order_id, hs.to_visit_id)
  ),
  -- New: transit-loss tracking. A slip with status 'pending' hasn't arrived
  -- yet (counts as in-transit); a non-pending slip where received < sent
  -- means some quantity was lost/missing on arrival. Resolved to the same
  -- destination-visit operation_id as `recv`, via the same helper, so it
  -- joins into op_rows the same way and never double-counts across the
  -- multiple routing steps a visit can contain.
  handover_transit AS (
    SELECT hs.factory_id, hs.order_id, hs.colorway_id,
      public.visit_primary_route_step_id(hs.order_id, hs.to_visit_id) AS operation_id,
      SUM(CASE WHEN hs.status = 'pending' THEN COALESCE(hs.sent_qty, 0) ELSE 0 END)::integer AS qty_in_transit,
      SUM(
        CASE
          WHEN hs.status IS DISTINCT FROM 'pending'
           AND COALESCE(hs.received_qty, 0) < COALESCE(hs.sent_qty, 0)
          THEN COALESCE(hs.sent_qty, 0) - COALESCE(hs.received_qty, 0)
          ELSE 0
        END
      )::integer AS qty_missing_in_transit
    FROM public.handover_slips hs
    WHERE hs.to_visit_id IS NOT NULL
      AND (p_factory_id IS NULL OR hs.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR hs.order_id = p_order_id)
    GROUP BY hs.factory_id, hs.order_id, hs.colorway_id, public.visit_primary_route_step_id(hs.order_id, hs.to_visit_id)
  ),
  sent AS (
    SELECT hs.factory_id, hs.order_id, hs.colorway_id,
      public.visit_primary_route_step_id(hs.order_id, hs.from_visit_id) AS operation_id,
      SUM(hs.sent_qty)::integer AS qty_sent,
      public.jsonb_merge_sum_maps(ARRAY_AGG(
        CASE WHEN COALESCE(hs.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.qty_by_size ELSE '{}'::jsonb END
      )) AS qty_sent_by_size
    FROM public.handover_slips hs
    WHERE hs.from_visit_id IS NOT NULL
      AND (p_factory_id IS NULL OR hs.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR hs.order_id = p_order_id)
    GROUP BY hs.factory_id, hs.order_id, hs.colorway_id, public.visit_primary_route_step_id(hs.order_id, hs.from_visit_id)
  ),
  planned AS (
    SELECT la.factory_id, la.order_id, la.colorway_id, la.visit_id, SUM(COALESCE(la.qty, 0))::integer AS planned_qty
    FROM public.line_allocations la
    WHERE la.visit_id IS NOT NULL
      AND (p_factory_id IS NULL OR la.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR la.order_id = p_order_id)
    GROUP BY la.factory_id, la.order_id, la.colorway_id, la.visit_id
  ),
  op_rows AS (
    SELECT
      op.factory_id, op.order_id, op.colorway_id, op.visit_id, op.dept_id, op.dept_name, op.route_seq,
      op.is_primary_output, op.capture_app, op.dept_role, op.step_type,
      COALESCE(recv.qty_received, 0) AS qty_received,
      op.qty_produced,
      COALESCE(sent.qty_sent, 0) AS qty_sent,
      COALESCE(ar.qty_rejected, 0) AS qty_rejected,
      COALESCE(recv.qty_received_by_size, '{}'::jsonb) AS qty_received_by_size,
      op.qty_produced_by_size,
      COALESCE(sent.qty_sent_by_size, '{}'::jsonb) AS qty_sent_by_size,
      COALESCE(ar.qty_rejected_by_size, '{}'::jsonb) AS qty_rejected_by_size,
      COALESCE(ht.qty_in_transit, 0) AS qty_in_transit,
      COALESCE(ht.qty_missing_in_transit, 0) AS qty_missing_in_transit
    FROM op
    LEFT JOIN recv ON recv.factory_id = op.factory_id AND recv.order_id = op.order_id
      AND recv.colorway_id IS NOT DISTINCT FROM op.colorway_id AND recv.operation_id = op.operation_id
    LEFT JOIN sent ON sent.factory_id = op.factory_id AND sent.order_id = op.order_id
      AND sent.colorway_id IS NOT DISTINCT FROM op.colorway_id AND sent.operation_id = op.operation_id
    LEFT JOIN handover_transit ht ON ht.factory_id = op.factory_id AND ht.order_id = op.order_id
      AND ht.colorway_id IS NOT DISTINCT FROM op.colorway_id AND ht.operation_id = op.operation_id
    LEFT JOIN audit_rej ar ON ar.factory_id = op.factory_id AND ar.order_id = op.order_id
      AND ar.colorway_id IS NOT DISTINCT FROM op.colorway_id AND ar.operation_id = op.operation_id
  ),
  visit_agg AS (
    SELECT
      o.factory_id, o.order_id, o.colorway_id, o.visit_id, o.dept_id, o.dept_name,
      MIN(o.route_seq)::integer AS flow_step,
      true AS is_in_flow,
      SUM(o.qty_received)::integer AS qty_received,
      SUM(CASE WHEN o.step_type <> 'loading' AND (o.is_primary_output OR o.dept_role IN ('origin', 'terminal') OR o.capture_app IN ('hourly', 'qc_log', 'batch', 'outsource')) THEN o.qty_produced ELSE 0 END)::integer AS qty_produced,
      SUM(o.qty_sent)::integer AS qty_sent,
      SUM(o.qty_rejected)::integer AS qty_rejected,
      public.jsonb_merge_sum_maps(ARRAY_AGG(o.qty_received_by_size)) AS qty_received_by_size,
      public.jsonb_merge_sum_maps(ARRAY_AGG(
        CASE WHEN o.step_type <> 'loading' AND (o.is_primary_output OR o.dept_role IN ('origin', 'terminal') OR o.capture_app IN ('hourly', 'qc_log', 'batch', 'outsource'))
          THEN o.qty_produced_by_size ELSE '{}'::jsonb END
      )) AS qty_produced_by_size,
      public.jsonb_merge_sum_maps(ARRAY_AGG(o.qty_sent_by_size)) AS qty_sent_by_size,
      public.jsonb_merge_sum_maps(ARRAY_AGG(o.qty_rejected_by_size)) AS qty_rejected_by_size,
      SUM(o.qty_in_transit)::integer AS qty_in_transit,
      SUM(o.qty_missing_in_transit)::integer AS qty_missing_in_transit
    FROM op_rows o
    GROUP BY o.factory_id, o.order_id, o.colorway_id, o.visit_id, o.dept_id, o.dept_name
  )
  SELECT
    v.factory_id, v.order_id, v.colorway_id, v.visit_id, v.dept_id, v.dept_name, v.flow_step, v.is_in_flow,
    v.qty_received, v.qty_produced, v.qty_sent, v.qty_rejected,
    GREATEST(GREATEST(v.qty_received, v.qty_produced) - v.qty_sent, 0)::integer AS wip_qty,
    public.jsonb_subtract_maps_nonneg(
      public.jsonb_merge_sum_maps(ARRAY[v.qty_received_by_size, v.qty_produced_by_size]),
      v.qty_sent_by_size
    ) AS wip_qty_by_size,
    v.qty_received_by_size, v.qty_produced_by_size, v.qty_sent_by_size, v.qty_rejected_by_size,
    v.qty_in_transit, v.qty_missing_in_transit,
    CASE
      WHEN v.qty_received = 0 AND v.qty_produced = 0 THEN 'pending'
      WHEN v.qty_sent > 0 AND v.qty_sent >= GREATEST(v.qty_produced, v.qty_received) THEN 'completed'
      ELSE 'in_progress'
    END AS status,
    COALESCE(p.planned_qty, 0) AS planned_qty,
    GREATEST(COALESCE(p.planned_qty, 0) - GREATEST(v.qty_produced, v.qty_sent), 0)::integer AS remaining_qty,
    GREATEST(v.qty_produced - v.qty_sent, 0)::integer AS available_to_send
  FROM visit_agg v
  LEFT JOIN planned p ON p.factory_id = v.factory_id AND p.order_id = v.order_id
    AND p.colorway_id IS NOT DISTINCT FROM v.colorway_id AND p.visit_id = v.visit_id
  ORDER BY v.flow_step, v.colorway_id NULLS FIRST, v.dept_name;
$function$
;

CREATE OR REPLACE FUNCTION public.order_journey_by_resource_rows(p_factory_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, colorway_id uuid, visit_id uuid, department_id uuid, department_name text, resource_allocation_id uuid, resource_id uuid, resource_name text, resource_type text, operation_id uuid, operation_name text, resource_visit_status text, qty_received integer, qty_produced integer, produced_mins numeric, qty_sent integer, vendor_resource_id uuid, vendor_name text, vendor_sent_qty integer, vendor_received_qty integer, vendor_balance_qty integer, fabric_component_breakdown jsonb, sent_qty_by_resource jsonb, loading_operation_id uuid, loading_operation_name text, loading_qty_produced integer, loading_qty_produced_by_size jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH resource_mins AS (
    SELECT vdp.resource_allocation_id, sum(vdp.produced_mins) AS produced_mins
    FROM public.v_daily_production vdp
    WHERE vdp.resource_allocation_id IS NOT NULL
      AND (p_factory_id IS NULL OR vdp.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR vdp.order_id = p_order_id)
    GROUP BY vdp.resource_allocation_id
  ),
  visit_sent AS (
    SELECT hs.from_visit_id, sum(hs.sent_qty)::integer AS qty_sent
    FROM public.handover_slips hs
    WHERE hs.from_visit_id IS NOT NULL
      AND (p_factory_id IS NULL OR hs.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR hs.order_id = p_order_id)
    GROUP BY hs.from_visit_id
  ),
  visit_received AS (
    SELECT hs.to_visit_id, sum(COALESCE(hs.received_qty, hs.sent_qty, 0))::integer AS qty_received
    FROM public.handover_slips hs
    WHERE hs.to_visit_id IS NOT NULL
      AND (p_factory_id IS NULL OR hs.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR hs.order_id = p_order_id)
    GROUP BY hs.to_visit_id
  ),
  resource_sent_breakdown AS (
    SELECT hs.from_visit_id, jsonb_object_agg(la.id::text, per_la.qty) AS sent_qty_by_resource
    FROM (
      SELECT from_visit_id, from_line_allocation_id, sum(sent_qty)::integer AS qty
      FROM public.handover_slips
      WHERE from_line_allocation_id IS NOT NULL
        AND (p_factory_id IS NULL OR factory_id = p_factory_id)
        AND (p_order_id IS NULL OR order_id = p_order_id)
      GROUP BY from_visit_id, from_line_allocation_id
    ) per_la
    JOIN public.handover_slips hs ON hs.from_visit_id = per_la.from_visit_id
    JOIN public.line_allocations la ON la.id = per_la.from_line_allocation_id
    GROUP BY hs.from_visit_id
  ),
  vendor_info AS (
    SELECT vos.resource_allocation_id, vos.resource_id AS vendor_resource_id, vos.resource_name AS vendor_name,
           vos.sent_qty AS vendor_sent_qty, vos.received_qty AS vendor_received_qty, vos.balance_qty AS vendor_balance_qty
    FROM public.v_outsource_summary vos
    WHERE (p_factory_id IS NULL OR vos.factory_id = p_factory_id)
      AND (p_order_id IS NULL OR vos.order_id = p_order_id)
  ),
  fabric_breakdown AS (
    SELECT sub.resource_allocation_id, jsonb_object_agg(COALESCE(fc.code,'UNSPEC'), sub.qty) AS fabric_component_breakdown
    FROM (SELECT vdp.resource_allocation_id, vdp.fabric_component_id, sum(vdp.qty) AS qty
          FROM public.v_daily_production vdp
          WHERE vdp.capture_source='cutting' AND vdp.resource_allocation_id IS NOT NULL
            AND (p_factory_id IS NULL OR vdp.factory_id = p_factory_id)
            AND (p_order_id IS NULL OR vdp.order_id = p_order_id)
          GROUP BY vdp.resource_allocation_id, vdp.fabric_component_id) sub
    LEFT JOIN public.fabric_components fc ON fc.id = sub.fabric_component_id
    GROUP BY sub.resource_allocation_id
  ),
  loading_info AS (
    SELECT op.factory_id, op.order_id, op.visit_id,
           op.operation_id AS loading_operation_id, op.dept_name AS loading_operation_name,
           op.qty_produced AS loading_qty_produced, op.qty_produced_by_size AS loading_qty_produced_by_size
    FROM public.operation_progress_rows(p_factory_id, p_order_id) op
    WHERE op.step_type = 'loading'
  ),
  produce_info AS (
    SELECT op.factory_id, op.order_id, op.visit_id, SUM(op.qty_produced)::integer AS qty_produced
    FROM public.operation_progress_rows(p_factory_id, p_order_id) op
    WHERE op.step_type <> 'loading'
      AND (op.is_primary_output OR op.dept_role IN ('origin', 'terminal') OR op.capture_app IN ('hourly', 'qc_log', 'batch', 'outsource'))
    GROUP BY op.factory_id, op.order_id, op.visit_id
  )
  SELECT
    la.factory_id, la.order_id, la.colorway_id, la.visit_id,
    d.id AS department_id, d.name AS department_name,
    la.id AS resource_allocation_id,
    ar.id AS resource_id, ar.resource_name, ar.resource_type,
    ors_produce.id AS operation_id, ors_produce.operation_name,
    la.status AS resource_visit_status,
    vr.qty_received,
    COALESCE(pi.qty_produced, 0) AS qty_produced,
    rm.produced_mins,
    COALESCE(vs.qty_sent, 0) AS qty_sent,
    vi.vendor_resource_id, vi.vendor_name, vi.vendor_sent_qty, vi.vendor_received_qty, vi.vendor_balance_qty,
    fb.fabric_component_breakdown,
    rsb.sent_qty_by_resource,
    li.loading_operation_id, li.loading_operation_name,
    COALESCE(li.loading_qty_produced, 0) AS loading_qty_produced,
    COALESCE(li.loading_qty_produced_by_size, '{}'::jsonb) AS loading_qty_produced_by_size
  FROM public.line_allocations la
  JOIN public.departments d ON d.id = la.department_id
  LEFT JOIN public.assigned_resources ar ON ar.id = la.line_id
  LEFT JOIN public.order_routing_steps ors_produce ON ors_produce.order_id = la.order_id
    AND ors_produce.visit_id = la.visit_id AND ors_produce.step_type = 'produce'
  LEFT JOIN produce_info pi ON pi.order_id = la.order_id AND pi.visit_id = la.visit_id
  LEFT JOIN resource_mins rm ON rm.resource_allocation_id = la.id
  LEFT JOIN visit_sent vs ON vs.from_visit_id = la.visit_id
  LEFT JOIN visit_received vr ON vr.to_visit_id = la.visit_id
  LEFT JOIN resource_sent_breakdown rsb ON rsb.from_visit_id = la.visit_id
  LEFT JOIN vendor_info vi ON vi.resource_allocation_id = la.id
  LEFT JOIN fabric_breakdown fb ON fb.resource_allocation_id = la.id
  LEFT JOIN loading_info li ON li.order_id = la.order_id AND li.visit_id = la.visit_id
  WHERE (p_factory_id IS NULL OR la.factory_id = p_factory_id)
    AND (p_order_id IS NULL OR la.order_id = p_order_id);
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_movement_size_sum(p_qty_by_size jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE((
    SELECT SUM((value)::integer)
    FROM jsonb_each_text(COALESCE(p_qty_by_size, '{}'::jsonb))
    WHERE (value)::integer > 0
  ), 0)::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_send_returned_qty(p_send_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(owm.qty), 0)::integer
  FROM public.outsource_work_movements owm
  WHERE owm.linked_send_id = p_send_id
    AND owm.movement_type = 'vendor_receive'
    AND owm.voided_at IS NULL;
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_vendor_movement_net(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_visit_id uuid, p_vendor_resource_id uuid, p_movement_type text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(owm.qty), 0)::integer
  FROM public.outsource_work_movements owm
  WHERE owm.factory_id = p_factory_id
    AND owm.order_id = p_order_id
    AND owm.visit_id = p_visit_id
    AND owm.vendor_resource_id = p_vendor_resource_id
    AND owm.movement_type = p_movement_type
    AND owm.voided_at IS NULL
    AND (p_colorway_id IS NULL OR owm.colorway_id IS NOT DISTINCT FROM p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_visit_at_vendor_qty(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_visit_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    CASE owm.movement_type
      WHEN 'vendor_send' THEN owm.qty
      WHEN 'vendor_receive' THEN -owm.qty
      ELSE 0
    END
  ), 0)::integer
  FROM public.outsource_work_movements owm
  WHERE owm.factory_id = p_factory_id
    AND owm.order_id = p_order_id
    AND owm.visit_id = p_visit_id
    AND owm.voided_at IS NULL
    AND (p_colorway_id IS NULL OR owm.colorway_id IS NOT DISTINCT FROM p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_visit_available_for_handover_send(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_visit_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    public.outsource_visit_returned_qty(
      p_factory_id, p_order_id, p_colorway_id, p_visit_id
    )
    - public.outsource_visit_handover_sent_qty(
      p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id
    ),
    0
  );
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_visit_available_for_vendor_send(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_visit_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    public.outsource_visit_handover_received_qty(
      p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id
    )
    - public.outsource_visit_handover_sent_qty(
      p_factory_id, p_order_id, p_colorway_id, p_department_id, p_visit_id
    )
    - public.outsource_visit_at_vendor_qty(
      p_factory_id, p_order_id, p_colorway_id, p_visit_id
    ),
    0
  );
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_visit_handover_received_qty(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_visit_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(COALESCE(hs.received_qty, 0)), 0)::integer
  FROM public.handover_slips hs
  WHERE hs.factory_id = p_factory_id
    AND hs.order_id = p_order_id
    AND hs.to_department_id = p_department_id
    AND hs.to_visit_id = p_visit_id
    AND hs.status IN ('received', 'disputed', 'received_disputed')
    AND hs.received_qty IS NOT NULL
    AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_visit_handover_sent_qty(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid, p_visit_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(COALESCE(hs.sent_qty, 0)), 0)::integer
  FROM public.handover_slips hs
  WHERE hs.factory_id = p_factory_id
    AND hs.order_id = p_order_id
    AND hs.from_department_id = p_department_id
    AND hs.from_visit_id = p_visit_id
    AND (p_colorway_id IS NULL OR hs.colorway_id IS NOT DISTINCT FROM p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_visit_returned_qty(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_visit_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(owm.qty), 0)::integer
  FROM public.outsource_work_movements owm
  WHERE owm.factory_id = p_factory_id
    AND owm.order_id = p_order_id
    AND owm.visit_id = p_visit_id
    AND owm.movement_type = 'vendor_receive'
    AND owm.voided_at IS NULL
    AND (p_colorway_id IS NULL OR owm.colorway_id IS NOT DISTINCT FROM p_colorway_id);
$function$
;

CREATE OR REPLACE FUNCTION public.outsource_work_movements_fill_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alloc uuid;
BEGIN
  IF NEW.visit_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.order_route_id IS NULL THEN
    NEW.order_route_id := public.visit_primary_route_step_id(NEW.order_id, NEW.visit_id);
  END IF;

  IF NEW.line_allocation_id IS NULL THEN
    v_alloc := public.resolve_outsource_line_allocation_id(
      NEW.order_id,
      NEW.visit_id,
      NEW.colorway_id,
      NEW.vendor_resource_id
    );
    IF v_alloc IS NOT NULL THEN
      NEW.line_allocation_id := v_alloc;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.profile_dept_can_capture_cutting(p_user_id uuid, p_factory_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.floor_user_access fa
      ON fa.profile_id = p.id
     AND fa.factory_id = p.factory_id
    JOIN public.operations op
      ON op.id = fa.operation_id
     AND op.factory_id = fa.factory_id
    WHERE p.id = p_user_id
      AND p.factory_id = p_factory_id
      AND p.status = 'Active'
      AND p.can_produce IS TRUE
      AND op.is_active IS NOT FALSE
      AND op.capture_app IN ('cutting_lay', 'lay_report')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.profile_dept_has_app(p_user_id uuid, p_factory_id uuid, p_app text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH resolved AS (
    SELECT CASE p_app
      WHEN 'lay_report'    THEN 'cutting_lay'
      WHEN 'workforce_log' THEN 'supervisor'
      WHEN 'workforce'     THEN 'supervisor'
      ELSE p_app
    END AS app
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    CROSS JOIN resolved r
    WHERE p.id = p_user_id
      AND p.factory_id = p_factory_id
      AND p.status = 'Active'
      AND (
        p.user_role IN ('admin', 'superadmin')

        OR (r.app = 'transaction' AND p.handover_enabled IS TRUE)

        OR (r.app IN ('supervisor', 'workforce', 'workforce_log')
            AND p.workforce_enabled IS TRUE)

        OR (r.app = 'audit' AND p.audit_enabled IS TRUE AND p.can_produce IS TRUE)

        OR (
          r.app IN ('shipment_log', 'final_rejection_log', 'shipment_audit')
          AND p.shipment_qa_enabled IS TRUE
          AND EXISTS (
            SELECT 1
            FROM public.factories f
            WHERE f.id = p_factory_id
              AND COALESCE(f.shipment_apps, '[]'::jsonb) @> jsonb_build_array(r.app)
          )
        )

        OR (
          p.can_produce IS TRUE
          AND EXISTS (
            SELECT 1
            FROM public.floor_user_access fa
            JOIN public.operations op
              ON op.id = fa.operation_id
             AND op.factory_id = fa.factory_id
            WHERE fa.profile_id = p.id
              AND fa.factory_id = p_factory_id
              AND op.is_active IS NOT FALSE
              AND (
                -- Live routes override catalog for this assigned operation_def
                EXISTS (
                  SELECT 1
                  FROM public.order_routing_steps ors
                  WHERE ors.factory_id = fa.factory_id
                    AND ors.operation_def_id = fa.operation_id
                    AND (
                      ors.capture_app = r.app
                      OR (r.app = 'cutting_lay' AND ors.capture_app IN ('cutting_lay', 'lay_report'))
                    )
                )
                -- Catalog fallback when no route rows set capture_app for this op
                OR (
                  NOT EXISTS (
                    SELECT 1
                    FROM public.order_routing_steps ors
                    WHERE ors.factory_id = fa.factory_id
                      AND ors.operation_def_id = fa.operation_id
                      AND NULLIF(ors.capture_app, '') IS NOT NULL
                  )
                  AND (
                    op.capture_app = r.app
                    OR (r.app = 'cutting_lay' AND op.capture_app IN ('cutting_lay', 'lay_report'))
                  )
                )
              )
          )
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.profile_floor_flags_for_assignment(p_department_id uuid, p_operation_ids uuid[], p_handover_enabled boolean, p_workforce_enabled boolean, p_audit_enabled boolean, p_shipment_qa_enabled boolean)
 RETURNS TABLE(can_produce boolean, handover_enabled boolean, workforce_enabled boolean, audit_enabled boolean, shipment_qa_enabled boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_planning_mode text;
  v_dept_role     text;
  v_has_ops       boolean;
  v_is_supervisor boolean;
  v_is_passive    boolean;
BEGIN
  v_has_ops := p_operation_ids IS NOT NULL AND cardinality(p_operation_ids) > 0;
  v_is_supervisor := COALESCE(p_handover_enabled, false) OR COALESCE(p_workforce_enabled, false);

  SELECT d.planning_mode, d.role
  INTO v_planning_mode, v_dept_role
  FROM public.departments d
  WHERE d.id = p_department_id;

  v_is_passive := COALESCE(v_planning_mode, '') IN ('storage', 'outsource');

  IF COALESCE(p_shipment_qa_enabled, false) THEN
    RETURN QUERY SELECT false, false, false, false, true;
    RETURN;
  END IF;

  -- Store / outsource: operators are not allowed — must be supervisor with handover only
  IF v_is_passive AND v_has_ops AND NOT v_is_supervisor THEN
    RAISE EXCEPTION 'Store and outsource work centers require a supervisor floor role';
  END IF;

  IF v_has_ops AND NOT v_is_supervisor THEN
    RETURN QUERY SELECT
      true,
      false,
      false,
      COALESCE(p_audit_enabled, true),
      false;
    RETURN;
  END IF;

  IF v_is_supervisor OR v_is_passive THEN
    RETURN QUERY SELECT
      false,
      true,
      COALESCE(v_planning_mode, '') = 'production' AND COALESCE(p_workforce_enabled, false),
      false,
      false;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, false, false, false, false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.profile_has_capture_app(p_user_id uuid, p_factory_id uuid, p_app text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_app IN ('shipment_log', 'final_rejection_log', 'shipment_audit') THEN
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_user_id
          AND p.factory_id = p_factory_id
          AND p.status = 'Active'
          AND (
            p.user_role IN ('admin', 'superadmin')
            OR (
              p.shipment_qa_enabled IS TRUE
              AND EXISTS (
                SELECT 1
                FROM public.factories f
                WHERE f.id = p_factory_id
                  AND COALESCE(f.shipment_apps, '[]'::jsonb) @> jsonb_build_array(p_app)
              )
            )
            OR (p_app = 'final_rejection_log' AND p.user_role = 'quality_manager')
          )
      )
    ELSE
      public.profile_dept_has_app(p_user_id, p_factory_id, p_app)
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.proportional_qty_by_size(p_total integer, p_planned jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_plan_total integer;
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_val integer;
  v_allocated integer := 0;
  v_last_key text;
  v_share integer;
BEGIN
  IF p_total IS NULL OR p_total <= 0 OR COALESCE(p_planned, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN '{}'::jsonb;
  END IF;
  v_plan_total := public.jsonb_sum_int_values(p_planned);
  IF v_plan_total <= 0 THEN
    RETURN '{}'::jsonb;
  END IF;
  FOR v_key, v_val IN SELECT key, value::integer FROM jsonb_each_text(p_planned) LOOP
    v_last_key := v_key;
    v_share := ROUND(p_total::numeric * v_val / v_plan_total)::integer;
    v_result := v_result || jsonb_build_object(v_key, v_share);
    v_allocated := v_allocated + v_share;
  END LOOP;
  IF v_last_key IS NOT NULL AND v_allocated <> p_total THEN
    v_result := jsonb_set(
      v_result,
      ARRAY[v_last_key],
      to_jsonb(GREATEST(0, COALESCE((v_result->>v_last_key)::integer, 0) + (p_total - v_allocated)))
    );
  END IF;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rejection_audit_label_to_stage(p_label text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE lower(trim(p_label))
    WHEN 'final audit' THEN 'final_audit'
    WHEN 'pre pack' THEN 'pre_pack'
    WHEN 'post pack' THEN 'post_pack'
    WHEN 'customer return' THEN 'customer_return'
    WHEN 'inline' THEN 'inline'
    WHEN 'end line' THEN 'end_line'
    ELSE lower(regexp_replace(trim(p_label), '\s+', '_', 'g'))
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_floor_user_access(p_profile_id uuid, p_department_id uuid, p_handover_enabled boolean, p_workforce_enabled boolean, p_audit_enabled boolean, p_operation_ids uuid[] DEFAULT '{}'::uuid[], p_shipment_qa_enabled boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory_id    uuid;
  v_flags         record;
  v_op            uuid;
  v_planning_mode text;
  v_has_ops       boolean;
  v_is_supervisor boolean;
  v_keep          uuid[] := COALESCE(p_operation_ids, '{}'::uuid[]);
BEGIN
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT factory_id INTO v_factory_id FROM public.profiles WHERE id = p_profile_id;
  IF v_factory_id IS NULL OR v_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT d.planning_mode INTO v_planning_mode
  FROM public.departments d
  WHERE d.id = p_department_id;

  v_has_ops := cardinality(v_keep) > 0;
  v_is_supervisor := COALESCE(p_handover_enabled, false) OR COALESCE(p_workforce_enabled, false);

  IF COALESCE(v_planning_mode, '') IN ('storage', 'outsource') THEN
    IF v_has_ops AND NOT v_is_supervisor THEN
      RAISE EXCEPTION 'Store and outsource work centers require supervisor floor role';
    END IF;
    IF NOT v_is_supervisor AND NOT COALESCE(p_shipment_qa_enabled, false) THEN
      RAISE EXCEPTION 'Store and outsource work centers require supervisor floor role';
    END IF;
  END IF;

  SELECT * INTO v_flags
  FROM public.profile_floor_flags_for_assignment(
    p_department_id,
    v_keep,
    p_handover_enabled,
    p_workforce_enabled,
    p_audit_enabled,
    COALESCE(p_shipment_qa_enabled, false)
  );

  UPDATE public.profiles
  SET
    department_id = p_department_id,
    user_role = CASE
      WHEN COALESCE(p_shipment_qa_enabled, false) THEN 'quality_manager'
      WHEN v_flags.can_produce THEN 'operator'
      ELSE 'supervisor'
    END,
    can_produce = v_flags.can_produce,
    handover_enabled = v_flags.handover_enabled,
    workforce_enabled = v_flags.workforce_enabled,
    audit_enabled = v_flags.audit_enabled,
    shipment_qa_enabled = v_flags.shipment_qa_enabled,
    updated_at = now()
  WHERE id = p_profile_id;

  UPDATE public.floor_user_access fa
  SET grant_ended_at = now(), updated_at = now()
  WHERE fa.profile_id = p_profile_id
    AND fa.grant_ended_at IS NULL
    AND (
      cardinality(v_keep) = 0
      OR NOT (fa.operation_id = ANY (v_keep))
    );

  IF cardinality(v_keep) > 0 THEN
    UPDATE public.floor_user_access fa
    SET department_id = p_department_id, updated_at = now()
    WHERE fa.profile_id = p_profile_id
      AND fa.grant_ended_at IS NULL
      AND fa.operation_id = ANY (v_keep);

    FOREACH v_op IN ARRAY v_keep LOOP
      UPDATE public.floor_user_access fa
      SET
        grant_ended_at = NULL,
        department_id = p_department_id,
        updated_at = now()
      WHERE fa.profile_id = p_profile_id
        AND fa.operation_id = v_op
        AND fa.grant_ended_at IS NOT NULL;

      IF NOT FOUND THEN
        INSERT INTO public.floor_user_access (
          profile_id, factory_id, department_id, operation_id
        )
        SELECT
          p_profile_id, v_factory_id, p_department_id, o.id
        FROM public.operations o
        WHERE o.id = v_op
          AND o.factory_id = v_factory_id
          AND o.is_active = true
          AND (p_department_id IS NULL OR o.department_id = p_department_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.floor_user_access fa2
            WHERE fa2.profile_id = p_profile_id
              AND fa2.operation_id = v_op
              AND fa2.grant_ended_at IS NULL
          );
      END IF;
    END LOOP;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_capture_line_allocation_id(p_existing uuid, p_order_id uuid, p_colorway_id uuid, p_resource_id uuid, p_route_step_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    p_existing,
    CASE
      WHEN p_route_step_id IS NULL THEN NULL
      ELSE public.resolve_line_allocation_id(
        p_order_id, p_colorway_id, p_resource_id, p_route_step_id
      )
    END
  );
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_capture_order_route_id(p_factory_id uuid, p_order_id uuid, p_department_id uuid, p_order_route_id uuid, p_line_allocation_id uuid, p_prefer_capture_apps text[] DEFAULT ARRAY['hourly'::text])
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT ors.id
      FROM public.order_routing_steps ors
      WHERE ors.factory_id = p_factory_id
        AND ors.order_id = p_order_id
        AND ors.id = p_order_route_id
      LIMIT 1
    ),
    (
      SELECT ors.id
      FROM public.order_routing_steps ors
      WHERE ors.factory_id = p_factory_id
        AND ors.order_id = p_order_id
        AND ors.visit_id = p_order_route_id
      ORDER BY
        CASE WHEN COALESCE(ors.step_type, 'produce') = 'produce' THEN 0
             WHEN COALESCE(ors.step_type, 'produce') = 'loading' THEN 1 ELSE 2 END,
        CASE WHEN COALESCE(ors.is_primary_output, false) THEN 0 ELSE 1 END,
        ors.seq DESC
      LIMIT 1
    ),
    (
      SELECT public.visit_primary_route_step_id(la.order_id, la.visit_id)
      FROM public.line_allocations la
      WHERE la.id = p_line_allocation_id
        AND la.order_id = p_order_id
        AND la.factory_id = p_factory_id
      LIMIT 1
    ),
    (
      SELECT ors.id
      FROM public.order_routing_steps ors
      LEFT JOIN public.departments d ON d.id = ors.dept_id
      WHERE ors.factory_id = p_factory_id
        AND ors.order_id = p_order_id
        AND ors.dept_id IS NOT DISTINCT FROM p_department_id
        AND COALESCE(d.role, 'standard') NOT IN ('origin', 'terminal')
      ORDER BY
        CASE
          WHEN COALESCE(ors.capture_app, 'transaction') = ANY(p_prefer_capture_apps) THEN 0
          ELSE 1
        END,
        CASE WHEN COALESCE(ors.step_type, 'produce') = 'produce' THEN 0
             WHEN COALESCE(ors.step_type, 'produce') = 'loading' THEN 1 ELSE 2 END,
        CASE WHEN COALESCE(ors.is_primary_output, false) THEN 0 ELSE 1 END,
        ors.seq DESC
      LIMIT 1
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_fabric_component_id(p_factory_id uuid, p_fabric_type text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT fc.id
  FROM public.fabric_components fc
  WHERE fc.factory_id = p_factory_id
    AND lower(btrim(fc.fabric_type)) = lower(btrim(COALESCE(p_fabric_type, '')))
  ORDER BY fc.updated_at DESC NULLS LAST
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_line_allocation_for_route(p_order_id uuid, p_colorway_id uuid, p_route_step_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT la.id
  FROM public.line_allocations la
  JOIN public.order_routing_steps ors ON ors.id = p_route_step_id
  WHERE la.order_id = p_order_id
    AND la.visit_id = ors.visit_id
    AND la.colorway_id IS NOT DISTINCT FROM p_colorway_id
  ORDER BY la.line_id NULLS LAST, la.created_at DESC
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_line_allocation_id(p_order_id uuid, p_colorway_id uuid, p_resource_id uuid, p_route_step_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT la.id
  FROM public.line_allocations la
  JOIN public.order_routing_steps ors ON ors.id = p_route_step_id
  WHERE la.order_id = p_order_id
    AND la.visit_id IS NOT DISTINCT FROM ors.visit_id
    AND la.colorway_id IS NOT DISTINCT FROM p_colorway_id
    AND (
      p_resource_id IS NULL
      OR la.line_id IS NOT DISTINCT FROM p_resource_id
      OR la.line_id IS NULL
    )
  ORDER BY
    CASE WHEN la.line_id IS NOT DISTINCT FROM p_resource_id THEN 0 ELSE 1 END,
    CASE WHEN la.line_id IS NULL THEN 2 ELSE 0 END,
    la.created_at DESC NULLS LAST
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_order_route_context(p_factory_id uuid, p_order_route_id uuid)
 RETURNS TABLE(order_route_id uuid, order_id uuid, department_id uuid, dept_name text, step_label text, capture_app text, operation_def_id uuid, visit_id uuid, route_seq integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    r.id,
    r.order_id,
    COALESCE(r.dept_id, op.department_id),
    COALESCE(d.name, r.dept_name),
    COALESCE(
      NULLIF(r.operation_name, ''),
      op.name,
      r.dept_name
    ),
    COALESCE(
      NULLIF(r.capture_app, ''),
      op.capture_app,
      CASE WHEN COALESCE(r.transaction_app, false) THEN 'transaction' END,
      CASE
        WHEN COALESCE(NULLIF(r.step_type, ''), op.step_type) = 'inspect' THEN 'qc_log'
      END,
      'hourly'
    ),
    r.operation_def_id,
    r.visit_id,
    r.seq::integer
  FROM public.order_routing_steps r
  LEFT JOIN public.operations op
    ON op.id = r.operation_def_id
   AND op.factory_id = r.factory_id
  LEFT JOIN public.departments d
    ON d.id = COALESCE(r.dept_id, op.department_id)
   AND d.factory_id = r.factory_id
  WHERE r.factory_id = p_factory_id
    AND r.id = p_order_route_id;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_outsource_line_allocation_id(p_order_id uuid, p_visit_id uuid, p_colorway_id uuid, p_vendor_resource_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT la.id
  FROM public.line_allocations la
  WHERE la.order_id = p_order_id
    AND la.visit_id = p_visit_id
    AND la.colorway_id IS NOT DISTINCT FROM p_colorway_id
  ORDER BY
    CASE
      WHEN p_vendor_resource_id IS NOT NULL
        AND la.line_id IS NOT DISTINCT FROM p_vendor_resource_id
      THEN 0
      ELSE 1
    END,
    la.created_at
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_rejection_department_id(p_factory_id uuid, p_order_id uuid, p_stage text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_stage
    WHEN 'end_line' THEN (SELECT d.id FROM public.departments d WHERE d.factory_id=p_factory_id AND d.name ILIKE 'sewing' ORDER BY d.id LIMIT 1)
    WHEN 'final_audit' THEN (SELECT d.id FROM public.departments d WHERE d.factory_id=p_factory_id AND d.name ILIKE 'quality audit' ORDER BY d.id LIMIT 1)
    WHEN 'pre_pack' THEN (SELECT d.id FROM public.departments d WHERE d.factory_id=p_factory_id AND (d.name ILIKE 'finishing' OR d.name ILIKE 'packing') ORDER BY CASE WHEN d.name ILIKE 'finishing' THEN 0 ELSE 1 END, d.id LIMIT 1)
    WHEN 'post_pack' THEN (SELECT d.id FROM public.departments d WHERE d.factory_id=p_factory_id AND (d.name ILIKE 'packing' OR d.name ILIKE 'finishing') ORDER BY CASE WHEN d.name ILIKE 'packing' THEN 0 ELSE 1 END, d.id LIMIT 1)
    WHEN 'customer_return' THEN (SELECT d.id FROM public.departments d WHERE d.factory_id=p_factory_id AND d.name ILIKE 'shipment' ORDER BY d.id LIMIT 1)
    WHEN 'inline' THEN (
      SELECT ors.dept_id FROM public.order_routing_steps ors
      JOIN public.departments d ON d.id = ors.dept_id AND d.is_production = true
      WHERE ors.order_id = p_order_id AND ors.factory_id = p_factory_id
      ORDER BY CASE WHEN d.name ILIKE 'sewing' THEN 0 ELSE 1 END, ors.seq DESC LIMIT 1
    )
    ELSE (
      SELECT ors.dept_id FROM public.order_routing_steps ors
      WHERE ors.order_id = p_order_id AND ors.factory_id = p_factory_id
      ORDER BY ors.seq DESC LIMIT 1
    )
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_buyer(p_action text, p_factory_id uuid, p_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_code text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_role text DEFAULT NULL::text, p_over_shipment_pct numeric DEFAULT NULL::numeric, p_under_shipment_pct numeric DEFAULT NULL::numeric, p_packing_rule text DEFAULT NULL::text, p_ship_mode text DEFAULT NULL::text, p_destination text DEFAULT NULL::text, p_currency text DEFAULT NULL::text, p_ship_mode_options jsonb DEFAULT NULL::jsonb, p_shipment_type_options jsonb DEFAULT NULL::jsonb, p_destination_countries jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(id uuid, factory_id uuid, name text, code text, country text, type text, status text, contact_name text, contact_email text, contact_role text, over_shipment_pct numeric, under_shipment_pct numeric, packing_rule text, created_at timestamp with time zone, updated_at timestamp with time zone, ship_mode text, destination text, currency text, ship_mode_options jsonb, shipment_type_options jsonb, contact_phone text, destination_countries text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    IF EXISTS (
      SELECT 1 FROM public.style_orders so WHERE so.buyer_id = p_id AND so.factory_id = v_factory_id
    ) THEN
      RAISE EXCEPTION 'Cannot delete buyer: referenced by existing orders';
    END IF;
    DELETE FROM public.buyers b WHERE b.id = p_id AND b.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Buyer name is required';
  END IF;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.buyers (
      id, factory_id, name, code, country, type, status,
      contact_name, contact_email, contact_phone, contact_role,
      over_shipment_pct, under_shipment_pct, packing_rule,
      ship_mode, destination, currency,
      ship_mode_options, shipment_type_options, destination_countries
    ) VALUES (
      v_id, v_factory_id, trim(p_name), p_code, p_country,
      COALESCE(p_type, 'Retail'), COALESCE(p_status, 'Active'),
      p_contact_name, p_contact_email, p_contact_phone, p_contact_role,
      COALESCE(p_over_shipment_pct, 0), COALESCE(p_under_shipment_pct, 0), COALESCE(p_packing_rule, 'Ratio'),
      p_ship_mode, p_destination, p_currency,
      COALESCE(p_ship_mode_options, '[]'::jsonb),
      COALESCE(p_shipment_type_options, '[]'::jsonb),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_destination_countries) x), '{}'::text[])
    );
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.buyers b SET
      name                  = COALESCE(NULLIF(trim(p_name), ''), b.name),
      code                  = COALESCE(p_code, b.code),
      country               = COALESCE(p_country, b.country),
      type                  = COALESCE(p_type, b.type),
      status                = COALESCE(p_status, b.status),
      contact_name          = COALESCE(p_contact_name, b.contact_name),
      contact_email         = COALESCE(p_contact_email, b.contact_email),
      contact_phone         = COALESCE(p_contact_phone, b.contact_phone),
      contact_role          = COALESCE(p_contact_role, b.contact_role),
      over_shipment_pct     = COALESCE(p_over_shipment_pct, b.over_shipment_pct),
      under_shipment_pct    = COALESCE(p_under_shipment_pct, b.under_shipment_pct),
      packing_rule          = COALESCE(p_packing_rule, b.packing_rule),
      ship_mode             = COALESCE(p_ship_mode, b.ship_mode),
      destination           = COALESCE(p_destination, b.destination),
      currency              = COALESCE(p_currency, b.currency),
      ship_mode_options     = COALESCE(p_ship_mode_options, b.ship_mode_options),
      shipment_type_options = COALESCE(p_shipment_type_options, b.shipment_type_options),
      destination_countries = COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_destination_countries) x), b.destination_countries),
      updated_at            = now()
    WHERE b.id = v_id AND b.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Buyer not found'; END IF;
  END IF;

  RETURN QUERY SELECT b.* FROM public.buyers b WHERE b.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_department(p_action text, p_factory_id uuid, p_id uuid DEFAULT NULL::uuid, p_department jsonb DEFAULT '{}'::jsonb, p_defects jsonb DEFAULT NULL::jsonb, p_workforce_rates jsonb DEFAULT NULL::jsonb, p_operations jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(id uuid, factory_id uuid, name text, role text, is_native boolean, sequence integer, planning_mode text, transaction_enabled boolean, supervisor_enabled boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
  v_name       text;
  v_role       text;
  v_is_native  boolean;
  v_sequence   integer;
  v_planning_mode text;
  v_transaction_enabled boolean;
  v_supervisor_enabled  boolean;
  v_rate       jsonb;
  v_op         jsonb;
  v_has_dept_payload boolean;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for delete'; END IF;
    DELETE FROM public.assigned_resources ar WHERE ar.department_id = v_id AND ar.factory_id = v_factory_id;
    DELETE FROM public.defects df WHERE df.department_id = v_id AND df.factory_id = v_factory_id;
    DELETE FROM public.department_workforce_rates wr WHERE wr.department_id = v_id AND wr.factory_id = v_factory_id;
    DELETE FROM public.operations op2 WHERE op2.department_id = v_id AND op2.factory_id = v_factory_id;
    DELETE FROM public.fabric_components fc WHERE fc.department_id = v_id AND fc.factory_id = v_factory_id;
    DELETE FROM public.departments d WHERE d.id = v_id AND d.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  v_has_dept_payload := p_department IS NOT NULL AND p_department <> '{}'::jsonb;

  IF p_action = 'insert' AND NOT v_has_dept_payload THEN
    RAISE EXCEPTION 'department payload is required';
  END IF;

  IF p_action = 'update' AND NOT v_has_dept_payload
     AND p_defects IS NULL AND p_workforce_rates IS NULL AND p_operations IS NULL THEN
    RAISE EXCEPTION 'Nothing to update';
  END IF;

  IF v_has_dept_payload THEN
    v_name       := NULLIF(trim(p_department ->> 'name'), '');
    v_role       := NULLIF(p_department ->> 'role', '');
    v_is_native  := (p_department -> 'is_native')::boolean;
    v_sequence   := (p_department ->> 'sequence')::int;
    v_planning_mode := NULLIF(p_department ->> 'planning_mode', '');
    v_transaction_enabled := (p_department -> 'transaction_enabled')::boolean;
    v_supervisor_enabled  := (p_department -> 'supervisor_enabled')::boolean;
  END IF;

  -- Required fields only enforced on insert -- update supports a partial
  -- payload (e.g. workforce-rates-only or defects-only saves) that relies
  -- on COALESCE below to preserve existing core fields untouched.
  IF p_action = 'insert' THEN
    IF v_name IS NULL THEN RAISE EXCEPTION 'Department name is required'; END IF;
    IF v_role IS NULL THEN RAISE EXCEPTION 'Department role is required'; END IF;
    IF v_planning_mode IS NULL THEN RAISE EXCEPTION 'planning_mode is required'; END IF;
    v_is_native := COALESCE(v_is_native, false);
    v_sequence := COALESCE(v_sequence, 0);
    v_transaction_enabled := COALESCE(v_transaction_enabled, true);
    v_supervisor_enabled := COALESCE(v_supervisor_enabled, false);
  END IF;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.departments (
      id, factory_id, name, role, is_native, sequence, planning_mode,
      transaction_enabled, supervisor_enabled
    ) VALUES (
      v_id, v_factory_id, v_name, v_role, v_is_native, v_sequence, v_planning_mode,
      v_transaction_enabled, v_supervisor_enabled
    );

    IF p_workforce_rates IS NOT NULL AND jsonb_typeof(p_workforce_rates) = 'array' AND jsonb_array_length(p_workforce_rates) > 0 THEN
      FOR v_rate IN SELECT jsonb_array_elements(p_workforce_rates) LOOP
        INSERT INTO public.department_workforce_rates (
          factory_id, department_id, label, shift_id, cost_per_hour,
          effective_month, is_current, sort_order
        ) VALUES (
          v_factory_id,
          v_id,
          v_rate ->> 'label',
          (v_rate ->> 'shift_id')::uuid,
          COALESCE((v_rate ->> 'cost_per_hour')::numeric, 0),
          COALESCE(NULLIF(v_rate ->> 'effective_month', '')::date, CURRENT_DATE),
          COALESCE((v_rate ->> 'is_current')::boolean, true),
          COALESCE((v_rate ->> 'sort_order')::int, 0)
        );
      END LOOP;
    END IF;

    IF p_defects IS NOT NULL AND jsonb_typeof(p_defects) = 'array' AND jsonb_array_length(p_defects) > 0 THEN
      DELETE FROM public.defects df WHERE df.department_id = v_id AND df.factory_id = v_factory_id;
      INSERT INTO public.defects (factory_id, department_id, defects)
      VALUES (v_factory_id, v_id, p_defects);
    END IF;

    IF p_operations IS NOT NULL AND jsonb_typeof(p_operations) = 'array' AND jsonb_array_length(p_operations) > 0 THEN
      FOR v_op IN SELECT jsonb_array_elements(p_operations) LOOP
        INSERT INTO public.operations (
          factory_id, department_id, name, step_type, capture_app, is_active
        ) VALUES (
          v_factory_id,
          v_id,
          v_op ->> 'name',
          COALESCE(v_op ->> 'step_type', 'produce'),
          v_op ->> 'capture_app',
          COALESCE((v_op ->> 'is_active')::boolean, true)
        );
      END LOOP;
    END IF;
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;

    IF v_has_dept_payload THEN
      UPDATE public.departments d SET
        name                = COALESCE(v_name, d.name),
        role                = COALESCE(v_role, d.role),
        is_native           = COALESCE(v_is_native, d.is_native),
        sequence            = COALESCE(v_sequence, d.sequence),
        planning_mode       = COALESCE(v_planning_mode, d.planning_mode),
        transaction_enabled = COALESCE(v_transaction_enabled, d.transaction_enabled),
        supervisor_enabled  = COALESCE(v_supervisor_enabled, d.supervisor_enabled),
        updated_at          = now()
      WHERE d.id = v_id AND d.factory_id = v_factory_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Department not found'; END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = v_id AND d.factory_id = v_factory_id) THEN
        RAISE EXCEPTION 'Department not found';
      END IF;
    END IF;

    IF p_defects IS NOT NULL AND jsonb_typeof(p_defects) = 'array' THEN
      DELETE FROM public.defects df WHERE df.department_id = v_id AND df.factory_id = v_factory_id;
      IF jsonb_array_length(p_defects) > 0 THEN
        INSERT INTO public.defects (factory_id, department_id, defects)
        VALUES (v_factory_id, v_id, p_defects);
      END IF;
    END IF;

    IF p_workforce_rates IS NOT NULL AND jsonb_typeof(p_workforce_rates) = 'array' THEN
      DELETE FROM public.department_workforce_rates wr WHERE wr.department_id = v_id AND wr.factory_id = v_factory_id;
      FOR v_rate IN SELECT jsonb_array_elements(p_workforce_rates) LOOP
        INSERT INTO public.department_workforce_rates (
          factory_id, department_id, label, shift_id, cost_per_hour,
          effective_month, is_current, sort_order
        ) VALUES (
          v_factory_id,
          v_id,
          v_rate ->> 'label',
          (v_rate ->> 'shift_id')::uuid,
          COALESCE((v_rate ->> 'cost_per_hour')::numeric, 0),
          COALESCE(NULLIF(v_rate ->> 'effective_month', '')::date, CURRENT_DATE),
          COALESCE((v_rate ->> 'is_current')::boolean, true),
          COALESCE((v_rate ->> 'sort_order')::int, 0)
        );
      END LOOP;
    END IF;

    IF p_operations IS NOT NULL AND jsonb_typeof(p_operations) = 'array' THEN
      DELETE FROM public.operations op2 WHERE op2.department_id = v_id AND op2.factory_id = v_factory_id;
      FOR v_op IN SELECT jsonb_array_elements(p_operations) LOOP
        INSERT INTO public.operations (
          factory_id, department_id, name, step_type, capture_app, is_active
        ) VALUES (
          v_factory_id,
          v_id,
          v_op ->> 'name',
          COALESCE(v_op ->> 'step_type', 'produce'),
          v_op ->> 'capture_app',
          COALESCE((v_op ->> 'is_active')::boolean, true)
        );
      END LOOP;
    END IF;
  END IF;

  RETURN QUERY
    SELECT d.id, d.factory_id, d.name, d.role, d.is_native, d.sequence,
           d.planning_mode, d.transaction_enabled, d.supervisor_enabled,
           d.created_at, d.updated_at
    FROM public.departments d WHERE d.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_line_plan(p_factory_id uuid, p_order_id uuid, p_colorway_plans jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan            jsonb;
  v_colorway_id     uuid;
  v_alloc           jsonb;
  v_alloc_id        uuid;
  v_keep_ids        uuid[] := ARRAY[]::uuid[];
  v_visit_id        uuid;
  v_department_id   uuid;
  v_department_name text;
  v_line_id         uuid;
  v_planning_mode   text;
  v_resource_type   text;
  v_resource_dept   uuid;
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'factory_id and order_id are required';
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized to save planning';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders WHERE id = p_order_id AND factory_id = p_factory_id
  ) THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF p_colorway_plans IS NULL OR jsonb_typeof(p_colorway_plans) <> 'array' THEN
    RAISE EXCEPTION 'colorway_plans must be a JSON array';
  END IF;

  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_colorway_plans) LOOP
    v_colorway_id := NULLIF(trim(v_plan->>'colorway_id'), '')::uuid;
    IF v_colorway_id IS NULL THEN RAISE EXCEPTION 'Each plan entry requires colorway_id'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.colorways WHERE id = v_colorway_id AND order_id = p_order_id
    ) THEN RAISE EXCEPTION 'Colorway % does not belong to order', v_colorway_id; END IF;

    v_keep_ids := ARRAY[]::uuid[];

    IF v_plan ? 'allocations' AND jsonb_typeof(v_plan->'allocations') = 'array' THEN
      FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_plan->'allocations') LOOP
        v_alloc_id := NULLIF(trim(v_alloc->>'id'), '')::uuid;
        IF v_alloc_id IS NULL THEN v_alloc_id := gen_random_uuid(); END IF;

        v_visit_id := NULLIF(trim(COALESCE(
          v_alloc->>'visit_id',
          v_alloc->>'visitId'
        )), '')::uuid;
        IF v_visit_id IS NULL THEN
          RAISE EXCEPTION 'Each allocation requires visit_id';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.order_routing_steps ors
          WHERE ors.order_id = p_order_id
            AND ors.visit_id = v_visit_id
        ) THEN
          RAISE EXCEPTION 'visit_id % is not on order route', v_visit_id;
        END IF;

        v_department_id   := NULLIF(trim(v_alloc->>'department_id'), '')::uuid;
        v_department_name := NULLIF(trim(v_alloc->>'department_name'), '');
        v_line_id         := NULLIF(trim(v_alloc->>'line_id'), '')::uuid;
        v_planning_mode   := NULL;
        v_resource_type   := NULL;
        v_resource_dept   := NULL;

        SELECT
          COALESCE(
            v_department_id,
            NULLIF(trim(ors.dept_id::text), '')::uuid
          ),
          COALESCE(v_department_name, ors.dept_name)
        INTO v_department_id, v_department_name
        FROM public.order_routing_steps ors
        WHERE ors.order_id = p_order_id
          AND ors.visit_id = v_visit_id
        ORDER BY ors.seq NULLS LAST, ors.id
        LIMIT 1;

        IF v_department_id IS NULL AND v_line_id IS NOT NULL THEN
          SELECT ar.department_id, d.name
            INTO v_department_id, v_department_name
          FROM public.assigned_resources ar
          LEFT JOIN public.departments d ON d.id = ar.department_id
          WHERE ar.id = v_line_id;
        END IF;

        IF v_department_name IS NULL AND v_department_id IS NOT NULL THEN
          SELECT name INTO v_department_name
          FROM public.departments
          WHERE id = v_department_id;
        END IF;

        IF v_department_id IS NOT NULL THEN
          SELECT d.planning_mode INTO v_planning_mode
          FROM public.departments d
          WHERE d.id = v_department_id;
        END IF;

        IF COALESCE(v_planning_mode, '') = 'outsource' AND v_line_id IS NOT NULL THEN
          SELECT ar.resource_type, ar.department_id
            INTO v_resource_type, v_resource_dept
          FROM public.assigned_resources ar
          WHERE ar.id = v_line_id;

          IF v_resource_type IS DISTINCT FROM 'outsourced' THEN
            RAISE EXCEPTION 'Outsource planning requires an outsourced vendor resource (line_id %)', v_line_id;
          END IF;
          IF v_resource_dept IS DISTINCT FROM v_department_id THEN
            RAISE EXCEPTION 'Vendor resource must belong to the outsource work center';
          END IF;
        END IF;

        INSERT INTO public.line_allocations (
          id, factory_id, order_id, colorway_id,
          line_id, department_id, department_name,
          visit_id,
          qty, daily_target, hourly_target,
          start_date, end_date, completed_is_true,
          sam, kpi_inputs, status
        ) VALUES (
          v_alloc_id, p_factory_id, p_order_id, v_colorway_id,
          v_line_id, v_department_id, v_department_name,
          v_visit_id,
          COALESCE((v_alloc->>'qty')::integer, 0),
          COALESCE((v_alloc->>'daily_target')::integer, 0),
          NULLIF(v_alloc->>'hourly_target', '')::numeric,
          NULLIF(v_alloc->>'start_date', '')::date,
          NULLIF(v_alloc->>'end_date', '')::date,
          COALESCE((v_alloc->>'completed_is_true')::boolean, false),
          NULLIF(v_alloc->>'sam', '')::numeric,
          v_alloc->'kpi_inputs',
          COALESCE(NULLIF(v_alloc->>'status', ''), 'planned')
        )
        ON CONFLICT (id) DO UPDATE SET
          line_id             = EXCLUDED.line_id,
          department_id       = EXCLUDED.department_id,
          department_name     = EXCLUDED.department_name,
          visit_id            = EXCLUDED.visit_id,
          qty                 = EXCLUDED.qty,
          daily_target        = EXCLUDED.daily_target,
          hourly_target       = EXCLUDED.hourly_target,
          start_date          = EXCLUDED.start_date,
          end_date            = EXCLUDED.end_date,
          completed_is_true   = EXCLUDED.completed_is_true,
          sam                 = EXCLUDED.sam,
          kpi_inputs          = EXCLUDED.kpi_inputs,
          status              = EXCLUDED.status,
          updated_at          = now();

        v_keep_ids := array_append(v_keep_ids, v_alloc_id);
      END LOOP;
    END IF;

    DELETE FROM public.line_allocations
    WHERE factory_id = p_factory_id
      AND order_id = p_order_id
      AND colorway_id = v_colorway_id
      AND (cardinality(v_keep_ids) = 0 OR NOT (id = ANY (v_keep_ids)));
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_order_routing(p_factory_id uuid, p_order_id uuid, p_steps jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step           jsonb;
  v_id             uuid;
  v_keep           uuid[] := ARRAY[]::uuid[];
  v_op_id          uuid;
  v_op             public.operations%ROWTYPE;
  v_dept_id        uuid;
  v_dept_name      text;
  v_visit_id       uuid;
  v_affected       uuid[] := ARRAY[]::uuid[];
  r                RECORD;
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'factory_id and order_id are required';
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized to save routing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders WHERE id = p_order_id AND factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'steps must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.order_routing_steps
    WHERE factory_id = p_factory_id AND order_id = p_order_id
  ) THEN
    DELETE FROM public.line_allocations
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  CREATE TEMP TABLE _incoming_route_steps (
    id                     uuid NOT NULL,
    seq                    integer NOT NULL,
    operation_def_id       uuid NOT NULL,
    operation_name         text,
    step_type              text,
    capture_app            text,
    dept_id                uuid,
    dept_name              text,
    transaction_app        boolean,
    is_primary_output      boolean,
    is_dept_exit_operation boolean,
    visit_id               uuid NOT NULL,
    visit_no               integer
  ) ON COMMIT DROP;

  FOR v_step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
    v_id := NULLIF(trim(v_step->>'id'), '')::uuid;
    IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

    v_op_id := NULLIF(trim(COALESCE(
      v_step->>'operation_def_id',
      v_step->>'operationDefId'
    )), '')::uuid;
    IF v_op_id IS NULL THEN
      RAISE EXCEPTION 'Each routing step requires operation_def_id (catalog operation)';
    END IF;

    SELECT * INTO v_op FROM public.operations
    WHERE id = v_op_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Operation definition % not found', v_op_id;
    END IF;

    v_dept_id := v_op.department_id;
    SELECT name INTO v_dept_name FROM public.departments WHERE id = v_dept_id;
    v_visit_id := NULLIF(trim(v_step->>'visit_id'), '')::uuid;
    IF v_visit_id IS NULL THEN v_visit_id := gen_random_uuid(); END IF;

    INSERT INTO _incoming_route_steps (
      id, seq, operation_def_id, operation_name, step_type, capture_app,
      dept_id, dept_name, transaction_app, is_primary_output, is_dept_exit_operation, visit_id
    ) VALUES (
      v_id,
      COALESCE((v_step->>'seq')::integer, (v_step->>'flow_step')::integer, 1),
      v_op_id,
      v_op.name,
      v_op.step_type,
      v_op.capture_app,
      v_dept_id,
      COALESCE(v_dept_name, 'Department'),
      COALESCE((v_step->>'transaction_app')::boolean, true),
      COALESCE((v_step->>'is_primary_output')::boolean, false),
      COALESCE((v_step->>'is_dept_exit_operation')::boolean, false),
      v_visit_id
    );
    v_keep := array_append(v_keep, v_id);
  END LOOP;

  -- Compute visit_no: sequential number per distinct visit_id ordered by min(seq)
  UPDATE _incoming_route_steps t
  SET visit_no = sub.visit_no
  FROM (
    SELECT visit_id, dense_rank() OVER (ORDER BY min(seq)) AS visit_no
    FROM _incoming_route_steps
    GROUP BY visit_id
  ) sub
  WHERE t.visit_id = sub.visit_id;

  FOR r IN
    SELECT DISTINCT ors.visit_id
    FROM public.order_routing_steps ors
    WHERE ors.factory_id = p_factory_id
      AND ors.order_id = p_order_id
      AND ors.visit_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM _incoming_route_steps irs
        WHERE irs.visit_id = ors.visit_id
      )
  LOOP
    v_affected := array_append(v_affected, r.visit_id);
  END LOOP;

  IF cardinality(v_affected) > 0 THEN
    DELETE FROM public.line_allocations la
    WHERE la.factory_id = p_factory_id
      AND la.order_id = p_order_id
      AND la.visit_id = ANY (v_affected);
  END IF;

  IF to_regclass('public.batch_production') IS NOT NULL THEN
    DELETE FROM public.batch_production bp
    WHERE bp.factory_id = p_factory_id
      AND bp.order_id = p_order_id
      AND bp.order_route_id IN (
        SELECT ors.id
        FROM public.order_routing_steps ors
        WHERE ors.factory_id = p_factory_id
          AND ors.order_id = p_order_id
          AND (cardinality(v_keep) = 0 OR NOT (ors.id = ANY (v_keep)))
      );
  END IF;

  UPDATE public.order_routing_steps
  SET seq = seq + 100000
  WHERE factory_id = p_factory_id
    AND order_id = p_order_id;

  FOR r IN SELECT * FROM _incoming_route_steps ORDER BY seq LOOP
    INSERT INTO public.order_routing_steps (
      id, factory_id, order_id, seq,
      dept_id, dept_name, step_type, capture_app,
      transaction_app, operation_name, operation_def_id,
      is_primary_output, is_dept_exit_operation, visit_id, visit_no
    ) VALUES (
      r.id, p_factory_id, p_order_id, r.seq,
      r.dept_id, r.dept_name, r.step_type, r.capture_app,
      r.transaction_app, r.operation_name, r.operation_def_id,
      r.is_primary_output, r.is_dept_exit_operation, r.visit_id, r.visit_no
    )
    ON CONFLICT (id) DO UPDATE SET
      seq                    = EXCLUDED.seq,
      dept_id                = EXCLUDED.dept_id,
      dept_name              = EXCLUDED.dept_name,
      step_type              = EXCLUDED.step_type,
      capture_app            = EXCLUDED.capture_app,
      transaction_app        = EXCLUDED.transaction_app,
      operation_name         = EXCLUDED.operation_name,
      operation_def_id       = EXCLUDED.operation_def_id,
      is_primary_output      = EXCLUDED.is_primary_output,
      is_dept_exit_operation = EXCLUDED.is_dept_exit_operation,
      visit_id               = EXCLUDED.visit_id,
      visit_no               = EXCLUDED.visit_no,
      updated_at             = now();
  END LOOP;

  DELETE FROM public.order_routing_steps
  WHERE factory_id = p_factory_id
    AND order_id = p_order_id
    AND (cardinality(v_keep) = 0 OR NOT (id = ANY (v_keep)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_process_flow(p_action text, p_factory_id uuid, p_id uuid DEFAULT NULL::uuid, p_old_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_steps jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(id uuid, factory_id uuid, name text, description text, steps jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
  v_steps      jsonb;
  v_dup_visit  int;
  v_dup_label  text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    DELETE FROM public.process_flows pf WHERE pf.id = p_id AND pf.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update', 'version') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Process flow name is required';
  END IF;

  v_steps := COALESCE(p_steps, '[]'::jsonb);
  IF jsonb_typeof(v_steps) <> 'array' THEN
    RAISE EXCEPTION 'Steps must be an array';
  END IF;

  SELECT t.vn, t.label
    INTO v_dup_visit, v_dup_label
  FROM (
    SELECT (elem->>'visit_number')::int AS vn, lower(trim(elem->>'name')) AS label
    FROM jsonb_array_elements(v_steps) elem
    WHERE elem->>'name' IS NOT NULL AND trim(elem->>'name') <> ''
  ) t
  GROUP BY t.vn, t.label
  HAVING count(*) > 1
  LIMIT 1;

  IF v_dup_visit IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate operation label "%" in visit %', v_dup_label, 'visit_' || v_dup_visit;
  END IF;

  IF p_action = 'update' THEN
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.process_flows pf SET
      name        = COALESCE(trim(p_name), pf.name),
      description = COALESCE(NULLIF(trim(p_description), ''), pf.description),
      steps       = CASE WHEN p_steps IS NOT NULL THEN v_steps ELSE pf.steps END,
      updated_at  = now()
    WHERE pf.id = v_id AND pf.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Process flow not found'; END IF;
  ELSE
    v_id := COALESCE(p_id, gen_random_uuid());
    IF p_action = 'version' AND p_old_id IS NOT NULL THEN
      DELETE FROM public.process_flows pf WHERE pf.id = p_old_id AND pf.factory_id = v_factory_id;
    END IF;
    INSERT INTO public.process_flows (id, factory_id, name, description, steps)
    VALUES (v_id, v_factory_id, trim(p_name), NULLIF(trim(p_description), ''), v_steps);
  END IF;

  RETURN QUERY SELECT pf.* FROM public.process_flows pf WHERE pf.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_resource(p_action text, p_factory_id uuid, p_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid, p_resource_name text DEFAULT NULL::text, p_resource_type text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, factory_id uuid, department_id uuid, resource_name text, resource_type text, capacity integer, status text, description text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'id is required for delete'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.outsource_work_movements owm
      WHERE owm.vendor_resource_id = p_id AND owm.factory_id = v_factory_id
    ) THEN
      RAISE EXCEPTION 'Cannot delete resource: referenced by outsource work movement history';
    END IF;
    DELETE FROM public.assigned_resources ar WHERE ar.id = p_id AND ar.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  -- Required fields only enforced on insert -- update supports a partial
  -- payload (e.g. capacity-only or status-only changes), same principle
  -- as save_department's fix.
  IF p_action = 'insert' THEN
    IF p_resource_name IS NULL OR trim(p_resource_name) = '' THEN
      RAISE EXCEPTION 'Resource name is required';
    END IF;
    IF p_department_id IS NULL THEN
      RAISE EXCEPTION 'department_id is required';
    END IF;
    IF p_resource_type IS NULL OR trim(p_resource_type) = '' THEN
      RAISE EXCEPTION 'Resource type is required';
    END IF;
    IF p_capacity IS NULL THEN
      RAISE EXCEPTION 'Capacity is required';
    END IF;
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.assigned_resources (
      id, factory_id, department_id, resource_name, resource_type, capacity, status, description
    ) VALUES (
      v_id, v_factory_id, p_department_id, trim(p_resource_name),
      trim(p_resource_type), p_capacity, COALESCE(NULLIF(trim(p_status), ''), 'active'), p_description
    );
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.assigned_resources ar SET
      department_id = COALESCE(p_department_id, ar.department_id),
      resource_name = COALESCE(NULLIF(trim(p_resource_name), ''), ar.resource_name),
      resource_type = COALESCE(NULLIF(trim(p_resource_type), ''), ar.resource_type),
      capacity      = COALESCE(p_capacity, ar.capacity),
      status        = COALESCE(NULLIF(trim(p_status), ''), ar.status),
      description   = COALESCE(p_description, ar.description),
      updated_at    = now()
    WHERE ar.id = v_id AND ar.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Resource not found'; END IF;
  END IF;

  RETURN QUERY
    SELECT ar.id, ar.factory_id, ar.department_id, ar.resource_name, ar.resource_type,
           ar.capacity, ar.status, ar.description, ar.created_at, ar.updated_at
    FROM public.assigned_resources ar WHERE ar.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_shift(p_action text, p_factory_id uuid, p_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_type text DEFAULT 'Regular'::text, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_break_start time without time zone DEFAULT NULL::time without time zone, p_break_end time without time zone DEFAULT NULL::time without time zone, p_hours jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(id uuid, factory_id uuid, name text, type text, start_time time without time zone, end_time time without time zone, break_start time without time zone, break_end time without time zone, hours jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, productive_mins numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id            uuid;
  v_factory_id    uuid;
  v_hours         jsonb;
  v_len           int;
  v_new_blocks    jsonb;
  i               int;
  j               int;
  v_block         jsonb;
  v_prev          jsonb;
  v_start_min     int;
  v_end_min       int;
  v_prev_end_min  int;
  v_peer          record;
  v_peer_block    jsonb;
  v_peer_start    int;
  v_peer_end      int;
  v_k             int;
  v_active_mins   int := 0;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    DELETE FROM public.shifts s WHERE s.id = p_id AND s.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Shift name is required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array' OR jsonb_array_length(p_hours) = 0 THEN
    RAISE EXCEPTION 'Add at least one hour block';
  END IF;

  v_hours := p_hours;
  v_len := jsonb_array_length(v_hours);

  v_new_blocks := '[]'::jsonb;
  FOR i IN 0 .. v_len - 1 LOOP
    v_block := v_hours -> i;
    IF v_block IS NULL OR v_block = '{}'::jsonb THEN
      RAISE EXCEPTION 'Hour block % is empty', i + 1;
    END IF;
    v_start_min := (EXTRACT(EPOCH FROM (v_block ->> 'start')::time) / 60)::int;
    v_end_min   := (EXTRACT(EPOCH FROM (v_block ->> 'end')::time) / 60)::int;
    IF v_start_min = v_end_min THEN
      RAISE EXCEPTION 'Hour block % has invalid start/end times', i + 1;
    END IF;
    IF v_end_min < v_start_min THEN
      v_end_min := v_end_min + 1440;
    END IF;
    IF v_block ->> 'type' IS NULL OR v_block ->> 'type' <> 'break' THEN
      v_active_mins := v_active_mins + (v_end_min - v_start_min);
    END IF;
    v_new_blocks := v_new_blocks || jsonb_build_array(jsonb_build_object('s', v_start_min, 'e', v_end_min));
  END LOOP;

  FOR i IN 1 .. v_len - 1 LOOP
    v_prev := v_hours -> (i - 1);
    v_block := v_hours -> i;
    IF (v_prev ->> 'end') <> (v_block ->> 'start') THEN
      RAISE EXCEPTION 'Gap or overlap between hour block % and %', i, i + 1;
    END IF;
  END LOOP;

  FOR v_peer IN SELECT s.id, s.hours FROM public.shifts s WHERE s.factory_id = v_factory_id AND (p_action = 'insert' OR s.id <> p_id) LOOP
    FOR j IN 0 .. jsonb_array_length(v_peer.hours) - 1 LOOP
      v_peer_block := v_peer.hours -> j;
      v_peer_start := (EXTRACT(EPOCH FROM (v_peer_block ->> 'start')::time) / 60)::int;
      v_peer_end   := (EXTRACT(EPOCH FROM (v_peer_block ->> 'end')::time) / 60)::int;
      IF v_peer_end < v_peer_start THEN
        v_peer_end := v_peer_end + 1440;
      END IF;
      FOR v_k IN -1 .. 1 LOOP
        FOR i IN 0 .. jsonb_array_length(v_new_blocks) - 1 LOOP
          v_block := v_new_blocks -> i;
          v_start_min := (v_block ->> 's')::int;
          v_end_min   := (v_block ->> 'e')::int;
          IF v_start_min < (v_peer_end + v_k * 1440)
             AND (v_peer_start + v_k * 1440) < v_end_min THEN
            RAISE EXCEPTION 'Shift time overlaps with existing shift';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.shifts (
      id, factory_id, name, type, start_time, end_time, break_start, break_end, hours, productive_mins
    ) VALUES (
      v_id, v_factory_id, trim(p_name), COALESCE(p_type, 'Regular'),
      p_start_time, p_end_time, p_break_start, p_break_end, v_hours, v_active_mins
    );
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.shifts s SET
      name           = trim(p_name),
      type           = COALESCE(p_type, s.type),
      start_time     = p_start_time,
      end_time       = p_end_time,
      break_start    = p_break_start,
      break_end      = p_break_end,
      hours          = v_hours,
      productive_mins = v_active_mins,
      updated_at     = now()
    WHERE s.id = v_id AND s.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  END IF;

  RETURN QUERY SELECT s.* FROM public.shifts s WHERE s.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_size_group(p_action text, p_factory_id uuid, p_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_buyer_id uuid DEFAULT NULL::uuid, p_sizes jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(id uuid, factory_id uuid, buyer_id uuid, name text, sizes jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    DELETE FROM public.size_groups sg WHERE sg.id = p_id AND sg.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.size_groups (id, factory_id, buyer_id, name, sizes)
    VALUES (v_id, v_factory_id, p_buyer_id, trim(p_name), COALESCE(p_sizes, '[]'::jsonb));
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.size_groups sg SET
      name       = trim(p_name),
      buyer_id   = p_buyer_id,
      sizes      = COALESCE(p_sizes, '[]'::jsonb),
      updated_at = now()
    WHERE sg.id = v_id AND sg.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Size group not found'; END IF;
  END IF;

  RETURN QUERY SELECT sg.* FROM public.size_groups sg WHERE sg.id = v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_style_order(p_factory_id uuid, p_order jsonb, p_colorways jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id          uuid;
  v_cw                jsonb;
  v_cw_id             uuid;
  v_keep_cw_ids       uuid[] := ARRAY[]::uuid[];
  v_is_update         boolean;
  v_internal_no       text;
  v_line              jsonb;
  v_line_id           uuid;
  v_line_cw_id        uuid;
  v_keep_line_ids     uuid[] := ARRAY[]::uuid[];
  v_ship              jsonb;
  v_existing_date     date;
  v_existing_status   text;
  v_new_date          date;
  v_history           jsonb;
  v_reason            text;
  v_line_reason       text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_order IS NULL OR p_order = '{}'::jsonb THEN RAISE EXCEPTION 'order payload required'; END IF;

  v_order_id  := NULLIF(trim(p_order->>'id'), '')::uuid;
  v_is_update := v_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.style_orders WHERE id = v_order_id AND factory_id = p_factory_id
  );

  IF v_is_update THEN
    UPDATE public.style_orders SET
      style_name         = NULLIF(p_order->>'style_name', ''),
      style_ref          = NULLIF(p_order->>'style_ref', ''),
      buyer_id           = NULLIF(p_order->>'buyer_id', '')::uuid,
      buyer_name         = NULLIF(p_order->>'buyer_name', ''),
      po_number          = COALESCE(NULLIF(p_order->>'po_number', ''), po_number),
      order_qty          = COALESCE((p_order->>'order_qty')::integer, 0),
      adj_qty            = COALESCE((p_order->>'adj_qty')::integer, 0),
      order_date         = NULLIF(p_order->>'order_date', '')::date,
      job_card_date      = NULLIF(p_order->>'job_card_date', '')::date,
      season             = NULLIF(p_order->>'season', ''),
      garment_type       = NULLIF(p_order->>'garment_type', ''),
      sewing_sam         = NULLIF(p_order->>'sewing_sam', '')::numeric,
      priority           = COALESCE(NULLIF(p_order->>'priority', ''), priority),
      order_type         = COALESCE(NULLIF(p_order->>'order_type', ''), order_type),
      merchant_name      = NULLIF(p_order->>'merchant_name', ''),
      size_group_name    = NULLIF(p_order->>'size_group_name', ''),
      size_labels        = NULLIF(p_order->>'size_labels', ''),
      current_dept       = COALESCE(NULLIF(p_order->>'current_dept', ''), current_dept),
      status             = COALESCE(NULLIF(p_order->>'status', ''), status),
      image_url          = NULLIF(p_order->>'image_url', ''),
      remarks            = NULLIF(p_order->>'remarks', ''),
      cutting_allowance  = COALESCE((p_order->>'cutting_allowance')::numeric, cutting_allowance),
      shipment_allowance = COALESCE((p_order->>'shipment_allowance')::numeric, shipment_allowance),
      updated_at         = now()
    WHERE id = v_order_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  ELSE
    v_order_id    := COALESCE(v_order_id, gen_random_uuid());
    v_internal_no := public.next_internal_order_no(p_factory_id);
    INSERT INTO public.style_orders (
      id, factory_id, internal_order_no,
      style_name, style_ref, buyer_id, buyer_name, po_number,
      order_qty, adj_qty, order_date, job_card_date,
      season, garment_type, sewing_sam, priority, order_type,
      merchant_name, size_group_name, size_labels,
      current_dept, status, image_url, remarks,
      cutting_allowance, shipment_allowance
    ) VALUES (
      v_order_id, p_factory_id, v_internal_no,
      NULLIF(p_order->>'style_name', ''),
      NULLIF(p_order->>'style_ref', ''),
      NULLIF(p_order->>'buyer_id', '')::uuid,
      NULLIF(p_order->>'buyer_name', ''),
      COALESCE(NULLIF(p_order->>'po_number', ''), ''),
      COALESCE((p_order->>'order_qty')::integer, 0),
      COALESCE((p_order->>'adj_qty')::integer, 0),
      NULLIF(p_order->>'order_date', '')::date,
      NULLIF(p_order->>'job_card_date', '')::date,
      NULLIF(p_order->>'season', ''),
      NULLIF(p_order->>'garment_type', ''),
      NULLIF(p_order->>'sewing_sam', '')::numeric,
      COALESCE(NULLIF(p_order->>'priority', ''), 'normal'),
      COALESCE(NULLIF(p_order->>'order_type', ''), 'new'),
      NULLIF(p_order->>'merchant_name', ''),
      NULLIF(p_order->>'size_group_name', ''),
      NULLIF(p_order->>'size_labels', ''),
      COALESCE(NULLIF(p_order->>'current_dept', ''), 'Planned'),
      COALESCE(NULLIF(p_order->>'status', ''), 'Not Started'),
      NULLIF(p_order->>'image_url', ''),
      NULLIF(p_order->>'remarks', ''),
      COALESCE((p_order->>'cutting_allowance')::numeric, 2),
      COALESCE((p_order->>'shipment_allowance')::numeric, 0)
    );
  END IF;

  IF p_colorways IS NOT NULL AND jsonb_typeof(p_colorways) = 'array' THEN
    FOR v_cw IN SELECT value FROM jsonb_array_elements(p_colorways) LOOP
      v_cw_id := NULLIF(trim(v_cw->>'id'), '')::uuid;
      IF v_cw_id IS NULL THEN v_cw_id := gen_random_uuid(); END IF;
      v_keep_cw_ids := array_append(v_keep_cw_ids, v_cw_id);

      INSERT INTO public.colorways (
        id, order_id, factory_id, name, color_code, qty, adj_qty, sizes, planning_remarks
      ) VALUES (
        v_cw_id, v_order_id, p_factory_id,
        COALESCE(NULLIF(v_cw->>'name', ''), 'Color'),
        COALESCE(NULLIF(v_cw->>'color_code', ''), ''),
        COALESCE((v_cw->>'qty')::integer, 0),
        COALESCE((v_cw->>'adj_qty')::integer, 0),
        COALESCE(v_cw->'sizes', '[]'::jsonb),
        NULLIF(v_cw->>'planning_remarks', '')
      )
      ON CONFLICT (id) DO UPDATE SET
        name             = EXCLUDED.name,
        color_code       = EXCLUDED.color_code,
        qty              = EXCLUDED.qty,
        adj_qty          = EXCLUDED.adj_qty,
        sizes            = EXCLUDED.sizes,
        planning_remarks = EXCLUDED.planning_remarks,
        updated_at       = now();
    END LOOP;

    DELETE FROM public.colorways
    WHERE order_id = v_order_id AND id <> ALL (v_keep_cw_ids);
  END IF;

  v_ship := COALESCE(p_order->'shipment_plan', '{}'::jsonb);

  IF v_ship ? 'lines' AND jsonb_typeof(v_ship->'lines') = 'array' THEN
    v_reason := NULLIF(trim(p_order->>'date_change_reason'), '');

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_ship->'lines') LOOP
      v_line_cw_id := NULLIF(trim(v_line->>'colorwayId'), '')::uuid;
      IF v_line_cw_id IS NULL THEN CONTINUE; END IF;

      v_line_id  := NULLIF(trim(v_line->>'id'), '')::uuid;
      v_new_date := NULLIF(v_line->>'shipmentDate', '')::date;

      IF v_line_id IS NULL THEN
        v_line_id := gen_random_uuid();
        v_keep_line_ids := array_append(v_keep_line_ids, v_line_id);

        INSERT INTO public.order_delivery_targets (
          id, factory_id, order_id, colorway_id,
          target_date, ship_mode, shipment_type,
          qty_by_size, destination_country,
          status, change_history, notes, updated_at
        ) VALUES (
          v_line_id, p_factory_id, v_order_id, v_line_cw_id,
          v_new_date,
          NULLIF(v_line->>'shipMode', ''),
          NULLIF(v_line->>'shipmentType', ''),
          COALESCE(v_line->'sizes', '{}'::jsonb),
          NULLIF(trim(v_line->>'destinationCountry'), ''),
          'planned',
          COALESCE(
            CASE
              WHEN v_line ? 'changeHistory' AND jsonb_typeof(v_line->'changeHistory') = 'array'
              THEN v_line->'changeHistory'
              ELSE NULL
            END,
            '[]'::jsonb
          ),
          NULLIF(trim(v_line->>'notes'), ''),
          now()
        );
      ELSE
        v_keep_line_ids := array_append(v_keep_line_ids, v_line_id);

        SELECT target_date, status, COALESCE(change_history, '[]'::jsonb)
          INTO v_existing_date, v_existing_status, v_history
          FROM public.order_delivery_targets
          WHERE id = v_line_id AND order_id = v_order_id AND factory_id = p_factory_id;

        v_line_reason := NULLIF(trim(v_line->>'dateChangeReason'), '');

        IF v_existing_date IS NOT NULL
           AND v_existing_date IS DISTINCT FROM v_new_date
           AND COALESCE(v_line_reason, v_reason) IS NOT NULL THEN
          v_history := v_history || jsonb_build_object(
            'previous_date', v_existing_date::text,
            'new_date',       v_new_date::text,
            'reason',         COALESCE(v_line_reason, v_reason),
            'changed_at',     now()::text,
            'changed_by',     auth.uid()::text
          );
        END IF;

        IF v_history IS NULL THEN v_history := '[]'::jsonb; END IF;

        INSERT INTO public.order_delivery_targets (
          id, factory_id, order_id, colorway_id,
          target_date, ship_mode, shipment_type,
          qty_by_size, destination_country,
          status, change_history, notes, updated_at
        ) VALUES (
          v_line_id, p_factory_id, v_order_id, v_line_cw_id,
          v_new_date,
          NULLIF(v_line->>'shipMode', ''),
          NULLIF(v_line->>'shipmentType', ''),
          COALESCE(v_line->'sizes', '{}'::jsonb),
          NULLIF(trim(v_line->>'destinationCountry'), ''),
          CASE
            WHEN NULLIF(v_line->>'status', '') = 'rescheduled' THEN 'rescheduled'
            WHEN v_existing_date IS NOT NULL AND v_existing_date IS DISTINCT FROM v_new_date THEN 'replanned'
            WHEN v_existing_status IN ('planned', 'replanned') THEN v_existing_status
            ELSE 'planned'
          END,
          v_history,
          NULLIF(trim(v_line->>'notes'), ''),
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          target_date         = EXCLUDED.target_date,
          ship_mode           = EXCLUDED.ship_mode,
          shipment_type       = EXCLUDED.shipment_type,
          qty_by_size         = EXCLUDED.qty_by_size,
          destination_country = EXCLUDED.destination_country,
          status              = EXCLUDED.status,
          change_history      = EXCLUDED.change_history,
          notes               = EXCLUDED.notes,
          updated_at          = now();
      END IF;
    END LOOP;

    DELETE FROM public.order_delivery_targets
    WHERE order_id = v_order_id
      AND id <> ALL (v_keep_line_ids)
      AND COALESCE(status, 'planned') IS DISTINCT FROM 'rescheduled';
  END IF;

  RETURN v_order_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_department_defects()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.defects (factory_id, department_id, defects)
  VALUES (
    NEW.factory_id,
    NEW.id,
    public.default_defects_for_department(NEW.name)
  )
  ON CONFLICT (factory_id, department_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_factory_app_configuration(p_factory_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.app_configuration (factory_id, step_type, allowed_apps) VALUES
    (p_factory_id, 'loading',   '["hourly"]'::jsonb),
    (p_factory_id, 'produce',   '["hourly","qc_log","batch"]'::jsonb),
    (p_factory_id, 'store',     '[]'::jsonb),
    (p_factory_id, 'outsource', '[]'::jsonb)
  ON CONFLICT (factory_id, step_type) DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_factory_native_departments(p_factory_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutting_id   uuid;
  v_shipment_id  uuid;
BEGIN
  PERFORM public.seed_factory_app_configuration(p_factory_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.departments
    WHERE factory_id = p_factory_id AND lower(name) = 'cutting'
  ) THEN
    INSERT INTO public.departments (
      factory_id, name, sequence, apps, is_outsourced, role, is_native, production_path
    ) VALUES (
      p_factory_id, 'Cutting', 1,
      '["transaction","cutting_lay","supervisor"]'::jsonb,
      false, 'origin', true, 'native_cutting'
    );
  END IF;

  SELECT id INTO v_cutting_id
  FROM public.departments
  WHERE factory_id = p_factory_id AND lower(name) = 'cutting'
  LIMIT 1;

  IF v_cutting_id IS NOT NULL THEN
    UPDATE public.departments
    SET role = 'origin',
        is_native = true,
        production_path = 'native_cutting',
        apps = '["transaction","cutting_lay","supervisor"]'::jsonb,
        worker_roles = COALESCE(NULLIF(worker_roles, '[]'::jsonb), '["Cutter","Helper"]'::jsonb)
    WHERE id = v_cutting_id;

    INSERT INTO public.operations (
      factory_id, department_id, name, step_type, capture_app
    )
    SELECT p_factory_id, v_cutting_id, 'Fixed Cutting', 'produce', 'cutting_lay'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.operations
      WHERE department_id = v_cutting_id AND lower(name) = 'fixed cutting' AND is_active = true
    );

    UPDATE public.operations
    SET capture_app = 'cutting_lay',
        step_type = 'produce'
    WHERE department_id = v_cutting_id
      AND is_active = true
      AND step_type = 'produce';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.departments
    WHERE factory_id = p_factory_id AND lower(name) = 'shipment'
  ) THEN
    INSERT INTO public.departments (
      factory_id, name, sequence, apps, is_outsourced, role, is_native, production_path
    ) VALUES (
      p_factory_id, 'Shipment', 999,
      '["shipment_log","final_rejection_log","shipment_audit"]'::jsonb,
      false, 'terminal', true, 'native_shipment'
    );
  END IF;

  SELECT id INTO v_shipment_id
  FROM public.departments
  WHERE factory_id = p_factory_id AND lower(name) = 'shipment'
  LIMIT 1;

  IF v_shipment_id IS NOT NULL THEN
    UPDATE public.departments
    SET role = 'terminal',
        is_native = true,
        production_path = 'native_shipment',
        apps = '["shipment_log","final_rejection_log","shipment_audit"]'::jsonb
    WHERE id = v_shipment_id;

    INSERT INTO public.operations (
      factory_id, department_id, name, step_type, capture_app
    )
    SELECT p_factory_id, v_shipment_id, 'Dispatch', 'store', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM public.operations
      WHERE department_id = v_shipment_id AND lower(name) = 'dispatch' AND is_active = true
    );
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_defects_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.shift_productive_mins_from_hours(p_hours jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(SUM(
    CASE
      WHEN slot->>'type' = 'active' THEN
        EXTRACT(EPOCH FROM (
          (slot->>'end')::time - (slot->>'start')::time
          + CASE
              WHEN (slot->>'end')::time < (slot->>'start')::time THEN interval '24 hours'
              ELSE interval '0'
            END
        )) / 60.0
      ELSE 0
    END
  ), 0)
  FROM jsonb_array_elements(COALESCE(p_hours, '[]'::jsonb)) AS slot;
$function$
;

CREATE OR REPLACE FUNCTION public.standard_production_alloc_grid(p_factory_id uuid, p_order_id uuid)
 RETURNS TABLE(factory_id uuid, order_id uuid, operation_id uuid, visit_id uuid, department_id uuid, dept_name text, capture_app text, step_type text, dept_role text, planning_mode text, is_primary_output boolean, line_allocation_id uuid, colorway_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    ors.factory_id,
    ors.order_id,
    ors.id AS operation_id,
    COALESCE(
      ors.visit_id,
      (
        SELECT p.id
        FROM public.order_routing_steps p
        WHERE p.order_id = ors.order_id
          AND p.dept_id IS NOT DISTINCT FROM ors.dept_id
          AND p.is_primary_output IS TRUE
        ORDER BY p.seq
        LIMIT 1
      ),
      ors.id
    ) AS visit_id,
    ors.dept_id AS department_id,
    ors.dept_name AS dept_name,
    COALESCE(ors.capture_app, CASE WHEN ors.step_type = 'loading' THEN 'hourly' WHEN ors.step_type = 'outsource' THEN 'outsource' ELSE 'transaction' END) AS capture_app,
    COALESCE(ors.step_type, 'produce') AS step_type,
    COALESCE(d.role, 'standard') AS dept_role,
    COALESCE(d.planning_mode, 'production') AS planning_mode,
    COALESCE(ors.is_primary_output, false) AS is_primary_output,
    la.id AS line_allocation_id,
    la.colorway_id
  FROM public.order_routing_steps ors
    LEFT JOIN public.departments d ON d.id = ors.dept_id
  JOIN public.line_allocations la
    ON la.order_id = ors.order_id
   AND la.factory_id = ors.factory_id
   AND la.visit_id IS NOT DISTINCT FROM ors.visit_id
  WHERE (p_factory_id IS NULL OR ors.factory_id = p_factory_id)
    AND (p_order_id IS NULL OR ors.order_id = p_order_id)
    AND ors.visit_id IS NOT NULL
    AND COALESCE(d.role, 'standard') = 'standard'
    AND COALESCE(d.planning_mode, 'production') IN ('production', 'outsource');
$function$
;

CREATE OR REPLACE FUNCTION public.sync_colorway_ready_to_ship(p_order_id uuid, p_colorway_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory_id uuid;
  v_last_dept uuid;
  v_cutting_dept uuid;
  v_floor_status text;
  v_cut_qty integer := 0;
  v_last_ready integer := 0;
  v_rejected integer := 0;
  v_rejected_ledger integer := 0;
  v_rejected_qc integer := 0;
  v_gap integer := 0;
BEGIN
  IF p_colorway_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.shipment_floor_status, so.factory_id
  INTO v_floor_status, v_factory_id
  FROM public.colorways c
  JOIN public.style_orders so ON so.id = c.order_id
  WHERE c.id = p_colorway_id AND c.order_id = p_order_id;

  IF v_floor_status IS NULL OR v_floor_status IN ('shipped_closed', 'reaudit_open') THEN
    RETURN;
  END IF;

  SELECT ors.dept_id
  INTO v_last_dept
  FROM public.order_routing_steps ors
  LEFT JOIN public.departments d ON d.id = ors.dept_id
  WHERE ors.order_id = p_order_id
    AND COALESCE(d.planning_mode, '') <> 'native_shipment'
    AND COALESCE(d.role, '') <> 'terminal'
    AND lower(COALESCE(d.name, '')) <> 'shipment'
    AND COALESCE(ors.capture_app, '') NOT IN (
      'shipment_qa', 'shipment_log', 'shipment_audit', 'final_rejection_log'
    )
  ORDER BY ors.seq DESC
  LIMIT 1;

  IF v_last_dept IS NULL THEN
    RETURN;
  END IF;

  v_cutting_dept := public.get_cutting_department_id(v_factory_id);

  IF v_cutting_dept IS NOT NULL THEN
    SELECT COALESCE(j.qty_produced, 0)
    INTO v_cut_qty
    FROM public.order_dept_progress_rows(v_factory_id, p_order_id) j
    WHERE j.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND j.dept_id = v_cutting_dept
    ORDER BY j.flow_step ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_cut_qty <= 0 THEN
    SELECT COALESCE(j.qty_produced, 0)
    INTO v_cut_qty
    FROM public.order_dept_progress_rows(v_factory_id, p_order_id) j
    WHERE j.colorway_id IS NOT DISTINCT FROM p_colorway_id
    ORDER BY j.flow_step ASC NULLS LAST
    LIMIT 1;
  END IF;

  SELECT COALESCE(j.qty_produced, 0)
  INTO v_last_ready
  FROM public.order_dept_progress_rows(v_factory_id, p_order_id) j
  WHERE j.colorway_id IS NOT DISTINCT FROM p_colorway_id
    AND j.dept_id = v_last_dept
  ORDER BY j.flow_step DESC NULLS LAST
  LIMIT 1;

  SELECT COALESCE(SUM(r.qty), 0)::integer
  INTO v_rejected_ledger
  FROM public.rejections r
  WHERE r.order_id = p_order_id
    AND r.colorway_id IS NOT DISTINCT FROM p_colorway_id;

  SELECT COALESCE(SUM(i.failed), 0)::integer
  INTO v_rejected_qc
  FROM public.inspection_sessions i
  WHERE i.order_id = p_order_id
    AND i.colorway_id IS NOT DISTINCT FROM p_colorway_id;

  v_rejected := v_rejected_ledger + v_rejected_qc;
  v_gap := GREATEST(v_cut_qty - v_last_ready, 0);

  IF v_cut_qty > 0
     AND v_last_ready > 0
     AND v_rejected >= v_gap THEN
    UPDATE public.colorways
    SET
      shipment_floor_status = 'ready_to_ship',
      ready_to_ship_at = COALESCE(ready_to_ship_at, now())
    WHERE id = p_colorway_id
      AND shipment_floor_status = 'active';
  ELSIF v_floor_status = 'ready_to_ship' AND v_rejected < v_gap THEN
    UPDATE public.colorways
    SET
      shipment_floor_status = 'active',
      ready_to_ship_at = NULL
    WHERE id = p_colorway_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_colorway_ready_to_ship_rpc(p_factory_id uuid, p_order_id uuid, p_colorway_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = p_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  PERFORM public.sync_colorway_ready_to_ship(p_order_id, p_colorway_id);

  SELECT shipment_floor_status INTO v_status
  FROM public.colorways
  WHERE id = p_colorway_id AND order_id = p_order_id;

  RETURN jsonb_build_object('status', COALESCE(v_status, 'active'));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_profile_to_auth_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'factory_id', NEW.factory_id::text,
         'user_role',  NEW.user_role
       )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.terminal_route_operation_id(p_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ors.id
  FROM public.order_routing_steps ors
  LEFT JOIN public.departments d ON d.id = ors.dept_id
  WHERE ors.order_id = p_order_id
  ORDER BY
    CASE WHEN COALESCE(d.role, 'standard') = 'terminal' THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(ors.is_primary_output, false) THEN 0 ELSE 1 END,
    ors.seq DESC
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.time_in_shift_bounds(p_t time without time zone, p_start time without time zone, p_end time without time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL THEN false
    WHEN p_start <= p_end THEN p_t >= p_start AND p_t < p_end
    ELSE p_t >= p_start OR p_t < p_end
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_assigned_resources_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.validate_assigned_resource_for_department(NEW.department_id, NEW.resource_type);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_colorway_ready_after_handover()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.colorway_id IS NOT NULL THEN
    PERFORM public.sync_colorway_ready_to_ship(NEW.order_id, NEW.colorway_id);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_sync_colorway_ready_generic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_colorway_id uuid;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  v_colorway_id := COALESCE(NEW.colorway_id, OLD.colorway_id);
  IF v_colorway_id IS NOT NULL AND v_order_id IS NOT NULL THEN
    PERFORM public.sync_colorway_ready_to_ship(v_order_id, v_colorway_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_order_routing_steps_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_assigned_resource_for_department(p_department_id uuid, p_resource_type text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text;
BEGIN
  IF p_department_id IS NULL THEN
    RAISE EXCEPTION 'department_id is required for assigned resources';
  END IF;

  SELECT d.planning_mode INTO v_mode
  FROM public.departments d
  WHERE d.id = p_department_id;

  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'Department not found';
  END IF;

  IF v_mode IN ('storage', 'native_shipment') THEN
    RAISE EXCEPTION 'Work center planning_mode % does not use assigned resources', v_mode;
  END IF;

  IF v_mode = 'outsource' AND COALESCE(p_resource_type, '') <> 'outsourced' THEN
    RAISE EXCEPTION 'Outsource work centers require resource_type = outsourced';
  END IF;

  IF v_mode IN ('production', 'native_cutting') AND COALESCE(p_resource_type, '') <> 'inhouse' THEN
    RAISE EXCEPTION 'Production work centers require resource_type = inhouse';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_floor_login_by_email(p_email text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE lower(trim(p.email)) = lower(trim(p_email))
    AND p.status = 'Active'
    AND p.user_role IN ('operator', 'supervisor', 'auditor', 'quality_manager')
  LIMIT 1;

  IF NOT FOUND OR v_profile.floor_pin IS NULL
     OR v_profile.floor_pin <> extensions.crypt(trim(p_pin), v_profile.floor_pin) THEN
    RETURN NULL;
  END IF;

  RETURN public.verify_floor_pin(v_profile.id, trim(p_pin))
         || jsonb_build_object('email', v_profile.email);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_floor_pin(p_user_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id AND status = 'Active';
  IF NOT FOUND OR v_profile.floor_pin IS NULL
     OR v_profile.floor_pin <> extensions.crypt(p_pin, v_profile.floor_pin) THEN
    RETURN NULL;
  END IF;

  IF v_profile.department_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'full_name', v_profile.full_name,
    'user_role', v_profile.user_role,
    'department_id', v_profile.department_id,
    'handover_enabled', COALESCE(v_profile.handover_enabled, false),
    'workforce_enabled', COALESCE(v_profile.workforce_enabled, false),
    'audit_enabled', COALESCE(v_profile.audit_enabled, false),
    'can_produce', COALESCE(v_profile.can_produce, false),
    'shipment_qa_enabled', COALESCE(v_profile.shipment_qa_enabled, false),
    'preferred_resource_ids', COALESCE(v_profile.preferred_resource_ids, '[]'::jsonb),
    'assigned_apps', public.floor_user_derived_apps(p_user_id),
    'assigned_operation_ids', public.floor_user_operation_ids_json(p_user_id),
    'can_log_workforce', public.floor_user_can_log_workforce(p_user_id),
    'factory_id', v_profile.factory_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.visit_primary_route_step_id(p_order_id uuid, p_visit_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ors.id
  FROM public.order_routing_steps ors
  WHERE ors.order_id = p_order_id
    AND ors.visit_id = p_visit_id
  ORDER BY
    CASE WHEN ors.is_primary_output THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(ors.step_type, 'produce') = 'produce' THEN 0 ELSE 1 END,
    ors.seq DESC,
    ors.id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.visit_route_step_id(p_order_id uuid, p_visit_id uuid, p_step_type text DEFAULT 'produce'::text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ors.id
  FROM public.order_routing_steps ors
  WHERE ors.order_id = p_order_id
    AND ors.visit_id = p_visit_id
    AND COALESCE(ors.step_type, 'produce') = COALESCE(p_step_type, 'produce')
  ORDER BY
    CASE WHEN COALESCE(ors.is_primary_output, false) THEN 0 ELSE 1 END,
    ors.seq DESC
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.void_outsource_work_movement(p_movement_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   uuid;
  v_row       public.outsource_work_movements%ROWTYPE;
  v_child_qty integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.outsource_work_movements
  WHERE id = p_movement_id AND voided_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found or already voided';
  END IF;

  IF v_row.factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;

  IF NOT public.is_factory_admin() AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.factory_id = v_row.factory_id
      AND p.status = 'Active'
      AND COALESCE(p.handover_enabled, false) = true
      AND p.department_id = v_row.department_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to void this movement';
  END IF;

  IF v_row.movement_type = 'vendor_send' THEN
    SELECT COALESCE(SUM(qty), 0) INTO v_child_qty
    FROM public.outsource_work_movements
    WHERE linked_send_id = v_row.id AND voided_at IS NULL;
    IF v_child_qty > 0 THEN
      RAISE EXCEPTION 'Cannot void send with active linked receives — void receives first';
    END IF;
  END IF;

  UPDATE public.outsource_work_movements
  SET voided_at = now(), voided_by = v_user_id, void_reason = NULLIF(trim(p_reason), '')
  WHERE id = p_movement_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.workforce_log_total_headcount(p_headcount jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(public.jsonb_sum_int_values(COALESCE(p_headcount, '{}'::jsonb)), 0)::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.workforce_logs_fill_from_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_la public.line_allocations%ROWTYPE;
BEGIN
  IF NEW.line_allocation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_la FROM public.line_allocations WHERE id = NEW.line_allocation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.factory_id := COALESCE(NEW.factory_id, v_la.factory_id);
  NEW.order_id := COALESCE(NEW.order_id, v_la.order_id);
  NEW.colorway_id := COALESCE(NEW.colorway_id, v_la.colorway_id);
  NEW.department_id := COALESCE(NEW.department_id, v_la.department_id);
  NEW.visit_id := COALESCE(NEW.visit_id, v_la.visit_id);
  NEW.resource_id := COALESCE(NEW.resource_id, v_la.line_id);

  IF NEW.order_route_id IS NULL AND v_la.order_id IS NOT NULL AND v_la.visit_id IS NOT NULL THEN
    NEW.order_route_id := public.visit_primary_route_step_id(v_la.order_id, v_la.visit_id);
  END IF;

  RETURN NEW;
END;
$function$
;

-- Deferred column defaults (depend on functions above)
ALTER TABLE ONLY public.batch_production ALTER COLUMN worker_count SET DEFAULT jsonb_sum_int_values(headcount_by_category);
ALTER TABLE ONLY public.batch_production ALTER COLUMN duration_mins SET DEFAULT round((EXTRACT(epoch FROM (end_time - start_time)) / 60.0), 2);
ALTER TABLE ONLY public.batch_production ALTER COLUMN available_mins SET DEFAULT round(((jsonb_sum_int_values(headcount_by_category))::numeric * (EXTRACT(epoch FROM (end_time - start_time)) / 60.0)), 2);
ALTER TABLE ONLY public.batch_production ALTER COLUMN efficiency_pct SET DEFAULT CASE
    WHEN (((jsonb_sum_int_values(headcount_by_category))::numeric * (EXTRACT(epoch FROM (end_time - start_time)) / 60.0)) > (0)::numeric) THEN round(((produced_mins / ((jsonb_sum_int_values(headcount_by_category))::numeric * (EXTRACT(epoch FROM (end_time - start_time)) / 60.0))) * (100)::numeric), 2)
    ELSE NULL::numeric
END;
ALTER TABLE ONLY public.cutting_lays ALTER COLUMN bundles_generated SET DEFAULT false;
ALTER TABLE ONLY public.dashboard_configs ALTER COLUMN access_token SET DEFAULT encode(gen_random_bytes(16), 'hex'::text);
ALTER TABLE ONLY public.dashboard_configs ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE ONLY public.dashboard_links ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE ONLY public.department_workforce_rates ALTER COLUMN is_current SET DEFAULT true;
ALTER TABLE ONLY public.departments ALTER COLUMN is_native SET DEFAULT false;
ALTER TABLE ONLY public.departments ALTER COLUMN transaction_enabled SET DEFAULT true;
ALTER TABLE ONLY public.departments ALTER COLUMN supervisor_enabled SET DEFAULT true;
ALTER TABLE ONLY public.fabric_components ALTER COLUMN is_primary SET DEFAULT false;
ALTER TABLE ONLY public.fabric_components ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE ONLY public.line_allocations ALTER COLUMN completed_is_true SET DEFAULT false;
ALTER TABLE ONLY public.operations ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE ONLY public.order_routing_steps ALTER COLUMN transaction_app SET DEFAULT true;
ALTER TABLE ONLY public.order_routing_steps ALTER COLUMN is_primary_output SET DEFAULT false;
ALTER TABLE ONLY public.order_routing_steps ALTER COLUMN is_dept_exit_operation SET DEFAULT false;
ALTER TABLE ONLY public.profiles ALTER COLUMN can_produce SET DEFAULT false;
ALTER TABLE ONLY public.profiles ALTER COLUMN handover_enabled SET DEFAULT false;
ALTER TABLE ONLY public.profiles ALTER COLUMN workforce_enabled SET DEFAULT false;
ALTER TABLE ONLY public.profiles ALTER COLUMN audit_enabled SET DEFAULT false;
ALTER TABLE ONLY public.profiles ALTER COLUMN shipment_qa_enabled SET DEFAULT false;

-- Views
CREATE OR REPLACE VIEW public.v_cut_to_ship_summary AS
 WITH cut AS (
         SELECT v_daily_production.factory_id,
            v_daily_production.order_id,
            v_daily_production.colorway_id,
            sum(v_daily_production.qty)::integer AS qty_cut
           FROM v_daily_production
          WHERE v_daily_production.capture_source = 'cutting'::text
          GROUP BY v_daily_production.factory_id, v_daily_production.order_id, v_daily_production.colorway_id
        ), shipped AS (
         SELECT shipments.factory_id,
            shipments.order_id,
            shipments.colorway_id,
            sum(shipments.shipped_qty)::integer AS qty_shipped
           FROM shipments
          WHERE COALESCE(shipments.shipped_qty, 0) > 0
          GROUP BY shipments.factory_id, shipments.order_id, shipments.colorway_id
        ), rejected AS (
         SELECT audit_sessions.factory_id,
            audit_sessions.order_id,
            audit_sessions.colorway_id,
            sum(audit_sessions.failed)::integer AS qty_rejected
           FROM audit_sessions
          WHERE audit_sessions.status = 'completed'::text AND COALESCE(audit_sessions.failed, 0) > 0
          GROUP BY audit_sessions.factory_id, audit_sessions.order_id, audit_sessions.colorway_id
        )
 SELECT COALESCE(c.factory_id, s.factory_id, r.factory_id) AS factory_id,
    COALESCE(c.order_id, s.order_id, r.order_id) AS order_id,
    COALESCE(c.colorway_id, s.colorway_id, r.colorway_id) AS colorway_id,
    COALESCE(c.qty_cut, 0) AS qty_cut,
    COALESCE(s.qty_shipped, 0) AS qty_shipped,
    COALESCE(r.qty_rejected, 0) AS qty_rejected,
    GREATEST(COALESCE(c.qty_cut, 0) - COALESCE(s.qty_shipped, 0) - COALESCE(r.qty_rejected, 0), 0) AS qty_balance
   FROM cut c
     FULL JOIN shipped s ON s.factory_id = c.factory_id AND s.order_id = c.order_id AND NOT s.colorway_id IS DISTINCT FROM c.colorway_id
     FULL JOIN rejected r ON r.factory_id = COALESCE(c.factory_id, s.factory_id) AND r.order_id = COALESCE(c.order_id, s.order_id) AND NOT r.colorway_id IS DISTINCT FROM COALESCE(c.colorway_id, s.colorway_id);;

CREATE OR REPLACE VIEW public.v_cutting_component_progress AS
 SELECT factory_id,
    order_id,
    colorway_id,
    operation_id,
    visit_id,
    fabric_component_id,
    fabric_code,
    fabric_type,
    is_primary,
    qty,
    qty_by_size
   FROM cutting_component_progress_rows(NULL::uuid, NULL::uuid) cutting_component_progress_rows(factory_id, order_id, colorway_id, operation_id, visit_id, fabric_component_id, fabric_code, fabric_type, is_primary, qty, qty_by_size);;

CREATE OR REPLACE VIEW public.v_daily_audit AS
 SELECT a.factory_id,
    a.order_id,
    a.colorway_id,
    a.department_id,
    d.name AS department_name,
    a.line_allocation_id AS resource_allocation_id,
    a.resource_id,
    ar.resource_name,
    a.order_route_id AS operation_id,
    ors.operation_name,
    ors.step_type,
    a.shift_id,
    sm.shift_name,
    COALESCE(a.completed_at, a.logged_at)::date AS log_date,
    count(*)::integer AS lots,
    sum(
        CASE
            WHEN a.result = 'pass'::text THEN 1
            ELSE 0
        END)::integer AS lots_passed,
    sum(
        CASE
            WHEN a.result = 'fail'::text THEN 1
            ELSE 0
        END)::integer AS lots_failed,
    sum(COALESCE(a.sample_size, 0))::integer AS samples_inspected,
    sum(COALESCE(a.passed, 0))::integer AS passed,
    sum(COALESCE(a.failed, 0))::integer AS failed,
    sum(COALESCE(a.major_failed, 0))::integer AS major_failed,
    sum(COALESCE(a.minor_failed, 0))::integer AS minor_failed,
    (array_agg(a.aql_level ORDER BY a.logged_at DESC))[1] AS aql_level,
        CASE
            WHEN count(*) = 0 THEN NULL::numeric
            ELSE round(100.0 * sum(
            CASE
                WHEN a.result = 'pass'::text THEN 1
                ELSE 0
            END)::numeric / count(*)::numeric, 2)
        END AS lots_pass_pct,
        CASE
            WHEN sum(COALESCE(a.sample_size, 0)) = 0 THEN NULL::numeric
            ELSE round(100.0 * sum(COALESCE(a.failed, 0))::numeric / sum(COALESCE(a.sample_size, 0))::numeric, 2)
        END AS defective_pct
   FROM audit_sessions a
     LEFT JOIN order_routing_steps ors ON ors.id = a.order_route_id
     LEFT JOIN departments d ON d.id = a.department_id
     LEFT JOIN assigned_resources ar ON ar.id = a.resource_id
     LEFT JOIN v_shift_minutes sm ON sm.shift_id = a.shift_id
  WHERE a.status = 'completed'::text
  GROUP BY a.factory_id, a.order_id, a.colorway_id, a.department_id, d.name, a.line_allocation_id, a.resource_id, ar.resource_name, a.order_route_id, ors.operation_name, ors.step_type, a.shift_id, sm.shift_name, (COALESCE(a.completed_at, a.logged_at)::date);;

CREATE OR REPLACE VIEW public.v_daily_production AS
 WITH hourly AS (
         SELECT h.factory_id,
            h.order_id,
            h.colorway_id,
            h.department_id,
            d.name AS department_name,
            h.line_allocation_id AS resource_allocation_id,
            h.resource_id,
            ar.resource_name,
            h.order_route_id AS operation_id,
            ors.operation_name,
            ors.step_type,
            COALESCE(h.shift_id, get_shift_for_hour_slot(h.factory_id, h.hour_slot)) AS shift_id,
            sm.shift_name,
            h.log_date,
            'hourly'::text AS capture_source,
            NULL::uuid AS fabric_component_id,
            sum(h.count)::integer AS qty,
            round(sum(COALESCE(h.produced_mins, h.count::numeric * COALESCE(h.sam, 0::numeric))), 2) AS produced_mins
           FROM hourly_counts h
             JOIN order_routing_steps ors ON ors.id = h.order_route_id
             LEFT JOIN departments d ON d.id = h.department_id
             LEFT JOIN assigned_resources ar ON ar.id = h.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = COALESCE(h.shift_id, get_shift_for_hour_slot(h.factory_id, h.hour_slot))
          GROUP BY h.factory_id, h.order_id, h.colorway_id, h.department_id, d.name, h.line_allocation_id, h.resource_id, ar.resource_name, h.order_route_id, ors.operation_name, ors.step_type, (COALESCE(h.shift_id, get_shift_for_hour_slot(h.factory_id, h.hour_slot))), sm.shift_name, h.log_date
        ), qc AS (
         SELECT s.factory_id,
            s.order_id,
            s.colorway_id,
            s.department_id,
            d.name AS department_name,
            s.line_allocation_id AS resource_allocation_id,
            s.resource_id,
            ar.resource_name,
            s.order_route_id AS operation_id,
            ors.operation_name,
            ors.step_type,
            s.shift_id,
            sm.shift_name,
            s.log_date,
            'qc'::text AS capture_source,
            NULL::uuid AS fabric_component_id,
            sum(COALESCE(s.passed, 0) + COALESCE(s.rework_passed, 0))::integer AS qty,
            round(sum(COALESCE(s.produced_mins, (COALESCE(s.passed, 0) + COALESCE(s.rework_passed, 0))::numeric * COALESCE(s.sam, 0::numeric))), 2) AS produced_mins
           FROM inspection_sessions s
             LEFT JOIN order_routing_steps ors ON ors.id = s.order_route_id
             LEFT JOIN departments d ON d.id = s.department_id
             LEFT JOIN assigned_resources ar ON ar.id = s.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = s.shift_id
          GROUP BY s.factory_id, s.order_id, s.colorway_id, s.department_id, d.name, s.line_allocation_id, s.resource_id, ar.resource_name, s.order_route_id, ors.operation_name, ors.step_type, s.shift_id, sm.shift_name, s.log_date
        ), batch AS (
         SELECT bp.factory_id,
            bp.order_id,
            bp.colorway_id,
            bp.department_id,
            d.name AS department_name,
            bp.line_allocation_id AS resource_allocation_id,
            bp.resource_id,
            ar.resource_name,
            bp.order_route_id AS operation_id,
            ors.operation_name,
            ors.step_type,
            bp.shift_id,
            sm.shift_name,
            bp.log_date,
            'batch'::text AS capture_source,
            NULL::uuid AS fabric_component_id,
            sum(bp.produced_qty)::integer AS qty,
            sum(COALESCE(bp.produced_mins, 0::numeric)) AS produced_mins
           FROM batch_production bp
             LEFT JOIN order_routing_steps ors ON ors.id = bp.order_route_id
             LEFT JOIN departments d ON d.id = bp.department_id
             LEFT JOIN assigned_resources ar ON ar.id = bp.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = bp.shift_id
          GROUP BY bp.factory_id, bp.order_id, bp.colorway_id, bp.department_id, d.name, bp.line_allocation_id, bp.resource_id, ar.resource_name, bp.order_route_id, ors.operation_name, ors.step_type, bp.shift_id, sm.shift_name, bp.log_date
        ), cutting_raw AS (
         SELECT cs.id AS session_id,
            cs.factory_id,
            cs.order_id,
            cs.colorway_id,
            cs.department_id,
            cs.line_allocation_id,
            cs.resource_id,
            cs.order_route_id,
            cs.shift_id,
            cs.log_date,
            cs.produced_mins AS session_produced_mins,
            comp.fabric_component_id,
            comp.qty
           FROM cutting_sessions cs
             JOIN ( SELECT cb.session_id,
                    cb.fabric_component_id,
                    sum(cb.qty) AS qty
                   FROM cutting_bundles cb
                  GROUP BY cb.session_id, cb.fabric_component_id) comp ON comp.session_id = cs.id
        ), cutting AS (
         SELECT cr.factory_id,
            cr.order_id,
            cr.colorway_id,
            cr.department_id,
            d.name AS department_name,
            cr.line_allocation_id AS resource_allocation_id,
            cr.resource_id,
            ar.resource_name,
            cr.order_route_id AS operation_id,
            ors.operation_name,
            ors.step_type,
            cr.shift_id,
            sm.shift_name,
            cr.log_date,
            'cutting'::text AS capture_source,
            cr.fabric_component_id,
            cr.qty::integer AS qty,
                CASE
                    WHEN row_number() OVER (PARTITION BY cr.session_id ORDER BY cr.fabric_component_id) = 1 THEN cr.session_produced_mins
                    ELSE NULL::numeric
                END AS produced_mins
           FROM cutting_raw cr
             LEFT JOIN order_routing_steps ors ON ors.id = cr.order_route_id
             LEFT JOIN departments d ON d.id = cr.department_id
             LEFT JOIN assigned_resources ar ON ar.id = cr.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = cr.shift_id
        )
 SELECT hourly.factory_id,
    hourly.order_id,
    hourly.colorway_id,
    hourly.department_id,
    hourly.department_name,
    hourly.resource_allocation_id,
    hourly.resource_id,
    hourly.resource_name,
    hourly.operation_id,
    hourly.operation_name,
    hourly.step_type,
    hourly.shift_id,
    hourly.shift_name,
    hourly.log_date,
    hourly.capture_source,
    hourly.fabric_component_id,
    hourly.qty,
    hourly.produced_mins
   FROM hourly
UNION ALL
 SELECT qc.factory_id,
    qc.order_id,
    qc.colorway_id,
    qc.department_id,
    qc.department_name,
    qc.resource_allocation_id,
    qc.resource_id,
    qc.resource_name,
    qc.operation_id,
    qc.operation_name,
    qc.step_type,
    qc.shift_id,
    qc.shift_name,
    qc.log_date,
    qc.capture_source,
    qc.fabric_component_id,
    qc.qty,
    qc.produced_mins
   FROM qc
UNION ALL
 SELECT batch.factory_id,
    batch.order_id,
    batch.colorway_id,
    batch.department_id,
    batch.department_name,
    batch.resource_allocation_id,
    batch.resource_id,
    batch.resource_name,
    batch.operation_id,
    batch.operation_name,
    batch.step_type,
    batch.shift_id,
    batch.shift_name,
    batch.log_date,
    batch.capture_source,
    batch.fabric_component_id,
    batch.qty,
    batch.produced_mins
   FROM batch
UNION ALL
 SELECT cutting.factory_id,
    cutting.order_id,
    cutting.colorway_id,
    cutting.department_id,
    cutting.department_name,
    cutting.resource_allocation_id,
    cutting.resource_id,
    cutting.resource_name,
    cutting.operation_id,
    cutting.operation_name,
    cutting.step_type,
    cutting.shift_id,
    cutting.shift_name,
    cutting.log_date,
    cutting.capture_source,
    cutting.fabric_component_id,
    cutting.qty,
    cutting.produced_mins
   FROM cutting;;

CREATE OR REPLACE VIEW public.v_daily_quality AS
 WITH session_rows AS (
         SELECT s.factory_id,
            s.order_id,
            s.colorway_id,
            s.department_id,
            s.line_allocation_id AS resource_allocation_id,
            s.resource_id,
            s.order_route_id AS operation_id,
            s.shift_id,
            s.log_date,
            COALESCE(s.total_inspected, 0) AS inspected,
            COALESCE(s.first_time_pass, 0) AS first_time_pass,
            COALESCE(s.rework_passed, 0) AS rework_pass,
            COALESCE(s.failed, 0) AS failed,
            COALESCE(s.defect_summary, '{}'::jsonb) AS defect_summary
           FROM inspection_sessions s
             LEFT JOIN order_routing_steps ors_1 ON ors_1.id = s.order_route_id
          WHERE s.shift_id IS NOT NULL AND COALESCE(ors_1.capture_app,
                CASE
                    WHEN ors_1.step_type = 'loading'::text THEN 'hourly'::text
                    WHEN ors_1.step_type = 'outsource'::text THEN 'outsource'::text
                    ELSE 'transaction'::text
                END) = 'qc_log'::text
        ), agg AS (
         SELECT session_rows.factory_id,
            session_rows.order_id,
            session_rows.colorway_id,
            session_rows.department_id,
            session_rows.resource_allocation_id,
            session_rows.resource_id,
            session_rows.operation_id,
            session_rows.shift_id,
            session_rows.log_date,
            sum(session_rows.inspected)::integer AS inspected,
            sum(session_rows.first_time_pass)::integer AS first_time_pass,
            sum(session_rows.rework_pass)::integer AS rework_pass,
            sum(session_rows.first_time_pass + session_rows.rework_pass)::integer AS total_pass,
            sum(session_rows.failed)::integer AS failed,
            sum(( SELECT COALESCE(sum(d_1.v::integer), 0::bigint) AS "coalesce"
                   FROM jsonb_each_text(session_rows.defect_summary) d_1(k, v)))::integer AS total_defects,
            array_agg(session_rows.defect_summary) AS defect_summaries
           FROM session_rows
          GROUP BY session_rows.factory_id, session_rows.order_id, session_rows.colorway_id, session_rows.department_id, session_rows.resource_allocation_id, session_rows.resource_id, session_rows.operation_id, session_rows.shift_id, session_rows.log_date
        )
 SELECT a.factory_id,
    a.order_id,
    a.colorway_id,
    a.department_id,
    d.name AS department_name,
    a.resource_allocation_id,
    a.resource_id,
    ar.resource_name,
    a.operation_id,
    ors.operation_name,
    ors.step_type,
    a.shift_id,
    sm.shift_name,
    a.log_date,
    a.inspected,
    a.first_time_pass,
    a.rework_pass,
    a.total_pass,
    a.failed,
        CASE
            WHEN a.inspected = 0 THEN NULL::numeric
            ELSE round(100.0 * a.total_defects::numeric / a.inspected::numeric, 2)
        END AS dhu,
        CASE
            WHEN a.inspected = 0 THEN NULL::numeric
            ELSE round(100.0 * a.failed::numeric / a.inspected::numeric, 2)
        END AS defective_pct,
        CASE
            WHEN a.inspected = 0 THEN NULL::numeric
            ELSE round(100.0 * a.first_time_pass::numeric / a.inspected::numeric, 2)
        END AS ftr_pct,
    aggregate_top_defects(a.defect_summaries, 7) AS top_defects
   FROM agg a
     LEFT JOIN order_routing_steps ors ON ors.id = a.operation_id
     LEFT JOIN departments d ON d.id = a.department_id
     LEFT JOIN assigned_resources ar ON ar.id = a.resource_id
     LEFT JOIN v_shift_minutes sm ON sm.shift_id = a.shift_id;;

CREATE OR REPLACE VIEW public.v_daily_target AS
 WITH alloc_rows AS (
         SELECT la.factory_id,
            la.order_id,
            la.colorway_id,
            la.department_id,
            la.visit_id,
            visit_primary_route_step_id(la.order_id, la.visit_id) AS operation_id,
            la.start_date,
            la.end_date,
            COALESCE(NULLIF(la.daily_target, 0), NULLIF(la.qty, 0), 0) AS effective_target
           FROM line_allocations la
          WHERE la.start_date IS NOT NULL AND la.end_date IS NOT NULL AND la.department_id IS NOT NULL AND la.visit_id IS NOT NULL
        )
 SELECT alloc_rows.factory_id,
    alloc_rows.order_id,
    alloc_rows.colorway_id,
    alloc_rows.department_id,
    alloc_rows.operation_id,
    d.log_date,
    sum(alloc_rows.effective_target)::integer AS daily_target
   FROM alloc_rows
     CROSS JOIN LATERAL ( SELECT generate_series(alloc_rows.start_date::timestamp with time zone, alloc_rows.end_date::timestamp with time zone, '1 day'::interval)::date AS log_date) d
  GROUP BY alloc_rows.factory_id, alloc_rows.order_id, alloc_rows.colorway_id, alloc_rows.department_id, alloc_rows.operation_id, d.log_date;;

CREATE OR REPLACE VIEW public.v_day_floor_board AS
 WITH produced AS (
         SELECT v_daily_production.factory_id,
            v_daily_production.department_id,
            v_daily_production.order_id,
            v_daily_production.colorway_id,
            v_daily_production.log_date,
            sum(v_daily_production.qty)::integer AS produced
           FROM v_daily_production
          WHERE v_daily_production.step_type = 'produce'::text OR (v_daily_production.capture_source = ANY (ARRAY['batch'::text, 'cutting'::text]))
          GROUP BY v_daily_production.factory_id, v_daily_production.department_id, v_daily_production.order_id, v_daily_production.colorway_id, v_daily_production.log_date
        ), sent AS (
         SELECT hs.factory_id,
            rd.dept_id AS department_id,
            hs.order_id,
            hs.colorway_id,
            (hs.sent_at AT TIME ZONE 'UTC'::text)::date AS log_date,
            sum(hs.sent_qty)::integer AS sent
           FROM handover_slips hs
             JOIN LATERAL ( SELECT ors.dept_id
                   FROM order_routing_steps ors
                  WHERE ors.id = visit_primary_route_step_id(hs.order_id, hs.from_visit_id)) rd ON true
          WHERE hs.sent_at IS NOT NULL
          GROUP BY hs.factory_id, rd.dept_id, hs.order_id, hs.colorway_id, ((hs.sent_at AT TIME ZONE 'UTC'::text)::date)
        ), received AS (
         SELECT hs.factory_id,
            rd.dept_id AS department_id,
            hs.order_id,
            hs.colorway_id,
            COALESCE((hs.received_at AT TIME ZONE 'UTC'::text)::date, (hs.sent_at AT TIME ZONE 'UTC'::text)::date) AS log_date,
            sum(COALESCE(hs.received_qty, hs.sent_qty, 0))::integer AS received
           FROM handover_slips hs
             JOIN LATERAL ( SELECT ors.dept_id
                   FROM order_routing_steps ors
                  WHERE ors.id = visit_primary_route_step_id(hs.order_id, hs.to_visit_id)) rd ON true
          WHERE hs.received_at IS NOT NULL OR hs.sent_at IS NOT NULL
          GROUP BY hs.factory_id, rd.dept_id, hs.order_id, hs.colorway_id, (COALESCE((hs.received_at AT TIME ZONE 'UTC'::text)::date, (hs.sent_at AT TIME ZONE 'UTC'::text)::date))
        ), keys AS (
         SELECT produced.factory_id,
            produced.department_id,
            produced.order_id,
            produced.colorway_id,
            produced.log_date
           FROM produced
        UNION
         SELECT sent.factory_id,
            sent.department_id,
            sent.order_id,
            sent.colorway_id,
            sent.log_date
           FROM sent
        UNION
         SELECT received.factory_id,
            received.department_id,
            received.order_id,
            received.colorway_id,
            received.log_date
           FROM received
        )
 SELECT k.factory_id,
    k.department_id,
    k.order_id,
    k.colorway_id,
    k.log_date,
    COALESCE(r.received, 0) AS received,
    COALESCE(p.produced, 0) AS produced,
    COALESCE(s.sent, 0) AS sent
   FROM keys k
     LEFT JOIN produced p ON p.factory_id = k.factory_id AND p.department_id = k.department_id AND p.order_id = k.order_id AND NOT p.colorway_id IS DISTINCT FROM k.colorway_id AND p.log_date = k.log_date
     LEFT JOIN sent s ON s.factory_id = k.factory_id AND s.department_id = k.department_id AND s.order_id = k.order_id AND NOT s.colorway_id IS DISTINCT FROM k.colorway_id AND s.log_date = k.log_date
     LEFT JOIN received r ON r.factory_id = k.factory_id AND r.department_id = k.department_id AND r.order_id = k.order_id AND NOT r.colorway_id IS DISTINCT FROM k.colorway_id AND r.log_date = k.log_date;;

CREATE OR REPLACE VIEW public.v_department_kpis_by_shift AS
 WITH output_by_key AS (
         SELECT v_daily_production.factory_id,
            v_daily_production.resource_allocation_id,
            v_daily_production.order_id,
            v_daily_production.colorway_id,
            v_daily_production.department_id,
            v_daily_production.operation_id,
            v_daily_production.shift_id,
            v_daily_production.log_date,
            sum(v_daily_production.qty)::integer AS output_qty,
            sum(v_daily_production.produced_mins) AS produced_mins
           FROM v_daily_production
          WHERE (v_daily_production.step_type = ANY (ARRAY['produce'::text, 'loading'::text])) OR (v_daily_production.capture_source = ANY (ARRAY['batch'::text, 'cutting'::text]))
          GROUP BY v_daily_production.factory_id, v_daily_production.resource_allocation_id, v_daily_production.order_id, v_daily_production.colorway_id, v_daily_production.department_id, v_daily_production.operation_id, v_daily_production.shift_id, v_daily_production.log_date
        ), avail_by_key AS (
         SELECT v_shift_workforce_summary.factory_id,
            v_shift_workforce_summary.resource_allocation_id,
            v_shift_workforce_summary.order_id,
            v_shift_workforce_summary.colorway_id,
            v_shift_workforce_summary.department_id,
            v_shift_workforce_summary.shift_id,
            v_shift_workforce_summary.log_date,
            sum(v_shift_workforce_summary.headcount)::integer AS headcount,
            sum(v_shift_workforce_summary.available_mins)::integer AS available_mins
           FROM v_shift_workforce_summary
          GROUP BY v_shift_workforce_summary.factory_id, v_shift_workforce_summary.resource_allocation_id, v_shift_workforce_summary.order_id, v_shift_workforce_summary.colorway_id, v_shift_workforce_summary.department_id, v_shift_workforce_summary.shift_id, v_shift_workforce_summary.log_date
        ), merged AS (
         SELECT COALESCE(o.factory_id, a.factory_id) AS factory_id,
            COALESCE(o.order_id, a.order_id) AS order_id,
            COALESCE(o.department_id, a.department_id) AS department_id,
            o.operation_id,
            COALESCE(o.shift_id, a.shift_id) AS shift_id,
            COALESCE(o.log_date, a.log_date) AS log_date,
            COALESCE(o.output_qty, 0) AS output_qty,
            COALESCE(o.produced_mins, 0::numeric) AS produced_mins,
            COALESCE(a.headcount, 0) AS headcount,
            COALESCE(a.available_mins, 0) AS available_mins
           FROM output_by_key o
             FULL JOIN avail_by_key a ON NOT a.resource_allocation_id IS DISTINCT FROM o.resource_allocation_id AND NOT a.shift_id IS DISTINCT FROM o.shift_id AND a.log_date = o.log_date
        )
 SELECT m.factory_id,
    m.order_id,
    m.department_id,
    m.operation_id,
    m.log_date,
    m.shift_id,
    COALESCE(sm.shift_name, 'No shift'::text) AS shift_name,
    COALESCE(dt.daily_target, 0) AS daily_target,
    m.output_qty AS shift_output,
    m.produced_mins AS shift_produced_mins,
    m.headcount AS shift_headcount,
    m.available_mins AS shift_available_mins,
    m.headcount > 0 AS has_workforce,
    m.output_qty > 0 AS has_output,
        CASE
            WHEN m.headcount = 0 AND m.output_qty = 0 THEN 'none'::text
            WHEN m.headcount > 0 AND m.output_qty > 0 THEN 'complete'::text
            WHEN m.headcount > 0 THEN 'workforce_only'::text
            ELSE 'output_only'::text
        END AS data_completeness,
        CASE
            WHEN m.available_mins > 0 THEN round(100.0 * m.produced_mins / m.available_mins::numeric, 2)
            ELSE NULL::numeric
        END AS shift_efficiency_pct,
        CASE
            WHEN m.headcount > 0 THEN round(m.output_qty::numeric / m.headcount::numeric, 2)
            ELSE NULL::numeric
        END AS shift_productivity,
    NULL::numeric AS dhu,
    NULL::numeric AS defective_pct
   FROM merged m
     LEFT JOIN v_shift_minutes sm ON sm.shift_id = m.shift_id
     LEFT JOIN ( SELECT v_daily_target.factory_id,
            v_daily_target.order_id,
            v_daily_target.department_id,
            v_daily_target.operation_id,
            v_daily_target.log_date,
            sum(v_daily_target.daily_target)::integer AS daily_target
           FROM v_daily_target
          GROUP BY v_daily_target.factory_id, v_daily_target.order_id, v_daily_target.department_id, v_daily_target.operation_id, v_daily_target.log_date) dt ON dt.factory_id = m.factory_id AND dt.order_id = m.order_id AND dt.department_id = m.department_id AND NOT dt.operation_id IS DISTINCT FROM m.operation_id AND dt.log_date = m.log_date;;

CREATE OR REPLACE VIEW public.v_department_progress AS
 SELECT factory_id,
    order_id,
    colorway_id,
    visit_id,
    dept_id,
    dept_name,
    flow_step,
    is_in_flow,
    qty_received,
    qty_produced,
    qty_sent,
    qty_rejected,
    wip_qty,
    wip_qty_by_size,
    qty_received_by_size,
    qty_produced_by_size,
    qty_sent_by_size,
    qty_rejected_by_size,
    status,
    planned_qty,
    remaining_qty,
    available_to_send
   FROM order_dept_progress_rows(NULL::uuid, NULL::uuid) order_dept_progress_rows(factory_id, order_id, colorway_id, visit_id, dept_id, dept_name, flow_step, is_in_flow, qty_received, qty_produced, qty_sent, qty_rejected, wip_qty, wip_qty_by_size, qty_received_by_size, qty_produced_by_size, qty_sent_by_size, qty_rejected_by_size, qty_in_transit, qty_missing_in_transit, status, planned_qty, remaining_qty, available_to_send);;

CREATE OR REPLACE VIEW public.v_operation_progress AS
 SELECT factory_id,
    order_id,
    colorway_id,
    operation_id,
    visit_id,
    dept_id,
    dept_name,
    capture_app,
    step_type,
    dept_role,
    is_primary_output,
    route_seq,
    qty_produced,
    qty_produced_by_size
   FROM operation_progress_rows(NULL::uuid, NULL::uuid) operation_progress_rows(factory_id, order_id, colorway_id, operation_id, visit_id, dept_id, dept_name, capture_app, step_type, dept_role, is_primary_output, route_seq, qty_produced, qty_produced_by_size);;

CREATE OR REPLACE VIEW public.v_order_journey_by_resource AS
 SELECT factory_id,
    order_id,
    colorway_id,
    visit_id,
    department_id,
    department_name,
    resource_allocation_id,
    resource_id,
    resource_name,
    resource_type,
    operation_id,
    operation_name,
    resource_visit_status,
    qty_received,
    qty_produced,
    produced_mins,
    qty_sent,
    vendor_resource_id,
    vendor_name,
    vendor_sent_qty,
    vendor_received_qty,
    vendor_balance_qty,
    fabric_component_breakdown,
    sent_qty_by_resource,
    loading_operation_id,
    loading_operation_name,
    loading_qty_produced,
    loading_qty_produced_by_size
   FROM order_journey_by_resource_rows(NULL::uuid, NULL::uuid) order_journey_by_resource_rows(factory_id, order_id, colorway_id, visit_id, department_id, department_name, resource_allocation_id, resource_id, resource_name, resource_type, operation_id, operation_name, resource_visit_status, qty_received, qty_produced, produced_mins, qty_sent, vendor_resource_id, vendor_name, vendor_sent_qty, vendor_received_qty, vendor_balance_qty, fabric_component_breakdown, sent_qty_by_resource, loading_operation_id, loading_operation_name, loading_qty_produced, loading_qty_produced_by_size);;

CREATE OR REPLACE VIEW public.v_order_rejected_qty_by_size AS
 SELECT factory_id,
    order_id,
    colorway_id,
    COALESCE(size, 'UNSPEC'::text) AS size,
    sum(qty)::integer AS rejected_qty,
    order_route_id AS operation_id
   FROM rejections r
  GROUP BY factory_id, order_id, colorway_id, (COALESCE(size, 'UNSPEC'::text)), order_route_id;;

CREATE OR REPLACE VIEW public.v_outsource_summary AS
 SELECT owm.factory_id,
    owm.order_id,
    owm.colorway_id,
    owm.department_id,
    d.name AS department_name,
    owm.line_allocation_id AS resource_allocation_id,
    owm.vendor_resource_id AS resource_id,
    ar.resource_name,
    owm.order_route_id AS operation_id,
    ors.operation_name,
    ors.step_type,
    owm.visit_id,
    sum(owm.qty) FILTER (WHERE owm.movement_type = 'vendor_send'::text)::integer AS sent_qty,
    sum(owm.qty) FILTER (WHERE owm.movement_type = 'vendor_receive'::text)::integer AS received_qty,
    (COALESCE(sum(owm.qty) FILTER (WHERE owm.movement_type = 'vendor_send'::text), 0::bigint) - COALESCE(sum(owm.qty) FILTER (WHERE owm.movement_type = 'vendor_receive'::text), 0::bigint))::integer AS balance_qty,
    la.qty AS planned_qty
   FROM outsource_work_movements owm
     LEFT JOIN order_routing_steps ors ON ors.id = owm.order_route_id
     LEFT JOIN departments d ON d.id = owm.department_id
     LEFT JOIN assigned_resources ar ON ar.id = owm.vendor_resource_id
     LEFT JOIN line_allocations la ON la.id = owm.line_allocation_id
  WHERE owm.voided_at IS NULL
  GROUP BY owm.factory_id, owm.order_id, owm.colorway_id, owm.department_id, d.name, owm.line_allocation_id, owm.vendor_resource_id, ar.resource_name, owm.order_route_id, ors.operation_name, ors.step_type, owm.visit_id, la.qty;;

CREATE OR REPLACE VIEW public.v_shift_minutes AS
 SELECT id AS shift_id,
    factory_id,
    name AS shift_name,
    type AS shift_type,
    productive_mins
   FROM shifts s;;

CREATE OR REPLACE VIEW public.v_shift_workforce_summary AS
 WITH line_based AS (
         SELECT wl.factory_id,
            wl.order_id,
            wl.colorway_id,
            wl.department_id,
            d.name AS department_name,
            wl.line_allocation_id AS resource_allocation_id,
            wl.resource_id,
            ar.resource_name,
            wl.shift_id,
            sm.shift_name,
            wl.log_date,
            'line'::text AS capture_source,
            jsonb_sum_int_values(COALESCE(wl.headcount_by_category, '{}'::jsonb)) AS headcount,
            (jsonb_sum_int_values(COALESCE(wl.headcount_by_category, '{}'::jsonb))::numeric * COALESCE(sm.productive_mins, 0::numeric))::integer AS available_mins
           FROM workforce_logs wl
             LEFT JOIN departments d ON d.id = wl.department_id
             LEFT JOIN assigned_resources ar ON ar.id = wl.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = wl.shift_id
          WHERE wl.shift_id IS NOT NULL
        ), batch_based AS (
         SELECT bp.factory_id,
            bp.order_id,
            bp.colorway_id,
            bp.department_id,
            d.name AS department_name,
            bp.line_allocation_id AS resource_allocation_id,
            bp.resource_id,
            ar.resource_name,
            bp.shift_id,
            sm.shift_name,
            bp.log_date,
            'batch'::text AS capture_source,
            bp.worker_count AS headcount,
            bp.available_mins
           FROM batch_production bp
             LEFT JOIN departments d ON d.id = bp.department_id
             LEFT JOIN assigned_resources ar ON ar.id = bp.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = bp.shift_id
        ), cutting_based AS (
         SELECT cs.factory_id,
            cs.order_id,
            cs.colorway_id,
            cs.department_id,
            d.name AS department_name,
            cs.line_allocation_id AS resource_allocation_id,
            cs.resource_id,
            ar.resource_name,
            cs.shift_id,
            sm.shift_name,
            cs.log_date,
            'cutting'::text AS capture_source,
            cs.total_headcount AS headcount,
            cs.available_mins
           FROM cutting_sessions cs
             LEFT JOIN departments d ON d.id = cs.department_id
             LEFT JOIN assigned_resources ar ON ar.id = cs.resource_id
             LEFT JOIN v_shift_minutes sm ON sm.shift_id = cs.shift_id
        )
 SELECT line_based.factory_id,
    line_based.order_id,
    line_based.colorway_id,
    line_based.department_id,
    line_based.department_name,
    line_based.resource_allocation_id,
    line_based.resource_id,
    line_based.resource_name,
    line_based.shift_id,
    line_based.shift_name,
    line_based.log_date,
    line_based.capture_source,
    line_based.headcount,
    line_based.available_mins
   FROM line_based
UNION ALL
 SELECT batch_based.factory_id,
    batch_based.order_id,
    batch_based.colorway_id,
    batch_based.department_id,
    batch_based.department_name,
    batch_based.resource_allocation_id,
    batch_based.resource_id,
    batch_based.resource_name,
    batch_based.shift_id,
    batch_based.shift_name,
    batch_based.log_date,
    batch_based.capture_source,
    batch_based.headcount,
    batch_based.available_mins
   FROM batch_based
UNION ALL
 SELECT cutting_based.factory_id,
    cutting_based.order_id,
    cutting_based.colorway_id,
    cutting_based.department_id,
    cutting_based.department_name,
    cutting_based.resource_allocation_id,
    cutting_based.resource_id,
    cutting_based.resource_name,
    cutting_based.shift_id,
    cutting_based.shift_name,
    cutting_based.log_date,
    cutting_based.capture_source,
    cutting_based.headcount,
    cutting_based.available_mins
   FROM cutting_based;;

-- RLS policies
-- policy app_configuration_all on app_configuration (ALL)
CREATE POLICY "app_configuration_all" ON public.app_configuration
  FOR ALL TO authenticated USING ((factory_id = current_factory_id()));

-- policy assigned_resources_delete on assigned_resources (DELETE)
CREATE POLICY "assigned_resources_delete" ON public.assigned_resources
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy assigned_resources_insert on assigned_resources (INSERT)
CREATE POLICY "assigned_resources_insert" ON public.assigned_resources
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy assigned_resources_select on assigned_resources (SELECT)
CREATE POLICY "assigned_resources_select" ON public.assigned_resources
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy assigned_resources_update on assigned_resources (UPDATE)
CREATE POLICY "assigned_resources_update" ON public.assigned_resources
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy audit_sessions_factory_read on audit_sessions (SELECT)
CREATE POLICY "audit_sessions_factory_read" ON public.audit_sessions
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy audit_sessions_factory_write on audit_sessions (ALL)
CREATE POLICY "audit_sessions_factory_write" ON public.audit_sessions
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy batch_production_all on batch_production (ALL)
CREATE POLICY "batch_production_all" ON public.batch_production
  FOR ALL TO authenticated USING ((factory_id = current_factory_id()));

-- policy batch_production_factory_read on batch_production (SELECT)
CREATE POLICY "batch_production_factory_read" ON public.batch_production
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy batch_production_factory_write on batch_production (ALL)
CREATE POLICY "batch_production_factory_write" ON public.batch_production
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy buyers_delete on buyers (DELETE)
CREATE POLICY "buyers_delete" ON public.buyers
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy buyers_insert on buyers (INSERT)
CREATE POLICY "buyers_insert" ON public.buyers
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy buyers_select on buyers (SELECT)
CREATE POLICY "buyers_select" ON public.buyers
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy buyers_update on buyers (UPDATE)
CREATE POLICY "buyers_update" ON public.buyers
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy colorways_delete on colorways (DELETE)
CREATE POLICY "colorways_delete" ON public.colorways
  FOR DELETE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy colorways_insert on colorways (INSERT)
CREATE POLICY "colorways_insert" ON public.colorways
  FOR INSERT TO authenticated WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy colorways_select on colorways (SELECT)
CREATE POLICY "colorways_select" ON public.colorways
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy colorways_update on colorways (UPDATE)
CREATE POLICY "colorways_update" ON public.colorways
  FOR UPDATE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy control_panel_audit_logs_read on control_panel_audit_logs (SELECT)
CREATE POLICY "control_panel_audit_logs_read" ON public.control_panel_audit_logs
  FOR SELECT TO authenticated USING (is_superadmin());

-- policy cutting_bundles_factory on cutting_bundles (ALL)
CREATE POLICY "cutting_bundles_factory" ON public.cutting_bundles
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy cutting_lays_factory on cutting_lays (ALL)
CREATE POLICY "cutting_lays_factory" ON public.cutting_lays
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy cutting_session_lots_factory on cutting_session_lots (ALL)
CREATE POLICY "cutting_session_lots_factory" ON public.cutting_session_lots
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy cutting_sessions_factory on cutting_sessions (ALL)
CREATE POLICY "cutting_sessions_factory" ON public.cutting_sessions
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy dashboard_configs_select on dashboard_configs (SELECT)
CREATE POLICY "dashboard_configs_select" ON public.dashboard_configs
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy dashboard_configs_write on dashboard_configs (ALL)
CREATE POLICY "dashboard_configs_write" ON public.dashboard_configs
  FOR ALL TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin())) WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy dashboard_links_select on dashboard_links (SELECT)
CREATE POLICY "dashboard_links_select" ON public.dashboard_links
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy dashboard_links_write on dashboard_links (ALL)
CREATE POLICY "dashboard_links_write" ON public.dashboard_links
  FOR ALL TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin())) WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy defects_read on defects (SELECT)
CREATE POLICY "defects_read" ON public.defects
  FOR SELECT TO authenticated USING (true);

-- policy defects_write on defects (ALL)
CREATE POLICY "defects_write" ON public.defects
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy dept_workforce_rates_insert on department_workforce_rates (INSERT)
CREATE POLICY "dept_workforce_rates_insert" ON public.department_workforce_rates
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy dept_workforce_rates_select on department_workforce_rates (SELECT)
CREATE POLICY "dept_workforce_rates_select" ON public.department_workforce_rates
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy dept_workforce_rates_update on department_workforce_rates (UPDATE)
CREATE POLICY "dept_workforce_rates_update" ON public.department_workforce_rates
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy departments_delete on departments (DELETE)
CREATE POLICY "departments_delete" ON public.departments
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy departments_insert on departments (INSERT)
CREATE POLICY "departments_insert" ON public.departments
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy departments_select on departments (SELECT)
CREATE POLICY "departments_select" ON public.departments
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy departments_update on departments (UPDATE)
CREATE POLICY "departments_update" ON public.departments
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy fabric_components_delete on fabric_components (DELETE)
CREATE POLICY "fabric_components_delete" ON public.fabric_components
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy fabric_components_insert on fabric_components (INSERT)
CREATE POLICY "fabric_components_insert" ON public.fabric_components
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy fabric_components_select on fabric_components (SELECT)
CREATE POLICY "fabric_components_select" ON public.fabric_components
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy fabric_components_update on fabric_components (UPDATE)
CREATE POLICY "fabric_components_update" ON public.fabric_components
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy factories_insert on factories (INSERT)
CREATE POLICY "factories_insert" ON public.factories
  FOR INSERT TO authenticated WITH CHECK (true);

-- policy factories_select on factories (SELECT)
CREATE POLICY "factories_select" ON public.factories
  FOR SELECT TO authenticated USING (true);

-- policy floor_user_access_admin_write on floor_user_access (ALL)
CREATE POLICY "floor_user_access_admin_write" ON public.floor_user_access
  FOR ALL TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin())) WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy floor_user_access_select_factory on floor_user_access (SELECT)
CREATE POLICY "floor_user_access_select_factory" ON public.floor_user_access
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy handover_slips_select_factory on handover_slips (SELECT)
CREATE POLICY "handover_slips_select_factory" ON public.handover_slips
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy hourly_counts_factory_read on hourly_counts (SELECT)
CREATE POLICY "hourly_counts_factory_read" ON public.hourly_counts
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy hourly_counts_factory_write on hourly_counts (ALL)
CREATE POLICY "hourly_counts_factory_write" ON public.hourly_counts
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy inspection_sessions_read on inspection_sessions (SELECT)
CREATE POLICY "inspection_sessions_read" ON public.inspection_sessions
  FOR SELECT TO authenticated USING (true);

-- policy inspection_sessions_write on inspection_sessions (ALL)
CREATE POLICY "inspection_sessions_write" ON public.inspection_sessions
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy la_all on line_allocations (ALL)
CREATE POLICY "la_all" ON public.line_allocations
  FOR ALL TO authenticated USING ((factory_id = current_factory_id()));

-- policy operations_all on operations (ALL)
CREATE POLICY "operations_all" ON public.operations
  FOR ALL TO authenticated USING ((factory_id = current_factory_id()));

-- policy odth_insert on order_delivery_target_history (INSERT)
CREATE POLICY "odth_insert" ON public.order_delivery_target_history
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy odth_select on order_delivery_target_history (SELECT)
CREATE POLICY "odth_select" ON public.order_delivery_target_history
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy odt_delete on order_delivery_targets (DELETE)
CREATE POLICY "odt_delete" ON public.order_delivery_targets
  FOR DELETE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy odt_insert on order_delivery_targets (INSERT)
CREATE POLICY "odt_insert" ON public.order_delivery_targets
  FOR INSERT TO authenticated WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy odt_select on order_delivery_targets (SELECT)
CREATE POLICY "odt_select" ON public.order_delivery_targets
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy odt_update on order_delivery_targets (UPDATE)
CREATE POLICY "odt_update" ON public.order_delivery_targets
  FOR UPDATE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy ors_delete on order_routing_steps (DELETE)
CREATE POLICY "ors_delete" ON public.order_routing_steps
  FOR DELETE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy ors_insert on order_routing_steps (INSERT)
CREATE POLICY "ors_insert" ON public.order_routing_steps
  FOR INSERT TO authenticated WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy ors_select on order_routing_steps (SELECT)
CREATE POLICY "ors_select" ON public.order_routing_steps
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy ors_update on order_routing_steps (UPDATE)
CREATE POLICY "ors_update" ON public.order_routing_steps
  FOR UPDATE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy outsource_work_movements_select on outsource_work_movements (SELECT)
CREATE POLICY "outsource_work_movements_select" ON public.outsource_work_movements
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy pf_delete on process_flows (DELETE)
CREATE POLICY "pf_delete" ON public.process_flows
  FOR DELETE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy pf_insert on process_flows (INSERT)
CREATE POLICY "pf_insert" ON public.process_flows
  FOR INSERT TO authenticated WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy pf_select on process_flows (SELECT)
CREATE POLICY "pf_select" ON public.process_flows
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy pf_update on process_flows (UPDATE)
CREATE POLICY "pf_update" ON public.process_flows
  FOR UPDATE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy process_flows_delete on process_flows (DELETE)
CREATE POLICY "process_flows_delete" ON public.process_flows
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy process_flows_insert on process_flows (INSERT)
CREATE POLICY "process_flows_insert" ON public.process_flows
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy process_flows_select on process_flows (SELECT)
CREATE POLICY "process_flows_select" ON public.process_flows
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy process_flows_update on process_flows (UPDATE)
CREATE POLICY "process_flows_update" ON public.process_flows
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy profiles_insert_own on profiles (INSERT)
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));

-- policy profiles_select_factory on profiles (SELECT)
CREATE POLICY "profiles_select_factory" ON public.profiles
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy profiles_select_own on profiles (SELECT)
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING ((id = auth.uid()));

-- policy profiles_update_factory on profiles (UPDATE)
CREATE POLICY "profiles_update_factory" ON public.profiles
  FOR UPDATE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin())) WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy rejections_factory_read on rejections (SELECT)
CREATE POLICY "rejections_factory_read" ON public.rejections
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy rejections_factory_write on rejections (ALL)
CREATE POLICY "rejections_factory_write" ON public.rejections
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy shifts_delete on shifts (DELETE)
CREATE POLICY "shifts_delete" ON public.shifts
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy shifts_insert on shifts (INSERT)
CREATE POLICY "shifts_insert" ON public.shifts
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy shifts_select on shifts (SELECT)
CREATE POLICY "shifts_select" ON public.shifts
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy shifts_update on shifts (UPDATE)
CREATE POLICY "shifts_update" ON public.shifts
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy shipment_audits_factory_read on shipment_audits (SELECT)
CREATE POLICY "shipment_audits_factory_read" ON public.shipment_audits
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy shipment_audits_factory_write on shipment_audits (ALL)
CREATE POLICY "shipment_audits_factory_write" ON public.shipment_audits
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy shipments_factory_read on shipments (SELECT)
CREATE POLICY "shipments_factory_read" ON public.shipments
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy shipments_factory_write on shipments (ALL)
CREATE POLICY "shipments_factory_write" ON public.shipments
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy size_groups_delete on size_groups (DELETE)
CREATE POLICY "size_groups_delete" ON public.size_groups
  FOR DELETE TO authenticated USING ((factory_id = current_factory_id()));

-- policy size_groups_insert on size_groups (INSERT)
CREATE POLICY "size_groups_insert" ON public.size_groups
  FOR INSERT TO authenticated WITH CHECK ((factory_id = current_factory_id()));

-- policy size_groups_select on size_groups (SELECT)
CREATE POLICY "size_groups_select" ON public.size_groups
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy size_groups_update on size_groups (UPDATE)
CREATE POLICY "size_groups_update" ON public.size_groups
  FOR UPDATE TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- policy style_orders_all on style_orders (ALL)
CREATE POLICY "style_orders_all" ON public.style_orders
  FOR ALL TO authenticated USING ((factory_id = current_factory_id()));

-- policy support_dropdowns_delete on support_dropdowns (DELETE)
CREATE POLICY "support_dropdowns_delete" ON public.support_dropdowns
  FOR DELETE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy support_dropdowns_insert on support_dropdowns (INSERT)
CREATE POLICY "support_dropdowns_insert" ON public.support_dropdowns
  FOR INSERT TO authenticated WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy support_dropdowns_select on support_dropdowns (SELECT)
CREATE POLICY "support_dropdowns_select" ON public.support_dropdowns
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy support_dropdowns_update on support_dropdowns (UPDATE)
CREATE POLICY "support_dropdowns_update" ON public.support_dropdowns
  FOR UPDATE TO authenticated USING (((factory_id = current_factory_id()) AND is_factory_admin())) WITH CHECK (((factory_id = current_factory_id()) AND is_factory_admin()));

-- policy workforce_logs_factory_read on workforce_logs (SELECT)
CREATE POLICY "workforce_logs_factory_read" ON public.workforce_logs
  FOR SELECT TO authenticated USING ((factory_id = current_factory_id()));

-- policy workforce_logs_factory_write on workforce_logs (ALL)
CREATE POLICY "workforce_logs_factory_write" ON public.workforce_logs
  FOR ALL TO authenticated USING ((factory_id = current_factory_id())) WITH CHECK ((factory_id = current_factory_id()));

-- Triggers
CREATE TRIGGER assigned_resources_validate BEFORE INSERT OR UPDATE OF department_id, resource_type ON assigned_resources FOR EACH ROW EXECUTE FUNCTION trg_assigned_resources_validate();

CREATE TRIGGER audit_sessions_fill_allocation BEFORE INSERT OR UPDATE ON audit_sessions FOR EACH ROW EXECUTE FUNCTION capture_fill_line_allocation();

CREATE TRIGGER batch_production_apply_kpi BEFORE INSERT OR UPDATE OF start_time, end_time, headcount_by_category, produced_by_size, produced_qty, factory_id, order_id, colorway_id, department_id, resource_id, log_date ON batch_production FOR EACH ROW EXECUTE FUNCTION batch_production_apply_kpi();

CREATE TRIGGER batch_production_fill_allocation BEFORE INSERT OR UPDATE ON batch_production FOR EACH ROW EXECUTE FUNCTION capture_fill_line_allocation();

CREATE TRIGGER trg_batch_production_apply_kpi BEFORE INSERT OR UPDATE OF produced_qty, produced_by_size, order_route_id, resource_id, colorway_id, log_date ON batch_production FOR EACH ROW EXECUTE FUNCTION batch_production_apply_kpi();

CREATE TRIGGER trg_batch_production_updated_at BEFORE UPDATE ON batch_production FOR EACH ROW EXECUTE FUNCTION batch_production_set_updated_at();

CREATE TRIGGER cutting_bundles_fill_fabric_component_trigger BEFORE INSERT OR UPDATE ON cutting_bundles FOR EACH ROW EXECUTE FUNCTION cutting_bundles_fill_fabric_component();

CREATE TRIGGER cutting_sessions_fill_allocation BEFORE INSERT OR UPDATE ON cutting_sessions FOR EACH ROW EXECUTE FUNCTION capture_fill_line_allocation();

CREATE TRIGGER trg_defects_updated_at BEFORE UPDATE ON defects FOR EACH ROW EXECUTE FUNCTION set_defects_updated_at();

CREATE TRIGGER trg_seed_department_defects AFTER INSERT ON departments FOR EACH ROW EXECUTE FUNCTION seed_department_defects();

CREATE TRIGGER sync_colorway_ready_after_handover AFTER INSERT OR UPDATE ON handover_slips FOR EACH ROW EXECUTE FUNCTION trg_sync_colorway_ready_after_handover();

CREATE TRIGGER hourly_counts_apply_kpi BEFORE INSERT OR UPDATE OF count, factory_id, order_id, colorway_id, department_id, resource_id, log_date, order_route_id ON hourly_counts FOR EACH ROW EXECUTE FUNCTION hourly_counts_apply_kpi();

CREATE TRIGGER hourly_counts_fill_allocation BEFORE INSERT OR UPDATE ON hourly_counts FOR EACH ROW EXECUTE FUNCTION capture_fill_line_allocation();

CREATE TRIGGER sync_colorway_ready_after_hourly AFTER INSERT OR DELETE OR UPDATE ON hourly_counts FOR EACH ROW EXECUTE FUNCTION trg_sync_colorway_ready_generic();

CREATE TRIGGER inspection_sessions_apply_kpi BEFORE INSERT OR UPDATE ON inspection_sessions FOR EACH ROW EXECUTE FUNCTION inspection_sessions_apply_kpi();

CREATE TRIGGER inspection_sessions_fill_allocation BEFORE INSERT OR UPDATE ON inspection_sessions FOR EACH ROW EXECUTE FUNCTION capture_fill_line_allocation();

CREATE TRIGGER sync_colorway_ready_after_inspection AFTER INSERT OR DELETE OR UPDATE ON inspection_sessions FOR EACH ROW EXECUTE FUNCTION trg_sync_colorway_ready_generic();

CREATE TRIGGER la_updated_at BEFORE UPDATE ON line_allocations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER odt_history_trigger AFTER UPDATE ON order_delivery_targets FOR EACH ROW EXECUTE FUNCTION odt_log_history();

CREATE TRIGGER odt_set_total_qty BEFORE INSERT OR UPDATE ON order_delivery_targets FOR EACH ROW EXECUTE FUNCTION odt_set_total_qty();

CREATE TRIGGER odt_updated_at BEFORE UPDATE ON order_delivery_targets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER ors_updated_at BEFORE UPDATE ON order_routing_steps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER outsource_work_movements_fill_allocation BEFORE INSERT OR UPDATE OF visit_id, colorway_id, order_route_id, line_allocation_id, vendor_resource_id ON outsource_work_movements FOR EACH ROW EXECUTE FUNCTION outsource_work_movements_fill_allocation();

CREATE TRIGGER pf_updated_at BEFORE UPDATE ON process_flows FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER sync_profile_metadata AFTER INSERT OR UPDATE OF factory_id, user_role ON profiles FOR EACH ROW EXECUTE FUNCTION sync_profile_to_auth_metadata();

CREATE TRIGGER sync_colorway_ready_after_rejection AFTER INSERT OR DELETE OR UPDATE ON rejections FOR EACH ROW EXECUTE FUNCTION trg_sync_colorway_ready_generic();

CREATE TRIGGER style_orders_updated_at BEFORE UPDATE ON style_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER workforce_logs_fill_allocation BEFORE INSERT OR UPDATE OF line_allocation_id ON workforce_logs FOR EACH ROW EXECUTE FUNCTION workforce_logs_fill_from_allocation();

