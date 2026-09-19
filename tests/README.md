# TAB Recap Regression Gates

Last updated: 2026-09-19

This document describes the **current Kubrick V2 regression expectations** for `rorygleeson/TabAPIvbeta2`.

The old vbeta1 planner repair-loop tests are historical and are no longer the acceptance model for Kubrick V2.

## 1. Kubrick architecture under test

Kubrick is the complete backend:

```text
Kubrick
  = Orchestrator
  + Planner
  + Builder / Renderer
```

The Planner path remains:

```text
bettings.json
  -> deterministic scene structure
  -> one compact grounded Bedrock copy call
  -> validate copy response
       -> valid: merge copy
       -> copy-stage failure: deterministic fallback
  -> scene.json
  -> Builder / Renderer
```

Code owns structure. The LLM owns copy only.

The public Kubrick path is:

```text
POST /jobs
-> Orchestrator
-> Planning SQS
-> Planner
-> Rendering SQS
-> Builder / Renderer
-> READY
-> GET /jobs/{jobId}
-> recapUrl
```

The CSV Normaliser is not under this Kubrick regression boundary. It is an isolated sample client that may produce the canonical input.

There is:
- no LLM structural planning;
- no structural repair loop;
- no second LLM call;
- no hard grammar/capitalisation/copy-length gate.

## 2. Deterministic structure regression gate

Planner tests must prove:

1. Scene 1 is first.
2. Scene 6 is second-last.
3. Scene 7 is last.
4. Every bet is covered exactly once by Scene 2/5/8 primary scenes.
5. Primary coverage is chronological.
6. Scene 3 only exists for replay-eligible bets.
7. Scene 3 immediately follows its matching Scene 2.
8. Scene 4 is omitted below the configured minimum bet count.
9. Scene 4 is placed at the legal primary-scene boundary nearest 50% coverage.
10. Scene 5 covers only 2–3 consecutive bets.
11. Scene 8 covers only 4–5 consecutive bets and is used only above the configured threshold.
12. Duration stays below the runtime hard maximum.
13. Identical input produces identical structure.

## 3. Current locked policy

### Duration targets

```text
1  -> 60s
5  -> 80s
10 -> 105s
20 -> 145s
40 -> 195s
60 -> 240s
75 -> 285s
hard max -> 300s
```

### Replay desired counts

```text
<=5  -> 1
<=10 -> 2
<=20 -> 3
<=40 -> 4
>40  -> 5
max  -> 5
```

For >40 bets, at least 3 replays are retained when at least 3 eligible replay bets exist.

Replay eligibility:

```text
WIN + valid HTTPS replayUrl
```

### Extra Scene 2 allowance

```text
<=10 -> 4
<=20 -> 3
<=40 -> 2
>40  -> 1
```

### Scene 8

```text
minimum total bets = 17
```

## 4. Copy regression gate

The copy boundary must prove:

1. exactly one Bedrock copy call maximum;
2. compact model payload uses `FACT_PARTS_COMPACT_V1`;
3. 75-bet compact payload remains substantially smaller than rich internal copy input;
4. valid fact IDs are expanded deterministically;
5. unknown/out-of-scope fact IDs are rejected;
6. required fields/enums/cardinality are enforced;
7. malformed or unusable model output triggers deterministic fallback rather than planner failure;
8. fallback preserves the deterministic scene skeleton exactly;
9. final `scene.json` remains plain downstream strings/enums with no fact-part metadata.

Narrative wording quality is deliberately non-fatal.

Do **not** add hard validators for:
- grammar;
- capitalisation;
- repeated words;
- prose length targets;
- internal terminology;
- semantic interpretation of arbitrary narrative text.

## 5. Current fixtures

Current canonical fixtures:

```text
tests/fixtures/bettings-5.json
tests/fixtures/bettings-8.json
tests/fixtures/bettings-16.json
tests/fixtures/bettings-32.json
tests/fixtures/bettings-50.json
tests/fixtures/bettings-75.json
tests/fixtures/bettings-baseline.json
```

The 5 / 8 / 32 / 50 / 75 files are consistent prefixes of one recent real-race 75-bet master dataset.

`bettings-16.json` remains the older retained baseline fixture.

The 75-bet fixture intentionally has two missing replay URLs:

```text
sequence 74 -> replayUrl = null
sequence 75 -> replayUrl = null
```

This is intentional missing-media coverage.

## 6. Baseline fixture validation

The new 5 / 8 / 32 / 50 / 75 fixtures have been checked against `bettings-baseline.json` for identical canonical field shape.

Semantic fixture checks include:

- contiguous sequence;
- `profitLoss = return - stake`;
- cumulative `runningPnl`;
- summary totals;
- win/loss counts;
- unique meeting count;
- biggest/highest sequence references;
- valid HTTPS replay URLs where non-null.

## 7. Current direct AWS proof

On 2026-09-18 the current planner reached `RENDERING` for:

| Bets | Scene count | Fixture state |
|---:|---:|---|
| 5 | 8 | new real-race fixture |
| 8 | 11 | new real-race fixture |
| 16 | 16 | older retained fixture |
| 32 | 20 | new real-race fixture |
| 50 | 25 | new real-race fixture |
| 75 | 27 | new real-race fixture, two null replay URLs |

All six direct tests passed.

## 8. Current known issue

The remaining visible issue is copy quality only.

Examples include awkward joins, repeated wording and internal planner vocabulary such as `block`.

These are not structural failures and must not be turned into hard availability failures.

If copy quality is refined, the preferred first change is prompt-only, followed by 5- and 75-bet comparison tests.

## 9. Builder regression gate

The Builder remains downstream-compatible and should continue to prove:

- valid scene plan accepted;
- invalid coverage rejected;
- invalid factual/P&L input rejected;
- replay media failure does not stall runtime;
- Scene 5 and Scene 8 render correctly;
- Scene 4 renders at the deterministic checkpoint;
- final HTML remains functional;
- display substitutions are escaped safely.

The Builder must not become a second planner or a prose semantic validator.

## 10. Public API regression gate

The deployed API harness is:

```cmd
tests\tools\run-orchestrator-test.cmd <size>
```

Supported fixture sizes:

```text
5 / 8 / 16 / 32 / 50 / 75
```

The harness exercises both public Kubrick endpoints:

```text
POST /jobs
GET /jobs/{jobId}
```

Acceptance behaviour:

1. POST canonical fixture JSON using the configured `x-api-key`.
2. Require HTTP acceptance with a generated UUID `jobId` and `RECEIVED`.
3. Poll GET with the same API key.
4. Observe processing until a terminal state.
5. Require `READY`.
6. Require a returned `recapUrl`.
7. Download final `recap.html` from that URL.

The API key value is a local secret and must never be committed to the repository.

The API harness has been live-proven across multiple fixture sizes up to 75 bets.

The soundtrack/browser path has also been checked against live API output after the CORS/runtime fix.

## 11. Working rule

For every significant change:

```text
inspect current state
-> make one controlled change
-> run focused test
-> verify
-> only then continue
```

Distinguish clearly between **PROVEN**, **LOCKED**, **IN PROGRESS**, and **PLANNED**.
