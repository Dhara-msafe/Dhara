"""Live HTTP tests: DHARA C1 conversational replies via POST /api/chat/stream.

Verifies greetings / capability questions get the deterministic C1 template
(session, delta, done) and do NOT go through the legal corpus refusal path;
deny-listed and real legal questions still go through the legal pipeline.
"""
import json
import os
import time

import pytest
import requests

from engine.conversational_intents import TEMPLATES  # noqa: E402

_url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not _url:
    # read from frontend/.env (source of truth for public URL)
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                _url = line.split("=", 1)[1].strip().strip('"')
BASE_URL = _url.rstrip("/")

EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"
REFUSAL_MARKERS = ["cannot confirm", "can't confirm", "could not confirm", "official text"]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}: {r.text[:200]}")
    data = r.json()
    return data.get("token") or data.get("access_token")


def stream(token, message, language="en", timeout=120):
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        json={"message": message, "language": language, "language_name": "English" if language == "en" else "Hindi"},
        headers={"Authorization": f"Bearer {token}"},
        stream=True,
        timeout=timeout,
    )
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    frames = []
    for raw in r.iter_lines(decode_unicode=True):
        if raw and raw.startswith("data: "):
            try:
                frames.append(json.loads(raw[6:]))
            except Exception:
                pass
    elapsed = time.time() - t0
    text = "".join(f.get("content", "") for f in frames if f.get("type") == "delta")
    final = [f.get("content", "") for f in frames if f.get("type") == "final"]
    if final:  # CITATION_GUARD_ENABLED path: buffered answer arrives in a 'final' frame
        text = final[-1]
    return frames, text, elapsed


# C1 template intents
@pytest.mark.parametrize("msg,lang,intent", [
    ("hi", "en", "greeting"),
    ("what is dhara", "en", "what_can_you_do"),
    ("thanks", "en", "thanks"),
    ("who are you", "en", "who_are_you"),
    ("नमस्ते", "hi", "greeting"),
    ("what can you do", "en", "what_can_you_do"),
])
def test_c1_template_reply(token, msg, lang, intent):
    frames, text, elapsed = stream(token, msg, lang)
    types = [f.get("type") for f in frames]
    print(f"\n[{msg}] {elapsed:.1f}s types={types} text={text[:120]!r}")
    assert text == TEMPLATES[intent][lang], f"Unexpected reply: {text!r}"
    assert not any(m in text.lower() for m in ["cannot confirm", "can't confirm"])
    assert "status" not in types, "went through LLM thinking path"
    assert types[0] == "session" and types[-1] == "done"
    assert "citation" not in types


# 'help me' is bare distress: since C1-SOS it must get ONLY the distress_sos template
# (not a greeting/capability C1 template).
def test_help_me_not_intercepted(token):
    frames, text, elapsed = stream(token, "help me")
    print(f"\n[help me] {elapsed:.1f}s types={[f.get('type') for f in frames]} text={text[:200]!r}")
    non_sos = {v for k, b in TEMPLATES.items() if k != "distress_sos" for v in b.values()}
    assert text not in non_sos
    assert text == TEMPLATES["distress_sos"]["en"]


# Real legal question still goes through legal pipeline
def test_helmet_legal_question(token):
    frames, text, elapsed = stream(token, "What is the fine for riding without a helmet?")
    types = [f.get("type") for f in frames]
    cits = [f for f in frames if f.get("type") == "citation"]
    print(f"\n[helmet] {elapsed:.1f}s types={sorted(set(types))} citations={len(cits)} text={text[:300]!r}")
    all_templates = {v for b in TEMPLATES.values() for v in b.values()}
    assert text and text not in all_templates
    assert len(cits) >= 1, "expected at least one citation for helmet question"
    assert "1000" in text or "1,000" in text or "₹" in text or "fine" in text.lower()
