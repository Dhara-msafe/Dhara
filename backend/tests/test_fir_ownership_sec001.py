"""SEC-001 regression/verification tests: FIR session/evidence BOLA/IDOR fix.

Covers api/fir_router.py ownership enforcement via _get_owned_session() and
per-route checks, plus the anti-spoofing fix on POST /fir/session, plus the
anonymous (no-login) FIR flow regression, plus the datetime bug fix on
evidence upload / gps / pause.

Scenario:
  - User A (owner) registers + logs in, creates a FIR session.
  - User B (attacker) registers + logs in, must get 403 on every A-owned
    resource; unauthenticated caller must get 401.
  - Anonymous session (no login) must work end-to-end unauthenticated.
"""
import io
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"


def register_and_login(session: requests.Session, email: str, password: str, name: str):
    session.post(f"{API}/auth/register", json={
        "email": email, "password": password, "name": name,
        "phone": "9999999999", "terms_accepted": True, "terms_version": "1.0",
    })
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"no token in login response: {r.json()}"
    return token


@pytest.fixture(scope="module")
def api_client():
    return requests.Session()


@pytest.fixture(scope="module")
def user_a_token(api_client):
    uid = uuid.uuid4().hex[:8]
    return register_and_login(api_client, f"TEST_fir_owner_{uid}@example.com", "TestPass123!", "Owner A")


@pytest.fixture(scope="module")
def user_b_token(api_client):
    uid = uuid.uuid4().hex[:8]
    return register_and_login(api_client, f"TEST_fir_attacker_{uid}@example.com", "TestPass456!", "Attacker B")


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owned_session(api_client, user_a_token):
    """Create a session as User A. create_session() doesn't return user_id in
    its response, so fetch the persisted doc via GET to get user_id too."""
    r = api_client.post(f"{API}/fir/session", json={"user_id": "should-be-ignored", "language": "en"},
                         headers=auth_headers(user_a_token))
    assert r.status_code == 200, r.text
    created = r.json()
    r2 = api_client.get(f"{API}/fir/session/{created['session_id']}", headers=auth_headers(user_a_token))
    assert r2.status_code == 200, r2.text
    full = r2.json()
    created["user_id"] = full["user_id"]
    return created


class TestAntiSpoofingCreate:
    def test_create_session_force_attributes_to_caller(self, api_client, user_a_token, owned_session):
        """POST /fir/session must ignore body.user_id when authenticated and use caller's own id."""
        session_id = owned_session["session_id"]
        # Fetch session as owner to see recorded user_id
        r = api_client.get(f"{API}/fir/session/{session_id}", headers=auth_headers(user_a_token))
        assert r.status_code == 200
        assert r.json()["user_id"] != "should-be-ignored"


class TestOwnershipEnforcement:
    """User B (wrong user) must get 403; unauthenticated must get 401; User A must get 200."""

    def test_get_session_owner_ok(self, api_client, user_a_token, owned_session):
        r = api_client.get(f"{API}/fir/session/{owned_session['session_id']}", headers=auth_headers(user_a_token))
        assert r.status_code == 200

    def test_get_session_wrong_user_403(self, api_client, user_b_token, owned_session):
        r = api_client.get(f"{API}/fir/session/{owned_session['session_id']}", headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_get_session_unauth_401(self, api_client, owned_session):
        r = api_client.get(f"{API}/fir/session/{owned_session['session_id']}")
        assert r.status_code == 401

    def test_list_sessions_wrong_user_403(self, api_client, user_b_token, owned_session):
        owner_user_id = owned_session["user_id"]
        r = api_client.get(f"{API}/fir/sessions/{owner_user_id}", headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_list_sessions_unauth_401(self, api_client, owned_session):
        owner_user_id = owned_session["user_id"]
        r = api_client.get(f"{API}/fir/sessions/{owner_user_id}")
        assert r.status_code == 401

    def test_list_sessions_owner_200(self, api_client, user_a_token, owned_session):
        owner_user_id = owned_session["user_id"]
        r = api_client.get(f"{API}/fir/sessions/{owner_user_id}", headers=auth_headers(user_a_token))
        assert r.status_code == 200

    def test_turn_wrong_user_403(self, api_client, user_b_token, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/turn",
                             json={"action": "skip"}, headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_turn_unauth_401(self, api_client, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/turn", json={"action": "skip"})
        assert r.status_code == 401

    def test_turn_owner_200(self, api_client, user_a_token, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/turn",
                             json={"action": "skip"}, headers=auth_headers(user_a_token))
        assert r.status_code == 200

    def test_gps_wrong_user_403(self, api_client, user_b_token, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/gps",
                             json={"lat": 1.0, "lng": 2.0, "log_type": "start"},
                             headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_gps_unauth_401(self, api_client, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/gps",
                             json={"lat": 1.0, "lng": 2.0, "log_type": "start"})
        assert r.status_code == 401

    def test_gps_owner_200(self, api_client, user_a_token, owned_session):
        """Also verifies the datetime bug fix (previously 500)."""
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/gps",
                             json={"lat": 1.0, "lng": 2.0, "log_type": "start"},
                             headers=auth_headers(user_a_token))
        assert r.status_code == 200, r.text

    def test_pause_wrong_user_403(self, api_client, user_b_token, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/pause",
                             headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_pause_unauth_401(self, api_client, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/pause")
        assert r.status_code == 401

    def test_pause_owner_200(self, api_client, user_a_token, owned_session):
        """Also verifies the datetime bug fix (previously 500)."""
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/pause",
                             headers=auth_headers(user_a_token))
        assert r.status_code == 200, r.text

    def test_back_wrong_user_403(self, api_client, user_b_token, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/back",
                             headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_back_unauth_401(self, api_client, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/back")
        assert r.status_code == 401

    def test_back_owner_200_or_ok_false(self, api_client, user_a_token, owned_session):
        r = api_client.post(f"{API}/fir/session/{owned_session['session_id']}/back",
                             headers=auth_headers(user_a_token))
        assert r.status_code == 200, r.text

    def test_drafts_list_wrong_user_403(self, api_client, user_b_token, owned_session):
        owner_user_id = owned_session["user_id"]
        r = api_client.get(f"{API}/fir/drafts/{owner_user_id}", headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_drafts_list_unauth_401(self, api_client, owned_session):
        owner_user_id = owned_session["user_id"]
        r = api_client.get(f"{API}/fir/drafts/{owner_user_id}")
        assert r.status_code == 401

    def test_drafts_list_owner_200(self, api_client, user_a_token, owned_session):
        owner_user_id = owned_session["user_id"]
        r = api_client.get(f"{API}/fir/drafts/{owner_user_id}", headers=auth_headers(user_a_token))
        assert r.status_code == 200


@pytest.fixture(scope="module")
def owned_draft(api_client, user_a_token, owned_session):
    """Create a FIR draft owned by User A (via POST /fir/draft, uses real user_id)."""
    owner_user_id = owned_session["user_id"]
    r = api_client.post(f"{API}/fir/draft", json={"user_id": owner_user_id, "language": "en",
                                                    "answers": {"q1": "test"}, "status": "in_progress"})
    assert r.status_code == 200, r.text
    return r.json()


class TestDraftOwnership:
    def test_get_draft_wrong_user_403(self, api_client, user_b_token, owned_draft):
        r = api_client.get(f"{API}/fir/draft/{owned_draft['draft_id']}", headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_get_draft_unauth_401(self, api_client, owned_draft):
        r = api_client.get(f"{API}/fir/draft/{owned_draft['draft_id']}")
        assert r.status_code == 401

    def test_get_draft_owner_200(self, api_client, user_a_token, owned_draft):
        r = api_client.get(f"{API}/fir/draft/{owned_draft['draft_id']}", headers=auth_headers(user_a_token))
        assert r.status_code == 200


@pytest.fixture(scope="module")
def session_with_evidence(api_client, user_a_token, owned_session):
    """Upload one evidence file to owned_session as User A. Returns (session_id, file_id)."""
    session_id = owned_session["session_id"]
    files = {"file": ("test_evidence.txt", io.BytesIO(b"test evidence content"), "text/plain")}
    r = api_client.post(f"{API}/fir/session/{session_id}/evidence", files=files, headers=auth_headers(user_a_token))
    assert r.status_code == 200, r.text  # also verifies datetime bugfix (previously 500)
    file_id = r.json()["file"]["file_id"]
    return session_id, file_id


class TestEvidenceOwnership:
    def test_upload_wrong_user_403(self, api_client, user_b_token, owned_session):
        session_id = owned_session["session_id"]
        files = {"file": ("attack.txt", io.BytesIO(b"malicious"), "text/plain")}
        r = api_client.post(f"{API}/fir/session/{session_id}/evidence", files=files, headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_upload_unauth_401(self, api_client, owned_session):
        session_id = owned_session["session_id"]
        files = {"file": ("attack.txt", io.BytesIO(b"malicious"), "text/plain")}
        r = api_client.post(f"{API}/fir/session/{session_id}/evidence", files=files)
        assert r.status_code == 401

    def test_download_wrong_user_403(self, api_client, user_b_token, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.get(f"{API}/fir/session/{session_id}/evidence/{file_id}", headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_download_unauth_401(self, api_client, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.get(f"{API}/fir/session/{session_id}/evidence/{file_id}")
        assert r.status_code == 401

    def test_download_owner_200(self, api_client, user_a_token, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.get(f"{API}/fir/session/{session_id}/evidence/{file_id}", headers=auth_headers(user_a_token))
        assert r.status_code == 200
        assert r.content == b"test evidence content"

    def test_caption_wrong_user_403(self, api_client, user_b_token, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.patch(f"{API}/fir/session/{session_id}/evidence/{file_id}/caption",
                              json={"caption": "hacked"}, headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_caption_unauth_401(self, api_client, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.patch(f"{API}/fir/session/{session_id}/evidence/{file_id}/caption", json={"caption": "x"})
        assert r.status_code == 401

    def test_caption_owner_200(self, api_client, user_a_token, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.patch(f"{API}/fir/session/{session_id}/evidence/{file_id}/caption",
                              json={"caption": "legit caption"}, headers=auth_headers(user_a_token))
        assert r.status_code == 200
        assert r.json()["caption"] == "legit caption"

    def test_delete_wrong_user_403(self, api_client, user_b_token, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.delete(f"{API}/fir/session/{session_id}/evidence/{file_id}", headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_delete_unauth_401(self, api_client, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.delete(f"{API}/fir/session/{session_id}/evidence/{file_id}")
        assert r.status_code == 401

    def test_delete_owner_200(self, api_client, user_a_token, session_with_evidence):
        session_id, file_id = session_with_evidence
        r = api_client.delete(f"{API}/fir/session/{session_id}/evidence/{file_id}", headers=auth_headers(user_a_token))
        assert r.status_code == 200


class TestDraftPdfOwnership:
    """GET /fir/session/{id}/draft.pdf - needs a completed draft; if no draft, owner still
    gets 400 (no draft), while wrong-user/unauth checks happen BEFORE the draft-exists check."""

    def test_pdf_wrong_user_403(self, api_client, user_b_token, owned_session):
        r = api_client.get(f"{API}/fir/session/{owned_session['session_id']}/draft.pdf",
                            headers=auth_headers(user_b_token))
        assert r.status_code == 403

    def test_pdf_unauth_401(self, api_client, owned_session):
        r = api_client.get(f"{API}/fir/session/{owned_session['session_id']}/draft.pdf")
        assert r.status_code == 401

    def test_pdf_owner_not_403_or_401(self, api_client, user_a_token, owned_session):
        """Owner should pass ownership check; may get 400 (no draft yet) but never 401/403."""
        r = api_client.get(f"{API}/fir/session/{owned_session['session_id']}/draft.pdf",
                            headers=auth_headers(user_a_token))
        assert r.status_code not in (401, 403)


# ─── Anonymous (no-login) regression — MUST continue to work fully ──────────

class TestAnonymousFlowRegression:
    """Critical regression: anonymous FIR flow must work completely unauthenticated."""

    @pytest.fixture(scope="class")
    def anon_user_id(self):
        return f"anon-{uuid.uuid4().hex}"

    @pytest.fixture(scope="class")
    def anon_session(self, anon_user_id):
        s = requests.Session()
        r = s.post(f"{API}/fir/session", json={"user_id": anon_user_id, "language": "en"})
        assert r.status_code == 200, r.text
        created = r.json()
        r2 = s.get(f"{API}/fir/session/{created['session_id']}")
        assert r2.status_code == 200, r2.text
        created["user_id"] = r2.json()["user_id"]
        return created

    def test_anon_create_session_keeps_anon_id(self, anon_session, anon_user_id):
        assert anon_session["user_id"] == anon_user_id

    def test_anon_get_session_200(self, anon_session):
        r = requests.get(f"{API}/fir/session/{anon_session['session_id']}")
        assert r.status_code == 200

    def test_anon_list_sessions_200(self, anon_session, anon_user_id):
        r = requests.get(f"{API}/fir/sessions/{anon_user_id}")
        assert r.status_code == 200

    def test_anon_turn_200(self, anon_session):
        r = requests.post(f"{API}/fir/session/{anon_session['session_id']}/turn", json={"action": "skip"})
        assert r.status_code == 200, r.text

    def test_anon_gps_200(self, anon_session):
        r = requests.post(f"{API}/fir/session/{anon_session['session_id']}/gps",
                           json={"lat": 10.0, "lng": 20.0, "log_type": "start"})
        assert r.status_code == 200, r.text

    def test_anon_evidence_upload_200(self, anon_session):
        files = {"file": ("anon_evidence.txt", io.BytesIO(b"anon evidence"), "text/plain")}
        r = requests.post(f"{API}/fir/session/{anon_session['session_id']}/evidence", files=files)
        assert r.status_code == 200, r.text
        self.__class__._anon_file_id = r.json()["file"]["file_id"]

    def test_anon_evidence_download_200(self, anon_session):
        file_id = getattr(self.__class__, "_anon_file_id", None)
        if not file_id:
            pytest.skip("upload step did not record file_id")
        r = requests.get(f"{API}/fir/session/{anon_session['session_id']}/evidence/{file_id}")
        assert r.status_code == 200

    def test_anon_caption_200(self, anon_session):
        file_id = getattr(self.__class__, "_anon_file_id", None)
        if not file_id:
            pytest.skip("upload step did not record file_id")
        r = requests.patch(f"{API}/fir/session/{anon_session['session_id']}/evidence/{file_id}/caption",
                            json={"caption": "anon caption"})
        assert r.status_code == 200

    def test_anon_pause_200(self, anon_session):
        r = requests.post(f"{API}/fir/session/{anon_session['session_id']}/pause")
        assert r.status_code == 200, r.text

    def test_anon_back_200(self, anon_session):
        r = requests.post(f"{API}/fir/session/{anon_session['session_id']}/back")
        assert r.status_code == 200, r.text

    def test_anon_draft_pdf_not_blocked_by_auth(self, anon_session):
        r = requests.get(f"{API}/fir/session/{anon_session['session_id']}/draft.pdf")
        assert r.status_code != 401 and r.status_code != 403

    def test_anon_drafts_list_200(self, anon_user_id):
        r = requests.get(f"{API}/fir/drafts/{anon_user_id}")
        assert r.status_code == 200
