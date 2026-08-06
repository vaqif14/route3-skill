# Route3 × Ponytail ladder (adapted)

Source: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
(`AGENTS.md` + `skills/ponytail`, MIT). Adapted for Bugi / Route3 slim-v3 —
**not** a full plugin install.

Callers: Build briefs, `route3-reviewer` overbuild pass, `slim-v3-contract.md`,
`skill-routing.md`, root `SKILL.md` disclosure. Default intensity: **full**.

Example PLAN line (synthetic):
`PONYTAIL: level=full rung=2 reuse=src/lib/foo.ts skipped=new-cache-lib`

## Compatibility with Route3 "no MVP"

| Ponytail | Route3 | Combined rule |
|---|---|---|
| Write only what the task needs | Production-complete slice | Minimal **surface**, full **quality** on that surface |
| Never cut validation/security/a11y | No stubs / all states | Same — these are never YAGNI |
| No speculative abstractions | No "phase 2" scaffolding | Same |
| No new deps if avoidable | `dependency_add` gate | Same — prefer installed / platform |
| Shortest working diff | Boss check + AC | Smallest correct diff after reading the flow |

**Banned misread:** using ponytail to drop loading/error/a11y/AZ copy or to
ship a stub "because shorter". That is negligent, not lazy.

## The ladder (after you understand the problem)

Read the task + code it touches; trace the real flow; **then** stop at the
first rung that holds:

1. **Need to exist?** Speculative → skip; one line in PLAN (`YAGNI: …`).
2. **Already in this codebase?** Reuse helper/util/pattern — don't rewrite.
3. **Stdlib / language built-in?** Prefer it.
4. **Native platform?** e.g. `<input type="date">`, CSS, DB constraint, Next
   primitives, existing shadcn — before a new lib.
5. **Already-installed dependency?** Use it. Never add a package for a few lines.
6. **One line?** One line.
7. **Only then:** minimum code that works (still production-complete).

## Bug fix = root cause

Grep every caller of the function you touch. One guard in the shared path >
N guards in callers. Ticket-path-only patches leave sibling bugs.

## Rules (coding slices)

- No unrequested abstractions (one-impl interface, factory-for-one, config
  for a constant).
- No boilerplate "for later".
- Deletion over addition. Boring over clever. Fewest files.
- Shortest **correct** diff wins — wrong-place small diff = second bug.
- Two equal-size options → pick the edge-case-correct one.
- Deliberate corner with a known ceiling → `// ponytail: <ceiling>; upgrade: <path>`.
- Overbuild pressure (new dep, new framework layer) → grill with default
  **skip** ("Deyməsən → mövcud X istifadə"). Never grill brand/locale/stack.

## Intensity (Route3)

| Level | When | Behavior |
|---|---|---|
| **lite** | User asks to explore options | Build asked; name lazier alt in one line |
| **full** | Default every Build | Ladder enforced; shortest correct diff |
| **ultra** | User says "ultra" / "maksimal sil" | Deletion-first; challenge scope in same breath |

User pin: `/ponytail lite|full|ultra` or "ponytail / lazy / yagni / do less".

## Expert brief block (mandatory on BUILD)

```text
PONYTAIL: level=full rung=<1-7> reuse=<path|none> skipped=<…|none>
```

## Reviewer overbuild pass (after correctness)

Tags (one line each), same spirit as upstream `ponytail-review`:

- `delete:` dead / speculative — replacement: nothing
- `stdlib:` hand-rolled; name the built-in
- `native:` platform/Next/CSS/DB already covers it
- `yagni:` one-impl abstraction / unused config
- `shrink:` same logic, fewer lines

End overbuild section with `net: -<N> lines possible` or `Lean already.`
Correctness/security findings still own the verdict; overbuild alone is
Medium unless it adds a new dependency without `dependency_add`.

## Output (user report)

Keep Route3 ≤15 lines. Prefer:

`[what shipped] → skipped: [X], add when [Y].`

Unrequested design essays are debt.

## Explicitly do NOT import from upstream

- Caveman / ultra-terse **speech** toward the user (AZ UX copy stays clear)
- Always-on hooks / marketplace plugin (optional later; rules live here)
- Cutting tests on money/auth paths (Route3 still wants trap-exercising tests
  via `route3-test-engineer` when AC demands)
- Hardware calibration digressions (N/A for bugi-eshop)

## Related

Layered growth + established-product study: `product-engineering.md`.
