import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { MmSheetGrid, type SheetColumn } from '../../components/MmSheetGrid';
import { parseTestOptions } from '../../lib/mmRollDraft';
import { displayNumberToInches, formatStoredQty, parseQtyUnit, parseWidthUnit, qtyLabel, toDisplayWidth, unitBase, useMmUnits, widthLabel } from '../../lib/units';
import { processStatusText } from '../../components/MmProcessStatus';
import { lastTestCaption, toleranceState } from '../../lib/qcTolerance';
import {
  mmQcGetScope,
  mmQcSaveInspections,
  mmQcSaveTestGrid,
  type MmQcScopeDocument,
  type MmQcScopeSession,
  type MmV4QcResult,
  type MmV4RollRow,
} from '../../lib/mmV4Rpc';

function lastResult(roll: MmV4RollRow): string {
  return lastTestCaption(roll);
}

function qtyOf(roll: MmV4RollRow): string {
  const unit = parseQtyUnit(roll.qty_unit ?? roll.uom);
  const n = unitBase(unit) === 'kg' ? roll.weight_kg : roll.length_m;
  return formatStoredQty(n == null ? null : Number(n), unit);
}

function widthFieldLabel(label: string, key: string, unit: string): string {
  if (key !== 'width_in') return label || key;
  const base = (label || key).replace(/\s*\((in|cm|inches|inch)\)\s*$/i, '');
  return `${base} (${widthLabel(unit)})`;
}

function widthHint(limit: { text?: string | null; target?: number | null; min?: number | null; max?: number | null } | null | undefined, key: string, unit: string): string | undefined {
  if (!limit) return undefined;
  if (key !== 'width_in') return limit.text?.trim() || undefined;
  const parts: string[] = [];
  if (limit.target != null && Number.isFinite(Number(limit.target))) {
    const shown = toDisplayWidth(Number(limit.target), unit);
    if (shown != null) parts.push(`Spec ${shown} ${widthLabel(unit)}`);
  }
  if (limit.min != null && limit.max != null) {
    const min = toDisplayWidth(Number(limit.min), unit);
    const max = toDisplayWidth(Number(limit.max), unit);
    if (min != null && max != null) parts.push(`${min}–${max} ${widthLabel(unit)}`);
  }
  if (parts.length > 0) return parts.join(' · ');
  return limit.text?.trim() || undefined;
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function personName(value: MmQcScopeSession['tested_by']): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value.full_name || value.name || '').trim();
  return '';
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

type StripItem = { label: string; value: string };

function stripItems(doc: MmQcScopeDocument): StripItem[] {
  const fabric = [doc.fabric?.code, doc.fabric?.name].filter(Boolean).join(' – ');
  const items: StripItem[] = [
    { label: 'No', value: textOf(doc.no) },
    { label: 'Date', value: dateLabel(doc.date) },
    { label: 'Party', value: textOf(doc.party) },
    { label: 'Party ref', value: textOf(doc.party_ref) },
    { label: 'PO', value: textOf(doc.po_no) },
    { label: 'Fabric', value: fabric },
    { label: 'Stage', value: textOf(doc.stage_label) },
    { label: 'Colour', value: textOf(doc.colour) },
    { label: 'Rolls', value: doc.roll_count != null ? String(doc.roll_count) : '' },
  ];
  if (doc.kind === 'process_challan') {
    items.push(
      { label: 'Process', value: textOf(doc.process) },
      { label: 'Returned', value: dateLabel(doc.returned_at) },
    );
  }
  return items.filter((item) => item.value !== '');
}

export default function MmWarehouseTestingDetail() {
  useMmUnits();
  const id = useNavigationStore((s) => s.routeParams.id ?? '');
  const kindParam = useNavigationStore((s) => s.routeParams.kind ?? '');
  const inspecting = useNavigationStore((s) => s.routeParams.mode) === 'inspection';
  const factoryId = useNavigationStore((s) => s.factoryId);
  const setUnsaved = useNavigationStore((s) => s.setUnsaved);
  const setPendingSaveAction = useNavigationStore((s) => s.setPendingSaveAction);
  const setPendingDiscardAction = useNavigationStore((s) => s.setPendingDiscardAction);
  const setUnsavedPrompt = useNavigationStore((s) => s.setUnsavedPrompt);
  const { showNotification } = useNotificationStore();
  const scopeKind = kindParam === 'process_challan' ? 'process_challan' : 'in_challan';
  const [cells, setCells] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, MmV4QcResult | ''>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const scopeQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'testingScope', scopeKind, id] as const,
    queryFn: async () => {
      const res = await mmQcGetScope(scopeKind, id);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });

  const rolls = scopeQ.data?.rolls ?? [];
  const fields = scopeQ.data?.fields ?? [];
  const widthUnit = parseWidthUnit(
    scopeQ.data?.document?.fabric?.width_unit
    ?? rolls[0]?.width_unit
    ?? 'in',
  );
  const qtyUnit = parseQtyUnit(scopeQ.data?.document?.fabric?.qty_unit ?? rolls[0]?.qty_unit ?? rolls[0]?.uom);
  const doc = scopeQ.data?.document ?? null;
  const sessions = useMemo(() => {
    const rows = [...(scopeQ.data?.sessions ?? [])];
    rows.sort((a, b) => String(b.tested_at ?? '').localeCompare(String(a.tested_at ?? '')));
    return rows;
  }, [scopeQ.data?.sessions]);
  const facts = doc ? stripItems(doc) : [];
  const lengthUnit = unitBase(qtyUnit) === 'm' ? qtyUnit : 'm';
  const title = inspecting
    ? (doc?.kind_label && doc.no ? `Inspect rolls · ${doc.kind_label} ${doc.no}` : 'Inspect rolls')
    : (doc?.kind_label && doc.no ? `Test rolls · ${doc.kind_label} ${doc.no}` : 'Test rolls');

  const cellKey = (rollId: string, key: string) => `${rollId}::${key}`;

  const dirty = useMemo(() => (
    Object.values(cells).some((value) => value.trim() !== '')
    || Object.values(results).some((value) => value === 'pass' || value === 'hold' || value === 'fail')
    || Object.values(remarks).some((value) => value.trim() !== '')
  ), [cells, remarks, results]);

  const columns = useMemo<SheetColumn[]>(() => [
    ...(inspecting ? [
      { key: 'roll', label: 'Roll', editable: false, width: '7rem' },
      { key: 'length', label: `Length (${qtyLabel(lengthUnit)})`, editable: true, width: '6rem' },
      { key: 'width', label: `Width (${widthLabel(widthUnit)})`, editable: true, width: '6rem' },
      { key: 'pts_1', label: '1 pt', editable: true, width: '4rem' },
      { key: 'pts_2', label: '2 pt', editable: true, width: '4rem' },
      { key: 'pts_3', label: '3 pt', editable: true, width: '4rem' },
      { key: 'pts_4', label: '4 pt', editable: true, width: '4rem' },
      { key: 'remarks', label: 'Remarks', editable: true, width: '10rem' },
    ] satisfies SheetColumn[] : []),
    ...(!inspecting ? [
    { key: 'roll', label: 'Roll', editable: false, width: '7rem' },
    { key: 'qty', label: `Qty (${qtyLabel(qtyUnit)})`, editable: false, width: '5rem' },
    { key: 'stage', label: 'Stage', editable: false, width: '6rem' },
    { key: 'colour', label: 'Colour', editable: false, width: '6rem' },
    { key: 'last', label: 'Last result', editable: false, width: '8rem' },
    ...fields.map((field) => ({
      key: field.key,
      label: widthFieldLabel(field.label || field.key, field.key, widthUnit),
      hint: widthHint(field.limit, field.key, widthUnit),
      editable: true,
      width: '7rem',
      kind: field.data_type === 'select' ? 'select' as const : field.data_type === 'checkbox' ? 'check' as const : 'text' as const,
      options: field.data_type === 'select'
        ? [{ value: '', label: '—' }, ...parseTestOptions(field.options).map((opt) => ({ value: opt, label: opt }))]
        : undefined,
    })),
    {
      key: 'result',
      label: 'Result',
      editable: true,
      kind: 'select',
      width: '6rem',
      options: [
        { value: '', label: '—' },
        { value: 'pass', label: 'Pass' },
        { value: 'hold', label: 'Hold' },
        { value: 'fail', label: 'Fail' },
      ],
    },
    { key: 'remarks', label: 'Remarks', editable: true, width: '10rem' },
    ] satisfies SheetColumn[] : []),
  ], [fields, inspecting, lengthUnit, qtyUnit, rolls, widthUnit]);

  const save = async (): Promise<boolean> => {
    if (inspecting) {
      let invalid = '';
      const rows = rolls.flatMap((roll) => {
        const lengthRaw = (cells[cellKey(roll.roll_id, 'length')] ?? '').trim();
        const widthRaw = (cells[cellKey(roll.roll_id, 'width')] ?? '').trim();
        const points = ['pts_1', 'pts_2', 'pts_3', 'pts_4'].map((key) => (cells[cellKey(roll.roll_id, key)] ?? '').trim());
        const note = (remarks[roll.roll_id] ?? '').trim();
        const touched = Boolean(lengthRaw || widthRaw || note || points.some(Boolean));
        if (!touched) return [];
        if (!lengthRaw || !widthRaw) {
          invalid = `${roll.roll_code}: enter length and width`;
          return [];
        }
        const length = Number(lengthRaw);
        const width = widthUnit === 'cm' ? Number(widthRaw) : displayNumberToInches(widthRaw, widthUnit);
        if (!Number.isFinite(length) || length <= 0 || width == null || !Number.isFinite(width) || width <= 0) {
          invalid = `${roll.roll_code}: length and width must be numbers`;
          return [];
        }
        const counts = points.map((raw) => {
          if (!raw) return 0;
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 0) {
            invalid = `${roll.roll_code}: defect counts are whole numbers`;
            return 0;
          }
          return n;
        });
        return [{
          roll_id: roll.roll_id,
          inspected_length: length,
          length_uom: lengthUnit === 'yd' ? 'yd' as const : 'm' as const,
          cuttable_width: width,
          width_uom: widthUnit === 'cm' ? 'cm' as const : 'in' as const,
          pts_1: counts[0],
          pts_2: counts[1],
          pts_3: counts[2],
          pts_4: counts[3],
          remarks: note || null,
        }];
      });
      if (invalid) {
        showNotification(invalid, 'error');
        return false;
      }
      if (rows.length === 0) {
        showNotification('Enter length and width on at least one roll', 'error');
        return false;
      }
      setSaving(true);
      try {
        const res = await mmQcSaveInspections({ site_side: 'warehouse', rows });
        if (res.ok === false) throw new Error(res.message);
        showNotification(`${res.data.rows?.length ?? rows.length} rolls inspected`, 'success');
        setCells({});
        setRemarks({});
        setUnsaved(false);
        await scopeQ.refetch();
        return true;
      } catch (error) {
        showNotification(error instanceof Error ? error.message : 'Save failed', 'error');
        return false;
      } finally {
        setSaving(false);
      }
    }
    let invalid = '';
    const payloadRows = rolls.flatMap((roll) => {
      const result = results[roll.roll_id];
      if (result !== 'pass' && result !== 'hold' && result !== 'fail') return [];
      const values: Record<string, unknown> = {};
      for (const field of fields) {
        const raw = (cells[cellKey(roll.roll_id, field.key)] ?? '').trim();
        if (!raw) continue;
        if (field.data_type === 'checkbox') {
          if (raw === 'true') values[field.key] = true;
          else if (raw === 'false') values[field.key] = false;
          continue;
        }
        if (field.data_type === 'number' || field.data_type === 'decimal') {
          const num = Number(raw);
          if (!Number.isFinite(num)) {
            invalid = `${roll.roll_code}: ${field.label || field.key} must be a number`;
            return [];
          }
          values[field.key] = field.key === 'width_in'
            ? displayNumberToInches(raw, widthUnit)
            : num;
        } else {
          values[field.key] = raw;
        }
      }
      return [{
        roll_id: roll.roll_id,
        result,
        values,
        remarks: (remarks[roll.roll_id] ?? '').trim() || null,
      }];
    });
    if (invalid) {
      showNotification(invalid, 'error');
      return false;
    }
    if (payloadRows.length === 0) {
      showNotification('Set pass, fail or hold on at least one roll', 'error');
      return false;
    }
    setSaving(true);
    try {
      const res = await mmQcSaveTestGrid({
        scope_kind: scopeKind,
        scope_id: id,
        site_side: 'warehouse',
        rows: payloadRows,
      });
      if (res.ok === false) throw new Error(res.message);
      const outside = res.data.out_of_tolerance?.length ?? 0;
      const toast = outside > 0
        ? `${res.data.saved} rolls tested · ${outside} out of tolerance`
        : `${res.data.saved} rolls tested`;
      showNotification(toast, 'success');
      setCells({});
      setResults({});
      setRemarks({});
      setUnsaved(false);
      await scopeQ.refetch();
      return true;
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Save failed', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    setUnsavedPrompt({
      title: inspecting ? 'Unsaved inspection' : 'Unsaved test data',
      body: inspecting
        ? 'You have inspection values that are not saved.'
        : 'You have test values that are not saved.',
      cancelLabel: 'Keep editing',
      discardLabel: 'Discard changes',
      hideSave: true,
    });
    return () => setUnsavedPrompt(null);
  }, [inspecting, setUnsavedPrompt]);

  useEffect(() => {
    setUnsaved(dirty);
  }, [dirty, setUnsaved]);

  useEffect(() => {
    if (!dirty) {
      setPendingSaveAction(null);
      setPendingDiscardAction(null);
      return;
    }
    setPendingDiscardAction(() => {
      setCells({});
      setResults({});
      setRemarks({});
      setUnsaved(false);
    });
    return () => {
      setPendingSaveAction(null);
      setPendingDiscardAction(null);
    };
  }, [dirty, setPendingDiscardAction, setPendingSaveAction, setUnsaved]);

  useEffect(() => () => {
    setUnsaved(false);
    setPendingSaveAction(null);
    setPendingDiscardAction(null);
  }, [setPendingDiscardAction, setPendingSaveAction, setUnsaved]);

  usePageHeader({
    title,
    subtitle: inspecting
      ? 'Enter length, width, and defect points per roll. A row without length and width is not saved.'
      : 'Enter values per roll. Cells outside tolerance turn red. Rows without a result are not saved.',
  }, [title, inspecting]);

  return (
    <PageShell
      loading={scopeQ.isLoading}
      error={scopeQ.error}
      onRetry={() => { void scopeQ.refetch(); }}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden w-full"
    >
      <div className="-mx-4 flex flex-col flex-1 min-h-0">
        <div className="px-4 pb-3 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0 flex flex-wrap gap-x-5 gap-y-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{fact.label}</p>
                <p className="text-[13px] font-semibold text-slate-900 truncate">{fact.value}</p>
              </div>
            ))}
          </div>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={saving || rolls.length === 0} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DesktopWriteGate>
        </div>

        <div className="flex-1 min-h-0 bg-white border-y border-slate-200">
          <MmSheetGrid
            columns={columns}
            rowCount={rolls.length}
            emptyText="No rolls on this document."
            fit
            cellTone={(row, key) => {
              const roll = rolls[row];
              const field = fields.find((item) => item.key === key);
              if (!roll || !field) return undefined;
              const raw = cells[cellKey(roll.roll_id, key)] ?? '';
              const compare = key === 'width_in'
                ? String(displayNumberToInches(raw, widthUnit) ?? '')
                : raw;
              return toleranceState(field.limit, compare) === 'out' ? 'out' : undefined;
            }}
            getValue={(row, key) => {
              const roll = rolls[row];
              if (!roll) return '';
              if (key === 'roll') return roll.roll_code;
              if (key === 'qty') return qtyOf(roll);
              if (key === 'stage') {
                const stage = roll.stage_label || roll.stage_code || '—';
                const mark = processStatusText(roll.process_status);
                return mark ? `${stage} · ${mark}` : stage;
              }
              if (key === 'colour') return roll.color || roll.color_ref || '—';
              if (key === 'last') return lastResult(roll);
              if (key === 'result') return results[roll.roll_id] || '';
              if (key === 'remarks') return remarks[roll.roll_id] || '';
              return cells[cellKey(roll.roll_id, key)] ?? '';
            }}
            onChange={(row, key, value) => {
              const roll = rolls[row];
              if (!roll) return;
              if (key === 'result') {
                const next: MmV4QcResult | '' = value === 'pass' || value === 'hold' || value === 'fail' ? value : '';
                setResults((current) => ({ ...current, [roll.roll_id]: next }));
                return;
              }
              if (key === 'remarks') {
                setRemarks((current) => ({ ...current, [roll.roll_id]: value }));
                return;
              }
              setCells((current) => ({ ...current, [cellKey(roll.roll_id, key)]: value }));
            }}
          />
        </div>

        {inspecting ? null : <details className="mx-4 mt-3 shrink-0 rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-slate-700">
            Past sessions
          </summary>
          {sessions.length === 0 ? (
            <p className="px-3 pb-3 text-[11px] text-slate-400">No sessions yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-1.5">Date</th>
                  <th className="px-3 py-1.5">By</th>
                  <th className="px-3 py-1.5">Rolls</th>
                  <th className="px-3 py-1.5">Pass</th>
                  <th className="px-3 py-1.5">Hold</th>
                  <th className="px-3 py-1.5">Fail</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.session_id} className="text-[12px] text-slate-700 border-t border-slate-100">
                    <td className="px-3 py-1.5">{dateLabel(session.tested_at) || '—'}</td>
                    <td className="px-3 py-1.5">{personName(session.tested_by) || '—'}</td>
                    <td className="px-3 py-1.5">{session.rolls ?? '—'}</td>
                    <td className="px-3 py-1.5">{session.pass ?? '—'}</td>
                    <td className="px-3 py-1.5">{session.hold ?? '—'}</td>
                    <td className="px-3 py-1.5">{session.fail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>}
      </div>
    </PageShell>
  );
}
