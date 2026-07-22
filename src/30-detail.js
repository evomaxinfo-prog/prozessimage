  function cacheStation(sid, full) { if (!state.stationCache) state.stationCache = {}; state.stationCache[sid] = full; }

  async function loadStationDetail(node) {
    if (!node.stationId) return false;
    const full = await Api.getStationFull(node.stationId);
    if (!full.nodeId) full.nodeId = node.id;
    cacheStation(node.stationId, full);
    state.detail = full; state.detailEdit = false; state.detailDraft = null;
    return true;
  }
  async function gotoStation(dir) {
    const s = lineSiblings(); if (!s) return;
    const ni = s.idx + dir;
    if (ni < 0 || ni >= s.stations.length) return;
    const target = s.stations[ni];
    state.selected = target.id;
    try { if (!(await loadStationDetail(target))) return; } catch (e) { toast(t('Station konnte nicht geladen werden')); return; }
    await openEditor();
    renderTree();
  }
  // Pfeil-Leiste über dem ZURÜCK-Button: vorherige/nächste Station der Linie.
  function stationNavHtml() {
    const s = lineSiblings();
    if (!s || s.stations.length < 2) return '';
    const prevD = s.idx <= 0 ? ' disabled' : '', nextD = s.idx >= s.stations.length - 1 ? ' disabled' : '';
    const prevT = s.idx > 0 ? t('Vorherige: ') + esc(s.stations[s.idx - 1].name) : t('Erste Station');
    const nextT = s.idx < s.stations.length - 1 ? t('Nächste: ') + esc(s.stations[s.idx + 1].name) : t('Letzte Station');
    const curName = esc(s.stations[s.idx].name);
    return '<div class="nav-ctl" title="Station innerhalb der Linie wechseln (' + curName + ')">'
      + '<button class="nav-arrow" data-act="station-prev"' + prevD + ' title="' + prevT + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 6l-6 6 6 6"/></svg></button>'
      + '<span class="nav-lbl"><b>' + (s.idx + 1) + '</b> / ' + s.stations.length + '</span>'
      + '<button class="nav-arrow" data-act="station-next"' + nextD + ' title="' + nextT + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l6 6-6 6"/></svg></button></div>';
  }

  /* -------- Detailansicht (Schritt 2) -------- */
  const detailSkeleton = window.PMX.detailSkeleton;
  // Frisch laden und – falls diese Station noch aktiv ist und sich etwas geaendert hat – neu rendern.
  async function revalidateStation(node, seq) {
    const prevJson = JSON.stringify(state.detail);
    try {
      const fresh = await Api.getStationFull(node.stationId);
      if (!fresh.nodeId) fresh.nodeId = node.id;
      cacheStation(node.stationId, fresh);
      if (seq === state.navSeq && !state.detailEdit && JSON.stringify(fresh) !== prevJson) {
        state.detail = fresh; renderDetail();
        if (fresh.hasLayout) ensureLayoutBlob().then(() => { if (seq === state.navSeq) renderDetail(); });
      }
    } catch (e) { /* Cache bleibt gueltig */ }
  }
  async function openAnlage(node) {
    setStationUrl(node.id);
    state.panX = 0; state.panY = 0;
    if (!node.stationId) {
      $('content').innerHTML = breadcrumb(node.id) + '<div class="pad"><div class="card"><div class="card-body">Für diese Anlage existiert keine Station.</div></div></div>';
      return;
    }
    const seq = (state.navSeq = (state.navSeq || 0) + 1);
    state.view = 'detail'; // Beim Wechsel auf eine Anlage immer zuerst die Stammdaten-Ansicht (nie direkt in die Modellierung)
    const sid = node.stationId;
    const cached = state.stationCache && state.stationCache[sid];
    // Layout-Grafik liegt NICHT im kritischen Pfad: Detail sofort zeigen, Vorschau laedt nach.
    const showLayoutAfter = () => { ensureLayoutBlob().then(() => { if (seq === state.navSeq && state.detail && state.detail.hasLayout) renderDetail(); }); };
    if (cached) {
      // Sofort aus dem Cache – kein Warten auf das Netzwerk
      if (!cached.nodeId) cached.nodeId = node.id;
      state.detail = cached; state.detailEdit = false; state.detailDraft = null;
      renderDetail(); showLayoutAfter();
      revalidateStation(node, seq); // im Hintergrund auf Aktualitaet pruefen
      return;
    }
    // Kein Cache: sofort ein leichtes Platzhalter-Geruest zeigen, damit der Klick unmittelbar reagiert
    $('content').innerHTML = breadcrumb(node.id) + detailSkeleton();
    try {
      const full = await Api.getStationFull(sid);
      if (seq !== state.navSeq) return;            // Auswahl hat sich zwischenzeitlich geaendert -> verwerfen
      if (!full.nodeId) full.nodeId = node.id;
      cacheStation(sid, full);
      state.detail = full; state.detailEdit = false; state.detailDraft = null;
      renderDetail(); showLayoutAfter();
    } catch (e) {
      if (seq !== state.navSeq) return;
      $('content').innerHTML = breadcrumb(node.id) + '<div class="pad"><div class="card"><div class="card-body">' + t('Detail konnte nicht geladen werden.') + '</div></div></div>';
    }
  }

  function fmtDate(iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleDateString('de-DE'); }
  function fmtDateTime(iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }

  const schemaThumb = window.PMX.schemaThumb;

  function renderDetail() {
    const s = state.detail, ed = state.detailEdit, d = state.detailDraft || {};
    const name = ed ? d.name : s.anlagenname;
    const plcs = ed ? d.plcs : (s.plcs || []);

    const fld = (label, val, field, auto) => '<div class="fld ' + ((ed && !auto) ? 'editing' : '') + '"><label>' + label + '</label>'
      + (auto ? '<div class="val auto">' + esc(val || '–') + '</div>'
        : (ed ? '<input data-field="' + field + '" value="' + esc(val == null ? '' : val) + '">'
          : '<div class="val">' + esc(val || '–') + '</div>')) + '</div>';

    const numin = 'style="width:100px;text-align:right;border:1px solid var(--border);border-radius:6px;padding:3px 6px;font:inherit"';
    const plcRow = (p, i) => {
      if (!ed) {
        const _zc = (s.objects || []).filter((o) => (o.symbolType === 'fg_zone' || o.symbolType === 'sb_zone') && o.plcConfigId === p.id).length;
        return '<tr><td><div class="sps-name"><span class="sps-swatch" style="background:' + esc(p.color) + '"></span>' + esc(p.name)
          + (_zc ? '<span class="sps-zc" title="' + t('Zugeordnete Funktionsgruppen / Schutzbereiche') + '">' + _zc + ' ' + t(_zc === 1 ? 'Bereich' : 'Bereiche') + '</span>' : '') + '</div></td>'
          + '<td class="num">' + (p.cycleTimeMs || 0) + '</td><td class="num">' + Number(p.retentiveBytes || 0).toLocaleString('de-DE') + '</td><td class="num">' + (p.codeMemoryKb || 0) + '</td></tr>';
      }
      return '<tr>'
        + '<td><div class="sps-name"><input type="color" data-plc="' + i + '" data-pf="color" value="' + esc(p.color || '#0065A5') + '" style="width:22px;height:22px;padding:0;border:none;background:none;cursor:pointer">'
        + '<input class="sps-name-input" data-plc="' + i + '" data-pf="name" value="' + esc(p.name) + '" placeholder="SPS-Name"></div></td>'
        + '<td class="num"><input data-plc="' + i + '" data-pf="cycleTimeMs" value="' + (p.cycleTimeMs || 0) + '" ' + numin + '></td>'
        + '<td class="num"><input data-plc="' + i + '" data-pf="retentiveBytes" value="' + (p.retentiveBytes || 0) + '" ' + numin + '></td>'
        + '<td class="num"><input data-plc="' + i + '" data-pf="codeMemoryKb" value="' + (p.codeMemoryKb || 0) + '" ' + numin + '></td>'
        + '<td><button class="mini-btn del" data-act="plc-del" data-idx="' + i + '" title="Zeile löschen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></td></tr>';
    };

    const journal = (s.journal || []);
    const jlist = journal.length
      ? journal.map((j) => '<div class="j-item"><div class="j-dot"></div><div class="j-body"><div class="j-text">' + esc(j.text) + '</div><div class="j-meta">' + esc(j.author || '–') + ' · ' + fmtDateTime(j.createdAt) + '</div></div></div>').join('')
      : '<div style="color:var(--muted);font-size:13px;padding:6px 2px">' + t('Noch keine Einträge.') + '</div>';

    const html = '<div class="pad">'
      + '<div class="detail-top">'
      + '<div class="preview">'
      + ((s.hasLayout && state.layoutBlobUrl) ? '<img src="' + state.layoutBlobUrl + '" alt="Layout" style="width:100%;height:100%;object-fit:cover;display:block">' : schemaThumb())
      + '<button class="preview-upload" data-act="detail-upload" title="' + t('Layout hochladen') + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg> ' + (s.hasLayout ? t('Layout ersetzen') : t('Layout hochladen')) + '</button>'
      + '<div class="tag">' + (s.hasLayout ? t('eigenes Layout') : t('Schema-Layout · L1–L5')) + '</div>'
      + '<div class="open-hint" data-act="open-editor">MODELLIEREN ›</div></div>'
      + '<div><div class="detail-title"><h1>' + esc(name) + '</h1><div class="sub">' + esc(s.bereich || '–') + ' · OEM ' + esc(s.oem || '–') + '</div></div>'
      + '<div class="chips">'
      + '<div class="chip blue"><span class="mono">v' + esc(s.anlagenversion || '–') + '</span></div>'
      + '<div class="chip"><span class="mono">' + plcs.length + ' SPS</span></div>'
      + '<div class="chip">' + journal.length + ' ' + t('Journaleinträge') + '</div>'
      + '<div class="chip">Zuletzt: ' + fmtDate(s.letzteAenderung) + '</div></div>'
      + '<div class="action-bar" style="margin-top:16px;margin-bottom:0">'
      + (canEdit() ? '<button class="btn ' + (ed ? 'primary' : '') + '" data-act="toggle-edit">' + (ed ? t('SPEICHERN') : t('EDITIEREN')) + '</button>' : '')
      + '<button class="btn solid-dark" data-act="open-editor">' + t('MODELLIEREN') + '</button>'
      + '</div>'
      + (s.letzteAenderung
          ? '<div class="detail-lastedit" style="margin-top:10px;font-size:12px;color:var(--muted)">Letzte Änderung: ' + fmtDateTime(s.letzteAenderung) + (s.letzterBearbeiter ? ' · ' + esc(s.letzterBearbeiter) : '') + '</div>'
          : '')
      + '</div></div>'

      + '<div class="card"><div class="card-head"><h3>' + t('Stammdaten') + '</h3>' + (ed ? '<span class="badge" style="color:#0065A5;border-color:#0065A5">' + t('Bearbeitung') + '</span>' : '') + '</div>'
      + '<div class="card-body"><div class="form-grid">'
      + fld(t('Anlagenname'), name, 'name')
      + fld(t('Bereich'), ed ? d.bereich : s.bereich, 'bereich')
      + fld(t('OEM'), ed ? d.oem : s.oem, 'oem')
      + fld(t('Anlagenversion'), ed ? d.anlagenversion : s.anlagenversion, 'anlagenversion')
      + fld(t('Erstellt am'), fmtDate(s.erstelltAm), 'ea', true)
      + fld(t('Letzte Änderung'), fmtDate(s.letzteAenderung), 'la', true)
      + '<div class="fld wide ' + (ed ? 'editing' : '') + '"><label>' + t('Beschreibung') + '</label>'
      + (ed ? '<textarea data-field="beschreibung" rows="2" style="width:100%;resize:vertical">' + esc(d.beschreibung || '') + '</textarea>' : '<div class="val">' + esc(s.beschreibung || '–') + '</div>') + '</div>'
      + '</div></div></div>'

      + '<div class="card"><div class="card-head"><h3>' + t('SPS-Konfiguration') + '</h3><span class="badge">' + plcs.length + ' ' + t('Steuerungen') + '</span></div>'
      + '<div class="card-body"><table><thead><tr><th>' + t('Name') + '</th><th class="num">' + t('Zykluszeit [ms]') + '</th><th class="num">' + t('Remanenz [Byte]') + '</th><th class="num">' + t('Code-AS [kByte]') + '</th>' + (ed ? '<th></th>' : '') + '</tr></thead><tbody>'
      + (plcs.length ? plcs.map(plcRow).join('') : '<tr><td colspan="' + (ed ? 5 : 4) + '" style="color:var(--muted)">' + t('Keine SPS erfasst.') + '</td></tr>')
      + '</tbody></table>'
      + (ed ? '<button class="add-row-btn" data-act="plc-add"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> ' + t('SPS HINZUFÜGEN') + '</button>' : '')
      + '</div></div>'

      + '<div class="card"><div class="card-head"><h3>' + t('Änderungsjournal') + '</h3><span class="badge">' + journal.length + ' ' + (journal.length === 1 ? t('Änderung') : t('Änderungen')) + '</span></div>'
      + '<div class="card-body"><div class="journal-list">' + jlist + '</div>'
      + (canEdit() ? '<div class="j-add"><input id="jInput" placeholder="' + t('Neuer Eintrag …') + '"><button data-act="journal-add" aria-label="' + t('Eintrag hinzufügen') + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg></button></div>' : '')
      + '</div></div>'
      + '<div class="card"><div class="card-head"><h3>' + t('Dokumente') + '</h3><span class="badge" id="docCount">…</span></div>'
      + '<div class="card-body"><div class="doc-list" id="docList"><div class="doc-empty">' + t('Wird geladen …') + '</div></div>'
      + (state.isAdmin ? '<div class="doc-add"><button class="btn" data-act="doc-upload"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg> ' + t('Dokument hochladen') + '</button></div>' : '')
      + '</div></div>'
      + '<div class="card"><div class="card-head"><h3>' + t('Versionen') + '</h3><span class="badge" id="verCount">…</span></div>'
      + '<div class="card-body">'
      + (canEdit() ? '<div class="ver-save"><input id="verLabel" placeholder="' + t('Bezeichnung (optional)') + '" maxlength="120"><button class="btn" data-act="ver-save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v6h7M8 21v-6h8v6"/></svg> ' + t('Version speichern') + '</button></div>' : '')
      + '<div class="ver-list" id="verList"><div class="doc-empty">' + t('Wird geladen …') + '</div></div>'
      + '</div></div>'
      + '</div>';

    $('content').innerHTML = breadcrumb(s.nodeId) + html;
    loadDocuments(s.id);
    loadVersions(s.id);
  }

  function enterEdit() {
    const s = state.detail;
    state.detailEdit = true;
    state.detailDraft = {
      name: s.anlagenname, bereich: s.bereich, oem: s.oem,
      anlagenversion: s.anlagenversion, beschreibung: s.beschreibung,
      plcs: (s.plcs || []).map((p) => Object.assign({}, p)), _deleted: [],
    };
    renderDetail();
  }

  async function saveDetail() {
    const s = state.detail, d = state.detailDraft, sid = s.id;
    try {
      if ((d.name || '') !== (s.anlagenname || '')) await Api.updateNode(s.nodeId, { name: d.name });
      const patch = {};
      ['bereich', 'oem', 'anlagenversion', 'beschreibung'].forEach((k) => { if ((d[k] || '') !== (s[k] || '')) patch[k] = d[k]; });
      if (Object.keys(patch).length) await Api.updateStation(sid, patch);
      for (const id of d._deleted) await Api.deletePlc(id);
      const orig = {}; (s.plcs || []).forEach((p) => { orig[p.id] = p; });
      for (const p of d.plcs) {
        const payload = { name: p.name, cycleTimeMs: +p.cycleTimeMs || 0, retentiveBytes: +p.retentiveBytes || 0, codeMemoryKb: +p.codeMemoryKb || 0, color: p.color };
        if (!p.id) { await Api.addPlc(sid, payload); }
        else {
          const o = orig[p.id];
          if (o && (o.name !== p.name || (+o.cycleTimeMs) !== (+p.cycleTimeMs) || (+o.retentiveBytes) !== (+p.retentiveBytes) || (+o.codeMemoryKb) !== (+p.codeMemoryKb) || o.color !== p.color)) {
            await Api.updatePlc(p.id, payload);
          }
        }
      }
      toast(t('Gespeichert'));
    } catch (e) { toast(t('Speichern fehlgeschlagen: ') + e.message); }
    state.detailEdit = false; state.detailDraft = null;
    try { const full = await Api.getStationFull(sid); full.nodeId = s.nodeId; state.detail = full; cacheStation(sid, full); } catch (e) { /* ignore */ }
    await loadTree();
    renderDetail();
  }

  async function addJournalEntry() {
    const inp = document.getElementById('jInput'); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';
    try { await Api.addJournal(state.detail.id, text); } catch (e) { toast(t('Journaleintrag fehlgeschlagen')); return; }
    try { const sid2 = state.detail.id; const full = await Api.getStationFull(sid2); full.nodeId = state.detail.nodeId; state.detail = full; cacheStation(sid2, full); } catch (e) { /* ignore */ }
    renderDetail();
  }

  // ---- Dokumente je Anlage (PDF/Word/Excel) ----
  function fmtBytes(n) { n = Number(n) || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
  function docExt(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  async function loadDocuments(stationId) {
    const host = $('docList'); if (!host) return;
    let docs = [];
    try { docs = await Api.getDocuments(stationId); } catch (e) { host.innerHTML = '<div class="doc-empty">' + t('Dokumente konnten nicht geladen werden.') + '</div>'; return; }
    if ($('docCount')) $('docCount').textContent = docs.length;
    if (!docs.length) { host.innerHTML = '<div class="doc-empty">' + t('Noch keine Dokumente.') + '</div>'; return; }
    host.innerHTML = docs.map(function (d) {
      const ext = docExt(d.filename);
      const meta = fmtBytes(d.byteSize) + (d.createdAt ? ' · ' + fmtDate(d.createdAt) : '') + (d.uploadedBy ? ' · ' + esc(d.uploadedBy) : '');
      return '<div class="doc-row">'
        + '<span class="doc-ext ext-' + esc(ext || 'dat') + '">' + esc((ext || 'dat').toUpperCase()) + '</span>'
        + '<button class="doc-name" data-act="doc-open" data-id="' + esc(d.id) + '" data-name="' + esc(d.filename) + '" data-mime="' + esc(d.mimeType || '') + '" title="' + t('Öffnen / Herunterladen') + '"><span class="doc-fn">' + esc(d.filename) + '</span><small>' + esc(meta) + '</small></button>'
        + (state.isAdmin ? '<button class="doc-del" data-act="doc-del" data-id="' + esc(d.id) + '" data-name="' + esc(d.filename) + '" title="' + t('Löschen') + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg></button>' : '')
        + '</div>';
    }).join('');
  }
  function triggerDocUpload() { const el = $('docFile'); if (el) el.click(); }
  async function onDocFile(e) {
    const files = e.target.files ? Array.prototype.slice.call(e.target.files) : []; e.target.value = '';
    if (!files.length || !state.detail) return;
    if (state.uploadingDoc) return;
    const valid = [];
    files.forEach(function (f) {
      const ext = docExt(f.name);
      if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].indexOf(ext) < 0) { toast('„' + f.name + '": ' + t('Nur PDF, Word oder Excel erlaubt.')); return; }
      if (f.size > 25 * 1024 * 1024) { toast('„' + f.name + '": ' + t('Datei zu groß (max. 25 MB).')); return; }
      valid.push(f);
    });
    if (!valid.length) return;
    state.uploadingDoc = true;
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < valid.length; i++) {
        toast(valid.length > 1 ? (t('Dokumente werden hochgeladen …') + ' (' + (i + 1) + '/' + valid.length + ')') : t('Dokument wird hochgeladen …'));
        try { await Api.uploadDocument(state.detail.id, valid[i]); ok++; } catch (e2) { fail++; }
      }
      toast(fail ? (ok + ' ' + t('hochgeladen') + ', ' + fail + ' ' + t('fehlgeschlagen')) : (ok === 1 ? t('Dokument hochgeladen') : ok + ' ' + t('Dokumente hochgeladen')));
      loadDocuments(state.detail.id);
    } finally { state.uploadingDoc = false; }
  }
  async function openDoc(id, name, mime) {
    if (!state.detail) return;
    try {
      const res = await Api.documentResponse(state.detail.id, id);
      if (!res.ok) { toast(t('Download fehlgeschlagen')); return; }
      const url = URL.createObjectURL(await res.blob());
      if (/pdf/i.test(mime || '') || /\.pdf$/i.test(name || '')) { window.open(url, '_blank'); }
      else { const a = document.createElement('a'); a.href = url; a.download = name || 'dokument'; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    } catch (e) { toast(t('Download fehlgeschlagen')); }
  }
  async function deleteDoc(id, name) {
    if (!state.detail) return;
    if (!window.confirm(t('Dokument wirklich löschen?') + '\n\n' + (name || ''))) return;
    try { await Api.deleteDocument(state.detail.id, id); toast(t('Dokument gelöscht')); loadDocuments(state.detail.id); }
    catch (e) { toast(t('Löschen fehlgeschlagen')); }
  }

  // ---- Versionierung je Anlage (Snapshots) ----
  async function loadVersions(stationId) {
    const host = $('verList'); if (!host) return;
    state.editVer = null;
    try { state.versions = await Api.getVersions(stationId); } catch (e) { state.versions = null; host.innerHTML = '<div class="doc-empty">' + t('Versionen konnten nicht geladen werden.') + '</div>'; return; }
    renderVersions();
  }
  function renderVersions() {
    const host = $('verList'); if (!host) return;
    const list = state.versions || [];
    if ($('verCount')) $('verCount').textContent = list.length;
    if (!list.length) { host.innerHTML = '<div class="doc-empty">' + t('Noch keine Versionen gespeichert.') + '</div>'; return; }
    host.innerHTML = list.map(function (v) {
      const meta = fmtDateTime(v.createdAt) + (v.createdBy ? ' · ' + esc(v.createdBy) : '') + ' · ' + v.objectCount + ' ' + t('Objekte');
      if (state.editVer === v.id) {
        return '<div class="ver-row editing">'
          + '<span class="ver-no">v' + v.versionNo + '</span>'
          + '<input class="ver-edit-input" id="verEditInput" maxlength="120" value="' + esc(v.label || '') + '" placeholder="' + t('Bezeichnung (optional)') + '">'
          + '<button class="ver-btn" data-act="ver-edit-save" data-id="' + esc(v.id) + '" title="' + t('Speichern') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg></button>'
          + '<button class="doc-del" data-act="ver-edit-cancel" title="' + t('Abbrechen') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
          + '</div>';
      }
      return '<div class="ver-row">'
        + '<span class="ver-no">v' + v.versionNo + '</span>'
        + '<div class="ver-info"><span class="ver-label">' + esc(v.label || (t('Version') + ' ' + v.versionNo)) + '</span><small>' + esc(meta) + (v.comment ? ' — ' + esc(v.comment) : '') + '</small></div>'
        + (canEdit() ? '<button class="ver-btn" data-act="ver-edit" data-id="' + esc(v.id) + '" title="' + t('Umbenennen') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' : '')
        + (canEdit() ? '<button class="ver-btn" data-act="ver-restore" data-id="' + esc(v.id) + '" data-no="' + v.versionNo + '" title="' + t('Wiederherstellen') + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>' : '')
        + (state.isAdmin ? '<button class="doc-del" data-act="ver-del" data-id="' + esc(v.id) + '" data-no="' + v.versionNo + '" title="' + t('Löschen') + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg></button>' : '')
        + '</div>';
    }).join('');
    if (state.editVer) {
      const inp = $('verEditInput'), editId = state.editVer;
      if (inp) {
        inp.focus(); inp.select();
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); saveEditVersion(editId); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelEditVersion(); }
        });
      }
    }
  }
  function startEditVersion(id) { state.editVer = id; renderVersions(); }
  function cancelEditVersion() { state.editVer = null; renderVersions(); }
  async function saveEditVersion(id) {
    if (!state.detail || !id) return;
    const inp = $('verEditInput'); const label = inp ? inp.value.trim() : '';
    state.editVer = null;
    try {
      const updated = await Api.updateVersion(state.detail.id, id, { label: label || null });
      if (state.versions) { const i = state.versions.findIndex(function (x) { return x.id === id; }); if (i >= 0) state.versions[i] = updated; }
      toast(t('Version umbenannt'));
    } catch (e) { toast(t('Umbenennen fehlgeschlagen')); }
    renderVersions();
  }
  async function saveVersion() {
    if (!state.detail || state.savingVersion) return;
    const inp = $('verLabel');
    const label = inp ? inp.value.trim() : '';
    state.savingVersion = true;
    toast(t('Version wird gespeichert …'));
    try { await Api.createVersion(state.detail.id, { label: label || null }); if (inp) inp.value = ''; toast(t('Version gespeichert')); loadVersions(state.detail.id); }
    catch (e) { toast((e && e.message) ? e.message : t('Speichern fehlgeschlagen')); }
    finally { state.savingVersion = false; }
  }
  async function restoreVersionUi(id, no) {
    if (!state.detail) return;
    if (!window.confirm(t('Diese Version wiederherstellen?') + '\n\n' + t('Version') + ' ' + no + '\n' + t('Der aktuelle Stand wird vorher automatisch gesichert.'))) return;
    const sid = state.detail.id;
    toast(t('Version wird wiederhergestellt …'));
    try {
      await Api.restoreVersion(sid, id);
      const full = await Api.getStationFull(sid); full.nodeId = state.detail.nodeId; state.detail = full; cacheStation(sid, full);
      toast(t('Version wiederhergestellt'));
      renderDetail();
    } catch (e) { toast((e && e.message) ? e.message : t('Wiederherstellen fehlgeschlagen')); }
  }
  async function deleteVersionUi(id, no) {
    if (!state.detail) return;
    if (!window.confirm(t('Version wirklich löschen?') + '\n\n' + t('Version') + ' ' + no)) return;
    try { await Api.deleteVersion(state.detail.id, id); toast(t('Version gelöscht')); loadVersions(state.detail.id); }
    catch (e) { toast(t('Löschen fehlgeschlagen')); }
  }

  function onContentClick(e) {
    // Schutzbereich zeichnen: Klick auf die Zeichenfläche setzt Stützpunkte
    if (state.drawZone) {
      const doc = e.target.closest('#canvasDoc');
      if (doc) {
        const r = doc.getBoundingClientRect();
        let x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
        const _sn = snapCursor(x, y); x = _sn.x; y = _sn.y; // Ausrichtung H/V an eigenen Punkten; nhzone dockt nicht an (dt=null)
        if (state.drawShape === 'route') {
          if (state.zoneDraft.length >= 2) {
            const last = state.zoneDraft[state.zoneDraft.length - 1];
            if (Math.hypot((last.x - x) * r.width, (last.y - y) * r.height) < 12) { finishRoute(); return; }
          }
          state.zoneDraft.push({ x, y }); renderEditor(); return;
        }
        if (state.zoneDraft.length >= 3) {
          const f = state.zoneDraft[0];
          if (Math.hypot((f.x - x) * r.width, (f.y - y) * r.height) < 12) { finishZone(); return; }
        }
        state.zoneDraft.push({ x, y }); renderEditor(); return;
      }
    }
    if (e.target.closest('.oname-edit')) return;
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'toggle-edit') { state.detailEdit ? saveDetail() : enterEdit(); }
    else if (act === 'plc-add') { state.detailDraft.plcs.push({ id: null, name: nextSpsName(state.detailDraft.plcs), cycleTimeMs: 0, retentiveBytes: 0, codeMemoryKb: 0, color: PLC_COLORS[state.detailDraft.plcs.length % PLC_COLORS.length] }); renderDetail(); }
    else if (act === 'plc-del') { const i = +el.getAttribute('data-idx'); const p = state.detailDraft.plcs[i]; if (p && p.id) state.detailDraft._deleted.push(p.id); state.detailDraft.plcs.splice(i, 1); renderDetail(); }
    else if (act === 'journal-add') { addJournalEntry(); }
    else if (act === 'open-editor') { openEditor(); }
    else if (act === 'open-station') { selectNode(el.getAttribute('data-id')); }
    else if (act === 'goto-obj') { e.stopPropagation(); gotoObject(el.getAttribute('data-node'), el.getAttribute('data-obj')); }
    else if (act === 'pick-layer') { state.linieActiveLayer = el.getAttribute('data-layer'); renderLinieFolders(); }
    else if (act === 'linie-tab') { const tab = el.getAttribute('data-tab'); document.querySelectorAll('.linie-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); }); const d = $('linieTabDash'), c = $('linieTabComments'), p = $('linieTabProjekt'), ch = $('linieTabChanges'); if (d) d.hidden = tab !== 'dash'; if (c) c.hidden = tab !== 'comments'; if (p) p.hidden = tab !== 'projekt'; if (ch) ch.hidden = tab !== 'changes'; }
    else if (act === 'pj-save') { saveLinieProjekt(el.getAttribute('data-node')); }
    else if (act === 'collab-details') { state.collab.detailsOpen = !state.collab.detailsOpen; renderPresenceOnly(); }
    else if (act === 'editor-back') { leaveEditor(); }
    else if (act === 'tree-toggle') { const a = document.querySelector('.app'); if (a) a.classList.toggle('tree-open'); }
    else if (act === 'station-prev') { gotoStation(-1); }
    else if (act === 'station-next') { gotoStation(1); }
    else if (act === 'editor-upload') { triggerUpload(); }
    else if (act === 'detail-upload') { triggerUpload(); }
    else if (act === 'doc-upload') { triggerDocUpload(); }
    else if (act === 'doc-open') { openDoc(el.getAttribute('data-id'), el.getAttribute('data-name'), el.getAttribute('data-mime')); }
    else if (act === 'doc-del') { deleteDoc(el.getAttribute('data-id'), el.getAttribute('data-name')); }
    else if (act === 'ver-save') { saveVersion(); }
    else if (act === 'ver-edit') { startEditVersion(el.getAttribute('data-id')); }
    else if (act === 'ver-edit-save') { saveEditVersion(el.getAttribute('data-id')); }
    else if (act === 'ver-edit-cancel') { cancelEditVersion(); }
    else if (act === 'ver-restore') { restoreVersionUi(el.getAttribute('data-id'), el.getAttribute('data-no')); }
    else if (act === 'ver-del') { deleteVersionUi(el.getAttribute('data-id'), el.getAttribute('data-no')); }
    else if (act === 'zoom-in') { zoomStep(0.1); }
    else if (act === 'zoom-out') { zoomStep(-0.1); }
    else if (act === 'toggle-snap') { state.snapGrid = !state.snapGrid; try { localStorage.setItem('promodx_snapgrid', state.snapGrid ? '1' : '0'); } catch (e) { /* noop */ } renderEditor(); }
    else if (act === 'layer-select') { selectLayer(el.getAttribute('data-layer')); }
    else if (act === 'layer-eye') { e.stopPropagation(); if (!canEdit()) { toast('Nur Lesezugriff'); return; } toggleLayerVis(el.getAttribute('data-layer')); }
    else if (act === 'export-pdf') { exportFile('pdf'); }
    else if (act === 'export-csv') { exportFile('csv'); }
    else if (act === 'detect-robots') { detectRobotsFlow(); }
    else if (act === 'rob-confirm') { e.stopPropagation(); confirmRobotSuggestion(parseInt(el.getAttribute('data-idx'), 10)); }
    else if (act === 'rob-dismiss') { e.stopPropagation(); dismissRobotSuggestion(parseInt(el.getAttribute('data-idx'), 10)); }
    else if (act === 'rob-dismiss-all') { state.robotSuggestions = []; renderEditor(); }
    else if (act === 'tpl-reset') { try { localStorage.removeItem('promodx_robot_templates'); } catch (e) { /* */ } state.tplPanel = false; toast(t('Gelernte Vorlagen zurückgesetzt.')); renderEditor(); }
    else if (act === 'tpl-panel') { state.tplPanel = !state.tplPanel; renderEditor(); }
    else if (act === 'tpl-del') { delTplEntry(el.getAttribute('data-id')); renderEditor(); }
    else if (act === 'neg-reset') { saveTplLib(posLib()); toast(t('Fehlbeispiele zurückgesetzt.')); renderEditor(); }
    else if (act === 'comment-open') { state.openComment = el.getAttribute('data-id'); renderEditor(); setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30); }
    else if (act === 'comment-close') { closeCommentWindow(); }
    else if (act === 'comment-send') { sendCommentMsg(); }
    else if (act === 'comment-delete') { deleteComment(el.getAttribute('data-id')); }
    else if (act === 'tpl-learn-yes') { confirmLearnPrompt(); }
    else if (act === 'tpl-learn-no') { dismissLearnPrompt(); }
    else if (act === 'obj-edit') { e.stopPropagation(); openTagModal(el.getAttribute('data-obj')); }
    else if (act === 'obj-del') { e.stopPropagation(); deleteObjectById(el.getAttribute('data-obj')); }
    else if (act === 'cat-del-all') { e.stopPropagation(); deleteCategoryObjects(el.getAttribute('data-cat')); }
    else if (act === 'obj-focus') { focusObjInLayout(el.getAttribute('data-obj')); }
    else if (act === 'obj-name') {
      const oid = el.getAttribute('data-obj'); const now = Date.now();
      if (state._nameClick && state._nameClick.id === oid && (now - state._nameClick.t) < 450) { state._nameClick = null; startObjRename(oid); }
      else { state._nameClick = { id: oid, t: now }; focusObjInLayout(oid); }
    }
    else if (act === 'pal-hint') { /* nur Hinweis-Titel, kein Toast beim Ziehen */ }
    else if (act === 'pal-add') { openSymUpload(); }
    else if (act === 'pal-edit') { e.stopPropagation(); const c = state.customSyms['custom:' + el.getAttribute('data-id')]; if (c) openSymUpload(c); }
    else if (act === 'pal-del') { e.stopPropagation(); deleteCustomSym(el.getAttribute('data-id')); }
    else if (act === 'pal-tab') {
      const t = el.getAttribute('data-ptab'); state.palTab = t;
      document.querySelectorAll('.palette .pal-tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-ptab') === t));
      document.querySelectorAll('.palette [data-ppanel]').forEach((p) => { p.style.display = p.getAttribute('data-ppanel') === t ? '' : 'none'; });
    }
    else if (act === 'toggle-zone') { const on = !(state.drawZone && state.drawShape === 'zone'); state.drawZone = on; state.drawShape = on ? 'zone' : null; state.zoneDraft = []; state.zoneCursor = null; if (on) state.selectedZone = null; renderEditor(); }
    else if (act === 'toggle-spszone') { const on = !(state.drawZone && state.drawShape === 'spszone'); state.drawZone = on; state.drawShape = on ? 'spszone' : null; state.zoneDraft = []; state.zoneCursor = null; if (on) state.selectedZone = null; renderEditor(); }
    else if (act === 'toggle-nhzone') { const on = !(state.drawZone && state.drawShape === 'nhzone'); state.drawZone = on; state.drawShape = on ? 'nhzone' : null; state.zoneDraft = []; state.zoneCursor = null; if (on) state.selectedZone = null; renderEditor(); }
    else if (act === 'gen-nothalt') { generateNotHaltBoundary(); }
    else if (act === 'undo') { doUndo(); }
    else if (act === 'redo') { doRedo(); }
    else if (act === 'toggle-route') { const on = !(state.drawZone && state.drawShape === 'route'); state.drawZone = on; state.drawShape = on ? 'route' : null; state.zoneDraft = []; state.zoneCursor = null; if (on) state.selectedZone = null; renderEditor(); }
    else if (act === 'flow-type') { state.flowType = parseInt(el.getAttribute('data-flow'), 10) || 0; renderEditor(); }
    else if (act === 'flow-legend') { state.flowLegend = !state.flowLegend; renderEditor(); }
  }
  function onContentInput(e) {
    if (e.target && e.target.id === 'satRange') { onSat(e.target.value); return; }
    if (!state.detailDraft) return;
    const f = e.target.closest('[data-field]');
    if (f) { state.detailDraft[f.getAttribute('data-field')] = f.value; return; }
    const p = e.target.closest('[data-plc]');
    if (p) {
      const i = +p.getAttribute('data-plc'), pf = p.getAttribute('data-pf');
      let v = p.value;
      if (pf === 'cycleTimeMs' || pf === 'retentiveBytes' || pf === 'codeMemoryKb') v = parseInt(v || '0', 10) || 0;
      state.detailDraft.plcs[i][pf] = v;
    }
  }
  function onContentKey(e) {
    if (e.target && e.target.id === 'jInput' && e.key === 'Enter') { e.preventDefault(); addJournalEntry(); }
  }

