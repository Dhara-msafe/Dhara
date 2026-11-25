"""
debug_log_router.py
===================
Admin-only debug log dashboard and data API.

Requires TWO environment flags (both default OFF):
  DEBUG_LOG_ENABLED=true  — activate logging middleware and this dashboard
  ADMIN_KEY               — secret key required in ?key= for every route

Routes:
  GET /api/admin/logs              — HTML dashboard (browser)
  GET /api/admin/logs/data         — JSON data (dashboard polls this)
  GET /api/admin/logs/export       — CSV download

Body storage is controlled separately by the middleware via DEBUG_LOG_BODIES.
When DEBUG_LOG_BODIES is false (default), bodies are null in every record;
the dashboard shows only metadata (ts, method, path, status, duration, user).
"""
from __future__ import annotations

import csv
import io
import json
import os
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from dependencies import db, logger

router = APIRouter()

# ── Feature flags ─────────────────────────────────────────────────────────────
_ADMIN_KEY   = os.environ.get("ADMIN_KEY", "").strip()
_LOG_ENABLED = os.environ.get("DEBUG_LOG_ENABLED", "").lower() in ("1", "true", "yes")


def _require_key(key: Optional[str]) -> None:
    if not _LOG_ENABLED:
        raise HTTPException(
            503,
            {"code": "log_disabled",
             "message": "Debug logging is disabled. Set DEBUG_LOG_ENABLED=true to activate."},
        )
    if not _ADMIN_KEY:
        raise HTTPException(
            503,
            {"code": "admin_key_not_configured",
             "message": "ADMIN_KEY is not set; dashboard is disabled."},
        )
    if not key or not hmac.compare_digest(key, _ADMIN_KEY):
        raise HTTPException(403, {"code": "forbidden", "message": "Invalid key."})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ser(obj):
    """JSON-serialise MongoDB documents (convert datetime → ISO string, _id dropped)."""
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

    now = datetime.now(timezone.utc)
    dt_from = now - timedelta(hours=2)
    dt_to   = now

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

    if tab == "errors":
        filt["status"] = {"$gte": 400}
    elif tab == "user" and user_query:
        uq = user_query.strip()
        filt["$or"] = [
            {"user_email": {"$regex": uq, "$options": "i"}},
            {"user_id":    {"$regex": uq, "$options": "i"}},
        ]

    if status_filter == "2xx":
        filt["status"] = {"$gte": 200, "$lt": 300}
    elif status_filter == "4xx":
        filt["status"] = {"$gte": 400, "$lt": 500}
    elif status_filter == "5xx":
        filt["status"] = {"$gte": 500}

    if path_prefix:
        filt["path"] = {"$regex": f"^{path_prefix}", "$options": "i"}

    if q:
        filt["error_msg"] = {"$regex": q, "$options": "i"}

    rows = []
    async for doc in db.debug_logs.find(filt).sort("ts", -1).limit(limit):
        rows.append(_ser(doc))
    return rows


# ── Data API ──────────────────────────────────────────────────────────────────

@router.get("/admin/logs/data")
async def logs_data(
    key:           Annotated[Optional[str], Query()] = None,
    tab:           Annotated[str,           Query()] = "live",
    from_dt:       Annotated[Optional[str], Query()] = None,
    to_dt:         Annotated[Optional[str], Query()] = None,
    status_filter: Annotated[Optional[str], Query(alias="status")] = None,
    path_prefix:   Annotated[Optional[str], Query()] = None,
    q:             Annotated[Optional[str], Query()] = None,
    user_query:    Annotated[Optional[str], Query()] = None,
    limit:         Annotated[int,           Query(ge=1, le=500)] = 200,
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
    key:           Annotated[Optional[str], Query()] = None,
    tab:           Annotated[str,           Query()] = "live",
    from_dt:       Annotated[Optional[str], Query()] = None,
    to_dt:         Annotated[Optional[str], Query()] = None,
    status_filter: Annotated[Optional[str], Query(alias="status")] = None,
    path_prefix:   Annotated[Optional[str], Query()] = None,
    q:             Annotated[Optional[str], Query()] = None,
    user_query:    Annotated[Optional[str], Query()] = None,
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
    csv_bytes = buf.getvalue().encode("utf-8")

    async def _stream():
        yield csv_bytes

    return StreamingResponse(
        _stream(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dhara_debug_logs.csv"},
    )


# ── HTML dashboard ────────────────────────────────────────────────────────────

@router.get("/admin/logs", response_class=HTMLResponse, include_in_schema=False)
async def logs_dashboard(key: Annotated[Optional[str], Query()] = None):
    _require_key(key)
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
.hdr{padding:12px 20px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:16px;flex-shrink:0;background:#0a1120}
.hdr-title{font-size:15px;font-weight:700;color:#f8fafc;letter-spacing:-.01em}
.hdr-sub{color:#475569;font-size:12px}
.hdr-spacer{flex:1}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}
.dot-green{background:#22c55e;animation:pulse 2s infinite}
.dot-grey{background:#475569}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.pause-btn{background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px}
.pause-btn:hover{background:#334155;color:#e2e8f0}
.pause-btn.paused{background:#334155;color:#fbbf24;border-color:#fbbf24}
.tabs{display:flex;border-bottom:1px solid #1e293b;padding:0 20px;flex-shrink:0;background:#0a1120}
.tab{padding:10px 18px;cursor:pointer;color:#64748b;border-bottom:2px solid transparent;font-size:13px;font-weight:500;user-select:none;transition:color .15s}
.tab:hover{color:#cbd5e1}
.tab.active{color:#38bdf8;border-color:#38bdf8}
.filters{padding:10px 20px;display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid #1e293b;background:#080f1e;flex-shrink:0;align-items:center}
.filters input,.filters select{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 10px;font-size:13px;outline:none;height:32px}
.filters input:focus,.filters select:focus{border-color:#38bdf8}
.filters input::placeholder{color:#475569}
.btn{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px;height:32px;display:inline-flex;align-items:center;gap:5px}
.btn:hover{background:#334155}
.btn-blue{background:#0369a1;border-color:#0369a1;color:#fff}
.btn-blue:hover{background:#0284c7}
.user-pane{padding:12px 20px;border-bottom:1px solid #1e293b;display:flex;gap:8px;flex-shrink:0;background:#080f1e}
.user-pane input{flex:1;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:7px 12px;font-size:14px;outline:none;max-width:400px}
.user-pane input:focus{border-color:#38bdf8}
.table-scroll{flex:1;overflow-y:auto;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:700px}
th{text-align:left;padding:8px 12px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#0f172a;z-index:1;white-space:nowrap}
td{padding:7px 12px;border-bottom:1px solid #0d1829;vertical-align:middle;white-space:nowrap}
.data-row{cursor:pointer}
.data-row:hover td{background:#131e35}
.data-row.expanded-parent td{background:#0a1526;border-bottom:none}
.detail-row td{padding:0;background:#060d1a;border-bottom:1px solid #1e293b}
.detail-inner{padding:14px 20px 18px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.detail-inner.single{grid-template-columns:1fr}
.detail-label{font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600}
pre.code{font-family:'JetBrains Mono','Cascadia Code','Fira Code',Consolas,monospace;font-size:11.5px;line-height:1.6;background:#020812;padding:12px;border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;border:1px solid #0d1829;max-height:320px;overflow-y:auto}
pre.stack{font-family:'JetBrains Mono',Consolas,monospace;font-size:11px;line-height:1.5;background:#1a0505;padding:12px;border-radius:8px;overflow-x:auto;white-space:pre;border:1px solid #450a0a;max-height:280px;overflow-y:auto;color:#fca5a5}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
.b2{background:#052e16;color:#4ade80}.b4{background:#422006;color:#fb923c}.b5{background:#450a0a;color:#f87171}.bx{background:#1e293b;color:#94a3b8}
.df{color:#4ade80}.dm{color:#fbbf24}.ds{color:#f87171}
.mono{font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}
.path-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis;font-family:monospace;font-size:12px;color:#cbd5e1}
.user-cell{max-width:160px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#94a3b8}
.sbar{padding:5px 20px;display:flex;align-items:center;gap:14px;color:#475569;font-size:11px;border-top:1px solid #1e293b;flex-shrink:0;background:#060d1a}
.empty{text-align:center;padding:60px 20px;color:#334155;font-size:14px}
.jk{color:#7dd3fc}.js{color:#86efac}.jn{color:#fca5a5}.jb{color:#c084fc}.jl{color:#94a3b8}.jr{color:#64748b;font-style:italic}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0a1120}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}::-webkit-scrollbar-thumb:hover{background:#334155}
</style>
</head>
<body>
<div class="hdr">
  <div><div class="hdr-title">&#x1F4CB; Dhara Debug Logs</div><div class="hdr-sub" id="env-label">Loading&hellip;</div></div>
  <div class="hdr-spacer"></div>
  <span id="refresh-indicator"><span class="dot dot-green"></span><span style="font-size:12px;color:#64748b">Live</span></span>&nbsp;
  <button class="pause-btn" id="pause-btn" onclick="togglePause()">&#9646;&#9646; Pause</button>&nbsp;
  <button class="btn btn-blue" onclick="exportCSV()">&#11015; CSV</button>
</div>
<div class="tabs">
  <div class="tab active" id="tab-live" onclick="switchTab('live')">&#128247; Live feed</div>
  <div class="tab" id="tab-user" onclick="switchTab('user')">&#128100; User drill-down</div>
  <div class="tab" id="tab-errors" onclick="switchTab('errors')">&#9888; Errors</div>
</div>
<div class="filters" id="filter-bar">
  <input type="datetime-local" id="f-from" style="width:190px">
  <input type="datetime-local" id="f-to" style="width:190px">
  <select id="f-status" style="width:90px"><option value="">All</option><option value="2xx">2xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option></select>
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
    <thead><tr><th style="width:155px">Time</th><th style="width:160px">User</th><th style="width:55px">Method</th><th>Path</th><th style="width:62px">Status</th><th style="width:72px">Duration</th></tr></thead>
    <tbody id="log-body"><tr><td colspan="6" class="empty">Loading&hellip;</td></tr></tbody>
  </table>
</div>
<div class="sbar"><span id="count-label">— rows</span><span id="last-refresh"></span></div>
<script>
const KEY="__ADMIN_KEY__";
let currentTab="live",paused=false,expandedId=null,currentRows=[];
(function init(){
  const now=new Date(),ago=new Date(now-2*3600000);
  document.getElementById("f-from").value=ldt(ago);
  document.getElementById("f-to").value=ldt(now);
  document.getElementById("env-label").textContent=window.location.hostname;
  loadData();
  setInterval(()=>{if(!paused)loadData(true);},3000);
})();
function ldt(d){const p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
function switchTab(t){
  currentTab=t;
  ["live","user","errors"].forEach(x=>document.getElementById("tab-"+x).classList.toggle("active",x===t));
  document.getElementById("user-pane").style.display=(t==="user")?"flex":"none";
  expandedId=null;loadData();
}
function togglePause(){
  paused=!paused;
  const btn=document.getElementById("pause-btn"),dot=document.querySelector("#refresh-indicator .dot");
  btn.textContent=paused?"▶ Resume":"❚❚ Pause";
  btn.classList.toggle("paused",paused);
  dot.className="dot "+(paused?"dot-grey":"dot-green");
}
function resetFilters(){
  const now=new Date();
  document.getElementById("f-from").value=ldt(new Date(now-2*3600000));
  document.getElementById("f-to").value=ldt(now);
  document.getElementById("f-status").value="";
  document.getElementById("f-path").value="";
  document.getElementById("f-q").value="";
  if(currentTab==="user")document.getElementById("user-query").value="";
  loadData();
}
function buildParams(extra){
  const p=new URLSearchParams();
  p.set("key",KEY);p.set("tab",currentTab);
  const ff=document.getElementById("f-from").value,ft=document.getElementById("f-to").value;
  if(ff)p.set("from_dt",new Date(ff).toISOString());
  if(ft)p.set("to_dt",new Date(ft).toISOString());
  const st=document.getElementById("f-status").value;if(st)p.set("status",st);
  const pp=document.getElementById("f-path").value.trim();if(pp)p.set("path_prefix",pp);
  const qq=document.getElementById("f-q").value.trim();if(qq)p.set("q",qq);
  if(currentTab==="user"){const uq=document.getElementById("user-query").value.trim();if(uq)p.set("user_query",uq);}
  if(extra)Object.entries(extra).forEach(([k,v])=>p.set(k,v));
  return p;
}
async function loadData(silent){
  try{
    const r=await fetch("/api/admin/logs/data?"+buildParams());
    if(!r.ok){if(!silent)showErr(await r.text());return;}
    const d=await r.json();currentRows=d.logs||[];
    renderTable(currentRows);
    document.getElementById("count-label").textContent=currentRows.length+" rows";
    document.getElementById("last-refresh").textContent="Refreshed "+new Date().toLocaleTimeString();
  }catch(e){if(!silent)showErr(String(e));}
}
function showErr(m){document.getElementById("log-body").innerHTML=`<tr><td colspan="6" class="empty" style="color:#f87171">${esc(m)}</td></tr>`;}
function renderTable(rows){
  const tb=document.getElementById("log-body");
  if(!rows.length){tb.innerHTML=`<tr><td colspan="6" class="empty">No logs in this range.</td></tr>`;expandedId=null;return;}
  let h="";
  rows.forEach((r,i)=>{
    const ts=r.ts?new Date(r.ts).toLocaleTimeString([],{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}):"?";
    const td=r.ts?new Date(r.ts).toLocaleDateString([],{month:"short",day:"numeric"}):"";
    const user=r.user_email||r.user_id||"anon";
    const st=r.status||0,dur=r.duration_ms!=null?r.duration_ms:"?";
    const isE=(expandedId===i);
    const dc=dur==="?"?"":dur<500?"df":dur<2000?"dm":"ds";
    h+=`<tr class="data-row${isE?" expanded-parent":""}" onclick="toggleRow(${i})" id="row-${i}">
      <td class="mono" style="color:#64748b;font-size:11.5px">${esc(td)}&nbsp;<span style="color:#94a3b8">${esc(ts)}</span></td>
      <td class="user-cell" title="${esc(user)}">${esc(user)}</td>
      <td class="mono" style="color:#7dd3fc;font-size:11.5px">${esc(r.method||"?")}</td>
      <td class="path-cell" title="${esc(r.full_path||r.path||"/")}">${esc(r.full_path||r.path||"/")}</td>
      <td>${badge(st)}</td>
      <td class="mono ${dc}">${dur}ms</td>
    </tr>`;
    if(isE)h+=detailRow(r);
  });
  tb.innerHTML=h;
}
function badge(st){
  if(st>=500)return`<span class="badge b5">${st}</span>`;
  if(st>=400)return`<span class="badge b4">${st}</span>`;
  if(st>=200)return`<span class="badge b2">${st}</span>`;
  return`<span class="badge bx">${st||"?"}</span>`;
}
function detailRow(r){
  const hasBodies=r.req_body!=null||r.res_body!=null;
  let inner=`<div class="detail-inner${hasBodies?"":" single"}>`;
  if(r.req_body!=null)inner+=`<div><div class="detail-label">Request body</div><pre class="code">${synHL(r.req_body)}</pre></div>`;
  if(r.res_body!=null)inner+=`<div><div class="detail-label">Response body</div><pre class="code">${synHL(r.res_body)}</pre></div>`;
  if(!hasBodies)inner+=`<div><div class="detail-label">Bodies</div><pre class="code" style="color:#475569">— body logging disabled (DEBUG_LOG_BODIES not set) —</pre></div>`;
  inner+=`</div>`;
  if(r.stack_trace)inner+=`<div style="padding:0 20px 16px"><div class="detail-label">Stack trace</div><pre class="stack">${esc(r.stack_trace)}</pre></div>`;
  return`<tr class="detail-row"><td colspan="6">${inner}</td></tr>`;
}
function toggleRow(i){expandedId=(expandedId===i)?null:i;renderTable(currentRows);if(expandedId!==null){const el=document.getElementById("row-"+i);if(el)el.scrollIntoView({block:"nearest"});}}
function synHL(obj){
  let s;try{s=JSON.stringify(obj,null,2);}catch(e){return esc(String(obj));}
  s=s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return s.replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,m=>{
    let c="jn";
    if(/^"/.test(m)){if(/:$/.test(m))c="jk";else if(/"\[redacted\]"/.test(m))c="jr";else c="js";}
    else if(/true|false/.test(m))c="jb";else if(/null/.test(m))c="jl";
    return`<span class="${c}">${m}</span>`;
  });
}
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function exportCSV(){window.location.href="/api/admin/logs/export?"+buildParams({limit:500});}
</script>
</body>
</html>
"""
