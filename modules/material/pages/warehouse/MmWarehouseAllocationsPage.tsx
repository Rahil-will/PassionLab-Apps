import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { dateLabel } from '../../lib/mmRollDraft';
import { noteStatusChip } from '../../lib/inspAlloc';
import { mmListAllocationNotes, type MmAllocNoteRow } from '../../lib/mmV4Rpc';
import { whTd, whTdMuted, whTh } from './whTable';

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'closed', label: 'Closed' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function MmWarehouseAllocationsPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('open');
  const debounced = useDebouncedValue(search, 300);

  usePageHeader({ title: 'Allocations', subtitle: 'Numbered allocation notes from allocate and book actions.' });

  const notesQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'allocNotes', tab, debounced] as const,
    queryFn: async () => {
      const res = await mmListAllocationNotes({ status: tab, search: debounced || null });
      if (res.ok === false) throw new Error(res.message);
      return (Array.isArray(res.data) ? res.data : (res.data.rows ?? [])) as MmAllocNoteRow[];
    },
    enabled: Boolean(factoryId),
  });
  const rows = notesQ.data ?? [];

  return (
    <PageShell loading={notesQ.isLoading} error={notesQ.error} onRetry={() => { void notesQ.refetch(); }} skeleton="table" className="w-full pb-20">
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3 bg-slate-50/50">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`h-7 px-3 rounded-md text-[11px] font-semibold ${tab === item.key ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 max-w-sm flex-1">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search note, style, fabric"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>
                <th className={whTh}>Note no</th>
                <th className={whTh}>Date</th>
                <th className={whTh}>Style · colourway</th>
                <th className={whTh}>Fabric</th>
                <th className={whTh}>Allocated</th>
                <th className={whTh}>Booked</th>
                <th className={whTh}>Dispatched</th>
                <th className={whTh}>Qty open</th>
                <th className={whTh}>Status</th>
                <th className={whTh}>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-[11px] text-slate-400">No allocation notes.</td></tr>
              ) : rows.map((row) => {
                const chip = noteStatusChip(row.status);
                const style = [row.style?.style_name, row.style?.colorway_name].filter(Boolean).join(' · ') || '—';
                const fabric = [row.style?.fabric_code, row.style?.fabric_name].filter(Boolean).join(' – ') || '—';
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ALLOCATION, { id: row.id })}
                  >
                    <td className={`${whTd} font-semibold text-blue-700`}>{row.note_no}</td>
                    <td className={whTdMuted}>{dateLabel(row.created_at)}</td>
                    <td className={`${whTd} truncate`}>{style}</td>
                    <td className={`${whTd} truncate`}>{fabric}</td>
                    <td className={whTd}>{row.counts?.allocated ?? '—'}</td>
                    <td className={whTd}>{row.counts?.booked ?? '—'}</td>
                    <td className={whTd}>{row.counts?.dispatched ?? '—'}</td>
                    <td className={whTd}>{row.counts?.qty_active ?? '—'}</td>
                    <td className={whTd}>
                      <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${chip.tone === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : chip.tone === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{chip.label}</span>
                    </td>
                    <td className={whTd}>{row.created_by_name || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
