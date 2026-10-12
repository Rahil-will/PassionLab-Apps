import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, Modal } from '../../../../components/ui';
import { FabricPicker } from '../../../../modules/material/components/FabricPicker';
import { useModuleEnabled } from '../../../../core/modules/useModuleEnabled';
import { useFabricComponentsCatalog, useSupportDropdownsCatalog } from '../../../../lib/queries/settingsSlices';
import { dropdownValuesForCategory } from '../../../../lib/supportDropdownValues';
import { useMmRequirementCatalog } from '../../../../modules/material/lib/useMmRequirementCatalog';
import { useNavigationStore } from '../../../../stores/navigationStore';
import { uomLabel } from '../../../../modules/material/lib/fabricLabels';
import { swatchStyleFromColorName } from '../../../../lib/colorNameSwatch';
import { materialRequiredQty } from '../../../../lib/colorwayMaterialsDb';
import {
  lineAppliesToColour,
  planLineAdjustedCons,
  planLineHasConsumption,
  planLineLinks,
  planLineSharedCons,
  planLineTotalReq,
  type MaterialPlanLine,
} from '../../../../lib/materialPlan';
import type { ColorwayAction, ColorwayState } from '../hooks/useColorwayReducer';
import type { MmFabric } from '../../../../modules/material/lib/mmFabricRpc';
import type { Colorway } from '../../../../types';

interface MaterialsStageSectionProps {
  colorwayState: ColorwayState;
  colorwayDispatch: React.Dispatch<ColorwayAction>;
  styleFabricsRef?: React.RefObject<HTMLDivElement | null>;
}

const ROW_H = 'h-11';
const thCls =
  'px-2 py-2.5 text-[10px] font-semibold text-slate-600 uppercase border border-slate-200 bg-slate-50 whitespace-nowrap';
const thPrimaryCls = `${thCls} text-slate-700`;
const cardTitleCls = 'text-[10px] font-semibold uppercase tracking-wider text-slate-600';
const dataCellCls = `p-0 border border-slate-200 align-middle ${ROW_H}`;
const METRIC_COL = '7%';
const DELETE_COL = '2.75%';

function EqualMetricCols() {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => (
        <col key={i} style={{ width: METRIC_COL }} />
      ))}
      <col style={{ width: DELETE_COL }} />
    </>
  );
}
const cellInputBase =
  `w-full ${ROW_H} min-h-[2.75rem] px-2 text-[11px] bg-transparent border-0 rounded-none outline-none tabular-nums ` +
  'focus:bg-blue-50/50 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors placeholder:text-slate-300';
const cellInputCenter = `${cellInputBase} text-center`;
const cellSelectCls =
  `w-full ${ROW_H} min-h-[2.75rem] px-2 pr-7 text-[11px] bg-transparent border-0 rounded-none outline-none ` +
  'focus:bg-blue-50/50 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors appearance-none ' +
  "bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] " +
  'bg-[length:8px] bg-no-repeat bg-[right_0.5rem_center]';

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TRIM_UOM = ['PCS', 'MTR', 'KG', 'YDS', 'SET', 'DOZEN', 'CONE', 'ROLL', 'GROSS'];

function canonicalTrimUom(raw: string): string {
  const key = raw.trim().toLowerCase();
  const alias: Record<string, string> = {
    pc: 'PCS',
    pcs: 'PCS',
    piece: 'PCS',
    pieces: 'PCS',
    m: 'MTR',
    mtr: 'MTR',
    mtrs: 'MTR',
    meter: 'MTR',
    metre: 'MTR',
    kg: 'KG',
    kgs: 'KG',
    yd: 'YDS',
    yds: 'YDS',
    yard: 'YDS',
    yards: 'YDS',
    set: 'SET',
    sets: 'SET',
    dozen: 'DOZEN',
    cone: 'CONE',
    roll: 'ROLL',
    gross: 'GROSS',
  };
  return alias[key] ?? raw.trim().toUpperCase();
}

function AddBelowTableButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800"
    >
      <Plus size={13} />
      {label}
    </button>
  );
}

/** One data-row of breathing room between the last line and the add button. */
function RowGap() {
  return <div className="h-11 bg-white" aria-hidden />;
}

function planLabel(line: MaterialPlanLine): string {
  if (line.kind === 'Fabric') {
    return line.fabric ? `${line.fabric.code} · ${line.fabric.name}` : (line.name || 'Fabric');
  }
  return line.name || 'Trim';
}

function ColourScopeCell({
  line,
  colorways,
  onChange,
}: {
  line: MaterialPlanLine;
  colorways: Colorway[];
  onChange: (appliesTo: 'all' | string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 220;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPos({ top: rect.bottom + 4, left });
    };
    place();
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const all = !line.appliesTo || line.appliesTo === 'all';
  const selectedIds = !line.appliesTo || line.appliesTo === 'all'
    ? colorways.map((c) => c.id)
    : [...line.appliesTo];
  const names = colorways.filter((c) => selectedIds.includes(c.id)).map((c) => c.name || 'Colour');
  const label = all ? 'All' : names.length <= 2 ? names.join(', ') : `${names.length} colours`;

  const toggleColour = (colorId: string) => {
    if (all) {
      const rest = selectedIds.filter((id) => id !== colorId);
      if (rest.length > 0) onChange(rest);
      return;
    }
    const next = selectedIds.includes(colorId)
      ? selectedIds.filter((id) => id !== colorId)
      : [...selectedIds, colorId];
    if (next.length === 0) return;
    onChange(next.length === colorways.length ? 'all' : next);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${cellSelectCls} text-left truncate ${all ? 'text-slate-700' : 'text-blue-800 font-semibold'}`}
        title={all ? 'All colours, including colours added later' : names.join(', ')}
      >
        {label || 'Colours'}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 220 }}
          className="z-[80] rounded-lg border border-slate-200 bg-white shadow-lg py-1"
        >
          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={all}
              onChange={() => onChange('all')}
              className="accent-blue-600"
            />
            <span className="text-[11px] font-semibold text-slate-800">All colours</span>
          </label>
          <p className="px-3 pb-1 text-[9px] text-slate-400">Includes colours added later</p>
          <div className="border-t border-slate-100 my-1" />
          {colorways.map((cw) => (
            <label key={cw.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.includes(cw.id)}
                onChange={() => toggleColour(cw.id)}
                className="accent-blue-600"
              />
              <span
                className="inline-block w-2 h-2 rounded-full border border-black/10 shrink-0"
                style={swatchStyleFromColorName(cw.name || '')}
              />
              <span className="text-[11px] text-slate-800 truncate">{cw.name || 'Colour'}</span>
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export const MaterialsStageSection: React.FC<MaterialsStageSectionProps> = ({
  colorwayState,
  colorwayDispatch,
  styleFabricsRef,
}) => {
  const materialOn = useModuleEnabled('material');
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { fabricComponents } = useFabricComponentsCatalog(factoryId);
  const { supportDropdowns } = useSupportDropdownsCatalog(factoryId);
  const { data: mmCatalog } = useMmRequirementCatalog(materialOn);
  const colorways = colorwayState.colorways;
  const plan = colorwayState.materialPlan ?? [];

  const [removeKey, setRemoveKey] = useState<string | null>(null);

  const fabricPlan = plan.filter((p) => p.kind === 'Fabric');
  const trimPlan = plan.filter((p) => p.kind === 'Trim');

  const placementOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const row of fabricComponents ?? []) {
      if (row.is_active === false) continue;
      const label = String(row.fabric_type ?? '').trim();
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      list.push(label);
    }
    return list;
  }, [fabricComponents]);

  const trimUomOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of [...TRIM_UOM, ...dropdownValuesForCategory(supportDropdowns, 'trim_uom')]) {
      const label = canonicalTrimUom(String(raw));
      if (!label || seen.has(label)) continue;
      seen.add(label);
      list.push(label);
    }
    return list;
  }, [supportDropdowns]);

  const trimParams = mmCatalog?.trimParams ?? [];
  const trimCategories = trimParams.map((p) => p.category);
  const trimTypesFor = (cat: string) =>
    trimParams.find((p) => p.category.trim().toLowerCase() === cat.trim().toLowerCase())?.types ?? [];

  const removeTarget = removeKey ? plan.find((p) => p.lineKey === removeKey) : null;
  const removeLinkCount = removeKey ? planLineLinks(colorways, removeKey).length : 0;

  if (!materialOn) {
    return (
      <div className="col-span-12">
        <Card title="Materials" subtitle="Material module is off for this factory">
          <p className="text-[11px] text-slate-500 py-8 text-center">
            Turn on Material under Settings → Factory Settings → Modules.
          </p>
        </Card>
      </div>
    );
  }

  if (colorways.length === 0) {
    return (
      <div className="col-span-12">
        <Card title="Materials" subtitle="Add colours on the Style step first">
          <p className="text-[11px] text-slate-400 py-8 text-center">
            Go back to Style and add at least one colour before entering materials.
          </p>
        </Card>
      </div>
    );
  }

  const fabricColSpan = 11;
  const trimColSpan = 13;

  const renderPlanTotals = (line: MaterialPlanLine) => {
    const hasCons = planLineHasConsumption(colorways, line.lineKey);
    return (
      <>
        <td className={`${dataCellCls} text-center text-slate-700 font-semibold tabular-nums px-2`}>
          {hasCons ? fmt(planLineAdjustedCons(colorways, line)) : '—'}
        </td>
        <td className={`${dataCellCls} text-center text-blue-800 font-semibold tabular-nums px-2`}>
          {hasCons ? fmt(planLineTotalReq(colorways, line)) : '—'}
        </td>
      </>
    );
  };

  const renderCons = (line: MaterialPlanLine) => {
    const cons = planLineSharedCons(colorways, line.lineKey, line.kind);
    return (
      <td className={dataCellCls}>
        <input
          type="number"
          min={0}
          step="0.01"
          className={cellInputCenter}
          placeholder="0"
          title="Consumption per piece for the colours selected on this line"
          value={cons > 0 ? cons : ''}
          onChange={(e) => {
            const raw = e.target.value;
            colorwayDispatch({
              type: 'linkPlanToAllColours',
              lineKey: line.lineKey,
              cons: raw.trim() === '' ? 0 : parseFloat(raw) || 0,
            });
          }}
        />
      </td>
    );
  };

  const renderColours = (line: MaterialPlanLine) => (
    <td className={dataCellCls}>
      <ColourScopeCell
        line={line}
        colorways={colorways}
        onChange={(appliesTo) =>
          colorwayDispatch({ type: 'setPlanLineColours', lineKey: line.lineKey, appliesTo })
        }
      />
    </td>
  );

  const renderLossWaste = (line: MaterialPlanLine) => (
    <>
      <td className={dataCellCls}>
        <input
          type="number"
          min={0}
          step="0.01"
          className={`${cellInputCenter} text-amber-800`}
          value={line.processLossPct ?? ''}
          placeholder="0"
          onChange={(e) => {
            const raw = e.target.value;
            colorwayDispatch({
              type: 'updatePlanLine',
              lineKey: line.lineKey,
              patch: { processLossPct: raw.trim() === '' ? null : parseFloat(raw) || 0 },
            });
          }}
        />
      </td>
      <td className={dataCellCls}>
        <input
          type="number"
          min={0}
          step="0.01"
          className={`${cellInputCenter} text-rose-800`}
          value={line.wastagePct ?? ''}
          placeholder="0"
          onChange={(e) => {
            const raw = e.target.value;
            colorwayDispatch({
              type: 'updatePlanLine',
              lineKey: line.lineKey,
              patch: { wastagePct: raw.trim() === '' ? null : parseFloat(raw) || 0 },
            });
          }}
        />
      </td>
    </>
  );

  const renderRowActions = (line: MaterialPlanLine) => (
    <td className={`${dataCellCls} text-center`}>
      <div className="flex items-center justify-center">
        <button
          type="button"
          title="Remove"
          className="p-1 text-slate-400 hover:text-red-600"
          onClick={() => setRemoveKey(line.lineKey)}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </td>
  );

  return (
    <>
      <div className="col-span-12 space-y-4" ref={styleFabricsRef as React.RefObject<HTMLDivElement>}>
        {/* FABRICS */}
        <Card
          title="Fabric requirements"
          titleClassName={cardTitleCls}
          subtitle={
            fabricPlan.length > 0
              ? `${fabricPlan.length} line${fabricPlan.length === 1 ? '' : 's'} · All, or only some colours`
              : 'Style fabric catalogue'
          }
          className="shadow-sm border-slate-200 w-full overflow-visible"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse table-fixed text-[11px]">
              <colgroup>
                <col style={{ width: '4%' }} />
                <col />
                <col style={{ width: '14%' }} />
                <EqualMetricCols />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${thCls} text-center`}>#</th>
                  <th className={`${thPrimaryCls} text-left`}>Fabric</th>
                  <th className={`${thPrimaryCls} text-left`}>Placement</th>
                  <th className={`${thPrimaryCls} text-left`}>Colours</th>
                  <th className={`${thCls} text-center`}>UOM</th>
                  <th className={`${thCls} text-center`} title="Process loss %">PL%</th>
                  <th className={`${thCls} text-center`} title="Wastage %">W%</th>
                  <th className={`${thCls} text-center`} title="Consumption per piece">Cons</th>
                  <th className={`${thCls} text-center`} title="Consumption per piece after process loss and wastage">Adj</th>
                  <th className={`${thCls} text-center`}>Total</th>
                  <th className={thCls} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {fabricPlan.length === 0 ? (
                  <tr>
                    <td
                      colSpan={fabricColSpan}
                      className="border border-slate-200 px-4 py-8 text-center text-[11px] text-slate-400 italic"
                    >
                      Click &quot;+ Add Fabric&quot; below to add a fabric line.
                    </td>
                  </tr>
                ) : (
                  fabricPlan.map((line, idx) => (
                    <tr key={line.lineKey} className="group hover:bg-slate-50/40">
                      <td className={`${dataCellCls} text-center text-slate-400 text-[10px]`}>{idx + 1}</td>
                      <td className={`${dataCellCls} align-top !h-auto`}>
                        <FabricPicker
                          variant="cell"
                          value={line.fabricId ?? null}
                          placeholder="Pick fabric…"
                          onChange={(f: MmFabric) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: {
                                fabricId: f.id,
                                fabric: f,
                                name: f.name,
                                unit: f.uom,
                              },
                            })
                          }
                        />
                      </td>
                      <td className={dataCellCls}>
                        <select
                          value={line.fabricCategory || ''}
                          onChange={(e) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: { fabricCategory: e.target.value, placement: e.target.value },
                            })
                          }
                          className={`${cellSelectCls} ${!line.fabricCategory ? 'text-slate-400' : 'text-slate-800'}`}
                        >
                          <option value="">Placement</option>
                          {placementOptions.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      {renderColours(line)}
                      <td className={`${dataCellCls} text-center text-slate-600 font-semibold px-2`}>
                        {line.unit ? uomLabel(line.unit) : '—'}
                      </td>
                      {renderLossWaste(line)}
                      {renderCons(line)}
                      {renderPlanTotals(line)}
                      {renderRowActions(line)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {fabricPlan.length > 0 && <RowGap />}
          <AddBelowTableButton
            label="Add Fabric"
            onClick={() => colorwayDispatch({ type: 'addStyleFabricLine' })}
          />
        </Card>

        {/* TRIMS */}
        <Card
          title="Trim requirements"
          titleClassName={cardTitleCls}
          subtitle={
            trimPlan.length > 0
              ? `${trimPlan.length} line${trimPlan.length === 1 ? '' : 's'} · All, or only some colours`
              : 'Style trim catalogue'
          }
          className="shadow-sm border-slate-200 w-full overflow-visible"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse table-fixed text-[11px]">
              <colgroup>
                <col style={{ width: '3%' }} />
                <col />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <EqualMetricCols />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${thCls} text-center`}>#</th>
                  <th className={`${thPrimaryCls} text-left`}>Name</th>
                  <th className={`${thPrimaryCls} text-left`}>Category</th>
                  <th className={`${thPrimaryCls} text-left`}>Type</th>
                  <th className={`${thPrimaryCls} text-left`}>Placement</th>
                  <th className={`${thPrimaryCls} text-left`}>Colours</th>
                  <th className={`${thCls} text-center`}>UOM</th>
                  <th className={`${thCls} text-center`}>PL%</th>
                  <th className={`${thCls} text-center`}>W%</th>
                  <th className={`${thCls} text-center`} title="Consumption per piece">Cons</th>
                  <th className={`${thCls} text-center`} title="Consumption per piece after process loss and wastage">Adj</th>
                  <th className={`${thCls} text-center`}>Total</th>
                  <th className={thCls} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {trimPlan.length === 0 ? (
                  <tr>
                    <td
                      colSpan={trimColSpan}
                      className="border border-slate-200 px-4 py-8 text-center text-[11px] text-slate-400 italic"
                    >
                      Click &quot;+ Add Trim&quot; below to add a trim line.
                    </td>
                  </tr>
                ) : (
                  trimPlan.map((line, idx) => (
                    <tr key={line.lineKey} className="group hover:bg-slate-50/40">
                      <td className={`${dataCellCls} text-center text-slate-400 text-[10px]`}>{idx + 1}</td>
                      <td className={dataCellCls}>
                        <input
                          className={cellInputBase}
                          value={line.name}
                          placeholder="Trim name"
                          onChange={(e) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: { name: e.target.value },
                            })
                          }
                        />
                      </td>
                      <td className={dataCellCls}>
                        <select
                          value={line.trimCategory || ''}
                          onChange={(e) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: { trimCategory: e.target.value, trimType: '' },
                            })
                          }
                          className={`${cellSelectCls} ${!line.trimCategory ? 'text-slate-400' : 'text-slate-800'}`}
                        >
                          <option value="">Category</option>
                          {trimCategories.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={dataCellCls}>
                        <select
                          value={line.trimType || ''}
                          onChange={(e) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: { trimType: e.target.value },
                            })
                          }
                          className={`${cellSelectCls} ${!line.trimType ? 'text-slate-400' : 'text-slate-800'}`}
                        >
                          <option value="">Type</option>
                          {trimTypesFor(line.trimCategory || '').map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={dataCellCls}>
                        <input
                          className={cellInputBase}
                          value={line.placement || ''}
                          placeholder="Placement"
                          onChange={(e) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: { placement: e.target.value },
                            })
                          }
                        />
                      </td>
                      {renderColours(line)}
                      <td className={dataCellCls}>
                        <select
                          value={line.unit ? canonicalTrimUom(line.unit) : ''}
                          onChange={(e) =>
                            colorwayDispatch({
                              type: 'updatePlanLine',
                              lineKey: line.lineKey,
                              patch: { unit: e.target.value },
                            })
                          }
                          className={`${cellSelectCls} text-center ${!line.unit ? 'text-slate-400' : 'text-slate-800'}`}
                        >
                          <option value="">UOM</option>
                          {trimUomOptions.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                          {line.unit && !trimUomOptions.includes(canonicalTrimUom(line.unit)) && (
                            <option value={canonicalTrimUom(line.unit)}>{canonicalTrimUom(line.unit)}</option>
                          )}
                        </select>
                      </td>
                      {renderLossWaste(line)}
                      {renderCons(line)}
                      {renderPlanTotals(line)}
                      {renderRowActions(line)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {trimPlan.length > 0 && <RowGap />}
          <AddBelowTableButton
            label="Add Trim"
            onClick={() => colorwayDispatch({ type: 'addPlanTrimLine' })}
          />
        </Card>

        {/* COLOUR CONSUMPTION — separate from catalogue */}
        <Card
          title="Colour consumption"
          titleClassName={cardTitleCls}
          subtitle="Each style colour lists only the fabrics and trims assigned to it."
          className="shadow-sm border-slate-200 w-full overflow-visible"
          noPadding
        >
          {plan.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11px] text-slate-400 italic">
              Add fabric or trim lines above first.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {colorways.map((cw) => {
                const swatch = swatchStyleFromColorName(cw.name || '');
                const styleName = cw.name || '';
                const lines = plan.filter((line) => lineAppliesToColour(line, cw.id, colorways));
                return (
                  <section key={cw.id}>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                        style={swatch}
                      />
                      <span className="text-[11px] font-semibold text-slate-800">{styleName || 'Colour'}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums">
                        {(cw.adjQty ?? 0).toLocaleString()} pcs
                      </span>
                    </div>
                    <table className="w-full border-collapse table-fixed text-[11px]">
                      <colgroup>
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '18%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className={`${thCls} text-center`}>#</th>
                          <th className={`${thPrimaryCls} text-left`}>Material</th>
                          <th className={`${thCls} text-center`}>Kind</th>
                          <th className={`${thPrimaryCls} text-left`}>Colour name</th>
                          <th className={`${thCls} text-center`}>UOM</th>
                          <th className={`${thCls} text-center`}>Cons</th>
                          <th className={`${thCls} text-center`}>Required</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="border border-slate-200 px-4 py-4 text-center text-[11px] text-slate-400 italic"
                            >
                              No materials for this colour.
                            </td>
                          </tr>
                        ) : lines.map((line, idx) => {
                          const linked = (cw.materials ?? []).find((m) => m.lineKey === line.lineKey);
                          const cons = planLineSharedCons(colorways, line.lineKey, line.kind);
                          const req = cons > 0
                            ? materialRequiredQty(cons, cw.adjQty ?? 0, line.processLossPct, line.wastagePct)
                            : null;
                          const fixedShade = line.kind === 'Fabric'
                            && ['yarn_dyed', 'melange', 'print'].includes(line.fabric?.color_method ?? '');
                          const colorValue = linked?.fabricColor?.trim() ? linked.fabricColor : styleName;
                          return (
                            <tr key={line.lineKey} className="hover:bg-slate-50/40">
                              <td className={`${dataCellCls} text-center text-slate-400 text-[10px]`}>{idx + 1}</td>
                              <td className={`${dataCellCls} px-2`}>
                                <span className="font-semibold text-slate-800 truncate block">{planLabel(line)}</span>
                                {(line.fabricCategory || line.placement) && (
                                  <span className="text-[9px] text-slate-400">{line.fabricCategory || line.placement}</span>
                                )}
                              </td>
                              <td className={`${dataCellCls} text-center text-[10px] uppercase text-slate-500`}>
                                {line.kind === 'Fabric' ? 'Fab' : 'Trim'}
                              </td>
                              <td className={dataCellCls}>
                                {fixedShade ? (
                                  <span className="block px-2 text-[11px] text-slate-600 truncate">
                                    {line.fabric?.design_ref || styleName || '—'}
                                  </span>
                                ) : (
                                  <input
                                    className={cellInputBase}
                                    value={colorValue}
                                    placeholder={styleName || 'Colour name'}
                                    onChange={(e) =>
                                      colorwayDispatch({
                                        type: 'setMaterialColorName',
                                        lineKey: line.lineKey,
                                        colorId: cw.id,
                                        colorName: e.target.value,
                                      })
                                    }
                                  />
                                )}
                              </td>
                              <td className={`${dataCellCls} text-center text-slate-600 font-semibold px-2`}>
                                {line.unit ? (line.kind === 'Trim' ? canonicalTrimUom(line.unit) : uomLabel(line.unit)) : '—'}
                              </td>
                              <td className={`${dataCellCls} text-center text-slate-700 tabular-nums px-2`}>
                                {cons > 0 ? fmt(cons) : '—'}
                              </td>
                              <td className={`${dataCellCls} text-center text-blue-800 font-semibold tabular-nums px-2`}>
                                {req != null ? fmt(req) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Modal isOpen={Boolean(removeKey)} onClose={() => setRemoveKey(null)}>
        <div className="p-5 max-w-sm">
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            Remove {removeTarget?.kind === 'Trim' ? 'trim' : 'fabric'}?
          </h3>
          <p className="text-[11px] text-slate-600 mb-4">
            Removes this from all {removeLinkCount} colour{removeLinkCount === 1 ? '' : 's'} that use it.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRemoveKey(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (removeKey) colorwayDispatch({ type: 'removeStyleFabricLine', lineKey: removeKey });
                setRemoveKey(null);
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
