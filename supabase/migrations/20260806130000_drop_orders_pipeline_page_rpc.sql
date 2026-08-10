-- Revert server-side pipeline filter — Status Tracker uses client filter on paginated pages.

DROP FUNCTION IF EXISTS public.get_orders_pipeline_page(uuid, text, integer, integer, text, uuid);
