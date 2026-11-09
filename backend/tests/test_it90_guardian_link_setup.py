# Iteration 90 — /guardian/<token> gate check (temp_location NOT granted): API-level verification + setup for UI check
import os
import json
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in open("/app/frontend/.env"):
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
H = {"User-Agent": "Mozilla/5.0 it90-test", "Content-Type": "application/json"}
STATE = "/tmp/it90_guardian_state.json"


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, headers=H, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    return r.json()


def _auth(t):
    return {**H, "Authorization": f"Bearer {t}"}


def test_guardian_view_hides_location_without_temp_location():
    owner = _login("voicetest2026@example.com", "TestPass123!")
    rec = _login("fir-test-user2@example.com", "TestPass456!")
    phone = rec["user"].get("phone") or ""
    if len(phone) < 6:
        pytest.skip("recipient test user has no phone")
    inv = requests.post(f"{BASE_URL}/api/trusted-circle/invite", headers=_auth(owner["token"]), json={
        "name": "TEST_Guardian", "phone": phone,
        "permissions": {"temp_location": False}}, timeout=20)
    assert inv.status_code in (200, 201), inv.text
    link = inv.json()
    link_id = link.get("id") or link.get("link_id") or (link.get("link") or {}).get("id")
    assert link_id, link
    acc = requests.post(f"{BASE_URL}/api/trusted-circle/invitations/{link_id}/respond",
                        headers=_auth(rec["token"]), json={"action": "accept"}, timeout=20)
    assert acc.status_code == 200, acc.text
    j = requests.post(f"{BASE_URL}/api/journey/status", headers=_auth(owner["token"]), json={
        "destination": "TEST_SecretPlace", "duration_mins": 60, "recipient_link_ids": [link_id]}, timeout=20)
    assert j.status_code == 201, j.text
    tok = j.json()["token"]
    # Owner uploads a location — must still be hidden from a temp_location=False guardian
    requests.patch(f"{BASE_URL}/api/journey/status/{tok}/location", headers=_auth(owner["token"]),
                   json={"lat": 12.97, "lng": 77.59, "accuracy": 20, "area": "TEST_Area"}, timeout=20)
    g = requests.get(f"{BASE_URL}/api/journey/{tok}/guardian", headers=_auth(rec["token"]), timeout=20)
    assert g.status_code == 200, g.text
    body = g.json()
    print("ACTIVE guardian body:", json.dumps(body)[:600])
    flat = json.dumps(body)
    assert "TEST_SecretPlace" not in flat
    assert "TEST_Area" not in flat and "12.97" not in flat
    json.dump({"link_id": link_id, "token": tok, "owner": owner["token"], "rec": rec["token"],
               "rec_user": rec["user"]}, open(STATE, "w"))
