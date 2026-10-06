import React, { createContext, useContext } from 'react';
import { Loader2, Save } from 'lucide-react';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';

interface MmPageSaveState {
  save: () => void;
  saving: boolean;
  unsaved: boolean;
}

const MmPageSaveContext = createContext<MmPageSaveState | null>(null);

export function MmPageSaveProvider({
  value,
  children,
}: {
  value: MmPageSaveState;
  children: React.ReactNode;
}) {
  return <MmPageSaveContext.Provider value={value}>{children}</MmPageSaveContext.Provider>;
}

/** Renders only on Material Management — sits in the right table card header. */
export function MmTableSaveButton() {
  const ctx = useContext(MmPageSaveContext);
  if (!ctx) return null;
  return (
    <DesktopWriteGate>
      <button
        type="button"
        onClick={ctx.save}
        disabled={ctx.saving || !ctx.unsaved}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
      >
        {ctx.saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Save Changes
      </button>
    </DesktopWriteGate>
  );
}
