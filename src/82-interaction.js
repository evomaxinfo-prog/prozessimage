  async function placeFromDrop(clientX, clientY, sym, name, color) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    let x = Math.min(0.97, Math.max(0.03, (clientX - r.left) / r.width));
    let y = Math.min(0.96, Math.max(0.04, (clientY - r.top) / r.height));
    if (state.snapGrid) { x = Math.min(0.97, Math.max(0.03, snapToGrid(x))); y = Math.min(0.96, Math.max(0.04, snapToGrid(y))); }
    const L = layerById(state.activeLayer);
    const base = (name || 'Objekt').replace(/\s+/g, '_');
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === sym).length + 1).padStart(2, '0');
    try {
      pushUndo();
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: base + '_' + num, symbolType: sym, color: color || L.color, x, y });
      obj.metatags = obj.metatags || [];
      const pt = processTypeByName(name);
      if (pt) {
        try {
          const fg = detectFgName(x, y);
          const tags = [
            { position: 0, label: 'Funktionsgruppen', value: fg },
            { position: 1, label: 'Prozesstyp', value: pt.ptyp },
            { position: 2, label: 'Hardware · Art', value: pt.hwart },
          ];
          let pos = 3;
          ptStateList(pt).forEach((s) => { tags.push({ position: pos++, label: s.kind + ' – ' + s.name, value: '' }); });
          const upd = await Api.setMetatags(obj.id, tags);
          obj.metatags = (upd && upd.metatags) || obj.metatags;
          if (fg) toast(name + ' → Funktionsgruppe „' + fg + '" zugeordnet');
          else toast(name + ' ' + t('platziert'));
        } catch (e2) { toast(name + ' ' + t('platziert')); }
      } else if (/^custom:/.test(sym)) {
        const tags = symFields(sym).map((f, i) => ({ position: i + 1, label: f.label, value: '' }));
        try { const upd = await Api.setMetatags(obj.id, tags); obj.metatags = (upd && upd.metatags) || tags; } catch (e2) { obj.metatags = tags; }
        toast(name + ' ' + t('platziert'));
      } else { toast(name + ' ' + t('platziert')); }
      state.detail.objects.push(obj); protectObj(obj.id);
      if (sym === 'robot' && state.layoutBlobUrl) promptLearnTemplate(x, y);
      renderEditor();
    } catch (e) { toast('Platzieren fehlgeschlagen: ' + e.message); }
  }

  let dragMove = null;
  function startMove(e, oid) {
    if (e.button !== undefined && e.button !== 0) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    // Element per Objekt-ID holen (render-fest: falls direkt vor dem Greifen neu gerendert wurde, ist e.target evtl. veraltet).
    let el = null; try { el = doc.querySelector('.placed[data-obj="' + (window.CSS && CSS.escape ? CSS.escape(oid) : oid) + '"]'); } catch (_) { el = null; }
    if (!el) el = e.target.closest('.placed');
    if (!el) return;
    state._preDrag = snapObjects();
    dragMove = { oid, el, doc, sx: e.clientX, sy: e.clientY, moved: false, nx: null, ny: null };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  function onIconDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    state.iconDrag.moved = true; state.iconDrag.nx = x; state.iconDrag.ny = y;
    if (state.iconDrag.el) { state.iconDrag.el.style.left = (x * 100) + '%'; state.iconDrag.el.style.top = (y * 100) + '%'; }
    const ln = document.querySelector('[data-sline="' + (window.CSS && CSS.escape ? CSS.escape(state.iconDrag.oid + '__' + state.iconDrag.st) : (state.iconDrag.oid + '__' + state.iconDrag.st)) + '"]');
    if (ln) { ln.setAttribute('x2', x * 100); ln.setAttribute('y2', y * 100); }
  }
  async function endIconDrag() {
    const id = state.iconDrag; state.iconDrag = null;
    if (!id || !id.moved || id.nx == null) return;
    const o = (state.detail.objects || []).find((x) => x.id === id.oid); if (!o) return;
    if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; }
    const map = iconPosMap(o); map[id.st] = { x: id.nx, y: id.ny };
    const metatags = (o.metatags || []).filter((m) => m.label !== 'Icon-Positionen')
      .concat([{ position: 90, label: 'Icon-Positionen', value: JSON.stringify(map) }]);
    protectObj(o.id);
    try { const upd = await Api.setMetatags(o.id, metatags); o.metatags = (upd && upd.metatags) || metatags; } catch (e) { toast('Icon-Position nicht gespeichert'); }
  }
  // Hover-Tooltip: beim Ueberfahren einer Zone Name (+ SPS bei FG/SB) anzeigen.
  let _hoverZoneId = null;
  function setZoneHoverClass(id, on, isRoute) {
    if (id == null) return;
    const cls = isRoute ? 'route-hl' : 'zone-hover';
    ['zone-poly-' + id, 'route-arrow-' + id].forEach(function (eid) {
      const el = document.getElementById(eid); if (!el) return;
      if (on) el.classList.add(cls); else el.classList.remove('zone-hover', 'route-hl');
    });
  }
  function updateZoneHoverTitle(e) {
    const doc = document.getElementById('canvasDoc');
    if (!doc) return;
    if (state.drawZone) { if (doc.style.cursor) doc.style.cursor = ''; if (_hoverZoneId !== null) { setZoneHoverClass(_hoverZoneId, false); _hoverZoneId = null; } return; } // Zeichen-Modus: .drawing-Klasse (crosshair) greifen lassen
    const r = doc.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      if (_hoverZoneId !== null) { setZoneHoverClass(_hoverZoneId, false); _hoverZoneId = null; doc.removeAttribute('title'); doc.style.cursor = ''; }
      return;
    }
    const z = zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    const id = z ? z.id : null;
    if (id === _hoverZoneId) return;
    if (_hoverZoneId !== null) setZoneHoverClass(_hoverZoneId, false);
    _hoverZoneId = id;
    setZoneHoverClass(id, true, z && z.symbolType === 'mf_route');
    doc.style.cursor = z ? 'move' : ''; // über einer Zone/Route: Verschiebe-Cursor; sonst Canvas-Standard (grab)
    if (z && (z.symbolType === 'fg_zone' || z.symbolType === 'sb_zone')) {
      const sps = plcNameOf(z);
      doc.title = z.name + (sps ? ' — SPS: ' + sps : '');
    } else if (z && z.symbolType === 'sps_zone') {
      doc.title = spsZoneLabel(z);
    } else { doc.removeAttribute('title'); }
  }

  function onCwDrag(e) {
    var win = document.querySelector('.comment-window'); var d = state.cwDrag; if (!win || !d) return;
    var wr = win.getBoundingClientRect();
    var wpct = wr.width / d.docW * 100, hpct = wr.height / d.docH * 100;
    var leftPct = (e.clientX - d.offx - d.docL) / d.docW * 100;
    var topPct = (e.clientY - d.offy - d.docT) / d.docH * 100;
    leftPct = Math.max(0, Math.min(100 - wpct, leftPct));
    topPct = Math.max(0, Math.min(100 - hpct, topPct));
    win.style.left = leftPct + '%'; win.style.top = topPct + '%';
    d.leftPct = leftPct; d.topPct = topPct;
  }
  function onPinDrag(e) {
    var d = state.pinDrag; if (!d) return;
    if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    var x = Math.max(0, Math.min(1, (e.clientX - d.docL) / d.docW));
    var y = Math.max(0, Math.min(1, (e.clientY - d.docT) / d.docH));
    d.x = x; d.y = y;
    if (d.moved) { var pin = document.querySelector('.comment-pin[data-id="' + d.id + '"]'); if (pin) { pin.style.left = x * 100 + '%'; pin.style.top = y * 100 + '%'; } }
  }
  // Ganze Zeichenfläche verschieben (Pan): rAF-gebündeltes translate3d auf #canvasDoc (GPU-Layer), sanft begrenzt.
  function applyPanFrame() {
    const d = state.panDrag; if (!d) return; d.raf = 0;
    d.doc.style.transform = 'translate3d(' + (state.panX || 0) + 'px,' + (state.panY || 0) + 'px,0) scale(' + d.z + ')';
  }
  function onPanDrag(e) {
    const d = state.panDrag;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    let nx = d.px0 + dx, ny = d.py0 + dy;
    nx = Math.max(-d.dw, Math.min(d.dw, nx)); ny = Math.max(-d.dh, Math.min(d.dh, ny));
    state.panX = nx; state.panY = ny;
    if (!d.raf) d.raf = requestAnimationFrame(applyPanFrame);
  }
  // Beendet einen evtl. laufenden Pan sauber (z. B. bei Fokusverlust des Fensters).
  function cleanupStuckPan() {
    const d = state.panDrag; if (!d) return;
    state.panDrag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.doc) { d.doc.style.cursor = ''; d.doc.style.transition = ''; d.doc.style.willChange = ''; }
    applyZoomSat();
  }
  function onMove(e) {
    if (state.panDrag) { onPanDrag(e); return; }
    if (state.scaleDrag) { onScaleDrag(e); return; }
    if (state.groupDrag) { onGroupDrag(e); return; }
    if (state.cwDrag) { onCwDrag(e); return; }
    if (state.pinDrag) { onPinDrag(e); return; }
    if (state.iconDrag) { onIconDrag(e); return; }
    if (state.techDrag) { onTechDrag(e); return; }
    if (state.zoneDrag) { onZoneDrag(e); return; }
    updateZoneHoverTitle(e);
    if (state.drawZone) {
      const doc = document.getElementById('canvasDoc');
      if (doc) { const r = doc.getBoundingClientRect(); const cxr = clamp01((e.clientX - r.left) / r.width), cyr = clamp01((e.clientY - r.top) / r.height); const sn = snapCursor(cxr, cyr); state.zoneCursor = { x: sn.x, y: sn.y }; state.zoneAlign = { x: sn.ax, y: sn.ay }; state.zoneSnap = sn.dock ? { x: sn.x, y: sn.y } : null; updateDraftDom(); }
    }
    if (!dragMove) return;
    if (!dragMove.moved && Math.hypot(e.clientX - dragMove.sx, e.clientY - dragMove.sy) < 4) return;
    dragMove.moved = true;
    const r = dragMove.doc.getBoundingClientRect();
    let x = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width));
    let y = Math.min(0.96, Math.max(0.04, (e.clientY - r.top) / r.height));
    if (state.snapGrid) { x = Math.min(0.97, Math.max(0.03, snapToGrid(x))); y = Math.min(0.96, Math.max(0.04, snapToGrid(y))); }
    dragMove.nx = x; dragMove.ny = y;
    dragMove.el.style.left = (x * 100) + '%'; dragMove.el.style.top = (y * 100) + '%'; dragMove.el.style.cursor = 'grabbing';
    // Skalier-Anfasser (Doppelpfeil) des Icons mitführen, falls sichtbar
    const _mh = document.querySelector('.sel-resize[data-obj="' + dragMove.oid + '"]');
    if (_mh) {
      const _mo = (state.detail.objects || []).find((z) => z.id === dragMove.oid);
      const _off = handleOff(_mo ? (_mo.scale || 1) : 1);
      _mh.style.left = (clamp01(x + _off) * 100) + '%'; _mh.style.top = (clamp01(y + _off) * 100) + '%';
    }
    // Zustands-Icon-Verbindungslinien live mitziehen (auf die Icon-Mitte, nicht den Spalten-Anker)
    const sf = symFrac(dragMove.oid);
    const slx = (sf ? sf.x : x) * 100, sly = (sf ? sf.y : y) * 100;
    document.querySelectorAll('[data-sline^="' + dragMove.oid + '__"]').forEach((ln) => {
      ln.setAttribute('x1', slx.toFixed(3)); ln.setAttribute('y1', sly.toFixed(3));
    });
    // Technologie-Linie live mitziehen (Roboter-Ende der Linie)
    const tline = document.getElementById('tech-line-' + dragMove.oid);
    if (tline) {
      const ro = (state.detail.objects || []).find((z) => z.id === dragMove.oid);
      let bx, by;
      if (ro && ro.points && ro.points.length >= 1 && ro.points[0]) { bx = ro.points[0].x; by = ro.points[0].y; }
      else {
        bx = Math.min(x + 0.12, 0.94); by = Math.max(y - 0.12, 0.07);
        const bd = document.querySelector('.tech-badge[data-tech="' + (ro ? ro.id : '') + '"]');
        if (bd) { bd.style.left = (bx * 100) + '%'; bd.style.top = (by * 100) + '%'; }
      }
      const e = techLineEnds(x, y, bx, by);
      tline.setAttribute('x1', e.x1.toFixed(3)); tline.setAttribute('y1', e.y1.toFixed(3));
      tline.setAttribute('x2', e.x2.toFixed(3)); tline.setAttribute('y2', e.y2.toFixed(3));
    }
  }
  async function endMove() {
    if (state.panDrag) {
      cleanupStuckPan();
      return;
    }
    if (state.pinDrag) {
      var d = state.pinDrag; state.pinDrag = null;
      var c = (state.comments || []).find(function (x) { return x.id === d.id; });
      if (c) {
        if (d.moved && d.x != null) {
          c.x = d.x; c.y = d.y;
          if (state.commentsServer) {
            // Schutz gegen Zurueckspringen: rein zeitbasiert (kann nie dauerhaft blockieren, auch wenn
            // der PATCH haengt): 15s ab Start, nach Abschluss noch 7s Nachlauf fuer den naechsten Poll.
            state.commentsHoldUntil = Date.now() + 15000;
            Api.moveComment(c.id, d.x, d.y)
              .catch(function () { toast(t('Kommentar-Position konnte nicht gespeichert werden')); })
              .finally(function () { state.commentsHoldUntil = Date.now() + 7000; });
            state.commentsSig = commentsSig(state.comments);
          } else { saveComments(); }
          renderEditor();
        }
        else { state.openComment = d.id; renderEditor(); setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30); }
      }
      return;
    }
    if (state.cwDrag) {
      var d = state.cwDrag; state.cwDrag = null;
      var c = (state.comments || []).find(function (x) { return x.id === d.id; });
      if (c && d.leftPct != null) { c.winX = d.leftPct / 100; c.winY = d.topPct / 100; if (!state.commentsServer) saveComments(); }
      return;
    }
    if (state.scaleDrag) { await endScaleDrag(); return; }
    if (state.groupDrag) { await endGroupDrag(); return; }
    if (state.iconDrag) { await endIconDrag(); return; }
    if (state.techDrag) {
      const td = state.techDrag; state.techDrag = null;
      const o = (state.detail.objects || []).find((z) => z.id === td.id);
      if (td.moved && o) { o.points = [{ x: td.fx, y: td.fy }]; if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; } protectObj(o.id); try { await Api.updateObject(o.id, { points: o.points }); } catch (e2) { toast('Position nicht gespeichert'); } }
      renderEditor(); return;
    }
    if (state.zoneDrag) {
      const zd = state.zoneDrag; state.zoneDrag = null;
      const z = (state.detail.objects || []).find((o) => o.id === zd.id);
      if ((zd.type === 'vertex' || zd.type === 'move') && zd.moved && z) {
        if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; }
        protectObj(z.id);
        state.geomPending[z.id] = { points: z.points.map(function (p) { return { x: p.x, y: p.y }; }), ts: Date.now() };
        updateZoneDom(z);
        const _rel = document.getElementById('zone-poly-' + z.id); if (_rel) _rel.setAttribute('stroke', esc(zoneColor(z))); // gruene Snap-Rueckmeldung nach dem Loslassen zuruecksetzen
        try {
          await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y });
        } catch (e2) { toast('Position nicht gespeichert'); }
        // SB-Polygon auf einen SPS-Bereich gezogen -> automatische SPS-Verknuepfung
        if (zd.type === 'move' && (z.symbolType === 'sb_zone' || z.symbolType === 'fg_zone')) { await autoLinkZoneToSps(z); }
        return;
      }
      // Klick ohne Bewegung: Auswahl bzw. Doppelklick (zeitbasiert, re-render-fest)
      if (z) {
        const now = Date.now();
        const dbl = state.lastZoneUp && state.lastZoneUp.id === z.id && (now - state.lastZoneUp.t) < 400;
        state.lastZoneUp = dbl ? null : { id: z.id, t: now };
        if (dbl) { if (z.symbolType === 'mf_route') openRouteModal(z.id); else if (z.symbolType === 'sb_zone' || z.symbolType === 'sps_zone') openZoneAssignModal(z.id); else if (z.symbolType === 'fg_zone') openTagModal(z.id); return; }
        let zRender = false;
        if (state.selectedZone !== z.id) { state.selectedZone = z.id; zRender = true; }
        if (z.layerId && layerById(z.layerId) && state.activeLayer !== z.layerId) { state.activeLayer = z.layerId; zRender = true; }
        if (zRender) renderEditor();
        focusObjInList(z.id);
        return;
      }
      return;
    }
    if (!dragMove) return;
    const dm = dragMove; dragMove = null;
    if (dm.el) dm.el.style.cursor = '';
    const clicked = (state.detail.objects || []).find((x) => x.id === dm.oid);
    let selRender = false;
    // Objekt anklicken/verschieben -> auswaehlen; zugehoerige Ebene rechts aktiv setzen (Prozesstyp hebt zudem die Funktionsgruppe hervor).
    if (clicked) {
      if (state.selectedObj !== dm.oid) { state.selectedObj = dm.oid; selRender = true; }
      if (clicked.layerId && layerById(clicked.layerId) && state.activeLayer !== clicked.layerId) { state.activeLayer = clicked.layerId; selRender = true; }
    } else if (state.selectedObj) { state.selectedObj = null; selRender = true; }
    if (dm.moved && dm.nx != null) {
      if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; }
      const o = clicked;
      if (o) {
        o.x = dm.nx; o.y = dm.ny;
        protectObj(o.id); try { await Api.updateObject(o.id, { x: dm.nx, y: dm.ny }); } catch (e) { toast('Verschieben nicht gespeichert'); }
        // Prozesstyp auf eine Funktionsgruppe gezogen -> automatisch zuordnen (Metatag „Funktionsgruppen")
        let fgChanged = false;
        if (/^ptk_/.test(o.symbolType)) {
          const fg = detectFgName(dm.nx, dm.ny);
          const cur = (o.metatags || []).find((m) => m.label === 'Funktionsgruppen');
          if (fg && (cur ? cur.value : '') !== fg) {
            o.metatags = o.metatags || [];
            if (cur) cur.value = fg; else o.metatags.unshift({ position: 0, label: 'Funktionsgruppen', value: fg });
            protectObj(o.id); try { await Api.setMetatags(o.id, o.metatags); } catch (e) { /* optional */ }
            toast(o.name + ' → Funktionsgruppe „' + fg + '" zugeordnet'); fgChanged = true;
          }
        }
        if (fgChanged || techInfo(o)) selRender = true;
      }
    }
    if (selRender) renderEditor();
    if (clicked && state.selectedObj === dm.oid) focusObjInList(dm.oid);
  }

  const ROBOT_RISK = ['CK (Hohes Risiko)', 'K (Hohes Risiko, nachbar SB)', 'C (Geringes Risiko)', 'BS (Bedienerschutz)', 'T (sichere Werkzeugumschaltung)', 'Kein Risiko'];
  const ROBOT_TECH = ['Punkt Schweißen - Stahl', 'MIG-Schweißen', 'Bolzen-Schweißen', 'Bolzen-Schweißen (Rotationskopf)', 'Bolzen (stationär)', 'Kleben', 'Laser', 'Halbholstanznieten', 'Fließlochschrauben', 'Inline messen'];
  // Farbe des Roboter-Icons je nach gewählter Safe-Funktion (rot = hohes Risiko … grün = kein Risiko)
  const ROBOT_RISK_COLOR = {
    'CK (Hohes Risiko)': '#DC2626',
    'K (Hohes Risiko, nachbar SB)': '#EA580C',
    'C (Geringes Risiko)': '#CA8A04',
    'BS (Bedienerschutz)': '#2563EB',
    'T (sichere Werkzeugumschaltung)': '#0D9488',
    'Kein Risiko': '#16A34A',
  };
  // Anzeigefarbe eines platzierten Symbols: Roboter richtet sich nach der Safe-Funktion, sonst Ebenenfarbe.
  function objIconColor(o) {
    if (o.symbolType === 'robot') {
      const sf = (o.metatags || []).find((m) => m.position === 1 || m.label === 'Safe Funktion');
      if (sf && ROBOT_RISK_COLOR[sf.value]) return ROBOT_RISK_COLOR[sf.value];
    }
    return o.color;
  }

  function tagFieldSelect(id, label, opts, val, required) {
    const list = (val && !opts.includes(val)) ? [val].concat(opts) : opts;
    const options = '<option value="">' + t('— bitte wählen —') + '</option>'
      + list.map((o) => '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    const req = required ? '<span class="m-req" title="' + t('Pflichtfeld') + '">*</span>' : '';
    const miss = (required && !(val && String(val).trim())) ? ' m-field-req' : '';
    return '<div class="m-field' + miss + '"><label>' + esc(label) + req + '</label><select id="' + id + '" data-label="' + esc(label) + '">' + options + '</select></div>';
  }
  // SPS-Bereich-Auswahl (nur Funktionsgruppen) – gleiche Optik wie die Schutzbereich-Zuordnung.
  function spsSelectField(o) {
    if (!o || o.symbolType !== 'fg_zone') return '';
    const plcs = state.detail.plcs || [];
    const cur = o.plcConfigId || '';
    const head = '<div class="m-field m-sps"><label>' + t('SPS-Bereich') + '</label>';
    if (!plcs.length) return head + '<div class="za-empty">' + t('Für diese Anlage sind noch keine SPS angelegt.') + '</div></div>';
    const none = '<button type="button" class="za-row m-sps-row' + (cur ? '' : ' sel') + '" data-plc="">'
      + '<span class="za-swatch za-swatch-none"></span><span class="za-name">' + t('Keine Zuordnung') + '</span><span class="za-check">✓</span></button>';
    const rows = plcs.map((p) => '<button type="button" class="za-row m-sps-row' + (cur === p.id ? ' sel' : '') + '" data-plc="' + esc(p.id) + '" data-color="' + esc(p.color) + '">'
      + '<span class="za-swatch" style="background:' + esc(p.color) + '"></span><span class="za-name">' + esc(p.name) + '</span><span class="za-check">✓</span></button>').join('');
    return head + '<div class="m-sps-list" id="mSpsList" data-plc="' + esc(cur) + '">' + none + rows + '</div></div>';
  }
  function tagFieldInput(id, label, val, dataLabel, editLabel) {
    const head = editLabel
      ? '<input class="m-lbl-edit" id="' + id + '_lbl" value="' + esc(label) + '" placeholder="Überschrift" title="Überschrift bearbeiten">'
      : '<label>' + esc(label) + '</label>';
    return '<div class="m-field">' + head + '<input id="' + id + '" data-label="' + esc(dataLabel || '') + '" placeholder="' + t('frei belegbar …') + '" value="' + esc(val) + '"></div>';
  }

  // Objektname im Metatag-Dialog: Name + Stift (nur canEdit). Klick auf Stift -> Inline-Eingabe.
  function renderModalTitle(oid) {
    const o = (state.detail.objects || []).find((x) => x.id === oid); if (!o) return;
    const mt = $('mTitle'); if (!mt) return;
    mt.innerHTML = '<span class="mtl-name">' + esc(o.name) + '</span>'
      + (canEdit() ? '<button class="mtl-edit" title="' + t('Umbenennen') + '" aria-label="' + t('Umbenennen') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' : '');
    const eb = mt.querySelector('.mtl-edit');
    if (eb) eb.addEventListener('click', () => startModalNameEdit(oid));
  }
  function startModalNameEdit(oid) {
    if (!canEdit()) return;
    const o = (state.detail.objects || []).find((x) => x.id === oid); if (!o) return;
    const mt = $('mTitle'); if (!mt) return;
    mt.innerHTML = '<input class="mtl-input" id="mtlInput" maxlength="60" value="' + esc(o.name) + '">';
    const inp = $('mtlInput'); if (!inp) return;
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const v = (inp.value || '').trim();
      if (v && v !== o.name) { try { await Api.updateObject(oid, { name: v }); o.name = v; renderEditor(); } catch (e) { toast(t('Umbenennen fehlgeschlagen')); } }
      renderModalTitle(oid);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); done = true; renderModalTitle(oid); } });
    inp.addEventListener('blur', commit);
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  }
  function openTagModal(oid) {
    const o = (state.detail.objects || []).find((x) => x.id === oid); if (!o) return;
    o.metatags = o.metatags || [];
    state.modalObjId = oid;
    const L = layerById(o.layerId);
    const sym = $('mSym'); sym.style.color = o.color; sym.innerHTML = symInner(o.symbolType, 24);
    renderModalTitle(oid);
    const _sub = L ? esc(L.code + ' · ' + L.name) : '';
    const _hsps = plcNameOf(o);
    $('mSub').innerHTML = _sub + (_hsps ? ' <span class="head-sps-chip"><span class="fgl-sps-k">SPS</span>' + esc(_hsps) + '</span>' : '');
    const v1 = (o.metatags.find((m) => m.position === 1) || {}).value || '';
    const v2 = (o.metatags.find((m) => m.position === 2) || {}).value || '';
    const pt = processTypeBySym(o.symbolType);
    if (pt) {
      const desc = (key) => (o.metatags.find((m) => m.label === key) || {}).value || '';
      const fieldFor = (kind, name) => {
        const key = kind + ' – ' + name;
        const ic = STATE_ICONS[name] ? '<img class="pt-ic" src="' + STATE_ICONS[name] + '" alt="">' : '<span class="pt-ic pt-ic-none"></span>';
        return '<div class="m-field pt-state"><label>' + ic + '<span class="pt-nm">' + esc(name) + '</span><span class="pt-kind ' + (kind === 'Pflicht' ? 'req' : 'opt') + '">' + t(kind) + '</span></label>'
          + '<input data-state="' + esc(key) + '" placeholder="Wann tritt das ein? …" value="' + esc(desc(key)) + '"></div>';
      };
      const groups = ptStateGroups(pt);
      const sectionFor = (g, withHeader) => {
        const items = g.muss.map((n) => fieldFor('Pflicht', n)).concat(g.opt.map((n) => fieldFor('Optional', n)));
        if (!items.length) return '';
        return (withHeader ? '<div class="pt-sec">' + esc(t(g.group)) + '</div>' : '') + items.join('');
      };
      const panelZ = sectionFor(groups[0], false) || '<div class="pt-empty">Keine Betriebszustände für diesen Prozesstyp.</div>';
      const panelM = (sectionFor(groups[1], true) + sectionFor(groups[2], true)) || '<div class="pt-empty">Keine Meldungen/Betriebsdaten für diesen Prozesstyp.</div>';
      const fgVal = (o.metatags.find((m) => m.label === 'Funktionsgruppen') || {}).value || '';
      const fgZones = (state.detail.objects || []).filter((z) => z.symbolType === 'fg_zone');
      let fgOpts = '<option value="">— keine —</option>';
      const fgNames = fgZones.map(fgName);
      if (fgVal && fgNames.indexOf(fgVal) < 0) fgOpts += '<option value="' + esc(fgVal) + '" selected>' + esc(fgVal) + '</option>';
      fgZones.forEach((z) => { const n = fgName(z); fgOpts += '<option value="' + esc(n) + '"' + (n === fgVal ? ' selected' : '') + '>' + esc(n) + '</option>'; });
      $('mBody').innerHTML = '<div class="pt-meta"><div class="pt-meta-row"><span>Funktionsgruppe</span><select id="mFg" class="pt-fg">' + fgOpts + '</select></div>'
        + '<div class="pt-meta-row"><span>Prozesstyp</span><b>' + esc(pt.ptyp) + '</b></div>'
        + '<div class="pt-meta-row"><span>Hardware · Art</span><b>' + esc(pt.hwart || '—') + '</b></div></div>'
        + '<div class="pt-tabs"><button class="pt-tab active" data-pttab="z">Betriebszustände</button>'
        + '<button class="pt-tab" data-pttab="m">Meldungen &amp; Betriebsdaten</button></div>'
        + '<div class="pt-hint">Beschreibe, wann der Zustand bzw. die Meldung eintritt.</div>'
        + '<div data-ptpanel="z">' + panelZ + '</div>'
        + '<div data-ptpanel="m" style="display:none">' + panelM + '</div>';
      $('mBody').querySelectorAll('[data-pttab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const t = btn.getAttribute('data-pttab');
          $('mBody').querySelectorAll('[data-pttab]').forEach((b) => b.classList.toggle('active', b === btn));
          $('mBody').querySelectorAll('[data-ptpanel]').forEach((p) => { p.style.display = p.getAttribute('data-ptpanel') === t ? '' : 'none'; });
        });
      });
    } else if (o.symbolType === 'robot') {
      $('mBody').innerHTML = tagFieldSelect('mTag1', 'Safe Funktion', ROBOT_RISK, v1, true) + tagFieldSelect('mTag2', 'Technologie', ROBOT_TECH, v2, true);
    } else if (/^custom:/.test(o.symbolType)) {
      const fields = symFields(o.symbolType);
      const edit = canManagePalette();
      $('mBody').innerHTML = fields.map((f, i) => {
        const mt = o.metatags.find((m) => m.position === i + 1) || {};
        const label = mt.label || f.label || ('Feld ' + (i + 1));
        const val = mt.value || '';
        const head = edit ? '<input class="m-lbl-edit" id="mTagF' + i + '_lbl" value="' + esc(label) + '" placeholder="Überschrift">' : '<label>' + esc(label) + '</label>';
        let inp;
        if (f.type === 'select') {
          const opts = f.options || [];
          const extra = (val && opts.indexOf(val) < 0) ? '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>' : '';
          inp = '<select id="mTagF' + i + '" class="m-select"><option value="">' + t('– bitte wählen –') + '</option>' + opts.map((op) => '<option value="' + esc(op) + '"' + (op === val ? ' selected' : '') + '>' + esc(op) + '</option>').join('') + extra + '</select>';
        } else if (f.type === 'multiselect') {
          const opts = f.options || [];
          const sel = val ? val.split(',').map((s) => s.trim()).filter(Boolean) : [];
          inp = '<div class="m-checks" id="mTagF' + i + '">' + (opts.length
            ? opts.map((op) => '<label class="m-check"><input type="checkbox" value="' + esc(op) + '"' + (sel.indexOf(op) >= 0 ? ' checked' : '') + '>' + esc(op) + '</label>').join('')
            : '<span class="m-empty">' + t('Keine Optionen konfiguriert') + '</span>') + '</div>';
        } else {
          inp = '<input id="mTagF' + i + '" placeholder="' + t('frei belegbar …') + '" value="' + esc(val) + '">';
        }
        return '<div class="m-field">' + head + inp + '</div>';
      }).join('');
    } else {
      const gl1 = (o.metatags.find((m) => m.position === 1) || {}).label || 'Metatag 1';
      const gl2 = (o.metatags.find((m) => m.position === 2) || {}).label || 'Metatag 2';
      $('mBody').innerHTML = spsSelectField(o) + tagFieldInput('mTag1', gl1, v1, gl1, canManagePalette()) + tagFieldInput('mTag2', gl2, v2, gl2, canManagePalette());
    }
    $('tagModal').style.display = 'flex';
    setTimeout(() => { const b = $('mBody'); if (!b) return; const f = b.querySelector('input:not(.m-lbl-edit):not([type=checkbox]):not([type=radio]), textarea') || b.querySelector('select'); if (f) { f.focus(); if (f.tagName === 'INPUT') f.select(); } }, 60);
  }
  async function saveTags() {
    const o = (state.detail.objects || []).find((x) => x.id === state.modalObjId);
    if (!o) { closeTagModal(); return; }
    pushUndo();
    // Funktionsgruppe: SPS-Bereich-Zuordnung aus der Swatch-Auswahl uebernehmen (analog Schutzbereich)
    const spsList = $('mSpsList');
    if (spsList && o.symbolType === 'fg_zone') {
      const newPlc = spsList.getAttribute('data-plc') || null;
      if ((o.plcConfigId || null) !== newPlc) {
        const plc = (state.detail.plcs || []).find((p) => p.id === newPlc);
        const L = layerById(o.layerId);
        o.plcConfigId = newPlc;
        o.color = newPlc ? ((plc && plc.color) || o.color) : (L ? L.color : o.color);
        try { protectObj(o.id); await Api.updateObject(o.id, { plcConfigId: newPlc, color: o.color }); } catch (e) { /* ignore */ }
      }
    }
    const pt = processTypeBySym(o.symbolType);
    let metatags;
    if (pt) {
      const fgSel = $('mFg');
      metatags = [
        { position: 0, label: 'Funktionsgruppen', value: fgSel ? fgSel.value : '' },
        { position: 1, label: 'Prozesstyp', value: pt.ptyp },
        { position: 2, label: 'Hardware · Art', value: pt.hwart },
      ];
      let pos = 3;
      $('mBody').querySelectorAll('input[data-state]').forEach((inp) => {
        metatags.push({ position: pos++, label: inp.getAttribute('data-state'), value: inp.value.trim() });
      });
    } else if (/^custom:/.test(o.symbolType)) {
      metatags = [];
      symFields(o.symbolType).forEach((f, i) => {
        const el = $('mTagF' + i); if (!el) return;
        const val = (el.tagName === 'DIV')
          ? Array.prototype.slice.call(el.querySelectorAll('input:checked')).map((c) => c.value).join(', ')
          : (el.value || '').trim();
        const lblEl = $('mTagF' + i + '_lbl');
        const label = lblEl ? lblEl.value.trim() : ((o.metatags.find((m) => m.position === i + 1) || {}).label || f.label || '');
        if (val || label) metatags.push(label ? { position: i + 1, label: label, value: val } : { position: i + 1, value: val });
      });
    } else {
      const e1 = $('mTag1'), e2 = $('mTag2');
      const t1 = e1 ? e1.value.trim() : '';
      const t2 = e2 ? e2.value.trim() : '';
      const lb1 = $('mTag1_lbl'), lb2 = $('mTag2_lbl');
      const l1 = lb1 ? lb1.value.trim() : (e1 ? (e1.getAttribute('data-label') || '') : '');
      const l2 = lb2 ? lb2.value.trim() : (e2 ? (e2.getAttribute('data-label') || '') : '');
      metatags = [];
      if (t1 || l1) metatags.push(l1 ? { position: 1, label: l1, value: t1 } : { position: 1, value: t1 });
      if (t2 || l2) metatags.push(l2 ? { position: 2, label: l2, value: t2 } : { position: 2, value: t2 });
    }
    protectObj(o.id); try { const upd = await Api.setMetatags(o.id, metatags); o.metatags = (upd && upd.metatags) || metatags; } catch (e) { toast(t('Metatags nicht gespeichert')); }
    closeTagModal(); toast(t('Metatags gespeichert')); renderEditor();
  }
  async function deletePlaced() {
    const oid = state.modalObjId; const o = (state.detail.objects || []).find((x) => x.id === oid);
    closeTagModal(); if (!o) return;
    pushUndo();
    try { await Api.deleteObject(oid); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    state.detail.objects = state.detail.objects.filter((x) => x.id !== oid);
    toast('Objekt gelöscht'); renderEditor();
  }
  // Wird ein SPS-Bereich geloescht, verlieren die daran haengenden FG/SB ihre Zuordnung (werden wieder grau).
  async function unlinkDependentsOf(delObj) {
    if (!delObj || delObj.symbolType !== 'sps_zone' || !delObj.plcConfigId) return 0;
    const plc = delObj.plcConfigId;
    const deps = (state.detail.objects || []).filter((o) => (o.symbolType === 'sb_zone' || o.symbolType === 'fg_zone') && o.plcConfigId === plc);
    for (const d of deps) { d.plcConfigId = null; try { await Api.updateObject(d.id, { plcConfigId: null }); } catch (e) { /* ignore */ } }
    return deps.length;
  }
  async function deleteObjectById(oid) {
    const o = (state.detail.objects || []).find((x) => x.id === oid);
    pushUndo();
    try { await Api.deleteObject(oid); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    state.detail.objects = state.detail.objects.filter((x) => x.id !== oid);
    const freed = await unlinkDependentsOf(o);
    toast('Objekt gelöscht' + (freed ? ' · ' + freed + ' Zuordnung(en) aufgehoben' : '')); renderEditor();
  }
  async function deleteCategoryObjects(catKey) {
    if (!canEdit()) return;
    const L = layerById(state.activeLayer); if (!L) return;
    const objs = (catKey === '__all__') ? objectsOfLayer(L.id) : objectsOfLayer(L.id).filter((o) => (o.categoryId || '_') === catKey);
    if (!objs.length) return;
    const label = (catKey === '__all__') ? (L.code + ' ' + t(L.name)) : (catKey === '_' ? t('Ohne Kategorie') : (((L.categories || []).find((c) => c.id === catKey) || {}).name || ''));
    if (!window.confirm('Wirklich alle ' + objs.length + ' Objekte in „' + label + '" löschen?')) return;
    pushUndo();
    const ids = objs.map((o) => o.id);
    const _delResults = await Promise.all(ids.map((id) => Api.deleteObject(id).then(() => true).catch(() => false)));
    const rm = {}; ids.forEach((id) => { rm[id] = true; });
    state.detail.objects = state.detail.objects.filter((x) => !rm[x.id]);
    for (const del of objs) { await unlinkDependentsOf(del); }
    const _delFailed = _delResults.filter((ok) => !ok).length; toast(_delFailed ? ((ids.length - _delFailed) + ' von ' + ids.length + ' gelöscht, ' + _delFailed + ' fehlgeschlagen') : (ids.length + ' Objekte gelöscht')); renderEditor();
  }
  function closeTagModal() { $('tagModal').style.display = 'none'; state.modalObjId = null; }
  // ---- Eigenes Palette-Symbol: Upload-Dialog ----
  function openSymUpload(editSym) {
    const w = currentWerk(); const L = layerById(state.activeLayer);
    if (!w || !L) { toast(t('Kein Werk / keine Ebene aktiv')); return; }
    state.symEdit = editSym || null;
    const isEdit = !!editSym;
    state.symFieldsDraft = (isEdit && editSym.fields && editSym.fields.length)
      ? editSym.fields.map((f) => ({ label: f.label || '', type: (f.type === 'select' || f.type === 'multiselect') ? f.type : 'text', options: (f.options || []).slice() }))
      : defaultCustomFields();
    const prev = isEdit && editSym.url ? '<img src="' + esc(editSym.url) + '" alt="">' : t('Bild wählen …');
    let m = document.getElementById('symModal');
    if (!m) { m = document.createElement('div'); m.id = 'symModal'; m.className = 'modal-backdrop'; document.body.appendChild(m); }
    m.innerHTML = '<div class="modal sym-modal">'
      + '<div class="m-head"><div><h3>' + (isEdit ? t('Symbol bearbeiten') : t('Eigenes Symbol')) + '</h3><p class="m-sub">' + esc(L.code + ' · ' + L.name) + ' · ' + esc(w.name) + '</p></div></div>'
      + '<div class="sym-body">'
      + '<label class="sym-lbl">' + t('Name') + '</label><input id="symName" class="sym-in" placeholder="' + t('z. B. Sondergreifer') + '" maxlength="40" value="' + (isEdit ? esc(editSym.name) : '') + '">'
      + '<label class="sym-lbl">' + (isEdit ? t('Bild ersetzen (optional)') : t('Bild (PNG, JPG oder SVG)')) + '</label>'
      + '<label class="sym-drop" for="symFile"><span id="symPrev">' + prev + '</span></label>'
      + '<input id="symFile" type="file" accept="image/png,image/jpeg,image/svg+xml" style="display:none">'
      + '<label class="sym-lbl">' + t('Metatag-Felder') + '</label><div id="symFields" class="sf-list"></div>'
      + '<div class="sym-msg" id="symMsg"></div></div>'
      + '<div class="m-foot"><button class="btn" id="symCancel">' + t('Abbrechen') + '</button><button class="btn primary" id="symSave">' + (isEdit ? t('Speichern') : t('Hochladen')) + '</button></div></div>';
    m.style.display = 'flex';
    const f = document.getElementById('symFile');
    f.addEventListener('change', () => { const file = f.files[0]; if (file) { const u = URL.createObjectURL(file); document.getElementById('symPrev').innerHTML = '<img src="' + u + '" alt="">'; } });
    const fc = document.getElementById('symFields');
    renderSymFieldsInto(fc);
    fc.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-symact]'); if (!btn) return;
      syncSymFields(fc);
      const act = btn.getAttribute('data-symact');
      if (act === 'field-add') state.symFieldsDraft.push({ label: '', type: 'text', options: [] });
      else if (act === 'field-del') state.symFieldsDraft.splice(+btn.getAttribute('data-i'), 1);
      renderSymFieldsInto(fc);
    });
    fc.addEventListener('change', (e) => { if (e.target.classList.contains('sf-type')) { syncSymFields(fc); renderSymFieldsInto(fc); } });
    document.getElementById('symCancel').addEventListener('click', closeSymModal);
    document.getElementById('symSave').addEventListener('click', saveSymUpload);
    m.addEventListener('click', (e) => { if (e.target === m) closeSymModal(); });
    setTimeout(() => { const n = document.getElementById('symName'); if (n) { n.focus(); n.select(); } }, 40);
  }
  function closeSymModal() { const m = document.getElementById('symModal'); if (m) m.style.display = 'none'; state.symEdit = null; }
  // Feldeditor im Symbol-Dialog
  function renderSymFieldsInto(container) {
    const draft = state.symFieldsDraft || [];
    container.innerHTML = draft.map((f, i) =>
      '<div class="sf-row" data-i="' + i + '">'
      + '<input class="sf-label" placeholder="' + t('Überschrift') + '" value="' + esc(f.label || '') + '">'
      + '<select class="sf-type"><option value="text"' + (f.type === 'text' || !f.type ? ' selected' : '') + '>' + t('Text') + '</option><option value="select"' + (f.type === 'select' ? ' selected' : '') + '>' + t('Auswahl') + '</option><option value="multiselect"' + (f.type === 'multiselect' ? ' selected' : '') + '>' + t('Mehrfachauswahl') + '</option></select>'
      + '<input class="sf-opts" placeholder="' + t('Optionen, mit Komma getrennt') + '" value="' + esc((f.options || []).join(', ')) + '"' + (f.type === 'select' || f.type === 'multiselect' ? '' : ' style="display:none"') + '>'
      + '<button type="button" class="sf-del" data-symact="field-del" data-i="' + i + '" title="' + t('Feld entfernen') + '">×</button>'
      + '</div>').join('')
      + '<button type="button" class="sf-add" data-symact="field-add">' + t('+ Feld') + '</button>';
  }
  function syncSymFields(container) {
    const draft = [];
    container.querySelectorAll('.sf-row').forEach((r) => {
      draft.push({
        label: r.querySelector('.sf-label').value.trim(),
        type: r.querySelector('.sf-type').value,
        options: r.querySelector('.sf-opts').value.split(',').map((s) => s.trim()).filter(Boolean),
      });
    });
    state.symFieldsDraft = draft;
  }
  // ---- Profil & Passwort ändern ----
  function openProfile() {
    let m = document.getElementById('profileModal');
    if (!m) { m = document.createElement('div'); m.id = 'profileModal'; m.className = 'modal-backdrop'; document.body.appendChild(m); }
    const email = (state.user && state.user.email) || '';
    const name = (state.user && (state.user.displayName || state.user.name)) || '';
    const grp = state.group ? state.group.name : '–';
    const tenant = $('tenantName').textContent || '–';
    m.innerHTML = '<div class="modal sym-modal profile-modal">'
      + '<div class="m-head pf-head"><div class="pf-avatar">' + esc(initials(email || name || '?')) + '</div>'
      + '<div class="pf-id"><h3>' + esc(name || email || t('Profil')) + '</h3><p class="m-sub">' + esc(email) + '</p></div></div>'
      + '<div class="sym-body">'
      + '<div class="pf-info">'
      + '<div class="pf-row"><span class="pf-k">' + t('Rolle') + '</span><span class="pf-v"><span class="pf-badge">' + esc(roleLabel(state.role)) + '</span></span></div>'
      + '<div class="pf-row"><span class="pf-k">' + t('Gruppe') + '</span><span class="pf-v">' + esc(grp) + '</span></div>'
      + '<div class="pf-row"><span class="pf-k">' + t('Mandant') + '</span><span class="pf-v">' + esc(tenant) + '</span></div>'
      + '</div>'
      + '<div class="pf-sec">' + t('Sprache') + '</div>'
      + '<div class="pf-lang">'
      + '<button class="pf-lang-btn' + (state.lang === 'de' ? ' active' : '') + '" data-lang="de">Deutsch</button>'
      + '<button class="pf-lang-btn' + (state.lang === 'en' ? ' active' : '') + '" data-lang="en">English</button>'
      + '</div>'
      + '<div class="pf-sec">' + t('Passwort ändern') + '</div>'
      + '<label class="sym-lbl">' + t('Aktuelles Passwort') + '</label><input id="pfOld" type="password" class="sym-in" autocomplete="current-password">'
      + '<label class="sym-lbl">' + t('Neues Passwort') + '</label><input id="pfNew" type="password" class="sym-in" autocomplete="new-password" placeholder="' + t('mind. 8 Zeichen') + '">'
      + '<label class="sym-lbl">' + t('Neues Passwort bestätigen') + '</label><input id="pfNew2" type="password" class="sym-in" autocomplete="new-password">'
      + '<div class="sym-msg" id="pfMsg"></div>'
      + '</div>'
      + '<div class="m-foot"><button class="btn" id="pfCancel">' + t('Schließen') + '</button><button class="btn primary" id="pfSave">' + t('Passwort speichern') + '</button></div></div>';
    m.style.display = 'flex';
    document.getElementById('pfCancel').addEventListener('click', closeProfile);
    document.getElementById('pfSave').addEventListener('click', saveProfilePw);
    m.querySelectorAll('.pf-lang-btn').forEach((b) => b.addEventListener('click', () => setLang(b.getAttribute('data-lang'))));
    m.addEventListener('click', (e) => { if (e.target === m) closeProfile(); });
    setTimeout(() => { const o = document.getElementById('pfOld'); if (o) o.focus(); }, 40);
  }
  async function setLang(lang) {
    if (lang === state.lang) return;
    const msg = document.getElementById('pfMsg'); if (msg) msg.textContent = t('Wird gespeichert …');
    try { await Api.setLanguage(lang); } catch (e) { if (msg) msg.textContent = (e.data && e.data.message) || 'Fehler'; return; }
    try { localStorage.setItem('promodx_lang', lang); } catch (e2) { /* noop */ }
    location.reload();
  }
  function closeProfile() { const m = document.getElementById('profileModal'); if (m) m.style.display = 'none'; }
  async function saveProfilePw() {
    const oldp = $('pfOld').value, np = $('pfNew').value, np2 = $('pfNew2').value; const msg = $('pfMsg');
    if (!oldp) { msg.textContent = t('Bitte das aktuelle Passwort eingeben.'); return; }
    if ((np || '').length < 8) { msg.textContent = t('Neues Passwort: mindestens 8 Zeichen.'); return; }
    if (np === oldp) { msg.textContent = t('Neues Passwort muss sich vom aktuellen unterscheiden.'); return; }
    if (np !== np2) { msg.textContent = t('Die neuen Passwörter stimmen nicht überein.'); return; }
    msg.textContent = t('Wird gespeichert …');
    try { await Api.changePassword(oldp, np); closeProfile(); toast(t('Passwort geändert')); }
    catch (e) { msg.textContent = (e.data && e.data.message) || ('Fehler: ' + (e.message || 'Änderung fehlgeschlagen')); }
  }
  async function saveSymUpload() {
    const w = currentWerk(); const L = layerById(state.activeLayer);
    const name = (document.getElementById('symName').value || '').trim();
    const file = document.getElementById('symFile').files[0];
    const msg = document.getElementById('symMsg');
    const edit = state.symEdit;
    if (!name) { msg.textContent = t('Bitte einen Namen eingeben.'); return; }
    if (!edit && !file) { msg.textContent = t('Bitte ein Bild wählen.'); return; }
    if (file && file.size > 2 * 1024 * 1024) { msg.textContent = t('Bild ist zu groß (max. 2 MB).'); return; }
    msg.textContent = edit ? t('Wird gespeichert …') : t('Wird hochgeladen …');
    const fc = document.getElementById('symFields'); if (fc) syncSymFields(fc);
    const fields = (state.symFieldsDraft || []).filter((f) => f.label).map((f) => ({ label: f.label, type: (f.type === 'select' || f.type === 'multiselect') ? f.type : 'text', options: (f.type === 'select' || f.type === 'multiselect') ? (f.options || []) : [] }));
    try {
      if (edit) { await Api.updatePaletteSymbol(edit.id, name, file || null, fields); }
      else { await Api.createPaletteSymbol(w.id, name, L.code, file, fields); }
      closeSymModal(); await loadCustomSyms(w.id, edit ? { force: true, refetch: (file ? { [edit.id]: true } : {}) } : { force: true }); renderEditor();
      toast(edit ? 'Symbol „' + name + '" aktualisiert' : 'Symbol „' + name + '" hinzugefügt');
    } catch (e) { msg.textContent = 'Fehler: ' + (e.message || 'Speichern fehlgeschlagen'); }
  }
  async function deleteCustomSym(id) {
    if (!window.confirm('Dieses eigene Symbol aus der Palette löschen?')) return;
    try { await Api.deletePaletteSymbol(id); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    const w = currentWerk(); await loadCustomSyms(w ? w.id : null, { force: true }); renderEditor(); toast(t('Symbol gelöscht'));
  }

  function triggerUpload() { $('layoutFile').click(); }
  async function onLayoutFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Bitte eine Bilddatei wählen'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('Bild zu groß (max. 8 MB)'); return; }
    if (!state.detail) { toast('Bitte zuerst eine Anlage wählen'); return; }
    if (state.uploadingLayout) { return; } // Doppel-Upload verhindern (Rate-Limit)
    state.uploadingLayout = true;
    toast('Layout wird hochgeladen …');
    try {
      await Api.uploadLayout(state.detail.id, f);
      state.detail.hasLayout = true;
      state.layoutBlobStation = null;
      await ensureLayoutBlob();
      toast('Layout hochgeladen');
      if (state.view === 'editor') renderEditor(); else renderDetail();
    } catch (e2) {
      const msg = /429|too many/i.test(e2 && e2.message ? e2.message : '') ? 'Zu viele Uploads in kurzer Zeit – bitte kurz warten und erneut versuchen.' : ('Upload fehlgeschlagen: ' + (e2 && e2.message ? e2.message : e2));
      toast(msg);
    } finally { state.uploadingLayout = false; }
  }

  let _h2cPromise = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'js/html2canvas.min.js?v=1.2.13';
      sc.onload = () => resolve(window.html2canvas);
      sc.onerror = () => { _h2cPromise = null; reject(new Error('html2canvas nicht geladen')); };
      document.head.appendChild(sc);
    });
    return _h2cPromise;
  }
  // Nimmt die gerenderte Modellierung (#canvasDoc) 1:1 als PNG auf – fuer ein PDF, das exakt der App-Ansicht entspricht.
  async function captureMapImage() {
    const el = document.getElementById('canvasDoc');
    if (!el) throw new Error('Editor-Ansicht (canvasDoc) nicht gefunden');
    const h2c = await loadHtml2Canvas();
    if (typeof h2c !== 'function') throw new Error('html2canvas nicht verfuegbar');
    const prevTransform = el.style.transform;
    el.style.transform = 'none'; // Zoom fuer die Aufnahme neutralisieren
    try {
      const rect = el.getBoundingClientRect();
      const scale = Math.max(1, Math.min(3, 1600 / Math.max(1, rect.width)));
      // Roboter-Maske (grau: weisse Form auf schwarz = Luminanz-Maske) einmalig in eine Alpha-Maske umwandeln.
      let alphaMask = null, mw = 24, mh = 24;
      try {
        const maskImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('mask')); im.src = new URL('img/robot-mask.png', location.href).href; });
        mw = maskImg.naturalWidth || 24; mh = maskImg.naturalHeight || 24;
        const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
        const mx = mc.getContext('2d'); mx.drawImage(maskImg, 0, 0, mw, mh);
        const mid = mx.getImageData(0, 0, mw, mh); const md = mid.data;
        for (let i = 0; i < md.length; i += 4) { const lum = (md[i] + md[i + 1] + md[i + 2]) / 3; md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = lum; }
        mx.putImageData(mid, 0, 0); alphaMask = mc;
      } catch (e) { alphaMask = null; }
      const tintCache = {};
      const tintedRobot = function (color) {
        if (!alphaMask) return null;
        if (tintCache[color]) return tintCache[color];
        const c = document.createElement('canvas'); c.width = mw; c.height = mh;
        const cc = c.getContext('2d');
        cc.fillStyle = color; cc.fillRect(0, 0, mw, mh);
        cc.globalCompositeOperation = 'destination-in'; cc.drawImage(alphaMask, 0, 0);
        return (tintCache[color] = c.toDataURL('image/png'));
      };
      const canvas = await h2c(el, {
        scale: scale, backgroundColor: '#ffffff', useCORS: true, allowTaint: false, logging: false,
        onclone: function (doc) {
          try {
            // Editier-Raster (Snap-/Zeichenraster) nicht ins PDF aufnehmen
            doc.querySelectorAll('.snap-grid, .draw-grid').forEach(function (el) { el.style.display = 'none'; });
            const vw = doc.defaultView || window;
            doc.querySelectorAll('rect').forEach(function (r) {
              if ((r.getAttribute('mask') || '').indexOf('robotMask') < 0) return;
              let col = '#ffffff';
              try { const cs = vw.getComputedStyle(r); col = (cs.fill && cs.fill !== 'none' && cs.fill !== 'currentcolor') ? cs.fill : (cs.color || '#ffffff'); } catch (e) { /* ignore */ }
              const data = tintedRobot(col); if (!data) return;
              const img = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
              img.setAttribute('x', '0'); img.setAttribute('y', '0'); img.setAttribute('width', '24'); img.setAttribute('height', '24');
              img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', data); img.setAttribute('href', data);
              if (r.parentNode) r.parentNode.replaceChild(img, r);
            });
          } catch (e) { /* ignore */ }
        },
      });
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl || dataUrl.length < 100) throw new Error('leeres Bild erzeugt');
      return dataUrl;
    } finally {
      el.style.transform = prevTransform;
    }
  }
  async function exportFile(kind) {
    try {
      if (kind === 'pdf') {
        toast('PDF wird erstellt …');
        let mapImage = null;
        try { mapImage = await captureMapImage(); }
        catch (e) { toast('Modellierung nicht aufgenommen: ' + (e && e.message ? e.message : e)); }
        const res = await Api.raw('/stations/' + state.detail.id + '/export.pdf', { method: 'POST', body: { mapImage: mapImage } });
        if (!res.ok) { toast(t('Export fehlgeschlagen')); return; }
        const url = URL.createObjectURL(await res.blob());
        const fn = (state.detail.anlagenname || 'Anlage').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'Anlage';
        const a = document.createElement('a'); a.href = url; a.download = fn + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      const res = await Api.raw('/stations/' + state.detail.id + '/export.' + kind);
      if (!res.ok) { toast(t('Export fehlgeschlagen')); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = (state.detail.anlagenname || 'anlage').replace(/[^A-Za-z0-9_\-]+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(t('Export fehlgeschlagen')); }
  }

  // Editor-spezifische Content-Handler (Drag & Drop, Move, Doppelklick)
  function onContentDragStart(e) {
    const p = e.target.closest('.pal-item'); if (!p) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ sym: p.getAttribute('data-sym'), name: p.getAttribute('data-name'), color: p.getAttribute('data-color') }));
    e.dataTransfer.effectAllowed = 'copy';
  }
  function onContentDragOver(e) { const doc = e.target.closest('#canvasDoc'); if (doc) { e.preventDefault(); doc.classList.add('drop-hi'); } }
  function onContentDragLeave(e) { const doc = e.target.closest('#canvasDoc'); if (doc) doc.classList.remove('drop-hi'); }
  function onContentDrop(e) {
    if (!canEdit()) return;
    const doc = e.target.closest('#canvasDoc'); if (!doc) return;
    e.preventDefault(); doc.classList.remove('drop-hi');
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return; }
    if (data && data.sym) placeFromDrop(e.clientX, e.clientY, data.sym, data.name, data.color);
  }
  function onContentDblClick(e) {
    if (!canEdit() || state.drawZone) return;
    const pl = e.target.closest('.placed');
    if (pl) { e.preventDefault(); openTagModal(pl.getAttribute('data-obj')); }
  }

