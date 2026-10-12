import React, { useEffect, useMemo, useState } from 'react';
import { Button, Modal, SelectDropdown } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useOrdersList } from '../../../hooks/useOrdersList';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import type { MmWarehouseFabricCell, MmWarehouseStockRow } from '../lib/mmRpc';
import { mmAllocateMillRollsToStyle, mmAllocateRollsToStyle } from '../lib/mmRpc';
import { differentFabric, fabricMismatchMessage, mismatchHitsRoll } from '../lib/fabricStock';
import { useMmWarehouseBoard } from '../lib/useMmOps';

function normColor(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function MmAllocateRollsModal({
  open,
  rolls,
  source = 'warehouse',
  onClose,
  onDone,
}: {
  open: boolean;
  rolls: MmWarehouseStockRow[];
  source?: 'warehouse' | 'mill';
  onClose: () => void;
  onDone: (
    overAllocated: boolean,
    assigned?: { orderId: string; colorwayId: string; fabricLineId: string },
  ) => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderId, setOrderId] = useState('');
  const [colorwayId, setColorwayId] = useState('');
  const [fabricLineId, setFabricLineId] = useState('');
  const debounced = useDebouncedValue(orderSearch, 300);
  const ordersQuery = useOrdersList(
    factoryId,
    1,
    12,
    { search: debounced || undefined, excludeCompleted: true },
    Boolean(open && factoryId),
  );
  const boardQuery = useMmWarehouseBoard(orderId ? [orderId] : [], Boolean(open && orderId));
  const fabricTypeId = rolls[0]?.fabric_type_id ?? null;
  const cells = useMemo(
    () => (boardQuery.data?.[0]?.fabrics ?? []).filter((cell) => {
      if (!fabricTypeId) return true;
      return cell.fabric_type_id === fabricTypeId;
    }),
    [boardQuery.data, fabricTypeId],
  );
  const colorways = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const cell of cells) {
      if (!map.has(cell.colorway_id)) map.set(cell.colorway_id, { id: cell.colorway_id, name: cell.color_name });
    }
    return [...map.values()];
  }, [cells]);
  const fabrics = cells.filter((cell) => !colorwayId || cell.colorway_id === colorwayId);
  const selectedCell: MmWarehouseFabricCell | undefined = fabrics.find((cell) => cell.fabric_line_id === fabricLineId);
  const colorName = selectedCell?.color_name ?? colorways.find((c) => c.id === colorwayId)?.name ?? '';
  const colorMismatch = rolls.some((row) => {
    const ref = normColor(row.color_ref);
    return Boolean(ref) && Boolean(normColor(colorName)) && ref !== normColor(colorName);
  });

  useEffect(() => {
    if (!open) {
      setOrderSearch('');
      setOrderId('');
      setColorwayId('');
      setFabricLineId('');
      setBusy(false);
      setMismatch(null);
    }
  }, [open]);

  const save = async () => {
    if (!orderId || !colorwayId || !fabricLineId) return;
    setBusy(true);
    try {
      const res = source === 'mill'
        ? await mmAllocateMillRollsToStyle(
            rolls.map((row) => row.id),
            orderId,
            colorwayId,
            fabricLineId,
          )
        : await mmAllocateRollsToStyle(
            rolls.map((row) => row.id),
            orderId,
            colorwayId,
            fabricLineId,
          );
      if (res.ok === false) {
        const text = fabricMismatchMessage(res);
        if (text) setMismatch(text);
        else showNotification(res.message, 'error');
        return;
      }
      setMismatch(null);
      onDone(Boolean(res.data.over_allocated), { orderId, colorwayId, fabricLineId });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Allocate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} className="max-w-lg">
      <div className="p-5">
        <h4 className="text-[14px] font-semibold text-slate-900">
          {source === 'mill' ? 'Assign to style' : 'Allocate rolls'}
        </h4>
        <p className="text-[11px] text-slate-500 mt-1">
          {rolls.length} rolls · {rolls[0]?.fabric_type || 'fabric'}.
          {source === 'mill'
            ? ' Pick a style PO, then that color\'s material. Rolls stay at the mill until you dispatch.'
            : ' Coverage follows the unit, not the inbound challan.'}
        </p>
        <div className="mt-3 rounded-lg border border-slate-100 overflow-hidden max-h-28 overflow-y-auto">
          <table className="w-full border-collapse text-[11px] text-slate-600">
            <thead>
              <tr className="bg-slate-50 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-1 text-left">Roll</th>
                <th className="px-2 py-1 text-left w-20">Fabric</th>
              </tr>
            </thead>
            <tbody>
              {rolls.map((row) => {
                const other = differentFabric(selectedCell?.fabric_id, row.fabric_id);
                const hit = mismatch ? mismatchHitsRoll(mismatch, row.unit_code) : false;
                return (
                  <tr
                    key={row.id}
                    title={other ? 'Different fabric' : undefined}
                    className={other ? 'opacity-40' : hit ? 'text-red-700 bg-red-50' : undefined}
                  >
                    <td className="px-2 py-1 border-t border-slate-100">
                      {row.unit_code}
                      {row.color_ref ? ` · ${row.color_ref}` : ''}
                      {row.shade ? ` · shade ${row.shade}` : ''}
                      {row.lot_no ? ` · lot ${row.lot_no}` : ''}
                    </td>
                    <td className="px-2 py-1 border-t border-slate-100 font-mono text-[10px] text-slate-700">
                      {row.fabric_code || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Style / PO</label>
          <input
            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 focus:border-blue-500 focus:outline-none"
            placeholder="Search style, PO, buyer…"
            value={orderSearch}
            onChange={(e) => {
              setOrderSearch(e.target.value);
              setOrderId('');
              setColorwayId('');
              setFabricLineId('');
            }}
          />
          <div className="mt-2 max-h-36 overflow-y-auto border border-slate-100 rounded-lg">
            {(ordersQuery.data?.rows ?? []).map((order) => (
              <button
                key={order.id}
                type="button"
                className={`w-full text-left px-2.5 py-1.5 text-[11px] ${
                  orderId === order.id ? 'bg-slate-800 text-white' : 'hover:bg-slate-50 text-slate-700'
                }`}
                onClick={() => {
                  setOrderId(order.id);
                  setColorwayId('');
                  setFabricLineId('');
                }}
              >
                <span className="font-semibold">{order.style_name}</span>
                <span className="block text-[10px] opacity-80">{[order.buyer_name, order.po_number].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
            {(ordersQuery.data?.rows ?? []).length === 0 && (
              <p className="px-2.5 py-3 text-[11px] text-slate-400">No styles match.</p>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">Color</span>
            <SelectDropdown
              value={colorwayId}
              onChange={(v) => {
                setColorwayId(v);
                setFabricLineId('');
              }}
              options={[
                { value: '', label: 'Select color' },
                ...colorways.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className="w-full"
            />
          </div>
          <div>
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">This color's fabric</span>
            <SelectDropdown
              value={fabricLineId}
              onChange={setFabricLineId}
              options={[
                { value: '', label: 'Select fabric' },
                ...fabrics.map((f) => ({ value: f.fabric_line_id, label: f.fabric_name })),
              ]}
              className="w-full"
            />
          </div>
        </div>
        {mismatch ? (
          <p className="mt-3 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            Fabric mismatch — {mismatch}
          </p>
        ) : null}
        {colorMismatch ? (
          <p className="mt-3 text-[11px] text-amber-700">
            Color ref on a selected roll does not match this colorway. You can still allocate.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <DesktopWriteGate>
            <Button
              type="button"
              size="sm"
              disabled={busy || !orderId || !colorwayId || !fabricLineId}
              onClick={() => void save()}
            >
              {busy ? (source === 'mill' ? 'Assigning…' : 'Allocating…') : source === 'mill' ? 'Assign to style' : 'Allocate'}
            </Button>
          </DesktopWriteGate>
        </div>
      </div>
    </Modal>
  );
}
