import React from 'react';
import { LineAllocation } from '../../../types';

interface AllocationTooltipProps {
    allocation: LineAllocation;
    position: { x: number; y: number };
    resourceName?: string;
    departmentName?: string;
    styleName?: string;
    colorway?: string;
}

export const AllocationTooltip: React.FC<AllocationTooltipProps> = ({
    allocation,
    position,
    resourceName,
    departmentName,
    styleName,
    colorway
}) => {
    const startDate = new Date(allocation.startDate);
    const endDate = new Date(allocation.endDate);
    
    // Calculate working days
    let workingDays = 0;
    for (let x = new Date(startDate); x <= endDate; x.setDate(x.getDate() + 1)) {
        if (x.getDay() !== 0) workingDays++;
    }
    
    const dailyAvg = workingDays > 0 ? Math.ceil(allocation.qty / workingDays) : 0;
    
    const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
    });

    return (
        <div 
            className="fixed z-[200] pointer-events-none" 
            style={{ left: position.x + 12, top: position.y + 12 }}
        >
            <div className="bg-slate-900/90 text-white rounded-lg shadow-xl p-4 text-xs min-w-[200px] backdrop-blur-sm">
                <div className="font-bold text-xs mb-1 text-blue-300 text-center">
                    {styleName}
                </div>
                <div className="text-[10px] text-slate-400 text-center mb-3">
                    {formatDate(startDate)} → {formatDate(endDate)}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div>
                        <span className="text-slate-400 block text-[9px]">Color</span>
                        <span className="font-medium">{colorway}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block text-[9px]">Dept</span>
                        <span className="font-medium">{departmentName || '-'}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block text-[9px]">Resource</span>
                        <span className="font-medium">{resourceName || '-'}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block text-[9px]">Days</span>
                        <span className="font-medium">{workingDays}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block text-[9px]">Qty</span>
                        <span className="font-bold text-emerald-400">{allocation.qty.toLocaleString()}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block text-[9px]">Avg/Day</span>
                        <span className="font-medium">{dailyAvg.toLocaleString()}</span>
                    </div>
                    {allocation.plannedMetrics?.workers && (
                        <div>
                            <span className="text-slate-400 block text-[9px]">Workforce</span>
                            <span className="font-medium">{allocation.plannedMetrics.workers}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
