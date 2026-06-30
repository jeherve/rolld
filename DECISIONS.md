<!-- WRITING STYLE: this file is human-facing and must be rewritten through the author's
     writing-style skill (available in Claude Code) before final — it should sound like the
     author, no AI-isms. The /about page draws on this file's substance but is a separate,
     general-audience rewrite (also via the style skill). -->
<!-- PRE-LAUNCH: this file SHIPS publicly, but the docs/ tree does NOT (gitignored). Before
     launch, do a pass to (1) soften the tone via the writing-style skill, and (2) remove or
     relocate the references to docs/ (phase briefs, etc.) — a public reader can't open them.
     Where a docs/ reference still earns its place, fold the substance into a file that ships
     (README, /about) instead of pointing at a private path. Tracked as a Phase 5 launch
     checklist item. -->

# rolld — Decisions

> A philosophical guide to rolld: *why* the product is the way it is. Not a spec, not a
> plan, not a changelog — those go stale; this doesn't. It records the judgment calls, the
> roads not taken, and the costs accepted, so that future changes stay in the spirit of the
> product. When something looks odd, check here first: it's usually odd on purpose.
>
> Decisions are grouped by theme and numbered (e.g. **D-3**) so they can be cited from
> commits and issues. New decisions append; superseded ones are struck through with a
> pointer, never deleted (the reasoning trail is the point).

---

## Architecture

### D-1 — No server. Reads come from Constellation, not an AppView.
rolld is a static SPA. Records live on the user's PDS; social/aggregate reads ("who played
this", "how many times", friend filters) are answered by querying the public
**Constellation** backlink index. There is no firehose consumer, no plays database, no
AppView to run. The author's atmot word game proves this pattern works end-to-end.
**Why:** the heavy, always-on, stateful part of a normal AppView (holding the firehose,
indexing everyone's records) is exactly the part Constellation already does for the whole
network. Querying it instead of rebuilding it keeps rolld nearly serverless, cheap, and
portable. **Cost accepted:** see D-2.

### D-2 — We give up global cross-game ranking in v1.
A backlink index answers "who links to *this* target", not "rank all targets by inbound
count". So "most-played games on rolld this month" / trending / discovery across all games
is **not** a Constellation query and is deferred. **Why it's acceptable:** per-game,
per-user, and friend-filtered reads — the ones that matter for a personal tracker — all
work. Global discovery is a network-effect nicety, not core. If wanted later, it needs a
small dedicated aggregator (the one piece of "real backend" rolld might ever add) — a
deliberate, scoped addition, not a reason to run an indexer now.

### D-3 — The only server-side component is a stateless BGG cache Worker.
Game metadata isn't atproto data, so no backlink index can serve it. A single stateless
Cloudflare Worker + KV caches BoardGameGeek lookups. **Why:** it keeps BGG traffic bounded
(by distinct games ever logged, not by users or page views) and polite, and it's the only
thing that *must* live off-client. KV free tier fits; D1 is the fallback if write limits
bind. This mirrors atmot's optional Worker cache — except for rolld it's load-bearing.

### D-4 — Dependency on Constellation is a known, mitigated risk.
Constellation is a single community-run service, AGPL, no relicensing guarantee. rolld only
*queries* the hosted instance (so AGPL doesn't bind rolld). **Why accept it:** the
alternative is running the very infrastructure D-1 exists to avoid. **Mitigations:** cache
Constellation responses in the BGG Worker; know the escape hatches (self-host Constellation,
or the lighter `hydrant` which implements a subset of the same API). Not a v1 blocker.

---

## Data model

### D-5 — Records store only what is yours.
A record holds the plays you logged and the grades you gave — nothing else. Catalog facts
(cover, weight, current rating) and derived figures (times played, last played) are **not**
fields. **Why:** catalog data is identical for everyone and owned by BGG; storing it is a
stale duplicate. Derived data drifts the moment you log or delete. Keeping records to "just
yours" is what makes the model clean and the serverless reads possible. **Refined by D-32:**
the one deliberate exception is a *minimal name snapshot* in `gameRef` (`id` + `name`) —
reframed not as "caching BGG's data" but as "what you called the game when you played it",
which is part of your activity and is what makes the record survive BGG's disappearance. The
line: snapshot the bare human-meaningful label; hydrate everything else (cover, weight, live
rating).

### D-6 — BGG id is the permanent identity key; the metadata *source* is swappable.
Every record references a game by its BoardGameGeek id. That id is the identity everywhere —
in records, in the canonical URL, in the rating record key. What's swappable is *where the
display metadata comes from*, behind a single `resolveGame()` seam. **Why:** these are two
different layers. Identity must be stable system-wide; hydration is an implementation detail.
Conflating them (e.g. keying on a source-specific id that could change) would make a future
source-swap a breaking migration. Separating them makes it a one-module change.

### D-7 — `gameRef` is an object `{ id, name, yearPublished? }`, not a bare string, and has no `catalog`.
**No `catalog` field:** the id is always a BGG id (even a future Wikidata hydration resolves
*by* the BGG id), so a catalog discriminator would be a constant masquerading as a variable.
**Object, not bare string:** changing a field's *type* later is a forbidden breaking change,
but adding optional fields *inside* an object is allowed — so the object shape leaves room to
grow (e.g. an optional `catalog` later) without breaking anything. **Now carries a name
snapshot (D-32):** `id` (permanent identity, for aggregation) + `name` (denormalized snapshot
for durable human meaning) are both **required**; `yearPublished` is optional. Requiring
`name` is itself a frozen constraint (D-8) — fine because `gameRef` is new and nothing is
published yet, and the whole point is that records are self-describing from day one. The
catalog-source-swapping abstraction still lives in `resolveGame()` (hydration layer), not in
the stored id.

### D-8 — Lean schema; constraints are frozen (optional-additions-only).
The namespace is stable (not `.temp.`), so atproto's evolution rules bind: only ever add
*optional* fields; everything else needs a `V2` schema. The design is kept deliberately
minimal to make this commitment cheap. Consequence: anything load-bearing for reads (e.g.
the `target` URL) is **required from day one** (D-9), because adding a required field later
would break existing records.

### D-9 — Every play (and rating) carries a frozen canonical `target` URL.
Each play stores `https://rolld.at/g/<bggId>` literally. Constellation indexes it;
backlinks to it *are* the play aggregation. The format is frozen (Constellation matches it
literally) and emitted from one shared helper used by both write and read paths, so they
can never diverge. It's partly redundant with `game` (both encode the BGG id), but it's the
literal string the index needs, so it's stored explicitly. (Same idea as atmot's
`puzzleTarget`.) **Extended (D-39):** `rating` carries the **same** `target` too, so ratings
are Constellation-discoverable by game (community-rating + follows'-reviews layers). This
isn't a reversal — `target` now appears on both *game-anchored* record types for the same
reason; it was free to add because nothing is published yet (D-8 not yet binding). The
targeted "did this specific person rate it" lookup uses `getRecord` by rkey (= BGG id)
instead; `target` powers the open-ended "who rated/played this" queries.

### D-10 — Ownership/collection record was cut; v1 logs plays and ratings only.
An `ownership`/collection record was designed and then removed. **Why:** rolld is a
play-and-rate logger, not a collection manager. Cutting it keeps v1 focused. It was modeled
as an independent state record specifically so it can return later as a pure, non-breaking
addition if a "my collection" view is ever wanted — but it's not the product's job now.
(Note: the record *types* are `play`, `rating`, and the lightweight `profile` declaration
added later in D-25 — "no ownership" is the point here, not a literal record count.)

### D-11 — Notes use the standard.site model, not an invented one.
Both `play` and `rating` carry an optional rich note: `content` (an open union accepting
`at.markpub.markdown`), `textContent` (plain fallback), and `bskyPostRef` (optional Bluesky
companion). **Why:** this is exactly how standard.site handles longform content, and reusing
an established pattern means interoperability and no novel design risk. Open union so the
format can grow without a breaking change. The note is genuinely the user's data (unlike
catalog/derived data), so it belongs in the record. Replaced an earlier plain `comment`/
`review` string so both records share one note shape and the reader needs one renderer.

### D-33 — Play photos are embedded blobs in the play record, not separate records.
A play can carry up to **4 photos** (`play.images`, matching Bluesky's per-post limit). Each
is an atproto **blob** uploaded once to the user's PDS (`uploadBlob` → blob ref) and embedded
by ref. **Why embedded, not a separate `photo` record:** a photo of a play has no meaning
independent of that play, so a separate record would only add a sync/orphan problem, a
duplicate `gameRef`+`target`, and a second thing to write/moderate — for no benefit. The
per-game **photo gallery** works through the query we already have: plays backlinking to the
game target (D-9), filtered to those with images. No parallel photo index needed. **The same
blob ref is reused three ways from one upload:** the `play` record, the companion
`app.bsky.feed.post` (via `app.bsky.embed.images`, for a richer Bluesky card), and the
per-game gallery (via the play query) — no byte duplication. **Decentralization fit (D-32):**
the blob lives in the user's own PDS, embedded in their own record — the photo is theirs and
travels with their data. **Costs accepted:** blobs are the heaviest thing in a PDS (it's the
user's storage, not ours); `alt` text is required (accessibility + Bluesky expects it);
client must resize/compress to ≤1MB before upload. A standalone "my board game photos"
collection (photos unattached to plays) is a *different* feature and a clean later addition if
ever wanted — not this.

### D-34 — Form typeaheads: games via the Worker (debounced), people via the public Bluesky API (direct). Deliberately asymmetric.
Both the game field and the player field offer typeahead suggestions, but through different
paths — and that asymmetry is intentional, not an inconsistency to "fix". **Games:** typeahead
queries go through the **rolld Worker** (`/api/search`), never the browser→BGG, because the BGG
token must stay server-side and BGG is rate-limited (D-31). So game typeahead is gentle —
~300–400ms debounce, min 3 chars, short-TTL query cache, "type-pause-pick". **People:**
typeahead uses Bluesky's **`app.bsky.actor.searchActorsTypeahead`** on `public.api.bsky.app`
directly — unauthenticated, keyless, generous — so it can feel near-instant (~150–200ms
debounce). This reuses the author's **skypress @-mention pattern** (resolve via the public
Bluesky AppView, store the resolved DID). **Why asymmetric:** the two data sources have
opposite constraints (BGG = tokened + rate-limited + proxied; Bluesky actor search = open +
fast), so forcing them into the same interaction model would either throttle people-search
needlessly or over-hammer BGG. Note also the two *identity* tools: `searchActorsTypeahead`
(fuzzy find) vs Slingshot `resolveMiniDoc` (verify a known handle, D-14) — different jobs.

---

## Identity & URLs

### D-12 — One frozen URL (`/g/<bggId>`); everything else is mutable app routing.
Only the per-game target is frozen (D-9). All other routes — profiles, play logs, per-entry
permalinks — can be reshaped freely; they aren't indexed by anything and aren't stored in
records. **Why:** freezing only what *must* be frozen keeps the app's URL space flexible
while protecting the one string the read model depends on.

### D-13 — No `/bgg/` segment in URLs.
The game URL is `/g/<bggId>`, not `/g/bgg/<bggId>`. **Why:** consistent with D-6/D-7 — game
identity is permanently BGG-keyed across the whole system, so the URL shouldn't pretend the
catalog is a variable. (The record body keeps a `gameRef` *object* for evolvability; the
public frozen URL stays lean. This asymmetry is deliberate — don't "reconcile" them.)

### D-14 — Shared links use the handle; resolution goes through the DID.
Per-entry permalinks shared on Bluesky use the handle form (`/@<handle>/play/<rkey>`) because
it's legible. But the handle is cosmetic: it's resolved to a DID, and if the user changed
handles the page redirects to the current one — so old shared links survive. A `/did/<did>/…`
fallback form never rots and is the durable canonical. **Why:** legibility for the common
case, durability for the edge case. **Cost accepted:** a fully-abandoned handle can't
resolve — inherent to handle URLs (Bluesky's own post URLs share this), and the DID form is
the answer for anyone who needs a permanent link.

---

## Social

### D-15 — Social by default; confirmed multiplayer deferred.
Because plays are public atproto records indexed by Constellation, "who played this", feeds,
likes/replies all work for free (Level 1). Tagging co-players by DID is supported (the
`player.did` field), which enables "plays where you were tagged" via backlinks. **But**
confirmed multiplayer — the tagged player corroborating "yes, I played" — is deferred.
**Why:** a play asserts something about other people from the logger's PDS, and there's no
bidirectional-confirmation primitive yet (same consent gap as standard.site `contributors`).
Ship the easy part; defer the gnarly part. A confirmation record would be a new optional
record type, non-breaking to add.

### D-16 — Sharing to Bluesky is opt-in, auto-drafted, user-editable.
On share, rolld auto-generates a ≤300-grapheme `app.bsky.feed.post` linking to the entry
permalink, shown in a modal the user can edit before posting; then it stores the post's
strongRef in `bskyPostRef`. **Why:** POSSE — one canonical entry on your PDS, optionally
syndicated to the social graph. Auto-draft for convenience, modal for control, opt-in
because not every play wants broadcasting. Storing the ref also enables Bluesky-replies-as-
discussion later (the Leaflet pattern).

---

## Catalog source

### D-17 — BGG-only for v1; Wikidata deferred behind the resolver seam.
Despite a preference for open data, v1 hydrates from BoardGameGeek only. **Why:** BGG is the
de-facto complete catalog and the universal id everyone maps to; Wikidata's coverage is
partial and its findability weak. The open-source instinct is honored not by using Wikidata
now, but by keeping the source swappable (D-6) — the abstraction *is* the hedge. Wikidata (or
a community lexicon) can drop in later by measuring coverage and writing one resolver, with
no record or URL change. **Cost accepted:** a soft dependency on a single commercial source,
mitigated by permanent caching, attribution, and the swappable seam.

### D-18 — Attribute BGG; cache, don't redistribute.
The UI credits BoardGameGeek wherever its data appears, and the cache is on-demand fetch +
store for display, not bulk redistribution. **Why:** it's the difference between a tolerated
client and a perceived competitor, and it keeps within normal-use expectations. Operators
running rolld at scale should review BGG's API terms (noted in NOTICE.md). **Update (see
D-31):** attribution must be the **"Powered by BGG" logo** (not just text), linking back —
BGG requires this for public-facing apps.

### D-31 — BGG requires registration + a server-side auth token; the Worker is the sole gateway.
As of BGG's 2025-07-02 policy (enforced ~Oct 2025), **every XML API request needs an
`Authorization: Bearer <token>`**. rolld registers a **non-commercial** application
(generally free; *register early — approval can take a week+*), stores the token as a
**Cloudflare Worker secret**, and routes BOTH metadata and search through the Worker. **The
browser never calls BGG and never sees the token.** **Why this way:** BGG explicitly mandates
server-side, cached requests (client-side traffic is "grounds for license suspension") and
warns a client-exposed token can be captured and revoked — so the Worker we already had for
caching becomes non-optional as the token holder too. **Costs/risks accepted:** a hard
dependency on a registered, revocable license (revocable if BGG judges rolld to compete with
or harm them); the maintainer must obtain/rotate the token; monetizing in any form flips the
license to commercial. **Confirmed specifics:** bare domain `boardgamegeek.com` (no `www`);
header is "Bearer"+space+token, no colon; ~5s between requests (500/503 if too fast); max 20
ids per `thing` call; "Powered by BGG" logo required. Full details in Phase 1.

---

## Build & project

### D-19 — Vanilla TypeScript, no framework — plus two tiny helpers.
The UI is list-rendering, forms, a couple of modals, and fetch-then-render pages — none of
which needs React. Two dependency-free helpers cover the gaps: an auto-escaping `html`
tagged-template (also the XSS defense for non-Markdown user content) and a minimal history
router. **Why:** atmot proves a full interactive app in vanilla; a tiny bundle suits a
Cloudflare Pages SPA. **Reversal trigger:** if a view ever grows many independent,
frequently-updating widgets (live stats, inline editing, pervasive optimistic UI), a *light*
framework (Preact/Solid, not full React) drops in incrementally — not a rewrite. Not there
now, maybe never.

### D-20 — Rendered Markdown notes must be sanitized.
Notes are user-authored, so the HTML rendered from `content` MUST be sanitized before
injection (well-tested sanitizer, or a renderer that escapes by default). **Why:** it's the
one place vanilla puts XSS responsibility squarely on us — no framework default escaping to
lean on. Non-optional.

### D-21 — Dual-licensed MIT OR Apache-2.0.
Mirrors the atproto ecosystem and the author's atmot. **Why:** the whole dependency tree is
permissive, so nothing forces copyleft, and rolld *wants* permissionless reuse of its lexicons
by other AppViews — copyleft would work against that. (Contrast Aodig, where GPLv2 fit a
self-hosted-app ethos; that reasoning points the other way for a serverless SPA whose main
artifact is meant to spread.) Apache adds a patent grant; MIT is maximally simple; offering
both lets adopters choose. Fonts are SIL OFL 1.1, independent of and compatible with the code
license.

### D-22 — Visual identity inherits the family system; owns the rose accent.
rolld reuses the author's existing design system (warm-dark palette, 8-bit pixel chrome,
Overused Grotesk + IBM Plex Mono) and changes one thing: the accent, from the family gold to
a granite-rose (`#E58AA0`, from the Breton *côte de granit rose*), with a sea-green secondary.
The mark is a pixel die — the name reads as "roll'd" (rolling dice; the domain `rolld.at`
puns on "roll'd at"). **Why:** reusing the system gives instant
family coherence and a finished identity at near-zero cost; the single accent swap gives rolld
its own identity so it doesn't read as the author's personal page wrapped around someone
else's collection — important for a public, multi-tenant product.

### D-35 — Mobile-first, with the log-a-play flow as the priority mobile surface.
Every page and component is designed **mobile-first** — the narrow (phone) layout is designed
first and desktop is the enhancement, not the reverse. **Why:** people log plays on their
phone, at the table, right after a game ends — that's the primary creation moment, so the
phone is the primary target, not an afterthought. Consequences that bind the build: the
**log-a-play flow is the make-or-break mobile surface** (the quick-add minimum path must be a
couple of taps + a search; details stay tucked in the expansion, D-: quick-add); primary CTAs
and form controls sit in **thumb reach** (bottom of screen), and forms must behave when the
on-screen keyboard covers half the viewport; typeaheads matter more on mobile (typing is
costlier). Browsing/reading pages are comfortable on mobile by default, but each must still
have a deliberate single-column story (bottom sheets/drawers for the log flow), not a
desktop layout left to reflow.

### D-36 — The UI has personality: fun in the chrome, never in the way of the task.
rolld is about playing games together, and the interface should feel like that. A small,
consistent system of **on-theme motifs** decorates the edges and waits: **loading** = thrown/
tumbling dice (the brand mark in motion); **empty states** = an empty game box / an unscored
scorepad / a table waiting for players (this also serves the D-27 onboarding-empty-feed
moment); **errors** = a game box with missing pieces / a rules dispute / a lost meeple (one
visual family); **success** = a small satisfying beat when a play is logged (a die settling).
Microcopy personality is governed by the writing-style skill (D-30) — playful words +
playful visuals reinforce each other. **The discipline (why this won't become noise):** fun
lives in the **chrome** (loading, empty, error, transitions, the logo), **never in the way of
the work** — the log form stays fast and uncluttered; no one fights a cute animation to
record a score. **Accessibility is non-negotiable:** honor `prefers-reduced-motion` with calm
fallbacks, keep animations light (mobile performance), and never let motion block input. Fun
that gets in the way isn't fun.

### D-38 — Stats are personal/per-profile and computed client-side; global stays per-game only.
People like stats, and rolld surfaces them — but scoped to what's cheap under the no-server
model (D-1). **In v1:** (a) **personal stats** woven into existing pages (no dedicated stats
page) — "most played", "top rated", "played most this year" — computed **client-side from the
user's own records** (free; no new reads); (b) a **top-played games grid** on profile pages,
yours and others', riding on the records the profile already fetches (D-28); (c) **two
separate shelves**, "Top rated" (from `rating` records) and "Most played" (from `play`
counts) — NOT a fuzzy blended "favourites", because the two answer different questions and the
split is clearer. Time-windowed stats ("this year") filter by `playedAt` (which is why it's
separate from `createdAt`, Phase 0). **The hard line (why):** "most-played games *across all
of rolld*", trending, cross-user rankings are **cross-game aggregation**, which Constellation
can't do (it's per-target, D-2) — a true ranking needs a firehose consumer + DB, i.e. the
always-on **backend D-1 exists to avoid**. So the only "global" stat in v1 is **per-game
counts** ("X plays of this game across rolld"), which is a single backlink query we already run
on the game page — free, no new infra. Curated "popular games" shelves and real
batch/live rankings are deferred; if rolld ever grows to need them, the aggregator is added
*then* as a conscious "we now run infrastructure" decision, not something that sneaks in
because stats felt cheap. **Cost accepted:** no community/trending view in v1; that's the
price of staying serverless, and it's revisitable later without rework.

### D-39 — The game page answers "should I care?" with social reviews, not video curation.
The most valuable thing a game page can add is "what do people I trust think of this game?" —
and the authentic-vs-ad judgment that sends people to YouTube is exactly what an API can't
give. So rolld answers it with **the one thing rolld uniquely has: your social graph's actual
opinions**, layered:
1. **Your follows' takes first** — ratings + written reviews of this game from people you
   follow who use rolld. Buildable *now* and cheap: Constellation backlinks to the game target,
   filtered by your followed DIDs (the `did=` filter is native, and filtering one game's
   backlinks is cheaper than the dashboard's cross-game assembly, D-26). This IS the
   "trusted reviewer" feature — authentic by construction, because *you* chose who to trust by
   following them. No editorial list, no curation algorithm, no new dependency.
   **Two mechanisms, each matched to its query (this drove adding `target` to `rating`):** the
   open-ended "who rated/played this game" and the community average use `target` +
   Constellation (so `rating` gained a `target`, D-9); the precise "did *this specific* follow
   rate it" uses `getRecord(followDid, rating, <bggId>)` — the rkey IS the BGG id, so the
   record's address is known and no index is needed. Each query uses the only tool that does
   it cheaply.
2. **The wider rolld community next** — total plays, distinct players, community average across
   all of rolld (already in scope, D-38 per-game counts).
3. **An honest external link-out** — a plain "search this game on YouTube / view on BGG" link
   (pre-filled URLs; zero API, zero key, zero cost). NOT curation — an honest jumping-off
   point for outside opinions, with no "we picked the good ones" pretense.

**Why not video curation (the deferred part, honestly):** "trusted *video* reviewers via who
you follow" is conceptually right and architecturally ready — the same social-graph filter
would surface video reviews from people you follow — BUT it requires game-review *records* to
exist in the atmosphere, and today reviewers post on YouTube, not as atproto records. There's
no lexicon and zero supply; rolld can't read what doesn't exist, and bootstrapping that supply
is a separate product bet. **Deferred until the ecosystem produces review records** — at which
point the game page surfaces "video reviews from people you follow" with the exact pattern
already built (only the supply is missing, not the mechanism). Also rejected: YouTube Data API
+ an editorial trusted-creator list (a new tokened Worker integration AND the unsolved
authenticity problem AND drift away from rolld's "your data, social, serverless" center —
worst effort-to-fit ratio). **Why this is right:** it plays to what rolld uniquely owns rather
than trying to out-YouTube YouTube, and it's nearly free.

### D-40 — Cold-start strategy: kill the empty network, make solo worth it, ride the Bluesky share.
The project's biggest risk is back-loaded value (rolld shines only after login + games +
friends present). Five moves address it, none of which fight the principles (full reasoning in
`docs/cold-start-and-engagement.md`):
1. **"Friends already on rolld" at onboarding** — scan the new user's Bluesky follows for those
   with a rolld `profile` record (D-25) and show "N people you follow are here" + an immediately
   populated feed. Turns the empty feed (D-27) into instant social proof. Reuses the D-26
   follows-with-declaration query, run proactively. *Highest-impact move.*
2. **The Bluesky companion post is the distribution engine** — make the share genuinely good
   (the photo attach, D-33, matters) and make the logged-out landing page (entry/game pages)
   convert with a soft "track your own games" prompt. Organic reach on the network rolld is
   built on; a board-gamer's followers skew board-gamer.
3. **Position as a solo journal first** — sell "a beautiful log of every game you've played"
   (a complete solo value prop), let social emerge; never gate core value (logging, stats,
   history) behind a social precondition. Fits D-32.
4. **Likes deferred** — lean on the companion post's Bluesky likes/replies rather than commit
   a `like` lexicon before seeing real interaction. A native `at.rolld.like` stays
   a clean later addition. (Defer the uncertain primitive, ship what's free — standard.site
   discipline.)
5. **Comments without building comments** — an entry's comments = its companion post's Bluesky
   reply thread (via the stored `bskyPostRef`, D-16), shown read-only. No new lexicon, no
   moderation/storage/tombstone burden (it's Bluesky's thread). Limitation: only shared
   entries have comments. The Leaflet pattern.

**Explicitly rejected** (off-principle): streaks/engagement pressure (coercive; the
celebratory "year in review" is fine, the "don't break your streak" is not), push
notifications (no server; the companion post is the notification channel), global
leaderboards/trending (the deferred ranking backend, D-2/D-38), native comments + a like
lexicon in v1, and bulk BGG history import (a whole integration, and history isn't social).
**Cost accepted:** the social loop still depends on *some* friends arriving — moves 1–3 shorten
that gap but can't eliminate it; that's inherent to a social product and the honest answer is
to make solo genuinely good while the network fills in.

### D-41 — Moderation is AppView-display filtering via a private KV blocklist; reports by email; no Ozone.
Hosting public user images (D-33) creates real safety/abuse obligations. The approach fits the
no-server model (full detail in `docs/moderation-and-safety.md`):
- **Core constraint:** rolld can't delete others' records (they live on users' PDSes, D-32).
  "Takedown" = rolld **stops displaying** content, not deleting it — the standard AppView model.
  rolld curates its own surface, it's not the network's police.
- **Reports:** a **Report link → `abuse@rolld.at`** email (pre-filled with the item's
  at-uri/URL) on every play/rating/photo/profile. No moderation backend. atproto's native
  report flow routes to a *labeler* (which we don't run), so it's unused in v1.
- **Takedown = a private KV blocklist the Worker enforces.** The one piece of private,
  mutable, server-side moderation state: a single **Cloudflare KV entry** (DIDs + record
  URIs), **server-side only, never shipped to the browser** (so it stays private), edited via
  `wrangler kv key put` (no deploy). Enforcement is in the **Worker**: it refuses to serve
  blocked blobs (images already route through it — strongest point) and strips blocked
  DIDs/URIs from render data before the browser sees it. **Consequence:** the Worker becomes a
  render-path moderation participant, not just BGG cache + token holder — a small, conscious
  addition (doesn't break serverless: stateless code, KV holds the tiny state).
- **No Ozone in v1.** Ozone is a full Postgres-backed labeler service for a moderation *team*
  and *multi-AppView* label sharing — overkill for a single AppView filtering its own display.
  Documented as the future path if rolld ever needs a real moderation operation.
- **CSAM exception:** "stop displaying" is insufficient — the Worker must stop serving the
  blob immediately (blocklist + cache purge) AND the maintainer has legal reporting duties
  (France: Pharos; NCMEC for US nexus). Zero tolerance, stated in the policy pages.
- **Policy pages:** Community Guidelines + Terms + Privacy (drafts in `docs/policy-*.md`),
  rendered at `/community-guidelines`, `/terms`, `/privacy`, linked from the footer. **Drafts
  are not legal advice** — Terms/Privacy need real legal review (GDPR applies, maintainer in
  France) and the writing-style pass (D-30) before launch.
- **Honest caveat:** this is reactive, single-moderator, best-effort moderation — right for
  v1, but hosting user images publicly is the project's biggest ongoing responsibility. Scale
  → revisit Ozone/shared labelers/more moderators.

---

## Social dashboard & the microcosm tools

### D-23 — Lean on three microcosm services, not one.
Beyond Constellation (D-1), rolld uses **Slingshot** (edge record + verified-identity cache)
and **Spacedust** (live links firehose). **Why:** they're purpose-built for exactly the
reads a social app needs, removing the need to run our own indexer/cache while keeping rolld
serverless. **Cost accepted (deepens D-4):** more of the product rests on community-run
infrastructure. Mitigated because all three are open-source (MIT/Apache) and self-hostable;
Slingshot speaks *standard* `com.atproto` APIs so its fallback is hitting PDSes directly; the
feed degrades gracefully; and the maintainer intends to sponsor microcosm. A conscious,
comfortable trade given the tools are made for this.

### D-24 — The signed-in home is a social-first dashboard; signed-out is a landing page.
`/` shows a marketing/landing page to signed-out visitors and **redirects signed-in users to
`/dashboard`**. The dashboard leads with a **feed of what the people you follow recently
played**, with the user's **own plays woven into the same feed**, and a prominent primary CTA
to **log a new play**. **Why:** the logged-in product should feel social first, not like a
solo spreadsheet. (Supersedes the earlier idea of `/` being a global recent-activity feed —
a true global feed isn't a cheap query under D-2; a follows-scoped feed is. See D-26.)

### D-25 — A `profile` record declares rolld participation.
A single per-user record (`at.rolld.profile`, key `self`) whose **presence** means
"this account uses rolld". **Why:** it lets the friends-feed cheaply find *which* of a user's
follows to fetch (check for this record across follows, then read plays only for those who
have it) instead of probing every follow's repo blindly. Its **deletion** is a clean opt-out.
It also anchors a rolld profile and can hold light display prefs (authoritative bio/avatar
still come from `app.bsky.actor.profile`). Mirrors atmot's `stats` record doing double duty.

### D-26 — The friends-feed: Slingshot history + Spacedust live, capped, declaration-filtered.
Construction: (1) read the user's Bluesky follows (`app.bsky.graph.follow`); (2) filter to
those with a rolld `profile` record (D-25); (3) for each, list recent `play` records and
hydrate — Slingshot accelerates the identity resolution (`resolveMiniDoc` → DID + PDS) and
per-record fetches, though enumerating a user's plays still uses `listRecords` against the
PDS the MiniDoc resolved (Slingshot has no list endpoint); merge with the user's own; (4)
optionally subscribe to Spacedust to prepend new plays live while the dashboard is open.
**Cap** the number of follows fetched (paginate the rest) to bound cost. **Why this shape:**
it's the buildable, serverless version of a social feed — Constellation can't do "recent
across users" (D-2), but Slingshot makes identity + per-record reads cheap/resilient and
Spacedust adds the live tail. **Costs accepted:** still O(follows) to assemble (mitigated by
the cap + declaration filter + Slingshot speed); Spacedust v0 has no replay/deletes, so it's
strictly the live tail (use `instant=off` for its 21s undo buffer), never the history. Exact
endpoints in `microcosm-apis.md`.

### D-27 — Empty feed is the onboarding surface.
Because the user's own plays are always in the feed merge, a new user with no
rolld-playing follows sees their own activity; if that's empty too, the feed becomes the
first-run invitation ("log your first play, share it to get started"). **Why:** no separate
empty-state screen to design, and the emptiest case naturally points at the primary action.

### D-28 — Public profile pages reuse the Bluesky bio.
`/@<handle>` is a public, linkable page that pulls the person's display name / avatar /
description / banner from `app.bsky.actor.profile` (the bio chrome) and lists their rolld
`play`/`rating` records instead of posts. No auth required (all public data); reads go
through Slingshot for speed + verified identity. **Why:** a familiar bio-page shape people
can link from anywhere, with zero new profile-data to store — it's just a different lens on
existing atproto profile data plus rolld records.

### D-29 — Footer ports the family signature; About is the public philosophy page.
The footer reuses the existing footer from the author's other projects (atmot, skypress) —
the **same two SVGs verbatim** (the author's pixel face → the author; the Tangled mark → the
rolld repo) — plus an **About** link. Those SVGs are *family* assets and are NOT restyled into
rolld's rose theme. `/about` is a static page explaining rolld's inner workings and philosophy
— the public, general-audience counterpart to this DECISIONS file (drawn from its substance,
rewritten for visitors). **Why:** the footer is the cross-project "made by / hosted on"
signature and belongs on every page; the About page gives a curious visitor the "your data,
no server, how it works" story without reading a decision log.

### D-30 — All human-facing text goes through the author's writing-style skill.
Every word that ships publicly or represents the project — UI copy (buttons, labels, empty
states, errors), the landing page, `/about`, and the repo's `README` / `NOTICE` / `DECISIONS`
— MUST be rewritten through the author's writing-style skill (available in Claude Code) so it
sounds like the author and carries no AI-isms. Internal phase docs are agent scaffolding and
exempt. **Why:** a public, personal-brand product should read in the author's voice, not a
generic AI register; this is a hard requirement, not a nicety. The drafts produced during
planning are explicitly in a placeholder voice awaiting this pass.

---

## Decentralization (the philosophical core)

### D-32 — Three layers: shared identity, swappable metadata, owned activity. Records are self-describing.
The recurring worry — "rolld isn't really decentralized: plays are meaningless without my
AppView, and ultimately without BGG" — rests on a false dilemma (a game must be either a
per-user record → duplicates, or one central record → centralized). The resolution, which is
how Popfeed and similar atproto media trackers work: **there is no "game" record at all.**
There are only *play* and *rating* records, separated into three layers:

1. **Shared identity (vocabulary).** Everyone references a game by its BGG id. Agreeing on an
   *identifier* is not server-dependence — it's a name, like an ISBN or DOI. A shared
   namespace is not "centralization" in the meaningful sense; it's the coordination point that
   lets different people's plays aggregate at all. The id keeps working even if BGG vanishes.
2. **Swappable metadata (garnish).** Name/cover/weight/live-rating are *display enrichment*,
   owned by BGG, hydrated at read time via `resolveGame()` — never the source of truth about
   anything in rolld. The source is swappable (Wikidata, a community catalog) with no record or
   URL change. BGG's centralization sits entirely in this layer, which is garnish, not truth.
3. **Owned activity (truth).** Your plays and ratings — the only "source of truth" that
   matters — live signed on your PDS, portable, readable by any AppView. Fully decentralized.
   This is the layer atproto actually cares about owning, and rolld gets it right.

**The AppView is a lens, not a source of truth (restates D-1).** If rolld disappears, every
record still exists on every user's PDS and still means what it meant; another AppView can
render it. "My app is needed for the nice view" ≠ "my app is needed for the data to exist or
have meaning" — the meaning is in the record; the view is a service. Bluesky is "central" in
exactly this same, harmless sense.

**The test of decentralization** is not "zero external dependencies" but **"can any external
party take your data or make it meaningless?"** For rolld: no. Which is *why* records carry a
denormalized name snapshot in `gameRef` (D-5, D-7): the `id` survives BGG as an aggregation
key, and the `name` survives BGG as human meaning, so a play record is **fully self-describing
and durable on its own** — BGG and rolld both become optional enrichment, not load-bearing for
meaning. That snapshot is the concrete thing that turns "BGG-dependent" into "BGG-enriched".

**Cost accepted:** a denormalized name can go stale (a game renamed on BGG); that's fine — the
snapshot is deliberately "what you called it when you logged it", and live hydration shows the
current name where freshness matters. This is the one sanctioned denormalization; do not let
it creep into caching cover/weight/derived counts in records (those stay hydrated, per D-5).

---

## Ecosystem

### D-37 — Publish the lexicon at v1 launch, under `@rolld.at`, once the schema is proven.
The `at.rolld.*` schemas get **published to the AT Protocol network** (as
`com.atproto.lexicon.schema` records, authority proven via `_lexicon` DNS TXT records) so
other apps can discover, resolve, and validate against them. **When:** at **v1 launch** — a
real resolvable standard from day one — but only *after* Phases 1–4 have exercised the schema
in the live app, because publishing is a **commitment**: once published and once others write
records against it, the frozen-constraints rule (D-8) binds hard (breaking changes require a
new NSID). So the shape must be proven in real use before the launch publish. **Where:** under
the **`@rolld.at`** account/PDS — domain, handle, NSID authority (`at.rolld.*`), and DNS proof
(`_lexicon.rolld.at`) all align on `rolld.at`. **Why:** publishing is the act that makes
the decentralization story (D-32, D-1) *true* rather than aspirational — it turns a private
JSON convention into a public standard others can build on without permission. Tooling:
`goat lex` (publishes + lints + verifies evolution rules). Full mechanism in
`docs/phase-5-publish-lexicon.md`. **Cost accepted:** publishing locks the schema under the
evolution rules — deliberately, and deliberately timed to when the shape is settled.

### D-42 — A per-user outbound RSS feed of plays/ratings, served by the Worker.
rolld exposes a per-user activity feed as RSS at `rolld.at/@<handle>/feed.xml` (a
`/did/<did>/feed.xml` fallback per D-14) — a chronological serialization of that user's plays
and ratings. **Why it matters (ethos, not features):** this is a fourth open lens on data the
user already owns, alongside the rendered page, the atproto records, and the Bluesky companion
post — squarely in the "your activity, many surfaces, no lock-in" spirit (D-32) and the
open-web/indieweb values the maintainer builds for. It lets people follow someone's plays
without an atproto account or a rolld login, and extends the cold-start funnel (D-40) to the
RSS-reader crowd, who skew toward exactly rolld's audience. It costs almost nothing: the data
is already read and rendered; RSS is just another serialization of the same records.
**Implementation note (the one real architectural point):** RSS needs a server response —
a static SPA can't serve `feed.xml`. So the **Worker generates it** (does the per-user
read via Slingshot/PDS + Constellation, serializes to RSS XML, caches the result in KV with a
short TTL since readers poll regularly). This is a modest, conscious expansion of the Worker's
role (BGG cache + token + moderation filter → + feed generation), consistent with how other
server-side concerns already live there. **Scope (deliberately narrow):** per-user only in v1.
Per-game feeds and filtered (per-user-per-game) feeds were considered and **left out** — the
audience for them is thin and the per-user feed is the one that earns its keep. **Not inbound:**
rolld consumes no external RSS — pulling feeds *in* is a content-reader concern that belongs to
Aodig, not a play-logger; keeping it out preserves rolld's scope discipline.

### D-43 — Repo layout: docs in `docs/`, schemas in `lexicons/at/rolld/`.
The planning set arrived as a flat dump at the repo root, but the docs themselves point at a
`docs/` tree (CLAUDE.md says `docs/_index.md`, `docs/phase-*.md`) and a `lexicons/at/rolld/`
tree (Phase 0 cites `lexicons/at/rolld/*.json`). So the scaffold moves them into the homes the
docs already assume: the phase briefs and supporting docs into `docs/`, the four schema JSONs
into `lexicons/at/rolld/`, and keeps `README`, `NOTICE`, `DECISIONS`, `CLAUDE`, and `KICKOFF`
at the root. **Why:** the layout should match its own paper trail, and `stack.md`'s repository
conventions (`lexicons/`, `public/`, `src/`, `scripts/`) want the same shape as atmot. **Cost:**
a few cross-references inside the planning docs still mix `docs/`-prefixed and bare filenames;
those are agent scaffolding, exempt from the style pass, and not worth a rewrite now.

### D-44 — The two helpers' contract: `SafeHtml` strings + a pure matcher + event delegation.
D-19 settled on two in-house helpers but left their shape open; this fixes it. The `html`
tagged-template returns a `SafeHtml` value (a wrapped string), escaping every interpolation by
default; nested `html` results and an explicit `raw()` (for sanitized Markdown, D-20) pass
through unescaped; `render(el, …)` writes it with `innerHTML`. The router splits in two: a pure
`matchRoute(patterns, path)` that the tests drive without a DOM, and a thin `createRouter` that
wires `pushState` + `popstate` over it. Views are render-from-state functions; clicks on
in-app links are caught by one delegated `[data-link]` handler rather than per-node listeners.
**Why:** strings compose and unit-test cleanly, escape-by-default makes XSS the hard path not
the easy one (the whole point of the helper), and keeping matching pure keeps the logic honest
without a browser. **Cost:** `innerHTML` re-rendering throws away DOM state on each paint, so
any future stateful widget (an open typeahead mid-keystroke) needs care — the D-19 reversal
trigger (a light framework) still stands if that day comes.

### D-45 — atproto client library: defer the pick to Phase 2, leaning toward atcute.
`stack.md` names `@atproto/oauth-client-browser` + `@atproto/api`, but the live atmot repo —
the proven template this clones — actually ships the `@atcute/*` family (`@atcute/client`,
`@atcute/oauth-browser-client`, `@atcute/identity-resolver`). The scaffold writes no auth or
record code, so it pulls in neither and the question stays open. **Why record it now:** it's a
real contradiction between two sources of truth, and Phase 2 shouldn't rediscover it cold.
**The lean:** match atmot's actual choice (atcute) unless Phase 2 finds a concrete reason not
to, since "do what the working reference does" beats "do what an older doc said." **Cost:** one
doc (`stack.md`) is now slightly ahead of reality; Phase 2 reconciles it for good.
**Resolved (D-46):** Phase 2 picked atcute. Found no reason not to.

### D-46 — atcute is the client library; OAuth redirects to `/oauth/callback`.
Resolves D-45. Phase 2 builds on the `@atcute/*` family — `@atcute/oauth-browser-client`
(4.0.1) for the browser PKCE+DPoP flow, `@atcute/client` (5.1.1) for XRPC, plus
`@atcute/identity-resolver` and the `@atcute/atproto` / `@atcute/bluesky` definition packages.
**Why:** it's what the proven atmot template actually ships; the API was verified against the
live packages, and the flow (configure → createAuthorizationUrl → finalizeAuthorization →
OAuthUserAgent → Client) is clean and matches the docs. **Also fixed:** the OAuth redirect is
`https://rolld.at/oauth/callback` (was a bare `/` stub), and the callback reads its result from
the URL *hash*, not the query string (atcute's flow). **Cost:** `stack.md` named `@atproto/*`;
it is now superseded by reality — atcute is the dependency.

### D-47 — Ship `transition:generic` for v1; granular least-privilege scopes are the migration target.
Phase 2 requests `atproto transition:generic`, NOT the per-collection granular scopes
(`repo:at.rolld.play?action=create&action=delete`, …) the earlier docs sketched. **Context:**
granular OAuth scopes (atproto proposal 0011) are real and rolling out, but the proposal itself
says the *"scope string syntax … [is] likely to change"*, the final spec isn't published, and
`@atcute/oauth-browser-client`'s own README still ships `transition:generic`. **Decision:** use
the transitional coarse scope, which covers every write rolld needs — all `at.rolld.*` records,
`app.bsky.feed.post`, and `uploadBlob` — in one grant that works across every PDS today.
**Why:** least-privilege is the right end state, but shipping an unstable scope grammar at v1
risks consent-screen breakage on some PDSes for a privacy nicety users won't see. The granular
array is documented in `docs/vendor-specs/live-api-reference.md` as the migration target, gated
behind the spec freezing and atcute exposing it. **Cost accepted:** rolld asks for broader
access than it strictly uses in v1 — an honest tradeoff, reversible without a record or URL
change (it's a scope string + a metadata edit, no data migration). Supersedes the granular
scope strings sketched in `stack.md` / Phase 2 for v1.

### D-48 — markpub notes use a nested `text.markdown`; re-confirm before cross-app interop.
The note `content` union member (D-11) is written as
`{ $type: 'at.markpub.markdown', text: { markdown }, flavor: 'gfm' }` — the raw Markdown lives in
a nested `at.markpub.text` object, per the live markpub schema (read off markpub.at; could not be
network-resolved as a published lexicon). **Why record it:** the earlier docs implied the
Markdown sat directly on the markpub member; the real shape nests it. rolld controls its own
`textContent` fallback (D-11) regardless, so a wrong guess degrades gracefully — but any code
that *relies* on markpub interop should re-confirm the `$type`/required fields against a live
record first. **Cost:** a small residual uncertainty isolated to one builder.

---

## How to use this file

- **Cite decisions** in commits/issues by number (e.g. "no plays index, per D-1").
  Keep the numbers stable.
- **Append** new decisions; don't renumber.
- **Supersede, don't delete:** if a decision changes, strike the old text and add a pointer
  to the new one, so the reasoning trail survives.
- This file answers *why*. For *what* and *how*, see the phase briefs in `docs/` (which are
  build scaffolding, not permanent record).
