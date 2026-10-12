import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { LucideIcon, X, CheckCircle2, AlertCircle, ChevronDown, Search } from 'lucide-react';
import { tokens } from '../lib/designTokens';
import { computeDropdownBelowPosition } from '../lib/popoverPosition';

export { Skeleton, TableSkeleton, CardSkeleton, ListSkeleton, Spinner, LoadingOverlay } from './Skeleton';

// --- BUTTON ---
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-light' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', icon: Icon, children, className = '', ...props }) => {
  const base = "inline-flex items-center justify-center font-medium transition-all focus:outline-none disabled:opacity-50 disabled:pointer-events-none rounded-lg select-none";
  
  const variants = {
    primary: "bg-primary-600 text-white hover:bg-primary-700 shadow-sm hover:shadow",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    'danger-light': "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    icon: "p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-slate-700 aspect-square"
  };
  
  const sizes = {
    sm: "h-8 px-3",
    md: "h-10 px-4",
    lg: "h-12 px-6"
  };
  
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 18;

  const fontSizeMap = {
    sm: tokens.fontSize.caption,
    md: tokens.fontSize.bodySmall,
    lg: tokens.fontSize.body,
  };

  return (
    <button className={`${base} ${variants[variant]} ${variant !== 'icon' ? sizes[size] : ''} ${className}`} style={{ fontSize: fontSizeMap[size] }} {...props}>
      {Icon && <Icon size={iconSize} className={children ? "mr-2" : ""} />}
      {children}
    </button>
  );
};

// --- STATUS POINT ---
interface StatusPointProps {
    status: string;
    type?: 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'neutral';
    className?: string;
}

export const StatusPoint: React.FC<StatusPointProps> = ({ status, type = 'default', className = '' }) => {
    let colorClass = 'bg-slate-400';
    if (type === 'success') colorClass = 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]';
    if (type === 'warning') colorClass = 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
    if (type === 'danger') colorClass = 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
    if (type === 'primary') colorClass = 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]';
    if (type === 'neutral') colorClass = 'bg-slate-300';

    return (
        <div className={`flex items-center gap-2.5 ${className}`}>
            <div className={`w-2 h-2 rounded-full ${colorClass}`}></div>
            <span className="text-[10px] font-medium text-slate-700">{status}</span>
        </div>
    );
};

// --- CARD ---
interface CardProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
  titleClassName?: string;
  subtitleClassName?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
  noPadding = false,
  titleClassName,
  subtitleClassName,
}) => (
  <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${className}`}>
    {(title || action) && (
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl shrink-0">
        <div>
          {title && (
            <h3
              className={`font-semibold text-slate-900 ${titleClassName ?? ''}`}
              style={titleClassName ? undefined : { fontSize: tokens.fontSize.h4 }}
            >
              {title}
            </h3>
          )}
          {subtitle && (
            <p
              className={`text-slate-500 mt-0.5 ${subtitleClassName ?? ''}`}
              style={subtitleClassName ? undefined : { fontSize: tokens.fontSize.caption }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className={`${noPadding ? 'p-0' : 'p-6'} flex-1 flex flex-col min-h-0`}>{children}</div>
  </div>
);

// --- MODAL ---
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, className = '' }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const modal = modalRef.current;
    const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && (el as HTMLElement).tabIndex !== -1,
    );
    const target = focusable[0] ?? modal;
    target.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div 
        ref={modalRef}
        tabIndex={-1}
        className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden transform transition-all scale-100 border border-slate-200 outline-none ${className || 'max-w-md'}`}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
};

// --- INPUT ---
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: boolean | string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', id, name, ...props }) => {
  const autoId = React.useId();
  const fieldId = id || name || autoId;
  const hasError = Boolean(error);
  const errorMsg = typeof error === 'string' ? error : '';
  return (
  <div className={`w-full ${className}`}>
    {label && <label htmlFor={fieldId} className={`block font-medium mb-1.5 ${hasError ? 'text-red-600' : 'text-slate-700'}`} style={{ fontSize: tokens.fontSize.body }}>{label}</label>}
    <input
      id={fieldId}
      name={name || id}
      className={`w-full bg-white border ${hasError ? 'border-red-500 focus:border-red-600 focus:ring-red-100 ring-2 ring-red-50' : 'border-slate-300 focus:border-primary-500 focus:ring-primary-100'} rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 transition-all shadow-sm`}
      style={{ fontSize: tokens.fontSize.body }}
      {...props}
    />
    {errorMsg && <p className="mt-1.5 text-[10px] text-red-600">{errorMsg}</p>}
  </div>
  );
};

// --- SELECT DROPDOWN (portal menu — same pattern as Create Order) ---
interface SelectDropdownBaseProps {
  options: { value: string; label: string }[];
  placeholder?: string;
  icon?: LucideIcon;
  className?: string;
  label?: string;
  id?: string;
  name?: string;
  /** `form` = Create Order style; `tab` = style detail tabs (compact uppercase label). */
  labelVariant?: 'form' | 'tab';
  error?: boolean | string;
  disabled?: boolean;
  /** `compact` + `align` for table cells (e.g. shipment plan). */
  size?: 'default' | 'compact';
  align?: 'start' | 'center';
  /** `'pill'` = default rounded-full; `'none'` = no rounding (for table cells). */
  shape?: 'pill' | 'none';
  /** `cell` = borderless trigger for tables; menu stays the shared rounded card. */
  variant?: 'default' | 'cell';
  /** When true, menu grows to fit all options (no max-height scroll). */
  menuExpand?: boolean;
  /** Search field at the top of the open menu. Filters options by label. */
  searchable?: boolean;
  /** @deprecated Menus always render in a portal; prop is ignored. */
  menuFixed?: boolean;
}

type SelectDropdownProps = SelectDropdownBaseProps & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
);

const dropdownMenuBaseCls =
  'bg-white/95 backdrop-blur-sm border border-slate-200/90 rounded-xl shadow-lg ring-1 ring-slate-100/80 z-[250]';
const dropdownMenuScrollCls = 'max-h-60 overflow-y-auto hairline-scrollbar';

export const SelectDropdown: React.FC<SelectDropdownProps> = (props) => {
  const {
    options,
    placeholder = 'Select...',
    icon: Icon,
    className = '',
    label,
    id,
    name,
    labelVariant = 'form',
    error,
    disabled = false,
    size = 'default',
    align = 'start',
    shape = 'pill',
    variant = 'default',
    menuExpand = false,
    searchable = false,
  } = props;
  const isMulti = props.multiple === true;
  const selectedValues = isMulti ? props.value : (props.value ? [props.value] : []);
  const autoId = React.useId();
  const fieldId = id || name || autoId;
  const listboxId = `${fieldId}-listbox`;
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuQuery, setMenuQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const menuQueryNorm = menuQuery.trim().toLowerCase();
  const visibleOptions = searchable && menuQueryNorm
    ? options
        .map((opt, idx) => ({ opt, idx }))
        .filter(({ opt }) => opt.label.toLowerCase().includes(menuQueryNorm))
    : options.map((opt, idx) => ({ opt, idx }));

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current || !menuRef.current) return;
    const update = () => {
      const r = buttonRef.current!.getBoundingClientRect();
      const panelW = menuRef.current!.offsetWidth || r.width;
      const panelH = menuRef.current!.offsetHeight || 200;
      const { left, top } = computeDropdownBelowPosition(r, panelW, panelH);
      setMenuPos({ top, left, width: Math.max(r.width, 120) });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [isOpen, options.length, props.value, searchable, menuQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (dropdownRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setMenuQuery('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !searchable) return;
    const id = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [isOpen, searchable]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = isMulti
      ? options.findIndex((o) => o.value !== '' && Array.isArray(props.value) && props.value.includes(o.value))
      : options.findIndex((o) => o.value === props.value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
    // Highlight is only set when the menu opens; keep it stable while toggling options.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isOpen is the intended trigger
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex((i) => (visibleOptions.length ? Math.min(i, visibleOptions.length - 1) : 0));
  }, [visibleOptions.length]);

  const selectedLabel = (() => {
    if (isMulti) {
      if (selectedValues.length === 0) {
        return options.find((opt) => opt.value === '')?.label || placeholder;
      }
      const labels = selectedValues
        .map((v) => options.find((opt) => opt.value === v)?.label)
        .filter((label): label is string => Boolean(label));
      return labels.join(', ') || placeholder;
    }
    return options.find((opt) => opt.value === props.value)?.label || placeholder;
  })();
  const hasValue = isMulti ? selectedValues.length > 0 : props.value !== '';
  const hasError = Boolean(error);
  const errorMsg = typeof error === 'string' ? error : '';

  const isOptionSelected = (optValue: string) => {
    if (isMulti) {
      if (optValue === '') return selectedValues.length === 0;
      return selectedValues.includes(optValue);
    }
    return props.value === optValue;
  };

  const selectOption = (idx: number) => {
    const opt = options[idx];
    if (!opt) return;
    if (isMulti) {
      if (opt.value === '') {
        props.onChange([]);
        setIsOpen(false);
        return;
      }
      const next = selectedValues.includes(opt.value)
        ? selectedValues.filter((v) => v !== opt.value)
        : [...selectedValues, opt.value];
      const realCount = options.filter((o) => o.value !== '').length;
      props.onChange(next.length === realCount ? [] : next);
      return;
    }
    props.onChange(opt.value);
    setIsOpen(false);
  };

  const selectVisible = (visibleIdx: number) => {
    const entry = visibleOptions[visibleIdx];
    if (!entry) return;
    selectOption(entry.idx);
  };

  const handleMenuKey = (e: React.KeyboardEvent) => {
    const max = visibleOptions.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (max >= 0) setHighlightedIndex((i) => (i >= max ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (max >= 0) setHighlightedIndex((i) => (i <= 0 ? max : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen) selectVisible(highlightedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const max = visibleOptions.length - 1;
    if (max < 0) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const selectedIdx = isMulti
        ? options.findIndex((o) => o.value !== '' && selectedValues.includes(o.value))
        : options.findIndex((o) => o.value === props.value);
      setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
      setIsOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i >= max ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? max : i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlightedIndex(max);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) selectVisible(highlightedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  const activeDescendant = isOpen && visibleOptions[highlightedIndex]
    ? `${listboxId}-opt-${visibleOptions[highlightedIndex].idx}`
    : undefined;

  const labelCls =
    labelVariant === 'tab'
      ? `block text-[8px] font-bold uppercase tracking-wider mb-1 ${hasError ? 'text-red-600' : 'text-slate-400'}`
      : `block font-medium mb-1.5 ${hasError ? 'text-red-600' : 'text-slate-700'}`;

  const menu = isOpen && !disabled ? (
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-multiselectable={isMulti || undefined}
      className={`${dropdownMenuBaseCls} p-1.5`}
      style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width, minWidth: 120 }}
    >
      {searchable ? (
        <div className="px-1 pb-1.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2">
            <Search size={12} className="shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={menuQuery}
              onChange={(e) => {
                setMenuQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleMenuKey}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Search"
              className="w-full bg-transparent py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none"
              aria-label="Search"
            />
          </div>
        </div>
      ) : null}
      <div className={menuExpand ? '' : dropdownMenuScrollCls}>
      {visibleOptions.length === 0 ? (
        searchable ? <p className="px-3 py-2 text-[11px] text-slate-400">No matches</p> : null
      ) : visibleOptions.map(({ opt, idx }, visibleIdx) => {
        const selected = isOptionSelected(opt.value);
        return (
          <div
            key={opt.value || '__empty__'}
            id={`${listboxId}-opt-${idx}`}
            role="option"
            aria-selected={selected}
            onClick={() => selectOption(idx)}
            onMouseEnter={() => setHighlightedIndex(visibleIdx)}
            className={`flex items-center justify-between rounded-lg cursor-pointer transition-colors ${
              size === 'compact' ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs'
            } ${
              visibleIdx === highlightedIndex
                ? 'bg-blue-100 text-blue-800'
                : selected
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'hover:bg-slate-50 text-slate-600'
            }`}
          >
            {opt.label}
            {selected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
          </div>
        );
      })}
      </div>
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {label && (
        <label
          htmlFor={fieldId}
          className={labelCls}
          style={labelVariant === 'form' ? { fontSize: tokens.fontSize.body } : undefined}
        >
          {label}
        </label>
      )}
      <button
        ref={buttonRef}
        id={fieldId}
        name={name}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        disabled={disabled}
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        onKeyDown={handleKeyDown}
        className={`relative flex items-center gap-2 font-medium transition-colors w-full select-none ${
          variant === 'cell'
            ? `rounded-none border-0 min-h-8 h-full pl-2.5 pr-2 py-0 text-[11px] leading-8 outline-none items-center whitespace-normal bg-transparent ${
                align === 'center' ? 'text-center' : 'text-left'
              } ${
                disabled ? 'opacity-50 cursor-not-allowed text-slate-400' :
                hasError ? 'text-red-700' :
                hasValue ? 'text-slate-700' : 'text-slate-300'
              }`
            : `${shape === 'none' ? 'rounded-none' : 'rounded-full'} border ${
                size === 'compact' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              } ${
                disabled ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400' :
                hasError ? 'border-red-400 bg-red-50 text-red-700' :
                isOpen || hasValue ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`
        } ${align === 'center' ? 'justify-center' : 'justify-between'}`}
      >
        <div className={`flex items-center gap-2 min-w-0 ${align === 'center' ? `justify-center flex-1 ${variant === 'cell' ? '' : 'px-4'}` : ''} ${variant === 'cell' ? 'flex-1' : ''}`}>
          {Icon && align !== 'center' && <Icon size={13} className="shrink-0" />}
          <span className={`min-w-0 flex-1 ${variant === 'cell' ? 'whitespace-normal break-all' : 'truncate'} ${align === 'center' ? 'text-center' : 'text-left'}`}>{selectedLabel}</span>
        </div>
        <ChevronDown
          size={size === 'compact' ? 11 : 13}
          className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''} ${align === 'center' ? 'absolute right-2' : ''}`}
        />
      </button>

      {menu && createPortal(menu, document.body)}
      {errorMsg && <p className="mt-1.5 text-[10px] text-red-600">{errorMsg}</p>}
    </div>
  );
};
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  error?: boolean;
}

export const Select: React.FC<SelectProps> = ({ label, options, error, className = '', ...props }) => (
  <div className={`w-full ${className}`}>
    {label && <label className={`block font-medium mb-1.5 ${error ? 'text-red-600' : 'text-slate-700'}`} style={{ fontSize: tokens.fontSize.body }}>{label}</label>}
    <select 
      className={`w-full bg-white border ${error ? 'border-red-500 focus:border-red-600 focus:ring-red-100 ring-2 ring-red-50' : 'border-slate-300 focus:border-primary-500 focus:ring-primary-100'} rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-4 transition-all shadow-sm appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2364748b%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px] bg-no-repeat bg-[right_1rem_center] pr-8`}
      style={{ fontSize: tokens.fontSize.body }}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);

// --- TABLE ---
interface TableProps {
  headers: string[];
  children: React.ReactNode;
  className?: string;
  headerAligns?: ('left' | 'center' | 'right')[];
}

export const Table: React.FC<TableProps> = ({ headers, children, className = '', headerAligns = [] }) => (
  <div className={`overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white ${className}`}>
    <table className="w-full text-left min-w-[600px]" style={{ fontSize: tokens.fontSize.body }}>
      <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 uppercase tracking-wider">
        <tr>
          {headers.map((h, i) => (
            <th key={i} className={`px-6 py-3.5 text-${headerAligns[i] || 'left'}`} style={{ fontSize: tokens.fontSize.caption }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {children}
      </tbody>
    </table>
  </div>
);

// --- BADGE ---
interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'outline';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => {
  const variants = {
    default: "bg-slate-100 text-slate-600 border-slate-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    primary: "bg-blue-50 text-blue-700 border-blue-200",
    outline: "bg-transparent text-slate-500 border-slate-300"
  };
  // Changed rounded-full to rounded-md for less pill-like appearance
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md font-medium border ${variants[variant]} ${className}`} style={{ fontSize: tokens.fontSize.caption }}>
      {children}
    </span>
  );
};

// --- TOAST NOTIFICATION ---
interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'success', onClose }) => (
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border animate-in slide-in-from-top-4 fade-in duration-300 ${type === 'success' ? 'bg-white border-emerald-200 text-emerald-900' : 'bg-white border-red-200 text-red-900'}`}>
    {type === 'success' ? (
      <div className="bg-emerald-100 p-1.5 rounded-full text-emerald-600"><CheckCircle2 size={18} /></div>
    ) : (
      <div className="bg-red-100 p-1.5 rounded-full text-red-600"><AlertCircle size={18} /></div>
    )}
    <span className="font-bold" style={{ fontSize: tokens.fontSize.bodySmall }}>{message}</span>
    <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-600"><X size={16}/></button>
  </div>
);
