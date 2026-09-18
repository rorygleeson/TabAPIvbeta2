# TAB CSV Normaliser Logic Specification

> **Component-level Pass 1 reference.** Current integrated Normaliser authority is `docs/NORMALISER-LOGIC-SPEC.md` using `tests/normaliser/normaliser.py`. This file is retained for detailed Pass 1 rules/history and must not be read as saying Pass 2/Pass 3 are absent from the current vbeta2 integrated prototype.


> Component/reference specification for the standalone Pass-1 harness. The current integrated local Normaliser direction is documented in `docs/NORMALISER-LOGIC-SPEC.md` and implemented in `tests/normaliser/normaliser.py`. Keep this file for Pass-1 provenance; do not treat it as the end-to-end Normaliser status document.

Status: **PASS 1 v1.7 HARDENED CANDIDATE**  
Repository: `rorygleeson/TabAPIvbeta2`  
Implementation: `tests/normaliser/normalise_pass1.py`  
Schema: `normaliserSchemaVersion = 1.7`

> Change-control rule: this document and `tests/normaliser/normalise_pass1.py` are one contract. A Pass-1 logic change is incomplete unless both are updated and regression-tested together.

## 1. Purpose and boundary

Pass 1 converts a TAB account-history CSV statement into deterministic structured betting records. It answers only:

> What wagers can be reconstructed from the CSV without guessing?

Pass 1 does **not** call an external API, use an LLM, enrich historical results, or create final `bettings.json`.

```text
TAB CSV
  -> PASS 1 normalise
       -> source/original.csv
       -> normaliser/normalised-bets.json
       -> normaliser/exceptions.json
       -> normaliser/summary.json
  -> PASS 2 authoritative enrichment      [not implemented here]
  -> PASS 3 final bettings.json mapping    [not implemented here]
  -> Scene Planner
```

The design is conservative: unknown, malformed, contradictory or unreconciled betting data is quarantined rather than guessed.

## 2. Source CSV shell

The observed TAB transaction table has exactly 11 columns:

1. `Date & Time`
2. `Transaction Type`
3. `Transaction Category`
4. `Bet Type`
5. `Channel`
6. `Description`
7. `Amount`
8. `Fixed Price Odds`
9. `Results`
10. `Running Balance`
11. `Net Result`

`Description` is a quoted multiline CSV field. Pass 1 uses Python's CSV parser and therefore processes complete CSV records, not physical text lines.

Observed Description metadata includes:

```text
Transaction Number: ...
Event/Race Number: ...
Event Date: YYYYMMDD
Meeting Type: ...
Meeting Venue: ...
Stake: $...
```

Continuation records are valid 11-column records and can have blank leading columns.

### v1.7 CSV-shell hardening

Inside the transaction section, Pass 1 accepts only:

- an 11-column transaction record
- a blank separator row
- a recognised statement-footer row

An unexpected non-empty row shape is a **source-level failure**. It is not silently skipped.

Recognised footer labels are the observed TAB statement totals such as Opening Balance, Closing Balance, Total Deposits, Total Payouts and Total Net Results.

## 3. Correlation and grouping

`Transaction Number` is the primary correlation key:

```text
groups[transactionNumber] = all related source records
```

A transaction group can contain:

- one primary `Stake` record
- continuation/definition records
- a Multi summary record
- one or more `Payout` records

Physical adjacency is not used as a join rule.

For every currently supported logical wager, Pass 1 requires **exactly one** record whose `Transaction Category` is `Stake`. Multiple primary Stake rows are quarantined as `UNSUPPORTED_BET_STRUCTURE`.

## 4. Noise versus exceptions

Known accounting/non-bet records are ignored as bet data. Unknown betting data is not silently discarded.

| Source condition | Action |
|---|---|
| Deposit / withdrawal / account noise | Ignore/count |
| Payout-only group | Ignore/count as support-only |
| Supported wager structure | Normalise |
| Unknown pricing/bet type | `UNSUPPORTED_BET_TYPE` |
| Known type but unexpected structure | `UNSUPPORTED_BET_STRUCTURE` |
| Non-account 11-column row with no Transaction Number | `UNRECOGNISED_RECORD_STRUCTURE` |
| Unknown non-empty `Results` value | `UNSUPPORTED_RESULT_VALUE` |
| Required structured field missing/invalid | `INVALID_REQUIRED_FIELD` |
| Invalid/non-positive payout or unparseable W&P component stake | `INVALID_NUMERIC_VALUE` |
| Source Amount disagrees with parsed stake structure | `SOURCE_RECONCILIATION_ERROR` |
| Whole CSV cannot be parsed safely | source-level `SOURCE_PROCESSING_EXCEPTION` |

Per-bet exceptions do not prevent unrelated valid wagers in the same statement from being emitted.

## 5. Source result handling

The only source-result mappings currently proven are:

```text
Pay/Won -> WIN
Lost    -> LOSS
blank   -> null
```

A non-empty value other than the recognised values becomes `UNSUPPORTED_RESULT_VALUE`.

Pass 1 does not infer a new result state from payout presence.

For Tote settlement consistency:

- `WIN` requires a positive payout
- `LOSS` must not have a payout
- a payout with `betResult = null` is invalid and quarantined

## 6. Payout handling

Payout rows are correlated by Transaction Number and are never emitted as separate wagers.

Every observed payout row used by a supported wager must contain a parseable **positive** Amount. A zero, negative or unparseable payout is `INVALID_NUMERIC_VALUE`.

Current proven calculations are:

```text
Tote WIN / PLACE effective odds = payout / stake
Tote WIN_AND_PLACE combinedEffectiveOdds = combinedPayout / totalStake
```

Fixed wagers do not require payout rows to reconstruct their core Pass-1 structure.

## 7. Source financial reconciliation

v1.7 uses redundant source fields to detect parser/source disagreement rather than trusting one representation blindly.

For ordinary supported wagers:

```text
abs(primary Amount) == parsed stake
```

For Fixed or Tote Win & Place:

```text
abs(primary Amount) == WIN stake + PLACE stake
```

For Fixed Multi:

```text
abs(Multi summary Amount) == parsed Multi stake
```

A mismatch or a missing required source Amount becomes `SOURCE_RECONCILIATION_ERROR`.

This reconciliation validates the parser; it does not replace the component Description stakes that define W&P structure.

## 8. Common output rules

Common canonical fields are:

```text
transactionNumber
pricingType
betType
betTime
eventDate
betResult
enrichmentRequired
canonicalId
sequence
```

Additional fields are emitted only when applicable:

```text
meeting
meetingType
raceNumber
runnerNumber
selectionText
runnerName
stake
odds
potentialReturn
payout
```

Pass 1 intentionally does not emit older experimental/debug duplication such as:

```text
rawDescription
rawSelection
enrichmentLookup
enrichmentReason
enrichmentStatus
accountNo
transactionHeaderRow
sourceRow/sourceRows on successful bets
payoutRecordCount
oddsSource
```

Raw source rows are preserved only inside exception evidence.

## 9. Fixed racing parsing

Observed Fixed racing rows contain a source structure such as:

```text
GATTON R06 28/06 ITS RAINING AGAIN ... @Price:$13.00
```

Pass 1 can derive:

```json
{
  "meeting": "GATTON",
  "raceNumber": 6,
  "selectionText": "ITS RAINING AGAIN",
  "runnerName": "ITS RAINING AGAIN"
}
```

TAB can prefix a selection with a known place-market qualifier:

```text
PLC 1-2 ENCHANTED WORLD
```

Pass 1 preserves:

```json
"selectionText": "PLC 1-2 ENCHANTED WORLD"
```

and derives:

```json
"runnerName": "ENCHANTED WORLD"
```

Only the observed `PLC <n>-<n> ` prefix is stripped.

If a Fixed selection does not match the proven racing pattern, generic `selectionText` can still be retained but `runnerName` remains `null`. Sports selections are not mislabeled as racing runners.

## 10. Supported structural matrix

| Source type | Canonical structure | `enrichmentRequired` |
|---|---|---:|
| Fixed Odds / Win | one `WIN` | `false` |
| Fixed Odds / Place | one `PLACE` | `false` |
| Fixed Odds / Win and Place | two records: `WIN` + `PLACE` | `false` |
| Fixed Odds / Multi | one `MULTI` with `legs[]` | `true` |
| Parimutuel / Win | one `WIN` | `false` |
| Parimutuel / Place | one `PLACE` | `false` |
| Parimutuel / Win and Place | one `TOTE_WIN_PLACE` | `true` |
| Parimutuel / Trifecta | one `TRIFECTA` | `true` |
| Parimutuel / First 4 | one `FIRST_4` | `true` |

Unknown products such as Quinella, Exacta, Duet, Treble, doubles, quaddies, Big 6 or other unseen structures remain unsupported until real examples are deliberately implemented.

## 11. Required-field validation

### Fixed WIN / PLACE and Fixed W&P components

Required:

- transaction number
- valid ISO-normalised `eventDate`
- non-empty `selectionText`
- positive `stake`
- positive `odds`

`meeting` and `raceNumber` are not universally required because Fixed Odds also represents sports bets.

### Tote WIN / PLACE

Required:

- transaction number and valid date
- positive integer `raceNumber`
- positive integer `runnerNumber`
- positive stake
- settlement consistency described above

### Tote WIN AND PLACE

Required:

- transaction number/date/race/runner
- exactly one WIN definition and one PLACE definition
- same runner on both components
- no contradiction between populated event identity fields
- positive `winStake` and `placeStake`
- `totalStake == winStake + placeStake`
- settlement consistency described above

Missing optional continuation metadata is allowed. If both components supply a field such as meeting/race/date and the populated values disagree, the wager is quarantined.

### Fixed MULTI

Required:

- positive transaction stake and combined odds
- positive declared leg count
- emitted leg count equals declared count
- every leg has valid event date, event/market text, selection text and positive odds

### Trifecta / First 4

Required:

- valid date and race number
- positive stake
- exactly 3 numeric runner selections for Trifecta
- exactly 4 numeric runner selections for First 4
- every selection is positive
- selections are unique

## 12. Fixed WIN and PLACE

One source Fixed Win/Place transaction becomes one canonical `WIN` or `PLACE`.

Odds come from the Fixed Price Odds column or explicit `@Price:` text. `potentialReturn` comes from explicit source return text when present.

## 13. Fixed WIN AND PLACE

Observed source structure:

```text
WIN primary/definition record
PLACE continuation/definition record
same Transaction Number
```

Pass 1 requires exactly one WIN and one PLACE component. Duplicate components are not silently overwritten.

The parsed WIN and PLACE components must agree on their structural identity fields (`eventDate`, `meeting`, `raceNumber`, `selectionText`, `runnerName`).

One logical wager expands into:

```text
transactionNumber:WIN
transactionNumber:PLACE
```

Each component keeps its own stake, odds, potential return and result.

Additional fields are:

```text
sourceCompositeBetType = WIN_AND_PLACE
component = WIN | PLACE
```

If the PLACE continuation has no timestamp, it inherits the WIN placement time.

## 14. Fixed MULTI

The currently source-proven Multi comes from the September 2022 statement.

Observed structure:

```text
one primary first leg
continuation leg records
one summary row containing Stake, Multibet <N> legs, Combined Price, Combined Return and overall Results
```

The six-leg source example contains generic string Event/Race Number values such as:

```text
AFL Gee-Col HeadHead
NRL Newc-Cron HeadHead
USP Men Gasq-Ndal Hd to Hd
EPL Evrt-Livp Result
```

Therefore a Multi leg uses:

```json
{
  "legNumber": 1,
  "eventDate": "2022-09-03",
  "eventOrMarket": "AFL Gee-Col HeadHead",
  "selectionText": "Geelong",
  "odds": 1.28,
  "result": null
}
```

The exact repeated event/market prefix and explicit `@Price:` suffix are removed from the selection where proven. If that relationship is absent, Pass 1 preserves the pre-price payload rather than inventing a value.

Transaction-level fields include:

```text
stake
odds
potentialReturn
declaredLegCount
legs[]
enrichmentRequired = true
```

The Multi summary can have a blank timestamp. Pass 1 inherits the first non-blank transaction timestamp, which is the placement timestamp in the observed structure.

Leg outcomes remain `null` until Pass 2.

## 15. Tote WIN / PLACE

The runner number comes from the source selection.

Winner:

```text
payout = grouped payout
odds   = payout / stake
```

Loser:

```text
payout = null
odds   = null
```

Losing Tote odds are never invented.

## 16. Tote WIN AND PLACE

Observed structure:

```text
WIN definition
PLACE definition/continuation
same Transaction Number
one combined payout if paid
```

Canonical output is one `TOTE_WIN_PLACE` record.

Composite monetary fields only:

```text
winStake
placeStake
totalStake
combinedPayout
combinedEffectiveOdds
```

There are deliberately no duplicate generic `stake`, `payout` or `odds` fields on this bet type.

If paid:

```text
combinedEffectiveOdds = combinedPayout / totalStake
```

This is the realised return multiple of the whole W&P transaction, not either component's individual dividend.

Pass 1 does not emit future-result fields such as:

```text
finishingPosition
componentOutcome
winOdds
placeOdds
```

`Meeting Venue` may legitimately be absent on the continuation component. A missing optional continuation value is not treated as a conflict; conflicting populated values are.

## 17. Trifecta and First 4

The source-proven examples are losing wagers from November 2020 and November 2021.

Observed selections include:

```text
5,7,11  (FLEXI  83.3333%)
7-2-4  (FLEXI  300%)
16-21-2-4
```

Pass 1 preserves `selectionText` and emits structured numeric `selections[]`.

`flexiPercentage` preserves the numeric TAB source value; Pass 1 does not reinterpret its semantics.

No source-proven winning Trifecta/First-4 settlement exists in the current fixture set. A winning exotic or an exotic with payout is therefore quarantined rather than guessed.

## 18. Canonical IDs and ordering

Ordinary wager:

```text
canonicalId = transactionNumber
```

Fixed W&P:

```text
canonicalId = transactionNumber:WIN
canonicalId = transactionNumber:PLACE
```

`sequence` is assigned after structural expansion in deterministic source-group order.

## 19. Output files

### `normalised-bets.json`

```json
{
  "normaliserSchemaVersion": "1.7",
  "jobId": "...",
  "source": {
    "fileName": "original customer filename.csv",
    "statementPeriod": "..."
  },
  "bets": []
}
```

### `exceptions.json`

```json
{
  "jobId": "...",
  "exceptions": []
}
```

Exception entries can contain the raw 11 source columns plus `sourceRow` for diagnosis.

### `summary.json`

Successful summary fields are:

```text
jobId
sourceFile
statementPeriod
sourceTransactionRecords
sourceTransactionGroups
recognisedLogicalBetTransactions
unsupportedLogicalBetTransactions
canonicalBetRecords
exceptionCount
ignoredRecordCounts
canonicalBetTypeCounts
footer
pass1Status
```

`sourceFile` is the original customer filename, not the internal copied name `original.csv`.

Pass-2/finalisation status fields are not emitted by this Pass-1-only harness.

## 20. Local job layout

```text
working/<jobId>/
├─ source/
│  └─ original.csv
└─ normaliser/
   ├─ normalised-bets.json
   ├─ exceptions.json
   └─ summary.json
```

The input file is copied, never moved or deleted.

Local job IDs use:

```text
<statement-month>__<timestamp>-<short-random-suffix>
```

The production orchestrator should eventually supply the job ID.

## 21. Regression harness exit semantics

A source-level processing failure in **any** input file causes the harness process to return a non-zero exit code.

Per-bet exceptions remain inside that job's `exceptions.json` and do not by themselves convert the source job into a parser failure.

This distinction is intentional:

- malformed source shell -> source job failure
- unsupported/invalid individual wager -> quarantined wager, other wagers continue

## 22. v1.7 audit state

v1.7 is a **hardened candidate**, not yet the frozen production baseline.

Before publication, the exact v1.7 script was rerun against all 10 historical statements available in the working environment. All 10 completed with:

```text
source-level failures = 0
per-bet exceptions    = 0
```

The valid canonical outputs were compared with v1.6 and were unchanged apart from schema/job metadata.

The available regression run exercised:

- Fixed racing Win/Place
- non-racing Fixed Odds
- Fixed W&P expansion and timestamp inheritance
- six-leg sports Multi
- Tote Win/Place settlements
- Tote W&P composite structure
- Trifecta
- First 4

Additional negative-path checks verified:

- malformed transaction-row shape fails the source job
- negative payout is rejected
- payout with no recognised Tote result is rejected
- mismatched Fixed W&P component identity is rejected
- partial source-job failure causes a non-zero harness exit code

The user's full local collection contains 13 historical statements. The **full 13-file v1.7 regression is still required** before Pass 1 is declared frozen/proven.

The June 2025 deep-audit baseline remains:

```text
sourceTransactionRecords          = 54
sourceTransactionGroups           = 36
recognisedLogicalBetTransactions  = 35
unsupportedLogicalBetTransactions = 0
canonicalBetRecords               = 41
exceptionCount                    = 0
```

## 23. Pass 2 boundary

Pass 2 is not implemented here.

It may use structured values such as:

```text
eventDate
meeting
meetingType
raceNumber
runnerNumber
runnerName
selectionText
```

For Multi it can use each leg's event/market, date and selection.

A generic Fixed selection must not be treated as racing merely because it contains a name.

Pass 1 makes no network calls.

## 24. Pass 3 boundary

Pass 3 will map the enriched internal model into the final `bettings.json` contract consumed by the Scene Planner.

The final application schema is intentionally not used as the Pass-1 ingestion schema. Pass 1 must not fabricate values merely to satisfy a later contract.

## 25. Change control

Before changing this contract:

1. inspect the exact current implementation and this document
2. base parsing changes on real TAB source evidence
3. make the smallest controlled change
4. run the full historical regression set
5. inspect exceptions and summaries
6. deep-audit representative source/output pairs
7. update code and documentation together
8. do not coerce new source states into existing fields

The objective is not a clever parser. It is a deterministic, explainable and conservative source boundary for the rest of the platform.
