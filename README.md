# TasteBuds

A private place for friends to rate what they try. Browse food and drink subcategories, compare brands and restaurants, and explore each person's tasting history.

## What it does

- Requires a photo for every new rating.
- Starts in manual mode. People can enable Gemini assistance in Settings and explicitly request photo suggestions; uploading never starts AI automatically.
- Keeps repeat tastings and corrections, with group scores based on each person's latest rating.
- Links verified Discord identities to permanent people records and their historical reviews.
- Shows Discord profile photos and lets each person choose a nickname for all their reviews.
- Prioritises the five most-reviewed categories and only calls an item a group favourite after three people have rated it.
- Supports private groups, invitations, comments and optional Discord announcements.
- Installs from a supported browser onto a phone or desktop as a progressive web app.

## Run locally

Use Node.js 24 and PostgreSQL. Install dependencies with `npm ci`, copy `.env.example` to `.env.local`, and fill in your local database and Auth settings. Create the empty local database before running:

```sh
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. Discord sign-in requires the configured Auth provider to allow `http://localhost:3000/auth/callback`. Gemini and Discord credentials stay on the server.

```sh
npm test
npm run typecheck
npm run build
```

Integration tests require an explicitly configured disposable local `TEST_DATABASE_URL` whose database name ends in `_test`; see the individual test fixtures before running `npm run test:integration`.

## Architecture and operations

Next.js serves the UI and private API. PostgreSQL stores people, groups, items, ratings, revision history and photo bytes. Supabase Auth validates Discord sign-ins. The original `everrate` database schema and migration identifiers remain stable to preserve imported data and audit references; the product name is **TasteBuds**.

- [Product specification](docs/SPEC.md)
- [Implementation status](docs/IMPLEMENTATION.md)
- [Deployment and verification](docs/DEPLOYMENT.md)
- [Historical import](docs/IMPORT.md)
- [Photo identity review](docs/PHOTO-IDENTITIES.md)

Private exports, real account fixtures, images, database backups and runtime credentials are excluded from this repository. The previous application remains available in its legacy Git branches.
