"""Layer S — Law Status Guard.

Loads law_status_registry.json once at startup (cached in memory).
Checks every retrieved provision against known status records.
UNKNOWN status is treated as NOT ACTIVE per spec.
Pure code — no LLM call. Cost: 0 ECU per invocation.
"""
from __future__ import annotations
import json
import logging
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


@lru_cache(maxsize=1)
def _load_registry() -> Dict[str, StatusRecord]:
    """Load and cache law_status_registry.json. Keyed by act_id (upper)."""
    try:
        raw = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
        records: Dict[str, StatusRecord] = {}
        for item in raw.get("registry", []):
            rec = StatusRecord.model_validate(item)
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
    """Try to find a registry record for a retrieved provision."""
    registry = _load_registry()
    act_name = (provision.get("act_name") or provision.get("act") or "").upper().strip()
    if not act_name:
        return None

    # Direct key lookup
    if act_name in registry:
        return registry[act_name]

    # Try known act aliases
    _ALIASES: Dict[str, str] = {
        "INDIAN PENAL CODE": "IPC_1860",
        "IPC": "IPC_1860",
        "CODE OF CRIMINAL PROCEDURE": "CRPC_1973",
        "CRPC": "CRPC_1973",
        "INDIAN EVIDENCE ACT": "EVIDENCE_ACT_1872",
        "BHARATIYA NYAYA SANHITA": "BNS_2023",
        "BNS": "BNS_2023",
        "BHARATIYA NAGARIK SURAKSHA SANHITA": "BNSS_2023",
        "BNSS": "BNSS_2023",
        "BHARATIYA SAKSHYA ADHINIYAM": "BSA_2023",
        "BSA": "BSA_2023",
        "FOREIGN EXCHANGE REGULATION ACT": "FERA_1973",
        "FERA": "FERA_1973",
        "PLACES OF WORSHIP": "PLACES_OF_WORSHIP_1991",
        "PREVENTION OF TERRORISM ACT": "POTA_2002",
        "POTA": "POTA_2002",
        "DIGITAL PERSONAL DATA PROTECTION": "DPDP_2023",
        "DPDP": "DPDP_2023",
    }
    for alias, act_id in _ALIASES.items():
        if alias in act_name:
            return registry.get(act_id.upper())

    return None


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

        annotated.append(prov_copy)

    return annotated
