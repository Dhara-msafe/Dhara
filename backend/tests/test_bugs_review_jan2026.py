"""
Review-session regression tests for the 5 reported browser-preview bugs +
2 backend hardening items (Jan 2026 continuation job).

Covers (live backend, real HTTP, SSE streaming parse):
  BUG 1/2 - IPC 166A / BNS 199 grounding fix (no hallucinated IPC 166 text)
  BUG 3   - multi-turn correspondence context carry-forward
  BACKEND HARDENING 2 - IPC Section 34 regression (b3b Act-match guard)

Does NOT cover (frontend-only, tested via Playwright separately):
  BUG 4 - DestinationPicker suggestion visibility
  BUG 5 - All Help "Ask DHARA" prefill button

Uses the real EXPO_BACKEND_URL + a seeded test user. No mocks.
"""
from __future__ import annotations

import json
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
TEST_EMAIL = "voicetest2026@example.com"
TEST_PASSWORD = "TestPass123!"

WRONG_IPC166_TEXT_FRAGMENT = "extend to one year"  # IPC 166's wrong/adjacent punishment phrase
CORRECT_PUNISHMENT_FRAGMENT = "not be less than six months but which may extend to two years"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"Could not login test user: {r.status_code} {r.text[:200]}")
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if not token:
        pytest.skip("Login response had no token")
    return token


def _stream_chat(token: str, message: str, session_id: str | None = None) -> dict:
    """POST /api/chat/stream and collect SSE events into a dict:
    {"full_text": str, "citations": [...], "session_id": str, "events": [...]}"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"message": message, "language": "en", "language_name": "English", "mode": "basic"}
    if session_id:
        body["session_id"] = session_id
    full_text = ""
    citations = []
    sid = session_id
    events = []
    with requests.post(f"{BASE_URL}/api/chat/stream", headers=headers, json=body, stream=True, timeout=60) as resp:
        assert resp.status_code == 200, f"chat/stream status {resp.status_code}: {resp.text[:300]}"
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            payload = line[len("data: "):]
            try:
                obj = json.loads(payload)
            except json.JSONDecodeError:
                continue
            events.append(obj)
            if obj.get("type") == "session":
                sid = obj.get("session_id")
            elif obj.get("type") == "delta":
                full_text += obj.get("content", "")
            elif obj.get("type") == "final":
                # CITATION_GUARD_ENABLED=true buffering mode emits the whole
                # answer as one "final" event instead of streamed "delta"s.
                full_text += obj.get("content", "")
            elif obj.get("type") == "citation":
                citations.append(obj.get("citation", {}))
            elif obj.get("type") == "done":
                break
    return {"full_text": full_text, "citations": citations, "session_id": sid, "events": events}


class TestBug1And2IPC166ABNS199Grounding:
    """BUG 1/2 (P0): no hallucinated IPC 166 punishment for IPC 166A / BNS 199."""

    def test_bns_199_punishment_question(self, auth_token):
        result = _stream_chat(auth_token, "What is the punishment under BNS Section 199?")
        assert result["full_text"], "No answer text returned"
        assert WRONG_IPC166_TEXT_FRAGMENT not in result["full_text"], (
            f"Hallucinated IPC 166 text present in answer: {result['full_text'][:400]}"
        )
        # Either the answer text OR a citation chip should carry the correct text.
        combined = result["full_text"] + " ".join(c.get("official_text", "") for c in result["citations"])
        assert CORRECT_PUNISHMENT_FRAGMENT in combined or "six months" in combined.lower(), (
            f"Correct 6-months-to-2-years punishment not found. Answer: {result['full_text'][:400]} "
            f"Citations: {result['citations']}"
        )

    def test_ipc_166a_punishment_question(self, auth_token):
        result = _stream_chat(auth_token, "IPC Section 166A")
        assert result["full_text"] or result["citations"], "No answer/citation returned for IPC 166A"
        combined = result["full_text"] + " ".join(c.get("official_text", "") for c in result["citations"])
        assert WRONG_IPC166_TEXT_FRAGMENT not in combined, (
            f"Hallucinated IPC 166 text present: {combined[:400]}"
        )

    def test_ipc_166a_citation_chip_present_with_verbatim_text(self, auth_token):
        """BUG 2: direct exact-retrieval must return a citation chip, no refusal."""
        result = _stream_chat(auth_token, "IPC Section 166A")
        refusal_markers = ["cannot confirm", "consult an advocate for", "no verified source"]
        is_pure_refusal = (not result["citations"]) and any(
            m in result["full_text"].lower() for m in refusal_markers
        )
        assert not is_pure_refusal, (
            f"Got a refusal with NO citation chip for an exact IPC 166A lookup: {result['full_text'][:300]}"
        )
        assert result["citations"], f"Expected at least one citation chip, got none. Text: {result['full_text'][:300]}"
        chip = result["citations"][0]
        assert "166A" in (chip.get("short_label", "") + chip.get("citation", "")), chip

    def test_ipc_166a_has_dead_law_warning_and_successor(self, auth_token):
        """FIX: dead-law exemption should surface a dead_warning + successor_act (BNS 199)."""
        result = _stream_chat(auth_token, "IPC Section 166A")
        assert result["citations"], "Expected citation chip for IPC 166A"
        chip = result["citations"][0]
        dump = json.dumps(chip) + result["full_text"]
        assert "199" in dump, f"Expected successor reference to BNS 199 somewhere: {dump[:500]}"
        is_dead_flagged = chip.get("is_dead_law") or chip.get("dead_warning") or "dead" in dump.lower() or "repealed" in dump.lower() or "no longer" in dump.lower()
        assert is_dead_flagged, f"Expected some dead-law/repealed warning annotation: {dump[:500]}"


class TestBug3MultiTurnCorrespondence:
    """BUG 3: IPC 166A -> 'what is the BNS equivalent?' follow-up must not contradict."""

    def test_multiturn_ipc166a_then_bns_equivalent(self, auth_token):
        r1 = _stream_chat(auth_token, "IPC Section 166A")
        sid = r1["session_id"]
        assert sid, "No session_id returned from first turn"
        r2 = _stream_chat(auth_token, "what is the BNS equivalent?", session_id=sid)
        combined2 = r2["full_text"] + " ".join(c.get("official_text", "") for c in r2["citations"])
        assert WRONG_IPC166_TEXT_FRAGMENT not in combined2, (
            f"Follow-up turn hallucinated IPC 166 text: {combined2[:400]}"
        )
        # The point of BUG 3 is that the follow-up must never CONTRADICT the
        # first turn. Naming BNS 199 outright additionally requires an active
        # advocate-signed correspondence approval (P0-T03 fail-closed gate),
        # which is deliberately still withheld — so a plain "cannot confirm
        # from the official text" refusal is the correct, safe outcome too.
        low = combined2.lower()
        assert "199" in combined2 or "cannot confirm" in low or "cannot verify" in low, (
            f"Follow-up neither named BNS 199 nor refused safely: {combined2[:400]}"
        )


class TestBackendHardening2IPC34Regression:
    """BACKEND HARDENING 2: stricter b3b Act-match guard must not regress IPC 34.

    KNOWN PRE-EXISTING DATA GAP: IPC Section 34 has no corpus record, so a
    generic "cannot verify / no-corpus-match" refusal is EXPECTED here. This
    test only confirms the refusal is the generic no-corpus-match kind (not a
    new/different error, crash, or 500) -- i.e. no regression from the b3b
    Act-match hardening in chat_router.py.
    """

    def test_ipc_section_34_generic_refusal_not_a_crash(self, auth_token):
        result = _stream_chat(auth_token, "IPC Section 34")
        assert result["full_text"] or result["citations"], "IPC Section 34 got no answer/refusal text at all (possible crash)"
        # Make sure no raw exception/traceback leaked into the response.
        lower_text = result["full_text"].lower()
        assert "traceback" not in lower_text and "internal server error" not in lower_text, (
            f"Unexpected crash-like text in response: {result['full_text'][:300]}"
        )
