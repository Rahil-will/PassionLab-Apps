import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SelectDropdown } from '../../../components/ui';
import {
  applyFill,
  applyPaste,
  normalizeRange,
  parseTsv,
  serializeTsv,
  type SheetRange,
} from '../lib/mmSheetGrid';

export type SheetColumn = {
  key: string;
  label: string;
  editable?: boolean;
  kind?: 'text' | 'select';
  options?: { value: string; label: string }[];
  headerClassName?: string;
  cellClassName?: string;
  width?: string;
};

type Props = {
  columns: SheetColumn[];
  rowCount: number;
  getValue: (row: number, key: string) => string;
  onChange: (row: number, key: string, value: string) => void;
  isRowLocked?: (row: number) => boolean;
  emptyText?: string;
};

const thBase =
  'px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide border border-slate-200 bg-slate-50 text-slate-600 whitespace-nowrap text-center select-none';
const tdBase = 'relative border border-slate-200 h-8 min-w-[3.5rem] px-0 text-[11px] text-slate-800 text-center';

function inRange(range: SheetRange, row: number, col: number): boolean {
  const n = normalizeRange(range);
  return row >= n.r0 && row <= n.r1 && col >= n.c0 && col <= n.c1;
}

function isFieldTarget(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof HTMLElement && target.closest('input, textarea, select, [role="combobox"]'),
  );
}

export function MmSheetGrid({
  columns,
  rowCount,
  getValue,
  onChange,
  isRowLocked,
  emptyText = 'No rows.',
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ row: 0, col: 0 });
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [editing, setEditing] = useState(false);
  const [editBuf, setEditBuf] = useState('');
  const [fillTo, setFillTo] = useState<{ row: number; col: number } | null>(null);
  const dragging = useRef<'select' | 'fill' | null>(null);

  const range = useMemo<SheetRange>(
    () => ({ r0: anchor.row, c0: anchor.col, r1: focus.row, c1: focus.col }),
    [anchor, focus],
  );
  const shownRange = fillTo
    ? { r0: range.r0, c0: range.c0, r1: fillTo.row, c1: fillTo.col }
    : range;

  const commitEdit = useCallback(
    (next?: string) => {
      if (!editing) return;
      const col = columns[focus.col];
      if (col?.editable && !isRowLocked?.(focus.row)) {
        onChange(focus.row, col.key, next ?? editBuf);
      }
      setEditing(false);
    },
    [columns, editBuf, editing, focus.col, focus.row, isRowLocked, onChange],
  );

  const startEdit = (row: number, col: number, seed?: string) => {
    const column = columns[col];
    if (!column?.editable || isRowLocked?.(row)) return;
    setAnchor({ row, col });
    setFocus({ row, col });
    if (column.kind === 'select') {
      if (seed != null) onChange(row, column.key, seed);
      return;
    }
    setEditBuf(seed ?? getValue(row, column.key));
    setEditing(true);
  };

  const moveFocus = (row: number, col: number, extend: boolean) => {
    const next = {
      row: Math.max(0, Math.min(rowCount - 1, row)),
      col: Math.max(0, Math.min(columns.length - 1, col)),
    };
    if (!extend) setAnchor(next);
    setFocus(next);
  };

  const readBlock = (block: SheetRange): string[][] => {
    const n = normalizeRange(block);
    const grid: string[][] = [];
    for (let r = n.r0; r <= n.r1; r += 1) {
      const line: string[] = [];
      for (let c = n.c0; c <= n.c1; c += 1) {
        line.push(getValue(r, columns[c].key));
      }
      grid.push(line);
    }
    return grid;
  };

  const writeBlock = (writes: Array<{ row: number; col: number; value: string }>) => {
    for (const item of writes) {
      const column = columns[item.col];
      if (!column?.editable || isRowLocked?.(item.row)) continue;
      onChange(item.row, column.key, item.value);
    }
  };

  const copySelection = async () => {
    const text = serializeTsv(readBlock(range));
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const pasteAtFocus = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const values = parseTsv(text);
      writeBlock(applyPaste(values, focus, rowCount, columns.length));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onMouseUp = () => {
      if (dragging.current === 'fill' && fillTo) {
        writeBlock(applyFill(readBlock(range), range, fillTo.row, fillTo.col));
      }
      dragging.current = null;
      setFillTo(null);
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [fillTo, range, rowCount, columns, getValue]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isFieldTarget(e.target) && !editing) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v')) return;
      return;
    }
    if (editing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
        moveFocus(focus.row + 1, focus.col, false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit();
        moveFocus(focus.row, focus.col + (e.shiftKey ? -1 : 1), false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(false);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') {
        e.preventDefault();
        void copySelection();
      }
      if (e.key === 'v') {
        e.preventDefault();
        void pasteAtFocus();
      }
      return;
    }
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault();
      startEdit(focus.row, focus.col);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const n = normalizeRange(range);
      for (let r = n.r0; r <= n.r1; r += 1) {
        for (let c = n.c0; c <= n.c1; c += 1) {
          const column = columns[c];
          if (!column?.editable || isRowLocked?.(r)) continue;
          onChange(r, column.key, '');
        }
      }
      return;
    }
    if (e.key.length === 1 && !e.altKey) {
      startEdit(focus.row, focus.col, e.key);
      return;
    }
    const extend = e.shiftKey;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(focus.row + 1, focus.col, extend);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(focus.row - 1, focus.col, extend);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveFocus(focus.row, focus.col - 1, extend);
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      e.preventDefault();
      moveFocus(focus.row, focus.col + (e.shiftKey && e.key === 'Tab' ? -1 : 1), extend && e.key !== 'Tab');
    }
  };

  return (
    <div
      ref={rootRef}
      className="overflow-auto outline-none hairline-scrollbar"
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ minHeight: `${2.4 + Math.max(rowCount, 1) * 2 + 2.5}rem` }}
    >
      <table className="w-full min-w-[880px] border-collapse bg-white table-fixed">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`${thBase} ${column.headerClassName ?? ''}`} style={{ width: column.width }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowCount === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-[11px] text-slate-400 italic">
                {emptyText}
              </td>
            </tr>
          ) : (
            <>
              {Array.from({ length: rowCount }, (_, row) => (
                <tr key={row}>
                  {columns.map((column, col) => {
                    const active = focus.row === row && focus.col === col;
                    const selected = inRange(shownRange, row, col);
                    const locked = Boolean(isRowLocked?.(row));
                    const value = getValue(row, column.key);
                    const isSelect = column.kind === 'select';
                    const isEdit = editing && active && column.editable && !locked && !isSelect;
                    return (
                      <td
                        key={column.key}
                        className={`${tdBase} ${column.cellClassName ?? ''} ${
                          selected ? 'bg-blue-50' : 'bg-white'
                        } ${active ? 'ring-2 ring-inset ring-blue-500 z-[1]' : ''}`}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          if ((e.target as HTMLElement).closest('[role="combobox"]')) {
                            if (editing) commitEdit();
                            setAnchor({ row, col });
                            setFocus({ row, col });
                            return;
                          }
                          rootRef.current?.focus();
                          if (e.shiftKey) {
                            setFocus({ row, col });
                            return;
                          }
                          if (editing) commitEdit();
                          setAnchor({ row, col });
                          setFocus({ row, col });
                          dragging.current = 'select';
                        }}
                        onMouseEnter={() => {
                          if (dragging.current === 'select') setFocus({ row, col });
                          if (dragging.current === 'fill') setFillTo({ row, col });
                        }}
                        onDoubleClick={() => {
                          if (!isSelect) startEdit(row, col);
                        }}
                      >
                        {isSelect ? (
                          <div
                            className="h-8"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              if (editing) commitEdit();
                              setAnchor({ row, col });
                              setFocus({ row, col });
                            }}
                          >
                            <SelectDropdown
                              value={value}
                              onChange={(next) => onChange(row, column.key, next)}
                              options={column.options ?? []}
                              placeholder="—"
                              size="compact"
                              shape="none"
                              variant="cell"
                              align="center"
                              disabled={locked || !column.editable}
                              className="w-full h-8"
                            />
                          </div>
                        ) : isEdit ? (
                          <input
                            autoFocus
                            className="w-full h-8 px-1.5 text-[11px] text-center bg-white outline-none"
                            value={editBuf}
                            onChange={(e) => setEditBuf(e.target.value)}
                            onBlur={() => commitEdit()}
                          />
                        ) : (
                          <span className={`block px-1.5 leading-8 truncate text-center ${locked && column.editable ? 'text-slate-400' : ''}`}>
                            {value}
                          </span>
                        )}
                        {active && column.editable && !locked && !editing ? (
                          <span
                            className="absolute right-0 bottom-0 w-2 h-2 bg-blue-600 cursor-crosshair z-[2]"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              dragging.current = 'fill';
                              setFillTo({ row, col });
                            }}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr aria-hidden>
                <td colSpan={columns.length} className="h-10 border-0 p-0 bg-white" />
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
