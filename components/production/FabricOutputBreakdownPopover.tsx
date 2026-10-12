import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FabricCutQtyComponentRow } from '../../lib/fabricCutQtyDisplay';
import {
  fabricComponentQty,
  resolveCuttingCellDisplay,
} from '../../lib/fabricCutQtyDisplay';

interface FabricOutputBreakdownPopoverProps {
  /** Primary-fabric headline qty from size progress (0 when primary not cut). */
  value: number;
  components: FabricCutQtyComponentRow[];
  size?: string;
}

export const FabricOutputBreakdownPopover: React.FC<FabricOutputBreakdownPopoverProps> = ({
  value,
  components,
  size,
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { displayQty, secondaryOnly } = resolveCuttingCellDisplay({
    primaryValue: value,
    components,
    size,
  });

  const updatePosition = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.top - 6, left: rect.left + rect.width / 2 });
  };

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    updatePosition();
    setOpen(true);
  };

  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    if (!open) return;
    const refreshPosition = () => updatePosition();
    window.addEventListener('scroll', refreshPosition, true);
    window.addEventListener('resize', refreshPosition);
    return () => {
      window.removeEventListener('scroll', refreshPosition, true);
      window.removeEventListener('resize', refreshPosition);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  if (displayQty <= 0) {
    return <span className="text-slate-200">—</span>;
  }

  if (components.length === 0) {
    return <>{displayQty.toLocaleString()}</>;
  }

  const rows = components
    .map((component) => ({
      ...component,
      value: fabricComponentQty(component, size),
    }))
    .filter((component) => component.value > 0);

  const popover = open ? (
    <div
      ref={popoverRef}
      className="fixed z-[9999] min-w-[13rem] max-w-[18rem] -translate-x-1/2 -translate-y-full rounded-xl border border-blue-200 bg-white p-3 text-left shadow-xl"
      style={position}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <p className="mb-2 text-[8px] font-semibold uppercase tracking-wider text-slate-400">
        Fabric output{size ? ` · Size ${size}` : ''}
        {secondaryOnly ? ' · secondary only' : ''}
      </p>
      <div className="space-y-1">
        {rows.map((component) => (
          <div key={component.component_id || component.fabric_type} className="flex items-center justify-between gap-4 text-[10px]">
            <span className="min-w-0 truncate text-slate-600" title={component.remarks || component.fabric_type}>
              {component.fabric_type}{component.is_primary ? ' (primary)' : ''}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-800">{component.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {secondaryOnly && (
        <p className="mt-2 text-[9px] leading-snug text-slate-400">
          Primary fabric not cut yet — showing secondary cut qty.
        </p>
      )}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`font-inherit tabular-nums underline decoration-dotted underline-offset-2 ${
          secondaryOnly
            ? 'text-slate-400 hover:text-slate-600'
            : 'text-inherit hover:text-blue-700'
        }`}
        title={
          secondaryOnly
            ? 'Secondary fabric cut (primary not entered yet)'
            : undefined
        }
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(event) => {
          event.stopPropagation();
          updatePosition();
          setOpen((current) => !current);
        }}
      >
        {displayQty.toLocaleString()}
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
};
