import { supabase } from './supabase';
import { mapResourceRow } from './queries/resources';
import type { AssignedResource } from '../types';

export interface SaveResourceInput {
  id?: string;
  departmentId?: string;
  resourceName?: string;
  resourceType?: 'inhouse' | 'outsourced';
  capacity?: number;
  status?: string;
  description?: string;
}

function mapRpcResourceRow(
  row: Record<string, unknown>,
  departmentName = '',
): AssignedResource {
  return mapResourceRow({
    ...row,
    departments: departmentName ? { name: departmentName } : null,
  });
}

export async function saveResourceRpc(
  action: 'insert' | 'update' | 'delete',
  factoryId: string,
  payload: SaveResourceInput & { id?: string },
  departmentName = '',
): Promise<AssignedResource | null> {
  const { data, error } = await supabase.rpc('save_resource', {
    p_action: action,
    p_factory_id: factoryId,
    p_id: payload.id ?? null,
    p_department_id: payload.departmentId ?? null,
    p_resource_name: payload.resourceName ?? null,
    p_resource_type: payload.resourceType ?? null,
    p_capacity: payload.capacity ?? null,
    p_status: payload.status ?? null,
    p_description: payload.description ?? null,
  });
  if (error) throw error;
  if (action === 'delete') return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No resource returned from save_resource');
  return mapRpcResourceRow(row as Record<string, unknown>, departmentName);
}

export interface SaveSupportDropdownInput {
  id?: string;
  category?: string;
  app_name?: string | null;
  values?: string[];
}

export async function saveSupportDropdownRpc(
  action: 'insert' | 'update' | 'delete',
  factoryId: string,
  payload: SaveSupportDropdownInput,
): Promise<{ id: string; factory_id: string; category: string; app_name: string | null; values: string[] } | null> {
  const { data, error } = await supabase.rpc('save_support_dropdown', {
    p_action: action,
    p_factory_id: factoryId,
    p_id: payload.id ?? null,
    p_category: payload.category ?? null,
    p_app_name: payload.app_name ?? null,
    p_values: payload.values ?? [],
  });
  if (error) throw error;
  if (action === 'delete') return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No support dropdown returned');
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    factory_id: r.factory_id as string,
    category: r.category as string,
    app_name: (r.app_name as string) || null,
    values: Array.isArray(r.values) ? (r.values as string[]) : [],
  };
}

export interface SaveFactorySettingsInput {
  name?: string;
  code?: string;
  country?: string;
  timezone?: string;
  defaultShiftId?: string | null;
  transaction_apps?: string[];
  production_apps?: string[];
  workforce_apps?: string[];
  audit_apps?: string[];
  shipment_apps?: string[];
}

export async function saveFactorySettingsRpc(
  factoryId: string,
  payload: SaveFactorySettingsInput,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('save_factory_settings', {
    p_factory_id: factoryId,
    p_name: payload.name ?? null,
    p_code: payload.code ?? null,
    p_country: payload.country ?? null,
    p_timezone: payload.timezone ?? null,
    p_default_shift_id: payload.defaultShiftId ?? null,
    p_transaction_apps: payload.transaction_apps ?? null,
    p_production_apps: payload.production_apps ?? null,
    p_workforce_apps: payload.workforce_apps ?? null,
    p_audit_apps: payload.audit_apps ?? null,
    p_shipment_apps: payload.shipment_apps ?? null,
  });
  if (error) throw error;
  if (!data) throw new Error('No factory returned from save_factory_settings');
  return data as Record<string, unknown>;
}

export interface SaveFabricComponentRow {
  id: string;
  code: string;
  fabric_type: string;
  remarks?: string | null;
  is_primary: boolean;
}

export async function saveFabricComponentsRpc(
  factoryId: string,
  originDepartmentId: string,
  rows: SaveFabricComponentRow[],
  deleteIds: string[],
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc('save_fabric_components', {
    p_factory_id: factoryId,
    p_origin_department_id: originDepartmentId,
    p_rows: rows,
    p_delete_ids: deleteIds,
  });
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

export interface SaveOperationInput {
  id?: string;
  department_id: string;
  name: string;
  step_type: string;
  capture_app?: string | null;
}

export async function saveOperationRpc(
  action: 'insert' | 'update' | 'archive',
  factoryId: string,
  payload: SaveOperationInput,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('save_operation', {
    p_action: action,
    p_factory_id: factoryId,
    p_id: payload.id ?? null,
    p_department_id: payload.department_id ?? null,
    p_name: payload.name ?? null,
    p_step_type: payload.step_type ?? null,
    p_capture_app: payload.capture_app ?? null,
  });
  if (error) throw error;
  if (action === 'archive') return (data as Record<string, unknown>) ?? null;
  if (!data) throw new Error('No operation returned from save_operation');
  return data as Record<string, unknown>;
}

export async function saveColorwayPlanningRemarksRpc(
  factoryId: string,
  orderId: string,
  colorwayId: string,
  remarks: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('save_colorway_planning_remarks', {
    p_factory_id: factoryId,
    p_order_id: orderId,
    p_colorway_id: colorwayId,
    p_remarks: remarks,
  });
  if (error) throw error;
  return String(data);
}
