# Review av sukkerfri-identiteter

Planner-en leser bare items med type `Energy drinks`, separat per gruppe, i en
`REPEATABLE READ READ ONLY`-transaksjon. Den endrer ingen data. Kjør lokalt:

```sh
SUGARFREE_REVIEW_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_sugar_test \
  npx tsx scripts/plan-sugarfree-corrections.ts
```

Rapporten viser antall og før/etter-identiteter, uten rating-notater eller persontekst.
Hver gruppe med forslag får en version-1-plan i `.private/` (mappe `0700`, fil `0600`).
Grupper uten endringer får ingen plan. Filene er **ikke gjennomgåtte kandidater**;
se bilder og godkjenn hver endring, og erstatt planens `evidence` med review-bevis.
Planen inneholder snapshot-SHA-er og fotohasher; endringer siden baseline stopper apply.

`canonical-regular` betyr kun at lagret variant er `null`, ikke at sukkerinnholdet
er verifisert. Tvetydig `Zero`, ukjent `Ultra`, manglende merke og blandede
smaksvarianter blir stående for menneske-/bildereview. Eksplisitte sukkerfri-ord
normaliseres til `Sugarfree`. En begrenset produsentliste i
`src/domain/sugarfree-corrections.ts` dekker Monster Ultra/White/Paradise/Sunrise og
Red Bull Zero/Sugarfree. Red Bull Zero beholder produktnavnet; Sugarfree beholdes
også når fjerning ville gitt tomt navn. Ingen bred produktgjetting eller alias-merge.

Ved samme målidentitet innen samme gruppe og merke foreslås rating-flyttinger til
et kanonisk item (ellers laveste UUID). Ulike eller ukjente merker merges aldri.
Kildeitemet slettes eller omdøpes ikke; også slettede rating-historikkrader flyttes.
Duplikater uten ratings vises, men krever manuell vurdering og gir ingen move.

Valider en gjennomgått plan med eksisterende script (standard er rollback):

```sh
IDENTITY_CORRECTION_DATABASE_URL=postgresql://postgres:pg@127.0.0.1:55440/everrate_sugar_test \
  npx tsx scripts/apply-identity-corrections.ts --plan=.private/sugarfree-plan-GROUP-PLAN.json
```

Legg til `--apply` først etter review. Se [IDENTITY-CORRECTIONS.md](IDENTITY-CORRECTIONS.md)
for hele kontrakten. Planner-ens `--allow-remote-readonly` tillater eksplisitt remote
**lesing**, alltid i read-only-transaksjon; det gir ingen apply-fullmakt.
Produksjonsapply krever Patricks uttrykkelige godkjenning, Mac-only `.private`-
credentials og en separat gjennomgått produksjonswrapper. Eksisterende apply-CLI
aksepterer bare loopback. Ikke kopier produksjonscredentials til devbox.

```sh
npx vitest run tests/sugarfree-plan.test.ts
npx tsc --noEmit
```
