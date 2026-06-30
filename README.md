<!-- WRITING STYLE: This file must be rewritten through the author's writing-style skill
     (available in Claude Code) before it's considered final. It was drafted in a generic
     voice; it must sound like the author and carry no AI-isms. -->

# rolld

**A board game tracker, native to the [AT Protocol](https://atproto.com).** Log your
plays, rate the games, write up how a session went — all stored as records in **your own
PDS**. Social and aggregate views ("who's played this", "how many times") are read from
the public **[Constellation](https://constellation.microcosm.blue)** backlink index. No
plays database, mostly no server.

🌐 **[rolld.at](https://rolld.at)**

> *"rolld" reads as "roll'd" — rolling dice, the heart of tabletop gaming — and the domain
> `rolld.at` puns on "roll'd at" while ending, fittingly, in atproto's ".at". The mark is a
> pixel die: a thrown die, a literal embodiment of the name.*

---

rolld uses the **"data on your PDS, reads via Constellation, mostly no server"** architecture:

- **Your data is yours.** Each play is a `at.rolld.play` record and each grade a
  `at.rolld.rating` record, written to your repo via browser OAuth.
- **No plays database.** Every play links to a canonical per-game URL; "times played",
  "who played this", and friend filters are answered by querying Constellation for backlinks
  to that URL. There is no AppView indexer to run.
- **Catalog metadata is hydrated, not stored.** Game names, covers, weights, etc. come from
  **BoardGameGeek** at display time through a small cache, keyed by the BGG id — the
  permanent identity key. The metadata source is swappable behind a `resolveGame()` seam.
- **Public & multi-tenant from day one.** Anyone can sign in with their atproto
  (atmosphere) account and track their own games.
- **Social by default.** Plays are public atproto records; optionally share a play or rating
  to Bluesky as a companion post linking back to the entry.

## Architecture at a glance

```
   Static SPA (Cloudflare Pages)
     ├─ log / rate UI + your own dashboard
     ├─ OAuth ── createRecord ──▶ YOUR PDS   (play, rating; each play carries a
     │                                         canonical rolld.at/g/<bggId> target)
     ├─ "my plays / my ratings"      ── read your own repo
     ├─ social/aggregate reads        ── Constellation backlinks to game targets
     ├─ game metadata                 ── Cloudflare Worker (KV cache) ──▶ BGG XML API
     └─ optional share               ── app.bsky.feed.post ──▶ links to the entry permalink
```

The only server-side component is a stateless Cloudflare Worker caching BoardGameGeek
metadata. Core logging, rating, and reads work client-side.

## Lexicons

Under the `at.rolld.*` authority:

| NSID | Key | Purpose |
| --- | --- | --- |
| `at.rolld.play` | `tid` | One record per play session. Carries the canonical game `target` URL Constellation indexes. Optional rich Markdown note + Bluesky companion ref. |
| `at.rolld.rating` | `any` (BGG id) | Your 1–10 grade for a game, overwritable. Same note model as `play`. |
| `at.rolld.defs` | — | Shared `gameRef` (the BGG id reference) and `player`. |

Game metadata is never stored in records — only the BGG id is. See `docs/` for the full
data model and rationale.

## Documentation

The `docs/` folder is the build brief, split into self-contained phases:

- `_index.md` — orientation, core principles, hosting, URL structure (start here)
- `phase-0-data-model.md` — the lexicons
- `phase-1-catalog-hydration.md` — `resolveGame()` + the BGG cache Worker
- `phase-2-write-path.md` — OAuth, writing records, search, sharing
- `phase-3-read-and-display.md` — Constellation reads, the reader UI, social
- `stack.md` — the technical stack (atmot-derived)
- `design-system.md` + `brand-assets.md` — visual identity

## Develop

```
npm install
npm run dev         # atproto OAuth forbids localhost; use the loopback IP
npm test            # vitest
npm run typecheck   # tsc
npm run lint
npm run build       # typecheck + production build into dist/
```

## Deploy (Cloudflare Pages)

The git remote is on [tangled.org](https://tangled.org), so Cloudflare's git-connected
builds aren't available. Deploy with Wrangler direct upload — build locally, push `dist/`:

```
npm run deploy      # build + wrangler pages deploy dist --project-name=rolld --branch=trunk
```

The `--branch=trunk` flag matters: only deployments matching the production branch are
promoted to the live site.

## License

Dual-licensed under **MIT** OR **Apache-2.0**, at your option — mirroring the AT Protocol
ecosystem. See [LICENSE-MIT](./LICENSE-MIT) and [LICENSE-APACHE](./LICENSE-APACHE).

Third-party data, schema, and font attributions (including BoardGameGeek) are in
[NOTICE.md](./NOTICE.md).
