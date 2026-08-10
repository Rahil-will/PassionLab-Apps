# PRODIGI — Page Audit Notes

Log of findings from the systematic page audit ([PAGE_AUDIT_PLAN.md](./PAGE_AUDIT_PLAN.md)).

---

## Phase 1 — #1 Settings (2026-06-22)

**Status:** Resolved (2026-06-22) — all 18 findings (S-1–S-18).

---

## Phase 1 — #2 User Management (2026-06-22)

**Status:** Resolved (2026-06-22)

| # | Severity | Fix summary |
|---|----------|-------------|
| UM-1 | major | Users refetch when `factoryId` changes (not only on mount) |
| UM-2 | major | Separate `saving` vs `loading` — table stays visible during create/update/delete |
| UM-3 | major | Profile update/toggle scoped with `.eq('factory_id', factoryId)` |
| UM-4 | major | Cannot delete or deactivate your own account |
| UM-5 | major | Duplicate email check per factory before create |
| UM-6 | minor | Panel close (backdrop/cancel) warns on unsaved form changes |
| UM-7 | minor | `deleteFactoryUser` profile fallback also filters by `factory_id` |

---

## Phase 1 — #3 Login + session (2026-06-22)

**Status:** Resolved (2026-06-22)

| # | Severity | Fix summary |
|---|----------|-------------|
| L-1 | blocker | `restoreAuthSession()` on app load — validates Supabase session, not just persisted flag |
| L-2 | blocker | Logout calls `supabase.auth.signOut()` via `logoutDesktopSession()` |
| L-3 | major | Desktop login restricted to `admin` / `superadmin` — floor roles rejected |
| L-4 | major | Inactive accounts and missing `factory_id` blocked at login |
| L-5 | minor | Shared `lib/authSession.ts` — login + restore use same profile/access rules |
| L-6 | minor | App shows loader until auth bootstrap completes |

---

## Phase 1 — #4 Workforce

_Not started._

---
