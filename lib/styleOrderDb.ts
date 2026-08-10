import type { StyleOrder } from '../types';
import { normalizeSizeRow } from './colorwaySizesUtils';
import { parseOrderShipmentPlan, parseShipmentChangeHistory } from './orderShipmentPlan';
import { supabase } from './supabase';

/** Columns on `style_orders` (trimmed remote schema). */
const STYLE_ORDER_COLUMNS = [
  'factory_id',
  'style_name',
  'style_ref',
  'buyer_id',
  'buyer_name',
  'po_number',
  'order_qty',
  'adj_qty',
  'order_date',
  'garment_type',
  'sewing_sam',
  'priority',
  'size_group_name',
  'size_labels',
  'current_dept',
  'status',
  'image_url',
  'remarks',
  'job_card_date',
  'internal_order_no',
  'merchant_name',
  'order_type',
  'cutting_allowance',
  'shipment_allowance',
  'season',
] as const;

export function styleOrderToDbRow(
  order: Partial<StyleOrder>,
  factoryId: string,
  orderId?: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    factory_id: factoryId,
    style_name: order.styleName ?? null,
    style_ref: order.styleRef ?? null,
    buyer_id: order.buyerId ?? null,
    buyer_name: order.buyer ?? null,
    po_number: order.poNumber ?? '',
    order_qty: order.orderQty ?? 0,
    adj_qty: order.adjQty ?? 0,
    order_date: order.orderDate || null,
    season: order.season?.trim() || null,
    job_card_date: order.jobCardDate || order.orderDate || null,
    garment_type: order.garmentType ?? null,
    sewing_sam: order.sewingSam ?? order.sam ?? null,
    priority: order.priority ?? 'normal',
    size_group_name: order.sizeGroupName?.trim() || null,
    size_labels: order.sizeLabels?.trim() || null,
    current_dept: order.currentDept ?? 'Planned',
    status: order.status ?? 'Not Started',
    image_url: order.image || null,
    remarks: order.remarks ?? null,
    internal_order_no: order.internalOrderNo?.trim() || null,
    merchant_name: order.merchantName?.trim() || null,
    order_type: order.orderType ?? 'new',
    cutting_allowance: order.cuttingAllowance ?? null,
    shipment_allowance: order.shipmentAllowance ?? null,
  };
  if (orderId) row.id = orderId;
  return row;
}

export function colorwayToDbPayload(c: StyleOrder['colorways'][0]): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    color_code: c.colorCode ?? '',
    qty: c.orderQty ?? 0,
    adj_qty: c.adjQty ?? 0,
    sizes: c.sizes ?? [],
    planning_remarks: c.planningRemarks ?? null,
  };
}

/** Only fields present on `updates` are included (safe for PATCH-style updates). */
export function styleOrderUpdatePayload(
  updates: Partial<StyleOrder>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (updates.styleName !== undefined) row.style_name = updates.styleName ?? null;
  if (updates.styleRef !== undefined) row.style_ref = updates.styleRef ?? null;
  if (updates.buyerId !== undefined) row.buyer_id = updates.buyerId ?? null;
  if (updates.buyer !== undefined) row.buyer_name = updates.buyer ?? null;
  if (updates.poNumber !== undefined) row.po_number = updates.poNumber;
  if (updates.orderQty !== undefined) row.order_qty = updates.orderQty;
  if (updates.adjQty !== undefined) row.adj_qty = updates.adjQty;
  if (updates.orderDate !== undefined) row.order_date = updates.orderDate || null;
  if (updates.jobCardDate !== undefined) {
    row.job_card_date = updates.jobCardDate || updates.orderDate || null;
  }
  if (updates.garmentType !== undefined) row.garment_type = updates.garmentType ?? null;
  if (updates.sewingSam !== undefined) row.sewing_sam = updates.sewingSam;
  if (updates.sam !== undefined) row.sewing_sam = updates.sam;
  if (updates.priority !== undefined) row.priority = updates.priority ?? 'normal';
  if (updates.sizeGroupName !== undefined) row.size_group_name = updates.sizeGroupName?.trim() || null;
  if (updates.sizeLabels !== undefined) row.size_labels = updates.sizeLabels?.trim() || null;
  if (updates.currentDept !== undefined) row.current_dept = updates.currentDept;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.image !== undefined) row.image_url = updates.image || null;
  if (updates.remarks !== undefined) row.remarks = updates.remarks ?? null;
  if (updates.internalOrderNo !== undefined) row.internal_order_no = updates.internalOrderNo?.trim() || null;
  if (updates.merchantName !== undefined) row.merchant_name = updates.merchantName?.trim() || null;
  if (updates.orderType !== undefined) row.order_type = updates.orderType ?? 'new';
  return row;
}

export function mapStyleOrderFromDb(o: Record<string, unknown>): StyleOrder {
  const colorways = ((o.colorways as Record<string, unknown>[]) || []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    colorCode: (c.color_code as string) || '',
    orderQty: (c.qty as number) || 0,
    adjQty: (c.adj_qty as number) || 0,
    totalQty: (c.qty as number) || 0,
    sizes: ((c.sizes as StyleOrder['colorways'][0]['sizes']) || []).map(normalizeSizeRow),
    planningRemarks: (c.planning_remarks as string) || '',
    completionStatus: (c.completion_status as StyleOrder['colorways'][0]['completionStatus']) || 'ongoing',
    closedAt: (c.closed_at as string) || null,
    closeReason: (c.close_reason as string) || null,
  }));

  return {
    id: o.id as string,
    styleName: (o.style_name as string) || '',
    styleRef: (o.style_ref as string) || '',
    buyer: (o.buyer_name as string) || '',
    buyerId: (o.buyer_id as string) || undefined,
    poNumber: (o.po_number as string) || '',
    orderQty: (o.order_qty as number) || 0,
    adjQty: (o.adj_qty as number) || 0,
    totalQty: (o.order_qty as number) || 0,
    orderDate: (o.order_date as string) || '',
    season: (o.season as string) || '',
    jobCardDate: (o.job_card_date as string) || (o.order_date as string) || '',
    garmentType: (o.garment_type as string) || 'Top',
    sewingSam: o.sewing_sam != null ? Number(o.sewing_sam) : (o.sam != null ? Number(o.sam) : null),
    sam: o.sewing_sam != null ? Number(o.sewing_sam) : (o.sam != null ? Number(o.sam) : 0),
    priority: ((o.priority as StyleOrder['priority']) || 'normal'),
    sizeGroupName: (o.size_group_name as string) || '',
    sizeLabels: (o.size_labels as string) || '',
    currentDept: (o.current_dept as string) || 'Planned',
    status: (o.status as string) || 'Not Started',
    image: (o.image_url as string) || '',
    colorways,
    remarks: (o.remarks as string) || '',
    internalOrderNo: (o.internal_order_no as string) || '',
    merchantName: (o.merchant_name as string) || '',
    orderType: ((o.order_type as StyleOrder['orderType']) || 'new'),
    shipmentPlan: (() => {
      const targets = (o.delivery_targets as Record<string, unknown>[] | undefined) ?? [];
      if (targets.length === 0) return parseOrderShipmentPlan(null);
      return {
        lines: targets.map((t) => {
          const rawStatus = (t.status as string) || 'planned';
          const changeHistory = parseShipmentChangeHistory(t.change_history);
          const status =
            rawStatus === 'rescheduled'
              ? 'rescheduled'
              : rawStatus === 'replanned'
                ? 'replanned'
                : 'planned';
          return {
            id: t.id as string,
            shipmentDate: (t.target_date as string) || '',
            shipMode: (t.ship_mode as string) || '',
            shipmentType: (t.shipment_type as string) || '',
            colorwayId: (t.colorway_id as string) || '',
            sizes: (t.qty_by_size as Record<string, number>) || {},
            destinationCountry: (t.destination_country as string) || undefined,
            status,
            changeHistory,
            _dateChangeReason:
              status === 'rescheduled' && typeof t.notes === 'string' && t.notes.trim()
                ? t.notes.trim()
                : undefined,
          };
        }),
      };
    })(),
    cuttingAllowance: o.cutting_allowance != null ? Number(o.cutting_allowance) : undefined,
    shipmentAllowance: o.shipment_allowance != null ? Number(o.shipment_allowance) : undefined,
    routingSteps: ((o.routing_steps as Record<string, unknown>[] | undefined) ?? []).map((r) => ({
      id: (r.id as string) || '',
      seq: (r.seq as number) || 0,
      dept_id: (r.dept_id as string) || '',
      dept_name: (r.dept_name as string) || '',
      operation_name: (r.operation_name as string) || (r.dept_name as string) || '',
      step_type: (r.step_type as string) || 'produce',
      capture_app: (r.capture_app as string) || 'transaction',
      visit_id: (r.visit_id as string) || undefined,
      visit_no: r.visit_no != null ? Number(r.visit_no) : undefined,
      is_primary_output: r.is_primary_output != null ? Boolean(r.is_primary_output) : undefined,
      is_dept_exit_operation: r.is_dept_exit_operation != null ? Boolean(r.is_dept_exit_operation) : undefined,
    })),
  };
}

export { STYLE_ORDER_COLUMNS };

/** Delete order + all linked floor/capture rows (requires delete_style_order RPC). */
export async function deleteStyleOrder(factoryId: string, orderId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_style_order', {
    p_factory_id: factoryId,
    p_order_id: orderId,
  });
  if (error) throw error;
}
