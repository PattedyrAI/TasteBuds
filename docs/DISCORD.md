# Discord review channels

TasteBuds stores a separate encrypted connection for energy-drink reviews and food reviews. Each connection belongs to one TasteBuds group and has an explicit list of that group's categories. A category can have only one enabled destination. New and unassigned categories stay unpublished until a group manager assigns them.

## Intended setup

Verified in Safari on 2026-09-24:

| Server | Channel | Channel ID |
| --- | --- | --- |
| Onlyfans Subscribers (`984524869498728478`) | `#energy-drink-reviews` | `1208438486940524554` |
| Onlyfans Subscribers (`984524869498728478`) | `#food` | `1282374906683592897` |

Both channels now have a webhook named **TasteBuds**, created on 2026-09-24. Their server and channel IDs were verified through Discord's webhook API. The app connections are not activated yet.

A separate **TasteBuds Test** webhook posts only to `#bot-testing` (`1462032010217394348`). The [energy-drink preview](https://discord.com/channels/984524869498728478/1462032010217394348/1552584912371187727) and [food preview](https://discord.com/channels/984524869498728478/1462032010217394348/1552586650482380840) contain fictional ratings, sample photos and an **Open TasteBuds** link button. These manually sent previews do not prove app-to-channel delivery. The sender now implements the same photo/score/button structure locally; it is not deployed.

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

Local verification on 2026-09-24: unit suite 180 passed (54 skipped); integration suite 96 passed (9 skipped). Typecheck and production build passed. Integration assertions cover attached bytes/MIME, exact item-link buttons and database rejection of unsupported image types. A browser harness using the actual settings component verified both forms submit the correct route/category, clear password fields after saving, show saved connection state, and fit a 390px viewport. The test-channel previews use the app formatter with public sample photos and an app-home CTA because they have no real item records. Independent review is pending because the shared dispatcher rejects this session's unverified T3 binding.
