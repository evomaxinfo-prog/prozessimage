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
    // --- Prozesstypen (Katalog L7.0): echte Icons aus Prozesstypenkatalog-Excel (Base64) ---
    ptk_1: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAC3UExURQAAAAtlgAtkggpkgglkggpjggtiggtggAhjhAllggpkggpkggpkggplggpkgwpjggllgQlkggtkgglmgApkgQlkggtlgwpkggpkgkeLoXaouVeVqTiBmtHi5////yl3kvD195O7yKPF0ODs78LY4BluirLO2IWywWaesZC4xgplggpkgwllgQllggpkggpjgQdjgAlkggpjgwhogAtjggpkgglkggpkgwhkgApjggpkggljgglkgBfiRV0AAAA9dFJOUwAweLO/n2AYH4nz/9JolGJR8sAelLx59+///////////////////////3yWU1b1wySjUCCN+9hrQHybbByd6w/cAAAACXBIWXMAABJ0AAASdAHeZh94AAACD0lEQVRIS5WWa3vTMAyFDawwCLAxYJAmceykSboB27hf///vQpKPXfsJbsL7oZWdU1uSj9sq4t79BydLbB4+Yqk6ffykWMPTZ6x+jtEyZ0qdv0C8zMVL9QrhGs7Va0RruFRvEK1ho94iEsotv1aVDOYk6rrRui6K1uimxFRKoraa6LqeXneYSknUFasdFlMp87UdDaZSgnoYii2UQlcM7kFMUFvN6Wptmp28a2NG9yTCqwfjNB2v6Ddp5VGEV6NAFIcCpPkxXl3K41AbNZ6YMAqEvOvksWw1P9GgluXCCQ6sRhyRqunYAQ0MwoigHriBexcjr1lLgpoNFblj4pGZWcur0WIsTi5kOjc64NVSFiGZu43+0ZSQN85bj9O+w7n2tMho43SCut1W/gNCU1+Rbk9RlE9QEwMSYPp2q+0kExl1bFl7iM3Buola+uYYnX+FPsgTNWdp3a2w/Eljy6pjfYPuJOqi7na8zrir2VdGNOJeXIxUHUFrozzOCZ7Jqqmd2F6qcZ7JqNvIkVSGwS3KqOU2wDS0tv92yajFNq40trI3TC5vaTfvP4wUeKfn1JVlfTPJW7glOXXqGm+VvDpYnrbwR39ELbn3U2n7cEGPqak+8V/GgzOq8CXg2Pznr9QJojVcq3eI1vBefbhBuMztnVIfES/zif5DfP7yFaPjfPvO/ziU+vFzs8iv33+UUn8Bx4iKMTYUNAAAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_2: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACrUExURQAAAACAgAlkgAtjggpkgQtigghggApjggpkggpkggpkggxkgwpkggxjgAlnggpkgQtkgwBtbQlkggligApkggljgQpkggpkggpjgil3khluikeKodHh5//+/6PF0ODr75O7yLLO2HanuYWxwfD09ziBmmadsVeUqcLX4ApkgwplgQpkgwtlhAtkggtggBJtgApkgwdjgApkgwBggApkggpjggpkggpkggpjg2S2f24AAAA5dFJOUwAEOHSAYCBkzv+tQvMsOduoB4c8sm/vl5//////////////////////yYagXVwYDnskzwi739urUHXJxqsAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAHJSURBVEhLtZZnc4MwDECdNh2k6R5pDIRlRvce//+XVcjCliEX0+v1ffHgBcuyzEUAk63tqY+d3dYE9vaDMcwOWnmbRl7mh0IcHdPAz8mpOKPuGM7FBfXGcCmuqDeGxa/s6z/bS91IqVvG0A6jeNW2MolT+p2hb8ssBlorbzuFnu3o28vWieMsi7CNaJoYRKLQ6khplhjYCXka3IGlb2O0FlXSvKZnV24goMuAJZLZtVINOZxMJSQ4NuYOaYpyWRc0ACoymC1NEDmtbVZq9JjbZn82a0bvztTa3cqR3RUd1Tq7002QwApnVE1DbgcpPuOVVOGMkR0bnykaICXaNrSBbZMLhBtszIrzbm3b2JgtdcJ4ZeiN25Rau6TTYWUH1wcxVW5tnRHALmwOrFvP2jpGIOl2ZQoSClHD4jb3IMEDkqkpHBM4s00o4K9WDav0kAxuB0UeDgs8DfOcnrs2IPVVt7jXuGcHkizCVLambwfuy20QiOfdGU0T6+20LGvcsO9bVUPa8Xzg4qiGFzswsMFPdflXhfvpAdbYG/hf+4Z6Y7gVd9Qbw714oN4I5o/iaUZ9P8/wH+LllQY+FpP2L8fb9P3Dy+fXtxDiBxoehoN00Je2AAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_3: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACcUExURQAAAACAgApigAhkgAhggAplggpkggpkggpjgglkggtjgwpkggpkgw1mgAdlgApkgwplggtkghluimadsUeKoYWxwQ1mgApkgil3kuDr7//+//D09ziBmtHh5wpjgwpkgleUqQpjgsLX4KPF0LLO2JO7yHanuUeLoWaesf///1eVqXaoufD198LY4ODs74WywdHi5wplggpjggtggC7oJZ8AAAA0dFJOUwAENEAgr/P/34dI788UJsWTeP////8oq////////2fj/5////////////////////9oxhjpi33MAAAACXBIWXMAABJ0AAASdAHeZh94AAACaUlEQVRIS5WWjXabMAxGyZrN3V+XOU1HgG5tgIDAQLe9/7tNtj/bweGU9Z6eRCgXIcuQNNFs3t2ssTUis33/Qaxz+3Gj5U+fcbzGl69JcvcNB+vskuQ7woDc3/PrQb9EPCQ/EHnSY5YXcp9lj0gEfia/EHmeMpAjEdglV2u8h7xgP0e21I04TqJAGsR2meWs5VV90nqePSFviWyp3SzX47ANVTYPItusME9NXJvYhI64kzMbNWK+znHeeGxr5YzwMctKhGDJPiDkhc7bXuzEKTxKLMER2XYQtlne+5VVSmMfdXg2w3x1grw7hvJgdid7fXeEKApT01DKlZ1n/F11lMh4FuwC8n/cgwzb/DTwKE9IBBZsHseeX5aetMhu8O4pZtszt1vqhOxxIAo+t1aX+twelBQ9uc9rjjryJzPeblsuRpVIld8+SYMQo+KoQgFvV/zJxI2UFHrXx/oCKXEpjbfLUdeRDZcXjd6WLhWSC3c08TU7K3m7VqaRgUs3Svf6wqdP1EpSorm2KZ2o7vgEqXitXFuHrI76A3R3YZPSf52s0KV+r2nkpLqyS7K0JeFhlIparmGI7Qp5otHdeg0SDIbubb6iRV1O0IEvDWcXSBMPLBBK2GNn90iTmYejRZJwNzjbt81bGpBIusad7a85f8h5qBY7J9ihCJWD0r3LgcZyQM4VgR0WaeBKF+dr7DJhh1mRqvvCrLSbwh5gmdaWvu2hvZxJGJVt/Nn+pvVWV/3MZSTuiMEMZed+LztO17GrKV5ITfjO+h1+iyUekBgZLviQ3P1BuA7/zr/tf4g3/n/CbLar/GUtSf4BjZqNhS7sQgIAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_4: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACoUExURQAAAACAgAlkggpkggpkggpkggpjggpjggtjgwdjgApkgwplghJbgApkggpkgwtkggtggApkgwtlhApkgwplgQpkghluiil3kkeLoZO7yODs7ziBmv///3aoubLO2MLY4IWywfD196PF0FeVqWaesdHi5wpkggpkggllgwlkggligAliggpkgQtkgwBtbQtjggxjgApjgwpkggpkgwhggAlkgAtiggljgtCH9okAAAA4dFJOUwAEcLfz/9+fSCTLkw6te1wYoF3Jhu//////////////////////l7Nvhzw526gHdCxQ68cgOGBYJ2SMugAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAeBJREFUSEvtlteu3DAMRLnJKje9Ry6i69rpvf7/n2UokZZ9A8R+Tw6wWGo0oikSBkxEpxs3z26PW1e3YSW6c1eFPe6diO4/0MU+D4keaXiA82N6ouERntIzjY7wnF5odISrf9DtvQaZQv8j2V2WzlW1LhYCB+caO5LddYtfp4sFz71zw6irxV3wiK0K+2ktSChJBkuycV94cr6+JAGMyNkNcFuBizsgb8OXeMIQZ8XFNXfZJHeLHfkZPU723Lgap7zUHt0THAGV1Oz8MCen4GN1fczdS5boltsFbh3X2LT7C0gK3UN3s2RJdUMteBh5KDqUnqm4mZhHnuMjzD1x23NiWI/zYuJUx+skt1cVrAtB71Rl1AmSG50w0J4Vnaqqq9vq4E3ZmI+qnPqqbiuQZTa+x43CKFPKzxSXuUvVGFcvZ+YS7eDR+6WSNE11BxXBjJuN3hW1xEkCG3ehYmROtTe6jKQJq3vVQu6s4yH3b+t2KoIqj6fIlaQxmHvRl8xCLlDmnt1oQWRem1e9Sle55h7wzm6wQeAVB+bWoeX3xtD5bN19G9nWIYS0sa3kGP/df/KSXml0hNf0RqMjvKV37zXc58NHok8a73L+LJ8cX77q8u98+x4/UOj04+cuv+Al+g3ClWbiEA9SrgAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_5: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJGUExURQAAAAhkgApjggpkgglkgglkggljgglkgAhogAtjggpkggpkgglkggpkgQplgk+Qpc3f5i16lApjggligHKmt+fw8////8jc41OSpwpjggBggApkg32tvfP3+dTk6V+ZrQllgRVrh4m0w/7+/97q7mmgswplggpkgh9xjZS8yenx9HSnuApjggpkgit5k6DDzvP4+X6uvTaAmavK1BRqh0KHnrfR2pO7yB5xjE2PpMLY4J7CzSl3km6jtYWywXaouTiBmiV1kEeLoRJphoGvv/f6+zB8ltzp7eDs7/D196fH0leVqRdtiUuNo4ezwsLZ4NXk6bbR2mqhs7LO2GKcrxZriEWJoICvvrzU3ZvAzCByjVyYrJe9ytPj6Ojw863L1cXb4tHi522jtIi0whluilWTqJG5x8zf5bTQ2Xiquj6FnCFzjh1wjMbb4snd5I63xVKSpzyEm/v9/ZW8yVuXq0eKoYKwv77W3vn7/Jm/yz6FnZC4xtnn6yd2kUCGnXusvPL2+IOxwECGnuHs8KbG0S98lXOmtzeBmWaesdbl6vz9/vr8/WSdsOry9PX5+nysvG+ktSx6lJK6yHqruyp4k6nI0+zz9cPZ4X+uvnmru+709qnJ0yN0jw5mhIy2xKPF0K7M1kaKoLrT3Ja9yjqCmxZsiC97lfb6+wxlg3epuY23xWyitAlkgmCbrgtlgwpkgcve5VaUqQllgQtkgwtkgglmgESInwpjgwhjhAllggpkggpkggpmgwtlgAtkggpkggtiggtggC63RSIAAADCdFJOUwBAfLO/o2wcII37/9hrlf///2Q8///////fCJb/////U///////fPf/////n+////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+9/3mU//9R8sAe/1AfifPSZzB4l2AYUaH2twAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAtJJREFUSEullvlfjEEcxwc5w7Zk5EiUM4sVSmqf3c3Wbm3IbimJpEI2UVISQo5y5M6VNnduct/8Z2bm+Tz7HOl4vXr/sp/5ft+v2ZnXzD77EMaw4SPCBmLkqNFcJWPGjgsfDOMncHsiRhpMEWYkHZMImYyoIXIKnRqFrGXadDIDUWVmNKV0VgxGWmaTMCSFObFxTKZ07jwUNMwnC5DAwkXCZcQvRknFQpYgySxdBpdhXY5iCIOdsAKmIC52JepAb69KhKeQtBodGZ2dvAaSSkoqegKdbZMkvZ8kSSb0BMZd2uHJOFBVGIrtTBu8vdaVLmUkuWFydFtkaOwYD6WZWd7sdes3yGfP5s7ZaNPeRtX2WWXD6s/N25RfkM6zg01A3Zuj8uCEbJ+5cEvRVq5Quq04MsFp385WUiLG7h2yo9oeWlLqKCvfuUv0aebuij0BX6Ww93rTImUpZIt61b792dWlyj4jXGa+kqqArUaSJb3NKDlQW3iwrv4QhpQ2HG6Mo33ZjCMpuUePNSUe5zn6xMks9tGPzWg+5Tvt9NXXWL2mej7u32bEF585W2luaRUDo8330wu/s0YOA87NySxDGJod5ceXavGkIuDhErLZL7iiAL0QmPtcHRSNzUhuxE0Bsn0+H22DHR4euJB1UYgCYaerjxWjbSs1O5rEgXC43XYJLYbRttM2/+Urpqs5im29hg6nt81wN5Rfb7nRzuxUakdD8F+bcfNWdeB2jsepk/u0Kb1zt6UjA1UFoy3BFbQHUFXQ2vc6g0H9BegKBr1oCnRz338AS+Whbnr9Sh51QVLofIyOjGHdT4LQBE9d3agD4y47imAy2p+hGMJi/JfKfg6XNr9AScVCXiIpdLvahNz6CgUNr8kbJBU7v4Vv32GkpYf0vEdUqbVSt/EYOR8+EmJB1vApwniKgs/sHeLL128Y9c/3H/yNg5CfvywD8vvPX0LIPyIe97oaiNsnAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_6: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACrUExURQAAAABqgAtjgwpjggpkgQlkggtlgABVVQllgwlkggpkggpjggpmgQpkgglkgAhlggpkggpkggBidgllggligApkggljgwpkggpkggpjgkeLoVeVqbLO2P///9Hi5yl3khluipO7yPD19ziBmuDs74WywaPF0MLY4GaesXaouQpkgQpkgQpkgwtlgQljggtggABddApjggtjgwdjgApkgwplggCAgApkggpjglcw2/oAAAA5dFJOUwAMSHyAcDADbdf/tkv3OD/hrg2LPLVx75uf/////////////////////8eEnltYGAuseSTLkwS332JmoLYAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAHUSURBVEhLzZbZdsIgEECp1ram+2oli4SELN1X2///sjLDQEiiJ+mb98VhvJBhQE+YZm8y3R9idgAmY4dH82AMxydgT2k0yOkZY+cXNBjm8opdUziGG3ZL0Rju2IKiMdz/y17uvs1DCny22DyK42RFg4aNtkhlDKQ0dmywratJMsoRfTvMSUXay3dtnoATqSIqE5wmK/oGaNuZ3hxSU6LUcdHs1rebgmUtTMrMtnM9Wyi3udJtrjAJ20xnm4LjOtcLmwxAtt2ttStauBa2CCQ1WVmHeLRkC1uFt64oJDd2qQvB1pCtMKtRMELwadBErGzFIUe27VwcwUjjehmX6Jk7Rjb0FSE7c/0pUqlNjlOszek7rReq4nyVmfOXNTyjSOn6ku0tRqBdhpiGXSLWDlaty4RIZVqSup46OxDmeBrKylwr70fU2IFwWwWkKtpVAJ7t9VHfDGUGTRVAy7YHrbsgMPSrANq2PdNSBBl8+FUAHTuoQM7148NuFUDXxnOCyxJ1qwB6NpyTPua6VwXQt4MsD4NQ9aoANtj6YqvO/4hlk72dXbIpGMWSPVA0hkf2RNEYntkLRSNYvLK3d4qH+dDvEJ9fNBjiew2vHOvZz+8g8+WEMfYH1XaLRqQEf8cAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_7: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAD5UExURQAAAABqgAligAhkgAtlgAxjgAlkggpkggpkggpkggplggplgwpkggpkgglkgA1mgApkgQpkggtkggpkggpjgwpkggpjgkeLodHi5////7LO2HaouRluisLY4JO7yDiBmvD192aesYWywaPF0Cl3kuDs71eVqTyEm1qXqr7W3kqNoh1wjJC4xujw8/f6+0uNpIi0wl6ZrS16lLPP2FiVqqfH0rbR2hJphiR1kOzz9UGHn2Kcr8Xb4k2PpFOSp0yOpPP4+TB8lgtkggtkggplgwtjgghigAplgwtkggtjgwpkgw1mgAhggAplggpkggpjgglkggCAgAtggGxzCMIAAABTdFJOUwAMPEAwLL/7/++TTPfbHCjJl3irZ+Of/////////////////////////////////////////////////////////4+pZXQiw5FIzxQgr/PfhwQYL9Eb2gAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAlFJREFUSEullmd7mzAQgJWuKOlwtxACgVjpTNu0Tfdu0pWO9P//mN4dJ5aNIU/fD/bJvIi7E8IIZOPU6SnOkAicPbcpp9na3kD5/AUeT3HxkhCLyzyY5ooQVzmcw0Jc42gO18UNjuawLbY4msPN/7NVoEMT8WDIwFahJmKr+JcePTuxaS0ToVu6RMeOei4RZ/1LtLZacmtyxwLQ2MpJE7MwJDS109oOEx05IVBJLXVtACozAUUd4iK0tTSwAasKU3JM2KrUozZglcr8CakzUP46GxybKGpoUFkcr7eB0haVhZRpMLCjJRuIs4IT6tmRjVfZWif8bStaVLJVqYOk1wdPY+c6LWq7iKBlUFbOhzp4O8u1gzsAbaWhoFwHsJTDC7BtFTbS21CQS2BqOKu/9LVtXWqMbu3UGmtx6tAl1GCG7MylmQGnsbMd627VU5cWy2DQNgZkWKm8tmUVY19v3/EJhcpXDDYkTHIAO4lsKe/ioXuolBkm5CtOoDrdyN6W9+HQ7gM8x9dKfSq8XEK3W/shao9IBqBWuA6kJY22KKf1dvD23mOQnrimvMBQKiF2D+SKpMaW0dN0/5nk9QmTAibFhHpyazfATkmf77+wL1NIqCC52fXLNvjmFcz/+g180Cb1O361DflgOthQtPneRlbbO2jvviW7I4/Yku6td2jb7sNwxN57D3ZiStN/OI/Y8kOcwl0kaQVbxuzVnNQ+yX/aR/GJozl8FgcczWBzIQ6/cDzNV3iH+Da3zu8/8JXj6OcvHq/j959jlIHjo0n+gibEP7ssnE9nDjb+AAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_8: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAFrUExURQAAAABqgApkgQpkgwpkggpkggpkggplgglkgw1mgAlkggtlggBggBBggApkggpkgwtkggpkggtggApkgwtlhApkgwplgQpjgjR/mJO7yNHi59Xk6Z/CzkeLoWaesfP4+f////v9/YWywVaUqe/193Omt83f5uzz9RluihZriDyEmxJphjeBmV6Zrff6+4SxwKbG0Zq/zFeVqTiBmkaKoGyitI+4xnWnuPD198LY4DB8lrLO2HaouafH0uDs73mru5W8yaPF0H+uvmWesQ5mhLrT3B1wjEiMot/r7zaAmXKmt2KcryV0j32tvSl3kqrK1ECGnW6jtZvAzE+QpZG6xy98lcjc40uNoy16lIi0wluXqxxwi+nx9JzAzc/h5oKwv0yOpOXv8qvK1BNphhBoheTu8bzU3VGRppC4xgpkggpkggllgwlkggligAlkgAlkggBVgAplggpkggtjgwplgwlkgAtlgAtiggpjg2I+O4oAAAB5dFJOUwAMgMf7/++vVCjXpwgQsn9c9xigXcmGn////////////////////////////////////////////////////////////////////////////////////////////////////////////5ezb4c8OKUGaOtIwxwwYFAZEvhxAAAACXBIWXMAABJ0AAASdAHeZh94AAACTElEQVRIS+2W6VvTQBCH12NQPPFu0qZsVsVtK6iJQkMjGI2oKCiIAt73feL55zszGfrYYmj85gffLzvzy5vdZJM8T9TfsmHjps3Qi74tW1nu3yZBL7bvUGrnLml6s1upASkLsGev2idlEfarA1IV4aDqk6oIh/5Zu+S45YonzRq67OqgRnwjbTed9uEjJCNHJeii0x4SWR+zkgi1eoOGDvu4uMiwREyt4usRB/0Oe1hU5IREROMkR6e67CqnjCMREUgWdtqnJUbOSESMSjaW2da4zQh3rdGUXOtxAM9xWzHZZyUzbHsT3LghTHKBnAObcNHEJ3WeK60vkB23Z6ymF7OiPBVmMyAxXLrMhXuFbMwjzwYRBtXU4KkjlVqIQ9OEMZ0Tw7SPg3/VxmybazPJTM3hIxDWU/BQdmfpmg2GBrzr5aRuWxHZcepi5qZ0hHeOri2yMBXcaPD2JRTalibbg2lMtJ7j/Z4wMV1TYsdpCn8+9XBw48ChGdAGyG6/gpvGBeLYm/w2aj1k26E7y/YCNwu4XEjz6qgKt25zhoxCSKvQctnTWeQu+wZC41BB95DhL+GaScuEmLINy5guk9uG18gYkwjJbCjdwUf9G3fviYrclwwRuxsrJtGSDMmx4YGoyEOJkDx79b1DFiVC8uxHj8XVT55KhOTZ7S0cLElA5NrPJp+T/OKl9EyuDbA0N/8qqEmTsY79B/7ba3mt3khVhLfqnVRFeK8+FP0pAPj4SanPUvdkpZ9+Ob6sSLs+X7/xD4pS3wd+9OInukr9AgDYlmCvBlhlAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_9: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAEIUExURQAAAABmgABmgABngABlgABngABlgABggABVcQBmgQBmgABmgABmgQBlfgBmgABmgABogABpggBmgQBlgABqgABngABmgABmgABmgABmgABmgABmgABngBBwiFCWqDCDmCB5kGCgsECMoNjo7P///+Xv8oCzwI+8x7TS2qXJ0vn7/Ofx8/X5+nCpuJbAy/P4+ff6+/r8/Pv9/eHt8PL3+cvg5fb6+/j7+97r76vN1fT4+sPb4cfd46/P15/Fz/H3+NLk6fb6+uPu8fv8/fz9/b/Z3wBmgABmgABmgABmgQBngABlgABoggBmgABmgABogABlgABmgABmgABogABmgABmgABkgACAgMmP7t4AAABYdFJOUwAocKu/l2AQCXXh/75TePssPdyrDIs8sm7rk++f///////////////////////////////////////////////////////jj61pgzAx0J4gYs6sQBRQQARiSOWhAAAACXBIWXMAABJ0AAASdAHeZh94AAACE0lEQVRIS5WW6XbTMBCFxVYWQVnL1liyzDgxSUrSJFBIQoGWfd95/zdhJh5rCTpYuT90rjXfSUbWzBwL1ImTp0636czWWULFufMXZIouXiJ6m59adfmKEFev8UO7rt8QO2xTdFPcYpei2+IOuxTdFbvsUtQJ6UwpqZVSucRFZbkpOFAroM09gFJ2AaAnS1y1xqXSHEV5dHa/j8GB7A6h35ODhgbYYyCgH4wohPQY9gMaFBMerca4P4EpZzLFlWjanTHi0Q9xf7inM0wJ1ayqR7/R5OLoRwAH9i89VXiair2lNW4+rm2oDH98xN7SZgLwpLZrmiPO1tLFYrl0r8rX0+VygScgubxTZOncGOPdmicMGLaWVgcTOKztmuZ4IraOxpuM08PIKekqN6BxL04/i9B80xF5AUtnWlONRISB5mUlZDKL5b3ZO9mM3iiTHHs8fvPU/WwtnSRLm7Is4xX7vCyn6xVLeTcNFSp2Sr+hAtGUaFrQ5U0NFenirNp3LejoBdLQKzKZr2pgdd+ZVgSPusw4Oif6BRzx9DnCFadP/xgH0OCfqpLy8CXxqzkYTraxHbQeLWks1XPQn5rHc3can5bmlZvInAnMqpyjqICmKi9Wla75rEVYDGt0izriNbsUvRFv2aXonXjPLkUfxMdPbNv1Gb8Ktti3avcLfUR8/caP/9f3HwQL8fPXTqdN27//CCH+ArgrmxbxKh77AAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_11: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAC3UExURQAAAEBAQEdHR0ZGRkZGRkdHR0VFRVVVVUZGRkZGRkZGRkZGRkdHR0ZGRkREREdHR0ZGRkdHR0dHR0ZGRkZGRkZGRkZGRkdHR0ZGRlJSUmlpaXR0dF1dXUdHR66urvPz8////8XFxbm5udzc3KOjo4yMjJeXl+jo6NHR0YCAgLOzs0ZGRkZGRkVFRUZGRkZGRkpKSkBAQEZGRkVFRUVFRUZGRkZGRkBAQEVFRUZGRkZGRkZGRkZGRs8opuAAAAA9dFJOUwAMSHyAcDADbdf/tkv3OETjsRKPt3Xzm+//////n//////////////////HhJ5bWBgIqHa/+4cEYKfb38+Bfb3tAAAACXBIWXMAABJ0AAASdAHeZh94AAACEUlEQVRIS42W63rUIBCGqa1ao7ZqbS3J7gIbkk20aj3W0/1fl8zwQaBbNvl+7M7ACxmGmTwRTkePjk/m9PgJkUI8PX1WLdHzF0SfwJvVyzMhzl/BmdfrN+IC5hKdi7ewluhSXMFaonfiGhZL1vTbrNjZ1zqlVxulHSiVNg/zGb3VWrfWtvSHoVwZ3TkM2mAoV0ZboE4GQ7lSulNASR0GM0W6V8bDYYlp96OJ9M4zQy2rmk5L2ktMoEc/j+2M93rvTQq0T8dOslNJ/yTrvUlT3Nk0L7ZYOynSHPgIu5JE78EJTTfIVcJyjoKZqLB3fXhvyVmLN8inaIsZ5Om4uaSwtN56b1Lcm6e14u0k8h0DC4px4y61bRoLW8lK2qxeIt2YPixgKfvegXTFyR1F2sn1TJQaO2XHLY0k0ad01g11XJrkPaORGJJJwhowfY/euKltXdOf4fwPlk/cDshORlfjjlO4a3tJ5+OK5WWIPaeD3J27qPzNcvUi9odpJ3dBeDwFhjYq0CtCUJHuKQqlXqC58Rpvu/dG6OcCzWXjj0YVFgqmFDenm2uEYgqlW6L7gXfveq5dxFSk3UGTqgldUqZ9t7FU6NcDNMeuBmtU7IpDdHgLTG+CQ3TV2HsvzrWAsUhr8QHWEt2Ij7CW6JP4DGuBrm/Fl6+w5/XNfUPcfoczox8/7+iT4+7X7z9/5/Tv4kwI8R+9PpIVHDcm8gAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_12: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACfUExURQAAAEBAQEREREREREVFRUZGRkVFRUZGRkZGRkZGRkVFRUZGRkZGRkZGRklJSUZGRkZGRkZGRkdHR0ZGRkdHR0dHR11dXa6urvPy84yLjMXFxdzb3FJSUv/+/4B/gGlpabm5uZeWl+jn6HRzdKOio9HQ0UZGRkZGRkZGRkdHR0hISEZGRkZGRkREREdHR0BAQEpKSkZGRkZGRkZGRkBAQLw17NwAAAA1dFJOUwAMPEAwLL/7/++TUPfbHMuZgK1q65//////////////////////j6VjbCC9izjDEBjnz3QEahPsnwAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAcNJREFUSEu9ltl6wiAQRrG1dWlrVyVmj0m62H15/2crA38YJH6Gm/bcOMARZ2CiCmJ0dDzEWIuKk9PJdJjZfETy2TnGQ1ws1M6XGAxzJcQ1whDG4gZRCLfiDlEIczFDFMLyX+2VjNY6iBPz6uDbqYyyLFqpKM8Unu/bBTlZImWp3qUCTINeJlqylJgFPTuBZ6gwC3xbZ8tEKeYNnl3sJuIn7tjFJjal7ZDIJIawY5dYV58v6zznIZ8j26ndtzTJFrZgezJs2/rsWmp1ui2C7QYrGz6GGlN77BSJNhgTrZ6J7Kk7VU5jvdbtQ5jP42Zx7TUtRRhoTC38/p69wUBjeowLOby3KXOvnZqa3LwrPcOtxXZ3Gf0z2Xc7Zh+VCm+uUyMKTLBt79K2nW1I27dO3husZYnZvebG0WOFY0usKeKmapyHqIbh2mncrO3+ljYvJYQdm+C2Behe4Nm4PYvTkIRve888J6HxbS8VfiQ1PVtLbbWudMFD31V0pTpbqqDNzWRHz1Z+a9pftvacO/bYB/hb+wJRCPfiAVEIj+IJUQCTrVg8Ix7mRf2HeA39NX57p78cH8tPjA/x9f1DMrHYDkH7CvELfIx7AdnVj9cAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_13: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAvCAMAAABADLOjAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAADPUExURQAAAEBAQEREREZGRkZGRkVFRUZGRk1NTUZGRkZGRkZGRkdHR0VFRUVFRUZGRkRERERERFJSUkZGRkBAQEZGRqOio9zb3MXFxfPy89HQ0YB/gEVFRUZGRv/+/7m5uUZGRmlpaejn6EdHR0ZGRpeWl3RzdIyLjF1dXa6urnR0dIyMjP///4CAgJeXl/Pz89HR0aOjo+jo6Nzc3EZGRkVFRUZGRkhISEVFRUZGRkZGRkZGRkZGRkZGRkdHR0ZGRkZGRkVFRUVFRUVFRUZGRklJSTpgbcwAAABFdFJOUwAMPHSAZCwKcdj/uFGT+0A4/98ImP///////1XC//9///+f7////////////////////8B9lVJO6R2D91TrxygwXGBQHDTQmzcAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAJySURBVEhLjZWLlpsgEIbpvWXb7dLW6KbVknSzQVEUe79f3/+ZOgMDRtyz2e+cxPHnd5gBTBhw6/adu8e4dx+djD14+IjfhJPH6H5Cd0c5fcrYGcUHCLqmPHvOXlAYEdkqh+/ifE3CxEv2iqLIuizLvFqVZUHCxGt2SlFEgtuxIWFiy95QFBA5mcvygqRI6s42UAIUsdrg5bzYke5J3KJwXuzvEqOy8jqRuF3Nxd7FysUuDKSVYEZFMcyzkRR7Fl2CJTQHHcwLWbix8IxiWBzYpkPSLiuo5Jxi7Dg86UncO+ysvMTQPZjsUFqJW+ZS7eXab9K1uflOuZSeIlN+MQOpG8jIWxbz5QOucMdTtTyDV7ih0yJbw07eyM2lwv2pLpavUOKu6RqRszbn7ka3XHR0w2ULR8sc2ufu3gg+6DDeaclrHR8GonuAA9TqgUsTjiAX1nJuDUSWEkR3NcJHS9EfTN1AYqUbvocCHZMbctgRZh+4UDioGs5HvRe64nLhVgYKUcJA5coNVroGJecGBxZurXKdV5C6g2yAsFDTqBujhxwedBy4PbI11m9Lra0YSE3dOenGGJoWElhDalqJJV3DGgRCBh0WPbglydoX7RExBSw8EtwdyRrWZKIhUdP+BnectHe3hCAxlBLccU786XaJBEwiQpcoA+Tekwjko8Ha0ZiPpIUpyd2S6DEDuKcFQfBsRfc0ZPJaUqN115MIuHXduv+GWJ/p5q+XrGjAl7Jlb53cYYlmmHsR5zd960besfdOhHmVXfx+OIY+TviBffxE4XFOPjP2heKjfD3Dv+5v3+n2en78RDPw6/efY/z9xxhj/wHauKS7OvEkOgAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_14: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACrUExURQAAAEZGRkdHR0ZGRkZGRkVFRUZGRkZGRkBAQEZGRkZGRkZGRkZGRkZGRkZGRkdHR0ZGRkBAQEZGRkdHR0ZGRkdHR0dHR0ZGRmlpaV1dXaOjo7m5uVJSUvPz83R0dOjo6NHR0dzc3P///5eXl8XFxYyMjICAgK6urkZGRkZGRkdHR0VFRUdHR0dHR0ZGRkpKSklJSUZGRkZGRkdHR0dHR0VFRUdHR0ZGRkBAQGvnREwAAAA5dFJOUwBQl9Pfv4AsFK//+3SgbkjnEJlWwn6f7//////////////////////zuneTREvsGBXqyF4kaJuPDETceiAAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAHgSURBVEhL5ZbrctQwDIVdKAVcynJdskmci5I4lEtb7rz/k/XIkuOkMKz53W8mu/LxiWxLyUwMOHnw8PQYj84es9U8eWqzOH/G7gsdHee5MTsNM3jx0rzSMIfX5o1GObw15xrlsDfvNMrhvrmLg7VlpYOF2kFudLByt3B2vQ4WahpkKrC4a6rCdRc34up0sLgPcDY0Ib8XAczI2zm445KLu6DZDuSt5zsUds50sK5VIbgLpGP3iBmejcy4u8TV4i6LdcQ9wFFgJy3hRDyjeGgex2yRe+IskhtKQSOv6PGXcA5nGS3B3fFuZN9IeCBXkrMVFk5UNHnWe9xUYizugcqJAs7VwSd4CEFtOiowFncdnIH1RtZ6KKK4cb4IL5joVVVd3bNqtNn2Wg91VTc2qHBvGvzUE8+PqhKF46i7UY24lrA0KAfaldzSBXUXKkKuUIWuDkqfUkvv/3ADN/CyNbInNu5VqaiPD0ranhbwL+4+tWe1ojzh6k4FX5nX2XFiEN2xsI4bnFgqK22443bb5vBzJciLHN2qbvvOaO+37rIPpPcm4mVCXr/ozuO+uN9rlMPeXGqUwwfzUaMcPpnPVxoe5/La/EfyHb4hbs6+6OjffP3GXxzGfP/xc3+MXye/jTG3K7mKvY0KvzQAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_15: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAHmUExURQAAAEpKSkZGRkVFRUdHR0ZGRkREREBAQEBAQEVFRUZGRkZGRkVFRUVFRUZGRmNjY8LCwk9PT0ZGRkREREZGRkZGRnJycu7u7v///9bW1ldXV0VFRUdHR0ZGRouLi+Pj48zMzHR0dEdHR0ZGRpSUlOvr69TU1Hx8fEZGRkZGRpycnPT09Nzc3ISEhEdHR0ZGRk1NTaWlpf39/eTk5IyMjFVVVa6uruzs7F5eXra2tmdnZ7+/v6SkpExMTJ2dnbm5uZeXl2lpaX19feXl5aOjo87Ozvz8/F1dXeLi4mBgYJCQkLy8vOnp6UlJSZGRkaCgoGZmZlxcXImJibW1tejo6PPz84+Pj3p6etPT029vb3d3d7S0tPn5+cXFxWpqasPDw/Dw8NnZ2aysrH9/f1JSUoaGhvHx8ZiYmGtra/j4+MvLy56ennFxcYCAgPb29v7+/tHR0VpaWoODg6+vr7CwsKmpqdfX16qqqlBQUKurq7u7u93d3Xl5ec3NzbGxsZqamt7e3lhYWL6+vlRUVK2trWxsbM/Pz9/f34WFhbq6umJiYrKysvr6+qGhoUZGRvLy8pmZmUVFRVFRUerq6kZGRkhISEBAQDMzM0dHR0dHR0ZGRkBAQEVFRUZGRkZGRkZGRkZGRkRERPO/XzMAAACidFJOUwAYWJOfgEAIDHbh/79Vi/////s8Reb//////7QSj/////9Et/////918/////+b7//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////E//+B//9Q/xAFpnOHBGCn29/POJtm7LwAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAALJSURBVEhLpZb7P1NhHMcfWtepjWoeK2plFHJrU4TZheOSVRoiQxJDiSFEE10U6X7X9T/tPM/zObex1Mv7p8/3+33v2Tln5zw7RCYpeYdpK3bu2s1UsmfvPvO/kLKf2QdQ6bBYU5H0pB0k5NBhFBq2dJphR9Zz5CjJRNTIOkYpPe5ApecEOYmkku2UZUpzclHrOEVOIynk5XOZ0oIz6GgUkiIkQXFJKWRKz7rQVDEZbXcZTM65bLQVjPb5cnggPw8DYLArLsBSKa2swoxjsKs9ngJoAqvHY8OME3fc5hp4Ai+6Ctuxqyz/Yfv8AUdtHUyGhIGCzrbUUlpf02BpbLoImXqtAVszxgzNDmLRgkuXr7RcrefZG6K01dqmfoVqt6c2VF/jCqX+ko7mzuvyzSXJNqNFOJod6gq3ubtrenrF/EbfzX5biZ1ffn9QuiUk1Wb9gfBgxN0S7mIKpb3l7VVsbafXkR4QksGWGRoeuZ16p6lVVKPyBzPsg06awJa5O1bZOR6dQGMyMiXfw4ltxr1p34xt1k/rqivus/rvtszcZNTutc0/4EW8jWtlYDTmxglsuTajtR9he3ZwMz0kISwISbXN5vm+h5ipKGvHsHPpbLN50bU0IMYA9sQjCAZbJjIyxgWBsB/3Y7jB9kVnfDG2D3K4Pavtt/F2gPbGnkiNPaOqPVWMkUy8zZ/Lp3ndHYEMZku0DAPOprZ8ty5lLXY2dYUkg5zIllnua5+Joquw8bh1LLvRVTDYUZcrDFGw4HIl3tmezcHSsHZjxjEeSW4OJIXnK5gI4o7bMQxNsDqOPog/y0gPRMa0+pMDE0lDAiv8OWS8WNNvahwTeYmkML4q5Fev0dDxhhQiqbydYvK7IEo9yeQ9ksaHtSFar2x9eoo+kk+fkXW0OTuQDHyR3yGSUlDoMPyTgbSv6+yVY/3b9x8/t+JX5m9CyB+bGPLxyb2McwAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_16: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAClUExURQAAAEpKSkZGRkVFRUREREBAQEVFRUZGRkZGRkZGRkZGRkBAQEVFRUZGRkZGRkhISEhISEZGRkZGRkVFRUdHR0ZGRkdHR0VFRUZGRkdHR1JSUl1dXa6urvPz8////6Ojo4yMjHR0dNzc3JeXl8XFxdHR0ejo6GlpaYCAgLm5uUZGRkZGRkZGRkZGRkdHR0VFRUZGRkZGRkZGRkBAQEBAQEZGRkdHR/HgrKsAAAA3dFJOUwAYVGBACDTP//enEFz74yAunIAwrWrrk++f/////////////////////9uPpWNsGrmHtwwUy3Dp9BqqAAAACXBIWXMAABJ0AAASdAHeZh94AAABzElEQVRIS82W13aDMAxA3U1Hmu42BjPjELr3/39aJVk2ZuTgvuW+RDI3RhImJwLZ2d2bYv+ATCEOj6IAjk9OUT6bcT7F+VyIi6CdiUshrjgM4VrccBTCrbjjKIR78cBRCIvtt2XMgc8GWyYqTTj2GLVlplJA5Zw7xuyiRBcpe+UM7dZFKl419O0YCk7TpdYrKga2r/kK0rWxOUQVlMY13sfr1rdlviIX0Ly0xKRcc+bbXnPucmMW7PbOrmmbFC6rSpolgG07TGvX3FReN35biVlVTUW3Y1vaKryJyUTHxsa5+HZOq0CGGYFtKNokgcpi3zZFA0vMADtL+AZ5pm+23TjYlu0sc6wjNg+gX4nKsryA01HZFCvPTI/Ojgpz1aJK2rzM6aamGMDafZ1IzMnVbv7OdhN3qJx69x9Wa0exa5XQa/q6qwLx7PYRAaY9vwrEt6NIkwHomE6IXwXSte0pKiV13akC6dnmGCkY+LpfBdK3owxsPCyN6r6SxMDGEqCAon0jPIY26DW8G4MqkBEb1Gzwu2MYs2Hy/Nln3N7ENtmPHIXwJJ45CuFFvHIUwGwu3t45nuYD/3CcczLF5xf+5fheBHQ6+/lF9x8I8QeV5XkjAelHyAAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_18: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_19: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAuCAMAAACLUGAGAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAADkUExURQAAAEREREZGRkZGRkZGRkZGRkZGRkdHR0BAQEBAQEVFRUZGRkdHR0ZGRkZGRkZGRkVFRUREREZGRkBAQEZGRkdHR0ZGRkdHR0dHR0ZGRlJSUnR0dKmpqePj4/j4+Onp6aOjo////66uruvr62lpacnJyfz8/O7u7vn5+fb29rOzs/v7+/r6+tnZ2ff395eXl8zMzOHh4YyMjLm5uV1dXYCAgO/v7/X19dbW1uzs7NTU1P39/cXFxUZGRkZGRkZGRkdHR0ZGRkpKSlVVVUdHR0ZGRkZGRkZGRkZGRkZGRkZGRkZGRlZ52u8AAABMdFJOUwA4g7vf16dwFAyT/+tUkftgQOMQmVbCfp/v///////////////////////////////////////////////JhqBdWBgGb7P3dKPHjyhh0En7AAAACXBIWXMAABJ0AAASdAHeZh94AAAB70lEQVRIS6WVeVucMBCHp1XrkbZe1Sp0I7PL7kKjbIuwuvb0vr7/93EiQwII3fj0/QN/JO+zToYQgHjzdmFxDkvvlle0Cqtrwon3H7T9ke/msr4BsMnZga1t+MTRhR3Y5eTCZ1jn5MIe7HNqw+O/JTXb/9KTByJAxL4Y0DUMEYcBT2oqthfIEeJYBBJHfTFmG6PYZ6Fmf1U0p+0IDys2YXRr+xGNxzjgSg7oqu3nUVYq9lGEUTIJaWEeUV79PtmjCTvG9mg0shVa+rSYb5yN7VPV34tYR/+M5GzsFKU6LmKDWEnkxhs7S9O0rRAhcprhaFfpgrHz8XRafWyW3nQ64Ghtamx73ZKWydHa8atsVF09QfXC9nzfD4vYgCbKZlk7y7Lmdi6giYxjpZKuumlB/7vK13Wws5KTFtsJY2fUp3Lpddo6mEeqo5Ix7fzmjs1prHxFaui3IeFsbD2IbQ9zQq095WxXOUNUs5xvDN6EGhiXW9nauhTiTARJkgRikCQnWTiTP2gsKbeEtcVQPwZ9+qjaWYV4aP5jxRbHeurFWaVk+VbWbZH+RJw1Ts3esPIUajZBm1Pv3eLqCX10VWja/2YPfnFy4Tf84eTCXzjn5MD+BVy6//gVfYsvrvlmDje3+ssNcH63xB//bu4fHgHgCT6Gh+Srg0ozAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_70: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAADwUExURQAAAEdHR0VFRUVFRUdHR0ZGRkZGRkBAQElJSUZGRkZGRkZGRkZGRkVFRUZGRkZGRkREREVFRUZGRlJSUoCAgJeXl4yMjF1dXWlpaXR0dEZGRkpKSkZGRujo6P///7m5udzc3EVFRUZGRldXV0lJSfPz89HR0aOjo8XFxa6urkdHR0ZGRmBgYPb29qioqEZGRuLi4svLy8jIyFVVVYaGhm9vb4mJic7Ozvz8/ExMTHJycn19fWZmZmNjY0ZGRkdHR0ZGRkdHR0dHR0ZGRkBAQEZGRkZGRkREREdHR0ZGRkdHR0ZGRkdHR0VFRUZGRkZGRlJspyQAAABQdFJOUwAkXJOfg0wMDnvo/8ZZj/s8Sun/////////txiR/////066/////////3fz////7///////////////////wn6ZVkjnEKBuMZvkelCXv4AsCuFcewAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAY5JREFUSEvtltlWwjAQhqPiOipq16CdVrELiqigiPu+b+//Ns6kERE4LZyjd3wXnST/R9IEKAhibHyikMfk1DSrYmZ2DgZhfoHtRd3LpbgkxPKK7vTBMC3boeqapnQBSqtiLQ364XpISACfa2DAutiAsuNs6vwXTohRnGAI4GHFD9GHLbFd3UGsaeEXPuVsSgMDAJsuBbHr0io83I2LoUHFR8vknC8Ztp2OJmhaaBnSQzPLjikmInQS3iTvsteuqWiPJ6XToK164IVBkFh0W712OhHypDZ1Y0xcjNIoy67wqAxRWljRWYbt0K0mIZm0T5217fJ+RNQbPzYdCvkWnzi/+0zb5ogwO2w6Y/pw0CLfco7dzcju5c/sg5g51KIiw05rokXFyFaM7P+xm2ko4UjVFkBLNTqeYh22YTPNY6iqxgnAqWqcaVHRtgeCbEl2oL4nGZxru8hz55IuXhAXQ9iX4moI+1rcNOr85M6Bf1Tg9k6Ie/WyQXig/xCPT7qTw/MLTU28vr3nUvr4FEJ8AcmHwrUDlp+NAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_80: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAADtUExURQAAAAlkgAlkgwtiggtlgwBqgAligApjggpkggplgg1mgAtkggpkggpkgghggApmgApkgxluijiBmil3kgplggplgpO7yPD19////9Hi54WywQtlgApkgrLO2ODs78LY4KPF0AljggpkgiV1kNXk6WqhswpkggpkgmaesUeLoQpjgleVqXaouV+ZrZvAzA5mhH2tvXmru2Kcry16lB1wjPP4+Z/CziFzjoGvvxZriECGnW6jtbrT3Je9ygpkggllgglkggtlggpjgoy2xApkggxogApkggpkggpigApkghBggAtkgglkgglkggplgsG3j1EAAABPdFJOUwAcVGBEDDzf/68UXPvjIDLR////n4P//////zCw/////2zr////l+///5//////////////////////////zImjYGT/9xa4hTSzEI/Xv2hp/XG/AAAACXBIWXMAABJ0AAASdAHeZh94AAABjElEQVRIS+2WWVPCMBCA471eaIrSbbWHd2tRVLwAb/E+/v/PcXeJBadYYEbf+B662cnX6W4y6UQxI6NjvRifEFOpySnoh+kZlmfnTNqL+YJSC4sm6Ya2ihK05rCk1DLH7uiSjeiQ7yJRAlhRq2Yqi/bQ9nwMADx0fMQQ1tT6xqbvbxnhBy46GrSNRW3bksG22rHoK6EROiHPohBgZKEHENNj93c7YQcgxKSMLugQozy7TNOEh0Wq37HR113svYDZZy2hlGumDtEOaG2ytkcpAeBgTGmEjkXdynrn2SUsAxRtjCNeaiHHTmhDXJ9apT7NXGpXDlzisNK2ySICTWso20+k9hFPIZXatiFxI/YSrl9I7aglJZ12hqGd5c/saswcG1HIsU8knhpRyLFbUc7PN0NbGNr/Y5/xr8o9r0FdBg2AhgzqRhRSuy/Ijsm+kHOSQ63T7smlsa+4kp60Sr1WNwPYt+qu2jqu+dyz3Cyoh0d5rR+e6A7x3N+FA+BFriivb+8mz6H58cnuACj1BXBgoa2rHSgpAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_81: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_90: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAADhUExURQAAAAhkgBVrhxdsiRdriR5xjApkgQhggBBggBZriBRriISxwMHY39Hi56PE0HOmuBJphgpjgxhtiUGHnvD19////xNrhwtlgB1vjODr77HN2BZriBFohoOwwDiBmgpkgkeLoSl3khluii16lSd2kHaouWaesW2itBBohRltik+QpbLO2BpuihFphleVqRtui5O7yJ/Czvv9/VuXq/f6+1+arcnd426jteTu8c3f5Rtvi1qXqwtigg5mhGCarg5mhNXk6Sh3knysvCJ0jhJoh3SnuCFyjmKcr0CHnhhtiQlkgpeD5VgAAABLdFJOUwBAhtvrvoAgEJb6//////r3UIj3///5MPH//Oqk/f//////8sb//+9z7f//qvb/q//////////////O7WCR9v//7O/CU/v2+fbLcArrRZAAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAGMSURBVEhL7ZbZVoMwEECnWiuVgFaTIi4MiVKtKGJd6r6v/f8PcgIora3Ag771vgwJN0MScpIAUZuZrZcx15jXKhjNBZNZZdiLSy1tL69wUQWr7QA4qwWyxVwdXFeHtXWAjU1dnojlIaJPD5KissVWDbZZ+mocV6IfSOwIF6VPDd2dXehyU8q9TBihg4EQHJUI9YOHtr0PByKi72TCMBYqPSKJ3MRQkMXsw9/tGE0dJLoRupwpJYrsjs4oBHpcoVKI8ST7SGpoIJSRiiFG1CXpRdR0gh1QKanw0KJihGbWpWI70DMRo+RR2qVi20L0PKVCIZO5IXK7d+xrWG5TXlR+SK28VB6yeSqZQ7YQLEnKvxZSif2DqT3On9knp8nPPctMTYH9XZEztdM4tf/H7vWzBRomsZ9X5OR2FRLbJ5tOrSLOR+0yLjK7TjtuOcmeHDfhklW2r67h5raf1RRwd08yf3DA6OoDowqPT3QreG5nB0Ux/KVu6EuEU399C8p4b3+kFxSA1qBRxsAxAOATZAviFwbg/hQAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_91: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAHLUExURQAAABBggApjgxFohRtuixpuigpkgQhkgBltij2FnHSnuJO7yHKmtyBxjhZsiQhggA1nhCx5lLLO2P///5K6yApkghptitHi54y3xR1xjA5mg4CuvvD192aesUeLoR9xjSJ0jil3kmqhswlkghhsieDr76PE0BltihFphhluinaouR9xjc3f5Zi+y4aywVKSpz6FnOzz9brT3AtkgqTF0HSnuE+QpfP4+RZriA5mhDR/mFuXq8HY30uNo7bR2qfH0iFzjvv9/eLt8DB8ln6uvYSxwApkgVeVqTiBmix6k5/CzZO7x1qXqwlkgbDN1sXa4RNph0eKoRpviiV1jzeBmTR/l1aTqTN+l2+ktbvU3KrJ1H2svL7W3pvAzESJoAxlg26jtff6+2qhsw1lhOjw84izwiV1kBJphmKcr5/Czn2tvcXb4pK6yB5xjF+ZrTiBmQplgi16lApjgqzL1XiqutPj6UWJoO309h1wjDyEnGuhtESIn9/r74y2xLnT27HO1xpuihdsiV+arWyitA1kgxNphpG6x9zp7a7M1lOSpzeBmRJphrDN1yJzjhhtiTJ9lx5wjBVrhxNrh2Ocr1KSpgtlgBhtiRxwixZsiHBJPm0AAACZdFJOUwAQUISrqoBA7fL7//j12iBy8P///f/u//DQgvf////0wv/rcOz//5j2/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////6j/7mGU+////+v3+dSI9/KG+fr3MMvPuFvQo9MAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAJXSURBVEhLxZb5XxJBGIcHsqyoTKY30laKFFLswkoxl5TM3FLsvqzMTMsOKzvtsOwwu+/DP9f3nXldF6J2+snngx++35kHnGGXXQQSCC4o8WHholIykdLFS5aG/Fi2fEUZySvLw9KEVYB6YHWEqx9rKoSoXMtFWlXRYoR4Wsp1ZWK9u44IFCXG01JuqBY1cc7+dmKjqOWo7LpkAdE8uyTfjnJ0ic+jnQCo34RtM27QMrFhC7atxva2lGzYbmzDDrmTnozsKDQ2pZt3ARjtEh9JaMEDY2TbGVzFbmO7FaAta2qH97TDXom20S5tGbFTZJu9t6qm7/0fdj7zZkNHAVX/tItgYu/j57/aVqczSz3s5+Q4HTxdYHtI4vH8E499oMueozvnaT1dB7XisQ/xMotxWCse+wjwVZI4Csc4IcfhhFY8toNnnEveusPAG/XYJ732KTjNCemFMzq49tkYQPqcini4+wDO91/QpWngIkBmkOKsbTer3QxRloNtGHOQUYVOXOSShZHtLF4NiMvqWj5MMQfQS+WKmgC4ipntazwE17GkRiihfYNsusARN+ds/L7ALRobwOKeLqNk11G6jX+4FLbv0BBxF8s9znCfbIfLyAPXxnNe00rCGBf6R7KFy0PMZNNuH+mhx09IGNdl7CmVZxO60aebeC4q6OYaH6WRdAPNy2yjmtcfpxxS5QXFl6/E5GsKVr/TPjxFCcmO98U69SuRN29jGX2HfRcUgffuDdOHDx/xV8Gnz2a6/UX96Pj67Xso7EfoR22QZCF+Vv767cd0dUAIMQPQKvoQmU5ciwAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_92: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAFEUExURQAAABBggApjgwtigghkgAtlgBhtiRNqhzuDm1CRpU+QpSx5lApkghltihltipK6yPD19////1GRphZsiR1wjbLO2E2OpCd2kQlkgk6PpBxviwhggB9xjGefsRdrieDr74GvviFyjRFphqPE0Btui9Hi58HY3+Tu8ff6+0SJoA5mhHmru6rJ1Ojw8yh3kdjm63aouRJphiFzjoy2xISxwJvAzDiBmp/Cztzp7cHX3xFohT2EnO3z9r7W3mqhs2aesU+QpUeLoV+arb3V3QxlgziBmenx9Ozz9RZriKfH0vv9/WKcrxluipO7yCN0j9Pj6KbG0SByjdPj6VeVqYizwrrT3LvU3DV/mOfw80uNo8Xa4Rpui4y2xBNphkmMoh5wjRhsiRluiWSdsD2FnCd2kCx6lB5wjDF+lhJqhhpvihxwjBtvigLISvwAAABsdFJOUwAQUGBAMMv47/X08P+Y7f3///ba4f/wonDy8CC/5uv/+I32/6v////////////////////////////////////////////////////////////////////////e75Ts8+y6/PLG8fKGdM3gvB99zncAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAGKSURBVEhLtdZnU8IwGMDxFHAXbVUUJ2otAlIFFHGDE0Fx4d57fv/3Qvpc2twlJHDn71X78L9eQlsOVKV4vCI+HFY0Nbe0tgm0d6h+O+7s0nQxrbunEiu9ATgX6etHKDgAJ0La4BAalr20ro8E0WgIjsXGxtEEHEowJhuszTDflJ2QOhJVa4hN44jUcZhzxKx66plZqtYTSfiAJWXgxrVLCY3W1tw8XzqCG1JbtZatqgs4InUGxjyLVL20DGO2lVWq1tfWs3wJfGlXLaPROpDb4Ns0cUPqrW3YD9vOLlWnYcxDf4P5PRizRXHkrFsrGHyBIm6cWoarzof47IfKqYv7MVgiy0EJR6QuwJzj8Iiqj2HMcXJK1cUyzJmSZzhy7dKCHbHA77urluDUkTjcCZZzuyG1loIlsuVwROr63ssLmHJcXlG1nrmGJ5+lfIMbp5bxz/Wt/YbKuLtHfvtplPHgQb5HOBYKPykIPb/AmYD56q3+LXh7N0KaiFn6+MR/OdDXN9yyGn5+PQihP0VBvM/NL/nJAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_93: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAHdUExURQAAABBggAhggBltihxwjBNqhxNrhwpkgid2kBBlhRtvjDyEnNHi5/D19////7LO2B5wjS15kxxwi4OwwD6FnApjgzqDmuDr7xFphiByjSl3kqPE0EeLoRluileVqXaouVaUqRZriH6tvRhtiRptiq7M1hJphjiBmoSxwGaesRtui6TF0Ii0wuLt8EiMokqNo+Pt8YaywQxlg6bG0cTa4St5k2igspO7yGmgs8PZ4KfH0g1mg+Xv8kuNo+Hs8Im0wgtlg+Tu8RZriESJoPv9/YizwsHY3/f6+/P4+S16lNnn67XQ2R5xjE2PpFOSpzN+l2qhs0mMoou1xJG5xyd2kcDX3pC4xoy2xB5xjTeBmejx82qfs3+tvU6OpHysvIizw8Xa4QlkgRNph9Pi6DiBmUCGnWWesBFphpa8yTyDnEeKobbR2iFyjtzp7Qpjgg5mhJvAzFuXq26jte709hVrh6vK1IazwYKwvyFzju3z9a3L1XKmt5i+yjuDm8bb4trn7BJphsnd4zB8loezwmCbrvn7/M3f5R1wjI64xip4krrT3DyEnCV1kHmru6rJ1EmMogtightuixpui6HDzyR0jxhsiWqhszeBmR1xjBpuiil3kg9nhRJqhgtlgAhkgP8dfqsAAACfdFJOUwAQIJjg+Pn/xmLf8f/////zpr3981Du//av////////5+rziO7//////6v/////////////////////////////////////////////////////////////////////////////////////////////////////////////////9//////////0pP//////7GDv3vmP7Ovr0Krt9HQwQG4HH2sAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAK2SURBVEhLjZZnXxNBEIcvII4KOWx4mOMSGwREURTEhhiIAbEriopGYsMesCv23rF3/KzOzE6ODVm9PG9u/ntP8tvdzObOYkIlQSgPCZVOKZsaBEybznLJjPKKsB1EuHLmLLJnz5GBIObit1fNC/5ihVNdYs2vlEBEQOHaNZ7nRaIxR24wC6qshfqAZktVIXeIRYutJVIytS4SgToH7bhb3wBQI3cId6lVLaVPI8AyG+0o1g3gqUHGYC9vghUrc3Zl3lQMdjOsWo0XZdcDaMsqtFtaYQ1dad5tMYAIjyoK7bXQuo6usieevr8F9voN0MxFDeCGx6P6BhbYG9uhaRNXat75TLY7YHOjqoqwE53Q5RDJYuwtamm0bUXYbSIXZzspoduuSOVtBzN5lf/nH7bTFnN7pNYw224nTn1rr6QJjPa27bzSHQnJPkZ7J8t0gCZhtHeJHZPsY7Rp1sRuyT5Ge4/YeyX7GO19Su7bL9nHaCfVSTggcQKjbSf7D8Ih/dAIZtu2Y5CSSkezDw8cob8exVFIS4UMHBNFswd5sj4ZuRLHRdHsE3Cy3ucUnJYKGeoTRbMdaJAKyZu3F5diwu4+A2f9rnPOQdrv2PNDF+Sjvn0xfgkgO8w1d2xGOrZnhGZ+OcnjYl+JAtpw9RoF7tiMdGyaZIDrVOfsWmAbuihwx+KeUMcmshQA6rox5OwbYt+8hYE7Fm3q2NtUEy2aPYqZdXpiUcdSoI51czcGNfsODSB3Kegde09quI8B7QckPHykxh5T0Ds2HFXhyVMMaKtn2jCPxWktdrKLQz/V9jM+Sc95O1+UWi9Va756nX0zKr9I8m0kG3+naru3vdMbUcd/rMp6X85VETgf8E3i4ydJAYTHPtM7xJevec9nM+HUt+8heokI/YCyn0GU/frNMjH+J4hxtCzrL6rW4W9SttgoAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_94: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAC9UExURQAAAAhkgBxvixpuixdriSJ0jhNphghggBBggCt5kyp4k4SxwNHi57LO2ICuvgpkgiJxjhltikKInvD19////xNrhwpjgyZ2kcHY3xBohRNphpK6yDB8lid2kHGlth9yjRltihtuixFphiNzj+Dr72aesRluinaouUeLoZO7yKPE0FeVqSl3khtvi12YrBJnhg5mg2Carit5k3ysvCR1jxNrhXSnuAtlgCFyjmKcr0CHnhhtiQlkggpkgQtigp108zAAAAA/dFJOUwBAmt7rwpQgEKXu////9/9qmPj///lQ6v/1pf31xvZ77av2sf///////////87xY4L27/DEQ/sw9vn2y3CAYL7K0RsAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAFjSURBVEhLzZbZVoMwEECHiloFjBqo1LUqS1vrvtT9/z9LlgEmm+GcvvQ+TeCenGQmGxQ4gw3XxubWdqnCcGfX860Ee2y/tA8OedgHPxoVwzjqJ4dhPAY4PsGGnVMHzmKM7ZxfwKTvQMIwuIQrDHsQXK+7zRMMBEy2l2IgYLCTjPkYUgx2ztgUQ4re9jPGWIANgt6eFjLLsEHQ2kEpMzbDZofWnqcVubKADLM0sLLtZS03+KlBtXmZvQYpi6rtoVghZVGxi5pTxCwqdooakglrUbZjtFqEtSjbVc0FaOeSneQKNC3KuP9lBZsvcKwic/wt2UJhOrosUluoOaXNIrUNXRc0nRNbqjml2dHElmougEnvbKXmlEXtkL55TaKl3qJ0lnbWynb731KzAdz2vwHv7uHhEWMr/MmB4UR3sOt4fileBa+R5qhW4W/j6s2xdN8/cBea+Yy+6gcKwOj7x8bvEgDgD/wzt7p1PlaMAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_95: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAADMUExURQAAAAhggApjgxZriBdtiA5mgwhkgAtightuiz+GnYSxwJO7yIKwvzyEnBhtigtlgA1nhCx6lNHi5////5K6yApkghptip7BzSByjRFohYCuviFyjiN0j7LO2G6jtRZsiBhsieDr7xpuihFphiNzj8HY3yl3kkeLoaPE0BluivD19ziBmleVqWaesXaouRtuix1xjH2tvRpvihNphpG6xzyEmxBggBJphrHN1yR1jxhtiTJ9lx5wjBhtiWOcr0OInxhtiRxwixZsiAlkgp3aFBEAAABEdFJOUwAgUJa5gkBg7/X///vx3DBy8f///f/u8dKE9/bD//F27P+q9rH/////////////q9DyeJT78BD3+9aI9/J3+vnLz7hwdLvBXwAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAaRJREFUSEvFltlWgzAURdNqHUCtgtc5aq0MCbTOdZ7//58M5QJJuAgvLvfTSbvpSu7JassUvf7CYhuDpcxULK+sOm4ba+sbw0ze3PL8LmxDT21jp5vs+7t7jO0f4KKdwyE74pjbOT5hpyPM7fAzNsbYAX7+DzZ5mCY7CDEYNNkRxJh0GmwOIDDq0LZMIAEHFxq07UIqAeoHJW0pwPMdSHFZQdoOTNQjoXrEgrJHQmSbiCHJ1xWUPcEDhmDfTsIOQMh54GBXRNgRhGkO2BXVbQ4iLLArqtmqmABjNpwpppyarYrBpFBTNCqybSmEPuXYrMi2Het6JEZFlq2KyadX4BkVWXZRTEWqV2TaqpjAM1Ev4ZsK046AoqrIsDkkTh1Rfbhuy8SYXkFcVaTbrtVcQVJWpNlShOb0CoKyIs12yC+FjLSoqLJHIspDHVlUVNkT4LIJBysq7QCH20A+xdLm09+Z71w7ZQf+2qY7oYgv2CV1OWiurtnNLeZ27vpsdk/+xhA8PM4Ye3rupgcv8z8dr/Dm8jbc93E/kxkbDj4+2/j67jHGfgAIb8CdFdReCAAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_96: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_99: "<image href='data:image/png;base64,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' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_21: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACrUExURQAAAACAgApigAhkgAhggAplggpkggpkggpjgglkggtjgwpkggpkgw1mgAhigAplgQtkggtjggpkgg1mgAtkgwpigQpkggtkggpjgkeLodHi5/D198LY4GaesYWywf///7LO2Cl3kqPF0JO7yHaoueDs7ziBmleVqRluikSJoAplggpkggplggtkggpkgQpkggplgwpkggpkgglkgAxjgAlkggBqgAligAtlgPjoBdoAAAA5dFJOUwAENEAgr/P/34dI788UIsORdPsoqGXjj5///////////////////////5OraHjJl0z32xwsvww8MMiZ/UUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAINSURBVEhLlZbrQqMwEEZTdcX7qlVXCAUiV+ttve6+/5PtzOQLkLIUPH+akNMwMxlaFLPY2Z1iT0Ri78d+MM3B4YLlo2PMpzg5VersJybTnCt1geEMLpfqCsM5XKsbjObwS83Nkbn17DDS/BHHK5kO8OwkTdPMGP64wyUfz85JAxku+Xh2AZXIccmnb5sSKqErXPRo7SqvezLpRTJMtbVjSHlYFxpju9LD2ZUVIsOTBncZbO5sm6CL1shsmKqzm4yX2yrLl2O5UZ827oDvXmMcNGwP5J4d0XpXNpoMk9zYu7U58G12TetpYceYJZh0OHvFy6l2oUrO4zWRzagMMnENM9i8jQQHktHuxvUijf12ae1E4+xLfC/SVH064iy0AtPaRGg1S26y+6bmHXqt3reDOysyWUP1t92FXBjP7j0Nia2K0DWXZ3N2ZZ5w4DEfbaojSaKoGyt4tqFQKCdqkjjkknJbVeKjlp5Na1KAiupGUZWyo3QvMt2wOyhu9AHnjp4Zs0OqB06Gf17QEiO2lB42xZT9L8sOeRoQCcXkajgWCR+MvT13p41j3JZj1augkZ+LKZs09oF7ukdtrw+m4mbkFHWku2dom80RF01gRrpqgzApIwzBNnvI7bf+09bqAaM5PKonjOawVMtnDKd5oXeI36+YTPH2zq8cH5+XmG/jeP3FMvH1B2844/wlTal//Dx0mgN5aKMAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_22: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAClUExURQAAAACAgAlkggpkggpkggpkggpjggpjggtjgwdjgApkgwplggBddApjggtjgwljggpkggtggApkgQtlgQpkgQplgkeKoZO7yGadsSl3ktHh5//+/+Dr7ziBmvD096PF0MLX4BluirLO2IWxwVeUqXanuQpkggpkggllggllggligAhjhApkggpkggBqgAtjggxjgApkgwpkggpjggtmgwtiggtkgtPn2SkAAAA3dFJOUwAEcLfz/9+fSCTLkwuseVjvGJ5bx4P/////////////////////m7Vyizw+3asMdCxp1rRGYFyTAXWjAAAACXBIWXMAABJ0AAASdAHeZh94AAAByElEQVRIS72W2VrCMBBGBwVxF7du6UJbcEHF3fd/NLP8SYa20nqh54bJ9HzpJJn0g4hGO7vjSR97032pEh0cItHH0Yjo+ASDfk6JzhAOYHZOFwiHcElXiIZwTTNEQ5j+rx2Egf6Nwlj/Mlp2kAiRqiATQjT9pp3lUhJFkAVzFSRIg6ZdKsdTIQ1alaTwDCGyoGnHuhLH9kpKXS1jc3Jml3UUVJA8YVYvIGzYNZ5L8qrgL3H7yGy3vjwq1XiJISvH2ws8Eql2JQESIkeC2XaqPENCnj1SwrQCt+1MBcYKFDe3b2N1l+aZnUcR6kxoZW6jFgw0Zi2+tbity9T9Z1F9KISbum279SvMWrptczy8pc2m+E3ydhmahoowVphGSNzRe9vuNys8Rsq9z9vuKGokWEO2bX9rlki4hnQ3iK2ywDNZaBSXQe3vRUfdcnOTdnvL5vVtxm35bt92llSW3L3fCnYlFKwhFU37d3e+YfP2lTRt00d5MpcfOEnPt2qiLF2tPq2+SiaLxDhlmleba+yyZXtgy3g3Grrsn/lL+4ZuEQ3hju4RDWFFD48I+3laEz0j7mX8ov5yvL5huJ33D/0Hhdarz16+5MRE3zlwZxhd1+UEAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_23: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAC6UExURQAAAAtlgAtkggpkgglkggpjggtiggtggAhjhAllggpkggpkggpkggplggpkgwpjggllgQlkghluigtkgglmgApkgYWxweDr77LO2PD098LX4FeUqQlkgv/+/6PF0JO7yNHh5wtlgwpkgil3kgpkgjiBmmadsXanuUeKodHi54Wywf////D193aoucLY4EeLoVeVqWaeseDs7wplggpkgwllgQllggpkggpjgQdjgAlkggpjgwpmgwpkghu6kycAAAA+dFJOUwAweLO/n2AYH4nz/9JolGJR8v/AHpT///////+8/////3n3/+///////////////////3yWU1b1wySjUGeXbzg57wAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAnZJREFUSEuVlolymzAQhtU27kWPRG0dsAtKqxAbJDCm9/X+r9Vd6ZcUy55x+80EluVDWh3ECOLBw0cX51g8fsKqePrsefEvvHjJ9itcnee1EJdXiBMS55w3b8U7hBG5vC7pWK3WSCQuxXtEkXVd1426oSMSiQ/iI6KIJs9xg0RiIW4RRZaQ67pFJpLbd0pBJaqN0sh7cpvLpbJbvfbRBnlPZrdOUS52euXCQGbrazJo/lzMNmKQVyLJuENMjR/KR3ZRpVpXNACE4FTbS8RlXa8QgrxuHhpWRVI3WeOZ7efElSKp6Xw980p4TmgKtdxS1USoypPb26ZxlqNS5eHi5zaR9KMte8KOezCbEOKEvWVR8QCQSJywiw0voaxXYU0Tp2xScc45tHWXvwD9wfIc2r1pC23DGzCMRaHMDldMtDU50nZFMdpQx2T2hTTceOgx2j2NbDK9+wt01M3MD1t0EO2Gmi2NlnZOQ2yp4T11oM3kE8m2rpDeDLSf+Ga594+bkp7KbWWpCOWaVu4mH1tSZ75xZBs1mrGhqgdSCGm5arO3pi/DxNyzPbq1mJTJcGGeo1Ei39nQLVXdzcjmdom8Mf6/CSE7ZAwN3RFsaZE3Y5pBjZTxI0n2hHTs1BHKM9ZfBzvmaZESEsnQRrDDcNy2SMT6/HYINpLGzLodet6Fu37SOyRD4bDTeBy0VVMRDl8g7DRIwo60RWh349LjZgp2mu1xSDO4CwtMcANk869ULGTGMkTC0vvCF+LCZQdeN3uv3YDmubWjf3s+ic/uTFu/sUe/YY6+i418EV+/ITzP9x9C/ER8nl//88Xxm784+GtmcZY/9DUjxF8TnKeBi0g2CwAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_24: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACuUExURQAAAACAgAlkgAtjggpkgQtigghggApjggpkggpkggpkggxkgwpkggxjgAhjhApkggpkggBqgAllggligApkggljgwpkggpkggpjghluikeLoXaouYWywbLO2NHi5////+Ds71eVqSl3kqPF0DiBmpO7yGaesfD198LY4ApkgQpkgQpkgwtlgQljggtggABddApjggtjgwdjgApkgwplgglkggpkggpjgglkggtjgxIrlN0AAAA6dFJOUwAEOHSAYCBkzv+tQvMsPt2rDIs8tXHvm5//////////////////////x4SeW1gYC6x5JMuTcLff10iKM4AtAAAACXBIWXMAABJ0AAASdAHeZh94AAAB50lEQVRIS+WWaY+bMBCGnW6v6bXdHtsYAgMEML3v6///sb5jj82hSrgfq30UFPv1E2yPQYoBh1sXt/e4c1dMcO8+5fDgocgX2tvl0WNjnlxqZ5+nV+aZNnN4bl5oK4eX5lpbObz6J/t4w2yLqyhDe8aeJI/MdgWzqrWTsIy4abU321whxrVBYrk8ye74TD0PRGUXAjAWRLUjcnHKZItZcovvee0TzIEtuUYDb1vsROwz93TCLyIDd+gX1OBX1OPydolej5VUGJ3cXIQW84y4Gty7kNzbLY+wK7lHz5OqwHKDsYHwRVWyLbbRsSvYYeKTqkLDXc81PtQ5qUvYJRbcs3B2WMzMyPUksdxFthNsqI23GbdZYDXEqC9LsDFlBBVfsMnVHjTjRf2ETa72qNnWPmvKYTtqt5qxnOSIUsgGIVSaYp8LO1REqFsYrvCzDa0LIbb5d1uY5JTHZAoru9NQcKWefVoGCIVVOxUW8vKpSoTnQW1K0y7kZUnCMUTbH7Aw+m4kLSbE0Y6Tro8Sr47meItAtHXOrUxWz35t65RSujWnMBBev2h3vce314SB8BxHO4//19ZGFkfzWls5vDFvtZXDO/NeWxlcfzAfP2l7n8/4D/Hlq3b2+HaQvxyH7z9+7vLr+NsY8wcC5IgiV3dvbwAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_25: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAJPUExURQAAAACAgApigAhkgAdjgAlkggpkggpkggpkggtkggBggAtjgwpkgg5mhFOSpwpkgw1mgAdlgApkgxZriMLY4P///5C4xgplggtkgj2EnLLO2JO7yB5xjA1mgApkgkiMor7W3p7CzSl3kgpjgwpkglSTqMnd5KnI0zN+lwpkgmCartXk6bPP2D+FnQpjgmuhtN/r77/W3kmMonepuevy9Q1mg4Kwv/b6+9Tk6V+ZrRhtiY63xd7q7mmgs3aouTiBmhluipe9yoGvv26jtfv9/ezz9S16lDF9lm2jtOTu8UeLodHi5yt5k2aesaLEz93q7uDs75/Czn2tvcXb4tzp7Yi0wkSInyR0j5vAzNfl6luXq6fH0leVqTuDm7HO1+3z9s7g5pK6yFiVqiBxjUuNo5m/yzR/mOLt8KjI0myitDB8lh1wjGqhs7bR2vf6+xJphrrT3IWywa/N1nSnuDmCmmKcr6rK1PP4+fD190yOpLzU3fP3+bfR2nysvEGHniZ2kGCbrpzAzdjm68bb4mSdsNPj6Pr8/cDX34SxwBJohiNzj3usvOry9Mfc44y2xFGRpit4k4+4xtLi6MHX30eKoSByjabG0enx9EWJoDeBmXmru73V3UOInyV1kBNqhk6PpZG5xzyEmyJzjmWesbjS29nn6yFzjiN0j5G6x0+QpRRqhxFohWGbr+/198ve5ePt8WOdsMzf5avK1DaAmaHDzyx5kwtkgpa9ygplgwtjgjV/mApkgghigAplg67M1gtkgghggAplggpjgglkggtggKswJzYAAADFdFJOUwAENEAkv/f/648ISPP//88UJsX/////k3j/////KKv/////Z+P/////7/////+f////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////qf9ldP/7IsP/kSCv34cYS0gqegAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAs5JREFUSEullvdbEzEch4OiFbU4zoiCiJ5SlCqKooKLArYKOIoDC9QBouJAQFlFwQ1OHDjrRNx774HjDzOXfK43Su3jw/tD+x3vkyd3adIQhYg+fcMRyUVGZL/+lvAMiBqoyIMGI9ewRiMwMGQoIcOGI9GQRtCRCA3EEDIKocboWEpp3BhkeuLJWEQBEsYxmdLxMnIdE8hERCqJNi5TmjQJFY0YMhkRSLZDpnTKVNQCpJjsadOhKqTOQFXFZM9MgyiwJaIODPas2XOgqaRnoCXQ23PnwdExfwGaHPO8F8ISZKKq0ivb+h+2Iys7ZxFEjnk5dbY1x0ljXYuXJOXCZWNnuNAUaHaeWMT87Myly5av4DHNdFN3QYYDht52rVwlFLp6TeHaZE8Ri5itYCuGE7DtJV5p3cL1G3ibbiwt21TuyZXzebbZtUVIAZvVt1Zs275jZ+UublBnQXSVlY+d7aiuEZLeZqTt3lMr1dU38IQ2lDSyD6+vifZsM/bua27Zf+DgIaSHvUeO0tA2o7XtWMLx8gLlTdpOnDzFvv5lK5xuPyMVxnnOlvLMbIt3ZSDXk8d2Pyfc2JxGB4Le2eJYMOEOZVt8586jpaGO3XFBOJptsVysu3RZdFVgp16BobcZV/3XeB8Iu+k6umbbcuPmrdvp3FTgdnULesF2jTOr805XBY4Vxb6rO7HMtrIv25pra5tTuS3Te/fRUejJZr/WpK4HnVlO6pYNcgibYX/46HGxRzLIwfOGrGD3V6GqoretsizHwRQUynLImTypaYWlUfQUTY5xJv5nkFSee9ERmOad8wKaoMOHOjA/5Ut1PypUaqsoMNuWsldQKX39BrUAKUH/ab4OyG/foaIRRd4jCtBSyeUPxoXhfCSfEGl8rmdyu4RMx5d48vUbYg3pO/UjNPBDuUOYnpMR+g5BSPfP4DtHML9+RygyI6I7LH+YRshfLCv22HO83lcAAAAASUVORK5CYII=' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_26: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACxUExURQAAAABqgApkgQpkgwpkggpkggpkggplgglkgw1mgAlkggtlggBggBBggApkggpkgwtkggpkggtggApkgwtlhApkgwplgQpjgkeLobLO2MLY4FeVqTiBmqPF0P///xluipO7yPD192aesXaoudHi5yl3koWyweDs7wpkggpkggllgwlkggligAliggpkgQtkgwBtbQtjggpkggxjgApjgwpkgghggACAgAlkgAtiggljgl0y1+AAAAA7dFJOUwAMgMf7/++vVCjXpwgQsn9c9xigXcmGn/////////////////////+Xs2+HPDnbqAd08yxQ6yAEOGBYlD+uPwAAAAlwSFlzAAASdAAAEnQB3mYfeAAAAcpJREFUSEvdltd6hCAQRifZsOm9WVBEXTe99/d/sDDDKFgSvU3O1QBH/Bnc71sAWFmdrYkx5usbRgXY3OKJMbZ3AHb3eDDOPsABlxM4PIJjLqdwAqdcTeEM5lxN4fyf2UEYxVx6DNsySQ2J4mHDkK0yjXKa6pxnavq2KthFygXPWnp2ULLIVDxPdOwgJCUUCxnHeVWZ15SS1wwtuwmcRnxAejiztcGzneu6Qb1xp3V2vMQFTF26Tlu7eby2lQ2c5oUuvDZndjbVtjm1zXJaCOfKgm2zgSpwhu2YZg2uYXiMiJJgMkXR2a63ThMcIa7vlDmgV7LdLIU4wo15bFJgBmUPznazWAZ0HBXxOMqX5n6k3bp3SmQZhUlFb9NVQneQ8dFr2+3uUeb2mab/jS0qEnwy/ExMGPcdOtt10aJzm65OgXi2CGiVweMZXArEt4VsPitd2GBeCqRlC0n70Y6Uy0+BtG2h7DWZazax2imQjm2vBS+06qZAujbdE35FupsC6dvmnqRQSS8FMmCLKgnyfgpkyBbS+5m3GLR/5K/aF3DJ1RSu4JqrKdzA7R2X49w/ADxyPcrTM/7leHnl4e/M3ugPCrx/fI7yZVyAbzKJawGcJj79AAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_27: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAEIUExURQAAAAhkgAlkggpkgglkggplgglkgghggA1mgApkgwpkgwpkggpkggljgwCAgApjgwpmgwpkggBggApkgwllgQplggpkggpjggpkgkeLoYWywTiBmsLY4P////D195O7yFeVqaPF0LLO2BluinaouSl3kuDs72aesdHi50SJoDaAmZvAzEuNoyR1kPv9/UyOpCd3kR9xje3z9r3V3XCktr7W3l+ZrWqhszB8lkCGnTyEmyV1kPP4+VuXq3mru0SIn2SdsLjS222itDR/mNrn7EmMop/CzglkggtlgwpkgQllgQtkgwtkgglmgApjgwhjhAllggpkggpkggtlgAtkggpkggtiggtggEwv31UAAABYdFJOUwBAh7u/r3AgKJL8/9txBppn4wiWU3z3n+//////////////////////////////////////////////////////////////vXmUUfLAHlAfifPSMHiXYBgGGfIMAAAACXBIWXMAABJ0AAASdAHeZh94AAACUklEQVRIS5WWZ2OVMBSGo9YZ97oGSFgBYlVaV621zjrr3v//n/gmOaxbbsHnA5xcnpCTeWHgyNFja1McP3HSquzU6TN8DmfPnYd9gUrTXEQaFM7g0mV2hcI5XGVrFM3hGrtO0RwW7AZFczhoiyCk6CDLtoiklCpOqLjE0A5TuJ5srIm+nceKVI+KBT1p6Oxl15Ppgp5bWrsIg5KMJaKuidauyjgUo68HsXd6Nn40QZF0/WxRWgReGtggOlhBJVrRy5dtkOm8X8HYYV1tg6zi2k4TSIXB9VAb+ApI2XV8ygZZkofaj9LQzqsRG4R0j/POzitlJuwUfScbuakioW4N6GxpsASsLeJCl+hWbwU2kK1uRqaIyEaHhEhlGeSoNcDb5XpmCqNaG5NQFRot2lo9nG0ghxjN1jZFLoxLyGCcuwas7eQMLXg7L2VyS5a3I5+QjLsew25khd1nbQzKnVrKegPvREKBncgwJttsRk6WVTPenN+9h/L9B85wCZWx63FoNo2XtdXI5g+tt2EvIA3tIrRp5etl6WQ/9Y0tkIrcardO5FJBWgO5tfmjWtbbzXCoLFM+FS+nfpl0Nt/Wj+3N+cnO1pPMjk3sZENyz25JIrNTy92n8CI3V608ZuPIeganfo5WNDZOJ4/b/AVs+fKVs8ve8TNu7722+htrq/5xOG5zm4rE/tXR4LRdYfO3Uu7mXCfDg3aVzYXeo6jHSnuUxX/+S72jaA7v2QeK5rDP9j9SOM2nz4wtKJ7mC74hvn77TqXD+YFPCMvPX4tJfv/5yxj7B8uTshMb0WcNAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_28: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAyCAMAAAD/RKLmAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAGYUExURQAAAABqgAtjgwpjggpkgQlkggtlgABVVQllgwlkggpkggpjggpmgQpkgglkgAhlggpkggpkggBidgllggligApkggljgwpkggpkggpjghluileVqVuXqyV1kCt5k5S8yf3+/v///6jI0j6FnBJphtHi5+jw8yl3koWywaHDzxZriPf6+ziBmi16lIy2xLbR2kqNo3Gltk+QpfP4+ezz9USIn2qhs5e9yjyEm9Dh58LZ4FmWqn+uvnqru2CbrnaouTJ+l0eLoaPF0IGvv/D19xBohcTa4ZK6yHipurLO2MLY4OPt8Wefsl+ZrUCGnZO7yODs72Carsjc49vp7XOmt7DN16TF0A5mhCFzjjB8lqbG0Z/CzjmCmmaesUyOpOXv8uTu8brT3Ii0wou1xIq1w/7+/9bl6myitJq/zPn7/H2tvV6Zrfb6+73V3a7M1tXk6arK1Im0wx1wjBZsiLzU3W+ktXmruyR0j4OxwApkgQpkgQpkgwtlgQljggtggABddApjggtjgwdjgApkgwplggCAgApkggpjgpSTl+EAAACIdFJOUwAMSHyAcDADbdf/tkv3OD/hrg2LPLVx75uf///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////HhJ5bWBgLrHkky5MEt9+hn0CWAAAACXBIWXMAABJ0AAASdAHeZh94AAACZElEQVRIS9WW+VPTQBTHVxCV531idwFdJE2V1qJVQVFiaTwSldaTooL1whPv+8QD+bd5b/PqkHRi4i/O+Jnp9L1vPt1sdpNOBLKsrX15Eh0ryBRi5apOSMPqNWS3c5fI2nVCrN/ATTIbN4nNXKZhi9jKVRq2iS6u0rD9r+zMv7Sl6u7hspWI3btjp9a6bxe3UcJ2v4UukrU5iBC2c4Gs9W4OIoTsPQMsa53nKKCwt5ijqwnZg6wi+zgy7C9hcuBgxD4UmMQQR8TwYRMd6Q3bIyY1HOWIOMbZKNtSOQq/jnOMjGBrqzLJMMZZJbBzLjUOnOgzKXKyAHkLU9dB+xSHp8mWHnc+DJ7h8iw4ZgStLQnngkqPk4074vrVGraWPH+B4ouXoIpfrh+E8jKF+grYaNe0qybsCYWDWbLueMXKpKSpViUAhbX8+FVsr10ve2RbtirpkpJ4kprZFZLdKaqAQjcPk902TLk+2p6cvoG/bUzTEY1SmQwFasi6eavQDCXOjWyA2xhofccMhCJ9lF29S83MPelTTwukq8YOFnQMT8xLa9lwP6j0g9FmiHMzdsV0D2meCg/5joRHj02GzPaAwuFdHy/J2DKLaRaXwGDu7eYeILTLsmxSY4P95Omz8AMwwyrynCMksFt4wSZR5AyJsV82WEWW3LwxNrxiFXnNERJnv2FV64Elfxhx9ttZlvU7Tog4G4Z55l4/B0SsDXUPn92G2bLfxNtIvs5Fkz/aLfy/NhepyIj3XKXhg/jIVRo+ic9cpaDri/g6x3Uy3/Ad4vsPbpL4OU+vHPMdvxYS6cy0CSEWASxzw3ESbjkjAAAAAElFTkSuQmCC' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
    ptk_29: "<image href='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAzCAMAAAA0GHFDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAD2UExURQAAAABogABkgABqgABggABngABmgABmgABmgABmgABmgABmgACAgABiiQBmgABmgABngABmgABmgABmgABngQBlgABmgBBwiFCWqICzwNXm6q/P13CpuNjo7GCgsMPb4dLk6SB5kDCDmLTS2kCMoOXv8vv9/fv8/f///+fx8/z9/Y+8x/n7/Pb6+/X5+v3+/oi4xPb6+r/Z3+ny9Pf6+6XJ0vP4+bnV3Pr8/Mfd45/Fz/L3+ePu8fT4+vj7+5bAywBmgABmgABngABlgABlgABlgABmgAD//wBmgABmgABmgABmgABmgABmgABlgABmgABqgABogFl8+aUAAABSdFJOUwAsQBgQn+//33AorwQNrHpc855axIH7///////////////////////////////////////////////////////3wHyaVkzrAaBuy4+Az79QDCDhUXOgAAAACXBIWXMAABJ0AAASdAHeZh94AAACJklEQVRIS7WWWXebMBBG1Tqu0jZd0g2zGxnDAI7duG5L3Czd9/X//5mOxSCBcYry0Pvg88lzj9CCdGCSa9f7GFQiY3vDG7yf/ZtSvrVP7T5uHzB25y41+rnH2H2KBhwO2AOKJjxkjyiZ8Jg9oWTCkJmsXk3Ltka243LP9/2Ah74/joQzsWMqbmjaYpqkkHE7gbzgGQAIATADl8pIwx4dzdBAew4zbaPvW2Q0bGtThxztPE0KPl2kZEOuetf202PsZjqxeVwURcA9/I0seyl9QY62nwGsnqtnKsQL7MSmhrIj7GLelTkPcDYvKSs7LgFOqtjGwm6OKCs7wD/XVdziFVboocq24jiuJ9NGYIWinqUJyh5Ns6yeehsny04pant12bjnOG6K2sZ1vYIN6WK3fZanHVvI/d6FjRWKyjZC9+26rlfFLdZYoajH/T/XJLmKHY8dp556m6XjjCkq2whliyAIdr+DWKg3Qo97VV4y7gzPyfb7PcL/6gPVYnN2zigrWx6oqMotvMYR1LPEM5+G3WMc4wKW3ffEzvGeAbfgI9zpQO53FK3983O8OXactFMci7zZElg0bzY4viCjacey1L0HVydqfA2bCx/K7Tu2TOBCT6Zp4zIW4YQHyzD0+DoMwyhaTrzmlrXtPobsNSUThuwNJRPesneUTHjPPlAy4OMe+/SZcj9f8Bti8JUafXyTnxwH339Q+x8c/vwl5Q2///SB3yaMsb+aYoBYZllg9gAAAABJRU5ErkJggg==' width='24' height='24' preserveAspectRatio='xMidYMid meet'/>",
  };

const PROCESS_TYPES = [
    { name: '01 Getaktet, aktiv', sym: 'ptk_1', ptyp: 'Automatik Prozess (starr verkettet, getaktet)', hwart: 'TIA/BF · Aktiv' },
    { name: '02 Automatik, aktiv', sym: 'ptk_2', ptyp: 'Automatik Prozess', hwart: 'TIA/BF · Aktiv' },
    { name: '03 Semiauto, aktiv', sym: 'ptk_3', ptyp: 'Semi-Automatikprozess', hwart: 'TIA/BF · Aktiv' },
    { name: '04 Hand, aktiv', sym: 'ptk_4', ptyp: 'Manueller Prozess', hwart: 'TIA/BF · Aktiv' },
    { name: '05 Umsetzen, aktiv', sym: 'ptk_5', ptyp: 'Belade Prozess (Roboter, Lader…)', hwart: 'TIA/BF · Aktiv' },
    { name: '06 Transport, aktiv', sym: 'ptk_6', ptyp: 'Transport, Zuführung, Nacharbeit, Einschleusung , Ausschleusung', hwart: 'TIA/BF · Aktiv' },
    { name: '07 FTS, aktiv', sym: 'ptk_7', ptyp: 'Fahrerloser Transport', hwart: 'MSB/PLC · Aktiv' },
    { name: '08 Durchlauf, aktiv', sym: 'ptk_8', ptyp: 'Durchlaufprozess (ohne Taktung)', hwart: 'TIA/BF · Aktiv' },
    { name: '09 Universal, aktiv', sym: 'ptk_9', ptyp: 'Universeller Prozesstyp', hwart: 'TIA/BF · Aktiv' },
    { name: '11 Getaktet, passiv', sym: 'ptk_11', ptyp: 'Automatik Prozess (starr verkettet, getaktet)', hwart: 'TIA/BF · Passiv' },
    { name: '12 Automatik, passiv', sym: 'ptk_12', ptyp: 'Automatik Prozess', hwart: 'TIA/BF · Passiv' },
    { name: '13 Semiauto, passiv', sym: 'ptk_13', ptyp: 'Semi-Automatikprozess', hwart: 'TIA/BF · Passiv' },
    { name: '14 Hand, passiv', sym: 'ptk_14', ptyp: 'Manueller Prozess', hwart: 'TIA/BF · Passiv' },
    { name: '15 Umsetzen, passiv', sym: 'ptk_15', ptyp: 'Belade Prozess (Roboter, Lader…)', hwart: 'TIA/BF · Passiv' },
    { name: '16 Transport, passiv', sym: 'ptk_16', ptyp: 'Transport, Zuführung, Nacharbeit', hwart: 'TIA/BF · Passiv' },
    { name: '18 Durchlauf, passiv', sym: 'ptk_18', ptyp: 'Durchlaufprozess (ohne Taktung)', hwart: 'TIA/BF · Passiv' },
    { name: '19 Universal, passiv', sym: 'ptk_19', ptyp: 'Universeller Prozesstyp', hwart: 'TIA/BF · Passiv' },
    { name: '70 #OP, passiv', sym: 'ptk_70', ptyp: 'KPI Bereich OP', hwart: 'TIA/BF · Passiv' },
    { name: '80 #OP, aktiv', sym: 'ptk_80', ptyp: 'KPI Bereich OP', hwart: 'TIA · Aktiv' },
    { name: '81 #M, aktiv', sym: 'ptk_81', ptyp: 'IR, Lader (Physisch)', hwart: 'TIA · Aktiv' },
    { name: '90 #OP, SDE', sym: 'ptk_90', ptyp: 'KPI Bereich OP', hwart: '[SDE] · SDE' },
    { name: '91 #M, SDE', sym: 'ptk_91', ptyp: 'IR, Lader (Physisch)', hwart: '[SDE] · SDE' },
    { name: '92 $Parallel, SDE', sym: 'ptk_92', ptyp: '92 $Parallel, SDE', hwart: '[SDE] · SDE' },
    { name: '93 #Zählpunkt, SDE', sym: 'ptk_93', ptyp: '#Zählpunkt', hwart: '[SDE] · SDE' },
    { name: '94 ID Puffer FIFO, SDE', sym: 'ptk_94', ptyp: 'FIFO Puffer / Bestand', hwart: '[SDE] · SDE' },
    { name: '95 Counter Puffer, SDE', sym: 'ptk_95', ptyp: 'virtueller Puffer', hwart: '[SDE] · SDE' },
    { name: '96 ID Puffer NonFIFO, SDE', sym: 'ptk_96', ptyp: 'NON FIFO Puffer/Bestand', hwart: '[SDE] · SDE' },
    { name: '99 Roboter, XML', sym: 'ptk_99', ptyp: 'Direkte Roboterschnittstelle', hwart: 'KUKA/ABB · XML' },
    { name: '21 Getaktet, TCP', sym: 'ptk_21', ptyp: 'Automatik Prozess (starr verkettet, getaktet)', hwart: 'PLC/TCP · Aktiv' },
    { name: '22 Automatik, TCP', sym: 'ptk_22', ptyp: 'Automatik Prozess', hwart: 'PLC/TCP · Aktiv' },
    { name: '23 Semiauto, TCP', sym: 'ptk_23', ptyp: 'Semi-Automatikprozess', hwart: 'PLC/TCP · Aktiv' },
    { name: '24 Hand, TCP', sym: 'ptk_24', ptyp: 'Manueller Prozess', hwart: 'PLC/TCP · Aktiv' },
    { name: '25 Umsetzen, TCP', sym: 'ptk_25', ptyp: 'Belade Prozess (Roboter, Lader…)', hwart: 'PLC/TCP · Aktiv' },
    { name: '26 Transport, TCP', sym: 'ptk_26', ptyp: 'Transport, Zuführung, Nacharbeit', hwart: 'PLC/TCP · Aktiv' },
    { name: '27 FTS, TCP', sym: 'ptk_27', ptyp: 'Fahrerloser Transport', hwart: 'PLC/TCP · Aktiv' },
    { name: '28 Durchlauf, TCP', sym: 'ptk_28', ptyp: 'Durchlaufprozess (ohne Taktung)', hwart: 'PLC/TCP · Aktiv' },
    { name: '29 Universal, TCP', sym: 'ptk_29', ptyp: 'Universeller Prozesstyp', hwart: 'PLC/TCP · Aktiv' },
  ];
  const PROCESS_META = { soft: '#EAF1F6', action: 'PROZESSTYP SETZEN', palette: PROCESS_TYPES.map((p) => [p.name, p.sym]) };
  function processTypeByName(name) { const base = String(name || '').replace(/_\d+$/, ''); return PROCESS_TYPES.find((p) => p.name === base) || null; }

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
      const chips = o.metatags.map((m) => m.value).filter(Boolean);
      return '<div class="placed" data-obj="' + o.id + '" style="left:' + (o.x * 100) + '%;top:' + (o.y * 100) + '%;color:' + esc(objIconColor(o)) + '"'
        + ' title="' + esc(o.name) + ' — ziehen zum Verschieben · Doppelklick für Metatags">'
        + '<span class="p-sym"><svg width="26" height="26" viewBox="0 0 24 24">' + (SYM[o.symbolType] || SYM.box) + '</svg></span>'
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

    const pal = (meta.palette || []).map(([name, sym]) =>
      '<div class="pal-item" style="color:' + L.color + '" draggable="true" data-sym="' + sym + '" data-name="' + esc(name) + '" data-color="' + L.color + '" data-act="pal-hint" title="Auf das Layout ziehen">'
      + '<div class="sym"><svg width="22" height="22" viewBox="0 0 24 24">' + (SYM[sym] || SYM.box) + '</svg></div><span>' + esc(name) + '</span></div>').join('');

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
      + (canEdit() ? '<div class="palette"><h4>Palette · ' + esc(L.code) + '</h4><div class="pal-grid">' + pal + '</div></div>' : '')
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
          const upd = await Api.setMetatags(obj.id, [
            { position: 1, label: 'Prozesstyp', value: pt.ptyp },
            { position: 2, label: 'Hardware · Art', value: pt.hwart },
          ]);
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
    if (o.symbolType === 'robot') {
      $('mBody').innerHTML = tagFieldSelect('mTag1', 'Safe Funktion', ROBOT_RISK, v1) + tagFieldSelect('mTag2', 'Technologie', ROBOT_TECH, v2);
    } else {
      $('mBody').innerHTML = tagFieldInput('mTag1', 'Metatag 1', v1) + tagFieldInput('mTag2', 'Metatag 2', v2);
    }
    $('tagModal').style.display = 'flex';
    setTimeout(() => { const f = $('mTag1'); if (f) { f.focus(); if (f.tagName === 'INPUT') f.select(); } }, 60);
  }
  async function saveTags() {
    const o = (state.detail.objects || []).find((x) => x.id === state.modalObjId);
    if (!o) { closeTagModal(); return; }
    const e1 = $('mTag1'), e2 = $('mTag2');
    const t1 = (e1 ? e1.value : '').trim(), t2 = (e2 ? e2.value : '').trim();
    const l1 = e1 ? (e1.getAttribute('data-label') || '') : '', l2 = e2 ? (e2.getAttribute('data-label') || '') : '';
    const metatags = [];
    if (t1) metatags.push(l1 ? { position: 1, label: l1, value: t1 } : { position: 1, value: t1 });
    if (t2) metatags.push(l2 ? { position: 2, label: l2, value: t2 } : { position: 2, value: t2 });
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
