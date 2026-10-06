import React, { useMemo, useState, useImperativeHandle, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { FabricComponentsEditor } from '../../../components/settings/FabricComponentsEditor';
import { useDepartmentsCatalog } from '../../../lib/queries/settingsSlices';
import { useNavigationStore, useNotificationStore, useSettingsStore } from '../../../stores';
import type { FabricComponent } from '../../../types/settings';
import { MmTableSaveButton } from '../components/MmTableSaveButton';

export interface MmFabricCategoriesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

const MmFabricCategoriesPage = forwardRef<
  MmFabricCategoriesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricCategoriesPage({ onDirtyChange }, ref) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'full');
  const saveFabricComponents = useSettingsStore((s) => s.saveFabricComponents);
  const storeComponents = useSettingsStore((s) => s.fabricComponents);
  const { showNotification } = useNotificationStore();

  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<FabricComponent[]>([]);
  const [saveRevision, setSaveRevision] = useState(0);

  const originDepartmentId = useMemo(() => {
    const origin = departments.find((d) => d.role === 'origin' && !String(d.id).startsWith('temp_'));
    return origin?.id ?? null;
  }, [departments]);

  const onDirty = (next: boolean) => {
    setDirty(next);
    onDirtyChange?.(next);
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      if (!dirty || !factoryId || !originDepartmentId) return true;
      try {
        await saveFabricComponents(factoryId, originDepartmentId, draft, storeComponents);
        setDirty(false);
        setSaveRevision((n) => n + 1);
        onDirtyChange?.(false);
        return true;
      } catch (e) {
        showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
        return false;
      }
    },
  }), [dirty, draft, factoryId, originDepartmentId, saveFabricComponents, storeComponents, showNotification, onDirtyChange]);

  if (deptLoading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!originDepartmentId) {
    return (
      <p className="text-xs text-slate-500 p-2">
        Create an origin (cutting) work center first — categories are stored against it.
      </p>
    );
  }

  return (
    <FabricComponentsEditor
      originDepartmentId={originDepartmentId}
      factoryId={factoryId}
      onDirtyChange={onDirty}
      onChange={setDraft}
      saveRevision={saveRevision}
      embedded
      fillHeight
      headerAction={<MmTableSaveButton />}
    />
  );
});

export default MmFabricCategoriesPage;
