import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Info, Package } from 'lucide-react';
import { Button, Card, Input, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { tokens } from '../../../../lib/designTokens';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import { MmFourPointInspectPanel } from '../../components/MmFourPointInspectPanel';
import {
  draftQtySum,
  draftsToRollWrites,
  formatQtyM,
  growMillBatchRolls,
  MAX_MILL_BATCH_ROLLS,
  millLineRollToDraft,
  parseRollCount,
  withLengthField,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import { mmSaveUnallocatedMillBatch, mmUpdateMillBatch, type MmTestField } from '../../lib/mmRpc';
import { useInvalidateMmOps, useMmUnallocatedMill } from '../../lib/useMmOps';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { millSingleValue, millTestCaptureFields, millQualityMode, unallocatedToLineRoll } from './millUnallocated';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const fieldLabelClass = 'block font-medium text-slate-700 mb-1.5';

function assignFormSnapshot(input: {
  fabricTypeId: string;
  batchNo: string;
  millRef: string;
  fabricRefName: string;
  productionDate: string;
  remarks: string;
  colorRef: string;
  lotNo: string;
  rows: MmDraftRoll[];
}): string {
  return JSON.stringify({
    fabricTypeId: input.fabricTypeId,
    batchNo: input.batchNo.trim(),
    millRef: input.millRef.trim(),
    fabricRefName: input.fabricRefName.trim(),
    productionDate: input.productionDate.trim().slice(0, 10),
    remarks: input.remarks.trim(),
    colorRef: input.colorRef.trim(),
    lotNo: input.lotNo.trim(),
    rows: input.rows.map((row) => ({
      id: row.id ?? '',
      roll_no: row.roll_no.trim(),
      length_m: row.length_m.trim(),
      weight_kg: row.weight_kg.trim(),
      shade: row.shade.trim(),
      lot_no: row.lot_no.trim(),
      attributes: Object.fromEntries(
        Object.entries(row.attributes)
          .map(([key, value]) => [key, value.trim()] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    })),
  });
}

export default function MmMillUnallocatedAssignPage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const setUnsaved = useNavigationStore((s) => s.setUnsaved);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const { data: config } = useMmConfigBundle();
  const millQuery = useMmUnallocatedMill();
  const batchId = params.batchId ?? '';
  const qualityMode = millQualityMode(params.mode);
  const testOnly = qualityMode === 'testing';
  const inspectOnly = qualityMode === 'inspection';
  const qualityLocked = Boolean(qualityMode);
  const editing = Boolean(batchId);

  const types = useMemo(
    () =>
      (config?.types ?? [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({ id: String(t.id), name: String(t.name ?? '') }))
        .filter((t) => t.id && t.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [config?.types],
  );

  const [fabricTypeId, setFabricTypeId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [millRef, setMillRef] = useState('');
  const [fabricRefName, setFabricRefName] = useState('');
  const [productionDate, setProductionDate] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [colorRef, setColorRef] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rows, setRows] = useState<MmDraftRoll[]>([]);
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const hydratedFor = useRef('');

  const typeFields = useMemo((): MmTestField[] => {
    if (!fabricTypeId) return [];
    const mapped = (config?.test_fields ?? []).flatMap((row) => {
      const rec = row as {
        id?: unknown;
        key?: unknown;
        label?: unknown;
        data_type?: unknown;
        options?: unknown;
        capture_site?: unknown;
        is_active?: unknown;
        type_id?: unknown;
      };
      if (rec.is_active === false || String(rec.type_id ?? '') !== fabricTypeId) return [];
      const id = String(rec.id ?? rec.key ?? '');
      const key = String(rec.key ?? '');
      if (!id || !key) return [];
      return [{
        id,
        key,
        label: String(rec.label ?? ''),
        data_type: String(rec.data_type ?? 'text'),
        options: rec.options,
        capture_site: rec.capture_site != null ? String(rec.capture_site) : 'either',
      }];
    });
    return millTestCaptureFields(mapped);
  }, [config?.test_fields, fabricTypeId]);
  const fields = useMemo(
    () => withLengthField(testOnly ? typeFields : [], 'm'),
    [testOnly, typeFields],
  );
  const batches = millQuery.data?.batches ?? [];
  const allRolls = millQuery.data?.rolls ?? [];
  const qty = draftQtySum(rows);
  const snapshot = useMemo(
    () => assignFormSnapshot({
      fabricTypeId, batchNo, millRef, fabricRefName, productionDate, remarks, colorRef, lotNo, rows,
    }),
    [fabricTypeId, batchNo, millRef, fabricRefName, productionDate, remarks, colorRef, lotNo, rows],
  );
  const dirty = baseline !== null && snapshot !== baseline;

  useEffect(() => {
    setUnsaved(inspectOnly ? false : dirty);
    return () => setUnsaved(false);
  }, [dirty, inspectOnly, setUnsaved]);

  useEffect(() => {
    if (qualityMode && !editing) {
      requestNavigate(RoutePath.MATERIAL_MILL_STOCK, { mode: qualityMode });
    }
  }, [qualityMode, editing, requestNavigate]);

  useEffect(() => {
    if (editing) return;
    const nextDate = todayIso();
    setFabricTypeId('');
    setBatchNo('');
    setMillRef('');
    setFabricRefName('');
    setProductionDate(nextDate);
    setRemarks('');
    setColorRef('');
    setLotNo('');
    setRollCount('');
    setCountError(null);
    setRows([]);
    setBaseline(assignFormSnapshot({
      fabricTypeId: '',
      batchNo: '',
      millRef: '',
      fabricRefName: '',
      productionDate: nextDate,
      remarks: '',
      colorRef: '',
      lotNo: '',
      rows: [],
    }));
  }, [editing]);

  useEffect(() => {
    if (!editing || !millQuery.data) return;
    const fieldKey = fields.map((field) => field.id).join(',');
    const hydrateKey = `${batchId}:${fieldKey}`;
    if (hydratedFor.current === hydrateKey) return;
    const batch = batches.find((row) => row.id === batchId);
    if (!batch) {
      showNotification('General PO batch not found', 'error');
      requestNavigate(qualityMode ? RoutePath.MATERIAL_MILL_STOCK : RoutePath.MATERIAL_MILL_UNALLOCATED, qualityMode ? { mode: qualityMode } : undefined);
      return;
    }
    const mine = allRolls.filter((roll) => roll.mill_batch_id === batchId && roll.at_mill);
    const nextRows = mine.map((roll) => millLineRollToDraft(unallocatedToLineRoll(roll), fields, 'm'));
    const nextDate = (batch.production_date ?? '').slice(0, 10) || todayIso();
    const nextColor = millSingleValue([batch.color_ref, ...mine.map((roll) => roll.color_ref)]);
    const nextLot = millSingleValue(mine.map((roll) => roll.lot_no));
    const nextRefName = batch.fabric_ref_name ?? '';
    setFabricTypeId(batch.fabric_type_id);
    setBatchNo(batch.batch_no);
    setMillRef(batch.mill_ref ?? '');
    setFabricRefName(nextRefName);
    setProductionDate(nextDate);
    setRemarks(batch.remarks ?? '');
    setColorRef(nextColor);
    setLotNo(nextLot);
    setRollCount(String(mine.length || ''));
    setCountError(null);
    setRows(nextRows);
    setBaseline(assignFormSnapshot({
      fabricTypeId: batch.fabric_type_id,
      batchNo: batch.batch_no,
      millRef: batch.mill_ref ?? '',
      fabricRefName: nextRefName,
      productionDate: nextDate,
      remarks: batch.remarks ?? '',
      colorRef: nextColor,
      lotNo: nextLot,
      rows: nextRows,
    }));
    hydratedFor.current = hydrateKey;
  }, [editing, batchId, millQuery.data, batches, allRolls, fields, qualityMode, requestNavigate, showNotification]);

  const pageTitle = inspectOnly
    ? '4-point inspection'
    : testOnly
      ? 'Test mill rolls'
      : editing
        ? 'Edit mill batch'
        : 'New General PO';
  const pageSubtitle = inspectOnly
    ? 'Actual length, actual width, cuttable width, and 4-point on this mill batch.'
    : testOnly
      ? 'Test parameters and shade sorting on this mill batch. Batch details stay as they are.'
      : editing
        ? 'Saved rolls stay in this batch. Generate a higher roll count to add more.'
        : 'A new batch number creates a separate stock row.';

  usePageHeader({ title: pageTitle, subtitle: pageSubtitle }, pageTitle);

  const generate = () => {
    const n = parseRollCount(rollCount.trim());
    if (n == null) {
      setCountError(`Enter a whole number from 1 to ${MAX_MILL_BATCH_ROLLS}`);
      return;
    }
    const saved = rows.filter((row) => Boolean(row.id)).length;
    if (n < saved) {
      setCountError(`This batch already has ${saved} saved rolls`);
      return;
    }
    setCountError(null);
    setRows(growMillBatchRolls(rows, n, fields));
  };

  const back = () => {
    if (qualityMode) {
      requestNavigate(RoutePath.MATERIAL_MILL_STOCK, { mode: qualityMode });
      return;
    }
    if (editing) {
      requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE, { batchId });
      return;
    }
    requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED);
  };

  const save = async () => {
    if (!dirty) return;
    const parsed = draftsToRollWrites(rows, fields);
    if (parsed.error) {
      showNotification(parsed.error, 'error');
      return;
    }
    if (!fabricTypeId) {
      showNotification('Fabric type is required', 'error');
      return;
    }
    if (!batchNo.trim()) {
      showNotification('Mill batch number is required', 'error');
      return;
    }
    const rolls = parsed.rolls.map((roll) => {
      const existing = allRolls.find((item) => item.id === roll.id);
      return {
        ...roll,
        color_ref: colorRef.trim() || existing?.color_ref || null,
        lot_no: roll.lot_no || existing?.lot_no || lotNo.trim() || null,
      };
    });
    const header = {
      batch_no: batchNo.trim(),
      mill_ref: millRef.trim(),
      production_date: productionDate,
      remarks: remarks.trim(),
      fabric_ref_name: fabricRefName.trim(),
      color_ref: colorRef.trim(),
    };
    setBusy(true);
    try {
      const batchVersion = batches.find((row) => row.id === batchId)?.row_version;
      const res = editing
        ? await mmUpdateMillBatch(batchId, header, rolls, batchVersion, testOnly)
        : await mmSaveUnallocatedMillBatch(fabricTypeId, header, colorRef.trim(), lotNo.trim(), rolls, fabricRefName.trim());
      if (res.ok === false) throw new Error(res.message);
      showNotification(
        testOnly ? `Saved mill tests on ${res.data.batch_no}` : editing ? `Updated mill batch ${res.data.batch_no}` : `Saved mill batch ${res.data.batch_no}`,
        'success',
      );
      setUnsaved(false);
      await invalidate();
      requestNavigate(
        qualityMode ? RoutePath.MATERIAL_MILL_STOCK : RoutePath.MATERIAL_MILL_UNALLOCATED_LINE,
        qualityMode ? { mode: qualityMode } : { batchId: res.data.id || batchId },
      );
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      loading={millQuery.isLoading}
      error={millQuery.error}
      onRetry={() => void millQuery.refetch()}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <Package size={16} className="text-primary-600" />
              Fabric details
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <span className={`${fieldLabelClass} text-[13px]`}>Fabric type *</span>
                <SelectDropdown
                  value={fabricTypeId}
                  onChange={setFabricTypeId}
                  options={[
                    { value: '', label: 'Select fabric type' },
                    ...types.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  className="w-full"
                  disabled={Boolean(editing) || busy || qualityLocked}
                />
              </div>
              <Input
                id="mm-free-fabric-ref"
                label="Fabric reference name"
                value={fabricRefName}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setFabricRefName(e.target.value)}
                className="bg-white"
              />
              <Input
                id="mm-free-color"
                label="Color ref"
                value={colorRef}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setColorRef(e.target.value)}
                className="bg-white"
              />
              <Input
                id="mm-free-lot"
                label="Lot no"
                value={lotNo}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setLotNo(e.target.value)}
                className="bg-white"
              />
            </div>
          </div>
        </Card>
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <ClipboardList size={16} className="text-primary-600" />
              {inspectOnly ? '4-point inspection' : testOnly ? 'Test mill rolls' : editing ? 'Edit mill batch' : 'Mill batch details'}
            </h4>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">Produced</p>
                <p className="text-[13px] font-bold text-slate-900 mt-1 tabular-nums">{formatQtyM(qty, 'm')}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {rows.length} {rows.length === 1 ? 'roll' : 'rolls'}
                </p>
              </div>
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">This batch</p>
                <p className="text-[13px] font-bold text-slate-900 mt-1 tabular-nums">{formatQtyM(qty, 'm')}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {rows.length} {rows.length === 1 ? 'roll' : 'rolls'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                id="mm-free-batch"
                label="Mill batch number *"
                value={batchNo}
                disabled={busy || qualityLocked}
                onChange={(e) => setBatchNo(e.target.value)}
                className="bg-white"
              />
              <Input
                id="mm-free-ref"
                label="Reference"
                value={millRef}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setMillRef(e.target.value)}
                className="bg-white"
              />
              {qualityLocked ? (
                <Input id="mm-free-date" label="Date *" value={productionDate} disabled className="bg-white" />
              ) : (
                <LabeledDatePicker
                  label="Date *"
                  value={productionDate}
                  onChange={setProductionDate}
                  variant="pill"
                  labelClassName={fieldLabelClass}
                />
              )}
              <Input
                id="mm-free-remarks"
                label="Remarks"
                value={remarks}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setRemarks(e.target.value)}
                className="bg-white"
              />
              {qualityLocked ? null : (
                <>
                  <Input
                    id="mm-free-count"
                    label="Rolls in this batch *"
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
                  <div>
                    <span className={`${fieldLabelClass} invisible`} style={{ fontSize: tokens.fontSize.body }}>
                      Generate
                    </span>
                    <DesktopWriteGate>
                      <Button type="button" size="sm" disabled={busy} onClick={generate} className="w-full">
                        Generate rolls
                      </Button>
                    </DesktopWriteGate>
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
              <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-blue-800 leading-snug">
                {inspectOnly
                  ? '4-point is one table on this mill batch: rolls, actual length, actual width, cuttable width, and points.'
                  : testOnly
                    ? 'Enter mill test values and shade. Roll numbers and quantity stay as saved.'
                    : 'These stay General PO until you assign them to a style or dispatch.'}
              </p>
            </div>
          </div>
        </Card>
      </div>
      {inspectOnly ? (
        <MmFourPointInspectPanel
          scopeKind="mill_batch"
          scopeId={batchId}
          uom="m"
          rolls={allRolls
            .filter((row) => row.mill_batch_id === batchId && row.at_mill)
            .map((row) => ({
              id: row.id,
              unit_code: row.unit_code,
              length_m: row.length_m,
              shade: row.shade,
              qc_result: row.qc_result,
              attributes: row.attributes,
            }))}
          subtitle="One table for this mill batch: rolls, actual length, actual width, cuttable width, and 4-point."
          onSaved={async () => {
            await invalidate();
            await millQuery.refetch();
          }}
        />
      ) : (
        <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
          <MmRollEntryGrid
            title={testOnly ? 'Tests and shade' : 'Rolls'}
            subtitle={`${formatQtyM(qty, 'm')} · ${rows.length} ${rows.length === 1 ? 'roll' : 'rolls'}`}
            emptyMessage={testOnly ? 'No rolls at the mill on this batch.' : 'Generate rolls to enter quantities.'}
            fields={fields}
            rows={rows}
            onChange={setRows}
            disabled={busy}
            framed={false}
            entryMode="none"
            columnSource="fields"
            align="center"
            showAutoFill={!testOnly}
            showSerialNumber
            lockIdentity={testOnly}
            showShade={testOnly}
            allowShadeEdit={testOnly}
            showRemove={!testOnly}
            uom="m"
            footerActions={(
              <>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={back}>Cancel</Button>
                <DesktopWriteGate>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || rows.length === 0 || !fabricTypeId || !batchNo.trim() || !dirty}
                    onClick={() => void save()}
                  >
                    {busy ? 'Saving…' : testOnly ? 'Save tests' : editing ? 'Save batch' : 'Save mill batch'}
                  </Button>
                </DesktopWriteGate>
              </>
            )}
          />
        </Card>
      )}
    </PageShell>
  );
}
