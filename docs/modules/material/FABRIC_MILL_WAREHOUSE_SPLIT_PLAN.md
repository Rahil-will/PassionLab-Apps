# Fabric: Mill and Warehouse split — high-level plan

Goal: two separate stories, each with its own tables, functions and permissions, joined
at exactly one handoff. Built so a third site (another mill, second warehouse) later
means adding rows, not redesigning.

Checked live on 2026-10-01: there are 0 mill-site inspections and 0 process challans,
so a split costs almost nothing in data migration today. It gets more expensive every
week this waits.

---

## 1. The principle

One owner per table. Each side writes only its own tables, through its own functions.
The two sides meet in one place only: the handoff (dispatch / receive), plus read-only
report views.

```
   MILL STORY                    HANDOFF                  WAREHOUSE STORY
 mm_mill_*  tables   ──►  mm_in_challans (+lines)  ──►   mm_stock_units + friends
 mm_mill_*  functions       the only shared             mm_wh_* / existing functions
                            transactional table
                  \                                    /
                   └──── read-only report views ──────┘
```

---

## 2. The two stories

### Mill story (everything before the roll leaves the mill)
1. Produce a batch, enter rolls (General PO rolls have no style yet, style rolls do).
2. Inspect at the mill (4-point, mill's own record).
3. Send rolls to a process vendor and take them back (dyeing, finishing, etc.).
4. Allocate rolls to a style, color, fabric line.
5. Dispatch: one challan, rolls leave the mill.
6. After dispatch, mill's rows are history. Mill never sees what warehouse does next.

### Warehouse story (everything after a roll arrives, from mill or vendor)
1. Inbound: mill challan or vendor GRN.
2. Receive, 4-point test, pass or fail.
3. Putaway to rack, hold / release, allocate.
4. Send to a process vendor and take back.
5. Store challan to cutting. Cutting uses the roll, end bits come back.
6. Return to supplier.

Vendor fabric never touches the mill side at all.

---

## 3. Target table map

### Mill-owned (prefix mm_mill_ for anything new)
| Table | Status | Purpose |
|---|---|---|
| mm_mill_batches | exists | Batch header |
| mm_mill_rolls | exists | A roll's whole life at the mill |
| mm_mill_inspections | NEW | Mill's 4-point record (split out of mm_warehouse_inspections) |
| mm_mill_inspection_defects | NEW | Defects for mill inspections |
| mm_mill_process_challans | NEW | Mill to process vendor challan |
| mm_mill_process_out_lines | NEW | Rolls sent out |
| mm_mill_process_return_lines | NEW | Rolls received back |
| mm_mill_roll_events | OPTIONAL later | Mill's own audit trail (mill has no ledger today) |

### Handoff (the only shared transactional table)
| Table | Rule |
|---|---|
| mm_in_challans + mm_in_challan_lines | Sender columns written by mill dispatch or vendor GRN: challan_no, reference_no, sent_at, sent_by, source, style_material_id. Receiver columns written by warehouse only: status, received_at, received_by, line_status. |

Dispatch is the one place mill code is allowed to insert into warehouse tables. It
creates the in-challan and a fresh mm_stock_units row carrying mill_snapshot and
mill_roll_id. After that the two rows live independently.

### Warehouse-owned (existing names kept, no rename in v1)
| Table | Purpose |
|---|---|
| mm_stock_units | The roll, mill and vendor sourced |
| mm_stock_ledger | Every balance and status change |
| mm_warehouse_inspections | Becomes warehouse-only (site = warehouse, scope in_challan or process_challan) |
| mm_inspection_defects | Warehouse inspection defects |
| mm_process_challans / out_lines / return_lines | Become warehouse-only (origin = warehouse) |
| mm_store_challans + lines | Warehouse to cutting |
| mm_supplier_returns + lines | Back to vendor |
| mm_end_bit_returns | Leftovers returned from cutting |

### Cutting (separate module, consumes warehouse stock)
mm_lay_unit_consumptions, plus mm_end_bit_returns as written by the lay save.

### Shared masters (config only, ops screens read, setup screens write)
mm_fabric_types, mm_type_test_fields, mm_type_requirement_fields, mm_fpt_thresholds,
mm_defect_types, mm_locations, mm_factory_features, mm_doc_sequences,
mm_process_types, mm_process_vendors, mm_process_vendor_types, mm_style_materials.

### Report views (the only legal place mill and warehouse data meet)
mm_v_mill_field_accuracy, mm_v_mill_accuracy_summary, mm_v_style_fabric_reconciliation.
Views only. Never a function that writes.

---

## 4. Rules that keep it clean

1. A mill function never touches a warehouse table, and the reverse. One exception:
   mm_dispatch_mill_rolls (inserts into the handoff and mm_stock_units).
2. Function names follow the owner: mm_mill_* for mill, mm_wh_* for warehouse.
   Existing names keep working through thin wrappers until the app is repointed.
3. Permission keys follow the owner: mm_mill_ops and mm_wh_ops (today mill uses
   mm_roll_entry and warehouse uses mm_inventory). A warehouse login gets no mill
   screens and no mill table reads.
4. Same shape, separate copies: mill and warehouse inspections have identical columns
   and use the same thresholds config. Duplicated structure, different owners, by design.
5. New site types (second mill, second warehouse) are rows in mm_locations with a
   site dimension, not new tables.
6. Automated boundary test in CI: list every function body that references mm_mill_*
   and every one that references warehouse tables, fail if any appears outside its
   owner or the allowed dispatch list. This is what stops drift coming back.

---

## 5. What has to change in the current database

Today, 16 functions reference mm_mill_rolls. Several are generic and serve both sides
through a parameter, which is the real source of the mixing:

| Today (generic, serves both) | Becomes |
|---|---|
| mm_save_inspections(scope_kind, ...) | mm_mill_save_inspections + mm_wh_save_inspections |
| mm_send_to_process(origin, ...) | mm_mill_send_to_process + mm_wh_send_to_process |
| mm_receive_process_return | one per side |
| mm_get_process_challan | one per side |
| _mm_fpt_threshold(unit_id) | needs a mill variant (works from a mill roll id) |
| _mm_invalidate_qc_after_process | one per side |
| mm_list_mill_stock | check callers, likely mill-only already |
| mm_allocate_mill_rolls_to_style / mm_allocate_rolls_to_style | already split, keep |

Function bodies still to be read in Phase 0 before cutting them: mm_save_inspections,
mm_receive_process_return, _mm_fpt_threshold, _mm_invalidate_qc_after_process.
(Already read: mm_send_to_process branches cleanly on origin, and
mm_allocate_mill_rolls_to_style only touches mm_mill_rolls and mm_mill_batches.)

---

## 6. Phases

| Phase | Work | Risk |
|---|---|---|
| P0 | Lock the four decisions below. Write CONTRACT_MILL_WAREHOUSE.md. Add the boundary test in report-only mode. Read the four function bodies above. | None |
| P1 | Mill inspections: create mm_mill_inspections + mm_mill_inspection_defects, move the mill branch out of mm_save_inspections. | Low, 0 mill-site rows today |
| P2 | Process split: create mm_mill_process_* tables, split the three process functions. Existing process tables become warehouse-only. | Low, 0 process rows today |
| P3 | Permissions and RLS: add mm_mill_ops / mm_wh_ops, repoint every function, add role-aware read policies on mm_mill_* tables. | Medium, touches every login |
| P4 | Lock it: CHECK constraints (warehouse inspections site = warehouse, process origin = warehouse), delete the mill branches from warehouse functions, switch the boundary test to enforcing. | Low |
| P5 | Optional: mm_mill_roll_events, naming cleanup with compatibility views, multi-site dimension. | Optional |

Mill and warehouse screens keep working during P1 to P3 because the old function
names stay as wrappers. Nothing in the app breaks until the wrappers are removed in P4.

---

## 7. Decisions needed (defaults in bold)

| # | Question | Default |
|---|---|---|
| D1 | Handoff document: one shared mm_in_challans, or a mill dispatch table plus a separate warehouse receipt table | **One shared table, ownership by column.** A challan is a two-party document, splitting it creates two records that must agree. |
| D2 | Process tables: separate per side, or keep one set with an origin column | **Separate per side.** Matches "mill story and warehouse story separate". |
| D3 | Rename existing warehouse tables to mm_wh_* | **No in v1.** Cosmetic, costs a lot of app changes. Prefix only new tables. |
| D4 | Split permission keys into mm_mill_ops and mm_wh_ops | **Yes.** Needed so a warehouse login cannot open mill data. |

## 8. Not in this plan
Trims, cutting-floor screens, multi-factory sites, and any change to how required
quantity is calculated on the order screen.
