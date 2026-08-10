import { useReducer } from 'react';
import {
  EMPTY_ORDER_SHIPMENT_PLAN,
  pruneShipmentPlan,
  type OrderShipmentPlan,
} from '../../../../lib/orderShipmentPlan';

export interface ShipmentState {
  plan: OrderShipmentPlan;
}

export const initialShipmentState: ShipmentState = {
  plan: { ...EMPTY_ORDER_SHIPMENT_PLAN },
};

export type ShipmentAction =
  | { type: 'setPlan'; plan: OrderShipmentPlan }
  | { type: 'hydrate'; plan: OrderShipmentPlan }
  | { type: 'prune'; colorwayIds: string[]; displaySizes: string[] }
  | { type: 'reset' };

function shipmentReducer(state: ShipmentState, action: ShipmentAction): ShipmentState {
  switch (action.type) {
    case 'setPlan':
      return { plan: action.plan };
    case 'hydrate':
      return { plan: action.plan };
    case 'prune':
      return { plan: pruneShipmentPlan(state.plan, action.colorwayIds, action.displaySizes) };
    case 'reset':
      return { ...initialShipmentState };
    default:
      return state;
  }
}

export function useShipmentReducer(initial: Partial<ShipmentState> = {}) {
  const [state, dispatch] = useReducer(shipmentReducer, { ...initialShipmentState, ...initial });
  return { state, dispatch } as const;
}
