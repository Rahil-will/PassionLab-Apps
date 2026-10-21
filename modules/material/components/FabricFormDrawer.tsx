/**
 * FabricFormDrawer — create / edit / quick-create a fabric master record.
 * Field layout comes from mm_get_fabric_form_schema. Duplicate check runs on
 * save. Suggest name, construction add, lock, usage, and conflict handling stay here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Loader2, Lock, X } from 'lucide-react';
import { Button } from '../../../components/ui';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useNavigationStore } from '../../../stores/navigationStore';
import { useMmRequirementCatalog } from '../lib/useMmRequirementCatalog';
import { useMmFabricConstructions } from '../lib/useMmFabrics';
import { useMmConfigRights, useMmQuickCreateRights } from '../lib/useMmConfigRights';
import { useFabricFormSchema } from '../lib/useFabricFormSchema';
import {
  clientValidate,
  compositionFromInput,
  compositionFromJson,
  fabricPayloadFromValues,
  fieldAppliesToType,
  fieldKeyForServerMessage,
  formValuesFromFabric,
  schemaFields,
  type FabricFormValues,
} from '../lib/fabricFormSchema';
import {
  checkFabricDuplicate,
  getFabric,
  quickCreateFabric,
  saveFabric,
  setFabricTolerance,
  saveFabricConstruction,
  saveFabricOpeningStock,
  type MmFabric,
  type MmFabricWithUsage,
} from '../lib/mmFabricRpc';
import { suggestFabricName } from '../lib/fabricLabels';
import {
  displayNumberToInches,
  formatStoredWidth,
  parseQtyUnit,
  parseWidthUnit,
  unitBase,
  useMmUnits,
  qtyToStored,
  toDisplayWidth,
  widthLabel,
  type QtyUnit,
  type WidthUnit,
} from '../lib/units';
import { RoutePath } from '../../../types';
import { FabricSchemaForm } from './fabric-form/FabricSchemaForm';
import {
  emptyOpeningStockDraft,
  FabricOpeningStockPanel,
  FabricWarehouseStockCard,
  parseOpeningStockDraft,
  type OpeningStockDraft,
} from './FabricOpeningStockModal';

export type FabricFormMode = 'create' | 'edit' | 'quick';

export interface FabricFormDrawerProps {
  open: boolean;
  mode: FabricFormMode;
  fabricId?: string;
  initialName?: string;
  onClose: () => void;
  onSaved: (fabric: MmFabric) => void;
  readOnly?: boolean;
}

type DupState =
  | { kind: 'none' }
  | { kind: 'checking' }
  | { kind: 'exact'; fabric: MmFabric }
  | { kind: 'near'; fabrics: MmFabric[] };

const DESIGN_REF_METHODS = ['yarn_dyed', 'melange', 'print'];

function compositionText(values: FabricFormValues): string {
  const raw = (values.composition ?? '').trim();
  if (raw.startsWith('[')) return compositionFromJson(raw).map((row) => row.fiber).filter(Boolean).join(', ');
  return raw;
}

export function FabricFormDrawer({
  open,
  mode,
  fabricId,
  initialName,
  onClose,
  onSaved,
  readOnly = false,
}: FabricFormDrawerProps) {
  const { showNotification } = useNotificationStore();
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const isConfig = useMmConfigRights();
  const canOpenStock = useMmQuickCreateRights();
  const catalog = useMmRequirementCatalog(open);

  const [values, setValues] = useState<FabricFormValues>({});
  const [legacySpec, setLegacySpec] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<MmFabricWithUsage | null>(null);
  const [dupState, setDupState] = useState<DupState>({ kind: 'none' });
  const [nearConfirmed, setNearConfirmed] = useState(false);
  const [stockDraft, setStockDraft] = useState<OpeningStockDraft>(emptyOpeningStockDraft);
  const hydrated = useRef<string | null>(null);
  const dirty = useRef(false);
  useMmUnits();
  const [qtyUnit, setQtyUnit] = useState<QtyUnit>('kg');
  const [widthUnit, setWidthUnit] = useState<WidthUnit>('in');
  const widthUnitRef = useRef<WidthUnit>('in');
  widthUnitRef.current = widthUnit;

  const typeId = values.fabric_type?.trim() ? values.fabric_type : null;
  const { schema, loading: schemaLoading } = useFabricFormSchema(open);
  const { rows: constructions, refetch: refetchConstructions } = useMmFabricConstructions(typeId);

  const locked = loaded?.locked ?? false;
  const lockedMsg = locked
    ? `Used on ${loaded?.used_on_orders ?? 0} order(s) — spec cannot change`
    : '';
  const formFabricTypes = useMemo(() => {
    const types = catalog.data?.fabricTypes ?? [];
    const saved = loaded?.fabric_type;
    if (saved && !types.some((type) => type.id === saved.id)) {
      return [...types, {
        id: saved.id,
        name: saved.name,
        qty_units: [parseQtyUnit(loaded?.qty_unit ?? loaded?.uom)],
        width_units: [parseWidthUnit(loaded?.width_unit)],
      }];
    }
    return types;
  }, [catalog.data?.fabricTypes, loaded?.fabric_type, loaded?.qty_unit, loaded?.uom, loaded?.width_unit]);
  const formConstructions = useMemo(() => {
    const rows = constructions.map((row) => ({ id: row.id, name: row.name }));
    const saved = loaded?.construction;
    if (saved && !rows.some((row) => row.id === saved.id)) {
      return [...rows, { id: saved.id, name: saved.name }];
    }
    return rows;
  }, [constructions, loaded?.construction]);

  const pickedType = formFabricTypes.find((type) => type.id === typeId) ?? null;
  const qtyOptions = pickedType?.qty_units?.length ? pickedType.qty_units : [];
  const widthOptions = pickedType?.width_units?.length ? pickedType.width_units : [];

  const applyWidthUnit = useCallback((nextUnit: WidthUnit) => {
    setWidthUnit((prevUnit) => {
      if (prevUnit === nextUnit) return prevUnit;
      setValues((current) => {
        const inches = displayNumberToInches(current.width_in, prevUnit);
        const shown = toDisplayWidth(inches, nextUnit);
        return { ...current, width_in: shown == null ? current.width_in : String(shown) };
      });
      return nextUnit;
    });
  }, []);

  const setField = useCallback((key: string, value: string) => {
    dirty.current = true;
    setDupState({ kind: 'none' });
    setNearConfirmed(false);
    setValues((prev) => {
      if (key === 'fabric_type' && prev.fabric_type !== value) {
        const next: FabricFormValues = { ...prev, fabric_type: value };
        if (mode !== 'edit') next.construction = '';
        if (schema) {
          for (const field of schemaFields(schema)) {
            if (field.key === 'fabric_type') continue;
            if (!fieldAppliesToType(field, value || null)) delete next[field.key];
          }
        }
        const nextType = (catalog.data?.fabricTypes ?? []).find((type) => type.id === value);
        const nextQty = nextType?.qty_units[0] ?? 'kg';
        const nextWidth = nextType?.width_units[0] ?? 'in';
        setQtyUnit(nextQty);
        const prevUnit = widthUnitRef.current;
        if (prevUnit !== nextWidth) {
          const inches = displayNumberToInches(next.width_in, prevUnit);
          const shown = toDisplayWidth(inches, nextWidth);
          next.width_in = shown == null ? (next.width_in ?? '') : String(shown);
        }
        setWidthUnit(nextWidth);
        return next;
      }
      return { ...prev, [key]: value };
    });
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [mode, schema, catalog.data?.fabricTypes]);

  useEffect(() => {
    if (!open) {
      hydrated.current = null;
      return;
    }
    if (mode === 'edit' && fabricId) {
      setLoading(true);
      void getFabric(fabricId).then((res) => {
        setLoading(false);
        if (res.ok === false) {
          showNotification(res.message, 'error');
          return;
        }
        setLoaded(res.data);
        setLegacySpec(res.data.spec_values ?? {});
        hydrated.current = null;
        dirty.current = false;
      });
      return;
    }
    setLoaded(null);
    setLegacySpec({});
    setValues({
      name: initialName ?? '',
      width_form: 'open',
      uom: 'kg',
      color_method: 'solid_dyed',
    });
    setErrors({});
    setDupState({ kind: 'none' });
    setNearConfirmed(false);
    setStockDraft(emptyOpeningStockDraft());
    setQtyUnit('kg');
    setWidthUnit('in');
    dirty.current = false;
    hydrated.current = 'new';
  }, [open, fabricId, mode, initialName, showNotification]);

  useEffect(() => {
    if (!open || !schema || mode !== 'edit' || !loaded || dirty.current) return;
    const fabricWidth = parseWidthUnit(loaded.width_unit);
    const fabricQty = parseQtyUnit(loaded.qty_unit ?? loaded.uom);
    const key = `${loaded.id}:${schema.schema_version}:${fabricQty}:${fabricWidth}`;
    if (hydrated.current === key) return;
    const next = formValuesFromFabric(loaded, schema);
    const shown = toDisplayWidth(loaded.width_in, fabricWidth);
    next.width_in = shown == null ? '' : String(shown);
    delete next.uom;
    setQtyUnit(fabricQty);
    setWidthUnit(fabricWidth);
    setValues(next);
    hydrated.current = key;
  }, [open, schema, mode, loaded]);

  const lookupDuplicate = useCallback(async (): Promise<DupState> => {
    const fabricTypeId = values.fabric_type;
    const constructionId = values.construction;
    const compo = compositionFromInput(values.composition);
    if (!fabricTypeId || !constructionId || compo.length === 0) return { kind: 'none' };
    const colorMethod = values.color_method;
    const res = await checkFabricDuplicate({
      id: loaded?.id,
      fabric_type_id: fabricTypeId,
      construction_id: constructionId,
      composition: compo,
      gsm: values.gsm ? Number(values.gsm) : undefined,
      width_in: displayNumberToInches(values.width_in, widthUnit) ?? undefined,
      width_form: values.width_form,
      qty_unit: qtyUnit,
      width_unit: widthUnit,
      color_method: colorMethod as MmFabric['color_method'],
      design_ref: DESIGN_REF_METHODS.includes(colorMethod) ? values.design_ref || null : null,
    });
    if (res.ok === false) return { kind: 'none' };
    if (res.data.exact) return { kind: 'exact', fabric: res.data.exact };
    if (res.data.near.length > 0) return { kind: 'near', fabrics: res.data.near };
    return { kind: 'none' };
  }, [values, loaded?.id, widthUnit, qtyUnit]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  async function handleAddConstruction(name: string) {
    if (!typeId) return;
    const res = await saveFabricConstruction({ fabric_type_id: typeId, name });
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    setField('construction', res.data.id);
    await refetchConstructions();
    showNotification('Construction added', 'success');
  }

  useEffect(() => {
    if (!open) return;
    const constr = constructions.find((c) => c.id === values.construction);
    const autoName = suggestFabricName({
      constructionName: constr?.name,
      compositionText: compositionText(values),
      gsm: values.gsm ? Number(values.gsm) : undefined,
      widthIn: values.width_in ? Number(values.width_in) : undefined,
      widthForm: values.width_form,
      widthUnit,
    });
    setValues((prev) => (prev.name === autoName ? prev : { ...prev, name: autoName }));
  }, [open, values.construction, values.composition, values.gsm, values.width_in, values.width_form, widthUnit, constructions]);

  function handleSuggestName() {
    const constr = constructions.find((c) => c.id === values.construction);
    const suggested = suggestFabricName({
      constructionName: constr?.name,
      compositionText: compositionText(values),
      gsm: values.gsm ? Number(values.gsm) : undefined,
      widthIn: values.width_in ? Number(values.width_in) : undefined,
      widthForm: values.width_form,
      widthUnit,
    });
    if (suggested) setField('name', suggested);
  }

  async function handleSave() {
    if (readOnly || !schema) return;
    const constr = constructions.find((c) => c.id === values.construction);
    const named: FabricFormValues = {
      ...values,
      name: suggestFabricName({
        constructionName: constr?.name,
        compositionText: compositionText(values),
        gsm: values.gsm ? Number(values.gsm) : undefined,
        widthIn: values.width_in ? Number(values.width_in) : undefined,
        widthForm: values.width_form,
        widthUnit,
      }) || values.name,
    };
    const nextErrors = clientValidate(named, schema);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const stock = mode === 'edit' ? { ok: true as const, empty: true as const } : parseOpeningStockDraft(stockDraft);
    if (stock.ok === false) {
      showNotification(stock.message, 'error');
      return;
    }
    if (dupState.kind === 'exact') return;
    setSaving(true);
    setDupState({ kind: 'checking' });
    const checked = await lookupDuplicate();
    if (checked.kind === 'exact') {
      setDupState(checked);
      setSaving(false);
      return;
    }
    if (checked.kind === 'near' && !nearConfirmed) {
      setDupState(checked);
      setSaving(false);
      showNotification('Please confirm the near-duplicate warning before saving', 'error');
      return;
    }
    setDupState(checked.kind === 'near' ? checked : { kind: 'none' });
    const inches = displayNumberToInches(named.width_in, widthUnit);
    const row = fabricPayloadFromValues({
      ...named,
      width_in: inches == null ? '' : String(inches),
    }, schema, {
      id: mode === 'edit' ? loaded?.id : undefined,
      row_version: mode === 'edit' ? loaded?.row_version : undefined,
      legacySpec,
    });
    delete row.uom;
    row.qty_unit = qtyUnit;
    row.width_unit = widthUnit;
    const res = mode === 'quick' ? await quickCreateFabric(row) : await saveFabric(row);
    if (res.ok === false) {
      setSaving(false);
      if (res.code === 'DUPLICATE' && res.existing) {
        setDupState({ kind: 'exact', fabric: res.existing });
        return;
      }
      if (res.code === 'CONFLICT') {
        showNotification('This record was changed by someone else. Reloading.', 'error');
        if (fabricId) {
          const fresh = await getFabric(fabricId);
          if (fresh.ok) {
            setLoaded(fresh.data);
            setLegacySpec(fresh.data.spec_values ?? {});
            hydrated.current = null;
          }
        }
        return;
      }
      const key = (res.code === 'REQUIRED' || res.code === 'INVALID')
        ? fieldKeyForServerMessage(res.message, schema)
        : null;
      if (key) setErrors({ [key]: res.message });
      else showNotification(res.message, 'error');
      return;
    }
    if (mode !== 'edit' && stock.empty === false) {
      const stockRes = await saveFabricOpeningStock(
        res.data.id,
        qtyToStored(stock.qty, qtyUnit) ?? stock.qty,
        stock.count,
        stock.unitForm,
      );
      setSaving(false);
      onSaved(res.data);
      onClose();
      if (stockRes.ok === false) {
        showNotification(`Fabric created. Opening stock was not added: ${stockRes.message}`, 'error');
        return;
      }
      showNotification(
        mode === 'quick' ? 'Fabric quick-created with opening stock' : 'Fabric created with opening stock',
        'success',
      );
      return;
    }
    setSaving(false);
    onSaved(res.data);
    onClose();
    showNotification(
      mode === 'quick' ? 'Fabric quick-created' : mode === 'edit' ? 'Fabric updated' : 'Fabric created',
      'success',
    );
  }

  if (!open) return null;
  const isReadOnly = readOnly;
  const busy = loading || schemaLoading;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? 'Edit fabric' : mode === 'quick' ? 'Quick create fabric' : 'New fabric'}
        className="fixed inset-y-0 right-0 z-[70] w-full max-w-xl bg-white shadow-2xl flex flex-col border-l border-slate-200"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
          <div>
            <h2 className="text-sm font-bold text-slate-800">
              {mode === 'edit' ? 'Edit fabric' : mode === 'quick' ? 'Quick create fabric' : 'New fabric'}
            </h2>
            {values.code && <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{values.code}</p>}
          </div>
          <div className="flex items-center gap-2">
            {locked && (
              <div className="flex items-center gap-1 text-amber-600 text-[10px] font-semibold">
                <Lock size={12} />
                Locked
              </div>
            )}
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-4 space-y-3">
          {busy || !schema ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {dupState.kind === 'exact' && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-700">
                    Exact duplicate found: {dupState.fabric.code} — {dupState.fabric.name}
                  </p>
                  <p className="text-[10px] text-red-600 mt-0.5">
                    {dupState.fabric.composition_text} · {dupState.fabric.gsm} GSM · {formatStoredWidth(dupState.fabric.width_in, parseWidthUnit(dupState.fabric.width_unit ?? widthUnit))}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-[10px] font-semibold text-red-700 underline underline-offset-2"
                    onClick={() => { onSaved(dupState.fabric); onClose(); }}
                  >
                    Use {dupState.fabric.code} instead
                  </button>
                </div>
              )}
              {dupState.kind === 'near' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-700">Similar fabrics exist — confirm this is a new quality:</p>
                  {dupState.fabrics.map((f) => (
                    <p key={f.id} className="text-[10px] text-amber-700 pl-2">
                      {f.code} · {f.name} · {f.composition_text} · {f.gsm} GSM · {formatStoredWidth(f.width_in, parseWidthUnit(f.width_unit ?? widthUnit))}
                    </p>
                  ))}
                  {!nearConfirmed ? (
                    <button type="button" className="mt-1 text-[10px] font-semibold text-amber-800 underline underline-offset-2" onClick={() => setNearConfirmed(true)}>
                      Yes, this is a different quality — proceed
                    </button>
                  ) : (
                    <p className="text-[10px] text-emerald-700 font-semibold">Confirmed — will save as new fabric.</p>
                  )}
                </div>
              )}
              {dupState.kind === 'checking' && (
                <div className="flex items-center gap-2 text-[10px] text-slate-400 px-1">
                  <Loader2 size={12} className="animate-spin" />
                  Checking for duplicates…
                </div>
              )}

              <FabricSchemaForm
                schema={schema}
                values={values}
                onChange={setField}
                errors={errors}
                locked={locked}
                lockedMsg={lockedMsg}
                readOnly={isReadOnly}
                fabricTypes={formFabricTypes}
                constructions={formConstructions}
                isConfig={isConfig}
                onSuggestName={handleSuggestName}
                onAddConstruction={mode === 'edit' ? handleAddConstruction : undefined}
                pairCodeAndName={mode !== 'edit'}
                allowAddConstruction={mode === 'edit'}
                widthUnitText={typeId ? widthLabel(widthUnit) : undefined}
                unitPick={typeId ? {
                  qtyOptions: qtyOptions.length > 0 ? qtyOptions : [qtyUnit],
                  widthOptions: widthOptions.length > 0 ? widthOptions : [widthUnit],
                  qtyUnit,
                  widthUnit,
                  onQty: setQtyUnit,
                  onWidth: applyWidthUnit,
                } : null}
                afterReference={(
                  <>
                    {mode === 'edit' && loaded ? <FabricWarehouseStockCard fabric={loaded} /> : null}
                    {mode !== 'edit' && !isReadOnly && canOpenStock ? (
                      <FabricOpeningStockPanel
                        draft={stockDraft}
                        uom={unitBase(qtyUnit) === 'kg' ? 'kg' : 'm'}
                        qtyUnit={qtyUnit}
                        onDraftChange={setStockDraft}
                      />
                    ) : null}
                    {mode === 'edit' && loaded && canOpenStock && loaded.status !== 'inactive' ? (
                      <FabricOpeningStockPanel fabric={loaded} onSaved={() => onSaved(loaded)} />
                    ) : null}
                  </>
                )}
              />

              {mode === 'edit' && loaded ? (
                <FabricToleranceFields fabricId={loaded.id} gsmTol={loaded.gsm_tol_pct} widthTol={loaded.width_tol_pct} />
              ) : null}

              {mode === 'edit' && loaded && loaded.usage && loaded.usage.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Used on</span>
                    <button
                      type="button"
                      className="text-[10px] font-mono text-blue-700 underline underline-offset-2"
                      onClick={() => requestNavigate(RoutePath.MATERIAL_FABRIC_DETAIL, { fabricId: loaded.id })}
                    >
                      {loaded.code}
                    </button>
                  </div>
                  <div className="p-4 space-y-2">
                    {loaded.usage.map((u) => (
                      <button
                        key={u.order_id}
                        type="button"
                        onClick={() => requestNavigate(RoutePath.STYLE_DETAILS, { id: u.order_id })}
                        className="w-full text-left p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                      >
                        <p className="text-[11px] font-semibold text-slate-800 truncate group-hover:text-blue-700">
                          {u.style_name ?? u.order_id}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {[u.style_ref, u.po_number, u.internal_order_no].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!isReadOnly && !busy && (
          <div className="px-5 py-4 border-t border-slate-100 shrink-0 bg-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              {dupState.kind === 'exact' && (
                <><Info size={12} className="text-red-500" /> Exact duplicate — cannot save</>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => { void handleSave(); }} disabled={saving || dupState.kind === 'exact'}>
                {saving ? (
                  <><Loader2 size={13} className="animate-spin mr-1.5" /> Saving…</>
                ) : mode === 'quick' ? 'Quick create' : mode === 'edit' ? 'Save changes' : 'Create fabric'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FabricToleranceFields({
  fabricId,
  gsmTol,
  widthTol,
}: {
  fabricId: string;
  gsmTol?: number | null;
  widthTol?: number | null;
}) {
  const { showNotification } = useNotificationStore();
  const [gsm, setGsm] = useState(gsmTol == null ? '2.5' : String(gsmTol));
  const [width, setWidth] = useState(widthTol == null ? '2.5' : String(widthTol));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGsm(gsmTol == null ? '2.5' : String(gsmTol));
    setWidth(widthTol == null ? '2.5' : String(widthTol));
  }, [fabricId, gsmTol, widthTol]);

  const save = async () => {
    const gsmPct = Number(gsm);
    const widthPct = Number(width);
    if (!Number.isFinite(gsmPct) || !Number.isFinite(widthPct) || gsmPct < 0 || gsmPct > 50 || widthPct < 0 || widthPct > 50) {
      showNotification('Tolerance is 0 to 50%', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await setFabricTolerance(fabricId, gsmPct, widthPct);
      if (res.ok === false) throw new Error(res.message);
      showNotification('Tolerance saved', 'success');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Tolerance save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tolerance</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[10px] font-semibold text-slate-600 mb-1">GSM tolerance %</span>
          <input value={gsm} onChange={(event) => setGsm(event.target.value)} className="w-full h-8 rounded-lg border border-slate-200 px-2 text-[12px]" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold text-slate-600 mb-1">Width tolerance %</span>
          <input value={width} onChange={(event) => setWidth(event.target.value)} className="w-full h-8 rounded-lg border border-slate-200 px-2 text-[12px]" />
        </label>
      </div>
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save tolerance'}
        </Button>
      </div>
    </div>
  );
}
