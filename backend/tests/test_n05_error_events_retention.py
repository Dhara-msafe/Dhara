"""
N-05 (B-43) (P2): db.error_events keeps 4,000-character tracebacks with no
retention or TTL.

INVESTIGATION FINDING: the base this release branch was cut from (merge
commit ccf18bf, already on `main` before any of this session's Day 1-4 work)
already ships a 90-day TTL index on db.error_events' `created_at` field
(server.py's startup handler, originally an inline-named closure
`_ensure_error_event_ttl`), and `_record_error_event` already caps each
traceback at 4,000 characters and stores `created_at` as a real BSON date
(required for a Mongo TTL index to act on it at all — a string timestamp
would silently never expire). So the underlying concern the register item
raises — this collection could grow forever — does not reproduce against the
current code: it's already bounded on both axes (per-document size AND
total retention window).

What this session changed is hygiene, not behavior: pulled the 90-day/4000-
char magic numbers into two named, documented, top-of-file constants
(ERROR_EVENTS_RETENTION_DAYS, ERROR_EVENT_TRACEBACK_MAX_CHARS) and extracted
the TTL-index-creation closure into a standalone, explicitly-parameterized
function (ensure_error_event_ttl_index(database)) so it — and the retention
policy it encodes — can be exercised directly in a test, without needing a
live Mongo server or the FastAPI startup event. These tests are the
regression guard: if the field name, retention window, or truncation cap
ever drift apart from each other again, something here will fail loudly
instead of silently shipping an unbounded collection a second time.

No live Mongo is available in this sandbox (confirmed empirically:
localhost:27017 connection refused), so a REAL TTL expiry (which Mongo's own
background monitor performs, not something either driver API call can fully
simulate standalone) cannot be exercised here either way — that part was
never testable from this sandbox for ANY collection in this codebase, and
isn't specific to this fix.
"""
import pytest


class _FakeErrorEventsCollection:
    def __init__(self):
        self.create_index_calls = []
        self.inserted = []

    async def create_index(self, key, **kwargs):
        self.create_index_calls.append((key, kwargs))
        return kwargs.get("name") or f"{key}_1"

    async def insert_one(self, doc):
        self.inserted.append(doc)
        return type("Result", (), {"inserted_id": "fake-id"})()


class _FakeDB:
    def __init__(self):
        self.error_events = _FakeErrorEventsCollection()


@pytest.fixture
def server_mod():
    import server as server_module
    return server_module


@pytest.mark.asyncio
async def test_ttl_index_is_created_on_the_right_field_with_the_named_constant(server_mod):
    fdb = _FakeDB()
    await server_mod.ensure_error_event_ttl_index(fdb)
    assert len(fdb.error_events.create_index_calls) == 1
    key, kwargs = fdb.error_events.create_index_calls[0]
    assert key == "created_at"  # must match _record_error_event's own field name exactly
    assert kwargs["name"] == "error_events_ttl"
    assert kwargs["expireAfterSeconds"] == server_mod.ERROR_EVENTS_RETENTION_DAYS * 24 * 3600


@pytest.mark.asyncio
async def test_a_failed_index_creation_never_raises(server_mod):
    """Matches the original design intent: an index-creation hiccup (e.g. a
    conflicting index already exists with different options) must never
    crash app startup."""
    class _BoomCollection:
        async def create_index(self, *a, **k):
            raise RuntimeError("index conflict")

    class _BoomDB:
        error_events = _BoomCollection()

    # Must not raise.
    await server_mod.ensure_error_event_ttl_index(_BoomDB())


@pytest.mark.asyncio
async def test_record_error_event_caps_traceback_and_uses_a_real_bson_date(server_mod, monkeypatch):
    """A TTL index only works if the indexed field is a real BSON date, not
    a string -- and only bounds growth if the traceback itself is capped.
    Confirms both, directly against the named constants (not a re-typed
    magic number that could silently drift out of sync with them)."""
    import datetime as real_datetime

    captured = {}

    class _FakeErrorEvents:
        async def insert_one(self, doc):
            captured.update(doc)

    class _FakeDBForRecord:
        error_events = _FakeErrorEvents()

    monkeypatch.setattr(server_mod, "db", _FakeDBForRecord())

    class _FakeRequest:
        class _URL:
            path = "/api/__test_n05__"
        url = _URL()
        method = "GET"

    try:
        # A long-ish traceback: 10x the cap, so truncation is actually exercised.
        raise ValueError("x" * (server_mod.ERROR_EVENT_TRACEBACK_MAX_CHARS * 10))
    except ValueError as exc:
        server_mod._record_error_event(_FakeRequest(), exc)

    # _record_error_event schedules the actual insert as a fire-and-forget
    # asyncio task (requires a running loop, hence this test is async) —
    # yield control a couple of times so it actually executes.
    import asyncio
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert captured, "expected _record_error_event to have inserted a doc"
    assert len(captured["traceback"]) <= server_mod.ERROR_EVENT_TRACEBACK_MAX_CHARS
    assert isinstance(captured["created_at"], real_datetime.datetime), (
        "created_at must be a real datetime (BSON date) for the TTL index "
        "to ever act on it -- a string timestamp would silently never expire"
    )
    # Privacy contract (unchanged by this fix, reconfirmed here): no request
    # body, headers, tokens, query string, or message content.
    allowed = {"route", "method", "error_type", "traceback", "status_code", "created_at"}
    assert set(captured.keys()).issubset(allowed)
