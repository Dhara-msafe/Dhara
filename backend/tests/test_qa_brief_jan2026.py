"""
QA Brief (Jan 2026) — Priority 1-5 regression for bharti-justice preview.

Covers:
  P1 — Guest mode: start session, Ask DHARA access, 5-question limit enforcement
  P3 — Registration & consent: field validation, backend password min-length
       enforcement (not just frontend hint), consent (terms_accepted) requirement
  P4 — Legal-Truth regression via /api/chat/stream (SSE):
       (a) IPC 166A -> BNS supersession  (b) Hindu-law divorce
       (c) IT Act 66A -> must NOT be presented as valid/current law
       (d) stridhan / women's property rights
       (e) journalist-vs-organizer actor-conduct classification (two prompts
           must get DIFFERENT guidance)
  General — CITATION_GUARD_ENABLED=true regression: citations arrive via SSE
       'final'/'citation' events, no duplicates, no literal "Verified" suffix
       badge text in any citation field (banned-word check).

Run: pytest /app/backend/tests/test_qa_brief_jan2026.py -v --tb=short \
     --junitxml=/app/test_reports/pytest/iteration_qa_brief.xml
"""
import json
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback for local backend-only verification when EXPO_BACKEND_URL
    # is not exported in this shell (frontend/.env uses EXPO_PUBLIC_BACKEND_URL)
    BASE_URL = "http://localhost:8001"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _sse_events(resp):
    """Parse a text/event-stream response body into a list of dict events."""
    events = []
    buf = ""
    for line in resp.iter_lines(decode_unicode=True):
        if line is None:
            continue
        if line.startswith("data: "):
            payload = line[len("data: "):]
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
    return events


def _ask(api_client, token, message, mode="basic", session_id=None):
    r = api_client.post(
        f"{BASE_URL}/api/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "message": message,
            "language": "en",
            "language_name": "English",
            "mode": mode,
            **({"session_id": session_id} if session_id else {}),
        },
        stream=True,
        timeout=60,
    )
    return r, _sse_events(r)


# ───────────────────────── P1: Guest mode ─────────────────────────

class TestGuestMode:
    def test_guest_session_creation(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and data["token"]
        user = data["user"]
        assert user.get("is_guest") is True
        assert user.get("guest_question_limit") == 5
        assert user.get("guest_question_count") == 0

    def test_guest_ask_dhara_access_and_five_question_limit(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"})
        assert r.status_code == 200
        token = r.json()["token"]
        session_id = str(uuid.uuid4())

        questions = [
            "What is IPC Section 166A?",
            "What are my rights if arrested?",
            "What is stridhan?",
            "What is the fine for not wearing a helmet?",
            "What is Section 125 CrPC about maintenance?",
        ]
        for i, q in enumerate(questions, start=1):
            resp, events = _ask(api_client, token, q, session_id=session_id)
            assert resp.status_code == 200, f"Q{i} failed: {resp.text}"
            session_evt = next((e for e in events if e.get("type") == "session"), None)
            assert session_evt is not None, f"Q{i}: no session event — guest flow broken"
            assert session_evt.get("guest") is True
            assert session_evt.get("guest_question_count") == i, (
                f"Q{i}: expected guest_question_count={i}, got {session_evt.get('guest_question_count')}"
            )
            done_evt = next((e for e in events if e.get("type") == "done"), None)
            assert done_evt is not None, f"Q{i}: stream did not terminate with 'done'"

        # 6th question must be BLOCKED, not answered
        resp6, events6 = _ask(api_client, token, "What is dowry?", session_id=session_id)
        assert resp6.status_code == 200
        limit_evt = next((e for e in events6 if e.get("type") == "guest_limit_reached"), None)
        assert limit_evt is not None, (
            "6th guest question was NOT blocked — guest 5-question limit not enforced! "
            f"Events received: {events6}"
        )
        delta_evts = [e for e in events6 if e.get("type") == "delta"]
        assert not delta_evts, "6th guest question returned an LLM answer instead of being blocked"

    def test_guest_me_endpoint_reports_quota(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/guest", json={"language": "en"})
        token = r.json()["token"]
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        data = me.json()
        assert data["is_guest"] is True
        assert data["guest_question_limit"] == 5
        assert data["guest_question_count"] == 0


# ───────────────────── P3: Registration & consent ─────────────────────

class TestRegistrationConsent:
    def test_password_below_six_chars_rejected_by_backend(self, api_client):
        """Frontend shows a 6-char minimum hint — backend must ACTUALLY enforce it,
        not just rely on the frontend's client-side check."""
        payload = {
            "email": f"TEST_shortpw_{uuid.uuid4().hex[:8]}@example.com",
            "password": "abc12",  # 5 chars
            "name": "Test Shortpw",
            "phone": "9876500001",
            "terms_accepted": True,
            "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 422, (
            f"Backend accepted a 5-character password (expected 422 validation error): {r.status_code} {r.text}"
        )

    def test_password_exactly_six_chars_accepted(self, api_client):
        payload = {
            "email": f"TEST_sixpw_{uuid.uuid4().hex[:8]}@example.com",
            "password": "abc123",  # exactly 6 chars
            "name": "Test Sixpw",
            "phone": "9876500002",
            "terms_accepted": True,
            "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 200, f"6-char password should be accepted: {r.text}"

    def test_registration_without_consent_rejected(self, api_client):
        payload = {
            "email": f"TEST_noconsent_{uuid.uuid4().hex[:8]}@example.com",
            "password": "abc123",
            "name": "Test NoConsent",
            "phone": "9876500003",
            "terms_accepted": False,
            "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 400, (
            f"Backend must reject registration when terms_accepted=False (consent is mandatory): "
            f"got {r.status_code} {r.text}"
        )

    def test_registration_duplicate_email_rejected(self, api_client):
        email = f"TEST_dup_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email, "password": "abc123", "name": "Dup One",
            "phone": "9876500004", "terms_accepted": True, "terms_version": "1.0",
        }
        r1 = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r1.status_code == 200
        r2 = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r2.status_code == 400

    def test_full_fictional_registration_then_login(self, api_client):
        """Create → login → verify persistence (Create->GET pattern)."""
        email = f"TEST_fictional_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email, "password": "FictionalPass123", "name": "Fictional Tester",
            "phone": "9876500005", "terms_accepted": True, "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 200
        token = r.json()["token"]
        login = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "FictionalPass123"})
        assert login.status_code == 200
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == email.lower()


# ───────────────────── P4: Legal-Truth regression ─────────────────────

class TestLegalTruthRegression:

    def _registered_token(self, api_client):
        email = f"TEST_legaltruth_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email, "password": "LegalTruth123", "name": "Legal Truth Tester",
            "phone": "9876500006", "terms_accepted": True, "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 200
        return r.json()["token"]

    def test_ipc_166a_reflects_bns_supersession(self, api_client):
        token = self._registered_token(api_client)
        resp, events = _ask(api_client, token, "What is IPC Section 166A? Is it still valid law?")
        assert resp.status_code == 200
        full_text = "".join(e.get("content", "") for e in events if e.get("type") in ("delta", "final"))
        citations = [e["citation"] for e in events if e.get("type") == "citation"]
        combined = (full_text + " " + json.dumps(citations)).lower()
        # Must NOT present IPC 166A as current/active law without mentioning BNS/supersession
        mentions_bns_or_superseded = any(
            kw in combined for kw in ["bns", "superseded", "repealed", "no longer in force", "replaced"]
        )
        assert mentions_bns_or_superseded, (
            f"IPC 166A query did not mention BNS supersession/repeal — "
            f"risk of presenting dead IPC law as current. Answer: {full_text[:500]} | Citations: {citations}"
        )

    def test_it_act_66a_not_presented_as_valid_law(self, api_client):
        token = self._registered_token(api_client)
        resp, events = _ask(api_client, token, "What is Section 66A of the IT Act and can police arrest me under it?")
        assert resp.status_code == 200
        full_text = "".join(e.get("content", "") for e in events if e.get("type") in ("delta", "final"))
        citations = [e["citation"] for e in events if e.get("type") == "citation"]
        combined = (full_text + " " + json.dumps(citations)).lower()
        struck_down_markers = any(
            kw in combined for kw in [
                "struck down", "unconstitutional", "shreya singhal", "void", "no longer valid",
                "not enforceable", "cannot be invoked", "cannot be used",
            ]
        )
        assert struck_down_markers, (
            "IT Act 66A query did NOT flag it as struck down/unconstitutional (Shreya Singhal v UOI 2015) — "
            f"risk of presenting dead law as enforceable. Answer: {full_text[:500]} | Citations: {citations}"
        )

    def test_hindu_law_divorce_query_answered(self, api_client):
        token = self._registered_token(api_client)
        resp, events = _ask(api_client, token, "I am a Hindu woman, my husband wants a divorce. What are my rights?")
        assert resp.status_code == 200
        full_text = "".join(e.get("content", "") for e in events if e.get("type") in ("delta", "final"))
        done = next((e for e in events if e.get("type") == "done"), None)
        assert done is not None
        assert len(full_text.strip()) > 0 or any(
            e.get("type") in ("state_prompt", "state_note") for e in events
        ), "Divorce query produced no answer and no disambiguation/state prompt"

    def test_stridhan_query_answered(self, api_client):
        token = self._registered_token(api_client)
        resp, events = _ask(api_client, token, "What is stridhan and can my husband's family claim it?")
        assert resp.status_code == 200
        full_text = "".join(e.get("content", "") for e in events if e.get("type") in ("delta", "final"))
        assert len(full_text.strip()) > 0, "Stridhan query produced an empty answer"

    def test_journalist_vs_organizer_get_different_guidance(self, api_client):
        token = self._registered_token(api_client)
        r1, events1 = _ask(
            api_client, token,
            "I am a journalist covering a protest, what are my rights if police detain me?",
        )
        r2, events2 = _ask(
            api_client, token,
            "I am organizing a protest, what permissions do I need?",
        )
        assert r1.status_code == 200 and r2.status_code == 200
        text1 = "".join(e.get("content", "") for e in events1 if e.get("type") in ("delta", "final")).strip().lower()
        text2 = "".join(e.get("content", "") for e in events2 if e.get("type") in ("delta", "final")).strip().lower()
        assert text1, "Journalist-detained query produced no answer"
        assert text2, "Protest-organizer query produced no answer"
        assert text1 != text2, "Journalist and organizer prompts returned IDENTICAL answers — actor-conduct classifier not distinguishing roles"


# ───────────────── General: CITATION_GUARD_ENABLED regression ─────────────────

class TestCitationGuardRegression:
    def test_citation_rendering_no_missing_or_duplicate_cards(self, api_client):
        email = f"TEST_citguard_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email, "password": "CitGuard123", "name": "Cit Guard",
            "phone": "9876500007", "terms_accepted": True, "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        token = r.json()["token"]
        resp, events = _ask(api_client, token, "What are my rights if arrested by police in India?")
        assert resp.status_code == 200
        final_or_delta = [e for e in events if e.get("type") in ("delta", "final")]
        assert final_or_delta, "No answer content received at all — citation guard may be swallowing the answer"
        citation_events = [e for e in events if e.get("type") == "citation"]
        keys = [c["citation"].get("key") for c in citation_events]
        assert len(keys) == len(set(keys)), f"Duplicate citation cards detected: {keys}"
        done = next((e for e in events if e.get("type") == "done"), None)
        assert done is not None, "Stream never completed with 'done' event"

    def test_no_literal_verified_suffix_badge_in_citation_fields(self, api_client):
        """Banned-word regression: no citation field should show a bare 'Verified'
        suffix next to a short label (separate from the already-renamed
        'Advocate Verified' -> 'Advocate Reviewed' badge)."""
        email = f"TEST_noverified_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email, "password": "NoVerified123", "name": "No Verified",
            "phone": "9876500008", "terms_accepted": True, "terms_version": "1.0",
        }
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload)
        token = r.json()["token"]
        resp, events = _ask(api_client, token, "What are my rights if arrested by police in India?")
        assert resp.status_code == 200
        citation_events = [e for e in events if e.get("type") == "citation"]
        for c in citation_events:
            cit = c["citation"]
            for field in ("short_label", "verified_at", "citation", "key"):
                val = str(cit.get(field) or "")
                assert val.strip().lower() != "verified", (
                    f"Citation field '{field}' is literally 'Verified' — banned-word violation: {cit}"
                )
                assert not val.strip().endswith(" Verified"), (
                    f"Citation field '{field}' ends with ' Verified' suffix — banned-word violation: {cit}"
                )
