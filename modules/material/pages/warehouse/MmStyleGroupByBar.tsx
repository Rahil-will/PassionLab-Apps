import React from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import {
  DEFAULT_GROUP_STEPS,
  GROUP_KEY_OPTIONS,
  groupKeyLabel,
  isNumericGroupKey,
  type GroupStep,
  type RollGroupKey,
} from '../../lib/mmStyleRollGroups';

const RANGE_CHOICES = ['0.5', '1', '2', '5', '10'];

export function MmStyleGroupByBar({
  steps,
  onChange,
}: {
  steps: GroupStep[];
  onChange: (next: GroupStep[]) => void;
}) {
  const used = new Set(steps.map((step) => step.key));
  const unused = GROUP_KEY_OPTIONS.filter((row) => !used.has(row.key));

  const move = (index: number, dir: -1 | 1) => {
    const next = [...steps];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    const current = next[index];
    next[index] = next[swap];
    next[swap] = current;
    onChange(next);
  };

  const remove = (index: number) => {
    if (steps.length <= 1) return;
    onChange(steps.filter((_, i) => i !== index));
  };

  const setRange = (index: number, raw: string) => {
    const value = Number(raw);
    onChange(
      steps.map((step, i) =>
        i === index ? { ...step, rangeStep: value > 0 ? value : 1 } : step,
      ),
    );
  };

  const add = (key: RollGroupKey) => {
    const meta = GROUP_KEY_OPTIONS.find((row) => row.key === key);
    onChange([...steps, { key, rangeStep: meta?.numeric ? 1 : undefined }]);
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 shrink-0">Group</span>
      {steps.map((step, index) => (
        <span
          key={`${step.key}-${index}`}
          className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white pl-2 pr-1 py-0.5 text-[10px] font-semibold text-slate-700"
        >
          <span className="truncate max-w-[7.5rem]">{groupKeyLabel(step.key)}</span>
          {isNumericGroupKey(step.key) ? (
            <select
              className="ml-0.5 max-w-[4.25rem] bg-slate-50 border border-slate-200 rounded-full px-1 py-0 text-[10px] font-semibold text-slate-600"
              value={String(step.rangeStep && step.rangeStep > 0 ? step.rangeStep : 1)}
              onChange={(e) => setRange(index, e.target.value)}
              aria-label={`${groupKeyLabel(step.key)} range`}
            >
              {RANGE_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
              {step.rangeStep && !RANGE_CHOICES.includes(String(step.rangeStep)) ? (
                <option value={String(step.rangeStep)}>{step.rangeStep}</option>
              ) : null}
            </select>
          ) : null}
          <button
            type="button"
            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            disabled={index === 0}
            onClick={() => move(index, -1)}
            aria-label={`Move ${groupKeyLabel(step.key)} earlier`}
          >
            <ChevronLeft size={11} />
          </button>
          <button
            type="button"
            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            disabled={index === steps.length - 1}
            onClick={() => move(index, 1)}
            aria-label={`Move ${groupKeyLabel(step.key)} later`}
          >
            <ChevronRight size={11} />
          </button>
          <button
            type="button"
            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            disabled={steps.length <= 1}
            onClick={() => remove(index)}
            aria-label={`Remove ${groupKeyLabel(step.key)}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {unused.length > 0 ? (
        <label className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
          <Plus size={11} />
          <select
            className="bg-transparent border-0 p-0 text-[10px] font-semibold text-slate-600 max-w-[7rem]"
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value as RollGroupKey);
            }}
            aria-label="Add grouping level"
          >
            <option value="">Add</option>
            {unused.map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {steps.length > 1 ? (
        <button
          type="button"
          className="text-[10px] font-semibold text-slate-400 hover:text-slate-700"
          onClick={() => onChange(DEFAULT_GROUP_STEPS)}
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}
