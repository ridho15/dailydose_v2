<!-- sdlc-promax:start -->
# SDLC ProMax Agent Instructions

Before planning or writing code, read and follow:

- Project config: docs/sdlc/sdlc-config.json
- Master SDLC skill: .agent/skills/app-setup-blueprint-promax/SKILL.md
- Reference UI components: docs/sdlc/ui-standards-reference
- PRD / QA / UAT templates: docs/sdlc/templates
- Brownfield Audit & Architecture (Graphify): docs/sdlc/00-BROWNFIELD-AUDIT.md

## Mandatory Delivery & Verification Rules

- **Evidence before claims:** Run the verification command directly and show real output before claiming done/fixed/passing; report failures as they are and mark unrun checks "belum diverifikasi"; a QA/UAT row needs a filled Bukti cell to count as passed.
- **Verify the evidence before reporting (Evidence Verification Gate):** Evidence from the current commit, screenshots/traces opened and checked, a negative control proving each new test can fail, complete counts, and an independent reviewer for security/money/personal-data items.
- **Data verification:** A test only counts as passed after the data flow (input -> saved -> displayed -> exported) is traced and displayed values are matched to an independent source; QA-13..QA-16 need evidence.
- **Focused change:** Stay inside the agreed scope, read before editing, never invent names (functions, tables, columns, routes), reproduce bugs and write a failing regression test first, and report what was read/changed/untouched/assumed.
- **Plan & goal verification:** Reject vague goals, verify the plan against the real code/data/versions, keep a requirement-to-test traceability matrix, record approvals, stop and re-approve when the plan changes, and compare the final result with the completion criteria.
- **Right tool, lean context:** Use the project map first, open only relevant files, prefer the smallest diff, no unrequested files/dependencies/comments/dead code, and report which skills were used or unavailable.
- **Proportional complexity:** Do not add layers, services, abstractions or features the goal does not need; intentional complexity recorded by the developer stays; simplifications are recommended first and finished completely (no leftover old code or temporary adapters).
- **Broad work:** Map every item from evidence, decompose into verified stages, and never leave an item without a stage or a recorded decision.
- **Security by default:** Server-side authorization on every endpoint, escaped output, parameterized queries, HttpOnly session cookies, no secrets in code, and the SEC-01..SEC-10 checklist per module.
- **Completion Gate (Zero Unverified Claims):** Do NOT claim any feature, bugfix, command, script, or user instruction works or is finished until you have directly executed it after your final edit and attached concrete observed evidence (command output, DB state check, test counts, and Playwright screenshots). Never recommend unexecuted CLI commands as verified.
<!-- sdlc-promax:end -->
