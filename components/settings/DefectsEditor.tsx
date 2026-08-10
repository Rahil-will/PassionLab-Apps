import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Bug, Loader2, Layers, Pencil, X } from 'lucide-react';
import { useNavigationStore, useSettingsStore } from '../../stores';
import {
  useDepartmentDefectsCatalog,
  useDepartmentsCatalog,
} from '../../lib/queries/settingsSlices';
import { Button, Input, SelectDropdown } from '../ui';
import { EditorSplitLayout } from './EditorSplitLayout';
import { DesktopWriteGate } from '../DesktopWriteGate';
import type { DefectItem } from '../../types/settings';
import { defaultDefectsForDepartment, nextDefectCode } from '../../lib/defectSeeds';

const NEW_CATEGORY_VALUE = '__new__';

export interface DefectsEditorProps {
  selectedDeptId: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onChange?: (defects: DefectItem[]) => void;
  saveRevision?: number;
  embedded?: boolean;
}

export const DefectsEditor: React.FC<DefectsEditorProps> = ({
  selectedDeptId,
  onDirtyChange,
  onChange,
  saveRevision = 0,
  embedded = false,
}) => {
  const { factoryId } = useNavigationStore();
  const { departments } = useDepartmentsCatalog(factoryId, 'full');
  const { departmentDefects } = useDepartmentDefectsCatalog(factoryId);
  const ensureDepartmentDefects = useSettingsStore((s) => s.ensureDepartmentDefects);

  const getDepartmentDefects = (departmentId: string) => {
    const record = departmentDefects.find((d) => d.department_id === departmentId);
    return record?.defects ?? [];
  };

  const [defects, setDefects] = useState<DefectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const baselineRef = useRef<DefectItem[]>([]);

  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formCategory, setFormCategory] = useState('');
  const [formCustomCategory, setFormCustomCategory] = useState('');
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');

  const department = departments.find((d) => d.id === selectedDeptId) ?? null;

  const syncDirty = (next: DefectItem[]) => {
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(baselineRef.current));
  };

  const resetForm = () => {
    setFormMode('add');
    setEditingIndex(null);
    setFormCategory('');
    setFormCustomCategory('');
    setFormName('');
    setFormCode('');
  };

  const loadDepartmentDefects = async (deptId: string, deptName: string) => {
    setLoading(true);
    try {
      const seeded = await ensureDepartmentDefects(deptId, deptName);
      const stored = getDepartmentDefects(deptId);
      const loaded = seeded
        ? (stored.length > 0 ? stored : defaultDefectsForDepartment(deptName))
        : [];
      baselineRef.current = loaded.map((d) => ({ ...d }));
      setDefects(loaded);
      onChange?.(loaded);
      onDirtyChange(false);
      resetForm();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDeptId || !department) {
      setDefects([]);
      baselineRef.current = [];
      onDirtyChange(false);
      resetForm();
      return;
    }
    void loadDepartmentDefects(selectedDeptId, department.name);
  }, [selectedDeptId, department?.id, department?.name, saveRevision, departmentDefects]);

  const groupedEntries = useMemo(() => {
    const map = new Map<string, Array<{ defect: DefectItem; index: number }>>();
    defects.forEach((defect, index) => {
      const cat = defect.category.trim() || 'General';
      const list = map.get(cat) ?? [];
      list.push({ defect, index });
      map.set(cat, list);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({ category, items }));
  }, [defects]);

  const categoryOptions = useMemo(() => {
    const existing = groupedEntries.map(({ category }) => ({
      value: category,
      label: category,
    }));
    return [
      ...existing,
      { value: NEW_CATEGORY_VALUE, label: 'New category...' },
    ];
  }, [groupedEntries]);

  const resolvedCategory =
    formCategory === NEW_CATEGORY_VALUE ? formCustomCategory.trim() : formCategory.trim();

  const applyDefects = (next: DefectItem[]) => {
    setDefects(next);
    syncDirty(next);
    onChange?.(next);
  };

  const selectRowForEdit = (index: number) => {
    const row = defects[index];
    if (!row) return;
    setFormMode('edit');
    setEditingIndex(index);
    setFormCategory(row.category);
    setFormCustomCategory('');
    setFormName(row.name);
    setFormCode(row.code);
  };

  const submitForm = () => {
    const category = resolvedCategory;
    const name = formName.trim();
    if (!category || !name) return;

    if (formMode === 'edit' && editingIndex !== null) {
      const code = formCode.trim() || defects[editingIndex]?.code || nextDefectCode(category, defects);
      const next = defects.map((d, i) =>
        i === editingIndex ? { category, name, code } : d,
      );
      applyDefects(next);
      resetForm();
      return;
    }

    const code = formCode.trim() || nextDefectCode(category, defects);
    applyDefects([...defects, { category, name, code }]);
    setFormName('');
    setFormCode('');
    if (formCategory === NEW_CATEGORY_VALUE) {
      setFormCategory(category);
      setFormCustomCategory('');
    }
  };

  const removeEditingDefect = () => {
    if (editingIndex === null) return;
    applyDefects(defects.filter((_, i) => i !== editingIndex));
    resetForm();
  };

  if (!selectedDeptId || !department) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
        <Bug size={64} className="mb-4 opacity-20" />
        <p className="text-xs font-medium text-slate-400">Select a department to manage defects</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <EditorSplitLayout
      scrollable={!embedded}
      panelHeight={embedded ? undefined : 'min(400px, 48vh)'}
      left={(
        <DesktopWriteGate>
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              {formMode === 'edit' ? <Pencil size={14} /> : <Plus size={14} />}
              {formMode === 'edit' ? 'Edit defect' : 'Add defect'}
            </h4>
            <p className="text-[10px] text-slate-400 mt-1">{department.name}</p>
          </div>
          <SelectDropdown
            label="Category"
            icon={Layers}
            value={formCategory}
            onChange={setFormCategory}
            options={categoryOptions}
            placeholder="Select category"
          />
          {formCategory === NEW_CATEGORY_VALUE && (
            <Input
              label="New category"
              value={formCustomCategory}
              onChange={(e) => setFormCustomCategory(e.target.value)}
              placeholder="Category name"
            />
          )}
          <Input
            label="Defect name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. Open seam"
            onKeyDown={(e) => e.key === 'Enter' && submitForm()}
          />
          <Input
            label="Defect code"
            value={formCode}
            onChange={(e) => setFormCode(e.target.value.toUpperCase())}
            placeholder="Auto-generated if empty"
          />
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              icon={formMode === 'edit' ? Pencil : Plus}
              onClick={submitForm}
              disabled={!resolvedCategory || !formName.trim()}
              className="w-full"
            >
              {formMode === 'edit' ? 'Update defect' : 'Add defect'}
            </Button>
            {formMode === 'edit' && (
              <>
                <Button variant="danger-light" size="sm" icon={Trash2} onClick={removeEditingDefect} className="w-full">
                  Remove defect
                </Button>
                <Button variant="secondary" size="sm" icon={X} onClick={resetForm} className="w-full">
                  Cancel edit
                </Button>
              </>
            )}
          </div>
        </div>
        </DesktopWriteGate>
      )}
      right={(
        <div>
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 sticky top-0 z-10">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <Bug size={14} /> Defect catalog
            </h4>
            <p className="text-[10px] text-slate-400 mt-0.5">Click a row to edit</p>
          </div>
          {groupedEntries.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-12 text-center">No defects yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {(() => {
                let serial = 0;
                return groupedEntries.map(({ category, items }) => (
                <div key={category}>
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{category}</span>
                  </div>
                  <table className="w-full text-xs table-fixed">
                    <thead className="text-[10px] uppercase text-slate-500 font-semibold border-b border-slate-100">
                      <tr>
                        <th className="w-14 min-w-[3.5rem] pl-4 pr-6 py-2 text-center">S.No</th>
                        <th className="px-4 py-2 text-left">Defect name</th>
                        <th className="px-4 py-2 text-left w-28">Code</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {items.map(({ defect: row, index: globalIndex }) => {
                        serial += 1;
                        const rowSerial = serial;
                        const isSelected = formMode === 'edit' && editingIndex === globalIndex;
                        return (
                          <tr
                            key={`${row.code}-${globalIndex}`}
                            onClick={() => selectRowForEdit(globalIndex)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="w-14 min-w-[3.5rem] pl-4 pr-6 py-2.5 text-center text-slate-500 tabular-nums">
                              {rowSerial}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-slate-800">{row.name}</td>
                            <td className="px-4 py-2.5 font-mono text-[10px] text-slate-500">{row.code}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}
    />
  );
};
