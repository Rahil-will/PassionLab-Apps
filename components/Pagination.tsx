import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  setPage: (page: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageCount,
  total,
  start,
  end,
  setPage,
}) => {
  if (pageCount <= 1) return null;

  const buttonBase = 'p-1 rounded-md transition-colors';
  const disabledClass = 'text-slate-300 cursor-not-allowed';
  const enabledClass = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-t border-slate-100 text-[10px] text-slate-500">
      <span>
        Showing {start}-{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={`${buttonBase} ${page <= 1 ? disabledClass : enabledClass}`}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="tabular-nums min-w-[4.5rem] text-center">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className={`${buttonBase} ${page >= pageCount ? disabledClass : enabledClass}`}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
