import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';
import type { Colorway } from '../types';

export async function fetchInternalOrderNumbers(factoryId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('style_orders')
    .select('internal_order_no')
    .eq('factory_id', factoryId);
  if (error) throw error;
  return (data ?? [])
    .map((row) => (row.internal_order_no as string | null)?.trim())
    .filter((v): v is string => Boolean(v));
}

export function useInternalOrderNumbers(
  factoryId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...queryKeys.factory(factoryId ?? ''), 'internalOrderNos'] as const,
    queryFn: () => fetchInternalOrderNumbers(factoryId!),
    enabled: Boolean(factoryId && enabled),
    staleTime: 60 * 1000,
  });
}

export async function findPoNumberConflict(
  factoryId: string,
  poNumber: string,
  excludeOrderId?: string,
): Promise<{ id: string; internalOrderNo: string | null; styleName: string | null } | null> {
  const poKey = poNumber.trim();
  if (!poKey) return null;

  let query = supabase
    .from('style_orders')
    .select('id, internal_order_no, style_name')
    .eq('factory_id', factoryId)
    .ilike('po_number', poKey)
    .limit(1);

  if (excludeOrderId) {
    query = query.neq('id', excludeOrderId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    internalOrderNo: (data.internal_order_no as string) || null,
    styleName: (data.style_name as string) || null,
  };
}

export async function findOrderColorConflictDb(
  factoryId: string,
  styleName: string,
  poNumber: string,
  colorways: Colorway[],
  excludeOrderId?: string,
): Promise<string | null> {
  const styleKey = styleName.trim();
  const poKey = poNumber.trim();
  if (!styleKey || !poKey) return null;

  const colorKeys = colorways
    .map((cw) => cw.name.trim().toLowerCase())
    .filter(Boolean);
  if (colorKeys.length === 0) return null;

  let orderQuery = supabase
    .from('style_orders')
    .select('id')
    .eq('factory_id', factoryId)
    .ilike('style_name', styleKey)
    .ilike('po_number', poKey)
    .limit(1);

  if (excludeOrderId) {
    orderQuery = orderQuery.neq('id', excludeOrderId);
  }

  const { data: orderRow, error: orderError } = await orderQuery.maybeSingle();
  if (orderError) throw orderError;
  if (!orderRow) return null;

  const orderId = orderRow.id as string;
  const { data: existingColors, error: colorError } = await supabase
    .from('colorways')
    .select('name')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);

  if (colorError) throw colorError;

  for (const cw of colorways) {
    const colorKey = cw.name.trim().toLowerCase();
    if (!colorKey) continue;
    const exists = (existingColors ?? []).some(
      (existing) => (existing.name as string).trim().toLowerCase() === colorKey,
    );
    if (exists) {
      return `An order already exists with style "${styleName.trim()}", PO "${poNumber.trim()}", and color "${cw.name.trim()}". Change the PO or color name.`;
    }
  }

  return null;
}
