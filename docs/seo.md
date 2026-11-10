# Search engines and AI assistants

Three pages per language are meant to be found: the home page (`/de`, `/fr`, `/it`, `/rm`), the list of members (`/{lang}/members`, every member of both councils by canton with their portrait and party, each canton heading with its own anchor such as `#council-N-BE`) and the privacy page (`/{lang}/privacy`). Each one carries a translated title, a description of at most 160 characters (a test checks the home and members ones in every language), a canonical link and `hreflang` alternates, and the home and members pages Open Graph and Twitter tags with `static/images/og.jpg`, its size and alt text. The `x-default` of the home page is `https://parlaqui.ch/`, which picks the language itself; the other pages default to German. The home page also has a schema.org `WebApplication` in JSON-LD and a short visible "What is Parlaqui?" text under the game, which is what a search snippet or an AI assistant can quote. Neither Google nor the AI assistants need special files or markup: crawlable pages with useful text are what counts, and `llms.txt` is a courtesy.

Canonical links, alternates, the sitemap and the share image always name `https://parlaqui.ch` (`src/lib/seo.ts`), so a staging copy never competes with production.

| Path                            | What it does                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/robots.txt`                   | On `parlaqui.ch`: allows everything except `/api/` and `/photo/`, and points to the sitemap. On any other host (staging, local): disallows everything.                                                                                                                                                                               |
| `/sitemap.xml`                  | The home, members and privacy pages in four languages, with their alternates.                                                                                                                                                                                                                                                        |
| `/llms.txt`                     | A plain summary for AI assistants (`static/llms.txt`).                                                                                                                                                                                                                                                                               |
| `/{lang}/game`                  | `x-robots-tag: noindex` from `hooks.server.ts`; the page renders in the browser only and has nothing to index.                                                                                                                                                                                                                       |
| `/`                             | A `302` on the server to the visitor's language (cookie, then `Accept-Language`, then German), so old links and crawlers reach a real page; it sends `Vary: Accept-Language, Cookie` so no cache hands one visitor's language to the next. An old `/#fr` link keeps its hash across the redirect and the language layout follows it. |
| `/index.html`, `/parlament.jpg` | Addresses of the old site: a `301` to `/` and to `/images/og.jpg`, which old shared previews still point at (`hooks.server.ts`).                                                                                                                                                                                                     |
| `/{lang}/s/{token}/story.jpg`   | The score image (1080 × 1920) the end screen offers to share or save, drawn on the server with the text as vector paths (the container has no fonts); `noindex`, and no page of its own.                                                                                                                                             |

## The score image

The score image draws the same Commons photo of the Federal Palace (`src/lib/server/card/bundeshaus.jpg`, greyscale) as a faint watermark and credits it, so it is an adaptation under CC BY-SA 4.0 like the share image below.

## The share image

`static/images/og.jpg` (1200 × 630) is the Commons photo "Nordfassade Bundeshaus - früh morgens" (VOLLTOLL / Manuel Lopez, CC BY-SA 4.0), cropped, with the logo and the credit drawn on it. The image is therefore itself under CC BY-SA 4.0.

## Icons

`static/apple-touch-icon.png` (180 px), `icon-192.png`, `icon-512.png` and `manifest.webmanifest` give phones a proper home-screen icon and name.

## Portraits on the members page

`/portrait/{id}` serves a 112 px square of an active member's portrait from the rokka copy, through our server so the visitor's browser never talks to rokka, cached in memory and for a day in the browser. Unlike a round photo it has a fixed address, since the page shows it next to the name anyway. Round photos keep their random per-round address, crop and re-encoding, which defeats matching by URL or by exact file, not perceptual matching against this page or parlament.ch; with no public leaderboard that only lets a cheater fool the percentile. Every page credits the portraits as "© ParlCH" in the footer, as the [Parliament's photo terms](https://www.parlament.ch/en/services/medialibrary/photo-gallery-terms-use) require.
