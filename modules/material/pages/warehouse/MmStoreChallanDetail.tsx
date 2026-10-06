import React, { useMemo, useState } from 'react';
import { ClipboardList, Printer } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { MmLockedRollsTable } from '../../components/MmLockedRollsTable';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { storeChallanPrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import { storeDispatchStatusClass, storeDispatchStatusLabel } from '../../lib/inboundDisplay';
import { mmReceiveStoreChallan } from '../../lib/mmRpc';
import { useInvalidateMmOps, useMmStoreChallanDetail } from '../../lib/useMmOps';
import { formatQtyM, millDateTimeParts } from '../../lib/mmRollDraft';

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
  tone: 'blue' | 'green' | 'yellow';
}) {
  const shell =
    tone === 'blue'
      ? 'border-blue-100 bg-blue-50/70'
      : tone === 'green'
        ? 'border-green-200 bg-green-50'
        : 'border-yellow-200 bg-yellow-50';
  const labelCls =
    tone === 'blue' ? 'text-blue-600' : tone === 'green' ? 'text-green-700' : 'text-yellow-700';
  const valueCls =
    tone === 'blue' ? 'text-blue-900' : tone === 'green' ? 'text-green-900' : 'text-yellow-900';
  return (
    <div className={`rounded-xl border ${shell} px-3 py-2.5 min-w-0 h-full`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${labelCls}`}>{label}</p>
      <p className={`text-[13px] font-bold mt-1 tabular-nums ${valueCls}`}>{value}</p>
      {sub ? <p className={`text-[10px] mt-0.5 ${labelCls}`}>{sub}</p> : null}
    </div>
  );
}

type MmStoreChallanDetailProps = {
  /** Where Print auto-nav returns, and default detail route template. */
  detailRoute?: typeof RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL | typeof RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL;
};

export default function MmStoreChallanDetail({
  detailRoute = RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL,
}: MmStoreChallanDetailProps = {}) {
  const id = useNavigationStore((s) => s.routeParams.id);
  const printOnOpen = useNavigationStore((s) => s.routeParams.print === '1');
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const { data, isLoading, error, refetch } = useMmStoreChallanDetail(id ?? null);
  const invalidate = useInvalidateMmOps();
  const { showNotification } = useNotificationStore();
  const [absent, setAbsent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const challan = data?.challan;
  const pending = challan?.status === 'pending';
  const rolls = data?.rolls ?? [];
  const fields = data?.test_fields ?? [];
  const uom = challan?.uom ?? null;
  const qty = Number(challan?.qty ?? 0);
  const arrivedCount = rolls.filter((roll) => roll.line_status !== 'missing' && !absent[roll.id]).length;
  const tableRolls = rolls.map((roll) => ({
    ...roll,
    selectable: pending && roll.line_status !== 'received' && roll.line_status !== 'missing',
  }));
  const selected = Object.fromEntries(tableRolls.map((roll) => [roll.id, Boolean(roll.selectable) && !absent[roll.id]]));

  const receive = async () => {
    if (!id) return;
    const missing = tableRolls.filter((roll) => roll.selectable && absent[roll.id]).map((roll) => roll.id);
    setBusy(true);
    const res = await mmReceiveStoreChallan(id, missing);
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification(
      res.data.missing_rolls > 0
        ? `${res.data.received_rolls} received, ${res.data.missing_rolls} missing`
        : 'Challan received',
      'success',
    );
    setAbsent({});
    await invalidate();
    await refetch();
  };

  const printDoc = useMemo(() => {
    if (!challan) return null;
    return storeChallanPrintDoc({
      factory,
      challanNo: challan.challan_no,
      referenceNo: challan.reference_no,
      sentAt: challan.sent_at,
      remarks: challan.remarks,
      styleName: challan.style_name,
      styleRef: challan.style_ref,
      buyerName: challan.buyer_name,
      poNumber: challan.po_number,
      colorName: challan.color_name,
      fabricName: challan.fabric_name || challan.fabric_type,
      fabricCategory: challan.fabric_category,
      uom: challan.uom,
      factoryName: challan.factory_name,
      factoryCode: challan.factory_code,
      fields,
      rolls,
    });
  }, [challan, rolls, fields, factory]);
  const { requestPrint } = useMmChallanPrint(printDoc, {
    auto: printOnOpen && Boolean(printDoc),
    onAfterPrint: () => {
      if (printOnOpen && id) requestNavigate(detailRoute, { id });
    },
  });

  usePageHeader({
    subtitle: pending
      ? 'Tick the rolls that arrived. Unticked rolls are written off as missing.'
      : 'Rolls sent from the warehouse to cutting.',
  });

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card">
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-3">
                    <ClipboardList size={16} className="text-primary-600 shrink-0" />
                    Challan details
                  </h4>
                  <p className="text-[15px] font-bold text-slate-900 leading-tight truncate">
                    Challan No {challan.challan_no}
                    <span className="text-slate-300 font-semibold"> | </span>
                    Ref No {challan.reference_no || '—'}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1.5 truncate">Warehouse to cutting store</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>
                    Print
                  </Button>
                  {pending ? (
                    <DesktopWriteGate>
                      <Button type="button" size="sm" disabled={busy || rolls.length === 0} onClick={() => void receive()}>
                        {busy ? 'Saving…' : 'Receive arrived rolls'}
                      </Button>
                    </DesktopWriteGate>
                  ) : null}
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${storeDispatchStatusClass(challan.status)}`}
                  >
                    {storeDispatchStatusLabel(challan.status)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <WhenPill label="Sent" iso={challan.sent_at} />
                <WhenPill label="Received" iso={challan.received_at} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-auto pt-3">
                <MetricTile
                  label="Dispatched"
                  value={formatQtyM(qty, uom)}
                  sub={`${challan.roll_count} ${challan.roll_count === 1 ? 'roll' : 'rolls'}`}
                  tone="green"
                />
                <MetricTile
                  label="Status"
                  value={storeDispatchStatusLabel(challan.status)}
                  sub={
                    challan.status === 'partial' && challan.received_roll_count != null
                      ? `${challan.received_roll_count}/${challan.roll_count} arrived`
                      : pending
                        ? `${arrivedCount}/${rolls.length || challan.roll_count} ticked`
                        : 'Cutting receive recorded'
                  }
                  tone="yellow"
                />
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[11px] font-semibold text-slate-800">Rolls sent</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {pending
              ? 'Untick a roll that did not reach cutting. It is written off and cannot be laid.'
              : 'Moved to the cutting store when this challan was created.'}
          </p>
        </div>
        <MmLockedRollsTable
          rolls={tableRolls}
          fields={fields}
          uom={uom}
          showStatus
          selectable={pending}
          selected={selected}
          onToggle={(rollId, on) => setAbsent((current) => ({ ...current, [rollId]: !on }))}
          onToggleAll={(on) => {
            if (on) {
              setAbsent({});
              return;
            }
            setAbsent(Object.fromEntries(tableRolls.filter((roll) => roll.selectable).map((roll) => [roll.id, true])));
          }}
          emptyText="No rolls on this challan."
        />
      </div>
      <MmChallanPrintDocument doc={printDoc} />
    </PageShell>
  );
}
