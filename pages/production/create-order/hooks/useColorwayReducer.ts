import { useReducer } from 'react';
import type { Colorway, Material } from '../../../../types';
import type { ColorTemplateAddPayload } from '../../../../components/production/ColorQtyWorkspace';
import {
  calcAdjQty,
  sizeOrderQty,
  sizeAdjQty,
  sumSizeOrderQty,
  sumSizeAdjQty,
} from '../../../../lib/colorwaySizesUtils';
import {
  applyLineEdit,
  type StyleFabricLinePatch,
} from '../../../../lib/styleFabricLines';
import {
  deriveMaterialPlan,
  lineColourIds,
  materialFromPlan,
  planLineSharedCons,
  type MaterialPlanLine,
} from '../../../../lib/materialPlan';
import type { MmFabric } from '../../../../modules/material/lib/mmFabricRpc';

export interface ColorwayState {
  colorways: Colorway[];
  selectedColorId: string | null;
  savedSnapshot: Colorway[];
  /** Style-level material catalogue (cons comes from colour links). */
  materialPlan: MaterialPlanLine[];
}

export type { MaterialPlanLine };

export const initialColorwayState: ColorwayState = {
  colorways: [],
  selectedColorId: null,
  savedSnapshot: [],
  materialPlan: [],
};

export function cloneColorways(rows: Colorway[]): Colorway[] {
  return rows.map((cw) => ({
    ...cw,
    sizes: cw.sizes.map((s) => ({ ...s })),
    materials: (cw.materials ?? []).map((m) => ({
      ...m,
      paramValues: m.paramValues ? { ...m.paramValues } : undefined,
    })),
  }));
}

function ensureSizes(sizes: Colorway['sizes'], displaySizes: string[]): Colorway['sizes'] {
  const bySize = new Map(sizes.map((s) => [s.size, s]));
  return displaySizes.map((label) => {
    const row = bySize.get(label);
    return row ?? { size: label, order_qty: 0, adj_qty: 0 };
  });
}

function recalcTotals(sizes: Colorway['sizes']): Pick<Colorway, 'orderQty' | 'adjQty' | 'totalQty'> {
  const orderQty = sumSizeOrderQty(sizes);
  const adjQty = sumSizeAdjQty(sizes);
  return { orderQty, adjQty, totalQty: orderQty };
}

export function createEmptyColorway(displaySizes: string[]): Colorway {
  const sizes = displaySizes.map((size) => ({ size, order_qty: 0, adj_qty: 0 }));
  return {
    id: crypto.randomUUID(),
    name: '',
    sizes,
    materials: [],
    ...recalcTotals(sizes),
  };
}

export function createEmptyMaterial(category: 'Fabric' | 'Trim'): Material {
  const isFabric = category === 'Fabric';
  return {
    id: crypto.randomUUID(),
    category,
    name: '',
    placement: '',
    type: '',
    trimType: isFabric ? undefined : '',
    fabricCategory: isFabric ? '' : undefined,
    trimCategory: isFabric ? undefined : '',
    unit: '',
    avgCons: 0,
    perPc: 0,
    paramValues: {},
  };
}

function attachPlanLine(colorways: Colorway[], plan: MaterialPlanLine, cons: number): Colorway[] {
  return colorways.map((c) => {
    if ((c.materials ?? []).some((m) => m.lineKey === plan.lineKey)) return c;
    return { ...c, materials: [...(c.materials ?? []), materialFromPlan(plan, cons)] };
  });
}

export type ColorwayAction =
  | { type: 'hydrate'; colorways: Colorway[]; selectedColorId?: string | null; snapshot?: Colorway[]; materialPlan?: MaterialPlanLine[] }
  | { type: 'setColorways'; colorways: Colorway[] }
  | { type: 'selectColor'; id: string | null }
  | { type: 'addColor'; payload: ColorTemplateAddPayload; displaySizes: string[]; totalAllowancePct: number }
  | { type: 'deleteColor'; id: string }
  | { type: 'duplicateColor'; id: string }
  | { type: 'renameColor'; id: string; name: string }
  | { type: 'updateOrderQty'; id: string; size: string; qty: number; totalAllowancePct: number; displaySizes: string[] }
  | { type: 'updateAdjQty'; id: string; size: string; qty: number }
  | { type: 'applyAllowance'; totalAllowancePct: number; displaySizes: string[] }
  | { type: 'addMaterial'; colorId: string; category: 'Fabric' | 'Trim' }
  | { type: 'updateMaterial'; colorId: string; matId: string; field: keyof Material; value: string | number | boolean | null }
  | { type: 'updateMaterialParam'; colorId: string; matId: string; key: string; value: string }
  | { type: 'removeMaterial'; colorId: string; matId: string }
  | { type: 'addStyleFabricLine' }
  | { type: 'addPlanTrimLine' }
  | { type: 'updatePlanLine'; lineKey: string; patch: Partial<MaterialPlanLine> & StyleFabricLinePatch }
  | { type: 'updateStyleFabricLine'; lineKey: string; patch: StyleFabricLinePatch }
  | { type: 'removeStyleFabricLine'; lineKey: string }
  | { type: 'linkPlanToColour'; lineKey: string; colorId: string; cons: number }
  | { type: 'unlinkPlanFromColour'; lineKey: string; colorId: string }
  /** Set the same cons on every colour for this plan line (link missing colours). */
  | { type: 'linkPlanToAllColours'; lineKey: string; cons: number }
  | { type: 'setPlanLineColours'; lineKey: string; appliesTo: 'all' | string[] }
  | { type: 'setMaterialColorName'; lineKey: string; colorId: string; colorName: string }
  | { type: 'linkNewFabricToColour'; colorId: string; fabric: MmFabric; cons: number; placement?: string }
  | { type: 'linkLegacyFabricLine'; lineKey: string; fabric: MmFabric }
  | { type: 'reset' };

function colorwayReducer(state: ColorwayState, action: ColorwayAction): ColorwayState {
  switch (action.type) {
    case 'hydrate': {
      const colorways = cloneColorways(action.colorways);
      return {
        colorways,
        selectedColorId: action.selectedColorId ?? (action.colorways[0]?.id ?? null),
        savedSnapshot: cloneColorways(action.snapshot ?? action.colorways),
        materialPlan: action.materialPlan ?? deriveMaterialPlan(colorways),
      };
    }
    case 'setColorways': {
      const colorways = cloneColorways(action.colorways);
      return { ...state, colorways, materialPlan: deriveMaterialPlan(colorways) };
    }
    case 'selectColor':
      return { ...state, selectedColorId: action.id };
    case 'addColor': {
      const bySize = new Map(action.payload.sizes.map((s) => [s.size, s]));
      const sizes = action.displaySizes.map((label) => {
        const row = bySize.get(label);
        const orderQty = row ? sizeOrderQty(row) : 0;
        const adjQty = row && sizeAdjQty(row) > 0
          ? sizeAdjQty(row)
          : calcAdjQty(orderQty, action.totalAllowancePct);
        return { size: label, order_qty: orderQty, adj_qty: adjQty };
      });
      const id = crypto.randomUUID();
      const newCw: Colorway = {
        id,
        name: action.payload.name.trim(),
        sizes,
        materials: state.materialPlan
          .filter((plan) => !plan.appliesTo || plan.appliesTo === 'all')
          .map((plan) =>
            materialFromPlan(plan, planLineSharedCons(state.colorways, plan.lineKey, plan.kind)),
          ),
        ...recalcTotals(sizes),
      };
      return {
        ...state,
        colorways: [...state.colorways, newCw],
        selectedColorId: id,
      };
    }
    case 'deleteColor': {
      const next = state.colorways.filter((c) => c.id !== action.id);
      const materialPlan = state.materialPlan.flatMap((plan) => {
        if (!plan.appliesTo || plan.appliesTo === 'all') return [plan];
        const ids = plan.appliesTo.filter((id) => id !== action.id);
        if (ids.length === 0) return [];
        return [{ ...plan, appliesTo: ids.length === next.length ? 'all' as const : ids }];
      });
      return {
        ...state,
        colorways: next,
        materialPlan,
        selectedColorId: state.selectedColorId === action.id ? (next[0]?.id ?? null) : state.selectedColorId,
      };
    }
    case 'duplicateColor': {
      const src = state.colorways.find((c) => c.id === action.id);
      if (!src) return state;
      const newId = crypto.randomUUID();
      const copyNum = state.colorways.filter((c) => c.name.startsWith(src.name)).length;
      const copy: Colorway = {
        ...src,
        id: newId,
        name: `${src.name} copy${copyNum > 1 ? ` ${copyNum}` : ''}`,
        sizes: src.sizes.map((s) => ({ ...s })),
        materials: (src.materials ?? []).map((m) => ({
          ...m,
          id: crypto.randomUUID(),
          lineKey: m.lineKey,
          fabricId: m.fabricId,
          fabricColor: m.fabricColor ?? null,
          fabricColorRef: m.fabricColorRef ?? null,
          consOverridden: m.consOverridden,
          fabric: m.fabric,
          paramValues: m.paramValues ? { ...m.paramValues } : undefined,
        })),
      };
      const idx = state.colorways.findIndex((c) => c.id === action.id);
      const next = [
        ...state.colorways.slice(0, idx + 1),
        copy,
        ...state.colorways.slice(idx + 1),
      ];
      return { ...state, colorways: next, selectedColorId: newId };
    }
    case 'renameColor':
      return {
        ...state,
        colorways: state.colorways.map((c) => (c.id === action.id ? { ...c, name: action.name } : c)),
      };
    case 'updateOrderQty':
      return {
        ...state,
        colorways: state.colorways.map((c) => {
          if (c.id !== action.id) return c;
          const sizes = ensureSizes(c.sizes, action.displaySizes).map((s) =>
            s.size === action.size
              ? { ...s, order_qty: action.qty, adj_qty: calcAdjQty(action.qty, action.totalAllowancePct) }
              : s,
          );
          return { ...c, sizes, ...recalcTotals(sizes) };
        }),
      };
    case 'updateAdjQty':
      return {
        ...state,
        colorways: state.colorways.map((c) => {
          if (c.id !== action.id) return c;
          const sizes = ensureSizes(c.sizes, c.sizes.map((s) => s.size)).map((s) =>
            s.size === action.size ? { ...s, adj_qty: action.qty } : s,
          );
          return { ...c, sizes, ...recalcTotals(sizes) };
        }),
      };
    case 'applyAllowance':
      return {
        ...state,
        colorways: state.colorways.map((c) => {
          const sizes = action.displaySizes.map((label) => {
            const row = c.sizes.find((s) => s.size === label) ?? { size: label, order_qty: 0, adj_qty: 0 };
            const orderQty = sizeOrderQty(row);
            return { size: label, order_qty: orderQty, adj_qty: calcAdjQty(orderQty, action.totalAllowancePct) };
          });
          return { ...c, sizes, ...recalcTotals(sizes) };
        }),
      };
    case 'addMaterial': {
      const newMat = createEmptyMaterial(action.category);
      return {
        ...state,
        selectedColorId: action.colorId,
        colorways: state.colorways.map((c) => {
          if (c.id !== action.colorId) return c;
          return { ...c, materials: [...(c.materials ?? []), newMat] };
        }),
      };
    }
    case 'updateMaterial':
      return {
        ...state,
        colorways: state.colorways.map((c) => {
          if (c.id !== action.colorId) return c;
          return {
            ...c,
            materials: (c.materials ?? []).map((m) =>
              m.id === action.matId ? { ...m, [action.field]: action.value } : m,
            ),
          };
        }),
      };
    case 'updateMaterialParam':
      return {
        ...state,
        colorways: state.colorways.map((c) => {
          if (c.id !== action.colorId) return c;
          return {
            ...c,
            materials: (c.materials ?? []).map((m) =>
              m.id === action.matId
                ? { ...m, paramValues: { ...(m.paramValues ?? {}), [action.key]: action.value } }
                : m,
            ),
          };
        }),
      };
    case 'removeMaterial':
      return {
        ...state,
        colorways: state.colorways.map((c) =>
          c.id === action.colorId
            ? { ...c, materials: (c.materials ?? []).filter((m) => m.id !== action.matId) }
            : c,
        ),
      };
    case 'addStyleFabricLine': {
      const lineKey = crypto.randomUUID();
      const row: MaterialPlanLine = {
        lineKey,
        kind: 'Fabric',
        fabricId: null,
        fabric: null,
        name: '',
        fabricCategory: '',
        unit: '',
        processLossPct: null,
        wastagePct: null,
        appliesTo: 'all',
      };
      return {
        ...state,
        materialPlan: [...state.materialPlan, row],
        colorways: attachPlanLine(state.colorways, row, 0),
      };
    }
    case 'addPlanTrimLine': {
      const lineKey = crypto.randomUUID();
      const row: MaterialPlanLine = {
        lineKey,
        kind: 'Trim',
        name: '',
        trimCategory: '',
        trimType: '',
        placement: '',
        unit: '',
        processLossPct: null,
        wastagePct: null,
        appliesTo: 'all',
      };
      return {
        ...state,
        materialPlan: [...state.materialPlan, row],
        colorways: attachPlanLine(state.colorways, row, 0),
      };
    }
    case 'setPlanLineColours': {
      const plan = state.materialPlan.find((p) => p.lineKey === action.lineKey);
      if (!plan) return state;
      const liveIds = state.colorways.map((c) => c.id);
      const targetIds = action.appliesTo === 'all'
        ? liveIds
        : action.appliesTo.filter((id) => liveIds.includes(id));
      if (targetIds.length === 0) return state;
      const appliesTo: 'all' | string[] = action.appliesTo === 'all' || targetIds.length === liveIds.length
        ? 'all'
        : targetIds;
      const cons = planLineSharedCons(state.colorways, plan.lineKey, plan.kind);
      const colorways = state.colorways.map((c) => {
        const inScope = targetIds.includes(c.id);
        const has = (c.materials ?? []).some((m) => m.lineKey === plan.lineKey);
        if (inScope && !has) {
          return { ...c, materials: [...(c.materials ?? []), materialFromPlan(plan, cons)] };
        }
        if (!inScope && has) {
          return { ...c, materials: (c.materials ?? []).filter((m) => m.lineKey !== plan.lineKey) };
        }
        return c;
      });
      return {
        ...state,
        colorways,
        materialPlan: state.materialPlan.map((p) =>
          p.lineKey === plan.lineKey ? { ...p, appliesTo } : p,
        ),
      };
    }
    case 'setMaterialColorName': {
      const plan = state.materialPlan.find((p) => p.lineKey === action.lineKey);
      const colorways = state.colorways.map((c) => {
        if (c.id !== action.colorId) return c;
        const styleName = (c.name || '').trim();
        const next = action.colorName.trim();
        const same = !next || next.toLowerCase() === styleName.toLowerCase();
        const fabricColor = same ? null : next;
        const exists = (c.materials ?? []).some((m) => m.lineKey === action.lineKey);
        if (!exists && plan) {
          const cons = planLineSharedCons(state.colorways, plan.lineKey, plan.kind);
          return {
            ...c,
            materials: [...(c.materials ?? []), { ...materialFromPlan(plan, cons), fabricColor }],
          };
        }
        return {
          ...c,
          materials: (c.materials ?? []).map((m) =>
            m.lineKey === action.lineKey ? { ...m, fabricColor } : m,
          ),
        };
      });
      return { ...state, colorways };
    }
    case 'updatePlanLine': {
      const materialPlan = state.materialPlan.map((p) =>
        p.lineKey === action.lineKey ? { ...p, ...action.patch } : p,
      );
      const plan = materialPlan.find((p) => p.lineKey === action.lineKey);
      let colorways = state.colorways;
      if (plan) {
        colorways = applyLineEdit(colorways, action.lineKey, {
          fabricId: plan.fabricId,
          fabric: plan.fabric,
          placement: plan.fabricCategory,
          unit: plan.unit,
          name: plan.name,
          type: plan.fabric?.fabric_type?.name,
          processLossPct: plan.processLossPct,
          wastagePct: plan.wastagePct,
        });
        // Sync trim fields on linked rows
        if (plan.kind === 'Trim') {
          colorways = colorways.map((c) => ({
            ...c,
            materials: (c.materials ?? []).map((m) =>
              m.lineKey === action.lineKey
                ? {
                    ...m,
                    name: plan.name,
                    trimCategory: plan.trimCategory,
                    trimType: plan.trimType,
                    placement: plan.placement,
                    unit: plan.unit,
                    processLossPct: plan.processLossPct,
                    wastagePct: plan.wastagePct,
                  }
                : m,
            ),
          }));
        }
      }
      return { ...state, materialPlan, colorways };
    }
    case 'updateStyleFabricLine': {
      const materialPlan = state.materialPlan.map((p) =>
        p.lineKey === action.lineKey
          ? {
              ...p,
              fabricId: action.patch.fabricId !== undefined ? action.patch.fabricId : p.fabricId,
              fabric: action.patch.fabric !== undefined ? action.patch.fabric : p.fabric,
              fabricCategory: action.patch.placement !== undefined ? action.patch.placement : p.fabricCategory,
              unit: action.patch.unit !== undefined ? action.patch.unit : p.unit,
              name: action.patch.name !== undefined ? action.patch.name : p.name,
              processLossPct: action.patch.processLossPct !== undefined ? action.patch.processLossPct : p.processLossPct,
              wastagePct: action.patch.wastagePct !== undefined ? action.patch.wastagePct : p.wastagePct,
            }
          : p,
      );
      return {
        ...state,
        materialPlan,
        colorways: applyLineEdit(state.colorways, action.lineKey, action.patch),
      };
    }
    case 'removeStyleFabricLine': {
      const materialPlan = state.materialPlan.filter((p) => p.lineKey !== action.lineKey);
      const colorways = state.colorways.map((c) => ({
        ...c,
        materials: (c.materials ?? []).filter((m) => m.lineKey !== action.lineKey),
      }));
      return { ...state, materialPlan, colorways };
    }
    case 'linkPlanToColour': {
      const plan = state.materialPlan.find((p) => p.lineKey === action.lineKey);
      if (!plan) return state;
      const colorways = state.colorways.map((c) => {
        if (c.id !== action.colorId) return c;
        const existing = (c.materials ?? []).find((m) => m.lineKey === action.lineKey);
        if (existing) {
          return {
            ...c,
            materials: (c.materials ?? []).map((m) =>
              m.lineKey === action.lineKey
                ? {
                    ...m,
                    avgCons: plan.kind === 'Fabric' ? action.cons : m.avgCons,
                    perPc: plan.kind === 'Trim' ? action.cons : m.perPc,
                    consOverridden: true,
                  }
                : m,
            ),
          };
        }
        return {
          ...c,
          materials: [...(c.materials ?? []), materialFromPlan(plan, action.cons)],
        };
      });
      return { ...state, colorways };
    }
    case 'unlinkPlanFromColour': {
      const colorways = state.colorways.map((c) =>
        c.id === action.colorId
          ? { ...c, materials: (c.materials ?? []).filter((m) => m.lineKey !== action.lineKey) }
          : c,
      );
      return { ...state, colorways };
    }
    case 'linkPlanToAllColours': {
      const plan = state.materialPlan.find((p) => p.lineKey === action.lineKey);
      if (!plan) return state;
      const targets = new Set(lineColourIds(plan, state.colorways));
      const colorways = state.colorways.map((c) => {
        if (!targets.has(c.id)) return c;
        const existing = (c.materials ?? []).find((m) => m.lineKey === action.lineKey);
        if (existing) {
          return {
            ...c,
            materials: (c.materials ?? []).map((m) =>
              m.lineKey === action.lineKey
                ? {
                    ...m,
                    avgCons: plan.kind === 'Fabric' ? action.cons : m.avgCons,
                    perPc: plan.kind === 'Trim' ? action.cons : m.perPc,
                    consOverridden: false,
                    processLossPct: plan.processLossPct,
                    wastagePct: plan.wastagePct,
                  }
                : m,
            ),
          };
        }
        return {
          ...c,
          materials: [...(c.materials ?? []), materialFromPlan(plan, action.cons)],
        };
      });
      return { ...state, colorways };
    }
    case 'linkNewFabricToColour': {
      // B: auto-add to Material requirements, then link this colour.
      const lineKey = crypto.randomUUID();
      const plan: MaterialPlanLine = {
        lineKey,
        kind: 'Fabric',
        fabricId: action.fabric.id,
        fabric: action.fabric,
        name: action.fabric.name,
        fabricCategory: action.placement || '',
        unit: action.fabric.uom,
        processLossPct: null,
        wastagePct: null,
        appliesTo: [action.colorId],
      };
      const colorways = state.colorways.map((c) =>
        c.id === action.colorId
          ? { ...c, materials: [...(c.materials ?? []), materialFromPlan(plan, action.cons)] }
          : c,
      );
      return {
        ...state,
        materialPlan: [...state.materialPlan, plan],
        colorways,
      };
    }
    case 'linkLegacyFabricLine': {
      const fabric = action.fabric;
      const key = action.lineKey;
      const samples = state.colorways.flatMap((c) =>
        (c.materials ?? []).filter((m) => {
          if (m.category !== 'Fabric' || m.fabricId) return false;
          if (m.lineKey && m.lineKey === key) return true;
          if (key.startsWith('legacy:')) {
            const [, rest] = key.split('legacy:');
            const [name, placement] = (rest ?? '').split('|');
            return m.name === name && (m.fabricCategory ?? '') === (placement ?? '');
          }
          return false;
        }),
      );
      const baseline = samples[0];
      if (!baseline) return state;
      const resolvedKey = baseline.lineKey && !baseline.lineKey.startsWith('legacy:')
        ? baseline.lineKey
        : crypto.randomUUID();
      const baseCons = Number(baseline.avgCons) || 0;
      const next = state.colorways.map((c) => ({
        ...c,
        materials: (c.materials ?? []).map((m) => {
          if (m.category !== 'Fabric' || m.fabricId) return m;
          const matches = samples.some((s) => s.id === m.id)
            || (m.lineKey === key)
            || (m.name === baseline.name && (m.fabricCategory ?? '') === (baseline.fabricCategory ?? ''));
          if (!matches) return m;
          const cons = Number(m.avgCons) || 0;
          return {
            ...m,
            lineKey: resolvedKey,
            fabricId: fabric.id,
            fabric,
            name: fabric.name,
            type: fabric.fabric_type?.name ?? m.type,
            unit: fabric.uom,
            fabricCategory: baseline.fabricCategory ?? m.fabricCategory,
            processLossPct: baseline.processLossPct ?? m.processLossPct,
            wastagePct: baseline.wastagePct ?? m.wastagePct,
            consOverridden: cons !== baseCons,
          };
        }),
      }));
      return { ...state, colorways: next, materialPlan: deriveMaterialPlan(next) };
    }
    case 'reset':
      return { ...initialColorwayState };
    default:
      return state;
  }
}

export function useColorwayReducer(initial: Partial<ColorwayState> = {}) {
  const [state, dispatch] = useReducer(colorwayReducer, {
    ...initialColorwayState,
    ...initial,
    materialPlan: initial.materialPlan ?? initialColorwayState.materialPlan,
    colorways: initial.colorways ?? initialColorwayState.colorways,
  });
  return { state, dispatch } as const;
}
