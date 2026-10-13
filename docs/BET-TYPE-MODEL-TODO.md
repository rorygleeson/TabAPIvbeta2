# Bet Type Modelling - Next Work Item

## Purpose

The local normaliser currently supports a deliberately limited subset of TAB racing bet structures.

Recent testing against a real TAB monthly transaction statement, especially the selected day **7 September 2026**, showed that the current implementation treats some exotic bets too simplistically. Before adding more one-off parser rules, the next work item is to define a proper canonical betting model covering:

1. **Bet type** - what the customer is betting on.
2. **Bet structure / option** - how selections are arranged.
3. **Settlement shape** - single runner, multiple runners in one race, or multiple race legs.
4. **Source representation** - how TAB expresses the transaction in the statement.
5. **Kubrick representation** - how the normaliser should represent the bet without inventing information.

This document is a tracking document for that work. It is not yet a final wagering-domain contract.

---

## Core distinction: bet type vs structure

A key finding is that a bet type and its structure must not be treated as the same concept.

Examples:

- **Trifecta** is the bet type: select the first three finishers in correct order.
- **Boxed** is a structure: selected runners are combined across all valid orders.
- **Flexi** is a staking option: the customer buys a percentage of the full combination cost.
- **Standout** and **Roving Banker** are other ways to constrain or arrange combinations.

A real source transaction can therefore need several independent fields, for example:

```text
betType: TRIFECTA
structure: BOXED
flexiPercentage: 41.6666
selections: [3, 4, 5, 10]
```

The current normaliser cannot model all of these combinations correctly yet.

---

## Candidate TAB racing bet types

The following list is the current working catalogue to confirm against authoritative TAB source material before implementation:

- Win
- Place
- Each Way
- Quinella
- Exacta
- Duet
- Trifecta
- Boxed Trifecta
- Treble
- First 4
- Parlay Formula
- All-ups
- Running Double
- Daily Double
- Quaddie
- Early Quaddie
- Big 6
- Mystery Bet
- 3UP Betting

**Note:** statement values such as `SGL` are not to be treated as racing bet types. They are source-format / transaction labels and should be modelled separately from the racing wager itself.

---

## Candidate structures / options

These are separate from the base bet type and may apply to one or more bet types:

- Standard / Straight
- Boxed
- Flexi
- Multiple / Multi
- Roving Banker
- Standout

This list also needs confirmation against authoritative TAB documentation and real statement examples.

---

## Current normaliser support matrix

| TAB type | Single race / multi-race | Selection model | Structures/options | Current support |
|---|---|---|---|---|
| Win | Single race | 1 runner | Standard | **Full** |
| Place | Single race | 1 runner | Standard | **Full** |
| Win and Place | Single race | 1 runner represented as two components | Standard | **Full with settlement edge cases** |
| Trifecta | Single race | 3+ runners / combinations | Straight, Boxed, Flexi, Standout, Roving Banker | **Partial** |
| First 4 | Single race | 4+ runners / combinations | Straight, Boxed, Flexi, Standout, Roving Banker | **Partial** |
| Quaddie | Multi-race (4 legs) | Multiple runners per leg | Flexi / multi-selection structures | **None** |
| Big 6 | Multi-race (6 legs) | Multiple runners per leg | Flexi / multi-selection structures | **None** |
| Quinella | Single race | Multiple runners / first two in any order | To confirm | **None** |
| Exacta | Single race | Multiple runners / first two in exact order | To confirm | **None** |
| Duet | Single race | Multiple runners / any two to place | To confirm | **None** |
| Each Way | Single race | 1 runner with win/place components | Standard | **Not explicitly modelled as its own canonical type** |
| Treble | Multi-race | Winner selections across 3 legs | To confirm | **None** |
| Running Double | Multi-race | Winner selections across 2 legs | To confirm | **None** |
| Daily Double | Multi-race | Winner selections across 2 nominated legs | To confirm | **None** |
| Early Quaddie | Multi-race (4 legs) | Multiple runners per leg | To confirm | **None** |
| Parlay Formula | Multi-leg | To confirm | To confirm | **None** |
| All-ups | Multi-leg | To confirm | To confirm | **None** |
| Mystery Bet | TAB-generated selections | Product-specific | To confirm | **None** |
| 3UP Betting | Product-specific | To confirm | To confirm | **None** |

The terms **Full**, **Partial**, and **None** in this table describe the current normaliser implementation, not whether Kubrick's downstream wagering model ultimately supports that bet type.

---

## Current code behaviour

The current parser explicitly recognises these source combinations:

### Fixed Odds
- Win
- Place
- Win and Place
- Multi

### Parimutuel / Tote
- Win
- Place
- Win and Place
- Trifecta
- First 4

The current exotic validation assumes:

- Trifecta = exactly 3 unique positive runner selections.
- First 4 = exactly 4 unique positive runner selections.

That assumption is not sufficient for real TAB wagering structures.

---

## September 7 evidence

### Flexi Trifecta

Observed source transaction:

```text
Transaction: 48125370710253917
Bet Type: Trifecta
Meeting: DUBBO Gallops
Race: 6
Stake: $10.00
Selections: 3,4,5,10
FLEXI: 41.6666%
Result: Lost
```

This is a legitimate Trifecta structure with **four selected runners**.

The important modelling point is:

- the wager still pays on the first three finishers in correct order;
- four selected runners generate multiple possible ordered combinations;
- the Flexi percentage represents the customer's share of the full combination cost/dividend;
- therefore **selection count is not the same thing as required finishing positions**.

The current rule requiring exactly three Trifecta selections rejects this legitimate structure.

### First 4

A First 4 similarly requires the first four finishers in correct order, but the customer may select more than four runners depending on structure.

The current normaliser accepts exactly four selections only. This is also too restrictive for broader TAB First 4 structures.

---

## Meeting resolution is a separate concern

Meeting-name resolution must remain separate from bet-type modelling.

For example, the September 7 DUBBO exotic also exposed a lookup issue:

- source meeting normalises to `DUBBO`
- source meeting type can be `CR`
- the current learned lookup may contain `DUBBO#UNKNOWN`
- current lookup identity can therefore miss because it treats `meetingType` as part of the key

That problem should be fixed independently of exotic-bet modelling.

Similarly, aliases such as `WARRNAM` versus canonical `WARRNAMBOOL` are meeting-resolution issues, not bet-type issues.

Do not use exotic parser changes to compensate for meeting-resolution failures.

---

## Settlement complexity is also separate

Real transaction settlement can introduce additional dimensions that must not be conflated with bet type.

Example from 7 September:

- Fixed Win and Place transaction
- source component return
- separate account/pay multiplier
- authoritative total payout differs from the raw advertised component return

This is a settlement/reconciliation problem and should remain separate from the bet-type model.

---

## Proposed canonical model direction

The exact schema is still to be designed, but the model should be able to express at least:

```text
betType
pricingType
structure
stake
result
return
flexiPercentage

race / meeting identity

selections[]
legs[]
```

Depending on bet category:

### Single-runner wager
```text
WIN / PLACE
race
runner
stake
odds
result
return
```

### Single-race multi-runner wager
```text
TRIFECTA / FIRST_4 / QUINELLA / EXACTA / DUET
race
structure
selections[]
flexiPercentage
result
return
```

### Multi-race wager
```text
TREBLE / QUADDIE / EARLY_QUADDIE / BIG_6 / DOUBLE variants
structure
legs[
  race
  selections[]
]
flexiPercentage
result
return
```

No field should be fabricated simply to make a record satisfy Kubrick validation.

---

## Design questions to resolve

Before implementation, confirm:

- Complete authoritative TAB racing bet-type catalogue.
- Which labels are true bet types versus UI/source labels.
- Which structures are valid for each bet type.
- Whether `Boxed Trifecta` should be canonicalised as `betType=TRIFECTA, structure=BOXED` or as a distinct canonical type.
- How Flexi is represented in source transactions and settlement.
- How Standout and Roving Banker selections are represented.
- How multi-race legs are represented in monthly transaction CSVs.
- How winning exotic settlements appear in source transactions.
- Whether tote dividends/results API provides enough data to verify winning exotic returns.
- How Kubrick should display each category.
- Whether Kubrick v1 bettings schema should evolve or whether some types remain intentionally unsupported.

---

## Implementation principles

Any implementation should preserve the current safety rules:

- Never invent a runner, race, odds, return, dividend, or finishing position.
- Keep source evidence available for reconciliation.
- Use TAB historical API data only when it proves the required fact.
- Quarantine unsupported or unprovable transactions instead of guessing.
- Do not weaken the current horse/greyhound/harness domain protection.
- Do not combine meeting-alias fixes, settlement fixes and exotic-model changes into one uncontrolled change.
- Add regression fixtures before broadening each supported structure.

---

## Work plan / progress tracker

- [ ] Confirm complete TAB racing bet-type catalogue from authoritative TAB documentation.
- [ ] Confirm complete structure/option catalogue and valid combinations.
- [ ] Collect representative real CSV examples for every bet type available.
- [ ] Classify each example as single-runner, single-race multi-runner, or multi-race.
- [ ] Define canonical `betType` values.
- [ ] Define canonical `structure` values.
- [ ] Define `selections[]` model for single-race exotics.
- [ ] Define `legs[]` model for multi-race wagers.
- [ ] Define Flexi representation.
- [ ] Define Standout representation.
- [ ] Define Roving Banker representation.
- [ ] Define Boxed representation.
- [ ] Define winning exotic settlement/reconciliation rules.
- [ ] Decide which bet types Kubrick V1 will support.
- [ ] Decide whether `bettings.schema.json` needs a versioned extension.
- [ ] Add fixtures and regression tests before parser changes.
- [ ] Implement Trifecta structures beyond exactly three selections.
- [ ] Implement First 4 structures beyond exactly four selections.
- [ ] Add additional exotic bet types one controlled family at a time.
- [ ] Update normaliser documentation once the canonical model is locked.

---

## Current priority

Do **not** start broad exotic implementation yet.

Immediate order of work:

1. Finish the current meeting-resolution / lookup-key fix safely.
2. Keep the Win & Place multiplier settlement issue separate.
3. Complete this bet-type catalogue and canonical model.
4. Only then broaden Trifecta / First 4 and add new exotic families.

This avoids accumulating isolated parser exceptions and gives the normaliser one consistent wagering-domain model.
