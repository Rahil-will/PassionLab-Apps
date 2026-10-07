import React, { useMemo, useState } from 'react';
import { Button, Input, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import {
  blankDraftRoll,
  draftsToRollWrites,
  withLengthField,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import { mmMillSaveBatchV4, type MmV4BatchKind } from '../../lib/mmV4Rpc';
import { useFabricV4Enabled, useMmV4Config, useRefreshMmV4Config } from '../../lib/useMmV4Config';
import { unitFormOptionLabel } from '../../lib/mmUnitForm';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

type RollMeta = {
  machine_id: string;
  shift: string;
  unit_form: string;
  width_form: string;
};

export default function MmMillBatchFormV4Page() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const v4On = useFabricV4Enabled();
  const { data: config } = useMmConfigBundle();
  const { data: v4 } = useMmV4Config(v4On);
  const refreshV4 = useRefreshMmV4Config();

  usePageHeader({ subtitle: 'Create a style or general mill batch and enter rolls.' });

  const mills = useMemo(
    () => (v4?.facilities ?? []).filter((f) => f.kind === 'mill' && f.ownership === 'internal' && f.is_active !== false),
    [v4?.facilities],
  );
  const fabricTypes = useMemo(
    () =>
      (config?.types ?? [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({ id: String(t.id), name: String(t.name ?? '') }))
        .filter((t) => t.id && t.name),
    [config?.types],
  );
  const stages = v4?.stages ?? [];
  const initialStage = stages.find((s) => s.is_initial)?.code || stages[0]?.code || 'GREIGE';
  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];

  const [batchKind, setBatchKind] = useState<MmV4BatchKind>('general');
  const [facilityId, setFacilityId] = useState('');
  const [fabricTypeId, setFabricTypeId] = useState('');
  const [millRef, setMillRef] = useState('');
  const [yarnLot, setYarnLot] = useState('');
  const [yarnCount, setYarnCount] = useState('');
  const [productionDate, setProductionDate] = useState(todayIso());
  const [stageCode, setStageCode] = useState(initialStage);
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<MmDraftRoll[]>([blankDraftRoll([], '1')]);
  const [metaByLocal, setMetaByLocal] = useState<Record<string, RollMeta>>({});
  const [saving, setSaving] = useState(false);

  const activeFacilityId = facilityId || mills[0]?.id || '';
  const machines = useMemo(
    () => (v4?.machines ?? []).filter((m) => m.facility_id === activeFacilityId && m.is_active !== false),
    [v4?.machines, activeFacilityId],
  );

  const fields = useMemo(() => withLengthField([]), []);

  const patchMeta = (localId: string, patch: Partial<RollMeta>) => {
    setMetaByLocal((prev) => ({
      ...prev,
      [localId]: {
        machine_id: '',
        shift: '',
        unit_form: unitForms[0] ?? 'roll',
        width_form: widthForms[0] ?? 'tubular',
        ...prev[localId],
        ...patch,
      },
    }));
  };

  const save = async () => {
    if (batchKind === 'style') {
      showNotification('Style batches: pick a fabric from Allocated fabrics for now, or use General', 'error');
      return;
    }
    if (!activeFacilityId) {
      showNotification('Select a mill', 'error');
      return;
    }
    if (!fabricTypeId) {
      showNotification('Select a fabric type', 'error');
      return;
    }
    const { rolls, error } = draftsToRollWrites(rows, fields);
    if (error) {
      showNotification(error, 'error');
      return;
    }
    setSaving(true);
    try {
      const payloadRolls = rolls.map((roll) => {
        const draft = rows.find((r) => r.roll_no.trim() === String(roll.unit_code ?? '').trim());
        const meta = draft ? metaByLocal[draft.localId] : undefined;
        return {
          unit_code: String(roll.unit_code ?? ''),
          length_m: roll.length_m,
          weight_kg: roll.weight_kg ?? null,
          shade: roll.shade ?? null,
          lot_no: roll.lot_no ?? null,
          color_ref: roll.color_ref ?? null,
          attributes: roll.attributes ?? null,
          machine_id: meta?.machine_id || null,
          shift: meta?.shift || null,
          unit_form: meta?.unit_form || null,
          width_form: meta?.width_form || null,
        };
      });
      const res = await mmMillSaveBatchV4({
        facility_id: activeFacilityId,
        fabric_type_id: fabricTypeId,
        mill_ref: millRef.trim() || null,
        production_date: productionDate || null,
        initial_stage_code: stageCode || 'GREIGE',
        yarn_lot: yarnLot.trim() || null,
        yarn_count: yarnCount.trim() || null,
        remarks: remarks.trim() || null,
        rolls: payloadRolls,
      });
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return;
      }
      showNotification(`Batch ${res.data.batch_no} saved`, 'success');
      await refreshV4();
      requestNavigate(RoutePath.MATERIAL_MILL_BATCH_DETAIL, { batchId: res.data.id });
    } finally {
      setSaving(false);
    }
  };

  if (!v4On) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">Fabric v4 is off. Use the existing mill assign screens.</div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SelectDropdown
            label="Batch kind"
            value={batchKind}
            onChange={(v) => setBatchKind(v === 'style' ? 'style' : 'general')}
            options={[
              { value: 'general', label: 'General batch' },
              { value: 'style', label: 'Style batch' },
            ]}
            className="w-44"
          />
          <SelectDropdown
            label="Mill"
            value={activeFacilityId}
            onChange={setFacilityId}
            options={mills.map((m) => ({ value: m.id, label: m.name || m.code }))}
            className="w-52"
          />
          <SelectDropdown
            label="Fabric type"
            value={fabricTypeId}
            onChange={setFabricTypeId}
            options={fabricTypes.map((t) => ({ value: t.id, label: t.name }))}
            className="w-52"
          />
          <SelectDropdown
            label="Initial stage"
            value={stageCode || initialStage}
            onChange={setStageCode}
            options={stages.map((s) => ({ value: s.code, label: s.label || s.code }))}
            className="w-40"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="Mill ref" value={millRef} onChange={(e) => setMillRef(e.target.value)} />
          <Input label="Yarn lot" value={yarnLot} onChange={(e) => setYarnLot(e.target.value)} />
          <Input label="Yarn count" value={yarnCount} onChange={(e) => setYarnCount(e.target.value)} />
          <LabeledDatePicker label="Production date" value={productionDate} onChange={setProductionDate} />
        </div>
        <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />

        {batchKind === 'style' ? (
          <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Style batch create from this form is next. Use Allocated fabrics → assign for style batches, or switch to General.
          </p>
        ) : null}

        <MmRollEntryGrid
          title="Rolls"
          subtitle="Enter rolls. Machine, shift, and form below apply per row."
          fields={fields}
          rows={rows}
          onChange={setRows}
          uom="m"
        />

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[9px]">
                <th className="px-2 py-1.5 text-left">Roll</th>
                <th className="px-2 py-1.5 text-left">Machine</th>
                <th className="px-2 py-1.5 text-left">Shift</th>
                <th className="px-2 py-1.5 text-left">Form</th>
                <th className="px-2 py-1.5 text-left">Width</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = metaByLocal[row.localId] ?? {
                  machine_id: '',
                  shift: '',
                  unit_form: unitForms[0] ?? 'roll',
                  width_form: widthForms[0] ?? 'tubular',
                };
                return (
                  <tr key={row.localId} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-medium">{row.roll_no || '—'}</td>
                    <td className="px-2 py-1">
                      <SelectDropdown
                        value={meta.machine_id}
                        onChange={(v) => patchMeta(row.localId, { machine_id: v })}
                        options={[
                          { value: '', label: '—' },
                          ...machines.map((m) => ({ value: m.id, label: m.code || m.name || m.id })),
                        ]}
                        className="w-36"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="h-8 w-24 border border-slate-200 rounded px-2"
                        value={meta.shift}
                        onChange={(e) => patchMeta(row.localId, { shift: e.target.value })}
                        placeholder="A / B"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <SelectDropdown
                        value={meta.unit_form}
                        onChange={(v) => patchMeta(row.localId, { unit_form: v })}
                        options={unitForms.map((f) => ({ value: f, label: unitFormOptionLabel(f) }))}
                        className="w-28"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <SelectDropdown
                        value={meta.width_form}
                        onChange={(v) => patchMeta(row.localId, { width_form: v })}
                        options={widthForms.map((f) => ({
                          value: f,
                          label: f === 'tubular' ? 'Tubular' : f === 'open' ? 'Open' : f,
                        }))}
                        className="w-28"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={saving || batchKind === 'style'} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save batch'}
            </Button>
          </DesktopWriteGate>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCHES)}
          >
            Cancel
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
