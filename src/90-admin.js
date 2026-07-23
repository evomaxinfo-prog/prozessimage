  /* ================= Benutzerverwaltung (admin) ================= */
  const ROLE_LABEL = { admin: 'Administrator', werkadmin: 'Werk-Admin', editor: 'Editor', viewer: 'Betrachter' };
  function roleLabel(r) { return t(ROLE_LABEL[r] || r); }

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
      + '<div class="adm-head"><div class="adm-title">' + t('Verwaltung') + '</div>'
      + '<div class="adm-tabs">' + tabBtn('users', t('Benutzer')) + tabBtn('groups', t('Gruppen')) + tabBtn('layers', t('Ebenen')) + '</div>'
      + '<button class="adm-x" data-adm="close" title="' + t('Schließen') + '">×</button></div>'
      + '<div class="adm-body">' + body + '</div></div></div>';
  }

  const userSortVal = window.PMX.userSortVal;
  function renderAdminUsers(a) {
    const llFmt = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
    const us = a.userSort || (a.userSort = { col: 'name', dir: 'asc' });
    const sorted = a.users.slice().sort((x, y) => {
      const vx = userSortVal(x, us.col), vy = userSortVal(y, us.col);
      const c = (typeof vx === 'number') ? (vx - vy) : String(vx).localeCompare(String(vy), 'de');
      return us.dir === 'asc' ? c : -c;
    });
    const cols = [{ k: 'name', l: 'Name' }, { k: 'email', l: 'E-Mail' }, { k: 'group', l: 'Gruppe' }, { k: 'logins', l: 'Anmeldungen' }, { k: 'status', l: 'Status' }];
    const heads = cols.map((c) => {
      const on = us.col === c.k;
      const arr = on ? (us.dir === 'asc' ? '▲' : '▼') : '↕';
      return '<th class="adm-sort' + (on ? ' active' : '') + '" data-adm="sort-users" data-col="' + c.k + '">' + t(c.l) + '<span class="adm-arr">' + arr + '</span></th>';
    }).join('') + '<th></th>';
    const rows = sorted.length ? sorted.map((u) =>
      '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td>'
      + '<td>' + (u.group ? '<span class="adm-gname">' + esc(u.group.name) + '</span><span class="adm-role r-' + esc(u.group.role) + '">' + esc(roleLabel(u.group.role)) + '</span>' : '—') + '</td>'
      + '<td class="adm-logins"><b>' + (u.loginCount || 0) + '</b><span class="adm-ll">' + (llFmt(u.lastLoginAt) ? t('zuletzt') + ' ' + llFmt(u.lastLoginAt) : t('noch nie')) + '</span>' + (u.lastLoginIp ? '<span class="adm-ip" title="IP der letzten Anmeldung">' + esc(u.lastLoginIp) + '</span>' : '') + '</td>'
      + '<td>' + (u.active ? '<span class="adm-ok">' + t('aktiv') + '</span>' : '<span class="adm-off">' + t('deaktiviert') + '</span>') + '</td>'
      + '<td class="adm-actions">'
      + '<button data-adm="user-edit" data-id="' + u.id + '" title="Bearbeiten"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg></button>'
      + (state.isAdmin ? '<button data-adm="user-logins" data-id="' + u.id + '" title="' + t('Anmelde-Zähler zurücksetzen') + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 8v4l3 2"/></svg></button>' : '')
      + '<button data-adm="user-pw" data-id="' + u.id + '" title="Passwort zurücksetzen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l2 2M14 9l2 2"/></svg></button>'
      + '<button class="del" data-adm="user-del" data-id="' + u.id + '" title="Löschen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</td></tr>').join('') : '<tr><td colspan="6" class="adm-empty">' + t('Noch keine Benutzer.') + '</td></tr>';
    return '<div class="adm-toolbar"><button class="btn primary" data-adm="user-new">'+ t('+ Benutzer hinzufügen') +'</button></div>'
      + '<table class="adm-table"><thead><tr>' + heads + '</tr></thead><tbody>' + rows + '</tbody></table>';
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

  const groupSortVal = window.PMX.groupSortVal;
  function renderAdminGroups(a) {
    const gs = a.groupSort || (a.groupSort = { col: 'name', dir: 'asc' });
    const sorted = a.groups.slice().sort((x, y) => {
      const vx = groupSortVal(x, gs.col), vy = groupSortVal(y, gs.col);
      const c = (typeof vx === 'number') ? (vx - vy) : String(vx).localeCompare(String(vy), 'de');
      return gs.dir === 'asc' ? c : -c;
    });
    const cols = [{ k: 'name', l: 'Name' }, { k: 'role', l: 'Rolle' }, { k: 'werke', l: 'Werke' }, { k: 'members', l: 'Mitglieder' }];
    const heads = cols.map((c) => { const on = gs.col === c.k; const arr = on ? (gs.dir === 'asc' ? '▲' : '▼') : '↕'; return '<th class="adm-sort' + (on ? ' active' : '') + '" data-adm="sort-groups" data-col="' + c.k + '">' + t(c.l) + '<span class="adm-arr">' + arr + '</span></th>'; }).join('') + '<th></th>';
    const rows = sorted.length ? sorted.map((g) =>
      '<tr><td>' + esc(g.name) + '</td><td><span class="adm-role r-' + esc(g.role) + '">' + esc(roleLabel(g.role)) + '</span></td>'
      + '<td>' + (g.allWerke ? '<i>' + t('alle Werke') + '</i>' : (g.werke.length ? g.werke.map((w) => esc(w.name)).join(', ') : '—')) + '</td>'
      + '<td>' + g.userCount + '</td>'
      + '<td class="adm-actions">'
      + '<button data-adm="group-edit" data-id="' + g.id + '" title="Bearbeiten"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18 10l-4-4L4 16z"/></svg></button>'
      + '<button class="del" data-adm="group-del" data-id="' + g.id + '" title="Löschen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</td></tr>').join('') : '<tr><td colspan="5" class="adm-empty">' + t('Noch keine Gruppen.') + '</td></tr>';
    return '<div class="adm-toolbar"><button class="btn primary" data-adm="group-new">' + t('+ Gruppe hinzufügen') + '</button></div>'
      + '<table class="adm-table"><thead><tr>' + heads + '</tr></thead><tbody>' + rows + '</tbody></table>';
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
      + '<td>' + esc(t(l.name)) + '</td>'
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
    const roleOpts = ['viewer', 'editor', 'werkadmin', 'admin'].map((r) => '<option value="' + r + '"' + (f.role === r ? ' selected' : '') + '>' + roleLabel(r) + '</option>').join('');
    const werkChecks = a.werke.length ? a.werke.map((w) => '<label class="adm-werk"><input type="checkbox" class="admWerk" value="' + w.id + '"' + (f.werkIds.has(w.id) ? ' checked' : '') + (f.allWerke ? ' disabled' : '') + '> ' + esc(w.name) + '</label>').join('') : '<div class="adm-empty">Keine Werke vorhanden.</div>';
    const layers = a.layers || [];
    const layerChecks = layers.length ? layers.map((l) => '<label class="adm-werk"><input type="checkbox" class="admLayer" value="' + esc(l.code) + '"' + (f.layerCodes.has(l.code) ? ' checked' : '') + (f.allLayers ? ' disabled' : '') + '> <span class="adm-lcode">' + esc(l.code) + '</span> ' + esc(t(l.name)) + '</label>').join('') : '<div class="adm-empty">Keine Ebenen vorhanden.</div>';
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
    else if (act === 'sort-users') { const col = el.getAttribute('data-col'); const us = a.userSort || (a.userSort = { col: 'name', dir: 'asc' }); if (us.col === col) { us.dir = us.dir === 'asc' ? 'desc' : 'asc'; } else { us.col = col; us.dir = 'asc'; } renderAdmin(); }
    else if (act === 'sort-groups') { const col = el.getAttribute('data-col'); const gs = a.groupSort || (a.groupSort = { col: 'name', dir: 'asc' }); if (gs.col === col) { gs.dir = gs.dir === 'asc' ? 'desc' : 'asc'; } else { gs.col = col; gs.dir = 'asc'; } renderAdmin(); }
    else if (act === 'user-edit') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u) { a.userForm = { id: u.id, name: u.name, email: u.email, groupId: u.group ? u.group.id : '', active: u.active }; renderAdmin(); } }
    else if (act === 'user-save') { saveUser(); }
    else if (act === 'user-pw') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u) { a.pwForm = { id: u.id, name: u.name }; renderAdmin(); } }
    else if (act === 'user-logins') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u && window.confirm(t('Anmelde-Zähler von „{n}“ auf 0 zurücksetzen?', { n: u.name }))) resetUserLoginsUi(u.id); }
    else if (act === 'pw-save') { savePw(); }
    else if (act === 'user-del') { const u = a.users.find((x) => String(x.id) === el.getAttribute('data-id')); if (u && window.confirm(t('Benutzer „{n}“ wirklich löschen?', { n: u.name }))) delUser(u.id); }
    else if (act === 'group-new') { a.groupForm = { name: '', role: 'viewer', allWerke: false, werkIds: new Set(), allLayers: true, layerCodes: new Set() }; renderAdmin(); }
    else if (act === 'group-edit') { const g = a.groups.find((x) => String(x.id) === el.getAttribute('data-id')); if (g) { a.groupForm = { id: g.id, name: g.name, role: g.role, allWerke: g.allWerke, werkIds: new Set(g.werke.map((w) => w.id)), allLayers: g.allLayers !== false && !(g.layerCodes && g.layerCodes.length), layerCodes: new Set(g.layerCodes || []) }; renderAdmin(); } }
    else if (act === 'group-save') { saveGroup(); }
    else if (act === 'group-del') { const g = a.groups.find((x) => String(x.id) === el.getAttribute('data-id')); if (g && window.confirm(t('Gruppe „{n}“ wirklich löschen?', { n: g.name }))) delGroup(g.id); }
    else if (act === 'layer-new') { a.layerForm = { name: '', code: '', color: '#0065A5', categories: [] }; renderAdmin(); }
    else if (act === 'layer-edit') { const l = (a.layers || []).find((x) => String(x.id) === el.getAttribute('data-id')); if (l) { a.layerForm = { id: l.id, name: l.name, code: l.code, color: l.color, categories: (l.categories || []).map((c) => c.name) }; renderAdmin(); } }
    else if (act === 'layer-save') { saveLayerDef(); }
    else if (act === 'layer-del') { const l = (a.layers || []).find((x) => String(x.id) === el.getAttribute('data-id')); if (l && window.confirm(t('Ebene „{n}“ wirklich löschen?', { n: l.code + ' ' + l.name }))) delLayerDef(l.id); }
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
    if (!name) { msg.textContent = t('Bitte einen Namen eingeben.'); return; }
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

  // Anmelde-Zaehler zuruecksetzen - Button nur fuer Admins sichtbar, Endpunkt zusaetzlich serverseitig admin-geschuetzt.
  async function resetUserLoginsUi(id) {
    try {
      const upd = await Api.resetUserLogins(id);
      const i = (state.admin.users || []).findIndex((x) => x.id === id);
      if (i >= 0 && upd && upd.id) state.admin.users[i] = upd;
      else if (i >= 0) state.admin.users[i].loginCount = 0;
      renderAdmin(); toast(t('Anmelde-Zähler zurückgesetzt'));
    } catch (err) { toast((err.data && err.data.message) || t('Zurücksetzen fehlgeschlagen')); }
  }

  async function saveGroup() {
    const a = state.admin, f = a.groupForm, msg = document.getElementById('admMsg');
    const name = document.getElementById('admGName').value.trim();
    const role = document.getElementById('admGRole').value;
    const allWerke = document.getElementById('admGAll').checked;
    const allLayers = document.getElementById('admGAllLayers').checked;
    if (!name) { msg.textContent = t('Bitte einen Namen eingeben.'); return; }
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
    if (!name) { msg.textContent = t('Bitte einen Namen eingeben.'); return; }
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
    if ($('btnForgot')) $('btnForgot').addEventListener('click', doForgot);
    if ($('fgEmail')) $('fgEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') doForgot(); });
    if ($('btnReset')) $('btnReset').addEventListener('click', doReset);
    if ($('rsNew')) $('rsNew').addEventListener('input', updateStrength);
    if ($('rsNew')) $('rsNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('rsNew2').focus(); });
    if ($('rsNew2')) $('rsNew2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doReset(); });
    $('chgEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('chgOld').focus(); });
    $('chgOld').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('chgNew').focus(); });
    $('chgNew2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doChange(); });
    document.querySelectorAll('.pw-eye').forEach((b) => b.addEventListener('click', () => togglePw(b.getAttribute('data-toggle'), b)));
    document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => showPanel(b.getAttribute('data-panel'))));

    // Header
    $('btnProfile').addEventListener('click', openProfile);
    $('btnLogout').addEventListener('click', async () => {
      stopCollab();
      try { await Api.logout(); } catch (e) { /* egal */ }
      Api.token = null; showLogin();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'editor' && collabTimer) pollCollab(); });

    // Baum
    $('btnAddWerk').addEventListener('click', addWerk);
    { const bta = $('btnToggleAll'); if (bta) bta.addEventListener('click', toggleAllTree); }
    { const btc = $('btnTreeCollapse'); if (btc) btc.addEventListener('click', () => { const a = document.querySelector('.app'); if (a) a.classList.add('tree-collapsed'); }); }
    { const bte = $('btnTreeExpand'); if (bte) bte.addEventListener('click', () => { const a = document.querySelector('.app'); if (a) a.classList.remove('tree-collapsed'); }); }
    // Baum-Breite per Zieh-Griff verstellen (persistiert in localStorage)
    (function () {
      var savedW = 0; try { savedW = parseInt(localStorage.getItem('tree_w') || '', 10); } catch (e) { /* noop */ }
      if (savedW >= 200 && savedW <= 640) document.documentElement.style.setProperty('--tree-w', savedW + 'px');
      var rz = document.getElementById('treeResize'); if (!rz) return;
      var startX = 0, startW = 0, dragging = false;
      function treeW() { var a = document.querySelector('aside.tree'); return a ? a.getBoundingClientRect().width : 262; }
      rz.addEventListener('pointerdown', function (e) {
        dragging = true; startX = e.clientX; startW = treeW();
        rz.classList.add('drag'); document.body.classList.add('tree-resizing');
        try { rz.setPointerCapture(e.pointerId); } catch (er) { /* noop */ }
        e.preventDefault();
      });
      rz.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var w = Math.max(200, Math.min(640, startW + (e.clientX - startX)));
        document.documentElement.style.setProperty('--tree-w', w + 'px');
      });
      function endResize() {
        if (!dragging) return; dragging = false;
        rz.classList.remove('drag'); document.body.classList.remove('tree-resizing');
        var m = /(\d+)px/.exec(document.documentElement.style.getPropertyValue('--tree-w'));
        if (m) { try { localStorage.setItem('tree_w', m[1]); } catch (e) { /* noop */ } }
      }
      rz.addEventListener('pointerup', endResize);
      rz.addEventListener('pointercancel', endResize);
      rz.addEventListener('dblclick', function () { document.documentElement.style.setProperty('--tree-w', '262px'); try { localStorage.setItem('tree_w', '262'); } catch (e) { /* noop */ } });
    })();
    const ts = $('treeScroll');
    ts.addEventListener('click', onTreeClick);
    ts.addEventListener('mousedown', function (e) { if (e.target.closest('[data-act="rename-ok"],[data-act="rename-cancel"]')) e.preventDefault(); });
    ts.addEventListener('dblclick', onTreeDblClick);
    ts.addEventListener('keydown', onTreeKey);
    ts.addEventListener('blur', onTreeBlur, true);
    document.addEventListener('click', (e) => { const a = document.querySelector('.app'); if (!a || !a.classList.contains('tree-open')) return; if (e.target.closest('aside.tree') || e.target.closest('[data-act="tree-toggle"]')) return; a.classList.remove('tree-open'); });
    // Objektnamen in der Objektliste inline umbenennen (fuer alle Rollen ausser Betrachter). Doppelklick wird im Klick-Handler per Zeitstempel erkannt (obj-name), da Einfachklick neu rendert.
    document.addEventListener('keydown', (e) => { const inp = e.target.closest('.oname-edit'); if (!inp) return; if (e.key === 'Enter') { e.preventDefault(); commitObjRename(inp.getAttribute('data-oedit'), inp.value); } else if (e.key === 'Escape') { e.preventDefault(); cancelObjRename(); } });
    document.addEventListener('focusout', (e) => { const inp = e.target.closest('.oname-edit'); if (inp) commitObjRename(inp.getAttribute('data-oedit'), inp.value); });
    // Verstecktes Feature: 5x auf die Versionsanzeige tippen -> echte Build-/Cache-Buster-Nummer anzeigen (+ in die Zwischenablage)
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.ver')) return;
      state._verTaps = (state._verTaps || 0) + 1;
      clearTimeout(state._verTapT);
      state._verTapT = setTimeout(() => { state._verTaps = 0; }, 1500);
      if (state._verTaps >= 5) {
        state._verTaps = 0;
        const b = getBuild();
        toast('Build ' + b);
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(b); } catch (err) { /* noop */ }
      }
    });

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
    c.addEventListener('contextmenu', onContentContextMenu);
    c.addEventListener('keydown', function (e) { if (e.target && e.target.id === 'cwText' && e.key === 'Enter') { e.preventDefault(); sendCommentMsg(); } });
    c.addEventListener('wheel', onWheelZoom, { passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endMove);
    window.addEventListener('pointercancel', endMove);
    // Sicherheitsnetz: wird die Maustaste ausserhalb des Fensters losgelassen, kann pointerup/-cancel ausbleiben.
    // Beim Fokusverlust einen evtl. laufenden Pan sauber beenden.
    window.addEventListener('blur', cleanupStuckPan);
    window.addEventListener('keydown', onEditorKey);
    $('btnAdmin').addEventListener('click', openAdmin);
    $('adminOverlay').addEventListener('click', onAdminClick);
    $('adminOverlay').addEventListener('change', onAdminChange);

    // Layout-Upload + Metatag-Modal
    $('layoutFile').addEventListener('change', onLayoutFile);
    { const df = $('docFile'); if (df) df.addEventListener('change', onDocFile); }
    $('mSave').addEventListener('click', saveTags);
    // SPS-Bereich-Auswahl (Swatch-Liste im FG-Tag-Fenster): Zeile waehlen
    $('mBody').addEventListener('click', (e) => {
      const row = e.target.closest('.m-sps-row'); if (!row) return;
      const list = row.closest('.m-sps-list'); if (!list) return;
      list.setAttribute('data-plc', row.getAttribute('data-plc') || '');
      list.querySelectorAll('.m-sps-row').forEach((r) => r.classList.remove('sel'));
      row.classList.add('sel');
    });
    $('mDelete').addEventListener('click', deletePlaced);
    $('mClose').addEventListener('click', closeTagModal);
    $('mX').addEventListener('click', closeTagModal);
    $('mBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') saveTags(); });
    bindBackdropClose($('tagModal'), closeTagModal); // gleiche Absicherung wie die uebrigen Fenster

    window.addEventListener('promodx:unauthorized', () => { toast('Sitzung abgelaufen'); showLogin(); });
  }

  wire();
  renderWelcome();
  // A11y: dekorative SVGs initial + bei DOM-Änderungen markieren (entzerrt)
  try {
    let _svgTimer = null;
    const _svgObs = new MutationObserver(() => { if (_svgTimer) return; _svgTimer = setTimeout(() => { _svgTimer = null; decorateSvgs(document); }, 250); });
    _svgObs.observe(document.body, { childList: true, subtree: true });
    decorateSvgs(document);
  } catch (e) { /* noop */ }

  boot();
})();
