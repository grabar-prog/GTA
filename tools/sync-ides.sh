#!/usr/bin/env bash
#
# tools/sync-ides.sh
#
# Синхронизирует AGENTS.md + methodology/ в адаптеры IDE/сред.
#
# Снапшоты (ides/bionic/workspace, ides/open-webui/knowledge,
# ides/openclaw/skills/methodology) получают методологию плоско:
# contracts/, docs/, handsoff.md, harness/ — без префикса methodology/.
# Пути methodology/X в .md-файлах переписываются в X точечно
# (только перед латиницей/цифрой/_), проза не портится.
#
# --check делает настоящее сравнение: строит цель во временном
# файле/каталоге и diff-ит с текущим состоянием. Поэтому после
# реального sync --check показывает "unchanged", а не шум.
#
# Использование:
#   ./tools/sync-ides.sh               # синхронизировать все адаптеры
#   ./tools/sync-ides.sh cursor        # только один
#   ./tools/sync-ides.sh --check       # dry-run: что изменилось бы
#   ./tools/sync-ides.sh --help
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --check|-n) DRY_RUN=true ;;
    -h|--help)  sed -n '3,22p' "$0"; exit 0 ;;
    *)          TARGET="$arg" ;;
  esac
done

log()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
skip() { printf '\033[1;90m·\033[0m %s\n' "$*"; }

SRC_AGENTS="AGENTS.md"
SRC_METHOD="methodology"

if [[ ! -f "$SRC_AGENTS" ]]; then
  warn "Не найден $SRC_AGENTS в корне — синхронизировать нечего."
  exit 1
fi

# ── Примитивы ────────────────────────────────────────────────────

# Точечная перезапись: methodology/X → X.
# Только когда за слэшем идёт имя файла (латиница/цифры/_).
rewrite_stream() {
  sed -E 's|methodology/([A-Za-z0-9_])|\1|g'
}

# sync_file <src> <dst> [rewrite:yes|no]
# Строит цель во временном файле, сравнивает с dst, применяет.
sync_file() {
  local src="$1" dst="$2" rewrite="${3:-no}"
  [[ -f "$src" ]] || { warn "нет источника: $src"; return; }

  local tmp
  tmp=$(mktemp)

  if [[ "$rewrite" == "yes" ]]; then
    rewrite_stream < "$src" > "$tmp"
  else
    cp "$src" "$tmp"
  fi

  if [[ -f "$dst" ]] && cmp -s "$tmp" "$dst"; then
    rm -f "$tmp"
    skip "unchanged: $dst"
    return
  fi

  if $DRY_RUN; then
    rm -f "$tmp"
    if [[ -f "$dst" ]]; then
      log "WOULD UPDATE: $dst"
    else
      log "WOULD CREATE: $dst"
    fi
    return
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$tmp" "$dst"
  rm -f "$tmp"
  log "synced: $dst"
}

# sync_dir <src> <dst> [rewrite:yes|no] [exclusions...]
# Строит зеркало в temp (с исключениями и .md-rewrite), diff-ит с dst.
sync_dir() {
  local src="$1" dst="$2" rewrite="${3:-no}"; shift 3
  local -a excl=("$@")
  [[ -d "$src" ]] || { warn "нет каталога: $src"; return; }

  local tmp
  tmp=$(mktemp -d)

  # Копируем с исключениями через tar (не тащим node_modules в temp).
  local -a tar_opts=()
  local e
  for e in "${excl[@]:-}"; do
    [[ -n "$e" ]] && tar_opts+=(--exclude="$e")
  done
  tar -C "$src" "${tar_opts[@]}" -cf - . | tar -C "$tmp" -xf -

  # Перезапись .md в зеркале.
  if [[ "$rewrite" == "yes" ]]; then
    local f
    while IFS= read -r -d '' f; do
      rewrite_stream < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    done < <(find "$tmp" -type f -name '*.md' -print0)
  fi

  # Сравнение.
  if [[ -d "$dst" ]] && diff -rq "$tmp" "$dst" >/dev/null 2>&1; then
    rm -rf "$tmp"
    skip "unchanged: $dst/"
    return
  fi

  if $DRY_RUN; then
    local n=0
    if [[ -d "$dst" ]]; then
      n=$(diff -rq "$tmp" "$dst" 2>/dev/null | wc -l | tr -d ' ')
    else
      n=$(find "$tmp" -type f | wc -l | tr -d ' ')
    fi
    rm -rf "$tmp"
    log "WOULD MIRROR: $src/ → $dst/ ($n изменений)"
    return
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -R "$tmp/." "$dst/"
  rm -rf "$tmp"
  log "mirrored: $dst/"
}

# ── Адаптеры ─────────────────────────────────────────────────────

sync_cursor() {
  log "cursor"
  sync_file "$SRC_AGENTS" "ides/cursor/.cursorrules"
}

sync_windsurf() {
  log "windsurf"
  sync_file "$SRC_AGENTS" "ides/windsurf/.windsurfrules"
}

sync_vscode() {
  log "vscode"
  sync_file "$SRC_AGENTS" "ides/vscode/.github/copilot-instructions.md"
}

sync_zed() {
  log "zed"
  skip "zed reads AGENTS.md at repo root directly"
}

snapshot_methodology_into() {
  local dst="$1"
  sync_file "$SRC_AGENTS"             "$dst/AGENTS.md"   yes
  sync_dir  "$SRC_METHOD/contracts"   "$dst/contracts"   yes
  sync_dir  "$SRC_METHOD/docs"        "$dst/docs"        yes
  sync_file "$SRC_METHOD/handsoff.md" "$dst/handsoff.md" yes
  sync_dir  "harness"                 "$dst/harness"     yes node_modules
}

sync_bionic() {
  log "bionic (LM Studio agentic harness)"
  snapshot_methodology_into "ides/bionic/workspace"
}

sync_openwebui() {
  log "open-webui"
  snapshot_methodology_into "ides/open-webui/knowledge"
}

sync_openclaw() {
  log "openclaw"
  snapshot_methodology_into "ides/openclaw/skills/methodology"
  if ! $DRY_RUN; then
    mkdir -p "ides/openclaw/skills/custom"
  fi
}

sync_unsloth() {
  log "unsloth"
  if ! $DRY_RUN; then
    mkdir -p "ides/unsloth/dataset"
  fi
  skip "unsloth: датасет собирается вручную из $SRC_METHOD → ides/unsloth/dataset/"
}

# ── main ─────────────────────────────────────────────────────────

adapters=(cursor windsurf vscode zed bionic openwebui openclaw unsloth)

if [[ -n "$TARGET" ]]; then
  if declare -F "sync_$TARGET" >/dev/null; then
    "sync_$TARGET"
  else
    warn "неизвестный адаптер: $TARGET"
    warn "доступные: ${adapters[*]}"
    exit 2
  fi
else
  for a in "${adapters[@]}"; do
    "sync_$a" || warn "адаптер упал: $a"
  done
fi

if $DRY_RUN; then
  printf '\n(dry-run: изменения не применены)\n'
else
  printf '\n✅ sync complete\n'
  printf 'проверить: git status && git diff --stat\n'
fi