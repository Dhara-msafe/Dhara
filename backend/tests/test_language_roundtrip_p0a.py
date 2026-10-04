"""
P0-a — Regional language defect, automated round-trip test.

Tester report: "questions asked in languages other than English are not
answered correctly." Women's Shield cannot ship until Hindi, Marathi and
Tamil complete the FULL round trip:

    speech (TTS-generated) -> speech-to-text -> pipeline -> answer in the
    SAME language -> text-to-speech of that answer.

Each leg is checked and reported independently so a failure immediately
tells you *which* leg broke, instead of a single opaque "it doesn't work":

  1. TTS-in:    POST /api/voice/tts        (generate the "spoken" question)
  2. STT:       POST /api/voice/transcribe (transcribe it back to text)
  3. Pipeline:  POST /api/chat/stream      (answer must be in the same script)
  4. TTS-out:   POST /api/voice/tts        (the answer itself must be speakable)

Script correctness (step 3, the exact defect reported) is judged with the
same `script_guard.detect_script` the production endpoint already uses —
not a new ad-hoc check — so this test and production can never disagree
about what "the same language" means.
"""
import io
import os
import sys
import json
import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from script_guard import detect_script, LANGUAGE_EXPECTED_SCRIPT  # noqa: E402

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or ""
).rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

TEST_EMAIL = "protest@gandhikar.in"
TEST_PASSWORD = "test1234"

# One short, simple legal question per launch language — short on purpose so
# TTS/STT have the best chance of round-tripping cleanly; any genuine defect
# in the pipeline-answer language should still show up regardless of phrase
# length, since that leg (3) doesn't depend on STT accuracy.
CASES = {
    "hi": ("Hindi", "पुलिस मुझे गिरफ्तार करे तो मेरे अधिकार क्या हैं?"),
    "mr": ("Marathi", "पोलिसांनी मला अटक केली तर माझे हक्क काय आहेत?"),
    "ta": ("Tamil", "காவல்துறை என்னை கைது செய்தால் எனக்கு என்ன உரிமைகள் உள்ளன?"),
}


def _looks_like_mp3(data: bytes) -> bool:
    if not data or len(data) < 4:
        return False
    if data[:3] == b"ID3":
        return True
    return data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


@pytest.fixture(scope="module")
def auth_headers() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _consume_sse(resp) -> list[dict]:
    events = []
    for raw in resp.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data: "):
            continue
        try:
            events.append(json.loads(raw[len("data: "):]))
        except json.JSONDecodeError:
            pass
    return events


@pytest.mark.parametrize("lang_code", list(CASES.keys()))
class TestLanguageRoundTrip:
    """One class instance per launch language, run independently — a failure
    in Tamil must never be hidden by Hindi passing, and vice versa."""

    def test_full_round_trip(self, auth_headers, lang_code):
        lang_name, phrase = CASES[lang_code]
        expected_script = LANGUAGE_EXPECTED_SCRIPT[lang_code]

        # ---- Leg 1: TTS-in — synthesize the spoken question ----
        tts_in = requests.post(
            f"{BASE_URL}/api/voice/tts",
            headers=auth_headers,
            json={"text": phrase, "language": lang_code},
            timeout=60,
        )
        assert tts_in.status_code == 200 and _looks_like_mp3(tts_in.content), (
            f"[{lang_name}] LEG 1 (TTS-in) failed: status={tts_in.status_code}, "
            f"first bytes look like MP3={_looks_like_mp3(tts_in.content)}. "
            f"Root cause: cloud TTS cannot synthesize {lang_name} at all."
        )

        # ---- Leg 2: STT — transcribe the generated audio back ----
        files = {"audio": ("q.mp3", io.BytesIO(tts_in.content), "audio/mpeg")}
        stt = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            headers=auth_headers,
            files=files,
            data={"language": lang_code},
            timeout=60,
        )
        assert stt.status_code == 200, (
            f"[{lang_name}] LEG 2 (STT) failed: status={stt.status_code} {stt.text[:200]}. "
            f"Root cause: Whisper rejects/mishandles the {lang_code} hint for this audio."
        )
        transcribed = (stt.json() or {}).get("text", "").strip()
        question_for_pipeline = transcribed or phrase  # fall back if STT returns empty

        # ---- Leg 3: pipeline — answer must come back in the SAME script ----
        stream = requests.post(
            f"{BASE_URL}/api/chat/stream",
            headers={**auth_headers, "Accept": "text/event-stream"},
            json={
                "message": question_for_pipeline,
                "language": lang_code,
                "language_name": lang_name,
                "mode": "basic",
            },
            stream=True,
            timeout=60,
        )
        assert stream.status_code == 200, (
            f"[{lang_name}] LEG 3 (pipeline) failed to start: {stream.status_code}"
        )
        events = _consume_sse(stream)
        # SSE delta/final frames carry the text under the "content" key (see
        # sse({"type": "delta", "content": ...}) in chat_router.py) — NOT
        # under a "delta" key. A "final" frame, when present, OVERWRITES the
        # accumulated delta text (the server emits it only when the reply-
        # language-repair step rewrote the answer), so it must win if seen.
        answer = "".join(
            e.get("content", "") for e in events if e.get("type") == "delta"
        )
        for e in events:
            if e.get("type") == "final":
                answer = e.get("content", "")
        assert answer.strip(), (
            f"[{lang_name}] LEG 3 (pipeline) returned an empty answer for: {question_for_pipeline!r}"
        )

        detected = detect_script(answer)
        assert detected == expected_script, (
            f"[{lang_name}] LEG 3 (pipeline) ROOT CAUSE — asked in {lang_name} "
            f"({question_for_pipeline!r}) but answer came back in script "
            f"'{detected}', expected '{expected_script}'. First 150 chars of "
            f"answer: {answer[:150]!r}. This is the exact tester-reported "
            f"defect: questions in non-English languages are not answered "
            f"correctly."
        )

        # ---- Leg 4: TTS-out — the answer itself must be speakable ----
        tts_out = requests.post(
            f"{BASE_URL}/api/voice/tts",
            headers=auth_headers,
            json={"text": answer[:500], "language": lang_code},
            timeout=60,
        )
        assert tts_out.status_code == 200 and _looks_like_mp3(tts_out.content), (
            f"[{lang_name}] LEG 4 (TTS-out) failed: status={tts_out.status_code}. "
            f"Root cause: cloud TTS cannot speak the pipeline's own {lang_name} answer."
        )
