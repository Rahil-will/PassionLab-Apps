import { invokeAdminEdgeFunction } from './adminApi';

export interface DeleteFactoryUserResult {
  authDeleted: boolean;
}

/**
 * Deletes a floor user via the admin-delete-user Edge Function (auth + profile cascade).
 */
export async function deleteFactoryUser(
  userId: string,
  factoryId: string,
): Promise<DeleteFactoryUserResult> {
  await invokeAdminEdgeFunction('admin-delete-user', { userId, factoryId });
  return { authDeleted: true };
}
