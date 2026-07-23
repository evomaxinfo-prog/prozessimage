  // Platzieren zeigt das Symbol SOFORT an (optimistisch) und laesst den Server im Hintergrund
  // nachziehen. Vorher erschien es erst nach der Anlege-Antwort - bei Prozesstypen sogar erst
  // nach einem zweiten Aufruf fuer die Metadaten, was sich wie eine lange Verzoegerung anfuehlte.
  // Weil das Objekt sofort im Zustand steht, sieht auch der naechste Undo-Punkt es bereits -
  // die frueher noetige Serialisierung entfaellt, schnelles Platzieren ist wieder fluessig.
  async function placeFromDrop(clientX, clientY, sym, name, color) {
    const doc = document.getElementById('canvasDoc'); if (!doc || !state.detail) return;
    const sid = state.detail.id; // Anlage merken: nach den Await-Punkten kann eine andere offen sein
    const stillHere = () => !!state.detail && state.detail.id === sid;
    const r = doc.getBoundingClientRect();
    let x = Math.min(0.97, Math.max(0.03, (clientX - r.left) / r.width));
    let y = Math.min(0.96, Math.max(0.04, (clientY - r.top) / r.height));
    if (state.snapGrid) { x = Math.min(0.97, Math.max(0.03, snapToGrid(x))); y = Math.min(0.96, Math.max(0.04, snapToGrid(y))); }
    const L = layerById(state.activeLayer);
    const base = (name || 'Objekt').replace(/\s+/g, '_');
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === sym).length + 1).padStart(2, '0');
    const tmpId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const local = {
      id: tmpId, layerId: L.id, categoryId: null, name: base + '_' + num, symbolType: sym,
      color: color || L.color, x, y, rotation: 0, scale: 1, visible: true, points: null,
      plcConfigId: null, metatags: [],
    };
    pushUndo();
    state.detail.objects.push(local);
    protectObj(tmpId); // schuetzt das noch unbestaetigte Objekt vor dem Abgleich
    renderEditor();
    const finishPending = trackPendingOp(); // Undo/Redo wartet, bis das Anlegen durch ist
    try {
      const obj = await Api.createObject(sid, { layerId: L.id, name: local.name, symbolType: sym, color: local.color, x, y });
      obj.metatags = obj.metatags || [];
      let cur = null;
      if (stillHere()) { // sonst wuerde der Eintrag in einer INZWISCHEN GEOEFFNETEN anderen Anlage landen
        remapId(tmpId, obj.id); protectObj(obj.id); // vorlaeufige ID ueberall durch die echte ersetzen
        cur = (state.detail.objects || []).find((o) => o.id === obj.id);
        // Dauerte das Anlegen laenger als der Schutz (6 s), hat der Abgleich das vorlaeufige
        // Objekt inzwischen weggeraeumt - dann den bestaetigten Stand wieder aufnehmen.
        if (!cur) { cur = Object.assign({}, obj); state.detail.objects.push(cur); }
        else Object.assign(cur, obj);
      }
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
          if (cur) cur.metatags = (upd && upd.metatags) || tags;
          if (fg) toast(name + ' → Funktionsgruppe „' + fg + '" zugeordnet');
          else toast(name + ' ' + t('platziert'));
        } catch (e2) { toast(name + ' ' + t('platziert')); }
      } else if (/^custom:/.test(sym)) {
        const tags = symFields(sym).map((f, i) => ({ position: i + 1, label: f.label, value: '' }));
        try { const upd = await Api.setMetatags(obj.id, tags); if (cur) cur.metatags = (upd && upd.metatags) || tags; } catch (e2) { if (cur) cur.metatags = tags; }
        toast(name + ' ' + t('platziert'));
      } else { toast(name + ' ' + t('platziert')); }
      if (sym === 'robot' && state.layoutBlobUrl && stillHere()) promptLearnTemplate(x, y);
      if (stillHere()) renderEditor();
    } catch (e) {
      // Anlegen fehlgeschlagen -> vorlaeufiges Objekt wieder entfernen
      if (stillHere()) {
        state.detail.objects = (state.detail.objects || []).filter((o) => o.id !== tmpId);
        renderEditor();
      }
      toast('Platzieren fehlgeschlagen: ' + e.message);
    } finally { finishPending(); }
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
    const p = document.getElementById('zone-poly-' + id);
    if (p) p.classList.toggle('zone-hover', on && !isRoute); // Routen bekommen kein Hover-Highlight
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
      if (td.moved && o) { o.points = [{ x: td.fx, y: td.fy }]; if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; } protectObj(o.id); try { await Api.updateObject(o.id, { points: o.points }); } catch (e2) { toast(t('Position nicht gespeichert')); } }
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
        } catch (e2) { toast(t('Position nicht gespeichert')); }
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
