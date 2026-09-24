# Discord review channels

TasteBuds stores a separate encrypted connection for energy-drink reviews and food reviews. Each connection belongs to one TasteBuds group and has an explicit list of that group's categories. A category can have only one enabled destination. New and unassigned categories stay unpublished until a group manager assigns them.

## Intended setup

Verified in Safari on 2026-09-24:

| Server | Channel | Channel ID |
| --- | --- | --- |
| Onlyfans Subscribers (`984524869498728478`) | `#energy-drink-reviews` | `1208438486940524554` |
| Onlyfans Subscribers (`984524869498728478`) | `#food` | `1282374906683592897` |

Both channels have a webhook named **TasteBuds**, created on 2026-09-24. Their server and channel IDs were verified through Discord's webhook API. Production connections were activated on the same day: one Energy drinks category and 45 food categories in Onlyfans Subscribers.

A separate **TasteBuds Test** webhook posts only to `#bot-testing` (`1462032010217394348`). The [energy-drink preview](https://discord.com/channels/984524869498728478/1462032010217394348/1552584912371187727) and [food preview](https://discord.com/channels/984524869498728478/1462032010217394348/1552586650482380840) contain fictional ratings, sample photos and an **Open TasteBuds** link button. These manually sent previews do not prove app-to-channel delivery. See the production receipt below for the authorized real review.

At the user's request, the three webhook URLs are stored in a local Markdown file outside Git, restricted to the owner's account. No credentials belong in this document.

1. In each Discord channel, open **Edit Channel → Integrations → Create Webhook**. Name it **TasteBuds** and verify its channel before copying its URL.
2. Sign into TasteBuds as the group's owner or platform administrator. Open **Group settings → Bring the conversation to Discord**.
3. If an existing **All reviews** connection appears, disable it first; it cannot overlap the two specific destinations.
4. Under **Energy-drink reviews**, select the group's energy-drink category, paste that channel's webhook URL, enable sharing and save.
5. Under **Food reviews**, select all food categories, including snacks, desserts and restaurant dishes where appropriate. Paste the `#food` webhook URL, enable sharing and save. Do not include unrelated drinks, nicotine or other non-food categories.
6. When adding a new category, explicitly assign it to its intended connection. Labels on the connections do not automatically classify categories.
7. Verify one authorized new review in each category in its actual Discord channel. Check score, author, note, item link and absence from the other channel. Existing reviews are never replayed.

Paste webhook URLs only into the password fields in TasteBuds; never put them in chat, Git, shell arguments or logs. Read APIs return only route, enabled state and category IDs. The server requires the existing `DISCORD_ENCRYPTION_KEY`; preserve that key, because replacing it makes existing connections unreadable.

## Delivery and release

`009_discord_category_routes.sql` preserves current connections and pending entries as the `all` route. It changes the connection primary key to `(group_id, route)`. Apply this migration as a coordinated release: the old connection-saving code uses `ON CONFLICT(group_id)` and is incompatible with the new key. Stop the old web/outbox worker for the migration and start the reviewed build before configuring multiple destinations. Do not roll back to the old application while multiple routes exist.

The existing runtime role already has privileges on both changed tables. No new table grants or public schema exposure are required. Production migration, release and activation require a separate approval with the reviewed commit and verification evidence.

Review creation and connection changes serialize on the group row. The outbox records the selected route when a review is saved and resolves the current webhook immediately before sending. Removed categories or disabled routes cancel pending delivery. An item moved out of its queued route is cancelled, not redirected to another channel. Category renames retain their ID and route.

Each review is one Discord message with a rich embed and a native link button to its item in TasteBuds. The worker attaches the review's primary photo as multipart data, fetched through the rating/group relationship immediately before sending. Private photo endpoints remain authenticated. Unsupported or unavailable linked photos fail delivery instead of exposing a different photo or sending an incomplete card. Older reviews without a linked photo keep text-only delivery. Discord does not render arbitrary HTML; `with_components=true` enables the non-interactive link button on these incoming webhooks.

Discord retries remain bounded; mentions are disabled and requests use `wait=true`. A connection change cannot recall an already-started HTTP request. Discord webhook requests have no application idempotency key, so an uncertain HTTP result can still produce a duplicate on retry.

## Local verification

Use a disposable PostgreSQL database on loopback named `everrate_test` (required by existing test guards):

```sh
DATABASE_URL="$TEST_DATABASE_URL" npx tsx scripts/migrate.ts
npm test
npm run test:integration
npm run typecheck
npm run build
```

Integration tests intercept Discord HTTP calls. They prove routing and queue behavior, not real channel receipt. The runtime's database configuration must never point these tests at production.

Local verification on 2026-09-24: the combined production source passed 196 unit tests (54 skipped), 96 integration tests (9 skipped), typecheck and production build. Integration assertions cover attached bytes/MIME, exact item-link buttons and database rejection of unsupported image types. A browser harness using the actual settings component verified both forms submit the correct route/category, clear password fields after saving, show saved connection state, and fit a 390px viewport. Original and integrated source received independent review.

## Production receipt — 2026-09-24

Source `4d6f3faea49412bf78cd425ebf022ba3a60644d9` reached Railway `SUCCESS` as deployment `9bb4233b-a994-4c83-b61a-9c25086b32e1`. The old web process stopped before migration 009; affected tables were backed up and protected-record fingerprints matched afterward. All nine public launch checks passed against the exact release marker. Today's responsive Maps, camera and recognition-diagnostics changes remain included.

The user explicitly authorized posting only the missed **Fully Charged Lemon Yuzu Zero Sugar** review. [Its Discord message](https://discord.com/channels/984524869498728478/1208438486940524554/1552646149922357359) was accepted at 11:41:29 UTC. A fresh webhook message read verified the title, 9/10 score, note and item link; downloading the embedded image produced the same SHA-256 as the stored review photo. The outbox contained exactly that one review, marked `sent`, with one attempt. No other historical reviews were queued.

This one-off recovery used the deployed formatter and a manually claimed exact outbox row, excluded from automatic retries even if the sender crashed. It does not itself prove a subsequent new review has traversed the production poller. Food routing is activated and covered by integration tests; no real food review was posted as part of this release. Discord returns an attachment used inside an embed under `embeds[].image`; its top-level `attachments` array may be empty. Verify the embedded image before treating that empty array as a missing photo.
