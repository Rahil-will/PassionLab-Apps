import React, { useState } from 'react';
import { createPortal } from 'react-dom';

export function AppliesToChip({
  ids,
  types,
  disabled = false,
  onChange,
}: {
  ids: string[] | null;
  types: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const known = ids?.filter((id) => types.some((type) => type.id === id)) ?? [];
  const all = ids == null || (types.length > 0 && known.length === types.length);
  const label = all
    ? 'All'
    : types.filter((type) => known.includes(type.id)).map((type) => type.name).join(', ') || 'All';

  function commit(nextIds: string[]) {
    if (nextIds.length === 0) return;
    if (types.length > 0 && nextIds.length === types.length) onChange(null);
    else onChange(nextIds);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setBox({ top: rect.bottom + 4, left: rect.left });
          setOpen((value) => !value);
        }}
        className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-blue-300 disabled:opacity-50 disabled:pointer-events-none"
      >
        <span className="truncate">{label}</span>
      </button>
      {open && box && createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[80] cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[81] w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
            style={{ top: box.top, left: box.left }}
            onClick={(event) => event.stopPropagation()}
          >
            <label className="flex items-center gap-2 px-1 py-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={all} onChange={() => onChange(null)} />
              All
            </label>
            {types.map((type) => {
              const checked = all || known.includes(type.id);
              return (
                <label key={type.id} className="flex items-center gap-2 px-1 py-1 text-[11px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (all) commit(types.map((row) => row.id).filter((id) => id !== type.id));
                      else if (known.includes(type.id)) commit(known.filter((id) => id !== type.id));
                      else commit([...known, type.id]);
                    }}
                  />
                  {type.name}
                </label>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
