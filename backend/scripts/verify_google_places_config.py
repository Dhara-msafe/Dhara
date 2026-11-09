"""Google Maps/Places configuration audit — review Task 1.

Reports current feature-flag state and server key presence, then makes a
single harmless live call to each configured Google API to confirm the key
actually works (vs. just being set). Never prints key values — only
presence, length, and the API's own pass/fail/billing/quota verdict.

Usage (from /app/backend):
    python scripts/verify_google_places_config.py

Exit codes: 0 = everything configured is reachable, 1 = a configured key
failed its live check. A feature being OFF or a key being unset is reported
but is NOT a failure — this script audits what's there, it doesn't require
everything to be on.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from api.geo_router import (  # noqa: E402
    AUTOCOMPLETE_FIELD_MASK,
    DIRECTIONS_URL,
    FEATURE_GOOGLE_DIRECTIONS_V1,
    FEATURE_GOOGLE_PLACES_V1,
    GOOGLE_DIRECTIONS_SERVER_KEY,
    GOOGLE_PLACES_SERVER_KEY,
    PLACES_AUTOCOMPLETE_URL,
)


def _row(label: str, val: object) -> None:
    print(f"  {label:<32} {val}")


def _key_state(name: str, value: str) -> str:
    return f"set ({len(value)} chars)" if value else "(unset)"


async def _check_places(key: str) -> tuple[bool, str]:
    """One harmless autocomplete call — a generic query, a throwaway session token."""
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
    }
    payload = {
        "input": "Mumbai",
        "sessionToken": "verify-script-session-00000001",
        "regionCode": "IN",
        "languageCode": "en",
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post(PLACES_AUTOCOMPLETE_URL, headers=headers, json=payload)
    return _classify(resp)


async def _check_directions(key: str) -> tuple[bool, str]:
    """One harmless walking-directions call between two well-known Mumbai points."""
    params = {
        "origin": "18.9220,72.8347",       # Gateway of India
        "destination": "18.9388,72.8354",  # CSMT
        "mode": "walking",
        "key": key,
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(DIRECTIONS_URL, params=params)
    return _classify(resp)


def _classify(resp: httpx.Response) -> tuple[bool, str]:
    if resp.status_code == 200:
        data = resp.json()
        status = data.get("status")  # legacy Directions API uses this; Places (New) doesn't
        if status and status != "OK":
            return False, f"HTTP 200 but API status={status} — {data.get('error_message', '')}".strip()
        return True, "OK — key is valid and the API responded"
    if resp.status_code in (401, 403):
        return False, f"HTTP {resp.status_code} — key invalid, API not enabled, or billing not active"
    if resp.status_code == 429:
        return False, "HTTP 429 — quota exceeded"
    return False, f"HTTP {resp.status_code} — {resp.text[:200]}"


async def main() -> int:
    print("─── Feature flags ───")
    _row("FEATURE_GOOGLE_PLACES_V1", FEATURE_GOOGLE_PLACES_V1)
    _row("FEATURE_GOOGLE_DIRECTIONS_V1", FEATURE_GOOGLE_DIRECTIONS_V1)

    print("─── Server-side key presence (values never printed) ───")
    _row("GOOGLE_PLACES_SERVER_KEY", _key_state("GOOGLE_PLACES_SERVER_KEY", GOOGLE_PLACES_SERVER_KEY))
    _row("GOOGLE_DIRECTIONS_SERVER_KEY", _key_state("GOOGLE_DIRECTIONS_SERVER_KEY", GOOGLE_DIRECTIONS_SERVER_KEY))

    print("─── Client-side key presence (read from this shell's env; actual client build may differ) ───")
    for name in (
        "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
        "EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY",
        "EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY",
    ):
        _row(name, _key_state(name, os.getenv(name, "")))
    print("  (Android/iOS SDK keys can only be fully verified by an actual native build —")
    print("   see Task 6 physical-device QA. This script covers server-side keys only.)")

    failures = 0

    print("─── Live reachability checks ───")
    if GOOGLE_PLACES_SERVER_KEY:
        ok, msg = await _check_places(GOOGLE_PLACES_SERVER_KEY)
        _row("Places API (New) autocomplete", ("✅ " if ok else "❌ ") + msg)
        failures += 0 if ok else 1
    else:
        _row("Places API (New) autocomplete", "skipped — GOOGLE_PLACES_SERVER_KEY not set")

    if GOOGLE_DIRECTIONS_SERVER_KEY:
        ok, msg = await _check_directions(GOOGLE_DIRECTIONS_SERVER_KEY)
        _row("Directions API", ("✅ " if ok else "❌ ") + msg)
        failures += 0 if ok else 1
    else:
        _row("Directions API", "skipped — GOOGLE_DIRECTIONS_SERVER_KEY not set")

    print("─── Not checkable from here ───")
    print("  Billing account active, budget alerts, and per-API quota limits live in")
    print("  Google Cloud Console → Billing / APIs & Services → Quotas. A 200 OK above")
    print("  confirms billing+enablement are at least sufficient for one test call, but")
    print("  does not confirm alerts are configured — check the console directly.")

    if failures:
        print(f"─── FAIL — {failures} configured key(s) did not pass their live check ───")
    else:
        print("─── PASS — every configured server key is reachable ───")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))