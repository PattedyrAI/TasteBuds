# Kategori-UX og Food-ruting – design- og rutingkontrakt (TKT-0146)

Eier: Astra (rot t-03c669528e71) implementerer. Designreview: Opus 5.5 (t-914d1e7d673f).
Ingen produksjonsdata korrigeres, ingen historisk replay, ingen deploy i denne planen.

## 1. Funn (dagens kode)

Evidens: lokal fixture (`/tmp/tkt146-fx`, esbuild-bundle av ekte `RatingForm` + `globals.css`,
mocket `fetch`, ingen database) kjørt i Chrome med Playwright på 390 og 1440.
Skjermbilder: `/tmp/tkt146-catux-form-390.png`, `-form-1440.png`, `-menu-390.png`,
`-menu-1440.png`, `-stale-type-390.png`.

| # | Funn | Kilde | Nivå |
|---|---|---|---|
| F1 | Food-ruting ser bare på `items.type_id = ANY(category_ids)`. `broad_category` ignoreres helt. En vare uten type får aldri en Food-rad i outboxen. | `src/server/services/ratings.ts:84-87` (enqueue), `src/server/discord.ts:50` (send-recheck), `src/server/discord.ts:29-30` (kansellering) | REASONED |
| F2 | Skjemaet har ingen kontroll for broad. `broad` settes bare fra lenket vare (`rating-form.tsx:19`) eller AI (`:73`). Manuell kantinelunsj sender `type:null, broadCategory:null`. | `rating-form.tsx:85` | EXECUTED (fixture-POST) |
| F3 | Type er klistrete: `choose()` setter `type` fra lenket vare (`rating-form.tsx:33`), men «Create a different item instead» nullstiller bare `itemId/linkedItem/extraValues` (`:113`). Navn kan skrives om, typen blir stående. | `rating-form.tsx:33`, `:113` | EXECUTED |
| F4 | Kategori ligger under Model, er merket «optional», og viser 58 blandede typer alfabetisk (mat, drikke, filmer, brettspill). Energidrikk-oppslaget (merkevare-chips) aktiveres først når typen er valgt, altså etter at Brand allerede er fylt ut. | `category-picker.tsx:4-7`, `rating-form.tsx:104-108` | OBSERVED |
| F5 | AI-prompten ber om `broadCategory (usually Food & Drink)`. Lagrede broad-verdier kan derfor være «Food & Drink», som ikke kan skille mat fra drikke. | `src/server/recognition-format.ts:18` | REASONED |
| F6 | Tre opplastingsflater for samme handling: stor stiplet flate + «Upload a photo» (+ «Add photos»-flis når bilder finnes). Kamera og opplasting er riktig separert, men duplikatet skyver kategoriene ned. Bildehjelpetekst gjentas tre steder (`:94`, `:99`, `:116`). | `rating-form.tsx:94-99`, `:116` | OBSERVED |
| F7 | Blandet språk: «+ Lag kategori», «valgfritt», «Velg…» i et engelsk skjema. | `category-picker.tsx:7`, `review-fields.tsx:10-12` | OBSERVED |
| F8 | Feil vises som én `<p role=alert>` nederst. Fokus flyttes ikke til feltet. | `rating-form.tsx:117` | REASONED |

### Rotårsak pizza → «Bubble tea»
Reprodusert mekanisme (EXECUTED i fixture): Brand «Divanos», Model «Leftover pizza» → match-listen
foreslår en eksisterende Divanos-vare (`item-matches.ts:40-52`: samme merke + «leftover» gir
likhet 0,5 som er nok) → bruker trykker raden → `type='Bubble tea'` (`rating-form.tsx:33`) →
«Create a different item instead» (`:113`) → navnet skrives om til pizza → POST
`{name:'Leftover pizza', brand:'Divanos', type:'Bubble tea'}`. Picker-teksten viser «Bubble tea»,
men står under Model, er merket optional og blir ikke lagt merke til.
**Uverifisert:** at den faktiske produksjonsraden ble lagret slik. Det krever at det fantes en
Divanos-vare med typen Bubble tea da raden ble lagret, eller at feltet ble valgt ved en feil i
den alfabetiske listen (der Bubble tea ligger øverst). Jeg har ikke lest produksjonsdatabasen.

### Rotårsak kantine Food/Lunch → ingen Food-kanal
`type_id IS NULL` → `NULL = ANY(...)` gir NULL → ingen outbox-rad (`ratings.ts:87`). Broad blir
aldri satt manuelt (F2), og ville uansett blitt ignorert (F1).

## 2. Designkontrakt (skjema)

Retning: behold eksisterende tokens (Jakarta, `--blue`, `--line`, `--radius`). Det eneste nye
visuelle elementet er valget av hovedkategori. Resten blir roligere og står lenger ned.

```
390                                     1440 (modal, samme rekkefølge, maks 640px bredde)
┌──────────────────────────────┐
│ What did you try?          ✕ │
│ [ photo strip  0/5 ]         │  ← tom strip = én linje med tekst, ingen stor stiplet flate
│ [📷 Take a photo][⬆ Upload]  │  ← to like knapper side om side (≥44px), alltid synlige
│ What is it?  *               │
│ [🍽 Food][🥤 Drink][◇ Other]  │  ← påkrevd radiogroup, 3 like store fliser, ≥56px høye
│ Type  optional               │
│ (Pizza)(Burgers)(Lunch)(…)   │  ← ≤6 chips for valgt kind, mest brukt i gruppen først
│ [More types…]  [+ New type]  │  ← SelectMenu filtrert på kind; «New type» bare for managers
│ Brand / Restaurant *         │
│ Model *                      │  ← Brand før Model beholdes
│ (template required fields)   │
│ Your rating ───●──── 7/10    │
│ ▸ More details               │  ← Variant, Notes, Date, valgfrie malfelt
│ [        Save rating       ] │
└──────────────────────────────┘
```

Regler:
1. **Kind er påkrevd for nye varer**: Food / Drink / Other som `role="radiogroup"` med piltaster.
   Ingen forhåndsvalg, heller ikke fra AI hvis brukeren har valgt selv.
2. **Type er valgfri** og vises først etter at kind er valgt. Chips = de ≤6 mest brukte typene i
   gruppen for denne kinden. «More types…» åpner dagens søkbare `SelectMenu` med samme filter.
   Ingen 58-linjers blandet liste i hovedflyten.
3. **Kind for en type** = `item_types.broad_category` (ny, nullable). Hvis den er null, brukes en
   statisk standard i `domain/item-types.ts` (`Pizza, Burgers, … → Food`; `Energy drinks, Coffee,
   Tea, Beer, Bubble tea, Soft drinks … → Drink`). Ukjente egendefinerte typer (null + ikke i
   kartet) vises under Other-chips og er søkbare fra «More types…» under alle tre. Da blir
   eksisterende maler aldri borte.
4. **Bytte av kind** fjerner typen bare når typens kjente kind er en annen. Ukjent type beholdes.
   Hvis brukeren velger en type med kjent kind, settes kinden til typens kind, og en
   `aria-live`-hint sier fra («Bubble tea is a drink – switched to Drink»).
5. **Energy drinks**: velg Drink, deretter Energy drinks, deretter merkevare-chips under Brand,
   så modell-chips under Model og Sugarfree i More details. Fordi type står over Brand, fungerer
   oppslaget i riktig rekkefølge.
6. **Lenket vare** (match/rereview/edit): kind og type vises skrivebeskyttet («Food · Pizza»,
   eller «Kind not set» for gamle rader). Match-raden viser typen før valg (`Divanos · Bubble
   tea`). «Create a different item instead» gjenoppretter utkastet fra før lenkingen (navn,
   merke, variant, kind, type, malverdier). Dette retter F3.
7. **AI**: setter kind bare når kind er tom. Hvis AI-typen motsier valgt kind, droppes typen med
   en hint. AI endrer aldri en kind brukeren har valgt.
8. **Bilder**: fjern den store stiplede flaten og «Add photos»-flisen. Behold «Take a photo»
   (`capture="environment"`) og «Upload a photo» (multiple) som to separate knapper. Én
   hjelpelinje: «First photo is the cover. Up to 5.»
9. **Færre synlige valgfrie felt**: Variant, Notes, Date og valgfrie malfelt flyttes inn i
   `<details>` «More details», med sammendrag («Today · no notes»). Påkrevde malfelt vises alltid.
   Disclosure åpnes automatisk hvis et felt i den har en feil.
10. **Feil**: inline under feltet (`aria-describedby`, `aria-invalid`). Ved lagring flyttes fokus
    til første ugyldige felt, og den nederste `role=alert` beholdes som sammendrag. Tekster:
    «Choose Food, Drink or Other.» · «Enter a brand or restaurant.» · «Add a photo first.» ·
    «Bubble tea is a drink. Choose Drink or another type.» (server 400, samme tekst).
11. Språk: «+ New type», «optional», «Choose…» i skjemaet (F7). Norsk tekst i maleditoren kan
    stå til egen oppgave.

## 3. Rutingkontrakt (backend)

**Avgjørende felt:** `items.broad_category`, normalisert. Typelisten er bare fallback for gamle data.

```
kind(item) := CASE lower(trim(broad_category)) WHEN 'food' THEN 'Food' WHEN 'drink' THEN 'Drink'
              WHEN 'other' THEN 'Other' ELSE NULL END      -- 'Food & Drink' ⇒ NULL
eligible('all', i)      := true
eligible('food', i)     := kind(i)='Food' OR (kind(i) IS NULL AND i.type_id = ANY(food.category_ids))
eligible(r, i), r∉{all,food} := i.type_id = ANY(r.category_ids)
Precedence: høyst én destinasjon per vurdering. En aktivert spesifikk ikke-food-rute som lister
type_id vinner over food. Food krever da NOT EXISTS for en slik rute.
```

- Ett SQL-uttrykk eller én SQL-funksjon brukes både ved enqueue (`ratings.ts:84`), ved
  send-recheck (`discord.ts:50`) og ved kansellering ved konfig-endring (`discord.ts:29`). Ikke
  tre kopier som kan gli fra hverandre.
- `createRatingSchema.broadCategory`: `Food|Drink|Other` uten skille på store og små bokstaver,
  lagres i kanonisk form. **Påkrevd når `itemId` mangler** (400 «Choose Food, Drink or Other.»,
  path `broadCategory`). Ignoreres når `itemId` er satt, fordi lagret identitet styrer.
  `updateItemSchema` får samme enum, og null er fortsatt tillatt.
- Server avviser type med kjent kind som motsier `broadCategory` (400, tekst over). Ukjente typer
  godtas med alle kinds.
- `item_types.broad_category text NULL CHECK (IN ('Food','Drink','Other'))` i ny migrasjon.
  Ingen backfill. `createCategory` tar valgfri `broadCategory`. Skjemaet sender gjeldende kind når
  «+ New type» brukes. `fields` og medlemskap berøres ikke.
- AI-prompt/schema: `broadCategory` enum `Food|Drink|Other|null`.
- Discord-konfig: food-ruten beholder `category_ids` (DB-check krever ≥1 når den er aktivert).
  Listen er nå fallback for gamle rader og trenger ikke vedlikeholdes per rett.

**Gamle rader** (ingen korrigering, ingen replay): broad null + type i food-listen → Food som i
dag. Broad null + type null (kantinen) → ingen rute. Pizza med type Bubble tea og broad null →
ikke Food. Nye vurderinger av en lenket gammel vare arver dette, til en manager endrer kind/type
på varen (`item-detail.tsx:43`, som også bør få kind-kontroll). Allerede køede rader sjekkes
mot `eligible` ved sending, og blir ellers kansellert.

| Tilfelle | Kind | Type | Discord |
|---|---|---|---|
| Divanos «Leftover pizza» (ny) | Food | Pizza | Food |
| Innovasjonsparken Cantine «Lunch» (ny) | Food | – | Food (via kind) |
| Monster «Ultra White» sugarfree | Drink | Energy drinks | Energy (ikke Food) |
| Egendefinert «Board games» med malfelt | Other | Board games | ingen (eller `all` hvis den er eneste aktive rute) |
| Egendefinert «Cantine meals» (kind null) under Food | Food | Cantine meals | Food |
| Gammel pizza = Bubble tea, broad null | – | Bubble tea | ingen (dokumentert, ikke rettet) |
| Gammel kantine, broad/type null | – | – | ingen (dokumentert, ikke rettet) |

## 4. Tester

Enhetstester (`tests/category-kind.test.ts`, ny):
- `kindOf` normaliserer `food/FOOD/ Food ` → Food. `Food & Drink`, `Snacks` og `''` → null.
- `defaultKindOfType`: Pizza→Food, Bubble tea→Drink, Energy drinks→Drink, «Board games»→null.
- `createRatingSchema` uten itemId og uten broad → feil på path `broadCategory` med eksakt tekst.
  Med itemId og uten broad → ok.
- Motstrid: broad Food + type Bubble tea → feil. Broad Food + type «Cantine meals» (ukjent) → ok.

Komponent (`tests/rating-form-category.test.tsx`, jsdom eller statisk markup + driver):
- Rekkefølge i markup: photos < kind-radiogroup < type < Brand < Model < Save. Brand er required.
- Lenk match → «Create a different item instead» → POST har `type` lik utkastet før lenking
  (null), ikke `Bubble tea`. **Regresjon for F3.**
- Bytt kind Food→Drink med type Pizza → type tømmes. Med ukjent type → type beholdes.
- AI-forslag med type Bubble tea når kind=Food → type null, kind Food, hint vises.
- Kamera-input har `capture="environment"` og ingen `multiple`. Upload-input har `multiple`.
  Ingen tredje opplastingsflate.
- Lagre uten kind → fokus på første radio, `aria-invalid=true`, tekst «Choose Food, Drink or Other.»

Integrasjon (isolert PostgreSQL, utgående Discord mocket; utvid
`tests/integration-discord-routing.test.ts`):
- Generisk Food uten type → én food-rad, sendt til food-hook (finnes allerede i utkastet).
- Food + ny type som ikke er i food-listen → food (finnes).
- Broad endret til Drink før sending → kansellert (finnes).
- **Ny:** `broadCategory:'Food & Drink'` + type Pizza (gammel verdi, satt via SQL) → food
  (fallback). Samme med type Coffee → ingen rad.
- **Ny:** broad null + type null → ingen outbox-rad.
- **Ny:** Drink + Energy drinks med både energy- og food-rute aktivert → nøyaktig én rad
  (`energy_drinks`).
- **Ny:** Food + type som står i energy-listen → én rad, energy (precedence).
- **Ny:** Other + egendefinert mal med påkrevd felt → ingen rad. `custom_fields` lagres. Malens
  `fields` er uendret etter `createCategory` med `broadCategory`.
- **Ny:** Aktivering av food-ruten på nytt etter at kind er endret gir ingen replay av eldre
  vurderinger.
- **Ny:** Ny vurdering av lenket gammel vare (broad null, type null) → ingen rad. Etter at manager
  setter broad=Food på varen → neste vurdering får food-rad. Tidligere rad forblir urørt.

## 5. Akseptanse: visuelt, tastatur og mobil

- 390×844: kind-flisene er synlige uten scrolling etter at ett bilde er lagt til. Ingen
  horisontal scroll. Alle trykkflater ≥44px (kind ≥56px). Strip, to bildeknapper, kind og type
  passer innenfor første skjermhøyde pluss én scroll.
- 1440: modal ≤640px, samme rekkefølge, kind-flisene på én rad, chips brytes.
- Tastatur: Tab går gjennom foto → Take → Upload → kind-gruppe (én tabstopp, piltaster flytter
  og velger) → type-chips → More types → Brand → Model → rating → More details → Save. Synlig
  fokus (eksisterende `outline:3px #809af4`). Esc lukker SelectMenu og gir fokus tilbake til
  utløseren.
- Skjermleser: radiogroup med navnet «What is it?» og required. Hint ved kind-bytte i
  `aria-live=polite`. Feil i `aria-describedby`.
- Redusert bevegelse respekteres (eksisterende global regel). Ingen ny inngangsanimasjon.
- Visuell sjekk i fixture: pizza-, kantine-, energidrikk- og Board games-flyt ved 390 og 1440,
  pluss lenk/avlenk-flyt. Lokal fixture eller isolert database. Aldri produksjonsdatabasen.

## 6. Åpne beslutninger for Astra/Patrick

1. Påkrevd `broadCategory` på API-et bryter eksisterende testhjelpere som lager varer uten
   broad. De må oppdateres, eller så kan server utlede kind fra kjent type. Anbefaling: påkrevd.
2. Ny migrasjon for `item_types.broad_category` (nullable, ingen backfill). Alternativet uten
   migrasjon er bare statisk kart, men da havner nye egendefinerte mattyper under Other.
   Anbefaling: migrasjon.
3. Om Divanos-pizzaen og kantine-varen skal rettes manuelt i appen av en manager. Det er
   Patricks valg og ligger utenfor denne planen.
