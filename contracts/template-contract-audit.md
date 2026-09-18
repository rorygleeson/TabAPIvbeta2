# Builder / Contract Compatibility Audit — Kubrick V2

Last updated: 2026-09-18

## Status

The Builder remains the downstream compatibility boundary for Kubrick V2.

This document supersedes the older pre-builder remediation record that described the vbeta1 LLM planner, copy repair calls and prose hard-fail rules.

Those old planner behaviours are not part of Kubrick V2.

## Canonical contracts

Root contracts:

1. `contracts/bettings.schema.json` — canonical factual input.
2. `contracts/deterministic-scene-plan.schema.json` — deterministic scene skeleton artifact.
3. `contracts/scene-plan.schema.json` — final `scene.json` contract.
4. `contracts/scene-contracts.json` — Scene Types 1-8 ownership/resolution rules.
5. `contracts/runtime-contract.json` — timing/runtime/rendering contract.
6. `contracts/planner-prompt.md` — current one-call grounded copy prompt.

Builder-bundled contract copies live under:

```text
lambda/builder-recap/contracts/
```

The CI/deploy process must keep canonical root contracts and bundled copies synchronized where both are used.

## Kubrick V2 ownership boundary

```text
bettings.json
-> deterministic planner structure
-> one grounded LLM copy call
-> deterministic fallback if copy stage fails
-> final scene.json
-> existing Builder
```

The Builder does not perform structural planning or copy repair.

## Planner gate

Before `scene.json` is accepted, the planner owns objective validation of:

- canonical input schema and semantic arithmetic;
- exact primary coverage;
- chronology;
- legal Scene 2/5/8 membership;
- Scene 3 replay eligibility and immediate placement;
- Scene 4 legal midpoint boundary;
- fixed Scene 1/6/7 positioning;
- copy response shape;
- required copy fields;
- enum/cardinality;
- grounded fact IDs and phase scope;
- final scene-plan schema.

The planner does not hard-reject copy merely because it has awkward grammar, repeated wording, capitalization issues or poor sentence joins.

## Copy availability boundary

Kubrick V2 makes at most one Bedrock copy call.

On copy-stage failure:

```text
Bedrock failure
OR parse failure
OR copy-response validation failure
        |
        v
deterministic safe fallback copy
        |
        v
same deterministic scene skeleton
```

There is no repair call and no second model call.

Fallback implementation:

```text
lambda/scene-planner/llm-copy-fallback.js
```

## Builder gate

The Builder independently protects rendering compatibility.

Current design principles:

- Builder consumes final `scene.json` and canonical `bettings.json`;
- Builder must not invent scene membership or reorder coverage;
- factual display values resolve from canonical data/controlled scene references;
- narrative copy is treated as display text, not trusted structural control;
- display substitutions are HTML-escaped;
- replay runtime behaviour belongs to the Builder/runtime;
- missing replay availability is represented upstream by null/invalid `replayUrl` and therefore should not be selected into Scene 3.

## Scene template set

Current production templates:

```text
scene-1-opening-pre-race-template.html
scene-2-single-race-card-template.html
scene-3-race-replay-template.html
scene-4-status-story-summary-template.html
scene-5-multi-race-scene-template.html
scene-6-daily-summary-template.html
scene-7-final-share-template.html
scene-8-fast-results-template.html
```

Kubrick V2 preserves Scene Types 1-8.

No template redesign is required merely because planner implementation changed.

## Runtime timing authority

Physical scene timing remains owned by `runtime-contract.json`.

The planner reads the runtime contract for duration calculation rather than duplicating physical timing constants as structural truth.

Editorial target duration is owned separately by `planner-policy.js`.

This separation is intentional:

```text
runtime-contract.json -> physical scene timing
planner-policy.js     -> editorial target curve / selection policy
```

## Current planner policy compatibility

Current deterministic structural rules include:

- Scene 8 only for recaps with 17+ bets;
- Scene 5 covers 2-3 consecutive bets;
- Scene 8 covers 4-5 consecutive bets;
- Scene 3 only for a selected winning bet with valid HTTPS replay media;
- Scene 3 immediately follows matching Scene 2;
- Scene 4 is nearest legal primary boundary to 50% coverage for 6+ bets;
- Scene 6 is second-last;
- Scene 7 is last;
- hard runtime maximum is 300 seconds.

See `KUBRICK-ARCHITECTURE-GUIDE.md` for the authoritative complete policy.

## Copy protocol compatibility

Current Bedrock copy protocol:

```text
FACT_PARTS_COMPACT_V1
modelPayloadVersion = 1.0
```

The rich copy input remains internal for validation/merge.

The compact payload is what is sent to the model.

This is required for large-day payload size control.

## Current real-data regression state

Planner direct tests have reached `RENDERING` for:

```text
5
8
16
32
50
75
```

The 5 / 8 / 32 / 50 / 75 fixtures use the new real-race dataset.

The 75 fixture includes two deliberate null replay URLs.

The Builder boundary should continue to be tested against these fixtures when rendering changes are made.

## Copy-quality boundary

Examples such as:

```text
The block lost $45.
profit for the day day.
delivered The bet made $2800 profit.
```

are copy-quality defects.

They are not evidence that the Builder or deterministic planner contract is wrong.

Do not solve them by:

- adding a second LLM call;
- restoring field repair;
- restoring whole-plan repair;
- adding grammar/capitalization validators;
- adding numeric prose bans;
- moving editorial planning into the Builder.

Preferred first treatment is a small prompt-only wording improvement.

## Change-control rule

A change that affects structure, scene ownership, canonical facts, replay semantics or runtime timing must update the relevant canonical contract/document at the same time.

A copy-style-only prompt change should not require structural contract changes.

Before modifying Builder behaviour:

1. prove a real downstream compatibility defect;
2. make the smallest change;
3. run focused Builder tests;
4. run planner regression if scene contract assumptions changed;
5. do not use Builder changes to hide planner architecture problems.
