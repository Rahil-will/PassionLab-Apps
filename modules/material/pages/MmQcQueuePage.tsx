import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Badge, Button, SelectDropdown } from '../../../components/ui';
import { PageShell } from '../../../components/layout/PageShell';
import { usePageHeader } from '../../../components/Breadcrumb';
import { MmQcInspectModalV4 } from '../components/MmQcInspectModalV4';
import { MmQcTestModalV4 } from '../components/MmQcTestModalV4';
import { MmRollPassportModalV4 } from '../components/MmRollPassportModalV4';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores';
import { mmQcListQueue, type MmV4CustodySide, type MmV4QcSiteSide } from '../lib/mmV4Rpc';
import { useFabricV4Enabled } from '../lib/useMmV4Config';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

function statusBadgeVariant(
  status: string | null | undefined,
): 'default' | 'success' | 'warning' | 'danger' {
  const s = String(status ?? 'NONE').toUpperCase();
  if (s === 'PASS') return 'success';
  if (s === 'FAILED') return 'danger';
  if (s === 'STALE' || s === 'INCOMPLETE' || s === 'HOLD') return 'warning';
  return 'default';
}

export default function MmQcQueuePage({
  side,
  siteSide,
}: {
  side: MmV4CustodySide;
  siteSide: MmV4QcSiteSide;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const v4On = useFabricV4Enabled();
  const [need, setNeed] = useState<'any' | 'test' | 'inspection'>('any');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [testOpen, setTestOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [passportId, setPassportId] = useState<string | null>(null);

  usePageHeader({
    subtitle: `QC queue · ${side} · rolls that still need test or inspection.`,
  });

  const queueQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'qcQueue', side, need, search] as const,
    queryFn: async () => {
      const res = await mmQcListQueue({
        side,
        need,
        search: search.trim() || null,
        limit: 200,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && v4On),
  });

  const rows = queueQ.data ?? [];
  const selectedIds = rows.filter((r) => selected[r.roll_id]).map((r) => r.roll_id);

  if (!v4On) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">QC queue needs Fabric v4 on.</div>
      </PageShell>
    );
  }

  return (
    <PageShell loading={queueQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full h-9 pl-8 pr-3 text-xs border border-slate-200 rounded-lg"
              placeholder="Search rolls…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SelectDropdown
            value={need}
            onChange={(v) => setNeed((v as 'any' | 'test' | 'inspection') || 'any')}
            options={[
              { value: 'any', label: 'Any need' },
              { value: 'test', label: 'Needs test' },
              { value: 'inspection', label: 'Needs inspection' },
            ]}
            className="w-40"
          />
          {selectedIds.length > 0 ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
                Test ({selectedIds.length})
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setInspectOpen(true)}>
                Inspect ({selectedIds.length})
              </Button>
            </>
          ) : null}
        </div>

        {queueQ.isError ? (
          <p className="text-[12px] text-red-600">
            {queueQ.error instanceof Error ? queueQ.error.message : 'Could not load queue'}
          </p>
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse">
              <thead>
                <tr>
                  <th className={th} />
                  <th className={th}>Roll</th>
                  <th className={th}>Style</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Test</th>
                  <th className={th}>Inspection</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      Queue clear
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.roll_id} className="hover:bg-slate-50">
                      <td className={td}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[row.roll_id])}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [row.roll_id]: e.target.checked }))
                          }
                        />
                      </td>
                      <td className={td}>
                        <button
                          type="button"
                          className="font-semibold text-slate-900 hover:underline"
                          onClick={() => setPassportId(row.roll_id)}
                        >
                          {row.roll_code}
                        </button>
                      </td>
                      <td className={td}>{row.style?.style_name || '—'}</td>
                      <td className={td}>{row.stage_code || '—'}</td>
                      <td className={td}>
                        <Badge variant={statusBadgeVariant(row.test_status)}>
                          {String(row.test_status ?? 'NONE')}
                        </Badge>
                      </td>
                      <td className={td}>
                        <Badge variant={statusBadgeVariant(row.inspection_status)}>
                          {String(row.inspection_status ?? 'NONE')}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <MmQcTestModalV4
        open={testOpen}
        scopeKind="rolls"
        rollIds={selectedIds}
        defaultSiteSide={siteSide}
        onClose={() => setTestOpen(false)}
        onSaved={() => {
          setTestOpen(false);
          setSelected({});
          void queueQ.refetch();
        }}
      />
      <MmQcInspectModalV4
        open={inspectOpen}
        scopeKind="rolls"
        rollIds={selectedIds}
        defaultSiteSide={siteSide}
        onClose={() => setInspectOpen(false)}
        onSaved={() => {
          setInspectOpen(false);
          setSelected({});
          void queueQ.refetch();
        }}
      />
      <MmRollPassportModalV4
        open={Boolean(passportId)}
        rollId={passportId}
        onClose={() => setPassportId(null)}
      />
    </PageShell>
  );
}
