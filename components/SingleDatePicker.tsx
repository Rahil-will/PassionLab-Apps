import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar } from 'react-date-range';
import addMonths from 'date-fns/addMonths';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import startOfMonth from 'date-fns/startOfMonth';
import subMonths from 'date-fns/subMonths';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { computeDropdownBelowPosition } from '../lib/popoverPosition';
import { tokens } from '../lib/designTokens';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

export interface SingleDatePickerProps {
  value: string;
  onChange: (isoDate: string) => void;
  className?: string;
  minDate?: string;
  maxDate?: string;
  /** Shown when value is empty */
  emptyLabel?: string;
  /** `compact` fits table cells on Create Order shipment plan */
  size?: 'default' | 'compact';
  align?: 'start' | 'center';
  /**
   * `pill` = curved blue trigger (Order Received / Job Card).
   * `cell` = flat table-cell trigger; calendar popup unchanged.
   */
  trigger?: 'pill' | 'cell';
}

function toDate(iso: string): Date {
  return parseISO(`${iso}T12:00:00`);
}

function toIso(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export const SingleDatePicker: React.FC<SingleDatePickerProps> = ({
  value,
  onChange,
  className = '',
  minDate,
  maxDate,
  emptyLabel = 'Select date',
  size = 'default',
  align = 'start',
  trigger = 'pill',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(value?.trim() ? toDate(value) : new Date()),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const hasValue = Boolean(value?.trim());
  const selected = hasValue ? toDate(value) : new Date();
  const isCell = trigger === 'cell';

  useEffect(() => {
    if (!isOpen) setViewMonth(startOfMonth(hasValue ? toDate(value) : new Date()));
  }, [value, isOpen, hasValue]);

  const updateMenuPosition = () => {
    if (!containerRef.current || !menuRef.current) return;
    const triggerEl = containerRef.current.getBoundingClientRect();
    const panelW = menuRef.current.offsetWidth;
    const panelH = menuRef.current.offsetHeight;
    const { left, top } = computeDropdownBelowPosition(triggerEl, panelW, panelH, 6);
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
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const min = minDate ? toDate(minDate) : undefined;
  const max = maxDate ? toDate(maxDate) : undefined;

  const dropdown = isOpen ? (
    <div
      ref={menuRef}
      className="fixed z-[300] bg-white rounded-xl shadow-lg border border-slate-200 p-2 max-w-[calc(100vw-1rem)] [&_.rdrCalendarWrapper]:text-[11px] [&_.rdrMonth]:w-[min(15.5rem,calc(100vw-2.5rem))] [&_.rdrMonthAndYearWrapper]:min-h-[1.75rem] [&_.rdrWeekDay]:text-[9px] [&_.rdrWeekDay]:leading-none [&_.rdrDay]:h-8 [&_.rdrDay]:w-8 [&_.rdrDayNumber]:text-[11px] [&_.rdrDays]:gap-0 [&_.rdrSelected]:rounded-full"
      style={{ top: menuPos.top, left: menuPos.left }}
    >
      <div className="flex items-center justify-between gap-2 mb-1 px-0.5">
        <button
          type="button"
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100"
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[11px] font-semibold text-slate-800">{format(viewMonth, 'MMM yyyy')}</span>
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100"
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <Calendar
        date={hasValue ? selected : undefined}
        onChange={(d) => {
          if (!d) return;
          onChange(toIso(d));
          setIsOpen(false);
        }}
        shownDate={viewMonth}
        minDate={min}
        maxDate={max}
        color="#3b82f6"
        showDateDisplay={false}
      />
    </div>
  ) : null;

  const displayValue = hasValue
    ? isCell
      ? format(selected, 'yyyy-MM-dd')
      : format(selected, 'EEE, d MMM')
    : emptyLabel;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={
          isCell
            ? `relative flex items-center justify-between gap-1 w-full h-11 min-h-[2.75rem] px-2 text-[11px] bg-transparent border-0 rounded-none outline-none tabular-nums text-left select-none transition-colors ${
                isOpen
                  ? 'bg-blue-50/50 ring-1 ring-inset ring-blue-400 text-slate-800'
                  : hasValue
                    ? 'text-slate-800 hover:bg-slate-50/60'
                    : 'text-slate-300 hover:bg-slate-50/60'
              }`
            : `relative flex items-center gap-1.5 rounded-full border font-medium transition-colors min-w-0 w-full select-none ${
                size === 'compact' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              } ${align === 'center' ? 'justify-center' : 'justify-between'} ${
                isOpen
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : hasValue
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`
        }
      >
        {!isCell && align !== 'center' && (
          <CalendarIcon size={12} className="text-blue-500 shrink-0" />
        )}
        <span
          className={`tabular-nums truncate min-w-0 ${
            isCell ? 'flex-1' : align === 'center' ? 'text-center' : ''
          }`}
        >
          {displayValue}
        </span>
        {!isCell && (
          <ChevronDown
            size={size === 'compact' ? 11 : 12}
            className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''} ${
              align === 'center' ? 'absolute right-2' : 'ml-auto'
            }`}
          />
        )}
      </button>
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
};

export interface LabeledDatePickerProps {
  label: string;
  value: string;
  onChange: (isoDate: string) => void;
  minDate?: string;
  maxDate?: string;
  className?: string;
  labelClassName?: string;
  /** `card` = bordered wrapper; `form` = full field; `pill` = dropdown-style pill only */
  variant?: 'card' | 'form' | 'pill';
}

/** Form field wrapper — matches Input / SelectDropdown on Create Order when variant=form. */
export const LabeledDatePicker: React.FC<LabeledDatePickerProps> = ({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  className = '',
  labelClassName = 'block font-medium text-slate-700 mb-1.5',
  variant = 'card',
}) => (
  <div className={`w-full ${className}`}>
    {label ? (
      <label className={labelClassName} style={{ fontSize: tokens.fontSize.body }}>{label}</label>
    ) : null}
    {variant === 'pill' ? (
      <SingleDatePicker
        value={value}
        onChange={onChange}
        minDate={minDate}
        maxDate={maxDate}
        size="compact"
        className="w-full"
        emptyLabel="Select date"
      />
    ) : (
    <div
      className={
        variant === 'form'
          ? 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 shadow-sm focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100 transition-all'
          : 'flex items-center bg-white px-1.5 py-1 rounded-xl border border-slate-200 shadow-sm w-full'
      }
    >
      <SingleDatePicker
        value={value}
        onChange={onChange}
        minDate={minDate}
        maxDate={maxDate}
        className="w-full"
        emptyLabel="Select date"
      />
    </div>
    )}
  </div>
);
