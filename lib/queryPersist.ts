import { get, set, del } from 'idb-keyval';
import type { Query } from '@tanstack/react-query';
import type { Persister, PersistedClient } from '@tanstack/query-persist-client-core';

/** IndexedDB key for the dehydrated React Query client. Bump buster in index.tsx to invalidate. */
export const QUERY_CACHE_STORAGE_KEY = 'prodigi-query-cache-v5';

/** Root query-key segments safe to persist offline (no auth/session data). */
const PERSISTABLE_ROOTS = new Set([
  'resources',
  'orders',
  'ganttFabric',
  'reports',
  'productionSummary',
  'factory',
]);

/** Order-detail bundles include non-serializable SizeProgressLookup helpers (functions). */
function isNonSerializableOrdersQuery(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] !== 'orders') return false;
  // ['orders', factoryId, 'detail', orderId, ...]
  if (queryKey[2] === 'detail') return true;
  return false;
}

function isCloneSafe(value: unknown): boolean {
  if (value === undefined) return true;
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

/** Drop queries/mutations IDB cannot serialize (in-flight Promise refs, functions, etc.). */
function sanitizePersistedClient(client: PersistedClient): PersistedClient | null {
  const queries = client.clientState.queries.filter((entry) => {
    if (entry.state.status !== 'success') return false;
    if (entry.state.fetchStatus && entry.state.fetchStatus !== 'idle') return false;
    return isCloneSafe(entry.state.data);
  });

  if (queries.length === 0) return null;

  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries,
      mutations: [],
    },
  };
}

export function shouldPersistQuery(query: Query): boolean {
  // Pending / background refetch queries can carry Promise refs IDB cannot clone.
  if (query.state.status !== 'success') return false;
  if (query.state.fetchStatus !== 'idle') return false;
  const key = query.queryKey;
  const root = key[0];
  if (typeof root !== 'string' || !PERSISTABLE_ROOTS.has(root)) return false;
  if (isNonSerializableOrdersQuery(key)) return false;
  if (!isCloneSafe(query.state.data)) return false;
  return true;
}

export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    const sanitized = sanitizePersistedClient(client);
    if (!sanitized) return;
    try {
      await set(QUERY_CACHE_STORAGE_KEY, sanitized);
    } catch (err) {
      console.warn('[queryPersist] Skipped IDB persist:', err);
    }
  },
  restoreClient: async () => {
    try {
      return (await get(QUERY_CACHE_STORAGE_KEY)) ?? undefined;
    } catch (err) {
      console.warn('[queryPersist] Cleared corrupt IDB cache:', err);
      await del(QUERY_CACHE_STORAGE_KEY);
      return undefined;
    }
  },
  removeClient: async () => {
    await del(QUERY_CACHE_STORAGE_KEY);
  },
};
