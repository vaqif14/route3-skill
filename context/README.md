# Route3 context engine

Graft-inspired code-context layer so dispatched `route3-*` experts stop starting
blind. Deterministic, zero-dependency (Node + git), content-hash cached. Uses the
real [graft](https://github.com/nanonets/graft) CLI if installed; native fallback
otherwise. Full docs: `../references/context-engine.md`.

## Quick start

```bash
context/ctx.sh build                          # build the graph
context/ctx.sh map                            # top hubs / hotspots
context/ctx.sh pack "add rate limit to http"  # ranked CONTEXT for a task
context/ctx.sh callers src/foo.ts --depth 2   # blast radius
context/ctx.sh check                          # drift (exit 1 if stale)
context/test-context.sh                       # 11 hermetic proof cases
```

## Files

| File | Role |
|---|---|
| `engine.mjs` | native Node engine (build/map/skeleton/callers/check/pack) |
| `ctx.sh` | vendor-neutral front-end; prefers real `graft`, else native |
| `test-context.sh` | hermetic proof harness |

Output lives in `.workflow/route3/context/` (git-ignored regenerable cache):
`graph.json`, `HASHES.json`, `MANIFEST.json`, `nodes/*.md` (reviewable hubs).

## Env

| Var | Effect |
|---|---|
| `ROUTE3_CTX_BACKEND=native` | force native even if graft present |
