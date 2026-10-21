import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Layers } from 'lucide-react';
import { Button, Card, Input, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { tokens } from '../../../../lib/designTokens';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmRollEntryGrid } from './MmRollEntryGrid';
import type { SheetColumn } from '../../components/MmSheetGrid';
import { FabricPicker } from '../../components/FabricPicker';
import { fabricMismatchMessage, fmtUomQty } from '../../lib/fabricStock';
import { getFabric, type MmFabric, type MmFabricUom } from '../../lib/mmFabricRpc';
import {
  draftQtySum,
  draftsToRollWrites,
  growReceiptRolls,
  MAX_RECEIPT_ROLLS,
  parseRollCount,
  parseTestOptions,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import {
  mmListTestFields,
  mmRecvGetProcessChallan,
  mmRecvProcessChallans,
  mmStyleFabricPosition,
  mmWhReceive,
  type MmReceiptPurpose,
  type MmRecvProcessChallanDetail,
  type MmRecvProcessChallanRow,
  type MmSourceTestField,
  type MmStyleFabricPositionRow,
} from '../../lib/mmV4Rpc';
import { useMmPartners, useMmV4Config } from '../../lib/useMmV4Config';
import { colorMethodLabel, fabricSpecLine } from '../../lib/fabricLabels';
import { displayNumberToInches, formatStoredQty, formatStoredWidth, isStoredWidthKey, qtyLabel, qtyToStored, unitBase, useFabricUnits, widthLabel, type QtyUnit, type WidthUnit } from '../../lib/units';
import { buildProcessReturnPayload, buildReceivePayload, VENDOR_RESULT_KEY } from '../../lib/receivePayload';
import { toleranceState } from '../../lib/qcTolerance';
import {
  customReceiptFields,
  mmGetReceiptForm,
  parseReceiptForm,
  rollColumnsForReceive,
  type ReceiptForm,
  type ReceiptFormField,
} from '../../lib/receiptForm';
import type { MmTestField } from '../../lib/mmRpc';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const fieldLabelClass = 'block font-medium text-slate-700 mb-1.5';
const fieldLabelStyle = { fontSize: tokens.fontSize.body };
const cardTitleStyle = { fontSize: tokens.fontSize.h1 };
const helperStyle = { fontSize: tokens.fontSize.bodySmall };

function purposeOf(value: string): MmReceiptPurpose {
  if (value === 'style' || value === 'open_po') return value;
  return 'stock';
}

function styleLineLabel(row: MmStyleFabricPositionRow): string {
  return [
    row.style_name || 'Style',
    row.colorway_name || 'Colour',
    row.po_number ? `PO ${row.po_number}` : null,
    row.buyer_name,
  ].filter((part): part is string => Boolean(part)).join(' · ');
}

function styleLineKey(row: MmStyleFabricPositionRow): string {
  return `${row.order_id}:${row.colorway_id}:${row.colorway_material_id ?? ''}:${row.style_material_id ?? ''}`;
}

function toTestField(field: ReceiptFormField): MmTestField {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    data_type: field.data_type,
    options: field.options,
    required: field.required,
  };
}

type ReceiveSource = 'internal' | 'external' | 'process_return';

function rowsWithStoredMeasures(rows: MmDraftRoll[], qtyUnit: QtyUnit, widthUnit: WidthUnit): MmDraftRoll[] {
  return rows.map((row) => {
    let changed = false;
    const attributes = { ...row.attributes };
    for (const key of Object.keys(attributes)) {
      if (!isStoredWidthKey(key)) continue;
      const inches = displayNumberToInches(attributes[key], widthUnit);
      if (inches == null) continue;
      attributes[key] = String(inches);
      changed = true;
    }
    let next = changed ? { ...row, attributes } : row;
    const weight = unitBase(qtyUnit) === 'kg';
    const raw = weight
      ? (next.weight_kg.trim() || next.length_m.trim())
      : (next.length_m.trim() || next.weight_kg.trim());
    const typed = Number(raw);
    const stored = raw !== '' && Number.isFinite(typed) ? qtyToStored(typed, qtyUnit) : null;
    if (stored != null) {
      next = weight
        ? { ...next, weight_kg: String(stored), length_m: '' }
        : { ...next, length_m: String(stored), weight_kg: '' };
    }
    return next;
  });
}

function vendorSupplies(typeIds: string[] | null | undefined, fabricTypeId: string | null): boolean {
  const ids = typeIds ?? [];
  if (ids.length === 0) return true;
  return Boolean(fabricTypeId && ids.includes(fabricTypeId));
}

export default function MmWarehouseReceivePage() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const routeParams = useNavigationStore((s) => s.routeParams);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const { data: v4 } = useMmV4Config();

  usePageHeader({
    subtitle: 'Every roll enters the warehouse here. Internal or external, at any stage.',
  });

  const vendorsQ = useMmPartners('fabric_vendor', false);
  const inhouseQ = useMmPartners('inhouse', false);
  const vendors = vendorsQ.data ?? [];
  const stages = (v4?.stages ?? []).filter((stage) => stage.is_active !== false);
  const initialStage = [...stages].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))[0]?.code || 'GREIGE';

  const presetSource = useNavigationStore((s) => s.routeParams.source);
  const [source, setSource] = useState<ReceiveSource>(presetSource === 'internal' ? 'internal' : 'external');
  const [challanQuery, setChallanQuery] = useState('');
  const debouncedChallan = useDebouncedValue(challanQuery, 300);
  const [returnDetail, setReturnDetail] = useState<MmRecvProcessChallanDetail | null>(null);
  const [fromId, setFromId] = useState('');
  const [fabric, setFabric] = useState<MmFabric | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [challanInvoice, setChallanInvoice] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [receiptValues, setReceiptValues] = useState<Record<string, string>>({});
  const [stageCode, setStageCode] = useState(initialStage);
  const [purpose, setPurpose] = useState<MmReceiptPurpose>('stock');
  const [customer, setCustomer] = useState('');
  const [poRef, setPoRef] = useState('');
  const [lockedStyle, setLockedStyle] = useState<MmStyleFabricPositionRow | null>(null);
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rows, setRows] = useState<MmDraftRoll[]>([]);
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    if (presetSource === 'internal' || presetSource === 'external') setSource(presetSource);
  }, [presetSource]);

  const units = useFabricUnits(fabric);
  const returnUnits = useFabricUnits(returnDetail?.challan?.fabric);
  const uom: MmFabricUom = unitBase(units.qtyUnit) === 'kg' ? 'kg' : 'm';
  const measureTargets = useMemo(() => {
    if (!fabric) return { width: '', gsm: '' };
    return {
      width: formatStoredWidth(fabric.width_in, units.widthUnit),
      gsm: fabric.gsm != null ? String(fabric.gsm) : '',
    };
  }, [fabric, units.widthUnit]);
  const batchQty = draftQtySum(rows, uom);
  const vendorOptions = useMemo(() => {
    const pool = source === 'internal' ? (inhouseQ.data ?? []) : vendors;
    return pool.filter((row) => vendorSupplies(row.fabric_type_ids, fabric?.fabric_type_id ?? null));
  }, [source, inhouseQ.data, vendors, fabric?.fabric_type_id]);

  const formQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'receiptForm', fabric?.fabric_type_id ?? ''] as const,
    queryFn: async () => {
      const res = await mmGetReceiptForm(fabric?.fabric_type_id ?? null);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && fabric?.fabric_type_id) && source !== 'process_return',
  });
  const challanListQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'processReturnChallans', debouncedChallan] as const,
    queryFn: async () => {
      const res = await mmRecvProcessChallans(debouncedChallan);
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId) && source === 'process_return' && !returnDetail,
  });
  const returnForm = source === 'process_return' ? parseReceiptForm(returnDetail?.form) : null;
  const activeForm: ReceiptForm | null | undefined = returnForm ?? formQ.data;
  const receiptFields = customReceiptFields(activeForm);
  const rollFields = rollColumnsForReceive(activeForm);
  const pickedVendor = source === 'process_return'
    ? null
    : vendorOptions.find((row) => row.id === fromId) ?? null;
  const qcMode = pickedVendor?.qc_at_source && pickedVendor.qc_at_source !== 'none'
    ? pickedVendor.qc_at_source
    : 'none';
  const testTypeId = source === 'process_return'
    ? null
    : (fabric?.fabric_type_id ?? null);
  const testFieldsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'sourceTestFields', testTypeId ?? ''] as const,
    queryFn: async () => {
      const res = await mmListTestFields(testTypeId as string);
      if (res.ok === false) throw new Error(res.message);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: Boolean(factoryId && testTypeId) && qcMode !== 'none',
  });
  const sourceTestFields: MmSourceTestField[] = qcMode === 'none' ? [] : (testFieldsQ.data ?? []);
  const rollTestFields = useMemo(() => {
    const fields = rollFields.map((field) => {
      const next = toTestField(field);
      if (!isStoredWidthKey(next.key)) return next;
      const base = next.label.replace(/\s*\((in|cm|inches|inch)\)\s*$/i, '');
      return { ...next, label: `${base} (${widthLabel(units.widthUnit)})` };
    });
    if (fields.some((field) => isStoredWidthKey(field.key))) return fields;
    return [
      ...fields,
      {
        id: 'width_in',
        key: 'width_in',
        label: `Width (${widthLabel(units.widthUnit)})`,
        data_type: 'decimal',
        options: null,
        required: false,
      },
    ];
  }, [rollFields, units.widthUnit]);
  const vendorColumns = useMemo((): SheetColumn[] => {
    if (qcMode === 'none') return [];
    const columns: SheetColumn[] = sourceTestFields.map((field) => ({
      key: field.key,
      label: field.label || field.key,
      hint: field.tolerance_text?.trim() || undefined,
      editable: true,
      kind: field.data_type === 'select'
        ? 'select'
        : field.data_type === 'checkbox'
          ? 'check'
          : field.data_type === 'date'
            ? 'date'
            : field.data_type === 'number' || field.data_type === 'decimal'
              ? 'number'
              : 'text',
      options: field.data_type === 'select'
        ? [{ value: '', label: '—' }, ...parseTestOptions(field.options).map((opt) => ({ value: opt, label: opt }))]
        : undefined,
    }));
    columns.push({
      key: VENDOR_RESULT_KEY,
      label: 'Vendor result *',
      editable: true,
      kind: 'select',
      options: [
        { value: '', label: '—' },
        { value: 'pass', label: 'Pass' },
        { value: 'hold', label: 'Hold' },
        { value: 'fail', label: 'Fail' },
      ],
    });
    return columns;
  }, [qcMode, sourceTestFields]);
  const qcNote = qcMode === 'tested_inspected'
    ? "This vendor sends test reports. Rolls clear QC on the vendor's result and inspection."
    : qcMode === 'tested'
      ? "This vendor sends test reports. Rolls clear QC on the vendor's result."
      : null;

  const styleQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'styleFabrics', fabric?.id ?? 'receive'] as const,
    queryFn: async () => {
      const res = await mmStyleFabricPosition({
        fabric_id: fabric?.id ?? null,
        include_closed: false,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId) && purpose === 'style',
  });
  const styleOptions = useMemo(() => {
    const listed = styleQ.data ?? [];
    const opts = listed.map((row) => ({ value: styleLineKey(row), label: styleLineLabel(row) }));
    if (lockedStyle && !opts.some((opt) => opt.value === styleLineKey(lockedStyle))) {
      opts.unshift({ value: styleLineKey(lockedStyle), label: styleLineLabel(lockedStyle) });
    }
    return opts;
  }, [styleQ.data, lockedStyle]);

  const lockStyle = async (row: MmStyleFabricPositionRow) => {
    setLockedStyle(row);
    const fabricId = row.fabric?.id;
    if (!fabricId || fabricId === fabric?.id) return;
    const res = await getFabric(fabricId);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    setFabric(res.data);
  };

  const presetKey = [
    routeParams.purpose ?? '',
    routeParams.orderId ?? '',
    routeParams.colorwayId ?? '',
    routeParams.colorwayMaterialId ?? '',
    routeParams.styleMaterialId ?? '',
  ].join('|');
  const presetApplied = useRef('');
  useEffect(() => {
    if (routeParams.purpose !== 'style') return;
    const lineId = routeParams.colorwayMaterialId || routeParams.styleMaterialId || '';
    if (!lineId || presetApplied.current === presetKey) return;
    presetApplied.current = presetKey;
    setPurpose('style');
    void (async () => {
      const res = await mmStyleFabricPosition({
        order_id: routeParams.orderId || null,
        colorway_material_id: routeParams.colorwayMaterialId || null,
        style_material_id: routeParams.styleMaterialId || null,
        include_closed: false,
      });
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return;
      }
      const match = (res.data.rows ?? []).find((item) => (
        (routeParams.colorwayMaterialId && item.colorway_material_id === routeParams.colorwayMaterialId)
        || (routeParams.styleMaterialId && item.style_material_id === routeParams.styleMaterialId)
      )) ?? res.data.rows?.[0];
      if (match) await lockStyle(match);
    })();
    // preset once when Allocate / Book opens Receive fabric for this line
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  useEffect(() => {
    if (source === 'process_return') return;
    if (fromId && vendorOptions.some((row) => row.id === fromId)) return;
    setFromId(vendorOptions.find((row) => row.is_default)?.id ?? '');
  }, [source, fromId, vendorOptions]);

  const pickChallan = async (id: string) => {
    const res = await mmRecvGetProcessChallan(id);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    setReturnDetail({
      ...res.data,
      challan: { ...res.data.challan, id: res.data.challan.id || id },
    });
    setRows((res.data.rolls ?? []).map((roll) => ({
      localId: roll.out_line_id,
      roll_no: roll.roll_code,
      length_m: '',
      weight_kg: '',
      shade: roll.shade ?? '',
      lot_no: '',
      attributes: {
        out_line_id: roll.out_line_id,
        qty_sent: [roll.qty_sent ?? '', roll.uom ?? ''].filter((part) => part !== '').join(' '),
        color: roll.color ?? '',
        shade: roll.shade ?? '',
        dye_lot: roll.dye_lot ?? '',
      },
    })));
  };

  const generate = () => {
    if (!fabric) {
      showNotification('Select a fabric first', 'error');
      return;
    }
    const n = parseRollCount(rollCount.trim());
    if (n == null) {
      setCountError(`Enter a whole number from 1 to ${MAX_RECEIPT_ROLLS}`);
      return;
    }
    setCountError(null);
    setRows(growReceiptRolls(rows, n, rollTestFields));
  };

  const save = async () => {
    if (source === 'process_return') {
      if (!returnDetail?.challan) {
        showNotification('Pick the process challan', 'error');
        return;
      }
      const payload = buildProcessReturnPayload({
        processChallanId: String(returnDetail.challan.id ?? ''),
        challanInvoice,
        referenceNo,
        receivedOn,
        remarks,
        receiptValues,
        receiptFields,
        rollFields: [
          ...rollFields,
          ...(rollFields.some((field) => isStoredWidthKey(field.key) && field.tier !== 'core')
            ? []
            : [{ key: 'width_in', data_type: 'decimal', tier: 'custom' as const }]),
        ],
        rolls: rowsWithStoredMeasures(rows, returnUnits.qtyUnit, returnUnits.widthUnit),
      });
      setSaving(true);
      try {
        const res = await mmWhReceive(payload);
        if (res.ok === false) {
          showNotification(res.message, 'error');
          return;
        }
        const status = res.data.challan_status || 'partial';
        showNotification(
          `${res.data.roll_count} rolls back on ${returnDetail.challan.challan_no} (${status})`,
          'success',
        );
        requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIPT, { id: res.data.id });
      } finally {
        setSaving(false);
      }
      return;
    }
    if ((source === 'external' || source === 'internal') && !fromId) {
      showNotification('Select a fabric vendor', 'error');
      return;
    }
    if (qcMode !== 'none' && testFieldsQ.isLoading) {
      showNotification('Test fields are still loading', 'error');
      return;
    }
    if (!fabric) {
      showNotification('Select a fabric', 'error');
      return;
    }
    if (purpose === 'style' && !lockedStyle?.style_material_id && !lockedStyle?.colorway_material_id) {
      showNotification('Style needs a style line', 'error');
      return;
    }
    if (purpose === 'open_po' && !customer.trim()) {
      showNotification('Open PO needs a customer', 'error');
      return;
    }
    const storedRows = rowsWithStoredMeasures(rows, units.qtyUnit, units.widthUnit);
    const parsed = draftsToRollWrites(storedRows, [], uom);
    if (parsed.error) {
      showNotification(parsed.error, 'error');
      return;
    }
    const built = buildReceivePayload({
      source,
      fromId,
      challanInvoice,
      referenceNo,
      receivedOn,
      remarks,
      fabricId: fabric.id,
      stageCode: stageCode || 'GREIGE',
      uom,
      purpose,
      styleMaterialId: lockedStyle?.style_material_id ?? null,
      customerName: customer,
      poRef,
      widthForm: fabric.width_form ? String(fabric.width_form) : null,
      receiptValues,
      receiptFields,
      rollFields: [
        ...rollFields,
        ...(rollFields.some((field) => isStoredWidthKey(field.key) && field.tier !== 'core')
          ? []
          : [{ key: 'width_in', data_type: 'decimal', tier: 'custom' as const }]),
      ],
      vendorTestFields: qcMode === 'none' ? undefined : sourceTestFields.map((field) => ({
        key: field.key,
        data_type: field.data_type,
      })),
      rolls: storedRows,
    });
    const { uom: _fabricUom, ...payload } = built;
    void _fabricUom;
    setSaving(true);
    try {
      const res = await mmWhReceive(payload);
      if (res.ok === false) {
        const mismatch = fabricMismatchMessage(res);
        if (mismatch) setFormError(`Fabric mismatch — ${mismatch}`);
        else showNotification(res.message, 'error');
        return;
      }
      setFormError(null);
      const qty = payload.rolls.reduce((sum, roll) => sum + Number((uom === 'kg' ? roll.weight_kg : roll.length_m) ?? 0), 0);
      const tests = Number(res.data.qc_tests_created) || 0;
      const booked = Number(res.data.booked) || 0;
      const allocated = Number(res.data.allocated) || 0;
      const bits = [
        res.data.grn_no,
        `${res.data.roll_count} rolls`,
        formatStoredQty(qty, units.qtyUnit),
      ];
      if (booked > 0) bits.push(`${booked} booked`);
      if (allocated > 0) bits.push(`${allocated} allocated`);
      if (tests > 0) bits.push(`${tests} QC tests`);
      showNotification(bits.join(' · '), 'success');
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIPT, { id: res.data.id });
    } finally {
      setSaving(false);
    }
  };

  const receivedStage = stages.find((stage) => stage.code === (stageCode || initialStage));
  const stageNeedsColour = receivedStage?.can_cut === true && String(fabric?.color_method ?? '') !== 'greige_only';

  return (
    <PageShell skeleton="card">
      {formError ? (
        <p className="mb-3 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="font-semibold text-slate-900 flex items-center gap-2 mb-4" style={cardTitleStyle}>
              <Layers size={16} className="text-primary-600" />
              {source === 'process_return' ? 'Process challan' : 'Fabric'}
            </h4>
            {source === 'process_return' ? (
              <ProcessChallanPicker
                query={challanQuery}
                onQuery={setChallanQuery}
                rows={challanListQ.data ?? []}
                loading={challanListQ.isLoading}
                error={challanListQ.error instanceof Error ? challanListQ.error.message : null}
                detail={returnDetail}
                disabled={saving}
                onPick={(id) => { void pickChallan(id); }}
                onClear={() => { setReturnDetail(null); setRows([]); }}
              />
            ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label className={fieldLabelClass} style={fieldLabelStyle}>Fabric *</label>
              <FabricPicker
                compactSelected
                disabled={saving || Boolean(lockedStyle)}
                value={fabric?.id ?? null}
                onChange={(next: MmFabric) => {
                  setFabric(next);
                  setFormError(null);
                  setLockedStyle(null);
                }}
                onClear={() => {
                  setFabric(null);
                  setLockedStyle(null);
                }}
              />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                <SelectDropdown
                  label="Stage received"
                  value={stageCode || initialStage}
                  onChange={(code) => setStageCode(code)}
                  disabled={saving}
                  options={stages.map((stage) => ({ value: stage.code, label: stage.label || stage.code }))}
                />
                <p className="text-slate-500 mt-1 leading-snug" style={helperStyle}>
                  {stageNeedsColour
                    ? 'This stage can be cut, so each roll needs a colour.'
                    : 'Colour can wait. It is required once the stage can be cut.'}
                </p>
                </div>
                <div>
                  <p className={fieldLabelClass} style={fieldLabelStyle}>UOM</p>
                  <span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 font-medium text-slate-700" style={fieldLabelStyle}>
                    {fabric ? qtyLabel(units.qtyUnit) : '—'}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-3 flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-white border border-blue-100 flex items-center justify-center shrink-0">
                  <Layers size={16} className="text-blue-600" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold uppercase tracking-wide text-slate-400" style={helperStyle}>Selected fabric</p>
                  {fabric ? (
                    <>
                      <p className="font-semibold text-slate-900 truncate" style={fieldLabelStyle}>{fabric.name || fabric.code}</p>
                      <p className="text-slate-500 mt-0.5 leading-snug" style={helperStyle}>
                        {[fabric.code, fabricSpecLine(fabric, units.widthUnit), colorMethodLabel(fabric.color_method)].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-slate-600 mt-1" style={helperStyle}>Target width {measureTargets.width === '—' ? '—' : measureTargets.width}</p>
                      <p className="text-slate-600" style={helperStyle}>Target GSM {measureTargets.gsm || '—'}</p>
                    </>
                  ) : (
                    <p className="font-semibold text-slate-900" style={fieldLabelStyle}>Not selected</p>
                  )}
                </div>
              </div>
              {purpose === 'style' && lockedStyle ? (
                <StyleReceiptCard
                  line={lockedStyle}
                  qtyUnit={units.qtyUnit}
                  sessionQty={batchQty}
                  books={!receivedStage?.can_cut}
                />
              ) : null}
            </div>
            )}
          </div>
        </Card>

        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="font-semibold text-slate-900 flex items-center gap-2 mb-4" style={cardTitleStyle}>
              <ClipboardList size={16} className="text-primary-600" />
              Receipt
            </h4>
            <div className="flex flex-col gap-4">
              {source === 'process_return' ? null : (
              <>
              <div className={purpose === 'style' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : undefined}>
                <SelectDropdown
                  id="mm-receive-purpose"
                  label="Purpose"
                  value={purpose}
                  disabled={saving}
                  onChange={(value) => {
                    const next = purposeOf(value);
                    setPurpose(next);
                    if (next !== 'style') setLockedStyle(null);
                  }}
                  options={[
                    { value: 'stock', label: 'General PO' },
                    { value: 'style', label: 'Style' },
                    { value: 'open_po', label: 'Open PO' },
                  ]}
                />
                {purpose === 'style' ? (
                  <SelectDropdown
                    id="mm-receive-style"
                    label="Style *"
                    searchable
                    value={lockedStyle ? styleLineKey(lockedStyle) : ''}
                    disabled={saving || styleQ.isLoading}
                    placeholder={styleQ.isLoading ? 'Loading styles…' : 'Select a style'}
                    options={styleOptions}
                    onChange={(value) => {
                      const row = (styleQ.data ?? []).find((item) => styleLineKey(item) === value)
                        ?? (lockedStyle && styleLineKey(lockedStyle) === value ? lockedStyle : undefined);
                      if (row) void lockStyle(row);
                    }}
                  />
                ) : null}
              </div>
              {purpose === 'open_po' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input label="Customer *" value={customer} disabled={saving} onChange={(e) => setCustomer(e.target.value)} className="bg-white" />
                  <Input label="PO ref" value={poRef} disabled={saving} onChange={(e) => setPoRef(e.target.value)} className="bg-white" />
                </div>
              ) : null}
              </>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SelectDropdown
                  id="mm-receive-source"
                  label="Source"
                  value={source}
                  disabled={saving}
                  onChange={(value) => {
                    const next = value as ReceiveSource;
                    setSource(next);
                    if (next === 'process_return') {
                      setReturnDetail(null);
                      setRows([]);
                      return;
                    }
                    setFromId('');
                  }}
                  options={[
                    { value: 'internal', label: 'Internal' },
                    { value: 'external', label: 'External' },
                    { value: 'process_return', label: 'Process return' },
                  ]}
                />
                {source === 'process_return' ? (
                  <Input
                    label="From"
                    value={returnDetail?.challan.unit?.name || '—'}
                    disabled
                    className="bg-white"
                  />
                ) : (
                  <SelectDropdown
                    label="From *"
                    value={fromId}
                    onChange={setFromId}
                    disabled={saving || vendorsQ.isLoading || inhouseQ.isLoading}
                    placeholder="From"
                    options={vendorOptions.map((row) => ({ value: row.id, label: row.name }))}
                  />
                )}
                <Input label="Challan / Invoice" value={challanInvoice} disabled={saving} onChange={(e) => setChallanInvoice(e.target.value)} className="bg-white" />
                <Input label="Reference no" value={referenceNo} disabled={saving} onChange={(e) => setReferenceNo(e.target.value)} className="bg-white" />
                <LabeledDatePicker
                  label="Received on"
                  value={receivedOn}
                  onChange={setReceivedOn}
                  variant="pill"
                  size="default"
                  labelClassName={fieldLabelClass}
                />
                {source === 'process_return' ? null : (
                <div className="flex items-end gap-2">
                  <Input
                    label="Rolls"
                    value={rollCount}
                    disabled={saving}
                    placeholder="Count"
                    error={countError ?? undefined}
                    onChange={(e) => setRollCount(e.target.value)}
                    className="bg-white"
                  />
                  <DesktopWriteGate>
                    <Button type="button" size="sm" disabled={saving} onClick={generate}>Generate</Button>
                  </DesktopWriteGate>
                </div>
                )}
                <div className="md:col-span-2">
                  <label className={fieldLabelClass} style={fieldLabelStyle}>Remarks</label>
                  <textarea
                    rows={2}
                    value={remarks}
                    disabled={saving}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-none"
                    style={fieldLabelStyle}
                  />
                </div>
              </div>
              {receiptFields.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {receiptFields.map((field) => (
                    <ReceiptCustomField
                      key={field.id}
                      field={field}
                      value={receiptValues[field.key] ?? ''}
                      disabled={saving}
                      onChange={(value) => setReceiptValues((current) => ({ ...current, [field.key]: value }))}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
        {qcNote ? <p className="px-4 pt-3 text-[11px] text-slate-500">{qcNote}</p> : null}
        <MmRollEntryGrid
          title="Rolls"
          subtitle={source === 'process_return'
            ? (rows.length === 0 ? 'Pick a challan, then enter qty back.' : `${rows.length} ${rows.length === 1 ? 'roll' : 'rolls'} still out`)
            : (rows.length === 0 || !fabric ? 'Generate rolls, then enter quantity.' : `${batchQty.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${qtyLabel(units.qtyUnit)} · ${rows.length} ${rows.length === 1 ? 'roll' : 'rolls'}`)}
          emptyMessage={source === 'process_return'
            ? 'Select a challan first.'
            : (fabric ? 'Generate rolls to enter quantities.' : 'Select a fabric first.')}
          fields={rollTestFields}
          rows={source === 'process_return' ? rows : (fabric ? rows : [])}
          onChange={setRows}
          disabled={saving}
          framed={false}
          flush
          injectShade={false}
          nativeMeasures={[]}
          receiptForm
          receiptQtyLabel={source === 'process_return' ? 'Qty back' : `Qty (${qtyLabel(units.qtyUnit)})`}
          insertColumns={source === 'process_return' ? [{ key: 'qty_sent', label: 'Sent', editable: false }] : []}
          appendColumns={vendorColumns}
          cellTone={(row, key) => {
            const field = sourceTestFields.find((item) => item.key === key);
            if (!field) return undefined;
            return toleranceState({
              min: field.tolerance_min,
              max: field.tolerance_max,
              text: field.tolerance_text,
              target: field.tolerance_target,
            }, row.attributes[key]) === 'out' ? 'out' : undefined;
          }}
          entryMode={source === 'process_return' ? 'none' : 'add'}
          columnSource="fields"
          align="center"
          showSerialNumber
          showRemove={source !== 'process_return'}
          lockIdentity={source === 'process_return'}
          excel
          uom={source === 'process_return' ? (returnDetail?.rolls[0]?.uom === 'kg' ? 'kg' : 'm') : uom}
          footerActions={(
            <>
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIPTS)}>
                Cancel
              </Button>
              <DesktopWriteGate>
                <Button type="button" size="sm" disabled={saving || rows.length === 0} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save receipt'}
                </Button>
              </DesktopWriteGate>
            </>
          )}
        />
      </Card>
    </PageShell>
  );
}

function StyleReceiptCard({
  line,
  qtyUnit,
  sessionQty,
  books,
}: {
  line: MmStyleFabricPositionRow;
  qtyUnit: string;
  sessionQty: number;
  books: boolean;
}) {
  const lineQty = (value: number | null | undefined) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return formatStoredQty(n, qtyUnit);
  };
  const session = `${sessionQty.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${qtyLabel(qtyUnit)}`;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Style</p>
      <p className="text-[12px] font-semibold text-slate-900 truncate">{styleLineLabel(line)}</p>
      <p className="text-[11px] text-amber-950 mt-1 leading-snug">
        Required {lineQty(line.required)}
        {' · '}Allocated {lineQty(line.allocated)}
        {' · '}Booked {lineQty(line.booked?.qty)}
        {' · '}This receipt {books ? 'booked' : 'allocated'} {session}
      </p>
    </div>
  );
}

function ReceiptCustomField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ReceiptFormField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const label = field.required ? `${field.label} *` : field.label;
  return (
    <div>
      {field.data_type === 'checkbox' ? (
        <label className="flex items-center gap-2 text-slate-700 min-h-[38px]" style={fieldLabelStyle}>
          <input
            type="checkbox"
            checked={value === 'true'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
          <span>{label}</span>
        </label>
      ) : field.data_type === 'select' ? (
        <SelectDropdown
          label={label}
          value={value}
          disabled={disabled}
          onChange={onChange}
          options={[{ value: '', label: '—' }, ...field.options.map((option) => ({ value: option, label: option }))]}
        />
      ) : field.data_type === 'date' ? (
        <LabeledDatePicker
          label={label}
          value={value}
          onChange={onChange}
          variant="pill"
          size="default"
          labelClassName={fieldLabelClass}
        />
      ) : (
        <Input
          label={label}
          type={field.data_type === 'number' || field.data_type === 'decimal' ? 'number' : 'text'}
          step={field.data_type === 'decimal' ? '0.01' : undefined}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="bg-white"
        />
      )}
      {field.help ? <p className="text-[10px] text-slate-400 mt-1">{field.help}</p> : null}
    </div>
  );
}

function ProcessChallanPicker({
  query,
  onQuery,
  rows,
  loading,
  error,
  detail,
  disabled,
  onPick,
  onClear,
}: {
  query: string;
  onQuery: (value: string) => void;
  rows: MmRecvProcessChallanRow[];
  loading: boolean;
  error: string | null;
  detail: MmRecvProcessChallanDetail | null;
  disabled: boolean;
  onPick: (id: string) => void;
  onClear: () => void;
}) {
  if (detail) {
    const challan = detail.challan;
    const facts = [
      ['Challan', challan.challan_no],
      ['Unit', challan.unit?.name || '—'],
      ['Process', challan.process?.name || '—'],
      ['Fabric', challan.fabric?.code || challan.fabric?.name || '—'],
      ['Target colour', challan.target_color || '—'],
      ['Rolls out', String(detail.rolls.length)],
    ];
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <p className="text-[12px] font-semibold text-slate-800 truncate">{value}</p>
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onClear}>
          Pick another challan
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Search"
        value={query}
        disabled={disabled}
        placeholder="Challan no, unit or ref no"
        onChange={(e) => onQuery(e.target.value)}
      />
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      {loading ? <p className="text-[11px] text-slate-400">Loading…</p> : null}
      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {rows.length === 0 && !loading ? (
          <p className="text-[11px] text-slate-400">No open challans.</p>
        ) : rows.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(row.id)}
            className="text-left px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <span className="block text-[12px] font-semibold text-slate-800">{row.challan_no}</span>
            <span className="block text-[10px] text-slate-500 truncate">
              {[row.unit?.name, row.process, row.fabric?.code, `${row.rolls_out ?? 0} out`].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
