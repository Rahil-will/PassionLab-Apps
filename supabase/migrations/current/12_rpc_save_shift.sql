-- =============================================================================
-- save_shift RPC
-- Atomic insert/update/delete for shifts with overnight-aware validation.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_shift(
  p_action      text,
  p_factory_id  uuid,
  p_id          uuid DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_type        text DEFAULT 'Regular',
  p_start_time  time DEFAULT NULL,
  p_end_time    time DEFAULT NULL,
  p_break_start time DEFAULT NULL,
  p_break_end   time DEFAULT NULL,
  p_hours       jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  id             uuid,
  factory_id     uuid,
  name           text,
  type           text,
  start_time     time,
  end_time       time,
  break_start    time,
  break_end      time,
  hours          jsonb,
  created_at     timestamptz,
  updated_at     timestamptz,
  productive_mins numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id            uuid;
  v_factory_id    uuid;
  v_hours         jsonb;
  v_len           int;
  v_new_blocks    jsonb;
  i               int;
  j               int;
  v_block         jsonb;
  v_prev          jsonb;
  v_start_min     int;
  v_end_min       int;
  v_prev_end_min  int;
  v_peer          record;
  v_peer_block    jsonb;
  v_peer_start    int;
  v_peer_end      int;
  v_k             int;
  v_active_mins   int := 0;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    DELETE FROM public.shifts s WHERE s.id = p_id AND s.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Shift name is required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array' OR jsonb_array_length(p_hours) = 0 THEN
    RAISE EXCEPTION 'Add at least one hour block';
  END IF;

  v_hours := p_hours;
  v_len := jsonb_array_length(v_hours);

  -- validate each block, build normalized new-blocks jsonb array, compute active minutes
  v_new_blocks := '[]'::jsonb;
  FOR i IN 0 .. v_len - 1 LOOP
    v_block := v_hours -> i;
    IF v_block IS NULL OR v_block = '{}'::jsonb THEN
      RAISE EXCEPTION 'Hour block % is empty', i + 1;
    END IF;
    v_start_min := (EXTRACT(EPOCH FROM (v_block ->> 'start')::time) / 60)::int;
    v_end_min   := (EXTRACT(EPOCH FROM (v_block ->> 'end')::time) / 60)::int;
    IF v_start_min = v_end_min THEN
      RAISE EXCEPTION 'Hour block % has invalid start/end times', i + 1;
    END IF;
    IF v_end_min < v_start_min THEN
      v_end_min := v_end_min + 1440;
    END IF;
    IF v_block ->> 'type' IS NULL OR v_block ->> 'type' <> 'break' THEN
      v_active_mins := v_active_mins + (v_end_min - v_start_min);
    END IF;
    v_new_blocks := v_new_blocks || jsonb_build_array(jsonb_build_object('s', v_start_min, 'e', v_end_min));
  END LOOP;

  -- validate no gaps/overlaps between consecutive blocks (string equality of join points)
  FOR i IN 1 .. v_len - 1 LOOP
    v_prev := v_hours -> (i - 1);
    v_block := v_hours -> i;
    IF (v_prev ->> 'end') <> (v_block ->> 'start') THEN
      RAISE EXCEPTION 'Gap or overlap between hour block % and %', i, i + 1;
    END IF;
  END LOOP;

  -- validate no overlap with existing shifts in the same factory
  FOR v_peer IN SELECT s.id, s.hours FROM public.shifts s WHERE s.factory_id = v_factory_id AND (p_action = 'insert' OR s.id <> p_id) LOOP
    FOR j IN 0 .. jsonb_array_length(v_peer.hours) - 1 LOOP
      v_peer_block := v_peer.hours -> j;
      v_peer_start := (EXTRACT(EPOCH FROM (v_peer_block ->> 'start')::time) / 60)::int;
      v_peer_end   := (EXTRACT(EPOCH FROM (v_peer_block ->> 'end')::time) / 60)::int;
      IF v_peer_end < v_peer_start THEN
        v_peer_end := v_peer_end + 1440;
      END IF;
      FOR v_k IN -1 .. 1 LOOP
        FOR i IN 0 .. jsonb_array_length(v_new_blocks) - 1 LOOP
          v_block := v_new_blocks -> i;
          v_start_min := (v_block ->> 's')::int;
          v_end_min   := (v_block ->> 'e')::int;
          IF v_start_min < (v_peer_end + v_k * 1440)
             AND (v_peer_start + v_k * 1440) < v_end_min THEN
            RAISE EXCEPTION 'Shift time overlaps with existing shift';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.shifts (
      id, factory_id, name, type, start_time, end_time, break_start, break_end, hours, productive_mins
    ) VALUES (
      v_id, v_factory_id, trim(p_name), COALESCE(p_type, 'Regular'),
      p_start_time, p_end_time, p_break_start, p_break_end, v_hours, v_active_mins
    );
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.shifts s SET
      name           = trim(p_name),
      type           = COALESCE(p_type, s.type),
      start_time     = p_start_time,
      end_time       = p_end_time,
      break_start    = p_break_start,
      break_end      = p_break_end,
      hours          = v_hours,
      productive_mins = v_active_mins,
      updated_at     = now()
    WHERE s.id = v_id AND s.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  END IF;

  RETURN QUERY SELECT s.id, s.factory_id, s.name, s.type, s.start_time, s.end_time, s.break_start, s.break_end, s.hours, s.created_at, s.updated_at, s.productive_mins FROM public.shifts s WHERE s.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_shift(text, uuid, uuid, text, text, time, time, time, time, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_shift(text, uuid, uuid, text, text, time, time, time, time, jsonb) TO authenticated;
