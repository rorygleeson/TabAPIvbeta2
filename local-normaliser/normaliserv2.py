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
    JURISDICTIONS = ("VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT")

    def __init__(self, base_url, jurisdiction, timeout, retries):
        super().__init__(base_url, jurisdiction, timeout, retries)
        self.meetings_by_day = {}
        self.decisions = []
        self.v2_cache = {}

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

    def date(self, event_date):
        data = super().date(event_date)
        self.meetings_by_day[str(event_date)] = v1.enrich_as_list(data.get("meetings")) if isinstance(data, dict) else []
        return data

    def meeting(self, date, venue, typ, number):
        matches = [m for m in self.meetings_by_day.get(str(date), [])
                   if isinstance(m, dict) and str(m.get("venueMnemonic")) == str(venue)
                   and v1.enrich_norm_text(m.get("raceType")) == v1.enrich_norm_text(typ)
                   and any(v1.enrich_to_int(r.get("raceNumber")) == number
                           for r in v1.enrich_as_list(m.get("races")) if isinstance(r, dict))]
        return matches[0] if len(matches) == 1 else None

    def verified(self, payload, meeting, number, venue, typ, alternative):
        if not isinstance(payload, dict) or v1.enrich_to_int(payload.get("raceNumber")) != number:
            return False
        if payload.get("raceType") and v1.enrich_norm_text(payload["raceType"]) != v1.enrich_norm_text(typ):
            return False
        nested = payload.get("meeting") if isinstance(payload.get("meeting"), dict) else {}
        given_name = v1.enrich_norm_text(payload.get("meetingName") or nested.get("meetingName"))
        wanted_name = v1.enrich_norm_text(meeting.get("meetingName"))
        if given_name and given_name != wanted_name:
            return False
        given_loc = v1.enrich_norm_text(payload.get("location") or nested.get("location"))
        wanted_loc = v1.enrich_norm_text(meeting.get("location"))
        if given_loc and wanted_loc and given_loc != wanted_loc:
            return False
        given_venue = v1.enrich_norm_text(payload.get("venueMnemonic"))
        if given_venue and given_venue not in {v1.enrich_norm_text(venue), wanted_name}:
            return False
        # Cross-jurisdiction probes need independent identity evidence.
        if alternative and not (given_name or given_loc or given_venue):
            return False
        return True

    @staticmethod
    def score(data):
        runners = [r for r in v1.enrich_as_list(data.get("runners")) if isinstance(r, dict)]
        valid_start = bool(v1.valid_scheduled_race_time(data.get("raceStartTime"), ""))
        # Validating against an empty event date is always false; use a simple
        # placeholder check for ranking, with V1 checking chronology later.
        start = str(data.get("raceStartTime") or "")
        timed = bool(start and "T00:00:00" not in start)
        return (len(runners) + 3 * sum(r.get("finishingPosition") is not None for r in runners)
                + 5 * int(timed) + 4 * int(bool(data.get("resultedTime")))
                + 3 * int(bool(data.get("results"))) + 2 * int(bool(v1.choose_replay_url(data))))

    def request_once(self, url, meeting, number, venue, typ, alternative):
        try:
            self.race_calls += 1
            request = __import__("urllib.request", fromlist=["Request"]).Request(
                url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
            with __import__("urllib.request", fromlist=["urlopen"]).urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            if not self.verified(data, meeting, number, venue, typ, alternative):
                self.decisions.append({"url": url, "result": "IDENTITY_REJECTED"})
                return None
            return data
        except Exception as ex:
            self.decisions.append({"url": url, "result": "FAILED", "error": str(ex)[:150]})
            return None

    def resolve(self, event_date, venue, typ, race_number, probe=False):
        number = v1.enrich_to_int(race_number)
        key = (str(event_date), str(venue), str(typ), number)
        if key in self.v2_cache:
            self.cache_hits += 1
            return self.v2_cache[key]
        meeting = self.meeting(event_date, venue, typ, number)
        if meeting is None:
            # Candidate discovery may lack unique date-level identity: preserve
            # V1's existing proof rules instead of guessing a meeting.
            return (super().probe_race if probe else super().race)(event_date, venue, typ, number)
        matches = [r for r in v1.enrich_as_list(meeting.get("races"))
                   if isinstance(r, dict) and v1.enrich_to_int(r.get("raceNumber")) == number]
        self_url = self.safe_url(self.self_link(matches[0])) if len(matches) == 1 else None
        suffix = (f"/racing/{urllib.parse.quote(str(event_date))}/"
                  f"{urllib.parse.quote(str(venue))}/{urllib.parse.quote(str(typ))}/races/{number}")
        routes = ([("SELF_LINK", self_url)] if self_url else [])
        for jur in (self.jurisdiction,) + tuple(j for j in self.JURISDICTIONS if j != self.jurisdiction):
            url = f"{self.base_url}/{jur}{suffix}"
            if url not in [u for _, u in routes]:
                routes.append((jur, url))
        best = None
        best_score = -1
        for label, url in routes:
            data = self.request_once(url, meeting, number, venue, typ,
                                     alternative=(label not in ("SELF_LINK", self.jurisdiction)))
            if data is None:
                continue
            value = self.score(data)
            if value > best_score:
                best, best_score, best_label = data, value, label
            warning = self._race_response_warning(data, number)
            self.decisions.append({"meeting": meeting.get("meetingName"), "race": number,
                                   "route": label, "result": "COMPLETE" if not warning else "PARTIAL",
                                   "warning": warning, "score": value})
            if not warning:
                print(f"      [V2] {meeting.get('meetingName')} R{number}: {label} verified complete")
                self.v2_cache[key] = data
                return data
            if probe:
                break
        if not probe:
            # Keep existing six-attempt V1 recovery if alternative probes remain incomplete.
            try:
                old = super().race(event_date, venue, typ, number)
                if self.verified(old, meeting, number, venue, typ, alternative=False):
                    if best is None or self.score(old) > best_score:
                        best, best_label = old, "V1_RETRY"
            except Exception:
                pass
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
    try:
        ok = v1.process_selected_day(
            selection["sourceCsvPath"], selection["selectedDate"], isolated_root,
            api, store, args.first_name, args.timezone, args.kubrick_api_url,
            os.environ.get("TAB_RECAP_API_KEY", "").strip(), args.kubrick_poll_interval,
            no_kubrick=args.no_kubrick)
        return 0 if ok else 2
    finally:
        diagnostics = isolated_root / "v2-api-diagnostics.json"
        v1.write_json(diagnostics, {"requests": api.decisions,
                                    "raceRequests": api.race_calls,
                                    "cacheHits": api.cache_hits})
        print(f"[V2] API diagnostics: {diagnostics}")


if __name__ == "__main__":
    sys.exit(main())
