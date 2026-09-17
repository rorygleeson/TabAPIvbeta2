# TAB Recap Regression Gates

## Scene planner contract regression gate

Before Step 10 is declared resilient, `lambda/scene-planner/index.test.js` and deployed AWS smoke tests must prove the planner boundary, not just JavaScript syntax.

CI regression coverage includes:

1. strict JSON and tolerated wrapper parsing;
2. malformed/truncated JSON rejection;
3. canonical word counting where standalone punctuation does not count as a word;
4. non-blank planner prose and schema unknown-field rejection;
5. one-bet minimum valid plan;
6. full 16-bet primary coverage plan;
7. missing, duplicated and reordered primary coverage rejection;
8. Scene 3 placement and replay eligibility rejection;
9. Scene 4 deterministic midpoint placement;
10. Scene 6/7 highlight eligibility;
11. word-limit, numeric/currency/percent and markup prose rejection;
12. aggregation of multiple deterministic prose failures;
13. field-scoped repair targeting so unrequested fields are immutable;
14. field repair response rejects unrequested/duplicate targets;
15. canonical prompt includes untrusted-data, hard-preflight and conservative word-target rules;
16. one-extra-LLM-call policy and repair-failure logging remain present;
17. canonical root contracts and builder-bundled contract copies remain byte-for-byte identical.

Runtime planner policy:

- Initial generation is validated before storage.
- At most one additional LLM call is allowed per planning attempt.
- Parse failure consumes that one-call budget for one complete regeneration.
- Prose-only deterministic failures use field-scoped repair and cannot rewrite the rest of the plan.
- Schema/structural/coverage/eligibility failures use one whole-plan repair.
- Every repaired/regenerated plan is fully validated again.
- A second failure is terminal and the job is marked `FAILED`.
- LLM prose may not restate numeric betting facts; factual numeric display belongs to the deterministic builder.

Deployed Step 10 resilience tests remain separate in `tests/manual-cli-tests.md` and cover the actual AWS state/SQS/idempotency/DLQ paths.

## Recap builder regression gate

Before `recap-builder.js` is declared production-ready it MUST pass these deterministic fixtures.

1. `current-16-bet` — mixed WIN/LOSS/PLACE, four eligible replays, exact 50% Scene 4 checkpoint, positive finish.
2. `all-loss` — no winner-dependent Scene 6/7 highlights allowed; negative finale.
3. `all-win` — no losing-streak highlight allowed; positive finale.
4. `single-bet` — minimum valid recap is Scene1 + Scene2 + Scene6 + Scene7; optional replay may make five.
5. `break-even` — zero P&L classes and breakEvenFinale.
6. `scene5-two-race` — exactly two consecutive primary sequences and 8000ms duration.
7. `scene5-three-race` — exactly three consecutive primary sequences and 9500ms duration.
8. `midpoint-with-replay` — Scene4 checkpoint selected at Scene2 boundary but rendered after attached Scene3.
9. `replay-media-failure` — runtime restores music and advances; recap never stalls.
10. `invalid-input-pnl` — reject when profitLoss != return-stake or runningPnl/summary totals disagree.
11. `invalid-plan-coverage` — reject missing, duplicated or reordered primary bet sequences.
12. `invalid-plan-fields` — reject planner-supplied factual/derived/runtime fields and unknown fields.
13. `invalid-plan-numeric-prose` — reject digits/currency/percent content inside LLM-owned prose.
14. `invalid-plan-markup-prose` — reject angle-bracket markup inside LLM-owned prose.
15. `canonical-word-count` — builder uses the same Unicode token rule as the scene planner.

Builder success gate also verifies all seven templates have exactly one production CSS marker pair and markup marker pair, numeric scene type IDs, no production hardcoded `is-active`, no production soundtrack ownership, and no `crossorigin=anonymous` on replay video.
