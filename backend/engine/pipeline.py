"""Gate 2 — 7-Layer Reasoning Pipeline Orchestrator.

Provides:
  run_pre_retrieval(query, language, llm_key, session, db)
      Runs layers A → B → C.
      Returns (LegalQuery, ClassifyResult, FactCheckResult, CaseState)

  run_post_retrieval(corpus_hits, db_hits, lq, classify)
      Runs layers H → S.
      Returns (filtered_corpus, filtered_db)

  classify_turn(message, new_lq, existing_state)
      Pure code turn classifier.

The pipeline does NOT manage streaming — that stays in chat_router.py.
All database writes (save_case_state) are async helpers used by chat_router.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from engine.models import (
    LegalQuery, ClassifyResult, FactCheckResult, CaseState,
)
from engine.query_parser import parse_query
from engine.conduct_classifier import classify
from engine.fact_detector import detect as detect_facts
from engine.irrelevance_filter import filter_provisions
from engine.law_status_guard import annotate_provisions
from retrieval_logic import extract_exact_statute_ref  # P0-C: reuse P0-B's parser — no duplicate

logger = logging.getLogger("gandhikar")

# ── Turn classification ───────────────────────────────────────────────────────

def classify_turn(
    message: str,
    new_lq: LegalQuery,
    existing_state: Optional[CaseState],
) -> str:
    """Classify the turn type. Pure code, no LLM.

    Returns: NEW_QUERY | CONTINUATION | CLARIFICATION_ANSWER |
             NEW_SUBQUESTION_SAME_ISSUE | TOPIC_CHANGE | AMBIGUOUS |
             EXPLICIT_STATUTE_REFERENCE
    """
    if not existing_state or not existing_state.legal_query:
        return "NEW_QUERY"

    prior = existing_state.legal_query
    msg_len = len(message.strip())

    # P0-C: an explicit Act+section identifier in THIS message ALWAYS wins,
    # even on a short, action/issue-less message. A bare citation like
    # "IPC 166A." or "Does IPC 166A still apply?" never describes an
    # action/issue, so without this check it would fall into the
    # CLARIFICATION_ANSWER branch below and have its own content silently
    # discarded in favour of an EARLIER turn's query — the exact defect this
    # phase fixes. Reuses P0-B's extract_exact_statute_ref() (single parser).
    if extract_exact_statute_ref(message)[0]:
        return "EXPLICIT_STATUTE_REFERENCE"

    # Very short message with no new actions → likely a clarification answer
    # (e.g. "We are Hindu." / "Goa." / "Yes.")
    if msg_len < 50 and not new_lq.actions and not new_lq.candidate_issues:
        return "CLARIFICATION_ANSWER"

    # Same issues as prior → continuation or new sub-question
    prior_issues = set(prior.candidate_issues or [])
    new_issues = set(new_lq.candidate_issues or [])
    shared_issues = prior_issues & new_issues

    if shared_issues:
        if msg_len < 80:
            return "NEW_SUBQUESTION_SAME_ISSUE"
        return "CONTINUATION"

    # Same actions but different issue wording
    prior_actions = set(prior.actions or [])
    new_actions = set(new_lq.actions or [])
    if prior_actions & new_actions:
        return "CONTINUATION"

    # No overlap at all
    if new_issues or new_actions:
        return "TOPIC_CHANGE"

    return "AMBIGUOUS"


# ── Pre-retrieval pipeline (A → B → C) ───────────────────────────────────────

async def run_pre_retrieval(
    query: str,
    language: str,
    llm_key: str,
    session: Optional[dict],
    db,
) -> Tuple[LegalQuery, ClassifyResult, FactCheckResult, CaseState]:
    """Layers A, B, C — runs before corpus retrieval.

    Returns:
        lq: parsed query
        classify_result: domain classification
        fact_result: missing-fact check
        case_state: updated conversation state (NOT yet saved to DB)
    """
    # Load existing conversation state from the session doc
    existing_state: Optional[CaseState] = None
    if session and session.get("case_state"):
        try:
            existing_state = CaseState.from_mongo(session["case_state"])
        except Exception as e:
            logger.warning("[pipeline] case_state parse error: %s", e)

    prior_lq = existing_state.legal_query if existing_state else None

    # ── Layer A: Query Parser ─────────────────────────────────────────────────
    lq = await parse_query(
        query=query,
        language=language,
        llm_key=llm_key,
        prior_state=prior_lq,
    )

    # ── Turn classification ───────────────────────────────────────────────────
    turn_type = classify_turn(query, lq, existing_state)
    logger.info("[pipeline] turn_type=%s domain_hints=%s", turn_type, lq.candidate_issues[:3])

    # P0-C: deterministic exact-statute check on the RAW user message, reused
    # from P0-B (retrieval_logic.extract_exact_statute_ref) — no second parser.
    exact_act, exact_sec, exact_sub = extract_exact_statute_ref(query)

    # ── Merge state based on turn type ────────────────────────────────────────
    if turn_type == "EXPLICIT_STATUTE_REFERENCE":
        # P0-C: the user named a specific Act+section in THIS turn — it IS
        # the new subject, not a fact-answer to an earlier question, so
        # (unlike CLARIFICATION_ANSWER below) we do NOT restore an earlier
        # turn's normalized_query/original_query.
        lq.normalized_query = query
    elif turn_type == "CLARIFICATION_ANSWER" and existing_state and prior_lq:
        # Merge new facts into prior query; keep original issue frame
        lq = prior_lq.merge_update(lq)
        _absorb_short_answer_facts(query, existing_state)
        # CRITICAL: restore the prior normalized_query so chat_router retrieves
        # against the ORIGINAL issue ("gold recovery in divorce") not the short
        # clarification answer ("We are Hindu").
        if prior_lq.original_query:
            lq.original_query = prior_lq.original_query
            lq.normalized_query = prior_lq.normalized_query
    elif turn_type == "TOPIC_CHANGE":
        # Fresh state for a genuinely different topic — BUT preserve the
        # active_statute_ref unless THIS turn names an explicit new one
        # (handled separately below). Turn classification is itself
        # LLM-driven on free-text candidate_issues labels, which vary
        # run-to-run even for identical input; a follow-up genuinely about
        # the same cited section (e.g. "what is the BNS equivalent?" right
        # after "IPC Section 166A") must not lose that citation context just
        # because classify_turn's noisy label-overlap check happened to call
        # it a topic change this time.
        _preserved_active_ref = existing_state.active_statute_ref if existing_state else None
        existing_state = CaseState(session_id=session.get("id", "") if session else "")
        existing_state.active_statute_ref = _preserved_active_ref
    # CONTINUATION / NEW_SUBQUESTION / NEW_QUERY: keep prior state, use new lq directly

    # ── Layer B: Conduct Classifier ───────────────────────────────────────────
    classify_result = classify(lq)

    # ── Layer C: Material Fact Detector ──────────────────────────────────────
    fact_result = detect_facts(
        lq=lq,
        domain=classify_result.primary_domain,
        state=existing_state,
    )

    # ── Build updated CaseState ───────────────────────────────────────────────
    new_state = existing_state or CaseState(session_id=session.get("id", "") if session else "")
    new_state.legal_query = lq
    new_state.classify_result = classify_result
    new_state.turn_count = (new_state.turn_count or 0) + 1
    new_state.turn_type_history = (new_state.turn_type_history or [])[-9:] + [turn_type]

    # P0-C: persist/refresh the single active explicit statute reference.
    # If THIS turn named one, it REPLACES whatever was active before — the
    # user may change legal focus at any time, even with a short message
    # (e.g. Turn 2 "IPC 166A." replaces Turn 1's "BNS 166A"). If this turn
    # did NOT name one (a genuine clarification answer like "Maharashtra" /
    # "2023" / "Yes", or a plain follow-up question), whatever was already
    # active is left untouched so later short turns still resolve against it.
    if exact_act and exact_sec:
        new_state.active_statute_ref = {
            "act": exact_act,
            "section": exact_sec,
            "subsection": exact_sub,
            "source_message": query,
        }

    return lq, classify_result, fact_result, new_state


def _absorb_short_answer_facts(message: str, state: CaseState) -> None:
    """Extract simple facts from short clarification answers into CaseState."""
    msg_lower = message.lower().strip()

    # Religion detection
    religion_map = {
        "hindu": "Hindu", "muslim": "Muslim", "islam": "Muslim",
        "christian": "Christian", "church": "Christian",
        "parsi": "Parsi", "zoroastrian": "Parsi",
        "sikh": "Sikh", "jain": "Jain",
        "court marriage": "Special", "special marriage": "Special",
    }
    for keyword, religion in religion_map.items():
        if keyword in msg_lower:
            state.religion = religion
            logger.info("[pipeline] absorbed religion=%s", religion)
            break

    # Relationship type
    relation_map = {
        "husband": "spouse", "wife": "spouse", "matrimonial": "spouse",
        "father": "parent", "mother": "parent", "parent": "parent",
        "ancestral": "ancestral_property", "inherited": "inherited",
    }
    for keyword, rel in relation_map.items():
        if keyword in msg_lower and not state.relationship_type:
            state.relationship_type = rel
            break


# ── Post-retrieval pipeline (H → S) ──────────────────────────────────────────

def run_post_retrieval(
    corpus_hits: List[dict],
    db_hits: List[dict],
    lq: LegalQuery,
    classify_result: ClassifyResult,
) -> Tuple[List[dict], List[dict]]:
    """Layers H and S — runs after corpus retrieval.

    H: Irrelevance filter (hard guards)
    S: Law Status Guard (annotates dead/superseded laws)

    Returns:
        (filtered_corpus_hits, annotated_db_hits)
    """
    # ── Layer H: Irrelevance Filter ───────────────────────────────────────────
    filtered_corpus, corpus_rejected = filter_provisions(
        corpus_hits, lq, classify_result, source_tag="corpus"
    )
    filtered_db, db_rejected = filter_provisions(
        db_hits, lq, classify_result, source_tag="db"
    )

    if corpus_rejected or db_rejected:
        logger.info(
            "[pipeline] irr_filter rejected corpus=%d db=%d",
            len(corpus_rejected), len(db_rejected),
        )

    # ── Layer S: Law Status Guard ─────────────────────────────────────────────
    # Annotate with dead_warning for INACTIVE / WARN statuses
    annotated_corpus = annotate_provisions(filtered_corpus, source_tag="corpus")
    annotated_db = annotate_provisions(filtered_db, source_tag="db")

    return annotated_corpus, annotated_db


# ── Conversation state persistence ───────────────────────────────────────────

async def save_case_state(db, session_id: str, case_state: CaseState) -> None:
    """Persist updated CaseState into the sessions collection."""
    try:
        await db.sessions.update_one(
            {"id": session_id},
            {"$set": {
                "case_state": case_state.to_mongo(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
    except Exception as e:
        logger.warning("[pipeline] save_case_state failed: %s", e)
