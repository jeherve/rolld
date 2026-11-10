# rolld

A board game tracker built on the [AT Protocol](https://atproto.com). Log the games you
play, rate them, write up how a session went — all stored as records on your own atproto
account, not in a database someone else keeps. The social reads ("who's played this", "how
many times") come from the public [Constellation](https://constellation.microcosm.blue)
backlink index, so there's no plays database and almost no server to run.

🌐 [rolld.at](https://rolld.at)

> "rolld" reads as "roll'd" — rolling dice, the heart of tabletop gaming — and the domain
> `rolld.at` puns on "roll'd at", ending, fittingly, in atproto's ".at". The mark is a pixel
> die :)

This README is for anyone who wants to run their own copy. If you just want to use rolld,
head to [rolld.at](https://rolld.at) — you don't need any of this.

## The idea

rolld runs on the same idea as my other atproto projects: your data lives on your PDS, the
reads come from Constellation, and there's mostly no server to run.

- Your data is yours. Each play is an `at.rolld.play` record and each grade an
  `at.rolld.rating` record, written to your repo with browser OAuth. If the app you logged
  them in disappeared, your log would still be there, still readable by any other app on the
  network.
- No plays database. Every play carries a canonical per-game URL, and "times played", "who
  played this", and friend filters are answered by querying Constellation for backlinks to
  that URL. There's no AppView indexer to run.
- Game details are hydrated, not stored. Names, covers, and weights come from
  [BoardGameGeek](https://boardgamegeek.com) at display time, through a small cache keyed by
  the BGG id (the one permanent identity key). The source sits behind a `resolveGame()` seam,
  so it's swappable.
- Social when your people arrive. Plays are public records, so friends on the network can
  follow along, and you can optionally share a play or rating as a companion post.

## Architecture at a glance

```
   Static SPA (Cloudflare Pages, vanilla TS + @atcute/* OAuth)
     ├─ log / rate UI + your social dashboard
     ├─ OAuth ── createRecord ──▶ YOUR PDS   (play, rating, profile; each play + rating
     │                                         carries a canonical rolld.at/g/<bggId> target)
     ├─ "my plays / my ratings"   ── read your own repo
     ├─ per-game social/aggregate ── Constellation backlinks to game targets
     ├─ friends-feed              ── Slingshot (identity + records) + Spacedust (live tail)
     ├─ game metadata + search    ── Cloudflare Worker (KV cache + BGG token) ──▶ BGG XML API
     └─ optional share            ── feed post ──▶ links to the entry permalink
```

The main server-side piece is a stateless Cloudflare Worker (`worker/`). It's the sole
gateway to BoardGameGeek — it holds the BGG token as a secret and injects it server-side, so
the browser never calls BGG. It also serves per-user RSS feeds and enforces the moderation
blocklist.

The other one is a small Pages middleware (`functions/`) that fills in the `<head>` of each
page as it's served: [`at:` meta tags](https://tangled.org/chrisshank.com/at-tags/) pointing
back at the record the page renders, so any tool can open it with whatever app it likes, plus
a real title and description instead of the same site-wide one everywhere. Everything else
runs in the browser.

## Lexicons (`at.rolld.*`)

| NSID | Key | Purpose |
| --- | --- | --- |
| `at.rolld.play` | `tid` | One record per play session. Carries the canonical game `target` URL, optional players/photos/Markdown note, and an optional companion post ref. |
| `at.rolld.rating` | BGG id | Your 1–10 grade for a game, overwritable in place. Same note model, same `target`. |
| `at.rolld.profile` | `self` | A one-line declaration that an account uses rolld — what the friends-feed filters on. |
| `at.rolld.defs` | — | Shared `gameRef` (BGG id + name snapshot), `player`, and `image`. |

Game metadata is never stored in a record — only the BGG id and a name snapshot, so a record
stays meaningful even if BoardGameGeek vanishes. The full data model, and the reasoning
behind every odd-looking choice, lives in [DECISIONS.md](./DECISIONS.md).

## Running your own copy

You'll need a couple of things of your own first:

- A BGG application token. BGG requires a registered, server-side token for the XML API
  (register a non-commercial app — it's generally free, but approval can take a week or
  more). This token is yours; it never goes near the browser.
- A Cloudflare account, for the Pages site and the Worker.
- A domain, since atproto OAuth won't accept `localhost` and the OAuth client metadata is
  served at a conventional path on your own domain.

### The SPA

```sh
npm install
npm run dev          # atproto OAuth forbids localhost; dev uses the loopback IP
npm test             # vitest
npm run typecheck    # tsc (app + node scripts + worker)
npm run lint
npm run build        # typecheck + production build into dist/
```

### The BGG cache Worker

The Worker lives in `worker/` and runs separately:

```sh
npm run worker:dev       # wrangler dev (local KV)
npm run worker:deploy    # wrangler deploy

# One-time setup for your own instance:
wrangler kv namespace create BGG_CACHE   # then put the id in worker/wrangler.toml
wrangler secret put BGG_TOKEN            # your own BGG application token
```

Point the SPA at your local Worker with `VITE_API_BASE` while developing.

### The lexicons

The schemas have their own pre-publish gate:

```sh
npm run check:lexicons    # the validator + goat lex parse/lint
```

You only need this if you're publishing the `at.rolld.*` schemas to the network under your
own authority. To run rolld as-is, you don't have to.

### Deploying to Cloudflare Pages

rolld's source is on GitHub, but Cloudflare's git-connected builds aren't wired up. The
deploy builds locally and pushes `dist/` with Wrangler direct upload:

```sh
npm run deploy       # build + wrangler pages deploy --branch=trunk
```

The project name, the output directory and the Function bindings all come from the root
`wrangler.toml`, which Pages treats as the source of truth once it's there — those fields
can't be edited in the dashboard any more. The `--branch` flag still matters: only
deployments matching your project's production branch get promoted to the live site.

The binding in that file is load-bearing. The middleware has to ask the Worker about
moderation and game names, and a Pages Function **cannot** reach a Worker route on its own
zone over `fetch` — same-zone Worker-to-Worker calls need a service binding (Cloudflare error
1042). Without it the calls fail, and since the moderation gate fails closed, entry and game
pages quietly drop back to the generic head.

Wrangler picks up `functions/` from the repo root on its own, so the middleware ships with the
same command. Plain `npm run dev` serves the Vite SPA without it, so the served `<head>` is
the static one and only the client-side half runs. To exercise the middleware for real, build
against a local Worker and point Pages at it:

```sh
VITE_API_BASE=http://127.0.0.1:8787 npm run build
npm run worker:dev                                    # in another terminal, port 8787
npx wrangler pages dev dist --port 12530 \
  --compatibility-date=2026-07-07 \
  --binding API_ORIGIN=http://127.0.0.1:8787
```

Port 12530 because the Worker's CORS allowlist knows it. `API_ORIGIN` points the middleware at
the local Worker; in production the service binding handles that instead. And the compatibility
date has to be one your installed `workerd` supports — the default is today's date, which it
usually isn't yet.

## License

Dual-licensed under MIT OR Apache-2.0, at your option — mirroring the AT Protocol ecosystem,
and because I want the lexicons reused without anyone having to ask. See
[LICENSE-MIT](./LICENSE-MIT) and [LICENSE-APACHE](./LICENSE-APACHE).

Third-party data, schema, and font attributions (including BoardGameGeek) are in
[NOTICE.md](./NOTICE.md).
