import { useCallback, useEffect, useState } from 'react';
import {
  listFabricConstructions,
  listFabrics,
  type MmFabric,
  type MmFabricConstruction,
  type MmFabricListFilter,
  type MmFabricListResult,
} from './mmFabricRpc';

export function useMmFabrics(filter: MmFabricListFilter = {}) {
  const [data, setData] = useState<MmFabricListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify({
    search: filter.search ?? '',
    fabric_type_id: filter.fabric_type_id ?? '',
    construction_id: filter.construction_id ?? '',
    status: filter.status ?? null,
    include_inactive: filter.include_inactive ?? false,
    with_stock: filter.with_stock ?? false,
    limit: filter.limit ?? null,
  });

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listFabrics(filter);
    if (res.ok === false) {
      setError(res.message);
      setData(null);
    } else {
      setData(res.data);
    }
    setLoading(false);
    // filter object identity changes every render; key captures values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    rows: (data?.rows ?? []) as MmFabric[],
    counts: data?.counts ?? { active: 0, pending_review: 0, inactive: 0 },
    unlinkedStock: data?.unlinked_stock ?? null,
    loading,
    error,
    refetch,
  };
}

export function useMmFabricConstructions(typeId?: string | null) {
  const [rows, setRows] = useState<MmFabricConstruction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!typeId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await listFabricConstructions(typeId);
    if (res.ok === false) {
      setError(res.message);
      setRows([]);
    } else {
      setRows(res.data.rows ?? []);
    }
    setLoading(false);
  }, [typeId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { rows, loading, error, refetch };
}
