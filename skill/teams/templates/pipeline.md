# Pipeline — initiative tracker

One row per initiative. Status: IDEA → VALIDATING → BUILDING → LIVE → SCALE / KILLED / PAUSED.

| ID | Initiative | Stage | Owner agent | Evidence grade | Next gate | Kill criterion | Updated |
|----|-----------|-------|-------------|----------------|-----------|----------------|---------|
| S-001 | <slug> | IDEA | — | UNKNOWN | G0 | <condition that kills this> | YYYY-MM-DD |

Rules: every row has a kill criterion BEFORE work starts; evidence grade = VALIDATED / HYPOTHESIS / UNKNOWN; gate column names the next owner-approval.
