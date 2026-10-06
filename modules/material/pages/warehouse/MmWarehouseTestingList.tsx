import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { type MmInChallanHeader } from '../../lib/mmRpc';
import {
  inboundDocKind,
  inboundHasPendingTests,
  inboundOpsStatus,
  inboundOpsStatusFilterOptions,
  isInboundPhysicallyIn,
  type InboundOpsStatus,
} from '../../lib/inboundDisplay';
import { useMmInChallans } from '../../lib/useMmOps';
import { MmInboundChallanTable } from '../../components/MmInboundChallanTable';

const PAGE_SIZE = 20;

type DocFilter = '' | 'GRN' | 'Challan';
type StatusFilter = '' | InboundOpsStatus;
type OriginFilter = '' | 'mill' | 'vendor';

function haystack(row: MmInChallanHeader): string {
  return [
    row.challan_no,
    row.reference_no,
    row.style_name,
    row.style_ref,
    row.buyer_name,
    row.po_number,
    row.color_name,
    row.fabric_name,
    row.fabric_type,
    row.fabric_category,
    row.supplier_name,
    row.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function MmWarehouseTestingList() {
  const mill = useMmInChallans('mill', '');
  const vendor = useMmInChallans('vendor', '');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterDoc, setFilterDoc] = useState<DocFilter>('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
  const [filterOrigin, setFilterOrigin] = useState<OriginFilter>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterDoc, filterStatus, filterOrigin]);

  usePageHeader({
    subtitle: 'Open a GRN or mill challan to enter test results for each roll. Invoice inspection is view-only on the inbound document.',
  });

  const rows = useMemo(() => {
    const all = [...(mill.data ?? []), ...(vendor.data ?? [])].filter(isInboundPhysicallyIn);
    return all.sort((a, b) => {
      const pendingA = inboundHasPendingTests(a) ? 0 : 1;
      const pendingB = inboundHasPendingTests(b) ? 0 : 1;
      if (pendingA !== pendingB) return pendingA - pendingB;
      return String(b.received_at ?? b.sent_at ?? '').localeCompare(String(a.received_at ?? a.sent_at ?? ''));
    });
  }, [mill.data, vendor.data]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (filterOrigin && row.source !== filterOrigin) return false;
      if (filterDoc && inboundDocKind(row) !== filterDoc) return false;
      if (filterStatus && inboundOpsStatus(row) !== filterStatus) return false;
      if (q && !haystack(row).includes(q)) return false;
      return true;
    });
  }, [rows, debouncedSearch, filterOrigin, filterDoc, filterStatus]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: filtered.length,
    start: filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, filtered.length),
  };

  const pageError = mill.error ?? vendor.error;
  const pageLoading = (mill.isLoading && !mill.data) || (vendor.isLoading && !vendor.data);

  return (
    <PageShell
      loading={pageLoading}
      error={pageError}
      onRetry={() => {
        void mill.refetch();
        void vendor.refetch();
      }}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search GRN, challan, style, fabric..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:ml-auto">
            <SelectDropdown
              value={filterDoc}
              onChange={(v) => setFilterDoc(v as DocFilter)}
              options={[
                { value: '', label: 'All documents' },
                { value: 'GRN', label: 'GRN' },
                { value: 'Challan', label: 'Challan' },
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={filterStatus}
              onChange={(v) => setFilterStatus(v as StatusFilter)}
              options={inboundOpsStatusFilterOptions(false)}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={filterOrigin}
              onChange={(v) => setFilterOrigin(v as OriginFilter)}
              options={[
                { value: '', label: 'Mill and vendor' },
                { value: 'mill', label: 'Mill' },
                { value: 'vendor', label: 'Vendor' },
              ]}
              icon={Filter}
              className="w-full sm:w-36"
            />
          </div>
        </div>
        {(filtered.length > PAGE_SIZE || filterStatus || filterDoc || filterOrigin || debouncedSearch) && (
          <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {filtered.length}{' '}
            GRNs / challans)
          </div>
        )}
        {pageRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[11px] text-slate-400">No GRNs or challans match this filter.</p>
        ) : (
          <MmInboundChallanTable rows={pageRows} variant="testing" />
        )}
        <Pagination {...pagination} />
      </Card>
    </PageShell>
  );
}
