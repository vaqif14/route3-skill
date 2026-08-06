# Project profile — portable silent defaults

Fixes Bugi-hardcoding weakness. Silent defaults come from a **profile**,
not from assuming every repo is bugi-eshop.

Callers: `slim-v3-contract.md`; `clarify-then-execute.md`; boss INVESTIGATE.

## Load order

1. `.workflow/route3/PROJECT_PROFILE.md` in the **current workspace**
2. Else detect Bugi signals (`bugi.az`, `src/styles/globals.css` navy `#193666`,
   AGENTS.md "Bugi e-shop") → use built-in **bugi** profile below
3. Else use **generic** profile and grill D3/D5 brand/locale only if missing

Never invent a second brand system when a profile exists.

## Built-in: bugi

| Topic | Default |
|---|---|
| Locale / copy | AZ user-facing; AZ/RU/EN |
| Currency | AZN; no postal at checkout |
| Brand | navy `#193666` + turquoise (`globals.css`) |
| Density | Uzum/WB-class; VISUAL_DENSITY 7–8 |
| Empty UI | Hide stubs; no empty-state spam |
| Stack | Next App Router, Prisma/MySQL, better-auth, PashaPay |
| Surfaces | storefront / seller / admin |
| Builder | Codex → Kimi → native |

Log: `DEFAULTS_APPLIED: profile=bugi`

## Built-in: generic

| Topic | Default |
|---|---|
| Locale | Infer from repo i18n; else ask D3 once |
| Brand | Existing design tokens only; do not invent purple AI theme |
| Density | Match dominant in-repo UI |
| Stack | Detect from package.json / prisma / etc. |
| Builder | Codex → Kimi → native |

Log: `DEFAULTS_APPLIED: profile=generic`

## Workspace override file (optional)

Create `.workflow/route3/PROJECT_PROFILE.md`:

```markdown
# PROJECT_PROFILE
profile_id: <name>
locale: …
currency: …
brand_tokens: …
density: …
stack: …
surfaces: …
notes: …
```

Sticky user corrections → MEMANTO + this file when durable.
