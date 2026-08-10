import React from 'react';
import { Skeleton } from '../Skeleton';

/** Layout-shaped placeholder while style report data loads or refreshes. */
export const StyleReportSkeleton: React.FC = () => (
  <div className="space-y-5 animate-pulse" aria-hidden>
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-2/3 max-w-md" />
      <div className="flex gap-2 flex-wrap">
        <Skeleton className="h-6 w-20 rounded-md" />
        <Skeleton className="h-6 w-28 rounded-md" />
        <Skeleton className="h-6 w-24 rounded-md" />
      </div>
    </div>

    <div className="rounded-2xl bg-slate-100/90 border border-slate-200/90 p-5 sm:p-6 space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Skeleton variant="circular" width={14} height={14} />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
          <div className="bg-slate-50 px-4 py-3 flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, row) => (
            <div key={row} className="px-4 py-3 flex gap-4 border-t border-slate-100">
              {Array.from({ length: 6 }).map((_, col) => (
                <Skeleton key={col} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton variant="rectangular" className="h-40 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton variant="rectangular" className="h-32 w-full rounded-xl" />
          <Skeleton variant="rectangular" className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>

    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <Skeleton className="h-4 w-48" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  </div>
);
