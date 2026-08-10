import React from 'react';
import { Skeleton } from '../Skeleton';

/** Detail panel skeleton — matches order completion layout until all async data is ready. */
export const OrderCompletionDetailSkeleton: React.FC = () => (
  <div className="space-y-5 animate-pulse" aria-hidden>
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-col xl:flex-row">
        <div className="flex gap-4 p-4 xl:p-5 flex-1 border-b xl:border-b-0 xl:border-r border-slate-100">
          <Skeleton variant="rectangular" className="w-20 h-20 xl:w-24 xl:h-24 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-4 w-36" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-28 rounded-md" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-100 flex-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white px-3 py-3">
              <Skeleton className="h-2 w-14 mb-2" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70">
        <Skeleton variant="rectangular" className="h-9 w-full max-w-md rounded-lg" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-slate-100 border-t border-slate-100">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-white px-3 py-3">
            <Skeleton className="h-2 w-16 mb-2" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>

    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex gap-3 p-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" className="h-24 w-28 rounded-xl shrink-0" />
        ))}
      </div>
    </div>

    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="p-2 space-y-1">
        <div className="grid grid-cols-8 gap-1 px-2 py-2 bg-slate-50 rounded-lg">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-3 mx-auto w-10" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="grid grid-cols-8 gap-1 px-2 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 mx-auto w-8" />
            ))}
          </div>
        ))}
      </div>
    </div>
  </div>
);
