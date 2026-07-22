/* ProModXgOEM2 – ausgelagerte reine Hilfsfunktionen (Modularisierung D3) */
(function () {
  'use strict';
  window.PMX = window.PMX || {};
  window.PMX.lcoInitials = function lcoInitials(who) {
    const local = String(who || '?').split('@')[0];
    const parts = local.split(/[._\-\s]+/).filter(Boolean);
    const ini = parts.length >= 2 ? (parts[0][0] + parts[1][0]) : local.slice(0, 2);
    return (ini || '?').toUpperCase();
  }

  window.PMX.distToSegAR = function distToSegAR(px, py, ax, ay, bx, by, ar) {
    px *= ar; ax *= ar; bx *= ar;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  window.PMX.buildRouteCurve = function buildRouteCurve(pts) {
    const n = pts.length;
    if (n < 2) return { d: n ? 'M' + (pts[0].x * 100) + ' ' + (pts[0].y * 100) : '', tan: { x: 1, y: 0 } };
    const P = pts.map((p) => ({ x: p.x * 100, y: p.y * 100 }));
    let d = 'M' + P[0].x + ' ' + P[0].y;
    let lastC2 = P[0];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + p2.x + ' ' + p2.y;
      lastC2 = { x: c2x, y: c2y };
    }
    const end = P[n - 1];
    return { d, tan: { x: (end.x - lastC2.x) / 100, y: (end.y - lastC2.y) / 100 } };
  }

  window.PMX.pointsMatch = function pointsMatch(a, b) {
    a = a || []; b = b || [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs((a[i].x || 0) - (b[i].x || 0)) > 0.001 || Math.abs((a[i].y || 0) - (b[i].y || 0)) > 0.001) return false;
    }
    return true;
  }

  window.PMX.personInitials = function personInitials(label) {
    const base = String(label).split('@')[0];
    const parts = base.split(/[.\-_\s]+/).filter(Boolean).slice(0, 2);
    return parts.map((s) => s[0].toUpperCase()).join('') || 'U';
  }

  window.PMX.roundedPolyPath = function roundedPolyPath(pts, r) {
    const n = pts.length;
    if (n < 3) return pts.length ? 'M' + pts.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join('L') + 'Z' : '';
    let d = '';
    for (let i = 0; i < n; i++) {
      const cur = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = cur.x + (v1x / l1) * rr, ay = cur.y + (v1y / l1) * rr;
      const bx = cur.x + (v2x / l2) * rr, by = cur.y + (v2y / l2) * rr;
      d += (i === 0 ? 'M' : 'L') + ax.toFixed(2) + ',' + ay.toFixed(2)
        + 'Q' + cur.x.toFixed(2) + ',' + cur.y.toFixed(2) + ' ' + bx.toFixed(2) + ',' + by.toFixed(2);
    }
    return d + 'Z';
  }

  window.PMX.rayRoundedRectDist = function rayRoundedRectDist(ux, uy, hx, hy, rc) {
    const ax = Math.abs(ux), ay = Math.abs(uy);
    const tx = ax > 1e-6 ? hx / ax : Infinity;
    const ty = ay > 1e-6 ? hy / ay : Infinity;
    let t = Math.min(tx, ty);
    const px = ux * t, py = uy * t;
    if (Math.abs(px) > hx - rc && Math.abs(py) > hy - rc) { // Eckbereich -> gegen Eckkreis schneiden
      const cx = Math.sign(px) * (hx - rc), cy = Math.sign(py) * (hy - rc);
      const dot = ux * cx + uy * cy;
      const disc = dot * dot - (cx * cx + cy * cy - rc * rc);
      if (disc >= 0) { const tc = dot + Math.sqrt(disc); if (tc > 0) t = tc; }
    }
    return t;
  }

  window.PMX.zoneCentroid = function zoneCentroid(z) { const n = z.points.length; return { x: z.points.reduce((s, p) => s + p.x, 0) / n, y: z.points.reduce((s, p) => s + p.y, 0) / n }; }

  window.PMX.polyMetrics = function polyMetrics(pts) {
    if (!pts || pts.length < 2) return null;
    let minx = 1, miny = 1, maxx = 0, maxy = 0, a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      a += p.x * q.y - q.x * p.y;
    }
    return { w: maxx - minx, h: maxy - miny, area: Math.abs(a) / 2, minx: minx, miny: miny, maxx: maxx, maxy: maxy };
  }

  window.PMX.pointInZone = function pointInZone(z, x, y) {
    const p = z.points; if (!p || p.length < 3) return false;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
      const denom = (yj - yi) || 1e-9;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / denom + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

})();