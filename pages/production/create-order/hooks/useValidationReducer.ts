import { useReducer } from 'react';
import type { HeaderState } from './useHeaderReducer';
import type { ColorwayState } from './useColorwayReducer';

export type ValidationState = Record<string, string>;

export const initialValidationState: ValidationState = {};

export type ValidationAction =
  | { type: 'validate'; header: HeaderState; colorway: ColorwayState; hasSizeContext: boolean }
  | { type: 'clear'; field: string }
  | { type: 'set'; errors: ValidationState }
  | { type: 'reset' };

function validationReducer(state: ValidationState, action: ValidationAction): ValidationState {
  switch (action.type) {
    case 'validate': {
      const errors: ValidationState = {};
      if (!action.header.styleName.trim()) errors.styleName = 'Style name is required';
      if (!action.header.styleRef.trim()) errors.styleRef = 'Style reference is required';
      if (!action.header.selectedBuyer) errors.selectedBuyer = 'Buyer is required';
      if (!action.hasSizeContext) errors.selectedSizeGroup = 'Size group is required';
      return errors;
    }
    case 'clear': {
      const next = { ...state };
      delete next[action.field];
      return next;
    }
    case 'set':
      return { ...action.errors };
    case 'reset':
      return {};
    default:
      return state;
  }
}

export function useValidationReducer() {
  const [state, dispatch] = useReducer(validationReducer, initialValidationState);
  return { state, dispatch } as const;
}
