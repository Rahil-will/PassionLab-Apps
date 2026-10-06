import React, { useMemo } from 'react';
import { Send } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { formatQtyM, millDateLabel } from '../../lib/mmRollDraft';
import { millBatchRowStatus, millWordDot, millWordText } from './millStatus';
import { millDistinctLabel } from './millUnallocated';
import { useMmUnallocatedMill } from '../../lib/useMmOps';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thQtyCls =
  'px-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const thProdCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const thDispCls =
  'px-2 py-2 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 text-center whitespace-nowrap';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdQtyCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-blue-50/60';
const tdProdCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdDispCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-green-50';

function fmtQty(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export default function MmMillUnallocatedPage() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const millQuery = useMmUnallocatedMill();
  const batches = millQuery.data?.batches ?? [];
  const allRolls = millQuery.data?.rolls ?? [];
  const rollsByBatch = useMemo(() => {
    const map = new Map<string, typeof allRolls>();
    for (const roll of allRolls) {
      const list = map.get(roll.mill_batch_id) ?? [];
      list.push(roll);
      map.set(roll.mill_batch_id, list);
    }
    return map;
  }, [allRolls]);
  const waitingCount = allRolls.filter((roll) => roll.at_mill).length;

  usePageHeader({
    subtitle: 'Mill batches with no style yet. Open a row for fabric details.',
  });

  return (
    <PageShell
      loading={millQuery.isLoading}
      error={millQuery.error}
      onRetry={() => void millQuery.refetch()}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div>
            <h4 className="text-[13px] font-semibold text-slate-900">General PO batches</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {batches.length} batches · {waitingCount} rolls still at the mill.
            </p>
          </div>
          <DesktopWriteGate>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE)}
              >
                Allocate rolls
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={waitingCount === 0}
                onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH)}
              >
                <Send size={14} />
                Dispatch
              </Button>
            </div>
          </DesktopWriteGate>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thFirstCls}>Batch</th>
                <th className={thCls}>Fabric ref</th>
                <th className={thCls}>Color ref</th>
                <th className={thCls}>Fabric</th>
                <th className={thCenterCls}>Date</th>
                <th className={thQtyCls}>Qty</th>
                <th className={thProdCls}>Produced</th>
                <th className={thProdCls}>Produced rolls</th>
                <th className={thDispCls}>Dispatched</th>
                <th className={thDispCls}>Dispatched rolls</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No General PO mill batches yet.
                  </td>
                </tr>
              )}
              {batches.map((batch) => {
                const rolls = rollsByBatch.get(batch.id) ?? [];
                const atMill = rolls.filter((roll) => roll.at_mill);
                const dispatched = Number(batch.dispatched_count ?? rolls.length - atMill.length);
                const atMillQty = atMill.reduce((sum, roll) => sum + (Number(roll.length_m) || 0), 0);
                const dispatchedQty = rolls
                  .filter((roll) => !roll.at_mill)
                  .reduce((sum, roll) => sum + (Number(roll.length_m) || 0), 0);
                const producedQty = atMillQty + dispatchedQty;
                const status = millBatchRowStatus(atMill.length, dispatched, batch.roll_count);
                const colorRef = millDistinctLabel([
                  batch.color_ref,
                  ...rolls.map((roll) => roll.color_ref),
                ]);
                return (
                  <tr
                    key={batch.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() =>
                      requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE, { batchId: batch.id })
                    }
                  >
                    <td className={`${tdFirstCls} font-semibold text-slate-800`}>
                      <span className="block truncate">{batch.batch_no}</span>
                      {batch.mill_ref ? (
                        <span className="block text-[10px] font-medium text-slate-400 truncate">{batch.mill_ref}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCls} truncate`}>{batch.fabric_ref_name || '—'}</td>
                    <td className={`${tdCls} truncate`}>{colorRef}</td>
                    <td className={`${tdCls} truncate`}>{batch.fabric_type || '—'}</td>
                    <td className={`${tdCls} text-center truncate`}>{millDateLabel(batch.production_date)}</td>
                    <td className={tdQtyCls}>
                      <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">
                        {formatQtyM(producedQty || batch.qty_m, 'm')}
                      </span>
                    </td>
                    <td className={tdProdCls}>
                      <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">
                        {fmtQty(producedQty)}
                      </span>
                    </td>
                    <td className={tdProdCls}>
                      <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">
                        {batch.roll_count}
                      </span>
                    </td>
                    <td className={tdDispCls}>
                      <span className="block text-[11px] font-semibold text-green-900 tabular-nums">
                        {fmtQty(dispatchedQty)}
                      </span>
                    </td>
                    <td className={tdDispCls}>
                      <span className="block text-[11px] font-semibold text-green-900 tabular-nums">{dispatched}</span>
                    </td>
                    <td className={`${tdCls} text-center`}>
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(status.key)}`} />
                        <span className={`text-[10px] font-bold ${millWordText(status.key)}`}>{status.label}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
