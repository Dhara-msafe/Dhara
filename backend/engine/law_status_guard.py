"""Layer S — Law Status Guard.

Loads law_status_registry.json once at startup (cached in memory).
Checks every retrieved provision against known status records.
UNKNOWN status is treated as NOT ACTIVE per spec.
Pure code — no LLM call. Cost: 0 ECU per invocation.
"""
from __future__ import annotations
import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from engine.models import StatusRecord
from engine.approval_evidence import check_approval, compute_content_hash

logger = logging.getLogger("gandhikar")

_REGISTRY_PATH = Path(__file__).parent.parent / "data" / "law_status_registry.json"

# Statuses that mean the law should NOT be presented as currently authoritative
_INACTIVE_STATUSES = {"REPEALED", "SUPERSEDED", "STRUCK_DOWN", "UNKNOWN"}
# Statuses that require a warning annotation but the provision may partially apply
_WARN_STATUSES = {"AMENDED", "PARTIALLY_ACTIVE", "READ_DOWN", "STAYED", "NOT_YET_EFFECTIVE"}


# ── Alias matching constants (module-level for performance) ──────────────────
# Maps textual aliases / abbreviations → registry act_id keys (UPPER-CASED).
# All comparisons are done on the upper-cased act_name from the provision.
_ALIASES: Dict[str, str] = {
    "INDIAN PENAL CODE":                            "IPC_1860",
    "IPC":                                          "IPC_1860",
    "CODE OF CRIMINAL PROCEDURE":                   "CRPC_1973",
    "CRPC":                                         "CRPC_1973",
    "INDIAN EVIDENCE ACT":                          "EVIDENCE_ACT_1872",
    "BHARATIYA NYAYA SANHITA":                      "BNS_2023",
    "BNS":                                          "BNS_2023",
    "BHARATIYA NAGARIK SURAKSHA SANHITA":           "BNSS_2023",
    "BNSS":                                         "BNSS_2023",
    "BHARATIYA SAKSHYA ADHINIYAM":                  "BSA_2023",
    "BSA":                                          "BSA_2023",
    "FOREIGN EXCHANGE REGULATION ACT":              "FERA_1973",
    "FERA":                                         "FERA_1973",
    "PLACES OF WORSHIP":                            "PLACES_OF_WORSHIP_1991",
    "PREVENTION OF TERRORISM ACT":                  "POTA_2002",
    "POTA":                                         "POTA_2002",
    "DIGITAL PERSONAL DATA PROTECTION":             "DPDP_2023",
    "DPDP":                                         "DPDP_2023",
    # H3 Phase 2 — six sourced central Acts
    "MV":                                           "MVA_1988",
    "MOTOR VEHICLES ACT":                           "MVA_1988",
    "MOTOR VEHICLES":                               "MVA_1988",
    "RTI":                                          "RTI_2005",
    "RIGHT TO INFORMATION ACT":                     "RTI_2005",
    "RIGHT TO INFORMATION":                         "RTI_2005",
    "PWDVA":                                        "PWDVA_2005",
    "PROTECTION OF WOMEN FROM DOMESTIC VIOLENCE":   "PWDVA_2005",
    "DOMESTIC VIOLENCE ACT":                        "PWDVA_2005",
    "CPA":                                          "CPA_2019",
    "CONSUMER PROTECTION ACT":                      "CPA_2019",
    "CONSUMER PROTECTION":                          "CPA_2019",
    "CODE ON WAGES":                                "COW_2019",
    "INDUSTRIAL RELATIONS CODE":                    "IRC_2020",
    # H4 Phase 1 — four additional sourced central Acts
    "NI":                                           "NI_1881",
    "NEGOTIABLE INSTRUMENTS ACT":                   "NI_1881",
    "NEGOTIABLE INSTRUMENTS":                       "NI_1881",
    "INFORMATION TECHNOLOGY ACT":                   "IT_2000",
    "INFORMATION TECHNOLOGY":                       "IT_2000",
    "POCSO":                                        "POCSO_2012",
    "PROTECTION OF CHILDREN FROM SEXUAL OFFENCES":  "POCSO_2012",
    "PMLA":                                         "PMLA_2002",
    "PREVENTION OF MONEY LAUNDERING ACT":           "PMLA_2002",
    "PREVENTION OF MONEY LAUNDERING":               "PMLA_2002",
}

# Canonical year for each act_id that is year-specific.
# When a provision's act_name carries an explicit year that DIFFERS from
# this canonical year, the alias is rejected to prevent cross-era false
# positives:  "Consumer Protection Act, 1986" ≠ CPA_2019  (1986 ≠ 2019)
#             "Motor Vehicles Act, 1939"       ≠ MVA_1988  (1939 ≠ 1988)
_ALIAS_CANONICAL_YEARS: Dict[str, str] = {
    "IPC_1860":               "1860",
    "EVIDENCE_ACT_1872":      "1872",
    "CRPC_1973":              "1973",
    "FERA_1973":              "1973",
    "PLACES_OF_WORSHIP_1991": "1991",
    "POTA_2002":              "2002",
    "PWDVA_2005":             "2005",
    "RTI_2005":               "2005",
    "MVA_1988":               "1988",
    "CPA_2019":               "2019",
    "COW_2019":               "2019",
    "IRC_2020":               "2020",
    "DPDP_2023":              "2023",
    "BNS_2023":               "2023",
    "BNSS_2023":              "2023",
    "BSA_2023":               "2023",
    # H4 Phase 1
    "NI_1881":                "1881",
    "IT_2000":                "2000",
    "POCSO_2012":             "2012",
    "PMLA_2002":              "2002",
}

# Pre-compiled regex: matches 4-digit years in range 1800–2099
_YEAR_RE = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")


def _is_whole_word_match(alias: str, text: str) -> bool:
    r"""Return True iff *alias* appears in *text* as a whole token / phrase.

    Uses \b word-boundary anchors so short abbreviations like 'RTI' will NOT
    match inside longer words such as 'PARTITION', 'ARTILLERY', or 'MARTIN'.
    Works identically for multi-word phrases like 'MOTOR VEHICLES ACT':
    the boundary is checked only at the very start and very end of the phrase.

    Examples::

        _is_whole_word_match("RTI", "PARTITION OF ESTATES ACT")  → False
        _is_whole_word_match("RTI", "RTI ACT 2005")               → True
        _is_whole_word_match("MOTOR VEHICLES", "MOTOR VEHICLES TAXATION ACT")  → True
    """
    return bool(re.search(r"\b" + re.escape(alias) + r"\b", text))


@lru_cache(maxsize=1)
def _load_registry() -> Dict[str, StatusRecord]:
    """Load and cache law_status_registry.json. Keyed by act_id (upper)."""
    try:
        raw = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
        records: Dict[str, StatusRecord] = {}
        for item in raw.get("registry", []):
            rec = StatusRecord.model_validate(item)
            # Blank-source loader check (H3 Phase 2): reject entries with no source_url.
            # A sourced URL is required; absence means the status was asserted without evidence.
            if not rec.source_url or not rec.source_url.strip():
                logger.warning(
                    "[law_status_guard] registry entry %r has blank source_url — skipped (loader check)",
                    rec.act_id,
                )
                continue
            records[rec.act_id.upper()] = rec
            # Also index by short fragments for fuzzy matching
            for frag in _name_fragments(rec.short_name):
                if frag not in records:  # don't overwrite primary key
                    records[frag] = rec
        logger.info("[law_status_guard] loaded %d records", len(raw.get("registry", [])))
        return records
    except Exception as e:
        logger.error("[law_status_guard] failed to load registry: %s", e)
        return {}


def _name_fragments(short_name: str) -> List[str]:
    """Generate lookup keys from a short act name."""
    name = short_name.upper()
    fragments = [name]
    # Abbreviation: first letter of each significant word
    stop_words = {"THE", "OF", "AND", "ACT", "CODE", "A", "AN", "IN", "FOR", "TO"}
    words = name.replace(",", "").replace("(", "").replace(")", "").split()
    abbrev = "".join(w[0] for w in words if w not in stop_words)
    if len(abbrev) >= 2:
        fragments.append(abbrev)
    # Year-stripped name
    year_stripped = " ".join(w for w in words if not w.isdigit())
    if year_stripped != name:
        fragments.append(year_stripped)
    return fragments


def _match_provision_to_registry(provision: dict) -> Optional[StatusRecord]:
    """Try to find a registry record for a retrieved provision.

    Matching strategy (in order):
    1. Direct key lookup against the registry index (catches exact short_name
       and the abbreviated / year-stripped fragments generated by _name_fragments).
    2. Whole-word, year-aware alias scan:
       a. Each alias is tested with \\b word-boundary anchors so that short
          abbreviations like 'RTI' cannot match inside longer words — e.g.
          'RTI' will NOT match 'PARTITION', 'ARTILLERY', or 'MARTIN'.
       b. If act_name carries an explicit year (1800–2099) AND the alias
          targets a year-specific act (see _ALIAS_CANONICAL_YEARS), the alias
          is rejected when the years differ — e.g. 'Consumer Protection Act,
          1986' must NOT be matched to CPA_2019 (1986 ≠ 2019).
       c. The longest matching alias wins (more specific alias preferred).
       d. If two equal-length aliases map to *different* act_ids the result
          is ambiguous and None is returned (fail-safe, not fail-open).
    """
    registry = _load_registry()
    act_name = (provision.get("act_name") or provision.get("act") or "").upper().strip()
    if not act_name:
        return None

    # 1. Direct key lookup (exact match or pre-indexed fragment)
    if act_name in registry:
        return registry[act_name]

    # 2a. Extract explicit year from act_name (for cross-era year guard)
    year_m = _YEAR_RE.search(act_name)
    act_year: Optional[str] = year_m.group(1) if year_m else None

    # 2b. Collect all whole-word matches that also pass the year guard
    candidates: List[Tuple[int, str]] = []  # (alias_length, act_id_upper)
    for alias, act_id in _ALIASES.items():
        # Whole-word / whole-phrase boundary check
        if not _is_whole_word_match(alias, act_name):
            continue
        # Year guard: reject if act_name's year contradicts the alias's canonical year
        canonical_year = _ALIAS_CANONICAL_YEARS.get(act_id.upper())
        if act_year and canonical_year and act_year != canonical_year:
            continue
        candidates.append((len(alias), act_id.upper()))

    if not candidates:
        return None

    # 2c. Longest match wins (most specific alias preferred)
    candidates.sort(key=lambda x: -x[0])
    best_len = candidates[0][0]
    best = [c for c in candidates if c[0] == best_len]

    # 2d. Ambiguity guard: two equal-length aliases targeting different acts → None
    unique_ids = {c[1] for c in best}
    if len(unique_ids) > 1:
        logger.warning(
            "[law_status_guard] ambiguous alias match for act=%r — "
            "equal-length candidates=%r — returning None (fail-safe)",
            act_name[:80], [c[1] for c in best],
        )
        return None

    return registry.get(best[0][1])


def check_provision(
    provision: dict,
) -> Tuple[str, Optional[StatusRecord]]:
    """Check a single provision's law status.

    Returns:
        (status_label, record_or_None)
        status_label: 'ACTIVE' | 'INACTIVE' | 'WARN' | 'UNKNOWN' | 'NOT_IN_REGISTRY'
    """
    rec = _match_provision_to_registry(provision)
    if rec is None:
        return "NOT_IN_REGISTRY", None

    if rec.status in _INACTIVE_STATUSES:
        return "INACTIVE", rec
    if rec.status in _WARN_STATUSES:
        return "WARN", rec
    return "ACTIVE", rec


def annotate_provisions(
    provisions: List[dict],
    source_tag: str = "db",
    approval_registry: Optional[List[dict]] = None,
) -> List[dict]:
    """Annotate each provision with law status info in-place (new dict copy).

    Provisions with INACTIVE status get a dead_warning prepended.
    This is the single source of truth for law-status display.

    `approval_registry`: normally None (uses the real, currently-empty,
    on-disk approval-evidence registry — see engine.approval_evidence).
    Tests may pass an explicit in-memory list of synthetic approval records
    to exercise the approved/revoked/hash-mismatch paths without ever
    touching the real registry file.
    """
    annotated: List[dict] = []
    for prov in provisions:
        prov_copy = dict(prov)
        status_label, rec = check_provision(prov)

        if status_label == "INACTIVE" and rec:
            if prov_copy.get("historical_still_applicable"):
                # P0 containment (T03): `historical_still_applicable` is a
                # blanket hand-authored tag on the WHOLE corpus_ipc.py
                # dataset (set once, in source, for every entry) — it is
                # NOT a per-record approval from an authorized legal
                # reviewer, and must never by itself grant the "this old
                # text still governs" framing. Require an active, exact
                # content-hash-bound approval record before granting it;
                # missing/revoked/hash-mismatched/malformed evidence falls
                # through to the standard dead-law warning below instead —
                # fail closed, not "treat as historical by default".
                _act_for_key = (prov.get("act_name") or prov.get("act") or "").strip()
                _subject_key = (
                    prov_copy.get("key")
                    or f"{_act_for_key}|{prov.get('section_number') or prov.get('short_label') or ''}"
                )
                _content_hash = compute_content_hash(
                    prov_copy.get("official_text") or prov_copy.get("section_text") or ""
                )
                _approval = check_approval("historical_applicability", _subject_key, _content_hash, registry=approval_registry)
                if _approval.approved:
                    prov_copy["historical_notice"] = (
                        f"Historical note: {rec.short_name} was replaced by "
                        f"{rec.successor_act or 'newer legislation'} for new matters. "
                        f"This provision remains the governing law for events, FIRs, "
                        f"and trials from before that date."
                    )
                    prov_copy["_law_status"] = rec.status
                    prov_copy["_successor_act"] = rec.successor_act
                    prov_copy["_approval_reviewer"] = _approval.reviewer_id
                    prov_copy["_approval_id"] = _approval.approval_id
                    logger.info(
                        "[law_status_guard] INACTIVE-but-historical act=%r status=%s (approved by reviewer=%s, not marked dead)",
                        rec.short_name[:60], rec.status, _approval.reviewer_id,
                    )
                    annotated.append(prov_copy)
                    continue
                else:
                    logger.warning(
                        "[law_status_guard] historical_still_applicable REJECTED for subject=%r reason=%s "
                        "(no valid reviewer approval) — falling back to standard dead-law warning",
                        _subject_key, _approval.reason,
                    )
            existing_warn = prov_copy.get("dead_warning") or ""
            guard_msg = (
                f"⚠️ [LAW_STATUS_GUARD] '{rec.short_name}' is {rec.status}. "
                f"{rec.status_reason} "
                + (f"Successor: {rec.successor_act}." if rec.successor_act else "")
            )
            prov_copy["dead_warning"] = (
                (guard_msg + "\n\n" + existing_warn).strip()
                if existing_warn else guard_msg
            )
            prov_copy["is_dead_law"] = True
            prov_copy["_law_status"] = rec.status
            prov_copy["_successor_act"] = rec.successor_act
            logger.info(
                "[law_status_guard] INACTIVE act=%r status=%s successor=%r",
                rec.short_name[:60], rec.status, rec.successor_act,
            )

        elif status_label == "WARN" and rec:
            existing_warn = prov_copy.get("dead_warning") or ""
            warn_msg = (
                f"⚠️ [LAW_STATUS] '{rec.short_name}' status: {rec.status}. "
                f"{rec.status_reason}"
            )
            prov_copy["dead_warning"] = (
                (warn_msg + "\n\n" + existing_warn).strip()
                if existing_warn else warn_msg
            )
            prov_copy["_law_status"] = rec.status

        elif status_label == "ACTIVE" and rec:
            # Mark confirmed-active provisions internally (H3 Phase 2).
            # No user-facing text; the marker enables analytics and test assertions.
            prov_copy["_law_status"] = "ACTIVE"

        elif status_label == "NOT_IN_REGISTRY":
            # Fix 1 Option B (H2b): act is absent from the verified registry.
            # H3 Phase 2: distinguish state-jurisdiction provisions from genuinely
            # unregistered central Acts — the central registry cannot confirm state law status.
            # Graduate Fix 1: central Acts that are NOT_IN_REGISTRY now receive a soft
            # user-facing registry_gap_note (NOT dead_warning — that is reserved for known
            # INACTIVE acts). This uses a separate field so the INACTIVE/WARN rendering
            # paths are completely unaffected.
            act_hint = (prov.get("act_name") or prov.get("act") or "<no act name>").strip()
            if prov.get("state"):
                prov_copy["_law_status"] = "STATE_NOT_CHECKED"
                logger.info(
                    "[law_status_guard] STATE_NOT_CHECKED state=%r act=%r — "
                    "central registry does not cover state Acts",
                    prov["state"], act_hint,
                )
            else:
                prov_copy["_law_status"] = "NOT_IN_REGISTRY"
                if act_hint and act_hint != "<no act name>":
                    prov_copy["registry_gap_note"] = (
                        f"ℹ️ Dhara has not verified the current status of '{act_hint}'. "
                        "This provision may have been amended or superseded — "
                        "confirm with an official source or consult an advocate."
                    )
                logger.info(
                    "[law_status_guard] NOT_IN_REGISTRY act=%r — "
                    "registry gap note set for user; no dead_warning (Graduate Fix 1)",
                    act_hint,
                )

        annotated.append(prov_copy)

    return annotated
