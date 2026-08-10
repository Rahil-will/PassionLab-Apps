/**
 * Shared shapes for shipment-desk fulfillment (rejections, shipments, audits).
 * Style report and Order Completion read through mesReportsApi mappers using these types.
 * Floor apps capture via mesCapture; desktop Order Completion uses desktopFulfillment RPCs.
 */

export type SizeQtyMap = Record<string, number>;

export interface FulfillmentRejectionRow {
  date: string;
  qty: number;
  size: string | null;
  stage: string;
  reasonCode: string;
  reasonDetail: string | null;
}

export interface FulfillmentShipmentRow {
  id?: string;
  colorwayId?: string | null;
  colorwayName?: string | null;
  date: string;
  qty: number;
  invoiceNumber: string | null;
  awbNumber?: string | null;
  shipmentType: string;
  destination?: string | null;
  qtyBySize: SizeQtyMap | null;
  notes?: string | null;
}

/** Row from shipment_audits / v_shipment_audits (buyer & internal QA). */
export interface FulfillmentAuditRow {
  id: string;
  date: string;
  auditType: string;
  colorwayName: string;
  lotSize: number;
  sampleSize: number;
  aqlLevel: string | null;
  passed: number;
  failed: number;
  majorFailed: number;
  minorFailed: number;
  result: string | null;
  status: string;
  notes: string | null;
}

export function parseSizeQtyMap(raw: unknown): SizeQtyMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: SizeQtyMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (!Number.isNaN(n) && n > 0) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function mapFulfillmentShipmentFromDb(
  row: Record<string, unknown>,
  colorwayNameById?: Map<string, string>,
): FulfillmentShipmentRow {
  const colorwayId = (row.colorway_id as string) || null;
  return {
    id: row.id as string | undefined,
    colorwayId,
    colorwayName: colorwayId ? colorwayNameById?.get(colorwayId) ?? null : null,
    date: String(row.shipment_date ?? ''),
    qty: Number(row.shipped_qty) || 0,
    invoiceNumber: (row.invoice_number as string) || null,
    awbNumber: (row.awb_number as string) || null,
    shipmentType: String(row.shipment_type ?? ''),
    destination: (row.destination as string) || null,
    qtyBySize: parseSizeQtyMap(row.shipped_qty_by_size),
    notes: (row.notes as string) || null,
  };
}

const SHIPMENT_AUDIT_TYPE_LABELS: Record<string, string> = {
  midline: 'Midline audit',
  internal_final: 'Internal final audit',
  shipment: 'Shipment audit',
  reaudit: 'Re-audit (buyer)',
};

const SHIPMENT_AUDIT_TYPE_ORDER = ['midline', 'internal_final', 'shipment', 'reaudit'];

export function shipmentAuditTypeLabel(auditType: string): string {
  if (!auditType) return '—';
  return (
    SHIPMENT_AUDIT_TYPE_LABELS[auditType] ??
    auditType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export interface ShipmentAuditTypeMetrics {
  auditType: string;
  label: string;
  totalAudits: number;
  passedAudits: number;
  failedAudits: number;
  auditPassRate: number | null;
  totalSample: number;
  totalDefective: number;
  defectivePct: number | null;
  dhu: number | null;
  sessions: FulfillmentAuditRow[];
}

function isAuditSessionPass(row: FulfillmentAuditRow): boolean {
  return row.result === 'pass' || (row.failed <= 0 && row.sampleSize > 0 && row.result !== 'fail');
}

export function computeShipmentAuditTypeMetrics(
  auditType: string,
  sessions: FulfillmentAuditRow[],
): ShipmentAuditTypeMetrics {
  let passedAudits = 0;
  let failedAudits = 0;
  let totalSample = 0;
  let totalDefective = 0;

  for (const row of sessions) {
    if (isAuditSessionPass(row)) passedAudits += 1;
    else failedAudits += 1;
    totalSample += row.sampleSize;
    totalDefective += row.majorFailed + row.minorFailed;
  }

  const totalAudits = sessions.length;
  const auditPassRate = totalAudits > 0 ? (passedAudits / totalAudits) * 100 : null;
  const defectivePct = totalSample > 0 ? (totalDefective / totalSample) * 100 : null;
  const dhu = totalSample > 0 ? Math.round((totalDefective / totalSample) * 100) : null;

  return {
    auditType,
    label: shipmentAuditTypeLabel(auditType),
    totalAudits,
    passedAudits,
    failedAudits,
    auditPassRate,
    totalSample,
    totalDefective,
    defectivePct,
    dhu,
    sessions: [...sessions].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function groupShipmentAuditsByType(audits: FulfillmentAuditRow[]): ShipmentAuditTypeMetrics[] {
  const byType = new Map<string, FulfillmentAuditRow[]>();
  for (const row of audits) {
    const key = row.auditType || 'unknown';
    const list = byType.get(key) ?? [];
    list.push(row);
    byType.set(key, list);
  }

  const types = [...byType.keys()].sort((a, b) => {
    const ai = SHIPMENT_AUDIT_TYPE_ORDER.indexOf(a);
    const bi = SHIPMENT_AUDIT_TYPE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  return types.map((auditType) => computeShipmentAuditTypeMetrics(auditType, byType.get(auditType)!));
}
