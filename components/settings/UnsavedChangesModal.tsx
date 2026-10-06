import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Button, Modal } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
  discardLabel?: string;
  saving?: boolean;
}

/** Shared unsaved-changes prompt — same chrome as Settings. */
export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDiscard,
  discardLabel = 'Discard & Continue',
  saving = false,
}) => (
  <Modal isOpen={isOpen} onClose={onClose}>
    <div className="relative">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
      >
        <X size={20} />
      </button>

      <div className="flex flex-col items-center p-8 pb-4 text-center">
        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-amber-50">
          <AlertTriangle size={32} />
        </div>
        <h3 className="text-base font-bold text-slate-900 mb-2">Unsaved Changes</h3>
        <p className="text-slate-500 text-xs max-w-[260px] leading-relaxed">
          You have unsaved modifications. What would you like to do?
        </p>
      </div>

      <div className="p-6 pt-2 flex flex-col gap-3">
        <DesktopWriteGate>
          <Button
            onClick={() => void onSave()}
            disabled={saving}
            className="w-full shadow-lg shadow-blue-100 py-2.5 text-xs"
          >
            Save Changes
          </Button>
        </DesktopWriteGate>
        <Button variant="danger-light" onClick={onDiscard} disabled={saving} className="w-full text-xs">
          {discardLabel}
        </Button>
      </div>
    </div>
  </Modal>
);
