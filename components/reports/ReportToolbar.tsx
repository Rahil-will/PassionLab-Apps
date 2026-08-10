import React from 'react';
import format from 'date-fns/format';
import { Search, RefreshCw, Filter, RotateCcw, WifiOff } from 'lucide-react';
import { SelectDropdown, Spinner } from '../ui';
import { DateRangePicker } from '../DateRangePicker';

export interface ReportToolbarProps {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  onSearchFocus?: () => void;
  searchPlaceholder?: string;
  /** Single-day mode (legacy) */
  date?: string;
  onDateChange?: (value: string) => void;
  /** Date range mode */
  dateFrom?: string;
  dateTo?: string;
  onDateRangeChange?: (from: string, to: string) => void;
  showDate?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastUpdated?: Date | null;
  /** When true, show an offline badge and disable refresh if wired. */
  isOffline?: boolean;
  /** When true, displayed data may be from cache (stale-while-revalidate). */
  isCachedView?: boolean;
  onReset?: () => void;
  children?: React.ReactNode;
}

function toYmd(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd');
}

/** Status Tracker–style filter bar for report pages. */
export const ReportToolbar: React.FC<ReportToolbarProps> = ({
  searchQuery = '',
  onSearchChange,
  onSearchSubmit,
  onSearchFocus,
  searchPlaceholder = 'Search style, PO…',
  date,
  onDateChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  showDate = true,
  onRefresh,
  refreshing = false,
  lastUpdated,
  isOffline = false,
  isCachedView = false,
  onReset,
  children,
}) => (
  <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between bg-slate-50/50 gap-3 relative z-10">
    {onSearchChange ? (
      <div className="flex items-center gap-2 flex-1 min-w-0 w-full sm:max-w-sm">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input
          className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 w-full min-w-0"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSearchSubmit?.(e.currentTarget.value);
            }
          }}
          onFocus={onSearchFocus}
        />
      </div>
    ) : (
      <div className="flex-1 min-w-[120px]" />
    )}

    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto sm:justify-end">
      {showDate && onDateRangeChange && dateFrom !== undefined && dateTo !== undefined && (
        <DateRangePicker
          variant="pill"
          dropdownAlign="right"
          className="w-full sm:w-auto"
          value={{
            startDate: new Date(`${dateFrom}T00:00:00`).toISOString(),
            endDate: new Date(`${dateTo}T23:59:59`).toISOString(),
          }}
          onChange={(range) => {
            onDateRangeChange(toYmd(range.startDate), toYmd(range.endDate));
          }}
        />
      )}
      {showDate && !onDateRangeChange && date !== undefined && onDateChange && (
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm w-full sm:w-auto">
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="text-xs border-none focus:ring-0 text-slate-700 font-medium cursor-pointer bg-transparent w-full sm:w-[7.5rem]"
          />
        </div>
      )}
      {children}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          title="Clear filters"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      )}
      {(isOffline || isCachedView) && (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
            isOffline
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          {isOffline ? <WifiOff size={10} aria-hidden /> : null}
          {isOffline ? 'Offline' : 'Cached'}
        </span>
      )}
      {lastUpdated && (
        <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap text-center sm:text-left">
          {isOffline || isCachedView ? 'Cached at' : 'Updated'} {format(lastUpdated, 'HH:mm:ss')}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || isOffline}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors self-center sm:self-auto ${
            refreshing ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
          }`}
          title="Refresh report"
        >
          {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />}
        </button>
      )}
    </div>
  </div>
);

export { Filter };
