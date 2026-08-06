#!/usr/bin/env bash
# Print clarify-evals checklist for boss self-score (not auto LLM judge).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Clarify eval cases — mark PASS/FAIL manually against clarify-then-execute.md"
echo "File: $ROOT/evals/clarify-evals.json"
if command -v jq >/dev/null 2>&1; then
  jq -r '
    .must_clarify_before_code[] | "ASK  \(.id): \(.prompt)",
    (.must_not_ask_profile_defaults // empty | .[]? | "NOQ  \(.id): \(.prompt)"),
    (.may_execute_after_confirm // empty | .[]? | "EXEC \(.id): \(.prompt)"),
    (.must_not_align_with_open_branches // empty | .[]? | "BLOCK \(.id): \(.state)")
  ' "$ROOT/evals/clarify-evals.json" 2>/dev/null || jq . "$ROOT/evals/clarify-evals.json"
else
  cat "$ROOT/evals/clarify-evals.json"
fi
echo
echo "Target threshold: $(jq -r .threshold "$ROOT/evals/clarify-evals.json" 2>/dev/null || echo 0.9)"
