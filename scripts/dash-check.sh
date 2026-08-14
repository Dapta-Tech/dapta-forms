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
# Usage: bash scripts/dash-check.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0

# U+2014 em dash and U+2015 horizontal bar. Named explicitly, and NOTHING else:
# U+2500 (─) draws the section banners in the CSS and the larger components,
# ~830 of them, and a class like "all Unicode dashes" would destroy every one.
BANNED=$'[—―]'
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

# A dash between two quotes of the same kind. Approximate by design: a comment
# that itself quotes a dashed UI string will trip it. That is the right failure
# direction, because such a comment is documenting copy that must change anyway.
QUOTED=$'(\'[^\']*[—―][^\']*\'|"[^"]*[—―][^"]*"|`[^`]*[—―][^`]*`)'
QUOTED_EN=$'(\'[^\']*–[^\']*\'|"[^"]*–[^"]*"|`[^`]*–[^`]*`)'

# A dash inside a backtick code span is QUOTED, not used: this very rule has to
# print the character it bans, and a doc that shows a dashed UI string is
# documenting the defect rather than committing it. Strip code spans before
# matching, keeping the original file:line so the report still points at the
# right place.
strip_spans() {
  awk -F: 'BEGIN{OFS=":"} { path=$1; ln=$2; $1=""; $2=""; sub(/^::/,"");
           gsub(/`[^`]*`/, ""); if ($0 ~ /[\xe2\x80\x94\xe2\x80\x95]/) print path, ln, $0 }'
}

echo "== dash-check: banned characters =="
HITS=$(grep -RInE "$BANNED" "${PROSE[@]}" 2>/dev/null | strip_spans || true)
HITS="$HITS
$(grep -RInE "$QUOTED" "${CODE[@]}" 2>/dev/null || true)"
HITS=$(printf '%s\n' "$HITS" | grep -vE '^[[:space:]]*$' || true)
ESCAPED=$(grep -RInE "$BANNED_ESCAPED" "${PROSE[@]}" "${CODE[@]}" 2>/dev/null || true)
if [ -n "$HITS" ] || [ -n "$ESCAPED" ]; then
  echo "FAIL: em dash (U+2014) or horizontal bar (U+2015) in reader-facing text:"
  [ -n "$HITS" ] && printf '%s\n' "$HITS"
  [ -n "$ESCAPED" ] && printf '%s\n' "$ESCAPED"
  echo
  echo "Use a comma, a colon, a semicolon, parentheses, or two sentences."
  echo "Not a bare hyphen: between clauses it reads as a typo."
  FAIL=1
fi

# U+2013 is legal BETWEEN the operands of a range and nowhere else. The negative
# filter passes `0-100`, `{min}-{max}`, `$500-$2,000`, `lo-hi`; anything with a
# space or sentence text on either side is punctuation and fails.
echo "== dash-check: en dash outside a range =="
EN_HITS=$( { grep -RInE $'–' "${PROSE[@]}" 2>/dev/null; \
             grep -RInE "$QUOTED_EN" "${CODE[@]}" 2>/dev/null; } \
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
