"""
test_dau_mau_regex_anchor.py — regression tests for the DAU/MAU test-account
exclusion regex anchoring fix.

Issue: the previous unanchored regex  TEST_|safety_test_  matched emails that
       contain those substrings anywhere, e.g.:
         "alice@company-safety_test_partner.com"  → false positive (real user)
         "bob+TEST_variant@real.org"               → false positive (real user)

Fix:  anchored to  ^TEST_|^safety_test_|@guest\\.dhara\\.local  so only emails
      that LITERALLY START with the prefix are excluded.

These tests use Python re (IGNORECASE) to mirror MongoDB's $options:"i" behaviour.
"""

import re
import pytest

# The exact pattern now in production server.py
PATTERN = re.compile(r"^TEST_|^safety_test_|@guest\.dhara\.local", re.I)


def is_excluded(email: str) -> bool:
    return bool(PATTERN.search(email))


# ── Should be EXCLUDED (test / guest accounts) ────────────────────────────────

class TestExcludedAccounts:
    def test_test_prefix_uppercase(self):
        assert is_excluded("TEST_scenario1@dhara.local")

    def test_test_prefix_lowercase_ci(self):
        assert is_excluded("test_scenario1@dhara.local")

    def test_test_prefix_mixed_case(self):
        assert is_excluded("Test_Scenario@dhara.local")

    def test_safety_test_prefix(self):
        assert is_excluded("safety_test_user@dhara.local")

    def test_safety_test_prefix_uppercase_ci(self):
        assert is_excluded("SAFETY_TEST_admin@dhara.local")

    def test_guest_dhara_domain(self):
        assert is_excluded("anon123@guest.dhara.local")

    def test_guest_dhara_domain_any_localpart(self):
        assert is_excluded("x@guest.dhara.local")


# ── Should be INCLUDED (real accounts that previously were false-positives) ───

class TestIncludedRealAccounts:
    def test_email_with_test_substring_in_domain(self):
        """Domain contains 'TEST_' but email does NOT start with TEST_."""
        assert not is_excluded("alice@TEST_company.org")

    def test_email_with_safety_test_in_domain(self):
        """Domain contains safety_test substring — must NOT be excluded."""
        assert not is_excluded("bob@safety_test_partner.com")

    def test_email_with_test_in_local_part_middle(self):
        """Local part contains TEST_ in the middle — not a test account."""
        assert not is_excluded("user+TEST_variant@real.org")

    def test_email_with_test_in_display_name_position(self):
        """TEST_ appears after the + subaddress separator."""
        assert not is_excluded("priya+TEST_extra@gmail.com")

    def test_plain_real_email(self):
        assert not is_excluded("priya@example.com")

    def test_real_email_with_numbers(self):
        assert not is_excluded("user123@dhara.app")

    def test_real_email_no_test_prefix(self):
        assert not is_excluded("anand.kumar@advocate.in")

    def test_safety_substring_not_prefix(self):
        """'safety_test' appears but NOT at the start."""
        assert not is_excluded("contact@safety_test_reporting.org")

    def test_empty_string_not_excluded(self):
        assert not is_excluded("")

    def test_plain_test_without_underscore_not_excluded(self):
        """'test' alone (no underscore) is not a match — only TEST_ is excluded."""
        assert not is_excluded("testuser@real.com")


# ── Anchoring invariant: the ^ must be meaningful ─────────────────────────────

class TestAnchorInvariant:
    def test_prefix_match_only_at_start(self):
        """Prove ^ is doing work: same token in the middle is NOT excluded."""
        with_prefix  = "TEST_account@dhara.app"
        without_prefix = "real_TEST_account@dhara.app"
        assert     is_excluded(with_prefix),    "TEST_ at start → excluded"
        assert not is_excluded(without_prefix), "TEST_ in middle → included"

    def test_safety_prefix_match_only_at_start(self):
        with_prefix    = "safety_test_user@test.com"
        without_prefix = "user_safety_test_@test.com"
        assert     is_excluded(with_prefix),    "safety_test_ at start → excluded"
        assert not is_excluded(without_prefix), "safety_test_ in middle → included"
