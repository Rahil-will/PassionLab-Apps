import React from 'react';
import { CardSkeleton, ListSkeleton, Spinner, TableSkeleton } from '../ui';

/** Shared enter animation — match Department Schedule (500ms fade). */
export const PAGE_ENTER_CLASS = 'animate-in fade-in duration-500';

export type PageSkeletonVariant = 'table' | 'list' | 'card' | 'spinner';

interface PageShellProps {
  loading?: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  skeleton?: PageSkeletonVariant;
  className?: string;
  children?: React.ReactNode;
}

export const PageShell: React.FC<PageShellProps> = ({
  loading = false,
  error,
  onRetry,
  skeleton = 'table',
  className = '',
  children,
}) => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.';

  if (error) {
    return (
      <div className={`${PAGE_ENTER_CLASS} ${className}`.trim()}>
        <div className="bg-white border border-red-200 rounded-xl p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-red-700 mb-2">Failed to load</p>
          <p className="text-xs text-slate-500 mb-4">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    if (skeleton === 'spinner') {
      return (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      );
    }
    if (skeleton === 'card') {
      return (
        <div className="space-y-4 pb-20">
          <CardSkeleton count={4} />
        </div>
      );
    }
    if (skeleton === 'list') {
      return (
        <div className="pb-20">
          <ListSkeleton />
        </div>
      );
    }
    return (
      <div className="pb-20">
        <TableSkeleton rows={8} />
      </div>
    );
  }

  return <div className={`${PAGE_ENTER_CLASS} ${className}`.trim()}>{children ?? null}</div>;
};

interface PageToolbarCardProps {
  children: React.ReactNode;
  className?: string;
}

/** Page-specific controls row — sits below the breadcrumb header card. */
export const PageToolbarCard: React.FC<PageToolbarCardProps> = ({ children, className = '' }) => (
  <div
    className={`bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 mb-4 flex flex-wrap items-center gap-3 ${className}`}
  >
    {children}
  </div>
);
