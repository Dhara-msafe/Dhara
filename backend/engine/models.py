"""Shared Pydantic models for the 7-layer reasoning pipeline."""
from __future__ import annotations
import os
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class Jurisdiction(BaseModel):
    country: str = "India"
    state: Optional[str] = None
    district: Optional[str] = None


class LegalQuery(BaseModel):
    """Output of Layer A — Query Parser.  Persisted in session as CaseState."""
    original_query: str = ""
    normalized_query: str = ""
    language: str = "en"
    jurisdiction: Jurisdiction = Field(default_factory=Jurisdiction)
    event_date: Optional[str] = None          # ISO date string
    actions: List[str] = Field(default_factory=list)
    actors: List[str] = Field(default_factory=list)
    actor_roles: List[str] = Field(default_factory=list)
    objects: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    location_types: List[str] = Field(default_factory=list)
    intent: List[str] = Field(default_factory=list)
    harm: List[str] = Field(default_factory=list)
    candidate_issues: List[str] = Field(default_factory=list)
    missing_material_facts: List[str] = Field(default_factory=list)
    urgency: str = "standard"           # immediate | standard | informational
    requested_outcome: str = ""
    # ACTOR-CONDUCT LOCK (structural invariant — see README_DEPLOYMENT.md).
    # The role the USER explicitly identifies as (e.g. "tenant", "bystander",
    # "journalist", "employee", "victim") — DISTINCT from `actor_roles`, which
    # is who PERFORMS the regulated conduct described in the query (e.g.
    # "landlord", "police", "employer"). These two are often different
    # people; conflating them is exactly the bug this invariant prevents.
    asking_as_role: Optional[str] = None

    def merge_update(self, new: "LegalQuery") -> "LegalQuery":
        """Merge a CLARIFICATION turn into existing state.

        Rules:
        - New non-empty actions / actors / objects REPLACE old values.
        - New jurisdiction fields REPLACE only if not None.
        - Original query keeps the FIRST query's wording.
        - Missing material facts are refreshed from new query.
        """
        merged = self.model_copy()
        if new.actions:
            merged.actions = new.actions
        if new.actors:
            merged.actors = new.actors
        if new.actor_roles:
            merged.actor_roles = new.actor_roles
        if new.objects:
            merged.objects = new.objects
        if new.locations:
            merged.locations = new.locations
        if new.location_types:
            merged.location_types = new.location_types
        if new.intent:
            merged.intent = new.intent
        if new.harm:
            merged.harm = new.harm
        if new.jurisdiction.state:
            merged.jurisdiction.state = new.jurisdiction.state
        if new.jurisdiction.district:
            merged.jurisdiction.district = new.jurisdiction.district
        if new.event_date:
            merged.event_date = new.event_date
        merged.missing_material_facts = new.missing_material_facts
        merged.normalized_query = new.normalized_query or merged.normalized_query
        return merged


class ClassifyResult(BaseModel):
    """Output of Layer B — Conduct Classifier."""
    primary_domain: str = "unknown"
    secondary_domains: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    action_basis: str = ""
    excluded_domains: List[str] = Field(default_factory=list)
    exclusion_reasons: Dict[str, str] = Field(default_factory=dict)
    # ACTOR-CONDUCT LOCK fields (see README_DEPLOYMENT.md > Engine Architecture).
    regulated_actor: Optional[str] = None      # WHO is regulated by this conduct
    regulated_conduct: Optional[str] = None    # WHAT conduct is regulated
    user_role: Optional[str] = None            # who the USER says they are
    actor_mismatch: bool = False               # True => user is asking about
                                                # someone ELSE's obligations


class FactCheckResult(BaseModel):
    """Output of Layer C — Material Fact Detector."""
    answer_mode: str = "DIRECT"     # DIRECT | CONDITIONAL | ESCALATE
    missing_facts: List[str] = Field(default_factory=list)
    follow_up_question: Optional[str] = None
    conditional_branches: List[Dict[str, str]] = Field(default_factory=list)


class ApplicabilityScore(BaseModel):
    """Output of Layer H — Irrelevance Filter, per provision."""
    provision: str = ""
    act: str = ""
    section: str = ""
    classification: str = "IRRELEVANT"  # APPLICABLE | BACKGROUND | IRRELEVANT | SUPERSEDED
    reason: str = ""
    guard_triggered: Optional[str] = None


class StatusRecord(BaseModel):
    """One record from law_status_registry.json, post-load."""
    act_id: str
    short_name: str
    status: str            # ACTIVE | REPEALED | SUPERSEDED | etc.
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    successor_act: Optional[str] = None
    successor_act_id: Optional[str] = None
    status_reason: str = ""
    source_url: str = ""
    source_type: str = ""
    verified_at: Optional[str] = None


class VerifiedClaim(BaseModel):
    """Output of Layer V — Claim-to-Source Verification, per claim."""
    claim_text: str
    claim_type: str = "UNKNOWN"   # VERIFIED_LEGAL_RULE | VERIFIED_PROCEDURE | VERIFIED_RIGHT |
                                   # VERIFIED_DEADLINE | VERIFIED_PENALTY | VERIFIED_REMEDY |
                                   # USER_PROVIDED_FACT | MODEL_EXPLANATION | UNKNOWN
    source_provision: Optional[str] = None
    source_act: Optional[str] = None
    is_supported: bool = False
    confidence: float = 0.0


# ─── Answer Quality Framework — Phase 1 (F1: Matter Context, additive) ────
# Added under the AQF plan approved this session. FEATURE_MATTER_CONTEXT_V2
# gates ALL future wiring of these models into the pipeline — the flag is
# OFF by default and NOTHING below is read or written by any existing call
# site yet. CaseState gets exactly one new Optional field (`matter_context`,
# default None) so every existing CaseState.model_dump()/from_mongo() call
# is byte-identical to before this change for any document that doesn't
# already have the field (Pydantic defaults it to None transparently).

FEATURE_MATTER_CONTEXT_V2: bool = os.environ.get(
    "FEATURE_MATTER_CONTEXT_V2", "false"
).strip().lower() == "true"


class MatterFact(BaseModel):
    """One fact inside a MatterContext, with provenance (F1)."""
    text: str
    provenance: str = "typed"
    # typed | heard | confirmed | document_extracted | speech_uncertain |
    # contradicted | expired
    confidence: Optional[float] = None


class MatterContext(BaseModel):
    """Answer Quality Framework F1 — structured matter context.

    Additive only. Not populated or consumed by any pipeline layer in
    Phase 1; future phases wire this in behind FEATURE_MATTER_CONTEXT_V2.
    """
    original_question: str = ""
    desired_outcome: Optional[str] = None
    actors: List[Dict[str, str]] = Field(default_factory=list)
    conduct_events: List[Dict[str, str]] = Field(default_factory=list)
    facts: List[MatterFact] = Field(default_factory=list)
    jurisdiction_state: Optional[str] = None
    jurisdiction_district: Optional[str] = None
    jurisdiction_source: Optional[str] = None   # user_profile | typed | inferred
    jurisdiction_confirmed: bool = False
    incident_date: Optional[str] = None      # NEW — ISO date string (did not exist pre-Phase-1)
    proceeding_date: Optional[str] = None    # NEW
    document_date: Optional[str] = None      # NEW
    personal_law_context: Dict[str, Any] = Field(default_factory=dict)
    contradictions: List[Dict[str, str]] = Field(default_factory=list)
    legal_references: List[str] = Field(default_factory=list)
    missing_material_facts: List[str] = Field(default_factory=list)
    answerability: str = "answerable"
    # answerable | needs_clarification | escalate | refuse
    safety_flag: Optional[str] = None

    def to_mongo(self) -> dict:
        return self.model_dump()

    @classmethod
    def from_mongo(cls, d: dict) -> "MatterContext":
        return cls.model_validate(d)


class CaseState(BaseModel):
    """Full conversation state persisted in MongoDB per session."""
    session_id: str = ""
    turn_count: int = 0
    legal_query: Optional[LegalQuery] = None
    classify_result: Optional[ClassifyResult] = None
    turn_type_history: List[str] = Field(default_factory=list)
    # Extra semantic fields accumulated from clarification turns
    religion: Optional[str] = None
    relationship_type: Optional[str] = None
    asset_type: Optional[str] = None
    marriage_status: Optional[str] = None
    custom_facts: Dict[str, Any] = Field(default_factory=dict)
    # ── Answer Quality Framework F1 (additive, Phase 1) ───────────────────
    # Optional, defaults to None. No existing reader of CaseState changes
    # behaviour; this field is simply absent/None until a future, separately
    # approved phase populates it behind FEATURE_MATTER_CONTEXT_V2.
    matter_context: Optional[MatterContext] = None
    # ── P0-C: Multi-Turn Legal Context Preservation (additive) ─────────────
    # Optional, defaults to None — same additive pattern as matter_context
    # above. Holds the single most recently named EXPLICIT Act+section
    # identifier in this conversation (see engine.pipeline.run_pre_retrieval
    # / retrieval_logic.extract_exact_statute_ref), so a later short turn
    # ("What is the corresponding BNS section?") can resolve against the
    # correct subject even though that turn's own text carries no Act name.
    # A new explicit reference in any later turn simply replaces this dict —
    # the user is always allowed to change legal focus.
    active_statute_ref: Optional[Dict[str, Any]] = None

    def to_mongo(self) -> dict:
        return self.model_dump()

    @classmethod
    def from_mongo(cls, d: dict) -> "CaseState":
        return cls.model_validate(d)


# ─── Answer Quality Framework — Phase 1 (F2: jurisdiction-state unification) ──
# Pure function only. NOT wired into any call site — api/chat_router.py
# still reads user.get("state") directly and engine.models.Jurisdiction.state
# is still populated/merged exactly as before. Adding this function changes
# no behavior anywhere; it exists so a future, explicitly-approved phase can
# switch call sites over to a single source of truth.

def resolve_jurisdiction_state(
    jurisdiction_state: Optional[str],
    user_profile_state: Optional[str],
) -> Dict[str, Any]:
    """Answer Quality Framework F2 — single source of truth for 'state'.

    Two independent sources exist today:
      - engine.models.Jurisdiction.state (session-level, merge-tracked via
        LegalQuery.merge_update)
      - the user profile's own `state` field, read directly in
        api/chat_router.py as `user.get("state")`

    Precedence (Phase 1 design, NOT yet applied anywhere):
      1. A non-empty jurisdiction_state (explicitly confirmed in-session)
         wins.
      2. Otherwise fall back to user_profile_state.
      3. Otherwise None.

    Returns a dict so callers get the resolved value AND whether the two
    sources disagreed, without this function silently hiding that.
    """
    resolved = jurisdiction_state or user_profile_state or None
    conflict = bool(
        jurisdiction_state
        and user_profile_state
        and jurisdiction_state != user_profile_state
    )
    source = "jurisdiction" if jurisdiction_state else ("user_profile" if user_profile_state else "none")
    return {"state": resolved, "source": source, "conflict": conflict}
