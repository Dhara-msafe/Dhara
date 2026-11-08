"""Iteration 97 — admin error-events feed, issues admin endpoints, and the
Guardian public page in GUARDIAN_PUBLIC_PAGE_DETAILS mode. Runs against the
PUBLIC preview URL (frontend/.env EXPO_PUBLIC_BACKEND_URL). Cleans up only the
records it created (by id / token).
"""
import os
import re
import uuid

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

_FE = dotenv_values("/app/frontend/.env")
_BE = dotenv_values("/app/backend/.env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or _FE.get("EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_KEY = _BE.get("ADMIN_KEY")
EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"
MARK = f"TEST_it97_{uuid.uuid4().hex[:6]}"

created_reports: list = []
created_tokens: list = []


@pytest.fixture(scope="module")
def db():
    return MongoClient(_BE["MONGO_URL"])[_BE["DB_NAME"]]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module", autouse=True)
def _cleanup(db):
    yield
    for rid in created_reports:
        db.issue_reports.delete_one({"id": rid})
    for t in created_tokens:
        db.safety_journeys.delete_one({"token": t})


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


ADM = lambda: {"X-Admin-Key": ADMIN_KEY}

# ---------------- /api/admin/error-events ----------------
class TestErrorEventsFeed:
    def test_no_key_401(self):
        assert requests.get(f"{API}/admin/error-events", timeout=20).status_code == 401

    def test_wrong_key_401(self):
        r = requests.get(f"{API}/admin/error-events", headers={"X-Admin-Key": "wrong-" + uuid.uuid4().hex}, timeout=20)
        assert r.status_code == 401
        assert r.json().get("detail") == "Invalid admin key."

    def test_user_jwt_401(self, token):
        assert requests.get(f"{API}/admin/error-events", headers=H(token), timeout=20).status_code == 401

    def test_shape_and_privacy(self):
        r = requests.get(f"{API}/admin/error-events", headers=ADM(), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("items", "count", "total", "by_route", "by_error_type"):
            assert k in d
        assert d["count"] == len(d["items"]) and d["total"] >= d["count"]
        allowed = {"route", "method", "error_type", "traceback", "status_code", "created_at"}
        for it in d["items"]:
            assert set(it.keys()) <= allowed, set(it.keys()) - allowed
            assert isinstance(it["created_at"], str) and re.match(r"\d{4}-\d{2}-\d{2}T", it["created_at"])
            assert "?" not in it["route"]
            blob = (it.get("traceback") or "").lower()
            assert "bearer " not in blob and "@example.com" not in blob
        print(f"error-events total={d['total']} routes={list(d['by_route'])[:5]}")

    def test_route_and_type_filters(self, db):
        # synthetic event (own record, removed by _id) so filters + datetime serialisation are exercised
        from datetime import datetime, timezone
        ins = db.error_events.insert_one({"route": f"/api/__{MARK}__", "method": "GET", "error_type": "TEST_ValueError",
                                          "traceback": "Traceback: TEST", "status_code": 500,
                                          "created_at": datetime.now(timezone.utc)})
        try:
            self._run_filters(f"/api/__{MARK}__", "TEST_ValueError")
        finally:
            db.error_events.delete_one({"_id": ins.inserted_id})

    def _run_filters(self, route, et):
        r1 = requests.get(f"{API}/admin/error-events", params={"route": route}, headers=ADM(), timeout=30).json()
        assert r1["items"] and all(i["route"] == route for i in r1["items"])
        assert isinstance(r1["items"][0]["created_at"], str) and "T" in r1["items"][0]["created_at"]
        assert "_id" not in r1["items"][0]
        assert r1["by_route"] == {route: 1}
        r2 = requests.get(f"{API}/admin/error-events", params={"error_type": et}, headers=ADM(), timeout=30).json()
        assert r2["items"] and all(i["error_type"] == et for i in r2["items"])
        r3 = requests.get(f"{API}/admin/error-events", params={"route": "/api/__nope__"}, headers=ADM(), timeout=30).json()
        assert r3["count"] == 0 and r3["total"] == 0


# ---------------- /api/issues ----------------
class TestIssues:
    def test_post_requires_auth(self):
        r = requests.post(f"{API}/issues", json={"category": "Other", "title": "x", "description": "y"}, timeout=20)
        assert r.status_code in (401, 403)

    def test_create_list_patch_flow(self, token):
        r = requests.post(f"{API}/issues", headers=H(token), json={
            "category": "Navigation & UI", "title": f"{MARK} admin ui row",
            "description": f"{MARK} long description " + "lorem ipsum " * 30, "platform": "web"}, timeout=30)
        if r.status_code == 429:
            pytest.skip("rate limited")
        assert r.status_code == 201, r.text
        rid = r.json()["id"]; created_reports.append(rid)
        assert r.json()["status"] == "New"
        # GET (admin) contains it
        lst = requests.get(f"{API}/issues", params={"status": "New"}, headers=ADM(), timeout=30).json()
        assert any(i["id"] == rid for i in lst["items"])
        assert all(i["status"] == "New" for i in lst["items"])
        assert all("_id" not in i and "email" not in i for i in lst["items"])
        # patch → In progress, verify persisted
        p = requests.patch(f"{API}/issues/{rid}", json={"status": "In progress"}, headers=ADM(), timeout=20)
        assert p.status_code == 200 and p.json()["status"] == "In progress"
        lst2 = requests.get(f"{API}/issues", params={"status": "In progress"}, headers=ADM(), timeout=30).json()
        assert any(i["id"] == rid for i in lst2["items"])
        # invalid status
        assert requests.patch(f"{API}/issues/{rid}", json={"status": "Done"}, headers=ADM(), timeout=20).status_code == 422
        # non-admin
        assert requests.patch(f"{API}/issues/{rid}", json={"status": "Resolved"}, headers=H(token), timeout=20).status_code == 401
        # unknown id
        assert requests.patch(f"{API}/issues/nope-{uuid.uuid4()}", json={"status": "Resolved"}, headers=ADM(), timeout=20).status_code == 404

    def test_list_requires_admin(self, token):
        assert requests.get(f"{API}/issues", timeout=20).status_code == 401
        assert requests.get(f"{API}/issues", headers=H(token), timeout=20).status_code == 401

    def test_bad_status_filter_400(self):
        assert requests.get(f"{API}/issues", params={"status": "Bogus"}, headers=ADM(), timeout=20).status_code == 400


# ---------------- Guardian public page (details mode) ----------------
LOC_PATTERNS = [r"leaflet", r"tile\.openstreetmap", r"\{z\}/\{x\}", r"L\.map", r"\blat\b", r"\blng\b",
                r"28\.61", r"77\.20", r"Connaught", r"accuracy"]


def _assert_no_location(html: str):
    low = html.lower()
    for pat in LOC_PATTERNS:
        assert not re.search(pat, html, re.I), f"location leak pattern {pat!r}"
    assert "maps.google" not in low and "google.com/maps" not in low


class TestGuardianDetails:
    def test_full_journey_lifecycle(self, token):
        dest = f"{MARK} Library Gate"
        r = requests.post(f"{API}/journey/status", headers=H(token), json={"destination": dest, "duration_mins": 30}, timeout=30)
        assert r.status_code == 201, r.text
        tok = r.json()["token"]; created_tokens.append(tok)
        # push a location so we can prove it is withheld
        lr = requests.patch(f"{API}/journey/status/{tok}/location", headers=H(token),
                            json={"lat": 28.6139, "lng": 77.2090, "accuracy": 12, "area": "Connaught Place"}, timeout=20)
        print("location push:", lr.status_code)
        page = requests.get(f"{API}/journey/status/{tok}", timeout=20)
        assert page.status_code == 200
        html = page.text
        me = requests.get(f"{API}/auth/me", headers=H(token), timeout=20).json()
        first = ((me.get("user") or me).get("name") or "").split()[0] if (me.get("user") or me).get("name") else "User"
        assert first in html, "traveller name missing"
        assert dest in html, "destination missing"
        assert "Journey started" in html and "Expected check-in by" in html
        assert "Journey in progress" in html
        assert tok not in html, "token echoed in HTML"
        _assert_no_location(html)
        assert page.headers.get("Cache-Control", "").startswith("no-store")
        # mark safe
        s = requests.patch(f"{API}/journey/status/{tok}/safe", headers=H(token), timeout=20)
        assert s.status_code == 200
        html2 = requests.get(f"{API}/journey/status/{tok}", timeout=20).text
        assert "Arrived safely" in html2 and "Marked safe at" in html2
        _assert_no_location(html2)

    def test_unknown_token_neutral(self):
        r = requests.get(f"{API}/journey/status/{uuid.uuid4().hex}", timeout=20)
        assert r.status_code == 200
        assert "Link not found" in r.text
        for w in ("Traveller", "Destination", "Journey started", "Expected check-in"):
            assert w not in r.text
        _assert_no_location(r.text)
