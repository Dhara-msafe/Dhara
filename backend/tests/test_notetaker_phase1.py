"""
test_notetaker_phase1.py — Backend sanity tests for the Advocate Consultation
Notetaker (Phase 1 MVP), prefix /api/notetaker.

Covers: matters CRUD, consultations create/list/get, consent recording +
state transitions, manual-notes path, transcript-import path, note
generation (Claude Sonnet 5.5 - slow), note edit/approve, export, task
drafts, cancel, and 403 for non-advocate users.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
BASE_URL = BASE_URL.rstrip("/")

ADVOCATE_EMAIL = "voicetest2026@example.com"
ADVOCATE_PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def api():
    return requests.Session()


@pytest.fixture(scope="module")
def advocate_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADVOCATE_EMAIL, "password": ADVOCATE_PASSWORD,
    })
    if r.status_code != 200:
        pytest.skip(f"Advocate login failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if not token:
        pytest.skip(f"No token in login response: {data}")
    return token


@pytest.fixture(scope="module")
def auth_headers(advocate_token):
    return {"Authorization": f"Bearer {advocate_token}"}


# ── Non-advocate 403 check ─────────────────────────────────────────────────

class TestNonAdvocateAccess:
    def test_no_token_rejected(self, api):
        r = api.get(f"{BASE_URL}/api/notetaker/matters")
        assert r.status_code in (401, 403)

    def test_random_user_no_advocate_profile_gets_403(self, api):
        # Register a throwaway non-advocate user
        email = f"TEST_nt_nonadv_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "TestPass123!", "name": "TEST Nonadv",
            "phone": "9888877766", "terms_accepted": True,
        })
        if r.status_code not in (200, 201):
            pytest.skip(f"Could not register throwaway user: {r.status_code} {r.text[:200]}")
        data = r.json()
        token = data.get("access_token") or data.get("token")
        assert token, "Could not obtain token for throwaway non-advocate user"
        headers = {"Authorization": f"Bearer {token}"}
        r3 = api.get(f"{BASE_URL}/api/notetaker/matters", headers=headers)
        assert r3.status_code == 403, f"Expected 403 for non-advocate, got {r3.status_code}: {r3.text[:200]}"


# ── Matters ──────────────────────────────────────────────────────────────

class TestMatters:
    matter_id = None

    def test_create_matter(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={
            "title": "TEST_Matter_Phase1", "client_ref": "TEST-CLIENT-001",
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["title"] == "TEST_Matter_Phase1"
        assert data["client_ref"] == "TEST-CLIENT-001"
        assert "id" in data and "_id" not in data
        TestMatters.matter_id = data["id"]

    def test_list_matters_includes_created(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers)
        assert r.status_code == 200
        matters = r.json()
        ids = [m["id"] for m in matters]
        assert TestMatters.matter_id in ids

    def test_get_matter_by_id(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/notetaker/matters/{TestMatters.matter_id}", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == TestMatters.matter_id
        assert "consultation_count" in data

    def test_get_nonexistent_matter_404(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/notetaker/matters/{uuid.uuid4()}", headers=auth_headers)
        assert r.status_code == 404


# ── Full manual-notes consultation flow ─────────────────────────────────────

class TestManualFlow:
    matter_id = None
    consultation_id = None

    def test_setup_matter(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={
            "title": "TEST_Matter_Manual", "client_ref": None,
        })
        assert r.status_code == 201
        TestManualFlow.matter_id = r.json()["id"]

    def test_create_consultation(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestManualFlow.matter_id}/consultations",
            headers=auth_headers,
            json={
                "title": "TEST_Consult_Manual", "date": "2026-01-15",
                "purpose": "Domestic violence intake", "input_method": "manual",
                "language": None,
            },
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["state"] == "DRAFT"
        TestManualFlow.consultation_id = data["id"]

    def test_list_consultations(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/notetaker/matters/{TestManualFlow.matter_id}/consultations",
            headers=auth_headers,
        )
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()]
        assert TestManualFlow.consultation_id in ids

    def test_get_consultation(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["state"] == "DRAFT"

    def test_record_consent_given_transitions_to_ready(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/consent",
            headers=auth_headers,
            json={"participant_name": "TEST Client A", "participant_role": "client", "decision": "given"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["consultation_state"] == "READY"

    def test_list_consents(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/consent", headers=auth_headers)
        assert r.status_code == 200
        consents = r.json()
        assert len(consents) == 1
        assert consents[0]["decision"] == "given"

    def test_declined_required_participant_blocks_and_demotes(self, api, auth_headers):
        """BATCH N1-B: a decline on a *required* participant blocks the
        consultation and demotes it back to CONSENT_PENDING even though a
        different required participant ("TEST Client A") already granted —
        the old "any one grant is enough" behaviour was the bug this fixes."""
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/consent",
            headers=auth_headers,
            json={"participant_name": "TEST Witness B", "decision": "declined"},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["consultation_state"] == "CONSENT_PENDING"
        assert data["consent_summary"]["status"] == "blocked"

    def test_consent_granted_after_decline_restores_ready(self, api, auth_headers):
        """Re-consenting the previously-declined participant promotes the
        consultation back to READY (every required participant now given)."""
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/consent",
            headers=auth_headers,
            json={"participant_name": "TEST Witness B", "decision": "given"},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["consultation_state"] == "READY"
        assert data["consent_summary"]["status"] == "ready"

    def test_save_manual_notes_transitions_to_note_draft(self, api, auth_headers):
        notes = (
            "Client stated her husband has been physically abusive for the last 6 months. "
            "She wants to know how to file a domestic violence complaint. "
            "Advocate advised filing under the Protection of Women from Domestic Violence Act "
            "and recommended approaching the local police station. "
            "It is unclear whether there are prior police complaints. "
            "Next step: advocate to draft a complaint within one week."
        )
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/manual-notes",
            headers=auth_headers,
            json={"notes": notes},
        )
        assert r.status_code == 200, r.text
        assert r.json()["state"] == "NOTE_DRAFT"

    def test_generate_note_draft(self, api, auth_headers):
        """Calls Claude Sonnet 5.5 — can take 10-30s."""
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/note/generate",
            headers=auth_headers,
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sections" in data
        for key in ("facts_stated", "client_instructions", "advice_given", "open_uncertainties", "proposed_actions"):
            assert key in data["sections"], f"Missing section {key}"
        TestManualFlow.note_draft = data

    def test_update_note_edits(self, api, auth_headers):
        draft = TestManualFlow.note_draft
        sections = draft["sections"]
        if sections.get("facts_stated"):
            sections["facts_stated"][0]["text"] = "TEST_EDITED: " + sections["facts_stated"][0]["text"]
        r = api.patch(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/note",
            headers=auth_headers,
            json={"sections": sections},
        )
        assert r.status_code == 200, r.text

    def test_approve_note_transitions_to_approved(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/note/approve",
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["state"] == "APPROVED"
        assert "content_hash" in data

    def test_export_text(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/export?fmt=text",
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert "DHARA CONSULTATION NOTE" in r.text

    def test_create_task_drafts(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/tasks",
            headers=auth_headers,
            json={"action_indices": None},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert "tasks_created" in data

    def test_cannot_cancel_approved(self, api, auth_headers):
        r = api.patch(f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/cancel", headers=auth_headers)
        assert r.status_code == 409


# ── Transcript import flow ──────────────────────────────────────────────────

class TestTranscriptFlow:
    matter_id = None
    consultation_id = None

    def test_setup(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={"title": "TEST_Matter_Transcript"})
        assert r.status_code == 201
        TestTranscriptFlow.matter_id = r.json()["id"]
        r2 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestTranscriptFlow.matter_id}/consultations",
            headers=auth_headers,
            json={"title": "TEST_Consult_Transcript", "date": "2026-01-16", "purpose": "Transcript test", "input_method": "transcript_import"},
        )
        assert r2.status_code == 201
        TestTranscriptFlow.consultation_id = r2.json()["id"]

    def test_transcript_import_requires_consent_first(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestTranscriptFlow.consultation_id}/transcript",
            headers=auth_headers,
            json={"text": "Some transcript text"},
        )
        assert r.status_code == 409  # not READY yet

    def test_record_consent(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestTranscriptFlow.consultation_id}/consent",
            headers=auth_headers,
            json={"participant_name": "TEST Client C", "decision": "given"},
        )
        assert r.status_code == 201
        assert r.json()["consultation_state"] == "READY"

    def test_import_transcript_transitions_to_review(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestTranscriptFlow.consultation_id}/transcript",
            headers=auth_headers,
            json={"text": "Client: I need help with a property dispute. Advocate: Let's review the documents."},
        )
        assert r.status_code == 200
        assert r.json()["state"] == "TRANSCRIPT_REVIEW"

    def test_update_working_transcript(self, api, auth_headers):
        r = api.patch(
            f"{BASE_URL}/api/notetaker/consultations/{TestTranscriptFlow.consultation_id}/transcript",
            headers=auth_headers,
            json={"working_transcript": "TEST_EDITED transcript content for review."},
        )
        assert r.status_code == 200

    def test_approve_transcript_transitions_to_note_draft(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestTranscriptFlow.consultation_id}/transcript/approve",
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["state"] == "NOTE_DRAFT"


# ── Cancel flow ──────────────────────────────────────────────────────────

class TestCancelFlow:
    matter_id = None
    consultation_id = None

    def test_setup_and_cancel(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={"title": "TEST_Matter_Cancel"})
        assert r.status_code == 201
        matter_id = r.json()["id"]
        r2 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{matter_id}/consultations",
            headers=auth_headers,
            json={"title": "TEST_Consult_Cancel", "date": "2026-01-17", "purpose": "Throwaway", "input_method": "manual"},
        )
        assert r2.status_code == 201
        consultation_id = r2.json()["id"]
        r3 = api.patch(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/cancel", headers=auth_headers)
        assert r3.status_code == 200
        assert r3.json()["state"] == "CANCELLED"
        # verify persisted
        r4 = api.get(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}", headers=auth_headers)
        assert r4.json()["state"] == "CANCELLED"


# ── Ownership / 404 checks ─────────────────────────────────────────────────

class TestOwnership:
    def test_nonexistent_consultation_404(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/notetaker/consultations/{uuid.uuid4()}", headers=auth_headers)
        assert r.status_code == 404


# ── BATCH N1: unverified-advocate gating ────────────────────────────────────
# Founder decision (2026-11): AI drafting, note approval and export are
# blocked for advocates whose Bar Council profile is not yet verified.
# Manual note-taking/editing and local task drafts remain available
# regardless of verification status. This class uses a fresh throwaway
# advocate that is registered but deliberately left unverified (the
# advocate_profiles default), so it must NOT reuse the module-scoped
# verified `auth_headers` fixture above.

class TestUnverifiedAdvocateGating:
    matter_id = None
    consultation_id = None
    headers = None

    def test_setup_unverified_advocate(self, api):
        email = f"TEST_nt_unverified_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "TestPass123!", "name": "TEST Unverified Advocate",
            "phone": "9888800011", "terms_accepted": True,
        })
        if r.status_code not in (200, 201):
            pytest.skip(f"Could not register throwaway user: {r.status_code} {r.text[:200]}")
        data = r.json()
        token = data.get("access_token") or data.get("token")
        user_id = data.get("user", {}).get("id") or data.get("id")
        assert token
        headers = {"Authorization": f"Bearer {token}"}
        if not user_id:
            me = api.get(f"{BASE_URL}/api/auth/me", headers=headers)
            user_id = me.json().get("id") if me.status_code == 200 else None
        assert user_id, "Could not resolve new user's id"

        r2 = api.post(f"{BASE_URL}/api/advocate/register", headers=headers, json={
            "user_id": user_id, "bar_council_number": f"TEST/{uuid.uuid4().hex[:6]}/2026",
            "state_bar": "Bar Council of Delhi", "specializations": ["Family"],
        })
        assert r2.status_code == 200, r2.text
        assert r2.json()["verified"] is False, "A newly-registered advocate must start unverified"
        TestUnverifiedAdvocateGating.headers = headers

        r3 = api.post(f"{BASE_URL}/api/notetaker/matters", headers=headers, json={"title": "TEST_Matter_Unverified"})
        assert r3.status_code == 201
        TestUnverifiedAdvocateGating.matter_id = r3.json()["id"]
        r4 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestUnverifiedAdvocateGating.matter_id}/consultations",
            headers=headers,
            json={"title": "TEST_Consult_Unverified", "date": "2026-01-18", "purpose": "Unverified gating test", "input_method": "manual"},
        )
        assert r4.status_code == 201
        TestUnverifiedAdvocateGating.consultation_id = r4.json()["id"]

    def test_unverified_advocate_can_record_consent_and_manual_notes(self, api):
        h = TestUnverifiedAdvocateGating.headers
        cid = TestUnverifiedAdvocateGating.consultation_id
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=h,
                      json={"participant_name": "TEST Client Unverified", "decision": "given"})
        assert r.status_code == 201
        assert r.json()["consultation_state"] == "READY"

        r2 = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/manual-notes", headers=h,
                       json={"notes": "Manual notes saved before verification completes."})
        assert r2.status_code == 200
        assert r2.json()["state"] == "NOTE_DRAFT"

    def test_unverified_advocate_blocked_from_generate(self, api):
        h = TestUnverifiedAdvocateGating.headers
        cid = TestUnverifiedAdvocateGating.consultation_id
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/note/generate", headers=h)
        assert r.status_code == 403, r.text
        assert "verified" in r.json()["detail"].lower()

    def test_unverified_advocate_blocked_from_approve(self, api):
        h = TestUnverifiedAdvocateGating.headers
        cid = TestUnverifiedAdvocateGating.consultation_id
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/note/approve", headers=h)
        assert r.status_code == 403, r.text

    def test_unverified_advocate_blocked_from_export(self, api):
        h = TestUnverifiedAdvocateGating.headers
        cid = TestUnverifiedAdvocateGating.consultation_id
        r = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}/export?fmt=text", headers=h)
        assert r.status_code == 403, r.text

    def test_unverified_advocate_task_drafts_not_gated_by_verification(self, api):
        """Task-draft creation uses _require_advocate, not
        _require_verified_advocate — an unverified advocate gets a normal
        409 (no approved version) rather than a 403."""
        h = TestUnverifiedAdvocateGating.headers
        cid = TestUnverifiedAdvocateGating.consultation_id
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/tasks", headers=h, json={"action_indices": None})
        assert r.status_code == 409, r.text


# ── BATCH N1: idempotency ────────────────────────────────────────────────────

class TestIdempotency:
    matter_id = None

    def test_setup(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={"title": "TEST_Matter_Idempotency"})
        assert r.status_code == 201
        TestIdempotency.matter_id = r.json()["id"]

    def test_create_consultation_same_key_returns_same_record(self, api, auth_headers):
        key = f"TEST-idem-{uuid.uuid4().hex}"
        body = {"title": "TEST_Idem_Consult", "date": "2026-01-19", "purpose": "Idempotency check", "input_method": "manual"}
        r1 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestIdempotency.matter_id}/consultations",
            headers={**auth_headers, "Idempotency-Key": key}, json=body,
        )
        assert r1.status_code == 201
        r2 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestIdempotency.matter_id}/consultations",
            headers={**auth_headers, "Idempotency-Key": key}, json=body,
        )
        assert r2.status_code == 201
        assert r1.json()["id"] == r2.json()["id"], "A repeated Idempotency-Key must not create a second consultation"

    def test_record_consent_same_key_returns_same_record(self, api, auth_headers):
        r0 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestIdempotency.matter_id}/consultations",
            headers=auth_headers,
            json={"title": "TEST_Idem_Consent", "date": "2026-01-19", "purpose": "Idempotency check", "input_method": "manual"},
        )
        assert r0.status_code == 201
        consultation_id = r0.json()["id"]

        key = f"TEST-idem-consent-{uuid.uuid4().hex}"
        body = {"participant_name": "TEST Idem Client", "decision": "given"}
        r1 = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/consent",
            headers={**auth_headers, "Idempotency-Key": key}, json=body,
        )
        assert r1.status_code == 201
        r2 = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/consent",
            headers={**auth_headers, "Idempotency-Key": key}, json=body,
        )
        assert r2.status_code == 201
        assert r1.json()["id"] == r2.json()["id"], "A repeated Idempotency-Key must not create a second consent record"

        # confirm only one consent record actually persisted
        r3 = api.get(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/consent", headers=auth_headers)
        assert len(r3.json()) == 1

    def test_approve_note_is_idempotent_on_repeat_call(self, api, auth_headers):
        """Calling /note/approve again after APPROVED returns the same
        content_hash instead of erroring or recomputing it."""
        r0 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestIdempotency.matter_id}/consultations",
            headers=auth_headers,
            json={"title": "TEST_Idem_Approve", "date": "2026-01-19", "purpose": "Idempotency check", "input_method": "manual"},
        )
        consultation_id = r0.json()["id"]
        api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/consent", headers=auth_headers,
                  json={"participant_name": "TEST Idem Approve Client", "decision": "given"})
        api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/manual-notes", headers=auth_headers,
                  json={"notes": "Client needs help drafting a rent agreement. Advocate to send a draft by Friday."})
        gen = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/generate", headers=auth_headers, timeout=90)
        assert gen.status_code == 200, gen.text

        a1 = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/approve", headers=auth_headers)
        assert a1.status_code == 200, a1.text
        assert a1.json()["already_approved"] is False

        a2 = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/approve", headers=auth_headers)
        assert a2.status_code == 200, a2.text
        assert a2.json()["already_approved"] is True
        assert a2.json()["content_hash"] == a1.json()["content_hash"]
