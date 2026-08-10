import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { DateRange, Range, RangeKeyDict } from 'react-date-range';
import format from 'date-fns/format';
import subDays from 'date-fns/subDays';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import subMonths from 'date-fns/subMonths';
import startOfQuarter from 'date-fns/startOfQuarter';
import endOfQuarter from 'date-fns/endOfQuarter';
import { Calendar } from 'lucide-react';
import { computeDropdownBelowPosition } from '../lib/popoverPosition';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

export interface DateRangeValue {
    startDate: string; // ISO format
    endDate: string;   // ISO format
}

interface DateRangePickerProps {
    value?: DateRangeValue;
    onChange: (range: DateRangeValue) => void;
    className?: string;
    /** `pill` = single curved bar with start – end dates (report toolbar). */
    variant?: 'default' | 'pill';
    /** @deprecated Menus always open below the trigger; prop is ignored. */
    dropdownAlign?: 'left' | 'right';
}

type PresetKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'custom';

const presets: { key: PresetKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7', label: 'Last 7 Days' },
    { key: 'last30', label: 'Last 30 Days' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'thisQuarter', label: 'This Quarter' },
    { key: 'custom', label: 'Custom' },
];

const getPresetDates = (preset: PresetKey): { start: Date; end: Date } => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    switch (preset) {
        case 'today':
            return { start: today, end: endOfDay };
        case 'yesterday': {
            const yesterday = subDays(today, 1);
            return { start: yesterday, end: yesterday };
        }
        case 'last7':
            return { start: subDays(today, 6), end: endOfDay };
        case 'last30':
            return { start: subDays(today, 29), end: endOfDay };
        case 'thisMonth':
            return { start: startOfMonth(today), end: endOfMonth(today) };
        case 'lastMonth': {
            const lastMonth = subMonths(today, 1);
            return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
        }
        case 'thisQuarter':
            return { start: startOfQuarter(today), end: endOfQuarter(today) };
        default:
            return { start: today, end: endOfDay };
    }
};

function formatPillDate(d: Date | undefined): string {
    if (!d) return '—';
    return format(d, 'dd-MM-yyyy');
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
    value,
    onChange,
    className,
    variant = 'default',
    dropdownAlign: _dropdownAlign = 'left',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activePreset, setActivePreset] = useState<PresetKey>('today');
    const [range, setRange] = useState<Range[]>([
        {
            startDate: value ? new Date(value.startDate) : getPresetDates('today').start,
            endDate: value ? new Date(value.endDate) : getPresetDates('today').end,
            key: 'selection',
        },
    ]);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    const updateMenuPosition = () => {
        if (!containerRef.current || !menuRef.current) return;
        const trigger = containerRef.current.getBoundingClientRect();
        const panelW = menuRef.current.offsetWidth;
        const panelH = menuRef.current.offsetHeight;
        const { left, top } = computeDropdownBelowPosition(trigger, panelW, panelH, 8);
        setMenuPos({ top, left });
    };

    useLayoutEffect(() => {
        if (!isOpen) return;
        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);
        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!value) return;
        const start = new Date(value.startDate);
        const end = new Date(value.endDate);
        setRange([{ startDate: start, endDate: end, key: 'selection' }]);
        const today = getPresetDates('today');
        const yesterday = getPresetDates('yesterday');
        const last7 = getPresetDates('last7');
        const last30 = getPresetDates('last30');
        const thisMonth = getPresetDates('thisMonth');
        const lastMonth = getPresetDates('lastMonth');
        const thisQuarter = getPresetDates('thisQuarter');
        const sameDay = (a: Date, b: Date) => format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd');
        const sameRange = (s: Date, e: Date, ref: { start: Date; end: Date }) =>
            sameDay(s, ref.start) && sameDay(e, ref.end);
        if (sameRange(start, end, today)) setActivePreset('today');
        else if (sameRange(start, end, yesterday)) setActivePreset('yesterday');
        else if (sameRange(start, end, last7)) setActivePreset('last7');
        else if (sameRange(start, end, last30)) setActivePreset('last30');
        else if (sameRange(start, end, thisMonth)) setActivePreset('thisMonth');
        else if (sameRange(start, end, lastMonth)) setActivePreset('lastMonth');
        else if (sameRange(start, end, thisQuarter)) setActivePreset('thisQuarter');
        else setActivePreset('custom');
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const t = event.target as Node;
            if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            setIsOpen(false);
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handlePresetClick = (preset: PresetKey) => {
        setActivePreset(preset);
        if (preset !== 'custom') {
            const { start, end } = getPresetDates(preset);
            setRange([{ startDate: start, endDate: end, key: 'selection' }]);
            onChange({
                startDate: start.toISOString(),
                endDate: end.toISOString(),
            });
            setIsOpen(false);
        }
    };

    const handleRangeChange = (item: RangeKeyDict) => {
        const selection = item.selection;
        setRange([selection]);
        setActivePreset('custom');
        if (selection.startDate && selection.endDate) {
            onChange({
                startDate: selection.startDate.toISOString(),
                endDate: selection.endDate.toISOString(),
            });
        }
    };

    const displayText = () => {
        const preset = presets.find((p) => p.key === activePreset);
        if (activePreset !== 'custom' && preset) {
            return preset.label;
        }
        const start = range[0].startDate;
        const end = range[0].endDate;
        if (start && end) {
            return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
        }
        return 'Select dates';
    };

    const startDate = range[0].startDate;
    const endDate = range[0].endDate;

    const dropdown = isOpen ? (
        <div
            ref={menuRef}
            className="fixed bg-white rounded-xl shadow-xl border border-slate-200 z-[300] flex overflow-hidden max-w-[calc(100vw-1.5rem)]"
            style={{ top: menuPos.top, left: menuPos.left }}
        >
            <div className="w-40 border-r border-slate-100 py-2">
                {presets.map((preset) => (
                    <button
                        key={preset.key}
                        type="button"
                        onClick={() => handlePresetClick(preset.key)}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                            activePreset === preset.key
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
            <div className="p-2">
                <DateRange
                    ranges={range}
                    onChange={handleRangeChange}
                    months={2}
                    direction="horizontal"
                    showDateDisplay={false}
                    rangeColors={['#3b82f6']}
                    color="#3b82f6"
                />
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
                    <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="px-4 py-1.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsOpen(false)}
                        className="px-4 py-1.5 text-[10px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    if (variant === 'pill') {
        return (
            <div ref={containerRef} className={`relative shrink-0 ${className || ''}`}>
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className={`flex items-center gap-2.5 px-4 py-2 rounded-full border text-xs font-medium transition-colors shadow-sm whitespace-nowrap w-full min-w-0 sm:min-w-[15rem] ${
                        isOpen
                            ? 'bg-blue-50 border-blue-200 text-blue-800'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                >
                    <Calendar size={14} className="text-slate-400 shrink-0" />
                    <span className="tabular-nums">{formatPillDate(startDate)}</span>
                    <Calendar size={14} className="text-slate-400 shrink-0" />
                    <span className="text-slate-300">–</span>
                    <span className="tabular-nums">{formatPillDate(endDate)}</span>
                    <Calendar size={14} className="text-slate-400 shrink-0 ml-auto" />
                </button>
                {dropdown && createPortal(dropdown, document.body)}
            </div>
        );
    }

    return (
        <div ref={containerRef} className={`relative shrink-0 ${className || ''}`}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
            >
                <Calendar size={16} className="text-slate-500" />
                <span className="truncate max-w-[11rem]">{displayText()}</span>
            </button>
            {dropdown && createPortal(dropdown, document.body)}
        </div>
    );
};
