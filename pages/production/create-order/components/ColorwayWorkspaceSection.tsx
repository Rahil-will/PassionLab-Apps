import React, { useMemo } from 'react';
import { Card } from '../../../../components/ui';
import { ColorQtyWorkspace } from '../../../../components/production/ColorQtyWorkspace';
import { sizeOrderQty, sizeAdjQty, sumSizeOrderQty, sumSizeAdjQty } from '../../../../lib/colorwaySizesUtils';
import { useNotificationStore } from '../../../../stores';
import type { HeaderState } from '../hooks/useHeaderReducer';
import type { ColorwayAction, ColorwayState } from '../hooks/useColorwayReducer';

interface ColorwayWorkspaceSectionProps {
  colorwayState: ColorwayState;
  colorwayDispatch: React.Dispatch<ColorwayAction>;
  displaySizes: string[];
  totalAllowancePct: number;
  hasSizeContext: boolean;
  headerState: HeaderState;
  buyerExtraPct: number;
}

export const ColorwayWorkspaceSection: React.FC<ColorwayWorkspaceSectionProps> = ({
  colorwayState,
  colorwayDispatch,
  displaySizes,
  totalAllowancePct,
  hasSizeContext,
  headerState,
  buyerExtraPct,
}) => {
  const { showNotification } = useNotificationStore();

  const { aggregateBySize, totalOrderQty, totalAdjustedQty } = useMemo(() => {
    const sizes = displaySizes;
    const data: Record<string, { order: number; adjusted: number }> = {};
    sizes.forEach((s) => {
      data[s] = { order: 0, adjusted: 0 };
    });
    colorwayState.colorways.forEach((cw) => {
      cw.sizes.forEach((s) => {
        if (!data[s.size]) data[s.size] = { order: 0, adjusted: 0 };
        data[s.size].order += sizeOrderQty(s);
        data[s.size].adjusted += sizeAdjQty(s);
      });
    });
    const order = Object.values(data).reduce((a, b) => a + b.order, 0);
    const adjusted = Object.values(data).reduce((a, b) => a + b.adjusted, 0);
    return { aggregateBySize: data, totalOrderQty: order, totalAdjustedQty: adjusted };
  }, [colorwayState.colorways, displaySizes]);

  const handleAddColor = () => {
    if (!hasSizeContext) {
      showNotification('Select a size group first', 'error');
      return;
    }
    colorwayDispatch({
      type: 'addColor',
      payload: {
        name: '',
        sizes: displaySizes.map((size) => ({ size, order_qty: 0, adj_qty: 0 })),
      },
      displaySizes,
      totalAllowancePct,
    });
  };

  return (
    <div className="col-span-12 w-full">
      <Card
        title="Colors & Quantities"
        subtitle={[
          headerState.cuttingAllowance > 0 ? `Cut ${headerState.cuttingAllowance}%` : '',
          headerState.applyExtraAllowance && buyerExtraPct > 0 ? `Buyer ${buyerExtraPct}%` : '',
          totalAllowancePct > 0
            ? `Total ${totalAllowancePct.toFixed(1)}% allowance`
            : 'Add a colour row, then enter name and size quantities',
        ]
          .filter(Boolean)
          .join(' · ')}
        className="shadow-sm border-slate-200 w-full overflow-visible"
        noPadding
      >
        <ColorQtyWorkspace
          colorways={colorwayState.colorways}
          displaySizes={displaySizes}
          totalAllowancePct={totalAllowancePct}
          hasSizeContext={hasSizeContext}
          selectedColorId={colorwayState.selectedColorId}
          cuttingAllowance={headerState.cuttingAllowance}
          applyExtraAllowance={headerState.applyExtraAllowance}
          buyerExtraPct={buyerExtraPct}
          selectedBuyer={headerState.selectedBuyer}
          onSelectColor={(id) => colorwayDispatch({ type: 'selectColor', id })}
          readOnly={false}
          onAddColor={handleAddColor}
          onClearColorSelection={() => colorwayDispatch({ type: 'selectColor', id: null })}
          onNameChange={(id, name) => colorwayDispatch({ type: 'renameColor', id, name })}
          onOrderChange={(id, size, qty) =>
            colorwayDispatch({ type: 'updateOrderQty', id, size, qty, totalAllowancePct, displaySizes })
          }
          onAdjChange={(id, size, qty) => colorwayDispatch({ type: 'updateAdjQty', id, size, qty })}
          onDelete={(id) => colorwayDispatch({ type: 'deleteColor', id })}
          onCuttingAllowanceChange={() => {}}
          onToggleExtraAllowance={() => {}}
          onNotify={(msg) => showNotification(msg, 'error')}
          rowOrderTotal={(cw) => sumSizeOrderQty(cw.sizes)}
          rowAdjTotal={(cw) => sumSizeAdjQty(cw.sizes)}
          aggregateBySize={aggregateBySize}
          totalOrderQty={totalOrderQty}
          totalAdjustedQty={totalAdjustedQty}
        />
      </Card>
    </div>
  );
};
