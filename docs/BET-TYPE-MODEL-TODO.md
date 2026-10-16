# TAB Horse-Racing Bet Types — Normaliser Scope and TODO

## Goal

Enhance the **existing Normaliser** to understand TAB horse-racing bet types actually observed in the supplied real CSV statements and accurately produce **stake, return, WIN/LOSS and profit/loss** for Kubrick.

**Do not build a new wagering model.** Keep Kubrick's existing `contracts/bettings.schema.json` and `betType`, plus the established race, runner, financial and summary fields wherever they work. Start with **Normaliser-only** changes; allow small Kubrick changes only when required to represent an exotic honestly. Kubrick must not implement TAB bet rules.

This document tracks **planned release coverage**, not a claim that the code already works for every listed bet.

## Bet types — the one scope and status table

| Bet type / source label | Decision | Normaliser today | Why / outstanding work |
|---|---|---|---|
| Win | **Support now** | Standard cases recognised | Existing single-runner model; special settlements deferred |
| Place | **Support now** | Standard cases recognised | Existing single-runner model |
| Each Way / Win and Place | **Support now** | Partial | One source bet with WIN and PLACE components; reconcile correctly |
| Quinella | **Not yet supported** | Not supported | No Quinella example in the supplied August/September CSVs; revisit when a real sample is available |
| Exacta | **Support now** | Not supported | Pick first two in exact order |
| Duet | **Support now** | Not supported | Two selected runners in first three |
| Trifecta (including Boxed) | **Support now** | Partial | Handle multiple selections, ordering and verified outcomes |
| First 4 | **Support now** | Partial | Handle positional selections, combinations and verified outcomes |
| Running Double | **Not yet supported** | Not supported | Multi-race wager |
| Daily Double | **Not yet supported** | Not supported | Multi-race wager |
| Treble | **Not yet supported** | Not supported | Multi-race wager |
| Quaddie / Quadrella | **Not yet supported** | Not supported | Four race legs; deliberately deferred |
| Early Quaddie | **Not yet supported** | Not supported | Four race legs |
| Big 6 | **Not yet supported** | Not supported | Six race legs / special dividends |
| Parlay Formula | **Not yet supported** | Not supported | Multi-leg reinvestment |
| All-ups | **Not yet supported** | Not supported | Multi-leg reinvestment |
| Mystery Bet | **Not yet supported** | Not supported | System-generated selections; underlying type may vary |
| 3UP Betting | **Not yet supported** | Not supported | Composite mystery wager |
| Fixed Odds Multi | **Not yet supported** | Parser recognises some | Multi-leg wager cannot be faithfully represented by current Kubrick input |

**Boxed Trifecta is a Trifecta variation**, not an extra underlying bet type. “Support now” means **in scope to implement**, not yet production-ready. A bet type can be in scope while a particular structure or unusual settlement is still unsupported.

## What we are *not* modelling now

Do **not** add `betStructure`, `stakingMethod`, `betComposition` or other new canonical/Kubrick fields just to categorise wagering terminology.

- **Straight, Boxed, Standout, Roving Banker**: parsing details the Normaliser may need to interpret selections correctly, **not mandatory new model fields**. Support only the variants proven by the supplied CSVs and tests.
- **Flexi**: the Normaliser may need to read it to understand the stake/dividend, but Kubrick only needs correctly reconciled money and an accurate bet outcome. No new staking model for now.
- **Promotions / special settlement**: payout multipliers, Boost/Pump, Bonus Bets, refunds/voids, deductions, dead heats and unsettled future bets are **not yet supported for full end-to-end recap handling**. Record/exclude them explicitly rather than silently assigning an incorrect WIN/LOSS or P&L.
- **Multi-race bets**: no `legs[]` redesign in this release.
- **Meeting-name / historical-enrichment failures**: separate from wager types; fix independently.

Preserve the original CSV rows and transaction linkage for reconciliation and later work. **Never invent a runner, finishing position, odds, outcome or payout** merely to satisfy Kubrick's current schema. If a wager cannot be faithfully represented, report it as excluded with a reason.

## Existing Kubrick interface: reuse first

The current `bettings.json` v1.0 already contains `betType`, `stake`, `return`, `result`, `profitLoss`, `runningPnl`, race/runner references, replay URL and day summary.

Its current single-runner requirements (`runnerName`, `runnerNumber`, `finishingPosition`, positive `odds`) may not fit Quinella, Trifecta or First 4. **Only after testing real examples** decide the smallest possible contract/planner adjustment; the Normaliser continues to own all betting logic.

## Real CSV cases to test

These are known **horse-racing statement examples**, not proof of current support:

| Transaction | What it demonstrates | Release handling |
|---|---|---|
| `48125370710253917` | DUBBO Trifecta, four selections **3,4,5,10**, Flexi **41.6666%**, lost | In-scope Trifecta; verify multi-selection/Flexi parsing |
| `36232613608437917` | First 4 with different permitted runners for each finishing position | In-scope First 4; preserve positional meaning |
| `44767199077494901` | Win and Place **$25 WIN + $25 PLACE**, base payout **$500** plus separate **$100** multiplier (total **$600**) | Base Win/Place in scope; modifier **deferred** — don't miscount credit |
| `89871670719679901` | Win and Place with separate multiplier bonus | Base bet in scope; bonus **deferred** |
| `58633209170384901` | $60 Fixed Odds Win refund | Refund handling **deferred** |
| `6198331609126901` | Win funded by Bonus Bet | Bonus Bet handling **deferred** |
| `87975099468825901` | Future-event Win not yet settled in statement | Unsettled handling **deferred** |
| `53283602338122917` | Winning Quadrella, $50 stake, $59.90 payout, 52.0833% Flexi | **Not yet supported** |
| `23154443459835917` | Quadrella Flexi **916.6666%** — do not assume percentage <=100 | **Not yet supported** |
| `53954834893107901` | Unequal WIN $70 / PLACE $78 stakes | In-scope Win and Place; verify component accounting |

**Evidence source:** August and September 2026 TAB CSV statements supplied for the study. Horse-racing transactions only; do not count other racing or sports as supported.

## Implementation order

1. Use the **actual supplied CSVs** as fixtures; classify horse wagers by source transaction and bet type.
2. First ensure ordinary **Win, Place and Win and Place** reconcile correctly; separate unsupported bonus/refund/promotion transactions.
3. Prioritise **only bet types evidenced in the supplied CSVs**, beginning with **Trifecta (including Boxed) and First 4** after the existing simple types. Keep Quinella and any other unobserved bet type deferred until an actual CSV example is supplied.
4. For each supported wager, verify **stake, credited return, outcome and P&L** against the CSV, without double-counting component or payout rows.
5. Check compatibility with the existing `bettings.json` contract. If a genuine multi-runner mismatch is encountered, propose the **smallest** Kubrick-facing change and test planner/builder behaviour.
6. Report every unsupported or quarantined horse transaction and its reason; compare coverage across both CSV files.

**Not part of this work:** building a full betting taxonomy, supporting every TAB feature, adding multi-race Kubrick scenes, or modelling promotions before we have a concrete requirement.

---
