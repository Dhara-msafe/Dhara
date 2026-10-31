"""
AT43 Guardian Authorization Tests — DHARA P2

Verify that every rights_card in the database carries the required
Guardian Authorization evidence fields introduced under
GO: 2026-10-31 (user authorised).

Tests:
  T1 — every card has verified_by.reviewer_id  (non-empty string)
  T2 — every card has verified_by.review_date   (YYYY-MM-DD format)
  T3 — every card has review_artefact_url        (non-empty string, https://)
  T4 — verified_by.reviewer_id is the authorized reviewer
  T5 — review_artefact_url is a known legislative/authoritative domain
  T6 — every LEGAL_REVIEWED card has all three fields (no card is partially filled)
  T7 — total cards in DB is at least 10 (seed completed successfully)
"""
from __future__ import annotations

import asyncio
import os
import re
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from dependencies import db  # noqa: E402

# ── Known authorized reviewers ────────────────────────────────────────────────
_AUTHORIZED_REVIEWERS = {"callistus-moses-founder"}

# ── Domains accepted as authoritative artefact sources ───────────────────────
_AUTHORITATIVE_DOMAINS = (
    "legislative.gov.in",
    "indiacode.gov.in",
    "nalsa.gov.in",
    "mha.gov.in",
    "ncw.nic.in",
    "wcd.nic.in",
)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _load_cards():
    """Load all English rights_cards from MongoDB synchronously."""
    async def _fetch():
        return await db.rights_cards.find({"language": "en"}).to_list(length=50)
    return asyncio.run(_fetch())


# Load once at import time (module-level, not per-test)
_CARDS = _load_cards()


class TestGuardianAuthorizationEvidence:
    """AT43 authorized-reviewer sub-claim: each rights_card must carry
    reviewer_id, review_date, and review_artefact_url."""

    # ── T1: reviewer_id present and non-empty ────────────────────────────────

    def test_t1_all_cards_have_reviewer_id(self):
        missing = []
        for c in _CARDS:
            vb = c.get("verified_by") or {}
            if not vb.get("reviewer_id"):
                missing.append(c.get("scenario_key", c.get("card_id")))
        assert not missing, (
            f"Cards missing verified_by.reviewer_id: {missing}"
        )

    # ── T2: review_date present and YYYY-MM-DD format ────────────────────────

    def test_t2_all_cards_have_review_date(self):
        bad = []
        for c in _CARDS:
            vb = c.get("verified_by") or {}
            d = vb.get("review_date") or ""
            if not _DATE_RE.match(d):
                bad.append((c.get("scenario_key"), repr(d)))
        assert not bad, (
            f"Cards with missing/malformed review_date (expected YYYY-MM-DD): {bad}"
        )

    # ── T3: review_artefact_url present and starts with https:// ─────────────

    def test_t3_all_cards_have_artefact_url(self):
        bad = []
        for c in _CARDS:
            url = c.get("review_artefact_url") or ""
            if not url.startswith("https://"):
                bad.append((c.get("scenario_key"), url[:60]))
        assert not bad, (
            f"Cards missing/invalid review_artefact_url: {bad}"
        )

    # ── T4: reviewer_id is in the authorized-reviewer allow-list ─────────────

    def test_t4_reviewer_id_is_authorized(self):
        unauthorized = []
        for c in _CARDS:
            vb = c.get("verified_by") or {}
            rid = vb.get("reviewer_id") or ""
            if rid and rid not in _AUTHORIZED_REVIEWERS:
                unauthorized.append((c.get("scenario_key"), rid))
        assert not unauthorized, (
            f"Cards have unauthorized reviewer_id: {unauthorized}"
        )

    # ── T5: artefact_url domain is authoritative ─────────────────────────────

    def test_t5_artefact_url_is_authoritative_domain(self):
        bad = []
        for c in _CARDS:
            url = c.get("review_artefact_url") or ""
            if not any(d in url for d in _AUTHORITATIVE_DOMAINS):
                bad.append((c.get("scenario_key"), url[:80]))
        assert not bad, (
            f"Cards with non-authoritative artefact_url: {bad}"
        )

    # ── T6: LEGAL_REVIEWED cards must have all three auth fields ─────────────

    def test_t6_legal_reviewed_cards_have_complete_auth_fields(self):
        incomplete = []
        for c in _CARDS:
            if c.get("release_state") != "LEGAL_REVIEWED":
                continue
            vb          = c.get("verified_by") or {}
            reviewer_ok = bool(vb.get("reviewer_id"))
            date_ok     = bool(_DATE_RE.match(vb.get("review_date") or ""))
            artefact_ok = (c.get("review_artefact_url") or "").startswith("https://")
            if not (reviewer_ok and date_ok and artefact_ok):
                incomplete.append({
                    "key":          c.get("scenario_key"),
                    "reviewer_id":  reviewer_ok,
                    "review_date":  date_ok,
                    "artefact_url": artefact_ok,
                })
        assert not incomplete, (
            f"LEGAL_REVIEWED cards with incomplete guardian auth: {incomplete}"
        )

    # ── T7: at least 10 cards seeded ─────────────────────────────────────────

    def test_t7_minimum_card_count(self):
        assert len(_CARDS) >= 10, (
            f"Expected at least 10 rights_cards, found {len(_CARDS)}. "
            "Run seed_women_cards.py first."
        )
