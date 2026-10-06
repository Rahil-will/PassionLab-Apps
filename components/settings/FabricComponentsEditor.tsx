import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Layers, Loader2, Pencil, X, Star } from 'lucide-react';
import { useDepartmentsCatalog, useFabricComponentsCatalog } from '../../lib/queries/settingsSlices';
import { Button, Input } from '../ui';
import { EditorSplitLayout } from './EditorSplitLayout';
import { DesktopWriteGate } from '../DesktopWriteGate';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from './CatalogTablePanel';
import type { FabricComponent } from '../../types/settings';
import { generateFabricComponentCode } from '../../lib/fabricComponentCode';

export interface FabricComponentsEditorProps {
  originDepartmentId: string | null;
  factoryId: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onChange?: (rows: FabricComponent[]) => void;
  saveRevision?: number;
  embedded?: boolean;
  fillHeight?: boolean;
  headerAction?: React.ReactNode;
}

export const FabricComponentsEditor: React.FC<FabricComponentsEditorProps> = ({
  originDepartmentId,
  factoryId,
  onDirtyChange,
  onChange,
  saveRevision = 0,
  embedded = false,
  fillHeight = false,
  headerAction,
}) => {
  const { fabricComponents, loading: fabricLoading } = useFabricComponentsCatalog(factoryId);
  const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'full');

  const [rows, setRows] = useState<FabricComponent[]>([]);
  const baselineRef = useRef<FabricComponent[]>([]);

  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formFabricType, setFormFabricType] = useState('');
  const [formRemarks, setFormRemarks] = useState('');
  const [formPrimary, setFormPrimary] = useState(false);

  const department = departments.find((d) => d.id === originDepartmentId) ?? null;
  const catalogReady = !fabricLoading && !deptLoading && Boolean(factoryId);

  const syncDirty = (next: FabricComponent[]) => {
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(baselineRef.current));
  };

  const resetForm = () => {
    setFormMode('add');
    setEditingIndex(null);
    setFormFabricType('');
    setFormRemarks('');
    setFormPrimary(false);
  };

  const applyLoaded = (loaded: FabricComponent[]) => {
    baselineRef.current = loaded.map((r) => ({ ...r }));
    setRows(loaded);
    onChange?.(loaded);
    onDirtyChange(false);
    resetForm();
  };

  // Factory-wide catalog from Query (full settings scope).
  useEffect(() => {
    if (!factoryId || !originDepartmentId || !catalogReady) {
      if (!factoryId || !originDepartmentId) {
        setRows([]);
        baselineRef.current = [];
        onDirtyChange(false);
        resetForm();
      }
      return;
    }
    const loaded = fabricComponents.filter((c) => c.factory_id === factoryId);
    applyLoaded(loaded);
  }, [factoryId, originDepartmentId, saveRevision, fabricComponents, catalogReady]);

  const applyRows = (next: FabricComponent[]) => {
    setRows(next);
    syncDirty(next);
    onChange?.(next);
  };

  const selectRowForEdit = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setFormMode('edit');
    setEditingIndex(index);
    setFormFabricType(row.fabric_type);
    setFormRemarks(row.remarks ?? '');
    setFormPrimary(row.is_primary);
  };

  const submitForm = () => {
    const fabricType = formFabricType.trim();
    if (!fabricType || !factoryId || !originDepartmentId) return;

    const existingCodes = rows
      .filter((_, i) => formMode !== 'edit' || i !== editingIndex)
      .map((r) => r.code);

    if (formMode === 'edit' && editingIndex !== null) {
      const next = rows.map((r, i) => {
        if (i !== editingIndex) {
          return formPrimary ? { ...r, is_primary: false } : r;
        }
        return {
          ...r,
          fabric_type: fabricType,
          remarks: formRemarks.trim() || null,
          is_primary: formPrimary,
        };
      });
      applyRows(next);
      resetForm();
      return;
    }

    const code = generateFabricComponentCode(fabricType, existingCodes);
    const newRow: FabricComponent = {
      id: `temp_${crypto.randomUUID()}`,
      factory_id: factoryId,
      department_id: originDepartmentId,
      code,
      fabric_type: fabricType,
      remarks: formRemarks.trim() || null,
      is_primary: formPrimary,
      is_active: true,
    };
    const next = [
      ...rows.map((r) => (formPrimary ? { ...r, is_primary: false } : r)),
      newRow,
    ];
    applyRows(next);
    resetForm();
  };

  const removeEditingRow = () => {
    if (editingIndex === null) return;
    const row = rows[editingIndex];
    if (row.is_primary) return;
    applyRows(rows.filter((_, i) => i !== editingIndex));
    resetForm();
  };

  const sortedRows = useMemo(
    () => [...rows].sort(
      (a, b) =>
        new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
        || a.fabric_type.localeCompare(b.fabric_type),
    ),
    [rows],
  );

  if (!originDepartmentId || !department || !factoryId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
        <Layers size={64} className="mb-4 opacity-20" />
        <p className="text-xs font-medium text-slate-400">Select an origin work center to manage fabric categories</p>
      </div>
    );
  }

  if (!catalogReady) {
    return (
      <div className="h-full flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <EditorSplitLayout
      scrollable={false}
      leftScrollable={false}
      rightScrollable
      fillHeight={fillHeight}
      panelHeight={embedded ? 'min(460px, 50vh)' : 'min(480px, 55vh)'}
      left={(
        <DesktopWriteGate>
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              {formMode === 'edit' ? <Pencil size={14} /> : <Plus size={14} />}
              {formMode === 'edit' ? 'Edit fabric category' : 'Add fabric category'}
            </h4>
          </div>
          <Input
            label="Category name"
            value={formFabricType}
            onChange={(e) => setFormFabricType(e.target.value)}
            placeholder="e.g. Shell, Lining, Pocketing"
            onKeyDown={(e) => e.key === 'Enter' && submitForm()}
          />
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
            <textarea
              rows={3}
              value={formRemarks}
              onChange={(e) => setFormRemarks(e.target.value)}
              placeholder="Optional notes"
              className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y min-h-[6.5rem] max-h-40 text-[11px]"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={formPrimary}
              onChange={(e) => setFormPrimary(e.target.checked)}
              className="rounded border-slate-300"
            />
            <Star size={12} className={formPrimary ? 'text-amber-500 fill-amber-500' : 'text-slate-400'} />
            Primary fabric (factory-wide)
          </label>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              icon={formMode === 'edit' ? Pencil : Plus}
              onClick={submitForm}
              disabled={!formFabricType.trim()}
              className="w-full"
            >
              {formMode === 'edit' ? 'Update category' : 'Add category'}
            </Button>
            {formMode === 'edit' && (
              <>
                <Button
                  variant="danger-light"
                  size="sm"
                  icon={Trash2}
                  onClick={removeEditingRow}
                  disabled={rows[editingIndex ?? -1]?.is_primary}
                  className="w-full"
                >
                  Remove category
                </Button>
                <Button size="sm" variant="secondary" icon={X} onClick={resetForm} className="w-full">
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
        </DesktopWriteGate>
      )}
      right={(
        <div className="h-full flex flex-col min-h-0">
          <CatalogTablePanel
            title="Fabric categories"
            isEmpty={sortedRows.length === 0}
            emptyMessage="No fabric categories yet."
            headerAction={headerAction}
          >
            <CatalogTable headers={['S.No', 'Category', 'Primary', 'Remarks']}>
              {sortedRows.map((row, idx) => {
                const globalIndex = rows.findIndex((r) => r.id === row.id);
                const isSelected = formMode === 'edit' && editingIndex === globalIndex;
                return (
                  <CatalogTableRow
                    key={row.id}
                    onClick={() => selectRowForEdit(globalIndex)}
                    selected={isSelected}
                  >
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.fabric_type}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-center min-w-[4.5rem]">
                      {row.is_primary ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                          <Star size={11} className="fill-amber-500 text-amber-500" />
                          Primary
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-500 truncate max-w-[10rem]">
                      {row.remarks?.trim() || '—'}
                    </CatalogTableCell>
                  </CatalogTableRow>
                );
              })}
            </CatalogTable>
          </CatalogTablePanel>
        </div>
      )}
    />
  );
};
