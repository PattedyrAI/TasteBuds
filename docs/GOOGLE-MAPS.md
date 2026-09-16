# Kategorimaler og Google Maps

Gruppeadmin kan lage kategorier med egne vurderingsfelt: tekst, tall, pris, valgliste, ja/nei og lokasjon. «Cuisine» er for eksempel en valgliste med adminens egne alternativer. Avkrysningen «Bruk som filter» gjør feltet tilgjengelig når kategorien åpnes. Kategoriene har ingen over- eller underkategorier.

Et lokasjonsfelt aktiverer stedssøk i vurderingen og **Liste / Kart inne i den valgte kategorien**. Kartet viser bare oppføringer fra denne kategorien med lagret sted og aktive vurderinger. Det finnes ingen separat kartinngang i hovedmenyen. Navn, bilder og poengsummer er gruppens egne data.

## Brukerflyt

1. Admin starter en vurdering og velger **Lag kategori** i kategorivelgeren.
2. Admin gir kategorien navn og legger til relevante felt, obligatoriske verdier og feltfiltre.
3. Etter lagring kommer admin tilbake til det samme vurderingsutkastet, med kategorien valgt. Bilder, navn, poeng, notat og dato beholdes.
4. Medlemmer velger en eksisterende kategori og fyller ut feltene. Kun admin kan opprette og redigere maler; dette håndheves også på serveren.
5. I samlingen velges kategorien. Kategorier med lokasjonsfelt får Liste/Kart-valg. Kartet kan filtreres på navn, gruppescore og feltene admin har gjort filtrerbare.

Filtrene bruker verdiene i oppføringens nyeste vurdering. Gruppescore bruker hver persons nyeste vurdering, som resten av appen. Malendringer gjelder nye vurderinger; tidligere vurderinger beholder sine felt i historikken. Fjerning av lokasjonsfelt skjuler kartvalget uten å slette vurderinger eller stedskobling. Eksisterende oppføring beholder sitt sted ved senere vurderinger.

## Google Cloud-oppsett

Aktiver fakturering på Google Cloud-prosjektet og følgende API-er:

- **Maps JavaScript API** for kartet.
- **Places UI Kit API** for søk og Googles innebygde stedskort.
- **Places API (New)** for serverens kontroll av Place ID og koordinater.

Opprett to separate nøkler med API-begrensninger:

- Nettlesernøkkel: bare Maps JavaScript API og Places UI Kit API. Legg til HTTP-referrer-begrensninger for de faktiske domenene og eventuelle lokale testadresser, for eksempel `http://localhost:3000/*`. Nøkkelen sendes til innloggede nettlesere og er offentlig av natur.
- Servernøkkel: bare Places API (New). Begrens til serverens utgående IP-adresser når miljøet har faste adresser. Den skal kun finnes i serverens miljøkonfigurasjon.

Legg verdiene i lokal `.env.local` eller driftsmiljøets hemmelighetslager; ikke i Git eller chat:

```dotenv
GOOGLE_MAPS_BROWSER_KEY=
GOOGLE_PLACES_SERVER_KEY=
GOOGLE_MAPS_MAP_ID=
GOOGLE_PLACES_DAILY_LIMIT=500
```

`GOOGLE_MAPS_MAP_ID` kan stå tomt i utvikling, der `DEMO_MAP_ID` brukes. Opprett et eget JavaScript Map ID i Google Cloud for drift. Start appen på nytt etter miljøendringer. Nøklene leses ved kjøring; ingen hemmelig servernøkkel bygges inn i nettleserpakken.

Kjør prosjektets vanlige migreringsløp mot riktig miljø før oppstart (`npm run db:migrate` lokalt). Kartfunksjonen krever `007_restaurant_maps.sql`. Migreringskommandoen kjører alle ventende migreringer i arbeidskopien. Runtime-rollen trenger tilgang til de nye tabellene; migreringen gir avgrensede rettigheter til `everrate_app` hvis rollen finnes. Ved senere opprettelse brukes prosjektets vanlige rolleprovisjonering.

## Kostnad og grenser

Google fakturerer separat for kartinnlastinger, søkeøkter, stedskort og serveroppslag. Et lavt antall aktive brukere kan holde seg innenfor gratiskvotene, men antall gruppebrukere alene bestemmer ikke forbruket. Gjentatte kartåpninger og søk teller også. Se [Googles gjeldende SKU-priser og gratiskvoter](https://developers.google.com/maps/billing-and-pricing/pricing) før aktivering.

Appen laster kartbiblioteket først ved stedssøk eller kartvisning. Filterendringer bruker samme kartinstans. Koordinater mellomlagres i prosessminne i opptil 24 timer, og samtidige oppslag av samme sted samles. Serveren ber bare om `id,location`.

`GOOGLE_PLACES_DAILY_LIMIT` begrenser serveroppslag samlet for hele appen per UTC-døgn. Standard er 500; 0 stopper nye oppslag, mens mellomlagrede posisjoner fortsatt kan brukes. Dette begrenser **ikke** kartinnlastinger eller Places UI Kit i nettleseren og garanterer ikke gratis bruk. Sett egne API-kvoter og budsjettvarsler i Google Cloud. Budsjettvarsler stanser ikke fakturering automatisk.

## Data og Google-vilkår

Varig Google-data begrenses til Place ID. Koordinater lagres ikke i database eller sikkerhetskopier. Google-navn, adresser, bilder og anmeldelser importeres ikke. Stedskort vises gjennom Googles egen UI Kit-komponent med attribusjon. Google-logo og attribusjon på kartet skal forbli synlige.

For EØS-prosjekter brukes Places UI Kit til søk. Serveroppslag til kartet ber bare om Place ID og koordinater. Kontroller prosjektets gjeldende avtale og sørg for at appens offentlig tilgjengelige bruksvilkår og personvernerklæring oppfyller Googles krav før aktivering for brukere.

Kilder: [Places UI Kit Basic Autocomplete](https://developers.google.com/maps/documentation/javascript/places-ui-kit/basic-autocomplete), [EØS-endringer for Places](https://developers.google.com/maps/comms/eea/places), [Places API-policy](https://developers.google.com/maps/documentation/places/web-service/policies).

## Verifisering

Automatiske tester dekker administratorrettigheter, gruppeisolasjon, feltvalidering, idempotens, historikk, Google-feltmaske, feil, kvoter og filtrering. Databaseintegrasjon kjøres kun mot en eksplisitt lokal testdatabase. Nettlesertesten bruker simulerte Google- og app-API-er; den kontrollerer utkast, malbygger, kategoriavgrenset kart, filterlivssyklus og mobilbredde.

Ekte Google Maps krever en avsluttende kontroll med gyldige nøkler: søk etter et faktisk sted, lagre vurderingen, åpne kategoriens kart og bekreft posisjon, attribusjon, mobilbetjening og forbruk i Google Cloud. Uten nøkler vises en oppsettmelding. Et valgfritt lokasjonsfelt tillater vurdering uten sted; et obligatorisk felt krever fungerende stedssøk.

Lokal sluttkontroll 16. september 2026: 209 enhetstester bestått (78 miljøavhengige tester hoppet over), 85 databaseintegrasjonstester bestått (6 hoppet over), inkludert kjøring med begrenset runtime-rolle. Typekontroll og produksjonsbygg bestått. Midlertidig nettlesertestrute er fjernet. Ingen ekte Google-nøkler eller produksjonsendringer inngikk.

## Google Cloud-oppsett 16. september 2026

Etter brukerens eksplisitte godkjenning er Maps JavaScript API, Places UI Kit og Places API (New) aktivert i **Food-E**, prosjekt `gen-lang-client-0680943659`. Prosjektet ble identifisert ved samsvar mellom TasteBuds sin eksisterende Gemini-nøkkel og nøkkelen i Google AI Studio. Google Maps sine EØS-vilkår ble akseptert i konsollen som del av den godkjente aktiveringen.

To separate nøkler er opprettet og lagt i lokal `.env.local` (Git-ignorert, filrettighet 0600):

- **TasteBuds Maps – nettleser:** Maps JavaScript API og Places UI Kit; HTTP-referrers for `https://tastebuds-production-1b73.up.railway.app/*` samt localhost/127.0.0.1 på port 3000 og 3015.
- **TasteBuds Places – server:** kun Places API (New). Ingen IP-begrensning er satt; en fast utgående drifts-IP er ikke konfigurert som del av dette arbeidet. Nøkkelen skal forbli i servermiljøet.

Lokal servergrense er satt til 100 nye stedsoppslag per UTC-døgn. Denne grensen gjelder fortsatt ikke nettleserens kart- og UI Kit-forbruk. Egne Google Cloud-kvoter er ikke ferdig konfigurert.

**Fakturering og ekte Google-test verifisert:** Den opprinnelige kontoen var stengt og ga `BillingNotEnabledMapError`. Etter at brukeren opprettet den aktive kontoen **My Billing Account Main**, ble Food-E koblet til denne kontoen. Andre prosjekters koblinger ble ikke endret. Ingen faktureringskonto eller betalingsmåte ble opprettet av agenten.

En lokal nettlesertest med appens faktiske Google-laster og `fetchPlaceLocation` bekreftet deretter kartinnlasting, ekte UI Kit-søk etter Mamma Pizza i Oslo, serveroppslag via Places API (New) og synlig markør på riktig sted. Ingen ny faktureringsfeil kom etter kontobyttet. Testen lagret ingen vurdering og verifiserer Google-integrasjonen isolert; hele flyten med lagring av en ekte vurdering og åpning av kategoriens kart gjenstår i målmiljøet.

Nøklene er foreløpig kun konfigurert lokalt. Ingen Maps-nøkler, migrering 007 eller kartkode er publisert til produksjon gjennom denne oppgaven. Før produksjonsaktivering gjenstår Cloud-kvoter, et eget JavaScript Map ID for drift og kontroll av hele vurderingsflyten i målmiljøet.
