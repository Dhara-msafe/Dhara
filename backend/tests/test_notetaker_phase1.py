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
from pymongo import MongoClient

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
            json={"sections": sections, "expected_version": draft["version"]},
        )
        assert r.status_code == 200, r.text
        new_draft = r.json()["note_draft"]
        assert new_draft["version"] == draft["version"] + 1
        TestManualFlow.note_draft = new_draft

    def test_approve_note_transitions_to_approved(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestManualFlow.consultation_id}/note/approve",
            headers=auth_headers,
            json={"expected_version": TestManualFlow.note_draft["version"]},
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
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/note/approve", headers=h, json={"expected_version": 1})
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

        a1 = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/approve", headers=auth_headers,
                       json={"expected_version": gen.json()["version"]})
        assert a1.status_code == 200, a1.text
        assert a1.json()["already_approved"] is False

        a2 = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/approve", headers=auth_headers,
                       json={"expected_version": gen.json()["version"]})
        assert a2.status_code == 200, a2.text
        assert a2.json()["already_approved"] is True
        assert a2.json()["content_hash"] == a1.json()["content_hash"]


# ── BATCH N1-B2: consent gaps (unknown outcome, scope/version/evidence,
#    withdrawal, audit) ──────────────────────────────────────────────────────
# Tests requested verbatim: declined-only blocks; granted plus declined
# blocks; granted plus unknown blocks; all granted proceeds; withdrawal
# halts the next step and is audited.

class TestConsentBatchN1B2:
    matter_id = None

    def test_setup(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={"title": "TEST_Matter_ConsentN1B2"})
        assert r.status_code == 201
        TestConsentBatchN1B2.matter_id = r.json()["id"]

    def _new_consultation(self, api, auth_headers, title):
        r = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestConsentBatchN1B2.matter_id}/consultations",
            headers=auth_headers,
            json={"title": title, "date": "2026-02-01", "purpose": "N1-B2 consent test", "input_method": "manual"},
        )
        assert r.status_code == 201
        return r.json()["id"]

    def test_declined_only_blocks(self, api, auth_headers):
        cid = self._new_consultation(api, auth_headers, "TEST_Consult_DeclinedOnly")
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                      json={"participant_name": "TEST Solo Participant", "decision": "declined"})
        assert r.status_code == 201
        assert r.json()["consultation_state"] == "CONSENT_PENDING"
        assert r.json()["consent_summary"]["status"] == "blocked"

    def test_granted_plus_declined_blocks(self, api, auth_headers):
        cid = self._new_consultation(api, auth_headers, "TEST_Consult_GrantedDeclined")
        api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                  json={"participant_name": "TEST Client Granted", "decision": "given"})
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                      json={"participant_name": "TEST Witness Declined", "decision": "declined"})
        assert r.status_code == 201
        assert r.json()["consultation_state"] == "CONSENT_PENDING"
        assert r.json()["consent_summary"]["status"] == "blocked"

    def test_granted_plus_unknown_blocks(self, api, auth_headers):
        cid = self._new_consultation(api, auth_headers, "TEST_Consult_GrantedUnknown")
        api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                  json={"participant_name": "TEST Client Granted2", "decision": "given"})
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                      json={"participant_name": "TEST Witness Unknown", "decision": "unknown"})
        assert r.status_code == 201
        assert r.json()["consultation_state"] == "CONSENT_PENDING"
        assert r.json()["consent_summary"]["status"] == "blocked"
        assert r.json()["consent_summary"]["unknown"] == 1

    def test_all_granted_proceeds(self, api, auth_headers):
        cid = self._new_consultation(api, auth_headers, "TEST_Consult_AllGranted")
        api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                  json={"participant_name": "TEST Client AllGranted1", "decision": "given"})
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                      json={"participant_name": "TEST Witness AllGranted2", "decision": "given"})
        assert r.status_code == 201
        assert r.json()["consultation_state"] == "READY"
        assert r.json()["consent_summary"]["status"] == "ready"

    def test_consent_record_stores_scope_version_and_evidence(self, api, auth_headers):
        cid = self._new_consultation(api, auth_headers, "TEST_Consult_ScopeFields")
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                      json={
                          "participant_name": "TEST Client Scope", "decision": "given",
                          "scope": ["notes", "audio", "storage"],
                          "consent_notice_version": "v2",
                          "evidence_ref": "Signed form filed as Exhibit A",
                      })
        assert r.status_code == 201
        listing = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers)
        rec = listing.json()[0]
        assert rec["scope"] == ["notes", "audio", "storage"]
        assert rec["consent_notice_version"] == "v2"
        assert rec["evidence_ref"] == "Signed form filed as Exhibit A"

    def test_withdrawal_halts_next_step_and_is_audited(self, api, auth_headers):
        cid = self._new_consultation(api, auth_headers, "TEST_Consult_Withdraw")
        api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent", headers=auth_headers,
                  json={"participant_name": "TEST Client Withdraw", "decision": "given"})
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/consent/withdraw", headers=auth_headers,
                      json={"participant_name": "TEST Client Withdraw"})
        assert r.status_code == 201, r.text
        assert r.json()["consultation_state"] == "CONSENT_WITHDRAWN"
        assert r.json()["retention_policy"] == "not_configured"

        # halts the next step — manual notes can no longer be captured
        r2 = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/manual-notes", headers=auth_headers,
                       json={"notes": "Should not be allowed."})
        assert r2.status_code == 409

        get_doc = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}", headers=auth_headers)
        assert get_doc.json()["state"] == "CONSENT_WITHDRAWN"

        # audited
        client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
        dbh = client[os.environ.get("DB_NAME", "")]
        audit = dbh.nt_consent_audit.find_one({"consultation_id": cid, "event": "consent_withdrawn"})
        client.close()
        assert audit is not None, "Withdrawal must write an audit event"
        assert audit["participant_name"] == "TEST Client Withdraw"


# ── BATCH N2: versioning and approved-note handling ──────────────────────────

class TestVersioningBatchN2:
    matter_id = None
    consultation_id = None

    def test_setup(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={"title": "TEST_Matter_N2"})
        assert r.status_code == 201
        TestVersioningBatchN2.matter_id = r.json()["id"]
        r2 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestVersioningBatchN2.matter_id}/consultations",
            headers=auth_headers,
            json={"title": "TEST_Consult_N2", "date": "2026-02-02", "purpose": "N2 versioning test", "input_method": "manual"},
        )
        assert r2.status_code == 201
        TestVersioningBatchN2.consultation_id = r2.json()["id"]
        api.post(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/consent",
                 headers=auth_headers, json={"participant_name": "TEST Client N2", "decision": "given"})
        notes = (
            "Client reports a dispute with a contractor over unfinished renovation work. "
            "Advocate advised sending a legal notice demanding completion within 15 days. "
            "It is unclear whether a written contract exists. "
            "Next step: advocate to draft the legal notice this week."
        )
        api.post(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/manual-notes",
                 headers=auth_headers, json={"notes": notes})

    def test_generate_v1(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/note/generate",
                      headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["version"] == 1
        assert data["source"] == "generated"
        assert data["approved"] is False
        for item in data["sections"].get("facts_stated", []):
            assert item["provenance"] == "generated"
            assert item.get("generated_text") is None
        TestVersioningBatchN2.v1 = data

    def test_edit_save_reload_keeps_v2(self, api, auth_headers):
        v1 = TestVersioningBatchN2.v1
        sections = v1["sections"]
        original_text = None
        if sections.get("facts_stated"):
            original_text = sections["facts_stated"][0]["text"]
            sections["facts_stated"][0]["text"] = "TEST_EDITED_N2: " + original_text
        r = api.patch(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/note",
            headers=auth_headers, json={"sections": sections, "expected_version": 1},
        )
        assert r.status_code == 200, r.text
        v2 = r.json()["note_draft"]
        assert v2["version"] == 2
        assert v2["parent_version"] == 1
        assert v2["source"] == "edit"
        assert v2["author_id"]
        assert v2["diff_summary"]
        if original_text is not None:
            edited_item = v2["sections"]["facts_stated"][0]
            assert edited_item["provenance"] == "edited"
            assert edited_item["generated_text"] == original_text
        TestVersioningBatchN2.v2 = v2

        reload = api.get(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}", headers=auth_headers).json()
        assert reload["note_draft"]["version"] == 2
        assert len(reload["note_versions"]) == 2  # v1 (generated) + v2 (edit)

    def test_approve_v2(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/note/approve",
            headers=auth_headers, json={"expected_version": 2},
        )
        assert r.status_code == 200, r.text
        assert r.json()["version"] == 2
        reload = api.get(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}", headers=auth_headers).json()
        assert reload["state"] == "APPROVED"
        assert reload["approved_version"]["version"] == 2
        assert reload["approved_version"]["approved_by_name"]
        TestVersioningBatchN2.approved_v2_hash = r.json()["content_hash"]

    def test_revise_creates_v3_unapproved_while_v2_stays_approved(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/note/revise",
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["state"] == "NOTE_DRAFT"
        assert data["note_draft"]["version"] == 3
        assert data["note_draft"]["approved"] is False
        assert data["note_draft"]["parent_version"] == 2
        assert data["approved_version"]["version"] == 2
        assert data["approved_version"]["approved"] is True

        reload = api.get(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}", headers=auth_headers).json()
        assert reload["state"] == "NOTE_DRAFT"
        assert reload["note_draft"]["version"] == 3
        assert reload["note_draft"]["approved"] is False
        assert reload["approved_version"]["version"] == 2
        assert reload["approved_version"]["content_hash"] == TestVersioningBatchN2.approved_v2_hash

    def test_two_tabs_same_base_version_second_gets_409(self, api, auth_headers):
        """Simulates two browser tabs both starting from v3: tab A saves
        first (becomes v4); tab B's save (still based on v3) must 409 with
        the server's current version/content instead of overwriting."""
        current = api.get(f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}", headers=auth_headers).json()
        v3_sections = current["note_draft"]["sections"]

        r_a = api.patch(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/note",
            headers=auth_headers, json={"sections": v3_sections, "expected_version": 3},
        )
        assert r_a.status_code == 200, r_a.text
        assert r_a.json()["note_draft"]["version"] == 4

        r_b = api.patch(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/note",
            headers=auth_headers, json={"sections": v3_sections, "expected_version": 3},
        )
        assert r_b.status_code == 409, r_b.text
        detail = r_b.json()["detail"]
        assert detail["error"] == "version_conflict"
        assert detail["current_version"] == 4
        assert "current_sections" in detail

    def test_export_of_v2_unchanged_after_v3_exists(self, api, auth_headers):
        """Export always reflects approved_version (v2), never the newer
        unapproved drafts (v3/v4) layered on top of it afterwards."""
        r = api.get(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/export?fmt=text",
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert "DHARA CONSULTATION NOTE" in r.text
        rj = api.get(
            f"{BASE_URL}/api/notetaker/consultations/{TestVersioningBatchN2.consultation_id}/export?fmt=json",
            headers=auth_headers,
        )
        assert rj.status_code == 200
        assert rj.json()["version"] == 2
        assert rj.json()["content_hash"] == TestVersioningBatchN2.approved_v2_hash


class TestLegacyNoteShim:
    """BATCH N2 item 8: old notes with no version-history metadata must
    still render via a read-time shim (no DB writes), and the audit hash on
    an existing approved note is unchanged by the shim.

    Builds its OWN approved consultation rather than referencing another
    test class's state — classes in this file can land on different
    pytest-xdist worker PROCESSES (pytest.ini: `-n 2 --dist loadscope`
    groups by class, not module), so one class's mutable class attributes
    are simply not visible to another class's process.
    """
    matter_id = None
    consultation_id = None

    def test_setup_approved_note(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/notetaker/matters", headers=auth_headers, json={"title": "TEST_Matter_LegacyShim"})
        assert r.status_code == 201
        TestLegacyNoteShim.matter_id = r.json()["id"]
        r2 = api.post(
            f"{BASE_URL}/api/notetaker/matters/{TestLegacyNoteShim.matter_id}/consultations",
            headers=auth_headers,
            json={"title": "TEST_Consult_LegacyShim", "date": "2026-02-04", "purpose": "Legacy shim test", "input_method": "manual"},
        )
        assert r2.status_code == 201
        TestLegacyNoteShim.consultation_id = r2.json()["id"]
        api.post(f"{BASE_URL}/api/notetaker/consultations/{TestLegacyNoteShim.consultation_id}/consent",
                 headers=auth_headers, json={"participant_name": "TEST Client LegacyShim", "decision": "given"})
        api.post(f"{BASE_URL}/api/notetaker/consultations/{TestLegacyNoteShim.consultation_id}/manual-notes",
                 headers=auth_headers, json={"notes": (
                     "Client reports an employer withheld the final month's salary after resignation. "
                     "Advocate advised sending a demand letter citing the Payment of Wages Act. "
                     "Next step: advocate to draft the demand letter this week."
                 )})
        gen = api.post(f"{BASE_URL}/api/notetaker/consultations/{TestLegacyNoteShim.consultation_id}/note/generate",
                        headers=auth_headers, timeout=90)
        assert gen.status_code == 200, gen.text
        appr = api.post(f"{BASE_URL}/api/notetaker/consultations/{TestLegacyNoteShim.consultation_id}/note/approve",
                         headers=auth_headers, json={"expected_version": gen.json()["version"]})
        assert appr.status_code == 200, appr.text

    def test_legacy_shaped_approved_version_still_renders_with_unchanged_hash(self, api, auth_headers):
        cid = TestLegacyNoteShim.consultation_id
        before = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}", headers=auth_headers).json()
        approved_before = before["approved_version"]
        assert approved_before["version"] == 1
        original_hash = approved_before["content_hash"]

        # Simulate a pre-N2 document shape directly in Mongo — strip the new
        # per-item provenance fields and version-level metadata, but NEVER
        # touch content_hash.
        client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
        dbh = client[os.environ.get("DB_NAME", "")]
        legacy_approved = dict(approved_before)
        for key in ("parent_version", "author_id", "author_name", "diff_summary", "source", "approved", "approved_by_name"):
            legacy_approved.pop(key, None)
        for key in ("facts_stated", "client_instructions", "advice_given", "open_uncertainties", "proposed_actions"):
            for item in legacy_approved.get("sections", {}).get(key, []):
                item.pop("provenance", None)
                item.pop("generated_text", None)
        dbh.nt_consultations.update_one({"id": cid}, {"$set": {"approved_version": legacy_approved}})
        client.close()

        after = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}", headers=auth_headers).json()
        shimmed = after["approved_version"]
        assert shimmed["content_hash"] == original_hash, "The shim must never alter a stored content_hash"
        assert shimmed["version"] == 1
        assert shimmed["source"] == "legacy"
        assert shimmed["approved"] is True  # inferred from the presence of content_hash
        for key in ("facts_stated", "client_instructions", "advice_given", "open_uncertainties", "proposed_actions"):
            for item in shimmed.get("sections", {}).get(key, []):
                assert item["provenance"] == "generated"
                assert item.get("generated_text") is None

        # restore the real shape so no other test/run is affected
        client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
        dbh = client[os.environ.get("DB_NAME", "")]
        dbh.nt_consultations.update_one({"id": cid}, {"$set": {"approved_version": approved_before}})
        client.close()


class TestVersioningUnverifiedAdvocate:
    """
    BATCH N2 item 7: verification gating stays as-is for versioning — an
    unverified advocate can still PATCH /note (save) and POST /note/revise,
    and gets the same 409 conflict behaviour as a verified advocate; only
    generate/approve/export stay blocked. Uses a fresh throwaway advocate
    that is verified JUST long enough (direct DB flip) to produce one real
    approved note, then flipped back to unverified — never touches the
    shared QA advocate account.
    """
    headers = None
    consultation_id = None

    def test_setup_approved_note_then_revoke_verification(self, api):
        email = f"TEST_nt_n2_unverified_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "TestPass123!", "name": "TEST N2 Unverified",
            "phone": "9888800033", "terms_accepted": True,
        })
        if r.status_code not in (200, 201):
            pytest.skip(f"Could not register throwaway user: {r.status_code} {r.text[:200]}")
        data = r.json()
        token = data.get("access_token") or data.get("token")
        user_id = data.get("user", {}).get("id") or data.get("id")
        headers = {"Authorization": f"Bearer {token}"}
        if not user_id:
            me = api.get(f"{BASE_URL}/api/auth/me", headers=headers)
            user_id = me.json().get("id") if me.status_code == 200 else None
        assert user_id

        r2 = api.post(f"{BASE_URL}/api/advocate/register", headers=headers, json={
            "user_id": user_id, "bar_council_number": f"TEST/{uuid.uuid4().hex[:6]}/2026",
            "state_bar": "Bar Council of Delhi", "specializations": ["Family"],
        })
        assert r2.status_code == 200, r2.text

        try:
            client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
            dbh = client[os.environ.get("DB_NAME", "")]
            dbh.advocate_profiles.update_one({"user_id": user_id}, {"$set": {"verified": True}})
            client.close()
        except Exception as e:
            pytest.skip(f"Could not flip throwaway advocate verified for setup: {e}")

        r3 = api.post(f"{BASE_URL}/api/notetaker/matters", headers=headers, json={"title": "TEST_Matter_N2Unverified"})
        matter_id = r3.json()["id"]
        r4 = api.post(f"{BASE_URL}/api/notetaker/matters/{matter_id}/consultations", headers=headers,
                       json={"title": "TEST_Consult_N2Unverified", "date": "2026-02-03", "purpose": "N2 unverified test", "input_method": "manual"})
        consultation_id = r4.json()["id"]
        api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/consent", headers=headers,
                  json={"participant_name": "TEST Client N2U", "decision": "given"})
        api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/manual-notes", headers=headers,
                  json={"notes": "Client needs help with a tenancy notice. Advocate to draft a reply this week."})
        gen = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/generate", headers=headers, timeout=90)
        assert gen.status_code == 200, gen.text
        appr = api.post(f"{BASE_URL}/api/notetaker/consultations/{consultation_id}/note/approve", headers=headers,
                         json={"expected_version": gen.json()["version"]})
        assert appr.status_code == 200, appr.text

        try:
            client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000)
            dbh = client[os.environ.get("DB_NAME", "")]
            dbh.advocate_profiles.update_one({"user_id": user_id}, {"$set": {"verified": False}})
            client.close()
        except Exception as e:
            pytest.skip(f"Could not revoke throwaway advocate verified for test: {e}")

        TestVersioningUnverifiedAdvocate.headers = headers
        TestVersioningUnverifiedAdvocate.consultation_id = consultation_id

    def test_unverified_can_revise(self, api):
        h = TestVersioningUnverifiedAdvocate.headers
        cid = TestVersioningUnverifiedAdvocate.consultation_id
        r = api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/note/revise", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["state"] == "NOTE_DRAFT"
        assert r.json()["note_draft"]["approved"] is False

    def test_unverified_can_save_edits(self, api):
        h = TestVersioningUnverifiedAdvocate.headers
        cid = TestVersioningUnverifiedAdvocate.consultation_id
        draft = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}", headers=h).json()["note_draft"]
        r = api.patch(f"{BASE_URL}/api/notetaker/consultations/{cid}/note", headers=h,
                       json={"sections": draft["sections"], "expected_version": draft["version"]})
        assert r.status_code == 200, r.text

    def test_unverified_gets_same_conflict_behaviour(self, api):
        h = TestVersioningUnverifiedAdvocate.headers
        cid = TestVersioningUnverifiedAdvocate.consultation_id
        draft = api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}", headers=h).json()["note_draft"]
        r = api.patch(f"{BASE_URL}/api/notetaker/consultations/{cid}/note", headers=h,
                       json={"sections": draft["sections"], "expected_version": draft["version"] - 1})
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["error"] == "version_conflict"

    def test_unverified_still_blocked_from_generate_approve_export(self, api):
        h = TestVersioningUnverifiedAdvocate.headers
        cid = TestVersioningUnverifiedAdvocate.consultation_id
        assert api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/note/generate", headers=h).status_code == 403
        assert api.post(f"{BASE_URL}/api/notetaker/consultations/{cid}/note/approve", headers=h, json={"expected_version": 1}).status_code == 403
        assert api.get(f"{BASE_URL}/api/notetaker/consultations/{cid}/export?fmt=text", headers=h).status_code == 403
