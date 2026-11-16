"""
Backend regression tests for B-78:

  "Legal answer notice shows an empty state name -- 'No confirmed rent and
  tenancy rule for  is in Dhara yet' (state name blank) even though the
  question names a real state (Bengaluru). Still present after the 12 Nov
  merge."

Root cause (confirmed by reading source, not reported by the bug itself):

  The session-level jurisdiction value (engine.models.Jurisdiction.state,
  set by the LLM query parser from the user's own wording -- see
  query_parser.py) is free text, never constrained to a real 2-letter
  state/UT code. A query that names a city ("Bengaluru") rather than a
  state ("Karnataka") -- or a full state name instead of its code -- could
  reach states.state_name() unresolved: STATE_BY_CODE is keyed only by
  code, so any other string silently resolves to "", with no exception and
  no log. That produces exactly the reported notice with the state name
  blank, even though the question did name a real place.

  This only surfaces when FEATURE_MATTER_CONTEXT_V2 is on (it defaults to
  false) -- api/chat_router.py's non-V2 path reads user.get("state")
  directly, which is always a validated code (api/auth_router.py's
  PATCH /auth/state rejects anything states.is_valid_state() doesn't
  recognize). The V2 path instead calls
  engine.models.resolve_jurisdiction_state(session_state, profile_state),
  which previously gave the unvalidated session_state value precedence
  with zero normalization.

Fix:
  - states.py: new states.normalize_state_value(raw) -- resolves a code,
    a full state name, or a known major city name (states.CITY_TO_STATE_CODE)
    to a valid 2-letter code, or returns None if nothing matches. Never
    raises, never guesses past that table.
  - engine/models.py: resolve_jurisdiction_state() now normalizes BOTH
    inputs through normalize_state_value() before applying precedence, so
    every caller gets back either a real code or a clean None -- never a
    string that merely looks like one. An unresolved value (not in the
    city/name table) now correctly falls through to the profile state, or
    to None (which triggers the existing, unaffected "please confirm your
    state" prompt instead of a blank-name notice).

These are pure, synchronous unit tests against states.py and
engine/models.py -- no live server, no network, no LLM call needed (the
bug is entirely in deterministic string normalization code, not in
anything that requires mocking a model response).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from states import normalize_state_value, state_name, is_valid_state  # noqa: E402
from engine.models import resolve_jurisdiction_state  # noqa: E402


class TestNormalizeStateValue:
    def test_valid_code_passes_through(self):
        assert normalize_state_value("KA") == "KA"
        assert normalize_state_value("ka") == "KA"  # case-insensitive

    def test_full_state_name_resolves_to_code(self):
        assert normalize_state_value("Karnataka") == "KA"
        assert normalize_state_value("karnataka") == "KA"
        assert normalize_state_value("Delhi (NCT)") == "DL"

    def test_the_exact_reported_city_resolves_correctly(self):
        """This is the literal B-78 scenario: the question named
        'Bengaluru', a real place, and the notice should reflect
        Karnataka, not a blank state name."""
        assert normalize_state_value("Bengaluru") == "KA"
        assert normalize_state_value("bengaluru") == "KA"
        assert normalize_state_value("Bangalore") == "KA"

    def test_other_major_cities_resolve(self):
        assert normalize_state_value("Mumbai") == "MH"
        assert normalize_state_value("Chennai") == "TN"
        assert normalize_state_value("Hyderabad") == "TG"
        assert normalize_state_value("Kolkata") == "WB"
        assert normalize_state_value("New Delhi") == "DL"

    def test_unresolvable_value_returns_none_not_empty_string(self):
        """A city/place not in the table must fall through cleanly (None),
        never raise, and never produce a value that state_name() would
        silently blank out downstream."""
        assert normalize_state_value("Nowhereville") is None
        assert normalize_state_value("") is None
        assert normalize_state_value(None) is None
        assert normalize_state_value("   ") is None


class TestResolveJurisdictionStateB78:
    def test_city_only_jurisdiction_resolves_to_real_code_and_name(self):
        """The exact regression: a session-level jurisdiction value of
        'Bengaluru' (what the LLM parser could previously store verbatim)
        must resolve to a real code whose state_name() is non-empty --
        not the pre-fix behavior of a truthy-but-unresolvable string."""
        result = resolve_jurisdiction_state("Bengaluru", None)
        assert result["state"] == "KA"
        assert state_name(result["state"]) == "Karnataka"
        assert is_valid_state(result["state"])

    def test_unresolvable_session_value_falls_back_to_profile_state(self):
        result = resolve_jurisdiction_state("some garbled LLM output", "MH")
        assert result["state"] == "MH"
        assert result["source"] == "user_profile"

    def test_unresolvable_session_value_with_no_profile_state_yields_none(self):
        """Before the fix this produced a truthy-but-meaningless
        user_state, which state_name() silently blanked -- the caller
        (chat_router.py) must now see a clean falsy value here so it takes
        the existing 'please confirm your state' branch instead."""
        result = resolve_jurisdiction_state("some garbled LLM output", None)
        assert result["state"] is None
        assert result["source"] == "none"

    def test_full_state_name_in_session_still_resolves(self):
        result = resolve_jurisdiction_state("Karnataka", None)
        assert result["state"] == "KA"

    def test_valid_session_code_still_wins_over_profile_as_before(self):
        result = resolve_jurisdiction_state("DL", "MH")
        assert result["state"] == "DL"
        assert result["source"] == "jurisdiction"
        assert result["conflict"] is True

    def test_no_conflict_flagged_when_city_and_profile_agree(self):
        """'Bengaluru' (session) and 'KA' (profile) describe the SAME
        place once normalized -- must not be flagged as a conflict."""
        result = resolve_jurisdiction_state("Bengaluru", "KA")
        assert result["state"] == "KA"
        assert result["conflict"] is False

    def test_both_missing_yields_none_as_before(self):
        result = resolve_jurisdiction_state(None, None)
        assert result["state"] is None
        assert result["source"] == "none"
        assert result["conflict"] is False
