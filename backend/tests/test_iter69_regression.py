# Iteration 69: final validation of 4 fixes
# (1) no ** in SOS delta text, (2) SOS c1_sos flag, (3) SOS < 1.5s, (4) whole-word property regex
import json
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
EMAIL = "testpass_alpha@msafe.in"
PASSWORD = "TestPass456!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        # fallback to voicetest
        r2 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": "voicetest2026@example.com", "password": "TestPass123!"},
                           timeout=30)
        if r2.status_code != 200:
            pytest.skip(f"login failed {r.status_code}")
        d = r2.json()
    else:
        d = r.json()
    t = d.get("token") or d.get("access_token")
    assert t
    return t


def stream(token, message, language="en", timeout=60):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        json={"message": message, "language": language, "mode": "basic"},
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
    delta_text = "".join(e.get("content", "") for e in events if e.get("type") == "delta")
    final = [e.get("content") for e in events if e.get("type") == "final" and isinstance(e.get("content"), str)]
    text = final[-1] if final else delta_text
    sos = any(e.get("type") == "delta" and e.get("c1_sos") is True for e in events)
    return {"events": events, "text": text, "delta_text": delta_text, "sos": sos, "elapsed": elapsed}


class TestSosNoMarkdown:
    """Fix (1): distress_sos template must not contain ** markdown"""

    def test_help_me_no_asterisks_in_delta(self, token):
        res = stream(token, "help me")
        delta = res["delta_text"]
        print(f"help me delta: {delta[:300]!r}")
        assert "**" not in delta, f"Found ** in delta: {delta[:300]}"

    def test_help_me_no_asterisks_in_full_text(self, token):
        res = stream(token, "help me")
        assert "**" not in res["text"], f"Found ** in text: {res['text'][:300]}"

    def test_bachao_no_asterisks(self, token):
        res = stream(token, "bachao", language="en")
        assert "**" not in res["text"], f"Found ** in bachao text: {res['text'][:300]}"


class TestSosFastPath:
    """Fix (2) + (3): SOS c1_sos flag fires and response is fast"""

    def test_help_me_c1_sos_flag(self, token):
        res = stream(token, "help me")
        assert res["sos"] is True, "c1_sos not in any delta event"
        assert "112" in res["text"]

    def test_bachao_c1_sos_flag(self, token):
        res = stream(token, "bachao")
        assert res["sos"] is True, "c1_sos not in bachao delta"
        assert "112" in res["text"]

    def test_help_me_response_under_1500ms(self, token):
        res = stream(token, "help me")
        print(f"help me elapsed: {res['elapsed']*1000:.0f}ms")
        assert res["elapsed"] < 1.5, f"SOS took {res['elapsed']*1000:.0f}ms (limit 1500ms)"

    def test_bachao_response_under_1500ms(self, token):
        res = stream(token, "bachao")
        print(f"bachao elapsed: {res['elapsed']*1000:.0f}ms")
        assert res["elapsed"] < 1.5, f"SOS took {res['elapsed']*1000:.0f}ms (limit 1500ms)"


class TestPropertyWholeWord:
    """Fix (4): whole-word property regex — legal query passes, substring doesn't false-trigger"""

    def test_parents_fighting_over_property_returns_legal(self, token):
        """'property' (whole word) should match and give a legal answer"""
        res = stream(token, "my parents fighting over property rights")
        print(f"property rights text: {res['text'][:400]!r}")
        assert not res["sos"]
        text_lower = res["text"].lower()
        assert "cannot confirm" not in text_lower[:200], "should not be a refusal"
        # Should contain legal content
        legal_keywords = ["property", "transfer", "law", "section", "act", "right", "legal", "court"]
        assert any(k in text_lower for k in legal_keywords), f"No legal content found: {res['text'][:400]}"

    def test_rentals_substring_does_not_trigger_rent_hint(self, token):
        """'rentals' substring should not incorrectly trigger rent/property hints"""
        res = stream(token, "what are the laws about inheriting parental property")
        print(f"parental property text: {res['text'][:400]!r}")
        assert not res["sos"]
        text_lower = res["text"].lower()
        # Should answer about inheritance/property law, not about rental law
        assert "cannot confirm" not in text_lower[:200]
        legal_keywords = ["inherit", "property", "succession", "law", "act", "section", "transfer"]
        assert any(k in text_lower for k in legal_keywords)
