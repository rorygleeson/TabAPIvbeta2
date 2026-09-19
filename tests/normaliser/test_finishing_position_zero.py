#!/usr/bin/env python3
"""Regression: TAB finishingPosition=0 survives Normaliser -> Kubrick validation."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NORMALISER_PATH = ROOT / "local-normaliser" / "normaliser.py"

spec = importlib.util.spec_from_file_location("local_normaliser", NORMALISER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load {NORMALISER_PATH}")
normaliser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normaliser)


class DummyApi:
    jurisdiction = "VIC"


def main() -> None:
    bet = {
        "canonicalId": "zero-finish-regression",
        "domainClassification": "HORSE_CONFIRMED_CSV",
        "eventDate": "2025-06-27",
        "betTime": "2025-06-27T03:00:00+00:00",
        "meeting": "BORDERTOWN",
        "meetingType": "Gallops",
        "raceNumber": 6,
        "runnerNumber": 5,
        "runnerName": "AM I THE DRAMA",
        "pricingType": "FIXED",
        "betType": "WIN",
        "stake": 10.0,
        "odds": 5.0,
        "payout": None,
        "betResult": "LOSS",
    }

    meeting = {
        "meetingName": "BORDERTOWN",
        "location": "SA",
        "venueMnemonic": "A",
        "raceType": "R",
    }
    race = {
        "raceNumber": 6,
        "raceName": "BORDERTOWN STONE SUPPLIES 0 - 54",
        "raceStartTime": "2025-06-27T04:00:00+00:00",
        "runners": [
            {
                "runnerNumber": 5,
                "runnerName": "AM I THE DRAMA",
                "finishingPosition": 0,
                "fixedOdds": {"bettingStatus": "Loser"},
                "parimutuel": {"bettingStatus": "Normal"},
            }
        ],
    }

    original_resolver = normaliser.resolve_meeting_and_race
    normaliser.resolve_meeting_and_race = (
        lambda _bet, _api, _store: (meeting, race, "DIRECT", "regression fixture")
    )
    try:
        enriched_bet, enrichment_exception = normaliser.enrich_one_bet(
            bet,
            DummyApi(),
            object(),
        )
    finally:
        normaliser.resolve_meeting_and_race = original_resolver

    enrichment = enriched_bet["enrichment"]
    assert enrichment_exception is None, enrichment_exception
    assert enrichment["status"] == "ENRICHED", enrichment
    assert enrichment["finishingPosition"] == 0, enrichment
    assert "finishingPosition" not in enrichment.get("missingFields", []), enrichment

    candidate = normaliser.build_candidate_kubrick_payload(
        {"bets": [enriched_bet]},
        "2025-06-27",
        "Customer",
        "Australia/Melbourne",
    )
    assert candidate["bets"][0]["finishingPosition"] == 0, candidate["bets"][0]
    assert candidate["bets"][0]["result"] == "LOSS", candidate["bets"][0]

    errors = normaliser.validate_candidate_kubrick_payload(candidate)
    assert errors == [], errors

    print("OK: finishingPosition=0 survives enrichment, candidate build and portable Kubrick validation.")


if __name__ == "__main__":
    main()
