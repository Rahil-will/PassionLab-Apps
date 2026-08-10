import React from 'react';
import { Skeleton } from '../Skeleton';

/** Full-page skeleton for order / colorway details (CreateOrderMaster). */
export const OrderMasterDetailSkeleton: React.FC = () => (
  <div className="grid grid-cols-12 gap-6 animate-pulse" aria-hidden>
    <div className="col-span-12 flex flex-col lg:flex-row gap-6">
      <div className="lg:w-[70%] w-full rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton variant="rectangular" className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton variant="rectangular" className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
      <div className="lg:w-[30%] w-full rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-[280px]">
        <Skeleton variant="rectangular" className="flex-1 min-h-[12rem] rounded-none" />
        <div className="border-t border-slate-200 p-3 space-y-2">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton variant="rectangular" className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>

    <div className="col-span-12 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex justify-between">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-7 w-24 rounded-lg" />
      </div>
      <div className="px-2 py-2 border-b border-slate-100 bg-slate-50/80 grid grid-cols-[2rem_1fr_repeat(6,3.5rem)] gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 mx-1" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, row) => (
        <div
          key={row}
          className={`grid grid-cols-[2rem_1fr_repeat(6,3.5rem)] gap-2 px-2 py-2 border-b border-slate-50 ${
            row % 2 ? 'bg-slate-50/50' : 'bg-white'
          }`}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5 mx-1" />
          ))}
        </div>
      ))}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex gap-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>

    <div className="col-span-12 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton variant="rectangular" className="h-32 w-full rounded-lg" />
    </div>
  </div>
);
