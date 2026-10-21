import React from 'react';
import { ArrowDown, Plus, X } from 'lucide-react';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { MAX_INSP_STEPS, nextStepValue, validateSteps } from '../lib/inspectionRules';

/**
 * Flow-chart step editor: [Step 1: 10%] —fail→ [Step 2: 20%] —fail→ [Supervisor decides]
 * with a green "pass → lot cleared" note under every step.
 */
export function InspStepsEditor({
  steps,
  onChange,
  compact = false,
}: {
  steps: number[];
  onChange: (next: number[]) => void;
  compact?: boolean;
}) {
  const validation = validateSteps(steps);
  const setStep = (index: number, raw: string) => {
    const value = raw === '' ? 0 : Number(raw);
    onChange(steps.map((step, i) => (i === index ? (Number.isFinite(value) ? value : 0) : step)));
  };
  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    onChange(steps.filter((_, i) => i !== index));
  };
  const addStep = () => {
    if (steps.length >= MAX_INSP_STEPS) return;
    onChange([...steps, nextStepValue(steps)]);
  };

  return (
    <div>
      <div className="flex items-start gap-1 overflow-x-auto thin-scrollbar pb-1">
        {steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className={`flex flex-col items-center shrink-0 ${compact ? 'w-28' : 'w-36'}`}>
              <div className={`relative w-full rounded-xl border border-slate-200 bg-slate-50/70 ${compact ? 'px-2.5 py-2' : 'px-3 py-3'}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Step {index + 1}</p>
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    aria-label={`Step ${index + 1} percent`}
                    value={Number.isFinite(step) ? step : ''}
                    onChange={(e) => setStep(index, e.target.value)}
                    className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400"
                  />
                  <span className="text-[11px] font-medium text-slate-500">% of rolls</span>
                </div>
                {steps.length > 1 ? (
                  <DesktopWriteGate>
                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      className="absolute top-1.5 right-1.5 p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                      aria-label={`Remove step ${index + 1}`}
                    >
                      <X size={12} />
                    </button>
                  </DesktopWriteGate>
                ) : null}
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                <ArrowDown size={11} /> pass → lot cleared
              </p>
            </div>
            <span className={`shrink-0 text-[10px] font-semibold text-red-500 ${compact ? 'pt-5' : 'pt-7'}`}>—fail→</span>
          </React.Fragment>
        ))}
        <div className={`flex flex-col items-center shrink-0 ${compact ? 'w-32' : 'w-40'}`}>
          <div className={`w-full rounded-xl border border-slate-300 bg-slate-100 ${compact ? 'px-2.5 py-2' : 'px-3 py-3'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Last step fails</p>
            <p className="mt-1.5 text-[11px] font-semibold text-slate-800 leading-snug">Supervisor decides: accept / reject</p>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <DesktopWriteGate>
          <button
            type="button"
            onClick={addStep}
            disabled={steps.length >= MAX_INSP_STEPS}
            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40"
          >
            <Plus size={12} /> Add step
          </button>
        </DesktopWriteGate>
        <span className="text-[10px] text-slate-400">Max {MAX_INSP_STEPS} steps · min 1</span>
        {!validation.ok ? <span className="text-[11px] font-medium text-red-600">{validation.message}</span> : null}
      </div>
    </div>
  );
}

export default InspStepsEditor;
