  function zoneHandleLayer() {
    if (state.drawZone || !state.selectedZone) return '';
    const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone && isShape(o) && o.points);
    if (!z) return '';
    const isRoute = z.symbolType === 'mf_route';
    const n = z.points.length;
    const verts = z.points.map((p, i) =>
      '<div class="zone-vertex" data-zone="' + z.id + '" data-vidx="' + i + '" title="Ziehen · Rechtsklick entfernt" style="left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%"></div>').join('');
    const edgeCount = isRoute ? n - 1 : n;
    let mids = '';
    for (let i = 0; i < edgeCount; i++) {
      const p = z.points[i], q = z.points[(i + 1) % n];
      mids += '<div class="zone-midpoint" data-zone="' + z.id + '" data-eidx="' + i + '" title="Stützpunkt einfügen" style="left:' + ((p.x + q.x) / 2 * 100) + '%;top:' + ((p.y + q.y) / 2 * 100) + '%">+</div>';
    }
    const m = polyMetrics(z.points);
    const measure = m ? '<div class="zone-measure" style="left:' + (m.minx * 100) + '%;top:' + (m.miny * 100) + '%">' + fmtMetrics(m, !isRoute) + '</div>' : '';
    return '<div class="zone-handle-layer">' + mids + verts + measure + '</div>';
  }

  const TECH_CODE = {
    'Punkt Schweißen - Stahl': 'PS', 'MIG-Schweißen': 'SM', 'Bolzen-Schweißen': 'BS',
    'Bolzen-Schweißen (Rotationskopf)': 'BR', 'Bolzen (stationär)': 'B', 'Kleben': 'KL',
    'Laser': 'LA', 'Halbholstanznieten': 'HN', 'Fließlochschrauben': 'FS', 'Inline messen': 'IM',
  };
  function techCode(name) {
    if (TECH_CODE[name]) return TECH_CODE[name];
    const w = String(name).replace(/[^A-Za-zÄÖÜäöüß ]/g, '').split(/\s+/).filter(Boolean);
    return w.map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '•';
  }
  // Grafische Symbole je Technologie (weiss auf orangem Punkt). Unbekannte -> Buchstabencode als Fallback.
  const TECH_ICON = {
    'Punkt Schweißen - Stahl': '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M6.1 6.1l1.9 1.9M16 16l1.9 1.9M17.9 6.1 16 8M8 16l-1.9 1.9"/>',
    'MIG-Schweißen': '<path d="M13 2.5 6 13h4.2l-2.2 8.5L18 10h-5z" fill="currentColor" stroke="none"/>',
    'Bolzen-Schweißen': '<path d="M6.5 5h11M12 5v9"/><path d="M9 14h6l-3 5z" fill="currentColor" stroke="none"/>',
    'Bolzen-Schweißen (Rotationskopf)': '<path d="M6.5 9h11M12 9v6"/><path d="M9.5 15h5l-2.5 4z" fill="currentColor" stroke="none"/><path d="M15.2 3.1a4.2 4.2 0 0 1 2.6 3.9"/><path d="M13.8 3.3 15.4 2.7 16.1 4.3"/>',
    'Bolzen (stationär)': '<path d="M6.5 5h11M12 5v8"/><path d="M9 13h6l-3 5z" fill="currentColor" stroke="none"/><path d="M4.5 21h15"/>',
    'Kleben': '<path d="M12 3.4c3.2 4.9 5 7.1 5 10.1a5 5 0 0 1-10 0c0-3 1.8-5.2 5-10.1z" fill="currentColor" stroke="none"/>',
    'Laser': '<path d="M12 2v9" stroke-width="2.4"/><circle cx="12" cy="14.6" r="2" fill="currentColor" stroke="none"/><path d="M12 17.6v3.4M7.4 15.4 5.4 17.9M16.6 15.4 18.6 17.9" stroke-width="1.6"/>',
    'Halbholstanznieten': '<path d="M5.5 6h13l-2.4 4H7.9z" fill="currentColor" stroke="none"/><path d="M9 10v6l3 3 3-3v-6"/>',
    'Fließlochschrauben': '<path d="M9 3.5h6M12 3.5V7"/><path d="M8 8h8M8.7 11.2h6.6M9.6 14.4h4.8"/><path d="M10.6 16.8 12 20.5l1.4-3.7z" fill="currentColor" stroke="none"/>',
    'Inline messen': '<rect x="3.5" y="8" width="17" height="8" rx="1"/><path d="M7 8v3.4M11 8v4.6M15 8v3.4M19 8v3.4" stroke-width="1.5"/>',
  };
  function techIconSvg(name) {
    const inner = TECH_ICON[name];
    if (!inner) return esc(techCode(name));
    return '<svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  function techInfo(o) {
    if (o.symbolType !== 'robot') return null;
    const m = (o.metatags || []).find((t) => t.position === 2 && t.value);
    if (!m || !m.value) return null;
    let bx, by;
    if (o.points && o.points.length >= 1 && o.points[0]) { bx = o.points[0].x; by = o.points[0].y; }
    else { bx = Math.min(o.x + 0.12, 0.94); by = Math.max(o.y - 0.12, 0.07); }
    return { id: o.id, name: m.value, code: techCode(m.value), col: objIconColor(o), rx: o.x, ry: o.y, bx, by };
  }
  // Abstand vom Zentrum bis zur abgerundeten Rechteck-Umrandung entlang (ux,uy) (alles in Pixeln).
  const rayRoundedRectDist = window.PMX.rayRoundedRectDist;
  // Endpunkte der Technologie-Linie: 2px ausserhalb der sichtbaren Umrandung -
  // Roboter-Kasten (38px inkl. Rahmen, abgerundet r=9) und Tech-Icon-Kreis (Radius 13px).
  function techLineEnds(rx, ry, bx, by) {
    const doc = document.getElementById('canvasDoc');
    const W = (doc && doc.clientWidth) || 900, H = (doc && doc.clientHeight) || 560;
    const dxPx = (bx - rx) * W, dyPx = (by - ry) * H;
    const len = Math.hypot(dxPx, dyPx);
    let x1 = rx * 100, y1 = ry * 100, x2 = bx * 100, y2 = by * 100;
    if (len > 1) {
      const ux = dxPx / len, uy = dyPx / len;
      const tR = rayRoundedRectDist(ux, uy, 19, 19, 9) + 2; // Kasten-Umrandung + 2px
      const tB = 13 + 2; // Icon-Kreisrand + 2px
      if (len > tR + tB + 1) {
        x1 += (ux * tR) / W * 100; y1 += (uy * tR) / H * 100;
        x2 -= (ux * tB) / W * 100; y2 -= (uy * tB) / H * 100;
      }
    }
    return { x1, y1, x2, y2 };
  }
  function techLinesSvg(visible) {
    return (state.detail.objects || []).map((o) => {
      if (visible[o.layerId] === false) return '';
      const t = techInfo(o); if (!t) return '';
      const e = techLineEnds(t.rx, t.ry, t.bx, t.by);
      return '<line id="tech-line-' + t.id + '" x1="' + e.x1.toFixed(3) + '" y1="' + e.y1.toFixed(3) + '" x2="' + e.x2.toFixed(3) + '" y2="' + e.y2.toFixed(3) + '" stroke="' + esc(t.col) + '" stroke-width="1.3" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
    }).join('');
  }
  function techBadgeLayer() {
    const visible = visibleMap();
    const editable = canEdit();
    const badges = (state.detail.objects || []).map((o) => {
      if (visible[o.layerId] === false) return '';
      const t = techInfo(o); if (!t) return '';
      return '<div class="tech-badge" data-tech="' + t.id + '" style="left:' + (t.bx * 100) + '%;top:' + (t.by * 100) + '%">'
        + '<span class="tb-dot" style="background:' + esc(t.col) + ';box-shadow:0 2px 7px rgba(30,42,51,.35)"' + (editable ? ' data-techdrag="' + t.id + '" title="Verschieben"' : '') + '>' + techIconSvg(t.name) + '</span>'
        + '<span class="tb-name">' + esc(t.name) + '</span></div>';
    }).join('');
    return '<div class="tech-badge-layer">' + badges + '</div>';
  }
  function onTechDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    let x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    if (state.snapGrid) { x = clamp01(snapToGrid(x)); y = clamp01(snapToGrid(y)); }
    const o = (state.detail.objects || []).find((z) => z.id === state.techDrag.id); if (!o) return;
    o.points = [{ x, y }]; state.techDrag.moved = true; state.techDrag.fx = x; state.techDrag.fy = y; protectObj(o.id);
    const line = document.getElementById('tech-line-' + o.id);
    if (line) { const e = techLineEnds(o.x, o.y, x, y); line.setAttribute('x1', e.x1.toFixed(3)); line.setAttribute('y1', e.y1.toFixed(3)); line.setAttribute('x2', e.x2.toFixed(3)); line.setAttribute('y2', e.y2.toFixed(3)); }
    const badge = document.querySelector('.tech-badge[data-tech="' + o.id + '"]');
    if (badge) { badge.style.left = (x * 100) + '%'; badge.style.top = (y * 100) + '%'; }
  }

  // Schnelle Deselektion ohne Voll-Render: entfernt nur die Auswahl-Hervorhebung (Objekte + Resize-Griffe + Objektliste).
  // Ist eine Zone selektiert, wird sicherheitshalber voll gerendert (Zonen-Styling/Handles brauchen den Voll-Render).
  function deselectFast() {
    if (state.selectedZone) {
      state.selectedObj = null; state.selectedZone = null; state.selObjs = [];
      renderEditor(); return;
    }
    const had = state.selectedObj || (state.selObjs && state.selObjs.length);
    state.selectedObj = null; state.selObjs = [];
    if (!had) return;
    const doc = document.getElementById('canvasDoc');
    if (doc) {
      doc.querySelectorAll('.placed.sel').forEach((el) => el.classList.remove('sel'));
      doc.querySelectorAll('.sel-resize').forEach((el) => el.remove());
    }
    const cont = document.getElementById('content');
    if (cont) cont.querySelectorAll('.obj.sel').forEach((el) => el.classList.remove('sel'));
  }
  // renderEditor delegiert an renderEditorImpl (stabiler Einstiegspunkt; frueherer ?perf=1-Timing-Wrapper wurde entfernt).
