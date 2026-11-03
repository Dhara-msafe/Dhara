"""QA Outbound Guard — proves no real external dispatch happens unless
OUTBOUND_MODE is exactly "live". Pure unit tests: no network, no shared DB
(record_simulated is monkeypatched)."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import push  # noqa: E402
import mailer  # noqa: E402
import push_jobs  # noqa: E402
from services import alerts as ops_alerts  # noqa: E402
from services import outbound_guard as og  # noqa: E402

NOT_LIVE = [None, "", "simulate", "LIVE", "Live", " live", "true", "production", "on"]


class _Boom:
    """Any attempt to touch a real provider fails the test."""
    calls = 0

    def __init__(self, *a, **k):
        pass

    async def post(self, *a, **k):
        _Boom.calls += 1
        raise AssertionError(f"REAL OUTBOUND CALL ATTEMPTED: {a}")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def recorded(monkeypatch):
    log = []

    async def _rec(kind, target, payload):
        log.append((kind, target, payload))
        return "simulated-x"

    monkeypatch.setattr(og, "record_simulated", _rec)
    monkeypatch.setattr(push, "record_simulated", _rec)
    monkeypatch.setattr(push, "_client", _Boom())
    monkeypatch.setattr(mailer.httpx, "AsyncClient", _Boom)
    monkeypatch.setattr(ops_alerts.httpx, "AsyncClient", _Boom)
    _Boom.calls = 0
    return log


def _set(monkeypatch, value):
    # These legacy unit tests pin OUTBOUND_MODE only and assume the profile is
    # DERIVED from the mode (live→production, else→internal_qa). Clear any
    # explicit OUTBOUND_PROFILE from the environment so that contract holds;
    # per-profile behaviour is covered separately in test_outbound_policy.py.
    monkeypatch.delenv("OUTBOUND_PROFILE", raising=False)
    if value is None:
        monkeypatch.delenv("OUTBOUND_MODE", raising=False)
    else:
        monkeypatch.setenv("OUTBOUND_MODE", value)


@pytest.mark.parametrize("value", NOT_LIVE)
def test_anything_but_exact_live_is_simulate(monkeypatch, value):
    _set(monkeypatch, value)
    assert og.outbound_mode() == "simulate"
    assert og.outbound_live() is False


@pytest.mark.parametrize("value", [None, "", "LIVE", "true", "prod"])
def test_startup_refuses_missing_or_invalid(monkeypatch, value):
    _set(monkeypatch, value)
    with pytest.raises(RuntimeError):
        og.validate_outbound_config()


@pytest.mark.parametrize("value", ["live", "simulate"])
def test_startup_accepts_explicit_values(monkeypatch, value):
    _set(monkeypatch, value)
    assert og.validate_outbound_config() == value


@pytest.mark.parametrize("value", NOT_LIVE)
def test_push_never_reaches_relay(monkeypatch, recorded, value):
    _set(monkeypatch, value)
    asyncio.run(push.send_push(["u1", "u2"], {"title": "t", "message": "m"}))
    asyncio.run(push.register_device("u1", "android", "tok"))
    asyncio.run(push.unregister_device("u1"))
    assert _Boom.calls == 0
    assert [k for k, *_ in recorded] == ["push", "push_register", "push_unregister"]


@pytest.mark.parametrize("value", NOT_LIVE)
def test_email_goes_to_qa_outbox_only(monkeypatch, recorded, value):
    _set(monkeypatch, value)
    monkeypatch.setattr(mailer, "EMAIL_KEY", "k")
    monkeypatch.setattr(mailer, "EMAIL_FROM_NAME", "Dhara")
    subject, html = mailer.password_reset_otp_email(name="QA", code="123456", minutes=10)
    out = asyncio.run(mailer.send_email(to="qa@example.com", subject=subject, html=html))
    assert out.startswith("simulated-")
    assert _Boom.calls == 0
    assert recorded[0][0] == "email" and recorded[0][1] == "qa@example.com"
    assert "123456" in recorded[0][2]["html"]


def test_ops_alerts_intercepted(monkeypatch, recorded):
    _set(monkeypatch, "simulate")
    monkeypatch.setattr(ops_alerts, "OPS_ALERT_EMAIL", "ops@example.com")
    monkeypatch.setattr(ops_alerts, "OPS_ALERT_SLACK_WEBHOOK_URL", "https://hooks.slack.invalid/x")
    asyncio.run(ops_alerts.send_ops_alert("t", "d"))
    assert _Boom.calls == 0
    assert recorded[0][0] == "ops_alert"


def test_daily_nudge_does_not_run_in_qa(monkeypatch, recorded):
    _set(monkeypatch, "simulate")

    class _NoDb:
        def __getattr__(self, name):
            raise AssertionError("daily nudge touched the DB in QA mode")

    asyncio.run(push_jobs._run_daily_nudge(_NoDb()))
    assert recorded == [] and _Boom.calls == 0


def test_server_only_starts_push_loop_when_live():
    src = (Path(__file__).resolve().parent.parent / "server.py").read_text(encoding="utf-8")
    i = src.index("asyncio.create_task(run_push_jobs_loop(db, corpus_db))")
    assert "if outbound_live():" in src[i - 120:i]
    assert "validate_outbound_config()" in src


def test_live_mode_still_calls_provider(monkeypatch, recorded):
    """Production path unchanged: in live mode the real client IS used."""
    _set(monkeypatch, "live")
    with pytest.raises(AssertionError, match="REAL OUTBOUND CALL ATTEMPTED"):
        asyncio.run(push.send_push(["u1"], {"title": "t", "message": "m"}))
    assert _Boom.calls == 1 and recorded == []
