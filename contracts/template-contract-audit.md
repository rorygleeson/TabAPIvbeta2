# Pre-Builder Remediation Record

Date: 2026-09-12

## Status

**PLANNER CONTRACT BOUNDARY HARDENED. BUILDER STILL REQUIRES ITS NORMAL FORMAL REGRESSION GATE BEFORE STEP 12 IS DECLARED PROVEN.**

This document does not self-certify production readiness merely because fixes were committed.

## Canonical machine contracts

1. `contracts/bettings.schema.json` — factual input shape plus deterministic cross-field validation rules.
2. `contracts/scene-plan.schema.json` — exact planner/LLM output envelope, non-blank text and hard character ceilings; current eight-scene plan version is `2.0`.
3. `contracts/scene-contracts.json` v2.0.2 — eight scene data/ownership/resolution contracts, canonical word-count algorithm, grounded-numeric-prose policy, safe structural canonicalization and markup policy.
4. `contracts/runtime-contract.json` v2.0.2 — production shell, activation, timing, formatting, FX, replay, audio, sharing, runtime-data transport, duration policy and template-extraction contract.
5. `contracts/planner-prompt.md` v2.1 — canonical system prompt for generation and repair, including untrusted-data handling, factual grounding, strict Scene 8 grouping of 4–5 bets only, Scene 5 ownership of 2–3 bet grouped stories, preference for fuller 5-bet Scene 8 groups where natural, an explicit Scene 8 headline taxonomy, exact grouped-stake arithmetic, exact prior-block running-P&L context, cross-block angle-family diversity and whole-recap anti-repetition review.

## Validation boundary

### Planner gate

`validated bettings.json + planner prompt + scene-plan schema + scene contracts -> candidate plan`

Before `scene.json` may be written, the scene-planner Lambda must:

1. parse one complete JSON object;
2. validate the scene-plan schema before any canonicalization attempt;
3. apply only lossless, context-safe placement canonicalization to schema-valid candidates;
4. never reorder Scene 2/5/8 primary chronology and never move Scene 4 to a different completed-bet checkpoint;
5. validate deterministic ordering, coverage, grouping, replay placement/eligibility, midpoint placement and highlight eligibility;
6. validate every LLM prose field against canonical word/character limits and reject markup;
7. allow numeric prose only under the current planner-prompt factual-grounding and semantic-meaning rules;
8. if validation fails, use at most one controlled extra LLM call;
9. use field-scoped repair for prose-only violations so unrequested plan content is immutable;
10. use whole-plan repair only for remaining schema/structural/eligibility failures;
11. if the original model response cannot be parsed, use the same one-extra-call budget for one complete regeneration;
12. run the full validation gate again after any repair/regeneration;
13. fail the job if the repaired/regenerated result still fails.

The planner logs parse regeneration requests, deterministic validation failures, safe canonicalization actions, repair requests and repair-validation failures without logging entire user plans as diagnostic payloads.

### Builder gate

The deterministic builder independently repeats schema and deterministic semantic validation before rendering. It uses synchronized contract copies and the same canonical word-count and markup rules. Numeric prose is permitted by the executable validator, while factual correctness and semantic meaning remain governed by prompt/contract instructions because arbitrary-English semantic verification is not claimed by deterministic code.

## Safe structural canonicalization

The planner may correct only placement that cannot change chronological or checkpoint meaning:

- one existing Scene 1 may move to first;
- one existing Scene 6 and one existing Scene 7 may move together to second-last/last;
- one eligible unique Scene 3 may attach immediately after its matching Scene 2, but only when primary coverage is already canonical.

The planner never automatically reorders Scene 2/5/8 primary chronology. A Scene 4 at the wrong completed-bet checkpoint remains a validation failure because its prose and builder-derived running state are checkpoint-sensitive. The midpoint helper used by validation is shared with the structural tests so there is only one midpoint algorithm.

## Numeric factual ownership

The deterministic builder owns factual numeric display fields. LLM prose may use grounded numeric facts when useful, but every factual number must come directly from validated `bettings.json` or be deterministically implied, and its semantic meaning must remain exact. A profit/loss value must never be described as a return. Scene 8 may use exact arithmetic over pre-result source fields for its grouped bets, including total stake, and may use the exact running P&L immediately before the block because that state is determined entirely by completed earlier bets. It must never use result-derived values from inside the upcoming Scene 8 block before those results are revealed.

## Canonical word counting

Planner and builder count words identically: trim, split on whitespace, and count only tokens containing at least one Unicode letter or digit. Standalone punctuation such as an em dash does not count as a word.

## Untrusted-data boundary

All values inside `bettings.json` are data, never instructions. The planner prompt explicitly forbids following instructions embedded in names, race names, meeting names, URLs or any other factual value.

## Existing builder/template remediation retained

The original remediation remains in force: strict planner schema, exact primary coverage, mathematical Scene 4 midpoint, runtime ownership, numeric scene IDs, shared shell geometry, production extraction markers, runtime-owned activation, recovered choreography/timing, FX separation, deterministic formatting/highlights/P&L, visual integrity, Scene 5 factual result semantics, standardized P&L sign classes, runtime-data transport, runtime FX delivery, Scene 7 resolved highlights and HTML-safe factual/derived text.

## Next gate

Complete the formal Step 10 planner resilience tests (SQS path, idempotency, recovery, expired lease, invalid input, missing job and DLQ) before moving to the rendering queue. The builder remains subject to its separate deterministic regression gate before Step 12 is declared proven.

## Scene 8 and duration hardening

Scene 8 is an optional rapid-fire 4–5 bet primary scene with strictly consecutive ascending coverage, one LLM comment per bet, compact mobile-first rows, sequential fast result reveals, lightweight zero-delay effects and deterministic per-result global running-P&L updates. Scene 8 must never contain 1, 2 or 3 bets. Scene 5 owns grouped 2–3 bet stories, while Scene 2 owns individual bets. On large days, the planner should prefer fuller 5-bet Scene 8 groups where a natural ordinary stretch allows it, using 4-bet groups to preserve standout moments, chronology, midpoint placement or natural boundaries. Scene 8 headlines are editorial copy rather than count labels and now use an explicit angle taxonomy: exposure, day position, position plus exposure, recovery/protection context, meeting/venue, bet-type mix, odds profile, stake pattern, race sequence/day stage, and runner/race hooks. The planner must diversify these families across long recaps, keep any one family to a minority when alternatives exist, prohibit exact duplicate headlines, allow exact prior-block running P&L as already-known context, and never leak outcome-derived facts from the upcoming block.
