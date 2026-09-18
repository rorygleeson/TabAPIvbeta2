# Kubrick V2 Migration

Last updated: 2026-09-18

## Objective

Rewrite only the Kubrick / Scene Planner implementation while preserving the proven downstream Daily Recap system.

The migration is intentionally narrow:

```text
TabAPIvbeta2 = TabAPIvbeta1
MINUS old Kubrick implementation
PLUS new deterministic Kubrick implementation
PLUS minimal bettings.json cleanup
```

The existing Builder, renderer, templates, runtime assets, scene contract boundary, S3/SQS/DynamoDB architecture and AWS resources remain in place.

## Frozen working baseline

Reference repository:

```text
rorygleeson/TabAPIvbeta1
```

Known working source baseline:

```text
deploy @ 949a2d421851a666a9285c46a1c962143a8ab37c
```

`TabAPIvbeta1` remains the frozen working reference and fallback source during the migration.

## AWS migration rule

V2 reuses the exact existing AWS environment.

Do not create parallel vbeta2 infrastructure unless explicitly approved later.

Existing resources remain authoritative, including:

```text
tab-recap-vbeta1
tab-recap-vbeta1-jobs
tab-recap-vbeta1-planning
tab-recap-vbeta1-planning-dlq
tab-recap-vbeta1-rendering
tab-recap-vbeta1-rendering-dlq
tab-recap-vbeta1-scene-planner
tab-recap-vbeta1-builder-recap
```

The migration changes source ownership and planner implementation, not infrastructure topology.

## Scope

### In scope

- New `lambda/scene-planner` implementation
- Deterministic scene-structure engine
- One LLM copy-generation/enhancement pass
- Planner-specific tests
- Planner-specific CI/deploy packaging as the new implementation is introduced
- Minimal `bettings.json` schema cleanup

### Out of scope

Do not redesign or refactor these as part of Kubrick V2:

- Builder behaviour
- `lambda/builder-recap`
- HTML templates
- runtime JavaScript/CSS
- rendering behaviour
- S3 object model
- DynamoDB job-state model
- Planning SQS / Rendering SQS topology
- API Gateway / Orchestrator work
- CSV Normalizer implementation
- unrelated infrastructure

If a downstream change is later proven necessary for compatibility, it must be small, explicit and separately justified.

## Primary compatibility rule

The existing Builder must not need to understand that Kubrick was rewritten.

Kubrick V2 must emit the same downstream `scene.json` contract expected by the existing Builder.

The stable boundary remains:

```text
bettings.json
-> Kubrick V2
-> scene.json
-> existing Builder
-> recap HTML
```

## `bettings.json` decision

Treat the current canonical `bettings.json` as locked except for two agreed removals:

```text
REMOVE: sceneType
REMOVE: showReplay
```

Keep the remaining factual and convenience fields, including:

```text
profitLoss
runningPnl
summary
replayUrl
```

Do not remove additional fields merely because they are derivable.

### Replay semantics

`replayUrl` stays.

V2 semantics:

```text
valid replayUrl present -> replay media is available
replayUrl absent/null/invalid -> replay unavailable
```

`showReplay` is removed because replay selection is a planner decision, not an input instruction.

## Kubrick V2 ownership model

### Code owns structure

The LLM does not decide the scene structure.

Deterministic Kubrick code owns:

- Scene 1 position
- which bets receive Scene 2 treatment
- replay selection
- Scene 3 placement immediately after its matching Scene 2
- Scene 4 placement
- Scene 5 grouping policy
- Scene 8 grouping/compression policy
- chronological ordering
- exact bet coverage
- duration calculation
- duration-target decisions
- fixed ending structure
- factual / derived / controlled fields

### LLM owns copy only

After deterministic structure is complete, Kubrick makes one LLM call for fields explicitly owned by the LLM, such as:

- opening copy
- headlines
- comments
- narrative/context lines
- midpoint wording
- verdict wording
- share/final copy

The LLM must not be asked to repair or invent structural decisions.

## Target Kubrick flow

```text
bettings.json
    |
    v
validate factual input
    |
    v
derive planning facts
    |
    v
DETERMINISTIC STRUCTURE ENGINE
    |
    +-- choose scene mix
    +-- choose standout bets
    +-- choose replays
    +-- group routine bets
    +-- place midpoint
    +-- calculate duration
    +-- guarantee chronology / coverage
    |
    v
ordered scene skeleton
    |
    v
ONE LLM CALL FOR COPY ONLY
    |
    v
validate + expand FACT_PARTS_V2_2 fact/text parts against the shared chronological fact scope
    |
    v
merge LLM copy into code-owned skeleton
    |
    v
final contract validation
    |
    v
scene.json
    |
    v
EXISTING BUILDER
```

## Contracts

Contracts remain the source of truth for the software, not promises that the LLM is expected to implement structurally.

Mental model:

```text
FACT / DERIVED / PLANNER_DERIVED / CONTROLLED -> software
LLM                                              -> copy only
```

The key principle is:

> The LLM does not implement the contract. The software implements the contract.

Fresh Kubrick V2 copy uses a grounded-copy boundary: deterministic code compiles stable day/bet facts into one recap-wide catalog and computes the allowed fact IDs for every scene phase from chronology. The LLM and validator consume that same scope, so a fact seen elsewhere in the one-call recap can be reused only when it is valid at the target point in time. Scene-local aggregate atoms remain local. Short inline facts may compose with narrative text, while complete factual clauses stand as sentence segments. This adds no additional LLM calls and does not change the downstream Builder contract.

## Scene policy still to define before coding

Do not rush into implementation until the deterministic structure policy is documented clearly enough to explain without code.

Still to lock:

- bet-count bands
- duration target policy by bet count
- Scene 2 promotion/ranking policy
- Scene 5 usage policy
- Scene 8 packing/compression policy
- replay count policy
- replay ranking policy
- Scene 4 midpoint algorithm details
- deterministic adjustment policy when planned duration is below or above target

The policy should be generic and fixture-independent.

## Runtime timing baseline

Current runtime-contract timings are the baseline unless intentionally changed later:

```text
Scene 1: 14.0s
Scene 2: 9.0s
Scene 3 replay: 17.0s playback + 0.55s exit fade
Scene 4: 8.0s
Scene 5: 10.4s for 2 bets, 13.3s for 3 bets
Scene 6: 9.5s
Scene 7: untimed/permanent
Scene 8: 5.0s / 6.5s / 8.0s / 9.5s for 2 / 3 / 4 / 5 bets
Transition: 0.3s
```

Current target bands:

```text
<= 3 bets   -> 60s
<= 15       -> 120s
<= 40       -> 180s
<= 70       -> 225s
<= 100      -> 270s
> 100       -> 285s
hard max    -> 300s
```

Coverage and factual correctness outrank exact duration targeting.

## Test and migration assets

Retain the existing regression concepts around:

```text
5 bets
8 bets
16 bets
32 bets
75 bets
```

The current 75-bet fixture is not representative for replay testing because replay URLs are largely absent. V2 replay tests should include valid replay URLs for enough eligible races to exercise deterministic replay selection.

## Migration acceptance criteria

Kubrick V2 is not complete merely because it can generate a plan once.

Acceptance requires:

- canonical `bettings.json` accepted with only the agreed small schema changes
- every bet covered exactly once by primary scenes
- chronology preserved
- code owns all structural decisions
- selected replays are structurally legal
- Scene 4 placement is deterministic
- duration is computed deterministically
- one LLM copy pass cannot alter structure
- final `scene.json` passes the downstream contract
- existing Builder works without redesign
- existing Builder produces valid recap HTML
- 5 / 8 / 16 / 32 / 75 scenarios pass repeatedly
- repeated runs on the same input produce the same scene structure

## Anti-complexity rules

These rules exist specifically to prevent Kubrick V2 from becoming another collection of ad hoc fixes.

1. No fixture-specific production logic.
2. No special-case repair function for each possible LLM failure.
3. No LLM structural repair loop.
4. No hidden second planner inside the Builder.
5. No downstream redesign to compensate for weak planner structure.
6. No new production rule unless it can be described as a general planning rule.
7. Prefer small modules with single responsibilities over another oversized planner file.
8. Narrative semantics are prompt-owned, not validator-owned. Digits, names, money/odds wording, finishing-position wording, grammar issues and copy-length overshoots inside narrative text must not fail an otherwise structurally valid recap. Hard failures are reserved for objective response/fact-scope/contract violations.
9. The validation boundary is frozen end-to-end: scene-plan schema and Builder must not reintroduce hard prose-length or semantic-copy gates. Harmless extra model fields/part metadata are ignored, and markup-like prose is escaped by Builder rendering rather than rejected.

## Working method

Use one controlled change/test at a time.

For every significant change:

```text
inspect current state
-> make one change
-> run focused test
-> verify result
-> only then continue
```

Clearly distinguish:

```text
PROVEN
IN PROGRESS
NOT YET BUILT
```

Do not infer that a GitHub change has deployed to AWS. Deployment remains a separate explicit step.

## Current migration state

PROVEN:

- `TabAPIvbeta2` repository established
- vbeta1 working files copied as migration baseline
- old `lambda/scene-planner` implementation intentionally excluded
- obsolete Step 10 Kubrick troubleshooting documents removed
- `KUBRICK-ARCHITECTURE-GUIDE.md` rewritten for the deterministic V2 model
- CI updated so the migration baseline passes without requiring the deleted old planner
- existing Builder/downstream code retained
- minimal canonical `bettings.json` cleanup completed: `bets[].sceneType` and `bets[].showReplay` removed from live producers, consumers, schemas and test fixtures

IN PROGRESS:

- deterministic structure policy design
- fresh Kubrick V2 implementation

NOT YET BUILT:

- new `lambda/scene-planner`
- new planner tests
- updated planner deployment packaging
- cutover of v2 source to the existing AWS planner Lambda


### Copy availability boundary

The deterministic planner is the availability boundary. Kubrick makes at most one LLM copy call. If Bedrock fails, JSON is malformed, copy validation rejects the model response, or the model emits unusable/blank copy, the planner does not fail the recap and does not call the LLM again. It substitutes deterministic safe copy in code, preserves the deterministic scene structure exactly, then continues through final scene-plan validation and the existing Builder. Copy quality may degrade; recap availability must not.
