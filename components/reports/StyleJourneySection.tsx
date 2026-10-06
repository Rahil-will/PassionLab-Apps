import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { ChevronDown, ChevronRight, Shirt } from 'lucide-react';
import { Badge, Card } from '../ui';
import { OrderPriorityChip } from '../../lib/orderPriority';
import type { StyleJourneyDept, StyleJourneyReport } from '../../lib/mesReportsApi';
import { daysBetween } from '../../lib/orderDateUtils';
import { shipmentFlowDisplayQty } from '../../lib/orderFlowMetrics';

function formatDisplayDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso.split('T')[0]), 'dd MMM yyyy');
  } catch {
    return iso;
  }
}

function DeptStatusBadge({ status }: { status: StyleJourneyDept['status'] }) {
  if (status === 'complete') {
    return (
      <Badge variant="success" className="uppercase text-[9px] tracking-wide">
        Complete
      </Badge>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        In progress
      </span>
    );
  }
  return (
    <Badge variant="outline" className="uppercase text-[9px] tracking-wide text-slate-500">
      Not started
    </Badge>
  );
}

function FlowMetric({
  label,
  value,
  show = true,
}: {
  label: string;
  value: number;
  show?: boolean;
}) {
  if (!show) return null;
  return (
    <div className="text-center min-w-[4.5rem]">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-slate-800 tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

interface FlowDeptCardProps {
  dept: StyleJourneyDept;
  step: number;
  isFirst: boolean;
  isLast: boolean;
  adjQty: number;
  expanded: boolean;
  onToggleLines: () => void;
}

const FlowDeptCard: React.FC<FlowDeptCardProps> = ({
  dept,
  step,
  isFirst,
  isLast,
  adjQty,
  expanded,
  onToggleLines,
}) => {
  const producedLabel = dept.isQcDept ? 'Passed' : 'Produced';
  const cols = shipmentFlowDisplayQty(dept);
  const shippedOrProduced = cols.isShipment ? cols.sent : dept.produced;
  const progressPct = adjQty > 0 ? Math.min(100, (shippedOrProduced / adjQty) * 100) : 0;
  const passPct =
    dept.isQcDept && adjQty > 0 ? Math.min(100, (dept.produced / adjQty) * 100) : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
            Step {step + 1}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 uppercase">{dept.deptName}</h3>
            {dept.isQcDept && passPct != null && (
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5 tabular-nums">
                {passPct.toFixed(1)}% pass
              </span>
            )}
          </div>
        </div>
        <DeptStatusBadge status={dept.status} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 mb-4">
        <FlowMetric label="Received" value={dept.received} show={!isFirst} />
        {!isFirst && <span className="text-slate-300 hidden sm:inline">→</span>}
        <FlowMetric label={producedLabel} value={cols.produced} show={!cols.isShipment} />
        {!cols.isShipment && <span className="text-slate-300 hidden sm:inline">→</span>}
        <FlowMetric label="Sent" value={cols.sent} show={cols.isShipment || !isLast} />
        {(!isLast || cols.isShipment) && <span className="text-slate-300 hidden sm:inline">→</span>}
        <FlowMetric label="Remaining" value={dept.remaining} />
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
          <span>{producedLabel} vs order qty</span>
          <span className="tabular-nums font-semibold">{progressPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {dept.lineBreakdown.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggleLines}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-slate-800"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Lines
          </button>
          {expanded && (
            <div className="mt-2 flex flex-wrap gap-2">
              {dept.lineBreakdown.map((line) => (
                <span
                  key={line.resourceId}
                  className="text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700"
                >
                  {line.resourceName}:{' '}
                  <span className="font-semibold tabular-nums">{line.produced.toLocaleString()}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export interface StyleJourneySectionProps {
  journey: StyleJourneyReport;
}

export const StyleJourneySection: React.FC<StyleJourneySectionProps> = ({ journey }) => {
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
  const { order, flowDepts, shipmentSummary } = journey;

  const minFlowStep = useMemo(
    () => (flowDepts.length > 0 ? Math.min(...flowDepts.map((d) => d.flowStep)) : 0),
    [flowDepts],
  );
  const maxFlowStep = useMemo(
    () => (flowDepts.length > 0 ? Math.max(...flowDepts.map((d) => d.flowStep)) : 0),
    [flowDepts],
  );

  const daysToDelivery = order.deliveryDate
    ? daysBetween(format(new Date(), 'yyyy-MM-dd'), order.deliveryDate.split('T')[0])
    : null;

  const toggleLines = (visitId: string) => {
    setExpandedLines((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
            {order.imageUrl ? (
              <img src={order.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Shirt size={28} className="text-slate-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 inline-flex flex-wrap items-center gap-2">
              <span>
                {order.styleName}
                {order.garmentType && (
                  <span className="text-slate-500 font-medium"> · {order.garmentType}</span>
                )}
              </span>
              <OrderPriorityChip priority={order.priority as 'critical' | 'high' | 'normal'} />
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {order.buyerName && <span>Buyer: {order.buyerName} · </span>}
              PO: {order.poNumber || '—'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-slate-600">
              <span>
                Order: <strong className="tabular-nums">{order.orderQty.toLocaleString()}</strong> pcs
              </span>
              <span>
                Adj: <strong className="tabular-nums">{order.adjQty.toLocaleString()}</strong> pcs
              </span>
              {(order.sewingSam ?? order.sam) != null && (
                <span>
                  Sewing SAM (ref): <strong className="tabular-nums">{order.sewingSam ?? order.sam}</strong>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
              <span>Job card: {formatDisplayDate(order.jobCardDate)}</span>
              <span>Delivery: {formatDisplayDate(order.deliveryDate)}</span>
              {daysToDelivery != null && daysToDelivery > 0 && (
                <span className="text-amber-600 font-medium">{daysToDelivery} days left</span>
              )}
            </div>
            <div className="mt-3">
              <Badge variant="primary" className="uppercase text-[9px] tracking-wide">
                {order.status}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {flowDepts.map((dept, index) => (
          <FlowDeptCard
            key={dept.visitId}
            dept={dept}
            step={index}
            isFirst={dept.flowStep === minFlowStep}
            isLast={dept.flowStep === maxFlowStep}
            adjQty={order.adjQty}
            expanded={expandedLines.has(dept.visitId)}
            onToggleLines={() => toggleLines(dept.visitId)}
          />
        ))}
      </div>

      <Card noPadding className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Shipment</h3>
        </div>
        <div className="px-4 py-3 flex flex-wrap gap-4 text-xs border-b border-slate-100 bg-slate-50/40">
          <span>
            Order:{' '}
            <strong className="tabular-nums">{order.orderQty.toLocaleString()}</strong>
          </span>
          <span>
            Shipped:{' '}
            <strong className="tabular-nums">{shipmentSummary.shippedQty.toLocaleString()}</strong>
          </span>
          <span>
            Rejected:{' '}
            <strong className="tabular-nums">{shipmentSummary.rejectedQty.toLocaleString()}</strong>
          </span>
          <span>
            Balance:{' '}
            <strong className="tabular-nums">{shipmentSummary.balance.toLocaleString()}</strong>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[480px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600 sticky top-0 bg-slate-50 z-10">
                  Date
                </th>
                <th className="text-right px-4 py-2.5 font-semibold text-slate-600 sticky top-0 bg-slate-50 z-10">
                  Qty
                </th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600 sticky top-0 bg-slate-50 z-10">
                  Type
                </th>
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600 sticky top-0 bg-slate-50 z-10">
                  Invoice
                </th>
              </tr>
            </thead>
            <tbody>
              {shipmentSummary.shipments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    No shipments logged
                  </td>
                </tr>
              )}
              {shipmentSummary.shipments.map((row, i) => (
                <tr key={`${row.date}-${i}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 text-slate-600">{formatDisplayDate(row.date)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{row.qty}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.shipmentType || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.invoiceNumber || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
