# Flere bilder per vurdering

En vurdering kan ha ett til fem bilder. Første bilde brukes som forside på produktkort. Brukeren kan velge flere filer samtidig, legge til flere senere, fjerne enkeltbilder og velge et annet forsidebilde før lagring. Hvert bilde beholder grensen på 10 MiB og 64 millioner piksler. En mislykket opplasting fjerner ikke vellykkede vedlegg. AI-knappen behandler bare forsidebildet og er fortsatt valgfri.

Bilder vises som et galleri i vurderingshistorikken, med forstørring og navigasjon. Gruppefeeden viser forside og bildeantall. Egne tidligere bilder beholdes ved redigering og REREVIEW. En vurdering må fortsatt ha minst ett bilde.

## Lagring og tilgang

`ratings.photo_id` beholdes som forside. Migrering `008_review_photos.sql` oppretter `rating_photos` for opptil fire ekstrabilder med fast rekkefølge og fremmednøkler til vurderingen og bilder i samme gruppe. Den er uavhengig av migrering 007 og endrer ingen eksisterende vurderinger eller bildefiler.

API-et returnerer `photoIds` i tillegg til `photoId`. Ved innsending må `photoId` være første element hvis begge felt er oppgitt. Gamle klienter med bare `photoId` støttes. Nye vedlegg krever riktig eier og gruppe. Ved REREVIEW kan forfatteren gjenbruke alle bilder fra sin egen kildevurdering, også importerte bilder med en annen opprinnelig opplaster. Endringer låser vurderingen; forside, ekstrabilder og revisjon lagres atomisk. Historiske revisjoner inkluderer tidligere `photo_ids`.

## Verifisering

Fem isolerte PostgreSQL-tester dekker lagring/lesing, feed/personhistorikk, validering, autorisasjon, importerte bilder, REREVIEW, kompatibilitet med gammel PATCH og samtidige redigeringer. Typesjekk og produksjonsbygg passerer. Lokal nettlesertest ved 320/390 px dekker flervalg, forsidebytte, enkeltfjerning, delvis opplastingsfeil, minimum/maksimum, gjenbruk og gallerinavigasjon. API-simulering ble brukt i nettlesertesten; virkelig lagring ble testet separat mot midlertidig PostgreSQL.
