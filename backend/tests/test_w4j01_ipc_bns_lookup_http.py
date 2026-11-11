"""
W4-J01 — IPC -> BNS section lookup (Day 4 QA journey).

Unlike W3-J01/J02/W5-J01 (chat/voice), this journey is NOT LLM-backed:
GET /api/advocate/cross-reference (server.py's cross_reference()) is a pure,
deterministic lookup against a bundled JSON file (ipc_bns_mapping.json,
present in this sandbox) -- "Citation Guard guarantees ... ONLY the
ipc_bns_mapping.json is the source of truth -- no AI inference" per its own
docstring. That means, unlike the chat/voice journeys, this one CAN be
exercised end-to-end from this sandbox: no live server, no network egress,
no API key needed -- just the real FastAPI app and the real data file
already in the repo.

This file adds what was missing: every existing test for this endpoint
(test_p1_dhara_bns199_fidelity.py, test_p2_approval_gate_integrity.py,
test_p1_step5_step6_correction.py, test_p1_verified_only_boundary.py,
test_activation_boundary.py -- 173 passing, 1 skipped, confirmed this
session) calls the underlying helper functions (_xref_search, _normalise,
etc.) directly. None of them go through the actual HTTP route via FastAPI's
TestClient -- so the route wiring itself (decorator, query-param parsing,
the 400-on-empty-query guard, the exact JSON response shape the frontend's
app/ipc-bns-lookup.tsx actually consumes) was unverified. This file closes
that gap with real, in-process HTTP requests (Starlette's TestClient --
ASGI transport, no sockets, no live server needed).

Also confirms the frontend's lack of an Authorization header
(app/ipc-bns-lookup.tsx's fetch call sends none) is correct, not a bug: this
route has no current_user dependency at all -- it's a free, DB-only lookup
with no paid API and no per-user state behind it, unlike geo_router (N-02).
"""
import os
import sys
import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import server as server_module  # noqa: E402


@pytest.fixture(scope="module")
def client():
    # No `with` block: lifespan/startup events (Mongo connections, TTL
    # index creation, etc.) are intentionally NOT triggered -- this is a
    # route-level test of a pure-function endpoint, not a full app boot.
    return TestClient(server_module.app, raise_server_exceptions=True)


class TestCrossReferenceRouteContract:
    def test_requires_at_least_one_query_param(self, client):
        r = client.get("/api/advocate/cross-reference")
        assert r.status_code == 400

    def test_sends_no_auth_header_by_design_and_still_works(self, client):
        # Mirrors app/ipc-bns-lookup.tsx's actual fetch call exactly: no
        # Authorization header at all. Confirms that's correct, not an
        # oversight (unlike N-02's geo_router, this route has no
        # current_user dependency -- it's a free DB-only lookup).
        r = client.get("/api/advocate/cross-reference", params={"ipc": "166A"})
        assert r.status_code == 200

    def test_ipc_section_lookup_returns_expected_shape(self, client):
        r = client.get("/api/advocate/cross-reference", params={"ipc": "166A"})
        assert r.status_code == 200
        data = r.json()
        assert "results" in data and isinstance(data["results"], list)
        assert "citation_guard" in data
        guard = data["citation_guard"]
        assert guard["database_only"] is True  # never an LLM-inferred answer
        assert isinstance(guard["total_in_db"], int) and guard["total_in_db"] > 0

    def test_ipc_166a_is_actually_found_in_the_bundled_data_file(self, client):
        # IPC 166A -> BNS 199 is the exact section pair this app's own test
        # suite (test_p1_dhara_bns199_fidelity.py) treats as its canonical
        # worked example -- confirms the HTTP route surfaces it correctly,
        # not just the underlying helper function in isolation.
        r = client.get("/api/advocate/cross-reference", params={"ipc": "166A"})
        data = r.json()
        assert data["citation_guard"]["query_found_in_db"] is True
        assert len(data["results"]) > 0
        # Normalised field is old_section/new_section, not ipc_section/
        # bns_section -- confirmed by actually reading the real response,
        # not assumed from the raw mapping file's own field names.
        matching = [res for res in data["results"] if "166A" in str(res.get("old_section", ""))]
        assert matching, f"Expected an IPC 166A entry, got: {data['results']}"
        # This exact section is the P2 approval-gate's canonical worked
        # example (test_p2_approval_gate_integrity.py): its BNS section is
        # correctly WITHHELD (new_section is None) pending human review --
        # confirms the route surfaces that withholding over HTTP too, not
        # just in the helper function tested in isolation elsewhere.
        assert matching[0]["new_section"] is None
        assert matching[0]["review_status"] == "withheld_pending_approval"

    def test_bns_section_lookup_also_works(self, client):
        r = client.get("/api/advocate/cross-reference", params={"bns": "199"})
        assert r.status_code == 200
        data = r.json()
        assert data["citation_guard"]["database_only"] is True

    def test_unknown_section_signals_not_found_rather_than_guessing(self, client):
        # Citation Guard contract #3: "If a section is not in the file the
        # response signals that explicitly ... never infer a mapping."
        r = client.get("/api/advocate/cross-reference", params={"ipc": "99999"})
        assert r.status_code == 200
        data = r.json()
        assert data["citation_guard"]["query_found_in_db"] is False
        assert data["results"] == []

    def test_keyword_search_mode_also_reaches_the_route(self, client):
        r = client.get("/api/advocate/cross-reference", params={"q": "sedition"})
        assert r.status_code == 200
        data = r.json()
        assert "results" in data and "citation_guard" in data


class TestFrontendRequestShapeMatchesTheRoute:
    """Source-level guard: app/ipc-bns-lookup.tsx builds its query string as
    ipc=<q> / bns=<q> / q=<q> depending on the active tab -- confirms those
    are exactly the three param names this route accepts (a renamed param on
    either side would silently break the screen without any test catching
    it, since the frontend has no TypeScript check against the backend's
    actual signature)."""

    def test_frontend_uses_the_same_three_param_names_as_the_route(self):
        frontend_path = os.path.join(
            os.path.dirname(BACKEND_DIR), "frontend", "app", "ipc-bns-lookup.tsx"
        )
        src = open(frontend_path, encoding="utf-8").read()
        assert "ipc=${encodeURIComponent(q)}" in src
        assert "bns=${encodeURIComponent(q)}" in src
        assert "q=${encodeURIComponent(q)}" in src
        assert "/api/advocate/cross-reference" in src
