import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Factory, Package, Truck, type LucideIcon } from 'lucide-react';
import { useNotificationStore, useNavigationStore } from '../../stores';
import { useFactoryModules } from '../../core/modules/useModuleEnabled';
import { mmEnableModule, mmSetFactoryFeature } from '../../modules/material/lib/mmRpc';
import { mmSetFabricV4 } from '../../modules/material/lib/mmV4Rpc';
import { useMmFactoryFeatures } from '../../modules/material/lib/useMmFactoryFeatures';
import { useFabricV4Enabled, useRefreshMmV4Config } from '../../modules/material/lib/useMmV4Config';
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
    features: [{ key: 'in_house_mill', label: 'In-house mill' }],
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
  on,
  busy,
  onToggle,
}: {
  label: string;
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-600 truncate">{label}</span>
      <DesktopWriteGate>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
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
  const millFeatures = useMmFactoryFeatures(materialOn);
  const fabricV4On = useFabricV4Enabled(materialOn);
  const refreshV4 = useRefreshMmV4Config();
  const qc = useQueryClient();
  const { showNotification } = useNotificationStore();
  const [busyKey, setBusyKey] = useState<ModuleKey | null>(null);
  const [busyMill, setBusyMill] = useState(false);
  const [busyFabricV4, setBusyFabricV4] = useState(false);
  const [fabricV4Confirm, setFabricV4Confirm] = useState<boolean | null>(null);

  const isOn = (key: ModuleKey) => Boolean(modules?.find((m) => m.module_key === key)?.enabled);
  const millOn = millFeatures.data?.in_house_mill !== false;

  const invalidate = async () => {
    if (!factoryId) return;
    await qc.invalidateQueries({ queryKey: queryKeys.factoryModules(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmConfigBundle(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmFactoryFeatures(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmOps(factoryId) });
    await refreshV4();
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

  const setMill = async (enabled: boolean) => {
    setBusyMill(true);
    try {
      const res = await mmSetFactoryFeature('in_house_mill', enabled);
      if (res.ok === false) throw new Error(res.message);
      showNotification(enabled ? 'In-house mill on' : 'In-house mill off', 'success');
      await invalidate();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setBusyMill(false);
    }
  };

  const applyFabricV4 = async (enabled: boolean) => {
    setBusyFabricV4(true);
    try {
      const res = await mmSetFabricV4(enabled);
      if (res.ok === false) throw new Error(res.message);
      showNotification(enabled ? 'Fabric v4 on' : 'Fabric v4 off', 'success');
      setFabricV4Confirm(null);
      await invalidate();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setBusyFabricV4(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Modules</h4>
        <p className="text-xs text-slate-400">Loading modules…</p>
      </div>
    );
  }

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
                {m.key === 'material' && (
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Mill on: Fabric Mill sends tested rolls to the warehouse. Mill off: warehouse receives vendor GRNs and tests. Warehouse and store challans stay on either path.
                  </p>
                )}
                {m.key === 'material' ? (
                  on ? (
                    <>
                      <FeatureSwitch
                        label="In-house mill"
                        on={millOn}
                        busy={busyMill}
                        onToggle={() => void setMill(!millOn)}
                      />
                      <FeatureSwitch
                        label="Fabric v4 (new quality gate)"
                        on={fabricV4On}
                        busy={busyFabricV4}
                        onToggle={() => setFabricV4Confirm(!fabricV4On)}
                      />
                    </>
                  ) : (
                    <>
                      <FeatureRow label="In-house mill" />
                      <FeatureRow label="Fabric v4 (new quality gate)" />
                    </>
                  )
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
        isOpen={fabricV4Confirm !== null}
        onClose={() => setFabricV4Confirm(null)}
        className="max-w-md"
      >
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">
            {fabricV4Confirm ? 'Turn on Fabric v4?' : 'Turn off Fabric v4?'}
          </h4>
          <p className="text-[12px] text-slate-600 leading-relaxed">
            {fabricV4Confirm
              ? 'Receiving no longer waits for QC. Cutting requires a valid test and inspection for each roll\'s stage.'
              : 'The factory returns to the previous Material flow. New v4 pages stay hidden until Fabric v4 is on again.'}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="secondary" onClick={() => setFabricV4Confirm(null)}>
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                disabled={busyFabricV4 || fabricV4Confirm === null}
                onClick={() => {
                  if (fabricV4Confirm === null) return;
                  void applyFabricV4(fabricV4Confirm);
                }}
              >
                {busyFabricV4 ? 'Saving…' : fabricV4Confirm ? 'Turn on' : 'Turn off'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>
    </div>
  );
};
