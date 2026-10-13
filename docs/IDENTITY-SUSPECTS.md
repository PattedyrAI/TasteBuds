# Review av mistenkelige produktidentiteter

Rapporten leser **alle items** i målbasen i én `REPEATABLE READ READ ONLY`-transaksjon. Den lager review-rader og eventuelle korrekturutkast; den endrer aldri navn, ratings eller andre databaserader og kaller aldri Gemini.

## Lokal kjøring

```sh
IDENTITY_SUSPECTS_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_suspects_test \
  npx tsx scripts/report-identity-suspects.ts
```

Bruk en eksisterende lokal kopi eller en eksplisitt opprettet fixture-base. Ikke bruk `everrate_ux_test` til dette. DB-URL er påkrevd; andre vertsnavn enn loopback avvises uten `--allow-remote-readonly`. URL-parametere som kan overstyre verten avvises alltid.

Stdout viser bare item-/group-ID, lagret brand/name/type, cover-photo-ID, reason codes med severity og analysert brand/name. Medlemsnavn, notater, OCR-tekst og ambiguity-tekst skrives ikke til stdout. JSON med hele review-listen ligger i `.private/identity-suspects/<run-id>/report.json`; mapper er `0700`, filer `0600`. `.private/` er ignorert av Git.

## Fotoanalyse først

Les [PHOTO-IDENTITIES.md](PHOTO-IDENTITIES.md). Analyzerens standardkommando inventerer uten nye provider-kall. `--analyze` gjør betalte Gemini-kall og brukes bare på eksplisitt godkjente lokale bilder:

```sh
PHOTO_IDENTITY_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_suspects_test \
  npx tsx scripts/analyze-photo-identities.ts
# Bare etter godkjenning av lokal analyse:
PHOTO_IDENTITY_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_suspects_test \
  npx tsx --env-file=.env.local scripts/analyze-photo-identities.ts --analyze --limit=30 --concurrency=1
IDENTITY_SUSPECTS_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_suspects_test \
  npx tsx scripts/report-identity-suspects.ts --analysis=.private/photo-identities/proposals.json
```

Innfilen må være analyzerens `proposals_only` / `photo-identity-v1`-format, med private filrettigheter. Utdatert eller feil foto-/item-kobling flagges. Manglende analyse markeres i rapporten, og ingen komplett fotodekning påstås. Analyzerens nåværende inventar dekker importerte items og cover-bilder; nyere items og ekstra rating-bilder kan derfor mangle analyse.

## Fra review til korrekturplan

`summary.reasonCounts` viser antall items per grunn; ett item kan telle flere ganger. Dette synliggjør heuristikkenes bredde, **ikke en målt false-positive-rate**. Bekreft/reject review-rader manuelt og vurder især korte fremmedspråklige produktnavn og ukjente energidrikkmerker.

- `first_name_token` og `non_product_token`: medium; enkeltord på høyst 12 tegn, uten brand, kjent typelabel eller mat-/drikkevokabular. Navnelisten og vokabularet ligger eksplisitt i `src/domain/identity-suspects.ts`.
- `member_name_collision`: high; eksakt normalisert likhet med et medlem i samme gruppe. Ingen medlemsverdi følger flagget.
- `energy_brand_unrecognized`: medium; kategorien er Energy drinks, men eksisterende `brand-identity`-liste gjenkjenner ikke brand eller ledende brand i tittelen.
- `photo_brand_missing`, `photo_brand_disagreement`, `photo_name_disagreement`: high; uavhengig confidence ≥ 0,90 og ingen ambiguity/multiple-products. Sammenligning bruker eksakte normaliserte tokens og eksisterende brand-aliaser, aldri fuzzy matching på tvers av merker.
- `photo_evidence_incomplete`, `photo_evidence_unverified`, `photo_evidence_conflicting`: synlige mangler som krever review.

`draft-<group-id>-<plan-id>.json` følger [IDENTITY-CORRECTIONS.md](IDENTITY-CORRECTIONS.md), versjon 1, og genereres bare når alle aktuelle koblede bilder er analysert og enige. Name og kjent brand må ha confidence ≥ 0,90; usikker eller ukjent brand slettes aldri. Virkelige bildebytes hashes og sammenlignes med både lagret hash og analysehash. Item-snapshots inkluderer ratinghistorikken. Store sett deles i planer innenfor eksisterende v1-grenser. Ingen kandidater gir ingen planfil.

Utkast endrer bare name/brand. Variant, type, cover, ratings, forks og moves krever separat review; ukjent variant/type blir ikke ryddet automatisk. Inspiser bildene, rett utkastet og erstatt draft-evidensen med konkret operatørreview før planen eventuelt valideres med applicatorens standard dry run. Review-rader uten sikkert fotobevis forblir review-rader; ikke lag en rename fra heuristikken alene.

**Produksjonslesing, produksjonsfotoanalyse og bruk av en korrekturplan i produksjon krever Patricks uttrykkelige godkjenning.** Produksjonscredentials finnes bare i Mac-ens `.private/`; devbox skal ikke hente, kopiere eller erstatte dem. `--allow-remote-readonly` er en teknisk transportvakt, ingen produksjonsfullmakt.

## Verifikasjon

```sh
npx vitest run tests/identity-suspects.test.ts
npx tsc --noEmit
```

Integrasjonstestene kjøres bare med `IDENTITY_SUSPECTS_TEST_DATABASE_URL` til en ny tom `everrate_suspects_test` (eller `everrate_suspects_test_<suffix>`) på `127.0.0.1:55440`. Opprett basen eksplisitt, kjør `DATABASE_URL=... npx tsx scripts/migrate.ts`, kjør testene med fixture-URL, kjør rapporten og dropp **bare den opprettede fixture-basen**. Testene verifiserer faktiske uendrede verdier, snapshot-vakter, stale fotoavvisning og transaksjonsegenskapene.
