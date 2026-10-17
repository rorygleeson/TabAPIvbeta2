"""Deterministic TAB race response retry and cache tests (no live API)."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "normaliser.py"
spec = importlib.util.spec_from_file_location("local_normaliser", MODULE_PATH)
normaliser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normaliser)

COMPLETE = {
    "raceNumber": 8, "raceName": "Handicap",
    "raceStartTime": "2026-09-18T07:20:00+00:00",
    "runners": [{"runnerNumber": 8, "finishingPosition": 0}],
    "results": [[14], [5], [7], [6]], "hasParimutuel": True,
}
DEGRADED = {
    "raceNumber": 8, "raceName": "Newcastle R08",
    "raceStartTime": "2026-09-18T00:00:00",
    "runners": [{"runnerNumber": 8, "finishingPosition": None}],
    "results": [[14], [5, 7]], "fixedOddsOnly": True,
}

class FakeHTTPResponse:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return json.dumps(self.payload).encode("utf-8")

class RaceRecoveryTests(unittest.TestCase):
    def client(self):
        return normaliser.TabHistoricalApi("https://example.invalid", "VIC", 2, 2)

    def test_degraded_then_complete_is_cached(self):
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", side_effect=[
            FakeHTTPResponse(DEGRADED), FakeHTTPResponse(DEGRADED),
            FakeHTTPResponse(COMPLETE),
        ]) as request, patch.object(normaliser.time, "sleep"):
            result = api.race("2026-09-18", "S", "R", 8)
            self.assertEqual(result["raceName"], "Handicap")
            self.assertEqual(api.race_calls, 3)
            self.assertEqual(api.race("2026-09-18", "S", "R", 8), COMPLETE)
            self.assertEqual(request.call_count, 3)

    def test_all_degraded_preserves_partial_separately(self):
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", return_value=FakeHTTPResponse(DEGRADED)) as request, patch.object(normaliser.time, "sleep"):
            self.assertEqual(api.race("2026-09-18", "S", "R", 8), DEGRADED)
            self.assertEqual(request.call_count, 6)
            self.assertEqual(len(api.response_cache), 0)
            self.assertEqual(len(api.partial_response_cache), 1)

    def test_complete_single_request(self):
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", return_value=FakeHTTPResponse(COMPLETE)) as request:
            api.race("2026-09-18", "S", "R", 8)
            self.assertEqual(request.call_count, 1)

    def test_legitimate_fixed_only_not_rejected(self):
        valid_fixed = dict(DEGRADED, raceStartTime="2026-09-18T07:20:00+00:00",
                           resultedTime="2026-09-18T07:23:00+00:00")
        self.assertIsNone(self.client()._race_response_warning(valid_fixed))

    def test_unplaced_zero_is_not_missing(self):
        record = dict(DEGRADED, raceStartTime="2026-09-18T07:20:00+00:00",
                      runners=[{"runnerNumber": 8, "finishingPosition": 0}])
        self.assertIsNone(self.client()._race_response_warning(record))

    def test_rejects_wrong_race_number_then_recovers(self):
        wrong = dict(COMPLETE, raceNumber=9)
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", side_effect=[
            FakeHTTPResponse(wrong), FakeHTTPResponse(COMPLETE),
        ]) as request, patch.object(normaliser.time, "sleep"):
            result = api.race("2026-09-18", "S", "R", 8)
            self.assertEqual(result["raceNumber"], 8)
            self.assertEqual(request.call_count, 2)

    def test_fixed_only_placeholder_without_null_positions_is_degraded(self):
        record = dict(DEGRADED, runners=[{"runnerNumber": 8, "finishingPosition": 0}])
        self.assertIsNotNone(self.client()._race_response_warning(record))

    def test_http_error_retries_still_bounded(self):
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", side_effect=TimeoutError("timeout")) as request, patch.object(normaliser.time, "sleep"):
            with self.assertRaises(RuntimeError):
                api.race("2026-09-18", "S", "R", 8)
            self.assertEqual(request.call_count, 3)

    def test_partial_cache_shared_across_three_bets(self):
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", return_value=FakeHTTPResponse(DEGRADED)) as request, patch.object(normaliser.time, "sleep"):
            for _ in range(3):
                self.assertEqual(api.race("2026-09-18", "S", "R", 8), DEGRADED)
            self.assertEqual(request.call_count, 6)
            self.assertEqual(api.cache_hits, 2)

    def test_catalogue_untouched(self):
        api = self.client()
        with patch.object(normaliser.urllib.request, "urlopen", return_value=FakeHTTPResponse({"meetings": []})) as request:
            self.assertEqual(api.date("2026-09-18"), {"meetings": []})
            self.assertEqual(request.call_count, 1)

if __name__ == "__main__":
    unittest.main()
