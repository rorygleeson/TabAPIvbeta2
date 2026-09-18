# TAB CSV Normaliser Logic Specification

Last updated: 2026-09-18

Status: **LOCAL-ONLY INTEGRATION DESIGN / v0.9 READY FOR RUN 2**  
Repository: `rorygleeson/TabAPIvbeta2`  
Canonical runnable script: `tests/normaliser/normaliser.py`

> This is the current integrated Normaliser design for vbeta2. The component documents under `lambda/normaliser/` are retained as lower-level Pass 1 / Pass 2 design history and must not override this file where they differ.

## 1. Locked execution model

The Normaliser is deliberately local-only for this phase and remains separate from the Kubrick V2 planner runtime.

The planned production shape is **one Python Normaliser Lambda** with separate internal Pass 1 / Pass 2 / Pass 3 stages/functions, not three independent Normaliser Lambdas. That production deployment is not yet treated as proven. The current integrated local script is the executable design/proving ground.

Its downstream boundary is the canonical `bettings.json` contract consumed by Kubrick V2. Kubrick must not absorb CSV parsing or historical-results enrichment responsibilities.

There is exactly one runnable Python script:

```text
tests/normaliser/normaliser.py
```

That script contains the complete Pass 1 + Pass 2 + Pass 3 implementation as normal readable Python.

It must not:
- import another project Python module;
- hide implementation in a compressed/encoded payload;
- require DynamoDB;
- require boto3;
- require AWS CLI;
- require IAM, AWS profiles, or AWS credentials.

The local layout is:

```text
C:\Dev\TabAPIvbeta2\TabNormaliserTest\
├─ normaliser.py
├─ meeting-resolution.json
├─ input\
└─ working\
```

`meeting-resolution.json` is persistent learned state and stays outside `working\`.  
`working\` is disposable run output.

If `meeting-resolution.json` does not exist, the script starts with an empty learned-meeting store and creates the file only after a mapping is proven.

## 2. Architecture

There is one Normaliser process with three internal passes:

```text
TAB account-history CSV
        |
        v
PASS 1
deterministic parse + horse-only domain classification
        |
        v
PASS 2
TAB historical enrichment + meeting resolution
DIRECT -> LOCAL_LOOKUP -> DEEP_API
        |
        v
PASS 3
daily best-effort bettings.json
```

No production deployment is part of this phase.

## 3. Product scope: horse racing only

The recap currently accepts horse/thoroughbred racing only.

Exclude:
- Greyhounds
- Harness racing
- AFL
- NRL
- EPL / football / soccer
- Tennis
- Sports multis
- All other non-horse sports

The TAB CSV has no dedicated top-level `sport` column. Domain evidence is inside `Description`.

### Tote domain evidence

When the Description explicitly contains:

```text
Meeting Venue: <venue> Gallops
```

classify:

```text
HORSE_CONFIRMED_CSV
```

When it explicitly contains:

```text
Meeting Venue: <venue> Greyhounds
Meeting Venue: <venue> Harness
```

classify:

```text
NON_HORSE_RACING
```

and exclude.

The suffix is not guaranteed. Real fixtures contain horse Tote records with venues such as `DORTMUND` and `GAVEA` without a suffix, and some Tote records have no Meeting Venue at all.

Those are retained as:

```text
HORSE_CANDIDATE
```

and Pass 2 must prove horse identity using the historical API.

### Fixed Odds domain evidence

Standard Fixed horse racing normally looks like:

```text
<meeting> R<raceNumber> <dd/mm> <runner>
```

Example:

```text
CAULFIELD R08 15/08 ASAKURA
```

The supplied data also contains a valid named Melbourne Cup Fixed market that does not follow that normal identity pattern. TAB's racing-specific `Deductions Apply` wording is therefore retained as a candidate signal.

Post-parse domain classes:

```text
HORSE_CONFIRMED_CSV
HORSE_CANDIDATE
NON_HORSE_RACING
NON_RACING
```

Only the first two continue to Pass 2.

## 4. Pass 1 parsing rules

The v1.7 parsing/grouping/settlement behaviour remains the baseline.

Rules include:
- one CSV = one job;
- original CSV is copied to the job output;
- group related rows by Transaction Number, not adjacency;
- quoted multiline Description fields are preserved;
- continuation rows are valid 11-column rows;
- payout rows may occur away from the stake row;
- unsupported/contradictory structures are quarantined, never guessed;
- Fixed Win & Place becomes two canonical component records;
- Tote Win & Place remains one composite internal record;
- exotic selections stay structured;
- accepted Fixed odds come from the customer statement and are never overwritten by later API market prices;
- Pass 1 does not fabricate race facts.

The locked 13-fixture pre-filter regression is:

```text
pre-filter canonical records: 119
parser exceptions:              0
```

After the horse-only filter:

```text
horse records retained: 112
known non-horse removed: 7
```

## 5. Customer facts versus TAB race facts

Customer CSV is authoritative for:

```text
betTime
stake
accepted Fixed odds
source result / settlement
actual payout / combined payout
transaction number
```

TAB historical API is authoritative for:

```text
canonical meeting
location/state
race type
race time
race name
race number confirmation
runner identity
finishing position when genuinely supplied
Tote dividends when needed
replay URL when supplied
```

## 6. Fixed Odds payout correctness

For a settled Fixed single, the transaction-group Payout row is authoritative.

The stake Description's `=Return:` value is potential/source return and may differ after deductions.

Observed fixture:

```text
potentialReturn = 16.00
actual payout   = 14.40
```

Therefore:

```text
winning Fixed single + payout row     -> final return = actual payout
losing Fixed single                   -> final return = 0
winning Fixed single without payout   -> potentialReturn only as best-effort fallback
```

For Fixed Win & Place, a single composite payout is never arbitrarily split. The Normaliser enumerates the possible non-empty component subsets and compares the sum of their source `potentialReturn` values with the authoritative composite payout.

- exactly one matching subset -> matched component(s) receive their source return, unmatched component(s) receive return `0`;
- zero matching subsets -> component payouts remain unknown;
- more than one matching subset -> component payouts remain unknown because the split is ambiguous.

When exactly one subset proves the split, the canonical component `betResult` is also normalised to `WIN` for returning components and `LOSS` for zero-return components. This is necessary because TAB can repeat `Pay/Won` on both source rows of a composite W&P transaction even when only one component actually returned money. This deterministic reconciliation keeps recap win/loss counts and replay flags correct.

If exact unique reconciliation is not possible, a winning Fixed W&P component return remains `null`. Pass 3 must **not** fall back to the advertised `potentialReturn` for that winning component because deductions can make it differ from the actual settlement.

## 7. Pass 2 resolution ladder

For each included horse record:

```text
1. DIRECT
   exact normalized CSV meetingName against TAB historical date payload
   must resolve raceType == R
        |
        | fail / blank
        v
2. LOCAL_LOOKUP
   check meeting-resolution.json
   validate every learned target against eventDate + canonical meeting + location + venue mnemonic + raceNumber + raceType R
   accept exactly one valid target
        |
        | miss / stale / ambiguous
        v
3. DEEP_API
   horse meetings only: raceType == R
   same event date + race number
   validate exact runner evidence and financial evidence where available
   accept only a uniquely proven candidate
        |
        | unique + source meeting exists
        +--> write/update meeting-resolution.json
        |
        | zero/multiple
        v
4. UNRESOLVED
   keep the horse bet
   do not fail the CSV job
   do not fabricate missing race facts
```

No fuzzy/Levenshtein best guess is allowed.

## 8. Exact non-horse hard stop

DIRECT exact meeting resolution is only accepted after the requested `raceNumber` is confirmed to exist in that exact meeting.

Only then, if the resolved meeting proves:

```text
raceType = G
raceType = H
or any non-R race type
```

the record becomes:

```text
EXCLUDED_NON_HORSE
```

and is removed from final recap output.

The resolver must not continue into LOCAL_LOOKUP or DEEP_API and reinterpret that same source bet as a different horse race.

## 9. Local learned meeting store

Persistent learned aliases are stored in:

```text
<root>\meeting-resolution.json
```

Conceptual file:

```json
{
  "THEVALLEY#MR": [
    {
      "targetKey": "MOONEEVALLEY#VIC#M#R",
      "sourceMeeting": "THE VALLEY",
      "sourceMeetingType": "MR",
      "canonicalMeeting": "MOONEE VALLEY",
      "location": "VIC",
      "venueMnemonic": "M",
      "raceType": "R",
      "resolutionMethod": "TAB_DEEP_API_UNIQUE_MATCH",
      "confidence": "PROVEN_UNIQUE_MATCH",
      "firstSeen": "...",
      "lastSeen": "...",
      "seenCount": 1
    }
  ]
}
```

`sourceKey`:

```text
<normalised sourceMeeting>#<normalised sourceMeetingType-or-UNKNOWN>
```

`targetKey`:

```text
<canonicalMeeting>#<location>#<venueMnemonic>#<raceType>
```

The value is deliberately a list because the same human-facing source meeting text may map to more than one worldwide target over time.

A learned mapping is reused only when the requested date/race reduces the stored target list to exactly one valid `raceType=R` target.

### Write rule

Write/update a learned mapping only when all are true:

1. DIRECT did not resolve the source meeting;
2. LOCAL_LOOKUP did not provide exactly one valid target;
3. DEEP_API proved exactly one race/meeting;
4. resolved `raceType == R`;
5. source meeting text exists.

A bet with no source meeting may still resolve for the current run, but no alias is persisted.

For an existing sourceKey + targetKey:
- `firstSeen` stays unchanged;
- `lastSeen` updates;
- `seenCount` increments.

Only `raceType=R` mappings are stored.

### Atomic local write

The live lookup file is never written in-place.

The script writes:

```text
meeting-resolution.json.tmp
```

then, only after a complete successful write, replaces:

```text
meeting-resolution.json
```

A failed write must not leave a partially written live lookup file.

The lookup file is an optimisation, not a prerequisite for the current bet. If DEEP_API has already proven the race but persisting the learned alias fails (disk full, permission error, etc.), the current bet remains successfully enriched. The run records a lookup warning/error instead of downgrading that proven race to `UNRESOLVED`.

## 10. Deep resolver

Deep candidates are restricted immediately to:

```text
same eventDate
raceType == R
requested raceNumber exists
```

Evidence:

```text
exact runner name
exact runner number
Tote payout/dividend reconciliation where available
```

Selection rule:

```text
one positive financial reconciliation -> accept
else one exact runner-name candidate   -> accept
else exactly one surviving candidate  -> accept
else                                   -> unresolved
```

Candidate race-call failures are retained in diagnostics. If TAB/API requests fail while the deep resolver is evaluating candidates, the reason must say that the candidate race lookups failed rather than falsely reporting only "0 candidate races".

Exotics are not deep-resolved merely because selected runner numbers happen to exist in a race.

## 11. Tote Win & Place safety

A missing Tote dividend is unknown, never zero.

Positive financial matching and component reconciliation require every dividend needed for the calculation to be present.

When both required dividends exist:

```text
winStake * winDividend
+
placeStake * placeDividend
```

must reconcile to CSV combined payout to currency-cent precision.

A source-confirmed total loss with no payout may retain total return 0 because the customer statement itself establishes the loss.

`finishingPosition=0` from the historical API is treated as unavailable, never as proof of loss.

## 12. IDs

Do not fabricate IDs to satisfy the old strict schema.

```text
API genuine raceId available   -> use it
otherwise                      -> null

API genuine runnerId available -> use it
otherwise                      -> null
```

Do not synthesize raceId from route coordinates.

Do not substitute proposition number as runnerId.

## 13. Enrichment statuses

Included horse records use:

```text
ENRICHED
PARTIAL
UNRESOLVED
```

Internal domain verification may produce:

```text
EXCLUDED_NON_HORSE
```

which never enters final `bettings.json`.

Definitions:

```text
ENRICHED
  race identity proven and expected enrichment fields for that bet shape are present

PARTIAL
  race identity proven but runner or expected enrichment fields are missing

UNRESOLVED
  race/meeting identity itself was not proven
```

A runner mismatch after a proven race is PARTIAL, not UNRESOLVED.

Expected fields are bet-type aware. Trifecta/First 4 do not incorrectly require a single runnerNumber/runnerName.

## 14. enrichmentRequired semantics

`enrichmentRequired=true` means missing enrichment prevents correct financial/result finalisation.

It does not merely mean race metadata or replay would improve the content.

Examples:

```text
Fixed WIN/PLACE with source settlement facts -> OPTIONAL
simple Tote WIN/PLACE with CSV payout/result  -> OPTIONAL
Tote W&P with CSV combined payout             -> OPTIONAL for total financial finalisation
Tote W&P with genuinely unknown total return  -> REQUIRED_FOR_FINALISATION
future exotic with unknown result             -> REQUIRED_FOR_FINALISATION
```

## 15. Pass 3 bettings.json

One final file per event day:

```text
working\<jobId>\final\<YYYY-MM-DD>\bettings.json
```

Current local test schema marker:

```json
"schemaVersion": "1.0-best-effort-v0.9"
```

Every record emits the familiar current fields:

```text
sequence
betTime
raceTime
raceId
raceName
meeting
state
raceNumber
runnerId
runnerNumber
runnerName
betType
stake
odds
result
finishingPosition
return
profitLoss
runningPnl
replayUrl
```

Unavailable facts are `null`; they are never invented.

Additional diagnostics:

```text
domainClassification
enrichmentStatus
enrichmentRequired
enrichmentImpact
enrichmentResolutionMethod
enrichmentResolutionReason
enrichmentReason
missingEnrichmentFields
```

Resolution methods may include:

```text
DIRECT
LOCAL_LOOKUP
DEEP_API
```

## 16. Ordering and financial completeness

Pass 3 preserves numeric canonical source sequence from Pass 1.

It does not lexically sort raw timestamp strings such as `Mon`, `Tue`, etc.

Rules:

```text
return      -> source-authoritative payout/return where known
profitLoss  -> return - stake only when both known
runningPnl  -> becomes null from first unknown P/L onward
```

Daily totals that depend on all records become `null` when underlying values are incomplete. This includes `totalStaked`, `totalReturned`, `finalPnl`, and any summary value such as `biggestStake` that cannot be proven complete when one or more required component values are missing.

`nonHorseBetsExcluded` includes both Pass-1 domain exclusions and later API-proven non-horse exclusions.

Summary semantics:
- `biggestWinSequence` requires a WIN with positive P/L;
- `biggestLossSequence` requires a LOSS with negative P/L;
- `highestOddsWinnerSequence` uses winning bets with known odds.


## 17. Failure handling and evidence preservation

Each CSV job records the stage currently running. If a later stage fails, evidence from an earlier completed stage is preserved.

For example, if Pass 1 completed and Pass 2 then fails:

```text
normaliser\summary.json      <- retained Pass-1 evidence
normaliser\exceptions.json   <- retained Pass-1 evidence
job-error.json                <- PASS_2_ENRICH failure
```

A later-stage exception must not overwrite valid Pass-1 output. `job-error.json` records the failing stage and error.

## 18. Replay

Canonical replay availability is represented only by `replayUrl`. A valid non-empty HTTPS `replayUrl` means replay media is available; null or invalid means unavailable. Kubrick owns the decision to use an available replay. Missing replay is optional enrichment and never invalidates a bet.

## 19. Historical jurisdiction scope

The harness currently defaults to TAB historical jurisdiction:

```text
VIC
```

Observed testing shows VIC exposes many interstate and international meetings, but available documentation does not prove one jurisdiction is a guaranteed worldwide historical catalogue.

Therefore:
- VIC is acceptable for this controlled local regression;
- worldwide completeness is not yet proven;
- unresolved records continue safely rather than being guessed.

## 20. Local-only run arguments

Typical run:

```cmd
cd /d C:\Dev\TabAPIvbeta2\TabNormaliserTest
python normaliser.py --first-name Rory
```

The default lookup file is:

```text
C:\Dev\TabAPIvbeta2\TabNormaliserTest\meeting-resolution.json
```

An alternate local file can be supplied with:

```cmd
python normaliser.py --lookup-file my-meeting-resolution.json --first-name Rory
```

No AWS arguments exist.

## 21. Locked final test

### Run 1 — empty lookup

Remove/rename any prior lookup file:

```cmd
cd /d C:\Dev\TabAPIvbeta2\TabNormaliserTest
if exist meeting-resolution.json ren meeting-resolution.json meeting-resolution.before-test.json
rmdir /s /q working
mkdir working
python normaliser.py --first-name Rory
```

Then inspect:
- all 13 job summaries;
- all enrichment exceptions;
- every PARTIAL;
- every UNRESOLVED;
- every REQUIRED_FOR_FINALISATION;
- every generated daily `bettings.json`;
- newly learned `meeting-resolution.json`.

### Run 2 — learned lookup

Do not remove `meeting-resolution.json`.

Clear only disposable output:

```cmd
rmdir /s /q working
mkdir working
python normaliser.py --first-name Rory
```

Then prove:
- learned mappings are reused through `LOCAL_LOOKUP`;
- final results remain materially consistent with Run 1;
- no ambiguous mapping is silently selected;
- no non-horse record reaches final output;
- no fabricated IDs appear.

## 22. Already-proven local regression

Before the live API/lookup test:

```text
13 source fixtures
pre-filter canonical records: 119
post-filter horse records:    112
parser exceptions:              0
known non-horse removed:         7
```

The supplied Fixed payout case is preserved as:

```text
potentialReturn = 16.00
actual payout   = 14.40
```

Local v0.9 audit checks prove:
- Python compilation succeeds;
- 13 fixtures remain exactly 119 pre-filter / 112 horse / 0 parser exceptions;
- an exact same-name G/H meeting is not hard-excluded unless the requested race exists there;
- a proven DEEP_API race survives a local lookup write failure;
- Fixed W&P unresolved component payout does not fall back to `potentialReturn`;
- incomplete stake data makes dependent daily totals `null`;
- API-proven non-horse exclusions are included in final exclusion totals;
- deep candidate race-call failures are reported explicitly;
- missing lookup file starts cleanly;
- first proven mapping creates `meeting-resolution.json`;
- reload returns the learned mapping;
- multiple targets for one source key are retained;
- learned mappings validate location as well as canonical meeting / venue / race type, preventing cross-location alias reuse;
- re-proof increments `seenCount`;
- `firstSeen` is retained;
- atomic `.tmp` file is not left behind after a successful write;
- a forced Pass-2 failure preserves completed Pass-1 evidence and writes `job-error.json`.


The first live API run on 2026-09-17 completed all 13 jobs with no source failures:

```text
Enriched:          100
Partial:             3
Unresolved:          9
Required pending:    0
Lookup writes:       2
Lookup errors:       0
```

The live run exposed one additional Fixed W&P settlement case (`PERILOUS FIGHTER`, Flemington R4, 2023-11-07): source potential returns were WIN=31.00 and PLACE=25.00, while the authoritative composite payout was 25.00. The unique-subset rule proves PLACE=25.00 and WIN=0.00, producing combined transaction P/L of +19.00 without using finishing position or guessing a deduction split.

The v0.9 cleanup also replaces deprecated `datetime.utcnow()` usage with timezone-aware UTC timestamps.

## 23. Park point

When the current local regression runs pass:

```text
NORMALISER = PARKED / LOCAL PROVEN CANDIDATE
```

Do not silently deploy it into the existing AWS runtime.

Productionisation is a separate controlled step and should preserve the agreed target shape: one Python Normaliser Lambda with internal Pass 1 / Pass 2 / Pass 3 stages, producing canonical `bettings.json` for Kubrick V2.

Until that productionisation step is explicitly started, the implemented Kubrick V2 planner remains independently testable from canonical fixtures.
