import React from 'react';
import { Skeleton } from '../Skeleton';

/** Full-page skeleton for order / colorway detail until store + metrics are ready. */
export const StyleDetailsPageSkeleton: React.FC = () => (
  <div className="space-y-8 animate-pulse pb-32" aria-hidden>
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-col lg:flex-row">
        <div className="flex gap-4 p-5 flex-1 border-b lg:border-b-0 lg:border-r border-slate-100">
          <Skeleton variant="rectangular" className="w-20 h-20 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white px-4 py-4">
              <Skeleton className="h-2.5 w-16 mb-2" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className="p-4 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid grid-cols-6 gap-2">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton key={j} className="h-5" />
            ))}
          </div>
        ))}
      </div>
    </div>

    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex justify-between">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-7 w-40 rounded-lg" />
      </div>
      <div className="p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-28" />
          <Skeleton variant="rectangular" className="h-28 w-full rounded-lg" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-32" />
          <Skeleton variant="rectangular" className="h-40 w-full rounded-lg" />
        </div>
      </div>
    </div>
  </div>
);
