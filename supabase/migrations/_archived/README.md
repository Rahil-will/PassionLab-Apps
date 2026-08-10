# Archived migrations — NOT applied on live

These files describe RPCs that **do not exist** on production and must **never** be applied.

| File | Why archived |
|------|----------------|
| `15_rpc_save_factory_user.sql` | User create is **Edge Function only** (`admin-create-user` → `create_factory_floor_user`) |
| `17_rpc_update_factory_user.sql` | User update is **Edge Function only** (`admin-update-user` → `replace_floor_user_access`) |

Locked architecture (see `docs/PLATFORM_ARCHITECTURE.md`):

```
admin-create-user | admin-update-user | admin-delete-user
        └─ caller JWT → create_factory_floor_user / replace_floor_user_access
```

Verify live matches repo expectations:

```bash
npx supabase db query --linked --file scripts/verify_live_functions.sql
```

CI runs the same checks after `supabase db reset` against the local database.
