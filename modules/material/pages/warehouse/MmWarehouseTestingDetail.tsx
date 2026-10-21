import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Modal } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { MmSheetGrid, type SheetColumn } from '../../components/MmSheetGrid';
import { parseTestOptions } from '../../lib/mmRollDraft';
import { displayNumberToInches, formatStoredQty, parseQtyUnit, parseWidthUnit, qtyLabel, toDisplayWidth, unitBase, useMmUnits, widthLabel } from '../../lib/units';
import { lastTestCaption, toleranceState } from '../../lib/qcTolerance';
import {
  mmInspDecide,
  mmInspGetSession,
  mmInspListSessions,
  mmInspOpenSession,
  mmInspSaveSession,
  mmInspSetSelection,
  mmQcGetScope,
  mmQcSaveTestGrid,
  type MmInspSession,
  type MmQcScopeDocument,
  type MmQcScopeSession,
  type MmV4QcResult,
  type MmV4RollRow,
} from '../../lib/mmV4Rpc';
import { inspSessionStatusLabel, inspSessionTone, rollInspectionChip } from '../../lib/inspAlloc';
import { inspBannerState, inspPastSessionLabel, toggleStagedSelection } from '../../lib/inspectionRules';

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
  const [baseline, setBaseline] = useState<{
    cells: Record<string, string>;
    results: Record<string, MmV4QcResult | ''>;
    remarks: Record<string, string>;
  }>({ cells: {}, results: {}, remarks: {} });
  const seededSignatureRef = useRef('');
  const inspSeededRef = useRef('');
  const [saving, setSaving] = useState(false);
  const [inspSession, setInspSession] = useState<MmInspSession | null>(null);
  const [inspNotRequired, setInspNotRequired] = useState(false);
  const [inspError, setInspError] = useState<string | null>(null);
  const [inspPast, setInspPast] = useState<MmInspSession[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [decide, setDecide] = useState<'accept_deviation' | 'reject' | null>(null);
  const [decideReason, setDecideReason] = useState('');
  const [needsDecision, setNeedsDecision] = useState<boolean | null>(null);

  const scopeQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'testingScope', scopeKind, id] as const,
    queryFn: async () => {
      const res = await mmQcGetScope(scopeKind, id);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });

  const scopeRolls = scopeQ.data?.rolls ?? [];

  useEffect(() => {
    if (!inspecting || !id || !factoryId) return;
    let cancel = false;
    void (async () => {
      const res = await mmInspOpenSession(scopeKind, id);
      if (cancel) return;
      if (res.ok === false) {
        if (res.code === 'NOT_REQUIRED') { setInspNotRequired(true); setInspSession(null); return; }
        setInspError(res.message); return;
      }
      setInspNotRequired(false); setInspError(null); setInspSession(res.data);
      setNeedsDecision(res.data.needs_decision ?? null);
      setSelectedIds((res.data.rolls ?? []).filter((r) => r.selected).map((r) => r.roll.roll_id));
      const past = await mmInspListSessions(scopeKind, id);
      if (!cancel && past.ok !== false) {
        const rows = Array.isArray(past.data) ? past.data : (past.data.rows ?? []);
        setInspPast(rows);
      }
    })();
    return () => { cancel = true; };
  }, [factoryId, id, inspecting, scopeKind]);

  const inspRolls = useMemo<MmV4RollRow[]>(
    () => (inspSession?.rolls ?? []).map((r) => r.roll),
    [inspSession],
  );
  const inspSteps = useMemo<number[]>(
    () => (inspSession?.steps && inspSession.steps.length > 0
      ? inspSession.steps.map(Number)
      : inspSession?.sample_pct != null ? [Number(inspSession.sample_pct)] : []),
    [inspSession],
  );
  const inspStepNo = Number(inspSession?.step_no ?? 1) || 1;
  const inspectedIds = useMemo<string[]>(
    () => (inspSession?.rolls ?? [])
      .filter((entry) => {
        const insp = entry.inspection;
        return Boolean(insp && (
          insp.inspected_length != null || insp.cuttable_width != null
          || insp.pts_1 != null || insp.pts_2 != null || insp.pts_3 != null || insp.pts_4 != null
          || insp.result
        ));
      })
      .map((entry) => entry.roll.roll_id),
    [inspSession],
  );
  const inspOpen = inspSession?.status === 'draft' || inspSession?.status === 'escalated';
  const inspBanner = inspSession ? inspBannerState(inspSession, { needsDecision }) : null;
  const lotAvgOver = inspSession?.lot_avg_points != null && inspSession?.lot_avg_max_points != null
    && Number(inspSession.lot_avg_points) > Number(inspSession.lot_avg_max_points);
  const rolls = inspecting ? inspRolls : scopeRolls;
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

  const cellKey = (rollId: string, key: string) => `${rollId}::${key}`;

  // Show the values a roll already has (its latest test) instead of a blank grid.
  // They are the baseline: opening the page is not a change, editing is.
  useEffect(() => {
    if (inspecting || !scopeQ.data) return;
    const signature = `${scopeKind}:${id}:${rolls.map((roll) => `${roll.roll_id}@${roll.last_test?.tested_at ?? ''}`).join('|')}`;
    if (seededSignatureRef.current === signature) return;
    seededSignatureRef.current = signature;
    const nextCells: Record<string, string> = {};
    const nextResults: Record<string, MmV4QcResult | ''> = {};
    const nextRemarks: Record<string, string> = {};
    for (const roll of rolls) {
      const values = roll.last_test?.field_values ?? {};
      for (const field of fields) {
        const raw = values[field.key];
        if (raw == null || raw === '') continue;
        if (typeof raw === 'boolean') {
          nextCells[cellKey(roll.roll_id, field.key)] = raw ? 'true' : 'false';
        } else if (field.key === 'width_in') {
          const shown = toDisplayWidth(Number(raw), widthUnit);
          nextCells[cellKey(roll.roll_id, field.key)] = shown == null ? String(raw) : String(shown);
        } else {
          nextCells[cellKey(roll.roll_id, field.key)] = String(raw);
        }
      }
      const result = String(roll.last_test?.result ?? '').toLowerCase();
      if (result === 'pass' || result === 'hold' || result === 'fail') nextResults[roll.roll_id] = result;
      const note = String(roll.last_test?.remarks ?? '').trim();
      if (note) nextRemarks[roll.roll_id] = note;
    }
    setCells(nextCells);
    setResults(nextResults);
    setRemarks(nextRemarks);
    setBaseline({ cells: nextCells, results: nextResults, remarks: nextRemarks });
  }, [fields, id, inspecting, rolls, scopeKind, scopeQ.data, widthUnit]);

  useEffect(() => {
    if (!inspecting || !inspSession) return;
    const signature = `${inspSession.id}:${inspSession.status}:${inspSession.inspected_count ?? ''}:${(inspSession.rolls ?? []).map((r) => `${r.roll.roll_id}:${r.selected ? 1 : 0}:${r.inspection?.result ?? ''}:${r.inspection?.inspected_length ?? ''}`).join('|')}`;
    if (inspSeededRef.current === signature) return;
    inspSeededRef.current = signature;
    const nextCells: Record<string, string> = {};
    const nextRemarks: Record<string, string> = {};
    for (const entry of inspSession.rolls ?? []) {
      const roll = entry.roll;
      const insp = entry.inspection;
      nextCells[cellKey(roll.roll_id, 'insp_status')] = !entry.selected
        ? 'Not sampled'
        : insp?.result
          ? String(insp.result)
          : rollInspectionChip(roll).label;
      if (!insp) continue;
      if (insp.inspected_length != null) nextCells[cellKey(roll.roll_id, 'length')] = String(insp.inspected_length);
      if (insp.cuttable_width != null) {
        const shown = toDisplayWidth(Number(insp.cuttable_width), widthUnit);
        nextCells[cellKey(roll.roll_id, 'width')] = shown == null ? String(insp.cuttable_width) : String(shown);
      }
      (['pts_1', 'pts_2', 'pts_3', 'pts_4'] as const).forEach((key) => {
        if (insp[key] != null) nextCells[cellKey(roll.roll_id, key)] = String(insp[key]);
      });
      if (insp.remarks) nextRemarks[roll.roll_id] = String(insp.remarks);
    }
    setCells(nextCells);
    setRemarks(nextRemarks);
    setResults({});
    setBaseline({ cells: nextCells, results: {}, remarks: nextRemarks });
    setSelectedIds((inspSession.rolls ?? []).filter((r) => r.selected).map((r) => r.roll.roll_id));
  }, [inspecting, inspSession, widthUnit]);

  const dirty = useMemo(
    () => JSON.stringify({ cells, results, remarks }) !== JSON.stringify(baseline),
    [baseline, cells, remarks, results],
  );

  const columns = useMemo<SheetColumn[]>(() => [
    ...(inspecting ? [
      { key: 'sample', label: 'Sample', editable: inspOpen, kind: 'check' as const, width: '4rem' },
      { key: 'roll', label: 'Roll', editable: false, width: '7rem' },
      { key: 'insp_status', label: 'Inspection status', editable: false, width: '9rem' },
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
  ], [fields, inspecting, inspOpen, lengthUnit, qtyUnit, widthUnit]);

  const save = async (): Promise<boolean> => {
    if (inspecting) {
      if (!inspSession) { showNotification(inspError || 'Inspection session is not open', 'error'); return false; }
      let invalid = '';
      const rows = rolls.filter((roll) => selectedIds.includes(roll.roll_id) && !inspectedIds.includes(roll.roll_id)).flatMap((roll) => {
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
        const res = await mmInspSaveSession(inspSession.id, rows);
        if (res.ok === false) throw new Error(res.message);
        let next: MmInspSession = inspSession;
        if (res.data && Array.isArray(res.data.rolls)) next = res.data;
        else {
          const got = await mmInspGetSession(inspSession.id);
          if (got.ok !== false) next = got.data;
        }
        if (next) {
          inspSeededRef.current = '';
          setInspSession(next);
          setNeedsDecision(next.needs_decision ?? (res.data?.needs_decision ?? null));
          setSelectedIds((next.rolls ?? []).filter((r) => r.selected).map((r) => r.roll.roll_id));
          const past = await mmInspListSessions(scopeKind, id);
          if (past.ok !== false) setInspPast(Array.isArray(past.data) ? past.data : (past.data.rows ?? []));
        }
        showNotification(`${rows.length} rolls inspected`, 'success');
        setBaseline({ cells, results, remarks });
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
      // Rolls whose shown values are unchanged keep their existing test.
      const changed = result !== (baseline.results[roll.roll_id] || '')
        || (remarks[roll.roll_id] ?? '').trim() !== (baseline.remarks[roll.roll_id] ?? '')
        || fields.some((field) => (cells[cellKey(roll.roll_id, field.key)] ?? '') !== (baseline.cells[cellKey(roll.roll_id, field.key)] ?? ''));
      if (!changed) return [];
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
      setCells(baseline.cells);
      setResults(baseline.results);
      setRemarks(baseline.remarks);
      setUnsaved(false);
    });
    return () => {
      setPendingSaveAction(null);
      setPendingDiscardAction(null);
    };
  }, [baseline, dirty, setPendingDiscardAction, setPendingSaveAction, setUnsaved]);

  useEffect(() => () => {
    setUnsaved(false);
    setPendingSaveAction(null);
    setPendingDiscardAction(null);
  }, [setPendingDiscardAction, setPendingSaveAction, setUnsaved]);

  const sessionSelectedIds = useMemo(
    () => (inspSession?.rolls ?? []).filter((r) => r.selected).map((r) => r.roll.roll_id),
    [inspSession],
  );
  const selectionDirty = inspecting && inspOpen
    && JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...sessionSelectedIds].sort());

  const saveSample = async () => {
    if (!inspSession) return;
    if (selectedIds.length !== Number(inspSession.sample_size ?? selectedIds.length)) {
      showNotification(`Select exactly ${inspSession.sample_size} rolls`, 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await mmInspSetSelection(inspSession.id, selectedIds);
      if (res.ok === false) throw new Error(res.message);
      if (res.data && Array.isArray(res.data.rolls)) {
        inspSeededRef.current = '';
        setInspSession(res.data);
      } else {
        const got = await mmInspGetSession(inspSession.id);
        if (got.ok !== false) { inspSeededRef.current = ''; setInspSession(got.data); }
      }
      showNotification('Sample saved', 'success');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Save sample failed', 'error');
    } finally { setSaving(false); }
  };

  const runDecide = async () => {
    if (!inspSession || !decide) return;
    if (!decideReason.trim()) { showNotification('Enter a reason', 'error'); return; }
    setSaving(true);
    try {
      const res = await mmInspDecide(inspSession.id, decide, decideReason.trim());
      if (res.ok === false) throw new Error(res.message);
      if (res.data && Array.isArray(res.data.rolls)) { inspSeededRef.current = ''; setInspSession(res.data); }
      else {
        const got = await mmInspGetSession(inspSession.id);
        if (got.ok !== false) { inspSeededRef.current = ''; setInspSession(got.data); }
      }
      setDecide(null); setDecideReason(''); setNeedsDecision(null);
      showNotification(decide === 'reject' ? 'Lot rejected' : 'Deviation accepted', 'success');
      await scopeQ.refetch();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Decision failed', 'error');
    } finally { setSaving(false); }
  };

  usePageHeader({
    title: inspecting ? 'Inspection' : 'Testing',
    subtitle: inspecting
      ? 'Enter length, width, and defect points per roll. A row without length and width is not saved.'
      : 'Enter values per roll. Cells outside tolerance turn red. Rows without a result are not saved.',
  }, [inspecting]);

  return (
    <PageShell
      loading={scopeQ.isLoading}
      error={scopeQ.error}
      onRetry={() => { void scopeQ.refetch(); }}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden w-full"
    >
      <div className="-mx-4 flex flex-col flex-1 min-h-0 px-4 gap-3">
        <Card className="shadow-sm border-slate-200 overflow-hidden shrink-0" noPadding>
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {doc?.kind_label ? `${doc.kind_label} information` : 'Receipt information'}
              </p>
              <h2 className="text-[12px] font-semibold text-slate-900 truncate">{doc?.no || '—'}</h2>
            </div>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={saving || rolls.length === 0 || !dirty} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </DesktopWriteGate>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
            {facts.length === 0 ? (
              <p className="text-[11px] text-slate-400">Receipt information is not available.</p>
            ) : facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{fact.label}</p>
                <p className="text-[11px] font-semibold text-slate-900 truncate">{fact.value}</p>
              </div>
            ))}
          </div>
        </Card>

        {inspecting ? (
          <Card className="shadow-sm border-slate-200 overflow-hidden shrink-0" noPadding>
            <div className="px-4 py-3 flex flex-wrap items-center gap-3">
              {inspNotRequired ? (
                <p className="text-[12px] text-slate-700">Inspection not required for this fabric type</p>
              ) : inspError ? (
                <p className="text-[12px] text-red-700">{inspError}</p>
              ) : inspSession ? (
                <>
                  {inspSteps.length > 0 ? (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500" aria-label="Inspection steps">
                      {inspSteps.map((pct, i) => (
                        <React.Fragment key={i}>
                          {i > 0 ? <span className="text-slate-300">→</span> : null}
                          <span className={i + 1 === inspStepNo ? 'font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5' : ''}>{pct}%</span>
                        </React.Fragment>
                      ))}
                    </span>
                  ) : null}
                  <p className="text-[12px] font-semibold text-slate-900">
                    Sample {inspSession.sample_size ?? selectedIds.length} of {inspSession.total_rolls ?? rolls.length} rolls
                  </p>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${inspSessionTone(inspSession.status) === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : inspSessionTone(inspSession.status) === 'danger' ? 'bg-red-50 text-red-700 border-red-200' : inspSessionTone(inspSession.status) === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {inspSessionStatusLabel(inspSession.status)}
                  </span>
                  <span className="text-[11px] text-slate-500">{selectedIds.length} selected · {inspSession.inspected_count ?? 0} inspected{inspSession.failed_count ? ` · ${inspSession.failed_count} failed` : ''}</span>
                  {inspSession.lot_avg_points != null || inspSession.lot_avg_max_points != null ? (
                    <span className={`text-[11px] font-semibold ${lotAvgOver ? 'text-red-700' : 'text-slate-600'}`}>
                      Lot average {inspSession.lot_avg_points != null ? Number(inspSession.lot_avg_points).toFixed(1) : '—'} / max {inspSession.lot_avg_max_points ?? '—'}
                    </span>
                  ) : null}
                  {inspSession.roll_max_points != null ? (
                    <span className="text-[11px] text-slate-500">Roll max {inspSession.roll_max_points} pts</span>
                  ) : null}
                  {selectionDirty ? (
                    <DesktopWriteGate>
                      <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void saveSample()}>Save sample</Button>
                    </DesktopWriteGate>
                  ) : null}
                  {inspBanner?.kind === 'needs_decision' ? (
                    <DesktopWriteGate>
                      <span className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => { setDecide('accept_deviation'); setDecideReason(''); }}>Accept deviation</Button>
                        <Button type="button" size="sm" variant="danger-light" onClick={() => { setDecide('reject'); setDecideReason(''); }}>Reject lot</Button>
                      </span>
                    </DesktopWriteGate>
                  ) : null}
                </>
              ) : (
                <p className="text-[12px] text-slate-400">Opening inspection session…</p>
              )}
            </div>
            {inspBanner && inspBanner.kind !== 'none' ? (
              <p className={`px-4 py-2 text-[11px] font-semibold border-t ${inspBanner.tone === 'success' ? 'text-emerald-800 bg-emerald-50 border-emerald-100' : inspBanner.tone === 'danger' ? 'text-red-800 bg-red-50 border-red-100' : inspBanner.tone === 'warning' ? 'text-amber-800 bg-amber-50 border-amber-100' : 'text-slate-700 bg-slate-50 border-slate-100'}`}>
                {inspBanner.text}
              </p>
            ) : null}
          </Card>
        ) : null}

        {inspecting && inspNotRequired ? null : (
        <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
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
            isCellLocked={(row, key) => {
              if (!inspecting) return false;
              const roll = rolls[row];
              if (!roll) return true;
              if (inspectedIds.includes(roll.roll_id)) return true;
              if (key === 'sample') return !inspOpen;
              return !selectedIds.includes(roll.roll_id);
            }}
            rowClassName={(row) => (inspecting && rolls[row] && !selectedIds.includes(rolls[row].roll_id) ? 'bg-slate-50' : undefined)}
            getValue={(row, key) => {
              const roll = rolls[row];
              if (!roll) return '';
              if (key === 'sample') return selectedIds.includes(roll.roll_id) ? 'true' : 'false';
              if (key === 'roll') return roll.roll_code;
              if (key === 'qty') return qtyOf(roll);
              if (key === 'stage') return roll.stage_label || roll.stage_code || '—';
              if (key === 'colour') return roll.color || roll.color_ref || '—';
              if (key === 'last') return lastResult(roll);
              if (key === 'result') return results[roll.roll_id] || '';
              if (key === 'remarks') return inspecting && !selectedIds.includes(roll.roll_id) ? 'Not sampled' : (remarks[roll.roll_id] || '');
              return cells[cellKey(roll.roll_id, key)] ?? '';
            }}
            onChange={(row, key, value) => {
              const roll = rolls[row];
              if (!roll) return;
              if (key === 'sample') {
                if (!inspSession || !inspOpen) return;
                const toggled = toggleStagedSelection(selectedIds, roll.roll_id, Number(inspSession.sample_size ?? selectedIds.length), inspectedIds);
                if (!toggled.ok) { showNotification(toggled.reason || 'Sample is full', 'error'); return; }
                setSelectedIds(toggled.next);
                return;
              }
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
        )}

        {inspecting ? (
          <details className="shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-slate-700">Past sessions</summary>
            {inspPast.length === 0 ? (
              <p className="px-3 pb-3 text-[11px] text-slate-400">No sessions yet.</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-1.5">Status</th>
                    <th className="px-3 py-1.5">Sample</th>
                    <th className="px-3 py-1.5">Inspected</th>
                    <th className="px-3 py-1.5">Failed</th>
                    <th className="px-3 py-1.5">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {inspPast.map((session) => (
                    <tr key={session.id} className="text-[12px] text-slate-700 border-t border-slate-100">
                      <td className="px-3 py-1.5">{inspPastSessionLabel(session)}</td>
                      <td className="px-3 py-1.5">{session.sample_size ?? '—'} of {session.total_rolls ?? '—'} ({session.sample_pct ?? '—'}%)</td>
                      <td className="px-3 py-1.5">{session.inspected_count ?? '—'}</td>
                      <td className="px-3 py-1.5">{session.failed_count ?? '—'}</td>
                      <td className="px-3 py-1.5">{session.decision_reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        ) : <details className="shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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
      <Modal isOpen={Boolean(decide)} onClose={() => setDecide(null)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">{decide === 'reject' ? 'Reject lot' : 'Accept deviation'}</h4>
          <p className="text-[11px] text-slate-500">{decide === 'reject' ? 'The whole lot is rejected.' : 'All rolls are cleared as Pass · sampled.'}</p>
          <Input label="Reason" value={decideReason} onChange={(e) => setDecideReason(e.target.value)} placeholder="Required" />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setDecide(null)}>Cancel</Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={saving || !decideReason.trim()} onClick={() => void runDecide()}>{saving ? 'Saving…' : 'Confirm'}</Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
