/**
 * FabricPicker — searchable combobox over live fabrics. Archived fabrics are excluded.
 * Footer "New fabric" opens FabricFormDrawer in quick mode.
 */
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { computeDropdownBelowPosition } from '../../../lib/popoverPosition';
import { fabricSpecLine } from '../lib/fabricLabels';
import { useMmFabrics } from '../lib/useMmFabrics';
import type { MmFabric, MmFabricUom } from '../lib/mmFabricRpc';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';

const FabricFormDrawer = lazy(() =>
  import('./FabricFormDrawer').then((m) => ({ default: m.FabricFormDrawer })),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FabricPickerProps {
  value: string | null;
  onChange: (fabric: MmFabric) => void;
  filter?: {
    fabric_type_id?: string;
    uom?: MmFabricUom;
  };
  excludeIds?: string[];
  disabled?: boolean;
  /** Slot rendered after the selected fabric's spec line (e.g. stock badge). */
  renderStockSlot?: (fabric: MmFabric) => React.ReactNode;
  label?: string;
  placeholder?: string;
  error?: string;
  /** `cell` = borderless grid cell (Shipment Plan style). */
  variant?: 'default' | 'cell';
  onClear?: () => void;
  /** Shown when the selected id is not in the loaded list (locked style-line receipts). */
  fallback?: { code: string; name: string } | null;
  /** Hide the spec line under the selected fabric. The open list still shows it. */
  compactSelected?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FabricPicker({
  value,
  onChange,
  filter,
  excludeIds,
  disabled = false,
  renderStockSlot,
  label,
  placeholder = 'Search fabric…',
  error,
  variant = 'default',
  onClear,
  fallback = null,
  compactSelected = false,
}: FabricPickerProps) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const isCell = variant === 'cell';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerName, setDrawerName] = useState('');

  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 320 });

  const { rows, loading } = useMmFabrics({
    search: search.trim() || undefined,
    fabric_type_id: filter?.fabric_type_id || undefined,
    status: ['active'],
    limit: 100,
  });

  // Filter locally for uom + excludeIds
  const filtered = rows.filter((f) => {
    if (f.status === 'inactive') return false;
    if (filter?.uom && f.uom !== filter.uom) return false;
    if (excludeIds?.includes(f.id)) return false;
    return true;
  });

  // Find selected fabric from results (or keep stale)
  const [selectedFabric, setSelectedFabric] = useState<MmFabric | null>(null);
  useEffect(() => {
    if (!value) { setSelectedFabric(null); return; }
    const found = rows.find((f) => f.id === value);
    if (found) setSelectedFabric(found);
  }, [value, rows]);

  // Position menu under trigger
  useEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const update = () => {
      if (!triggerRef.current || !menuRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      const panelW = Math.max(r.width, 320);
      const panelH = menuRef.current.offsetHeight || 240;
      const { left, top } = computeDropdownBelowPosition(r, panelW, panelH);
      setMenuPos({ top, left, width: panelW });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, filtered.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input when menu opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearch('');
    }
  }, [open]);

  function handleSelect(fabric: MmFabric) {
    onChange(fabric);
    setSelectedFabric(fabric);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedFabric(null);
    onClear?.();
    setOpen(false);
  }

  function openDrawer() {
    setDrawerName(search.trim());
    setOpen(false);
    setDrawerOpen(true);
  }

  const hasError = Boolean(error);
  const shown = selectedFabric
    ? { id: selectedFabric.id, code: selectedFabric.code, name: selectedFabric.name }
    : value && fallback && (fallback.code || fallback.name)
      ? { id: value, code: fallback.code, name: fallback.name }
      : null;

  const menu = open && !disabled ? (
    <div
      ref={menuRef}
      className="bg-white border border-slate-200 rounded-xl shadow-lg ring-1 ring-slate-100 z-[250] flex flex-col overflow-hidden"
      style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width, maxHeight: 360 }}
    >
      {/* Search input */}
      <div className="p-2 border-b border-slate-100 shrink-0">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
        />
      </div>

      {/* Options */}
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[10px] text-slate-400 py-6">No fabrics found</p>
        ) : (
          filtered.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => handleSelect(f)}
              className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-b-0 transition-colors ${
                value === f.id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-500 shrink-0">{f.code}</span>
                <span className="text-[11px] font-semibold text-slate-800 truncate">{f.name}</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate pl-0">
                {fabricSpecLine(f)}
              </p>
            </button>
          ))
        )}
      </div>

      {/* Footer: new fabric */}
      <div className="border-t border-slate-100 p-2 shrink-0">
        <button
          type="button"
          onClick={openDrawer}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <Plus size={13} />
          {search.trim() ? `New fabric "${search.trim()}"` : 'New fabric'}
        </button>
      </div>
    </div>
  ) : null;

  const triggerCls = isCell
    ? `relative flex items-center gap-1.5 w-full min-h-[2.75rem] h-auto py-1 px-2 cursor-pointer select-none transition-colors ${
        disabled
          ? 'bg-slate-50 cursor-not-allowed opacity-60'
          : hasError
            ? 'bg-red-50'
            : open
              ? 'bg-blue-50/50 ring-1 ring-inset ring-blue-400'
              : 'hover:bg-slate-50/40'
      }`
    : `relative flex items-center gap-2 border rounded-full px-3 py-1.5 cursor-pointer select-none transition-colors min-h-8 ${
        disabled
          ? 'bg-slate-50 border-slate-200 cursor-not-allowed opacity-60'
          : hasError
            ? 'border-red-400 bg-red-50'
            : open || selectedFabric
              ? 'border-blue-300 bg-blue-50/40'
              : 'border-slate-300 bg-white hover:border-slate-400'
      }`;

  return (
    <>
      <div className="w-full h-full">
        {label && !isCell && (
          <label className={`block text-[10px] font-semibold mb-1 ${hasError ? 'text-red-600' : 'text-slate-600'}`}>
            {label}
          </label>
        )}
        <div
          ref={triggerRef}
          onClick={() => !disabled && setOpen(!open)}
          role="combobox"
          aria-expanded={open}
          className={triggerCls}
        >
          <div className="flex-1 min-w-0">
            {shown ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  className="text-[10px] font-mono text-blue-700 underline underline-offset-2 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestNavigate(RoutePath.MATERIAL_FABRIC_DETAIL, { fabricId: shown.id });
                  }}
                >{shown.code || '—'}</button>
                {compactSelected ? null : (
                  <span className="text-[11px] font-semibold text-slate-800 truncate">
                    {shown.name}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">{placeholder}</span>
            )}
            {selectedFabric && !compactSelected ? (
              <p className={`truncate leading-tight mt-0.5 ${isCell ? 'text-[9px] text-slate-500' : 'text-[9px] text-slate-400'}`}>
                {fabricSpecLine(selectedFabric)}
              </p>
            ) : null}
            {selectedFabric ? renderStockSlot?.(selectedFabric) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {selectedFabric && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="p-0.5 text-slate-400 hover:text-slate-600"
                aria-label="Clear"
              >
                <X size={13} />
              </button>
            )}
            {disabled ? null : (
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
              />
            )}
          </div>
        </div>
        {hasError && !isCell && (
          <p className="mt-1 text-[10px] text-red-600">{error}</p>
        )}
      </div>

      {menu && createPortal(menu, document.body)}

      {drawerOpen ? (
        <Suspense fallback={null}>
          <FabricFormDrawer
            open={drawerOpen}
            mode="quick"
            initialName={drawerName}
            onClose={() => setDrawerOpen(false)}
            onSaved={(fabric) => {
              handleSelect(fabric);
              setDrawerOpen(false);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
