#!/usr/bin/env python3
"""Experimental TAB Normaliser V2. V1 remains the source of CSV and Kubrick logic.

Only historical race retrieval and output isolation differ. Self-links in TAB's
day-level race list take priority; jurisdiction variants require verified identity.
"""
import argparse
import json
import os
import shutil
import sys
import urllib.parse
from pathlib import Path

import normaliser as v1


class TabHistoricalApiV2(v1.TabHistoricalApi):

    def __init__(self, base_url, jurisdiction, timeout, retries):
        super().__init__(base_url, jurisdiction, timeout, retries)
        self.meetings_by_day = {}
        self.decisions = []
        self.v2_cache = {}
        self.url_attempts = {}
        self.active_requirements = {}

    @staticmethod
    def self_link(record):
        links = record.get("_links") if isinstance(record, dict) else None
        link = links.get("self") if isinstance(links, dict) else None
        return link.get("href") if isinstance(link, dict) else link if isinstance(link, str) else None

    def safe_url(self, href):
        if not href:
            return None
        url = urllib.parse.urljoin(self.base_url + "/", href)
        got, expected = urllib.parse.urlsplit(url), urllib.parse.urlsplit(self.base_url)
        if (got.scheme != "https" or got.hostname != expected.hostname
                or got.port or got.username or got.password
                or not got.path.startswith(expected.path.rstrip("/") + "/")):
            return None
        return url

    def race_self_url(self, href, date, venue, typ, number):
        url = self.safe_url(href)
        if not url:
            return None
        parts = urllib.parse.urlsplit(url).path.rstrip("/").split("/")
        # The canonical TAB historical race path must identify this exact race.
        if len(parts) < 7 or parts[-6] != "racing":
            return None
        if (parts[-5] != str(date) or parts[-4] != str(venue)
                or parts[-3] != str(typ) or parts[-2] != "races"
                or parts[-1] != str(number)):
            return None
        return url

    def require_bet(self, bet, meeting):
        """Capture specific runner/dividend requirements for this race."""
        number = v1.enrich_to_int(bet.get("raceNumber"))
        key = (str(bet.get("eventDate")), str(meeting.get("venueMnemonic")),
               str(meeting.get("raceType")), number)
        entry = self.active_requirements.setdefault(key, {"runners": set(), "dividends": set()})
        runner = v1.enrich_to_int(bet.get("runnerNumber"))
        if runner is not None:
            entry["runners"].add(runner)
            if bet.get("pricingType") == "TOTE":
                if bet.get("betType") in ("WIN", "TOTE_WIN_PLACE"):
                    entry["dividends"].add((runner, "returnWin"))
                if bet.get("betType") in ("PLACE", "TOTE_WIN_PLACE"):
                    entry["dividends"].add((runner, "returnPlace"))

    def date(self, event_date):
        data = super().date(event_date)
        self.meetings_by_day[str(event_date)] = v1.enrich_as_list(data.get("meetings")) if isinstance(data, dict) else []
        return data

    def meeting(self, date, venue, typ, number):
        # Mirror V1's unique-meeting behaviour: TAB day-level race lists can
        # be incomplete even when the meeting is unambiguous. A missing race
        # number blocks self-link lookup, NOT verified race endpoint probing.
        # The endpoint response must still pass V2's identity checks.
        matches = [m for m in self.meetings_by_day.get(str(date), [])
                   if isinstance(m, dict) and str(m.get("venueMnemonic")) == str(venue)
                   and v1.enrich_norm_text(m.get("raceType")) == v1.enrich_norm_text(typ)]
        if len(matches) != 1:
            return None
        return matches[0]

    def verified(self, payload, meeting, number, venue, typ, alternative):
        if not isinstance(payload, dict) or v1.enrich_to_int(payload.get("raceNumber")) != number:
            return False
        nested = payload.get("meeting") if isinstance(payload.get("meeting"), dict) else {}
        def norm(v):
            return v1.enrich_norm_text(v)
        actual_type = norm(payload.get("raceType") or nested.get("raceType"))
        if actual_type and actual_type != norm(typ):
            return False
        name = norm(payload.get("meetingName") or nested.get("meetingName"))
        expected = norm(meeting.get("meetingName"))
        loc = norm(payload.get("location") or nested.get("location"))
        expected_loc = norm(meeting.get("location"))
        venue_actual = norm(payload.get("venueMnemonic") or nested.get("venueMnemonic"))
        if name and name != expected:
            return False
        if loc and expected_loc and loc != expected_loc:
            return False
        if venue_actual and venue_actual not in {norm(venue), expected}:
            return False
        # Positive identity: matching name, or matching venue PLUS another
        # independent identifier. Race number alone is never sufficient.
        return bool(name == expected and name or
                    venue_actual == norm(venue) and venue_actual and
                    (actual_type == norm(typ) or loc == expected_loc and loc))

    def incomplete(self, data, number, requirements=None):
        warning = self._race_response_warning(data, number)
        if warning:
            return warning
        start = str(data.get("raceStartTime") or "")
        if "T00:00:00" in start:
            return "placeholder race start"
        runners = [r for r in v1.enrich_as_list(data.get("runners")) if isinstance(r, dict)]
        if runners and all(r.get("finishingPosition") is None for r in runners) and not data.get("results"):
            return "no official results or finishing positions"
        requirements = requirements or {}
        indexed = {v1.enrich_to_int(r.get("runnerNumber")): r for r in runners}
        for runner in requirements.get("runners", ()):
            if runner not in indexed:
                return "required runner missing"
        for runner, dividend in requirements.get("dividends", ()):
            payout = (indexed.get(runner, {}).get("parimutuel") or {}).get(dividend)
            if v1.enrich_to_decimal(payout) is None:
                return "required tote dividend missing"
        return None

    @staticmethod
    def score(data):
        runners = [r for r in v1.enrich_as_list(data.get("runners")) if isinstance(r, dict)]
        start = str(data.get("raceStartTime") or "")
        timed = bool(start and "T00:00:00" not in start)
        tote = sum(bool((r.get("parimutuel") or {}).get(k))
                   for r in runners if isinstance(r.get("parimutuel"), dict)
                   for k in ("returnWin", "returnPlace"))
        return (len(runners) + 3 * sum(r.get("finishingPosition") is not None for r in runners)
                + 5 * int(timed) + 4 * int(bool(data.get("resultedTime")))
                + 3 * int(bool(data.get("results"))) + 2 * int(bool(v1.choose_replay_url(data)))
                + 2 * tote)

    def request_once(self, url, meeting, number, venue, typ, alternative):
        if url in self.url_attempts:
            self.cache_hits += 1
            self.decisions.append({"url": url, "result": "ATTEMPT_REUSED"})
            return self.url_attempts[url]
        try:
            self.race_calls += 1
            request = __import__("urllib.request", fromlist=["Request"]).Request(
                url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
            with __import__("urllib.request", fromlist=["urlopen"]).urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            if not self.verified(data, meeting, number, venue, typ, alternative):
                self.decisions.append({"url": url, "result": "IDENTITY_REJECTED"})
                self.url_attempts[url] = None
                return None
            self.url_attempts[url] = data
            return data
        except Exception as ex:
            self.decisions.append({"url": url, "result": "FAILED", "error": str(ex)[:150]})
            self.url_attempts[url] = None
            return None

    def resolve(self, event_date, venue, typ, race_number, probe=False):
        number = v1.enrich_to_int(race_number)
        if number is None:
            raise RuntimeError("Missing race number")
        key = (str(event_date), str(venue), str(typ), number)
        if key in self.v2_cache:
            self.cache_hits += 1
            return self.v2_cache[key]
        meeting = self.meeting(event_date, venue, typ, number)
        if meeting is None:
            # V1's URL must not be accepted without independently verifiable
            # meeting identity. Prefer unresolved to contaminating Kubrick.
            self.decisions.append({"race": number, "result": "NO_UNIQUE_MEETING"})
            raise RuntimeError("Cannot verify a unique date-level meeting for this race")
        listed = [r for r in v1.enrich_as_list(meeting.get("races"))
                  if isinstance(r, dict) and v1.enrich_to_int(r.get("raceNumber")) == number]
        self_url = self.race_self_url(self.self_link(listed[0]), event_date, venue, typ, number) if len(listed) == 1 else None
        # A meeting-level self link is useful only if it already names the exact
        # requested race; never append a speculative path to a meeting URL.
        if not self_url:
            self_url = self.race_self_url(self.self_link(meeting), event_date, venue, typ, number)
        suffix = (f"/racing/{urllib.parse.quote(str(event_date))}/"
                  f"{urllib.parse.quote(str(venue))}/{urllib.parse.quote(str(typ))}/races/{number}")
        routes = ([("SELF_LINK", self_url)] if self_url else [])
        if not self_url:
            self.decisions.append({"meeting": meeting.get("meetingName"), "race": number,
                                   "result": "RACE_NOT_LISTED_TRY_VERIFIED_URL"})
        preferred = (self.jurisdiction, "NSW", "QLD")
        for jur in preferred:
            url = f"{self.base_url}/{jur}{suffix}"
            if url not in [u for _, u in routes]:
                routes.append((jur, url))
        # No blanket search of all states. Other jurisdictions are for a later
        # evidence-backed iteration, never a first-line discovery mechanism.
        best = None
        best_score = -1
        best_label = None
        requirements = self.active_requirements.get(key, {})
        for label, url in routes:
            data = self.request_once(url, meeting, number, venue, typ,
                                     alternative=(label != "SELF_LINK"))
            if data is None:
                continue
            value = self.score(data)
            warning = self.incomplete(data, number, requirements)
            ranking = (not bool(warning), value)
            if best is None or ranking > best_score:
                best, best_score, best_label = data, ranking, label
            self.decisions.append({"meeting": meeting.get("meetingName"), "race": number,
                                   "route": label, "result": "COMPLETE" if not warning else "PARTIAL",
                                   "warning": warning, "score": value})
            if not warning:
                print(f"      [V2] {meeting.get('meetingName')} R{number}: {label} verified complete")
                self.v2_cache[key] = data
                return data
            # Probe each distinct approved route once; no six-attempt recovery.
        if not probe:
            # V1 recovery remains available but its output is NOT exempt
            # from V2 positive meeting identity checks.
            # Legacy retries only when the V1 URL has not already been probed.
            legacy_url = f"{self.base_url}/{self.jurisdiction}{suffix}"
            if legacy_url not in self.url_attempts:
                try:
                    old = super().race(event_date, venue, typ, number)
                    if self.verified(old, meeting, number, venue, typ, alternative=True):
                        warning = self.incomplete(old, number, requirements)
                        ranking = (not bool(warning), self.score(old))
                        if best is None or ranking > best_score:
                            best, best_score, best_label = old, ranking, "V1_RETRY"
                except Exception as ex:
                    self.decisions.append({"race": number, "route": "V1_RETRY",
                                           "result": "FAILED", "error": str(ex)[:150]})
        if best is not None:
            self.decisions.append({"meeting": meeting.get("meetingName"), "race": number,
                                   "route": best_label, "result": "BEST_VERIFIED_PARTIAL"})
            self.v2_cache[key] = best
            return best
        raise RuntimeError("No verified race response from self-link, jurisdictions or V1 fallback")

    def race(self, event_date, venue_mnemonic, race_type, race_number):
        return self.resolve(event_date, venue_mnemonic, race_type, race_number)

    def probe_race(self, event_date, venue_mnemonic, race_type, race_number):
        return self.resolve(event_date, venue_mnemonic, race_type, race_number, probe=True)


def main():
    parser = argparse.ArgumentParser(description="TAB normaliser V2: self-link-first retrieval")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--base-url", default=v1.ENRICH_BASE_URL)
    parser.add_argument("--jurisdiction", default=v1.ENRICH_JURISDICTION)
    parser.add_argument("--timeout", type=int, default=v1.ENRICH_TIMEOUT)
    parser.add_argument("--retries", type=int, default=v1.ENRICH_RETRIES)
    parser.add_argument("--lookup-file", default="meeting-resolution.json")
    parser.add_argument("--first-name", default="Customer")
    parser.add_argument("--timezone", default="Australia/Melbourne")
    parser.add_argument("--kubrick-api-url", default=v1.DEFAULT_KUBRICK_API_URL)
    parser.add_argument("--kubrick-poll-interval", type=int, default=3)
    parser.add_argument("--no-kubrick", action="store_true")
    args = parser.parse_args()
    source_root = args.root.resolve()
    isolated_root = source_root / "v2"
    (isolated_root / "working").mkdir(parents=True, exist_ok=True)
    schema_source = source_root / "bettings.schema.json"
    if not schema_source.exists():
        print(f"Missing Kubrick schema: {schema_source}")
        return 2
    shutil.copyfile(schema_source, isolated_root / "bettings.schema.json")
    files = sorted((p for p in (source_root / "input").glob("*.csv") if p.is_file()), key=lambda p: p.name.lower())
    print("TAB DAILY RECAP - LOCAL NORMALISER V2")
    print(f"Input   : {source_root / 'input'}")
    print(f"Working : {isolated_root / 'working'}")
    if not files:
        print("No CSV files in shared input directory.")
        return 1
    days, errors = v1.scan_racing_days(files)
    if errors:
        print(f"[SCAN] {len(errors)} file(s) could not be scanned.")
    selection = v1.choose_racing_day(days) if days else None
    if not selection:
        return 1
    api = TabHistoricalApiV2(args.base_url, args.jurisdiction, args.timeout, args.retries)
    lookup_path = Path(args.lookup_file)
    if not lookup_path.is_absolute():
        lookup_path = isolated_root / lookup_path
    store = v1.MeetingResolutionStore(lookup_path)
    # Pre-index requirements from this same CSV before API selection. This
    # only reads local CSV data; source processing and contract logic remain V1.
    try:
        selected_day = selection["selectedDate"]
        raw, _, _ = v1.normalise_csv(selection["sourceCsvPath"], "v2-requirements")
        selected_bets = v1.filter_normalised_to_day(raw, selected_day).get("bets", [])
        by_date = {str(b.get("eventDate")) for b in selected_bets if b.get("eventDate")}
        for day in sorted(by_date):
            api.date(day)
        for bet in selected_bets:
            day = str(bet.get("eventDate"))
            num = v1.enrich_to_int(bet.get("raceNumber"))
            if num is None:
                continue
            meeting, _ = v1.match_meeting_exact(
                {"meetings": api.meetings_by_day.get(day, [])}, bet.get("meeting"), num)
            if meeting is not None:
                api.require_bet(bet, meeting)
    except Exception as ex:
        print(f"[V2] Requirement pre-index unavailable: {ex}")
    try:
        ok = v1.process_selected_day(
            selection["sourceCsvPath"], selection["selectedDate"], isolated_root,
            api, store, args.first_name, args.timezone, args.kubrick_api_url,
            os.environ.get("TAB_RECAP_API_KEY", "").strip(), args.kubrick_poll_interval,
            no_kubrick=args.no_kubrick)
        return 0 if ok else 2
    finally:
        # Preserve diagnostics per job/run rather than replacing previous evidence.
        from datetime import datetime
        diagnostics = isolated_root / "working" / ("v2-api-diagnostics-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".json")
        v1.write_json(diagnostics, {"requests": api.decisions,
                                    "raceRequests": api.race_calls,
                                    "cacheHits": api.cache_hits})
        print(f"[V2] API diagnostics: {diagnostics}")


if __name__ == "__main__":
    sys.exit(main())
