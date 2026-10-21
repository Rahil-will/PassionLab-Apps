import React, { useMemo, useRef, useState } from 'react';
import { Database, Plus, Search, Trash2 } from 'lucide-react';
import { Button, SelectDropdown } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { MmSheetGrid, type SheetColumn } from '../../components/MmSheetGrid';
import { fillReceiptColumn } from '../../lib/receivePayload';
import type { MmTestField } from '../../lib/mmRpc';
import {
  applyFieldValue,
  applyMeasureQc,
  autoFillDraftRolls,
  blankDraftRoll,
  DEFAULT_MEASURE_TOLERANCE,
  LOT_TYPE_OPTIONS,
  rollWorkStatus,
  rollWorkStatusLabel,
  MAX_RECEIPT_ROLLS,
  nextRollNo,
  parseRollCount,
  parseTestOptions,
  QC_DISPOSITIONS,
  resizeDraftRolls,
  rollOutOfSpec,
  withLengthField,
  qtyFieldLabel,
  fieldRole,
  isKgUom,
  type MmDraftRoll,
  type MmMeasureSpec,
} from '../../lib/mmRollDraft';
import { MmStatusDot } from '../../components/MmStatusDot';

interface MmRollEntryGridProps {
  title?: string;
  subtitle?: string;
  fields: MmTestField[];
  rows: MmDraftRoll[];
  onChange: (rows: MmDraftRoll[]) => void;
  disabled?: boolean;
  emptyMessage?: string;
  framed?: boolean;
  entryMode?: 'add' | 'generate' | 'none';
  footerActions?: React.ReactNode;
  showAutoFill?: boolean;
  columnSource?: 'stock' | 'fields';
  align?: 'start' | 'center';
  uom?: string | null;
  showRemove?: boolean;
  showSerialNumber?: boolean;
  showStatus?: boolean;
  showRollSearch?: boolean;
  headerVariant?: 'default' | 'inbound';
  showRollCountLabel?: boolean;
  lockIdentity?: boolean;
  showShade?: boolean;
  allowShadeEdit?: boolean;
  excel?: boolean;
  /** Drop the inset around the grid so the table meets the card edges. */
  flush?: boolean;
  /** When false, a shade column is shown only if the fabric's test list includes shade. */
  injectShade?: boolean;
  /** Fixed roll measures: target, ±% tolerance, actual. Not test-requirement columns. */
  nativeMeasures?: MmMeasureSpec[];
  /** `target` shows the fabric target only. Actuals stay off the receive grid. */
  measureColumns?: 'all' | 'target';
  showLotType?: boolean;
  showQcStatus?: boolean;
  /** Extra cells on the same row. Omitted callers keep the current columns. */
  extraColumns?: MmRollExtraColumn[];
  extraValues?: Record<string, Record<string, string>>;
  onExtraChange?: (localId: string, key: string, value: string) => void;
  /** Keys that stay editable on a saved roll. */
  unlockExtraKeys?: string[];
  /** Stock-mode headers. Defaults stay "Qty" and "Weight". */
  lengthHeader?: string;
  weightHeader?: string;
  /** Which stock measure stays the blue required column. Default: both blue, as before. */
  emphasizeMeasure?: 'length' | 'weight';
  /** Receive fabric: form columns, column auto fill, and no measure role on custom fields. */
  receiptForm?: boolean;
  gridHint?: string;
  /** Read-only columns after Roll no. Process returns use this for Sent. */
  insertColumns?: SheetColumn[];
  /** Columns after the form fields. Vendor test parameters and Vendor result. */
  appendColumns?: SheetColumn[];
  /** Replaces the receipt Qty header. Process returns use Qty back. */
  receiptQtyLabel?: string;
  cellTone?: (row: MmDraftRoll, key: string) => string | undefined;
}

export type MmRollExtraColumn = {
  key: string;
  label: string;
  width?: string;
  input?: 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
};

const thBase =
  'px-3 py-2 text-[10px] font-semibold uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap';
const tdBase = 'border-b border-slate-100 p-0';

function FieldInput({
  field,
  value,
  disabled,
  align,
  onChange,
}: {
  field: MmTestField;
  value: string;
  disabled?: boolean;
  align: 'start' | 'center';
  onChange: (next: string) => void;
}) {
  const options = parseTestOptions(field.options);
  const inputClass =
    `w-full h-8 px-2 text-[11px] bg-transparent border-0 outline-none font-medium text-slate-700 placeholder:text-slate-300 focus:bg-blue-50/60 ${
      align === 'center' ? 'text-center' : ''
    }`;
  if (field.data_type === 'select') {
    return (
      <SelectDropdown
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: '—' },
          ...options.map((opt) => ({ value: opt, label: opt })),
        ]}
        placeholder="—"
        size="compact"
        shape="none"
        variant="cell"
        align={align}
        disabled={disabled}
        className="w-full"
      />
    );
  }
  return (
    <input
      className={inputClass}
      type={field.data_type === 'number' || field.data_type === 'decimal' ? 'number' : 'text'}
      step={field.data_type === 'decimal' ? '0.01' : undefined}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export const MmRollEntryGrid: React.FC<MmRollEntryGridProps> = ({
  title,
  subtitle,
  fields,
  rows,
  onChange,
  disabled = false,
  emptyMessage = 'Add rolls.',
  framed = true,
  entryMode = 'add',
  footerActions,
  showAutoFill = false,
  columnSource = 'stock',
  align = 'start',
  uom,
  showRemove = true,
  showSerialNumber = false,
  showStatus = false,
  showRollSearch = false,
  headerVariant = 'default',
  showRollCountLabel = false,
  lockIdentity = false,
  showShade = false,
  allowShadeEdit = false,
  excel = false,
  flush = false,
  injectShade = true,
  nativeMeasures = [],
  measureColumns = 'all',
  showLotType = false,
  showQcStatus = false,
  extraColumns = [],
  extraValues,
  onExtraChange,
  unlockExtraKeys,
  lengthHeader,
  weightHeader,
  emphasizeMeasure,
  receiptForm = false,
  gridHint,
  insertColumns = [],
  appendColumns = [],
  receiptQtyLabel,
  cellTone,
}) => {
  const [fillKey, setFillKey] = useState('');
  const [fillValue, setFillValue] = useState('');
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rollFilter, setRollFilter] = useState('');
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const displayFields = useMemo(
    () => (columnSource === 'fields' ? withLengthField(fields, uom, { injectShade }) : fields),
    [columnSource, fields, injectShade, uom],
  );
  const center = align === 'center';
  const thCls = `${thBase} text-slate-500 ${center ? 'text-center' : 'text-left'}`;
  const qtyHeadCls = `${thBase} text-blue-700 bg-blue-50 text-center`;
  const qtyCellCls = 'border-b border-slate-100 p-0 bg-blue-50 text-center';
  const deleteHeadCls = 'px-2 py-2 border-b border-slate-200 bg-slate-50';
  const deleteCellCls = 'border-b border-slate-100 p-0 bg-white text-center';
  const stockInput =
    `w-full h-8 px-2 text-[11px] bg-transparent border-0 outline-none font-medium text-slate-700 placeholder:text-slate-300 focus:bg-blue-50/60 ${
      center ? 'text-center' : ''
    }`;
  const qtyInput =
    'w-full h-8 px-2 text-[11px] bg-transparent border-0 outline-none font-semibold text-blue-800 tabular-nums text-center placeholder:text-blue-300 focus:bg-blue-100/70';

  const patch = (localId: string, next: Partial<MmDraftRoll>) => {
    onChange(rows.map((row) => (row.localId === localId ? { ...row, ...next } : row)));
  };

  const writeField = (row: MmDraftRoll, field: MmTestField, value: string): MmDraftRoll => {
    if (receiptForm && fieldRole(field) !== 'length') {
      const attributes = { ...row.attributes, [field.key]: value };
      if (field.key === 'shade' || fieldRole(field) === 'shade') return { ...row, shade: value, attributes };
      return { ...row, attributes };
    }
    return applyFieldValue(row, field, value, uom);
  };

  const patchField = (localId: string, field: MmTestField, value: string) => {
    onChange(rows.map((row) => (row.localId === localId ? writeField(row, field, value) : row)));
  };

  const generate = () => {
    const n = parseRollCount(rollCount.trim());
    if (n == null) {
      setCountError(`Enter a whole number from 1 to ${MAX_RECEIPT_ROLLS}`);
      return;
    }
    setCountError(null);
    onChange(resizeDraftRolls(rows, n, displayFields));
  };

  const visibleRows = useMemo(() => {
    const q = rollFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.roll_no.toLowerCase().includes(q));
  }, [rows, rollFilter]);

  const useSheet = excel && columnSource === 'fields';
  const sheetColumns = useMemo((): SheetColumn[] => {
    if (!useSheet) return [];
    const cols: SheetColumn[] = [];
    if (showSerialNumber) cols.push({ key: 'sno', label: 'S.No', width: flush ? undefined : '3.25rem' });
    cols.push({
      key: 'roll',
      label: receiptForm ? 'Roll no' : 'Roll no.',
      width: flush ? undefined : '6.5rem',
      editable: !disabled && !lockIdentity,
    });
    insertColumns.forEach((column) => cols.push(column));
    if (showShade) {
      cols.push({
        key: 'shade',
        label: 'Shade',
        width: flush ? undefined : '6rem',
        editable: !disabled && (allowShadeEdit || !lockIdentity),
      });
    }
    const pushField = (field: MmTestField) => {
      if (showShade && fieldRole(field) === 'shade') return;
      const role = fieldRole(field);
      const options = parseTestOptions(field.options);
      const kind: SheetColumn['kind'] = field.data_type === 'select'
        ? 'select'
        : field.data_type === 'checkbox'
          ? 'check'
          : field.data_type === 'date'
            ? 'date'
            : field.data_type === 'number' || field.data_type === 'decimal'
              ? 'number'
              : 'text';
      const qtyLabel = role === 'length' && receiptForm
        ? (receiptQtyLabel ?? `Qty (${isKgUom(uom) ? 'kg' : 'm'})`)
        : field.label;
      cols.push({
        key: field.key,
        label: `${qtyLabel}${field.required || (receiptForm && role === 'length') ? ' *' : ''}`,
        editable: !disabled && !(lockIdentity && role !== 'attr' && role !== 'length'),
        width: flush ? undefined : (role === 'length' ? '6rem' : '7rem'),
        kind,
        options: field.data_type === 'select'
          ? [{ value: '', label: '—' }, ...options.map((opt) => ({ value: opt, label: opt }))]
          : undefined,
        headerClassName: role === 'length' ? 'text-blue-700 bg-blue-50' : undefined,
        cellClassName: role === 'length' ? 'bg-blue-50/40' : undefined,
      });
    };
    const lengthFields = displayFields.filter((field) => fieldRole(field) === 'length');
    const otherFields = displayFields.filter((field) => fieldRole(field) !== 'length');
    lengthFields.forEach(pushField);
    if (showLotType) {
      cols.push({
        key: 'lot_type',
        label: 'Lot type',
        editable: !disabled,
        kind: 'select',
        options: [{ value: '', label: '—' }, ...LOT_TYPE_OPTIONS.map((lot) => ({ value: lot, label: lot }))],
      });
    }
    for (const measure of nativeMeasures) {
      cols.push({ key: measure.targetKey, label: `Target ${measure.label}`, editable: false });
      if (measureColumns === 'target') continue;
      cols.push({ key: measure.tolKey, label: `${measure.label} ±%`, editable: !disabled });
      cols.push({
        key: measure.actualKey,
        label: `Actual ${measure.label}`,
        editable: !disabled,
        headerClassName: 'text-blue-700 bg-blue-50',
      });
    }
    otherFields.forEach(pushField);
    appendColumns.forEach((column) => cols.push(column));
    if (showQcStatus) {
      cols.push({
        key: 'qc_status',
        label: 'QC',
        editable: !disabled,
        kind: 'select',
        options: QC_DISPOSITIONS.map((item) => ({ value: item.value, label: item.label })),
      });
    }
    if (showStatus) cols.push({ key: 'status', label: 'Status', kind: 'status', width: flush ? undefined : '7.5rem' });
    return cols;
  }, [allowShadeEdit, appendColumns, disabled, displayFields, flush, insertColumns, lockIdentity, measureColumns, nativeMeasures, receiptForm, receiptQtyLabel, showLotType, showQcStatus, showSerialNumber, showShade, showStatus, uom, useSheet]);

  const sheetValue = (rowIndex: number, key: string): string => {
    const row = visibleRows[rowIndex];
    if (!row) return '';
    if (key === 'sno') return String(rows.findIndex((item) => item.localId === row.localId) + 1);
    if (key === 'roll') return row.roll_no;
    if (insertColumns.some((column) => column.key === key) || appendColumns.some((column) => column.key === key)) {
      return row.attributes[key] ?? '';
    }
    if (key === 'shade') return row.shade;
    if (key === 'lot_type') return row.lot_no;
    if (key === 'qc_status') return row.attributes.qc_status || 'pass';
    if (nativeMeasures.some((measure) => measure.targetKey === key || measure.tolKey === key || measure.actualKey === key)) {
      if (nativeMeasures.some((measure) => measure.tolKey === key) && !(row.attributes[key] ?? '').trim()) {
        return DEFAULT_MEASURE_TOLERANCE;
      }
      return row.attributes[key] ?? '';
    }
    if (key === 'status') return rollWorkStatusLabel(row.rollWorkStatus ?? rollWorkStatus(row));
    const field = displayFields.find((item) => item.key === key);
    if (!field) return '';
    if (field.key === 'length_m' && !(row.attributes[field.key] ?? '').trim()) {
      return isKgUom(uom) ? (row.weight_kg.trim() || row.length_m) : (row.length_m.trim() || row.weight_kg);
    }
    return row.attributes[field.key] ?? '';
  };

  const sheetChange = (rowIndex: number, key: string, value: string) => {
    const current = rowsRef.current;
    const row = visibleRows[rowIndex];
    if (!row) return;
    let next = current;
    if (key === 'roll') {
      next = current.map((item) => (item.localId === row.localId ? { ...item, roll_no: value } : item));
    } else if (insertColumns.some((column) => column.key === key) || appendColumns.some((column) => column.key === key)) {
      next = current.map((item) => (
        item.localId === row.localId
          ? { ...item, attributes: { ...item.attributes, [key]: value } }
          : item
      ));
    } else if (key === 'shade') {
      next = current.map((item) => (item.localId === row.localId ? { ...item, shade: value } : item));
    } else if (key === 'lot_type') {
      next = current.map((item) => (item.localId === row.localId ? { ...item, lot_no: value } : item));
    } else if (key === 'qc_status') {
      next = current.map((item) => (
        item.localId === row.localId
          ? { ...item, attributes: { ...item.attributes, qc_status: value } }
          : item
      ));
    } else if (nativeMeasures.some((measure) => measure.targetKey === key || measure.tolKey === key || measure.actualKey === key)) {
      next = current.map((item) => {
        if (item.localId !== row.localId) return item;
        const attributes = { ...item.attributes, [key]: value };
        return applyMeasureQc({ ...item, attributes }, nativeMeasures);
      });
    } else {
      const field = displayFields.find((item) => item.key === key);
      if (!field) return;
      next = current.map((item) => (item.localId === row.localId ? writeField(item, field, value) : item));
    }
    rowsRef.current = next;
    onChange(next);
  };

  const colSpan =
    1 +
    (showSerialNumber ? 1 : 0) +
    (showStatus ? 1 : 0) +
    (columnSource === 'stock' ? 4 : 0) +
    displayFields.length +
    extraColumns.length +
    (showRemove ? 1 : 0);
  const lengthLabel = lengthHeader ?? qtyFieldLabel(uom);
  const weightLabel = weightHeader ?? 'Weight';
  const lengthHeadCls = emphasizeMeasure === 'weight' ? thCls : qtyHeadCls;
  const weightHeadCls = emphasizeMeasure === 'length' ? thCls : qtyHeadCls;
  const lengthCellCls = emphasizeMeasure === 'weight' ? tdBase : qtyCellCls;
  const weightCellCls = emphasizeMeasure === 'length' ? tdBase : qtyCellCls;

  const showHeader = Boolean(title || subtitle || showRollSearch || (showAutoFill && rows.length > 0));
  const showFooter = entryMode === 'generate' || entryMode === 'add' || Boolean(footerActions) || (showAutoFill && rows.length > 0);

  return (
    <div className={framed ? 'rounded-xl border border-slate-200 overflow-hidden bg-white' : 'overflow-hidden bg-white'}>
      {showHeader && (
        <div
          className={`py-4 flex items-center justify-between gap-3 ${
            flush ? 'px-4 bg-white border-b border-slate-100' : framed ? 'px-4 bg-slate-50/50 border-b border-slate-100' : 'px-6 bg-white border-b border-slate-100'
          }`}
        >
          <div className="min-w-0 flex items-start gap-2.5">
            {headerVariant === 'inbound' ? (
              <span className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                <Database size={18} className="text-blue-600" />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? (
                <h4
                  className={
                    headerVariant === 'inbound'
                      ? 'text-sm font-bold text-slate-900'
                      : 'text-[11px] font-semibold text-slate-800'
                  }
                >
                  {title}
                </h4>
              ) : null}
              {subtitle ? (
                <p className={`text-slate-400 mt-0.5 ${headerVariant === 'inbound' ? 'text-xs' : 'text-[10px]'}`}>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showRollSearch ? (
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  className="text-[11px] pl-8 pr-3 py-1.5 w-40 border border-slate-200 rounded-lg bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-100"
                  placeholder="Search roll no…"
                  value={rollFilter}
                  onChange={(e) => setRollFilter(e.target.value)}
                />
              </div>
            ) : null}
            {showAutoFill && rows.length > 0 ? (
              receiptForm ? (
                <DesktopWriteGate>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-500">Auto fill</span>
                    <SelectDropdown
                      value={(sheetColumns.find((col) => col.editable && col.key === fillKey) ?? sheetColumns.find((col) => col.editable))?.key ?? ''}
                      onChange={(value) => {
                        setFillKey(value);
                        setFillValue('');
                      }}
                      disabled={disabled}
                      size="compact"
                      shape="pill"
                      options={sheetColumns.filter((col) => col.editable).map((col) => ({
                        value: col.key,
                        label: col.label.replace(' *', ''),
                      }))}
                    />
                    {(() => {
                      const column = sheetColumns.find((col) => col.key === fillKey) ?? sheetColumns.find((col) => col.editable);
                      if (!column) return null;
                      if (column.kind === 'select' || column.kind === 'check') {
                        const options = column.kind === 'check'
                          ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
                          : (column.options ?? []).filter((opt) => opt.value);
                        return (
                          <SelectDropdown
                            value={fillValue}
                            onChange={setFillValue}
                            disabled={disabled}
                            size="compact"
                            shape="pill"
                            placeholder="Value"
                            options={options}
                          />
                        );
                      }
                      return (
                        <input
                          className="h-8 w-28 px-2 text-[11px] border border-slate-200 rounded-lg bg-white"
                          type={column.kind === 'date' ? 'date' : column.kind === 'number' ? 'number' : 'text'}
                          step={column.kind === 'number' ? '0.01' : undefined}
                          value={fillValue}
                          disabled={disabled}
                          placeholder="Value"
                          aria-label="Auto fill value"
                          onChange={(e) => setFillValue(e.target.value)}
                        />
                      );
                    })()}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || !fillValue.trim()}
                      onClick={() => {
                        const key = fillKey || sheetColumns.find((col) => col.editable)?.key || '';
                        if (!key) return;
                        onChange(fillReceiptColumn(rows, key, fillValue, 'all', uom));
                      }}
                    >
                      Fill all rows
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || !fillValue.trim()}
                      onClick={() => {
                        const key = fillKey || sheetColumns.find((col) => col.editable)?.key || '';
                        if (!key) return;
                        onChange(fillReceiptColumn(rows, key, fillValue, 'empty', uom));
                      }}
                    >
                      Fill empty only
                    </Button>
                  </div>
                </DesktopWriteGate>
              ) : (
                <DesktopWriteGate>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => onChange(autoFillDraftRolls(rows, displayFields, {
                      measures: measureColumns === 'target' ? [] : nativeMeasures,
                      fillLotType: showLotType,
                    }))}
                  >
                    Auto fill
                  </Button>
                </DesktopWriteGate>
              )
            ) : null}
          </div>
        </div>
      )}
      {useSheet ? (
        <div className={framed || flush ? '' : 'px-1 pb-1'}>
          <MmSheetGrid
            columns={sheetColumns}
            rowCount={visibleRows.length}
            getValue={sheetValue}
            onChange={sheetChange}
            isRowLocked={(index) => Boolean(visibleRows[index]?.locked)}
            emptyText={emptyMessage}
            fit={flush}
            rowClassName={(index) => (
              nativeMeasures.length > 0 && visibleRows[index] && rollOutOfSpec(visibleRows[index], nativeMeasures)
                ? 'bg-red-50'
                : undefined
            )}
            cellTone={cellTone ? (index, key) => {
              const row = visibleRows[index];
              return row ? cellTone(row, key) : undefined;
            } : undefined}
            rowAction={showRemove ? (index) => {
              const row = visibleRows[index];
              if (!row) return null;
              return (
                <DesktopWriteGate>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-full h-8 text-slate-400 hover:text-red-600 disabled:opacity-40"
                    disabled={disabled || Boolean(row.locked || row.id)}
                    onClick={() => onChange(rows.filter((item) => item.localId !== row.localId))}
                    aria-label="Remove roll"
                  >
                    <Trash2 size={13} />
                  </button>
                </DesktopWriteGate>
              );
            } : undefined}
          />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-slate-400 italic py-8 text-center">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] table-fixed border-collapse">
            <thead>
              <tr>
                {showSerialNumber ? (
                  <th className={`${thBase} text-slate-500 text-left pl-4 pr-2.5`} style={{ width: '3.25rem' }}>S.No</th>
                ) : null}
                <th className={thCls} style={{ width: '5.5rem' }}>Roll no.</th>
                {columnSource === 'stock' && (
                  <>
                    <th className={lengthHeadCls} style={{ width: '12%' }}>
                      {lengthLabel}{emphasizeMeasure === 'length' ? ' *' : ''}
                    </th>
                    <th className={weightHeadCls} style={{ width: '12%' }}>
                      {weightLabel}{emphasizeMeasure === 'weight' ? ' *' : ''}
                    </th>
                    <th className={thCls} style={{ width: '12%' }}>Shade</th>
                    <th className={thCls} style={{ width: '12%' }}>Lot</th>
                  </>
                )}
                {columnSource !== 'stock' && showShade ? (
                  <th className={thCls} style={{ width: '7rem' }}>Shade</th>
                ) : null}
                {displayFields.map((field) => (
                  <th key={field.id} className={thCls}>{field.label}</th>
                ))}
                {extraColumns.map((col) => (
                  <th key={col.key} className={thCls} style={col.width ? { width: col.width } : undefined}>{col.label}</th>
                ))}
                {showStatus ? (
                  <th className={`${thBase} text-slate-500 text-center`} style={{ width: '6.75rem' }}>Status</th>
                ) : null}
                {showRemove ? <th className={deleteHeadCls} style={{ width: '2.5rem' }} /> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const serialNo = rows.findIndex((r) => r.localId === row.localId) + 1;
                const workStatus = row.rollWorkStatus ?? rollWorkStatus(row);
                return (
                <tr
                  key={row.localId}
                  className={
                    row.locked
                      ? 'bg-slate-50/80'
                      : workStatus === 'new'
                        ? 'bg-blue-50/50'
                        : ''
                  }
                >
                  {showSerialNumber ? (
                    <td className={`${tdBase} text-left pl-4 pr-2.5 text-slate-500 tabular-nums font-semibold text-[11px]`}>
                      {serialNo}
                    </td>
                  ) : null}
                  <td className={tdBase}>
                    <input
                      className={`${stockInput} font-semibold`}
                      value={row.roll_no}
                      disabled={disabled || row.locked || lockIdentity}
                      onChange={(e) => patch(row.localId, { roll_no: e.target.value })}
                      aria-label="Roll number"
                    />
                  </td>
                  {columnSource === 'stock' && (
                    <>
                      <td className={lengthCellCls}>
                        <input
                          className={emphasizeMeasure === 'weight' ? stockInput : qtyInput}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.length_m}
                          disabled={disabled || row.locked || lockIdentity}
                          onChange={(e) => patch(row.localId, { length_m: e.target.value })}
                        />
                      </td>
                      <td className={weightCellCls}>
                        <input
                          className={emphasizeMeasure === 'length' ? stockInput : qtyInput}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.weight_kg}
                          disabled={disabled || row.locked || lockIdentity}
                          onChange={(e) => patch(row.localId, { weight_kg: e.target.value })}
                        />
                      </td>
                      <td className={tdBase}>
                        <input
                          className={stockInput}
                          value={row.shade}
                          disabled={disabled || row.locked || (lockIdentity && !allowShadeEdit)}
                          onChange={(e) => patch(row.localId, { shade: e.target.value })}
                        />
                      </td>
                      <td className={tdBase}>
                        <input
                          className={stockInput}
                          value={row.lot_no}
                          disabled={disabled || row.locked || lockIdentity}
                          onChange={(e) => patch(row.localId, { lot_no: e.target.value })}
                        />
                      </td>
                    </>
                  )}
                  {columnSource !== 'stock' && showShade ? (
                    <td className={tdBase}>
                      <input
                        className={stockInput}
                        value={row.shade}
                        disabled={disabled || row.locked || (lockIdentity && !allowShadeEdit)}
                        onChange={(e) => patch(row.localId, { shade: e.target.value })}
                        aria-label="Shade"
                      />
                    </td>
                  ) : null}
                  {displayFields.map((field) => (
                    <td key={field.id} className={tdBase}>
                      <FieldInput
                        field={field}
                        value={
                          field.key === 'length_m' && !(row.attributes[field.key] ?? '').trim()
                            ? (isKgUom(uom) ? (row.weight_kg.trim() || row.length_m) : (row.length_m.trim() || row.weight_kg))
                            : (row.attributes[field.key] ?? '')
                        }
                        disabled={disabled || row.locked || (lockIdentity && fieldRole(field) !== 'attr')}
                        align={align}
                        onChange={(next) => patchField(row.localId, field, next)}
                      />
                    </td>
                  ))}
                  {extraColumns.map((col) => {
                    const value = extraValues?.[row.localId]?.[col.key] ?? '';
                    const locked = disabled || (row.locked && !unlockExtraKeys?.includes(col.key));
                    return (
                      <td key={col.key} className={tdBase}>
                        {col.input === 'select' ? (
                          <SelectDropdown
                            value={value}
                            onChange={(next) => onExtraChange?.(row.localId, col.key, next)}
                            options={col.options ?? []}
                            placeholder="—"
                            size="compact"
                            shape="none"
                            variant="cell"
                            disabled={locked || !onExtraChange}
                            className="w-full"
                          />
                        ) : (
                          <input
                            className={stockInput}
                            type={col.input === 'number' ? 'number' : 'text'}
                            step={col.input === 'number' ? '0.01' : undefined}
                            value={value}
                            placeholder={col.placeholder}
                            disabled={locked || !onExtraChange}
                            onChange={(e) => onExtraChange?.(row.localId, col.key, e.target.value)}
                          />
                        )}
                      </td>
                    );
                  })}
                  {showStatus ? (
                    <td className={`${tdBase} text-center`}>
                      <MmStatusDot label={rollWorkStatusLabel(workStatus)} />
                    </td>
                  ) : null}
                  {showRemove ? (
                    <td className={deleteCellCls}>
                      <DesktopWriteGate>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-full h-8 text-slate-400 hover:text-red-600 disabled:opacity-40"
                          disabled={disabled || Boolean(row.locked || row.id)}
                          onClick={() => onChange(rows.filter((r) => r.localId !== row.localId))}
                          aria-label="Remove roll"
                        >
                          <Trash2 size={13} />
                        </button>
                      </DesktopWriteGate>
                    </td>
                  ) : null}
                </tr>
                );
              })}
              <tr aria-hidden>
                <td colSpan={colSpan} className="h-10 border-0 p-0 bg-white" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {showRollCountLabel && rows.length > 0 ? (
        <p className={`text-[11px] text-slate-400 ${flush || framed ? 'px-4' : 'px-6'} py-2`}>
          Showing {visibleRows.length} {visibleRows.length === 1 ? 'roll' : 'rolls'}
        </p>
      ) : null}
      {gridHint ? (
        <p className={`text-[11px] text-slate-400 ${flush || framed ? 'px-4' : 'px-6'} py-2`}>{gridHint}</p>
      ) : null}
      {showFooter && entryMode === 'generate' && (
        <>
          <div className="h-8 bg-white" />
          <div className={`flex flex-wrap items-center justify-between gap-3 py-3 border-t border-slate-200 bg-slate-50 ${flush || framed ? 'px-4' : 'px-6'}`}>
            <DesktopWriteGate>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <label htmlFor="mm-roll-count" className="text-[11px] font-medium text-slate-600">
                  How many rolls in this batch?
                </label>
                <input
                  id="mm-roll-count"
                  type="number"
                  min={1}
                  max={MAX_RECEIPT_ROLLS}
                  inputMode="numeric"
                  value={rollCount}
                  disabled={disabled}
                  placeholder="e.g. 12"
                  onChange={(e) => {
                    setRollCount(e.target.value);
                    if (countError) setCountError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      generate();
                    }
                  }}
                  className="w-20 h-8 px-2 text-[11px] font-medium tabular-nums text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                />
                <Button type="button" size="sm" disabled={disabled} onClick={generate}>
                  Generate
                </Button>
                {countError && <p className="text-[10px] text-red-600 w-full sm:w-auto">{countError}</p>}
              </div>
            </DesktopWriteGate>
            {footerActions ? <div className="flex items-center gap-2 shrink-0 ml-auto">{footerActions}</div> : null}
          </div>
        </>
      )}
      {showFooter && entryMode === 'add' && (
        <DesktopWriteGate>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([...rows, blankDraftRoll(displayFields, nextRollNo(rows))])}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-40"
          >
            <Plus size={13} />
            Add roll
          </button>
        </DesktopWriteGate>
      )}
      {showFooter && entryMode === 'add' && footerActions ? (
        <div
          className={`flex flex-wrap items-center justify-end gap-2 py-3 border-t border-slate-100 bg-white ${flush || framed ? 'px-4' : 'px-6'}`}
        >
          {footerActions}
        </div>
      ) : null}
      {showFooter && entryMode === 'none' && footerActions ? (
        <div
          className={`flex flex-wrap items-center justify-end gap-2 py-3 border-t border-slate-100 bg-white ${flush || framed ? 'px-4' : 'px-6'}`}
        >
          {footerActions}
        </div>
      ) : null}
    </div>
  );
};
