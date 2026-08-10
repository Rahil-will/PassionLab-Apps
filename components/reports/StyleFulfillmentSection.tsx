import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { ChevronDown, ChevronRight, ClipboardCheck, PackageX, Truck } from 'lucide-react';
import { Card } from '../ui';
import { ShipmentPlanReadOnly } from '../production/ShipmentPlanReadOnly';
import { ShipmentActualReadOnly } from '../production/ShipmentActualReadOnly';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { OrderShipmentPlan } from '../../lib/orderShipmentPlan';
import type { Colorway } from '../../types';
import {
  groupShipmentAuditsByType,
  type ShipmentAuditTypeMetrics,
} from '../../lib/fulfillmentData';
import { formatDhu, formatPct2 } from '../../lib/mesMetrics';
import { REJECTION_AUDIT_DB_VALUE } from '../../lib/supportDropdownCatalog';
import type { StyleJourneyReport } from '../../lib/mesReportsApi';
import type { FulfillmentAuditRow, FulfillmentRejectionRow } from '../../lib/fulfillmentData';

function formatDisplayDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso.split('T')[0]), 'dd MMM yyyy');
  } catch {
    return iso;
  }
}

const REJECTION_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(REJECTION_AUDIT_DB_VALUE).map(([label, value]) => [value, label]),
);

function formatRejectionStage(stage: string): string {
  const trimmed = stage.trim();
  if (!trimmed) return '—';
  return REJECTION_STAGE_LABEL[trimmed] ?? trimmed.replace(/_/g, ' ');
}

function formatRejectionReason(row: FulfillmentRejectionRow): {
  primary: string;
  secondary?: string;
} {
  const stageLabel = formatRejectionStage(row.stage).toLowerCase();
  const primary = row.reasonCode?.trim() || '—';
  const detail = row.reasonDetail?.trim();
  if (!detail) return { primary };
  const detailLower = detail.toLowerCase();
  if (detailLower === stageLabel || detailLower === row.stage.toLowerCase()) {
    return { primary };
  }
  return { primary, secondary: detail };
}

interface RejectionDateRow {
  date: string;
  dateLabel: string;
  sizes: string;
  qty: number;
}

interface RejectionStageGroup {
  stageKey: string;
  stageLabel: string;
  rows: RejectionDateRow[];
  totalQty: number;
}

interface RejectionReasonGroup {
  reasonKey: string;
  reasonLabel: string;
  stages: RejectionStageGroup[];
  totalQty: number;
}

function groupRejectionsForStyleReport(rows: FulfillmentRejectionRow[]): RejectionReasonGroup[] {
  const byCell = new Map<
    string,
    { reason: string; stage: string; date: string; sizeMap: Map<string, number> }
  >();

  for (const row of rows) {
    const reason = row.reasonCode?.trim() || '—';
    const stage = row.stage?.trim() || '—';
    const date = row.date.split('T')[0];
    const cellKey = `${reason}\0${stage}\0${date}`;
    const cell = byCell.get(cellKey) ?? {
      reason,
      stage,
      date,
      sizeMap: new Map<string, number>(),
    };
    const size = row.size?.trim() || '—';
    cell.sizeMap.set(size, (cell.sizeMap.get(size) ?? 0) + row.qty);
    byCell.set(cellKey, cell);
  }

  const reasonMap = new Map<string, Map<string, RejectionDateRow[]>>();
  for (const cell of byCell.values()) {
    const sizeEntries = [...cell.sizeMap.entries()].filter(([size]) => size !== '—');
    const sizes =
      sizeEntries.length > 0
        ? sizeEntries.map(([size, qty]) => `${size}:${qty}`).join(' · ')
        : '—';
    const qty = [...cell.sizeMap.values()].reduce((s, n) => s + n, 0);
    const stageMap = reasonMap.get(cell.reason) ?? new Map<string, RejectionDateRow[]>();
    const list = stageMap.get(cell.stage) ?? [];
    list.push({
      date: cell.date,
      dateLabel: formatDisplayDate(cell.date),
      sizes,
      qty,
    });
    stageMap.set(cell.stage, list);
    reasonMap.set(cell.reason, stageMap);
  }

  return [...reasonMap.entries()]
    .map(([reason, stageMap]) => {
      const stages = [...stageMap.entries()]
        .map(([stage, dateRows]) => ({
          stageKey: stage,
          stageLabel: formatRejectionStage(stage),
          rows: dateRows.sort((a, b) => b.date.localeCompare(a.date)),
          totalQty: dateRows.reduce((s, r) => s + r.qty, 0),
        }))
        .sort((a, b) => a.stageLabel.localeCompare(b.stageLabel));
      return {
        reasonKey: reason,
        reasonLabel: reason,
        stages,
        totalQty: stages.reduce((s, st) => s + st.totalQty, 0),
      };
    })
    .sort((a, b) => a.reasonLabel.localeCompare(b.reasonLabel));
}

function flattenRejectionsForStyleReport(rows: FulfillmentRejectionRow[]): Array<{
  reason: string;
  stageLabel: string;
  dateLabel: string;
  sizes: string;
  qty: number;
}> {
  return groupRejectionsForStyleReport(rows).flatMap((reasonGroup) =>
    reasonGroup.stages.flatMap((stageGroup) =>
      stageGroup.rows.map((row) => ({
        reason: reasonGroup.reasonLabel,
        stageLabel: stageGroup.stageLabel,
        dateLabel: row.dateLabel,
        sizes: row.sizes,
        qty: row.qty,
      })),
    ),
  );
}

function formatPct(value: number | null): string {
  return formatPct2(value);
}

function AuditResultBadge({ result }: { result: string | null }) {
  if (result === 'pass') {
    return (
      <span className="inline-flex text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
        Pass
      </span>
    );
  }
  if (result === 'fail') {
    return (
      <span className="inline-flex text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
        Fail
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}

function SummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad' | 'warn';
}) {
  const toneCls =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'bad'
        ? 'text-red-700'
        : tone === 'warn'
          ? 'text-amber-700'
          : 'text-slate-800';
  return (
    <div className="flex-1 min-w-0 px-2 py-1 text-center">
      <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wide truncate">{label}</div>
      <div className={`text-[11px] font-bold tabular-nums mt-0.5 ${toneCls}`}>{value}</div>
    </div>
  );
}

function DistributedMetricBar({
  items,
}: {
  items: Array<{ label: string; value: string; tone?: 'default' | 'good' | 'bad' | 'warn' }>;
}) {
  return (
    <div className="flex w-full items-stretch border border-slate-100 rounded-lg overflow-hidden bg-white">
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 && (
            <div className="w-px bg-slate-200 self-stretch shrink-0" aria-hidden />
          )}
          <SummaryMetric label={item.label} value={item.value} tone={item.tone} />
        </React.Fragment>
      ))}
    </div>
  );
}

function AuditTypeGroupBlock({
  group,
  expanded,
  onToggle,
}: {
  group: ShipmentAuditTypeMetrics;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-slate-50/80 transition-colors"
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-slate-400 shrink-0">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h4 className="text-[11px] font-bold text-slate-800">{group.label}</h4>
              <span className="text-[9px] text-slate-500 tabular-nums">
                {group.totalAudits} audit{group.totalAudits === 1 ? '' : 's'}
              </span>
            </div>
            <DistributedMetricBar
              items={[
                { label: 'Total audits', value: group.totalAudits.toLocaleString() },
                {
                  label: 'Passed audits',
                  value: group.passedAudits.toLocaleString(),
                  tone: 'good',
                },
                {
                  label: 'Failed audits',
                  value: group.failedAudits.toLocaleString(),
                  tone: group.failedAudits > 0 ? 'bad' : 'default',
                },
                {
                  label: 'Audit pass rate',
                  value: formatPct(group.auditPassRate),
                  tone:
                    group.auditPassRate != null && group.auditPassRate >= 95
                      ? 'good'
                      : group.auditPassRate != null && group.auditPassRate < 80
                        ? 'warn'
                        : 'default',
                },
                { label: 'Sample size', value: group.totalSample.toLocaleString() },
                {
                  label: 'Defective pcs',
                  value: group.totalDefective.toLocaleString(),
                  tone: group.totalDefective > 0 ? 'warn' : 'default',
                },
                { label: 'Defective %', value: formatPct(group.defectivePct) },
                { label: 'DHU', value: formatDhu(group.dhu) },
              ]}
            />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pt-2 pb-3 pl-9">
          <div className={`${t.wrapper} bg-white`}>
            <div className={t.scroll}>
              <table className={t.table}>
                <thead className={t.thead}>
                  <tr>
                    <th className={`${t.firstHead} text-left`}>Date</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={t.numHead}>Lot</th>
                    <th className={t.numHead}>Sample</th>
                    <th className={t.numHead}>Pass</th>
                    <th className={t.numHead}>Fail</th>
                    <th className={t.numHead}>Major</th>
                    <th className={t.numHead}>Minor</th>
                    <th className={t.numHead}>Def %</th>
                    <th className={t.numHead}>DHU</th>
                    <th className={`${t.deptHead} text-center`}>Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.sessions.map((row) => (
                    <AuditDetailRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditDetailRow({ row }: { row: FulfillmentAuditRow }) {
  const defective = row.majorFailed + row.minorFailed;
  const defectivePct = row.sampleSize > 0 ? (defective / row.sampleSize) * 100 : null;
  const dhu = row.sampleSize > 0 ? (defective / row.sampleSize) * 100 : null;

  return (
    <tr>
      <td className={`${t.firstCell} text-slate-600`}>{formatDisplayDate(row.date)}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.colorwayName || '—'}</td>
      <td className={t.numCell}>{row.lotSize}</td>
      <td className={t.numCell}>{row.sampleSize}</td>
      <td className={t.numCell}>{row.passed}</td>
      <td className={t.numCell}>{row.failed}</td>
      <td className={t.numCell}>{row.majorFailed}</td>
      <td className={t.numCell}>{row.minorFailed}</td>
      <td className={t.numCell}>{formatPct(defectivePct)}</td>
      <td className={t.numCell}>{formatDhu(dhu)}</td>
      <td className={`${t.deptCell} text-center`}>
        <AuditResultBadge result={row.result} />
      </td>
    </tr>
  );
}

export interface StyleFulfillmentSectionProps {
  journey: StyleJourneyReport;
  orderQty: number;
  adjQty: number;
  shipmentPlan?: OrderShipmentPlan;
  colorways?: Colorway[];
  colorwayId?: string | null;
  displaySizes?: string[];
  shipmentTypeOptions?: Array<{ value: string; label: string }>;
}

export const StyleFulfillmentSection: React.FC<StyleFulfillmentSectionProps> = ({
  journey,
  orderQty,
  adjQty,
  shipmentPlan,
  colorways = [],
  colorwayId = null,
  displaySizes,
  shipmentTypeOptions,
}) => {
  const { order } = journey;
  const scopedOrderQty = orderQty > 0 ? orderQty : order.orderQty;
  const scopedAdjQty = adjQty > 0 ? adjQty : order.adjQty;

  const shipmentSummary = useMemo(() => {
    const base = journey.shipmentSummary;
    return {
      ...base,
      balance: scopedAdjQty - base.shippedQty - base.rejectedQty,
    };
  }, [journey.shipmentSummary, scopedAdjQty]);
  const { audits } = shipmentSummary;
  const auditGroups = useMemo(() => groupShipmentAuditsByType(audits), [audits]);
  const rejectionRows = useMemo(
    () => flattenRejectionsForStyleReport(shipmentSummary.rejections),
    [shipmentSummary.rejections],
  );
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  const toggleType = (auditType: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(auditType)) next.delete(auditType);
      else next.add(auditType);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Card noPadding className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <ClipboardCheck size={14} className="text-blue-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
            Buyer shipment audits
          </h3>
          <span className="ml-auto text-[9px] text-slate-500 tabular-nums font-semibold">
            {audits.length} audit{audits.length === 1 ? '' : 's'}
            {auditGroups.length > 0 && (
              <span className="text-slate-400 font-normal ml-1">
                · {auditGroups.length} type{auditGroups.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </div>

        {audits.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-[10px]">No buyer shipment audits logged</div>
        ) : (
          <div>
            {auditGroups.map((group) => (
              <AuditTypeGroupBlock
                key={group.auditType}
                group={group}
                expanded={expandedTypes.has(group.auditType)}
                onToggle={() => toggleType(group.auditType)}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2 px-1">
          <PackageX size={14} className="text-blue-500" />
          <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
            Rejections
          </h2>
          <span className="ml-auto text-[9px] text-slate-500 tabular-nums font-semibold">
            {shipmentSummary.rejectedQty.toLocaleString()} pcs
          </span>
        </div>
        <p className="text-[9px] text-slate-500 mb-3 px-1 flex flex-wrap gap-3">
          <span>
            Order <strong className="text-slate-800">{scopedOrderQty.toLocaleString()}</strong>
          </span>
          <span>
            Rejected{' '}
            <strong className="text-slate-800">{shipmentSummary.rejectedQty.toLocaleString()}</strong>
          </span>
          <span>
            Balance <strong className="text-slate-800">{shipmentSummary.balance.toLocaleString()}</strong>
          </span>
        </p>
        <div className={`${t.wrapper} rounded-2xl`}>
          <div className={t.scroll}>
            <table className={t.table}>
              <thead className={t.thead}>
                <tr>
                  <th className={`${t.deptHead} text-left`}>Reason</th>
                  <th className={`${t.deptHead} text-left`}>Stage</th>
                  <th className={`${t.firstHead} text-left`}>Date</th>
                  <th className={`${t.deptHead} text-left`}>Sizes</th>
                  <th className={t.numHead}>Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rejectionRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 text-[10px]">
                      No rejections logged
                    </td>
                  </tr>
                )}
                {rejectionRows.map((row, i) => (
                  <tr key={`rej-${row.reason}-${row.stageLabel}-${row.dateLabel}-${i}`}>
                    <td className={`${t.deptCell} text-left font-medium text-slate-800`}>
                      {row.reason}
                    </td>
                    <td className={`${t.deptCell} text-left text-slate-600`}>{row.stageLabel}</td>
                    <td className={`${t.firstCell} text-slate-600`}>{row.dateLabel}</td>
                    <td className={`${t.deptCell} text-left text-[9px] text-slate-600`}>
                      {row.sizes}
                    </td>
                    <td className={t.numCell}>{row.qty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2 px-1">
          <Truck size={14} className="text-blue-500" />
          <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Shipments</h2>
        </div>

        {shipmentPlan && colorways.length > 0 && (
          <div className="mb-4">
            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-2 px-1">
              Planned
            </p>
            <ShipmentPlanReadOnly
              plan={shipmentPlan}
              colorways={colorways}
              colorwayId={colorwayId ?? undefined}
              displaySizes={displaySizes}
              embedded
            />
            {shipmentPlan.lines.length === 0 && (
              <p className="text-[10px] text-slate-400 py-6 text-center">No shipment plan lines</p>
            )}
          </div>
        )}

        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-2 px-1">
            Actual
          </p>
          <p className="text-[9px] text-slate-500 mb-3 px-1 flex flex-wrap gap-3">
            <span>
              Order <strong className="text-slate-800">{scopedOrderQty.toLocaleString()}</strong>
            </span>
            <span>
              Shipped <strong className="text-slate-800">{shipmentSummary.shippedQty.toLocaleString()}</strong>
            </span>
            <span>
              Balance <strong className="text-slate-800">{shipmentSummary.balance.toLocaleString()}</strong>
            </span>
          </p>
          <ShipmentActualReadOnly
            shipments={shipmentSummary.shipments}
            colorways={colorways}
            colorwayId={colorwayId ?? undefined}
            displaySizes={displaySizes}
            shipmentTypeOptions={shipmentTypeOptions}
            embedded
          />
        </div>
      </div>
    </div>
  );
};
