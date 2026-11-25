"""D-42: the guardian email page refreshes itself only for active-journey
states; the 'nothing to show' page never does (no dead-token polling)."""
import os, sys, types, runpy  # noqa: E401
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DB_NAME", "dhara_qa_test")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("EMERGENT_LLM_KEY", "dummy")
os.environ.setdefault("JWT_SECRET", "dummy")

PASS = FAIL = 0
def _check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}")
    else: FAIL += 1; print(f"  FAIL  {name}  {detail}")

def run():
    from api.journey_router import _guardian_email_page
    plain = _guardian_email_page("T", "<p>b</p>").body.decode()
    _check("no refresh by default", 'http-equiv="refresh"' not in plain)
    live = _guardian_email_page("T", "<p>b</p>", refresh_seconds=30).body.decode()
    _check("active pages carry a 30 s refresh", '<meta http-equiv="refresh" content="30">' in live)
    # The route passes it for both active states and never for 'nothing'.
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api", "journey_router.py")).read()
    _check("both active states refresh", src.count("refresh_seconds=30") == 2)
    nothing_block = src.split('nothing = _guardian_email_page(')[1].split(')')[0]
    _check("'nothing to show' page has no refresh", "refresh_seconds" not in nothing_block)

if __name__ == "__main__":
    run()
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)
