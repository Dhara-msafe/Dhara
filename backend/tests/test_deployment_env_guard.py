"""NF-SAFETY-01 (14 Nov 2026) — DEPLOYMENT_ENV startup guard.

Pure unit tests against services.outbound_guard.validate_outbound_config():
no network, no DB, no running server. Covers exactly the three cases
approved for this check:
  1. preview with an effective production profile -> refuse to start
  2. DEPLOYMENT_ENV missing entirely -> refuse to start
  3. a valid preview configuration (preview + internal_qa) -> starts fine
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import outbound_guard as og  # noqa: E402


def _clear(monkeypatch):
    for var in ("DEPLOYMENT_ENV", "OUTBOUND_MODE", "OUTBOUND_PROFILE"):
        monkeypatch.delenv(var, raising=False)


def test_preview_with_production_profile_refuses_to_start(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DEPLOYMENT_ENV", "preview")
    monkeypatch.setenv("OUTBOUND_MODE", "live")
    monkeypatch.setenv("OUTBOUND_PROFILE", "production")
    monkeypatch.setenv("EMERGENT_EMAIL_KEY", "k")  # would satisfy the production-completeness
    # check below it, so this failure is unambiguously the DEPLOYMENT_ENV guard.
    with pytest.raises(RuntimeError, match="DEPLOYMENT_ENV=preview requires"):
        og.validate_outbound_config()


def test_missing_deployment_env_refuses_to_start(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("OUTBOUND_MODE", "simulate")
    monkeypatch.setenv("OUTBOUND_PROFILE", "internal_qa")
    # DEPLOYMENT_ENV intentionally left unset.
    with pytest.raises(RuntimeError, match="DEPLOYMENT_ENV must be set explicitly"):
        og.validate_outbound_config()


def test_valid_preview_configuration_starts(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("DEPLOYMENT_ENV", "preview")
    monkeypatch.setenv("OUTBOUND_MODE", "simulate")
    monkeypatch.setenv("OUTBOUND_PROFILE", "internal_qa")
    assert og.validate_outbound_config() == "simulate"
