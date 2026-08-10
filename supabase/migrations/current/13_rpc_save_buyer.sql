-- =============================================================================
-- save_buyer RPC
-- Atomic insert/update/delete for buyers. Delete is blocked if style_orders
-- reference this buyer; size_groups remain (buyer_id SET NULL on delete).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_buyer(
  p_action                  text,
  p_factory_id              uuid,
  p_id                      uuid DEFAULT NULL,
  p_name                    text DEFAULT NULL,
  p_code                    text DEFAULT NULL,
  p_country                 text DEFAULT NULL,
  p_type                    text DEFAULT NULL,
  p_status                  text DEFAULT NULL,
  p_contact_name            text DEFAULT NULL,
  p_contact_email           text DEFAULT NULL,
  p_contact_phone           text DEFAULT NULL,
  p_contact_role            text DEFAULT NULL,
  p_over_shipment_pct       numeric DEFAULT NULL,
  p_under_shipment_pct      numeric DEFAULT NULL,
  p_packing_rule            text DEFAULT NULL,
  p_ship_mode               text DEFAULT NULL,
  p_destination             text DEFAULT NULL,
  p_currency                text DEFAULT NULL,
  p_ship_mode_options       jsonb DEFAULT NULL,
  p_shipment_type_options   jsonb DEFAULT NULL,
  p_destination_countries   jsonb DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  factory_id            uuid,
  name                  text,
  code                  text,
  country               text,
  type                  text,
  status                text,
  contact_name          text,
  contact_email         text,
  contact_role          text,
  over_shipment_pct     numeric,
  under_shipment_pct    numeric,
  packing_rule          text,
  created_at            timestamptz,
  updated_at            timestamptz,
  ship_mode             text,
  destination           text,
  currency              text,
  ship_mode_options     jsonb,
  shipment_type_options jsonb,
  contact_phone         text,
  destination_countries text[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    IF EXISTS (
      SELECT 1 FROM public.style_orders WHERE buyer_id = p_id AND factory_id = v_factory_id
    ) THEN
      RAISE EXCEPTION 'Cannot delete buyer: referenced by existing orders';
    END IF;
    DELETE FROM public.buyers b WHERE b.id = p_id AND b.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Buyer name is required';
  END IF;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.buyers (
      id, factory_id, name, code, country, type, status,
      contact_name, contact_email, contact_phone, contact_role,
      over_shipment_pct, under_shipment_pct, packing_rule,
      ship_mode, destination, currency,
      ship_mode_options, shipment_type_options, destination_countries
    ) VALUES (
      v_id, v_factory_id, trim(p_name), p_code, p_country,
      COALESCE(p_type, 'Retail'), COALESCE(p_status, 'Active'),
      p_contact_name, p_contact_email, p_contact_phone, p_contact_role,
      COALESCE(p_over_shipment_pct, 0), COALESCE(p_under_shipment_pct, 0), COALESCE(p_packing_rule, 'Ratio'),
      p_ship_mode, p_destination, p_currency,
      COALESCE(p_ship_mode_options, '[]'::jsonb),
      COALESCE(p_shipment_type_options, '[]'::jsonb),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_destination_countries) x), '{}'::text[])
    );
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.buyers b SET
      name                  = COALESCE(NULLIF(trim(p_name), ''), b.name),
      code                  = COALESCE(p_code, b.code),
      country               = COALESCE(p_country, b.country),
      type                  = COALESCE(p_type, b.type),
      status                = COALESCE(p_status, b.status),
      contact_name          = COALESCE(p_contact_name, b.contact_name),
      contact_email         = COALESCE(p_contact_email, b.contact_email),
      contact_phone         = COALESCE(p_contact_phone, b.contact_phone),
      contact_role          = COALESCE(p_contact_role, b.contact_role),
      over_shipment_pct     = COALESCE(p_over_shipment_pct, b.over_shipment_pct),
      under_shipment_pct    = COALESCE(p_under_shipment_pct, b.under_shipment_pct),
      packing_rule          = COALESCE(p_packing_rule, b.packing_rule),
      ship_mode             = COALESCE(p_ship_mode, b.ship_mode),
      destination           = COALESCE(p_destination, b.destination),
      currency              = COALESCE(p_currency, b.currency),
      ship_mode_options     = COALESCE(p_ship_mode_options, b.ship_mode_options),
      shipment_type_options = COALESCE(p_shipment_type_options, b.shipment_type_options),
      destination_countries = COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_destination_countries) x), b.destination_countries),
      updated_at            = now()
    WHERE b.id = v_id AND b.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Buyer not found'; END IF;
  END IF;

  RETURN QUERY SELECT b.id, b.factory_id, b.name, b.code, b.country, b.type, b.status, b.contact_name, b.contact_email, b.contact_role, b.over_shipment_pct, b.under_shipment_pct, b.packing_rule, b.created_at, b.updated_at, b.ship_mode, b.destination, b.currency, b.ship_mode_options, b.shipment_type_options, b.contact_phone, b.destination_countries FROM public.buyers b WHERE b.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_buyer(text, uuid, uuid, text, text, text, text, text, text, text, text, text, numeric, numeric, text, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_buyer(text, uuid, uuid, text, text, text, text, text, text, text, text, text, numeric, numeric, text, text, text, text, jsonb, jsonb, jsonb) TO authenticated;
