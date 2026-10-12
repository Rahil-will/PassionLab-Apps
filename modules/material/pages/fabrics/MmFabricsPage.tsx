/**
 * Fabric Master — catalog of fabrics.
 * Opening a row pushes #/material/fabrics/:fabricId.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Merge, MoreVertical, Plus, Search } from 'lucide-react';
import { Button, Card, SelectDropdown } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useMmConfigRights } from '../../lib/useMmConfigRights';
import { useMmFabrics, useMmFabricConstructions } from '../../lib/useMmFabrics';
import { useMmRequirementCatalog } from '../../lib/useMmRequirementCatalog';
import { setFabricStatus, type MmFabric, type MmFabricStatus } from '../../lib/mmFabricRpc';
import { colorMethodLabel, suggestFabricName, uomLabel, widthFormLabel } from '../../lib/fabricLabels';
import { fmtUomQty } from '../../lib/fabricStock';
import { FabricFormDrawer } from '../../components/FabricFormDrawer';
import { FabricMergeModal } from '../../components/FabricMergeModal';

const PAGE_SIZE = 20;
const FABRIC_COL = '26%';
const ACTION_COL = '2.75rem';
const EQUAL_COL_COUNT = 13;
const equalCol = `calc((100% - ${FABRIC_COL} - ${ACTION_COL}) / ${EQUAL_COL_COUNT})`;

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdCenterCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center max-w-0 overflow-hidden';
function RowMenu({
  fabric,
  onArchive,
  onRestore,
  onMerge,
}: {
  fabric: MmFabric;
  onArchive: () => void;
  onRestore: () => void;
  onMerge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setMenuPos({ top: rect.top - 4, left: rect.right });
          setOpen((v) => !v);
        }}
        className="inline-flex shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        aria-label="Row menu"
      >
        <MoreVertical size={14} />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[80] w-44 -translate-x-full -translate-y-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-[11px]"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {fabric.status !== 'inactive' && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onArchive(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-red-600">Archive</button>
          )}
          {fabric.status === 'inactive' && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onRestore(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-emerald-700">Restore</button>
          )}
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onMerge(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
            <Merge size={12} /> Merge into…
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function MmFabricsPage({ fabricId }: { fabricId?: string }) {
  const { showNotification } = useNotificationStore();
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const isConfig = useMmConfigRights();
  const catalog = useMmRequirementCatalog();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeId, setTypeId] = useState('');
  const [constructionId, setConstructionId] = useState('');
  const [archiveView, setArchiveView] = useState<'active' | 'all' | 'inactive'>('active');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<MmFabric | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => { setConstructionId(''); }, [typeId]);
  useEffect(() => { setPage(1); }, [debouncedSearch, typeId, constructionId, archiveView]);

  const { rows: constructions } = useMmFabricConstructions(typeId || null);
  const { rows, loading, error, refetch } = useMmFabrics({
    search: debouncedSearch.trim() || undefined,
    fabric_type_id: typeId || undefined,
    construction_id: constructionId || undefined,
    status: archiveView === 'inactive' ? ['inactive'] : archiveView === 'all' ? ['active', 'inactive'] : ['active'],
    include_inactive: archiveView !== 'active',
    with_stock: true,
  });

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: rows.length,
    start: rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, rows.length),
  };

  const handleSetStatus = useCallback(async (fabric: MmFabric, next: MmFabricStatus) => {
    const res = await setFabricStatus(fabric.id, next);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification(
      next === 'inactive' ? `${fabric.code} archived` : `${fabric.code} restored`,
      'success',
    );
    void refetch();
  }, [showNotification, refetch]);

  const typeOptions = useMemo(
    () => [{ value: '', label: 'All types' }, ...(catalog.data?.fabricTypes ?? []).map((t) => ({ value: t.id, label: t.name }))],
    [catalog.data],
  );
  const archiveOptions = [
    { value: 'active', label: 'Active' },
    { value: 'all', label: 'Show archived' },
    { value: 'inactive', label: 'Archived only' },
  ];
  const constructionOptions = useMemo(
    () => [{ value: '', label: 'All constructions' }, ...constructions.map((c) => ({ value: c.id, label: c.name }))],
    [constructions],
  );

  usePageHeader({});

  const drawerOpen = createOpen || Boolean(fabricId);

  return (
    <PageShell
      loading={loading && rows.length === 0 && !error}
      error={error}
      onRetry={() => void refetch()}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 min-w-0"
    >
      <Card noPadding className="flex-1 min-h-0 min-w-0 shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search code, name, composition…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:ml-auto">
            <SelectDropdown
              options={archiveOptions}
              value={archiveView}
              onChange={(value) => setArchiveView(value === 'all' || value === 'inactive' ? value : 'active')}
              className="w-40"
            />
            <SelectDropdown options={typeOptions} value={typeId} onChange={setTypeId} icon={Filter} className="w-36" />
            {typeId && (
              <SelectDropdown options={constructionOptions} value={constructionId} onChange={setConstructionId} icon={Filter} className="w-44" />
            )}
            {isConfig && (
              <DesktopWriteGate>
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>New fabric</Button>
              </DesktopWriteGate>
            )}
          </div>
        </div>
        {(rows.length > PAGE_SIZE || debouncedSearch || typeId || archiveView !== 'active') && (
          <div className="shrink-0 px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {rows.length} fabrics)
          </div>
        )}
        <div className="flex-1 min-h-0 min-w-0 overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: FABRIC_COL }} />
              {Array.from({ length: EQUAL_COL_COUNT }, (_, index) => (
                <col key={index} style={{ width: equalCol }} />
              ))}
              <col style={{ width: ACTION_COL }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thFirstCls}>Name</th>
                <th className={thCls}>Code</th>
                <th className={thCls}>Type</th>
                <th className={thCls}>Construction</th>
                <th className={thCls}>Composition</th>
                <th className={thCenterCls}>GSM</th>
                <th className={thCls}>Width</th>
                <th className={thCls}>Width type</th>
                <th className={thCls}>UOM</th>
                <th className={thCls}>Colour</th>
                <th className={thCenterCls}>Used on</th>
                <th className={thCenterCls}>Available</th>
                <th className={thCenterCls} title="Demand − cuttable in stock">Short</th>
                <th className={thCenterCls}>Status</th>
                <th className={`${thCenterCls} sticky right-0 z-20`} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No fabrics match this filter.
                  </td>
                </tr>
              )}
              {pageRows.map((fabric) => {
                const archived = fabric.status === 'inactive';
                const autoName = suggestFabricName({
                  constructionName: fabric.construction?.name,
                  compositionText: fabric.composition_text,
                  gsm: fabric.gsm,
                  widthIn: fabric.width_in,
                  widthForm: fabric.width_form,
                }) || fabric.name;
                const fullWidth = fabric.spec_values?.full_width?.trim();
                const width = [
                  fullWidth ? `Full ${fullWidth}"` : null,
                  fabric.width_in != null ? `Cut ${fabric.width_in}"` : null,
                ].filter(Boolean).join(' · ') || '—';
                const widthType = widthFormLabel(fabric.width_form) || '—';
                const uom = uomLabel(fabric.uom) || '—';
                return (
                  <tr
                    key={fabric.id}
                    className={archived ? 'group bg-slate-50/80 text-slate-400 cursor-pointer' : 'group hover:bg-slate-50/80 cursor-pointer'}
                    onClick={() => requestNavigate(RoutePath.MATERIAL_FABRIC_DETAIL, { fabricId: fabric.id })}
                  >
                    <td className={tdFirstCls}>
                      <span className={`block truncate font-semibold ${archived ? 'text-slate-400' : 'text-slate-800'}`} title={autoName}>{autoName}</span>
                    </td>
                    <td className={`${tdCls} font-mono text-slate-500`}>
                      <span className="block truncate">{fabric.code}</span>
                    </td>
                    <td className={`${tdCls} truncate`}>{fabric.fabric_type?.name ?? '—'}</td>
                    <td className={`${tdCls} truncate`}>{fabric.construction?.name ?? '—'}</td>
                    <td className={`${tdCls} truncate`} title={fabric.composition_text}>{fabric.composition_text || '—'}</td>
                    <td className={`${tdCenterCls} tabular-nums`}>{fabric.gsm ?? '—'}</td>
                    <td className={`${tdCls} truncate`} title={width}>{width}</td>
                    <td className={`${tdCls} truncate`}>{widthType}</td>
                    <td className={`${tdCls} truncate`}>{uom}</td>
                    <td className={`${tdCls} truncate`}>{colorMethodLabel(fabric.color_method) || '—'}</td>
                    <td className={`${tdCenterCls} tabular-nums`}>
                      {fabric.used_on_orders > 0 ? fabric.used_on_orders : '—'}
                    </td>
                    <td className={tdCenterCls}>
                      <span className="block tabular-nums font-semibold text-slate-800">
                        {fmtUomQty(fabric.stock?.available_cuttable ?? fabric.stock?.available ?? 0, fabric.uom)}
                      </span>
                      {(fabric.stock?.not_cuttable ?? 0) > 0 ? (
                        <span className="block text-[10px] text-slate-400">
                          + {fmtUomQty(fabric.stock?.not_cuttable ?? 0, fabric.uom)} not cuttable
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tdCenterCls} tabular-nums`} title="Demand − cuttable in stock">
                      <span className={(fabric.position?.short ?? 0) > 0 ? 'font-semibold text-red-600' : ''}>
                        {(fabric.position?.short ?? 0) > 0 ? fmtUomQty(fabric.position?.short ?? 0, fabric.uom) : '—'}
                      </span>
                    </td>
                    <td className={tdCenterCls}>
                      <span className={`text-[10px] font-semibold ${archived ? 'text-slate-500' : 'text-emerald-700'}`}>
                        {archived ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td
                      className={`sticky right-0 z-[1] w-11 px-1 py-2.5 border-b border-slate-100 text-center whitespace-nowrap ${archived ? 'bg-slate-50' : 'bg-white group-hover:bg-slate-50'}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isConfig && (
                        <DesktopWriteGate>
                          <RowMenu
                            fabric={fabric}
                            onArchive={() => void handleSetStatus(fabric, 'inactive')}
                            onRestore={() => void handleSetStatus(fabric, 'active')}
                            onMerge={() => setMergeFrom(fabric)}
                          />
                        </DesktopWriteGate>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="shrink-0">
          <Pagination {...pagination} />
        </div>
      </Card>

      <FabricFormDrawer
        open={drawerOpen}
        mode={fabricId ? 'edit' : 'create'}
        fabricId={fabricId}
        readOnly={Boolean(fabricId) && !isConfig}
        onClose={() => {
          setCreateOpen(false);
          if (fabricId) requestNavigate(RoutePath.MATERIAL_FABRICS);
        }}
        onSaved={() => { void refetch(); }}
      />
      {mergeFrom && (
        <FabricMergeModal open from={mergeFrom} onClose={() => setMergeFrom(null)} onMerged={() => { void refetch(); }} />
      )}
    </PageShell>
  );
}
