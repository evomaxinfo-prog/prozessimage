  function snapObjects() { return JSON.parse(JSON.stringify(state.detail.objects || [])); }
  function updateUndoBtns() {
    const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
    if (u) u.disabled = !(state.undoStack && state.undoStack.length);
    if (r) r.disabled = !(state.redoStack && state.redoStack.length);
  }
  function pushUndoSnap(snap) {
    state.undoStack = state.undoStack || []; state.redoStack = state.redoStack || [];
    state.undoStack.push(snap);
    if (state.undoStack.length > 60) state.undoStack.shift();
    state.redoStack = [];
    updateUndoBtns();
  }
  function pushUndo() { if (state.detail) pushUndoSnap(snapObjects()); }
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
    const fromById = {}, toById = {};
    from.forEach((o) => { fromById[o.id] = o; }); to.forEach((o) => { toById[o.id] = o; });
    const sid = state.detail.id;
    let didCreate = false;
    for (const o of from) { if (!toById[o.id]) { try { await Api.deleteObject(o.id); } catch (e) { /* ignore */ } } }
    for (const o of to) {
      if (!fromById[o.id]) {
        try {
          const created = await Api.createObject(sid, objPayload(o));
          const newId = created && created.id;
          if (newId) {
            if (o.plcConfigId) { try { await Api.updateObject(newId, { plcConfigId: o.plcConfigId, color: o.color }); } catch (e) { /* ignore */ } }
            if (o.metatags && o.metatags.length) { try { await Api.setMetatags(newId, o.metatags); } catch (e) { /* ignore */ } }
            remapId(o.id, newId); didCreate = true;
          }
        } catch (e) { /* ignore */ }
      }
    }
    for (const o of to) {
      const f = fromById[o.id];
      if (f && objChanged(f, o)) {
        const patch = objPayload(o); patch.plcConfigId = o.plcConfigId || null;
        state.geomPending[o.id] = { points: (o.points || []).map((p) => ({ x: p.x, y: p.y })), ts: Date.now() };
        try { await Api.updateObject(o.id, patch); } catch (e) { /* ignore */ }
        if (JSON.stringify(f.metatags || []) !== JSON.stringify(o.metatags || [])) { try { await Api.setMetatags(o.id, o.metatags || []); } catch (e) { /* ignore */ } }
      }
    }
    // Nur neu rendern, wenn sich IDs geaendert haben (Neuanlage) – sonst flackert das Layout unnoetig.
    if (didCreate) renderEditor(); else updateUndoBtns();
  }
  async function doUndo() {
    if (!(state.undoStack && state.undoStack.length)) return;
    const curr = snapObjects(); const target = state.undoStack.pop();
    (state.redoStack = state.redoStack || []).push(curr);
    await applyObjectsState(curr, target);
  }
  async function doRedo() {
    if (!(state.redoStack && state.redoStack.length)) return;
    const curr = snapObjects(); const target = state.redoStack.pop();
    (state.undoStack = state.undoStack || []).push(curr);
    await applyObjectsState(curr, target);
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

