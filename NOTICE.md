<!-- WRITING STYLE: the prose in this file (not the license/attribution text itself, which is
     fixed) should be rewritten through the author's writing-style skill before final. -->

# NOTICE

rolld
Copyright 2026 Jeremy Hervé

This product is licensed under your choice of MIT OR Apache-2.0 (see `LICENSE-MIT`
and `LICENSE-APACHE`). The attributions below are informational and cover third-party
data, schemas, and fonts used by rolld.

## Board game data — BoardGameGeek

Game metadata (names, cover images, year, player counts, playing time, weight, and
community ratings) is retrieved at display time from the **BoardGameGeek XML API2**
and cached. BoardGameGeek is the source and owner of this data; rolld is a client that
fetches and caches it for display. The rolld UI attributes BoardGameGeek wherever this
data is shown, with a link back to the source.

- BoardGameGeek: https://boardgamegeek.com
- API: https://boardgamegeek.com/wiki/page/BGG_XML_API2

Use is limited to on-demand fetch + cache for display, made server-side with a registered
application token (BGG requires registration + an `Authorization: Bearer` token as of late
2025). rolld does not redistribute bulk BGG data. Public-facing display includes the
**"Powered by BGG" logo** linking back to BoardGameGeek, as required. Operators running rolld
at scale should review BGG's API terms.

## Lexicons / content format

- **markpub Markdown lexicon** (`at.markpub.markdown`) — used as a member of the open
  `content` union on play and rating records. See https://markpub.at. MIT-licensed.
- **AT Protocol lexicons** (`com.atproto.*`, including `com.atproto.repo.strongRef`) —
  © Bluesky PBC, MIT/Apache-2.0.

## Fonts

Both fonts are licensed under the **SIL Open Font License 1.1** (OFL). The OFL permits
bundling/embedding/redistributing the fonts with software (including self-hosting the
woff2 files in this SPA); it forbids selling the fonts on their own and forbids using a
font's Reserved Font Name on a modified version. OFL is independent of and compatible
with this project's MIT/Apache-2.0 code license.

- **Overused Grotesk** — body and display type. SIL OFL 1.1.
  Copyright (c) 2023, Bao Nguyen / RandomMaerks (rmforbusiness@gmail.com), with Reserved
  Font Name "Overused Grotesk". https://github.com/RandomMaerks/Overused-Grotesk
  (The designer requests, as a courtesy, a link to the repository where the typeface is
  shown — provided here.)
- **IBM Plex Mono** — interface/data type. SIL OFL 1.1, © IBM Corp.
  https://github.com/IBM/plex

When shipping, include each font's `OFL.txt` alongside the font files (the OFL asks that
the license travel with the Font Software).

## Runtime dependencies

rolld is built on permissively-licensed open-source software including the AT Protocol
SDK (`@atproto/*`, MIT/Apache-2.0), Vite (MIT), and TypeScript (Apache-2.0). Full
dependency licenses are in the dependency tree (`package.json` / `package-lock.json`).

## Network services

- **Constellation** (`constellation.microcosm.blue`) — a community-run AT Protocol
  backlink index queried for social/aggregate reads. rolld depends on the hosted service;
  it does not bundle Constellation's source. See https://constellation.microcosm.blue.

---

> Maintainer TODO before first public release: run a license check over the final
> dependency tree and add any attributions that require it. Include each font's `OFL.txt`
> with the shipped font files.
