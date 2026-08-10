# Current Schema

Each file here defines one table (or a closely related group) in full — including
indexes, triggers, RLS policies, and grants.  Apply them in order:

| # | File | Contents |
|---|------|----------|
| 00 | `00_helpers.sql` | Shared utility functions (`set_updated_at`, `current_factory_id`, `is_factory_admin`, `next_internal_order_no`) |
| 01 | `01_style_orders.sql` | `style_orders` table |
| 02 | `02_colorways.sql` | `colorways` table |
| 03 | `03_departments.sql` | `departments` table (work centers) |
| 04 | `03_colorway_sizes.sql` | `colorway_sizes` table (normalised size rows) |
| 05 | `04_order_delivery_targets.sql` | `order_delivery_targets` + history table |
| 05 | `05_order_routing_steps.sql` | `order_routing_steps` table |
| 06 | `06_line_allocations.sql` | `line_allocations` table (FK → `order_routing_steps`) |
| 07 | `07_rpc_save_style_order.sql` | `save_style_order` RPC |
| 08 | `08_rpc_save_line_plan.sql` | `save_line_plan` RPC |
| 09 | `09_rpc_order_production_summary.sql` | `get_order_colorway_actuals` + `get_factory_schedule_actuals` RPCs |
| 10–14, 16 | `10_*` … `16_rpc_save_department.sql` | Other admin save RPCs |

**Archived (not on live):** `15_rpc_save_factory_user`, `17_rpc_update_factory_user` → `../_archived/`

## Rules
- When you change a table or RPC in production, update the matching file in `current/` as documentation of end-state.
- **RPC / reporting functions** may not be in `current/` — verify live before `CREATE OR REPLACE` (see `docs/SUPABASE_MIGRATION_PROCESS.md` and `scripts/verify_live_handover_schema.sql`).
- Do not trust deleted dated migrations or old `schema.sql` as source of truth for `order_dept_progress_rows`, `get_handover_report`, or `handover_slips` columns.
