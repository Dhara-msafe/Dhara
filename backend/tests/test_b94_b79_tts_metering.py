"""
Backend regression tests for B-94 (P1) + B-79 (P1):

  "read-aloud and AUTO-PLAY of answers are charged from the same daily
  bucket as legal questions ... every typed question costs 2; Officer card
  listen cost 2; replaying a saved answer costs 1 each time. Do not meter
  auto-play / fixed help screens (officer card, panic lesson, action plan)
  / replays, or turn auto-play off by default. A user at 0 must still hear
  the Officer card."

Root cause (confirmed by reading source, not reported by the bug itself):

  1. ChunkedSpeaker (frontend/src/voice/tts.ts) synthesises up to
     MAX_IN_FLIGHT = 2 chunks of one answer concurrently. The OLD server
     side decided "is this the first chunk of `group`, so it should be the
     one that's charged" with a racy upsert against `usage_daily`
     ({"$setOnInsert": ...}, upsert=True) that has NO unique index behind
     it in this service. Two concurrent "first" requests for the same
     group could both observe no existing document and both get counted
     as the inserting ("first") request, so a single officer-card listen
     -- or any answer split into 2+ chunks -- could cost 2 instead of 1.

  2. Fixed/canned, non-LLM safety screens (officer card, panic lesson,
     action plan, the language-onboarding voice prompt) and replays of an
     already-answered/already-paid session message were metered exactly
     like a brand-new legal question, so a free user could be metered out
     of being able to hear safety content they'd already "paid" to see in
     text, or could never afford to re-hear it.

Fix, both scoped entirely to the /voice/tts route in api/chat_router.py
(dependencies.meter_llm_use itself is untouched, so /voice/transcribe's
legitimate per-question metering is unaffected):

  (a) TTSIn gained `chunk_index: Optional[int]` -- the client assigns this
      itself and knows it for certain, so "is this chunk 0 of `group`" no
      longer needs a database race at all: chunk_index == 0 charges, any
      other index doesn't.
  (b) TTSIn gained `free_reason: Optional[str]`, checked against a small
      explicit allow-list ("fixed_screen", "replay") -- when it matches,
      `should_meter` is forced False unconditionally, bypassing the
      chunk_index check entirely. Any other value (including None) is
      ignored and the call is metered normally, so this can't be abused to
      get a live legal answer for free.

These tests call the `tts()` route coroutine directly (same technique as
test_b98_followup_role_carryforward.py: no live server needed -- MONGO_URL
connections to localhost:8001 fail with ConnectionError in this sandbox,
which is a pre-existing environment limitation, not something these tests
work around by skipping real logic). `db.usage_daily`, `meter_llm_use`, and
`openai_client` are monkeypatched with fakes so the gating logic itself --
the thing that was actually buggy -- is exercised directly and
deterministically, with no network, no real Mongo, and no OpenAI call.
"""
import os
import sys
import types
import asyncio
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.chat_router as chat_router  # noqa: E402


class _FakeAudioResp:
    async def aread(self):
        return b"\xff\xfb\x00\x00fake-mp3-bytes"


class _FakeSpeechCreate:
    async def create(self, **kwargs):
        return _FakeAudioResp()


class _FakeAudio:
    def __init__(self):
        self.speech = _FakeSpeechCreate()


class _FakeOpenAIClient:
    def __init__(self):
        self.audio = _FakeAudio()


class _FakeUsageDaily:
    """Records every update_one call; never errors, never races for real."""

    def __init__(self):
        self.calls = []

    async def update_one(self, filt, update, upsert=False):
        self.calls.append({"filter": dict(filt), "update": dict(update), "upsert": upsert})

        class _Result:
            upserted_id = "fake-id" if upsert else None

        return _Result()


class _FakeDb:
    def __init__(self):
        self.usage_daily = _FakeUsageDaily()


@pytest.fixture
def fake_meter(monkeypatch):
    """Tracks every call to meter_llm_use without touching real usage_daily
    or raising 429s, so tests can assert purely on "was the free quota
    touched at all"."""
    calls = []

    async def _fake_meter_llm_use(user, kind):
        calls.append((user.get("id"), kind))

    monkeypatch.setattr(chat_router, "meter_llm_use", _fake_meter_llm_use)
    monkeypatch.setattr(chat_router, "openai_client", lambda: _FakeOpenAIClient())
    fake_db = _FakeDb()
    monkeypatch.setattr(chat_router, "db", fake_db)
    return calls, fake_db


def _user():
    return {"id": "user-123", "is_pro": False}


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------
# 1) The MAX_IN_FLIGHT=2 race: with the OLD racy-upsert logic, two
#    concurrent requests for chunk 0 and chunk 1 of the SAME group could
#    both appear to be "first" and both get metered. The NEW logic must
#    meter chunk 0 and must NOT meter chunk 1, deterministically, every
#    time -- not merely "usually", since the whole point of the fix is to
#    remove the race, not just make it rarer.
# ---------------------------------------------------------------------
class TestChunkIndexGating:
    def test_chunk_0_of_a_group_is_metered(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="hello", group="answer-1", chunk_index=0)
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 1, "chunk_index=0 must be metered exactly once"

    def test_chunk_1_of_the_same_group_is_not_metered(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="world", group="answer-1", chunk_index=1)
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 0, "chunk_index=1 (not the first chunk) must never be metered"

    def test_concurrent_chunk_0_and_chunk_1_meter_exactly_once_total(self, fake_meter):
        """This is the exact 'officer card listen costs 2' scenario:
        MAX_IN_FLIGHT=2 fires two requests for the same group concurrently.
        Regardless of which one's DB write would have "won" an upsert race
        under the old code, the new logic must charge exactly once because
        it no longer depends on database ordering at all."""
        calls, _ = fake_meter

        async def _both():
            body0 = chat_router.TTSIn(text="hello", group="answer-2", chunk_index=0)
            body1 = chat_router.TTSIn(text="world", group="answer-2", chunk_index=1)
            await asyncio.gather(chat_router.tts(body0, _user()), chat_router.tts(body1, _user()))

        _run(_both())
        assert len(calls) == 1, (
            f"an answer split into 2 concurrent chunks must cost exactly 1 "
            f"question, not {len(calls)} -- this is the B-94/B-79 double-charge bug"
        )

    def test_grouped_request_with_no_chunk_index_defaults_to_metered(self, fake_meter):
        """Backward-compat: an older/unknown client that sends `group` but
        not `chunk_index` must still be metered (fail safe towards
        charging once, per request, rather than silently granting free
        speech)."""
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="hello", group="answer-3", chunk_index=None)
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 1

    def test_ungrouped_request_is_always_metered(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="a standalone utterance")
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 1


# ---------------------------------------------------------------------
# 2) free_reason allow-list: fixed_screen / replay bypass metering
#    entirely; anything else is ignored.
# ---------------------------------------------------------------------
class TestFreeReasonAllowList:
    def test_fixed_screen_is_never_metered_even_as_chunk_0(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="officer card text", group="g1", chunk_index=0, free_reason="fixed_screen")
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 0, "fixed_screen content must be free even as chunk 0 of a group"

    def test_replay_is_never_metered(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="replaying a saved answer", free_reason="replay")
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 0, "replaying an already-paid-for answer must be free"

    def test_unrecognised_free_reason_is_ignored_and_still_metered(self, fake_meter):
        """A client can't invent its own free_reason value to dodge
        metering -- only the explicit allow-list is honoured."""
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="trying to sneak past metering", free_reason="totally_free_trust_me")
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 1, "an unrecognised free_reason must not exempt the call from metering"

    def test_free_reason_none_is_metered_normally(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="an ordinary question's answer")
        _run(chat_router.tts(body, _user()))
        assert len(calls) == 1


# ---------------------------------------------------------------------
# 3) A free user at 0 remaining questions must still be able to hear a
#    fixed-screen listen -- that's the user-facing symptom the bug report
#    led with ("A user at 0 must still hear the Officer card"). We confirm
#    this at the gating layer: free_reason='fixed_screen' means
#    meter_llm_use (the function that raises 429 when the cap is
#    exceeded) is never even called, so it cannot 429 regardless of how
#    exhausted the user's quota already is.
# ---------------------------------------------------------------------
class TestZeroQuotaStillHearsFixedScreen:
    def test_meter_llm_use_not_invoked_for_fixed_screen(self, fake_meter):
        calls, _ = fake_meter
        body = chat_router.TTSIn(text="You are speaking to a police officer...", free_reason="fixed_screen")
        # No HTTPException/429 raised, and meter_llm_use (which is what
        # would raise it) is never called at all.
        _run(chat_router.tts(body, _user()))
        assert calls == []
