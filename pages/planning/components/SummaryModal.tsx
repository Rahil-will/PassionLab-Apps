import React, { useCallback, useMemo, useRef, useState } from 'react';
import format from 'date-fns/format';
import { X, Printer, Download, AlertTriangle } from 'lucide-react';
import { Button, SelectDropdown } from '../../../components/ui';
import '../../../templates/print/planning-summary/planning-summary.print.css';
import { calculateWorkingDays, formatDisplayDate } from '../utils/planningCalculations';
import { sumSizeAdjQty, sumSizeOrderQty } from '../../../lib/colorwaySizesUtils';
import { hourlyTargetFromDaily } from '../../../lib/shiftHours';
import { referenceSewingSam } from '../../../lib/orderPriority';
import { useDataStore } from '../../../stores';
import type { PlanningRow } from '../types';
import type { Colorway } from '../../../types';
import type { DepartmentEntity, ProcessFlowStep } from '../../../types/settings';
import { isTablePlanStep } from '../../../lib/planningStepProfile';
import { buildPlanningVisitGroups, rowsForVisit, sortVisitStepsForDisplay } from '../../../lib/visitPlanning';

interface FlowStep {
    dept_id?: string;
    deptId?: string;
    dept_name?: string;
    deptName?: string;
    step_type?: string;
    visit_id?: string;
}

export interface ColorwayPlanSummary {
    colorId: string;
    colorName: string;
    colorData: Colorway;
    rows: PlanningRow[];
}

export interface SummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    flowSteps: FlowStep[];
    selectedOrder: {
        styleName?: string;
        poNumber?: string;
        buyer?: string;
        sewingSam?: number | null;
        sam?: number;
        garmentType?: string;
        image?: string;
    } | null;
    colorwayPlans: ColorwayPlanSummary[];
    assignedResources: Array<{ id: string; resourceName?: string; avgWF?: number }>;
    departments?: DepartmentEntity[];
    regularShiftHours: number;
    orderId?: string;
    deliveryDates?: string[];
}

interface VisitSummary {
    visitId: string;
    deptName: string;
    operationLabels: string[];
    /** Produce visits only — store/outsource/loading omit workforce & efficiency KPIs */
    usesKpis: boolean;
    resources: {
        name: string;
        qty: number;
        workforce: number;
        sam: number;
        startDate: string;
        endDate: string;
        workingDays: number;
        dailyTarget: number;
        hourlyTarget: number;
        efficiency: number;
        productivity: number;
        isOverplanned: boolean;
    }[];
    totalQty: number;
}

function kpiDisplay(usesKpis: boolean, formatted: string): string {
    return usesKpis ? formatted : '—';
}

function formatReferenceSamLabel(order: SummaryModalProps['selectedOrder']): string {
    const ref = referenceSewingSam(order);
    return ref > 0 ? `${ref} min` : '—';
}

function buildVisitSummaries(
    planningRows: PlanningRow[],
    flowSteps: FlowStep[],
    departments: DepartmentEntity[],
    assignedResources: SummaryModalProps['assignedResources'],
    referenceSam: number,
    regularShiftHours: number,
): VisitSummary[] {
    const regularShiftMins = regularShiftHours * 60;
    const deptById = new Map(departments.map((d) => [d.id, d]));
    const visits = buildPlanningVisitGroups(flowSteps as ProcessFlowStep[], deptById).filter((v) =>
        isTablePlanStep(v.profile),
    );

    return visits
        .map((visit) => {
            const deptRows = rowsForVisit(planningRows, visit).filter(
                (r) => r.resourceId && r.plannedQty > 0,
            );
            const operationLabels = sortVisitStepsForDisplay(visit.steps)
                .map((s) => s.operation_name || s.dept_name || '')
                .filter(Boolean);
            const resources = deptRows.map((row) => {
                const resource = assignedResources.find((r) => r.id === row.resourceId);
                const workingDays =
                    row.startDate && row.endDate ? calculateWorkingDays(row.startDate, row.endDate) : 0;
                if (!visit.usesKpis) {
                    return {
                        name: row.resourceName || resource?.resourceName || '—',
                        qty: row.plannedQty,
                        workforce: 0,
                        sam: 0,
                        startDate: row.startDate,
                        endDate: row.endDate,
                        workingDays,
                        dailyTarget: 0,
                        hourlyTarget: 0,
                        efficiency: 0,
                        productivity: 0,
                        isOverplanned: false,
                    };
                }
                const wf = row.workforce || resource?.avgWF || 1;
                const rowSam = row.sam ?? referenceSam;
                const totalMins = wf * regularShiftMins * workingDays;
                const efficiency = totalMins > 0 ? ((row.plannedQty * rowSam) / totalMins) * 100 : 0;
                const productivity = wf > 0 && workingDays > 0 ? row.plannedQty / (wf * workingDays) : 0;
                return {
                    name: row.resourceName || resource?.resourceName || '—',
                    qty: row.plannedQty,
                    workforce: wf,
                    sam: rowSam,
                    startDate: row.startDate,
                    endDate: row.endDate,
                    workingDays,
                    dailyTarget: row.dailyTarget,
                    hourlyTarget: hourlyTargetFromDaily(row.dailyTarget, regularShiftHours),
                    efficiency,
                    productivity,
                    isOverplanned: efficiency > 95,
                };
            });
            return {
                visitId: visit.visitId,
                deptName: visit.deptName,
                operationLabels,
                usesKpis: visit.usesKpis,
                resources,
                totalQty: resources.reduce((s, r) => s + r.qty, 0),
            };
        })
        .filter((v) => v.resources.length > 0);
}

function lastWorkablePlannedQty(visitSummaries: VisitSummary[]): number {
    for (let i = visitSummaries.length - 1; i >= 0; i -= 1) {
        if (visitSummaries[i].usesKpis) return visitSummaries[i].totalQty;
    }
    if (visitSummaries.length === 0) return 0;
    return visitSummaries[visitSummaries.length - 1].totalQty;
}

const ColorwaySummaryBlock: React.FC<{
    plan: ColorwayPlanSummary;
    flowSteps: FlowStep[];
    departments: DepartmentEntity[];
    assignedResources: SummaryModalProps['assignedResources'];
    regularShiftHours: number;
    referenceSam: number;
    highlighted: boolean;
    remarks: string;
    saveState: 'idle' | 'saving' | 'saved' | 'error';
    onRemarksChange: (value: string) => void;
}> = ({
    plan,
    flowSteps,
    departments,
    assignedResources,
    regularShiftHours,
    referenceSam,
    highlighted,
    remarks,
    saveState,
    onRemarksChange,
}) => {
    const visitSummaries = useMemo(
        () => buildVisitSummaries(plan.rows, flowSteps, departments, assignedResources, referenceSam, regularShiftHours),
        [plan.rows, flowSteps, departments, assignedResources, referenceSam, regularShiftHours],
    );
    const overplanned = visitSummaries.flatMap((v) =>
        v.usesKpis
            ? v.resources.filter((r) => r.isOverplanned).map((r) => ({ ...r, dept: v.deptName }))
            : [],
    );
    const lastDeptTotal = lastWorkablePlannedQty(visitSummaries);

    if (visitSummaries.length === 0) return null;

    return (
        <section
            className={`summary-colorway-block border rounded-xl overflow-hidden transition-shadow ${
                highlighted
                    ? 'border-emerald-400 ring-2 ring-emerald-100 shadow-md'
                    : 'border-slate-200'
            }`}
            data-colorway-id={plan.colorId}
        >
            <div className={`px-4 py-3 border-b flex items-center justify-between print-hide ${highlighted ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                <div>
                    <p className="text-xs font-bold text-slate-800">{plan.colorName}</p>
                    <p className="text-[10px] text-slate-500">
                        Adj qty {(sumSizeAdjQty(plan.colorData?.sizes || []) || sumSizeOrderQty(plan.colorData?.sizes || [])).toLocaleString()} pcs
                    </p>
                </div>
                {highlighted && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 bg-white px-2 py-0.5 rounded-full border border-emerald-200 no-print">
                        Selected
                    </span>
                )}
            </div>

            {overplanned.length > 0 && (
                <div className="bg-red-50 border-b border-red-100 px-4 py-2 text-[10px] text-red-700">
                    <div className="flex items-center gap-1.5 font-bold mb-1">
                        <AlertTriangle size={12} />
                        Overplanning Alert
                    </div>
                    {overplanned.map((r, i) => (
                        <div key={i} className="flex justify-between">
                            <span>{r.dept} → {r.name}</span>
                            <span className="font-bold">{r.efficiency.toFixed(1)}% efficiency</span>
                        </div>
                    ))}
                </div>
            )}

            <h3 className="print-only mes-report-colorway-head">
                {plan.colorName} — Adj qty {(sumSizeAdjQty(plan.colorData?.sizes || []) || sumSizeOrderQty(plan.colorData?.sizes || [])).toLocaleString()} pcs
            </h3>

            <div className="summary-table-wrap overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                    <thead>
                        <tr className="bg-slate-100">
                            <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-r border-slate-200">Visit / Dept</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-r border-slate-200">Operations</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-r border-slate-200">Resource</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">WF</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">SAM</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">Start</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">End</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-600 border-b border-r border-slate-200">Qty</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">Days</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">Daily</th>
                            <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-r border-slate-200">Hourly</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-600 border-b border-r border-slate-200">Eff%</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-600 border-b border-slate-200">Prod</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visitSummaries.map((visit, vi) =>
                            visit.resources.map((res, ri) => (
                                <tr key={`${visit.visitId}-${ri}`} className={res.isOverplanned ? 'bg-red-50' : ri % 2 ? 'bg-slate-50/40' : 'bg-white'}>
                                    {ri === 0 && (
                                        <td rowSpan={visit.resources.length} className="px-3 py-2 font-semibold border-r border-b border-slate-100 align-top text-slate-800">
                                            {visit.deptName}
                                        </td>
                                    )}
                                    {ri === 0 && (
                                        <td rowSpan={visit.resources.length} className="px-3 py-2 border-r border-b border-slate-100 align-top">
                                            <ul className="text-[9px] font-normal text-slate-500 space-y-0.5 list-none m-0 p-0">
                                                {visit.operationLabels.map((label) => (
                                                    <li key={label}>{label}</li>
                                                ))}
                                            </ul>
                                        </td>
                                    )}
                                    <td className="px-3 py-2 border-r border-b border-slate-100">{res.name}</td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100">
                                        {kpiDisplay(visit.usesKpis, String(res.workforce))}
                                    </td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100 font-medium text-slate-800">
                                        {kpiDisplay(visit.usesKpis, res.sam > 0 ? String(res.sam) : '—')}
                                    </td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100 whitespace-nowrap text-[10px]">
                                        {formatDisplayDate(res.startDate)}
                                    </td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100 whitespace-nowrap text-[10px]">
                                        {formatDisplayDate(res.endDate)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-blue-700 border-r border-b border-slate-100">
                                        {res.qty.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100">{res.workingDays}</td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100">
                                        {kpiDisplay(visit.usesKpis, String(res.dailyTarget))}
                                    </td>
                                    <td className="px-3 py-2 text-center border-r border-b border-slate-100 text-violet-700 font-medium">
                                        {kpiDisplay(
                                            visit.usesKpis,
                                            res.hourlyTarget > 0 ? String(res.hourlyTarget) : '—',
                                        )}
                                    </td>
                                    <td
                                        className={`px-3 py-2 text-right border-r border-b border-slate-100 ${
                                            visit.usesKpis && res.isOverplanned ? 'text-red-600 font-bold' : ''
                                        }`}
                                    >
                                        {kpiDisplay(visit.usesKpis, `${res.efficiency.toFixed(1)}%`)}
                                    </td>
                                    <td className="px-3 py-2 text-right border-b border-slate-100">
                                        {kpiDisplay(visit.usesKpis, res.productivity.toFixed(1))}
                                    </td>
                                </tr>
                            )),
                        )}
                    </tbody>
                    <tfoot>
                        <tr className="bg-blue-50 border-t-2 border-slate-300 font-bold">
                            <td className="px-3 py-2" colSpan={7}>Total Planned (Last Dept Output)</td>
                            <td className="px-3 py-2 text-right text-blue-700">{lastDeptTotal.toLocaleString()}</td>
                            <td colSpan={5} />
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div className="border-t border-slate-200 px-4 py-3 bg-white">
                <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">Remarks — {plan.colorName}</div>
                    <span className="text-[9px] text-slate-400 no-print">
                        {saveState === 'saving' && 'Saving…'}
                        {saveState === 'saved' && 'Saved'}
                        {saveState === 'error' && 'Save failed'}
                    </span>
                </div>
                <textarea
                    value={remarks}
                    onChange={(e) => onRemarksChange(e.target.value)}
                    placeholder={`Planning notes for ${plan.colorName}…`}
                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none resize-none screen-remarks-input"
                    rows={2}
                />
                <p className="print-only-remarks mt-2 text-xs text-slate-700 whitespace-pre-wrap">{remarks}</p>
            </div>
        </section>
    );
};

const REMARKS_DEBOUNCE_MS = 600;

export const SummaryModal: React.FC<SummaryModalProps> = ({
    isOpen,
    onClose,
    flowSteps,
    selectedOrder,
    colorwayPlans,
    assignedResources,
    departments = [],
    regularShiftHours,
    orderId,
    deliveryDates,
}) => {
    const deliveryDateDisplay = deliveryDates && deliveryDates.length > 0
        ? deliveryDates.slice().sort().join(', ')
        : '—';
    const updateColorwayPlanningRemarks = useDataStore((s) => s.updateColorwayPlanningRemarks);
    const [printColorId, setPrintColorId] = useState('all');
    const [remarksByColorId, setRemarksByColorId] = useState<Record<string, string>>({});
    const [saveStateByColorId, setSaveStateByColorId] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
    const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const plansWithData = useMemo(
        () => colorwayPlans.filter((p) => p.rows.some((r) => r.resourceId && r.plannedQty > 0)),
        [colorwayPlans],
    );

    const referenceSamLabel = formatReferenceSamLabel(selectedOrder);
    const referenceSam = referenceSewingSam(selectedOrder);

    React.useEffect(() => {
        if (!isOpen) return;
        const initial: Record<string, string> = {};
        for (const p of plansWithData) {
            initial[p.colorId] = p.colorData.planningRemarks ?? '';
        }
        setRemarksByColorId(initial);
        setSaveStateByColorId({});
        setPrintColorId(plansWithData.length === 1 ? plansWithData[0].colorId : 'all');
    }, [isOpen, plansWithData]);

    const persistRemarks = useCallback(
        async (colorwayId: string, remarks: string) => {
            if (!orderId) return;
            setSaveStateByColorId((prev) => ({ ...prev, [colorwayId]: 'saving' }));
            try {
                await updateColorwayPlanningRemarks(colorwayId, orderId, remarks);
                setSaveStateByColorId((prev) => ({ ...prev, [colorwayId]: 'saved' }));
            } catch {
                setSaveStateByColorId((prev) => ({ ...prev, [colorwayId]: 'error' }));
            }
        },
        [orderId, updateColorwayPlanningRemarks],
    );

    const handleRemarksChange = useCallback(
        (colorwayId: string, value: string) => {
            setRemarksByColorId((prev) => ({ ...prev, [colorwayId]: value }));
            setSaveStateByColorId((prev) => ({ ...prev, [colorwayId]: 'idle' }));
            const existing = debounceTimers.current[colorwayId];
            if (existing) clearTimeout(existing);
            debounceTimers.current[colorwayId] = setTimeout(() => {
                void persistRemarks(colorwayId, value);
            }, REMARKS_DEBOUNCE_MS);
        },
        [persistRemarks],
    );

    React.useEffect(() => {
        return () => {
            for (const timer of Object.values(debounceTimers.current)) {
                clearTimeout(timer);
            }
        };
    }, []);

    const dropdownOptions = useMemo(
        () => [
            { value: 'all', label: 'All colorways' },
            ...plansWithData.map((p) => ({ value: p.colorId, label: p.colorName })),
        ],
        [plansWithData],
    );

    const visiblePlans = useMemo(() => {
        if (printColorId === 'all') return plansWithData;
        return plansWithData.filter((p) => p.colorId === printColorId);
    }, [plansWithData, printColorId]);

    const headerAdjQty = useMemo(
        () =>
            visiblePlans.reduce(
                (sum, p) => sum + (sumSizeAdjQty(p.colorData?.sizes || []) || sumSizeOrderQty(p.colorData?.sizes || [])),
                0,
            ),
        [visiblePlans],
    );

    const handlePrint = () => {
        window.print();
    };

    const printMeta = format(new Date(), 'dd/MM/yyyy, HH:mm');
    const planningDate = format(new Date(), 'dd/MM/yyyy');

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 summary-modal-overlay"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/50 no-print" aria-hidden />
            <div
                id="planning-summary-print-root"
                className="mes-report relative bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="print-only">
                    <header className="mes-report-header">
                        <div>
                            <div className="mes-report-logo">PRODIGI</div>
                            <div className="mes-report-logo-sub">Textile Manufacturing</div>
                        </div>
                        <div className="mes-report-title-block">
                            <h1 className="mes-report-title">PRODUCTION PLANNING REPORT</h1>
                            <div className="mes-report-meta">
                                Report Date: {printMeta}
                                <br />
                                Planning Date: {planningDate}
                            </div>
                        </div>
                    </header>

                    <div className="mes-report-product-grid mes-report-section">
                        <div className="mes-report-thumb">
                            {selectedOrder?.image ? (
                                <img src={selectedOrder.image} alt="" className="max-w-full max-h-full object-contain" />
                            ) : (
                                'IMG'
                            )}
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Style</div>
                            <div className="mes-report-kv-value">{selectedOrder?.styleName ?? '—'}</div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">PO</div>
                            <div className="mes-report-kv-value">{selectedOrder?.poNumber ?? '—'}</div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Buyer</div>
                            <div className="mes-report-kv-value">{selectedOrder?.buyer || '—'}</div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Reference SAM</div>
                            <div className="mes-report-kv-value">{referenceSamLabel}</div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Garment</div>
                            <div className="mes-report-kv-value">{selectedOrder?.garmentType || '—'}</div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Colourway</div>
                            <div className="mes-report-kv-value">
                                {printColorId === 'all' ? 'All colorways' : plansWithData.find((p) => p.colorId === printColorId)?.colorName ?? '—'}
                            </div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Adj Qty</div>
                            <div className="mes-report-kv-value">{headerAdjQty.toLocaleString()} pcs</div>
                        </div>
                        <div className="mes-report-kv">
                            <div className="mes-report-kv-label">Delivery</div>
                            <div className="mes-report-kv-value">{deliveryDateDisplay}</div>
                        </div>
                    </div>
                </div>
                <div className="px-6 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-50 no-print shrink-0">
                    <h3 className="text-sm font-bold text-slate-900">Production Planning Summary</h3>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" icon={Download} onClick={handlePrint}>PDF</Button>
                        <Button size="sm" variant="secondary" icon={Printer} onClick={handlePrint}>Print</Button>
                        <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="summary-scroll-area flex-1 overflow-y-auto p-6 space-y-4 text-[11px]">
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 no-print flex flex-wrap items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Print colorway</span>
                        <SelectDropdown
                            value={printColorId}
                            onChange={setPrintColorId}
                            options={dropdownOptions}
                            className="w-52"
                        />
                        <span className="text-[10px] text-slate-400">
                            {visiblePlans.length} colorway{visiblePlans.length === 1 ? '' : 's'} in view
                        </span>
                    </div>

                    <div className="summary-header-card print-hide flex gap-4 border border-slate-200 rounded-lg p-4 bg-white">
                        <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden shrink-0 border border-slate-200">
                            {selectedOrder?.image ? (
                                <img src={selectedOrder.image} alt="Style" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-[9px] text-slate-400">No Image</span>
                            )}
                        </div>
                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Style</span>
                                <span className="font-bold text-slate-800">{selectedOrder?.styleName}</span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">PO</span>
                                <span className="font-bold text-slate-800">{selectedOrder?.poNumber}</span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Buyer</span>
                                <span className="font-bold text-slate-800">{selectedOrder?.buyer || '—'}</span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Delivery</span>
                                <span className="font-bold text-blue-700">{deliveryDateDisplay}</span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Reference SAM</span>
                                <span className="font-bold text-slate-800">{referenceSamLabel}</span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Garment</span>
                                <span className="font-bold text-slate-800">{selectedOrder?.garmentType || '—'}</span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Colorway</span>
                                <span className="font-bold text-slate-800">
                                    {printColorId === 'all' ? 'All colorways' : plansWithData.find((p) => p.colorId === printColorId)?.colorName ?? '—'}
                                </span>
                            </div>
                            <div>
                                <span className="text-[9px] text-slate-400 uppercase block">Adj Qty</span>
                                <span className="font-bold text-blue-700">{headerAdjQty.toLocaleString()} pcs</span>
                            </div>
                        </div>
                    </div>

                    {plansWithData.length === 0 && (
                        <p className="text-center text-slate-400 py-12">No planning data for any colorway.</p>
                    )}

                    {visiblePlans.map((plan) => (
                        <ColorwaySummaryBlock
                            key={plan.colorId}
                            plan={plan}
                            flowSteps={flowSteps}
                            departments={departments}
                            assignedResources={assignedResources}
                            regularShiftHours={regularShiftHours}
                            referenceSam={referenceSam}
                            highlighted={printColorId !== 'all' && printColorId === plan.colorId}
                            remarks={remarksByColorId[plan.colorId] ?? ''}
                            saveState={saveStateByColorId[plan.colorId] ?? 'idle'}
                            onRemarksChange={(value) => handleRemarksChange(plan.colorId, value)}
                        />
                    ))}

                    <footer className="print-only mes-report-footer">
                        <span>Prepared By: Planning Team</span>
                        <span>Page 1 of 1</span>
                    </footer>
                </div>
            </div>
        </div>
    );
};
