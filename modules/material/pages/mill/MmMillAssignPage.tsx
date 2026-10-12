import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Info, Package, Search } from 'lucide-react';
import { Button, Card, Input } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmFabricSummaryCard, MmSummaryMetric } from '../../components/MmFabricSummaryCard';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import { MmFourPointInspectPanel } from '../../components/MmFourPointInspectPanel';
import {
  draftQtySum,
  draftsToRollWrites,
  formatQtyM,
  millDeclaredQty,
  MAX_MILL_BATCH_ROLLS,
  millLineRollToDraft,
  parseRollCount,
  growMillBatchRolls,
  sortMillAssignDrafts,
  withLengthField,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import { mmAllocateMillRollsToStyle, mmSaveMillBatch, mmUpdateMillBatch } from '../../lib/mmRpc';
import { fabricMismatchMessage } from '../../lib/fabricStock';
import { useInvalidateMmOps, useMmMillLine, useMmUnallocatedMill } from '../../lib/useMmOps';
import { millTestCaptureFields, millQualityMode } from './millUnallocated';
import { MmMillAssignFromStock } from './MmMillAssignFromStock';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const fieldLabelClass = 'block font-medium text-slate-700 mb-1.5';

function assignFormSnapshot(input: {
  batchNo: string;
  millRef: string;
  productionDate: string;
  remarks: string;
  rows: MmDraftRoll[];
}): string {
  return JSON.stringify({
    batchNo: input.batchNo.trim(),
    millRef: input.millRef.trim(),
    productionDate: input.productionDate.trim().slice(0, 10),
    remarks: input.remarks.trim(),
    rows: input.rows.map((row) => ({
      id: row.id ?? '',
      roll_no: row.roll_no.trim(),
      length_m: row.length_m.trim(),
      weight_kg: row.weight_kg.trim(),
      shade: row.shade.trim(),
      lot_no: row.lot_no.trim(),
      millWorkStatus: row.millWorkStatus ?? 'new',
      attributes: Object.fromEntries(
        Object.entries(row.attributes)
          .map(([key, value]) => [key, value.trim()] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    })),
  });
}

export default function MmMillAssignPage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const setUnsaved = useNavigationStore((s) => s.setUnsaved);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const orderId = params.orderId ?? '';
  const colorwayId = params.colorwayId ?? '';
  const fabricLineId = params.fabricLineId ?? '';
  const batchId = params.batchId ?? '';
  const qualityMode = millQualityMode(params.mode);
  const testOnly = qualityMode === 'testing';
  const inspectOnly = qualityMode === 'inspection';
  const qualityLocked = Boolean(qualityMode);
  const editing = Boolean(batchId);
  const lineParams = { orderId, colorwayId, fabricLineId };
  const { data, isLoading, error, refetch } = useMmMillLine(orderId, colorwayId, fabricLineId);

  const fields = testOnly
    ? millTestCaptureFields(data?.test_fields ?? [])
    : (data?.test_fields ?? []);
  const displayFields = useMemo(() => withLengthField(fields, data?.uom), [fields, data?.uom]);
  const [batchNo, setBatchNo] = useState('');
  const [millRef, setMillRef] = useState('');
  const [productionDate, setProductionDate] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rows, setRows] = useState<MmDraftRoll[]>([]);
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [stockBatchIds, setStockBatchIds] = useState<string[]>([]);
  const [stockSearch, setStockSearch] = useState('');
  const hydratedFor = useRef('');
  const creating = !editing && !qualityLocked;

  const fieldKey = displayFields.map((f) => f.id).join(',');

  useEffect(() => {
    hydratedFor.current = '';
    setBaseline(null);
  }, [batchId, fabricLineId]);

  useEffect(() => {
    if (qualityMode && !editing) {
      requestNavigate(RoutePath.MATERIAL_MILL_STOCK, { mode: qualityMode });
    }
  }, [qualityMode, editing, requestNavigate]);

  useEffect(() => {
    if (editing) return;
    const nextDate = todayIso();
    setBatchNo('');
    setMillRef('');
    setProductionDate(nextDate);
    setRemarks('');
    setRows([]);
    setRollCount('');
    setCountError(null);
    setStockBatchIds([]);
    setStockSearch('');
    setBaseline(assignFormSnapshot({
      batchNo: '',
      millRef: '',
      productionDate: nextDate,
      remarks: '',
      rows: [],
    }));
  }, [editing, fabricLineId, fieldKey]);

  useEffect(() => {
    if (!editing || !data || hydratedFor.current === batchId) return;
    const batch = (data.batches ?? []).find((row) => row.id === batchId);
    if (!batch) {
      showNotification('Mill batch not found', 'error');
      requestNavigate(
        qualityMode ? RoutePath.MATERIAL_MILL_STOCK : RoutePath.MATERIAL_MILL_LINE,
        qualityMode ? { mode: qualityMode } : { orderId, colorwayId, fabricLineId },
      );
      return;
    }
    const batchRolls = (data.rolls ?? []).filter(
      (row) => row.mill_batch_id === batchId && (!qualityLocked || row.at_mill),
    );
    const nextRows = sortMillAssignDrafts(batchRolls.map((row) => millLineRollToDraft(row, fields, data.uom)));
    const nextDate = (batch.production_date || todayIso()).slice(0, 10);
    const nextNo = batch.batch_no;
    const nextRef = batch.mill_ref ?? '';
    const nextRemarks = batch.remarks ?? '';
    setBatchNo(nextNo);
    setMillRef(nextRef);
    setProductionDate(nextDate);
    setRemarks(nextRemarks);
    setRows(nextRows);
    setRollCount(String(batchRolls.length || ''));
    setCountError(null);
    setBaseline(assignFormSnapshot({
      batchNo: nextNo,
      millRef: nextRef,
      productionDate: nextDate,
      remarks: nextRemarks,
      rows: nextRows,
    }));
    hydratedFor.current = batchId;
  }, [editing, batchId, data, fields, orderId, colorwayId, fabricLineId, requestNavigate, showNotification]);

  const uom = data?.uom ?? '';
  const stockQuery = useMmUnallocatedMill(creating);
  const fromStock = creating;
  const unallocatedBatches = useMemo(() => {
    return (stockQuery.data?.batches ?? []).filter((batch) => {
      if (data?.fabric_type_id && batch.fabric_type_id !== data.fabric_type_id) return false;
      return (batch.at_mill_count ?? 0) > 0;
    });
  }, [data?.fabric_type_id, stockQuery.data?.batches]);
  const visibleStockBatches = useMemo(() => {
    const needle = stockSearch.trim().toLowerCase();
    if (!needle) return unallocatedBatches;
    return unallocatedBatches.filter((batch) =>
      [batch.batch_no, batch.mill_ref]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [stockSearch, unallocatedBatches]);
  const batchQty = draftQtySum(rows);
  const otherRolls = useMemo(
    () => (data?.rolls ?? []).filter((row) => !editing || row.mill_batch_id !== batchId),
    [data?.rolls, editing, batchId],
  );
  const otherProducedM = useMemo(
    () => otherRolls.reduce((sum, row) => sum + millDeclaredQty(row), 0),
    [otherRolls],
  );
  const producedCardM = editing ? otherProducedM + batchQty : otherProducedM;
  const producedCardRolls = editing ? otherRolls.length + rows.length : otherRolls.length;
  const producedM = producedCardM;
  const producedRolls = producedCardRolls;

  const snapshot = useMemo(
    () => assignFormSnapshot({ batchNo, millRef, productionDate, remarks, rows }),
    [batchNo, millRef, productionDate, remarks, rows],
  );
  const dirty = baseline !== null && snapshot !== baseline;
  useEffect(() => {
    setUnsaved(inspectOnly || creating ? false : dirty);
    return () => setUnsaved(false);
  }, [creating, dirty, inspectOnly, setUnsaved]);
  const canSave = useMemo(
    () => Boolean(
      dirty
      && batchNo.trim()
      && orderId
      && colorwayId
      && fabricLineId
      && (testOnly || data?.fabric_type_id)
      && rows.length > 0,
    ),
    [dirty, batchNo, orderId, colorwayId, fabricLineId, data?.fabric_type_id, rows.length, testOnly],
  );

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
    setRows(growMillBatchRolls(rows, n, displayFields));
  };

  const save = async () => {
    if (!dirty) return;
    const parsed = draftsToRollWrites(rows, displayFields);
    if (parsed.error) {
      showNotification(parsed.error, 'error');
      return;
    }
    if (!batchNo.trim()) {
      showNotification('Mill batch number is required', 'error');
      return;
    }
    if (!data?.fabric_type_id) {
      showNotification('This fabric line has no fabric type. Set it on the order first', 'error');
      return;
    }
    const header = {
      batch_no: batchNo.trim(),
      mill_ref: millRef.trim(),
      production_date: productionDate,
      remarks: remarks.trim(),
    };
    setBusy(true);
    try {
      const batchVersion = (data?.batches ?? []).find((row) => row.id === batchId)?.row_version;
      const res = editing
        ? await mmUpdateMillBatch(batchId, header, parsed.rolls, batchVersion, testOnly)
        : await mmSaveMillBatch(orderId, colorwayId, fabricLineId, header, parsed.rolls);
      if (res.ok === false) {
        const text = fabricMismatchMessage(res);
        if (text) setMismatch(text);
        else showNotification(res.message, 'error');
        return;
      }
      setMismatch(null);
      showNotification(
        testOnly ? `Saved mill tests on ${res.data.batch_no}` : editing ? `Updated mill batch ${res.data.batch_no}` : `Saved mill batch ${res.data.batch_no}`,
        'success',
      );
      setUnsaved(false);
      await invalidate();
      requestNavigate(
        qualityMode ? RoutePath.MATERIAL_MILL_STOCK : RoutePath.MATERIAL_MILL_LINE,
        qualityMode ? { mode: qualityMode } : lineParams,
      );
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const assignFromStock = async (unitIds: string[]) => {
    if (unitIds.length === 0) {
      showNotification('Select at least one roll', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmAllocateMillRollsToStyle(unitIds, orderId, colorwayId, fabricLineId);
      if (res.ok === false) {
        const text = fabricMismatchMessage(res);
        if (text) setMismatch(text);
        else showNotification(res.message, 'error');
        return;
      }
      setMismatch(null);
      showNotification(
        res.data.over_allocated
          ? `Assigned ${res.data.count} rolls. This fabric is now over required qty.`
          : `Assigned ${res.data.count} rolls`,
        'success',
      );
      await invalidate();
      requestNavigate(RoutePath.MATERIAL_MILL_LINE, lineParams);
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Assign failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const pageTitle = inspectOnly
    ? '4-point inspection'
    : testOnly
      ? 'Test mill rolls'
      : editing
        ? 'Edit mill batch'
        : 'Allocate rolls';
  const pageSubtitle = inspectOnly
    ? 'Actual length, actual width, cuttable width, and 4-point on this mill batch.'
    : testOnly
      ? 'Test parameters and shade sorting on this mill batch. Batch details stay as they are.'
      : creating
        ? 'Pick unallocated mill batches still at the mill and assign those rolls to this fabric.'
        : 'Generate mill rolls for this allocated fabric. They stay at the mill until dispatch.';

  usePageHeader({ title: pageTitle, subtitle: pageSubtitle }, pageTitle);

  const fabricSummary = (
    <MmFabricSummaryCard
      data={data}
      extraMetrics={(
        <MmSummaryMetric
          icon={Package}
          tone="blue"
          label="Quantity required"
          primary={data?.required_m ? formatQtyM(data.required_m, uom) : '—'}
          secondary={
            producedRolls > 0
              ? `Produced ${formatQtyM(producedM, uom)} · ${producedRolls} ${producedRolls === 1 ? 'roll' : 'rolls'}`
              : 'None yet'
          }
        />
      )}
    />
  );

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card">
      {mismatch ? (
        <p className="mb-3 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          Fabric mismatch — {mismatch}
        </p>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
        {fabricSummary}

        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <ClipboardList size={16} className="text-primary-600" />
              {inspectOnly ? '4-point inspection' : testOnly ? 'Test mill rolls' : editing ? 'Edit mill batch' : 'Mill batch details'}
            </h4>
            {fromStock ? null : (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">Produced</p>
                <p className="text-[13px] font-bold text-slate-900 mt-0.5 tabular-nums">
                  {formatQtyM(producedCardM, uom)}
                  <span className="mx-1.5 font-normal text-slate-400">|</span>
                  <span className="font-semibold">
                    {producedCardRolls} {producedCardRolls === 1 ? 'roll' : 'rolls'}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">This batch</p>
                <p className="text-[13px] font-bold text-slate-900 mt-0.5 tabular-nums">
                  {formatQtyM(batchQty, uom)}
                  <span className="mx-1.5 font-normal text-slate-400">|</span>
                  <span className="font-semibold">
                    {rows.length} {rows.length === 1 ? 'roll' : 'rolls'}
                  </span>
                </p>
              </div>
            </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {fromStock ? (
                <div className="md:col-span-3">
                  <p className="text-[11px] font-medium text-slate-600 mb-1.5">Unallocated mill batches</p>
                  {!data?.fabric_type_id ? (
                    <p className="text-[11px] text-amber-700">
                      This fabric line has no fabric type on the order. Set it before assigning rolls.
                    </p>
                  ) : stockQuery.isLoading ? (
                    <p className="text-[11px] text-slate-400">Loading mill stock…</p>
                  ) : unallocatedBatches.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      No unallocated rolls of this fabric at the mill.{' '}
                      <button
                        type="button"
                        className="font-semibold text-blue-700 hover:text-blue-800"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_NEW)}
                      >
                        New mill batch
                      </button>
                    </p>
                  ) : (
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-slate-100">
                        <Search size={12} className="text-slate-400 shrink-0" />
                        <input
                          className="text-[11px] bg-transparent focus:outline-none py-0.5 flex-1 min-w-0"
                          placeholder="Batch no or ref"
                          value={stockSearch}
                          disabled={busy}
                          onChange={(e) => setStockSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-[7.5rem] overflow-y-auto">
                        {visibleStockBatches.length === 0 ? (
                          <p className="px-2 py-2 text-[11px] text-slate-400">No batches match this search.</p>
                        ) : visibleStockBatches.map((batch) => {
                          const checked = stockBatchIds.includes(batch.id);
                          const rolls = batch.at_mill_count;
                          return (
                            <label
                              key={batch.id}
                              className="flex items-center gap-2 px-2 py-1 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                className="shrink-0"
                                checked={checked}
                                disabled={busy}
                                onChange={() => {
                                  setStockBatchIds((current) => (
                                    current.includes(batch.id)
                                      ? current.filter((id) => id !== batch.id)
                                      : [...current, batch.id]
                                  ));
                                }}
                              />
                              <span className="text-[11px] font-semibold text-slate-800 shrink-0">{batch.batch_no}</span>
                              <span className="text-[10px] text-slate-500 truncate">
                                {[
                                  batch.mill_ref ? `Ref ${batch.mill_ref}` : null,
                                  `${rolls} ${rolls === 1 ? 'roll' : 'rolls'}`,
                                  formatQtyM(batch.qty_m, uom),
                                ].filter(Boolean).join(' · ')}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
              <Input
                id="mm-batch-no"
                label="Mill batch number *"
                value={batchNo}
                disabled={busy || qualityLocked}
                onChange={(e) => setBatchNo(e.target.value)}
                className="bg-white"
              />
              <Input
                id="mm-batch-ref"
                label="Reference"
                value={millRef}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setMillRef(e.target.value)}
                className="bg-white"
              />
              {qualityLocked ? (
                <Input
                  id="mm-batch-date"
                  label="Date *"
                  value={productionDate}
                  disabled
                  className="bg-white"
                />
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
                id="mm-batch-remarks"
                label="Remarks"
                value={remarks}
                disabled={busy || qualityLocked}
                placeholder="Optional"
                onChange={(e) => setRemarks(e.target.value)}
                className="bg-white"
              />
              {qualityLocked ? null : (
                <Input
                  id="mm-batch-roll-count"
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
              )}
                </>
              )}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex items-center gap-2 min-w-0 max-w-xl flex-1 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                <Info size={14} className="text-blue-600 shrink-0" />
                <p className="text-[11px] text-blue-800 leading-snug">
                  {inspectOnly
                    ? '4-point on this batch: actual length, width, and points.'
                    : testOnly
                      ? 'Enter test values and shade. Roll numbers and qty stay as saved.'
                      : fromStock
                        ? 'These batches already exist. Select one or more, then assign their rolls below.'
                        : 'Qty uses this fabric UOM. Sent rolls stay locked. Extra rolls stay New until dispatch.'}
                </p>
              </div>
              {!qualityLocked && !fromStock ? (
                <DesktopWriteGate>
                  <Button type="button" size="sm" disabled={busy} onClick={generate} className="shrink-0">
                    Generate
                  </Button>
                </DesktopWriteGate>
              ) : null}
            </div>
            {!fromStock && !data?.fabric_type_id && (
              <p className="text-[11px] text-amber-700 mt-3">
                This fabric line has no fabric type on the order. Set it before assigning rolls.
              </p>
            )}
          </div>
        </Card>
      </div>

      {fromStock ? (
        <div className="mt-4">
          <MmMillAssignFromStock
            pickerOnly
            hideFinder
            selectedBatchIds={stockBatchIds}
            fields={displayFields}
            fabricTypeId={data?.fabric_type_id}
            fabricTypeName={data?.fabric_type ?? data?.fabric_name}
            lineFabricId={data?.fabric_id}
            colorName={data?.color_name}
            uom={uom}
            busy={busy}
            mismatch={mismatch}
            onAssign={assignFromStock}
          />
        </div>
      ) : inspectOnly ? (
        <MmFourPointInspectPanel
          scopeKind="mill_batch"
          scopeId={batchId}
          uom={uom}
          rolls={(data?.rolls ?? [])
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
            await refetch();
          }}
        />
      ) : (
      <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
        <MmRollEntryGrid
          title={testOnly ? 'Tests and shade' : 'Rolls'}
          subtitle={`${formatQtyM(batchQty, uom)} · ${rows.length} ${rows.length === 1 ? 'roll' : 'rolls'}`}
          emptyMessage={testOnly ? 'No rolls at the mill on this batch.' : 'Generate rolls on the mill batch to enter values.'}
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
          showStatus
          lockIdentity={testOnly}
          showShade={testOnly}
          allowShadeEdit={testOnly}
          showRemove={!testOnly}
          excel
          uom={uom}
          footerActions={dirty ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  requestNavigate(
                    qualityMode ? RoutePath.MATERIAL_MILL_STOCK : RoutePath.MATERIAL_MILL_LINE,
                    qualityMode ? { mode: qualityMode } : lineParams,
                  )
                }
              >
                Cancel
              </Button>
              <DesktopWriteGate>
                <Button type="button" size="sm" disabled={busy || !canSave} onClick={() => void save()}>
                  {busy ? 'Saving…' : testOnly ? 'Save tests' : editing ? 'Save changes' : 'Save mill batch'}
                </Button>
              </DesktopWriteGate>
            </>
          ) : null}
        />
      </Card>
      )}
    </PageShell>
  );
}
