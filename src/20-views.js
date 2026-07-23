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
      +   (state.isAdmin ? '<button class="linie-tab" data-act="linie-tab" data-tab="changes"><span class="lt-num">4.0</span> Änderungsindex<span class="lt-badge" id="linieChangesCount" hidden></span></button>' : '')
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
      + (state.isAdmin ? '<div id="linieTabChanges" class="linie-tabpanel" hidden><div class="ls-section-title">Änderungsindex <span>protokollierte Änderungen der Stationen dieser Linie · nach Tagen gruppiert, neueste zuerst</span></div><div id="linieChanges"><div class="pad" style="color:var(--muted)">lädt …</div></div></div>' : '')
      + '</div>';
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
  let _ciDayIds = {}; // Tages-Schluessel -> Journal-Eintrags-IDs (fuer "Tag löschen")
  async function deleteChangesDay(day) {
    const ids = (_ciDayIds[day] || []).slice();
    if (!ids.length) return;
    if (!window.confirm('Alle Änderungseinträge vom ' + day + ' löschen?\n\n' + ids.length + (ids.length === 1 ? ' Eintrag wird' : ' Einträge werden') + ' dauerhaft entfernt – auch im Änderungsjournal der jeweiligen Station.')) return;
    const res = await Promise.all(ids.map(function (id) {
      return Api.deleteJournal(id).then(function () { return true; }).catch(function () { return false; });
    }));
    const failed = res.filter(function (ok) { return !ok; }).length;
    toast(failed ? ((ids.length - failed) + ' von ' + ids.length + ' gelöscht, ' + failed + ' fehlgeschlagen') : (ids.length + (ids.length === 1 ? ' Eintrag gelöscht' : ' Einträge gelöscht')));
    if (state.selected) selectNode(state.selected); // Ansicht frisch laden
  }
  // Änderungsindex (admin-only): nach Tagen geclustert, neuester Tag zuerst.
  function linieChangesHtml(rows) {
    if (!rows || !rows.length) return '<div class="pad" style="color:var(--muted)">Keine protokollierten Änderungen in dieser Linie.</div>';
    const fmtTimeOnly = function (iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
    const sorted = rows.slice().sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    const order = [], byDay = {};
    _ciDayIds = {};
    sorted.forEach(function (r) {
      const key = fmtDate(r.createdAt);
      if (!byDay[key]) { byDay[key] = []; order.push(key); _ciDayIds[key] = []; }
      byDay[key].push(r);
      if (r.id) _ciDayIds[key].push(r.id);
    });
    return order.map(function (day) {
      const list = byDay[day];
      const body = list.map(function (r) {
        return '<tr><td>' + esc(r.station) + '</td><td>' + esc(r.text || '–') + '</td><td style="white-space:nowrap">' + fmtTimeOnly(r.createdAt) + '</td><td>' + esc(r.author || '–') + '</td></tr>';
      }).join('');
      const delBtn = state.isAdmin ? '<button class="ci-del" data-act="ci-del-day" data-day="' + esc(day) + '">Tag löschen</button>' : '';
      return '<div class="ci-day"><div class="ci-day-head">' + esc(day) + '<span>' + list.length + (list.length === 1 ? ' Eintrag' : ' Einträge') + '</span>' + delBtn + '</div>'
        + '<div class="ls-scroll"><table class="ls-tbl"><thead><tr><th>Station</th><th>Art der Änderung</th><th>Uhrzeit</th><th>Von wem</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
    }).join('');
  }
  function linieCommentsHtml(byStation) {
    if (!byStation || !byStation.length) return '';
    byStation.sort(function (a, b) { return String(a.station).localeCompare(String(b.station)); });
    const commentIc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>';
    const me = (state.user && state.user.email) || '';
    return byStation.map(function (g) {
      const lmap = {}; (g.layers || []).forEach(function (l) { lmap[l.id] = l; });
      const pins = (g.comments || []).map(function (c) {
        const clusters = [];
        (c.messages || []).forEach(function (m) {
          const who = m.author || '—';
          const last = clusters[clusters.length - 1];
          if (last && last.author === who) last.msgs.push(m);
          else clusters.push({ author: who, msgs: [m] });
        });
        const turns = clusters.map(function (cl) {
          const who = cl.author;
          const own = (me && who === me) ? ' own' : '';
          const bubbles = cl.msgs.map(function (m) { return '<div class="lco-bubble">' + esc(m.text) + '</div>'; }).join('');
          return '<div class="lco-turn' + own + '"><span class="lco-av" style="background-color:' + lcoColor(who) + '">' + esc(lcoInitials(who)) + '</span>'
            + '<div class="lco-col"><div class="lco-mhead"><span class="lco-author">' + esc(who) + '</span><span class="lco-time">' + fmtCommentTime(cl.msgs[0].ts) + '</span></div>' + bubbles + '</div></div>';
        }).join('') || '<div class="lco-empty">' + t('Noch keine Nachrichten – schreib den ersten Kommentar.') + '</div>';
        const ly = c.layerId && lmap[c.layerId];
        const lyChip = ly ? '<div class="lco-pin-head"><span class="lco-lyr"><span class="lco-lyr-dot" style="background:' + esc(ly.color || '#0065A5') + '"></span><span class="lco-lyr-code">' + esc(ly.code || '') + '</span>' + (ly.name ? ' ' + esc(t(ly.name)) : '') + '</span></div>' : '';
        return '<div class="lco-pin">' + lyChip + turns + '</div>';
      }).join('');
      return '<div class="lco-station"><div class="lco-st-head" data-act="open-station" data-id="' + esc(g.node) + '" title="Station öffnen">'
        + '<span class="lco-st-ic">' + commentIc + '</span>'
        + '<span class="lco-st-name">' + esc(g.station) + '</span>'
        + '<span class="lco-st-count">' + (g.comments || []).length + '</span>'
        + '<span class="lco-open">öffnen ›</span></div>' + pins + '</div>';
    }).join('');
  }
  const LAYER_ORDER = ['Materialfluss', 'Funktionsgruppen', 'Steuerungstechnik', 'Saferobot / Technologie', 'Antriebstechnik / Ident', 'Not-Halt', 'Sicherheitslayout', 'Prozesstypen'];
  const KPI_ICONS = {
    stations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="9" width="7" height="12" rx="1"/><rect x="14" y="4" width="7" height="17" rx="1"/><path d="M2 21h20"/></svg>',
    sps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9.5 2v3M14.5 2v3M9.5 19v3M14.5 19v3M2 9.5h3M2 14.5h3M19 9.5h3M19 14.5h3"/></svg>',
    objects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/></svg>',
  };
  const LAYER_ICON = { 'Materialfluss': 'xfer', 'Funktionsgruppen': 'cell', 'Steuerungstechnik': 'cab', 'Saferobot / Technologie': 'robot', 'Antriebstechnik / Ident': 'motor', 'Not-Halt': 'estop', 'Sicherheitslayout': 'door', 'Prozesstypen': 'box' };
  function layerIconSvg(nm, px) { return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '">' + (SYM[LAYER_ICON[nm]] || SYM.box) + '</svg>'; }
  // ---- Konfigurierbare Palette: eigene Symbole je Werk & Ebene ----
  function werkOf(node) { let p = node; while (p && p.type !== 'werk') p = p._parent; return p || null; }
  function currentWerk() { const cur = state.byId[(state.detail && state.detail.nodeId) || state.selected]; return cur ? werkOf(cur) : null; }
  async function loadCustomSyms(werkId, opts) {
    opts = opts || {};
    if (!opts.force && state.customWerkId === werkId && state.customSyms) return;
    if (!werkId) {
      (state.customBlobs || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
      state.customBlobs = []; state.customSyms = {}; state.customWerkId = null; return;
    }
    const prev = (state.customWerkId === werkId && state.customSyms) ? state.customSyms : {};
    const refetch = opts.refetch || {};
    let list; try { list = await Api.getPaletteSymbols(werkId); } catch (e) { return; }
    const arr = Array.isArray(list) ? list : (list && Array.isArray(list.data) ? list.data : []);
    const next = {}; const used = [];
    await Promise.all(arr.map(async (s) => {
      const key = 'custom:' + s.id;
      const cached = prev[key];
      let url = '';
      if (cached && cached.url && !refetch[s.id]) {
        url = cached.url; // vorhandenen Blob wiederverwenden (kein erneuter Download)
      } else {
        try { const res = await Api.raw('/palette/' + s.id + '/image'); if (res && res.ok) { url = URL.createObjectURL(await res.blob()); } } catch (e) { /* ohne Bild */ }
      }
      if (url) used.push(url);
      next[key] = { id: s.id, name: s.name, layerCode: s.layerCode, url: url, fields: Array.isArray(s.fields) ? s.fields : [] };
    }));
    // Nicht mehr verwendete Blobs (gelöschte / ersetzte Symbole) freigeben
    (state.customBlobs || []).forEach((u) => { if (used.indexOf(u) < 0) { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } } });
    state.customBlobs = used; state.customSyms = next; state.customWerkId = werkId;
  }
  // Symbol-Inhalt: eigenes Bild (custom:) oder Standard-SVG.
  function symInner(symbolType, px) {
    const c = state.customSyms && state.customSyms[symbolType];
    if (c) return c.url ? '<img class="sym-img" draggable="false" src="' + esc(c.url) + '" alt="" style="width:' + px + 'px;height:' + px + 'px">' : '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24">' + SYM.box + '</svg>';
    return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24">' + (SYM[symbolType] || SYM.box) + '</svg>';
  }
  // Feld-Konfiguration eines eigenen Symbols (Überschrift + Typ text/select + Optionen).
  function defaultCustomFields() { return [{ label: 'Text 1', type: 'text', options: [] }, { label: 'Text 2', type: 'text', options: [] }]; }
  function symFields(symbolType) {
    const c = state.customSyms && state.customSyms[symbolType];
    return (c && c.fields && c.fields.length) ? c.fields : defaultCustomFields();
  }
  // symbolType -> Anzeigename je Ebene (aus der Palette; Zonen/Förderwege/Prozesstypen gesondert).
  function symLabelsFor(nm) {
    const map = {};
    const meta = LAYER_META[nm];
    if (meta && meta.palette) meta.palette.forEach((p) => { let st = p[1]; if (st === 'zone') st = (nm === 'Funktionsgruppen') ? 'fg_zone' : 'sb_zone'; map[st] = p[0]; });
    if (nm === 'Materialfluss') map.mf_route = 'Förderweg';
    return map;
  }
  // KPI-Vorschlag je Ebene (erweitert).
  function layerKpis(nm, a, ptkRows, roboRows) {
    const ns = a.stations.size || 1;
    const avg = Math.round((a.objects / ns) * 10) / 10;
    const labels = symLabelsFor(nm);
    const symChips = Object.keys(a.syms).sort((x, y) => a.syms[y] - a.syms[x]).map((st) => ({ val: a.syms[st], label: labels[st] || (/^ptk_/.test(st) ? 'Prozesstyp' : st) }));
    if (nm === 'Prozesstypen') {
      const zug = ptkRows.filter((r) => r.fg).length;
      const komplett = ptkRows.filter((r) => r.total > 0 && r.filled >= r.total && r.fg).length;
      const offen = ptkRows.length - komplett;
      const sumT = ptkRows.reduce((s, r) => s + r.total, 0), sumF = ptkRows.reduce((s, r) => s + r.filled, 0);
      const rate = sumT ? Math.round(100 * sumF / sumT) : 100;
      const typen = new Set(ptkRows.map((r) => r.sym)).size;
      return [
        { val: ptkRows.length, label: 'Prozesstypen' },
        { val: typen, label: 'verschiedene Typen' },
        { val: avg, label: 'Ø je Station' },
        { val: zug, label: 'einer FG zugeordnet', tone: 'ok' },
        { val: ptkRows.length - zug, label: 'ohne FG', tone: (ptkRows.length - zug) ? 'warn' : '' },
        { val: komplett, label: 'Pflichtfelder vollständig', tone: 'ok' },
        { val: offen, label: 'offen', tone: offen ? 'warn' : '' },
        { val: rate + '%', label: 'Pflichtfelder ausgefüllt', tone: rate >= 100 ? 'ok' : (rate < 50 ? 'warn' : '') },
      ];
    }
    if (nm === 'Saferobot / Technologie') {
      const robs = roboRows.filter((r) => r.type === 'robot');
      const byCol = (cols) => robs.filter((r) => cols.indexOf(ROBOT_RISK_COLOR[r.safe]) >= 0).length;
      const techs = new Set(robs.map((r) => r.tech).filter(Boolean));
      const unbew = robs.filter((r) => !r.safe).length;
      const out = symChips.concat([
        { val: byCol(['#DC2626', '#EA580C']), label: 'hohes Risiko', tone: 'danger' },
        { val: byCol(['#CA8A04']), label: 'geringes Risiko', tone: 'warn' },
        { val: byCol(['#2563EB']), label: 'Bedienerschutz' },
        { val: byCol(['#16A34A']), label: 'kein Risiko', tone: 'ok' },
      ]);
      if (unbew) out.push({ val: unbew, label: 'ohne Safe-Funktion', tone: 'warn' });
      out.push({ val: techs.size, label: t('Technologien') });
      return out;
    }
    if (nm === 'Funktionsgruppen') {
      const fgCount = a.syms.fg_zone || 0;
      const zug = ptkRows.filter((r) => r.fg).length;
      const out = symChips.concat([{ val: zug, label: 'zugeordnete Prozesstypen', tone: 'ok' }]);
      if (fgCount) out.push({ val: Math.round((zug / fgCount) * 10) / 10, label: 'Ø Prozesstypen je FG' });
      out.push({ val: avg, label: 'Ø je Station' });
      return out;
    }
    if (nm === 'Materialfluss') {
      const routes = a.syms.mf_route || 0; const src = a.syms.src || 0; const snk = a.syms.snk || 0;
      const out = symChips.slice();
      if (routes) out.push({ val: routes, label: 'Förderwege' });
      if (src || snk) out.push({ val: src + snk, label: 'Quellen + Senken' });
      out.push({ val: avg, label: 'Ø je Station' });
      return out;
    }
    if (nm === 'Steuerungstechnik') {
      const sb = a.syms.sb_zone || 0;
      const out = symChips.slice();
      if (sb) out.push({ val: sb, label: 'Schutzbereiche', tone: 'ok' });
      out.push({ val: avg, label: 'Ø je Station' });
      return out;
    }
    return symChips.concat([{ val: avg, label: 'Ø je Station' }]);
  }
  function panelHtml(nm, a, ptkRows, roboRows) {
    const col = a.color || '#8FA3B0'; const ns = a.stations.size;
    const chips = layerKpis(nm, a, ptkRows, roboRows).map((k) => '<span class="lk-chip ' + (k.tone || '') + '"><b>' + k.val + '</b> ' + esc(k.label) + '</span>').join('');
    let detail = '';
    if (nm === 'Prozesstypen') detail = linieStatusHtml(ptkRows);
    else if (nm === 'Saferobot / Technologie') detail = linieRobotsHtml(roboRows);
    return '<div class="lp-head" style="--lc:' + col + '"><span class="lp-ic" style="color:' + col + '">' + layerIconSvg(nm, 22) + '</span><b>' + esc(t(nm)) + '</b>'
      + (a.code ? '<span class="lay-code">' + esc(a.code) + '</span>' : '')
      + '<span class="lf-meta">' + a.objects + ' Objekt' + (a.objects !== 1 ? 'e' : '') + ' · ' + ns + ' Station' + (ns !== 1 ? 'en' : '') + '</span></div>'
      + (chips ? '<div class="lk-chips">' + chips + '</div>' : '<div class="lk-empty">Keine Objekte auf dieser Ebene.</div>') + detail;
  }
  function renderLinieFolders() {
    const host = $('linieFolders'); if (!host || !state.linieData) return;
    const d = state.linieData; const agg = d.agg;
    const names = Object.keys(agg).sort((a, b) => { const ia = LAYER_ORDER.indexOf(a), ib = LAYER_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
    if (!names.length) { host.innerHTML = ''; return; }
    if (!state.linieActiveLayer || !agg[state.linieActiveLayer]) state.linieActiveLayer = names.filter((nm) => agg[nm].objects > 0)[0] || names[0];
    const tabs = names.map((nm) => {
      const a = agg[nm]; const active = nm === state.linieActiveLayer; const col = a.color || '#8FA3B0';
      return '<button class="lay-tab ' + (active ? 'active' : '') + (a.objects ? '' : ' empty') + '" data-act="pick-layer" data-layer="' + esc(nm) + '" style="--lc:' + col + '">'
        + '<span class="lt-ic" style="color:' + col + '">' + layerIconSvg(nm, 16) + '</span>'
        + '<span class="lt-name">' + esc(t(nm)) + '</span>'
        + '<span class="lt-n">' + a.objects + '</span></button>';
    }).join('');
    host.innerHTML = '<div class="lay-tabs">' + tabs + '</div><div class="lay-panel">' + panelHtml(state.linieActiveLayer, agg[state.linieActiveLayer], d.ptkRows, d.roboRows) + '</div>';
  }
  // Prozesstyp-Statusbericht (Zuordnung zur Funktionsgruppe + Pflichtfeld-Vollständigkeit) – aggregiert über die Linie.
  function linieStatusHtml(rows) {
    if (!rows.length) return '<div class="ls-head">Prozesstyp-Status</div><div class="ls-empty">Keine Prozesstypen auf dieser Linie platziert.</div>';
    rows.sort((a, b) => String(a.st).localeCompare(String(b.st)) || (+a.no - +b.no));
    const body = rows.map((r) => {
      const pct = r.total ? Math.round(100 * r.filled / r.total) : 100;
      const ok = r.filled >= r.total && !!r.fg;
      const bar = ok ? '#16A34A' : '#E0A800';
      return '<tr><td class="ls-st">' + esc(r.st) + '</td>'
        + '<td class="ls-ic"><span class="ls-icbtn" data-act="goto-obj" data-node="' + esc(r.node) + '" data-obj="' + esc(r.oid) + '" title="Im Editor öffnen (Metatags)"><svg viewBox="0 0 24 24" width="20" height="20">' + (SYM[r.sym] || SYM.box) + '</svg></span></td>'
        + '<td class="ls-no">' + esc(r.no) + '</td>'
        + '<td class="ls-pt">' + esc(r.pt) + '</td>'
        + '<td>' + (r.fg ? '<span class="ls-fg">' + esc(r.fg) + '</span>' : '<span class="ls-none">nicht zugeordnet</span>') + '</td>'
        + '<td><span class="ls-bar"><span style="width:' + pct + '%;background:' + bar + '"></span></span><span class="ls-pc">' + r.filled + '/' + r.total + '</span></td>'
        + '<td>' + (ok ? '<span class="ls-ok">✓ vollständig</span>' : '<span class="ls-warn">⚠ offen</span>') + '</td></tr>';
    }).join('');
    return '<div class="ls-head">Prozesstyp-Status <span class="ls-sub">Zuordnung &amp; Pflichtfelder · ' + rows.length + ' Prozesstyp' + (rows.length !== 1 ? 'en' : '') + '</span></div>'
      + '<div class="ls-scroll"><table class="ls-tbl"><thead><tr><th>Station</th><th>Icon</th><th>No</th><th>Prozesstyp</th><th>Funktionsgruppe</th><th>Pflichtfelder</th><th>Status</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  // Übersicht der Objekte der Ebene „Saferobot / Technologie".
  function linieRobotsHtml(rows) {
    const LBL = { robot: 'Roboter', ctrl: 'Techno-Steuerung', grip: 'Greifer', cell: 'Zelle' };
    if (!rows.length) return '<div class="ls-head">' + t('Roboter · Safe & Technologie') + '</div><div class="ls-empty">' + t('Keine Objekte dieser Ebene auf dieser Linie.') + '</div>';
    rows.sort((a, b) => String(a.st).localeCompare(String(b.st)) || String(a.type).localeCompare(String(b.type)));
    const cnt = {}; rows.forEach((r) => { cnt[r.type] = (cnt[r.type] || 0) + 1; });
    const summary = Object.keys(LBL).filter((k) => cnt[k]).map((k) => '<span class="ls-chip"><svg viewBox="0 0 24 24" width="14" height="14">' + (SYM[k] || SYM.box) + '</svg>' + cnt[k] + '× ' + LBL[k] + '</span>').join('');
    const body = rows.map((r) => {
      const sc = ROBOT_RISK_COLOR[r.safe];
      const iconCol = (r.type === 'robot' && sc) ? sc : '';
      const safeCell = r.safe ? '<span class="ls-safe">' + (sc ? '<i style="background:' + sc + '"></i>' : '') + esc(r.safe) + '</span>' : '<span class="ls-dash">—</span>';
      const techCell = r.tech ? esc(r.tech) : '<span class="ls-dash">—</span>';
      return '<tr><td class="ls-st">' + esc(r.st) + '</td>'
        + '<td class="ls-ic"><span class="ls-icbtn" data-act="goto-obj" data-node="' + esc(r.node) + '" data-obj="' + esc(r.oid) + '" title="Im Editor öffnen (Metatags)"><svg viewBox="0 0 24 24" width="20" height="20"' + (iconCol ? ' style="color:' + iconCol + '"' : '') + '>' + (SYM[r.type] || SYM.box) + '</svg></span></td>'
        + '<td>' + esc(LBL[r.type] || r.type) + '</td><td class="ls-pt">' + esc(r.name) + '</td>'
        + '<td>' + safeCell + '</td><td class="ls-tech">' + techCell + '</td></tr>';
    }).join('');
    return '<div class="ls-head">' + t('Roboter · Safe & Technologie') + ' <span class="ls-sub">' + rows.length + ' ' + (rows.length !== 1 ? t('Objekte') : t('Objekt')) + '</span></div>'
      + (summary ? '<div class="ls-chips">' + summary + '</div>' : '')
      + '<div class="ls-scroll"><table class="ls-tbl"><thead><tr><th>Station</th><th>Icon</th><th>Typ</th><th>Bezeichnung</th><th>Safe-Funktion</th><th>Technologie</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // Aus dem Linien-Dashboard direkt ins Layout des Objekts springen und dessen Metatags öffnen.
  async function gotoObject(nodeId, objId) {
    const n = findNode(nodeId); if (!n) return;
    state.selected = nodeId; state.confirmDelete = null;
    try { if (!(await loadStationDetail(n))) { renderTree(); return; } } catch (e) { toast(t('Station konnte nicht geladen werden')); return; }
    const o = (state.detail.objects || []).find((x) => x.id === objId);
    if (o && o.layerId) state.activeLayer = o.layerId;
    await openEditor();
    if (o) openTagModal(objId);
    renderTree();
  }

  // Nachbar-Stationen (Modellierungen) innerhalb derselben Linie.
  function lineSiblings() {
    const cur = state.byId[(state.detail && state.detail.nodeId) || state.selected];
    if (!cur) return null;
    let p = cur._parent; while (p && p.type !== 'linie') p = p._parent;
    if (!p) return null;
    const stations = collectStationNodes(p);
    const idx = stations.findIndex((n) => n.id === cur.id);
    if (idx < 0) return null;
    return { stations: stations, idx: idx, line: p };
  }
  // Stationsdaten laden, ohne die Detail-Ansicht zu rendern (für direkten Editor-Wechsel ohne Flackern).
