/* ProModXgOEM – Frontend-Logik (Schritt 1: Login + Baum) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
    drawZone: false, drawShape: null, zoneDraft: [], zoneCursor: null, selectedZone: null, zoneDrag: null,
    collab: { since: null, viewers: [], enabled: true, inflight: false },
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
        + '<input data-plc="' + i + '" data-pf="name" value="' + esc(p.name) + '" style="border:none;font:inherit;font-weight:600;outline:none;background:none;min-width:120px"></div></td>'
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
    robot: '<image href="img/robot.png" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
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
  };

  const LAYER_META = {
    'L0.0': { soft: '#E2F4EE', action: 'FÖRDERWEG ZIEHEN', palette: [['Quelle', 'src'], ['Senke', 'snk'], ['Puffer', 'buf'], ['Umsetzer', 'xfer']] },
    'L1.0': { soft: '#E6F0F7', action: 'SB EINZEICHNEN', palette: [['Schaltschrank', 'cab'], ['Schutzbereich', 'zone'], ['Bedienpult', 'panel'], ['Klemmkasten', 'box']] },
    'L2.0': { soft: '#F0E9F7', action: 'ROBOTER SETZEN', palette: [['Roboter', 'robot'], ['Techno-Steuerung', 'ctrl'], ['Greifer', 'grip'], ['Zelle', 'cell']] },
    'L3.0': { soft: '#E4F3EE', action: 'IDENT PLATZIEREN', palette: [['Antrieb', 'motor'], ['2D-Kamera', 'cam'], ['RFID', 'rfid'], ['Ritzpräger', 'mark']] },
    'L4.0': { soft: '#FBF0E3', action: 'NOTHALT GENERIEREN', palette: [['Not-Halt', 'estop'], ['SmartPad', 'pad'], ['Reißleine', 'pull'], ['Quittier', 'ack']] },
    'L5.0': { soft: '#FBEAE8', action: 'SCHUTZZAUN ZIEHEN', palette: [['Sicherheitstür', 'door'], ['Lichtgitter', 'light'], ['Sicherheitsschalter', 'switch'], ['Beladestelle', 'load']] },
  };

  function layerById(id) { return (state.detail.layers || []).find((l) => l.id === id) || null; }
  function objectsOfLayer(id) { return (state.detail.objects || []).filter((o) => o.layerId === id); }

  /* ---- Punkt-basierte Formen: Schutzbereich (geschlossen) + Materialfluss-Förderweg (offen) ---- */
  function isShape(o) { return o && (o.symbolType === 'sb_zone' || o.symbolType === 'mf_route'); }

  const ROUTE_ARTS = ['Rollenbahn', 'Kettenförderer', 'Band-/Gurtförderer', 'Hängeförderer', 'FTS / AGV', 'Stapler / manuell', 'Manueller Transport'];
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
    if (!state.activeLayer && state.detail.layers && state.detail.layers[0]) state.activeLayer = state.detail.layers[0].id;
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
    state.collab.since = null; state.collab.viewers = []; state.collab.inflight = false;
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
    if (!state.detail || state.view !== 'editor' || document.hidden) return;
    if (state.collab.inflight) return;
    state.collab.inflight = true;
    let res;
    try {
      res = await Api.getChanges(state.detail.id, state.collab.since);
    } catch (e) {
      state.collab.inflight = false;
      // Backend-Endpunkt noch nicht ausgerollt -> Kollaboration still deaktivieren, keine Fehlerflut
      if (e && (e.status === 404 || e.status === 405)) { state.collab.enabled = false; stopCollab(); }
      return;
    }
    state.collab.inflight = false;
    if (!res) return;
    if (res.serverTime) state.collab.since = res.serverTime;
    const viewersChanged = presenceChanged(res.viewers || []);
    state.collab.viewers = res.viewers || [];
    const applied = applyRemoteChanges(res.objects || [], res.deletedIds || []);
    if (applied && collabIdle()) renderEditor();
    else if (viewersChanged) renderPresenceOnly();
  }
  function applyRemoteChanges(changed, deletedIds) {
    if (!state.detail) return false;
    const objs = state.detail.objects || (state.detail.objects = []);
    const busy = activeObjectId();
    let dirty = false;
    if (deletedIds && deletedIds.length) {
      const del = new Set(deletedIds.map(String));
      const kept = objs.filter((o) => !del.has(String(o.id)) || String(o.id) === busy);
      if (kept.length !== objs.length) {
        state.detail.objects = kept; dirty = true;
        if (state.selectedZone && del.has(String(state.selectedZone)) && String(state.selectedZone) !== busy) state.selectedZone = null;
      }
    }
    const arr = state.detail.objects;
    const idx = {}; arr.forEach((o, i) => { idx[String(o.id)] = i; });
    (changed || []).forEach((row) => {
      const id = String(row.id);
      if (id === busy) return; // nicht überschreiben, was der Nutzer gerade zieht
      row.metatags = row.metatags || [];
      if (idx[id] != null) arr[idx[id]] = row;
      else { arr.push(row); idx[id] = arr.length - 1; }
      dirty = true;
    });
    return dirty;
  }
  function presenceHtml() {
    const me = state.user && state.user.email;
    const others = (state.collab.viewers || []).filter((v) => v.email && v.email !== me);
    if (!others.length) return '';
    const dots = others.slice(0, 5).map((v) => '<span class="collab-dot" title="' + esc(v.email) + (v.role ? (' · ' + roleLabel(v.role)) : '') + '">' + esc(initials(v.email)) + '</span>').join('');
    const more = others.length > 5 ? '<span class="collab-more">+' + (others.length - 5) + '</span>' : '';
    return '<div class="collab-bar" title="Weitere Personen in dieser Anlage">' + dots + more + '</div>';
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

    const visible = {};
    (state.detail.layers || []).forEach((l) => { visible[l.id] = l.visible; });
    const placed = (state.detail.objects || []).filter((o) => !isShape(o) && visible[o.layerId] !== false).map((o) => {
      const chips = o.metatags.map((m) => m.value).filter(Boolean);
      return '<div class="placed" data-obj="' + o.id + '" style="left:' + (o.x * 100) + '%;top:' + (o.y * 100) + '%;color:' + esc(o.color) + '"'
        + ' title="' + esc(o.name) + ' — ziehen zum Verschieben · Doppelklick für Metatags">'
        + '<span class="p-sym"><svg width="26" height="26" viewBox="0 0 24 24">' + (SYM[o.symbolType] || SYM.box) + '</svg></span>'
        + (chips.length ? '<div class="ptags">' + chips.map((t) => '<span class="ptag">' + esc(t) + '</span>').join('') + '</div>' : '')
        + '</div>';
    }).join('');

    // Zeichenfläche übernimmt das Seitenverhältnis des Layoutbilds -> Symbole sitzen passgenau
    const docStyle = (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h)
      ? ' style="aspect-ratio:' + state.layoutDim.w + '/' + state.layoutDim.h + ';max-width:960px"' : '';

    return '<div class="canvas-doc ' + (state.drawZone ? 'drawing' : '') + '" id="canvasDoc"' + docStyle + '>'
      + bg + zoneOverlaySvg(visible) + '<div class="placed-layer">' + placed + '</div>' + techBadgeLayer() + zoneHandleLayer() + badge + '</div>';
  }

  function zoneOverlaySvg(visible) {
    const zones = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
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
    const visible = {}; (state.detail.layers || []).forEach((l) => { visible[l.id] = l.visible; });
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
    const L = layerById(state.activeLayer) || (state.detail.layers || [])[0];
    if (!L) { c.innerHTML = '<div class="pad">Keine Ebenen vorhanden.</div>'; return; }
    const meta = LAYER_META[L.code] || { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };

    const counts = {};
    (state.detail.objects || []).forEach((o) => { counts[o.layerId] = (counts[o.layerId] || 0) + 1; });

    const pal = (meta.palette || []).map(([name, sym]) =>
      '<div class="pal-item" style="color:' + L.color + '" draggable="true" data-sym="' + sym + '" data-name="' + esc(name) + '" data-color="' + L.color + '" data-act="pal-hint" title="Auf das Layout ziehen">'
      + '<div class="sym"><svg width="22" height="22" viewBox="0 0 24 24">' + (SYM[sym] || SYM.box) + '</svg></div><span>' + esc(name) + '</span></div>').join('');

    const layerStack = (state.detail.layers || []).slice().reverse().map((l) => {
      const act = l.id === L.id, vis = l.visible !== false;
      const eye = vis
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.2 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.2-1.5"/><path d="M4 4l16 16"/></svg>';
      const lmeta = LAYER_META[l.code] || { soft: '#eef3f7' };
      return '<div class="layer ' + (act ? 'active' : '') + ' ' + (vis ? '' : 'hidden') + '" style="--lc:' + l.color + ';--lc-soft:' + lmeta.soft + '" data-act="layer-select" data-layer="' + l.id + '">'
        + '<div class="lbar"></div><div class="lmeta"><div class="lid">' + esc(l.code) + '</div><div class="lname">' + esc(l.name) + '</div><div class="lcount">' + (counts[l.id] || 0) + ' Objekte</div></div>'
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
      + '<div class="canvas-stage" id="stage"><div class="canvas-inner">' + editorFloorplan() + '</div>'
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
    const isL0 = L && L.code === 'L0.0';
    const zoneActive = state.drawShape === 'zone';
    const routeActive = state.drawShape === 'route';
    let btn, hint;
    if (isL0) {
      btn = '<button class="btn zone-btn ' + (routeActive ? 'active' : '') + '" data-act="toggle-route" style="width:100%;justify-content:center">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h13M13 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg> '
        + (routeActive ? 'ZEICHNEN AKTIV' : 'FÖRDERWEG') + '</button>';
      hint = routeActive
        ? 'Klicken setzt Wegpunkte · Klick auf den letzten Punkt oder <b>Enter</b> beendet · <b>Esc</b> bricht ab. Der Pfeil zeigt die Flussrichtung; Doppelklick öffnet die Förderart.'
        : 'Förderweg zeichnen; Wegpunkte danach verschiebbar. Weg anklicken: <b>Entf</b> löscht, <b>R</b> kehrt die Richtung um.';
    } else {
      btn = '<button class="btn zone-btn ' + (zoneActive ? 'active' : '') + '" data-act="toggle-zone" style="width:100%;justify-content:center">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4z" stroke-dasharray="3 2.5"/></svg> '
        + (zoneActive ? 'ZEICHNEN AKTIV' : 'SB SCHUTZBEREICH') + '</button>';
      hint = zoneActive
        ? 'Klicken setzt Stützpunkte · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
        : 'Polygon zeichnen; Stützpunkte danach verschiebbar. Bereich anklicken &amp; <b>Entf</b> löscht ihn.';
    }
    return '<div class="lp-action">' + btn + '<div class="zone-hint">' + hint + '</div></div>';
  }

  function objCatBlock(name, list, color) {
    const tools = canEdit();
    const rows = list.map((o) => '<div class="obj"><span class="odot" style="background:' + esc(o.color) + '"></span><span class="oname">' + esc(o.name) + '</span>'
      + (tools ? ('<div class="obj-tools">'
      + '<button data-act="obj-edit" data-obj="' + o.id + '" title="Metatags"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l8-8h6v6l-8 8z"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/></svg></button>'
      + '<button class="del" data-act="obj-del" data-obj="' + o.id + '" title="Löschen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</div>') : '') + '</div>').join('');
    return '<div class="obj-cat"><div class="obj-cat-head" style="color:' + color + '">' + esc(name) + '<span class="cnt">' + list.length + '</span></div>' + rows + '</div>';
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
      state.detail.objects.push(obj);
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
      if (td.moved && o) { try { await Api.updateObject(o.id, { points: o.points }); } catch (e2) { toast('Position nicht gespeichert'); } }
      renderEditor(); return;
    }
    if (state.zoneDrag) {
      const zd = state.zoneDrag; state.zoneDrag = null;
      const z = (state.detail.objects || []).find((o) => o.id === zd.id);
      if ((zd.type === 'vertex' || zd.type === 'move') && zd.moved && z) {
        try { await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }); } catch (e2) { toast('Speichern fehlgeschlagen'); }
        renderEditor(); return;
      }
      // Klick ohne Bewegung: Auswahl bzw. Doppelklick (zeitbasiert, re-render-fest)
      if (z) {
        const now = Date.now();
        const dbl = state.lastZoneUp && state.lastZoneUp.id === z.id && (now - state.lastZoneUp.t) < 400;
        state.lastZoneUp = dbl ? null : { id: z.id, t: now };
        if (dbl) { if (z.symbolType === 'mf_route') openRouteModal(z.id); else openZoneAssignModal(z.id); return; }
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
        try { await Api.updateObject(o.id, { x: dm.nx, y: dm.ny }); } catch (e) { toast('Verschieben nicht gespeichert'); }
        if (techInfo(o)) renderEditor();
      }
    }
  }

  const ROBOT_RISK = ['CK (Hohes Risiko)', 'K (Hohes Risiko, nachbar SB)', 'C (Geringes Risiko)', 'BS (Bedienerschutz)', 'T (sichere Werkzeugumschaltung)', 'Kein Risiko'];
  const ROBOT_TECH = ['Punkt Schweißen - Stahl', 'MIG-Schweißen', 'Bolzen-Schweißen', 'Bolzen-Schweißen (Rotationskopf)', 'Bolzen (stationär)', 'Kleben', 'Laser', 'Halbholstanznieten', 'Fließlochschrauben', 'Inline messen'];

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
    try { const upd = await Api.setMetatags(o.id, metatags); o.metatags = (upd && upd.metatags) || metatags; } catch (e) { toast('Metatags nicht gespeichert'); }
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
    const bez = ((z.metatags || []).find((m) => m.label === 'Bezeichnung') || {}).value || '';
    const col = (layerById(z.layerId) || {}).color || '#0FA47F';
    const opts = '<option value="">— bitte wählen —</option>'
      + ROUTE_ARTS.map((a) => '<option value="' + esc(a) + '"' + (a === art ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card">'
      + '<div class="za-head"><div><div class="za-title">Förderweg</div><div class="za-sub">' + esc(z.name) + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen">×</button></div>'
      + '<div class="za-body" style="display:flex;flex-direction:column;gap:12px;padding:16px">'
      + '<div class="m-field"><label>Förderart</label><select id="rfArt">' + opts + '</select></div>'
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
    const bez = ((document.getElementById('rfBez') || {}).value || '').trim();
    const metatags = [];
    if (art) metatags.push({ position: 1, label: 'Förderart', value: art });
    if (bez) metatags.push({ position: 2, label: 'Bezeichnung', value: bez });
    try { const upd = await Api.setMetatags(z.id, metatags); z.metatags = (upd && upd.metatags) || metatags; toast('Förderweg gespeichert'); }
    catch (e) { toast('Speichern fehlgeschlagen'); }
    closeZoneModal(); renderEditor();
  }
  async function reverseRoute(routeId) {
    const z = (state.detail.objects || []).find((o) => o.id === routeId);
    if (!z || !z.points || z.points.length < 2) return;
    z.points = z.points.slice().reverse();
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
    const visible = {}; (state.detail.layers || []).forEach((l) => { visible[l.id] = l.visible; });
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
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone').length + 1).padStart(2, '0');
    state.drawZone = false; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: 'Schutzbereich_' + num, symbolType: 'sb_zone', color: L.color, x: pts[0].x, y: pts[0].y, points: pts });
      state.detail.objects.push(obj); state.selectedZone = obj.id;
      toast('Schutzbereich erstellt');
    } catch (e) { toast('Erstellen fehlgeschlagen: ' + e.message); }
    renderEditor();
  }

  async function finishRoute() {
    if (state.drawShape !== 'route' || state.zoneDraft.length < 2) { toast('Mindestens 2 Wegpunkte nötig'); return; }
    const pts = state.zoneDraft.slice();
    const L = layerById(state.activeLayer);
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === 'mf_route').length + 1).padStart(2, '0');
    state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: 'Förderweg_' + num, symbolType: 'mf_route', color: L.color, x: pts[0].x, y: pts[0].y, points: pts });
      state.detail.objects.push(obj); state.selectedZone = obj.id;
      toast('Förderweg erstellt');
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

  async function openAdmin() {
    if (!state.isAdmin) return;
    state.admin = { tab: 'users', groups: [], users: [], werke: [], userForm: null, groupForm: null, pwForm: null, loading: true };
    renderAdmin();
    try {
      const [groups, users, werke] = await Promise.all([Api.getGroups(), Api.getUsers(), Api.getWerke()]);
      state.admin.groups = groups; state.admin.users = users; state.admin.werke = werke;
    } catch (e) { toast('Verwaltung konnte nicht geladen werden'); }
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
    else body = a.groupForm ? renderGroupForm(a) : renderAdminGroups(a);
    $('adminOverlay').innerHTML = '<div class="adm-backdrop" id="admBackdrop"><div class="adm-card">'
      + '<div class="adm-head"><div class="adm-title">Benutzerverwaltung</div>'
      + '<div class="adm-tabs">' + tabBtn('users', 'Benutzer') + tabBtn('groups', 'Gruppen') + '</div>'
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

  function renderGroupForm(a) {
    const f = a.groupForm, isNew = !f.id;
    const roleOpts = ['viewer', 'editor', 'admin'].map((r) => '<option value="' + r + '"' + (f.role === r ? ' selected' : '') + '>' + roleLabel(r) + '</option>').join('');
    const werkChecks = a.werke.length ? a.werke.map((w) => '<label class="adm-werk"><input type="checkbox" class="admWerk" value="' + w.id + '"' + (f.werkIds.has(w.id) ? ' checked' : '') + (f.allWerke ? ' disabled' : '') + '> ' + esc(w.name) + '</label>').join('') : '<div class="adm-empty">Keine Werke vorhanden.</div>';
    return '<div class="adm-form"><h3>' + (isNew ? 'Neue Gruppe' : 'Gruppe bearbeiten') + '</h3>'
      + '<label>Name</label><input id="admGName" value="' + esc(f.name || '') + '">'
      + '<label>Rolle</label><select id="admGRole">' + roleOpts + '</select>'
      + '<label class="adm-check"><input type="checkbox" id="admGAll" data-adm="group-allwerke"' + (f.allWerke ? ' checked' : '') + '> Alle Werke sichtbar</label>'
      + '<label>Sichtbare Werke</label><div class="adm-werke">' + werkChecks + '</div>'
      + '<div class="adm-msg" id="admMsg"></div>'
      + '<div class="adm-form-actions"><button class="btn" data-adm="form-cancel">Abbrechen</button><button class="btn primary" data-adm="group-save">Speichern</button></div></div>';
  }

  function onAdminClick(e) {
    const a = state.admin; if (!a) return;
    if (e.target.id === 'admBackdrop') { closeAdmin(); return; }
    const el = e.target.closest('[data-adm]'); if (!el) return;
    const act = el.getAttribute('data-adm');
    if (act === 'close') { closeAdmin(); }
    else if (act === 'tab') { a.tab = el.getAttribute('data-tab'); a.userForm = a.groupForm = a.pwForm = null; renderAdmin(); }
    else if (act === 'form-cancel') { a.userForm = a.groupForm = a.pwForm = null; renderAdmin(); }
    else if (act === 'user-new') { a.userForm = { name: '', email: '', password: '', groupId: (a.groups[0] || {}).id || '' }; renderAdmin(); }
    else if (act === 'user-edit') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u) { a.userForm = { id: u.id, name: u.name, email: u.email, groupId: u.group ? u.group.id : '', active: u.active }; renderAdmin(); } }
    else if (act === 'user-save') { saveUser(); }
    else if (act === 'user-pw') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u) { a.pwForm = { id: u.id, name: u.name }; renderAdmin(); } }
    else if (act === 'pw-save') { savePw(); }
    else if (act === 'user-del') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u && window.confirm('Benutzer „' + u.name + '" wirklich löschen?')) delUser(u.id); }
    else if (act === 'group-new') { a.groupForm = { name: '', role: 'viewer', allWerke: false, werkIds: new Set() }; renderAdmin(); }
    else if (act === 'group-edit') { const g = a.groups.find((x) => String(x.id) === el.getAttribute('data-id')); if (g) { a.groupForm = { id: g.id, name: g.name, role: g.role, allWerke: g.allWerke, werkIds: new Set(g.werke.map((w) => w.id)) }; renderAdmin(); } }
    else if (act === 'group-save') { saveGroup(); }
    else if (act === 'group-del') { const g = a.groups.find((x) => String(x.id) === el.getAttribute('data-id')); if (g && window.confirm('Gruppe „' + g.name + '" wirklich löschen?')) delGroup(g.id); }
  }

  function onAdminChange(e) {
    const a = state.admin; if (!a) return;
    if (e.target.id === 'admGAll' && a.groupForm) { a.groupForm.allWerke = e.target.checked; renderAdmin(); return; }
    if (e.target.classList && e.target.classList.contains('admWerk') && a.groupForm) {
      const id = e.target.value;
      if (e.target.checked) a.groupForm.werkIds.add(id); else a.groupForm.werkIds.delete(id);
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
    if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
    const werkIds = allWerke ? [] : Array.from(f.werkIds);
    try {
      if (!f.id) await Api.createGroup({ name, role, allWerke, werkIds });
      else await Api.updateGroup(f.id, { name, role, allWerke, werkIds });
      a.groupForm = null; a.groups = await Api.getGroups();
      renderAdmin(); toast('Gespeichert');
    } catch (err) { msg.textContent = (err.data && err.data.message) || ('Fehler: ' + err.message); }
  }

  async function delGroup(id) {
    try { await Api.deleteGroup(id); state.admin.groups = await Api.getGroups(); renderAdmin(); toast('Gruppe gelöscht'); }
    catch (err) { toast((err.data && err.data.message) || 'Löschen fehlgeschlagen'); }
  }

  /* ---------------- Verdrahtung ---------------- */
  function wire() {
    // Login
    $('btnLogin').addEventListener('click', doLogin);
    $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('loginEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
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
