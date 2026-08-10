import { create } from 'zustand';
import {
  StyleOrder,
  AssignedResource,
  LineAllocation,
  Garment,
} from '../types';
import { useNavigationStore } from './navigationStore';
import { useNotificationStore } from './notificationStore';
import { guardOnlineMutation } from '../lib/offlineGuard';
import { supabase } from '../lib/supabase';
import { saveResourceRpc } from '../lib/settingsRpc';
import { mapAllocationRow } from '../lib/allocationRowMap';
import { allocationColorwayId } from '../lib/allocationUtils';
import {
  deleteStyleOrder,
} from '../lib/styleOrderDb';
import { saveStyleOrderAtomic } from '../lib/saveStyleOrder';
import { invalidateFactoryOrders, invalidateFactoryResources } from '../lib/invalidateFactoryData';
import { invalidateProductionSummary } from '../lib/queries/productionSummary';
import { ensureAssignedResources } from '../lib/queries/resources';
import { saveColorwayPlanningRemarksRpc } from '../lib/settingsRpc';
import { reloadOrderFromDb, reloadAllocationsFromDb } from '../lib/reloadOrderFromDb';
import { queryClient } from '../lib/queryClient';

interface DataState {
  orders: StyleOrder[];
  assignedResources: AssignedResource[];
  productionLines: AssignedResource[];
  allocations: LineAllocation[];
  garments: Garment[];
  wipOrder: StyleOrder | null;
  loading: boolean;
  /** Factory id for the cached orders/allocs payload — skip redundant silent refetches. */
  dataFactoryId: string | null;
  setWipOrder: (order: StyleOrder | null) => void;
  refreshAssignedResources: () => Promise<void>;
  refreshAllocations: () => Promise<void>;
  /** Reload one order + all allocations after line-plan or routing save. */
  refreshOrderAndAllocations: (orderId: string) => Promise<void>;
  addOrder: (order: StyleOrder) => Promise<boolean>;
  updateOrder: (id: string, order: Partial<StyleOrder>) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<void>;
  updateColorwayPlanningRemarks: (colorwayId: string, orderId: string, remarks: string) => Promise<void>;
  addResource: (resource: AssignedResource) => Promise<void>;
  updateResource: (id: string, updates: Partial<AssignedResource>) => Promise<void>;
  deleteResource: (id: string) => Promise<void>;
  addGarments: (garments: Garment[]) => Promise<void>;
}

export const useDataStore = create<DataState>((set, get) => ({
  orders: [],
  assignedResources: [],
  productionLines: [],
  allocations: [],
  garments: [],
  wipOrder: null,
  loading: false,
  dataFactoryId: null,

  setWipOrder: (order) => set({ wipOrder: order }),

  refreshAssignedResources: async () => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    const { mapped } = await ensureAssignedResources(factoryId);
    set({ assignedResources: mapped, productionLines: mapped });
    void invalidateFactoryResources(factoryId);
  },

  refreshAllocations: async () => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    try {
      const rows = await reloadAllocationsFromDb(factoryId);
      set({
        allocations: rows.map((a) => mapAllocationRow(a)),
      });
    } catch (err) {
      console.error('Failed to refresh allocations', err);
    }
  },

  refreshOrderAndAllocations: async (orderId) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    try {
      const [reloaded, allocRows] = await Promise.all([
        reloadOrderFromDb(factoryId, orderId),
        reloadAllocationsFromDb(factoryId),
      ]);
      set((state) => ({
        orders: reloaded
          ? state.orders.map((o) => (o.id === orderId ? reloaded : o))
          : state.orders,
        allocations: allocRows.map((a) => mapAllocationRow(a)),
      }));
      await Promise.all([
        invalidateFactoryOrders(factoryId, orderId),
        invalidateProductionSummary(queryClient, factoryId),
      ]);
    } catch (err) {
      console.error('refreshOrderAndAllocations failed', err);
      throw err;
    }
  },

  addOrder: async (order) => {
    if (!guardOnlineMutation('Save order')) return false;
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return false;
    if (!order.buyerId) {
      useNotificationStore.getState().showNotification(
        'Buyer is required — select a buyer before saving.',
        'error',
      );
      return false;
    }
    try {
      const savedId = await saveStyleOrderAtomic(factoryId, order, order.id);
      const savedOrder: StyleOrder = { ...order, id: savedId };
      set((state) => ({
        orders: [savedOrder, ...state.orders.filter((o) => o.id !== savedId)],
        wipOrder: null,
      }));
      await Promise.all([
        invalidateFactoryOrders(factoryId, savedId),
        invalidateProductionSummary(queryClient, factoryId),
      ]);
      return true;
    } catch (err) {
      console.error('addOrder failed', err);
      const message = err instanceof Error ? err.message : 'Failed to save order';
      useNotificationStore.getState().showNotification(message, 'error');
      return false;
    }
  },

  updateOrder: async (id, updates) => {
    if (!guardOnlineMutation('Save order')) return false;
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return false;
    if (updates.buyerId === undefined && updates.buyer !== undefined && !updates.buyer) {
      useNotificationStore.getState().showNotification(
        'Buyer is required — select a buyer before saving.',
        'error',
      );
      return false;
    }
    try {
      await saveStyleOrderAtomic(factoryId, updates, id);
      let reloaded: StyleOrder | null = null;
      try {
        reloaded = await reloadOrderFromDb(factoryId, id);
      } catch (reloadErr) {
        console.warn('reloadOrderFromDb failed after update', reloadErr);
      }
      if (reloaded) {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === id ? reloaded! : o)),
          wipOrder: null,
        }));
      } else {
        set({ wipOrder: null });
      }
      await Promise.all([
        invalidateFactoryOrders(factoryId, id),
        invalidateProductionSummary(queryClient, factoryId),
      ]);
      return true;
    } catch (err) {
      console.error('updateOrder failed', err);
      const message = err instanceof Error ? err.message : 'Failed to update order';
      useNotificationStore.getState().showNotification(message, 'error');
      return false;
    }
  },

  deleteOrder: async (id) => {
    if (!guardOnlineMutation('Delete order')) return;
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');

    const order = get().orders.find((o) => o.id === id);
    const colorwayIds = order?.colorways?.map((c) => c.id).filter(Boolean) ?? [];

    await deleteStyleOrder(factoryId, id);

    set((state) => ({
      orders: state.orders.filter((o) => o.id !== id),
      allocations: state.allocations.filter(
        (a) => !colorwayIds.includes(allocationColorwayId(a)) && a.orderId !== id,
      ),
      wipOrder: state.wipOrder?.id === id ? null : state.wipOrder,
    }));
    void invalidateFactoryOrders(factoryId, id);
    useNotificationStore.getState().showNotification('Order deleted', 'success');
  },

  updateColorwayPlanningRemarks: async (colorwayId, orderId, remarks) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    if (!guardOnlineMutation('Save planning remarks')) return;

    const trimmed = remarks.trim() || null;
    await saveColorwayPlanningRemarksRpc(factoryId, orderId, colorwayId, remarks);

    set((state) => ({
      orders: state.orders.map((o) =>
        o.id !== orderId
          ? o
          : {
              ...o,
              colorways: o.colorways.map((cw) =>
                cw.id === colorwayId ? { ...cw, planningRemarks: trimmed ?? '' } : cw,
              ),
            },
      ),
      wipOrder:
        state.wipOrder?.id === orderId
          ? {
              ...state.wipOrder,
              colorways: state.wipOrder.colorways.map((cw) =>
                cw.id === colorwayId ? { ...cw, planningRemarks: trimmed ?? '' } : cw,
              ),
            }
          : state.wipOrder,
    }));

    await invalidateFactoryOrders(factoryId, orderId);
  },

  addResource: async (res) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    try {
      const saved = await saveResourceRpc(
        'insert',
        factoryId,
        {
          id: res.id,
          departmentId: res.departmentId,
          resourceName: res.resourceName,
          resourceType: res.resourceType === 'outsourced' ? 'outsourced' : 'inhouse',
          capacity: res.dailyTarget,
        },
        res.departmentName,
      );
      set((s) => {
        const newResources = [...s.assignedResources, saved];
        return { assignedResources: newResources, productionLines: newResources };
      });
      await invalidateFactoryResources(factoryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      useNotificationStore.getState().showNotification(
        `Failed to add resource: ${message}`,
        'error',
      );
      throw error;
    }
  },

  updateResource: async (id, updates) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    const existing = get().assignedResources.find((r) => r.id === id);
    if (!existing) throw new Error('Resource not found');
    try {
      const saved = await saveResourceRpc(
        'update',
        factoryId,
        {
          id,
          departmentId: updates.departmentId ?? existing.departmentId,
          resourceName: updates.resourceName ?? existing.resourceName,
          resourceType: (updates.resourceType ?? existing.resourceType) === 'outsourced'
            ? 'outsourced'
            : 'inhouse',
          capacity: updates.dailyTarget ?? existing.dailyTarget,
        },
        updates.departmentName ?? existing.departmentName,
      );
      set((s) => {
        const newResources = s.assignedResources.map((r) => (r.id === id ? saved : r));
        return { assignedResources: newResources, productionLines: newResources };
      });
      await invalidateFactoryResources(factoryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      useNotificationStore.getState().showNotification(
        `Failed to update resource: ${message}`,
        'error',
      );
      throw error;
    }
  },

  deleteResource: async (id) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    try {
      await saveResourceRpc('delete', factoryId, { id });
      set((s) => {
        const newResources = s.assignedResources.filter((r) => r.id !== id);
        return { assignedResources: newResources, productionLines: newResources };
      });
      await invalidateFactoryResources(factoryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      useNotificationStore.getState().showNotification(
        `Failed to delete resource: ${message}`,
        'error',
      );
      throw error;
    }
  },

  addGarments: async (garments) => {
    set((state) => ({ garments: [...state.garments, ...garments] }));
    useNotificationStore.getState().showNotification(`${garments.length} garments added`);
  },
}));
