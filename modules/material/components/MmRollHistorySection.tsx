import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RoutePath } from '../../../types/shared';
import { useNavigationStore } from '../../../stores';
import { mmRollHistory } from '../lib/mmV4Rpc';
import { rollHistoryKindMeta, type MmRollHistoryEntry } from '../lib/mmIds';
import { formatWhen } from '../lib/mmRollDraft';

function docRoute(entry: MmRollHistoryEntry): { route: string; params: Record<string, string> } | null {
  if (!entry.doc_id) return null;
  switch (entry.doc_kind) {
    case 'receipt': return { route: RoutePath.MATERIAL_WAREHOUSE_RECEIPT, params: { id: entry.doc_id } };
    case 'process_challan': return { route: RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, params: { id: entry.doc_id } };
    case 'store_challan': return { route: RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, params: { id: entry.doc_id } };
    case 'allocation_note': return { route: RoutePath.MATERIAL_WAREHOUSE_ALLOCATION, params: { id: entry.doc_id } };
    default: return null;
  }
}

/**
 * Read-only roll timeline from mm_roll_history (V5 P2). Hidden entirely when
 * the RPC is missing/errors (backend not switched yet) or returns no rows.
 */
export function MmRollHistorySection({ rollId }: { rollId: string | null }) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const historyQ = useQuery({
    queryKey: ['mmRollHistory', rollId ?? ''] as const,
    queryFn: () => mmRollHistory(rollId as string),
    enabled: Boolean(rollId),
    staleTime: 30_000,
  });

  if (!rollId || historyQ.isLoading || historyQ.isError || !historyQ.data || historyQ.data.length === 0) {
    return null;
  }
  const entries = historyQ.data;

  return (
    <section>
      <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">History</h5>
      <ol className="relative border-l border-slate-200 ml-1.5 space-y-3">
        {entries.map((entry, idx) => {
          const meta = rollHistoryKindMeta(entry.kind);
          const route = docRoute(entry);
          const qty = entry.qty != null && Number(entry.qty) > 0
            ? `${Number(entry.qty).toLocaleString(undefined, { maximumFractionDigits: 2 })}${entry.uom ? ` ${entry.uom}` : ''}`
            : null;
          const move = entry.from_location || entry.to_location
            ? `${entry.from_location || '—'} → ${entry.to_location || '—'}`
            : null;
          return (
            <li key={`${entry.at ?? ''}-${entry.kind}-${idx}`} className="pl-4 relative">
              <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-slate-300 border border-white" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.chipClass}`}>
                  {entry.label || meta.label}
                </span>
                <span className="text-slate-500">{formatWhen(entry.at)}</span>
                {qty ? <span className="tabular-nums font-medium text-slate-700">{qty}</span> : null}
                {move ? <span className="text-slate-600">{move}</span> : null}
                {entry.by_name ? <span className="text-slate-500">by {entry.by_name}</span> : null}
                {entry.doc_no ? (
                  route ? (
                    <button
                      type="button"
                      className="font-medium text-blue-700 hover:underline"
                      onClick={() => requestNavigate(route.route as RoutePath, route.params)}
                    >
                      {entry.doc_no}
                    </button>
                  ) : (
                    <span className="font-medium text-slate-700">{entry.doc_no}</span>
                  )
                ) : null}
              </div>
              {entry.note ? <p className="mt-0.5 text-slate-500">{entry.note}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
