# Global admin og samtaler

## Myndighet

Brukeren bekreftet 16. september 2026 at egen konto skal ha admin i **alle grupper i hele TasteBuds**, også uten medlemskap. `PLATFORM_ADMIN_USER_ID` angir nøyaktig én kanonisk bruker-UUID på serveren. Ingen verdi eller feil format gir ingen global admin. Kallenavn, visningsnavn og nettleserdata gir ikke denne rollen. Eksisterende verifisering av Discord-identiteter og kobling til kanonisk konto er uendret.

Kontoen ble kontrollert skrivebeskyttet mot produksjon, inkludert eksisterende primær Discord-identitet og den bekreftede historiske kontokoblingen. Kontrollkvittering: `.private/admin-identity-verify-lngo1qp9`. Midlertidig SSH-nøkkel ble fjernet etter kontrollen.

Rollen `admin` beregnes i serverresponsene; den lagres ikke som medlemsrolle. Admin ser alle grupper, kan administrere kategorier og innstillinger, se bilder og moderere vurderinger og kommentarer. Vanlige eiere og medlemmer beholder sine eksisterende rettigheter. Eierskifte oppdaterer den faktiske eieren, og nåværende eier kan ikke fjernes uten eierskifte. Global admin-tilgang kan ikke fjernes via gruppens medlemsliste.

Lesing oppretter ingen medlemskap. Første vellykkede vurdering fra admin i en gruppe oppretter vanlig medlemskap i samme transaksjon, slik at karakteren teller. Mislykket vurdering tilbakefører også medlemsinnsettingen. Egen vurderingshistorikk fungerer uten medlemskap. Innstillinger for Google og andre tjenester er uendret.

## Samtaler og kategori

Kommentarer har profilbilder, egne navn- og tidslinjer, meldingsbobler, en separat handlingsmeny og et flerlinjers skrivefelt. Enter sender, Shift+Enter lager ny linje. Komposisjon av tekst med IME sender ikke ved et uhell. Feil beholder utkast; parallelle sendinger sperres. Kommentarresponsen oppdaterer den åpne vurderingen uten å montere hele dialogen på nytt. Endepunkter og lagringsformat er uendret.

«Lag kategori» står fast øverst i kategorilisten, også under søk. Enter velger det første eksisterende treffet; oppretting er reserve når søket ikke finner noen kategorier, eller velges eksplisitt.

## Verifisering

- Nye admintester feilet før endringen. Sluttresultat: 209 enhetstester og 95 integrasjonstester mot en ny lokal PostgreSQL-instans, samt typesjekk og produksjonsbygg.
- Testene dekker global lesing, fremtidige grupper, kategorioppretting, bildelesing/opplasting, moderering av andres vurderinger, korrekt eierskifte, uendret medlemskap ved lesing, tom egen historikk, tilbakeføring etter ugyldig vurdering og avslag for like kallenavn/ukonfigurert admin.
- Nettleserfixture med faktiske React-komponenter: sending med linjeskift, feil og retry, redigering, avbrutt og bekreftet sletting, Escape i handlingsmenyen og skjermbilder ved 320/390/1440 px.
- Kategoriens Enter-regresjon ble gjenskapt før retting og kontrollert etterpå med eksisterende treff og null treff.
- Uavhengig sikkerhets- og UI-gjennomgang har ingen gjenstående funn.

Ingen migrering eller omskriving av eksisterende brukere, medlemmer eller vurderinger er nødvendig. Produksjonskontrollen opprettet ingen testvurdering eller kommentar.
