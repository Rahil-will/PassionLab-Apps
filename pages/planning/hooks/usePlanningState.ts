import { useState, useEffect } from 'react';
import { LineAllocation } from '../../../types';

export const usePlanningState = () => {
    const [viewStartDate, setViewStartDate] = useState(() => {
        const saved = localStorage.getItem('planning_view_date');
        if (saved) return saved;
        const d = new Date();
        d.setDate(d.getDate() - 2);
        return d.toISOString().split('T')[0];
    });

    useEffect(() => {
        localStorage.setItem('planning_view_date', viewStartDate);
    }, [viewStartDate]);

    const [selectedOrderId, setSelectedOrderId] = useState<string>('');
    const [selectedColor, setSelectedColor] = useState('');
    const [styleSearch, setStyleSearch] = useState('');
    const [poSearch, setPoSearch] = useState('');
    const [colorSearch, setColorSearch] = useState('');
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [pendingAllocations, setPendingAllocations] = useState<LineAllocation[]>([]);
    const [deletedAllocationIds, setDeletedAllocationIds] = useState<string[]>([]);
    const [hoveredAlloc, setHoveredAlloc] = useState<{
        alloc: LineAllocation;
        anchorRect: DOMRect;
    } | null>(null);
    const [showLadderConfig, setShowLadderConfig] = useState(false);
    const [autoScheduleResult, setAutoScheduleResult] = useState<any>(null);

    // Drag-to-create allocation state
    const [dragSelection, setDragSelection] = useState<{ 
        lineId: string; 
        deptName: string; 
        startDate: string; 
        endDate: string 
    } | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Allocation editor state
    const [editingAlloc, setEditingAlloc] = useState<{
        id?: string;
        processName: string;
        operationId?: string;
        lineId: string;
        startDate: string;
        endDate: string;
        qty: number;
        dailyTarget?: number;
        learningCurve?: string | null;
        completed_is_true?: boolean;
    } | null>(null);

    return {
        viewStartDate,
        setViewStartDate,
        selectedOrderId,
        setSelectedOrderId,
        selectedColor,
        setSelectedColor,
        styleSearch,
        setStyleSearch,
        poSearch,
        setPoSearch,
        colorSearch,
        setColorSearch,
        isFullScreen,
        setIsFullScreen,
        pendingAllocations,
        setPendingAllocations,
        deletedAllocationIds,
        setDeletedAllocationIds,
        hoveredAlloc,
        setHoveredAlloc,
        showLadderConfig,
        setShowLadderConfig,
        autoScheduleResult,
        setAutoScheduleResult,
        dragSelection,
        setDragSelection,
        isDragging,
        setIsDragging,
        editingAlloc,
        setEditingAlloc
    };
};
