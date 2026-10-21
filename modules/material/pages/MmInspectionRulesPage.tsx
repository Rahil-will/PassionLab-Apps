import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button, Modal } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { useNotificationStore } from '../../../stores';
import { InspStepsEditor } from '../components/InspStepsEditor';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import {
  mmGetInspectionRules,
  mmSaveInspectionRules,
  type MmInspectionRules,
} from '../lib/mmV4Rpc';
import {
  DEFAULT_INSP_STEPS,
  validatePointLimits,
  validateSteps,
} from '../lib/inspectionRules';

export interface MmInspectionRulesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type TypeDraft = {
  fabric_type_id: string;
  fabric_type_name: string;
  roll_max_points: string;
  lot_avg_max_points: string;
  inspection_required: boolean;
  steps: number[] | null;
};

function toDraft(data: MmInspectionRules): { steps: number[]; types: TypeDraft[] } {
  return {
    steps: Array.isArray(data.steps) && data.steps.length > 0 ? [...data.steps] : [...DEFAULT_INSP_STEPS],
    types: (data.types ?? []).map((t) => ({
      fabric_type_id: String(t.fabric_type_id),
      fabric_type_name: String(t.fabric_type_name ?? ''),
      roll_max_points: t.roll_max_points != null ? String(t.roll_max_points) : '40',
      lot_avg_max_points: t.lot_avg_max_points != null && String(t.lot_avg_max_points) !== '' ? String(t.lot_avg_max_points) : '',
      inspection_required: t.inspection_required !== false,
      steps: Array.isArray(t.steps) && t.steps.length > 0 ? [...t.steps] : null,
    })),
  };
}

const MmInspectionRulesPage = forwardRef<
  MmInspectionRulesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmInspectionRulesPage({ onDirtyChange }, ref) {
  const { showNotification } = useNotificationStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [steps, setSteps] = useState<number[]>([...DEFAULT_INSP_STEPS]);
  const [types, setTypes] = useState<TypeDraft[]>([]);
  const [baseline, setBaseline] = useState('');
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customSteps, setCustomSteps] = useState<number[]>([...DEFAULT_INSP_STEPS]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const res = await mmGetInspectionRules();
      if (cancel) return;
      setLoading(false);
      if (res.ok === false) { setLoadError(res.message); return; }
      const draft = toDraft(res.data);
      setSteps(draft.steps);
      setTypes(draft.types);
      setBaseline(JSON.stringify(draft));
    })();
    return () => { cancel = true; };
  }, []);

  const dirty = useMemo(
    () => baseline !== '' && JSON.stringify({ steps, types }) !== baseline,
    [baseline, steps, types],
  );

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const patchType = (id: string, patch: Partial<TypeDraft>) => {
    setTypes((current) => current.map((t) => (t.fabric_type_id === id ? { ...t, ...patch } : t)));
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      const stepsCheck = validateSteps(steps);
      if (!stepsCheck.ok) { showNotification(stepsCheck.message ?? 'Invalid steps', 'error'); return false; }
      for (const t of types) {
        const rollMax = t.roll_max_points.trim() === '' ? null : Number(t.roll_max_points);
        const lotAvg = t.lot_avg_max_points.trim() === '' ? null : Number(t.lot_avg_max_points);
        const pointsCheck = validatePointLimits(rollMax, lotAvg);
        if (!pointsCheck.ok) {
          showNotification(`${t.fabric_type_name}: ${pointsCheck.message}`, 'error');
          return false;
        }
        if (t.steps) {
          const customCheck = validateSteps(t.steps);
          if (!customCheck.ok) {
            showNotification(`${t.fabric_type_name}: ${customCheck.message}`, 'error');
            return false;
          }
        }
      }
      const res = await mmSaveInspectionRules({
        steps,
        types: types.map((t) => ({
          fabric_type_id: t.fabric_type_id,
          fabric_type_name: t.fabric_type_name,
          roll_max_points: Number(t.roll_max_points),
          lot_avg_max_points: t.lot_avg_max_points.trim() === '' ? null : Number(t.lot_avg_max_points),
          inspection_required: t.inspection_required,
          steps: t.steps,
        })),
      });
      if (res.ok === false) { showNotification(res.message, 'error'); return false; }
      const draft = toDraft(res.data);
      setSteps(draft.steps);
      setTypes(draft.types);
      setBaseline(JSON.stringify(draft));
      onDirtyChange?.(false);
      showNotification('Fabric inspection rules saved', 'success');
      return true;
    },
  }), [dirty, onDirtyChange, showNotification, steps, types]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError) {
    return <p className="text-xs text-red-600 p-2">{loadError}</p>;
  }

  const customType = customFor ? types.find((t) => t.fabric_type_id === customFor) ?? null : null;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto thin-scrollbar pr-1">
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-xs font-bold text-slate-800">Inspection flow (all fabric types)</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">How rolls are sampled and passed on 4-point inspection.</p>
        </div>
        <div className="px-4 py-4">
          <InspStepsEditor steps={steps} onChange={setSteps} />
          <p className="mt-3 text-[11px] leading-snug text-slate-500">
            A step fails when any inspected roll is over its roll limit, or the average of inspected rolls is over the lot limit. Failing moves to the next step; the sample grows, and rolls already inspected stay.
          </p>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0">
        <CatalogTablePanel
          title="Points by fabric type"
          subtitle="Roll limit and lot average, per fabric type"
          isEmpty={types.length === 0}
          emptyMessage="No fabric types yet."
          headerAction={<MmTableSaveButton />}
        >
          <CatalogTable
            headers={['S.No', 'Fabric type', 'Inspection required', 'Roll max (pts / 100 sq yd)', 'Lot average max', 'Flow']}
            widths={[undefined, '10rem', '9rem', '10rem', '9rem', '9rem']}
          >
            {types.map((t, idx) => (
              <CatalogTableRow key={t.fabric_type_id}>
                <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                <CatalogTableCell className="font-medium text-slate-800">{t.fabric_type_name || '—'}</CatalogTableCell>
                <CatalogTableCell>
                  <DesktopWriteGate>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={t.inspection_required}
                      aria-label={`Inspection required for ${t.fabric_type_name}`}
                      onClick={() => patchType(t.fabric_type_id, { inspection_required: !t.inspection_required })}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${t.inspection_required ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${t.inspection_required ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </DesktopWriteGate>
                  {!t.inspection_required ? (
                    <span className="ml-2 text-[10px] text-slate-400">Not required</span>
                  ) : null}
                </CatalogTableCell>
                <CatalogTableCell>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    aria-label={`Roll max for ${t.fabric_type_name}`}
                    value={t.roll_max_points}
                    onChange={(e) => patchType(t.fabric_type_id, { roll_max_points: e.target.value })}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-400"
                  />
                </CatalogTableCell>
                <CatalogTableCell>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Optional"
                    aria-label={`Lot average max for ${t.fabric_type_name}`}
                    value={t.lot_avg_max_points}
                    onChange={(e) => patchType(t.fabric_type_id, { lot_avg_max_points: e.target.value })}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-400"
                  />
                </CatalogTableCell>
                <CatalogTableCell>
                  {t.steps ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        Custom: {t.steps.join(' → ')}%
                      </span>
                      <DesktopWriteGate>
                        <button type="button" className="text-[11px] font-semibold text-blue-600 hover:text-blue-700" onClick={() => { setCustomFor(t.fabric_type_id); setCustomSteps([...t.steps ?? steps]); }}>
                          Edit
                        </button>
                        <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-slate-700" onClick={() => patchType(t.fabric_type_id, { steps: null })}>
                          Use default
                        </button>
                      </DesktopWriteGate>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Default</span>
                      <DesktopWriteGate>
                        <button type="button" className="text-[11px] font-semibold text-blue-600 hover:text-blue-700" onClick={() => { setCustomFor(t.fabric_type_id); setCustomSteps([...steps]); }}>
                          Custom…
                        </button>
                      </DesktopWriteGate>
                    </span>
                  )}
                </CatalogTableCell>
              </CatalogTableRow>
            ))}
          </CatalogTable>
        </CatalogTablePanel>
      </section>

      <Modal isOpen={Boolean(customType)} onClose={() => setCustomFor(null)} className="max-w-2xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Custom flow — {customType?.fabric_type_name}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Used for this fabric type instead of the default flow.</p>
          </div>
          <button type="button" onClick={() => setCustomFor(null)} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <InspStepsEditor steps={customSteps} onChange={setCustomSteps} compact />
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50/60">
          <Button variant="secondary" size="sm" onClick={() => setCustomFor(null)}>Cancel</Button>
          <DesktopWriteGate>
            <Button
              variant="primary"
              size="sm"
              disabled={!validateSteps(customSteps).ok}
              onClick={() => {
                if (customType) patchType(customType.fabric_type_id, { steps: [...customSteps] });
                setCustomFor(null);
              }}
            >
              Use custom flow
            </Button>
          </DesktopWriteGate>
        </div>
      </Modal>
    </div>
  );
});

export default MmInspectionRulesPage;
