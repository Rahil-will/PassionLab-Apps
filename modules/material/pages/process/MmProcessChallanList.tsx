import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { mmListProcessChallans, type MmProcessChallan } from '../../lib/mmRpc';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';
import { MmMillProcessSendPanel } from './MmMillProcessSendPanel';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

function statusLabel(status: MmProcessChallan['status']): string {
  if (status === 'returned') return 'Back';
  if (status === 'partial') return 'Partial';
  return 'Out';
}

export default function MmProcessChallanList() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'processChallans'],
    queryFn: async (): Promise<MmProcessChallan[]> => {
      const res = await mmListProcessChallans();
      if (res.ok === false) throw new Error(res.message);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: Boolean(factoryId),
  });

  usePageHeader({ subtitle: 'Pick mill rolls still at the mill and send them for processing. Open a sent challan below to receive them back.' });
  const rows = query.data ?? [];

  return (
    <PageShell
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton="table"
      className="w-full pb-20"
    >
      <MmMillProcessSendPanel />
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[11px] font-semibold text-slate-800">Already sent</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Open a challan to receive rolls back. This is not where you send fabric.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>Challan</th>
                <th className={thCls}>From</th>
                <th className={thCls}>Vendor</th>
                <th className={thCls}>Process</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Rolls</th>
                <th className={thCls}>Qty</th>
                <th className={thCls}>When</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    Loading sent challans…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No process challans yet.
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: row.id })}
                >
                  <td className={`${tdCls} font-semibold text-slate-800`}>{row.challan_no}</td>
                  <td className={tdCls}>{row.origin === 'mill' ? 'Mill' : 'Warehouse'}</td>
                  <td className={tdCls}>{row.vendor_name}</td>
                  <td className={tdCls}>{row.process_name}</td>
                  <td className={tdCls}>{statusLabel(row.status)}{row.still_out > 0 && row.status !== 'open' ? ` · ${row.still_out} out` : ''}</td>
                  <td className={`${tdCls} tabular-nums`}>{row.roll_count}</td>
                  <td className={`${tdCls} tabular-nums`}>{formatQtyM(row.qty)}</td>
                  <td className={tdCls}>{formatWhen(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
