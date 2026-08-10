import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDataStore,
  useNavigationStore,
  useNotificationStore,
} from '../../stores';
import { useDepartmentsCatalog, useProcessFlowsCatalog, useShiftsCatalog } from '../../lib/queries/settingsSlices';
import { useAssignedResources } from '../../hooks/useAssignedResources';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import {
  fetchPlanningGanttContext,
  usePlanningGanttContext,
} from '../../lib/queries/planningDetail';
import { invalidateFactoryOrders } from '../../lib/invalidateFactoryData';
import { queryKeys } from '../../lib/queryKeys';
import { RoutePath } from '../../types';
import { LineAllocation, StyleOrder } from '../../types';
import { Button, Modal, Card } from '../../components/ui';
import { DesktopWriteGate } from '../../components/DesktopWriteGate';
import type { PlanningRow } from './types';
import { X, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { PlanningToolbar } from '../../components/planning/PlanningToolbar';
import { PageShell } from '../../components/layout/PageShell';

// Import refactored components
import { ResourceAllocationSection } from './components/ResourceAllocationSection';
import { GanttAllocTooltip, type GanttAlloc } from '../../components/production/GanttResourceRows';
import { SummaryModal } from './components/SummaryModal';
import { usePlanningState } from './hooks';
import * as calc from './utils';
import { getRegularShiftHours, getRegularShiftMinutes } from '../../lib/shiftHours';
import { buildColorwayPlanPayloads } from '../../lib/buildLinePlanPayload';
import { saveLinePlanAtomic } from '../../lib/saveLinePlan';
import { sizeAdjQty, sizeOrderQty, sumSizeAdjQty, sumSizeOrderQty } from '../../lib/colorwaySizesUtils';
import { OrderPriorityChip } from '../../lib/orderPriority';
import type { ProcessFlowStep } from '../../types/settings';
import { OrderRoutingEditor, fetchOrderRoutingState } from '../../components/planning/OrderRoutingEditor';
import type { OrderRoutingStepRow } from '../../lib/orderRoutingEditor';
import { mapRoutingRowsToFlowSteps } from '../../lib/orderRoutingEditor';
import { flowTableClasses } from '../../lib/productionFlowTable';
import { swatchStyleFromColorName } from '../../lib/colorNameSwatch';
import { allocationColorwayName, allocationDepartmentId, allocationOperationNames, allocationPoNumber, allocationStyleName } from '../../lib/allocationUtils';
import type { OrderRoutingStepLike } from '../../lib/orderRoutingFlow';

import { buildPlanningVisitGroups } from '../../lib/visitPlanning';
import {
  activeShipmentDeliveryDates,
  expandShipmentPlanLines,
  primaryShipmentDate,
} from '../../lib/orderShipmentPlan';

const cellWidth = 40;
const PLANNING_TABLE_H = 'min-h-[11rem]';


function lineAllocationToGanttAlloc(
    alloc: LineAllocation,
    order?: StyleOrder | null,
    routingSteps?: OrderRoutingStepLike[],
): GanttAlloc {
    const operationNames = order
        ? allocationOperationNames(alloc, [order])
        : (() => {
            const visitId = alloc.visitId;
            if (visitId && routingSteps?.length) {
                return routingSteps
                    .filter((s) => s.visit_id === visitId)
                    .map((s) => s.operation_name || s.dept_name || '')
                    .filter(Boolean);
            }
            if (alloc.operationId && routingSteps?.length) {
                const step = routingSteps.find((s) => s.id === alloc.operationId);
                const label = step?.operation_name || step?.dept_name || '';
                return label ? [label] : [];
            }
            return [];
        })();
    const operationName = operationNames.join(' + ') || undefined;
    return {
        id: alloc.id,
        startDate: alloc.startDate,
        endDate: alloc.endDate,
        qty: alloc.qty,
        actualQty: alloc.actualQty,
        actualEndDate: alloc.actualEndDate,
        colorway: order ? allocationColorwayName(alloc, [order]) : undefined,
        styleName: order ? allocationStyleName(alloc, [order]) : undefined,
        styleRef: order?.styleRef || undefined,
        poNumber: order ? allocationPoNumber(alloc, [order]) : undefined,
        operationName,
        operationNames: operationNames.length > 0 ? operationNames : undefined,
        dailyTarget: alloc.dailyTarget,
        status: alloc.status,
    };
}

export const ProductionPlanning: React.FC = () => {
    const queryClient = useQueryClient();
    const { navigate, routeParams, goBack, setUnsaved, setPendingSaveAction, factoryId } = useNavigationStore();
    const { refreshOrderAndAllocations } = useDataStore();
    const { processFlows } = useProcessFlowsCatalog(factoryId);
    const { departments } = useDepartmentsCatalog(factoryId, 'core');
    const { shifts } = useShiftsCatalog(factoryId, 'core');
    const { showNotification } = useNotificationStore();

    // Use refactored state hook
    const state = usePlanningState();

    const TIMELINE_DAYS = 30;
    const planningViewEnd = useMemo(() => {
        const timeline = calc.generateTimelineData(state.viewStartDate, TIMELINE_DAYS);
        return timeline[timeline.length - 1]?.iso ?? state.viewStartDate;
    }, [state.viewStartDate]);

    const planningOrderId = (routeParams?.orderId ?? state.selectedOrderId) || null;
    const { order: selectedOrder, loading: orderLoading } = useOrderForEdit(factoryId, planningOrderId);
    const { data: assignedResources = [], isLoading: resourcesLoading } = useAssignedResources(factoryId);
    const { data: ganttContext, isLoading: ganttContextLoading } = usePlanningGanttContext(
        factoryId,
        planningOrderId,
        state.viewStartDate,
        planningViewEnd,
        Boolean(factoryId),
    );
    const allocations = ganttContext?.allocations ?? [];
    const ganttPeerOrders = ganttContext?.peerOrderLabels ?? [];
    const dataLoading = orderLoading || ganttContextLoading || resourcesLoading;

    const regularShiftHours = useMemo(() => getRegularShiftHours(shifts), [shifts]);
    const regularShiftMinsPerDay = useMemo(() => getRegularShiftMinutes(shifts), [shifts]);

    // planningRows holds the CURRENT color's rows for the table
    const [planningRows, setPlanningRows] = useState<PlanningRow[]>([]);
    const [planningBuffer, setPlanningBuffer] = useState<Record<string, PlanningRow[]>>({});
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState<boolean>(false);
    const [pendingColorSwitch, setPendingColorSwitch] = useState<string | null>(null);
    const [unsavedPrompt, setUnsavedPrompt] = useState<'color' | 'discard' | null>(null);
    const [saving, setSaving] = useState(false);
    const [styleDetailsCollapsed, setStyleDetailsCollapsed] = useState(false);
    const [routingLoading, setRoutingLoading] = useState(true);
    const [routingRefreshing, setRoutingRefreshing] = useState(false);
    const [routingError, setRoutingError] = useState<string | null>(null);

    // Track which colorway IDs have been modified (dirty)
    const [dirtyColorIds, setDirtyColorIds] = useState<Set<string>>(new Set());

    // Refs for stable handler references (avoids stale closures in breadcrumb buttons)
    const planningRowsRef = React.useRef(planningRows);
    planningRowsRef.current = planningRows;
    const planningBufferRef = React.useRef(planningBuffer);
    planningBufferRef.current = planningBuffer;
    const dirtyColorIdsRef = React.useRef(dirtyColorIds);
    dirtyColorIdsRef.current = dirtyColorIds;
    const selectedOrderRef = React.useRef(selectedOrder);
    selectedOrderRef.current = selectedOrder;
    const allocationsRef = React.useRef(allocations);
    allocationsRef.current = allocations;
    const assignedResourcesRef = React.useRef(assignedResources);
    assignedResourcesRef.current = assignedResources;

    // Track changes — now includes buffered changes across colors
    const hasChanges = useMemo(() => {
        return dirtyColorIds.size > 0 || state.pendingAllocations.length > 0 || state.deletedAllocationIds.length > 0;
    }, [dirtyColorIds, state.pendingAllocations, state.deletedAllocationIds]);

    useEffect(() => {
        setUnsaved(hasChanges);
    }, [hasChanges, setUnsaved]);

    const handleSavePlanRef = React.useRef<() => Promise<boolean>>(async () => false);

    // Handle route params
    useEffect(() => {
        if (routeParams?.orderId) {
            state.setSelectedOrderId(routeParams.orderId);
        }
        if (routeParams?.orderId && routeParams?.color) {
            state.setSelectedColor(routeParams.color);
        }
        if (routeParams?.orderId && routeParams?.colorId && selectedOrder) {
            const colorway = selectedOrder.colorways?.find((c) => c.id === routeParams.colorId);
            if (colorway) {
                state.setSelectedColor(colorway.name);
                if (routeParams?.openPrint === 'true') {
                    setTimeout(() => setIsSummaryModalOpen(true), 300);
                }
            }
        }
    }, [routeParams, selectedOrder]);

    // Selected color data (order comes from useOrderForEdit)
    const selectedColorData = useMemo(() => {
        if (!selectedOrder) return null;
        return selectedOrder.colorways?.find(c => c.name === state.selectedColor) || null;
    }, [selectedOrder, state.selectedColor]);

    const shipmentDeliveryDates = useMemo(() => {
        if (!selectedOrder?.shipmentPlan) return [] as string[];
        const forColor = activeShipmentDeliveryDates(
            selectedOrder.shipmentPlan,
            selectedColorData?.id,
        );
        if (forColor.length > 0) return forColor;
        const orderLevel = activeShipmentDeliveryDates(selectedOrder.shipmentPlan);
        if (orderLevel.length > 0) return orderLevel;
        const primary = primaryShipmentDate(selectedOrder.shipmentPlan);
        return primary ? [primary] : [];
    }, [selectedOrder?.shipmentPlan, selectedColorData?.id]);

    const shipmentPlanDisplayLines = useMemo(() => {
        if (!selectedOrder?.shipmentPlan?.lines?.length) return [];
        return expandShipmentPlanLines(selectedOrder.shipmentPlan.lines);
    }, [selectedOrder?.shipmentPlan?.lines]);

    // All allocations (pending + saved)
    const allAllocations = useMemo(() => {
        const saved = allocations.filter(a => !state.deletedAllocationIds.includes(a.id));
        return [...saved, ...state.pendingAllocations];
    }, [allocations, state.pendingAllocations, state.deletedAllocationIds]);

    // Planning totals
    const planningTotals = useMemo(() => {
        if (!selectedColorData) return { targetTotal: 0, plannedTotal: 0, remainingTotal: 0 };
        const targetTotal = calc.calculateTargetQty(selectedColorData.sizes);
        const plannedTotal = calc.calculatePlannedQty(allAllocations, selectedColorData.id);
        return { targetTotal, plannedTotal, remainingTotal: targetTotal - plannedTotal };
    }, [selectedColorData, allAllocations]);

    const [orderRoutingSteps, setOrderRoutingSteps] = useState<ProcessFlowStep[]>([]);
    const [savedRoutingSteps, setSavedRoutingSteps] = useState<OrderRoutingStepRow[]>([]);
    const [lockedRoutingDeptIds, setLockedRoutingDeptIds] = useState<Set<string>>(new Set());
    const orderRoutingStepsRef = React.useRef(orderRoutingSteps);
    orderRoutingStepsRef.current = orderRoutingSteps;

    useEffect(() => {
        const awaitingSync = Boolean(routeParams?.orderId) && state.selectedOrderId !== routeParams.orderId;
        if (awaitingSync) return;

        if (!state.selectedOrderId || !factoryId) {
            setOrderRoutingSteps([]);
            setSavedRoutingSteps([]);
            setLockedRoutingDeptIds(new Set());
            setRoutingError(null);
            setRoutingLoading(false);
            return;
        }
        let cancelled = false;
        const orderId = state.selectedOrderId;
        setRoutingLoading(true);
        void fetchOrderRoutingState(factoryId, orderId)
            .then(({ steps, lockedDeptIds }) => {
                if (cancelled) return;
                setRoutingError(null);
                setSavedRoutingSteps(steps);
                setLockedRoutingDeptIds(lockedDeptIds);
                setOrderRoutingSteps(mapRoutingRowsToFlowSteps(steps));
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('fetchOrderRoutingState failed:', err);
                setRoutingError(err instanceof Error ? err.message : 'Failed to load routing');
                setOrderRoutingSteps([]);
                setSavedRoutingSteps([]);
            })
            .finally(() => {
                if (!cancelled) setRoutingLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [state.selectedOrderId, factoryId, routeParams]);

    const flowSteps = useMemo(() => {
        if (routingLoading || routingError) return [];
        if (orderRoutingSteps.length > 0) return orderRoutingSteps;
        return mapRoutingRowsToFlowSteps(selectedOrder?.routingSteps ?? []);
    }, [routingLoading, routingError, orderRoutingSteps, selectedOrder?.routingSteps]);

    const deptById = useMemo(
        () => new Map(departments.map((d) => [d.id, d])),
        [departments],
    );

    const lastWorkableVisit = useMemo(() => {
        const visits = buildPlanningVisitGroups(flowSteps, deptById).filter((v) => v.profile !== 'terminal');
        return visits[visits.length - 1];
    }, [flowSteps, deptById]);

    const hasRouting = !routingLoading && flowSteps.length > 0;

    const orderPlanAllocations = useMemo(
        () => allocations.filter((a) => a.orderId === state.selectedOrderId),
        [allocations, state.selectedOrderId],
    );

    const clearPlanningForVisits = (visitIds: string[]) => {
        if (visitIds.length === 0) return;
        const drop = new Set(visitIds);
        const strip = (rows: PlanningRow[]) =>
            rows.filter((r) => !r.visitId || !drop.has(r.visitId));
        setPlanningRows((prev) => strip(prev));
        state.setPendingAllocations((prev) =>
            prev.filter((a) => !a.visitId || !drop.has(a.visitId)),
        );
        state.setDeletedAllocationIds((prev) =>
            prev.filter((id) => {
                const alloc = allocations.find((a) => a.id === id);
                return !alloc?.visitId || !drop.has(alloc.visitId);
            }),
        );
        setPlanningBuffer((prev) => {
            const next: Record<string, PlanningRow[]> = {};
            const touched = new Set<string>();
            for (const [colorId, rows] of Object.entries(prev)) {
                const stripped = strip(rows);
                if (stripped.length !== rows.length) touched.add(colorId);
                next[colorId] = stripped;
            }
            if (selectedColorData?.id && planningRowsRef.current.some((r) => r.visitId && drop.has(r.visitId))) {
                touched.add(selectedColorData.id);
            }
            if (touched.size > 0) {
                setDirtyColorIds((d) => new Set([...d, ...touched]));
            }
            return next;
        });
    };

    // Timeline data - 30 days fits without scrolling
    const timelineData = useMemo(() => {
        return calc.generateTimelineData(state.viewStartDate, TIMELINE_DAYS);
    }, [state.viewStartDate]);

    // Track the previous colorway ID to buffer rows on switch
    const prevColorIdRef = React.useRef<string | null>(null);

    // When color changes: buffer current rows, then load new color's rows
    useEffect(() => {
        const newColorId = selectedColorData?.id || null;
        const prevColorId = prevColorIdRef.current;

        // Buffer the outgoing color's planning rows (if any were modified)
        if (prevColorId && prevColorId !== newColorId && planningRows.length > 0) {
            setPlanningBuffer(prev => ({ ...prev, [prevColorId]: planningRows }));
        }

        // Load the incoming color's rows — use buffer only for unsaved edits
        if (!newColorId) {
            setPlanningRows([]);
            prevColorIdRef.current = null;
            return;
        }

        const isDirty = dirtyColorIdsRef.current.has(newColorId);
        const buffered = planningBufferRef.current[newColorId];
        if (isDirty && buffered !== undefined) {
            setPlanningRows(buffered);
        } else {
            setPlanningRows(
                calc.allocationsToPlanningRows(
                    newColorId,
                    allAllocations,
                    assignedResources,
                    flowSteps,
                    departments,
                    state.selectedOrderId || undefined,
                ),
            );
        }

        prevColorIdRef.current = newColorId;
    }, [selectedColorData?.id, flowSteps, allAllocations, assignedResources, departments, state.selectedOrderId]);

    // Wrap setPlanningRows to also mark the current color as dirty
    const handleSetPlanningRows = React.useCallback((updater: any) => {
        setPlanningRows(updater);
        if (selectedColorData?.id) {
            setDirtyColorIds(prev => {
                const next = new Set(prev);
                next.add(selectedColorData.id);
                return next;
            });
        }
    }, [selectedColorData?.id]);

    // Handlers - move by 7 days
    const handlePrev = () => {
        const d = new Date(state.viewStartDate);
        d.setDate(d.getDate() - 7);
        state.setViewStartDate(d.toISOString().split('T')[0]);
    };

    const handleNext = () => {
        const d = new Date(state.viewStartDate);
        d.setDate(d.getDate() + 7);
        state.setViewStartDate(d.toISOString().split('T')[0]);
    };

    const handleSavePlan = async (): Promise<boolean> => {
        const liveResources = assignedResourcesRef.current;
        const order = selectedOrderRef.current;
        const colorData = order?.colorways?.find((c) => c.name === state.selectedColor);

        if (!order || !colorData) {
            showNotification('Select an order and color first', 'error');
            return false;
        }
        if (!hasChanges) {
            showNotification('No planning changes to save.', 'error');
            return false;
        }
        if (saving) return false;
        setSaving(true);
        try {
            const currentPlanningRows = planningRowsRef.current;
            const pendingDeletes = state.deletedAllocationIds;
            const pendingAllocs = state.pendingAllocations;
            const liveAllocations = allocationsRef.current;
            const mergedAllocations = [
                ...liveAllocations.filter((a) => !pendingDeletes.includes(a.id)),
                ...pendingAllocs,
            ];

            const workingBuffer = {
                ...planningBufferRef.current,
                [colorData.id]: currentPlanningRows,
            };
            const workingDirty = new Set(dirtyColorIdsRef.current);

            if (pendingDeletes.length > 0 || pendingAllocs.length > 0) {
                const affectedColorIds = new Set<string>();
                for (const id of pendingDeletes) {
                    const alloc = liveAllocations.find((a) => a.id === id);
                    if (alloc?.colorwayId) affectedColorIds.add(alloc.colorwayId);
                }
                for (const alloc of pendingAllocs) {
                    if (alloc.colorwayId) affectedColorIds.add(alloc.colorwayId);
                }
                for (const colorId of affectedColorIds) {
                    workingBuffer[colorId] = calc.allocationsToPlanningRows(
                        colorId,
                        mergedAllocations,
                        liveResources,
                        flowSteps,
                        departments,
                        order.id,
                    );
                    workingDirty.add(colorId);
                }
            }

            const allColorRows: { colorId: string; colorName: string; rows: PlanningRow[] }[] = [];

            for (const [colorId, rows] of Object.entries(workingBuffer)) {
                if (!workingDirty.has(colorId)) continue;
                const colorway = order.colorways?.find((c) => c.id === colorId);
                if (!colorway) continue;

                allColorRows.push({ colorId, colorName: colorway.name, rows });
            }

            if (allColorRows.length === 0) {
                showNotification('No colorways with planning data to save.', 'error');
                return false;
            }

            let totalSaved = 0;
            let colorsSaved = 0;

            const built = buildColorwayPlanPayloads(
                order,
                allColorRows,
                liveResources,
                regularShiftHours,
                regularShiftMinsPerDay,
                orderRoutingStepsRef.current as OrderRoutingStepLike[],
            );
            totalSaved = built.totalSaved;
            colorsSaved = built.colorsSaved;

            if (!factoryId) {
                showNotification('No factory selected', 'error');
                return false;
            }

            await saveLinePlanAtomic(factoryId, order.id, built.colorwayPlans);
            await Promise.all([
                invalidateFactoryOrders(factoryId, order.id),
                refreshOrderAndAllocations(order.id),
            ]);

            const freshContext = await queryClient.fetchQuery({
                queryKey: queryKeys.planningGanttContext(
                    factoryId,
                    order.id,
                    state.viewStartDate,
                    planningViewEnd,
                ),
                queryFn: () =>
                    fetchPlanningGanttContext(
                        factoryId,
                        state.viewStartDate,
                        planningViewEnd,
                        order.id,
                    ),
            });
            const reloadedRows = calc.allocationsToPlanningRows(
                colorData.id,
                freshContext.allocations,
                liveResources,
                flowSteps,
                departments,
                order.id,
            );
            const finalRows =
                reloadedRows.length > 0
                    ? reloadedRows
                    : currentPlanningRows.filter((r) => r.resourceId || r.plannedQty > 0);

            setPlanningBuffer((prev) => ({ ...prev, [colorData.id]: finalRows }));
            setDirtyColorIds(new Set());
            state.setPendingAllocations([]);
            state.setDeletedAllocationIds([]);
            setUnsaved(false);
            setPlanningRows(finalRows);

            if (totalSaved > 0) {
                showNotification(
                    `Plan saved: ${totalSaved} allocation(s) across ${colorsSaved} colorway(s)`,
                    'success',
                );
            } else if (colorsSaved > 0) {
                showNotification('Cleared planning for modified colorway(s).', 'success');
            } else {
                showNotification('No valid planning rows to save. Fill in resource, dates, and quantity.', 'error');
                return false;
            }
            return true;
        } catch (error) {
            showNotification('Failed to save plan: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
            return false;
        } finally {
            setSaving(false);
        }
    };

    handleSavePlanRef.current = handleSavePlan;

    useEffect(() => {
        setPendingSaveAction(async () => {
            await handleSavePlanRef.current();
        });
        return () => {
            setPendingSaveAction(null);
            setUnsaved(false);
        };
    }, [setPendingSaveAction, setUnsaved]);

    const applyColorSwitch = (colorName: string) => {
        state.setSelectedColor(colorName);
        setPendingColorSwitch(null);
        setUnsavedPrompt(null);
    };

    const discardColorSwitch = () => {
        const currentId = selectedColorData?.id;
        if (currentId) {
            setPlanningBuffer((prev) => {
                const next = { ...prev };
                delete next[currentId];
                return next;
            });
            setDirtyColorIds((prev) => {
                const next = new Set(prev);
                next.delete(currentId);
                return next;
            });
        }
        state.setPendingAllocations([]);
        state.setDeletedAllocationIds([]);
        if (pendingColorSwitch) applyColorSwitch(pendingColorSwitch);
    };

    const executeDiscardPlan = () => {
        setPlanningBuffer({});
        setDirtyColorIds(new Set());
        state.setPendingAllocations([]);
        state.setDeletedAllocationIds([]);
        setUnsaved(false);
        goBack();
    };

    const requestDiscardPlan = () => {
        if (hasChanges) {
            setUnsavedPrompt('discard');
            return;
        }
        executeDiscardPlan();
    };

    const cancelUnsavedPrompt = () => {
        setUnsavedPrompt(null);
        setPendingColorSwitch(null);
    };

    const confirmDiscardPlan = () => {
        setUnsavedPrompt(null);
        executeDiscardPlan();
    };

    const confirmSaveAndDiscardPlan = async () => {
        const saved = await handleSavePlanRef.current();
        if (saved) {
            setUnsavedPrompt(null);
            executeDiscardPlan();
        }
    };

    const handlePrintReport = () => {
        setIsSummaryModalOpen(true);
    };

    const colorwayPlansForSummary = useMemo(() => {
        if (!selectedOrder?.colorways) return [];
        const buffer = { ...planningBuffer, ...(selectedColorData ? { [selectedColorData.id]: planningRows } : {}) };
        return selectedOrder.colorways.map((cw) => ({
            colorId: cw.id,
            colorName: cw.name,
            colorData: cw,
            rows: buffer[cw.id] ?? calc.allocationsToPlanningRows(
                cw.id,
                allAllocations,
                assignedResources,
                flowSteps,
                departments,
                selectedOrder.id,
            ),
        }));
    }, [selectedOrder, selectedColorData, planningBuffer, planningRows, allAllocations, assignedResources, flowSteps, departments]);

    const handleEditBooking = () => {
        if (!state.editingAlloc) return;

        const alloc: LineAllocation = {
            id: state.editingAlloc.id || `temp-${Date.now()}`,
            orderId: selectedOrder!.id,
            colorwayId: selectedColorData!.id,
            lineId: state.editingAlloc.lineId,
            operationId: state.editingAlloc.operationId,
            startDate: state.editingAlloc.startDate,
            endDate: state.editingAlloc.endDate,
            qty: state.editingAlloc.qty,
            dailyTarget: state.editingAlloc.dailyTarget ?? 0,
            status: 'planned',
            progress: 0,
            completed_is_true: state.editingAlloc.completed_is_true,
        };

        const existing = state.pendingAllocations.findIndex(a => a.id === alloc.id);
        if (existing >= 0) {
            const updated = [...state.pendingAllocations];
            updated[existing] = alloc;
            state.setPendingAllocations(updated);
        } else {
            state.setPendingAllocations([...state.pendingAllocations, alloc]);
        }
        
        state.setEditingAlloc(null);
        showNotification('Allocation updated', 'success');
    };

    const handleRemoveAllocation = () => {
        if (!state.editingAlloc?.id) return;
        
        if (state.editingAlloc.id.startsWith('temp-')) {
            state.setPendingAllocations(state.pendingAllocations.filter(a => a.id !== state.editingAlloc!.id));
        } else {
            state.setDeletedAllocationIds([...state.deletedAllocationIds, state.editingAlloc.id]);
        }
        
        state.setEditingAlloc(null);
        showNotification('Allocation removed', 'success');
    };

    const handleDiscardChanges = () => {
        state.setEditingAlloc(null);
    };

    // routeParams carries the order to select but state.selectedOrderId is only synced via
    // effect on the next tick — treat this window as loading rather than "no order selected".
    const awaitingRouteSync = Boolean(routeParams?.orderId) && state.selectedOrderId !== routeParams.orderId;

    const isFactoryDataReady = !factoryId || !dataLoading;

    if (!selectedOrder) {
        if (awaitingRouteSync || !isFactoryDataReady || dataLoading || routingLoading) {
            return (
                <PageShell loading skeleton="spinner" className="w-full pb-20">
                    <div />
                </PageShell>
            );
        }
        return (
            <PageShell className="w-full pb-20">
                <Card className="max-w-lg mx-auto mt-12 text-center p-8">
                    <h2 className="text-sm font-bold text-slate-800 mb-2">No order selected</h2>
                    <p className="text-xs text-slate-500 mb-6">
                        Open Production Planning from the Planning Board and pick an order.
                    </p>
                    <Button variant="primary" onClick={() => navigate(RoutePath.LINE_ASSIGNMENT)}>
                        Go to Planning Board
                    </Button>
                </Card>
            </PageShell>
        );
    }

    // Derive all size labels — prefer sizeLabels (ordered) from the order, fallback to colorway sizes
    const allSizes: string[] = selectedOrder.sizeLabels
        ? selectedOrder.sizeLabels.split(',').map((s: string) => s.trim()).filter(Boolean)
        : Array.from(new Set(
            (selectedOrder.colorways ?? []).flatMap(cw => (cw.sizes ?? []).map(s => s.size).filter(Boolean))
          ));

    const handleColorSelect = (colorName: string) => {
        if (colorName === state.selectedColor) return;
        if (hasChanges) {
            setPendingColorSwitch(colorName);
            setUnsavedPrompt('color');
            return;
        }
        state.setSelectedColor(colorName);
    };

    const pageLoading = dataLoading || routingLoading || routingRefreshing || !isFactoryDataReady;

    return (
        <PageShell loading={pageLoading} skeleton="spinner" className="w-full pb-20">

            {/* ── 1+2. Style Details + Routing (merged, collapsible) ─────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-lg mb-4 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/80">
                    <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
                        <div className="flex flex-col">
                            <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Style</span>
                            <button
                                type="button"
                                onClick={() => navigate(RoutePath.STYLE_DETAILS, { id: selectedOrder.id })}
                                className="text-[12px] font-semibold text-blue-700 hover:underline text-left inline-flex items-center gap-2"
                            >
                                {selectedOrder.styleName}
                                <OrderPriorityChip priority={selectedOrder.priority} />
                            </button>
                        </div>
                        <span className="text-slate-200 text-lg">|</span>
                        {[
                            { label: 'PO',     value: selectedOrder.poNumber },
                            { label: 'Buyer',  value: selectedOrder.buyer || '—' },
                            { label: 'Ref',    value: selectedOrder.styleRef || '—' },
                            { label: 'Season', value: selectedOrder.season || '—' },
                        ].map(({ label, value }, idx, arr) => (
                            <React.Fragment key={label}>
                                <div className="flex flex-col">
                                    <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">{label}</span>
                                    <span className="text-[12px] font-semibold text-slate-800">{value as string}</span>
                                </div>
                                {idx < arr.length - 1 && <span className="text-slate-200 text-lg">|</span>}
                            </React.Fragment>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <PlanningToolbar
                            hasChanges={hasChanges}
                            saving={saving}
                            saveDisabled={!hasChanges}
                            onSave={() => void handleSavePlanRef.current()}
                            onDiscard={requestDiscardPlan}
                            onSummary={handlePrintReport}
                        />
                        <button
                            type="button"
                            className="p-1.5 rounded hover:bg-slate-100 transition-colors"
                            onClick={() => setStyleDetailsCollapsed(v => !v)}
                        >
                            {styleDetailsCollapsed ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronUp size={15} className="text-slate-400" />}
                        </button>
                    </div>
                </div>
                {!styleDetailsCollapsed && (
                    <div className="flex gap-0 divide-x divide-slate-200">
                        {/* Left: order image — wider */}
                        <div className="w-48 shrink-0 flex items-center justify-center bg-slate-50 p-3">
                            {selectedOrder.image ? (
                                <img
                                    src={selectedOrder.image}
                                    alt={selectedOrder.styleName}
                                    className="w-full max-h-48 object-contain rounded-lg"
                                />
                            ) : (
                                <div className="w-full h-40 flex flex-col items-center justify-center text-slate-300 gap-1 bg-white rounded-lg border border-dashed border-slate-200">
                                    <span className="text-[9px] font-medium">No image</span>
                                </div>
                            )}
                        </div>

                        {/* Right: two equal-height tables side by side */}
                        <div className="flex-1 flex gap-4 min-w-0 p-3 items-stretch">
                            <div className={`w-1/2 min-w-0 flex flex-col ${PLANNING_TABLE_H}`}>
                                <div className={`${flowTableClasses.wrapper} flex-1 flex flex-col h-full`}>
                                <div className="px-3 py-1.5 border-b border-slate-200 bg-slate-50 shrink-0">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Colors &amp; Quantities</span>
                                </div>
                                <div className={`${flowTableClasses.scroll} flex-1`}>
                                <table className={flowTableClasses.table}>
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Color</th>
                                            {allSizes.map(sz => (
                                                <th key={sz} className="px-2 py-2 text-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{sz}</th>
                                            ))}
                                            <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedOrder.colorways ?? []).map(cw => {
                                            const isActive = state.selectedColor === cw.name;
                                            return (
                                                <React.Fragment key={cw.id}>
                                                    {/* Order qty row */}
                                                    <tr
                                                        className={`cursor-pointer transition-colors border-t border-slate-100 ${isActive ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                                                        onClick={() => handleColorSelect(cw.name)}
                                                    >
                                                        <td className={`px-3 pt-2.5 pb-0.5 font-semibold ${isActive ? 'text-emerald-800' : 'text-slate-800'}`} rowSpan={2}>
                                                            <span className={`block truncate max-w-[80px] ${isActive ? 'text-emerald-800' : 'text-slate-800'}`}>{cw.name || <span className="text-slate-400 italic">Unnamed</span>}</span>
                                                        </td>
                                                        {allSizes.map(sz => {
                                                            const d = cw.sizes?.find(s => s.size === sz);
                                                            return (
                                                                <td key={sz} className="px-2 pt-2.5 pb-0.5 text-center text-slate-600 text-[10px]">{d ? sizeOrderQty(d) : <span className="text-slate-200">—</span>}</td>
                                                            );
                                                        })}
                                                        <td className="px-2 pt-2.5 pb-0.5 text-center text-slate-600 text-[10px] font-medium">{sumSizeOrderQty(cw.sizes)}</td>
                                                    </tr>
                                                    {/* Adj qty row */}
                                                    <tr
                                                        className={`cursor-pointer transition-colors border-b border-slate-100 ${isActive ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                                                        onClick={() => handleColorSelect(cw.name)}
                                                    >
                                                        {allSizes.map(sz => {
                                                            const d = cw.sizes?.find(s => s.size === sz);
                                                            const adj = d ? (sizeAdjQty(d) || sizeOrderQty(d)) : 0;
                                                            return (
                                                                <td key={sz} className="px-2 pt-0.5 pb-2.5 text-center text-blue-600 font-semibold text-[10px]">{d ? adj : <span className="text-slate-200">—</span>}</td>
                                                            );
                                                        })}
                                                        <td className="px-2 pt-0.5 pb-2.5 text-center text-blue-600 font-bold text-[10px]">{sumSizeAdjQty(cw.sizes) || sumSizeOrderQty(cw.sizes)}</td>
                                                    </tr>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t-2 border-slate-200">
                                            <td className="px-3 py-2 font-semibold text-slate-600 text-[10px] uppercase tracking-wider">Total</td>
                                            {allSizes.map(sz => {
                                                const ordTotal = (selectedOrder.colorways ?? []).reduce((sum, cw) => { const d = cw.sizes?.find(s => s.size === sz); return sum + (d ? sizeOrderQty(d) : 0); }, 0);
                                                const adjTotal = (selectedOrder.colorways ?? []).reduce((sum, cw) => { const d = cw.sizes?.find(s => s.size === sz); return sum + (d ? (sizeAdjQty(d) || sizeOrderQty(d)) : 0); }, 0);
                                                return (
                                                    <td key={sz} className="px-2 py-2 text-center">
                                                        <div className="text-[10px] text-slate-600 font-medium">{ordTotal}</div>
                                                        <div className="text-[10px] text-blue-600 font-bold">{adjTotal}</div>
                                                    </td>
                                                );
                                            })}
                                            <td className="px-2 py-2 text-center">
                                                <div className="text-[10px] text-slate-600 font-semibold">{selectedOrder.orderQty}</div>
                                                <div className="text-[10px] text-blue-600 font-bold">{selectedOrder.adjQty || selectedOrder.orderQty}</div>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                                </div>
                                </div>
                            </div>

                            <div className={`w-1/2 min-w-0 flex flex-col ${PLANNING_TABLE_H}`}>
                                <div className={`${flowTableClasses.wrapper} flex-1 flex flex-col h-full`}>
                                <div className="px-3 py-1.5 border-b border-slate-200 bg-slate-50 shrink-0">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Shipment Plan</span>
                                </div>
                                {shipmentPlanDisplayLines.length > 0 ? (() => {
                                    const lines = shipmentPlanDisplayLines;
                                    // Use ordered allSizes; fall back to keys from lines if allSizes is empty
                                    const sizeCols = allSizes.length > 0
                                        ? allSizes
                                        : Array.from(new Set(lines.flatMap((l: any) => Object.keys(l.sizes ?? {}))));
                                    const hasDestination = lines.some((l: any) => l.destinationCountry);
                                    return (
                                        <div className={flowTableClasses.scroll}>
                                        <table className={flowTableClasses.table}>
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-100">
                                                    <th className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">Date</th>
                                                    <th className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">Color</th>
                                                    {hasDestination && <th className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">Dest.</th>}
                                                    {sizeCols.map(s => <th key={s} className="px-2 py-1.5 text-center font-semibold text-slate-500">{s}</th>)}
                                                    <th className="px-2 py-1.5 text-center font-semibold text-slate-500">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {lines.map((line, i) => {
                                                    const cw = (selectedOrder.colorways ?? []).find((c) => c.id === line.colorwayId);
                                                    const swatch = swatchStyleFromColorName(cw?.name || '');
                                                    const total = sizeCols.reduce((s: number, k: string) => s + (Number(line.sizes?.[k]) || 0), 0);
                                                    const isRescheduled = line.status === 'rescheduled';
                                                    const dateLabel = line.shipmentDate
                                                        ? new Date(line.shipmentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
                                                        : '—';
                                                    return (
                                                        <tr
                                                            key={line.id}
                                                            className={isRescheduled ? 'bg-slate-100/80 grayscale opacity-75' : 'hover:bg-slate-50/60'}
                                                        >
                                                            <td className="px-2 py-1.5 whitespace-nowrap">
                                                                <div className="flex flex-col gap-0.5">
                                                                    <span className={`font-semibold ${isRescheduled ? 'text-slate-500 line-through' : 'text-blue-700'}`}>
                                                                        {dateLabel}
                                                                    </span>
                                                                    {isRescheduled && (
                                                                        <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700">Rescheduled</span>
                                                                    )}
                                                                    {!isRescheduled && line.status === 'replanned' && (
                                                                        <span className="text-[9px] font-bold uppercase tracking-wide text-amber-600">Replanned</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-2 py-1.5 whitespace-nowrap">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="w-2 h-2 rounded-full shrink-0" style={swatch} />
                                                                    <span className="text-slate-700">{cw?.name || '—'}</span>
                                                                </div>
                                                            </td>
                                                            {hasDestination && <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{line.destinationCountry || '—'}</td>}
                                                            {sizeCols.map((s: string) => (
                                                                <td key={s} className="px-2 py-1.5 text-center tabular-nums text-slate-700">
                                                                    {(line.sizes?.[s] || 0) > 0 ? (line.sizes[s]).toLocaleString() : <span className="text-slate-200">—</span>}
                                                                </td>
                                                            ))}
                                                            <td className="px-2 py-1.5 text-center font-bold text-slate-800 tabular-nums">{total > 0 ? total.toLocaleString() : '—'}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        </div>
                                    );
                                })() : (
                                    <div className={`${flowTableClasses.scroll} flex-1 flex items-center justify-center`}>
                                        <span className="text-[10px] text-slate-400 text-center">No shipment lines planned.</span>
                                    </div>
                                )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* Order Routing — inside Style Details card */}
                {!styleDetailsCollapsed && (
                    <div className="border-t border-slate-200">
                        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50/60 border-b border-slate-100">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Order Routing</span>
                        </div>
                        <div className="px-4 py-3">
                            {routingError ? (
                                <div className="px-4 py-6 text-center">
                                    <p className="text-xs text-red-600">{routingError}</p>
                                    <p className="text-[10px] text-slate-500 mt-2">Routing could not be loaded. Use the order details page fallback.</p>
                                </div>
                            ) : (
                                <OrderRoutingEditor
                                    order={selectedOrder}
                                    processFlows={processFlows}
                                    departments={departments}
                                    savedSteps={savedRoutingSteps}
                                    lockedDeptIds={lockedRoutingDeptIds}
                                    planAllocations={orderPlanAllocations}
                                    onRoutingUpdated={async (affectedVisitIds) => {
                                        if (!state.selectedOrderId || !factoryId) return;
                                        setRoutingRefreshing(true);
                                        try {
                                            clearPlanningForVisits(affectedVisitIds);
                                            const [{ steps, lockedDeptIds }] = await Promise.all([
                                                fetchOrderRoutingState(factoryId, state.selectedOrderId),
                                                refreshOrderAndAllocations(state.selectedOrderId),
                                            ]);
                                            setRoutingError(null);
                                            setSavedRoutingSteps(steps);
                                            setOrderRoutingSteps(mapRoutingRowsToFlowSteps(steps));
                                            setLockedRoutingDeptIds(lockedDeptIds);
                                        } finally {
                                            setRoutingRefreshing(false);
                                        }
                                    }}
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── 3. Color chip selector (after route applied) ─────────── */}
            {hasRouting && (
            <div className="bg-white border border-slate-200 rounded-lg mb-4 px-4 py-2.5 shadow-sm flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mr-1 shrink-0">Plan color:</span>
                {(selectedOrder.colorways ?? []).map((cw) => {
                    const isActive = state.selectedColor === cw.name;
                    const swatch = swatchStyleFromColorName(cw.name || '');
                    const cwAllocs = allAllocations.filter(a => a.colorwayId === cw.id || a.orderId === cw.id);
                    const cwPlanned = lastWorkableVisit
                        ? cwAllocs
                            .filter((a) =>
                                (lastWorkableVisit.visitId && a.visitId === lastWorkableVisit.visitId)
                                || a.operationId === lastWorkableVisit.planRouteStep.id
                                || allocationDepartmentId(a, [selectedOrder]) === lastWorkableVisit.deptId,
                            )
                            .reduce((s, a) => s + (a.qty || 0), 0)
                        : 0;
                    const cwAdj = sumSizeAdjQty(cw.sizes) || sumSizeOrderQty(cw.sizes);
                    return (
                        <button
                            key={cw.id}
                            type="button"
                            onClick={() => handleColorSelect(cw.name)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border transition-all ${
                                isActive
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-700'
                            }`}
                        >
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/40" style={swatch} />
                            <span>{cw.name || 'Unnamed'}</span>
                            <span className={`text-[9px] ${isActive ? 'text-emerald-200' : 'text-slate-400'}`}>
                                {cwPlanned.toLocaleString()}/{cwAdj.toLocaleString()}
                            </span>
                        </button>
                    );
                })}
            </div>
            )}

            {/* ── 4. Planning board (shown when route applied + color selected) ─── */}
            {!selectedColorData ? (
                <Card className="p-8 text-center border-dashed">
                    <p className="text-xs text-slate-500">
                        {hasRouting
                            ? 'Route is applied. Select a color when you are ready to plan — you can come back anytime.'
                            : 'Apply order routing above, then select a color to plan.'}
                    </p>
                </Card>
            ) : !hasRouting ? (
                <Card className="p-6 mb-4 text-center border-dashed">
                    <p className="text-xs text-slate-500">
                        Assign a routing template in Style Details above before allocating resources for <strong>{state.selectedColor}</strong>.
                    </p>
                </Card>
            ) : (
            <ResourceAllocationSection
                isFullScreen={state.isFullScreen}
                viewStartDate={state.viewStartDate}
                selectedOrderId={state.selectedOrderId}
                selectedColor={state.selectedColor}
                flowSteps={flowSteps}
                departments={departments}
                assignedResources={assignedResources}
                allAllocations={allAllocations}
                selectedColorData={selectedColorData}
                timelineData={timelineData}
                cellWidth={cellWidth}
                deliveryDates={shipmentDeliveryDates}
                editingAlloc={state.editingAlloc}
                planningTotals={planningTotals}
                selectedOrder={selectedOrder}
                regularShiftHours={regularShiftHours}
                onToggleFullScreen={() => state.setIsFullScreen(!state.isFullScreen)}
                onViewStartDateChange={(date) => state.setViewStartDate(date)}
                onPrev={handlePrev}
                onNext={handleNext}
                onBarClick={(alloc) => {
                    const resource = assignedResources.find(r => r.id === alloc.lineId);
                    state.setEditingAlloc({
                        id: alloc.id,
                        processName: resource?.departmentName || '',
                        operationId: alloc.operationId,
                        lineId: alloc.lineId,
                        startDate: alloc.startDate,
                        endDate: alloc.endDate,
                        qty: alloc.qty,
                        dailyTarget: alloc.dailyTarget,
                        learningCurve: alloc.learningCurveId,
                        completed_is_true: alloc.completed_is_true
                    });
                }}
                onBarDragStart={(alloc, edge) => {
                }}
                onBarHover={(alloc, anchorRect) => {
                    if (alloc && anchorRect) {
                        state.setHoveredAlloc({ alloc, anchorRect });
                    } else {
                        state.setHoveredAlloc(null);
                    }
                }}
                onTimelineClick={(resourceId, date) => {
                    if (!selectedColorData || planningTotals.remainingTotal <= 0) return;
                    const resource = assignedResources.find(r => r.id === resourceId);
                    if (!resource) return;

                    // Pick the first routing step matching the resource department as the default operation
                    const defaultStep = orderRoutingSteps.find(s => s.dept_name === resource.departmentName || s.dept_id === resource.departmentId);

                    // Create new allocation starting on clicked date
                    state.setEditingAlloc({
                        id: `temp-${Date.now()}`,
                        processName: resource.departmentName || '',
                        operationId: defaultStep?.id,
                        lineId: resourceId,
                        startDate: date,
                        endDate: date,
                        qty: Math.min(100, planningTotals.remainingTotal),
                        dailyTarget: 0,
                        learningCurve: undefined,
                        completed_is_true: false
                    });
                }}
                onEditingAllocChange={(alloc) => state.setEditingAlloc(alloc)}
                onSave={handleEditBooking}
                onRemove={handleRemoveAllocation}
                onCancel={handleDiscardChanges}
                planningRows={planningRows}
                setPlanningRows={handleSetPlanningRows}
                planningBuffer={planningBuffer}
                dirtyColorIds={dirtyColorIds}
                orders={ganttPeerOrders}
            />
            )}

            {/* Allocation Tooltip - Using Refactored Component */}
            {state.hoveredAlloc && (
                <GanttAllocTooltip
                    alloc={lineAllocationToGanttAlloc(
                        state.hoveredAlloc.alloc,
                        selectedOrder,
                        orderRoutingSteps as OrderRoutingStepLike[],
                    )}
                    anchorRect={state.hoveredAlloc.anchorRect}
                    mode="planned"
                />
            )}

            {/* Summary Modal */}
            <SummaryModal
                isOpen={isSummaryModalOpen}
                onClose={() => setIsSummaryModalOpen(false)}
                flowSteps={flowSteps}
                selectedOrder={selectedOrder}
                colorwayPlans={colorwayPlansForSummary}
                assignedResources={assignedResources}
                departments={departments}
                regularShiftHours={regularShiftHours}
                orderId={selectedOrder?.id}
                deliveryDates={shipmentDeliveryDates}
            />

            <Modal isOpen={!!unsavedPrompt} onClose={cancelUnsavedPrompt}>
                <div className="relative">
                    <button
                        onClick={cancelUnsavedPrompt}
                        className="absolute top-4 right-4 text-red-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
                    >
                        <X size={20} />
                    </button>
                    <div className="flex flex-col items-center p-8 pb-4 text-center">
                        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-amber-50">
                            <AlertTriangle size={32} />
                        </div>
                        <h3 className="text-xs font-bold text-slate-900 mb-2">Unsaved Changes</h3>
                        <p className="text-slate-500 text-[10px] max-w-[260px] leading-relaxed">
                            {unsavedPrompt === 'color'
                                ? 'You have unsaved planning changes. Save or discard before switching colorway.'
                                : 'You have unsaved planning changes. Save or discard before leaving this page.'}
                        </p>
                    </div>
                    <div className="p-6 pt-2 flex flex-col gap-3">
                        <DesktopWriteGate>
                        <Button
                            onClick={async () => {
                                if (unsavedPrompt === 'color') {
                                    const saved = await handleSavePlanRef.current();
                                    if (saved && pendingColorSwitch) applyColorSwitch(pendingColorSwitch);
                                } else {
                                    await confirmSaveAndDiscardPlan();
                                }
                            }}
                            disabled={saving}
                            className="w-full shadow-lg shadow-blue-100 py-2.5 text-sm"
                        >
                            {saving ? 'Saving…' : 'Save Changes'}
                        </Button>
                        </DesktopWriteGate>
                        <Button
                            variant="danger-light"
                            onClick={() => {
                                if (unsavedPrompt === 'color') discardColorSwitch();
                                else confirmDiscardPlan();
                            }}
                            className="w-full text-xs"
                        >
                            {unsavedPrompt === 'color' ? 'Discard & Switch' : 'Discard & Leave'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </PageShell>
    );
};
