import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOrdersList,
  fetchOrdersPipelinePage,
  mapOrdersPipelinePageRows,
  type OrderListRow,
} from './useOrdersList';

const rpcMock = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    })),
  },
}));

const baseRow: OrderListRow = {
  id: 'order-1',
  style_name: 'Style A',
  style_ref: 'REF-1',
  po_number: 'PO-1',
  buyer_name: 'Buyer',
  buyer_id: 'buyer-1',
  status: 'In Progress',
  order_qty: 100,
  adj_qty: 100,
  created_at: '2026-01-01T00:00:00Z',
  image_url: null,
  season: null,
  priority: 'normal',
};

describe('mapOrdersPipelinePageRows', () => {
  it('maps total_count from first row and strips it from list rows', () => {
    const result = mapOrdersPipelinePageRows(
      [{ ...baseRow, total_count: 42 }],
      2,
      20,
    );
    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.rows).toEqual([baseRow]);
  });

  it('returns zero total for empty RPC pages', () => {
    expect(mapOrdersPipelinePageRows([], 1, 20).total).toBe(0);
  });
});

describe('fetchOrdersPipelinePage', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls get_orders_pipeline_page with pipeline status before pagination params', async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...baseRow, total_count: 100 }],
      error: null,
    });

    const result = await fetchOrdersPipelinePage('factory-1', 3, 20, {
      pipelineStatus: 'Delayed',
      search: 'PO-9',
      buyerId: 'buyer-9',
    });

    expect(rpcMock).toHaveBeenCalledWith('get_orders_pipeline_page', {
      p_factory_id: 'factory-1',
      p_pipeline_status: 'Delayed',
      p_page: 3,
      p_page_size: 20,
      p_search: 'PO-9',
      p_buyer_id: 'buyer-9',
    });
    expect(result.total).toBe(100);
    expect(result.rows).toHaveLength(1);
  });

  it('returns zero matches when RPC returns no rows', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await fetchOrdersPipelinePage('factory-1', 1, 20, {
      pipelineStatus: 'Active',
    });

    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('preserves pagination metadata for page 2 of delayed orders', async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...baseRow, id: 'order-21', total_count: 100 }],
      error: null,
    });

    const result = await fetchOrdersPipelinePage('factory-1', 2, 20, {
      pipelineStatus: 'Delayed',
    });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(100);
    expect(result.rows[0]?.id).toBe('order-21');
  });

  it('passes each pipeline status value through to RPC', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    for (const status of ['Active', 'Completed', 'Delayed'] as const) {
      await fetchOrdersPipelinePage('factory-1', 1, 20, { pipelineStatus: status });
      expect(rpcMock).toHaveBeenLastCalledWith(
        'get_orders_pipeline_page',
        expect.objectContaining({ p_pipeline_status: status }),
      );
    }
  });
});

describe('fetchOrdersList pipeline routing', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  it('uses pipeline RPC when pipelineStatus filter is set', async () => {
    await fetchOrdersList('factory-1', 1, 20, {
      pipelineStatus: 'Active',
      buyerId: 'buyer-1',
      search: 'style',
    });

    expect(rpcMock).toHaveBeenCalledWith(
      'get_orders_pipeline_page',
      expect.objectContaining({
        p_pipeline_status: 'Active',
        p_buyer_id: 'buyer-1',
        p_search: 'style',
      }),
    );
  });
});
