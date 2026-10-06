import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Button, Card } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { useNotificationStore } from '../../../stores';
import { MmSheetGrid, type SheetColumn } from './MmSheetGrid';
import { formatQtyM } from '../lib/mmRollDraft';
import { normalizePassFail } from '../lib/mmSheetGrid';
import {
  fourPointScore,
  fourPointValues,
  fourPointVerdict,
  toFourPointDraft,
  type FourPointDraft,
  type FourPointResult,
} from '../lib/mmFourPoint';
import { mmSaveInspections, type MmInspectionScopeKind } from '../lib/mmRpc';

export interface FourPointRoll {
  id: string;
  unit_code: string;
  length_m?: number | null;
  qty?: number | null;
  shade?: string | null;
  qc_result?: string | null;
  attributes?: Record<string, unknown> | null;
}

interface Props {
  scopeKind: MmInspectionScopeKind;
  scopeId: string;
  rolls: FourPointRoll[];
  uom?: string | null;
  subtitle?: string;
  onSaved?: () => Promise<void> | void;
}

const columns: SheetColumn[] = [
  { key: 'sno', label: 'S.No', width: '3.25rem' },
  { key: 'roll', label: 'Roll no.', width: '8rem' },
  { key: 'qty', label: 'Qty', width: '6rem', headerClassName: 'text-blue-700 bg-blue-50', cellClassName: 'bg-blue-50/40' },
  { key: 'shade', label: 'Shade', width: '6rem' },
  { key: 'insp_len', label: 'Actual length', editable: true, width: '6.5rem' },
  { key: 'actual_width', label: 'Actual width', editable: true, width: '6.5rem' },
  { key: 'cuttable_width', label: 'Cuttable width', editable: true, width: '7rem' },
  {
    key: 'width_uom',
    label: 'Width unit',
    editable: true,
    kind: 'select',
    options: [
      { value: 'in', label: 'in' },
      { value: 'cm', label: 'cm' },
    ],
    width: '5.5rem',
  },
  { key: 'pts1', label: '1 pt', editable: true, width: '4rem' },
  { key: 'pts2', label: '2 pt', editable: true, width: '4rem' },
  { key: 'pts3', label: '3 pt', editable: true, width: '4rem' },
  { key: 'pts4', label: '4 pt', editable: true, width: '4rem' },
  { key: 'score', label: 'Per 100', width: '7rem' },
  { key: 'override', label: 'Override reason', editable: true, width: '9rem' },
  {
    key: 'result',
    label: 'Pass / fail',
    editable: true,
    kind: 'select',
    options: [
      { value: '', label: '—' },
      { value: 'pass', label: 'Pass' },
      { value: 'fail', label: 'Fail' },
    ],
    headerClassName: 'text-emerald-800 bg-emerald-50',
    cellClassName: 'bg-emerald-50/40',
    width: '7.5rem',
  },
];

export function MmFourPointInspectPanel({
  scopeKind,
  scopeId,
  rolls,
  uom,
  subtitle,
  onSaved,
}: Props) {
  const { showNotification } = useNotificationStore();
  const [rows, setRows] = useState<FourPointDraft[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(rolls.filter((roll) => Boolean(roll.id)).map(toFourPointDraft));
  }, [rolls]);

  const sheetValue = (rowIndex: number, key: string): string => {
    const row = rows[rowIndex];
    if (!row) return '';
    if (key === 'sno') return String(rowIndex + 1);
    if (key === 'roll') return row.unit_code;
    if (key === 'qty') return formatQtyM(row.length_m, uom);
    if (key === 'shade') return row.shade;
    if (key === 'insp_len') return row.inspectedLength;
    if (key === 'actual_width') return row.actualWidth;
    if (key === 'cuttable_width') return row.cuttableWidth;
    if (key === 'width_uom') return row.widthUom;
    if (key === 'pts1') return row.pts1;
    if (key === 'pts2') return row.pts2;
    if (key === 'pts3') return row.pts3;
    if (key === 'pts4') return row.pts4;
    if (key === 'score') {
      const score = fourPointScore(row, uom ?? null);
      return score == null ? '' : `${score.toFixed(2)} ${fourPointVerdict(score)}`;
    }
    if (key === 'override') return row.overrideReason;
    if (key === 'result') return row.result;
    return '';
  };

  const sheetChange = (rowIndex: number, key: string, value: string) => {
    setRows((list) =>
      list.map((item, index) => {
        if (index !== rowIndex) return item;
        if (key === 'insp_len') return { ...item, inspectedLength: value };
        if (key === 'actual_width') return { ...item, actualWidth: value };
        if (key === 'cuttable_width') return { ...item, cuttableWidth: value };
        if (key === 'width_uom') return { ...item, widthUom: value === 'cm' ? 'cm' : 'in' };
        if (key === 'pts1') return { ...item, pts1: value };
        if (key === 'pts2') return { ...item, pts2: value };
        if (key === 'pts3') return { ...item, pts3: value };
        if (key === 'pts4') return { ...item, pts4: value };
        if (key === 'override') return { ...item, overrideReason: value };
        if (key === 'result') {
          const next = normalizePassFail(value);
          const result: FourPointResult = next || (value === 'pass' || value === 'fail' ? value : '');
          return { ...item, result };
        }
        return item;
      }),
    );
  };

  const payload = () =>
    rows
      .filter((row) => !row.inspected && (row.result === 'pass' || row.result === 'fail'))
      .map((row) => ({
        id: row.id,
        result: row.result === 'pass' || row.result === 'fail' ? row.result : null,
        values: fourPointValues(row),
      }));

  const save = async () => {
    const mismatched = rows.find((row) => {
      if (row.inspected || (row.result !== 'pass' && row.result !== 'fail')) return false;
      const score = fourPointScore(row, uom ?? null);
      if (score == null) return false;
      return row.result !== fourPointVerdict(score) && row.overrideReason.trim().length === 0;
    });
    if (mismatched) {
      showNotification(`${mismatched.unit_code}: an override needs a reason`, 'error');
      return;
    }
    const rollsPayload = payload();
    if (rollsPayload.length === 0) {
      showNotification('Set pass or fail on at least one roll', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmSaveInspections(scopeKind, scopeId, rollsPayload);
      if (res.ok === false) throw new Error(res.message);
      showNotification('4-point saved', 'success');
      await onSaved?.();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
            <ClipboardList size={16} className="text-primary-600" />
            4-point inspection
          </h4>
          <p className="text-[11px] text-slate-500 mt-1">
            {subtitle ?? 'Actual length, actual width, cuttable width, and 4-point on this mill batch.'}
          </p>
        </div>
        <DesktopWriteGate>
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save 4-point'}
          </Button>
        </DesktopWriteGate>
      </div>
      <div className="px-3 pb-3">
        <MmSheetGrid
          columns={columns}
          rowCount={rows.length}
          getValue={sheetValue}
          onChange={sheetChange}
          isRowLocked={(row) => rows[row]?.inspected === true}
          emptyText="No rolls to inspect."
        />
      </div>
    </Card>
  );
}
