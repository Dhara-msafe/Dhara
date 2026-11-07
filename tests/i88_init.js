(() => {
  window.__geo = { get: 0, watch: 0, clear: 0, active: 0, permQuery: 0 };
  const g = navigator.geolocation;
  if (g) {
    const og = g.getCurrentPosition.bind(g), ow = g.watchPosition.bind(g), oc = g.clearWatch.bind(g);
    g.getCurrentPosition = (...a) => { window.__geo.get++; return og(...a); };
    g.watchPosition = (...a) => { window.__geo.watch++; window.__geo.active++; return ow(...a); };
    g.clearWatch = (id) => { window.__geo.clear++; window.__geo.active--; return oc(id); };
  }
  if (navigator.permissions && navigator.permissions.query) {
    const oq = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => { window.__geo.permQuery++; return oq(d); };
  }
  window.__gm = { circles: new Set(), markers: new Set(), maps: new Set() };
  const iv = setInterval(() => {
    const gm = window.google && window.google.maps;
    if (!gm || !gm.MVCObject || !gm.Circle) return;
    clearInterval(iv);
    const os = gm.MVCObject.prototype.set;
    gm.MVCObject.prototype.set = function (k, v) {
      try {
        if (this instanceof gm.Circle) window.__gm.circles.add(this);
        else if (this instanceof gm.Marker) window.__gm.markers.add(this);
        else if (this instanceof gm.Map) window.__gm.maps.add(this);
      } catch (e) {}
      return os.apply(this, arguments);
    };
  }, 20);
  window.__gmState = () => {
    const ll = (p) => p ? [Number(p.lat().toFixed(5)), Number(p.lng().toFixed(5))] : null;
    const circles = [...window.__gm.circles].filter(c => c.getMap()).map(c => ({ c: ll(c.getCenter()), r: Math.round(c.getRadius()), fill: c.get('fillColor'), op: c.get('fillOpacity') }));
    const markers = [...window.__gm.markers].filter(m => m.getMap()).map(m => ll(m.getPosition()));
    const maps = [...window.__gm.maps].map(m => ll(m.getCenter()));
    return { circles, markers, maps };
  };
})();
