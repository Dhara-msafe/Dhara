"""Layer C — Material Fact Detector.

Determines whether we have enough material facts to retrieve + answer,
or whether we must ask one clarifying question first.
Pure code — no LLM call. Cost: 0 ECU per invocation.
"""
from __future__ import annotations
import logging
from typing import Dict, List, Optional, Tuple

from engine.models import LegalQuery, ClassifyResult, FactCheckResult, CaseState
from engine.irrelevance_filter import _ENTRY_ACTIONS

logger = logging.getLogger("gandhikar")

# ── Material facts required per domain ───────────────────────────────────────
# Each entry: (fact_key, question_en, required_for_different_answer)
_DOMAIN_REQUIRED_FACTS: Dict[str, List[Tuple[str, str]]] = {
    "marriage_and_family": [
        ("religion",
         "Which religion or personal law governs this marriage — Hindu, Muslim, Christian, Parsi, or a court/special marriage?"),
    ],
    "property_transfer": [
        ("relationship_type",
         "What is the relationship between the parties — ancestral/inherited property, self-acquired, or marital property?"),
    ],
    "religious_character_change": [
        ("property_ownership",
         "Is there a formal dispute over the property's registered religious ownership, or is this about visitor access?"),
    ],
    "criminal_procedure": [
        # Only ask if no actor role mentioned
        ("actor_role_check",
         "Did the police arrest/detain you, or was it a private person?"),
    ],
    "employment": [
        ("employment_type",
         "Is this about a formal written employment contract, daily wages, or contractual/gig work?"),
    ],
}

# Facts that, when already present in CaseState, satisfy the requirement
_STATE_FACT_KEYS = {
    "religion": ["religion"],
    "relationship_type": ["relationship_type"],
    "property_ownership": ["asset_type"],
    "actor_role_check": ["actor_roles"],  # from LegalQuery.actor_roles
    "employment_type": ["custom_facts"],
}


def detect(
    lq: LegalQuery,
    domain: str,
    state: Optional[CaseState] = None,
) -> FactCheckResult:
    """Layer C — check for missing material facts.

    Returns:
    - answer_mode = DIRECT     → proceed to retrieval
    - answer_mode = CONDITIONAL → proceed but flag conditional branches
    - answer_mode = ESCALATE   → stop and ask the one clarifying question
    """
    # If query already has classification actions, most facts are implicit
    if len(lq.actions) >= 2 and lq.actor_roles:
        logger.debug("[fact_detector] sufficient actions+roles, DIRECT")
        return FactCheckResult(answer_mode="DIRECT")

    required_facts = _DOMAIN_REQUIRED_FACTS.get(domain, [])
    if not required_facts:
        # Fix 3 (H2b): an unrecognised or blank domain has no fact spec.
        # Return CONDITIONAL (fail-closed) rather than DIRECT (fail-open).
        if not domain or domain not in _DOMAIN_REQUIRED_FACTS:
            logger.warning(
                "[fact_detector] domain=%r not in registry — returning CONDITIONAL (fail-closed)", domain
            )
            return FactCheckResult(answer_mode="CONDITIONAL")
        return FactCheckResult(answer_mode="DIRECT")

    missing: List[str] = []
    first_question: Optional[str] = None

    for fact_key, question_en in required_facts:
        if _fact_is_known(fact_key, lq, state):
            continue
        missing.append(fact_key)
        if first_question is None:
            first_question = question_en

    if not missing:
        return FactCheckResult(answer_mode="DIRECT")

    # ESCALATE only for marriage_and_family / property domains where wrong-act
    # retrieval is a hard error. For other domains, proceed with CONDITIONAL.
    hard_escalate_domains = {"marriage_and_family", "religious_character_change"}
    if domain in hard_escalate_domains and missing:
        logger.info("[fact_detector] ESCALATE domain=%s missing=%s", domain, missing)
        return FactCheckResult(
            answer_mode="ESCALATE",
            missing_facts=missing,
            follow_up_question=first_question,
        )

    return FactCheckResult(
        answer_mode="CONDITIONAL",
        missing_facts=missing,
        follow_up_question=first_question,
    )


def _fact_is_known(fact_key: str, lq: LegalQuery, state: Optional[CaseState]) -> bool:
    """Check if a required fact is already known from query or conversation state."""
    if fact_key == "religion":
        # Check if religion was mentioned in the query text
        rel_words = {
            "hindu", "muslim", "islam", "christian", "parsi", "zoroastrian",
            "sikh", "jain", "court marriage", "special marriage",
        }
        if any(w in (lq.original_query or "").lower() for w in rel_words):
            return True
        if state and state.religion:
            return True
        # Hindu is most common — if personal law topic detected but no religion
        # specified, escalate so we don't apply the wrong act
        return False

    if fact_key == "actor_role_check":
        if lq.actor_roles:
            return True
        police_words = {"police", "officer", "constable", "inspector", "sp", "dsp", "thana"}
        if any(w in (lq.original_query or "").lower() for w in police_words):
            return True
        if state and state.custom_facts.get("actor_role"):
            return True
        return False

    if fact_key == "relationship_type":
        if state and state.relationship_type:
            return True
        # Query mentions inheritance, husband, wife, ancestral → implicit
        inherit_words = {"inherit", "ancestral", "husband", "wife", "father", "mother",
                         "divorce", "separation", "matrimonial", "stridhan", "streedhan"}
        if any(w in (lq.original_query or "").lower() for w in inherit_words):
            return True
        return False

    if fact_key == "property_ownership":
        # If query mentions entry/visit, NOT a property ownership dispute
        entry_words = {"enter", "visit", "go", "come", "access", "walk"}
        if _ENTRY_ACTIONS & set(lq.actions or []):
            return True
        if any(w in (lq.original_query or "").lower() for w in entry_words):
            return True
        return False

    # Default: unknown fact not present
    return False
