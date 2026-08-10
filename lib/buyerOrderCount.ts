import { supabase } from './supabase';

/** Count style_orders referencing a buyer (by id or legacy name). */
export async function countOrdersForBuyer(
  factoryId: string,
  buyerId: string,
  buyerName?: string | null,
): Promise<number> {
  let query = supabase
    .from('style_orders')
    .select('id', { count: 'exact', head: true })
    .eq('factory_id', factoryId);

  const name = buyerName?.trim();
  if (name) {
    query = query.or(`buyer_id.eq.${buyerId},buyer_name.eq.${name}`);
  } else {
    query = query.eq('buyer_id', buyerId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
