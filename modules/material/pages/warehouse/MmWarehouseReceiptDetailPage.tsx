import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { rollIsRejected } from '../../components/MmRollDamageActions';
import { MmProcessSummaryChips, MmRollProcessMark, rollMatchesSummary, summaryKey } from '../../components/MmProcessStatus';
import { formatStoredQty, formatStoredWidth, isStoredWidthKey, useFabricUnits } from '../../lib/units';
import { colorMethodLabel } from '../../lib/fabricLabels';
import { dateLabel } from '../../lib/mmRollDraft';
import { qcCaptureOriginLabel } from '../../lib/qcTolerance';
import { finishedText, rollColour, rollStageLabel, specChip } from '../../lib/rollColour';
import {
  customReceiptFields,
  customRollFields,
  parseReceiptForm,
  receiptValueText,
} from '../../lib/receiptForm';
import {
  mmWhGetReceipt,
  type MmV4RollRow,
} from '../../lib/mmV4Rpc';

const th = 'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

function storedWidthInches(attributes: Record<string, unknown> | null | undefined): number | null {
  if (!attributes) return null;
  for (const key of ['width_in', 'actual_width_in', 'target_width_in']) {
    if (!isStoredWidthKey(key)) continue;
    const n = Number(attributes[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function styleRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function styleText(row: Record<string, unknown> | null, key: string): string {
  return String(row?.[key] ?? '').trim();
}

function purposeLabel(value: string): string {
  if (value === 'style') return 'Style specific';
  if (value === 'open_po') return 'Open';
  if (value === 'stock') return 'General';
  return value || '—';
}

function sourceLabel(value: string): string {
  if (value === 'internal') return 'Internal';
  if (value === 'external') return 'External';
  if (value === 'process_return') return 'Process return';
  return value || '—';
}

function statusWithOrigin(status: unknown, origin: string | null): string {
  const label = String(status ?? '').trim();
  if (!label || label === '—') return '—';
  const who = label.toUpperCase() === 'NONE' ? null : qcCaptureOriginLabel(origin);
  return who ? `${label} (${who})` : label;
}

function onHandQty(roll: MmV4RollRow): number {
  const status = roll.custody?.status;
  if ((status === 'in_stock' || status === 'on_hold') && roll.qty_available != null) {
    return Number(roll.qty_available) || 0;
  }
  if ((roll.uom ?? '').toLowerCase() === 'kg') return Number(roll.weight_kg ?? roll.length_m ?? 0) || 0;
  return Number(roll.length_m ?? roll.qty_available ?? 0) || 0;
}

function bookedOrAllocated(roll: MmV4RollRow): string {
  const style = roll.style && typeof roll.style === 'object'
    ? String(roll.style.style_name ?? roll.style.fabric_line ?? '').trim()
    : '';
  if (style) return `Allocated · ${style}`;
  if (roll.booked_style || roll.booked_style_material_id) return `Booked · ${roll.booked_style || 'style'}`;
  return '—';
}

function locationText(roll: MmV4RollRow): string {
  return roll.location?.code || roll.location?.name || '—';
}

export default function MmWarehouseReceiptDetailPage() {
  const id = useNavigationStore((s) => s.routeParams.id ?? '');
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [processKey, setProcessKey] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'whReceipt', id] as const,
    queryFn: async () => {
      const res = await mmWhGetReceipt(id);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });

  const receipt = detailQ.data?.receipt;
  const rolls = detailQ.data?.rolls ?? [];
  const processSummary = detailQ.data?.process_summary ?? receipt?.process_summary ?? [];
  const activeSummary = processSummary.find((item) => summaryKey(item) === processKey) ?? null;
  const shownRolls = useMemo(
    () => rolls.filter((roll) => rollMatchesSummary(roll.process_status, activeSummary)),
    [rolls, activeSummary],
  );

  useEffect(() => {
    setProcessKey(null);
  }, [id]);
  const units = useFabricUnits({
    qty_unit: rolls[0]?.qty_unit ?? receipt?.fabric?.qty_unit,
    width_unit: rolls[0]?.width_unit ?? receipt?.fabric?.width_unit,
    uom: rolls[0]?.uom ?? receipt?.fabric?.uom ?? receipt?.uom,
  });
  usePageHeader({
    title: 'Receipt information',
    subtitle: 'Rolls on this receipt.',
  });

  const fabric = receipt?.fabric;
  const style = styleRecord(receipt?.style);
  const fabricTypeName = rolls.find((roll) => roll.fabric_type_name)?.fabric_type_name || styleText(style, 'fabric_type_name');
  const orderId = styleText(style, 'order_id');
  const fromName = receipt?.from?.name || '—';
  const processChallan = detailQ.data?.process_challan;
  const form = parseReceiptForm(detailQ.data?.form);
  const receiptExtras = customReceiptFields(form).flatMap((field) => {
    const text = receiptValueText(receipt?.field_values?.[field.key]);
    return text ? [{ key: field.key, label: field.label, value: text }] : [];
  });
  const rollExtras = customRollFields(form);
  const colSpan = 14 + rollExtras.length;
  const styleName = styleText(style, 'style_name') || styleText(style, 'style_ref');
  const colourway = styleText(style, 'colorway_name');
  const buyer = styleText(style, 'buyer_name');
  const poNumber = styleText(style, 'po_number');
  const fabricLine = styleText(style, 'fabric_line');

  return (
    <PageShell
      loading={detailQ.isLoading}
      error={detailQ.error}
      onRetry={() => { void detailQ.refetch(); }}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3 items-stretch">
        <InfoCard title="Receipt information" kicker={String(receipt?.grn_no || receipt?.challan_no || '')}>
          <Fact label="Source" value={sourceLabel(String(receipt?.source ?? ''))} />
          <Fact label="From" value={fromName} />
          <Fact label="Received" value={dateLabel(receipt?.received_at)} />
          <Fact label="Purpose" value={purposeLabel(String(receipt?.purpose ?? ''))} />
          {receipt?.party_challan_no ? <Fact label="Challan / Invoice" value={String(receipt.party_challan_no)} /> : null}
          {receipt?.po_no ? <Fact label="Reference no" value={String(receipt.po_no)} /> : null}
          {processChallan?.no ? (
            <Fact
              label="Process challan"
              value={processChallan.no}
              onOpen={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, { id: String(processChallan.id) })}
            />
          ) : null}
          {processChallan?.process ? <Fact label="Process" value={processChallan.process} /> : null}
          {receiptExtras.map((field) => (
            <Fact key={field.key} label={field.label} value={field.value} />
          ))}
          {receipt?.remarks ? (
            <div className="col-span-2 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Remarks</p>
              <p className="text-[11px] font-semibold text-slate-900">{String(receipt.remarks)}</p>
            </div>
          ) : null}
        </InfoCard>
        <InfoCard title="Fabric information" kicker={fabric?.code || ''}>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Name</p>
            <p className="text-[12px] font-semibold text-slate-900 truncate">{fabric?.name || '—'}</p>
            <p className="text-[11px] text-slate-500 truncate">{fabricTypeName || '—'}</p>
          </div>
          <Fact label="Stage" value={String(receipt?.stage_label || receipt?.stage_code || '—')} />
          <Fact label="Colour" value={String(receipt?.color || receipt?.color_ref || '—')} />
          {fabric?.color_method ? <Fact label="Colour method" value={colorMethodLabel(fabric.color_method) || '—'} /> : null}
        </InfoCard>
        <InfoCard title="Style link" kicker={styleName ? 'Linked' : 'Not linked'}>
          {styleName ? (
            <>
              <Fact
                label="Style"
                value={styleName}
                onOpen={orderId ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId }) : undefined}
              />
              {colourway ? <Fact label="Colourway" value={colourway} /> : null}
              {fabricLine ? <Fact label="Fabric line" value={fabricLine} /> : null}
              {buyer ? <Fact label="Buyer" value={buyer} /> : null}
              {poNumber ? <Fact label="PO" value={poNumber} /> : null}
            </>
          ) : (
            <>
              <p className="col-span-2 text-[11px] text-slate-500">
                {receipt?.purpose === 'open_po'
                  ? 'Open receipt. No style is linked yet.'
                  : 'General stock. This receipt is not linked to a style.'}
              </p>
              {receipt?.customer_name ? <Fact label="Customer" value={String(receipt.customer_name)} /> : null}
              {receipt?.po_ref ? <Fact label="PO ref" value={String(receipt.po_ref)} /> : null}
            </>
          )}
        </InfoCard>
      </div>

      {processSummary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <MmProcessSummaryChips
            items={processSummary}
            activeKey={processKey}
            onPick={(key) => setProcessKey((current) => (current === key ? null : key))}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!id}
          onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id, kind: 'in_challan' })}
        >
          Testing
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!id}
          onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id, kind: 'in_challan', mode: 'inspection' })}
        >
          Inspection
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <p className="text-[11px] font-semibold text-slate-700">Rolls on this receipt</p>
          <p className="text-[10px] text-slate-400 mt-0.5">What arrived on this receipt.</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1200px] border-collapse">
            <thead>
              <tr>
                <th className={th}>Roll</th>
                <th className={th}>Qty</th>
                <th className={th}>Kg</th>
                <th className={th}>Width</th>
                <th className={th}>Shade</th>
                <th className={th}>Colour</th>
                <th className={th}>Dye lot</th>
                <th className={th}>Stage</th>
                <th className={th}>Finished</th>
                <th className={th}>Test</th>
                <th className={th}>Inspection</th>
                <th className={th}>Spec</th>
                <th className={th}>Booked / Allocated</th>
                <th className={th}>Location</th>
                {rollExtras.map((field) => (
                  <th key={field.key} className={th}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRolls.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-[11px] text-slate-400">No rolls on this receipt.</td>
                </tr>
              ) : shownRolls.map((roll) => {
                const mark = finishedText(roll.finished);
                const spec = specChip(roll.spec, units.widthUnit);
                const widthInches = storedWidthInches(roll.attributes);
                const width = formatStoredWidth(widthInches, units.widthUnit);
                return (
                  <tr key={roll.roll_id}>
                    <td className={`${td} font-semibold`}>
                      {roll.roll_code}
                      {rollIsRejected(roll) ? <span className="ml-2 text-[10px] font-semibold text-red-700">Rejected</span> : null}
                    </td>
                    <td className={td}>{formatStoredQty(onHandQty(roll), roll.qty_unit ?? units.qtyUnit)}</td>
                    <td className={td}>{roll.weight_kg != null ? String(roll.weight_kg) : '—'}</td>
                    <td className={td}>{width}</td>
                    <td className={td}>{roll.shade || '—'}</td>
                    <td className={td}>{rollColour(roll)}</td>
                    <td className={td}>{roll.dye_lot || '—'}</td>
                    <td className={td}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span>{rollStageLabel(roll)}</span>
                        <MmRollProcessMark status={roll.process_status} />
                      </span>
                    </td>
                    <td className={td}><span className={mark.className}>{mark.text}</span></td>
                    <td className={td}>{statusWithOrigin(roll.test_status, roll.last_test?.origin)}</td>
                    <td className={td}>{String(roll.inspection_status ?? '').trim() || '—'}</td>
                    <td className={td}>{spec ? <span className={spec.className}>{spec.text}</span> : '—'}</td>
                    <td className={td}>{bookedOrAllocated(roll)}</td>
                    <td className={td}>{locationText(roll)}</td>
                    {rollExtras.map((field) => (
                      <td key={field.key} className={td}>{receiptValueText(roll.attributes?.[field.key]) ?? '—'}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </PageShell>
  );
}

function InfoCard({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <Card className="shadow-sm border-slate-200 overflow-hidden h-full" noPadding>
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        {kicker ? <h2 className="text-[12px] font-semibold text-slate-900 truncate">{kicker}</h2> : null}
      </div>
      <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </Card>
  );
}

function Fact({ label, value, onOpen }: { label: string; value: string; onOpen?: () => void }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="text-[11px] font-semibold text-blue-700 truncate hover:underline">
          {value || '—'}
        </button>
      ) : (
        <p className="text-[11px] font-semibold text-slate-900 truncate">{value || '—'}</p>
      )}
    </div>
  );
}
