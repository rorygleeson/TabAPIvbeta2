#!/usr/bin/env python3
"""TAB CSV normaliser regression harness - deterministic Pass 1 only."""
from __future__ import annotations

import argparse, csv, hashlib, json, re, shutil, sys
from collections import Counter, defaultdict
from datetime import datetime
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

def raw_view(row): return {k:row.get(k) for k in HEADER}|{"sourceRow":row.get("_sourceRow")}
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
    return {"meeting":extract(VENUE_RE,desc),"meetingType":extract(MEETING_TYPE_RE,desc),"raceNumber":int(rr) if rr and rr.isdigit() else None,"selectionText":lines[-1] if lines else None}
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
    b.update({"stake":q2(dec(extract(STAKE_RE,d))),"odds":dec(row.get("Fixed Price Odds")) or dec(extract(PRICE_RE,d)),"potentialReturn":q2(dec(extract(RETURN_RE,d))),"payout":None})
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
        if not isinstance(selections,list) or len(selections)!=need: return bad(f"{kind} requires exactly {need} numeric selections; got {selections!r}")
        if any(not isinstance(x,int) or x<=0 for x in selections): return bad(f"{kind} selections must be positive runner numbers; got {selections!r}")
        if len(set(selections))!=need: return bad(f"{kind} selections must be unique; got {selections!r}")
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
        if pricing=="Fixed Odds" and bt in ("Win","Place"): recs=[parse_fixed(primary,bt.upper())]; vk="FIXED_SINGLE"
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
    for i,b in enumerate(bets,1):
        suffix=f":{b['component']}" if b.get("component") else ""; b["canonicalId"]=f"{b.get('transactionNumber')}{suffix}"; b["sequence"]=i
    counts=Counter(f"{b.get('pricingType')}:{b.get('betType')}" for b in bets)
    normalised={"normaliserSchemaVersion":"1.7","jobId":job_id,"source":{"fileName":source_name,"statementPeriod":period},"bets":bets}
    summary={"jobId":job_id,"sourceFile":source_name,"statementPeriod":period,"sourceTransactionRecords":len(rows),"sourceTransactionGroups":len(groups),"recognisedLogicalBetTransactions":recognised,"unsupportedLogicalBetTransactions":unsupported,"canonicalBetRecords":len(bets),"exceptionCount":len(exceptions),"ignoredRecordCounts":dict(sorted(ignored.items())),"canonicalBetTypeCounts":dict(sorted(counts.items())),"footer":footer}
    return normalised,exceptions,summary


def period_label(path):
    try:
        p,_,_=parse_csv(path)
        if p: return datetime.strptime(p.split("-")[0].strip(),"%d/%m/%Y").strftime("%Y-%m")
    except Exception: pass
    return re.sub(r"[^A-Za-z0-9]+","-",path.stem).strip("-").lower()[:24] or "job"
def job_id(path): return f"{period_label(path)}__{datetime.now():%Y%m%d-%H%M%S}-{hashlib.sha1((path.name+'|'+datetime.now().isoformat()).encode()).hexdigest()[:4]}"
def process(path,root,index,total):
    jid=job_id(path); jd=root/"working"/jid; sd=jd/"source"; nd=jd/"normaliser"; sd.mkdir(parents=True); nd.mkdir(); copy=sd/"original.csv"; shutil.copy2(path,copy)
    print(f"\n[{index}/{total}] {path.name}\n      Job ID : {jid}")
    try:
        n,e,s=normalise_csv(copy,jid,path.name); write_json(nd/"normalised-bets.json",n); write_json(nd/"exceptions.json",{"jobId":jid,"exceptions":e}); s["pass1Status"]="COMPLETE"; write_json(nd/"summary.json",s)
        print(f"      PASS 1 : {s['recognisedLogicalBetTransactions']} recognised transactions -> {s['canonicalBetRecords']} canonical records; {s['exceptionCount']} exceptions\n      Output : {jd}")
        if e: print(f"      NOTE   : inspect normaliser\\exceptions.json ({len(e)} entries)")
        return True
    except Exception as x:
        fail={"jobId":jid,"sourceFile":path.name,"status":"SOURCE_PROCESSING_EXCEPTION","error":str(x)}; write_json(nd/"exceptions.json",{"jobId":jid,"exceptions":[fail]}); write_json(nd/"summary.json",fail); print(f"      ERROR  : {x}\n      Output : {jd}"); return False

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--root",type=Path,default=Path(__file__).resolve().parent); ap.add_argument("--file"); a=ap.parse_args(); root=a.root.resolve(); inp=root/"input"; work=root/"working"; inp.mkdir(parents=True,exist_ok=True); work.mkdir(parents=True,exist_ok=True)
    files=[inp/a.file] if a.file else sorted(inp.glob("*.csv"),key=lambda p:p.name.lower()); files=[p for p in files if p.exists() and p.is_file()]
    print(f"=== TAB CSV NORMALISER — LOCAL TEST ===\nRoot       : {root}\nInput      : {inp}\nWorking    : {work}\nCSV files  : {len(files)}")
    if not files: print("\nNo CSV files found in input\\"); return 1
    ok=sum(process(p,root,i,len(files)) for i,p in enumerate(files,1)); failed=len(files)-ok
    print(f"\n=== RUN COMPLETE ===\nJobs       : {len(files)}\nSucceeded  : {ok}\nExceptions : source-level failures={failed}; per-bet exceptions remain inside each job\nWorking dir: {work}")
    return 0 if failed == 0 else 2

if __name__=="__main__": sys.exit(main())
