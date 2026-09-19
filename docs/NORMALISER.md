# TAB Normaliser — Racing Settlement and Enrichment Rules

Status: **DESIGN BASELINE — 19 Sep 2026**  
Target repository: `TabAPIvbeta2`  
Current implementation baseline: local Python Normaliser derived from the v0.9 / Pass-1 v1.7 work.

## 1. Purpose

The Normaliser converts TAB account-history CSV data into the factual betting input required by Kubrick.

The local client has one selection stage in front of the existing three Normaliser passes:

```text
input\\ monthly TAB CSV files
        |
        v
STAGE 0
local CSV/day discovery and one-day selection
        |
        v
PASS 1
deterministic parsing, transaction grouping and horse-only classification
        |
        v
SELECTED-DAY FILTER
retain only the chosen eventDate before any historical enrichment
        |
        v
PASS 2
TAB historical enrichment / race identity resolution
        |
        v
PASS 3
finalise one racing day into canonical bettings.json
        |
        v
KUBRICK CLIENT
validate -> POST /jobs -> poll GET /jobs/{jobId} -> recapUrl
```

Stage 0 is deliberately outside the Normaliser passes. It selects the source CSV and one event date; it does not replace or rewrite Pass 1.

The Normaliser must never invent customer settlement facts or race facts.

Customer CSV facts and TAB historical API facts have different authority:

```text
CSV / customer-account facts
- transaction number
- bet time
- event date
- stake
- accepted Fixed odds
- source result (Pay/Won / Lost)
- payout / combined payout
- transaction amount
- net result

TAB historical enrichment facts
- canonical meeting identity
- state / location
- race time
- official race name
- raceId when genuinely exposed by the API (optional)
- runnerId when genuinely exposed by the API (optional)
- runner name where CSV only has runner number
- runner number where CSV only has runner name
- finishing position
- Tote dividends
- replay URL
```

Historical prices must never overwrite the customer's accepted Fixed price.

---


## Portable standalone package

The repository includes a self-contained local client under:

```text
local-normaliser\
```

It is designed to be copied or extracted independently of the rest of the Kubrick repository.

Portable layout:

```text
local-normaliser\
    normaliser.py
    bettings.schema.json
    run.cmd
    input\
    working\                  created automatically
    meeting-resolution.json   created automatically when needed
```

The standalone client is intentionally **Python-only at runtime**.

It uses only the Python standard library and the bundled copy of the current Kubrick `bettings.schema.json`. The local Python validation logic mirrors the current Kubrick schema constraints and canonical semantic rules so invalid source transactions can be quarantined before a later POST. Kubrick itself remains the final authoritative validator when API submission is enabled.

Normal use:

```cmd
run.cmd
```

or directly:

```cmd
python normaliser.py
```

TAB monthly account-history CSV files are placed in:

```text
input\
```

Runtime requirements for the current pre-POST client are:

```text
Windows CMD
Python 3.8 or later
network access to the TAB historical-results API for Pass 2 enrichment
```

Git, Node.js, npm, pip packages, AWS CLI, AWS credentials and a copy of the wider Kubrick repository are not required.

## 2. Local client operating model

The first working client is a **local Windows application/script**. It runs on the user's PC so it can continue to use the currently reachable TAB historical-results API for enrichment.

The long-term hosted client will reuse the same parsing, enrichment, finalisation and Kubrick-client logic once the hosted AWS runtime is approved/allowlisted. Only the local input/menu shell should need to be replaced by a web upload/UI layer.

### 2.1 Local directory model

The local application owns a simple working directory:

```text
local-normaliser\\
    normaliser.py
    meeting-resolution.json
    input\\
        <monthly TAB account-history CSVs>
    working\\
        <generated run evidence>
```

The user places one or more TAB monthly account-history CSV files into:

```text
input\\
```

The user should not need to type a file name or date manually.

### 2.2 Stage 0 — CSV scan and racing-day menu

When the script starts, Stage 0 scans every `.csv` file under `input\\`.

A TAB CSV normally represents a full statement period/month, so Stage 0 must inspect the CSV contents and identify the actual available **horse-racing event dates** rather than assuming that the file itself represents one recap day.

Stage 0 builds one combined menu across all available monthly CSVs.

Example:

```text
============================================================
TAB DAILY RECAP - LOCAL NORMALISER
============================================================

Available racing days:

  [1]  Tuesday 04 Nov 2025      12 bets
  [2]  Saturday 18 Oct 2025      8 bets
  [3]  Saturday 11 Oct 2025     14 bets
  [4]  Saturday 27 Sep 2025      6 bets

Select racing day [1-4]:
```

The first implementation uses **number + Enter** for reliability in Windows CMD. Arrow-key navigation may be added later, but it is not required for the first working client.

Dates should normally be shown newest first.

Each menu item internally retains at least:

```text
selectedDate
sourceCsvPath
displayDate
eligibleHorseBetCount
```

The selected date must come from the parsed TAB `Event Date` evidence inside the CSV, not merely from the file name.

### 2.3 Meaning of the displayed bet count

The Stage 0 count should represent the logical horse-racing bet records that would proceed through the Normaliser, not raw CSV rows.

Current counting model:

```text
Fixed WIN             -> 1
Fixed PLACE           -> 1
Fixed WIN & PLACE     -> 2 component records
Tote WIN              -> 1
Tote PLACE            -> 1
Tote WIN & PLACE      -> 1 composite record
```

Unsupported/non-horse activity is not counted as an eligible recap bet.

### 2.4 Stage 0 hand-off contract

Stage 0 does **not** create a cut-down CSV and does not invent a new intermediate data format.

Its hand-off is simply:

```text
sourceCsvPath
selectedDate
```

For example:

```text
sourceCsvPath = input\\1st October 2025 - 31st October 2025.csv
selectedDate  = 2025-10-18
```

The existing Pass 1 must then read the **original monthly CSV** using the existing parser and transaction-number grouping rules.

This protects composite transactions and preserves the current source-evidence model.

### 2.5 Selected-day filtering point

The selected date is applied **after Pass 1 and before Pass 2**.

Required flow:

```text
original monthly CSV
    -> existing Pass 1
    -> horse-only canonical internal records
    -> retain eventDate == selectedDate only
    -> existing Pass 2 historical enrichment
```

This is important because Pass 2 should not make historical API calls for every racing day in the month when the user selected only one recap day.

### 2.6 Existing Normaliser logic to retain

The working v0.9 logic should be preserved wherever possible, including:

```text
parse_csv()
transaction-number grouping
Fixed WIN / PLACE parsing
Fixed WIN & PLACE parsing/reconciliation
Tote WIN / PLACE parsing
Tote WIN & PLACE parsing
horse-only domain classification
TAB historical API client
DIRECT / LOCAL_LOOKUP / DEEP_API meeting resolution
persistent meeting-resolution.json learning
runner matching
historical race/result/replay enrichment
```

Stage 0 is an outer client layer. It is not a reason to redesign these proven parsing/enrichment rules.

### 2.7 User-facing progress and error behaviour

The local script should behave like a small application rather than a raw developer harness.

It should print clear progress messages for the major stages, for example:

```text
[STAGE 0] Scanning input files...
[STAGE 0] Found 4 racing days.

[PASS 1] Parsing selected monthly statement...
[PASS 1] Complete: 8 selected-day horse bets.

[PASS 2] Enriching historical race data...
[PASS 2] Complete: 8 enriched, 0 partial, 0 unresolved.

[VALIDATION] Building candidate Kubrick payload...
[VALIDATION] Kubrick payload valid.

READY TO SEND TO KUBRICK
```

Expected problems must be caught and reported clearly instead of allowing an unhandled Python traceback to be the primary user experience.

Examples include:

```text
no CSV files in input\\
invalid/unrecognised TAB statement format
no horse-racing days found
invalid menu selection
selected date unexpectedly yields no bets
TAB historical API unavailable
meeting/race/runner cannot be resolved
required enrichment is incomplete
candidate Kubrick payload fails validation
```

Diagnostic evidence should still be written under `working\\` so failures remain inspectable.

### 2.8 Kubrick API secret

The eventual local Kubrick client reads the POC API key from the Windows environment:

```text
TAB_RECAP_API_KEY
```

The API key must not be hard-coded into `normaliser.py`, committed to GitHub, written into generated payloads, or stored in documentation.

### 2.9 Current implementation milestone — stop before POST

The immediate milestone is deliberately **not** to submit a job to Kubrick yet.

The script should run:

```text
Stage 0
-> Pass 1
-> selected-day filter
-> Pass 2 enrichment
-> build candidate canonical Kubrick bettings.json
-> validate candidate payload against the current Kubrick canonical contract
-> report validation result
-> print the complete candidate payload to the screen
-> save the payload/evidence under working\\
-> STOP
```

Before final day validation, the Normaliser must treat each **source transaction as an atomic Kubrick candidate**.

Required behaviour:

```text
Pass 2 enriched selected day
    -> group canonical records by source transactionNumber
    -> build a temporary Kubrick payload for each source transaction
    -> run the exact Kubrick schema + semantic validator
    -> valid transaction: retain
    -> invalid transaction: quarantine with reason/evidence
    -> rebuild the racing day from retained transactions only
    -> resequence 1..N
    -> recalculate running P/L and every summary field
    -> run the exact Kubrick validator again on the final day payload
```

Atomicity matters for composite source bets:

```text
Fixed W&P
    -> WIN and PLACE component records share one source transaction
    -> either both survive or both are quarantined

Tote W&P
    -> already one combined TOTE_WIN_PLACE record
    -> retained or quarantined as one transaction
```

One invalid or unsupported transaction must **not** automatically discard every otherwise valid bet from the selected racing day.

Quarantine must never be silent. Evidence must include at least:

```text
transactionNumber
canonicalIds / bet types
enrichment status
missing enrichment fields where applicable
Kubrick validator errorCode/message/details
```

The final screen must clearly report how many records were processed, how many survived and how many source transactions were quarantined.

If at least one source transaction survives and the rebuilt final payload passes the exact Kubrick validator, the final message should clearly state:

```text
READY TO SEND TO KUBRICK
Kubrick request not sent in this build.
```

If no source transaction survives, or the rebuilt final payload itself fails validation, the script must state that it is not ready and must not claim success.

The authoritative local validation path is the same contract used by the Kubrick Orchestrator:

```text
contracts/bettings.schema.json
+
shared/canonical-bettings-validator.js
```

The Python Normaliser may orchestrate validation, but it must not maintain an independent Python copy as the source of truth for Kubrick admission.

This milestone allows Pass 1, Pass 2, mapping and Kubrick compatibility to be proven against real selected racing days before any HTTP integration is enabled.

### 2.10 Final Kubrick-client lifecycle

Only after the candidate payload is proven will the same script enable the final automated client step.

The local client owns the entire Kubrick request lifecycle:

```text
validated canonical bettings.json
    -> read TAB_RECAP_API_KEY
    -> POST /jobs
    -> inspect synchronous admission response
    -> if HTTP 202, retain jobId
    -> poll GET /jobs/{jobId}
    -> report lifecycle status changes
    -> when READY, receive fresh recapUrl
    -> print recapUrl
    -> automatically open recapUrl in the user's default browser
```

The client must distinguish **API admission** from **accepted-job processing** exactly as defined in `docs/KUBRICK_API.md`.

For POST:

```text
non-202 response
    -> report HTTP/errorCode clearly
    -> no accepted Kubrick job
    -> do not start polling

HTTP 202
    -> report accepted jobId
    -> begin polling
```

For polling:

```text
RECEIVED  -> continue
PLANNING  -> continue
RENDERING -> continue
FAILED    -> stop and report failureCode / failedStage / message
READY     -> read recapUrl and complete
```

The user-facing output should remain concise and should normally print status only when it changes, for example:

```text
[KUBRICK] Submitting recap...
[KUBRICK] Accepted. Job ID: 8d8c...

[KUBRICK] Status: RECEIVED
[KUBRICK] Status: PLANNING
[KUBRICK] Status: RENDERING
[KUBRICK] Status: READY

============================================================
RECAP READY
============================================================

Recap URL:
https://...

Opening recap in your default browser...
```

### 2.11 Launching the final recap

When Kubrick returns `status: READY`, the response contains a fresh short-lived S3 presigned `recapUrl`.

The local Python client should use the standard library `webbrowser` module to open that URL in the user's default browser.

Conceptually:

```python
import webbrowser

webbrowser.open(recap_url)
```

The script should **always print the URL as well as attempting to open it**, so the user still has a usable link if automatic browser launch fails.

The presigned URL is temporary and must not be treated as durable state. The stable identifier is the Kubrick `jobId`; while the job remains READY, another `GET /jobs/{jobId}` can obtain a fresh presigned URL.

The target local user experience is therefore:

```text
python normaliser.py
-> select one racing day
-> wait while the script normalises, enriches, validates and submits
-> watch clear Kubrick status updates
-> recap automatically opens in the browser when READY
```

No manual curl commands, S3 navigation, job-status lookups, URL copying, or AWS-console interaction should be required during normal use.

---

## 3. Raw CSV shape

The observed TAB statement format has these 11 transaction columns:

```text
Date & Time
Transaction Type
Transaction Category
Bet Type
Channel
Description
Amount
Fixed Price Odds
Results
Running Balance
Net Result
```

Important racing metadata is embedded inside `Description`, including combinations of:

```text
Transaction Number
Event Date
Event/Race Number
Meeting Type
Meeting Venue
Stake
selection / runner
@Price
Return / Combined Return
Combined Price
```

Related rows must be grouped by **Transaction Number**, not by row adjacency.

---

## 4. Horse-only scope

Current recap scope is thoroughbred / gallops racing.

Exclude:

```text
Greyhounds
Harness
AFL
NRL
football / soccer
tennis
sports multis
all other non-horse activity
```

The CSV does not have one reliable top-level sport field.

Observed Tote domain evidence:

```text
Meeting Venue: <venue> Gallops      -> horse confirmed
Meeting Venue: <venue> Greyhounds  -> exclude
Meeting Venue: <venue> Harness     -> exclude
```

Some valid horse Tote records have no suffix, or even no Meeting Venue, so absence of `Gallops` is not by itself grounds for exclusion. Such records remain horse candidates until stronger evidence is available.

For Fixed racing, the normal identity pattern is:

```text
<MEETING> R<raceNumber> <dd/mm> <RUNNER>
```

Sports Fixed bets normally do not follow that racing identity pattern.

---

# 5. Final-design enrichment rules

This section describes the intended **full/final Normaliser**.

The key rule is:

> `enrichmentRequired=true` means the CSV alone is not sufficient to safely produce the required final fact. Enrichment is not required merely because it would make the recap richer.

There are two distinct reasons enrichment may be needed:

1. **Settlement enrichment** — needed to determine or reconcile result/return correctly.
2. **Race metadata enrichment** — needed for canonical race identity, runner identity, finishing position, replay and other rich content.

These must not be confused.

## 5.1 Fixed Odds WIN

### CSV structure

One Fixed WIN transaction normally produces **one final bet record**.

Observed CSV facts are normally sufficient for:

```text
event date
meeting
race number
runner name
bet type = WIN
stake
accepted Fixed odds
source WIN/LOSS result
actual payout when present
potential return
profit/loss
```

A losing Fixed WIN has:

```text
result = LOSS
return = 0
profitLoss = -stake
```

A winning Fixed WIN uses the actual payout row when present. The advertised potential return must not override a different actual payout.

### Enrichment requirement

**Financial settlement:** normally **NOT REQUIRED**.

Enrichment is useful/required only for facts not present in the statement, such as:

```text
raceTime
official raceName
state
runnerNumber
finishingPosition
replayUrl
canonical meeting identity when parsing is ambiguous
```

Kubrick does not require raceId or runnerId. If the API genuinely exposes either identifier it may be preserved, but absence of either identifier must not make an otherwise complete bet partial or invalid.

Finishing-position semantics are independent of bet settlement:

```text
result
- authoritative wager outcome: WIN or LOSS

finishingPosition
- preserve the TAB historical-results API value
- 0 = unplaced / exact finishing position not supplied by TAB
- 1+ = recorded finishing position supplied by TAB
- never infer or fabricate an exact finishing position
- does not determine or override result
```

A valid TAB value of `0` must therefore pass through to canonical `bettings.json`; it must not by itself make an otherwise complete bet partial or invalid.

### Record count

```text
1 Fixed WIN transaction -> 1 final bet record
```

---

## 5.2 Fixed Odds PLACE

### CSV structure

One Fixed PLACE transaction normally produces **one final bet record**.

The CSV normally gives:

```text
event date
meeting
race number
runner name
bet type = PLACE
stake
accepted Fixed odds
source WIN/LOSS result
actual payout when present
potential return
profit/loss
```

The actual payout is authoritative.

Observed data includes a real deductions case where:

```text
potential return = $16.00
actual payout    = $14.40
```

The final return must therefore come from settlement/payout evidence, not simply `stake * acceptedOdds`.

### Enrichment requirement

**Financial settlement:** normally **NOT REQUIRED**.

Enrichment is needed only for missing race/runner metadata, finishing position, replay, canonical IDs, or where the CSV identity cannot be parsed safely.

### Record count

```text
1 Fixed PLACE transaction -> 1 final bet record
```

---

## 5.3 Fixed Odds WIN & PLACE

### CSV structure

A Fixed Win & Place transaction contains two component selections under one transaction number:

```text
WIN component
- stake
- accepted WIN price
- potential WIN return

PLACE component
- stake
- accepted PLACE price
- potential PLACE return

transaction-level
- overall result
- actual combined payout when won
```

The full/final design represents this as **two final bet records** because the customer placed two distinct priced components.

```text
1 Fixed W&P transaction
    -> 1 WIN final record
    -> 1 PLACE final record
```

### Loss case

Where both source component rows are settled `Lost` and there is no payout:

```text
WIN return   = 0
PLACE return = 0
```

No enrichment is required for financial settlement.

### Winning case

The Normaliser first attempts deterministic CSV-only reconciliation.

Example:

```text
WIN   stake $2 @ 8.50 -> potential $17.00
PLACE stake $8 @ 2.40 -> potential $19.20
actual transaction payout = $36.20

$17.00 + $19.20 = $36.20
=> both components returned
```

Another observed case:

```text
WIN   potential = $31
PLACE potential = $25
actual payout   = $25

=> PLACE component returned; WIN component returned $0
```

A split is accepted only when the actual payout uniquely identifies one component subset.

### Enrichment requirement

**Not required** when the CSV settlement uniquely proves the two component outcomes/returns.

**Required or unresolved** when the combined actual payout cannot be uniquely reconciled to the two components.

This can happen with deductions or other settlement adjustments. Historical race enrichment may prove which components won or placed, but it must not invent a customer-specific payout split that the source settlement does not prove.

If exact component return remains unknowable, the final design must either:

- obtain a stronger settlement source; or
- preserve the transaction as a combined record under a future contract that explicitly supports it.

It must not fabricate component returns.

---

## 5.4 Tote WIN

### CSV structure

One Tote WIN transaction produces **one final bet record**.

The CSV normally gives:

```text
event date
meeting type
meeting venue when supplied
race number
runner number
stake
source WIN/LOSS result
actual payout when won
```

The CSV does **not** provide an accepted Fixed price because this is Tote betting.

For a winner:

```text
return = actual payout
profitLoss = return - stake
```

For a loser:

```text
return = 0
profitLoss = -stake
```

### Enrichment requirement

**Financial settlement:** normally **NOT REQUIRED** when the CSV has a settled result and payout.

Enrichment is required for information the CSV does not contain, including:

```text
runner name
official Tote dividend / odds
raceTime
raceName
state
finishingPosition
replayUrl
meeting identity where venue is absent/ambiguous
```

A winning transaction allows an **effective settled multiple** to be calculated as `return / stake`, but this should not be confused with a pre-bet Fixed price.

A losing Tote bet cannot derive a meaningful dividend from `return / stake` because that would be zero.

Therefore, if Kubrick continues to require `odds > 0` for every record, **losing Tote bets cannot satisfy the current contract without enrichment or a contract change**.

### Record count

```text
1 Tote WIN transaction -> 1 final bet record
```

---

## 5.5 Tote PLACE

Tote PLACE follows the same settlement model as Tote WIN.

### CSV facts

Normally available:

```text
event date
meeting type
meeting venue when supplied
race number
runner number
stake
source WIN/LOSS result
actual payout when won
```

### Enrichment requirement

**Financial settlement:** normally **NOT REQUIRED**.

Enrichment is needed for:

```text
runner name
official Place dividend
canonical race/runner IDs
race metadata
finishing position
replay
ambiguous/missing meeting identity
```

Again, a losing Tote PLACE has no positive odds/dividend that can honestly be derived from the CSV alone.

### Record count

```text
1 Tote PLACE transaction -> 1 final bet record
```

---

## 5.6 Tote WIN & PLACE

This is the main historical enrichment edge case.

### CSV structure

The statement contains two component descriptions under one transaction number:

```text
WIN <runnerNumber>
WIN stake

PLACE <runnerNumber>
PLACE stake
```

The source transaction also establishes:

```text
event date
race number
meeting type
meeting venue when supplied
overall source result
one combined payout when won
```

The existing Normaliser intentionally represents Tote W&P as **one internal composite bet**, not two independent customer bets.

It preserves:

```text
winStake
placeStake
totalStake
runnerNumber
combinedPayout
overall result
```

### Why enrichment was originally required

The historical design attempted to determine the individual WIN and PLACE component returns.

To do that it needs the historical Tote dividends:

```text
winReturn   = winStake   * winDividend
placeReturn = placeStake * placeDividend
```

and then:

```text
winReturn + placeReturn == CSV combined payout
```

to currency-cent precision.

A missing dividend must never be treated as zero without evidence.

### What the CSV already proves

Even when the component split is unknown, the CSV can still prove the **whole customer transaction**:

```text
totalStake = winStake + placeStake
result = source Pay/Won or Lost
return = combined payout, or 0 for a settled loss
profitLoss = return - totalStake
```

Example:

```text
WIN stake   = $5
PLACE stake = $20
total stake = $25
combined payout = $48
overall result = WIN
overall P/L = +$23
```

The CSV does not reveal exactly how the $48 was divided between WIN and PLACE.

### Full/final enrichment requirement

If the final product requires:

- individual WIN and PLACE component returns;
- official Tote WIN/PLACE dividends; or
- component-specific settlement explanation;

then enrichment **IS REQUIRED**.

If the final product accepts the customer transaction as one combined Tote W&P bet, enrichment is **NOT REQUIRED for the overall financial outcome**.

Race metadata enrichment may still be required separately.

### Canonical Kubrick representation

The preferred Kubrick representation is **one canonical bet record** for the whole Tote Win & Place transaction.

Do not split the customer transaction into separate WIN and PLACE canonical bets merely to fit the Kubrick schema.

The canonical financial values are:

```text
betType    = TOTE_WIN_PLACE
stake      = totalStake
return     = combinedPayout, or 0 for a settled loss
profitLoss = return - stake
```

Kubrick currently requires one positive numeric `odds` value for every canonical bet. A Tote W&P transaction does not have one true quoted price because it has separate WIN and PLACE Tote dividends.

For `TOTE_WIN_PLACE`, the canonical `odds` field is therefore defined as an **effective composite odds/multiple for the whole transaction**, not as a quoted single-market TAB price.

For a transaction with a positive settled return:

```text
effectiveCompositeOdds = combinedReturn / totalStake
```

Example:

```text
WIN stake       = $5
PLACE stake     = $15
total stake     = $20
combined return = $42

Kubrick odds    = 42 / 20
                = 2.10
```

This value describes the effective return multiple achieved by the combined customer transaction.

The Normaliser should still preserve the actual historical Tote evidence obtained during enrichment:

```text
winDividend
placeDividend
winReturn
placeReturn
combinedReturn
```

Those component values remain useful for reconciliation and explanation, but they do not require the transaction to be split into two Kubrick bets.

For a settled losing Tote W&P transaction, `return / stake` would be zero and therefore cannot satisfy Kubrick's current `odds > 0` contract. The Normaliser must use the enriched official WIN and PLACE Tote dividends to derive a positive effective composite odds value for the transaction. It must not use zero and must not invent a price without historical dividend evidence.

The exact losing-transaction effective-odds calculation must be deterministic, documented in implementation, and based only on:

```text
winStake
placeStake
official winDividend
official placeDividend
```

If the required historical dividends are unavailable, the record is not Kubrick-ready and validation must fail rather than fabricate a value.

### Record count

Locked transaction model:

```text
1 Tote W&P transaction -> 1 combined TOTE_WIN_PLACE record
```

Do not create two financial records for Tote W&P. Component WIN/PLACE enrichment remains supporting evidence inside the Normaliser, while Kubrick receives one canonical transaction record.

---

# 6. Observed sample audit — 10 supplied CSVs

Audit basis:

```text
Nov 2020
Nov 2021
Sep 2022
Oct 2022
Sep 2023
Nov 2023
Oct 2024
Nov 2024
Jun 2025
Oct 2025
```

For the target horse-racing structures inspected:

| Bet structure | Transactions | Won | Lost | Full-design output records |
|---|---:|---:|---:|---:|
| Fixed WIN | 8 horse transactions | 1 | 7 | 8 |
| Fixed PLACE | 20 | 3 | 17 | 20 |
| Fixed WIN & PLACE | 19 | 2 | 17 | 38 when split |
| Tote WIN | 6 | 1 | 5 | 6 |
| Tote PLACE | 16 | 7 | 9 | 16 |
| Tote WIN & PLACE | 14 | 2 | 12 | 14 combined |

The Fixed WIN count excludes Fixed sports records observed in the same account-history files.

Key findings from these samples:

- ordinary Fixed WIN/PLACE financial settlement is strongly supported directly by the CSV;
- both observed winning Fixed W&P transactions could be split deterministically from the CSV payout;
- simple Tote WIN/PLACE transactions have enough data for overall result, return and P/L;
- all observed Tote W&P transactions have enough data to calculate the overall combined transaction outcome;
- the missing Tote W&P fact is the component WIN/PLACE payout split, not the overall customer result.

These counts are evidence from the supplied sample set, not a guarantee about every possible TAB statement.

---

# 7. Melbourne Cup Fixed-format exception

Two supplied horse-racing transactions use a non-standard Fixed selection shape:

```text
WIN Melbourne Cup TRALEE ROSE ...
PLA Melbourne Cup TRALEE ROSE ...
```

and:

```text
WIN Melbourne Cup ONESMOOTHOPERATOR ...
PLA Melbourne Cup ONESMOOTHOPERATOR ...
```

Observed dates:

```text
2021-11-02
2024-11-05
```

Unlike normal Fixed racing selections, these strings do not contain:

```text
FLEMINGTON R07 dd/mm
```

so the normal `<meeting> R<race> <date> <runner>` parser cannot derive meeting/race identity.

The CSV still provides:

```text
Event Date
WIN/PLACE component
runner name
stake
accepted odds
result
potential return
actual payout when applicable
```

## 7.1 Final-design handling

The full design should resolve this event through proper race/event enrichment rather than relying on display-name assumptions.

