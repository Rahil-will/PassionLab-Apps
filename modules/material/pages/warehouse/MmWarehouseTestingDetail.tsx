import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { MmSheetGrid, type SheetColumn } from '../../components/MmSheetGrid';
import { useNotificationStore } from '../../../../stores';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useInvalidateMmOps, useMmInChallanDetail } from '../../lib/useMmOps';
import {
  mmSaveWarehouseInspections,
  type MmStockRoll,
  type MmTestField,
  type MmWarehouseInspectionWrite,
} from '../../lib/mmRpc';
import {
  inboundDocKind,
  inboundOpsStatus,
  inboundOpsStatusClass,
  inboundOpsStatusLabel,
} from '../../lib/inboundDisplay';
import {
  attrRecord,
  formatQtyM,
  millDateTimeParts,
  millFieldSeedText,
  parseTestOptions,
  seedWarehouseFieldValues,
  warehouseMeasuredFieldValues,
  warehouseTestFields,
} from '../../lib/mmRollDraft';
import { normalizePassFail } from '../../lib/mmSheetGrid';

type ResultValue = '' | 'pass' | 'fail';

interface TestingDraft {
  id: string;
  unit_code: string;
  length_m: number | null;
  status: string;
  qc_result: string | null;
  inspected: boolean;
  result: ResultValue;
  millSeeds: Record<string, string>;
  values: Record<string, string>;
  remarks: string;
  millShade: string;
  testedShade: string;
  inspectedLength: string;
  inspectedWidth: string;
  pts1: string;
  pts2: string;
  pts3: string;
  pts4: string;
  widthUom: 'in' | 'cm';
  overrideReason: string;
}

function fptPoints(row: Pick<TestingDraft, 'pts1' | 'pts2' | 'pts3' | 'pts4'>): number {
  const n = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return n(row.pts1) + 2 * n(row.pts2) + 3 * n(row.pts3) + 4 * n(row.pts4);
}

function fptScore(row: TestingDraft, lengthUom: string | null): number | null {
  const length = Number(row.inspectedLength);
  const width = Number(row.inspectedWidth);
  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null;
  const yards = lengthUom === 'yd' ? length : length / 0.9144;
  const inches = row.widthUom === 'cm' ? width / 2.54 : width;
  if (!(yards > 0) || !(inches > 0)) return null;
  return Math.round(((fptPoints(row) * 3600) / (yards * inches)) * 100) / 100;
}

function fptVerdict(score: number): 'pass' | 'fail' {
  return score <= 40 ? 'pass' : 'fail';
}

function savedInspectionResult(roll: MmStockRoll): ResultValue {
  if (roll.wh_result === 'pass' || roll.wh_result === 'fail') return roll.wh_result;
  if (roll.qc_result === 'pass' || roll.qc_result === 'fail') return roll.qc_result;
  return '';
}

function millSeedsFor(roll: MmStockRoll, fields: MmTestField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of warehouseTestFields(fields)) {
    out[field.key] = millFieldSeedText(roll, field);
  }
  return out;
}

function toDraft(roll: MmStockRoll, fields: MmTestField[]): TestingDraft {
  const millSeeds = millSeedsFor(roll, fields);
  const result = savedInspectionResult(roll);
  return {
    id: roll.id,
    unit_code: roll.unit_code,
    length_m: roll.length_m,
    status: roll.status,
    qc_result: roll.qc_result,
    inspected: Boolean(result),
    result,
    millSeeds,
    values: seedWarehouseFieldValues(roll, attrRecord(roll.wh_values), fields),
    remarks: roll.wh_remarks ?? '',
    millShade: (roll.shade ?? '').trim(),
    testedShade: (roll.tested_shade ?? '').trim(),
    inspectedLength: '',
    inspectedWidth: '',
    pts1: '',
    pts2: '',
    pts3: '',
    pts4: '',
    widthUom: 'in',
    overrideReason: '',
  };
}

function fieldSelectOptions(field: MmTestField): { value: string; label: string }[] {
  return [
    { value: '', label: '—' },
    ...parseTestOptions(field.options).map((opt) => ({ value: opt, label: opt })),
  ];
}

function WhenPill({ label, iso }: { label: string; iso: string | null | undefined }) {
  const parts = millDateTimeParts(iso);
  return (
    <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-[10px] font-medium text-slate-600">
      <span className="text-slate-400">{label}</span>
      {' '}
      <span className="tabular-nums">
        {parts.date}
        {parts.time ? `, ${parts.time}` : ''}
      </span>
    </span>
  );
}

function MetricTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'blue' | 'green' | 'yellow' | 'red';
}) {
  const shell =
    tone === 'blue'
      ? 'border-blue-100 bg-blue-50/70'
      : tone === 'green'
        ? 'border-green-200 bg-green-50'
        : tone === 'red'
          ? 'border-red-200 bg-red-50'
          : 'border-yellow-200 bg-yellow-50';
  const labelCls =
    tone === 'blue' ? 'text-blue-600' : tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-yellow-700';
  const valueCls =
    tone === 'blue' ? 'text-blue-900' : tone === 'green' ? 'text-green-900' : tone === 'red' ? 'text-red-900' : 'text-yellow-900';
  return (
    <div className={`rounded-xl border ${shell} px-3 py-2.5 min-w-0`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${labelCls}`}>{label}</p>
      <p className={`text-[13px] font-bold mt-1 tabular-nums ${valueCls}`}>{value}</p>
      {sub ? <p className={`text-[10px] mt-0.5 ${labelCls}`}>{sub}</p> : null}
    </div>
  );
}

function canInspect(row: TestingDraft): boolean {
  return (row.status === 'pending_qc' || row.status === 'in_stock') && !row.inspected;
}

function inspectionValues(row: TestingDraft, fields: MmTestField[]): Record<string, string> {
  const values = warehouseMeasuredFieldValues(row.millSeeds, row.values, fields);
  const put = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) values[key] = trimmed;
  };
  put('inspected_length', row.inspectedLength);
  put('cuttable_width', row.inspectedWidth);
  if (row.inspectedWidth.trim()) {
    values.width_uom = row.widthUom;
    if (row.widthUom === 'in') put('inspected_width_in', row.inspectedWidth);
  }
  put('pts_1', row.pts1);
  put('pts_2', row.pts2);
  put('pts_3', row.pts3);
  put('pts_4', row.pts4);
  put('override_reason', row.overrideReason);
  return values;
}

function payloadFor(rows: TestingDraft[], fields: MmTestField[]): MmWarehouseInspectionWrite[] {
  return rows
    .filter((row) => canInspect(row) && (row.result === 'pass' || row.result === 'fail'))
    .map((row) => ({
      id: row.id,
      result: row.result === 'pass' || row.result === 'fail' ? row.result : null,
      remarks: row.remarks.trim() || null,
      values: inspectionValues(row, fields),
      shade: row.testedShade.trim() || null,
    }));
}

export default function MmWarehouseTestingDetail() {
  const id = useNavigationStore((s) => s.routeParams.id);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const { data, isLoading, error, refetch } = useMmInChallanDetail(id ?? null);
  const invalidate = useInvalidateMmOps();
  const [rows, setRows] = useState<TestingDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [rollQuery, setRollQuery] = useState('');

  const challan = data?.challan;
  const fields = data?.test_fields ?? [];
  const warehouseCols = useMemo(() => warehouseTestFields(fields), [fields]);
  const uom = challan?.uom ?? null;
  const millPending = challan?.source === 'mill' && challan.status === 'pending';
  const canWrite = Boolean(challan && !millPending);

  useEffect(() => {
    if (!data) return;
    setRows((data.rolls ?? []).map((roll) => toDraft(roll, data.test_fields ?? [])));
    setRollQuery('');
  }, [data]);

  const q = rollQuery.trim().toLowerCase();
  const visible = rows.filter((row) => !q || row.unit_code.toLowerCase().includes(q));
  const remaining = rows.filter((row) => !row.result && canInspect(row));
  const passedQty = rows.reduce((sum, row) => sum + (row.result === 'pass' ? Number(row.length_m || 0) : 0), 0);
  const failedQty = rows.reduce((sum, row) => sum + (row.result === 'fail' ? Number(row.length_m || 0) : 0), 0);
  const pendingQty = rows.reduce((sum, row) => sum + (!row.result ? Number(row.length_m || 0) : 0), 0);
  const onChallanQty = Number(challan?.qty || 0) || rows.reduce((sum, row) => sum + Number(row.length_m || 0), 0);

  const sheetColumns = useMemo<SheetColumn[]>(() => [
    { key: 'sno', label: 'S.No', width: '3.25rem' },
    { key: 'roll', label: 'Roll no.', width: '8rem' },
    {
      key: 'qty',
      label: 'Qty',
      width: '6rem',
      headerClassName: 'text-blue-700 bg-blue-50',
      cellClassName: 'bg-blue-50/40',
    },
    {
      key: 'mill_shade',
      label: 'Mill shade',
      width: '6.5rem',
    },
    ...warehouseCols.map((field) => ({
      key: `wh:${field.key}`,
      label: field.label,
      editable: true,
      kind: (field.data_type === 'select' ? 'select' : 'text') as SheetColumn['kind'],
      options: field.data_type === 'select' ? fieldSelectOptions(field) : undefined,
      headerClassName: 'text-violet-800 bg-violet-50',
      cellClassName: 'bg-violet-50/40',
    })),
    {
      key: 'tested_shade',
      label: 'Tested shade',
      editable: true,
      width: '7rem',
      headerClassName: 'text-violet-800 bg-violet-50',
      cellClassName: 'bg-violet-50/40',
    },
    { key: 'insp_len', label: 'Length', editable: true, width: '5.5rem' },
    { key: 'insp_width', label: 'Width', editable: true, width: '5.5rem' },
    {
      key: 'width_uom',
      label: 'Width unit',
      editable: true,
      kind: 'select' as const,
      options: [
        { value: 'in', label: 'in' },
        { value: 'cm', label: 'cm' },
      ],
      width: '5.5rem',
    },
    { key: 'pts1', label: '1 pt', editable: true, width: '4rem' },
    { key: 'pts2', label: '2 pt', editable: true, width: '4rem' },
    { key: 'pts3', label: '3 pt', editable: true, width: '4rem' },
    { key: 'pts4', label: '4 pt', editable: true, width: '4rem' },
    { key: 'score', label: 'Per 100', width: '7rem' },
    { key: 'override', label: 'Override reason', editable: true, width: '9rem' },
    {
      key: 'result',
      label: 'Pass / fail',
      editable: true,
      kind: 'select' as const,
      options: [
        { value: '', label: '—' },
        { value: 'pass', label: 'Pass' },
        { value: 'fail', label: 'Fail' },
      ],
      headerClassName: 'text-emerald-800 bg-emerald-50',
      cellClassName: 'bg-emerald-50/40',
      width: '7.5rem',
    },
  ], [warehouseCols]);

  const sheetValue = (rowIndex: number, key: string): string => {
    const row = visible[rowIndex];
    if (!row) return '';
    if (key === 'sno') return String(rows.findIndex((item) => item.id === row.id) + 1);
    if (key === 'roll') return row.unit_code;
    if (key === 'qty') return formatQtyM(row.length_m, uom);
    if (key === 'mill_shade') return row.millShade;
    if (key === 'tested_shade') return row.testedShade;
    if (key === 'insp_len') return row.inspectedLength;
    if (key === 'insp_width') return row.inspectedWidth;
    if (key === 'width_uom') return row.widthUom;
    if (key === 'pts1') return row.pts1;
    if (key === 'pts2') return row.pts2;
    if (key === 'pts3') return row.pts3;
    if (key === 'pts4') return row.pts4;
    if (key === 'score') {
      const score = fptScore(row, uom);
      return score == null ? '' : `${score.toFixed(2)} ${fptVerdict(score)}`;
    }
    if (key === 'override') return row.overrideReason;
    if (key === 'result') return row.result;
    if (key === 'remarks') return row.remarks;
    if (key.startsWith('wh:')) return row.values[key.slice(3)] ?? '';
    return '';
  };

  const sheetChange = (rowIndex: number, key: string, value: string) => {
    const row = visible[rowIndex];
    if (!row) return;
    setRows((list) =>
      list.map((item) => {
        if (item.id !== row.id) return item;
        if (key === 'tested_shade') return { ...item, testedShade: value };
        if (key === 'insp_len') return { ...item, inspectedLength: value };
        if (key === 'insp_width') return { ...item, inspectedWidth: value };
        if (key === 'width_uom') return { ...item, widthUom: value === 'cm' ? 'cm' : 'in' };
        if (key === 'pts1') return { ...item, pts1: value };
        if (key === 'pts2') return { ...item, pts2: value };
        if (key === 'pts3') return { ...item, pts3: value };
        if (key === 'pts4') return { ...item, pts4: value };
        if (key === 'override') return { ...item, overrideReason: value };
        if (key === 'result') {
          const next = normalizePassFail(value);
          const result: ResultValue = next || (value === 'pass' || value === 'fail' ? value : '');
          return { ...item, result };
        }
        if (key === 'remarks') return { ...item, remarks: value };
        if (key.startsWith('wh:')) return { ...item, values: { ...item.values, [key.slice(3)]: value } };
        return item;
      }),
    );
  };

  const write = async (payload: MmWarehouseInspectionWrite[], okMessage: string) => {
    if (!id) return;
    if (payload.length === 0) {
      showNotification('Set pass or fail on at least one roll', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmSaveWarehouseInspections(id, payload);
      if (res.ok === false) throw new Error(res.message);
      showNotification(okMessage, 'success');
      await invalidate();
      await refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (millPending) {
      showNotification('Receive this mill challan before testing', 'error');
      return;
    }
    const mismatched = rows.find((row) => {
      if (!canInspect(row) || (row.result !== 'pass' && row.result !== 'fail')) return false;
      const score = fptScore(row, uom);
      if (score == null) return false;
      const computed = fptVerdict(score);
      return row.result !== computed && row.overrideReason.trim().length === 0;
    });
    if (mismatched) {
      showNotification(`${mismatched.unit_code}: an override needs a reason`, 'error');
      return;
    }
    void write(payloadFor(rows, fields), 'Inspection saved');
  };

  const passRemaining = () => {
    if (millPending) {
      showNotification('Receive this mill challan before testing', 'error');
      return;
    }
    if (remaining.length === 0) {
      showNotification('Nothing left to pass', 'error');
      return;
    }
    void write(
      remaining.map((row) => ({
        id: row.id,
        result: 'pass' as const,
        remarks: row.remarks.trim() || null,
        values: warehouseMeasuredFieldValues(row.millSeeds, row.values, fields),
        shade: row.testedShade.trim() || null,
      })),
      `Passed ${remaining.length} ${remaining.length === 1 ? 'roll' : 'rolls'}`,
    );
  };

  usePageHeader({
    subtitle: !challan
      ? 'Open a challan from Testing to pass or fail rolls.'
      : millPending
        ? 'Receive this mill challan first. Testing starts after warehouse receive.'
        : 'Enter measured values, then tested shade, then pass or fail. Mill shade stays as declared.',
  }, [challan, millPending]);

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card" className="pb-20">
      {challan ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-stretch">
          <MmFabricSummaryCard
            data={challan}
            imageSize="large"
            onStyleClick={
              challan.order_id
                ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: challan.order_id as string })
                : undefined
            }
          />
          <Card className="shadow-sm border-slate-200 h-full" noPadding>
            <div className="px-5 py-4 h-full flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-4">
                <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                  <ClipboardList size={16} className="text-primary-600" />
                  Testing Details
                </h4>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${inboundOpsStatusClass(inboundOpsStatus(challan))}`}
                >
                  {inboundOpsStatusLabel(inboundOpsStatus(challan))}
                </span>
              </div>
              <p className="text-[15px] font-bold text-slate-900 leading-tight truncate">{challan.challan_no}</p>
              <p className="text-[12px] text-slate-500 mt-0.5 truncate">
                {challan.source === 'mill'
                  ? `Mill ${inboundDocKind(challan).toLowerCase()}`
                  : challan.supplier_name
                    ? `Vendor GRN · ${challan.supplier_name}`
                    : 'Vendor GRN'}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {challan.reference_no ? (
                  <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-[10px] font-medium text-slate-600">
                    Ref {challan.reference_no}
                  </span>
                ) : null}
                <WhenPill label="Sent" iso={challan.sent_at} />
                <WhenPill label="Received" iso={challan.received_at} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <MetricTile
                  label="On challan"
                  value={formatQtyM(onChallanQty, uom)}
                  sub={`${challan.roll_count} ${challan.roll_count === 1 ? 'roll' : 'rolls'}`}
                  tone="blue"
                />
                <MetricTile label="Passed" value={formatQtyM(passedQty, uom)} tone="green" />
                <MetricTile label="Failed" value={formatQtyM(failedQty, uom)} tone="red" />
                <MetricTile label="Pending" value={formatQtyM(pendingQty, uom)} tone="yellow" />
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {challan ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between bg-slate-50/50 gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                placeholder="Search roll no..."
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
              />
            </div>
          </div>
          {millPending ? (
            <p className="px-4 py-3 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">
              Receive this mill challan on inbound first. Rolls stay in transit until then.
            </p>
          ) : null}
          <MmSheetGrid
            columns={sheetColumns}
            rowCount={visible.length}
            getValue={sheetValue}
            onChange={sheetChange}
            isRowLocked={(rowIndex) => busy || !canWrite || !canInspect(visible[rowIndex])}
            emptyText="No rolls on this challan."
          />
          <div className="px-4 py-3 border-t border-slate-100 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-[10px] text-slate-400">
              Score is points × 3600 / (length in yards × width in inches). Pass is 40 per 100 sq yd or under. A yard should carry at most 4 points; that cap is not checked. A different pass or fail needs a reason. Leave length blank to save pass or fail only.
            </p>
            <DesktopWriteGate>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || !canWrite || remaining.length === 0}
                  onClick={() => void passRemaining()}
                >
                  {busy ? 'Saving…' : `Pass remaining (${remaining.length})`}
                </Button>
                <Button type="button" size="sm" disabled={busy || !canWrite} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </DesktopWriteGate>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
