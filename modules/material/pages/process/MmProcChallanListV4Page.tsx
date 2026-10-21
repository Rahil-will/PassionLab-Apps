import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { MmSegmentControl } from '../../components/MmSegmentControl';
import { MmProcReportsV4Panel } from './MmProcReportsV4Panel';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import {
  mmProcListChallans,
  type MmV4ProcChallanListRow,
  type MmV4ProcPurpose,
} from '../../lib/mmV4Rpc';
import { useMmPartners, useMmProcesses } from '../../lib/useMmV4Config';
import { processHistoryDetailRoute } from './processHistoryRoute';
import {
  emptyProcChallanFacts,
  loadProcChallanFacts,
  procChallanStatus,
  processorLabel,
} from '../../lib/procChallanFacts';
import { dateLabel } from '../../lib/mmRollDraft';

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

function rowPlace(row: MmV4ProcChallanListRow): 'inhouse' | 'external' | '' {
  const place = String(row.place ?? '').toLowerCase();
  if (place === 'inhouse' || place === 'external') return place;
  if (row.unit?.ownership === 'external') return 'external';
  if (row.unit?.ownership) return 'inhouse';
  return '';
}


export default function MmProcChallanListV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const sentBy = 'warehouse' as const;
  const processesQ = useMmProcesses();

  const [pageTab, setPageTab] = useState<PageTab>('challans');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [unitId, setUnitId] = useState('');
  const [processTypeId, setProcessTypeId] = useState('');
  const [purpose, setPurpose] = useState<'' | MmV4ProcPurpose>('');
  const [search, setSearch] = useState('');
  const [unitType, setUnitType] = useState<'' | 'internal' | 'external'>('');

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
      sentBy,
      unitId,
      processTypeId,
      purpose,
      search,
    ] as const,
    queryFn: async () => {
      const res = await mmProcListChallans({
        side: sentBy,
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
    const all = (listQ.data ?? []).filter((row) => {
      if (!unitType) return true;
      const place = rowPlace(row);
      if (unitType === 'external') return place === 'external';
      return place === 'inhouse';
    });
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

  const factIds = rows.map((row) => row.id).join(',');
  const factsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallanFacts', factIds] as const,
    queryFn: () => loadProcChallanFacts(rows.map((row) => row.id)),
    enabled: Boolean(factoryId && pageTab === 'challans' && rows.length > 0),
  });

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
                <SelectDropdown size="compact"
                  value={status}
                  onChange={(v) => setStatus(v as StatusFilter)}
                  options={[
                    { value: 'pending', label: 'Still out' },
                    { value: 'returned', label: 'Came back' },
                    { value: 'all', label: 'All' },
                  ]}
                  icon={Filter}
                  className="w-32"
                />
                <SelectDropdown size="compact"
                  value={unitId}
                  onChange={setUnitId}
                  options={[
                    { value: '', label: 'All vendors' },
                    ...units.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                  icon={Filter}
                  className="w-40"
                />
                <SelectDropdown size="compact"
                  value={processTypeId}
                  onChange={setProcessTypeId}
                  options={[
                    { value: '', label: 'All processes' },
                    ...processTypes.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  icon={Filter}
                  className="w-40"
                />
                <SelectDropdown size="compact"
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
                <SelectDropdown size="compact"
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

            {factsQ.isError ? (
              <p className="px-4 py-2 text-[12px] text-red-600">
                {factsQ.error instanceof Error ? factsQ.error.message : 'Could not load fabric and quantities'}
              </p>
            ) : null}

            <div className="overflow-auto">
              <table className="w-full min-w-[980px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thFirst}>Date</th>
                    <th className={th}>Fabric</th>
                    <th className={th}>Process</th>
                    <th className={th}>Processor</th>
                    <th className={`${th} text-center`}>Qty</th>
                    <th className={`${th} text-center`}>Rolls / laps</th>
                    <th className={th}>Received at</th>
                    <th className={`${th} text-center`}>Qty</th>
                    <th className={`${th} text-center`}>Rolls / laps</th>
                    <th className={`${th} text-center`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">
                        No challans sent yet.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const facts = factsQ.data?.get(row.id) ?? emptyProcChallanFacts();
                      const status = procChallanStatus(row.status);
                      return (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/80 cursor-pointer"
                          onClick={() => requestNavigate(processHistoryDetailRoute(), { id: row.id })}
                        >
                          <td className={`${tdFirst} whitespace-nowrap text-slate-600`}>
                            <span className="block">{dateLabel(row.sent_at ?? row.created_at)}</span>
                            <span className="block text-[10px] font-semibold text-slate-900 truncate">
                              {row.challan_no}
                              {row.purpose === 'reprocess' ? ' · Reprocess' : ''}
                            </span>
                          </td>
                          <td className={`${td} truncate`}>{facts.fabric}</td>
                          <td className={`${td} truncate`}>{processLabel(row.process_type)}</td>
                          <td className={`${td} truncate`}>{processorLabel(row)}</td>
                          <td className={`${td} text-center tabular-nums font-semibold whitespace-nowrap`}>{facts.sentQty}</td>
                          <td className={`${td} text-center tabular-nums whitespace-nowrap`}>{facts.sentCount}</td>
                          <td className={`${td} whitespace-nowrap text-slate-600`}>{facts.receivedAt}</td>
                          <td className={`${td} text-center tabular-nums font-semibold whitespace-nowrap`}>{facts.receivedQty}</td>
                          <td className={`${td} text-center tabular-nums whitespace-nowrap`}>{facts.receivedCount}</td>
                          <td className={`${td} text-center whitespace-nowrap`}>
                            <span className="inline-flex items-center justify-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
                              <span className={`text-[9px] font-bold ${status.text}`}>{status.label}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })
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
