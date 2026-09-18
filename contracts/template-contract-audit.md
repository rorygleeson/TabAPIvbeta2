# Template / Contract Audit — Kubrick V2

Last updated: 2026-09-18

## Status

**CURRENT V2 BOUNDARY DOCUMENT**

This record replaces the earlier pre-Builder remediation notes that described the old LLM-plans-structure / repair-loop architecture.

The current rule is:

> deterministic code owns structure; the LLM owns copy only; the existing Builder consumes the final validated scene plan.

## Canonical contracts

Root contracts:

1. `contracts/bettings.schema.json` — canonical factual input shape plus documented semantic validation rules.
2. `contracts/deterministic-scene-plan.schema.json` — deterministic pre-copy scene skeleton artifact.
3. `contracts/scene-plan.schema.json` — final downstream `scene.json` planVersion 2.0 contract.
4. `contracts/scene-contracts.json` — scene ownership/data-resolution contract.
5. `contracts/runtime-contract.json` — runtime timing, replay, transition, shell and rendering behaviour.
6. `contracts/planner-prompt.md` — the current grounded copy prompt used by the one Bedrock copy call.

Builder-bundled contract copies remain synchronized where the deploy package expects local copies.

## Current ownership boundary

### Canonical bettings input

`bettings.json` supplies factual day/bet state.

The planner input no longer contains:

```text
sceneType
showReplay
```

Replay availability is represented only by `replayUrl`.

### Deterministic Scene Planner

Code owns:

- scene order;
- primary coverage;
- Scene 2 promotion;
- Scene 3 replay selection and placement;
- Scene 4 midpoint;
- Scene 5 grouping;
- Scene 8 grouping;
- duration candidate selection;
- Scene 6/7 ending positions.

The model cannot alter these decisions.

### LLM copy layer

One Bedrock call receives a compact grounded copy payload using:

```text
FACT_PARTS_COMPACT_V1
modelPayloadVersion = 1.0
```

The model returns requested copy fields only.

No structural repair call exists.

No second model call exists.

### Copy fallback

Copy-stage failure is non-fatal to an otherwise valid recap.

The planner uses:

```text
lambda/scene-planner/llm-copy-fallback.js
```

for deterministic safe copy when Bedrock/parsing/copy validation fails.

The deterministic scene skeleton is preserved.

### Existing Builder

The Builder receives final validated `bettings.json` + `scene.json`.

It does not:

- plan scenes;
- select replay bets;
- move midpoint;
- repair LLM structure;
- interpret planner policy.

It renders the supplied contract through the existing templates/runtime.

## Validation boundary

Hard failures remain appropriate for objective machine-verifiable conditions:

- invalid canonical bettings schema/semantics;
- missing, duplicated or reordered primary coverage;
- illegal Scene 3 placement or replay eligibility;
- illegal grouped scene membership;
- invalid deterministic midpoint;
- hard runtime duration maximum;
- malformed copy response;
- missing required copy fields;
- unknown/out-of-scope fact IDs;
- invalid enums/cardinality;
- invalid final `scene.json` contract;
- S3/Dynamo/runtime failures.

Narrative quality is intentionally not a hard availability gate.

Do **not** hard-fail for:

- grammar;
- capitalization;
- repeated phrases;
- prose-length target overshoot;
- awkward fact/text joins;
- internal terminology such as “block” leaking into copy;
- semantic quality that deterministic JavaScript cannot safely prove.

The Builder HTML-escapes display substitutions.

## Scene/template expectations

### Scene 1

- always first;
- opening copy only;
- no primary bet coverage.

### Scene 2

- one deterministic featured bet;
- copy may provide tension/reaction.

### Scene 3

- optional replay;
- only for a replay-eligible winning bet;
- immediately follows matching Scene 2;
- replay URL comes from canonical factual input.

### Scene 4

- at most once;
- omitted for recaps below the configured minimum;
- checkpoint boundary supplied by deterministic planner.

### Scene 5

- covers 2 or 3 consecutive primary bets;
- grouping is structural;
- customer copy should not expose internal planner vocabulary such as “block”.

### Scene 6

- always second-last;
- daily summary/standout wording only;
- factual highlight identity remains controlled by contract/planner facts.

### Scene 7

- always last;
- final/share copy;
- untimed/permanent ending in runtime.

### Scene 8

- high-volume compression;
- covers 4 or 5 consecutive primary bets;
- one comment per covered bet;
- grouping/order cannot be changed by copy.

## Current runtime/template source

Existing templates remain under:

```text
lambda/builder-recap/templates/
```

Runtime remains under:

```text
lambda/builder-recap/runtime/
```

The Kubrick V2 migration does not redesign them.

## Current real-data regression state

New real-race fixtures:

```text
bettings-5.json
bettings-8.json
bettings-32.json
bettings-50.json
bettings-75.json
```

Retained older fixture:

```text
bettings-16.json
bettings-baseline.json
```

The 75-bet fixture intentionally contains two `null` replay URLs.

Deployed direct planner tests on 2026-09-18 reached `RENDERING` for:

```text
5 bets  -> 8 scenes
8 bets  -> 11 scenes
16 bets -> 16 scenes
32 bets -> 20 scenes
50 bets -> 25 scenes
75 bets -> 27 scenes
```

This proves the current planner-to-final-plan contract boundary at those sizes.

## Current outstanding quality item

Generated copy is structurally safe but can still be stylistically rough.

Observed examples include:

```text
The block lost $45.
profit for the day day.
Backed 8 backed runners won their races.
delivered The bet made $2800 profit.
```

The first remediation, if approved, should be prompt-only and should focus on natural sentence joining, avoiding duplicated phrases and keeping internal architecture vocabulary out of customer-facing copy.

No contract or Builder redesign is justified by these examples.

## Change control

Before changing contracts/templates:

1. inspect current repo state;
2. identify whether the issue is factual, structural, copy-quality or rendering;
3. change the owning layer only;
4. make one controlled change;
5. run focused regression;
6. verify no downstream ownership moved accidentally.

For copy-quality issues, do not “solve” them by adding hard validators, repair loops or extra model calls.
