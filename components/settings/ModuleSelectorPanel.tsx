import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Factory, Package, Truck, type LucideIcon } from 'lucide-react';
import { useNotificationStore, useNavigationStore } from '../../stores';
import { useFactoryModules } from '../../core/modules/useModuleEnabled';
import { mmEnableModule, mmSetMaterialFeature, type MmMaterialFeatureKey } from '../../modules/material/lib/mmRpc';
import { useMmMaterialFeatures } from '../../modules/material/lib/useMmFeature';
import { supabase } from '../../lib/supabase';
import { queryKeys } from '../../lib/queryKeys';
import type { ModuleKey } from '../../core/modules/types';
import { DesktopWriteGate } from '../DesktopWriteGate';
import { Button, Modal } from '../ui';

const MODULES: {
  key: ModuleKey;
  label: string;
  hint: string;
  icon: LucideIcon;
  features: { key: string; label: string }[];
}[] = [
  {
    key: 'production',
    label: 'Production',
    hint: 'Orders, capture, planning',
    icon: Factory,
    features: [
      { key: 'transaction', label: 'Transaction' },
      { key: 'hourly', label: 'Hourly' },
      { key: 'qc_log', label: 'QC Log' },
      { key: 'batch', label: 'Batch' },
      { key: 'supervisor', label: 'Supervisor' },
      { key: 'audit', label: 'Audit' },
    ],
  },
  {
    key: 'shipment',
    label: 'Shipment',
    hint: 'Ship & final QC',
    icon: Truck,
    features: [
      { key: 'shipment_log', label: 'Shipment Log' },
      { key: 'final_rejection_log', label: 'Final Rejection Log' },
      { key: 'shipment_audit', label: 'Shipment Audit' },
    ],
  },
  {
    key: 'material',
    label: 'Material',
    hint: 'Sidebar → Material Management',
    icon: Package,
    features: [],
  },
];

const MATERIAL_SWITCHES: {
  key: MmMaterialFeatureKey;
  label: string;
  hint: string;
}[] = [
  {
    key: 'fabric_warehouse',
    label: 'Fabric warehouse',
    hint: 'Fabric Master, receiving, stock, QC, allocate, and store challan to cutting.',
  },
  {
    key: 'trims',
    label: 'Trims warehouse',
    hint: 'Trims master, receiving, stock, allocate, and issue.',
  },
];

function FeatureRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-600 truncate">{label}</span>
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
        On
      </span>
    </div>
  );
}

function FeatureSwitch({
  label,
  hint,
  on,
  busy,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  busy: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="text-[11px] text-slate-600 block truncate">{label}</span>
        <span className="text-[10px] text-slate-400 block leading-snug">{hint}</span>
      </div>
      <DesktopWriteGate>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy || disabled}
          onClick={onToggle}
          className={`relative shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
            on ? 'bg-blue-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              on ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </DesktopWriteGate>
    </div>
  );
}

export const ModuleSelectorPanel: React.FC = () => {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { data: modules, isLoading } = useFactoryModules();
  const materialOn = Boolean(modules?.find((m) => m.module_key === 'material')?.enabled);
  const materialFeatures = useMmMaterialFeatures(materialOn);
  const qc = useQueryClient();
  const { showNotification } = useNotificationStore();
  const [busyKey, setBusyKey] = useState<ModuleKey | null>(null);
  const [busyFeature, setBusyFeature] = useState<MmMaterialFeatureKey | null>(null);
  const [confirmOff, setConfirmOff] = useState<MmMaterialFeatureKey | null>(null);

  const isOn = (key: ModuleKey) => Boolean(modules?.find((m) => m.module_key === key)?.enabled);
  const featureOn = (key: MmMaterialFeatureKey) => materialFeatures.data?.[key] === true;

  const invalidate = async () => {
    if (!factoryId) return;
    await qc.invalidateQueries({ queryKey: queryKeys.factoryModules(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmConfigBundle(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmMaterialFeatures(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmFactoryFeatures(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmOps(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmV4Config(factoryId) });
  };

  const setModule = async (key: ModuleKey, enabled: boolean) => {
    setBusyKey(key);
    try {
      if (key === 'material' && enabled) {
        const res = await mmEnableModule({});
        if (res.ok === false) throw new Error(res.message);
      } else {
        const config = (modules?.find((m) => m.module_key === key)?.config ?? {}) as Record<string, unknown>;
        const { error } = await supabase.rpc('set_factory_module', {
          p_key: key,
          p_enabled: enabled,
          p_config: config,
        });
        if (error) throw error;
      }
      showNotification(`${MODULES.find((m) => m.key === key)?.label ?? key} ${enabled ? 'on' : 'off'}`, 'success');
      await invalidate();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const applyFeature = async (key: MmMaterialFeatureKey, enabled: boolean) => {
    setBusyFeature(key);
    try {
      const res = await mmSetMaterialFeature(key, enabled);
      if (res.ok === false) throw new Error(res.message);
      const label = MATERIAL_SWITCHES.find((row) => row.key === key)?.label ?? key;
      showNotification(`${label} ${enabled ? 'on' : 'off'}`, 'success');
      setConfirmOff(null);
      await invalidate();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setBusyFeature(null);
    }
  };

  const requestFeatureToggle = (key: MmMaterialFeatureKey) => {
    if (featureOn(key)) {
      setConfirmOff(key);
      return;
    }
    void applyFeature(key, true);
  };

  if (isLoading) {
    return (
      <div>
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Modules</h4>
        <p className="text-xs text-slate-400">Loading modules…</p>
      </div>
    );
  }

  const confirmLabel = MATERIAL_SWITCHES.find((row) => row.key === confirmOff)?.label ?? 'this switch';

  return (
    <div>
      <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Modules</h4>
      <div className="grid grid-cols-3 gap-3">
        {MODULES.map((m) => {
          const on = isOn(m.key);
          const busy = busyKey === m.key;
          const Icon = m.icon;

          return (
            <div
              key={m.key}
              className={`rounded-xl border px-3.5 py-3 flex flex-col gap-3 ${
                on ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      on ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 border border-slate-200'
                    }`}
                  >
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">{m.label}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.hint}</p>
                  </div>
                </div>
                <DesktopWriteGate>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => void setModule(m.key, !on)}
                    className={`relative shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
                      on ? 'bg-blue-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        on ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </DesktopWriteGate>
              </div>

              <div className="space-y-1.5 border-t border-slate-200/80 pt-2">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Features</p>
                {m.key === 'material' ? (
                  MATERIAL_SWITCHES.map((feature) => (
                      <FeatureSwitch
                        key={feature.key}
                        label={feature.label}
                        hint={feature.hint}
                        on={featureOn(feature.key)}
                        busy={busyFeature === feature.key || materialFeatures.isLoading}
                        disabled={!on}
                        onToggle={() => requestFeatureToggle(feature.key)}
                      />
                  ))
                ) : (
                  m.features.map((feature) => (
                    <FeatureRow key={feature.key} label={feature.label} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        isOpen={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        className="max-w-md"
      >
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">
            Turn off {confirmLabel}?
          </h4>
          <p className="text-[12px] text-slate-600 leading-relaxed">
            Hides the pages. Data stays.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmOff(null)}>
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                disabled={busyFeature !== null || confirmOff === null}
                onClick={() => {
                  if (confirmOff === null) return;
                  void applyFeature(confirmOff, false);
                }}
              >
                {busyFeature ? 'Saving…' : 'Turn off'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>
    </div>
  );
};
