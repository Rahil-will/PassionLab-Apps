import { supabase } from '../supabase';
import { queryClient } from '../queryClient';
import { queryKeys } from '../queryKeys';
import { sortResourcesBySequence } from '../ganttSchedule';
import type { AssignedResource } from '../../types';

export function mapResourceRow(r: Record<string, unknown>): AssignedResource {
  const dept = r.departments as { name?: string } | null;
  const resourceType = r.resource_type === 'outsourced' ? 'outsourced' : 'inhouse';
  return {
    id: r.id as string,
    factory_id: r.factory_id as string,
    departmentId: (r.department_id as string) || '',
    departmentName: dept?.name || '',
    resourceName: (r.resource_name as string) || '',
    resourceType,
    dailyTarget: (r.capacity as number) || 0,
    defaultPcs: (r.capacity as number) || 0,
  };
}

/** Raw PostgREST rows — used by settingsStore department resource mapping. */
export async function fetchAssignedResourceRows(
  factoryId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('assigned_resources')
    .select('*, departments(name)')
    .eq('factory_id', factoryId)
    .order('resource_name');
  if (error) throw error;
  return (data || []) as Record<string, unknown>[];
}

export async function fetchAssignedResources(factoryId: string): Promise<AssignedResource[]> {
  const rows = await fetchAssignedResourceRows(factoryId);
  return sortResourcesBySequence(rows.map(mapResourceRow));
}

const resourcesRowsKey = (factoryId: string) =>
  [...queryKeys.resources(factoryId), 'rows'] as const;

/**
 * Deduped resource load for dataStore + settingsStore.
 * One network round-trip; both mapped and raw caches stay warm.
 */
export async function ensureAssignedResources(factoryId: string): Promise<{
  mapped: AssignedResource[];
  rows: Record<string, unknown>[];
}> {
  const rows = await queryClient.fetchQuery({
    queryKey: resourcesRowsKey(factoryId),
    queryFn: () => fetchAssignedResourceRows(factoryId),
    staleTime: 5 * 60 * 1000,
  });
  const mapped = sortResourcesBySequence(rows.map(mapResourceRow));
  queryClient.setQueryData(queryKeys.resources(factoryId), mapped);
  return { mapped, rows };
}
