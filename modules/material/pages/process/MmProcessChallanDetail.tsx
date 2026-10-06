import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import {
  mmGetProcessChallan,
  mmReceiveProcessReturn,
  type MmProcessChallanDetail,
  type MmProcessOutLine,
  type MmTestField,
} from '../../lib/mmRpc';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { MmFourPointInspectPanel } from '../../components/MmFourPointInspectPanel';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import type { MmChallanPrintDoc } from '../../lib/mmChallanPrint';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const inputCls = 'text-xs border border-slate-200 rounded px-2 py-1 w-full';

type ChildDraft = { code: string; qty: string; shade: string; color: string; lot: string };
type LineDraft = {
  mode: 'out' | 'same' | 'new';
  qty: string;
  shade: string;
  color: string;
  lot: string;
  children: ChildDraft[];
};

function blankChild(line: MmProcessOutLine): ChildDraft {
  return { code: '', qty: String(line.qty ?? ''), shade: line.shade ?? '', color: line.color_ref ?? '', lot: line.lot_no ?? '' };
}

function draftsFor(row: MmProcessChallanDetail): Record<string, LineDraft> {
  const next: Record<string, LineDraft> = {};
  for (const line of row.out) {
    if (line.line_status !== 'out') continue;
    next[line.id] = {
      mode: 'out',
      qty: String(line.qty ?? ''),
      shade: line.shade ?? '',
      color: line.color_ref ?? '',
      lot: line.lot_no ?? '',
      children: [blankChild(line)],
    };
  }
  return next;
}

function lineLabel(status: MmProcessOutLine['line_status']): string {
  if (status === 'returned') return 'Same roll back';
  if (status === 'replaced') return 'Re-rolled';
  return 'Still out';
}

export default function MmProcessChallanDetail() {
  const id = useNavigationStore((s) => s.routeParams.id);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const queryClient = useQueryClient();
  const { factory } = useFactoryProfileCatalog(factoryId);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'processChallan', id ?? ''],
    queryFn: async (): Promise<MmProcessChallanDetail> => {
      const res = await mmGetProcessChallan(id as string);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });

  const row = query.data ?? null;
  const openDrafts = row ? drafts : {};

  const doc = useMemo<MmChallanPrintDoc | null>(() => {
    if (!row) return null;
    const fields: MmTestField[] = [
      { id: 'qty', key: 'qty', label: 'Qty', data_type: 'number', options: null },
      { id: 'shade', key: 'shade', label: 'Shade', data_type: 'text', options: null },
      { id: 'color', key: 'color_ref', label: 'Color', data_type: 'text', options: null },
      { id: 'lot', key: 'lot_no', label: 'Lot', data_type: 'text', options: null },
    ];
    const source = row.back.length > 0 ? row.back : row.out;
    return {
      kind: 'vendor',
      title: 'Process challan',
      movement: row.origin === 'mill' ? 'Mill to process' : 'Warehouse to process',
      factoryName: factory?.name ?? '',
      factoryCode: factory?.code ?? '',
      challanNo: row.challan_no,
      referenceNo: row.process_name,
      sentAt: row.created_at,
      fromLocation: row.origin === 'mill' ? 'Mill' : 'Warehouse',
      toLocation: row.vendor_name,
      styleName: '—',
      styleRef: '',
      buyerName: '',
      poNumber: '',
      colorName: '—',
      fabricName: row.process_name,
      fabricCategory: '',
      uom: source[0]?.uom ?? 'm',
      remarks: row.remarks ?? '',
      fields,
      rolls: source.map((roll) => ({
        id: roll.id,
        unit_code: roll.unit_code,
        length_m: roll.qty,
        weight_kg: null,
        shade: roll.shade,
        lot_no: roll.lot_no,
        batch_no: null,
        attributes: { color_ref: roll.color_ref ?? '' },
        mill_snapshot: null,
      })),
    };
  }, [row, factory]);
  const { requestPrint } = useMmChallanPrint(doc);

  usePageHeader({
    subtitle: row ? `${row.challan_no} · ${row.vendor_name} · ${row.process_name}` : 'Open a challan from the list.',
  }, row?.id);

  const patch = (lineId: string, next: Partial<LineDraft>) => {
    setDrafts((current) => {
      const base = current[lineId] ?? (row ? draftsFor(row)[lineId] : undefined);
      if (!base) return current;
      return { ...current, [lineId]: { ...base, ...next } };
    });
  };

  const saveReturn = async () => {
    if (!row) return;
    const rolls: Array<{
      source_line_id: string;
      same: boolean;
      unit_code?: string;
      qty: number;
      shade?: string;
      color_ref?: string;
      lot_no?: string;
    }> = [];
    for (const line of row.out) {
      if (line.line_status !== 'out') continue;
      const draft = drafts[line.id] ?? draftsFor(row)[line.id];
      if (!draft || draft.mode === 'out') continue;
      if (draft.mode === 'same') {
        const qty = Number(draft.qty);
        if (!Number.isFinite(qty) || qty <= 0) {
          showNotification(`Enter a qty for ${line.unit_code}`, 'error');
          return;
        }
        rolls.push({
          source_line_id: line.id,
          same: true,
          qty,
          shade: draft.shade.trim(),
          color_ref: draft.color.trim(),
          lot_no: draft.lot.trim(),
        });
      } else {
        const children = draft.children.filter((child) => child.code.trim() || child.qty.trim());
        if (children.length === 0) {
          showNotification(`Add the new rolls for ${line.unit_code}`, 'error');
          return;
        }
        for (const child of children) {
          const qty = Number(child.qty);
          if (!child.code.trim() || !Number.isFinite(qty) || qty <= 0) {
            showNotification(`Each new roll from ${line.unit_code} needs a number and a qty`, 'error');
            return;
          }
          rolls.push({
            source_line_id: line.id,
            same: false,
            unit_code: child.code.trim(),
            qty,
            shade: child.shade.trim(),
            color_ref: child.color.trim(),
            lot_no: child.lot.trim(),
          });
        }
      }
    }
    if (rolls.length === 0) {
      showNotification('Mark the rolls that came back', 'error');
      return;
    }
    setBusy(true);
    const res = await mmReceiveProcessReturn(row.id, rolls);
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification('Return saved', 'success');
    setDrafts({});
    await query.refetch();
    await queryClient.invalidateQueries({ queryKey: ['mm', factoryId ?? '', 'ops', 'processChallans'] });
  };

  const shownDraft = (line: MmProcessOutLine): LineDraft => drafts[line.id] ?? (row ? draftsFor(row)[line.id] : {
    mode: 'out', qty: '', shade: '', color: '', lot: '', children: [],
  });

  return (
    <PageShell
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton="card"
      className="w-full pb-20"
    >
      {row ? (
        <>
          <Card className="shadow-sm border-slate-200 mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-bold text-slate-900">{row.challan_no}</p>
                <p className="text-[12px] text-slate-500 mt-1">
                  {row.origin === 'mill' ? 'Mill' : 'Warehouse'} to {row.vendor_name} · {row.process_name}
                </p>
                <p className="text-[11px] text-slate-400 mt-2">
                  {formatWhen(row.created_at)}
                  {row.remarks ? ` · ${row.remarks}` : ''}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>Print</Button>
            </div>
          </Card>
          <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl mb-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse">
                <thead>
                  <tr>
                    <th className={thCls}>Sent roll</th>
                    <th className={thCls}>Style</th>
                    <th className={thCls}>Qty</th>
                    <th className={thCls}>State</th>
                    <th className={thCls}>Back as</th>
                  </tr>
                </thead>
                <tbody>
                  {row.out.map((line) => {
                    const draft = shownDraft(line);
                    return (
                      <tr key={line.id}>
                        <td className={`${tdCls} font-semibold text-slate-800`}>{line.unit_code}</td>
                        <td className={tdCls}>{line.style_name || 'General PO'}</td>
                        <td className={`${tdCls} tabular-nums`}>{formatQtyM(line.qty, line.uom)}</td>
                        <td className={tdCls}>{lineLabel(line.line_status)}</td>
                        <td className={tdCls}>
                          {line.line_status === 'out' ? (
                            <select
                              className={inputCls}
                              value={draft.mode}
                              onChange={(event) => patch(line.id, { mode: event.target.value as LineDraft['mode'] })}
                            >
                              <option value="out">Still out</option>
                              <option value="same">Same roll</option>
                              <option value="new">New rolls</option>
                            </select>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {row.out.some((line) => line.line_status === 'out' && shownDraft(line).mode !== 'out') ? (
            <Card className="shadow-sm border-slate-200 mb-4">
              <div className="flex flex-col gap-4">
                {row.out.filter((line) => line.line_status === 'out' && shownDraft(line).mode !== 'out').map((line) => {
                  const draft = shownDraft(line);
                  return (
                    <div key={line.id} className="border border-slate-100 rounded-lg p-3">
                      <p className="text-[12px] font-semibold text-slate-800 mb-2">{line.unit_code}</p>
                      {draft.mode === 'same' ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input className={inputCls} placeholder="Qty" value={draft.qty} onChange={(event) => patch(line.id, { qty: event.target.value })} />
                          <input className={inputCls} placeholder="Shade" value={draft.shade} onChange={(event) => patch(line.id, { shade: event.target.value })} />
                          <input className={inputCls} placeholder="Color" value={draft.color} onChange={(event) => patch(line.id, { color: event.target.value })} />
                          <input className={inputCls} placeholder="Lot" value={draft.lot} onChange={(event) => patch(line.id, { lot: event.target.value })} />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {draft.children.map((child, index) => (
                            <div key={`${line.id}-${index}`} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                              <input className={inputCls} placeholder="New roll no" value={child.code} onChange={(event) => {
                                const children = draft.children.slice();
                                children[index] = { ...child, code: event.target.value };
                                patch(line.id, { children });
                              }} />
                              <input className={inputCls} placeholder="Qty" value={child.qty} onChange={(event) => {
                                const children = draft.children.slice();
                                children[index] = { ...child, qty: event.target.value };
                                patch(line.id, { children });
                              }} />
                              <input className={inputCls} placeholder="Shade" value={child.shade} onChange={(event) => {
                                const children = draft.children.slice();
                                children[index] = { ...child, shade: event.target.value };
                                patch(line.id, { children });
                              }} />
                              <input className={inputCls} placeholder="Color" value={child.color} onChange={(event) => {
                                const children = draft.children.slice();
                                children[index] = { ...child, color: event.target.value };
                                patch(line.id, { children });
                              }} />
                              <input className={inputCls} placeholder="Lot" value={child.lot} onChange={(event) => {
                                const children = draft.children.slice();
                                children[index] = { ...child, lot: event.target.value };
                                patch(line.id, { children });
                              }} />
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-[11px] font-medium text-blue-700 text-left"
                            onClick={() => patch(line.id, { children: [...draft.children, blankChild(line)] })}
                          >
                            Add roll
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-end">
                  <Button type="button" size="sm" disabled={busy} onClick={() => void saveReturn()}>
                    {busy ? 'Saving…' : 'Save return'}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
          {row.back.length > 0 ? (
            <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
              <div className="px-4 py-2 border-b border-slate-100 text-[11px] font-semibold text-slate-700">Came back</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Roll</th>
                      <th className={thCls}>Qty</th>
                      <th className={thCls}>Shade</th>
                      <th className={thCls}>Color</th>
                      <th className={thCls}>Lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.back.map((roll) => (
                      <tr key={roll.id}>
                        <td className={`${tdCls} font-semibold`}>{roll.unit_code}{roll.same_identity ? '' : ' · new'}</td>
                        <td className={`${tdCls} tabular-nums`}>{formatQtyM(roll.qty, roll.uom)}</td>
                        <td className={tdCls}>{roll.shade || '—'}</td>
                        <td className={tdCls}>{roll.color_ref || '—'}</td>
                        <td className={tdCls}>{roll.lot_no || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          {row.back.length > 0 ? (
            <MmFourPointInspectPanel
              scopeKind="process_challan"
              scopeId={row.id}
              uom={row.back[0]?.uom ?? 'm'}
              rolls={row.back
                .map((roll) => ({
                  id: (row.origin === 'mill' ? roll.mill_roll_id : roll.stock_unit_id) ?? '',
                  unit_code: roll.unit_code,
                  qty: roll.qty,
                  shade: roll.shade,
                  qc_result: roll.qc_result,
                }))
                .filter((roll) => Boolean(roll.id))}
              subtitle={
                row.origin === 'mill'
                  ? 'Optional. 4-point these mill rolls after process, or inspect later at warehouse receive.'
                  : 'Optional. 4-point these warehouse rolls after process. A previous inbound 4-point does not count.'
              }
              onSaved={async () => {
                await query.refetch();
              }}
            />
          ) : null}
          <MmChallanPrintDocument doc={doc} />
        </>
      ) : null}
    </PageShell>
  );
}
