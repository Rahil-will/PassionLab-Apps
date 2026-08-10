# Capture contract (main app + plapps)

## Identity

| Concept | DB column / JSON key | Table |
|---------|---------------------|-------|
| Operation definition (catalog) | `operation_def_id` | `operations.id` |
| Order route step (runtime) | `order_route_id` | `order_routing_steps.id` |
| Planning row (floor list grain) | `line_allocation_id` | `line_allocations.id` |
| Visit (loading + produce group) | `visit_id` | `order_routing_steps.visit_id` |
| Floor payload alias (legacy) | `operationId` | same as `order_route_id` |

## Workforce (embedded)

| Capture app | Headcount grain | Permission |
|-------------|-----------------|------------|
| `hourly`, `qc_log` | `workforce_logs.line_allocation_id` × shift × `log_date` | `profiles.can_log_workforce` |
| `batch` | On `batch_production` session row | N/A — built into batch screen |

**Floor flow:** resource → planned style (`line_allocations` row) → show visit operation names → enter categories.

Style list labels use `allocationOperationNames()` (visit steps from routing).

## Floor capture payloads

- `hourly_upsert`, `inspection_session_upsert`, `handover_send`: include `operationId` (= `order_route_id`)
- Resolve `step_type`, `capture_app`, `default_sam` via `order_routing_steps` → `operations` join
- `is_primary_output` on route drives handover WIP pool (not catalog)

## Planning save

- `save_line_plan` accepts `order_route_id` or legacy `operation_id` per allocation row

## Migrations

Apply from `PRODIGI/supabase/migrations/`:

- `20260704100000_v3_foundation.sql`
- `20260704110000_v3_routing_rpc.sql`
