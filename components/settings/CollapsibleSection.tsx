import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** When true, section cannot be collapsed (work center identity). */
  pinned?: boolean;
  defaultOpen?: boolean;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  icon: Icon,
  title,
  subtitle,
  children,
  pinned = false,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = pinned || open;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm w-full overflow-hidden">
      <button
        type="button"
        disabled={pinned}
        onClick={() => !pinned && setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-5 py-4 text-left ${
          pinned ? 'cursor-default' : 'hover:bg-slate-50/80 cursor-pointer'
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold text-slate-800">{title}</h4>
          <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {!pinned && (
          isOpen
            ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
            : <ChevronRight size={16} className="text-slate-400 shrink-0" />
        )}
      </button>
      {isOpen && <div className="px-5 pb-5 pt-0 border-t border-slate-100">{children}</div>}
    </div>
  );
};
