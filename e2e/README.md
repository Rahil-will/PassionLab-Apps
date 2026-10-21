# Playwright E2E smoke tests

Runs against the Vite dev server on **http://localhost:3000** (`npm run dev`). `playwright.config.ts` auto-starts it unless one is already running locally.

## Required env vars

Set in the shell or in a gitignored `.env.local` (loaded by Playwright config; does not override existing `process.env`).

| Variable | Used by |
| --- | --- |
| `VITE_TEST_ADMIN_EMAIL` | Admin smoke specs |
| `VITE_TEST_ADMIN_PASSWORD` | Admin smoke specs |
| `VITE_TEST_VIEWER_EMAIL` | Viewer read-only specs |
| `VITE_TEST_VIEWER_PASSWORD` | Viewer read-only specs |
| `VITE_TEST_ORDER_ID` | Viewer style-details spec (UUID of an order the viewer can read) |
| `E2E_EMAIL` / `E2E_PASSWORD` | Material flow spec (`e2e/material/`, falls back to `VITE_TEST_ADMIN_*`; account must be scoped to test factory "abc") |

Run the material flow suite with `npx playwright test e2e/material` (project `material`, screenshot on failure).

The app also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or publishable key) in `.env` for login to work.

## Run

```bash
npm run test:e2e
```

When credentials are missing, tests **skip** with a message instead of failing.
