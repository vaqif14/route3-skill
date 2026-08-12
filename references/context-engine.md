# Route3 context engine (graft-inspired, $0 structural core)

Callers: `SKILL.md` progressive row; `dispatch-prompt-contract.md`; `scripts/context-pack.sh`.

Fixes route3's worst trait: dispatched `route3-*` experts used to **start blind**
(re-grep, re-read) — multiplying tokens. This gives them a deterministic,
content-hash-cached knowledge graph of the repo, so they land on the right files
immediately. Inspired by [nanonets/graft]; **uses real graft if installed**,
falls back to a zero-dependency Node engine otherwise.

## Front-end

```bash
context/ctx.sh backend            # which backend (graft|native)
context/ctx.sh build              # build/refresh the graph  (native: node engine)
context/ctx.sh map [--budget N]   # orientation: top hubs by fan-in + dir hotspots
context/ctx.sh skeleton <file>    # signatures only (~1/10 tokens)
context/ctx.sh callers <f|sym> [--depth N]   # blast radius (transitive)
context/ctx.sh check              # drift vs cache; exit 1 if stale
context/ctx.sh pack "<task>" [--k N]         # ranked CONTEXT block for dispatch
```

Backend selection: real `graft` on PATH → delegate (tree-sitter + LLM synthesis).
Else native. Force native with `ROUTE3_CTX_BACKEND=native`.

## What the native engine does (deterministic, no LLM, no key)

- `git ls-files` → source files (`.ts/.tsx/.js/.jsx/.mjs/.cjs/.py/.go`), dot-dir
  tooling (`.claude/.agents/.cursor`) excluded so it's a **product** graph.
- Regex-extract symbols + imports; resolve relative imports to repo files.
- Build nodes (files) + edges (`depends_on`) + reverse edges (`imported_by` = blast radius).
- Content-hash every file (`sha256`, 400 KB cap applied identically in build+check).
- Emit `.workflow/route3/context/`: `graph.json`, `HASHES.json`, `MANIFEST.json`,
  and reviewable `nodes/*.md` for the top-200 hubs.

## Where it plugs into the spine

Before dispatch, the boss (or `context-pack.sh`) injects a `pack` block into the
DISPATCH_PROMPT so the writer gets exact files, not a blind repo:

```
profile → CLARIFY → preflight → route-slice → ctx.sh build (once) →
ctx.sh pack "<slice goal>" → embed <CONTEXT> in DISPATCH_PROMPT → BUILD
```

`scripts/context-pack.sh` already appends a **CODE CONTEXT** section automatically
(best-effort; silent no-op if the engine is missing).

## Freshness discipline

Run `ctx.sh check` after edits. Exit 1 = graph stale → `ctx.sh build` to refresh
(native refresh is structural and cheap). This is the drift analog of graft's
`graft check` / blast-radius warnings.

## Proof

```bash
context/test-context.sh    # 11 hermetic cases: graph, transitive callers, drift, pack ranking
```

[nanonets/graft]: https://github.com/nanonets/graft
