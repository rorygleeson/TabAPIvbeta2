# TabAPIvbeta2 — TAB Daily Recap / Kubrick V2

`TabAPIvbeta2` is the active source repository for the deterministic Kubrick V2 migration of the TAB Daily Recap pilot.

The migration deliberately reuses the existing vbeta1 AWS environment. The repository name changed; the deployed resource names did not.

## Authoritative documents

Read these first before changing planner behaviour:

- `KUBRICK-ARCHITECTURE-GUIDE.md` — current architecture, ownership boundaries, locked planner policy and end-to-end target flow.
- `docs/KUBRICK_V2_MIGRATION.md` — migration status, proven tests, deployment boundary and remaining work.
- `docs/NORMALISER-LOGIC-SPEC.md` — current local CSV Normaliser design.
- `tests/README.md` — current regression and fixture rules.
- `tests/manual-cli-tests.md` — deployed-AWS smoke-test procedures and latest proof record.

## Current planner flow

```text
canonical bettings.json
  -> deterministic scene planner
  -> deterministic scene skeleton
  -> compact grounded copy payload
  -> exactly one Bedrock copy call
  -> copy response validation
       -> valid copy: merge into skeleton
       -> copy-stage failure: deterministic safe fallback copy
  -> final scene.json planVersion 2.0
  -> existing Builder
  -> recap HTML
```

The LLM is a copywriter only. Code owns scene structure, grouping, chronology, coverage, replay selection, midpoint placement and duration.

There is no structural repair loop and no second LLM call.

## Current AWS environment

Account: `134387458447`  
Region: `ap-southeast-2`

Key existing resources intentionally retain vbeta1 names:

- `tab-recap-vbeta1`
- `tab-recap-vbeta1-jobs`
- `tab-recap-vbeta1-planning`
- `tab-recap-vbeta1-rendering`
- `tab-recap-vbeta1-scene-planner`
- `tab-recap-vbeta1-builder-recap`

Deployment source branch remains `deploy`.

## Current proof state

Direct planner tests have reached `RENDERING` for:

- 5 bets — new real-race fixture
- 8 bets — new real-race fixture
- 16 bets — retained older baseline fixture
- 32 bets — new real-race fixture
- 50 bets — new real-race fixture
- 75 bets — new real-race fixture

The 75-bet fixture deliberately contains two `replayUrl: null` cases and still passes.

The remaining visible planner issue is copy quality only: occasional awkward grammar, repeated phrases or internal wording such as “block”. These are non-fatal and must not be “fixed” by reintroducing hard prose validators, repair loops or extra LLM calls.

## Reference repository

`rorygleeson/TabAPIvbeta1` remains the frozen migration reference/fallback source. It is not the active Kubrick V2 codebase.
