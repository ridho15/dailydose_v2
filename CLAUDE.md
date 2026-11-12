# SDLC ProMax Project Guidelines

Always follow the engineering rules established in docs/sdlc/sdlc-config.json:

1. Ponytail: minimal working diff, no bloat.
2. Antislop: zero placeholder, complete production code.
3. UI/UX ProMax: Tailwind CSS semantic tokens.
4. No Happy Path: explicit error handling with cause & solution.
5. Mandatory UI Contracts: Server/Cursor Pagination, Async Combobox (relational data), Single Deduplicated Alert, Confirm Modal (`Esc` dismiss + loading lock).
6. Completion Gate: Never claim completion or recommend commands as verified until directly executed after final edits with observed evidence (logs, DB state, screenshots).
