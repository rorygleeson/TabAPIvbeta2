# TAB Pass 2 Enrichment Logic Specification

> Component/reference specification for the standalone Pass-2 enrichment harness. The current integrated local Normaliser direction is documented in `docs/NORMALISER-LOGIC-SPEC.md` and implemented in `tests/normaliser/normaliser.py`. Keep this file for enrichment provenance; do not treat it as the end-to-end Normaliser status document.

Status: **PASS 2 v0.1 TEST CANDIDATE**  
Pass 1 dependency: **normaliserSchemaVersion = 1.7 (frozen/proven baseline)**  
Implementation: `tests/enrichment/enrich_pass2.py`

## 1. Purpose and boundary

Pass 2 takes the deterministic Pass 1 output and adds authoritative TAB historical race/result data.

It does **not** re-parse the CSV, replace customer-account financial truth, use an LLM, or create final `bettings.json`.

```text
TAB CSV
  -> PASS 1 normalise
       -> normaliser/normalised-bets.json
  -> PASS 2 enrich
       -> enrichment/enriched-bets.json
       -> enrichment/exceptions.json
       -> enrichment/summary.json
  -> PASS 3 final bettings.json mapping
  -> Scene Planner
```

Pass 1 owns customer-account facts such as stake, placed fixed odds, payout and transaction identity. Pass 2 owns authoritative race/result identity and media where deterministically available.

## 2. API

Pass 2 uses the TAB historical-results service:

```text
https://api.beta.tab.com.au/v1/historical-results-service
```

The test harness defaults to TAB jurisdiction `VIC`, matching the previously proven service behaviour.

### 2.1 Date endpoint

```text
GET /VIC/racing/<YYYY-MM-DD>
```

Example:

```text
GET /VIC/racing/2025-10-25
```

The date response is used to discover the authoritative meeting record and obtain:

```text
meetingName
venueMnemonic
raceType
location
races[]
```

The CSV does **not** supply `venueMnemonic`. The mnemonic is learned only after the Pass-1 meeting name has been matched against the date endpoint.

### 2.2 Race endpoint

After meeting resolution:

```text
GET /VIC/racing/<date>/<venueMnemonic>/<raceType>/races/<raceNumber>
```

Example:

```text
GET /VIC/racing/2025-10-25/A/R/races/3
```

The race response is used for race identity, runner identity, finishing position, replay/media URLs and available fixed/tote return fields.

## 3. Pass 1 fields used for lookup

For a normal racing wager Pass 2 uses only structured Pass-1 fields:

```text
eventDate
meeting
raceNumber
runnerNumber OR runnerName
```

Lookup chain:

```text
Pass 1 eventDate
        |
        v
TAB date endpoint
        |
        v
exact meetingName / verified alias match
        |
        +--> venueMnemonic
        +--> raceType
        +--> location
        |
        v
TAB race endpoint using raceNumber
        |
        v
runnerNumber preferred
runnerName exact fallback
```

The implementation never attempts to infer `venueMnemonic` from the CSV.

## 4. Meeting matching

Meeting matching is deterministic.

Normalisation may ignore case, whitespace and punctuation only.

Primary rule:

```text
normalised CSV meeting == normalised API meetingName
```

If multiple exact meeting-name candidates exist, `raceNumber` can disambiguate only when exactly one candidate contains that race number.

No fuzzy name matching is allowed.

### 4.1 Explicit aliases

A future `meeting_aliases.json` beside the test script may contain only manually verified aliases.

Example form:

```json
{
  "aliases": {
    "THE VALLEY": "MOONEE VALLEY"
  }
}
```

The script does not invent aliases.

## 5. Runner matching

For ordinary racing bets:

```text
1. runnerNumber if Pass 1 has one
2. otherwise exact normalised runnerName
3. otherwise UNRESOLVED
```

A unique runner-number match is preferred because Tote source rows already provide runner number.

Fixed racing bets usually rely on the Pass-1 `runnerName` extracted from the proven racing source pattern.

No fuzzy runner matching is allowed.

## 6. Racing/non-racing classification

### Racing

- all current Tote wager types are treated as racing
- Fixed bets are treated as racing only when Pass 1 has structured `meeting`, `raceNumber` and `runnerName`

### Not applicable to the racing API

- the currently proven Fixed Multi is sports/multi-event and is `NOT_APPLICABLE`
- generic Fixed sports selections without proven racing structure are `NOT_APPLICABLE`

`NOT_APPLICABLE` is not a failure. It means the TAB racing historical-results service is not the correct enrichment source for that wager.

## 7. Fields retrieved for an ordinary racing bet

Pass 2 attempts to populate:

```text
raceTime
raceId
raceName
meeting
state
raceNumber
venueMnemonic
raceType
runnerId
runnerNumber
runnerName
finishingPosition
replayUrl
fixedReturnWin
fixedReturnPlace
toteReturnWin
toteReturnPlace
```

`state` is taken from the matched meeting's API `location`.

## 8. Race ID

If the API provides an explicit race ID, use it.

If not, Pass 2 creates the deterministic internal key:

```text
<jurisdiction>:<date>:<venueMnemonic>:<raceType>:<raceNumber>
```

Example:

```text
VIC:2025-10-25:A:R:3
```

The output records `raceIdSource` so a derived key is never misrepresented as a TAB-supplied ID.

## 9. Runner ID

Pass 2 first uses an explicit runner/proposition ID from the API payload when available.

If no explicit ID is exposed, it may use `fixedOdds.propositionNumber` as a deterministic fallback and records the source in `runnerIdSource`.

If no acceptable runner ID is available, the wager is `PARTIAL`, because current final `bettings.json` requires `runnerId`.

## 10. Finishing position

Only positive API finishing positions are treated as final-schema-ready positions.

If TAB returns `0`, null or another non-positive value:

```text
apiFinishingPositionRaw = original API value
finishingPosition       = null
status                  = PARTIAL
```

Pass 2 does not invent a numeric finishing position merely to satisfy the final schema.

## 11. Replay/media

Pass 2 recursively inspects the race payload for explicit replay/video/media URLs and prefers direct MP4 URLs.

`replayUrl` can remain null.

Pass 2 supplies `replayUrl` when available. Canonical `bettings.json` has no replay-selection flag; replay availability is represented only by `replayUrl`, and Kubrick owns replay selection.

## 12. Financial ownership

Pass 2 must not overwrite customer-account financial truth simply because the historical API contains another price.

Pass 1 remains authoritative for:

```text
betTime
stake
customer fixed odds
customer payout
transactionNumber
Pass-1 result state
```

Pass 2 uses API return/dividend values only as enrichment evidence and where required to resolve composite Tote Win & Place settlement.

## 13. Tote WIN / PLACE

Pass 1 already owns:

```text
stake
payout
effective odds
betResult
runnerNumber
```

Pass 2 adds race/runner identity, finishing position and replay data.

Historical API tote dividends must not replace Pass-1 customer effective odds.

## 14. Fixed WIN / PLACE and Fixed W&P components

Pass 1 owns each customer's fixed stake, price and result.

Pass 2 adds:

```text
raceTime
raceId
raceName
state
runnerId
runnerNumber
canonical runnerName
finishingPosition
replayUrl
```

Fixed W&P remains two Pass-1 canonical components. Each component may receive the same authoritative race/runner enrichment while retaining its own stake, price and source result.

## 15. Composite Tote WIN AND PLACE

Pass 1 intentionally represents Tote W&P as one composite record:

```text
winStake
placeStake
totalStake
combinedPayout
combinedEffectiveOdds
```

Pass 2 keeps one composite record and retrieves the matched runner's:

```text
parimutuel.returnWin
parimutuel.returnPlace
finishingPosition
```

For a paid W&P transaction Pass 2 calculates:

```text
winReturn   = winStake   * API returnWin   (or zero when no winning dividend)
placeReturn = placeStake * API returnPlace (or zero when no place dividend)
calculatedCombinedReturn = winReturn + placeReturn
```

The component split is accepted only when:

```text
calculatedCombinedReturn == Pass1 combinedPayout
```

to currency cents.

If the calculation does not reconcile exactly, the component settlement remains unresolved. No split is guessed.

If Pass 1 has no combined payout, Pass 1 has already proven the composite transaction is a loss; the test harness records `LOST_BOTH` with zero component returns.

Pass 3 may split a reconciled composite into final simple WIN/PLACE records if required by the final application contract.

## 16. Trifecta and First 4

These are race-level/multi-runner wagers, not single-runner wagers.

Pass 2 enriches the race and resolves every selected runner number against the race payload.

It emits:

```text
selectedRunners[]
officialResultOrder[]
```

A selected runner entry can contain:

```text
runnerId
runnerNumber
runnerName
finishingPosition
apiFinishingPositionRaw
```

The current final `bettings.json` schema is single-runner and therefore cannot faithfully represent Trifecta/First-4 without a Pass-3 contract decision. Pass 2 must preserve the real exotic structure rather than coerce it.

## 17. Multi

The source-proven Multi is a sports multi spanning AFL, NRL, tennis and EPL markets.

The TAB racing historical-results API is not applicable.

The Pass-2 test harness marks it:

```text
status = NOT_APPLICABLE
reason = NON_RACING_MULTI
```

A future sports-results enrichment service can be added separately without changing Pass 1.

## 18. Enrichment statuses

### `ENRICHED`

The deterministic lookup succeeded and all currently required ordinary-racing fields for the final contract are available.

### `PARTIAL`

The meeting/race/runner match succeeded, but one or more final-contract fields are unavailable, for example a non-positive API finishing position or missing runner ID.

For exotics, `PARTIAL` can also mean one of the selected runner numbers could not be resolved.

### `UNRESOLVED`

The wager is racing, but Pass 2 cannot deterministically complete the lookup, for example:

- required Pass-1 lookup input missing
- no exact/verified meeting match
- ambiguous meeting match
- race API failure
- no exact runner match

### `NOT_APPLICABLE`

The wager is outside the current racing enrichment domain, such as a sports Multi or generic non-racing Fixed bet.

## 19. Pass 2 output

For each job:

```text
working/<jobId>/
├─ source/
├─ normaliser/
└─ enrichment/
   ├─ enriched-bets.json
   ├─ exceptions.json
   └─ summary.json
```

Pass 1 files are never modified.

`enriched-bets.json` preserves the complete Pass-1 bet and adds an `enrichment` object.

Top-level test shape:

```json
{
  "enrichmentSchemaVersion": "0.1-test",
  "normaliserSchemaVersion": "1.7",
  "jobId": "...",
  "source": {},
  "bets": []
}
```

## 20. Relationship to final bettings.json

The current final schema requires ordinary racing fields including:

```text
raceTime
raceId
raceName
meeting
state
raceNumber
runnerId
runnerNumber
runnerName
finishingPosition
```

Pass 2 supplies these where the historical API supports them.

Pass 3 remains responsible for:

```text
final sequence mapping
return
profitLoss
runningPnl
final summary calculations
Tote W&P component expansion when reconciled
final contract treatment of exotic/multi-event wagers
```

No new API should be introduced until the first Pass-2 regression shows a specific missing requirement that cannot be satisfied by the historical-results service.

## 21. Test rule

The first controlled test uses the existing 13 proven Pass-1 v1.7 job folders.

The Pass-2 harness must report every bet as exactly one of:

```text
ENRICHED
PARTIAL
UNRESOLVED
NOT_APPLICABLE
```

The first test is diagnostic. We will inspect actual unresolved/partial cases before adding aliases, fallbacks or additional APIs.
