import React, { useMemo } from 'react';
import { User, Building2, GitMerge, Clock } from 'lucide-react';
import { WorkCenterBuyers } from './WorkCenterBuyers';
import { WorkCenterDepartments } from './WorkCenterDepartments';
import { WorkCenterProcessFlows } from './WorkCenterProcessFlows';
import { WorkCenterShifts } from './WorkCenterShifts';
import { useNavigationStore } from '../../stores';
import { RoutePath } from '../../types';

export type WorkCenterTab = 'buyers' | 'departments' | 'process-flows' | 'shifts';

const BASE_TABS: { id: WorkCenterTab; label: string; icon: React.ElementType; route: RoutePath }[] = [
  { id: 'buyers', label: 'Buyers', icon: User, route: RoutePath.WORK_CENTER_BUYERS },
  { id: 'departments', label: 'Departments', icon: Building2, route: RoutePath.WORK_CENTER_DEPARTMENTS },
  { id: 'process-flows', label: 'Process Flows', icon: GitMerge, route: RoutePath.WORK_CENTER_PROCESS_FLOWS },
  { id: 'shifts', label: 'Shifts', icon: Clock, route: RoutePath.WORK_CENTERS },
];

const ROUTE_TO_TAB: Record<string, WorkCenterTab> = {
  [RoutePath.WORK_CENTER_BUYERS]: 'buyers',
  [RoutePath.WORK_CENTER_DEPARTMENTS]: 'departments',
  [RoutePath.WORK_CENTER_PROCESS_FLOWS]: 'process-flows',
};

export function WorkCenterTabBar({
  active,
  onChange,
  tabs,
}: {
  active: WorkCenterTab;
  onChange: (t: WorkCenterTab) => void;
  tabs: typeof BASE_TABS;
}) {
  return (
    <div className="flex items-center gap-0.5 border-r border-slate-200 pr-3 mr-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Icon size={13} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function WorkCenters() {
  const { currentRoute, routeParams, requestNavigate } = useNavigationStore();

  const tabs = useMemo(() => BASE_TABS, []);

  const activeTab: WorkCenterTab = (() => {
    if (currentRoute === RoutePath.WORK_CENTERS && routeParams.tab) {
      const t = routeParams.tab as WorkCenterTab;
      if (tabs.some((tab) => tab.id === t)) return t;
      return 'buyers';
    }
    return ROUTE_TO_TAB[currentRoute] ?? 'buyers';
  })();

  const requestTabChange = (tab: WorkCenterTab) => {
    if (tab === activeTab) return;
    if (tab === 'shifts') {
      requestNavigate(RoutePath.WORK_CENTERS, { tab: 'shifts' });
      return;
    }
    const target = tabs.find((t) => t.id === tab)!;
    requestNavigate(target.route);
  };

  const tabBar = <WorkCenterTabBar active={activeTab} onChange={requestTabChange} tabs={tabs} />;

  return (
    <>
      {activeTab === 'buyers' && <WorkCenterBuyers tabBar={tabBar} />}
      {activeTab === 'departments' && <WorkCenterDepartments tabBar={tabBar} />}
      {activeTab === 'process-flows' && <WorkCenterProcessFlows tabBar={tabBar} />}
      {activeTab === 'shifts' && <WorkCenterShifts tabBar={tabBar} />}
    </>
  );
}
