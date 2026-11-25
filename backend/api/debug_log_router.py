"""
debug_log_router.py
===================
Admin-only debug log dashboard and data API.

Routes:
  GET /api/admin/logs              — HTML dashboard (browser, ?key= required)
  GET /api/admin/logs/data         — JSON data (dashboard polls this)
  GET /api/admin/logs/export       — CSV download

All three require ?key=<ADMIN_KEY> matching the backend ADMIN_KEY secret.
If ADMIN_KEY is not set the routes return 503 immediately.
"""
from __future__ import annotations

import csv
import io
import json
import os
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from dependencies import db, logger

router = APIRouter()

# ── Auth ──────────────────────────────────────────────────────────────────────

_ADMIN_KEY = os.environ.get("ADMIN_KEY", "").strip()


def _require_key(key: Optional[str]) -> None:
    if not _ADMIN_KEY:
        raise HTTPException(503, {"code": "admin_key_not_configured",
                                  "message": "ADMIN_KEY is not set; dashboard is disabled."})
    if not key or not hmac.compare_digest(key, _ADMIN_KEY):
        raise HTTPException(403, {"code": "forbidden", "message": "Invalid key."})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ser(obj):
    """JSON-serialise MongoDB documents (convert datetime → ISO string, ObjectId → str)."""
    if isinstance(obj, dict):
        return {k: _ser(v) for k, v in obj.items() if k != "_id"}
    if isinstance(obj, list):
        return [_ser(i) for i in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


async def _query_logs(
    *,
    tab: str = "live",
    from_dt: Optional[str] = None,
    to_dt: Optional[str] = None,
    status_filter: Optional[str] = None,
    path_prefix: Optional[str] = None,
    q: Optional[str] = None,
    user_query: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    filt: dict = {}

    # Time range (defaults to last 2 hours)
    now = datetime.now(timezone.utc)
    dt_from = now - timedelta(hours=2)
    dt_to = now

    if from_dt:
        try:
            dt_from = datetime.fromisoformat(from_dt.replace("Z", "+00:00"))
        except ValueError:
            pass
    if to_dt:
        try:
            dt_to = datetime.fromisoformat(to_dt.replace("Z", "+00:00"))
        except ValueError:
            pass
    filt["ts"] = {"$gte": dt_from, "$lte": dt_to}

    # Tab-specific filters
    if tab == "errors":
        filt["status"] = {"$gte": 400}
    elif tab == "user" and user_query:
        uq = user_query.strip()
        filt["$or"] = [
            {"user_email": {"$regex": uq, "$options": "i"}},
            {"user_id": {"$regex": uq, "$options": "i"}},
        ]

    # Status filter
    if status_filter == "2xx":
        filt["status"] = {"$gte": 200, "$lt": 300}
    elif status_filter == "4xx":
        filt["status"] = {"$gte": 400, "$lt": 500}
    elif status_filter == "5xx":
        filt["status"] = {"$gte": 500}

    # Path prefix
    if path_prefix:
        filt["path"] = {"$regex": f"^{path_prefix}", "$options": "i"}

    # Free-text search on error_msg
    if q:
        filt["error_msg"] = {"$regex": q, "$options": "i"}

    rows = []
    async for doc in db.debug_logs.find(filt).sort("ts", -1).limit(limit):
        rows.append(_ser(doc))
    return rows


# ── Data API ──────────────────────────────────────────────────────────────────

@router.get("/admin/logs/data")
async def logs_data(
    key: Optional[str] = Query(None),
    tab: str = Query("live"),
    from_dt: Optional[str] = Query(None),
    to_dt: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    path_prefix: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    user_query: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
):
    _require_key(key)
    rows = await _query_logs(
        tab=tab, from_dt=from_dt, to_dt=to_dt,
        status_filter=status_filter, path_prefix=path_prefix,
        q=q, user_query=user_query, limit=limit,
    )
    return JSONResponse({"logs": rows, "count": len(rows)})


# ── CSV export ────────────────────────────────────────────────────────────────

@router.get("/admin/logs/export")
async def logs_export(
    key: Optional[str] = Query(None),
    tab: str = Query("live"),
    from_dt: Optional[str] = Query(None),
    to_dt: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    path_prefix: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    user_query: Optional[str] = Query(None),
):
    _require_key(key)
    rows = await _query_logs(
        tab=tab, from_dt=from_dt, to_dt=to_dt,
        status_filter=status_filter, path_prefix=path_prefix,
        q=q, user_query=user_query, limit=500,
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ts", "user_id", "user_email", "method", "full_path",
                "status", "duration_ms", "req_body", "res_body",
                "error_msg", "stack_trace"])
    for r in rows:
        w.writerow([
            r.get("ts", ""), r.get("user_id", ""), r.get("user_email", ""),
            r.get("method", ""), r.get("full_path", ""),
            r.get("status", ""), r.get("duration_ms", ""),
            json.dumps(r.get("req_body")) if r.get("req_body") is not None else "",
            json.dumps(r.get("res_body")) if r.get("res_body") is not None else "",
            r.get("error_msg", ""), r.get("stack_trace", ""),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dhara_debug_logs.csv"},
    )


# ── HTML dashboard ────────────────────────────────────────────────────────────

@router.get("/admin/logs", response_class=HTMLResponse, include_in_schema=False)
async def logs_dashboard(key: Optional[str] = Query(None)):
    _require_key(key)
    # The key is embedded in the page so the JS can poll /data with it.
    # It is never stored anywhere on the client beyond the in-memory JS variable.
    safe_key = key.replace('"', "").replace("'", "").replace("<", "").replace(">", "")
    return HTMLResponse(_DASHBOARD_HTML.replace("__ADMIN_KEY__", safe_key))


# ── Self-contained dashboard HTML ─────────────────────────────────────────────

_DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dhara Debug Logs</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:14px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
a{color:#38bdf8;text-decoration:none}

/* Header */
.hdr{padding:12px 20px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:16px;flex-shrink:0;background:#0a1120}
.hdr-title{font-size:15px;font-weight:700;color:#f8fafc;letter-spacing:-0.01em}
.hdr-sub{color:#475569;font-size:12px}
.hdr-spacer{flex:1}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}
.dot-green{background:#22c55e;animation:pulse 2s infinite}
.dot-grey{background:#475569}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.pause-btn{background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px}
.pause-btn:hover{background:#334155;color:#e2e8f0}
.pause-btn.paused{background:#334155;color:#fbbf24;border-color:#fbbf24}

/* Tabs */
.tabs{display:flex;border-bottom:1px solid #1e293b;padding:0 20px;flex-shrink:0;background:#0a1120}
.tab{padding:10px 18px;cursor:pointer;color:#64748b;border-bottom:2px solid transparent;font-size:13px;font-weight:500;user-select:none;transition:color .15s}
.tab:hover{color:#cbd5e1}
.tab.active{color:#38bdf8;border-color:#38bdf8}

/* Filters bar */
.filters{padding:10px 20px;display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid #1e293b;background:#080f1e;flex-shrink:0;align-items:center}
.filters input,.filters select{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 10px;font-size:13px;outline:none;height:32px}
.filters input:focus,.filters select:focus{border-color:#38bdf8}
.filters input::placeholder{color:#475569}
.btn{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px;height:32px;display:inline-flex;align-items:center;gap:5px}
.btn:hover{background:#334155}
.btn-blue{background:#0369a1;border-color:#0369a1;color:#fff}
.btn-blue:hover{background:#0284c7}

/* User search pane */
.user-pane{padding:12px 20px;border-bottom:1px solid #1e293b;display:flex;gap:8px;flex-shrink:0;background:#080f1e}
.user-pane input{flex:1;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:7px 12px;font-size:14px;outline:none;max-width:400px}
.user-pane input:focus{border-color:#38bdf8}

/* Table area */
.table-scroll{flex:1;overflow-y:auto;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:700px}
th{text-align:left;padding:8px 12px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#0f172a;z-index:1;white-space:nowrap}
td{padding:7px 12px;border-bottom:1px solid #0d1829;vertical-align:middle;white-space:nowrap}
.data-row{cursor:pointer}
.data-row:hover td{background:#131e35}
.data-row.expanded-parent td{background:#0a1526;border-bottom:none}

/* Expanded detail */
.detail-row td{padding:0;background:#060d1a;border-bottom:1px solid #1e293b}
.detail-inner{padding:14px 20px 18px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.detail-inner.single{grid-template-columns:1fr}
.detail-block{}
.detail-label{font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600}
pre.code{font-family:'JetBrains Mono','Cascadia Code','Fira Code',Consolas,monospace;font-size:11.5px;line-height:1.6;background:#020812;padding:12px;border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;border:1px solid #0d1829;max-height:320px;overflow-y:auto}
pre.stack{font-family:'JetBrains Mono',Consolas,monospace;font-size:11px;line-height:1.5;background:#1a0505;padding:12px;border-radius:8px;overflow-x:auto;white-space:pre;border:1px solid #450a0a;max-height:280px;overflow-y:auto;color:#fca5a5}

/* Badges */
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em}
.b2{background:#052e16;color:#4ade80}.b3{background:#052e16;color:#4ade80}
.b4{background:#422006;color:#fb923c}
.b5{background:#450a0a;color:#f87171}
.bx{background:#1e293b;color:#94a3b8}

/* Duration colors */
.df{color:#4ade80}.dm{color:#fbbf24}.ds{color:#f87171}

/* Mono cells */
.mono{font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}
.path-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis;font-family:monospace;font-size:12px;color:#cbd5e1}
.user-cell{max-width:160px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#94a3b8}

/* Status bar */
.sbar{padding:5px 20px;display:flex;align-items:center;gap:14px;color:#475569;font-size:11px;border-top:1px solid #1e293b;flex-shrink:0;background:#060d1a}

/* Empty / loading */
.empty{text-align:center;padding:60px 20px;color:#334155;font-size:14px}

/* JSON syntax highlight */
.jk{color:#7dd3fc}
.js{color:#86efac}
.jn{color:#fca5a5}
.jb{color:#c084fc}
.jl{color:#94a3b8}
.jr{color:#64748b;font-style:italic}

/* Scrollbar */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#0a1120}
::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#334155}
</style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="hdr-title">&#x1F4CB; Dhara Debug Logs</div>
    <div class="hdr-sub" id="env-label">Loading&hellip;</div>
  </div>
  <div class="hdr-spacer"></div>
  <span id="refresh-indicator"><span class="dot dot-green"></span><span style="font-size:12px;color:#64748b">Live</span></span>
  &nbsp;
  <button class="pause-btn" id="pause-btn" onclick="togglePause()">&#9646;&#9646; Pause</button>
  &nbsp;
  <button class="btn btn-blue" onclick="exportCSV()">&#11015; CSV</button>
</div>

<div class="tabs">
  <div class="tab active" id="tab-live" onclick="switchTab('live')">&#128247; Live feed</div>
  <div class="tab" id="tab-user" onclick="switchTab('user')">&#128100; User drill-down</div>
  <div class="tab" id="tab-errors" onclick="switchTab('errors')">&#9888; Errors</div>
</div>

<div class="filters" id="filter-bar">
  <input type="datetime-local" id="f-from" title="From" style="width:190px">
  <input type="datetime-local" id="f-to" title="To" style="width:190px">
  <select id="f-status" style="width:90px">
    <option value="">All</option>
    <option value="2xx">2xx</option>
    <option value="4xx">4xx</option>
    <option value="5xx">5xx</option>
  </select>
  <input type="text" id="f-path" placeholder="/api/..." style="width:160px">
  <input type="text" id="f-q" placeholder="Error search..." style="width:160px">
  <button class="btn" onclick="loadData()">&#128269; Apply</button>
  <button class="btn" onclick="resetFilters()">&#10005; Reset</button>
</div>

<div class="user-pane" id="user-pane" style="display:none">
  <input type="text" id="user-query" placeholder="Enter user email or ID&hellip;" onkeydown="if(event.key==='Enter')loadData()">
  <button class="btn btn-blue" onclick="loadData()">Search</button>
</div>

<div class="table-scroll" id="table-wrap">
  <table id="log-table">
    <thead>
      <tr>
        <th style="width:155px">Time</th>
        <th style="width:160px">User</th>
        <th style="width:55px">Method</th>
        <th>Path</th>
        <th style="width:62px">Status</th>
        <th style="width:72px">Duration</th>
      </tr>
    </thead>
    <tbody id="log-body">
      <tr><td colspan="6" class="empty">Loading&hellip;</td></tr>
    </tbody>
  </table>
</div>

<div class="sbar">
  <span id="count-label">— rows</span>
  <span id="last-refresh"></span>
</div>

<script>
const KEY = "__ADMIN_KEY__";
let currentTab = "live";
let paused = false;
let expandedId = null;
let refreshTimer = null;

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 3600000);
  document.getElementById("f-from").value = localDTInput(twoHoursAgo);
  document.getElementById("f-to").value   = localDTInput(now);
  document.getElementById("env-label").textContent = window.location.hostname;
  loadData();
  refreshTimer = setInterval(() => { if (!paused) loadData(true); }, 3000);
})();

function localDTInput(d) {
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  ["live","user","errors"].forEach(t => {
    document.getElementById("tab-"+t).classList.toggle("active", t===tab);
  });
  document.getElementById("user-pane").style.display = (tab==="user") ? "flex" : "none";
  expandedId = null;
  loadData();
}

// ── Pause ─────────────────────────────────────────────────────────────────────
function togglePause() {
  paused = !paused;
  const btn = document.getElementById("pause-btn");
  const dot = document.querySelector("#refresh-indicator .dot");
  btn.textContent = paused ? "▶ Resume" : "❚❚ Pause";
  btn.classList.toggle("paused", paused);
  dot.className = "dot " + (paused ? "dot-grey" : "dot-green");
}

// ── Filters ───────────────────────────────────────────────────────────────────
function resetFilters() {
  const now = new Date();
  document.getElementById("f-from").value = localDTInput(new Date(now - 2*3600000));
  document.getElementById("f-to").value   = localDTInput(now);
  document.getElementById("f-status").value = "";
  document.getElementById("f-path").value = "";
  document.getElementById("f-q").value = "";
  if (currentTab === "user") document.getElementById("user-query").value = "";
  loadData();
}

function buildParams(extra) {
  const p = new URLSearchParams();
  p.set("key", KEY);
  p.set("tab", currentTab);
  const fFrom = document.getElementById("f-from").value;
  const fTo   = document.getElementById("f-to").value;
  if (fFrom) p.set("from_dt", new Date(fFrom).toISOString());
  if (fTo)   p.set("to_dt",   new Date(fTo).toISOString());
  const st = document.getElementById("f-status").value;
  if (st) p.set("status", st);
  const path = document.getElementById("f-path").value.trim();
  if (path) p.set("path_prefix", path);
  const q = document.getElementById("f-q").value.trim();
  if (q) p.set("q", q);
  if (currentTab === "user") {
    const uq = document.getElementById("user-query").value.trim();
    if (uq) p.set("user_query", uq);
  }
  if (extra) Object.entries(extra).forEach(([k,v]) => p.set(k,v));
  return p;
}

// ── Load data ─────────────────────────────────────────────────────────────────
let currentRows = [];

async function loadData(silent) {
  try {
    const url = "/api/admin/logs/data?" + buildParams();
    const resp = await fetch(url);
    if (!resp.ok) {
      if (!silent) showError(await resp.text());
      return;
    }
    const data = await resp.json();
    currentRows = data.logs || [];
    renderTable(currentRows, silent);
    document.getElementById("count-label").textContent = currentRows.length + " rows";
    document.getElementById("last-refresh").textContent =
      "Refreshed " + new Date().toLocaleTimeString();
  } catch(e) {
    if (!silent) showError(String(e));
  }
}

function showError(msg) {
  document.getElementById("log-body").innerHTML =
    `<tr><td colspan="6" class="empty" style="color:#f87171">${esc(msg)}</td></tr>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTable(rows, silent) {
  const tbody = document.getElementById("log-body");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No logs in this range.</td></tr>`;
    expandedId = null;
    return;
  }

  // If a row was expanded, remember its ts so we can re-expand after refresh
  let wasExpandedTs = null;
  if (expandedId !== null && rows[expandedId]) {
    wasExpandedTs = rows[expandedId].ts;
  }

  let html = "";
  rows.forEach((r, i) => {
    const ts = r.ts ? new Date(r.ts).toLocaleTimeString([], {hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "?";
    const tsDate = r.ts ? new Date(r.ts).toLocaleDateString([], {month:"short",day:"numeric"}) : "";
    const user  = r.user_email || r.user_id || "anon";
    const method = r.method || "?";
    const path  = r.full_path || r.path || "/";
    const st    = r.status || 0;
    const dur   = r.duration_ms != null ? r.duration_ms : "?";
    const isExp = (expandedId === i);
    const badge = stBadge(st);
    const durCls = dur === "?" ? "" : (dur < 500 ? "df" : dur < 2000 ? "dm" : "ds");

    html += `<tr class="data-row${isExp?" expanded-parent":""}" onclick="toggleRow(${i})" id="row-${i}">
      <td class="mono" style="color:#64748b;font-size:11.5px">${esc(tsDate)}&nbsp;<span style="color:#94a3b8">${esc(ts)}</span></td>
      <td class="user-cell" title="${esc(user)}">${esc(user)}</td>
      <td class="mono" style="color:#7dd3fc;font-size:11.5px">${esc(method)}</td>
      <td class="path-cell" title="${esc(path)}">${esc(path)}</td>
      <td>${badge}</td>
      <td class="mono ${durCls}">${dur}ms</td>
    </tr>`;

    if (isExp) {
      html += detailRow(r);
    }
  });

  tbody.innerHTML = html;

  // Re-sync expandedId if rows shifted during auto-refresh (match by ts)
  if (silent && wasExpandedTs) {
    const newIdx = rows.findIndex(r => r.ts === wasExpandedTs);
    if (newIdx >= 0 && newIdx !== expandedId) {
      expandedId = newIdx;
      // No need to re-render; the row is already rendered correctly since we used expandedId
    }
  }
}

function stBadge(st) {
  if (st >= 500) return `<span class="badge b5">${st}</span>`;
  if (st >= 400) return `<span class="badge b4">${st}</span>`;
  if (st >= 200) return `<span class="badge b2">${st}</span>`;
  return `<span class="badge bx">${st||"?"}</span>`;
}

function detailRow(r) {
  const cols = (r.req_body != null && r.res_body != null) ? 2 : 1;
  const gridClass = cols === 1 ? "single" : "";

  let inner = `<div class="detail-inner ${gridClass}">`;

  if (r.req_body != null) {
    inner += `<div class="detail-block"><div class="detail-label">Request body</div>
      <pre class="code">${syntaxHighlight(r.req_body)}</pre></div>`;
  }
  if (r.res_body != null) {
    inner += `<div class="detail-block"><div class="detail-label">Response body</div>
      <pre class="code">${syntaxHighlight(r.res_body)}</pre></div>`;
  }
  if (!r.req_body && !r.res_body) {
    inner += `<div class="detail-block"><div class="detail-label">Bodies</div>
      <pre class="code" style="color:#475569">— no body captured —</pre></div>`;
  }
  inner += `</div>`;

  if (r.stack_trace) {
    inner = inner.slice(0, -6) + `</div>
    <div style="padding:0 20px 16px"><div class="detail-label">Stack trace</div>
      <pre class="stack">${esc(r.stack_trace)}</pre></div>`;
  }

  return `<tr class="detail-row"><td colspan="6"><div class="detail-inner-wrap">${inner}</div></td></tr>`;
}

function toggleRow(i) {
  expandedId = (expandedId === i) ? null : i;
  renderTable(currentRows, false);
  if (expandedId !== null) {
    const el = document.getElementById("row-" + i);
    if (el) el.scrollIntoView({block:"nearest"});
  }
}

// ── JSON syntax highlight (no CDN) ───────────────────────────────────────────
function syntaxHighlight(obj) {
  let str;
  try { str = JSON.stringify(obj, null, 2); } catch(e) { return esc(String(obj)); }
  str = str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return str.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function(match) {
      let cls = "jn"; // number
      if (/^"/.test(match)) {
        if (/:$/.test(match))                   cls = "jk"; // key
        else if (/"\[redacted\]"/.test(match))  cls = "jr"; // redacted
        else                                    cls = "js"; // string
      } else if (/true|false/.test(match))      cls = "jb"; // bool
      else if (/null/.test(match))              cls = "jl"; // null
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV() {
  const url = "/api/admin/logs/export?" + buildParams({limit: 500});
  window.location.href = url;
}
</script>
</body>
</html>
"""
