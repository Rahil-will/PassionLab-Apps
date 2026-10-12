import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { Button } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore } from '../../../../stores';
import FabricFormSchemaEditor, { type FabricFormSchemaEditorHandle } from './FabricFormSchemaEditor';

/** Shown only when a config user cannot open Material Management. */
export default function FabricRequirementPage() {
  const setNavUnsaved = useNavigationStore((s) => s.setUnsaved);
  const setPendingSaveAction = useNavigationStore((s) => s.setPendingSaveAction);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<FabricFormSchemaEditorHandle>(null);

  const save = useCallback(async () => {
    setSaving(true);
    const ok = (await editorRef.current?.save()) ?? false;
    setSaving(false);
    return ok;
  }, []);

  useEffect(() => {
    if (!dirty) return;
    setNavUnsaved(true);
    setPendingSaveAction(save);
    return () => {
      setNavUnsaved(false);
      setPendingSaveAction(null);
    };
  }, [dirty, save, setNavUnsaved, setPendingSaveAction]);

  usePageHeader({
    actions: (
      <DesktopWriteGate>
        <Button variant="primary" size="sm" onClick={() => { void save(); }} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DesktopWriteGate>
    ),
  }, [dirty, saving]);

  return (
    <PageShell className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0">
      <div className="flex-1 min-h-0">
        <FabricFormSchemaEditor ref={editorRef} onDirtyChange={setDirty} />
      </div>
    </PageShell>
  );
}
