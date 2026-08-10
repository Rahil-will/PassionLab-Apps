/**
 * MOBILE / FLOOR ONLY — do not import from desktop routes.
 * Desktop Order Completion uses lib/desktopFulfillment.ts (log_desktop_* RPCs).
 */
import { supabase } from './supabase';
import { MesCaptureError } from './captureErrors';

export { MesCaptureError } from './captureErrors';

export async function postMesCapture(
  factoryId: string,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('floor_capture', {
    p_factory_id: factoryId,
    p_user_id: userId,
    p_type: type,
    p_payload: payload,
  });
  if (error) throw new MesCaptureError(error.message, 'RPC_ERROR');

  const result = (data || {}) as Record<string, unknown>;
  if (result.error) {
    throw new MesCaptureError(
      String(result.error),
      result.code as string | undefined,
      (result.details as Record<string, unknown>) || {},
    );
  }
  return result;
}

function requireColorwayId(colorwayId: string | null | undefined): string {
  const id = (colorwayId ?? '').trim();
  if (!id) {
    throw new MesCaptureError('Colorway is required for capture.', 'MISSING_COLORWAY');
  }
  return id;
}

/** Floor PWA shipment capture — requires shipment_log app + colorway floor status. */
export async function logShipmentCapture(
  factoryId: string,
  userId: string,
  payload: {
    orderId: string;
    colorwayId: string;
    shippedQty: number;
    shippedQtyBySize?: Record<string, number>;
    shipmentType: string;
    shipmentDate: string;
    invoiceNumber?: string;
    awbNumber?: string;
    destination?: string;
    notes?: string;
    operationId?: string;
    visitId?: string;
  },
): Promise<void> {
  await postMesCapture(factoryId, userId, 'shipment_log', {
    orderId: payload.orderId,
    colorwayId: requireColorwayId(payload.colorwayId),
    shippedQty: payload.shippedQty,
    shippedQtyBySize: payload.shippedQtyBySize ?? {},
    shipmentType: payload.shipmentType,
    shipmentDate: payload.shipmentDate,
    invoiceNumber: payload.invoiceNumber ?? '',
    awbNumber: payload.awbNumber ?? '',
    destination: payload.destination ?? '',
    notes: payload.notes ?? '',
    operationId: payload.operationId ?? '',
    visitId: payload.visitId ?? '',
    loggedAt: new Date().toISOString(),
  });
}

/** Floor PWA rejection capture — requires shipment_log app on terminal visit. */
export async function logRejectionCapture(
  factoryId: string,
  userId: string,
  payload: {
    orderId: string;
    colorwayId: string;
    size?: string;
    qty: number;
    reasonCode: string;
    reasonDetail?: string;
    stage: string;
    rejectedDate: string;
    notes?: string;
    operationId?: string;
    visitId?: string;
  },
): Promise<void> {
  await postMesCapture(factoryId, userId, 'rejection_log', {
    orderId: payload.orderId,
    colorwayId: requireColorwayId(payload.colorwayId),
    size: payload.size ?? '',
    qty: payload.qty,
    reasonCode: payload.reasonCode,
    reasonDetail: payload.reasonDetail ?? '',
    stage: payload.stage,
    rejectedDate: payload.rejectedDate,
    notes: payload.notes ?? '',
    operationId: payload.operationId ?? '',
    visitId: payload.visitId ?? '',
    loggedAt: new Date().toISOString(),
  });
}
