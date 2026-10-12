import React, { useState, useEffect } from 'react';
import { Input, Button, SelectDropdown as Select } from '../ui';
import { User, Truck, Briefcase, Ruler, Plus, Edit, Trash2 } from 'lucide-react';
import { useNavigationStore } from '../../stores';
import { useSupportDropdownsCatalog, useSizeGroupsCatalog } from '../../lib/queries/settingsSlices';
import { dropdownValuesForCategory } from '../../lib/supportDropdownValues';
import { ShipmentDropdownChips } from './ShipmentDropdownChips';
import { SizeChipsInput } from './SizeChipsInput';
import { DesktopWriteGate } from '../DesktopWriteGate';
import { catalogDef } from '../../lib/supportDropdownCatalog';

interface BuyerEditorProps {
  formData: Record<string, unknown>;
  setFormData: (d: Record<string, unknown>) => void;
}

function dropdownOptions(
  values: string[],
  fallback: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> {
  const list = values.length > 0 ? values : fallback.map((o) => o.value);
  return [
    { value: '', label: 'Select...' },
    ...list.map((v) => {
      const fb = fallback.find((o) => o.value === v);
      return { value: v, label: fb?.label ?? v };
    }),
  ];
}

const SECTION_HEAD = 'text-xs font-bold text-slate-800 mb-3 flex items-center gap-2';
const SIZE_GROUPS_CARD =
  'rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col min-h-[18rem] overflow-hidden';

export const BuyerEditor: React.FC<BuyerEditorProps> = ({ formData, setFormData }) => {
  const { factoryId } = useNavigationStore();
  const { supportDropdowns } = useSupportDropdownsCatalog(factoryId);
  const { sizeGroups } = useSizeGroupsCatalog(factoryId);

  const localSizeGroups = (formData._sizeGroups as Array<Record<string, unknown>>) || [];
  const [newSizeGroupName, setNewSizeGroupName] = useState('');
  const [draftSizes, setDraftSizes] = useState<string[]>([]);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);

  const buyerTypes = dropdownValuesForCategory(supportDropdowns, 'buyer_type');
  const buyerStatuses = dropdownValuesForCategory(supportDropdowns, 'buyer_status');
  const contactRoles = dropdownValuesForCategory(supportDropdowns, 'contact_role');

  const typeOptions = dropdownOptions(buyerTypes, [
    { value: 'Retail', label: 'Retail' },
    { value: 'Brand', label: 'Brand' },
    { value: 'Agent', label: 'Agent' },
  ]);
  const statusOptions = dropdownOptions(buyerStatuses, [
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' },
  ]);
  const roleOptions = dropdownOptions(contactRoles, [
    { value: 'Merchandiser', label: 'Merchandiser' },
    { value: 'Quality control', label: 'Quality control' },
    { value: 'Sourcing manager', label: 'Sourcing manager' },
  ]);

  useEffect(() => {
    if ((formData.id as string)?.startsWith('temp_')) {
      if (!formData._sizeGroups) {
        setFormData({ ...formData, _sizeGroups: [], _init: true });
      }
      return;
    }
    if (formData._sizeGroups !== undefined) return;
    const existing = sizeGroups.filter((sg) => sg.buyerId === formData.id);
    setFormData({
      ...formData,
      _sizeGroups: existing.map((sg) => ({ ...sg, sizes: [...sg.sizes] })),
      _init: true,
    });
  }, [formData.id, sizeGroups]);

  const patch = (fields: Record<string, unknown>) => setFormData({ ...formData, ...fields });

  const addSizeGroup = () => {
    if (!newSizeGroupName || draftSizes.length === 0) return;
    const exists = localSizeGroups.some(
      (sg) =>
        String(sg.name).toLowerCase() === newSizeGroupName.toLowerCase() && sg.id !== editingGroup,
    );
    if (exists) {
      alert(`Size Group name "${newSizeGroupName}" already exists for this buyer.`);
      return;
    }
    const sizesArray = draftSizes.map((s) => s.trim()).filter(Boolean);
    if (sizesArray.length === 0) return;
    if (editingGroup) {
      patch({
        _sizeGroups: localSizeGroups.map((sg) =>
          sg.id === editingGroup ? { ...sg, name: newSizeGroupName, sizes: sizesArray } : sg,
        ),
      });
      setEditingGroup(null);
    } else {
      patch({
        _sizeGroups: [
          ...localSizeGroups,
          {
            id: crypto.randomUUID(),
            factory_id: factoryId,
            buyerId: formData.id,
            name: newSizeGroupName,
            sizes: sizesArray,
          },
        ],
      });
    }
    setNewSizeGroupName('');
    setDraftSizes([]);
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto thin-scrollbar">
      <div className="grid grid-cols-12 gap-x-6 gap-y-0 pb-2">
        <div className="col-span-12 lg:col-span-7 space-y-0">
          <section className="py-5 border-b border-slate-200">
            <h4 className={SECTION_HEAD}>
              <User size={16} /> Identity
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="col-span-2 md:col-span-4">
                <Input
                  label="Buyer name"
                  value={String(formData.name || '')}
                  onChange={(e) => patch({ name: e.target.value })}
                  className="bg-white"
                />
              </div>
              <div className="col-span-1 md:col-span-2">
                <Input
                  label="Short code"
                  placeholder="ZARA"
                  value={String(formData.code || '')}
                  onChange={(e) => patch({ code: e.target.value })}
                  className="bg-white"
                />
              </div>
              <div className="col-span-1 md:col-span-2">
                <Input
                  label="HQ country"
                  placeholder="Spain"
                  value={String(formData.country || '')}
                  onChange={(e) => patch({ country: e.target.value })}
                  className="bg-white"
                />
              </div>
              <div className="col-span-1 md:col-span-2">
                <Select
                  label="Buyer type"
                  value={String(formData.type || 'Retail')}
                  onChange={(v) => patch({ type: v })}
                  options={typeOptions.filter((o) => o.value !== '' || !formData.type)}
                  className="w-full"
                />
              </div>
              <div className="col-span-1 md:col-span-2">
                <Select
                  label="Status"
                  value={String(formData.status || 'Active')}
                  onChange={(v) => patch({ status: v })}
                  options={statusOptions.filter((o) => o.value !== '' || !formData.status)}
                  className="w-full"
                />
              </div>
            </div>
          </section>

          <section className="py-5 border-b border-slate-200">
            <h4 className={SECTION_HEAD}>
              <Truck size={16} /> Shipment defaults
            </h4>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <Input
                label="Over-shipment %"
                type="number"
                value={formData.overShipmentAllowance != null ? String(formData.overShipmentAllowance) : ''}
                onChange={(e) => patch({ overShipmentAllowance: parseFloat(e.target.value) || 0 })}
                className="bg-white"
              />
              <Input
                label="Under-shipment %"
                type="number"
                value={formData.underShipmentAllowance != null ? String(formData.underShipmentAllowance) : ''}
                onChange={(e) => patch({ underShipmentAllowance: parseFloat(e.target.value) || 0 })}
                className="bg-white"
              />
            </div>
            <div className="space-y-5">
              <ShipmentDropdownChips
                label="Ship mode options"
                values={(formData.shipModeOptions as string[]) ?? []}
                onChange={(values) => patch({ shipModeOptions: values })}
              />
              <ShipmentDropdownChips
                label="Shipment type options"
                values={(formData.shipmentTypeOptions as string[]) ?? []}
                onChange={(values) => patch({ shipmentTypeOptions: values })}
                chipClassName="bg-violet-100 text-violet-800 border-violet-200"
              />
              <ShipmentDropdownChips
                label="Destination countries shipped to"
                values={(formData.destinationCountries as string[]) ?? []}
                onChange={(values) => patch({ destinationCountries: values })}
                chipClassName="bg-emerald-100 text-emerald-800 border-emerald-200"
                placeholder="e.g. USA, UK, Germany"
              />
            </div>
            {(formData.shipModeOptions as string[] | undefined)?.length === 0 &&
              (formData.shipmentTypeOptions as string[] | undefined)?.length === 0 && (
              <p className="text-[10px] text-slate-400 mt-3">
                Defaults: {catalogDef('ship_mode')?.defaultValues.join(', ')} / {catalogDef('shipment_type')?.defaultValues.join(', ')}
              </p>
            )}
          </section>

          <section className="py-5">
            <h4 className={SECTION_HEAD}>
              <Briefcase size={16} /> Commercial contact
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Contact name"
                placeholder="e.g. Jane Smith"
                value={String(formData.contactName || '')}
                onChange={(e) => patch({ contactName: e.target.value })}
                className="bg-white"
              />
              <Input
                label="Phone"
                placeholder="e.g. +91 98765 43210"
                value={String(formData.contactPhone || '')}
                onChange={(e) => patch({ contactPhone: e.target.value })}
                className="bg-white"
              />
              <Input
                label="Email"
                placeholder="name@buyer.com"
                value={String(formData.contactEmail || '')}
                onChange={(e) => patch({ contactEmail: e.target.value })}
                className="bg-white"
              />
              <Select
                label="Role"
                value={String(formData.contactRole || 'Merchandiser')}
                onChange={(v) => patch({ contactRole: v })}
                options={roleOptions.filter((o) => o.value !== '' || !formData.contactRole)}
                className="w-full"
              />
            </div>
          </section>
        </div>

        <section className={`col-span-12 lg:col-span-5 lg:row-span-3 ${SIZE_GROUPS_CARD}`}>
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 shrink-0">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <Ruler size={16} /> Size groups
            </h4>
          </div>
          {/* Add / Edit form at top */}
          <DesktopWriteGate>
          <div className="shrink-0 p-4 border-b border-slate-100 bg-slate-50/40 space-y-3">
            <Input
              placeholder="Group name (e.g. GGS)"
              value={newSizeGroupName}
              onChange={(e) => setNewSizeGroupName(e.target.value)}
              className="bg-white"
            />
            <SizeChipsInput sizes={draftSizes} onChange={setDraftSizes} />
            <Button
              className="w-full"
              icon={editingGroup ? undefined : Plus}
              onClick={addSizeGroup}
              disabled={!newSizeGroupName.trim() || draftSizes.length === 0}
            >
              {editingGroup ? 'Update group' : 'Add group'}
            </Button>
            {editingGroup && (
              <button
                type="button"
                className="w-full text-[10px] font-medium text-slate-500 hover:text-slate-700"
                onClick={() => {
                  setEditingGroup(null);
                  setNewSizeGroupName('');
                  setDraftSizes([]);
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
          </DesktopWriteGate>
          {/* Groups list below */}
          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-4 space-y-2">
            {localSizeGroups.map((sg) => (
              <div
                key={String(sg.id)}
                className="flex justify-between items-start p-2.5 bg-slate-50 rounded-lg border border-slate-100 group"
              >
                <div className="min-w-0">
                  <div className="font-bold text-xs text-slate-700">{String(sg.name)}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {(Array.isArray(sg.sizes) ? sg.sizes : []).map((s: string) => (
                      <span
                        key={s}
                        className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono text-slate-600"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <DesktopWriteGate>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100">
                  <Button size="sm" variant="ghost" icon={Edit} onClick={() => {
                    setEditingGroup(sg.id as string);
                    setNewSizeGroupName(String(sg.name));
                    setDraftSizes([...(Array.isArray(sg.sizes) ? (sg.sizes as string[]) : [])]);
                  }} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500"
                    icon={Trash2}
                    onClick={() =>
                      patch({ _sizeGroups: localSizeGroups.filter((x) => x.id !== sg.id) })
                    }
                  />
                </div>
                </DesktopWriteGate>
              </div>
            ))}
            {localSizeGroups.length === 0 && (
              <p className="text-center text-xs text-slate-400 italic py-6">No size groups yet</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
