import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../../lib/queryKeys';
import { useBuyersCatalog } from '../../../../lib/queries/settingsSlices';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fmtUomQty } from '../../lib/fabricStock';
import { useMmFabrics } from '../../lib/useMmFabrics';
import {
  mmStyleFabricPosition,
  type MmStyleFabricPositionRow,
} from '../../lib/mmV4Rpc';

const PAGE_SIZE = 20;

type StatusFilter = '' | 'not_started' | 'partial' | 'covered' | 'closed';

function formLine(rolls: number, laps: number, units = 0): string {
  const parts: string[] = [];
  if (rolls > 0) parts.push(`${rolls} ${rolls === 1 ? 'roll' : 'rolls'}`);
  if (laps > 0) parts.push(`${laps} ${laps === 1 ? 'lap' : 'laps'}`);
  if (units > 0) parts.push(`${units} ${units === 1 ? 'unit' : 'units'}`);
  return parts.join(' · ');
}

function QtyForms({ className, qty, forms, hint }: { className: string; qty: string; forms: string; hint?: string }) {
  return (
    <td className={className}>
      <span className="block text-[11px] font-semibold tabular-nums truncate">{qty}</span>
      {forms ? <span className="block text-[10px] font-medium tabular-nums truncate">{forms}</span> : null}
      {hint ? <span className="block text-[10px] truncate">{hint}</span> : null}
    </td>
  );
}

function statusMark(status: string): { label: string; dot: string; text: string } {
  if (status === 'partial') return { label: 'Partial', dot: 'bg-amber-500', text: 'text-amber-700' };
  if (status === 'covered') return { label: 'Covered', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  if (status === 'closed') return { label: 'Closed', dot: 'bg-slate-400', text: 'text-slate-500' };
  if (status === 'not_started') return { label: 'Not started', dot: 'bg-slate-300', text: 'text-slate-500' };
  return { label: status || '—', dot: 'bg-slate-300', text: 'text-slate-500' };
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thReqCls =
  'px-2.5 py-2 text-[10px] font-semibold text-blue-800 uppercase tracking-wide border-b border-blue-100 bg-blue-50 text-center whitespace-nowrap overflow-hidden';
const thProdCls =
  'px-2.5 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-yellow-100 bg-yellow-100 text-center whitespace-nowrap overflow-hidden';
const thProcCls =
  'px-2.5 py-2 text-[10px] font-semibold text-blue-800 uppercase tracking-wide border-b border-blue-100 bg-blue-100 text-center whitespace-nowrap overflow-hidden';
const thDispCls =
  'px-2.5 py-2 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-green-100 bg-green-100 text-center whitespace-nowrap overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdReqCls = 'px-2.5 py-2.5 text-center border-b border-blue-50 bg-blue-50/70 max-w-0 overflow-hidden';
const tdProdCls = 'px-2.5 py-2.5 text-center border-b border-yellow-50 bg-yellow-50 max-w-0 overflow-hidden';
const tdProcCls = 'px-2.5 py-2.5 text-center border-b border-blue-50 bg-blue-50 max-w-0 overflow-hidden';
const tdDispCls = 'px-2.5 py-2.5 text-center border-b border-green-50 bg-green-50 max-w-0 overflow-hidden';

export default function MmMillBoardPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const onlyShort = useNavigationStore((s) => s.routeParams.only_short);
  const { buyers } = useBuyersCatalog(factoryId, 'core');
  const { rows: fabrics } = useMmFabrics({});

  const [searchQuery, setSearchQuery] = useState('');
  const [filterFabric, setFilterFabric] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const shortOnly = onlyShort === '1' || onlyShort === 'true';

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterBuyer, filterFabric, filterStatus, shortOnly]);

  const boardQuery = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'styleBoard', debouncedSearch, filterBuyer, filterFabric, filterStatus, shortOnly] as const,
    queryFn: async () => {
      const res = await mmStyleFabricPosition({
        search: debouncedSearch || null,
        buyer: filterBuyer || null,
        fabric_id: filterFabric || null,
        status: filterStatus || null,
        only_short: shortOnly,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const rows = boardQuery.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: rows.length,
    start: rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, rows.length),
  };

  const fabricOptions = useMemo(
    () => fabrics.map((fabric) => ({ value: fabric.id, label: `${fabric.code} · ${fabric.name}` })),
    [fabrics],
  );

  usePageHeader({
    subtitle: 'One row per style, colour, and fabric. Open a row for the line.',
  });

  const openLine = (row: MmStyleFabricPositionRow) => {
    if (!row.order_id || !row.colorway_id || !row.colorway_material_id) return;
    requestNavigate(RoutePath.MATERIAL_MILL_LINE, {
      orderId: row.order_id,
      colorwayId: row.colorway_id,
      fabricLineId: row.colorway_material_id,
      ...(row.style_material_id ? { styleMaterialId: row.style_material_id } : {}),
    });
  };

  return (
    <PageShell
      loading={boardQuery.isLoading}
      error={boardQuery.error}
      onRetry={() => { void boardQuery.refetch(); }}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search style, PO, buyer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:ml-auto">
            <SelectDropdown
              value={filterFabric}
              onChange={setFilterFabric}
              options={[{ value: '', label: 'All fabrics' }, ...fabricOptions]}
              icon={Filter}
              className="w-44"
            />
            <SelectDropdown
              value={filterStatus}
              onChange={(v) => setFilterStatus(v as StatusFilter)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'not_started', label: 'Not started' },
                { value: 'partial', label: 'Partial' },
                { value: 'covered', label: 'Covered' },
                { value: 'closed', label: 'Closed' },
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={filterBuyer}
              onChange={setFilterBuyer}
              options={[
                { value: '', label: 'All Buyers' },
                ...buyers.map((b) => ({ value: b.name, label: b.name })),
              ]}
              icon={Filter}
              className="w-full sm:w-36"
            />
          </div>
        </div>
        <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
          Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {rows.length})
          {shortOnly ? ' · only short' : ''}
        </div>
        <div className="overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thFirstCls}>Style</th>
                <th className={thCls}>Buyer / PO</th>
                <th className={thCls}>Colour</th>
                <th className={thCls}>Fabric</th>
                <th className={thCenterCls}>UOM</th>
                <th className={thReqCls}>Required</th>
                <th className={thProdCls}>At mill</th>
                <th className={thProcCls}>Processing</th>
                <th className={thDispCls}>Warehouse</th>
                <th className={thCenterCls}>Issued</th>
                <th className={thCenterCls}>Short</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No style fabrics match.
                  </td>
                </tr>
              )}
              {pageRows.map((row) => {
                const uom = row.uom === 'kg' ? 'kg' : 'm';
                const mark = statusMark(row.status);
                return (
                  <tr
                    key={`${row.order_id}-${row.colorway_id}-${row.colorway_material_id ?? row.style_material_id}`}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => openLine(row)}
                  >
                    <td className={`${tdFirstCls} font-semibold text-slate-800`}>
                      <span className="block truncate">{row.style_name || '—'}</span>
                      {row.style_ref ? <span className="block text-[10px] font-medium text-slate-400 truncate">{row.style_ref}</span> : null}
                    </td>
                    <td className={tdCls}>
                      <span className="block truncate">{row.buyer_name || '—'}</span>
                      <span className="block text-[10px] text-slate-400 truncate">{row.po_number || '—'}</span>
                    </td>
                    <td className={`${tdCls} truncate`}>{row.colour || row.colorway_name || '—'}</td>
                    <td className={tdCls}>
                      <span className="block truncate font-medium text-slate-800">{row.fabric?.name || row.line_name || '—'}</span>
                      <span className="block truncate text-[10px] text-slate-400">{row.fabric?.code || '—'}</span>
                    </td>
                    <td className={`${tdCls} text-center uppercase`}>{uom}</td>
                    <QtyForms className={`${tdReqCls} text-blue-800`} qty={fmtUomQty(row.required, uom)} forms="" />
                    <QtyForms className={`${tdProdCls} text-yellow-900`} qty={fmtUomQty(row.at_mill.qty, uom)} forms={formLine(row.at_mill.rolls, row.at_mill.laps)} />
                    <QtyForms className={`${tdProcCls} text-blue-900`} qty={fmtUomQty(row.at_processing.qty, uom)} forms={formLine(row.at_processing.rolls, row.at_processing.laps)} />
                    <QtyForms
                      className={`${tdDispCls} text-green-900`}
                      qty={fmtUomQty(row.in_warehouse.qty, uom)}
                      forms={formLine(row.in_warehouse.rolls, row.in_warehouse.laps)}
                      hint={row.in_warehouse.ready_to_cut > 0 ? `${fmtUomQty(row.in_warehouse.ready_to_cut, uom)} ready to cut` : undefined}
                    />
                    <QtyForms className={`${tdCls} text-center`} qty={fmtUomQty(row.issued.qty, uom)} forms={formLine(0, 0, row.issued.units)} />
                    <td className={`${tdCls} text-center tabular-nums ${row.short > 0 ? 'font-semibold text-red-600' : ''}`}>
                      {row.short > 0 ? fmtUomQty(row.short, uom) : '—'}
                    </td>
                    <td className={tdCls}>
                      <span className="inline-flex items-center justify-center gap-1.5 w-full">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${mark.dot}`} />
                        <span className={`text-[10px] font-bold truncate ${mark.text}`}>{mark.label}</span>
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
