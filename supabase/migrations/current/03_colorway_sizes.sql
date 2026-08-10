-- =============================================================================
-- colorway_sizes — DROPPED (never used)
-- Sizes are stored as JSONB in colorways.sizes and queried directly from there.
-- This table was designed as a future normalized read-model but was never
-- written to or read from anywhere in the application.
-- =============================================================================
DROP TABLE IF EXISTS public.colorway_sizes CASCADE;
