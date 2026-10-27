"""Spot-check regression test: multi-turn chat about a dead law with a
successor (T04/T05 fix in api/chat_router.py / law_status_guard.py) should
still answer sensibly end-to-end via the live streaming endpoint.
Run against EXPO_BACKEND_URL (preview). Requires an existing test account.
"""
import json
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
EMAIL = "voicetest2026@example.com"
PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def token():
    if not BASE_URL:
        pytest.skip("EXPO_BACKEND_URL not set")
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text[:200]}")
    return r.json()["token"]


def _stream_chat(token, message, session_id=None):
    body = {"message": message, "language": "en", "language_name": "English"}
    if session_id:
        body["session_id"] = session_id
    r = requests.post(
        f"{BASE_URL}/api/chat/stream",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        stream=True,
        timeout=60,
    )
    assert r.status_code == 200, r.text[:300]
    full_text = ""
    new_session_id = session_id
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if payload in ("[DONE]", ""):
            continue
        try:
            evt = json.loads(payload)
        except Exception:
            continue
        if isinstance(evt, dict):
            if evt.get("session_id"):
                new_session_id = evt["session_id"]
            delta = evt.get("delta") or evt.get("content") or ""
            if isinstance(delta, str):
                full_text += delta
    return full_text, new_session_id


class TestMultiTurnSuccessor:
    def test_dead_law_then_successor_followup(self, token):
        """Ask about IPC 166A (dead law), then ask natural follow-up about BNS equivalent."""
        text1, sid = _stream_chat(token, "What is IPC Section 166A?")
        assert len(text1) > 10, f"first turn produced too little text: {text1!r}"
        text2, sid2 = _stream_chat(token, "what is the BNS equivalent?", session_id=sid)
        assert len(text2) > 10, f"follow-up produced too little text: {text2!r}"
        # Should not be a generic refusal/error for a legitimate successor question
        lowered = text2.lower()
        assert "unexpected error" not in lowered
        print("TURN1:", text1[:300])
        print("TURN2:", text2[:300])
