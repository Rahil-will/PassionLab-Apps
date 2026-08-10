import { useReducer } from 'react';
import type { Colorway } from '../../../../types';
import type { ColorTemplateAddPayload } from '../../../../components/production/ColorQtyWorkspace';
import {
  calcAdjQty,
  sizeOrderQty,
  sizeAdjQty,
  sumSizeOrderQty,
  sumSizeAdjQty,
} from '../../../../lib/colorwaySizesUtils';

export interface ColorwayState {
  colorways: Colorway[];
  selectedColorId: string | null;
  savedSnapshot: Colorway[];
}

export const initialColorwayState: ColorwayState = {
  colorways: [],
  selectedColorId: null,
  savedSnapshot: [],
};

function cloneColorways(rows: Colorway[]): Colorway[] {
  return rows.map((cw) => ({
    ...cw,
    sizes: cw.sizes.map((s) => ({ ...s })),
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

export type ColorwayAction =
  | { type: 'hydrate'; colorways: Colorway[]; selectedColorId?: string | null; snapshot?: Colorway[] }
  | { type: 'setColorways'; colorways: Colorway[] }
  | { type: 'selectColor'; id: string | null }
  | { type: 'addColor'; payload: ColorTemplateAddPayload; displaySizes: string[]; totalAllowancePct: number }
  | { type: 'deleteColor'; id: string }
  | { type: 'duplicateColor'; id: string }
  | { type: 'renameColor'; id: string; name: string }
  | { type: 'updateOrderQty'; id: string; size: string; qty: number; totalAllowancePct: number; displaySizes: string[] }
  | { type: 'updateAdjQty'; id: string; size: string; qty: number }
  | { type: 'applyAllowance'; totalAllowancePct: number; displaySizes: string[] }
  | { type: 'reset' };

function colorwayReducer(state: ColorwayState, action: ColorwayAction): ColorwayState {
  switch (action.type) {
    case 'hydrate':
      return {
        colorways: cloneColorways(action.colorways),
        selectedColorId: action.selectedColorId ?? (action.colorways[0]?.id ?? null),
        savedSnapshot: cloneColorways(action.snapshot ?? action.colorways),
      };
    case 'setColorways':
      return { ...state, colorways: cloneColorways(action.colorways) };
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
      return {
        ...state,
        colorways: next,
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
      };
      const idx = state.colorways.findIndex((c) => c.id === action.id);
      const next = [...state.colorways.slice(0, idx + 1), copy, ...state.colorways.slice(idx + 1)];
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
    case 'reset':
      return { ...initialColorwayState };
    default:
      return state;
  }
}

export function useColorwayReducer(initial: Partial<ColorwayState> = {}) {
  const [state, dispatch] = useReducer(colorwayReducer, { ...initialColorwayState, ...initial });
  return { state, dispatch } as const;
}
