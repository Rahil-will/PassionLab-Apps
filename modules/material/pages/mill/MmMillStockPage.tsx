import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { FabricStockPanel } from '../../components/FabricStockPanel';
import { MmAllocateV4Modal } from '../../components/MmAllocateV4Modal';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { MmQcInspectModalV4 } from '../../components/MmQcInspectModalV4';
import { MmQcTestModalV4 } from '../../components/MmQcTestModalV4';
import type { MmFabricStockRoll } from '../../lib/mmFabricRpc';
import { mmMillDispatchV2 } from '../../lib/mmV4Rpc';
import { useMmDefaultWarehouse, useMmV4Config } from '../../lib/useMmV4Config';

type Action = 'send' | 'test' | 'inspect' | 'allocate' | 'dispatch' | null;

export default function MmMillStockPage() {
  usePageHeader({ subtitle: 'Fabric still at the mill, out for processing, or waiting on QC.' });
  const { showNotification } = useNotificationStore();
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { data: config } = useMmV4Config(true);
  const { data: defaultWarehouse } = useMmDefaultWarehouse();
  const warehouses = useMemo(
    () => (config?.facilities ?? []).filter((row) => row.kind === 'warehouse' && row.is_active !== false),
    [config?.facilities],
  );
  const showWarehousePicker = warehouses.length > 1;
  const [picked, setPicked] = useState<MmFabricStockRoll[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [facilityId, setFacilityId] = useState('');
  const [challanNo, setChallanNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const millRows = picked.filter((row) => row.stock.side === 'mill');
  const sendSide = picked.every((row) => row.stock.side === 'warehouse') ? 'warehouse' : 'mill';

  const open = (next: Action, rows: MmFabricStockRoll[]) => {
    setPicked(rows);
    setAction(next);
    setFacilityId(defaultWarehouse?.id ?? warehouses[0]?.id ?? '');
    setChallanNo('');
  };

  useEffect(() => {
    if (action !== 'dispatch' || facilityId) return;
    const nextId = defaultWarehouse?.id ?? warehouses[0]?.id ?? '';
    if (nextId) setFacilityId(nextId);
  }, [action, facilityId, defaultWarehouse?.id, warehouses]);

  const refresh = () => setReloadKey((n) => n + 1);

  const dispatch = async () => {
    if (!facilityId || millRows.length === 0) return;
    setBusy(true);
    const res = await mmMillDispatchV2({
      roll_ids: millRows.map((row) => row.roll_id),
      to_facility_id: facilityId,
      challan_no: challanNo.trim() || null,
    });
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    const name = defaultWarehouse?.id === facilityId
      ? defaultWarehouse.name
      : warehouses.find((row) => row.id === facilityId)?.name ?? res.data.to_facility?.name ?? '';
    showNotification(`${res.data.challan_no} · ${name}`, 'success');
    setAction(null);
    refresh();
  };

  return (
    <PageShell>
      <FabricStockPanel
        side="mill"
        reloadKey={reloadKey}
        selectionBar={(rows) => (
          <DesktopWriteGate>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => open('send', rows)}>
                Send
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => open('test', rows)}>
                Test
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => open('inspect', rows)}>
                Inspect
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => open('allocate', rows)}>
                Allocate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={rows.length === 0 || rows.some((row) => row.stock.side !== 'mill')}
                title={rows.some((row) => row.stock.side !== 'mill') ? 'Dispatch is for rolls at the mill' : undefined}
                onClick={() => open('dispatch', rows)}
              >
                Dispatch
              </Button>
            </div>
          </DesktopWriteGate>
        )}
      />

      <MmProcSendModalV4
        open={action === 'send'}
        side={sendSide}
        preselectedRollIds={picked.map((row) => row.roll_id)}
        onClose={() => setAction(null)}
        onSent={(_id, challanNoSent) => {
          showNotification(`Sent · ${challanNoSent}`, 'success');
          setAction(null);
          refresh();
        }}
      />
      <MmQcTestModalV4
        open={action === 'test'}
        scopeKind="rolls"
        rollIds={picked.map((row) => row.roll_id)}
        defaultSiteSide={sendSide === 'warehouse' ? 'warehouse' : 'mill'}
        onClose={() => setAction(null)}
        onSaved={() => {
          setAction(null);
          refresh();
        }}
      />
      <MmQcInspectModalV4
        open={action === 'inspect'}
        scopeKind="rolls"
        rollIds={picked.map((row) => row.roll_id)}
        defaultSiteSide={sendSide === 'warehouse' ? 'warehouse' : 'mill'}
        onClose={() => setAction(null)}
        onSaved={() => {
          setAction(null);
          refresh();
        }}
      />
      <MmAllocateV4Modal
        open={action === 'allocate'}
        rollIds={picked.map((row) => row.roll_id)}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          refresh();
        }}
      />
      <Modal isOpen={action === 'dispatch'} onClose={() => setAction(null)} className="max-w-lg">
        <div className="space-y-3 p-4">
          <h3 className="text-[13px] font-semibold text-slate-800">Dispatch to warehouse</h3>
          {showWarehousePicker ? (
            <SelectDropdown
              value={facilityId}
              onChange={setFacilityId}
              options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
            />
          ) : (
            <p className="text-[11px] text-slate-500">{defaultWarehouse?.name || warehouses[0]?.name || 'Warehouse'}</p>
          )}
          <Input label="Challan no" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} placeholder="Auto" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !facilityId || !factoryId} onClick={() => void dispatch()}>
              Dispatch
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
