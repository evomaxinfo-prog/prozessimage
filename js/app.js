/* ProModXgOEM – Frontend-Logik (Schritt 1: Login + Baum) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const PLC_COLORS = ['#0065A5', '#C0392B', '#0E8A6E', '#D9822B', '#7A3FA8', '#2C82C9', '#16A085', '#E67E22'];

  const TYPE_ORDER = ['werk', 'center', 'abteilung', 'kst', 'linie', 'anlage'];
  const TYPE_LABEL = { werk: 'Werk', center: 'Center', abteilung: 'Abteilung', kst: 'KST', linie: 'Linie', anlage: 'Anlage' };
  const childType = (t) => { const i = TYPE_ORDER.indexOf(t); return (i >= 0 && i < TYPE_ORDER.length - 1) ? TYPE_ORDER[i + 1] : null; };

  const ICONS = {
    werk: '<path d="M3 21V10l5 3V8l6 4V6l6 4v11z"/><path d="M3 21h18"/>',
    center: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M4 12h16"/>',
    abteilung: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8 5V3h8v2M4 12h16"/>',
    kst: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>',
    linie: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/><rect x="10" y="9" width="4" height="6" rx="1"/>',
    anlage: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M8 9V6a4 4 0 0 1 8 0v3M9 14h6"/>',
  };

  const state = {
    tree: [], byId: {}, expanded: new Set(),
    selected: null, editingNodeId: null, confirmDelete: null, user: null,
    drawZone: false, drawShape: null, zoneDraft: [], zoneCursor: null, selectedZone: null, zoneDrag: null, flowType: 0, flowLegend: true,
    collab: { since: null, viewers: [], enabled: true, inflight: false, status: 'connecting', detailsOpen: false, pendingRender: false, protect: {} },
  };

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    $('toastMsg').textContent = msg;
    const t = $('toast'); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ---------------- Login-UI ---------------- */
  function showPanel(which) {
    $('panelLogin').style.display = which === 'login' ? 'block' : 'none';
    $('panelChange').style.display = which === 'change' ? 'block' : 'none';
    $('loginMsg').textContent = '';
    const cm = $('chgMsg'); cm.textContent = ''; cm.classList.remove('ok');
    if (which === 'change') { if (!$('chgEmail').value) $('chgEmail').value = $('loginEmail').value.trim(); }
    else if (which === 'login') { if ($('chgEmail').value) $('loginEmail').value = $('chgEmail').value.trim(); }
    setTimeout(() => {
      const el = which === 'change' ? ($('chgEmail').value ? $('chgOld') : $('chgEmail')) : $('loginEmail');
      if (el) el.focus();
    }, 50);
  }
  function togglePw(id, btn) { const i = $(id); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; btn.classList.toggle('on', show); }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function pwScore(v) { let s = 0; if (v.length >= 8) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++; return Math.min(s, 4); }
  function updateStrength() {
    const s = pwScore($('chgNew').value);
    const col = ['', '#C0392B', '#D9822B', '#0E8A6E', '#0E8A6E'][s];
    document.querySelectorAll('#pwBars i').forEach((b, i) => { b.style.background = i < s ? col : 'var(--panel-2)'; });
  }

  async function doLogin() {
    const email = $('loginEmail').value.trim();
    const pass = $('loginPass').value;
    const msg = $('loginMsg');
    if (!isEmail(email)) { msg.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; return; }
    msg.textContent = 'Anmeldung läuft …';
    try {
      const res = await Api.login(email, pass);
      Api.token = res.accessToken;
      msg.textContent = '';
      $('loginPass').value = '';
      enterApp(res);
    } catch (e) {
      msg.textContent = e.status === 422 ? 'E-Mail oder Passwort ist nicht korrekt.' : ('Fehler: ' + e.message);
    }
  }

  async function doChange() {
    const email = $('chgEmail').value.trim();
    const oldp = $('chgOld').value, np = $('chgNew').value, np2 = $('chgNew2').value;
    const msg = $('chgMsg'); msg.classList.remove('ok');
    if (!isEmail(email)) { msg.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; return; }
    if (!oldp) { msg.textContent = 'Bitte das aktuelle Passwort eingeben.'; return; }
    if (np.length < 8) { msg.textContent = 'Das neue Passwort muss mindestens 8 Zeichen haben.'; return; }
    if (np === oldp) { msg.textContent = 'Das neue Passwort muss sich vom aktuellen unterscheiden.'; return; }
    if (np !== np2) { msg.textContent = 'Die neuen Passwörter stimmen nicht überein.'; return; }
    msg.textContent = 'Passwort wird geändert …';
    try {
      // Mit aktuellem Passwort anmelden, um einen gültigen Token zu erhalten
      const res = await Api.login(email, oldp);
      Api.token = res.accessToken;
      // Passwort ändern
      await Api.changePassword(oldp, np);
      // Session wieder schließen
      try { await Api.logout(); } catch (e) { /* egal */ }
      Api.token = null;
      msg.classList.add('ok'); msg.textContent = 'Passwort geändert. Bitte neu anmelden.';
      $('loginEmail').value = email;
      ['chgOld', 'chgNew', 'chgNew2'].forEach((id) => { $(id).value = ''; }); updateStrength();
      setTimeout(() => showPanel('login'), 1200);
    } catch (e) {
      Api.token = null;
      msg.textContent = e.status === 422 ? 'E-Mail oder aktuelles Passwort ist nicht korrekt.' : ('Fehler: ' + e.message);
    }
  }

  function initials(email) {
    return (email.split('@')[0].split(/[.\-_]/).filter(Boolean).slice(0, 2)
      .map((s) => s[0].toUpperCase()).join('')) || 'U';
  }

  function canEdit() { return state.role === 'editor' || state.role === 'admin'; }

  function applyRoleUi() {
    $('btnAdmin').style.display = state.isAdmin ? '' : 'none';
    const add = $('btnAddWerk'); if (add) add.style.display = canEdit() ? '' : 'none';
  }

  function enterApp(ctx) {
    state.user = ctx.user;
    state.role = ctx.role || 'viewer';
    state.isAdmin = !!ctx.isAdmin;
    state.group = ctx.group || null;
    state.visibleWerke = ctx.visibleWerke || null;
    state.visibleLayers = ctx.visibleLayers || null; // Array erlaubter Ebenen-Codes; null = alle sichtbar
    $('userName').textContent = ctx.user.email;
    $('userAvatar').textContent = initials(ctx.user.email);
    if (ctx.tenants && ctx.tenants[0]) $('tenantName').textContent = ctx.tenants[0].name;
    applyRoleUi();
    const ls = $('loginScreen'); ls.classList.add('hide');
    setTimeout(() => { ls.style.display = 'none'; }, 300);
    loadTree();
  }

  function showLogin() {
    const ls = $('loginScreen');
    ls.style.display = 'flex'; requestAnimationFrame(() => ls.classList.remove('hide'));
    $('loginPass').value = '';
    showPanel('login');
  }

  async function boot() {
    if (!Api.isAuthenticated) { showLogin(); return; }
    try {
      const res = await Api.me();
      $('loginScreen').style.display = 'none';
      enterApp(res);
    } catch (e) {
      showLogin();
    }
  }

  /* ---------------- Baum ---------------- */
  async function loadTree() {
    try {
      state.tree = await Api.getTree();
    } catch (e) { toast('Baum konnte nicht geladen werden'); return; }
    indexTree();
    renderTree();
  }
  function indexTree() {
    state.byId = {};
    const walk = (nodes, parent) => nodes.forEach((n) => { n._parent = parent; state.byId[n.id] = n; if (n.children) walk(n.children, n); });
    walk(state.tree, null);
  }
  function findNode(id) { return state.byId[id] || null; }

  function renderTree() {
    $('treeScroll').innerHTML = state.tree.map(nodeHTML).join('');
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
      right = '<input class="n-edit" value="' + esc(n.name) + '" data-edit="' + n.id + '">';
    } else if (confirming) {
      right = '<div class="node-confirm"><span>Löschen?</span>'
        + '<button class="yes" data-act="del-yes" data-id="' + n.id + '">Ja</button>'
        + '<button class="no" data-act="del-no">Nein</button></div>';
    } else if (canEdit()) {
      right = '<div class="node-tools">'
        + (ct ? '<button data-act="add" data-id="' + n.id + '" title="' + TYPE_LABEL[ct] + ' hinzufügen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg></button>' : '')
        + '<button data-act="rename" data-id="' + n.id + '" title="Umbenennen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg></button>'
        + '<button class="del" data-act="del" data-id="' + n.id + '" title="Löschen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
        + '</div>';
    } else {
      right = '';
    }

    return '<div class="node ' + (open ? 'open' : '') + '" data-id="' + n.id + '">'
      + '<div class="row ' + (active ? 'active' : '') + '" data-act="select" data-id="' + n.id + '">'
      + '<div class="toggle ' + (hasKids ? '' : 'leaf') + '" data-act="toggle" data-id="' + n.id + '"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>'
      + '<div class="n-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' + (ICONS[n.type] || '') + '</svg></div>'
      + (editing ? '' : '<div class="n-name">' + esc(n.name) + '</div>')
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
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    const id = el.getAttribute('data-id');
    if (act === 'toggle') { e.stopPropagation(); toggleNode(id); }
    else if (act === 'select') { selectNode(id); }
    else if (act === 'add') { e.stopPropagation(); addChild(id); }
    else if (act === 'rename') { e.stopPropagation(); startRename(id); }
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

  function toggleNode(id) { if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id); renderTree(); }

  function allExpandableIds() {
    const ids = [];
    const walk = (nodes) => nodes.forEach((n) => { if (n.children && n.children.length) { ids.push(n.id); walk(n.children); } });
    walk(state.tree);
    return ids;
  }
  function expandAll() { state.expanded = new Set(allExpandableIds()); renderTree(); }
  function collapseAll() { state.expanded = new Set(); renderTree(); }

  function selectNode(id) {
    const n = findNode(id); if (!n) return;
    state.selected = id; state.confirmDelete = null;
    if (n.type === 'werk') { renderWerk(n); }
    else if (n.type === 'anlage') { openAnlage(n); }
    else { toggleNode(id); return; }
    renderTree();
  }

  async function addWerk() {
    try {
      const node = await Api.createNode(null, 'werk', 'Neues Werk');
      state.editingNodeId = node.id;
      await loadTree(); focusEdit(node.id);
    } catch (e) { toast('Anlegen fehlgeschlagen: ' + e.message); }
  }
  async function addChild(parentId) {
    const p = findNode(parentId); const ct = childType(p.type); if (!ct) return;
    try {
      const node = await Api.createNode(parentId, ct, 'Neue ' + TYPE_LABEL[ct]);
      state.expanded.add(parentId); state.editingNodeId = node.id;
      await loadTree(); focusEdit(node.id);
    } catch (e) { toast('Anlegen fehlgeschlagen: ' + e.message); }
  }
  function startRename(id) { state.editingNodeId = id; state.confirmDelete = null; renderTree(); focusEdit(id); }
  async function commitRename(id, val) {
    if (state.editingNodeId !== id) return;
    state.editingNodeId = null;
    const n = findNode(id); const v = (val || '').trim();
    if (n && v && v !== n.name) {
      try { await Api.updateNode(id, { name: v }); } catch (e) { toast('Umbenennen fehlgeschlagen'); }
      await loadTree();
    } else { renderTree(); }
  }
  async function doDelete(id) {
    state.confirmDelete = null;
    try { await Api.deleteNode(id); } catch (e) { toast('Löschen fehlgeschlagen'); return; }
    if (state.selected === id) { state.selected = null; renderWelcome(); }
    await loadTree();
    toast('Gelöscht');
  }

  /* ---------------- Inhalt ---------------- */
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
      + '<svg class="glyph" width="60" height="60" viewBox="0 0 60 60" fill="none">'
      + '<path d="M30 6 L52 17 L30 28 L8 17 Z" fill="#0065A5"/><path d="M30 22 L52 33 L30 44 L8 33 Z" fill="#3d8bc0"/><path d="M30 38 L52 49 L30 60 L8 49 Z" fill="#939598"/></svg>'
      + '<h2>Anlage auswählen</h2>'
      + '<p>Navigiere links durch die Struktur. Neue Knoten legst du mit dem +-Symbol an. Detailansicht und Editor folgen in den nächsten Schritten.</p>'
      + '</div></div>';
  }

  async function renderWerk(node) {
    $('content').innerHTML = breadcrumb(node.id) + '<div class="werk-wrap"><div class="werk-head"><div>'
      + '<h1>' + esc(node.name) + '</h1><p>Gesamtübersicht</p></div></div>'
      + '<div class="zone-stats" id="werkStats">'
      + '<div class="stat b"><div class="k">…</div><div class="l">Anlagen</div></div>'
      + '<div class="stat"><div class="k">…</div><div class="l">Center</div></div>'
      + '<div class="stat"><div class="k">…</div><div class="l">SPS gesamt</div></div>'
      + '<div class="stat"><div class="k">…</div><div class="l">Dokumentiert</div></div></div></div>';
    try {
      const o = await Api.getWerkOverview(node.id);
      $('werkStats').innerHTML =
        '<div class="stat b"><div class="k">' + o.anlagen + '</div><div class="l">Anlagen</div></div>'
        + '<div class="stat"><div class="k">' + o.center + '</div><div class="l">Center</div></div>'
        + '<div class="stat"><div class="k">' + o.sps + '</div><div class="l">SPS gesamt</div></div>'
        + '<div class="stat"><div class="k">' + o.dokumentiertPercent + '%</div><div class="l">Dokumentiert</div></div>';
    } catch (e) { /* leer lassen */ }
  }

  /* -------- Detailansicht (Schritt 2) -------- */
  async function openAnlage(node) {
    if (!node.stationId) {
      $('content').innerHTML = breadcrumb(node.id) + '<div class="pad"><div class="card"><div class="card-body">Für diese Anlage existiert keine Station.</div></div></div>';
      return;
    }
    $('content').innerHTML = breadcrumb(node.id) + '<div class="pad" style="color:var(--muted)">Lädt …</div>';
    try {
      const full = await Api.getStationFull(node.stationId);
      if (!full.nodeId) full.nodeId = node.id;
      state.detail = full; state.detailEdit = false; state.detailDraft = null;
      await ensureLayoutBlob();
      renderDetail();
    } catch (e) {
      $('content').innerHTML = breadcrumb(node.id) + '<div class="pad"><div class="card"><div class="card-body">Detail konnte nicht geladen werden.</div></div></div>';
    }
  }

  function fmtDate(iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleDateString('de-DE'); }
  function fmtDateTime(iso) { if (!iso) return '–'; const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }

  function schemaThumb() {
    return '<svg viewBox="0 0 320 240" style="width:100%;height:100%;display:block">'
      + '<defs><pattern id="tgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#E3E9EE" stroke-width="1"/></pattern></defs>'
      + '<rect width="320" height="240" fill="#F9FBFC"/><rect width="320" height="240" fill="url(#tgrid)"/>'
      + '<rect x="20" y="20" width="280" height="200" fill="none" stroke="#8FA3B0" stroke-width="1.6"/></svg>';
  }

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
        return '<tr><td><div class="sps-name"><span class="sps-swatch" style="background:' + esc(p.color) + '"></span>' + esc(p.name) + '</div></td>'
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
      : '<div style="color:var(--muted);font-size:13px;padding:6px 2px">Noch keine Einträge.</div>';

    const html = '<div class="pad">'
      + '<div class="detail-top">'
      + '<div class="preview">'
      + ((s.hasLayout && state.layoutBlobUrl) ? '<img src="' + state.layoutBlobUrl + '" alt="Layout" style="width:100%;height:100%;object-fit:cover;display:block">' : schemaThumb())
      + '<button class="preview-upload" data-act="detail-upload" title="Layout hochladen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg> ' + (s.hasLayout ? 'Layout ersetzen' : 'Layout hochladen') + '</button>'
      + '<div class="tag">' + (s.hasLayout ? 'eigenes Layout' : 'Schema-Layout · L1–L5') + '</div>'
      + '<div class="open-hint" data-act="open-editor">MODELLIEREN ›</div></div>'
      + '<div><div class="detail-title"><h1>' + esc(name) + '</h1><div class="sub">' + esc(s.bereich || '–') + ' · OEM ' + esc(s.oem || '–') + '</div></div>'
      + '<div class="chips">'
      + '<div class="chip blue"><span class="mono">v' + esc(s.anlagenversion || '–') + '</span></div>'
      + '<div class="chip"><span class="mono">' + plcs.length + ' SPS</span></div>'
      + '<div class="chip">' + journal.length + ' Journaleinträge</div>'
      + '<div class="chip">Zuletzt: ' + fmtDate(s.letzteAenderung) + '</div></div>'
      + '<div class="action-bar" style="margin-top:16px;margin-bottom:0">'
      + (canEdit() ? '<button class="btn ' + (ed ? 'primary' : '') + '" data-act="toggle-edit">' + (ed ? 'SPEICHERN' : 'EDITIEREN') + '</button>' : '')
      + '<button class="btn solid-dark" data-act="open-editor">MODELLIEREN</button>'
      + '</div></div></div>'

      + '<div class="card"><div class="card-head"><h3>Stammdaten</h3>' + (ed ? '<span class="badge" style="color:#0065A5;border-color:#0065A5">Bearbeitung</span>' : '') + '</div>'
      + '<div class="card-body"><div class="form-grid">'
      + fld('Anlagenname', name, 'name')
      + fld('Bereich', ed ? d.bereich : s.bereich, 'bereich')
      + fld('OEM', ed ? d.oem : s.oem, 'oem')
      + fld('Anlagenversion', ed ? d.anlagenversion : s.anlagenversion, 'anlagenversion')
      + fld('Erstellt am', fmtDate(s.erstelltAm), 'ea', true)
      + fld('Letzte Änderung', fmtDate(s.letzteAenderung), 'la', true)
      + '<div class="fld wide ' + (ed ? 'editing' : '') + '"><label>Beschreibung</label>'
      + (ed ? '<textarea data-field="beschreibung" rows="2" style="width:100%;resize:vertical">' + esc(d.beschreibung || '') + '</textarea>' : '<div class="val">' + esc(s.beschreibung || '–') + '</div>') + '</div>'
      + '</div></div></div>'

      + '<div class="card"><div class="card-head"><h3>SPS-Konfiguration</h3><span class="badge">' + plcs.length + ' Steuerungen</span></div>'
      + '<div class="card-body"><table><thead><tr><th>Name</th><th class="num">Zykluszeit [ms]</th><th class="num">Remanenz [Byte]</th><th class="num">Code-AS [kByte]</th>' + (ed ? '<th></th>' : '') + '</tr></thead><tbody>'
      + (plcs.length ? plcs.map(plcRow).join('') : '<tr><td colspan="' + (ed ? 5 : 4) + '" style="color:var(--muted)">Keine SPS erfasst.</td></tr>')
      + '</tbody></table>'
      + (ed ? '<button class="add-row-btn" data-act="plc-add"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> SPS HINZUFÜGEN</button>' : '')
      + '</div></div>'

      + '<div class="card"><div class="card-head"><h3>Änderungsjournal</h3><span class="badge">append-only</span></div>'
      + '<div class="card-body"><div class="journal-list">' + jlist + '</div>'
      + (canEdit() ? '<div class="j-add"><input id="jInput" placeholder="Neuer Eintrag …"><button data-act="journal-add"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg></button></div>' : '')
      + '</div></div>'
      + '</div>';

    $('content').innerHTML = breadcrumb(s.nodeId) + html;
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
      toast('Gespeichert');
    } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
    state.detailEdit = false; state.detailDraft = null;
    try { const full = await Api.getStationFull(sid); full.nodeId = s.nodeId; state.detail = full; } catch (e) { /* ignore */ }
    await loadTree();
    renderDetail();
  }

  async function addJournalEntry() {
    const inp = document.getElementById('jInput'); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';
    try { await Api.addJournal(state.detail.id, text); } catch (e) { toast('Journaleintrag fehlgeschlagen'); return; }
    try { const full = await Api.getStationFull(state.detail.id); full.nodeId = state.detail.nodeId; state.detail = full; } catch (e) { /* ignore */ }
    renderDetail();
  }

  function onContentClick(e) {
    // Schutzbereich zeichnen: Klick auf die Zeichenfläche setzt Stützpunkte
    if (state.drawZone) {
      const doc = e.target.closest('#canvasDoc');
      if (doc) {
        const r = doc.getBoundingClientRect();
        const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
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
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'toggle-edit') { state.detailEdit ? saveDetail() : enterEdit(); }
    else if (act === 'plc-add') { state.detailDraft.plcs.push({ id: null, name: 'Neue SPS', cycleTimeMs: 0, retentiveBytes: 0, codeMemoryKb: 0, color: PLC_COLORS[state.detailDraft.plcs.length % PLC_COLORS.length] }); renderDetail(); }
    else if (act === 'plc-del') { const i = +el.getAttribute('data-idx'); const p = state.detailDraft.plcs[i]; if (p && p.id) state.detailDraft._deleted.push(p.id); state.detailDraft.plcs.splice(i, 1); renderDetail(); }
    else if (act === 'journal-add') { addJournalEntry(); }
    else if (act === 'open-editor') { openEditor(); }
    else if (act === 'collab-details') { state.collab.detailsOpen = !state.collab.detailsOpen; renderPresenceOnly(); }
    else if (act === 'editor-back') { leaveEditor(); }
    else if (act === 'editor-upload') { triggerUpload(); }
    else if (act === 'detail-upload') { triggerUpload(); }
    else if (act === 'zoom-in') { zoomStep(0.1); }
    else if (act === 'zoom-out') { zoomStep(-0.1); }
    else if (act === 'layer-select') { selectLayer(el.getAttribute('data-layer')); }
    else if (act === 'layer-eye') { e.stopPropagation(); if (!canEdit()) { toast('Nur Lesezugriff'); return; } toggleLayerVis(el.getAttribute('data-layer')); }
    else if (act === 'export-pdf') { exportFile('pdf'); }
    else if (act === 'export-csv') { exportFile('csv'); }
    else if (act === 'obj-edit') { e.stopPropagation(); openTagModal(el.getAttribute('data-obj')); }
    else if (act === 'obj-del') { e.stopPropagation(); deleteObjectById(el.getAttribute('data-obj')); }
    else if (act === 'pal-hint') { /* nur Hinweis-Titel, kein Toast beim Ziehen */ }
    else if (act === 'toggle-zone') { const on = !(state.drawZone && state.drawShape === 'zone'); state.drawZone = on; state.drawShape = on ? 'zone' : null; state.zoneDraft = []; state.zoneCursor = null; if (on) state.selectedZone = null; renderEditor(); }
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

  /* ================= Modellierungs-Editor (Schritt 3) ================= */

  const SYM = {
    src: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h6M11 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    snk: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 12h-6M13 9l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    buf: '<path d="M5 8h14v8H5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 8v8M13 8v8" stroke="currentColor" stroke-width="1.4"/>',
    xfer: '<path d="M4 9h16M4 15h16" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 6l3 3-3 3M8 18l-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    cab: '<rect x="5" y="4" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/>',
    zone: '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.5"/>',
    panel: '<rect x="4" y="7" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><path d="M13 10h4M13 14h4" stroke="currentColor" stroke-width="1.6"/>',
    box: '<rect x="6" y="6" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    robot: '<rect x="0" y="0" width="24" height="24" fill="currentColor" mask="url(#robotMask)"/>',
    ctrl: '<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.6"/>',
    grip: '<path d="M12 4v6M8 10v6M16 10v6M8 10h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    cell: '<path d="M5 5h14v14H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="4 3"/>',
    motor: '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M9 10l6 4M15 10l-6 4" stroke="currentColor" stroke-width="1.4"/>',
    cam: '<rect x="4" y="8" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 11l4-2v6l-4-2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    rfid: '<path d="M7 8a7 7 0 0 1 0 8M10 6a11 11 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="12" r="2" fill="currentColor"/>',
    mark: '<path d="M6 18L14 6l4 3-8 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 18l2-.5" stroke="currentColor" stroke-width="1.8"/>',
    estop: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/>',
    pad: '<rect x="6" y="4" width="12" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/><path d="M9 8h6" stroke="currentColor" stroke-width="1.6"/>',
    pull: '<path d="M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    ack: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12l3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    door: '<rect x="6" y="4" width="12" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/>',
    light: '<path d="M6 4v16M18 4v16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 8h12M6 12h12M6 16h12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.5 2"/>',
    switch: '<rect x="5" y="9" width="14" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="1.8" fill="currentColor"/>',
    load: '<path d="M5 16h14M8 16V8l4-3 4 3v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    // --- Prozesstypen (Katalog L7.0): echte ICO-Icons aus Prozesstypenkatalog V2025_4 (verankerte Bilder, verkleinert+Base64) ---
    ptk_1: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_2: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAEiUlEQVR42uVYX0hbVxj/nZtjuNwNRdMma4mObhmLIGNUaqvdwEBdqS/W0UgcweF0e5rYl9FSihoZBRl9EN+qVTYCipa2eVE6Cg20myBL2YNgyjJYa7Y1itva4uklu+bsYbti9Oq53lhr2Af3Ifd85zu/fPf78zsfgd9vw8TEitzaVU1owUXC+SnsIeGETHHt7y/Vkd5p+P02AgDKJz1BSNI32MuSybSw4Z4wkVu7qiUb/Q55IJzgmERowUXkjZBuaa/F7JZwOT8lIc8k7wDTXA2kNY1oaQ0AoCgyN9JhTCUAQO0Udkr5S/FwWtMIYyrxOB0I+etw63wrykqKSFrTyFqdspIicut8K3qb6uBxOsCYmqWz7ThW2nszVjaWlRSR7kYfmqoqVt+Nz8yieWAsS2/osw/R+v7hLJ3QjTt49McTvmshwZhKGuqOZYEF8O/vjgB++/MpAOBgcaGhzo+PHqMvEiWbhdCOA6Z2ikhsDpfOnNiwth6gkURic6B2unsxrCdZLmLVhrSdMNATTVFkPtR22jLYobbTUBSZr7Vpdq+t4LCvW1QNDu0rJm2+I1h8uox9ha9i4vMAqfaUWgZcWlIEX/kh8v3PSZS8oqDNdwSP/3pGFp8tE5sk5VYlGFPJaEfAVGwCwL0HD/HTwhIAwHtgP8z+Mb3CiBKRirzrdbtMgdXLVTyZynrvdbuwvvwZSVNVBUJuF+LJ1JbVQxIlxqe1lUKwF67dRvPAGBILS1AUma994skUmgfGcOHabaEdM2cJk67C7RJ6ti8ShaLI3Kjt6sD7IlGMz8zmdJYQsKLIvDM8iZG79zfVCd24Y7p2b6U7cvc+OsOTwhgWejixsIT2K9cNvTOdmEc8mYKZjmWnlMeTKUwn5g2/UvuV60j8l6w5AdY/s95u10r898VtlzSjPbptM0xu1/nwE6a+WAKvU8GDxYUb1rwH9m/7wKNvbqzLum0ztFMI2ON04HKw3rCOVntK4XW7TB3EmEq8bpdhI2mqqsDlYD08TkduHmZMJf3Bepw9WbOpTnejzzSR6W70bbp29mQN+oP1EPEKoYdn13UuI++ca6gFY6ohidHJzbmGWmG3E51lCvBgNCY0cunMCYx2BOB1u1aB64/H6cBoR8CQO1s5i4oaRzyZIuMzs6a4QFNVBe49eIgffvkVRYqMt5wOvPf266bJj5maLmRraU0jHqcDDZXliMTmVvlsLvRSbzrtV28CwKrtxMKSsBabvoQyphJqp9DSGhRF5t9+8bFlTjydmMcHX33N19vc0RuHTm70m4LuHSvSfvUm9JuLbvOF3umsXiB3woalXVpaQ0Nl+abJs9U1X4/ZvkgUdkp3B7CiyDwSmyPvlr0mHKQsGwxSIrE5WJlJ5DT50WdqXrcLH9W8g6NvuNEZnszKdL3C9AfrMZtMYTAaQzyZymnGZhmwlWHgVjq7Nr20U8pFsZgryJfKh/9/gDkhU/kClhMyJQE8lD/+5SHp+WDXDDKZlj2PNZNpeT7YNSPB77ex4Z5wZkU7vhfDgxMylVnRjrPhnjD847Z/ADBhIGWA0f6tAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_3: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_4: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFZUlEQVR42u2YbUxTZxTH/6fcanfFUh0GKIXY6ARZfBtvoxIVP1VNpkvEQFhImEQTP5jQ+MWMIBq/GMlm4kyMr4lx0egHt4UN5zLftjlTgphNBWqkLrS6MsC2dpdre+2zD+XeldLSK2wJZJxv9z5P/+fX85xznpNLqKxMweXLr3V1TWXEaRuJsQ2YQsaI2pgUOiiePfALKitTCAD4j5s/gkZzDlPZwuFa4UzzedLVNZVpUrifMQ2MEd7XEKdtxLQx2qeZajk7Li5jGzSYZjYDPAP8vwMWBJEEQaTJOp6ojuZNnTRsKsf29cWYDLQgiLR9fTEaNpW/sU5S4O5Du2lnRREJgkg8r2MtVVZUFJgnfbQVBWa0VFnB8zomCCLtrCii7kO7acLAgiBS6SITZRv0MBr0ESf5ZgKAG4+cyr6QJKmOUPReWUPWNBr0yDboUbrING6qjBthXqsFADzz+gFfAOuWRiLb9exPAEDO/DS63ViPnPlpNB54SJIoem+0xrqlZsAXiPgAsGDuHPURji2EObpZ/yympWJFbiYAYDAwDACoX1uIErMpAhWUEkd2ZK3EbEL92sJRGityM4G0VNWFqYktqMM1G5VCmBsNDCDfmA6314++IR/jeR2zWS1weAaU54QnxetY35CPOTwDsFktyrPb60e+MR0A4B9+hWifgiDS4ZqNYwpzVISNBj1sVgvyTBlxnWYb9HC/8EMQRJJzr7XToarSBUGk1k6HkreCIJL7hR/ZBj14Xsf0b80etT/PlAGb1aLUT1zgKx2PlKOGL4CXYlD5IytzMwkAnvQPAb4Aqi3LAAA3u5yqO4O8t9qyDPAFIloAVuZmkgz2UgwCvoCSOjKTbFx0BO90PyW70wWb1YJ9V66zv8QgAYDNaoHNagEArMlbiMO7tqG6dDncXj9udDsZz+uSwvK8jt3odsLt9VN16XI837UNa/IWAgB+/KR+9N6sdGazWsjudOFO91NEp1uK9r2KfUpxhCR6+SqErcXvYmtJAX1YVAC9bvRR6XWzUbY4BwBw6mYHvr3XRVotp/rCMM5PQ9niHJQtzhmjDQBl7+Sgbs0qejuVx56L3+FhnwfR+prYKLTe72Furx9LMtKRHZM/sRZ7XGos2W+yDXosyYgUd+v9njHFrIkXhR8e9qpy3jfkU44rJEkU24bkZ7lHj3QHVdq3e57GLea4Z/lr3x+qRAcDwywkSRQKSsgzZaDGshy/D3hx4e5vAIDt64uRn7UAp251oMflIe0sDoOBYQYgaVfpcD6L+z4usNwTk84D+Wa69uAxGjaVo6XKqryXgU/UbYZctHsuXsXn399VruJkloghLrDczpLZ1w01cHgGsCQj0vztThcOfnlLWf/gsy/QuGUtSswmtFRZsaOiSNmbzBIxcJikyQA7zn6Fcz91IhSUILe5b+514dqDx6gtX4UTdZtVw77xtOZSWRgA4PAMoGDvUZy+3g4tx42qap7XMS3HsdPX21Gw9ygcngHVuokYxgCPFIZq2MKm46zH5UGyWaLH5UFh03GmFnowMAztLE4FMMex3v5B2J0uVbDyYK/mphMEkdRA250u9PYPQstxTFVKhIKScs/HM7fXjy1HLkAtbCz0liMX4B6Zf+PZk/6hhONqwgG+cKExoWDVsUtIlgbJ0qPq2CVMxDeXSLS100FZ88Y27+cvAmjvdU0INlq/vddFn169g6x5qXF9JNInvv5AONGgMp7Df+Mbw0R8cP81VLJIz3z5mQGeAZ7qwIyobbrAMqI2DcD2T5/4sv2a4ZNNdoTDtVOeNRyuHT7ZZNegsjJFONN8PvxaWj0V04MRtYVfS6uFM83nUXkp5W95hYwHiqqknAAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_5: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_6: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAE9ElEQVR42u2YfUxTVxjGn1Mu7HIysBNjExjiEMf4inMDImjmGEODicuY7TTbwiJjMUsMM8uMRAkfxo0t8sdCjMbIR3Qs8qUuY0i0Iw2oyNoRx6QQs0pCGMSy8LVulw6vPftjuQTo7SfF0IT3r6bnpvn1Oc95zvteAo0mAE1NT/iDxWmECywijGVjBRUjpI2Jj09Za0/ehUYTQACA5pV+AIXiElZy2Wy5Qk1pHeEPFqcpArg78INiBNsUhAssgt8UKVGsNM86xWUsWwE/q1VgvwYWBCvxC2BBsBJBsJK4SJXPwbnlUDQjMQaH3kiGOiUBJvMEOd16Gxfv3CPirAhKebakpKD5J22+Ak2PjULB7jSoUxLsntEPjuBE00/Q9ZnABXEI4jj21IHdAV1czQYjyq7pMDBs9kptr4C9AV1c5S2dKP/xFhMEK/EE3CNgCTQuUoWSnAxZ0Mqb3dD2mRCuDMVzzwYDAMKVIVBSHvSZQGwIUyI1OgIAYDJP4HTrbVTrDADgluJuAbsDOr/eP9eMhq5e2bW4SBXuf3nYa39zvgQdnbKg7KoOLb8+YJTyDkVa/EVqdAS0xz6c72+HNuGcwcZFqnB0zw7k7njZbr29fxCZ8dELrFB0pV3ypFeHWJ2SAHVKgvRb7issCFayP30LvvtE7fDHj9RdR3rMBmQlbZp/6mV9KB0sQbCSIYDJqTzfHpYZK07tyyRFV9qZS2BJWWewALBxnRLVOoPTAzMrikScFZGRGIMvNG+SbtMwvrlx1yFsYaMWZ9v1TBibIB/t3YmosDVkcfzJKlySk+Fy+0KDeZegi72fGh2BPVtedJXNoOvXMgBkaHza7izYAVPKM3VKgsu7PzJsjcO1zaowfPx6Mgp2bbNbi1GtnftsMk+gqqPnf1Xn2SZ7aywG/5yEXEbLNj8m84RLhcOVIQvUlRoeQbCSjeuUsrCL87qqowf5O1/FX+dPkOytsZBgQ4N56PpMsrtnl8Ozokg2q8JQnZ8zF/Cuokz49zGGxqcw+c8MRictGJ2yIFwZIgutHxzB1V/6kfxCuF1MNhuMuHjrHrTGhw6zWPbikLaiJv9t4s2160zV0SkLCnZtQ7gyxKsew+lNJwhW8vne1/DVu1lLAm3vH4S27yGyEjctyG5ph45evoGGrl63ujinNx2lPKto6STD49MuY86RXWo7ehASzMv+6WaDEXlV33vUALls4CnlWUNXL/lt+BGuffreglPujqrvJMfLngWp3+CCOI+6NbdGJEp5NjBsxivF51izwejy+cJGLXaX18rCNhuMSDp+Bg1dvaCUZ5428m7PdJIKByrrUXmz2+FzWV9fREVLJwCg2zS8YO1QzQ84UFmP383jXo9KHs90lPLss29bifGPMZzPe8tOWSk/BcFKEp5fP2ePI3XXvZ4yljyEUsqzap2BDIyOof7w/rmIOtuuZ5Tyc81TZnw0Chu1c4ovFXZJYz6lPOt6MISXjlUy/eDIgtsuPTYKOclxSDp+BhUtnaCUZ76A9cnUPCuKJIjj2Kl9mWR0yoLJv2cAAJd/vu/xvPbUxnxJ3YzEGDyatvjEq8v+IoVSnun6TMRXXn0qb36WE3T17eUqsCNgRkibv8AyQtoUACvzH31ZmWLmQrEeNlvuime12XJnLhTrFdBoAoSa0jrbE3H7SrQHI6TN9kTcLtSU1kHTGPAfByJ7Gn3nQIYAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_7: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_8: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAGNElEQVR42u2Yf0xTVxTHv7c/8PkE7GDDTqTZEMhCBU0GKkhcjIIocTFCN3Gbv6hRt8gUN7MIASS46LKZxYUFZSoRnGiRGV1BHP6aCgosCgqyosgqzMZQRGTPhrbv7o+tLxQKtmRskHmS90fvOz3v8+753nPveQQqlRgajZVZkx5BJNI0QukijCKjhJRRiznbdCirCiqVmAAAuzbzfYhEhzGajedXcgczCwmzJj1CJJZcxRgwSjBbRCTSNIwZIxmi0abZIXEpXSTCGLP/H7DZYh0bwBxnIgDwqsyD2H7bxkbSJMMBZVmG7vkgDrGhgSRI7g0A5IpOj5yK69BU1ROWZeioADZbrFAq5NBsWm4DFSwqSIGoIAUiAvyQUqAdMWiXJZGXtBT9YftacsxspMRFYbjysElrMIlJXAmkigjFTH/f5/pujo1E7oVaOlypBfv6AADO3mpG7oXa4UsiIsDPKb/JMg/MUMhJZVMrnJEGx5mIUiFH2acryWSZhzC+QOmPmJBAsmzvUTosSfi+5Om0r4xlXJJCzqol6AvbFzo7fr4gD5Ej/TgqXwDQ/rjbaYAuzgSpm5T2jWu2WAc8wza7UUGKQWPFhgYKmZL0/+OW2EhEBiqIO+OGts5uFFffFnRU0XAPyTGznwurMxhxU2+g5l4zCZJ7Y2FIAGJCAuE5fhx5YHyC4poGaOt04DgTkbpJ6USWGXKBujNu9ho2W6zIeica25fMHaDFmf6+2BwbSbZ+fwaaqnqcqGlEfHjwkMAZJefBcSaSEheFL5YvtLs3098X8eHBqG5pJ+sOnESD3kDaOofOXFtnt7AoxQidm1G4IYGsnxcmOFS3tOPa3TbIJjDwYMbBgxmHhHAlenrN2FpYCqWfHMG+rzgMvq2oHAfO1+BYciI+XhghjP/e9RQPu3rg7c4K62Hj/Jm4YzCi6pdGyLwmYtbUKQ5jbsw/jeaHHZBKJRAzYfMzdr8bQzyYcdAZjEjMOY7Pf7xM6/UGkn3qEn38xzMSPS0AABA9LQAydxbr8kpwx2CEjB0PC8/D2PMMp2/8ilX7S1DR2EIvpalJ9LSpdi+xOu8HmlNxHZrq28TH01144YRwJXoAZBafg8ydHQC9/uApHK+qx7HkRPzW0UUIq87iu/elkis6PRZ/VUA3zAsjtjTqDEaoD5zEE86Eup0fCUEqGlqwbO9RardAezgog/2h2bRc2Fh0BiPCMnIp96iTsD5ewgJEDwdV9Gwc/VAl/H3v2WtIKdBC4eMlQGvrdBQAandsIEFyb0xPzQFh1Vl8dvx8klKgRdK8cOxb+/aAlHiu30lff1lG+sLYZq781l0AQNJbb9otyIqGFsTuOgSlQo70pfMQ4jcJQXJv6AxGnKlvRtqJc3SGQk5+Tk2yk2Ka5idc1umpVCJG4qwQ0pdnemoOwKqzeOnqDB4rttPKZj21WK0DrpQjpRQrtlNWncWfqW926NP32lN2lWLFdppypHRIv8VfHqbKz/bSxvZHz4353cVayqqzeBEASCVip+tr7K5D2FZUPmg5S/xWA1u2+leI/nZqy3sAgLCMXJp/+cagftuKyqHeX/JXm8Sqs3ibthyVIVsqGvQGoXhznIkofLyQEB6MKV4ThRp9samV2spP975Upw4/NukAQOQbryEhXIlgXx884Uy4fu8BimsaoX/UOXDjYFmG7tFeIVO8Jgpa1BmMyCg5bwdr8+3o4bBHe8UOiv17O46bHuT0SW2B0h9KhRz3O7poZVMrqWxqRb+YlO2zzUv630wp0JKvy6vgwbjhfkeXMGOOHjbYuJ+Xp0vniEmeE9CgNzh1hpY4gnjY9RT6XjNhWQYj2T3YzORCX+jweCmViCGViIcNeu1em0v+N/UGu7T/q20+yzK0pqWdVre0O+Wff/mGS93JiHyXMPeaySdHzzh1qksuLKWuyG5EgFmWoZVNrYjZnQ+dwejQp7qlHapvilzu/YQ6PBJmqzCJs0JITEiA0ARU3X0AbZ1uyAr0nwA76lqeVxL/8Q8pw5XIi4+BL4BfAI9VYEpI2ViBpYSUiQC6Y+zML90hepaXXg2eXznqWXl+5bO89GoRVCoxdzCzkLda5oxGeVBCynirZQ53MLMQquPiPwGIuTPgVOzhvQAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_9: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFSklEQVR42uVZX0xbZRT/fZevFNaZORgMkYFbGVMCOGOrhi2jwwSfIJpA6IwvC4lm2QNmexAlscw5xQdISFz2AMQXE2nAGOHF8UCoG4SkV9laLNvgOmkRCgyQhMqfXnp9KPfS2/+tzSzxvH2n595z+n2/7/zOOZfAYGBw7ZoHDR9nIEX5AUD04N2loBT/vRArIPTgb/ctfHvjLxgMDAEAXPqsGDvCd4BQiqQUYoXA69F5fZLgveZncSDVJAXL80iO3fWLRfBY4HFXMjiguCTb2WQJ1j8WwpSBSW1kAKLHfhHCvM0kL26DiVBK48LVltt7WZUKAZQCrg0is1EqBAB7dqKo0oWgz8eCkpgCBXAiJ4toX8jFyexMTC0uE6OJRX2FBiezMyXTb0bvEQC4WH5a0k0tLsNoYoloO7W4DG5plbCcXYjl7kRn5dogmmI1vninEpWnjkvqHvMEjCYWH711FmV52ZL+p9+mAQAt1RWSzjK7CKOJRXVZEfTaEkk/9PAx+eSHIbA2znsCEYSJJtjGGh3GmhpkwQKAa9sNAHjickV8jWgjPiNK5anjGGtqQGONLhBaMQfM89AUq9FWWxXWLC2K4xRtVKmKoL+31VZBU6yWoBcfJChFe11gsD3mCZhn5jAy7QCUCuHmsJl8Pz4p/T6/tg4lTcHVvkFJ51xbB5QKoevuODHPzEFbkCuDBgC011XhXGtX+MyG91s8IXdXnU/Gmhpk6qt9g+joH0YiskRjjS7g9N5o7QbL2UNmj9CQ2HITddbhgJ3t6B/2Olal771UXPvqKQ3Ui9lgd93RP4we84TMhzrrcOAfjRbDpXlHZWvzzFzCqeCBczmsz5gwbJ1dQI95QrrZ9+wLe8edCFEqhDtTdtI9Mi5dSOvsQpwY3k1pAdhMdHHky3y+WI95h10bpL5Cg8s6LTZ5HmmU4uawmRhNbFQJPlpCCuIDRhNLQvmgkTBcrj4mrX1TV6Ik59BBmY+fp+0wxkscm9v8U6/HIvlksM8kLHE8fySDPHfooKRacW3gd+dS4i4ez+NEThbJUKXLWPLPJytxEEcwLuF3Er5jsb6ThmO6i+WnZSXiLi0TUJqYLLHlJrWvviSj55YBEz7vvR3Sx77DcNiA01KffgcdyWdEah7lHFJSd66tJzxA59q6zMf/iJp5HvUVGlSXFUnFT+edX0m4WjWeYHXFheTCayVS8TNgeQTj2P2QTWnYLFGad1TWFdjml8DauIRmibOF+Wg484qk+mNlDcYtd3xZwh9P2oLchGP4xZzMsD6jD1ipELilVZlKry3Z625dG0RqGMW1r57nA/UiZnfXjTW6gL6OW1oNW3PTcA0oOzMnjHIO4ltNtdVWQVuQKzahhOXsQn2FBjk+FN73yyRR0hRUv1wkywbGsfvQqPPJmcJjQZvQUc6BSHeERroUV3oH4d+I6rUl0GtL0D0yDtbGkcs6raxEHJl2SH/ONxijiSUfvvl6QKCiXOkd/HfEAUrB2jhZux60JOQjl6Gijf8gxZf2WRsXcWQVOT95u1syMu1Ae12VbCfFocgRlSria0Qb/0HK0MPHiGVUFV1CVaULLGfHudYuCYPPKJWYWvR2vF/dvisbBs7vMmLLgEk2DASAAcsjPHAui8NAsDNz3lmFT4kZP9NFw0yqdCE5x60+uA5I6qGOMljyD/Z8TNWa4LHsm9pS8FgYgPyY9IGKWUhgBhh4tjtku8zzyRcopd7PXoLiawbdX64AwgXvV0ck6WcvYgWl76K7eYGBwcCg8/okdjbPA2iWAk+K3SVWeHADO5vncetTGwwG5h9XvJIUs9xUXgAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_11: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFE0lEQVR42tVYMWjbWhQ9zwl0KM9RKZq6RC5JNscYAp8O9tLGdAhxIA4EPg5yNw+OMof4E4qHbm6HbsEQAoEk0IYModiJpeUTEAlGo4cIQ0oHDTZo6fL1/lIJO5Icu7ab5IAHPT1ZR1fnnnuvSCqVGjs8PPzvzZs3fxFCtgC8xcPCKWPsfblcvkilUmMEAF6/fv13IBDYxQOGZVnpSqWyR35F9l88AjDGXgV+yeBRgBCyFXiAmu2Gt4Hfuco0TWKaJul1fZgI9EuU4zgiiiJEUcRtcrlcDgsLC87eURAe72dzLpfDysqKc3x5eQld1wEAoigS+1wmkyHFYhGKohBKKbs3wpFIpOP48+fPMAyDAADP8846z/MIBoP3KwnTNEmtVnOt8zzfQdZGo9G4P8KmaZKFhYUOOdwFSZJAKWXD1jKZn5+3/EjmcjkIggBd133JGobhGWH7XLVaRSQSQbFYhKZpGFTTvoQ5jiP7+/u+Fx4cHECWZei6zjiOI6FQCMlkEnNzc577VVXFxsbGwIQDftFdWlryvWhzcxOfPn2CrusMAFqtFlMUBRsbG/j27ZvnNXNzcwiHw6PTsGmavpFVFMUVKUopo5SyYrHIDMPwlEez2RwNYUopK5VKyGazrnOyLHd9raZpkmq16pJDOp1mrVaLjSzClFKm63pHtAzDcGTQDXYxaT8ellv0VZp5ngfHcX3feGJi4s/4sCiK5LZlhUKhO6N1uyJGo1HE4/HRETZNk0iSRLy8d21trWuBCYfDSCQSrjdTKBQgCMLA3ZxvhL3KMABMT09ja2uro520f+FwGNvb275FRNd1Zifs77ai434JJ8syMpkM8apiiUQC0WiUVKtVJ8EikYgrsu2oVquOlOLxOGKxGGq1Gmq1GunHPbqW5ng8jmAwiEajAUmSMD093Vc0dnZ2cH19jWQyiXw+z+wKur293fFfm5ubnt7eV3tJKWWKojivbH19nX38+JH0SnpnZwdHR0dsd3eX8DwPSZKIIAieD91PQenqEnb1srsuP1174fr6GjZZW0Z+DyuKotPZ3aXrsZcvX/7TC4EnT55AFEXy/PlzZ61er+Ps7Aw3NzeYmJjA06dPnXPBYBBTU1Oeyff9+3dYluXsf/HiBWZmZsjPnz8xOTmJHz9+9K9hLwiCQBYXF5FIJGAYBtLpNGtPpEKh4LSUpVKJSZJE2hPxw4cPkGXZ0eny8jJ59+6d6z6rq6vwS8S+RiRN06BpGo6Pjx3d2YlydXWFbDZLdF1npmkSSikEQegge3JyAkqps1YqlUApdfXaoVDIdx7sqzTbetZ13bOR0TSto5+2NWsYBmRZZl4d3pcvX1z3icViwxlCe3kgWx7tFbGbC7RaLWYYhpOcqqri+PjY1+KGStj272Qy2eEIz549893PcVxHccrn846kBu7WesX5+bmrl1heXnZZ1u3JRlVV/CLL/ogkbFnUajWXl9puUKlUSKvVYvYXpPaEu91HD2xr/SAajZJmswlRFF2DabdJO5vNdp2uRyIJAFAUBZqmIZ/PM1VVXRLxQr1eR7PZ7NpTjIxwe0n/+vWrZ8VTVRUHBwcO2fX19TvnvnHcA1RVddzAHmx7bYBGpmEv+wqFQpidnYUsyx06vcsZ7oVw+zfjQb7+/FFJDONbcQDAKR4PTgOMsfePhS1j7H2gXC5fWJaVfuhkLctKl8vli0AqlRqrVCp7jLFXD1Qep4yxV5VKZS+VSo39D54koPMvO+b3AAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_12: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAD8ElEQVR42uVYMWsbSRT+ZhW81ShcYFzYAaN1qVzhXKHDcKm8AudCAgnbXCzFxaValwZVsZBcCawiB6rsQrbUuY9Aq0o2h/cHrNOtMSRp5OY8IE7G2bkmGxxJ3l2PLkYiD8SCZue9b96+9733hhiGEdvf3/+s6/qvhJA3AJYxXtIQQmxalnVkGEaMAMDS0tKKoih7GGPxPC/barXq5Itn/8YEiBBiUfkSBhMhhJA3yhjGbJAsK5gw+TEBc84J55zIrt8aYM45YYyRNXMN5XIZjLEBUIwxUi6XsWaugTE2MnCSTqc9mY2MMZJZyUBP61//s5oWCsXCN+/lN/ID79TqNXQ6HSFj946sZ188f/ENEADQ0zrid+M4cU8AAAktgVQqNfDO6ekpqrtVQikVt+bh+7P3yfbOttRnff3na3z4+EHcWgxzzknvoicdh72LHmRjWbkJSP9JKRW5XE4acC6XA6VUXNUZdW9sfn4+HyXBnj19Bn7OSTweR7FYJMlkUhrw9PQ0FhYWyPHxMe79dI88+f0Jzs7OSLfbHT2GOeekP9ODxLZtnP9zDgCYmZ1B1IP5DBOWiKEsoWlaJLA+XbmuO7C/n/6GiZ7WfbqTDwnOOXn5x0s8+PlBoJKd7R28/estLi8vhaqquPrrdrtoWk3iffbw8JeHwcn4bw+Hh4dEVVX5pEtoiVDPVnergZ+SUiqqu1VYTWskW6GAKaWiUqkEGqrVa4hSACilolavBR68UqmE6gr1cKfTEYViAbZtD6w5jjMQs0Hiui4cxxmaqIViIVK5jszDfrm9Kp8+froxpQ3bM0z3j9cPD0uImdmZGxsctidKskUGzBgj+Y38QNcFAMlkEpqmRTamadrQQpJKpZDfyA/tp28EmHNOTNMMJP3MSiZSL8A5J5mVTGDhME0zVJcik2z9hlZfrSJsRFp9tRpa7aIkX2gvwRgje3vhl0KjlmYAyGazodQW2ku4rguraUXqBfS0DsdxvlJX/G58aOxfd2DXdUEpHX3iYIyRR789gm3b6F30kMvlMEp76RedUqkEdUpFKpVC+6AdqXBEHpH8xt1/bm1tSffEjuNgfX1d9Ov8X3nYV+gbKJVK0t4tlUq4CvImw6hUpaOUCnVKlQasTqmQmZhHGvOvSybbtgPHfL9QvN99LzXm35H1cPugTebm5qQuUtoHbWkPS99L+J7WNA2Plx8joSVQqVQGMp0xRkzTxIl7gneNdz51CVmbIwHuvwK4DkjY+ncPiesYRHb91m4vx7ofHifAjQnC21CEEJuTglYIsalYlnXkeV523MF6npe1LOtIMQwj1mq16kKIxTENj4YQYrHVatUNw4j9B/ZF9xcj9i8tAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_13: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_14: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAEyUlEQVR42u2YPUgzWRSG3ztKkDDIRAeroAwDaSKohbL+ECT+4CcYIpKAEMQu1ZAqjfARQbCxsrGwEFmtFEFEsUiYQmWx09ZACmMKi5t4kVsJm7uNE/zJJBPdBWU9TcjM8J5nzn3PySEkEok07e/v/z0xMfEHIeQ3gF/4WnEqhFhJp9OXkUikiQDA+Ph4TJKkP/GFo1wuL2QymV3yXNm/8A1CCDEkPdvgWwQh5Lf0BT1bK35J+GbxA/wD/L8D5pwTzjn5bOKP6kiNJonFYgiFQvgMNOechEIhxGKxhnVqAiuKQnZ2dkg4HCaccyLLsojH4wgEAp8+2kAggHg8Dq/XC845CYfDZGdnhyiKQj4EzDknmqZBVVV4PB4wxtDX10cA4Ozs7NPAloamaWCMwePxQFVVaJpWs+qOLPHw8AAA6O3tBQDc3t4CAHRdJ+vr63WrYp3W+vo60XWdvNSwNK0cDVvi5dt5PJ5X97q6ugAAxWKxcqw+nw/t7e01q8I5J+3t7fD5fAiHw680LM3Hx8d3OatpSi9vhsNhYhjGuwcfHx+hKAp0XQelFIwxIcuyiEajoJQil8sJWZaFHbAsyyKXywlKKcbHxyHLsmCMCUopdF2HoihVX9IwDFj9U7XCHo8H0WgUXq+3alJVVVEqlcA5J5afTdN01Omcc2KaJgCgr6+PcM5JqVSCqqqo9rJerxfRaPTdKUvVGmF2dhaMsVdWsLyXz+fBGEMwGAQAXF9fO24069lgMAjGGPL5fKUXLGsAAGMMs7OzqNbgTbqupwDA5XLh7u6OjIyMIBAI4Pz8HC0tLRgbG4Pf78fAwADcbjdaW1vR2dmJmZkZUEqxsbEhXC5XXViXy4X7+3tMTU2R7u5uqKqKwcFBuN1uDAwMoL+/HwBwcnICl8uFVCqFbDaLzc3NVydQAQaAp6cnAgDDw8MYHR2tCAJ49en3+wEAx8fHuLi4IE6ALVt0dHTA7/fD7/e/0waAnp4eTE9Pw+12Y2trCzc3N3ipL731qWmaglIKVVWhqqqjWfqR+WsXVl5KKUzTfNfMVceaU18Wi8VXx/V2P3j7XZZlYY0zJ36vOdZeRi6Xa3g3UBSFGIaBUChUuR4KhWAYBhRFaXjRsWNornbRGuL1QtM0XF1dIRaLYW5urmIha3wlk8nKVDg4OMDh4SE0TXOkbcfQ/Jl9YHV1FZRSYoFms1lsb29X7i8tLWFxcRE+nw/xeBxzc3OkXl/Ui+Zau4OTsADW1tZgmqZ43uoAAOfn57i6uhLBYJAkk0k0AmvHIH3GElZV5+fncXR0VGmsl00GAEdHR5ifn0c2m3Wsa8cgVfsJdtrJ2WwWiURCFAoF1NslCoUCEomEcAr9dgLVrDBjrK4wpRSpVArWYl8PQJZlwTknqVQKlNK6hWCMCceW4JwT63feDtYwDNSrrF2lDcOoCZ3P520XKtsFvrOz01ZweXm5Ydi30MvLy/hI7mY70evr66pVLpVK1v774dH0vB9jb2+PtLW1Vc1hVwwyOTlZtrNFrYT/xn8MH8nR/F9D1av0zz8/P8A/wN8A+PQb8Z5KQoiV70IrhFiR0un0ZblcXvjqsOVyeSGdTl9KkUikKZPJ7Aohhr6oPU6FEEOZTGY3Eok0/QPhp1mxYXjWeQAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_15: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFYUlEQVR42tWZTUgbaRjH/08iuXSKNgiFgpmSWBgQRqJkWRZraW0EQVp6SE6rPSzoQWRIDqUU1kADBS9+IKGsp7B6kPag4rCyjIRGZRUq1uSUQ1ESUZAOo5hAQVxnL50Qv2Lmw5Z9j8M77/zm4X3+zxcFAgH7+/fv//X7/T8T0e8AOmBiFQoFAgCGYVRYs+ZVVY1KkrQaCATsBACPHz/+1Waz/Wn25EKhQDzPAwDS6bSV0Dg5OeleWFiYpG+W/ccK2Pv37+PNmzcAgFevXmFpaclSaFVVf7HX19f/AeCeWdiuri68ePGi+KytrQ3Hx8dYW1sjh8NhCTAR3bF7PJ5Jswe9fPmSgsHguefNzc2oq6vDysqKVUa+ZzNjVafTScPDw+T3+y/d5/f7MTw8TE6nkzSHNLNsZpxrdHQUHMdduZ/jOIyOjoLneZiFthmB7ezsRCwWQ21tbcXv1dbWIhaLobOz0xS03ePxRPS80NvbS729vYYt1NLSAoZhsLGxcf3A4XCYnjx5YtpzGhoacPv2bTLijNTe3n5S6Wan00kAoCiK+vr1a/L5fLo+lslkEAqF1NJz9AJX6dmsKIr67f4ZuoP5fF67v4aDSZURdTg4OMCPWrZKQZ1OJ/X39yMWi4FlWcTjcUiSBFmWdX1QC9WFQsGQLl/pdG63m4LBIAYGBtDQ0AAAaGxshKqqWF1dxdTUFBKJBHZ2dnDjxo2yUre7u4tsNksDAwPk9Xpx8+ZNHB4e0tevX1EoFOjo6OjKMF51lWVdLhe0DKxUU4PBIILBIGRZxtbWFhKJBMbGxgAALpcLTU1N8Hq9536guroaHMeB4zhoETKTydD29ja2trYwPT1tXCXC4TCtr68jnU4DAFiWxcOHDy8EKVWCdDqNjY0NZLNZ1NTUoLGxEa2trcjn85ieni5mdGfX+Pg4kslkWfUoCzw/P09nQZLJJA4ODoogXq8Xl8mbLMv49OkT1tfXkcvlsLm5qXq9XjoLLMsyBEEAy7IIh8MQBOFS6LLAExMTdJElS0H0Wj+fz5/6QUmSMDQ0pD579ox6enoAAB0dHcYsfBnwRSCLi4tIpVKnrN/a2lo2ORocHMSHDx9OBSFZltHV1aVaosPlsjENrNT60WgUAMDz/CknlGUZkUjk3LWzPHBUmpX5/f5SBcDi4iJmZmYQj8fBsiyy2SwePHgA7Qr8UOCrrD80NASe5w3Bfhfgs9a/e/fu9684rvunDFtYEATwPI9Hjx5BbyppdL179844sKIoqiiKJIoitBB9nfDj4+OYmJgAwzDG77CWXSmKgrPwTU1NKFcx61mDg4MQRfHKxosup9MOy+VyxLJsUarMWl5Pl8iwSnR3d4PjuKLOxuNxjIyMVAS/v79flLlIJKKrD2cYOJ/Pn9NZDX5kZKQY4S6Cv3XrVjHhyeVyuvpvluqwBt/T04NMJoPZ2dlT8E+fPgUApFIpJJNJ3bDXGjhKLf/x40ckEglEo9HSQtZQZ1MXsFaef6t6K05afD4ffD6fVubD5XJpsnm9fYlwOExWyZiWB19r52dlZQUOh4O0YtRMNHv79q2h3oTu3try8jJ9+fIFLS0thgPE5OQkjDa5dSc/DMOooiiir69PV09ClmX09fVVFM0sz9YYhlHT6TQEQUAmk6mohBIEwZJBjeH0kmEYVVEUNRQKqZIklXWuUCikKoqiWjGgsXs8np9gcigjSRIdHx+jubn5XPY1NjYGq4YyAObtbrd7k4h+M3OKw+HA2toaff78GW1tbcWEZm5uzuqx1/P/3WDRHggE7KIoptxu999EdMfM9XA4HNje3qa9vT2rR7fPFxYW/goEAvb/AM8XsDtuJgQVAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_16: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAELklEQVR42u2YP0g6fRzH31+Llt8hnDQFitHg0lEu8pDQUhf8RgcJ6ilsaHEwsKXlh2BL3BBG0RJkPEUggREXNNyBIPQQt5Q43ZQkNGnicVPw3PdZfieWl15a/BL6rPdFX/f+vj//joTD4YGzs7P/eJ7/ixDyC8BPfK24opRuSpJ0Ew6HBwgAzM7O/u1wOP7BFw7DMJZlWT4hv5X9F30QlNIpx28b9EUQQn45vqBn28VPB/osvoH7GljXddIXwLquE13XCcdxYFmWfCT44GcoynEcIpEIAoEAKpUKDg8PkcvloOs6YRiG9lTa5ubmjM8AfR2qqiKdTuP6+hq9QPcEbAf0dUiShHQ6jXK53BV4V8DNoKFQCDzPv/tlM5kMjo6O6Htt8i5gO6CZTAa3t7dwuVxgWRYA4HQ64XK5AAAejwc+nw8Amv1tG9wW8HsVFQQBoihaPnO73Tg9PW3x987ODorFYkebDNqBtQtqKnZ3d9fuj1tKnM/nw/7+vulv0s7fg+1A3W434vG4JaiiKC+SrFtPNgfP8+B5HplMBhcXF6RWq1FbwLquk2AwiK2trTd/PJVKYXJyEn6/vznrLZUxX0LXdWL6+q1QVRWapmFlZQXb29v2FOY4ri2smTyiKEIURTAMQxmGaWuptbU18vDwgHQ6jUqlguHh4ZazBwcHyGaz9PHxkSwuLoJl2RaVB63+IBQKdbw+M+vfun4rS/l8Pvj9/hZYRVGQSqUatzQyMkIB2LMEwzDU7/d37P3trpZlWRKJRDA/P9/yrBlWVVXk83lks1nabJtgMIhSqWTZyi2Hn2q12lFhr9f7Ql1z4NF1nXg8HkvY1x0vn88jFArh+PiYBIPBRu64XC7c399Tq9uzrMMsy5JEItEo8J1KWbVaRb1eR71ex9PTEzRNg9PptIQ2VfV6vS3VR1EUZLNZFAoF2lXjiMfjpJu2264da5qGUCjU4mO7M0bbxpFMJlEqlbC6utoTqKIoKBQKmJiYaBmQzGbTqdrYbs12anI7u5yfn79pj24mN9uzBMdxSCaTlvWznarT09MtufBa1Q9fkRiGocViEUtLS1RRlI7nBUFAIpGgVrCKoiAWi3UFCwADY2NjCTsHh4aGAACXl5fkx48fGB8ftzy3sbEBWZbx/PxMPB7Pi3OCIGB3dxeGYVDz9z59CWUYhu7t7UEQBMvW2rwCjY6ONlRdWFjoWtWet2aGYagoiohGo6hUKg1f5nI5NHerQCAAQRCwvr6OWq1Ge4Xtac03fR2LxaCqKgCgXC43EnRmZgbRaPRDVP3wrdlsMqVSCbVaDQDetfb8EWDTBpqm2Vp1/jhw86DeN9/WPhv2++vlN/AbwFd9xHvloJRu9gstpXTTIUnSjWEYy18d1jCMZUmSbhzhcHhAluUTSunUF7XHFaV0Spblk3A4PPA/WeFyy9MmCZIAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_18: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAArCAYAAAADgWq5AAAFmklEQVR42u1YXWgTWRT+bsz6MgiOYh4kKkkrBiRI6kqRIRC03D4ERJDSh60N5EECPjT4UCNSWyn+vYiBSqAPlbpdDdh2xMWBLrEExEBhSSnxQbomxTIQCOgIZXwxztmHdWLSn5jEv5T1wEC4OffMN2e+75wzl+GjdXR0tDHGLjDGTqGJjIimiOhaIpFIAwADgGPHjv1mtVp/RxNbsVg8PTs7+wfr6Ohos1gsf2MTmGEYv1oYYxewSYwxdsHSbJz9DOBTFmwy+/8B1nWd6brOvhdg65dsFkWROZ1OAICmaUxVVQiCQE0HWBRFFggE4PF4YLPZAACFQgEPHz6ELMvfVnicc6OeDU6nkw0ODpaArra5uTkMDQ1R03D43LlzG4IFgPb2dgSDwYZ5res6E0WRmb8bpoSu68zv96OlpeWzvl1dXZBlGZqm1QXU7Xajt7cXDocDANj8/DzGx8eZpmnUEIdNgdViDocDqqqyWkXo9Xpx5cqVirXOzk54PB6Ew+ESaEu1UvW1y1W1eMFgcN11m82GQCBQ2mtdHVAQBPJ6vQCAt2/fIpfLlZzrecVLS0sQBIHMmE6nk21U/pxOJ6tGNY/HU/K3lgPt6enB8ePHKzZns1k2NjaGp0+fIplM4uTJk1VFBwAzMzP4CAp+vx8+n4+1t7eXyt/8/DwePXrEMplM/XWbc26EQiFaXFykDx8+bHgpikKccyMSiVT1y+fzxDk3uru7KZVKVfWNxWLEOTc450a1+yuKQpIkEefc2NLS0jI4PDxcymo2m8Xk5CSmp6fx5s0b7Nq1C4IgoLW1FUePHmXT09OYnZ2Fy+XCjh071mT2xo0b2L17N7t+/ToOHDhQyqqiKHj27BmKxSLsdjsA4PDhw9i/fz9LJpN48eIF8/v9axKazWZx6dIlcrlcDABjnHNjfHyc2Ww2PHjwALIs49ChQxBFEa9evcLS0hL6+vpQ/kovX76MTCYDr9eLffv2QdM0LC8vI5PJwO/34/z58xWNJBqNQlVVrKysYNu2bXC73ShvPtlsFgMDAwCAQCCA1tZWAEA6ncbY2Bi1tbWxvr4+RKPR/zrdyMgIm5ycRDKZpJGRkQoOz8zM4NatWxQMBllXV1dpfXR0FLIskylIQRAoHA6zzs7OCp+JiQnY7Xb4fD5z5sDCwgI0TaOhoaEKbt+5cwePHz+uyHBPTw/OnDkDADh79uwnDkuSRPF4fF0ORSIRkiSJYrHYGr4qikKKolA+n69Yj0QixDk3Nopp8nf1/6lUimKxGMXj8Qpd5fN5CoVCBJP0nHNjI5HE43GSJIkkSaJIJFJVoKlUirq7u+lzQjJ9JUmiq1evVjzw6mtxcZFCodAn0ZmlzeVy4eDBg2uIf+/ePSwvL0MQBHr58iVLJBL07t07tmfPHui6Dl3X8fz5c8RiMdy/f59ev37N+vv72ZEjR6pWKLvdjvfv32NqagqpVAqGYZREXl4Abt68Saqqsq1bt1ZOa6IosuHhYazH4fW6liAIZA4qmqZVNInbt2/XVFYLhQLC4TBUVS09hMPhMJtWKea6s4SmaTQwMMB8Ph9EUUQul0MymVy3sJtBygcTs7Pt3bu35j5gs9kgimIpjqZpUFXVFPKaxrJm+NE0jSYmJlgZiEYG/Lr8t2/fjvJMVut+1mrZa9TqmTnMmaXWe371r2ZBEGhhYQGFQqEm/7m5OeRyuZoT9E0+81VVRTQarcn37t27P/5cQhAESqfTNDo6WrU6XLx4sa7sNvQRWu/A7na7ceLECXg8HgDAysoK0uk0ZFlGI8cC3xRwtQdpVNg/5KjqS6rQz8PAn4B/Av7egIloarOAJaIpCxFd20SAr1kSiUS6WCyebnawxWLxdCKRSG/5eKyUcTgcfwLYCeAXxtjOJsnoPwCSRNT75MmTvwDgXwnCFSfWa4mCAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_19: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAArCAYAAAADgWq5AAAESElEQVR42u1ZP2jqXBT/3VDaJVgchG/xT7OVgnQrdLBQ++ctQnF5DqJ0adfCA7t9sdDpgxY6OHQKhQxOUsjypLagg+CmAXHTVJcHoQQlk4P3LTUY+4zRpjyF74DDPTfe8+Pkd86554TwPM9cXV0NDg8PPQDOAXwnhGxhAYRSWqeU/iSE/Pf09KTyPM8QADg4ONgihGQXBegE4LFCoVAnoVDon7W1tadFBTsKGsA+s7q6+mPRwQIAIWSLUppiCCHfsCTCMMwPZhm8awI96x90XSe6rhOrfau13XMmycosQL1eL4LBIDiOQyAQILVaDZIkIR6PIxAIGM8+PDwQAEgmkwYFFUWBKIrGs4qioNvtolqtkk6nA5ZlqaOAI5EITk9P4fF4THpJkhAKhbC5uWnoXl5eoOs6jo+PDV2j0YAoiggEAia9qqoQBAGSJBE7oG0BTiaTJBaLTdzv9Xrjb8P2K/Z4PEilUvD5fMhkMlNBM9NoEAwGLcH+SViWnTmYYrEYIpEIpvGaHB0dDaweuL29JaOvW1VV5HI5yLIMTdOgaRrlOM5kZJK+2WxSt9tNvF4vOI5DNBo1UUxVVSQSCToXJd69a+ImAKTTaciybAqSZrNJRz0z3JNlGeM6TdOopmkol8tElmWk02kDtMfjAcdxZPx825Tw+/2mdT6fx6TDWJalw5+VbnRPlmU8Pz+b9MFgcP487PP5TGtFURwvBN1u17ReX1/H3Bwe8k3XdbAsi06nA03TqJOAZ7UxNa11Oh0jkL5C3sERuzYsgy6ZTGI0pd3f30MURWK3KtmpnvF4HOfn54Yum81a5mNmFn4t/OVnWgD8DbHkcLvdRqPRQK/Xg8vl+hKPN5tNVCoVAIDL5UK73Z4/S4xfD53i7mdsWAZdJBLB3t6eocvlcqRcLsPJoNvd3UU0GjV0xWKRSJI00cbKtMKxs7NjrKvVKsrlsqPe5TjOZKPVas0fdP9nCSe652ml2e12f7g2Ol2aZ7HBYMnkr5fmk5MT50rzeBL/Ck6Pnzkt0C0Bv729mdbhcBjvV0HihHe9Xi/C4fCHyjcXJYYdgaqqZLSFubu7gyAIeH19JdN6tz8F01Dv9/s/jA1UVYUsy9SqiV2Z5gVBEJBKpT605cOW6fr6miQSCVPyv7y8JLquI5PJmOYSZ2dn5OLiwjSXGBVBEKDrumWMMFPadSpJErLZ7JdHfz6fh1VJtt1xsCxLM5kM6Xa7H9ryobhcrrmBDscGj4+P1M48w9bkh2VZKooiKRaL2N7ehs/nw8bGBmq1GgCgVquZpj+6rkPTNOPaOHpHUBQFlUoFrVYL7XYb1WoV77O1z1c6q6vgZ3PxvOeszGrIqaIx7znM+7eDpRGGUvpzWcAOBoMbpt/v3yyDlyml9X6/f8OUSqVflNLYIoMefqcrlUq/GJ7nmUKhUAewTyn9d5GAU0rrg8HgBsB+oVCo8zzP/AZTpXOnvqzBHAAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_70: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAEEUlEQVR42u2ZP0grSxTGv/NiE1lZlrRaRBELXYgIsgSFSCDhVgEhVvIQgo2NjZ3cQp5gYWOhNkFuuFhFSRGQq4agxfLYwpDAloYNS+qwrAkGi3BeczcYjRqfuf6BnDI7M/mdb745sztD0WjUdXR01AiFQgoRfWfmb/hEQUS/mPmf8/NzLRqNuggAgsHgosvl+vleELVaDQAgCELHfRqNxt/ZbPaQQqGQAuDf9wIVBAFer5dEUeRyuQzTNFvAPR5PS59KpdLsB8Df99sG7wK7tLRE8/PzkCSp+YdnZ2e0s7PDDuzh4WFLP8MwKJVKcTabBRF9d42MjBw6jfv7+9Hf3496vf5HYGOxGLvdbiSTSdI0jbxeL01MTPDd3R1lMhkKh8Pw+/0wDIMymQxVq1WSZZn9fj9OT09xe3s72ler1SDLMu3v7zezPjg4oEQiwa/x2HOwsixTLBZjAFhZWSFd1xkAisUitra2MDc3h0QiwbIsEwCOx+OsqioAYHt7mxRF4aGhIZimiT4AEEWxxRMDAwNdVTgSiTSF0HW9KUS5XAYASJIEQRAwOjoKACgUCs1FOTY2BgCwbZsAcF+3Vny7EAQBgiBgenoaAHBxcdF21izLgsfjwfDwMFuWRcFgkAFgZmaGJEliTdOaifZ1Qz1Jkujh78VikVVVhSzLJEkSG4ZBlUqF7ycaDAYBANfX1xgaGnLU5rW1NacZa5pGu7u7zUTfDPx78EdlRtM0UlWV25U1J2ZmZggAX15e8uTkJAHgZDJJ+XyeHcuYptkyK28GtiyL7pcpJ2zbBgDc3NzwfZ86FopEIlAUhS3LokKhwMvLywCAdDrNpmm2WOp+9P1fj3ZaQSqVCjRNI0VReG9vj1KpFMuyTOFwmAFgfX296V/HNs+N/Sywz+dDIBCgdur9+PGj491md3eXAZCiKI4/2TAMisfjrOs6O1Xk6urqkW06BrZtmwKBABwlHkY6nUalUulY5Y2NDXa2ZNu2qVQqsQNXKBSwuLiIl9R9UWHHh90KZ8MAwPf92WniXVl0r4lu7Jx/4YtFD7gH/BGL7q2bz7sAi6IIAPB6vRQIBPBELefXlLQ/rrBt2zQ1NYWFhYW2m08+n3/0TffhHrYsi3tVogfcA+4B94B7wD3grgA7LzDPRbsziQfP6V1eL0VR5MvLSwBo+5nvHDslk0lql5iu6yyKInK5HA0ODrYdo1wuv/qEtC1wtVqFbdukqiqfnJw8q/7m5uazz3VdZ1VV6bUz+FQibYHHx8exurraVt178dJUd2KFJ9scHx9zx8CKorCiKB+6uHK5HJVKJf4yVcI5RHwE3Gg0zr5KSSOiXzQ7Ozvtdrs1n8/3qeCca4MH4W9eLNbr9Z+fCfhhlWheLH61q9v/ACZG/JIxlqUGAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_80: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAE40lEQVR42u2Zf0xTVxTHv6d9lPa1wKoIGJpFywZYcNNsQzCLMakhMTGObbIszulwLtmW6B9bYgxDZ5wuC3/q/jBxc5szLhnqwCwTGyCIM7AIY4ppsQNE1w0YYBXKaynQsz/Ge+FXaxWskvT8dfPOezefe98533Peu4TCQjXKysa0RfvyVDGaEgQC6/EkmUp1PjDiP+j75kA9CgvVBADi9v1boFKdiBSDNORVxqJeN8nnHx0jeawR1Kw4AoGt0vH9J0lbtC9PpRYuRwpU1Ovw/NMpFKeN5c5eN5yunknQJmO8MvaOjFK/R2L5OTXRamE8DCANeSHEamjayuYQdvcra+nzwnUMQJn/sK2BSs5UszTkRbopGfYvdk58jFu7+qjkdBXbrrdjjGivOmbl2pMAsDR5IYx6HYx6HQZ8w48SFofO1VHltT8py5RE1iwzD/r8dPlGJ159KYs2rMxAQ7uLzjbayTPspxxzKr+xKhvfX76K7j73s4I05EXesqV06ZN3lVUXl1VRaUUtT42vh4VNNyVDhrXsOQKnq4cB4I/b3fjl4y3Y+vIKlFbUwpKaBAA4UF7LtuZWAMCF4u1ktZh5ySIjnK4eCAAQp42dFAIpCYY53eGDm6wEgIvLqsjp6lE2wvFPLwHgp0QtRL0O+cufAQD86rylJGTqeEx39roB4H/gucr4qSbqdRD1Orz2ooUBoLzJweN5wtKQFyZjPAPAXckHkzEemYsTufuehzbnLscCgwhrlhmZixO52t6hLHTWwAWrspGekkhTrzd2uFDT0sbppmQAQGtXH7ncAzwxoS2piwAA9r//VcYpCQY+WrRRmedso53eOfaTstBZA5/e+SYmZr1s1fYOqmlpw8I4kQDwXcmnyJpsH1hzCACfqr/GazKWEAA+dK6OLjo6IAiCLHss6nWKcs0auPueh1ISDNOA70k+AED/oMQAkJtmYlGvU0JohzWHrBYzt3b1ke16Ox/ctA4A8NXFJvzV08/BCktIYP/oGI0O+zlYfMqvMNQcTlcPqu0dZLWY2bZ7G31b9zssqUnYlZ/LALDrxM8AgMzFidza1Uf9HimkOoUE3rAinTfnPUdDwyPQx8Yo1113BlBypjqs4iLqddjxdQV++LCQctNMnJtmUmL6o1OVXNPSxgWrsgEAtpa2aWETPrDHS2syligZPtWO1lyByz0QVth03R1Eful3LJfkQd8wXb3drZRc2/V2WPYcgcs9cF/tFxABkxOm3nFTXjzLkjcxdMIpVBEBDpZA4fomdZuYZxYFjgI/jqQL1iA9TPv6yIFNxni8/7qVgmg5h6vlkQH2eKnghWVKGZ5qlS1tYetvZGLYoOM7Hml+Jd0CgxiVtShwFDgKHAWOAk/+zA/lf+IqXbDP/ARRC3i8NNeVTgjVB1S2tAHAjDvocg8ov07jtJpp/robnQyDDpect+iwrWHGOTp73Q/8h1QI8poBj5dsza1su9QcbEEAgE+PV4T01ztucv0VO4W650F65RmBrVlm4K31QXd33Og+m0FhbFjQe76s+o3DB7aY2WoxP1Y1KG9yzNgrz0NZCwQuzB9a1XkSthbnaDTahvzsNEj+UYga4bFzSf5R5dhgoqmJVhMAqLbtezsA1TExRqUJdQQQSZumEvLBonx0G/feZ7ljRHuf7KPbH9X/AWteFUC0tlu8AAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_81: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFjUlEQVR42tVZf0zUZRj/PN/7HnzvyxFeSlM0NMSmbOQCpTMrBxsOZ5TaDsempU6TMcu1NjemU+ZqtObmj1yj/gBqrkKXGFiM2Ggz2oEkUpphRyTiydgZCEcvX6473v7Qu/jeb46fPv+w9+55n+fD836e53mf9wgmkwbnzrmknYfXkKg9RJxvwCwSTlTLnf++p5QfNcNk0hAAyLuKt0EQPsdsltHR11lZ8RmSdh5eI2jEn0LpjzidFC2KfCqwhGubE4wiidpD4MF1GVPonY0v4sOt62kqAB+o/B7Hv/2RZFkKAZqOCOFydk3yoik77XBtE+cbBDxiIkay6eOGyyg6W88XGmIjooi1385L8rKpMCtjegA3d3SDMYWsAPeXQGPX/pKJMYWaO7oxbYAlrTbsbA9UAQLZmBLAY6UkL5uMSx8kTdOfd7C/osaT7YwpdHJHLoxLF5H7+6Kz9XzaOTw2esali5C2OAEAkLY4Aafrm9Bp6ycAWLYw3ufYvSkzXplwlRhSHKr1vmwjXA4nXA4n9mUbg+rOCGBvKczKgCxLXJYl7h1djSDMTFnzJ522ftxnw0hbnIC9matpgCkAgNauux7KuEZHZ0+E77NhfNLwMwCgIGs1irdkAgBO1pkn9QQnDfAcWYevmq/xngE7kuINWBAXi9auu2i03J6dgHVRIhhTqOrK757PTtaZcc/OJvWGN2kcHnY4IcsSP13f5ClbF1rbI27fUw54bPLtr6jxXLBgiMWsBKyLEv+/O4ii3yYx42UtWhR5QUU1zYuNwT37P36/t/bbkVJ0yqMTLYqcOSLvdhOOsLXfzt2tOFoUA9Kk09aPyRixJgSYMUUVqVCRm0hkJwS4eEsmcp5JnpBjY/KT0wd4QVwsNqenzMiIFHba9gwMTRmI8dgmeffRsG8km9KWh8XBz958DQDwxqdfh2X3Qms7nxJKfNHYFpbeB1vXj0tflqWJc5gxhTJTk1G64xVVYwiX4wBw+6MDYZ/0sMP54KZXUY0frnUg0KNKUBT66CgkxRsi5qYb+HhEHx0VOSWGRhyed4j9FTUI/ZT0QAZKDxIAxBW8H5a+e1gtzMrw+IyoSiyI06v+ejeKUI1kPHsek6JVvgKJRpuWecTbwJInDFS661UU5a4DAKxIiMe2F55FV98AfuvqIa1W9DtBn9i+EeffyvcALHr5JZoXp8d3v/xBop+LD2MK5a5KQc2727Fu+RIAwOb0FKQmzkfLX1bq7Rv08eUDWKsVcengbno+OVGlaIjRYetzqWjr7vUBzZhCJ7Zv9PuSs/qphXhcL6Om5YbPntxVKTj/dj4MMTrVnhUJ8diw8mmUNV7lQSnBmEIledkULNGO5eeouOyuJsGenQqzMpCZmqyihyxL/Fh+TsA9SfEGlORlkzelBK96yHNSlwXlUFK8ASsT56sMbUpfEbrpjNFhTKGVifMpVAXKSV3mk+iCP0ChZJ5eVq3dCRNOAgeyESg4QSkx4nRSp60/pKH2Hptq/Wt3b8g95o47QW0Eukd7Ty0qwC6HE6UNLUGNXLp5CxarzXNUmigRF9vaQzq/2NYOzcNuKcsSt1htuHTzVtA9pQ0tcD3sgAE5fKrejKorNwL+xwUV1T5jkMVqw97y6oCO95ZXw2K1qSYOTZSIgopqBDrRqis3cKre7MNhjZielUGAJ9NEQUDl5es0OOzA3FgdQIDNzvBl8zWYTlfy3r5Bnx9PtFoRly23qbGjG3opCnNiJAyNOHC1qwd7yr9BVfN1H8eiIKC3b5DKGq/yOFmiuXoZitMJS+/fOF5nxoHKOp+RihPVkm7P0QziaPJX1L3LV6jW7K4cY9+Hx66D7QvHFycYH7kfFgWYTBpWVnxm1OVcy4lqZxtOTlQ76nKuZWXFZ2A6q/kP2YxSvM/8vlsAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_90: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFB0lEQVR42u2ZbUxTVxjH/89tK7TeUmxTawvMLghNCDMqpI5MYxwLc9MZSYSgfnBxSzAhvizGucwtcck0TOPmlpHNLZK5RGXogiGaMRSck4l06MhsyEpxwxfQaloovSnI5fbsg94GKIiKaJf1+dSep33O73k75557CAUFCjp6VIov2prUN8C28wZdsZ7XMLVKweEZSp8ohXxCkASvf796Cu3sr9jTyQoKFEQAWNE2O6/lG99ZvphbNc/G0kx6RIO4PT4cueSiz6rPhISAkEMVnzhIXbQ1SaFNuFb97jpu4fMzGKJQzv1zi5bvLg9Jgd7nlH0DbPuHyxc/FVi3x4cDZ5vpRIuLAcBL6TNpR/5imHVaBgDNHV305akL4d/P0PGYn5rM8rMy2McrX+E27/9xu5I36IpXzbNNOuxZVwet2Hc4JAT7yZZkBACUn2nGb21XmXPXBgDAMYcTh06eA282hgBACPZzAKhyYxErybWzD46dLlbqeQ1LM+mprM5BNX+2wcBrMEPHo7Qw74k5cdMfkGG5yo1FLD8rAwBQ/F01yo+fobI6B0py7ayx/TrjzUbm2LGe0kx6VF1sZYVfVFD5r5coPyuD6XkN4+TVoLLpMqtpacOhhhbIKXtS8vnPjRBu3uG2LF0AGRYAVufMBnRaXPf2AACa/r5Bs1NMJDf9i7NSaKgdtUrBKeUvCeo4AgBeEx8y8Bp6ksAnWlyMNxtZaWHemHabO7pIEiXk3INkbo8PO6t/AfwBLJmdHl7qwsADg9L9QZHzCkH2qM00UuQouT0+uDrv0MuZqQRgmF3njduAP4AUQyKartwAAOyrbcTekw1hx9YsXYiSXDuLiPDjyqt7DlK98wp4TXxIHhOC/dyWpQtQWpjHbvcKBADmRG3EfyubLjPotDQ/NRkfVdUDADbn5QAAUgyJyEyejkU26zAnJwzcLw4yABGpvuUXAABxqntT3OwJDNNXXWzFeddVWjInHdlWC2tou8ZsSUYqLcx74HyTtv3KoNlWC7MlGVm98wrK6hzk9vhQVuegVV8dJQD4dPXrrLmji4RgP7dsjm3c3hk3wgcb/iDhrgg+TnUv3fc/r10w96HrvGztG7Ri3+HQ5u9PcHI2eE186PjWtVyaSY/3KmsBfwDzU5PZhICbO7ro7W+rRtVZjdNoZH2NJYtsVtZauoG70H6ddfUIZEnkWX5WRrgJV9oz5R0NE47w0GYa2lSPWiJmnVYGinAy22ph2VbLQ9kZd+LHgZtMiSqYGHAM+P8ArJzsCeRTxsjxFENi+KEmKoDvioMAgFpnO+09/BOg00as7yW5doq6CAMAdNpRN6BY08WAY8Ax4BhwDPjZAytUiv/Ww48kShBEKcKxqXFTAABeIfhQR6mR+sfdqh8InG21sNPvr6OxdABQtWkNunp6I/SWxAQGACW5dpaZPJ1GcZgb7UA64QiPd5RPM+mRZtKzidiYELBapQp1dgewaNcBetr1Ga9SUmd3L1s2x0ZjvZ9W9olSCAA3RTm8uc67rj51YIVKAUmUKGlawtgR9glBcnt86O27ywBQnyhykihF3erg9vjQ2R1gSuG275taZ/v6116YNegVgs+U0sBr4BWCmDvTHJHdWmc7CV7/1+Frr1Pb3uTkzo82GXrtpZCc5wMD6faaH35vfWtAoeQsCVNh4NVRUwZl51poU3lVSAgIOVLF7r8oWq9uAaCzO8BGXt3+C7ddHrEU3f1TAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_91: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFLElEQVR42tWZf0wTZxjHv+9dwd16thsjrRu6IVPszKqmbvyoM5jOLAvZJCZCUbeZqCPizObMgGQkZJnRRJcMXLaODHTjDyMgm9MuxjAhIWQEOjTROkXYOjZGpIQ1odzlJnC9/aFt4HqlLe1GeZImvdz7PO8n7/s+v94jKCykyfnz4iPFZWnCfamSTdWWpKgZSkVTWEiZFn3w8IKPGxv/illCjv3T+MmwVFhIEwJAKq7IYpeyXUe2WehiU6a0Wp+CRJABtweN1/vJp5faRW6CM5PGEw7CFJel0Us1f1wq30tvXrlMQgJK5+8jZNvJM6I44X1GJdyXKqt2WyKCPWbvIMLkVFxhmOQkVL6eN+fcm1cuk6q2W+jyuguVKjZVW1JsygwL29TjJB99bQdYJr7LxwlYpUsh1mzjnAyvrc+UPk7Vlqh0GjUV8ZllGbBqRgQAjhfoWDgDdgB6cloMO361PgU6jZpSzWcynUZNffZGPgAgWRUdtx+uvuMafXPILUY7d9TAHC/Q72zNwpubNsTkoHdHxkhX32DUu0RhkYkqVgNNPU7i/MsNADAu10PuPOHe/+/A31+7g5arjoBDWrONs3btwDd2keMFGpyAHVuzYM02xjRfzEfiWX1KAJbjBbq6tZv431W3dhOOF2hWzYhgmQdjY5SYgf/mhFnPtW09ktJ/pbELciRmhjqdRi257o2Rph4nAMB1bwxmQzpuDrnj5nQxr/ATMzLfgZezCQDY2hywtTkAAPvzNsY1SsQ1rO3KeR4ZT6ZKPa5hdPUNIt9kQM6qp6WEBJ4WfdBrWOmtlzYQ8WGBtCt3HeJdqqoQZ9mftxG3htx4TM3Amm2UBtyexAT2dyh6DSudO1j0n2W6uIW1US/vWxSp+cirm6R9eSaiZRgqVFn4Y8UeGgC0DCMtOPBDp5oT5IX0NCnhokTCVmusmhG/uOrAb25PTB3HFeevIqtmwPECHU0TEDGwvI1p6XbGtFKsmglpOy7A/lXw93J0clLoTjhJJQKAMDVNz9W5yG3HFdiabZRM6WkYFwQSduznzRQANB0KH4+1DBPVxY0q3hFhZhKJZ3SIGHhNxal5J4XHS49HXaLePfFebMDT4gPWFzPSIjpo96em4W/f163Q00uSItvEn13Don+umIA9vOBbt0JPt5btiXh711ScogCg48N9EevkHT/tv6eg5p04fhr4kwDAyDgn9Q4Ok0gm7h0cJqNe3jfq5X3R6IyMc9LMOaMGLqg5S7YcrQsUNrlVtShtsM9pbKetmeRW1Qaec6tqsdPWPKdOaYOd5FbVBvxky9E6FNScJVEBF9ScJZev9wXuv/wZrr7NERJ6p62ZtHQ7g3Raup0hoUsb7KS+zRGkc/l6X0joIOD2264gWDm0vCjvHRwOgpVDy4/HgNsDOawcuv22i4QHvuMKe+Z+uNE/y1Bn/1BYHfkYuQ0lUWJZdNVaELBxuT6s0ubMFbOe1y/XhdWRj5HbUBIlFkqpZjAb0hUvrDleoHfkGINSrmVthpRvMoTUyTcZYFmbIcmL+h05xpA6ZkO64sUhNerlfXInaj5khR965i/fZMC5g0WKyeDi4d0BaLnOxcO7FXXOHSxS1DEb0tF8yAq5k456eR/B9g9sJ9/eXvr+KzlBRmdelVqeywhaJUVHue0ifmeZj06oK9nq1m5SXnfhy0X32YsWb3VNTGZmXfm295e9U3QS9ZTm0Vn3ZQspA24PbJ03yLtnvhO5Cc4sNp7sI0qfbnUadUKEu1EvH/Tp9l8/GH5cFLphzwAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_92: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAACzElEQVR42u2ZX0hTURzHf797z/Xuz012behQopWYPQUxUIj1GJgFEbEYi7DAkOgpYkj4LGLiY4EphC8yFAkhrCx6SJEyxJSgdGkLSTZb3pHbdNx7d3oyQmq6aWfX2vf1PtwPh+/9nHt+B8Hj4XFgQDd5/RVrKdoiylKjw1aMJsLxkMesa2k9HPtOU0q8xyxi63qg4wv1eHhEAKDe5hrRYh5rPn9K8LqqaVWZDEZIMKJAYHIW2x8+U1PJNTcG2ifQ7PVXpC3WT49vXxNOHnZQMGBGF8J4uq1b5ZKJQ7xWdaK9xXem9nLNUUPCAgAclCWgRSb++Zv3Zk6UpUavq9qwsBu5ePwIFWWpkXPabcQonc2UqjIZnHYb4WCPZc8Bk0wPb/Q+wpnFCJgEwsa9qgbHDpTB3YazNGvgW31P8P6LCeAJD7qmMwHmCQ+vgp/BJBDs9NXRrFcYAIBwnEqK2DVHB13IqRL+ejd8jHyD+eUVwrKjlaUl4K93Zw/ssEl06OalfHxX9P+xREPXIE6GlqhstSALGCWRpC5nOfY2XcjNEn3j0yAWCdrs0leBBfDGu+z7rLlbYkM3hq/EJkuw+jkiBUvsCUuwBNoVS2jpNBNLEI5Tt7LEv1OJTl8dja4mcDK0xNQSLmc5/Gl1t+xwpi4VLLHTSoRjcWx6MATzyytMV7mytAS7rp4Dh03KbmvuGB6D4bezebFEx/AYdPrqsu/wz1MAoyPSdk4227KEbLUwAVYSyV2zBC1YomCJXyzBEnjHltDSaYHlIGVHllhXtbyMqnK2RKYZV75SGLf+deBQNKYFI4rhQYMRBULRmMallHhP/9QcGh24f2oOU0q8hzOL2No2OKKOLoQNCz26EMa2wRHVLGIrr78bX9Wqa58GXs9c0YnIlxdbYb9kNkwN7r2cxuvdA2oquebWA3c+4O+ubp12GzECcCga0zZf3f4AeaJh6y21ypkAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_93: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_94: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAADU0lEQVR42u2ZT2gTURDGv9mXFpJsbXDRUhT8h7GiJ2tLRQURRFSwXhb1Imr04KGIgkEPIliCEkEvgqJG0EixjWiD1SpFCUglxFIrqMQUwYASQl1Imq2FtC/PUwRBmjTZtFvpB3vctz+Gme/NzBJUlVEgwK2qe+kvnjsvK7UupcYuqhkxzKKyXHAtM0a6lvbZmNQ+HvB+F6rKiACI/e6N8oKa8Om929nBRqdw1ikwg2JJDd2DUfIEQ1wfzbRQp3eAbKp7qeSo+RZ0H2XbVtYLmFCReIJ2XLrLc6nMcjbRsOnK2QO7mw43rzUlLAAscdSAMSa9GIzKkqzUug42Ok0Lm9e+DQ1CVmpdUr1DlsySs1PJWaeg3iFLEuaY5oHngWcC+H7/EM0Z4FhSw5Gbj3Dm4UuaE8AXHr8mALgVGuCReIJMDRyIfKSutx8g261cHxtnp/w95o7w+cevhGy3cgCQ7VYe/hKHt7efTAl84t5TGo7GSR8bZ/kHAM519CKW1AwDthh10IrFC3HR1Yoqy99HjqR1xH+myFmnCFMBu3dtnpEGqmzgWFLDhyLdQG1eL2YduOnCzVw+Xws24nu20pUDO8WsAZ95+JL0sXGWd4ZCuvrsDWttbKAtq5eJGXeJSDxB1/vCKBY2r2O+7rIiXDLwKX8PstmJab0j2618+McIlePNJQHf7x+i8Jf4tKObh/YEQ7xUb7aU4gpt/mccACu22P6lvdceiOjlkzNTdHeOthqxZCEAouLAzjoFRt1aFU8JoxsZAFih1E7rQrFMB/ZcR29FouY4e4R2rFslDANOpDPkCYa4bLcaDpudmGRt/p6iC7AoWzvd8QLlOMJUqq6y8OEfI1TsSFUQuO/T1z9TRKUKSbZb+fW+MIoZqQqmRJu/RwCgSkUYAKqrq5DNTuDQja6CqWEpNKMBEC1rlhX1YU3/VbbdBSIfaSrXsBTqX9Xm9SjF4MuQmN/8zAP/18CJlJ4zcm9QKcWSGhIpPSfpWtrXPRglswN3D0ZJ19I+ycakdk8wVJHFnVGKxBPkCYa4jUntbPJz/2h2ddPzznefXYwxadECOxTZZpo08L15T8fvPOH6aKZlsssbpX/9uq13yKYoxkRKz+la2ocq6TZ1egeEqrLfcyVpYSRu8rUAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_95: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAEhklEQVR42u2Zf0gbZxjHn+cS79y11yTLbCjNhltCutpBf1g2LJW1zmq3bpOIaSuUalcqrFsRxnRUSAcKDs1WKJSBdq2mrIi/YtOxLS5aAprZP7SmDG0NiciwoVGy02ZNe/HHu79SxqY2sSZewe9fB/dy9+HLPd/3eZ9DMBgk2No695KhXB2amzcqUhRFHJucREsohFVUeG6eBENPZvhJ3sxKqKrHrbXjxGCQIAIAOVK+WyGX9Z75cB9TmK4jOpUSxCC3PwAdLjearA6Bn5rei821/cgaytXMyzJP25fFzL43NhEQoZyjPsz71iwIf01rJTNvZpjKj7z/TvHbW0UJCwDwmoIDIpVKbQN311OKFEVRYbpOtLAR6XfoiCJFUUQpOZYWyze7lHQqJSg5lqbgBdMa8AsJbB/yoH3IE5eNRxqPh35+9WcCADBSUyp+h2s6+9A77kfvuB9rOvtQ1MBufwBMVoegUauIRq0iJqtDcPsD4gU2WrqR900wF48fwovHDyHvm2CMlm4UJbBlYBjbe12Qk7kLDmzTkgPbtCQncxe097rAMjCMogM+22InAAAXjn3wdJuPXEfuiQb4XMdN9IyMYUVBNvx7m9eplFBRkA2ekTE813ETRQHs9geguq0LtFtSSaU+639OVuqziHZLKqlu64KVKMDnzuHSH39BAIAdqZvQMjC84Jp3t74O3nE/nDb/hF3lxWTVgBt6BtF++y7IZZzQ/YcX2ntdzELr5DJOkMs4cNxxMw09g3gicydZFeCyJpsgl3Hw+9clNADAOjppwXWPwjM0AECu6ep8WZNt5kTmTjrhwCWNN5D3TTCtxlOgUykjji3p3HeFuZSh6hJT0ngD6os/JgkrOueoD6/Yb8H+PdshPz0t6hfnp6eRgtwMuGK/Bc5RHyYM+JO6VgIA8H3RRzG7VJX/HlmXzDx9RtyBazr7FszcWI46FYdzwDMytqzmKCbgSHOzWOZGq69yM8j+PduhuuW3mLM5pqIzWrpxajrIcGzyfHZtIzUzO7fshHkw/Td59ERAo6Ubmz89TFbc4Uhzo1GriGaj4rlgAQBeVcpQo1aRWJujqB0+22InchkXHqkppZ8VX7HoldPfCGXXfmXy09NWzuFIc1N/Mo9Z6RNE/ck8Zmx0HKJtjqhoCq26rQsKcjNiytxYszna5uiZwKcuX0cAgPNHD8bt6H7+6EGQyzgh8q5lA1sGhtE55IWWL47BZsWGuM3fNis2kKbPDIxzyAsNPYO4rKK7zz/EkstWQS7jYOj+BOP680FcB9xJEgrkMk4oa7JBzlsaZjGDFgWuc/QDAICSY+kLtj4hEVMdJcfSgWAoXOfoh0p9VmwOV+qzSKU+K9IG0pA4LRmba7O1NeD/AgeCofBKj5PiIbc/AIFgKEzxk7y5w+VGsQN3uNzIT/JmipVQVSarQ1jukSURco760GR1CKyEqpLMDjsfPtbutl2/fa+ISKXSjRwLyvWsaD6DH5x38EyDVeCnpvfOttTew4V+3So5lhYDcCAYCvOTvBmSqEvYXNtPDAbJP4g45uUJmswQAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_96: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAADiklEQVR42u2ZUUhTURjHv+/czbnrWTMlRuFDRKWBIGVJQg9RUBJREEzbg5H5GkmGYkhP9lAGQSAEivigEdvFB5OVOUcYBWuZEM1YQ2NEjia63LytUs9uLy5mTjfn1V3JP9yHezn38uO73/mf/7kXwWjkUBCYtrw+LzwfuUVz9dU5lEc1RxDSqDkWkQJiWBKngu28ijT9tDR/lYxGDhEApIr6w3SbzlF77gRnKs6X9htyQAny+APQ7xrFRsHGxNDMUTQ3DyFfXp9H9DpvT/0V7vienRIoUA6vD0/f6WCR4Mxubi6/9F7DxTNHLpccUCQsAEBetg502kzS6xyhhObqq03F+YqFjepU4V6J5uqriUFPiVJ6diXtN+SAQU8JgU2mLeAt4I0A9vgD4JsO4aYBPnu/E24KA5ujwi12J46NT6DZ8QEcXh8qGtg3HcJGwcYo5dnc71m40WVVdoVvCgMgimEOAIBSnjncXmixO1GRwP2uUewafAeU8ix6jVKe1XT0yNoasgFf7bTGzSNlhwpgaOyrbBVWyfGQ208GcWx8YlF1RTHMPag6D1dPlsgarNYM7PEH4N7TV4xSftH1BXgutocvFBfAruxtUlqBrz+yoiiGudjqRlXT0bPo/Nn7T2CtrUxfD5udLuwbdkM82GiVY4++YTeYnS5MG3CDxRZRazKSHq/WZECDxRZJC3Cd+Tl++TZJNGoVS/YejVrFvnybJHXm57ihwA6vD+/3vly2FVYSpTxrfTHEUvXmlCZdvCU3usIlq0sPBclzt2b9gVvsTnS4vUs8t+xQAVw6dvDvuPDvWQAA4OP0+HY+E76HfyEASOsKHBNulrxma23lhmwGVgUcDTfxqttidy4Zn5Wx+PE/ZueXjNmh46GipFCSHTheuIlW1z7ymesbdqdetmsmTBY6aeCFcIPL2ZVGnfqieavbTipKCuWztYVwg6nYWDIaG5/AZL05IXBMuGHrNZGi3uzxB9beElVt3bhaj13D5jWhNycENpUWgam0SFawf90jxkUSenNCYLkD+NaXny3g/x7YHxQjyfhfuuXxB8AfFCNEnAq297tGUenA/a5RFKeC7YRXkaZGwcbW48OdXHJ4fdgo2BivIk3c/Mjr0Oy+I08tbz9W67SZJDtLC7lUq5g2ePzmA1a1djMxNHN03tLsxni/bg16qojJ6A+KEXEq2A5q0obm5iHJaOT+AIbljRmXWTaRAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_99: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
  };

const PROCESS_TYPES = [
    { name: '01 Automatik Prozess', sym: 'ptk_1', ptyp: 'Automatik Prozess (starr verkettet, getaktet)', hwart: 'TIA/BF · Aktiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Werkzeugstandzahl, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Zusammenbau Report pro Anbau-Teil ID, XML-Datencontainer, Aktionierung (Sperrliste), Remote Abschaltung', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '02 Automatik Prozess', sym: 'ptk_2', ptyp: 'Automatik Prozess', hwart: 'TIA/BF · Aktiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Werkzeugstandzahl, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Zusammenbau Report pro Anbau-Teil ID, XML-Datencontainer, Aktionierung (Sperrliste), Remote Abschaltung', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '03 Semi-Automatikprozess', sym: 'ptk_3', ptyp: 'Semi-Automatikprozess', hwart: 'TIA/BF · Aktiv', muss: 'Automatik, Teilautomatikbetrieb, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Werkzeugstandzahl, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Zusammenbau Report pro Anbau-Teil ID, XML-Datencontainer, Aktionierung (Sperrliste), Remote Abschaltung', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '04 Manueller Prozess', sym: 'ptk_4', ptyp: 'Manueller Prozess', hwart: 'TIA/BF · Aktiv', muss: 'Teilautomatikbetrieb, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Zusammenbau Report pro Anbau-Teil ID, XML-Datencontainer, Aktionierung (Sperrliste), Remote Abschaltung', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '05 Handling Prozess', sym: 'ptk_5', ptyp: 'Handling Prozess (Roboter, Lader…)', hwart: 'TIA/BF · Aktiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: '', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Aktionierung (Sperrliste), Remote Abschaltung', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '06 Transport,  Zuführung, Einschleusung', sym: 'ptk_6', ptyp: 'Transport,  Zuführung, Einschleusung (In), Ausschleusung (Out)', hwart: 'TIA/BF · Aktiv', muss: 'ohne Bearbeitung, Störung, Hand, Ausgeschaltet', opt: 'Automatik, Leertakten, Teilautomatikbetrieb, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: '', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, XML-Datencontainer, Aktionierung (Sperrliste), Remote Abschaltung', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '07 Fahrerloser Transport', sym: 'ptk_7', ptyp: 'Fahrerloser Transport', hwart: 'MSB/PLC · Aktiv', muss: 'Automatik, ohne Bearbeitung, Auslauf belegt, Störung, Hand', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '08 Durchlaufprozess', sym: 'ptk_8', ptyp: 'Durchlaufprozess (ohne Taktung)', hwart: 'TIA/BF · Aktiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: '', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Zusammenbau Report pro Anbau-Teil ID, XML-Datencontainer, Aktionierung (Sperrliste)', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '09 Universeller Prozesstyp', sym: 'ptk_9', ptyp: 'Universeller Prozesstyp', hwart: 'TIA/BF · Aktiv', muss: 'Störung, Hand, Ausgeschaltet', opt: 'Automatik, Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: '', mpsOpt: 'Qualitäts Alarm, Zuführteile Vorwarngrenze, Werkzeugstandzahl, Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID, Teileident Set Report, Zusammenbau Report pro Anbau-Teil ID, XML-Datencontainer, Aktionierung (Sperrliste)', infoMuss: '', infoOpt: 'Rückmeldung an ERP System (SAP), TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten, Belegdruck' },
    { name: '11 Automatik Prozess', sym: 'ptk_11', ptyp: 'Automatik Prozess (starr verkettet, getaktet)', hwart: 'TIA/BF · Passiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '12 Automatik Prozess', sym: 'ptk_12', ptyp: 'Automatik Prozess', hwart: 'TIA/BF · Passiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '13 Semi-Automatikprozess', sym: 'ptk_13', ptyp: 'Semi-Automatikprozess', hwart: 'TIA/BF · Passiv', muss: 'Automatik, Teilautomatikbetrieb, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '14 Manueller Prozess', sym: 'ptk_14', ptyp: 'Manueller Prozess', hwart: 'TIA/BF · Passiv', muss: 'Teilautomatikbetrieb, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: 'Teilefertigmeldung mit Taktzeit', mpsOpt: 'Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '15 Belade Prozess', sym: 'ptk_15', ptyp: 'Belade Prozess (Roboter, Lader…)', hwart: 'TIA/BF · Passiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: '', mpsOpt: 'Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '16 Transport,  Zuführung, Nacharbeit', sym: 'ptk_16', ptyp: 'Transport,  Zuführung, Nacharbeit', hwart: 'TIA/BF · Passiv', muss: 'ohne Bearbeitung, Störung, Hand, Ausgeschaltet', opt: 'Automatik, Leertakten, Teilautomatikbetrieb, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Q-Stop', mpsMuss: '', mpsOpt: 'Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '18 Durchlaufprozess', sym: 'ptk_18', ptyp: 'Durchlaufprozess (ohne Taktung)', hwart: 'TIA/BF · Passiv', muss: 'Automatik, Störung, Hand, Ausgeschaltet', opt: 'Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Beladen  (nicht mehr im Prozess), Q-Stop', mpsMuss: '', mpsOpt: 'Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '19 Universeller Prozesstyp', sym: 'ptk_19', ptyp: 'Universeller Prozesstyp', hwart: 'TIA/BF · Passiv', muss: 'Störung, Hand, Ausgeschaltet', opt: 'Automatik, Leertakten, Teilautomatikbetrieb, ohne Bearbeitung, kein T am Einlauf, Ladungsträgermangel, Auslauf belegt, Ladungsträgerstau, Zuführteilemangel, Beladen  (nicht mehr im Prozess), Q-Stop', mpsMuss: '', mpsOpt: 'Teilefertigmeldung mit Taktzeit, Teileident Report mit/iohne Werkstückträger ID', infoMuss: '', infoOpt: 'TeileID Lesung durch DMC Kamera, Bearbeitungseinheiten' },
    { name: '70 KPI Bereich OP', sym: 'ptk_70', ptyp: 'KPI Bereich OP', hwart: 'TIA/BF · Passiv', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '80 KPI Bereich OP', sym: 'ptk_80', ptyp: 'KPI Bereich OP', hwart: 'TIA · Aktiv', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '81 IR, Lader', sym: 'ptk_81', ptyp: 'IR, Lader (Physisch)', hwart: 'TIA · Aktiv', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '90 KPI Bereich OP', sym: 'ptk_90', ptyp: 'KPI Bereich OP', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '91 IR, Lader', sym: 'ptk_91', ptyp: 'IR, Lader (Physisch)', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '92 Parallelmaschinen', sym: 'ptk_92', ptyp: 'Parallelmaschinen', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '93 #Zählpunkt', sym: 'ptk_93', ptyp: '#Zählpunkt', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '94 ID Puffer / Bestand FIFO', sym: 'ptk_94', ptyp: 'ID Puffer / Bestand FIFO', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '95 virtueller Puffer', sym: 'ptk_95', ptyp: 'virtueller Puffer', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '96 ID Puffer / Bestand NonFIFO', sym: 'ptk_96', ptyp: 'ID Puffer / Bestand NonFIFO', hwart: 'SDE', muss: '', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
    { name: '99 Direkte Roboterschnittstelle', sym: 'ptk_99', ptyp: 'Direkte Roboterschnittstelle', hwart: 'XML', muss: 'ohne Bearbeitung, Störung, Hand, Ausgeschaltet', opt: '', mpsMuss: '', mpsOpt: '', infoMuss: '', infoOpt: '' },
  ];
const STATE_ICONS = {
    'ohne Bearbeitung': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAFVUlEQVR42s1YfWwTZRj/Pe+1u2s7GNvQMhyDjGwzjCBI4kDBYJhMQk1A0yB/aMxMIzG6AImiQ9M1C5DhPwqymAymUchMGmVog+HDDxKJgCk0IAMcKh8L3ZLBBF3b0949/rF1Y7v2ruPD+P537/vc3e+e3++554NgtbxeCcGglrqUfU1uoSXmg1ALcBEAEIm5AMCshwesKApGqy4pP6ot63syPSvdosxHTPA3EAIBHV6v5Bg382kQaonIgzEsZg6B0Rrf0/8V+rZo8PsFAg0MEI8BEFPqBkdtYPntAEkLjPSd8R2BvaPfYQ5o0K3259+aKtmVtUJQHe7i0nXeqkrqBm7Z1J+OQjHC2u8XCAY12dfktuUo2+42GAAQguoUXW4jX70LweAAhWYekn1NbqHHQymh3qvFrId14fCMEP2wh5jATOSrdwk90XKvwaQiU+iJFvLVu8BMA5pKAWIARCxr8sZsxBtLqBRLqGkDQk1qZHY+EhR5ZE3eCCKGv4EGKPP7BQIB3VEbWE6CvsgGzIxiNzyzK7C4shQlBXnQmVFRNBGd3dcQudyNk5eiCEXOo6OrB05FZkv6dH4m3upvh9cr0bBuEi1m3oklVJoyMR/+5Yvw4sI5WdESPH4GL+1s51hCJTNgzBxSY8lVeltjvwAAoSXmW4GZUezGgddfyBoMAHgfqUQ4sJpmFLthRiEReWSXqB6izNEl2q2081PDy1RRNNGw39l9DZev3wAAFOePRyabuf4P2erHqQvFJ9lLHi2RbPZmM+80rayhZbPLDWdbDxzFc81B/uhwmHYdieDjHyLsknOoanrxCLvCXCdccg6FTp4ju82WyUvlmvrXdiHlKDVWVNUtmWc4qw8ewrrd+wAATkXmlEbW7d6HrQeOGuzrlsyDFXVSjlIjCDClyjO7Ii0FHxw6xumE6lRkfvvzb7iz+5rhvoenTYZFpveIVAmRFrHNhjlTjceRy92mXxpLqPT1qU7D/rKHyiFloGxQSUXCDLFsk7gg12HY/6W71zLCTlyKGvZmTXFDtkmm4hZWaaKkIM9IWc/120usRNbpBP+zJYbLzgz1C/NtPXjyhHFjfhazHhZWeWv/6QvGaJlaZAloUl6uYe/UlR6oSc2UNwFQdKziXDqrzDRpOhWZl84qM+yfvBSFlkyaqSgqGAiZhf2Ji1cN+2WTCrF+2YK0JUYsodKr1VVUNqnQcF8oct6cMiAk0cz5vZLNviadgU0IXL1+gya4HBidDh6vmIYJLge+Pfs7YgmV/klqZLfZsPapx2iTtzptmtl1JGLq2eTfidcIXq/kGD9zj1VyDQdWp/3qVA1UkOtASUEeMtk8u+0zXOz9w7QEid/8eYWEjg62z3kiTkQrzcT93bmLqK6cjsJcpyFxVj5wP0rvyzec3Qqmo6sHdrO/NOPN5O7tZwUAqPHkQWYOmYm0o6sHS979BMHjZ7IO/eDxM0NgzAs0PazGkwcH8tlgb5RNCZsK2arSYiwoL8HiytIRNdD5aC+6+m7i6IUr2H/6Vxz7rWsoBZmLWVsR3xHYO1TCgplAxEpt4L1serFUdGX6aqvz0Y1jotW/JoVBDHVnzMSSstmMulsptPoPZVXcM4dYUjYPgMnQKIpV77hkp/T9f9EoqjFtkd7W2G/aSuttjf26cHiy8dSdDB504fDobY39o1tpaYTl4cMMr1fSPn3/T/3BhV8Km8gloqp7MGx4Jdni74PXK6G5Wbcex+S/IaFvi3bXxzGM1nirv330O7IfWA3Ob8hX71I0+UkQbxirtpj1MJg2qvHkwWG9pJ8NWQC6s5EeAyEWyt6xjvT+BUKujLNLbSKMAAAAAElFTkSuQmCC',
    'kein T am Einlauf': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAE2ElEQVR42r1YXWgcVRT+zp3ZnckmQtVE2gVNHloSNKYPoa2x2EqxBEKEoiy1AR+MTbEKpT5UaFqZLGktpC+l0lZssyBCV1nQapdCCIRG0NrIKra1GIwhLTUtGttIu9mZzcwcHzaz2Z1ufmZMPHAf7s6cvWe++51fwkISiUhIJCxnq+w6Ghbm1HoQ2gFeBQBEohEAmO1U7i26DUbMlkNDxsf7xuf6r1JCcz9igtZFiEZtRCJS2SP1L4PQTkSt8CDMnAQjlvkyfR73eixomkC0iwFiDwYxOQpl7dFtfgwpaRjZvZkz0a/cZ8xv0Aysgdf3V0sB9V0haA+WUGybjxuScYBPf5AudYWi6G1NE0gkLLXjSJUcVD9camMAQAjao9pKnDo6y5FI5K5wPoTUjiNVZBsXHKIulzDbKRZKi356/18lEGICM1FHZznZ2d7lNsbxTLKzvdTRWQ5mynHKMYgBELFiKYfd5DVMk/TsdH45+4UOLHy3cBUbRa2KpRwGEUProtyVaZpANGqXtUe3kaAvChUerwjRvpaNWBFSQUSOt+Cb4Rs4e+kKz2dQW1MDbaqtLtKbnNJx9MK3+PvBVJEu2/xKJqadQyQi0Sxvsr1udGoqV9DPh94peeDuT84jNpiCGgywG5mmNdW4uP+NknprD57A8J0JKLLMhSHBmDJ32PHutAAAsrIbvcaZTbXVcz7bvuEZj3yiVqVcvJTjkKaJXBrwJjuea0BduAqFvDBMk+rCVdi9Zb0PtxNvKruOhkVgNPuk3yj81pZ1cHEB2zc869PrqNXO3A0IKag2+3XdrfWrUReumo1hwQC/uu5p36FACqrNgoCS6BimuaBrr37iMTy/5ik4Lt3W1EC1Kyv9xyagVTglxGJl5M+7Rfu9zU1QgwFWgwHeuXk2ng7fmcDwnQmvRFolvH5F/7URnBoYyu9rV1airamB2poaqLEmnP/9WN8lPNCz3nOdnzTx+eVfivY7Nzdic11NEYrf/XYTFWrQczqZE6HCwFUoK0Iqfroxzqmx2UKwsSaM1wq8q//aiI/rmkFotuxcvOjZaTozmJoXwbk+aKEKQPj1iL6rpVH47PJVfP/7Tf/1EkC3vSqpwQD/cfcfDFwffejZ4K9jYDsHjndS023BQNJXzBCEjwZ+KPotNTaOs5eusJNwvZKagaRsZfU+oZR5CoyGaZIiyzw2MYm1B08QlkisrN4nT+sjt+RgfdKdz2ZIueBhhTxyE9nLlTFzclofuSWQSFhgxPx+lSLL7Kz/VmQjhkTCEgBgZMx+Zk5iiWWxHGK2U0bG7AcAGZGIZMe702iPxkDFifa+nsWpgaF8CeuUr4tFY+D6KH4cG8/rTk7puK9nH9YnPmTHu9P5EhbMBCJW26PH3L2YYZrkuDEJ8hTwCnULQ4a7cdRj2l7HBpHvzpiJ5VCP++oUWWYnm3vlSaGus9xEZjnUkzNmjkZR7Hi/XAlJF/+PRtGYsl60493peVtpO96dZqG0LAfJi5ARSosd7067W2mpOO4PMiIRyfz0+AO77oWvhSwqiGjDMgwb3jZPd00iEpFw8qS98Djm0fck3Ouxlnwcw4hlYto59xmLH1jNzG+oo7NctZStID7glVvMdgpMh42M2T/Ll9KzISwmNfgd6TGQZCmU9DrS+xcVq3PEVvlQMgAAAABJRU5ErkJggg==',
    'Ladungsträgermangel': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEr0lEQVR42s1YW2gUVxj+/jOTnb1EjVYJm9YGfdAoQrHVCm0DIm0taQK2sBRphRJYqaXYVmglkTJZgkpSUsSC1Gq2hT4ssqVGs5FGH1pJL1BMQ2ghJgSkURNCTbzg7C078/dhnWR3drLZmKTJ/7LMOf+c8+13vjn/hTCT+XwSwmHdfFT2f14mUtHnQagF2AsAROI5AGA2utNeNAJG0JDdfyS+/mR4urXsjKafYoLaQAgEDPh8kmvZlhoQaomoGrMwZo6AEYyd19pxt1mHqgoEGhggngUgJvMFV21gz+MAsQVGRmvsbOCCdY/8gB7RWrSvrlwqcn4sBB3EPJph8MmElDjCZ45pdkcosrxVVSAc1p3+42tkh/PL+QYDAELQQaehhMhf70E4nD7CfAw5/cfXkJG4ZAp1oYzZ6GahVMXP1P1rwxATmIn89R4ykq0LDcb8MslItpK/3gNmSmvKBMQAiFjRlaNzFe/sQFG1oitHQcRQGyh9ZKoqEAgYrtrAHhL0AxbB2OA3Y0G1DT6fRFO6SbZa2UmmUuSQZTZ/M+ei0fik/txup+2dkumTz4+ZI4loaq8RatRkACA9+SKJbDBPP7GCLMKnobH7HI3GqWJtKbZt24zS5R6MPtBw7cZtun5zdHJDE0jF2lK8/swGjGsxDI3dx++DNxGNxskKjIiqFY94OQZcIKiqcN0SbZnsRKNxOn/oHdRs3YiRew/hLSlGe08/3v7qez6wazs1vfVq1j8cufcQJzp/Q0ukCwBQuXk9Dr32Amq2bszya+/pR134CgZHx2BlnJkjhuR+j4r21ZUXKa4bVqr/avoQm8pWZ216++4DbFtXNq0WDp+7DACwAs60vuE72BE4bXt0E4nYOllyOHfbTWqJZNazt6QY3pLivOLMB8S0TWWrcWDXdmqJdOVoSnI4d8sEFPyZ9w3fwbddf2Jci2H7+qewf6f9ddXe04+LPdexyuPCu5XPZjENAC9tKEcLuuwCa7WcTiGoIDA7AqfZFOw3P12Dd0Vxjk4On7s8qSUA6OgdwN/HPrCwvWy6C8ArCmXHPEK328km1b8M/JPjN/pAy/IbGrvPfcN3snw8igOyQ7aPdXMJE+NaLGesSBIz6jFfOBFYYiam0s7FN2aje+kxBNDI0oFDI4KByJI5MiAi9GS883EXmNCNgsYK/er0ZLxTTMQHbzFzDksexZH3GQBKl3sKGrO+++TK5bYpyER88JaMcFhH7ZYgaCqEyA4ZX/z4K1Z5XDkXXqZPR+9AzsIdvQM5l15TR1cW0HEtlhPtwQgiHNbTeezezzyKWw5ZUxDrZtZgaOdTqF+mD7PRnYjqO41Qo0ZmbbSoKSz0N2JnAxcmU1gwE4jYWRs4sRC12EyFYzyofmRiEJNJKjOx7G62E/jC3cwcYdndnAYzTaGY1pP08/9RKJq6yVtKG6FGjYVStZBMMXOEhVJlhBo1ayktZXlevcrw+aTUdycfGhWVF4UsioloxwI0G95PnWm4B59PwqlTxsztmJWfSrjbrM97O4YRjAXVNusehTesHvVvyF/vcerKKyA+MlttMRvdYDqaiKWuTOnFvjc0A6C5tfQYiLDkjsy2pfcfet9BDNlQPgIAAAAASUVORK5CYII=',
    'Auslauf belegt': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEwElEQVR42r1YbWhbZRR+zntvcvOxUiUb3YbtfqhTsPWHg80PBGEbg5KNMQi4ocIyMnBKp8KEdczbGOugAxnTTbQmIAMjBra5RaG0fnTCYIO2P0aFaizWzsbg4iY0TW6ae48/snRr83WTph64P+6b977vk3Oe80moJh6PhEhEL7wqB0+uF7m5zSB4AV4HAERiEwAwGyP5XRQHI2TIjuvap0dmyp1VSqj8T0xQewh+vwGPR7I3te8EwUtEbtQgzBwFI5S+kLqM2306VFXA38MAcQ2AmAof2L3+3fUAKQmMjGD6M//XS++oDOiuWi0vH90gWWxvCkFdaKAYBp/WJO0Y97+fKmVCsWi3qgpEIrrNd2KNbLV92GgwACAEddkMJUy+bicikbwJK2nI5juxhgzt2wJRV0qYjREWSmem/+jfJTTEBGYiX7eTjGxwpcEUPJOMbJB83U4wU55TBUAMgIgVXektR960Nk+1POZAkVvRlV4QMdQeyptMVQX8fsPu9e8mQedLfdjmaqZDWzeb+ue//pXE6FQcY1NxTmvzZFcsXNV8Bu9Jh9SL8HgkusebbLCUdtLaPD27sQ1Xjh2oySQ3phN45/x3uDw6gWqgmDmqzeX2GuFASgAA6dnnlhtnlkpHawsuHN6HnU89hmomJCK34hTb8hxSVZFPA7VLLJFELJHEjelE2T1d25826XbigHLw5HrZMpltJcVes3Z++HkSu059wQDgWuWgNlczzrziRkdry6J9q5ucMMMjInIb6X8sQrLadtRrloIpkrNzfPWXP/Di2a+K9titsunzJKtthyCgYdzZuNZVtHZ98k+YDgOAW86XEFTz5aubnHjI1QynYqECmHf3bC3ytN5Lw6ZMdpdI6+TleNHvH7xVkWOvn/sGEzO3YFcs5nPdSqWJ1U1ObH/iYdgVC2dzOZORW2wSK5WrOlpbcOqlTlw97iOrLJsGJTMbI/VoKZZI4siXAwvvG1wP4NG1Lry2bUsRsE/276L9/edNVQB1c2g6+S8uj04UrQ+N/4YLh/ctWtv3zJPovTSMWCJJVlmuSHAZoHi9oEp5z9D4ZMk6y7XKgYmZW0BFFVBcMBBdbmC8/73N1Uz1nsdAVNazmQGh2Ovyovs11OZqpo1rXSVz143pBMam4lzN/fVsZkCez8Ruytb2aK3ZvqO1BWOBVxe0kc7mivJYQYLDI6hWGzFzdD4TuykjEtHhbQ+Bak8hj7S4qu45M3QNH39/vXq0ZoQQiegyAGjp3KDikKONrIliiSQ+GryG4JVRtspyVXfX0vpg3ss8HskIB1Lw+ktqya5YODk7R5//NFbx0Fktu1DCTiXvYGh8slDCmgjR/J4RDqQWSlgwE4jY5vWfKteLmc3YlUJCucYxE1LfKGAQC90ZM7Hs6GPmaLkLannMttcsO/ryYMo0imLvcafikH78PxpFbU5/wQgHUhVbaSMcSLFQOstpqjFgOMpC6TTCgdTSVlpatHN4mOHxSLlzp2eNx5+/JGSxioi2rMCw4VCuv+cOPB4JZ88a1ccxD74t4Xaf3vBxDCOUDqkXl95hfmB1d35Dvm6nTVe2g/hYrdxiNkbA1Kulc4P3+FJ6NlQF0PJGegxEWXJEax3p/QeCz1n4RWNRJwAAAABJRU5ErkJggg==',
    'Ladungsträgerstau': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEhElEQVR42sVYT0gcZxT/vW9GZ1ZNSVCrOSQWtNGiJcG0CLEFDxbJYpu0MLEeclmx0BZCS0ASra5bay1CoNjWQ2z20sNWljRJuxjEHOLBQFqELmlSNKYglRgjYmldd0d35vWwrmZ1V3edtX0wh/nmzTe/+b1/33uEnUTTJHi9RvQ2p6mr1GDzJRAcAB8EACJxHACYzfGIFs2C4ZZI/L50pX0i0V7xhBI/YoKzk+BymdA0ybav4k0QHERUjxSEmX1guIPXAj9hsdeA0yng6mSAOAVATNEXbA7X6d0AiQuMzCvBb103Nn9je0BrtGacvVgkZagfC0HnkEYxTe7TJb2NBz4PxDOhiNF2OgW8XkNt7smXM9Wv0g0GAISgc6qpeKi5NRteb8SE2zGkNvfkk6kPRR11r4TZHGeh2EMDF+fjAGICA/ReW5ZqKp5E/rIc1GN+IMumsFW/Cgm9kS93L0eQEEfoYgBErBhKdyIwxc8foLdfLceJ0qL1y6oQUb1iKN0gYjg7I5AiYegybQ7XaRL0QyJmvni3DudPVsesV3b048HjeSiybI0pk98Jup3XoWmSgMtlqs09+ZFE9z8JwSEa27Ph9RoCAMhYqbaaZyybLlvURsLe6RRW2LFqrg27iSa8/40qMv5YOWSFneWgTpujL15EJsNSxtJMgSxlqnVWfizLpnCL/TVqqKogACgpyMWQfxKeu/fg/fk3SoVBKVOtkwnYNTu15cUY/PAVerEgN2bdfvQI7EeP4NihQnx643YKvo16ET1C7EZ6G+qwGcyzcv5kNd6qLKPkzccHhVVfHPJP4tLNMQz5J+M+d56qSSmjy1Zq1tnLV/H9mH/9/kRpEUZbm2J0SgpyUVdRQtd+ub8jMCJx3BJD92fmkGVTOHrdmZjGpZtj1k4DG8fO3YkeDsf4x69/Ptmi80L+/qRPAAJpFn0lvGWt4Lmc5BkCaDadgJRM2UoRmRUM+CwB2JT4ygrztujcfTSTnMkAn2yshIaFYts1oOWgTlKGBGPVwMtFhThTVbFFZ+rpQlJ7GSuhYXk1NDUjZ1b4dlPPasuLAQD7VAWH8/aj41TNlkQ55J/EveknO4Y8M/tWQ1MzMrxeA44KNyj1EtLbsHMZ/OTqrSSTNNzr5yE9GB5hZl+6I+7M14NJsmOO68HwSCTKNE0yPV0BMNzbvTT39xIA4OHcAqbmFvBwbgEtg8NxS8aQfxKVHf1IJjtHgos/Mz1dAWiaRGsQCUSsOlxfptKLRR1akWU+driQ/gnpePR0kfVwmIxVIykwpsl9IbfzoygGsd4MMVNIybuQiumybApHw/7OxDQePJ5fTwXJgGFmX0jJuxABk6BRFI3t2UqWdPu/aBT1ZaPG9HQFtm2lTU9XgIVi3wsnf5YZFord9HQFNrfSUozm6ChD06Twd31LZtnrPwpZ5BBR1R4MGz4ID3T+BU2T0N9v7jyOOdAiYbHXSPs4huEOup3XN38j+YHV2vyGmluzVUN5A8RtqfoWszkOpm49GB7Z8Jf4s6EdAFkb6THgkyFGUx3p/QtbGw3SaT6XxQAAAABJRU5ErkJggg==',
    'Zuführteilemangel': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEfElEQVR42sWYXWgcVRTH/+fO7M5u0xYLDRqliFFMK4WiYqUWQYwxEFKMlUEL9sEtW2iQYKBokxImyxqDpaBEjB8xKxJklVWbmlWIIWoeQqAS20KxDdQKWhq0KalptpOdzNzjw2atTWY2+5HYA/uw3Jm5/znnN+fccwjLma4rSCSc7N+1+6JVDsstIIQArgAAIvEwADDL8cxVNAlGTCFxdra3bcLrWW5G3ktMMNoJkYiErivBdVt3gRAionoUYMycBCNmHksNYPqIA8MQiLQzQFyAIKbsDcFQpKEYIa7CSPaaH0WOL94jt6AFt/r2ttyt+ALNQlATVtCk5K60kj7MPW+k3EIobrraMAQSCScQ7ixX/YF3VloMAAhBTQGpxSncWoZEIhPCXB4KhDvLSaa/zYK6WsYsx1lodXM9LZddPMQEZqJwaxlJq3e1xWS/TJJWL4Vby8BMGaayghgAEWuO1pELXsu2ybTmC/pZtk3eoqhec7QOEDGMdsqEzDAEIhEZDEUaSNBXXkLqtlVh785tuGamC/LEuqCGvtHTGDh5DkG/z/VTZ8m7zZjRD11XVEQiMhDuLIe0Ql4PdSSj+oFKNDy0pajwXJq+hoGT53Jlw5DY0zYk49GUAAByrJ2l5pnSeKJ6rUw8lWHIMESmDNxiY7EPB94NqL4L1ibSgjm9E/T7+L3vT9CnY6dd12fMNO6/YyOOvlCLe8o3LFkf/uVCXl7yzV68XVX8gdp8XuD8n1fgSPZcP/Dkdlcxr33+XU6g/2uKP1CrEpAXO35VdX2gac1Tc+1jaKzevmStb/QU3v/hJw76ffmxBNSL7BGiGDOtedr14Ga8+fzTS9bGzv+Bl/u+4QJBqhDFirFsm6oqMtwstt8uT2P/x8dhWvNUcK0rtkz4VZWjz1W7cnPws0FMTE7lxc3iciKK9U6nXkNuibIQiF09dOPYmT83TTU7XCHuHj6BrqGxosUwy3F1pSDu//ksWhJD7FfVkvKjAGgyXzG5IG77cnglisikykAyn1wU9Pv4w5eeITeIX/zgC0xMTkERRF7JM58wMpBUHWtuUGjBZbV/sn837bhvkys3M2Yaj1TelfP+Mxf/WnYPx5obJOi6Ely/9ZhXtbdsm+68bT1+PdpcUjDuPfgWLl2d8cz4zJw0Z848K5BIOGDEVruYr9F8y8UrhkTCEQCQNu0hZk7espMHy/G0aQ8BgApdV2Q8mkIoEgMthduvqjw1ex19o6eolE1/v/K3d0ogfl3GoynoukILEglEHAhF3vbqxSzbplzHj3y+Uq/GcS5mvJLVoP7bnTHTXGP3oaA1VekGuBeMpbbXc9rGQxkxHo2i2NNWpq1Rfvw/GsX0decJGY+mcrbSMh5NsdDqVhNyZk6y0OpkPJpa3EorN105MsLQdcXu65qVmx//WqhiLRE9ugrDhka7p/0qdF1Bd7dcfhyz4VUF00ecFR/HMGJmzOhfvEf+A6uF+Q2FW8sCjlYD4sOFssUsx8HUkTbtoRu8uM+GlhFU2kiPgaQKMVLoSO8filc9mn1L7IoAAAAASUVORK5CYII=',
    'Q-Stop': 'data:image/png;base64,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',
    'Qualitäts Alarm': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEtElEQVR42rWYT0wcVRzHv7/f2wVS2gqYhqVETIWFprJUIGA1PVAxaWjVBNrZeFBbJEui2W28eGpSgtFTbyzxIClI4qGZoRxNTDx4aPRgtGmXEITSQw8VjAnEiMLOznselqEDOzM7C/WdNvPnvc/+3vf7fr/fEPYxRjDCoxiVqdNTDQzcYOIPAUAqOSnN3PX0fGJVgyYMGFapc1OpL2jQhYG4lYxNRGHxt+GyUKPzvlTqgSVNbTyTWNKhizji1v8GZC9wrf1WMykxw6BWqVQWpEIAAEU5JiqTUHPSooF05srDUqGo1MikYtNNLNQsg1olpGQw74rQ9jUnlP1ukHU4GIwmjO3IMKsZL5j8hMz5e9TKQs0mYxNRA3FLgyaeSYRscRaLzN6x30hx8W0yrGRsIuoHk900VXbTVJ6RYjVzrf1Wcz5SutgXkFMzQog7fjCv9jfzhWQHe0IRtZEUeio23WQgbuk+UOzlph3NCDXLEJ4wjZ0Rfu/zs+j76BU0dkZ8oZjVTCo23RT3gWK3yMS3I7NjbQ8YADj77smda/ZvXyihZm0ot+0ThQIezUcGZDBRzAumpv4IJ9JvUqznhZ3rx6PViHbX0dLPK/T32r9KhAQ9dQ/R9ly1YHWu69jF77/+44M/NWhiHvOqwGVB3ZTdNFWksYo//uo8qiOVrjpYW9nAl8PfYWV5XZZVhKkU97ETppibpFLZsoowXb3Z4wkDANWRSly92YOyijCV6j4egWIbxs9NAJDbyoXb+05QfUtN0QOuvqUG7X0nyF247u7ToAseBcm8tcN3vNzkHCdfPx449/k9u9d9dqQ4dXqqgYU1y6BW+0HXk3d7u+oaqwIDNXbUum6bZ6ROTdQyAzcYorXY5LmtXBgADj1XHhjIT2eukQqHvmAQddvqL/by4ecrKMgizlFTX0lBoPJ/2hrk3Gbu5aCTR7vrSq4uO/peAjE9CvJsqDxkcqhcTBV70D4Iz71/qmSgM/1RVNcdbvLS0e7dUd+wNHPXzWxu2d5LL5jhdC+C2N1NR8PpXtTUH2E3KNvVZja3LIHPOD2fWOVyXJRKPfCCOtMf3ReM80x6+5NO35qJwtybvj/4mDXoYuze0KKUdNkL6tGvqzjoWPjxiSeMIuty+v7gYw16PvlpjnKDpNCZqM15QNr5q6q2EuZWYcEXLs/naK9766sbu/LaUxhrzrKsS+OZxJLNQEGLeD9RBhmFMPnIjN0bWnQmV3Krn/N5Leyb17KbprqQ7OC2Nxrwz19ZAMCho2X4fXkd05/+UJDlCzK9Um/Z2+Sss3ctZMCwNOhiPJNYkhYNSKg5L6EDwLEXj6K+pQbRrgiiXRFf4XtpZm/RX/DP7Zo3nbnyUFo04Oe+u7cXsLaysasOunt7wRfGssxLY/eGFnWPDoSKdamp2HQTs5rZK3RnTd3yWj6r//bTEyz/srJru9w049fNUpBu1ct9bmJ3h3G4SdOFYXj3ZgEaxWAtdDHN7HXTgXr7UtwX1E0H6u1LcV9QNx0IyNV9LlDZTVMFddMz+2BlOyQZm4gKDhtM1Lb3g5ViK17MTQeOkD3i259WxjOJJWma56WSk/bHBqnkpIR6xxZwqTAA8B9I1YLCuCTR0wAAAABJRU5ErkJggg==',
    'Zuführteile Vorwarngrenze': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAjCAYAAAD8BaggAAAD90lEQVR42s2YQWgcVRjH/++9ybLrRWih5CA9tLQNHrYkMWoPspdGCJQexLdgtYXdCoIUr4KkO0wSvXmxPVSwGYwY2x0RtGCL8eD2UjFtl6xiU4ulVNFYaEEonelk3nseMpPMbGZ3ZnZb6oM97O7w5jf/9/+++b6PoJel6wyGIZ5+c2aHq8S7hJCjAKCUOk00qT/42FgB5wyWJbJuTTLD8DqDVRZPvaUPKsG+J8BQ+G8FLEN6h+zZqVZwbZbtaSaY+toNCtVaMQ7Gf8IhUG2+UK0VYZUF6nX2eBTyn7ZQMYbByGdxMI9CqXRAvh8K1VoRVJtPgomHSuepZKBSSUOj4aVVpiuUv1fvQCVdQ8Pw8keO7yW5gc8JMGQ7bibfFfI5GYVa2zM7kB/a4WPauW0L3TW4NVNk3li5q36/c08CgJLeiD071Qr2Tg8UwISOyXZc+uHrE+TY+AuZAvPVE2dx7so1Vcjn1qCEGrNNvdkJisZGkw9DGFkMe+a+8zATzFeXf43AAABhZDF/5PheGIYA56w7EOfreYYwsth+8eVbf2cCmr/0c3zyyw1cKVSMYViWQKmkxR9ZKJriYIK1c9uWWFPvGtxKzrzNI+q8drIeUWdTBAaeCuUpbT0Dl8teoVorEtoZBgCu/XUn8j2nadJ2XFp5aTiVOhE1qHY1XzEmHLO84DMIEtDlK8Y4ZeR81leb63n0+R3PkB/eq0bUeePUlyqnaTLNHlKoCcfUF8A5o/3AAIDwJI6WRjepIzyZeg/KyPl8xRiHZQmS5Jluy3Zcum/39r7UiXhKqDEKikn0sd55+cXI94+++zGTOm0xP0lByJ5+1HnluWcj6lz67XbXyOrucrKHQqnrj1KdvpZS1ykkZv4X6gCAxAy1Tb0phZp40upIKQ7apt6k4Jw5pr6AVXGgH3V+uvlnz+pIKQ46s8a3fh6yBOp19uBT40JapdrVef+bi0p4Erbj0vZPapiSrsGyBNlUM1drRUK1q2nzTuuPf/DBuYsdb3ihdUMkZ+iNdxnpVK7GJUvbcekXx8qR40pao7VT6pfbK2g/zvAxhWvtqKSNhgfOmW3qTemujiZ5p+foFmosDia+QLMsAV1nztz0khJqLPiZaXTTO6snGOmN2KbeDDzTU00deKpTLdRtBfV0fzV1W9fRXltn7ToAYAB097+fTN7svetoN3rGJjFiYHd11JmbXkrTlyU/bWD02akWpHdIActZmkQlvRFnbnoJnLMkmPTDBssS4PU1KKEOp4FSwDKEOrxRM6cbzaT3gz/JsE29maTUeqca9F8ZRjI9z4fC7fWTmw8FSnHOnLnpJbIq9iulTm+UM+prwsT+jWlHOfME7T/Xv44dcIow7QAAAABJRU5ErkJggg==',
    'Werkzeugstandzahl': 'data:image/png;base64,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',
    'Teilefertigmeldung mit Taktzeit': 'data:image/png;base64,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',
    'Teileident Report mit/iohne Werkstückträger ID': 'data:image/png;base64,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',
    'Teileident Set Report': 'data:image/png;base64,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',
    'Zusammenbau Report pro Anbau-Teil ID': 'data:image/png;base64,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',
    'XML-Datencontainer': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAjCAYAAAD8BaggAAAE2UlEQVR42tWYUWhTVxjH/985d9Vc+iAqWEHCaMFKW2hcpYExDGOrINuqm72ZjIFr5sMQCsPnmsuN+iqCMPZgb5GNYZvJlG0WLDKuL1smkXbUUicR58Zoh+sEy01b77lnD8mNaXtjcqsZ7LyUnJ6c/M75vu9/vu8jrGfoOodhiMajp5qFFCeJ6H0AkFKOwBXJ/HAqB03jSKdF0K0pMIw2ypGOi1B/sgWcXyHQrvJ/S8gZuOJw3kxNeWuDbM8CwYwWYRLJDj+YwglpFxi/GEokO5COC4yO8voAaaMc8bhQE0YXGL/oB+MLFY8LaLVD1Wayoj+EEsmOajCVzVebT1UHisUUWJajJowuyXChVphyKHJxxDb1rLfX+k0W0xVYlhPqT7asB8Yzn2S4EEokO2BZDmK6sj4gXeewDOdZDhwEipgyUYAyHOg6DwZU1JlaHDgQGFMm1ITRBcMQlaCoks4UYCiDegxXRm1Tz/rpFFWKJmLKxIvmWHYc1qAo7gqoVY7OVkRTOi3UhNFVDxjbXmTv7Wmn84kD7O1IK7cXl26qCaMLluWU6xQrKbBlFRy4XmYCEG3eIfu62ynavEMWfp0yoX6jp1zRFU+BQ/1GDzEa8zsZAKjqRrf8s9JQiF5n2YHSoMBZfiovqrrRXXYcVj4HAH89XqCyvxIAiNNYqN/Yn4/Hx6FpXCk8lEYP8bUwL2/dxD7e24WFpSUayUyx6QeziL/aSdHmHTJz7w/aoHBEwttl+uYUhbdswsFXdsnJ32fp3HgGO5u24rT2JuWXnsixX+7SFzduyYrR50EN6+NKMZrG/Bbef/jI3b6pkfV1R9G4YQOGbmTx5SeHAICGBrPynd2tNLAvSgP7oqW9+7rb8dFruzkAtGzbXJqr9ioQpzE1YUSZJBx/VlQcNa+4ubl5DOyL0uVPPwAAnLh0HdMPZsvB5d7TQ/jw80vwQK5O3pWRwc/k1z/flgAQCW+XVZ8ZwnEGQmelBQ2K4tr2ItO/+cEzIX0/+SvOjWdWaMe3t+7gpzu/ye8m7oj7Dx9JABi6kcX09D26fGuGAkh6J4PEpJ8je877XKNRlYHWS0wykjizer4t3IS2cBNse5G1hZtgvPt6yTRvde7EQE+U10MWSOIMs009K4XcXx5ZE6eO0cSpY6SqG93B3hhatm3GuWsZefDsVwCAk4feQFu4CX/+83jNpkK4VU2kNry09nJc0WubepZB03h+WB+XrugFgMeLy3T/4SOZm5vHoT1tvK+7nXJz8zh77UeafjCLE5euAwAGe2Nr9MUbubl5XxDvAPbykzUwedO4Ck3jVFLquL8ebWlU+d8L9ppMr9K83yhfu/p7JZiYrsAyHPpPX/lVD6wUcn9+WB8vf/WpUrpaT6jVZirPtVeGtmU50DRecHSntW40roz6wfhnjOm0gK7z/HAqB1dGX/zNOJFCHqQrflWIv/gVU0zb1LPSdSIvEiZvpqa8fD14GVT0/PWWQCtPznYunB+85+353HVZ0CJxxc0IpzU/nMo9f11W5uh5MzUFVxyWkDNBikTpOpFSN6QKTO21fTotoI3yvJmaIhdHaoHyKtanXZDaWjO1v+jFvNc29Wy1m/JqetvUs9D1QC2Z/3l/yLspTSvolBAHpJQjJRgpRyDEgafdjnjgDtq/CrK6by7o70wAAAAASUVORK5CYII=',
    'Aktionierung (Sperrliste)': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAE+0lEQVR42sWYX0hbVxzHv+fce5MsYl2lTdpa2xLRFnRuFsroNouO0u1hdFvJTbeHwOoq62Bs7GUwOqKGur52g1pGXYu4UE3cnMWnshb6R8Q9NKvVQJSW/rGdigyk7DYm956zB3Nj/lxjElP2e8tNcvLJ7/x+v+/3HIJCoq2NoqODWY9/t4VDaieEtgIA5+w8Qaxd6T41C1kWEAho+S5N8oaR/QICLs3k7nQIJm2QUFKX/DZnfIIxOJcueqb1z+azPC0ExnzMW20EAwCEkjpKMWBydzoQcGnw+4UXAxSHsbR4qinFgBFMMpRg0gbNbk8NXC4Ncu5QuW1ZvB4sLZ5qQsSsMOnbx7nqjFzwTudaU0KuMOZj3mpKac4wAEAIsQG0SWxovKr6zi1AlgWEQrzwDMVhjApYUSIUAERJZCZJBABEYyrUmEoBwGq1MONCz54pkm83KUqEWq0W1lizgx6srUJ9pR1lL1kAAIvPIxi7N4OR6Ue4OfWI6Z9NQEVVeanXO5Wt+8ha3ZRcwIoSoR+/+Sq+OrQf+xwVWZM7OTOP08M3cGnkDgyh/H4Brkwokq2b9AKOxlSYJBHdLYfp0ddfyWtS9I/dxfELl5m+xlqZIrl20+CXH9GDtVUFDfY/Ju/hwx/7WC7dJ6zVTYoSoT2fHSGHG/ag0HDYylFl20j6Ru4QSRJ5tu4TMrpJ5L+l14zng2asN+q22zE9/w+C95+kQAmvNV/VfGcTUALa2ii6upjZ7akRTOTX5G2SJJH3tB4htg0lKEbs3rIJPaPjLHlOEaBJqGu8pl1azpSA69e5+Zi3moqpQ09RIvTtWgf5+t03UKywbShB6Mk80bOUgKIrmaIl7k77atpUaBFni727tmE1QS75tNMuMrPaQQjNgBElkVVsLE0R31vhh+gZ+SvnH38ejeFE8z68tXtn4ll9pR2iJDIjKMbVDhGc7DcajyZJhGNzecqzlu7fcW92Ia+MDAXD7NlPJxN/bGtZKXSpydQ+2krzEctCorzEkpfnEjln53ULmhzRmIrF55GUZ77PnfjhymheQJ80NqS8/nvxGfSpnWlXmE+kXGxjXNufnik1ptLxx3Mphb3PUYFfTjjXlbHxx3NQYyo1pdURZ3yCkNg39N+fT84xBidnfCL9y7cfPC36FhqtqdsTpfvULIUsC0sXPdMsqsrJUFarhQ0Fw2xyZr5oMJMz8xgKhlm6V+JcTRwKKAIBDbIsLPV6p9IzpSgRenr4RtGAzlwZTRi75MysiKxLW9ayUIhDlgXNd3ZBbGi8CtAmQohNkkQevP+E7KnYjLrt9nXB9I/dxffDN5k+oRM2pKc9RfFX1D4OpfrOZUBdDob5gZqdZMemlwuCuRV+iKNdARaNqRAEumJp02AyTX4oxCH7BdX3xYJQ13iN0GWoaExF358TvMq2keSbqf6xuwkY3aAt10y7ob82trBxe2l2e2qoSQyk25Fv3zuA2u22NQv4zJVR9I1NGLvFnC1suq82gLJaLez9ht10765tqK+0Y2tZaWLojT+ew+0HTzEUDGeY/BWXmK/JN3SRGPh/j0HrPLWmwCRM/dqn17WFLz6nIhe805yrhhM9KwyDM1eY3I7SWbovl3P9at1UnPuheGesdjdkuE2rdFNx7ofiVyvR3pP3VxPkRGb0g6DrRV5YAUDApemCTEj0Hc6YL9nP0KhwKFmb8l3+P+9gQzmbL6gaAAAAAElFTkSuQmCC',
    'Remote Abschaltung': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAFjUlEQVR42sVYa2xTZRh+3nN6LyPNJJtkGaC4MQcTlnAJJuMSARFkYOxpNLjpBj9IZBiSuUTJiusEE2I0WA0xkS6BEXAFHbcJRm4zasToMJMxWhS2BdAxt2Vb29PTc/r5Y91cR69bjSdp0nO+L9958r7P877PewgTuDQV1SbJXtuvqag28V7V+8Rx5QDAgkGHYpArJXttPwSBh9OpJHs2JY1GaODhtCi60j3ZpFbOEEcFY5dZkLWyIMxindU9sjeZ47kJgSmz5UQCAwDEUQFxOK4r3ZMNp0VBQwP/3wAaAVNuzSEOxyOBCQOlVs5oS6y5sFgUCImDSixlIT7oyq05RKqYYB5KH5PNosPmTpRTfMJgymw5xHEJgwEAIsoEuBWqwqIL8pEDPRAEHm1tbOIRGgEThcCJXuFEjx0pLjZnJg9mLNG1JdZcOJ0xOcXFJfAkwYwFxWlUzmFQ0dVHMcEkQeBk0heUZMF/2OaKVKcoFWqaEKeiqI8iq2m4zkgBGbIUmNBLDUb96H+vxxd2HwsURVOT1+PDk9mZ9K55VdJgbj/og/XLS0wKyPj8dQvdftCHyvomFhHUOPXxmopqk1J3wKctseZyGmocSVMgIKN4YT5VrF6Cb67/jn6vGPZz/fk37vYNIKAoYc8JhNeKCtHcfof+uN+Drv5B+uiVdUhPM9LZn29ArVGPq1NYwc8ruqgcHa5TKsle2x9KkzMSZ9rudqOyvimsmM3ITKdVc2cDAD6+cJV5u3sJRj0bSVVBdgYBwNdvl5Pjyi/IqNjHuu1V1HbvATku/hQWqRH16cpsZrHO6uZ0pXuyY/WmKToNDEY9DEY9VBo1qoqXU9t7Fdi2ciEqn3sa3fYqKt+wbHTPzPSpNN2UBgD44Kvv8NmWjZifnUlbD55EzQsrH+LS+IbMkVreHU9NUkCG1+NDUe5Msm5aAbP9GBZXH2D5b+5nWw+exLaVC+H1+OD1+NDRO8Bu3O/BJ6+uR7Ork9kaL+Pglo04de0mGxT9WJY7g7weX5SGLO/mAFoU15CpVQCA9Qtycb71Fs613GQGox5rC+fQ6rmz0dU7gBM7N9PSvFkkBWSs2etgTb+60fjGy3S6pR1pOi2mTdHTkCjhqexHYxRPrpybbK0xGXVx9wyKfhhDZO4Z8sb2QywYdMQ7UArIAICz11x4tuAJrC2cQ16PD+dabjLn1etI02vx4odH2A/td5hGrcKJnZtp3fwcbNp/lG0ozMOQKKGjd4BNN6XhXt9AjIIZdKhYQFUDtbIoVqQ0ahU0ahW+dXUwW+NlOl7xEr6/1UUmvRb5WRnYUd80StaZ6VNp8eNZKP30Cyx5LGuUc8UL5tCg6Eezq5NFIjYLslbFIFeqxEO7unRlNjPAIiptSJQwloT7Tl1hp1vaaUNhHnqGvDj2429s7HoHwAZFPwHAW8XLsKO+Cc2uTtZtryJb4+XoVTsIs2Sv7VdBEHixzurWllgFTqN6qBblZ2WgRlhFRq1m9Fn3gAcAMG2KAdufWUwZU40AAI9fglGrwYxHTACANXsdbGneLOq2V9H51lvYd+oKi9pC6mxuCA08Retj8VpHml47TFif/6G1fo+ImpOX0PlXLzuxc3NSrYPidfpINSNVzfVfGzK+uf4f9iOKpQ13bW1tDEIDLx/Z3sPPK7pIHLc81ABT74Xq3onoryOb/IYGHhaLMuwAVM5URSosTaF3JOapQ8Od/7DNFZRkgQVZa6oiM2pdLZFH7OhTh9OiQBB4/2GbiwVhngyoUc6MusPo8378yXWSRI+mponP9k6nAkHgRYfNzZicVKRGIpMomMRG6QmqL56aUvN9KKSMeNNsImpKzfehkPrEQ7u6ohE9UTWlBtAY9Yl1VrdiCCwf66dYMOhgAf75RNQU7foHDnCDgRWVwmMAAAAASUVORK5CYII=',
    'Rückmeldung an ERP System (SAP)': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEUElEQVR42rWYb0hbVxjGn3NvuvQeZ+xkaCYWRwWh1k02HFjsRt1asVBY2bgZm1DaurEFtlEEpWTIkLb5MGGIK/TD6goF60wobFDaNZYVBkWLfgmLLYSGViIudZs4nefWbsnZh+XGmNx7z01M328h98/vvu9znvc9h6CYUFUZwWCSdvncnCpDBPAAAAcCSD05qY2cTujXFPpoUiyM0t3vhuwMEc6bsv/mhETIGutgo/4E1ICMoCf59IDSMGXdZ6tSMr+ZC2MMVVimpFLDAADhvImX0RDt8rkRDCahqnJpgbLKJIIxhwrIpQFSA5aasQ/lsQVFSlUmqyhEU9LThilUU8QuDGMathKUKrYyRYw149kE07qrhh96uYHUPb+DFANzJzbPr4WjmFtaEfoUEWVm4Mh+9HS2EZQg3j8f5FfDUUsoyQrG294ihPltedU20JhXJXWVLoPVt6EpyUrAx15/xRTm659u8/JPzvKGU8N835kLuLuwaHjdRxd/5H3jN7j++8Qbr4IxzVTokpmA6ypdaKypMnxJKHIfvZevY+DIfkz0HiXLTOOec+McAKZicegAfeM3+He3pnFgT33mw5pqq0nu6lO6+zNQDqPMUKpgbmnFNPXB6Vm+t+FF0tPZBgAIfPoeeenUMAcAl+LEUGiSXAtH+dzSCm5/+TFprd+ZuXf18Xq+JcjOEO3ydbBRf0Iy8xnGNIQi902hKqgzb1nfXVhEY00VfvF1AwAmeo9ugtFXnJlPKd39biklpYbNTK/n8nVezGpqrd+JiP+zPJipWBznb82AUsXQPCE9MyTpw5WRkd2bf4R9Zy5gKha3BfKcwYv0uDIzi4ODl7igj3kcInedjD7kBwcvobm2mlRQJ1zKdn41HMXh5gae7WOMaVDPjeeVEgDm/ljm9+YfGWYmNxwcCJhlSYcCgMnoQ26VGc/eZvwaT/CF5VXy+9+MZ7caeZuDUKoIy8+BgAOpJye57GwUNU9KFTCmQd7mIMl//t308Bd2lGPMq2Z7FpmKxfHhyA88vVrFMIREpCT5XNJGTifIGuvghERENw1+cAhjXhW7a6uxoj0mImHrJmgHBsn1jrWRLxYlqKrMRv0JJNdNoRjTcLi5AT2dbeTdlj2Y6DtG3mrcJfxqO81Yh9F3KpLukKJMxf/8i2SXqBQNNxcGwWDy/16WnnnZqN8QKrPavrqYQoliM0wgMxttdPv0zGsF9XMkRpp833C7vmQfZmP8MB3QaJfPzctoyKilUKrA294Cd8Wzli+efrCAwGR4k/9YwQhHWDOojGgrXZZAuQ3aSDP2dx0WUIxpONH+Gr49/ralsK/MzMIzPMb1eVoEY3sblAvFmIbdtdUYeOdNUr7daTmmfH8nIixTYXt7C02JTC8/M+LDB3teIhB6IT5Tmr19ehAXOfpWYYo+jhFlaitnRFJBQAJHz85MsQdWUsE2m1U+KUkOcCCQPc+QNWZbwEbxHxxBRCM7ldYzAAAAAElFTkSuQmCC',
    'TeileID Lesung durch DMC Kamera': 'data:image/png;base64,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',
    'Bearbeitungseinheiten': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAFBklEQVR42r2Yb0wbZRzHv89z1zvbGkJYhAXFMUjZxtYXyBYzdWERw0un2GvmkiaAcdEo7u1MQ91KSIwvR4hxL2CGkWjbkOkLXQyQvXHJshBNcB2hgy1icGMbElx79M/d4wvao+1d/1zHvKQves/l6afP7/v7/n6/I6jgEvoHqhPDg+tC/0A1J/NfEkJPAwBj6kXFmjqbGB5chyRxCAYVs3sT0zRSgEPQrQieoWZOUCYJJc7sZaayOVWFKz7mi2SeNbM9rQRG7PU7jGAAgFDipBQhwTPUjKBbQSDAPRugNIy1z+egFCEjmGwoTlAmRY+vBW63Aql8qPJCltaDtc/nAOGLwuSHDyzlkkf9kXI1xZULI/b6HYTSsmEAgBBSB9DjlrZj06mJrx9BkjiEw6zykKVhBM9Qc6kwFQsfCB8Se/0OBIMKJImrDEgKaDCFBGwGilKERI+vZQuqsKZIKQGb0Uw5mlITKSk+7l9AIMDBrbcE8n/BZEMpCa47Me5dNPIpqtfMs4OJJ5OaJVj7fA4E3TpNEaNsMiPgWFQmAGCzW5nZkzKyBJKfTfkCjkVlcuqNNlz68F3dppHVNcwt38eFX27gxtIyA4CJj1yku721IEhkdQ1Hzn3D9GVmi4EK/QPVCAYV0eNrKZRNb7+yz3BzR20Nuttbce3zXrza1EBEiwXFYADgz8friCeTBbJP4vjE8OB6OkxBIxib3cqcDbu10HpDU/g1sozXHQ0Ycr2lPdd1qBn/bsa15/7eeIKPx37UAS2vbUC0WHItQeCDYq/fFR/zRXh7z1CdShVDzcSiMnE21sNRW6PdG5m5yWJRmVyfv4vuw61ob6wHAETjCThfqtOem/pjET9dmwWq7LmlQeBZNpAGBRay9wx18SqfOk8ILSjg7B+JrK7h+L49pNpmRefBJg0msrqGkZmbbPSDE9oJtda/gOEz72+ftGDB9K0lXPltvqB5qiR1ngcjR4uV2KOOhhzNXDlzKmd9+vYS3hv+ngGAs2G3dr+9sV4DzlzzKw8Ri8qkUEYSQk/zpdL7cNamkdU1bMQ2UWV7Tgtj54EmfPLmEXJ17k5OaCdnw7q9rs7dKWkHPGPqxUwLqgtX3r88ORLA4sN/GAC807afZKwgW9yZUzt54TvY7FaWySgAEC0W2OzWIt6kXqY0xX/BVDZnJOiGmqpcz7m3glhUJrGoTOb+epCz1r53G3zm1pLmzEoiRTKfkiXFlvqMj17yPhB7/S4Kpsu0gy/W5viHs7FeE7n3REfO2p5d1dp3uyjgtf17UW0TNYj1WBy/L98vXHRVuBLDg+tEKxkeXwsVeM2LYlGZ/Hy2B50HmorGfPbeCgZ/uKYTe/41ORvWwli4hAQ4mnHI+Lh/QVXhyoTPZreyl7P+db79T99egjc0hc6vvi2rhs3eXSl4Mtv1zK0ULa67ntcL8PETOUdnZouqYW+kK65Fmvl4Mol8Z92RRi2vqJZs0Haida1kEtH31OnhLjHuXVQTKcnIEp62hZVH/REEAoZjkXGTnx7u4uP+hZ2CypzMlmaM++nSg2KFXaQZzZibyzKWMOaLgKVclZyUlk1lwJQ326eh5FG/aSjtZPJS++lGaQAIhxmkAJea+PQRd+jYDKG0Y2tMLq2ZzbFzETPvisy9H0oPd6UsoZyBcGfeD6WzLzHuXcwuM5Vk084AZXwqLXTFluxgqno5p59RuK7s2mR2+/8AQyoVuRfbeNcAAAAASUVORK5CYII=',
    'Belegdruck': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAjCAYAAAD8BaggAAAFmUlEQVR42tWYW2gcVRjH/zPnTLOz022WGFM3rZbeLBWaNFlJUcpuhfbB1BIvnUUqiWQNvghtoO2LyC4bS19SoRQfROuGWghlV6siBiU+uKVgDcTQIGIvVCVtQmNMso2zM8ncfNidvWWzOxsV8TzOnDnzO9/5n+/GYBWD9obqtbN9M7U9p7YsmfrbLMsGAMAwjJjq0o9pZ/tmIIoE8bhe7dpM1TRijCAe0GlvqJ77k3zLMuyO/NeGadyAoR+Ro33j1txqlmergomlf8AHQ02lYACAZdgdYMkgHww1IR7QEYuRf8dCogUTaQGLi6Vg/glL2QPK6IEPhprAksFKMKWh7GmqMpDfT5FIaHYtUxoKnXI0PGattXoN+cMUiYRGe0P1q4HJaQoX+WCoCYmEBn+YrspC1tXOPyZJkkm1QILAZ4/J0FWvHO0bt9a2DZSDyR3ToqqSti0bmWebt2Odw2EL5urN3zA0fqvgiAzdaJOj4bGVoJhyt4kl7Ij1WJJk8knvK8yBXVtx7fYEnGu4FUFSSyo8bhc21bvhOdq/TDOLgupZyXnS5bcp7WfyYQpc0fc/oqf/AoTGBq3cEXb5WplT4v6S72okbooLRtpKCZ0tuE3xeMYy3Gj+ApIkEyQXmGXPbIxFVSWSJJPi+SxhR7JCF3POk2Y9cCCgFVtmUVXJ5ofrmN1N28FzFI97HkIypaDrkB+yqq14IXiOwrt5A9xOB17wPsEAwL25Bxi5c5fUcJyeg+JGHd2RdmUgMJxh0BlLM47uyAFC2aFimMtHX8amejfmUwoAIJlSUOt0VHvZ4HY68Nr5zxD/btzMv3kAoGtGuzIQHoYoEgYAimGsIxGfamI+7Hke3tB7mJxf0OoEB52VFK3Sz0vN+/pEJ/15agY9719eBpQPxfLBSEsxTP6YTymYnF/QJEkmdmAAYGJ6zmx+dD09fXg/tTZ3PylBWlRX/IZQdogPRlpYMDhR6QeNbhcttatyY1tDHbp9LWh0uygAuPg1EGq4SoHsBAWD5kqLK6qa1ZW2ZMtI+OjKD+bgtXFkRGzPwzNopjBxHQzKxigHx0GS5kiXr5Xxbt5g20oZT23frCauU5g4AyBgZ35H605YntrjdmFqfqHkPI/bBQDo9rXAc7S/GqAzVI6GxxzdkfZywp6cX9Assw9cGcOxc4MQGhs0Sx/Fc6XJafr0nl249EZunwvyUllRG7rWIUcjYxSiSJSB8DAfDHewhH5e7ODcTgca3S46CWgufg3diHVArcs8fXg/7fa1LFv42u0J2v7ORXNbQx2T/+36WoHenXtQDmYo64csL5nvjxZVlXjcLmboeCdqnQ4kUwo21bvTFrrwhSkIvF5sIUVVMSspmiTJpMvXyrz76nNZh7qSY8zC+MMUiYiWXjAQ0CHGiDIQGOaDIS9LuNEajtMnpufIi+cuMbsfewQ8R/H6M09mr+5L3p305MG9BTpyruEw+usUffPjbzQrLB0f/ApW6Lg+cV8TBL7IGUaGM9FCK4z28YAOv5/K0b5xPhhpYwk7Igi8/svvs+TWvWkgucB0tO5Mz80E2v4vry4zv6xqkCSZ3J6exXxKwaejP5mWq8iHMXStIw0jFhQAhSlsIqFBFIkcDY8tCqoHAGo4ThcEXketywSAPVs3ouuQH+UCa5evlQn6WuF2OrLfFx6T0WZppjgfqpgxWtHf0sXJg3sBoGKATaYU3Jz6A10fXC7KGNNprKWZVeXUVn70n+XUhVVHZNUlUMEGTWZH8vxbd1ayzCrqsuqKxJI59N+uywqE3jcOQz9imMaNaopEQ1e92YS+Aoz9ZkM8rkOMZaDQaQcqV7Fatb291oz97kemkyFHw2OVLJWr6dP1VzUtmf95f8iylCgS7WzfjLpW32cYRiwLYxgxda2+L9ftCFTdQfsLW7AwZgDYEYgAAAAASUVORK5CYII=',
  };
  const PROCESS_META = { soft: '#EAF1F6', action: 'PROZESSTYP SETZEN', palette: PROCESS_TYPES.map((p) => [p.name, p.sym]) };
  function processTypeByName(name) { const base = String(name || '').replace(/_\d+$/, ''); return PROCESS_TYPES.find((p) => p.name === base) || null; }
  function processTypeBySym(sym) { return PROCESS_TYPES.find((p) => p.sym === sym) || null; }
  function ptStateGroups(pt) {
    const parse = (s) => (s ? String(s).split(', ') : []).filter(Boolean);
    return [
      { group: 'Betriebszustände', muss: parse(pt.muss), opt: parse(pt.opt) },
      { group: 'MPS-Meldungen', muss: parse(pt.mpsMuss), opt: parse(pt.mpsOpt) },
      { group: 'Informationen', muss: parse(pt.infoMuss), opt: parse(pt.infoOpt) },
    ];
  }
  function ptStateList(pt) {
    const out = [];
    ptStateGroups(pt).forEach((g) => {
      g.muss.forEach((n) => out.push({ group: g.group, kind: 'Pflicht', name: n }));
      g.opt.forEach((n) => out.push({ group: g.group, kind: 'Optional', name: n }));
    });
    return out;
  }

  const LAYER_META = {
    'Materialfluss': { soft: '#E2F4EE', action: 'FÖRDERWEG ZIEHEN', palette: [['Quelle', 'src'], ['Senke', 'snk'], ['Puffer', 'buf'], ['Umsetzer', 'xfer']] },
    'Funktionsgruppen': { soft: '#E0F2F7', action: 'FUNKTIONSGRUPPE', palette: [['Funktionsgruppe', 'zone'], ['Baugruppe', 'cell'], ['Modul', 'box'], ['Station', 'panel']] },
    'Steuerungstechnik': { soft: '#E6F0F7', action: 'SB EINZEICHNEN', palette: [['Schaltschrank', 'cab'], ['Schutzbereich', 'zone'], ['Bedienpult', 'panel'], ['Klemmkasten', 'box']] },
    'Saferobot / Technologie': { soft: '#F0E9F7', action: 'ROBOTER SETZEN', palette: [['Roboter', 'robot'], ['Techno-Steuerung', 'ctrl'], ['Greifer', 'grip'], ['Zelle', 'cell']] },
    'Antriebstechnik / Ident': { soft: '#E4F3EE', action: 'IDENT PLATZIEREN', palette: [['Antrieb', 'motor'], ['2D-Kamera', 'cam'], ['RFID', 'rfid'], ['Ritzpräger', 'mark']] },
    'Not-Halt': { soft: '#FBF0E3', action: 'NOTHALT GENERIEREN', palette: [['Not-Halt', 'estop'], ['SmartPad', 'pad'], ['Reißleine', 'pull'], ['Quittier', 'ack']] },
    'Sicherheitslayout': { soft: '#FBEAE8', action: 'SCHUTZZAUN ZIEHEN', palette: [['Sicherheitstür', 'door'], ['Lichtgitter', 'light'], ['Sicherheitsschalter', 'switch'], ['Beladestelle', 'load']] },
  };
  // Palette-Meta zur Ebene: exakter Name, sonst Prozesstyp-Katalog fuer 'Prozess...'-Ebenen, sonst Default
  function paletteMetaFor(L) {
    if (!L) return { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };
    if (LAYER_META[L.name]) return LAYER_META[L.name];
    if (/prozess/i.test(L.name || '')) return PROCESS_META;
    return { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };
  }

  function layerById(id) { return (state.detail.layers || []).find((l) => l.id === id) || null; }
  // Rollen-/Gruppen-Sichtbarkeit: Admins sehen immer alles; sonst null = alle, oder nur die Codes in der Liste
  function layerAllowed(code) { return state.role === 'admin' || !state.visibleLayers || state.visibleLayers.indexOf(code) >= 0; }
  function allowedLayers() { return (state.detail.layers || []).filter((l) => layerAllowed(l.code)); }
  // Sichtbarkeits-Map layerId -> bool (Auge-Zustand kombiniert mit Rollen-/Gruppensicht)
  function visibleMap() {
    const v = {};
    (state.detail.layers || []).forEach((l) => { v[l.id] = (l.visible !== false) && layerAllowed(l.code); });
    return v;
  }
  function objectsOfLayer(id) { return (state.detail.objects || []).filter((o) => o.layerId === id); }

  /* ---- Punkt-basierte Formen: Schutzbereich (geschlossen) + Materialfluss-Förderweg (offen) ---- */
  function isShape(o) { return o && (o.symbolType === 'sb_zone' || o.symbolType === 'fg_zone' || o.symbolType === 'mf_route'); }
  // Polygon-Art abhängig von der Ebene: "Funktionsgruppen" -> fg_zone, sonst Schutzbereich (sb_zone). Nach Namen, damit Umnummerieren nichts bricht.
  function zoneKind(layer) {
    if (layer && layer.name === 'Funktionsgruppen') return { type: 'fg_zone', prefix: 'Funktionsgruppe', noun: 'Funktionsgruppe', label: 'FG FUNKTIONSGRUPPE' };
    return { type: 'sb_zone', prefix: 'Schutzbereich', noun: 'Schutzbereich', label: 'SB SCHUTZBEREICH' };
  }

  const ROUTE_ARTS = ['Rollenbahn', 'Kettenförderer', 'Band-/Gurtförderer', 'Hängeförderer', 'FTS / AGV', 'Stapler / manuell', 'Manueller Transport'];
  // Materialfluss-Typen mit fester Farbe (farbige Pfeile zur Auswahl unter Materialfluss)
  const FLOW_TYPES = [
    { name: 'i.O. Teile', color: '#16A34A', desc: 'In Ordnung – freigegebene / gute Teile' },
    { name: 'n.i.O. Teile', color: '#DC2626', desc: 'Nicht in Ordnung – Ausschuss / Fehlteile' },
    { name: 'Nacharbeit', color: '#D97706', desc: 'Teile zur Nacharbeit / Reparatur' },
    { name: 'Leergut', color: '#64748B', desc: 'Leere Ladungsträger / Behälter zurück' },
    { name: 'Rohteile', color: '#2563EB', desc: 'Rohteile / Zulieferung in den Prozess' },
    { name: 'Fertigteile', color: '#0D9488', desc: 'Fertige Teile aus dem Prozess heraus' },
  ];
  function flowColor(name) { const f = FLOW_TYPES.find((t) => t.name === name); return f ? f.color : null; }
  function routeMaterial(o) { const m = (o.metatags || []).find((x) => x.label === 'Materialart'); return m ? m.value : ''; }
  // Legende der im Plan verwendeten Materialfluss-Typen (Farbcodierung), ein-/ausblendbar.
  function flowLegendHtml() {
    const used = {};
    (state.detail.objects || []).forEach((o) => {
      if (o.symbolType !== 'mf_route') return;
      const mat = routeMaterial(o);
      if (mat && flowColor(mat)) used[mat] = flowColor(mat);
    });
    const names = FLOW_TYPES.map((t) => t.name).filter((n) => used[n]);
    if (!names.length) return '';
    if (!state.flowLegend) return '<button class="flow-legend-btn" data-act="flow-legend" title="Materialfluss-Legende einblenden"><span class="fl-dots"></span>Legende</button>';
    const rows = names.map((n) => '<div class="fl-row"><span class="fl-dot" style="background:' + used[n] + '"></span>' + esc(n) + '</div>').join('');
    return '<div class="flow-legend"><div class="fl-head">Materialfluss<button data-act="flow-legend" title="Legende ausblenden">×</button></div>' + rows + '</div>';
  }
  const ROUTE_DASH = { 'Rollenbahn': '', 'Kettenförderer': '2.4 1.6', 'Band-/Gurtförderer': '', 'Hängeförderer': '4 2', 'FTS / AGV': '0.1 2.6', 'Stapler / manuell': '5 2 1 2', 'Manueller Transport': '5 2 1 2' };
  function routeArt(o) { const m = (o.metatags || []).find((x) => x.label === 'Förderart'); return m ? m.value : ''; }

  function docAspect() {
    if (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h) return state.layoutDim.w / state.layoutDim.h;
    return 760 / 520;
  }
  // Abstand Punkt→Strecke in seitenverhältnis-korrigiertem Raum (x mit ar skaliert → isotrop)
  function distToSegAR(px, py, ax, ay, bx, by, ar) {
    px *= ar; ax *= ar; bx *= ar;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function pointNearRoute(o, x, y) {
    const p = o.points; if (!p || p.length < 2) return false;
    const ar = docAspect();
    for (let i = 0; i < p.length - 1; i++) { if (distToSegAR(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, ar) < 0.028) return true; }
    return false;
  }
  // Gefüllter Pfeilkopf am Streckenende; isotrop trotz preserveAspectRatio="none"
  // Weiche Kurve durch die Stützpunkte (Catmull-Rom → kubische Bézier). Liefert d-Pfad (viewBox 0..100)
  // und die Endtangente (normalisierte Richtung) für die Pfeil-Ausrichtung.
  function buildRouteCurve(pts) {
    const n = pts.length;
    if (n < 2) return { d: n ? 'M' + (pts[0].x * 100) + ' ' + (pts[0].y * 100) : '', tan: { x: 1, y: 0 } };
    const P = pts.map((p) => ({ x: p.x * 100, y: p.y * 100 }));
    let d = 'M' + P[0].x + ' ' + P[0].y;
    let lastC2 = P[0];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + p2.x + ' ' + p2.y;
      lastC2 = { x: c2x, y: c2y };
    }
    const end = P[n - 1];
    return { d, tan: { x: (end.x - lastC2.x) / 100, y: (end.y - lastC2.y) / 100 } };
  }
  // Gefüllter Pfeilkopf am Endpunkt, ausgerichtet an einer (normalisierten) Tangente; isotrop trotz preserveAspectRatio="none".
  function routeArrowFromTan(tip, tanVb, ar) {
    let sdx = tanVb.x * ar, sdy = tanVb.y;
    const len = Math.hypot(sdx, sdy) || 1e-6; sdx /= len; sdy /= len;
    const back = { x: -sdx, y: -sdy }, L = 3.4, ang = Math.PI * 0.16;
    const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
    const w1 = rot(back, ang), w2 = rot(back, -ang);
    const tvx = tip.x * 100, tvy = tip.y * 100;
    const p1x = tvx + w1.x * L / ar, p1y = tvy + w1.y * L;
    const p2x = tvx + w2.x * L / ar, p2y = tvy + w2.y * L;
    return 'M' + p1x + ' ' + p1y + ' L' + tvx + ' ' + tvy + ' L' + p2x + ' ' + p2y + ' Z';
  }

  async function openEditor() {
    state.view = 'editor';
    if (!state.activeLayer || !layerAllowed((layerById(state.activeLayer) || {}).code)) {
      const al = allowedLayers(); if (al[0]) state.activeLayer = al[0].id;
    }
    if (state.sat == null) state.sat = 100;
    if (state.zoom == null) state.zoom = 1;
    await ensureLayoutBlob();
    renderEditor();
    startCollab();
  }
  function leaveEditor() {
    state.view = 'detail';
    $('content').style.padding = '';
    stopCollab();
    renderDetail();
  }

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
    const [objR, chR] = await Promise.allSettled([Api.getObjects(sid), Api.getChanges(sid, null)]);
    state.collab.inflight = false;
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
  function protectObj(id) { if (id) state.collab.protect[String(id)] = Date.now() + 6000; }
  // Vergleicht zwei Punktlisten mit Toleranz (Server rundet ggf. Floats).
  function pointsMatch(a, b) {
    a = a || []; b = b || [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs((a[i].x || 0) - (b[i].x || 0)) > 0.001 || Math.abs((a[i].y || 0) - (b[i].y || 0)) > 0.001) return false;
    }
    return true;
  }
  function shapeVisualKey(o) {
    const art = (o.metatags || []).find((m) => m.label === 'Förderart');
    return [o.color, o.plcConfigId || '', art ? art.value : '', o.layerId].join('|');
  }
  function flashShape(id) {
    const el = document.getElementById('zone-poly-' + id); if (!el) return;
    el.classList.remove('mf-flash'); void el.getBBox; el.classList.add('mf-flash');
    setTimeout(() => { const e = document.getElementById('zone-poly-' + id); if (e) e.classList.remove('mf-flash'); }, 900);
  }
  // Hat sich ein Objekt in einer sichtbaren/relevanten Eigenschaft geändert?
  function objChanged(a, b) {
    if (a.name !== b.name || a.color !== b.color || a.symbolType !== b.symbolType || a.layerId !== b.layerId
      || a.x !== b.x || a.y !== b.y || (a.rotation || 0) !== (b.rotation || 0)
      || (a.plcConfigId || '') !== (b.plcConfigId || '') || !!a.visible !== !!b.visible) return true;
    if (JSON.stringify(a.points || null) !== JSON.stringify(b.points || null)) return true;
    if (JSON.stringify(a.metatags || []) !== JSON.stringify(b.metatags || [])) return true;
    return false;
  }
  function personLabel(v) { return v.name || v.email || ''; }
  function personInitials(label) {
    const base = String(label).split('@')[0];
    const parts = base.split(/[.\-_\s]+/).filter(Boolean).slice(0, 2);
    return parts.map((s) => s[0].toUpperCase()).join('') || 'U';
  }
  function firstName(label) { return String(label).split('@')[0].split(/[.\-_\s]+/).filter(Boolean)[0] || String(label); }
  function capFirst(s) { s = String(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function presenceHtml() {
    const st = state.collab.status;
    let status;
    if (st === 'offline') status = '<span class="collab-status off">● offline</span>';
    else if (st === 'live') status = '<span class="collab-status on">● live</span>';
    else status = '<span class="collab-status">● …</span>';

    const me = state.user && state.user.email;
    const all = state.collab.viewers || [];
    const others = all.filter((v) => v.email && v.email !== me);

    let trigger = '<div class="collab-trigger" data-act="collab-details" title="Klicken: wer ist gerade hier?">' + status;
    if (others.length) {
      const dots = others.slice(0, 5).map((v) => {
        const label = personLabel(v);
        return '<span class="collab-dot' + (v.editing ? ' editing' : '') + '" title="' + esc(label) + '">' + esc(personInitials(label)) + '</span>';
      }).join('');
      const more = others.length > 5 ? '<span class="collab-more">+' + (others.length - 5) + '</span>' : '';
      const editors = others.filter((v) => v.editing).map((v) => esc(capFirst(firstName(personLabel(v)))));
      const cap = editors.length
        ? '<span class="collab-cap">' + editors.join(', ') + (editors.length === 1 ? ' bearbeitet gerade' : ' bearbeiten gerade') + '</span>'
        : '<span class="collab-cap muted">' + others.length + (others.length === 1 ? ' Person' : ' Personen') + ' hier</span>';
      trigger += '<div class="collab-dots">' + dots + more + '</div>' + cap;
    }
    trigger += '</div>';

    let pop = '';
    if (state.collab.detailsOpen) {
      let rows;
      if (all.length) {
        rows = all.map((v) => {
          const mine = v.email === me;
          const tag = mine ? ' <span class="cp-you">(du)</span>' : '';
          const ed = v.editing ? ' <span class="cp-edit">bearbeitet</span>' : '';
          return '<div class="cp-row">' + esc(personLabel(v) || '(ohne E-Mail)') + tag + ed + '</div>';
        }).join('');
      } else {
        rows = '<div class="cp-row muted">Server meldet niemanden.</div>';
      }
      let hint = '';
      if (st === 'offline') hint = '<div class="cp-hint">Server nicht erreichbar – Backend-Deploy/Migration prüfen.</div>';
      else if (all.length <= 1) hint = '<div class="cp-hint">Nur du bist erfasst. Die andere Person muss eingeloggt sein und dieselbe Anlage im MODELLIEREN-Fenster offen haben.</div>';
      // Diagnose: was liegt aktuell wirklich im Editor + letzter Server-Sync
      const objs = state.detail.objects || [];
      const nSb = objs.filter((o) => o.symbolType === 'sb_zone').length;
      const nFg = objs.filter((o) => o.symbolType === 'fg_zone').length;
      const nMf = objs.filter((o) => o.symbolType === 'mf_route').length;
      const nSym = objs.filter((o) => !isShape(o)).length;
      const ls = state.collab.lastSync;
      const diag = '<div class="cp-hint">Im Editor: <b>' + nSb + '</b> Schutzbereiche · ' + nFg + ' Funktionsgruppen · ' + nMf + ' Förderwege · ' + nSym + ' Symbole'
        + (ls ? ('<br>Letzter Server-Sync: ' + ls.n + ' geändert, ' + ls.del + ' gelöscht') : '') + '</div>';
      pop = '<div class="collab-pop"><div class="cp-head">Anwesend laut Server (' + all.length + ')</div>' + rows + hint + diag + '</div>';
    }
    return '<div class="collab-bar">' + trigger + pop + '</div>';
  }
  function renderPresenceOnly() {
    const bar = document.getElementById('collabBar');
    if (bar) bar.innerHTML = presenceHtml();
  }

  async function ensureLayoutBlob() {
    const sid = state.detail && state.detail.id;
    if (state.layoutBlobUrl && state.layoutBlobStation === sid && state.detail.hasLayout) return;
    if (state.layoutBlobUrl) { URL.revokeObjectURL(state.layoutBlobUrl); state.layoutBlobUrl = null; state.layoutBlobStation = null; state.layoutDim = null; }
    if (state.detail && state.detail.hasLayout) {
      try {
        const res = await Api.raw('/stations/' + sid + '/layout');
        if (res.ok) {
          state.layoutBlobUrl = URL.createObjectURL(await res.blob());
          state.layoutBlobStation = sid;
          state.layoutDim = await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => resolve(null);
            im.src = state.layoutBlobUrl;
          });
        }
      } catch (e) { /* ignore */ }
    }
  }

  function editorFloorplan() {
    const op = (state.sat || 100) / 100;
    const bg = state.layoutBlobUrl
      ? '<img class="floor-bg floor-photo" src="' + state.layoutBlobUrl + '" alt="Anlagenlayout" style="opacity:' + op + ';object-fit:fill">'
      : '<svg class="floor-bg floor-schema" viewBox="0 0 760 520" preserveAspectRatio="xMidYMid meet" style="opacity:' + op + '" xmlns="http://www.w3.org/2000/svg">'
        + '<defs><pattern id="bp" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#D3DEE6" stroke-width="1"/></pattern>'
        + '<pattern id="bp2" width="130" height="130" patternUnits="userSpaceOnUse"><path d="M130 0H0V130" fill="none" stroke="#B9C7D1" stroke-width="1.3"/></pattern></defs>'
        + '<rect width="760" height="520" fill="#F7FAFC"/><rect width="760" height="520" fill="url(#bp)"/><rect width="760" height="520" fill="url(#bp2)"/>'
        + '<rect x="40" y="40" width="680" height="440" fill="none" stroke="#8FA3B0" stroke-width="2.5"/></svg>';
    const badge = state.layoutBlobUrl ? '<div class="layout-badge">eigenes Layout</div>' : '<div class="layout-badge muted">Schema-Layout</div>';

    const visible = visibleMap();
    const placed = (state.detail.objects || []).filter((o) => !isShape(o) && visible[o.layerId] !== false).map((o) => {
      const isProc = /^ptk_/.test(o.symbolType);
      const chips = o.metatags.filter((m) => !isProc || (m.position || 0) <= 2).map((m) => m.value).filter(Boolean);
      let stateIcons = '';
      if (isProc) {
        const ics = o.metatags
          .filter((m) => (m.position || 0) >= 3 && m.value && String(m.value).trim())
          .map((m) => {
            const nm = String(m.label || '').replace(/^(Pflicht|Optional) – /, '');
            return STATE_ICONS[nm] ? '<img class="p-state-ic" src="' + STATE_ICONS[nm] + '" title="' + esc(nm + ': ' + m.value) + '" alt="' + esc(nm) + '">' : '';
          }).filter(Boolean).join('');
        if (ics) stateIcons = '<div class="p-state-icons">' + ics + '</div>';
      }
      return '<div class="placed" data-obj="' + o.id + '" style="left:' + (o.x * 100) + '%;top:' + (o.y * 100) + '%;color:' + esc(objIconColor(o)) + '"'
        + ' title="' + esc(o.name) + ' — ziehen zum Verschieben · Doppelklick für Metatags">'
        + '<span class="p-sym"><svg width="26" height="26" viewBox="0 0 24 24">' + (SYM[o.symbolType] || SYM.box) + '</svg></span>'
        + stateIcons
        + (chips.length ? '<div class="ptags">' + chips.map((t) => '<span class="ptag">' + esc(t) + '</span>').join('') + '</div>' : '')
        + '</div>';
    }).join('');

    // Zeichenfläche übernimmt das Seitenverhältnis des Layoutbilds -> Symbole sitzen passgenau
    const docStyle = (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h)
      ? ' style="aspect-ratio:' + state.layoutDim.w + '/' + state.layoutDim.h + ';max-width:960px"' : '';

    return '<div class="canvas-doc ' + (state.drawZone ? 'drawing' : '') + '" id="canvasDoc"' + docStyle + '>'
      + bg + zoneOverlaySvg(visible) + '<div class="placed-layer">' + placed + '</div>' + fgLabelLayer(visible) + techBadgeLayer() + zoneHandleLayer() + badge + '</div>';
  }

  // Metatags einer Funktionsgruppe/eines Schutzbereichs dauerhaft mittig im Polygon anzeigen (HTML-Overlay, damit kein Verzerren)
  function fgLabelLayer(visible) {
    const zones = (state.detail.objects || []).filter((o) => (o.symbolType === 'fg_zone' || o.symbolType === 'sb_zone') && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    if (!zones.length) return '';
    return '<div class="fg-label-layer">' + zones.map((z) => {
      const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
      const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
      const tags = (z.metatags || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map((m) => m.value).filter((v) => v !== null && v !== '');
      const lines = tags.length ? tags : [z.name];
      const abbrev = (t) => (z.symbolType === 'sb_zone' ? String(t).replace(/Schutzbereich/g, 'SB') : t);
      const inner = lines.map((t) => '<div class="fgl-line">' + esc(abbrev(t)) + '</div>').join('');
      return '<div class="fg-label" style="left:' + (cx * 100) + '%;top:' + (cy * 100) + '%;color:' + esc(zoneColor(z)) + '">' + inner + '</div>';
    }).join('') + '</div>';
  }

  function zoneOverlaySvg(visible) {
    const zones = (state.detail.objects || []).filter((o) => (o.symbolType === 'sb_zone' || o.symbolType === 'fg_zone') && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
    const polys = zones.map((z) => {
      const pts = z.points.map((p) => (p.x * 100) + ',' + (p.y * 100)).join(' ');
      const sel = state.selectedZone === z.id;
      const col = esc(zoneColor(z));
      return '<polygon id="zone-poly-' + z.id + '" points="' + pts + '" fill="' + col + '" fill-opacity="0.13" stroke="' + col + '" stroke-width="' + (sel ? 2.4 : 1.6) + '" ' + (sel ? 'stroke-dasharray="4 3" ' : '') + 'vector-effect="non-scaling-stroke" style="pointer-events:none" />';
    }).join('');
    const ar = docAspect();
    const routes = (state.detail.objects || []).filter((o) => o.symbolType === 'mf_route' && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
    const routeSvg = routes.map((r) => {
      const cv = buildRouteCurve(r.points);
      const sel = state.selectedZone === r.id;
      const col = esc(r.color || '#0FA47F');
      const dash = ROUTE_DASH[routeArt(r)] || '';
      const line = '<path id="zone-poly-' + r.id + '" d="' + cv.d + '" fill="none" stroke="' + col + '" stroke-width="' + (sel ? 2.8 : 2) + '" '
        + (dash ? ('stroke-dasharray="' + dash + '" ') : '') + 'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" class="mf-line' + (sel ? ' sel' : '') + '" style="pointer-events:none"/>';
      const arrow = '<path id="route-arrow-' + r.id + '" d="' + routeArrowFromTan(r.points[r.points.length - 1], cv.tan, ar) + '" fill="' + col + '" style="pointer-events:none"/>';
      return line + arrow;
    }).join('');
    let draft = '';
    if (state.drawZone && state.zoneDraft.length) {
      const L = layerById(state.activeLayer); const col = esc(L ? L.color : '#0065A5');
      const dots = state.zoneDraft.map((p) => '<rect x="' + (p.x * 100 - 0.7) + '" y="' + (p.y * 100 - 0.7) + '" width="1.4" height="1.4" fill="' + col + '" style="pointer-events:none"/>').join('');
      if (state.drawShape === 'route') {
        const dpull = state.zoneCursor ? state.zoneDraft.concat([state.zoneCursor]) : state.zoneDraft;
        draft = '<path id="zone-draft" d="' + buildRouteCurve(dpull).d + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' + dots;
      } else {
        const dpts = state.zoneDraft.map((p) => (p.x * 100) + ',' + (p.y * 100));
        draft = '<polyline id="zone-draft" points="' + dpts.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' + dots;
      }
    }
    return '<svg class="zone-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2">' + techLinesSvg(visible) + polys + routeSvg + draft + '</svg>';
  }

  function zoneHandleLayer() {
    if (state.drawZone || !state.selectedZone) return '';
    const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone && isShape(o) && o.points);
    if (!z) return '';
    return '<div class="zone-handle-layer">' + z.points.map((p, i) =>
      '<div class="zone-vertex" data-zone="' + z.id + '" data-vidx="' + i + '" style="left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%"></div>').join('') + '</div>';
  }

  const TECH_CODE = {
    'Punkt Schweißen - Stahl': 'PS', 'MIG-Schweißen': 'SM', 'Bolzen-Schweißen': 'BS',
    'Bolzen-Schweißen (Rotationskopf)': 'BR', 'Bolzen (stationär)': 'B', 'Kleben': 'KL',
    'Laser': 'LA', 'Halbholstanznieten': 'HN', 'Fließlochschrauben': 'FS', 'Inline messen': 'IM',
  };
  function techCode(name) {
    if (TECH_CODE[name]) return TECH_CODE[name];
    const w = String(name).replace(/[^A-Za-zÄÖÜäöüß ]/g, '').split(/\s+/).filter(Boolean);
    return w.map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '•';
  }
  function techInfo(o) {
    if (o.symbolType !== 'robot') return null;
    const m = (o.metatags || []).find((t) => t.position === 2 && t.value);
    if (!m || !m.value) return null;
    let bx, by;
    if (o.points && o.points.length >= 1 && o.points[0]) { bx = o.points[0].x; by = o.points[0].y; }
    else { bx = Math.min(o.x + 0.12, 0.94); by = Math.max(o.y - 0.12, 0.07); }
    return { id: o.id, name: m.value, code: techCode(m.value), rx: o.x, ry: o.y, bx, by };
  }
  function techLinesSvg(visible) {
    return (state.detail.objects || []).map((o) => {
      if (visible[o.layerId] === false) return '';
      const t = techInfo(o); if (!t) return '';
      return '<line id="tech-line-' + t.id + '" x1="' + (t.rx * 100) + '" y1="' + (t.ry * 100) + '" x2="' + (t.bx * 100) + '" y2="' + (t.by * 100) + '" stroke="#E67E22" stroke-width="1.3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
    }).join('');
  }
  function techBadgeLayer() {
    const visible = visibleMap();
    const editable = canEdit();
    const badges = (state.detail.objects || []).map((o) => {
      if (visible[o.layerId] === false) return '';
      const t = techInfo(o); if (!t) return '';
      return '<div class="tech-badge" data-tech="' + t.id + '" style="left:' + (t.bx * 100) + '%;top:' + (t.by * 100) + '%">'
        + '<span class="tb-dot"' + (editable ? ' data-techdrag="' + t.id + '" title="Verschieben"' : '') + '>' + esc(t.code) + '</span>'
        + '<span class="tb-name">' + esc(t.name) + '</span></div>';
    }).join('');
    return '<div class="tech-badge-layer">' + badges + '</div>';
  }
  function onTechDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    const o = (state.detail.objects || []).find((z) => z.id === state.techDrag.id); if (!o) return;
    o.points = [{ x, y }]; state.techDrag.moved = true;
    const line = document.getElementById('tech-line-' + o.id);
    if (line) { line.setAttribute('x2', x * 100); line.setAttribute('y2', y * 100); }
    const badge = document.querySelector('.tech-badge[data-tech="' + o.id + '"]');
    if (badge) { badge.style.left = (x * 100) + '%'; badge.style.top = (y * 100) + '%'; }
  }

  function renderEditor() {
    const c = $('content'); c.style.padding = '0';
    let L = layerById(state.activeLayer);
    if (!L || !layerAllowed(L.code)) L = allowedLayers()[0] || (state.detail.layers || [])[0];
    if (L && state.activeLayer !== L.id) state.activeLayer = L.id;
    if (!L) { c.innerHTML = '<div class="pad">Keine Ebenen sichtbar.</div>'; return; }
    const meta = paletteMetaFor(L);

    const counts = {};
    (state.detail.objects || []).forEach((o) => { counts[o.layerId] = (counts[o.layerId] || 0) + 1; });

    const pal = (meta.palette || []).map(([name, sym]) => {
      const mm = String(name).match(/^(\d+)\s+(.+)$/);
      const no = mm ? mm[1] : '';
      const label = mm ? mm[2] : name;
      return '<div class="pal-item" style="color:' + L.color + ';--lc:' + L.color + ';--lc-soft:' + meta.soft + '" draggable="true" data-sym="' + sym + '" data-name="' + esc(name) + '" data-color="' + L.color + '" data-act="pal-hint" title="Auf das Layout ziehen">'
        + '<div class="sym"><svg width="24" height="24" viewBox="0 0 24 24">' + (SYM[sym] || SYM.box) + '</svg></div>'
        + '<div class="pal-cap">' + (no ? '<span class="pal-no">' + no + '</span>' : '') + '<span class="pal-nm">' + esc(label) + '</span></div>'
        + '</div>';
    }).join('');

    const layerStack = (state.detail.layers || []).slice().reverse().filter((l) => layerAllowed(l.code)).map((l) => {
      const act = l.id === L.id, vis = l.visible !== false;
      const eye = vis
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.2 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.2-1.5"/><path d="M4 4l16 16"/></svg>';
      const lmeta = paletteMetaFor(l);
      return '<div class="layer ' + (act ? 'active' : '') + ' ' + (vis ? '' : 'hidden') + '" style="--lc:' + l.color + ';--lc-soft:' + lmeta.soft + '" data-act="layer-select" data-layer="' + l.id + '">'
        + '<div class="lbar"></div><div class="lmeta"><span class="lid">' + esc(l.code) + '</span><span class="lcount" title="Objekte auf dieser Ebene">' + (counts[l.id] || 0) + '</span><span class="lname">' + esc(l.name) + '</span></div>'
        + '<button class="eye ' + (vis ? '' : 'off') + '" data-act="layer-eye" data-layer="' + l.id + '" title="Sichtbarkeit">' + eye + '</button></div>';
    }).join('');

    // Objektliste der aktiven Ebene, nach Kategorie gruppiert
    const objs = objectsOfLayer(L.id);
    const cats = (L.categories || []).slice();
    const byCat = {}; objs.forEach((o) => { const k = o.categoryId || '_'; (byCat[k] = byCat[k] || []).push(o); });
    const catBlocks = [];
    cats.forEach((cat) => {
      const list = byCat[cat.id] || [];
      catBlocks.push(objCatBlock(cat.name, list, L.color));
    });
    if (byCat['_'] && byCat['_'].length) catBlocks.push(objCatBlock('Ohne Kategorie', byCat['_'], L.color));
    const objlist = catBlocks.length ? catBlocks.join('') : '<div style="color:var(--muted);font-size:13px;padding:4px 2px">Noch keine Objekte auf dieser Ebene.</div>';

    c.innerHTML = '<div class="editor-wrap"><div class="canvas-col">'
      + '<div class="editor-topbar"><div class="ttl">' + esc((state.detail.anlagenname || '').split(' · ')[0])
      + '<span class="lyr-badge" style="background:' + L.color + '">' + esc(L.code) + ' ' + esc(L.name) + '</span></div>'
      + '<div style="margin-left:auto;display:flex;align-items:center;gap:10px">'
      + '<div id="collabBar">' + presenceHtml() + '</div>'
      + (canEdit() ? '<button class="up-btn" data-act="editor-upload">' + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg> ' + (state.detail.hasLayout ? 'LAYOUT ERSETZEN' : 'LAYOUT HOCHLADEN') + '</button>' : '')
      + '<div class="zoom-ctl"><button data-act="zoom-out">−</button><span class="z">' + Math.round((state.zoom || 1) * 100) + '%</span><button data-act="zoom-in">+</button></div>'
      + '</div></div>'
      + '<div class="canvas-stage" id="stage"><div class="canvas-inner">' + editorFloorplan() + '</div>' + flowLegendHtml()
      + (canEdit() ? '<div class="palette"><div class="pal-head"><span class="pal-dot" style="background:' + L.color + '"></span><span class="pal-ttl">' + esc(L.name) + '</span><span class="pal-code">' + esc(L.code) + '</span></div><div class="pal-grid">' + pal + '</div></div>' : '')
      + '<div class="sat-ctl"><label>Layout-Sättigung <span id="satVal">' + (state.sat || 100) + '%</span></label><input id="satRange" type="range" min="10" max="100" value="' + (state.sat || 100) + '"></div>'
      + '<div class="exp-ctl">'
      + '<button class="btn" data-act="export-pdf"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v11M8 10l4 4 4-4M5 19h14"/></svg> PDF</button>'
      + '<button class="btn" data-act="export-csv"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M9 4v16"/></svg> CSV</button>'
      + '<button class="btn" data-act="editor-back"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 6l-6 6 6 6"/></svg> ZURÜCK</button>'
      + '</div></div></div>'
      + '<aside class="layers"><div class="lp-head"><h2>Ebenen-Stack</h2><p>Sichtbarkeit &amp; aktive Ebene</p></div>'
      + '<div class="layer-stack">' + layerStack + '</div>'
      + (canEdit() ? actionPanelHtml(L) : '')
      + '<div class="objlist"><h4>Objektliste · ' + esc(L.code) + '</h4>' + objlist + '</div>'
      + '</aside></div>';

    applyZoomSat();
  }

  function actionPanelHtml(L) {
    const isL0 = L && L.name === 'Materialfluss';
    const zoneActive = state.drawShape === 'zone';
    const routeActive = state.drawShape === 'route';
    let btn, hint, extra = '';
    if (isL0) {
      btn = '<button class="btn zone-btn ' + (routeActive ? 'active' : '') + '" data-act="toggle-route" style="width:100%;justify-content:center">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h13M13 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg> '
        + (routeActive ? 'ZEICHNEN AKTIV' : 'FÖRDERWEG') + '</button>';
      // Farbige Materialfluss-Typen zur Auswahl -> bestimmt die Pfeilfarbe des nächsten Förderwegs
      extra = '<div class="flow-pick">' + FLOW_TYPES.map((ft, i) =>
        '<button class="flow-chip ' + (state.flowType === i ? 'active' : '') + '" data-act="flow-type" data-flow="' + i + '" style="--fc:' + ft.color + '" title="' + esc(ft.name + ' – ' + ft.desc) + '">'
        + '<span class="fc-dot"></span>' + esc(ft.name) + '</button>').join('') + '</div>';
      hint = routeActive
        ? 'Klicken setzt Wegpunkte · Klick auf den letzten Punkt oder <b>Enter</b> beendet · <b>Esc</b> bricht ab. Farbe = gewählter Materialfluss-Typ; Doppelklick öffnet Typ &amp; Förderart.'
        : 'Erst Typ oben wählen (Farbe), dann zeichnen. Wegpunkte danach verschiebbar. Weg anklicken: <b>Entf</b> löscht, <b>R</b> kehrt die Richtung um.';
    } else {
      const kind = zoneKind(layerById(state.activeLayer));
      btn = '<button class="btn zone-btn ' + (zoneActive ? 'active' : '') + '" data-act="toggle-zone" style="width:100%;justify-content:center">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4z" stroke-dasharray="3 2.5"/></svg> '
        + (zoneActive ? 'ZEICHNEN AKTIV' : kind.label) + '</button>';
      hint = zoneActive
        ? 'Klicken setzt Stützpunkte · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
        : 'Polygon zeichnen; Stützpunkte danach verschiebbar. ' + kind.noun + ' anklicken &amp; <b>Entf</b> löscht ihn.';
    }
    return '<div class="lp-action">' + btn + extra + '<div class="zone-hint">' + hint + '</div></div>';
  }

  function objCatBlock(name, list, color) {
    const tools = canEdit();
    const rows = list.map((o) => '<div class="obj"><span class="odot" style="background:' + esc(o.color) + '"></span><span class="oname">' + esc(o.name) + '</span>'
      + (tools ? ('<div class="obj-tools">'
      + '<button data-act="obj-edit" data-obj="' + o.id + '" title="Metatags"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l8-8h6v6l-8 8z"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/></svg></button>'
      + '<button class="del" data-act="obj-del" data-obj="' + o.id + '" title="Löschen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</div>') : '') + '</div>').join('');
    return '<div class="obj-cat"><div class="obj-cat-head" style="color:' + esc(color) + '">' + esc(name) + '<span class="cnt">' + list.length + '</span></div>' + rows + '</div>';
  }

  function applyZoomSat() { const doc = document.getElementById('canvasDoc'); if (doc) doc.style.transform = 'scale(' + (state.zoom || 1) + ')'; }
  function zoomStep(d) { state.zoom = Math.min(2.2, Math.max(0.5, (state.zoom || 1) + d)); applyZoomSat(); const z = document.querySelector('.zoom-ctl .z'); if (z) z.textContent = Math.round(state.zoom * 100) + '%'; }
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

  async function placeFromDrop(clientX, clientY, sym, name, color) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const x = Math.min(0.97, Math.max(0.03, (clientX - r.left) / r.width));
    const y = Math.min(0.96, Math.max(0.04, (clientY - r.top) / r.height));
    const L = layerById(state.activeLayer);
    const base = (name || 'Objekt').replace(/\s+/g, '_');
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === sym).length + 1).padStart(2, '0');
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: base + '_' + num, symbolType: sym, color: color || L.color, x, y });
      obj.metatags = obj.metatags || [];
      const pt = processTypeByName(name);
      if (pt) {
        try {
          const tags = [
            { position: 1, label: 'Prozesstyp', value: pt.ptyp },
            { position: 2, label: 'Hardware · Art', value: pt.hwart },
          ];
          let pos = 3;
          ptStateList(pt).forEach((s) => { tags.push({ position: pos++, label: s.kind + ' – ' + s.name, value: '' }); });
          const upd = await Api.setMetatags(obj.id, tags);
          obj.metatags = (upd && upd.metatags) || obj.metatags;
        } catch (e2) { /* Metatags optional */ }
      }
      state.detail.objects.push(obj); protectObj(obj.id);
      toast(name + ' platziert'); renderEditor();
    } catch (e) { toast('Platzieren fehlgeschlagen: ' + e.message); }
  }

  let dragMove = null;
  function startMove(e, oid) {
    if (e.button !== undefined && e.button !== 0) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const el = e.target.closest('.placed'); if (!el) return;
    dragMove = { oid, el, doc, sx: e.clientX, sy: e.clientY, moved: false, nx: null, ny: null };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  function onMove(e) {
    if (state.techDrag) { onTechDrag(e); return; }
    if (state.zoneDrag) { onZoneDrag(e); return; }
    if (state.drawZone && state.zoneDraft.length) {
      const doc = document.getElementById('canvasDoc');
      if (doc) { const r = doc.getBoundingClientRect(); state.zoneCursor = { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }; updateDraftDom(); }
    }
    if (!dragMove) return;
    if (!dragMove.moved && Math.hypot(e.clientX - dragMove.sx, e.clientY - dragMove.sy) < 4) return;
    dragMove.moved = true;
    const r = dragMove.doc.getBoundingClientRect();
    const x = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width));
    const y = Math.min(0.96, Math.max(0.04, (e.clientY - r.top) / r.height));
    dragMove.nx = x; dragMove.ny = y;
    dragMove.el.style.left = (x * 100) + '%'; dragMove.el.style.top = (y * 100) + '%'; dragMove.el.style.cursor = 'grabbing';
    // Technologie-Linie live mitziehen (Roboter-Ende der Linie)
    const tline = document.getElementById('tech-line-' + dragMove.oid);
    if (tline) {
      tline.setAttribute('x1', x * 100); tline.setAttribute('y1', y * 100);
      const ro = (state.detail.objects || []).find((z) => z.id === dragMove.oid);
      if (ro && !(ro.points && ro.points.length >= 1)) {
        const bx = Math.min(x + 0.12, 0.94), by = Math.max(y - 0.12, 0.07);
        tline.setAttribute('x2', bx * 100); tline.setAttribute('y2', by * 100);
        const bd = document.querySelector('.tech-badge[data-tech="' + ro.id + '"]');
        if (bd) { bd.style.left = (bx * 100) + '%'; bd.style.top = (by * 100) + '%'; }
      }
    }
  }
  async function endMove() {
    if (state.techDrag) {
      const td = state.techDrag; state.techDrag = null;
      const o = (state.detail.objects || []).find((z) => z.id === td.id);
      if (td.moved && o) { protectObj(o.id); try { await Api.updateObject(o.id, { points: o.points }); } catch (e2) { toast('Position nicht gespeichert'); } }
      renderEditor(); return;
    }
    if (state.zoneDrag) {
      const zd = state.zoneDrag; state.zoneDrag = null;
      const z = (state.detail.objects || []).find((o) => o.id === zd.id);
      if ((zd.type === 'vertex' || zd.type === 'move') && zd.moved && z) {
        protectObj(z.id);
        var sentPts = z.points.map(function (p) { return { x: p.x, y: p.y }; });
        try {
          await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y });
          // Kontroll-Lesen FRISCH vom Server -> beweist unabhängig von der Speicher-Antwort, ob wirklich gespeichert wurde
          try {
            var srvList = await Api.getObjects(state.detail.id);
            var srvObj = (srvList || []).find(function (o) { return String(o.id) === String(z.id); });
            if (srvObj && !pointsMatch(srvObj.points, sentPts)) {
              toast('⚠ Server speichert die Verschiebung NICHT – Kontroll-Lesen ergab die alte Position (Backend/DB)');
            }
          } catch (e3) { /* Kontroll-Lesen ist optional */ }
        } catch (e2) { toast('Speichern fehlgeschlagen (' + (e2 && (e2.status || e2.message) || '?') + ')'); }
        renderEditor(); return;
      }
      // Klick ohne Bewegung: Auswahl bzw. Doppelklick (zeitbasiert, re-render-fest)
      if (z) {
        const now = Date.now();
        const dbl = state.lastZoneUp && state.lastZoneUp.id === z.id && (now - state.lastZoneUp.t) < 400;
        state.lastZoneUp = dbl ? null : { id: z.id, t: now };
        if (dbl) { if (z.symbolType === 'mf_route') openRouteModal(z.id); else if (z.symbolType === 'sb_zone') openZoneAssignModal(z.id); else if (z.symbolType === 'fg_zone') openTagModal(z.id); return; }
        if (state.selectedZone !== z.id) { state.selectedZone = z.id; renderEditor(); }
        return;
      }
      return;
    }
    if (!dragMove) return;
    const dm = dragMove; dragMove = null;
    if (dm.el) dm.el.style.cursor = '';
    if (dm.moved && dm.nx != null) {
      const o = (state.detail.objects || []).find((x) => x.id === dm.oid);
      if (o) {
        o.x = dm.nx; o.y = dm.ny;
        protectObj(o.id); try { await Api.updateObject(o.id, { x: dm.nx, y: dm.ny }); } catch (e) { toast('Verschieben nicht gespeichert'); }
        if (techInfo(o)) renderEditor();
      }
    }
  }

  const ROBOT_RISK = ['CK (Hohes Risiko)', 'K (Hohes Risiko, nachbar SB)', 'C (Geringes Risiko)', 'BS (Bedienerschutz)', 'T (sichere Werkzeugumschaltung)', 'Kein Risiko'];
  const ROBOT_TECH = ['Punkt Schweißen - Stahl', 'MIG-Schweißen', 'Bolzen-Schweißen', 'Bolzen-Schweißen (Rotationskopf)', 'Bolzen (stationär)', 'Kleben', 'Laser', 'Halbholstanznieten', 'Fließlochschrauben', 'Inline messen'];
  // Farbe des Roboter-Icons je nach gewählter Safe-Funktion (rot = hohes Risiko … grün = kein Risiko)
  const ROBOT_RISK_COLOR = {
    'CK (Hohes Risiko)': '#DC2626',
    'K (Hohes Risiko, nachbar SB)': '#EA580C',
    'C (Geringes Risiko)': '#CA8A04',
    'BS (Bedienerschutz)': '#2563EB',
    'T (sichere Werkzeugumschaltung)': '#0D9488',
    'Kein Risiko': '#16A34A',
  };
  // Anzeigefarbe eines platzierten Symbols: Roboter richtet sich nach der Safe-Funktion, sonst Ebenenfarbe.
  function objIconColor(o) {
    if (o.symbolType === 'robot') {
      const sf = (o.metatags || []).find((m) => m.position === 1 || m.label === 'Safe Funktion');
      if (sf && ROBOT_RISK_COLOR[sf.value]) return ROBOT_RISK_COLOR[sf.value];
    }
    return o.color;
  }

  function tagFieldSelect(id, label, opts, val) {
    const list = (val && !opts.includes(val)) ? [val].concat(opts) : opts;
    const options = '<option value="">— bitte wählen —</option>'
      + list.map((o) => '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    return '<div class="m-field"><label>' + esc(label) + '</label><select id="' + id + '" data-label="' + esc(label) + '">' + options + '</select></div>';
  }
  function tagFieldInput(id, label, val) {
    return '<div class="m-field"><label>' + esc(label) + '</label><input id="' + id + '" data-label="" placeholder="frei belegbar …" value="' + esc(val) + '"></div>';
  }

  function openTagModal(oid) {
    const o = (state.detail.objects || []).find((x) => x.id === oid); if (!o) return;
    o.metatags = o.metatags || [];
    state.modalObjId = oid;
    const L = layerById(o.layerId);
    const sym = $('mSym'); sym.style.color = o.color; sym.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24">' + (SYM[o.symbolType] || SYM.box) + '</svg>';
    $('mTitle').textContent = o.name;
    $('mSub').textContent = L ? (L.code + ' · ' + L.name) : '';
    const v1 = (o.metatags.find((m) => m.position === 1) || {}).value || '';
    const v2 = (o.metatags.find((m) => m.position === 2) || {}).value || '';
    const pt = processTypeBySym(o.symbolType);
    if (pt) {
      const desc = (key) => (o.metatags.find((m) => m.label === key) || {}).value || '';
      const fieldFor = (kind, name) => {
        const key = kind + ' – ' + name;
        const ic = STATE_ICONS[name] ? '<img class="pt-ic" src="' + STATE_ICONS[name] + '" alt="">' : '<span class="pt-ic pt-ic-none"></span>';
        return '<div class="m-field pt-state"><label>' + ic + '<span class="pt-nm">' + esc(name) + '</span><span class="pt-kind ' + (kind === 'Pflicht' ? 'req' : 'opt') + '">' + kind + '</span></label>'
          + '<input data-state="' + esc(key) + '" placeholder="Wann tritt das ein? …" value="' + esc(desc(key)) + '"></div>';
      };
      const groups = ptStateGroups(pt);
      const sectionFor = (g, withHeader) => {
        const items = g.muss.map((n) => fieldFor('Pflicht', n)).concat(g.opt.map((n) => fieldFor('Optional', n)));
        if (!items.length) return '';
        return (withHeader ? '<div class="pt-sec">' + esc(g.group) + '</div>' : '') + items.join('');
      };
      const panelZ = sectionFor(groups[0], false) || '<div class="pt-empty">Keine Betriebszustände für diesen Prozesstyp.</div>';
      const panelM = (sectionFor(groups[1], true) + sectionFor(groups[2], true)) || '<div class="pt-empty">Keine Meldungen/Betriebsdaten für diesen Prozesstyp.</div>';
      $('mBody').innerHTML = '<div class="pt-meta"><div class="pt-meta-row"><span>Prozesstyp</span><b>' + esc(pt.ptyp) + '</b></div>'
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
      $('mBody').innerHTML = tagFieldSelect('mTag1', 'Safe Funktion', ROBOT_RISK, v1) + tagFieldSelect('mTag2', 'Technologie', ROBOT_TECH, v2);
    } else {
      $('mBody').innerHTML = tagFieldInput('mTag1', 'Metatag 1', v1) + tagFieldInput('mTag2', 'Metatag 2', v2);
    }
    $('tagModal').style.display = 'flex';
    setTimeout(() => { const f = $('mBody').querySelector('input,select'); if (f) { f.focus(); if (f.tagName === 'INPUT') f.select(); } }, 60);
  }
  async function saveTags() {
    const o = (state.detail.objects || []).find((x) => x.id === state.modalObjId);
    if (!o) { closeTagModal(); return; }
    const pt = processTypeBySym(o.symbolType);
    let metatags;
    if (pt) {
      metatags = [
        { position: 1, label: 'Prozesstyp', value: pt.ptyp },
        { position: 2, label: 'Hardware · Art', value: pt.hwart },
      ];
      let pos = 3;
      $('mBody').querySelectorAll('input[data-state]').forEach((inp) => {
        metatags.push({ position: pos++, label: inp.getAttribute('data-state'), value: inp.value.trim() });
      });
    } else {
      const e1 = $('mTag1'), e2 = $('mTag2');
      const t1 = (e1 ? e1.value : '').trim(), t2 = (e2 ? e2.value : '').trim();
      const l1 = e1 ? (e1.getAttribute('data-label') || '') : '', l2 = e2 ? (e2.getAttribute('data-label') || '') : '';
      metatags = [];
      if (t1) metatags.push(l1 ? { position: 1, label: l1, value: t1 } : { position: 1, value: t1 });
      if (t2) metatags.push(l2 ? { position: 2, label: l2, value: t2 } : { position: 2, value: t2 });
    }
    protectObj(o.id); try { const upd = await Api.setMetatags(o.id, metatags); o.metatags = (upd && upd.metatags) || metatags; } catch (e) { toast('Metatags nicht gespeichert'); }
    closeTagModal(); toast('Metatags gespeichert'); renderEditor();
  }
  async function deletePlaced() {
    const oid = state.modalObjId; const o = (state.detail.objects || []).find((x) => x.id === oid);
    closeTagModal(); if (!o) return;
    try { await Api.deleteObject(oid); } catch (e) { toast('Löschen fehlgeschlagen'); return; }
    state.detail.objects = state.detail.objects.filter((x) => x.id !== oid);
    toast('Objekt gelöscht'); renderEditor();
  }
  async function deleteObjectById(oid) {
    try { await Api.deleteObject(oid); } catch (e) { toast('Löschen fehlgeschlagen'); return; }
    state.detail.objects = state.detail.objects.filter((x) => x.id !== oid);
    toast('Objekt gelöscht'); renderEditor();
  }
  function closeTagModal() { $('tagModal').style.display = 'none'; state.modalObjId = null; }

  function triggerUpload() { $('layoutFile').click(); }
  async function onLayoutFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Bitte eine Bilddatei wählen'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('Bild zu groß (max. 8 MB)'); return; }
    if (!state.detail) { toast('Bitte zuerst eine Anlage wählen'); return; }
    toast('Layout wird hochgeladen …');
    try {
      await Api.uploadLayout(state.detail.id, f);
      state.detail.hasLayout = true;
      state.layoutBlobStation = null;
      await ensureLayoutBlob();
      toast('Layout hochgeladen');
      if (state.view === 'editor') renderEditor(); else renderDetail();
    } catch (e2) { toast('Upload fehlgeschlagen: ' + e2.message); }
  }

  async function exportFile(kind) {
    try {
      const res = await Api.raw('/stations/' + state.detail.id + '/export.' + kind);
      if (!res.ok) { toast('Export fehlgeschlagen'); return; }
      const url = URL.createObjectURL(await res.blob());
      if (kind === 'pdf') { window.open(url, '_blank'); }
      else { const a = document.createElement('a'); a.href = url; a.download = (state.detail.anlagenname || 'anlage').replace(/[^A-Za-z0-9_\-]+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast('Export fehlgeschlagen'); }
  }

  // Editor-spezifische Content-Handler (Drag & Drop, Move, Doppelklick)
  function onContentDragStart(e) {
    const p = e.target.closest('.pal-item'); if (!p) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ sym: p.getAttribute('data-sym'), name: p.getAttribute('data-name'), color: p.getAttribute('data-color') }));
    e.dataTransfer.effectAllowed = 'copy';
  }
  function onContentDragOver(e) { const doc = e.target.closest('#canvasDoc'); if (doc) { e.preventDefault(); doc.classList.add('drop-hi'); } }
  function onContentDragLeave(e) { const doc = e.target.closest('#canvasDoc'); if (doc) doc.classList.remove('drop-hi'); }
  function onContentDrop(e) {
    if (!canEdit()) return;
    const doc = e.target.closest('#canvasDoc'); if (!doc) return;
    e.preventDefault(); doc.classList.remove('drop-hi');
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return; }
    if (data && data.sym) placeFromDrop(e.clientX, e.clientY, data.sym, data.name, data.color);
  }
  function onContentDblClick(e) {
    if (!canEdit() || state.drawZone) return;
    const pl = e.target.closest('.placed');
    if (pl) { openTagModal(pl.getAttribute('data-obj')); }
  }

  function openZoneAssignModal(zoneId) {
    closeZoneModal();
    const z = (state.detail.objects || []).find((o) => o.id === zoneId); if (!z) return;
    const plcs = state.detail.plcs || [];
    const cur = z.plcConfigId || null;
    const rows = plcs.length
      ? plcs.map((p) => '<button class="za-row ' + (cur === p.id ? 'sel' : '') + '" data-plc="' + p.id + '" data-color="' + esc(p.color) + '">'
        + '<span class="za-swatch" style="background:' + esc(p.color) + '"></span><span class="za-name">' + esc(p.name) + '</span>'
        + (cur === p.id ? '<span class="za-check">✓</span>' : '') + '</button>').join('')
      : '<div class="za-empty">Für diese Anlage sind noch keine SPS angelegt. Lege sie in der Detailansicht an (EDITIEREN › SPS hinzufügen).</div>';
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card">'
      + '<div class="za-head"><div><div class="za-title">Schutzbereich zuordnen</div><div class="za-sub">' + esc(z.name) + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen">×</button></div>'
      + '<div class="za-body">' + rows + '</div>'
      + '<div class="za-foot"><button class="btn ' + (cur ? 'del-btn' : '') + '" data-za="none">Keine Zuordnung</button>'
      + '<button class="btn" data-za="close">Schließen</button></div></div></div>';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('zaBackdrop');
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'zaBackdrop') { closeZoneModal(); return; }
      const za = ev.target.closest('[data-za]');
      if (za) { const a = za.getAttribute('data-za'); if (a === 'close') { closeZoneModal(); } else if (a === 'none') { assignZone(zoneId, null, null); } return; }
      const row = ev.target.closest('.za-row');
      if (row) assignZone(zoneId, row.getAttribute('data-plc'), row.getAttribute('data-color'));
    });
  }
  function closeZoneModal() { const b = document.getElementById('zaBackdrop'); if (b) b.remove(); }
  async function assignZone(zoneId, plcId, plcColor) {
    const z = (state.detail.objects || []).find((o) => o.id === zoneId); if (!z) { closeZoneModal(); return; }
    const L = layerById(z.layerId);
    const color = plcId ? (plcColor || z.color) : (L ? L.color : z.color);
    try {
      protectObj(zoneId);
      await Api.updateObject(zoneId, { plcConfigId: plcId, color });
      z.plcConfigId = plcId || null; z.color = color;
      toast(plcId ? 'SPS zugeordnet' : 'Zuordnung entfernt');
    } catch (e) { toast('Zuordnung fehlgeschlagen'); }
    closeZoneModal(); renderEditor();
  }

  function openRouteModal(routeId) {
    closeZoneModal();
    const z = (state.detail.objects || []).find((o) => o.id === routeId); if (!z) return;
    const art = routeArt(z);
    const mat = routeMaterial(z);
    const bez = ((z.metatags || []).find((m) => m.label === 'Bezeichnung') || {}).value || '';
    const col = (layerById(z.layerId) || {}).color || '#0FA47F';
    const opts = '<option value="">— bitte wählen —</option>'
      + ROUTE_ARTS.map((a) => '<option value="' + esc(a) + '"' + (a === art ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    const matOpts = '<option value="">— ohne —</option>'
      + FLOW_TYPES.map((f) => '<option value="' + esc(f.name) + '"' + (f.name === mat ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card">'
      + '<div class="za-head"><div><div class="za-title">Förderweg</div><div class="za-sub">' + esc(z.name) + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen">×</button></div>'
      + '<div class="za-body" style="display:flex;flex-direction:column;gap:12px;padding:16px">'
      + '<div class="m-field"><label>Materialfluss-Typ (Farbe)</label><select id="rfMat">' + matOpts + '</select></div>'
      + '<div class="m-field"><label>Förderart (Linienstil)</label><select id="rfArt">' + opts + '</select></div>'
      + '<div class="m-field"><label>Bezeichnung / Teil</label><input id="rfBez" placeholder="z. B. Karosserie-Seitenteil" value="' + esc(bez) + '"></div>'
      + '<button class="btn" data-za="reverse" style="justify-content:center">⇄ Flussrichtung umkehren</button>'
      + '</div>'
      + '<div class="za-foot"><button class="btn" data-za="close">Abbrechen</button>'
      + '<button class="btn" data-za="save" style="background:' + esc(col) + ';border-color:' + esc(col) + ';color:#fff">Speichern</button></div></div></div>';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('zaBackdrop');
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'zaBackdrop') { closeZoneModal(); return; }
      const za = ev.target.closest('[data-za]'); if (!za) return;
      const a = za.getAttribute('data-za');
      if (a === 'close') closeZoneModal();
      else if (a === 'reverse') reverseRoute(routeId);
      else if (a === 'save') saveRoute(routeId);
    });
    setTimeout(() => { const s = document.getElementById('rfArt'); if (s) s.focus(); }, 60);
  }
  async function saveRoute(routeId) {
    const z = (state.detail.objects || []).find((o) => o.id === routeId); if (!z) { closeZoneModal(); return; }
    const art = (document.getElementById('rfArt') || {}).value || '';
    const mat = (document.getElementById('rfMat') || {}).value || '';
    const bez = ((document.getElementById('rfBez') || {}).value || '').trim();
    const metatags = [];
    if (art) metatags.push({ position: 1, label: 'Förderart', value: art });
    if (bez) metatags.push({ position: 2, label: 'Bezeichnung', value: bez });
    if (mat) metatags.push({ position: 3, label: 'Materialart', value: mat });
    protectObj(z.id);
    try {
      const upd = await Api.setMetatags(z.id, metatags); z.metatags = (upd && upd.metatags) || metatags;
      // Farbe aus dem Materialfluss-Typ übernehmen
      const nc = flowColor(mat);
      if (nc && nc !== z.color) { await Api.updateObject(z.id, { color: nc }); z.color = nc; }
      toast('Förderweg gespeichert');
    }
    catch (e) { toast('Speichern fehlgeschlagen'); }
    closeZoneModal(); renderEditor();
  }
  async function reverseRoute(routeId) {
    const z = (state.detail.objects || []).find((o) => o.id === routeId);
    if (!z || !z.points || z.points.length < 2) return;
    z.points = z.points.slice().reverse();
    protectObj(z.id);
    try { await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }); }
    catch (e) { toast('Richtung nicht gespeichert'); }
    toast('Flussrichtung umgekehrt'); renderEditor();
  }

  function onContentPointerDown(e) {
    if (!canEdit()) return;
    // Technologie-Blase greifen
    const td = e.target.closest('[data-techdrag]');
    if (td) { e.preventDefault(); state.techDrag = { id: td.getAttribute('data-techdrag'), moved: false }; try { td.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    // Stützpunkt eines Schutzbereichs greifen
    const v = e.target.closest('.zone-vertex');
    if (v) {
      e.preventDefault();
      state.zoneDrag = { type: 'vertex', id: v.getAttribute('data-zone'), idx: +v.getAttribute('data-vidx'), moved: false };
      try { v.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    // Symbol verschieben
    const pl = e.target.closest('.placed');
    if (pl) { startMove(e, pl.getAttribute('data-obj')); return; }
    // Schutzbereich auswählen / verschieben (nicht im Zeichenmodus)
    if (!state.drawZone) {
      const doc = e.target.closest('#canvasDoc');
      if (doc) {
        const r = doc.getBoundingClientRect();
        const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
        const z = zoneAt(x, y);
        if (z) {
          if (z.id === state.selectedZone) {
            state.zoneDrag = { type: 'move', id: z.id, sx: x, sy: y, moved: false, orig: z.points.map((p) => ({ x: p.x, y: p.y })) };
          } else {
            state.zoneDrag = { type: 'select', id: z.id, sx: x, sy: y, moved: false };
          }
          try { doc.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        } else if (state.selectedZone) {
          state.selectedZone = null; renderEditor();
        }
      }
    }
  }

  function onZoneDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    const z = (state.detail.objects || []).find((o) => o.id === state.zoneDrag.id); if (!z) return;
    if (state.zoneDrag.type === 'vertex') {
      z.points[state.zoneDrag.idx] = { x, y }; state.zoneDrag.moved = true; updateZoneDom(z);
    } else if (state.zoneDrag.type === 'move') {
      const dx = x - state.zoneDrag.sx, dy = y - state.zoneDrag.sy;
      if (!state.zoneDrag.moved && Math.hypot(dx * r.width, dy * r.height) < 4) return;
      state.zoneDrag.moved = true;
      z.points = state.zoneDrag.orig.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
      updateZoneDom(z);
    } else if (state.zoneDrag.type === 'select') {
      const dx = x - state.zoneDrag.sx, dy = y - state.zoneDrag.sy;
      if (Math.hypot(dx * r.width, dy * r.height) >= 4) state.zoneDrag.moved = true;
    }
  }

  function zoneColor(z) {
    if (z.plcConfigId) {
      const p = (state.detail.plcs || []).find((x) => x.id === z.plcConfigId);
      if (p && p.color) return p.color;
    }
    return z.color;
  }

  function zoneAt(x, y) {
    const visible = visibleMap();
    const shapes = (state.detail.objects || []).filter((o) => isShape(o) && o.points && visible[o.layerId] !== false);
    for (let i = shapes.length - 1; i >= 0; i--) {
      const o = shapes[i];
      if (o.symbolType === 'mf_route') { if (pointNearRoute(o, x, y)) return o; }
      else if (pointInZone(o, x, y)) return o;
    }
    return null;
  }
  function pointInZone(z, x, y) {
    const p = z.points; if (!p || p.length < 3) return false;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
      const denom = (yj - yi) || 1e-9;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / denom + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  async function finishZone() {
    if (!state.drawZone || state.zoneDraft.length < 3) { toast('Mindestens 3 Stützpunkte nötig'); return; }
    const pts = state.zoneDraft.slice();
    const L = layerById(state.activeLayer);
    const kind = zoneKind(L);
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === kind.type).length + 1).padStart(2, '0');
    state.drawZone = false; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: kind.prefix + '_' + num, symbolType: kind.type, color: L.color, x: pts[0].x, y: pts[0].y, points: pts });
      state.detail.objects.push(obj); state.selectedZone = obj.id; protectObj(obj.id);
      toast(kind.noun + ' erstellt');
    } catch (e) { toast('Erstellen fehlgeschlagen: ' + e.message); }
    renderEditor();
  }

  async function finishRoute() {
    if (state.drawShape !== 'route' || state.zoneDraft.length < 2) { toast('Mindestens 2 Wegpunkte nötig'); return; }
    const pts = state.zoneDraft.slice();
    const L = layerById(state.activeLayer);
    const ft = FLOW_TYPES[state.flowType] || FLOW_TYPES[0];
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === 'mf_route').length + 1).padStart(2, '0');
    state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: 'Förderweg_' + num, symbolType: 'mf_route', color: ft.color, x: pts[0].x, y: pts[0].y, points: pts });
      obj.metatags = obj.metatags || [];
      state.detail.objects.push(obj); state.selectedZone = obj.id; protectObj(obj.id);
      // Materialfluss-Typ als Metatag hinterlegen (Farbe folgt daraus)
      try { const upd = await Api.setMetatags(obj.id, [{ position: 3, label: 'Materialart', value: ft.name }]); obj.metatags = (upd && upd.metatags) || obj.metatags; } catch (e2) { /* Farbe ist schon gesetzt */ }
      toast('Förderweg „' + ft.name + '" erstellt');
    } catch (e) { toast('Erstellen fehlgeschlagen: ' + e.message); }
    renderEditor();
  }

  async function deleteSelectedZone() {
    const id = state.selectedZone; const z = (state.detail.objects || []).find((o) => o.id === id);
    if (!z) return;
    const isRoute = z.symbolType === 'mf_route';
    state.selectedZone = null;
    try { await Api.deleteObject(id); } catch (e) { toast('Löschen fehlgeschlagen'); return; }
    state.detail.objects = state.detail.objects.filter((o) => o.id !== id);
    toast(isRoute ? 'Förderweg gelöscht' : 'Schutzbereich gelöscht'); renderEditor();
  }

  function updateZoneDom(z) {
    const el = document.getElementById('zone-poly-' + z.id);
    if (el) {
      if (z.symbolType === 'mf_route') {
        const cv = buildRouteCurve(z.points); el.setAttribute('d', cv.d);
        const a = document.getElementById('route-arrow-' + z.id);
        if (a) a.setAttribute('d', routeArrowFromTan(z.points[z.points.length - 1], cv.tan, docAspect()));
      } else {
        el.setAttribute('points', z.points.map((p) => (p.x * 100) + ',' + (p.y * 100)).join(' '));
      }
    }
    z.points.forEach((p, i) => {
      const h = document.querySelector('.zone-vertex[data-zone="' + z.id + '"][data-vidx="' + i + '"]');
      if (h) { h.style.left = (p.x * 100) + '%'; h.style.top = (p.y * 100) + '%'; }
    });
  }
  function updateDraftDom() {
    const el = document.getElementById('zone-draft'); if (!el) return;
    if (state.drawShape === 'route') {
      const dpull = state.zoneCursor ? state.zoneDraft.concat([state.zoneCursor]) : state.zoneDraft;
      el.setAttribute('d', buildRouteCurve(dpull).d);
    } else {
      const dpts = state.zoneDraft.map((p) => (p.x * 100) + ',' + (p.y * 100));
      if (state.zoneCursor) dpts.push((state.zoneCursor.x * 100) + ',' + (state.zoneCursor.y * 100));
      el.setAttribute('points', dpts.join(' '));
    }
  }

  function onEditorKey(e) {
    if (state.view !== 'editor' || !canEdit()) return;
    const t = document.activeElement;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (state.drawZone) {
      if (e.key === 'Enter') { e.preventDefault(); state.drawShape === 'route' ? finishRoute() : finishZone(); }
      else if (e.key === 'Escape') { e.preventDefault(); state.drawZone = false; state.zoneDraft = []; state.zoneCursor = null; renderEditor(); }
      else if (e.key === 'Backspace' && !inField) { e.preventDefault(); state.zoneDraft.pop(); renderEditor(); }
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && state.selectedZone && !inField) {
      const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone);
      if (z && z.symbolType === 'mf_route') { e.preventDefault(); reverseRoute(z.id); return; }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedZone && !inField) {
      e.preventDefault(); deleteSelectedZone();
    }
  }

  /* ================= Benutzerverwaltung (admin) ================= */
  const ROLE_LABEL = { admin: 'Administrator', editor: 'Editor', viewer: 'Betrachter' };
  function roleLabel(r) { return ROLE_LABEL[r] || r; }

  const DEFAULT_LAYERS = [
    { code: 'L0.0', name: 'Funktionsgruppen' }, { code: 'L1.0', name: 'Materialfluss' },
    { code: 'L2.0', name: 'Steuerungstechnik' }, { code: 'L3.0', name: 'Saferobot / Technologie' },
    { code: 'L4.0', name: 'Antriebstechnik / Ident' }, { code: 'L5.0', name: 'Not-Halt' }, { code: 'L6.0', name: 'Sicherheitslayout' },
  ];
  async function openAdmin() {
    if (!state.isAdmin) return;
    state.admin = { tab: 'users', groups: [], users: [], werke: [], layers: [], userForm: null, groupForm: null, pwForm: null, loading: true };
    renderAdmin();
    try {
      const [groups, users, werke] = await Promise.all([Api.getGroups(), Api.getUsers(), Api.getWerke()]);
      state.admin.groups = groups; state.admin.users = users; state.admin.werke = werke;
    } catch (e) { toast('Verwaltung konnte nicht geladen werden'); }
    // Ebenen für die Sichtbarkeits-Konfiguration (Backend-Endpunkt, sonst Fallback auf Standard-Ebenen)
    try { const ls = await Api.getLayers(); state.admin.layers = (ls && ls.length) ? ls : DEFAULT_LAYERS; }
    catch (e) { state.admin.layers = (state.detail && state.detail.layers && state.detail.layers.length) ? state.detail.layers.map((l) => ({ code: l.code, name: l.name })) : DEFAULT_LAYERS; }
    state.admin.loading = false;
    renderAdmin();
  }
  function closeAdmin() { state.admin = null; $('adminOverlay').innerHTML = ''; }

  function renderAdmin() {
    const a = state.admin;
    if (!a) { $('adminOverlay').innerHTML = ''; return; }
    const tabBtn = (id, label) => '<button class="adm-tab ' + (a.tab === id ? 'active' : '') + '" data-adm="tab" data-tab="' + id + '">' + label + '</button>';
    let body;
    if (a.loading) body = '<div class="adm-loading">Lädt …</div>';
    else if (a.pwForm) body = renderPwForm(a);
    else if (a.tab === 'users') body = a.userForm ? renderUserForm(a) : renderAdminUsers(a);
    else if (a.tab === 'layers') body = a.layerForm ? renderLayerForm(a) : renderAdminLayers(a);
    else body = a.groupForm ? renderGroupForm(a) : renderAdminGroups(a);
    $('adminOverlay').innerHTML = '<div class="adm-backdrop" id="admBackdrop"><div class="adm-card">'
      + '<div class="adm-head"><div class="adm-title">Verwaltung</div>'
      + '<div class="adm-tabs">' + tabBtn('users', 'Benutzer') + tabBtn('groups', 'Gruppen') + tabBtn('layers', 'Ebenen') + '</div>'
      + '<button class="adm-x" data-adm="close" title="Schließen">×</button></div>'
      + '<div class="adm-body">' + body + '</div></div></div>';
  }

  function renderAdminUsers(a) {
    const rows = a.users.length ? a.users.map((u) =>
      '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td>'
      + '<td>' + (u.group ? esc(u.group.name) + ' <span class="adm-role r-' + u.group.role + '">' + roleLabel(u.group.role) + '</span>' : '—') + '</td>'
      + '<td>' + (u.active ? '<span class="adm-ok">aktiv</span>' : '<span class="adm-off">deaktiviert</span>') + '</td>'
      + '<td class="adm-actions">'
      + '<button data-adm="user-edit" data-id="' + u.id + '" title="Bearbeiten"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg></button>'
      + '<button data-adm="user-pw" data-id="' + u.id + '" title="Passwort zurücksetzen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l2 2M14 9l2 2"/></svg></button>'
      + '<button class="del" data-adm="user-del" data-id="' + u.id + '" title="Löschen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</td></tr>').join('') : '<tr><td colspan="5" class="adm-empty">Noch keine Benutzer.</td></tr>';
    return '<div class="adm-toolbar"><button class="btn primary" data-adm="user-new">+ Benutzer hinzufügen</button></div>'
      + '<table class="adm-table"><thead><tr><th>Name</th><th>E-Mail</th><th>Gruppe</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderUserForm(a) {
    const f = a.userForm, isNew = !f.id;
    const opts = a.groups.map((g) => '<option value="' + g.id + '"' + (f.groupId === g.id ? ' selected' : '') + '>' + esc(g.name) + ' · ' + roleLabel(g.role) + '</option>').join('');
    return '<div class="adm-form"><h3>' + (isNew ? 'Neuer Benutzer' : 'Benutzer bearbeiten') + '</h3>'
      + '<label>Name</label><input id="admUName" value="' + esc(f.name || '') + '">'
      + '<label>E-Mail</label><input id="admUEmail" type="email" value="' + esc(f.email || '') + '"' + (isNew ? '' : ' disabled') + '>'
      + (isNew ? '<label>Startpasswort</label><input id="admUPass" type="text" placeholder="mind. 8 Zeichen">' : '')
      + '<label>Gruppe</label><select id="admUGroup">' + (opts || '<option value="">— keine Gruppen —</option>') + '</select>'
      + (isNew ? '' : '<label class="adm-check"><input type="checkbox" id="admUActive"' + (f.active ? ' checked' : '') + '> aktiv</label>')
      + '<div class="adm-msg" id="admMsg"></div>'
      + '<div class="adm-form-actions"><button class="btn" data-adm="form-cancel">Abbrechen</button><button class="btn primary" data-adm="user-save">Speichern</button></div></div>';
  }

  function renderPwForm(a) {
    const f = a.pwForm;
    return '<div class="adm-form"><h3>Passwort zurücksetzen</h3><p class="adm-sub">' + esc(f.name) + '</p>'
      + '<label>Neues Passwort</label><input id="admPw" type="text" placeholder="mind. 8 Zeichen">'
      + '<div class="adm-msg" id="admMsg"></div>'
      + '<div class="adm-form-actions"><button class="btn" data-adm="form-cancel">Abbrechen</button><button class="btn primary" data-adm="pw-save">Setzen</button></div></div>';
  }

  function renderAdminGroups(a) {
    const rows = a.groups.length ? a.groups.map((g) =>
      '<tr><td>' + esc(g.name) + '</td><td><span class="adm-role r-' + g.role + '">' + roleLabel(g.role) + '</span></td>'
      + '<td>' + (g.allWerke ? '<i>alle Werke</i>' : (g.werke.length ? g.werke.map((w) => esc(w.name)).join(', ') : '—')) + '</td>'
      + '<td>' + g.userCount + '</td>'
      + '<td class="adm-actions">'
      + '<button data-adm="group-edit" data-id="' + g.id + '" title="Bearbeiten"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg></button>'
      + '<button class="del" data-adm="group-del" data-id="' + g.id + '" title="Löschen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</td></tr>').join('') : '<tr><td colspan="5" class="adm-empty">Noch keine Gruppen.</td></tr>';
    return '<div class="adm-toolbar"><button class="btn primary" data-adm="group-new">+ Gruppe hinzufügen</button></div>'
      + '<table class="adm-table"><thead><tr><th>Name</th><th>Rolle</th><th>Werke</th><th>Mitglieder</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderLayerForm(a) {
    const f = a.layerForm, isNew = !f.id;
    const cats = (f.categories || []).join('\n');
    return '<div class="adm-form"><h3>' + (isNew ? 'Neue Ebene' : 'Ebene bearbeiten') + '</h3>'
      + '<label>Name</label><input id="admLName" value="' + esc(f.name || '') + '" placeholder="z. B. Qualitätssicherung">'
      + '<div class="adm-hint">Der Name steuert das Werkzeug: „Materialfluss" = Förderweg, „Funktionsgruppen" = FG-Polygon, „Saferobot / Technologie" = Roboter-Palette. Andere Namen erhalten das Schutzbereich-Polygon.</div>'
      + '<label>Code</label><input id="admLCode" value="' + esc(f.code || '') + '" placeholder="z. B. L7.0">'
      + '<label>Farbe</label><div class="adm-color"><input type="color" id="admLColor" value="' + esc(f.color || '#0065A5') + '"><input id="admLColorHex" value="' + esc(f.color || '#0065A5') + '" maxlength="7"></div>'
      + '<label>Kategorien (eine pro Zeile, optional)</label><textarea id="admLCats" rows="3" placeholder="Förderwege&#10;Quellen &amp; Senken">' + esc(cats) + '</textarea>'
      + '<div class="adm-msg" id="admMsg"></div>'
      + '<div class="adm-form-actions"><button class="btn" data-adm="form-cancel">Abbrechen</button><button class="btn primary" data-adm="layer-save">Speichern</button></div></div>';
  }

  function renderAdminLayers(a) {
    const layers = (a.layers || []).slice().sort((x, y) => (y.sortOrder || 0) - (x.sortOrder || 0)); // oben = höchste sort_order
    const rows = layers.length ? layers.map((l, i) =>
      '<tr><td><span class="adm-lswatch" style="background:' + esc(l.color) + '"></span><span class="adm-lcode">' + esc(l.code) + '</span></td>'
      + '<td>' + esc(l.name) + '</td>'
      + '<td>' + ((l.categories && l.categories.length) ? l.categories.map((c) => esc(c.name)).join(', ') : '—') + '</td>'
      + '<td class="adm-actions">'
      + '<button data-adm="layer-up" data-id="' + l.id + '" title="Nach oben"' + (i === 0 ? ' disabled' : '') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>'
      + '<button data-adm="layer-down" data-id="' + l.id + '" title="Nach unten"' + (i === layers.length - 1 ? ' disabled' : '') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>'
      + '<button data-adm="layer-edit" data-id="' + l.id + '" title="Bearbeiten"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg></button>'
      + '<button class="del" data-adm="layer-del" data-id="' + l.id + '" title="Löschen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</td></tr>').join('') : '<tr><td colspan="4" class="adm-empty">Noch keine Ebenen.</td></tr>';
    return '<div class="adm-toolbar"><button class="btn primary" data-adm="layer-new">+ Ebene hinzufügen</button></div>'
      + '<table class="adm-table"><thead><tr><th>Code</th><th>Name</th><th>Kategorien</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderGroupForm(a) {
    const f = a.groupForm, isNew = !f.id;
    const roleOpts = ['viewer', 'editor', 'admin'].map((r) => '<option value="' + r + '"' + (f.role === r ? ' selected' : '') + '>' + roleLabel(r) + '</option>').join('');
    const werkChecks = a.werke.length ? a.werke.map((w) => '<label class="adm-werk"><input type="checkbox" class="admWerk" value="' + w.id + '"' + (f.werkIds.has(w.id) ? ' checked' : '') + (f.allWerke ? ' disabled' : '') + '> ' + esc(w.name) + '</label>').join('') : '<div class="adm-empty">Keine Werke vorhanden.</div>';
    const layers = a.layers || [];
    const layerChecks = layers.length ? layers.map((l) => '<label class="adm-werk"><input type="checkbox" class="admLayer" value="' + esc(l.code) + '"' + (f.layerCodes.has(l.code) ? ' checked' : '') + (f.allLayers ? ' disabled' : '') + '> <span class="adm-lcode">' + esc(l.code) + '</span> ' + esc(l.name) + '</label>').join('') : '<div class="adm-empty">Keine Ebenen vorhanden.</div>';
    return '<div class="adm-form"><h3>' + (isNew ? 'Neue Gruppe' : 'Gruppe bearbeiten') + '</h3>'
      + '<label>Name</label><input id="admGName" value="' + esc(f.name || '') + '">'
      + '<label>Rolle</label><select id="admGRole">' + roleOpts + '</select>'
      + '<label class="adm-check"><input type="checkbox" id="admGAll" data-adm="group-allwerke"' + (f.allWerke ? ' checked' : '') + '> Alle Werke sichtbar</label>'
      + '<label>Sichtbare Werke</label><div class="adm-werke">' + werkChecks + '</div>'
      + '<label class="adm-check"><input type="checkbox" id="admGAllLayers" data-adm="group-alllayers"' + (f.allLayers ? ' checked' : '') + '> Alle Ebenen sichtbar</label>'
      + '<label>Sichtbare Ebenen</label><div class="adm-werke">' + layerChecks + '</div>'
      + '<div class="adm-msg" id="admMsg"></div>'
      + '<div class="adm-form-actions"><button class="btn" data-adm="form-cancel">Abbrechen</button><button class="btn primary" data-adm="group-save">Speichern</button></div></div>';
  }

  function onAdminClick(e) {
    const a = state.admin; if (!a) return;
    if (e.target.id === 'admBackdrop') { closeAdmin(); return; }
    const el = e.target.closest('[data-adm]'); if (!el) return;
    const act = el.getAttribute('data-adm');
    if (act === 'close') { closeAdmin(); }
    else if (act === 'tab') { a.tab = el.getAttribute('data-tab'); a.userForm = a.groupForm = a.pwForm = a.layerForm = null; renderAdmin(); }
    else if (act === 'form-cancel') { a.userForm = a.groupForm = a.pwForm = a.layerForm = null; renderAdmin(); }
    else if (act === 'user-new') { a.userForm = { name: '', email: '', password: '', groupId: (a.groups[0] || {}).id || '' }; renderAdmin(); }
    else if (act === 'user-edit') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u) { a.userForm = { id: u.id, name: u.name, email: u.email, groupId: u.group ? u.group.id : '', active: u.active }; renderAdmin(); } }
    else if (act === 'user-save') { saveUser(); }
    else if (act === 'user-pw') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u) { a.pwForm = { id: u.id, name: u.name }; renderAdmin(); } }
    else if (act === 'pw-save') { savePw(); }
    else if (act === 'user-del') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u && window.confirm('Benutzer „' + u.name + '" wirklich löschen?')) delUser(u.id); }
    else if (act === 'group-new') { a.groupForm = { name: '', role: 'viewer', allWerke: false, werkIds: new Set(), allLayers: true, layerCodes: new Set() }; renderAdmin(); }
    else if (act === 'group-edit') { const g = a.groups.find((x) => String(x.id) === el.getAttribute('data-id')); if (g) { a.groupForm = { id: g.id, name: g.name, role: g.role, allWerke: g.allWerke, werkIds: new Set(g.werke.map((w) => w.id)), allLayers: g.allLayers !== false && !(g.layerCodes && g.layerCodes.length), layerCodes: new Set(g.layerCodes || []) }; renderAdmin(); } }
    else if (act === 'group-save') { saveGroup(); }
    else if (act === 'group-del') { const g = a.groups.find((x) => String(x.id) === el.getAttribute('data-id')); if (g && window.confirm('Gruppe „' + g.name + '" wirklich löschen?')) delGroup(g.id); }
    else if (act === 'layer-new') { a.layerForm = { name: '', code: '', color: '#0065A5', categories: [] }; renderAdmin(); }
    else if (act === 'layer-edit') { const l = (a.layers || []).find((x) => String(x.id) === el.getAttribute('data-id')); if (l) { a.layerForm = { id: l.id, name: l.name, code: l.code, color: l.color, categories: (l.categories || []).map((c) => c.name) }; renderAdmin(); } }
    else if (act === 'layer-save') { saveLayerDef(); }
    else if (act === 'layer-del') { const l = (a.layers || []).find((x) => String(x.id) === el.getAttribute('data-id')); if (l && window.confirm('Ebene „' + l.code + ' ' + l.name + '" wirklich löschen?')) delLayerDef(l.id); }
    else if (act === 'layer-up') { moveLayerDef(el.getAttribute('data-id'), 1); }
    else if (act === 'layer-down') { moveLayerDef(el.getAttribute('data-id'), -1); }
  }

  function onAdminChange(e) {
    const a = state.admin; if (!a) return;
    if (e.target.id === 'admLColor') { const h = document.getElementById('admLColorHex'); if (h) h.value = e.target.value; return; }
    if (e.target.id === 'admLColorHex') { const p = document.getElementById('admLColor'); if (p && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) p.value = e.target.value; return; }
    if (e.target.id === 'admGAll' && a.groupForm) { a.groupForm.allWerke = e.target.checked; renderAdmin(); return; }
    if (e.target.id === 'admGAllLayers' && a.groupForm) { a.groupForm.allLayers = e.target.checked; renderAdmin(); return; }
    if (e.target.classList && e.target.classList.contains('admWerk') && a.groupForm) {
      const id = e.target.value;
      if (e.target.checked) a.groupForm.werkIds.add(id); else a.groupForm.werkIds.delete(id);
    }
    if (e.target.classList && e.target.classList.contains('admLayer') && a.groupForm) {
      const code = e.target.value;
      if (e.target.checked) a.groupForm.layerCodes.add(code); else a.groupForm.layerCodes.delete(code);
    }
  }

  async function saveUser() {
    const a = state.admin, f = a.userForm, msg = document.getElementById('admMsg');
    const name = document.getElementById('admUName').value.trim();
    const groupId = document.getElementById('admUGroup').value;
    if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
    if (!groupId) { msg.textContent = 'Bitte eine Gruppe wählen (ggf. zuerst eine anlegen).'; return; }
    try {
      if (!f.id) {
        const email = document.getElementById('admUEmail').value.trim();
        const password = document.getElementById('admUPass').value;
        if (!isEmail(email)) { msg.textContent = 'Bitte eine gültige E-Mail eingeben.'; return; }
        if (password.length < 8) { msg.textContent = 'Passwort mindestens 8 Zeichen.'; return; }
        await Api.createUser({ name, email, password, groupId });
      } else {
        const active = document.getElementById('admUActive').checked;
        await Api.updateUser(f.id, { name, groupId, active });
      }
      a.userForm = null;
      a.users = await Api.getUsers(); a.groups = await Api.getGroups();
      renderAdmin(); toast('Gespeichert');
    } catch (err) { msg.textContent = (err.data && err.data.message) || ('Fehler: ' + err.message); }
  }

  async function savePw() {
    const a = state.admin, f = a.pwForm, msg = document.getElementById('admMsg');
    const pw = document.getElementById('admPw').value;
    if (pw.length < 8) { msg.textContent = 'Passwort mindestens 8 Zeichen.'; return; }
    try { await Api.resetUserPassword(f.id, pw); a.pwForm = null; renderAdmin(); toast('Passwort gesetzt'); }
    catch (err) { msg.textContent = (err.data && err.data.message) || ('Fehler: ' + err.message); }
  }

  async function delUser(id) {
    try { await Api.deleteUser(id); state.admin.users = await Api.getUsers(); renderAdmin(); toast('Benutzer gelöscht'); }
    catch (err) { toast((err.data && err.data.message) || 'Löschen fehlgeschlagen'); }
  }

  async function saveGroup() {
    const a = state.admin, f = a.groupForm, msg = document.getElementById('admMsg');
    const name = document.getElementById('admGName').value.trim();
    const role = document.getElementById('admGRole').value;
    const allWerke = document.getElementById('admGAll').checked;
    const allLayers = document.getElementById('admGAllLayers').checked;
    if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
    const werkIds = allWerke ? [] : Array.from(f.werkIds);
    const layerCodes = allLayers ? [] : Array.from(f.layerCodes);
    try {
      if (!f.id) await Api.createGroup({ name, role, allWerke, werkIds, allLayers, layerCodes });
      else await Api.updateGroup(f.id, { name, role, allWerke, werkIds, allLayers, layerCodes });
      a.groupForm = null; a.groups = await Api.getGroups();
      renderAdmin(); toast('Gespeichert');
    } catch (err) { msg.textContent = (err.data && err.data.message) || ('Fehler: ' + err.message); }
  }

  async function delGroup(id) {
    try { await Api.deleteGroup(id); state.admin.groups = await Api.getGroups(); renderAdmin(); toast('Gruppe gelöscht'); }
    catch (err) { toast((err.data && err.data.message) || 'Löschen fehlgeschlagen'); }
  }
  async function saveLayerDef() {
    const a = state.admin, f = a.layerForm; if (!f) return;
    const msg = document.getElementById('admMsg');
    const name = (document.getElementById('admLName').value || '').trim();
    const code = (document.getElementById('admLCode').value || '').trim();
    let color = (document.getElementById('admLColorHex').value || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = document.getElementById('admLColor').value || '#0065A5';
    const categories = (document.getElementById('admLCats').value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
    if (!code) { msg.textContent = 'Bitte einen Code eingeben (z. B. L7.0).'; return; }
    try {
      if (!f.id) await Api.createLayer({ name, code, color, categories });
      else await Api.updateLayerDef(f.id, { name, code, color, categories });
      a.layers = await Api.getLayers();
      a.layerForm = null; renderAdmin(); toast('Ebene gespeichert');
    } catch (err) { msg.textContent = (err.data && err.data.message) || 'Speichern fehlgeschlagen (Code evtl. schon vergeben?)'; }
  }
  async function delLayerDef(id) {
    try { await Api.deleteLayer(id); state.admin.layers = await Api.getLayers(); renderAdmin(); toast('Ebene gelöscht'); }
    catch (err) { toast((err.data && err.data.message) || 'Löschen fehlgeschlagen'); }
  }
  async function moveLayerDef(id, dir) {
    const a = state.admin;
    const asc = (a.layers || []).slice().sort((x, y) => (x.sortOrder || 0) - (y.sortOrder || 0)); // unten -> oben
    const i = asc.findIndex((l) => String(l.id) === String(id));
    const j = i + dir; // dir=1 -> nach oben (höhere sort_order), dir=-1 -> nach unten
    if (i < 0 || j < 0 || j >= asc.length) return;
    const tmp = asc[i]; asc[i] = asc[j]; asc[j] = tmp;
    try { a.layers = await Api.reorderLayers(asc.map((l) => l.id)); renderAdmin(); }
    catch (err) { toast('Reihenfolge nicht gespeichert'); }
  }

  /* ---------------- Verdrahtung ---------------- */
  function wire() {
    // Login
    // Login: über das Formular (Enter + Button lösen submit aus) -> Passwort-Manager funktioniert korrekt
    $('loginForm').addEventListener('submit', (e) => { e.preventDefault(); doLogin(); });
    $('btnChange').addEventListener('click', doChange);
    $('chgNew').addEventListener('input', updateStrength);
    $('chgEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('chgOld').focus(); });
    $('chgOld').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('chgNew').focus(); });
    $('chgNew2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doChange(); });
    document.querySelectorAll('.pw-eye').forEach((b) => b.addEventListener('click', () => togglePw(b.getAttribute('data-toggle'), b)));
    document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => showPanel(b.getAttribute('data-panel'))));

    // Header
    $('btnLogout').addEventListener('click', async () => {
      stopCollab();
      try { await Api.logout(); } catch (e) { /* egal */ }
      Api.token = null; showLogin();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'editor' && collabTimer) pollCollab(); });

    // Baum
    $('btnAddWerk').addEventListener('click', addWerk);
    $('btnExpandAll').addEventListener('click', expandAll);
    $('btnCollapseAll').addEventListener('click', collapseAll);
    const ts = $('treeScroll');
    ts.addEventListener('click', onTreeClick);
    ts.addEventListener('keydown', onTreeKey);
    ts.addEventListener('blur', onTreeBlur, true);

    // Detailansicht (Schritt 2) + Editor (Schritt 3)
    const c = $('content');
    c.addEventListener('click', onContentClick);
    c.addEventListener('input', onContentInput);
    c.addEventListener('keydown', onContentKey);
    c.addEventListener('dragstart', onContentDragStart);
    c.addEventListener('dragover', onContentDragOver);
    c.addEventListener('dragleave', onContentDragLeave);
    c.addEventListener('drop', onContentDrop);
    c.addEventListener('dblclick', onContentDblClick);
    c.addEventListener('pointerdown', onContentPointerDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endMove);
    window.addEventListener('keydown', onEditorKey);
    $('btnAdmin').addEventListener('click', openAdmin);
    $('adminOverlay').addEventListener('click', onAdminClick);
    $('adminOverlay').addEventListener('change', onAdminChange);

    // Layout-Upload + Metatag-Modal
    $('layoutFile').addEventListener('change', onLayoutFile);
    $('mSave').addEventListener('click', saveTags);
    $('mDelete').addEventListener('click', deletePlaced);
    $('mClose').addEventListener('click', closeTagModal);
    $('mX').addEventListener('click', closeTagModal);
    $('mBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') saveTags(); });
    $('tagModal').addEventListener('click', (e) => { if (e.target.id === 'tagModal') closeTagModal(); });

    window.addEventListener('promodx:unauthorized', () => { toast('Sitzung abgelaufen'); showLogin(); });
  }

  wire();
  renderWelcome();
  boot();
})();
