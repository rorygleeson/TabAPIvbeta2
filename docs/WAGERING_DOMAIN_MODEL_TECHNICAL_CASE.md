# Why Wagering Needs a Domain-Specific Content Model

**Technical case study | TAB Daily Recap / Kubrick V2 | 9 October 2026**

**Audience:** Enterprise architecture, product, AI engineering and content-platform decision makers.

**Evidence scope:** The accessible TabAPIv3 repository has a minimal README; the substantive implementation evidence comes from TabAPIvbeta2 and its documented contracts. This is not a full audit of TabAPIv3.

## Executive position

A general LLM-driven content platform can generate a fluent betting recap. That is not the difficult part. The difficult part is producing a recap that is financially correct, wagering-aware, chronological, legally and editorially appropriate, consistently structured across 1–75 wagers, correctly tied to race footage, and safe when the model fails. Kubrick embodies those rules outside the LLM in a wagering-specific semantic and planning layer.

The architectural conclusion is **not** that wagering requires its own foundational language model. It requires its own **domain model, validation contracts, deterministic decisioning and narration guardrails**. A general content platform can supply orchestration, model hosting and rendering primitives, but must integrate this wagering capability rather than ask a generic prompt to reconstruct it.

## 1. System boundary: what is generic and what is specialist

Documented runtime:

```text
canonical bettings.json
→ synchronous admission
→ orchestration
→ deterministic planner
→ compact phase-scoped copy payload
→ one Bedrock copy call (or deterministic copy fallback)
→ scene.json
→ deterministic Builder/Renderer
→ recap HTML
```

Normaliser is a separate upstream sample client for TAB CSV/account-history conversion.

| Layer | Wagering-specialised responsibility | Potential generic-platform capability |
| --- | --- | --- |
| Canonical data | Bet, race, runner, settlement and day-summary semantics | JSON ingestion and schema enforcement |
| Admission checks | P&L arithmetic, running balance, outcome and ranking invariants | Request validation hooks |
| Story planning | Which bets feature, replay allocation, group coverage, midpoint, compression | Workflow orchestration |
| Grounding | Phase-specific fact atoms, allowed references, outcome-sensitive language | Prompt execution and output parsing |
| Rendering | Scene-specific racing treatment, replay and celebration rules | HTML/video templating and asset delivery |

## 2. Canonical wagering object: it is not just customer activity

The canonical `bettings.json` v1.0 contract uses strict objects with no arbitrary additional fields. It contains `schemaVersion`, `user`, `day`, `bets[]` and `summary`. Each bet is an ordered, financially settled event and potentially a race-media link.

| Category | Contract fields / interpretation |
| --- | --- |
| Identity & order | sequence, betTime, raceTime, meeting, state, raceNumber, raceName; optional raceId |
| Selection | runnerNumber, runnerName; optional runnerId; betType |
| Money | stake, decimal odds, return, profitLoss, runningPnl |
| Outcome | result = WIN or LOSS; finishingPosition = 0 or a supplied 1+ ordinal |
| Media | replayUrl = valid HTTPS URL or null |
| Day | date, timezone, firstName; totals, counts, meeting count and standout sequence IDs |

Two meanings that generic generation can easily confuse: **a winning wager is not necessarily the winning horse**, and **a returned amount is not profit**. The contract states `result` is authoritative for wager success; `finishingPosition` is historical race data and must not override `result`. A value of 0 indicates unplaced/unknown exact position, not “0th”. These distinctions matter for each sentence and any celebratory animation.

### Financial and semantic invariants

- Every wager sequence is unique, contiguous, ascending and covers exactly 1..`totalBets`.
- Each `profitLoss` equals `return - stake`. Each `runningPnl` equals previous `runningPnl` plus current `profitLoss`.
- Total staked/returned, wins/losses, meeting count, final P&L and biggest stake reconcile to individual wagers, using currency-appropriate cent comparison.
- Biggest win/loss and highest-odds-winner references use explicit eligibility criteria and earliest-sequence tie-breakers; when no qualifying result exists, the sequence is null.
- Replay availability is inferred from `replayUrl` only; availability does not compel editorial inclusion.

## 3. Interpreting wagers before writing a single sentence

A domain layer must distinguish stake versus return versus net profit; profitable/negative/break-even running balance; win/loss wager result versus horse finishing position; race/runner identity versus wager identity; and chronology of known results. These are typed business facts, not terms to leave to an LLM to guess.

Illustrative example: a $20 stake, $55 return and $35 profit must be described as “$55 returned” or “$35 profit”, never “won $55 profit”. A runner finishing first may be a race winner, but the bet result field controls whether the wager won. Likewise, an each-way or exotic bet cannot be safely inferred from the runner’s finishing position alone; upstream data must supply the settled result.

## 4. The scene model is a wagering story grammar

| Scene | Coverage and purpose | Source of control |
| --- | --- | --- |
| 1 Opening | Always first; no bet coverage; pre-results teaser | Code location; LLM teaser |
| 2 Featured wager | Exactly one selected bet; pre-result tension and post-result reaction | Code selection; scoped narrative |
| 3 Race replay | Optional unique race video; follows matching featured/protected group | Code eligibility and placement |
| 4 Checkpoint | At most one; after legal near-halfway coverage; only ≥6 bets | Code checkpoint; scoped narration |
| 5 Small group | 2–3 consecutive bets with joint setup and payoff | Code membership |
| 6 Day summary | Second-last; validated end-of-day high points | Code factual eligibility |
| 7 Final/share | Always last; persistent share ending | Code highlight choices |
| 8 Fast results | 4–5 consecutive bets on days of ≥17 wagers; per-bet comments | Code compression and coverage |

A generic storyboard model can write eight styles of paragraph, but the wagering scene grammar guarantees each bet is represented once, in order, with appropriate prominence, not silently dropped or replayed twice. The LLM cannot reassign scenes, move wagers, extend total runtime or reframe a loss as a win.

## 5. Wagering-specific ranking and replay selection

The planner uses explicit attention weights: **biggest win 30; biggest loss 22; highest-odds winner 20; crossing into profit 25; crossing into loss 18; positive P&L swing 15; negative swing 12; win 8; replay available 4; first bet 3; last bet 5.** This is not generic sentiment analysis; it is a defined wagering editorial policy. Weights influence storytelling prominence and do not change facts.

Replays are grouped by identical HTTPS `replayUrl`, because multiple wagers may belong to the same race video. `raceNetPnl` is the summed `profitLoss` across wagers on that URL and `replayImportance = abs(raceNetPnl)`, calculated in cents. Representative bet = largest absolute individual profit/loss, with later sequence breaking exact ties. The selected representative WIN group ranks ahead of LOSS groups; ties inside an outcome class at a quota cut favour the later replay group. Each replay URL appears at most once.

Replay quota: up to 5 wagers → desired 1; 6–40 → desired 2; over 40 → desired 3, maximum 3, subject to actual unique eligible URLs. A selected replay follows its associated Scene 2, or a protected same-runner/same-race Scene 5. **Loss replays must never trigger WINNER/BOOM/coin/confetti winner effects.** Playback is a domain contract, not merely attaching a media URL.

## 6. Grouping, compression and timing are business rules

Consecutive same-runner/same-race wagers can be protected as a 2–3 bet Scene 5 when they include the representative for a selected replay. Identity prefers both available `raceId`/`runnerId` values and otherwise uses meeting + race number / runner number + name. This avoids separating closely related wagers from their race footage.

For fewer than 17 bets, remaining gaps become Scene 2 singles or Scene 5 groups of 2–3, with special handling for four (2+2). At 17+ bets, groups of 4–5 are eligible for fast Scene 8 compression, avoiding a remainder of one. A Scene 4 checkpoint is placed only after a legal primary-scene boundary nearest 50% coverage, never inside a group.

The target runtime interpolates **60 seconds at 1 bet, 80 at 5, 105 at 10, 145 at 20, 195 at 40, 240 at 60, and 285 at 75**; a 12-second tolerance and a 300-second hard limit are documented. Deterministic duration optimisation compresses or enriches coverage without permitting the LLM to arbitrarily drop bets.

## 7. Fact atoms: typed business data and controlled narrative freedom

Rather than sending an undifferentiated full history and asking the model to tell a story, the planner builds an internal `FACT_SEMANTICS_V4_0` copy input and a compact `FACT_SEMANTIC_TEMPLATE_V1` Bedrock request. Each narrative field receives specific local atoms and permitted chronology scopes. The LLM returns strings with placeholders such as `"<B3_RUNNER> finished <B3_FINISH>."` Code validates identifiers, substitutes exact values, and HTML-escapes Builder output.

| Atom / context | Purpose | Typical prevention |
| --- | --- | --- |
| B3_RUNNER, B3_MEETING, B3_RACE | Exact named selection and race | Invented or incorrectly paired horses/races |
| B3_STAKE, B3_DECIMAL_ODDS | Explicit currency/decimal odds | Misstated stake or odds |
| B3_BET_RESULT, B3_FINISH | Separate wager settlement from race placing | Assuming winner = winning bet |
| B3_PROFIT_AMOUNT / LOSS_AMOUNT | Mutually exclusive unsigned P&L amounts | Incorrect sign or profit/return confusion |
| DAY_TOTAL_BETS, DAY_MEETING_COUNT | Recap aggregate evidence | Fabricated day totals |
| BLOCK_START_BET, BLOCK_END_BET, BLOCK_BETS_REMAINING_AFTER | Exact group position and remaining count | Calling mid-day sequences the final bets |
| CHECKPOINT_BETS_REMAINING | Forward checkpoint count | Contradictory midpoint teasers |
| isFinalGroup, raceWinner | Non-rendered semantic classifications | Misreading last group or horse winner |

The model is explicitly told `raceActionEvidence=NONE`, `replayEvidence=RESULT_FACTS_ONLY` and `oddsClassificationEvidence=NONE`. It cannot truthfully claim a horse charged down the straight, call odds a long shot based on invented classification or narrate footage not supplied as observable race-action evidence.

### Phase-scope restrictions are as important as the atom names

Scene 2 tension can reference pre-result information and already-completed earlier bets; Scene 2 reaction can reference its completed result. Scene 4 looking-ahead copy cannot reference future wager results. Scene 8 per-bet comments receive an individual progression of available outcomes. Scene 6/7 can reference final-day aggregates. This protects suspense and correctness: knowing a final score does not mean an opening teaser may disclose it.

## 8. The LLM contract is intentionally narrow

The model is a copywriter, not a bookkeeper, race-data resolver, video editor or scene planner. **Exactly one Bedrock copy call** is allowed. Its output is checked for required fields, enums, array cardinality and phase-legal atom references. Unknown or out-of-scope placeholders trigger deterministic fallback copy; the engine does not issue a second repair call. Objective input, structure, storage or runtime errors still fail normally.

This division makes the system measurable and testable. Structural correctness is not the same as prose quality; clumsy grammar may remain a non-fatal editorial concern, but must not cause a transactional service outage or unsafe model self-repair.

## 9. What fails in a generic LLM-first content platform

| Typical approach | Wagering failure mode | Needed domain capability |
| --- | --- | --- |
| Prompt: “summarise the customer bets” | Stake, return and P&L conflated | Arithmetic contract and typed money atoms |
| Infer outcome from horse result | Race winner mistaken for wager winner | Authoritative settlement result |
| Choose “interesting moments” with AI | Cherry-picked bets; lost exact chronological coverage | Deterministic feature scoring and complete coverage |
| Attach available media automatically | Duplicate race clips or celebrating losses | Race-level replay identity and result-sensitive FX |
| Give LLM full betting history | Leaks later outcomes into earlier tension | Phase-scoped grounding and chronology restrictions |
| Use one generic template for all sizes | 75-bet output unreadable, too long or too costly | Scene 5/8 compression and duration policies |
| Retry model when response malformed | Unbounded cost/latency and inconsistent behaviour | Single-call fallback boundary |
| Generate free-form text without placeholder checks | Unverifiable numeric and named claims | Explicit atom reference validation |

A generic platform could implement these capabilities, but at that point it has incorporated a wagering-specific semantic model and policy engine. The differentiation is durable domain rules and media/customer data integration, not the choice of foundation model.

## 10. Evidence of why the contracts evolved

Migration records explain concrete failure classes: a 50-bet response referenced an invented `BLOCK_MEETING_COUNT` atom and fell back; a verbose 75-bet generation reached an 8,000-output-token cap; compact grounded strings subsequently reduced the 75-bet live response to 3,982 output tokens with successful completion. Semantic V4 tightened profit-versus-return wording, eliminated ambiguous signed P&L atoms, clarified final-group sequencing, supplied explicit highlight ranges/counts and restricted unsupported race-action narration.

Historical test coverage includes real-results-derived fixtures of 5, 8, 32, 50 and 75 bets and documented live Planner→Builder success at 5, 50 and 75 bets in September 2026. These are engineering case-study results, not evidence of a production SLA or proof that all copy is semantically flawless.

## 11. Recommendation: reusable platform, specialist wagering intelligence

Build or buy generic capabilities such as identity, orchestration, inference, observability, channels, asset storage and template rendering. Retain a **versioned wagering domain package** as a first-class capability: canonical schemas; authoritative settlement semantics; cent-safe reconciliations; racing entity/media joins; moment scoring; chronology and scene coverage; atom generation and scopes; replay rules; outcome-sensitive UX; explicit fallback tests.

Suggested integration boundary: the generic platform invokes a **Wagering Narrative Service** with canonical settled events and approved media. That service returns a validated scene plan, grounded-copy envelope and render-ready facts. The generic platform may distribute output to app, web, Sky or venue channels, but may not reinterpret settled money, change bet attribution or invent racing facts.

> Content generation is generic; wagering interpretation is not. The moat is accurate, enforceable understanding of bets, settlement, races, replay rights and bettor-specific moments — expressed in executable contracts — rather than a more elaborate prompt.

## 12. Evidence, caveats and source map

Repository inspected: [TabAPIv3](https://github.com/rorygleeson/TabAPIv3) — README.md contains only a short title; substantive code was not inspected. Evidence source: [TabAPIvbeta2](https://github.com/rorygleeson/TabAPIvbeta2) (private connected repository), specifically:

- `contracts/bettings.schema.json` — canonical JSON structure and `semanticValidation` rules.
- `KUBRICK-ARCHITECTURE-GUIDE.md` — authoritative architecture, eight scene types, ranking/replay/timing and ownership.
- `docs/KUBRICK_V2_MIGRATION.md` — tested migration state, observed failures, single-call fallback and proof points.
- `lambda/scene-planner/planner-policy.js` — source policy for scoring, checkpoints, replay counts, duration and compression.
- `lambda/scene-planner/llm-copy-input.js` — implementation of fact atoms, chronology phases, semantic context and compact payload.

Claims about deployed AWS behaviour reflect repository documentation dated September 2026, not independent live infrastructure verification on 9 October 2026. Examples are explanatory, not production bet records. The recommendation is a technical architecture assessment, not a finding that an unspecified competitor platform cannot perform the work.
