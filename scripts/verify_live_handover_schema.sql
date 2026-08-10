-- Run in Supabase SQL Editor (LIVE project) before any handover / dept-progress RPC migration.
-- Paste results when diffing repo migrations against production.

-- 1) handover_slips columns (live uses from_visit_id / to_visit_id, not from_order_route_id)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'handover_slips'
ORDER BY ordinal_position;

-- 2) Status values in use
SELECT status, COUNT(*) AS cnt
FROM public.handover_slips
GROUP BY status
ORDER BY cnt DESC;

-- 3) Partial receive / disputed samples (missing = sent - received when closed)
SELECT id, status, sent_qty, received_qty,
       sent_qty - COALESCE(received_qty, 0) AS gap
FROM public.handover_slips
WHERE COALESCE(received_qty, 0) < sent_qty
ORDER BY sent_at DESC
LIMIT 20;

-- 4) order_dept_progress_rows — return type must include planned_qty, remaining_qty,
--    available_to_send, qty_in_transit, qty_missing_in_transit (after live fix)
SELECT pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'order_dept_progress_rows';

-- 5) get_handover_report — must include missing_in_transit after live fix
SELECT pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_handover_report';

-- 6) Full live bodies — diff these against any proposed migration BEFORE applying
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'order_dept_progress_rows';

SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_handover_report';

-- 7) v_department_progress still valid?
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'v_department_progress'
ORDER BY ordinal_position;
