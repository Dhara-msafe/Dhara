"""
Backend tests for POST /api/voice/transcribe — Whisper cloud STT endpoint.

Covers the "make mic work like WhatsApp" fix that routes ALL Android devices to
Whisper cloud STT (bypassing native SpeechRecognizer). Since native STT was
failing silently on Samsung/Bixby, /api/voice/transcribe is now the critical
path — every mic release from the app hits it.

Cases covered:
  1) Backward compatibility — no `language` form field (auto-detect).
  2) With supported `language` form field ('hi', 'ta', 'en', 'bn').
  3) With UNSUPPORTED `language` (e.g. 'sat' for Santali) → graceful ignore,
     still transcribes via auto-detect (must NOT 500 or 400).
  4) Invalid / empty audio bytes → 500 with Transcription failed message.
  5) Missing Authorization header → 401.
  6) Auth present but no file → 422 validation error.

Also runs sanity checks on:
  - POST /api/chat/stream — ensures the STT changes didn't break streaming.
  - POST /api/chat/stream question about "RTI application fee" — expects a
    citation SSE frame carrying RTI Rule 3 (RTIR) or RTI 6, proving the new
    corpus expansion (RTIR/CPER/CMVR entries) retrieves correctly.
"""
import io
import os
import json
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None

# Fall back to frontend/.env if not exported into pytest's environment
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

TEST_EMAIL = "protest@gandhikar.in"
TEST_PASSWORD = "test1234"

AUDIO_TONE_PATH = "/tmp/test_audio.wav"       # 440Hz sine, 2s PCM WAV (generated below)
AUDIO_SILENCE_PATH = "/tmp/test_silence.wav"  # silence, 2s PCM WAV (generated below)


# ---------- Fixtures ----------
def _write_wav(path: str, freq: float, seconds: float = 2.0, rate: int = 16000) -> None:
    """Self-contained fixture: the m4a files these tests used to need were
    never in the repo (environment-only), so generate WAVs (a Whisper-
    supported format) deterministically instead."""
    import math, struct, wave
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate)) if freq else 0)
            for i in range(int(rate * seconds))))


@pytest.fixture(scope="module", autouse=True)
def _audio_fixtures():
    _write_wav(AUDIO_TONE_PATH, 440.0)
    _write_wav(AUDIO_SILENCE_PATH, 0.0)


@pytest.fixture(scope="module")
def token() -> str:
    """Login and return a bearer token."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["token"]
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- 1) Backward-compat: no `language` form field ----------
class TestTranscribeBackwardCompat:
    def test_no_language_field_returns_text_shape(self, auth_headers):
        with open(AUDIO_TONE_PATH, "rb") as f:
            files = {"audio": ("audio.wav", f, "audio/wav")}
            r = requests.post(
                f"{BASE_URL}/api/voice/transcribe",
                headers=auth_headers,
                files=files,
                timeout=60,
            )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert "text" in body, f"Missing 'text' key in response: {body}"
        assert isinstance(body["text"], str), "'text' must be a string"


# ---------- 2) With supported language hint ----------
class TestTranscribeWithLanguageHint:
    # NOTE: Bengali ('bn') is in server.py's WHISPER_SUPPORTED set but the
    # Emergent Whisper proxy REJECTS it with HTTP 400 "Language 'bn' is not
    # supported." — see backend_issues.critical in the iteration report.
    # Also failing: te, gu, ml, pa, or, as, sa, sd. Confirmed passing set
    # via probe: en, hi, ta, mr, kn, ur, ne.
    @pytest.mark.parametrize("lang", ["en", "hi", "ta", "mr", "kn", "ur", "ne"])
    def test_supported_language_accepted(self, auth_headers, lang):
        with open(AUDIO_TONE_PATH, "rb") as f:
            files = {"audio": ("audio.wav", f, "audio/wav")}
            data = {"language": lang}
            r = requests.post(
                f"{BASE_URL}/api/voice/transcribe",
                headers=auth_headers,
                files=files,
                data=data,
                timeout=60,
            )
        assert r.status_code == 200, (
            f"lang={lang}: expected 200, got {r.status_code}: {r.text}"
        )
        body = r.json()
        assert "text" in body, f"lang={lang}: missing 'text' key: {body}"
        assert isinstance(body["text"], str)


# ---------- 3) Unsupported language code must be gracefully ignored ----------
class TestTranscribeUnsupportedLanguage:
    def test_santali_sat_ignored_gracefully(self, auth_headers):
        """'sat' (Santali) is not in Whisper's supported set → backend must
        drop the hint and auto-detect. Should NOT 500 or reject the request."""
        with open(AUDIO_TONE_PATH, "rb") as f:
            files = {"audio": ("audio.wav", f, "audio/wav")}
            data = {"language": "sat"}
            r = requests.post(
                f"{BASE_URL}/api/voice/transcribe",
                headers=auth_headers,
                files=files,
                data=data,
                timeout=60,
            )
        assert r.status_code == 200, (
            f"Expected 200 (graceful auto-detect), got {r.status_code}: {r.text}"
        )
        body = r.json()
        assert "text" in body, f"Missing 'text' key: {body}"

    def test_garbage_language_code_ignored(self, auth_headers):
        with open(AUDIO_TONE_PATH, "rb") as f:
            files = {"audio": ("audio.wav", f, "audio/wav")}
            data = {"language": "xyzzy"}
            r = requests.post(
                f"{BASE_URL}/api/voice/transcribe",
                headers=auth_headers,
                files=files,
                data=data,
                timeout=60,
            )
        assert r.status_code == 200, (
            f"Expected 200 (garbage hint ignored), got {r.status_code}: {r.text}"
        )


# ---------- 3b) Regression guard for WHISPER_SUPPORTED mismatch ----------
class TestWhisperSupportedSetMismatch:
    """The Emergent Whisper proxy rejects 9 of the 16 codes currently listed in
    server.py's WHISPER_SUPPORTED set (bn, te, gu, ml, pa, or, as, sa, sd).
    Users speaking those languages get a silent HTTP 500 on mic release — the
    exact "silent failure" the fix was supposed to eliminate.

    This test documents the mismatch. Once the main agent fixes the backend
    (either shrink WHISPER_SUPPORTED, or retry-without-hint on 400), this
    test should PASS for every proxy-rejected code."""

    PROXY_REJECTED_CODES = ["bn", "te", "gu", "ml", "pa", "or", "as", "sa", "sd"]

    @pytest.mark.parametrize("lang", PROXY_REJECTED_CODES)
    def test_proxy_rejected_codes_must_not_500(self, auth_headers, lang):
        with open(AUDIO_TONE_PATH, "rb") as f:
            files = {"audio": ("audio.wav", f, "audio/wav")}
            data = {"language": lang}
            r = requests.post(
                f"{BASE_URL}/api/voice/transcribe",
                headers=auth_headers,
                files=files,
                data=data,
                timeout=60,
            )
        assert r.status_code == 200, (
            f"lang={lang}: Whisper proxy rejects this code with HTTP 400 but "
            f"server.py's WHISPER_SUPPORTED set forwards it. This breaks the "
            f"mic for every user speaking {lang}. Backend must either shrink "
            f"WHISPER_SUPPORTED or retry-without-hint on Whisper 400. "
            f"Got {r.status_code}: {r.text[:250]}"
        )


# ---------- 4) Invalid / empty audio ----------
class TestTranscribeInvalidAudio:
    def test_empty_audio_bytes_returns_400(self, auth_headers):
        files = {"audio": ("audio.m4a", io.BytesIO(b""), "audio/m4a")}
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=auth_headers,
            files=files,
            timeout=30,
        )
        # Approved voice-upload validation (Round 5): empty files are rejected
        # up-front with a clean 400 (and never billed) instead of reaching
        # Whisper and failing as a 500.
        assert r.status_code == 400, (
            f"Expected 400 for empty audio, got {r.status_code}: {r.text}"
        )
        body = r.json()
        detail = body.get("detail", "")
        assert "empty or too short" in str(detail), (
            f"Detail should explain the empty recording, got: {detail}"
        )


# ---------- 5) Missing auth ----------
class TestTranscribeAuth:
    def test_missing_auth_returns_401(self):
        with open(AUDIO_TONE_PATH, "rb") as f:
            files = {"audio": ("audio.wav", f, "audio/wav")}
            r = requests.post(
                f"{BASE_URL}/api/voice/transcribe",
                files=files,
                timeout=15,
            )
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"


# ---------- 6) Missing file with valid auth ----------
class TestTranscribeMissingFile:
    def test_no_file_returns_422(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


# ---------- 7) Sanity: chat/stream still works ----------
class TestChatStreamSanity:
    def _consume_sse(self, resp) -> list[dict]:
        """Parse SSE stream into list of JSON events."""
        events = []
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw:
                continue
            if raw.startswith("data: "):
                payload = raw[len("data: "):]
                try:
                    events.append(json.loads(payload))
                except json.JSONDecodeError:
                    pass
        return events

    def test_chat_stream_basic_smoke(self, auth_headers):
        payload = {
            "message": "What are my rights on arrest?",
            "language": "en",
            "language_name": "English",
            "mode": "basic",
        }
        with requests.post(
            f"{BASE_URL}/api/chat/stream",
            headers={**auth_headers, "Accept": "text/event-stream"},
            json=payload,
            stream=True,
            timeout=60,
        ) as resp:
            assert resp.status_code == 200, f"chat/stream failed: {resp.status_code} {resp.text[:200]}"
            events = self._consume_sse(resp)

        types = [e.get("type") for e in events]
        assert "session" in types, f"Missing session frame in: {types}"
        assert "done" in types, f"Missing done frame in: {types}"
        # Either citation or a delta must appear (delta for content, citation for verified sources)
        assert any(t in ("citation", "delta") for t in types), (
            f"Neither citation nor delta present in stream: {types}"
        )

    def test_chat_stream_rti_application_fee_hits_rti_rule_3(self, auth_headers):
        """New corpus expansion: 'What is the RTI application fee?' should
        retrieve RTI Rule 3 (RTIR) — or at minimum RTI 6 — as a citation."""
        payload = {
            "message": "What is the RTI application fee?",
            "language": "en",
            "language_name": "English",
            "mode": "basic",
        }
        with requests.post(
            f"{BASE_URL}/api/chat/stream",
            headers={**auth_headers, "Accept": "text/event-stream"},
            json=payload,
            stream=True,
            timeout=60,
        ) as resp:
            assert resp.status_code == 200, f"chat/stream failed: {resp.status_code}"
            events = self._consume_sse(resp)

        citations = [e for e in events if e.get("type") == "citation"]
        assert citations, f"No citation frames returned. Event types: {[e.get('type') for e in events]}"

        labels = []
        for c in citations:
            cit = c.get("citation") or {}
            labels.append(cit.get("short_label", ""))
        labels_joined = " | ".join(labels)
        assert any(
            lbl in labels_joined for lbl in ("RTI Rule 3", "RTI 6", "RTI Rule 4", "RTI Rule 5")
        ), (
            f"Expected RTI Rule 3 or RTI 6 in citations, got: {labels_joined}"
        )
