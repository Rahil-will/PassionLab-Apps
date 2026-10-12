import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useNavigationStore } from '../../../../stores';
import { mmListEndBitReturns, type MmEndBitReturn } from '../../lib/mmRpc';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmWarehouseEndBitsPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'endBitReturns'],
    queryFn: async (): Promise<MmEndBitReturn[]> => {
      const res = await mmListEndBitReturns();
      if (res.ok === false) throw new Error(res.message);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: Boolean(factoryId),
  });

  usePageHeader({ subtitle: 'End bits returned from a cutting lay. Written when the floor marks a remnant as return.' }, []);

  const rows = query.data ?? [];

  return (
    <PageShell
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>Roll</th>
                <th className={thCls}>Style</th>
                <th className={thCls}>Qty</th>
                <th className={thCls}>Mill shade</th>
                <th className={thCls}>Tested shade</th>
                <th className={thCls}>Location</th>
                <th className={thCenterCls}>Status</th>
                <th className={thCls}>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No end-bit returns.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className={`${tdCls} font-semibold text-slate-800`}>{row.unit_code || '—'}</td>
                  <td className={tdCls}>
                    <span className="block truncate">{row.style_name || '—'}</span>
                    {row.style_ref ? (
                      <span className="block text-[10px] text-slate-400 truncate">{row.style_ref}</span>
                    ) : null}
                  </td>
                  <td className={`${tdCls} tabular-nums`}>{formatQtyM(row.qty, row.qty_uom)}</td>
                  <td className={tdCls}>{row.mill_shade || '—'}</td>
                  <td className={tdCls}>{row.tested_shade || '—'}</td>
                  <td className={tdCls}>{row.location_name || '—'}</td>
                  <td className={`${tdCls} text-center`}>{row.status ? row.status.replace(/_/g, ' ') : '—'}</td>
                  <td className={tdCls}>{formatWhen(row.returned_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
