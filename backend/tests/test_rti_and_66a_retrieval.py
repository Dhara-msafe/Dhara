"""WAVE stabilization — RTI section-aware retrieval (T2) and IT Act §66A
struck-down status (T3) regression.

Covers the acceptance criteria:
  * RTI Sections 3, 6, 18, 19 — both EXPLICIT section-number queries and
    queries that DESCRIBE the section without naming its number.
  * IT Act §66A — direct, indirect and historical questions must all flag it
    as struck down (Shreya Singhal v. Union of India, 2015).
  * IPC §166A control — the §66A guard must NOT hijack a different provision.

Legal wording is routed from the existing sourced corpus / status registry and
remains PENDING qualified advocate approval — these tests only assert routing
and status framing, never that the content is legally approved.
"""
import json
import os
import re
from pathlib import Path

import pytest
import requests


def _base_url() -> str:
    envp = Path("/app/frontend/.env")
    if envp.exists():
        for line in envp.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    return (os.environ.get("EXPO_BACKEND_URL") or "http://localhost:8001").rstrip("/")


BASE = _base_url()
EMAIL = "protest@gandhikar.in"
PWD = "test1234"

STRUCK_DOWN_MARKERS = [
    "struck down", "unconstitutional", "shreya singhal", "void", "no longer valid",
    "not enforceable", "cannot be invoked", "cannot be used",
]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _stream(token, msg):
    """Return (citation_labels[], full_text)."""
    r = requests.post(
        f"{BASE}/api/chat/stream",
        json={"message": msg, "session_id": None, "language": "en",
              "language_name": "English", "mode": "basic"},
        headers={"Authorization": f"Bearer {token}"},
        stream=True, timeout=90,
    )
    assert r.status_code == 200, f"{msg}: {r.status_code} {r.text[:200]}"
    labels, full = [], ""
    for raw in r.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue
        try:
            ev = json.loads(raw[5:].strip())
        except Exception:
            continue
        t = ev.get("type")
        if t == "citation":
            lab = ev.get("short_label")
            if not lab:
                cit = ev.get("citation")
                lab = cit.get("short_label") if isinstance(cit, dict) else str(cit)
            labels.append(lab or "")
        elif t in ("delta", "final"):
            full += ev.get("content", "")
    return labels, full


# ── T2: RTI explicit section-number queries ──────────────────────────────────
@pytest.mark.parametrize("query,pat", [
    ("What is RTI Section 3",                       r"RTI\s*3|Section\s*3|§\s*3"),
    ("Explain Section 6 of the RTI Act",            r"RTI\s*6|Section\s*6|§\s*6"),
    ("What does RTI Section 18 say",                r"RTI\s*18|Section\s*18|§\s*18"),
    ("Tell me about RTI Section 19",                r"RTI\s*19|Section\s*19|§\s*19"),
])
def test_rti_explicit_section_number(token, query, pat):
    labels, _ = _stream(token, query)
    joined = " | ".join(labels)
    assert re.search(pat, joined, re.I), f"{query!r}: expected {pat}, got {labels}"


# ── T2: RTI described-without-number queries ─────────────────────────────────
@pytest.mark.parametrize("query,accept", [
    ("how do I complain if my RTI is ignored",   ["RTI 18", "RTI 19", "RTI 20"]),
    ("my RTI was rejected on privacy grounds",   ["RTI 8", "RTI 19"]),
    ("how do I file a request for information from a government office",
                                                 ["RTI 6"]),
])
def test_rti_described_without_number(token, query, accept):
    labels, _ = _stream(token, query)
    assert any(a in labels for a in accept), f"{query!r}: expected one of {accept}, got {labels}"


# ── T3: IT Act §66A struck-down status (direct / indirect / historical) ──────
@pytest.mark.parametrize("query", [
    "What is Section 66A of the IT Act and can police arrest me under it?",  # direct
    "can I be arrested under section 66A for a facebook post",               # indirect
    "what was the punishment under section 66-A of the IT Act",              # historical
])
def test_it_66a_flagged_struck_down(token, query):
    labels, full = _stream(token, query)
    combined = (full + " " + json.dumps(labels)).lower()
    assert any(m in combined for m in STRUCK_DOWN_MARKERS), \
        f"{query!r}: §66A not flagged struck down. answer={full[:300]!r}"
    assert "shreya singhal" in combined, f"{query!r}: missing Shreya Singhal citation"


def test_it_66a_does_not_fabricate_replacement_punishment(token):
    _, full = _stream(token, "what was the punishment under section 66-A of the IT Act")
    low = full.lower()
    # Must not assert a specific current jail term / fine as the §66A punishment.
    assert not re.search(r"\b(punishable with|imprisonment (of|up to|for)|rigorous imprisonment)\b", low), \
        f"§66A answer appears to state a punishment as current law: {full[:300]!r}"


def test_ipc_166a_control_not_hijacked_by_66a_guard(token):
    """IPC §166A is a different provision (BNS supersession path) — the §66A
    struck-down guard must not fire for it."""
    labels, full = _stream(token, "What is IPC Section 166A? Is it still valid law?")
    combined = (full + " " + json.dumps(labels)).lower()
    assert "shreya singhal" not in combined, "IPC 166A wrongly routed to the §66A struck-down notice"
