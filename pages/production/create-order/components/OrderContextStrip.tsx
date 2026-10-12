import React from 'react';

interface OrderContextStripProps {
  styleName: string;
  styleRef: string;
  buyerName?: string;
}

/** Thin context bar on Materials / Shipments / Review. */
export const OrderContextStrip: React.FC<OrderContextStripProps> = ({
  styleName,
  styleRef,
  buyerName,
}) => (
  <div className="col-span-12 rounded-xl border border-slate-200 bg-white px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 shadow-sm">
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Style</p>
      <p className="text-[12px] font-semibold text-slate-800 truncate">
        {styleName.trim() || '—'}
      </p>
    </div>
    <span className="hidden sm:block h-8 w-px bg-slate-200 shrink-0" />
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Style ref</p>
      <p className="text-[12px] font-semibold text-slate-700 truncate">
        {styleRef.trim() || '—'}
      </p>
    </div>
    {buyerName ? (
      <>
        <span className="hidden sm:block h-8 w-px bg-slate-200 shrink-0" />
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Buyer</p>
          <p className="text-[11px] font-medium text-slate-500 truncate">{buyerName}</p>
        </div>
      </>
    ) : null}
  </div>
);
