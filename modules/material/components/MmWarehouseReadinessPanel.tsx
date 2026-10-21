import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Badge, Button } from '../../../components/ui';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { MmAllocateV4Modal } from './MmAllocateV4Modal';
import { MmProcSendModalV4 } from './MmProcSendModalV4';
import { MmRollPassportModalV4 } from './MmRollPassportModalV4';
import { mmWhListReadiness } from '../lib/mmV4Rpc';
import { MmInspectionChip } from './MmInspectionChip';

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

function gateLabel(code: string): string {
  const map: Record<string, string> = {
    STAGE_NOT_CUTTABLE: 'Stage can\'t be cut',
    TEST_MISSING: 'Not tested',
    TEST_STALE: 'Retest after processing',
    TEST_FAILED: 'Test failed',
    TEST_HOLD: 'Test hold',
    TEST_INCOMPLETE: 'Test incomplete',
    INSPECTION_MISSING: 'Not inspected',
    INSPECTION_STALE: 'Re-inspect after processing',
    INSPECTION_FAILED: 'Inspection failed',
    NOT_AVAILABLE: 'Not available',
    ON_HOLD: 'On hold',
    NOT_ALLOCATED: 'Not allocated',
  };
  return map[code] ?? code;
}

export function MmWarehouseReadinessPanel() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const [search, setSearch] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sendOpen, setSendOpen] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [passportId, setPassportId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'whReadiness', search, onlyBlocked] as const,
    queryFn: async () => {
      const res = await mmWhListReadiness({
        search: search.trim() || null,
        only_blocked: onlyBlocked,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const rows = listQ.data ?? [];
  const selectedRolls = useMemo(
    () => rows.filter((r) => selected[r.roll_id]),
    [rows, selected],
  );
  const selectedIds = selectedRolls.map((r) => r.roll_id);

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full h-9 pl-8 pr-3 text-xs border border-slate-200 rounded-lg"
            placeholder="Search rolls…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
          <input
            type="checkbox"
            checked={onlyBlocked}
            onChange={(e) => setOnlyBlocked(e.target.checked)}
          />
          Only blocked
        </label>
        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <span className="text-[11px] text-slate-600">{selectedIds.length} selected</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setSendOpen(true)}>
              Send to processing
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAllocateOpen(true)}>
              Allocate
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => showNotification('Use Hold / Release on Stock on hand')}
            >
              Hold / Release
            </Button>
          </div>
        ) : null}
      </div>

      {listQ.isError ? (
        <p className="px-4 py-2 text-[12px] text-red-600">
          {listQ.error instanceof Error ? listQ.error.message : 'Could not load readiness'}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse">
          <thead>
            <tr>
              <th className={th} />
              <th className={th}>Roll</th>
              <th className={th}>Style</th>
              <th className={th}>Location</th>
              <th className={th}>Stage</th>
              <th className={th}>Test</th>
              <th className={th}>Inspection</th>
              <th className={th}>Gate</th>
              <th className={th}>Cut-ready</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[12px] text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[12px] text-slate-400">
                  No rolls
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const codes = row.gate?.codes ?? [];
                return (
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
                    <td className={td}>
                      {row.location?.name || row.location?.code || '—'}
                    </td>
                    <td className={td}>
                      {row.stage_code ? <Badge variant="outline">{row.stage_code}</Badge> : '—'}
                    </td>
                    <td className={td}>
                      <Badge variant={statusBadgeVariant(row.test_status)}>
                        {String(row.test_status ?? 'NONE')}
                      </Badge>
                    </td>
                    <td className={td}>
                      <MmInspectionChip inspection={row.inspection} />
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {codes.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          codes.map((code) => (
                            <Badge key={code} variant="warning">
                              {gateLabel(code)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className={td}>
                      {row.gate?.cut_ready ? (
                        <Badge variant="success">Cut-ready</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <MmProcSendModalV4
        open={sendOpen}
        side="warehouse"
        preselectedRollIds={selectedIds}
        onClose={() => setSendOpen(false)}
        onSent={() => {
          setSendOpen(false);
          setSelected({});
          void listQ.refetch();
        }}
      />
      <MmAllocateV4Modal
        open={allocateOpen}
        rollIds={selectedIds}
        onClose={() => setAllocateOpen(false)}
        onDone={() => {
          setAllocateOpen(false);
          setSelected({});
          void listQ.refetch();
        }}
      />
      <MmRollPassportModalV4
        open={Boolean(passportId)}
        rollId={passportId}
        onClose={() => setPassportId(null)}
      />
    </div>
  );
}
