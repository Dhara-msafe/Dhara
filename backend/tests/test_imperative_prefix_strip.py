"""Imperative-prefix stripping (query_parser.strip_imperative_prefix) — unit + live
POST /api/chat/stream tests. Ensures prefixed legal queries get legal answers and bare
distress ("help", "help me") still get the SOS reply.
"""
import json
import os
import sys
import time

import pytest
import requests

sys.path.insert(0, "/app/backend")
from engine.query_parser import strip_imperative_prefix  # noqa: E402
from engine.conversational_intents import is_bare_distress  # noqa: E402

_url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not _url:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                _url = line.split("=", 1)[1].strip().strip('"')
BASE_URL = _url.rstrip("/")

EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"
REFUSAL_MARKERS = ["cannot confirm", "can't confirm", "could not confirm", "couldn't find", "could not find"]


# ---- Unit: stripper -------------------------------------------------------
@pytest.mark.parametrize("q,expected", [
    ("help me file an FIR", "file an FIR"),
    ("please help me understand domestic violence law", "domestic violence law"),
    ("can you help me with property rights", "property rights"),
    ("i need to know about cheque bounce", "cheque bounce"),
    ("i want to understand bail conditions", "bail conditions"),
    ("can you tell me about bail conditions", "bail conditions"),
    ("My cheque bounced what do I do?", "My cheque bounced what do I do?"),
    ("What is the fine for riding without a helmet?", "What is the fine for riding without a helmet?"),
    ("help me", "help me"),
    ("help", "help"),
])
def test_strip_unit(q, expected):
    assert strip_imperative_prefix(q) == expected


def test_distress_gate_unit():
    assert is_bare_distress("help")
    assert is_bare_distress("help me")
    assert not is_bare_distress("help me file an FIR")


# ---- Live stream --------------------------------------------------------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}: {r.text[:200]}")
    d = r.json()
    return d.get("token") or d.get("access_token")


def stream(token, message, timeout=150):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        json={"message": message, "language": "en", "language_name": "English"},
        headers={"Authorization": f"Bearer {token}"}, stream=True, timeout=timeout,
    )
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    frames = []
    for raw in r.iter_lines(decode_unicode=True):
        if raw and raw.startswith("data: "):
            try:
                frames.append(json.loads(raw[6:]))
            except Exception:
                pass
    text = "".join(f.get("content", "") for f in frames if f.get("type") == "delta")
    final = [f.get("content", "") for f in frames if f.get("type") == "final"]
    if final:
        text = final[-1]
    return frames, text, time.time() - t0


LEGAL_CASES = [
    ("help me file an FIR", ["fir", "police", "complaint"]),
    ("please help me understand domestic violence law", ["pwdva", "domestic violence", "protection of women"]),
    ("can you help me with property rights", ["property"]),
    ("i need to know about cheque bounce", ["138", "cheque", "negotiable instruments"]),
    ("i want to understand bail conditions", ["bail"]),
    ("My cheque bounced what do I do?", ["138", "cheque"]),
    ("What is the fine for riding without a helmet?", ["helmet", "129", "194d", "motor vehicles"]),
]


@pytest.mark.parametrize("msg,keywords", LEGAL_CASES)
def test_legal_answer(token, msg, keywords):
    frames, text, el = stream(token, msg)
    low = text.lower()
    types = [f.get("type") for f in frames]
    print(f"\n[{msg}] {el:.1f}s len={len(text)} types={sorted(set(types))}\n{text[:700]!r}")
    assert text.strip(), "empty answer"
    assert "you're not alone" not in low, "got distress SOS reply"
    assert not any(m in low for m in REFUSAL_MARKERS), "got refusal"
    assert any(k in low for k in keywords), f"missing keywords {keywords}"


@pytest.mark.parametrize("msg", ["help me", "help"])
def test_bare_distress_sos(token, msg):
    frames, text, el = stream(token, msg)
    print(f"\n[{msg}] {el:.1f}s {text[:300]!r}")
    assert "112" in text and "1091" in text
