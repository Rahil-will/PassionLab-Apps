import { supabase } from './supabase';
import { MesCaptureError } from './captureErrors';

function parseRpcResult(data: unknown): Record<string, unknown> {
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

/** Desktop Order Completion — admin shipment log (not floor capture). */
export async function logDesktopShipment(
  factoryId: string,
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
  const { data, error } = await supabase.rpc('log_desktop_shipment', {
    p_factory_id: factoryId,
    p_payload: {
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
    },
  });
  if (error) throw new MesCaptureError(error.message, 'RPC_ERROR');
  parseRpcResult(data);
}

/** Desktop Order Completion — admin rejection log (not floor capture). */
export async function logDesktopRejection(
  factoryId: string,
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
  const { data, error } = await supabase.rpc('log_desktop_rejection', {
    p_factory_id: factoryId,
    p_payload: {
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
    },
  });
  if (error) throw new MesCaptureError(error.message, 'RPC_ERROR');
  parseRpcResult(data);
}

export async function deleteShipmentRecord(
  factoryId: string,
  shipmentId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('delete_desktop_shipment', {
    p_factory_id: factoryId,
    p_shipment_id: shipmentId,
  });
  if (error) throw new MesCaptureError(error.message, 'RPC_ERROR');
  parseRpcResult(data);
}
