import type { SupabaseClient } from '@supabase/supabase-js';
import type { DepartmentResource } from '../types/settings';

export function mapDepartmentResourceFromDb(
  row: Record<string, unknown>,
  departmentId: string,
  departmentName?: string,
): DepartmentResource {
  return {
    id: row.id as string,
    resourceName: (row.resource_name as string) || '',
    description: (row.description as string) || '',
    departmentId,
    departmentName,
    defaultPcs: (row.capacity as number) || 0,
  };
}

function cloneResources(resources: DepartmentResource[]): DepartmentResource[] {
  return resources.map((r) => ({ ...r }));
}

export interface DepartmentResourceDiff {
  toDelete: string[];
  toInsert: DepartmentResource[];
  toUpdate: DepartmentResource[];
}

export function diffDepartmentResources(
  baseline: DepartmentResource[],
  draft: DepartmentResource[],
): DepartmentResourceDiff {
  const baselineById = new Map(baseline.map((r) => [r.id, r]));
  const draftIds = new Set(draft.map((r) => r.id));

  const toDelete = baseline.filter((r) => !draftIds.has(r.id)).map((r) => r.id);
  const toInsert = draft.filter((r) => !baselineById.has(r.id));
  // Existing rows are updated so name/capacity/type stay aligned (e.g. outsourced toggle).
  const toUpdate = draft.filter((r) => baselineById.has(r.id));

  return { toDelete, toInsert, toUpdate };
}

export async function syncDepartmentResourcesToDb(
  client: SupabaseClient,
  opts: {
    departmentId: string;
    factoryId: string;
    draft: DepartmentResource[];
    baseline: DepartmentResource[];
    resourceType: 'inhouse' | 'outsourced';
  },
): Promise<DepartmentResource[]> {
  const { departmentId, factoryId, draft, baseline, resourceType } = opts;
  const { toDelete, toInsert, toUpdate } = diffDepartmentResources(baseline, draft);

  for (const id of toDelete) {
    const { error } = await client.rpc('save_resource', {
      p_action: 'delete',
      p_factory_id: factoryId,
      p_id: id,
      p_department_id: null,
      p_resource_name: null,
      p_resource_type: null,
      p_capacity: null,
      p_status: null,
      p_description: null,
    });
    if (error) throw error;
  }

  const savedByOriginalId = new Map<string, DepartmentResource>();

  const upsert = async (resource: DepartmentResource, action: 'insert' | 'update') => {
    const { data, error } = await client.rpc('save_resource', {
      p_action: action,
      p_factory_id: factoryId,
      p_id: resource.id,
      p_department_id: departmentId,
      p_resource_name: resource.resourceName.trim(),
      p_resource_type: resourceType,
      p_capacity: resource.defaultPcs ?? 0,
      p_status: 'active',
      p_description: (resource.description ?? '').trim(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('save_resource did not return a row');
    const mapped = mapDepartmentResourceFromDb(row as Record<string, unknown>, departmentId);
    savedByOriginalId.set(resource.id, mapped);
  };

  for (const resource of toUpdate) await upsert(resource, 'update');
  for (const resource of toInsert) await upsert(resource, 'insert');

  return draft.map((r) => savedByOriginalId.get(r.id) ?? r);
}
