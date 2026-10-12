import { invokeAdminEdgeFunction } from './adminApi';
import type { DeptAppId } from './floorApps';

export interface CreateFactoryUserInput {
  factoryId: string;
  fullName: string;
  email: string;
  floorPin: string;
  departmentId: string | null;
  assignedApps: DeptAppId[];
  assignedOperationIds?: string[];
  handoverEnabled?: boolean;
  workforceEnabled?: boolean;
  auditEnabled?: boolean;
  shipmentQaEnabled?: boolean;
  userRole?: string;
  status?: 'Active' | 'Inactive';
  password?: string;
}

function edgeDeployHint(message: string): string {
  if (
    message.includes('Function not found') ||
    message.includes('Failed to send a request to the Edge Function') ||
    message.includes('employee_id')
  ) {
    return ' Redeploy admin-create-user edge function or apply create_factory_floor_user RPC migration.';
  }
  return '';
}

/**
 * Creates a floor user via the admin-create-user Edge Function.
 */
export async function createFactoryUser(input: CreateFactoryUserInput): Promise<{ id: string }> {
  const payload = await invokeAdminEdgeFunction<{ id?: string }>('admin-create-user', {
    factoryId: input.factoryId,
    fullName: input.fullName,
    email: input.email,
    floorPin: input.floorPin,
    departmentId: input.departmentId,
    assignedApps: input.assignedApps,
    assignedOperationIds: input.assignedOperationIds ?? [],
    userRole: input.userRole ?? 'operator',
    status: input.status ?? 'Active',
    workforceEnabled: input.workforceEnabled,
    password: input.password,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'Failed to create user';
    throw new Error(message + edgeDeployHint(message));
  });

  if (!payload.id) {
    throw new Error('User created but no id returned');
  }

  return { id: payload.id };
}
