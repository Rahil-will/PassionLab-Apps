import React, { useEffect, Suspense, Component, ReactNode } from 'react';
import { Layout } from './components/Layout';
import { RequireRole } from './components/RequireRole';
import { useNavigationStore, useNotificationStore } from './stores';
import { RoutePath } from './types';
import { Toast } from './components/ui';
import { Login } from './pages/Login';
import { restoreAuthSession } from './lib/authSession';
import {
  routeNeedsOrdersListPrefetch,
  routeSettingsScope,
} from './lib/factoryBootstrap';
import { useSettingsBootstrap } from './lib/queries/settings';
import { prefetchFactoryListData } from './lib/prefetchFactoryData';
import { useFactoryDataBootstrap } from './hooks/useFactoryDataBootstrap';
import { useAuthSessionSync } from './hooks/useAuthSessionSync';
import { canAccessRoute } from './lib/routeAccess';

const Dashboard = React.lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const CreateOrderMaster = React.lazy(() => import('./pages/production/CreateOrderMaster').then(m => ({ default: m.CreateOrderMaster })));
const StatusTracker = React.lazy(() => import('./pages/production/StatusTracker').then(m => ({ default: m.StatusTracker })));
const FloorDayBoard = React.lazy(() => import('./pages/production/FloorDayBoard').then(m => ({ default: m.FloorDayBoard })));
const Settings = React.lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const WorkCenters = React.lazy(() => import('./pages/system/WorkCenters').then(m => ({ default: m.WorkCenters })));
const UserManagement = React.lazy(() => import('./pages/system/UserManagement').then(m => ({ default: m.UserManagement })));
const StyleDetails = React.lazy(() => import('./pages/production/StyleDetails').then(m => ({ default: m.StyleDetails })));
const StyleColorDetails = React.lazy(() => import('./pages/production/StyleColorDetails').then(m => ({ default: m.StyleColorDetails })));
const ProductionPlanning = React.lazy(() => import('./pages/planning/ProductionPlanning').then(m => ({ default: m.ProductionPlanning })));
const PlanningOrderList = React.lazy(() => import('./pages/planning/PlanningOrderList').then(m => ({ default: m.PlanningOrderList })));
const DepartmentSchedule = React.lazy(() => import('./pages/planning/DepartmentSchedule').then(m => ({ default: m.DepartmentSchedule })));
const TransactionReport = React.lazy(() => import('./pages/planning/TransactionReport').then(m => ({ default: m.TransactionReport })));
const OrderCompletion = React.lazy(() => import('./pages/production/OrderCompletion').then(m => ({ default: m.OrderCompletion })));
const ReportsLanding = React.lazy(() => import('./pages/reports/ReportsLanding').then(m => ({ default: m.ReportsLanding })));
const DayReport = React.lazy(() => import('./pages/reports/DayReport').then(m => ({ default: m.DayReport })));
const StyleReport = React.lazy(() => import('./pages/reports/StyleReport').then(m => ({ default: m.StyleReport })));

interface ErrorBoundaryState { hasError: boolean; error?: Error }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500 gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl font-bold">!</div>
          <p className="font-medium text-slate-700">Something went wrong loading this page.</p>
          <p className="text-xs text-slate-400">{this.state.error?.message}</p>
          <button
            className="mt-2 px-4 py-2 text-sm rounded bg-slate-100 hover:bg-slate-200"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const PageLoader: React.FC = () => (
  <div className="flex items-center justify-center h-[60vh]">
    <div className="w-8 h-8 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
  const {
    currentRoute,
    routeParams,
    isAuthenticated,
    factoryId,
    initRouteFromHash,
    userProfile,
    navigate,
  } = useNavigationStore();
  const { notification, hideNotification } = useNotificationStore();
  const [authReady, setAuthReady] = React.useState(false);

  useSettingsBootstrap(
    factoryId,
    isAuthenticated,
    routeSettingsScope(currentRoute),
  );

  useFactoryDataBootstrap(factoryId, currentRoute, isAuthenticated);
  useAuthSessionSync();

  useEffect(() => {
    initRouteFromHash();
  }, [initRouteFromHash]);

  useEffect(() => {
    void restoreAuthSession().finally(() => setAuthReady(true));
  }, []);

  // Warm paginated list cache only on list pages (not every route change).
  useEffect(() => {
    if (!isAuthenticated || !factoryId) return;
    if (routeNeedsOrdersListPrefetch(currentRoute)) {
      prefetchFactoryListData(factoryId);
    }
  }, [isAuthenticated, factoryId, currentRoute]);

  useEffect(() => {
    const role = userProfile?.userRole;
    if (!role || canAccessRoute(role, currentRoute)) return;
    navigate(RoutePath.DASHBOARD);
  }, [userProfile?.userRole, currentRoute, navigate]);

  if (!authReady) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  const role = userProfile?.userRole;
  const guardedRoute =
    role && !canAccessRoute(role, currentRoute) ? RoutePath.DASHBOARD : currentRoute;

  const renderContent = () => {
    if (guardedRoute.startsWith('#/style-details/')) {
      return <StyleDetails />;
    }
    if (guardedRoute.startsWith('#/style-color-details/')) {
      return <StyleColorDetails />;
    }
    if (guardedRoute.startsWith('#/planning-detail')) {
      return <ProductionPlanning />;
    }
    if (guardedRoute.startsWith('#/create-order')) {
      return <CreateOrderMaster key={routeParams.id ?? 'new'} />;
    }

    switch (guardedRoute) {
      case RoutePath.DASHBOARD:
        return <Dashboard />;
      case RoutePath.CREATE_ORDER:
        return <CreateOrderMaster key={routeParams.id ?? 'new'} />;
      case RoutePath.STATUS_TRACKER:
        return <StatusTracker />;
      case RoutePath.FLOOR_DAY:
        return <FloorDayBoard />;
      case RoutePath.ORDER_COMPLETION:
        return <OrderCompletion />;
      case RoutePath.REPORTS:
        return <ReportsLanding />;
      case RoutePath.REPORTS_DAY:
        return <DayReport />;
      case RoutePath.REPORTS_STYLE:
        return <StyleReport />;
      case RoutePath.REPORTS_DEPARTMENT:
        return <DayReport />;
      case RoutePath.LINE_ASSIGNMENT:
        return <PlanningOrderList />;
      case RoutePath.DEPT_SCHEDULE:
        return <DepartmentSchedule />;
      case RoutePath.TRANSACTION_REPORT:
        return <TransactionReport />;
      case RoutePath.ADMIN:
      case RoutePath.USER_MANAGEMENT:
        return <UserManagement />;
      case RoutePath.SETTINGS:
        return <Settings />;
      case RoutePath.WORK_CENTERS:
      case RoutePath.WORK_CENTER_BUYERS:
      case RoutePath.WORK_CENTER_DEPARTMENTS:
      case RoutePath.WORK_CENTER_PROCESS_FLOWS:
        return <WorkCenters />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <RequireRole>
      <Layout>
        {notification && (
          <Toast
            message={notification.message}
            type={notification.type}
            onClose={hideNotification}
          />
        )}
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            {renderContent()}
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </RequireRole>
  );
};

export default App;
