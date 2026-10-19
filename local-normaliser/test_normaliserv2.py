"""Offline regression checks for V2 resource selection. No TAB or Kubrick requests."""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location("normaliserv2", root / "normaliserv2.py")
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)


class RaceRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.api = v2.TabHistoricalApiV2("https://api.beta.tab.com.au/v1/historical-results-service", "VIC", 1, 0)
        self.meeting = {
            "meetingName": "ECHUCA", "venueMnemonic": "E", "location": "VIC", "raceType": "R",
            "races": [{"raceNumber": 4, "_links": {"self": {"href":
                "https://api.beta.tab.com.au/v1/historical-results-service/VIC/racing/2025-11-04/E/R/races/4"}}}]
        }
        self.api.meetings_by_day["2025-11-04"] = [self.meeting]

    def test_self_link_is_preferred(self):
        race = {"raceNumber": 4, "venueMnemonic": "E", "raceType": "R", "raceStartTime": "2025-11-04T04:30:00Z",
                "runners": [{"runnerNumber": 1, "finishingPosition": 1}], "resultedTime": "2025-11-04T04:40:00Z"}
        with patch.object(self.api, "request_once", return_value=race) as req:
            result = self.api.race("2025-11-04", "E", "R", 4)
            self.assertEqual(result, race)
            self.assertEqual(req.call_args.args[0], self.meeting["races"][0]["_links"]["self"]["href"])

    def test_wrong_meeting_rejected_even_for_http_200(self):
        wrong = {"raceNumber": 4, "meetingName": "WAGGA", "venueMnemonic": "W",
                 "raceType": "R", "runners": [{"runnerNumber": 1}]}
        self.assertFalse(self.api.verified(wrong, self.meeting, 4, "E", "R", True))

    def test_nsws_complete_race_beats_bad_vic_response(self):
        partial = {"raceNumber": 4, "meetingName": "ECHUCA", "venueMnemonic": "E",
                   "raceType": "R", "raceStartTime": "2025-11-04T00:00:00",
                   "runners": [{"runnerNumber": 1, "finishingPosition": None}]}
        full = {"raceNumber": 4, "meetingName": "ECHUCA", "venueMnemonic": "E",
                "raceType": "R", "raceStartTime": "2025-11-04T04:30:00Z",
                "resultedTime": "2025-11-04T04:40:00Z",
                "runners": [{"runnerNumber": 1, "finishingPosition": 1}]}
        def fake(url, *_args, **_kwargs):
            return full if "/NSW/" in url else partial
        with patch.object(self.api, "request_once", side_effect=fake):
            result = self.api.race("2025-11-04", "E", "R", 4)
        self.assertEqual(result, full)
        self.assertEqual(self.api.decisions[-1]["route"], "NSW")

    def test_external_self_link_rejected(self):
        self.assertIsNone(self.api.safe_url("https://example.org/evil"))
        self.assertIsNone(self.api.safe_url("http://api.beta.tab.com.au/v1/historical-results-service/VIC/racing/2025-11-04"))


if __name__ == "__main__":
    unittest.main()
