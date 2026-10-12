-- Layering form fields on each lay/entry
ALTER TABLE public.cutting_lays
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS cut_no text,
  ADD COLUMN IF NOT EXISTS lay_length numeric,
  ADD COLUMN IF NOT EXISTS lay_length_unit text,
  ADD COLUMN IF NOT EXISTS pattern_no text,
  ADD COLUMN IF NOT EXISTS marker_no text,
  ADD COLUMN IF NOT EXISTS marker_width numeric;

ALTER TABLE public.cutting_lays
  DROP CONSTRAINT IF EXISTS cutting_lays_lay_length_unit_check;

ALTER TABLE public.cutting_lays
  ADD CONSTRAINT cutting_lays_lay_length_unit_check
  CHECK (lay_length_unit IS NULL OR lay_length_unit IN ('Yards', 'Meters'));

COMMENT ON COLUMN public.cutting_lays.start_time IS 'Layering start time for this lay entry';
COMMENT ON COLUMN public.cutting_lays.end_time IS 'Layering end time for this lay entry';
COMMENT ON COLUMN public.cutting_lays.cut_no IS 'Cut number on the layering entry form';
COMMENT ON COLUMN public.cutting_lays.lay_length IS 'Lay / spread length';
COMMENT ON COLUMN public.cutting_lays.lay_length_unit IS 'Yards or Meters';
COMMENT ON COLUMN public.cutting_lays.pattern_no IS 'Pattern number from layering form';
COMMENT ON COLUMN public.cutting_lays.marker_no IS 'Marker number from layering form';
COMMENT ON COLUMN public.cutting_lays.marker_width IS 'Marker width from layering form';

-- Separate cut window on the session (distinct from layering times on lays)
ALTER TABLE public.cutting_sessions
  ADD COLUMN IF NOT EXISTS cut_start_time timestamptz,
  ADD COLUMN IF NOT EXISTS cut_end_time timestamptz;

COMMENT ON COLUMN public.cutting_sessions.cut_start_time IS 'Cutting step start time (after layering)';
COMMENT ON COLUMN public.cutting_sessions.cut_end_time IS 'Cutting step end time (after layering)';;
