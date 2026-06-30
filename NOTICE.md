# NOTICE

rolld
Copyright 2026 Jeremy Hervé

Licensed under your choice of MIT OR Apache-2.0 (see [LICENSE-MIT](./LICENSE-MIT) and
[LICENSE-APACHE](./LICENSE-APACHE)).

rolld is built on a lot of other people's work: a community-run catalog of board game
data, open schemas, two beautiful typefaces, and a handful of services people maintain so
the rest of us don't have to run our own. This file is partly the attribution I owe them,
but it's mostly a thank-you. None of this would exist without them. :)

## BoardGameGeek

The game details you see — names, cover art, year, player counts, playing time, weight, the
community ratings — all come from [BoardGameGeek](https://boardgamegeek.com), fetched at
display time from their [XML API2](https://boardgamegeek.com/wiki/page/BGG_XML_API2) and
cached. BoardGameGeek owns that data; rolld is just a client that fetches it and shows it,
always with a credit and a link back to the source.

The access is on-demand fetch-and-cache for display, made server-side with a registered
application token (BGG has required registration and an `Authorization: Bearer` token since
late 2025). rolld doesn't redistribute BGG data in bulk, and every page that shows BGG data
carries the "Powered by BGG" logo linking home, as their terms ask. If you run your own copy
of rolld at any real scale, read BGG's API terms — they're the ones doing the heavy lifting
here, and they deserve to have their terms respected.

## The AT Protocol ecosystem

rolld is an atproto app, so the whole thing rests on the protocol and the libraries the
community has built around it. Thank you to:

- [Bluesky PBC](https://bsky.app) for the AT Protocol lexicons rolld builds on
  (`com.atproto.*`, including `com.atproto.repo.strongRef`), under MIT/Apache-2.0.
- The [atcute](https://github.com/mary-ext/atcute) family (`@atcute/*`) — the browser OAuth
  and XRPC client rolld is built on, under the 0BSD license.
- [markpub](https://markpub.at) for the `at.markpub.markdown` lexicon, which rolld accepts as
  a member of the open `content` union on play and rating records. MIT-licensed.

### The microcosm services

A big part of what makes rolld possible without a server of my own is
[microcosm](https://microcosm.blue), a set of community-run AT Protocol services. rolld
queries the hosted instances; it doesn't bundle their source.

- [Constellation](https://constellation.microcosm.blue) — the backlink index that answers
  "who's played this" and "how many times" so rolld doesn't need a plays database.
- [Slingshot](https://slingshot.microcosm.blue) — fast record and identity reads.
- [Spacedust](https://spacedust.microcosm.blue) — the live feed tail.

All three are open-source. If you depend on them the way rolld does, consider sponsoring the
people who keep them running.

## Fonts

rolld ships two typefaces, both under the [SIL Open Font License
1.1](https://openfontlicense.org). The OFL lets you bundle, embed, and self-host the woff2
files with the software; it asks that the license text travel alongside the font files (it
does — see `public/fonts/`), and that you not sell the fonts on their own. The OFL is
independent of, and compatible with, rolld's MIT/Apache-2.0 code license.

- Overused Grotesk — the body and display type. Copyright (c) 2023–2025, Bao
  Nguyen / RandomMaerks (rmforbusiness@gmail.com).
  [Repository](https://github.com/RandomMaerks/Overused-Grotesk) (linked here as a courtesy,
  since the designer asks for it).
- IBM Plex Mono — the interface and data type. Copyright © 2017 IBM Corp., with Reserved
  Font Name "Plex". [Repository](https://github.com/IBM/plex).

## Everything else in the dependency tree

I ran a license check across the full production dependency tree, and it's permissive top to
bottom — 0BSD, MIT, and Apache-2.0. Beyond the libraries named above, that includes
[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT) for parsing
BGG's XML, plus the build toolchain: [Vite](https://vitejs.dev) (MIT) and
[TypeScript](https://www.typescriptlang.org) (Apache-2.0). The full set of licenses lives in
the dependency tree itself (`package.json` / `package-lock.json`); nothing in it requires
attribution beyond what's already here.
