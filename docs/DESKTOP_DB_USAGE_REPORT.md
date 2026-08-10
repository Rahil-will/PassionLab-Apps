# Desktop DB usage report

Read-only reconnaissance of how the **desktop admin SPA** talks to Supabase. No code or schema changes were made in this pass. Enumerated via repository scan of `.ts`/`.tsx` under the app root, excluding `plapps/`, `supabase/`, `node_modules/`, and `dist/`.

Generated: 2026-08-10.

---

## 1. App identification

| Item | Value |
|---|---|
| Root directory | `c:\\Users\\Rahil\\Downloads\\PRODIGI` (repo root = desktop app) |
| Framework | React 19 (`react` ^19.2.3) |
| Build tool | Vite 6 (`vite` ^6.2.0) |
| Language | TypeScript (~5.8.2) |
| Routing | Hash routing (`window.location.hash`) |
| Supabase JS | `@supabase/supabase-js` ^2.106.2 |
| SSR helper package | `@supabase/ssr` ^0.10.3 (`createBrowserClient` only) |
| State | Zustand (mutations / session UI) + TanStack Query (reads) |

### Client construction

| Item | Detail |
|---|---|
| Construction | `utils/supabase/client.ts:7-18` — `createBrowserClient(supabaseUrl, supabaseKey)` |
| Re-export | `lib/supabase.ts` re-exports `createClient` and `supabase` |
| Key used | `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY` — **anon / publishable key only** (no service-role key in the desktop app) |
| Instances | **One singleton** — `export const supabase = createClient()` at module load. `createClient()` is also exported but call sites import the singleton. |
| Session persist | Supabase browser client (via `@supabase/ssr` `createBrowserClient`) manages auth session storage. App additionally persists `factoryId` / `userProfile` / `isAuthenticated` in localStorage key `"navigation-storage"` (`stores/navigationStore.ts:124-130`). |
| Session refresh | No `onAuthStateChange` listener in desktop app code. Boot path: `App.tsx` → `restoreAuthSession()` → `supabase.auth.getSession()` + `get_my_profile`. Token refresh left to the Supabase client internals. |

---

## 2. Auth and identity resolution

### `factory_id`

**Source of truth for the client:** RPC `get_my_profile` → field `factory_id` → Zustand `useNavigationStore.factoryId`.

Code path:

1. Login: `pages/Login.tsx` → `supabase.auth.signInWithPassword` → `fetchMyProfile()` (`lib/authSession.ts:46` `supabase.rpc('get_my_profile')`) → `desktopAccessError(profile)` → `applyAuthenticatedProfile(profile, ...)` (`lib/authSession.ts:85-91`) → `store.setFactoryId(profile.factory_id)`.
2. Cold start: `App.tsx` → `restoreAuthSession()` (`lib/authSession.ts:102-125`) → same `get_my_profile` path.
3. JWT / `app_metadata`: **logged only** in `debugJwtClaims()` (`lib/authSession.ts:63-82`). **Not** written into the store. Not used as the `p_factory_id` argument source.

Gate: `desktopAccessError` rejects missing `factory_id` (`lib/authSession.ts:33-35`).

### `user_role`

Same path: `get_my_profile` → `profile.user_role` → `userProfile.userRole` via `profileToUserProfile` (`lib/authSession.ts:22-28`, default fallback string `'admin'` if falsy).

Desktop login allow-list: `DESKTOP_LOGIN_ROLES = new Set(['admin', 'superadmin', 'viewer'])` (`lib/authSession.ts:4`). Roles outside that set (including `quality_manager`, `operator`, `supervisor`, `auditor`) are rejected at login / restore.

JWT `user_role` / `app_metadata` are debug-logged only.

### Is `factory_id` held in mutable client state a user could alter?

**Yes.**

| Location | Mutable? | Notes |
|---|---|---|
| `useNavigationStore.factoryId` + `setFactoryId` | Yes | `stores/navigationStore.ts:32,43,57,120` |
| localStorage `"navigation-storage"` | Yes | Persists `factoryId` (`navigationStore.ts:125-129`). Editable in DevTools. |
| URL hash / query | No | No `factoryId` route param |
| Factory switcher UI / dropdown | No | Does not exist |
| `selectedFactoryId` / `currentFactoryId` | N/A | Zero matches in desktop TS/TSX |

After login, any console/store/localStorage mutation of `factoryId` is what subsequent RPC/table callers pass as `p_factory_id` / `.eq('factory_id', ...)`. `restoreAuthSession` re-fetches `get_my_profile` and overwrites the store on boot, but **does not** continuously re-validate.

### Factory switcher

**No.** No UI to act against another factory. Login copy states self-service factory creation is unavailable.

### Role-gating helpers

| Helper | Exact definition | Call sites |
|---|---|---|
| `DESKTOP_LOGIN_ROLES` | `new Set(['admin', 'superadmin', 'viewer'])` — `lib/authSession.ts:4` | via `desktopAccessError` |
| `desktopAccessError` | requires `factory_id`, `status === 'Active'`, role ∈ `DESKTOP_LOGIN_ROLES` — `lib/authSession.ts:32-42` | `pages/Login.tsx`; `restoreAuthSession` `lib/authSession.ts:117` |
| `DESKTOP_ADMIN_ROLES` | `['admin', 'superadmin']` — `lib/routeAccess.ts:4` | used by helpers below |
| `DESKTOP_VIEWER_ROLE` | `'viewer'` — `lib/routeAccess.ts:7` | `isDesktopViewerRole` |
| `DESKTOP_APP_ROLES` | admin+superadmin+viewer — `lib/routeAccess.ts:10` | `RequireRole.tsx:5,13` |
| `isDesktopAdminRole` | `role === 'admin' || role === 'superadmin'` — `lib/routeAccess.ts:68-69` | `routeAccess.ts` internals; `lib/ensureSupportDropdowns.ts:3,23` |
| `isDesktopViewerRole` | `role === DESKTOP_VIEWER_ROLE` — `lib/routeAccess.ts:72-73` | `canAccessRoute` only |
| `isDesktopAppRole` | admin || viewer — `lib/routeAccess.ts:76-77` | via `canAccessAppShell` |
| `isDesktopWriteRole` | `isDesktopAdminRole(role)` — `lib/routeAccess.ts:81-82` | **defined, zero external call sites** |
| `rolesForRoute` | `lib/routeAccess.ts:85-89` | **zero call sites** |
| `isKnownAppRoute` | `lib/routeAccess.ts:92-98` | **zero call sites** |
| `canAccessRoute` | admin → `ADMIN_ROUTES`+prefixes; viewer → `VIEWER_ROUTES`+prefixes — `lib/routeAccess.ts:101-111` | `App.tsx`; `components/Layout.tsx` |
| `canAccessAppShell` | `isDesktopAppRole` — `lib/routeAccess.ts:114-115` | `RequireRole.tsx:5,19` |
| `RequireRole` | default roles `DESKTOP_APP_ROLES`; also requires `canAccessAppShell` — `components/RequireRole.tsx:12-19` | `App.tsx` wraps `<Layout>` |
| `canCaptureOnDesktop` | `role === 'admin' || role === 'superadmin' || role === 'quality_manager'` — `lib/floorApps.ts:506-508` | `components/production/OrderCompletionWorkspace.tsx:48,178` (and uses at ~749-750, ~1615-1616) |
| `canSeedSupportDropdowns` (private) | `isDesktopAdminRole(userProfile.userRole)` — `lib/ensureSupportDropdowns.ts:21-23` | `ensureSupportDropdowns` / `ensureSupportDropdownsIfNeeded` |

**Note:** `canCaptureOnDesktop` includes `quality_manager`, but `DESKTOP_LOGIN_ROLES` does **not**, so a `quality_manager` cannot obtain a desktop session through the normal login/restore path.

---

## 3. RPC call inventory

**52** `.rpc(...)` call sites in the desktop app.

**Provenance note:** Where the third column says `fn param factoryId`, callers ultimately pass `useNavigationStore.factoryId` (set from `get_my_profile`.factory_id), unless noted otherwise (entity draft `factory_id` fields, which were themselves seeded from the nav store).

| RPC name | Argument keys passed (exact) | Where `p_factory_id` value comes from | file:line | Screen / feature |
|---|---|---|---|---|
| cutting_component_progress_rows | p_factory_id, p_order_id | fn param factoryId | lib/reports/kpiAndProgress.ts:146 | Reports / KPIs |
| delete_desktop_shipment | p_factory_id, p_shipment_id | fn param factoryId | lib/desktopFulfillment.ts:106 | Desktop fulfillment |
| delete_style_order | p_factory_id, p_order_id | fn param factoryId | lib/styleOrderDb.ts:210 | Style order |
| ensure_department_defects | p_factory_id, p_department_id, p_default_defects | nav store factoryId | stores/settingsStore.ts:1193 | Settings |
| ensure_factory_fabric_components | p_factory_id, p_origin_department_id | fn param factoryId | lib/fabricComponentDb.ts:37 | Fabric components |
| floor_capture | p_factory_id, p_user_id, p_type, p_payload | fn param factoryId | lib/mesCapture.ts:16 | Floor capture |
| get_audit_report | p_factory_id, p_date_from, p_date_to, p_colorway_id, p_order_id, p_department_id | fn param factoryId | lib/reports/styleReport.ts:1271 | Style report |
| get_cut_to_ship_report | p_factory_id, p_date_from, p_date_to, p_buyer_id, p_balanced_only | fn param factoryId | lib/reports/kpiAndProgress.ts:516 | Reports / KPIs |
| get_department_kpis | p_factory_id, p_department_id, p_date_from, p_date_to | fn param factoryId | lib/reports/kpiAndProgress.ts:458 | Reports / KPIs |
| get_department_kpis_by_shift | p_factory_id, p_department_id, p_date_from, p_date_to | fn param factoryId | lib/reports/kpiAndProgress.ts:488 | Reports / KPIs |
| get_factory_production_summary | p_factory_id | fn param factoryId | lib/floorBoardApi.ts:44 | Floor board |
| get_factory_production_summary | p_factory_id | fn param factoryId | lib/orderProgressApi.ts:251 | Order progress |
| get_factory_schedule_actuals | p_factory_id | fn param factoryId | lib/orderProgressApi.ts:337 | Order progress |
| get_handover_report | p_factory_id, p_date_from, p_date_to, p_from_department_id, p_to_department_id, p_status, p_order_id, p_colorway_id, p_search | fn param factoryId | lib/transactionReportApi.ts:561 | Handover report |
| get_my_profile | (none) | N/A — RPC has no p_factory_id | lib/authSession.ts:46 | Auth session |
| get_order_colorway_actuals | p_factory_id, p_order_id, p_colorway_id | fn param factoryId | lib/orderProgressApi.ts:446 | Order progress |
| get_order_dept_progress | p_factory_id, p_order_id, p_colorway_id, p_department_id, p_date | fn param factoryId | lib/orderSizeProgress.ts:210 | Reports / KPIs |
| get_order_detail_bundle | p_factory_id, p_order_id | fn param factoryId | lib/orderDetailBundle.ts:346 | Order progress |
| get_style_kpis | p_factory_id, p_order_id | fn param factoryId | lib/reports/kpiAndProgress.ts:470 | Reports / KPIs |
| log_desktop_rejection | p_factory_id, p_payload | fn param factoryId | lib/desktopFulfillment.ts:81 | Desktop fulfillment |
| log_desktop_shipment | p_factory_id, p_payload | fn param factoryId | lib/desktopFulfillment.ts:42 | Desktop fulfillment |
| operation_progress_rows | p_factory_id, p_order_id | fn param factoryId | lib/reports/kpiAndProgress.ts:115 | Reports / KPIs |
| order_dept_progress_rows | p_factory_id | fn param factoryId | lib/orderProgressApi.ts:292 | Reports / KPIs |
| order_dept_progress_rows | p_factory_id, p_order_id | fn param factoryId | lib/reports/kpiAndProgress.ts:80 | Reports / KPIs |
| replace_floor_user_access | p_profile_id, p_department_id, p_handover_enabled, p_workforce_enabled, p_audit_enabled, p_operation_ids, p_shipment_qa_enabled | N/A — RPC has no p_factory_id | lib/floorUserAccessDb.ts:73 | Floor user access |
| save_buyer | p_action, p_factory_id, p_id, p_name, p_code, p_country, p_type, p_status, p_contact_name, p_contact_email, p_contact_phone, p_contact_role, p_over_shipment_pct, p_under_shipment_pct, p_packing_rule, p_ship_mode, p_destination, p_currency, p_ship_mode_options, p_shipment_type_options, p_destination_countries | buyer draft b.factory_id | stores/settingsStore.ts:571 | Settings |
| save_buyer | p_action, p_factory_id, p_id, p_name, p_code, p_country, p_type, p_status, p_contact_name, p_contact_email, p_contact_phone, p_contact_role, p_over_shipment_pct, p_under_shipment_pct, p_packing_rule, p_ship_mode, p_destination, p_currency, p_ship_mode_options, p_shipment_type_options, p_destination_countries | b.factory_id || nav factoryId | stores/settingsStore.ts:605 | Settings |
| save_buyer | p_action, p_factory_id, p_id | nav store factoryId | stores/settingsStore.ts:638 | Settings |
| save_colorway_planning_remarks | p_factory_id, p_order_id, p_colorway_id, p_remarks | fn param factoryId | lib/settingsRpc.ts:176 | Planning remarks |
| save_department | p_action, p_factory_id, p_id, p_department, p_defects, p_workforce_rates, p_operations | newDept.factory_id | stores/settingsStore.ts:713 | Settings |
| save_department | p_action, p_factory_id, p_id, p_department, p_defects, p_workforce_rates | existing?.factory_id || useNavigationStore.getState().factoryId | stores/settingsStore.ts:812 | Settings |
| save_department | p_action, p_factory_id, p_id | dept?.factory_id || useNavigationStore.getState().factoryId | stores/settingsStore.ts:875 | Settings |
| save_fabric_components | p_factory_id, p_origin_department_id, p_rows, p_delete_ids | fn param factoryId | lib/settingsRpc.ts:132 | Settings |
| save_factory_settings | p_factory_id, p_name, p_code, p_country, p_timezone, p_default_shift_id, p_transaction_apps, p_production_apps, p_workforce_apps, p_audit_apps, p_shipment_apps | fn param factoryId | lib/settingsRpc.ts:100 | Settings |
| save_line_plan | p_factory_id, p_order_id, p_colorway_plans | fn param factoryId | lib/saveLinePlan.ts:41 | Line planning |
| save_operation | p_action, p_factory_id, p_id, p_department_id, p_name, p_step_type, p_capture_app | fn param factoryId | lib/settingsRpc.ts:155 | Settings |
| save_order_routing | p_factory_id, p_order_id, p_steps | fn param factoryId | lib/colorwayRouting.ts:72 | Order routing |
| save_process_flow | p_action, p_factory_id, p_id, p_name, p_description, p_steps | local factory_id var | stores/settingsStore.ts:992 | Settings |
| save_process_flow | p_action, p_factory_id, p_old_id, p_id, p_name, p_description, p_steps | newFlow.factory_id | stores/settingsStore.ts:1015 | Settings |
| save_process_flow | p_action, p_factory_id, p_id, p_name, p_description, p_steps | local factory_id var | stores/settingsStore.ts:1039 | Settings |
| save_process_flow | p_action, p_factory_id, p_id | local factory_id var | stores/settingsStore.ts:1063 | Settings |
| save_resource | p_action, p_factory_id, p_id, p_department_id, p_resource_name, p_resource_type, p_capacity, p_status, p_description | fn param factoryId | lib/departmentResourceSync.ts:58 | Dept resources |
| save_resource | p_action, p_factory_id, p_id, p_department_id, p_resource_name, p_resource_type, p_capacity, p_status, p_description | fn param factoryId | lib/departmentResourceSync.ts:75 | Dept resources |
| save_resource | p_action, p_factory_id, p_id, p_department_id, p_resource_name, p_resource_type, p_capacity, p_status, p_description | fn param factoryId | lib/settingsRpc.ts:31 | Settings |
| save_shift | p_action, p_factory_id, p_id, p_name, p_type, p_start_time, p_end_time, p_break_start, p_break_end, p_hours | sh.factory_id || nav factoryId | stores/settingsStore.ts:901 | Settings |
| save_shift | p_action, p_factory_id, p_id, p_name, p_type, p_start_time, p_end_time, p_break_start, p_break_end, p_hours | sh.factory_id || nav factoryId | stores/settingsStore.ts:934 | Settings |
| save_shift | p_action, p_factory_id, p_id | nav store factoryId | stores/settingsStore.ts:967 | Settings |
| save_size_group | p_action, p_factory_id, p_id, p_name, p_buyer_id, p_sizes | g.factory_id || nav factoryId | stores/settingsStore.ts:1134 | Settings |
| save_size_group | p_action, p_factory_id, p_id, p_name, p_buyer_id, p_sizes | g.factory_id || nav factoryId | stores/settingsStore.ts:1152 | Settings |
| save_size_group | p_action, p_factory_id, p_id | nav store factoryId | stores/settingsStore.ts:1170 | Settings |
| save_style_order | p_factory_id, p_order, p_colorways | fn param factoryId | lib/saveStyleOrder.ts:57 | Style order |
| save_support_dropdown | p_action, p_factory_id, p_id, p_category, p_app_name, p_values | fn param factoryId | lib/settingsRpc.ts:61 | Settings |

---

## 4. Direct table access inventory

**189** table `.from('<table>')` call sites below (plus **4** view reads inventoried in §5; **193** total `.from` hits). **All are `select`.** Zero query-builder `.insert` / `.update` / `.upsert` / `.delete` in desktop `lib/`, `stores/`, `pages/`, `components/`, `hooks/`.

Columns written = `—` for every row (reads only).

For `factories` rows, `.eq('factory_id', ...)` is **not** applied; both use `.eq('id', factoryId)` instead (cell text: `factory_id_eq=no, id_eq=yes`).

| Table | Operation | Columns written | Is `.eq('factory_id', ...)` applied? | Source of that value | file:line | Screen |
|---|---|---|---|---|---|---|
| app_configuration | select | — | yes | factoryId | lib/operationsDb.ts:196 | Operations DB |
| assigned_resources | select | — | yes | factoryId | lib/queries/resources.ts:27 | Assigned resources |
| assigned_resources | select | — | yes | factoryId | lib/reports/reportMeta.ts:95 | Report metadata |
| assigned_resources | select | — | yes | factoryId | lib/reports/styleReport.ts:402 | Style report |
| assigned_resources | select | — | yes | factoryId | lib/reports/styleReport.ts:1833 | Style report |
| assigned_resources | select | — | no | N/A | lib/transactionReportApi.ts:449 | Transaction report |
| assigned_resources | select | — | yes | factoryId | stores/settingsStore.ts:336 | Settings |
| audit_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:706 | Style report |
| batch_production | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1012 | Routing usage check |
| batch_production | select | — | yes | factoryId | lib/orderProgressApi.ts:95 | Order progress |
| batch_production | select | — | yes | factoryId | lib/orderProgressApi.ts:369 | Order progress |
| batch_production | select | — | yes | factoryId | lib/orderSizeProgress.ts:259 | Size progress |
| batch_production | select | — | yes | factoryId | lib/orderSizeProgress.ts:492 | Size progress |
| batch_production | select | — | yes | factoryId | lib/reports/dayReport.ts:1869 | Day report |
| batch_production | select | — | yes | factoryId | lib/reports/styleReport.ts:370 | Style report |
| batch_production | select | — | yes | factoryId | lib/reports/styleReport.ts:1481 | Style report |
| batch_production | select | — | yes | factoryId | lib/reports/styleReport.ts:1903 | Style report |
| buyers | select | — | yes | factoryId | lib/reports/reportMeta.ts:93 | Report metadata |
| buyers | select | — | yes | factoryId | lib/settingsTableFetchers.ts:156 | Settings |
| colorways | select | — | yes | factoryId | lib/colorwayCompletionMap.ts:29 | Colorway completion |
| colorways | select | — | yes | factoryId | lib/orderFormQueries.ts:93 | Order form |
| colorways | select | — | no | N/A | lib/orderSizeProgress.ts:109 | Size progress |
| colorways | select | — | yes | factoryId | lib/orderSizeProgress.ts:293 | Size progress |
| colorways | select | — | yes | factoryId | lib/orderSizeProgress.ts:529 | Size progress |
| colorways | select | — | yes | factoryId | lib/queries/factoryOrders.ts:74 | Orders enrich |
| colorways | select | — | yes | factoryId | lib/queries/planningDetail.ts:38 | Planning detail |
| colorways | select | — | no | N/A | lib/reloadOrderFromDb.ts:21 | Reload order |
| colorways | select | — | no | N/A | lib/reports/reportMeta.ts:49 | Report metadata |
| colorways | select | — | no | N/A | lib/reports/styleReport.ts:293 | Style report |
| colorways | select | — | no | N/A | lib/reports/styleReport.ts:1410 | Style report |
| colorways | select | — | no | N/A | lib/transactionReportApi.ts:377 | Transaction report |
| cutting_bundles | select | — | yes | factoryId | hooks/useOrderCutFabricByRoute.ts:70 | Cut fabric by route |
| cutting_bundles | select | — | yes | factoryId | lib/ganttFabricActuals.ts:57 | Gantt fabric actuals |
| cutting_bundles | select | — | yes | factoryId | lib/ganttFabricActuals.ts:131 | Gantt fabric actuals |
| cutting_bundles | select | — | yes | factoryId | lib/orderProgressApi.ts:99 | Order progress |
| cutting_bundles | select | — | yes | factoryId | lib/orderSizeProgress.ts:265 | Size progress |
| cutting_bundles | select | — | yes | factoryId | lib/orderSizeProgress.ts:498 | Size progress |
| cutting_bundles | select | — | yes | factoryId | lib/reports/dayReport.ts:1272 | Day report |
| cutting_bundles | select | — | yes | factoryId | lib/reports/dayReport.ts:1295 | Day report |
| cutting_bundles | select | — | yes | factoryId | lib/reports/dayReport.ts:1459 | Day report |
| cutting_bundles | select | — | yes | factoryId | lib/reports/dayReport.ts:1526 | Day report |
| cutting_bundles | select | — | yes | factoryId | lib/reports/styleReport.ts:1472 | Style report |
| cutting_lays | select | — | yes | factoryId | lib/reports/dayReport.ts:1227 | Day report |
| cutting_lays | select | — | yes | factoryId | lib/reports/dayReport.ts:1418 | Day report |
| cutting_lays | select | — | yes | factoryId | lib/reports/dayReport.ts:1531 | Day report |
| cutting_sessions | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1026 | Routing usage check |
| cutting_sessions | select | — | yes | factoryId | hooks/useOrderCutFabricByRoute.ts:75 | Cut fabric by route |
| cutting_sessions | select | — | yes | factoryId | lib/ganttFabricActuals.ts:62 | Gantt fabric actuals |
| cutting_sessions | select | — | yes | factoryId | lib/ganttFabricActuals.ts:136 | Gantt fabric actuals |
| cutting_sessions | select | — | yes | factoryId | lib/orderProgressApi.ts:83 | Order progress |
| cutting_sessions | select | — | yes | factoryId | lib/orderSizeProgress.ts:271 | Size progress |
| cutting_sessions | select | — | yes | factoryId | lib/orderSizeProgress.ts:504 | Size progress |
| cutting_sessions | select | — | yes | factoryId | lib/reports/dayReport.ts:1326 | Day report |
| cutting_sessions | select | — | no | N/A | lib/reports/dayReport.ts:1432 | Day report |
| cutting_sessions | select | — | yes | factoryId | lib/reports/dayReport.ts:1512 | Day report |
| cutting_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:1461 | Style report |
| defects | select | — | yes | factoryId | lib/settingsTableFetchers.ts:236 | Settings |
| department_workforce_rates | select | — | no | N/A | lib/departmentWorkforceRates.ts:62 | Workforce rates |
| department_workforce_rates | select | — | yes | factoryId | lib/departmentWorkforceRates.ts:83 | Workforce rates |
| department_workforce_rates | select | — | yes | factoryId | lib/settingsTableFetchers.ts:139 | Settings |
| department_workforce_rates | select | — | yes | factoryId | lib/settingsTableFetchers.ts:336 | Settings |
| departments | select | — | yes | factoryId | lib/orderFlowMetrics.ts:128 | Order flow metrics |
| departments | select | — | yes | factoryId | lib/orderProgressApi.ts:75 | Order progress |
| departments | select | — | yes | factoryId | lib/orderProgressApi.ts:273 | Order progress |
| departments | select | — | yes | factoryId | lib/reports/reportMeta.ts:75 | Report metadata |
| departments | select | — | yes | factoryId | lib/reports/reportMeta.ts:81 | Report metadata |
| departments | select | — | yes | factoryId | lib/reports/styleReport.ts:299 | Style report |
| departments | select | — | yes | factoryId | lib/settingsTableFetchers.ts:167 | Settings |
| departments | select | — | no | N/A | lib/transactionReportApi.ts:379 | Transaction report |
| fabric_components | select | — | yes | factoryId | hooks/useOrderCutFabricByRoute.ts:80 | Cut fabric by route |
| fabric_components | select | — | yes | factoryId | lib/fabricComponentDb.ts:24 | Fabric components |
| fabric_components | select | — | yes | factoryId | lib/ganttFabricActuals.ts:67 | Gantt fabric actuals |
| fabric_components | select | — | yes | factoryId | lib/ganttFabricActuals.ts:141 | Gantt fabric actuals |
| fabric_components | select | — | yes | factoryId | lib/orderProgressApi.ts:77 | Order progress |
| fabric_components | select | — | yes | factoryId | lib/orderSizeProgress.ts:287 | Size progress |
| fabric_components | select | — | yes | factoryId | lib/orderSizeProgress.ts:523 | Size progress |
| fabric_components | select | — | yes | factoryId | lib/reports/dayReport.ts:1536 | Day report |
| fabric_components | select | — | yes | factoryId | lib/reports/dayReport.ts:1696 | Day report |
| fabric_components | select | — | yes | factoryId | lib/settingsTableFetchers.ts:249 | Settings |
| factories | select | — | factory_id_eq=no, id_eq=yes | factoryId | lib/settingsTableFetchers.ts:284 | Factory settings |
| factories | select | — | factory_id_eq=no, id_eq=yes | factoryId | pages/production/CreateOrderMaster.tsx:243 | Create order code |
| floor_user_access | select | — | yes | factoryId | lib/floorUserAccessDb.ts:33 | Floor user access |
| floor_user_access | select | — | no | N/A | lib/floorUserAccessDb.ts:53 | Floor user access |
| floor_user_access | select | — | yes | factoryId | lib/floorUserAccessDb.ts:125 | Floor user access |
| handover_slips | select | — | yes | factoryId | components/production/OrderCompletionWorkspace.tsx:459 | Order completion |
| handover_slips | select | — | yes | factoryId | lib/transactionReportApi.ts:337 | Transaction report |
| hourly_counts | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1000 | Routing usage check |
| hourly_counts | select | — | yes | factoryId | lib/dashboardData.ts:133 | Dashboard |
| hourly_counts | select | — | yes | factoryId | lib/orderProgressApi.ts:87 | Order progress |
| hourly_counts | select | — | yes | factoryId | lib/orderProgressApi.ts:359 | Order progress |
| hourly_counts | select | — | yes | factoryId | lib/orderSizeProgress.ts:80 | Size progress |
| hourly_counts | select | — | yes | factoryId | lib/orderSizeProgress.ts:247 | Size progress |
| hourly_counts | select | — | yes | factoryId | lib/orderSizeProgress.ts:480 | Size progress |
| hourly_counts | select | — | yes | factoryId | lib/reports/dayReport.ts:69 | Day report |
| hourly_counts | select | — | yes | factoryId | lib/reports/dayReport.ts:2149 | Day report |
| hourly_counts | select | — | yes | factoryId | lib/reports/dayReport.ts:2682 | Day report |
| hourly_counts | select | — | yes | factoryId | lib/reports/styleReport.ts:363 | Style report |
| hourly_counts | select | — | yes | factoryId | lib/reports/styleReport.ts:1426 | Style report |
| hourly_counts | select | — | yes | factoryId | lib/reports/styleReport.ts:1879 | Style report |
| inspection_sessions | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1006 | Routing usage check |
| inspection_sessions | select | — | yes | factoryId | lib/orderProgressApi.ts:91 | Order progress |
| inspection_sessions | select | — | yes | factoryId | lib/orderProgressApi.ts:364 | Order progress |
| inspection_sessions | select | — | yes | factoryId | lib/orderSizeProgress.ts:87 | Size progress |
| inspection_sessions | select | — | yes | factoryId | lib/orderSizeProgress.ts:253 | Size progress |
| inspection_sessions | select | — | yes | factoryId | lib/orderSizeProgress.ts:486 | Size progress |
| inspection_sessions | select | — | yes | factoryId | lib/reports/dayReport.ts:2140 | Day report |
| inspection_sessions | select | — | yes | factoryId | lib/reports/dayReport.ts:2162 | Day report |
| inspection_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:1098 | Style report |
| inspection_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:1126 | Style report |
| inspection_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:1144 | Style report |
| inspection_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:1435 | Style report |
| inspection_sessions | select | — | yes | factoryId | lib/reports/styleReport.ts:1890 | Style report |
| line_allocations | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1038 | Routing usage check |
| line_allocations | select | — | yes | factoryId! | hooks/useOrderAllocations.ts:52 | Order allocations |
| line_allocations | select | — | yes | factoryId | lib/queries/factoryOrders.ts:134 | Orders enrich |
| line_allocations | select | — | yes | factoryId | lib/queries/factoryOrders.ts:147 | Orders enrich |
| line_allocations | select | — | yes | factoryId | lib/queries/ganttScheduleWindow.ts:61 | Gantt schedule |
| line_allocations | select | — | yes | factoryId | lib/reloadOrderFromDb.ts:60 | Reload order |
| line_allocations | select | — | yes | factoryId | lib/reports/dayReport.ts:560 | Day report |
| line_allocations | select | — | yes | factoryId | lib/reports/dayReport.ts:569 | Day report |
| line_allocations | select | — | yes | factoryId | lib/reports/styleReport.ts:351 | Style report |
| line_allocations | select | — | yes | factoryId | lib/reports/styleReport.ts:1452 | Style report |
| line_allocations | select | — | no | N/A | lib/transactionReportApi.ts:394 | Transaction report |
| operations | select | — | yes | factoryId | lib/operationsDb.ts:43 | Operations DB |
| operations | select | — | yes | factoryId | lib/operationsDb.ts:60 | Operations DB |
| operations | select | — | yes | factoryId | lib/operationsDb.ts:74 | Operations DB |
| operations | select | — | yes | factoryId | lib/operationsDb.ts:146 | Operations DB |
| operations | select | — | yes | factoryId | lib/reports/reportMeta.ts:101 | Report metadata |
| operations | select | — | yes | factoryId | lib/settingsTableFetchers.ts:262 | Settings |
| operations | select | — | yes | factoryId | stores/settingsStore.ts:1238 | Settings |
| order_delivery_targets | select | — | yes | factoryId | lib/queries/factoryOrders.ts:76 | Orders enrich |
| order_delivery_targets | select | — | yes | factoryId | lib/reloadOrderFromDb.ts:23 | Reload order |
| order_delivery_targets | select | — | no | N/A | lib/reports/styleReport.ts:302 | Style report |
| order_routing_steps | select | — | yes | factoryId | lib/floorBoardApi.ts:74 | Floor board |
| order_routing_steps | select | — | yes | factoryId | lib/orderProgressApi.ts:72 | Order progress |
| order_routing_steps | select | — | no | N/A | lib/orderRoutingEditor.ts:282 | Routing editor load |
| order_routing_steps | select | — | yes | factoryId | lib/orderSizeProgress.ts:282 | Size progress |
| order_routing_steps | select | — | yes | factoryId | lib/queries/factoryOrders.ts:81 | Orders enrich |
| order_routing_steps | select | — | yes | factoryId | lib/reloadOrderFromDb.ts:28 | Reload order |
| order_routing_steps | select | — | yes | factoryId | lib/reports/dayReport.ts:897 | Day report |
| order_routing_steps | select | — | no | N/A | lib/reports/styleReport.ts:1497 | Style report |
| order_routing_steps | select | — | no | N/A | lib/transactionReportApi.ts:387 | Transaction report |
| outsource_work_movements | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1018 | Routing usage check |
| outsource_work_movements | select | — | yes | factoryId | lib/orderProgressApi.ts:374 | Order progress |
| outsource_work_movements | select | — | yes | factoryId | lib/orderSizeProgress.ts:515 | Size progress |
| outsource_work_movements | select | — | yes | factoryId | lib/reports/dayReport.ts:1738 | Day report |
| outsource_work_movements | select | — | yes | factoryId | lib/reports/styleReport.ts:1792 | Style report |
| process_flows | select | — | yes | factoryId | lib/settingsTableFetchers.ts:194 | Settings |
| profiles | select | — | no | N/A | lib/transactionReportApi.ts:381 | Transaction report |
| profiles | select | — | yes | factoryId | pages/system/UserManagement.tsx:199 | User management |
| rejections | select | — | yes | factoryId | lib/reports/styleReport.ts:387 | Style report |
| shifts | select | — | yes | factoryId | lib/reports/dayReport.ts:1991 | Day report |
| shifts | select | — | yes | factoryId | lib/reports/dayReport.ts:2168 | Day report |
| shifts | select | — | yes | factoryId | lib/reports/styleReport.ts:1492 | Style report |
| shifts | select | — | yes | factoryId | lib/reports/styleReport.ts:1923 | Style report |
| shifts | select | — | yes | factoryId | lib/settingsTableFetchers.ts:183 | Settings |
| shifts | select | — | yes | factoryId | lib/transactionReportApi.ts:383 | Transaction report |
| shifts | select | — | yes | newDept.factory_id | stores/settingsStore.ts:683 | Settings |
| shipment_audits | select | — | yes | factoryId | lib/reports/styleReport.ts:888 | Style report |
| shipment_audits | select | — | yes | factoryId | lib/reports/styleReport.ts:902 | Style report |
| shipments | select | — | yes | factoryId | components/planning/OrderRoutingEditor.tsx:1032 | Routing usage check |
| shipments | select | — | yes | factoryId | lib/orderProgressApi.ts:103 | Order progress |
| shipments | select | — | yes | factoryId | lib/orderSizeProgress.ts:276 | Size progress |
| shipments | select | — | yes | factoryId | lib/orderSizeProgress.ts:509 | Size progress |
| shipments | select | — | yes | factoryId | lib/reports/dayReport.ts:1624 | Day report |
| shipments | select | — | yes | factoryId | lib/reports/styleReport.ts:377 | Style report |
| size_groups | select | — | yes | factoryId | lib/settingsTableFetchers.ts:213 | Settings |
| style_orders | select | — | yes | factoryId | hooks/useOrdersList.ts:49 | Orders list |
| style_orders | select | — | yes | factoryId | lib/buyerOrderCount.ts:10 | Buyer order count |
| style_orders | select | — | yes | factoryId | lib/orderFormQueries.ts:8 | Order form |
| style_orders | select | — | yes | factoryId | lib/orderFormQueries.ts:38 | Order form |
| style_orders | select | — | yes | factoryId | lib/orderFormQueries.ts:76 | Order form |
| style_orders | select | — | yes | factoryId | lib/queries/factoryOrders.ts:48 | Orders enrich |
| style_orders | select | — | yes | factoryId | lib/queries/factoryOrders.ts:73 | Orders enrich |
| style_orders | select | — | yes | factoryId | lib/queries/planningDetail.ts:33 | Planning detail |
| style_orders | select | — | yes | factoryId | lib/reloadOrderFromDb.ts:16 | Reload order |
| style_orders | select | — | yes | factoryId | lib/reports/dayReport.ts:2262 | Day report |
| style_orders | select | — | yes | factoryId | lib/reports/reportMeta.ts:39 | Report metadata |
| style_orders | select | — | yes | factoryId | lib/reports/reportMeta.ts:89 | Report metadata |
| style_orders | select | — | yes | factoryId | lib/reports/styleReport.ts:282 | Style report |
| style_orders | select | — | no | N/A | lib/transactionReportApi.ts:375 | Transaction report |
| support_dropdowns | select | — | yes | factoryId | lib/ensureSupportDropdowns.ts:28 | Support dropdowns |
| support_dropdowns | select | — | yes | factoryId | lib/ensureSupportDropdowns.ts:55 | Support dropdowns |
| support_dropdowns | select | — | yes | factoryId | lib/ensureSupportDropdowns.ts:107 | Support dropdowns |
| support_dropdowns | select | — | yes | factoryId | lib/settingsTableFetchers.ts:224 | Settings |
| workforce_logs | select | — | yes | factoryId | lib/reports/dayReport.ts:1993 | Day report |
| workforce_logs | select | — | yes | factoryId | lib/reports/dayReport.ts:2170 | Day report |
| workforce_logs | select | — | yes | factoryId | lib/reports/styleReport.ts:1446 | Style report |
| workforce_logs | select | — | yes | factoryId | lib/reports/styleReport.ts:1914 | Style report |

---

## 5. View access inventory

| View | Operation | Columns written | Is `.eq('factory_id', ...)` applied? | Source of that value | file:line | Screen |
|---|---|---|---|---|---|---|
| v_daily_audit | select | — | yes | factoryId | lib/reports/styleReport.ts:776 | Style report |
| v_daily_quality | select | — | yes | factoryId | lib/reports/styleReport.ts:1210 | Style report |
| v_day_floor_board | select | — | yes | factoryId | lib/floorBoardApi.ts:39 | Floor board |
| v_department_kpis_by_shift | select | — | yes | factoryId | lib/reports/kpiAndProgress.ts:327 | KPI progress (`queryShiftKpiViewRows`) |

### `v_department_progress`

**Not queried anywhere** in the desktop app (no `.from('v_department_progress')`). Progress reads use RPCs `order_dept_progress_rows` / `get_order_dept_progress` instead.

---

## 6. Direct writes that have an RPC available

Phase 3 targets from `docs/SCHEMA_CHANGES_PLAN.md` (table names / RPC names as requested; live RPC for fabric is `save_fabric_components` plural).

| File | Table | RPC that exists on live | Current behaviour |
|---|---|---|---|
| `lib/fabricComponentDb.ts` | `fabric_components` | `save_fabric_components` | **RPC for writes** (`saveFabricComponentsRpc` → `save_fabric_components`). Also calls `ensure_factory_fabric_components`. Direct `.from('fabric_components')` is **select only** (`:24`). |
| `stores/dataStore.ts` | `colorways` | `save_colorway_planning_remarks` | **RPC only** via `saveColorwayPlanningRemarksRpc` (`dataStore.ts:240`). No direct `.from('colorways')` write. |
| `stores/settingsStore.ts` | `factories` | `save_factory_settings` | **RPC only** via `saveFactorySettingsRpc` in `updateFactory` (`settingsStore.ts:549-553`). No direct factories write. |
| `lib/operationsDb.ts` | `operations` | `save_operation` | **RPC for writes** (`saveOperationRpc` via `upsertOperation` / `archiveOperation`). Direct `.from('operations')` is **select only**. |
| `lib/ensureSupportDropdowns.ts` | `support_dropdowns` | `save_support_dropdown` | **RPC for writes** (`saveSupportDropdownRpc`). Direct `.from('support_dropdowns')` is **select only**. |

---

## 7. Error handling on permission failure

### Write paths — UI behaviour

| Path | On Postgrest/RPC transport error | Swallows? |
|---|---|---|
| Settings save_* in `settingsStore` / Work Centers | throw → page catch → toast | No (store updates after success) |
| `settingsRpc.ts` save_* wrappers | `if (error) throw error` | No at wrapper; **does not** inspect jsonb `data.error` (see below) |
| `save_style_order` / `delete_style_order` / `save_line_plan` / `save_order_routing` | throw → UI toast | No |
| `log_desktop_shipment` / `log_desktop_rejection` / `delete_desktop_shipment` | throws `MesCaptureError` after `parseRpcResult` | No — `OrderCompletionWorkspace` sets inline `saveError` |
| `ensure_department_defects` | if message includes `not authorized` → `return false` (`settingsStore.ts:1199-1200`) | **YES** — silent; DefectsEditor gets empty/default path, no toast |
| `ensureSupportDropdowns` | `isRlsError` (`42501` / `403` / message contains `row-level security`) → `return` (`ensureSupportDropdowns.ts:34,60,76,96,112`) | **YES** — silent skip of seed/cleanup |
| `save_colorway_planning_remarks` | throw from RPC wrapper | Partial — SummaryModal shows per-field error state; optimistic local text can remain in the input |

### jsonb `{ error, code }` on HTTP 200 — call sites that do **not** inspect `data.error`

These check only the Postgrest `error` object (or ignore `data`):

| file:line | RPC |
|---|---|
| `lib/settingsRpc.ts:31` | `save_resource` |
| `lib/settingsRpc.ts:61` | `save_support_dropdown` |
| `lib/settingsRpc.ts:100` | `save_factory_settings` |
| `lib/settingsRpc.ts:132` | `save_fabric_components` |
| `lib/settingsRpc.ts:155` | `save_operation` |
| `lib/settingsRpc.ts:176` | `save_colorway_planning_remarks` |
| `lib/departmentResourceSync.ts:58` | `save_resource` (delete) |
| `lib/departmentResourceSync.ts:75` | `save_resource` (insert/update) |
| `stores/settingsStore.ts:571,605,638` | `save_buyer` |
| `stores/settingsStore.ts:713,812,875` | `save_department` |
| `stores/settingsStore.ts:901,934,967` | `save_shift` |
| `stores/settingsStore.ts:992,1015,1039,1063` | `save_process_flow` |
| `stores/settingsStore.ts:1134,1152,1170` | `save_size_group` |
| `stores/settingsStore.ts:1193` | `ensure_department_defects` |
| `lib/saveStyleOrder.ts:57` | `save_style_order` (checks `typeof data === 'string'` only) |
| `lib/saveLinePlan.ts:41` | `save_line_plan` |
| `lib/colorwayRouting.ts:72` | `save_order_routing` |
| `lib/styleOrderDb.ts:210` | `delete_style_order` |
| `lib/fabricComponentDb.ts:37` | `ensure_factory_fabric_components` |
| `lib/floorUserAccessDb.ts:73` | `replace_floor_user_access` |

Sites that **do** inspect returned body `error`:

| file:line | RPC |
|---|---|
| `lib/desktopFulfillment.ts:4-13,61,99,111` | `log_desktop_shipment`, `log_desktop_rejection`, `delete_desktop_shipment` via `parseRpcResult` |
| `lib/mesCapture.ts:24-30` | `floor_capture` (dead on desktop — no importers) |
| `lib/orderDetailBundle.ts:351` | `get_order_detail_bundle` |

---

## 8. Dead and mismatched references

Cross-check vs the appendix live inventory supplied with this task.

### RPCs called in desktop code vs live

| Finding | Detail |
|---|---|
| Named write/read RPCs used by the desktop match live catalogs in the task appendix / `docs/SCHEMA_CHANGES_PLAN.md` verify list for the functions listed in §3. | — |
| `floor_capture` | Present in code (`lib/mesCapture.ts:16`) but **no desktop importer** — dead on desktop. |
| `replace_floor_user_access` | Defined at `lib/floorUserAccessDb.ts:73`; User Management UI does **not** call it (Edge Functions do). Library still contains the call site. |
| `get_department_kpis_by_shift` | Call site exists (`lib/reports/kpiAndProgress.ts:488`) inside `fetchDepartmentKpisByShift`, but **`fetchDepartmentKpisByShift` has zero callers** — dead export. Day reports call `fetchDepartmentKpis` instead (view-first). |
| `log_outsource_work_movement` | **Not called** from desktop code. Overload ambiguity (16-arg vs 17-arg) is **N/A** for this app. |
| `auto_reject_missing_pcs`, `seed_factory_app_configuration`, `seed_factory_native_departments`, `next_internal_order_no`, `get_floor_bootstrap` | **Not called** from desktop. |

### Argument-name mismatches (code vs appendix)

No desktop call was found that invents a `p_*` key absent from the known live `save_*` / desktop fulfillment / report RPC shapes used above. Full live parameter catalogs for every report RPC were not re-queried in this pass beyond the task appendix; mark unknown signatures as **UNKNOWN** if a future live `\\df` dump disagrees.

`docs/SCHEMA_CHANGES_PLAN.md` Appendix A still says `save_support_dropdown` is **Missing** in one place, while another section of the same doc marks it OK — that doc is stale relative to code + the task appendix (live has `save_support_dropdown` and it **does** validate `p_factory_id`).

Phase 3 plan text still says `save_fabric_component` (singular); code and live use `save_fabric_components` (plural).

### Tables / views

| Name | In desktop code? | On live (per appendix / plan) |
|---|---|---|
| All tables in §4 | yes | exist in live 40-table inventory (plan) |
| `v_department_progress` | **not queried** | exists; **no SELECT grant** to authenticated — would fail if called |
| `v_department_kpis_by_shift` | **queried** | exists; `security_invoker` **not** set; SELECT granted to authenticated; bypasses RLS |

### Migration file check (appendix note)

`supabase/migrations/20260808123335_floor_login_verify_volatile.sql` — **exists** locally.

Local migration files (excluding `_archived/`, `current/`): baseline `20260731143000` plus 10 incrementals including `20260808123335` and `20260810120000`.

---

## 9. Screen to data map

Role gate: **A** = admin/superadmin only; **V** = admin+viewer; shell = `RequireRole` + `canAccessRoute`.

| Screen / route | Tables / views | RPCs | Role gate |
|---|---|---|---|
| Login | — | `get_my_profile` | unauthenticated |
| Dashboard `#/dashboard` | `hourly_counts`; settings/catalog selects via queries | `get_cut_to_ship_report`, KPI helpers | V |
| Create Order `#/create-order` | `style_orders`, `colorways`, `factories` (code) | `save_style_order`, `delete_style_order` | A |
| Status Tracker `#/status-tracker` | `style_orders` + enrich tables via factoryOrders / progress fallbacks | `get_factory_production_summary`, `order_dept_progress_rows`, … | V |
| Floor Day `#/floor-day` | `v_day_floor_board`, `order_routing_steps` | `get_factory_production_summary` | V |
| Style Details `#/style-details/:id` | many via size/progress/gantt libs | `get_order_detail_bundle`, `get_order_colorway_actuals`, … | V |
| Style Color Details | same family | same | V |
| Order Completion `#/production/order-completion` | `handover_slips` + report meta | `log_desktop_shipment`, `log_desktop_rejection`, `delete_desktop_shipment`, `get_cut_to_ship_report`, `get_order_detail_bundle` | V (writes: `canCaptureOnDesktop`) |
| Reports landing | meta catalogs | — | V |
| Day / Department report | `dayReport` tables + `v_department_kpis_by_shift` (via `fetchDepartmentKpis`) | `get_department_kpis` (fallback), cut-to-ship/style KPIs as used | V |
| Style Report | large `styleReport` table set + `v_daily_audit`, `v_daily_quality` | `get_audit_report`, progress RPCs, `get_style_kpis` | V |
| Planning Board `#/line-assignment` | orders list / enrich | production summary family | V |
| Planning Detail `#/planning-detail` | planningDetail selects; routing lock tables | `save_line_plan`, `save_order_routing`, `save_colorway_planning_remarks` | V |
| Dept Schedule `#/dept-schedule` | `line_allocations`, fabric/cutting selects | `get_factory_schedule_actuals` | V |
| Transaction Report | `handover_slips` + enrich; fallback path | `get_handover_report` | V |
| Settings `#/settings` | settings table fetchers; support_dropdowns | `save_factory_settings`, `save_support_dropdown`, ensure seeds | A |
| Work Centers * | buyers/depts/shifts/flows/ops/fabric/resources selects | `save_buyer`, `save_department`, `save_shift`, `save_process_flow`, `save_size_group`, `save_resource`, `save_operation`, `save_fabric_components`, `ensure_factory_fabric_components`, `ensure_department_defects` | A |
| User Management `#/admin`, `#/user-management` | `profiles`, `floor_user_access` (read) | Edge Functions for user CRUD; `replace_floor_user_access` only via Edge / unused lib helper | A |

---

## 10. Known issues already in the code

**No `TODO` / `FIXME` markers** in desktop `.ts`/`.tsx`.

Permission / RLS / admin-related comments:

| file:line | Text / topic |
|---|---|
| `lib/routeAccess.ts:15` | `UX-only — RLS / RPCs remain the real security boundary.` |
| `lib/routeAccess.ts:80` | `Mutation UIs (forms, editors, save buttons) — admin only.` |
| `lib/authSession.ts:78` | `factory_id is MISSING from JWT — RLS will block all factory-scoped tables` |
| `lib/ensureSupportDropdowns.ts:14-18` | `isRlsError` — `42501` / `403` / `row-level security` |
| `lib/ensureSupportDropdowns.ts:43-44` | Skips writes when user is not an admin |
| `lib/reports/shared/rpcUtils.ts:20` | treats `permission denied` as missing-RPC class |
| `lib/reports/styleReport.ts:724` | `permission denied` soft-fail branch |
| `stores/settingsStore.ts:1200` | `not authorized` → return false (`ensure_department_defects`) |
| `lib/updateFactoryUser.ts:20` | Edge-fn-only; do not call missing RPC |
| `components/RequireRole.tsx:37` | Copy: admin and viewer only |

---

## Closing questions

1. **Can a desktop user cause the client to send a `p_factory_id` other than their own?**  
   **Yes, without a factory-switcher UI:** by mutating Zustand `factoryId` or localStorage `navigation-storage` (e.g. DevTools/console) after login. There is no URL-based factory override. Boot `restoreAuthSession` overwrites from `get_my_profile`, but does not continuously re-bind. RPCs listed in the appendix that **do not** validate `p_factory_id` against `current_factory_id()` are exploitable if that client value is changed.

2. **Where does `get_department_kpis_by_shift` get called, and what supplies `p_factory_id`?**  
   Only at `lib/reports/kpiAndProgress.ts:488` inside `fetchDepartmentKpisByShift(factoryId, ...)`. **That function has zero callers.** `p_factory_id` would be the function parameter (intended: nav `factoryId`). Live day reports use `fetchDepartmentKpis` → `queryShiftKpiViewRows` on `v_department_kpis_by_shift` instead.

3. **Where do `log_desktop_shipment`, `log_desktop_rejection`, `delete_desktop_shipment` get called, and what supplies `p_factory_id`?**  
   Wrappers in `lib/desktopFulfillment.ts:42,81,106`. Call sites: `components/production/OrderCompletionWorkspace.tsx:838,871,911`. `factoryId` prop from `pages/production/OrderCompletion.tsx:10,79` ← `useNavigationStore().factoryId` ← `get_my_profile`.

4. **Does any desktop code read `v_department_kpis_by_shift` directly rather than through its RPC?**  
   **Yes.** `lib/reports/kpiAndProgress.ts:327` (`queryShiftKpiViewRows`), used by `fetchDepartmentKpis` (primary path) and as fallback inside the unused `fetchDepartmentKpisByShift`.

5. **Does the app call `auto_reject_missing_pcs`, `seed_factory_app_configuration`, `seed_factory_native_departments`, `ensure_factory_fabric_components`, or `next_internal_order_no`?**  
   Only `ensure_factory_fabric_components` — `lib/fabricComponentDb.ts:37`. The other four: **no**.

6. **Is there anywhere the desktop app writes to a table without a `factory_id` filter or column?**  
   **No direct table writes** in the desktop app (all mutations go through RPCs or Edge Functions). Several **selects** omit `.eq('factory_id', ...)` (filter by id / order_id / profile_id instead) — see §4 rows marked `no`.

7. **Which desktop screens are visible to a `quality_manager` but call an RPC that requires `is_factory_admin()`?**  
   **None today:** `quality_manager` is rejected by `DESKTOP_LOGIN_ROLES` / `desktopAccessError` before the shell loads. `canCaptureOnDesktop` would allow that role on Order Completion if they could sign in, but they cannot through the current login path. (If login were widened without aligning RPC predicates, Order Completion + any admin-only `save_*` reachable from viewer-like routes would be the conflict surface.)

---

## Appendix notes from recon

- Live appendix: `v_department_kpis_by_shift` bypasses RLS — and the desktop **does** read it with a client-supplied `factory_id` filter only (no server invoker).
- Live appendix: several SECURITY DEFINER RPCs accept unvalidated `p_factory_id`; desktop passes nav-store `factoryId` into `ensure_factory_fabric_components`, `get_department_kpis_by_shift` (dead export), `log_desktop_shipment`, `log_desktop_rejection` (`delete_desktop_shipment` **does** validate per appendix).
- `audit_events`: desktop has no direct reads/writes; audit depends on `save_*` RPCs server-side.
