  async function loadTree() {
    try {
      state.tree = await Api.getTree();
    } catch (e) { toast('Baum konnte nicht geladen werden'); return; }
    indexTree();
    renderTree();
    if (state.pendingStation) { const pid = state.pendingStation; state.pendingStation = null; openDeepLink(pid); }
  }
  function indexTree() {
    state.byId = {};
    const walk = (nodes, parent) => nodes.forEach((n) => { n._parent = parent; state.byId[n.id] = n; if (n.children) walk(n.children, n); });
    walk(state.tree, null);
  }
  function findNode(id) { return state.byId[id] || null; }

  // Adresszeile spiegelt die offene Anlage (teilbarer Direktlink); null = Parameter entfernen.
  function setStationUrl(nodeId) {
    try { history.replaceState(null, '', nodeId ? (location.pathname + '?station=' + encodeURIComponent(nodeId)) : location.pathname); } catch (e) { /* noop */ }
  }
  function copyStationLink(id) {
    const url = location.origin + location.pathname + '?station=' + encodeURIComponent(id);
    const ok = () => toast(t('Direktlink kopiert'));
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(ok, () => window.prompt(t('Direktlink:'), url)); }
      else { window.prompt(t('Direktlink:'), url); }
    } catch (e) { window.prompt(t('Direktlink:'), url); }
  }
  // ---- QR-Code zur Anlage (zeigt auf den Direktlink) ----
  function openQrModal(nodeId) {
    const node = findNode(nodeId); if (!node) return;
    if (typeof qrcode === 'undefined') { toast(t('QR-Code konnte nicht erzeugt werden')); return; }
    const url = location.origin + location.pathname + '?station=' + encodeURIComponent(nodeId);
    let dataUrl = '';
    try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); dataUrl = qr.createDataURL(8, 4); }
    catch (e) { toast(t('QR-Code konnte nicht erzeugt werden')); return; }
    const name = esc(node.name || 'Anlage');
    closeQrModal();
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="qr-backdrop" id="qrBackdrop"><div class="qr-card" role="dialog" aria-modal="true">'
      + '<button class="qr-x" data-qr="close" title="' + t('Schließen') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      + '<div class="qr-title">' + name + '</div>'
      + '<div class="qr-sub">' + t('Direktlink zur Anlage – scannen zum Öffnen') + '</div>'
      + '<div class="qr-img"><img src="' + dataUrl + '" alt="QR"></div>'
      + '<div class="qr-url">' + esc(url) + '</div>'
      + '<div class="qr-actions"><button class="btn" data-qr="download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v12M8 12l4 4 4-4M5 20h14"/></svg> ' + t('PNG herunterladen') + '</button><button class="btn primary" data-qr="print"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/></svg> ' + t('Drucken') + '</button></div>'
      + '</div></div>';
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('qrBackdrop');
    bd.addEventListener('mousedown', (ev) => { bd._down = (ev.target.id === 'qrBackdrop'); });
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'qrBackdrop') { if (bd._down) closeQrModal(); bd._down = false; return; }
      const a = ev.target.closest('[data-qr]'); if (!a) return;
      const act = a.getAttribute('data-qr');
      if (act === 'close') closeQrModal();
      else if (act === 'download') downloadQr(dataUrl, node.name);
      else if (act === 'print') printQr(dataUrl, node.name, url);
    });
    document.addEventListener('keydown', qrEsc);
    state._qrPrevFocus = document.activeElement;
    const xbtn = bd.querySelector('.qr-x'); if (xbtn) { try { xbtn.focus(); } catch (_) { /* noop */ } }
  }
  function qrEsc(e) { if (e.key === 'Escape') closeQrModal(); }
  function closeQrModal() {
    const b = document.getElementById('qrBackdrop'); if (b) b.remove();
    document.removeEventListener('keydown', qrEsc);
    const pf = state._qrPrevFocus; state._qrPrevFocus = null;
    if (pf && pf.focus) { try { pf.focus(); } catch (_) { /* noop */ } }
  }
  function downloadQr(dataUrl, name) {
    const img = new Image();
    img.onload = function () {
      const S = 900, c = document.createElement('canvas'); c.width = S; c.height = S;
      const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S); ctx.drawImage(img, 0, 0, S, S);
      const a = document.createElement('a'); a.href = c.toDataURL('image/png');
      a.download = 'QR_' + String(name || 'Anlage').replace(/[^\w\-]+/g, '_') + '.png'; a.click();
    };
    img.src = dataUrl;
  }
  function printQr(dataUrl, name, url) {
    const w = window.open('', '_blank'); if (!w) { toast(t('Popup wurde blockiert')); return; }
    w.document.write('<html><head><title>QR ' + esc(name) + '</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#1E2A33}img{width:300px;height:300px;image-rendering:pixelated;border:1px solid #ddd;border-radius:8px}h2{margin:6px 0 2px}small{color:#777;word-break:break-all;font-size:11px}</style></head><body><h2>' + esc(name) + '</h2><small>' + esc(url) + '</small><br><br><img src="' + dataUrl + '"></body></html>');
    w.document.close(); w.focus(); setTimeout(function () { try { w.print(); } catch (e) { /* noop */ } }, 350);
  }
  // ---- Knoten-Aktionsmenü (Drei-Punkte) ----
  function runNodeAction(act, id) {
    if (act === 'add') addChild(id);
    else if (act === 'dup') duplicateAnlage(findNode(id));
    else if (act === 'link') copyStationLink(id);
    else if (act === 'qr') openQrModal(id);
    else if (act === 'rename') startRename(id);
    else if (act === 'del') { state.confirmDelete = id; state.editingNodeId = null; renderTree(); }
  }
  function nodeMenuKey(e) {
    const m = document.getElementById('nodeMenu'); if (!m) return;
    if (e.key === 'Escape') { e.preventDefault(); closeNodeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.prototype.slice.call(m.querySelectorAll('.nm-item'));
      const cur = items.indexOf(document.activeElement);
      const nx = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      if (items[nx]) items[nx].focus();
    }
  }
  function nodeMenuOutside(e) { const m = document.getElementById('nodeMenu'); if (m && !m.contains(e.target)) closeNodeMenu(); }
  function closeNodeMenu() {
    const m = document.getElementById('nodeMenu'); if (m) m.remove();
    document.removeEventListener('keydown', nodeMenuKey, true);
    document.removeEventListener('mousedown', nodeMenuOutside, true);
    const pf = state._nmPrevFocus; state._nmPrevFocus = null;
    if (pf && pf.focus) { try { pf.focus(); } catch (_) { /* noop */ } }
  }
  function openNodeMenu(id, btnEl) {
    closeNodeMenu();
    const n = findNode(id); if (!n) return;
    state._nmPrevFocus = btnEl;
    const ct = childType(n.type);
    const IC = {
      add: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
      dup: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="1.6"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
      link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5"/></svg>',
      qr: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3M14 17v4M17 14v3M20 14v3M17 20h4M20 20v1"/></svg>',
      pen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg>',
      del: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>'
    };
    const items = [];
    if (ct) items.push(['add', IC.add, TYPE_LABEL[ct] + ' ' + t('hinzufügen'), false]);
    if (n.type === 'anlage') {
      items.push(['dup', IC.dup, t('Anlage duplizieren'), false]);
      items.push(['link', IC.link, t('Direktlink kopieren'), false]);
      items.push(['qr', IC.qr, t('QR-Code zur Anlage'), false]);
    }
    items.push(['rename', IC.pen, t('Umbenennen'), false]);
    items.push(['del', IC.del, t('Löschen'), true]);
    const menu = document.createElement('div');
    menu.id = 'nodeMenu'; menu.className = 'node-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map((it) => '<button class="nm-item' + (it[3] ? ' danger' : '') + '" role="menuitem" data-nm="' + it[0] + '">' + it[1] + '<span>' + esc(it[2]) + '</span></button>').join('');
    document.body.appendChild(menu);
    const r = btnEl.getBoundingClientRect();
    const mw = menu.offsetWidth || 200, mh = menu.offsetHeight || 200;
    let left = r.right - mw; if (left < 8) left = 8;
    let top = r.bottom + 4; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-nm]'); if (!b) return;
      const act = b.getAttribute('data-nm'); closeNodeMenu(); runNodeAction(act, id);
    });
    const first = menu.querySelector('.nm-item'); if (first) { try { first.focus(); } catch (_) { /* noop */ } }
    setTimeout(() => {
      document.addEventListener('keydown', nodeMenuKey, true);
      document.addEventListener('mousedown', nodeMenuOutside, true);
    }, 0);
  }
  // Beim Start per ?station=<Knoten-ID | Station-ID> direkt zur Anlage springen.
  function openDeepLink(id) {
    let node = findNode(id);
    if (!node) { const all = state.byId || {}; node = Object.keys(all).map((k) => all[k]).find((n) => n.stationId === id) || null; }
    if (!node || node.type !== 'anlage') { toast(t('Verlinkte Anlage nicht gefunden')); return; }
    let p = node._parent; while (p) { state.expanded.add(p.id); p = p._parent; }
    selectNode(node.id);
    setTimeout(() => { const row = document.querySelector('[data-act="select"][data-id="' + node.id + '"]'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' }); }, 60);
  }

  function renderTree() {
    $('treeScroll').innerHTML = state.tree.map(nodeHTML).join('');
    updateToggleAllIcon();
  }
  function treeAllExpanded() { const ids = allExpandableIds(); return ids.length > 0 && ids.every((id) => state.expanded.has(id)); }
  function updateToggleAllIcon() {
    const b = $('btnToggleAll'); if (!b) return;
    const open = treeAllExpanded();
    b.innerHTML = open
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5l4 4 4-4M8 19l4-4 4 4"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>';
    b.title = open ? t('Alles zuklappen') : t('Alles aufklappen');
  }
  function toggleAllTree() {
    if (treeAllExpanded()) state.expanded = new Set();
    else state.expanded = new Set(allExpandableIds());
    renderTree();
  }

  function nodeHTML(n) {
    const open = state.expanded.has(n.id);
    const hasKids = n.children && n.children.length;
    const active = state.selected === n.id;
    const editing = state.editingNodeId === n.id;
    const confirming = state.confirmDelete === n.id;
    const ct = childType(n.type);

    let right;
    if (editing) {
      right = '<input class="n-edit" value="' + esc(n.name) + '" data-edit="' + n.id + '">'
        + '<div class="n-edit-btns">'
        + '<button class="n-ok" data-act="rename-ok" data-id="' + n.id + '" title="' + t('Speichern') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg></button>'
        + '<button class="n-cancel" data-act="rename-cancel" data-id="' + n.id + '" title="' + t('Abbrechen') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
        + '</div>';
    } else if (confirming) {
      right = '<div class="node-confirm"><span>Löschen?</span>'
        + '<button class="yes" data-act="del-yes" data-id="' + n.id + '">Ja</button>'
        + '<button class="no" data-act="del-no">Nein</button></div>';
    } else if (canEdit()) {
      right = '<div class="node-tools"><button data-act="node-menu" data-id="' + n.id + '" title="' + t('Aktionen') + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button></div>';
    } else {
      right = '';
    }

    return '<div class="node ' + (open ? 'open' : '') + '" data-id="' + n.id + '">'
      + '<div class="row ' + (active ? 'active' : '') + '" data-act="select" data-id="' + n.id + '">'
      + '<div class="toggle ' + (hasKids ? '' : 'leaf') + '" data-act="toggle" data-id="' + n.id + '"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>'
      + '<div class="n-icon' + (n.type === 'linie' ? ' linie' : '') + '"' + (NODE_ICON_COLOR[n.type] ? ' style="color:' + NODE_ICON_COLOR[n.type] + '"' : '') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' + (ICONS[n.type] || '') + '</svg></div>'
      + (editing ? '' : '<div class="n-name"' + (canEdit() ? ' title="' + t('Doppelklick zum Umbenennen') + '"' : '') + '>' + esc(n.name) + '</div>')
      + right
      + '</div>'
      + (hasKids ? '<div class="children">' + n.children.map(nodeHTML).join('') + '</div>' : '')
      + '</div>';
  }

  function focusEdit(id) {
    setTimeout(() => { const el = document.querySelector('.n-edit[data-edit="' + id + '"]'); if (el) { el.focus(); el.select(); } }, 30);
  }

  // Tree-Interaktionen (Event-Delegation)
  function onTreeClick(e) {
    if (e.target.closest('.n-edit')) return; // Klicks im Umbenennen-Feld nicht als Zeilen-Auswahl werten (Fokus bleibt)
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    const id = el.getAttribute('data-id');
    if (act === 'toggle') { e.stopPropagation(); toggleNode(id); }
    else if (act === 'select') { selectNode(id); const a = document.querySelector('.app'); if (a) a.classList.remove('tree-open'); }
    else if (act === 'add') { e.stopPropagation(); addChild(id); }
    else if (act === 'dup') { e.stopPropagation(); duplicateAnlage(findNode(id)); }
    else if (act === 'link') { e.stopPropagation(); copyStationLink(id); }
    else if (act === 'qr') { e.stopPropagation(); openQrModal(id); }
    else if (act === 'node-menu') { e.stopPropagation(); if (document.getElementById('nodeMenu')) closeNodeMenu(); else openNodeMenu(id, el); }
    else if (act === 'rename') { e.stopPropagation(); startRename(id); }
    else if (act === 'rename-ok') { e.stopPropagation(); const inp = document.querySelector('.n-edit[data-edit="' + id + '"]'); commitRename(id, inp ? inp.value : ''); }
    else if (act === 'rename-cancel') { e.stopPropagation(); state.editingNodeId = null; renderTree(); }
    else if (act === 'del') { e.stopPropagation(); state.confirmDelete = id; state.editingNodeId = null; renderTree(); }
    else if (act === 'del-yes') { e.stopPropagation(); doDelete(id); }
    else if (act === 'del-no') { e.stopPropagation(); state.confirmDelete = null; renderTree(); }
  }
  function onTreeKey(e) {
    const inp = e.target.closest('.n-edit'); if (!inp) return;
    const id = inp.getAttribute('data-edit');
    if (e.key === 'Enter') { e.preventDefault(); commitRename(id, inp.value); }
    else if (e.key === 'Escape') { state.editingNodeId = null; renderTree(); }
  }
  function onTreeBlur(e) {
    const inp = e.target.closest('.n-edit'); if (!inp) return;
    commitRename(inp.getAttribute('data-edit'), inp.value);
  }
  // Doppelklick auf den Knotennamen startet das Umbenennen (schneller als der Stift-Button).
  function onTreeDblClick(e) {
    if (!canEdit()) return;
    const name = e.target.closest('.n-name'); if (!name) return;
    const row = name.closest('.row'); if (!row) return;
    const id = row.getAttribute('data-id'); if (!id) return;
    e.preventDefault();
    if (window.getSelection) { try { window.getSelection().removeAllRanges(); } catch (_) { /* noop */ } }
    startRename(id);
  }

  function toggleNode(id) { if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id); renderTree(); }

  function allExpandableIds() {
    const ids = [];
    const walk = (nodes) => nodes.forEach((n) => { if (n.children && n.children.length) { ids.push(n.id); walk(n.children); } });
    walk(state.tree);
    return ids;
  }
  function expandAll() { state.expanded = new Set(allExpandableIds()); renderTree(); }
  function collapseAll() { state.expanded = new Set(); renderTree(); }

  // Level-Router: welche Ansicht rechts erscheint, wenn ein Baumknoten gewaehlt wird.
  // Nur Ebenen mit eigenem Dashboard hier eintragen; alles andere zeigt das leere Startfenster (Logo).
  // Spaeter erweiterbar, z. B.: LEVEL_VIEW.werk = renderWerk; LEVEL_VIEW.kst = renderKstDashboard;
  const LEVEL_VIEW = { linie: renderLinie };
  function selectNode(id) {
    const n = findNode(id); if (!n) return;
    stopCollab(); // Editor-Live-Poll beim Baum-Wechsel beenden – verhindert Ruecksprung in die Modellierung
    state.selected = id; state.confirmDelete = null;
    if (n.type === 'anlage') { openAnlage(n); }
    else if (LEVEL_VIEW[n.type]) { state.view = 'linie'; setStationUrl(null); LEVEL_VIEW[n.type](n); }
    else { state.view = 'linie'; setStationUrl(null); renderWelcome(); }
    renderTree();
  }

  async function addWerk() {
    if (!state.isAdmin) return;
    try {
      const node = await Api.createNode(null, 'werk', t('Neues Werk'));
      state.editingNodeId = node.id;
      await loadTree(); focusEdit(node.id);
    } catch (e) { toast(t('Anlegen fehlgeschlagen: ') + e.message); }
  }
  async function addChild(parentId) {
    const p = findNode(parentId); const ct = childType(p.type); if (!ct) return;
    try {
      const node = await Api.createNode(parentId, ct, t('Neue ') + TYPE_LABEL[ct]);
      state.expanded.add(parentId); state.editingNodeId = node.id;
      await loadTree(); focusEdit(node.id);
    } catch (e) { toast(t('Anlegen fehlgeschlagen: ') + e.message); }
  }
  function startRename(id) { state.editingNodeId = id; state.confirmDelete = null; renderTree(); focusEdit(id); }
  async function commitRename(id, val) {
    if (state.editingNodeId !== id) return;
    state.editingNodeId = null;
    const n = findNode(id); const v = (val || '').trim();
    if (n && v && v !== n.name) {
      try { await Api.updateNode(id, { name: v }); } catch (e) { toast(t('Umbenennen fehlgeschlagen')); }
      await loadTree();
    } else { renderTree(); }
  }
  function startObjRename(id) { if (!canEdit()) return; state.editingObjId = id; renderEditor(); setTimeout(() => { const el = document.querySelector('.oname-edit[data-oedit="' + id + '"]'); if (el) { el.focus(); el.select(); } }, 30); }
  async function commitObjRename(id, val) {
    if (state.editingObjId !== id) return;
    state.editingObjId = null;
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === id);
    const v = (val || '').trim();
    if (o && v && v !== o.name) {
      try { await Api.updateObject(id, { name: v }); o.name = v; } catch (e) { toast(t('Umbenennen fehlgeschlagen')); }
    }
    renderEditor();
  }
  function cancelObjRename() { if (state.editingObjId) { state.editingObjId = null; renderEditor(); } }
  async function doDelete(id) {
    state.confirmDelete = null;
    try { await Api.deleteNode(id); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    if (state.selected === id) { state.selected = null; renderWelcome(); }
    await loadTree();
    toast(t('Gelöscht'));
  }

  // Anlage duplizieren: neuer Node + tiefe Kopie der Station (Meta, SPS mit ID-Remap, Objekte inkl.
  // plcConfigId-Remap + Metatags, Layout-Bild). Ebenen sind global -> layerId bleibt unveraendert.
  async function duplicateAnlage(node) {
    if (!canEdit() || !node || node.type !== 'anlage' || state.dupBusy) return;
    const parentId = node._parent ? node._parent.id : null;
    state.dupBusy = true;
    toast('Anlage wird dupliziert …');
    try {
      const src = node.stationId;
      const full = src ? await Api.getStationFull(src) : null;
      const newNode = await Api.createNode(parentId, 'anlage', (node.name || 'Anlage') + ' (Kopie)');
      const nsid = newNode && newNode.stationId;
      let layoutOk = false;
      if (full && nsid) {
        const patch = {}; ['bereich', 'oem', 'anlagenversion', 'beschreibung'].forEach((k) => { if (full[k]) patch[k] = full[k]; });
        if (Object.keys(patch).length) { try { await Api.updateStation(nsid, patch); } catch (e) { /* ignore */ } }
        // SPS kopieren -> alte auf neue ID abbilden
        const plcMap = {};
        for (const p of (full.plcs || [])) {
          try { const np = await Api.addPlc(nsid, { name: p.name, cycleTimeMs: +p.cycleTimeMs || 0, retentiveBytes: +p.retentiveBytes || 0, codeMemoryKb: +p.codeMemoryKb || 0, color: p.color }); if (np && np.id) plcMap[p.id] = np.id; } catch (e) { /* ignore */ }
        }
        // Falls addPlc keine IDs liefert: Station neu laden und per Reihenfolge zuordnen
        if ((full.plcs || []).length && Object.keys(plcMap).length < full.plcs.length) {
          try { const nf = await Api.getStationFull(nsid); (nf.plcs || []).forEach((np, i) => { if (full.plcs[i] && np) plcMap[full.plcs[i].id] = np.id; }); } catch (e) { /* ignore */ }
        }
        // Objekte kopieren (plcConfigId neu mappen, layerId global unveraendert), Metatags uebernehmen
        for (const o of (full.objects || [])) {
          const body = { layerId: o.layerId, name: o.name, symbolType: o.symbolType, color: o.color, x: o.x, y: o.y };
          if (o.points) body.points = o.points;
          if (o.categoryId) body.categoryId = o.categoryId;
          body.plcConfigId = o.plcConfigId ? (plcMap[o.plcConfigId] || null) : null;
          try {
            const no = await Api.createObject(nsid, body);
            if (no && no.id && o.metatags && o.metatags.length) { try { await Api.setMetatags(no.id, o.metatags); } catch (e) { /* ignore */ } }
          } catch (e) { /* ignore */ }
        }
        // Layout-Bild kopieren: unabhaengig vom hasLayout-Flag versuchen; nur bei echten Bild-Bytes hochladen.
        try {
          const res = await Api.raw('/stations/' + src + '/layout');
          if (res && res.ok) {
            const blob = await res.blob();
            if (blob && blob.size > 0) {
              const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || blob.type || 'image/png';
              const ext = /jpe?g/i.test(ct) ? 'jpg' : (/webp/i.test(ct) ? 'webp' : (/gif/i.test(ct) ? 'gif' : 'png'));
              const mime = /image\//i.test(ct) ? ct : 'image/png';
              let file;
              try { file = new File([blob], 'layout.' + ext, { type: mime }); }
              catch (e) { file = blob; file.name = 'layout.' + ext; } // Fallback fuer aeltere Browser
              try { await Api.uploadLayout(nsid, file); layoutOk = true; }
              catch (e1) { await new Promise((r) => setTimeout(r, 500)); try { await Api.uploadLayout(nsid, file); layoutOk = true; } catch (e2) { toast('Layout-Upload fehlgeschlagen: ' + (e2 && e2.message ? e2.message : e2)); } }
            } else if (full.hasLayout) { toast('Layout-Bild leer geladen (0 Bytes)'); }
          } else if (full.hasLayout) { toast('Layout-Bild laden fehlgeschlagen (' + (res ? res.status : '?') + ')'); }
        } catch (e) { toast('Layout-Bild nicht kopiert: ' + (e && e.message ? e.message : e)); }
        // Kommentare kopieren (Pins + Nachrichten). Autor/Zeitpunkt der Nachrichten werden neu vergeben.
        try {
          const comments = await Api.getComments(src);
          for (const c of (comments || [])) {
            try {
              const nc = await Api.createComment(nsid, { x: c.x, y: c.y, layerId: c.layerId || null });
              if (nc && nc.id) { for (const m of (c.messages || [])) { if (m && m.text) { try { await Api.addCommentMessage(nc.id, m.text); } catch (e) { /* ignore */ } } } }
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      }
      if (parentId) state.expanded.add(parentId);
      await loadTree();
      toast('Anlage dupliziert' + ((full && full.hasLayout) ? (layoutOk ? ' · Layout ✓' : ' · LAYOUT FEHLT') : ''));
    } catch (e) { toast('Duplizieren fehlgeschlagen: ' + (e.message || '')); }
    finally { state.dupBusy = false; }
  }

  /* ---------------- Inhalt ---------------- */
