#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# EXAMPLE — sanitized, educational.
#
# Pre-commit secret scan. Run before staging anything, in this repository and in
# the private operations repository.
#
# Design rules, which matter more than the pattern list:
#
#   1. Report FILE and LINE NUMBER only. NEVER print the matched value — a
#      scanner that echoes secrets into your terminal, CI log, or scrollback has
#      just widened the exposure it was meant to catch.
#   2. A hit is a STOP, not a warning. If a candidate cannot be positively
#      classified as a placeholder or policy text, do not stage it.
#   3. This is accident reduction, not a security control. It catches known
#      shapes. It does not catch a password that looks like a word, and it
#      cannot tell you that a file you never scanned was safe.
#   4. .gitignore is not a scanner and a scanner is not review. Run both, then
#      read `git diff --cached` yourself.
#
# Usage:  ./secret-scan.example.sh [path]
# Exit:   0 = no candidates, 1 = candidates found (do not commit)
# -----------------------------------------------------------------------------
set -uo pipefail

TARGET="${1:-.}"

# Credential-shaped keywords. Deliberately noisy: false positives are cheap,
# a missed credential is not.
KEYWORDS='password|passwd|secret|token|api_key|apikey|authorization|bearer|private[_-]?key'

# Known provider credential prefixes and key headers.
PREFIXES='BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}'

# Things that must never be committed at all, regardless of content.
FORBIDDEN_FILES='(^|/)\.env|(^|/)auth\.json$|(^|/)acme\.json$|\.(db|sqlite3?|pem|key|p12|pfx)$|-(wal|shm)$'

status=0

echo "== Scanning: ${TARGET}"

echo
echo "-- Forbidden file types --"
if git -C "${TARGET}" ls-files 2>/dev/null | grep -nE "${FORBIDDEN_FILES}"; then
    echo "STOP: forbidden file type tracked or staged."
    status=1
else
    echo "none"
fi

echo
echo "-- Credential-shaped keywords (file:line only) --"
# -I skips binaries; --exclude-dir avoids scanning dependency trees; the
# `cut -d: -f1,2` is what enforces rule 1 — the match itself is discarded.
if grep -rInE "${KEYWORDS}" "${TARGET}" \
      --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv \
      2>/dev/null | cut -d: -f1,2 | sort -u | grep .; then
    echo "REVIEW: classify every line above as placeholder, policy text, or secret."
    status=1
else
    echo "none"
fi

echo
echo "-- Known credential prefixes (file:line only) --"
if grep -rInE "${PREFIXES}" "${TARGET}" \
      --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv \
      2>/dev/null | cut -d: -f1,2 | sort -u | grep .; then
    echo "STOP: high-confidence credential shape detected."
    status=1
else
    echo "none"
fi

echo
echo "-- Whitespace / conflict-marker check --"
git -C "${TARGET}" diff --check || status=1

echo
if [ "${status}" -ne 0 ]; then
    echo "RESULT: candidates found. Do NOT stage until each is classified."
    echo "        If a real secret was found: rotate or revoke FIRST."
    echo "        History rewriting is cleanup, not remediation."
else
    echo "RESULT: no candidates. Still read 'git diff --cached' before committing."
fi

exit "${status}"
