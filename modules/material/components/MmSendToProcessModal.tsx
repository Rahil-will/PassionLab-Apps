import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, SelectDropdown } from '../../../components/ui';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { mmListProcessTypes, mmListProcessVendors, mmSendToProcess } from '../lib/mmRpc';

export function MmSendToProcessModal({
  open,
  origin,
  unitIds,
  onClose,
  onSent,
}: {
  open: boolean;
  origin: 'mill' | 'warehouse';
  unitIds: string[];
  onClose: () => void;
  onSent: (id: string) => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const [vendorId, setVendorId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [challanNo, setChallanNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const vendors = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'processVendors'],
    queryFn: async () => {
      const res = await mmListProcessVendors();
      if (res.ok === false) throw new Error(res.message);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: open && Boolean(factoryId),
  });
  const types = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'processTypes'],
    queryFn: async () => {
      const res = await mmListProcessTypes();
      if (res.ok === false) throw new Error(res.message);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: open && Boolean(factoryId),
  });

  const vendorOptions = (vendors.data ?? []).filter((vendor) => vendor.active);
  const selected = vendorOptions.find((vendor) => vendor.id === vendorId);
  const typeOptions = useMemo(() => {
    const allowed = new Set(selected?.type_ids ?? []);
    return (types.data ?? []).filter((type) => type.active && allowed.has(type.id));
  }, [selected, types.data]);

  const submit = async () => {
    if (!vendorId || !typeId) {
      showNotification('Choose a vendor and a process', 'error');
      return;
    }
    if (!challanNo.trim()) {
      showNotification('Enter a challan number', 'error');
      return;
    }
    setBusy(true);
    const res = await mmSendToProcess(origin, vendorId, typeId, unitIds, challanNo.trim(), remarks.trim());
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification(`Challan ${res.data.challan_no} sent`, 'success');
    setChallanNo('');
    setRemarks('');
    onSent(res.data.id);
  };

  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-md">
      <div className="p-5 flex flex-col gap-3">
        <h4 className="text-[14px] font-semibold text-slate-900">Send to process</h4>
        <p className="text-[11px] text-slate-500">
          {unitIds.length} {unitIds.length === 1 ? 'roll leaves' : 'rolls leave'} for processing. They stay off the floor until they come back.
        </p>
        {vendorOptions.length === 0 ? (
          <p className="text-[11px] text-slate-500">Add a process vendor in Material settings first.</p>
        ) : (
          <>
            <SelectDropdown
              value={vendorId}
              onChange={(value) => {
                setVendorId(value);
                setTypeId('');
              }}
              options={[
                { value: '', label: 'Vendor' },
                ...vendorOptions.map((vendor) => ({ value: vendor.id, label: vendor.name })),
              ]}
            />
            <SelectDropdown
              value={typeId}
              onChange={setTypeId}
              options={[
                { value: '', label: 'Process' },
                ...typeOptions.map((type) => ({ value: type.id, label: type.name })),
              ]}
            />
            <input
              className="text-xs border border-slate-200 rounded-lg px-2 py-2"
              placeholder="Challan number"
              value={challanNo}
              onChange={(event) => setChallanNo(event.target.value)}
            />
            <input
              className="text-xs border border-slate-200 rounded-lg px-2 py-2"
              placeholder="Remarks, optional"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy || vendorOptions.length === 0} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
