import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { mmListSupplierReturns, type MmSupplierReturn } from '../../lib/mmRpc';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmWarehouseReturnsPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'supplierReturns'],
    queryFn: async (): Promise<MmSupplierReturn[]> => {
      const res = await mmListSupplierReturns();
      if (res.ok === false) throw new Error(res.message);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: Boolean(factoryId),
  });

  usePageHeader({ subtitle: 'Rolls sent back from red label.' }, []);

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
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>Return</th>
                <th className={thCls}>Supplier</th>
                <th className={thCls}>Reason</th>
                <th className={thCls}>Reference</th>
                <th className={thCls}>Rolls</th>
                <th className={thCls}>Qty</th>
                <th className={thCls}>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No supplier returns.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL, { id: row.id })}
                >
                  <td className={`${tdCls} font-semibold text-slate-800`}>{row.return_no}</td>
                  <td className={tdCls}>{row.supplier_name || '—'}</td>
                  <td className={tdCls}>{row.reason}</td>
                  <td className={tdCls}>{row.debit_note_ref || '—'}</td>
                  <td className={`${tdCls} tabular-nums`}>{row.roll_count}</td>
                  <td className={`${tdCls} tabular-nums`}>{formatQtyM(row.qty, 'm')}</td>
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
