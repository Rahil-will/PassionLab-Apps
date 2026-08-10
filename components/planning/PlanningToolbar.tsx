import React from 'react';
import { Save, Printer } from 'lucide-react';
import { Button } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';

interface PlanningToolbarProps {
  hasChanges: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onSummary: () => void;
  saveDisabled?: boolean;
}

const btnClass = 'h-8 px-3 text-[11px] min-w-[5.5rem]';

export const PlanningToolbar: React.FC<PlanningToolbarProps> = ({
  hasChanges,
  saving = false,
  onSave,
  onDiscard,
  onSummary,
  saveDisabled = false,
}) => (
  <div className="flex items-center gap-2">
    <Button size="sm" icon={Printer} variant="secondary" onClick={onSummary} className={btnClass}>
      Summary
    </Button>
    <Button size="sm" variant="secondary" onClick={onDiscard} className={btnClass}>
      {hasChanges ? 'Discard' : 'Return'}
    </Button>
    <DesktopWriteGate>
    <Button
      size="sm"
      icon={Save}
      onClick={onSave}
      disabled={saving || saveDisabled}
      className={`${btnClass} shadow-md shadow-blue-100`}
    >
      {saving ? 'Saving…' : 'Save Plan'}
    </Button>
    </DesktopWriteGate>
  </div>
);
