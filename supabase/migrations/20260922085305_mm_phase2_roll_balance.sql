ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS qty_uom text,
  ADD COLUMN IF NOT EXISTS qty_declared numeric(12,3),
  ADD COLUMN IF NOT EXISTS qty_received numeric(12,3),
  ADD COLUMN IF NOT EXISTS qty_available numeric(12,3);

ALTER TABLE public.mm_stock_ledger
  ADD COLUMN IF NOT EXISTS qty numeric(12,3),
  ADD COLUMN IF NOT EXISTS qty_uom text,
  ADD COLUMN IF NOT EXISTS qty_after numeric(12,3);

UPDATE public.mm_stock_units
SET qty_uom = COALESCE(NULLIF(uom, ''), 'm'),
    qty_declared = COALESCE(length_m, 0),
    qty_received = COALESCE(length_m, 0),
    qty_available = COALESCE(length_m, 0)
WHERE qty_available IS NULL;

ALTER TABLE public.mm_stock_units ALTER COLUMN qty_uom SET DEFAULT 'm';
ALTER TABLE public.mm_stock_units ALTER COLUMN qty_available SET DEFAULT 0;
UPDATE public.mm_stock_units SET qty_uom = COALESCE(qty_uom, 'm') WHERE qty_uom IS NULL;
UPDATE public.mm_stock_units SET qty_available = COALESCE(qty_available, 0) WHERE qty_available IS NULL;
ALTER TABLE public.mm_stock_units ALTER COLUMN qty_uom SET NOT NULL;
ALTER TABLE public.mm_stock_units ALTER COLUMN qty_available SET NOT NULL;

ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_qty_avail_chk;
ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_qty_avail_chk CHECK (qty_available >= 0);
ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_qty_cap_chk;
ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_qty_cap_chk CHECK (qty_received IS NULL OR qty_available <= qty_received + 0.001);

UPDATE public.mm_stock_ledger
SET qty_delta = 0
WHERE entry_type NOT IN (
  'RECEIPT_IN','INHOUSE_IN','CONSUME','WASTE','QC_DEDUCT','ADJUST_PLUS','ADJUST_MINUS','REVERSAL','WRITE_OFF','RETURN_TO_SUPPLIER'
);

WITH sums AS (
  SELECT stock_unit_id, COALESCE(sum(qty_delta), 0) AS s
  FROM public.mm_stock_ledger
  GROUP BY stock_unit_id
),
earliest AS (
  SELECT DISTINCT ON (stock_unit_id) id, stock_unit_id
  FROM public.mm_stock_ledger
  ORDER BY stock_unit_id, created_at, id
)
UPDATE public.mm_stock_ledger l
SET qty_delta = l.qty_delta + (u.length_m - COALESCE(sums.s, 0))
FROM earliest e
JOIN public.mm_stock_units u ON u.id = e.stock_unit_id
LEFT JOIN sums ON sums.stock_unit_id = u.id
WHERE l.id = e.id
  AND abs(u.length_m - COALESCE(sums.s, 0)) > 0.001;

INSERT INTO public.mm_stock_ledger (
  factory_id, stock_unit_id, entry_type, qty_delta, balance_after,
  status_before, status_after, note, txn_at
)
SELECT u.factory_id, u.id, 'ADJUST_PLUS', u.length_m, u.length_m,
       u.status, u.status, 'opening balance', now()
FROM public.mm_stock_units u
WHERE NOT EXISTS (
  SELECT 1 FROM public.mm_stock_ledger l WHERE l.stock_unit_id = u.id
);

UPDATE public.mm_stock_ledger
SET qty = abs(qty_delta),
    qty_after = balance_after,
    qty_uom = 'm'
WHERE qty IS NULL;;
