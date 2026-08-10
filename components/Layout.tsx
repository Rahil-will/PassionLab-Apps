import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  PlusCircle,
  Settings,
  X,
  Factory,
  Users,
  LogOut,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Hexagon,
  AlertTriangle,
  Activity,
  GitMerge,
  ArrowLeftRight,
  BarChart3,
  Calendar,
  Shirt,
  Package,
  Building2,
  Menu,
} from 'lucide-react';
import { useNavigationStore, useDataStore } from '../stores';
import { RoutePath } from '../types';
import { Modal, Button } from './ui';
import { Breadcrumb, PageHeaderProvider } from './Breadcrumb';
import { applyScale, tokens } from '../lib/designTokens';
import { buildRouteHash, parseRouteHash } from '../lib/routeHash';
import { logoutDesktopSession } from '../lib/authSession';
import { canAccessRoute } from '../lib/routeAccess';
import { DesktopWriteProvider, DesktopWriteGate } from './DesktopWriteGate';

interface SidebarItemProps {
  id: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  isOpen: boolean;
  onToggle: (id: string) => void;
  onClick?: () => void;
  onNavRequest: (route: RoutePath) => void;
  subItems?: { label: string; route: RoutePath }[];
  collapsed?: boolean;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ id, icon: Icon, label, active, isOpen, onToggle, onClick, onNavRequest, subItems, collapsed = false }) => {
  const { currentRoute } = useNavigationStore();

  const handleNav = (route: RoutePath) => {
    onNavRequest(route);
  };

  const handleClick = () => {
    if (subItems) {
      onToggle(id);
    } else if (onClick) {
      onClick();
    }
  };

  const isChildActive = subItems?.some(item => item.route === currentRoute);
  const isActiveState = active || isChildActive;

  return (
    <div className="mb-1">
      <button
        onClick={handleClick}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group ${isActiveState
            ? 'bg-blue-500 text-white shadow-md'
            : 'text-blue-200 hover:bg-blue-800 hover:text-white'
          }`}
      >
        <div className="flex items-center">
          <Icon size={15} className={`${collapsed ? 'mr-0' : 'mr-2.5'} ${isActiveState ? 'text-white' : 'text-blue-300 group-hover:text-white'}`} />
          <span className={`font-medium text-[10px] ${collapsed ? 'hidden' : ''}`}>{label}</span>
        </div>
        {subItems && !collapsed && (
          isOpen ? <ChevronDown size={12} className={isActiveState ? 'text-white' : 'text-blue-400'} /> : <ChevronRight size={12} className={isActiveState ? 'text-white' : 'text-blue-400'} />
        )}
      </button>

      {subItems && isOpen && !collapsed && (
        <div className="ml-5 mt-1.5 space-y-1.5 border-l-2 border-blue-400/40 pl-3">
          {subItems.map((sub) => {
            const isSubActive = currentRoute === sub.route;
            return (
            <button
              key={sub.route}
              onClick={() => handleNav(sub.route)}
              className={`w-full text-left px-3.5 py-2.5 rounded-lg transition-all text-[10px] ${
                isSubActive
                  ? 'text-white font-semibold bg-blue-500 shadow-lg shadow-blue-900/30 ring-2 ring-blue-300/60'
                  : 'text-blue-200 hover:bg-blue-800/70 hover:text-white'
              }`}
            >
              {sub.label}
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentRoute,
    routeParams,
    navigate,
    requestNavigate,
    clearPendingNavigation,
    pendingNavigation,
    isUnsaved,
    setUnsaved,
    pendingSaveAction,
    userProfile,
    initRouteFromHash,
  } = useNavigationStore();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarWidth = collapsed ? 'lg:w-24' : 'lg:w-52';
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply compact design scale on mount
  useEffect(() => {
    applyScale('compact');
  }, []);

  // Modal state for sidebar navigation / logout
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);

  useEffect(() => {
    if (pendingNavigation) setShowUnsavedModal(true);
  }, [pendingNavigation]);

  const doLogout = () => {
    void logoutDesktopSession();
    navigate(RoutePath.DASHBOARD);
  };

  const toggleMenu = (id: string) => {
    setOpenMenu(prev => prev === id ? null : id);
  };

  const handleNavRequest = (route: RoutePath, params?: Record<string, string>) => {
    setMobileOpen(false);
    if (!requestNavigate(route, params ?? {})) {
      setShowUnsavedModal(true);
    }
  };

  const confirmSaveAndLeave = async () => {
    if (pendingSaveAction) {
      await pendingSaveAction();
    }
    if (useNavigationStore.getState().isUnsaved) return;
    const target = pendingNavigation;
    const loggingOut = pendingLogout;
    setUnsaved(false);
    setShowUnsavedModal(false);
    setPendingLogout(false);
    clearPendingNavigation();
    if (loggingOut) {
      doLogout();
      return;
    }
    if (target) {
      navigate(target.route, target.params);
    }
  };

  const confirmDiscard = () => {
    const target = pendingNavigation;
    const loggingOut = pendingLogout;
    useDataStore.getState().setWipOrder(null);
    setUnsaved(false);
    setShowUnsavedModal(false);
    setPendingLogout(false);
    clearPendingNavigation();
    if (loggingOut) {
      doLogout();
      return;
    }
    if (target) {
      navigate(target.route, target.params);
    }
  };

  const cancelNav = () => {
    setShowUnsavedModal(false);
    setPendingLogout(false);
    clearPendingNavigation();
  };

  const userRole = userProfile?.userRole ?? null;
  const showNav = (route: RoutePath) => canAccessRoute(userRole, route);

  const handleLogout = () => {
    if (isUnsaved) {
      setPendingLogout(true);
      setShowUnsavedModal(true);
      return;
    }
    doLogout();
  };

  // Browser refresh/close protection
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useNavigationStore.getState().isUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Browser back/forward — block when there are unsaved edits
  useEffect(() => {
    const handleHashChange = () => {
      const state = useNavigationStore.getState();
      const target = parseRouteHash(window.location.hash);
      const currentHash = buildRouteHash(state.currentRoute, state.routeParams);
      if (window.location.hash === currentHash) return;

      if (state.isUnsaved) {
        window.location.hash = currentHash;
        if (!state.requestNavigate(target.route as RoutePath, target.params)) {
          setShowUnsavedModal(true);
        }
        return;
      }
      initRouteFromHash();
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [initRouteFromHash]);

  return (
    <div className="flex h-[100dvh] w-full bg-slate-50">
      {/* Sidebar */}
      <aside className={`fixed lg:static top-0 left-0 h-screen lg:h-[calc(100dvh-16px)] w-64 ${sidebarWidth} bg-blue-900 flex flex-col border border-blue-800 shadow-2xl z-50 flex-shrink-0 rounded-none lg:rounded-2xl m-0 lg:m-2 transform transition-all duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        {/* Logo Area - FIXED & NOT SCROLLABLE */}
        <div className={`flex-shrink-0 flex items-center ${collapsed ? 'px-2 py-4 gap-1' : 'px-4 py-4 gap-2.5'} border-b border-blue-800 bg-blue-950/50 rounded-t-2xl`}>
          <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20 flex-shrink-0">
            <Hexagon className="text-white fill-current" size={20} />
          </div>
          <div className={`flex flex-col ${collapsed ? 'hidden' : ''}`}>
            <span className="text-white font-bold text-sm tracking-tight leading-none">PRODIGI</span>
            <span className="text-[8px] uppercase tracking-wider text-blue-300 font-bold mt-1">Factory OS</span>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:flex ml-auto p-1.5 text-blue-300 hover:text-white hover:bg-blue-800 rounded-lg"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden ml-auto p-1.5 text-blue-300 hover:text-white hover:bg-blue-800 rounded-lg"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation - SCROLLABLE */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto no-scrollbar">
          {showNav(RoutePath.DASHBOARD) && (
          <div>
            <p className={`px-2.5 font-bold text-blue-400 uppercase tracking-wider mb-1.5 text-[8px] ${collapsed ? 'hidden' : ''}`}>Main</p>
            <SidebarItem collapsed={collapsed} id="dashboard" icon={LayoutDashboard} label="Dashboard" active={currentRoute === RoutePath.DASHBOARD} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.DASHBOARD)} onNavRequest={handleNavRequest} />
          </div>
          )}

          {(showNav(RoutePath.CREATE_ORDER) || showNav(RoutePath.STATUS_TRACKER) || showNav(RoutePath.FLOOR_DAY) || showNav(RoutePath.ORDER_COMPLETION)) && (
          <div>
            <p className={`px-2.5 font-bold text-blue-400 uppercase tracking-wider mb-1.5 text-[8px] ${collapsed ? 'hidden' : ''}`}>Production</p>
            {showNav(RoutePath.CREATE_ORDER) && (
            <SidebarItem collapsed={collapsed} id="create" icon={PlusCircle} label="Create Order" active={currentRoute === RoutePath.CREATE_ORDER} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.CREATE_ORDER)} onNavRequest={handleNavRequest} />
            )}
            {showNav(RoutePath.STATUS_TRACKER) && (
            <SidebarItem collapsed={collapsed} id="status-tracker" icon={Activity} label="Status Tracker" active={currentRoute === RoutePath.STATUS_TRACKER} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.STATUS_TRACKER)} onNavRequest={handleNavRequest} />
            )}
            {showNav(RoutePath.FLOOR_DAY) && (
            <SidebarItem collapsed={collapsed} id="floor-day" icon={Calendar} label="Floor Day Board" active={currentRoute === RoutePath.FLOOR_DAY} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.FLOOR_DAY)} onNavRequest={handleNavRequest} />
            )}
            {showNav(RoutePath.ORDER_COMPLETION) && (
            <SidebarItem collapsed={collapsed} id="order-completion" icon={Package} label="Order Completion" active={currentRoute === RoutePath.ORDER_COMPLETION} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.ORDER_COMPLETION)} onNavRequest={handleNavRequest} />
            )}
          </div>
          )}

          {(showNav(RoutePath.LINE_ASSIGNMENT) || showNav(RoutePath.DEPT_SCHEDULE) || showNav(RoutePath.TRANSACTION_REPORT)) && (
          <div>
            <p className={`px-2.5 font-bold text-blue-400 uppercase tracking-wider mb-1.5 text-[8px] ${collapsed ? 'hidden' : ''}`}>Planning</p>
            {showNav(RoutePath.LINE_ASSIGNMENT) && (
            <SidebarItem collapsed={collapsed} id="planning-board" icon={Factory} label="Planning Board" active={currentRoute === RoutePath.LINE_ASSIGNMENT || currentRoute.startsWith('#/planning-detail')} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.LINE_ASSIGNMENT)} onNavRequest={handleNavRequest} />
            )}
            {showNav(RoutePath.DEPT_SCHEDULE) && (
            <SidebarItem collapsed={collapsed} id="dept-schedule" icon={GitMerge} label="Dept. Schedule" active={currentRoute === RoutePath.DEPT_SCHEDULE} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.DEPT_SCHEDULE)} onNavRequest={handleNavRequest} />
            )}
            {showNav(RoutePath.TRANSACTION_REPORT) && (
            <SidebarItem collapsed={collapsed} id="transaction-report" icon={ArrowLeftRight} label="Transaction Report" active={currentRoute === RoutePath.TRANSACTION_REPORT} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.TRANSACTION_REPORT)} onNavRequest={handleNavRequest} />
            )}
          </div>
          )}

          {(showNav(RoutePath.REPORTS_DAY) || showNav(RoutePath.REPORTS_STYLE)) && (
          <div>
            <p className={`px-2.5 font-bold text-blue-400 uppercase tracking-wider mb-1.5 text-[8px] ${collapsed ? 'hidden' : ''}`}>Reports</p>
            {showNav(RoutePath.REPORTS_DAY) && (
            <SidebarItem collapsed={collapsed} id="reports-day" icon={Calendar} label="Day Report" active={currentRoute === RoutePath.REPORTS_DAY} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.REPORTS_DAY)} onNavRequest={handleNavRequest} />
            )}
            {showNav(RoutePath.REPORTS_STYLE) && (
            <SidebarItem collapsed={collapsed} id="reports-style" icon={Shirt} label="Style Report" active={currentRoute === RoutePath.REPORTS_STYLE} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.REPORTS_STYLE)} onNavRequest={handleNavRequest} />
            )}
          </div>
          )}

          {(showNav(RoutePath.WORK_CENTERS) || showNav(RoutePath.USER_MANAGEMENT) || showNav(RoutePath.SETTINGS)) && (
          <div>
            <p className={`px-2.5 font-bold text-blue-400 uppercase tracking-wider mb-1.5 text-[8px] ${collapsed ? 'hidden' : ''}`}>Factory Configuration</p>
            {showNav(RoutePath.WORK_CENTERS) && (
            <SidebarItem collapsed={collapsed}
              id="work-centers"
              icon={Building2}
              label="Work Centers"
              active={
                currentRoute === RoutePath.WORK_CENTERS ||
                currentRoute === RoutePath.WORK_CENTER_BUYERS ||
                currentRoute === RoutePath.WORK_CENTER_DEPARTMENTS ||
                currentRoute === RoutePath.WORK_CENTER_PROCESS_FLOWS
              }
              isOpen={false}
              onToggle={() => {}}
              onClick={() => handleNavRequest(RoutePath.WORK_CENTERS)}
              onNavRequest={handleNavRequest}
            />
            )}
            {showNav(RoutePath.USER_MANAGEMENT) && (
            <SidebarItem collapsed={collapsed}
              id="user-management"
              icon={Users}
              label="User Management"
              active={currentRoute === RoutePath.USER_MANAGEMENT || currentRoute === RoutePath.ADMIN}
              isOpen={false}
              onToggle={() => {}}
              onClick={() => handleNavRequest(RoutePath.USER_MANAGEMENT)}
              onNavRequest={handleNavRequest}
            />
            )}
            {showNav(RoutePath.SETTINGS) && (
            <SidebarItem collapsed={collapsed} id="settings" icon={Settings} label="Settings" active={currentRoute === RoutePath.SETTINGS} isOpen={false} onToggle={() => {}} onClick={() => handleNavRequest(RoutePath.SETTINGS)} onNavRequest={handleNavRequest} />
            )}
          </div>
          )}
        </nav>

        {/* User Footer */}
        <div className={`flex-shrink-0 w-full ${collapsed ? 'p-2' : 'p-3'}`}>
          <div className={`w-full border border-blue-800 bg-blue-950/30 rounded-full ${collapsed ? 'px-2 py-2 flex items-center justify-between' : 'px-3 py-2 flex items-center gap-2'}`}>
            
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0">
              {userProfile?.fullName?.charAt(0)?.toUpperCase() || 'U'}
            </div>

            <div className={`flex-1 min-w-0 ${collapsed ? 'hidden' : ''}`}>
              <p className="font-medium text-white truncate text-[10px]">
                {userProfile?.fullName || 'User'}
              </p>
              <p className="text-blue-300 truncate capitalize text-[8px]">
                {userProfile?.userRole || 'Admin'}
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="text-blue-300 hover:text-red-400 transition-colors p-2 hover:bg-blue-800 rounded-lg flex-shrink-0"
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>

          </div>
        </div>  
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-slate-50">
        <div className="flex-1 overflow-auto minimal-scrollbar p-4 relative h-full [overflow-anchor:none]">
          <PageHeaderProvider>
            <div className="flex flex-col">
              {/* Children render first so usePageActions registers before Breadcrumb reads the ref */}
              <div className="order-2">
                <DesktopWriteProvider>{children}</DesktopWriteProvider>
              </div>
              <div className="order-1 flex-shrink-0 flex items-center gap-2 px-0 py-0 lg:px-0">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
                  aria-label="Open navigation"
                >
                  <Menu size={20} />
                </button>
                <div className="flex-1 min-w-0">
                  <Breadcrumb />
                </div>
              </div>
            </div>
          </PageHeaderProvider>
        </div>
      </main>

      {/* GLOBAL UNSAVED CHANGES MODAL */}
      <Modal isOpen={showUnsavedModal} onClose={cancelNav}>
        <div className="relative">
          <button onClick={cancelNav} className="absolute top-4 right-4 text-red-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full">
            <X size={20} />
          </button>

          <div className="flex flex-col items-center p-8 pb-4 text-center">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-amber-50">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xs font-bold text-slate-900 mb-2">Unsaved Changes</h3>
            <p className="text-slate-500 text-[10px] max-w-[260px] leading-relaxed">
              {pendingLogout
                ? 'You have unsaved changes. Save, discard, or cancel to stay signed in.'
                : 'You have unsaved changes. Save, discard, or cancel to stay on this page.'}
            </p>
          </div>

          <div className="p-6 pt-2 flex flex-col gap-3">
            {pendingSaveAction && (
              <DesktopWriteGate>
                <Button onClick={confirmSaveAndLeave} className="w-full shadow-lg shadow-blue-100 py-2.5 text-sm">
                  Save Changes
                </Button>
              </DesktopWriteGate>
            )}
            <Button variant="danger-light" onClick={confirmDiscard} className="w-full text-xs">
              Discard Changes
            </Button>
            <Button variant="secondary" onClick={cancelNav} className="w-full text-xs">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
