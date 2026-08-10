# PRODIGI — Three apps, three audiences

PRODIGI is split into **three separate applications**. They share one Supabase database but serve different people at different stages.

> **Stack (this repo):** Vite 6 + React 19 SPA (desktop admin). Not Next.js.
> Floor capture lives in a separate plapps app. Onboarding is a separate superadmin app.
> Offline for desktop = TanStack Query **read-cache** only (no mutation queue).
> User create/update/delete = **Edge Functions only** (`admin-create-user`, `admin-update-user`, `admin-delete-user`) — not RPCs. See [`docs/SCHEMA_BACKLOG.md`](./SCHEMA_BACKLOG.md).

```
                    ┌─────────────────────────────┐
                    │   ONBOARDING APP (RBC)      │
                    │   Login: superadmin only    │
                    │   • Add new factories       │
                    │   • Create factory admins   │
                    └──────────────┬──────────────┘
                                   │ provisions
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  PRODIGI WEB     │   │  PRODIGI WEB     │   │  PRODIGI FLOOR   │
│  (Vite SPA)      │   │  (Vite SPA)      │   │  (plapps — sep.) │
│  Factory A admin │   │  Factory B admin │   │  Factory A ops   │
│  email + password│   │  email + password│   │  email + PIN     │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

---

## 1. Onboarding app (your new simple app)

**Who:** RBC staff only (you, e.g. `rahil@rajeshbheda.com` as **superadmin**).

**Login screen:** Email + password — **no** “setup factory”, **no** public signup. Only users with `user_role = 'superadmin'` may use this app (enforce in app after login).

**After login, superadmin can:**

| Action | What it creates |
|--------|-----------------|
| **Add factory** | Row in `factories` (name, code, country). The `code` is the **Factory ID** used on floor tablets. |
| **Create factory admin** | Auth user + `profiles` row with `user_role = 'admin'` and `factory_id` = that factory |
| **Create floor users** (optional) | `profiles` with `employee_id`, `floor_pin`, `department_id`, `user_role`, `assigned_apps` |

**Floor user rule:** `assigned_apps` on each user must be a **subset** of `departments.apps` for their department. Example: Sewing has QC + Audit on → user can get both or only one. See **`docs/ONBOARDING_FLOOR_USERS.md`**.

**Who creates floor users:**

- **Factory admin** — User Management in main web app (their factory only)
- **Superadmin** — onboarding app with service role (any factory)

**What superadmin does NOT do here:**

- Run production or capture data (that is the main web + floor apps)

**Technical note:** This app should call Supabase with the **service role** on the server (API routes), never expose that key in the browser. Login uses normal Supabase Auth; only `superadmin` profiles pass the gate.

---

## 2. What is a superadmin?

| | Superadmin | Factory admin |
|---|------------|----------------|
| **Role in DB** | `profiles.user_role = 'superadmin'` | `profiles.user_role = 'admin'` |
| **Which app** | Onboarding app (+ optional web for your own factory) | Main PRODIGI web app |
| **Scope** | All factories (via onboarding app + Supabase) | **One** factory only |
| **Creates** | Factories, factory admins, floor users (optional) | Orders, settings, floor users (operators) |
| **Typical person** | RBC / platform owner | Customer plant manager |

There is only a **small number** of superadmins (RBC team). Every customer factory gets **one or more admins**, not superadmins.

---

## 3. Main PRODIGI web app

**Who:** Factory admins (and supervisors if you give them web access later).

**Login:** Email + password only. **No** factory creation. **No** “create admin” for other factories.

**If someone is not onboarded:** They see “contact RBC” on login — they cannot self-register.

**Factory admin workflow:**

1. Sign in with credentials created in the **onboarding app**
2. Configure **Settings** (departments, shifts, flows)
3. **User Management** — create floor users with:
   - Employee ID + Floor PIN (mobile login)
   - Department
   - App role (operator / supervisor / quality_manager / auditor)
   - **Floor apps** — checkboxes from that department’s `apps` column (user gets all or a subset)
4. Planning, orders, reports, etc.

Departments define **which apps** exist (hourly, QC, transaction, etc.). There is no separate “activity name” on users — role + department + `assigned_apps` is enough.

---

## 4. PRODIGI Floor (mobile / tablets)

**Who:** Operators, supervisors, QC, auditors.

**Login:** Factory ID + Employee ID + PIN (not email).

**Shows:** Only apps in `assigned_apps` for that user. Department name comes from `profiles.department_id`.

---

## End-to-end: onboarding a new customer

1. **You (superadmin)** — open **onboarding app**, sign in  
2. **Add factory** — e.g. name “Acme Garments”, code `acme-garments-a1b2`  
3. **Create admin** — e.g. `admin@acme.com`, password, linked to Acme factory  
4. **Hand off to customer** — web URL, email, password, Factory ID `acme-garments-a1b2`  
5. **Customer admin** — signs into **main web app**, sets up departments (which apps each dept has), creates floor users in User Management  
6. **Operators** — use **floor app** with Factory ID + employee ID + PIN; home screen shows only their `assigned_apps`  

**Onboarding app floor users:** Superadmin can seed initial operators the same way (read `departments`, pick subset of `apps` per user). Full API spec: `docs/ONBOARDING_FLOOR_USERS.md`.

---

## Bootstrap superadmin (one-time)

If the onboarding app is not deployed yet, use SQL:

1. Auth → create `rahil@rajeshbheda.com`  
2. Run `scripts/bootstrap-superadmin.sql`  

Then wire the onboarding app to accept only `user_role === 'superadmin'` after `signInWithPassword`.

---

## Security rules

- **Onboarding app:** superadmin login only; server uses service role for `factories` insert and admin `profiles` + Auth user create  
- **Main web:** no `factories` insert from client; admins scoped to `factory_id` via RLS; desktop roles `admin` | `superadmin` (see `lib/routeAccess.ts`)  
- **Floor:** email + PIN via `verify_floor_pin`; no long-lived service role on device  
- **User management (desktop):** Edge Functions only — `admin-create-user`, `admin-update-user`, `admin-delete-user`. Companion RPCs `create_factory_floor_user` / `replace_floor_user_access` are called with the **caller JWT** (not service role). Do not add `save_factory_user` / `update_factory_user` RPCs.  

---

## Summary in one sentence

**Superadmin** uses the **onboarding app** to create factories and **factory admins**; **factory admins** use the **main web app** for everything inside their plant; **operators** use the **floor app** to capture production.
