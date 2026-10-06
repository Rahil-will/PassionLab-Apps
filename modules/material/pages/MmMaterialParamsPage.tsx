import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useNotificationStore } from '../../../stores';
import { useMmConfigBundle, useRefreshMmConfig } from '../lib/useMmConfigBundle';
import { mmSaveTypeRequirementFields } from '../lib/mmRpc';
import {
  MmTypeFieldsEditor,
  type MmFieldRow,
  type MmTypeFieldsHandle,
} from '../components/MmTypeFieldsEditor';

export type MmMaterialParamsHandle = MmTypeFieldsHandle;

const MmMaterialParamsPage = forwardRef<
  MmMaterialParamsHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmMaterialParamsPage({ onDirtyChange }, ref) {
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
      (data?.requirement_fields ?? [])
        .filter((a) => a.is_active !== false && String(a.type_id ?? '') === typeId)
        .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
        .map((a) => ({
          localId: String(a.id),
          id: String(a.id),
          rowVersion: Number(a.row_version ?? 1),
          label: String(a.label ?? ''),
          dataType: 'text',
          options: [],
          remarks: a.remarks != null ? String(a.remarks) : '',
          captureSite: 'either',
        })),
    [data?.requirement_fields],
  );

  const persist = useCallback(
    async (typeId: string, rows: MmFieldRow[]) => {
      const res = await mmSaveTypeRequirementFields(
        typeId,
        rows.map((row, i) => ({
          ...(row.id ? { id: row.id } : {}),
          label: row.label,
          remarks: row.remarks,
          seq: i + 1,
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
      fieldNoun="Parameter"
      tableSubtitle="Style fields captured per color"
      namePlaceholder="e.g. GSM, Width"
      variant="requirement"
      onError={(message) => showNotification(message, 'error')}
      onDirtyChange={onDirtyChange}
      onSaved={async () => {
        await refresh();
        showNotification('Fabric requirement parameters saved', 'success');
      }}
    />
  );
});

export default MmMaterialParamsPage;
