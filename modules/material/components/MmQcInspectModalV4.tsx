import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, SelectDropdown } from '../../../components/ui';
import { LabeledDatePicker } from '../../../components/SingleDatePicker';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { MmSheetGrid, type SheetColumn } from './MmSheetGrid';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import {
  mmQcGetScope,
  mmQcSaveInspections,
  type MmV4QcScopeKind,
  type MmV4QcSiteSide,
} from '../lib/mmV4Rpc';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

type InspectDraft = {
  roll_id: string;
  roll_code: string;
  inspected_length: string;
  length_uom: 'm' | 'yd';
  cuttable_width: string;
  width_uom: 'in' | 'cm';
  pts1: string;
  pts2: string;
  pts3: string;
  pts4: string;
  override: string;
  remarks: string;
};

function score(row: InspectDraft): number | null {
  const length = Number(row.inspected_length);
  const width = Number(row.cuttable_width);
  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null;
  const n = (v: string) => {
    const p = Number(v);
    return Number.isFinite(p) && p > 0 ? p : 0;
  };
  const points = n(row.pts1) + 2 * n(row.pts2) + 3 * n(row.pts3) + 4 * n(row.pts4);
  const yards = row.length_uom === 'yd' ? length : length / 0.9144;
  const inches = row.width_uom === 'cm' ? width / 2.54 : width;
  if (!(yards > 0) || !(inches > 0)) return null;
  return Math.round(((points * 3600) / (yards * inches)) * 100) / 100;
}

export function MmQcInspectModalV4({
  open,
  scopeKind,
  scopeId,
  rollIds,
  defaultSiteSide,
  onClose,
  onSaved,
}: {
  open: boolean;
  scopeKind: MmV4QcScopeKind;
  scopeId?: string | null;
  rollIds?: string[];
  defaultSiteSide: MmV4QcSiteSide;
  onClose: () => void;
  onSaved: () => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const [siteSide, setSiteSide] = useState<MmV4QcSiteSide>(defaultSiteSide);
  const [inspectedAt, setInspectedAt] = useState(todayIso());
  const [rows, setRows] = useState<InspectDraft[]>([]);
  const [busy, setBusy] = useState(false);

  const scopeQ = useQuery({
    queryKey: [
      ...queryKeys.mmOps(factoryId ?? ''),
      'qcScopeInspect',
      scopeKind,
      scopeId ?? '',
      (rollIds ?? []).join(','),
    ] as const,
    queryFn: async () => {
      const res = await mmQcGetScope(scopeKind, scopeId ?? '', rollIds);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: open && Boolean(factoryId) && (Boolean(scopeId) || (rollIds?.length ?? 0) > 0),
  });

  useEffect(() => {
    if (!open) return;
    setSiteSide(defaultSiteSide);
    setInspectedAt(todayIso());
    setBusy(false);
  }, [open, defaultSiteSide]);

  useEffect(() => {
    if (!scopeQ.data) return;
    setRows(
      (scopeQ.data.rolls ?? []).map((roll) => ({
        roll_id: roll.roll_id,
        roll_code: roll.roll_code,
        inspected_length: roll.length_m != null ? String(roll.length_m) : '',
        length_uom: 'm',
        cuttable_width: '',
        width_uom: 'in',
        pts1: '',
        pts2: '',
        pts3: '',
        pts4: '',
        override: '',
        remarks: '',
      })),
    );
  }, [scopeQ.dataUpdatedAt]);

  const columns: SheetColumn[] = useMemo(
    () => [
      { key: 'roll', label: 'Roll', width: '7rem' },
      { key: 'len', label: 'Insp. length', editable: true, width: '6.5rem' },
      {
        key: 'len_uom',
        label: 'Len uom',
        editable: true,
        kind: 'select',
        options: [
          { value: 'm', label: 'm' },
          { value: 'yd', label: 'yd' },
        ],
        width: '5rem',
      },
      { key: 'width', label: 'Cuttable width', editable: true, width: '7rem' },
      {
        key: 'width_uom',
        label: 'W uom',
        editable: true,
        kind: 'select',
        options: [
          { value: 'in', label: 'in' },
          { value: 'cm', label: 'cm' },
        ],
        width: '5rem',
      },
      { key: 'pts1', label: '1 pt', editable: true, width: '4rem' },
      { key: 'pts2', label: '2 pt', editable: true, width: '4rem' },
      { key: 'pts3', label: '3 pt', editable: true, width: '4rem' },
      { key: 'pts4', label: '4 pt', editable: true, width: '4rem' },
      { key: 'score', label: 'Per 100', width: '5.5rem' },
      { key: 'verdict', label: 'Pass/fail', width: '5.5rem' },
      { key: 'override', label: 'Override', editable: true, width: '8rem' },
    ],
    [],
  );

  const getValue = (rowIndex: number, key: string): string => {
    const row = rows[rowIndex];
    if (!row) return '';
    if (key === 'roll') return row.roll_code;
    if (key === 'len') return row.inspected_length;
    if (key === 'len_uom') return row.length_uom;
    if (key === 'width') return row.cuttable_width;
    if (key === 'width_uom') return row.width_uom;
    if (key === 'pts1') return row.pts1;
    if (key === 'pts2') return row.pts2;
    if (key === 'pts3') return row.pts3;
    if (key === 'pts4') return row.pts4;
    if (key === 'override') return row.override;
    if (key === 'score') {
      const sc = score(row);
      return sc != null ? String(sc) : '—';
    }
    if (key === 'verdict') {
      const sc = score(row);
      return sc == null ? '—' : sc <= 40 ? 'pass' : 'fail';
    }
    return '';
  };

  const patch = (index: number, key: string, value: string) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (key === 'len') return { ...row, inspected_length: value };
        if (key === 'len_uom') return { ...row, length_uom: value === 'yd' ? 'yd' : 'm' };
        if (key === 'width') return { ...row, cuttable_width: value };
        if (key === 'width_uom') return { ...row, width_uom: value === 'cm' ? 'cm' : 'in' };
        if (key === 'pts1') return { ...row, pts1: value };
        if (key === 'pts2') return { ...row, pts2: value };
        if (key === 'pts3') return { ...row, pts3: value };
        if (key === 'pts4') return { ...row, pts4: value };
        if (key === 'override') return { ...row, override: value };
        return row;
      }),
    );
  };

  const save = async () => {
    const payloadRows = rows
      .filter((r) => Number(r.inspected_length) > 0 && Number(r.cuttable_width) > 0)
      .map((r) => ({
          roll_id: r.roll_id,
          inspected_length: Number(r.inspected_length),
          length_uom: r.length_uom,
          cuttable_width: Number(r.cuttable_width),
          width_uom: r.width_uom,
          pts_1: Number(r.pts1) || 0,
          pts_2: Number(r.pts2) || 0,
          pts_3: Number(r.pts3) || 0,
          pts_4: Number(r.pts4) || 0,
          override_reason: r.override.trim() || null,
          remarks: r.remarks.trim() || null,
        }));
    if (payloadRows.length === 0) {
      showNotification('Enter length and width on at least one roll', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmQcSaveInspections({
        site_side: siteSide,
        inspected_at: inspectedAt || null,
        origin: 'own',
        rows: payloadRows,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Saved ${res.data.rows.length} inspections`, 'success');
      onSaved();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save inspections failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} className="max-w-5xl">
      <div className="flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[14px] font-semibold text-slate-900">Inspect rolls</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">{rows.length} rolls · 4-point</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SelectDropdown
              value={siteSide}
              onChange={(v) => setSiteSide(v as MmV4QcSiteSide)}
              options={[
                { value: 'mill', label: 'Mill' },
                { value: 'processing', label: 'Processing' },
                { value: 'warehouse', label: 'Warehouse' },
              ]}
              className="w-36"
            />
            <LabeledDatePicker label="" value={inspectedAt} onChange={setInspectedAt} />
          </div>
        </div>
        <div className="p-3 overflow-auto">
          {scopeQ.isError ? (
            <p className="text-[12px] text-red-600 px-2">
              {scopeQ.error instanceof Error ? scopeQ.error.message : 'Could not load scope'}
            </p>
          ) : null}
          <MmSheetGrid
            columns={columns}
            rowCount={rows.length}
            getValue={getValue}
            onChange={(row, key, value) => patch(row, key, value)}
            emptyText="No rolls in scope"
          />
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={busy || scopeQ.isLoading} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DesktopWriteGate>
        </div>
      </div>
    </Modal>
  );
}
