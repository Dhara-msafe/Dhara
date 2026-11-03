"""B-04b / B-04c — in-process spy proof: the LLM provider is NEVER called on the
four safety-bypass paths, and no quota / sample / blocked-paywall state changes.

These tests call chat_stream() directly (no HTTP) so every LLM entry point used
by the chat pipeline (services.ai_gateway.build_chat and the raw OpenAI client
factory) can be replaced by spies that record calls and explode if invoked.
"""
import json
import os
import sys
import time

import pytest
import pytest_asyncio

sys.path.insert(0, "/app/backend")

import api.chat_router as cr  # noqa: E402
from dependencies import db  # noqa: E402

PAST = "2020-01-01T00:00:00+00:00"
DANGER_MSG = "he is going to kill me right now"
DISTRESS_MSG = "help"
ORDINARY_MSG = "What is a will?"


@pytest.fixture()
def llm_spy(monkeypatch):
    """Replace every LLM entry point with a recording spy that raises if used."""
    calls = []

    def _spy_build_chat(*a, **kw):
        calls.append(("build_chat", a, kw))
        raise AssertionError("LLM provider was called on a safety-bypass path")

    def _spy_openai_client(*a, **kw):
        calls.append(("openai_client", a, kw))
        raise AssertionError("OpenAI client was created on a safety-bypass path")

    monkeypatch.setattr(cr, "_ai_build_chat", _spy_build_chat)
    monkeypatch.setattr(cr, "openai_client", _spy_openai_client)
    monkeypatch.setattr(cr, "AsyncOpenAI", _spy_openai_client)
    return calls


async def _drain(resp):
    chunks = []
    async for c in resp.body_iterator:
        chunks.append(c.decode("utf-8") if isinstance(c, bytes) else c)
    return "".join(chunks)


def _events(raw):
    out = []
    for line in raw.splitlines():
        if line.startswith("data:"):
            out.append(json.loads(line[5:].strip()))
    return out


@pytest_asyncio.fixture(loop_scope="session")
async def guest_doc():
    uid = f"TEST_spy_guest_{int(time.time()*1000)}"
    doc = {
        "id": uid, "is_guest": True, "guest_expires_at": PAST,
        "guest_question_count": 0, "guest_question_limit": 5,
    }
    await db.users.insert_one(dict(doc))
    yield doc
    await db.users.delete_one({"id": uid})
    await db.messages.delete_many({"user_id": uid})


@pytest_asyncio.fixture(loop_scope="session")
async def pro_doc():
    uid = f"TEST_spy_pro_{int(time.time()*1000)}"
    doc = {
        "id": uid, "is_guest": False, "is_pro": False,
        "pro_samples_used": cr.PRO_FREE_SAMPLES,
    }
    await db.users.insert_one(dict(doc))
    yield doc
    await db.users.delete_one({"id": uid})
    await db.messages.delete_many({"user_id": uid})


async def _state(uid):
    u = await db.users.find_one({"id": uid})
    blocked = await db.messages.count_documents({"user_id": uid, "status": "blocked_paywall"})
    msgs = await db.messages.count_documents({"user_id": uid})
    return {
        "guest_question_count": int(u.get("guest_question_count", 0)),
        "pro_samples_used": int(u.get("pro_samples_used", 0)),
        "blocked_paywall": blocked,
        "messages": msgs,
    }


# ─────────── 1. expired guest + immediate danger ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_spy_expired_guest_danger(llm_spy, guest_doc):
    before = await _state(guest_doc["id"])
    resp = await cr.chat_stream(cr.ChatIn(message=DANGER_MSG, language="en", mode="pro"), user=guest_doc)
    raw = await _drain(resp)
    ev = _events(raw)
    assert llm_spy == [], llm_spy
    assert "112" in raw
    assert any(e.get("emergency") is True for e in ev)
    assert ev[0]["guest_expired"] is True and ev[-1]["type"] == "done"
    assert await _state(guest_doc["id"]) == before


# ─────────── 2. expired guest + bare distress ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_spy_expired_guest_distress(llm_spy, guest_doc):
    before = await _state(guest_doc["id"])
    resp = await cr.chat_stream(cr.ChatIn(message=DISTRESS_MSG, language="en", mode="pro"), user=guest_doc)
    raw = await _drain(resp)
    ev = _events(raw)
    assert llm_spy == [], llm_spy
    assert any(e.get("c1_sos") is True for e in ev)
    assert await _state(guest_doc["id"]) == before


# ─────────── 3. exhausted Pro + immediate danger ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_spy_exhausted_pro_danger(llm_spy, pro_doc):
    before = await _state(pro_doc["id"])
    resp = await cr.chat_stream(cr.ChatIn(message=DANGER_MSG, language="en", mode="pro"), user=pro_doc)
    raw = await _drain(resp)
    ev = _events(raw)
    assert llm_spy == [], llm_spy
    assert "112" in raw
    assert any(e.get("emergency") is True for e in ev)
    assert ev[0]["paywall_blocked"] is True
    assert await _state(pro_doc["id"]) == before


# ─────────── 4. exhausted Pro + bare distress ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_spy_exhausted_pro_distress(llm_spy, pro_doc):
    before = await _state(pro_doc["id"])
    resp = await cr.chat_stream(cr.ChatIn(message=DISTRESS_MSG, language="en", mode="pro"), user=pro_doc)
    raw = await _drain(resp)
    ev = _events(raw)
    assert llm_spy == [], llm_spy
    assert any(e.get("c1_sos") is True for e in ev)
    assert await _state(pro_doc["id"]) == before


# ─────────── 5 & 6. ordinary messages still hit the gates ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_spy_expired_guest_ordinary_401(llm_spy, guest_doc):
    before = await _state(guest_doc["id"])
    with pytest.raises(cr.HTTPException) as e:
        await cr.chat_stream(cr.ChatIn(message=ORDINARY_MSG, language="en", mode="pro"), user=guest_doc)
    assert e.value.status_code == 401
    assert e.value.detail["guest_expired"] is True
    assert llm_spy == []
    assert await _state(guest_doc["id"]) == before


@pytest.mark.asyncio(loop_scope="session")
async def test_spy_exhausted_pro_ordinary_402(llm_spy, pro_doc):
    before = await _state(pro_doc["id"])
    with pytest.raises(cr.HTTPException) as e:
        await cr.chat_stream(cr.ChatIn(message=ORDINARY_MSG, language="en", mode="pro"), user=pro_doc)
    assert e.value.status_code == 402
    assert e.value.detail["paywall"] is True
    assert llm_spy == []
    after = await _state(pro_doc["id"])
    # the pre-existing paywall audit log still fires for ordinary messages
    assert after["pro_samples_used"] == before["pro_samples_used"]
    assert after["blocked_paywall"] == before["blocked_paywall"] + 1


# ─────────── feature-flag preservation ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_c1_flag_off_distress_falls_through_to_401(llm_spy, guest_doc, monkeypatch):
    """With FEATURE_C1_CONVERSATIONAL_REPLIES off, bare distress is NOT a safety
    bypass (flag honoured) — but immediate danger still is."""
    monkeypatch.setattr(cr, "FEATURE_C1_CONVERSATIONAL_REPLIES", False)
    before = await _state(guest_doc["id"])
    with pytest.raises(cr.HTTPException) as e:
        await cr.chat_stream(cr.ChatIn(message=DISTRESS_MSG, language="en", mode="pro"), user=guest_doc)
    assert e.value.status_code == 401
    resp = await cr.chat_stream(cr.ChatIn(message=DANGER_MSG, language="en", mode="pro"), user=guest_doc)
    raw = await _drain(resp)
    assert "112" in raw
    assert llm_spy == []
    assert await _state(guest_doc["id"]) == before


# ─────────── B-04a (quota-exhausted guest) SSE shape preserved ───────────
@pytest.mark.asyncio(loop_scope="session")
async def test_b04a_guest_at_quota_sse_preserved(llm_spy):
    uid = f"TEST_spy_b04a_{int(time.time()*1000)}"
    doc = {
        "id": uid, "is_guest": True,
        "guest_expires_at": "2099-01-01T00:00:00+00:00",
        "guest_question_count": 5, "guest_question_limit": 5,
    }
    await db.users.insert_one(dict(doc))
    try:
        # danger → 112 banner
        raw = await _drain(await cr.chat_stream(cr.ChatIn(message=DANGER_MSG, language="en"), user=doc))
        assert "112" in raw and "guest_limit_reached" not in raw
        # bare distress → SOS
        raw = await _drain(await cr.chat_stream(cr.ChatIn(message=DISTRESS_MSG, language="en"), user=doc))
        assert any(e.get("c1_sos") is True for e in _events(raw))
        # ordinary → guest_limit_reached
        raw = await _drain(await cr.chat_stream(cr.ChatIn(message=ORDINARY_MSG, language="en"), user=doc))
        assert "guest_limit_reached" in raw
        assert llm_spy == []
        u = await db.users.find_one({"id": uid})
        assert int(u["guest_question_count"]) == 5
    finally:
        await db.users.delete_one({"id": uid})
        await db.messages.delete_many({"user_id": uid})
