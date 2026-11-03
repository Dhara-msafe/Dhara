"""Iteration 7 backend tests — Dhara/MSafe Legal Aid.

Focus: LLM answer language enforcement bug fix.
- Non-English languages (ta/hi/bn) must produce fully-translated answer bodies,
  section headings AND disclaimer — not just the trailing disclaimer.
- English selection must remain untouched (keeps 'Answer:' / 'What you can do:').
- Backwards compatibility: if the client omits `language_native`, backend derives
  it from the LANGUAGES table via the `language` code.
- sanitize_model_output() must strip markdown ** bolds from delivered content.
- Retrieval + citation SSE frames must still fire before content deltas.
"""
import json
import os
import re
import time

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://dhara-shield-2.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

# Existing free-tier user with 5 pro samples remaining (per test_credentials.md).
# We use BASIC mode for these tests so we don't consume the samples.
EXISTING_EMAIL = "protest@gandhikar.in"
EXISTING_PW = "test1234"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def auth_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": EXISTING_EMAIL, "password": EXISTING_PW},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return r.json()["token"]


@pytest.fixture()
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ---------- SSE helpers ----------
def _read_sse(resp, max_seconds=120):
    """Return list of parsed SSE JSON events."""
    events = []
    start = time.time()
    for raw in resp.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        if raw.startswith("data:"):
            try:
                events.append(json.loads(raw[5:].strip()))
            except Exception:
                pass
            if events and events[-1].get("type") in ("done", "error"):
                break
        if time.time() - start > max_seconds:
            break
    return events


def _assemble_body(events):
    """Assemble the final body text. If a `final` frame arrived it supersedes
    the concatenated `delta`s (that mirrors what the frontend does after
    sanitization)."""
    finals = [e.get("content", "") for e in events if e.get("type") == "final"]
    if finals:
        return finals[-1]
    return "".join(e.get("content", "") for e in events if e.get("type") == "delta")


def _post_chat(headers, message, language_code, language_name, language_native=None, mode="basic"):
    payload = {
        "message": message,
        "language": language_code,
        "language_name": language_name,
        "mode": mode,
    }
    if language_native is not None:
        payload["language_native"] = language_native
    return requests.post(
        f"{API}/chat/stream",
        json=payload,
        headers=headers,
        stream=True,
        timeout=180,
    )


# Unicode script ranges for the three target languages
TAMIL_RE = re.compile(r"[\u0B80-\u0BFF]")
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
BENGALI_RE = re.compile(r"[\u0980-\u09FF]")

ENGLISH_HEADING_LITERALS = ("Answer:", "What you can do:")


def _no_english_heading_in_prefix(body: str, prefix_len: int = 120) -> bool:
    """The first prefix_len chars must not contain the English literals."""
    head = body[:prefix_len]
    return all(lit not in head for lit in ENGLISH_HEADING_LITERALS)


# ---------- Health / sanity ----------
def test_health_ok():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_languages_includes_targets():
    r = requests.get(f"{API}/reference/languages", timeout=15)
    assert r.status_code == 200
    langs = {L["code"]: L for L in r.json()}
    for code, native in (("ta", "தமிழ்"), ("hi", "हिन्दी"), ("bn", "বাংলা"), ("en", "English")):
        assert code in langs, f"language code {code} missing"
        assert langs[code]["native"] == native, langs[code]


# ---------- Language enforcement: Tamil ----------
def test_tamil_full_body_in_tamil(auth_headers):
    """Answer body, headings AND disclaimer must all be in Tamil script."""
    with _post_chat(
        auth_headers,
        "What are my rights during a police stop in India?",
        language_code="ta",
        language_name="Tamil",
        language_native="தமிழ்",
        mode="basic",
    ) as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=120)

    # Session frame present + at least one citation frame BEFORE first delta
    types = [e.get("type") for e in events]
    assert "session" in types, types
    assert "delta" in types or "final" in types, types
    if "citation" in types:
        first_citation_idx = types.index("citation")
        first_delta_idx = types.index("delta") if "delta" in types else len(types)
        assert first_citation_idx < first_delta_idx, (
            "citation frames must precede delta frames"
        )

    body = _assemble_body(events)
    assert len(body) > 40, f"body too short: {body!r}"

    # 1. First 120 chars must NOT contain the English heading literals
    assert _no_english_heading_in_prefix(body), (
        f"English heading literal leaked into Tamil reply head: {body[:200]!r}"
    )

    # 2. Body must contain Tamil script (majority language check)
    tamil_chars = TAMIL_RE.findall(body)
    assert len(tamil_chars) >= 30, (
        f"Expected >=30 Tamil chars in reply, got {len(tamil_chars)}. "
        f"Head: {body[:300]!r}"
    )

    # 3. No stray markdown ** bold survives sanitization
    assert "**" not in body, f"** bold leaked after sanitize: {body[:400]!r}"

    # 4. Disclaimer line contains Tamil script (last 300 chars)
    tail = body[-400:]
    assert TAMIL_RE.search(tail), f"Tail (disclaimer area) has no Tamil: {tail!r}"


# ---------- Language enforcement: Hindi ----------
def test_hindi_full_body_in_devanagari(auth_headers):
    with _post_chat(
        auth_headers,
        "How do I file an FIR?",
        language_code="hi",
        language_name="Hindi",
        language_native="हिन्दी",
        mode="basic",
    ) as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=120)

    body = _assemble_body(events)
    assert len(body) > 40, f"body too short: {body!r}"
    assert _no_english_heading_in_prefix(body), (
        f"English heading literal leaked into Hindi reply head: {body[:200]!r}"
    )
    devanagari_chars = DEVANAGARI_RE.findall(body)
    assert len(devanagari_chars) >= 30, (
        f"Expected >=30 Devanagari chars, got {len(devanagari_chars)}. "
        f"Head: {body[:300]!r}"
    )
    assert "**" not in body, f"** bold leaked: {body[:400]!r}"
    assert DEVANAGARI_RE.search(body[-400:]), "Tail disclaimer not in Devanagari"


# ---------- Language enforcement: Bengali ----------
def test_bengali_full_body_in_bengali(auth_headers):
    with _post_chat(
        auth_headers,
        "What is the RTI Act and how do I use it?",
        language_code="bn",
        language_name="Bengali",
        language_native="বাংলা",
        mode="basic",
    ) as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=120)

    body = _assemble_body(events)
    assert len(body) > 40, f"body too short: {body!r}"
    assert _no_english_heading_in_prefix(body), (
        f"English heading literal leaked into Bengali reply head: {body[:200]!r}"
    )
    bengali_chars = BENGALI_RE.findall(body)
    assert len(bengali_chars) >= 30, (
        f"Expected >=30 Bengali chars, got {len(bengali_chars)}. "
        f"Head: {body[:300]!r}"
    )
    assert "**" not in body, f"** bold leaked: {body[:400]!r}"
    assert BENGALI_RE.search(body[-400:]), "Tail disclaimer not in Bengali"


# ---------- English still works exactly as before ----------
def test_english_keeps_english_headings(auth_headers):
    with _post_chat(
        auth_headers,
        "What are my rights during a police stop?",
        language_code="en",
        language_name="English",
        language_native="English",
        mode="basic",
    ) as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=120)

    body = _assemble_body(events)
    assert len(body) > 40, f"body too short: {body!r}"
    # English heading MUST be present in the head
    head = body[:400]
    assert "Answer:" in head, f"English 'Answer:' heading missing in head: {head!r}"
    # 'What you can do:' should appear somewhere in the body
    assert "What you can do:" in body, "English 'What you can do:' heading missing"
    # No stray Indic script in an English reply
    assert not TAMIL_RE.search(body), "Tamil chars leaked into English reply"
    assert not DEVANAGARI_RE.search(body), "Devanagari leaked into English reply"
    # No ** leaks
    assert "**" not in body, f"** bold leaked: {body[:400]!r}"


# ---------- Backwards compatibility: language_native omitted ----------
def test_backward_compat_language_native_derived_from_table(auth_headers):
    """Older clients that don't send language_native. Backend must derive it
    from the LANGUAGES table via the language code and still produce a Tamil
    body."""
    with _post_chat(
        auth_headers,
        "How do I file an FIR?",
        language_code="ta",
        language_name="Tamil",
        language_native=None,  # explicitly omitted
        mode="basic",
    ) as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=120)

    body = _assemble_body(events)
    assert len(body) > 40, f"body too short: {body!r}"
    assert _no_english_heading_in_prefix(body), (
        f"English literal leaked when language_native omitted: {body[:200]!r}"
    )
    tamil_chars = TAMIL_RE.findall(body)
    assert len(tamil_chars) >= 30, (
        f"Backwards-compat path did not produce Tamil script "
        f"(got {len(tamil_chars)} Tamil chars). Head: {body[:300]!r}"
    )


# ---------- Citation frames still fire before deltas regardless of language ----------
def test_citations_present_and_precede_deltas(auth_headers):
    with _post_chat(
        auth_headers,
        "What are my rights when arrested?",
        language_code="ta",
        language_name="Tamil",
        language_native="தமிழ்",
        mode="basic",
    ) as r:
        assert r.status_code == 200, r.text
        events = _read_sse(r, max_seconds=120)

    types = [e.get("type") for e in events]
    assert "citation" in types, (
        f"No citation frames emitted for arrest-rights query in Tamil: {types}"
    )
    first_citation_idx = types.index("citation")
    # Contract since the Phase-1 citation-after-answer gate (18e7881): with
    # CITATION_GUARD_ENABLED the answer is BUFFERED and released as one
    # "final" frame after the output guard passes; citations follow it.
    # Without the guard, streamed "delta" frames precede citations.
    content_types = [t for t in types if t in ("delta", "final")]
    assert content_types, f"No answer content frames emitted at all: {types}"
    first_content_idx = types.index(content_types[0])
    if os.environ.get("CITATION_GUARD_ENABLED", "true").lower() == "true":
        assert "final" in types, f"guard ON: expected buffered final frame: {types}"
        assert first_content_idx < first_citation_idx, (
            f"guard ON: citations ({first_citation_idx}) must follow the answer ({first_content_idx})")
    else:
        assert first_citation_idx < first_content_idx
    # Citation payload sanity
    cit_events = [e for e in events if e.get("type") == "citation"]
    for c in cit_events:
        cit = c.get("citation") or {}
        assert cit.get("short_label"), f"citation missing short_label: {c}"
