import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, SelectDropdown } from '../../../components/ui';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { mmListProcessTypes, mmListProcessVendors, mmSaveProcessCatalog } from '../lib/mmRpc';
import { mmSaveProcessTypeRules, type MmV4ReturnMode } from '../lib/mmV4Rpc';
import { useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmProcessVendorsHandle {
  save: () => Promise<boolean>;
}

type TypeRow = {
  key: string;
  id: string | null;
  name: string;
  active: boolean;
  output_stage_code: string;
  default_return_mode: MmV4ReturnMode;
  resets_testing: boolean;
  resets_inspection: boolean;
  machine_kinds: string[];
  rulesDirty: boolean;
};

type VendorRow = { key: string; id: string | null; name: string; active: boolean; typeKeys: string[] };

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;

const MmProcessVendorsPage = forwardRef<
  MmProcessVendorsHandle,
  { onDirtyChange: (dirty: boolean) => void }
>(function MmProcessVendorsPage({ onDirtyChange }, ref) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const v4 = useMmV4Config();
  const refreshV4 = useRefreshMmV4Config();
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);

  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'processCatalog'],
    queryFn: async () => {
      const [typeRes, vendorRes] = await Promise.all([mmListProcessTypes(), mmListProcessVendors()]);
      if (typeRes.ok === false) throw new Error(typeRes.message);
      if (vendorRes.ok === false) throw new Error(vendorRes.message);
      return {
        types: Array.isArray(typeRes.data) ? typeRes.data : [],
        vendors: Array.isArray(vendorRes.data) ? vendorRes.data : [],
      };
    },
    enabled: Boolean(factoryId),
  });

  useEffect(() => {
    if (!query.data) return;
    const rulesById = new Map((v4.data?.process_types ?? []).map((pt) => [pt.id, pt]));
    setTypes(query.data.types.map((type) => {
      const rules = rulesById.get(type.id);
      return {
        key: type.id,
        id: type.id,
        name: type.name,
        active: type.active,
        output_stage_code: rules?.output_stage_code ?? '',
        default_return_mode: (rules?.default_return_mode as MmV4ReturnMode) || 'same_rolls',
        resets_testing: rules?.resets_testing === true,
        resets_inspection: rules?.resets_inspection === true,
        machine_kinds: Array.isArray(rules?.machine_kinds) ? rules!.machine_kinds!.map(String) : [],
        rulesDirty: false,
      };
    }));
    setVendors(query.data.vendors.map((vendor) => ({
      key: vendor.id,
      id: vendor.id,
      name: vendor.name,
      active: vendor.active,
      typeKeys: vendor.type_ids,
    })));
    onDirtyChange(false);
  }, [query.data, v4.data, onDirtyChange]);

  const mark = () => onDirtyChange(true);

  const stageOptions = [
    { value: '', label: '—' },
    ...(v4.data?.stages ?? []).map((s) => ({ value: s.code, label: s.label || s.code })),
  ];
  const machineKindOptions = v4.data?.machine_kinds ?? [];

  useImperativeHandle(ref, () => ({
    save: async () => {
      const res = await mmSaveProcessCatalog({
        types: types.map((type, index) => ({
          key: type.key,
          id: type.id,
          name: type.name.trim(),
          active: type.active,
          sort_order: index + 1,
        })),
        vendors: vendors.map((vendor) => ({
          id: vendor.id,
          name: vendor.name.trim(),
          active: vendor.active,
          type_keys: vendor.typeKeys,
        })),
      });
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return false;
      }

      for (const type of types.filter((t) => t.rulesDirty && t.id)) {
        const rulesRes = await mmSaveProcessTypeRules({
          id: type.id!,
          name: type.name.trim(),
          active: type.active,
          output_stage_code: type.output_stage_code || null,
          default_return_mode: type.default_return_mode,
          resets_testing: type.resets_testing,
          resets_inspection: type.resets_inspection,
          machine_kinds: type.machine_kinds,
        });
        if (rulesRes.ok === false) {
          showNotification(rulesRes.message, 'error');
          return false;
        }
      }

      showNotification('Process vendors saved', 'success');
      await Promise.all([query.refetch(), refreshV4()]);
      return true;
    },
  }), [types, vendors, showNotification, query, refreshV4]);

  if (query.isLoading || v4.isLoading) {
    return <p className="text-[12px] text-slate-500">Loading…</p>;
  }
  if (query.error) {
    return <p className="text-[12px] text-red-600">{query.error instanceof Error ? query.error.message : 'Could not load process vendors'}</p>;
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-[13px] font-semibold text-slate-900">Process types</h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => {
            setTypes((rows) => [...rows, {
              key: nextKey(),
              id: null,
              name: '',
              active: true,
              output_stage_code: '',
              default_return_mode: 'same_rolls',
              resets_testing: false,
              resets_inspection: false,
              machine_kinds: [],
              rulesDirty: true,
            }]);
            mark();
          }}>
            Add type
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {types.map((type) => (
            <div key={type.key} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className="text-xs border border-slate-200 rounded px-2 py-1.5 flex-1"
                  value={type.name}
                  placeholder="Dyeing, printing, washing…"
                  onChange={(event) => {
                    const name = event.target.value;
                    setTypes((rows) => rows.map((row) => row.key === type.key ? { ...row, name, rulesDirty: true } : row));
                    mark();
                  }}
                />
                <label className="text-[11px] text-slate-600 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={type.active}
                    onChange={(event) => {
                      const active = event.target.checked;
                      setTypes((rows) => rows.map((row) => row.key === type.key ? { ...row, active, rulesDirty: true } : row));
                      mark();
                    }}
                  />
                  Active
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SelectDropdown
                  label="Output stage"
                  value={type.output_stage_code}
                  onChange={(value) => {
                    setTypes((rows) => rows.map((row) =>
                      row.key === type.key ? { ...row, output_stage_code: value, rulesDirty: true } : row,
                    ));
                    mark();
                  }}
                  options={stageOptions}
                />
                <SelectDropdown
                  label="Default return"
                  value={type.default_return_mode}
                  onChange={(value) => {
                    setTypes((rows) => rows.map((row) =>
                      row.key === type.key
                        ? { ...row, default_return_mode: value as MmV4ReturnMode, rulesDirty: true }
                        : row,
                    ));
                    mark();
                  }}
                  options={[
                    { value: 'same_rolls', label: 'Same rolls' },
                    { value: 're_rolled', label: 'Re-rolled' },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="text-[11px] text-slate-700 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={type.resets_testing}
                    onChange={(event) => {
                      const resets_testing = event.target.checked;
                      setTypes((rows) => rows.map((row) =>
                        row.key === type.key ? { ...row, resets_testing, rulesDirty: true } : row,
                      ));
                      mark();
                    }}
                  />
                  Retest after
                </label>
                <label className="text-[11px] text-slate-700 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={type.resets_inspection}
                    onChange={(event) => {
                      const resets_inspection = event.target.checked;
                      setTypes((rows) => rows.map((row) =>
                        row.key === type.key ? { ...row, resets_inspection, rulesDirty: true } : row,
                      ));
                      mark();
                    }}
                  />
                  Re-inspect after
                </label>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-600 mb-1">Machine kinds</p>
                <div className="flex flex-wrap gap-3">
                  {machineKindOptions.map((kind) => (
                    <label key={kind} className="text-[11px] text-slate-700 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={type.machine_kinds.includes(kind)}
                        onChange={(event) => {
                          const machine_kinds = event.target.checked
                            ? [...type.machine_kinds, kind]
                            : type.machine_kinds.filter((k) => k !== kind);
                          setTypes((rows) => rows.map((row) =>
                            row.key === type.key ? { ...row, machine_kinds, rulesDirty: true } : row,
                          ));
                          mark();
                        }}
                      />
                      {kind}
                    </label>
                  ))}
                  {machineKindOptions.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No machine kinds in v4 config</p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-[13px] font-semibold text-slate-900">Process vendors</h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => {
            setVendors((rows) => [...rows, { key: nextKey(), id: null, name: '', active: true, typeKeys: [] }]);
            mark();
          }}>
            Add vendor
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {vendors.map((vendor) => (
            <div key={vendor.key} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  className="text-xs border border-slate-200 rounded px-2 py-1.5 flex-1"
                  value={vendor.name}
                  placeholder="Vendor name"
                  onChange={(event) => {
                    const name = event.target.value;
                    setVendors((rows) => rows.map((row) => row.key === vendor.key ? { ...row, name } : row));
                    mark();
                  }}
                />
                <label className="text-[11px] text-slate-600 flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={vendor.active}
                    onChange={(event) => {
                      const active = event.target.checked;
                      setVendors((rows) => rows.map((row) => row.key === vendor.key ? { ...row, active } : row));
                      mark();
                    }}
                  />
                  Active
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                {types.filter((type) => type.name.trim()).map((type) => (
                  <label key={type.key} className="text-[11px] text-slate-700 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={vendor.typeKeys.includes(type.key)}
                      onChange={(event) => {
                        const typeKeys = event.target.checked
                          ? [...vendor.typeKeys, type.key]
                          : vendor.typeKeys.filter((key) => key !== type.key);
                        setVendors((rows) => rows.map((row) => row.key === vendor.key ? { ...row, typeKeys } : row));
                        mark();
                      }}
                    />
                    {type.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
});

export default MmProcessVendorsPage;
