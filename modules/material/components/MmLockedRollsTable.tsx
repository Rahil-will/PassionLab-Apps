import React from 'react';
import type { MmTestField } from '../lib/mmRpc';
import { lockedRollFieldText, withLengthField } from '../lib/mmRollDraft';
import { rollQcClass, rollQcLabel } from '../lib/mmStyleRollGroups';

const thCls =
  'px-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-center';
const thFirstCls =
  'pl-5 pr-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-left';
const tdCls = 'px-4 py-3 text-[11px] text-slate-700 border-b border-slate-100 text-center';
const tdFirstCls =
  'pl-5 pr-4 py-3 text-[11px] text-slate-700 border-b border-slate-100 text-left';

export type MmLockedRollRow = {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  is_remnant?: boolean;
  lot_no?: string | null;
  attributes?: Record<string, unknown> | null;
  mill_snapshot?: Record<string, unknown> | null;
  source?: string | null;
  location_code?: string | null;
  location_name?: string | null;
  status?: string | null;
  qc_result?: string | null;
  points_per_100_sqyd?: number | null;
  selectable?: boolean;
};

function rollStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'issued': return 'Issued';
    case 'in_stock': return 'In stock';
    case 'pending_qc': return 'Pending test';
    case 'rejected': return 'Rejected';
    case 'consumed': return 'Consumed';
    case 'in_transit': return 'In transit';
    case 'draft': return 'Draft';
    case 'returned_to_supplier': return 'Returned';
    case 'missing': return 'Missing';
    case 'written_off': return 'Written off';
    default: return status || '—';
  }
}

interface MmLockedRollsTableProps {
  rolls: MmLockedRollRow[];
  fields: MmTestField[];
  uom?: string | null;
  selectable?: boolean;
  selected?: Record<string, boolean>;
  onToggle?: (rollId: string, on: boolean) => void;
  onToggleAll?: (on: boolean) => void;
  emptyText?: string;
  showQc?: boolean;
  showStatus?: boolean;
  showScore?: boolean;
}

export function MmLockedRollsTable({
  rolls,
  fields,
  uom,
  selectable = false,
  selected = {},
  onToggle,
  onToggleAll,
  emptyText = 'No rolls.',
  showQc = false,
  showStatus = false,
  showScore = false,
}: MmLockedRollsTableProps) {
  const cols = withLengthField(fields, uom);
  const selectableRolls = selectable ? rolls.filter((row) => row.selectable !== false) : [];
  const allOn = selectableRolls.length > 0 && selectableRolls.every((row) => selected[row.id]);
  const colCount = (selectable ? 1 : 0) + 1 + cols.length + 2 + (showStatus ? 1 : 0) + (showScore ? 1 : 0) + (showQc ? 1 : 0);

  return (
    <div className="overflow-auto min-h-0 print:overflow-visible">
      <table className="w-full min-w-[860px] border-collapse print:min-w-0 print:w-full">
        <thead>
          <tr>
            {selectable ? (
              <th className={thCls} style={{ width: '2.5rem' }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  disabled={selectableRolls.length === 0}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  aria-label="Select all rolls"
                />
              </th>
            ) : null}
            <th className={thFirstCls}>Roll</th>
            {cols.map((field) => (
              <th key={field.id} className={thCls}>{field.label}</th>
            ))}
            <th className={thCls}>Location</th>
            {showStatus ? <th className={thCls}>Status</th> : null}
            {showScore ? <th className={thCls}>Pts / 100</th> : null}
            <th className={thCls}>Source</th>
            {showQc ? <th className={thCls}>Inspection</th> : null}
          </tr>
        </thead>
        <tbody>
          {rolls.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-8 text-center text-[11px] text-slate-400 italic">
                {emptyText}
              </td>
            </tr>
          ) : (
            rolls.map((roll) => {
              const canSelect = selectable && roll.selectable !== false;
              return (
                <tr key={roll.id} className={selected[roll.id] ? 'bg-blue-50/60' : ''}>
                  {selectable ? (
                    <td className={tdCls}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[roll.id])}
                        disabled={!canSelect}
                        onChange={(e) => onToggle?.(roll.id, e.target.checked)}
                        aria-label={`Select ${roll.unit_code}`}
                      />
                    </td>
                  ) : null}
                  <td className={`${tdFirstCls} font-semibold text-slate-800`}>
                    <span>{roll.unit_code}</span>
                    {roll.is_remnant ? (
                      <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Remnant
                      </span>
                    ) : null}
                  </td>
                  {cols.map((field) => (
                    <td key={field.id} className={`${tdCls} tabular-nums`}>
                      {lockedRollFieldText(roll, field)}
                    </td>
                  ))}
                  <td className={tdCls}>{roll.location_code || roll.location_name || '—'}</td>
                  {showStatus ? <td className={tdCls}>{rollStatusLabel(roll.status)}</td> : null}
                  {showScore ? (
                    <td className={`${tdCls} tabular-nums`}>
                      {roll.points_per_100_sqyd == null ? '—' : Number(roll.points_per_100_sqyd).toFixed(2)}
                    </td>
                  ) : null}
                  <td className={tdCls}>{roll.source === 'vendor' ? 'Vendor' : roll.source === 'mill' ? 'Mill' : roll.source || '—'}</td>
                  {showQc ? (
                    <td className={tdCls}>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${rollQcClass(roll.qc_result)}`}>
                        {rollQcLabel(roll.qc_result)}
                      </span>
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
