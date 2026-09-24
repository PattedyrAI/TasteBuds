# Større bilder og ryddigere vurderingsskjema

Skjemaet har et bildefelt i full bredde, samkjørte felttitler med «optional» på samme linje, kortere hjelpetekst og et tallfelt uten nettleserens store pilknapper. Eksisterende halvpoengslider og manuell inntasting med én desimal er bevart.

Et klikk på et opplastet bilde åpner den delte bildeviseren. Samme bildeviser brukes fra publiserte vurderingers gallerier. Den viser hele bildet uten beskjæring i et vindu på opptil 1120 px, tilbyr dobbelt zoom og lar brukeren rulle eller sveipe rundt i det forstørrede bildet. Bildebytte nullstiller zoom. Piltaster bytter bilde når zoom er av.

Bildeviseren er en egen dialog over skjemaet. Escape stopper hendelsesbobling før dialogen lukkes, slik at utkastet under beholdes. Knappene har eksplisitt type og sender ikke inn skjemaet. Ingen API- eller databasekontrakt er endret.

## Verifisering 16. september 2026

- 209 enhetstester, typesjekk og produksjonsbygg bestått.
- Uavhengig gjennomgang fant Escape-boblingen. Feilen ble rettet og sluttkontrollert.
- Nettlesertest av de faktiske React-komponentene med syntetisk API ved 320, 390 og 1440 px: ingen horisontal overflyt, fullbreddeopplasting og justerte felt.
- To lokale JPG-er: opplasting, forsidebytte, forstørring, zoom og lagring beholdt begge bilde-ID-ene i riktig rekkefølge og manuelt skrevet karakter 6,7.
- Redigering og REREVIEW: Escape lukket bare bildeviseren; notat og begge bilder ble bevart. Lagringspayload kontrollert i lokal fixture.
- Skjermbilder inspisert: `output/playwright/form-390.png` og `output/playwright/large-photo-1440.png`.
- Ingen testvurdering eller bilde ble skrevet til produksjonsdatabasen i denne kontrollen.

## Publisering

Kildecommit `e74dcd3dc793e34690408cc4be996549b8b61eb0` nådde Railway `SUCCESS` i utrulling `949c06a3-b494-4f7c-94cf-a6e1bce3a653`. Alle ni offentlige lanseringskontroller bestod mot korrekt versjonsmarkør klokken 14:21 UTC. Nettsidens leverte CSS inneholder den nye bildeviseren og skjemaendringene. Innlogget produksjonsflyt ble ikke kjørt på nytt; interaksjonene ble verifisert i den lokale nettleserfixturen.

Bare `APP_RELEASE` ble endret i konfigurasjonen. Den allerede publiserte kartintegrasjonen og Google-konfigurasjonen er bevart. Ingen migrering var nødvendig. GitHub-innloggingens tidligere rapporterte feil ble ikke forsøkt løst i dette oppdraget; publiseringen gikk direkte til Railway.
