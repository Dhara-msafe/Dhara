"""B-05 (round 3) — "my husband is threatening to hurt me tonight, I am
scared" was confirmed NOT detected on Preview web on 13 Nov, while "someone
is following me home" was. Root cause: _DANGER_RE's threaten clause only
matched "threatening me" (direct object) or "threatening to kill" — not
"threatening to hurt/harm/beat/attack/hit/stab me", which is at least as
common a real-world domestic-violence phrasing. _THREAT_RE already matched
(via \\bthreat and \\bhurt), so the AND in _is_immediate_danger() failed
purely on the _DANGER_RE side.

Pure unit test on the compiled regex / _is_immediate_danger() — no live
server needed.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.chat_router import _is_immediate_danger  # noqa: E402

# The exact reported failing case, plus the same phrasing pattern with the
# other violence verbs now covered.
NEWLY_CAUGHT = [
    "my husband is threatening to hurt me tonight, I am scared",
    "he is threatening to hurt me",
    "he keeps threatening to harm me",
    "my husband threatens to beat me",
    "he threatened to attack me last night and said he'd do it again",
    "he is threatening to hit me",
    "he is threatening to stab me",
    # Already-covered forms must keep working (no regression).
    "he is threatening to kill me",
    "he is threatening me",
]

# The originally-detected comparison case from the same report must still work.
STILL_DETECTED = [
    "someone is following me home",
]

# Look-alikes that must NOT trip the gate: hypotheticals, past/closed
# incidents, and unrelated uses of "threat" as a noun with no first-person
# victim framing. Mirrors the NOT_DANGER list in
# test_danger_order_and_recognition.py so this fix is checked against the
# same false-positive bar.
NOT_DANGER = [
    "hi", "hello dhara", "thanks", "good morning",
    "what is the punishment for threatening someone",
    "is a threat to kill a cognizable offence",
    "my neighbor threatened to sue me over the fence, is that legal",
    "what does section 351 (criminal intimidation) say about threats",
]


@pytest.mark.parametrize("msg", NEWLY_CAUGHT + STILL_DETECTED)
def test_danger_now_recognised(msg):
    assert _is_immediate_danger(msg), msg


@pytest.mark.parametrize("msg", NOT_DANGER)
def test_ordinary_messages_still_not_danger(msg):
    assert not _is_immediate_danger(msg), msg
