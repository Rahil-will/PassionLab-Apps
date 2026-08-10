# Factory floor app entitlements

> Controls which floor apps a factory can assign in **Settings → Departments** and **User Management**. Set at onboarding via `public.factories` JSONB columns (service role only).

---

## Schema (`public.factories`)

| Column | Allowed values | Default |
|--------|----------------|---------|
| `transaction_apps` | `["transaction"]` | `["transaction"]` |
| `production_apps` | `hourly`, `qc_log`, `batch` (per path) | `["hourly","qc_log","batch"]` |
| `workforce_apps` | `supervisor` | `["supervisor"]` |
| `audit_apps` | `audit` | `["audit"]` |
| `shipment_apps` | `shipment_log`, `final_rejection_log` | both |

Migration: `supabase/migrations/20260627100000_factory_app_entitlements.sql`

**Rules in the product**

- Each work center picks one **production path**: hourly (Hourly and/or QC), batch, or native cutting (origin only).
- **Supervisory app** (`supervisor`) — supervisors allocate workforce (hourly path) or view style performance.
- User Management only lists department apps that are both **department-enabled** and **factory-entitled**.
- **Shipment / QA** is one assignment mode (not two tiles). It grants all IDs in `shipment_apps`.
- If `shipment_apps` is `[]`, the Shipment / QA assignment mode is hidden.

---

## Onboarding SQL example

```sql
INSERT INTO public.factories (
  name, code, country,
  transaction_apps,
  production_apps,
  workforce_apps,
  audit_apps,
  shipment_apps
) VALUES (
  'Lean Unit Co',
  'lean-unit-x9f2',
  'IN',
  '["transaction"]'::jsonb,
  '["hourly"]'::jsonb,              -- no QC floor app
  '["attendance"]'::jsonb,          -- attendance only
  '[]'::jsonb,                      -- no audit
  '["shipment_log","final_rejection_log"]'::jsonb
)
RETURNING id, code;
```

Update an existing factory:

```sql
UPDATE public.factories
SET
  production_apps = '["qc_log"]'::jsonb,
  workforce_apps = '["workforce_log"]'::jsonb,
  audit_apps = '[]'::jsonb
WHERE code = 'acme-garments-a1b2';
```

After changing entitlements, admins should re-open **Settings → Departments** and save departments so `departments.apps` does not retain disabled app IDs.

---

## Prompt for the onboarding app (frontend wiring)

Copy this to the onboarding app agent:

---

**Task:** Wire factory creation/edit to PRODIGI floor app entitlements.

**Context:** PRODIGI stores per-factory floor app entitlements on `public.factories` as five JSONB array columns. The main app reads these on login (via `fetchSettings`) and filters Department + User Management UI. Onboarding must set these columns when creating or editing a factory (service role).

**Columns (all JSONB arrays of string app IDs):**

| Column | Valid IDs |
|--------|-----------|
| `transaction_apps` | `transaction` |
| `production_apps` | `hourly`, `qc_log` |
| `workforce_apps` | `workforce_log`, `attendance` |
| `audit_apps` | `audit` |
| `shipment_apps` | `shipment_log`, `final_rejection_log` |

**UI suggestion for onboarding form:**

1. **Transaction** — checkbox (default on; usually always `["transaction"]`).
2. **Production** — multi-select: Hourly Output, QC Log (at least one if factory runs floor capture).
3. **Workforce** — multi-select: Workforce Log, Attendance.
4. **Audit** — checkbox: Audit app.
5. **Shipment / QA** — single checkbox; when on, set `shipment_apps` to `["shipment_log","final_rejection_log"]`; when off, `[]`.

**API / Supabase insert (service role):**

```typescript
await supabase.from('factories').insert({
  name,
  code,
  country,
  transaction_apps: transactionEnabled ? ['transaction'] : [],
  production_apps: productionSelected,      // e.g. ['hourly'] or ['hourly','qc_log']
  workforce_apps: workforceSelected,
  audit_apps: auditEnabled ? ['audit'] : [],
  shipment_apps: shipmentQaEnabled
    ? ['shipment_log', 'final_rejection_log']
    : [],
});
```

**Edit flow:** `UPDATE factories SET ... WHERE id = ?` with the same shape.

**Validation:**

- `transaction_apps` should include `transaction` for normal factories.
- `production_apps` and `workforce_apps` entries must be from the valid ID lists above.
- Empty array = category disabled in PRODIGI admin UI.

**Do not** store entitlements on departments or profiles — only on `factories`. Department `apps` JSONB remains per-department configuration within the factory entitlement ceiling.

**Reference:** `docs/FACTORY_APP_ENTITLEMENTS.md`, migration `20260627100000_factory_app_entitlements.sql`, `lib/factoryEntitlements.ts`.

---

## App code map

| File | Role |
|------|------|
| `lib/factoryEntitlements.ts` | Types, defaults, `sanitizeDepartmentApps` |
| `lib/floorApps.ts` | Filter `departmentFloorApps` by entitlements |
| `lib/floorUserUtils.ts` | User Management; single Shipment / QA label |
| `stores/settingsStore.ts` | Loads entitlements with settings |
| `components/settings/DepartmentEditor.tsx` | Hides non-entitled app chips |
| `pages/system/UserManagement.tsx` | Filters assignable apps |

---

## Floor PWA (plapps) — what must change

Entitlements are enforced in **admin** (Settings + User Management). The floor app still needs two things:

1. **Map `assigned_apps` DB keys → floor tiles** — `plapps/lib/floorAppMap.ts` → `mapAssignedAppsToFloor()` (fixes QC, workforce, shipment tiles).
2. **Bootstrap should return factory entitlements** — extend `/api/floor/bootstrap` to include `transaction_apps`, `production_apps`, etc. Then filter tiles in `home/page.tsx` so revoked factory apps never appear even if stale profile data exists.

`floor_capture` on the server already enforces `department.apps` + `profiles.assigned_apps`; entitlements are the ceiling set at onboarding before departments are configured.
