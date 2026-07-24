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
