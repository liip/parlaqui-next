# Parlaqui

A free photo quiz about the Swiss Federal Assembly, at [parlaqui.ch](https://parlaqui.ch): ten rounds, a portrait of a member of the National Council or the Council of States, six names to choose from. No account, in German, French, Italian and Romansh. Made by Liip.

Built with SvelteKit 2 (Svelte 5), TypeScript, SQLite (better-sqlite3), sharp and opentype.js, served by adapter-node in a Docker image.

## Requirements

- Node.js 22 (see `.nvmrc`) and npm
- An API key for the Swiss Parliament Open Data Web Service, free at https://ws.parl.ch/registration

## Run locally

```sh
cp .env.example .env   # then set the values below
npm install
npm run dev
```

In `.env`, set at least `PARL_API_KEY` and an `IMPORT_TOKEN` of 32 characters or more (`openssl rand -hex 24`). Every variable is explained in `.env.example`. The database is the file `data/parlaqui.db`, created on first start (`DATABASE_PATH` moves it).

Migrations in `migrations/` are applied at startup. The database starts empty, so the game has nobody to show until the roster is imported once:

```sh
curl -s -X POST -H "Authorization: Bearer $IMPORT_TOKEN" http://localhost:5173/api/import
```

It answers `{"status":"published",…}` once the members and their photos are checked; schedule the same call daily in production (`docs/import.md`).

## Test

```sh
npm test          # Vitest; every database test file gets its own in-memory database
npm run lint      # Prettier and ESLint
npm run check     # svelte-check
```

## Build

```sh
npm run build
PORT=3000 node build
```

The `Dockerfile` builds the same and runs it as the `node` user; `docs/operations.md` covers deploying, backups and the readiness check (`scripts/readiness.sh`).

## Docs

- [docs/game.md](docs/game.md): rounds, timing, scoring, flood protection, photos, screen readers
- [docs/import.md](docs/import.md): the daily roster import and its checks
- [docs/parl-api.md](docs/parl-api.md): what the Parliament's web service returns
- [docs/analytics.md](docs/analytics.md): the cookie-free audience counter and `/insights`
- [docs/privacy.md](docs/privacy.md): where the privacy page's promises live in the code
- [docs/seo.md](docs/seo.md): indexed pages, sitemap, previews and share images
- [docs/operations.md](docs/operations.md): deploying, backups, restore, logs, readiness

## License

The code is under the [MIT License](LICENSE). The following are not covered by it:

- **Parliament data and portraits**: the members' data and portraits come from the Swiss Parliament (© ParlCH, Parlamentsdienste der Bundesversammlung, Bern) under the terms of its [Open Data Web Service](https://ws.parl.ch) and [photo gallery](https://www.parlament.ch/en/services/medialibrary/photo-gallery-terms-use). The repository contains no portraits; the app fetches them at runtime.
- **Federal Palace photo**: `static/images/og.jpg`, `static/images/bundeshaus-686.jpg`, `static/images/bundeshaus-1024.jpg` and `src/lib/server/card/bundeshaus.jpg` are adaptations of ["Nordfassade Bundeshaus - früh morgens"](https://commons.wikimedia.org/wiki/File:Nordfassade_Bundeshaus_-_fr%C3%BCh_morgens.jpg) by VOLLTOLL / Manuel Lopez, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and stay under that license.
- **Archivo font**: `src/lib/server/card/archivo-latin-*.woff` (and the copies installed through `@fontsource/archivo`) are © The Archivo Project Authors, under the [SIL Open Font License 1.1](src/lib/server/card/OFL.txt).
- **Names and logos**: "Parlaqui", "Liip" and their logos are not licensed for reuse.

The CI configuration uses Liip's GitLab components and runners, so it only runs on Liip's GitLab as is.
