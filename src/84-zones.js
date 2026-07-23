  function openZoneAssignModal(zoneId) {
    closeZoneModal();
    const z = (state.detail.objects || []).find((o) => o.id === zoneId); if (!z) return;
    const isSps = z.symbolType === 'sps_zone';
    const plcs = state.detail.plcs || [];
    const cur = z.plcConfigId || null;
    // 1:1 – SPS, die bereits einem ANDEREN SPS-Bereich zugeordnet sind, sperren
    const usedBy = {};
    if (isSps) (state.detail.objects || []).forEach((o) => { if (o.symbolType === 'sps_zone' && o.id !== zoneId && o.plcConfigId) usedBy[o.plcConfigId] = o; });
    const rows = plcs.length
      ? plcs.map((p) => {
          const taken = isSps && !!usedBy[p.id];
          return '<button class="za-row ' + (cur === p.id ? 'sel ' : '') + (taken ? 'taken' : '') + '"'
            + (taken ? ' disabled' : ' data-plc="' + p.id + '" data-color="' + esc(p.color) + '"') + '>'
            + '<span class="za-swatch" style="background:' + esc(p.color) + '"></span><span class="za-name">' + esc(p.name) + '</span>'
            + (cur === p.id ? '<span class="za-check">✓</span>' : (taken ? '<span class="za-taken">bereits belegt</span>' : '')) + '</button>';
        }).join('')
      : '<div class="za-empty">Für diese Anlage sind noch keine SPS angelegt. Lege sie in der Detailansicht an (EDITIEREN › SPS hinzufügen).</div>';
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card" role="dialog" aria-modal="true" aria-label="SPS-Zuordnung">'
      + '<div class="za-head"><div><div class="za-title">' + (isSps ? 'SPS-Bereich zuordnen' : 'Schutzbereich zuordnen') + '</div><div class="za-sub">' + esc(z.name) + (isSps ? ' · genau eine SPS (1:1)' : '') + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen" aria-label="Schließen">×</button></div>'
      + '<div class="za-body">' + rows + '</div>'
      + '<div class="za-foot"><button class="btn ' + (cur ? 'del-btn' : '') + '" data-za="none">Keine Zuordnung</button>'
      + '<button class="btn" data-za="close">Schließen</button></div></div></div>';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('zaBackdrop');
    bd.addEventListener('mousedown', (ev) => { bd._downBackdrop = (ev.target.id === 'zaBackdrop'); });
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'zaBackdrop') { if (bd._downBackdrop) closeZoneModal(); bd._downBackdrop = false; return; }
      const za = ev.target.closest('[data-za]');
      if (za) { const a = za.getAttribute('data-za'); if (a === 'close') { closeZoneModal(); } else if (a === 'none') { assignZone(zoneId, null, null); } return; }
      const row = ev.target.closest('.za-row');
      if (row) assignZone(zoneId, row.getAttribute('data-plc'), row.getAttribute('data-color'));
    });
  }
  function closeZoneModal() { const b = document.getElementById('zaBackdrop'); if (b) b.remove(); }
  async function assignZone(zoneId, plcId, plcColor) {
    const z = (state.detail.objects || []).find((o) => o.id === zoneId); if (!z) { closeZoneModal(); return; }
    if (z.symbolType === 'sps_zone' && plcId) {
      const clash = (state.detail.objects || []).find((o) => o.symbolType === 'sps_zone' && o.id !== zoneId && o.plcConfigId === plcId);
      if (clash) { toast('Diese SPS ist bereits einem anderen SPS-Bereich zugeordnet'); return; }
    }
    pushUndo();
    const L = layerById(z.layerId);
    const color = plcId ? (plcColor || z.color) : (L ? L.color : z.color);
    try {
      protectObj(zoneId);
      await Api.updateObject(zoneId, { plcConfigId: plcId, color });
      z.plcConfigId = plcId || null; z.color = color;
      toast(plcId ? 'SPS zugeordnet' : 'Zuordnung entfernt');
    } catch (e) { toast('Zuordnung fehlgeschlagen'); }
    closeZoneModal(); renderEditor();
  }

  function openRouteModal(routeId) {
    closeZoneModal();
    const z = (state.detail.objects || []).find((o) => o.id === routeId); if (!z) return;
    const art = routeArt(z);
    const mat = routeMaterial(z);
    const bez = ((z.metatags || []).find((m) => m.label === 'Bezeichnung') || {}).value || '';
    const col = (layerById(z.layerId) || {}).color || '#0FA47F';
    const opts = '<option value="">' + t('— bitte wählen —') + '</option>'
      + ROUTE_ARTS.map((a) => '<option value="' + esc(a) + '"' + (a === art ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    const matOpts = '<option value="">— ohne —</option>'
      + FLOW_TYPES.map((f) => '<option value="' + esc(f.name) + '"' + (f.name === mat ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card" role="dialog" aria-modal="true" aria-label="SPS-Zuordnung">'
      + '<div class="za-head"><div><div class="za-title">Förderweg</div><div class="za-sub">' + esc(z.name) + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen" aria-label="Schließen">×</button></div>'
      + '<div class="za-body" style="display:flex;flex-direction:column;gap:12px;padding:16px">'
      + '<div class="m-field"><label>Materialfluss-Typ (Farbe)</label><select id="rfMat">' + matOpts + '</select></div>'
      + '<div class="m-field"><label>Förderart (Linienstil)</label><select id="rfArt">' + opts + '</select></div>'
      + '<div class="m-field"><label>Bezeichnung / Teil</label><input id="rfBez" placeholder="z. B. Karosserie-Seitenteil" value="' + esc(bez) + '"></div>'
      + '<button class="btn" data-za="reverse" style="justify-content:flex-start">⇄ Flussrichtung umkehren</button>'
      + '</div>'
      + '<div class="za-foot"><button class="btn" data-za="close">Abbrechen</button>'
      + '<button class="btn" data-za="save" style="background:' + esc(col) + ';border-color:' + esc(col) + ';color:#fff">Speichern</button></div></div></div>';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('zaBackdrop');
    bd.addEventListener('mousedown', (ev) => { bd._downBackdrop = (ev.target.id === 'zaBackdrop'); });
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'zaBackdrop') { if (bd._downBackdrop) closeZoneModal(); bd._downBackdrop = false; return; }
      const za = ev.target.closest('[data-za]'); if (!za) return;
      const a = za.getAttribute('data-za');
      if (a === 'close') closeZoneModal();
      else if (a === 'reverse') reverseRoute(routeId);
      else if (a === 'save') saveRoute(routeId);
    });
    setTimeout(() => { const s = document.getElementById('rfArt'); if (s) s.focus(); }, 60);
  }
  async function saveRoute(routeId) {
    const z = (state.detail.objects || []).find((o) => o.id === routeId); if (!z) { closeZoneModal(); return; }
    const art = (document.getElementById('rfArt') || {}).value || '';
    const mat = (document.getElementById('rfMat') || {}).value || '';
    const bez = ((document.getElementById('rfBez') || {}).value || '').trim();
    const metatags = [];
    if (art) metatags.push({ position: 1, label: 'Förderart', value: art });
    if (bez) metatags.push({ position: 2, label: 'Bezeichnung', value: bez });
    if (mat) metatags.push({ position: 3, label: 'Materialart', value: mat });
    protectObj(z.id);
    pushUndo(); // Förderweg-Daten/-Farbe waren bisher kein eigener Undo-Schritt
    try {
      const upd = await Api.setMetatags(z.id, metatags); z.metatags = (upd && upd.metatags) || metatags;
      // Farbe aus dem Materialfluss-Typ übernehmen
      const nc = flowColor(mat);
      if (nc && nc !== z.color) { await Api.updateObject(z.id, { color: nc }); z.color = nc; }
      toast('Förderweg gespeichert');
    }
    catch (e) { toast('Speichern fehlgeschlagen'); }
    closeZoneModal(); renderEditor();
  }
  async function reverseRoute(routeId) {
    const z = (state.detail.objects || []).find((o) => o.id === routeId);
    if (!z || !z.points || z.points.length < 2) return;
    pushUndo();
    z.points = z.points.slice().reverse();
    protectObj(z.id);
    try { await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }); }
    catch (e) { toast('Richtung nicht gespeichert'); }
    toast('Flussrichtung umgekehrt'); renderEditor();
  }

  function onContentPointerDown(e) {
    if (!canEdit()) return;
    // Sicherheitsnetz: einen evtl. haengengebliebenen Pan-Zustand vor jeder neuen Interaktion aufraeumen,
    // damit endMove nicht faelschlich im Pan-Zweig austeigt (sonst bliebe der Ebenenwechsel beim Greifen aus).
    if (state.panDrag) { cleanupStuckPan(); }
    // Zonen zeichnen: schon beim Aufsetzen einrasten + Snap-Ring zeigen (auch Touch / Klick ohne vorherige Bewegung).
    if (state.drawZone && e.target.closest('#canvasDoc')) {
      const doc0 = document.getElementById('canvasDoc');
      if (doc0) { const r = doc0.getBoundingClientRect(); const cxr = clamp01((e.clientX - r.left) / r.width), cyr = clamp01((e.clientY - r.top) / r.height); const sn = snapCursor(cxr, cyr); state.zoneCursor = { x: sn.x, y: sn.y }; state.zoneAlign = { x: sn.ax, y: sn.ay }; state.zoneSnap = sn.dock ? { x: sn.x, y: sn.y } : null; updateDraftDom(); }
    }
    // Kommentar-Fenster an der Kopfzeile verschieben (nicht auf X/Löschen)
    const cwh = e.target.closest('.cw-head');
    if (cwh && !e.target.closest('.cw-x, .cw-del')) {
      const win = cwh.closest('.comment-window'), doc0 = document.getElementById('canvasDoc');
      if (win && doc0) {
        e.preventDefault();
        const dr = doc0.getBoundingClientRect(), wr = win.getBoundingClientRect();
        state.cwDrag = { id: state.openComment, offx: e.clientX - wr.left, offy: e.clientY - wr.top, docW: dr.width, docH: dr.height, docL: dr.left, docT: dr.top };
        try { win.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      return;
    }
    // Kommentar-Nadel verschieben (Ziehen) bzw. bei Klick ohne Bewegung öffnen
    const pin = e.target.closest('.comment-pin');
    if (pin) {
      const doc0 = document.getElementById('canvasDoc');
      if (doc0) {
        e.preventDefault();
        const dr = doc0.getBoundingClientRect();
        state.pinDrag = { id: pin.getAttribute('data-id'), docL: dr.left, docT: dr.top, docW: dr.width, docH: dr.height, sx: e.clientX, sy: e.clientY, moved: false };
        try { pin.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      return;
    }
    // Klicks auf interaktive Overlays (Kommentar-Fenster/-Nadel, Vorschläge, Lern-/Vorlagen-UI)
    // nicht zur Zonen-Auswahl/Verschiebung durchschlagen lassen.
    if (e.target.closest('.comment-window, .comment-pin, .robot-sugg-layer, .learn-prompt, .pt-sugg-layer, .tpl-panel')) return;
    // Technologie-Blase greifen
    const td = e.target.closest('[data-techdrag]');
    if (td) { e.preventDefault(); state._preDrag = snapObjects(); state.techDrag = { id: td.getAttribute('data-techdrag'), moved: false }; protectObj(td.getAttribute('data-techdrag')); try { td.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    // Mittelpunkt-Handle: neuen Stützpunkt an der Kante einfügen (danach frei ziehbar)
    const mid = e.target.closest('.zone-midpoint');
    if (mid) {
      e.preventDefault();
      const zid = mid.getAttribute('data-zone'), eidx = +mid.getAttribute('data-eidx');
      const z = (state.detail.objects || []).find((o) => o.id === zid);
      if (z && z.points) {
        const p = z.points[eidx], q = z.points[(eidx + 1) % z.points.length];
        pushUndo();
        z.points.splice(eidx + 1, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        protectObj(z.id);
        state.geomPending[z.id] = { points: z.points.map(function (pp) { return { x: pp.x, y: pp.y }; }), ts: Date.now() };
        Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }).catch(function () { toast(t('Position nicht gespeichert')); });
        renderEditor();
      }
      return;
    }
    // Stützpunkt eines Schutzbereichs greifen
    const v = e.target.closest('.zone-vertex');
    if (v) {
      e.preventDefault();
      state._preDrag = snapObjects();
      state.zoneDrag = { type: 'vertex', id: v.getAttribute('data-zone'), idx: +v.getAttribute('data-vidx'), moved: false };
      try { v.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    // Frei platziertes Zustands-Icon greifen
    const si = e.target.closest('.state-icon');
    if (si) {
      e.preventDefault();
      const doc = e.target.closest('#canvasDoc');
      state._preDrag = snapObjects();
      state.iconDrag = { oid: si.getAttribute('data-sicon-parent'), st: si.getAttribute('data-sicon-state'), el: si, moved: false, nx: null, ny: null };
      try { (doc || si).setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    // Symbol verschieben
    // Skalier-Anfasser der Mehrfachauswahl
    const sh = e.target.closest('[data-scalehandle]');
    if (sh) { startScaleDrag(e); return; }
    const pl = e.target.closest('.placed');
    if (pl) {
      const oid = pl.getAttribute('data-obj');
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelObj(oid); renderEditor(); return; }
      if (state.selObjs && state.selObjs.length > 1 && state.selObjs.indexOf(oid) >= 0) { startGroupDrag(e); return; }
      if (state.selObjs && state.selObjs.length) { state.selObjs = []; }
      // Ebene des Objekts sofort aktiv setzen (robust – wie bei Zonen, unabhaengig von Klick/Bewegung/Render-Timing).
      {
        const _o = (state.detail.objects || []).find((x) => x.id === oid);
        let oNeedRender = false;
        if (state.selectedObj !== oid) { state.selectedObj = oid; oNeedRender = true; }
        if (_o && _o.layerId && layerById(_o.layerId) && state.activeLayer !== _o.layerId) { state.activeLayer = _o.layerId; oNeedRender = true; }
        if (oNeedRender) renderEditor();
      }
      startMove(e, oid); return;
    }
    // Schutzbereich auswählen / verschieben (nicht im Zeichenmodus)
    if (!state.drawZone) {
      const doc = e.target.closest('#canvasDoc');
      if (doc) {
        const r = doc.getBoundingClientRect();
        const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
        const z = zoneAt(x, y);
        if (z) {
          // Jedes Ziehen verschiebt direkt; ein reiner Klick (keine Bewegung) wählt nur aus.
          state._preDrag = snapObjects();
          state.zoneDrag = { type: 'move', id: z.id, sx: x, sy: y, moved: false, orig: z.points.map((p) => ({ x: p.x, y: p.y })) };
          try { doc.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
          // Ebene der Zone sofort aktiv setzen (robust – unabhaengig von Klick/Bewegung/Render-Timing).
          let zNeedRender = false;
          if (state.selectedObj || (state.selObjs && state.selObjs.length)) { state.selectedObj = null; state.selObjs = []; zNeedRender = true; }
          if (state.selectedZone !== z.id) { state.selectedZone = z.id; zNeedRender = true; }
          if (z.layerId && layerById(z.layerId) && state.activeLayer !== z.layerId) { state.activeLayer = z.layerId; zNeedRender = true; }
          if (zNeedRender) renderEditor();
        } else {
          // Leere Fläche: Ziehen verschiebt das ganze Layout samt Objekten (Pan). Fokus eines zuvor
          // bearbeiteten Icons/Polygons dabei loesen (reiner Klick hebt die Auswahl ebenfalls auf).
          e.preventDefault();
          if (state.selectedObj || state.selectedZone || (state.selObjs && state.selObjs.length)) { deselectFast(); }
          const pdoc = document.getElementById('canvasDoc') || doc; // re-query: bei selektierter Zone kann deselectFast voll gerendert haben
          const z0 = state.zoom || 1;
          state.panDrag = { sx: e.clientX, sy: e.clientY, px0: state.panX || 0, py0: state.panY || 0, moved: false, doc: pdoc, dw: pdoc.offsetWidth * z0, dh: pdoc.offsetHeight * z0, z: z0, raf: 0 };
          pdoc.style.cursor = 'grabbing'; pdoc.style.transition = 'none'; pdoc.style.willChange = 'transform';
        }
      }
    }
  }

  // Snapping beim Verschieben eines ganzen Polygons: liefert einen Offset, der den naechstliegenden
  // Eckpunkt auf eine gleichartige Ecke (Vorrang) bzw. Kante legt - so rastet es z. B. wieder am Ursprung ein.
  function snapMovedPolygon(z, pts) {
    const dt = z.symbolType, ar = docAspect(), vth = 0.03, eth = 0.025;
    const targets = (state.detail.objects || []).filter((o) => o.id !== z.id && o.symbolType === dt && o.points && o.points.length >= 2);
    if (!targets.length) return null;
    let bV = null, bVD = vth, bE = null, bED = eth;
    pts.forEach((p) => {
      const pxx = p.x * ar, pyy = p.y;
      targets.forEach((o) => {
        const tp = o.points, n = tp.length;
        for (let i = 0; i < n; i++) {
          const a = tp[i];
          const dv = Math.hypot((p.x - a.x) * ar, p.y - a.y); if (dv < bVD) { bVD = dv; bV = { x: a.x - p.x, y: a.y - p.y }; }
          if (n >= 3) {
            const b = tp[(i + 1) % n];
            const axx = a.x * ar, ayy = a.y, dxx = b.x * ar - axx, dyy = b.y - ayy, l2 = dxx * dxx + dyy * dyy;
            let t = l2 ? ((pxx - axx) * dxx + (pyy - ayy) * dyy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = (axx + t * dxx) / ar, qy = ayy + t * dyy, de = Math.hypot((p.x - qx) * ar, p.y - qy);
            if (de < bED) { bED = de; bE = { x: qx - p.x, y: qy - p.y }; }
          }
        }
      });
    });
    return bV || bE;
  }
  function onZoneDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    const z = (state.detail.objects || []).find((o) => o.id === state.zoneDrag.id); if (!z) return;
    if (state.zoneDrag.type === 'vertex') {
      z.points[state.zoneDrag.idx] = { x, y }; state.zoneDrag.moved = true; updateZoneDom(z);
    } else if (state.zoneDrag.type === 'move') {
      const dx = x - state.zoneDrag.sx, dy = y - state.zoneDrag.sy;
      if (!state.zoneDrag.moved && Math.hypot(dx * r.width, dy * r.height) < 4) return;
      state.zoneDrag.moved = true;
      let mpts = state.zoneDrag.orig.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
      const off = snapMovedPolygon(z, mpts);
      if (off) mpts = mpts.map((p) => ({ x: clamp01(p.x + off.x), y: clamp01(p.y + off.y) }));
      z.points = mpts;
      updateZoneDom(z); highlightDropTarget(z);
      const _pel = document.getElementById('zone-poly-' + z.id);
      if (_pel) _pel.setAttribute('stroke', off ? '#16A34A' : esc(zoneColor(z)));
    } else if (state.zoneDrag.type === 'select') {
      const dx = x - state.zoneDrag.sx, dy = y - state.zoneDrag.sy;
      if (Math.hypot(dx * r.width, dy * r.height) >= 4) state.zoneDrag.moved = true;
    }
  }

  function zoneColor(z) {
    if (z.plcConfigId) {
      const p = (state.detail.plcs || []).find((x) => x.id === z.plcConfigId);
      if (p && p.color) return p.color;
    }
    // SB/FG ohne SPS-Zuordnung: neutral grau - die Farbe kommt erst mit der Zuordnung vom SPS-Bereich.
    if (z.symbolType === 'sb_zone' || z.symbolType === 'fg_zone') return '#9AA7B2';
    return z.color;
  }

  // Name/Label einer Funktionsgruppe: erster gesetzter Metatag, sonst der Objektname.
  const fgName = window.PMX.fgName;
  // Funktionsgruppen-Zone, in der der Punkt (x,y) liegt (oberste), sonst null.
  function fgZoneAt(x, y) {
    const visible = visibleMap();
    const zs = (state.detail.objects || []).filter((o) => o.symbolType === 'fg_zone' && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    for (let i = zs.length - 1; i >= 0; i--) { if (pointInZone(zs[i], x, y)) return zs[i]; }
    return null;
  }
  function detectFgName(x, y) { const z = fgZoneAt(x, y); return z ? fgName(z) : ''; }
  // fg_zone-ID, die hervorgehoben werden soll, wenn ein zugeordneter Prozesstyp ausgewählt ist.
  function highlightedFgZoneId() {
    if (!state.selectedObj) return null;
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === state.selectedObj);
    if (!o || !/^ptk_/.test(o.symbolType)) return null;
    const mt = (o.metatags || []).find((m) => m.label === 'Funktionsgruppen');
    const fgv = mt && mt.value && String(mt.value).trim();
    if (!fgv) return null;
    const z = (state.detail.objects || []).find((x) => x.symbolType === 'fg_zone' && fgName(x) === fgv);
    return z ? z.id : null;
  }
  const zoneCentroid = window.PMX.zoneCentroid;
  // Bounding-Box + Flaeche (Prozent der Layoutflaeche) eines Polygons/Drafts.
  const polyMetrics = window.PMX.polyMetrics;
  const fmtMetrics = window.PMX.fmtMetrics;
  // SPS-Bereich (sps_zone), der den Punkt enthaelt – oberster, sonst null.
  function spsZoneAt(x, y) {
    const visible = visibleMap();
    const zs = (state.detail.objects || []).filter((o) => o.symbolType === 'sps_zone' && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    for (let i = zs.length - 1; i >= 0; i--) { if (pointInZone(zs[i], x, y)) return zs[i]; }
    return null;
  }
  // Beim Anklicken eines Schutzbereichs den verknuepften SPS-Bereich (gleiche SPS, 1:1) hervorheben.
  function highlightedSpsZoneId() {
    if (!state.selectedZone) return null;
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === state.selectedZone);
    if (!o || (o.symbolType !== 'sb_zone' && o.symbolType !== 'fg_zone') || !o.plcConfigId) return null;
    const sps = (state.detail.objects || []).find((z) => z.symbolType === 'sps_zone' && z.plcConfigId === o.plcConfigId);
    return sps ? sps.id : null;
  }
  // SB-/FG-Polygon auf einen SPS-Bereich gezogen -> automatisch dessen SPS uebernehmen (Verknuepfung ueber plcConfigId).
  async function autoLinkZoneToSps(z) {
    const c = zoneCentroid(z);
    const sps = spsZoneAt(c.x, c.y);
    const newPlc = sps && sps.plcConfigId ? sps.plcConfigId : null;
    if (newPlc && z.plcConfigId !== newPlc) {
      const plc = (state.detail.plcs || []).find((p) => p.id === newPlc);
      z.plcConfigId = newPlc; z.color = (plc && plc.color) || z.color;
      try { await Api.updateObject(z.id, { plcConfigId: newPlc, color: z.color }); } catch (e) { /* ignore */ }
      const kind = z.symbolType === 'fg_zone' ? 'Funktionsgruppe' : 'Schutzbereich';
      toast(kind + ' automatisch SPS „' + ((plc && plc.name) || '') + '" zugeordnet');
      renderEditor();
    }
  }
  // Live-Feedback beim Ziehen: SPS-Bereich unter dem Zonen-Zentroid hervorheben (Drop-Ziel).
  function highlightDropTarget(z) {
    let targetId = null;
    if (z && (z.symbolType === 'sb_zone' || z.symbolType === 'fg_zone')) {
      const c = zoneCentroid(z);
      const sps = spsZoneAt(c.x, c.y);
      if (sps && sps.plcConfigId) targetId = sps.id;
    }
    document.querySelectorAll('.sps-drop-target').forEach((el) => { if (el.id !== 'zone-poly-' + targetId) el.classList.remove('sps-drop-target'); });
    if (targetId) { const el = document.getElementById('zone-poly-' + targetId); if (el) el.classList.add('sps-drop-target'); }
  }
  function zoneAt(x, y) {
    const visible = visibleMap();
    const shapes = (state.detail.objects || []).filter((o) => isShape(o) && o.points && visible[o.layerId] !== false);
    for (let i = shapes.length - 1; i >= 0; i--) {
      const o = shapes[i];
      if (o.symbolType === 'mf_route') { if (pointNearRoute(o, x, y)) return o; }
      else if (pointInZone(o, x, y)) return o;
    }
    return null;
  }
  const pointInZone = window.PMX.pointInZone;

  function finishZone() { return withMutationLock(function () { return finishZoneImpl(); }); }
  async function finishZoneImpl() {
    if (!state.drawZone || state.zoneDraft.length < 3) { toast('Mindestens 3 Stützpunkte nötig'); return; }
    pushUndo();
    const pts = state.zoneDraft.slice();
    const L = layerById(state.activeLayer);
    const kind = zoneKind(L);
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === kind.type).length + 1).padStart(2, '0');
    state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: kind.prefix + '_' + num, symbolType: kind.type, color: (kind.type === 'nh_zone' ? '#D9534F' : L.color), x: pts[0].x, y: pts[0].y, points: pts });
      state.detail.objects.push(obj); state.selectedZone = obj.id; protectObj(obj.id);
      toast(kind.noun + ' erstellt');
      renderEditor();
      if (kind.type === 'sps_zone') openZoneAssignModal(obj.id); // SPS-Bereich: sofort die (genau eine) SPS zuordnen
      else if (kind.type === 'sb_zone' || kind.type === 'fg_zone') await autoLinkZoneToSps(obj); // SB/FG: automatisch dem umschliessenden SPS-Bereich zuordnen (wie beim Verschieben)
      return;
    } catch (e) { toast('Erstellen fehlgeschlagen: ' + e.message); }
    renderEditor();
  }
  // ---- Not-Halt-Grenze: Umriss der SB-Vereinigung (Moore-Konturverfolgung auf Zellraster).
  // Nicht verbundene SB-Gruppen werden per morphologischem Closing (kleinster verbindender Radius,
  // leicht verbreitert) ueberbrueckt -> genau EINE Grenze je Layout.
  function nhRdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const dl = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; if (!L) return Math.hypot(p.x - a.x, p.y - a.y); let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); };
    const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
    const st = [[0, pts.length - 1]];
    while (st.length) { const seg = st.pop(); const a = seg[0], b = seg[1]; let idx = -1, dm = eps; for (let i = a + 1; i < b; i++) { const d = dl(pts[i], pts[a], pts[b]); if (d > dm) { dm = d; idx = i; } } if (idx !== -1) { keep[idx] = true; st.push([a, idx], [idx, b]); } }
    const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }
  function nhSimplifyClosed(loop, eps) {
    if (loop.length < 4) return loop;
    let s = 0; for (let i = 1; i < loop.length; i++) if (loop[i].x < loop[s].x || (loop[i].x === loop[s].x && loop[i].y < loop[s].y)) s = i;
    const rot = loop.slice(s).concat(loop.slice(0, s)); rot.push(rot[0]);
    const out = nhRdp(rot, eps); out.pop();
    return out;
  }
  function sbUnionOutlines() {
    const sbs = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3);
    if (!sbs.length) return [];
    const polys = sbs.map((s) => s.points);
    const pbb = polys.map((pts) => { let a = 1, b = 1, c = 0, d = 0; pts.forEach((p) => { if (p.x < a) a = p.x; if (p.y < b) b = p.y; if (p.x > c) c = p.x; if (p.y > d) d = p.y; }); return [a, b, c, d]; });
    const pnp = (pts, x, y) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) ins = !ins; } return ins; };
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    polys.forEach((pts) => pts.forEach((p) => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }));
    const pad = 0.02; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(1, maxX + pad); maxY = Math.min(1, maxY + pad);
    const W = maxX - minX, H = maxY - minY; if (W <= 0 || H <= 0) return [];
    const N = 300, nx = Math.max(12, Math.round(N * (W >= H ? 1 : W / H))), ny = Math.max(12, Math.round(N * (H >= W ? 1 : H / W)));
    const dx = W / nx, dy = H / ny;
    const mask = []; for (let i = 0; i < nx; i++) { const col = new Uint8Array(ny); for (let j = 0; j < ny; j++) { const x = minX + (i + 0.5) * dx, y = minY + (j + 0.5) * dy; let v = 0; for (let p = 0; p < polys.length; p++) { const bb = pbb[p]; if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue; if (pnp(polys[p], x, y)) { v = 1; break; } } col[j] = v; } mask[i] = col; }
    const NN = nx * ny;
    const inb = (i, j) => i >= 0 && i < nx && j >= 0 && j < ny;
    const countComps = (m) => {
      const seen = []; for (let i = 0; i < nx; i++) seen[i] = new Uint8Array(ny);
      const qi = new Int32Array(NN), qj = new Int32Array(NN); let n = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        if (!m[i][j] || seen[i][j]) continue; n++;
        let h = 0, tq = 0; qi[tq] = i; qj[tq] = j; tq++; seen[i][j] = 1;
        while (h < tq) {
          const ci = qi[h], cj = qj[h]; h++;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            if (!a && !b) continue; const ni = ci + a, nj = cj + b;
            if (inb(ni, nj) && m[ni][nj] && !seen[ni][nj]) { seen[ni][nj] = 1; qi[tq] = ni; qj[tq] = nj; tq++; }
          }
        }
      }
      return n;
    };
    const bfsDist = (seed) => {
      const INF = 1 << 29; const d = []; for (let i = 0; i < nx; i++) d[i] = new Int32Array(ny).fill(INF);
      const qi = new Int32Array(NN), qj = new Int32Array(NN); let tq = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (seed(i, j)) { d[i][j] = 0; qi[tq] = i; qj[tq] = j; tq++; }
      let h = 0;
      while (h < tq) {
        const ci = qi[h], cj = qj[h]; h++; const nd = d[ci][cj] + 1;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          if (!a && !b) continue; const ni = ci + a, nj = cj + b;
          if (inb(ni, nj) && d[ni][nj] === INF) { d[ni][nj] = nd; qi[tq] = ni; qj[tq] = nj; tq++; }
        }
      }
      return d;
    };
    if (countComps(mask) > 1) {
      const dIn = bfsDist((i, j) => mask[i][j] === 1);
      const closeMask = (r) => { const dOut = bfsDist((i, j) => dIn[i][j] > r); const cm = []; for (let i = 0; i < nx; i++) { const col = new Uint8Array(ny); for (let j = 0; j < ny; j++) col[j] = (mask[i][j] || dOut[i][j] > r) ? 1 : 0; cm[i] = col; } return cm; };
      let lo = 1, hi = Math.max(nx, ny), bestR = -1;
      while (lo <= hi) { const r = (lo + hi) >> 1; if (countComps(closeMask(r)) <= 1) { bestR = r; hi = r - 1; } else lo = r + 1; }
      if (bestR > 0) { const cm = closeMask(Math.min(Math.max(nx, ny), bestR + 2)); for (let i = 0; i < nx; i++) mask[i].set(cm[i]); }
    }
    // Leichter Aussen-Versatz (1 Zelle): die Grenze liegt knapp AUSSEN an den SB an,
    // statt deren Rand zu ueberdecken - und umschliesst die SB damit vollstaendig.
    { const dM = bfsDist((i, j) => mask[i][j] === 1); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (dM[i][j] <= 1) mask[i][j] = 1; }
    // Moore-Nachbarschafts-Konturverfolgung (im Uhrzeigersinn) -> eine geschlossene Aussenkontur
    let si = -1, sj = -1;
    for (let j = 0; j < ny && si < 0; j++) for (let i = 0; i < nx; i++) if (mask[i][j]) { si = i; sj = j; break; }
    if (si < 0) return [];
    const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    let loop = [[si, sj]];
    let ci = si, cj = sj, bIdx = 6; // Start-Rueckrichtung: Norden (Zeile darueber ist sicher leer)
    const seenSt = new Map(); let cut = -1; let guard = 0;
    while (guard++ < NN * 8) {
      const key = (ci * ny + cj) * 8 + bIdx;
      const prev = seenSt.get(key);
      if (prev !== undefined) { cut = prev; break; } // Zustand wiederholt -> genau ein voller Umlauf dazwischen
      seenSt.set(key, loop.length - 1);
      let found = -1;
      for (let k = 1; k <= 8; k++) { const idx = (bIdx + k) % 8; const ni = ci + DIRS[idx][0], nj = cj + DIRS[idx][1]; if (inb(ni, nj) && mask[ni][nj]) { found = idx; break; } }
      if (found < 0) break; // isolierte Einzelzelle
      const pIdx = (found + 7) % 8; // zuletzt geprueft (aussen) -> neue Rueckrichtung
      const px = ci + DIRS[pIdx][0], py = cj + DIRS[pIdx][1];
      ci += DIRS[found][0]; cj += DIRS[found][1];
      const rdx = px - ci, rdy = py - cj;
      for (let k = 0; k < 8; k++) if (DIRS[k][0] === rdx && DIRS[k][1] === rdy) { bIdx = k; break; }
      loop.push([ci, cj]);
    }
    if (cut >= 0) loop = loop.slice(cut, loop.length - 1);
    if (loop.length < 3) return [];
    const pts = loop.map((c) => ({ x: minX + (c[0] + 0.5) * dx, y: minY + (c[1] + 0.5) * dy }));
    const ded = []; for (const p of pts) { const q = ded[ded.length - 1]; if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) ded.push(p); }
    const simp = nhSimplifyClosed(ded, 0.0032);
    return simp.length >= 3 ? [simp] : [];
  }
  // Fingerabdruck der SB-Geometrie: erkennt, ob sich SB seit der Grenz-Erzeugung geaendert haben.
  function sbFingerprint() {
    const sbs = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3);
    const s = sbs.map((o) => o.id + ':' + o.points.map((p) => p.x.toFixed(4) + ',' + p.y.toFixed(4)).join(';')).sort().join('|');
    let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'v' + (h >>> 0).toString(16) + '-' + sbs.length;
  }
  async function generateNotHaltBoundary() {
    if (!canEdit() || state.nhGenerating) return;
    const L = layerById(state.activeLayer); if (!L || L.name !== 'Not-Halt') return;
    const sbs = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3);
    if (!sbs.length) { toast('Keine Schutzbereiche vorhanden.'); return; }
    state.nhGenerating = true; renderEditor();
    let created = 0;
    try {
      const outlines = sbUnionOutlines();
      if (!outlines.length) { toast('Umriss konnte nicht erzeugt werden.'); return; }
      pushUndo();
      const fp = sbFingerprint();
      const old = (state.detail.objects || []).filter((o) => o.symbolType === 'nh_zone' && (o.metatags || []).some((m) => m.label === 'SB-Stand')); // nur automatisch erzeugte Grenzen ersetzen; manuell gezeichnete bleiben erhalten
      for (const o of old) { try { await Api.deleteObject(o.id); } catch (e) { /* ignore */ } state.detail.objects = state.detail.objects.filter((x) => x.id !== o.id); }
      for (let k = 0; k < outlines.length; k++) {
        const pts = outlines[k];
        try {
          const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: 'Not-Halt-Grenze generiert' + (outlines.length > 1 ? ' ' + (k + 1) : ''), symbolType: 'nh_zone', color: '#D9534F', x: pts[0].x, y: pts[0].y, points: pts });
          try { await Api.setMetatags(obj.id, [{ label: 'SB-Stand', value: fp, position: 1 }]); obj.metatags = [{ label: 'SB-Stand', value: fp, position: 1 }]; } catch (e) { /* ignore */ }
          state.detail.objects.push(obj); if (k === 0) state.selectedZone = obj.id; protectObj(obj.id); created++;
        } catch (e) { /* ignore */ }
      }
      toast(created ? ('Not-Halt-Grenze erzeugt (' + sbs.length + ' SB umschlossen)') : 'Erstellen fehlgeschlagen');
    } finally { state.nhGenerating = false; }
    renderEditor();
  }

  function finishRoute() { return withMutationLock(function () { return finishRouteImpl(); }); }
  async function finishRouteImpl() {
    if (state.drawShape !== 'route' || state.zoneDraft.length < 2) { toast('Mindestens 2 Wegpunkte nötig'); return; }
    pushUndo();
    const pts = state.zoneDraft.slice();
    const L = layerById(state.activeLayer);
    const ft = FLOW_TYPES[state.flowType] || FLOW_TYPES[0];
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === 'mf_route').length + 1).padStart(2, '0');
    state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: 'Förderweg_' + num, symbolType: 'mf_route', color: ft.color, x: pts[0].x, y: pts[0].y, points: pts });
      obj.metatags = obj.metatags || [];
      state.detail.objects.push(obj); state.selectedZone = obj.id; protectObj(obj.id);
      // Materialfluss-Typ als Metatag hinterlegen (Farbe folgt daraus)
      try { const upd = await Api.setMetatags(obj.id, [{ position: 3, label: 'Materialart', value: ft.name }]); obj.metatags = (upd && upd.metatags) || obj.metatags; } catch (e2) { /* Farbe ist schon gesetzt */ }
      toast('Förderweg „' + ft.name + '" erstellt');
    } catch (e) { toast('Erstellen fehlgeschlagen: ' + e.message); }
    renderEditor();
  }

  async function deleteSelectedZone() {
    const id = state.selectedZone; const z = (state.detail.objects || []).find((o) => o.id === id);
    if (!z) return;
    pushUndo();
    const isRoute = z.symbolType === 'mf_route';
    state.selectedZone = null;
    try { await Api.deleteObject(id); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    state.detail.objects = state.detail.objects.filter((o) => o.id !== id);
    const freed = await unlinkDependentsOf(z);
    toast((isRoute ? 'Förderweg gelöscht' : 'Bereich gelöscht') + (freed ? ' · ' + freed + ' Zuordnung(en) aufgehoben' : '')); renderEditor();
  }

  function updateZoneDom(z) {
    const el = document.getElementById('zone-poly-' + z.id);
    if (el) {
      if (z.symbolType === 'mf_route') {
        const cv = buildRouteCurve(z.points); el.setAttribute('d', cv.d);
        const a = document.getElementById('route-arrow-' + z.id);
        if (a) a.setAttribute('d', routeArrowFromTan(z.points[z.points.length - 1], cv.tan, docAspect()));
      } else {
        el.setAttribute('d', roundedPolyPath(z.points.map((p) => ({ x: p.x * 100, y: p.y * 100 })), 1.5));
      }
    }
    if (z.symbolType === 'sb_zone') { const bp = document.getElementById('sb-bolts-' + z.id); if (bp) bp.setAttribute('d', sbBoltPath(z, docAspect())); }
    z.points.forEach((p, i) => {
      const h = document.querySelector('.zone-vertex[data-zone="' + z.id + '"][data-vidx="' + i + '"]');
      if (h) { h.style.left = (p.x * 100) + '%'; h.style.top = (p.y * 100) + '%'; }
    });
    if (z.symbolType === 'fg_zone' || z.symbolType === 'sb_zone' || z.symbolType === 'sps_zone' || z.symbolType === 'nh_zone') {
      const lbl = document.querySelector('.fg-label[data-zone="' + z.id + '"]');
      if (lbl) {
        let cx, cy;
        if (z.symbolType === 'nh_zone') { // Label sitzt am obersten Punkt (wie im Render), nicht im Schwerpunkt
          let ti = 0; z.points.forEach((p, i) => { if (p.y < z.points[ti].y) ti = i; });
          cx = z.points[ti].x; cy = z.points[ti].y;
        } else {
          cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
          cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
        }
        lbl.style.left = (cx * 100) + '%'; lbl.style.top = (cy * 100) + '%';
      }
    }
    // Mittelpunkt-Handles + Maß-Badge live nachziehen
    const zn = z.points.length, isRoute = z.symbolType === 'mf_route', ec = isRoute ? zn - 1 : zn;
    for (let i = 0; i < ec; i++) {
      const p = z.points[i], q = z.points[(i + 1) % zn];
      const mh = document.querySelector('.zone-midpoint[data-zone="' + z.id + '"][data-eidx="' + i + '"]');
      if (mh) { mh.style.left = ((p.x + q.x) / 2 * 100) + '%'; mh.style.top = ((p.y + q.y) / 2 * 100) + '%'; }
    }
    const mm = document.querySelector('.zone-handle-layer .zone-measure');
    if (mm) { const met = polyMetrics(z.points); if (met) { mm.style.left = (met.minx * 100) + '%'; mm.style.top = (met.miny * 100) + '%'; mm.textContent = fmtMetrics(met, !isRoute); } }
  }
  // Cursor/Stützpunkt an vorhandene Draft-Punkte ausrichten (gleiche x/y) -> gerade Kanten.
  function snapCursor(cx, cy) {
    const th = 0.012; let x = cx, y = cy, ax = false, ay = false;
    // Andocken an vorhandene Zonen: Ecke hat Vorrang, sonst naechster Punkt auf einer Kante. Aspektkorrigiert.
    // Ziele: SB/SPS/FG-Zonen - NICHT die auto-erzeugte Not-Halt-Grenze und keine Foerderwege.
    const ar = docAspect(); const px = cx * ar, py = cy;
    const vth = 0.03, eth = 0.025;
    // Nur an GLEICHARTIGE Polygone andocken: der Typ, der gerade gezeichnet wird (SB->SB, FG->FG, SPS->SPS).
    const dt = (state.drawShape === 'zone' || state.drawShape === 'spszone') ? zoneKind(layerById(state.activeLayer)).type : null;
    let best = null, bestD = vth, bestE = null, bestED = eth;
    if (dt) ((state.detail && state.detail.objects) || []).forEach((o) => {
      if (o.symbolType !== dt) return;
      const pts = o.points; if (!pts || pts.length < 2) return;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const dv = Math.hypot((cx - a.x) * ar, cy - a.y); if (dv < bestD) { bestD = dv; best = a; }
        if (n >= 3) {
          const b = pts[(i + 1) % n];
          const axx = a.x * ar, ayy = a.y, dxx = b.x * ar - axx, dyy = b.y - ayy, l2 = dxx * dxx + dyy * dyy;
          let t = l2 ? ((px - axx) * dxx + (py - ayy) * dyy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = axx + t * dxx, qy = ayy + t * dyy, de = Math.hypot(px - qx, py - qy);
          if (de < bestED) { bestED = de; bestE = { x: qx / ar, y: qy }; }
        }
      }
    });
    if (best) return { x: best.x, y: best.y, ax: true, ay: true, dock: true };
    if (bestE) return { x: bestE.x, y: bestE.y, ax: true, ay: true, dock: true };
    // Achsen-Ausrichtung an bereits gesetzten Stuetzpunkten des aktuellen Polygons.
    (state.zoneDraft || []).forEach((p) => {
      if (Math.abs(cx - p.x) < th) { x = p.x; ax = true; }
      if (Math.abs(cy - p.y) < th) { y = p.y; ay = true; }
    });
    return { x: x, y: y, ax: ax, ay: ay };
  }
  function updateDraftDom() {
    const cur = state.zoneCursor, al = state.zoneAlign || {};
    const gv = document.getElementById('guide-v'), gh = document.getElementById('guide-h');
    if (gv && cur) { gv.setAttribute('x1', cur.x * 100); gv.setAttribute('x2', cur.x * 100); gv.setAttribute('stroke', al.x ? '#E8663F' : '#0065A5'); }
    if (gh && cur) { gh.setAttribute('y1', cur.y * 100); gh.setAttribute('y2', cur.y * 100); gh.setAttribute('stroke', al.y ? '#E8663F' : '#0065A5'); }
    const ring = document.getElementById('snap-ring');
    if (ring) { if (state.zoneSnap) { ring.setAttribute('cx', state.zoneSnap.x * 100); ring.setAttribute('cy', state.zoneSnap.y * 100); } else { ring.setAttribute('cx', -20); ring.setAttribute('cy', -20); } }
    const meas = document.getElementById('draw-measure');
    if (meas) {
      const pts = cur ? state.zoneDraft.concat([cur]) : state.zoneDraft;
      const m = polyMetrics(pts);
      if (m && cur) {
        meas.textContent = state.drawShape === 'route'
          ? ('B ' + Math.round(m.w * 100) + '% × H ' + Math.round(m.h * 100) + '% · ' + pts.length + ' Pkt')
          : fmtMetrics(m, true);
        meas.style.left = (cur.x * 100) + '%'; meas.style.top = (cur.y * 100) + '%'; meas.style.display = 'block';
      } else { meas.style.display = 'none'; }
    }
    const el = document.getElementById('zone-draft'); if (!el) return;
    if (state.drawShape === 'route') {
      const dpull = state.zoneCursor ? state.zoneDraft.concat([state.zoneCursor]) : state.zoneDraft;
      el.setAttribute('d', buildRouteCurve(dpull).d);
    } else {
      const dpts = state.zoneDraft.map((p) => (p.x * 100) + ',' + (p.y * 100));
      if (state.zoneCursor) dpts.push((state.zoneCursor.x * 100) + ',' + (state.zoneCursor.y * 100));
      el.setAttribute('points', dpts.join(' '));
    }
  }

  const _nudgeTimers = {};
  function nudgeZonePersist(z) {
    protectObj(z.id);
    const id = z.id;
    state.geomPending[id] = { points: z.points.map(function (p) { return { x: p.x, y: p.y }; }), ts: Date.now() };
    if (_nudgeTimers[id]) clearTimeout(_nudgeTimers[id]);
    _nudgeTimers[id] = setTimeout(function () {
      delete _nudgeTimers[id];
      const zz = (state.detail.objects || []).find(function (o) { return o.id === id; });
      if (!zz || !zz.points || !zz.points.length) return;
      Api.updateObject(id, { points: zz.points, x: zz.points[0].x, y: zz.points[0].y }).catch(function () { toast(t('Position nicht gespeichert')); });
    }, 400);
  }
  // Rechtsklick auf einen Stützpunkt entfernt ihn (Polygon bleibt >=3, Weg >=2 Punkte).
  function onContentContextMenu(e) {
    if (state.view !== 'editor' || !canEdit()) return;
    const v = e.target.closest('.zone-vertex');
    if (v) {
      e.preventDefault();
      const zid = v.getAttribute('data-zone'), idx = +v.getAttribute('data-vidx');
      const z = (state.detail.objects || []).find((o) => o.id === zid); if (!z || !z.points) return;
      const minPts = z.symbolType === 'mf_route' ? 2 : 3;
      if (z.points.length <= minPts) { toast('Mindestens ' + minPts + ' Stützpunkte nötig'); return; }
      pushUndo();
      z.points.splice(idx, 1);
      protectObj(z.id);
      state.geomPending[z.id] = { points: z.points.map(function (p) { return { x: p.x, y: p.y }; }), ts: Date.now() };
      Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }).catch(function () { toast(t('Position nicht gespeichert')); });
      renderEditor();
      return;
    }
    // sonst: Kommentar an dieser Stelle anlegen
    const doc = e.target.closest('#canvasDoc'); if (!doc) return;
    e.preventDefault();
    const r = doc.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    createCommentAt(x, y);
  }
  /* ---------- Undo / Redo (Editor, mit Server-Sync) ---------- */
