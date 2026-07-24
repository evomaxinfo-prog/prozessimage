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
  // Der Server speichert Koordinaten als decimal(8,6); lokal liegen ungerundete Werte.
  // Ohne Rundung gelten reine Nachkomma-Reste als Aenderung -> unnoetige Schreibvorgaenge
  // und Undo-Schritte, die scheinbar fremde Objekte anfassen.
  const _r6 = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6;
  const _samePts = (p, q) => {
    if (!p || !q) return !p === !q;
    if (p.length !== q.length) return false;
    for (let i = 0; i < p.length; i++) { if (_r6(p[i].x) !== _r6(q[i].x) || _r6(p[i].y) !== _r6(q[i].y)) return false; }
    return true;
  };
  function objChanged(a, b) {
    if (a.name !== b.name || a.color !== b.color || a.symbolType !== b.symbolType || a.layerId !== b.layerId
      || _r6(a.x) !== _r6(b.x) || _r6(a.y) !== _r6(b.y) || _r6(a.rotation || 0) !== _r6(b.rotation || 0)
      || _r6(a.scale == null ? 1 : a.scale) !== _r6(b.scale == null ? 1 : b.scale)
      || (a.plcConfigId || '') !== (b.plcConfigId || '') || (a.visible !== false) !== (b.visible !== false)) return true;
    if (!_samePts(a.points || null, b.points || null)) return true;
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
      return '<div class="placed' + (fgAssigned ? ' fg-assigned' : '') + ' hover-tags' + (isSelObj(o.id) ? ' sel' : '') + '" data-obj="' + o.id + '" style="left:' + (o.x * 100) + '%;top:' + (o.y * 100) + '%;color:' + esc(objIconColor(o)) + ';--osc:' + (o.scale || 1) + ';--orot:' + (o.rotation || 0) + 'deg"'
        + ' title="' + esc(o.name) + ' — ziehen zum Verschieben · Doppelklick für Metatags">'
        + '<span class="p-sym">' + symInner(o.symbolType, 26) + '</span>'
        + ((o.rotation || 0) ? '<span class="p-orient" title="' + esc(t('gedreht um {n}°', { n: Math.round(o.rotation) })) + '"></span>' : '')
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
      // Blauer Ring am ERSTEN Stuetzpunkt, sobald der Cursor nah genug ist, um das Polygon zu schliessen.
      draft += '<circle id="close-ring" cx="-20" cy="-20" r="2.2" fill="#0065A5" fill-opacity="0.15" stroke="#0065A5" stroke-width="1.8" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
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
      const rx = clamp01(o.x + off), ry = clamp01(o.y - off); // Dreh-Anfasser gegenueber dem Groessen-Anfasser
      const dreh = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>';
      return '<div class="sel-resize" data-scalehandle="1" data-obj="' + o.id + '" style="left:' + (hx * 100) + '%;top:' + (hy * 100) + '%" title="' + t('Symbolgröße ziehen') + '">' + arrow + '</div>'
        + '<div class="sel-rotate" data-rothandle="1" data-obj="' + o.id + '" style="left:' + (rx * 100) + '%;top:' + (ry * 100) + '%" title="' + t('Drehen: Klick +15°, Umschalt+Klick −15° (auch Taste R)') + '">' + dreh + '</div>';
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
      if ((o.scale || 1) !== ns) { o.scale = ns; changed = true; protectObj(o.id); Api.updateObject(id, { scale: ns }).catch(() => { toast(t('Änderung nicht gespeichert')); }); }
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
        Api.updateObject(id, patch).catch(() => { toast(t('Position nicht gespeichert')); });
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
  function pasteObjects() { return withMutationLock(function () { return pasteObjectsImpl(); }); }
  async function pasteObjectsImpl() {
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
  // Auswahl in 15-Grad-Schritten drehen. Zonen/Foerderwege (mit Stuetzpunkten) bleiben aussen vor.
  // Die Anzeige wird sofort ueber die CSS-Variable nachgezogen (kein Neuaufbau), gespeichert wird
  // gebuendelt nach kurzer Pause - sonst gaebe es eine Server-Anfrage je Tastendruck.
  function rotateSelectedObjects(delta) {
    if (!state.detail) return;
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs.slice() : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !(o.points && o.points.length));
    if (!objs.length) return;
    if (!state._rotUndoActive) { pushUndo(); state._rotUndoActive = true; } // ein Undo-Punkt je Dreh-Serie
    if (state._rotUndoTimer) clearTimeout(state._rotUndoTimer);
    state._rotUndoTimer = setTimeout(function () { state._rotUndoActive = false; }, 700);
    objs.forEach(function (o) {
      o.rotation = ((((o.rotation || 0) + delta) % 360) + 360) % 360;
      protectObj(o.id);
      const el = document.querySelector('.placed[data-obj="' + o.id + '"]');
      if (el) el.style.setProperty('--orot', o.rotation + 'deg');
    });
    if (state._rotSaveTimer) clearTimeout(state._rotSaveTimer);
    state._rotSaveTimer = setTimeout(function () {
      objs.forEach(function (o) {
        Api.updateObject(o.id, { rotation: o.rotation }).catch(function () { toast(t('Änderung nicht gespeichert')); });
      });
    }, 350);
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
