#!/usr/bin/env bash
#
# tools/lint-refs.sh — repo linter: links, anchors, doc rules, Three.js API guard.
# No dependencies beyond grep/sed/find/comm/sort (Git Bash stock). Read-only:
# writes only to a temp dir it removes on exit.
#
# Checks:
#   1. definitions   "### C-<PREFIX>-N" headings in methodology/contracts/*.md,
#                    each defined exactly once so lookup by file name is unambiguous
#   2. references    "<file>.md#C-X-N" links in game/gta.html, AGENTS.md,
#                    methodology/, harness/, tools/ — generated ides/ mirrors are
#                    skipped; sync-ides.sh owns those
#   3. resolution    every such link points at a file under methodology/ that
#                    defines the anchor
#   4. router        every methodology/**.md named in AGENTS.md exists, and no .md
#                    under methodology/ is missing from it (an agent cannot find
#                    what the table does not route to)
#   5. coverage      anchors nobody cites — informational, never fails
#   6. doc links     relative links inside methodology/*.md resolve; every
#                    "methodology/<path>.md" mention anywhere resolves
#   7. Three.js API  r128-only API absent (C-API-2), 0.160 entry points present
#                    (C-API-1/2/7: importmap tag, outputColorSpace, no polyfill,
#                    useLegacyLights paired with a TODO)
#   8. anchor format headings read C-<PREFIX>-N and every prefix is documented in
#                    AGENTS.md — catches invented C-CAMERA-1 / C-cam-1 / C-1
#   9. run metrics   a file quoting harness numbers carries provenance:
#                    verified@ / last-known-good@ / inspection@ / TBD
#  10. TODOs         every // TODO in JS carries a session number, TODO(sNN): ...
#
# Deliberately NOT checked: the "never write methodology/ as a bare word" prose
# rule. Grepping it fires on AGENTS.md stating the rule itself and on allowed
# forms ("the methodology folder"); checks 4–6 enforce what that rule is about —
# every path mentioned must resolve to something real.
#
# Usage:  ./tools/lint-refs.sh          # ~8 s, one block per check
# Exit:   0 clean, 1 a rule is violated. Run after editing contract headings,
#         anchor comments, the AGENTS.md routing table or game/gta.html comments;
#         a pre-commit hook only makes sense on a tree that passes without
#         --no-verify.
#         Resolve-from-root means a partial copy is not a supported mode: a
#         scratchpad fixture missing README.md reports doc links that are fine
#         in the real tree. Test rules by injecting violations, not by pruning.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SOURCES=(game/gta.html AGENTS.md methodology harness tools)
GAME=game/gta.html
fail=0

# ── 1. Anchor definitions ────────────────────────────────────────
grep -rhoE '^#{2,4} +C-[A-Z]+-[0-9]+' methodology/contracts/ \
  | sed -E 's/^#+ +//' > "$TMP/defs"
sort -u "$TMP/defs" > "$TMP/anchors"

dup="$(sort "$TMP/defs" | uniq -d)"
if [[ -n "$dup" ]]; then
  echo "== Duplicate definitions =="
  while IFS= read -r d; do echo "  defined more than once: $d"; done <<<"$dup"
  fail=1
fi

echo "== Definitions =="
echo "  anchors: $(wc -l < "$TMP/anchors" | tr -d ' ') in methodology/contracts/"

# ── 2 + 3. References resolve ───────────────────────────────────
grep -rhoE '[A-Za-z0-9_.-]+\.md#C-[A-Z]+-[0-9]+' "${SOURCES[@]}" 2>/dev/null \
  | sort -u > "$TMP/refs" || true

echo "== References =="
broken=0
while IFS= read -r ref; do
  file="${ref%%#*}"
  anchor="${ref##*#}"
  paths="$(find methodology -type f -name "$file" | sort)"
  if [[ -z "$paths" ]]; then
    echo "  FILE NOT FOUND: $ref"; broken=$((broken + 1)); fail=1; continue
  fi
  hit=0
  while IFS= read -r p; do
    if grep -qE "^#{2,4} +${anchor}( |$)" "$p"; then hit=1; break; fi
  done <<<"$paths"
  if [[ $hit -eq 0 ]]; then
    echo "  ANCHOR NOT FOUND: $ref (looked in $(echo "$paths" | tr '\n' ' '))"
    broken=$((broken + 1)); fail=1
  fi
done < "$TMP/refs"
echo "  links: $(wc -l < "$TMP/refs" | tr -d ' ') from ${#SOURCES[@]} sources, $broken broken"

# ── 4. Router paths exist and cover the tree ────────────────────
echo "== Router (AGENTS.md) =="
grep -oE 'methodology/[A-Za-z0-9/_.-]+\.md' AGENTS.md | sort -u > "$TMP/named"
missing=0
while IFS= read -r f; do
  [[ -f "$f" ]] || { echo "  MISSING: $f"; missing=$((missing + 1)); fail=1; }
done < "$TMP/named"

find methodology -name '*.md' | sort > "$TMP/files"
unrouted="$(comm -23 "$TMP/files" "$TMP/named")"
if [[ -n "$unrouted" ]]; then
  echo "  NOT ROUTED — nothing in AGENTS.md points at these:"; sed 's/^/    /' <<<"$unrouted"; fail=1
fi
echo "  $(wc -l < "$TMP/named" | tr -d ' ') named paths, $missing missing"
echo "  $(wc -l < "$TMP/files" | tr -d ' ') .md files under methodology/, $(grep -c . <<<"$unrouted" || true) unrouted"

# ── 5. Coverage (informational) ─────────────────────────────────
sed -E 's/.*#//' "$TMP/refs" | sort -u > "$TMP/cited"
uncited="$(comm -23 "$TMP/anchors" "$TMP/cited")"
echo "== Anchors with no citation =="
if [[ -n "$uncited" ]]; then
  echo "  $(grep -c . <<<"$uncited") of $(wc -l < "$TMP/anchors" | tr -d ' ') — no comment cites them (informational):"
  sed 's/^/    /' <<<"$uncited"
else
  echo "  none"
fi

# ── 6. Doc links resolve ────────────────────────────────────────
# Targets are trimmed in bash, not with sed: the "](" prefix needs regex escapes
# that are easy to lose when editing this file, and a failed extraction here used
# to report "0 broken" while checking nothing at all.
echo "== Doc links =="
links=0; broken_links=0
while IFS= read -r f; do
  d="$(dirname "$f")"
  grep -oE '\]\(<?[^):#]+\.md' "$f" | sort -u > "$TMP/targets" || true
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    target="${m:2}"; target="${target#<}"      # strip "](" then an optional "<"
    links=$((links + 1))
    if [[ ! -f "$d/$target" ]]; then
      echo "  BROKEN $f -> $target"; broken_links=$((broken_links + 1)); fail=1
    fi
  done < "$TMP/targets"
done < <(find methodology -name '*.md')

grep -rhoE 'methodology/[A-Za-z0-9/_.-]+\.md' "${SOURCES[@]}" | sort -u > "$TMP/mentions" || true
while IFS= read -r mention; do
  [[ -z "$mention" ]] && continue
  links=$((links + 1))
  if [[ ! -f "$mention" ]]; then
    echo "  BROKEN mention $mention"; broken_links=$((broken_links + 1)); fail=1
  fi
done < "$TMP/mentions"
echo "  checked: $links links, $broken_links broken"

# ── 7. Three.js API guard (contracts/render-api.md) ────────────
# Pinned at 0.160.x via importmap. Migration r128 → 0.160 replaced the colour
# API (C-API-2), dropped the CapsuleGeometry polyfill (native since r140) and
# moved the loader from a classic <script> to importmap (C-API-1).
#
# Forbidden set = r128-only symbols still lingering + a classic three tag.
# Required set  = 0.160 entry points. Note that `useLegacyLights` is itself
# temporary (C-API-7) and must carry a TODO(sNN): owner, or it becomes the
# permanent state by accident.
echo "== Three.js 0.160 API ($GAME) =="

# (a) no r128-only symbol or CDN path anywhere in the file
legacy="$(grep -nE 'outputEncoding|THREE\.sRGBEncoding|physicallyCorrectLights|three\.js/r128|three@0\.128|examples/js/' "$GAME" || true)"
if [[ -n "$legacy" ]]; then
  echo "  r128-only API present (C-API-2):"; sed 's/^/    /' <<<"$legacy"; fail=1
fi

# (b) no classic <script src="…three…"> tag at all — the module loads three via importmap
legacy_tag="$(grep -nE '<script[^>]*src="[^"]*three' "$GAME" || true)"
if [[ -n "$legacy_tag" ]]; then
  echo "  classic <script src=…three…> tag (C-API-1):"; sed 's/^/    /' <<<"$legacy_tag"; fail=1
fi

# (c) required 0.160 entry points are all present
for want in 'type="importmap"' \
            'three@0\.160\.[0-9]+/build/three\.module\.js' \
            'import \* as THREE from' \
            'renderer\.outputColorSpace[[:space:]]*=[[:space:]]*THREE\.SRGBColorSpace' \
            't\.colorSpace[[:space:]]*=[[:space:]]*THREE\.SRGBColorSpace'; do
  if ! grep -qE "$want" "$GAME" "assets/day-cycle.js"; then echo "  required 0.160 code missing: $want"; fail=1; fi
done

# (d) the CapsuleGeometry polyfill is gone — native since r140 (C-API-3 retired)
if grep -qE 'THREE\.CapsuleGeometry[[:space:]]*=[[:space:]]*class' "$GAME"; then
  echo "  CapsuleGeometry polyfill still present — native in 0.160 (C-API-3)"; fail=1
fi

# (e) useLegacyLights is a stopgap and must have an owner (C-API-7)
if grep -qE 'renderer\.useLegacyLights' "$GAME"; then
  if ! grep -qE 'TODO\(s[0-9]+\):.*useLegacyLights' "$GAME"; then
    echo "  renderer.useLegacyLights without a TODO(sNN): owner (C-API-7)"; fail=1
  fi
fi

echo "  pinned 0.160.x via importmap, sRGBColorSpace, no r128 fallback"

# ── 8. Anchor format and documented prefixes ────────────────────
echo "== Anchor format =="
badhead="$(grep -rnE '^#{2,4} +C-' methodology/contracts/ \
           | grep -vE ':[0-9]+:#{2,4} +C-[A-Z]{2,6}-[0-9]+( |$)' || true)"
if [[ -n "$badhead" ]]; then
  echo "  malformed heading — must be C-<PREFIX>-N:"; sed 's/^/    /' <<<"$badhead"; fail=1
fi
documented="$(sed -n '/^When a comment points at a contract/,+1p' AGENTS.md | grep -oE '`[A-Z]{3,6}`' | tr -d '`' | sort -u)"
if [[ -z "$documented" ]]; then
  echo "  prefix list unreadable in AGENTS.md — prefix check skipped"
else
  undocumented="$(sed -E 's/^C-([A-Z]+)-[0-9]+$/\1/' "$TMP/anchors" | sort -u \
                 | while IFS= read -r p; do grep -qx "^${p}$" <<<"$documented" || echo "$p"; done)"
  if [[ -n "$undocumented" ]]; then
    echo "  prefix not documented in AGENTS.md (add it to the prefixes line):"; sed 's/^/    C-/' <<<"$undocumented"; fail=1
  fi
  echo "  $(wc -l < "$TMP/anchors" | tr -d ' ') anchors, prefixes: $(echo "$documented" | tr '\n' '/' | sed 's|/$||')"
fi

# ── 9. Run metrics need provenance ──────────────────────────────
# Contract constants (dt clamp, m/s speeds, dayTime) are invariants, not run
# results — METRIC matches only numbers that quote a harness measurement.
echo "== Run metrics need a label =="
METRIC='genMs|"[A-Za-z]+Ms"|calls=[0-9]+|[0-9]{1,3}/[0-9]{1,3} (green|PASS)|[0-9]+/[0-9]+ checks|[0-9]+\.[0-9]+ s wall'
LABEL='verified@|last-known-good@|inspection@|TBD'
unlabelled=0
while IFS= read -r f; do
  if grep -qE "$METRIC" "$f" && ! grep -qE "$LABEL" "$f"; then
    echo "  $f quotes a run result with no verified@/last-known-good@/inspection@/TBD"
    unlabelled=$((unlabelled + 1)); fail=1
  fi
done < <(find methodology -name '*.md')
echo "  unlabelled files: $unlabelled"

# ── 10. TODOs carry a session number ────────────────────────────
echo "== TODOs =="
bare_todo="$(grep -rnE '//[[:space:]]*TODO' "$GAME" harness/*.js 2>/dev/null | grep -vE 'TODO\(s[0-9]+\)' || true)"
if [[ -n "$bare_todo" ]]; then
  echo "  bare TODO — write TODO(sNN): so the owner is knowable:"; sed 's/^/    /' <<<"$bare_todo"; fail=1
else
  echo "  none, or all numbered"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "OK — lint clean"; exit 0
else
  echo "FAIL — a rule is violated, see the blocks above"; exit 1
fi