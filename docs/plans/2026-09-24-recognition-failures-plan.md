# Recognition failure diagnosis and release — TKT-0080 / TKT-0079

User authorization: fix TKT-0080 alongside the responsive location picker and deploy to existing production. User also requests the logs explaining the failure. Purchasing provider credits is not authorized.

Observed production evidence on 2026-09-24, source 80b37ce:

| UTC time | Application HTTP status / duration | Recorded provider failure / duration |
| --- | --- | --- |
| 10:35:36 | POST /api/recognize, 200 / 493ms | provider_402 / 250ms |
| 10:35:41 | POST /api/recognize, 200 / 489ms | provider_402 / 239ms |

The runtime model is `gemini-3.5-flash-lite`. A minimal text-only request with the running service configuration returned HTTP 402, `RESOURCE_EXHAUSTED`, and “Your prepayment credits are depleted.” No private photo was transmitted by this diagnostic. An older 2026-09-17 job recorded provider_429; its original upstream body was not retained, so its precise reason is unproven.

Root cause: Gemini rejects requests because prepaid credits are depleted. The application compounds the problem by mapping every provider failure to “could not identify this photo,” returning its existing optional-recognition result envelope with HTTP 200 and no diagnostic application log.

Implementation scope:

- Keep the existing result envelope and uploaded-photo/manual-save behavior.
- Distinguish billing, rate-limit, timeout, configuration and actual identification failures in the user message.
- Log only the recognition-job ID, validated model, fixed failure class and elapsed milliseconds. Never log photos, API keys, raw provider bodies, or arbitrary exception messages.
- Fully anchor the failure-code allowlist before storing failure_class. No schema changes, model switch, key changes, credit purchase, or automatic retries.

Acceptance and verification: regression tests reproduce the old misleading 402 response before the change, then cover provider statuses, timeout, malformed responses, sensitive-error redaction, AI consent and successful recognition. Browser-check the existing manual fallback. Independent Sol review covers correctness and logging privacy. Run unit tests, typecheck, build, release packaging checks, then Railway terminal success, exact source health marker and public smoke tests.

Remaining external dependency: add prepaid credits in the existing Google AI Studio billing account, then retry actual photo recognition. The code release cannot restore an exhausted external balance. See [Google Gemini billing](https://ai.google.dev/gemini-api/docs/billing).

Delivery is separate from AI recovery: report the release as deployed only after live checks, and keep TKT-0080's provider-credit blocker visible until a live recognition succeeds.

Local verification: 9 regression assertions failed before the fix; all 15 recognition cases now pass. Full unit suite: 195 passed, 54 skipped. Typecheck, webpack production build and diff whitespace check passed. Sol independently approved correctness and logging privacy. Browser fixture asserted the billing message, retained draft/photo, enabled manual save and exact preserved photo ID in the save payload; this browser check used simulated app/provider responses and wrote no production data.
