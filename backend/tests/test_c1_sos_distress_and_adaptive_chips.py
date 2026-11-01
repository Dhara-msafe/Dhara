"""DHARA C1-SOS distress reply + Phase 3 adaptive follow-up chips (iteration 66).

Covers:
- Bare distress phrases ("help", "help me", "bachao", "मदद करो", "உதவி") -> SOS reply w/ emergency numbers
- Legal-context "help me ..." messages -> NOT the SOS reply (legal pipeline)
- /api/chat/followup returns exactly 3 legal chips for legal turns, [] for C1 / distress
- Guest counter is not consumed by bare distress turns
"""
import json
import os
import re
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    # read the public URL from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("EXPO_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"
SOS_NUMBERS = ["112", "100", "1091", "181", "1930"]


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api_client):
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}: {r.text[:200]}")
    d = r.json()
    return d.get("token") or d.get("access_token")


def _events(resp):
    out = []
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            try:
                out.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return out


def _ask(api_client, tok, message, language="en", language_name="English"):
    r = api_client.post(
        f"{BASE_URL}/api/chat/stream",
        headers={"Authorization": f"Bearer {tok}"},
        json={"message": message, "language": language, "language_name": language_name,
              "mode": "basic", "session_id": str(uuid.uuid4())},
        stream=True, timeout=120,
    )
    assert r.status_code == 200, r.text[:300]
    ev = _events(r)
    # C1/SOS replies stream as "delta"; legal pipeline answers arrive as "final"
    text = "".join(e.get("content", "") for e in ev if e.get("type") in ("delta", "final"))
    return ev, text


def _is_sos(text):
    return all(n in text for n in SOS_NUMBERS) and ("not alone" in text or "अकेले नहीं" in text or "தனியாக இல்லை" in text)


# ---------- SOS distress reply ----------
class TestDistressSOS:
    @pytest.mark.parametrize("msg", ["help", "help me", "bachao", "Help!!", "please help"])
    def test_bare_distress_en(self, api_client, token, msg):
        ev, text = _ask(api_client, token, msg)
        assert _is_sos(text), f"{msg!r} -> not SOS reply: {text[:300]}"
        assert "You're not alone" in text
        assert any(e.get("type") == "done" for e in ev)

    def test_hindi_madad_karo(self, api_client, token):
        ev, text = _ask(api_client, token, "मदद करो", "hi", "Hindi")
        assert "आप अकेले नहीं हैं" in text, text[:300]
        assert "महिला हेल्पलाइन" in text
        for n in SOS_NUMBERS:
            assert n in text

    def test_tamil_udhavi(self, api_client, token):
        ev, text = _ask(api_client, token, "உதவி", "ta", "Tamil")
        assert "தனியாக இல்லை" in text, text[:300]
        for n in SOS_NUMBERS:
            assert n in text

    def test_marathi_sos_template_script(self, api_client, token):
        """Marathi SOS reply must be in Devanagari - no Arabic/Urdu characters."""
        ev, text = _ask(api_client, token, "मदत करा", "mr", "Marathi")
        assert "1091" in text, text[:300]
        assert not re.search(r"[\u0600-\u06FF]", text), f"Arabic script in Marathi SOS reply: {text.splitlines()[0]!r}"

    @pytest.mark.parametrize("msg", ["help me file an FIR", "help me understand domestic violence law"])
    def test_legal_context_not_sos(self, api_client, token, msg):
        ev, text = _ask(api_client, token, msg)
        assert len(text) > 0, f"empty response for {msg!r}"
        assert "not alone" not in text, f"{msg!r} got SOS reply: {text[:300]}"
        assert not _is_sos(text)


# ---------- Adaptive chips ----------
class TestFollowupChips:
    def _followup(self, api_client, tok, message, answer):
        r = api_client.post(
            f"{BASE_URL}/api/chat/followup",
            headers={"Authorization": f"Bearer {tok}"},
            json={"message": message, "answer": answer, "language": "en", "language_name": "English"},
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]
        return r.json().get("questions")

    def test_cheque_bounce_three_legal_chips(self, api_client, token):
        q = self._followup(
            api_client, token,
            "My cheque bounced, what can I do?",
            "Under Section 138 of the Negotiable Instruments Act, 1881, dishonour of a cheque for insufficient funds "
            "is an offence. You must send a legal demand notice within 30 days of receiving the bank's return memo. "
            "If the drawer fails to pay within 15 days, you can file a complaint before the Magistrate within 30 days.",
        )
        print("cheque chips:", q)
        assert isinstance(q, list) and len(q) == 3, q
        for c in q:
            assert isinstance(c, str) and c.strip()
            assert len(c.split()) <= 12, f"chip too long: {c}"
            low = c.lower()
            assert not any(m in low for m in ["dhara", "this app", "can you", "what can you do"]), f"meta chip: {c}"

    def test_greeting_no_chips(self, api_client, token):
        q = self._followup(api_client, token, "hi",
                           "Hello! I'm Dhara, your legal assistant. How can I help you today with Indian law?")
        assert q == [], q

    def test_distress_no_chips(self, api_client, token):
        q = self._followup(api_client, token, "help",
                           "You're not alone. If you're in immediate danger, call now: 112 Emergency, 1091 Women's helpline")
        assert q == [], q


# ---------- Guest counter ----------
class TestGuestCounterDistress:
    def test_bare_distress_does_not_consume_guest_question(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"}, timeout=30)
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        ev, text = _ask(api_client, tok, "help me")
        sess = next(e for e in ev if e.get("type") == "session")
        assert sess.get("guest") is True
        assert sess.get("guest_question_count") == 0, sess
        assert _is_sos(text), text[:200]
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=30).json()
        assert me["guest_question_count"] == 0, me.get("guest_question_count")

    def test_legal_help_consumes_guest_question(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"}, timeout=30)
        tok = r.json()["token"]
        ev, text = _ask(api_client, tok, "help me file an FIR")
        sess = next(e for e in ev if e.get("type") == "session")
        assert sess.get("guest_question_count") == 1, sess


# ---------- Template script integrity (unit) ----------
class TestSOSTemplateScripts:
    EXPECTED = {"hi": "DEVANAGARI", "mr": "DEVANAGARI", "ta": "TAMIL", "te": "TELUGU", "bn": "BENGALI",
                "gu": "GUJARATI", "kn": "KANNADA", "ml": "MALAYALAM", "pa": "GURMUKHI"}

    @pytest.mark.parametrize("lang", list(EXPECTED))
    def test_template_single_script(self, lang):
        import sys, unicodedata
        sys.path.insert(0, "/app/backend")
        from engine.conversational_intents import TEMPLATES
        tpl = TEMPLATES["distress_sos"][lang]
        exp = self.EXPECTED[lang]
        bad = [f"{c}(U+{ord(c):04X} {unicodedata.name(c, '?')})" for c in tpl
               if 0x0600 <= ord(c) < 0x2000 and ord(c) not in (0x0964, 0x0965)
               and not unicodedata.name(c, "?").startswith(exp)]
        assert not bad, f"{lang} SOS template has foreign-script chars: {bad[:5]}"
        for n in SOS_NUMBERS:
            assert n in tpl
