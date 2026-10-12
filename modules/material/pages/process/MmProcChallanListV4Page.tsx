import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search } from 'lucide-react';
import { Badge, Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { MmSegmentControl } from '../../components/MmSegmentControl';
import { MmProcReportsV4Panel } from './MmProcReportsV4Panel';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import {
  mmProcListChallans,
  type MmV4ProcPurpose,
  type MmV4ProcSide,
} from '../../lib/mmV4Rpc';
import { useMmPartners, useMmProcesses } from '../../lib/useMmV4Config';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirst =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdFirst = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';

type PageTab = 'challans' | 'reports';
type StatusFilter = 'pending' | 'returned' | 'all';

function processLabel(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name?: string }).name ?? '—');
  }
  return '—';
}

function measureText(metres: number, kg: number, count: number): string {
  const qty = [
    metres > 0 ? `${metres.toLocaleString(undefined, { maximumFractionDigits: 1 })} m` : '',
    kg > 0 ? `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg` : '',
  ].filter(Boolean).join(' · ');
  const pieces = count > 0 ? `${count}` : '';
  return [qty || '—', pieces].filter(Boolean).join(' · ');
}

function lossText(row: { qty_in?: number | null; kg_in?: number | null; counts?: Record<string, number> }): string {
  const metres = (Number(row.counts?.qty_out) || 0) - (Number(row.qty_in) || 0);
  const kg = (Number(row.counts?.kg_out) || 0) - (Number(row.kg_in) || 0);
  const pieces = (Number(row.counts?.out) || 0) - (Number(row.counts?.returned) || 0);
  const qty = measureText(metres > 0 ? metres : 0, kg > 0 ? kg : 0, pieces > 0 ? pieces : 0);
  const out = Number(row.counts?.qty_out ?? 0);
  const back = Number(row.qty_in ?? 0);
  if (!(out > 0)) return qty === '—' ? '—' : qty;
  const pct = ((out - back) / out) * 100;
  return Number.isFinite(pct) ? `${qty} (${pct.toFixed(1)}%)` : qty;
}

export default function MmProcChallanListV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const routeSide = useNavigationStore((s) => s.routeParams.side);
  const processesQ = useMmProcesses();

  const [pageTab, setPageTab] = useState<PageTab>('challans');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [side, setSide] = useState<'' | MmV4ProcSide>(
    routeSide === 'mill' || routeSide === 'warehouse' ? routeSide : '',
  );
  const [unitId, setUnitId] = useState('');
  const [processTypeId, setProcessTypeId] = useState('');
  const [purpose, setPurpose] = useState<'' | MmV4ProcPurpose>('');
  const [search, setSearch] = useState('');
  const [unitType, setUnitType] = useState<'' | 'internal' | 'external'>('');

  usePageHeader({
    subtitle: 'Process challans already sent. Open a row for returns, lots, and loss.',
  });

  const vendorsQ = useMmPartners('process_vendor', false);
  const units = vendorsQ.data ?? [];
  const processTypes = useMemo(
    () => (processesQ.data ?? []).filter((t) => t.active !== false),
    [processesQ.data],
  );

  const listQ = useQuery({
    queryKey: [
      ...queryKeys.mmOps(factoryId ?? ''),
      'procChallansV4',
      status,
      side,
      unitId,
      processTypeId,
      purpose,
      search,
    ] as const,
    queryFn: async () => {
      const res = await mmProcListChallans({
        side: side || null,
        status: status === 'returned' ? 'returned' : null,
        unit_facility_id: unitId || null,
        process_type_id: processTypeId || null,
        purpose: purpose || null,
        search: search.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && pageTab === 'challans'),
  });

  const rows = useMemo(() => {
    const all = (listQ.data ?? []).filter((row) => !unitType || row.unit?.ownership === unitType);
    if (status === 'pending') {
      return all.filter((r) => {
        const s = String(r.status ?? '').toLowerCase();
        return s === 'open' || s === 'partial' || s === 'pending';
      });
    }
    if (status === 'returned') {
      return all.filter((r) => String(r.status ?? '').toLowerCase() === 'returned');
    }
    return all;
  }, [listQ.data, status, unitType]);

  return (
    <PageShell loading={pageTab === 'challans' && listQ.isLoading} skeleton="table" className="w-full pb-20">
      <div className="flex flex-col gap-3">
        <MmSegmentControl<PageTab>
          value={pageTab}
          onChange={setPageTab}
          options={[
            { value: 'challans', label: 'Challans' },
            { value: 'reports', label: 'Reports' },
          ]}
        />

        {pageTab === 'reports' ? (
          <MmProcReportsV4Panel />
        ) : (
          <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                  className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                  placeholder="Search challan…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                <SelectDropdown
                  value={status}
                  onChange={(v) => setStatus(v as StatusFilter)}
                  options={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'returned', label: 'Returned' },
                    { value: 'all', label: 'All' },
                  ]}
                  icon={Filter}
                  className="w-32"
                />
                <SelectDropdown
                  value={side}
                  onChange={(v) => setSide((v as MmV4ProcSide | '') || '')}
                  options={[
                    { value: '', label: 'From: all' },
                    { value: 'mill', label: 'Mill' },
                    { value: 'warehouse', label: 'Warehouse' },
                  ]}
                  icon={Filter}
                  className="w-36"
                />
                <SelectDropdown
                  value={unitId}
                  onChange={setUnitId}
                  options={[
                    { value: '', label: 'All vendors' },
                    ...units.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                  icon={Filter}
                  className="w-40"
                />
                <SelectDropdown
                  value={processTypeId}
                  onChange={setProcessTypeId}
                  options={[
                    { value: '', label: 'All processes' },
                    ...processTypes.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  icon={Filter}
                  className="w-40"
                />
                <SelectDropdown
                  value={unitType}
                  onChange={(v) => setUnitType((v as '' | 'internal' | 'external') || '')}
                  options={[
                    { value: '', label: 'All unit types' },
                    { value: 'internal', label: 'In-house' },
                    { value: 'external', label: 'External' },
                  ]}
                  icon={Filter}
                  className="w-36"
                />
                <SelectDropdown
                  value={purpose}
                  onChange={(v) => setPurpose((v as MmV4ProcPurpose | '') || '')}
                  options={[
                    { value: '', label: 'All purposes' },
                    { value: 'fresh', label: 'Fresh' },
                    { value: 'reprocess', label: 'Reprocess' },
                  ]}
                  icon={Filter}
                  className="w-36"
                />
              </div>
            </div>

            {listQ.isError ? (
              <p className="px-4 py-3 text-[12px] text-red-600">
                {listQ.error instanceof Error ? listQ.error.message : 'Could not load challans'}
              </p>
            ) : null}

            <div className="overflow-auto">
              <table className="w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thFirst}>Challan</th>
                    <th className={th}>Vendor</th>
                    <th className={th}>Process</th>
                    <th className={th}>From</th>
                    <th className={`${th} text-right`}>Out</th>
                    <th className={`${th} text-right`}>Returned</th>
                    <th className={th}>Sent</th>
                    <th className={`${th} text-right`}>Age</th>
                    <th className={`${th} text-right`}>Loss</th>
                    <th className={th}>Tested</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">
                        No process challans
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/80 cursor-pointer"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: row.id })}
                      >
                        <td className={`${tdFirst} font-semibold text-slate-900`}>
                          {row.challan_no}
                          {row.purpose === 'reprocess' ? (
                            <Badge variant="warning" className="ml-1">
                              Reprocess
                            </Badge>
                          ) : null}
                        </td>
                        <td className={td}>
                          <span className="inline-flex items-center gap-1">
                            {row.unit?.name || '—'}
                            {row.unit?.ownership ? (
                              <Badge variant="outline">
                                {row.unit.ownership === 'external' ? 'External' : 'In-house'}
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className={td}>{processLabel(row.process_type)}</td>
                        <td className={td}>{row.side === 'warehouse' ? 'Warehouse' : 'Mill'}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {measureText(Number(row.counts?.qty_out) || 0, Number(row.counts?.kg_out) || 0, Number(row.counts?.out) || 0)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {measureText(Number(row.qty_in) || 0, Number(row.kg_in) || 0, Number(row.counts?.returned) || 0)}
                        </td>
                        <td className={td}>{String(row.sent_at ?? row.created_at ?? '—')}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {row.age_days != null ? `${row.age_days}d` : '—'}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{lossText(row)}</td>
                        <td className={td}>{row.tested ? 'Yes' : 'No'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
