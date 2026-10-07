import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { Badge, Button, Input, Modal, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmAllocateRollsModal } from '../../components/MmAllocateRollsModal';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { MmQcInspectModalV4 } from '../../components/MmQcInspectModalV4';
import { MmQcTestModalV4 } from '../../components/MmQcTestModalV4';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import { MmRollPassportModalV4 } from '../../components/MmRollPassportModalV4';
import {
  blankDraftRoll,
  draftsToRollWrites,
  withLengthField,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import { mmDispatchMillRolls, type MmWarehouseStockRow } from '../../lib/mmRpc';
import {
  mmMillAddRollsV4,
  mmMillGetBatchV4,
  mmSetRollTags,
  type MmV4RollRow,
  type MmV4RollTags,
} from '../../lib/mmV4Rpc';
import { useFabricV4Enabled, useMmV4Config } from '../../lib/useMmV4Config';
import { unitFormOptionLabel } from '../../lib/mmUnitForm';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function unitId(roll: MmV4RollRow): string {
  return String(roll.mill_roll_id || roll.roll_id);
}

function custodyLabel(side: string | null | undefined): string {
  if (side === 'mill') return 'At mill';
  if (side === 'processing') return 'At processing';
  if (side === 'warehouse') return 'Dispatched';
  return '—';
}

function statusBadgeVariant(
  status: string | null | undefined,
): 'default' | 'success' | 'warning' | 'danger' {
  const s = String(status ?? 'NONE').toUpperCase();
  if (s === 'PASS') return 'success';
  if (s === 'FAILED') return 'danger';
  if (s === 'STALE' || s === 'INCOMPLETE' || s === 'HOLD') return 'warning';
  return 'default';
}

function rollToStockRow(roll: MmV4RollRow): MmWarehouseStockRow {
  return {
    id: unitId(roll),
    unit_code: roll.roll_code,
    qty: roll.length_m ?? null,
    uom: roll.uom ?? 'm',
    status: String(roll.custody?.status ?? 'at_mill'),
    bucket: 'receiving',
    status_label: custodyLabel(roll.custody?.side),
    location_code: roll.location?.code ?? null,
    location_name: roll.location?.name ?? 'Mill',
    order_id: null,
    style_material_id: null,
    style_name: String(roll.style?.style_name ?? ''),
    style_ref: roll.style?.style_ref != null ? String(roll.style.style_ref) : null,
    buyer_name: null,
    po_number: null,
    color_name: roll.color_ref ?? null,
    color_ref: roll.color_ref ?? null,
    shade: roll.shade ?? null,
    lot_no: roll.lot_no ?? null,
    fabric_name: roll.fabric_type_name ?? null,
    fabric_type: roll.fabric_type_name ?? null,
    fabric_type_id: roll.fabric_type_id ?? null,
    in_challan_id: null,
    challan_no: null,
    challan_source: 'mill',
    store_challan_id: null,
    received_at: null,
  };
}

type RollMeta = {
  machine_id: string;
  shift: string;
  unit_form: string;
  width_form: string;
};

export default function MmMillBatchDetailV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const v4On = useFabricV4Enabled();
  const { data: v4 } = useMmV4Config(v4On);
  const batchId = params.batchId ?? '';

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [passportId, setPassportId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [challanNo, setChallanNo] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [dispatchDate, setDispatchDate] = useState(todayIso());
  const [dispatchRemarks, setDispatchRemarks] = useState('');

  const [tagDraft, setTagDraft] = useState<MmV4RollTags>({});
  const [addRows, setAddRows] = useState<MmDraftRoll[]>([blankDraftRoll([], '1')]);
  const [addMeta, setAddMeta] = useState<Record<string, RollMeta>>({});

  usePageHeader({ subtitle: 'Batch rolls, custody, and mill actions.' });

  const detailQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchV4', batchId] as const,
    queryFn: async () => {
      const res = await mmMillGetBatchV4(batchId);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && v4On && batchId),
  });

  const rolls = detailQ.data?.rolls ?? [];
  const batch = detailQ.data?.batch ?? {};
  const batchNo = String(batch.batch_no ?? batch.batchNo ?? '—');
  const batchKind = String(batch.batch_kind ?? batch.batchKind ?? '');
  const fabricName = String(batch.fabric_type_name ?? batch.fabric_name ?? '—');
  const millName = String(
    (batch.facility as { name?: string; code?: string } | undefined)?.name ||
      (batch.facility as { name?: string; code?: string } | undefined)?.code ||
      '—',
  );

  const selectedRolls = useMemo(
    () => rolls.filter((r) => selected[r.roll_id]),
    [rolls, selected],
  );
  const selectedAtMill = useMemo(
    () => selectedRolls.filter((r) => r.custody?.side === 'mill'),
    [selectedRolls],
  );
  const selectedUnitIds = selectedAtMill.map(unitId);

  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];
  const stages = v4?.stages ?? [];
  const facilityId = String(
    (batch.facility as { id?: string } | undefined)?.id || batch.facility_id || '',
  );
  const machines = useMemo(
    () => (v4?.machines ?? []).filter((m) => m.facility_id === facilityId && m.is_active !== false),
    [v4?.machines, facilityId],
  );
  const fields = useMemo(() => withLengthField([]), []);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchV4', batchId],
    });
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchesV4'],
    });
  };

  const toggleAll = (on: boolean) => {
    if (!on) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const roll of rolls) next[roll.roll_id] = true;
    setSelected(next);
  };

  const runDispatch = async () => {
    if (selectedUnitIds.length === 0) {
      showNotification('Select rolls at the mill', 'error');
      return;
    }
    if (!challanNo.trim()) {
      showNotification('Enter a challan number', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmDispatchMillRolls(selectedUnitIds, {
        challan_no: challanNo.trim(),
        reference_no: referenceNo,
        sent_at: dispatchDate,
        remarks: dispatchRemarks,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`${res.data.challan_no} · ${res.data.roll_count} rolls dispatched`, 'success');
      setDispatchOpen(false);
      setSelected({});
      setChallanNo('');
      setReferenceNo('');
      setDispatchRemarks('');
      await refresh();
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind: 'mill', id: res.data.id });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Dispatch failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runTag = async () => {
    if (selectedRolls.length === 0) {
      showNotification('Select rolls to tag', 'error');
      return;
    }
    const tags: MmV4RollTags = {};
    if (tagDraft.machine_id) tags.machine_id = tagDraft.machine_id;
    if (tagDraft.shift) tags.shift = tagDraft.shift;
    if (tagDraft.unit_form) tags.unit_form = tagDraft.unit_form;
    if (tagDraft.width_form) tags.width_form = tagDraft.width_form;
    if (tagDraft.grade) tags.grade = tagDraft.grade;
    if (tagDraft.dye_lot) tags.dye_lot = tagDraft.dye_lot;
    if (tagDraft.stage_code) tags.stage_code = tagDraft.stage_code;
    if (Object.keys(tags).length === 0) {
      showNotification('Set at least one tag field', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmSetRollTags(
        selectedRolls.map((r) => r.roll_id),
        tags,
      );
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Tagged ${res.data.updated} rolls`, 'success');
      setTagOpen(false);
      setTagDraft({});
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Tag failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runAddRolls = async () => {
    const { rolls: writes, error } = draftsToRollWrites(addRows, fields);
    if (error) {
      showNotification(error, 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = writes.map((roll) => {
        const draft = addRows.find((r) => r.roll_no.trim() === String(roll.unit_code ?? '').trim());
        const meta = draft ? addMeta[draft.localId] : undefined;
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
      const res = await mmMillAddRollsV4(batchId, payload);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Added ${res.data.added} rolls`, 'success');
      setAddOpen(false);
      setAddRows([blankDraftRoll([], '1')]);
      setAddMeta({});
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Add rolls failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const patchAddMeta = (localId: string, patch: Partial<RollMeta>) => {
    setAddMeta((prev) => ({
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

  if (!v4On) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">Fabric v4 is off. Use the existing mill screens.</div>
      </PageShell>
    );
  }

  if (!batchId) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">Missing batch.</div>
      </PageShell>
    );
  }

  return (
    <PageShell loading={detailQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 mb-1"
              onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCHES)}
            >
              <ArrowLeft size={12} /> Batches
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-slate-900">{batchNo}</h2>
              {batchKind ? (
                <Badge variant={batchKind === 'general' ? 'outline' : 'primary'}>
                  {batchKind === 'general' ? 'General' : 'Style'}
                </Badge>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {millName} · {fabricName}
            </p>
          </div>
          <DesktopWriteGate>
            <Button type="button" size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
              Add rolls
            </Button>
          </DesktopWriteGate>
        </div>

        {detailQ.isError ? (
          <p className="text-[12px] text-red-600">
            {detailQ.error instanceof Error ? detailQ.error.message : 'Could not load batch'}
          </p>
        ) : null}

        {selectedRolls.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-[11px] font-semibold text-slate-700">
              {selectedRolls.length} selected
              {selectedAtMill.length !== selectedRolls.length
                ? ` · ${selectedAtMill.length} at mill`
                : ''}
            </span>
            <DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedAtMill.length === 0}
                onClick={() => setSendOpen(true)}
              >
                Send to processing
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
                Test
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setInspectOpen(true)}>
                Inspect
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedAtMill.length === 0}
                onClick={() => setAllocateOpen(true)}
              >
                Allocate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedAtMill.length === 0}
                onClick={() => setDispatchOpen(true)}
              >
                Dispatch to warehouse
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setTagOpen(true)}>
                Tag
              </Button>
            </DesktopWriteGate>
            <Button type="button" size="sm" variant="secondary" onClick={() => setSelected({})}>
              Clear
            </Button>
          </div>
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>
                    <input
                      type="checkbox"
                      checked={rolls.length > 0 && selectedRolls.length === rolls.length}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="Select all rolls"
                    />
                  </th>
                  <th className={th}>Roll</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Machine</th>
                  <th className={th}>Custody</th>
                  <th className={th}>Style</th>
                  <th className={`${th} text-right`}>Length</th>
                  <th className={th}>Test</th>
                  <th className={th}>Inspection</th>
                </tr>
              </thead>
              <tbody>
                {rolls.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      No rolls on this batch
                    </td>
                  </tr>
                ) : (
                  rolls.map((roll) => (
                    <tr key={roll.roll_id} className="hover:bg-slate-50">
                      <td className={td}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[roll.roll_id])}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [roll.roll_id]: e.target.checked }))
                          }
                          aria-label={`Select ${roll.roll_code}`}
                        />
                      </td>
                      <td className={`${td} font-semibold text-slate-900`}>
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => setPassportId(roll.roll_id)}
                        >
                          {roll.roll_code}
                        </button>
                      </td>
                      <td className={td}>
                        {roll.stage_code ? <Badge variant="outline">{roll.stage_code}</Badge> : '—'}
                      </td>
                      <td className={td}>{roll.machine?.code || roll.machine?.name || '—'}</td>
                      <td className={td}>{custodyLabel(roll.custody?.side)}</td>
                      <td className={`${td} max-w-[10rem] truncate`}>
                        {roll.style?.style_name || '—'}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {roll.length_m != null ? Number(roll.length_m).toFixed(1) : '—'}
                      </td>
                      <td className={td}>
                        <Badge variant={statusBadgeVariant(roll.test_status)}>
                          {String(roll.test_status ?? 'NONE')}
                        </Badge>
                      </td>
                      <td className={td}>
                        <Badge variant={statusBadgeVariant(roll.inspection_status)}>
                          {String(roll.inspection_status ?? 'NONE')}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <MmAllocateRollsModal
        open={allocateOpen}
        source="mill"
        rolls={selectedAtMill.map(rollToStockRow)}
        onClose={() => setAllocateOpen(false)}
        onDone={(overAllocated) => {
          setAllocateOpen(false);
          showNotification(
            overAllocated
              ? 'Assigned to style. That fabric is now over required qty.'
              : 'Assigned to style.',
            'success',
          );
          setSelected({});
          void refresh();
        }}
      />

      <MmProcSendModalV4
        open={sendOpen}
        side="mill"
        preselectedRollIds={selectedAtMill.map((r) => r.roll_id)}
        onClose={() => setSendOpen(false)}
        onSent={() => {
          setSendOpen(false);
          setSelected({});
          void refresh();
        }}
      />

      <MmQcTestModalV4
        open={testOpen}
        scopeKind={selectedRolls.length > 0 ? 'rolls' : 'mill_batch'}
        scopeId={selectedRolls.length > 0 ? null : batchId}
        rollIds={selectedRolls.length > 0 ? selectedRolls.map((r) => r.roll_id) : undefined}
        defaultSiteSide="mill"
        onClose={() => setTestOpen(false)}
        onSaved={() => {
          setTestOpen(false);
          void refresh();
        }}
      />
      <MmQcInspectModalV4
        open={inspectOpen}
        scopeKind={selectedRolls.length > 0 ? 'rolls' : 'mill_batch'}
        scopeId={selectedRolls.length > 0 ? null : batchId}
        rollIds={selectedRolls.length > 0 ? selectedRolls.map((r) => r.roll_id) : undefined}
        defaultSiteSide="mill"
        onClose={() => setInspectOpen(false)}
        onSaved={() => {
          setInspectOpen(false);
          void refresh();
        }}
      />
      <MmRollPassportModalV4
        open={Boolean(passportId)}
        rollId={passportId}
        onClose={() => setPassportId(null)}
      />

      <Modal isOpen={dispatchOpen} onClose={busy ? () => undefined : () => setDispatchOpen(false)} className="max-w-lg">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Dispatch to warehouse</h4>
          <p className="text-[11px] text-slate-500">{selectedUnitIds.length} rolls at mill.</p>
          <Input label="Challan no" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
          <Input label="Reference" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
          <LabeledDatePicker label="Dispatch date" value={dispatchDate} onChange={setDispatchDate} />
          <Input
            label="Remarks"
            value={dispatchRemarks}
            onChange={(e) => setDispatchRemarks(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setDispatchOpen(false)}>
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy} onClick={() => void runDispatch()}>
                {busy ? 'Dispatching…' : 'Dispatch'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>

      <Modal isOpen={tagOpen} onClose={busy ? () => undefined : () => setTagOpen(false)} className="max-w-lg">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Tag rolls</h4>
          <p className="text-[11px] text-slate-500">{selectedRolls.length} rolls · empty fields are left unchanged.</p>
          <SelectDropdown
            label="Machine"
            value={String(tagDraft.machine_id ?? '')}
            onChange={(v) => setTagDraft((d) => ({ ...d, machine_id: v || null }))}
            options={[
              { value: '', label: '—' },
              ...machines.map((m) => ({ value: m.id, label: m.code || m.name || m.id })),
            ]}
          />
          <Input
            label="Shift"
            value={String(tagDraft.shift ?? '')}
            onChange={(e) => setTagDraft((d) => ({ ...d, shift: e.target.value || null }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectDropdown
              label="Form"
              value={String(tagDraft.unit_form ?? '')}
              onChange={(v) => setTagDraft((d) => ({ ...d, unit_form: v || null }))}
              options={[
                { value: '', label: '—' },
                ...unitForms.map((f) => ({ value: f, label: unitFormOptionLabel(f) })),
              ]}
            />
            <SelectDropdown
              label="Width form"
              value={String(tagDraft.width_form ?? '')}
              onChange={(v) => setTagDraft((d) => ({ ...d, width_form: v || null }))}
              options={[
                { value: '', label: '—' },
                ...widthForms.map((f) => ({
                  value: f,
                  label: f === 'tubular' ? 'Tubular' : f === 'open' ? 'Open' : f,
                })),
              ]}
            />
          </div>
          <SelectDropdown
            label="Stage"
            value={String(tagDraft.stage_code ?? '')}
            onChange={(v) => setTagDraft((d) => ({ ...d, stage_code: v || null }))}
            options={[
              { value: '', label: '—' },
              ...stages.map((s) => ({ value: s.code, label: s.label || s.code })),
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Grade"
              value={String(tagDraft.grade ?? '')}
              onChange={(e) => setTagDraft((d) => ({ ...d, grade: e.target.value || null }))}
            />
            <Input
              label="Dye lot"
              value={String(tagDraft.dye_lot ?? '')}
              onChange={(e) => setTagDraft((d) => ({ ...d, dye_lot: e.target.value || null }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setTagOpen(false)}>
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy} onClick={() => void runTag()}>
                {busy ? 'Saving…' : 'Save tags'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>

      <Modal isOpen={addOpen} onClose={busy ? () => undefined : () => setAddOpen(false)} className="max-w-4xl">
        <div className="p-5 flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
          <h4 className="text-[14px] font-semibold text-slate-900">Add rolls</h4>
          <p className="text-[11px] text-slate-500">Append rolls to {batchNo} via mm_mill_add_rolls_v4.</p>
          <MmRollEntryGrid
            title="Rolls"
            subtitle="Machine, shift, and form apply per row below."
            fields={fields}
            rows={addRows}
            onChange={setAddRows}
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
                {addRows.map((row) => {
                  const meta = addMeta[row.localId] ?? {
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
                          onChange={(v) => patchAddMeta(row.localId, { machine_id: v })}
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
                          onChange={(e) => patchAddMeta(row.localId, { shift: e.target.value })}
                          placeholder="A / B"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <SelectDropdown
                          value={meta.unit_form}
                          onChange={(v) => patchAddMeta(row.localId, { unit_form: v })}
                          options={unitForms.map((f) => ({ value: f, label: unitFormOptionLabel(f) }))}
                          className="w-28"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <SelectDropdown
                          value={meta.width_form}
                          onChange={(v) => patchAddMeta(row.localId, { width_form: v })}
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
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy} onClick={() => void runAddRolls()}>
                {busy ? 'Saving…' : 'Add rolls'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
