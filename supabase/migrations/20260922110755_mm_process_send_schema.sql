ALTER TABLE public.mm_mill_rolls DROP CONSTRAINT mm_mill_rolls_status_chk;
ALTER TABLE public.mm_mill_rolls
  ADD CONSTRAINT mm_mill_rolls_status_chk
  CHECK (status = ANY (ARRAY['draft'::text, 'dispatched'::text, 'processed'::text]));

ALTER TABLE public.mm_mill_rolls
  ADD COLUMN parent_mill_roll_id uuid REFERENCES public.mm_mill_rolls(id);

ALTER TABLE public.mm_stock_units DROP CONSTRAINT mm_stock_units_status_chk;
ALTER TABLE public.mm_stock_units
  ADD CONSTRAINT mm_stock_units_status_chk
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'in_transit'::text, 'pending_qc'::text, 'in_stock'::text,
    'rejected'::text, 'issued'::text, 'consumed'::text, 'returned_to_supplier'::text,
    'missing'::text, 'written_off'::text, 'at_process'::text
  ]));

ALTER TABLE public.mm_stock_units
  ADD COLUMN parent_stock_unit_id uuid REFERENCES public.mm_stock_units(id);

CREATE TABLE public.mm_process_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX mm_process_types_name_uidx
  ON public.mm_process_types (factory_id, lower(btrim(name)));

CREATE TABLE public.mm_process_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX mm_process_vendors_name_uidx
  ON public.mm_process_vendors (factory_id, lower(btrim(name)));

CREATE TABLE public.mm_process_vendor_types (
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.mm_process_vendors(id) ON DELETE CASCADE,
  process_type_id uuid NOT NULL REFERENCES public.mm_process_types(id) ON DELETE RESTRICT,
  PRIMARY KEY (vendor_id, process_type_id)
);

CREATE TABLE public.mm_process_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_no text NOT NULL,
  origin text NOT NULL CHECK (origin = ANY (ARRAY['mill'::text, 'warehouse'::text])),
  vendor_id uuid NOT NULL REFERENCES public.mm_process_vendors(id) ON DELETE RESTRICT,
  process_type_id uuid NOT NULL REFERENCES public.mm_process_types(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open'::text, 'partial'::text, 'returned'::text])),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  returned_at timestamptz
);

CREATE UNIQUE INDEX mm_process_challans_no_uidx
  ON public.mm_process_challans (factory_id, lower(btrim(challan_no)));

CREATE TABLE public.mm_process_out_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.mm_process_challans(id) ON DELETE CASCADE,
  mill_roll_id uuid REFERENCES public.mm_mill_rolls(id),
  stock_unit_id uuid REFERENCES public.mm_stock_units(id),
  unit_code text NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  uom text NOT NULL,
  shade text,
  lot_no text,
  color_ref text,
  line_status text NOT NULL DEFAULT 'out' CHECK (line_status = ANY (ARRAY['out'::text, 'returned'::text, 'replaced'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(mill_roll_id, stock_unit_id) = 1)
);

CREATE UNIQUE INDEX mm_process_out_open_mill_uidx
  ON public.mm_process_out_lines (mill_roll_id)
  WHERE line_status = 'out' AND mill_roll_id IS NOT NULL;

CREATE UNIQUE INDEX mm_process_out_open_stock_uidx
  ON public.mm_process_out_lines (stock_unit_id)
  WHERE line_status = 'out' AND stock_unit_id IS NOT NULL;

CREATE TABLE public.mm_process_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.mm_process_challans(id) ON DELETE CASCADE,
  out_line_id uuid NOT NULL REFERENCES public.mm_process_out_lines(id) ON DELETE RESTRICT,
  same_identity boolean NOT NULL,
  unit_code text NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  uom text NOT NULL,
  shade text,
  color_ref text,
  lot_no text,
  mill_roll_id uuid REFERENCES public.mm_mill_rolls(id),
  stock_unit_id uuid REFERENCES public.mm_stock_units(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

SELECT public._mm_lockdown_table('public.mm_process_types'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_vendors'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_vendor_types'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_challans'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_out_lines'::regclass);
SELECT public._mm_lockdown_table('public.mm_process_return_lines'::regclass);

INSERT INTO public.mm_process_types (factory_id, name, sort_order, active)
SELECT f.factory_id, t.name, t.ord, true
FROM (
  SELECT DISTINCT factory_id
  FROM public.factory_modules
  WHERE module_key = 'material' AND enabled
) f
CROSS JOIN (
  VALUES ('Dyeing', 1), ('Printing', 2), ('Washing', 3), ('Embroidery', 4)
) AS t(name, ord)
ON CONFLICT (factory_id, lower(btrim(name))) DO NOTHING;

CREATE OR REPLACE FUNCTION public._mm_counts_as_received(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $fn$
  SELECT p_status IN ('pending_qc', 'in_stock', 'rejected', 'issued', 'consumed', 'at_process');
$fn$;

CREATE OR REPLACE FUNCTION public.mm_stock_unit_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $fn$
DECLARE
  v_type text;
BEGIN
  IF NEW.current_location_id IS NULL THEN
    v_type := NULL;
  ELSE
    SELECT location_type INTO v_type
    FROM public.mm_locations
    WHERE id = NEW.current_location_id;
  END IF;

  IF NEW.status IN ('draft', 'in_transit')
     AND NOT (NEW.current_location_id IS NULL OR v_type = 'virtual') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'pending_qc' AND v_type IS DISTINCT FROM 'receiving' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'in_stock' AND COALESCE(v_type, '') NOT IN ('receiving', 'rack', 'bin') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'rejected' AND v_type IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'issued' AND v_type IS DISTINCT FROM 'cutting' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'at_process' AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status IN ('consumed', 'returned_to_supplier', 'missing', 'written_off')
        AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  END IF;
  RETURN NEW;
END;
$fn$;
;
