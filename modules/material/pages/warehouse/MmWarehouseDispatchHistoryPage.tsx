import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import type { MmStoreChallanHeader } from '../../lib/mmRpc';
import {
  inboundFabricCategory,
  inboundStatusDot,
  inboundStatusText,
  storeDispatchStatusLabel,
} from '../../lib/inboundDisplay';
import { useMmStoreChallans } from '../../lib/useMmOps';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';

const PAGE_SIZE = 20;

type StatusFilter = '' | 'pending' | 'partial' | 'received';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thRollsCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const tdCls = 'px-2.5 py-2 text-[11px] text-slate-700 border-b border-slate-100';
const tdRollsCls = 'px-2 py-2 text-center border-b border-slate-100 bg-yellow-50';

function haystack(row: MmStoreChallanHeader): string {
  return [
    row.challan_no,
    row.reference_no,
    row.style_name,
    row.style_ref,
    row.buyer_name,
    row.po_number,
    row.color_name,
    row.fabric_name,
    row.fabric_type,
    row.fabric_category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function sentStatus(row: MmStoreChallanHeader): 'pending' | 'partial' | 'received' {
  if (row.status === 'received') return 'received';
  if (row.status === 'partial') return 'partial';
  return 'pending';
}

export default function MmWarehouseDispatchHistoryPage() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { data, isLoading, error, refetch } = useMmStoreChallans('');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterBuyer, filterStatus]);

  const buyers = useMemo(() => {
    const names = new Set<string>();
    for (const row of data ?? []) {
      const name = (row.buyer_name ?? '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return [...(data ?? [])]
      .filter((row) => {
        if (filterStatus && sentStatus(row) !== filterStatus) return false;
        if (filterBuyer && (row.buyer_name ?? '') !== filterBuyer) return false;
        if (q && !haystack(row).includes(q)) return false;
        return true;
      })
      .sort((a, b) => String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? '')));
  }, [data, debouncedSearch, filterBuyer, filterStatus]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: filtered.length,
    start: filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, filtered.length),
  };

  usePageHeader({
    subtitle: 'Warehouse to cutting challans. Open a row for the rolls on that challan.',
  });

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
              placeholder="Search challan, style, buyer, fabric…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:ml-auto">
            <SelectDropdown
              value={filterStatus}
              onChange={(v) => setFilterStatus(v as StatusFilter)}
              options={[
                { value: '', label: 'All challans' },
                { value: 'pending', label: 'Pending receive' },
                { value: 'partial', label: 'Partial' },
                { value: 'received', label: 'Received at cutting' },
              ]}
              icon={Filter}
              className="w-44"
            />
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
        </div>
        {(filtered.length > PAGE_SIZE || filterStatus || filterBuyer || debouncedSearch) && (
          <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {filtered.length}{' '}
            challans)
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thCls}>When</th>
                <th className={thCls}>Challan</th>
                <th className={thCls}>Challan ref</th>
                <th className={thCls}>Style</th>
                <th className={thCls}>Buyer / PO</th>
                <th className={thCls}>Color</th>
                <th className={thCls}>Fabric</th>
                <th className={thRollsCls}>Rolls</th>
                <th className={thCenterCls}>Qty</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No dispatch challans match this filter.
                  </td>
                </tr>
              )}
              {pageRows.map((row) => {
                const word = storeDispatchStatusLabel(row.status);
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: row.id })}
                  >
                    <td className={`${tdCls} whitespace-nowrap text-slate-600`}>{formatWhen(row.sent_at)}</td>
                    <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{row.challan_no}</td>
                    <td className={`${tdCls} truncate text-slate-500`}>{row.reference_no || '—'}</td>
                    <td className={tdCls}>
                      <span className="block font-medium truncate">{row.style_name}</span>
                      {row.style_ref ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.style_ref}</span>
                      ) : null}
                    </td>
                    <td className={tdCls}>
                      <span className="block truncate">{row.buyer_name || '—'}</span>
                      {row.po_number ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.po_number}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCls} truncate`}>{row.color_name || '—'}</td>
                    <td className={tdCls}>
                      <span className="block truncate">{row.fabric_name || row.fabric_type || '—'}</span>
                      <span className="block text-[10px] text-slate-400 truncate">{inboundFabricCategory(row)}</span>
                    </td>
                    <td className={tdRollsCls}>
                      <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">{row.roll_count}</span>
                    </td>
                    <td className={`${tdCls} text-center tabular-nums font-semibold`}>{formatQtyM(row.qty, row.uom)}</td>
                    <td className={`${tdCls} text-center`}>
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(row.status)}`} />
                        <span className={`text-[10px] font-bold ${inboundStatusText(row.status)}`}>{word}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination {...pagination} />
      </Card>
    </PageShell>
  );
}
