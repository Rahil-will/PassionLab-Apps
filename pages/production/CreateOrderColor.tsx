import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Card, Modal } from '../../components/ui';
import { UnsavedChangesModal } from '../../components/settings/UnsavedChangesModal';
import { usePageHeader } from '../../components/Breadcrumb';
import { ColorwayMaterialsPanel } from '../../components/production/ColorwayMaterialsPanel';
import { PageShell } from '../../components/layout/PageShell';
import { useModuleEnabled } from '../../core/modules/useModuleEnabled';
import { calcAdjQty, sizeAdjQty, sizeOrderQty, sumSizeAdjQty, sumSizeOrderQty } from '../../lib/colorwaySizesUtils';
import { materialRequiredQty } from '../../lib/colorwayMaterialsDb';
import { swatchStyleFromColorName } from '../../lib/colorNameSwatch';
import { collectSizeKeysFromColorways, parseSizeLabels } from '../../lib/orderSizeGroupSelection';
import { markOrderDraftDiscarded } from '../../lib/orderDraftStorage';
import { ensureStyleFabricLines } from '../../lib/styleFabricLines';
import { useDataStore, useNavigationStore, useNotificationStore } from '../../stores';
import { RoutePath, type Colorway, type Material, type StyleOrder } from '../../types';
import {
  cloneColorways,
  createEmptyColorway,
  createEmptyMaterial,
} from './create-order/hooks/useColorwayReducer';

function displaySizesForWip(order: StyleOrder): string[] {
  const fromLabels = parseSizeLabels(order.sizeLabels);
  if (fromLabels.length > 0) return fromLabels;
  const fromColorways = collectSizeKeysFromColorways(order.colorways);
  return fromColorways.length > 0 ? fromColorways : ['S', 'M', 'L', 'XL'];
}

function cloneOrder(order: StyleOrder): StyleOrder {
  return { ...order, colorways: cloneColorways(order.colorways) };
}

function withTotals(colorways: Colorway[]): Colorway[] {
  return colorways.map((cw) => {
    const orderQty = sumSizeOrderQty(cw.sizes);
    const adjQty = sumSizeAdjQty(cw.sizes);
    return { ...cw, orderQty, adjQty, totalQty: orderQty };
  });
}

function bootColorPage() {
  const wip = useDataStore.getState().wipOrder;
  const params = useNavigationStore.getState().routeParams;
  if (!wip) return { entry: null as StyleOrder | null, draft: null as StyleOrder | null, activeId: null as string | null };
  const entry = cloneOrder(wip);
  const draft = cloneOrder(wip);
  let activeId = params.colorId && draft.colorways.some((c) => c.id === params.colorId)
    ? params.colorId
    : (draft.colorways[0]?.id ?? null);
  if (params.add === '1') {
    const cw = createEmptyColorway(displaySizesForWip(wip));
    draft.colorways = [...draft.colorways, cw];
    activeId = cw.id;
  }
  return { entry, draft, activeId };
}

const qtyInputCls =
  'w-full h-8 px-2 text-center text-[11px] bg-transparent border-0 rounded-none outline-none tabular-nums focus:bg-blue-50/60 focus:ring-1 focus:ring-inset focus:ring-blue-400 placeholder:text-slate-300';
const qtyAdjInputCls =
  'w-full h-8 px-2 text-center text-[11px] text-blue-700 bg-transparent border-0 rounded-none outline-none tabular-nums focus:bg-blue-100/60 focus:ring-1 focus:ring-inset focus:ring-blue-400 placeholder:text-blue-200';
const thCls =
  'px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border border-slate-200 bg-slate-50 whitespace-nowrap text-center';

export const CreateOrderColor: React.FC = () => {
  const { navigate, routeParams, setUnsaved, setPendingSaveAction, setPendingDiscardAction } = useNavigationStore();
  const wipOrder = useDataStore((s) => s.wipOrder);
  const setWipOrder = useDataStore((s) => s.setWipOrder);
  const { showNotification } = useNotificationStore();
  const materialOn = useModuleEnabled('material');

  const boot = useRef(bootColorPage());
  const entryRef = useRef(boot.current.entry);
  const entryUnsavedRef = useRef(useNavigationStore.getState().isUnsaved);
  const [draft, setDraft] = useState<StyleOrder | null>(boot.current.draft);
  const [activeColorId, setActiveColorId] = useState<string | null>(boot.current.activeId);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!wipOrder && !draft) {
      navigate(RoutePath.CREATE_ORDER, routeParams.id ? { id: routeParams.id } : undefined);
    }
  }, [wipOrder, draft, navigate, routeParams.id]);

  const sizes = useMemo(() => (draft ? displaySizesForWip(draft) : []), [draft]);
  const activeColorway = draft?.colorways.find((c) => c.id === activeColorId) ?? null;
  const cuttingAllowance = draft?.cuttingAllowance || 0;
  const shipmentAllowance = draft?.shipmentAllowance || 0;
  const totalAllowancePct = cuttingAllowance + shipmentAllowance;
  const currentOrderQty = activeColorway ? sumSizeOrderQty(activeColorway.sizes) : 0;
  const currentAdjustedQty = activeColorway ? sumSizeAdjQty(activeColorway.sizes) : 0;

  const isDirty = useMemo(() => {
    if (!draft || !entryRef.current) return false;
    return JSON.stringify(draft.colorways) !== JSON.stringify(entryRef.current.colorways);
  }, [draft]);

  useEffect(() => {
    setUnsaved(isDirty || entryUnsavedRef.current);
  }, [isDirty, setUnsaved]);

  const patchColorways = (updater: (colorways: Colorway[]) => Colorway[]) => {
    setDraft((prev) => (prev ? { ...prev, colorways: updater(prev.colorways) } : prev));
  };

  const addColorway = () => {
    const newColor = createEmptyColorway(sizes);
    patchColorways((colorways) => ensureStyleFabricLines([...colorways, newColor]));
    setActiveColorId(newColor.id);
  };

  const duplicateColorway = (e: React.MouseEvent, colorId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draft) return;
    const source = draft.colorways.find((c) => c.id === colorId);
    if (!source) return;
    const copy: Colorway = {
      ...source,
      id: crypto.randomUUID(),
      name: '',
      sizes: source.sizes.map((s) => ({ ...s })),
      materials: (source.materials ?? []).map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        // Preserve style-line linkage fields; fabricColor only when non-null.
        lineKey: m.lineKey,
        fabricId: m.fabricId,
        fabricColor: m.fabricColor != null && String(m.fabricColor).trim() !== '' ? m.fabricColor : null,
        fabricColorRef: m.fabricColorRef,
        consOverridden: m.consOverridden,
        fabric: m.fabric,
        paramValues: m.paramValues ? { ...m.paramValues } : undefined,
      })),
    };
    patchColorways((colorways) => ensureStyleFabricLines([...colorways, copy]));
    setActiveColorId(copy.id);
    showNotification('Colorway duplicated', 'success');
  };

  const updateActiveColorName = (name: string) => {
    if (!activeColorId) return;
    patchColorways((colorways) =>
      colorways.map((c) => (c.id === activeColorId ? { ...c, name } : c)),
    );
  };

  const updateSizeOrderQty = (size: string, qty: number) => {
    if (!activeColorId) return;
    patchColorways((colorways) =>
      colorways.map((c) => {
        if (c.id !== activeColorId) return c;
        const newSizes = c.sizes.map((s) =>
          s.size === size
            ? { ...s, order_qty: qty, adj_qty: calcAdjQty(qty, totalAllowancePct) }
            : s,
        );
        return { ...c, sizes: newSizes, ...{ orderQty: sumSizeOrderQty(newSizes), adjQty: sumSizeAdjQty(newSizes), totalQty: sumSizeOrderQty(newSizes) } };
      }),
    );
  };

  const updateSizeAdjustedQty = (size: string, plannedQty: number) => {
    if (!activeColorId) return;
    patchColorways((colorways) =>
      colorways.map((c) => {
        if (c.id !== activeColorId) return c;
        const newSizes = c.sizes.map((s) =>
          s.size === size ? { ...s, adj_qty: plannedQty } : s,
        );
        return { ...c, sizes: newSizes, orderQty: sumSizeOrderQty(newSizes), adjQty: sumSizeAdjQty(newSizes), totalQty: sumSizeOrderQty(newSizes) };
      }),
    );
  };

  const addMaterial = (category: 'Fabric' | 'Trim') => {
    if (!activeColorId) return;
    const newMat = createEmptyMaterial(category);
    patchColorways((colorways) =>
      colorways.map((c) =>
        c.id === activeColorId ? { ...c, materials: [...(c.materials ?? []), newMat] } : c,
      ),
    );
  };

  const updateMaterial = (matId: string, field: keyof Material, value: string | number | boolean | null) => {
    if (!activeColorId) return;
    patchColorways((colorways) =>
      colorways.map((c) => {
        if (c.id !== activeColorId) return c;
        return {
          ...c,
          materials: (c.materials ?? []).map((m) =>
            m.id === matId ? { ...m, [field]: value } : m,
          ),
        };
      }),
    );
  };

  const updateMaterialParam = (matId: string, key: string, value: string) => {
    if (!activeColorId) return;
    patchColorways((colorways) =>
      colorways.map((c) => {
        if (c.id !== activeColorId) return c;
        return {
          ...c,
          materials: (c.materials ?? []).map((m) =>
            m.id === matId
              ? { ...m, paramValues: { ...(m.paramValues ?? {}), [key]: value } }
              : m,
          ),
        };
      }),
    );
  };

  const removeMaterial = (matId: string) => {
    if (!activeColorId) return;
    patchColorways((colorways) =>
      colorways.map((c) =>
        c.id === activeColorId
          ? { ...c, materials: (c.materials ?? []).filter((m) => m.id !== matId) }
          : c,
      ),
    );
  };

  const confirmDelete = () => {
    if (!deleteId || !draft) return;
    const updated = draft.colorways.filter((c) => c.id !== deleteId);
    const nextActive = activeColorId === deleteId ? (updated[0]?.id ?? null) : activeColorId;
    setDraft({ ...draft, colorways: updated });
    setActiveColorId(nextActive);
    setDeleteId(null);
    showNotification('Colorway deleted', 'success');
  };

  const commitDraft = (): boolean => {
    const current = draftRef.current;
    if (!current) return false;
    const emptyColor = current.colorways.find((c) => !c.name.trim());
    if (emptyColor) {
      showNotification('All colorways must have a name.', 'error');
      setActiveColorId(emptyColor.id);
      return false;
    }
    const finalColorways = withTotals(current.colorways).map((cw) => ({
      ...cw,
      materials: (cw.materials ?? []).map((m) => {
        const adj = cw.adjQty || 0;
        if (m.category === 'Trim') {
          return {
            ...m,
            reqQty: materialRequiredQty(Number(m.perPc) || 0, adj, m.processLossPct, m.wastagePct),
          };
        }
        if (m.category === 'Fabric') {
          return {
            ...m,
            reqQty: materialRequiredQty(Number(m.avgCons) || 0, adj, m.processLossPct, m.wastagePct),
          };
        }
        return m;
      }),
    }));
    const orderQty = finalColorways.reduce((acc, c) => acc + (c.orderQty || 0), 0);
    const adjQty = finalColorways.reduce((acc, c) => acc + (c.adjQty || 0), 0);
    const next = { ...current, colorways: finalColorways, orderQty, adjQty, totalQty: orderQty };
    setWipOrder(next);
    entryRef.current = cloneOrder(next);
    setDraft(next);
    setUnsaved(true);
    return true;
  };

  const masterParams = routeParams.id ? { id: routeParams.id } : undefined;

  const handleSave = () => {
    if (!commitDraft()) return;
    navigate(RoutePath.CREATE_ORDER, masterParams);
  };

  const discardLocalColorEdits = () => {
    setUnsaved(entryUnsavedRef.current);
    setLeaveModalOpen(false);
    navigate(RoutePath.CREATE_ORDER, masterParams);
  };

  const handleSaveFromModal = () => {
    if (!commitDraft()) return;
    setLeaveModalOpen(false);
    navigate(RoutePath.CREATE_ORDER, masterParams);
  };

  const handleGoBack = () => {
    if (isDirty) {
      setLeaveModalOpen(true);
      return;
    }
    discardLocalColorEdits();
  };

  useEffect(() => {
    setPendingSaveAction(async () => commitDraft());
    setPendingDiscardAction(() => {
      const target = useNavigationStore.getState().pendingNavigation;
      if (target?.route === RoutePath.CREATE_ORDER || target?.route === RoutePath.CREATE_ORDER_COLOR) {
        setUnsaved(entryUnsavedRef.current);
        return;
      }
      markOrderDraftDiscarded(useNavigationStore.getState().factoryId);
      useDataStore.getState().setWipOrder(null);
      setUnsaved(false);
    });
    return () => {
      setPendingSaveAction(null);
      setPendingDiscardAction(null);
    };
  }, [setPendingSaveAction, setPendingDiscardAction, setUnsaved]);

  usePageHeader({ subtitle: 'Quantities and materials for each color' });

  if (!draft) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center h-[50vh] text-slate-400 text-xs">
          Redirecting…
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="w-full pb-6 flex gap-5 items-stretch min-h-[calc(100vh-7rem)]">
        <div className="w-56 shrink-0 sticky top-0 h-[calc(100vh-7rem)] self-start bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-100 space-y-2 shrink-0">
            <Button
              className="w-full justify-center"
              size="sm"
              variant="secondary"
              icon={ChevronLeft}
              onClick={handleGoBack}
            >
              Go Back
            </Button>
            <Button
              className="w-full justify-center"
              size="sm"
              icon={Save}
              onClick={handleSave}
            >
              Save Changes
            </Button>
            <Button
              className="w-full justify-center"
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={addColorway}
            >
              Add Color
            </Button>
          </div>
          <div className="p-2 space-y-1 flex-1 min-h-0 overflow-y-auto">
            {draft.colorways.map((cw) => {
              const selected = activeColorId === cw.id;
              return (
                <div
                  key={cw.id}
                  onClick={() => setActiveColorId(cw.id)}
                  className={`rounded-lg cursor-pointer relative group flex items-center gap-2 p-2.5 ${selected ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'border border-transparent hover:bg-slate-50 text-slate-600'}`}
                >
                  <div className="w-3 h-3 rounded-full shrink-0 border border-slate-200" style={swatchStyleFromColorName(cw.name || '')} />
                  <div className="truncate flex-1 min-w-0 pr-6">
                    <div className={`text-[10px] font-semibold truncate ${!cw.name ? 'text-slate-400 italic' : ''}`}>
                      {cw.name || 'Untitled'}
                    </div>
                    <div className="text-[9px] text-slate-400 tabular-nums">
                      {sumSizeOrderQty(cw.sizes).toLocaleString()} pcs
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => duplicateColorway(e, cw.id)}
                      className="text-slate-400 hover:text-blue-600 p-1"
                      title="Duplicate"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteId(cw.id);
                      }}
                      className="text-slate-400 hover:text-red-500 p-1"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
            {draft.colorways.length === 0 && (
              <p className="p-4 text-center text-slate-400 text-[11px]">No colors yet.</p>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-6">
          {activeColorway ? (
            <>
              <Card
                title="Size breakdown"
                subtitle={[
                  cuttingAllowance > 0 ? `Cut ${cuttingAllowance}%` : null,
                  shipmentAllowance > 0 ? `Ship ${shipmentAllowance}%` : null,
                  totalAllowancePct > 0 ? `Total ${totalAllowancePct}% allowance` : 'Order qty by size',
                ].filter(Boolean).join(' · ')}
              >
                <div className="mb-4">
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1.5">
                    Color name
                    {!activeColorway.name && <AlertCircle size={12} className="text-red-500" />}
                  </label>
                  <div className="flex items-center gap-2 max-w-md">
                    <div className="w-4 h-4 rounded-full border border-slate-200 shrink-0" style={swatchStyleFromColorName(activeColorway.name || '')} />
                    <input
                      className="flex-1 text-xs font-semibold text-slate-900 border-b border-slate-300 bg-transparent focus:outline-none focus:border-blue-600 py-1 placeholder-slate-300"
                      value={activeColorway.name}
                      onChange={(e) => updateActiveColorName(e.target.value)}
                      placeholder="e.g. Navy Blue"
                      autoFocus={!activeColorway.name}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Order Qty</div>
                    <div className="text-base font-extrabold tabular-nums text-slate-900 leading-tight">
                      {currentOrderQty.toLocaleString()} <span className="text-[10px] font-semibold text-slate-400">pcs</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Cutting</div>
                    <div className="text-base font-extrabold tabular-nums text-slate-900 leading-tight">+{cuttingAllowance}%</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Extra ship</div>
                    <div className="text-base font-extrabold tabular-nums text-slate-900 leading-tight">+{shipmentAllowance}%</div>
                  </div>
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-blue-500">Adjusted Qty</div>
                    <div className="text-base font-extrabold tabular-nums text-blue-900 leading-tight">
                      {currentAdjustedQty.toLocaleString()} <span className="text-[10px] font-semibold text-blue-400">pcs</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse" style={{ minWidth: '22rem' }}>
                    <thead>
                      <tr>
                        <th className={`${thCls} text-left px-3`}>Metric</th>
                        {sizes.map((s) => (
                          <th key={s} className={thCls}>{s}</th>
                        ))}
                        <th className={thCls}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-3 h-8 text-[10px] font-bold text-slate-500 uppercase border border-slate-200 bg-white">Order</td>
                        {sizes.map((s) => {
                          const qty = sizeOrderQty(activeColorway.sizes.find((sz) => sz.size === s));
                          return (
                            <td key={s} className="p-0 border border-slate-200">
                              <input
                                type="number"
                                className={qtyInputCls}
                                value={qty || ''}
                                placeholder="0"
                                onChange={(e) => updateSizeOrderQty(s, parseInt(e.target.value, 10) || 0)}
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 text-center text-[11px] font-bold tabular-nums text-slate-700 border border-slate-200 bg-slate-50/80">
                          {currentOrderQty.toLocaleString()}
                        </td>
                      </tr>
                      <tr className="bg-blue-50">
                        <td className="px-3 h-8 text-[10px] font-bold text-blue-600 uppercase border border-slate-200">
                          Adj.
                          <span className="block text-[10px] font-medium text-slate-400 normal-case">+{totalAllowancePct}% auto</span>
                        </td>
                        {sizes.map((s) => {
                          const planned = sizeAdjQty(activeColorway.sizes.find((sz) => sz.size === s));
                          return (
                            <td key={s} className="p-0 border border-slate-200 bg-blue-50">
                              <input
                                type="number"
                                className={qtyAdjInputCls}
                                value={planned || ''}
                                placeholder="0"
                                onChange={(e) => updateSizeAdjustedQty(s, parseInt(e.target.value, 10) || 0)}
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 text-center text-[11px] font-bold tabular-nums text-blue-700 border border-slate-200 bg-blue-100/60">
                          {currentAdjustedQty.toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                    </table>
                  </div>
                </div>
              </Card>

              {materialOn ? (
                <Card
                  title="Material requirements"
                  subtitle="Fabric categories from Work Centres. Extra fabric columns load after fabric type. Trim total qty is qty per piece × this color's adjusted qty."
                  noPadding
                >
                  <ColorwayMaterialsPanel
                    colorway={activeColorway}
                    adjustedQty={currentAdjustedQty}
                    showCaption={false}
                    allColorways={draft.colorways}
                    onAddMaterial={addMaterial}
                    onUpdateMaterial={updateMaterial}
                    onUpdateParam={updateMaterialParam}
                    onRemoveMaterial={removeMaterial}
                    onOpenStyleFabrics={() => {
                      if (!commitDraft()) return;
                      navigate(RoutePath.CREATE_ORDER, masterParams);
                    }}
                  />
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <p className="text-center text-[11px] text-slate-400 py-12">Select a color to enter quantities and materials.</p>
            </Card>
          )}
        </div>
      </div>

      <UnsavedChangesModal
        isOpen={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        onSave={handleSaveFromModal}
        onDiscard={discardLocalColorEdits}
        discardLabel="Discard & Continue"
      />

      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)}>
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 size={32} />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-2">Delete colorway?</h3>
          <p className="text-xs text-slate-500 mb-6">
            Sizes and materials for this color will be removed from the draft.
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={() => setDeleteId(null)} className="w-32">Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} className="w-32">Delete</Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
};
