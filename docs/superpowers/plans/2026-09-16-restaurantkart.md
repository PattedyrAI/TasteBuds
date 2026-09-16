# Kategorimaler med valgfritt kart

Brukerens avklarte krav: gruppeadmin oppretter en kategori med selvvalgte vurderingsfelt. Kategorier har ingen foreldre eller underkategorier. Hvert egnet felt kan brukes som filter. Lokasjonsfelt gir et eget Liste/Kart-valg inne i akkurat den kategorien, uten kartinngang i hovedmenyen.

## Utforming

«Lag kategori» i vurderingsskjemaet åpner en egen malbygger. Navn, bilder, poeng, notat og dato beholdes i utkastet. Ved lagring velges den nye kategorien og brukeren fortsetter vurderingen. Eksisterende gruppeier er admin. Vanlige medlemmer kan bruke maler, men ikke opprette eller endre dem, heller ikke indirekte gjennom API-et.

Felttyper: tekst, tall, pris, valgliste, ja/nei og lokasjon. Admin bestemmer navn, obligatorisk verdi og om feltet skal vises som filter. Valg som Cuisine er vanlige selvdefinerte felt. Tidligere vurderinger beholder et øyeblikksbilde av feltene sine etter senere malendringer. Filtrering bruker verdiene i nyeste vurdering av oppføringen.

Google leverer kart og posisjon; oppføringens navn og vurderinger kommer fra gruppen. Bare Place ID lagres varig. Koordinater hentes med feltmasken `id,location` og mellomlagres i prosessminne i maksimalt ett døgn. Søk bruker `BasicPlaceAutocompleteElement` fra Places UI Kit. Flere oppføringer kan dele sted, og samles i én markør.

## Gjennomført

- Migrering 007: feltmaler, vurderingsverdier og historiske maler, gruppebundet stedskobling og atomisk dagsgrense.
- Adminbeskyttet kategori-API og medlemsbeskyttet kart-API som filtrerer på kategori-ID før Google-oppslag.
- Servervalidering av maler, verdier, bilde-/gruppeadgang og sted. Idempotente vurderinger og historikk bevares.
- Malbygger, dynamiske vurderingsfelt, feltfiltre og retur til utkast.
- Behovsstyrt Google SDK. Kartinstansen og utsnittet beholdes ved filtrering. Liste og konfigurasjonsfeil er tilgjengelige uten Google-oppsett.
- Oppsettdokument: [Google Maps](../../GOOGLE-MAPS.md).

## Verifikasjonsgrense

Arbeidet utføres lokalt. Automatiske tester bruker lokal testdatabase og simulert Google-tjeneste. Nettlesertest bruker faktisk grensesnitt med simulerte API-svar og SDK; den beviser utkastflyt, kategoriavgrensning, filtre og kartets livssyklus, ikke ekte Google-gjengivelse. Gyldige begrensede nøkler og siste kontroll mot Google kreves før funksjonen kan regnes som verifisert med ekte kart. Ingen produksjonsmigrering eller publisering inngår.
