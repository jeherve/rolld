# Publishing the `at.rolld.*` lexicons — runbook (Phase 5, D-37)

> **Gated to v1 launch.** Publishing turns the schema into a public standard others
> build on, and once published the frozen-constraints rules (D-8) bind hard. So this
> runs *after* the app has exercised the schema in real use (Phases 1–4), at launch.
>
> Everything an agent can prepare is done. The two steps that are **the maintainer's
> call** are marked 🔒 — the `_lexicon` DNS edit and the final publish. Do not run
> those autonomously.

## What gets published

The four schemas in `lexicons/at/rolld/`, each as a `com.atproto.lexicon.schema`
record under the **`@rolld.at`** account, rkey = the NSID:

- `at.rolld.defs` — referenced by the others (`#gameRef`, `#player`, `#image`,
  `#aspectRatio`), so it MUST be published too or external consumers can't resolve
  the cross-references.
- `at.rolld.play`
- `at.rolld.rating`
- `at.rolld.profile`

## Step 0 — Pre-publish gate (no network, safe to run now)

```sh
bash scripts/check-lexicons.sh
```

Runs rolld's validator + `goat lex parse` + `goat lex lint`. All four parse
cleanly. **Accepted warning:** `goat lex lint` flags a `large-string` on
`play.json`/`rating.json` — that's the `textContent` `maxLength: 100000`, kept
deliberately so long first-game writeups fit (D-11). Reviewed and accepted; not a
blocker. Everything else is green.

> Tooling note (corrects the phase brief): this `goat` build has **no `goat lex
> push`**. `goat lex` only parses/lints/diffs/checks-breaking. Publishing the schema
> records is done with `goat record create` (below). Confirmed against
> `goat lex --help` / `goat record create --help` on 2026-06-30.

## Step 1 🔒 — DNS authority (`_lexicon` TXT record) — MAINTAINER

The NSID `at.rolld.*` is the reverse-DNS of `rolld.at`, and the namespace is flat
(no `at.rolld.boardgame.*` nesting), so **one** record covers everything:

```
_lexicon.rolld.at   TXT   "did=did:plc:<the @rolld.at account DID>"
```

Find the `@rolld.at` DID with `goat account status` (once logged in as `@rolld.at`)
or `goat resolve rolld.at`. Then verify the record resolves before publishing:

```sh
dig +short TXT _lexicon.rolld.at
```

DNS propagation + resolver caching can take ~12h for some indexers, so do this
ahead of the launch publish.

## Step 2 🔒 — Publish the schema records — MAINTAINER

Authenticate as the publishing identity, then create one record per schema with the
NSID as the rkey. The record body is the lexicon JSON itself; the PDS stores it in
the `com.atproto.lexicon.schema` collection.

```sh
goat account login                 # as @rolld.at

# One per schema (rkey = the NSID). defs FIRST so cross-refs resolve.
goat record create -r at.rolld.defs    lexicons/at/rolld/defs.json
goat record create -r at.rolld.play    lexicons/at/rolld/play.json
goat record create -r at.rolld.rating  lexicons/at/rolld/rating.json
goat record create -r at.rolld.profile lexicons/at/rolld/profile.json
```

> 🔍 At publish time, confirm whether this `goat` build derives the collection +
> wraps the schema as a `com.atproto.lexicon.schema` record automatically from the
> lexicon JSON, or whether the body needs an explicit `$type` /
> `--collection com.atproto.lexicon.schema`. Check `goat record create --help` and a
> dry run against a throwaway rkey first. (The atproto guide's canonical path is
> putRecord into `com.atproto.lexicon.schema` with the schema as the value.)

## Step 3 — Verify it resolved

```sh
goat lex resolve at.rolld.play        # should return the schema via DNS authority
goat lex breaking lexicons/at/rolld/  # now resolves a baseline; should be clean
```

- **PDSls:** open <https://pdsls.dev/> and type `at.rolld.play` — it resolves via
  DNS and shows the published schema if authority + record are correct. Browse
  `at://<@rolld.at DID>/com.atproto.lexicon.schema` to see all four.
- Optionally check `@atproto/lexicon-resolver`: `resolveLexicon('at.rolld.play')`
  returns the doc with a verified inclusion proof; `resolveLexiconDidAuthority(...)`
  returns the `@rolld.at` DID.

## After publishing — the standing constraint

The schemas are now frozen under D-8: only add **optional** fields; any breaking
change is a new NSID (`…play` → a v2 NSID). Run `goat lex breaking lexicons/at/rolld/`
before ever re-publishing an edited schema — it now has a published baseline to
diff against and will catch an accidental breaking change before it ships.

## Definition of done (Phase 5)

- [x] All four schemas parse + validate (`scripts/check-lexicons.sh`).
- [x] Publish commands + verification steps prepared (this file).
- [ ] 🔒 `_lexicon.rolld.at` TXT record resolves to the `@rolld.at` DID (maintainer).
- [ ] 🔒 Four `com.atproto.lexicon.schema` records exist under `@rolld.at` (maintainer).
- [ ] `pdsls.dev` resolves `at.rolld.play` by name; `goat lex resolve` confirms authority.
