import React, { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Button, Card, Input, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import {
  draftQtySum,
  draftsToRollWrites,
  formatQtyM,
  growMillBatchRolls,
  MAX_MILL_BATCH_ROLLS,
  parseRollCount,
  withLengthField,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import { mmWhSaveVendorGrnV5 } from '../../lib/mmV4Rpc';
import { FabricPicker } from '../../components/FabricPicker';
import { fabricMismatchMessage } from '../../lib/fabricStock';
import type { MmFabric } from '../../lib/mmFabricRpc';
import { useInvalidateMmOps } from '../../lib/useMmOps';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { useMmPartners, useMmV4Config } from '../../lib/useMmV4Config';
import { unitFormLabel, unitFormOptionLabel } from '../../lib/mmUnitForm';

function countFieldLabel(form: string): string {
  const word = unitFormLabel(form, 2);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} *`;
}

export default function MmWarehouseReceiveUnallocatedPage() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const { data: v4 } = useMmV4Config();
  const { data: config, isLoading, error, refetch } = useMmConfigBundle();
  const types = useMemo(
    () =>
      (config?.types ?? [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({ id: String(t.id), name: String(t.name ?? '') }))
        .filter((t) => t.id && t.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [config?.types],
  );
  const fabricVendorsQ = useMmPartners('fabric_vendor', false);
  const vendors = fabricVendorsQ.data ?? [];
  const stages = v4?.stages ?? [];
  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];
  const defaultStage =
    stages.find((s) => s.code === 'FINISHED')?.code ||
    stages.find((s) => s.can_cut)?.code ||
    stages[stages.length - 1]?.code ||
    'FINISHED';

  const [vendorFacilityId, setVendorFacilityId] = useState('');
  const [fabricId, setFabricId] = useState('');
  const [fabricLabel, setFabricLabel] = useState('');
  const [fabricTypeId, setFabricTypeId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [uom, setUom] = useState('m');
  const [colorRef, setColorRef] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [stageCode, setStageCode] = useState('');
  const [unitForm, setUnitForm] = useState('roll');
  const [widthForm, setWidthForm] = useState('open');
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rows, setRows] = useState<MmDraftRoll[]>([]);
  const [busy, setBusy] = useState(false);

  const fields = useMemo(() => withLengthField([], uom), [uom]);
  const qty = draftQtySum(rows);

  usePageHeader({
    subtitle: 'Receive vendor rolls without a style. Test and putaway as usual, then allocate from Stock.',
  });

  const generate = () => {
    const n = parseRollCount(rollCount.trim());
    if (n == null) {
      setCountError(`Enter a whole number from 1 to ${MAX_MILL_BATCH_ROLLS}`);
      return;
    }
    setCountError(null);
    setRows(growMillBatchRolls(rows, n, fields));
  };

  const save = async () => {
    const parsed = draftsToRollWrites(rows, fields);
    if (parsed.error) {
      showNotification(parsed.error, 'error');
      return;
    }
    if (!fabricId) {
      showNotification('Fabric is required', 'error');
      return;
    }
    if (!vendorFacilityId) {
      showNotification('Select a fabric vendor', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmWhSaveVendorGrnV5({
        vendor_facility_id: vendorFacilityId,
        style: null,
        fabric_id: fabricId,
        fabric_type_id: fabricTypeId,
        uom: uom.trim() || 'm',
        color_ref: colorRef.trim() || null,
        lot: lotNo.trim() || null,
        stage_code: stageCode || defaultStage || null,
        unit_form: unitForm || null,
        width_form: widthForm || null,
        rolls: parsed.rolls.map((roll) => ({
          length: roll.length_m,
          weight_kg: roll.weight_kg ?? null,
          shade: roll.shade ?? null,
          lot_no: roll.lot_no ?? null,
          color_ref: roll.color_ref ?? null,
          roll_no: String(roll.unit_code ?? ''),
        })),
      });
      if (res.ok === false) {
        const mismatch = fabricMismatchMessage(res);
        if (mismatch) setFormError(`Fabric mismatch — ${mismatch}`);
        else showNotification(res.message, 'error');
        return;
      }
      const challanNo = String(
        (res.data as { challan_no?: string }).challan_no ??
          (res.data as { grn_no?: string }).grn_no ??
          'GRN',
      );
      const challanId = String((res.data as { id?: string }).id ?? '');
      showNotification(`Received ${challanNo} · ${fabricLabel}`, 'success');
      await invalidate();
      if (challanId) {
        requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: challanId });
      } else {
        requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Receive failed';
      const mismatch = fabricMismatchMessage({ ok: false, message });
      if (mismatch) setFormError(`Fabric mismatch — ${mismatch}`);
      else showNotification(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card">
      <Card className="shadow-sm border-slate-200" noPadding>
        <div className="px-5 py-4">
          <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <ClipboardList size={16} className="text-primary-600" />
            Vendor GRN
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {vendors.length === 0 && !fabricVendorsQ.isLoading ? (
              <p className="text-[11px] text-slate-500">
                No fabric vendors yet — add them in Settings › Material › Fabric vendors.
              </p>
            ) : (
              <SelectDropdown
                label="Fabric vendor *"
                value={vendorFacilityId}
                onChange={setVendorFacilityId}
                options={[
                  { value: '', label: 'Select fabric vendor' },
                  ...vendors.map((v) => ({ value: v.id, label: v.name })),
                ]}
                className="w-full"
              />
            )}
            <div>
              <FabricPicker
                label="Fabric *"
                value={fabricId || null}
                disabled={busy}
                onChange={(fabric: MmFabric) => {
                  setFabricId(fabric.id);
                  setFabricLabel(`${fabric.code} · ${fabric.name}`);
                  setFabricTypeId(fabric.fabric_type_id);
                  setUom(fabric.uom);
                  setFormError(null);
                }}
                onClear={() => {
                  setFabricId('');
                  setFabricLabel('');
                  setFabricTypeId('');
                }}
              />
              {fabricTypeId ? (
                <p className="mt-1 text-[10px] text-slate-500">
                  Type locked: {types.find((t) => t.id === fabricTypeId)?.name ?? 'fabric type'}
                </p>
              ) : null}
            </div>
            <Input
              id="mm-unalloc-uom"
              label="UOM"
              value={uom}
              disabled={busy}
              onChange={(e) => setUom(e.target.value)}
              className="bg-white"
            />
            <Input
              id="mm-unalloc-color"
              label="Color ref"
              value={colorRef}
              disabled={busy}
              placeholder="Optional"
              onChange={(e) => setColorRef(e.target.value)}
              className="bg-white"
            />
            <Input
              id="mm-unalloc-lot"
              label="Lot no"
              value={lotNo}
              disabled={busy}
              placeholder="Optional"
              onChange={(e) => setLotNo(e.target.value)}
              className="bg-white"
            />
            <SelectDropdown
              label="Stage"
              value={stageCode || defaultStage}
              onChange={setStageCode}
              options={stages.map((s) => ({ value: s.code, label: s.label || s.code }))}
              className="w-full"
            />
            <SelectDropdown
              label="Form"
              value={unitForm}
              onChange={setUnitForm}
              options={unitForms.map((f) => ({ value: f, label: unitFormOptionLabel(f) }))}
              className="w-full"
            />
            <SelectDropdown
              label="Width form"
              value={widthForm}
              onChange={setWidthForm}
              options={widthForms.map((f) => ({
                value: f,
                label: f === 'tubular' ? 'Tubular' : f === 'open' ? 'Open' : f,
              }))}
              className="w-full"
            />
            <div>
              <Input
                id="mm-unalloc-count"
                label={countFieldLabel(unitForm)}
                type="number"
                min={1}
                max={MAX_MILL_BATCH_ROLLS}
                inputMode="numeric"
                value={rollCount}
                disabled={busy}
                placeholder="e.g. 12"
                onChange={(e) => {
                  setRollCount(e.target.value);
                  if (countError) setCountError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    generate();
                  }
                }}
                error={countError ?? undefined}
                className="bg-white"
              />
            </div>
          </div>
          {formError ? (
            <p className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
          ) : null}
          <div className="mt-4 flex items-center gap-2">
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy} onClick={generate}>
                Generate rolls
              </Button>
            </DesktopWriteGate>
            <p className="text-[11px] text-slate-500">{formatQtyM(qty, uom)} · {rows.length} rolls</p>
          </div>
        </div>
      </Card>

      <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
        <MmRollEntryGrid
          title="Rolls"
          subtitle={`${formatQtyM(qty, uom)} · ${rows.length} ${rows.length === 1 ? 'roll' : 'rolls'}`}
          emptyMessage="Generate rolls to enter quantities."
          fields={fields}
          rows={rows}
          onChange={setRows}
          disabled={busy}
          framed={false}
          entryMode="none"
          columnSource="fields"
          align="center"
          showAutoFill
          showSerialNumber
          uom={uom}
          footerActions={
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE)}
              >
                Cancel
              </Button>
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    busy ||
                    rows.length === 0 ||
                    !fabricId ||
                    !vendorFacilityId
                  }
                  onClick={() => void save()}
                >
                  {busy ? 'Saving…' : 'Receive GRN'}
                </Button>
              </DesktopWriteGate>
            </>
          }
        />
      </Card>
    </PageShell>
  );
}
