# Store and Outsource — Mobile PWA Objectives

> Design reference only. No floor PWA build in this change set.

Related: [FLOOR_USER_ACCESS_BY_DEPARTMENT.md](./FLOOR_USER_ACCESS_BY_DEPARTMENT.md)

---

## Personas

| Work center | Floor role | Apps |
|-------------|------------|------|
| **Store** (`planning_mode = storage`) | Supervisor only | Handover (receive, hold, send) |
| **Outsource** (`planning_mode = outsource`) | Supervisor only | Handover + vendor send/receive |

Operators are **not** assignable on store or outsource work centers.

---

## Store supervisor flow

```
Previous department --handover--> Store visit --handover--> Next department
```

1. **Receive** — accept challan from previous department (size breakdown optional).
2. **Hold** — pieces remain in store WIP (no hourly capture).
3. **Send** — handover to next department when ready.

All movement is on `handover_slips`. No vendor ledger.

---

## Outsource supervisor flow

```
Previous department --handover--> Outsource visit
Outsource visit --vendor_send--> Vendor (assigned_resources row)
Vendor --vendor_receive--> Outsource visit
Outsource visit --handover--> Next department
```

1. **Receive** from previous department via normal handover.
2. **Choose vendor** from the work center **vendor catalog** (`assigned_resources` where `resource_type = outsourced`). Vendors are defined in Work center settings — one row per vendor.
3. **Vendor send** — log `outsource_work_movements` (`movement_type = vendor_send`) against `vendor_resource_id`. Link to planning allocation when available. Challan + qty-by-size.
4. **Vendor receive** — partial returns OK; each receive links to `linked_send_id`. Cumulative receive cannot exceed send qty.
5. **Send onward** — handover to next department gated on **returned** stock (vendor receives minus already sent to next dept).

Department-to-department legs stay on `handover_slips`. Factory ↔ vendor legs stay on `outsource_work_movements` only — never double-counted in handover reports.

---

## Vendor master

- **Single source:** `assigned_resources` scoped to the outsource department.
- **Planning:** `line_allocations.line_id` = vendor resource id (same id used at capture).
- **No** separate vendor permissions per user — supervisors in that department transact against any vendor in the catalog.

---

## Offline / idempotency

- Vendor send/receive RPCs accept `idempotency_key` for replay-safe mobile capture.
- Void is controlled (`void_outsource_work_movement`); cannot void a send while linked receives exist.

---

## Reporting outcomes

- **Transaction report** — separate “Outsourced work” tab (vendor, type, qty, challan).
- **Day report** — store: received/sent handovers; outsource: handovers + vendor movement table.
- **Style journey / matrix** — outsource visit “produced” = vendor **returned** qty, not hourly output.
