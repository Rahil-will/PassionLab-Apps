/** Maps app resource shape to `assigned_resources` columns (matches live Supabase schema). */

export interface ResourceInput {
  id?: string;
  resourceName: string;
  description?: string;
  defaultPcs?: number;
}

export function assignedResourceToDbRow(
  resource: ResourceInput,
  opts: {
    factoryId: string;
    departmentId: string | null;
    resourceType: 'inhouse' | 'outsourced';
  },
): Record<string, unknown> {
  return {
    id: resource.id || crypto.randomUUID(),
    factory_id: opts.factoryId,
    department_id: opts.departmentId || null,
    resource_name: resource.resourceName.trim(),
    description: (resource.description ?? '').trim(),
    resource_type: opts.resourceType,
    capacity: resource.defaultPcs ?? 0,
    status: 'active',
  };
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as { message: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}
