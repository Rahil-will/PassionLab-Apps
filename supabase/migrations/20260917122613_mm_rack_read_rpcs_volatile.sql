-- mm_get_rack_ops_board / mm_list_rack_master seed mill/warehouse/red-label
-- rows via _mm_seed_ops_locations. STABLE makes PostgREST run them in a
-- read-only transaction, which fails: cannot execute INSERT in a read-only
-- transaction. Same class of bug as verify_floor_pin (20260808123335).

ALTER FUNCTION public.mm_get_rack_ops_board() VOLATILE;
ALTER FUNCTION public.mm_list_rack_master() VOLATILE;

NOTIFY pgrst, 'reload schema';;
