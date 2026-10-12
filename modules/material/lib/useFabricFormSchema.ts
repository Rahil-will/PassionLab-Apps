import { useCallback, useEffect, useState } from 'react';
import { getFabricFormSchema, type MmFabricFormSchema } from './mmFabricRpc';

const cache = new Map<number, MmFabricFormSchema>();

export function rememberFabricFormSchema(schema: MmFabricFormSchema): void {
  cache.set(schema.schema_version, schema);
}

/** One schema for every fabric. `active === false` skips the fetch (drawer closed). */
export function useFabricFormSchema(active: boolean) {
  const [schema, setSchema] = useState<MmFabricFormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    const res = await getFabricFormSchema();
    if (res.ok === false) {
      setError(res.message);
      setSchema(null);
    } else {
      rememberFabricFormSchema(res.data);
      setSchema(res.data);
    }
    setLoading(false);
  }, [active]);

  useEffect(() => {
    if (!active) {
      setSchema(null);
      setLoading(false);
      setError(null);
      return;
    }
    void refetch();
  }, [refetch, active]);

  return { schema, loading, error, refetch };
}
