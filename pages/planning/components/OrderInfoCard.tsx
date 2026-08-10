import React from 'react';
import { ImageIcon, ChevronUp, ChevronDown } from 'lucide-react';
import type { SizeQty } from '../../../types';
import { sizeAdjQty, sizeOrderQty, sumSizeAdjQty, sumSizeOrderQty } from '../../../lib/colorwaySizesUtils';
import { OrderPriorityChip } from '../../../lib/orderPriority';

interface OrderInfoCardProps {
    selectedOrder: any;
    selectedColorData: any;
    flowSteps: any[];
    allAllocations: any[];
    planningTotals: { targetTotal: number; plannedTotal: number; remainingTotal: number };
    departments: any[];
    assignedResources: any[];
    processFlows: any[];
    selectedColor: string;
    onColorSelect: (colorName: string) => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
    onStyleClick?: () => void;
    toolbar?: React.ReactNode;
    /** When true, only the top meta row is rendered (body hidden regardless of isCollapsed) */
    metaOnly?: boolean;
    /** When true, only the colorway body is rendered (meta row hidden) */
    bodyOnly?: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function cwDotColor(name: string): string {
    const l = name.toLowerCase();
    if (l.includes('green'))                      return '#4caf50';
    if (l.includes('navy') || l.includes('blue')) return '#1565c0';
    if (l.includes('red'))                        return '#c62828';
    if (l.includes('white'))                      return '#e0e0e0';
    if (l.includes('black'))                      return '#212121';
    if (l.includes('yellow'))                     return '#f9a825';
    if (l.includes('orange'))                     return '#e65100';
    if (l.includes('purple'))                     return '#6a1b9a';
    return '#9e9e9e';
}

function cwBadgeTw(name: string): string {
    const l = name.toLowerCase();
    if (l.includes('green'))
        return 'text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300';
    if (l.includes('navy') || l.includes('blue'))
        return 'text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-300';
    if (l.includes('red'))
        return 'text-[10px] px-1.5 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-300';
    return 'text-[10px] px-1.5 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-300';
}

function sizeColumnsFromColor(colorData: { sizes?: SizeQty[] } | null): string[] {
    const fromData = (colorData?.sizes || [])
        .map((s) => s.size)
        .filter((s): s is string => Boolean(s));
    return fromData.length > 0 ? fromData : ['S', 'M', 'L', 'XL'];
}

// ─── component ────────────────────────────────────────────────────────────────
export const OrderInfoCard: React.FC<OrderInfoCardProps> = ({
    selectedOrder,
    selectedColorData,
    flowSteps,
    allAllocations,
    planningTotals,
    departments,
    assignedResources,
    processFlows,
    selectedColor,
    onColorSelect,
    isCollapsed = false,
    onToggleCollapse,
    onStyleClick,
    toolbar,
    metaOnly = false,
    bodyOnly = false,
}) => {
    const lastStep     = flowSteps.length > 0 ? flowSteps[flowSteps.length - 1] : null;
    const lastDeptName = lastStep ? (lastStep.dept_name || lastStep.deptName || lastStep) : null;
    const lastDeptId   = lastStep ? (lastStep.dept_id   || lastStep.deptId)               : null;

    const getDeptAllocs = (colorId: string, deptId: any, deptName: string) =>
        allAllocations.filter((a: any) => {
            if ((a.colorwayId || a.orderId) !== colorId) return false;
            const allocDeptId = a.operationId ? flowSteps.find((s: any) => s.id === a.operationId)?.dept_id : undefined;
            if (allocDeptId) {
                if (deptId && allocDeptId === deptId) return true;
                const dept = departments.find((d: any) => d.id === allocDeptId);
                return dept?.name === deptName;
            }
            const line = assignedResources.find((l: any) => l.id === a.lineId);
            return line && (line.departmentId === deptId || line.departmentName === deptName);
        });

    const sizeColumns = sizeColumnsFromColor(selectedColorData);

    const deliveryFormatted = selectedOrder.deliveryDate
        ? new Date(selectedOrder.deliveryDate)
              .toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })
              .split('/').reverse().join('-')
        : '—';

    return (
        <div className={`bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm${bodyOnly ? '' : ' mb-6'}`}>

            {/* ── Meta row ──────────────────────────────────────────────── */}
            {!bodyOnly && <div className="flex items-center gap-5 px-5 py-3.5 border-b border-slate-200 flex-wrap bg-white">
                {[
                    { label: 'Style',        value: selectedOrder.styleName,                                              blue: false },
                    { label: 'PO',           value: selectedOrder.poNumber,                                               blue: false },
                    { label: 'Ref',          value: selectedOrder.referenceNumber || '1',                                 blue: false },
                    { label: 'Buyer',        value: selectedOrder.buyer || selectedOrder.buyerName || '-',                 blue: false },
                    { label: 'Delivery',     value: deliveryFormatted,                                                    blue: true  },
                    { label: 'Sewing SAM',   value: selectedOrder.sewingSam ?? selectedOrder.sam ? `${selectedOrder.sewingSam ?? selectedOrder.sam} min (ref)` : '—', blue: false },
                    { label: 'Garment',      value: selectedOrder.garmentType || 'Top',                                   blue: false },
                    { label: 'Wash',         value: selectedOrder.washType || 'None',                                     blue: false },
                    { label: 'Process flow', value: processFlows.find(f => f.id === selectedOrder.processFlow)?.name || '—', blue: false },
                ].map(({ label, value, blue }, idx) => (
                    <React.Fragment key={label}>
                        <div className="flex flex-col">
                            <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">{label}</span>
                            {label === 'Style' && onStyleClick ? (
                                <button
                                    type="button"
                                    onClick={onStyleClick}
                                    className="text-[12px] font-semibold text-blue-700 hover:underline text-left inline-flex items-center gap-2 flex-wrap"
                                >
                                    <span>{value}</span>
                                    <OrderPriorityChip priority={selectedOrder.priority} />
                                </button>
                            ) : label === 'Style' ? (
                                <span className="text-[12px] font-semibold text-slate-800 inline-flex items-center gap-2 flex-wrap">
                                    <span>{value}</span>
                                    <OrderPriorityChip priority={selectedOrder.priority} />
                                </span>
                            ) : (
                                <span className={`text-[12px] font-semibold ${blue ? 'text-blue-700' : 'text-slate-800'}`}>{value}</span>
                            )}
                        </div>
                        {idx < 8 && <span className="text-slate-200 text-lg">|</span>}
                    </React.Fragment>
                ))}
                {(toolbar || onToggleCollapse) && (
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        {toolbar}
                        {onToggleCollapse && (
                            <button
                                type="button"
                                onClick={onToggleCollapse}
                                className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
                                title={isCollapsed ? 'Expand details' : 'Collapse details'}
                            >
                                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </button>
                        )}
                    </div>
                )}
            </div>}

            {/* ── Body (collapsible) ─────────────────────────────────── */}
            {!metaOnly && !isCollapsed && (
            <div className="grid grid-cols-[15%_1fr] min-h-[220px]">

                {/* Image column */}
                <div className="border-r border-slate-200 bg-slate-50 flex items-center justify-center min-h-[220px] h-full">
                    {selectedOrder.image ? (
                        <img
                            src={selectedOrder.image}
                            alt={selectedOrder.styleName}
                            className="max-h-full max-w-full object-contain"
                        />
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-10 h-10 border border-slate-200 rounded-md flex items-center justify-center bg-white text-slate-400">
                                <ImageIcon size={18} />
                            </div>
                            <span className="text-[10px] text-slate-400">No image</span>
                        </div>
                    )}
                </div>

                {/* Right column */}
                <div className="flex flex-col min-h-[220px]">

                    {/* ── Colorways ─────────────────────────────────────── */}
                    <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3 bg-white">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium whitespace-nowrap">Colorways</span>
                        <div className="flex gap-[7px] flex-wrap">
                            {(selectedOrder.colorways ?? []).map((cw: any) => {
                                const active  = selectedColor === cw.name;
                                const allocs  = getDeptAllocs(cw.id, lastDeptId, lastDeptName);
                                const planned = allocs.reduce((s: number, a: any) => s + a.qty, 0);
                                const target  = sumSizeAdjQty(cw.sizes) || sumSizeOrderQty(cw.sizes) || cw.adjQty || cw.orderQty || 0;
                                return (
                                    <button
                                        key={cw.id}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-md text-xs cursor-pointer bg-white text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50${active ? ' !border-emerald-500 !bg-emerald-50 ring-[3px] ring-emerald-500/10' : ''}`}
                                        onClick={() => onColorSelect(cw.name)}
                                    >
                                        <div className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: cwDotColor(cw.name) }} />
                                        <span className={active ? 'text-emerald-800 font-semibold' : ''}>{cw.name}</span>
                                        <span className={cwBadgeTw(cw.name)}>{planned}/{target}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Size Qty table (full width) ───── */}
                    <div className="flex flex-col flex-1 min-h-[140px]">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-5 py-3 border-b border-slate-200 bg-slate-50">
                            Size wise qty — <span className="text-slate-700 normal-case font-bold">{selectedColorData.name}</span>
                        </div>
                        <div className="flex-1 flex flex-col">
                            <table className="w-full border-collapse text-[11px] table-fixed flex-1">
                                <thead>
                                    <tr>
                                        <th className="px-4 py-2.5 text-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200 border-r border-slate-100 bg-slate-50 whitespace-nowrap">Size</th>
                                        {sizeColumns.map(sz => (
                                            <th key={sz} className="px-4 py-2.5 text-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200 border-r border-slate-100 bg-slate-50 whitespace-nowrap">{sz}</th>
                                        ))}
                                        <th className="px-4 py-2.5 text-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200 bg-slate-50 whitespace-nowrap">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td className="px-4 py-3 border-b border-slate-100 border-r border-slate-100 text-center text-slate-500 bg-white">Ord qty</td>
                                        {sizeColumns.map(sz => {
                                            const d = selectedColorData.sizes?.find((s) => s.size === sz);
                                            return <td key={sz} className="px-4 py-3 border-b border-slate-100 border-r border-slate-100 text-center text-slate-800 bg-white">{d ? sizeOrderQty(d) : 0}</td>;
                                        })}
                                        <td className="px-4 py-3 border-b border-slate-100 text-center text-slate-800 bg-white font-medium">
                                            {sumSizeOrderQty(selectedColorData.sizes)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 border-b border-slate-100 border-r border-slate-100 text-center text-slate-500 bg-white">Adj qty</td>
                                        {sizeColumns.map(sz => {
                                            const d = selectedColorData.sizes?.find((s) => s.size === sz);
                                            const adj = d ? sizeAdjQty(d) || sizeOrderQty(d) : 0;
                                            return <td key={sz} className="px-4 py-3 border-b border-slate-100 border-r border-slate-100 text-center text-blue-700 font-medium bg-white">{adj}</td>;
                                        })}
                                        <td className="px-4 py-3 border-b border-slate-100 text-center text-blue-700 font-medium bg-white">
                                            {sumSizeAdjQty(selectedColorData.sizes) || sumSizeOrderQty(selectedColorData.sizes)}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>{/* right col */}
            </div>
            )}
        </div>
    );
};
