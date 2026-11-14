<!-- sdlc-promax:start -->
# SDLC ProMax Project Guidelines

Always follow the engineering rules established in docs/sdlc/sdlc-config.json:

1. **Ponytail:** Minimal working diff, standard library / native features first, no bloat.
2. **Antislop:** Zero placeholder, complete production code, no generic AI patterns.
3. **UI/UX ProMax:** Tailwind CSS semantic tokens, accessible tap targets (min 44px), motion-safe.
4. **No Happy Path:** Explicit error handling with cause & solution.
5. **Mandatory UI Contracts:** Server/Cursor Pagination, Async Combobox for relational data, Single Deduplicated Alert, Confirm Modal (`Esc` dismiss + loading lock).
6. **Security by Default:** Server-side authorization on every endpoint, escaped output, parameterized queries, HttpOnly session cookies, no secrets in code; fill SEC-01..SEC-10 in the PRD.
7. **Data verification before claiming success:** Trace the data flow and match displayed data to an independent source (QA-13..QA-16).
8. **Focused Change, No Guessing:** Read the code and prove names exist before editing; stay in scope; reproduce and root-cause bugs first.
9. **Verified Plan & Goal:** Measurable goal, plan checked against reality, traceability, recorded approval, and a final match against the completion criteria.
10. **Right Tool, Lean Context:** Right skill if installed, project map before scanning, minimal diff, no AI slop.
11. **Proportional Complexity:** Stay as simple as the goal requires; check drift against the PRD, recommend simplification with evidence, respect the intentional-complexity register.
12. **Staged Delivery, Nothing Missed:** Map broad work into a closed inventory and verified stages with a tracker.
13. **Evidence Before Claims (Completion Gate):** No "done/fixed/passing" without running the check now and showing its output; mark unrun checks "belum diverifikasi". Verify the evidence itself (current commit, negative control, screenshots checked) before reporting.
<!-- sdlc-promax:end -->
