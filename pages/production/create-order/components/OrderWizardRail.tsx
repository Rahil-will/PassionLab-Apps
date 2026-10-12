import React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import {
  ORDER_WIZARD_STAGES,
  type OrderWizardStage,
} from '../orderWizardStages';

interface OrderWizardRailProps {
  stage: OrderWizardStage;
  /** Stages whose data is filled. A green tick shows only for these, and never on the active step. */
  completed: ReadonlySet<OrderWizardStage>;
  onSelect: (stage: OrderWizardStage) => void;
  onBack?: () => void;
  onDiscard?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
  /** Hide the primary action from roles that cannot save. */
  gateNext?: boolean;
}

function NextAction({
  gated,
  onClick,
  disabled,
  label,
}: {
  gated: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  const button = (
    <Button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-[10px] justify-center bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
    >
      {label}
    </Button>
  );
  if (!gated) return button;
  return <DesktopWriteGate>{button}</DesktopWriteGate>;
}

export const OrderWizardRail: React.FC<OrderWizardRailProps> = ({
  stage,
  completed,
  onSelect,
  onBack,
  onDiscard,
  onNext,
  nextLabel = 'Next',
  nextDisabled,
  showBack = true,
  gateNext = false,
}) => (
  <div className="h-full flex flex-col min-h-[220px]">
    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-2 px-0.5">
      Order steps
    </p>
    <nav className="flex-1 space-y-0.5" aria-label="Order stages">
      {ORDER_WIZARD_STAGES.map((item) => {
        const active = item.id === stage;
        const done = !active && completed.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors border ${
              active
                ? 'bg-blue-50 border-blue-200 text-blue-800 font-semibold'
                : 'border-transparent text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                active
                  ? 'bg-blue-600 text-white'
                  : done
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done ? <Check size={12} strokeWidth={2.5} /> : <ChevronRight size={12} />}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
      {(showBack && onBack) || onDiscard ? (
        <div className="flex gap-2">
          {showBack && onBack ? (
            <Button variant="secondary" onClick={onBack} className="flex-1 text-[10px] justify-center">
              Back
            </Button>
          ) : null}
          {onDiscard ? (
            <Button variant="danger-light" onClick={onDiscard} className="flex-1 text-[10px] justify-center">
              Discard
            </Button>
          ) : null}
        </div>
      ) : null}
      {onNext ? (
        <NextAction
          gated={gateNext}
          onClick={onNext}
          disabled={nextDisabled}
          label={nextLabel}
        />
      ) : null}
    </div>
  </div>
);
