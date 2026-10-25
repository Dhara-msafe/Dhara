"""
test_stt_engine.py — unit tests for engine/stt_engine.py.

Exercises production functions directly:
  transcribe_with_retry  (core logic extracted from whisper_transcribe)
  normalize_language
  _should_retry_without_hint

The AsyncOpenAI client is injected as a mock — no real network, no LLM key.

Run with:
  pytest tests/test_stt_engine.py -v
"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from engine.stt_engine import (
    transcribe_with_retry,
    normalize_language,
    _should_retry_without_hint,
    WHISPER_HINT_SET,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_client(text="transcript text", side_effect=None):
    """Return a mock AsyncOpenAI client whose transcriptions.create() is
    async and returns a simple object with a .text attribute."""
    result = MagicMock()
    result.text = text
    client = MagicMock()
    if side_effect:
        client.audio.transcriptions.create = AsyncMock(side_effect=side_effect)
    else:
        client.audio.transcriptions.create = AsyncMock(return_value=result)
    return client

AUDIO = b"fake-audio-bytes"
FNAME = "audio.m4a"
CTYPE = "audio/m4a"


# ── normalize_language ────────────────────────────────────────────────────────

class TestNormalizeLanguage:
    def test_bare_code_unchanged(self):
        assert normalize_language("ta") == "ta"

    def test_bcp47_stripped(self):
        assert normalize_language("ta-IN") == "ta"

    def test_uppercased(self):
        assert normalize_language("TA") == "ta"

    def test_en_us(self):
        assert normalize_language("en-US") == "en"

    def test_none_returns_none(self):
        assert normalize_language(None) is None

    def test_empty_string_returns_none(self):
        assert normalize_language("") is None

    def test_ta_in_hint_set(self):
        assert "ta" in WHISPER_HINT_SET

    def test_unknown_code_not_in_hint_set(self):
        assert "xx" not in WHISPER_HINT_SET


# ── _should_retry_without_hint ────────────────────────────────────────────────

class TestShouldRetry:
    def test_unsupported_language_literal(self):
        assert _should_retry_without_hint("unsupported_language error")

    def test_unsupported_language_spaced(self):
        assert _should_retry_without_hint("unsupported language for ta")

    def test_invalid_language_literal(self):
        assert _should_retry_without_hint("invalid_language ta")

    def test_invalid_language_spaced(self):
        assert _should_retry_without_hint("invalid language code")

    def test_400_with_language(self):
        assert _should_retry_without_hint("status 400 language not accepted")

    def test_422_with_language(self):
        assert _should_retry_without_hint("status 422 language ta invalid")

    def test_language_not_supported(self):
        assert _should_retry_without_hint("error: language not supported")

    def test_language_not_valid(self):
        assert _should_retry_without_hint("language not valid: ta")

    def test_no_retry_generic_500(self):
        assert not _should_retry_without_hint("internal server error 500")

    def test_no_retry_audio_too_short(self):
        assert not _should_retry_without_hint("audio_too_short clip rejected")

    def test_no_retry_network_error(self):
        assert not _should_retry_without_hint("network request failed")


# ── transcribe_with_retry ─────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestTranscribeWithRetry:

    # B-1 — no lang hint, single call, no retry
    async def test_no_hint_single_call(self):
        client = make_client("hello")
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, None, client)
        assert result["text"] == "hello"
        assert client.audio.transcriptions.create.call_count == 1
        call_kwargs = client.audio.transcriptions.create.call_args[1]
        assert "language" not in call_kwargs

    # B-2 — hint present, first call succeeds → single call
    async def test_hint_success_single_call(self):
        client = make_client("வணக்கம்")
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert result["text"] == "வணக்கம்"
        assert client.audio.transcriptions.create.call_count == 1
        call_kwargs = client.audio.transcriptions.create.call_args[1]
        assert call_kwargs.get("language") == "ta"

    # B-3 — hint "ta", first raises unsupported_language → retry without → succeeds
    async def test_unsupported_language_triggers_retry(self):
        second_result = MagicMock(); second_result.text = "retry-ok"
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("unsupported_language"),
            second_result,
        ])
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert result["text"] == "retry-ok"
        assert client.audio.transcriptions.create.call_count == 2
        # Second call must NOT carry the language hint
        second_call_kwargs = client.audio.transcriptions.create.call_args_list[1][1]
        assert "language" not in second_call_kwargs

    # B-4 — "invalid language" proxy variant triggers retry
    async def test_invalid_language_triggers_retry(self):
        r2 = MagicMock(); r2.text = "ok"
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("invalid language"),
            r2,
        ])
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert result["text"] == "ok"
        assert client.audio.transcriptions.create.call_count == 2

    # B-5 — "400 language" triggers retry
    async def test_400_language_triggers_retry(self):
        r2 = MagicMock(); r2.text = "ok"
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("400 language not accepted"),
            r2,
        ])
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert result["text"] == "ok"

    # B-6 — "422 language not valid" triggers retry
    async def test_422_language_not_valid_triggers_retry(self):
        r2 = MagicMock(); r2.text = "ok"
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("422 language not valid"),
            r2,
        ])
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert result["text"] == "ok"

    # B-7 — audio_too_short is NOT a language rejection, must propagate without retry
    async def test_audio_too_short_no_retry(self):
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(
            side_effect=Exception("audio_too_short")
        )
        with pytest.raises(Exception, match="audio_too_short"):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert client.audio.transcriptions.create.call_count == 1

    # B-8 — both attempts fail → exception from second call propagates
    async def test_both_attempts_fail(self):
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("unsupported_language"),
            Exception("server error on retry"),
        ])
        with pytest.raises(Exception, match="server error on retry"):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert client.audio.transcriptions.create.call_count == 2

    # B-9 — BCP-47 "ta-IN" normalises to "ta" before first call
    async def test_bcp47_normalised(self):
        client = make_client("ok")
        await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta-IN", client)
        call_kwargs = client.audio.transcriptions.create.call_args[1]
        assert call_kwargs.get("language") == "ta"

    # B-10 — empty audio bytes passed through (backend judges; not doubled-up)
    async def test_empty_audio_single_call(self):
        client = make_client("ok")
        result = await transcribe_with_retry(b"", FNAME, CTYPE, "ta", client)
        assert result["text"] == "ok"
        assert client.audio.transcriptions.create.call_count == 1

    # B-11 — asyncio.CancelledError propagates, no retry attempted
    async def test_cancellation_not_retried(self):
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(
            side_effect=asyncio.CancelledError()
        )
        with pytest.raises(asyncio.CancelledError):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)
        assert client.audio.transcriptions.create.call_count == 1

    # B-12 — duplicate-submit: transcribe_with_retry is stateless/idempotent
    # per call; deduplication is the caller's responsibility (index.tsx).
    # This test documents and verifies that property: two identical calls
    # produce two independent results without shared state.
    async def test_stateless_two_calls_independent(self):
        call_n = 0
        async def _create(**kwargs):
            nonlocal call_n
            call_n += 1
            r = MagicMock(); r.text = f"result-{call_n}"
            return r
        client = MagicMock()
        client.audio.transcriptions.create = _create
        r1 = await transcribe_with_retry(AUDIO, FNAME, CTYPE, None, client)
        r2 = await transcribe_with_retry(AUDIO, FNAME, CTYPE, None, client)
        assert r1["text"] == "result-1"
        assert r2["text"] == "result-2"
        assert call_n == 2, "each call must be independent — no shared state"
