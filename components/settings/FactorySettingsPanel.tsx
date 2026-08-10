import React, { useEffect, useMemo, useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { useSettingsStore, useNotificationStore, useNavigationStore } from "../../stores";
import { useFactoryProfileCatalog, useShiftsCatalog } from "../../lib/queries/settingsSlices";
import { SelectDropdown } from "../../components/ui";
import type { FactoryEntitlements } from "../../lib/factoryEntitlements";
import type { FactorySettings } from "../../types/settings";
import { DesktopWriteGate } from "../DesktopWriteGate";

const TIMEZONES = ["UTC", "Asia/Kolkata", "Asia/Dhaka", "Asia/Karachi", "Europe/London", "America/New_York"];

const ENTITLEMENT_LABELS: Record<keyof FactoryEntitlements, string> = {
  transaction: "Transaction",
  production: "Production",
  workforce: "Workforce",
  audit: "Audit",
  shipment: "Shipment",
};

const APP_OPTIONS: Record<keyof FactoryEntitlements, { id: string; label: string }[]> = {
  transaction: [{ id: "transaction", label: "Transaction" }],
  production: [
    { id: "hourly", label: "Hourly" },
    { id: "qc_log", label: "QC Log" },
    { id: "batch", label: "Batch" },
  ],
  workforce: [{ id: "supervisor", label: "Supervisor" }],
  audit: [{ id: "audit", label: "Audit" }],
  shipment: [
    { id: "shipment_log", label: "Shipment Log" },
    { id: "final_rejection_log", label: "Final Rejection Log" },
    { id: "shipment_audit", label: "Shipment Audit" },
  ],
};

export const FactorySettingsPanel: React.FC = () => {
  const { factoryId } = useNavigationStore();
  const { factory, loading: factoryLoading } = useFactoryProfileCatalog(factoryId);
  const { shifts } = useShiftsCatalog(factoryId, 'full');
  const updateFactory = useSettingsStore((s) => s.updateFactory);
  const { showNotification } = useNotificationStore();
  const [draft, setDraft] = useState<FactorySettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(factory);
  }, [factory]);

  const timezoneOptions = useMemo(
    () => TIMEZONES.map((t) => ({ value: t, label: t })),
    [],
  );

  const shiftOptions = useMemo(() => {
    const opts = shifts.map((s) => ({ value: s.id, label: s.name }));
    return [{ value: "", label: "None" }, ...opts];
  }, [shifts]);

  const updateField = <K extends keyof FactorySettings>(key: K, value: FactorySettings[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleEntitlement = (category: keyof FactoryEntitlements, appId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev.entitlements[category];
      const active = current.includes(appId as never);
      const next = active
        ? current.filter((id) => id !== appId)
        : [...current, appId as never];
      return {
        ...prev,
        entitlements: { ...prev.entitlements, [category]: next },
      };
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await updateFactory(draft);
      showNotification("Factory settings saved successfully", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save factory settings";
      showNotification(message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <p className="text-xs text-slate-500">Loading factory settings…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
          Factory Settings
        </h3>
        <DesktopWriteGate>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Changes
          </button>
        </DesktopWriteGate>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
            Factory Name
          </label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
            Factory Code
          </label>
          <input
            type="text"
            value={draft.code}
            onChange={(e) => updateField("code", e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
            Country
          </label>
          <input
            type="text"
            value={draft.country}
            onChange={(e) => updateField("country", e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
            Timezone
          </label>
          <SelectDropdown
            value={draft.timezone}
            onChange={(v) => updateField("timezone", v)}
            options={timezoneOptions}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
            Default Shift
          </label>
          <SelectDropdown
            value={draft.defaultShiftId ?? ""}
            onChange={(v) => updateField("defaultShiftId", v || null)}
            options={shiftOptions}
          />
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-semibold text-slate-500 uppercase mb-2">
          Floor App Entitlements
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {(Object.keys(APP_OPTIONS) as Array<keyof FactoryEntitlements>).map((category) => (
            <div key={category} className="border border-slate-100 rounded-lg p-3">
              <div className="text-[10px] font-bold text-slate-700 uppercase mb-2">
                {ENTITLEMENT_LABELS[category]}
              </div>
              <div className="space-y-2">
                {APP_OPTIONS[category].map((opt) => {
                  const active = draft.entitlements[category].includes(opt.id as never);
                  return (
                    <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleEntitlement(category, opt.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-700">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
