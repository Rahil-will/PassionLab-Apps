# Reporting views audit (July 2026)

> **Locked rule:** Only **Style Report** and **Day Report** read SQL views. Every other screen uses RPCs.

## Views to KEEP (14)

| View | Role |
|------|------|
| `v_order_dept_progress` | Style Report — order × colorway × visit dept progress + size JSONB |
| `v_daily_output` | Day Report / dept progress RPC base |
| `v_daily_target` | Day Report targets |
| `v_daily_quality` | Day Report + Style Report QC KPIs |
| `v_department_kpis_by_shift` | Day Report shift KPIs (primary rollup) |
| `v_daily_workforce_allocation` | Feeds efficiency + dept KPI views |
| `v_daily_workforce_resource` | Workforce rollup |
| `v_daily_output_allocation` | Output × allocation grain |
| `v_daily_efficiency_allocation` | Efficiency bridge view |
| `v_shift_minutes` | Shift duration helper for KPI views |
| `v_audit_colorway_summary` | Style Report buyer / floor audits |
| `v_audit_summary` | Style Report audit totals |
| `v_day_floor_board` | Floor board screen |
| `v_outsource_vendor_balances` | Outsource vendor WIP balances |

Verify live DB: `scripts/verify_public_views.sql`

## DROPPED (migration `2.0/20260717000000_drop_legacy_reporting_views.sql`)

| View | Why removed |
|------|-------------|
| `v_cut_to_ship` | Replaced by `get_cut_to_ship_report` RPC |
| `v_cut_to_ship_dept_journey` | Replaced by `v_order_dept_progress` + `order_dept_progress_rows()` |
| `v_cut_to_ship_operation_journey` | Same |
| `v_wip_order`, `v_wip_dept`, `v_wip_operation` | Order-scoped WIP — use bundle RPC |
| `v_order_cut_qty`, `v_order_shipped_qty`, `v_order_rejected_qty`, `v_order_wip_total` | Only used by dropped `v_cut_to_ship` |
| `v_daily_kpis`, `v_daily_kpis_by_shift`, `v_department_kpis` | Superseded by `v_department_kpis_by_shift` + RPCs |
| `v_shipment_audits`, `v_buyer_audit_colorway_summary` | Unused; audits use `v_audit_*` |
| `v_dept_defect_rank` | Not referenced by app; defects roll into `v_daily_quality` |
| `get_cut_to_ship_journey` | Dropped with journey views |

## RPCs — all order-scoped pages

| RPC | Used by |
|-----|---------|
| `get_order_detail_bundle` | Style Details, Color Details, Order Completion |
| `aggregate_order_cut_qty` | Cut qty in bundle + cut-to-ship |
| `get_cut_to_ship_report` | Order Completion sidebar |
| `get_factory_production_summary` | Status Tracker |
| `order_dept_progress_rows()` | Internal — powers `v_order_dept_progress` + bundle `journey` |

## Native Progress Rule

- Origin work centers: produced qty comes from primary-fabric `cutting_bundles`.
- Terminal work centers: produced qty comes from `shipments`.
- Standard work centers: produced qty follows route `capture_app` (`hourly_counts` for `hourly`, `inspection_sessions` for `qc_log`).

## Apply order

1. `supabase/migrations/` through `20260716800000_*`
2. `supabase/migrations/2.0/20260716900000_fix_bundle_full_join.sql`
3. `supabase/migrations/2.0/20260717000000_drop_legacy_reporting_views.sql`
4. `supabase/migrations/2.0/20260717100000_native_origin_terminal_progress.sql`
5. `NOTIFY pgrst, 'reload schema';`
6. Run `scripts/verify_public_views.sql`
