# TAB Recap Regression Gates

Last updated: 2026-09-18

This document describes the current Kubrick V2 regression boundary.

## 1. Planner architecture under test

Current flow:

```text
bettings.json
  -> deterministic scene plan
  -> compact grounded copy payload
  -> exactly one Bedrock copy call
  -> copy validation
       -> valid copy: merge
       -> copy-stage failure: deterministic fallback
  -> final scene.json
  -> existing Builder
```

The LLM is a copywriter only. It does not plan scene structure.

There is no structural repair loop and no second LLM call.

## 2. Hard planner regression requirements

Automated tests must continue to prove:

1. canonical bettings input validation;
2. contiguous chronological bet sequence;
3. deterministic Scene 1 / 6 / 7 placement;
4. exact primary bet coverage exactly once and in order;
5. Scene 2 single-bet ownership;
6. Scene 3 replay eligibility and immediate placement after matching Scene 2;
7. Scene 4 deterministic midpoint placement;
8. Scene 5 legal 2-3 bet grouping;
9. Scene 8 legal 4-5 bet grouping where enabled;
10. deterministic replay count/ranking policy;
11. hard runtime duration maximum;
12. stable deterministic structure for identical input;
13. grounded copy response shape and fact-ID scope;
14. invalid copy response falls back instead of killing a structurally valid recap;
15. final scene-plan schema validation;
16. canonical root contracts and Builder-bundled copies remain synchronized where mirrored.

Copy grammar, capitalization, repetition and prose-length targets are not hard availability gates.

## 3. Copy availability regression

The planner makes at most one Bedrock copy call.

These copy-stage failures must use deterministic fallback copy:

- Bedrock invocation error;
- malformed/unparseable model output;
- invalid copy response;
- missing/unusable required copy.

Fallback must not alter deterministic scene structure.

No test should reintroduce a second model call, field repair call, whole-plan repair call or semantic prose validator.

## 4. Current representative fixtures

Current fixtures:

```text
tests/fixtures/bettings-5.json
tests/fixtures/bettings-8.json
tests/fixtures/bettings-16.json
tests/fixtures/bettings-32.json
tests/fixtures/bettings-50.json
tests/fixtures/bettings-75.json
tests/fixtures/bettings-baseline.json
```

5 / 8 / 32 / 50 / 75 use the new real-race master data set.

16 and baseline remain the retained older baseline fixture.

The 75-bet fixture deliberately contains two missing replay URLs:

```text
sequence 74 -> replayUrl = null
sequence 75 -> replayUrl = null
```

This is intentional regression coverage.

## 5. Latest deployed direct planner proof

On 2026-09-18 the deployed planner reached `RENDERING` for:

| Bets | Scene count | Fixture | Result |
|---:|---:|---|---|
| 5 | 8 | new real-data | PASS |
| 8 | 11 | new real-data | PASS |
| 16 | 16 | retained older fixture | PASS |
| 32 | 20 | new real-data | PASS |
| 50 | 25 | new real-data | PASS |
| 75 | 27 | new real-data + two null replay URLs | PASS |

These tests prove the current planner boundary across small, medium and large recaps.

They do not certify prose perfection.

## 6. Current copy-quality status

Observed copy can still contain awkward wording such as:

```text
The block lost $45.
profit for the day day.
Backed 8 backed runners won their races.
delivered The bet made $2800 profit.
```

These are copy-quality defects, not structural defects.

Preferred remediation is a small prompt-only wording refinement.

Do not add hard grammar/semantic validators or another model call.

## 7. Builder regression boundary

The existing Builder remains downstream-compatible.

Builder regression should continue to prove:

- accepted `scene.json` renders without planner-specific restructuring;
- factual values come from validated input/plan;
- replay scenes use supplied replay URLs;
- missing replay media does not stall the recap;
- Scene 5 and Scene 8 grouped scenes render correctly;
- Scene 4 renders at the supplied checkpoint;
- Scene 6/7 final state renders correctly;
- display substitutions are escaped safely;
- rendered HTML remains functional.

## 8. Manual AWS tests

Deployed-AWS smoke procedures and historical resilience evidence live in:

```text
tests/manual-cli-tests.md
```

The helper:

```cmd
tests\tools\run-planner-test.cmd <size>
```

directly invokes the planner and proves the job reaches `RENDERING`.

It does not automatically send the rendering SQS message.
