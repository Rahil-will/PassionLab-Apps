import { useReducer } from 'react';
import type { OrderPriority, OrderType } from '../../../../types';
import { todayIso } from '../../../../lib/orderDateUtils';

export interface HeaderState {
  styleName: string;
  styleRef: string;
  poNumber: string;
  selectedBuyer: string;
  orderDate: string;
  jobCardDate: string;
  sizeGroupSelection: string;
  snapshottedGroupName: string;
  snapshottedSizeKeys: string[];
  sewingSam: string;
  priority: OrderPriority;
  garmentType: string;
  merchantName: string;
  orderType: OrderType;
  season: string;
  internalOrderNo: string;
  factoryCode: string;
  styleImage: string;
  showImageInput: boolean;
  cuttingAllowance: number;
  applyExtraAllowance: boolean;
  remarks: string;
}

export const initialHeaderState: HeaderState = {
  styleName: '',
  styleRef: '',
  poNumber: '',
  selectedBuyer: '',
  orderDate: '',
  jobCardDate: todayIso(),
  sizeGroupSelection: '',
  snapshottedGroupName: '',
  snapshottedSizeKeys: [],
  sewingSam: '',
  priority: 'normal',
  garmentType: '',
  merchantName: '',
  orderType: 'new',
  season: '',
  internalOrderNo: '',
  factoryCode: '',
  styleImage: '',
  showImageInput: false,
  cuttingAllowance: 2,
  applyExtraAllowance: false,
  remarks: '',
};

export type HeaderAction =
  | { type: 'setField'; field: keyof HeaderState; value: HeaderState[keyof HeaderState] }
  | { type: 'setBuyer'; buyerId: string }
  | { type: 'setSizeGroup'; value: string; snapshottedGroupName?: string; snapshottedSizeKeys?: string[] }
  | { type: 'setImage'; image: string; showInput?: boolean }
  | { type: 'setAllowances'; cuttingAllowance: number; applyExtraAllowance: boolean }
  | { type: 'hydrate'; header: Partial<HeaderState> }
  | { type: 'reset' };

function headerReducer(state: HeaderState, action: HeaderAction): HeaderState {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value };
    case 'setBuyer':
      return { ...state, selectedBuyer: action.buyerId };
    case 'setSizeGroup':
      return {
        ...state,
        sizeGroupSelection: action.value,
        snapshottedGroupName: action.snapshottedGroupName ?? state.snapshottedGroupName,
        snapshottedSizeKeys: action.snapshottedSizeKeys ?? state.snapshottedSizeKeys,
      };
    case 'setImage':
      return {
        ...state,
        styleImage: action.image,
        showImageInput: action.showInput ?? state.showImageInput,
      };
    case 'setAllowances':
      return {
        ...state,
        cuttingAllowance: action.cuttingAllowance,
        applyExtraAllowance: action.applyExtraAllowance,
      };
    case 'hydrate':
      return { ...state, ...action.header };
    case 'reset':
      return { ...initialHeaderState, factoryCode: state.factoryCode };
    default:
      return state;
  }
}

export function useHeaderReducer(initial: Partial<HeaderState> = {}) {
  const [state, dispatch] = useReducer(headerReducer, { ...initialHeaderState, ...initial });
  return { state, dispatch } as const;
}
