  function protectObj(id) { if (id) state.collab.protect[String(id)] = Date.now() + 6000; }
  // Vergleicht zwei Punktlisten mit Toleranz (Server rundet ggf. Floats).
  const pointsMatch = window.PMX.pointsMatch;
  const shapeVisualKey = window.PMX.shapeVisualKey;
  function flashShape(id) {
    const el = document.getElementById('zone-poly-' + id); if (!el) return;
    el.classList.remove('mf-flash'); void el.getBBox; el.classList.add('mf-flash');
    setTimeout(() => { const e = document.getElementById('zone-poly-' + id); if (e) e.classList.remove('mf-flash'); }, 900);
  }
  // Hat sich ein Objekt in einer sichtbaren/relevanten Eigenschaft geändert?
  function objChanged(a, b) {
    if (a.name !== b.name || a.color !== b.color || a.symbolType !== b.symbolType || a.layerId !== b.layerId
      || a.x !== b.x || a.y !== b.y || (a.rotation || 0) !== (b.rotation || 0) || (a.scale || 1) !== (b.scale || 1)
      || (a.plcConfigId || '') !== (b.plcConfigId || '') || !!a.visible !== !!b.visible) return true;
    if (JSON.stringify(a.points || null) !== JSON.stringify(b.points || null)) return true;
    if (JSON.stringify(a.metatags || []) !== JSON.stringify(b.metatags || [])) return true;
    return false;
  }
  function personLabel(v) { return v.name || v.email || ''; }
  const personInitials = window.PMX.personInitials;
  function firstName(label) { return String(label).split('@')[0].split(/[.\-_\s]+/).filter(Boolean)[0] || String(label); }
  function capFirst(s) { s = String(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function presenceHtml() {
    const st = state.collab.status;
    let status;
    if (st === 'offline') status = '<span class="collab-status off">● offline</span>';
    else if (st === 'live') status = '<span class="collab-status on">● live</span>';
    else status = '<span class="collab-status">● …</span>';

    const me = state.user && state.user.email;
    const all = state.collab.viewers || [];
    const others = all.filter((v) => v.email && v.email !== me);

    let trigger = '<div class="collab-trigger" data-act="collab-details" title="Klicken: wer ist gerade hier?">' + status;
    if (others.length) {
      const dots = others.slice(0, 5).map((v) => {
        const label = personLabel(v);
        return '<span class="collab-dot' + (v.editing ? ' editing' : '') + '" title="' + esc(label) + '">' + esc(personInitials(label)) + '</span>';
      }).join('');
      const more = others.length > 5 ? '<span class="collab-more">+' + (others.length - 5) + '</span>' : '';
      const editors = others.filter((v) => v.editing).map((v) => esc(capFirst(firstName(personLabel(v)))));
      const cap = editors.length
        ? '<span class="collab-cap">' + editors.join(', ') + (editors.length === 1 ? ' bearbeitet gerade' : ' bearbeiten gerade') + '</span>'
        : '<span class="collab-cap muted">' + others.length + (others.length === 1 ? ' Person' : ' Personen') + ' hier</span>';
      trigger += '<div class="collab-dots">' + dots + more + '</div>' + cap;
    }
    trigger += '</div>';

    let pop = '';
    if (state.collab.detailsOpen) {
      let rows;
      if (all.length) {
        rows = all.map((v) => {
          const mine = v.email === me;
          const tag = mine ? ' <span class="cp-you">(du)</span>' : '';
          const ed = v.editing ? ' <span class="cp-edit">bearbeitet</span>' : '';
          return '<div class="cp-row">' + esc(personLabel(v) || '(ohne E-Mail)') + tag + ed + '</div>';
        }).join('');
      } else {
        rows = '<div class="cp-row muted">Server meldet niemanden.</div>';
      }
      let hint = '';
      if (st === 'offline') hint = '<div class="cp-hint">Server nicht erreichbar – Backend-Deploy/Migration prüfen.</div>';
      else if (all.length <= 1) hint = '<div class="cp-hint">Nur du bist erfasst. Die andere Person muss eingeloggt sein und dieselbe Anlage im MODELLIEREN-Fenster offen haben.</div>';
      // Diagnose: was liegt aktuell wirklich im Editor + letzter Server-Sync
      const objs = state.detail.objects || [];
      const nSb = objs.filter((o) => o.symbolType === 'sb_zone').length;
      const nFg = objs.filter((o) => o.symbolType === 'fg_zone').length;
      const nMf = objs.filter((o) => o.symbolType === 'mf_route').length;
      const nSym = objs.filter((o) => !isShape(o)).length;
      const ls = state.collab.lastSync;
      const diag = '<div class="cp-hint">Im Editor: <b>' + nSb + '</b> Schutzbereiche · ' + nFg + ' Funktionsgruppen · ' + nMf + ' Förderwege · ' + nSym + ' Symbole'
        + (ls ? ('<br>Letzter Server-Sync: ' + ls.n + ' geändert, ' + ls.del + ' gelöscht') : '') + '</div>';
      pop = '<div class="collab-pop"><div class="cp-head">Anwesend laut Server (' + all.length + ')</div>' + rows + hint + diag + '</div>';
    }
    return '<div class="collab-bar">' + trigger + pop + '</div>';
  }
  function renderPresenceOnly() {
    const bar = document.getElementById('collabBar');
    if (bar) bar.innerHTML = presenceHtml();
  }

  async function ensureLayoutBlob() {
    const sid = state.detail && state.detail.id;
    if (state.layoutBlobUrl && state.layoutBlobStation === sid && state.detail.hasLayout) return;
    if (state.layoutBlobUrl) { URL.revokeObjectURL(state.layoutBlobUrl); state.layoutBlobUrl = null; state.layoutBlobStation = null; state.layoutDim = null; }
    if (state.detail && state.detail.hasLayout) {
      try {
        const res = await Api.raw('/stations/' + sid + '/layout');
        if (res.ok) {
          state.layoutBlobUrl = URL.createObjectURL(await res.blob());
          state.layoutBlobStation = sid;
          state.layoutDim = await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => resolve(null);
            im.src = state.layoutBlobUrl;
          });
        }
      } catch (e) { /* ignore */ }
    }
  }

  function editorFloorplan() {
    const op = (state.sat || 100) / 100;
    const bg = state.layoutBlobUrl
      ? '<img class="floor-bg floor-photo" draggable="false" src="' + state.layoutBlobUrl + '" alt="Anlagenlayout" style="opacity:' + op + ';object-fit:fill">'
      : '<svg class="floor-bg floor-schema" viewBox="0 0 760 520" preserveAspectRatio="xMidYMid meet" style="opacity:' + op + '" xmlns="http://www.w3.org/2000/svg">'
        + '<defs><pattern id="bp" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#D3DEE6" stroke-width="1"/></pattern>'
        + '<pattern id="bp2" width="130" height="130" patternUnits="userSpaceOnUse"><path d="M130 0H0V130" fill="none" stroke="#B9C7D1" stroke-width="1.3"/></pattern></defs>'
        + '<rect width="760" height="520" fill="#F7FAFC"/><rect width="760" height="520" fill="url(#bp)"/><rect width="760" height="520" fill="url(#bp2)"/>'
        + '<rect x="40" y="40" width="680" height="440" fill="none" stroke="#8FA3B0" stroke-width="2.5"/></svg>';
    const badge = state.layoutBlobUrl ? '<div class="layout-badge">' + t('eigenes Layout') + '</div>' : '<div class="layout-badge muted">' + t('Schema-Layout') + '</div>';

    const visible = visibleMap();
    const placed = (state.detail.objects || []).filter((o) => !isShape(o) && visible[o.layerId] !== false).map((o) => {
      const isProc = /^ptk_/.test(o.symbolType);
      const isRobot = o.symbolType === 'robot';
      const fgm = isProc ? (o.metatags || []).find((m) => m.label === 'Funktionsgruppen' && m.value && String(m.value).trim()) : null;
      const fgAssigned = !!fgm;
      const rSf = isRobot ? (o.metatags || []).find((m) => m.label === 'Safe Funktion' && m.value && String(m.value).trim()) : null;
      const rTc = isRobot ? (o.metatags || []).find((m) => m.label === 'Technologie' && m.value && String(m.value).trim()) : null;
      const robotIncomplete = isRobot && (!rSf || !rTc);
      // Prozesstyp: nur FG-Verknuepfung als Chip. Roboter: nur den Metatag "Safe Funktion". Sonstige Objekte: alle Metatags.
      let chipsHtml;
      if (isProc) {
        chipsHtml = fgm ? '<span class="ptag fg-chip"><span class="fg-k">FG</span>' + esc(String(fgm.value).trim()) + '</span>' : '';
      } else if (isRobot) {
        chipsHtml = rSf ? '<span class="ptag">' + esc(String(rSf.value).trim()) + '</span>' : '';
      } else {
        chipsHtml = (o.metatags || []).map((m) => m.value).filter(Boolean).map((t) => '<span class="ptag">' + esc(t) + '</span>').join('');
      }
      return '<div class="placed' + (fgAssigned ? ' fg-assigned' : '') + ' hover-tags' + (isSelObj(o.id) ? ' sel' : '') + '" data-obj="' + o.id + '" style="left:' + (o.x * 100) + '%;top:' + (o.y * 100) + '%;color:' + esc(objIconColor(o)) + ';--osc:' + (o.scale || 1) + '"'
        + ' title="' + esc(o.name) + ' — ziehen zum Verschieben · Doppelklick für Metatags">'
        + '<span class="p-sym">' + symInner(o.symbolType, 26) + '</span>'
        + (robotIncomplete ? '<span class="obj-warn" title="Safe Funktion und Technologie sind Pflicht">!</span>' : '')
        + (chipsHtml ? '<div class="ptags">' + chipsHtml + '</div>' : '')
        + '</div>';
    }).join('');

    // Zeichenfläche übernimmt das Seitenverhältnis des Layoutbilds -> Symbole sitzen passgenau
    const docStyle = (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h)
      ? ' style="aspect-ratio:' + state.layoutDim.w + '/' + state.layoutDim.h + ';max-width:960px"' : '';

    return '<div class="canvas-doc ' + (state.drawZone ? 'drawing' : '') + '" id="canvasDoc"' + docStyle + '>'
      + bg + (state.snapGrid && !state.drawZone ? '<div class="snap-grid"></div>' : '') + (state.drawZone ? '<div class="draw-grid"></div><div class="draw-measure" id="draw-measure"></div>' : '') + zoneOverlaySvg(visible) + '<div class="placed-layer">' + placed + '</div>' + fgLabelLayer(visible) + stateIconLayer(visible) + techBadgeLayer() + robotSuggestionLayer() + learnPromptLayer() + commentPinLayer() + commentWindowLayer() + zoneHandleLayer() + selResizeLayer() + badge + '</div>';
  }

  // Frei platzierbare Zustands-Icons mit Verbindungslinie zum Prozesstyp
  function iconPosMap(o) {
    const m = (o.metatags || []).find((x) => x.label === 'Icon-Positionen');
    if (m && m.value) { try { return JSON.parse(m.value) || {}; } catch (e) { return {}; } }
    return {};
  }
  function describedStateIcons(o) {
    const pos = iconPosMap(o); const out = []; let i = 0;
    (o.metatags || []).filter((m) => (m.position || 0) >= 3 && m.value && String(m.value).trim() && m.label !== 'Icon-Positionen')
      .forEach((m) => {
        const nm = String(m.label || '').replace(/^(Pflicht|Optional) – /, '');
        if (!STATE_ICONS[nm]) return;
        const dp = pos[nm];
        const x = dp ? clamp01(dp.x) : clamp01(o.x + 0.07 + (i % 3) * 0.055);
        const y = dp ? clamp01(dp.y) : clamp01(o.y - 0.10 + Math.floor(i / 3) * 0.055);
        out.push({ name: nm, desc: m.value, x, y }); i++;
      });
    return out;
  }
  function stateIconLayer(visible) {
    const objs = (state.detail.objects || []).filter((o) => /^ptk_/.test(o.symbolType) && visible[o.layerId] !== false);
    const lines = []; const icons = [];
    objs.forEach((o) => {
      describedStateIcons(o).forEach((it) => {
        const key = o.id + '__' + it.name;
        lines.push('<line data-sline="' + esc(key) + '" x1="' + (o.x * 100) + '" y1="' + (o.y * 100) + '" x2="' + (it.x * 100) + '" y2="' + (it.y * 100) + '"/>');
        icons.push('<div class="state-icon" data-sicon-parent="' + o.id + '" data-sicon-state="' + esc(it.name) + '" style="left:' + (it.x * 100) + '%;top:' + (it.y * 100) + '%" title="' + esc(it.name + ': ' + it.desc) + '"><img src="' + STATE_ICONS[it.name] + '" alt=""></div>');
      });
    });
    if (!icons.length) return '';
    return '<svg class="state-link-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + lines.join('') + '</svg>' + icons.join('');
  }

  // Metatags einer Funktionsgruppe/eines Schutzbereichs dauerhaft mittig im Polygon anzeigen (HTML-Overlay, damit kein Verzerren)
  function fgLabelLayer(visible) {
    const zones = (state.detail.objects || []).filter((o) => (o.symbolType === 'fg_zone' || o.symbolType === 'sb_zone' || o.symbolType === 'sps_zone' || o.symbolType === 'nh_zone') && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    if (!zones.length) return '';
    return '<div class="fg-label-layer">' + zones.map((z) => {
      let cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
      let cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
      if (z.symbolType === 'nh_zone') { let ti = 0; z.points.forEach((p, i) => { if (p.y < z.points[ti].y) ti = i; }); cx = z.points[ti].x; cy = z.points[ti].y; }
      const tags = (z.metatags || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map((m) => m.value).filter((v) => v !== null && v !== '');
      const lines = z.symbolType === 'nh_zone' ? ['NOT-HALT'] : (z.symbolType === 'sps_zone' ? [spsZoneLabel(z)] : (tags.length ? tags : [z.name]));
      const abbrev = (t) => (z.symbolType === 'sb_zone' ? String(t).replace(/Schutzbereich/g, 'SB') : t);
      // SPS-Zuordnung als zusaetzlichen Meta-Tag anzeigen (Funktionsgruppe + Schutzbereich)
      const spsNm = (z.symbolType === 'fg_zone' || z.symbolType === 'sb_zone') ? plcNameOf(z) : '';
      const inner = lines.map((t) => '<div class="fgl-line">' + esc(abbrev(t)) + '</div>').join('')
        + (spsNm ? '<div class="fgl-line fgl-sps"><span class="fgl-sps-k">SPS</span>' + esc(spsNm) + '</div>' : '');
      return '<div class="fg-label" data-zone="' + z.id + '" style="left:' + (cx * 100) + '%;top:' + (cy * 100) + '%;color:' + esc(zoneColor(z)) + '">' + inner + '</div>';
    }).join('') + '</div>';
  }

  // Polygon mit leicht abgerundeten Ecken als SVG-Pfad (Punkte im 0..100-Raum). r = Rundungsradius.
  const roundedPolyPath = window.PMX.roundedPolyPath;
  // Kleine Blitze entlang der SB-Grenze (statt Pfeilen). Aspektkorrigiert, in Zonenfarbe.
  const sbBoltPath = window.PMX.sbBoltPath;
  function zoneOverlaySvg(visible) {
    const zones = (state.detail.objects || []).filter((o) => (o.symbolType === 'sb_zone' || o.symbolType === 'sps_zone' || o.symbolType === 'fg_zone' || o.symbolType === 'nh_zone') && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
    const hlFg = highlightedFgZoneId();
    const hlSps = highlightedSpsZoneId();
    const ar = docAspect();
    const polys = zones.map((z) => {
      const sel = state.selectedZone === z.id;
      const hl = z.id === hlFg || z.id === hlSps;
      const hlCol = z.id === hlSps ? '#0065A5' : '#16A34A';
      const col = hl ? hlCol : esc(zoneColor(z));
      const sw = hl ? 3.4 : (sel ? 2.6 : (z.symbolType === 'nh_zone' ? 2.4 : 1.6));
      const fo = hl ? '0.22' : (sel ? '0.2' : '0.13');
      const dPath = roundedPolyPath(z.points.map((p) => ({ x: p.x * 100, y: p.y * 100 })), 1.5);
      const dash = z.symbolType === 'sb_zone' ? 'stroke-dasharray="6 4" ' : (z.symbolType === 'fg_zone' ? 'stroke-dasharray="1.5 4" stroke-linecap="round" ' : (z.symbolType === 'nh_zone' ? 'stroke-dasharray="0.1 4.5" stroke-linecap="round" ' : ''));
      const marks = z.symbolType === 'sb_zone' ? ('<path id="sb-bolts-' + z.id + '" d="' + sbBoltPath(z, ar) + '" fill="' + col + '" fill-opacity="0.5" stroke="none" style="pointer-events:none"/>') : '';
      return '<path id="zone-poly-' + z.id + '" d="' + dPath + '" fill="' + col + '" fill-opacity="' + fo + '" stroke="' + col + '" stroke-width="' + sw + '" ' + (hl ? 'class="fg-hl" ' : '') + dash + 'vector-effect="non-scaling-stroke" style="pointer-events:none" />' + marks;
    }).join('');
    const routes = (state.detail.objects || []).filter((o) => o.symbolType === 'mf_route' && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
    const routeSvg = routes.map((r) => {
      const cv = buildRouteCurve(r.points);
      const sel = state.selectedZone === r.id;
      const col = esc(r.color || '#0FA47F');
      const dash = ROUTE_DASH[routeArt(r)] || '';
      const line = '<path id="zone-poly-' + r.id + '" d="' + cv.d + '" fill="none" stroke="' + col + '" stroke-width="' + (sel ? 2.8 : 2) + '" '
        + (dash ? ('stroke-dasharray="' + dash + '" ') : '') + 'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" class="mf-line' + (sel ? ' sel' : '') + '" style="pointer-events:none"/>';
      const arrow = '<path id="route-arrow-' + r.id + '" d="' + routeArrowFromTan(r.points[r.points.length - 1], cv.tan, ar) + '" fill="' + col + '" stroke="' + col + '" stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      return line + arrow;
    }).join('');
    let draft = '';
    if (state.drawZone) {
      const L = layerById(state.activeLayer); const col = esc(L ? L.color : '#0065A5');
      const cur = state.zoneCursor; const al = state.zoneAlign || {};
      const gx = cur ? (cur.x * 100) : -20, gy = cur ? (cur.y * 100) : -20;
      // Fadenkreuz-Hilfslinien am Cursor (orange, wenn auf einen Stützpunkt ausgerichtet)
      draft += '<line id="guide-v" x1="' + gx + '" y1="0" x2="' + gx + '" y2="100" stroke="' + (al.x ? '#E8663F' : '#0065A5') + '" stroke-width="0.9" stroke-dasharray="2.2 1.6" opacity="0.9" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      draft += '<line id="guide-h" x1="0" y1="' + gy + '" x2="100" y2="' + gy + '" stroke="' + (al.y ? '#E8663F' : '#0065A5') + '" stroke-width="0.9" stroke-dasharray="2.2 1.6" opacity="0.9" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      draft += '<circle id="snap-ring" cx="-20" cy="-20" r="1.7" fill="#16A34A" fill-opacity="0.12" stroke="#16A34A" stroke-width="1.2" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      if (state.zoneDraft.length) {
        const dots = state.zoneDraft.map((p) => '<rect x="' + (p.x * 100 - 0.7) + '" y="' + (p.y * 100 - 0.7) + '" width="1.4" height="1.4" fill="' + col + '" style="pointer-events:none"/>').join('');
        if (state.drawShape === 'route') {
          const dpull = cur ? state.zoneDraft.concat([cur]) : state.zoneDraft;
          draft += '<path id="zone-draft" d="' + buildRouteCurve(dpull).d + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' + dots;
        } else {
          const dpts = state.zoneDraft.map((p) => (p.x * 100) + ',' + (p.y * 100));
          if (cur) dpts.push((cur.x * 100) + ',' + (cur.y * 100));
          draft += '<polyline id="zone-draft" points="' + dpts.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' + dots;
        }
      }
    }
    return '<svg class="zone-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2">' + techLinesSvg(visible) + polys + routeSvg + draft + '</svg>';
  }

  function isSelObj(id) { return (state.selObjs && state.selObjs.indexOf(id) >= 0) || state.selectedObj === id; }
  function toggleSelObj(id) {
    const o = (state.detail.objects || []).find((z) => z.id === id);
    if (!o || isShape(o)) return; // nur Punkt-Objekte/Icons, keine Zonen
    state.selObjs = state.selObjs || [];
    const i = state.selObjs.indexOf(id);
    if (i >= 0) state.selObjs.splice(i, 1); else state.selObjs.push(id);
    state.selectedObj = null; state.selectedZone = null;
  }
  function selBBox() {
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (!objs.length) return null;
    let minx = 1, miny = 1, maxx = 0, maxy = 0, maxS = 1;
    objs.forEach((o) => { minx = Math.min(minx, o.x); miny = Math.min(miny, o.y); maxx = Math.max(maxx, o.x); maxy = Math.max(maxy, o.y); maxS = Math.max(maxS, o.scale || 1); });
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, objs: objs, maxS: maxS };
  }
  function handleOff(scale) { return 0.014 * (scale || 1) + 0.012; }
  function selResizeLayer() {
    const bb = selBBox();
    if (!bb) return '';
    const arrow = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8 L16 16 M8 8 L8 12 M8 8 L12 8 M16 16 L16 12 M16 16 L12 16"/></svg>';
    return bb.objs.map(function (o) {
      const off = handleOff(o.scale || 1);
      const hx = clamp01(o.x + off), hy = clamp01(o.y + off);
      return '<div class="sel-resize" data-scalehandle="1" data-obj="' + o.id + '" style="left:' + (hx * 100) + '%;top:' + (hy * 100) + '%" title="' + t('Symbolgröße ziehen') + '">' + arrow + '</div>';
    }).join('');
  }
  function startScaleDrag(e) {
    const bb = selBBox(); if (!bb) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width), py = clamp01((e.clientY - r.top) / r.height);
    const startDist = Math.max(0.04, Math.hypot(px - bb.cx, py - bb.cy));
    const start = {}, pos = {};
    bb.objs.forEach((o) => { start[o.id] = o.scale || 1; pos[o.id] = { x: o.x, y: o.y }; });
    state._preDrag = snapObjects();
    state.scaleDrag = { ids: bb.objs.map((o) => o.id), cx: bb.cx, cy: bb.cy, startDist: startDist, start: start, pos: pos, last: {} };
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
  }
  function onScaleDrag(e) {
    const sd = state.scaleDrag; if (!sd) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width), py = clamp01((e.clientY - r.top) / r.height);
    const factor = Math.hypot(px - sd.cx, py - sd.cy) / sd.startDist;
    sd.ids.forEach((id) => {
      const ns = Math.min(3, Math.max(0.4, (sd.start[id] || 1) * factor));
      sd.last[id] = ns;
      const el = document.querySelector('.placed[data-obj="' + id + '"]');
      if (el) el.style.setProperty('--osc', ns.toFixed(2));
      const p = sd.pos[id];
      const h = document.querySelector('.sel-resize[data-obj="' + id + '"]');
      if (p && h) { const off = handleOff(ns); h.style.left = (clamp01(p.x + off) * 100) + '%'; h.style.top = (clamp01(p.y + off) * 100) + '%'; }
    });
  }
  async function endScaleDrag() {
    const sd = state.scaleDrag; state.scaleDrag = null; if (!sd) return;
    let changed = false;
    Object.keys(sd.last).forEach((id) => {
      const o = (state.detail.objects || []).find((z) => z.id === id); if (!o) return;
      const ns = Math.round(sd.last[id] * 100) / 100;
      if ((o.scale || 1) !== ns) { o.scale = ns; changed = true; protectObj(o.id); Api.updateObject(id, { scale: ns }).catch(() => { toast('Änderung nicht gespeichert'); }); }
    });
    if (changed && state._preDrag) { pushUndoSnap(state._preDrag); }
    state._preDrag = null;
    renderEditor();
  }
  function startGroupDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const el = e.target.closest('.placed'); if (!el) return;
    const ids = (state.selObjs || []).slice();
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (objs.length < 2) return;
    const start = {};
    objs.forEach((o) => { start[o.id] = { x: o.x, y: o.y, points: (o.points || []).map((p) => ({ x: p.x, y: p.y })), scale: o.scale || 1 }; });
    state._preDrag = snapObjects();
    state.groupDrag = { ids: objs.map((o) => o.id), start: start, sx: e.clientX, sy: e.clientY, doc: doc, moved: false, dx: 0, dy: 0 };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  function onGroupDrag(e) {
    const gd = state.groupDrag; if (!gd) return;
    if (!gd.moved && Math.hypot(e.clientX - gd.sx, e.clientY - gd.sy) < 4) return;
    gd.moved = true;
    const r = gd.doc.getBoundingClientRect();
    let dx = (e.clientX - gd.sx) / r.width, dy = (e.clientY - gd.sy) / r.height;
    if (state.snapGrid) { dx = snapToGrid(dx); dy = snapToGrid(dy); }
    gd.dx = dx; gd.dy = dy;
    gd.ids.forEach((id) => {
      const s = gd.start[id];
      const nx = clamp01(s.x + dx), ny = clamp01(s.y + dy);
      const el = document.querySelector('.placed[data-obj="' + id + '"]');
      if (el) { el.style.left = (nx * 100) + '%'; el.style.top = (ny * 100) + '%'; el.style.cursor = 'grabbing'; }
      const h = document.querySelector('.sel-resize[data-obj="' + id + '"]');
      if (h) { const off = handleOff(s.scale); h.style.left = (clamp01(nx + off) * 100) + '%'; h.style.top = (clamp01(ny + off) * 100) + '%'; }
    });
  }
  async function endGroupDrag() {
    const gd = state.groupDrag; state.groupDrag = null; if (!gd) return;
    if (!gd.moved) { renderEditor(); return; }
    let changed = false;
    for (const id of gd.ids) {
      const o = (state.detail.objects || []).find((z) => z.id === id); if (!o) continue;
      const s = gd.start[id];
      const nx = clamp01(s.x + gd.dx), ny = clamp01(s.y + gd.dy);
      if (o.x !== nx || o.y !== ny) {
        o.x = nx; o.y = ny;
        const patch = { x: nx, y: ny };
        if (s.points && s.points.length) {
          o.points = s.points.map((p) => ({ x: clamp01(p.x + gd.dx), y: clamp01(p.y + gd.dy) }));
          patch.points = o.points;
        }
        changed = true; protectObj(o.id);
        Api.updateObject(id, patch).catch(() => { toast('Position nicht gespeichert'); });
      }
    }
    if (changed && state._preDrag) { pushUndoSnap(state._preDrag); }
    state._preDrag = null;
    renderEditor();
  }
  function copySelectedObjects() {
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (!objs.length) return;
    state.clipboard = objs.map((o) => ({
      srcStation: state.detail.id,
      layerId: o.layerId, categoryId: o.categoryId || null, name: o.name, symbolType: o.symbolType,
      color: o.color, x: o.x, y: o.y, rotation: o.rotation || 0,
      points: (o.points || []).map((p) => ({ x: p.x, y: p.y })),
      plcConfigId: o.plcConfigId || null, scale: o.scale || 1,
      metatags: (o.metatags || []).map((m) => ({ position: m.position, label: m.label, value: m.value })),
    }));
    toast(objs.length === 1 ? t('Icon kopiert') : (objs.length + ' ' + t('Icons kopiert')));
  }
  async function pasteObjects() {
    const cb = state.clipboard || [];
    if (!cb.length || !state.detail) return;
    const dx = 0.03, dy = 0.03;
    pushUndo();
    const newIds = [];
    for (const c of cb) {
      const sameStation = c.srcStation === state.detail.id;
      const body = {
        layerId: c.layerId, categoryId: c.categoryId, name: c.name, symbolType: c.symbolType,
        color: c.color, x: clamp01(c.x + dx), y: clamp01(c.y + dy), rotation: c.rotation,
        plcConfigId: sameStation ? c.plcConfigId : null,
      };
      if (c.points && c.points.length) {
        body.points = c.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
      }
      let no;
      try { no = await Api.createObject(state.detail.id, body); } catch (e) { continue; }
      if (!no || !no.id) continue;
      if (c.scale && c.scale !== 1) { try { await Api.updateObject(no.id, { scale: c.scale }); } catch (e) { /* ignore */ } no.scale = c.scale; }
      if (c.metatags && c.metatags.length) { try { await Api.setMetatags(no.id, c.metatags); } catch (e) { /* ignore */ } no.metatags = c.metatags; }
      state.detail.objects.push(no);
      newIds.push(no.id);
    }
    // Klemmbrett fuer erneutes Einfuegen weiter versetzen (Kaskade)
    state.clipboard = cb.map((c) => Object.assign({}, c, { x: clamp01(c.x + dx), y: clamp01(c.y + dy), points: (c.points || []).map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })) }));
    state.selObjs = newIds; state.selectedObj = newIds.length === 1 ? newIds[0] : null; state.selectedZone = null;
    renderEditor();
    if (newIds.length) toast(newIds.length === 1 ? t('Icon eingefügt') : (newIds.length + ' ' + t('Icons eingefügt')));
  }
  async function deleteSelectedObjects() {
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs.slice() : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (!objs.length) return;
    pushUndo();
    state.selObjs = []; state.selectedObj = null;
    for (const o of objs) {
      try { await Api.deleteObject(o.id); } catch (e) { /* ignore */ }
      state.detail.objects = (state.detail.objects || []).filter((x) => x.id !== o.id);
    }
    renderEditor();
    toast(objs.length === 1 ? t('Icon gelöscht') : (objs.length + ' ' + t('Icons gelöscht')));
  }
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
  // Optionaler Perf-Wrapper: mit ?perf=1 loggt jeder Editor-Render seine Dauer (zum Messen, ohne Verhaltensaenderung).
  function renderEditor() {
    return renderEditorImpl();
  }
  function renderEditorImpl() {
    const c = $('content'); c.style.padding = '0';
    let L = layerById(state.activeLayer);
    if (!L || !layerAllowed(L.code)) L = allowedLayers()[0] || (state.detail.layers || [])[0];
    if (L && state.activeLayer !== L.id) state.activeLayer = L.id;
    if (!L) { c.innerHTML = '<div class="pad">Keine Ebenen sichtbar.</div>'; return; }
    const meta = paletteMetaFor(L);

    const counts = {};
    (state.detail.objects || []).forEach((o) => { counts[o.layerId] = (counts[o.layerId] || 0) + 1; });

    const palItem = ([name, sym]) => {
      const mm = String(name).match(/^(\d+)\s+(.+)$/);
      const no = mm ? mm[1] : '';
      const label = mm ? mm[2] : name;
      return '<div class="pal-item" style="color:' + esc(L.color) + ';--lc:' + esc(L.color) + ';--lc-soft:' + esc(meta.soft) + '" draggable="true" data-sym="' + sym + '" data-name="' + esc(name) + '" data-color="' + esc(L.color) + '" data-act="pal-hint" title="Auf das Layout ziehen">'
        + '<div class="sym">' + symInner(sym, 24) + '</div>'
        + '<div class="pal-cap">' + (no ? '<span class="pal-no">' + no + '</span>' : '') + '<span class="pal-nm">' + esc(label) + '</span></div>'
        + '</div>';
    };
    // Eigene (hochgeladene) Symbole der aktiven Ebene + „+"-Kachel
    const customPalHtml = () => {
      const items = Object.keys(state.customSyms || {}).map((st) => state.customSyms[st]).filter((c) => c.layerCode === L.code);
      const manage = canManagePalette();
      const tiles = items.map((c) => '<div class="pal-item custom" style="color:' + esc(L.color) + ';--lc:' + esc(L.color) + ';--lc-soft:' + esc(meta.soft) + '" draggable="true" data-sym="custom:' + esc(c.id) + '" data-name="' + esc(c.name) + '" data-color="' + esc(L.color) + '" data-act="pal-hint" title="Auf das Layout ziehen">'
        + (manage ? '<button class="pal-edit" data-act="pal-edit" data-id="' + c.id + '" title="Symbol bearbeiten" draggable="false"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg></button>'
          + '<button class="pal-del" data-act="pal-del" data-id="' + c.id + '" title="Symbol löschen" draggable="false">×</button>' : '')
        + '<div class="sym">' + symInner('custom:' + c.id, 24) + '</div>'
        + '<div class="pal-cap"><span class="pal-nm">' + esc(c.name) + '</span></div></div>').join('');
      const add = manage ? '<div class="pal-item pal-add" data-act="pal-add" title="Eigenes Symbol hochladen"><div class="pal-add-plus">+</div><div class="pal-cap"><span class="pal-nm">Eigenes Symbol</span></div></div>' : '';
      return (tiles || add) ? '<div class="pal-grid pal-custom">' + tiles + add + '</div>' : '';
    };
    let pal;
    if (meta === PROCESS_META) {
      const activeTab = state.palTab || 'a';
      const tabs = PT_COLOR_GROUPS.map((gr) => {
        const n = (meta.palette || []).filter(([name, sym]) => ptColorGroup(sym) === gr.key).length;
        return '<button class="pal-tab' + (gr.key === activeTab ? ' active' : '') + '" data-act="pal-tab" data-ptab="' + gr.key + '">'
          + '<span class="pal-sw' + (gr.key === 's' ? ' ring' : '') + '" style="background:' + gr.swatch + '"></span>' + t(gr.label) + '<span class="pal-gc">' + n + '</span></button>';
      }).join('');
      const panels = PT_COLOR_GROUPS.map((gr) => {
        const items = (meta.palette || []).filter(([name, sym]) => ptColorGroup(sym) === gr.key);
        return '<div class="pal-grid" data-ppanel="' + gr.key + '"' + (gr.key === activeTab ? '' : ' style="display:none"') + '>' + items.map(palItem).join('') + '</div>';
      }).join('');
      pal = '<div class="pal-tabs">' + tabs + '</div>' + panels + customPalHtml();
    } else {
      pal = '<div class="pal-grid">' + (meta.palette || []).map(palItem).join('') + '</div>' + customPalHtml();
    }

    const layerStack = (state.detail.layers || []).slice().reverse().filter((l) => layerAllowed(l.code)).map((l) => {
      const act = l.id === L.id, vis = l.visible !== false;
      const eye = vis
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.2 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.2-1.5"/><path d="M4 4l16 16"/></svg>';
      const lmeta = paletteMetaFor(l);
      return '<div class="layer ' + (act ? 'active' : '') + ' ' + (vis ? '' : 'hidden') + '" style="--lc:' + esc(l.color) + ';--lc-soft:' + esc(lmeta.soft) + '" data-act="layer-select" data-layer="' + l.id + '">'
        + '<div class="lbar"></div><div class="lmeta"><span class="lid">' + esc(l.code) + '</span><span class="lcount" title="Objekte auf dieser Ebene">' + (counts[l.id] || 0) + '</span><span class="lname">' + esc(t(l.name)) + '</span></div>'
        + '<button class="eye ' + (vis ? '' : 'off') + '" data-act="layer-eye" data-layer="' + l.id + '" title="Sichtbarkeit">' + eye + '</button></div>';
    }).join('');

    // Objektliste der aktiven Ebene (flach, ohne Kategorien)
    const objs = objectsOfLayer(L.id);
    const objlist = objs.length ? objRowsHtml(objs) : '<div style="color:var(--muted);font-size:13px;padding:4px 2px">Noch keine Objekte auf dieser Ebene.</div>';

    c.innerHTML = '<div class="editor-wrap"><div class="canvas-col">'
      + '<div class="editor-topbar"><div class="ttl">' + esc((state.detail.anlagenname || '').split(' · ')[0])
      + '<span class="lyr-badge" style="background:' + esc(L.color) + '">' + esc(L.code) + ' ' + esc(t(L.name)) + '</span></div>'
      + '<div style="margin-left:auto;display:flex;align-items:center;gap:10px">'
      + '<div id="collabBar">' + presenceHtml() + '</div>'
      + (canEdit() ? '<button class="up-btn" data-act="editor-upload">' + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg> ' + (state.detail.hasLayout ? t('LAYOUT ERSETZEN') : t('LAYOUT HOCHLADEN')) + '</button>' : '')
      + (canEdit() ? '<div class="up-btn undo-ctl"><button id="btnUndo" data-act="undo" title="Rückgängig (Strg+Z)"' + ((state.undoStack && state.undoStack.length) ? '' : ' disabled') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg></button>'
      + '<button id="btnRedo" data-act="redo" title="Wiederholen (Strg+Umschalt+Z)"' + ((state.redoStack && state.redoStack.length) ? '' : ' disabled') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg></button></div>' : '')
      + '<div class="zoom-ctl"><button data-act="zoom-out" aria-label="' + t('Verkleinern') + '">−</button><span class="z" aria-hidden="true">' + Math.round((state.zoom || 1) * 100) + '%</span><button data-act="zoom-in" aria-label="' + t('Vergrößern') + '">+</button></div>'
      + (canEdit() ? '<button class="up-btn snap-toggle' + (state.snapGrid ? ' on' : '') + '" data-act="toggle-snap" title="' + t('Am Raster ausrichten') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg> ' + t('Raster') + '</button>' : '')
      + '</div></div>'
      + '<div class="canvas-stage" id="stage"><div class="canvas-inner">' + editorFloorplan() + '</div>' + flowLegendHtml()
      + (canEdit() ? '<div class="palette"><div class="pal-head"><span class="pal-dot" style="background:' + esc(L.color) + '"></span><span class="pal-ttl">' + esc(t(L.name)) + '</span><span class="pal-code">' + esc(L.code) + '</span></div>' + pal
        + (((meta.palette || []).some(function (pp) { return pp[1] === 'robot'; }) && state.layoutBlobUrl && window.RobotDetect) ? '<div class="tpl-lib"><button class="tpl-manage' + (state.tplPanel ? ' open' : '') + '" data-act="tpl-panel">' + t('Gelernte Vorlagen') + ': <b>' + posLib().length + '</b>' + (negLib().length ? ' · ' + t('Fehlbeispiele') + ': <b>' + negLib().length + '</b>' : '') + ' ▾</button>' + tplPanelHtml() + '</div>' : '')
        + '</div>' : '')
      + '<div class="sat-ctl"><label>Layout-Sättigung <span id="satVal">' + (state.sat || 100) + '%</span></label><input id="satRange" type="range" min="10" max="100" value="' + (state.sat || 100) + '"></div>'
      + '<div class="exp-ctl">'
      + stationNavHtml()
      + '<button class="btn" data-act="export-pdf"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v11M8 10l4 4 4-4M5 19h14"/></svg> PDF</button>'
      + '<button class="btn" data-act="export-csv"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M9 4v16"/></svg> CSV</button>'
      + '<button class="btn tree-toggle" data-act="tree-toggle" title="Anlagenstruktur"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg> Struktur</button>'
      + '<button class="btn" data-act="editor-back"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 6l-6 6 6 6"/></svg> ' + t('ZURÜCK') + '</button>'
      + '</div></div></div>'
      + '<aside class="layers"><div class="lp-head"><h2>Ebenen-Stack</h2><p>Sichtbarkeit &amp; aktive Ebene</p></div>'
      + '<div class="layer-stack">' + layerStack + '</div>'
      + (canEdit() ? actionPanelHtml(L) : '')
      + '<div class="objlist"><div class="objlist-head"><h4>' + esc(L.code) + ' ' + esc(t(L.name)) + '</h4>' + (canEdit() && objs.length ? '<button class="cat-del-all" data-act="cat-del-all" data-cat="__all__" title="' + t('Alle Objekte dieser Ebene löschen') + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>' : '') + '<span class="objlist-cnt">' + objs.length + '</span></div>' + objlist + '</div>'
      + '</aside></div>';

    applyZoomSat();
    alignStateLines();
  }

  function actionPanelHtml(L) {
    const isL0 = L && L.name === 'Materialfluss';
    const isFG = L && L.name === 'Funktionsgruppen';
    const isSteuer = L && (L.name === 'Steuerungstechnik' || String(L.code || '').indexOf('L2.0') === 0);
    const isNotHalt = L && L.name === 'Not-Halt';
    const isRobotL = L && L.name === 'Saferobot / Technologie';
    // Zeichen-/Aktions-Werkzeuge nur fuer diese Ebenen. Auf allen anderen kein Werkzeug einblenden.
    if (!isL0 && !isFG && !isSteuer && !isNotHalt && !isRobotL) return '';
    const zoneActive = state.drawShape === 'zone';
    const routeActive = state.drawShape === 'route';
    let btn, hint, extra = '';
    if (isL0) {
      btn = '<button class="btn zone-btn ' + (routeActive ? 'active' : '') + '" data-act="toggle-route" style="width:100%">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h13M13 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg> '
        + (routeActive ? t('ZEICHNEN AKTIV') : t('FÖRDERWEG')) + '</button>';
      // Farbige Materialfluss-Typen zur Auswahl -> bestimmt die Pfeilfarbe des nächsten Förderwegs
      extra = '<div class="flow-pick">' + FLOW_TYPES.map((ft, i) =>
        '<button class="flow-chip ' + (state.flowType === i ? 'active' : '') + '" data-act="flow-type" data-flow="' + i + '" style="--fc:' + esc(ft.color) + '" title="' + esc(ft.name + ' – ' + ft.desc) + '">'
        + '<span class="fc-dot"></span>' + esc(ft.name) + '</button>').join('') + '</div>';
      hint = routeActive
        ? 'Klicken setzt Wegpunkte · Klick auf den letzten Punkt oder <b>Enter</b> beendet · <b>Esc</b> bricht ab. Farbe = gewählter Materialfluss-Typ; Doppelklick öffnet Typ &amp; Förderart.'
        : 'Erst Typ oben wählen (Farbe), dann zeichnen. Wegpunkte danach verschiebbar. Weg anklicken: <b>Entf</b> löscht, <b>R</b> kehrt die Richtung um.';
    } else if (isNotHalt) {
      const nSb = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3).length;
      const nhz = (state.detail.objects || []).filter((o) => o.symbolType === 'nh_zone');
      const nhAuto = nhz.filter((o) => (o.metatags || []).some((m) => m.label === 'SB-Stand')); // automatisch erzeugte Grenzen (mit SB-Stand); manuelle bleiben unberuehrt
      const fpNow = nSb ? sbFingerprint() : '';
      const stale = nhAuto.length && nhAuto.some((o) => { const m = (o.metatags || []).find((x) => x.label === 'SB-Stand'); return m.value !== fpNow; });
      const busy = !!state.nhGenerating;
      const nhActive = state.drawShape === 'nhzone';
      btn = '<button class="btn zone-btn" data-act="gen-nothalt" style="width:100%"' + ((nSb && !busy) ? '' : ' disabled') + '>'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></svg> '
        + (busy ? 'GENERIERE …' : 'NOT-HALT-GRENZE GENERIEREN') + '</button>'
        + '<div style="height:7px"></div>'
        + '<button class="btn zone-btn ' + (nhActive ? 'active' : '') + '" data-act="toggle-nhzone" style="width:100%">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v14H4z" stroke-dasharray="0.5 3" stroke-linecap="round"/></svg> '
        + (nhActive ? t('ZEICHNEN AKTIV') : 'NOT-HALT-GRENZE MANUELL') + '</button>';
      hint = nhActive
        ? 'Klicken setzt Stützpunkte · richtet <b>waagerecht/senkrecht</b> aus · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
        : (!nSb
          ? 'Noch keine Schutzbereiche (SB) vorhanden – zuerst SB einzeichnen und generieren, oder unten die Grenze <b>manuell</b> zeichnen.'
          : (stale ? '<b>Schutzbereiche wurden seit der Generierung geändert</b> – klicken, um die Grenze neu zu generieren.'
            : (nhAuto.length ? 'Grenze ist aktuell (' + nSb + ' SB umschlossen). Erneutes Klicken generiert sie neu.'
              : 'Generiert eine Not-Halt-Grenze als umschließende Umrisslinie aller ' + nSb + ' Schutzbereiche (SB).')));
    } else if (isRobotL) {
      const ready = state.layoutBlobUrl && window.RobotDetect;
      btn = '<button class="btn zone-btn' + (state.robotDetecting ? ' active' : '') + '" data-act="detect-robots" style="width:100%"' + (ready ? '' : ' disabled') + '>'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg> '
        + (state.robotDetecting ? t('Erkenne …') : t('Roboter erkennen')) + '</button>';
      hint = ready
        ? 'Findet Roboter im Layout automatisch und legt sie als Objekte an. Danach je Roboter „Safe Funktion" und „Technologie" setzen (Pflicht).'
        : 'Erkennung benötigt ein hinterlegtes Layout-Bild.';
    } else {
      const spsActive = state.drawShape === 'spszone';
      const zsvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4z" stroke-dasharray="3 2.5"/></svg> ';
      const zbtn = (a, on, label) => '<button class="btn zone-btn ' + (on ? 'active' : '') + '" data-act="' + a + '" style="width:100%">' + zsvg + label + '</button>';
      if (isSteuer) {
        // SPS-Bereich (1:1 zu einer SPS) ueber dem Schutzbereich-Button
        btn = zbtn('toggle-spszone', spsActive, spsActive ? 'ZEICHNEN AKTIV' : 'SPS BEREICH')
          + '<div style="height:7px"></div>'
          + zbtn('toggle-zone', zoneActive, zoneActive ? 'ZEICHNEN AKTIV' : 'SB SCHUTZBEREICH');
        hint = (spsActive || zoneActive)
          ? 'Klicken setzt Stützpunkte · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
          : '<b>SPS-Bereich:</b> genau eine SPS je Bereich (1:1) – nach dem Zeichnen SPS wählen. <b>Schutzbereich:</b> optionale SPS-Zuordnung.';
      } else {
        const kind = zoneKind(layerById(state.activeLayer));
        btn = zbtn('toggle-zone', zoneActive, zoneActive ? 'ZEICHNEN AKTIV' : kind.label);
        hint = zoneActive
          ? 'Klicken setzt Stützpunkte · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
          : 'Polygon zeichnen; Stützpunkte danach verschiebbar. ' + kind.noun + ' anklicken &amp; <b>Entf</b> löscht ihn.';
      }
    }
    return '<div class="lp-action">' + btn + extra + '<div class="zone-hint">' + hint + '</div></div>';
  }

  // Objektzeile in der Objektliste sichtbar scrollen (nach Auswahl im Layout).
  function focusObjInList(id) {
    const row = document.querySelector('.objlist .obj[data-obj="' + id + '"]');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Umgekehrt: Auswahl in der Objektliste -> Objekt im Layout selektieren und mit einem kurzen Puls hervorheben. Gilt fuer Icons, Polygone und Foerderstrecken.
  function focusObjInLayout(id) {
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === id);
    if (!o) return;
    if (o.layerId && layerById(o.layerId) && state.activeLayer !== o.layerId) state.activeLayer = o.layerId;
    if (isShape(o)) { state.selectedZone = id; state.selectedObj = null; }
    else { state.selectedObj = id; state.selectedZone = null; }
    renderEditor();
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    let cx, cy;
    if (isShape(o) && o.points && o.points.length) { cx = o.points.reduce((s, p) => s + p.x, 0) / o.points.length; cy = o.points.reduce((s, p) => s + p.y, 0) / o.points.length; }
    else { cx = o.x; cy = o.y; }
    if (cx == null || cy == null) return;
    const ring = document.createElement('div');
    ring.className = 'focus-ring';
    ring.style.left = (cx * 100) + '%'; ring.style.top = (cy * 100) + '%';
    doc.appendChild(ring);
    setTimeout(() => { ring.remove(); }, 1300);
  }
  function objRowsHtml(list) {
    const tools = canEdit();
    const rows = list.map((o, i) => '<div class="obj' + ((o.id === state.selectedObj || o.id === state.selectedZone) ? ' sel' : '') + '" data-act="obj-focus" data-obj="' + esc(o.id) + '"><span class="onum">' + (i + 1) + '</span><span class="odot" style="background:' + esc(isShape(o) ? zoneColor(o) : o.color) + '"></span>' + (o.id === state.editingObjId ? '<input class="oname-edit" data-oedit="' + esc(o.id) + '" value="' + esc(o.name) + '">' : '<span class="oname"' + (tools ? ' data-act="obj-name" data-obj="' + esc(o.id) + '" title="Doppelklick zum Umbenennen"' : '') + '>' + esc(o.name) + '</span>')
      + (tools ? ('<div class="obj-tools">'
      + '<button data-act="obj-edit" data-obj="' + o.id + '" title="Metatags"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l8-8h6v6l-8 8z"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/></svg></button>'
      + '<button class="del" data-act="obj-del" data-obj="' + o.id + '" title="Löschen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</div>') : '') + '</div>').join('');
    return rows;
  }

  function applyZoomSat() { const doc = document.getElementById('canvasDoc'); if (doc) doc.style.transform = 'translate3d(' + (state.panX || 0) + 'px,' + (state.panY || 0) + 'px,0) scale(' + (state.zoom || 1) + ')'; }
  // Mitte des Icon-Symbols (.p-sym) eines Objekts als Bruchteil der Zeichenflaeche (zoom-invariant, da Symbol und Linien-SVG gemeinsam skalieren).
  function symFrac(oid) {
    const doc = document.getElementById('canvasDoc');
    const sym = document.querySelector('.placed[data-obj="' + oid + '"] .p-sym');
    if (!doc || !sym) return null;
    const dr = doc.getBoundingClientRect(), sr = sym.getBoundingClientRect();
    if (!dr.width || !dr.height) return null;
    return { x: (sr.left + sr.width / 2 - dr.left) / dr.width, y: (sr.top + sr.height / 2 - dr.top) / dr.height };
  }
  // Prozesstyp-Ende der Zustands-Verbindungslinien auf die Icon-Mitte legen (statt Spalten-Anker o.x/o.y).
  function alignStateLines() {
    document.querySelectorAll('.state-link-svg line[data-sline]').forEach((ln) => {
      const oid = (ln.getAttribute('data-sline') || '').split('__')[0];
      const f = symFrac(oid);
      if (f) { ln.setAttribute('x1', (f.x * 100).toFixed(3)); ln.setAttribute('y1', (f.y * 100).toFixed(3)); }
    });
  }
  function zoomStep(d) { state.zoom = Math.min(2.2, Math.max(0.5, (state.zoom || 1) + d)); applyZoomSat(); const z = document.querySelector('.zoom-ctl .z'); if (z) z.textContent = Math.round(state.zoom * 100) + '%'; }
  function onWheelZoom(e) {
    if (state.view !== 'editor') return;
    const stage = e.target.closest && e.target.closest('.canvas-stage');
    if (!stage) return;
    e.preventDefault();
    const d = Math.max(-0.2, Math.min(0.2, -e.deltaY * 0.0016));
    if (d) zoomStep(d);
  }
  function onSat(v) { state.sat = +v; const sv = document.getElementById('satVal'); if (sv) sv.textContent = v + '%'; const bg = document.querySelector('.floor-bg'); if (bg) bg.style.opacity = (+v / 100); }

  function selectLayer(id) {
    if (state.drawZone) { state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null; }
    state.activeLayer = id; renderEditor();
  }
  async function toggleLayerVis(id) {
    const lay = layerById(id); if (!lay) return;
    const nv = !(lay.visible !== false); lay.visible = nv;
    try { await Api.setLayerVisibility(state.detail.id, id, nv); } catch (e) { lay.visible = !nv; toast('Sichtbarkeit nicht gespeichert'); }
    renderEditor();
  }

