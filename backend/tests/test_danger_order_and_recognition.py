"""DHARA-P0-4 regression: immediate-danger assessment precedes every
shortcut, and the recognition gaps found in Round 3 are closed."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.chat_router import _is_immediate_danger  # noqa: E402
from engine.conversational_intents import (  # noqa: E402
    _BARE_DISTRESS_PHRASES, is_bare_distress, classify_conversational_intent,
    get_conversational_template,
)

SRC = (Path(__file__).resolve().parent.parent / "api" / "chat_router.py").read_text(encoding="utf-8")

ROUND3_GAPS = [
    "help me he has a knife",
    "help me i am being followed",
    "bachao maar dega",
    "मुझे बचाओ",
]
OTHER_DANGER = [
    "help me he is going to kill me", "someone is following me", "he pulled out a gun",
    "mujhe bachao", "वो मुझे मार डालेगा", "help me i am in danger",
]
NOT_DANGER = [
    "hi", "hello dhara", "thanks", "good morning", "help me file an FIR",
    "help me write a rent agreement", "what is the punishment for carrying a knife",
    "my RTI application is being followed up", "how do I follow up on my complaint",
    "what does section 498A say", "my husband has a job abroad, can I claim maintenance",
]


@pytest.mark.parametrize("msg", ROUND3_GAPS + OTHER_DANGER)
def test_danger_recognised(msg):
    assert _is_immediate_danger(msg), msg


@pytest.mark.parametrize("msg", NOT_DANGER)
def test_ordinary_messages_not_danger(msg):
    assert not _is_immediate_danger(msg), msg


@pytest.mark.parametrize("phrase", _BARE_DISTRESS_PHRASES)
def test_previously_supported_bare_distress_keeps_sos_shortcut(phrase):
    # Bare phrases are not acute danger, so they keep the existing SOS reply.
    assert is_bare_distress(phrase)
    assert not _is_immediate_danger(phrase), phrase


@pytest.mark.parametrize("msg", ["hi", "hello", "thanks", "good morning"])
def test_greetings_still_get_conversational_reply(msg):
    assert classify_conversational_intent(msg, "en")
    assert not _is_immediate_danger(msg)


def test_danger_computed_before_every_shortcut_in_chat_stream():
    start = SRC.index("async def chat_stream(")
    body = SRC[start:]
    first_emergency = body.index("_emergency = _is_immediate_danger(body.message)")
    for marker in ("_c1_pre = (", "is_bare_distress(body.message):", "classify_conversational_intent(body.message, body.language)"):
        assert first_emergency < body.index(marker), marker
    assert body.count("_emergency = _is_immediate_danger") == 1


def test_sos_fast_path_skipped_when_danger():
    i = SRC.index("# ── SOS fast-path")
    gate = SRC[i:i + 800]
    assert "and not _emergency and is_bare_distress(body.message)" in gate


def test_gujarati_sos_is_single_script():
    t = get_conversational_template("distress_sos", "gu")
    assert not [c for c in t if "\u0A00" <= c <= "\u0A7F"], "Gurmukhi letter in Gujarati SOS"


def test_guest_quota_wall_yields_to_immediate_danger():
    """A guest who has exhausted the free-question quota must still receive a
    safety reply when in immediate danger — the quota wall must branch on
    `_emergency` (and bare distress) BEFORE emitting guest_limit_reached."""
    start = SRC.index("async def _guest_limit_gen():")
    block = SRC[start:start + 2200]
    emerg = block.index("if _emergency:")
    distress = block.index("is_bare_distress(body.message):")
    wall = block.index('"type": "guest_limit_reached"')
    # Both safety branches are checked before the quota wall is emitted.
    assert emerg < wall, "emergency branch must precede guest_limit_reached"
    assert distress < wall, "bare-distress branch must precede guest_limit_reached"
    # The emergency branch sends the 112 banner, not the paywall.
    assert "_EMERGENCY_BANNER.get(body.language" in block
