import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FabricCutQtyComponentRow } from '../../lib/fabricCutQtyDisplay';

interface FabricOutputBreakdownPopoverProps {
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

  if (components.length === 0) {
    return value > 0 ? <>{value.toLocaleString()}</> : <span className="text-slate-200">—</span>;
  }

  const rows = components.map((component) => ({
    ...component,
    value: size ? Number(component.by_size?.[size]) || 0 : component.total,
  }));

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
    </div>
  ) : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="font-inherit tabular-nums text-inherit underline decoration-dotted underline-offset-2 hover:text-blue-700"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(event) => {
          event.stopPropagation();
          updatePosition();
          setOpen((current) => !current);
        }}
      >
        {value > 0 ? value.toLocaleString() : '—'}
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
};
