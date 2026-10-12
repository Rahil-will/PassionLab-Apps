import React, { useEffect, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fabricTypeCategoryLine } from '../../components/MmFabricSummaryCard';
import type { MmExpectedStatus } from '../../lib/mmRpc';
import { useMmExpectedBoard } from '../../lib/useMmOps';
import { unitFormCountText } from '../../lib/mmUnitForm';
import { millWordDot, millWordText } from '../mill/millStatus';

const PAGE_SIZE = 20;

type ExpectedFilter = '' | 'all' | 'incoming' | 'met';

function fmtQty(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function unitsText(count: number | null | undefined, form: string | null | undefined): string {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return unitFormCountText({ [form || 'roll']: n });
}

function statusLabel(status: MmExpectedStatus): string {
  if (status === 'met') return 'Met';
  if (status === 'incoming') return 'Incoming';
  return 'Open';
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thReqCls =
  'px-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const thInCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const thRecvCls =
  'px-2 py-2 text-[10px] font-semibold text-emerald-800 uppercase tracking-wide border-b border-slate-200 bg-emerald-100 text-center whitespace-nowrap';
const thPassCls =
  'px-2 py-2 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 text-center whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdReqCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-blue-50/60';
const tdInCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdRecvCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-emerald-50';
const tdPassCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-green-50';
const tdCenterCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';

export default function MmWarehouseExpectedPage() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<ExpectedFilter>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterStatus]);

  const query = useMmExpectedBoard(filterStatus, debouncedSearch, page);
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total,
    start: total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, total),
  };

  usePageHeader({
    subtitle:
      'Required vs incoming and received. Still needed = required minus received. Passed is QC-passed stock.',
  });

  return (
    <PageShell
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search style, PO, buyer, color, fabric…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <SelectDropdown
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as ExpectedFilter)}
            options={[
              { value: '', label: 'Open' },
              { value: 'incoming', label: 'Incoming' },
              { value: 'met', label: 'Met' },
              { value: 'all', label: 'All' },
            ]}
            icon={Filter}
            className="w-36"
          />
        </div>
        {(total > PAGE_SIZE || debouncedSearch || filterStatus) && (
          <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {total} fabrics)
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '4%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thCls}>Style</th>
                <th className={thCls}>Buyer / PO</th>
                <th className={thCls}>Color</th>
                <th className={thCls}>Fabric</th>
                <th className={thCenterCls}>UOM</th>
                <th className={thReqCls}>Required</th>
                <th className={thInCls}>Incoming</th>
                <th className={thRecvCls}>Received</th>
                <th className={thRecvCls}>Rolls / laps</th>
                <th className={thPassCls}>Passed</th>
                <th className={thPassCls}>Passed units</th>
                <th className={thCenterCls}>Still needed</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No fabrics match this filter.
                  </td>
                </tr>
              )}
              {(query.data?.rows ?? []).map((row) => {
                const word = statusLabel(row.status);
                const typeCategory = fabricTypeCategoryLine(row.fabric_type, row.fabric_category);
                return (
                  <tr
                    key={`${row.order_id}-${row.colorway_id}-${row.fabric_line_id}`}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: row.order_id })}
                  >
                    <td className={`${tdCls} font-semibold text-slate-800`}>
                      <span className="block truncate">{row.style_name}</span>
                      {row.style_ref ? (
                        <span className="block text-[10px] font-medium text-slate-400 truncate">{row.style_ref}</span>
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
                      <span className="block truncate">{row.fabric_name || '—'}</span>
                      {typeCategory ? (
                        <span className="block text-[10px] text-slate-400 truncate">{typeCategory}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCenterCls} text-slate-500`}>{row.uom || '—'}</td>
                    <td className={tdReqCls}>
                      <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">{fmtQty(row.required_m)}</span>
                    </td>
                    <td className={tdInCls}>
                      <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">{fmtQty(row.qty_incoming_m)}</span>
                    </td>
                    <td className={tdRecvCls}>
                      <span className="block text-[11px] font-semibold text-emerald-900 tabular-nums">{fmtQty(row.qty_received_m)}</span>
                    </td>
                    <td className={tdRecvCls}>
                      <span className="block text-[10px] font-semibold text-emerald-900 tabular-nums">
                        {unitsText(row.rolls_received, row.unit_form_received)}
                      </span>
                    </td>
                    <td className={tdPassCls}>
                      <span className="block text-[11px] font-semibold text-green-900 tabular-nums">
                        {fmtQty(row.qty_passed_m)}
                      </span>
                    </td>
                    <td className={tdPassCls}>
                      <span className="block text-[10px] font-semibold text-green-900 tabular-nums">
                        {unitsText(row.rolls_passed, row.unit_form_passed)}
                      </span>
                    </td>
                    <td className={`${tdCenterCls} tabular-nums font-semibold`}>{fmtQty(row.qty_still_due_m)}</td>
                    <td className={tdCenterCls}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(word === 'Open' ? 'Due' : word)}`} />
                        <span className={`text-[10px] font-bold ${millWordText(word === 'Open' ? 'Due' : word)}`}>{word}</span>
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
