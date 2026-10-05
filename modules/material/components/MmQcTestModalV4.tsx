import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { LabeledDatePicker } from '../../../components/SingleDatePicker';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import {
  mmQcGetScope,
  mmQcSaveTest,
  type MmV4QcResult,
  type MmV4QcScopeKind,
  type MmV4QcSiteSide,
} from '../lib/mmV4Rpc';
import { useMmV4Config } from '../lib/useMmV4Config';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function MmQcTestModalV4({
  open,
  scopeKind,
  scopeId,
  rollIds,
  defaultSiteSide,
  onClose,
  onSaved,
}: {
  open: boolean;
  scopeKind: MmV4QcScopeKind;
  scopeId?: string | null;
  rollIds?: string[];
  defaultSiteSide: MmV4QcSiteSide;
  onClose: () => void;
  onSaved: () => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const { data: v4 } = useMmV4Config(open);

  const [siteSide, setSiteSide] = useState<MmV4QcSiteSide>(defaultSiteSide);
  const [siteFacilityId, setSiteFacilityId] = useState('');
  const [testedAt, setTestedAt] = useState(todayIso());
  const [result, setResult] = useState<MmV4QcResult>('pass');
  const [remarks, setRemarks] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const scopeQ = useQuery({
    queryKey: [
      ...queryKeys.mmOps(factoryId ?? ''),
      'qcScope',
      scopeKind,
      scopeId ?? '',
      (rollIds ?? []).join(','),
    ] as const,
    queryFn: async () => {
      const res = await mmQcGetScope(scopeKind, scopeId ?? '', rollIds);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: open && Boolean(factoryId) && (Boolean(scopeId) || (rollIds?.length ?? 0) > 0),
  });

  useEffect(() => {
    if (!open) return;
    setSiteSide(defaultSiteSide);
    setSiteFacilityId('');
    setTestedAt(todayIso());
    setResult('pass');
    setRemarks('');
    setValues({});
    setBusy(false);
  }, [open, defaultSiteSide]);

  const fields = scopeQ.data?.fields ?? [];
  const lotFields = fields.filter((f) => String(f.test_level) === 'lot');
  const rollFields = fields.filter((f) => String(f.test_level) !== 'lot');
  const ordered = [...lotFields, ...rollFields];

  const facilities = (v4?.facilities ?? []).filter((f) => {
    if (siteSide === 'mill') return f.kind === 'mill';
    if (siteSide === 'processing') return f.kind === 'process_unit';
    return f.kind === 'warehouse';
  });

  const save = async () => {
    const fieldValues: Record<string, unknown> = {};
    for (const field of ordered) {
      const raw = values[field.key] ?? '';
      if (raw.trim() === '') continue;
      if (field.data_type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          showNotification(`${field.label} must be a number`, 'error');
          return;
        }
        fieldValues[field.key] = n;
      } else {
        fieldValues[field.key] = raw;
      }
    }
    for (const field of ordered) {
      if (field.required && (fieldValues[field.key] === undefined || fieldValues[field.key] === '')) {
        showNotification(`${field.label} is required`, 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const res = await mmQcSaveTest({
        scope_kind: scopeKind,
        scope_id: scopeId ?? null,
        roll_ids: rollIds,
        site_side: siteSide,
        site_facility_id: siteFacilityId || null,
        tested_at: testedAt || null,
        field_values: fieldValues,
        result,
        remarks: remarks.trim() || null,
        origin: 'own',
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(
        res.data.supersedes_id
          ? `Test saved · replaces previous · ${res.data.roll_count} rolls`
          : `Test saved · ${res.data.roll_count} rolls`,
        'success',
      );
      onSaved();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save test failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} className="max-w-2xl">
      <div className="flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[14px] font-semibold text-slate-900">Record test</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {scopeQ.data?.rolls?.length ?? rollIds?.length ?? 0} rolls
            {scopeQ.data?.stage_code ? ` · stage ${scopeQ.data.stage_code}` : ''}
            {scopeQ.data?.mixed_fabric_types ? ' · mixed fabrics' : ''}
          </p>
        </div>
        <div className="p-5 flex flex-col gap-3 overflow-y-auto">
          {scopeQ.isError ? (
            <p className="text-[12px] text-red-600">
              {scopeQ.error instanceof Error ? scopeQ.error.message : 'Could not load scope'}
            </p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectDropdown
              label="Tested at"
              value={siteSide}
              onChange={(v) => setSiteSide(v as MmV4QcSiteSide)}
              options={[
                { value: 'mill', label: 'Mill' },
                { value: 'processing', label: 'Processing' },
                { value: 'warehouse', label: 'Warehouse' },
              ]}
            />
            <SelectDropdown
              label="Site"
              value={siteFacilityId}
              onChange={setSiteFacilityId}
              options={[
                { value: '', label: '—' },
                ...facilities.map((f) => ({ value: f.id, label: f.name || f.code })),
              ]}
            />
            <LabeledDatePicker label="Test date" value={testedAt} onChange={setTestedAt} />
            <SelectDropdown
              label="Result"
              value={result}
              onChange={(v) => setResult(v as MmV4QcResult)}
              options={[
                { value: 'pass', label: 'Pass' },
                { value: 'fail', label: 'Fail' },
                { value: 'hold', label: 'Hold' },
              ]}
            />
          </div>
          {ordered.map((field) => (
            <Input
              key={field.id}
              label={`${field.label}${field.required ? ' *' : ''}${String(field.test_level) === 'lot' ? ' (lot)' : ''}`}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          ))}
          <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <p className="text-[10px] text-slate-400">Saving replaces the previous test on this scope.</p>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={busy || scopeQ.isLoading} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save results'}
            </Button>
          </DesktopWriteGate>
        </div>
      </div>
    </Modal>
  );
}
