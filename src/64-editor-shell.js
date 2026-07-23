  // Layout zuruecksetzen (nur Administrator): loescht ALLE Objekte dieser Anlage ueber alle
  // Ebenen hinweg. Das Layout-Bild bleibt erhalten. Keine automatische Versions-Sicherung
  // (bewusste Entscheidung); umkehrbar bleibt es direkt danach ueber Undo (Strg+Z),
  // das den Objektbestand auch serverseitig wiederherstellt.
  // Loescht Objekte in kleinen Gruppen statt alle gleichzeitig: ein Schwall paralleler Anfragen
  // laeuft sonst ins Anfragelimit des Servers, einzelne Loeschungen scheitern - genau daher blieben
  // beim Zuruecksetzen Reste stehen. Liefert die IDs zurueck, die NICHT geloescht werden konnten.
  async function deleteObjectsInBatches(ids) {
    const failedIds = [];
    for (let i = 0; i < ids.length; i += 6) {
      const part = ids.slice(i, i + 6);
      const res = await Promise.all(part.map(function (id) {
        return Api.deleteObject(id).then(function () { return null; }).catch(function () { return id; });
      }));
      res.forEach(function (id) { if (id) failedIds.push(id); });
    }
    return failedIds;
  }
  async function resetLayout() {
    if (!state.isAdmin || !state.detail || !state.detail.id) return;
    const sid = state.detail.id;
    const objs = (state.detail.objects || []).slice();
    if (!objs.length) { toast(t('Layout ist bereits leer')); return; }
    if (!window.confirm(t('Gesamtes Layout zurücksetzen?') + '\n\n'
      + t('{n} Objekte aller Ebenen werden gelöscht. Das Layout-Bild bleibt erhalten.', { n: objs.length }) + '\n'
      + t('Rückgängig nur direkt danach mit Strg+Z.'))) return;
    pushUndo();
    state.undoBusy = true; updateUndoBtns(); // waehrenddessen kein Abgleich und kein Undo dazwischen
    try {
      let rest = await deleteObjectsInBatches(objs.map(function (o) { return o.id; }));
      if (rest.length) { await new Promise(function (r) { setTimeout(r, 700); }); rest = await deleteObjectsInBatches(rest); } // zweiter Versuch
      // Nachkontrolle direkt am Server: erfasst auch Objekte, die lokal noch gar nicht bekannt waren
      // (z.B. parallel von jemand anderem angelegt) und alles, was beim ersten Durchgang haengen blieb.
      for (let pass = 0; pass < 2; pass++) {
        let left = [];
        try { const fresh = await Api.getObjects(sid); left = Array.isArray(fresh) ? fresh : []; } catch (e) { break; }
        if (!left.length) break;
        await deleteObjectsInBatches(left.map(function (o) { return o.id; }));
      }
      // Endstand vom Server holen - die Anzeige zeigt danach garantiert das, was wirklich gespeichert ist.
      let remaining = [];
      try { const after = await Api.getObjects(sid); remaining = Array.isArray(after) ? after : []; } catch (e) { remaining = []; }
      state.detail.objects = remaining;
      state.selObjs = []; state.selectedObj = null; state.selectedZone = null;
      state.objRev = (state.objRev || 0) + 1;
      renderEditor();
      const geloescht = objs.length - remaining.length;
      // Journaleintrag bewusst auf Deutsch (Journal ist Datenbestand, wie die Backend-Eintraege)
      try { await Api.addJournal(sid, 'Layout zurueckgesetzt (' + geloescht + ' Objekte geloescht)'); } catch (e) { /* best-effort */ }
      toast(remaining.length
        ? t('{n} Objekte konnten nicht gelöscht werden', { n: remaining.length })
        : t('Layout zurückgesetzt – {n} Objekte gelöscht', { n: geloescht }));
    } finally { state.undoBusy = false; updateUndoBtns(); }
  }
  function renderEditor() {
    return renderEditorImpl();
  }
  function renderEditorImpl() {
    _hoverZoneId = null; // DOM wird neu gebaut -> Hover-State verwerfen, damit Highlight/Cursor beim naechsten Mausruck neu greift
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
      + (state.isAdmin ? '<button class="btn btn-danger" data-act="layout-reset" title="' + t('Alle Objekte dieser Anlage löschen') + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/></svg> ' + t('Reset') + '</button>' : '')
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

