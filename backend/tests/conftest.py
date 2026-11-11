"""Test-suite environment guard — keeps the suite from failing for non-product reasons.

Most test modules resolve their target host at import time with
`os.environ.get("EXPO_PUBLIC_BACKEND_URL", <default>)`. That default only
applies when the variable is MISSING, so a variable that exists but is blank
(a forked shell, a CI job that exports it empty, or the classic
`export A=url B=$A` where `$A` is not set yet) leaves the base URL as "" and
every request goes to "/api/..." — not a URL at all. Dozens of tests then error
with `MissingSchema`, which looks like a product failure and is not one.

This conftest normalises those variables ONCE, before any test module is
imported, so no individual test file has to be touched.

Order of preference:
  1. a non-blank value already in the environment (explicit wins),
  2. the preview host the app itself is configured with (frontend/.env),
  3. the backend directly on localhost.
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from dotenv import dotenv_values, load_dotenv
from pymongo import MongoClient

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_FRONTEND_ENV = _BACKEND_DIR.parent / "frontend" / ".env"

load_dotenv(_BACKEND_DIR / ".env")

_HOST_VARS = ("EXPO_BACKEND_URL", "EXPO_PUBLIC_BACKEND_URL")


def _configured_host() -> str:
    """The host the app itself talks to, or the local backend as a last resort."""
    if _FRONTEND_ENV.exists():
        values = dotenv_values(_FRONTEND_ENV)
        host = (values.get("EXPO_PUBLIC_BACKEND_URL") or "").strip().strip('"')
        if host:
            return host.rstrip("/")
    return "http://localhost:8001"


_RESOLVED = _configured_host()

for _var in _HOST_VARS:
    if not (os.environ.get(_var) or "").strip():
        os.environ[_var] = _RESOLVED


@pytest.fixture(scope="session", autouse=True)
def _ensure_notetaker_advocate_verified():
    """Mark the shared QA advocate profile as verified before the suite runs.

    BATCH N1 (2026-11) blocks AI drafting, note approval and export for
    advocates whose Bar Council profile is not yet verified.
    voicetest2026@example.com is the shared QA account used across the
    notetaker test suites (test_notetaker_phase1.py, test_notetaker_tasks.py)
    to exercise the real happy-path flow, so it must be a *verified*
    advocate. The unverified-advocate-blocked path has its own dedicated
    throwaway user in test_notetaker_phase1.py::TestUnverifiedAdvocateGating.
    """
    try:
        client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
        db = client[os.environ.get("DB_NAME", "")]
        user = db.users.find_one({"email": "voicetest2026@example.com"})
        if user:
            db.advocate_profiles.update_one(
                {"user_id": user["id"]},
                {"$set": {"verified": True}},
            )
        client.close()
    except Exception:
        pass
    yield


@pytest.fixture(scope="session", autouse=True)
def _reset_daily_quota_counters():
    """Clear today's usage counters before the suite runs.

    Two product rate limits are hit by the suite itself, not by any bug:
      * `/auth/guest` allows 15 guest sessions per IP per day and the suite
        starts 13+ from one IP;
      * the free tier allows 200 questions per user per day and the suite sends
        roughly 250 chat requests through ONE shared QA account.
    So the second run of any day failed en masse with 429s. These rows are pure
    rate-limit bookkeeping (scope/day/user_id|ip/count) and contain no user
    content, so clearing today's rows in the QA database is safe.
    """
    try:
        client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
        db = client[os.environ.get("DB_NAME", "")]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        db.usage_daily.delete_many({"day": today})
        db.usage_daily.delete_many({"scope": "guest_ip"})
        client.close()
    except Exception:
        pass
    yield
