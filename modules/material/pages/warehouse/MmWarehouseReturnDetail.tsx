import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useNavigationStore } from '../../../../stores';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { mmGetSupplierReturn, type MmSupplierReturnDetail, type MmTestField } from '../../lib/mmRpc';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import type { MmChallanPrintDoc } from '../../lib/mmChallanPrint';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

function onlyOne(values: Array<string | null | undefined>): string {
  const names = [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0];
  return 'Several';
}

function printDocFor(
  row: MmSupplierReturnDetail,
  factory: { name?: string | null; code?: string | null } | null,
): MmChallanPrintDoc {
  const fields: MmTestField[] = [
    { id: 'qty', key: 'qty', label: 'Qty', data_type: 'number', options: null },
    { id: 'shade', key: 'shade', label: 'Shade', data_type: 'text', options: null },
    { id: 'lot', key: 'lot_no', label: 'Lot', data_type: 'text', options: null },
    { id: 'style', key: 'style_name', label: 'Style', data_type: 'text', options: null },
  ];
  return {
    kind: 'vendor',
    title: 'Supplier return',
    movement: 'Red label to supplier',
    factoryName: factory?.name ?? '',
    factoryCode: factory?.code ?? '',
    challanNo: row.return_no,
    referenceNo: row.debit_note_ref ?? '',
    sentAt: row.created_at,
    fromLocation: 'Red label',
    toLocation: row.supplier_name || 'Supplier',
    styleName: onlyOne(row.rolls.map((roll) => roll.style_name)),
    styleRef: onlyOne(row.rolls.map((roll) => roll.style_ref)),
    buyerName: onlyOne(row.rolls.map((roll) => roll.buyer_name)),
    poNumber: '',
    colorName: '—',
    fabricName: '—',
    fabricCategory: '',
    uom: row.rolls.find((roll) => roll.uom)?.uom ?? 'm',
    remarks: row.reason,
    fields,
    rolls: row.rolls.map((roll) => ({
      id: roll.id,
      unit_code: roll.unit_code,
      length_m: roll.qty,
      weight_kg: null,
      shade: roll.shade,
      lot_no: roll.lot_no,
      batch_no: null,
      attributes: { style_name: roll.style_name ?? '' },
      mill_snapshot: null,
    })),
  };
}

export default function MmWarehouseReturnDetail() {
  const id = useNavigationStore((s) => s.routeParams.id);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'supplierReturn', id ?? ''],
    queryFn: async (): Promise<MmSupplierReturnDetail> => {
      const res = await mmGetSupplierReturn(id as string);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });

  const row = query.data ?? null;
  const doc = useMemo(() => (row ? printDocFor(row, factory) : null), [row, factory]);
  const { requestPrint } = useMmChallanPrint(doc);

  usePageHeader({
    subtitle: row ? `${row.return_no} · ${row.supplier_name || 'Supplier'}` : 'Open a return from the list.',
  }, row?.id);

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
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-slate-900">{row.return_no}</p>
                <p className="text-[12px] text-slate-500 mt-1">{row.supplier_name || 'Supplier'}</p>
                <p className="text-[12px] text-slate-700 mt-2">{row.reason}</p>
                <p className="text-[11px] text-slate-400 mt-2">
                  {row.debit_note_ref ? `Ref ${row.debit_note_ref} · ` : ''}
                  {formatWhen(row.created_at)}
                  {' · '}
                  {row.roll_count} {row.roll_count === 1 ? 'roll' : 'rolls'}
                  {' · '}
                  {formatQtyM(row.qty, doc?.uom)}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>
                Print
              </Button>
            </div>
          </Card>
          <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr>
                    <th className={thCls}>Roll</th>
                    <th className={thCls}>Style</th>
                    <th className={thCls}>Shade</th>
                    <th className={thCls}>Lot</th>
                    <th className={thCls}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {row.rolls.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-[11px] text-slate-400">
                        No rolls on this return.
                      </td>
                    </tr>
                  ) : row.rolls.map((roll) => (
                    <tr key={roll.id}>
                      <td className={`${tdCls} font-semibold text-slate-800`}>{roll.unit_code}</td>
                      <td className={tdCls}>
                        <span className="block">{roll.style_name || 'Unallocated'}</span>
                        {roll.style_ref ? <span className="block text-[10px] text-slate-400">{roll.style_ref}</span> : null}
                      </td>
                      <td className={tdCls}>{roll.shade || '—'}</td>
                      <td className={tdCls}>{roll.lot_no || '—'}</td>
                      <td className={`${tdCls} tabular-nums`}>{formatQtyM(roll.qty, roll.uom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <MmChallanPrintDocument doc={doc} />
        </>
      ) : null}
    </PageShell>
  );
}
