import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useRef, useState, useMemo } from 'react';
import { Copy, Trash2, RotateCcw } from 'lucide-react';
import type { Colorway } from '../../types';
import { Modal, Button } from '../ui';
import {
  type OrderShipmentPlan,
  type ShipmentPlanLine,
  planTotalQty,
  rowTotal,
  fillRowFromRemainingBalance,
  colorBalanceSummary,
  planBalanceBySize,
  planBalanceTotal,
  planQtyDeltaBySize,
  expandShipmentPlanLines,
  isVirtualShipmentLine,
  isActiveShipmentLine,
  shipmentPlanRescheduleReason,
  autoShipmentTypeForLine,
  colorwayHasRemainingBalance,
  clampLineSizes,
  duplicateShipmentLine,
  emptySizesForLabels,
} from '../../lib/orderShipmentPlan';
import { swatchStyleFromColorName } from '../../lib/colorNameSwatch';
import { SingleDatePicker } from '../SingleDatePicker';
import { ShipmentPlanRescheduleCommentRow } from './ShipmentPlanRescheduleCommentRow';

interface ShipmentPlanPanelProps {
  plan: OrderShipmentPlan;
  onChange: (plan: OrderShipmentPlan) => void;
  colorways: Colorway[];
  displaySizes: string[];
  shipModes: string[];
  shipmentTypes: string[];
  destinationCountries?: string[];
  jobCardDate?: string;
  disabled?: boolean;
  requireDateChangeReason?: boolean;
}

export interface ShipmentPlanPanelHandle {
  addLine: () => void;
}

const ROW_H = 'h-11';
const thCls =
  'px-2 py-2.5 text-[10px] font-semibold text-slate-600 uppercase border border-slate-200 bg-slate-50 whitespace-nowrap';
const thPrimaryCls = `${thCls} text-slate-700`;
const dataCellCls = `p-0 border border-slate-200 align-middle ${ROW_H}`;
const cellInputBase =
  `w-full ${ROW_H} min-h-[2.75rem] px-2 text-[11px] bg-transparent border-0 rounded-none outline-none tabular-nums ` +
  'focus:bg-blue-50/50 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors placeholder:text-slate-300';
const cellInputCenter = `${cellInputBase} text-center`;
const cellSelectCls =
  `w-full ${ROW_H} min-h-[2.75rem] px-2 pr-7 text-[11px] bg-transparent border-0 rounded-none outline-none ` +
  'focus:bg-blue-50/50 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors appearance-none ' +
  "bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] " +
  'bg-[length:8px] bg-no-repeat bg-[right_0.5rem_center]';

function emptyLine(displaySizes: string[]): ShipmentPlanLine {
  return {
    id: crypto.randomUUID(),
    shipmentDate: '',
    shipMode: '',
    shipmentType: '',
    destinationCountry: '',
    colorwayId: '',
    sizes: emptySizesForLabels(displaySizes),
    status: 'planned',
  };
}

export const ShipmentPlanPanel = forwardRef<ShipmentPlanPanelHandle, ShipmentPlanPanelProps>(
  function ShipmentPlanPanel(
    {
      plan,
      onChange,
      colorways,
      displaySizes,
      shipModes,
      shipmentTypes,
      destinationCountries = [],
      jobCardDate,
      disabled = false,
      requireDateChangeReason = false,
    },
    ref,
  ) {
    const patchLines = (lines: ShipmentPlanLine[]) => onChange({ lines });

    const initialDatesRef = useRef<Map<string, string>>(new Map());
    const [dateChangePrompt, setDateChangePrompt] = useState<{
      lineId: string;
      oldDate: string;
      newDate: string;
    } | null>(null);
    const [dateChangeReason, setDateChangeReason] = useState('');

    const balanceBySize = useMemo(
      () => planBalanceBySize(plan, colorways, displaySizes),
      [plan, colorways, displaySizes],
    );
    const balanceDeltaBySize = useMemo(
      () => planQtyDeltaBySize(plan, colorways, displaySizes),
      [plan, colorways, displaySizes],
    );
    const balanceTotal = useMemo(
      () => planBalanceTotal(plan, colorways, displaySizes),
      [plan, colorways, displaySizes],
    );
    const balanceOverTotal = useMemo(
      () =>
        Object.values(balanceDeltaBySize).reduce(
          (sum, delta) => sum + (delta < 0 ? -delta : 0),
          0,
        ),
      [balanceDeltaBySize],
    );

    useEffect(() => {
      const map = new Map<string, string>();
      for (const line of plan.lines) {
        if (line.shipmentDate) map.set(line.id, line.shipmentDate);
      }
      initialDatesRef.current = map;
    }, [requireDateChangeReason]);

    const addLine = useCallback(() => {
      patchLines([...plan.lines, emptyLine(displaySizes)]);
    }, [plan.lines, displaySizes, onChange]);

    useImperativeHandle(ref, () => ({ addLine }), [addLine]);

    const patchLine = useCallback(
      (id: string, patch: Partial<ShipmentPlanLine>) => {
        const source = plan.lines.find((l) => l.id === id);
        if (!source) return;

        let merged: ShipmentPlanLine = { ...source, ...patch };
        const cw = colorways.find((c) => c.id === merged.colorwayId);

        if (patch.colorwayId && patch.colorwayId !== source.colorwayId) {
          merged = {
            ...merged,
            sizes: emptySizesForLabels(displaySizes),
            shipmentType: '',
          };
        }

        if (cw && (patch.sizes || patch.colorwayId)) {
          merged = { ...merged, sizes: clampLineSizes(merged, plan, cw, displaySizes) };
        }

        const nextLines = plan.lines.map((l) => (l.id === id ? merged : l));
        const nextPlan: OrderShipmentPlan = { lines: nextLines };

        if (cw && (patch.sizes || patch.colorwayId)) {
          merged = {
            ...merged,
            shipmentType: autoShipmentTypeForLine(merged, nextPlan, cw, displaySizes, shipmentTypes),
          };
        }

        patchLines(nextLines.map((l) => (l.id === id ? merged : l)));
      },
      [plan.lines, colorways, displaySizes, shipmentTypes, onChange],
    );

    const requestDateChange = useCallback(
      (lineId: string, newDate: string) => {
        const line = plan.lines.find((l) => l.id === lineId);
        if (line?.status === 'rescheduled') return;
        const oldDate = initialDatesRef.current.get(lineId) || line?.shipmentDate || '';
        if (requireDateChangeReason && oldDate && newDate && oldDate !== newDate) {
          setDateChangeReason('');
          setDateChangePrompt({ lineId, oldDate, newDate });
          return;
        }
        patchLine(lineId, { shipmentDate: newDate });
      },
      [requireDateChangeReason, patchLine, plan.lines],
    );

    const confirmDateChange = () => {
      if (!dateChangePrompt || !dateChangeReason.trim()) return;
      const { lineId, oldDate, newDate } = dateChangePrompt;
      const reason = dateChangeReason.trim();
      const source = plan.lines.find((l) => l.id === lineId);
      if (!source || source.status === 'rescheduled') return;

      const superseded: ShipmentPlanLine = {
        ...source,
        shipmentDate: oldDate,
        status: 'rescheduled',
        _dateChangeReason: reason,
        notes: reason,
      };
      const active: ShipmentPlanLine = {
        ...source,
        id: crypto.randomUUID(),
        shipmentDate: newDate,
        status: 'planned',
        _dateChangeReason: undefined,
        notes: undefined,
        changeHistory: [
          {
            previous_date: oldDate,
            new_date: newDate,
            reason,
            changed_at: new Date().toISOString(),
          },
        ],
      };

      patchLines(plan.lines.flatMap((l) => (l.id === lineId ? [superseded, active] : [l])));
      initialDatesRef.current.set(active.id, newDate);
      setDateChangePrompt(null);
      setDateChangeReason('');
    };

    const duplicateLine = useCallback(
      (line: ShipmentPlanLine) => {
        const dup = duplicateShipmentLine(line, displaySizes);
        const idx = plan.lines.findIndex((l) => l.id === line.id);
        const next = [...plan.lines];
        next.splice(idx + 1, 0, dup);
        patchLines(next);
      },
      [plan.lines, displaySizes, onChange],
    );

    const removeLine = useCallback(
      (lineId: string) => {
        patchLines(plan.lines.filter((l) => l.id !== lineId));
        initialDatesRef.current.delete(lineId);
      },
      [plan.lines, onChange],
    );

    const displayLines = expandShipmentPlanLines(plan.lines);

    if (displaySizes.length === 0) {
      return (
        <div className="px-5 py-8 text-center text-[11px] text-slate-400 italic">
          Select a size group to start planning shipment quantities.
        </div>
      );
    }

    const showDestCol =
      destinationCountries.length > 0 || plan.lines.some((l) => l.destinationCountry);
    const metaCols = 5 + (showDestCol ? 1 : 0);
    const showMxCol = !disabled;
    const colSpanAll = metaCols + displaySizes.length + 1 + (showMxCol ? 1 : 0) + (disabled ? 0 : 1);
    const colWidth = `${100 / colSpanAll}%`;

    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed min-w-[48rem] text-[11px]">
            <colgroup>
              {Array.from({ length: colSpanAll }).map((_, i) => (
                <col key={i} style={{ width: colWidth }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={`${thCls} text-center`}>#</th>
                <th className={`${thPrimaryCls} text-left`}>Shipment Date</th>
                <th className={`${thPrimaryCls} text-left`}>Mode</th>
                <th className={`${thPrimaryCls} text-left`}>Type</th>
                {showDestCol && <th className={`${thPrimaryCls} text-left`}>Country</th>}
                <th className={`${thPrimaryCls} text-left`}>Color</th>
                {displaySizes.map((s) => (
                  <th key={s} className={`${thCls} text-center`}>
                    {s}
                  </th>
                ))}
                <th className={`${thCls} text-center`}>Total</th>
                {showMxCol && <th className={`${thCls} text-center`}>MX</th>}
                {!disabled && <th className={thCls} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {plan.lines.length === 0 && (
                <tr>
                  <td
                    colSpan={colSpanAll}
                    className="border border-slate-200 px-4 py-8 text-center text-[11px] text-slate-400 italic"
                  >
                    {disabled
                      ? 'Select a size group first.'
                      : 'Click "+ Add Plan" to add a shipment line.'}
                  </td>
                </tr>
              )}
              {displayLines.flatMap((line, idx) => {
                const cw = colorways.find((c) => c.id === line.colorwayId);
                const swatch = swatchStyleFromColorName(cw?.name || '');
                const total = rowTotal(line);
                const isRescheduled = line.status === 'rescheduled';
                const isHistoryRow = isRescheduled || isVirtualShipmentLine(line.id);
                const isLocked = disabled || isHistoryRow;
                const rescheduleReason = shipmentPlanRescheduleReason(line);
                const bal =
                  !isLocked && line.colorwayId && cw
                    ? colorBalanceSummary(plan, line.colorwayId, cw, displaySizes, line.id)
                    : null;
                const canMax = bal && bal.remainingTotal > 0;

                const hasComment = isRescheduled && !!rescheduleReason;

                const dataRow = (
                  <tr
                    key={line.id}
                    className={isRescheduled ? 'bg-slate-50/80' : 'group hover:bg-slate-50/40'}
                  >
                    <td
                      rowSpan={hasComment ? 2 : undefined}
                      className={`${dataCellCls} text-center text-slate-400 text-[10px]`}
                    >
                      {idx + 1}
                    </td>

                    <td className={dataCellCls}>
                      {isLocked ? (
                        <div className="px-2 flex flex-col justify-center gap-0.5 py-1.5 min-h-11">
                          <span className={`flex items-center gap-1 ${isRescheduled ? 'text-slate-500 line-through' : ''}`}>
                            {line.shipmentDate || '—'}
                            {line.status === 'replanned' && !isRescheduled && (
                              <RotateCcw size={9} className="text-amber-500 shrink-0" />
                            )}
                          </span>
                          {isRescheduled && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700">
                              Rescheduled
                            </span>
                          )}
                        </div>
                      ) : (
                        <SingleDatePicker
                          value={line.shipmentDate}
                          minDate={jobCardDate || undefined}
                          onChange={(iso) => requestDateChange(line.id, iso)}
                          trigger="cell"
                          emptyLabel=""
                          className="w-full"
                        />
                      )}
                    </td>

                    <td className={dataCellCls}>
                      {isLocked ? (
                        <span className="px-2 flex items-center h-11">{line.shipMode || '—'}</span>
                      ) : (
                        <select
                          value={line.shipMode}
                          onChange={(e) => patchLine(line.id, { shipMode: e.target.value })}
                          className={`${cellSelectCls} ${!line.shipMode ? 'text-slate-400' : 'text-slate-800'}`}
                        >
                          <option value="">Mode</option>
                          {shipModes.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className={dataCellCls}>
                      {isLocked ? (
                        <span className="px-2 flex items-center h-11">{line.shipmentType || '—'}</span>
                      ) : (
                        <span
                          className={`px-2 flex items-center h-11 text-[11px] ${
                            line.shipmentType ? 'text-blue-700 font-semibold' : 'text-slate-300'
                          }`}
                          title="Auto-calculated from qty (full = ships all remaining for this color)"
                        >
                          {line.shipmentType || '—'}
                        </span>
                      )}
                    </td>

                    {showDestCol && (
                      <td className={dataCellCls}>
                        {isLocked ? (
                          <span className="px-2 flex items-center h-11">
                            {line.destinationCountry || '—'}
                          </span>
                        ) : (
                          <select
                            value={line.destinationCountry ?? ''}
                            onChange={(e) =>
                              patchLine(line.id, { destinationCountry: e.target.value })
                            }
                            className={`${cellSelectCls} ${!line.destinationCountry ? 'text-slate-400' : 'text-slate-800'}`}
                          >
                            <option value="">Country</option>
                            {destinationCountries.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    )}

                    <td className={dataCellCls}>
                      {isLocked ? (
                        <div className="px-2 flex items-center gap-1.5 h-11">
                          <span className="w-2 h-2 rounded-full shrink-0" style={swatch} />
                          <span className="truncate">{cw?.name?.trim() || '—'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center h-11 min-h-[2.75rem]">
                          <span
                            className="w-2 h-2 rounded-full shrink-0 ml-2"
                            style={cw ? swatch : { background: '#e2e8f0' }}
                          />
                          <select
                            value={line.colorwayId}
                            onChange={(e) =>
                              patchLine(line.id, {
                                colorwayId: e.target.value,
                              })
                            }
                            className={`${cellSelectCls} flex-1 pl-1.5 ${!line.colorwayId ? 'text-slate-400' : 'text-slate-800'}`}
                          >
                            <option value="">Color</option>
                            {colorways.map((c) => {
                              const selectable =
                                colorwayHasRemainingBalance(plan, c.id, c, displaySizes, line.id) ||
                                line.colorwayId === c.id;
                              if (!selectable) return null;
                              return (
                                <option key={c.id} value={c.id}>
                                  {c.name?.trim() || 'Color'}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}
                    </td>

                    {displaySizes.map((s) => (
                      <td key={s} className={dataCellCls}>
                        {isLocked ? (
                          <span className="flex items-center justify-center h-11 tabular-nums">
                            {line.sizes[s] > 0 ? line.sizes[s].toLocaleString() : '—'}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={line.sizes[s] || ''}
                            placeholder="0"
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10) || 0;
                              patchLine(line.id, {
                                sizes: {
                                  ...line.sizes,
                                  [s]: raw,
                                },
                              });
                            }}
                            className={cellInputCenter}
                          />
                        )}
                      </td>
                    ))}

                    <td className={dataCellCls}>
                      <span className="flex items-center justify-center h-11 font-bold text-slate-800 tabular-nums">
                        {total > 0 ? total.toLocaleString() : '—'}
                      </span>
                    </td>

                    {showMxCol && (
                      <td className={`${dataCellCls} text-center`}>
                        {!isRescheduled && cw ? (
                          <button
                            type="button"
                            onClick={() => {
                              const filled = fillRowFromRemainingBalance(
                                line,
                                plan,
                                cw,
                                displaySizes,
                              );
                              patchLine(line.id, { sizes: filled.sizes });
                            }}
                            disabled={!canMax}
                            className={`w-full h-11 text-[9px] font-bold border-0 transition-colors ${
                              canMax
                                ? 'text-blue-600 bg-blue-50/80 hover:bg-blue-100'
                                : 'text-slate-300 bg-slate-50/50 cursor-not-allowed'
                            }`}
                            title="Fill remaining adjusted qty"
                          >
                            MX
                          </button>
                        ) : (
                          <span className="flex items-center justify-center h-11 text-slate-300">—</span>
                        )}
                      </td>
                    )}

                    {!disabled && (
                      <td
                        className={`${dataCellCls} text-center`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isRescheduled ? (
                          <div className="flex items-center justify-center gap-1 h-11 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => duplicateLine(line)}
                              className="p-1 text-slate-400 hover:text-blue-600"
                              title="Duplicate row"
                            >
                              <Copy size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLine(line.id)}
                              className="p-1 text-slate-400 hover:text-red-500"
                              title="Delete row"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );

                if (hasComment) {
                  return [
                    dataRow,
                    <ShipmentPlanRescheduleCommentRow
                      key={`${line.id}-comment`}
                      commentColSpan={colSpanAll - 1}
                      reason={rescheduleReason}
                    />,
                  ];
                }
                return [dataRow];
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50">
                <td
                  colSpan={metaCols}
                  className="px-3 py-2 border border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-600"
                >
                  Plan Total
                </td>
                {displaySizes.map((s) => (
                  <td
                    key={s}
                    className="px-2 py-2 border border-slate-200 text-center font-bold text-slate-700 tabular-nums"
                  >
                    {plan.lines
                      .filter(isActiveShipmentLine)
                      .reduce((sum, l) => sum + (l.sizes[s] || 0), 0) || '—'}
                  </td>
                ))}
                <td className="px-2 py-2 border border-slate-200 text-center font-bold text-slate-800 tabular-nums">
                  {planTotalQty(plan) > 0 ? planTotalQty(plan).toLocaleString() : '—'}
                </td>
                {showMxCol && <td className="border border-slate-200 bg-slate-50" />}
                {!disabled && <td className="border border-slate-200 bg-slate-50" />}
              </tr>
              <tr className="bg-amber-50/40">
                <td
                  colSpan={metaCols}
                  className="px-3 py-2 border border-slate-200 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                >
                  Balance
                </td>
                {displaySizes.map((s) => {
                  const delta = balanceDeltaBySize[s] ?? 0;
                  const over = delta < 0 ? -delta : 0;
                  const remaining = balanceBySize[s] ?? 0;
                  return (
                    <td
                      key={s}
                      className={`px-2 py-2 border border-slate-200 text-center font-bold tabular-nums ${
                        over > 0 ? 'text-red-700' : 'text-amber-800'
                      }`}
                    >
                      {over > 0
                        ? `Over ${over.toLocaleString()}`
                        : remaining > 0
                          ? remaining.toLocaleString()
                          : '—'}
                    </td>
                  );
                })}
                <td
                  className={`px-2 py-2 border border-slate-200 text-center font-bold tabular-nums ${
                    balanceOverTotal > 0 ? 'text-red-700' : 'text-amber-800'
                  }`}
                >
                  {balanceOverTotal > 0
                    ? `Over ${balanceOverTotal.toLocaleString()}`
                    : balanceTotal > 0
                      ? balanceTotal.toLocaleString()
                      : '—'}
                </td>
                {showMxCol && <td className="border border-slate-200 bg-amber-50/40" />}
                {!disabled && <td className="border border-slate-200 bg-amber-50/40" />}
              </tr>
            </tfoot>
          </table>
        </div>

        {dateChangePrompt && (
          <Modal isOpen onClose={() => setDateChangePrompt(null)} className="max-w-md">
            <div className="p-6">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Shipment date change</h3>
              <p className="text-[11px] text-slate-600 mb-3">
                Date changes from{' '}
                <span className="font-semibold">{dateChangePrompt.oldDate}</span> to{' '}
                <span className="font-semibold">{dateChangePrompt.newDate}</span>. Enter a reason —
                this is saved in the plan history.
              </p>
              <textarea
                value={dateChangeReason}
                onChange={(e) => setDateChangeReason(e.target.value)}
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Reason for replanning…"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="secondary" size="sm" onClick={() => setDateChangePrompt(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!dateChangeReason.trim()}
                  onClick={confirmDateChange}
                >
                  Confirm change
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </>
    );
  },
);
