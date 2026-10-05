import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button, Input } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import { mmSaveFabricStage } from '../lib/mmV4Rpc';
import { useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmFabricStagesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type StageDraft = {
  localId: string;
  code: string;
  label: string;
  seq: number;
  can_cut: boolean;
  is_initial: boolean;
  is_active: boolean;
  dirty: boolean;
  isNew: boolean;
};

const MmFabricStagesPage = forwardRef<
  MmFabricStagesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricStagesPage({ onDirtyChange }, ref) {
  const { data, isLoading, error } = useMmV4Config();
  const refresh = useRefreshMmV4Config();
  const { showNotification } = useNotificationStore();
  const [rows, setRows] = useState<StageDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data) return;
    const next = [...(data.stages ?? [])]
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
      .map((s, i) => ({
        localId: s.code,
        code: s.code,
        label: s.label ?? s.code,
        seq: Number(s.seq ?? i + 1),
        can_cut: s.can_cut === true,
        is_initial: s.is_initial === true,
        is_active: s.is_active !== false,
        dirty: false,
        isNew: false,
      }));
    setRows(next);
    setHydrated(true);
    onDirtyChange?.(false);
  }, [data, onDirtyChange]);

  const dirty = useMemo(() => rows.some((r) => r.dirty), [rows]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const patch = (localId: string, patchRow: Partial<StageDraft>) => {
    setRows((prev) =>
      prev.map((row) => (row.localId === localId ? { ...row, ...patchRow, dirty: true } : row)),
    );
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      for (const row of rows.filter((r) => r.dirty)) {
        if (!row.code.trim() || !row.label.trim()) {
          showNotification('Stage code and label are required', 'error');
          return false;
        }
        const res = await mmSaveFabricStage({
          code: row.code.trim().toUpperCase(),
          label: row.label.trim(),
          seq: row.seq,
          can_cut: row.can_cut,
          is_initial: row.is_initial,
          is_active: row.is_active,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          return false;
        }
      }
      showNotification('Fabric stages saved', 'success');
      await refresh();
      return true;
    },
  }), [dirty, rows, refresh, showNotification]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[12px] text-red-600 p-4">
        {error instanceof Error ? error.message : 'Could not load fabric stages'}
      </p>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-900">Fabric stages</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ordered process stages. Toggle which stages can be cut.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => {
              const seq = (rows.reduce((max, r) => Math.max(max, r.seq), 0) || 0) + 1;
              setRows((prev) => [
                ...prev,
                {
                  localId: `tmp_${crypto.randomUUID()}`,
                  code: '',
                  label: '',
                  seq,
                  can_cut: false,
                  is_initial: false,
                  is_active: true,
                  dirty: true,
                  isNew: true,
                },
              ]);
            }}
          >
            Add stage
          </Button>
          <MmTableSaveButton />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-4 space-y-2">
        {rows.length === 0 ? (
          <p className="text-[12px] text-slate-400">No stages yet</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.localId}
              className="grid grid-cols-[64px_120px_1fr_auto_auto_auto] gap-2 items-end border border-slate-200 rounded-lg p-3"
            >
              <Input
                label="Seq"
                type="number"
                value={String(row.seq)}
                onChange={(e) => patch(row.localId, { seq: Number(e.target.value) || 0 })}
              />
              <Input
                label="Code"
                value={row.code}
                disabled={!row.isNew}
                onChange={(e) => patch(row.localId, { code: e.target.value.toUpperCase() })}
              />
              <Input
                label="Label"
                value={row.label}
                onChange={(e) => patch(row.localId, { label: e.target.value })}
              />
              <label className="flex items-center gap-1.5 text-[11px] text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={row.can_cut}
                  onChange={(e) => patch(row.localId, { can_cut: e.target.checked })}
                />
                Can be cut
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={row.is_initial}
                  onChange={(e) => patch(row.localId, { is_initial: e.target.checked })}
                />
                Initial
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={row.is_active}
                  onChange={(e) => patch(row.localId, { is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default MmFabricStagesPage;
