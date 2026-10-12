ALTER FUNCTION public.mm_get_warehouse_dispatch_board(uuid) VOLATILE;
NOTIFY pgrst, 'reload schema';
;
