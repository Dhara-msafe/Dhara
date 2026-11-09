"""Iteration 5 backend tests — Dhara/MSafe Legal Aid.

Focus: pro-sample counter + paywall behaviour, pricing + razorpay.me config
(both read from env, so a price change is not a test failure), /auth/me fields.
"""
import json
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://dhara-shield-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

UNIQ = int(time.time() * 1000)
FRESH_EMAIL = f"TEST_pro_iter5_{UNIQ}@gandhikar.in"
FRESH_PW = "test1234"
FRESH_NAME = "Pro Iter5"
FRESH_PHONE = f"+9198770{UNIQ % 100000:05d}"


# ---------- session-scoped fresh user (samples_used=0, is_pro=False) ----------
@pytest.fixture(scope="session")
def fresh_user_token():
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": FRESH_EMAIL,
            "password": FRESH_PW,
            "name": FRESH_NAME,
            "phone": FRESH_PHONE,
            "terms_accepted": True,
            "terms_version": "1.0",
        },
        timeout=30,
    )
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    return r.json()["token"]


@pytest.fixture()
def auth_headers(fresh_user_token):
    return {"Authorization": f"Bearer {fresh_user_token}", "Content-Type": "application/json"}


def _read_sse(resp, max_seconds=120):
    events = []
    start = time.time()
    for raw in resp.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        if raw.startswith("data:"):
            try:
                events.append(json.loads(raw[5:].strip()))
            except Exception:
                pass
            if events and events[-1].get("type") in ("done", "error"):
                break
        if time.time() - start > max_seconds:
            break
    return events


def _post_chat(headers, message, mode, timeout=120):
    payload = {
        "message": message,
        "language": "en",
        "language_name": "English",
        "mode": mode,
    }
    return requests.post(f"{API}/chat/stream", json=payload, headers=headers, stream=True, timeout=timeout)


def _get_me(headers):
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Health & pricing ----------
# Price and payee are CONFIGURATION, not product behaviour: read them from the
# same env the server reads, so changing the price never breaks these tests.
PRICE_INR_LABEL = os.environ.get("PRO_PRICE_LABEL", "₹99")
PRICE_INR_PAISE = int(os.environ.get("PRO_PRICE_INR", "9900"))
PRICE_USD_LABEL = os.environ.get("PRO_PRICE_USD_LABEL", "$5")
PRICE_USD_CENTS = int(os.environ.get("PRO_PRICE_USD", "500"))
RZP_HANDLE = os.environ.get("RAZORPAY_ME_HANDLE", "calviltech")
RZP_URL = os.environ.get("RAZORPAY_ME_URL", f"https://razorpay.me/@{RZP_HANDLE}")


def test_health():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok"


def test_pricing_new_amounts_and_providers():
    r = requests.get(f"{API}/billing/pricing", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["pro_price_label"] == PRICE_INR_LABEL, j
    assert j["pro_price_usd_label"] == PRICE_USD_LABEL, j
    assert j["pro_price_inr_paise"] == PRICE_INR_PAISE
    assert j["pro_price_usd_cents"] == PRICE_USD_CENTS
    providers = j["providers"]
    assert "stripe" in providers and "razorpay" in providers
    assert providers["razorpay"]["amount_label"] == PRICE_INR_LABEL
    assert providers["razorpay"]["handle"] == RZP_HANDLE
    assert providers["razorpay"]["link_url"] == RZP_URL
    assert providers["stripe"]["amount_label"] == PRICE_USD_LABEL
    assert isinstance(j["features"], list) and len(j["features"]) >= 4


def test_razorpay_config_returns_calviltech_link():
    r = requests.get(f"{API}/billing/razorpay/config", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["handle"] == RZP_HANDLE
    assert j["link_url"] == RZP_URL
    assert j["amount_label"] == PRICE_INR_LABEL
    assert j["amount_paise"] == PRICE_INR_PAISE
    assert j["currency"] == "INR"


# ---------- /auth/me new sample fields ----------
def test_auth_me_has_sample_fields(auth_headers):
    j = _get_me(auth_headers)
    for k in ("pro_samples_used", "pro_samples_limit", "pro_samples_remaining"):
        assert k in j, f"missing key {k}"
    assert j["pro_samples_limit"] == 5
    assert j["pro_samples_used"] == 0
    assert j["pro_samples_remaining"] == 5
    assert j["is_pro"] is False


# ---------- Basic mode never decrements the counter ----------
def test_basic_mode_never_decrements_counter(auth_headers):
    for i in range(3):
        with _post_chat(auth_headers, f"What is Article {21 + i} in one short line?", mode="basic") as r:
            assert r.status_code == 200, r.text
            events = _read_sse(r, max_seconds=60)
        assert any(e.get("type") == "session" for e in events)
        session_evt = next(e for e in events if e.get("type") == "session")
        assert session_evt.get("sample_consumed") is False
        # allow the async save_assistant coroutine to finish
        time.sleep(1.5)
    j = _get_me(auth_headers)
    assert j["pro_samples_used"] == 0, f"Basic mode should NOT increment. Got {j['pro_samples_used']}"
    assert j["pro_samples_remaining"] == 5


# ---------- Pro mode for non-Pro user increments 0→5, 6th → 402 ----------
def test_pro_mode_samples_then_paywall(auth_headers):
    for i in range(5):
        before = _get_me(auth_headers)["pro_samples_used"]
        with _post_chat(auth_headers, f"Give a lawyer-style plan on step {i + 1} in 2 lines.", mode="pro") as r:
            assert r.status_code == 200, f"pro sample #{i+1} failed: {r.status_code} {r.text[:200]}"
            events = _read_sse(r, max_seconds=90)
        assert any(e.get("type") == "session" for e in events), events[:3]
        # give backend a moment to save assistant + increment
        time.sleep(2.0)
        after = _get_me(auth_headers)["pro_samples_used"]
        assert after == before + 1, f"iter {i+1}: expected {before + 1}, got {after}"

    me = _get_me(auth_headers)
    assert me["pro_samples_used"] == 5
    assert me["pro_samples_remaining"] == 0

    # 6th pro call → 402 paywall
    r = requests.post(
        f"{API}/chat/stream",
        json={"message": "one more pro please", "language": "en", "language_name": "English", "mode": "pro"},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 402, f"Expected 402 got {r.status_code}: {r.text}"
    body = r.json()
    detail = body.get("detail") or body
    assert detail.get("paywall") is True
    assert detail.get("reason") == "pro_samples_exhausted"
    assert detail.get("samples_used") == 5
    assert detail.get("samples_limit") == 5
    assert detail.get("pro_price_label") == PRICE_INR_LABEL
    assert detail.get("pro_price_usd_label") == PRICE_USD_LABEL
    assert isinstance(detail.get("message"), str) and len(detail["message"]) > 10


# ---------- Basic mode STILL works after paywall (unlimited) ----------
def test_basic_still_works_after_pro_paywall(auth_headers):
    with _post_chat(auth_headers, "Basic quick summary of RTI.", mode="basic") as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=60)
    assert any(e.get("type") == "session" for e in events)
    time.sleep(1.5)
    me = _get_me(auth_headers)
    # still 5, basic did not increment
    assert me["pro_samples_used"] == 5


# ---------- Pro user (is_pro=true) → unlimited pro, counter frozen ----------
@pytest.fixture(scope="module")
def pro_user_headers():
    """Register a fresh user then flip is_pro=True in Mongo directly."""
    email = f"TEST_actualpro_{UNIQ}@gandhikar.in"
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "test1234",
            "name": "Actual Pro",
            "phone": f"+9198761{UNIQ % 100000:05d}",
            "terms_accepted": True,
            "terms_version": "1.0",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    # Flip is_pro via mongo (server stores emails lowercased)
    import subprocess
    lc_email = email.lower()
    res = subprocess.run(
        [
            "mongosh",
            os.environ.get("DB_NAME", "gandhikar_db"),
            "--quiet",
            "--eval",
            f'JSON.stringify(db.users.updateOne({{email:"{lc_email}"}}, {{$set:{{is_pro:true, pro_since:new Date().toISOString()}}}}))',
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert '"modifiedCount":1' in res.stdout or '"matchedCount":1' in res.stdout, f"mongo update did not match: {res.stdout}"
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def test_pro_user_unlimited_no_counter(pro_user_headers):
    me = _get_me(pro_user_headers)
    assert me["is_pro"] is True
    assert me["pro_samples_used"] == 0

    for i in range(2):
        with _post_chat(pro_user_headers, f"Pro user query {i + 1} — one liner please.", mode="pro") as r:
            assert r.status_code == 200, r.text
            events = _read_sse(r, max_seconds=60)
        assert any(e.get("type") == "session" for e in events)
        session_evt = next(e for e in events if e.get("type") == "session")
        assert session_evt.get("sample_consumed") is False, "Pro user must not consume samples"
        time.sleep(1.5)

    me2 = _get_me(pro_user_headers)
    assert me2["pro_samples_used"] == 0, f"Pro user's counter should stay 0, got {me2['pro_samples_used']}"


# ---------- Sanity: existing endpoints still up ----------
def test_languages_23():
    r = requests.get(f"{API}/reference/languages", timeout=15)
    assert r.status_code == 200
    assert len(r.json()) == 23


def test_topics_8():
    r = requests.get(f"{API}/reference/topics", timeout=15)
    assert r.status_code == 200
    assert len(r.json()) == 8
