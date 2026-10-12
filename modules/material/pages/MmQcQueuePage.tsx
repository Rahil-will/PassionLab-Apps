import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Badge, Button, Input, Modal } from '../../../components/ui';
import { PageShell } from '../../../components/layout/PageShell';
import { usePageHeader } from '../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { MmQcInspectModalV4 } from '../components/MmQcInspectModalV4';
import { MmQcTestModalV4 } from '../components/MmQcTestModalV4';
import { MmRollPassportModalV4 } from '../components/MmRollPassportModalV4';
import { MmSegmentControl } from '../components/MmSegmentControl';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { unitFormOptionLabel } from '../lib/mmUnitForm';
import {
  mmQcApproveCutAtRisk,
  mmQcApproveDeviation,
  mmQcListQueue,
  type MmV4CustodySide,
  type MmV4DueReason,
  type MmV4QcSiteSide,
  type MmV4RollRow,
} from '../lib/mmV4Rpc';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

type QueueTab = 'test' | 'inspection' | 'failed';

function statusBadgeVariant(
  status: string | null | undefined,
): 'default' | 'success' | 'warning' | 'danger' {
  const s = String(status ?? 'NONE').toUpperCase();
  if (s === 'PASS') return 'success';
  if (s === 'FAILED') return 'danger';
  if (s === 'STALE' || s === 'INCOMPLETE' || s === 'HOLD') return 'warning';
  return 'default';
}

function upper(status: string | null | undefined): string {
  return String(status ?? 'NONE').toUpperCase();
}

function isFailedOrHold(row: MmV4RollRow): boolean {
  const test = upper(row.test_status);
  const inspection = upper(row.inspection_status);
  return test === 'FAILED' || test === 'HOLD' || inspection === 'FAILED';
}

const DUE_LABEL: Record<MmV4DueReason, string> = {
  new: 'New',
  reprocessed: 'Reprocessed',
  failed: 'Failed',
  hold: 'Hold',
  incomplete: 'Incomplete',
};

function dueLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return DUE_LABEL[code as MmV4DueReason] ?? code;
}

function dueBecause(row: MmV4RollRow, tab: QueueTab): string {
  if (tab === 'inspection') return dueLabel(row.inspection_due_reason);
  if (tab === 'test') return dueLabel(row.test_due_reason);
  const test = dueLabel(row.test_due_reason);
  return test !== '—' ? test : dueLabel(row.inspection_due_reason);
}

function inTab(row: MmV4RollRow, tab: QueueTab): boolean {
  if (tab === 'failed') return isFailedOrHold(row);
  if (isFailedOrHold(row)) return false;
  if (tab === 'test') return upper(row.test_status) !== 'PASS';
  return upper(row.inspection_status) !== 'PASS';
}

export default function MmQcQueuePage({
  side,
  siteSide,
}: {
  side: MmV4CustodySide;
  siteSide: MmV4QcSiteSide;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const [tab, setTab] = useState<QueueTab>('test');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [testOpen, setTestOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskReason, setRiskReason] = useState('');
  const [deviationOpen, setDeviationOpen] = useState(false);
  const [deviationReason, setDeviationReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [passportId, setPassportId] = useState<string | null>(null);

  usePageHeader({
    subtitle: `QC queue · ${side} · tests due, inspection due, and failed rolls.`,
  });

  const queueQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'qcQueue', side, search] as const,
    queryFn: async () => {
      const res = await mmQcListQueue({
        side,
        need: 'any',
        search: search.trim() || null,
        limit: 300,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const rows = useMemo(
    () => (queueQ.data ?? []).filter((row) => inTab(row, tab)),
    [queueQ.data, tab],
  );
  const selectedRows = rows.filter((row) => selected[row.roll_id]);
  const selectedIds = selectedRows.map((row) => row.roll_id);
  const gateCodes = [...new Set(selectedRows.flatMap((row) => row.gate?.codes ?? []))];
  const deviationRows = selectedRows.filter((row) => row.failed_test_id || row.failed_inspection_id);

  const approveDeviation = async () => {
    if (!deviationReason.trim()) {
      showNotification('Enter a reason', 'error');
      return;
    }
    if (deviationRows.length === 0) return;
    setBusy(true);
    try {
      for (const row of deviationRows) {
        if (row.failed_test_id) {
          const res = await mmQcApproveDeviation('test', row.failed_test_id, deviationReason.trim());
          if (res.ok === false) throw new Error(res.message);
        }
        if (row.failed_inspection_id) {
          const res = await mmQcApproveDeviation('inspection', row.failed_inspection_id, deviationReason.trim());
          if (res.ok === false) throw new Error(res.message);
        }
      }
      showNotification(`Deviation approved for ${deviationRows.length} rolls`, 'success');
      setDeviationOpen(false);
      setDeviationReason('');
      setSelected({});
      await queueQ.refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Approve failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const approveRisk = async () => {
    if (selectedIds.length === 0) return;
    if (!riskReason.trim()) {
      showNotification('Enter a reason', 'error');
      return;
    }
    if (gateCodes.length === 0) {
      showNotification('Selected rolls have no gate code', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmQcApproveCutAtRisk(selectedIds, gateCodes, riskReason.trim());
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Cut at risk approved for ${res.data.approved} rolls`, 'success');
      setRiskOpen(false);
      setRiskReason('');
      setSelected({});
      await queueQ.refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Approve failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell loading={queueQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <MmSegmentControl<QueueTab>
            value={tab}
            onChange={(next) => {
              setTab(next);
              setSelected({});
            }}
            options={[
              { value: 'test', label: 'Tests due' },
              { value: 'inspection', label: 'Inspection due' },
              { value: 'failed', label: 'Failed / on hold' },
            ]}
          />
          <div className="relative flex-1 min-w-[160px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full h-9 pl-8 pr-3 text-xs border border-slate-200 rounded-lg"
              placeholder="Search rolls…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
              Test ({selectedIds.length})
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setInspectOpen(true)}>
              Inspect ({selectedIds.length})
            </Button>
            <DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={deviationRows.length === 0}
                title={deviationRows.length === 0 ? 'Select a roll with a failed test or inspection' : undefined}
                onClick={() => setDeviationOpen(true)}
              >
                Approve deviation
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={gateCodes.length === 0}
                title={gateCodes.length === 0 ? 'Selected rolls have no gate code' : undefined}
                onClick={() => setRiskOpen(true)}
              >
                Cut at risk
              </Button>
            </DesktopWriteGate>
          </div>
        ) : null}

        {queueQ.isError ? (
          <p className="text-[12px] text-red-600">
            {queueQ.error instanceof Error ? queueQ.error.message : 'Could not load queue'}
          </p>
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr>
                  <th className={th} />
                  <th className={th}>Roll</th>
                  <th className={th}>Batch</th>
                  <th className={th}>Fabric</th>
                  <th className={th}>Form</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Round</th>
                  <th className={th}>Due because</th>
                  <th className={th}>Test</th>
                  <th className={th}>Inspection</th>
                  <th className={th}>Style</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-[12px] text-slate-400">
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
                      <td className={td}>{row.batch_no || '—'}</td>
                      <td className={td}>{row.fabric_code || row.fabric_type_name || '—'}</td>
                      <td className={td}>{unitFormOptionLabel(row.unit_form || 'roll')}</td>
                      <td className={td}>{row.stage_code || '—'}</td>
                      <td className={td}>{row.process_round ?? '—'}</td>
                      <td className={td}>{dueBecause(row, tab)}</td>
                      <td className={td}>
                        <Badge variant={statusBadgeVariant(row.test_status)}>{upper(row.test_status)}</Badge>
                      </td>
                      <td className={td}>
                        <Badge variant={statusBadgeVariant(row.inspection_status)}>
                          {upper(row.inspection_status)}
                        </Badge>
                      </td>
                      <td className={td}>{row.style?.style_name || '—'}</td>
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
      <MmRollPassportModalV4 open={Boolean(passportId)} rollId={passportId} onClose={() => setPassportId(null)} />

      <Modal isOpen={deviationOpen} onClose={busy ? () => undefined : () => setDeviationOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Approve deviation</h4>
          <p className="text-[11px] text-slate-500">{deviationRows.length} failed tests or inspections</p>
          <Input label="Reason" value={deviationReason} onChange={(e) => setDeviationReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setDeviationOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy || !deviationReason.trim()} onClick={() => void approveDeviation()}>
              {busy ? 'Saving…' : 'Approve'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={riskOpen} onClose={busy ? () => undefined : () => setRiskOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Cut at risk</h4>
          <p className="text-[11px] text-slate-500">
            {selectedIds.length} rolls · {gateCodes.join(', ') || 'no gate code'}
          </p>
          <Input label="Reason" value={riskReason} onChange={(e) => setRiskReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setRiskOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void approveRisk()}>
              {busy ? 'Saving…' : 'Approve'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
