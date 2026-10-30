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

    # V1-A: nine proxy-rejected codes must NOT be in the hint set —
    # they get auto-detect (no hint), not a first attempt that will 400.
    def test_v1a_proxy_rejected_codes_removed(self):
        rejected = {"bn", "te", "gu", "ml", "pa", "or", "as", "sa", "sd"}
        overlap = rejected & WHISPER_HINT_SET
        assert not overlap, (
            f"Proxy-rejected codes still in WHISPER_HINT_SET: {overlap}. "
            "These cause a wasted first attempt → 400 → retry. Remove them."
        )

    # V1-A: the seven confirmed codes must remain.
    def test_v1a_confirmed_codes_present(self):
        confirmed = {"en", "hi", "ta", "mr", "kn", "ur", "ne"}
        missing = confirmed - WHISPER_HINT_SET
        assert not missing, (
            f"Probe-confirmed codes missing from WHISPER_HINT_SET: {missing}."
        )


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



# ── Tamil language acceptance tests ──────────────────────────────────────────
#
# Physical-device acceptance contract (NOT RUN here — require a native build):
#   TA-N1  Real Tamil audio recorded on an Android device passes through the
#          production Blob → multipart → /api/voice/transcribe pipeline.
#   TA-N2  The `language: "ta-IN"` BCP-47 tag sent by the frontend is correctly
#          normalised to "ta" by the backend before reaching Whisper.
#   TA-N3  Whisper returns recognisable Tamil text (Unicode script) for a 2s
#          Tamil utterance recorded on the test device.
#   TA-N4  On Samsung devices (where native SpeechRecognizer silently fails),
#          the WhisperCloudSTT path is used and Tamil text is returned correctly.
#   TA-N5  Background noise common in Indian domestic environments does not
#          cause the retry path to misfire (false "unsupported language" signal).

class TestTamilAcceptancePath:
    """Acceptance tests for the Tamil voice transcription path.

    These exercise the PRODUCTION stt_engine functions with Tamil-specific
    inputs.  They complement the generic TestTranscribeWithRetry suite by
    verifying Tamil-specific normalisation, hint-set membership, and the
    exact retry sequence that fires when Whisper rejects the "ta" hint.
    """

    # TA-1: Tamil BCP-47 variants normalise to the bare ISO 639-1 code
    def test_ta1_bcp47_ta_in_normalises_to_ta(self):
        assert normalize_language("ta-IN") == "ta"

    def test_ta2_bcp47_ta_lk_normalises_to_ta(self):
        assert normalize_language("ta-LK") == "ta"

    def test_ta3_uppercase_TA_normalises_to_ta(self):
        assert normalize_language("TA") == "ta"

    # TA-4: Tamil is in the production WHISPER_HINT_SET (first attempt uses hint)
    def test_ta4_ta_in_whisper_hint_set(self):
        assert "ta" in WHISPER_HINT_SET, (
            "Tamil must be in WHISPER_HINT_SET so the first transcription call "
            "always sends language='ta' rather than auto-detect"
        )

    # TA-5: Successful Tamil transcription — Whisper accepts "ta"
    @pytest.mark.asyncio
    async def test_ta5_tamil_hint_success_single_call(self):
        """When Whisper accepts "ta", no retry should occur."""
        tamil_text = "அவர்கள் என் புகாரை எழுத மறுத்தனர்"  # "They refused to write my complaint"
        client = make_client(text=tamil_text)
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta-IN", client)
        assert result["text"] == tamil_text
        assert client.audio.transcriptions.create.call_count == 1, (
            "A single call with language='ta' should suffice when Whisper accepts it"
        )
        call_kwargs = client.audio.transcriptions.create.call_args.kwargs
        assert call_kwargs.get("language") == "ta"

    # TA-6: Tamil retry path — Whisper rejects "ta" → retry without hint
    @pytest.mark.asyncio
    async def test_ta6_unsupported_language_ta_retries_without_hint(self):
        """If Whisper returns an 'unsupported language' error for Tamil, the
        engine retries once without the language hint (auto-detect)."""
        calls = []
        async def _create(**kwargs):
            calls.append(kwargs.get("language"))
            if kwargs.get("language") == "ta":
                raise Exception("unsupported_language for ta")
            r = MagicMock(); r.text = "auto-detected Tamil text"
            return r
        client = MagicMock()
        client.audio.transcriptions.create = _create

        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta-IN", client)

        assert len(calls) == 2, "must retry exactly once"
        assert calls[0] == "ta",  "first call must use the normalised Tamil hint"
        assert calls[1] is None,  "retry call must NOT pass a language hint"
        assert result["text"] == "auto-detected Tamil text"

    # TA-7: Tamil invalid_language signal also triggers retry
    @pytest.mark.asyncio
    async def test_ta7_invalid_language_ta_retries_without_hint(self):
        calls = []
        async def _create(**kwargs):
            calls.append(kwargs.get("language"))
            if kwargs.get("language") == "ta":
                raise Exception("invalid_language code ta")
            r = MagicMock(); r.text = "fallback text"
            return r
        client = MagicMock()
        client.audio.transcriptions.create = _create

        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta", client)

        assert calls[0] == "ta"
        assert calls[1] is None
        assert result["text"] == "fallback text"

    # TA-8: 400 response with "language" in the message triggers Tamil retry
    @pytest.mark.asyncio
    async def test_ta8_400_with_language_triggers_retry(self):
        calls = []
        async def _create(**kwargs):
            calls.append(kwargs.get("language"))
            if kwargs.get("language") == "ta":
                raise Exception("400 Bad Request: language parameter invalid")
            r = MagicMock(); r.text = "ok"
            return r
        client = MagicMock()
        client.audio.transcriptions.create = _create

        await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta-IN", client)
        assert len(calls) == 2

    # TA-9: Both Tamil attempts fail → propagate error, do not swallow it
    @pytest.mark.asyncio
    async def test_ta9_both_attempts_fail_raises(self):
        async def _create(**kwargs):
            if kwargs.get("language") == "ta":
                raise Exception("unsupported language ta")
            raise Exception("audio_too_short")
        client = MagicMock()
        client.audio.transcriptions.create = _create

        with pytest.raises(Exception, match="audio_too_short"):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta-IN", client)

    # TA-10: Non-language Tamil error does NOT trigger retry (e.g., audio_too_short)
    @pytest.mark.asyncio
    async def test_ta10_non_language_error_with_ta_hint_does_not_retry(self):
        calls = []
        async def _create(**kwargs):
            calls.append(kwargs)
            raise Exception("audio_too_short")
        client = MagicMock()
        client.audio.transcriptions.create = _create

        with pytest.raises(Exception, match="audio_too_short"):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "ta-IN", client)

        assert len(calls) == 1, "audio_too_short must NOT trigger a Tamil retry"


# ── TestBehavioralHintRouting — call-parameter and retry-count assertions ─────
#
# These tests complement the set-membership checks above (TestNormalizeLanguage,
# TestTamilAcceptancePath) with end-to-end behavioral proofs:
#   - what kwargs are actually sent in each call (not just set membership)
#   - that the retry count is bounded to exactly one
#   - that an unexpected 400 (without "language" in the message) never retries
#
# User requirement: "Membership assertions alone are insufficient."

@pytest.mark.asyncio
class TestBehavioralHintRouting:

    # BR-1 through BR-9: each proxy-rejected Indian code → auto-detect first call
    @pytest.mark.parametrize("rejected_code", [
        "bn", "te", "gu", "ml", "pa", "or", "as", "sa", "sd",
    ])
    async def test_rejected_code_first_call_has_no_language_kwarg(self, rejected_code: str):
        """Proxy-rejected codes must NOT carry a language hint.
        The first call must be auto-detect (no `language` kwarg) — a hint here
        produces a guaranteed 400 before any transcription begins."""
        client = make_client("auto-detect result")
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, rejected_code, client)
        assert result["text"] == "auto-detect result"
        assert client.audio.transcriptions.create.call_count == 1, (
            f"{rejected_code!r}: only one call expected on success"
        )
        call_kwargs = client.audio.transcriptions.create.call_args.kwargs
        assert "language" not in call_kwargs, (
            f"{rejected_code!r}: must NOT carry a language hint — "
            "sending this hint produces a guaranteed 400 rejection."
        )

    # BR-10 through BR-16: probe-verified codes → hint present in first call
    @pytest.mark.parametrize("lang_input,expected_hint", [
        ("hi", "hi"),
        ("en", "en"),
        ("mr", "mr"),
        ("kn", "kn"),
        ("ur", "ur"),
        ("ne", "ne"),
        ("ta-IN", "ta"),   # BCP-47 normalised before the hint-set lookup
    ])
    async def test_confirmed_code_first_call_carries_correct_hint(
        self, lang_input: str, expected_hint: str
    ):
        """Probe-verified codes must include the exact normalised hint in the
        first call so Whisper can align phonemes without a second round-trip."""
        client = make_client("hint-result")
        await transcribe_with_retry(AUDIO, FNAME, CTYPE, lang_input, client)
        call_kwargs = client.audio.transcriptions.create.call_args.kwargs
        assert call_kwargs.get("language") == expected_hint, (
            f"Input {lang_input!r}: expected first-call hint {expected_hint!r}, "
            f"got kwargs={call_kwargs!r}"
        )

    # BR-17: retry is bounded to exactly one attempt
    async def test_retry_bounded_to_exactly_one_attempt(self):
        """After a language-hint rejection the engine retries at most ONCE.
        A second failure on the retry propagates immediately; no third call."""
        second_ok = MagicMock()
        second_ok.text = "ok"
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("unsupported_language"),
            second_ok,
        ])
        result = await transcribe_with_retry(AUDIO, FNAME, CTYPE, "hi", client)
        assert result["text"] == "ok"
        assert client.audio.transcriptions.create.call_count == 2, (
            "exactly one retry — not zero, not two or more"
        )

    # BR-18: retry second call carries NO language kwarg
    async def test_retry_second_call_strips_language_hint(self):
        """The retry (second) call must NOT repeat the language hint.
        Repeating the hint would provoke the same 400 rejection again and
        hang in an implicit retry loop."""
        second_ok = MagicMock()
        second_ok.text = "ok"
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(side_effect=[
            Exception("unsupported_language"),
            second_ok,
        ])
        await transcribe_with_retry(AUDIO, FNAME, CTYPE, "hi", client)
        first_kw  = client.audio.transcriptions.create.call_args_list[0].kwargs
        second_kw = client.audio.transcriptions.create.call_args_list[1].kwargs
        assert first_kw.get("language") == "hi", (
            "first call must carry the normalised hint"
        )
        assert "language" not in second_kw, (
            "retry (second) call must NOT carry the language hint — "
            "that would produce the same 400 again"
        )

    # BR-19: unexpected 400 (no 'language' in message) → no retry
    async def test_unexpected_400_without_language_keyword_no_retry(self):
        """A 400 that does NOT mention 'language' is not a hint rejection.
        It must propagate immediately without a retry (e.g. malformed audio,
        over-limit audio, unsupported codec — none of which a stripped hint fixes)."""
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(
            side_effect=Exception("400 Bad Request: audio format not supported")
        )
        with pytest.raises(Exception, match="400 Bad Request"):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "hi", client)
        assert client.audio.transcriptions.create.call_count == 1, (
            "a 400 without 'language' in the message must NOT trigger a retry"
        )

    # BR-20: no-hint path (rejected code) never retries even on a language-flavoured 400
    async def test_no_hint_path_never_retries_even_on_language_400(self):
        """When the first call had NO hint (rejected code), the retry guard
        `if lang_hint and ...` is False, so even a language-flavoured 400
        from the auto-detect call must NOT produce a retry."""
        client = make_client()
        client.audio.transcriptions.create = AsyncMock(
            side_effect=Exception("400 language not supported")
        )
        # "bn" is a proxy-rejected code → lang_hint = None → no retry guard
        with pytest.raises(Exception, match="400 language"):
            await transcribe_with_retry(AUDIO, FNAME, CTYPE, "bn", client)
        assert client.audio.transcriptions.create.call_count == 1, (
            "no hint was sent, so there is nothing to strip — no retry must fire"
        )
