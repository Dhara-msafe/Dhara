# Shared init script for Silent Alert web tests: captures window.open / alert / location changes
INIT_JS = """
window.__opens = []; window.__alerts = [];
const _o = window.open; window.open = function(u, t, f){ window.__opens.push(String(u)); console.log('WINDOW_OPEN:' + u); return null; };
window.alert = function(m){ window.__alerts.push(String(m)); console.log('WINDOW_ALERT:' + String(m).slice(0,200)); };
"""
