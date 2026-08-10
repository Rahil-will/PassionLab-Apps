# MES Supabase (`xtfljldeceonqyzgkoyp`) — complete changelog

Final, cohesive record of every schema/security/view/function change made in
this session. Supersedes all earlier changelog docs from this thread. All of
this has already been applied and verified against live data — nothing here
is pending on the database side.

---

## 1. Table schema changes

| Table | Change |
|---|---|
| `hourly_counts`, `rejections`, `shipments`, `inspection_sessions`, `audit_sessions`, `handover_slips` (×2) | 7 stale FK constraints renamed `*_operation_id_fkey` → `*_order_route_id_fkey` (cosmetic, columns already correct) |
| `order_routing_steps` | `dept_id` locked `NOT NULL` |
| `cutting_sessions` | added `shift_id` (FK `shifts`), `sam`, `produced_mins`, `available_mins` — all plain columns, no trigger, populated by the mobile capture RPC (not yet, pending mobile-side work) |
| `inspection_sessions` | added `sam`, `produced_mins` — same pattern, closes the gap where QC had no earned-minutes basis |
| `audit_sessions` | added `shift_id` — audit previously had no shift dimension at all |
| `handover_slips` | See below — this table changed the most |

### `handover_slips` — final shape

Went through several iterations this session. **Current, final state:**

```
id, factory_id, order_id, colorway_id,
from_visit_id, to_visit_id, from_line_allocation_id,
from_department_id, to_department_id,
sent_qty, received_qty, qty_by_size, received_qty_by_size,
sent_at, received_at, sent_by, received_by,
notes, received_notes, status, challan_number
```

- `visit_id` renamed → `from_visit_id` (it was always the sending side — the app already populated it, it was just never used correctly upstream).
- `to_visit_id` added, backfilled from `to_order_route_id` on all existing rows.
- `to_line_allocation_id` was added, backfilled, then **removed again** — decided the receiving-side resource attribution wasn't meaningful enough to keep.
- `from_order_route_id` / `to_order_route_id` — dropped. Visit is now the join key everywhere; these were redundant with `from_visit_id`/`to_visit_id`.
- `from_department_id` / `to_department_id` — dropped, then **restored** (backfilled, `NOT NULL`) as a plain reference column. Views resolve department via the visit, not this column, but it's there for direct queries/the mobile app.

**Grain going forward:** `from_visit_id`/`to_visit_id` are the real keys. `from_department_id`/`to_department_id` are denormalized convenience columns kept in sync at write time — not used internally by any view.

---

## 2. Security

**RLS policies added** to 6 tables that had RLS *enabled* with **zero policies** (silently readable only because views bypassed RLS as `SECURITY DEFINER` — this was the core finding that started this whole pass):

`hourly_counts`, `workforce_logs`, `audit_sessions`, `rejections`, `shipments`, `shipment_audits` — all now `factory_id = current_factory_id()`, matching the pattern already used elsewhere.

**`security_invoker = on`** set on every view in the schema. Verified via advisor (`security_definer_view` lint gone) and functionally (a session with no JWT/factory context gets `permission denied` instead of silently seeing all factories' data).

**Three remaining permissive policies, resolved as far as structurally possible:**
- `defects_write`, `inspection_sessions_write` — tightened to `factory_id = current_factory_id()`. Clean.
- `factories_insert` — role restricted from `{anon, authenticated}` to `{authenticated}` only. **Will still show as "always true" in the advisor** — creating a brand-new factory is a genuine bootstrap case, `current_factory_id()` can't scope against a factory that doesn't exist yet. Closing this further (invite codes, a dedicated `SECURITY DEFINER` bootstrap function) is a product decision, not something to silently add.

---

## 3. View architecture — final state (13 views)

Went through three iterations before landing here: started with one generic
combined capture view, split into per-capture-type views, then consolidated
into the final shape below on explicit direction. This is the final, stable
shape.

| View | Grain | Time-sliced? | Notes |
|---|---|---|---|
| `v_daily_audit` | department/resource/style/colorway/shift/day | yes | merged from two old audit views. `shift_id` on `audit_sessions` is new and not yet populated by any capture flow |
| `v_daily_production` | style/colorway/department/resource/operation/shift/day + `step_type`, `capture_source`, `fabric_component_id` | yes | the one production table — hourly, QC, batch, cutting unioned. Cutting's `produced_mins` attaches only to the first fabric-component row per session (window function) to avoid double-counting when a session spans multiple components |
| `v_daily_quality` | same grain as production | yes | DHU recomputed from `defect_summary` jsonb (defects-per-hundred, not failed-pieces-per-hundred). `first_time_pass` now correctly sourced from its own column, not conflated with `passed` |
| `v_shift_workforce_summary` | resource/shift/day | yes | line, batch, and cutting headcount/availability unified into one table |
| `v_outsource_summary` | resource(vendor)/operation/visit | no — cumulative | merged with the old `v_outsource_vendor_balances` (near-duplicate), now includes `planned_qty` |
| `v_department_progress` | visit | no — cumulative | **renamed from `v_order_dept_progress`** — this is the one breaking change your frontend needs to know about. Gained `planned_qty`/`remaining_qty`/`available_to_send` |
| `v_order_journey_by_resource` | resource-within-visit | no — cumulative | `qty_received` and `qty_sent` are both visit-grain (same value on every resource in a visit); `sent_qty_by_resource` jsonb gives the resource-precise breakdown where `from_line_allocation_id` is known |
| `v_cut_to_ship_summary` | style/colorway | no — cumulative | new — cut vs shipped vs rejected vs balance |
| `v_day_floor_board` | department/day | yes | same name, repointed to read from `v_daily_production` — now includes batch/cutting output it previously missed |
| `v_department_kpis_by_shift` | department/operation/shift/day (resource-collapsed) | yes | same name, same columns, repointed internals — same batch/cutting inclusion fix |
| `v_daily_target`, `v_shift_minutes`, `v_order_rejected_qty_by_size` | — | — | unchanged |

**Dropped entirely** (superseded by the above, verified zero remaining dependents before each drop): `v_batch_operation_totals`, `v_daily_workforce_resource`, `v_operation_progress`, `v_daily_output_allocation`, `v_daily_workforce_allocation`, `v_daily_efficiency_allocation`, `v_hourly_production_summary`, `v_qc_production_summary`, `v_batch_production_summary`, `v_cutting_summary`, `v_resource_output_capture`, `v_resource_availability_capture`, `v_audit_summary`, `v_audit_colorway_summary`, `v_outsource_vendor_balances`.

**No view anywhere joins the `operations` table.** Every `operation_name` comes directly from `order_routing_steps.operation_name` (a denormalized column that was always there). `operations` is understood to be the mobile app's own catalog table for building routing, not a display-name source.

**Explicitly decided not to build:** `v_cutting_component_progress` — no fabric-requirement/BOM data exists anywhere in the schema to measure "progress" against, so a dedicated view would just re-aggregate `v_daily_production`'s existing `fabric_component_id` column with nothing to compare it to. Revisit if requirement data gets added later.

---

## 4. Functions changed

- **`order_dept_progress_rows()`** — added `planned_qty`, `remaining_qty`, `available_to_send` (summed from `line_allocations` at `visit_id` grain, so multi-resource visits sum correctly). Core produce/loading/store logic was already correct, not rewritten.
- **`get_audit_report()`** — rebuilt to read from `v_daily_audit` (day+department aggregation) instead of the dropped `v_audit_summary`. Same output shape.
- **Six functions repaired** after they were found still referencing dropped columns/views during a full-schema audit (a real gap in earlier verification — Postgres catches broken view *dependencies* automatically, but not columns referenced only inside function body text):
  - `floor_capture()` — **the live `handover_send` write path.** Its INSERT still targeted the dropped `from_order_route_id`/`to_order_route_id` and the renamed `visit_id`. This would have broken every handover-send action in production. Highest-severity fix in this whole session.
  - `get_order_detail_bundle()` — three CTEs (`store_sent_rows`, `produce_sent_rows`, `loading_recv_rows`) re-pointed to visit-based joins.
  - `get_handover_report()`, `get_order_operation_progress()`, `outsource_visit_handover_received_qty()`, `outsource_visit_handover_sent_qty()` — same class of fix.

All six verified working against live data after the fix, including running `get_order_detail_bundle()` end-to-end.

---

## 5. What's NOT done — genuinely open, not forgotten

1. **Trigger → RPC migration** — `capture_fill_line_allocation`, `*_apply_kpi` (hourly/batch/inspection), `outsource_work_movements`. This is mobile-side work, explicitly deferred, not tracked further here.
2. **Two known schema gaps, by design not oversight:**
   - `handover_slips` has no per-resource *received* attribution (only sent, via `from_line_allocation_id`) — a receiving visit with multiple resources can't be split further without a schema addition.
   - Cutting bundle quantities sometimes don't sum to the session total in live data — a floor-capture completeness issue, not a code bug.
3. **`factories_insert` RLS** — as tight as it can get without a product decision (see §2).

---

## 6. Frontend impact

Covered in full, with exact fix code, in the companion doc `mesReportsApi_fixes.md`:
- 1 hard-crash break (`v_order_dept_progress` → `v_department_progress` rename)
- 2 silent-regression breaks (both dropped audit views → `v_daily_audit`)
- Everything else in that file verified compatible or improved as a side effect

That doc only covers `mesReportsApi.ts` — it's the only frontend file shared this session. Anything else reading `v_order_dept_progress`, `v_audit_summary`, or `v_audit_colorway_summary` by name anywhere else in the codebase needs the same fix pattern.
