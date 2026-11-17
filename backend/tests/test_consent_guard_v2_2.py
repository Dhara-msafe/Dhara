"""
Tests for DHARA v2.2 consent guard changes:
1. is_awareness_updates_consented() in outbound_guard.py
2. B-CONSENT-GUARD doc comment in deadline_worker.py
3. B-CONSENT-GUARD doc comment in trusted_circle_router.py
"""
import sys
import os
import pytest
import importlib

sys.path.insert(0, '/app/backend')
sys.path.insert(0, '/app/backend/services')


class TestIsAwarenessUpdatesConsented:
    """Unit tests for outbound_guard.is_awareness_updates_consented()"""

    def setup_method(self):
        import outbound_guard
        self.fn = outbound_guard.is_awareness_updates_consented

    def test_returns_true_when_updates_true(self):
        user = {"id": "u1", "consent_purposes": {"updates": True}}
        assert self.fn(user) is True, "Should return True when updates=True"

    def test_returns_false_when_updates_false(self):
        user = {"id": "u1", "consent_purposes": {"updates": False}}
        assert self.fn(user) is False, "Should return False when updates=False"

    def test_returns_false_when_updates_missing(self):
        user = {"id": "u1", "consent_purposes": {}}
        assert self.fn(user) is False, "Should return False when 'updates' key missing"

    def test_returns_false_when_consent_purposes_missing(self):
        user = {"id": "u1"}
        assert self.fn(user) is False, "Should return False when consent_purposes missing"

    def test_returns_false_when_consent_purposes_none(self):
        user = {"id": "u1", "consent_purposes": None}
        assert self.fn(user) is False, "Should return False when consent_purposes=None"

    def test_returns_false_when_user_none(self):
        assert self.fn(None) is False, "Should return False when user is None"

    def test_returns_false_when_user_empty_dict(self):
        assert self.fn({}) is False, "Should return False when user is empty dict"

    def test_returns_false_when_updates_zero(self):
        user = {"id": "u1", "consent_purposes": {"updates": 0}}
        assert self.fn(user) is False, "Should return False when updates=0 (falsy)"

    def test_returns_true_when_updates_truthy_string(self):
        # bool("true") is True in Python, should return True
        user = {"id": "u1", "consent_purposes": {"updates": "true"}}
        assert self.fn(user) is True, "Should return True when updates is truthy"

    def test_other_purposes_dont_affect_result(self):
        user = {"id": "u1", "consent_purposes": {"analytics": True, "updates": False, "safety": True}}
        assert self.fn(user) is False, "Only 'updates' key should matter"

    def test_true_with_other_purposes(self):
        user = {"id": "u1", "consent_purposes": {"analytics": False, "updates": True}}
        assert self.fn(user) is True


class TestBConsentGuardDocDeadlineWorker:
    """Check B-CONSENT-GUARD doc comment is in deadline_worker.py"""

    def test_b_consent_guard_in_module_docstring(self):
        sys.path.insert(0, '/app/backend/api')
        import deadline_worker
        doc = deadline_worker.__doc__ or ""
        assert "B-CONSENT-GUARD" in doc, (
            "B-CONSENT-GUARD exemption comment missing from deadline_worker.py module docstring"
        )

    def test_safety_path_exemption_mentioned(self):
        sys.path.insert(0, '/app/backend/api')
        import deadline_worker
        doc = deadline_worker.__doc__ or ""
        assert "SAFETY PATH" in doc or "safety" in doc.lower(), (
            "Safety path / purposes.updates exemption not documented in deadline_worker"
        )


class TestBConsentGuardDocTrustedCircleRouter:
    """Check B-CONSENT-GUARD doc comment is in trusted_circle_router.py"""

    def test_b_consent_guard_in_module_docstring(self):
        sys.path.insert(0, '/app/backend/api')
        import trusted_circle_router
        doc = trusted_circle_router.__doc__ or ""
        assert "B-CONSENT-GUARD" in doc, (
            "B-CONSENT-GUARD exemption comment missing from trusted_circle_router.py module docstring"
        )

    def test_transactional_path_exemption_mentioned(self):
        sys.path.insert(0, '/app/backend/api')
        import trusted_circle_router
        doc = trusted_circle_router.__doc__ or ""
        assert "TRANSACTIONAL PATH" in doc or "transactional" in doc.lower(), (
            "Transactional path exemption not documented in trusted_circle_router"
        )
