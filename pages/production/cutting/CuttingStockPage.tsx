import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../components/ui';
import { PageShell } from '../../../components/layout/PageShell';
import { Pagination } from '../../../components/Pagination';
import { usePageHeader } from '../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import type { MmWarehouseStockRow } from '../../../modules/material/lib/mmRpc';
import { useMmWarehouseStock } from '../../../modules/material/lib/useMmOps';
import { formatQtyM, formatWhen } from '../../../modules/material/lib/mmRollDraft';
import { useFactoryModules } from '../../../core/modules/useModuleEnabled';

const PAGE_SIZE = 50;

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdCenterCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';

function openRow(
  row: MmWarehouseStockRow,
  navigate: (route: RoutePath, params?: Record<string, string>) => boolean,
) {
  if (row.store_challan_id) {
    navigate(RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL, { id: row.store_challan_id });
    return;
  }
  if (row.order_id) {
    navigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: row.order_id });
  }
}

export const CuttingStockPage: React.FC = () => {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const modulesQuery = useFactoryModules();
  const materialOn = Boolean(modulesQuery.data?.find((m) => m.module_key === 'material')?.enabled);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterBuyer]);

  const { data, isLoading, error, refetch } = useMmWarehouseStock(
    debouncedSearch,
    'cutting',
    filterBuyer,
    page,
    materialOn,
  );

  const buyers = useMemo(
    () =>
      [...new Set((data?.buyers ?? []).map((b) => (b.name ?? '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [data?.buyers],
  );
  const rows = data?.rows ?? [];
  const total = Number(data?.total) || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagination = {
    page: Math.min(page, pageCount),
    setPage,
    pageCount,
    total,
    start: total === 0 ? 0 : (Math.min(page, pageCount) - 1) * PAGE_SIZE + 1,
    end: Math.min(Math.min(page, pageCount) * PAGE_SIZE, total),
  };

  usePageHeader({
    subtitle: 'Issued rolls at the cutting store. Open a row for the store challan when linked.',
  });

  if (!materialOn) {
    return (
      <PageShell className="w-full pb-20">
        <Card className="p-8 text-center text-sm text-slate-500">
          Material module is off. Turn it on to see fabric at cutting.
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search roll, style, fabric…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <SelectDropdown
            value={filterBuyer}
            onChange={setFilterBuyer}
            options={[
              { value: '', label: 'All Buyers' },
              ...buyers.map((name) => ({ value: name, label: name })),
            ]}
            icon={Filter}
            className="w-full sm:w-36"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] table-fixed border-collapse">
            <thead>
              <tr>
                <th className={thCls}>Roll</th>
                <th className={thCls}>Style</th>
                <th className={thCls}>Color</th>
                <th className={thCls}>Fabric</th>
                <th className={thCls}>Buyer</th>
                <th className={thCenterCls}>Qty avail</th>
                <th className={thCls}>When</th>
                <th className={thCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No rolls at the cutting store.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => openRow(row, requestNavigate)}
                >
                  <td className={`${tdCls} font-semibold text-slate-900 truncate`}>
                    {row.unit_code || '—'}
                  </td>
                  <td className={`${tdCls} truncate`}>
                    <span className="font-medium">{row.style_name || '—'}</span>
                    {row.style_ref ? (
                      <span className="block text-[10px] text-slate-400 truncate">{row.style_ref}</span>
                    ) : null}
                  </td>
                  <td className={`${tdCls} truncate`}>{row.color_name || '—'}</td>
                  <td className={`${tdCls} truncate`}>{row.fabric_name || row.fabric_type || '—'}</td>
                  <td className={`${tdCls} truncate`}>{row.buyer_name || '—'}</td>
                  <td className={`${tdCenterCls} tabular-nums font-semibold`}>
                    {formatQtyM(Number(row.qty_available ?? row.qty ?? 0), row.uom)}
                  </td>
                  <td className={`${tdCls} text-slate-500 tabular-nums`}>{formatWhen(row.received_at)}</td>
                  <td className={`${tdCls}`}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-700" />
                      <span className="text-[10px] font-bold text-green-800">{row.status_label || 'Cutting store'}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...pagination} />
      </Card>
    </PageShell>
  );
};
