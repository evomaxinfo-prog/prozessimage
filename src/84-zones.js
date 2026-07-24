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
    const rh = e.target.closest('[data-rothandle]');
    if (rh) { e.preventDefault(); rotateSelectedObjects(e.shiftKey ? -15 : 15); return; }
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

