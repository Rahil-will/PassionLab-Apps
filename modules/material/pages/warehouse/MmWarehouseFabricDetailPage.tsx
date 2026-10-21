import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmAllocateV4Modal } from '../../components/MmAllocateV4Modal';
import {
  MmRejectedDispositionModal,
  MmReportDamageModal,
  rollCanReportDamage,
  rollIsRejected,
  rollUnitId,
} from '../../components/MmRollDamageActions';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { formatStoredQty, unitBase, useMmUnits } from '../../lib/units';
import { getFabricStockRolls, type MmFabricStockRoll } from '../../lib/mmFabricRpc';
import { lastTestParts } from '../../lib/qcTolerance';
import { MmRollProcessMark } from '../../components/MmProcessStatus';
import { finishedText, rollColour, rollStageLabel } from '../../lib/rollColour';
import type { MmAllocateMode, MmV4RollRow } from '../../lib/mmV4Rpc';
import { whMuted, whTd, whTdQty, whTh, whThQty } from './whTable';

function testBadgeVariant(result: string): 'success' | 'danger' | 'warning' | 'default' {
  const status = result.toUpperCase();
  if (status === 'PASS') return 'success';
  if (status === 'FAIL' || status === 'FAILED') return 'danger';
  if (status === 'HOLD') return 'warning';
  return 'default';
}

function RollTestCell({ roll }: { roll: MmV4RollRow }) {
  const test = lastTestParts(roll);
  if (test.result === '—') return '—';
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={testBadgeVariant(test.result)}>{test.result}</Badge>
      {test.tag ? <span className="text-[10px] text-slate-400">({test.tag})</span> : null}
    </span>
  );
}

function isFinished(roll: MmV4RollRow): boolean {
  return Boolean(roll.finished?.finished);
}

function bookedOrAllocated(roll: MmV4RollRow): string {
  const style = roll.style && typeof roll.style === 'object'
    ? String(roll.style.style_name ?? roll.style.fabric_line ?? '').trim()
    : '';
  if (style) return `Allocated · ${style}`;
  if (roll.booked_style || roll.booked_style_material_id) return `Booked · ${roll.booked_style || 'style'}`;
  return '—';
}

function qtyOf(roll: MmFabricStockRoll): number {
  const bucket = roll.stock?.bucket;
  if ((bucket === 'in_stock' || bucket === 'on_hold' || bucket === 'rejected') && roll.stock?.qty != null) {
    return Number(roll.stock.qty) || 0;
  }
  if ((roll.uom ?? '').toLowerCase() === 'kg') return Number(roll.weight_kg ?? roll.qty_available ?? 0);
  return Number(roll.length_m ?? roll.qty_available ?? 0);
}

export default function MmWarehouseFabricDetailPage() {
  useMmUnits();
  const fabricId = useNavigationStore((s) => s.routeParams.fabricId ?? '');
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<MmAllocateMode | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [damageOpen, setDamageOpen] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);

  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricRolls', fabricId] as const,
    queryFn: async () => {
      const res = await getFabricStockRolls({ fabric_id: fabricId });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && fabricId),
  });

  const rolls = rollsQ.data ?? [];
  const qtyUnit = rolls[0]?.qty_unit ?? rolls[0]?.uom;
  const fabricName = rolls[0]?.fabric_code || 'Fabric';

  usePageHeader({
    title: fabricName,
    subtitle: 'Rolls grouped by receipt. Allocate finished rolls, or book greige, onto a style line.',
  }, [fabricName]);

  const groups = useMemo(() => {
    const map = new Map<string, { receiptId: string; receiptNo: string; rolls: MmFabricStockRoll[] }>();
    for (const roll of rolls) {
      const receiptNo = String(roll.receipt_no || '').trim() || 'No receipt';
      const key = String(roll.receipt_id || receiptNo);
      const current = map.get(key) ?? { receiptId: String(roll.receipt_id || ''), receiptNo, rolls: [] };
      current.rolls.push(roll);
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => a.receiptNo.localeCompare(b.receiptNo));
  }, [rolls]);

  const selected = rolls.filter((roll) => picked[roll.roll_id]);
  const selectedIds = selected.map((roll) => roll.roll_id);
  const damageRolls = selected.filter(rollCanReportDamage);
  const rejectedUnits = selected.filter(rollIsRejected).map(rollUnitId).filter((unitId): unitId is string => Boolean(unitId));
  const allFinished = selected.length > 0 && selected.every(isFinished);
  const allGreige = selected.length > 0 && selected.every((roll) => !isFinished(roll));

  const toggleGroup = (ids: string[], on: boolean) => {
    setPicked((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = on;
      return next;
    });
  };

  const openMode = (next: MmAllocateMode) => {
    if (selectedIds.length === 0) {
      showNotification('Select the rolls', 'error');
      return;
    }
    if (next === 'allocate' && !allFinished) {
      showNotification('Allocate is for finished rolls', 'error');
      return;
    }
    if (next === 'book' && !allGreige) {
      showNotification('Book is for greige rolls', 'error');
      return;
    }
    setMode(next);
  };

  return (
    <PageShell
      loading={rollsQ.isLoading}
      error={rollsQ.error}
      onRetry={() => { void rollsQ.refetch(); }}
      skeleton="table"
    >
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-2">
          <DesktopWriteGate>
            <Button type="button" size="sm" variant="secondary" disabled={!allFinished} onClick={() => openMode('allocate')}>
              Allocate to style
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!allGreige} onClick={() => openMode('book')}>
              Book to style
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={damageRolls.length === 0 || damageRolls.length !== selected.length}
              onClick={() => setDamageOpen(true)}
            >
              Report damage
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={rejectedUnits.length === 0 || rejectedUnits.length !== selected.length}
              onClick={() => setDispositionOpen(true)}
            >
              Disposition
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={selectedIds.length === 0} onClick={() => setSendOpen(true)}>
              Send to processing
            </Button>
          </DesktopWriteGate>
          <span className={whMuted}>{selectedIds.length} selected</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>
                <th className={whTh} />
                <th className={whTh}>Roll</th>
                <th className={whTh}>Stage</th>
                <th className={whTh}>Colour</th>
                <th className={whTh}>Finished</th>
                <th className={whThQty}>Qty</th>
                <th className={whTh}>Test</th>
                <th className={whTh}>Inspection</th>
                <th className={whTh}>Booked / Allocated to</th>
                <th className={whTh}>Location</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">No rolls.</td>
                </tr>
              ) : groups.map((group) => {
                const ids = group.rolls.map((roll) => roll.roll_id);
                const qty = group.rolls.reduce((sum, roll) => sum + qtyOf(roll), 0);
                const allOn = ids.every((id) => picked[id]);
                return (
                  <React.Fragment key={group.receiptId || group.receiptNo}>
                    <tr className="bg-slate-50">
                      <td className={whTd}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          onChange={(event) => toggleGroup(ids, event.target.checked)}
                          aria-label={`Select ${group.receiptNo}`}
                        />
                      </td>
                      <td className={whTd} colSpan={4}>
                        {group.receiptNo}
                        <span className={`ml-2 ${whMuted}`}>{group.rolls.length} {group.rolls.length === 1 ? 'roll' : 'rolls'}</span>
                      </td>
                      <td className={whTdQty}>{formatStoredQty(qty, qtyUnit)}</td>
                      <td className={whTd} colSpan={4} />
                    </tr>
                    {group.rolls.map((roll) => {
                      const mark = finishedText(roll.finished);
                      return (
                        <tr key={roll.roll_id}>
                          <td className={whTd}>
                            <input
                              type="checkbox"
                              checked={Boolean(picked[roll.roll_id])}
                              onChange={(event) => setPicked((current) => ({ ...current, [roll.roll_id]: event.target.checked }))}
                              aria-label={`Select ${roll.roll_code}`}
                            />
                          </td>
                          <td className={whTd}>
                            {roll.roll_code}
                            {rollIsRejected(roll) ? <span className="ml-2 text-[10px] font-semibold text-red-700">Rejected</span> : null}
                          </td>
                          <td className={whTd}>
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <span>{roll.stage_label || rollStageLabel(roll)}</span>
                              <MmRollProcessMark status={roll.process_status} />
                            </span>
                          </td>
                          <td className={whTd}>{roll.color || rollColour(roll)}</td>
                          <td className={whTd}>{mark.text}</td>
                          <td className={whTdQty}>{formatStoredQty(qtyOf(roll), roll.qty_unit ?? qtyUnit)}</td>
                          <td className={whTd}><RollTestCell roll={roll} /></td>
                          <td className={whTd}>{roll.inspection_status || '—'}</td>
                          <td className={whTd}>{bookedOrAllocated(roll)}</td>
                          <td className={whTd}>{roll.location?.code || roll.location?.name || '—'}</td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <MmAllocateV4Modal
        open={mode != null}
        mode={mode ?? 'allocate'}
        rollIds={selectedIds}
        fabricId={fabricId}
        uom={unitBase(qtyUnit) === 'kg' ? 'kg' : 'm'}
        onClose={() => setMode(null)}
        onDone={() => { setMode(null); setPicked({}); void rollsQ.refetch(); }}
      />
      <MmProcSendModalV4
        open={sendOpen}
        side="warehouse"
        preselectedRollIds={selectedIds}
        onClose={() => setSendOpen(false)}
        onSent={(challanId) => {
          setSendOpen(false);
          requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, { id: challanId });
        }}
      />
      <MmReportDamageModal
        open={damageOpen}
        rolls={damageRolls}
        onClose={() => setDamageOpen(false)}
        onDone={(message) => {
          showNotification(message, 'success');
          setPicked({});
          void rollsQ.refetch();
        }}
      />
      <MmRejectedDispositionModal
        open={dispositionOpen}
        unitIds={rejectedUnits}
        onClose={() => setDispositionOpen(false)}
        onDone={(message) => {
          showNotification(message, 'success');
          setPicked({});
          void rollsQ.refetch();
        }}
      />
    </PageShell>
  );
}
