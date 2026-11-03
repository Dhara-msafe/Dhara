"""Shared assertions for the PR-1B1 Guardian public-page privacy contract
(backend/api/journey_router.py::journey_status_page, commit c8569ec).

The anonymous page MUST be one identical static privacy notice for every
token value (valid, revoked, safe, expired or random): HTTP 200, no DB
lookup, no journey metadata, no status label, no location, no map, and
`Referrer-Policy: no-referrer` (header + meta). Journey state is verified
through the owner's authenticated API responses instead.
"""
import uuid

import requests

FORBIDDEN_ON_PUBLIC_PAGE = (
    "Journey in progress", "Arrived safely", "Last known area", "Sharing turned off",
    "L.marker", "L.circle", "leaflet", "tile.openstreetmap", "maps.googleapis.com",
    'http-equiv="refresh"',
)


def assert_private_page(base_url: str, token: str, *extra_forbidden: str) -> None:
    page = requests.get(f"{base_url}/api/journey/status/{token}")
    random_page = requests.get(f"{base_url}/api/journey/status/{uuid.uuid4().hex[:10]}")
    assert page.status_code == 200 and random_page.status_code == 200
    assert "text/html" in page.headers.get("content-type", "")
    assert page.text == random_page.text, "public page must be identical for every token"
    assert page.headers.get("referrer-policy") == "no-referrer"
    assert '<meta name="referrer" content="no-referrer"/>' in page.text
    assert token not in page.text, "token must never be echoed server-side"
    low = page.text.lower()
    for s in (*FORBIDDEN_ON_PUBLIC_PAGE, *extra_forbidden):
        assert s.lower() not in low, f"public page leaked {s!r}"
