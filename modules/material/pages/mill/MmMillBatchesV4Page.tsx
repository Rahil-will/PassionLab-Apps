import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { Badge, Button, SelectDropdown } from '../../../../components/ui';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { mmMillListBatchesV4, type MmV4BatchKind } from '../../lib/mmV4Rpc';
import { useFabricV4Enabled, useMmV4Config } from '../../lib/useMmV4Config';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmMillBatchesV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const v4On = useFabricV4Enabled();
  const { data: config } = useMmV4Config(v4On);

  const [search, setSearch] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [batchKind, setBatchKind] = useState<'' | MmV4BatchKind>('');

  usePageHeader({
    subtitle: 'Style and general mill batches. Custody and stage mix from the roll registry.',
  });

  const mills = useMemo(
    () =>
      (config?.facilities ?? []).filter(
        (f) => f.kind === 'mill' && f.is_active !== false,
      ),
    [config?.facilities],
  );

  const listQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchesV4', facilityId, batchKind, search] as const,
    queryFn: async () => {
      const res = await mmMillListBatchesV4({
        facility_id: facilityId || null,
        batch_kind: batchKind || null,
        search: search.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && v4On),
  });

  if (!v4On) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">
          Mill batches (v4) need Fabric v4 on. Use the existing mill screens, or turn on Fabric v4 in Settings.
          <div className="mt-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => requestNavigate(RoutePath.MATERIAL_MILL)}>
              Back to Fabric Mill
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell loading={listQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full h-9 pl-8 pr-3 text-xs border border-slate-200 rounded-lg"
              placeholder="Search batch no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {mills.length > 1 ? (
            <SelectDropdown
              value={facilityId}
              onChange={setFacilityId}
              placeholder="All mills"
              options={[
                { value: '', label: 'All mills' },
                ...mills.map((m) => ({ value: m.id, label: m.name || m.code })),
              ]}
              className="w-44"
            />
          ) : null}
          <SelectDropdown
            value={batchKind}
            onChange={(v) => setBatchKind((v as MmV4BatchKind | '') || '')}
            options={[
              { value: '', label: 'All kinds' },
              { value: 'style', label: 'Style' },
              { value: 'general', label: 'General' },
            ]}
            className="w-36"
          />
          <Button
            type="button"
            size="sm"
            icon={Plus}
            onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_NEW)}
            title="Batch form ships in the next slice"
          >
            New batch
          </Button>
        </div>

        {listQ.isError ? (
          <p className="text-[12px] text-red-600">
            {listQ.error instanceof Error ? listQ.error.message : 'Could not load batches'}
          </p>
        ) : null}

        {listQ.isFetching && !listQ.isLoading ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Updating…
          </div>
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Batch</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Mill</th>
                  <th className={th}>Fabric</th>
                  <th className={th}>Style / intents</th>
                  <th className={`${th} text-right`}>At mill</th>
                  <th className={`${th} text-right`}>Processing</th>
                  <th className={`${th} text-right`}>Dispatched</th>
                  <th className={th}>Stages</th>
                  <th className={th}>Machines</th>
                </tr>
              </thead>
              <tbody>
                {(listQ.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      No batches yet
                    </td>
                  </tr>
                ) : (
                  (listQ.data ?? []).map((row) => {
                    const styleLabel =
                      row.batch_kind === 'general'
                        ? (row.intents ?? [])
                          .map((i) => String((i as { style_name?: string }).style_name ?? i))
                          .filter(Boolean)
                          .join(', ') || '—'
                        : String((row.style as { style_name?: string } | null)?.style_name ?? '—');
                    const stages = Object.entries(row.stages ?? {});
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() =>
                          requestNavigate(RoutePath.MATERIAL_MILL_BATCH_DETAIL, { batchId: row.id })
                        }
                      >
                        <td className={`${td} font-semibold text-slate-900`}>{row.batch_no}</td>
                        <td className={td}>
                          <Badge variant={row.batch_kind === 'general' ? 'outline' : 'primary'}>
                            {row.batch_kind === 'general' ? 'General' : 'Style'}
                          </Badge>
                        </td>
                        <td className={td}>{row.facility?.name || row.facility?.code || '—'}</td>
                        <td className={td}>{row.fabric_type_name || '—'}</td>
                        <td className={`${td} max-w-[12rem] truncate`}>{styleLabel}</td>
                        <td className={`${td} text-right tabular-nums`}>{row.counts?.at_mill ?? 0}</td>
                        <td className={`${td} text-right tabular-nums`}>{row.counts?.at_process ?? 0}</td>
                        <td className={`${td} text-right tabular-nums`}>{row.counts?.dispatched ?? 0}</td>
                        <td className={td}>
                          <div className="flex flex-wrap gap-1">
                            {stages.length === 0 ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              stages.map(([code, n]) => (
                                <Badge key={code} variant="default">
                                  {code} {n}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className={`${td} max-w-[8rem] truncate`}>
                          {(row.machines ?? []).map((m) => m.code || m.name).filter(Boolean).join(', ') || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
