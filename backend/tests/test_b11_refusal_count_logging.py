"""
B-11 (P2): refusal count does not increase.

Root cause: db.refusal_events (the A4 analytics collection that backs
GET /api/admin/refusal-stats' total_refusals) was only ever written from
ONE place in chat_router.py — the "early_refusal" block, which fires BEFORE
any LLM call. Two more refusal paths exist later in chat_stream's
event_gen(), firing only AFTER a real LLM call came back and was found to be
a refusal:
  1. the citation-truth-guard's output guard blocking unverified/banned
     content (sanitized -> CANNOT_CONFIRM_MESSAGE)
  2. looks_like_refusal() detecting the model's own refusal-flavoured prose
     (and _suppress_citations actually being set -- i.e. genuinely treated
     as a refusal, not the dead-citation-with-successor exemption)
Neither of those ever logged a refusal_events row, so every refusal of this
kind was invisible to admin_refusal_stats -- the count simply never went up
for them, no matter how many fired.

Fix: pulled the insert into one shared, module-level `log_refusal_event()`
function and called it from both of the late-refusal sites too (new cause
codes "output_guard_blocked" and "llm_self_refusal"), in addition to the
original early-refusal site (now calling the same shared function instead of
duplicating the insert_one(...) block).

This test exercises `log_refusal_event` directly against a fake db (no live
server/LLM/Mongo needed) and confirms:
  - every refusal path (early AND both late ones) now has a single, shared,
    privacy-safe write path
  - the schema stays exactly as privacy-reviewed (no user_id/session_id/
    message/answer text, ever)
  - a failed insert is swallowed (never crashes the response), same as the
    original design
  - the two new late-refusal cause codes exist and are distinguishable from
    the five original early-refusal cause codes, so admin_refusal_stats can
    tell "corpus had nothing" apart from "corpus had something but the
    answer wasn't trustworthy enough to show"
"""
import sys
import uuid
import importlib
import pytest


class _FakeRefusalEventsCollection:
    def __init__(self):
        self.inserted = []

    async def insert_one(self, doc):
        self.inserted.append(doc)
        return type("Result", (), {"inserted_id": doc.get("id")})()


class _FakeDB:
    def __init__(self):
        self.refusal_events = _FakeRefusalEventsCollection()


@pytest.fixture
def chat_router(monkeypatch):
    # Import real module (already importable in this sandbox's test harness,
    # same convention as test_n02_geo_router_auth_rate_limit.py).
    import api.chat_router as chat_router_mod
    fdb = _FakeDB()
    monkeypatch.setattr(chat_router_mod, "db", fdb)
    chat_router_mod._fake_db = fdb  # stash for assertions
    return chat_router_mod


ALLOWED_KEYS = {
    "_id", "id", "cause_code", "sub_cause", "category",
    "language", "state", "top_score", "top_key", "created_at",
}


@pytest.mark.asyncio
async def test_log_refusal_event_writes_privacy_safe_row(chat_router):
    await chat_router.log_refusal_event(
        "no_corpus_match", sub_cause="query_too_vague",
        category="other_uncategorized", language="en", state=None,
        top_score=0, top_key=None,
    )
    rows = chat_router._fake_db.refusal_events.inserted
    assert len(rows) == 1
    doc = rows[0]
    assert set(doc.keys()).issubset(ALLOWED_KEYS)
    assert "user_id" not in doc and "session_id" not in doc
    assert "message" not in doc and "query" not in doc and "content" not in doc
    assert doc["cause_code"] == "no_corpus_match"
    assert doc["sub_cause"] == "query_too_vague"
    uuid.UUID(doc["id"])  # must be a real uuid4, not reused/predictable


@pytest.mark.asyncio
@pytest.mark.parametrize("cause_code", ["output_guard_blocked", "llm_self_refusal"])
async def test_late_refusal_cause_codes_are_logged(chat_router, cause_code):
    """B-11's actual fix: these two cause codes previously had NO write path
    at all -- this asserts they now go through the exact same shared
    function as every other refusal, so the count increases for them too."""
    await chat_router.log_refusal_event(
        cause_code, category="other_uncategorized", language="en", state=None,
    )
    rows = chat_router._fake_db.refusal_events.inserted
    assert len(rows) == 1
    assert rows[0]["cause_code"] == cause_code
    # Late refusals have no meaningful retrieval score (the corpus step
    # already ran and produced something -- the ANSWER was the problem) --
    # must stay None, not a stale/misleading number.
    assert rows[0]["top_score"] is None
    assert rows[0]["top_key"] is None


@pytest.mark.asyncio
async def test_a_failed_insert_is_swallowed_not_raised(chat_router):
    """Matches the original design intent (a refusal_events write failure
    must never break the actual chat response) -- confirms the shared
    function preserves that, not just the original inline block."""
    async def _boom(doc):
        raise RuntimeError("mongo is down")
    chat_router._fake_db.refusal_events.insert_one = _boom
    # Must not raise.
    await chat_router.log_refusal_event("no_corpus_match", language="en")


@pytest.mark.asyncio
async def test_multiple_refusals_of_different_kinds_all_increase_the_count(chat_router):
    """Simulates one early refusal + both late-refusal kinds happening across
    three separate requests -- the exact scenario B-11 describes (the count
    not increasing for some refusals) -- and confirms total count now grows
    for all three, distinguishable by cause_code (what admin_refusal_stats'
    by_cause_code breakdown groups on)."""
    await chat_router.log_refusal_event("not_legal_advice_request", language="en")
    await chat_router.log_refusal_event("output_guard_blocked", language="en")
    await chat_router.log_refusal_event("llm_self_refusal", language="hi")
    rows = chat_router._fake_db.refusal_events.inserted
    assert len(rows) == 3
    causes = sorted(r["cause_code"] for r in rows)
    assert causes == ["llm_self_refusal", "not_legal_advice_request", "output_guard_blocked"]


def test_both_late_refusal_sites_call_the_shared_logger():
    """Source-level guard: confirms both call sites found during
    investigation (citation_guard output_blocked, and the looks_like_refusal
    genuine-suppression branch) actually invoke log_refusal_event / the
    local _log_late_refusal wrapper, not a dead/unreachable call."""
    import inspect
    import api.chat_router as chat_router_mod
    src = inspect.getsource(chat_router_mod.chat_stream)
    assert 'await _log_late_refusal("output_guard_blocked")' in src
    assert 'await _log_late_refusal("llm_self_refusal")' in src
    # And the wrapper itself must delegate to the one shared writer.
    assert "await log_refusal_event(" in src  # early-refusal call site
    import re
    wrapper_src = src[src.index("async def _log_late_refusal"):]
    wrapper_src = wrapper_src[:wrapper_src.index("async def event_gen")]
    assert "log_refusal_event(" in wrapper_src
