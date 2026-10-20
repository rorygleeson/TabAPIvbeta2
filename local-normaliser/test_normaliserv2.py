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

    def test_australian_state_names_match_codes_without_weakening_identity(self):
        cases = [
            ("CAULFIELD", "VIC", "Victoria", "M", 2),
            ("CAULFIELD", "VIC", "Victoria", "M", 7),
            ("BROOME", "WA", "Western Australia", "J", 7),
            ("RANDWICK", "NSW", "New South Wales", "R", 1),
            ("EAGLE FARM", "QLD", "Queensland", "E", 1),
            ("MORPHETTVILLE", "SA", "South Australia", "S", 1),
            ("LAUNCESTON", "TAS", "Tasmania", "L", 1),
            ("ALICE SPRINGS", "NT", "Northern Territory", "A", 1),
            ("CANBERRA", "ACT", "Australian Capital Territory", "C", 1),
        ]
        for name, code, long_name, venue, race_number in cases:
            with self.subTest(meeting=name, code=code):
                meeting = {"meetingName": name, "location": code,
                           "venueMnemonic": venue, "raceType": "R"}
                actual = {"raceNumber": race_number,
                          "meeting": {"meetingName": name.title(), "location": long_name,
                                      "venueMnemonic": venue, "raceType": "R"}}
                self.assertTrue(self.api.verified(actual, meeting, race_number, venue, "R", True))
                actual["meeting"]["location"] = "Western Australia" if code != "WA" else "Victoria"
                self.assertFalse(self.api.verified(actual, meeting, race_number, venue, "R", True))
                actual["meeting"]["location"] = long_name
                actual["meeting"]["meetingName"] = "OTHER MEETING"
                self.assertFalse(self.api.verified(actual, meeting, race_number, venue, "R", True))

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

    def test_number_only_is_not_verified(self):
        self.assertFalse(self.api.verified({"raceNumber": 4, "runners": [{"runnerNumber": 1}]},
                                            self.meeting, 4, "E", "R", True))

    def test_matching_name_is_positive_identity(self):
        self.assertTrue(self.api.verified({"raceNumber": 4, "meetingName": "ECHUCA"},
                                           self.meeting, 4, "E", "R", True))

    def test_missing_meeting_never_calls_legacy(self):
        self.api.meetings_by_day["2025-11-04"] = []
        with patch.object(v2.v1.TabHistoricalApi, "race", side_effect=AssertionError("unsafe legacy fallback")):
            with self.assertRaisesRegex(RuntimeError, "unique date-level meeting"):
                self.api.race("2025-11-04", "E", "R", 4)

    def test_missing_race_listing_allows_unique_meeting(self):
        self.meeting["races"] = []
        self.assertEqual(self.api.meeting("2025-11-04", "E", "R", 4), self.meeting)

    def test_unique_meeting_with_incomplete_race_list_is_probed(self):
        # Matches the V1 fast path when TAB's date race list omits a race.
        for name, venue, number in (("LOS ALAMITOS", "E", 4),
                                     ("GOLD COAST", "L", 2),
                                     ("CARNARVON", "J", 1),
                                     ("KEMBLA GRANGE", "P", 7)):
            with self.subTest(name=name):
                meeting = {"meetingName": name, "venueMnemonic": venue, "raceType": "R",
                           "location": "NSW", "races": [{"raceNumber": 99}]}
                self.api.meetings_by_day["2025-11-04"] = [meeting]
                self.assertIs(self.api.meeting("2025-11-04", venue, "R", number), meeting)
                response = {"raceNumber": number, "meetingName": name, "raceType": "R",
                            "raceStartTime": "2025-11-04T04:30:00Z",
                            "resultedTime": "2025-11-04T04:45:00Z",
                            "runners": [{"runnerNumber": 1, "finishingPosition": 1}]}
                with patch.object(self.api, "request_once", return_value=response) as request:
                    self.assertEqual(self.api.race("2025-11-04", venue, "R", number), response)
                    self.assertIn("/races/" + str(number), request.call_args.args[0])

    def test_incomplete_listing_does_not_accept_wrong_meeting(self):
        self.meeting["races"] = [{"raceNumber": 99}]
        wrong = {"raceNumber": 4, "meetingName": "OTHER TRACK", "raceType": "R"}
        with patch.object(self.api, "request_once", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "No verified race"):
                self.api.race("2025-11-04", "E", "R", 4)
        self.assertFalse(self.api.verified(wrong, self.meeting, 4, "E", "R", True))

    def test_v1_selected_meeting_disambiguates_duplicate_venue(self):
        # Day listing contains two meetings with same mnemonic and type.
        for name, venue, num in (("LOS ALAMITOS", "E", 4),
                                  ("GOLD COAST", "L", 2),
                                  ("CARNARVON", "J", 1),
                                  ("KEMBLA GRANGE", "P", 7)):
            with self.subTest(name=name):
                selected = {"meetingName": name, "venueMnemonic": venue,
                            "raceType": "R", "location": "NSW", "races": []}
                other = {"meetingName": "OTHER", "venueMnemonic": venue,
                         "raceType": "R", "location": "VIC", "races": []}
                self.api.meetings_by_day["2025-11-04"] = [other, selected]
                self.assertIsNone(self.api.meeting("2025-11-04", venue, "R", num))
                self.api.require_bet({"eventDate": "2025-11-04", "raceNumber": num,
                                      "betType": "WIN", "pricingType": "FIXED"}, selected)
                self.assertIs(self.api.meeting("2025-11-04", venue, "R", num), selected)
                expected = {"raceNumber": num, "meetingName": name,
                            "raceStartTime": "2025-11-04T04:30:00Z",
                            "resultedTime": "2025-11-04T04:40:00Z",
                            "runners": [{"runnerNumber": 1, "finishingPosition": 1}]}
                with patch.object(self.api, "request_once", return_value=expected):
                    self.assertEqual(self.api.race("2025-11-04", venue, "R", num), expected)

    def test_selected_meeting_must_still_exist_on_day(self):
        self.api.meetings_by_day["2025-11-04"] = [self.meeting]
        impostor = {"meetingName": "OTHER", "venueMnemonic": "E", "raceType": "R"}
        self.api.require_bet({"eventDate": "2025-11-04", "raceNumber": 4}, impostor)
        self.assertIsNone(self.api.meeting("2025-11-04", "E", "R", 4))

    def test_jurisdiction_probe_is_bounded(self):
        self.assertEqual(self.api.JURISDICTIONS if hasattr(self.api, "JURISDICTIONS") else (), ())
        incomplete = {"raceNumber": 4, "meetingName": "ECHUCA",
                      "raceStartTime": "2025-11-04T00:00:00",
                      "runners": [{"runnerNumber": 1, "finishingPosition": None}]}
        with patch.object(self.api, "request_once", return_value=incomplete) as req:
            with patch.object(v2.v1.TabHistoricalApi, "race", side_effect=RuntimeError("offline")):
                self.api.race("2025-11-04", "E", "R", 4)
        self.assertLessEqual(req.call_count, 4)

    def test_legacy_fallback_rejects_number_only_response(self):
        bad = {"raceNumber": 4, "runners": [{"runnerNumber": 1, "finishingPosition": 1}],
               "raceStartTime": "2025-11-04T04:30:00Z"}
        with patch.object(self.api, "request_once", return_value=None):
            with patch.object(v2.v1.TabHistoricalApi, "race", return_value=bad):
                with self.assertRaisesRegex(RuntimeError, "No verified race"):
                    self.api.race("2025-11-04", "E", "R", 4)

    def test_self_link_race_coordinates_checked(self):
        correct = self.meeting["races"][0]["_links"]["self"]["href"]
        self.assertEqual(self.api.race_self_url(correct, "2025-11-04", "E", "R", 4), correct)
        self.assertIsNone(self.api.race_self_url(correct.replace("/races/4", "/races/5"), "2025-11-04", "E", "R", 4))
        self.assertIsNone(self.api.race_self_url(correct.replace("/VIC/racing/", "/VIC/other/"), "2025-11-04", "E", "R", 4))

    def test_probe_continues_after_partial_self_link(self):
        partial = {"raceNumber": 4, "meetingName": "ECHUCA", "raceStartTime": "2025-11-04T00:00:00",
                   "runners": [{"runnerNumber": 1, "finishingPosition": None}]}
        full = {"raceNumber": 4, "meetingName": "ECHUCA", "raceStartTime": "2025-11-04T04:00:00Z",
                "resultedTime": "2025-11-04T04:10:00Z", "runners": [{"runnerNumber": 1, "finishingPosition": 1}]}
        with patch.object(self.api, "request_once", side_effect=lambda url, *_a, **_k: full if "/NSW/" in url else partial):
            self.assertEqual(self.api.probe_race("2025-11-04", "E", "R", 4), full)

    def test_bet_specific_dividend_changes_completeness(self):
        race = {"raceNumber": 4, "meetingName": "ECHUCA", "raceStartTime": "2025-11-04T04:00:00Z",
                "resultedTime": "2025-11-04T04:10:00Z",
                "runners": [{"runnerNumber": 1, "finishingPosition": 1}]}
        self.assertIsNone(self.api.incomplete(race, 4))
        self.assertEqual(self.api.incomplete(race, 4, {"dividends": {(1, "returnWin")}}),
                         "required tote dividend missing")

    def test_duplicate_url_attempt_reused(self):
        race = {"raceNumber": 4, "meetingName": "ECHUCA"}
        with patch("urllib.request.urlopen") as get:
            get.return_value.__enter__.return_value.read.return_value = __import__("json").dumps(race).encode()
            url = self.meeting["races"][0]["_links"]["self"]["href"]
            self.assertEqual(self.api.request_once(url, self.meeting, 4, "E", "R", False), race)
            self.assertEqual(self.api.request_once(url, self.meeting, 4, "E", "R", False), race)
            self.assertEqual(get.call_count, 1)

    def test_authoritative_scheduled_type_differs_from_race_type(self):
        # Real TAB 2026-09-12 Los Alamitos: raceType=R, scheduledType=G.
        date, venue, typ, number = "2026-09-12", "E", "R", 4
        good_url = ("https://api.beta.tab.com.au/v1/historical-results-service/"
                    "VIC/racing/2026-09-12/E/G/races/4")
        meeting = {"meetingName": "LOS ALAMITOS", "location": "USA",
                   "venueMnemonic": "E", "raceType": "R",
                   "sellCode": {"scheduledType": "G"},
                   "races": [{"raceNumber": 4, "_links": {"self": good_url}}]}
        self.api.meetings_by_day[date] = [meeting]
        self.assertEqual(self.api.race_self_url(good_url, date, venue, typ, number), good_url)
        self.assertIsNone(self.api.race_self_url(good_url, date, venue, typ, 5))
        self.assertIsNone(self.api.race_self_url(good_url, date, "X", typ, number))
        good = {"raceNumber": 4, "raceName": "LOS ALAMITOS CLAIMING",
                "meeting": {"meetingDate": date, "meetingName": "LOS ALAMITOS",
                            "location": "USA", "raceType": "R", "venueMnemonic": "E"},
                "raceStartTime": "2026-09-11T21:43:00+00:00",
                "resultedTime": "2026-09-11T21:48:36+00:00",
                "runners": [{"runnerNumber": 3, "runnerName": "POP ROX", "finishingPosition": 3}]}
        wrong = {"raceNumber": 4, "meeting": {"meetingName": "MACKAY", "location": "QLD",
                                              "raceType": "R", "venueMnemonic": "E"},
                 "runners": [{"runnerNumber": 3, "runnerName": "ADMITTED", "finishingPosition": 3}]}
        self.assertFalse(self.api.verified(wrong, meeting, number, venue, typ, True))
        self.assertTrue(self.api.verified(good, meeting, number, venue, typ, False))
        urls = []
        def request(url, *args, **kwargs):
            urls.append(url)
            return good if url == good_url else None
        with patch.object(self.api, "request_once", side_effect=request):
            self.assertEqual(self.api.race(date, venue, typ, number), good)
        self.assertEqual(urls, [good_url])

    def test_self_link_must_stay_on_trusted_tab_host(self):
        bad = "https://example.com/v1/historical-results-service/VIC/racing/2026-09-12/E/G/races/4"
        self.assertIsNone(self.api.race_self_url(bad, "2026-09-12", "E", "R", 4))

    def test_external_self_link_rejected(self):
        self.assertIsNone(self.api.safe_url("https://example.org/evil"))
        self.assertIsNone(self.api.safe_url("http://api.beta.tab.com.au/v1/historical-results-service/VIC/racing/2025-11-04"))


if __name__ == "__main__":
    unittest.main()
