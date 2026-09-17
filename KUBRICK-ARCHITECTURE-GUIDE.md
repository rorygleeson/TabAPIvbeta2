# Kubrick V2 Architecture Guide

> Authoritative architecture guide for the TAB Daily Recap Kubrick V2 migration.
>
> **This document supersedes the old vbeta1 Kubrick planner design.**

Last updated: 2026-09-17

---

## 1. Core architectural decision

Kubrick V2 separates **scene structure** from **editorial copy**.

The old planner allowed the LLM to make too many structural decisions and then relied on increasingly complex validation, canonicalisation and repair logic to recover invalid plans.

Kubrick V2 changes that ownership model.

```text
bettings.json
    |
    v
DETERMINISTIC STRUCTURE ENGINE (CODE)
    |
    v
ordered scene skeleton
    |
    v
ONE LLM COPY PASS
    |
    v
merge LLM-owned text fields
    |
    v
FINAL VALIDATION
    |
    v
scene.json
    |
    v
EXISTING BUILDER
```

The key rule is:

> **Code owns scene planning. The LLM does not decide scene structure. The LLM only generates text for fields explicitly owned by the LLM.**

The second key rule is:

> **The existing Builder must not need to understand that Kubrick was rewritten. Kubrick V2 must continue to emit the downstream `scene.json` contract expected by the existing Builder.**

---

## 2. Migration boundary

`TabAPIvbeta2` is a controlled migration of `TabAPIvbeta1`.

The intended change is deliberately narrow:

```text
TabAPIvbeta2
=
TabAPIvbeta1
- old Kubrick implementation
+ new deterministic Kubrick implementation
+ small canonical bettings.json cleanup
```

Everything downstream of Kubrick is treated as frozen unless a proven compatibility defect requires a minimal change.

### Preserved as-is

- Builder / renderer behaviour
- Builder templates
- runtime JavaScript / CSS
- Scene Types 1-8
- `scene.json` downstream contract
- S3 object model
- DynamoDB job model
- Planning SQS
- Rendering SQS
- existing AWS resources
- existing CloudFormation resource topology
- existing CI/CD approach
- existing replay runtime behaviour
- existing test fixtures and harnesses where still relevant

### Rewritten

- Kubrick / Scene Planner implementation
- planner-specific tests
- planner-specific prompt/copy-generation logic
- deterministic structure policy

### Small input contract cleanup

Canonical `bettings.json` remains essentially locked.

Only these fields are removed:

- `sceneType`
- `showReplay`

Everything else remains unless explicitly approved later.

`replayUrl` stays.

New replay semantics:

```text
valid replayUrl present -> replay media is available
replayUrl null/invalid  -> replay media is unavailable
```

Kubrick decides whether an available replay is actually used.

---

## 3. Facts, structure, copy and rendering

Kubrick V2 uses four clear ownership layers.

### Layer 1 — Facts

`bettings.json` is the factual source of truth.

Examples include:

- bet sequence
- race/event identity
- meeting
- runner
- bet type
- stake
- odds
- result
- finishing position
- return
- profit/loss
- running P&L
- summary data
- replay URL availability

### Layer 2 — Structure

Deterministic planner code decides the storyboard.

It decides:

- which bets receive Scene 2
- which available replays receive Scene 3
- exact Scene 3 placement
- where Scene 4 appears
- which bets are grouped into Scene 5
- which bets are grouped into Scene 8
- chronology
- exact primary bet coverage
- scene ordering
- replay count
- duration planning
- target-duration compression/promotion decisions
- Scene 6 and Scene 7 final placement

### Layer 3 — Copy

The LLM receives the already-decided scene skeleton plus only the factual context required to write copy.

It may generate fields such as:

- opening teaser
- headlines
- comments
- transitions
- midpoint narration
- verdict wording
- standout copy
- final share copy

The LLM must not alter scene type, scene order, bet membership, replay selection, midpoint location or duration policy.

### Layer 4 — Rendering

The existing Builder remains deterministic.

```text
validated bettings.json
        +
validated scene.json
        +
existing templates/runtime
        =
recap HTML
```

The Builder does not make new editorial planning decisions.

---

## 4. Deterministic structure engine

The deterministic structure engine is the heart of Kubrick V2.

Its job is to transform an ordered canonical betting day into an ordered legal scene skeleton before the LLM is called.

The intended high-level algorithm is:

```text
1. validate canonical bettings.json
2. derive planning facts and duration budget
3. reserve fixed scenes
4. rank standout bets deterministically
5. select Scene 2 promotions
6. select replay candidates deterministically
7. insert Scene 3 immediately after matching Scene 2
8. group remaining bets into Scene 5 / Scene 8 according to policy
9. place Scene 4 at nearest legal midpoint boundary
10. append Scene 6 and Scene 7
11. calculate planned duration
12. deterministically adjust promotion/compression if required
13. verify exact coverage and chronology
14. call LLM once for text fields
15. merge copy
16. perform final validation
17. write scene.json
```

No step should depend on stochastic model interpretation for structural correctness.

---

## 5. Scene ownership

### Scene 1 — Opening

- always first
- structure and placement owned by code
- opening prose owned by LLM

### Scene 2 — Individual bet

- selected by deterministic importance/promotion policy
- exactly one bet
- bet identity owned by code
- editorial text owned by LLM

### Scene 3 — Replay

- optional
- selected by deterministic replay policy
- only when replay media is available
- selected replay bet must already be a Scene 2
- inserted immediately after the matching Scene 2
- replay URL is factual input
- replay label/comments may be LLM copy

### Scene 4 — Midpoint

- at most once
- placement owned entirely by deterministic code
- placed at the closest legal primary-scene boundary to the midpoint policy
- factual checkpoint context derived by code
- narration owned by LLM

### Scene 5 — Compact multi-bet story

- grouping owned by code
- intended for a small contiguous sequence where richer treatment than Scene 8 is justified
- exact use policy must be documented before implementation
- comments/headline owned by LLM where contract permits

### Scene 6 — Daily summary

- fixed ending position before Scene 7
- factual summary and standout references owned by code
- verdict/summary wording owned by LLM

### Scene 7 — Final share scene

- always last
- placement owned by code
- final copy owned by LLM

### Scene 8 — Fast Results Run

- deterministic chronological grouping
- used for compression of routine bets
- group size and use determined from documented duration/bet-count policy
- grouping must never be invented by the LLM
- text fields may be generated by the LLM

---

## 6. Duration policy

Kubrick V2 continues to use the existing runtime contract as the timing authority.

Current target-duration bands remain the starting point:

```text
<= 3 bets   -> 60 seconds
<= 15 bets  -> 120 seconds
<= 40 bets  -> 180 seconds
<= 70 bets  -> 225 seconds
<= 100 bets -> 270 seconds
> 100 bets  -> 285 seconds
```

Coverage and factual correctness outrank perfect target-duration matching.

The deterministic planner may compress or promote scenes to approach the target, but it must remain within the runtime hard maximum and preserve exact chronological coverage.

Duration decisions must be explainable from code and reproducible across repeated runs with identical input.

---

## 7. Replay policy

The old `showReplay` input flag is removed.

Replay availability is represented only by `replayUrl`.

The deterministic planner chooses which available replay(s) to use.

The exact selection algorithm is still to be locked, but it must satisfy these rules:

- replay availability comes from `replayUrl`
- replay selection comes from Kubrick code
- a selected replay must correspond to a Scene 2 bet
- Scene 3 must immediately follow that Scene 2
- replay count may vary by recap size/duration policy
- selection must be deterministic for identical input

A likely ranking input is bet significance such as `profitLoss`, but the final policy must be documented before implementation.

---

## 8. LLM contract in V2

Kubrick V2 should make one primary LLM call for copy generation after structure is complete.

The LLM receives:

- the fixed ordered scene skeleton
- factual context required for each scene
- field-level copy requirements
- word/character limits
- style guidance

The LLM does **not** receive authority to restructure the plan.

The response should contain only the text fields required to decorate the skeleton, ideally keyed by stable scene identifiers.

If copy validation later proves a repair path is required, it must remain generic and bounded. Do not recreate the old architecture with a growing family of special-case repair functions.

Soft stylistic imperfections should not fail an otherwise structurally valid recap.

---

## 9. Contracts

Contracts remain important, but their role is clearer in V2.

The contract is not a list of rules that the LLM is expected to remember and faithfully execute.

Instead:

> **Our software implements the contract. The LLM is an untrusted copy producer inside that contract.**

Field ownership remains conceptually:

- `FACT` — supplied by canonical factual input
- `DERIVED` — calculated deterministically
- `PLANNER_DERIVED` / `CONTROLLED` — decided by planner code
- `LLM` — prose only
- `RUNTIME` — playback/rendering behaviour

Final `scene.json` must still validate against the agreed downstream scene contract before the Builder is invoked.

---

## 10. AWS and deployment model

Kubrick V2 does **not** create a parallel AWS environment.

The existing vbeta1 AWS resources are intentionally reused in place.

Examples include:

- `tab-recap-vbeta1`
- `tab-recap-vbeta1-jobs`
- `tab-recap-vbeta1-planning`
- `tab-recap-vbeta1-rendering`
- `tab-recap-vbeta1-builder-recap`
- `tab-recap-vbeta1-scene-planner`
- existing deployment IAM role and CloudFormation stack topology

Migration therefore changes the **source implementation**, not the infrastructure topology.

No vbeta2-named AWS stacks or duplicate infrastructure should be created unless explicitly approved later.

`TabAPIvbeta1` remains the frozen source/reference fallback.

`TabAPIvbeta2` becomes the active source repository once the controlled cutover occurs.

---

## 11. Anti-complexity rules

These rules are mandatory for the V2 rewrite.

1. **No LLM structural planning.**
2. **No special-case fix for one fixture unless it represents a documented general planning rule.**
3. **No unbounded repair loops.**
4. **No duplicated ownership of the same decision across prompt, validator, canonicaliser and repair code.**
5. **No Builder redesign to compensate for planner behaviour unless a proven downstream incompatibility exists.**
6. **No unnecessary input-contract cleanup beyond the explicitly agreed changes.**
7. **Structure must be deterministic and reproducible for identical input.**
8. **Complexity should live in small named policy functions rather than one giant planner file.**

The goal is not merely to make current fixtures pass. The goal is to make the planner understandable and stable.

---

## 12. Acceptance criteria

Kubrick V2 is not considered complete until all of the following are true:

- canonical `bettings.json` is accepted with only the agreed format changes
- every bet is covered exactly once by primary scenes
- primary chronology is preserved
- selected replays are legal and immediately attached to matching Scene 2
- Scene 4 placement is deterministic and legal
- Scene 6 and Scene 7 are correctly positioned
- duration policy is deterministic and within hard limits
- repeated runs over identical input produce identical scene structure
- LLM variation affects copy, not structure
- final `scene.json` passes downstream validation
- existing Builder consumes the new plan without architectural redesign
- 5 / 8 / 16 / 32 / 75-bet regression cases pass repeatedly
- rendered HTML remains visually functional

---

## 13. Current design work still to lock

Before implementing the deterministic planner, these policies must be explicitly decided and documented:

- bet-count bands for scene strategy
- Scene 2 promotion count/policy
- Scene 5 use policy
- Scene 8 packing policy
- replay count by recap size/duration
- replay ranking policy
- Scene 4 legal midpoint algorithm details
- deterministic adjustment rules when planned duration is too short or too long

These are product/planning rules, not LLM prompt rules.

Once locked, code should implement them directly.
