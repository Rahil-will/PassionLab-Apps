import React, { useMemo } from 'react';
import {
  ArrowRight,
  Calendar,
  Clock,
  Droplets,
  FileText,
  Image as ImageIcon,
  Ruler,
  User,
} from 'lucide-react';
import { StatusPoint } from '../ui';
import { tokens } from '../../lib/designTokens';
import type { StyleJourneyDept, StyleJourneyReport } from '../../lib/mesReportsApi';
import { daysBetween, formatDateDDMMYYYY } from '../../lib/orderDateUtils';
import { OrderPriorityChip } from '../../lib/orderPriority';

export interface StyleOrderHeaderProps {
  journey: StyleJourneyReport;
  colorwayLabel?: string | null;
  orderQty: number;
  adjQty: number;
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[8px] font-bold uppercase text-slate-400 truncate">{label}</p>
      <div className="font-medium text-slate-800 text-[10px] mt-0.5 truncate">{children}</div>
    </div>
  );
}

const flowPillCls =
  'inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg border font-bold text-[11px] min-h-[2.25rem]';

function QtyMiniCard({
  label,
  value,
  variant = 'order',
}: {
  label: string;
  value: number;
  variant?: 'order' | 'adj';
}) {
  const isAdj = variant === 'adj';
  return (
    <div
      className={`${flowPillCls} min-w-[6.5rem] sm:min-w-[7.5rem] justify-between ${
        isAdj ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'
      }`}
    >
      <span className={`text-[8px] font-bold uppercase tracking-wide shrink-0 ${isAdj ? 'text-blue-500' : 'text-slate-400'}`}>
        {label}
      </span>
      <span className={`tabular-nums ${isAdj ? 'text-blue-700' : 'text-slate-900'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function resolveStyleReportStatus(
  order: StyleJourneyReport['order'],
  flowDepts: StyleJourneyDept[],
  shippedQty: number,
  adjQty: number,
): string {
  const raw = order.status?.trim();
  if (raw === 'Completed' || raw === 'Cancelled') return raw;
  const target = adjQty || order.adjQty || order.orderQty;
  if (target > 0 && shippedQty >= target) return 'Completed';
  const produced = flowDepts.reduce((sum, d) => sum + d.produced, 0);
  if (produced > 0) return 'In Progress';
  if (raw === 'Pending' || raw === 'Not Started' || !raw) return 'Not Started';
  return raw;
}

function statusPointType(
  status: string,
): 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'default' {
  if (status === 'In Progress') return 'primary';
  if (status === 'Completed') return 'success';
  if (status === 'Cancelled') return 'danger';
  if (status === 'Not Started' || status === 'Pending') return 'neutral';
  return 'default';
}

function productionLeadDays(flowDepts: StyleJourneyDept[]): number | null {
  const starts = flowDepts.map((d) => d.startDate).filter(Boolean) as string[];
  const ends = flowDepts.map((d) => d.endDate).filter(Boolean) as string[];
  if (starts.length === 0 || ends.length === 0) return null;
  const minStart = starts.reduce((a, b) => (a < b ? a : b));
  const maxEnd = ends.reduce((a, b) => (a > b ? a : b));
  return daysBetween(minStart, maxEnd);
}

export const StyleOrderHeader: React.FC<StyleOrderHeaderProps> = ({
  journey,
  colorwayLabel,
  orderQty,
  adjQty,
}) => {
  const { order, flowDepts, shipmentSummary } = journey;
  const visitFlow = useMemo(
    () => [...flowDepts].sort((a, b) => a.flowStep - b.flowStep),
    [flowDepts],
  );
  const displayStatus = useMemo(
    () => resolveStyleReportStatus(order, flowDepts, shipmentSummary.shippedQty, adjQty),
    [order, flowDepts, shipmentSummary.shippedQty, adjQty],
  );
  const jobCardDate = order.jobCardDate || order.orderDate;
  const orderLead =
    order.orderDate && order.deliveryDate
      ? daysBetween(order.orderDate.split('T')[0], order.deliveryDate.split('T')[0])
      : null;
  const prodLead = useMemo(() => productionLeadDays(flowDepts), [flowDepts]);

  return (
    <header className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-col lg:flex-row">
        <div className="lg:w-[200px] xl:w-[220px] shrink-0 bg-gradient-to-b from-blue-50 to-slate-50 border-b lg:border-b-0 lg:border-r border-slate-100 p-3 flex items-center justify-center">
          {order.imageUrl ? (
            <img
              src={order.imageUrl}
              alt={order.styleName}
              className="w-full h-full max-h-[200px] object-contain"
            />
          ) : (
            <div className="w-full h-full min-h-[180px] flex flex-col items-center justify-center text-blue-300">
              <ImageIcon size={40} className="opacity-40 mb-2" />
              <span className="text-[10px] font-bold uppercase">No image</span>
            </div>
          )}
        </div>

        <div className="flex-1 p-4 sm:p-5 min-w-0 flex flex-col gap-4">
          {/* Row 1 — title + meta */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Style report</p>
                <h1 className="text-xl font-bold text-slate-900 leading-tight mt-0.5 inline-flex flex-wrap items-center gap-2">
                  <span>
                    {order.styleName}
                    {colorwayLabel && (
                      <span className="text-slate-500 font-semibold text-base"> · {colorwayLabel}</span>
                    )}
                  </span>
                  <OrderPriorityChip priority={order.priority as 'critical' | 'high' | 'normal'} />
                </h1>
                <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {order.styleRef && (
                    <span className="inline-flex items-center gap-1">
                      <Ruler size={11} className="text-blue-400" />
                      {order.styleRef}
                    </span>
                  )}
                  {order.poNumber && (
                    <span className="inline-flex items-center gap-1">
                      <FileText size={11} className="text-blue-400" />
                      {order.poNumber}
                    </span>
                  )}
                  {order.buyerName && (
                    <span className="inline-flex items-center gap-1">
                      <User size={11} className="text-blue-400" />
                      {order.buyerName}
                    </span>
                  )}
                </p>
              </div>
              <StatusPoint status={displayStatus} type={statusPointType(displayStatus)} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-2.5 text-[10px] border-t border-slate-100 pt-3">
              {order.buyerName && <MetaField label="Buyer">{order.buyerName}</MetaField>}
              <MetaField label="Garment">{order.garmentType || 'Standard'}</MetaField>
              <MetaField label="Size group">{order.sizeGroupName || '—'}</MetaField>
              <MetaField label="Sewing SAM (ref)">
                <span className="tabular-nums">
                  {(order.sewingSam ?? order.sam) != null ? `${order.sewingSam ?? order.sam}m` : '—'}
                </span>
              </MetaField>
              <MetaField label="Wash">
                <span className="inline-flex items-center gap-1">
                  <Droplets size={11} className="text-blue-400 shrink-0" />
                  {order.washType || 'None'}
                </span>
              </MetaField>
              <MetaField label="Allowances">
                <span className="tabular-nums">
                  Cut {order.cuttingAllowance ?? '—'}% · Ship {order.shipmentAllowance ?? '—'}%
                </span>
              </MetaField>
              <MetaField label="Received">
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} className="text-blue-400 shrink-0" />
                  {order.orderDate ? formatDateDDMMYYYY(order.orderDate) : '—'}
                </span>
              </MetaField>
              <MetaField label="Job card">
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} className="text-blue-400 shrink-0" />
                  {jobCardDate ? formatDateDDMMYYYY(jobCardDate) : '—'}
                </span>
              </MetaField>
              <MetaField label="Delivery">
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} className="text-blue-400 shrink-0" />
                  {order.deliveryDate ? formatDateDDMMYYYY(order.deliveryDate) : '—'}
                </span>
              </MetaField>
              <MetaField label="Lead time">
                <span className="inline-flex items-center gap-1 text-blue-600 font-semibold">
                  <Clock size={11} className="shrink-0" />
                  {orderLead != null || prodLead != null
                    ? `${orderLead != null ? `${orderLead}d` : '—'} / ${prodLead != null ? `${prodLead}d` : '—'}`
                    : '—'}
                </span>
              </MetaField>
            </div>

          </div>

          {/* Row 2 — remarks | order / adj qty */}
          <div className="border-t border-slate-100 pt-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 items-stretch">
            <div className="min-w-0">
              <label
                className="font-bold text-slate-400 uppercase tracking-wider block mb-2"
                style={{ fontSize: tokens.fontSize.caption }}
              >
                Remarks
              </label>
              <p className="text-[10px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 min-h-[2.25rem]">
                {order.remarks?.trim() || '—'}
              </p>
            </div>

            <div className="shrink-0">
              <label
                className="font-bold text-slate-400 uppercase tracking-wider block mb-2"
                style={{ fontSize: tokens.fontSize.caption }}
              >
                Quantities
              </label>
              <div className="flex flex-wrap items-center gap-2.5 min-h-[2.25rem]">
                <QtyMiniCard label="Order qty" value={orderQty} variant="order" />
                <QtyMiniCard label="Adj qty" value={adjQty} variant="adj" />
              </div>
            </div>
          </div>

          {/* Row 3 — process flow full width */}
          {visitFlow.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <label
                className="font-bold text-slate-400 uppercase tracking-wider block mb-2"
                style={{ fontSize: tokens.fontSize.caption }}
              >
                Process flow
              </label>
              <div className="overflow-x-auto pb-1 no-scrollbar w-full">
                <div className="flex items-stretch gap-0 min-w-max">
                  {visitFlow.map((visit, idx) => {
                    const isLast = idx === visitFlow.length - 1;
                    const opLabel = visit.activitiesLabel || visit.deptName;
                    const showDeptSub =
                      visit.activitiesLabel != null
                      && visit.activitiesLabel.trim() !== ''
                      && visit.activitiesLabel !== visit.deptName;
                    return (
                      <div key={visit.visitId} className="flex items-center">
                        <div className="flex flex-col w-28 rounded-xl border-2 border-slate-200 bg-white overflow-hidden shadow-sm">
                          <div className="px-2 py-1 text-center text-[8px] font-bold uppercase tracking-wider bg-slate-50 text-slate-400">
                            {visit.flowStep}
                          </div>
                          <div className="px-2 py-1.5 flex flex-col gap-0.5 flex-1 min-h-[2.75rem]">
                            <div className="text-[10px] font-bold text-slate-800 leading-tight break-words">
                              {opLabel}
                            </div>
                            {showDeptSub && (
                              <div className="text-[8px] text-slate-400 leading-tight">{visit.deptName}</div>
                            )}
                          </div>
                        </div>
                        {!isLast && (
                          <ArrowRight size={12} className="text-slate-300 mx-1 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
