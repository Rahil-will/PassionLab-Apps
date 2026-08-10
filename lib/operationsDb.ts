import { supabase } from './supabase';
import { saveOperationRpc } from './settingsRpc';

export type OperationStepType = 'loading' | 'produce' | 'store' | 'outsource';

export const OPERATION_STEP_TYPES: OperationStepType[] = ['loading', 'produce', 'store', 'outsource'];

export const OPERATION_STEP_TYPE_LABELS: Record<OperationStepType, string> = {
  loading: 'Loading',
  produce: 'Produce',
  store: 'Store',
  outsource: 'Outsource',
};

export interface OperationRow {
  id: string;
  factory_id: string;
  department_id: string;
  name: string;
  step_type: OperationStepType;
  capture_app: string | null;
  is_active: boolean;
}

function mapOperation(row: Record<string, unknown>): OperationRow {
  return {
    id: row.id as string,
    factory_id: row.factory_id as string,
    department_id: row.department_id as string,
    name: row.name as string,
    step_type: (row.step_type as OperationStepType) || 'produce',
    capture_app: (row.capture_app as string) || null,
    is_active: row.is_active !== false,
  };
}

export async function fetchOperationsForDepartment(
  factoryId: string,
  departmentId: string,
  opts?: { includeInactive?: boolean },
): Promise<OperationRow[]> {
  let query = supabase
    .from('operations')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId);
  if (!opts?.includeInactive) {
    query = query.eq('is_active', true);
  }
  const { data, error } = await query.order('name');
  if (error) {
    if (error.code === '42P01' || error.message.includes('does not exist')) return [];
    throw error;
  }
  return (data || []).map((r) => mapOperation(r as Record<string, unknown>));
}

export async function fetchAllOperationsForFactory(factoryId: string): Promise<OperationRow[]> {
  const { data, error } = await supabase
    .from('operations')
    .select('*')
    .eq('factory_id', factoryId)
    .order('department_id')
    .order('name');
  if (error) {
    if (error.code === '42P01' || error.message.includes('does not exist')) return [];
    throw error;
  }
  return (data || []).map((r) => mapOperation(r as Record<string, unknown>));
}

export async function fetchOperationsForFactory(factoryId: string): Promise<OperationRow[]> {
  const { data, error } = await supabase
    .from('operations')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('is_active', true)
    .order('department_id')
    .order('name');
  if (error) {
    if (error.code === '42P01' || error.message.includes('does not exist')) return [];
    throw error;
  }
  return (data || []).map((r) => mapOperation(r as Record<string, unknown>));
}

export function operationsByDepartmentId(
  operations: OperationRow[],
): Map<string, OperationRow[]> {
  const map = new Map<string, OperationRow[]>();
  for (const op of operations) {
    const list = map.get(op.department_id) ?? [];
    list.push(op);
    map.set(op.department_id, list);
  }
  return map;
}

export function resolveOperationDefId(
  departmentId: string | null | undefined,
  label: string | undefined,
  operationsByDept: Map<string, OperationRow[]>,
  explicitId?: string | null,
): string | null {
  if (explicitId) return explicitId;
  if (!departmentId) return null;
  const ops = operationsByDept.get(departmentId) ?? [];
  const needle = (label || '').trim().toLowerCase();
  if (needle) {
    const match = ops.find((o) => o.name.trim().toLowerCase() === needle);
    if (match) return match.id;
  }
  return ops[0]?.id ?? null;
}

export interface UpsertOperationInput {
  id?: string;
  department_id: string;
  name: string;
  step_type: OperationStepType;
  capture_app?: string | null;
}

export async function upsertOperation(
  factoryId: string,
  input: UpsertOperationInput,
): Promise<OperationRow> {
  const action = input.id ? 'update' : 'insert';
  const data = await saveOperationRpc(action, factoryId, {
    id: input.id,
    department_id: input.department_id,
    name: input.name.trim(),
    step_type: input.step_type,
    capture_app: input.capture_app ?? null,
  });
  if (!data) throw new Error('No operation returned');
  return mapOperation(data);
}

export async function fetchOperationsByIds(
  factoryId: string,
  ids: string[],
): Promise<OperationRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('operations')
    .select('*')
    .eq('factory_id', factoryId)
    .in('id', ids);
  if (error) {
    if (error.code === '42P01' || error.message.includes('does not exist')) return [];
    throw error;
  }
  return (data || []).map((r) => mapOperation(r as Record<string, unknown>));
}

/** Active catalog + any operation ids already linked on order routes (including inactive). */
export async function fetchOperationsForRoutingCatalog(
  factoryId: string,
  referencedOperationIds: string[],
): Promise<OperationRow[]> {
  const [activeOps, referencedOps] = await Promise.all([
    fetchOperationsForFactory(factoryId),
    fetchOperationsByIds(factoryId, [...new Set(referencedOperationIds.filter(Boolean))]),
  ]);
  const merged = [...activeOps];
  const seen = new Set(activeOps.map((o) => o.id));
  for (const op of referencedOps) {
    if (!seen.has(op.id)) {
      merged.push(op);
      seen.add(op.id);
    }
  }
  return merged;
}

export async function archiveOperation(factoryId: string, operationId: string): Promise<void> {
  await saveOperationRpc('archive', factoryId, {
    id: operationId,
    department_id: '',
    name: '',
    step_type: 'produce',
  });
}

export async function fetchAppConfiguration(
  factoryId: string,
): Promise<Record<OperationStepType, string[]>> {
  const defaults: Record<OperationStepType, string[]> = {
    loading: ['hourly'],
    produce: ['hourly', 'qc_log', 'batch', 'cutting_lay'],
    store: [],
    outsource: [],
  };
  const { data, error } = await supabase
    .from('app_configuration')
    .select('step_type, allowed_apps')
    .eq('factory_id', factoryId);
  if (error) {
    if (error.code === '42P01') return defaults;
    throw error;
  }
  const out = { ...defaults };
  for (const row of data || []) {
    const st = row.step_type as OperationStepType;
    if (st in out && Array.isArray(row.allowed_apps)) {
      out[st] = row.allowed_apps as string[];
    }
  }
  return out;
}
