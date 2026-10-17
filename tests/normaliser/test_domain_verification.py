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



def test_newcastle_degraded_cache_and_quarantine():
    """Exercise six attempts, shared race cache, partial fallback and quarantine."""
    import json
    import tempfile
    from unittest.mock import patch

    class Response:
        def __init__(self, payload):
            self.payload = payload
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self): return json.dumps(self.payload).encode("utf-8")

    meeting = {"meetingName": "NEWCASTLE", "location": "NSW",
               "venueMnemonic": "S", "raceType": "R", "races": [{"raceNumber": 8}]}
    date = {"meetings": [meeting]}
    partial = {"raceNumber": 8, "raceName": "NEWCASTLE R08 18/09",
               "raceStartTime": "2026-09-18T00:00:00", "fixedOddsOnly": True,
               "runners": [{"runnerNumber": 5, "runnerName": "MOTOSCAFO",
                            "finishingPosition": None}]}
    calls = []
    def urlopen(request, timeout=None):
        calls.append(request.full_url)
        return Response(date if request.full_url.endswith("/2026-09-18") else partial)

    api = normaliser.TabHistoricalApi("https://test.example", "VIC", 1, 2)
    with tempfile.TemporaryDirectory() as folder, patch.object(normaliser.urllib.request, "urlopen", urlopen), patch.object(normaliser.time, "sleep"):
        store = normaliser.MeetingResolutionStore(normaliser.Path(folder) / "mapping.json")
        bets = [
            {"canonicalId": "win", "eventDate": "2026-09-18", "meeting": "NEWCASTLE",
             "raceNumber": 8, "runnerName": "MOTOSCAFO", "betType": "WIN",
             "pricingType": "FIXED", "stake": 40, "odds": 4,
             "betResult": "LOSS", "domainClassification": "HORSE_CANDIDATE"},
            {"canonicalId": "place", "eventDate": "2026-09-18", "meeting": "NEWCASTLE",
             "raceNumber": 8, "runnerName": "MOTOSCAFO", "betType": "PLACE",
             "pricingType": "FIXED", "stake": 10, "odds": 3,
             "betResult": "LOSS", "domainClassification": "HORSE_CANDIDATE"},
        ]
        results = [normaliser.enrich_one_bet(b, api, store) for b in bets]
        assert len(calls) == 9, (len(calls), calls)
        assert len([x for x in calls if x.endswith("/races/8")]) == 6, calls
        assert len([x for x in calls if x.endswith("/races/7")]) == 1, calls
        assert len([x for x in calls if x.endswith("/races/9")]) == 1, calls
        assert api.discovery_calls == 0, api.discovery_calls
        assert api.degraded_races == 1, api.degraded_races
        assert all(item[0]["enrichment"]["status"] == "PARTIAL" for item in results)
        assert all(item[0]["enrichment"]["finishingPosition"] is None for item in results)
        print("OK: Newcastle mock made one date + six target calls + two bounded recovery probes, reused across bets.")


def test_quarantine_does_not_block_other_transactions():
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        base = {
            "eventDate": "2026-09-18", "betTime": "Fri Sep 18 2026 14:00:00",
            "meeting": "NEWCASTLE", "raceNumber": 8, "runnerName": "MOTOSCAFO",
            "runnerNumber": 5, "betType": "WIN", "pricingType": "FIXED",
            "stake": 40, "odds": 4, "betResult": "LOSS",
            "sequence": 1, "domainClassification": "HORSE_CANDIDATE",
            "enrichment": {"status": "PARTIAL", "raceTime": "2026-09-18T07:20:00+00:00",
                           "raceName": "NEWCASTLE R8", "meeting": "NEWCASTLE",
                           "state": "NSW", "raceNumber": 8, "runnerName": "MOTOSCAFO",
                           "runnerNumber": 5, "finishingPosition": None, "replayUrl": None},
        }
        invalid = dict(base, canonicalId="invalid", transactionNumber="101")
        valid = dict(base, canonicalId="valid", transactionNumber="102", sequence=2,
                     enrichment=dict(base["enrichment"], status="ENRICHED", finishingPosition=0))
        included, quarantined = normaliser.authoritative_transaction_partition(
            {"bets": [invalid, valid]}, "2026-09-18", "Customer", "Australia/Melbourne",
            ROOT / "local-normaliser", normaliser.Path(folder))
        assert [b["canonicalId"] for b in included] == ["valid"], included
        assert [q["transactionNumber"] for q in quarantined] == ["101"], quarantined
        print("OK: missing finishing position quarantined; valid separate bet retained.")


def test_method_three_recovers_supported_facts():
    class API:
        jurisdiction = "VIC"
        def date(self, value):
            return {"meetings": [{"meetingName": "NEWCASTLE", "location": "NSW",
                     "venueMnemonic": "S", "raceType": "R", "races": [{"raceNumber": 8}]}]}
        def race(self, date, venue, kind, number):
            return {"raceNumber": 8, "raceName": "NEWCASTLE R8",
                    "raceStartTime": "2026-09-18T00:00:00", "fixedOddsOnly": True,
                    "resultedTime": "2026-09-18T07:40:00+00:00",
                    "results": [{"runnerNumber": 5, "finishingPosition": 0}],
                    "runners": [{"runnerNumber": 5, "runnerName": "MOTOSCAFO",
                                 "finishingPosition": None}]}
        def probe_race(self, date, venue, kind, number):
            return {"raceNumber": number, "raceStartTime": "2026-09-18T07:00:00+00:00",
                    "runners": [{"runnerNumber": 1, "runnerName": "OTHER", "finishingPosition": 1}]}
    class Store:
        ambiguous = 0
        def lookup(self, *args): return [], "MISS"
        def put_proven(self, *args): return False
    bet = {"canonicalId": "recovery", "eventDate": "2026-09-18",
           "betTime": "Fri Sep 18 2026 15:00:00", "meeting": "NEWCASTLE",
           "raceNumber": 8, "runnerNumber": 5, "runnerName": "MOTOSCAFO",
           "betType": "WIN", "pricingType": "FIXED", "stake": 40, "odds": 5,
           "betResult": "LOSS", "domainClassification": "HORSE_CANDIDATE"}
    enriched, error = normaliser.enrich_one_bet(bet, API(), Store())
    assert error is None, error
    facts = enriched["enrichment"]
    assert facts["status"] == "ENRICHED", facts
    assert facts["finishingPosition"] == 0, facts
    assert facts["raceTimeSource"] == "ESTIMATED", facts
    assert normaliser.valid_scheduled_race_time(facts["raceTime"], "2026-09-18"), facts
    print("OK: method 3 recovers Win race time and official result position.")

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

    test_newcastle_degraded_cache_and_quarantine()
    test_quarantine_does_not_block_other_transactions()
    test_method_three_recovers_supported_facts()
    print("OK: ambiguous racing domain is proven across R/G/H; NANDO BLAST is excluded as greyhound.")


if __name__ == "__main__":
    main()
