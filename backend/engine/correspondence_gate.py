"""Correspondence approval gate (Emergent support fixes 2 and 3).

Any statement that an old-code section (IPC / CrPC / Evidence Act)
corresponds to, or was succeeded by, a new-code section (BNS / BNSS / BSA)
is a relationship claim. It may only be released when
engine.approval_evidence holds an active, hash-bound approval of
record_type "correspondence" whose subject_key binds BOTH sides and whose
reviewer is on the authorized allowlist. Everything else fails closed.

The approval is bound to one record in ipc_bns_mapping.json:
  subject_key  = "<SRC_CODE>:<src_section>-><TGT_CODE>:<tgt_section>"
                 e.g. "IPC:166A->BNS:199"
  content_hash = sha256 of canonical sorted-key JSON of that record's
                 substantive fields (both sections, offence/provision text,
                 punishment_note, what_changed).
The same approval therefore releases the pair on every surface (the
/advocate/cross-reference endpoint and the chat successor paths).

Authentication, user roles, the `verified` / `reviewed_by` fields in the
mapping data, ADMIN_KEY and seed timestamps never release a correspondence.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator, List, Optional, Tuple

from engine.approval_evidence import ApprovalCheckResult, check_approval, compute_content_hash

logger = logging.getLogger("gandhikar")

RECORD_TYPE = "correspondence"
_MAPPING_PATH = Path(__file__).parent.parent / "ipc_bns_mapping.json"

_OLD_KEYS = (
    ("ipc_section", "IPC"),
    ("crpc_section", "CRPC"),
    ("evidence_act_section", "EVIDENCE_ACT"),
    ("iea_section", "EVIDENCE_ACT"),
)
_NEW_KEYS = (
    ("bns_section", "BNS", "bns_subsection"),
    ("bnss_section", "BNSS", "bnss_subsection"),
    ("bsa_section", "BSA", "bsa_subsection"),
)
_ACT_NAME_TO_CODE = (
    ("indian penal code", "IPC"),
    ("code of criminal procedure", "CRPC"),
    ("indian evidence act", "EVIDENCE_ACT"),
    ("nagarik suraksha", "BNSS"),
    ("nyaya sanhita", "BNS"),
    ("sakshya", "BSA"),
    ("bnss", "BNSS"),
    ("bns", "BNS"),
    ("bsa", "BSA"),
    ("ipc", "IPC"),
    ("crpc", "CRPC"),
)
_SECTION_IN_LABEL_RE = re.compile(r"(?:section|sec\.?|s\.|§)\s*([0-9]+[A-Za-z]{0,3}(?:\s*\(\s*[0-9A-Za-z]+\s*\))?)", re.IGNORECASE)


def _norm_sec(v: Any) -> str:
    return re.sub(r"\s+", "", str(v)).upper() if v not in (None, "") else ""


def act_code(act_name: Any) -> str:
    low = str(act_name or "").strip().lower()
    for needle, code in _ACT_NAME_TO_CODE:
        if needle in low:
            return code
    return ""


def correspondence_subject_key(source_code: str, source_section: Any, target_code: str, target_section: Any) -> str:
    return f"{(source_code or '').upper()}:{_norm_sec(source_section)}->{(target_code or '').upper()}:{_norm_sec(target_section)}"


def correspondence_content_hash(source_section: Any, target_section: Any, provision_text: Any = "",
                                punishment_note: Any = "", what_changed: Any = "") -> str:
    canonical = json.dumps(
        {
            "source_section": _norm_sec(source_section),
            "target_section": _norm_sec(target_section),
            "provision_text": str(provision_text or "").strip(),
            "punishment_note": str(punishment_note or "").strip(),
            "what_changed": str(what_changed or "").strip(),
        },
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    )
    return compute_content_hash(canonical)


def entry_sides(entry: dict) -> Tuple[str, str, str, str]:
    """(src_code, src_section, tgt_code, tgt_section) of a raw mapping record."""
    src_code = src_sec = tgt_code = tgt_sec = ""
    for key, code in _OLD_KEYS:
        if entry.get(key):
            src_code, src_sec = code, _norm_sec(entry.get(key))
            break
    for key, code, sub_key in _NEW_KEYS:
        if entry.get(key):
            tgt_code, tgt_sec = code, _norm_sec(entry.get(key))
            sub = _norm_sec(entry.get(sub_key))
            if sub and sub not in tgt_sec:
                tgt_sec = f"{tgt_sec}({sub.strip('()')})"
            break
    return src_code, src_sec, tgt_code, tgt_sec


def entry_subject_key(entry: dict) -> str:
    s_code, s_sec, t_code, t_sec = entry_sides(entry)
    return correspondence_subject_key(s_code, s_sec, t_code, t_sec)


def entry_content_hash(entry: dict) -> str:
    _, s_sec, _, t_sec = entry_sides(entry)
    return correspondence_content_hash(
        s_sec, t_sec,
        entry.get("offence") or entry.get("procedure") or entry.get("provision") or "",
        entry.get("punishment_note") or "",
        entry.get("what_changed") or entry.get("note") or entry.get("reason") or "",
    )


def check_mapping_entry(entry: Optional[dict], registry: Optional[List[dict]] = None,
                        authorized_reviewers: Optional[List[dict]] = None) -> ApprovalCheckResult:
    if not isinstance(entry, dict):
        return ApprovalCheckResult(False, "missing_approval")
    s_code, s_sec, t_code, t_sec = entry_sides(entry)
    if not (s_code and s_sec and t_code and t_sec):
        return ApprovalCheckResult(False, "missing_approval")
    return check_approval(RECORD_TYPE, entry_subject_key(entry), entry_content_hash(entry),
                          registry=registry, authorized_reviewers=authorized_reviewers)


@lru_cache(maxsize=1)
def _load_mapping() -> dict:
    try:
        data = json.loads(_MAPPING_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.error("[correspondence_gate] failed to load mapping, failing closed: %s", e)
        return {}


def _iter_entries() -> Iterator[dict]:
    for v in _load_mapping().values():
        if isinstance(v, list):
            for e in v:
                if isinstance(e, dict):
                    yield e


def check_relationship(source_section: Any, target_section: Any, source_code: str = "", target_code: str = "",
                       registry: Optional[List[dict]] = None,
                       authorized_reviewers: Optional[List[dict]] = None) -> ApprovalCheckResult:
    """Is the claim "<source> corresponds to <target>" approved? Looks up the
    exact mapping record(s) for that pair (strict section match on both
    sides) and checks each against the approval registry."""
    src, tgt = _norm_sec(source_section), _norm_sec(target_section)
    if not src or not tgt:
        return ApprovalCheckResult(False, "missing_approval")
    first_failure: Optional[ApprovalCheckResult] = None
    for entry in _iter_entries():
        s_code, s_sec, t_code, t_sec = entry_sides(entry)
        if s_sec != src or t_sec != tgt:
            continue
        if source_code and s_code != source_code.upper():
            continue
        if target_code and t_code != target_code.upper():
            continue
        res = check_mapping_entry(entry, registry=registry, authorized_reviewers=authorized_reviewers)
        if res.approved:
            return res
        first_failure = first_failure or res
    return first_failure or ApprovalCheckResult(False, "missing_approval")


def parse_successor_label(label: Any) -> Tuple[str, str]:
    """'Bharatiya Nyaya Sanhita, Section 199' -> ('BNS', '199')."""
    text = str(label or "")
    m = _SECTION_IN_LABEL_RE.search(text)
    return act_code(text), (_norm_sec(m.group(1)) if m else "")


def check_successor_claim(act_name: Any, section_number: Any, successor_label: Any,
                          registry: Optional[List[dict]] = None,
                          authorized_reviewers: Optional[List[dict]] = None) -> ApprovalCheckResult:
    """Gate for a dead provision's section-level successor statement. A label
    with no parsable successor section, or an unknown act, fails closed."""
    src_code = act_code(act_name)
    tgt_code, tgt_sec = parse_successor_label(successor_label)
    if not (src_code and tgt_code and tgt_sec and _norm_sec(section_number)):
        return ApprovalCheckResult(False, "missing_approval")
    return check_relationship(section_number, tgt_sec, src_code, tgt_code,
                              registry=registry, authorized_reviewers=authorized_reviewers)


_WITHHELD_TEXT_FIELDS = ("offence", "what_changed", "source_link", "judicial_citation", "new_subsection")


def gate_xref_results(results: List[dict], query_side: str = "source",
                      registry: Optional[List[dict]] = None,
                      authorized_reviewers: Optional[List[dict]] = None) -> int:
    """Mutates normalised /advocate/cross-reference results in place and
    returns how many were withheld. Each result must carry its raw mapping
    record under the internal key "_raw_entry" (always popped here).

    A withheld result keeps every key (backward compatible). Only the
    identifier the user searched from survives; the other side, the
    offence/what_changed text, links and subsection are blanked.
    `query_side` is "target" when the user searched by the new-code number,
    so the old-code number is the undisclosed side.
    """
    withheld = 0
    for r in results:
        raw = r.pop("_raw_entry", None)
        if r.get("change_type") == "quarantined_incorrect":
            result = ApprovalCheckResult(False, "quarantined_incorrect")
        else:
            result = check_mapping_entry(raw, registry=registry, authorized_reviewers=authorized_reviewers)
        if result.approved:
            r["correspondence_withheld"] = False
            r["withheld_reason"] = None
            continue
        withheld += 1
        if query_side == "target":
            r["old_section"] = ""
        else:
            r["new_section"] = ""
        for f in _WITHHELD_TEXT_FIELDS:
            r[f] = ""
        r["change_type"] = "withheld"
        r["verified"] = False
        r["correspondence_withheld"] = True
        r["withheld_reason"] = result.reason
    return withheld
