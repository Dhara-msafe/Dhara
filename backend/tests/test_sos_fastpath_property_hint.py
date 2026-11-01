# Iteration 68: SOS fast-path (c1_sos SSE flag), legal-pipeline non-regression, property-hint answers
import json
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}: {r.text[:200]}")
    d = r.json()
    t = d.get("token") or d.get("access_token")
    assert t
    return t


def stream(token, message, language="en", mode="basic", timeout=120):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        json={"message": message, "language": language, "mode": mode},
        headers={"Authorization": f"Bearer {token}"},
        stream=True, timeout=timeout,
    )
    assert r.status_code == 200, r.text[:300]
    events = []
    for line in r.iter_lines(decode_unicode=False):
        if not line:
            continue
        line = line.decode("utf-8")
        if line.startswith("data:"):
            try:
                events.append(json.loads(line[5:].strip()))
            except Exception:
                pass
    elapsed = time.time() - t0
    text = "".join(e.get("content", "") for e in events if e.get("type") == "delta")
    final = [e.get("content") for e in events if e.get("type") == "final" and isinstance(e.get("content"), str)]
    if final:
        text = final[-1]
    sos = any(e.get("type") == "delta" and e.get("c1_sos") is True for e in events)
    return {"events": events, "text": text, "sos": sos, "elapsed": elapsed,
            "session_id": next((e.get("session_id") for e in events if e.get("type") == "session"), None)}


# --- SOS fast-path ---
class TestSosFastPath:
    def test_help_me_fast_and_flagged(self, token):
        res = stream(token, "help me")
        print(f"help me elapsed={res['elapsed']*1000:.0f}ms")
        assert res["sos"], res["events"]
        assert "112" in res["text"]
        assert res["events"][-1].get("type") == "done"
        assert res["elapsed"] < 1.5  # network overhead through ingress; target <500ms server side

    def test_bachao_hindi_template(self, token):
        res = stream(token, "bachao", language="hi")
        print(f"bachao elapsed={res['elapsed']*1000:.0f}ms text={res['text'][:120]!r}")
        assert res["sos"]
        assert "112" in res["text"]
        assert any("\u0900" <= ch <= "\u097F" for ch in res["text"]), "expected Devanagari Hindi template"

    def test_hindi_madad_karo(self, token):
        res = stream(token, "मदद करो", language="hi")
        assert res["sos"] and "112" in res["text"]

    def test_sos_message_persisted(self, token):
        res = stream(token, "help")
        sid = res["session_id"]
        assert sid
        r = requests.get(f"{BASE_URL}/api/chat/sessions/{sid}/messages", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        if r.status_code != 200:
            pytest.skip(f"messages endpoint {r.status_code}")
        msgs = r.json() if isinstance(r.json(), list) else r.json().get("messages", [])
        roles = [m.get("role") for m in msgs]
        assert "user" in roles and "assistant" in roles
        asst = [m for m in msgs if m.get("role") == "assistant"][-1]
        assert "112" in asst.get("content", "")


# --- Legal pipeline non-regression ---
class TestLegalNotSos:
    def test_help_me_file_fir(self, token):
        res = stream(token, "help me file an FIR")
        print(f"FIR elapsed={res['elapsed']:.1f}s text={res['text'][:300]!r}")
        assert not res["sos"]
        assert "FIR" in res["text"] or "173" in res["text"] or "154" in res["text"]


# --- Property hint ---
class TestPropertyAnswers:
    @pytest.mark.parametrize("q,expect", [
        ("RERA complaint against builder for delay", ["rera", "real estate"]),
        ("land dispute with neighbour", ["property", "transfer of property", "registration", "civil", "land", "revenue", "specific relief"]),
        ("tenant eviction notice", ["tenan", "rent", "evict", "lease", "transfer of property", "106"]),
    ])
    def test_property_query(self, token, q, expect):
        res = stream(token, q)
        low = res["text"].lower()
        print(f"\nQ={q!r} elapsed={res['elapsed']:.1f}s len={len(res['text'])}\n{res['text'][:900]}")
        assert not res["sos"]
        assert any(k in low for k in expect), f"no expected keyword in: {res['text'][:400]}"
        assert "cannot confirm" not in low[:200]
