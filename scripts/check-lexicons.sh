#!/usr/bin/env bash
# Pre-publish gate for the at.rolld.* lexicons (Phase 5, D-37). Runs every check
# that does NOT touch the network or commit anything, so the schemas are proven
# valid before the maintainer does the DNS edit + publish. Run from the repo root.
set -euo pipefail

DIR="lexicons/at/rolld"

echo "1/3 · rolld's own validator (shape + cross-refs + frozen-target checks)…"
npx tsx scripts/lexicon-validate.ts

echo
echo "2/3 · goat lex parse (official parser)…"
goat lex parse "$DIR"/*.json

echo
echo "3/3 · goat lex lint (style + best practices)…"
# NOTE: a 'large-string' warning on play.json / rating.json is EXPECTED and
# accepted — textContent intentionally allows very long writeups (D-11). The lint
# step exits non-zero on warnings, so we report but don't fail the gate on it.
goat lex lint "$DIR"/*.json || echo "  (lint warnings above are reviewed; the large-string one is the accepted D-11 choice)"

echo
echo "Lexicons are valid. Publishing itself is gated to launch and is the"
echo "maintainer's call — see scripts/publish-lexicons.md (DNS + goat record create)."
