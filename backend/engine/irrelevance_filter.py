"""Layer H — Irrelevance Filter.

Applies four hard guards and a domain-match score to remove provisions
that are irrelevant to the query's action+domain.
Pure code — no LLM call. Cost: 0 ECU per invocation.
"""
from __future__ import annotations
import logging
from typing import List, Optional, Tuple

from engine.models import LegalQuery, ClassifyResult, ApplicabilityScore

logger = logging.getLogger("gandhikar")

# ── Hard guard definitions ────────────────────────────────────────────────────
# Each guard: (guard_id, description, trigger_fn, classification, reason)

# Guard G1 — enter/trespass + Places of Worship (Special Provisions) Act 1991
# The Act governs *religious character conversion*, NOT visitor access.
_POW_ACT_FRAGMENTS = [
    "places of worship",
    "special provisions",
    "1991",
    "religious character",
]
_ENTRY_ACTIONS = {"enter", "exit", "visit", "restrict_access", "refuse_entry", "trespass"}

# Guard G2 — IPC/CrPC hits for queries AFTER 1 July 2024
# IPC/CrPC were superseded by BNS/BNSS on that date.
_LEGACY_CRIMINAL_ACTS = {"indian penal code", "ipc", "code of criminal procedure", "crpc"}

# Guard G3 — BHU Act / University Acts for marriage/property queries
_UNIVERSITY_ACT_FRAGMENTS = {"university", "bhu", "vishwavidyalaya"}
_MARRIAGE_PROPERTY_ISSUES = {
    "property_transfer", "marriage_and_family", "matrimonial_property",
}

# Guard G4 — Designs Act for non-design queries
_DESIGNS_ACT_FRAGMENTS = {"designs act", "design registration"}


def _act_text(provision: dict) -> str:
    """Normalise act name for guard matching."""
    act = (provision.get("act") or provision.get("act_name") or "").lower()
    label = (provision.get("short_label") or "").lower()
    return f"{act} {label}"


def _apply_guards(
    provision: dict,
    lq: LegalQuery,
    classify: ClassifyResult,
) -> Optional[ApplicabilityScore]:
    """Return an ApplicabilityScore if a guard fires, else None."""
    act_text = _act_text(provision)
    actions = set(lq.actions or [])
    domain = classify.primary_domain

    # ── GUARD G1: entry action + Places of Worship Act → IRRELEVANT ──────────
    if any(frag in act_text for frag in _POW_ACT_FRAGMENTS):
        if _ENTRY_ACTIONS & actions:
            return ApplicabilityScore(
                provision=str(provision.get("short_label", "")),
                act=str(provision.get("act_name", "")),
                section=str(provision.get("section_number", "")),
                classification="IRRELEVANT",
                reason=(
                    "ACTION is 'enter'/'visit' — Places of Worship (Special Provisions) Act 1991 "
                    "governs *religious character conversion*, not visitor access. "
                    "Correct domain: property_access / BNS criminal trespass."
                ),
                guard_triggered="G1_pow_entry",
            )

    # ── GUARD G2: IPC/CrPC hits are SUPERSEDED if query date ≥ 2024-07-01 ────
    # event_date=None means the query is about current law → also applies.
    event_date = lq.event_date or ""
    is_post_july_2024 = (not event_date) or (event_date >= "2024-07-01")
    # P0 fix: historical_still_applicable must only exempt a provision from
    # SUPERSEDED when THIS query's own event is genuinely pre-cutover. An
    # explicit event_date before 2024-07-01 is required — a current-law
    # question (no event_date at all) or a post-cutover event must never be
    # exempted just because the matched text happens to be a hand-curated
    # historical corpus_ipc.py entry. Without this, the historical framing
    # could be unconditionally applied to a brand-new incident, presenting
    # dead IPC/CrPC law as if it were still in force today.
    _is_genuinely_historical_event = bool(event_date) and event_date < "2024-07-01"
    if is_post_july_2024 and any(frag in act_text for frag in _LEGACY_CRIMINAL_ACTS):
        # Check if the provision itself carries a dead_law or no_current_text flag
        # (the corpus already marks these). Promote SUPERSEDED only if NOT already
        # flagged — and NEVER for a corpus_ipc.py entry tagged
        # historical_still_applicable=True ON A GENUINELY HISTORICAL QUERY: that
        # flag means this specific text was hand-verified to answer a historical
        # IPC/CrPC question correctly (pre-cutover events/FIRs/trials), and must
        # reach Layer S (law_status_guard) un-rejected so it gets the
        # historical-notice treatment there, not be silently dropped here before
        # Layer S ever sees it.
        if not provision.get("is_dead_law") and not provision.get("no_current_text") \
                and not (provision.get("historical_still_applicable") and _is_genuinely_historical_event):
            return ApplicabilityScore(
                provision=str(provision.get("short_label", "")),
                act=str(provision.get("act_name", "")),
                section=str(provision.get("section_number", "")),
                classification="SUPERSEDED",
                reason=(
                    "IPC/CrPC were superseded by BNS/BNSS effective 1 July 2024. "
                    "This provision may no longer be in force for current incidents. "
                    "Serve the BNS/BNSS equivalent instead."
                ),
                guard_triggered="G2_legacy_criminal",
            )

    # ── GUARD G3: University Acts for marriage/property queries ──────────────
    if domain in _MARRIAGE_PROPERTY_ISSUES:
        if any(frag in act_text for frag in _UNIVERSITY_ACT_FRAGMENTS):
            return ApplicabilityScore(
                provision=str(provision.get("short_label", "")),
                act=str(provision.get("act_name", "")),
                section=str(provision.get("section_number", "")),
                classification="IRRELEVANT",
                reason=(
                    "University Act is irrelevant to a marriage/property query. "
                    "Applicable law: Hindu Succession Act / HMA / SMA / applicable personal law."
                ),
                guard_triggered="G3_university_marriage",
            )

    # ── GUARD G4: Designs Act for non-design-registration queries ────────────
    telecom_or_sim = any(
        w in (" ".join(lq.candidate_issues + lq.objects + lq.actions)).lower()
        for w in ("sim", "telecom", "mobile", "tafcop", "sanchar", "phone")
    )
    if telecom_or_sim and any(frag in act_text for frag in _DESIGNS_ACT_FRAGMENTS):
        return ApplicabilityScore(
            provision=str(provision.get("short_label", "")),
            act=str(provision.get("act_name", "")),
            section=str(provision.get("section_number", "")),
            classification="IRRELEVANT",
            reason=(
                "Designs Act governs industrial design registration, not SIM/telecom issues. "
                "Correct source: TAFCOP portal / DoT / IT Act."
            ),
            guard_triggered="G4_designs_telecom",
        )

    return None  # no guard fired


def filter_provisions(
    provisions: List[dict],
    lq: LegalQuery,
    classify: ClassifyResult,
    source_tag: str = "corpus",   # 'corpus' or 'db'
) -> Tuple[List[dict], List[ApplicabilityScore]]:
    """Apply all guards. Return (kept_provisions, rejected_scores).

    kept_provisions:  pass to law_status_guard and then to the LLM
    rejected_scores:  logged + used to annotate db_hits with dead_warning
    """
    kept: List[dict] = []
    rejected: List[ApplicabilityScore] = []

    for prov in provisions:
        score = _apply_guards(prov, lq, classify)
        if score is not None:
            rejected.append(score)
            logger.info(
                "[irr_filter] REJECTED guard=%s act=%r reason=%s",
                score.guard_triggered,
                score.act[:60],
                score.reason[:80],
            )
            # Inject the guard reason as a dead_warning so the frontend
            # can display it in the citation card instead of silently dropping.
            annotated = dict(prov)
            annotated["dead_warning"] = (
                f"⚠️ [{score.guard_triggered}] {score.reason}"
            )
            annotated["_irr_filter_rejected"] = True
        else:
            kept.append(prov)

    if rejected:
        logger.info(
            "[irr_filter] source=%s total=%d kept=%d rejected=%d",
            source_tag, len(provisions), len(kept), len(rejected),
        )

    return kept, rejected
