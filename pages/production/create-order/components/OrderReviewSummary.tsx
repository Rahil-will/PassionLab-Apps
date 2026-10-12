import React, { useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { WIDTH_FORM_LABELS, colorMethodLabel, uomLabel } from '../../../../modules/material/lib/fabricLabels';
import { materialMarkupFactor, materialRequiredQty } from '../../../../lib/colorwayMaterialsDb';
import { planLineConsForColour } from '../../../../lib/materialPlan';
import { sizeAdjQty, sizeOrderQty, sumSizeAdjQty, sumSizeOrderQty } from '../../../../lib/colorwaySizesUtils';
import { swatchStyleFromColorName } from '../../../../lib/colorNameSwatch';
import {
  planBalanceTotal,
  planTotalQty,
  primaryShipmentDate,
  isActiveShipmentLine,
  expandShipmentPlanLines,
  rowTotal,
} from '../../../../lib/orderShipmentPlan';
import { formatDateDDMMYYYY } from '../../../../lib/orderDateUtils';
import { ORDER_TYPE_LABELS } from '../../../../types';
import type { Colorway, SizeQty } from '../../../../types';
import type { MaterialPlanLine } from '../../../../lib/materialPlan';
import type { OrderShipmentPlan, ShipmentPlanLine } from '../../../../lib/orderShipmentPlan';
import type { HeaderState } from '../hooks/useHeaderReducer';

interface OrderReviewSummaryProps {
  header: HeaderState;
  buyerName: string;
  colorways: Colorway[];
  materialPlan: MaterialPlanLine[];
  shipmentPlan: OrderShipmentPlan;
  displaySizes: string[];
  totalAllowancePct: number;
  buyerExtraPct: number;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const text = value == null || value === '' ? '—' : value;
  const empty = text === '—';
  return (
    <div className="min-w-0">
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-400 leading-none">{label}</p>
      <p className={`text-[11px] font-semibold truncate leading-tight mt-0.5 ${empty ? 'text-slate-300' : 'text-slate-800'}`}>{text}</p>
    </div>
  );
}

function ReviewImage({ src, alt, compact = false }: { src: string; alt: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src.trim() || failed) {
    return (
      <div className={`absolute inset-0 flex flex-col items-center justify-center text-slate-300 ${compact ? '' : 'gap-2'}`}>
        <ImageOff size={compact ? 14 : 22} />
        {compact ? null : <span className="text-[9px] font-bold uppercase tracking-wide">No image</span>}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function qtyFor(sizes: SizeQty[], size: string): { order: number; adj: number } {
  const row = sizes.find((s) => s.size === size);
  if (!row) return { order: 0, adj: 0 };
  return { order: sizeOrderQty(row), adj: sizeAdjQty(row) };
}

function QtyCells({ order, adj, selected }: { order: number; adj: number; selected?: boolean }) {
  const bg = selected ? 'bg-blue-50' : '';
  return (
    <>
      <td className={`px-2 py-1.5 text-right tabular-nums text-slate-800 ${bg}`}>{order.toLocaleString()}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums font-semibold text-blue-800 ${bg}`}>{adj.toLocaleString()}</td>
    </>
  );
}

export const OrderReviewSummary: React.FC<OrderReviewSummaryProps> = ({
  header,
  buyerName,
  colorways,
  materialPlan,
  shipmentPlan,
  displaySizes,
}) => {
  const pairWidth = 84 / ((colorways.length + 1) * 2);
  const orderTotal = colorways.reduce((s, c) => s + sumSizeOrderQty(c.sizes), 0);
  const adjTotal = colorways.reduce((s, c) => s + sumSizeAdjQty(c.sizes), 0);
  const shipTotal = planTotalQty(shipmentPlan);
  const shipBalance = planBalanceTotal(shipmentPlan, colorways, displaySizes);
  const fabrics = materialPlan.filter((p) => p.kind === 'Fabric');
  const trims = materialPlan.filter((p) => p.kind === 'Trim');

  const sizeColumns = useMemo(() => {
    if (displaySizes.length > 0) return displaySizes;
    return [...new Set(colorways.flatMap((c) => c.sizes.map((s) => s.size)))];
  }, [colorways, displaySizes]);

  const sizeTotals = useMemo(() => {
    const totals: Record<string, { order: number; adj: number }> = {};
    for (const size of sizeColumns) totals[size] = { order: 0, adj: 0 };
    for (const cw of colorways) {
      for (const size of sizeColumns) {
        const qty = qtyFor(cw.sizes, size);
        totals[size].order += qty.order;
        totals[size].adj += qty.adj;
      }
    }
    return totals;
  }, [colorways, sizeColumns]);

  const shipmentLines = useMemo(
    () => expandShipmentPlanLines(shipmentPlan.lines),
    [shipmentPlan.lines],
  );
  const activeLines = shipmentLines.filter(isActiveShipmentLine);
  const [selectedColourId, setSelectedColourId] = useState<string | null>(null);
  const selectedColour = colorways.find((cw) => cw.id === selectedColourId) ?? null;
  const visibleShipments = selectedColourId
    ? activeLines.filter((line) => line.colorwayId === selectedColourId)
    : activeLines;
  const shownShipQty = visibleShipments.reduce((sum, line) => sum + rowTotal(line), 0);

  const primaryShip = primaryShipmentDate(shipmentPlan);

  function toggleColour(id: string) {
    setSelectedColourId((current) => (current === id ? null : id));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3 items-stretch">
      <Panel title="Style">
        <div className="grid grid-cols-1 sm:grid-cols-[7.5rem_1fr] h-full">
          <div className="relative bg-slate-50 min-h-[8.5rem] sm:min-h-full border-b sm:border-b-0 sm:border-r border-slate-100 overflow-hidden">
            <ReviewImage src={header.styleImage} alt={header.styleName || 'Style'} />
          </div>
          <div className="min-w-0 flex flex-col">
            <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-2">
              <Field label="Buyer" value={buyerName} />
              <Field label="Style" value={header.styleName} />
              <Field label="Style ref" value={header.styleRef} />
              <Field label="PO" value={header.poNumber} />
              <Field label="Type" value={ORDER_TYPE_LABELS[header.orderType]} />
              <Field label="Season" value={header.season} />
              <Field label="Garment" value={header.garmentType} />
              <Field label="Priority" value={header.priority ? header.priority.charAt(0).toUpperCase() + header.priority.slice(1) : ''} />
              <Field label="Merchant" value={header.merchantName} />
              <Field label="Size group" value={header.snapshottedGroupName || header.sizeGroupSelection} />
            </div>
            <p className={`px-3 pb-2 mt-auto text-[11px] leading-snug line-clamp-2 ${header.remarks.trim() ? 'text-slate-600' : 'text-slate-300'}`}>
              {header.remarks.trim() || 'No remarks'}
            </p>
          </div>
        </div>
      </Panel>

      <div className="min-w-0 min-h-[8.5rem] h-full flex flex-col">
      <Panel title="Colours & quantities" hint={selectedColour ? `Showing ${selectedColour.name || 'colour'}` : 'Click a colour to filter requirements and shipments'}>
        {colorways.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-slate-400 italic">No colours added</p>
        ) : (
          <div className="overflow-auto flex-1 basis-0 min-h-0">
            <table className="w-full h-full min-h-full table-fixed text-[11px]">
              <colgroup>
                <col style={{ width: '16%' }} />
                {colorways.map((cw) => (
                  <React.Fragment key={cw.id}>
                    <col style={{ width: `${pairWidth}%` }} />
                    <col style={{ width: `${pairWidth}%` }} />
                  </React.Fragment>
                ))}
                <col style={{ width: `${pairWidth}%` }} />
                <col style={{ width: `${pairWidth}%` }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 text-[9px] uppercase text-slate-500">
                  <th rowSpan={2} className="px-3 py-1.5 text-left sticky top-0 left-0 z-20 bg-slate-50 align-bottom">Size</th>
                  {colorways.map((cw) => {
                    const selected = cw.id === selectedColourId;
                    return (
                      <th
                        key={cw.id}
                        colSpan={2}
                        className={`px-2 py-1.5 text-center sticky top-0 cursor-pointer ${selected ? 'bg-blue-100 text-blue-900' : 'bg-slate-50'}`}
                        onClick={() => toggleColour(cw.id)}
                      >
                        <span className="inline-flex items-center justify-center gap-1.5 max-w-full">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-slate-200 shrink-0"
                            style={swatchStyleFromColorName(cw.name || '')}
                          />
                          <span className="truncate normal-case font-semibold text-[11px]">{cw.name || 'Untitled'}</span>
                        </span>
                      </th>
                    );
                  })}
                  <th colSpan={2} className="px-2 py-1.5 text-center sticky top-0 bg-slate-100">Total</th>
                </tr>
                <tr className="bg-slate-50 text-[9px] uppercase text-slate-500">
                  {colorways.map((cw) => {
                    const selected = cw.id === selectedColourId;
                    const head = selected ? 'bg-blue-50 text-blue-800' : 'bg-slate-50';
                    return (
                      <React.Fragment key={cw.id}>
                        <th className={`px-2 py-1 text-right sticky top-7 ${head}`}>Order</th>
                        <th className={`px-2 py-1 text-right sticky top-7 ${head}`}>Adj</th>
                      </React.Fragment>
                    );
                  })}
                  <th className="px-2 py-1 text-right sticky top-7 bg-slate-100">Order</th>
                  <th className="px-2 py-1 text-right sticky top-7 bg-slate-100">Adj</th>
                </tr>
              </thead>
              <tbody>
                {sizeColumns.map((size) => (
                  <tr key={size} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 sticky left-0 bg-white font-medium text-slate-800">{size}</td>
                    {colorways.map((cw) => {
                      const qty = qtyFor(cw.sizes, size);
                      return <QtyCells key={cw.id} order={qty.order} adj={qty.adj} selected={cw.id === selectedColourId} />;
                    })}
                    <QtyCells order={sizeTotals[size]?.order ?? 0} adj={sizeTotals[size]?.adj ?? 0} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                  <td className="px-3 py-1.5 sticky left-0 bg-slate-50">Total</td>
                  {colorways.map((cw) => (
                    <QtyCells
                      key={cw.id}
                      order={sumSizeOrderQty(cw.sizes)}
                      adj={sumSizeAdjQty(cw.sizes)}
                      selected={cw.id === selectedColourId}
                    />
                  ))}
                  <td className="px-2 py-1.5 text-right tabular-nums">{orderTotal.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-blue-800">{adjTotal.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
      </div>
      </div>

      <MaterialKindTable
        title="Fabric requirements"
        lines={fabrics}
        colorways={colorways}
        selectedColourId={selectedColourId}
        empty="No fabrics"
      />
      <MaterialKindTable
        title="Trim requirements"
        lines={trims}
        colorways={colorways}
        selectedColourId={selectedColourId}
        empty="No trims"
      />

      <Panel
        title="Shipment plan"
        hint={
          selectedColour
            ? `Shipments for ${selectedColour.name || 'colour'}`
            : primaryShip
              ? `Primary ${formatDateDDMMYYYY(primaryShip)}`
              : 'No primary date'
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-[9px] uppercase text-slate-500">
                <th className="px-2.5 py-1.5 text-left">Date</th>
                <th className="px-2 py-1.5 text-left">Colour</th>
                <th className="px-2 py-1.5 text-left">Mode</th>
                <th className="px-2 py-1.5 text-left">Type</th>
                <th className="px-2 py-1.5 text-left">Destination</th>
                {sizeColumns.map((size) => (
                  <th key={size} className="px-1.5 py-1.5 text-right whitespace-nowrap">{size}</th>
                ))}
                <th className="px-2.5 py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleShipments.length === 0 ? (
                <tr>
                  <td colSpan={6 + sizeColumns.length} className="px-2.5 py-3 text-[11px] text-slate-400 italic">
                    {selectedColourId ? 'No shipment lines for this colour' : 'No shipment dates set'}
                  </td>
                </tr>
              ) : (
                visibleShipments.map((line) => (
                  <ShipmentRow key={line.id} line={line} colorways={colorways} sizeColumns={sizeColumns} />
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-2.5 py-1.5 text-slate-500" colSpan={5 + sizeColumns.length}>
                  {selectedColourId ? 'Shown' : 'Plan total'}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-900">
                  {(selectedColourId ? shownShipQty : shipTotal).toLocaleString()}
                </td>
              </tr>
              <tr className="bg-amber-50/70 font-semibold">
                <td className="px-2.5 py-1.5 text-amber-700" colSpan={5 + sizeColumns.length}>Balance</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-amber-900">{shipBalance.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  );
};

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm min-w-0 overflow-hidden h-full flex flex-col">
      <div className="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50/70 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold text-slate-900">{title}</h3>
        {hint ? <span className="text-[9px] text-slate-400 truncate">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function pctLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${fmtQty(n)}%`;
}

function fabricSpec(line: MaterialPlanLine): { primary: string; secondary: string } {
  const fabric = line.fabric;
  const primary = [
    fabric?.fabric_type?.name,
    fabric?.construction?.name,
    fabric?.composition_text,
    line.fabricCategory,
  ].filter(Boolean).join(' · ');
  const secondary = [
    fabric?.gsm ? `${fabric.gsm} GSM` : null,
    fabric?.width_in
      ? `${fabric.width_in} in${fabric.width_form ? ` ${WIDTH_FORM_LABELS[fabric.width_form] ?? fabric.width_form}` : ''}`
      : null,
    fabric?.color_method ? colorMethodLabel(fabric.color_method) : null,
    fabric?.design_ref ? `Ref ${fabric.design_ref}` : null,
    line.processLossPct != null && line.processLossPct > 0 ? `Loss ${line.processLossPct}%` : null,
    line.wastagePct != null && line.wastagePct > 0 ? `Waste ${line.wastagePct}%` : null,
  ].filter(Boolean).join(' · ');
  return { primary: primary || '—', secondary };
}

function trimSpec(line: MaterialPlanLine): { primary: string; secondary: string } {
  const primary = [line.trimCategory, line.trimType].filter(Boolean).join(' · ') || '—';
  const secondary = [
    line.placement ? `Placement ${line.placement}` : null,
    line.processLossPct != null && line.processLossPct > 0 ? `Loss ${line.processLossPct}%` : null,
    line.wastagePct != null && line.wastagePct > 0 ? `Waste ${line.wastagePct}%` : null,
  ].filter(Boolean).join(' · ');
  return { primary, secondary };
}

function MaterialKindTable({
  title,
  lines,
  colorways,
  selectedColourId,
  empty,
}: {
  title: string;
  lines: MaterialPlanLine[];
  colorways: Colorway[];
  selectedColourId: string | null;
  empty: string;
}) {
  const colours = selectedColourId
    ? colorways.filter((cw) => cw.id === selectedColourId)
    : colorways;
  const rows = lines.flatMap((line) => {
    const spec = line.kind === 'Fabric' ? fabricSpec(line) : trimSpec(line);
    const unit = line.kind === 'Fabric' ? uomLabel(line.unit) : (line.unit || '');
    const code = line.fabric?.code?.trim() || '—';
    const name = line.fabric?.name?.trim() || line.name || 'Unnamed';
    const factor = materialMarkupFactor(line.processLossPct, line.wastagePct);
    return colours.flatMap((cw) => {
      const cons = planLineConsForColour(colorways, line.lineKey, cw.id);
      if (cons == null) return [];
      const qty = sumSizeAdjQty(cw.sizes) || cw.adjQty || 0;
      return [{
        key: `${line.lineKey}:${cw.id}`,
        code,
        name,
        spec,
        unit,
        colour: cw,
        cons,
        adj: cons * factor,
        total: materialRequiredQty(cons, qty, line.processLossPct, line.wastagePct),
        pl: line.processLossPct,
        waste: line.wastagePct,
      }];
    });
  });
  const selectedName = colours.length === 1 ? (colours[0].name || 'this colour') : '';
  return (
    <Panel
      title={title}
      hint={selectedColourId ? `Requirement for ${selectedName}` : 'Cons after process loss and wastage'}
    >
      {lines.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-slate-400 italic">{empty}</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-slate-400 italic">
          {selectedColourId ? `Nothing linked for ${selectedName}` : empty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[11px]">
            <colgroup>
              <col style={{ width: '13%' }} />
              <col style={{ width: '27%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 text-[9px] uppercase text-slate-500">
                <th className="px-2 py-1.5 text-left">Item code</th>
                <th className="px-2 py-1.5 text-left">Item name</th>
                <th className="px-2 py-1.5 text-left">Colour</th>
                <th className="px-2 py-1.5 text-right">Cons</th>
                <th className="px-2 py-1.5 text-right">PL%</th>
                <th className="px-2 py-1.5 text-right">W%</th>
                <th className="px-2 py-1.5 text-right bg-blue-50 text-blue-800" title="Consumption per piece after process loss and wastage">Adj</th>
                <th className="px-2 py-1.5 text-right bg-blue-100 text-blue-900" title="Adjusted consumption times the colour quantity">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 align-top font-medium text-slate-700 truncate">{row.code}</td>
                  <td className="px-2 py-1.5 align-top min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{row.name}</p>
                    {row.spec.primary ? <p className="text-[10px] text-slate-500 truncate">{row.spec.primary}</p> : null}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-200 shrink-0"
                        style={swatchStyleFromColorName(row.colour.name || '')}
                      />
                      <span className="font-medium text-slate-800 truncate">{row.colour.name || 'Untitled'}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums text-slate-800 whitespace-nowrap">
                    {fmtQty(row.cons)}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums text-slate-600">{pctLabel(row.pl)}</td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums text-slate-600">{pctLabel(row.waste)}</td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums text-blue-800 whitespace-nowrap bg-blue-50">
                    {fmtQty(row.adj)}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums font-semibold text-blue-900 whitespace-nowrap bg-blue-100" title={row.unit || undefined}>
                    {fmtQty(row.total)}{row.unit ? ` ${row.unit}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ShipmentRow({
  line,
  colorways,
  sizeColumns,
}: {
  line: ShipmentPlanLine;
  colorways: Colorway[];
  sizeColumns: string[];
}) {
  const colour = colorways.find((c) => c.id === line.colorwayId);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-1.5 whitespace-nowrap font-medium text-slate-800">
        {line.shipmentDate ? formatDateDDMMYYYY(line.shipmentDate) : '—'}
      </td>
      <td className="px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full border border-slate-200 shrink-0"
            style={swatchStyleFromColorName(colour?.name || '')}
          />
          <span className="truncate">{colour?.name || '—'}</span>
        </span>
      </td>
      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{line.shipMode || '—'}</td>
      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{line.shipmentType || '—'}</td>
      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{line.destinationCountry || '—'}</td>
      {sizeColumns.map((size) => (
        <td key={size} className="px-2 py-1.5 text-right tabular-nums text-slate-800">
          {(Number(line.sizes[size]) || 0).toLocaleString()}
        </td>
      ))}
      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">
        {rowTotal(line).toLocaleString()}
      </td>
    </tr>
  );
}
