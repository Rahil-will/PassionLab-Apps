import React, { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SelectDropdown } from '../ui';
import { useModuleEnabled } from '../../core/modules/useModuleEnabled';
import { useFabricComponentsCatalog, useSupportDropdownsCatalog } from '../../lib/queries/settingsSlices';
import { dropdownValuesForCategory } from '../../lib/supportDropdownValues';
import { materialRequiredQty } from '../../lib/colorwayMaterialsDb';
import { useMmRequirementCatalog, type MmRequirementFieldOption } from '../../modules/material/lib/useMmRequirementCatalog';
import { useNavigationStore } from '../../stores';
import type { Colorway, Material } from '../../types';

const cellPad = 'min-h-8 pl-2.5 pr-2 py-0';

const inputClass =
  `block w-full min-w-full ${cellPad} appearance-none m-0 text-[11px] leading-8 bg-transparent border-0 outline-none font-medium text-slate-700 placeholder:text-slate-300 whitespace-pre-wrap break-all resize-none overflow-hidden text-left`;

const thCls =
  'pl-2.5 pr-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-normal break-words text-left';
const thCenterCls =
  'pl-2.5 pr-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-normal break-words text-center';

const tdCls = 'border-b border-slate-100 p-0 bg-white align-top overflow-hidden break-words has-[button]:hover:bg-blue-50/60 has-[textarea]:hover:bg-blue-50/60 has-[input]:hover:bg-blue-50/60 focus-within:bg-blue-50/60';

const qtyInputClass =
  `block w-full min-w-full ${cellPad} appearance-none m-0 text-[11px] leading-8 bg-transparent border-0 outline-none font-semibold text-blue-800 tabular-nums text-center placeholder:text-blue-300`;

const EDGE = {
  sno: '4%',
  name: '18%',
  uom: '7%',
  qty: '9%',
  pct: '7%',
  total: '9.5%',
  del: '2%',
} as const;

const TRIM_COL = {
  sno: EDGE.sno,
  name: EDGE.name,
  category: '15%',
  type: '15%',
  placement: '15%',
  uom: EDGE.uom,
  qty: EDGE.qty,
  total: EDGE.total,
  del: EDGE.del,
} as const;

const TRIM_COL_RO = {
  sno: EDGE.sno,
  name: EDGE.name,
  category: '16%',
  type: '16%',
  placement: '15%',
  uom: EDGE.uom,
  qty: EDGE.qty,
  total: EDGE.total,
} as const;

const qtyHeadCls =
  'pl-2.5 pr-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 whitespace-normal break-words text-center';
const qtyCellCls = 'border-b border-slate-100 p-0 bg-blue-50 text-center align-top overflow-hidden has-[input]:hover:bg-blue-100/70 focus-within:bg-blue-100/70';
const lossHeadCls =
  'pl-2.5 pr-2 py-2 text-[10px] font-semibold text-amber-800 uppercase tracking-wide border-b border-slate-200 bg-amber-50 whitespace-normal break-words text-center';
const lossCellCls = 'border-b border-slate-100 p-0 bg-amber-50 text-center align-top overflow-hidden has-[input]:hover:bg-amber-100/70 focus-within:bg-amber-100/70';
const wasteHeadCls =
  'pl-2.5 pr-2 py-2 text-[10px] font-semibold text-rose-800 uppercase tracking-wide border-b border-slate-200 bg-rose-50 whitespace-normal break-words text-center';
const wasteCellCls = 'border-b border-slate-100 p-0 bg-rose-50 text-center align-top overflow-hidden has-[input]:hover:bg-rose-100/70 focus-within:bg-rose-100/70';
const qtyDisplayClass =
  `block ${cellPad} text-[11px] font-semibold tabular-nums text-blue-800 leading-8 text-center break-all`;
const lossInputClass =
  `block w-full min-w-full ${cellPad} appearance-none m-0 text-[11px] leading-8 bg-transparent border-0 outline-none font-semibold text-amber-800 tabular-nums text-center placeholder:text-amber-300`;
const wasteInputClass =
  `block w-full min-w-full ${cellPad} appearance-none m-0 text-[11px] leading-8 bg-transparent border-0 outline-none font-semibold text-rose-800 tabular-nums text-center placeholder:text-rose-300`;
const emptyCellClass = `block ${cellPad} text-[11px] text-slate-300 leading-8 break-all text-left`;
const snoCellClass = `block ${cellPad} text-left text-[10px] font-semibold text-slate-400 tabular-nums leading-8`;

const deleteHeadCls =
  'pl-2.5 pr-2 py-2 border-b border-slate-200 bg-slate-50';

const deleteCellCls =
  'border-b border-slate-100 p-0 bg-white text-center align-top overflow-hidden';

const paramThCls = `${thCls} w-auto`;

type MmAttr = MmRequirementFieldOption;

function paramKey(def: MmAttr): string {
  return String(def.key ?? def.label ?? def.id ?? '');
}

function catalogMatch(options: string[], current: string): string {
  const label = current.trim();
  if (!label) return '';
  return options.find((item) => item.toLowerCase() === label.toLowerCase()) ?? '';
}

function formatDecimal(value: number): string {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTotalQty(
  perPc: number,
  adjustedQty: number,
  processLossPct?: number | null,
  wastagePct?: number | null,
): string {
  return formatDecimal(materialRequiredQty(perPc, adjustedQty, processLossPct, wastagePct));
}

function hasPct(value: number | null | undefined): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function fitTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(32, el.scrollHeight)}px`;
}

function WrapTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    fitTextarea(ref.current);
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={inputClass}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextCell({
  value,
  className,
}: {
  value?: string | number | null;
  className?: string;
}) {
  const text = value == null ? '' : String(value).trim();
  return (
    <span className={`block ${cellPad} text-[11px] font-medium text-slate-700 leading-8 whitespace-pre-wrap break-all ${className ?? 'text-left'}`}>
      {text || <span className="text-slate-300">—</span>}
    </span>
  );
}

export interface ColorwayMaterialsPanelProps {
  colorway: Colorway;
  adjustedQty: number;
  onAddMaterial?: (category: 'Fabric' | 'Trim') => void;
  onUpdateMaterial?: (matId: string, field: keyof Material, value: string | number | null) => void;
  onUpdateParam?: (matId: string, key: string, value: string) => void;
  onRemoveMaterial?: (matId: string) => void;
  showCaption?: boolean;
  readOnly?: boolean;
}

class MaterialsPanelGuard extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function RoundedTable({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="overflow-x-auto">{children}</div>
      {footer ? (
        <>
          <div className="h-8 bg-white" aria-hidden />
          {footer}
        </>
      ) : null}
    </div>
  );
}

function ExtraColChip({
  label,
  active,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: 'amber' | 'rose';
  disabled?: boolean;
  onClick: () => void;
}) {
  const on = active
    ? tone === 'amber'
      ? 'border-amber-600 bg-amber-600 text-white'
      : 'border-rose-600 bg-rose-600 text-white'
    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${on}`}
    >
      <Plus size={11} />
      {label}
    </button>
  );
}

function PctCell({
  value,
  readOnly,
  tone,
  onChange,
}: {
  value: number | null | undefined;
  readOnly?: boolean;
  tone: 'amber' | 'rose';
  onChange?: (value: number | null) => void;
}) {
  const display = hasPct(value) ? formatDecimal(Number(value)) : '';
  if (readOnly) {
    return (
      <span className={`${tone === 'amber' ? lossInputClass : wasteInputClass} ${display ? '' : 'text-slate-300'}`}>
        {display || '—'}
      </span>
    );
  }
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      className={tone === 'amber' ? lossInputClass : wasteInputClass}
      value={value == null || value === 0 ? '' : value}
      placeholder="%"
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.trim() === '') {
          onChange?.(null);
          return;
        }
        const n = parseFloat(raw);
        onChange?.(Number.isFinite(n) ? n : null);
      }}
    />
  );
}

function AddBelowTableButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
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

function DeleteCell({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <td className={deleteCellCls}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center justify-center w-full ${cellPad} text-slate-400 hover:text-red-600`}
        aria-label={label}
      >
        <Trash2 size={13} />
      </button>
    </td>
  );
}

function CellSelect({
  value,
  onChange,
  options,
  placeholder = 'Select',
  align = 'start',
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  align?: 'start' | 'center';
}) {
  return (
    <SelectDropdown
      value={value}
      onChange={onChange}
      options={[
        { value: '', label: placeholder },
        ...options.map((opt) => ({ value: opt, label: opt })),
      ]}
      placeholder={placeholder}
      size="compact"
      shape="none"
      variant="cell"
      align={align}
      className="block w-full min-h-8 h-full overflow-hidden"
    />
  );
}

function ParamInput({
  mat,
  def,
  onUpdateParam,
  readOnly,
}: {
  mat: Material;
  def: MmAttr;
  onUpdateParam: ColorwayMaterialsPanelProps['onUpdateParam'];
  readOnly?: boolean;
}) {
  const key = paramKey(def);
  const raw = String(mat.paramValues?.[key] ?? '');
  if (readOnly) return <TextCell value={raw} />;

  return (
    <WrapTextarea
      value={raw}
      onChange={(next) => onUpdateParam?.(mat.id, key, next)}
      placeholder={def.label || key}
    />
  );
}

const ColorwayMaterialsInner: React.FC<ColorwayMaterialsPanelProps> = ({
  colorway,
  adjustedQty,
  onAddMaterial,
  onUpdateMaterial,
  onUpdateParam,
  onRemoveMaterial,
  showCaption = true,
  readOnly = false,
}) => {
  const materialOn = useModuleEnabled('material');
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { data: mmCatalog } = useMmRequirementCatalog(materialOn);
  const { fabricComponents } = useFabricComponentsCatalog(factoryId);
  const { supportDropdowns } = useSupportDropdownsCatalog(factoryId);
  const fabricUomOptions = dropdownValuesForCategory(supportDropdowns, 'fabric_uom');
  const trimUomOptions = dropdownValuesForCategory(supportDropdowns, 'trim_uom');

  const fabricTypeRows = mmCatalog?.fabricTypes ?? [];
  const fabricTypeNames = fabricTypeRows.map((t) => t.name);

  const trimParamRows = mmCatalog?.trimParams ?? [];
  const trimCategoryOptions = trimParamRows.map((p) => p.category);

  const typesForTrimCategory = (category: string): string[] => {
    const key = category.trim().toLowerCase();
    if (!key) return [];
    const row = trimParamRows.find((p) => p.category.trim().toLowerCase() === key);
    return row?.types ?? [];
  };

  const fabricCategories = useMemo(() => {
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

  const materialDefs = mmCatalog?.requirementFields ?? [];

  const typeIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of fabricTypeRows) {
      const name = t.name.trim().toLowerCase();
      if (name) map.set(name, t.id);
    }
    return map;
  }, [fabricTypeRows]);

  const paramsByTypeId = useMemo(() => {
    const map = new Map<string, MmAttr[]>();
    for (const def of materialDefs) {
      const typeId = def.type_id;
      if (!typeId) continue;
      const list = map.get(typeId) ?? [];
      list.push(def);
      map.set(typeId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    }
    return map;
  }, [materialDefs]);

  const materials = colorway.materials ?? [];
  const fabrics = materials.filter((m) => m.category === 'Fabric');
  const trims = materials.filter((m) => m.category === 'Trim');
  const [fabricLossOn, setFabricLossOn] = useState(false);
  const [fabricWasteOn, setFabricWasteOn] = useState(false);
  const [trimLossOn, setTrimLossOn] = useState(false);
  const [trimWasteOn, setTrimWasteOn] = useState(false);

  useEffect(() => {
    setFabricLossOn(fabrics.some((m) => hasPct(m.processLossPct)));
    setFabricWasteOn(fabrics.some((m) => hasPct(m.wastagePct)));
    setTrimLossOn(trims.some((m) => hasPct(m.processLossPct)));
    setTrimWasteOn(trims.some((m) => hasPct(m.wastagePct)));
  }, [colorway.id]);

  const clearPct = (rows: Material[], field: 'processLossPct' | 'wastagePct') => {
    for (const row of rows) {
      onUpdateMaterial?.(row.id, field, null);
    }
  };

  const toggleFabricLoss = () => {
    if (readOnly) return;
    if (fabricLossOn) clearPct(fabrics, 'processLossPct');
    setFabricLossOn((cur) => !cur);
  };
  const toggleFabricWaste = () => {
    if (readOnly) return;
    if (fabricWasteOn) clearPct(fabrics, 'wastagePct');
    setFabricWasteOn((cur) => !cur);
  };
  const toggleTrimLoss = () => {
    if (readOnly) return;
    if (trimLossOn) clearPct(trims, 'processLossPct');
    setTrimLossOn((cur) => !cur);
  };
  const toggleTrimWaste = () => {
    if (readOnly) return;
    if (trimWasteOn) clearPct(trims, 'wastagePct');
    setTrimWasteOn((cur) => !cur);
  };

  const paramsForMaterial = (mat: Material): MmAttr[] => {
    const typeName = (mat.type ?? '').trim();
    if (!typeName) return [];
    const typeId = typeIdByName.get(typeName.toLowerCase());
    if (!typeId) return [];
    return paramsByTypeId.get(typeId) ?? [];
  };

  const seenParamKeys = new Set<string>();
  const unionParamCols: MmAttr[] = [];
  for (const mat of fabrics) {
    for (const def of paramsForMaterial(mat)) {
      const key = paramKey(def);
      if (!key || seenParamKeys.has(key)) continue;
      seenParamKeys.add(key);
      unionParamCols.push(def);
    }
  }

  const categoryOptions = fabricCategories;
  const typeOptions = fabricTypeNames;
  const trimCategorySelectOptions = trimCategoryOptions;

  const fabricColSpan = (readOnly ? 7 : 8) + unionParamCols.length + (fabricLossOn ? 1 : 0) + (fabricWasteOn ? 1 : 0);
  const trimColSpan = (readOnly ? 8 : 9) + (trimLossOn ? 1 : 0) + (trimWasteOn ? 1 : 0);
  const trimW = readOnly ? TRIM_COL_RO : TRIM_COL;

  if (!materialOn) return null;

  return (
    <div className={showCaption ? 'border-t border-slate-200' : ''}>
      {showCaption ? (
        <p className="px-4 pt-3 text-[10px] text-slate-500">
          Materials for <span className="font-semibold text-slate-700">{colorway.name || 'this color'}</span>
        </p>
      ) : null}

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Fabric</h4>
          <div className="flex items-center gap-1.5">
            <ExtraColChip label="Process loss %" active={fabricLossOn} tone="amber" disabled={readOnly} onClick={toggleFabricLoss} />
            <ExtraColChip label="Wastage %" active={fabricWasteOn} tone="rose" disabled={readOnly} onClick={toggleFabricWaste} />
          </div>
        </div>
        <RoundedTable
          footer={readOnly ? undefined : (
            <AddBelowTableButton label="Add Fabric" onClick={() => onAddMaterial?.('Fabric')} />
          )}
        >
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col style={{ width: EDGE.sno }} />
              <col style={{ width: EDGE.name }} />
              <col />
              <col />
              {unionParamCols.map((p) => (
                <col key={paramKey(p)} />
              ))}
              <col style={{ width: EDGE.uom }} />
              <col style={{ width: EDGE.qty }} />
              {fabricLossOn ? <col style={{ width: EDGE.pct }} /> : null}
              {fabricWasteOn ? <col style={{ width: EDGE.pct }} /> : null}
              <col style={{ width: EDGE.total }} />
              {readOnly ? null : <col style={{ width: EDGE.del }} />}
            </colgroup>
            <thead>
              <tr>
                <th className={thCls}>S.No</th>
                <th className={thCls}>Fabric name</th>
                <th className={thCls}>Fabric category</th>
                <th className={thCls}>Fabric type</th>
                {unionParamCols.map((p) => (
                  <th key={paramKey(p)} className={paramThCls}>{String(p.label)}</th>
                ))}
                <th className={thCenterCls}>UOM</th>
                <th className={qtyHeadCls}>Cons / pc</th>
                {fabricLossOn ? <th className={lossHeadCls} title="Process loss %">PL%</th> : null}
                {fabricWasteOn ? <th className={wasteHeadCls} title="Wastage %">W%</th> : null}
                <th className={qtyHeadCls}>Total cons</th>
                {readOnly ? null : <th className={deleteHeadCls} />}
              </tr>
            </thead>
            <tbody>
              {fabrics.map((mat, idx) => {
                const rowParams = paramsForMaterial(mat);
                const rowKeys = new Set(rowParams.map(paramKey));
                return (
                  <tr key={mat.id} className="hover:bg-slate-50">
                    <td className={tdCls}>
                      <span className={snoCellClass}>{idx + 1}</span>
                    </td>
                    <td className={tdCls}>
                      {readOnly ? (
                        <TextCell value={mat.name} />
                      ) : (
                        <WrapTextarea
                          value={mat.name}
                          onChange={(next) => onUpdateMaterial?.(mat.id, 'name', next)}
                          placeholder="Name"
                        />
                      )}
                    </td>
                    <td className={tdCls}>
                      {readOnly ? (
                        <TextCell value={mat.fabricCategory} />
                      ) : (
                        <CellSelect
                          value={catalogMatch(categoryOptions, mat.fabricCategory || '')}
                          onChange={(next) => onUpdateMaterial?.(mat.id, 'fabricCategory', next)}
                          options={categoryOptions}
                        />
                      )}
                    </td>
                    <td className={tdCls}>
                      {readOnly ? (
                        <TextCell value={mat.type} />
                      ) : (
                        <CellSelect
                          value={catalogMatch(typeOptions, mat.type || '')}
                          onChange={(next) => onUpdateMaterial?.(mat.id, 'type', next)}
                          options={typeOptions}
                        />
                      )}
                    </td>
                    {unionParamCols.map((p) => {
                      const key = paramKey(p);
                      const applies = rowKeys.has(key);
                      return (
                        <td key={key} className={tdCls}>
                          {applies ? (
                            <ParamInput mat={mat} def={p} onUpdateParam={onUpdateParam} readOnly={readOnly} />
                          ) : (
                            <span className={emptyCellClass}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={tdCls}>
                      {readOnly ? (
                        <TextCell value={mat.unit} className="text-center" />
                      ) : (
                        <CellSelect
                          value={catalogMatch(fabricUomOptions, mat.unit || '')}
                          onChange={(next) => onUpdateMaterial?.(mat.id, 'unit', next)}
                          options={fabricUomOptions}
                          placeholder="UOM"
                          align="center"
                        />
                      )}
                    </td>
                    <td className={qtyCellCls}>
                      {readOnly ? (
                        <span className={qtyDisplayClass}>
                          {mat.avgCons ? formatDecimal(Number(mat.avgCons)) : <span className="text-blue-300">—</span>}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={qtyInputClass}
                          value={mat.avgCons || ''}
                          onChange={(e) => onUpdateMaterial?.(mat.id, 'avgCons', parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      )}
                    </td>
                    {fabricLossOn ? (
                      <td className={lossCellCls}>
                        <PctCell
                          value={mat.processLossPct}
                          readOnly={readOnly}
                          tone="amber"
                          onChange={(next) => onUpdateMaterial?.(mat.id, 'processLossPct', next)}
                        />
                      </td>
                    ) : null}
                    {fabricWasteOn ? (
                      <td className={wasteCellCls}>
                        <PctCell
                          value={mat.wastagePct}
                          readOnly={readOnly}
                          tone="rose"
                          onChange={(next) => onUpdateMaterial?.(mat.id, 'wastagePct', next)}
                        />
                      </td>
                    ) : null}
                    <td className={qtyCellCls}>
                      <span className={qtyDisplayClass}>
                        {formatTotalQty(Number(mat.avgCons) || 0, adjustedQty, fabricLossOn ? mat.processLossPct : null, fabricWasteOn ? mat.wastagePct : null)}
                      </span>
                    </td>
                    {readOnly ? null : (
                      <DeleteCell label="Remove fabric" onClick={() => onRemoveMaterial?.(mat.id)} />
                    )}
                  </tr>
                );
              })}
              {fabrics.length === 0 && (
                <tr>
                  <td colSpan={fabricColSpan} className="text-center py-6 text-xs text-slate-400 italic">
                    {readOnly
                      ? 'No fabrics for this color.'
                      : 'No fabrics. Add one, pick a category, then a fabric type to load its parameters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </RoundedTable>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Trims</h4>
          <div className="flex items-center gap-1.5">
            <ExtraColChip label="Process loss %" active={trimLossOn} tone="amber" disabled={readOnly} onClick={toggleTrimLoss} />
            <ExtraColChip label="Wastage %" active={trimWasteOn} tone="rose" disabled={readOnly} onClick={toggleTrimWaste} />
          </div>
        </div>
        <RoundedTable
          footer={readOnly ? undefined : (
            <AddBelowTableButton label="Add Trim" onClick={() => onAddMaterial?.('Trim')} />
          )}
        >
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col style={{ width: trimW.sno }} />
              <col style={{ width: trimW.name }} />
              <col style={{ width: trimW.category }} />
              <col style={{ width: trimW.type }} />
              <col style={{ width: trimW.placement }} />
              <col style={{ width: trimW.uom }} />
              <col style={{ width: trimW.qty }} />
              {trimLossOn ? <col style={{ width: EDGE.pct }} /> : null}
              {trimWasteOn ? <col style={{ width: EDGE.pct }} /> : null}
              <col style={{ width: trimW.total }} />
              {readOnly ? null : <col style={{ width: TRIM_COL.del }} />}
            </colgroup>
            <thead>
              <tr>
                <th className={thCls}>S.No</th>
                <th className={thCls}>Trim name</th>
                <th className={thCls}>Trim category</th>
                <th className={thCls}>Trim type</th>
                <th className={thCls}>Placement</th>
                <th className={thCenterCls}>UOM</th>
                <th className={qtyHeadCls}>Qty / pc</th>
                {trimLossOn ? <th className={lossHeadCls} title="Process loss %">PL%</th> : null}
                {trimWasteOn ? <th className={wasteHeadCls} title="Wastage %">W%</th> : null}
                <th className={qtyHeadCls}>Total qty</th>
                {readOnly ? null : <th className={deleteHeadCls} />}
              </tr>
            </thead>
            <tbody>
              {trims.map((mat, idx) => (
                <tr key={mat.id} className="hover:bg-slate-50">
                  <td className={tdCls}>
                    <span className={snoCellClass}>{idx + 1}</span>
                  </td>
                  <td className={tdCls}>
                    {readOnly ? (
                      <TextCell value={mat.name} />
                    ) : (
                      <WrapTextarea
                        value={mat.name}
                        onChange={(next) => onUpdateMaterial?.(mat.id, 'name', next)}
                        placeholder="Name"
                      />
                    )}
                  </td>
                  <td className={tdCls}>
                    {readOnly ? (
                      <TextCell value={mat.trimCategory} />
                    ) : (
                      <CellSelect
                        value={catalogMatch(trimCategorySelectOptions, mat.trimCategory || '')}
                        onChange={(next) => {
                          onUpdateMaterial?.(mat.id, 'trimCategory', next);
                          const allowed = typesForTrimCategory(next);
                          const current = (mat.trimType || '').trim();
                          if (current && !allowed.some((t) => t.toLowerCase() === current.toLowerCase())) {
                            onUpdateMaterial?.(mat.id, 'trimType', '');
                          }
                        }}
                        options={trimCategorySelectOptions}
                      />
                    )}
                  </td>
                  <td className={tdCls}>
                    {readOnly ? (
                      <TextCell value={mat.trimType} />
                    ) : (
                      <CellSelect
                        value={catalogMatch(typesForTrimCategory(mat.trimCategory || ''), mat.trimType || '')}
                        onChange={(next) => onUpdateMaterial?.(mat.id, 'trimType', next)}
                        options={typesForTrimCategory(catalogMatch(trimCategorySelectOptions, mat.trimCategory || ''))}
                      />
                    )}
                  </td>
                  <td className={tdCls}>
                    {readOnly ? (
                      <TextCell value={mat.placement} />
                    ) : (
                      <WrapTextarea
                        value={mat.placement || ''}
                        onChange={(next) => onUpdateMaterial?.(mat.id, 'placement', next)}
                        placeholder="Placement"
                      />
                    )}
                  </td>
                  <td className={tdCls}>
                    {readOnly ? (
                      <TextCell value={mat.unit} className="text-center" />
                    ) : (
                      <CellSelect
                        value={catalogMatch(trimUomOptions, mat.unit || '')}
                        onChange={(next) => onUpdateMaterial?.(mat.id, 'unit', next)}
                        options={trimUomOptions}
                        placeholder="UOM"
                        align="center"
                      />
                    )}
                  </td>
                  <td className={qtyCellCls}>
                    {readOnly ? (
                      <span className={qtyDisplayClass}>
                        {mat.perPc ? formatDecimal(Number(mat.perPc)) : <span className="text-blue-300">—</span>}
                      </span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={qtyInputClass}
                        value={mat.perPc || ''}
                        onChange={(e) => onUpdateMaterial?.(mat.id, 'perPc', parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                      />
                    )}
                  </td>
                  {trimLossOn ? (
                    <td className={lossCellCls}>
                      <PctCell
                        value={mat.processLossPct}
                        readOnly={readOnly}
                        tone="amber"
                        onChange={(next) => onUpdateMaterial?.(mat.id, 'processLossPct', next)}
                      />
                    </td>
                  ) : null}
                  {trimWasteOn ? (
                    <td className={wasteCellCls}>
                      <PctCell
                        value={mat.wastagePct}
                        readOnly={readOnly}
                        tone="rose"
                        onChange={(next) => onUpdateMaterial?.(mat.id, 'wastagePct', next)}
                      />
                    </td>
                  ) : null}
                  <td className={qtyCellCls}>
                    <span className={qtyDisplayClass}>
                      {formatTotalQty(mat.perPc || 0, adjustedQty, trimLossOn ? mat.processLossPct : null, trimWasteOn ? mat.wastagePct : null)}
                    </span>
                  </td>
                  {readOnly ? null : (
                    <DeleteCell label="Remove trim" onClick={() => onRemoveMaterial?.(mat.id)} />
                  )}
                </tr>
              ))}
              {trims.length === 0 && (
                <tr>
                  <td colSpan={trimColSpan} className="text-center py-6 text-xs text-slate-400 italic">
                    No trims added.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </RoundedTable>
      </div>
    </div>
  );
};

export const ColorwayMaterialsPanel: React.FC<ColorwayMaterialsPanelProps> = (props) => (
  <MaterialsPanelGuard>
    <ColorwayMaterialsInner {...props} />
  </MaterialsPanelGuard>
);
