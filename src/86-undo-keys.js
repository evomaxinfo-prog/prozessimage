  function snapObjects() { return JSON.parse(JSON.stringify(state.detail.objects || [])); }
  function updateUndoBtns() {
    const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
    if (u) u.disabled = !!state.undoBusy || !(state.undoStack && state.undoStack.length);
    if (r) r.disabled = !!state.undoBusy || !(state.redoStack && state.redoStack.length);
  }
  function pushUndoSnap(snap) {
    state.undoStack = state.undoStack || []; state.redoStack = state.redoStack || [];
    state.undoStack.push(snap);
    state.objRev = (state.objRev || 0) + 1; // Stand-Zaehler: entwertet noch laufende Abgleiche
    if (state.undoStack.length > 60) state.undoStack.shift();
    state.redoStack = [];
    updateUndoBtns();
  }
  function pushUndo() { if (state.detail) pushUndoSnap(snapObjects()); }
  // Anlegende Aktionen serialisieren: Der Undo-Schnappschuss wird VOR dem Server-Aufruf
  // genommen, das neue Objekt aber erst DANACH in den Zustand aufgenommen. Ohne Schlange
  // schnappt eine zweite, schnell folgende Aktion denselben Ausgangszustand - beide Objekte
  // landen dann in EINEM Undo-Schritt. Mit Schlange wartet sie, bis die vorige fertig ist.
  // Noch unbestaetigte Anlagen (optimistisches Platzieren). Undo/Redo wartet kurz darauf,
  // sonst wuerde es versuchen, ein Objekt mit vorlaeufiger ID auf dem Server zu loeschen -
  // und die parallel laufende Anlage haette danach eine Karteileiche hinterlassen.
  let _pendingOps = [];
  function trackPendingOp() {
    let done; const p = new Promise(function (r) { done = r; });
    _pendingOps.push(p);
    const fin = function () { _pendingOps = _pendingOps.filter(function (x) { return x !== p; }); };
    p.then(fin, fin);
    return done;
  }
  function settlePendingOps() { return _pendingOps.length ? Promise.allSettled(_pendingOps.slice()) : Promise.resolve(); }
  let _mutChain = Promise.resolve();
  function withMutationLock(fn) {
    const run = _mutChain.then(fn, fn);
    _mutChain = run.then(function () { }, function () { });
    return run;
  }
  const objPayload = window.PMX.objPayload;
  function remapId(oldId, newId) {
    const fix = (arr) => (arr || []).forEach((o) => { if (o.id === oldId) o.id = newId; });
    fix(state.detail.objects);
    (state.undoStack || []).forEach(fix); (state.redoStack || []).forEach(fix);
    if (state.selectedZone === oldId) state.selectedZone = newId;
    if (state.selectedObj === oldId) state.selectedObj = newId;
    if (state.geomPending && state.geomPending[oldId]) { state.geomPending[newId] = state.geomPending[oldId]; delete state.geomPending[oldId]; }
  }
  // Serverzustand von "from" nach "to" ueberfuehren (Loeschen/Anlegen/Aendern), IDs neu angelegter Objekte uebernehmen.
  async function applyObjectsState(from, to) {
    state.detail.objects = to; renderEditor();
    state.objRev = (state.objRev || 0) + 1;
    let failed = 0;
    const fromById = {}, toById = {};
    from.forEach((o) => { fromById[o.id] = o; }); to.forEach((o) => { toById[o.id] = o; });
    const sid = state.detail.id;
    let didCreate = false;
    for (const o of from) { if (!toById[o.id]) { try { await Api.deleteObject(o.id); } catch (e) { failed++; } } }
    for (const o of to) {
      if (!fromById[o.id]) {
        try {
          const created = await Api.createObject(sid, objPayload(o));
          const newId = created && created.id;
          if (newId) {
            // Die Anlege-Route kennt scale/visible nicht -> direkt nachziehen, sonst kommt das Objekt
            // beim Rueckgaengigmachen in Standardgroesse/-sichtbarkeit zurueck.
            const after = {};
            if (o.plcConfigId) { after.plcConfigId = o.plcConfigId; after.color = o.color; }
            if (o.scale != null && o.scale !== 1) after.scale = o.scale;
            if (o.visible === false) after.visible = false;
            if (Object.keys(after).length) { try { await Api.updateObject(newId, after); } catch (e) { failed++; } }
            if (o.metatags && o.metatags.length) { try { await Api.setMetatags(newId, o.metatags); } catch (e) { /* ignore */ } }
            remapId(o.id, newId); didCreate = true;
          }
        } catch (e) { failed++; }
      }
    }
    for (const o of to) {
      const f = fromById[o.id];
      if (f && objChanged(f, o)) {
        const patch = objPayload(o); patch.plcConfigId = o.plcConfigId || null;
        state.geomPending[o.id] = { points: (o.points || []).map((p) => ({ x: p.x, y: p.y })), ts: Date.now() };
        try { await Api.updateObject(o.id, patch); } catch (e) { failed++; }
        if (JSON.stringify(f.metatags || []) !== JSON.stringify(o.metatags || [])) { try { await Api.setMetatags(o.id, o.metatags || []); } catch (e) { /* ignore */ } }
      }
    }
    // Nur neu rendern, wenn sich IDs geaendert haben (Neuanlage) – sonst flackert das Layout unnoetig.
    if (didCreate) renderEditor(); else updateUndoBtns();
    state.objRev = (state.objRev || 0) + 1;
    if (failed) {
      // Sonst zeigt der Editor einen Stand, den der Server nicht hat (verschwundene Objekte kommen
      // beim naechsten Laden zurueck = die gemeldeten "Reste").
      try {
        const fresh = await Api.getObjects(sid);
        if (Array.isArray(fresh) && state.detail && state.detail.id === sid) { state.detail.objects = fresh; renderEditor(); }
      } catch (e) { /* Abgleich nicht moeglich - beim naechsten Laden korrekt */ }
      toast(t('{n} Änderungen konnten nicht gespeichert werden', { n: failed }));
    }
  }
  // Wiedereintritt sperren: ein zweites Strg+Z waehrend der noch laufenden Uebertragung
  // wuerde einen halb angewandten Zwischenstand als Schnappschuss ablegen und die Server-
  // Aufrufe verschraenken (doppelte Neuanlagen, Loeschen bereits geloeschter Objekte).
  // Zwei Zustaende gleich? (gleiche Objekte, keine relevante Aenderung)
  function sameObjectsState(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const byId = {}; b.forEach(function (o) { byId[o.id] = o; });
    for (const o of a) { const p = byId[o.id]; if (!p || objChanged(o, p)) return false; }
    return true;
  }
  // Leerlauf-Schritte verwerfen: Schnappschuesse, die nichts aendern (z.B. weil die zugehoerige
  // Aktion fehlschlug), fuehlten sich wie ein Sprung an - Strg+Z tat scheinbar nichts.
  function nextDifferent(stack, curr) {
    while (stack.length) { const cand = stack.pop(); if (!sameObjectsState(curr, cand)) return cand; }
    return null;
  }
  async function doUndo() {
    if (state.undoBusy || !(state.undoStack && state.undoStack.length)) return;
    state.undoBusy = true; updateUndoBtns();
    try {
      await settlePendingOps(); // erst offene Anlagen abwarten, dann den Stand nehmen
      const curr = snapObjects();
      const target = nextDifferent(state.undoStack, curr);
      if (!target) return;
      (state.redoStack = state.redoStack || []).push(curr);
      await applyObjectsState(curr, target);
    } finally { state.undoBusy = false; updateUndoBtns(); }
  }
  async function doRedo() {
    if (state.undoBusy || !(state.redoStack && state.redoStack.length)) return;
    state.undoBusy = true; updateUndoBtns();
    try {
      await settlePendingOps();
      const curr = snapObjects();
      const target = nextDifferent(state.redoStack, curr);
      if (!target) return;
      (state.undoStack = state.undoStack || []).push(curr);
      await applyObjectsState(curr, target);
    } finally { state.undoBusy = false; updateUndoBtns(); }
  }
  function onEditorKey(e) {
    if (state.view !== 'editor' || !canEdit()) return;
    const t = document.activeElement;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if ((e.ctrlKey || e.metaKey) && !inField) {
      const k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); return; }
      if (k === 'c') { e.preventDefault(); copySelectedObjects(); return; }
      if (k === 'v') { e.preventDefault(); pasteObjects(); return; }
    }
    if (state.drawZone) {
      if (e.key === 'Enter') { e.preventDefault(); state.drawShape === 'route' ? finishRoute() : finishZone(); }
      else if (e.key === 'Escape') { e.preventDefault(); state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null; renderEditor(); }
      else if (e.key === 'Backspace' && !inField) { e.preventDefault(); state.zoneDraft.pop(); renderEditor(); }
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && state.selectedZone && !inField) {
      const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone);
      if (z && z.symbolType === 'mf_route') { e.preventDefault(); reverseRoute(z.id); return; }
    }
    if (state.selectedZone && !inField && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone && o.points);
      if (z) {
        e.preventDefault();
        if (!state._nudgeUndoActive) { pushUndo(); state._nudgeUndoActive = true; }
        if (state._nudgeTimer2) clearTimeout(state._nudgeTimer2);
        state._nudgeTimer2 = setTimeout(function () { state._nudgeUndoActive = false; }, 600);
        const step = e.shiftKey ? 0.02 : 0.004;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        z.points = z.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
        updateZoneDom(z); nudgeZonePersist(z);
        return;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && (state.selectedObj || (state.selObjs && state.selObjs.length))) {
      e.preventDefault(); deleteSelectedObjects(); return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedZone && !inField) {
      e.preventDefault(); deleteSelectedZone();
    }
  }

