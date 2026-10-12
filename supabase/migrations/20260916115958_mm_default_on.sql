-- Material module ON by default for all factories (product decision).
-- Idempotently seed FABRIC/TRIMS groups so Work Centres Materials can save types.

UPDATE public.factory_modules
SET
  enabled = true,
  enabled_at = COALESCE(enabled_at, now()),
  updated_at = now()
WHERE module_key = 'material'
  AND enabled IS DISTINCT FROM true;

INSERT INTO public.mm_material_groups (
  factory_id, code, name, unit_kind, qc_default, allows_inhouse, feeds_cutting,
  default_uom, end_bit_threshold, is_system, is_active
)
SELECT
  f.id,
  g.code,
  g.name,
  g.unit_kind,
  g.qc_default,
  g.allows_inhouse,
  g.feeds_cutting,
  g.default_uom,
  g.end_bit_threshold,
  true,
  true
FROM public.factories f
CROSS JOIN (
  VALUES
    ('FABRIC', 'Fabric', 'roll', 'required', true, true, 'm', 0.5::numeric),
    ('TRIMS', 'Trims', 'pack', 'optional', false, false, 'pcs', NULL::numeric)
) AS g(code, name, unit_kind, qc_default, allows_inhouse, feeds_cutting, default_uom, end_bit_threshold)
ON CONFLICT (factory_id, code) DO NOTHING;

COMMENT ON TABLE public.factory_modules IS
  'Per-factory module entitlement. Defaults: core/production/shipment/material ON. Writes via set_factory_module.';;
