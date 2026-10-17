#!/usr/bin/env python3
"""TAB Daily Recap local Normaliser client.

Current controlled milestone:
- Stage 0: scan monthly CSVs and select one horse-racing day
- Pass 1: retain the proven v1.7/v0.9 parsing and horse-only classification
- Filter: keep only the selected eventDate
- Pass 2: retain historical enrichment + persistent local meeting resolution
- Candidate output: build and validate the exact Kubrick v1 canonical payload
- Kubrick client: POST /jobs, poll until terminal state, return READY recapUrl

Persistent learned meeting aliases are stored in a local JSON file beside the
test root. Kubrick API access uses TAB_RECAP_API_KEY from the environment; no
DynamoDB, boto3, AWS CLI, IAM, or AWS credentials are required.
"""
from __future__ import annotations

import argparse, csv, hashlib, json, os, re, shutil, sys, time
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

HEADER = ["Date & Time","Transaction Type","Transaction Category","Bet Type","Channel","Description","Amount","Fixed Price Odds","Results","Running Balance","Net Result"]
SUPPORTED = {
    ("Fixed Odds","Win"),("Fixed Odds","Place"),("Fixed Odds","Win and Place"),("Fixed Odds","Multi"),
    ("Parimutuel","Win"),("Parimutuel","Place"),("Parimutuel","Win and Place"),("Parimutuel","Trifecta"),("Parimutuel","First 4"),
}
MONEY_RE = re.compile(r"[-+]?\$?([0-9][0-9,]*(?:\.[0-9]+)?)")
TX_RE = re.compile(r"Transaction Number:\s*(\d+)", re.I)
DATE_RE = re.compile(r"Event Date:\s*(\d{8})", re.I)
RACE_RE = re.compile(r"Event/Race Number:\s*(\d+)", re.I)
EVENT_RE = re.compile(r"Event/Race Number:\s*(.+)$", re.I|re.M)
VENUE_RE = re.compile(r"Meeting Venue:\s*(.+?)(?:\s+(?:Gallops|Greyhounds|Harness))?$", re.I|re.M)
VENUE_DOMAIN_RE = re.compile(r"Meeting Venue:\s*.+?\s+(Gallops|Greyhounds|Harness)\s*$", re.I|re.M)
MEETING_TYPE_RE = re.compile(r"Meeting Type:\s*(\S+)", re.I)
STAKE_RE = re.compile(r"Stake:\s*\$([0-9,]+(?:\.[0-9]+)?)", re.I)
PRICE_RE = re.compile(r"@Price:\$?([0-9]+(?:\.[0-9]+)?)", re.I)
RETURN_RE = re.compile(r"(?:=Return:|Combined Return:)\$?([0-9,]+(?:\.[0-9]+)?)", re.I)
COMBINED_RE = re.compile(r"Combined Price:\s*\$?([0-9]+(?:\.[0-9]+)?)", re.I)
MULTI_RE = re.compile(r"Multibet\s+(\d+)\s+legs", re.I)
FLEXI_RE = re.compile(r"FLEXI\s+([0-9]+(?:\.[0-9]+)?)%", re.I)
FIXED_WP_RE = re.compile(r"^(WIN|PLA)\s+(.+)$", re.I)
TOTE_WP_RE = re.compile(r"^(WIN|PLA)\s+(\d+)\s*$", re.I)

FOOTER_KEYS = {
    "Opening Balance",
    "Closing Balance",
    "Total Deposits",
    "Total Withdrawals",
    "Total Adjustments",
    "Total Payouts",
    "Total Free Bets",
    "Total Net Results",
    "You Spent Total (incl bonus bets)",
}


def dec(v):
    if v is None or not str(v).strip(): return None
    try: return Decimal(str(v).strip().replace(",",""))
    except InvalidOperation: return None

def q2(v): return None if v is None else v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
def extract(rx, text):
    m = rx.search(text or ""); return m.group(1).strip() if m else None

def money(v):
    if v is None or not str(v).strip(): return None
    s=str(v).strip(); m=MONEY_RE.search(s.replace(",",""))
    if not m: return None
    try: x=Decimal(m.group(1))
    except InvalidOperation: return None
    return -x if s.startswith("-") else x

def event_date(desc):
    raw=extract(DATE_RE,desc)
    if not raw: return None
    try: return datetime.strptime(raw,"%Y%m%d").date().isoformat()
    except ValueError: return raw

def valid_date(v):
    try: datetime.strptime(v or "","%Y-%m-%d"); return True
    except ValueError: return False

def source_result(v):
    s=(v or "").strip().lower()
    return "WIN" if s=="pay/won" else "LOSS" if s=="lost" else None

def positive(v): return v is not None and v>0

def payload(desc):
    out=[]
    for line in (desc or "").splitlines():
        s=line.strip()
        if s and not re.match(r"^(Transaction Number|Event/Race Number|Event Date|Meeting Type|Meeting Venue|Stake):",s,re.I): out.append(s)
    return out

def raw_view(row):
    out = {k: row.get(k) for k in HEADER}
    out["sourceRow"] = row.get("_sourceRow")
    return out
def exc(kind,reason,tx,group,**extra):
    out={"type":kind,"reason":reason,"transactionNumber":tx,**extra}
    if group is not None: out["rawRecords"]=[raw_view(r) for r in group]
    return out

def json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Not JSON serializable: {type(value)}")

def write_json(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,indent=2,ensure_ascii=False,default=json_default)+"\n",encoding="utf-8")


def parse_csv(path):
    with path.open("r",encoding="utf-8-sig",newline="") as f: rows=list(csv.reader(f))
    period=rows[0][1].strip() if rows and len(rows[0])>=2 and rows[0][0].strip()=="Statement Period" else None
    hi=next((i for i,r in enumerate(rows) if r==HEADER),-1)
    if hi<0: raise ValueError("Expected TAB 11-column transaction header not found")
    tx=[]; footer={}; inside=True
    for i,row in enumerate(rows[hi+1:],hi+2):
        if inside and len(row)==11:
            d=dict(zip(HEADER,row)); d["_sourceRow"]=i; tx.append(d); continue
        if inside and (not row or (len(row)==1 and not row[0].strip())):
            inside=False
            continue
        if inside and len(row)>=2 and row[0].strip() in FOOTER_KEYS:
            inside=False
            footer[row[0].strip()]=row[1].strip()
            continue
        if inside and any(str(x).strip() for x in row):
            raise ValueError(f"Unexpected non-empty row shape at CSV row {i}: expected 11 transaction columns or recognised footer; got {len(row)} columns")
        if not inside and len(row)>=2 and row[0].strip():
            footer[row[0].strip()]=row[1].strip()
    return period,tx,footer


def common(row,pricing,bet_type):
    d=row.get("Description","")
    return {"transactionNumber":extract(TX_RE,d),"pricingType":pricing,"betType":bet_type,"betTime":row.get("Date & Time") or None,"eventDate":event_date(d),"betResult":source_result(row.get("Results","")),"enrichmentRequired":False}

def fixed_selection(desc):
    lines=payload(desc); raw=lines[-1] if lines else None
    if not raw: return {"meeting":None,"raceNumber":None,"selectionText":None,"runnerName":None}
    m=FIXED_WP_RE.match(raw); clean=m.group(2).strip() if m else raw
    clean=re.split(r"\s+@Price:",clean,maxsplit=1,flags=re.I)[0]
    clean=re.split(r"\s+Deductions Apply",clean,maxsplit=1,flags=re.I)[0]
    m=re.search(r"^(.+?)\s+R(\d{1,2})\s+\d{1,2}/\d{1,2}\s+(.+)$",clean,re.I)
    if not m: return {"meeting":None,"raceNumber":None,"selectionText":clean.strip(),"runnerName":None}
    sel=m.group(3).strip(); runner=re.sub(r"^PLC\s+\d+\s*-\s*\d+\s+","",sel,flags=re.I).strip() or None
    return {"meeting":m.group(1).strip(),"raceNumber":int(m.group(2)),"selectionText":sel,"runnerName":runner}

def tote_common(desc):
    rr=extract(RACE_RE,desc); lines=payload(desc)
    domain=extract(VENUE_DOMAIN_RE,desc)
    return {
        "meeting":extract(VENUE_RE,desc),
        "meetingType":extract(MEETING_TYPE_RE,desc),
        "meetingRacingType":domain.upper() if domain else None,
        "raceNumber":int(rr) if rr and rr.isdigit() else None,
        "selectionText":lines[-1] if lines else None,
    }


def domain_classification(bet):
    """Current product scope is horse/thoroughbred racing only.

    This runs after the frozen v1.7 parser has produced a valid canonical record.
    It does not change source parsing/grouping/settlement rules.
    """
    pricing=bet.get("pricingType")
    bet_type=bet.get("betType")
    explicit=(bet.get("meetingRacingType") or "").upper()

    if explicit == "GALLOPS":
        return "HORSE_CONFIRMED_CSV"
    if explicit in {"GREYHOUNDS", "HARNESS"}:
        return "NON_HORSE_RACING"

    if pricing == "TOTE":
        return "HORSE_CANDIDATE"

    if pricing == "FIXED":
        if bet_type == "MULTI":
            return "NON_RACING"
        if isinstance(bet.get("raceNumber"), int) and bet.get("meeting") and bet.get("runnerName"):
            return "HORSE_CANDIDATE"
        if bet.get("fixedRacingSignal"):
            return "HORSE_CANDIDATE"
        return "NON_RACING"

    return "NON_RACING"

def payout_total(group):
    vals=[]
    for r in group:
        if r.get("Transaction Category")=="Payout":
            x=money(r.get("Amount"))
            if x is not None: vals.append(x)
    return None if not vals else q2(sum(vals,Decimal("0")))

def validate_payout_rows(group,tx):
    for r in group:
        if r.get("Transaction Category") != "Payout":
            continue
        amount = money(r.get("Amount"))
        if amount is None or amount <= 0:
            return exc(
                "INVALID_NUMERIC_VALUE",
                f"Payout row has missing, invalid or non-positive Amount: {r.get('Amount')!r}",
                tx,
                group,
            )
    return None

def abs_amount(row):
    value = money(row.get("Amount"))
    return None if value is None else q2(abs(value))

def validate_stake_reconciliation(pricing,bet_type,group,recs,tx):
    primary = next((r for r in group if r.get("Transaction Category") == "Stake"), None)
    if primary is None:
        return None

    primary_amount = abs_amount(primary)

    if bet_type == "Win and Place":
        if primary_amount is None:
            return exc("SOURCE_RECONCILIATION_ERROR","Win & Place primary Stake Amount is missing or invalid",tx,group)
        if pricing == "Fixed Odds":
            expected = q2(sum((r.get("stake") for r in recs), Decimal("0"))) if recs else None
        else:
            expected = recs[0].get("totalStake") if recs else None
        if expected is not None and primary_amount != expected:
            return exc(
                "SOURCE_RECONCILIATION_ERROR",
                f"Primary Amount {primary_amount} does not equal Win & Place component stake total {expected}",
                tx,
                group,
            )
        return None

    if bet_type == "Multi":
        if not recs:
            return None
        canonical_stake = recs[0].get("stake")
        summary = next((r for r in group if MULTI_RE.search(r.get("Description", ""))), None)
        summary_amount = abs_amount(summary) if summary else None
        if summary_amount is None:
            return exc("SOURCE_RECONCILIATION_ERROR","Multi summary Amount is missing or invalid",tx,group)
        if canonical_stake is not None and summary_amount != canonical_stake:
            return exc(
                "SOURCE_RECONCILIATION_ERROR",
                f"Multi summary Amount {summary_amount} does not equal parsed stake {canonical_stake}",
                tx,
                group,
            )
        return None

    if recs:
        canonical_stake = recs[0].get("stake")
        if primary_amount is None:
            return exc("SOURCE_RECONCILIATION_ERROR","Primary Stake Amount is missing or invalid",tx,group)
        if canonical_stake is not None and primary_amount != canonical_stake:
            return exc(
                "SOURCE_RECONCILIATION_ERROR",
                f"Primary Amount {primary_amount} does not equal parsed stake {canonical_stake}",
                tx,
                group,
            )
    return None


def parse_fixed(row,kind):
    d=row.get("Description",""); b=common(row,"FIXED",kind); b.update(fixed_selection(d))
    b.update({
        "stake":q2(dec(extract(STAKE_RE,d))),
        "odds":dec(row.get("Fixed Price Odds")) or dec(extract(PRICE_RE,d)),
        "potentialReturn":q2(dec(extract(RETURN_RE,d))),
        "payout":None,
        # Domain signal only; does not change the frozen selection parser. This
        # preserves horse-only candidates such as named Melbourne Cup markets that
        # omit the usual <meeting> Rxx dd/mm identity pattern.
        "fixedRacingSignal": bool(re.search(r"\bDeductions Apply\b", d, re.I)),
    })
    return b

def parse_fixed_wp(group):
    tx=extract(TX_RE,group[0].get("Description","")); cand={"WIN":[],"PLACE":[]}
    for r in group:
        if r.get("Transaction Category")!="Stake" and not (not r.get("Transaction Type") and r.get("Description")): continue
        lines=payload(r.get("Description","")); m=FIXED_WP_RE.match(lines[-1] if lines else "")
        if m: cand["WIN" if m.group(1).upper()=="WIN" else "PLACE"].append(r)
    if len(cand["WIN"])!=1 or len(cand["PLACE"])!=1:
        return [],exc("UNSUPPORTED_BET_STRUCTURE",f"Fixed Win and Place requires exactly one WIN and one PLACE leg; found WIN={len(cand['WIN'])}, PLACE={len(cand['PLACE'])}",tx,group)
    bets=[parse_fixed(cand["WIN"][0],"WIN"),parse_fixed(cand["PLACE"][0],"PLACE")]
    win_bet, place_bet = bets

    # Preserve the authoritative settled payout for the composite. TAB can mark
    # both W&P source rows Pay/Won even when only one component actually returned
    # money. Reconcile against source potential returns without guessing: enumerate
    # every non-empty component subset and accept a split only when exactly one
    # subset sums to the authoritative composite payout. Unmatched components then
    # have an actual return of zero. If no subset or more than one subset matches,
    # leave both component payouts unknown.
    composite_payout = payout_total(group)
    for b in bets:
        b["sourceCompositePayout"] = composite_payout
    if composite_payout is not None:
        matching_subsets = []
        for mask in range(1, 1 << len(bets)):
            subset = [i for i in range(len(bets)) if mask & (1 << i)]
            returns = [bets[i].get("potentialReturn") for i in subset]
            if any(value is None for value in returns):
                continue
            if q2(sum(returns, Decimal("0"))) == composite_payout:
                matching_subsets.append(set(subset))

        if len(matching_subsets) == 1:
            matched = matching_subsets[0]
            for i, b in enumerate(bets):
                is_returning_component = i in matched
                b["payout"] = b.get("potentialReturn") if is_returning_component else Decimal("0.00")
                # The statement repeats Pay/Won on both source rows for some composite
                # W&P transactions. Once the payout uniquely proves which component(s)
                # returned money, use that deterministic component settlement in the
                # canonical split so recap win/loss counts and replay flags stay correct.
                b["betResult"] = "WIN" if is_returning_component else "LOSS"
    identity_fields = ("eventDate", "meeting", "raceNumber", "selectionText", "runnerName")
    mismatches = [f for f in identity_fields if win_bet.get(f) != place_bet.get(f)]
    if mismatches:
        return [],exc(
            "UNSUPPORTED_BET_STRUCTURE",
            f"Fixed Win and Place components disagree on identity fields: {', '.join(mismatches)}",
            tx,
            group,
        )
    if not bets[1].get("betTime"): bets[1]["betTime"]=bets[0].get("betTime")
    for b,c in zip(bets,("WIN","PLACE")): b.update({"sourceCompositeBetType":"WIN_AND_PLACE","component":c})
    return bets,None


def parse_multi(group):
    tx=extract(TX_RE,group[0].get("Description","")); summaries=[r for r in group if MULTI_RE.search(r.get("Description",""))]
    if len(summaries)!=1: return None,exc("UNSUPPORTED_BET_STRUCTURE","Fixed Multi must contain exactly one observed Multibet summary record",tx,group)
    s=summaries[0]; legs_src=[r for r in group if r is not s and r.get("Transaction Category")!="Payout"]
    declared=int(extract(MULTI_RE,s.get("Description","")) or 0)
    if len(legs_src)!=declared: return None,exc("UNSUPPORTED_BET_STRUCTURE",f"Fixed Multi declared {declared} legs but {len(legs_src)} leg records were found",tx,group)
    legs=[]
    for i,r in enumerate(legs_src,1):
        d=r.get("Description",""); lines=payload(d); raw=lines[-1] if lines else None; market=extract(EVENT_RE,d)
        sel=re.split(r"\s+@Price:",raw,maxsplit=1,flags=re.I)[0].strip() if raw else None
        if sel and market and sel.lower().startswith(market.lower()+" "): sel=sel[len(market):].strip()
        legs.append({"legNumber":i,"eventDate":event_date(d),"eventOrMarket":market,"selectionText":sel,"odds":dec(r.get("Fixed Price Odds")) or dec(extract(PRICE_RE,d)),"result":None})
    d=s.get("Description",""); b=common(s,"FIXED","MULTI")
    if not b.get("betTime"): b["betTime"]=next((r.get("Date & Time") for r in group if r.get("Date & Time")),None)
    b.update({"stake":q2(dec(extract(STAKE_RE,d))),"odds":dec(s.get("Fixed Price Odds")) or dec(extract(COMBINED_RE,d)),"potentialReturn":q2(dec(extract(RETURN_RE,d))),"payout":None,"declaredLegCount":declared,"legs":legs,"enrichmentRequired":True})
    return b,None


def parse_tote_single(row,group,kind):
    d=row.get("Description",""); b=common(row,"TOTE",kind); t=tote_common(d); b.update(t)
    sel=t.get("selectionText"); stake=dec(extract(STAKE_RE,d)); payout=payout_total(group); result=source_result(row.get("Results",""))
    b.update({"runnerNumber":int(sel) if sel and sel.isdigit() else None,"stake":q2(stake),"payout":q2(payout),"odds":q2(payout/stake) if result=="WIN" and payout is not None and stake and stake>0 else None,"potentialReturn":None})
    return b

def parse_tote_wp(group):
    tx=extract(TX_RE,group[0].get("Description","")); cand={"WIN":[],"PLACE":[]}
    for r in group:
        if r.get("Transaction Category")=="Payout": continue
        lines=payload(r.get("Description","")); m=TOTE_WP_RE.match(lines[-1] if lines else "")
        if m: cand["WIN" if m.group(1).upper()=="WIN" else "PLACE"].append(r)
    if len(cand["WIN"])!=1 or len(cand["PLACE"])!=1:
        return None,exc("UNSUPPORTED_BET_STRUCTURE",f"Tote Win and Place requires exactly one WIN and one PLACE leg; found WIN={len(cand['WIN'])}, PLACE={len(cand['PLACE'])}",tx,group)
    wr,pr=cand["WIN"][0],cand["PLACE"][0]; wd,pd=wr.get("Description",""),pr.get("Description","")
    ws,ps=dec(extract(STAKE_RE,wd)),dec(extract(STAKE_RE,pd))
    if ws is None or ps is None: return None,exc("INVALID_NUMERIC_VALUE","Could not determine both Tote Win and Place component stakes from Description",tx,group)
    wm=TOTE_WP_RE.match(payload(wd)[-1] if payload(wd) else ""); pm=TOTE_WP_RE.match(payload(pd)[-1] if payload(pd) else "")
    wn=int(wm.group(2)) if wm else None; pn=int(pm.group(2)) if pm else None
    if wn!=pn: return None,exc("UNSUPPORTED_BET_STRUCTURE","Tote Win and Place WIN/PLACE legs reference different runners",tx,group)
    win_identity = {**common(wr,"TOTE","TOTE_WIN_PLACE"), **tote_common(wd)}
    place_identity = {**common(pr,"TOTE","TOTE_WIN_PLACE"), **tote_common(pd)}
    identity_fields = ("eventDate", "meeting", "meetingType", "raceNumber")
    mismatches = [
        f for f in identity_fields
        if win_identity.get(f) is not None
        and place_identity.get(f) is not None
        and win_identity.get(f) != place_identity.get(f)
    ]
    if mismatches:
        return None,exc(
            "UNSUPPORTED_BET_STRUCTURE",
            f"Tote Win and Place components disagree on identity fields: {', '.join(mismatches)}",
            tx,
            group,
        )
    payout=payout_total(group); total=ws+ps; b=common(wr,"TOTE","TOTE_WIN_PLACE"); b.update(tote_common(wd))
    b.update({"runnerNumber":wn,"winStake":q2(ws),"placeStake":q2(ps),"totalStake":q2(total),"combinedPayout":q2(payout),"combinedEffectiveOdds":q2(payout/total) if payout is not None and total>0 else None,"enrichmentRequired":True})
    return b,None


def exotic_selections(text):
    if not text: return None
    core=re.split(r"\s*\(",text,maxsplit=1)[0].strip(); parts=[x.strip() for x in re.split(r"[,\-]",core)]
    return [int(x) for x in parts] if parts and all(x.isdigit() for x in parts) else None

def parse_exotic(row,group,kind):
    d=row.get("Description",""); tx=extract(TX_RE,d); payout=payout_total(group); outcome=source_result(row.get("Results",""))
    if payout is not None or outcome=="WIN": return None,exc("UNSUPPORTED_BET_STRUCTURE",f"Winning {kind} settlement has not yet been source-validated",tx,group)
    b=common(row,"TOTE",kind); b.update(tote_common(d)); sel=b.get("selectionText")
    b.update({"selections":exotic_selections(sel),"stake":q2(dec(extract(STAKE_RE,d))),"payout":None,"odds":None,"flexiPercentage":dec(extract(FLEXI_RE,sel or "")),"enrichmentRequired":True})
    return b,None


def validate_results(group,tx):
    for r in group:
        raw=(r.get("Results") or "").strip()
        if raw and source_result(raw) is None: return exc("UNSUPPORTED_RESULT_VALUE",f"Unsupported non-empty Results value: {raw!r}",tx,group,sourceResult=raw)
    return None

def validate(b,kind,group):
    tx=b.get("transactionNumber")
    def bad(msg): return exc("INVALID_REQUIRED_FIELD",msg,tx,group)
    if not tx: return bad("Canonical bet is missing transactionNumber")
    if not valid_date(b.get("eventDate")): return bad(f"Canonical bet has missing or invalid eventDate: {b.get('eventDate')!r}")
    if kind in ("FIXED_SINGLE","FIXED_WP"):
        if not b.get("selectionText"): return bad("Fixed bet is missing selectionText")
        if not positive(b.get("stake")): return bad(f"Fixed bet has missing or non-positive stake: {b.get('stake')!r}")
        if not positive(b.get("odds")): return bad(f"Fixed bet has missing or non-positive odds: {b.get('odds')!r}")
    elif kind=="TOTE_SINGLE":
        if not isinstance(b.get("raceNumber"),int) or b["raceNumber"]<=0: return bad(f"Tote bet has missing or invalid raceNumber: {b.get('raceNumber')!r}")
        if not isinstance(b.get("runnerNumber"),int) or b["runnerNumber"]<=0: return bad(f"Tote bet has missing or invalid runnerNumber: {b.get('runnerNumber')!r}")
        if not positive(b.get("stake")): return bad(f"Tote bet has missing or non-positive stake: {b.get('stake')!r}")
        if b.get("betResult")=="WIN" and not positive(b.get("payout")): return bad("Winning Tote WIN/PLACE has no positive payout in its transaction group")
        if b.get("betResult")=="LOSS" and b.get("payout") is not None: return bad(f"Losing Tote WIN/PLACE unexpectedly has payout {b.get('payout')!r}")
        if b.get("betResult") is None and b.get("payout") is not None: return bad("Tote WIN/PLACE has payout data but no recognised source result")
    elif kind=="TOTE_WP":
        if not isinstance(b.get("raceNumber"),int) or b["raceNumber"]<=0: return bad(f"Tote Win & Place has missing or invalid raceNumber: {b.get('raceNumber')!r}")
        if not isinstance(b.get("runnerNumber"),int) or b["runnerNumber"]<=0: return bad(f"Tote Win & Place has missing or invalid runnerNumber: {b.get('runnerNumber')!r}")
        if not positive(b.get("winStake")) or not positive(b.get("placeStake")): return bad("Tote Win & Place requires positive winStake and placeStake")
        if b.get("totalStake")!=q2(b["winStake"]+b["placeStake"]): return bad("Tote Win & Place totalStake does not equal component stakes")
        if b.get("betResult")=="WIN" and not positive(b.get("combinedPayout")): return bad("Winning Tote Win & Place has no positive combined payout")
        if b.get("betResult")=="LOSS" and b.get("combinedPayout") is not None: return bad(f"Losing Tote Win & Place unexpectedly has combined payout {b.get('combinedPayout')!r}")
        if b.get("betResult") is None and b.get("combinedPayout") is not None: return bad("Tote Win & Place has payout data but no recognised source result")
    elif kind=="MULTI":
        if not positive(b.get("stake")) or not positive(b.get("odds")): return bad("Fixed Multi requires positive stake and combined odds")
        legs=b.get("legs") or []; declared=b.get("declaredLegCount")
        if not isinstance(declared,int) or declared<=0 or len(legs)!=declared: return bad(f"Fixed Multi leg count is invalid: declared={declared!r}, actual={len(legs)}")
        for l in legs:
            if not valid_date(l.get("eventDate")) or not l.get("eventOrMarket") or not l.get("selectionText") or not positive(l.get("odds")): return bad(f"Fixed Multi leg {l.get('legNumber')} is missing required data")
    elif kind in ("TRIFECTA","FIRST_4"):
        if not isinstance(b.get("raceNumber"),int) or b["raceNumber"]<=0 or not positive(b.get("stake")): return bad(f"{kind} is missing required race/stake data")
        need=3 if kind=="TRIFECTA" else 4
        selections=b.get("selections")
        if not isinstance(selections,list): return bad(f"{kind} selections must be a list; got {selections!r}")
        if kind=="TRIFECTA" and len(selections)<3: return bad(f"TRIFECTA requires at least 3 numeric selections; got {selections!r}")
        if kind=="FIRST_4" and len(selections)<4: return bad(f"FIRST_4 requires at least 4 numeric selections; got {selections!r}")
        if any(not isinstance(x,int) or x<=0 for x in selections): return bad(f"{kind} selections must be positive runner numbers; got {selections!r}")
        if len(set(selections))!=len(selections): return bad(f"{kind} selections must be unique; got {selections!r}")
    return None


def normalise_csv(path,job_id,source_name=None):
    period,rows,footer=parse_csv(path); source_name=source_name or path.name; groups=defaultdict(list); ignored=Counter(); exceptions=[]
    for r in rows:
        tx=extract(TX_RE,r.get("Description",""))
        if tx: groups[tx].append(r)
        elif r.get("Transaction Category") in {"Deposit","Withdrawal","Credit Card Fee"} or r.get("Transaction Type")=="Account": ignored["ACCOUNT_NON_BET"]+=1
        else: exceptions.append(exc("UNRECOGNISED_RECORD_STRUCTURE","11-column transaction record has no Transaction Number",None,[r]))
    bets=[]; recognised=unsupported=0
    for tx,g in groups.items():
        stakes=[r for r in g if r.get("Transaction Category")=="Stake"]
        if not stakes:
            ignored["PAYOUT_SUPPORT_ONLY" if any(r.get("Transaction Category")=="Payout" for r in g) else "NON_STAKE_TRANSACTION"]+=len(g); continue
        primary=stakes[0]; pricing=primary.get("Transaction Type",""); bt=primary.get("Bet Type","")
        if len(stakes)!=1: exceptions.append(exc("UNSUPPORTED_BET_STRUCTURE",f"Expected exactly one primary Stake record for a logical transaction; found {len(stakes)}",tx,g)); unsupported+=1; continue
        e=validate_results(g,tx)
        if e: exceptions.append(e); unsupported+=1; continue
        e=validate_payout_rows(g,tx)
        if e: exceptions.append(e); unsupported+=1; continue
        if (pricing,bt) not in SUPPORTED: exceptions.append(exc("UNSUPPORTED_BET_TYPE",f"Unsupported observed stake type: {pricing!r} / {bt!r}",tx,g,transactionType=pricing or None,betType=bt or None)); unsupported+=1; continue
        recognised+=1; recs=[]; pe=None; vk=None
        if pricing=="Fixed Odds" and bt in ("Win","Place"):
            recs=[parse_fixed(primary,bt.upper())]; vk="FIXED_SINGLE"
            settled_payout = payout_total(g)
            if recs:
                recs[0]["payout"] = settled_payout
        elif pricing=="Fixed Odds" and bt=="Win and Place": recs,pe=parse_fixed_wp(g); vk="FIXED_WP"
        elif pricing=="Fixed Odds" and bt=="Multi": x,pe=parse_multi(g); recs=[x] if x else []; vk="MULTI"
        elif pricing=="Parimutuel" and bt in ("Win","Place"): recs=[parse_tote_single(primary,g,bt.upper())]; vk="TOTE_SINGLE"
        elif pricing=="Parimutuel" and bt=="Win and Place": x,pe=parse_tote_wp(g); recs=[x] if x else []; vk="TOTE_WP"
        elif pricing=="Parimutuel" and bt in ("Trifecta","First 4"):
            kind="TRIFECTA" if bt=="Trifecta" else "FIRST_4"; x,pe=parse_exotic(primary,g,kind); recs=[x] if x else []; vk=kind
        if pe: exceptions.append(pe); recognised-=1; unsupported+=1; continue
        ve=None
        if vk:
            for r in recs:
                ve=validate(r,vk,g)
                if ve:
                    break
        if ve: exceptions.append(ve); recognised-=1; unsupported+=1; continue
        re=validate_stake_reconciliation(pricing,bt,g,recs,tx)
        if re: exceptions.append(re); recognised-=1; unsupported+=1; continue
        bets.extend(recs)
    # v0.9 domain filter is deliberately post-parse so v1.7 parsing behaviour remains frozen.
    domain_counts=Counter()
    included=[]
    for b in bets:
        classification=domain_classification(b)
        b["domainClassification"]=classification
        domain_counts[classification]+=1
        if classification in ("HORSE_CONFIRMED_CSV", "HORSE_CANDIDATE"):
            included.append(b)
        else:
            ignored[f"DOMAIN_{classification}"]+=1

    for i,b in enumerate(included,1):
        suffix=f":{b['component']}" if b.get("component") else ""; b["canonicalId"]=f"{b.get('transactionNumber')}{suffix}"; b["sequence"]=i
    counts=Counter(f"{b.get('pricingType')}:{b.get('betType')}" for b in included)
    normalised={
        "normaliserSchemaVersion":"1.7+horse-filter-v0.9",
        "jobId":job_id,
        "source":{"fileName":source_name,"statementPeriod":period},
        "domainSummary":{
            "parsedCanonicalBetsBeforeDomainFilter":len(bets),
            "horseBetsIncluded":len(included),
            "nonHorseBetsExcluded":len(bets)-len(included),
            "classificationCounts":dict(sorted(domain_counts.items())),
        },
        "bets":included,
    }
    summary={"jobId":job_id,"sourceFile":source_name,"statementPeriod":period,"sourceTransactionRecords":len(rows),"sourceTransactionGroups":len(groups),"recognisedLogicalBetTransactions":recognised,"unsupportedLogicalBetTransactions":unsupported,"parsedCanonicalBetRecordsBeforeDomainFilter":len(bets),"canonicalBetRecords":len(included),"horseBetsIncluded":len(included),"nonHorseBetsExcluded":len(bets)-len(included),"domainClassificationCounts":dict(sorted(domain_counts.items())),"exceptionCount":len(exceptions),"ignoredRecordCounts":dict(sorted(ignored.items())),"canonicalBetTypeCounts":dict(sorted(counts.items())),"footer":footer}
    return normalised,exceptions,summary


def period_label(path):
    try:
        p,_,_=parse_csv(path)
        if p: return datetime.strptime(p.split("-")[0].strip(),"%d/%m/%Y").strftime("%Y-%m")
    except Exception: pass
    return re.sub(r"[^A-Za-z0-9]+","-",path.stem).strip("-").lower()[:24] or "job"
def job_id(path): return f"{period_label(path)}__{datetime.now():%Y%m%d-%H%M%S}-{hashlib.sha1((path.name+'|'+datetime.now().isoformat()).encode()).hexdigest()[:4]}"

# =============================================================================
# PASS 2 — HORSE-ONLY TAB HISTORICAL ENRICHMENT + PERSISTENT MEETING RESOLUTION
# =============================================================================
import time
import urllib.error
import urllib.parse
import urllib.request

ENRICH_BASE_URL = "https://api.beta.tab.com.au/v1/historical-results-service"
ENRICH_JURISDICTION = "VIC"
ENRICH_TIMEOUT = 25
ENRICH_RETRIES = 2
ENRICH_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.I)


def enrich_norm_text(value):
    if value is None:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", str(value).upper().strip())


def enrich_to_int(value):
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def enrich_to_decimal(value):
    try:
        if value is None or value == "":
            return None
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def enrich_money2(value):
    d = enrich_to_decimal(value)
    return None if d is None else d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def enrich_as_list(value):
    return value if isinstance(value, list) else []


class TabHistoricalApi:
    """Small client with per-run in-memory URL caching. Persistent meeting learning is local JSON."""

    def __init__(self, base_url, jurisdiction, timeout, retries):
        self.base_url = base_url.rstrip("/")
        self.jurisdiction = jurisdiction.upper()
        self.timeout = timeout
        self.retries = retries
        # Cache by exact URL so every caller shares the same success/failure result.
        # This is deliberately per-run memory only; nothing is persisted to disk.
        self.response_cache = {}
        self.error_cache = {}
        self.partial_response_cache = {}
        self.date_calls = 0
        self.race_calls = 0
        self.cache_hits = 0
        self.failure_cache_hits = 0
        self.discovery_calls = 0
        self.discovery_cache = {}
        self.discovery_errors = {}
        self.degraded_races = 0

    @staticmethod
    def _non_retryable_http_error(ex):
        # Retrying a deterministic 4xx (especially 404 while probing candidate
        # meetings) only repeats the same request. 408/429 may be transient.
        return isinstance(ex, urllib.error.HTTPError) and 400 <= ex.code < 500 and ex.code not in (408, 429)

    @staticmethod
    def _race_response_warning(data, expected_race_number=None):
        """Detect strong evidence of a degraded historical race response.

        Missing optional video/tote data and zero (unplaced) finishing positions
        are not, by themselves, reasons to reject a genuine fixed-odds event.
        """
        if not isinstance(data, dict):
            return "race response is not a JSON object"
        actual_number = enrich_to_int(data.get("raceNumber"))
        if actual_number is None:
            return "race number missing"
        if expected_race_number is not None and actual_number != expected_race_number:
            return f"race number mismatch: requested {expected_race_number}, received {actual_number}"
        runners = data.get("runners")
        if not isinstance(runners, list) or not runners:
            return "race runner list missing or empty"
        fixed_only = data.get("fixedOddsOnly") is True or (
            isinstance(data.get("meeting"), dict)
            and data["meeting"].get("fixedOddsOnly") is True
        )
        raw_start = data.get("raceStartTime")
        placeholder = isinstance(raw_start, str) and bool(re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?", raw_start
        ))
        positions_missing = any(
            isinstance(runner, dict) and runner.get("finishingPosition") is None
            for runner in runners
        )
        if fixed_only and placeholder:
            return "fixed-odds-only response with placeholder scheduled start time"
        if fixed_only and positions_missing and not data.get("resultedTime"):
            return "fixed-odds-only response lacks finishing positions and result timestamp"
        if not raw_start and not data.get("resultedTime"):
            return "race has no start or result timestamp"
        # All positions missing on a resulted race is a strong sign of a
        # skeleton response. Do not confuse position 0 with a missing value.
        if data.get("resultedTime") and len(runners) >= 2 and all(
            isinstance(runner, dict) and runner.get("finishingPosition") is None
            for runner in runners
        ):
            return "resulted race has no runner finishing positions"
        if data.get("resultedTime") and not data.get("results") and positions_missing:
            return "resulted race lacks official results and runner positions"
        return None

    def _get(self, url, kind, attempts_override=None):
        headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
        last_error = None
        partial = None
        # Existing --retries continues to govern connection/HTTP failures.
        # Degraded but HTTP-200 race responses receive five further attempts.
        attempts = attempts_override if attempts_override is not None else (6 if kind == "race" else self.retries + 1)
        errors = 0
        for attempt in range(attempts):
            try:
                if kind == "date":
                    self.date_calls += 1
                else:
                    self.race_calls += 1
                if attempt == 0:
                    print(f"      [API] {'PROBE' if attempts_override == 1 else 'GET'} {'/'.join(url.rsplit('/', 4)[-4:]) if kind == 'race' else url}")
                request = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    data = json.loads(response.read().decode("utf-8"))
                warning = self._race_response_warning(data, expected_race_number=int(url.rsplit("/", 1)[-1])) if kind == "race" else None
                if warning:
                    # Never reuse a record whose race number contradicts the URL.
                    # It can be retried, but is not safe fallback evidence.
                    if not warning.startswith("race number mismatch:"):
                        partial = data
                    if attempts_override != 1:
                        print(f"      [API] Incomplete {attempt + 1}/{attempts}: {warning}")
                    if attempt < attempts - 1:
                        time.sleep(min(attempt + 1, 3))
                    continue
                return data
            except Exception as ex:
                last_error = ex
                errors += 1
                if self._non_retryable_http_error(ex) or errors > self.retries:
                    break
                if attempt < attempts - 1:
                    time.sleep(min(attempt + 1, 3))
        if partial is not None:
            # Preserve source evidence for Stage 3 fallback; never call it complete.
            if attempts_override != 1:
                self.degraded_races += 1
                print("      [RECOVERY] Six attempts exhausted; using best partial response")
            return partial
        raise RuntimeError(f"TAB API request failed: {last_error}")

    def probe_race(self, event_date, venue_mnemonic, race_type, race_number):
        """Single-shot discovery, never six retries for an unconfirmed venue."""
        url = (f"{self.base_url}/{urllib.parse.quote(self.jurisdiction)}/racing/"
               f"{urllib.parse.quote(str(event_date))}/{urllib.parse.quote(str(venue_mnemonic))}/"
               f"{urllib.parse.quote(str(race_type))}/races/{race_number}")
        cached = self.response_cache.get(url) or self.partial_response_cache.get(url) or self.discovery_cache.get(url)
        if cached is not None:
            return cached
        if url in self.discovery_errors:
            raise RuntimeError(self.discovery_errors[url])
        self.discovery_calls += 1
        try:
            result = self._get(url, "race", attempts_override=1)
        except Exception as ex:
            self.discovery_errors[url] = str(ex)
            raise
        self.discovery_cache[url] = result
        return result

    def _cached_get(self, url, kind):
        if url in self.response_cache:
            self.cache_hits += 1
            return self.response_cache[url]
        if url in self.partial_response_cache:
            self.cache_hits += 1
            return self.partial_response_cache[url]
        if url in self.error_cache:
            self.cache_hits += 1
            self.failure_cache_hits += 1
            raise RuntimeError(self.error_cache[url])

        try:
            data = self._get(url, kind)
        except Exception as ex:
            message = str(ex)
            cause = ex.__cause__ if ex.__cause__ is not None else ex
            if self._non_retryable_http_error(cause):
                self.error_cache[url] = message
            raise RuntimeError(message) from ex

        if kind == "race" and self._race_response_warning(data, expected_race_number=int(url.rsplit("/", 1)[-1])):
            # A degraded record is reusable evidence only for the current run.
            # Six attempts have already been exhausted for this URL.
            self.partial_response_cache[url] = data
        else:
            self.response_cache[url] = data
        return data

    def date(self, event_date):
        url = (
            f"{self.base_url}/{urllib.parse.quote(self.jurisdiction)}/racing/"
            f"{urllib.parse.quote(event_date)}"
        )
        return self._cached_get(url, "date")

    def race(self, event_date, venue_mnemonic, race_type, race_number):
        url = (
            f"{self.base_url}/{urllib.parse.quote(self.jurisdiction)}/racing/"
            f"{urllib.parse.quote(event_date)}/{urllib.parse.quote(str(venue_mnemonic))}/"
            f"{urllib.parse.quote(str(race_type))}/races/{race_number}"
        )
        return self._cached_get(url, "race")


class MeetingResolutionStore:
    """Persistent learned meeting mappings stored in one local JSON file.

    The file maps one sourceKey to a list of proven target meetings. Multiple
    targets are retained deliberately; the requested date/race must reduce them
    to exactly one valid horse target before a learned mapping is reused.
    """

    def __init__(self, file_path):
        self.file_path = Path(file_path).resolve()
        self.hits = 0
        self.misses = 0
        self.ambiguous = 0
        self.writes = 0
        self.errors = 0
        self.data = {}
        self._load()

    def _load(self):
        if not self.file_path.exists():
            self.data = {}
            return
        try:
            raw = json.loads(self.file_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("top-level JSON must be an object")
            cleaned = {}
            for source_key, targets in raw.items():
                if not isinstance(source_key, str) or not isinstance(targets, list):
                    continue
                cleaned[source_key] = [t for t in targets if isinstance(t, dict)]
            self.data = cleaned
        except Exception as ex:
            self.errors += 1
            raise RuntimeError(f"Could not load local meeting lookup file {self.file_path}: {ex}") from ex

    def _save_atomic(self):
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file_path.with_name(self.file_path.name + ".tmp")
        try:
            tmp.write_text(
                json.dumps(self.data, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            tmp.replace(self.file_path)
        except Exception as ex:
            self.errors += 1
            try:
                if tmp.exists():
                    tmp.unlink()
            except Exception:
                pass
            raise RuntimeError(f"Could not save local meeting lookup file {self.file_path}: {ex}") from ex

    @staticmethod
    def source_key(source_meeting, source_meeting_type=None):
        meeting = enrich_norm_text(source_meeting)
        mtype = enrich_norm_text(source_meeting_type) or "UNKNOWN"
        return f"{meeting}#{mtype}" if meeting else None

    @staticmethod
    def target_key(mapping):
        return "#".join([
            enrich_norm_text(mapping.get("canonicalMeeting")) or "UNKNOWN",
            enrich_norm_text(mapping.get("location")) or "UNKNOWN",
            enrich_norm_text(mapping.get("venueMnemonic")) or "UNKNOWN",
            enrich_norm_text(mapping.get("raceType")) or "UNKNOWN",
        ])

    def lookup(self, source_meeting, source_meeting_type=None):
        source_key = self.source_key(source_meeting, source_meeting_type)
        if not source_key:
            return [], "NO_SOURCE_MEETING"
        items = list(self.data.get(source_key, []))
        if items:
            self.hits += 1
            return items, "LOCAL_LOOKUP_HIT" if len(items) == 1 else "LOCAL_LOOKUP_MULTI_TARGET"
        self.misses += 1
        return [], "LOCAL_LOOKUP_MISS"

    def put_proven(self, source_meeting, source_meeting_type, meeting):
        if not source_meeting or enrich_norm_text(meeting.get("raceType")) != "R":
            return False

        mapping = {
            "canonicalMeeting": meeting.get("meetingName"),
            "location": meeting.get("location"),
            "venueMnemonic": meeting.get("venueMnemonic"),
            "raceType": meeting.get("raceType"),
        }
        source_key = self.source_key(source_meeting, source_meeting_type)
        if (
            not source_key
            or not mapping["canonicalMeeting"]
            or not mapping["venueMnemonic"]
            or not mapping["raceType"]
        ):
            return False

        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        target_key = self.target_key(mapping)
        targets = self.data.setdefault(source_key, [])

        existing = next((item for item in targets if item.get("targetKey") == target_key), None)
        if existing is None:
            targets.append({
                "targetKey": target_key,
                "sourceMeeting": source_meeting,
                "sourceMeetingType": source_meeting_type or "",
                "canonicalMeeting": mapping["canonicalMeeting"],
                "location": mapping.get("location") or "",
                "venueMnemonic": mapping["venueMnemonic"],
                "raceType": mapping["raceType"],
                "resolutionMethod": "TAB_DEEP_API_UNIQUE_MATCH",
                "confidence": "PROVEN_UNIQUE_MATCH",
                "firstSeen": now,
                "lastSeen": now,
                "seenCount": 1,
            })
        else:
            existing["sourceMeeting"] = source_meeting
            existing["sourceMeetingType"] = source_meeting_type or ""
            existing["canonicalMeeting"] = mapping["canonicalMeeting"]
            existing["location"] = mapping.get("location") or ""
            existing["venueMnemonic"] = mapping["venueMnemonic"]
            existing["raceType"] = mapping["raceType"]
            existing["resolutionMethod"] = "TAB_DEEP_API_UNIQUE_MATCH"
            existing["confidence"] = "PROVEN_UNIQUE_MATCH"
            existing.setdefault("firstSeen", now)
            existing["lastSeen"] = now
            existing["seenCount"] = int(existing.get("seenCount") or 0) + 1

        self._save_atomic()
        self.writes += 1
        return True

def meeting_race_numbers(meeting):
    numbers = set()
    for race in enrich_as_list(meeting.get("races")):
        if isinstance(race, dict):
            number = enrich_to_int(race.get("raceNumber"))
            if number is not None:
                numbers.add(number)
    return numbers


def match_meeting_exact(date_payload, csv_meeting_name, race_number):
    """Resolve an exact source meeting only when the requested race exists there.

    This race-number check is important before the non-horse hard stop: an exact
    same-name G/H meeting must not exclude a horse candidate for a race that the
    G/H meeting does not actually contain.
    """
    if not isinstance(date_payload, dict):
        return None, "date endpoint did not return an object"
    wanted = enrich_norm_text(csv_meeting_name)
    if not wanted:
        return None, "CSV meeting is blank"
    meetings = [m for m in enrich_as_list(date_payload.get("meetings")) if isinstance(m, dict)]
    matches = [m for m in meetings if enrich_norm_text(m.get("meetingName")) == wanted]
    with_race = [m for m in matches if race_number in meeting_race_numbers(m)]
    # A unique exact venue may have an incomplete date-level race list. Allow
    # its race endpoint to verify the number rather than searching worldwide.
    if not with_race and len(matches) == 1:
        return matches[0], "DIRECT_EXACT_MEETING_NO_DATE_RACES"
    if len(with_race) == 1:
        reason = "DIRECT_EXACT_MEETING" if len(matches) == 1 else "DIRECT_EXACT_MEETING_PLUS_RACE"
        return with_race[0], reason
    if len(with_race) > 1:
        return None, "ambiguous exact meetingName for requested race"
    if matches:
        return None, f"exact meetingName found but raceNumber={race_number} is not listed there"
    return None, f"no exact meetingName match for {csv_meeting_name!r}"


def find_meeting_from_mapping(date_payload, mapping, race_number):
    if not isinstance(date_payload, dict) or not mapping:
        return None
    meetings = [m for m in enrich_as_list(date_payload.get("meetings")) if isinstance(m, dict)]
    wanted_name = enrich_norm_text(mapping.get("canonicalMeeting"))
    wanted_location = enrich_norm_text(mapping.get("location"))
    wanted_venue = enrich_norm_text(mapping.get("venueMnemonic"))
    wanted_type = enrich_norm_text(mapping.get("raceType"))
    if wanted_type != "R":
        return None
    matches = []
    for m in meetings:
        if wanted_name and enrich_norm_text(m.get("meetingName")) != wanted_name:
            continue
        if wanted_location and enrich_norm_text(m.get("location")) != wanted_location:
            continue
        if wanted_venue and enrich_norm_text(m.get("venueMnemonic")) != wanted_venue:
            continue
        if wanted_type and enrich_norm_text(m.get("raceType")) != wanted_type:
            continue
        # Date-level race lists may be incomplete; verify on the race endpoint.
        matches.append(m)
    return matches[0] if len(matches) == 1 else None


def match_runner(race_payload, bet):
    if not isinstance(race_payload, dict):
        return None, "race endpoint did not return an object"
    runners = [r for r in enrich_as_list(race_payload.get("runners")) if isinstance(r, dict)]
    runner_number = enrich_to_int(bet.get("runnerNumber"))
    if runner_number is not None:
        matches = [r for r in runners if enrich_to_int(r.get("runnerNumber")) == runner_number]
        if len(matches) == 1:
            return matches[0], "RUNNER_NUMBER"
        if len(matches) > 1:
            return None, f"multiple API runners have runnerNumber={runner_number}"
    runner_name = bet.get("runnerName")
    wanted_name = enrich_norm_text(runner_name)
    if wanted_name:
        matches = [r for r in runners if enrich_norm_text(r.get("runnerName")) == wanted_name]
        if len(matches) == 1:
            return matches[0], "RUNNER_NAME"
        if len(matches) > 1:
            return None, f"multiple API runners match runnerName={runner_name!r}"
    if runner_number is not None:
        return None, f"no runner matched runnerNumber={runner_number}"
    if wanted_name:
        return None, f"no runner matched exact runnerName={runner_name!r}"
    return None, "no runner identity in Pass 1"


def tote_candidate_financial_match(bet, runner):
    """Extra deterministic evidence for winning Tote bets when available."""
    if bet.get("pricingType") != "TOTE" or bet.get("betResult") != "WIN":
        return None
    stake = enrich_money2(bet.get("stake"))
    payout = enrich_money2(bet.get("payout"))
    if stake is None or payout is None:
        return None
    tote = runner.get("parimutuel") if isinstance(runner.get("parimutuel"), dict) else {}
    key = "returnPlace" if bet.get("betType") == "PLACE" else "returnWin"
    dividend = enrich_to_decimal(tote.get(key))
    if dividend is None:
        return None
    return enrich_money2(stake * dividend) == payout


def tote_wp_candidate_financial_match(bet, runner):
    if bet.get("betType") != "TOTE_WIN_PLACE":
        return None
    csv_combined = enrich_money2(bet.get("combinedPayout"))
    win_stake = enrich_money2(bet.get("winStake"))
    place_stake = enrich_money2(bet.get("placeStake"))
    if csv_combined is None or win_stake is None or place_stake is None:
        return None
    tote = runner.get("parimutuel") if isinstance(runner.get("parimutuel"), dict) else {}
    win_dividend = enrich_to_decimal(tote.get("returnWin"))
    place_dividend = enrich_to_decimal(tote.get("returnPlace"))
    # Missing dividend is unknown, never zero. Deep resolution must not use a
    # partially known W&P dividend set as positive financial identity evidence.
    if win_dividend is None or place_dividend is None:
        return None
    win_return = enrich_money2(win_stake * win_dividend)
    place_return = enrich_money2(place_stake * place_dividend)
    return enrich_money2(win_return + place_return) == csv_combined


def verify_ambiguous_racing_domain(date_payload, bet, api):
    """Try to prove an ambiguous racing candidate across R/G/H before horse-only fallback.

    This is deliberately conservative: candidate races must contain the exact CSV
    runner name, and when the CSV also supplies a runner number the same API runner
    must match that number. Exactly one surviving race is required. No fuzzy meeting
    matching or guessed aliases are used.
    """
    race_number = enrich_to_int(bet.get("raceNumber"))
    wanted_name = enrich_norm_text(bet.get("runnerName"))
    wanted_number = enrich_to_int(bet.get("runnerNumber"))
    if not isinstance(date_payload, dict) or race_number is None or not wanted_name:
        return None, None, "domain verification lacks date payload, race number, or exact runner name"

    meetings = [
        m for m in enrich_as_list(date_payload.get("meetings"))
        if isinstance(m, dict)
        and enrich_norm_text(m.get("raceType")) in {"R", "G", "H"}
        and race_number in meeting_race_numbers(m)
    ]
    wanted = enrich_norm_text(bet.get("meeting"))
    # Prefer exact identity; abbreviations can only be proven by a unique exact
    # runner (and runner number) across a strictly limited candidate set.
    exact = [m for m in meetings if wanted and enrich_norm_text(m.get("meetingName")) == wanted]
    if exact:
        meetings = exact
    elif wanted and len(meetings) <= 8:
        pass  # Bounded cross-domain proof; never use runner-number-only guessing.
    else:
        return None, None, "no exact meeting and too many candidates for safe discovery"
    candidates = []
    race_errors = []

    for meeting in meetings:
        venue = meeting.get("venueMnemonic")
        race_type = meeting.get("raceType")
        if not venue or not race_type:
            continue
        try:
            race = (api.probe_race if hasattr(api, "probe_race") else api.race)(str(bet.get("eventDate")), str(venue), str(race_type), race_number)
        except Exception as ex:
            race_errors.append(f"{meeting.get('meetingName') or venue}: {str(ex)[:240]}")
            continue
        if not isinstance(race, dict):
            continue

        exact = [
            r for r in enrich_as_list(race.get("runners"))
            if isinstance(r, dict)
            and enrich_norm_text(r.get("runnerName")) == wanted_name
            and (
                wanted_number is None
                or enrich_to_int(r.get("runnerNumber")) == wanted_number
            )
        ]
        if len(exact) != 1:
            continue

        runner = exact[0]
        financial = tote_wp_candidate_financial_match(bet, runner)
        if financial is None:
            financial = tote_candidate_financial_match(bet, runner)
        candidates.append({
            "meeting": meeting,
            "race": race,
            "runner": runner,
            "financialMatch": financial,
        })

    financial_true = [c for c in candidates if c["financialMatch"] is True]
    if len(financial_true) == 1:
        c = financial_true[0]
        suffix = f"; raceLookupFailures={len(race_errors)}" if race_errors else ""
        return c["meeting"], c["race"], f"DOMAIN_API_UNIQUE_FINANCIAL_MATCH{suffix}"

    if len(candidates) == 1:
        c = candidates[0]
        suffix = f"; raceLookupFailures={len(race_errors)}" if race_errors else ""
        return c["meeting"], c["race"], f"DOMAIN_API_UNIQUE_EXACT_RUNNER{suffix}"

    if not candidates and race_errors:
        return None, None, (
            f"domain API could not prove a candidate; {len(race_errors)} race lookup(s) failed; "
            f"first error: {race_errors[0]}"
        )
    suffix = f"; raceLookupFailures={len(race_errors)}" if race_errors else ""
    return None, None, f"domain API resolution not unique: {len(candidates)} candidate race(s){suffix}"


def deep_resolve_meeting(date_payload, bet, api):
    """Fallback only. Accepts exactly one API-proven candidate; never fuzzy-guesses.

    Candidate race-call failures are retained for diagnostics so a TAB/API outage
    is not misreported as simply "zero candidate races".
    """
    race_number = enrich_to_int(bet.get("raceNumber"))
    if not isinstance(date_payload, dict) or race_number is None:
        return None, None, "deep resolver lacks date payload or race number"

    meetings = [
        m for m in enrich_as_list(date_payload.get("meetings"))
        if isinstance(m, dict)
        and enrich_norm_text(m.get("raceType")) == "R"
        and race_number in meeting_race_numbers(m)
    ]
    wanted = enrich_norm_text(bet.get("meeting"))
    # Prefer exact identity; abbreviations can only be proven by a unique exact
    # runner (and runner number) across a strictly limited candidate set.
    exact = [m for m in meetings if wanted and enrich_norm_text(m.get("meetingName")) == wanted]
    if exact:
        meetings = exact
    elif wanted and len(meetings) <= 8:
        pass  # Bounded cross-domain proof; never use runner-number-only guessing.
    else:
        return None, None, "no exact meeting and too many candidates for safe discovery"
    candidates = []
    race_errors = []
    for meeting in meetings:
        venue = meeting.get("venueMnemonic")
        race_type = meeting.get("raceType")
        if not venue or not race_type:
            continue
        try:
            race = (api.probe_race if hasattr(api, "probe_race") else api.race)(str(bet.get("eventDate")), str(venue), str(race_type), race_number)
        except Exception as ex:
            race_errors.append(f"{meeting.get('meetingName') or venue}: {str(ex)[:240]}")
            continue
        if not isinstance(race, dict):
            continue

        # Exotics have only runner-number selections; those are usually not unique
        # enough worldwide, so do not pretend they identify a meeting.
        if bet.get("betType") in ("TRIFECTA", "FIRST_4"):
            continue

        runner, method = match_runner(race, bet)
        if runner is None:
            continue

        # Runner-name matches are strong. Runner-number-only matches need extra
        # evidence when possible. If no extra financial evidence exists, several
        # candidates will normally survive and the resolver returns unresolved.
        financial = tote_wp_candidate_financial_match(bet, runner)
        if financial is None:
            financial = tote_candidate_financial_match(bet, runner)
        candidates.append({
            "meeting": meeting,
            "race": race,
            "runner": runner,
            "runnerMatch": method,
            "financialMatch": financial,
        })

    # Prefer candidates explicitly reconciled to CSV payout/dividends.
    financial_true = [c for c in candidates if c["financialMatch"] is True]
    if len(financial_true) == 1:
        c = financial_true[0]
        return c["meeting"], c["race"], "DEEP_API_UNIQUE_FINANCIAL_MATCH"

    # Exact runner-name match can uniquely identify a worldwide race.
    name_matches = [c for c in candidates if c["runnerMatch"] == "RUNNER_NAME"]
    if len(name_matches) == 1:
        c = name_matches[0]
        return c["meeting"], c["race"], "DEEP_API_UNIQUE_RUNNER_NAME"

    # Runner number alone is accepted only if it leaves exactly one candidate.
    if len(candidates) == 1:
        c = candidates[0]
        return c["meeting"], c["race"], "DEEP_API_UNIQUE_RUNNER"

    if not candidates and race_errors:
        return None, None, (
            f"deep API could not evaluate candidates because {len(race_errors)} race lookup(s) failed; "
            f"first error: {race_errors[0]}"
        )
    suffix = f"; raceLookupFailures={len(race_errors)}" if race_errors else ""
    return None, None, f"deep API resolution not unique: {len(candidates)} candidate race(s){suffix}"


def extract_api_id(obj, keys):
    for key in keys:
        value = obj.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def get_runner_id(runner):
    # Do not substitute propositionNumber as runnerId. Use only an explicit API ID.
    return extract_api_id(runner, ("runnerId", "runnerID", "id"))


def get_race_id(race, jurisdiction, event_date, venue_mnemonic, race_type, race_number):
    # Do not synthesize a contract ID from route coordinates.
    return extract_api_id(race, ("raceId", "raceID", "id"))


def find_replay_urls(value, key_path=""):
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{key_path}.{key}" if key_path else str(key)
            found.extend(find_replay_urls(child, path))
        return found
    if isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_replay_urls(child, f"{key_path}[{index}]"))
        return found
    if not isinstance(value, str):
        return found
    lower_path = key_path.lower()
    for url in ENRICH_URL_RE.findall(value):
        clean = url.rstrip(".,);]")
        if ".mp4" in clean.lower() or "replay" in lower_path or "video" in lower_path or "media" in lower_path:
            found.append(clean)
    return found


def choose_replay_url(race):
    urls = find_replay_urls(race)
    for url in urls:
        if ".mp4" in url.lower():
            return url
    return urls[0] if urls else None


def selected_runner_details(race, runner_numbers):
    runners = [r for r in enrich_as_list(race.get("runners")) if isinstance(r, dict)]
    found, missing = [], []
    for number in runner_numbers:
        matches = [r for r in runners if enrich_to_int(r.get("runnerNumber")) == number]
        if len(matches) != 1:
            missing.append(number)
            continue
        runner = matches[0]
        raw_position = enrich_to_int(runner.get("finishingPosition"))
        if raw_position is None:
            raw_position = recovery_finishing_position(race, runner)
            if raw_position is not None:
                print(f"      [RECOVERY] Official results provide finishing position {raw_position}")
        found.append({
            "runnerId": get_runner_id(runner),
            "runnerNumber": number,
            "runnerName": runner.get("runnerName"),
            "finishingPosition": raw_position if raw_position is not None and raw_position >= 0 else None,
        })
    return found, missing


def official_result_order(race):
    result = []
    for runner in enrich_as_list(race.get("runners")):
        if not isinstance(runner, dict):
            continue
        position = enrich_to_int(runner.get("finishingPosition"))
        if position is None or position <= 0:
            continue
        result.append({
            "finishingPosition": position,
            "runnerId": get_runner_id(runner),
            "runnerNumber": enrich_to_int(runner.get("runnerNumber")),
            "runnerName": runner.get("runnerName"),
        })
    return sorted(result, key=lambda item: (item["finishingPosition"], item.get("runnerNumber") or 9999))


def classify_for_enrichment(bet):
    # Pass 1 already removed non-horse records. All surviving records are horse
    # records/candidates and should attempt race enrichment.
    return "RACING" if bet.get("domainClassification") in ("HORSE_CONFIRMED_CSV", "HORSE_CANDIDATE") else "NOT_APPLICABLE"


def enrichment_required_for_finalisation(bet):
    """True only when enrichment is needed to finalise financial/result facts.

    Race metadata/replay may still be useful content enrichment while this is False.
    """
    if classify_for_enrichment(bet) != "RACING":
        return False

    if bet.get("betType") == "TOTE_WIN_PLACE":
        # Current final bettings.json needs total return, not a component split.
        # CSV combined payout (or a source-confirmed loss) is sufficient financially.
        if bet.get("combinedPayout") is not None:
            return False
        return bet.get("betResult") != "LOSS"

    if bet.get("betType") in ("TRIFECTA", "FIRST_4"):
        # Current validated exotic fixtures are source-confirmed losses and are
        # financially final from CSV. Future non-loss/unknown exotics require result
        # enrichment before we can safely finalise.
        return bet.get("betResult") not in ("WIN", "LOSS")

    # Fixed and simple Tote WIN/PLACE settlement is source-authoritative.
    return False


def enrichment_impact(bet):
    return "REQUIRED_FOR_FINALISATION" if enrichment_required_for_finalisation(bet) else "OPTIONAL"


def expected_enrichment_fields(bet):
    """Race facts required before a normal single-runner bet can be Kubrick-ready.

    replayUrl remains genuinely optional because Kubrick permits null. Exotics are
    retained through enrichment for evidence but are not forced into a false
    single-runner identity; the authoritative Kubrick validator will quarantine
    them until the Kubrick contract explicitly supports multi-runner selections.
    """
    base = ["raceTime", "raceName", "meeting", "state", "raceNumber"]
    if bet.get("betType") in ("TRIFECTA", "FIRST_4"):
        return base
    return base + ["runnerNumber", "runnerName", "finishingPosition"]


def enrichment_missing_fields(bet, enrichment):
    missing = []
    for field in expected_enrichment_fields(bet):
        value = enrichment.get(field)
        if field in ("meeting", "raceNumber", "runnerNumber", "runnerName"):
            value = value if value not in (None, "") else bet.get(field)
        if value in (None, ""):
            missing.append(field)
    return missing



def melbourne_utc_offset(local_dt):
    """Australia/Melbourne UTC offset without system tzdata (Windows-safe)."""
    year = local_dt.year
    def first_sunday(month):
        first = datetime(year, month, 1)
        return 1 + (6 - first.weekday()) % 7
    april_change = datetime(year, 4, first_sunday(4), 3)
    october_change = datetime(year, 10, first_sunday(10), 2)
    in_dst = local_dt < april_change or local_dt >= october_change
    return timezone(timedelta(hours=11 if in_dst else 10))


def melbourne_racing_date(utc_dt):
    """Resolve Australian racing date without a ZoneInfo dependency."""
    approx_local = utc_dt.astimezone(timezone(timedelta(hours=10))).replace(tzinfo=None)
    offset = melbourne_utc_offset(approx_local)
    return utc_dt.astimezone(offset).date().isoformat()


def valid_scheduled_race_time(value, event_date):
    """Return a genuine TAB race start in UTC; reject unzoned midnight placeholders."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
                return None
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
        if melbourne_racing_date(dt) != event_date:
            return None
        return dt
    except (TypeError, ValueError, OverflowError):
        return None


def estimate_missing_trifecta_race_time(bet, meeting, race, api):
    """Use same-meeting TAB starts; fall back to a marked, bounded estimate."""
    date = str(bet.get("eventDate") or "")
    number = enrich_to_int(bet.get("raceNumber"))
    venue = meeting.get("venueMnemonic")
    race_type = meeting.get("raceType")
    if number is None or not venue or enrich_norm_text(race_type) != "R":
        return None, "NO_MEETING_IDENTITY"

    known = {}
    # Look at nearby races only. The API caches repeat requests within this run.
    for neighbour in (number - 1, number + 1):
        if neighbour < 1:
            continue
        try:
            item = (api.probe_race if hasattr(api, "probe_race") else api.race)(date, str(venue), str(race_type), neighbour)
            if isinstance(item, dict) and enrich_to_int(item.get("raceNumber")) == neighbour:
                dt = valid_scheduled_race_time(item.get("raceStartTime"), date)
                if dt is not None:
                    known[neighbour] = dt
        except Exception:
            continue

    before = max((n for n in known if n < number), default=None)
    after = min((n for n in known if n > number), default=None)
    estimated = None
    method = None
    if before is not None and after is not None:
        gap = (known[after] - known[before]).total_seconds() / (60 * (after - before))
        if 15 <= gap <= 60:
            estimated = known[before] + timedelta(minutes=gap * (number - before))
            method = "SAME_MEETING_INTERPOLATION"

    if estimated is None and (before is not None or after is not None):
        intervals = []
        ordered = sorted(known)
        for first, second in zip(ordered, ordered[1:]):
            per_race = (known[second] - known[first]).total_seconds() / (60 * (second - first))
            if 15 <= per_race <= 60:
                intervals.append(per_race)
        intervals.sort()
        # A single genuine same-meeting start is still useful: use an explicitly
        # estimated 35-minute cadence instead of silently dropping the bet.
        cadence = intervals[len(intervals) // 2] if intervals else 35
        anchor = before if before is not None else after
        if abs(number - anchor) <= 4:
            estimated = known[anchor] + timedelta(minutes=cadence * (number - anchor))
            method = "SAME_MEETING_EXTRAPOLATION" if intervals else "SAME_MEETING_35MIN_ESTIMATE"

    # TAB's resultedTime is a bound, not the actual race start. Use it to
    # constrain an estimate; when no schedule anchor exists, estimate 10m prior.
    resulted = None
    try:
        raw = race.get("resultedTime")
        if raw:
            resulted = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if resulted.tzinfo is None:
                resulted = resulted.replace(tzinfo=timezone.utc)
            resulted = resulted.astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass
    if resulted is not None and (estimated is None or estimated >= resulted):
        estimated = resulted - timedelta(minutes=10)
        method = "TAB_RESULTED_TIME_MINUS_10MIN_ESTIMATE"

    if estimated is None:
        return None, "NO_TAB_TIME_REFERENCE"

    # Source TAB date uses English abbreviated weekday/month. Match the numeric
    # parts directly to avoid Windows locale-dependent strptime failures.
    raw_bet_time = str(bet.get("betTime") or "").strip()
    match = re.fullmatch(
        r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+"
        r"(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})",
        raw_bet_time, flags=re.I
    )
    if not match:
        return None, "BET_TIME_UNPARSABLE"
    try:
        month = ("jan", "feb", "mar", "apr", "may", "jun",
                 "jul", "aug", "sep", "oct", "nov", "dec").index(match.group(1).lower()) + 1
        placed = datetime(int(match.group(3)), month, int(match.group(2)),
                          int(match.group(4)), int(match.group(5)), int(match.group(6)),
                          tzinfo=melbourne_utc_offset(datetime(int(match.group(3)), month, int(match.group(2)), int(match.group(4)), int(match.group(5)), int(match.group(6))))).astimezone(timezone.utc)
    except ValueError:
        return None, "BET_TIME_UNPARSABLE"

    if estimated <= placed:
        # Preserve temporal order when the estimate is otherwise too early.
        candidate = placed + timedelta(minutes=30)
        if resulted is not None and candidate >= resulted:
            return None, "NO_PLAUSIBLE_TIME_BET_TO_RESULT"
        estimated = candidate
        method = "BET_TIME_PLUS_30MIN_ESTIMATE"
    if resulted is not None and estimated >= resulted:
        return None, "ESTIMATE_NOT_BEFORE_RESULT"
    if melbourne_racing_date(estimated) != date:
        return None, "ESTIMATE_OUTSIDE_RACE_DATE"
    return estimated.isoformat(), method


def recovery_finishing_position(race, runner):
    """Recover an official placed position only from an explicit results entry."""
    if runner is None:
        return None
    number = enrich_to_int(runner.get("runnerNumber"))
    name = enrich_norm_text(runner.get("runnerName"))
    matches = []
    for item in enrich_as_list(race.get("results")):
        if not isinstance(item, dict):
            continue
        raw_position = item.get("finishingPosition")
        pos = enrich_to_int(raw_position if raw_position is not None else item.get("position"))
        if pos is None or pos < 0:
            continue
        item_number = enrich_to_int(item.get("runnerNumber"))
        item_name = enrich_norm_text(item.get("runnerName"))
        if (number is not None and item_number == number) or (name and item_name == name):
            matches.append(pos)
    return matches[0] if len(matches) == 1 else None


def race_enrichment(meeting, race, api, event_date, race_number):
    venue = meeting.get("venueMnemonic")
    race_type = meeting.get("raceType")
    return {
        "raceTime": race.get("raceStartTime"),
        "raceId": get_race_id(race, api.jurisdiction, event_date, venue, race_type, race_number),
        "raceName": race.get("raceName"),
        "meeting": meeting.get("meetingName"),
        "state": meeting.get("location"),
        "raceNumber": enrich_to_int(race.get("raceNumber")) or race_number,
        "replayUrl": choose_replay_url(race),
    }


def resolve_meeting_and_race(bet, api, store):
    event_date = bet.get("eventDate")
    race_number = enrich_to_int(bet.get("raceNumber"))
    source_meeting = bet.get("meeting")
    source_meeting_type = bet.get("meetingType")
    if not event_date or race_number is None:
        return None, None, "INPUT", "missing eventDate or raceNumber"

    date_payload = api.date(str(event_date))

    # 1. Fast path: exact CSV meeting text. If this exact identity proves G/H,
    # stop immediately; do not reinterpret the same source bet as another horse race.
    meeting, direct_reason = match_meeting_exact(date_payload, source_meeting, race_number)
    if meeting is not None:
        venue, race_type = meeting.get("venueMnemonic"), meeting.get("raceType")
        if enrich_norm_text(race_type) != "R":
            return meeting, None, "NON_HORSE_API", (
                f"{direct_reason}; exact resolved raceType={race_type!r} is not horse raceType R"
            )
        if venue and race_type:
            try:
                race = api.race(str(event_date), str(venue), str(race_type), race_number)
                if isinstance(race, dict) and enrich_to_int(race.get("raceNumber")) == race_number:
                    return meeting, race, "DIRECT", direct_reason
            except Exception as ex:
                direct_reason = f"{direct_reason}; race lookup failed: {ex}"

    # 2. Persistent local learned mappings. Multiple worldwide targets may be stored.
    mappings, lookup_reason = store.lookup(source_meeting, source_meeting_type)
    if mappings:
        valid = []
        for mapping in mappings:
            mapped_meeting = find_meeting_from_mapping(date_payload, mapping, race_number)
            if mapped_meeting is not None:
                valid.append(mapped_meeting)

        unique = {}
        for m in valid:
            key = (
                enrich_norm_text(m.get("meetingName")),
                enrich_norm_text(m.get("location")),
                enrich_norm_text(m.get("venueMnemonic")),
                enrich_norm_text(m.get("raceType")),
            )
            unique[key] = m
        valid = list(unique.values())

        if len(valid) == 1:
            meeting = valid[0]
            venue, race_type = meeting.get("venueMnemonic"), meeting.get("raceType")
            try:
                race = api.race(str(event_date), str(venue), str(race_type), race_number)
                if isinstance(race, dict) and enrich_to_int(race.get("raceNumber")) == race_number:
                    return meeting, race, "LOCAL_LOOKUP", lookup_reason
            except Exception as ex:
                lookup_reason = f"{lookup_reason}; mapped race lookup failed: {ex}"
        elif len(valid) > 1:
            store.ambiguous += 1
            lookup_reason = f"LOCAL_LOOKUP_AMBIGUOUS_FOR_DATE_RACE:{len(valid)}"
        else:
            lookup_reason = f"{lookup_reason}; no stored target valid for requested date/race"

    # 3. Domain verification for ambiguous racing candidates. The CSV does not
    # always say Gallops/Greyhounds/Harness, so prove the runner across R/G/H before
    # restricting the expensive fallback to horse races.
    domain_meeting, domain_race, domain_reason = verify_ambiguous_racing_domain(date_payload, bet, api)
    if domain_meeting is not None and domain_race is not None:
        domain_type = enrich_norm_text(domain_meeting.get("raceType"))
        if domain_type != "R":
            return domain_meeting, None, "NON_HORSE_API", (
                f"{domain_reason}; exact runner resolved raceType={domain_meeting.get('raceType')!r} "
                "is not horse raceType R"
            )
        # A uniquely proven horse candidate can proceed directly. Persist only R
        # mappings, preserving the existing learned-lookup invariant.
        try:
            store.put_proven(source_meeting, source_meeting_type, domain_meeting)
        except Exception as ex:
            print(f"      [LOOKUP WARNING] proven meeting was not persisted: {ex}")
            domain_reason = f"{domain_reason}; local lookup persist failed: {ex}"
        # Discovery probes are deliberately single-shot; now apply the full
        # six-attempt rule only to the uniquely identified race.
        try:
            domain_race = api.race(str(event_date), str(domain_meeting.get("venueMnemonic")),
                                   str(domain_meeting.get("raceType")), race_number)
        except Exception:
            pass
        return domain_meeting, domain_race, "DOMAIN_API", domain_reason

    # 4. Existing expensive fallback: horse candidates only.
    meeting, race, deep_reason = deep_resolve_meeting(date_payload, bet, api)
    if meeting is not None and race is not None:
        if enrich_norm_text(meeting.get("raceType")) != "R":
            return None, None, "UNRESOLVED", f"deep resolver returned non-horse raceType={meeting.get('raceType')!r}"
        # Learned lookup persistence is an optimisation, not a prerequisite for
        # enriching the current bet. A disk/permission error must not discard a
        # race that DEEP_API has already proven.
        try:
            store.put_proven(source_meeting, source_meeting_type, meeting)
        except Exception as ex:
            print(f"      [LOOKUP WARNING] proven meeting was not persisted: {ex}")
            deep_reason = f"{deep_reason}; local lookup persist failed: {ex}"
        try:
            race = api.race(str(event_date), str(meeting.get("venueMnemonic")),
                            str(meeting.get("raceType")), race_number)
        except Exception:
            pass
        return meeting, race, "DEEP_API", deep_reason

    print(f"      [RESOLVE] No uniquely verified meeting for {source_meeting!r} R{race_number}; keeping unresolved")
    return None, None, "UNRESOLVED", (
        f"direct={direct_reason}; localLookup={lookup_reason}; "
        f"domain={domain_reason}; deep={deep_reason}"
    )


def enrich_one_bet(bet, api, store):
    enriched_bet = json.loads(json.dumps(bet, default=json_default))
    classification = classify_for_enrichment(bet)
    required = enrichment_required_for_finalisation(bet)
    impact = enrichment_impact(bet)

    if classification != "RACING":
        enriched_bet["enrichment"] = {
            "status": "NOT_APPLICABLE",
            "impact": impact,
            "reason": classification,
        }
        return enriched_bet, None

    try:
        meeting, race, resolution_method, resolution_reason = resolve_meeting_and_race(bet, api, store)
        if resolution_method == "NON_HORSE_API":
            enriched_bet["enrichment"] = {
                "status": "EXCLUDED_NON_HORSE",
                "required": False,
                "impact": "OPTIONAL",
                "stage": "DOMAIN_VERIFICATION",
                "reason": resolution_reason,
                "resolutionMethod": resolution_method,
            }
            enriched_bet["excludeFromRecap"] = True
            return enriched_bet, None

        if meeting is None or race is None:
            reason = resolution_reason
            enriched_bet["enrichment"] = {
                "status": "UNRESOLVED",
                "required": required,
                "impact": impact,
                "stage": "MEETING_RESOLUTION",
                "reason": reason,
            }
            return enriched_bet, {
                "canonicalId": bet.get("canonicalId"),
                "stage": "MEETING_RESOLUTION",
                "impact": impact,
                "reason": reason,
            }

        event_date = str(bet.get("eventDate"))
        race_number = enrich_to_int(bet.get("raceNumber"))
        enrichment = race_enrichment(meeting, race, api, event_date, race_number)
        if valid_scheduled_race_time(enrichment.get("raceTime"), event_date) is None:
            inferred, method = estimate_missing_trifecta_race_time(bet, meeting, race, api)
            enrichment["raceTime"] = inferred
            enrichment["raceTimeSource"] = "ESTIMATED" if inferred else "UNAVAILABLE"
            enrichment["raceTimeMethod"] = method
            print(f"      [RECOVERY] Race time {inferred or 'unavailable'} ({method})")
        else:
            enrichment["raceTimeSource"] = "TAB"
        enrichment.update({
            "status": "ENRICHED",
            "required": required,
            "impact": impact,
            "resolutionMethod": resolution_method,
            "resolutionReason": resolution_reason,
        })

        if bet.get("betType") in ("TRIFECTA", "FIRST_4"):
            selections = [int(v) for v in bet.get("selections", [])]
            selected, missing_numbers = selected_runner_details(race, selections)
            enrichment["selectedRunners"] = selected
            enrichment["officialResultOrder"] = official_result_order(race)
            if missing_numbers:
                enrichment.update({
                    "status": "PARTIAL",
                    "reason": f"selected runner(s) not found: {missing_numbers}",
                })
            missing_fields = enrichment_missing_fields(bet, enrichment)
            enrichment["missingFields"] = missing_fields
            if enrichment.get("status") == "ENRICHED" and missing_fields:
                enrichment["status"] = "PARTIAL"
                enrichment["reason"] = "expected enrichment field(s) unavailable: " + ", ".join(missing_fields)
            enriched_bet["enrichment"] = enrichment
            return enriched_bet, None

        runner, runner_reason = match_runner(race, bet)
        if runner is None:
            # Race identity is proven, so retain race-level enrichment and mark only
            # the runner portion partial rather than calling the whole record unresolved.
            enrichment.update({
                "status": "PARTIAL",
                "stage": "RUNNER_MATCH",
                "reason": runner_reason,
            })
            enrichment["missingFields"] = enrichment_missing_fields(bet, enrichment)
            enriched_bet["enrichment"] = enrichment
            return enriched_bet, {
                "canonicalId": bet.get("canonicalId"),
                "stage": "RUNNER_MATCH",
                "impact": impact,
                "reason": runner_reason,
            }

        raw_position = enrich_to_int(runner.get("finishingPosition"))
        if raw_position is None:
            raw_position = recovery_finishing_position(race, runner)
            if raw_position is not None:
                print(f"      [RECOVERY] Official result position {raw_position}")
        enrichment.update({
            "runnerId": get_runner_id(runner),
            "runnerNumber": enrich_to_int(runner.get("runnerNumber")),
            "runnerName": runner.get("runnerName"),
            "finishingPosition": raw_position if raw_position is not None and raw_position >= 0 else None,
        })

        # Simple Tote WIN/PLACE needs the official historical dividend because
        # losing Tote bets cannot derive a positive Kubrick odds value from CSV.
        if bet.get("pricingType") == "TOTE" and bet.get("betType") in ("WIN", "PLACE"):
            tote = runner.get("parimutuel") if isinstance(runner.get("parimutuel"), dict) else {}
            dividend_key = "returnWin" if bet.get("betType") == "WIN" else "returnPlace"
            tote_dividend = enrich_to_decimal(tote.get(dividend_key))
            enrichment["toteDividend"] = float(tote_dividend) if tote_dividend is not None and tote_dividend > 0 else None

        if bet.get("betType") == "TOTE_WIN_PLACE":
            win_stake = enrich_money2(bet.get("winStake"))
            place_stake = enrich_money2(bet.get("placeStake"))
            csv_combined = enrich_money2(bet.get("combinedPayout"))
            tote = runner.get("parimutuel") if isinstance(runner.get("parimutuel"), dict) else {}
            win_dividend = enrich_to_decimal(tote.get("returnWin"))
            place_dividend = enrich_to_decimal(tote.get("returnPlace"))
            enrichment["toteWinDividend"] = float(win_dividend) if win_dividend is not None and win_dividend > 0 else None
            enrichment["totePlaceDividend"] = float(place_dividend) if place_dividend is not None and place_dividend > 0 else None
            resolution = {
                "reconciled": False,
                "winReturn": None,
                "placeReturn": None,
                "calculatedCombinedReturn": None,
                "csvCombinedPayout": float(csv_combined) if csv_combined is not None else None,
            }
            if csv_combined is None and bet.get("betResult") == "LOSS":
                resolution.update({
                    "reconciled": True,
                    "outcome": "LOST_BOTH",
                    "winReturn": 0.0,
                    "placeReturn": 0.0,
                    "calculatedCombinedReturn": 0.0,
                })
            elif win_stake is not None and place_stake is not None and win_dividend is not None and place_dividend is not None:
                win_return = enrich_money2(win_stake * win_dividend)
                place_return = enrich_money2(place_stake * place_dividend)
                total = enrich_money2(win_return + place_return)
                resolution.update({
                    "winReturn": float(win_return),
                    "placeReturn": float(place_return),
                    "calculatedCombinedReturn": float(total),
                })
                if csv_combined is not None and total == csv_combined:
                    resolution["reconciled"] = True
                    resolution["outcome"] = "WIN_AND_PLACE" if win_return > 0 and place_return > 0 else "PLACE_ONLY" if place_return > 0 else "UNRESOLVED_ZERO_COMPONENTS"
            elif csv_combined is not None:
                resolution["reason"] = "required Tote W&P dividend missing; missing dividend is not assumed to be zero"
            enrichment["toteWinPlaceResolution"] = resolution
            if required and not resolution["reconciled"]:
                enrichment["status"] = "PARTIAL"
                enrichment["reason"] = "Tote W&P API dividends did not reconcile to CSV combined payout"

        missing_fields = enrichment_missing_fields(bet, enrichment)
        enrichment["missingFields"] = missing_fields
        if enrichment.get("status") == "ENRICHED" and missing_fields:
            enrichment["status"] = "PARTIAL"
            enrichment["reason"] = "expected enrichment field(s) unavailable: " + ", ".join(missing_fields)

        enriched_bet["enrichment"] = enrichment
        return enriched_bet, None

    except Exception as ex:
        reason = str(ex)
        enriched_bet["enrichment"] = {
            "status": "UNRESOLVED",
            "required": required,
            "impact": impact,
            "stage": "API_LOOKUP",
            "reason": reason,
        }
        return enriched_bet, {
            "canonicalId": bet.get("canonicalId"),
            "stage": "API_LOOKUP",
            "impact": impact,
            "reason": reason,
        }


def enrich_normalised_payload(normalised, api, store):
    enriched_bets, exceptions, counts = [], [], Counter()
    api_non_horse_excluded = 0
    for bet in normalised.get("bets", []):
        print(f"      [BET] {bet.get('meeting') or 'UNKNOWN'} R{bet.get('raceNumber') or '?'} / {bet.get('betType')}")
        enriched_bet, enrichment_exception = enrich_one_bet(bet, api, store)
        status = enriched_bet.get("enrichment", {}).get("status", "UNRESOLVED")
        counts[status] += 1

        if enriched_bet.get("excludeFromRecap") or status == "EXCLUDED_NON_HORSE":
            api_non_horse_excluded += 1
            continue

        enriched_bets.append(enriched_bet)
        if enrichment_exception:
            exceptions.append(enrichment_exception)

    print(f"      [API SUMMARY] {api.race_calls} race requests, {api.discovery_calls} single-shot discovery requests, "
          f"{api.cache_hits} cache hits, {api.degraded_races} degraded races")
    payload = {
        "enrichmentSchemaVersion": "0.9-local-test",
        "normaliserSchemaVersion": normalised.get("normaliserSchemaVersion"),
        "jobId": normalised.get("jobId"),
        "source": normalised.get("source"),
        "domainSummary": {
            **normalised.get("domainSummary", {}),
            "apiNonHorseExcluded": api_non_horse_excluded,
        },
        "bets": enriched_bets,
    }
    summary = {
        "jobId": normalised.get("jobId"),
        "inputCanonicalBets": len(normalised.get("bets", [])),
        "outputCanonicalBets": len(enriched_bets),
        "horseBetsIncluded": len(enriched_bets),
        "nonHorseBetsExcluded": normalised.get("domainSummary", {}).get("nonHorseBetsExcluded", 0) + api_non_horse_excluded,
        "apiNonHorseExcluded": api_non_horse_excluded,
        "enriched": counts["ENRICHED"],
        "partial": counts["PARTIAL"],
        "unresolved": counts["UNRESOLVED"],
        "notApplicable": counts["NOT_APPLICABLE"],
        "directResolutions": sum(1 for b in enriched_bets if b.get("enrichment", {}).get("resolutionMethod") == "DIRECT"),
        "localLookupResolutions": sum(1 for b in enriched_bets if b.get("enrichment", {}).get("resolutionMethod") == "LOCAL_LOOKUP"),
        "deepApiResolutions": sum(1 for b in enriched_bets if b.get("enrichment", {}).get("resolutionMethod") == "DEEP_API"),
        "requiredFinalisationUnresolved": sum(
            1 for b in enriched_bets
            if b.get("enrichment", {}).get("required") is True
            and b.get("enrichment", {}).get("status") not in ("ENRICHED",)
        ),
        "optionalEnrichmentUnresolved": sum(
            1 for b in enriched_bets
            if b.get("enrichment", {}).get("required") is not True
            and b.get("enrichment", {}).get("status") in ("PARTIAL", "UNRESOLVED")
        ),
        "exceptionCount": len(exceptions),
        "pass2Status": "COMPLETE",
    }
    return payload, exceptions, summary


# =============================================================================
# STAGE 0 — LOCAL CSV/DAY DISCOVERY
# =============================================================================

def scan_racing_days(files):
    """Return selectable horse-racing days without calling the historical API."""
    days = []
    scan_errors = []
    for path in files:
        try:
            normalised, _, _ = normalise_csv(path, f"scan-{path.stem}", path.name)
            counts = Counter(
                str(b.get("eventDate"))
                for b in normalised.get("bets", [])
                if valid_date(str(b.get("eventDate") or ""))
            )
            for day, count in counts.items():
                days.append({
                    "selectedDate": day,
                    "sourceCsvPath": path,
                    "displayDate": datetime.strptime(day, "%Y-%m-%d").strftime("%A %d %b %Y"),
                    "eligibleHorseBetCount": count,
                })
        except Exception as ex:
            scan_errors.append({"sourceFile": path.name, "error": str(ex)})
    days.sort(key=lambda item: (item["selectedDate"], item["sourceCsvPath"].name.lower()), reverse=True)
    return days, scan_errors


def choose_racing_day(days):
    print("\nAvailable racing days:\n")
    for index, item in enumerate(days, 1):
        print(f"  [{index}]  {item['displayDate']:<24} {item['eligibleHorseBetCount']:>3} bets")
    while True:
        try:
            raw = input(f"\nSelect racing day [1-{len(days)}]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\nSelection cancelled.")
            return None
        if raw.isdigit():
            choice = int(raw)
            if 1 <= choice <= len(days):
                return days[choice - 1]
        print(f"Invalid selection. Enter a number from 1 to {len(days)}.")


def filter_normalised_to_day(normalised, selected_date):
    filtered = [b for b in normalised.get("bets", []) if str(b.get("eventDate")) == selected_date]
    for index, bet in enumerate(filtered, 1):
        bet["sequence"] = index
    result = dict(normalised)
    result["bets"] = filtered
    result["selectedDate"] = selected_date
    result["domainSummary"] = dict(normalised.get("domainSummary", {}))
    result["domainSummary"]["selectedDayHorseBets"] = len(filtered)
    return result


# =============================================================================
# CANDIDATE KUBRICK PAYLOAD — BUILD + LOCAL CONTRACT VALIDATION
# =============================================================================

KUBRICK_REQUIRED_BET_FIELDS = (
    "sequence", "betTime", "raceTime", "raceName", "meeting", "state",
    "raceNumber", "runnerNumber", "runnerName", "betType", "stake",
    "odds", "result", "finishingPosition", "return", "profitLoss", "runningPnl",
    "replayUrl",
)

KUBRICK_OPTIONAL_BET_FIELDS = ("raceId", "runnerId")
KUBRICK_ALLOWED_BET_FIELDS = KUBRICK_REQUIRED_BET_FIELDS + KUBRICK_OPTIONAL_BET_FIELDS + ("selectedRunners",)


def candidate_odds(bet):
    """Return the canonical positive odds value without fabricating source facts."""
    if bet.get("odds") is not None and float(bet["odds"]) > 0:
        return float(bet["odds"])

    e = bet.get("enrichment", {})
    if e.get("toteDividend") is not None and float(e["toteDividend"]) > 0:
        return float(e["toteDividend"])

    if bet.get("betType") == "TOTE_WIN_PLACE":
        stake = best_effort_stake(bet)
        returned = best_effort_return(bet)

        # Preferred rule for a returned composite: effective whole-transaction
        # multiple actually achieved by the customer.
        if stake is not None and float(stake) > 0 and returned is not None and float(returned) > 0:
            return round(float(returned) / float(stake), 6)

        # For a settled loss, return/stake is zero and cannot satisfy Kubrick's
        # positive-odds contract. Use only official historical component Tote
        # dividends when both are available; weight them by the actual component
        # stakes to produce one deterministic composite multiple.
        win_dividend = e.get("toteWinDividend")
        place_dividend = e.get("totePlaceDividend")
        win_stake = bet.get("winStake")
        place_stake = bet.get("placeStake")
        total_stake = bet.get("totalStake")
        if all(v is not None for v in (win_dividend, place_dividend, win_stake, place_stake, total_stake)):
            total_stake = float(total_stake)
            if total_stake > 0:
                effective = (
                    float(win_stake) * float(win_dividend)
                    + float(place_stake) * float(place_dividend)
                ) / total_stake
                if effective > 0:
                    return round(effective, 6)

        # Never manufacture a positive number merely to pass Kubrick. This
        # transaction will be quarantined by exact validation if the historical
        # evidence cannot support a positive composite odds value.
        return None

    return None


def candidate_return(bet):
    value = best_effort_return(bet)
    return float(value) if value is not None else None


def candidate_stake(bet):
    value = best_effort_stake(bet)
    return float(value) if value is not None else None


def build_candidate_kubrick_payload(enriched_payload, selected_date, first_name="Customer", timezone_name="Australia/Melbourne"):
    bets = sorted(enriched_payload.get("bets", []), key=lambda b: b.get("sequence") or 999999)
    final_bets = []
    running = 0.0
    for sequence, bet in enumerate(bets, 1):
        e = bet.get("enrichment", {})
        stake = candidate_stake(bet)
        returned = candidate_return(bet)
        pnl = round(returned - stake, 2) if stake is not None and returned is not None else None
        if pnl is None or running is None:
            running = None
        else:
            running = round(running + pnl, 2)
        record = {
            "sequence": sequence,
            "betTime": bet.get("betTime"),
            "raceTime": e.get("raceTime"),
            "raceName": e.get("raceName"),
            "meeting": e.get("meeting") or bet.get("meeting"),
            "state": e.get("state"),
            "raceNumber": e.get("raceNumber") or bet.get("raceNumber"),
            "runnerNumber": e.get("runnerNumber") or bet.get("runnerNumber"),
            "runnerName": e.get("runnerName") or bet.get("runnerName"),
            "betType": "FIRST4" if bet.get("betType") == "FIRST_4" else bet.get("betType"),
            "stake": stake,
            "odds": candidate_odds(bet),
            "result": bet.get("betResult"),
            "finishingPosition": e.get("finishingPosition"),
            "return": returned,
            "profitLoss": pnl,
            "runningPnl": running,
            "replayUrl": e.get("replayUrl"),
        }
        if e.get("raceId") not in (None, ""):
            record["raceId"] = e.get("raceId")
        if e.get("runnerId") not in (None, ""):
            record["runnerId"] = e.get("runnerId")
        if bet.get("betType") in ("TRIFECTA", "FIRST_4"):
            record["selectedRunners"] = [
                {"runnerNumber": r.get("runnerNumber"),
                 "runnerName": r.get("runnerName"),
                 "finishingPosition": r.get("finishingPosition")}
                for r in e.get("selectedRunners", [])
            ]
        final_bets.append(record)

    stakes = [b["stake"] for b in final_bets if isinstance(b.get("stake"), (int, float))]
    returns = [b["return"] for b in final_bets if isinstance(b.get("return"), (int, float))]
    wins = [b for b in final_bets if b.get("result") == "WIN"]
    losses = [b for b in final_bets if b.get("result") == "LOSS"]
    meetings = {b.get("meeting") for b in final_bets if b.get("meeting")}

    def earliest_extreme(items, key, highest=True):
        usable = [b for b in items if isinstance(b.get(key), (int, float))]
        if not usable:
            return None
        target = (max if highest else min)(b[key] for b in usable)
        return min(b["sequence"] for b in usable if b[key] == target)

    positive_wins = [b for b in wins if isinstance(b.get("profitLoss"), (int, float)) and b["profitLoss"] > 0]
    negative_losses = [b for b in losses if isinstance(b.get("profitLoss"), (int, float)) and b["profitLoss"] < 0]

    return {
        "schemaVersion": "1.0",
        "user": {"firstName": first_name},
        "day": {"date": selected_date, "timezone": timezone_name},
        "bets": final_bets,
        "summary": {
            "totalBets": len(final_bets),
            "totalStaked": round(sum(stakes), 2) if len(stakes) == len(final_bets) else None,
            "totalReturned": round(sum(returns), 2) if len(returns) == len(final_bets) else None,
            "wins": len(wins),
            "losses": len(losses),
            "finalPnl": final_bets[-1]["runningPnl"] if final_bets else None,
            "meetings": len(meetings),
            "biggestStake": max(stakes) if len(stakes) == len(final_bets) and stakes else None,
            "biggestWinSequence": earliest_extreme(positive_wins, "profitLoss", True),
            "biggestLossSequence": earliest_extreme(negative_losses, "profitLoss", False),
            "highestOddsWinnerSequence": earliest_extreme(wins, "odds", True),
        },
    }


def validate_candidate_kubrick_payload(payload):
    """Validate against the same Kubrick v1 contract using Python stdlib only.

    The portable client intentionally has no Node/npm dependency. Kubrick itself
    remains authoritative at POST time; this validator mirrors the current
    bettings.schema.json constraints and canonical semantic rules so invalid
    transactions can be quarantined before submission.
    """
    errors = []
    required_top = ("schemaVersion", "user", "day", "bets", "summary")

    if not isinstance(payload, dict):
        return ["payload must be an object"]
    if set(payload.keys()) != set(required_top):
        errors.append(f"top-level fields must be exactly {required_top}")
    if payload.get("schemaVersion") != "1.0":
        errors.append("schemaVersion must equal '1.0'")

    user = payload.get("user")
    if (
        not isinstance(user, dict)
        or set(user.keys()) != {"firstName"}
        or not isinstance(user.get("firstName"), str)
        or not user.get("firstName")
    ):
        errors.append("user.firstName must be a non-empty string and user must contain no extra fields")

    day = payload.get("day")
    if not isinstance(day, dict) or set(day.keys()) != {"date", "timezone"}:
        errors.append("day must contain exactly date and timezone")
    else:
        if not valid_date(day.get("date")):
            errors.append("day.date must be YYYY-MM-DD")
        if not isinstance(day.get("timezone"), str) or not day.get("timezone"):
            errors.append("day.timezone must be a non-empty string")

    bets = payload.get("bets")
    if not isinstance(bets, list) or not bets:
        errors.append("bets must contain at least one bet")
        return errors

    def is_number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    for index, bet in enumerate(bets, 1):
        prefix = f"bet {index}"
        if not isinstance(bet, dict):
            errors.append(f"{prefix}: must be an object")
            continue

        missing = [field for field in KUBRICK_REQUIRED_BET_FIELDS if field not in bet]
        extra = [field for field in bet if field not in KUBRICK_ALLOWED_BET_FIELDS or (field == "selectedRunners" and bet.get("betType") not in ("TRIFECTA", "FIRST4"))]
        if missing:
            errors.append(f"{prefix}: missing fields: {', '.join(missing)}")
        if extra:
            errors.append(f"{prefix}: unexpected fields: {', '.join(extra)}")

        trifecta = bet.get("betType") in ("TRIFECTA", "FIRST4")
        # Race-time provenance is assessed during TAB enrichment; do not
        # reclassify a valid TAB timestamp during candidate contract validation.
        for field in ("betTime", "raceTime", "raceName", "meeting", "state", "betType") + (() if trifecta else ("runnerName",)):
            if not isinstance(bet.get(field), str) or not bet.get(field):
                errors.append(f"{prefix}: {field} must be a non-empty string")

        for field in KUBRICK_OPTIONAL_BET_FIELDS:
            if field in bet and (not isinstance(bet.get(field), str) or not bet.get(field)):
                errors.append(f"{prefix}: {field} must be a non-empty string when present")

        for field in ("sequence", "raceNumber") + (() if trifecta else ("runnerNumber",)):
            value = bet.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                errors.append(f"{prefix}: {field} must be an integer >= 1")

        finishing_position = bet.get("finishingPosition")
        if not trifecta and (
            not isinstance(finishing_position, int)
            or isinstance(finishing_position, bool)
            or finishing_position < 0
        ):
            errors.append(f"{prefix}: finishingPosition must be an integer >= 0")

        for field in ("stake", "return"):
            value = bet.get(field)
            if not is_number(value) or value < 0:
                errors.append(f"{prefix}: {field} must be a number >= 0")

        odds = bet.get("odds")
        if not trifecta and (not is_number(odds) or odds <= 0):
            errors.append(f"{prefix}: odds must be a number > 0")

        for field in ("profitLoss", "runningPnl"):
            if not is_number(bet.get(field)):
                errors.append(f"{prefix}: {field} must be a number")

        if bet.get("result") not in ("WIN", "LOSS"):
            errors.append(f"{prefix}: result must be WIN or LOSS")

        if trifecta:
            runners = bet.get("selectedRunners")
            if not isinstance(runners, list) or len(runners) < (4 if bet.get("betType") == "FIRST4" else 3):
                errors.append(f"{prefix}: {bet.get('betType')} requires at least {4 if bet.get('betType') == 'FIRST4' else 3} named selectedRunners")
            else:
                numbers = []
                for runner in runners:
                    if not isinstance(runner, dict) or set(runner) != {"runnerNumber", "runnerName", "finishingPosition"}:
                        errors.append(f"{prefix}: selectedRunners entries require runnerNumber, runnerName and finishingPosition")
                        continue
                    number = runner["runnerNumber"]
                    if not isinstance(number, int) or isinstance(number, bool) or number < 1:
                        errors.append(f"{prefix}: selected runnerNumber must be a positive integer")
                    else:
                        numbers.append(number)
                    if not isinstance(runner["runnerName"], str) or not runner["runnerName"].strip():
                        errors.append(f"{prefix}: selected runnerName must be non-empty")
                    position = runner["finishingPosition"]
                    if position is not None and (not isinstance(position, int) or isinstance(position, bool) or position < 0):
                        errors.append(f"{prefix}: selected finishingPosition must be non-negative or null")
                if len(numbers) != len(set(numbers)):
                    errors.append(f"{prefix}: selected runner numbers must be distinct")
            if odds is not None and (not is_number(odds) or odds <= 0):
                errors.append(f"{prefix}: Exotic odds must be positive or null")

        replay = bet.get("replayUrl")
        if replay is not None:
            if not isinstance(replay, str) or not replay.strip():
                errors.append(f"{prefix}: replayUrl must be a valid non-empty HTTPS URL or null")
            else:
                try:
                    parsed = urllib.parse.urlparse(replay)
                    if parsed.scheme.lower() != "https" or not parsed.netloc:
                        raise ValueError("not HTTPS")
                except Exception:
                    errors.append(f"{prefix}: replayUrl must be a valid non-empty HTTPS URL or null")

    sequences = [bet.get("sequence") for bet in bets if isinstance(bet, dict)]
    if sequences != list(range(1, len(bets) + 1)):
        errors.append("bets[].sequence must be ascending, unique and contiguous 1..N")

    summary = payload.get("summary")
    summary_fields = (
        "totalBets", "totalStaked", "totalReturned", "wins", "losses", "finalPnl",
        "meetings", "biggestStake", "biggestWinSequence", "biggestLossSequence",
        "highestOddsWinnerSequence",
    )
    if not isinstance(summary, dict) or set(summary.keys()) != set(summary_fields):
        errors.append("summary does not match the current Kubrick summary contract")
        return errors

    for field in ("totalBets", "wins", "losses", "meetings"):
        value = summary.get(field)
        minimum = 1 if field in ("totalBets", "meetings") else 0
        if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
            errors.append(f"summary.{field} must be an integer >= {minimum}")

    for field in ("totalStaked", "totalReturned", "biggestStake"):
        value = summary.get(field)
        if not is_number(value) or value < 0:
            errors.append(f"summary.{field} must be a number >= 0")

    if not is_number(summary.get("finalPnl")):
        errors.append("summary.finalPnl must be a number")

    for field in ("biggestWinSequence", "biggestLossSequence", "highestOddsWinnerSequence"):
        value = summary.get(field)
        if value is not None and (
            not isinstance(value, int) or isinstance(value, bool) or value < 1
        ):
            errors.append(f"summary.{field} must be null or an integer >= 1")

    def money_equal(left, right):
        try:
            return round(float(left) * 100) == round(float(right) * 100)
        except (TypeError, ValueError):
            return False

    running = 0.0
    semantics_possible = True
    for index, bet in enumerate(bets, 1):
        if not isinstance(bet, dict) or not all(
            is_number(bet.get(field))
            for field in ("stake", "return", "profitLoss", "runningPnl")
        ):
            semantics_possible = False
            continue
        expected_pnl = float(bet["return"]) - float(bet["stake"])
        if not money_equal(bet["profitLoss"], expected_pnl):
            errors.append(f"bet {index}: profitLoss must equal return - stake")
        running += float(bet["profitLoss"])
        if not money_equal(bet["runningPnl"], running):
            errors.append(f"bet {index}: runningPnl does not match cumulative profitLoss")

    if summary.get("totalBets") != len(bets):
        errors.append("summary.totalBets must equal bets.length")

    wins = [bet for bet in bets if isinstance(bet, dict) and bet.get("result") == "WIN"]
    losses = [bet for bet in bets if isinstance(bet, dict) and bet.get("result") == "LOSS"]
    if (
        summary.get("wins") != len(wins)
        or summary.get("losses") != len(losses)
        or len(wins) + len(losses) != len(bets)
    ):
        errors.append("summary wins/losses do not match bet results")

    meetings = {
        bet.get("meeting")
        for bet in bets
        if isinstance(bet, dict) and bet.get("meeting")
    }
    if summary.get("meetings") != len(meetings):
        errors.append("summary.meetings must equal unique meeting count")

    if semantics_possible:
        total_staked = sum(float(bet["stake"]) for bet in bets)
        total_returned = sum(float(bet["return"]) for bet in bets)

        if not money_equal(summary.get("totalStaked"), total_staked):
            errors.append("summary.totalStaked must equal sum(stake)")
        if not money_equal(summary.get("totalReturned"), total_returned):
            errors.append("summary.totalReturned must equal sum(return)")
        if not money_equal(summary.get("finalPnl"), total_returned - total_staked):
            errors.append("summary.finalPnl must equal totalReturned - totalStaked")
        if not money_equal(summary.get("finalPnl"), bets[-1].get("runningPnl")):
            errors.append("summary.finalPnl must equal final runningPnl")

        biggest_stake = max(float(bet["stake"]) for bet in bets)
        if not money_equal(summary.get("biggestStake"), biggest_stake):
            errors.append("summary.biggestStake must equal max(stake)")

        def expected_sequence(items, key, highest):
            if not items:
                return None
            target = (max if highest else min)(float(item[key]) for item in items)
            return min(item["sequence"] for item in items if float(item[key]) == target)

        positive_wins = [bet for bet in wins if float(bet["profitLoss"]) > 0]
        negative_losses = [bet for bet in losses if float(bet["profitLoss"]) < 0]

        if summary.get("biggestWinSequence") != expected_sequence(positive_wins, "profitLoss", True):
            errors.append("summary.biggestWinSequence is inconsistent")
        if summary.get("biggestLossSequence") != expected_sequence(negative_losses, "profitLoss", False):
            errors.append("summary.biggestLossSequence is inconsistent")
        if summary.get("highestOddsWinnerSequence") != expected_sequence(wins, "odds", True):
            errors.append("summary.highestOddsWinnerSequence is inconsistent")

    return errors


def run_kubrick_contract_validator(payload_path, root):
    """Portable Python-only Kubrick contract validation."""
    schema_path = root / "bettings.schema.json"
    if not schema_path.exists():
        return {
            "valid": False,
            "validatorError": True,
            "errorCode": "KUBRICK_SCHEMA_MISSING",
            "message": f"Kubrick schema file not found: {schema_path}",
            "details": [],
        }

    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        if schema.get("properties", {}).get("schemaVersion", {}).get("const") != "1.0":
            raise ValueError("unexpected schemaVersion contract")
        payload = json.loads(Path(payload_path).read_text(encoding="utf-8"))
    except Exception as ex:
        return {
            "valid": False,
            "validatorError": True,
            "errorCode": "KUBRICK_VALIDATOR_INPUT_ERROR",
            "message": str(ex),
            "details": [],
        }

    errors = validate_candidate_kubrick_payload(payload)
    return {
        "valid": not errors,
        "validatorError": False,
        "errorCode": None if not errors else "KUBRICK_INVALID_PAYLOAD",
        "message": (
            "Payload passed Kubrick canonical schema and semantic validation."
            if not errors
            else "Payload failed canonical bettings.json validation."
        ),
        "details": errors,
    }



def transaction_groups_for_validation(enriched_payload):
    """Keep source transactions atomic while preserving original day order."""
    groups = []
    by_key = {}
    for index, bet in enumerate(
        sorted(enriched_payload.get("bets", []), key=lambda b: b.get("sequence") or 999999),
        1,
    ):
        tx = bet.get("transactionNumber")
        key = str(tx) if tx not in (None, "") else f"NO_TX_{index}"
        if key not in by_key:
            item = {"key": key, "transactionNumber": tx, "bets": []}
            by_key[key] = item
            groups.append(item)
        by_key[key]["bets"].append(bet)
    return groups


def authoritative_transaction_partition(
    enriched_payload,
    selected_date,
    first_name,
    timezone_name,
    root,
    candidate_dir,
):
    """Quarantine only source transactions that cannot satisfy Kubrick.

    Fixed W&P components share a transaction number and are therefore kept or
    excluded together. Tote W&P is already one combined transaction record.
    """
    validation_dir = candidate_dir / "transaction-validation"
    validation_dir.mkdir(parents=True, exist_ok=True)

    included = []
    quarantined = []

    for ordinal, group in enumerate(transaction_groups_for_validation(enriched_payload), 1):
        transaction_payload = dict(enriched_payload)
        transaction_payload["bets"] = list(group["bets"])
        candidate = build_candidate_kubrick_payload(
            transaction_payload,
            selected_date,
            first_name,
            timezone_name,
        )
        candidate_path = validation_dir / f"{ordinal:03d}-{group['key']}.json"
        write_json(candidate_path, candidate)
        result = run_kubrick_contract_validator(candidate_path, root)

        if result.get("validatorError"):
            raise RuntimeError(
                f"Kubrick contract validator could not run: "
                f"{result.get('errorCode')}: {result.get('message')}"
            )

        if result.get("valid"):
            included.extend(group["bets"])
            continue

        quarantined.append({
            "transactionNumber": group.get("transactionNumber"),
            "canonicalIds": [b.get("canonicalId") for b in group["bets"]],
            "betTypes": [b.get("betType") for b in group["bets"]],
            "enrichmentStatuses": [
                b.get("enrichment", {}).get("status") for b in group["bets"]
            ],
            "missingEnrichmentFields": [
                {
                    "canonicalId": b.get("canonicalId"),
                    "fields": enrichment_missing_fields(b, b.get("enrichment", {})),
                }
                for b in group["bets"]
            ],
            "errorCode": result.get("errorCode"),
            "message": result.get("message"),
            "details": result.get("details") or [],
        })

    return included, quarantined


# =============================================================================
# PASS 3 — HORSE-ONLY BEST-EFFORT DAILY bettings.json
# This intentionally approximates the current v1.0 contract. It does not fabricate
# unavailable API facts and it does not yet fully model MULTI/exotic structures.
# =============================================================================

def best_effort_return(bet):
    """Return only a value justified by source settlement data.

    Fixed Win & Place is special: when its one composite payout cannot be split
    exactly between WIN/PLACE components, a winning component stays unknown. We
    must not fall back to its advertised potentialReturn because deductions can
    make that value differ from the actual settled component return.
    """
    if bet.get("betType") == "TOTE_WIN_PLACE":
        return bet.get("combinedPayout") if bet.get("combinedPayout") is not None else (0.0 if bet.get("betResult") == "LOSS" else None)
    if bet.get("payout") is not None:
        return bet.get("payout")
    if bet.get("betResult") == "LOSS":
        return 0.0
    if bet.get("pricingType") == "FIXED" and bet.get("sourceCompositeBetType") == "WIN_AND_PLACE":
        return None
    # A settled Fixed single with no payout row has only this source value available.
    if bet.get("pricingType") == "FIXED" and bet.get("betResult") == "WIN":
        return bet.get("potentialReturn")
    return None


def best_effort_stake(bet):
    if bet.get("betType") == "TOTE_WIN_PLACE":
        return bet.get("totalStake")
    return bet.get("stake")


def missing_enrichment_fields(bet):
    e = bet.get("enrichment", {})
    return enrichment_missing_fields(bet, e)


def map_to_final_bet(bet, sequence, running_pnl, running_complete):
    e = bet.get("enrichment", {})
    stake = best_effort_stake(bet)
    returned = best_effort_return(bet)
    pnl = None
    if stake is not None and returned is not None:
        pnl = round(float(returned) - float(stake), 2)
    if pnl is None:
        running_complete = False
        final_running = None
    elif running_complete:
        running_pnl = round(running_pnl + pnl, 2)
        final_running = running_pnl
    else:
        final_running = None
    result = bet.get("betResult")
    replay = e.get("replayUrl")
    required=e.get("required") is True
    missing=missing_enrichment_fields(bet)
    record = {
        "sequence": sequence,
        "betTime": bet.get("betTime"),
        "raceTime": e.get("raceTime"),
        "raceName": e.get("raceName"),
        "meeting": e.get("meeting") or bet.get("meeting"),
        "state": e.get("state"),
        "raceNumber": e.get("raceNumber") or bet.get("raceNumber"),
        "runnerNumber": e.get("runnerNumber") or bet.get("runnerNumber"),
        "runnerName": e.get("runnerName") or bet.get("runnerName"),
        "betType": bet.get("betType"),
        "stake": float(stake) if stake is not None else None,
        "odds": float(bet.get("odds")) if bet.get("odds") is not None else None,
        "result": result,
        "finishingPosition": e.get("finishingPosition"),
        "return": float(returned) if returned is not None else None,
        "profitLoss": pnl,
        "runningPnl": final_running,
        "replayUrl": replay,
        "domainClassification": bet.get("domainClassification"),
        "enrichmentStatus": e.get("status"),
        "enrichmentRequired": required,
        "enrichmentImpact": e.get("impact") or ("REQUIRED_FOR_FINALISATION" if required else "OPTIONAL"),
        "enrichmentResolutionMethod": e.get("resolutionMethod"),
        "enrichmentResolutionReason": e.get("resolutionReason"),
        "enrichmentReason": e.get("reason"),
        "missingEnrichmentFields": missing,
    }
    if e.get("raceId") not in (None, ""):
        record["raceId"] = e.get("raceId")
    if e.get("runnerId") not in (None, ""):
        record["runnerId"] = e.get("runnerId")
    return record, running_pnl, running_complete

def build_daily_bettings(enriched_payload, first_name="Customer", timezone="Australia/Melbourne"):
    """Build daily output without making incomplete financial totals look complete."""
    grouped = defaultdict(list)
    unassigned = []
    for bet in enriched_payload.get("bets", []):
        date_value = bet.get("eventDate")
        if date_value:
            grouped[str(date_value)].append(bet)
        else:
            unassigned.append(bet)

    outputs = {}
    for day, bets in grouped.items():
        bets = sorted(bets, key=lambda b: b.get("sequence") or 999999)
        final_bets = []
        running_pnl = 0.0
        running_complete = True
        for i, bet in enumerate(bets, 1):
            record, running_pnl, running_complete = map_to_final_bet(bet, i, running_pnl, running_complete)
            final_bets.append(record)

        stakes = [b["stake"] for b in final_bets if b["stake"] is not None]
        returns = [b["return"] for b in final_bets if b["return"] is not None]
        wins = [b for b in final_bets if b["result"] == "WIN"]
        losses = [b for b in final_bets if b["result"] == "LOSS"]
        known_pnl = [b for b in final_bets if b["profitLoss"] is not None]
        meetings = {b["meeting"] for b in final_bets if b.get("meeting")}

        def seq_of(items, key, reverse=False):
            items = [x for x in items if x.get(key) is not None]
            if not items:
                return None
            return sorted(items, key=lambda x: x[key], reverse=reverse)[0]["sequence"]

        biggest_win = seq_of([b for b in wins if b.get("profitLoss") is not None and b.get("profitLoss") > 0], "profitLoss", True)
        biggest_loss = seq_of([b for b in losses if b.get("profitLoss") is not None and b.get("profitLoss") < 0], "profitLoss", False)
        highest_odds = seq_of([b for b in wins if b.get("odds") is not None], "odds", True)

        outputs[day] = {
            "schemaVersion": "1.0-best-effort-v0.9",
            "user": {"firstName": first_name},
            "day": {"date": day, "timezone": timezone},
            "bets": final_bets,
            "summary": {
                "totalBets": len(final_bets),
                "totalStaked": round(sum(stakes), 2) if len(stakes) == len(final_bets) else None,
                "totalReturned": round(sum(returns), 2) if len(returns) == len(final_bets) else None,
                "wins": len(wins),
                "losses": len(losses),
                "finalPnl": round(sum(b["profitLoss"] for b in known_pnl), 2) if len(known_pnl) == len(final_bets) else None,
                "meetings": len(meetings),
                "biggestStake": max(stakes) if len(stakes) == len(final_bets) and stakes else None,
                "biggestWinSequence": biggest_win,
                "biggestLossSequence": biggest_loss,
                "highestOddsWinnerSequence": highest_odds,
                "unresolvedEnrichment": sum(1 for b in final_bets if b.get("enrichmentStatus") == "UNRESOLVED"),
                "horseBetsIncluded": len(final_bets),
                "nonHorseBetsExcluded": (
                    enriched_payload.get("domainSummary", {}).get("nonHorseBetsExcluded", 0)
                    + enriched_payload.get("domainSummary", {}).get("apiNonHorseExcluded", 0)
                ),
                "enriched": sum(1 for b in final_bets if b.get("enrichmentStatus") == "ENRICHED"),
                "enrichmentOptionalUnresolved": sum(
                    1 for b in final_bets
                    if not b.get("enrichmentRequired")
                    and b.get("enrichmentStatus") in ("PARTIAL", "UNRESOLVED")
                ),
                "requiredFinalisationUnresolved": sum(
                    1 for b in final_bets
                    if b.get("enrichmentRequired")
                    and b.get("enrichmentStatus") != "ENRICHED"
                ),
            },
        }
    return outputs, unassigned


# =============================================================================
# COMBINED LOCAL CLIENT — NORMALISE -> VALIDATE -> KUBRICK -> READY URL
# =============================================================================

DEFAULT_KUBRICK_API_URL = "https://fbhuqhy5cf.execute-api.ap-southeast-2.amazonaws.com/poc"


def _decode_json_response(response_bytes):
    text = response_bytes.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"Kubrick returned a non-JSON response: {text[:500]}")


def kubrick_post_job(payload_path, api_url, api_key, evidence_dir):
    url = api_url.rstrip("/") + "/jobs"
    body = payload_path.read_bytes()
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = response.getcode()
            payload = _decode_json_response(response.read())
    except urllib.error.HTTPError as ex:
        payload = _decode_json_response(ex.read())
        write_json(evidence_dir / "kubrick-create-response.json", payload)
        details = payload.get("details") or []
        detail_text = f" Details: {' | '.join(str(x) for x in details)}" if details else ""
        raise RuntimeError(
            f"Kubrick POST /jobs rejected the payload: HTTP {ex.code} "
            f"{payload.get('errorCode') or ''} {payload.get('message') or ''}{detail_text}".strip()
        ) from ex
    except urllib.error.URLError as ex:
        raise RuntimeError(f"Kubrick POST /jobs transport failure: {ex}") from ex

    write_json(evidence_dir / "kubrick-create-response.json", payload)
    if status != 202:
        raise RuntimeError(f"Kubrick POST /jobs returned unexpected HTTP {status}.")
    job_id = payload.get("jobId")
    if not isinstance(job_id, str) or not job_id.strip():
        raise RuntimeError("Kubrick POST /jobs returned HTTP 202 without a jobId.")
    if payload.get("status") != "RECEIVED":
        raise RuntimeError(
            f"Kubrick POST /jobs returned jobId but unexpected initial status "
            f"{payload.get('status')!r}."
        )
    return job_id


def kubrick_poll_until_terminal(job_id, api_url, api_key, evidence_dir, poll_interval):
    url = api_url.rstrip("/") + "/jobs/" + urllib.parse.quote(job_id)
    last_status = None
    poll_count = 0

    while True:
        poll_count += 1
        request = urllib.request.Request(
            url,
            headers={"x-api-key": api_key},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                http_status = response.getcode()
                payload = _decode_json_response(response.read())
        except urllib.error.HTTPError as ex:
            payload = _decode_json_response(ex.read())
            write_json(evidence_dir / "kubrick-status-response.json", payload)
            raise RuntimeError(
                f"Kubrick GET /jobs/{job_id} failed: HTTP {ex.code} "
                f"{payload.get('errorCode') or ''} {payload.get('message') or ''}".strip()
            ) from ex
        except urllib.error.URLError as ex:
            raise RuntimeError(f"Kubrick status polling transport failure: {ex}") from ex

        write_json(evidence_dir / "kubrick-status-response.json", payload)
        if http_status != 200:
            raise RuntimeError(f"Kubrick status polling returned unexpected HTTP {http_status}.")

        status = payload.get("status")
        if status != last_status:
            print(f"[KUBRICK] Status: {status}")
            last_status = status

        if status == "READY":
            recap_url = payload.get("recapUrl")
            if not isinstance(recap_url, str) or not recap_url.startswith("https://"):
                raise RuntimeError("Kubrick READY response did not contain a valid HTTPS recapUrl.")
            return payload

        if status == "FAILED":
            failure_code = payload.get("failureCode") or "KUBRICK_JOB_FAILED"
            failed_stage = payload.get("failedStage") or "UNKNOWN"
            message = payload.get("message") or "Kubrick could not complete the recap."
            raise RuntimeError(
                f"Kubrick job FAILED: {failure_code} at {failed_stage}: {message}"
            )

        if status not in ("RECEIVED", "PLANNING", "RENDERING"):
            raise RuntimeError(f"Kubrick returned unexpected job status {status!r}.")

        time.sleep(max(1, poll_interval))


def process_selected_day(
    path,
    selected_date,
    root,
    api,
    store,
    first_name,
    timezone_name,
    kubrick_api_url,
    kubrick_api_key,
    kubrick_poll_interval,
):
    jid = job_id(path)
    job_dir = root / "working" / jid
    source_dir = job_dir / "source"
    normaliser_dir = job_dir / "normaliser"
    enrichment_dir = job_dir / "enrichment"
    candidate_dir = job_dir / "candidate"
    for directory in (source_dir, normaliser_dir, enrichment_dir, candidate_dir):
        directory.mkdir(parents=True, exist_ok=True)

    source_copy = source_dir / "original.csv"
    shutil.copy2(path, source_copy)
    write_json(job_dir / "selection.json", {
        "jobId": jid,
        "sourceFile": path.name,
        "selectedDate": selected_date,
    })

    stage = "PASS_1_NORMALISE"
    try:
        print("\n[PASS 1] Parsing selected monthly statement...")
        normalised, pass1_exceptions, pass1_summary = normalise_csv(source_copy, jid, path.name)
        selected = filter_normalised_to_day(normalised, selected_date)
        write_json(normaliser_dir / "normalised-bets.json", selected)
        write_json(normaliser_dir / "exceptions.json", {"jobId": jid, "exceptions": pass1_exceptions})
        pass1_summary.update({
            "pass1Status": "COMPLETE",
            "selectedDate": selected_date,
            "selectedDayHorseBets": len(selected.get("bets", [])),
        })
        write_json(normaliser_dir / "summary.json", pass1_summary)

        if not selected.get("bets"):
            raise RuntimeError(f"No eligible horse-racing bets remained for selected date {selected_date}.")
        print(f"[PASS 1] Complete: {len(selected['bets'])} selected-day horse bet(s).")

        stage = "PASS_2_ENRICH"
        print("\n[PASS 2] Enriching historical race data...")
        enriched, pass2_exceptions, pass2_summary = enrich_normalised_payload(selected, api, store)
        write_json(enrichment_dir / "enriched-bets.json", enriched)
        write_json(enrichment_dir / "exceptions.json", {"jobId": jid, "exceptions": pass2_exceptions})
        pass2_summary.update({
            "selectedDate": selected_date,
            "dateApiCallsCumulative": api.date_calls,
            "raceApiCallsCumulative": api.race_calls,
            "apiCacheHitsCumulative": api.cache_hits,
            "apiFailureCacheHitsCumulative": api.failure_cache_hits,
            "localLookupHitsCumulative": store.hits,
            "localLookupMissesCumulative": store.misses,
            "localLookupAmbiguousCumulative": store.ambiguous,
            "localLookupWritesCumulative": store.writes,
            "localLookupErrorsCumulative": store.errors,
        })
        write_json(enrichment_dir / "summary.json", pass2_summary)
        print(
            f"[PASS 2] Complete: {pass2_summary['enriched']} enriched, "
            f"{pass2_summary['partial']} partial, {pass2_summary['unresolved']} unresolved."
        )

        stage = "KUBRICK_CANDIDATE"
        print("\n[FINALISATION] Testing source transactions against the Kubrick contract validator...")
        included_bets, quarantined = authoritative_transaction_partition(
            enriched,
            selected_date,
            first_name,
            timezone_name,
            root,
            candidate_dir,
        )

        quarantine_path = candidate_dir / "quarantined-transactions.json"
        write_json(quarantine_path, {
            "jobId": jid,
            "selectedDate": selected_date,
            "inputBetRecords": len(enriched.get("bets", [])),
            "includedBetRecords": len(included_bets),
            "quarantinedTransactionCount": len(quarantined),
            "quarantined": quarantined,
        })

        print(
            f"[FINALISATION] {len(enriched.get('bets', []))} bet record(s) processed; "
            f"{len(included_bets)} Kubrick-ready; "
            f"{len(quarantined)} transaction(s) quarantined."
        )
        for item in quarantined:
            tx = item.get("transactionNumber") or "<unknown>"
            details = item.get("details") or [item.get("message") or "validation failed"]
            print(f"  [QUARANTINED] Transaction {tx}: {details[0]}")

        if not included_bets:
            write_json(candidate_dir / "validation.json", {
                "jobId": jid,
                "selectedDate": selected_date,
                "valid": False,
                "errorCode": "NO_KUBRICK_READY_TRANSACTIONS",
                "message": "No source transaction survived authoritative Kubrick validation.",
                "quarantinedTransactionCount": len(quarantined),
            })
            print("\nNOT READY TO SEND TO KUBRICK")
            print("No valid transactions remain after quarantine.")
            print("Kubrick request not sent.")
            return False

        final_source = dict(enriched)
        final_source["bets"] = included_bets
        candidate = build_candidate_kubrick_payload(
            final_source,
            selected_date,
            first_name,
            timezone_name,
        )
        candidate_path = candidate_dir / "bettings.json"
        write_json(candidate_path, candidate)

        print("\n[VALIDATION] Running final payload through the Kubrick contract validator...")
        validation = run_kubrick_contract_validator(candidate_path, root)
        write_json(candidate_dir / "validation.json", {
            "jobId": jid,
            "selectedDate": selected_date,
            **validation,
            "inputBetRecords": len(enriched.get("bets", [])),
            "includedBetRecords": len(included_bets),
            "quarantinedTransactionCount": len(quarantined),
        })

        if validation.get("validatorError"):
            raise RuntimeError(
                f"Kubrick contract validator could not run: "
                f"{validation.get('errorCode')}: {validation.get('message')}"
            )

        if not validation.get("valid"):
            print("[VALIDATION] FINAL PAYLOAD FAILED.")
            for detail in validation.get("details") or [validation.get("message")]:
                print(f"  - {detail}")
            print(f"\nEvidence: {job_dir}")
            print("\nNOT READY TO SEND TO KUBRICK")
            print("Kubrick request not sent.")
            return False

        print("[VALIDATION] Kubrick candidate payload valid.")
        if quarantined:
            print(
                f"[VALIDATION] WARNING: recap contains {len(included_bets)} of "
                f"{len(enriched.get('bets', []))} enriched bet record(s); "
                f"{len(quarantined)} source transaction(s) were quarantined."
            )
        print("\n============================================================")
        print("CANDIDATE KUBRICK PAYLOAD")
        print("============================================================")
        print(json.dumps(candidate, indent=2, ensure_ascii=False))
        print("\n============================================================")
        print("READY TO SEND TO KUBRICK")
        print("============================================================")
        print(f"Payload saved: {candidate_path}")
        if quarantined:
            print(f"Quarantine evidence: {quarantine_path}")

        stage = "KUBRICK_POST"
        if not kubrick_api_key:
            print("\n============================================================")
            print("KUBRICK NOT SENT")
            print("============================================================")
            print("TAB_RECAP_API_KEY is not set.")
            print("Set it in CMD, then rerun the Normaliser:")
            print("  set TAB_RECAP_API_KEY=<POC API KEY>")
            return False

        print("\n[KUBRICK] POST /jobs - submitting validated canonical bettings.json...")
        kubrick_job_id = kubrick_post_job(
            candidate_path,
            kubrick_api_url,
            kubrick_api_key,
            candidate_dir,
        )
        print(f"[KUBRICK] Accepted. Job ID: {kubrick_job_id}")
        print("[KUBRICK] Polling until READY or FAILED...")

        stage = "KUBRICK_POLL"
        ready = kubrick_poll_until_terminal(
            kubrick_job_id,
            kubrick_api_url,
            kubrick_api_key,
            candidate_dir,
            kubrick_poll_interval,
        )
        recap_url = ready["recapUrl"]

        write_json(candidate_dir / "kubrick-ready.json", {
            "jobId": kubrick_job_id,
            "status": "READY",
            "recapUrl": recap_url,
        })

        print("\n============================================================")
        print("KUBRICK RECAP READY")
        print("============================================================")
        print(f"Job ID    : {kubrick_job_id}")
        print(f"Recap URL : {recap_url}")
        print("============================================================")
        return True

    except Exception as ex:
        write_json(job_dir / "job-error.json", {
            "jobId": jid,
            "sourceFile": path.name,
            "selectedDate": selected_date,
            "status": "SOURCE_PROCESSING_EXCEPTION",
            "stage": stage,
            "error": str(ex),
        })
        print("\n============================================================")
        print("NORMALISER ERROR")
        print("============================================================")
        print(f"Stage   : {stage}")
        print(f"Problem : {ex}")
        print(f"Evidence: {job_dir}")
        print("The script stopped safely.")
        return False


def main():
    parser = argparse.ArgumentParser(description="TAB Daily Recap local Normaliser client")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--base-url", default=ENRICH_BASE_URL)
    parser.add_argument("--jurisdiction", default=ENRICH_JURISDICTION)
    parser.add_argument("--timeout", type=int, default=ENRICH_TIMEOUT)
    parser.add_argument("--retries", type=int, default=ENRICH_RETRIES)
    parser.add_argument("--lookup-file", default="meeting-resolution.json")
    parser.add_argument("--first-name", default="Customer")
    parser.add_argument("--timezone", default="Australia/Melbourne")
    parser.add_argument("--kubrick-api-url", default=DEFAULT_KUBRICK_API_URL)
    parser.add_argument("--kubrick-poll-interval", type=int, default=3)
    args = parser.parse_args()

    root = args.root.resolve()
    input_dir = root / "input"
    working_dir = root / "working"
    input_dir.mkdir(parents=True, exist_ok=True)
    working_dir.mkdir(parents=True, exist_ok=True)
    files = sorted((p for p in input_dir.glob("*.csv") if p.is_file()), key=lambda p: p.name.lower())

    print("============================================================")
    print("TAB DAILY RECAP - LOCAL NORMALISER")
    print("============================================================")
    print(f"Input   : {input_dir}")
    print(f"Working : {working_dir}")

    if not files:
        print("\n[STAGE 0] No CSV files found in input\\.")
        print("Add one or more monthly TAB account-history CSV files and run the script again.")
        return 1

    print(f"\n[STAGE 0] Scanning {len(files)} input CSV file(s)...")
    days, scan_errors = scan_racing_days(files)
    if scan_errors:
        print(f"[STAGE 0] Warning: {len(scan_errors)} file(s) could not be scanned:")
        for error in scan_errors:
            print(f"  - {error['sourceFile']}: {error['error']}")

    if not days:
        print("\n[STAGE 0] No eligible horse-racing days were found.")
        print("No Kubrick request was sent.")
        return 1

    print(f"[STAGE 0] Found {len(days)} racing day(s).")
    selection = choose_racing_day(days)
    if selection is None:
        return 1

    selected_path = selection["sourceCsvPath"]
    selected_date = selection["selectedDate"]
    print("\n[STAGE 0] Selected:")
    print(f"  Date : {selection['displayDate']}")
    print(f"  Bets : {selection['eligibleHorseBetCount']}")
    print(f"  CSV  : {selected_path.name}")

    try:
        api = TabHistoricalApi(args.base_url, args.jurisdiction, args.timeout, args.retries)
        lookup_path = Path(args.lookup_file)
        if not lookup_path.is_absolute():
            lookup_path = root / lookup_path
        store = MeetingResolutionStore(lookup_path)
    except Exception as ex:
        print("\n============================================================")
        print("NORMALISER ERROR")
        print("============================================================")
        print(f"Problem : Could not initialise enrichment: {ex}")
        print("No Kubrick request was sent.")
        return 2

    ok = process_selected_day(
        selected_path,
        selected_date,
        root,
        api,
        store,
        args.first_name,
        args.timezone,
        args.kubrick_api_url,
        os.environ.get("TAB_RECAP_API_KEY", "").strip(),
        args.kubrick_poll_interval,
    )
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
