# Floor users — department apps, roles, and onboarding app integration

This document explains how **mobile (floor) users** work in PRODIGI, how they relate to the **`departments`** table, and how your **onboarding app** (or a **factory admin**) should create them.

---

## Core idea

```
departments.apps              →  capability pool (multi-select; hourly + qc both allowed)
process_flow_steps.capture_app →  one activity app per operation visit
profiles.assigned_apps        →  which apps THIS user may use (subset of department)
profiles.user_role            →  operator | supervisor | quality_manager | auditor
profiles.department_id        →  which work center the user belongs to (not per-operation)
```

**Example:** Cutting work center enables transaction, hourly, and qc_log. User gets all three. Route assigns Block Cut → `hourly`, Final Cut → `qc_log`. On the floor they pick order, then operation; each visit opens the app set on that operation.

They **cannot** be assigned `hourly` if Cutting does not have `hourly` in `departments.apps`.

---

## Where department apps are defined

### Table: `departments`

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid | Department ID — stored on `profiles.department_id` |
| `factory_id` | uuid | Factory this department belongs to |
| `name` | text | e.g. Sewing, Finishing |
| `sequence` | int | Order in process flow |
| `apps` | jsonb | **Enabled floor app IDs** for this department |

### Valid app IDs (`departments.apps`)

| ID | Mobile screen | Notes |
|----|---------------|-------|
| `transaction` | Transaction (handover) | Always on; added automatically if missing |
| `hourly` | Hourly Output | May coexist with qc_log on same work center |
| `qc_log` | Quality Check | Assigned per operation in Process Flows |
| `workforce_log` | Workforce | Workforce tracking option |
| `attendance` | Attendance | Workforce tracking option |
| `audit` | Audit Check | Optional add-on per dept |

Configured in main web app: **Settings → Departments →** pick department → enable apps.

Source of truth in code: `lib/floorApps.ts` (`DEPT_APP_OPTIONS`, `appsEnabledForDepartment`).

### Read departments in onboarding app

```sql
SELECT id, name, sequence, apps
FROM public.departments
WHERE factory_id = '<FACTORY_UUID>'
ORDER BY sequence;
```

Or via Supabase JS (service role on server):

```typescript
const { data: departments } = await admin
  .from('departments')
  .select('id, name, sequence, apps')
  .eq('factory_id', factoryId)
  .order('sequence');
```

Parse `apps` as `string[]`. Use the same filtering as `appsEnabledForDepartment()` in `lib/floorApps.ts` (skips `none`, always includes `transaction`).

---

## Floor user roles

Stored in `profiles.user_role`. Only these four can use the mobile app:

| Role | When to use | Typical `assigned_apps` |
|------|-------------|-------------------------|
| `operator` | Default scanner / production worker | Any subset of department apps |
| `supervisor` | Headcount / workforce for the dept | Often includes `workforce_log` or `attendance` if dept has them |
| `quality_manager` | Cross-dept QC (Quality dept) | `["qc_log", "transaction"]` — `department_id` is null |
| `auditor` | AQL audit for a dept | `["audit", "transaction"]` (only if dept has `audit`) |

**Web-only roles (not mobile):** `superadmin`, `admin`.

---

## Creating a floor user — fields to write

| Field | Required | Notes |
|-------|----------|-------|
| `factory_id` | yes | Target factory UUID |
| `full_name` | yes | Shown on mobile home |
| `employee_id` | yes | Unique per factory; used at login |
| `floor_pin` | yes | 4 digits; used at login |
| `department_id` | yes* | *Null only for `quality_manager` |
| `user_role` | yes | One of the four floor roles |
| `assigned_apps` | yes | JSON array; **subset of** department `apps` |
| `status` | yes | `Active` or `Inactive` |
| `email` | internal | Auth requires a user row; use synthetic email (see below) |

### Validation rule (enforce in UI and API)

```typescript
assigned_apps ⊆ appsEnabledForDepartment(departments.apps)
assigned_apps.length >= 1
```

Helper functions: `lib/floorUserUtils.ts`, `lib/floorApps.ts`.

### Synthetic email (floor users do not log in with email)

```typescript
// lib/floorUserUtils.ts
syntheticFloorUserEmail(employeeId, factoryCode)
// → floor.emp-001.acme-garments-a1b2@prodigi.local
```

Create auth user with service role; operator never uses this email.

---

## Who can create floor users?

| Actor | Scope | How |
|-------|-------|-----|
| **Factory admin** | Their factory only | Main web app → **User Management** (`#/user-management`) |
| **Superadmin** | Any factory | **Onboarding app** → “Create floor user” (service-role API) |

RLS ensures factory admins only read/write `profiles` where `factory_id = current_factory_id()`. Superadmin uses **service role** on the server to target any `factory_id`.

---

## Onboarding app — recommended screens

### 1. Login (superadmin only)

- Email + password via Supabase Auth
- After login: `SELECT user_role FROM profiles WHERE id = auth.uid()`
- Allow only `user_role = 'superadmin'`; sign out others

### 2. Factories list

- List all factories (service role): `SELECT id, name, code, country FROM factories`

### 3. Create factory admin

- Factory picker, name, email, password
- `auth.admin.createUser` + `profiles` insert with `user_role = 'admin'`

### 4. Create floor user (per factory)

**Step A — Load departments for selected factory**

```typescript
const departments = await loadDepartments(factoryId);
```

**Step B — User picks department**

When department changes, compute available apps:

```typescript
import { appsEnabledForDepartment } from './floorApps'; // copy or share package

const availableApps = appsEnabledForDepartment(selectedDept.apps);
// Show checkboxes — user picks one or more (must pick at least one)
```

**Step C — User picks role**

```typescript
import { rolesAvailableForDepartment } from './floorUserUtils';

const roles = rolesAvailableForDepartment(selectedDept.apps, isQualityDept);
// operator always; supervisor if workforce/attendance; auditor if audit
```

**Step D — Submit (server API with service role)**

```typescript
// POST /api/onboarding/floor-users
const email = syntheticFloorUserEmail(employeeId, factoryCode);
const password = crypto.randomUUID(); // random; never shared

const { data: authUser } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});

await admin.from('profiles').insert({
  id: authUser.user.id,
  factory_id: factoryId,
  full_name: fullName,
  email,
  user_role: role,
  department_id: role === 'quality_manager' ? null : departmentId,
  employee_id: employeeId,
  floor_pin: floorPin,
  assigned_apps: selectedApps, // e.g. ["transaction","qc_log"]
  status: 'Active',
});
```

### 5. Optional — seed departments when creating factory

When adding a factory, insert starter departments (see `scripts/onboard-factory.sql` step 3). Factory admin can change apps later in Settings.

---

## SQL example — one floor user in Sewing with QC only

```sql
-- Prerequisite: Sewing dept exists with apps ["transaction","qc_log","audit"]
-- Prerequisite: auth user created (or use onboarding API)

INSERT INTO public.profiles (
  id,
  factory_id,
  full_name,
  email,
  user_role,
  department_id,
  employee_id,
  floor_pin,
  assigned_apps,
  status
)
SELECT
  '<AUTH_USER_UUID>'::uuid,
  f.id,
  'Ravi Kumar',
  'floor.ravi-kumar.acme-garments-a1b2@prodigi.local',
  'operator',
  d.id,
  'EMP-042',
  '1234',
  '["transaction","qc_log"]'::jsonb,
  'Active'
FROM public.factories f
JOIN public.departments d ON d.factory_id = f.id AND d.name = 'Sewing'
WHERE f.code = 'acme-garments-a1b2';
```

---

## How the mobile app reads this

1. User enters **Factory ID** (`factories.code`), **Employee ID**, **PIN**
2. API calls `verify_floor_login(factory_code, employee_id, pin)` (see `supabase/schema.sql`)
3. Returns profile including `assigned_apps`
4. `plapps/lib/floorAppMap.ts` maps IDs to routes:

| `assigned_apps` ID | Mobile route |
|------------------|--------------|
| `hourly` | `/floor/hourly` |
| `transaction` | `/floor/transaction` |
| `qc_log` | `/floor/quality` |
| `audit` | `/floor/audit` |
| `workforce_log` | `/floor/workforce` |
| `attendance` | `/floor/attendance` |

Home screen (`plapps/app/floor/home/page.tsx`) shows only tiles for `assigned_apps`.

---

## End-to-end flow

```
1. Superadmin or factory admin configures departments (Settings)
      → departments.apps = max app set per dept

2. Superadmin (onboarding) OR factory admin (User Management)
      → create profile with department_id + assigned_apps (subset) + role + PIN

3. Operator opens PRODIGI Floor
      → Factory ID + Employee ID + PIN
      → sees only their assigned_apps tiles
```

---

## Files to reference in this repo

| Topic | Path |
|-------|------|
| Department app catalog | `lib/floorApps.ts` |
| Floor user validation helpers | `lib/floorUserUtils.ts` |
| Factory admin UI | `pages/system/UserManagement.tsx` |
| Department editor (enable apps) | `components/settings/DepartmentEditor.tsx` |
| DB schema | `supabase/schema.sql` — `departments`, `profiles`, `verify_floor_login` |
| Mobile app mapping | `plapps/lib/floorAppMap.ts` |
| Mobile home | `plapps/app/floor/home/page.tsx` |
| Starter departments SQL | `scripts/onboard-factory.sql` |

---

## Checklist for onboarding app developer

- [ ] Superadmin-only login gate
- [ ] List factories (service role)
- [ ] Create factory + factory admin
- [ ] Load `departments` for selected `factory_id`
- [ ] Show app checkboxes from `appsEnabledForDepartment(dept.apps)` only
- [ ] Enforce `assigned_apps` ⊆ department apps, at least one app
- [ ] Role dropdown from `rolesAvailableForDepartment()`
- [ ] Create auth user (synthetic email) + `profiles` row with `employee_id`, `floor_pin`
- [ ] Never expose service role key in the browser
