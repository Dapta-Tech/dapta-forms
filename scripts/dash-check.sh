#!/usr/bin/env bash
#
# No em dashes in reader-facing text. See the "Typography" section of CLAUDE.md
# for the why and for the traps; this file is only the enforcement.
#
# Scoped to the HARD BAN paths on purpose. Code comments carry ~1,500 more
# occurrences and are deliberately out of scope: sweeping them would collapse
# most of the repo's `git blame` to remove a character no user ever sees. Widen
# PATHS here if that decision ever changes.
#
# Two severities, because they are at different places:
#   CODE  is user-visible copy. It is at ZERO and blocks on the whole tree.
#   PROSE is docs and changesets, carrying ~320 pre-existing dashes in already
#         published changesets that cannot be revised. It blocks only on lines
#         a given range ADDS, so the number falls without a sweep up front.
#
# Usage:
#   bash scripts/dash-check.sh                 # whole tree (PROSE advisory)
#   bash scripts/dash-check.sh origin/develop  # CI: block on what this adds
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0
BASE="${1:-}"

# U+2014 em dash and U+2015 horizontal bar. Named explicitly, and NOTHING else:
# U+2500 (─) draws the section banners in the CSS and the larger components,
# ~830 of them, and a class like "all Unicode dashes" would destroy every one.
#
# ALTERNATION, never a bracket class. CI and most shells run with LANG unset,
# which puts grep in the C locale, where a bracket class holding multi-byte
# characters degrades to the SET OF THEIR BYTES: `[—―]` becomes {E2,80,94,95}
# and matches every General Punctuation character, because they all begin E2.
# That reported → ’ … • ∈ as em dashes, 260 of them, and no one would keep a
# check that cries wolf four times out of nine. An alternation matches each
# full three-byte sequence and is correct in either locale.
BANNED=$'(—|―)'
# The same two, written as a JS/TS escape. Two strings in the message catalog are
# authored this way, so a glyph-only search reports them clean when they are not.
BANNED_ESCAPED='\\u201[45]'

# PROSE: every line counts, because the whole file is the text.
PROSE=(
  '.changeset'
  'docs'
  'README.md'
  'SELF-HOSTING.md'
  'ARCHITECTURE.md'
  'CONTRIBUTING.md'
  'CLAUDE.md'
  'NOTICE'
)

# CODE: only what is INSIDE quotes counts. The comments in these files are
# advisory per CLAUDE.md, and they outnumber the strings roughly five to one, so
# checking them wholesale would report ~990 failures on day one and the check
# would be switched off within a week.
CODE=(
  'packages/shared/src/i18n/index.ts'
  'apps/web/app/admin/forms/[id]/edit/_components/builder-messages.ts'
  'apps/web/app/admin/forms/[id]/edit/_components/templates.ts'
  'packages/notifications/src/templates.ts'
  'packages/db/src/demo-form.ts'
  'packages/db/src/seed.ts'
  'packages/db/src/templates'
  'packages/destinations/src/adapters'
  'apps/api/src/openapi.ts'
)

# A dash between two quotes of the same kind.
QUOTED=$'(\'[^\']*(—|―)[^\']*\'|"[^"]*(—|―)[^"]*"|`[^`]*(—|―)[^`]*`)'
QUOTED_EN=$'(\'[^\']*–[^\']*\'|"[^"]*–[^"]*"|`[^`]*–[^`]*`)'

# Comment lines in the CODE paths, dropped BEFORE the quote match. Two things
# forced this. A prose comment with a code span on either side of the dash
# (`blank` carries NO config on purpose — `config: null` means …) satisfies
# "a dash between two backticks" without holding a string at all. And a JSDoc
# that quotes a UI string goes stale on its own schedule: one read
# "Logic {em-dash} {question}" months after the copy became "Logic: {question}".
#
# Stripping code spans first (what PROSE does) is NOT the fix here: it would
# erase template literals, and a dashed `Saved ... try again` is exactly the
# copy this check exists to catch. Dropping comment lines keeps every string.
COMMENT_LINE=':[0-9]+:[[:space:]]*(\*|//|/\*)'

# Test titles are advisory per CLAUDE.md: `it('… — …')` is a quoted string, so
# it satisfies QUOTED, but no user ever reads it. Blocking CI on one is how a
# check gets switched off.
SKIP_SPECS='--exclude=*.spec.ts --exclude=*.spec.tsx'

# A dash inside a backtick code span is QUOTED, not used: this very rule has to
# print the character it bans, and a doc that shows a dashed UI string is
# documenting the defect rather than committing it. Strip code spans before
# matching, keeping the original file:line so the report still points at the
# right place.
strip_spans() {
  awk -F: 'BEGIN{OFS=":"} { path=$1; ln=$2; $1=""; $2=""; sub(/^::/,"");
           gsub(/`[^`]*`/, ""); if ($0 ~ /\xe2\x80\x94|\xe2\x80\x95/) print path, ln, $0 }'
}

# The lines BASE...HEAD adds, as `path:lineno`.
#
# Per ADDED LINE, not per touched file. Two things forced that. `grep -F` on a
# filename matches it inside the CONTENT too, so a doc that merely links to
# CLAUDE.md counted as a change to CLAUDE.md. And a file-level gate charges a PR
# for every older dash in any file it opens: adding one section to CLAUDE.md put
# its 31 pre-existing dashes on that PR's account.
added_lines() {
  git diff -U0 "$BASE"...HEAD 2>/dev/null | awk '
    /^\+\+\+ b\// { path = substr($0, 7); next }
    /^@@ /        { split($3, a, ","); n = substr(a[1], 2) + 0; next }
    /^\+\+\+/     { next }
    /^\+/         { print path ":" n; n++ }
  '
}

# The key set goes through a FILE, not through `awk -v`: BSD awk (every macOS
# checkout) rejects a newline inside a -v value and dies mid-run.
only_changed() {
  [ -z "$BASE" ] && { cat; return; }
  local tmp
  tmp=$(mktemp)
  added_lines >"$tmp"
  if [ ! -s "$tmp" ]; then rm -f "$tmp"; return; fi
  awk -F: 'NR==FNR { keep[$0]=1; next } ($1":"$2) in keep { print }' "$tmp" -
  rm -f "$tmp"
}

echo "== dash-check: banned characters =="

# CODE: strings that reach a screen, an inbox, or a screen reader. Always blocks.
CODE_HITS=$(grep -RInE "$QUOTED" "${CODE[@]}" $SKIP_SPECS 2>/dev/null | grep -vE "$COMMENT_LINE" || true)
CODE_HITS="$CODE_HITS
$(grep -RInE "$BANNED_ESCAPED" "${CODE[@]}" $SKIP_SPECS 2>/dev/null || true)"
CODE_HITS=$(printf '%s\n' "$CODE_HITS" | grep -vE '^[[:space:]]*$' || true)

# PROSE: docs and changesets. Blocking scope is whatever this range added.
PROSE_ALL=$(grep -RInE "$BANNED" "${PROSE[@]}" 2>/dev/null | strip_spans || true)
PROSE_ALL="$PROSE_ALL
$(grep -RInE "$BANNED_ESCAPED" "${PROSE[@]}" 2>/dev/null || true)"
PROSE_ALL=$(printf '%s\n' "$PROSE_ALL" | grep -vE '^[[:space:]]*$' || true)
PROSE_HITS=$(printf '%s\n' "$PROSE_ALL" | grep -vE '^[[:space:]]*$' | only_changed || true)

if [ -n "$CODE_HITS" ] || [ -n "$PROSE_HITS" ]; then
  echo "FAIL: em dash (U+2014) or horizontal bar (U+2015) in reader-facing text:"
  [ -n "$CODE_HITS" ] && printf '%s\n' "$CODE_HITS"
  [ -n "$PROSE_HITS" ] && printf '%s\n' "$PROSE_HITS"
  echo
  echo "Use a comma, a colon, a semicolon, parentheses, or two sentences."
  echo "Not a bare hyphen: between clauses it reads as a typo."
  FAIL=1
fi

# Everything in PROSE this range did NOT add: reported, never blocking.
n_all=$(printf '%s\n' "$PROSE_ALL" | grep -cE . || true)
n_hit=$(printf '%s\n' "$PROSE_HITS" | grep -cE . || true)
if [ "$((n_all - n_hit))" -gt 0 ]; then
  echo "note: $((n_all - n_hit)) more in docs/changesets, not added by this range (not blocking)."
fi

# U+2013 is legal BETWEEN the operands of a range and nowhere else. The negative
# filter passes `0-100`, `{min}-{max}`, `$500-$2,000`, `lo-hi`; anything with a
# space or sentence text on either side is punctuation and fails.
echo "== dash-check: en dash outside a range =="
EN_HITS=$( { grep -RInE $'–' "${PROSE[@]}" 2>/dev/null | only_changed; \
             grep -RInE "$QUOTED_EN" "${CODE[@]}" $SKIP_SPECS 2>/dev/null \
               | grep -vE "$COMMENT_LINE"; } \
  | grep -vE $'[0-9A-Za-z})$]–[0-9A-Za-z{($-]' || true)
if [ -n "$EN_HITS" ]; then
  echo "FAIL: en dash (U+2013) used as punctuation, not as a range:"
  printf '%s\n' "$EN_HITS"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "dash-check: FAILED"
  exit 1
fi
echo "dash-check: clean."
