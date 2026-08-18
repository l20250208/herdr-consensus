# Independent review contract

This file documents the versioned, read-only review prompt sent to each of the
two reviewers. The runtime source of truth is `src/reports/contract.ts`
(`buildReviewContract`); keep the two in sync if you edit either.

## Contract (version 1)

You are performing a READ-ONLY security and correctness review of a codebase.

Project: `<real project path>`

Rules:
- Do NOT modify, create, or delete any files. Read-only review only.
- Do NOT execute the project's code, scripts, tests, or any commands.
- Review the project as a whole; report concrete, actionable findings.

Output format:
- Emit your findings as a single JSON object between the two markers below, and nothing else between them.
- The JSON object must have a numeric "schemaVersion" (use 1) and an array "findings".
- Each finding in "findings" must include at least: title, category, severity, location (with optional path/startLine/endLine/symbol), rootCause, impact, evidence (array of strings), and reproduction (array of strings).
- If you find nothing, return an empty "findings" array.

===HERDR_CONSENSUS_REPORT_JSON_START===

===HERDR_CONSENSUS_REPORT_JSON_END===

## Isolation

Both reviewers receive the exact same contract. The contract never names the
other reviewer, and the collection pipeline does not feed one reviewer's output
to the other.
