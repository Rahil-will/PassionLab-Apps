import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigationStore } from '../../stores';
import { SelectDropdown } from '../../components/ui';
import { PageShell, PageToolbarCard } from '../../components/layout/PageShell';
import { OrderCompletionWorkspace } from '../../components/production/OrderCompletionWorkspace';
import { useReportMeta } from '../../lib/queries/reports';

export const OrderCompletion: React.FC = () => {
  const { factoryId, routeParams, userProfile } = useNavigationStore();
  const [buyerFilter, setBuyerFilter] = useState('');
  const [completionFilter, setCompletionFilter] = useState<'all' | 'ongoing' | 'completed'>('ongoing');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkOrderId, setLinkOrderId] = useState('');
  const [linkColorwayId, setLinkColorwayId] = useState('');
  const metaQuery = useReportMeta(factoryId);
  const meta = metaQuery.data ?? null;

  useEffect(() => {
    const orderId = routeParams.order || routeParams.orderId || routeParams.style || '';
    const colorwayId = routeParams.colorway || routeParams.colorId || '';
    if (orderId) setLinkOrderId(orderId);
    if (colorwayId) setLinkColorwayId(colorwayId);
  }, [routeParams]);

  useEffect(() => {
    if (!meta) return;
    if (buyerFilter && !meta.buyers.some((b) => b.id === buyerFilter)) {
      setBuyerFilter('');
    }
  }, [meta, buyerFilter]);

  if (!factoryId) {
    return (
      <PageShell className="page-content">
        <p className="p-8 text-center text-sm text-slate-500">Select a factory to open Order Completion.</p>
      </PageShell>
    );
  }

  return (
    <PageShell className="page-content space-y-4">
      {meta && (
        <PageToolbarCard className="no-print mes-page-chrome flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[12rem] max-w-md">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 w-full"
              placeholder="Search style, PO, buyer, color…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 ml-auto">
            <SelectDropdown
              value={buyerFilter}
              onChange={setBuyerFilter}
              options={[
                { value: '', label: 'All buyers' },
                ...meta.buyers.map((b) => ({ value: b.id, label: b.name })),
              ]}
              className="w-44"
            />
            <SelectDropdown
              value={completionFilter}
              onChange={(v) => setCompletionFilter(v as typeof completionFilter)}
              options={[
                { value: 'ongoing', label: 'Ongoing' },
                { value: 'completed', label: 'Completed' },
                { value: 'all', label: 'All' },
              ]}
              className="w-44"
            />
          </div>
        </PageToolbarCard>
      )}

      <OrderCompletionWorkspace
        factoryId={factoryId}
        userId={userProfile?.id ?? ''}
        userRole={userProfile?.userRole ?? 'viewer'}
        buyerFilter={buyerFilter}
        completionFilter={completionFilter}
        searchQuery={searchQuery}
        filterOrderId={linkOrderId || undefined}
        filterColorwayId={linkColorwayId || undefined}
      />
    </PageShell>
  );
};
