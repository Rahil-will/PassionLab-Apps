import { queryClient } from '../lib/queryClient';
import { queryKeys } from '../lib/queryKeys';

/** Surgical invalidation after order / planning mutations — replaces full fetchData({ force: true }). */
export async function invalidateFactoryOrders(factoryId: string, orderId?: string): Promise<void> {
  const tasks = [
    queryClient.invalidateQueries({ queryKey: ['orders', factoryId] }),
    queryClient.invalidateQueries({ queryKey: ['factory', factoryId] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.productionSummary(factoryId) }),
  ];
  if (orderId) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.orderDetail(factoryId, orderId) }),
    );
  }
  tasks.push(
    queryClient.invalidateQueries({ queryKey: queryKeys.planningGanttContext(factoryId) }),
  );
  await Promise.all(tasks);
}

export async function invalidateFactoryResources(factoryId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.resources(factoryId) });
}

export async function invalidateFactorySettings(factoryId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.settings(factoryId) });
}
