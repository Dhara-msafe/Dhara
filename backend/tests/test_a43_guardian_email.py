"""
test_a43_guardian_email.py
A43/A44/A45/A46 — reaching a trusted person who does not have DHARA.

Until now a guardian had to be a DHARA user: the invite matched a phone
number against existing accounts, and anyone without one was invited into
silence. These tests cover the email route end to end:

  A43  she can invite by email, and the invitation actually goes out
  A44  he accepts or declines from the email, with no app and no account
  A45  he is emailed when she starts a journey and when she misses a
       check-in
  A46  the link in that email shows her last known AREA and nothing more

Privacy is most of what is checked here: an email reaches someone who never
signed up, and an emailed link lives in an inbox for ever.

Isolated: direct handler invocation with a mocked DB and a mocked mailer.
Nothing is sent.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import api.journey_router as jr
import api.trusted_circle_router as tc
import mailer
from services import guardian_email as ge

_OWNER = {"id": "owner-001", "name": "Priya Sharma"}
_ADDRESS = "asha@example.com"


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://dhara.example")
    monkeypatch.setenv("GUARDIAN_LINK_SECRET", "test-secret-not-a-real-one")
    monkeypatch.delenv("PILOT_GUARDIAN_EMAILS", raising=False)
    return monkeypatch


def _iso(delta_s: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_s)).isoformat()


def _link(**over):
    link = {
        "id": "L1", "owner_id": _OWNER["id"], "owner_name": "Priya Sharma",
        "contact_name": "Asha", "contact_email": _ADDRESS, "invitee_user_id": None,
        "status": "accepted", "muted": False,
        "permissions": {"temp_location": True, "journey_updates": True},
    }
    link.update(over)
    return link


def _journey(**over):
    rec = {
        "token": "TOK", "user_id": _OWNER["id"], "user_display": "Priya",
        "status": "in_progress", "sharing_revoked_at": None,
        "destination": "Gachibowli", "expected_checkin_at": _iso(600),
        "recipient_link_ids": ["L1"], "missed_checkin_notified_at": None,
    }
    rec.update(over)
    return rec


class _Sent(list):
    """Collects what would have been emailed."""
    async def __call__(self, *, to, subject, html, channel=None):
        self.append({"to": to, "subject": subject, "html": html, "channel": channel})
        return "msg-1"


# ── A43: the invitation ──────────────────────────────────────────────────────

class TestInviteByEmail:
    @pytest.mark.asyncio
    async def test_an_address_is_kept_and_the_invitation_is_sent(self, env):
        sent = _Sent()
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), \
             patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            out = await tc.invite(
                tc.InviteIn(name="Asha", phone="+919876500000", email="Asha@Example.com "),
                user=_OWNER,
            )
        assert out["invited_by_email"] is True
        doc = db.trusted_circle_links.insert_one.await_args.args[0]
        assert doc["contact_email"] == "asha@example.com", "stored lower-cased and trimmed"
        assert doc["channel"] == "email"
        assert len(sent) == 1 and sent[0]["to"] == "asha@example.com"

    @pytest.mark.asyncio
    async def test_the_plain_token_is_never_stored(self, env):
        sent = _Sent()
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), \
             patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000", email=_ADDRESS), user=_OWNER)
        doc = db.trusted_circle_links.insert_one.await_args.args[0]
        assert "invite_token" not in doc and "view_token" not in doc
        assert len(doc["invite_token_hash"]) == 64, "stored as a hash"
        # the token in the email is not the thing in the database
        assert doc["invite_token_hash"] not in sent[0]["html"]

    @pytest.mark.asyncio
    async def test_the_email_says_who_asked_and_how_to_refuse(self, env):
        sent = _Sent()
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), \
             patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000", email=_ADDRESS), user=_OWNER)
        html = sent[0]["html"]
        assert "Priya Sharma" in html, "someone who never signed up must be told who named them"
        assert "No, do not contact me" in html
        assert "r=decline" in html
        assert sent[0]["channel"] == "email", "guardian mail is not gated as account mail"

    @pytest.mark.asyncio
    async def test_an_existing_app_user_is_not_emailed_as_well(self, env):
        sent = _Sent()
        db = MagicMock()
        db.users.find = MagicMock(return_value=_one({"id": "u2", "phone": "+919876500000"}))
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), \
             patch.object(tc, "send_push", new=AsyncMock()), \
             patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            out = await tc.invite(
                tc.InviteIn(name="Asha", phone="+919876500000", email=_ADDRESS), user=_OWNER)
        assert out["matched_existing_user"] is True
        assert out["invited_by_email"] is False
        assert sent == [], "they are reachable in the app; two invitations would confuse"

    @pytest.mark.asyncio
    async def test_a_malformed_address_is_ignored_rather_than_stored(self, env):
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db):
            out = await tc.invite(
                tc.InviteIn(name="Asha", phone="+919876500000", email="not-an-address"), user=_OWNER)
        doc = db.trusted_circle_links.insert_one.await_args.args[0]
        assert "contact_email" not in doc
        assert out["invited_by_email"] is False

    @pytest.mark.asyncio
    async def test_without_a_public_url_nothing_is_sent_and_she_is_told(self, env):
        env.delenv("PUBLIC_BASE_URL")
        sent = _Sent()
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), \
             patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            out = await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000", email=_ADDRESS), user=_OWNER)
        assert sent == [], "a message whose links do not work is worse than none"
        assert out["email_pending"] is True

    @pytest.mark.asyncio
    async def test_the_pilot_allow_list_holds_email_to_named_testers(self, env):
        env.setenv("PILOT_GUARDIAN_EMAILS", "tester@example.com")
        sent = _Sent()
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), \
             patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000", email=_ADDRESS), user=_OWNER)
        assert sent == []
        assert ge.may_email("tester@example.com") is True


def _empty():
    class _C:
        def __aiter__(self): return self
        async def __anext__(self): raise StopAsyncIteration
    return _C()


def _one(doc):
    class _C:
        def __init__(self): self.done = False
        def __aiter__(self): return self
        async def __anext__(self):
            if self.done: raise StopAsyncIteration
            self.done = True
            return doc
    return _C()


# ── A44: accepting without an app ────────────────────────────────────────────

class TestAcceptFromTheEmail:
    @pytest.mark.asyncio
    async def test_opening_the_link_does_not_accept_by_itself(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link(status="pending"))
        db.trusted_circle_links.update_one = AsyncMock()
        with patch.object(tc, "db", db):
            page = await tc.email_invitation_page("tok", r="accept")
        db.trusted_circle_links.update_one.assert_not_awaited(), "a mail scanner must not accept for him"
        assert "Yes, I will be her contact" in page.body.decode()

    @pytest.mark.asyncio
    async def test_accepting_records_his_own_consent(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link(status="pending"))
        db.trusted_circle_links.update_one = AsyncMock()
        with patch.object(tc, "db", db):
            page = await tc.email_invitation_respond(token="tok", action="accept")
        setter = db.trusted_circle_links.update_one.await_args.args[1]["$set"]
        assert setter["status"] == "accepted"
        assert setter["email_consent_at"], "his agreement is recorded, not assumed"
        assert "safety contact" in page.body.decode()

    @pytest.mark.asyncio
    async def test_declining_throws_the_links_away(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link(status="pending"))
        db.trusted_circle_links.update_one = AsyncMock()
        with patch.object(tc, "db", db):
            await tc.email_invitation_respond(token="tok", action="decline")
        upd = db.trusted_circle_links.update_one.await_args.args[1]
        assert upd["$set"]["status"] == "declined"
        assert upd["$unset"] == {"view_token_hash": "", "invite_token_hash": ""}

    @pytest.mark.asyncio
    async def test_an_unknown_token_gives_nothing_away(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=None)
        with patch.object(tc, "db", db):
            page = await tc.email_invitation_page("whatever")
        body = page.body.decode()
        assert "no longer open" in body
        assert "Priya" not in body, "a stranger must not learn whose link it is"

    @pytest.mark.asyncio
    async def test_the_page_is_not_indexed(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link(status="pending"))
        with patch.object(tc, "db", db):
            page = await tc.email_invitation_page("tok")
        assert "noindex" in page.headers.get("x-robots-tag", "")
        assert page.headers.get("cache-control") == "no-store"


# ── A45: the alerts ──────────────────────────────────────────────────────────

class TestAlertEmails:
    @pytest.mark.asyncio
    async def test_a_missed_check_in_reaches_him_with_her_area(self, env):
        sent = _Sent()
        with patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            ok = await jr._email_linked_recipient(
                _link(),
                _journey(last_location={"area": "Gachibowli", "updated_at": _iso(-420)}),
                "Priya Sharma", "missed_checkin",
            )
        assert ok is True
        html = sent[0]["html"]
        assert "has not checked in" in sent[0]["subject"]
        assert "Gachibowli" in html
        assert "112" in html, "tell him what to do, not just what happened"
        assert "17.4" not in html, "an email must never carry coordinates"

    @pytest.mark.asyncio
    async def test_someone_who_has_not_accepted_is_never_written_to(self, env):
        sent = _Sent()
        for status in ["pending", "declined", "revoked"]:
            with patch.object(mailer, "send_email", new=sent), \
                 patch.object(mailer, "email_configured", lambda: True):
                ok = await jr._email_linked_recipient(
                    _link(status=status), _journey(), "Priya Sharma", "missed_checkin")
            assert ok is False
        assert sent == []

    @pytest.mark.asyncio
    async def test_an_app_user_is_not_emailed(self, env):
        sent = _Sent()
        with patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            ok = await jr._email_linked_recipient(
                _link(invitee_user_id="u2"), _journey(), "Priya Sharma", "missed_checkin")
        assert ok is False and sent == []

    @pytest.mark.asyncio
    async def test_a_muted_contact_is_left_alone(self, env):
        sent = _Sent()
        with patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            ok = await jr._email_linked_recipient(
                _link(muted=True), _journey(), "Priya Sharma", "missed_checkin")
        assert ok is False and sent == []

    @pytest.mark.asyncio
    async def test_without_the_location_permission_no_area_and_no_link(self, env):
        sent = _Sent()
        link = _link(permissions={"temp_location": False, "journey_updates": True})
        with patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            await jr._email_linked_recipient(
                link, _journey(last_location={"area": "Gachibowli", "updated_at": _iso(-60)}),
                "Priya Sharma", "missed_checkin")
        html = sent[0]["html"]
        assert "Gachibowli" not in html
        assert "guardian/email/" not in html, "no view link for someone she did not share with"

    @pytest.mark.asyncio
    async def test_arriving_safely_closes_the_loop(self, env):
        sent = _Sent()
        with patch.object(mailer, "send_email", new=sent), \
             patch.object(mailer, "email_configured", lambda: True):
            await jr._email_linked_recipient(_link(), _journey(status="safe"),
                                             "Priya Sharma", "journey_completed")
        assert "arrived safely" in sent[0]["subject"]

    @pytest.mark.asyncio
    async def test_a_mail_failure_never_breaks_the_journey(self, env):
        async def boom(**kw):
            raise RuntimeError("smtp down")
        with patch.object(mailer, "send_email", new=boom), \
             patch.object(mailer, "email_configured", lambda: True):
            assert await jr._email_linked_recipient(
                _link(), _journey(), "Priya Sharma", "missed_checkin") is False

    @pytest.mark.asyncio
    async def test_only_the_three_journey_events_are_emailed(self, env):
        sent = _Sent()
        for other in ["help_requested", "sharing_ended", "journey_status"]:
            with patch.object(mailer, "send_email", new=sent), \
                 patch.object(mailer, "email_configured", lambda: True):
                assert await jr._email_linked_recipient(
                    _link(), _journey(), "Priya Sharma", other) is False
        assert sent == []


# ── A46: the last-area page ──────────────────────────────────────────────────

class TestLastAreaPage:
    @pytest.mark.asyncio
    async def test_it_shows_the_area_and_nothing_more(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link())
        db.safety_journeys.find_one = AsyncMock(return_value=_journey(
            last_location={"area": "Gachibowli", "lat": 17.4652, "lng": 78.3488,
                           "updated_at": _iso(-300)}))
        with patch.object(jr, "db", db):
            page = await jr.guardian_email_view("tok")
        body = page.body.decode()
        assert "Gachibowli" in body
        assert "5 minutes ago" in body
        assert "17.4652" not in body and "78.3488" not in body, "never an exact position"
        assert "Gachibowli" in body and "destination" not in body.lower()

    @pytest.mark.asyncio
    async def test_a_missed_check_in_says_so_and_what_to_do(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link())
        db.safety_journeys.find_one = AsyncMock(return_value=_journey(
            missed_checkin_notified_at=_iso(-60),
            last_location={"area": "Gachibowli", "updated_at": _iso(-900)}))
        with patch.object(jr, "db", db):
            page = await jr.guardian_email_view("tok")
        body = page.body.decode()
        assert "has not checked in" in body
        assert "112" in body

    @pytest.mark.asyncio
    async def test_nothing_is_shown_once_the_journey_is_over(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link())
        db.safety_journeys.find_one = AsyncMock(return_value=None)
        with patch.object(jr, "db", db):
            page = await jr.guardian_email_view("tok")
        assert "Nothing to show" in page.body.decode()

    @pytest.mark.asyncio
    async def test_an_unknown_or_withdrawn_link_shows_the_same_nothing(self, env):
        for link in [None, _link(status="revoked"),
                     _link(permissions={"temp_location": False})]:
            db = MagicMock()
            db.trusted_circle_links.find_one = AsyncMock(return_value=link)
            db.safety_journeys.find_one = AsyncMock(return_value=_journey())
            with patch.object(jr, "db", db):
                page = await jr.guardian_email_view("tok")
            body = page.body.decode()
            assert "Nothing to show" in body
            assert "Priya" not in body

    @pytest.mark.asyncio
    async def test_the_page_is_not_indexed_or_cached(self, env):
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=None)
        with patch.object(jr, "db", db):
            page = await jr.guardian_email_view("tok")
        assert "noindex" in page.headers.get("x-robots-tag", "")
        assert page.headers.get("cache-control") == "no-store"

    def test_the_link_can_be_rebuilt_but_not_guessed(self, env):
        a = ge.view_token_for("L1")
        assert a == ge.view_token_for("L1"), "every email must carry the same address"
        assert a != ge.view_token_for("L2")
        assert len(a) >= 40
        env.setenv("GUARDIAN_LINK_SECRET", "rotated")
        assert ge.view_token_for("L1") != a, "rotating the secret must kill old links"

    def test_no_secret_means_no_link_rather_than_a_weak_one(self, env):
        env.delenv("GUARDIAN_LINK_SECRET")
        env.delenv("JWT_SECRET", raising=False)
        assert ge.view_token_for("L1") is None


# ── A48: an invitation that does not depend on email ─────────────────────────

class TestShareableInvitation:
    """Email is not the only way in, and in India it is often not the usual
    one. Every contact without a DHARA account gets a link she can send
    herself — WhatsApp, her own SMS, in person."""

    @pytest.mark.asyncio
    async def test_a_contact_with_no_email_still_gets_an_invitation_link(self, env):
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db):
            out = await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000"), user=_OWNER)
        assert out["invite_path"], "no link means no way for him to accept"
        assert out["invite_path"].startswith("/api/trusted-circle/invitation/email/")
        doc = db.trusted_circle_links.insert_one.await_args.args[0]
        assert doc["channel"] == "link"
        assert "contact_email" not in doc

    @pytest.mark.asyncio
    async def test_the_link_in_the_reply_is_the_one_that_opens_the_page(self, env):
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db):
            out = await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000"), user=_OWNER)
        token = out["invite_path"].rsplit("/", 1)[-1]
        doc = db.trusted_circle_links.insert_one.await_args.args[0]
        assert ge.hash_token(token) == doc["invite_token_hash"]

    @pytest.mark.asyncio
    async def test_an_absolute_url_when_the_deployment_has_one(self, env):
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db):
            out = await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000"), user=_OWNER)
        assert out["invite_url"].startswith("https://dhara.example/api/trusted-circle/invitation/email/")

    @pytest.mark.asyncio
    async def test_without_a_base_url_the_path_is_still_returned(self, env):
        """The app knows its own backend address, so it can build the link
        even when the deployment has not been told its public name."""
        env.delenv("PUBLIC_BASE_URL")
        db = MagicMock()
        db.users.find = MagicMock(return_value=_empty())
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db):
            out = await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000"), user=_OWNER)
        assert out["invite_url"] is None
        assert out["invite_path"], "the path must still come back, or nothing can be shared"

    @pytest.mark.asyncio
    async def test_an_existing_app_user_gets_no_link(self, env):
        db = MagicMock()
        db.users.find = MagicMock(return_value=_one({"id": "u2", "phone": "+919876500000"}))
        db.trusted_circle_links.insert_one = AsyncMock()
        with patch.object(tc, "db", db), patch.object(tc, "send_push", new=AsyncMock()):
            out = await tc.invite(tc.InviteIn(name="Asha", phone="+919876500000"), user=_OWNER)
        assert out["invite_path"] is None, "they accept in the app; a link would be a second door"

    @pytest.mark.asyncio
    async def test_the_shared_link_opens_the_same_accept_page(self, env):
        """What she shares is exactly what the email would have carried."""
        db = MagicMock()
        db.trusted_circle_links.find_one = AsyncMock(return_value=_link(status="pending", contact_email=None))
        with patch.object(tc, "db", db):
            page = await tc.email_invitation_page("tok")
        body = page.body.decode()
        assert "Yes, I will be her contact" in body
        assert "No, do not contact me" in body
