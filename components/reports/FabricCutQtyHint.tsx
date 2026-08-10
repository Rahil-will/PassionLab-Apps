import React from 'react';
import type { FabricCutQtyComponentRow } from '../../lib/fabricCutQtyDisplay';
import { formatFabricCutQtyTooltip } from '../../lib/fabricCutQtyDisplay';

interface FabricCutQtyHintProps {
  qty: number;
  source?: string;
  components?: FabricCutQtyComponentRow[];
  className?: string;
}

/** Headline cut qty with hover breakdown by fabric component. */
export const FabricCutQtyHint: React.FC<FabricCutQtyHintProps> = ({
  qty,
  source,
  components = [],
  className = '',
}) => {
  const tooltip = formatFabricCutQtyTooltip(components);
  const title = [
    source === 'captured' ? 'Captured cut qty (primary fabric)' : 'Cut qty',
    tooltip,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span className={className} title={title || undefined}>
      {qty.toLocaleString()}
      {components.length > 1 && (
        <span className="ml-1 text-[9px] font-normal text-slate-400 no-print">+detail</span>
      )}
    </span>
  );
};
