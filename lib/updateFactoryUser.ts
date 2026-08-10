import { invokeAdminEdgeFunction } from './adminApi';
import type { DeptAppId } from './floorApps';

export interface UpdateFactoryUserInput {
  factoryId: string;
  userId: string;
  fullName?: string;
  email?: string;
  floorPin?: string;
  departmentId?: string | null;
  assignedApps?: DeptAppId[];
  assignedOperationIds?: string[];
  status?: 'Active' | 'Inactive';
  userRole?: string;
}

/**
 * Updates a floor user via the admin-update-user Edge Function.
 * Partial update — only the supplied fields are touched on the server.
 * Do NOT call update_factory_user RPC (does not exist live; edge-fn-only architecture).
 */
export async function updateFactoryUser(
  input: UpdateFactoryUserInput,
): Promise<{ id: string }> {
  const payload = await invokeAdminEdgeFunction<{ id?: string }>('admin-update-user', {
    factoryId: input.factoryId,
    userId: input.userId,
    fullName: input.fullName,
    email: input.email,
    floorPin: input.floorPin,
    departmentId: input.departmentId,
    assignedApps: input.assignedApps,
    assignedOperationIds: input.assignedOperationIds,
    status: input.status,
    userRole: input.userRole,
  });

  if (!payload.id) {
    throw new Error('User update did not return an id');
  }
  return { id: payload.id };
}
