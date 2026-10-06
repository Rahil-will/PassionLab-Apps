import React, { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { useSettingsStore, useNotificationStore, useNavigationStore } from "../../stores";
import { useFactoryProfileCatalog, useShiftsCatalog } from "../../lib/queries/settingsSlices";
import { SelectDropdown } from "../../components/ui";
import type { FactorySettings } from "../../types/settings";
import { useDesktopWriteRole } from "../DesktopWriteGate";
import { ModuleSelectorPanel } from "./ModuleSelectorPanel";

const TIMEZONES = ["UTC", "Asia/Kolkata", "Asia/Dhaka", "Asia/Karachi", "Europe/London", "America/New_York"];

const fieldLabelCls = "block text-[10px] font-semibold text-slate-500 uppercase mb-1";
const inputCls =
  "w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500";

export const FactorySettingsPanel: React.FC<{
  onSaveReady?: (api: { save: () => void; saving: boolean } | null) => void;
}> = ({ onSaveReady }) => {
  const { factoryId } = useNavigationStore();
  const canWrite = useDesktopWriteRole();
  const { factory } = useFactoryProfileCatalog(factoryId);
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

  const onSaveReadyRef = React.useRef(onSaveReady);
  onSaveReadyRef.current = onSaveReady;
  const saveRef = React.useRef(handleSave);
  saveRef.current = handleSave;

  React.useEffect(() => {
    onSaveReadyRef.current?.({
      save: () => { void saveRef.current(); },
      saving,
    });
  }, [saving]);

  React.useEffect(() => () => onSaveReadyRef.current?.(null), []);

  if (!draft) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <p className="text-xs text-slate-500">Loading factory settings…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Building2 size={14} />
          </span>
          <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Factory profile
          </h4>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <div className="min-w-0">
            <label className={fieldLabelCls}>Factory Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => updateField("name", e.target.value)}
              disabled={!canWrite}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={fieldLabelCls}>Country</label>
            <input
              type="text"
              value={draft.country}
              onChange={(e) => updateField("country", e.target.value)}
              disabled={!canWrite}
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className={fieldLabelCls}>Timezone</label>
            <SelectDropdown
              value={draft.timezone}
              onChange={(v) => updateField("timezone", v)}
              options={timezoneOptions}
              disabled={!canWrite}
            />
          </div>
          <div className="min-w-0">
            <label className={fieldLabelCls}>Default Shift</label>
            <SelectDropdown
              value={draft.defaultShiftId ?? ""}
              onChange={(v) => updateField("defaultShiftId", v || null)}
              options={shiftOptions}
              disabled={!canWrite}
            />
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <ModuleSelectorPanel />
      </section>
    </div>
  );
};
