# Local UX harness

Drives the real app (production build, real API, disposable local PostgreSQL) in a browser. Only Supabase Auth is replaced, by `fake-auth.mjs`, which answers `GET /auth/v1/user` for four fixed test users. Never point any of this at a shared or production database: `seed.mjs` refuses non-local URLs.

```sh
docker run -d --name tb-ux-pg -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=everrate_ux_test -p 127.0.0.1:55440:5432 postgres:17-alpine
export DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_ux_test \
  NEXT_PUBLIC_SUPABASE_URL=http://localhost:54999 NEXT_PUBLIC_SUPABASE_ANON_KEY=ux-anon \
  APP_URL=http://localhost:3100 DISCORD_ENCRYPTION_KEY=$(head -c 32 /dev/zero | tr '\0' k | base64)
npx tsx scripts/migrate.ts
node tests/ux/fake-auth.mjs &              # port 54999
npx next build && npx next start --port 3100 &
node tests/ux/seed.mjs                      # 4 people, 14 items incl. energy drinks, through the HTTP API
```

Seed photos are read from `UX_PHOTOS` (default `/tmp/tb-ux/photos`, files named `p<n>.jpg`, used in numeric order).

| Script | What it proves |
|---|---|
| `flows.mjs` | Camera capture on desktop (fake webcam) and phone (capture input), Back / outside-tap / discard behaviour, the sugar-free switch on existing products. Exits non-zero on any failure. |
| `audit.mjs <label>` | Per screen and viewport: axe violations, tap targets under 44 px (mobile) / 24 px (desktop), text under 12 px, font-size and colour counts, horizontal overflow, dialog dismissal four ways, rating-flow clicks. Writes `/tmp/tb-ux/<label>/report.json` and screenshots. Needs `axe-core` at `AXE_PATH`. |
| `shots.mjs <dir>` | Screenshots of the main views and dialogs on 390 px and 1440 px. |

`audit.mjs` and `flows.mjs` create ratings, so reseed (drop the `everrate` schema, migrate, seed) before comparing runs.
