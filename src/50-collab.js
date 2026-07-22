  /* ================= Echtzeit-Kollaboration (Polling) ================= */
  let collabTimer = null;
  function startCollab() {
    stopCollab();
    if (!state.detail || !state.collab.enabled) return;
    state.collab.since = null; state.collab.viewers = []; state.collab.inflight = false; state.collab.status = 'connecting';
    collabTimer = setInterval(pollCollab, 3000);
    pollCollab();
  }
  function stopCollab() {
    if (collabTimer) { clearInterval(collabTimer); collabTimer = null; }
    state.collab.inflight = false;
  }
  // Objekt, das der lokale Nutzer gerade selbst bewegt/bearbeitet – wird beim Mergen nicht überschrieben.
  function activeObjectId() {
    if (dragMove) return String(dragMove.oid);
    if (state.techDrag) return String(state.techDrag.id);
    if (state.zoneDrag) return String(state.zoneDrag.id);
    if (state.modalObjId) return String(state.modalObjId);
    return null;
  }
  function collabIdle() {
    return !dragMove && !state.techDrag && !state.zoneDrag && !state.drawZone
      && !state.modalObjId && !document.getElementById('zaBackdrop');
  }
  function presenceChanged(v) {
    const a = (state.collab.viewers || []).map((x) => x.email).sort().join(',');
    const b = (v || []).map((x) => x.email).sort().join(',');
    return a !== b;
  }
  async function pollCollab() {
    if (!state.detail || state.view !== 'editor') return;
    if (state.collab.inflight) return;
    state.collab.inflight = true;
    // Objekte über den zuverlässigen /objects-Endpunkt (keine Zeitstempel-Logik) + Präsenz über /changes.
    const sid = state.detail.id;
    let objsList, chg;
    const [objR, chR, cmR] = await Promise.allSettled([Api.getObjects(sid), Api.getChanges(sid, null), state.commentsServer ? Api.getComments(sid) : Promise.resolve(null)]);
    state.collab.inflight = false;
    if (state.view !== 'editor') return; // waehrend des Await weg-navigiert -> nicht mehr in den Editor rendern
    if (objR.status === 'rejected') {
      const st = objR.reason && objR.reason.status;
      if (st === 404 || st === 405) { state.collab.enabled = false; state.collab.status = 'offline'; stopCollab(); renderPresenceOnly(); return; }
      if (state.collab.status !== 'offline') { state.collab.status = 'offline'; renderPresenceOnly(); }
      return;
    }
    objsList = Array.isArray(objR.value) ? objR.value : [];
    chg = (chR.status === 'fulfilled') ? (chR.value || {}) : {};

    const statusChanged = state.collab.status !== 'live';
    state.collab.status = 'live';
    const viewersChanged = presenceChanged(chg.viewers || []) || statusChanged;
    state.collab.viewers = chg.viewers || [];
    state.collab.lastSync = { n: objsList.length, del: 0, at: Date.now() };

    const r = reconcileObjects(objsList);
    if (r.dirty) {
      if (r.needFull) {
        if (collabIdle()) { renderEditor(); state.collab.pendingRender = false; }
        else { state.collab.pendingRender = true; renderPresenceOnly(); }
      } else {
        // Reine Geometrie-Änderung an Polygonen/Förderwegen -> nur das jeweilige SVG-Element patchen
        let missing = false;
        r.patchIds.forEach((id) => {
          const o = (state.detail.objects || []).find((x) => String(x.id) === id);
          if (!o) return;
          if (document.getElementById('zone-poly-' + id)) { updateZoneDom(o); flashShape(id); }
          else missing = true; // Element noch nicht gezeichnet -> voller Render nötig
        });
        if (missing) {
          if (collabIdle()) { renderEditor(); state.collab.pendingRender = false; }
          else state.collab.pendingRender = true;
        }
        renderPresenceOnly();
      }
    } else if (state.collab.pendingRender && collabIdle()) {
      // Aufgeschobener Neuaufbau nachholen, sobald der Nutzer nichts mehr selbst macht
      renderEditor(); state.collab.pendingRender = false;
    } else if (viewersChanged) {
      renderPresenceOnly();
    }
    // Kommentare mitpollen: bei Aenderung (neue Pins/Nachrichten anderer Nutzer) einspielen; Eingabe/Fokus bleiben erhalten.
    if (state.commentsServer && cmR && cmR.status === 'fulfilled' && Array.isArray(cmR.value)) {
      const csig = commentsSig(cmR.value);
      // Nur einspielen, wenn der Nutzer gerade nicht interagiert (Ziehen/Modal) - sonst wuerde renderEditor einen laufenden Drag abbrechen.
      if (csig !== state.commentsSig && collabIdle() && !state.iconDrag && !state.pinDrag && !state.cwDrag
        && Date.now() > (state.commentsHoldUntil || 0)) { state.commentsSig = csig; applyCommentsUpdate(cmR.value); }
    }
  }
  // Gleicht die komplette Objektliste vom Server gegen den lokalen Stand ab (Hinzufügen/Ändern/Entfernen).
  function reconcileObjects(list) {
    if (!state.detail) return { dirty: false, needFull: false, patchIds: [] };
    const busy = activeObjectId();
    const now = Date.now();
    const protectedId = (id) => state.collab.protect[String(id)] && state.collab.protect[String(id)] > now;
    const incoming = {}; (list || []).forEach((o) => { o.metatags = o.metatags || []; incoming[String(o.id)] = o; });
    const arr = state.detail.objects || (state.detail.objects = []);
    let dirty = false, needFull = false; const patchIds = [];
    // Entfernte Objekte (lokal vorhanden, aber nicht mehr in der Serverliste). Frisch bearbeitete/erstellte
    // Objekte sind kurz geschützt, damit ein Poll die noch nicht bestätigte lokale Änderung nicht zurücksetzt.
    const kept = arr.filter((o) => {
      if (incoming[String(o.id)] || String(o.id) === busy || protectedId(o.id)) return true;
      dirty = true; needFull = true;
      if (state.selectedZone === o.id) state.selectedZone = null;
      return false;
    });
    if (kept.length !== arr.length) state.detail.objects = kept;
    const cur = state.detail.objects;
    const idx = {}; cur.forEach((o, i) => { idx[String(o.id)] = i; });
    Object.keys(incoming).forEach((id) => {
      if (id === busy) return; // nicht überschreiben, was der Nutzer gerade zieht
      const row = incoming[id];
      if (idx[id] != null) {
        // Vom Nutzer gerade verschobene Zone/Weg: lokale Geometrie halten, bis der Server die neue Position bestätigt.
        const pend = state.geomPending[id];
        if (pend) {
          if (pointsMatch(row.points, pend.points)) {
            delete state.geomPending[id]; // Server hat die Verschiebung übernommen
          } else if (Date.now() - pend.ts < 120000) {
            const loc = cur[idx[id]];
            if (loc && !pointsMatch(loc.points, pend.points)) { loc.points = pend.points.map((p) => ({ x: p.x, y: p.y })); dirty = true; patchIds.push(id); }
            return; // veralteten Serverstand (noch nicht bestätigt) nicht übernehmen
          } else {
            delete state.geomPending[id]; // nach 2 Min. aufgeben (dann greift wieder der Serverstand)
          }
        }
        if (protectedId(id)) return; // frisch lokal bearbeitet -> Serverstand (evtl. veraltet) nicht übernehmen
        const old = cur[idx[id]];
        if (!objChanged(old, row)) return;
        const geomOnly = isShape(old) && isShape(row) && old.symbolType === row.symbolType && shapeVisualKey(old) === shapeVisualKey(row);
        cur[idx[id]] = row; dirty = true;
        if (geomOnly) patchIds.push(id); else needFull = true;
      } else {
        cur.push(row); idx[id] = cur.length - 1; dirty = true; needFull = true;
      }
    });
    return { dirty, needFull, patchIds };
  }
  // Markiert ein Objekt kurz als "lokal frisch geändert", damit ein Poll die noch nicht bestätigte Änderung nicht überschreibt/entfernt.
