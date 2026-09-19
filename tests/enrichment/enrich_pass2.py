#!/usr/bin/env python3
"""TAB Pass 2 enrichment test harness.

Reads frozen Pass 1 v1.7 output:
    working/<jobId>/normaliser/normalised-bets.json

Writes:
    working/<jobId>/enrichment/enriched-bets.json
    working/<jobId>/enrichment/exceptions.json
    working/<jobId>/enrichment/summary.json

Pass 2 does not modify Pass 1 files and does not create final bettings.json.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

BASE_URL = "https://api.beta.tab.com.au/v1/historical-results-service"
JURISDICTION = "VIC"
TIMEOUT = 25
RETRIES = 2

STATUS_ENRICHED = "ENRICHED"
STATUS_PARTIAL = "PARTIAL"
STATUS_UNRESOLVED = "UNRESOLVED"
STATUS_NOT_APPLICABLE = "NOT_APPLICABLE"

URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.I)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def norm_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", str(value).upper().strip())


def to_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def to_decimal(value: Any) -> Optional[Decimal]:
    try:
        if value is None or value == "":
            return None
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def money2(value: Any) -> Optional[Decimal]:
    d = to_decimal(value)
    return None if d is None else d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def load_aliases(script_dir: Path) -> Dict[str, str]:
    path = script_dir / "meeting_aliases.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "aliases" in payload:
        payload = payload["aliases"]
    if not isinstance(payload, dict):
        raise RuntimeError("meeting_aliases.json must contain an object")
    out = {}
    for alias, canonical in payload.items():
        a, c = norm_text(alias), norm_text(canonical)
        if not a or not c:
            raise RuntimeError(f"Invalid meeting alias: {alias!r} -> {canonical!r}")
        out[a] = c
    return out


class TabApi:
    def __init__(self, base_url: str, jurisdiction: str, timeout: int, retries: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.jurisdiction = jurisdiction.upper()
        self.timeout = timeout
        self.retries = retries
        self.date_cache: Dict[str, Any] = {}
        self.race_cache: Dict[Tuple[str, str, str, int], Any] = {}
        self.date_calls = 0
        self.race_calls = 0
        self.cache_hits = 0

    def _get(self, url: str, kind: str) -> Any:
        headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
        last_error = None
        for attempt in range(self.retries + 1):
            try:
                if kind == "date":
                    self.date_calls += 1
                else:
                    self.race_calls += 1
                print(f"      [API] GET {url}")
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=self.timeout) as response:
                    raw = response.read()
                    return json.loads(raw.decode("utf-8"))
            except Exception as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(attempt + 1)
        raise RuntimeError(f"TAB API request failed: {last_error}")

    def date(self, event_date: str) -> Any:
        if event_date in self.date_cache:
            self.cache_hits += 1
            return self.date_cache[event_date]
        url = f"{self.base_url}/{urllib.parse.quote(self.jurisdiction)}/racing/{urllib.parse.quote(event_date)}"
        data = self._get(url, "date")
        self.date_cache[event_date] = data
        return data

    def race(self, event_date: str, venue: str, race_type: str, race_number: int) -> Any:
        key = (event_date, venue, race_type, race_number)
        if key in self.race_cache:
            self.cache_hits += 1
            return self.race_cache[key]
        url = (
            f"{self.base_url}/{urllib.parse.quote(self.jurisdiction)}/racing/"
            f"{urllib.parse.quote(event_date)}/{urllib.parse.quote(venue)}/"
            f"{urllib.parse.quote(race_type)}/races/{race_number}"
        )
        data = self._get(url, "race")
        self.race_cache[key] = data
        return data


def as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def canonical_meeting(value: Any, aliases: Dict[str, str]) -> str:
    n = norm_text(value)
    return aliases.get(n, n)


def meeting_race_numbers(meeting: dict) -> set:
    out = set()
    for race in as_list(meeting.get("races")):
        if isinstance(race, dict):
            n = to_int(race.get("raceNumber"))
            if n is not None:
                out.add(n)
    return out


def match_meeting(date_payload: Any, meeting_name: str, race_number: int, aliases: Dict[str, str]) -> Tuple[Optional[dict], str]:
    if not isinstance(date_payload, dict):
        return None, "date endpoint did not return an object"
    meetings = [m for m in as_list(date_payload.get("meetings")) if isinstance(m, dict)]
    wanted = canonical_meeting(meeting_name, aliases)
    raw_wanted = norm_text(meeting_name)
    matches = [m for m in meetings if canonical_meeting(m.get("meetingName"), aliases) == wanted]
    if not matches:
        return None, f"no exact meetingName/verified-alias match for {meeting_name!r}"
    if len(matches) == 1:
        api_name = matches[0].get("meetingName")
        method = "EXACT" if norm_text(api_name) == raw_wanted else "VERIFIED_ALIAS"
        return matches[0], method
    by_race = [m for m in matches if race_number in meeting_race_numbers(m)]
    if len(by_race) == 1:
        return by_race[0], "EXACT_PLUS_RACE_NUMBER"
    return None, "ambiguous meeting match"


def match_runner(race_payload: Any, bet: dict) -> Tuple[Optional[dict], str]:
    if not isinstance(race_payload, dict):
        return None, "race endpoint did not return an object"
    runners = [r for r in as_list(race_payload.get("runners")) if isinstance(r, dict)]
    runner_no = to_int(bet.get("runnerNumber"))
    if runner_no is not None:
        matches = [r for r in runners if to_int(r.get("runnerNumber")) == runner_no]
        if len(matches) == 1:
            return matches[0], "RUNNER_NUMBER"
        if len(matches) > 1:
            return None, f"multiple runners with runnerNumber={runner_no}"

    runner_name = bet.get("runnerName")
    wanted = norm_text(runner_name)
    if wanted:
        matches = [r for r in runners if norm_text(r.get("runnerName")) == wanted]
        if len(matches) == 1:
            return matches[0], "RUNNER_NAME"
        if len(matches) > 1:
            return None, f"multiple runners with runnerName={runner_name!r}"

    if runner_no is not None:
        return None, f"no runner matched runnerNumber={runner_no}"
    if wanted:
        return None, f"no runner matched exact runnerName={runner_name!r}"
    return None, "no runner identity in Pass 1"


def extract_id(obj: dict, keys: Tuple[str, ...]) -> Optional[str]:
    for key in keys:
        value = obj.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def runner_id(runner: dict) -> Tuple[Optional[str], Optional[str]]:
    explicit = extract_id(runner, ("runnerId", "runnerID", "id"))
    if explicit:
        return explicit, "API_EXPLICIT"
    return None, None


def race_id(race: dict, jurisdiction: str, date: str, venue: str, race_type: str, race_number: int) -> Tuple[Optional[str], Optional[str]]:
    explicit = extract_id(race, ("raceId", "raceID", "id"))
    if explicit:
        return explicit, "API_EXPLICIT"
    return None, None


def recursive_urls(value: Any, key_path: str = "") -> List[str]:
    out: List[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            out.extend(recursive_urls(v, f"{key_path}.{k}" if key_path else str(k)))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            out.extend(recursive_urls(v, f"{key_path}[{i}]"))
    elif isinstance(value, str):
        lower_path = key_path.lower()
        for url in URL_RE.findall(value):
            clean = url.rstrip(".,);]")
            if ".mp4" in clean.lower() or any(x in lower_path for x in ("replay", "video", "media")):
                out.append(clean)
    return out


def replay_url(race: dict) -> Optional[str]:
    urls = recursive_urls(race)
    for url in urls:
        if ".mp4" in url.lower():
            return url
    return urls[0] if urls else None


def race_enrichment(meeting: dict, race: dict, jurisdiction: str, event_date: str, venue: str, race_type: str, race_number: int, meeting_method: str) -> dict:
    rid, rid_source = race_id(race, jurisdiction, event_date, venue, race_type, race_number)
    return {
        "meetingMatch": meeting_method,
        "venueMnemonic": venue,
        "raceType": race_type,
        "raceTime": race.get("raceStartTime"),
        "raceId": rid,
        "raceIdSource": rid_source,
        "raceName": race.get("raceName"),
        "meeting": meeting.get("meetingName"),
        "state": meeting.get("location"),
        "raceNumber": to_int(race.get("raceNumber")) or race_number,
        "replayUrl": replay_url(race),
    }


def selected_runner_details(race: dict, runner_numbers: List[int]) -> Tuple[List[dict], List[int]]:
    runners = [r for r in as_list(race.get("runners")) if isinstance(r, dict)]
    found, missing = [], []
    for number in runner_numbers:
        matches = [r for r in runners if to_int(r.get("runnerNumber")) == number]
        if len(matches) != 1:
            missing.append(number)
            continue
        r = matches[0]
        rid, _ = runner_id(r)
        raw_pos = to_int(r.get("finishingPosition"))
        found.append({
            "runnerId": rid,
            "runnerNumber": number,
            "runnerName": r.get("runnerName"),
            "finishingPosition": raw_pos if raw_pos is not None and raw_pos >= 0 else None,
            "apiFinishingPositionRaw": raw_pos,
        })
    return found, missing


def official_result_order(race: dict) -> List[dict]:
    out = []
    for r in as_list(race.get("runners")):
        if not isinstance(r, dict):
            continue
        pos = to_int(r.get("finishingPosition"))
        if pos is None or pos <= 0:
            continue
        rid, _ = runner_id(r)
        out.append({
            "finishingPosition": pos,
            "runnerId": rid,
            "runnerNumber": to_int(r.get("runnerNumber")),
            "runnerName": r.get("runnerName"),
        })
    return sorted(out, key=lambda x: (x["finishingPosition"], x.get("runnerNumber") or 9999))


def classify(bet: dict) -> str:
    if bet.get("betType") == "MULTI":
        return "NON_RACING_MULTI"
    if bet.get("pricingType") == "TOTE":
        return "RACING"
    if bet.get("pricingType") == "FIXED":
        if bet.get("meeting") and to_int(bet.get("raceNumber")) is not None and bet.get("runnerName"):
            return "RACING"
        return "NON_RACING_OR_UNSTRUCTURED_FIXED"
    return "UNKNOWN"


def enrich_bet(bet: dict, api: TabApi, aliases: Dict[str, str]) -> Tuple[dict, Optional[dict]]:
    out = copy.deepcopy(bet)
    domain = classify(bet)

    if domain != "RACING":
        out["enrichment"] = {
            "status": STATUS_NOT_APPLICABLE,
            "reason": domain,
            "api": "TAB_HISTORICAL_RESULTS",
        }
        return out, None

    event_date = bet.get("eventDate")
    meeting_name = bet.get("meeting")
    race_number = to_int(bet.get("raceNumber"))

    missing = [name for name, value in (
        ("eventDate", event_date),
        ("meeting", meeting_name),
        ("raceNumber", race_number),
    ) if value in (None, "")]
    if missing:
        reason = f"racing bet missing lookup field(s): {', '.join(missing)}"
        out["enrichment"] = {"status": STATUS_UNRESOLVED, "stage": "INPUT", "reason": reason}
        return out, {"canonicalId": bet.get("canonicalId"), "stage": "INPUT", "reason": reason}

    try:
        day = api.date(str(event_date))
        meeting, meeting_method = match_meeting(day, str(meeting_name), int(race_number), aliases)
        if meeting is None:
            raise LookupError(meeting_method)

        venue = meeting.get("venueMnemonic")
        race_type = meeting.get("raceType")
        if not venue or not race_type:
            raise LookupError("matched meeting missing venueMnemonic or raceType")

        race = api.race(str(event_date), str(venue), str(race_type), int(race_number))
        if not isinstance(race, dict):
            raise LookupError("race endpoint did not return an object")

        enrich = race_enrichment(
            meeting, race, api.jurisdiction, str(event_date),
            str(venue), str(race_type), int(race_number), meeting_method,
        )

        if bet.get("betType") in ("TRIFECTA", "FIRST_4"):
            selections = [int(x) for x in bet.get("selections", [])]
            selected, missing_numbers = selected_runner_details(race, selections)
            enrich["selectedRunners"] = selected
            enrich["officialResultOrder"] = official_result_order(race)
            if missing_numbers:
                enrich.update({
                    "status": STATUS_PARTIAL,
                    "reason": f"selected runner(s) not found: {missing_numbers}",
                })
                out["enrichment"] = enrich
                return out, {
                    "canonicalId": bet.get("canonicalId"),
                    "stage": "EXOTIC_RUNNERS",
                    "reason": enrich["reason"],
                }
            enrich["status"] = STATUS_ENRICHED
            out["enrichment"] = enrich
            return out, None

        runner, runner_method = match_runner(race, bet)
        if runner is None:
            reason = runner_method
            enrich.update({"status": STATUS_UNRESOLVED, "stage": "RUNNER_MATCH", "reason": reason})
            out["enrichment"] = enrich
            return out, {
                "canonicalId": bet.get("canonicalId"),
                "stage": "RUNNER_MATCH",
                "reason": reason,
            }

        rid, rid_source = runner_id(runner)
        raw_position = to_int(runner.get("finishingPosition"))
        position = raw_position if raw_position is not None and raw_position >= 0 else None
        fixed = runner.get("fixedOdds") if isinstance(runner.get("fixedOdds"), dict) else {}
        tote = runner.get("parimutuel") if isinstance(runner.get("parimutuel"), dict) else {}

        enrich.update({
            "runnerMatch": runner_method,
            "runnerId": rid,
            "runnerIdSource": rid_source,
            "runnerNumber": to_int(runner.get("runnerNumber")),
            "runnerName": runner.get("runnerName"),
            "finishingPosition": position,
            "apiFinishingPositionRaw": raw_position,
            "fixedReturnWin": fixed.get("returnWin"),
            "fixedReturnPlace": fixed.get("returnPlace"),
            "toteReturnWin": tote.get("returnWin"),
            "toteReturnPlace": tote.get("returnPlace"),
        })

        if bet.get("betType") == "TOTE_WIN_PLACE":
            win_stake = money2(bet.get("winStake"))
            place_stake = money2(bet.get("placeStake"))
            combined_csv = money2(bet.get("combinedPayout"))
            win_div = to_decimal(tote.get("returnWin"))
            place_div = to_decimal(tote.get("returnPlace"))

            component = {
                "reconciled": False,
                "winReturn": None,
                "placeReturn": None,
                "calculatedCombinedReturn": None,
                "csvCombinedPayout": float(combined_csv) if combined_csv is not None else None,
            }

            if combined_csv is None:
                component.update({
                    "reconciled": True,
                    "outcome": "LOST_BOTH",
                    "winReturn": 0.0,
                    "placeReturn": 0.0,
                    "calculatedCombinedReturn": 0.0,
                })
            elif win_stake is not None and place_stake is not None:
                calc_win = money2(win_stake * win_div) if win_div is not None else Decimal("0.00")
                calc_place = money2(place_stake * place_div) if place_div is not None else Decimal("0.00")
                calc_total = money2(calc_win + calc_place)
                component.update({
                    "winReturn": float(calc_win),
                    "placeReturn": float(calc_place),
                    "calculatedCombinedReturn": float(calc_total),
                })
                if calc_total == combined_csv:
                    component["reconciled"] = True
                    if calc_win > 0 and calc_place > 0:
                        component["outcome"] = "WIN_AND_PLACE"
                    elif calc_place > 0:
                        component["outcome"] = "PLACE_ONLY"
                    else:
                        component["outcome"] = "UNRESOLVED_ZERO_COMPONENTS"

            enrich["toteWinPlaceResolution"] = component

        required_final_fields = (
            enrich.get("raceTime"), enrich.get("raceName"),
            enrich.get("meeting"), enrich.get("state"),
            enrich.get("runnerNumber"), enrich.get("runnerName"), enrich.get("finishingPosition"),
        )
        if all(v not in (None, "") for v in required_final_fields):
            enrich["status"] = STATUS_ENRICHED
            out["enrichment"] = enrich
            return out, None

        missing_final = [
            name for name, value in (
                ("raceTime", enrich.get("raceTime")),
                ("raceName", enrich.get("raceName")), ("meeting", enrich.get("meeting")),
                ("state", enrich.get("state")),
                ("runnerNumber", enrich.get("runnerNumber")), ("runnerName", enrich.get("runnerName")),
                ("finishingPosition", enrich.get("finishingPosition")),
            ) if value in (None, "")
        ]
        enrich.update({
            "status": STATUS_PARTIAL,
            "reason": f"API match succeeded but final-contract field(s) unavailable: {', '.join(missing_final)}",
        })
        out["enrichment"] = enrich
        return out, {
            "canonicalId": bet.get("canonicalId"),
            "stage": "FINAL_FIELD_COMPLETENESS",
            "reason": enrich["reason"],
        }

    except Exception as exc:
        reason = str(exc)
        out["enrichment"] = {"status": STATUS_UNRESOLVED, "stage": "API_LOOKUP", "reason": reason}
        return out, {"canonicalId": bet.get("canonicalId"), "stage": "API_LOOKUP", "reason": reason}


def process_job(job_dir: Path, api: TabApi, aliases: Dict[str, str]) -> Tuple[bool, dict]:
    input_path = job_dir / "normaliser" / "normalised-bets.json"
    output_dir = job_dir / "enrichment"
    payload = json.loads(input_path.read_text(encoding="utf-8"))

    if payload.get("normaliserSchemaVersion") != "1.7":
        raise RuntimeError(
            f"{input_path} is schema {payload.get('normaliserSchemaVersion')!r}; Pass 2 test expects frozen Pass 1 v1.7"
        )

    enriched_bets = []
    exceptions = []
    counts = Counter()

    for bet in payload.get("bets", []):
        enriched, exception = enrich_bet(bet, api, aliases)
        enriched_bets.append(enriched)
        status = enriched.get("enrichment", {}).get("status", STATUS_UNRESOLVED)
        counts[status] += 1
        if exception:
            exceptions.append(exception)

    out_payload = {
        "enrichmentSchemaVersion": "0.1-test",
        "normaliserSchemaVersion": "1.7",
        "jobId": payload.get("jobId"),
        "source": payload.get("source"),
        "bets": enriched_bets,
    }
    summary = {
        "jobId": payload.get("jobId"),
        "inputCanonicalBets": len(payload.get("bets", [])),
        "outputCanonicalBets": len(enriched_bets),
        "enriched": counts[STATUS_ENRICHED],
        "partial": counts[STATUS_PARTIAL],
        "unresolved": counts[STATUS_UNRESOLVED],
        "notApplicable": counts[STATUS_NOT_APPLICABLE],
        "exceptionCount": len(exceptions),
        "dateApiCallsCumulative": api.date_calls,
        "raceApiCallsCumulative": api.race_calls,
        "apiCacheHitsCumulative": api.cache_hits,
        "pass2Status": "COMPLETE",
    }

    write_json(output_dir / "enriched-bets.json", out_payload)
    write_json(output_dir / "exceptions.json", {"jobId": payload.get("jobId"), "exceptions": exceptions})
    write_json(output_dir / "summary.json", summary)
    return True, summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--working",
        default=str(Path(__file__).resolve().parent / "working"),
        help="Path containing Pass 1 job folders",
    )
    parser.add_argument("--base-url", default=BASE_URL)
    parser.add_argument("--jurisdiction", default=JURISDICTION)
    parser.add_argument("--timeout", type=int, default=TIMEOUT)
    parser.add_argument("--retries", type=int, default=RETRIES)
    args = parser.parse_args()

    working = Path(args.working).resolve()
    aliases = load_aliases(Path(__file__).resolve().parent)
    api = TabApi(args.base_url, args.jurisdiction, args.timeout, args.retries)

    jobs = sorted(
        p for p in working.iterdir()
        if p.is_dir() and (p / "normaliser" / "normalised-bets.json").exists()
    ) if working.exists() else []

    print("=== TAB PASS 2 ENRICHMENT — LOCAL TEST ===")
    print(f"Working     : {working}")
    print(f"Jobs        : {len(jobs)}")
    print(f"API         : {args.base_url}")
    print(f"Jurisdiction: {args.jurisdiction}")
    print(f"Aliases     : {len(aliases)}")
    print()

    if not jobs:
        print("No Pass 1 jobs found.")
        return 1

    failed = 0
    totals = Counter()

    for i, job in enumerate(jobs, start=1):
        print(f"[{i}/{len(jobs)}] {job.name}")
        try:
            _, summary = process_job(job, api, aliases)
            totals["enriched"] += summary["enriched"]
            totals["partial"] += summary["partial"]
            totals["unresolved"] += summary["unresolved"]
            totals["notApplicable"] += summary["notApplicable"]
            totals["exceptions"] += summary["exceptionCount"]
            print(
                f"      ENRICHED={summary['enriched']} PARTIAL={summary['partial']} "
                f"UNRESOLVED={summary['unresolved']} NOT_APPLICABLE={summary['notApplicable']}"
            )
        except Exception as exc:
            failed += 1
            print(f"      FAILED: {type(exc).__name__}: {exc}")
        print()

    print("=== PASS 2 RUN COMPLETE ===")
    print(f"Jobs failed    : {failed}")
    print(f"Enriched       : {totals['enriched']}")
    print(f"Partial        : {totals['partial']}")
    print(f"Unresolved     : {totals['unresolved']}")
    print(f"Not applicable : {totals['notApplicable']}")
    print(f"Exceptions     : {totals['exceptions']}")
    print(f"Date API calls : {api.date_calls}")
    print(f"Race API calls : {api.race_calls}")
    print(f"API cache hits : {api.cache_hits}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
