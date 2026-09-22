#!/usr/bin/env python3
"""Regression: ambiguous racing candidates are domain-verified across R/G/H."""

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


class DummyStore:
    ambiguous = 0

    def __init__(self):
        self.saved = []

    def lookup(self, _source_meeting, _source_meeting_type):
        return [], "LOCAL_LOOKUP_MISS"

    def put_proven(self, source_meeting, source_meeting_type, meeting):
        self.saved.append((source_meeting, source_meeting_type, meeting.get("raceType")))


class DummyApi:
    jurisdiction = "VIC"

    def __init__(self):
        self.date_payload = {
            "meetings": [
                {
                    "meetingName": "HEALESVILLE",
                    "location": "VIC",
                    "venueMnemonic": "E",
                    "raceType": "G",
                    "races": [{"raceNumber": 2}],
                },
                {
                    "meetingName": "BORDERTOWN",
                    "location": "SA",
                    "venueMnemonic": "A",
                    "raceType": "R",
                    "races": [{"raceNumber": 2}],
                },
            ]
        }
        self.races = {
            ("E", "G", 2): {
                "raceNumber": 2,
                "raceName": "JASON MCKEOWN PHOTOGRAPHY",
                "raceStartTime": "2025-06-27T01:22:00+00:00",
                "runners": [
                    {
                        "runnerNumber": 5,
                        "runnerName": "NANDO BLAST",
                        "finishingPosition": 0,
                        "fixedOdds": {"bettingStatus": "Loser"},
                        "parimutuel": {"bettingStatus": "Normal"},
                    }
                ],
            },
            ("A", "R", 2): {
                "raceNumber": 2,
                "raceName": "HORSE RACE",
                "raceStartTime": "2025-06-27T02:00:00+00:00",
                "runners": [
                    {
                        "runnerNumber": 5,
                        "runnerName": "DIFFERENT HORSE",
                        "finishingPosition": 1,
                        "fixedOdds": {"bettingStatus": "Winner"},
                        "parimutuel": {"bettingStatus": "Normal"},
                    }
                ],
            },
        }

    def date(self, _event_date):
        return self.date_payload

    def race(self, _event_date, venue, race_type, race_number):
        return self.races[(venue, race_type, race_number)]


def make_bet():
    return {
        "canonicalId": "greyhound-domain-regression",
        "domainClassification": "HORSE_CANDIDATE",
        "eventDate": "2025-06-27",
        "betTime": "2025-06-27T01:10:00+00:00",
        "meeting": "HEALESVLL",
        "meetingType": None,
        "raceNumber": 2,
        "runnerNumber": 5,
        "runnerName": "NANDO BLAST",
        "pricingType": "FIXED",
        "betType": "PLACE",
        "stake": 10.0,
        "odds": 7.0,
        "payout": None,
        "betResult": "LOSS",
    }


def main() -> None:
    api = DummyApi()
    store = DummyStore()
    bet = make_bet()

    meeting, race, method, reason = normaliser.resolve_meeting_and_race(bet, api, store)
    assert meeting["meetingName"] == "HEALESVILLE", meeting
    assert meeting["raceType"] == "G", meeting
    assert race is None, race
    assert method == "NON_HORSE_API", method
    assert "DOMAIN_API_UNIQUE_EXACT_RUNNER" in reason, reason
    assert store.saved == [], store.saved

    enriched_bet, enrichment_exception = normaliser.enrich_one_bet(bet, api, DummyStore())
    assert enrichment_exception is None, enrichment_exception
    enrichment = enriched_bet["enrichment"]
    assert enrichment["status"] == "EXCLUDED_NON_HORSE", enrichment
    assert enrichment["stage"] == "DOMAIN_VERIFICATION", enrichment
    assert enriched_bet["excludeFromRecap"] is True, enriched_bet

    # Safety regression: exact runner identity must agree with runner number when
    # the CSV supplies one. A same-name/different-number candidate is not enough.
    wrong_number = make_bet()
    wrong_number["runnerNumber"] = 8
    meeting, race, method, _reason = normaliser.resolve_meeting_and_race(
        wrong_number, api, DummyStore()
    )
    assert meeting is None, meeting
    assert race is None, race
    assert method == "UNRESOLVED", method

    print("OK: ambiguous racing domain is proven across R/G/H; NANDO BLAST is excluded as greyhound.")


if __name__ == "__main__":
    main()
