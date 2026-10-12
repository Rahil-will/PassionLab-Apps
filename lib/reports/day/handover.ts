import {
  handoverDbToDisplay,
  handoverDisplayLabel,
  handoverQtyGap,
} from '../../handoverStatus';
import { fetchHandoverReport, type HandoverReportRow } from '../../transactionReportApi';
import { resolveOrderMap } from '../reportMeta';
import type { ColorwayLabel, ReportMeta, ReportOrderSummary } from '../reportMeta';
import type {
  DayDeptReceivedRow,
  DayDeptSentRow,
  DayHandoverSummary,
} from './types';

export { handoverDisplayLabel as dayHandoverStatusLabel, handoverDbToDisplay };

function mergeMissingInTransit(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function summarizeHandoverRows(
  inbound: HandoverReportRow[],
  outbound: HandoverReportRow[],
  orderMap: Map<string, ReportOrderSummary>,
): DayHandoverSummary {

  const receivedMap = new Map<string, DayDeptReceivedRow>();
  for (const row of inbound) {
    const rpcStatus = row.status || 'pending';
    const rowStatus = handoverDbToDisplay(rpcStatus);
    const sentQty = row.sentQty || 0;
    const receivedQty = row.receivedQty ?? 0;
    const missingInTransit =
      row.missingInTransit ?? handoverQtyGap(row.sentQty, row.receivedQty, row.status);
    if (sentQty <= 0 && receivedQty <= 0) continue;
    const fromDepartmentName = row.fromDepartmentName || '—';
    const operationName = row.fromProduceOperationNames || '—';
    const order = orderMap.get(row.orderId);
    const styleName = row.styleName || order?.styleName || '—';
    const buyerName = order?.buyerName || '—';
    const poNumber = row.poNumber || order?.poNumber || '—';
    const colorName = row.colorwayName || row.colorCode || '—';
    const key = `${fromDepartmentName}|${operationName}|${styleName}|${buyerName}|${poNumber}|${colorName}|${rowStatus}`;
    const existing = receivedMap.get(key);
    if (existing) {
      existing.sentQty += sentQty;
      existing.receivedQty += receivedQty;
      existing.missingInTransit = mergeMissingInTransit(existing.missingInTransit, missingInTransit);
    } else {
      receivedMap.set(key, {
        fromDepartmentName,
        styleName,
        buyerName,
        poNumber,
        operationName,
        colorName,
        sentQty,
        receivedQty,
        missingInTransit,
        status: rowStatus,
      });
    }
  }

  const sentMap = new Map<string, DayDeptSentRow>();
  for (const row of outbound) {
    const rpcStatus = row.status || 'pending';
    const rowStatus = handoverDbToDisplay(rpcStatus);
    const sentQty = row.sentQty || 0;
    const receivedQty = row.receivedQty ?? 0;
    const missingInTransit =
      row.missingInTransit ?? handoverQtyGap(row.sentQty, row.receivedQty, row.status);
    if (sentQty <= 0) continue;
    const toDepartmentName = row.toDepartmentName || '—';
    const operationName = row.toProduceOperationNames || '—';
    const order = orderMap.get(row.orderId);
    const styleName = row.styleName || order?.styleName || '—';
    const buyerName = order?.buyerName || '—';
    const poNumber = row.poNumber || order?.poNumber || '—';
    const colorName = row.colorwayName || row.colorCode || '—';
    const key = `${toDepartmentName}|${operationName}|${styleName}|${buyerName}|${poNumber}|${colorName}|${rowStatus}`;
    const existing = sentMap.get(key);
    if (existing) {
      existing.sentQty += sentQty;
      existing.receivedQty += receivedQty;
      existing.missingInTransit = mergeMissingInTransit(existing.missingInTransit, missingInTransit);
    } else {
      sentMap.set(key, {
        toDepartmentName,
        styleName,
        buyerName,
        poNumber,
        operationName,
        colorName,
        sentQty,
        receivedQty,
        missingInTransit,
        status: rowStatus,
      });
    }
  }

  return {
    received: [...receivedMap.values()].sort(
      (a, b) =>
        a.fromDepartmentName.localeCompare(b.fromDepartmentName) ||
        a.styleName.localeCompare(b.styleName),
    ),
    sent: [...sentMap.values()].sort(
      (a, b) =>
        a.styleName.localeCompare(b.styleName) ||
        a.toDepartmentName.localeCompare(b.toDepartmentName),
    ),
  };
}

/** Handovers in/out of one department for a day or date range (attributed by sent_at). */
export async function fetchDayDeptHandoverSummary(
  factoryId: string,
  dateFrom: string,
  departmentId: string,
  _meta: ReportMeta,
  _colorwayLabels: ColorwayLabel[],
  dateTo: string = dateFrom,
): Promise<DayHandoverSummary> {
  const range = await fetchDayDeptHandoverRange(
    factoryId,
    dateFrom,
    dateTo,
    departmentId,
    _meta,
    _colorwayLabels,
  );
  return range.handover;
}

export async function fetchDayDeptHandoverRange(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
  departmentId: string,
  _meta: ReportMeta,
  _colorwayLabels: ColorwayLabel[],
): Promise<{ handover: DayHandoverSummary; handoverByDay: Array<{ date: string; handover: DayHandoverSummary }> }> {
  const [inbound, outbound] = await Promise.all([
    fetchHandoverReport(factoryId, {
      dateFrom,
      dateTo,
      toDepartmentId: departmentId,
    }),
    fetchHandoverReport(factoryId, {
      dateFrom,
      dateTo,
      fromDepartmentId: departmentId,
    }),
  ]);

  const orderMap = await resolveOrderMap(
    factoryId,
    _meta,
    [...inbound, ...outbound].map((row) => row.orderId),
  );

  const dates = [...new Set([...inbound, ...outbound].map((row) => row.logDate).filter(Boolean))].sort();
  const handoverByDay = dates.map((date) => ({
    date,
    handover: summarizeHandoverRows(
      inbound.filter((row) => row.logDate === date),
      outbound.filter((row) => row.logDate === date),
      orderMap,
    ),
  }));

  return {
    handover: summarizeHandoverRows(inbound, outbound, orderMap),
    handoverByDay,
  };
}

export function mergeHandoverSummaries(summaries: DayHandoverSummary[]): DayHandoverSummary {
  const receivedMap = new Map<string, DayDeptReceivedRow>();
  const sentMap = new Map<string, DayDeptSentRow>();

  for (const summary of summaries) {
    for (const row of summary.received) {
      const key = `${row.fromDepartmentName}|${row.operationName}|${row.styleName}|${row.buyerName}|${row.poNumber}|${row.colorName}|${row.status}`;
      const existing = receivedMap.get(key);
      if (existing) {
        existing.sentQty += row.sentQty;
        existing.receivedQty += row.receivedQty;
        existing.missingInTransit = mergeMissingInTransit(existing.missingInTransit, row.missingInTransit);
      } else receivedMap.set(key, { ...row });
    }
    for (const row of summary.sent) {
      const key = `${row.toDepartmentName}|${row.operationName}|${row.styleName}|${row.buyerName}|${row.poNumber}|${row.colorName}|${row.status}`;
      const existing = sentMap.get(key);
      if (existing) {
        existing.sentQty += row.sentQty;
        existing.receivedQty += row.receivedQty;
        existing.missingInTransit = mergeMissingInTransit(existing.missingInTransit, row.missingInTransit);
      } else sentMap.set(key, { ...row });
    }
  }

  return {
    received: [...receivedMap.values()].sort(
      (a, b) =>
        a.fromDepartmentName.localeCompare(b.fromDepartmentName) ||
        a.styleName.localeCompare(b.styleName),
    ),
    sent: [...sentMap.values()].sort(
      (a, b) =>
        a.styleName.localeCompare(b.styleName) ||
        a.toDepartmentName.localeCompare(b.toDepartmentName),
    ),
  };
}