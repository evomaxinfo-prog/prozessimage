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
    const _delFailed = _delResults.filter((ok) => !ok).length; toast(_delFailed ? t('{n} von {total} gelöscht, {failed} fehlgeschlagen', { n: ids.length - _delFailed, total: ids.length, failed: _delFailed }) : t('{n} Objekte gelöscht', { n: ids.length })); renderEditor();
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
    bindBackdropClose(m, closeSymModal);
    setTimeout(() => { const n = document.getElementById('symName'); if (n) { n.focus(); n.select(); } }, 40);
  }
  // Fenster per Klick auf den Hintergrund schliessen - aber NUR, wenn der Klick dort auch
  // BEGONNEN hat. Sonst schliesst eine Textmarkierung, die man ueber den Fensterrand hinaus
  // zieht und aussen loslaesst, das Fenster ungewollt (Eingaben gehen dabei verloren).
  function bindBackdropClose(m, closeFn) {
    if (!m) return;
    let downOnBackdrop = false;
    m.addEventListener('pointerdown', function (e) { downOnBackdrop = (e.target === m); });
    m.addEventListener('click', function (e) { const ok = downOnBackdrop; downOnBackdrop = false; if (e.target === m && ok) closeFn(); });
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
    bindBackdropClose(m, closeProfile);
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
