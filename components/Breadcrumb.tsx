import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigationStore } from '../stores';
import { getRouteEntry, buildBreadcrumbTrail } from '../lib/routeMap';
import { tokens } from '../lib/designTokens';
import { usePageHeaderContext } from './PageHeaderContext';
import { RoutePath } from '../types';

interface BreadcrumbProps {
  titleOverride?: string;
  subtitleOverride?: string;
  actions?: React.ReactNode;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ titleOverride, subtitleOverride, actions: propActions }) => {
  const { currentRoute } = useNavigationStore();
  const { actionsRef, metaRef, version } = usePageHeaderContext();
  const entry = getRouteEntry(currentRoute);
  const actions = propActions || (version >= 0 ? actionsRef.current : null);
  const pageMeta = version >= 0 ? metaRef.current : {};

  const trail = buildBreadcrumbTrail(currentRoute, titleOverride || pageMeta?.title || undefined);
  const current = trail[trail.length - 1];
  // Prefer routeMap subtitle on navigate (same speed as title). Page override only when still on that route.
  const liveSubtitle =
    pageMeta?.route === currentRoute ? pageMeta?.subtitle : null;
  const pageSubtitle = subtitleOverride ?? liveSubtitle ?? entry?.subtitle;

  return (
    <div className="bg-gray-100 rounded-l-xl shadow-md border border-slate-200 px-6 py-4 mb-3 flex-shrink-0 min-h-[60px]">
      <div className="flex items-center justify-between">
        <h1
          className="font-bold text-slate-900 leading-tight"
          style={{ fontSize: tokens.fontSize.display }}
        >
          {current?.displayName || 'Page'}
        </h1>
        {actions && (
          <div className="flex items-center gap-3">
            {actions}
          </div>
        )}
      </div>

      {pageSubtitle && (
        <p
          className="text-slate-500 mt-0.5"
          style={{ fontSize: tokens.fontSize.bodySmall }}
        >
          {pageSubtitle}
        </p>
      )}
    </div>
  );
};

export { PageHeaderProvider, usePageActions, usePageHeader } from './PageHeaderContext';
