# PRODIGI — Secure Factory Onboarding (RBC Operators Only)

> **The main app login screen is sign-in only.** Factory creation and first-admin setup are **not** exposed in the product UI. New tenants are provisioned by RBC using Supabase service-role access.

---

## Why self-service factory setup was removed

After the schema migration, the old “Setup Factory” / “Create Admin” buttons fail for good security reasons:

| Step | What the UI tried | Why it fails |
|------|-------------------|--------------|
| Create factory | `anon` insert into `factories` | Open to anyone on the internet if left enabled |
| Create auth user | `signUp` from browser | Email confirmation may block session; no trusted operator |
| Create profile | `profiles` insert | RLS only allows `id = auth.uid()` — first admin has no profile yet |
| Secret code | Shown in UI | Was never validated server-side |

**Safest model:** RBC provisions factory + first admin **out-of-band** with the **service role key** (never shipped to browsers or floor tablets).

---

## Security principles

1. **Service role key** — only on RBC secure machine / CI secret store. Never in `.env` committed to git, never in the Vite or Next.js client bundle.
2. **No anon factory insert** — `factories` table is read-only from the client; inserts via SQL Editor or scripted onboarding only.
3. **One admin per factory at onboarding** — floor users are created by the factory admin (User Management) or by superadmin in the onboarding app. See `docs/ONBOARDING_FLOOR_USERS.md`.
4. **Floor users** — created by admin with `employee_id` + `floor_pin`; floor app uses PIN login, not Supabase Auth.
5. **Email confirmation** — disable for internal factory admins in Supabase Auth settings, or confirm manually in Dashboard before handoff.

---

## Onboarding checklist (per new factory)

Copy this checklist for each customer:

- [ ] Factory row created (`factories.name`, `factories.code`, app entitlement columns — see `docs/FACTORY_APP_ENTITLEMENTS.md`)
- [ ] Auth user created (admin email)
- [ ] Profile row linked (`profiles.factory_id`, `user_role = admin`)
- [ ] Default departments + shifts seeded (or customer configures in Settings)
- [ ] Factory code + admin credentials sent via **secure channel** (not email body in plain text if possible)
- [ ] Floor PIN users created after departments are configured
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `FLOOR_SESSION_SECRET` set in floor app hosting env only

---

## Method A — Supabase Dashboard (recommended for 1–2 factories)

### 1. Create the factory

**SQL Editor** (runs as postgres / bypasses RLS):

```sql
INSERT INTO public.factories (
  name, code, country,
  transaction_apps, production_apps, workforce_apps, audit_apps, shipment_apps
)
VALUES (
  'Acme Garments', 'acme-garments-a1b2', 'IN',
  '["transaction"]'::jsonb,
  '["hourly","qc_log"]'::jsonb,
  '["workforce_log","attendance"]'::jsonb,
  '["audit"]'::jsonb,
  '["shipment_log","final_rejection_log"]'::jsonb
)
RETURNING id, code;
```

See `docs/FACTORY_APP_ENTITLEMENTS.md` for per-customer app toggles.

Save the returned `id` (factory UUID) and `code` (floor login **Factory ID**).

### 2. Create the admin auth user

**Authentication → Users → Add user**

- Email: `admin@acmegarments.com`
- Password: strong generated password (password manager)
- **Auto Confirm User:** ON (for internal admin accounts)

Copy the new user's **UUID**.

### 3. Create the admin profile

```sql
INSERT INTO public.profiles (
  id,
  factory_id,
  full_name,
  email,
  user_role,
  status
) VALUES (
  '<AUTH_USER_UUID>',
  '<FACTORY_UUID>',
  'Plant Admin',
  'admin@acmegarments.com',
  'admin',
  'Active'
);
```

### 4. Seed minimum settings (optional starter pack)

```sql
-- Example departments (adjust names/sequence per customer)
INSERT INTO public.departments (factory_id, name, sequence, apps)
SELECT f.id, d.name, d.seq, d.apps::jsonb
FROM public.factories f
CROSS JOIN (VALUES
  ('Cutting',     1, '["transaction","hourly"]'),
  ('Sewing',      2, '["transaction","hourly","workforce_log"]'),
  ('Finishing',   3, '["transaction","qc_log"]'),
  ('Packing',     4, '["transaction","hourly"]')
) AS d(name, seq, apps)
WHERE f.code = 'acme-garments-a1b2';

-- Example shift
INSERT INTO public.shifts (factory_id, name, type, start_time, end_time)
SELECT id, 'Day', 'Regular', '08:00', '17:00'
FROM public.factories WHERE code = 'acme-garments-a1b2';
```

### 5. Hand off to customer

Provide securely:

- **Web app URL** — sign in with admin email + password
- **Factory ID** (`factories.code`) — for floor tablets
- Remind: additional users via **Settings → User Management** (employee ID + floor PIN for operators)

---

## Method B — SQL script template (repeatable)

Use `scripts/onboard-factory.sql` in this repo. Fill in the variables at the top, run once in SQL Editor.

---

## Method C — Local script with service role (bulk / automation)

For many factories, use a one-off Node script on an RBC machine:

```bash
# Prerequisites: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env (never commit)
node scripts/onboard-factory.mjs \
  --name "Acme Garments" \
  --code "acme-garments-a1b2" \
  --admin-email "admin@acmegarments.com" \
  --admin-password "<generated>" \
  --admin-name "Plant Admin"
```

(Implement `scripts/onboard-factory.mjs` when you need bulk onboarding; use `@supabase/supabase-js` with service role only.)

---

## Hardening after first factory exists

Run in SQL Editor on production:

```sql
-- Remove public factory creation (if old policy still allows anon insert)
DROP POLICY IF EXISTS factories_insert ON public.factories;

-- No client-side factory inserts
CREATE POLICY factories_insert ON public.factories
  FOR INSERT TO authenticated
  WITH CHECK (false);
```

Verify: attempting `insert` into `factories` from the browser client should fail.

---

## Floor app env (per deployment)

`plapps/.env.local` (hosting secrets only):

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role — server only>
FLOOR_SESSION_SECRET=<long random string>
```

The floor app never creates factories; it only reads `factories.code` for PIN login.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| “User profile not found” on web login | Auth user exists but no `profiles` row | Run profile insert (step 3) |
| Admin can log in but sees empty data | Wrong `factory_id` on profile | Update `profiles.factory_id` |
| Floor login “Invalid credentials” | Missing `employee_id` or `floor_pin` | Set in User Management |
| Duplicate employee ID | Unique index per factory | Use unique IDs per operator |

---

## Prompt for AI / contractor assisting RBC

When asking an agent to onboard a factory, provide:

```
Onboard a new PRODIGI factory using docs/FACTORY_ONBOARDING.md Method A.
Factory name: <NAME>
Factory code: <lowercase-code>
Admin email: <EMAIL>
Admin name: <FULL NAME>
Do NOT add factory creation to the login UI.
Use Supabase SQL Editor + Auth Dashboard only.
Confirm: factories INSERT is blocked for anon/authenticated clients.
Return: factory UUID, factory code, and confirmation that profile row exists.
```

---

## Bootstrap your RBC superadmin (e.g. rahil@rajeshbheda.com)

The database has a `superadmin` role, but **the web app does not yet switch between factories or create factories in UI**. Today:

| What you want | How to do it **today** |
|---------------|------------------------|
| Become platform superadmin | `scripts/bootstrap-superadmin.sql` + Auth user |
| Create a new customer factory | `scripts/onboard-factory.sql` (SQL Editor) |
| Create that factory’s admin | Same script (Auth user + profile with `user_role = admin`) |
| Create operators inside a factory | Customer admin → **User Management** in the web app |

### Steps for rahil@rajeshbheda.com

1. **Supabase → Authentication → Users → Add user**
   - Email: `rahil@rajeshbheda.com`
   - Strong password
   - **Auto Confirm User: ON**
   - Copy the user **UUID**

2. **SQL Editor** — run `scripts/bootstrap-superadmin.sql` with your UUID filled in

3. **Sign in** to the main PRODIGI web app with that email/password

**Important:** After login you will see data for the **RBC Platform** factory only (empty until you seed it). You will **not** automatically see Acme, Beta, etc. in one screen until we build a **Platform Admin** module (factory list + switcher + cross-factory RLS).

Your superadmin powers **right now** are:

- Supabase Dashboard + SQL (create any factory, any admin)
- Same as “RBC operator” in this doc — the app login is for day-to-day work inside one factory

### Creating a factory admin (for a customer)

Use `scripts/onboard-factory.sql`:

1. Create factory row → get `factories.code` (their Floor **Factory ID**)
2. Create auth user for `admin@customer.com` in Auth Dashboard
3. Insert profile with `user_role = 'admin'` and `factory_id =` that factory

That admin signs into the **web app only** (not floor PIN). They use **User Management** to add operators.

---

## Contact

New factory requests: **contact RBC** — do not use in-app self-service setup.
