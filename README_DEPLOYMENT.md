# DHARA — Deployment & Engine Notes

## Release preflight (B-02 / D-01)

Before kicking off a closed_testing or production build, run:

```
node scripts/release_preflight.mjs
```

It refuses (non-zero exit) to proceed if `EXPO_PUBLIC_OUTBOUND_PROFILE`
isn't explicitly `closed_testing`/`production`, `EXPO_PUBLIC_OUTBOUND_MODE`
isn't `live`, the app version still carries a leftover `-qa` suffix, or
`ADMIN_KEY` is unset/an obvious placeholder. This does not replace QA
sign-off or on-device testing — it only catches the handful of
misconfigurations that would otherwise make a real release silently behave
like a simulated QA build, or ship weak admin auth.

## Engine Architecture

DHARA's legal-reasoning backend runs a multi-layer pipeline (`backend/engine/`)
before any answer reaches the user:

- **Layer A** — Query Parser (`query_parser.py`): LLM-based, turns the raw
  message into a structured `LegalQuery` (actions, actors, jurisdiction, etc.)
- **Layer B** — Conduct Classifier (`conduct_classifier.py`): deterministic,
  maps actions → legal domain taxonomy. Also runs **ACTOR-CONDUCT LOCK**
  extraction (see below).
- **Layer C** — Material Fact Detector (`fact_detector.py`): decides
  DIRECT / CONDITIONAL / ESCALATE (ask a clarifying question).
- **Layer H** — Irrelevance Filter (`irrelevance_filter.py`): hard guards
  against retrieving the wrong statute family for the action.
- **Layer S** — Law Status Guard (`law_status_guard.py`): flags
  REPEALED/SUPERSEDED provisions (e.g. IPC → BNS).
- **Layer M** — Answer Generator hardening (`answer_generator.py`):
  cannot-verify responses, status-guard prompt augmentation, citation-leak
  stripping, and **ACTOR-CONDUCT LOCK** enforcement (see below).

### Named invariant: ACTOR-CONDUCT LOCK

**Added:** Actor-Conduct Obligation Lock sprint.

**Problem it prevents:** the engine answering a question about someone
ELSE's legal obligations as if those obligations applied to the person
asking (e.g. a tenant asking about a landlord's maintenance duties being
told *"you must maintain the property"* instead of *"your landlord must..."*).

**Invariant:** before generating any answer containing obligation language
(`must`, `required`, `liable`, `responsible`, `duty`, `shall`, `cannot`),
the engine answers four questions:

1. **WHO** is regulated by this law or rule?
2. **WHAT** specific conduct does it regulate?
3. Is the user asking **about** that actor?
4. Did the user describe **performing** that conduct?

If the answer to (3) or (4) is no, the engine must not transfer that
obligation onto the user.

**Where it lives:**
- `engine/models.py` — `LegalQuery.asking_as_role` (who the user says they
  are) and `ClassifyResult.{regulated_actor, regulated_conduct, user_role,
  actor_mismatch}`.
- `engine/query_parser.py` — Layer A now also extracts `asking_as_role`
  from the raw query (e.g. "tenant", "bystander", "victim", "journalist").
- `engine/conduct_classifier.py` — `extract_actor_conduct()` (Layer B):
  deterministically compares `asking_as_role` against the actor who
  performs the regulated conduct (`actor_roles`). Only flags
  `actor_mismatch=True` on positive evidence of a different stated role —
  ambiguous/unstated cases default to no-mismatch (no behaviour change for
  the vast majority of queries).
- `engine/answer_generator.py` — two enforcement mechanisms, applied in
  `api/chat_router.py`:
  - `augment_prompt_with_actor_conduct_lock()` — primary guard; appends an
    explicit reframing instruction to the LLM system prompt when
    `actor_mismatch` is true (same pattern as the existing Layer S
    status-guard prompt augmentation).
  - `reframe_misdirected_obligations()` — defence-in-depth; a conservative
    post-processor that rewrites a small set of unambiguous
    directly-addressed phrasings ("You must...", "Your duty is...") toward
    the regulated actor if they still slip through. Deliberately leaves
    "you cannot ..." untouched, since that phrasing is often a *right*
    correctly addressed to the user.

**Regression fixtures verified** (manually, via the real pipeline — see
sprint notes, not a formal test file per sprint scope):
1. Journalist asking about protest-organizer permit obligations → journalist
   rights returned, not organizer duties.
2. Bystander asking about police use-of-force rules → bystander rights, not
   officer obligations.
3. Tenant asking about landlord maintenance obligations → tenant remedies,
   landlord's duty stated as the landlord's, not the tenant's.
4. Employee asking about employer safety obligations → employee rights, not
   employer duties transferred to the employee.
5. Victim asking about a police officer's FIR-filing obligations → victim's
   right to demand an FIR, not the officer's duty transferred to the victim.
