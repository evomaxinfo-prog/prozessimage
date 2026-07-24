  function breadcrumb(id) {
    const chain = []; let cur = findNode(id);
    while (cur) { chain.unshift(cur); cur = cur._parent; }
    return '<div class="breadcrumb">' + chain.map((n, i) => {
      const last = i === chain.length - 1;
      return '<span class="crumb ' + (last ? 'last' : '') + '">' + esc(n.name.split(' – ')[0].split(' · ')[0]) + '</span>'
        + (last ? '' : '<span class="sep">›</span>');
    }).join('') + '</div>';
  }

  function renderWelcome() {
    $('content').innerHTML = '<div class="welcome"><div class="welcome-inner">'
      + '<img class="welcome-logo" src="img/logo.png?v=0.25.18" alt="ProModXgOEM2">'
      + '<h2>' + t('Anlage auswählen') + '</h2>'
      + '<p>Navigiere links durch die Struktur. Neue Knoten legst du mit dem +-Symbol an. Detailansicht und Editor folgen in den nächsten Schritten.</p>'
      + (state.isAdmin ? '<button class="btn solid-dark" data-act="open-changes">' + t('Änderungen aller Werke') + '</button>' : '')
      + '</div></div>';
  }

  async function renderWerk(node) {
    $('content').innerHTML = breadcrumb(node.id) + '<div class="werk-wrap"><div class="werk-head"><div>'
      + '<h1>' + esc(node.name) + '</h1><p>' + t('Gesamtübersicht') + '</p></div></div>'
      + '<div class="zone-stats" id="werkStats">'
      + '<div class="stat b"><div class="k">…</div><div class="l">' + t('Anlagen') + '</div></div>'
      + '<div class="stat"><div class="k">…</div><div class="l">' + t('Center') + '</div></div>'
      + '<div class="stat"><div class="k">…</div><div class="l">' + t('SPS gesamt') + '</div></div>'
      + '<div class="stat"><div class="k">…</div><div class="l">' + t('Dokumentiert') + '</div></div></div></div>';
    try {
      const o = await Api.getWerkOverview(node.id);
      $('werkStats').innerHTML =
        '<div class="stat b"><div class="k">' + o.anlagen + '</div><div class="l">' + t('Anlagen') + '</div></div>'
        + '<div class="stat"><div class="k">' + o.center + '</div><div class="l">' + t('Center') + '</div></div>'
        + '<div class="stat"><div class="k">' + o.sps + '</div><div class="l">' + t('SPS gesamt') + '</div></div>'
        + '<div class="stat"><div class="k">' + o.dokumentiertPercent + '%</div><div class="l">' + t('Dokumentiert') + '</div></div>';
    } catch (e) { /* leer lassen */ }
  }

  /* -------- Linien-Dashboard: Übersicht aller unterlagerten Stationen -------- */
  const collectStationNodes = window.PMX.collectStationNodes;
  // Mini-Editor-Vorschau seitenverhältnis-treu: viewBox hat das Layout-Seitenverhältnis, Objekte in 0–1 → skaliert.
  function stationPreviewSvg(full, aspect) {
    const a = aspect && aspect > 0 ? aspect : (760 / 520);
    const vbW = a >= 1 ? 100 : 100 * a;
    const vbH = a >= 1 ? 100 / a : 100;
    const dot = (Math.min(vbW, vbH) * 0.02).toFixed(2);
    let inner = '';
    (full.objects || []).forEach((o) => {
      if (o.points && o.points.length >= 2) {
        const pts = o.points.map((p) => (p.x * vbW).toFixed(1) + ',' + (p.y * vbH).toFixed(1)).join(' ');
        let col = o.color || '#8FA3B0';
        if (o.symbolType === 'sb_zone' || o.symbolType === 'fg_zone') { const p = o.plcConfigId && (full.plcs || []).find((x) => x.id === o.plcConfigId); col = (p && p.color) ? p.color : '#9AA7B2'; }
        if (/zone/.test(o.symbolType || '') && o.points.length >= 3) inner += '<polygon points="' + pts + '" fill="' + col + '" fill-opacity="0.16" stroke="' + col + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
        else inner += '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
      } else if (o.x != null && o.y != null) {
        inner += '<circle cx="' + (o.x * vbW).toFixed(1) + '" cy="' + (o.y * vbH).toFixed(1) + '" r="' + dot + '" fill="' + (o.color || '#0065A5') + '" stroke="#fff" stroke-width="0.8" vector-effect="non-scaling-stroke"/>';
      }
    });
    return '<svg class="lc-ov" viewBox="0 0 ' + vbW.toFixed(1) + ' ' + vbH.toFixed(1) + '" preserveAspectRatio="xMidYMid meet">' + inner + '</svg>';
  }
  // ---- Projektdaten je Linie (Tab 1.0): Felder werden serverseitig je Node gespeichert ----
  const PJ_FIELDS = (window.PMX && window.PMX.PJ_FIELDS) || [];
  async function loadLinieProjekt(nodeId) {
    const host = $('linieProjekt'); if (!host) return;
    let data = {}, meta = null, missing = false;
    try { const res = await Api.getProjectData(nodeId); data = (res && res.data) || {}; meta = res || null; }
    catch (e) { missing = true; }
    const ro = !canEdit();
    const field = (f) => {
      const val = data[f[0]] != null ? String(data[f[0]]) : '';
      const dis = (ro || missing) ? ' disabled' : '';
      let inp;
      if (f[2] === 'select') inp = '<select id="pj_' + f[0] + '"' + dis + '>' + f[3].map((o) => '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + (o || '—') + '</option>').join('') + '</select>';
      else inp = '<input id="pj_' + f[0] + '" type="' + f[2] + '" value="' + esc(val) + '"' + dis + '>';
      return '<div class="pj-field"><label>' + f[1] + '</label>' + inp + '</div>';
    };
    host.innerHTML = (missing ? '<div class="pj-note">Backend-Endpunkt „Projektdaten" ist noch nicht installiert – Anzeige ohne Speichern. (Dateien liegen bereit.)</div>' : '')
      + '<div class="pj-grid">' + PJ_FIELDS.map(field).join('') + '</div>'
      + '<div class="pj-field pj-notes"><label>Notizen</label><textarea id="pj_notizen" rows="4"' + ((ro || missing) ? ' disabled' : '') + '>' + esc(data.notizen != null ? String(data.notizen) : '') + '</textarea></div>'
      + ((!ro && !missing) ? '<div class="pj-foot"><button class="btn pj-save" data-act="pj-save" data-node="' + esc(nodeId) + '">Speichern</button>'
        + (meta && meta.updatedAt ? '<span class="pj-meta">Zuletzt gespeichert: ' + fmtDateTime(meta.updatedAt) + '</span>' : '') + '</div>' : '');
  }
  async function saveLinieProjekt(nodeId) {
    const data = {};
    PJ_FIELDS.forEach((f) => { const el = $('pj_' + f[0]); if (el) data[f[0]] = el.value || ''; });
    const nz = $('pj_notizen'); if (nz) data.notizen = nz.value || '';
    try { await Api.setProjectData(nodeId, data); toast('Projektdaten gespeichert'); loadLinieProjekt(nodeId); }
    catch (e) { toast('Speichern fehlgeschlagen'); }
  }
  async function renderLinie(node) {
    if (_linieTabNode !== node.id) { _linieTabNode = node.id; _linieTab = 'projekt'; } // andere Linie -> wieder Tab 1
    const stations = collectStationNodes(node);
    (state.linieBlobs || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
    state.linieBlobs = [];
    const skel = (n) => '<div class="line-card" data-act="open-station" data-id="' + n.id + '" title="Station öffnen">'
      + '<div class="lc-thumb" id="lct-' + n.id + '"><span class="lc-load-mini">lädt …</span></div>'
      + '<div class="lc-body"><div class="lc-name">' + esc(n.name) + '</div>'
      + '<div class="lc-meta" id="lcm-' + n.id + '"><span class="lc-load">lädt …</span></div>'
      + '<div class="lc-open">Station öffnen ›</div></div></div>';
    $('content').innerHTML = breadcrumb(node.id)
      + '<div class="werk-wrap"><div class="werk-head"><div><h1>' + esc(node.name) + '</h1></div></div>'
      + '<div class="linie-tabs">'
      +   '<button class="linie-tab active" data-act="linie-tab" data-tab="projekt"><span class="lt-num">1.0</span> Projektdaten</button>'
      +   '<button class="linie-tab" data-act="linie-tab" data-tab="dash"><span class="lt-num">2.0</span> Linie Dashboard</button>'
      +   '<button class="linie-tab" data-act="linie-tab" data-tab="comments"><span class="lt-num">3.0</span> Kommentare Gesamtübersicht<span class="lt-badge" id="linieCommentsCount" hidden></span></button>'
      +   (state.isAdmin ? '<button class="linie-tab" data-act="linie-tab" data-tab="changes"><span class="lt-num">4.0</span> ' + t('Änderungsindex') + '<span class="lt-badge" id="linieChangesCount" hidden></span></button>' : '')
      + '</div>'
      + '<div id="linieTabProjekt" class="linie-tabpanel"><div id="linieProjekt" class="linie-projekt-panel"><div class="pad" style="color:var(--muted)">lädt …</div></div></div>'
      + '<div id="linieTabDash" class="linie-tabpanel" hidden>'
      + '<div class="ls-section-title">Übersicht <span>allgemeine Themen</span></div>'
      + '<div class="zone-stats rich" id="linieStats">'
      + '<div class="stat b"><span class="stat-ic">' + KPI_ICONS.stations + '</span><span class="stat-txt"><span class="k">' + stations.length + '</span><span class="l">' + t('Stationen') + '</span></span></div>'
      + '<div class="stat"><span class="stat-ic">' + KPI_ICONS.sps + '</span><span class="stat-txt"><span class="k">…</span><span class="l">SPS gesamt</span></span></div>'
      + '<div class="stat"><span class="stat-ic">' + KPI_ICONS.objects + '</span><span class="stat-txt"><span class="k">…</span><span class="l">' + t('Objekte') + '</span></span></div>'
      + '<div class="stat"><span class="stat-ic">' + KPI_ICONS.doc + '</span><span class="stat-txt"><span class="k">…</span><span class="l">Dokumentiert</span></span></div></div>'
      + (stations.length ? '<div class="line-grid">' + stations.map(skel).join('') + '</div>'
        : '<div class="pad" style="color:var(--muted)">Keine Stationen unter dieser Linie.</div>')
      + '<div class="ls-section-title" id="linieEbTitle" style="display:none">Ebenen <span>aufgeteilt nach Dokumentations-Ebene · je Ebene ein Folder</span></div>'
      + '<div id="linieFolders" class="line-sec"></div>'
      + '</div>'
      + '<div id="linieTabComments" class="linie-tabpanel" hidden>'
      +   '<div id="linieComments" class="linie-comments-panel"></div>'
      + '</div>'
      + (state.isAdmin ? '<div id="linieTabChanges" class="linie-tabpanel" hidden><div class="ls-section-title">' + t('Änderungsindex') + ' <span>' + t('protokollierte Änderungen der Stationen dieser Linie · nach Tagen gruppiert, neueste zuerst') + '</span></div><div id="linieChanges"><div class="pad" style="color:var(--muted)">lädt …</div></div></div>' : '')
      + '</div>';
    applyLinieTab(_linieTab);
    loadLinieProjekt(node.id);
    if (!stations.length) return;
    let sps = 0, objs = 0, docn = 0; const ptkRows = [], roboRows = [], layerAgg = {}, commentsByStation = [], changesRows = [];
    await Promise.all(stations.map(async (n) => {
      try {
        const [full, stComments0] = await Promise.all([Api.getStationFull(n.stationId), Api.getComments(n.stationId).catch(function () { return []; })]);
        const stComments = Array.isArray(stComments0) ? stComments0 : [];
        const nP = (full.plcs || []).length, nO = (full.objects || []).length, nL = (full.layers || []).length;
        const isDoc = nO > 0 || !!full.hasLayout;
        sps += nP; objs += nO; if (isDoc) docn++;
        const m = $('lcm-' + n.id); if (m) m.innerHTML = '<span><i class="lc-mi">' + KPI_ICONS.sps + '</i><b>' + nP + '</b> SPS</span><span><i class="lc-mi">' + KPI_ICONS.objects + '</i><b>' + nO + '</b> Objekte</span><span><i class="lc-mi">' + KPI_ICONS.layers + '</i><b>' + nL + '</b> Ebenen</span>';
        // Editor-Vorschau: Layout-Bild (falls vorhanden) + platzierte Objekte/Zonen als Mini-Overlay
        let layoutUrl = null, aspect = 760 / 520;
        if (full.hasLayout) {
          try {
            const res = await Api.raw('/stations/' + n.stationId + '/layout');
            if (res && res.ok) {
              layoutUrl = URL.createObjectURL(await res.blob()); state.linieBlobs.push(layoutUrl);
              aspect = await new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 760 / 520); im.onerror = () => resolve(760 / 520); im.src = layoutUrl; });
            }
          } catch (e) { /* ohne Bild */ }
        }
        const t = $('lct-' + n.id);
        if (t) t.innerHTML = (layoutUrl ? '<img class="lc-bg" src="' + esc(layoutUrl) + '" alt="">' : '') + stationPreviewSvg(full, aspect)
          + '<span class="lc-badge ' + (isDoc ? 'doc' : 'undoc') + '">' + (isDoc ? 'Dokumentiert' : 'Offen') + '</span>';
        const lname = {}; (full.layers || []).forEach((l) => { lname[l.id] = l.name; });
        const stName = full.anlagenname || n.name;
        if (stComments.length) commentsByStation.push({ node: n.id, station: stName, comments: stComments, layers: full.layers || [] });
        (full.journal || []).forEach(function (j) { changesRows.push({ id: j.id, station: stName, text: j.text, author: j.author, createdAt: j.createdAt }); });
        (full.layers || []).forEach((l) => {
          if (!layerAgg[l.name]) layerAgg[l.name] = { objects: 0, stations: new Set(), color: l.color, code: l.code, syms: {} };
          layerAgg[l.name].stations.add(n.id);
          if (l.color && !layerAgg[l.name].color) layerAgg[l.name].color = l.color;
        });
        (full.objects || []).forEach((o) => {
          const ln = lname[o.layerId];
          if (ln && layerAgg[ln]) { layerAgg[ln].objects++; layerAgg[ln].syms[o.symbolType] = (layerAgg[ln].syms[o.symbolType] || 0) + 1; }
          if (/^ptk_/.test(o.symbolType)) {
            const mt = o.metatags || [];
            const val = (lbl) => (mt.find((x) => x.label === lbl) || {}).value || '';
            const pflicht = mt.filter((x) => /^Pflicht \u2013 /.test(x.label || ''));
            const filled = pflicht.filter((x) => x.value && String(x.value).trim()).length;
            ptkRows.push({ st: stName, node: n.id, oid: o.id, no: o.symbolType.replace('ptk_', ''), sym: o.symbolType, pt: val('Prozesstyp') || o.name, fg: val('Funktionsgruppen'), filled: filled, total: pflicht.length });
          }
          if (lname[o.layerId] === 'Saferobot / Technologie') {
            const mt2 = o.metatags || [];
            const gv = (lbl) => (mt2.find((x) => x.label === lbl) || {}).value || '';
            roboRows.push({ st: stName, node: n.id, oid: o.id, type: o.symbolType, name: o.name, safe: gv('Safe Funktion'), tech: gv('Technologie') });
          }
        });
      } catch (e) {
        const m = $('lcm-' + n.id); if (m) m.innerHTML = '<span class="lc-err">nicht ladbar</span>';
        const t = $('lct-' + n.id); if (t) t.innerHTML = '<span class="lc-load-mini">—</span>';
      }
    }));
    const st = $('linieStats');
    if (st) st.innerHTML = '<div class="stat b"><span class="stat-ic">' + KPI_ICONS.stations + '</span><span class="stat-txt"><span class="k">' + stations.length + '</span><span class="l">' + t('Stationen') + '</span></span></div>'
      + '<div class="stat"><span class="stat-ic">' + KPI_ICONS.sps + '</span><span class="stat-txt"><span class="k">' + sps + '</span><span class="l">SPS gesamt</span></span></div>'
      + '<div class="stat"><span class="stat-ic">' + KPI_ICONS.objects + '</span><span class="stat-txt"><span class="k">' + objs + '</span><span class="l">' + t('Objekte') + '</span></span></div>'
      + '<div class="stat"><span class="stat-ic">' + KPI_ICONS.doc + '</span><span class="stat-txt"><span class="k">' + Math.round(100 * docn / stations.length) + '%</span><span class="l">Dokumentiert</span></span></div>';
    // Ebenen als horizontale Ordner (Tabs): Daten merken, aktive Ebene wählen
    const names = Object.keys(layerAgg);
    const withObj = names.filter((nm) => layerAgg[nm].objects > 0).sort((a, b) => { const ia = LAYER_ORDER.indexOf(a), ib = LAYER_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    state.linieActiveLayer = withObj[0] || names[0] || null;
    state.linieData = { agg: layerAgg, ptkRows: ptkRows, roboRows: roboRows };
    const ebT = $('linieEbTitle'); if (ebT) ebT.style.display = names.length ? '' : 'none';
    renderLinieFolders();
    const lcHost = $('linieComments'); if (lcHost) {
      const lcHtml = linieCommentsHtml(commentsByStation);
      lcHost.innerHTML = lcHtml || '<div class="pad" style="color:var(--muted)">Keine Kommentare in dieser Linie.</div>';
      const total = commentsByStation.reduce(function (s, x) { return s + (x.comments || []).length; }, 0);
      const cc = $('linieCommentsCount'); if (cc) { cc.textContent = total; cc.hidden = !total; }
    }
    if (state.isAdmin) {
      const chHost = $('linieChanges'); if (chHost) chHost.innerHTML = linieChangesHtml(changesRows);
      const chc = $('linieChangesCount'); if (chc) { chc.textContent = changesRows.length; chc.hidden = !changesRows.length; }
    }
  }
  // Kommentar-Uebersicht im Linien-Dashboard: alle Pins je Station inkl. Nachrichtenverlauf.
  const lcoInitials = window.PMX.lcoInitials;
  const lcoColor = window.PMX.lcoColor;
  let _linieTab = 'projekt', _linieTabNode = null; // aktiver Linie-Tab, damit er ein Neurendern ueberlebt
  function applyLinieTab(tab) {
    const map = { projekt: 'linieTabProjekt', dash: 'linieTabDash', comments: 'linieTabComments', changes: 'linieTabChanges' };
    if (!map[tab] || !$(map[tab])) tab = 'projekt'; // z.B. Aenderungsindex bei Nicht-Admins
    _linieTab = tab;
    document.querySelectorAll('.linie-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    Object.keys(map).forEach(function (k) { const el = $(map[k]); if (el) el.hidden = k !== tab; });
  }
  let _ciDayIds = {}; // Tages-Schluessel -> Journal-Eintrags-IDs (fuer "Tag löschen")
