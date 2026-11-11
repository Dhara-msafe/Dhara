"""
XC-SEC — Security & privacy controls (cross-cutting, Day 4 QA journey).

This journey is genuinely "Automated + review" (the register's own "how"
column): some of it is a checkable, automatable invariant; the rest is a
documented manual review of what already exists, cross-referencing the
auth/privacy work this session already did for N-02, B-11, N-05, W2-J07,
W4-J01 rather than re-investigating from scratch.

AUTOMATED PART (this file): every admin-only route in this codebase must
call the shared admin-key check (check_admin_key / _check_admin_key)
somewhere in its body. This is a source-level regression guard, not a live
HTTP test: it scans server.py (by the /admin/* URL prefix) and
api/issues_router.py (by the actual x_admin_key parameter, NOT the URL
prefix -- see finding below) for every admin-gated route function and
asserts the gate is present in its source, so a FUTURE admin endpoint added
without this check is caught automatically instead of silently shipping an
open analytics/export endpoint.

FINDING from writing this scan: GET /issues and PATCH /issues/{report_id}
in api/issues_router.py are BOTH admin-only (declare x_admin_key, call
check_admin_key, say so in their own docstrings) but are NOT under an
/admin/* path. A purely path-prefix-based audit of "which routes are admin-
gated" would silently miss both of them. Not a vulnerability by itself
(both ARE correctly gated) -- but it means anyone auditing this codebase by
grepping for "/admin" alone gets an incomplete picture. Flagging this for
the TL as a naming-consistency improvement to consider (e.g. renaming to
/admin/issues, /admin/issues/{id}), not fixing it myself since it's a
URL/contract change a frontend or external tooling might depend on.

ADDENDUM (same investigation, widened after the finding above): grepping
the whole backend for "x_admin_key" turned up 6 files total, but this
file's original scan only covered server.py and issues_router.py. The
other 4 -- api/journeys_router.py, api/safety_router.py,
api/upi_billing_router.py, api/women_router.py -- were unaudited. Counting
"x_admin_key" mentions vs. "check_admin_key(x_admin_key)" calls per file
found a real bug in api/safety_router.py: POST /safety/admin/init-indexes
(init_indexes()) had its OWN inline admin-key check --
`expected = os.getenv("ADMIN_KEY", ""); if not expected or x_admin_key !=
expected: raise HTTPException(403, ...)` -- instead of calling the shared
check_admin_key() helper every other admin route in the codebase uses.
Two concrete problems with the inline version: (1) `!=` on strings is not
constant-time, so a wrong guess is in principle timeable character-by-
character, where check_admin_key()'s hmac.compare_digest() is immune to
that; (2) it returned 403 instead of 401, inconsistent with every other
admin route. Low severity in practice -- the endpoint is a one-time,
idempotent index-creation utility, not something exposing user data -- but
a duplicated, divergent copy of a security check is exactly the kind of
thing that drifts out of sync the next time the shared one is hardened.
Fixed: init_indexes() now takes x_admin_key via FastAPI's Header(None) (not
a bare default, matching every other admin route's signature) and calls
check_admin_key(x_admin_key) directly; the now-unused `import os` was
removed from the file. The other three files (journeys_router.py,
upi_billing_router.py, women_router.py) were checked and already call
check_admin_key(x_admin_key) correctly on every route that declares the
parameter -- no changes needed there. This file's scan is now extended to
cover all four of these routers (by the parameter-based scan, not the URL
prefix, since the issues_router.py finding above already showed prefix-only
auditing misses real admin routes), so a future regression of this exact
class (a new admin route reimplementing its own check) is caught
automatically instead of needing another manual grep sweep to find it.

MANUAL REVIEW PART (documented here, not re-tested -- already covered by
this session's other work and cited by commit):
  - Every endpoint that touches a paid API or per-user state requires
    current_user (401 if missing/invalid token) -- confirmed this session
    for the 5 geo_router routes (N-02, commit 0a8b010) and chat_router's
    /chat/stream, /chat/followup, /voice/transcribe (already had
    current_user; re-confirmed this session, commit 8feb859). The one
    intentional exception found is /api/advocate/cross-reference
    (W4-J01, commit 9dc6b98) -- a free, DB-only lookup with no paid API and
    no per-user state behind it, correctly left open.
  - CORS: allow_origins=["*"] with allow_credentials=False (server.py,
    ~line 1898-1902). This combination is the SAFE one for a Bearer-token
    API (no cookies, so there is no credentialed-wildcard CSRF/cookie-theft
    risk the way there would be if allow_credentials were True alongside a
    wildcard origin) -- confirmed intentional, not a misconfiguration.
  - JWT_SECRET is read via os.environ["JWT_SECRET"] (config/settings.py) --
    a hard KeyError on boot if unset, no weak/hardcoded fallback value.
  - Privacy-safe aggregate schemas (no user_id/session_id/message/answer
    text) are now a consistent, tested pattern across refusal_events
    (B-11, commit b00f491) and error_events (N-05, commit 954ae20) -- both
    reviewed this session with the exact same "what fields are allowed"
    test shape.
  - Rate limiting is a consistent, reused pattern (usage_daily counter,
    per-user + per-IP + per-day) across auth_router's guest-IP throttle,
    dependencies.py's app-wide LLM-call cap, and geo_router's N-02 fix --
    not three ad-hoc implementations.

NOT reviewed in this pass (out of scope for what's checkable from this
sandbox, flagged for the TL): secret rotation/storage (ADMIN_KEY rotation
is already a separately-flagged open item from Day 2's B-02 work), TLS/
transport security (sandbox has no live deployed server to inspect),
dependency CVE scanning, and anything requiring a live penetration-test-
style pass against a real running deployment.
"""
import ast
import os

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_ADMIN_GATE_NAMES = {"_check_admin_key", "check_admin_key"}


def _admin_route_functions(file_path: str, route_decorator_prefix: str = "/admin"):
    """Parse a Python file's AST and return (func_name, lineno, source) for
    every async function decorated with an HTTP-method decorator whose path
    starts with the given prefix (e.g. "/admin"). Source-level, not an
    import -- avoids needing the app's full runtime dependencies to inspect
    every route in the codebase."""
    with open(file_path, encoding="utf-8") as f:
        src = f.read()
    tree = ast.parse(src, filename=file_path)
    lines = src.splitlines()
    results = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            if not dec.args:
                continue
            path_arg = dec.args[0]
            path_val = getattr(path_arg, "value", None)
            if isinstance(path_val, str) and path_val.startswith(route_decorator_prefix):
                start, end = node.lineno - 1, node.end_lineno
                func_src = "\n".join(lines[start:end])
                results.append((node.name, node.lineno, func_src))
                break
    return results


def _routes_with_x_admin_key_param(file_path: str):
    """Broader, naming-convention-independent scan: finds every route
    function that DECLARES an `x_admin_key` parameter at all, regardless of
    its URL path. Finding, this review turned up while writing the
    prefix-based scan above: GET /issues and PATCH /issues/{report_id} in
    api/issues_router.py are BOTH admin-only (declare x_admin_key, call
    check_admin_key, and say so in their own docstrings) but are NOT under
    an /admin/* path -- a purely path-prefix-based audit would silently
    miss them. This scan catches admin-gated routes by their actual
    admin-key parameter instead, which is a stronger invariant."""
    with open(file_path, encoding="utf-8") as f:
        src = f.read()
    tree = ast.parse(src, filename=file_path)
    lines = src.splitlines()
    results = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        arg_names = [a.arg for a in node.args.args] + [a.arg for a in node.args.kwonlyargs]
        if "x_admin_key" in arg_names:
            start, end = node.lineno - 1, node.end_lineno
            func_src = "\n".join(lines[start:end])
            results.append((node.name, node.lineno, func_src))
    return results


class TestEveryAdminRouteChecksTheAdminKey:
    def test_server_py_admin_routes_all_gate_on_admin_key(self):
        routes = _admin_route_functions(os.path.join(BACKEND_DIR, "server.py"))
        assert len(routes) >= 5, "expected at least the 5 known /admin routes in server.py"
        for name, lineno, func_src in routes:
            assert any(gate in func_src for gate in _ADMIN_GATE_NAMES), (
                f"server.py:{lineno} async def {name}(...) is an /admin route "
                f"but does not call {_ADMIN_GATE_NAMES} anywhere in its body"
            )

    def test_issues_router_admin_routes_all_gate_on_admin_key(self):
        # Naming-convention-independent: GET /issues and PATCH
        # /issues/{report_id} are admin-only but not under /admin/* (see
        # _routes_with_x_admin_key_param's docstring) -- scan by the actual
        # x_admin_key parameter, not the URL prefix.
        routes = _routes_with_x_admin_key_param(os.path.join(BACKEND_DIR, "api", "issues_router.py"))
        assert len(routes) >= 3, "expected at least 3 admin-key-gated routes in issues_router.py"
        for name, lineno, func_src in routes:
            assert any(gate in func_src for gate in _ADMIN_GATE_NAMES), (
                f"api/issues_router.py:{lineno} async def {name}(...) declares "
                f"x_admin_key but never calls {_ADMIN_GATE_NAMES} -- the "
                f"parameter alone does nothing without the check"
            )

    def test_this_guard_actually_finds_routes_not_silently_matching_zero(self):
        """Confidence check on the AST scanner itself: if route discovery
        ever silently found 0 matches (e.g. a refactor renames the router
        variable or decorator shape), the tests above would vacuously pass
        having checked nothing. Pins the exact count found today so a
        future change to admin routes is a deliberate, visible update to
        this number, not a silent gap."""
        server_routes = _admin_route_functions(os.path.join(BACKEND_DIR, "server.py"))
        issues_routes = _routes_with_x_admin_key_param(os.path.join(BACKEND_DIR, "api", "issues_router.py"))
        assert len(server_routes) == 5, [n for n, _, _ in server_routes]
        assert len(issues_routes) == 3, [n for n, _, _ in issues_routes]

    def test_safety_router_init_indexes_gates_on_admin_key(self):
        # The safety_router.py fix (see this file's module docstring
        # addendum): init_indexes() used to reimplement its own
        # non-constant-time admin-key comparison instead of calling the
        # shared check_admin_key() helper. Scanned by the x_admin_key
        # parameter name, same as issues_router.py above (this file is a
        # single POST route, not under /admin/*, so a prefix-based scan
        # would again miss it).
        routes = _routes_with_x_admin_key_param(os.path.join(BACKEND_DIR, "api", "safety_router.py"))
        assert len(routes) == 1, [n for n, _, _ in routes]
        name, lineno, func_src = routes[0]
        assert name == "init_indexes"
        assert any(gate in func_src for gate in _ADMIN_GATE_NAMES), (
            f"api/safety_router.py:{lineno} async def {name}(...) declares "
            f"x_admin_key but never calls {_ADMIN_GATE_NAMES} -- the "
            f"parameter alone does nothing without the check"
        )
        # Pin the regression this test exists for: the old inline check
        # used `!=` directly against x_admin_key, bypassing the shared
        # timing-safe helper entirely.
        assert "x_admin_key != expected" not in func_src
        assert "os.getenv(\"ADMIN_KEY\"" not in func_src and "os.environ" not in func_src

    def test_journeys_upi_billing_women_routers_all_gate_on_admin_key(self):
        # These three were already correct before this pass (confirmed by
        # grep during the same investigation that found the safety_router.py
        # bug) -- added here so the whole x_admin_key surface area the repo
        # grep found (6 files total) is now under one regression guard,
        # not just the 2 files (server.py, issues_router.py) this file
        # started with.
        for rel_path, expected_min in [
            (("api", "journeys_router.py"), 4),
            (("api", "upi_billing_router.py"), 3),
            (("api", "women_router.py"), 5),
        ]:
            file_path = os.path.join(BACKEND_DIR, *rel_path)
            routes = _routes_with_x_admin_key_param(file_path)
            assert len(routes) >= expected_min, (
                f"{os.path.join(*rel_path)}: expected at least "
                f"{expected_min} x_admin_key routes, found {len(routes)}"
            )
            for name, lineno, func_src in routes:
                assert any(gate in func_src for gate in _ADMIN_GATE_NAMES), (
                    f"{os.path.join(*rel_path)}:{lineno} async def {name}(...) "
                    f"declares x_admin_key but never calls {_ADMIN_GATE_NAMES}"
                )


class TestCorsConfigurationIsTheSafeCombination:
    def test_wildcard_origin_only_paired_with_credentials_disabled(self):
        src = open(os.path.join(BACKEND_DIR, "server.py"), encoding="utf-8").read()
        idx = src.index("CORSMiddleware,")
        block = src[idx: idx + 300]
        assert "allow_origins=[\"*\"]" in block
        assert "allow_credentials=False" in block, (
            "allow_origins=['*'] combined with allow_credentials=True would be "
            "an actual CORS misconfiguration (credentialed wildcard) -- this "
            "guards against that combination ever being introduced"
        )


class TestJwtSecretHasNoWeakFallback:
    def test_jwt_secret_is_required_not_defaulted(self):
        src = open(os.path.join(BACKEND_DIR, "config", "settings.py"), encoding="utf-8").read()
        assert 'JWT_SECRET   = os.environ["JWT_SECRET"]' in src or \
               'JWT_SECRET = os.environ["JWT_SECRET"]' in src, (
            "JWT_SECRET must come from os.environ[...] (hard KeyError if "
            "unset) -- a os.environ.get('JWT_SECRET', '<default>') fallback "
            "would be a real secret-management regression"
        )
