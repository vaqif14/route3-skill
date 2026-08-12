#!/usr/bin/env bash
# Route3 context front-end — vendor-neutral, graft-aware.
#
# If the real `graft` CLI is installed we DELEGATE to it (it has tree-sitter +
# LLM synthesis + benchmarked ranking). Otherwise we fall back to the native
# zero-dependency Node engine. Same verbs either way, so dispatch prompts and
# the boss spine don't care which backend is live.
#
#   ctx.sh build            ctx.sh map [--budget N]     ctx.sh skeleton <file>
#   ctx.sh callers <f|sym>  ctx.sh check                ctx.sh pack "<task>" [--k N]
#   ctx.sh backend          # print which backend would run
#
# Force native even when graft exists: ROUTE3_CTX_BACKEND=native
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$HERE/engine.mjs"

backend() {
  if [[ "${ROUTE3_CTX_BACKEND:-}" == "native" ]]; then echo native; return; fi
  if command -v graft >/dev/null 2>&1; then echo graft; else echo native; fi
}

cmd="${1:-}"; shift || true
BE="$(backend)"

if [[ "$cmd" == "backend" ]]; then echo "ctx backend=$BE (graft $(command -v graft >/dev/null 2>&1 && echo present || echo absent))"; exit 0; fi

if [[ "$BE" == "graft" ]]; then
  case "$cmd" in
    build)    exec graft build ;;
    map)      exec graft map ;;
    skeleton) exec graft skeleton "$@" ;;
    callers)  exec graft callers "$@" ;;
    check)    exec graft check ;;
    pack)     exec graft ask "$@" ;;   # graft ask ≈ ranked-node context
    *) echo "unknown ctx cmd: $cmd" >&2; exit 2 ;;
  esac
else
  command -v node >/dev/null || { echo "node required for native ctx backend" >&2; exit 2; }
  case "$cmd" in
    build|map|skeleton|callers|check|pack) exec node "$ENGINE" "$cmd" "$@" ;;
    *) echo "unknown ctx cmd: $cmd" >&2; exit 2 ;;
  esac
fi
