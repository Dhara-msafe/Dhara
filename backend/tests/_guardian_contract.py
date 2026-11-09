"""Shared assertions for the Guardian public-page contract
(backend/api/journey_router.py::journey_status_page).

Two modes, selected by GUARDIAN_PUBLIC_PAGE_DETAILS in backend/.env:

  OFF (PR-1B1 default) — the anonymous page is one identical static privacy
  notice for every token value (valid, revoked, safe, expired or random):
  HTTP 200, no DB lookup, no journey metadata, no status label, no location,
  no map, `Referrer-Policy: no-referrer`.

  ON (owner's choice, June 2026) — the page shows the traveller's name,
  destination and journey timestamps to anyone holding the link. Location
  stays withheld in BOTH modes: no coordinates, no area name, no map, no
  tile requests. That withholding is what these shared assertions enforce in
  this mode; name/destination disclosure is intentional and is covered by
  tests/test_pr1a_route_level.py.

Journey state itself is always verified through the owner's authenticated
API responses, never through this page.
"""
import os
import re
import uuid

import requests

FORBIDDEN_ON_PUBLIC_PAGE = (
    "Journey in progress", "Arrived safely", "Last known area", "Sharing turned off",
    "L.marker", "L.circle", "leaflet", "tile.openstreetmap", "maps.googleapis.com",
    'http-equiv="refresh"',
)

# Location artefacts that must never reach the anonymous page in EITHER mode.
FORBIDDEN_LOCATION = (
    "Last known area", "L.marker", "L.circle", "leaflet",
    "tile.openstreetmap", "maps.googleapis.com", "L.map(",
)

# Any decimal number with 4+ fractional digits — a latitude/longitude in
# practice. Checked instead of specific values so a leak is caught even when
# the test did not know the coordinates it should forbid.
_COORD_RE = re.compile(r"\b\d{1,3}\.\d{4,}\b")

_BACKEND_ENV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
)


def details_mode() -> bool:
    """Read the server's own setting — the test runner and the server share
    backend/.env, so this reflects what the running app will render."""
    value = os.environ.get("GUARDIAN_PUBLIC_PAGE_DETAILS")
    if value is None:
        try:
            with open(_BACKEND_ENV) as fh:
                for line in fh:
                    if line.strip().startswith("GUARDIAN_PUBLIC_PAGE_DETAILS="):
                        value = line.split("=", 1)[1].strip()
        except OSError:
            value = ""
    return (value or "").strip().lower() in ("1", "true", "yes")


def direct_origin(base_url: str) -> str:
    """Byte-identity only holds for the app's OWN output.

    Through the public preview host, Cloudflare injects a unique per-request
    challenge <script> into every HTML response, so two byte-identical server
    responses arrive different and the contract check fails for a reason that
    has nothing to do with the product. Fetch the page straight from the
    backend whenever the test runner can reach it; fall back to the given
    host otherwise (e.g. CI running outside the pod).
    """
    direct = os.environ.get("BACKEND_DIRECT_URL", "http://localhost:8001")
    try:
        if requests.get(f"{direct}/api/health", timeout=3).status_code == 200:
            return direct
    except requests.RequestException:
        pass
    return base_url


def assert_private_page(base_url: str, token: str, *extra_forbidden: str) -> None:
    base_url = direct_origin(base_url)
    page = requests.get(f"{base_url}/api/journey/status/{token}")
    assert page.status_code == 200
    assert "text/html" in page.headers.get("content-type", "")
    assert page.headers.get("referrer-policy") == "no-referrer"
    assert token not in page.text, "token must never be echoed server-side"
    low = page.text.lower()

    if details_mode():
        # Name and destination are disclosed on purpose. Location is not.
        for s in FORBIDDEN_LOCATION:
            assert s.lower() not in low, f"public page leaked {s!r}"
        assert not _COORD_RE.search(page.text), "public page leaked coordinates"
        return

    random_page = requests.get(f"{base_url}/api/journey/status/{uuid.uuid4().hex[:10]}")
    assert random_page.status_code == 200
    assert page.text == random_page.text, "public page must be identical for every token"
    assert '<meta name="referrer" content="no-referrer"/>' in page.text
    for s in (*FORBIDDEN_ON_PUBLIC_PAGE, *extra_forbidden):
        assert s.lower() not in low, f"public page leaked {s!r}"
