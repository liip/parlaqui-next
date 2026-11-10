# How ws.parl.ch serves members and photos

The roster import reads the active members of the Nationalrat and the Ständerat from the Swiss
Parliament Open Data Web Service (OWS). This page is the reference for the parser and the API
client. Everything below was checked with live requests on 2026-10-28 (`scripts/parl-probe.ts`),
and the fixtures in `test/fixtures/parl/` are real responses from that day.

- OpenAPI: https://ws.parl.ch/doc/v3/api-docs
- Guidelines (filter grammar, paging, languages): https://ws.parl.ch/doc/api-guidelines.html
- API key: free, request it at https://ws.parl.ch/registration. Send it in the `X-API-KEY` header
  on every request. Locally it lives in `.env` as `PARL_API_KEY`.

Always use the versioned paths (`/api/v1/...`). The unversioned `/api/...` paths follow the newest
version and may change.

## The request

One request per page and per language:

```
GET https://ws.parl.ch/api/v1/persons
  ?lang=de
  &q=and(eq(active,true),eq(type.key,"1731013"),in(council.key,"1311000","1311001"))
  &include=id,legacyId,active,firstName,lastName,gender,type,council,canton,party,activeElection
  &sort=id
  &size=100
  &page=0
  &withCounts=true
X-API-KEY: <key>
```

URL-encode `q` and `include`. Run the probe for the full list: `npx tsx scripts/parl-probe.ts`
(add `--check-photos` to request every photo, `--write-fixtures` to refresh the fixtures).

Result observed live on 2026-10-28 (not in the fixtures, which hold six members): 246 members
(200 Nationalrat, 46 Ständerat) in 3 pages, the same 246 ids in `de`, `fr`, `it` and `rm`. This
matches `/api/v1/seats-nc` (200 seated members) and `/api/v1/seats-cs` (46), all of them in the
filtered set.

## 1. The filter for current members

```
and(eq(active,true),eq(type.key,"1731013"),in(council.key,"1311000","1311001"))
```

- `active` is true for every person currently in office, Federal Council included.
  `eq(active,true)` alone returns 255 persons.
- The 9 extra persons are told apart by `type.key` and `council`:

| `type.key` | `type.abbreviation` (de)   | Who                                     | `council`             | Count |
| ---------- | -------------------------- | --------------------------------------- | --------------------- | ----- |
| `1731013`  | `RM` Ratsmitglied          | Member of NR or SR                      | `1311000` / `1311001` | 246   |
| `1731002`  | `BR` Bundesrat/Bundesrätin | Federal Councillor                      | `null`                | 7     |
| `1731001`  | `BK` Bundeskanzler/in      | Federal Chancellor and vice-chancellors | `null`                | 2     |

The table's counts and the `BK` row were observed live on 2026-10-28 and are not in the fixtures.
Either `eq(type.key,"1731013")` or `in(council.key,...)` alone also returns 246 (observed live);
the filter uses both.

Rule for the parser (backed by the fixtures): a record is a roster member only if `type.key` is
`"1731013"` and `council.key` is `"1311000"` or `"1311001"`. Drop anything else, even if the
filter should already have removed it. A Federal Council record fails both tests: `type.key` is
`"1731002"`, and `council`, `canton` and `activeElection` are `null`. It also has a non-empty
`activeFederalCouncilMandates`, which the member request does not include. From
`test/fixtures/parl/federal-councillor-de.json` (Karin Keller-Sutter, fetched by id with
`activeFederalCouncilMandates` added to `include`):

```json
{ "id": 4062, "legacyId": 2769, "firstName": "Karin", "lastName": "Keller-Sutter",
  "type": { "key": "1731002", "abbreviation": "BR", "name": "Bundesrat/Bundesrätin" },
  "council": null, "canton": null, "activeElection": null,
  "activeFederalCouncilMandates": [
    { "start": "2023-01-01", "end": null, "department": { "abbreviation": "EJPD", ... }, ... },
    { "start": "2026-01-01", "end": null, "department": { "abbreviation": "EFD", ... }, ... } ] }
```

- Filter on keys, not on abbreviations or names: abbreviations are translated (see 3), and with
  `lang=rm` they are `null`.
- Council keys (`/api/v1/councils`): `1311000` Nationalrat, `1311001` Ständerat, `1311002`
  Vereinigte Bundesversammlung (never a member's council).
- A member who announced a departure stays active until the date: on 2026-10-28, three active
  members already have an `activeElection.leavingDate` in the future (Anna Giacometti 2026-11-29,
  in the fixtures; Lukas Reimann and Andreas Glarner 2026-12-31, observed live). Every other
  active member has `9999-12-31` (observed live). A member who has left is `active: false` (Piero
  Marchesi, left 2026-09-24, replaced by Roberta Soldati; observed live, not in the fixtures).

## 2. Paging

- `size`: the persons endpoint documents default 20, maximum 300; the guidelines say maximum 1000. Observed live (not in the fixtures): the server accepts up to 1000 and silently caps
  larger values (`size=1001` answers with `"size": 1000`). Use 100: three pages for 246 members,
  inside every documented limit.
- `page` is zero-based.
- The last page is the one with `page.hasNext: false` (in the fixtures). A page past the end
  answers `200` with empty `content` (observed live).
- `withCounts=true` fills `page.totalElements` and `page.totalPages`; without it both are `null`
  (both cases in the fixtures: the persons files use `withCounts=true`, the cantons files do not).
  Use the count to check that all pages arrived.
- Use `sort=id` so the order is stable between pages.

From `test/fixtures/parl/persons-de-page0.json` and `-page1.json` (the six fixture members, fetched
with `size=3`):

```json
"page": { "size": 3, "number": 0, "hasNext": true,  "totalElements": 6, "totalPages": 2 }
"page": { "size": 3, "number": 1, "hasNext": false, "totalElements": 6, "totalPages": 2 }
```

## 3. Languages

| Language | `lang` | Served                                |
| -------- | ------ | ------------------------------------- |
| German   | `de`   | yes (also the default without `lang`) |
| French   | `fr`   | yes                                   |
| Italian  | `it`   | yes                                   |
| Romansh  | `rm`   | **no**                                |

The OpenAPI spec lists only `de`, `fr`, `it`. `lang=rm` (and any unknown value, e.g. `lang=xx`,
observed live) still answers `200` with the same members, but every translated field is `null`: `party.name`,
`party.shortName`, and `abbreviation`/`name` of `gender`, `type`, `council`, `canton` and
`activeElection.*`. Keys, ids, `party.code`, names and dates are still there. Compare
`persons-de-page0.json` with `persons-rm-page0.json`:

```json
"party":  { "code": "P-SP", "name": null, "shortName": null, "id": 30012 },
"canton": { "key": "1661023", "categoryKey": "166", "abbreviation": null, "name": null },
"gender": { "key": "1621001", "categoryKey": "162", "abbreviation": null, "name": null }
```

So no member has a Romansh party name, and `canton.abbreviation` is `null` too. The `rm` files in
the fixtures show this for all six members, including Jositsch.

**Rule:** the client still fetches `lang=rm` (all pages, like the other languages). The parser
falls back field by field to the German value whenever the `rm` value is `null` or empty: today
that is the party and the canton, every time. The canton abbreviation must come from the German
record (or from `canton.key`, see 4), never from the `rm` record, because `rm` has `null` there.

What changes with the language:

| Field                  | de                                     | fr                      | it                          |
| ---------------------- | -------------------------------------- | ----------------------- | --------------------------- |
| `party.shortName`      | `SP`                                   | `PSS`                   | `PSS`                       |
| `party.name`           | Sozialdemokratische Partei der Schweiz | Parti socialiste suisse | Partito socialista svizzero |
| `gender.abbreviation`  | `M` / `W`                              | `m` / `f`               | `m.` / `f.`                 |
| `council.abbreviation` | `NR` / `SR`                            | `CN` / `CE`             | `CN` / `CS`                 |
| `canton.name`          | Waadt                                  | Vaud                    | Vaud                        |
| `canton.abbreviation`  | `VD`                                   | `VD`                    | `VD` (same in all three)    |

`firstName`, `lastName`, `id`, `legacyId` and all `key` values are the same in every language.

`party.shortName` of the 246 members, observed live on 2026-10-28 (not in the fixtures) (de / fr /
it):

| de           | fr       | it    | Members |
| ------------ | -------- | ----- | ------- |
| SVP          | UDC      | UDC   | 68      |
| SP           | PSS      | PSS   | 48      |
| M-E          | M-E      | M-E   | 44      |
| FDP-Liberale | PLR      | PLR   | 38      |
| GRÜNE        | VERT-E-S | VERDI | 25      |
| glp          | pvl      | pvl   | 12      |
| MCG          | MCG      | MCG   | 3       |
| EVP          | PEV      | PEV   | 2       |
| EDU          | UDF      | UDF   | 2       |
| Lega         | Lega     | Lega  | 1       |
| LDP          | PLD      | PLD   | 1       |
| Al           | Al       | Al    | 1       |
| -            | -        | -     | 1       |

The `-` is Daniel Jositsch (Ständerat ZH, id 3891, in the fixtures). His record in
`persons-de-page0.json`, `persons-fr-page0.json` and `persons-it-page0.json`:

```json
"party": { "code": "-", "name": "parteilos",     "shortName": "-", "id": 30026 }
"party": { "code": "-", "name": "sans parti",    "shortName": "-", "id": 30026 }
"party": { "code": "-", "name": "senza partito", "shortName": "-", "id": 30026 }
```

Die Mitte is `M-E` in all three languages (`party.name` "Die Mitte" / "Le Centre", in the
fixtures for Isabelle Chappuis).

## 4. JSON paths

Per element of `content[]`:

| Value      | Path                         | Notes                                                                                                         |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| id         | `id`                         | Integer. Same as the old OData `Person.ID` (Maillard: 491).                                                   |
| photo code | `legacyId`                   | Integer or `null`, see 5. Deprecated in the API; filled for all 246 (observed live).                          |
| first name | `firstName`                  | Same in all languages.                                                                                        |
| last name  | `lastName`                   | Same in all languages. Trim: Isabelle Chappuis has `"Chappuis "`.                                             |
| gender     | `gender.key`                 | `1621001` male, `1621002` female (live: 148 / 98).                                                            |
| council    | `council.key`                | `1311000` Nationalrat, `1311001` Ständerat. Same as `activeElection.council.key`.                             |
| canton     | `canton.abbreviation`        | Two letters, same in de/fr/it, `null` in rm. Or map `canton.key` (`1661001`-`1661026`) via `/api/v1/cantons`. |
| party      | `party.shortName`            | Translated, `null` in rm. `party.id` / `party.code` are language independent.                                 |
| sworn in   | `activeElection.swornInDate` | `YYYY-MM-DD`.                                                                                                 |

Use the keys for gender and council: the abbreviations differ per language (`M`/`W` in German,
`m`/`f` in French, `m.`/`f.` in Italian). Observed live, not in the fixtures: among all 255 active
persons, 2 have `gender: null` (the two vice-chancellors, excluded by the filter).

Canton keys from `/api/v1/cantons`, saved as `test/fixtures/parl/cantons-{de,fr,it,rm}.json`
(identical abbreviations in de/fr/it, `null` in rm): `1661001` AG, `1661002`
AR, `1661003` AI, `1661004` BL, `1661005` BS, `1661006` BE, `1661007` FR, `1661008` GE, `1661009`
GL, `1661010` GR, `1661011` JU, `1661012` LU, `1661013` NE, `1661014` NW, `1661015` OW, `1661016`
SH, `1661017` SZ, `1661018` SO, `1661019` SG, `1661020` TI, `1661021` TG, `1661022` UR, `1661023`
VD, `1661024` VS, `1661025` ZG, `1661026` ZH. (`1661000` is a placeholder with abbreviation
`" --"`; it is in the cantons fixtures but no member has it.)

## Mapping to ParsedMember

`ParsedMember` is defined in `src/lib/server/roster/types.ts`. Below, `de`, `fr`, `it` and `rm`
are the records with the same `id` in the responses for each `lang`.

| `ParsedMember` | Source                   | Rule                                                                                                        |
| -------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`           | `de.id`                  | Integer as is. Records in the four languages are joined on `id`.                                            |
| `firstName`    | `de.firstName`           | Trim leading and trailing whitespace.                                                                       |
| `lastName`     | `de.lastName`            | Trim leading and trailing whitespace (`"Chappuis "` becomes `"Chappuis"`, id 10817 in the fixtures).        |
| `gender`       | `de.gender.key`          | `"1621001"` → `'m'`, `"1621002"` → `'f'`. No other value seen among the 246 members (observed live).        |
| `council`      | `de.council.key`         | `"1311000"` → `'N'`, `"1311001"` → `'S'`. Any other value or `null`: not a roster member, drop it (see 1).  |
| `canton`       | `de.canton.abbreviation` | Two letters as is, e.g. `"VD"`. Never from `rm` (`null`). Equivalent: map `canton.key` with the table in 4. |
| `party.de`     | `de.party.shortName`     | See the party rule below.                                                                                   |
| `party.fr`     | `fr.party.shortName`     | See the party rule below. German value if `null` or empty.                                                  |
| `party.it`     | `it.party.shortName`     | See the party rule below. German value if `null` or empty.                                                  |
| `party.rm`     | `rm.party.shortName`     | See the party rule below. Today always `null` in `rm`, so always the German value (`party.de`).             |
| `photoCode`    | `de.legacyId`            | Integer → decimal string (`2513` → `"2513"`). Missing or `null` → `null`. Never fall back to `id` (see 5).  |

Party rule, per language: take `party.shortName`. If it is `"-"` or empty, take that language's
`party.name` instead (Jositsch: `de` "parteilos", `fr` "sans parti", `it` "senza partito", all in
the fixtures). Never store `"-"`. If the value is still `null` or empty (always the case in `rm`),
use the German result. Jositsch in `rm` therefore gets "parteilos".

Expected results for the six fixture members:

| id    | firstName   | lastName   | gender | council | canton | party de / fr / it / rm                            | photoCode |
| ----- | ----------- | ---------- | ------ | ------- | ------ | -------------------------------------------------- | --------- |
| 491   | Pierre-Yves | Maillard   | `m`    | `S`     | VD     | SP / PSS / PSS / SP                                | `"2513"`  |
| 3891  | Daniel      | Jositsch   | `m`    | `S`     | ZH     | parteilos / sans parti / senza partito / parteilos | `"2694"`  |
| 4265  | Anna        | Giacometti | `f`    | `N`     | GR     | FDP-Liberale / PLR / PLR / FDP-Liberale            | `"3157"`  |
| 10817 | Isabelle    | Chappuis   | `f`    | `N`     | VD     | M-E / M-E / M-E / M-E                              | `"10817"` |
| 15601 | Severin     | Brüngger   | `m`    | `S`     | SH     | FDP-Liberale / PLR / PLR / FDP-Liberale            | `"15601"` |
| 18110 | Roberta     | Soldati    | `f`    | `N`     | TI     | SVP / UDC / UDC / SVP                              | `"18110"` |

## 5. The photo

**The photo code is `legacyId`.** The new `id` is the old OData `Person.ID`, and the new
`legacyId` is the old OData `Person.PersonIdCode`, which the old site used for its photo URL:

| Source                          | Pierre-Yves Maillard | Michael Götte | Roberta Soldati (sworn in 2026-09-28) |
| ------------------------------- | -------------------- | ------------- | ------------------------------------- |
| old OData `ID` / `PersonIdCode` | 491 / 2513           | 4335 / 3230   | 18110 / 18110                         |
| new API `id` / `legacyId`       | 491 / 2513           | 4335 / 3230   | 18110 / 18110                         |

The old OData values in the table were observed live; the new API values for Maillard and Soldati
are in the fixtures (Götte only live). Old OData check (no key needed):
`https://ws.parlament.ch/odata.svc/Person?$filter=ID eq 491 and Language eq 'DE'&$format=json`
returns `"ID": 491, "PersonIdCode": 2513`.

For persons created since the 2023 election, `legacyId` equals `id` (in the fixtures: Chappuis
10817, Brüngger 15601, Soldati 18110; observed live: 74 of the 246). Older persons have a
different, smaller code (in the fixtures: Maillard 491 → 2513, Jositsch 3891 → 2694, Giacometti
4265 → 3157). Observed live on 2026-10-28: all 246 members have a `legacyId`; only the two
vice-chancellors (not in the roster) have `null`. The API itself exposes no photo or image URL (no
such field in the OpenAPI spec).

**Rule:** `photoCode` is `legacyId` as a decimal string. If `legacyId` is missing or `null`,
`photoCode` is `null`: the member is stored but never shown in a game, and counted as a member
without photo. There is no fallback to `id`. `id` happens to equal `legacyId` for persons created
since 2023, but not for older ones (Maillard: 491 vs 2513), so using `id` would show wrong or
missing photos.

`legacyId` is marked deprecated in the OpenAPI spec. It is the only link to the photo code today.
The import counts the members whose `photoCode` is `null` (`without_photo`), and a member who had a
stored code and now comes without `legacyId` counts towards the photo-loss limit of the import, so a
change on the API side (the field emptied or removed) rejects the import instead of silently emptying
the game. A member without `legacyId` whose portrait is already on rokka keeps the stored code (see
[import.md](import.md)).

### Photo URLs

Everything in this subsection was observed live on 2026-10-28; images are not in the fixtures.

- parlament.ch, 260 x 260 JPEG:
  `https://www.parlament.ch/SiteCollectionImages/profil/portrait-260/<legacyId>.jpg`
- parlament.ch, full size (2000-3600 px, up to ~2 MB):
  `https://www.parlament.ch/SiteCollectionImages/profil/original/<legacyId>.jpg`
- The old site's rokka stack, 260 x 260 JPEG:
  `https://parlaqui.rokka.io/par/-<legacyId>.jpg-.jpg`

parlament.ch's own website builds its councillor photo URLs from `PersonIdCode` in the same way
(its script bundle `JavascriptBundleLoader.js` formats `councilorPhotoUrl` from `PersonIdCode`).
An unknown code answers `404` (`.../portrait-260/999999.jpg`), there is no placeholder image.
`.../profil/225x225/...` no longer exists (`404`).

### Where the rokka `par` stack takes its images from

`/par/-<path>-.jpg` is rokka's remote-path syntax: the stack loads `<path>` from a configured
remote base URL on first request and caches it. The stack configuration itself cannot be read
without a rokka key (`https://api.rokka.io/stacks/parlaqui/par` answers `403`), but the evidence
points to `https://www.parlament.ch/SiteCollectionImages/profil/portrait-260/` (all observed live
on 2026-10-28, nothing in the fixtures):

- rokka returns 260 x 260 images, the size of `portrait-260`.
- Pixel comparison (mean absolute difference per channel, 0-255): rokka vs `portrait-260` is 1.5
  to 5.5 for codes 2513, 17404 and 18110 (same picture, re-encoded). For 18110, rokka vs
  `original` scaled down is 27 to 43: that original is a different crop, so rokka does not read
  from `original`.
- rokka served 18110 (Roberta Soldati, sworn in 2026-09-28, long after the old site's last
  import), so it fetches new codes on demand.
- rokka answers `404` for a code that parlament.ch does not have (999999).

### Photo check, observed live on 2026-10-28 (not in the fixtures)

`npx tsx scripts/parl-probe.ts --check-photos` requested both 260 px URLs for every member
(8 requests in parallel):

- `portrait-260`: 246 / 246 answer `200 image/jpeg`.
- rokka `par`: 246 / 246 answer `200 image/jpeg`.
- No two members share the same image bytes (no placeholder pictures).
- Maillard: code 2513 gives exactly the old site's URL `https://parlaqui.rokka.io/par/-2513.jpg-.jpg`.
- Members sworn in during 2025 and 2026 have photos too, e.g. Roberta Soldati (18110, 2026-09-28),
  Barbara Portmann (17101, 2026-06-01), Rudi Berli (16109, 2025-12-01), Severin Brüngger (15601,
  2025-09-08).

No exceptions. A member newly sworn in may still lack a photo for a few days. That case has a
`legacyId`, but the import stores `photoCode` as null when the photo URL answers `404`, so a new member
is hidden from the game until their photo exists.

## Fixtures

`test/fixtures/parl/`, real responses of the request above (same `q`, `include`, `sort`) narrowed
with `in(id,...)` to six members and `size=3`, so each language has two pages with real page
metadata:

| id    | Member                      | Why                                             |
| ----- | --------------------------- | ----------------------------------------------- |
| 491   | Pierre-Yves Maillard, SR VD | Known photo code 2513                           |
| 3891  | Daniel Jositsch, SR ZH      | No party (`-`, "parteilos")                     |
| 4265  | Anna Giacometti, NR GR      | Active with a future `leavingDate` (2026-11-29) |
| 10817 | Isabelle Chappuis, NR VD    | Trailing space in `lastName`; `legacyId` = `id` |
| 15601 | Severin Brüngger, SR SH     | Ständerat member sworn in 2025-09-08            |
| 18110 | Roberta Soldati, NR TI      | Most recently sworn in (2026-09-28)             |

Files:

- `persons-{de,fr,it,rm}-page{0,1}.json`: the six members above.
- `federal-councillor-de.json`: Karin Keller-Sutter, fetched by id with
  `activeFederalCouncilMandates` added to `include`. It shows a record the filter excludes.
- `councils-{de,fr,it,rm}.json`: `/api/v1/councils`.
- `cantons-{de,fr,it,rm}.json`: `/api/v1/cantons?size=100`.

In the `rm` files every translated value is `null` (party names, canton abbreviations), as it is
live for all members.

Anything not marked "observed live" above can be checked against these files.
