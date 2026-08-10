import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, X, Users } from 'lucide-react';
import { Button, Input } from '../ui';
import type { Shift } from '../../types/settings';
import { EditorSplitLayout } from './EditorSplitLayout';
import { DesktopWriteGate } from '../DesktopWriteGate';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from './CatalogTablePanel';
import {
  monthInputToEffectiveFrom,
  monthInputValue,
  startOfMonth,
  type WorkforceRateVersionDraft,
} from '../../lib/departmentWorkforceRates';

interface WorkforceFormDraft {
  id: string;
  label: string;
  effectiveFrom: string;
  ratesByShift: Record<string, number>;
}

interface DepartmentWorkforcePanelProps {
  shifts: Shift[];
  drafts: WorkforceRateVersionDraft[];
  onChange: (drafts: WorkforceRateVersionDraft[]) => void;
  disabled?: boolean;
  /** Overrides the default helper under the form title. */
  subtitle?: string;
}

type RatesTab = 'active' | 'history';

function emptyForm(): WorkforceFormDraft {
  return {
    id: `temp_${crypto.randomUUID()}`,
    label: '',
    effectiveFrom: startOfMonth(),
    ratesByShift: {},
  };
}

function formFromDraft(row: WorkforceRateVersionDraft): WorkforceFormDraft {
  return {
    id: row.id,
    label: row.label,
    effectiveFrom: row.effectiveFrom,
    ratesByShift: { ...row.ratesByShift },
  };
}

export function DepartmentWorkforcePanel({
  shifts,
  drafts,
  onChange,
  disabled = false,
  subtitle = 'Rates per shift for supervisor allocation and planning KPIs.',
}: DepartmentWorkforcePanelProps) {
  const [tab, setTab] = useState<RatesTab>('active');
  const [form, setForm] = useState<WorkforceFormDraft | null>(null);

  const activeDrafts = useMemo(() => drafts.filter((d) => d.isCurrent), [drafts]);
  const historyDrafts = useMemo(() => drafts.filter((d) => !d.isCurrent), [drafts]);
  const visibleDrafts = tab === 'active' ? activeDrafts : historyDrafts;
  const readOnlyTable = tab === 'history' || disabled;

  const shiftHeaders = shifts.map((s) => s.name);
  const tableHeaders = ['S.No', 'Category', 'From', ...shiftHeaders];

  const ratesToolbar = (
    <div className="flex items-center justify-end gap-0.5 rounded-lg border border-slate-200 p-0.5 bg-slate-50 w-fit ml-auto">
      {(['active', 'history'] as const).map((id) => {
        const count = id === 'active' ? activeDrafts.length : historyDrafts.length;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setForm(null);
            }}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
              tab === id
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {id === 'active' ? `Active (${count})` : `History (${count})`}
          </button>
        );
      })}
    </div>
  );

  const upsertFromForm = () => {
    if (!form || !form.label.trim() || disabled) return;
    const existing = drafts.find((d) => d.id === form.id);
    const nextRow: WorkforceRateVersionDraft = {
      id: form.id,
      label: form.label.trim(),
      effectiveFrom: form.effectiveFrom,
      isCurrent: existing?.isCurrent ?? true,
      sortOrder: existing?.sortOrder ?? activeDrafts.length,
      ratesByShift: { ...form.ratesByShift },
    };
    if (existing) {
      onChange(drafts.map((d) => (d.id === form.id ? nextRow : d)));
    } else {
      onChange([...drafts, nextRow]);
    }
    setForm(null);
    setTab('active');
  };

  const removeFromForm = () => {
    if (!form?.id || disabled) return;
    onChange(drafts.filter((d) => d.id !== form.id));
    setForm(null);
  };

  const isEditing = Boolean(form?.id && drafts.some((d) => d.id === form.id));

  return (
    <EditorSplitLayout
      scrollable={false}
      left={(
        <DesktopWriteGate>
        <div className="space-y-3">
          <div>
            <h5 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              {isEditing ? <Pencil size={14} /> : <Plus size={14} />}
              {isEditing ? 'Edit workforce category' : 'Add workforce category'}
            </h5>
            <p className="text-[10px] text-slate-500 mt-1">
              {subtitle}
            </p>
          </div>
          <Input
            label="Category"
            placeholder="e.g. Operator"
            value={form?.label || ''}
            onChange={(e) => setForm((f) => ({
              ...(f || emptyForm()),
              label: e.target.value,
            }))}
            onFocus={() => {
              if (!form) setForm(emptyForm());
            }}
            className="bg-white"
            disabled={disabled || readOnlyTable}
          />
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1.5">Effective from</label>
            <input
              type="month"
              disabled={disabled || readOnlyTable}
              value={monthInputValue(form?.effectiveFrom || startOfMonth())}
              onChange={(e) => setForm((f) => ({
                ...(f || emptyForm()),
                effectiveFrom: monthInputToEffectiveFrom(e.target.value),
              }))}
              onFocus={() => {
                if (!form) setForm(emptyForm());
              }}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500"
            />
          </div>
          {shifts.map((sh) => (
            <Input
              key={sh.id}
              label={`${sh.name} rate (/hr)`}
              type="number"
              min={0}
              step={0.01}
              placeholder="0"
              value={form?.ratesByShift[sh.id]?.toString() || ''}
              onChange={(e) => {
                setForm((f) => {
                  const base = f || emptyForm();
                  const cost = parseFloat(e.target.value) || 0;
                  const ratesByShift = { ...base.ratesByShift };
                  if (cost > 0) ratesByShift[sh.id] = cost;
                  else delete ratesByShift[sh.id];
                  return { ...base, ratesByShift };
                });
              }}
              onFocus={() => {
                if (!form) setForm(emptyForm());
              }}
              className="bg-white"
              disabled={disabled || readOnlyTable}
            />
          ))}
          {!disabled && !readOnlyTable && (
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                type="button"
                onClick={upsertFromForm}
                disabled={!form?.label?.trim()}
                className="w-full"
              >
                {isEditing ? 'Update category' : 'Add category'}
              </Button>
              {form && (
                <>
                  {isEditing && (
                    <Button
                      size="sm"
                      variant="danger-light"
                      type="button"
                      onClick={removeFromForm}
                      className="w-full"
                    >
                      <Trash2 size={14} className="mr-1.5" />
                      Remove category
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" type="button" onClick={() => setForm(null)} className="w-full">
                    <X size={14} className="mr-1.5" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        </DesktopWriteGate>
      )}
      right={(
        <div className="flex flex-col min-h-[280px] max-h-[min(360px,42vh)]">
          <CatalogTablePanel
            title="Workforce catalog"
            icon={Users}
            toolbar={ratesToolbar}
            isEmpty={visibleDrafts.length === 0}
            emptyMessage={tab === 'active' ? 'No categories yet.' : 'No historical versions yet.'}
          >
            <CatalogTable headers={tableHeaders}>
              {visibleDrafts.map((row, idx) => (
                <CatalogTableRow
                  key={row.id}
                  onClick={readOnlyTable ? undefined : () => setForm(formFromDraft(row))}
                  selected={form?.id === row.id}
                >
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate">{row.label}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-500 tabular-nums text-[10px]">
                    {monthInputValue(row.effectiveFrom)}
                  </CatalogTableCell>
                  {shifts.map((sh) => (
                    <CatalogTableCell key={sh.id} className="text-slate-500 tabular-nums text-[10px]">
                      {row.ratesByShift[sh.id] ?? '—'}
                    </CatalogTableCell>
                  ))}
                </CatalogTableRow>
              ))}
            </CatalogTable>
          </CatalogTablePanel>
        </div>
      )}
    />
  );
}
