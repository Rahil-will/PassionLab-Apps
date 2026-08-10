import { useEffect, useMemo, useState } from 'react';
import {
  cuttingComponentsForOperation,
  fetchCuttingComponentProgressRows,
  type CuttingComponentProgressRow,
  type FabricCutQtyComponentRow,
} from '../lib/mesReportsApi';

export interface UseCuttingComponentProgressResult {
  rows: CuttingComponentProgressRow[];
  loading: boolean;
  componentsFor: (operationId: string, colorwayId?: string | null, size?: string) => FabricCutQtyComponentRow[];
}

export function useCuttingComponentProgress(
  factoryId: string | null | undefined,
  orderId: string | null | undefined,
  refreshKey?: string | number,
): UseCuttingComponentProgressResult {
  const [rows, setRows] = useState<CuttingComponentProgressRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!factoryId || !orderId) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchCuttingComponentProgressRows(factoryId, orderId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [factoryId, orderId, refreshKey]);

  const componentsFor = useMemo(
    () => (operationId: string, colorwayId?: string | null, size?: string) =>
      cuttingComponentsForOperation(rows, operationId, colorwayId, size),
    [rows],
  );

  return useMemo(
    () => ({ rows, loading, componentsFor }),
    [rows, loading, componentsFor],
  );
}
