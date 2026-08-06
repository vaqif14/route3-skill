# Route3 × product-engineering principles (adapted)

Source: user-supplied `AGENTS.md` principles (study established products +
7 growth/architecture rules). Adapted for Bugi / Route3 slim-v3 — same pattern
as `ponytail-ladder.md`.

Callers: `SKILL.md` disclosure table; `slim-v3-contract.md`; Architect /
preflight / Build briefs in `build-pipeline.md`; `route3-reviewer` scope;
`skill-routing.md`; bugi `AGENTS.md` sticky.

Example PLAN line (synthetic):
`PRODUCT: patterns=uzum-rail+wb-density; layer=slice-2; reuse=ProductRail; no_compat_shims=true`

## 0. Study established products first

Before designing a solution, study how established products solve the same
problem. Adopt proven patterns and conventions rather than inventing from
scratch.

**Bugi priors (silent):** Uzum.uz / Wildberries-class density and commerce UX;
existing repo patterns in `src/features/*`. Log `PRODUCT:` with which refs
were checked (or `reuse=<path>` if the pattern already lives in-repo).

Skip only for trivial one-file typo/rename (Proportionality).

## The seven principles (adapted)

### 1. Prefer delete obsolete paths — careful with live contracts

Upstream: do not preserve backward compatibility; remove obsolete paths
instead of compat layers / fallbacks / forever-migrations.

**Route3 adaptation (live marketplace):**

| Surface | Rule |
|---|---|
| Dead internal code, unused flags, unreachable UI | Delete; no shim |
| Public URL, API contract, DB column still read by prod | Plan cutover; `destructive_operation` / `production_change` gate; short dual-read only if cutover needs it, with kill date |
| "Compat forever" layers | Banned — either migrate or keep the old path until deleted |

Never add a permanent fallback "just in case" without a removal AC.

### 2. Simplest that fully meets *current* requirements

Same as ponytail: no speculative abstractions, config, or indirection.
Still production-complete on the surface you ship (states, validation, a11y).

### 3. Grow in layers (working product always)

Start from the smallest version that works **end to end**, then add each new
capability on top of a product that already works. Never trade a working
product for unfinished complexity.

**Maps to Route3 slices:** big scope → more production-complete slices, not
one half-built mega-diff. "No MVP stub" ≠ "build everything in one PR".

### 4. Modular components, clear concerns

Separation of duties already in agent roster (planner ≠ builder ≠ reviewer).
In code: feature modules, shared UI primitives, no god-files. Prefer extend
existing `src/features/<domain>` over new top-level junk drawers.

### 5. Prefer established libraries when they win

Use well-maintained libraries when they **reduce overall complexity** or
improve reliability. Do not reimplement common functionality without a clear
reason.

**Order with ponytail + `dependency_add`:**

```
repo helper → already-installed dep → platform/native →
(new well-maintained lib only if clearly simpler + gate) → hand-roll last
```

### 6. Lean on what's already in the project

Before writing your own or adding a package: check existing deps, docs, and
types. Do not assume a library lacks a capability without checking.

### 7. Long-term architecture — no intentional stopgaps

Do not accept a stopgap that "only works for now" and is meant to be replaced
later. If a temporary bridge is truly required (principle 1 cutover), name the
removal AC and date in PLAN — unmarked "temp" is a defect.

## Brief / PLAN blocks

```text
PRODUCT: patterns=<refs|in-repo paths> layer=<slice-n> reuse=<path|none>
  delete_obsolete=<paths|none> stopgap=<none|desc+kill-ac>
```

## Reviewer checks

- Invented UX/flow when Uzum/WB/repo pattern exists → Medium+ (ask for
  `PRODUCT:` evidence)
- New permanent compat shim → High
- New package without checking installed deps/docs → High (`dependency_add`)
- "Temp" without kill AC → High
- Half-finished layer that breaks prior working path → Reject / FIX

## Do NOT

- Blindly break checkout/auth/pay URLs "because no compat"
- Use layering as an excuse for stub/MVP UI
- Add libraries for fashion — only when complexity/reliability wins
