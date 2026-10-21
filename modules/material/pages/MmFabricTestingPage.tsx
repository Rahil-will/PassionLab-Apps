import React, { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { Loader2 } from 'lucide-react';
import { useNotificationStore } from '../../../stores';
import { useMmConfigBundle, useRefreshMmConfig } from '../lib/useMmConfigBundle';
import { mmSaveTypeTestFields } from '../lib/mmRpc';
import {
  MmTypeFieldsEditor,
  type MmFieldRow,
  type MmTypeFieldsHandle,
} from '../components/MmTypeFieldsEditor';

export type MmFabricTestingHandle = MmTypeFieldsHandle;

const MmFabricTestingPage = forwardRef<
  MmFabricTestingHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricTestingPage({ onDirtyChange }, ref) {
  const { data, isLoading } = useMmConfigBundle();
  const refresh = useRefreshMmConfig();
  const { showNotification } = useNotificationStore();
  const editorRef = useRef<MmTypeFieldsHandle>(null);

  useImperativeHandle(ref, () => ({
    isDirty: () => editorRef.current?.isDirty() ?? false,
    save: async () => editorRef.current?.save() ?? false,
  }));

  const types = useMemo(
    () =>
      (data?.types ?? [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({ id: String(t.id), name: String(t.name) })),
    [data?.types],
  );

  const savedRows = useCallback(
    (typeId: string): MmFieldRow[] =>
      (data?.test_fields ?? [])
        .filter((a) => a.is_active !== false && String(a.type_id ?? '') === typeId)
        .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
        .map((a, i) => ({
          localId: String(a.id ?? `row_${i}`),
          id: a.id ? String(a.id) : null,
          rowVersion: Number(a.row_version ?? 1),
          label: String(a.label ?? ''),
          dataType: String(a.data_type ?? 'text'),
          options: Array.isArray(a.options) ? (a.options as unknown[]).map(String) : [],
          remarks: a.remarks != null ? String(a.remarks) : '',
          captureSite: 'either',
          toleranceOn: a.tolerance_on === true,
          toleranceMode: a.tolerance_mode === 'range' ? 'range' : 'pm',
          tolerance: a.tolerance != null && a.tolerance !== '' && Number.isFinite(Number(a.tolerance))
            ? Number(a.tolerance)
            : null,
          toleranceUnit: a.tolerance_unit === 'pct' ? 'pct' : 'abs',
          toleranceTarget: a.tolerance_target != null && Number.isFinite(Number(a.tolerance_target))
            ? Number(a.tolerance_target)
            : null,
          toleranceMin: a.tolerance_min != null && Number.isFinite(Number(a.tolerance_min))
            ? Number(a.tolerance_min)
            : null,
          toleranceMax: a.tolerance_max != null && Number.isFinite(Number(a.tolerance_max))
            ? Number(a.tolerance_max)
            : null,
          toleranceText: a.tolerance_text != null ? String(a.tolerance_text) : '',
        })),
    [data?.test_fields],
  );

  const persist = useCallback(
    async (typeId: string, rows: MmFieldRow[]) => {
      const res = await mmSaveTypeTestFields(
        typeId,
        rows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          label: row.label,
          data_type: row.dataType,
          options: row.dataType === 'select' ? row.options : [],
          tolerance_on: row.toleranceOn === true,
          tolerance_mode: row.toleranceMode === 'range' ? 'range' : 'pm',
          tolerance: row.tolerance != null && Number.isFinite(row.tolerance) ? row.tolerance : null,
          tolerance_unit: row.toleranceUnit === 'pct' ? 'pct' : 'abs',
          tolerance_target: row.toleranceTarget != null && Number.isFinite(row.toleranceTarget) ? row.toleranceTarget : null,
          tolerance_min: row.toleranceMin != null && Number.isFinite(row.toleranceMin) ? row.toleranceMin : null,
          tolerance_max: row.toleranceMax != null && Number.isFinite(row.toleranceMax) ? row.toleranceMax : null,
        })),
      );
      if (res.ok === false) throw new Error(res.message);
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (types.length === 0) {
    return (
      <p className="text-xs text-slate-500 p-2">
        Add a fabric type first.
      </p>
    );
  }

  return (
    <MmTypeFieldsEditor
      ref={editorRef}
      types={types}
      savedRows={savedRows}
      persist={persist}
      fieldNoun="KPI"
      tableSubtitle="Measurement parameters. Turn tolerance on for a number or a decimal."
      namePlaceholder="e.g. Shrinkage %"
      variant="test"
      onError={(message) => showNotification(message, 'error')}
      onDirtyChange={onDirtyChange}
      onSaved={async () => {
        await refresh();
        showNotification('Fabric testing parameters saved', 'success');
      }}
    />
  );
});

export default MmFabricTestingPage;
