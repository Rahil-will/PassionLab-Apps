# Fabric v4 UI audit (Phase 1)

Read-only discovery for PRODIGI WEB. No UI code changes in this phase.  
Sources: existing Material module + shared shell; contract at `MM_FABRIC_V4_DB_CONTRACT.md`.

**Rule:** When two patterns differ, follow Fabric Warehouse. Reuse tokens/components only — no new libraries, colours, or font sizes.

---

## 1. Component inventory

| UI element | Component / file | Export | Example page |
|---|---|---|---|
| Page header + breadcrumb | `components/Breadcrumb.tsx`, `components/PageHeaderContext.tsx`; titles from `lib/routeMap.ts` via `buildBreadcrumbTrail` | `Breadcrumb`, `usePageHeader`, `usePageActions` | `MmWarehouseLanding.tsx` |
| Tabs / segment control | `modules/material/components/MmSegmentControl.tsx`; setup uses left section list | `MmSegmentControl` | `MmWarehouseStockPage.tsx`; setup: `WorkCenterMaterial.tsx` |
| Filter bar | No shared FilterBar — Card header row + `SelectDropdown`s; shell helper `PageToolbarCard` in `components/layout/PageShell.tsx` | `PageToolbarCard`, `SelectDropdown` | `MmWarehouseInboundList.tsx` |
| Search box | Inline `<input>` + Lucide `Search` (Material convention) | — | `MmWarehouseInboundList.tsx`, `MmMillBoardPage.tsx` |
| Single select / dropdown | `components/ui.tsx` | `SelectDropdown` (prefer), `Select` | `MmMillBoardPage.tsx`, `MmWarehouseInboundList.tsx` |
| Multi-select | `SelectDropdown` supports `multiple` but **unused in Material**. Closest: checkbox lists / selected table rows | — | `MmProcessVendorsPage.tsx` (process type checkboxes); roll pick via `MmMillRollsTable` |
| Searchable select (style/colorway) | Cascaded `SelectDropdown` + search inside allocate modal; style list search on boards | `MmAllocateRollsModal` | `MmMillUnallocatedLinePage.tsx`; boards: `MmMillBoardPage.tsx` |
| Date picker | `components/SingleDatePicker.tsx` | `SingleDatePicker`, `LabeledDatePicker` | `MmMillDispatchPage.tsx`, `MmWarehouseDispatchPage.tsx` |
| Number + unit suffix | No suffix Input primitive. Qty in `MmRollEntryGrid`; display `formatQtyM` in `mmRollDraft.ts`; UOM as separate dropdown on receive | `MmRollEntryGrid`, `formatQtyM` | `MmMillAssignPage.tsx`; `MmWarehouseReceiveUnallocatedPage.tsx` |
| Data table | `components/ui.tsx` `Table` + Material tables | `Table`, `MmMillRollsTable`, `MmLockedRollsTable`, `MmInboundChallanTable` | Warehouse/mill list pages |
| → sorting | Client in-memory / dropdown sort; no clickable column headers | — | `MmWarehouseRackBrowsePanel.tsx` |
| → sticky header | Local `th` `sticky top-0` classes | — | `MmWarehouseStylePage.tsx` |
| → row selection | `selectable` + checkboxes on mill/locked roll tables | `MmMillRollsTable` | `MmMillDispatchPage.tsx`, `MmWarehouseDispatchPage.tsx` |
| → bulk-action bar | Selection count + buttons in card header / border strip | — | `MmWarehouseStockPage.tsx` |
| → empty state | `CatalogTablePanel` / table `emptyText` | `CatalogTablePanel` | `MmWarehouseLanding.tsx` |
| → loading skeleton | `PageShell` `skeleton="table"` → `TableSkeleton` / `CardSkeleton` | `PageShell`, skeletons from `ui.tsx` | `MmWarehouseInboundList.tsx` |
| Inline-editable grid | `MmRollEntryGrid.tsx` (mill rolls); `MmSheetGrid.tsx` (QC sheet) | `MmRollEntryGrid`, `MmSheetGrid` | `MmMillAssignPage.tsx`, `MmMillUnallocatedAssignPage.tsx` |
| Modal / drawer | `Modal` in `ui.tsx`. **No Drawer/SidePanel in Material** — use `Modal` for passport/detail overlays | `Modal` | `MmSendToProcessModal`, `MmAllocateRollsModal`, `MmMillShortCloseModal` |
| Confirm dialog | `UnsavedChangesModal`; short-close modal | `UnsavedChangesModal`, `MmMillShortCloseModal` | `WorkCenterMaterial.tsx`; `MmMillLinePage.tsx` |
| Toast | `Toast` + `stores/notificationStore.ts` | `showNotification` | Mounted in `App.tsx`; e.g. `MmWarehouseDispatchPage.tsx` |
| Status badge / chip | Prefer `Badge` variants; Material also uses status dots | `Badge` (`default`/`success`/`warning`/`danger`/`primary`/`outline`); `StatusPoint`; `inboundDisplay.ts` helpers | `MmWarehouseLanding.tsx`, `MmWarehouseStockPage.tsx` |
| Stat cards | Local `WarehouseHeroCard` in landing | (file-local) | `MmWarehouseLanding.tsx` |
| Big nav panels | Local `HubGroup` / `HubLink` | (file-local) | `MmWarehouseLanding.tsx`, `MmMillLanding.tsx` |
| Form + validation | `Input` / `SelectDropdown` `error` prop; toast for save errors | `Input`, `SelectDropdown` | `MmMillAssignPage.tsx` |
| Print challan | `MmChallanPrintDocument.tsx` + `mmChallanPrint.ts` + `useMmChallanPrint.ts` | `MmChallanPrintDocument`, `useMmChallanPrint` | `MmStoreChallanDetail.tsx`, `MmMillDispatchPage.tsx` |

### Passport / gate badge mapping (contract → existing `Badge`)

| Passport / gate | Badge variant |
|---|---|
| PASS / cut-ready | `success` |
| STALE / INCOMPLETE / HOLD | `warning` |
| FAILED | `danger` |
| NONE | `default` (neutral/muted) |
| Stage chips (GREIGE, DYED, …) | `default` / `outline` (same as fabric category chips today) |

---

## 2. Material route map

**Setup (not in module manifest):** `#/material-management` → `pages/system/WorkCenterMaterial.tsx`  
Sections: fabric types, categories, requirement params, testing params, trim params, racks, process vendors.

**Ops routers** (`modules/material/manifest.ts`):

| Hash | Page | Router |
|---|---|---|
| `#/material/mill` | `MmMillLanding` | `MmMillRouter` |
| `#/material/mill/styles` | `MmMillBoardPage` | |
| `#/material/mill/history` | `MmMillDispatchHistoryPage` | |
| `#/material/mill/stock` | `MmMillStockPage` | |
| `#/material/mill/line/:orderId/:colorwayId/:fabricLineId` | `MmMillLinePage` | |
| `…/assign` | `MmMillAssignPage` | |
| `…/dispatch` | `MmMillDispatchPage` | |
| `…/challan/:id` | `MmWarehouseRollDetail` | |
| `#/material/mill/unallocated` | `MmMillUnallocatedPage` | |
| `…/unallocated/dispatch` | `MmMillUnallocatedDispatchPage` | |
| `…/unallocated/allocate` | `MmMillUnallocatedAssignPage` | |
| `…/unallocated/:batchId` | `MmMillUnallocatedLinePage` | |
| `#/material/process` | `MmProcessChallanList` (+ `MmMillProcessSendPanel`) | `MmProcessRouter` |
| `#/material/process/:id` | `MmProcessChallanDetail` | |
| `#/material/warehouse` | `MmWarehouseLanding` | `MmWarehouseRouter` |
| `…/expected` | `MmWarehouseExpectedPage` | |
| `…/receive-unallocated` | `MmWarehouseReceiveUnallocatedPage` | |
| `…/internal` / `…/external` | `MmWarehouseInboundList` | |
| `…/roll/:kind/:id` | `MmWarehouseRollDetail` | |
| `…/styles` | `MmWarehouseStylesPage` | |
| `…/style/:orderId` | `MmWarehouseStylePage` | |
| `…/racks` | `MmWarehouseRacksPage` / `MmWarehouseRackMovePage` | |
| `…/store` / `…/store/:id` | `MmWarehouseDispatchHistoryPage` / `MmStoreChallanDetail` | |
| `…/dispatch` … `/send` | `MmWarehouseStylesPage` → `MmWarehouseDispatchLinePage` → `MmWarehouseDispatchPage` | |
| `…/testing` / `…/testing/:id` | `MmWarehouseTestingList` / `MmWarehouseTestingDetail` | |
| `…/stock` / `…/movements` | `MmWarehouseStockPage` | |
| `…/returns` / `…/returns/:id` | `MmWarehouseReturnsPage` / `MmWarehouseReturnDetail` | |
| `…/end-bits` | `MmWarehouseEndBitsPage` | |

Route metadata: `lib/routeMap.ts`. Permissions: `mm_config`, `mm_roll_entry`, `mm_qc`, `mm_inventory`, `mm_reports`.

---

## 3. Old RPC callers (contract §9)

Wrappers in `modules/material/lib/mmRpc.ts`. V4 replacements in `mmV4Rpc.ts` (not wired to UI yet).

| Old RPC | Wrapper | Callers today |
|---|---|---|
| `mm_send_to_process` | `mmSendToProcess` | `MmSendToProcessModal.tsx` ← mill process panel, warehouse stock |
| `mm_receive_process_return` | `mmReceiveProcessReturn` | `MmProcessChallanDetail.tsx` |
| `mm_get_process_challan` | `mmGetProcessChallan` | `MmProcessChallanDetail.tsx` |
| `mm_list_process_challans` | `mmListProcessChallans` | `MmProcessChallanList.tsx` |
| `mm_list_process_vendors` | `mmListProcessVendors` | `MmProcessVendorsPage.tsx`, `MmSendToProcessModal.tsx` |
| `mm_save_process_catalog` | `mmSaveProcessCatalog` | `MmProcessVendorsPage.tsx` |
| `mm_save_inspections` | `mmSaveInspections` | `MmFourPointInspectPanel.tsx` |
| `mm_save_warehouse_inspections` | `mmSaveWarehouseInspections` | `MmWarehouseTestingDetail.tsx` |
| `mm_save_vendor_roll_tests` | `mmSaveVendorRollTests` | **No UI caller** |
| `mm_list_inspection_queue` | — | **No wrapper / no caller** |
| `mm_save_unallocated_mill_batch` | `mmSaveUnallocatedMillBatch` | `MmMillUnallocatedAssignPage.tsx` |
| `mm_save_mill_batch` | `mmSaveMillBatch` | `MmMillAssignPage.tsx` |
| `mm_save_vendor_grn` | — | **No wrapper**. Closest: `mmSaveUnallocatedVendorGrn` on receive-unallocated |
| `mm_create_store_challan` | `mmCreateStoreChallan` | `MmWarehouseDispatchPage.tsx` (extend for CUT_GATE) |

**Gating plan:** v4 pages call only `mmV4Rpc` / allowed still-used RPCs (allocate, dispatch, receive, putaway, hold/release). Old §9 RPCs remain for `fabric_v4` OFF paths.

---

## 4. V4 pages → reuse plan

| V4 page | Extends / sits next to | Reuse |
|---|---|---|
| **1 · Material setup** | `WorkCenterMaterial.tsx` — new sections (facilities, machines, stages, process rules; extend test-fabric + process-vendors) | Section list pattern, `CatalogTablePanel`, `SelectDropdown`, `Input`, `UnsavedChangesModal`, `mmGetV4Config` / save RPCs |
| **2 · Fabric Mill** | `MmMillLanding` + board/assign/line; new batch list from `mm_mill_list_batches_v4` | `MmRollEntryGrid` (+ machine/shift/form columns), `MmMillRollsTable` selection + bulk bar, existing allocate/dispatch modals, `MmSendToProcessModal` → v4 send |
| **3 · Processing (NEW)** | Sibling of mill/warehouse under `#/material/process` (exists; swap to v4) | List/detail like `MmProcessChallanList` / `Detail`, warehouse table density, `MmSegmentControl` Pending/Returned/All, Modal for send/return |
| **4 · Quality shared** | Extract from `MmFourPointInspectPanel`, `MmSheetGrid`, testing list/detail | `Modal` for test + passport (no drawer), `MmSheetGrid` for inspection, `Badge` for passport, QC queue as tab on mill + warehouse |
| **5 · Fabric Warehouse** | `MmWarehouseLanding` + inbound/stock; GRN → `mm_wh_save_vendor_grn_v4`; readiness tab | Hero cards, Hub panels, stock bulk bar, inbound list filters |
| **6 · Store challan** | `MmWarehouseDispatchPage` + `MmStoreChallanDetail` | Keep modal/page; before submit show `mm_wh_list_readiness`; on `CUT_GATE` keep open + mark rolls; manager cut-at-risk via `mm_qc_approve_cut_at_risk` |
| **7 · Reports** | New tab under Processing or Material reports area (`mm_reports` permission exists; no dedicated MM reports page today) | Warehouse table + date filter (`SingleDatePicker`) calling `mm_rpt_*` |
| **8 · fabric_v4 toggle** | `ModuleSelectorPanel.tsx` (next to In-house mill) **or** Material setup section | Same feature-toggle UX as `mmSetFactoryFeature('in_house_mill')` → `mmSetFabricV4`; confirm via `Modal` / `UnsavedChangesModal` pattern. **Do not flip on real factory from agent.** |

---

## 5. Gaps / notes (not contract blockers)

- No Material Drawer — passport uses `Modal`.
- No shared FilterBar/SearchBox — copy inbound Card-header pattern.
- Multi-select for process types / stages: use checkbox list pattern from `MmProcessVendorsPage` or enable `SelectDropdown` `multiple` consistently (Warehouse preference: match setup pages).
- Number+unit: keep grid column + separate unit dropdown; do not invent a suffix Input.
- Phase 0.3: live `db:verify-functions` and one Vitest migration-scan failure are pre-existing drift (see `prompt/PROGRESS.md`); unrelated to UI reuse.

---

## 6. Approval gate

**Stop here.** Do not start Phase 2 UI until this audit is accepted (or corrections listed).
