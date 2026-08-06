# NotebookLM research → clarify → execute

Callers: `SKILL.md` (NotebookLM / NBLM signals); `clarify-then-execute.md`;
agent `route3-notebooklm-expert`.

## When

Dispatch **before** BUILD when any of:

- User says NotebookLM / notebooklm / NBLM / "notebookdan"
- User pastes `notebooklm.google.com/notebook/...` URL
- Task clearly belongs to a library notebook (docs vault, product rules pack)
- Boss decides sources should ground clarify (domain-heavy slice)

## Boss steps

```
1. Dispatch route3-notebooklm-expert with task + optional notebook URL
2. Agent: health → auth → select notebook → multi-pass ask → clarify package
3. Merge NBLM dims into PLAN CLARIFY_COVERAGE (map nblm_answered → answered)
4. Ask user only OPEN_USER_QUESTIONS
5. On confirm → check-preflight.sh → route-slice.sh → BUILD (normal spine)
```

Do **not** skip preflight because NotebookLM answered. Same Done means.

## Preferred: `nlm` (Gemini Notebook API)

```bash
nlm login --check
nlm notebook list
nlm notebook query <id> "…" -j
```

Gemini CLI: MCP server `gemini-notebook-mcp` in `~/.gemini/settings.json`.

## MCP (browser fallback)

Server: `user-notebooklm`. If `server_health.authenticated=false` → agent runs
`auth_setup`; user finishes Google login in the browser.

## PLAN tokens

```text
NBLM: notebook=<id> session=<id> used=yes
CLARIFY_COVERAGE: … (dims filled from NBLM + user)
```

## Anti-patterns

- Building from notebook guesses without citations
- Ignoring repo CONFLICT flags
- Burning daily query quota on shallow one-shot asks
- Treating NotebookLM as a substitute for reviewer / security-auditor
