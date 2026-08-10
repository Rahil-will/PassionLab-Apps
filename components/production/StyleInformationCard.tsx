import React from 'react';
import { Edit2, Image as ImageIcon } from 'lucide-react';
import { Button, Card, StatusPoint } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';
import { tokens } from '../../lib/designTokens';
import { formatDateDDMMYYYY } from '../../lib/orderDateUtils';
import { OrderPriorityChip } from '../../lib/orderPriority';
import { ORDER_TYPE_LABELS } from '../../types';
import type { StyleOrder } from '../../types';

export interface StyleInfoStats {
    orderQty: number;
    totalAdjusted: number;
    cutAllowancePct?: number;
    extraShipmentPct?: number;
}

interface StyleInformationCardProps {
    order: StyleOrder;
    sizeGroupName: string;
    stats: StyleInfoStats;
    onEdit?: () => void;
    colorwayName?: string;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="font-bold text-slate-400 uppercase tracking-wider block mb-1" style={{ fontSize: tokens.fontSize.caption }}>
            {label}
        </label>
        <div className="font-medium text-slate-900" style={{ fontSize: tokens.fontSize.bodySmall }}>
            {children}
        </div>
    </div>
);

export const StyleInformationCard: React.FC<StyleInformationCardProps> = ({
    order,
    sizeGroupName,
    stats,
    onEdit,
    colorwayName,
}) => {
    const jobCardDate = order.jobCardDate || order.orderDate;
    const orderTypeLabel = ORDER_TYPE_LABELS[order.orderType ?? 'new'];
    const [imageError, setImageError] = React.useState(false);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
                <Card
                    title="Style Information"
                    subtitle="Style and order details"
                    className="shadow-sm border-slate-200 h-full"
                    action={
                        <div className="flex items-center gap-4 shrink-0">
                            {order.internalOrderNo ? (
                                <div className="text-right">
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Internal order</p>
                                    <p className="text-[11px] font-bold text-slate-700 tabular-nums">{order.internalOrderNo}</p>
                                </div>
                            ) : null}
                            {onEdit ? (
                                <DesktopWriteGate>
                                    <Button variant="primary" size="sm" icon={Edit2} onClick={onEdit}>
                                        Edit Order
                                    </Button>
                                </DesktopWriteGate>
                            ) : undefined}
                        </div>
                    }
                >
                    <div className="flex flex-col gap-5">
                        {/* Row 1: Style Name · Style Ref · Order Type · PO Number */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                            <Field label="Style Name">
                                <span className="font-bold text-slate-900 inline-flex flex-wrap items-center gap-2">
                                    {order.styleName}
                                    <OrderPriorityChip priority={order.priority} />
                                    {colorwayName && (
                                        <span className="font-bold text-slate-900">· {colorwayName}</span>
                                    )}
                                </span>
                            </Field>
                            <Field label="Style Ref">{order.styleRef}</Field>
                            <Field label="Order Type">{orderTypeLabel}</Field>
                            <Field label="PO Number">{order.poNumber}</Field>
                        </div>

                        {/* Row 2: Buyer · Merchant · Product Type · Sewing SAM */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-slate-100 pt-4">
                            <Field label="Buyer">{order.buyer}</Field>
                            <Field label="Merchant">{order.merchantName || '—'}</Field>
                            <Field label="Product Type">{order.garmentType || '—'}</Field>
                            <Field label="Sewing SAM (ref)">
                                {order.sewingSam ?? order.sam ? `${order.sewingSam ?? order.sam} mins` : '—'}
                            </Field>
                        </div>

                        {/* Row 3: Size Group · Season · Order Received · Job Card Date */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-slate-100 pt-4">
                            <Field label="Size Group">{sizeGroupName}</Field>
                            <Field label="Season">{order.season || '—'}</Field>
                            <Field label="Order Received">{formatDateDDMMYYYY(order.orderDate)}</Field>
                            <Field label="Job Card Date">{formatDateDDMMYYYY(jobCardDate)}</Field>
                        </div>

                        {/* Stat cards: 4 wide */}
                        <div className="pt-4 border-t border-slate-100">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                                    <div className="text-[9px] font-bold text-slate-400 uppercase mb-0.5">Order Qty</div>
                                    <div className="text-xs font-bold text-slate-800">{stats.orderQty.toLocaleString()}</div>
                                </div>
                                <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">
                                    <div className="text-[9px] font-bold text-emerald-600 uppercase mb-0.5">Total Adjusted</div>
                                    <div className="text-xs font-bold text-emerald-800">{stats.totalAdjusted.toLocaleString()}</div>
                                </div>
                                <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                                    <div className="text-[9px] font-bold text-amber-600 uppercase mb-0.5">Cut Allowance</div>
                                    <div className="text-xs font-bold text-amber-800">
                                        {stats.cutAllowancePct != null ? `${stats.cutAllowancePct}%` : '—'}
                                    </div>
                                </div>
                                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                                    <div className="text-[9px] font-bold text-blue-600 uppercase mb-0.5">Extra Shipment</div>
                                    <div className="text-xs font-bold text-blue-800">
                                        {stats.extraShipmentPct != null ? `${stats.extraShipmentPct}%` : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100 flex flex-col md:flex-row gap-4">
                            <div className="flex-1 min-w-0">
                                <label className="font-bold text-slate-400 uppercase tracking-wider block mb-2" style={{ fontSize: tokens.fontSize.caption }}>
                                    Status
                                </label>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center min-h-[48px]">
                                    <StatusPoint status={order.status} type={order.status === 'In Progress' ? 'primary' : 'success'} />
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <div className="lg:col-span-4 h-full min-h-[20rem]">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-full flex flex-col overflow-hidden min-h-[20rem]">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
                        <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                            <ImageIcon size={14} /> Style Reference
                        </h4>
                    </div>
                    <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex-[4] bg-slate-100 relative min-h-[12rem] flex items-center justify-center overflow-hidden">
                            {order.image && !imageError ? (
                                <img src={order.image} alt="Style" className="absolute inset-0 w-full h-full object-cover" onError={() => setImageError(true)} />
                            ) : (
                                <div className="flex flex-col items-center justify-center text-slate-300">
                                    <ImageIcon size={48} className="mb-2 opacity-50" />
                                    <span className="text-xs font-bold uppercase">No Image</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-[1] min-h-[4.5rem] border-t border-slate-200 flex flex-col bg-white">
                            <label className="px-3 pt-2 text-[9px] font-bold uppercase tracking-wide text-slate-400 shrink-0">Remarks</label>
                            <p className="flex-1 px-3 pb-2 pt-1 text-slate-700 text-[11px] whitespace-pre-wrap overflow-y-auto thin-scrollbar" style={{ fontSize: tokens.fontSize.bodySmall }}>
                                {order.remarks?.trim() || 'No remarks'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
