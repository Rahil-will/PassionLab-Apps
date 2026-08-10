import React from 'react';
import { Plus } from 'lucide-react';
import { Card } from '../../../../components/ui';
import { ShipmentPlanPanel, type ShipmentPlanPanelHandle } from '../../../../components/production/ShipmentPlanPanel';
import type { Colorway } from '../../../../types';
import type { ShipmentAction, ShipmentState } from '../hooks/useShipmentReducer';

interface ShipmentPlanSectionProps {
  shipmentState: ShipmentState;
  shipmentDispatch: React.Dispatch<ShipmentAction>;
  shipmentPlanRef: React.RefObject<ShipmentPlanPanelHandle>;
  colorways: Colorway[];
  displaySizes: string[];
  shipModes: string[];
  shipmentTypes: string[];
  destinationCountries: string[];
  jobCardDate?: string;
  disabled?: boolean;
  requireDateChangeReason?: boolean;
}

export const ShipmentPlanSection: React.FC<ShipmentPlanSectionProps> = ({
  shipmentState,
  shipmentDispatch,
  shipmentPlanRef,
  colorways,
  displaySizes,
  shipModes,
  shipmentTypes,
  destinationCountries,
  jobCardDate,
  disabled = false,
  requireDateChangeReason = false,
}) => {
  return (
    <div className="col-span-12 w-full">
      <Card
        title="Shipment Plan"
        subtitle={
          shipmentState.plan.lines.length > 0
            ? `${shipmentState.plan.lines.length} line${shipmentState.plan.lines.length !== 1 ? 's' : ''} · ${shipmentState.plan.lines
                .filter((l) => l.status !== 'rescheduled')
                .reduce((sum, l) => sum + Object.values(l.sizes).reduce((a, b) => a + (b || 0), 0), 0)
                .toLocaleString()} pcs planned`
            : 'Enter shipment date, mode, type and qty per colour per size'
        }
        action={
          !disabled ? (
            <button
              type="button"
              onClick={() => shipmentPlanRef.current?.addLine()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Plus size={12} /> Add Plan
            </button>
          ) : undefined
        }
        className="shadow-sm border-slate-200 w-full overflow-visible"
        noPadding
      >
        <ShipmentPlanPanel
          ref={shipmentPlanRef}
          plan={shipmentState.plan}
          onChange={(next) => shipmentDispatch({ type: 'setPlan', plan: next })}
          colorways={colorways}
          displaySizes={displaySizes}
          shipModes={shipModes}
          shipmentTypes={shipmentTypes}
          destinationCountries={destinationCountries}
          jobCardDate={jobCardDate}
          disabled={disabled}
          requireDateChangeReason={requireDateChangeReason}
        />
      </Card>
    </div>
  );
};
