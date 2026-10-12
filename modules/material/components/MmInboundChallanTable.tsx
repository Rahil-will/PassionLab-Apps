import React, { useState } from 'react';
import { Check, Eye } from 'lucide-react';
import { DesktopWriteGate, useDesktopWriteRole } from '../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import { receiveMillChallanAsIs, type MmInChallanHeader } from '../lib/mmRpc';
import { useInvalidateMmOps } from '../lib/useMmOps';
import {
  inboundDocKind,
  inboundFabricCategory,
  inboundIsStyleBound,
  inboundOpsStatus,
  inboundOpsStatusLabel,
  inboundPassedRolls,
  inboundSourceLabel,
  inboundStatusDot,
  inboundStatusText,
  inboundStyleDisplayName,
  inboundStyleKindLabel,
  inboundWhen,
} from '../lib/inboundDisplay';
import { formatQtyM, formatWhen } from '../lib/mmRollDraft';
import { unitFormCountText, unitFormLabel } from '../lib/mmUnitForm';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thRecvCls =
  'px-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const thPassCls =
  'px-2 py-2 text-[10px] font-semibold text-emerald-800 uppercase tracking-wide border-b border-slate-200 bg-emerald-50 text-center whitespace-nowrap';
const tdCls = 'px-2.5 py-2 text-[11px] text-slate-700 border-b border-slate-100';
const tdRecvCls = 'px-2 py-2 text-center border-b border-slate-100 bg-blue-50/60';
const tdPassCls = 'px-2 py-2 text-center border-b border-slate-100 bg-emerald-50/70';
const previewTh =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const previewThCenter =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const previewThRolls =
  'px-2 py-1.5 text-[9px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const previewThQty =
  'px-2 py-1.5 text-[9px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const previewTd = 'px-2 py-1.5 text-[9px] text-slate-700 border-b border-slate-100';
const previewTdRolls = 'px-2 py-1.5 text-center border-b border-slate-100 bg-blue-50/60 text-[9px] text-slate-700 tabular-nums';
const previewTdQty = 'px-2 py-1.5 text-center border-b border-slate-100 bg-blue-50/60 text-[9px] text-slate-700 tabular-nums';

function fabricName(row: MmInChallanHeader): string {
  const name = (row.fabric_name || '').trim();
  const type = (row.fabric_type || '').trim();
  return name || type || '—';
}

function TwoLine({ primary, secondary }: { primary: string; secondary?: string | null }) {
  const sub = (secondary ?? '').trim();
  return (
    <>
      <span className="block font-medium text-slate-800 truncate">{primary || '—'}</span>
      {sub ? <span className="block text-[10px] text-slate-400 truncate">{sub}</span> : null}
    </>
  );
}

function formWord(row: MmInChallanHeader, count = 2): string {
  return unitFormLabel(row.unit_form, count);
}

function inboundRollBadge(row: MmInChallanHeader): string {
  const total = Number(row.roll_count || 0);
  const form = row.unit_form || 'roll';
  if (
    (row.status === 'partial' || row.status === 'short_closed')
    && typeof row.received_roll_count === 'number'
  ) {
    return `${row.received_roll_count}/${total} ${formWord(row, total)}`;
  }
  return unitsLabel(total, form);
}

function unitsLabel(count: number | null | undefined, form: string | null | undefined): string {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return unitFormCountText({ [form || 'roll']: n });
}

function InboundActionCell({
  row,
  busyId,
  hideReceive,
  onView,
  onReceive,
}: {
  row: MmInChallanHeader;
  busyId: string | null;
  hideReceive?: boolean;
  onView: (row: MmInChallanHeader, e: React.MouseEvent) => void;
  onReceive: (row: MmInChallanHeader, e: React.MouseEvent) => void;
}) {
  const millPending = row.source === 'mill' && row.status === 'pending';
  const canWrite = useDesktopWriteRole();
  const iconBtn =
    'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40';
  return (
    <div className="inline-flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
      {millPending && canWrite && !hideReceive ? (
        <DesktopWriteGate>
          <button
            type="button"
            className={`${iconBtn} text-emerald-700 border-emerald-200 hover:bg-emerald-50`}
            disabled={busyId === row.id}
            aria-label="Receive challan"
            onClick={(e) => onReceive(row, e)}
          >
            <Check size={14} />
          </button>
        </DesktopWriteGate>
      ) : (
        <button type="button" className={iconBtn} aria-label="View challan" onClick={(e) => onView(row, e)}>
          <Eye size={14} />
        </button>
      )}
    </div>
  );
}

function StatusCell({ row }: { row: MmInChallanHeader }) {
  const status = inboundOpsStatus(row);
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(status)}`} />
      <span className={`text-[10px] font-bold ${inboundStatusText(status)}`}>
        {inboundOpsStatusLabel(status)}
      </span>
    </span>
  );
}

export function MmInboundChallanTable({
  rows,
  variant,
  millOrigin = false,
}: {
  rows: MmInChallanHeader[];
  variant: 'mill' | 'vendor' | 'mixed' | 'preview' | 'testing';
  millOrigin?: boolean;
}) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const [busyId, setBusyId] = useState<string | null>(null);
  const testing = variant === 'testing';

  const open = (row: MmInChallanHeader) => {
    if (testing) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: row.id });
      return;
    }
    if (millOrigin && row.order_id && row.colorway_id && row.fabric_line_id) {
      requestNavigate(RoutePath.MATERIAL_MILL_CHALLAN, {
        orderId: row.order_id,
        colorwayId: row.colorway_id,
        fabricLineId: row.fabric_line_id,
        id: row.id,
      });
      return;
    }
    requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind: row.source, id: row.id });
  };

  const view = (row: MmInChallanHeader, e: React.MouseEvent) => {
    e.stopPropagation();
    open(row);
  };

  const receive = async (row: MmInChallanHeader, e: React.MouseEvent) => {
    e.stopPropagation();
    setBusyId(row.id);
    try {
      const res = await receiveMillChallanAsIs(row.id, row.row_version);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Received ${row.challan_no}`, 'success');
      await invalidate();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Receive failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (variant === 'preview') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] table-fixed border-collapse">
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '3.75rem' }} />
          </colgroup>
          <thead>
            <tr>
              <th className={previewTh}>Date</th>
              <th className={previewTh}>Challan</th>
              <th className={previewTh}>Challan ref</th>
              <th className={previewTh}>Style</th>
              <th className={previewTh}>Style ref</th>
              <th className={previewTh}>Buyer</th>
              <th className={previewTh}>Fabric</th>
              <th className={previewTh}>Category</th>
              <th className={previewTh}>Source</th>
              <th className={previewThQty}>Qty</th>
              <th className={previewThRolls}>Rolls / laps</th>
              <th className={previewThCenter}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/80 cursor-pointer" onClick={() => open(row)}>
                <td className={`${previewTd} whitespace-nowrap`}>{formatWhen(inboundWhen(row))}</td>
                <td className={`${previewTd} truncate font-semibold text-slate-800`}>{row.challan_no}</td>
                <td className={`${previewTd} truncate text-slate-500`}>{row.reference_no || '—'}</td>
                <td className={`${previewTd} truncate`}>{inboundStyleDisplayName(row)}</td>
                <td className={`${previewTd} truncate`}>{row.style_ref || '—'}</td>
                <td className={`${previewTd} truncate`}>{row.buyer_name || '—'}</td>
                <td className={`${previewTd} truncate`}>{fabricName(row)}</td>
                <td className={`${previewTd} truncate`}>{inboundFabricCategory(row)}</td>
                <td className={`${previewTd} truncate`}>{inboundSourceLabel(row)}</td>
                <td className={previewTdQty}>{formatQtyM(row.qty, row.uom)}</td>
                <td className={previewTdRolls}>{inboundRollBadge(row)}</td>
                <td className={`${previewTd} text-center`}>
                  <InboundActionCell row={row} busyId={busyId} hideReceive={millOrigin} onView={view} onReceive={(r, e) => void receive(r, e)} />
                </td>
              </tr>
            ))}
            <tr aria-hidden>
              <td colSpan={12} className="h-10 border-0 p-0" />
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className={`w-full table-fixed border-collapse ${testing ? 'min-w-[1280px]' : 'min-w-[1180px]'}`}>
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: testing ? '9%' : '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '14%' }} />
          {testing ? <col style={{ width: '7%' }} /> : null}
          {millOrigin ? <col style={{ width: '7%' }} /> : null}
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '3.75rem' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={thCls}>Date</th>
            <th className={thCls}>{testing ? 'GRN / Challan' : 'Challan'}</th>
            <th className={thCls}>Challan ref</th>
            <th className={thCls}>Style</th>
            <th className={thCls}>Buyer</th>
            <th className={thCls}>Color</th>
            <th className={thCls}>Fabric</th>
            {testing ? <th className={thCls}>Source</th> : null}
            {millOrigin ? <th className={thCenterCls}>Kind</th> : null}
            <th className={thRecvCls}>Received qty</th>
            <th className={thRecvCls}>Rolls / laps</th>
            <th className={thPassCls}>Passed qty</th>
            <th className={thPassCls}>Rolls / laps</th>
            <th className={thCenterCls}>Status</th>
            <th className={thCenterCls}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const category = inboundFabricCategory(row);
            return (
              <tr key={row.id} className="hover:bg-slate-50/80 cursor-pointer" onClick={() => open(row)}>
                <td className={`${tdCls} whitespace-nowrap text-slate-600`}>{formatWhen(inboundWhen(row))}</td>
                <td className={`${tdCls} min-w-0`}>
                  <TwoLine primary={row.challan_no} secondary={testing ? inboundDocKind(row) : null} />
                </td>
                <td className={`${tdCls} truncate text-slate-500`}>{row.reference_no || '—'}</td>
                <td className={`${tdCls} min-w-0`}>
                  <TwoLine primary={inboundStyleDisplayName(row)} secondary={row.style_ref} />
                </td>
                <td className={`${tdCls} truncate`}>{row.buyer_name || '—'}</td>
                <td className={`${tdCls} truncate`}>{row.color_name || '—'}</td>
                <td className={`${tdCls} min-w-0`}>
                  <TwoLine primary={fabricName(row)} secondary={category === '—' ? null : category} />
                </td>
                {testing ? <td className={`${tdCls} truncate`}>{inboundSourceLabel(row)}</td> : null}
                {millOrigin ? (
                  <td className={`${tdCls} text-center`}>
                    <span className={`text-[10px] font-semibold ${inboundIsStyleBound(row) ? 'text-slate-700' : 'text-amber-700'}`}>
                      {inboundStyleKindLabel(row)}
                    </span>
                  </td>
                ) : null}
                <td className={tdRecvCls}>
                  <span className="block text-[11px] font-semibold text-blue-900 tabular-nums">
                    {formatQtyM(row.qty, row.uom)}
                  </span>
                </td>
                <td className={tdRecvCls}>
                  <span className="block text-[11px] font-semibold text-blue-900 tabular-nums">{inboundRollBadge(row)}</span>
                </td>
                <td className={tdPassCls}>
                  <span className="block text-[11px] font-semibold text-emerald-900 tabular-nums">
                    {formatQtyM(row.passed_qty, row.uom)}
                  </span>
                </td>
                <td className={tdPassCls}>
                  <span className="block text-[11px] font-semibold text-emerald-900 tabular-nums">
                    {unitsLabel(inboundPassedRolls(row), row.unit_form)}
                  </span>
                </td>
                <td className={`${tdCls} text-center`}>
                  <StatusCell row={row} />
                </td>
                <td className={`${tdCls} text-center`}>
                  <InboundActionCell row={row} busyId={busyId} hideReceive={millOrigin} onView={view} onReceive={(r, e) => void receive(r, e)} />
                </td>
              </tr>
            );
          })}
          <tr aria-hidden>
            <td colSpan={(testing ? 1 : 0) + (millOrigin ? 1 : 0) + 13} className="h-10 border-0 p-0" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
