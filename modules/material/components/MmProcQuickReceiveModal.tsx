import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../../components/ui';
import { LabeledDatePicker } from '../../../components/SingleDatePicker';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { queryKeys } from '../../../lib/queryKeys';
import { useNotificationStore } from '../../../stores';
import { mmProcReturn, type MmV4FabricStage } from '../lib/mmV4Rpc';
import { displayNumberToInches, parseWidthUnit, useFabricUnits, widthLabel } from '../lib/units';

type ReceiveLine = {
  id: string;
  code: string;
  qty: string;
  kg: string;
  uom: string;
  shade: string;
  /** Stage the roll went out in. */
  sentStage: string;
  stage: string;
  colour: string;
  dyeLot: string;
  actualGsm: string;
  actualWidth: string;
  fabricTypeId: string;
  widthUnit: string;
  present: boolean;
  arrived: boolean;
};

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function optionalNumber(raw: string): number | null | 'bad' {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return 'bad';
  return n;
}

function linesFrom(
  outLines: Array<Record<string, unknown>>,
  targetColor: string,
): ReceiveLine[] {
  return outLines.map((line) => {
    const status = String(line.line_status ?? line.status ?? 'out').toLowerCase();
    const arrived = status !== 'out' && status !== 'open' && status !== '';
    const qty = Number(line.qty);
    const kg = Number(line.qty_kg ?? line.weight_kg);
    const sentStage = String(line.stage_code ?? '').trim();
    return {
      id: String(line.id ?? ''),
      code: String(line.unit_code ?? line.roll_code ?? 'Roll'),
      qty: Number.isFinite(qty) && qty > 0 ? String(qty) : '',
      kg: Number.isFinite(kg) && kg > 0 ? String(kg) : '',
      uom: String(line.uom ?? '').trim(),
      shade: String(line.shade ?? '').trim(),
      sentStage,
      stage: sentStage,
      colour: targetColor,
      dyeLot: String(line.dye_lot ?? '').trim(),
      actualGsm: '',
      actualWidth: '',
      fabricTypeId: String(line.fabric_type_id ?? ''),
      widthUnit: String(line.width_unit ?? ''),
      present: !arrived,
      arrived,
    };
  });
}

const cell =
  'w-full h-8 rounded-lg border border-slate-200 px-2 text-[12px] text-slate-800 disabled:bg-slate-50 disabled:text-slate-400';

export function MmProcQuickReceiveModal({
  open,
  challanId,
  factoryId,
  outLines,
  stages,
  targetColor,
  onClose,
}: {
  open: boolean;
  challanId: string;
  factoryId: string;
  outLines: Array<Record<string, unknown>>;
  stages: MmV4FabricStage[];
  targetColor: string;
  onClose: () => void;
}) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [bulkStage, setBulkStage] = useState('');
  const [returnedAt, setReturnedAt] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [fillColour, setFillColour] = useState('');
  const [fillDyeLot, setFillDyeLot] = useState('');
  const [fillGsm, setFillGsm] = useState('');
  const [fillWidth, setFillWidth] = useState('');
  const [busy, setBusy] = useState(false);
  const headerLine = lines.find((line) => line.widthUnit || line.uom);
  const units = useFabricUnits(headerLine ? { width_unit: headerLine.widthUnit, uom: headerLine.uom } : null);
  const linesRef = useRef(outLines);
  linesRef.current = outLines;
  const colourRef = useRef(targetColor);
  colourRef.current = targetColor;

  const activeStages = useMemo(
    () => [...stages]
      .filter((stage) => stage.is_active !== false && stage.code)
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0)),
    [stages],
  );

  useEffect(() => {
    if (!open) return;
    const next = linesFrom(linesRef.current, colourRef.current);
    setLines(next);
    const sent = [...new Set(next.filter((line) => !line.arrived).map((line) => line.sentStage).filter(Boolean))];
    setBulkStage(sent.length === 1 ? sent[0] : '');
    setReturnedAt(todayIso());
    setRemarks('');
    setFillColour(colourRef.current);
    setFillDyeLot('');
    setFillGsm('');
    setFillWidth('');
  }, [open]);

  const openCount = useMemo(() => lines.filter((line) => !line.arrived).length, [lines]);

  const patch = (index: number, next: Partial<ReceiveLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line)));
  };

  const applyBulkStage = (code: string) => {
    setBulkStage(code);
    setLines((current) => current.map((line) => (
      line.arrived ? line : { ...line, stage: code || line.sentStage }
    )));
  };

  const stageLabel = (code: string) => activeStages.find((stage) => stage.code === code)?.label || code;

  const save = async () => {
    const picked = lines.filter((line) => line.present && !line.arrived);
    if (picked.length === 0) {
      showNotification('Tick the rolls that came back', 'error');
      return;
    }
    for (const line of picked) {
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        showNotification(`Enter the quantity received for ${line.code}`, 'error');
        return;
      }
      if (optionalNumber(line.actualGsm) === 'bad' || optionalNumber(line.actualWidth) === 'bad') {
        showNotification(`Enter a number for actual GSM or width on ${line.code}`, 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const res = await mmProcReturn({
        challan_id: challanId,
        returned_at: returnedAt || null,
        remarks: remarks.trim() || null,
        same_rolls: picked.map((line) => {
          const qty = Number(line.qty);
          const kg = Number(line.kg);
          const gsm = optionalNumber(line.actualGsm);
          const width = optionalNumber(line.actualWidth);
          const lineUnit = parseWidthUnit(line.widthUnit || units.widthUnit);
          const inches = width === 'bad' || width == null ? null : displayNumberToInches(String(width), lineUnit);
          return {
            out_line_id: line.id,
            qty,
            qty_kg: Number.isFinite(kg) && kg > 0 ? kg : null,
            shade: line.shade || null,
            color_ref: line.colour.trim() || null,
            stage_code: line.stage || null,
            dye_lot: line.dyeLot.trim() || null,
            unit_form: 'roll',
            actual_gsm: gsm === 'bad' ? null : gsm,
            actual_width_in: inches,
          };
        }),
      });
      if (res.ok === false) throw new Error(res.message);
      const stagesBack = [...new Set(picked.map((line) => stageLabel(line.stage)).filter(Boolean))];
      const colours = [...new Set(picked.map((line) => line.colour.trim()).filter(Boolean))];
      const stageBit = stagesBack.length > 0 ? `now ${stagesBack.join(' / ')}` : 'back';
      const colourBit = colours.length > 0 ? colours.join(' / ') : 'no colour';
      showNotification(`${picked.length} rolls back · ${stageBit} · ${colourBit}`, 'success');
      await queryClient.invalidateQueries({ queryKey: queryKeys.mmOps(factoryId) });
      onClose();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Receive failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-6xl">
      <div className="p-4 flex flex-col gap-3 max-h-[85vh]">
        <div>
          <h4 className="text-[14px] font-semibold text-slate-900">Quick receive</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Tick each roll that came back. Stage starts at the stage the rolls went out in. Colour starts at the challan target.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] font-semibold text-slate-600 mb-1">Comes back as</span>
            <select
              value={bulkStage}
              onChange={(event) => applyBulkStage(event.target.value)}
              className={cell}
              aria-label="Comes back as"
            >
              <option value="">Keep each roll's sent stage</option>
              {activeStages.map((stage) => (
                <option key={stage.code} value={stage.code}>{stage.label || stage.code}</option>
              ))}
              {bulkStage && !activeStages.some((stage) => stage.code === bulkStage) ? (
                <option value={bulkStage}>{bulkStage}</option>
              ) : null}
            </select>
          </label>
          <LabeledDatePicker
            label="Received date"
            value={returnedAt}
            onChange={setReturnedAt}
            variant="pill"
            labelClassName="block text-[10px] font-semibold text-slate-600 mb-1"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[10px] font-semibold text-slate-600 mb-1">Colour for all</span>
            <input value={fillColour} onChange={(event) => setFillColour(event.target.value)} className={`${cell} w-40`} />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setLines((current) => current.map((line) => (
              line.arrived || !line.present ? line : { ...line, colour: fillColour }
            )))}
          >
            Same for all
          </Button>
          <label className="block">
            <span className="block text-[10px] font-semibold text-slate-600 mb-1">Dye lot for all</span>
            <input value={fillDyeLot} onChange={(event) => setFillDyeLot(event.target.value)} className={`${cell} w-40`} />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setLines((current) => current.map((line) => (
              line.arrived || !line.present ? line : { ...line, dyeLot: fillDyeLot }
            )))}
          >
            Same for all
          </Button>
          <label className="block">
            <span className="block text-[10px] font-semibold text-slate-600 mb-1">Actual GSM for all</span>
            <input value={fillGsm} inputMode="decimal" onChange={(event) => setFillGsm(event.target.value)} className={`${cell} w-28`} />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setLines((current) => current.map((line) => (
              line.arrived || !line.present ? line : { ...line, actualGsm: fillGsm }
            )))}
          >
            Same for all
          </Button>
          <label className="block">
            <span className="block text-[10px] font-semibold text-slate-600 mb-1">Actual width ({widthLabel(units.widthUnit)}) for all</span>
            <input value={fillWidth} inputMode="decimal" onChange={(event) => setFillWidth(event.target.value)} className={`${cell} w-28`} />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setLines((current) => current.map((line) => (
              line.arrived || !line.present ? line : { ...line, actualWidth: fillWidth }
            )))}
          >
            Same for all
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 text-left">Roll</th>
                <th className="px-2 py-2 text-left">Qty</th>
                <th className="px-2 py-2 text-left">Kg</th>
                <th className="px-2 py-2 text-left">Stage</th>
                <th className="px-2 py-2 text-left">Colour</th>
                <th className="px-2 py-2 text-left">Dye lot</th>
                <th className="px-2 py-2 text-left">Actual GSM</th>
                <th className="px-2 py-2 text-left">Actual width ({widthLabel(units.widthUnit)})</th>
                <th className="px-2 py-2 text-left">Shade</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-400">No rolls on this challan.</td>
                </tr>
              ) : lines.map((line, index) => {
                const locked = line.arrived || !line.present;
                return (
                  <tr key={line.id || line.code} className="border-t border-slate-100">
                    <td className="px-2 py-2 align-top">
                      <p className="font-semibold text-slate-900">{line.code}</p>
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={line.present}
                          disabled={line.arrived}
                          onChange={(event) => patch(index, { present: event.target.checked })}
                        />
                        {line.arrived ? 'Already in' : 'Received'}
                      </label>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={line.qty}
                        onChange={(event) => patch(index, { qty: event.target.value })}
                        className={cell}
                        aria-label={`Quantity ${line.code}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={line.kg}
                        onChange={(event) => patch(index, { kg: event.target.value })}
                        className={cell}
                        aria-label={`Kg ${line.code}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <select
                        disabled={locked}
                        value={line.stage}
                        onChange={(event) => patch(index, { stage: event.target.value })}
                        className={cell}
                        aria-label={`Stage ${line.code}`}
                      >
                        <option value="">Stage</option>
                        {activeStages.map((stage) => (
                          <option key={stage.code} value={stage.code}>{stage.label || stage.code}</option>
                        ))}
                        {line.stage && !activeStages.some((stage) => stage.code === line.stage) ? (
                          <option value={line.stage}>{line.stage}</option>
                        ) : null}
                      </select>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        disabled={locked}
                        value={line.colour}
                        onChange={(event) => patch(index, { colour: event.target.value })}
                        className={cell}
                        aria-label={`Colour ${line.code}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        disabled={locked}
                        value={line.dyeLot}
                        onChange={(event) => patch(index, { dyeLot: event.target.value })}
                        className={cell}
                        aria-label={`Dye lot ${line.code}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={line.actualGsm}
                        onChange={(event) => patch(index, { actualGsm: event.target.value })}
                        className={cell}
                        aria-label={`Actual GSM ${line.code}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={line.actualWidth}
                        onChange={(event) => patch(index, { actualWidth: event.target.value })}
                        className={cell}
                        aria-label={`Actual width ${line.code}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        disabled={locked}
                        value={line.shade}
                        onChange={(event) => patch(index, { shade: event.target.value })}
                        className={cell}
                        aria-label={`Shade ${line.code}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <label className="block">
          <span className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</span>
          <textarea
            value={remarks}
            onChange={(event) => setRemarks(event.target.value.slice(0, 400))}
            rows={2}
            placeholder="Add any remarks…"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 resize-y"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={busy || openCount === 0} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Receive'}
            </Button>
          </DesktopWriteGate>
        </div>
      </div>
    </Modal>
  );
}
