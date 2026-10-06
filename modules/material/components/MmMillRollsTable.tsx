import React from 'react';
import type { MmMillLineRoll, MmTestField } from '../lib/mmRpc';
import {
  millChallanStatusClass,
  millChallanStatusLabel,
  millRollFieldText,
  millRollWorkStatus,
  millRollWorkStatusClass,
  millRollWorkStatusLabel,
  withLengthField,
} from '../lib/mmRollDraft';

const thFirstCls =
  'pl-4 pr-2.5 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-left';
const thCls =
  'px-2.5 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-center';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-left';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';

interface MmMillRollsTableProps {
  rolls: MmMillLineRoll[];
  fields: MmTestField[];
  uom?: string | null;
  selectable?: boolean;
  selected?: Record<string, boolean>;
  onToggle?: (rollId: string, on: boolean) => void;
  onToggleAll?: (on: boolean) => void;
  emptyText?: string;
  statusMode?: 'at_mill' | 'challan' | 'auto' | 'work';
  showBatch?: boolean;
  showSerialNumber?: boolean;
  evenColumns?: boolean;
}

export function MmMillRollsTable({
  rolls,
  fields,
  uom,
  selectable = false,
  selected = {},
  onToggle,
  onToggleAll,
  emptyText = 'No rolls.',
  statusMode = 'challan',
  showBatch = false,
  showSerialNumber = true,
  evenColumns = false,
}: MmMillRollsTableProps) {
  const cols = withLengthField(fields, uom);
  const selectableRolls = selectable ? rolls.filter((row) => row.at_mill) : [];
  const allOn = selectableRolls.length > 0 && selectableRolls.every((row) => selected[row.id]);
  const colCount =
    (selectable ? 1 : 0) + (showSerialNumber ? 1 : 0) + (showBatch ? 1 : 0) + 2 + cols.length;

  const firstKind: 'check' | 'serial' | 'batch' | 'roll' = selectable
    ? 'check'
    : showSerialNumber
      ? 'serial'
      : showBatch
        ? 'batch'
        : 'roll';

  const even = evenColumns && !selectable;
  const thFor = (kind: typeof firstKind) => {
    if (even || kind !== firstKind) return thCls;
    return thFirstCls;
  };
  const tdFor = (kind: typeof firstKind, extra = '') => {
    const base = even || kind !== firstKind ? tdCls : tdFirstCls;
    return `${base} ${extra}`.trim();
  };

  const statusOf = (roll: MmMillLineRoll) => {
    if (statusMode === 'work' || statusMode === 'auto') {
      const work = millRollWorkStatus(roll);
      return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${millRollWorkStatusClass(work)}`}>
          {millRollWorkStatusLabel(work)}
        </span>
      );
    }
    if (statusMode === 'at_mill' || roll.at_mill) {
      return (
        <span className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-semibold text-yellow-800">
          Not sent
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${millChallanStatusClass(roll.challan_status)}`}>
        {millChallanStatusLabel(roll.challan_status)}
      </span>
    );
  };

  return (
    <div className="overflow-auto min-h-0 flex-1">
      <table className={`w-full table-fixed border-collapse ${even ? '' : 'min-w-[720px]'}`}>
        <colgroup>
          {selectable ? <col style={{ width: '2.5rem' }} /> : null}
          {showSerialNumber ? <col style={{ width: '3.25rem' }} /> : null}
          {showBatch ? <col style={even ? undefined : { width: '5.5rem' }} /> : null}
          <col style={even ? undefined : { width: '12%' }} />
          {cols.map((field) => (
            <col key={field.id} />
          ))}
          <col style={even ? undefined : { width: '6.75rem' }} />
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th className={thFor('check')} style={{ width: '2.5rem' }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  disabled={selectableRolls.length === 0}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  aria-label="Select all rolls"
                />
              </th>
            )}
            {showSerialNumber ? <th className={thFor('serial')}>S.No</th> : null}
            {showBatch && <th className={thFor('batch')}>Batch</th>}
            <th className={thFor('roll')}>Roll No.</th>
            {cols.map((field) => (
              <th key={field.id} className={thCls}>{field.label}</th>
            ))}
            <th className={thCls}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rolls.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-8 text-center text-[11px] text-slate-400 italic">
                {emptyText}
              </td>
            </tr>
          ) : (
            rolls.map((roll, idx) => {
              const canSelect = selectable && roll.at_mill;
              return (
                <tr
                  key={roll.id}
                  className={`hover:bg-slate-50/80 ${selected[roll.id] ? 'bg-blue-50/60' : ''}`}
                >
                  {selectable && (
                    <td className={tdFor('check')}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[roll.id])}
                        disabled={!canSelect}
                        onChange={(e) => onToggle?.(roll.id, e.target.checked)}
                        aria-label={`Select ${roll.unit_code}`}
                      />
                    </td>
                  )}
                  {showSerialNumber ? (
                    <td className={`${tdFor('serial')} text-slate-400 font-semibold tabular-nums`}>
                      {idx + 1}
                    </td>
                  ) : null}
                  {showBatch && (
                    <td className={`${tdFor('batch')} font-semibold text-slate-800`}>
                      {roll.batch_no || '—'}
                    </td>
                  )}
                  <td className={`${tdFor('roll')} font-semibold text-slate-800`}>{roll.unit_code}</td>
                  {cols.map((field) => (
                    <td key={field.id} className={`${tdCls} tabular-nums`}>
                      {millRollFieldText(roll, field)}
                    </td>
                  ))}
                  <td className={tdCls}>
                    <div className="flex justify-center">{statusOf(roll)}</div>
                  </td>
                </tr>
              );
            })
          )}
          {rolls.length > 0 ? (
            <tr aria-hidden>
              <td colSpan={colCount} className="h-10 border-0 p-0" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
