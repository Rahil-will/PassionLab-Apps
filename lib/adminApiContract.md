# Admin user management (Supabase Edge Functions)

Floor user create/delete uses **Supabase Edge Functions** in this repo — not plapps and not a separate admin server.

## Functions

| Function | Purpose |
|---|---|
| `admin-create-user` | Auth user + `profiles` row (no confirmation email) |
| `admin-delete-user` | Delete auth user (profile cascades) |

**Auth:** caller must be signed in as `admin` or `superadmin` for the target factory.

## Deploy (one-time per project)

```bash
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-create-user admin-delete-user
```

Service role is injected automatically on Supabase hosted projects. No `VITE_ADMIN_API_URL` or plapps required.

## Local development

With Supabase CLI running (`supabase start`), serve functions:

```bash
supabase functions serve admin-create-user admin-delete-user --env-file supabase/.env.local
```

Point the Vite app at local Supabase (`VITE_SUPABASE_URL=http://127.0.0.1:54321`).

## Client

`lib/createFactoryUser.ts` and `lib/deleteFactoryUser.ts` call:

```ts
supabase.functions.invoke('admin-create-user', { body })
```

## `admin-create-user` body

```json
{
  "factoryId": "uuid",
  "fullName": "string",
  "email": "string",
  "floorPin": "1234",
  "departmentId": "uuid | null",
  "assignedApps": ["hourly", "transaction"],
  "userRole": "operator | quality_manager | supervisor | auditor",
  "status": "Active | Inactive"
}
```

**Response:** `{ "id": "<auth_user_uuid>" }`

## `admin-delete-user` body

```json
{
  "userId": "uuid",
  "factoryId": "uuid"
}
```

**Response:** `{ "ok": true }`

Cannot delete `admin` / `superadmin` users or your own account.
