# TAB Normaliser — Racing Settlement and Enrichment Rules

Status: **DESIGN BASELINE — 19 Sep 2026**  
Target repository: `TabAPIvbeta2`  
Current implementation baseline: local Python Normaliser derived from the v0.9 / Pass-1 v1.7 work.

## 1. Purpose

The Normaliser converts TAB account-history CSV data into the factual betting input required by Kubrick.

The Normaliser has three logical responsibilities:

```text
TAB account-history CSV
        |
        v
PASS 1
deterministic parsing, transaction grouping and horse-only classification
        |
        v
PASS 2
optional TAB historical enrichment / race identity resolution
        |
        v
PASS 3
finalise one racing day into canonical bettings.json
```

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
- raceId
- runnerId
- runner name where CSV only has runner number
- runner number where CSV only has runner name
- finishing position
- Tote dividends
- replay URL
```

Historical prices must never overwrite the customer's accepted Fixed price.

---

## 2. Raw CSV shape

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

## 3. Horse-only scope

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

# 4. Final-design enrichment rules

This section describes the intended **full/final Normaliser**.

The key rule is:

> `enrichmentRequired=true` means the CSV alone is not sufficient to safely produce the required final fact. Enrichment is not required merely because it would make the recap richer.

There are two distinct reasons enrichment may be needed:

1. **Settlement enrichment** — needed to determine or reconcile result/return correctly.
2. **Race metadata enrichment** — needed for canonical race identity, runner identity, finishing position, replay and other rich content.

These must not be confused.

## 4.1 Fixed Odds WIN

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
raceId
official raceName
state
runnerId
runnerNumber
finishingPosition
replayUrl
canonical meeting identity when parsing is ambiguous
```

If the final Kubrick contract continues to require those fields, enrichment is technically required to satisfy the contract even though it is not required to determine the customer's financial outcome.

### Record count

```text
1 Fixed WIN transaction -> 1 final bet record
```

---

## 4.2 Fixed Odds PLACE

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

## 4.3 Fixed Odds WIN & PLACE

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

## 4.4 Tote WIN

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
raceId
runnerId
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

## 4.5 Tote PLACE

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

## 4.6 Tote WIN & PLACE

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

### Record count

Preferred transaction model:

```text
1 Tote W&P transaction -> 1 combined TOTE_WIN_PLACE record
```

Do not create two financial records unless the component settlement is actually proven.

---

# 5. Observed sample audit — 10 supplied CSVs

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


---

# 6. Melbourne Cup Fixed-format exception

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

## 6.1 Final-design handling

The full design should resolve this event through proper race/event enrichment rather than relying on display-name assumptions.

