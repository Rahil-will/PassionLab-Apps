# Fabric v4 — Database contract (live on Supabase "MES", 2026-10-01)

The database side of Fabric v4 is built, migrated and self-tested. This file is the **only** thing the
frontend needs to know about it. Every write goes through an RPC below. Never write to tables directly.

---

## 0. What's in the database

| Migration | Adds |
|---|---|
| `20261001115436_mm_v4_feature_key` | `fabric_v4` allowed in `mm_factory_features` |
| `20261001115914_mm_v4_masters` | `mm_facilities`, `mm_facility_process_types`, `mm_machines`, `mm_fabric_stages`, process-type rules, test-field rules, admin RPCs, seed |
| `20261001120703_mm_v4_roll_registry` | `mm_rolls` (one row per physical roll), `mm_roll_lineage`, `mm_roll_allocations`, `mm_mill_batch_style_intents`, batch columns, registry + allocation triggers, mill RPCs |
| `20261001121012_mm_v4_processing` | extends `mm_process_challans/out_lines/return_lines`, adds `mm_process_lots`, `mm_process_returns`, processing RPCs |
| `20261001121322_mm_v4_quality` | `mm_qc_tests`, `mm_qc_test_rolls`, `mm_qc_inspections`, `mm_qc_inspection_defects`, `mm_qc_cut_approvals`, passport, quality RPCs, legacy data copied in |
| `20261001121721_mm_v4_gate_and_receipt` | cutting gate, v4 receipt clearance, `mm_create_store_challan` gate, vendor GRN v4 |
| `20261001122219_mm_v4_read_api` | all list/detail/queue/report RPCs |
| `20261001122416_mm_v4_selftest` + 3 fix migrations | `_mm_v4_selftest()` end-to-end scenario test |

**Switch:** `mm_factory_features.fabric_v4` (default **off** for every factory).
- **Off:** the old screens behave exactly as before. The new tables still fill in through triggers.
- **On:** the cutting gate below applies to `mm_create_store_challan`. Receiving and putaway no longer wait for testing or inspection; quality is checked only at cutting.
- Turn it on with `mm_set_fabric_v4(true)` (admin), **only after** the v4 pages ship.

**Backward compatible:** every old RPC still works. The triggers give rolls created by old RPCs a
registry row, stage, lineage and allocation log automatically.

---

## 1. Concepts the UI must respect

| Term | Meaning |
|---|---|
| `roll_id` | **Registry id** (`mm_rolls.id`). One per physical roll, for life. Use this everywhere in v4 UI. |
| custody row | `mm_mill_rolls` (at mill) or `mm_stock_units` (in warehouse). Same `roll_id` on both after dispatch. |
| re-rolled child | New roll (new `roll_id`) made at processing from 1..N parents. Linked in `mm_roll_lineage`. Starts with no test/inspection. |
| stage | `GREIGE, RFD, PFD, PFGD, DYED, PRINTED, FINISHED` (factory-editable). `can_cut` per stage. Set by the process type on return. |
| process_round | +1 every time a roll comes back from processing as the same roll. |
| passport | Derived, never stored. For each roll: test status + inspection status. |
| test status | `NONE` · `STALE` (processed since) · `FAILED` · `HOLD` · `INCOMPLETE` (required field missing for current stage) · `PASS` |
| inspection status | `NONE` · `STALE` · `FAILED` · `PASS` |
| test scope | `mill_batch` · `process_challan` · `process_lot` · `in_challan` · `rolls` — one test covers every live roll in the scope |
| supersede | Saving a new test on the same scope automatically replaces the previous one. Old rows are kept, never edited. |
| deviation | A failed test/inspection approved by a manager counts as pass. |
| cut at risk | Manager approval that lets specific `TEST_*` / `INSPECTION_*` blocks through the gate for a roll |

**Gate codes** (store challan / readiness): `STAGE_NOT_CUTTABLE`, `TEST_MISSING`, `TEST_STALE`, `TEST_FAILED`,
`TEST_HOLD`, `TEST_INCOMPLETE`, `INSPECTION_MISSING`, `INSPECTION_STALE`, `INSPECTION_FAILED`, `NOT_AVAILABLE`,
`ON_HOLD`, `NOT_ALLOCATED`.

**Custody `side`** (from `custody.side`): `mill` · `processing` · `warehouse` · `none`.

---

## 2. Envelope, errors, permissions

Every RPC returns `{ ok: true, data }` or `{ ok: false, code, message }`. Show `message` to the user.
`mm_create_store_challan` can also return `{ ok:false, code:'CUT_GATE', message, blocked:[{stock_unit_id, roll_id, unit_code, codes[]}] }`.

| Permission check | RPCs |
|---|---|
| config (admin or `mm_config` app) | `mm_save_facility`, `mm_save_machine`, `mm_save_fabric_stage`, `mm_save_process_type_rules`, `mm_save_test_field_rules`, `mm_qc_approve_deviation`, `mm_qc_approve_cut_at_risk`, `mm_qc_revoke_cut_at_risk` |
| factory admin | `mm_set_fabric_v4` |
| ops keys `mm_mill_ops` / `mm_proc_ops` / `mm_qc_ops` / `mm_wh_ops` | everything else. **Today any user with `mm_inventory` or `mm_roll_entry` passes all four.** Splitting is a later step. |

---

## 3. Masters (Material setup)

| RPC | Payload | Returns |
|---|---|---|
| `mm_get_v4_config()` | — | `{ fabric_v4, stages[], facilities[] (kind, ownership, process_type_ids[]), machines[], process_types[] (rules), unit_forms[], width_forms[], grades[], machine_kinds[] }` → **use for every dropdown** |
| `mm_save_facility(p_row)` | `{id?, kind:'mill'|'process_unit'|'warehouse'|'vendor', ownership:'internal'|'external', code, name, address?, contact?, remarks?, is_active?, process_type_ids?[]}` | `{id}` |
| `mm_save_machine(p_row)` | `{id?, facility_id (internal only), machine_kind, code, name?, specs?{dia,gauge,feeders,reed,capacity_kg…}, is_active?}` | `{id}` |
| `mm_save_fabric_stage(p_row)` | `{code, label, seq?, can_cut?, is_initial?, is_active?}` | `{code}` |
| `mm_save_process_type_rules(p_row)` | `{id?, name?, sort_order?, active?, output_stage_code?, default_return_mode:'same_rolls'|'re_rolled', resets_testing?, resets_inspection?, machine_kinds?[]}` | `{id}` |
| `mm_save_test_field_rules(p_rules)` | `[{field_id, test_level:'roll'|'lot', required_at_stages:['FINISHED',…]}]` | `{updated}` |
| `mm_set_fabric_v4(p_enabled)` | boolean | `{fabric_v4}` |

Seeded per factory: 7 stages, facilities `MILL-1` (internal mill) and `WH-1` (internal warehouse), process types
Scouring & Bleaching→RFD, Finishing→FINISHED, Compacting (resets testing only), Dyeing→DYED (re-rolled), Printing→PRINTED.

---

## 4. Mill

| RPC | Payload | Returns |
|---|---|---|
| `mm_mill_save_batch_v4(p_payload)` | `{facility_id?, style_material_id? | order_id+colorway_id+colorway_material_id?, fabric_type_id (general batch), batch_no? (auto MB-YYMM-####), mill_ref?, production_date?, initial_stage_code? (GREIGE), yarn_lot?, yarn_count?, color_ref?, fabric_ref_name?, remarks?, intent_style_material_ids?[], rolls:[{unit_code, length_m, weight_kg?, shade?, lot_no?, color_ref?, attributes?, machine_id?, shift?, produced_at?, unit_form?, width_form?}]}` | `{id, batch_no, roll_count}` |
| `mm_mill_add_rolls_v4(p_batch_id, p_rolls)` | same roll shape | `{id, added}` |
| `mm_set_batch_style_intents(p_batch_id, p_style_material_ids uuid[])` | replaces the list | `{id}` |
| `mm_set_roll_tags(p_roll_ids uuid[], p_tags)` | `{machine_id?, shift?, produced_at?, unit_form?, width_form?, grade?, dye_lot?, stage_code? (only before any processing)}` | `{updated}` |
| `mm_mill_list_batches_v4(p_filter)` | `{facility_id?, batch_kind?:'style'|'general', fabric_type_id?, search?}` | `{rows:[{id, batch_no, batch_kind, facility, fabric_type_name, style, intents[], counts{total, at_mill, at_process, dispatched, closed, unallocated_at_mill, qty_m, qty_kg}, stages{CODE:n}, machines[], …}]}` |
| `mm_mill_get_batch_v4(p_batch_id)` | — | `{batch, intents[], rolls[ROLL_ROW], process_challans[], tests[]}` |

Still used as-is (they're v4-correct through triggers): `mm_allocate_mill_rolls_to_style`, `mm_unallocate_rolls`,
`mm_dispatch_mill_rolls`, `mm_update_mill_batch`, `mm_set_mill_short_close`.

**ROLL_ROW** (returned by most reads): `{roll_id, roll_code, origin, mill_batch_id, batch_no, fabric_type_id,
fabric_type_name, machine{id,code,name}, shift, produced_at, stage_code, unit_form, width_form, grade, dye_lot,
process_round, length_m, weight_kg, shade, lot_no, color_ref, mill_roll_id, stock_unit_id, qty_available, uom,
custody{side, status, …}, style{style_name, style_ref, colorway_name, fabric_line, …}, test_status,
inspection_status, missing_keys[], parent_codes[]}`

---

## 5. Processing (in-house and outsourced, same flow)

| RPC | Payload | Returns |
|---|---|---|
| `mm_proc_send(p_payload)` | `{side:'mill'|'warehouse', unit_facility_id (kind process_unit), process_type_id, roll_ids:[registry ids], challan_no? (auto PC-YYMM-####), unit_ref_no?, sent_at?, purpose?:'fresh'|'reprocess', parent_challan_id? + reprocess_reason? (required for reprocess), remarks?}` | `{id, challan_no, roll_count}` |
| `mm_proc_save_lots(p_challan_id, p_lots)` | `[{id?, lot_no, machine_id? (in-house only, must belong to the unit), started_at?, ended_at?, remarks?, out_line_ids[], remove?}]` | `{saved}` |
| `mm_proc_return(p_payload)` | `{challan_id, return_no? (auto PR-…), returned_at?, remarks?, deliver_to?:'sender'|'warehouse' (mill side only), dispatch?{challan_no?, reference_no?, to_location?}, same_rolls:[{out_line_id, qty, qty_kg?, shade?, color_ref?, stage_code?, unit_form?, width_form?, grade?, dye_lot?, lot_id?}], re_rolled:[{out_line_ids[], outputs:[{unit_code, qty, qty_kg?, shade?, color_ref?, stage_code?, unit_form?, width_form?, grade?, dye_lot?, lot_id?}]}], write_offs:[{out_line_id, reason}]}` | `{return_id, return_no, outputs:[{roll_id, unit_code, same}], dispatch}` |
| `mm_proc_void_challan(p_id, p_reason)` | only if nothing came back | `{id}` |
| `mm_proc_list_challans(p_filter)` | `{side?, status?:'open'|'partial'|'returned'|'void'|'pending', unit_facility_id?, process_type_id?, purpose?, search?}` | `{rows:[{id, challan_no, side, status, purpose, parent_challan_no, unit{name,ownership}, process_type, counts{out,open,returned,replaced,written_off,qty_out,kg_out}, qty_in, kg_in, returns, tested, age_days}]}` |
| `mm_proc_get_challan(p_id)` | — | `{challan (+unit, process_type rules), out_lines[], lots[], returns[{lines[]}], loss{loss_pct, loss_pct_kg,…}, tests[], reprocess_challans[]}` |

Rules enforced by the database:
- Stage defaults to the process type's `output_stage_code`. A line can override it.
- A same-roll return adds 1 to `process_round` and makes the passport stale according to the process type's `resets_*` flags.
- Re-rolled outputs get new `roll_id`s plus lineage to every parent.
- `deliver_to:'warehouse'` creates the in-challan in the same transaction. If that fails, the whole return is rolled back.

---

## 6. Quality

| RPC | Payload | Returns |
|---|---|---|
| `mm_qc_get_scope(p_scope_kind, p_scope_id, p_roll_ids uuid[]?)` | — | `{stage_code, fabric_type, mixed_fabric_types, fields[{id,key,label,data_type,options,test_level,required}], defect_types[], rolls[ROLL_ROW], history[]}` → **drives the test form and the inspection grid** |
| `mm_qc_save_test(p_payload)` | `{scope_kind, scope_id?, roll_ids?[] (required for 'rolls', otherwise optional subset), site_side:'mill'|'processing'|'warehouse', site_facility_id?, tested_at?, field_values{key:value}, result:'pass'|'fail'|'hold', remarks?, origin?:'own'|'vendor_certificate'|'process_unit_report', supersedes_test_id?}` | `{id, roll_count, supersedes_id}` |
| `mm_qc_save_inspections(p_payload)` | `{site_side, site_facility_id?, inspected_at?, origin?, rows:[{roll_id, inspected_length, length_uom?:'m'|'yd', cuttable_width, width_uom?:'in'|'cm', pts_1..pts_4? OR defects:[{defect_type_id?, defect_code?, points 1-4, position_from?, hole?, size_band?}], result_override?, override_reason?, remarks?}]}` | `{rows:[{roll_id, inspection_id, result, points_per_100_sqyd, threshold}]}` |
| `mm_qc_approve_deviation(p_kind 'test'|'inspection', p_id, p_reason)` | manager | `{id}` |
| `mm_qc_void(p_kind, p_id, p_reason)` | wrong entry | `{id}` |
| `mm_qc_approve_cut_at_risk(p_roll_ids, p_codes, p_reason, p_expires_at?)` | codes `TEST_*` / `INSPECTION_*` only | `{approved}` |
| `mm_qc_revoke_cut_at_risk(p_approval_id)` | | `{id}` |
| `mm_qc_get_roll(p_roll_id)` | roll passport page | `{roll, passport, tests[], inspections[+defects], ancestors[ROLL_ROW+depth], children[], process_history[], allocations[], cut_approvals[]}` |
| `mm_qc_list_queue(p_filter)` | `{side?, need?:'test'|'inspection'|'any', style_material_id?, search?, limit?}` | `{rows[ROLL_ROW]}` (rolls not PASS) |

Only `origin` `own` and `migrated` count toward the passport. Vendor certificates and external unit reports are history only.
Rolls at a processing unit or no longer in stock cannot be tested or inspected.

---

## 7. Warehouse and cutting

| RPC | Payload | Returns |
|---|---|---|
| `mm_wh_save_vendor_grn_v4(p_payload)` | `{vendor_facility_id (external vendor/mill), style?{order_id,colorway_id,colorway_material_id}, fabric_type_id, invoice_ref?, grn_date?, uom?, color_ref?, lot?, grn_no?, stage_code? (FINISHED), unit_form?, width_form?, rolls:[{length, weight_kg?, shade?, lot_no?, color_ref?, roll_no?, width_in?}]}` | same as `mm_save_vendor_grn` |
| `mm_wh_list_readiness(p_filter)` | `{style_material_id?, search?, only_blocked?}` | `{rows:[ROLL_ROW + gate{codes[], overridden[], cut_ready}, location], fabric_v4}` |
| `mm_create_store_challan(...)` | unchanged signature | when v4 is on, can return `CUT_GATE` + `blocked[]` |
| `mm_list_rolls_v4(p_filter)` | `{side?, batch_id?, style_material_id?, unallocated?, stage_code?, fabric_type_id?, search?, available_for?:'process'|'dispatch'|'test'|'cut', limit?}` | `{rows[ROLL_ROW]}` → **generic roll picker** |

Still used as-is: receive (`mm_receive_mill_in_challan`, `mm_receive_in_challan_lines`), putaway, hold/release,
allocate/unallocate, store-challan receive, lay consumptions, end-bits.

---

## 8. Reports

| RPC | Returns |
|---|---|
| `mm_rpt_process_loss(p_from?, p_to?, p_group_by 'unit'|'process'|'unit_process')` | `{rows:[{unit, process, challans, reprocess_challans, qty_out, qty_in, qty_written_off, loss_pct}]}` |
| `mm_rpt_quality_by_machine(p_from?, p_to?)` | `{rows:[{facility, machine_code, machine_kind, rolls, inspections, inspections_failed, avg_points_per_100_sqyd}]}` (includes re-rolled children) |

---

## 9. Old RPCs to stop calling from v4 pages

| Old RPC | Use instead |
|---|---|
| `mm_send_to_process`, `mm_receive_process_return`, `mm_get_process_challan`, `mm_list_process_challans`, `mm_list_process_vendors`, `mm_save_process_catalog` | `mm_proc_*` + facilities |
| `mm_save_inspections`, `mm_save_warehouse_inspections`, `mm_save_vendor_roll_tests`, `mm_list_inspection_queue` | `mm_qc_*` |
| `mm_save_unallocated_mill_batch`, `mm_save_mill_batch` | `mm_mill_save_batch_v4` |
| `mm_save_vendor_grn` | `mm_wh_save_vendor_grn_v4` |

Leave the old functions in place. They'll be dropped in a cleanup migration once v4 has been live for a while.

---

## 10. Known limits (not bugs, by design for this release)

- Mill rolls still need `length_m` (as before). For kg-only knits, send the meter count from the roll counter. kg goes in `weight_kg`.
- Not built yet: greige bought from a vendor going straight to a processing unit, warehouse-to-warehouse transfers, multi-step lots at in-house units, per-facility user scoping.
- The floor app (PRODIGI FLOOR) is untouched.
- Self-tests (service role; they always raise, `SELFTEST PASS: …` means OK, and everything is rolled back):
  `select public._mm_v4_selftest('<admin profile uuid>');` (full mill → processing → warehouse → cutting flow) and
  `select public._mm_v4_selftest_wh('<admin profile uuid>');` (warehouse-side processing and reprocess, loss and gain).
- Reprocess works from the mill (before dispatch) and from the warehouse (any roll in stock or awaiting QC, at any time).
  A roll already issued to the cutting store must come back to the warehouse first.
  Not yet: forwarding a roll straight from one processing unit to another (today that's a return, then a new send).
