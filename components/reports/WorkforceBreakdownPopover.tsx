import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users } from 'lucide-react';
import type { WorkforceCategoryCount } from '../../lib/mesReportsApi';

export interface WorkforceBreakdownPopoverProps {
  total: number | null;
  breakdown: WorkforceCategoryCount[];
  deptName: string;
}

export const WorkforceBreakdownPopover: React.FC<WorkforceBreakdownPopoverProps> = ({
  total,
  breakdown,
  deptName,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const show = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    updatePosition();
    setOpen(true);
  };

  const hide = () => {
    hoverTimer.current = setTimeout(() => setOpen(false), 150);
  };

  if (total == null || total <= 0) {
    return <span className="text-slate-300">—</span>;
  }

  const popover = open ? (
    <div
      ref={wrapRef}
      className="fixed z-[9999] min-w-[10rem] max-w-[14rem] rounded-xl border border-blue-200 bg-white shadow-xl p-2.5 -translate-x-1/2 -translate-y-full"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <p className="text-[8px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
        {deptName} · WF split
      </p>
      {breakdown.length === 0 ? (
        <p className="text-[9px] text-slate-400">No category breakdown logged</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {breakdown.map((row) => (
            <span
              key={row.category}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 border border-blue-100 text-[9px]"
            >
              <span className="text-slate-500 truncate max-w-[5rem]">{row.category}</span>
              <span className="font-semibold tabular-nums text-blue-800">{row.count}</span>
            </span>
          ))}
        </div>
      )}
      <p className="text-[8px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100 tabular-nums">
        Total: {total}
      </p>
    </div>
  ) : null;

  return (
    <>
      <div className="inline-block" onMouseEnter={show} onMouseLeave={hide}>
        <button
          ref={btnRef}
          type="button"
          onClick={() => {
            updatePosition();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-0.5 text-blue-700 hover:text-blue-900 underline decoration-dotted underline-offset-2"
          title="View workforce split"
        >
          <Users size={10} className="shrink-0 opacity-70" />
          {total}
        </button>
      </div>
      {popover && createPortal(popover, document.body)}
    </>
  );
};
