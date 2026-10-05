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
import { mmSaveUnallocatedVendorGrn } from '../../lib/mmRpc';
import { mmWhSaveVendorGrnV4 } from '../../lib/mmV4Rpc';
import { useInvalidateMmOps } from '../../lib/useMmOps';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { useFabricV4Enabled, useMmV4Config } from '../../lib/useMmV4Config';

export default function MmWarehouseReceiveUnallocatedPage() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const fabricV4 = useFabricV4Enabled();
  const { data: v4 } = useMmV4Config(fabricV4);
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
  const vendors = useMemo(
    () =>
      (v4?.facilities ?? []).filter(
        (f) =>
          f.is_active !== false &&
          f.ownership === 'external' &&
          (f.kind === 'vendor' || f.kind === 'mill'),
      ),
    [v4?.facilities],
  );
  const stages = v4?.stages ?? [];
  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];
  const defaultStage =
    stages.find((s) => s.code === 'FINISHED')?.code ||
    stages.find((s) => s.can_cut)?.code ||
    stages[stages.length - 1]?.code ||
    'FINISHED';

  const [supplier, setSupplier] = useState('');
  const [vendorFacilityId, setVendorFacilityId] = useState('');
  const [fabricTypeId, setFabricTypeId] = useState('');
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
    if (!fabricTypeId) {
      showNotification('Fabric type is required', 'error');
      return;
    }
    if (fabricV4) {
      if (!vendorFacilityId) {
        showNotification('Select a vendor', 'error');
        return;
      }
    } else if (!supplier.trim()) {
      showNotification('Supplier name is required', 'error');
      return;
    }
    setBusy(true);
    try {
      if (fabricV4) {
        const res = await mmWhSaveVendorGrnV4({
          vendor_facility_id: vendorFacilityId,
          style: null,
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
        if (res.ok === false) throw new Error(res.message);
        const challanNo = String(
          (res.data as { challan_no?: string }).challan_no ??
            (res.data as { grn_no?: string }).grn_no ??
            'GRN',
        );
        const challanId = String((res.data as { id?: string }).id ?? '');
        showNotification(`Received ${challanNo}`, 'success');
        await invalidate();
        if (challanId) {
          requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: challanId });
        } else {
          requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL);
        }
      } else {
        const res = await mmSaveUnallocatedVendorGrn(
          fabricTypeId,
          supplier.trim(),
          uom.trim() || 'm',
          colorRef.trim(),
          lotNo.trim(),
          parsed.rolls,
        );
        if (res.ok === false) throw new Error(res.message);
        showNotification(`Received ${res.data.challan_no} · ${res.data.roll_count} rolls`, 'success');
        await invalidate();
        requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: res.data.id });
      }
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Receive failed', 'error');
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
            {fabricV4 ? (
              <SelectDropdown
                label="Vendor *"
                value={vendorFacilityId}
                onChange={setVendorFacilityId}
                options={[
                  { value: '', label: 'Select vendor' },
                  ...vendors.map((v) => ({ value: v.id, label: v.name || v.code })),
                ]}
                className="w-full"
              />
            ) : (
              <Input
                id="mm-unalloc-supplier"
                label="Supplier *"
                value={supplier}
                disabled={busy}
                onChange={(e) => setSupplier(e.target.value)}
                className="bg-white"
              />
            )}
            <div>
              <span className="block font-medium text-slate-700 mb-1.5 text-[13px]">Fabric type *</span>
              <SelectDropdown
                value={fabricTypeId}
                onChange={setFabricTypeId}
                options={[
                  { value: '', label: 'Select fabric type' },
                  ...types.map((t) => ({ value: t.id, label: t.name })),
                ]}
                className="w-full"
              />
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
            {fabricV4 ? (
              <>
                <SelectDropdown
                  label="Stage"
                  value={stageCode || defaultStage}
                  onChange={setStageCode}
                  options={stages.map((s) => ({ value: s.code, label: s.label || s.code }))}
                  className="w-full"
                />
                <SelectDropdown
                  label="Roll / Lap"
                  value={unitForm}
                  onChange={setUnitForm}
                  options={unitForms.map((f) => ({ value: f, label: f }))}
                  className="w-full"
                />
                <SelectDropdown
                  label="Tubular / Open"
                  value={widthForm}
                  onChange={setWidthForm}
                  options={widthForms.map((f) => ({ value: f, label: f }))}
                  className="w-full"
                />
              </>
            ) : null}
            <div>
              <Input
                id="mm-unalloc-count"
                label="Rolls *"
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
                    !fabricTypeId ||
                    (fabricV4 ? !vendorFacilityId : !supplier.trim())
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
