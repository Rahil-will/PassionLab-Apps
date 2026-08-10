import { supabase } from './supabase';
import { saveFabricComponentsRpc } from './settingsRpc';
import type { FabricComponent } from '../types/settings';

export function mapFabricComponentFromDb(row: Record<string, unknown>): FabricComponent {
  return {
    id: row.id as string,
    factory_id: row.factory_id as string,
    department_id: row.department_id as string,
    code: String(row.code ?? ''),
    fabric_type: String(row.fabric_type ?? row.label ?? ''),
    remarks: row.remarks != null ? String(row.remarks) : null,
    is_primary: row.is_primary === true,
    is_active: row.is_active !== false,
    created_at: (row.created_at as string) ?? undefined,
    updated_at: (row.updated_at as string) ?? undefined,
  };
}

export async function fetchFabricComponentsForFactory(
  factoryId: string,
): Promise<FabricComponent[]> {
  const { data, error } = await supabase
    .from('fabric_components')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => mapFabricComponentFromDb(row as Record<string, unknown>));
}

export async function ensureFactoryFabricComponents(
  factoryId: string,
  originDepartmentId: string,
): Promise<void> {
  const { error } = await supabase.rpc('ensure_factory_fabric_components', {
    p_factory_id: factoryId,
    p_origin_department_id: originDepartmentId,
  });
  if (error) throw error;
}

export async function saveFabricComponentsForFactory(
  factoryId: string,
  originDepartmentId: string,
  draft: FabricComponent[],
  baseline: FabricComponent[],
): Promise<FabricComponent[]> {
  const draftPersistedIds = new Set(
    draft.filter((r) => !r.id.startsWith('temp_')).map((r) => r.id),
  );
  const toDelete = baseline
    .filter((r) => !draftPersistedIds.has(r.id) && !r.id.startsWith('temp_'))
    .map((r) => r.id);

  const rows = draft.map((row) => ({
    id: row.id,
    code: row.code,
    fabric_type: row.fabric_type.trim(),
    remarks: row.remarks?.trim() || null,
    is_primary: row.is_primary,
  }));

  const data = await saveFabricComponentsRpc(factoryId, originDepartmentId, rows, toDelete);
  return data.map((row) => mapFabricComponentFromDb(row));
}
