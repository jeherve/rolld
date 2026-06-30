# rolld Worker

The only server-side component in rolld (D-3). It is the sole gateway to
BoardGameGeek (D-31): it holds the `BGG_TOKEN` secret, injects the
`Authorization: Bearer` header server-side, and caches results in KV so BGG is
touched only on the first-ever sight of a game across the whole instance. The
browser calls this Worker; it never calls BGG and never sees the token.

## Routes (Phase 1)

| Route | Purpose |
|---|---|
| `GET /api/game/<bggId>` | One game's metadata. Cache-first (`bgg:<id>`, permanent). |
| `GET /api/games?ids=1,2,3` | Batch hydrate (≤20/BGG call) for feeds + grids. |
| `GET /api/search?q=<query>` | Name → candidates. Short-TTL cache (`search:<q>`, 1h). |
| `GET /api/health` | Liveness. |

Phase 3 extends this Worker with the per-user RSS feed (D-42), Constellation
response caching (`cx:<target>`), and the moderation blocklist enforcement (D-41).

## Setup (maintainer)

```sh
# 1. Create the KV namespace and paste its id into wrangler.toml.
wrangler kv namespace create BGG_CACHE

# 2. Set the BGG token secret (never in the repo — D-31).
wrangler secret put BGG_TOKEN --config worker/wrangler.toml

# 3. Enable the production route in wrangler.toml once rolld.at is on Cloudflare.
```

## Dev & deploy

```sh
npm run worker:dev      # wrangler dev (local KV simulation)
npm run worker:deploy   # wrangler deploy
```

In dev, point the SPA at the local Worker with `VITE_API_BASE` (e.g.
`http://127.0.0.1:8787`).

## Tests

The XML parsing, the fetch-with-retry (202/502/503 backoff), and the route handler
(cache-hit-on-second-call, 404, CORS) are all unit-tested against recorded BGG
fixtures in `tests/` — no live BGG calls. The one remaining live check (verifying
the parser against a real `stats=1` payload) is gated on the `BGG_TOKEN` existing.
