import React, { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { Loader2 } from 'lucide-react';
import { useNotificationStore } from '../../../stores';
import { useMmConfigBundle, useRefreshMmConfig } from '../lib/useMmConfigBundle';
import { mmGetConfigBundle, mmSaveTypeTestFields } from '../lib/mmRpc';
import { mmSaveTestFieldRules } from '../lib/mmV4Rpc';
import { useMmV4Config } from '../lib/useMmV4Config';
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
  const v4 = useMmV4Config();
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

  const stageOptions = useMemo(
    () =>
      (v4.data?.stages ?? [])
        .filter((s) => s.is_active !== false)
        .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
        .map((s) => ({ value: s.code, label: s.label || s.code })),
    [v4.data?.stages],
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
          captureSite: String(a.capture_site ?? 'either'),
          testLevel: a.test_level === 'lot' ? 'lot' : 'roll',
          requiredAtStages: Array.isArray(a.required_at_stages)
            ? (a.required_at_stages as unknown[]).map(String)
            : [],
        })),
    [data?.test_fields],
  );

  const persist = useCallback(
    async (typeId: string, rows: MmFieldRow[]) => {
      const res = await mmSaveTypeTestFields(
        typeId,
        rows.map((row, i) => ({
          ...(row.id ? { id: row.id } : {}),
          label: row.label,
          data_type: row.dataType,
          options: row.dataType === 'select' ? row.options : [],
          seq: i + 1,
          capture_site: row.captureSite || 'either',
        })),
      );
      if (res.ok === false) throw new Error(res.message);

      const cfg = await mmGetConfigBundle();
      if (cfg.ok === false) throw new Error(cfg.message);

      const fields = (cfg.data.test_fields ?? []).filter(
        (a) => a.is_active !== false && String(a.type_id ?? '') === typeId,
      );
      const rules = rows
        .map((row) => {
          const match = fields.find((f) =>
            row.id ? String(f.id) === row.id : String(f.label ?? '') === row.label,
          );
          if (!match?.id) return null;
          return {
            field_id: String(match.id),
            test_level: (row.testLevel === 'lot' ? 'lot' : 'roll') as 'roll' | 'lot',
            required_at_stages: row.requiredAtStages ?? [],
          };
        })
        .filter((r): r is { field_id: string; test_level: 'roll' | 'lot'; required_at_stages: string[] } => r != null);

      if (rules.length > 0) {
        const rulesRes = await mmSaveTestFieldRules(rules);
        if (rulesRes.ok === false) throw new Error(rulesRes.message);
      }
    },
    [],
  );

  if (isLoading || v4.isLoading) {
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
      tableSubtitle="Measurement parameters. Separate from 4-point inspection. Level and required stages apply when Fabric v4 quality gate is used."
      namePlaceholder="e.g. Shrinkage %"
      variant="test"
      stageOptions={stageOptions}
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
