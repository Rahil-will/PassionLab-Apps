# Production Planning Summary — Print Template

Reference for how the **Production Planning Summary** PDF/print output should look.

## Files

| File | Purpose |
|------|---------|
| `planning-summary.print.css` | Print-only styles (`@page`, table fit, no scrollbars) |
| `planning-summary.reference.html` | Static HTML snapshot of the expected layout |

## Layout (A4 landscape)

1. **Header card** — style image, style/PO/buyer/delivery/SAM/garment/colorway/adj qty
2. **One block per colorway** (or single block when one colorway is selected)
   - Color name + adj qty
   - Planning table: Dept, Resource, WF, Start, End, Qty, Days, Daily, Hourly, Eff%, Prod
   - Total planned row
   - Remarks (read-only in print)

## Rules

- No horizontal scrollbars in print
- All 11 table columns visible on one page width
- Browser chrome (URL, date) is controlled by the user's print dialog — disable headers/footers there for a clean PDF
- Screen UI lives in `pages/planning/components/SummaryModal.tsx`; print CSS is imported from this folder
