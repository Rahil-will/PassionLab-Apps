import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { Badge, Button, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { MmSegmentControl } from '../../components/MmSegmentControl';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { MmProcReportsV4Panel } from './MmProcReportsV4Panel';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import {
  mmProcListChallans,
  type MmV4ProcPurpose,
  type MmV4ProcSide,
} from '../../lib/mmV4Rpc';
import { useMmV4Config } from '../../lib/useMmV4Config';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

type PageTab = 'challans' | 'reports';
type Tab = 'pending' | 'returned' | 'all';

function processLabel(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name?: string }).name ?? '—');
  }
  return '—';
}

function lossPct(row: { qty_in?: number | null; counts?: Record<string, number> }): string {
  const out = Number(row.counts?.qty_out ?? 0);
  const back = Number(row.qty_in ?? 0);
  if (!(out > 0)) return '—';
  const pct = ((out - back) / out) * 100;
  if (!Number.isFinite(pct)) return '—';
  return `${pct.toFixed(1)}%`;
}

export default function MmProcChallanListV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { data: v4 } = useMmV4Config(true);

  const [pageTab, setPageTab] = useState<PageTab>('challans');
  const [tab, setTab] = useState<Tab>('pending');
  const [side, setSide] = useState<'' | MmV4ProcSide>('');
  const [unitId, setUnitId] = useState('');
  const [processTypeId, setProcessTypeId] = useState('');
  const [purpose, setPurpose] = useState<'' | MmV4ProcPurpose>('');
  const [search, setSearch] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSide, setSendSide] = useState<MmV4ProcSide>('mill');

  usePageHeader({
    subtitle: 'Process challans already sent. Open a row for returns, lots, and loss. Create new challans from Warehouse → Send to processing.',
  });

  const units = useMemo(
    () => (v4?.facilities ?? []).filter((f) => f.kind === 'process_unit' && f.is_active !== false),
    [v4?.facilities],
  );
  const processTypes = useMemo(
    () => (v4?.process_types ?? []).filter((t) => t.active !== false),
    [v4?.process_types],
  );

  const listQ = useQuery({
    queryKey: [
      ...queryKeys.mmOps(factoryId ?? ''),
      'procChallansV4',
      tab,
      side,
      unitId,
      processTypeId,
      purpose,
      search,
    ] as const,
    queryFn: async () => {
      const res = await mmProcListChallans({
        side: side || null,
        status: tab === 'returned' ? 'returned' : null,
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
    const all = listQ.data ?? [];
    if (tab === 'pending') {
      return all.filter((r) => {
        const s = String(r.status ?? '').toLowerCase();
        return s === 'open' || s === 'partial' || s === 'pending';
      });
    }
    if (tab === 'returned') {
      return all.filter((r) => String(r.status ?? '').toLowerCase() === 'returned');
    }
    return all;
  }, [listQ.data, tab]);

  return (
    <PageShell loading={pageTab === 'challans' && listQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-3 p-4">
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
          <>
        <div className="flex flex-wrap items-center gap-2">
          <MmSegmentControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'returned', label: 'Returned' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full h-9 pl-8 pr-3 text-xs border border-slate-200 rounded-lg"
              placeholder="Search challan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SelectDropdown
            value={side}
            onChange={(v) => setSide((v as MmV4ProcSide | '') || '')}
            options={[
              { value: '', label: 'From: all' },
              { value: 'mill', label: 'Mill' },
              { value: 'warehouse', label: 'Warehouse' },
            ]}
            className="w-36"
          />
          <SelectDropdown
            value={unitId}
            onChange={setUnitId}
            options={[
              { value: '', label: 'All units' },
              ...units.map((u) => ({ value: u.id, label: u.name || u.code })),
            ]}
            className="w-44"
          />
          <SelectDropdown
            value={processTypeId}
            onChange={setProcessTypeId}
            options={[
              { value: '', label: 'All processes' },
              ...processTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
            className="w-44"
          />
          <SelectDropdown
            value={purpose}
            onChange={(v) => setPurpose((v as MmV4ProcPurpose | '') || '')}
            options={[
              { value: '', label: 'All purposes' },
              { value: 'fresh', label: 'Fresh' },
              { value: 'reprocess', label: 'Reprocess' },
            ]}
            className="w-36"
          />
          <Button
            type="button"
            size="sm"
            icon={Plus}
            onClick={() => {
              setSendSide('mill');
              setSendOpen(true);
            }}
          >
            Send to processing
          </Button>
        </div>

        {listQ.isError ? (
          <p className="text-[12px] text-red-600">
            {listQ.error instanceof Error ? listQ.error.message : 'Could not load challans'}
          </p>
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Challan</th>
                  <th className={th}>Unit</th>
                  <th className={th}>Process</th>
                  <th className={th}>From</th>
                  <th className={`${th} text-right`}>Out</th>
                  <th className={`${th} text-right`}>Open</th>
                  <th className={th}>Sent</th>
                  <th className={`${th} text-right`}>Age</th>
                  <th className={`${th} text-right`}>Loss</th>
                  <th className={th}>Tested</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      No process challans
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: row.id })}
                    >
                      <td className={`${td} font-semibold text-slate-900`}>
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
                      <td className={`${td} text-right tabular-nums`}>{row.counts?.out ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.counts?.open ?? 0}</td>
                      <td className={td}>{String(row.sent_at ?? row.created_at ?? '—')}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {row.age_days != null ? `${row.age_days}d` : '—'}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{lossPct(row)}</td>
                      <td className={td}>{row.tested ? 'Yes' : 'No'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
          </>
        )}
      </div>

      <MmProcSendModalV4
        open={sendOpen}
        side={sendSide}
        onClose={() => setSendOpen(false)}
        onSent={(id) => {
          setSendOpen(false);
          void listQ.refetch();
          requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id });
        }}
      />
    </PageShell>
  );
}
