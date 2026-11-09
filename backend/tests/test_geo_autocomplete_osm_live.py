"""
Head Out — /api/geo/autocomplete OSM fallback (Google key not set) + /api/geo/details osm round-trip.
Also checks the optional location bias params and input validation.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL').rstrip('/')
TOKEN = "abcdefgh1234"


@pytest.fixture(scope="module")
def api():
    return requests.Session()


def _get(api, path, params, retries=2):
    # Nominatim is rate-limited (1 req/s on the server side) — retry once on 502
    for i in range(retries):
        r = api.get(f"{BASE_URL}{path}", params=params, timeout=30)
        if r.status_code != 502:
            return r
        time.sleep(2)
    return r


# Autocomplete: OSM-served when Google is not configured
class TestAutocompleteOsm:
    def test_connaught_osm(self, api):
        r = _get(api, "/api/geo/autocomplete", {"input": "connaught", "session_token": TOKEN, "limit": 3})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["provider"] == "osm"
        assert 1 <= len(d["suggestions"]) <= 3
        s = d["suggestions"][0]
        for k in ("place_id", "main_text", "secondary_text", "provider"):
            assert k in s
        assert s["provider"] == "osm"
        assert isinstance(s["main_text"], str) and s["main_text"]

    def test_connaught_with_bias(self, api):
        r = _get(api, "/api/geo/autocomplete",
                 {"input": "connaught", "session_token": TOKEN, "limit": 3, "lat": 19.07, "lng": 72.87})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["provider"] == "osm"
        assert isinstance(d["suggestions"], list)

    def test_nonsense_returns_empty(self, api):
        r = _get(api, "/api/geo/autocomplete", {"input": "zzzzqqqq", "session_token": TOKEN, "limit": 6})
        assert r.status_code == 200, r.text
        assert r.json()["suggestions"] == []


# Details: osm place_id is self-describing → lat/lng/label
class TestDetailsOsm:
    def test_details_roundtrip(self, api):
        r = _get(api, "/api/geo/autocomplete", {"input": "india gate delhi", "session_token": TOKEN, "limit": 2})
        assert r.status_code == 200, r.text
        sug = r.json()["suggestions"]
        if not sug:
            pytest.skip("No OSM suggestions returned")
        d = api.get(f"{BASE_URL}/api/geo/details",
                    params={"place_id": sug[0]["place_id"], "session_token": TOKEN, "provider": "osm"}, timeout=15)
        assert d.status_code == 200, d.text
        j = d.json()
        assert -90 <= j["latitude"] <= 90 and -180 <= j["longitude"] <= 180
        assert j["provider"] == "osm" and j["label"]

    def test_details_bad_token_404(self, api):
        d = api.get(f"{BASE_URL}/api/geo/details",
                    params={"place_id": "!!!notbase64", "session_token": TOKEN, "provider": "osm"}, timeout=15)
        assert d.status_code == 404


# Validation
class TestValidation:
    def test_short_session_token_422(self, api):
        r = api.get(f"{BASE_URL}/api/geo/autocomplete", params={"input": "connaught", "session_token": "abc"})
        assert r.status_code == 422

    def test_bad_lat_422(self, api):
        r = api.get(f"{BASE_URL}/api/geo/autocomplete",
                    params={"input": "connaught", "session_token": TOKEN, "lat": 200, "lng": 72})
        assert r.status_code == 422

    def test_one_char_input_422(self, api):
        r = api.get(f"{BASE_URL}/api/geo/autocomplete", params={"input": "c", "session_token": TOKEN})
        assert r.status_code == 422


# Iteration 88: OSM cache is capped at 200 entries — repeated & varied calls must still succeed
class TestAutocompleteRepeated:
    def test_repeated_same_query_cached(self, api):
        for _ in range(3):
            r = _get(api, "/api/geo/autocomplete", {"input": "connaught", "session_token": TOKEN, "limit": 3})
            assert r.status_code == 200, r.text
            assert r.json()["provider"] == "osm"
            assert len(r.json()["suggestions"]) >= 1

    def test_repeated_with_bias(self, api):
        for _ in range(2):
            r = _get(api, "/api/geo/autocomplete", {"input": "connaught", "session_token": TOKEN,
                                                   "limit": 3, "lat": 28.63, "lng": 77.22})
            assert r.status_code == 200, r.text
            assert r.json()["provider"] == "osm"

    def test_varied_queries(self, api):
        for q in ("india gate", "karol bagh", "lajpat nagar", "saket"):
            r = _get(api, "/api/geo/autocomplete", {"input": q, "session_token": TOKEN, "limit": 3}, retries=3)
            assert r.status_code == 200, f"{q}: {r.text}"
            assert r.json()["provider"] == "osm"
            time.sleep(1.1)
