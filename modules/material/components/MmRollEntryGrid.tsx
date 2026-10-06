import React, { useMemo, useState } from 'react';
import { Database, Plus, Search, Trash2 } from 'lucide-react';
import { Button, SelectDropdown } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import type { MmTestField } from '../lib/mmRpc';
import {
  applyFieldValue,
  autoFillDraftRolls,
  blankDraftRoll,
  millRollWorkStatus,
  millRollWorkStatusClass,
  millRollWorkStatusLabel,
  MAX_MILL_BATCH_ROLLS,
  nextRollNo,
  parseRollCount,
  parseTestOptions,
  resizeDraftRolls,
  withLengthField,
  qtyFieldLabel,
  fieldRole,
  type MmDraftRoll,
} from '../lib/mmRollDraft';

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
}

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
}) => {
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rollFilter, setRollFilter] = useState('');
  const displayFields = useMemo(
    () => (columnSource === 'fields' ? withLengthField(fields, uom) : fields),
    [columnSource, fields, uom],
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

  const patchField = (localId: string, field: MmTestField, value: string) => {
    onChange(rows.map((row) => (row.localId === localId ? applyFieldValue(row, field, value) : row)));
  };

  const generate = () => {
    const n = parseRollCount(rollCount.trim());
    if (n == null) {
      setCountError(`Enter a whole number from 1 to ${MAX_MILL_BATCH_ROLLS}`);
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

  const colSpan =
    1 +
    (showSerialNumber ? 1 : 0) +
    (showStatus ? 1 : 0) +
    (columnSource === 'stock' ? 4 : 0) +
    displayFields.length +
    (showRemove ? 1 : 0);

  const showHeader = Boolean(title || subtitle || showRollSearch || (showAutoFill && rows.length > 0));
  const showFooter = entryMode === 'generate' || entryMode === 'add' || Boolean(footerActions) || (showAutoFill && rows.length > 0);

  return (
    <div className={framed ? 'rounded-xl border border-slate-200 overflow-hidden bg-white' : 'overflow-hidden bg-white'}>
      {showHeader && (
        <div
          className={`py-4 flex items-center justify-between gap-3 ${
            framed ? 'px-4 bg-slate-50/50 border-b border-slate-100' : 'px-6 bg-white border-b border-slate-100'
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
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onChange(autoFillDraftRolls(rows, displayFields))}
                >
                  Auto fill
                </Button>
              </DesktopWriteGate>
            ) : null}
          </div>
        </div>
      )}
      {rows.length === 0 ? (
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
                    <th className={qtyHeadCls} style={{ width: '12%' }}>{qtyFieldLabel(uom)}</th>
                    <th className={qtyHeadCls} style={{ width: '12%' }}>Weight</th>
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
                {showStatus ? (
                  <th className={thCls} style={{ width: '6.75rem' }}>Status</th>
                ) : null}
                {showRemove ? <th className={deleteHeadCls} style={{ width: '2.5rem' }} /> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const serialNo = rows.findIndex((r) => r.localId === row.localId) + 1;
                const workStatus = row.millWorkStatus ?? millRollWorkStatus(row);
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
                      <td className={qtyCellCls}>
                        <input
                          className={qtyInput}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.length_m}
                          disabled={disabled || row.locked || lockIdentity}
                          onChange={(e) => patch(row.localId, { length_m: e.target.value })}
                        />
                      </td>
                      <td className={qtyCellCls}>
                        <input
                          className={qtyInput}
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
                          field.key === 'length_m' && !row.attributes[field.key]
                            ? row.length_m
                            : (row.attributes[field.key] ?? '')
                        }
                        disabled={disabled || row.locked || (lockIdentity && fieldRole(field) !== 'attr')}
                        align={align}
                        onChange={(next) => patchField(row.localId, field, next)}
                      />
                    </td>
                  ))}
                  {showStatus ? (
                    <td className={`${tdBase} text-center`}>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${millRollWorkStatusClass(workStatus)}`}>
                        {millRollWorkStatusLabel(workStatus)}
                      </span>
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
        <p className={`text-[11px] text-slate-400 ${framed ? 'px-4' : 'px-6'} py-2`}>
          Showing {visibleRows.length} {visibleRows.length === 1 ? 'roll' : 'rolls'}
        </p>
      ) : null}
      {showFooter && entryMode === 'generate' && (
        <>
          <div className="h-8 bg-white" />
          <div className={`flex flex-wrap items-center justify-between gap-3 py-3 border-t border-slate-200 bg-slate-50 ${framed ? 'px-4' : 'px-6'}`}>
            <DesktopWriteGate>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <label htmlFor="mm-roll-count" className="text-[11px] font-medium text-slate-600">
                  How many rolls in this batch?
                </label>
                <input
                  id="mm-roll-count"
                  type="number"
                  min={1}
                  max={MAX_MILL_BATCH_ROLLS}
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
      {showFooter && entryMode === 'none' && footerActions ? (
        <div
          className={`flex flex-wrap items-center justify-end gap-2 py-3 border-t border-slate-100 bg-white ${framed ? 'px-4' : 'px-6'}`}
        >
          {footerActions}
        </div>
      ) : null}
    </div>
  );
};
