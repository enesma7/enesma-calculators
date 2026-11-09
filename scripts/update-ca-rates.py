#!/usr/bin/env python3
"""Write data/ca-rates.json with current 30-year fixed averages.

Primary source, unauthenticated: Zillow's public mortgage rate API.
  GET https://mortgageapi.zillow.com/getRates
  partnerId is the public id that API requires. It is not a secret.
  Each query is a California purchase, 30-year fixed, conforming amount.
  The echoed query must say stateAbbreviation=CA. A 0.0 rate means that
  cohort has no quoted volume and is rejected.

  Cohorts (the ones Zillow actually publishes a California average for):
    conventional — LTV Normal (under 80%), credit VeryHigh (740+)
    fha          — LTV VeryHigh (95%+), credit High (680–739)
    va           — LTV VeryHigh (95%+), credit High (680–739)

Fallback, only when this file does not already exist: Freddie Mac Primary
Mortgage Market Survey, national 30-year fixed. FHA and VA stay null.
https://www.freddiemac.com/pmms/docs/PMMS_history.csv

If a fetch fails and a previous file is present, that file is left as-is.
Rates are never filled in by hand.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("CA_RATES_OUT", ROOT / "data" / "ca-rates.json"))
PARTNER = os.environ.get("ZILLOW_PARTNER_ID", "RD-CZMBMCZ")
ZILLOW = "https://mortgageapi.zillow.com/getRates"
PMMS = "https://www.freddiemac.com/pmms/docs/PMMS_history.csv"
UA = "ENESMA-rates/1.0 (+https://calculators.enesmarealty.com)"

COHORTS = {
    "conventional": {
        "stateAbbreviation": "CA",
        "program": "Fixed30Year",
        "loanType": "Conventional",
        "loanAmountBucket": "Conforming",
        "loanToValueBucket": "Normal",
        "creditScoreBucket": "VeryHigh",
        "refinance": "false",
    },
    "fha": {
        "stateAbbreviation": "CA",
        "program": "Fixed30Year",
        "loanType": "FHA",
        "loanAmountBucket": "Conforming",
        "loanToValueBucket": "VeryHigh",
        "creditScoreBucket": "High",
        "refinance": "false",
    },
    "va": {
        "stateAbbreviation": "CA",
        "program": "Fixed30Year",
        "loanType": "VA",
        "loanAmountBucket": "Conforming",
        "loanToValueBucket": "VeryHigh",
        "creditScoreBucket": "High",
        "refinance": "false",
    },
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/csv"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def round_rate(value: float) -> float:
    return round(float(value) + 1e-9, 3)


def valid_rate(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 1 < float(value) < 15


def zillow_rates() -> dict | None:
    params = {"partnerId": PARTNER, "includeCurrentRate": "true", "durationDays": "1"}
    for key, query in COHORTS.items():
        for field, value in query.items():
            params[f"queries.{key}.{field}"] = value
    url = ZILLOW + "?" + urllib.parse.urlencode(params)
    payload = json.loads(fetch(url).decode("utf-8"))
    rates = payload.get("rates") or {}
    found = {}
    dates = []
    for key, expect in COHORTS.items():
        block = rates.get(key) or {}
        query = block.get("query") or {}
        if query.get("stateAbbreviation") != "CA":
            print(f"Zillow {key}: response was not California ({query.get('stateAbbreviation')!r})", file=sys.stderr)
            return None
        if query.get("loanType") != expect["loanType"] or query.get("program") != "Fixed30Year":
            print(f"Zillow {key}: unexpected cohort {query}", file=sys.stderr)
            return None
        current = block.get("currentRate") or {}
        rate = current.get("rate")
        if not valid_rate(rate):
            print(f"Zillow {key}: no usable rate ({rate!r})", file=sys.stderr)
            return None
        found[key] = round_rate(rate)
        stamp = current.get("time")
        if isinstance(stamp, str) and stamp:
            dates.append(datetime.fromisoformat(stamp).date().isoformat())
    if not dates:
        print("Zillow response had no rate timestamp", file=sys.stderr)
        return None
    return {
        "conventional": found["conventional"],
        "fha": found["fha"],
        "va": found["va"],
        "asOf": max(dates),
        "source": "Zillow",
    }


def pmms_conventional() -> dict | None:
    text = fetch(PMMS).decode("utf-8", errors="replace")
    latest = None
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2 or not parts[1]:
            continue
        try:
            when = datetime.strptime(parts[0], "%m/%d/%Y").date().isoformat()
            rate = float(parts[1])
        except ValueError:
            continue
        if valid_rate(rate):
            latest = (when, round_rate(rate))
    if not latest:
        print("Freddie Mac PMMS CSV had no 30-year rate", file=sys.stderr)
        return None
    return {
        "conventional": latest[1],
        "fha": None,
        "va": None,
        "asOf": latest[0],
        "source": "Freddie Mac PMMS (national 30-year fixed)",
    }


def write(payload: dict) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}: {json.dumps(payload)}")


def main() -> int:
    try:
        payload = zillow_rates()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError) as exc:
        print(f"Zillow fetch failed: {exc}", file=sys.stderr)
        payload = None
    if payload:
        write(payload)
        return 0
    if OUT.is_file():
        print(f"Keeping last good file at {OUT}", file=sys.stderr)
        return 0
    try:
        fallback = pmms_conventional()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"Freddie Mac PMMS fetch failed: {exc}", file=sys.stderr)
        fallback = None
    if not fallback:
        print("No rate source succeeded and no previous file exists.", file=sys.stderr)
        return 1
    write(fallback)
    return 0


if __name__ == "__main__":
    sys.exit(main())
