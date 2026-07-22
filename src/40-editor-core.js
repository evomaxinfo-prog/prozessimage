  /* ================= Modellierungs-Editor (Schritt 3) ================= */

  const SYM = (window.PMX && window.PMX.SYM) || {};

const PROCESS_TYPES = (window.PMX && window.PMX.PROCESS_TYPES) || [];
const STATE_ICONS = (window.PMX && window.PMX.STATE_ICONS) || {};


  const PROCESS_META = { soft: '#EAF1F6', action: 'PROZESSTYP SETZEN', palette: PROCESS_TYPES.map((p) => [p.name, p.sym]) };
  function processTypeByName(name) { const base = String(name || '').replace(/_\d+$/, ''); return PROCESS_TYPES.find((p) => p.name === base) || null; }
  function processTypeBySym(sym) { return PROCESS_TYPES.find((p) => p.sym === sym) || null; }
  // Farb-Cluster der Prozess-Icons: teal (Aktiv), dunkel (Passiv/XML), weiß/Outline (SDE)
  const PT_DARK = { ptk_11: 1, ptk_12: 1, ptk_13: 1, ptk_14: 1, ptk_15: 1, ptk_16: 1, ptk_18: 1, ptk_19: 1, ptk_70: 1, ptk_99: 1 };
  const PT_WHITE = { ptk_90: 1, ptk_91: 1, ptk_92: 1, ptk_93: 1, ptk_94: 1, ptk_95: 1, ptk_96: 1 };
  function ptColorGroup(sym) { return PT_WHITE[sym] ? 's' : PT_DARK[sym] ? 'p' : 'a'; }
  const PT_COLOR_GROUPS = (window.PMX && window.PMX.PT_COLOR_GROUPS) || [];
  const ptStateGroups = window.PMX.ptStateGroups;
  function ptStateList(pt) {
    const out = [];
    ptStateGroups(pt).forEach((g) => {
      g.muss.forEach((n) => out.push({ group: g.group, kind: 'Pflicht', name: n }));
      g.opt.forEach((n) => out.push({ group: g.group, kind: 'Optional', name: n }));
    });
    return out;
  }

  const LAYER_META = (window.PMX && window.PMX.LAYER_META) || {};
  // Palette-Meta zur Ebene: exakter Name, sonst Prozesstyp-Katalog fuer 'Prozess...'-Ebenen, sonst Default
  function paletteMetaFor(L) {
    if (!L) return { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };
    if (LAYER_META[L.name]) return LAYER_META[L.name];
    if (/prozess/i.test(L.name || '')) return PROCESS_META;
    return { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };
  }

  function layerById(id) { return (state.detail.layers || []).find((l) => l.id === id) || null; }
  // Rollen-/Gruppen-Sichtbarkeit: Admins sehen immer alles; sonst null = alle, oder nur die Codes in der Liste
  function layerAllowed(code) { return !state.visibleLayers || state.visibleLayers.indexOf(code) >= 0; }
  function allowedLayers() { return (state.detail.layers || []).filter((l) => layerAllowed(l.code)); }
  // Sichtbarkeits-Map layerId -> bool (Auge-Zustand kombiniert mit Rollen-/Gruppensicht)
  function visibleMap() {
    const v = {};
    (state.detail.layers || []).forEach((l) => { v[l.id] = (l.visible !== false) && layerAllowed(l.code); });
    return v;
  }
  function objectsOfLayer(id) { return (state.detail.objects || []).filter((o) => o.layerId === id); }

  /* ---- Punkt-basierte Formen: Schutzbereich (geschlossen) + Materialfluss-Förderweg (offen) ---- */
  function isShape(o) { return o && (o.symbolType === 'sb_zone' || o.symbolType === 'sps_zone' || o.symbolType === 'fg_zone' || o.symbolType === 'mf_route' || o.symbolType === 'nh_zone'); }
  // Polygon-Art abhängig von der Ebene: "Funktionsgruppen" -> fg_zone, sonst Schutzbereich (sb_zone). Nach Namen, damit Umnummerieren nichts bricht.
  function zoneKind(layer) {
    if (state.drawShape === 'nhzone') return { type: 'nh_zone', prefix: 'Not-Halt-Grenze manuell', noun: 'Not-Halt-Grenze manuell', label: 'NOT-HALT' };
    if (state.drawShape === 'spszone') return { type: 'sps_zone', prefix: 'SPS-Bereich', noun: 'SPS-Bereich', label: 'SPS BEREICH' };
    if (layer && layer.name === 'Funktionsgruppen') return { type: 'fg_zone', prefix: 'Funktionsgruppe', noun: 'Funktionsgruppe', label: 'FG FUNKTIONSGRUPPE' };
    return { type: 'sb_zone', prefix: 'Schutzbereich', noun: 'Schutzbereich', label: 'SB SCHUTZBEREICH' };
  }
  // Label eines SPS-Bereichs = Name der zugeordneten SPS (1:1), sonst der Objektname.
  function spsZoneLabel(z) {
    if (z.plcConfigId) { const p = (state.detail.plcs || []).find((x) => x.id === z.plcConfigId); if (p) return p.name; }
    return z.name || 'SPS-Bereich';
  }
  // Name der einer Zone zugeordneten SPS (via plcConfigId), sonst ''.
  function plcNameOf(z) {
    if (!z || !z.plcConfigId) return '';
    const p = (state.detail.plcs || []).find((x) => x.id === z.plcConfigId);
    return p ? (p.name || '') : '';
  }

  const ROUTE_ARTS = (window.PMX && window.PMX.ROUTE_ARTS) || [];
  // Materialfluss-Typen mit fester Farbe (farbige Pfeile zur Auswahl unter Materialfluss)
  const FLOW_TYPES = (window.PMX && window.PMX.FLOW_TYPES) || [];
  function flowColor(name) { const f = FLOW_TYPES.find((t) => t.name === name); return f ? f.color : null; }
  function routeMaterial(o) { const m = (o.metatags || []).find((x) => x.label === 'Materialart'); return m ? m.value : ''; }
  // Legende der im Plan verwendeten Materialfluss-Typen (Farbcodierung), ein-/ausblendbar.
  function flowLegendHtml() {
    const used = {};
    (state.detail.objects || []).forEach((o) => {
      if (o.symbolType !== 'mf_route') return;
      const mat = routeMaterial(o);
      if (mat && flowColor(mat)) used[mat] = flowColor(mat);
    });
    const names = FLOW_TYPES.map((t) => t.name).filter((n) => used[n]);
    if (!names.length) return '';
    if (!state.flowLegend) return '<button class="flow-legend-btn" data-act="flow-legend" title="Materialfluss-Legende einblenden"><span class="fl-dots"></span>Legende</button>';
    const rows = names.map((n) => '<div class="fl-row"><span class="fl-dot" style="background:' + esc(used[n]) + '"></span>' + esc(n) + '</div>').join('');
    return '<div class="flow-legend"><div class="fl-head">Materialfluss<button data-act="flow-legend" title="Legende ausblenden">×</button></div>' + rows + '</div>';
  }
  const ROUTE_DASH = { 'Rollenbahn': '', 'Kettenförderer': '2.4 1.6', 'Band-/Gurtförderer': '', 'Hängeförderer': '4 2', 'FTS / AGV': '0.1 2.6', 'Stapler / manuell': '5 2 1 2', 'Manueller Transport': '5 2 1 2' };
  function routeArt(o) { const m = (o.metatags || []).find((x) => x.label === 'Förderart'); return m ? m.value : ''; }

  function docAspect() {
    if (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h) return state.layoutDim.w / state.layoutDim.h;
    return 760 / 520;
  }
  // Abstand Punkt→Strecke in seitenverhältnis-korrigiertem Raum (x mit ar skaliert → isotrop)
  const distToSegAR = window.PMX.distToSegAR;
  function pointNearRoute(o, x, y) {
    const p = o.points; if (!p || p.length < 2) return false;
    const ar = docAspect();
    for (let i = 0; i < p.length - 1; i++) { if (distToSegAR(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, ar) < 0.028) return true; }
    return false;
  }
  // Gefüllter Pfeilkopf am Streckenende; isotrop trotz preserveAspectRatio="none"
  // Weiche Kurve durch die Stützpunkte (Catmull-Rom → kubische Bézier). Liefert d-Pfad (viewBox 0..100)
  // und die Endtangente (normalisierte Richtung) für die Pfeil-Ausrichtung.
  const buildRouteCurve = window.PMX.buildRouteCurve;
  // Gefüllter Pfeilkopf am Endpunkt, ausgerichtet an einer (normalisierten) Tangente; isotrop trotz preserveAspectRatio="none".
  function routeArrowFromTan(tip, tanVb, ar) {
    let sdx = tanVb.x * ar, sdy = tanVb.y;
    const len = Math.hypot(sdx, sdy) || 1e-6; sdx /= len; sdy /= len;
    const back = { x: -sdx, y: -sdy }, L = 1.8, ang = Math.PI * 0.15;
    const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
    const w1 = rot(back, ang), w2 = rot(back, -ang);
    const tvx = tip.x * 100, tvy = tip.y * 100;
    const p1x = tvx + w1.x * L / ar, p1y = tvy + w1.y * L;
    const p2x = tvx + w2.x * L / ar, p2y = tvy + w2.y * L;
    return 'M' + p1x + ' ' + p1y + ' L' + tvx + ' ' + tvy + ' L' + p2x + ' ' + p2y + ' Z';
  }

  async function openEditor() {
    state.view = 'editor';
    state.undoStack = []; state.redoStack = [];
    if (!state.activeLayer || !layerAllowed((layerById(state.activeLayer) || {}).code)) {
      const al = allowedLayers(); if (al[0]) state.activeLayer = al[0].id;
    }
    if (state.sat == null) state.sat = 100;
    if (state.zoom == null) state.zoom = 1;
    await ensureLayoutBlob();
    await loadCustomSyms((currentWerk() || {}).id);
    renderEditor();
    startCollab();
  }
  function leaveEditor() {
    state.view = 'detail';
    $('content').style.padding = '';
    stopCollab();
    renderDetail();
  }

