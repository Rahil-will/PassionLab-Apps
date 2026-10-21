import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Modal } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { mmQcApproveDeviation, mmQcGetRoll, mmQcVoid } from '../lib/mmV4Rpc';
import { qcCaptureOriginLabel } from '../lib/qcTolerance';
import {
  MmRejectedDispositionModal,
  MmReportDamageModal,
  rollCanReportDamage,
  rollIsRejected,
  rollUnitId,
} from './MmRollDamageActions';
import { MmRollProcessMark } from './MmProcessStatus';
import { rollInspectionChip } from '../lib/inspAlloc';
import { unitFormOptionLabel } from '../lib/mmUnitForm';
import { formatStoredQty, formatStoredWidth, unitBase, useFabricUnits } from '../lib/units';

function numericAttr(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function statusBadgeVariant(
  status: string | null | undefined,
): 'default' | 'success' | 'warning' | 'danger' {
  const s = String(status ?? 'NONE').toUpperCase();
  if (s === 'PASS') return 'success';
  if (s === 'FAILED') return 'danger';
  if (s === 'STALE' || s === 'INCOMPLETE' || s === 'HOLD') return 'warning';
  return 'default';
}

function custodyLabel(side: string | null | undefined): string {
  if (side === 'processing') return 'At processing';
  if (side === 'warehouse') return 'Warehouse';
  return '—';
}

function statusLine(label: string, status: unknown, origin: string | null): string {
  const text = String(status ?? 'NONE');
  if (text === 'NONE' || !origin) return `${label} ${text}`;
  return `${label} ${text} (${origin})`;
}

export function MmRollPassportModalV4({
  open,
  rollId,
  onClose,
}: {
  open: boolean;
  rollId: string | null;
  onClose: () => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [damageOpen, setDamageOpen] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);

  const passportQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rollPassport', rollId ?? ''] as const,
    queryFn: async () => {
      const res = await mmQcGetRoll(rollId as string);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: open && Boolean(factoryId && rollId),
  });

  const roll = passportQ.data?.roll;
  const units = useFabricUnits(roll);
  const widthInches = numericAttr(roll?.attributes?.width_in) ?? numericAttr(roll?.attributes?.actual_width_in) ?? roll?.spec?.width?.actual ?? roll?.spec?.width?.target ?? null;
  const storedQty = unitBase(units.qtyUnit) === 'kg' ? roll?.weight_kg : roll?.length_m;
  const qtyText = formatStoredQty(storedQty == null ? null : Number(storedQty), units.qtyUnit);
  const widthText = formatStoredWidth(widthInches, units.widthUnit);
  const passport = passportQ.data?.passport ?? {};
  const tests = passportQ.data?.tests ?? [];
  const inspections = passportQ.data?.inspections ?? [];
  const ancestors = passportQ.data?.ancestors ?? [];
  const processHistory = passportQ.data?.process_history ?? [];
  const allocations = passportQ.data?.allocations ?? [];
  const cutApprovals = passportQ.data?.cut_approvals ?? [];

  const latestTest = tests.find((t) => !t.voided_at && !t.superseded_by) ?? tests[0];
  const latestInspection = inspections.find((i) => !i.voided_at) ?? inspections[0];
  const testOrigin = qcCaptureOriginLabel(latestTest?.origin);
  const inspectionOrigin = qcCaptureOriginLabel(latestInspection?.origin);
  const latestTestId = String(tests.find((t) => !t.voided_at && !t.superseded_by)?.id ?? tests[0]?.id ?? '');
  const latestInspId = String(
    inspections.find((i) => !i.voided_at)?.id ?? inspections[0]?.id ?? '',
  );

  const runApprove = async (kind: 'test' | 'inspection') => {
    const id = kind === 'test' ? latestTestId : latestInspId;
    if (!id) {
      showNotification(`No ${kind} to approve`, 'error');
      return;
    }
    if (!reason.trim()) {
      showNotification('Enter a reason', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmQcApproveDeviation(kind, id, reason.trim());
      if (res.ok === false) throw new Error(res.message);
      showNotification('Deviation approved', 'success');
      setReason('');
      await passportQ.refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Approve failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runVoid = async (kind: 'test' | 'inspection') => {
    const id = kind === 'test' ? latestTestId : latestInspId;
    if (!id) {
      showNotification(`No ${kind} to void`, 'error');
      return;
    }
    if (!reason.trim()) {
      showNotification('Enter a reason', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmQcVoid(kind, id, reason.trim());
      if (res.ok === false) throw new Error(res.message);
      showNotification('Voided', 'success');
      setReason('');
      await passportQ.refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Void failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-5xl">
      <div className="flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-[14px] font-semibold text-slate-900">
              {roll?.roll_code ?? 'Roll passport'}
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {roll?.stage_code || '—'}
              {roll?.unit_form ? ` · ${unitFormOptionLabel(roll.unit_form)}` : ''}
              {roll?.width_form
                ? ` / ${roll.width_form === 'tubular' ? 'Tubular' : roll.width_form === 'open' ? 'Open' : roll.width_form}`
                : ''}
              {roll?.machine?.code ? ` · ${roll.machine.code}` : ''}
              {roll?.batch_no ? ` · ${roll.batch_no}` : ''}
              {roll?.dye_lot ? ` · dye ${roll.dye_lot}` : ''}
              {roll?.process_round != null ? ` · round ${roll.process_round}` : ''}
              {` · ${custodyLabel(roll?.custody?.side)}`}
              {widthText !== '—' ? ` · ${widthText}` : ''}
              {qtyText ? ` · ${qtyText}` : ''}
            </p>
            <div className="mt-1">
              <MmRollProcessMark status={roll?.process_status} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant={statusBadgeVariant(roll?.test_status)}>
                {statusLine('Test', roll?.test_status ?? passport.test_status, testOrigin)}
              </Badge>
              <Badge variant={(() => {
                const chip = rollInspectionChip({ inspection_status: roll?.inspection_status ?? passport.inspection_status, inspection: passport.inspection ?? roll?.inspection });
                return chip.tone === 'success' ? 'success' : chip.tone === 'warning' ? 'warning' : chip.tone === 'danger' ? 'danger' : statusBadgeVariant(roll?.inspection_status);
              })()}>
                {(() => {
                  const chip = rollInspectionChip({ inspection_status: roll?.inspection_status ?? passport.inspection_status, inspection: passport.inspection ?? roll?.inspection });
                  return chip.label === '—' ? statusLine('Insp', roll?.inspection_status ?? passport.inspection_status, inspectionOrigin) : `Insp ${chip.label}`;
                })()}
              </Badge>
              {(roll?.missing_keys ?? []).map((key) => (
                <Badge key={key} variant="warning">
                  Missing {key}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex flex-col gap-4 text-[11px]">
          {passportQ.isLoading ? (
            <p className="text-slate-400">Loading passport…</p>
          ) : passportQ.isError ? (
            <p className="text-red-600">
              {passportQ.error instanceof Error ? passportQ.error.message : 'Could not load passport'}
            </p>
          ) : (
            <>
              <section>
                <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">Tests</h5>
                {tests.length === 0 ? (
                  <p className="text-slate-400">No tests</p>
                ) : (
                  <ul className="space-y-1">
                    {tests.map((t) => {
                      const muted = Boolean(t.voided_at || t.superseded_by);
                      return (
                        <li
                          key={String(t.id)}
                          className={muted ? 'text-slate-400 line-through' : 'text-slate-700'}
                        >
                          {String(t.result ?? '—')}
                          {qcCaptureOriginLabel(t.origin) ? ` (${qcCaptureOriginLabel(t.origin)})` : ''}
                          {t.tested_at ? ` · ${String(t.tested_at)}` : ''}
                          {t.voided_at ? ' · void' : ''}
                          {t.superseded_by ? ' · superseded' : ''}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section>
                <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">Inspections</h5>
                {inspections.length === 0 ? (
                  <p className="text-slate-400">No inspections</p>
                ) : (
                  <ul className="space-y-1">
                    {inspections.map((insp) => (
                      <li
                        key={String(insp.id)}
                        className={insp.voided_at ? 'text-slate-400 line-through' : 'text-slate-700'}
                      >
                        {String(insp.result ?? '—')}
                        {qcCaptureOriginLabel(insp.origin) ? ` (${qcCaptureOriginLabel(insp.origin)})` : ''}
                        {insp.points_per_100_sqyd != null
                          ? ` · ${String(insp.points_per_100_sqyd)} /100`
                          : ''}
                        {Array.isArray(insp.defects) ? ` · ${insp.defects.length} defects` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">Made from</h5>
                {ancestors.length === 0 ? (
                  <p className="text-slate-400">No lineage</p>
                ) : (
                  <ul className="space-y-1">
                    {ancestors.map((a) => (
                      <li key={a.roll_id}>
                        {a.roll_code}
                        {a.depth != null ? ` · depth ${a.depth}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">Process history</h5>
                {processHistory.length === 0 ? (
                  <p className="text-slate-400">None</p>
                ) : (
                  <ul className="space-y-1">
                    {processHistory.map((row, idx) => (
                      <li key={String(row.id ?? idx)}>
                        {String(row.challan_no ?? row.process_name ?? row.id ?? idx)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">Allocations</h5>
                {allocations.length === 0 ? (
                  <p className="text-slate-400">None</p>
                ) : (
                  <ul className="space-y-1">
                    {allocations.map((row, idx) => (
                      <li key={String(row.id ?? idx)}>
                        {String(row.style_name ?? row.style_material_id ?? idx)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {cutApprovals.length > 0 ? (
                <section>
                  <h5 className="text-[12px] font-semibold text-slate-800 mb-1.5">Cut-at-risk</h5>
                  <ul className="space-y-1">
                    {cutApprovals.map((row, idx) => (
                      <li key={String(row.id ?? idx)}>{String(row.reason ?? row.id ?? idx)}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="border-t border-slate-100 pt-3">
                <Input
                  label="Manager reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Required for approve / void"
                />
              </section>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-wrap justify-between gap-2">
          <DesktopWriteGate>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runApprove('test')}
              >
                Approve test deviation
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runApprove('inspection')}
              >
                Approve insp. deviation
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runVoid('test')}
              >
                Void test
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runVoid('inspection')}
              >
                Void inspection
              </Button>
              {roll && rollCanReportDamage(roll) ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => setDamageOpen(true)}>
                  Report damage
                </Button>
              ) : null}
              {roll && rollIsRejected(roll) && rollUnitId(roll) ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => setDispositionOpen(true)}>
                  Disposition
                </Button>
              ) : null}
            </div>
          </DesktopWriteGate>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {roll ? (
        <>
          <MmReportDamageModal
            open={damageOpen}
            rolls={[roll]}
            onClose={() => setDamageOpen(false)}
            onDone={(message) => {
              showNotification(message, 'success');
              void passportQ.refetch();
            }}
          />
          <MmRejectedDispositionModal
            open={dispositionOpen}
            unitIds={rollUnitId(roll) ? [rollUnitId(roll) as string] : []}
            onClose={() => setDispositionOpen(false)}
            onDone={(message) => {
              showNotification(message, 'success');
              void passportQ.refetch();
            }}
          />
        </>
      ) : null}
    </Modal>
  );
}
