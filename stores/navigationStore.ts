import { create } from "zustand";
import { persist } from "zustand/middleware";
import { RoutePath } from "../types";
import { getRouteEntry } from "../lib/routeMap";
import { buildRouteHash, parseRouteHash } from "../lib/routeHash";

// --- NAVIGATION STORE ---
export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  userRole: string;
  /** profiles.assigned_apps — module permission keys (mm_*). Default []. */
  assignedApps: string[];
}

interface RouteHistoryEntry {
  route: RoutePath;
  params: Record<string, string>;
}

interface PendingNavigation {
  route: RoutePath;
  params: Record<string, string>;
}

interface NavigationState {
  currentRoute: RoutePath;
  previousRoute: RoutePath | null;
  routeParams: Record<string, string>;
  routeHistory: RouteHistoryEntry[];
  isUnsaved: boolean;
  isAuthenticated: boolean;
  factoryId: string | null;
  userProfile: UserProfile | null;
  pendingSaveAction: (() => Promise<boolean | void>) | null;
  pendingDiscardAction: (() => void) | null;
  pendingNavigation: PendingNavigation | null;
  navigate: (route: RoutePath, params?: Record<string, string>) => void;
  requestNavigate: (route: RoutePath, params?: Record<string, string>) => boolean;
  clearPendingNavigation: () => void;
  goBack: () => void;
  initRouteFromHash: () => void;
  setUnsaved: (unsaved: boolean) => void;
  setAuthenticated: (status: boolean) => void;
  setFactoryId: (factoryId: string | null) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setPendingSaveAction: (action: (() => Promise<boolean | void>) | null) => void;
  setPendingDiscardAction: (action: (() => void) | null) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      currentRoute: RoutePath.DASHBOARD,
      previousRoute: null,
      routeParams: {},
      routeHistory: [{ route: RoutePath.DASHBOARD, params: {} }],
      isUnsaved: false,
      isAuthenticated: false,
      factoryId: null,
      userProfile: null,
      pendingSaveAction: null,
      pendingDiscardAction: null,
      pendingNavigation: null,
      navigate: (route, params = {}) => {
        // Extract internal flag before storing in routeParams
        const { _preserveHistory, ...cleanParams } = params as Record<string, string> & { _preserveHistory?: string };
        const preserveHistory = _preserveHistory === 'true';
        const hash = buildRouteHash(route, cleanParams);
        if (window.location.hash !== hash) {
          window.location.hash = hash;
        }
        set((state) => {
          // Check if this is a "top-level" sidebar navigation (resets breadcrumb)
          const entry = getRouteEntry(route);
          const isTopLevel = !entry?.parent || entry.parent === RoutePath.DASHBOARD;

          // Check if route already exists in current history trail first.
          // This handles breadcrumb back-navigation correctly regardless of whether
          // the target is "top-level" or not.
          const existingIdx = state.routeHistory.findIndex(h => h.route === route);

          let newHistory: RouteHistoryEntry[];
          if (existingIdx >= 0) {
            // Route already in trail — trim back to it (breadcrumb click / back-nav)
            newHistory = state.routeHistory.slice(0, existingIdx + 1);
            newHistory[existingIdx] = { route, params: cleanParams };
          } else if (isTopLevel && !preserveHistory) {
            // Fresh navigation to a top-level page (sidebar click) — reset history
            newHistory = [{ route: RoutePath.DASHBOARD, params: {} }, { route, params: cleanParams }];
          } else {
            // Going deeper — append
            newHistory = [...state.routeHistory, { route, params: cleanParams }];
          }

          return {
            previousRoute: state.currentRoute,
            currentRoute: route,
            routeParams: cleanParams,
            routeHistory: newHistory.slice(-15), // Keep max 15 entries
          };
        });
      },
      requestNavigate: (route, params = {}) => {
        const state = get();
        if (state.isUnsaved) {
          set({ pendingNavigation: { route, params } });
          return false;
        }
        state.navigate(route, params);
        return true;
      },
      clearPendingNavigation: () => set({ pendingNavigation: null }),
      goBack: () => {
        window.history.back();
      },
      initRouteFromHash: () => {
        const hash = window.location.hash || RoutePath.DASHBOARD;
        const { route, params } = parseRouteHash(hash);
        set({ currentRoute: route as RoutePath, routeParams: params });
      },
      setUnsaved: (unsaved) => {
        if (get().isUnsaved === unsaved) return;
        set({ isUnsaved: unsaved });
      },
      setAuthenticated: (status) => set({ isAuthenticated: status }),
      setFactoryId: (factoryId) => set({ factoryId }),
      setUserProfile: (profile) => set({ userProfile: profile }),
      setPendingSaveAction: (action) => set({ pendingSaveAction: action }),
      setPendingDiscardAction: (action) => set({ pendingDiscardAction: action }),
    }),
    {
      name: "navigation-storage",
      partialize: (state) => ({
        factoryId: state.factoryId,
      }),
    },
  ),
);
