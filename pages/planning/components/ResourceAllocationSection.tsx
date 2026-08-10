import React from 'react';
import { Search } from 'lucide-react';
import { PlanningTable } from './PlanningTable';
import { LineAllocation } from '../../../types';

import type { DepartmentEntity } from '../../../types/settings';

interface ResourceAllocationSectionProps {
    isFullScreen: boolean;
    viewStartDate: string;
    selectedOrderId: string;
    selectedColor: string;
    flowSteps: any[];
    departments?: DepartmentEntity[];
    assignedResources: any[];
    allAllocations: LineAllocation[];
    selectedColorData: any;
    timelineData: any[];
    cellWidth: number;
    deliveryDate?: string;
    deliveryDates?: string[];
    editingAlloc: any;
    planningTotals: { targetTotal: number; plannedTotal: number; remainingTotal: number };
    selectedOrder: any;
    regularShiftHours: number;
    onToggleFullScreen: () => void;
    onViewStartDateChange: (date: string) => void;
    onPrev: () => void;
    onNext: () => void;
    onBarClick: (alloc: LineAllocation) => void;
    onBarDragStart: (alloc: LineAllocation, edge: 'left' | 'right' | 'center') => void;
    onBarHover?: (allocation: LineAllocation | null, anchorRect?: DOMRect) => void;
    onTimelineClick?: (resourceId: string, date: string) => void;
    onEditingAllocChange: (alloc: any) => void;
    onSave: () => void;
    onRemove: () => void;
    onCancel: () => void;
    planningRows: any[];
    setPlanningRows: (rows: any[]) => void;
    planningBuffer?: Record<string, any[]>;
    dirtyColorIds?: Set<string>;
    orders?: Array<{ id: string; styleName?: string; colorways?: Array<{ id: string; name: string }> }>;
}

export const ResourceAllocationSection: React.FC<ResourceAllocationSectionProps> = ({
    isFullScreen,
    viewStartDate,
    selectedOrderId,
    selectedColor,
    flowSteps,
    departments = [],
    assignedResources,
    allAllocations,
    selectedColorData,
    timelineData,
    cellWidth,
    deliveryDate,
    deliveryDates,
    editingAlloc,
    planningTotals,
    selectedOrder,
    regularShiftHours,
    onToggleFullScreen,
    onViewStartDateChange,
    onPrev,
    onNext,
    onBarClick,
    onBarDragStart,
    onBarHover,
    onTimelineClick,
    onEditingAllocChange,
    onSave,
    onRemove,
    onCancel,
    planningRows,
    setPlanningRows,
    planningBuffer,
    dirtyColorIds,
    orders = [],
}) => {

    return (
        <>
            {/* Planning Table with embedded Gantt Timeline */}
            {selectedOrderId && selectedColor && selectedColorData ? (
                <PlanningTable
                    flowSteps={flowSteps}
                    departments={departments}
                    assignedResources={assignedResources}
                    selectedColorData={selectedColorData}
                    selectedOrder={selectedOrder}
                    planningRows={planningRows}
                    onRowsChange={setPlanningRows}
                    allAllocations={allAllocations}
                    timelineData={timelineData}
                    cellWidth={cellWidth}
                    deliveryDate={deliveryDate}
                    deliveryDates={deliveryDates}
                    viewStartDate={viewStartDate}
                    onPrev={onPrev}
                    onNext={onNext}
                    onViewStartDateChange={onViewStartDateChange}
                    onBarClick={onBarClick}
                    onBarDragStart={onBarDragStart}
                    onBarHover={onBarHover}
                    onTimelineClick={onTimelineClick}
                    dailyShiftHours={Math.round(regularShiftHours * 10) / 10}
                    planningBuffer={planningBuffer}
                    dirtyColorIds={dirtyColorIds}
                    orders={orders}
                />
            ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Search size={32} />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-2">Ready to Plan?</h3>
                    <p className="text-slate-500">Select a Style and Colorway to activate the board.</p>
                </div>
            )}
        </>
    );
};
