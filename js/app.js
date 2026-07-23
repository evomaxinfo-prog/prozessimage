/* ProModXgOEM2 – Frontend-Logik (Schritt 1: Login + Baum) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const GRID_STEP = 0.025; // Raster-Schrittweite (normiert) ~ 40 Spalten
  const snapToGrid = (v) => Math.round(v / GRID_STEP) * GRID_STEP;
  const PLC_COLORS = ['#0065A5', '#C0392B', '#0E8A6E', '#D9822B', '#7A3FA8', '#2C82C9', '#16A085', '#E67E22'];
  // Naechster freier SPS-Name: SPS1, SPS2, ... (hoechste vorhandene SPS<n>-Nummer + 1)
  function nextSpsName(plcs) {
    let max = 0;
    (plcs || []).forEach((p) => { const m = /^SPS\s*0*(\d+)$/i.exec(String(p.name || '').trim()); if (m) { const n = +m[1]; if (n > max) max = n; } });
    return 'SPS' + (max + 1);
  }

  const TYPE_ORDER = ['werk', 'center', 'abteilung', 'kst', 'linie', 'anlage'];
  const TYPE_LABEL = { werk: 'Werk', center: 'Center', abteilung: 'Abteilung', kst: 'KST', linie: 'Linie', anlage: 'Anlage' };
  const childType = (t) => { const i = TYPE_ORDER.indexOf(t); return (i >= 0 && i < TYPE_ORDER.length - 1) ? TYPE_ORDER[i + 1] : null; };

  const ICONS = (window.PMX && window.PMX.ICONS) || {};
  // Dezente Pastellfarben je Knotentyp; Linie wird hervorgehoben (siehe CSS .n-icon.linie)
  const NODE_ICON_COLOR = {
    werk: '#5E8FCB', center: '#3FA9A0', abteilung: '#D79A55', kst: '#9A7BC8', linie: '#E8663F', anlage: '#5DA97C',
  };

  const state = {
    tree: [], byId: {}, expanded: new Set(),
    selected: null, editingNodeId: null, editingObjId: null, confirmDelete: null, user: null, lang: 'de',
    drawZone: false, drawShape: null, zoneDraft: [], zoneCursor: null, zoneSnap: null, selectedZone: null, selectedObj: null, zoneDrag: null, flowType: 0, flowLegend: true,
    collab: { since: null, viewers: [], enabled: true, inflight: false, status: 'connecting', detailsOpen: false, pendingRender: false, protect: {} },
    geomPending: {},
  };

  /* ---------------- i18n (Mehrsprachigkeit) ----------------
     Quell-Sprache ist Deutsch (= Schlüssel). Fehlt eine EN-Übersetzung,
     wird automatisch der deutsche Text angezeigt (graceful fallback). */
  const I18N_EN = (window.PMX && window.PMX.I18N_EN) || {};
  function t(s, params) {
    let out = (state.lang === 'en' && I18N_EN[s] != null) ? I18N_EN[s] : s;
    if (params) Object.keys(params).forEach((k) => { out = out.split('{' + k + '}').join(params[k]); });
    return out;
  }
  function applyLang() {
    try { document.documentElement.lang = state.lang; } catch (e) { /* noop */ }
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  }

  // A11y: dekorative Inline-SVGs (ohne eigenen Namen) vor Screenreadern verbergen.
  function decorateSvgs(root) {
    (root || document).querySelectorAll('svg:not([aria-hidden])').forEach((svg) => {
      if (!svg.getAttribute('aria-label') && !svg.getAttribute('role') && !svg.querySelector('title')) {
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
      }
    });
  }

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
    const pf = $('panelForgot'); if (pf) pf.style.display = which === 'forgot' ? 'block' : 'none';
    const pr = $('panelReset'); if (pr) pr.style.display = which === 'reset' ? 'block' : 'none';
    $('loginMsg').textContent = '';
    const cm = $('chgMsg'); if (cm) { cm.textContent = ''; cm.classList.remove('ok'); }
    const fm = $('fgMsg'); if (fm) { fm.textContent = ''; fm.classList.remove('ok'); }
    const rm = $('rsMsg'); if (rm) { rm.textContent = ''; rm.classList.remove('ok'); }
    if (which === 'change') { if (!$('chgEmail').value) $('chgEmail').value = $('loginEmail').value.trim(); }
    else if (which === 'login') { if ($('chgEmail').value) $('loginEmail').value = $('chgEmail').value.trim(); }
    else if (which === 'forgot') { if (!$('fgEmail').value) $('fgEmail').value = $('loginEmail').value.trim(); }
    setTimeout(() => {
      const el = which === 'change' ? ($('chgEmail').value ? $('chgOld') : $('chgEmail'))
        : which === 'forgot' ? $('fgEmail')
        : which === 'reset' ? $('rsNew')
        : $('loginEmail');
      if (el) el.focus();
    }, 50);
  }
  function togglePw(id, btn) { const i = $(id); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; btn.classList.toggle('on', show); }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function pwScore(v) { let s = 0; if (v.length >= 8) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++; return Math.min(s, 4); }
  function updateStrength() {
    const bars = (val, sel) => {
      const s = pwScore(val || '');
      const col = ['', '#C0392B', '#D9822B', '#0E8A6E', '#0E8A6E'][s];
      document.querySelectorAll(sel + ' i').forEach((b, i) => { b.style.background = i < s ? col : 'var(--panel-2)'; });
    };
    if ($('chgNew')) bars($('chgNew').value, '#pwBars');
    if ($('rsNew')) bars($('rsNew').value, '#rsBars');
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

  // Passwort vergessen: Reset-Link anfordern. Antwort immer generisch (keine Konto-Enumeration).
  async function doForgot() {
    const email = $('fgEmail').value.trim();
    const msg = $('fgMsg'); msg.classList.remove('ok');
    if (!isEmail(email)) { msg.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; return; }
    msg.textContent = 'Wird gesendet …';
    try { await Api.forgotPassword(email); } catch (e) { /* generisch bleiben */ }
    msg.classList.add('ok');
    msg.textContent = 'Falls ein Konto zu dieser E-Mail existiert, haben wir einen Link zum Zurücksetzen versandt. Bitte prüfe dein Postfach (auch den Spam-Ordner).';
  }

  // Neues Passwort per Reset-Token setzen.
  async function doReset() {
    const np = $('rsNew').value, np2 = $('rsNew2').value;
    const msg = $('rsMsg'); msg.classList.remove('ok');
    if ((np || '').length < 8) { msg.textContent = 'Das neue Passwort muss mindestens 8 Zeichen haben.'; return; }
    if (np !== np2) { msg.textContent = 'Die neuen Passwörter stimmen nicht überein.'; return; }
    if (!state.resetToken) { msg.textContent = 'Der Reset-Link ist ungültig. Bitte fordere einen neuen an.'; return; }
    msg.textContent = 'Passwort wird gesetzt …';
    try {
      await Api.resetPassword(state.resetEmail || '', state.resetToken, np);
      msg.classList.add('ok'); msg.textContent = 'Passwort geändert. Bitte neu anmelden.';
      state.resetToken = null; state.resetEmail = null;
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* noop */ }
      if ($('loginEmail') && state.resetEmailForLogin) $('loginEmail').value = state.resetEmailForLogin;
      ['rsNew', 'rsNew2'].forEach((id) => { if ($(id)) $(id).value = ''; });
      setTimeout(() => showPanel('login'), 1400);
    } catch (e) {
      msg.textContent = e.status === 422 || e.status === 400 ? 'Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.' : ('Fehler: ' + e.message);
    }
  }

  const initials = window.PMX.initials;

  function canEdit() { return state.role === 'editor' || state.role === 'admin' || state.role === 'werkadmin'; }
  // Eigene Palette-Symbole verwalten (anlegen/bearbeiten/löschen): voller Admin oder Werk-Admin (in seinen Werken).
  function canManagePalette() { return state.role === 'admin' || state.role === 'werkadmin'; }

  function applyRoleUi() {
    $('btnAdmin').style.display = state.isAdmin ? '' : 'none';
    const add = $('btnAddWerk'); if (add) add.style.display = state.isAdmin ? '' : 'none';
  }

  function enterApp(ctx) {
    state.user = ctx.user;
    state.role = ctx.role || 'viewer';
    state.lang = (ctx.lang === 'en') ? 'en' : 'de';
    try { localStorage.setItem('promodx_lang', state.lang); } catch (e) { /* noop */ }
    applyLang();
    state.isAdmin = !!ctx.isAdmin;
    state.group = ctx.group || null;
    state.visibleWerke = ctx.visibleWerke || null;
    state.visibleLayers = ctx.visibleLayers || null; // Array erlaubter Ebenen-Codes; null = alle sichtbar
    state.snapGrid = (localStorage.getItem('promodx_snapgrid') !== '0'); // Raster-Snap, Standard: an
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
    // Nutzer tippt gerade (oder Browser hat autovervollständigt)? Dann Eingaben & Fokus nicht anfassen.
    const a = document.activeElement;
    const busy = a && ['loginEmail', 'loginPass', 'chgEmail', 'chgOld', 'chgNew', 'chgNew2'].indexOf(a.id) >= 0;
    if (busy) { $('panelLogin').style.display = 'block'; $('panelChange').style.display = 'none'; return; }
    $('loginPass').value = '';
    showPanel('login');
  }

  function parseResetParams() {
    try {
      const q = new URLSearchParams(location.search);
      const token = q.get('token') || q.get('reset');
      if (token) return { token: token, email: q.get('email') || '' };
    } catch (e) { /* noop */ }
    return null;
  }

  // Liest die echte Build-/Cache-Buster-Nummer aus der geladenen app.js (?v=…)
  function getBuild() {
    try {
      const s = document.querySelector('script[src*="js/app.js"]');
      const m = s && s.src.match(/[?&]v=([^&#]+)/);
      return m ? decodeURIComponent(m[1]) : '–';
    } catch (e) { return '–'; }
  }

  // Globale Fehlerbehandlung: unerwartete Fehler protokollieren und dem Nutzer dezent zurueckmelden
  // (gedrosselt), statt still in einen kaputten Zustand zu laufen. 401 wird vom API-Layer/Login behandelt.
  let _lastErrToast = 0;
  function reportGlobalError(err) {
    try { if (window.console && console.error) console.error('[ProModX]', err); } catch (_) { /* noop */ }
    const now = Date.now();
    if (now - _lastErrToast > 4000) {
      _lastErrToast = now;
      try { toast(t('Ein unerwarteter Fehler ist aufgetreten. Bitte laden Sie die Seite neu (Strg+Umschalt+R).')); } catch (_) { /* noop */ }
    }
  }
  window.addEventListener('error', (e) => reportGlobalError((e && e.error) || (e && e.message) || e));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    if (r && (r.status === 401 || r.name === 'AbortError')) return; // bereits behandelt bzw. bewusst abgebrochen
    reportGlobalError(r);
  });

  async function boot() {
    try { state.lang = (localStorage.getItem('promodx_lang') === 'en') ? 'en' : 'de'; } catch (e) { /* noop */ }
    applyLang();
    // Direktlink zu einer Anlage merken (?station=…) – wird nach dem Laden des Baums geöffnet
    try { const sp = new URLSearchParams(location.search).get('station'); if (sp) state.pendingStation = sp; } catch (e) { /* noop */ }
    // Reset-Link (?token=…&email=…) erkannt -> direkt "Neues Passwort setzen" anzeigen
    const rp = parseResetParams();
    if (rp) {
      Api.token = null; state.resetToken = rp.token; state.resetEmail = rp.email; state.resetEmailForLogin = rp.email;
      showLogin(); showPanel('reset');
      return;
    }
    if (!Api.isAuthenticated) { showLogin(); return; }
    try {
      const res = await Api.me();
      $('loginScreen').style.display = 'none';
      enterApp(res);
    } catch (e) {
      // Abgelaufener/ungültiger Token: still auf den bereits sichtbaren Login-Screen zurückfallen,
      // ohne Autofill/Eingaben zu löschen oder den Fokus zu stehlen.
      Api.token = null;
      const ls = $('loginScreen'); ls.style.display = 'flex'; ls.classList.remove('hide');
      $('panelLogin').style.display = 'block'; $('panelChange').style.display = 'none';
    }
  }

  /* ---------------- Baum ---------------- */
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
      pushUndo(); // Umbenennen war bisher kein eigener Undo-Schritt
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
  async function deleteChangesDay(day) {
    const ids = (_ciDayIds[day] || []).slice();
    if (!ids.length) return;
    if (!window.confirm(t('Alle Änderungseinträge vom {day} löschen?', { day: day }) + '\n\n'
      + t(ids.length === 1 ? '{n} Eintrag wird dauerhaft entfernt – auch im Änderungsjournal der jeweiligen Station.' : '{n} Einträge werden dauerhaft entfernt – auch im Änderungsjournal der jeweiligen Station.', { n: ids.length }))) return;
    const res = await Promise.all(ids.map(function (id) {
      return Api.deleteJournal(id).then(function () { return true; }).catch(function () { return false; });
    }));
    const failed = res.filter(function (ok) { return !ok; }).length;
    toast(failed ? t('{n} von {total} gelöscht, {failed} fehlgeschlagen', { n: ids.length - failed, total: ids.length, failed: failed })
      : t(ids.length === 1 ? '{n} Eintrag gelöscht' : '{n} Einträge gelöscht', { n: ids.length }));
    _linieTab = 'changes'; // nach dem Loeschen auf Tab 4 bleiben
    if (state.selected) selectNode(state.selected); // Ansicht frisch laden
  }
  // Änderungsindex (admin-only): nach Tagen geclustert, neuester Tag zuerst.
  function linieChangesHtml(rows) {
    if (!rows || !rows.length) return '<div class="pad" style="color:var(--muted)">' + t('Keine protokollierten Änderungen in dieser Linie.') + '</div>';
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
      const delBtn = state.isAdmin ? '<button class="ci-del" data-act="ci-del-day" data-day="' + esc(day) + '">' + t('Tag löschen') + '</button>' : '';
      return '<div class="ci-day"><div class="ci-day-head">' + esc(day) + '<span>' + t(list.length === 1 ? '{n} Eintrag' : '{n} Einträge', { n: list.length }) + '</span>' + delBtn + '</div>'
        + '<div class="ls-scroll"><table class="ls-tbl"><thead><tr><th>' + t('Station') + '</th><th>' + t('Art der Änderung') + '</th><th>' + t('Uhrzeit') + '</th><th>' + t('Von wem') + '</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
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
          ? '<div class="detail-lastedit" style="margin-top:10px;font-size:12px;color:var(--muted)">' + t('Letzte Änderung') + ': ' + fmtDateTime(s.letzteAenderung) + (s.letzterBearbeiter ? ' · ' + esc(s.letzterBearbeiter) : '') + '</div>'
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
    else if (act === 'ci-del-day') { deleteChangesDay(el.getAttribute('data-day')); }
    else if (act === 'plc-add') { state.detailDraft.plcs.push({ id: null, name: nextSpsName(state.detailDraft.plcs), cycleTimeMs: 0, retentiveBytes: 0, codeMemoryKb: 0, color: PLC_COLORS[state.detailDraft.plcs.length % PLC_COLORS.length] }); renderDetail(); }
    else if (act === 'plc-del') { const i = +el.getAttribute('data-idx'); const p = state.detailDraft.plcs[i]; if (p && p.id) state.detailDraft._deleted.push(p.id); state.detailDraft.plcs.splice(i, 1); renderDetail(); }
    else if (act === 'journal-add') { addJournalEntry(); }
    else if (act === 'open-editor') { openEditor(); }
    else if (act === 'open-station') { selectNode(el.getAttribute('data-id')); }
    else if (act === 'goto-obj') { e.stopPropagation(); gotoObject(el.getAttribute('data-node'), el.getAttribute('data-obj')); }
    else if (act === 'pick-layer') { state.linieActiveLayer = el.getAttribute('data-layer'); renderLinieFolders(); }
    else if (act === 'linie-tab') { applyLinieTab(el.getAttribute('data-tab')); }
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
    else if (act === 'layout-reset') { resetLayout(); }
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

  /* ================= Modellierungs-Editor (Schritt 3) ================= */

  const SYM = (window.PMX && window.PMX.SYM) || {};

const PROCESS_TYPES = (window.PMX && window.PMX.PROCESS_TYPES) || [];
const STATE_ICONS = (window.PMX && window.PMX.STATE_ICONS) || {};


  const PROCESS_META = { soft: '#EAF1F6', action: 'PROZESSTYP SETZEN', palette: PROCESS_TYPES.map((p) => [p.name, p.sym]) };
  function processTypeByName(name) { const base = String(name || '').replace(/_\d+$/, ''); return PROCESS_TYPES.find((p) => p.name === base) || null; }
  function processTypeBySym(sym) { return PROCESS_TYPES.find((p) => p.sym === sym) || null; }
  // Farb-Cluster der Prozess-Icons: teal (Aktiv), dunkel (Passiv/XML), weiß/Outline (SDE)
  const PT_DARK = { ptk_11: 1, ptk_12: 1, ptk_13: 1, ptk_14: 1, ptk_15: 1, ptk_16: 1, ptk_18: 1, ptk_19: 1, ptk_70: 1, ptk_99: 1 };
  const PT_WHITE = { ptk_90: 1, ptk_91: 1, ptk_92: 1, ptk_93: 1, ptk_94: 1, ptk_95: 1, ptk_96: 1 };
  function ptColorGroup(sym) { return PT_WHITE[sym] ? 's' : PT_DARK[sym] ? 'p' : 'a'; }
  const PT_COLOR_GROUPS = (window.PMX && window.PMX.PT_COLOR_GROUPS) || [];
  const ptStateGroups = window.PMX.ptStateGroups;
  function ptStateList(pt) {
    const out = [];
    ptStateGroups(pt).forEach((g) => {
      g.muss.forEach((n) => out.push({ group: g.group, kind: 'Pflicht', name: n }));
      g.opt.forEach((n) => out.push({ group: g.group, kind: 'Optional', name: n }));
    });
    return out;
  }

  const LAYER_META = (window.PMX && window.PMX.LAYER_META) || {};
  // Palette-Meta zur Ebene: exakter Name, sonst Prozesstyp-Katalog fuer 'Prozess...'-Ebenen, sonst Default
  function paletteMetaFor(L) {
    if (!L) return { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };
    if (LAYER_META[L.name]) return LAYER_META[L.name];
    if (/prozess/i.test(L.name || '')) return PROCESS_META;
    return { soft: '#eef3f7', action: 'OBJEKT SETZEN', palette: [] };
  }

  function layerById(id) { return (state.detail.layers || []).find((l) => l.id === id) || null; }
  // Rollen-/Gruppen-Sichtbarkeit: Admins sehen immer alles; sonst null = alle, oder nur die Codes in der Liste
  function layerAllowed(code) { return !state.visibleLayers || state.visibleLayers.indexOf(code) >= 0; }
  function allowedLayers() { return (state.detail.layers || []).filter((l) => layerAllowed(l.code)); }
  // Sichtbarkeits-Map layerId -> bool (Auge-Zustand kombiniert mit Rollen-/Gruppensicht)
  function visibleMap() {
    const v = {};
    (state.detail.layers || []).forEach((l) => { v[l.id] = (l.visible !== false) && layerAllowed(l.code); });
    return v;
  }
  function objectsOfLayer(id) { return (state.detail.objects || []).filter((o) => o.layerId === id); }

  /* ---- Punkt-basierte Formen: Schutzbereich (geschlossen) + Materialfluss-Förderweg (offen) ---- */
  function isShape(o) { return o && (o.symbolType === 'sb_zone' || o.symbolType === 'sps_zone' || o.symbolType === 'fg_zone' || o.symbolType === 'mf_route' || o.symbolType === 'nh_zone'); }
  // Polygon-Art abhängig von der Ebene: "Funktionsgruppen" -> fg_zone, sonst Schutzbereich (sb_zone). Nach Namen, damit Umnummerieren nichts bricht.
  function zoneKind(layer) {
    if (state.drawShape === 'nhzone') return { type: 'nh_zone', prefix: 'Not-Halt-Grenze manuell', noun: 'Not-Halt-Grenze manuell', label: 'NOT-HALT' };
    if (state.drawShape === 'spszone') return { type: 'sps_zone', prefix: 'SPS-Bereich', noun: 'SPS-Bereich', label: 'SPS BEREICH' };
    if (layer && layer.name === 'Funktionsgruppen') return { type: 'fg_zone', prefix: 'Funktionsgruppe', noun: 'Funktionsgruppe', label: 'FG FUNKTIONSGRUPPE' };
    return { type: 'sb_zone', prefix: 'Schutzbereich', noun: 'Schutzbereich', label: 'SB SCHUTZBEREICH' };
  }
  // Label eines SPS-Bereichs = Name der zugeordneten SPS (1:1), sonst der Objektname.
  function spsZoneLabel(z) {
    if (z.plcConfigId) { const p = (state.detail.plcs || []).find((x) => x.id === z.plcConfigId); if (p) return p.name; }
    return z.name || 'SPS-Bereich';
  }
  // Name der einer Zone zugeordneten SPS (via plcConfigId), sonst ''.
  function plcNameOf(z) {
    if (!z || !z.plcConfigId) return '';
    const p = (state.detail.plcs || []).find((x) => x.id === z.plcConfigId);
    return p ? (p.name || '') : '';
  }

  const ROUTE_ARTS = (window.PMX && window.PMX.ROUTE_ARTS) || [];
  // Materialfluss-Typen mit fester Farbe (farbige Pfeile zur Auswahl unter Materialfluss)
  const FLOW_TYPES = (window.PMX && window.PMX.FLOW_TYPES) || [];
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
    const rows = names.map((n) => '<div class="fl-row"><span class="fl-dot" style="background:' + esc(used[n]) + '"></span>' + esc(n) + '</div>').join('');
    return '<div class="flow-legend"><div class="fl-head">Materialfluss<button data-act="flow-legend" title="Legende ausblenden">×</button></div>' + rows + '</div>';
  }
  const ROUTE_DASH = { 'Rollenbahn': '', 'Kettenförderer': '2.4 1.6', 'Band-/Gurtförderer': '', 'Hängeförderer': '4 2', 'FTS / AGV': '0.1 2.6', 'Stapler / manuell': '5 2 1 2', 'Manueller Transport': '5 2 1 2' };
  function routeArt(o) { const m = (o.metatags || []).find((x) => x.label === 'Förderart'); return m ? m.value : ''; }

  function docAspect() {
    if (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h) return state.layoutDim.w / state.layoutDim.h;
    return 760 / 520;
  }
  // Abstand Punkt→Strecke in seitenverhältnis-korrigiertem Raum (x mit ar skaliert → isotrop)
  const distToSegAR = window.PMX.distToSegAR;
  function pointNearRoute(o, x, y) {
    const p = o.points; if (!p || p.length < 2) return false;
    const ar = docAspect();
    for (let i = 0; i < p.length - 1; i++) { if (distToSegAR(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, ar) < 0.028) return true; }
    return false;
  }
  // Gefüllter Pfeilkopf am Streckenende; isotrop trotz preserveAspectRatio="none"
  // Weiche Kurve durch die Stützpunkte (Catmull-Rom → kubische Bézier). Liefert d-Pfad (viewBox 0..100)
  // und die Endtangente (normalisierte Richtung) für die Pfeil-Ausrichtung.
  const buildRouteCurve = window.PMX.buildRouteCurve;
  // Gefüllter Pfeilkopf am Endpunkt, ausgerichtet an einer (normalisierten) Tangente; isotrop trotz preserveAspectRatio="none".
  function routeArrowFromTan(tip, tanVb, ar) {
    let sdx = tanVb.x * ar, sdy = tanVb.y;
    const len = Math.hypot(sdx, sdy) || 1e-6; sdx /= len; sdy /= len;
    const back = { x: -sdx, y: -sdy }, L = 1.8, ang = Math.PI * 0.15;
    const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
    const w1 = rot(back, ang), w2 = rot(back, -ang);
    const tvx = tip.x * 100, tvy = tip.y * 100;
    const p1x = tvx + w1.x * L / ar, p1y = tvy + w1.y * L;
    const p2x = tvx + w2.x * L / ar, p2y = tvy + w2.y * L;
    return 'M' + p1x + ' ' + p1y + ' L' + tvx + ' ' + tvy + ' L' + p2x + ' ' + p2y + ' Z';
  }

  async function openEditor() {
    state.view = 'editor';
    state.undoStack = []; state.redoStack = [];
    if (!state.activeLayer || !layerAllowed((layerById(state.activeLayer) || {}).code)) {
      const al = allowedLayers(); if (al[0]) state.activeLayer = al[0].id;
    }
    if (state.sat == null) state.sat = 100;
    if (state.zoom == null) state.zoom = 1;
    await ensureLayoutBlob();
    await loadCustomSyms((currentWerk() || {}).id);
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
    if (state.undoBusy) return; // waehrend Undo/Redo nicht abgleichen - sonst kommt gerade Geloeschtes zurueck
    if (state.collab.inflight) return;
    state.collab.inflight = true;
    const _rev0 = state.objRev || 0; // Stand beim Start der Anfrage
    // Objekte über den zuverlässigen /objects-Endpunkt (keine Zeitstempel-Logik) + Präsenz über /changes.
    const sid = state.detail.id;
    let objsList, chg;
    const [objR, chR, cmR] = await Promise.allSettled([Api.getObjects(sid), Api.getChanges(sid, null), state.commentsServer ? Api.getComments(sid) : Promise.resolve(null)]);
    state.collab.inflight = false;
    if (state.view !== 'editor') return; // waehrend des Await weg-navigiert -> nicht mehr in den Editor rendern
    // Waehrend der Anfrage wurde lokal geaendert (z.B. Undo hat geloescht)? Dann ist die Antwort
    // veraltet - sie wuerde soeben Geloeschtes wiederbeleben (danach 404 beim naechsten Loeschen)
    // und Felder auf alte Werte zuruecksetzen. Verwerfen und beim naechsten Durchlauf neu holen.
    if (state.undoBusy || (state.objRev || 0) !== _rev0) return;
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
    // Kommentare mitpollen: bei Aenderung (neue Pins/Nachrichten anderer Nutzer) einspielen; Eingabe/Fokus bleiben erhalten.
    if (state.commentsServer && cmR && cmR.status === 'fulfilled' && Array.isArray(cmR.value)) {
      const csig = commentsSig(cmR.value);
      // Nur einspielen, wenn der Nutzer gerade nicht interagiert (Ziehen/Modal) - sonst wuerde renderEditor einen laufenden Drag abbrechen.
      if (csig !== state.commentsSig && collabIdle() && !state.iconDrag && !state.pinDrag && !state.cwDrag
        && Date.now() > (state.commentsHoldUntil || 0)) { state.commentsSig = csig; applyCommentsUpdate(cmR.value); }
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
        // Vom Nutzer gerade verschobene Zone/Weg: lokale Geometrie halten, bis der Server die neue Position bestätigt.
        const pend = state.geomPending[id];
        if (pend) {
          if (pointsMatch(row.points, pend.points)) {
            delete state.geomPending[id]; // Server hat die Verschiebung übernommen
          } else if (Date.now() - pend.ts < 120000) {
            const loc = cur[idx[id]];
            if (loc && !pointsMatch(loc.points, pend.points)) { loc.points = pend.points.map((p) => ({ x: p.x, y: p.y })); dirty = true; patchIds.push(id); }
            return; // veralteten Serverstand (noch nicht bestätigt) nicht übernehmen
          } else {
            delete state.geomPending[id]; // nach 2 Min. aufgeben (dann greift wieder der Serverstand)
          }
        }
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
  const pointsMatch = window.PMX.pointsMatch;
  const shapeVisualKey = window.PMX.shapeVisualKey;
  function flashShape(id) {
    const el = document.getElementById('zone-poly-' + id); if (!el) return;
    el.classList.remove('mf-flash'); void el.getBBox; el.classList.add('mf-flash');
    setTimeout(() => { const e = document.getElementById('zone-poly-' + id); if (e) e.classList.remove('mf-flash'); }, 900);
  }
  // Hat sich ein Objekt in einer sichtbaren/relevanten Eigenschaft geändert?
  // Der Server speichert Koordinaten als decimal(8,6); lokal liegen ungerundete Werte.
  // Ohne Rundung gelten reine Nachkomma-Reste als Aenderung -> unnoetige Schreibvorgaenge
  // und Undo-Schritte, die scheinbar fremde Objekte anfassen.
  const _r6 = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6;
  const _samePts = (p, q) => {
    if (!p || !q) return !p === !q;
    if (p.length !== q.length) return false;
    for (let i = 0; i < p.length; i++) { if (_r6(p[i].x) !== _r6(q[i].x) || _r6(p[i].y) !== _r6(q[i].y)) return false; }
    return true;
  };
  function objChanged(a, b) {
    if (a.name !== b.name || a.color !== b.color || a.symbolType !== b.symbolType || a.layerId !== b.layerId
      || _r6(a.x) !== _r6(b.x) || _r6(a.y) !== _r6(b.y) || _r6(a.rotation || 0) !== _r6(b.rotation || 0)
      || _r6(a.scale == null ? 1 : a.scale) !== _r6(b.scale == null ? 1 : b.scale)
      || (a.plcConfigId || '') !== (b.plcConfigId || '') || (a.visible !== false) !== (b.visible !== false)) return true;
    if (!_samePts(a.points || null, b.points || null)) return true;
    if (JSON.stringify(a.metatags || []) !== JSON.stringify(b.metatags || [])) return true;
    return false;
  }
  function personLabel(v) { return v.name || v.email || ''; }
  const personInitials = window.PMX.personInitials;
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
      ? '<img class="floor-bg floor-photo" draggable="false" src="' + state.layoutBlobUrl + '" alt="Anlagenlayout" style="opacity:' + op + ';object-fit:fill">'
      : '<svg class="floor-bg floor-schema" viewBox="0 0 760 520" preserveAspectRatio="xMidYMid meet" style="opacity:' + op + '" xmlns="http://www.w3.org/2000/svg">'
        + '<defs><pattern id="bp" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#D3DEE6" stroke-width="1"/></pattern>'
        + '<pattern id="bp2" width="130" height="130" patternUnits="userSpaceOnUse"><path d="M130 0H0V130" fill="none" stroke="#B9C7D1" stroke-width="1.3"/></pattern></defs>'
        + '<rect width="760" height="520" fill="#F7FAFC"/><rect width="760" height="520" fill="url(#bp)"/><rect width="760" height="520" fill="url(#bp2)"/>'
        + '<rect x="40" y="40" width="680" height="440" fill="none" stroke="#8FA3B0" stroke-width="2.5"/></svg>';
    const badge = state.layoutBlobUrl ? '<div class="layout-badge">' + t('eigenes Layout') + '</div>' : '<div class="layout-badge muted">' + t('Schema-Layout') + '</div>';

    const visible = visibleMap();
    const placed = (state.detail.objects || []).filter((o) => !isShape(o) && visible[o.layerId] !== false).map((o) => {
      const isProc = /^ptk_/.test(o.symbolType);
      const isRobot = o.symbolType === 'robot';
      const fgm = isProc ? (o.metatags || []).find((m) => m.label === 'Funktionsgruppen' && m.value && String(m.value).trim()) : null;
      const fgAssigned = !!fgm;
      const rSf = isRobot ? (o.metatags || []).find((m) => m.label === 'Safe Funktion' && m.value && String(m.value).trim()) : null;
      const rTc = isRobot ? (o.metatags || []).find((m) => m.label === 'Technologie' && m.value && String(m.value).trim()) : null;
      const robotIncomplete = isRobot && (!rSf || !rTc);
      // Prozesstyp: nur FG-Verknuepfung als Chip. Roboter: nur den Metatag "Safe Funktion". Sonstige Objekte: alle Metatags.
      let chipsHtml;
      if (isProc) {
        chipsHtml = fgm ? '<span class="ptag fg-chip"><span class="fg-k">FG</span>' + esc(String(fgm.value).trim()) + '</span>' : '';
      } else if (isRobot) {
        chipsHtml = rSf ? '<span class="ptag">' + esc(String(rSf.value).trim()) + '</span>' : '';
      } else {
        chipsHtml = (o.metatags || []).map((m) => m.value).filter(Boolean).map((t) => '<span class="ptag">' + esc(t) + '</span>').join('');
      }
      return '<div class="placed' + (fgAssigned ? ' fg-assigned' : '') + ' hover-tags' + (isSelObj(o.id) ? ' sel' : '') + '" data-obj="' + o.id + '" style="left:' + (o.x * 100) + '%;top:' + (o.y * 100) + '%;color:' + esc(objIconColor(o)) + ';--osc:' + (o.scale || 1) + '"'
        + ' title="' + esc(o.name) + ' — ziehen zum Verschieben · Doppelklick für Metatags">'
        + '<span class="p-sym">' + symInner(o.symbolType, 26) + '</span>'
        + (robotIncomplete ? '<span class="obj-warn" title="Safe Funktion und Technologie sind Pflicht">!</span>' : '')
        + (chipsHtml ? '<div class="ptags">' + chipsHtml + '</div>' : '')
        + '</div>';
    }).join('');

    // Zeichenfläche übernimmt das Seitenverhältnis des Layoutbilds -> Symbole sitzen passgenau
    const docStyle = (state.layoutBlobUrl && state.layoutDim && state.layoutDim.w && state.layoutDim.h)
      ? ' style="aspect-ratio:' + state.layoutDim.w + '/' + state.layoutDim.h + ';max-width:960px"' : '';

    return '<div class="canvas-doc ' + (state.drawZone ? 'drawing' : '') + '" id="canvasDoc"' + docStyle + '>'
      + bg + (state.snapGrid && !state.drawZone ? '<div class="snap-grid"></div>' : '') + (state.drawZone ? '<div class="draw-grid"></div><div class="draw-measure" id="draw-measure"></div>' : '') + zoneOverlaySvg(visible) + '<div class="placed-layer">' + placed + '</div>' + fgLabelLayer(visible) + stateIconLayer(visible) + techBadgeLayer() + robotSuggestionLayer() + learnPromptLayer() + commentPinLayer() + commentWindowLayer() + zoneHandleLayer() + selResizeLayer() + badge + '</div>';
  }

  // Frei platzierbare Zustands-Icons mit Verbindungslinie zum Prozesstyp
  function iconPosMap(o) {
    const m = (o.metatags || []).find((x) => x.label === 'Icon-Positionen');
    if (m && m.value) { try { return JSON.parse(m.value) || {}; } catch (e) { return {}; } }
    return {};
  }
  function describedStateIcons(o) {
    const pos = iconPosMap(o); const out = []; let i = 0;
    (o.metatags || []).filter((m) => (m.position || 0) >= 3 && m.value && String(m.value).trim() && m.label !== 'Icon-Positionen')
      .forEach((m) => {
        const nm = String(m.label || '').replace(/^(Pflicht|Optional) – /, '');
        if (!STATE_ICONS[nm]) return;
        const dp = pos[nm];
        const x = dp ? clamp01(dp.x) : clamp01(o.x + 0.07 + (i % 3) * 0.055);
        const y = dp ? clamp01(dp.y) : clamp01(o.y - 0.10 + Math.floor(i / 3) * 0.055);
        out.push({ name: nm, desc: m.value, x, y }); i++;
      });
    return out;
  }
  function stateIconLayer(visible) {
    const objs = (state.detail.objects || []).filter((o) => /^ptk_/.test(o.symbolType) && visible[o.layerId] !== false);
    const lines = []; const icons = [];
    objs.forEach((o) => {
      describedStateIcons(o).forEach((it) => {
        const key = o.id + '__' + it.name;
        lines.push('<line data-sline="' + esc(key) + '" x1="' + (o.x * 100) + '" y1="' + (o.y * 100) + '" x2="' + (it.x * 100) + '" y2="' + (it.y * 100) + '"/>');
        icons.push('<div class="state-icon" data-sicon-parent="' + o.id + '" data-sicon-state="' + esc(it.name) + '" style="left:' + (it.x * 100) + '%;top:' + (it.y * 100) + '%" title="' + esc(it.name + ': ' + it.desc) + '"><img src="' + STATE_ICONS[it.name] + '" alt=""></div>');
      });
    });
    if (!icons.length) return '';
    return '<svg class="state-link-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + lines.join('') + '</svg>' + icons.join('');
  }

  // Metatags einer Funktionsgruppe/eines Schutzbereichs dauerhaft mittig im Polygon anzeigen (HTML-Overlay, damit kein Verzerren)
  function fgLabelLayer(visible) {
    const zones = (state.detail.objects || []).filter((o) => (o.symbolType === 'fg_zone' || o.symbolType === 'sb_zone' || o.symbolType === 'sps_zone' || o.symbolType === 'nh_zone') && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    if (!zones.length) return '';
    return '<div class="fg-label-layer">' + zones.map((z) => {
      let cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
      let cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
      if (z.symbolType === 'nh_zone') { let ti = 0; z.points.forEach((p, i) => { if (p.y < z.points[ti].y) ti = i; }); cx = z.points[ti].x; cy = z.points[ti].y; }
      const tags = (z.metatags || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map((m) => m.value).filter((v) => v !== null && v !== '');
      const lines = z.symbolType === 'nh_zone' ? ['NOT-HALT'] : (z.symbolType === 'sps_zone' ? [spsZoneLabel(z)] : (tags.length ? tags : [z.name]));
      const abbrev = (t) => (z.symbolType === 'sb_zone' ? String(t).replace(/Schutzbereich/g, 'SB') : t);
      // SPS-Zuordnung als zusaetzlichen Meta-Tag anzeigen (Funktionsgruppe + Schutzbereich)
      const spsNm = (z.symbolType === 'fg_zone' || z.symbolType === 'sb_zone') ? plcNameOf(z) : '';
      const inner = lines.map((t) => '<div class="fgl-line">' + esc(abbrev(t)) + '</div>').join('')
        + (spsNm ? '<div class="fgl-line fgl-sps"><span class="fgl-sps-k">SPS</span>' + esc(spsNm) + '</div>' : '');
      return '<div class="fg-label" data-zone="' + z.id + '" style="left:' + (cx * 100) + '%;top:' + (cy * 100) + '%;color:' + esc(zoneColor(z)) + '">' + inner + '</div>';
    }).join('') + '</div>';
  }

  // Polygon mit leicht abgerundeten Ecken als SVG-Pfad (Punkte im 0..100-Raum). r = Rundungsradius.
  const roundedPolyPath = window.PMX.roundedPolyPath;
  // Kleine Blitze entlang der SB-Grenze (statt Pfeilen). Aspektkorrigiert, in Zonenfarbe.
  const sbBoltPath = window.PMX.sbBoltPath;
  function zoneOverlaySvg(visible) {
    const zones = (state.detail.objects || []).filter((o) => (o.symbolType === 'sb_zone' || o.symbolType === 'sps_zone' || o.symbolType === 'fg_zone' || o.symbolType === 'nh_zone') && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
    const hlFg = highlightedFgZoneId();
    const hlSps = highlightedSpsZoneId();
    const ar = docAspect();
    const polys = zones.map((z) => {
      const sel = state.selectedZone === z.id;
      const hl = z.id === hlFg || z.id === hlSps;
      const hlCol = z.id === hlSps ? '#0065A5' : '#16A34A';
      const col = hl ? hlCol : esc(zoneColor(z));
      const sw = hl ? 3.4 : (sel ? 2.6 : (z.symbolType === 'nh_zone' ? 2.4 : 1.6));
      const fo = hl ? '0.22' : (sel ? '0.2' : '0.13');
      const dPath = roundedPolyPath(z.points.map((p) => ({ x: p.x * 100, y: p.y * 100 })), 1.5);
      const dash = z.symbolType === 'sb_zone' ? 'stroke-dasharray="6 4" ' : (z.symbolType === 'fg_zone' ? 'stroke-dasharray="1.5 4" stroke-linecap="round" ' : (z.symbolType === 'nh_zone' ? 'stroke-dasharray="0.1 4.5" stroke-linecap="round" ' : ''));
      const marks = z.symbolType === 'sb_zone' ? ('<path id="sb-bolts-' + z.id + '" d="' + sbBoltPath(z, ar) + '" fill="' + col + '" fill-opacity="0.5" stroke="none" style="pointer-events:none"/>') : '';
      return '<path id="zone-poly-' + z.id + '" d="' + dPath + '" fill="' + col + '" fill-opacity="' + fo + '" stroke="' + col + '" stroke-width="' + sw + '" ' + (hl ? 'class="fg-hl" ' : '') + dash + 'vector-effect="non-scaling-stroke" style="pointer-events:none" />' + marks;
    }).join('');
    const routes = (state.detail.objects || []).filter((o) => o.symbolType === 'mf_route' && o.points && o.points.length >= 2 && visible[o.layerId] !== false);
    const routeSvg = routes.map((r) => {
      const cv = buildRouteCurve(r.points);
      const sel = state.selectedZone === r.id;
      const col = esc(r.color || '#0FA47F');
      const dash = ROUTE_DASH[routeArt(r)] || '';
      const line = '<path id="zone-poly-' + r.id + '" d="' + cv.d + '" fill="none" stroke="' + col + '" stroke-width="' + (sel ? 2.8 : 2) + '" '
        + (dash ? ('stroke-dasharray="' + dash + '" ') : '') + 'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" class="mf-line' + (sel ? ' sel' : '') + '" style="pointer-events:none"/>';
      const arrow = '<path id="route-arrow-' + r.id + '" d="' + routeArrowFromTan(r.points[r.points.length - 1], cv.tan, ar) + '" fill="' + col + '" stroke="' + col + '" stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      return line + arrow;
    }).join('');
    let draft = '';
    if (state.drawZone) {
      const L = layerById(state.activeLayer); const col = esc(L ? L.color : '#0065A5');
      const cur = state.zoneCursor; const al = state.zoneAlign || {};
      const gx = cur ? (cur.x * 100) : -20, gy = cur ? (cur.y * 100) : -20;
      // Fadenkreuz-Hilfslinien am Cursor (orange, wenn auf einen Stützpunkt ausgerichtet)
      draft += '<line id="guide-v" x1="' + gx + '" y1="0" x2="' + gx + '" y2="100" stroke="' + (al.x ? '#E8663F' : '#0065A5') + '" stroke-width="0.9" stroke-dasharray="2.2 1.6" opacity="0.9" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      draft += '<line id="guide-h" x1="0" y1="' + gy + '" x2="100" y2="' + gy + '" stroke="' + (al.y ? '#E8663F' : '#0065A5') + '" stroke-width="0.9" stroke-dasharray="2.2 1.6" opacity="0.9" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      draft += '<circle id="snap-ring" cx="-20" cy="-20" r="1.7" fill="#16A34A" fill-opacity="0.12" stroke="#16A34A" stroke-width="1.2" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      // Blauer Ring am ERSTEN Stuetzpunkt, sobald der Cursor nah genug ist, um das Polygon zu schliessen.
      draft += '<circle id="close-ring" cx="-20" cy="-20" r="2.2" fill="#0065A5" fill-opacity="0.15" stroke="#0065A5" stroke-width="1.8" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
      if (state.zoneDraft.length) {
        const dots = state.zoneDraft.map((p) => '<rect x="' + (p.x * 100 - 0.7) + '" y="' + (p.y * 100 - 0.7) + '" width="1.4" height="1.4" fill="' + col + '" style="pointer-events:none"/>').join('');
        if (state.drawShape === 'route') {
          const dpull = cur ? state.zoneDraft.concat([cur]) : state.zoneDraft;
          draft += '<path id="zone-draft" d="' + buildRouteCurve(dpull).d + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' + dots;
        } else {
          const dpts = state.zoneDraft.map((p) => (p.x * 100) + ',' + (p.y * 100));
          if (cur) dpts.push((cur.x * 100) + ',' + (cur.y * 100));
          draft += '<polyline id="zone-draft" points="' + dpts.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' + dots;
        }
      }
    }
    return '<svg class="zone-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2">' + techLinesSvg(visible) + polys + routeSvg + draft + '</svg>';
  }

  function isSelObj(id) { return (state.selObjs && state.selObjs.indexOf(id) >= 0) || state.selectedObj === id; }
  function toggleSelObj(id) {
    const o = (state.detail.objects || []).find((z) => z.id === id);
    if (!o || isShape(o)) return; // nur Punkt-Objekte/Icons, keine Zonen
    state.selObjs = state.selObjs || [];
    const i = state.selObjs.indexOf(id);
    if (i >= 0) state.selObjs.splice(i, 1); else state.selObjs.push(id);
    state.selectedObj = null; state.selectedZone = null;
  }
  function selBBox() {
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (!objs.length) return null;
    let minx = 1, miny = 1, maxx = 0, maxy = 0, maxS = 1;
    objs.forEach((o) => { minx = Math.min(minx, o.x); miny = Math.min(miny, o.y); maxx = Math.max(maxx, o.x); maxy = Math.max(maxy, o.y); maxS = Math.max(maxS, o.scale || 1); });
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, objs: objs, maxS: maxS };
  }
  function handleOff(scale) { return 0.014 * (scale || 1) + 0.012; }
  function selResizeLayer() {
    const bb = selBBox();
    if (!bb) return '';
    const arrow = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8 L16 16 M8 8 L8 12 M8 8 L12 8 M16 16 L16 12 M16 16 L12 16"/></svg>';
    return bb.objs.map(function (o) {
      const off = handleOff(o.scale || 1);
      const hx = clamp01(o.x + off), hy = clamp01(o.y + off);
      return '<div class="sel-resize" data-scalehandle="1" data-obj="' + o.id + '" style="left:' + (hx * 100) + '%;top:' + (hy * 100) + '%" title="' + t('Symbolgröße ziehen') + '">' + arrow + '</div>';
    }).join('');
  }
  function startScaleDrag(e) {
    const bb = selBBox(); if (!bb) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width), py = clamp01((e.clientY - r.top) / r.height);
    const startDist = Math.max(0.04, Math.hypot(px - bb.cx, py - bb.cy));
    const start = {}, pos = {};
    bb.objs.forEach((o) => { start[o.id] = o.scale || 1; pos[o.id] = { x: o.x, y: o.y }; });
    state._preDrag = snapObjects();
    state.scaleDrag = { ids: bb.objs.map((o) => o.id), cx: bb.cx, cy: bb.cy, startDist: startDist, start: start, pos: pos, last: {} };
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
  }
  function onScaleDrag(e) {
    const sd = state.scaleDrag; if (!sd) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const px = clamp01((e.clientX - r.left) / r.width), py = clamp01((e.clientY - r.top) / r.height);
    const factor = Math.hypot(px - sd.cx, py - sd.cy) / sd.startDist;
    sd.ids.forEach((id) => {
      const ns = Math.min(3, Math.max(0.4, (sd.start[id] || 1) * factor));
      sd.last[id] = ns;
      const el = document.querySelector('.placed[data-obj="' + id + '"]');
      if (el) el.style.setProperty('--osc', ns.toFixed(2));
      const p = sd.pos[id];
      const h = document.querySelector('.sel-resize[data-obj="' + id + '"]');
      if (p && h) { const off = handleOff(ns); h.style.left = (clamp01(p.x + off) * 100) + '%'; h.style.top = (clamp01(p.y + off) * 100) + '%'; }
    });
  }
  async function endScaleDrag() {
    const sd = state.scaleDrag; state.scaleDrag = null; if (!sd) return;
    let changed = false;
    Object.keys(sd.last).forEach((id) => {
      const o = (state.detail.objects || []).find((z) => z.id === id); if (!o) return;
      const ns = Math.round(sd.last[id] * 100) / 100;
      if ((o.scale || 1) !== ns) { o.scale = ns; changed = true; protectObj(o.id); Api.updateObject(id, { scale: ns }).catch(() => { toast(t('Änderung nicht gespeichert')); }); }
    });
    if (changed && state._preDrag) { pushUndoSnap(state._preDrag); }
    state._preDrag = null;
    renderEditor();
  }
  function startGroupDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const el = e.target.closest('.placed'); if (!el) return;
    const ids = (state.selObjs || []).slice();
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (objs.length < 2) return;
    const start = {};
    objs.forEach((o) => { start[o.id] = { x: o.x, y: o.y, points: (o.points || []).map((p) => ({ x: p.x, y: p.y })), scale: o.scale || 1 }; });
    state._preDrag = snapObjects();
    state.groupDrag = { ids: objs.map((o) => o.id), start: start, sx: e.clientX, sy: e.clientY, doc: doc, moved: false, dx: 0, dy: 0 };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  function onGroupDrag(e) {
    const gd = state.groupDrag; if (!gd) return;
    if (!gd.moved && Math.hypot(e.clientX - gd.sx, e.clientY - gd.sy) < 4) return;
    gd.moved = true;
    const r = gd.doc.getBoundingClientRect();
    let dx = (e.clientX - gd.sx) / r.width, dy = (e.clientY - gd.sy) / r.height;
    if (state.snapGrid) { dx = snapToGrid(dx); dy = snapToGrid(dy); }
    gd.dx = dx; gd.dy = dy;
    gd.ids.forEach((id) => {
      const s = gd.start[id];
      const nx = clamp01(s.x + dx), ny = clamp01(s.y + dy);
      const el = document.querySelector('.placed[data-obj="' + id + '"]');
      if (el) { el.style.left = (nx * 100) + '%'; el.style.top = (ny * 100) + '%'; el.style.cursor = 'grabbing'; }
      const h = document.querySelector('.sel-resize[data-obj="' + id + '"]');
      if (h) { const off = handleOff(s.scale); h.style.left = (clamp01(nx + off) * 100) + '%'; h.style.top = (clamp01(ny + off) * 100) + '%'; }
    });
  }
  async function endGroupDrag() {
    const gd = state.groupDrag; state.groupDrag = null; if (!gd) return;
    if (!gd.moved) { renderEditor(); return; }
    let changed = false;
    for (const id of gd.ids) {
      const o = (state.detail.objects || []).find((z) => z.id === id); if (!o) continue;
      const s = gd.start[id];
      const nx = clamp01(s.x + gd.dx), ny = clamp01(s.y + gd.dy);
      if (o.x !== nx || o.y !== ny) {
        o.x = nx; o.y = ny;
        const patch = { x: nx, y: ny };
        if (s.points && s.points.length) {
          o.points = s.points.map((p) => ({ x: clamp01(p.x + gd.dx), y: clamp01(p.y + gd.dy) }));
          patch.points = o.points;
        }
        changed = true; protectObj(o.id);
        Api.updateObject(id, patch).catch(() => { toast(t('Position nicht gespeichert')); });
      }
    }
    if (changed && state._preDrag) { pushUndoSnap(state._preDrag); }
    state._preDrag = null;
    renderEditor();
  }
  function copySelectedObjects() {
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (!objs.length) return;
    state.clipboard = objs.map((o) => ({
      srcStation: state.detail.id,
      layerId: o.layerId, categoryId: o.categoryId || null, name: o.name, symbolType: o.symbolType,
      color: o.color, x: o.x, y: o.y, rotation: o.rotation || 0,
      points: (o.points || []).map((p) => ({ x: p.x, y: p.y })),
      plcConfigId: o.plcConfigId || null, scale: o.scale || 1,
      metatags: (o.metatags || []).map((m) => ({ position: m.position, label: m.label, value: m.value })),
    }));
    toast(objs.length === 1 ? t('Icon kopiert') : (objs.length + ' ' + t('Icons kopiert')));
  }
  function pasteObjects() { return withMutationLock(function () { return pasteObjectsImpl(); }); }
  async function pasteObjectsImpl() {
    const cb = state.clipboard || [];
    if (!cb.length || !state.detail) return;
    const dx = 0.03, dy = 0.03;
    pushUndo();
    const newIds = [];
    for (const c of cb) {
      const sameStation = c.srcStation === state.detail.id;
      const body = {
        layerId: c.layerId, categoryId: c.categoryId, name: c.name, symbolType: c.symbolType,
        color: c.color, x: clamp01(c.x + dx), y: clamp01(c.y + dy), rotation: c.rotation,
        plcConfigId: sameStation ? c.plcConfigId : null,
      };
      if (c.points && c.points.length) {
        body.points = c.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
      }
      let no;
      try { no = await Api.createObject(state.detail.id, body); } catch (e) { continue; }
      if (!no || !no.id) continue;
      if (c.scale && c.scale !== 1) { try { await Api.updateObject(no.id, { scale: c.scale }); } catch (e) { /* ignore */ } no.scale = c.scale; }
      if (c.metatags && c.metatags.length) { try { await Api.setMetatags(no.id, c.metatags); } catch (e) { /* ignore */ } no.metatags = c.metatags; }
      state.detail.objects.push(no);
      newIds.push(no.id);
    }
    // Klemmbrett fuer erneutes Einfuegen weiter versetzen (Kaskade)
    state.clipboard = cb.map((c) => Object.assign({}, c, { x: clamp01(c.x + dx), y: clamp01(c.y + dy), points: (c.points || []).map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })) }));
    state.selObjs = newIds; state.selectedObj = newIds.length === 1 ? newIds[0] : null; state.selectedZone = null;
    renderEditor();
    if (newIds.length) toast(newIds.length === 1 ? t('Icon eingefügt') : (newIds.length + ' ' + t('Icons eingefügt')));
  }
  async function deleteSelectedObjects() {
    const ids = (state.selObjs && state.selObjs.length) ? state.selObjs.slice() : (state.selectedObj ? [state.selectedObj] : []);
    const objs = (state.detail.objects || []).filter((o) => ids.indexOf(o.id) >= 0 && !isShape(o));
    if (!objs.length) return;
    pushUndo();
    state.selObjs = []; state.selectedObj = null;
    for (const o of objs) {
      try { await Api.deleteObject(o.id); } catch (e) { /* ignore */ }
      state.detail.objects = (state.detail.objects || []).filter((x) => x.id !== o.id);
    }
    renderEditor();
    toast(objs.length === 1 ? t('Icon gelöscht') : (objs.length + ' ' + t('Icons gelöscht')));
  }
  function zoneHandleLayer() {
    if (state.drawZone || !state.selectedZone) return '';
    const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone && isShape(o) && o.points);
    if (!z) return '';
    const isRoute = z.symbolType === 'mf_route';
    const n = z.points.length;
    const verts = z.points.map((p, i) =>
      '<div class="zone-vertex" data-zone="' + z.id + '" data-vidx="' + i + '" title="Ziehen · Rechtsklick entfernt" style="left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%"></div>').join('');
    const edgeCount = isRoute ? n - 1 : n;
    let mids = '';
    for (let i = 0; i < edgeCount; i++) {
      const p = z.points[i], q = z.points[(i + 1) % n];
      mids += '<div class="zone-midpoint" data-zone="' + z.id + '" data-eidx="' + i + '" title="Stützpunkt einfügen" style="left:' + ((p.x + q.x) / 2 * 100) + '%;top:' + ((p.y + q.y) / 2 * 100) + '%">+</div>';
    }
    const m = polyMetrics(z.points);
    const measure = m ? '<div class="zone-measure" style="left:' + (m.minx * 100) + '%;top:' + (m.miny * 100) + '%">' + fmtMetrics(m, !isRoute) + '</div>' : '';
    return '<div class="zone-handle-layer">' + mids + verts + measure + '</div>';
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
  // Grafische Symbole je Technologie (weiss auf orangem Punkt). Unbekannte -> Buchstabencode als Fallback.
  const TECH_ICON = {
    'Punkt Schweißen - Stahl': '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M6.1 6.1l1.9 1.9M16 16l1.9 1.9M17.9 6.1 16 8M8 16l-1.9 1.9"/>',
    'MIG-Schweißen': '<path d="M13 2.5 6 13h4.2l-2.2 8.5L18 10h-5z" fill="currentColor" stroke="none"/>',
    'Bolzen-Schweißen': '<path d="M6.5 5h11M12 5v9"/><path d="M9 14h6l-3 5z" fill="currentColor" stroke="none"/>',
    'Bolzen-Schweißen (Rotationskopf)': '<path d="M6.5 9h11M12 9v6"/><path d="M9.5 15h5l-2.5 4z" fill="currentColor" stroke="none"/><path d="M15.2 3.1a4.2 4.2 0 0 1 2.6 3.9"/><path d="M13.8 3.3 15.4 2.7 16.1 4.3"/>',
    'Bolzen (stationär)': '<path d="M6.5 5h11M12 5v8"/><path d="M9 13h6l-3 5z" fill="currentColor" stroke="none"/><path d="M4.5 21h15"/>',
    'Kleben': '<path d="M12 3.4c3.2 4.9 5 7.1 5 10.1a5 5 0 0 1-10 0c0-3 1.8-5.2 5-10.1z" fill="currentColor" stroke="none"/>',
    'Laser': '<path d="M12 2v9" stroke-width="2.4"/><circle cx="12" cy="14.6" r="2" fill="currentColor" stroke="none"/><path d="M12 17.6v3.4M7.4 15.4 5.4 17.9M16.6 15.4 18.6 17.9" stroke-width="1.6"/>',
    'Halbholstanznieten': '<path d="M5.5 6h13l-2.4 4H7.9z" fill="currentColor" stroke="none"/><path d="M9 10v6l3 3 3-3v-6"/>',
    'Fließlochschrauben': '<path d="M9 3.5h6M12 3.5V7"/><path d="M8 8h8M8.7 11.2h6.6M9.6 14.4h4.8"/><path d="M10.6 16.8 12 20.5l1.4-3.7z" fill="currentColor" stroke="none"/>',
    'Inline messen': '<rect x="3.5" y="8" width="17" height="8" rx="1"/><path d="M7 8v3.4M11 8v4.6M15 8v3.4M19 8v3.4" stroke-width="1.5"/>',
  };
  function techIconSvg(name) {
    const inner = TECH_ICON[name];
    if (!inner) return esc(techCode(name));
    return '<svg class="tb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  function techInfo(o) {
    if (o.symbolType !== 'robot') return null;
    const m = (o.metatags || []).find((t) => t.position === 2 && t.value);
    if (!m || !m.value) return null;
    let bx, by;
    if (o.points && o.points.length >= 1 && o.points[0]) { bx = o.points[0].x; by = o.points[0].y; }
    else { bx = Math.min(o.x + 0.12, 0.94); by = Math.max(o.y - 0.12, 0.07); }
    return { id: o.id, name: m.value, code: techCode(m.value), col: objIconColor(o), rx: o.x, ry: o.y, bx, by };
  }
  // Abstand vom Zentrum bis zur abgerundeten Rechteck-Umrandung entlang (ux,uy) (alles in Pixeln).
  const rayRoundedRectDist = window.PMX.rayRoundedRectDist;
  // Endpunkte der Technologie-Linie: 2px ausserhalb der sichtbaren Umrandung -
  // Roboter-Kasten (38px inkl. Rahmen, abgerundet r=9) und Tech-Icon-Kreis (Radius 13px).
  function techLineEnds(rx, ry, bx, by) {
    const doc = document.getElementById('canvasDoc');
    const W = (doc && doc.clientWidth) || 900, H = (doc && doc.clientHeight) || 560;
    const dxPx = (bx - rx) * W, dyPx = (by - ry) * H;
    const len = Math.hypot(dxPx, dyPx);
    let x1 = rx * 100, y1 = ry * 100, x2 = bx * 100, y2 = by * 100;
    if (len > 1) {
      const ux = dxPx / len, uy = dyPx / len;
      const tR = rayRoundedRectDist(ux, uy, 19, 19, 9) + 2; // Kasten-Umrandung + 2px
      const tB = 13 + 2; // Icon-Kreisrand + 2px
      if (len > tR + tB + 1) {
        x1 += (ux * tR) / W * 100; y1 += (uy * tR) / H * 100;
        x2 -= (ux * tB) / W * 100; y2 -= (uy * tB) / H * 100;
      }
    }
    return { x1, y1, x2, y2 };
  }
  function techLinesSvg(visible) {
    return (state.detail.objects || []).map((o) => {
      if (visible[o.layerId] === false) return '';
      const t = techInfo(o); if (!t) return '';
      const e = techLineEnds(t.rx, t.ry, t.bx, t.by);
      return '<line id="tech-line-' + t.id + '" x1="' + e.x1.toFixed(3) + '" y1="' + e.y1.toFixed(3) + '" x2="' + e.x2.toFixed(3) + '" y2="' + e.y2.toFixed(3) + '" stroke="' + esc(t.col) + '" stroke-width="1.3" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>';
    }).join('');
  }
  function techBadgeLayer() {
    const visible = visibleMap();
    const editable = canEdit();
    const badges = (state.detail.objects || []).map((o) => {
      if (visible[o.layerId] === false) return '';
      const t = techInfo(o); if (!t) return '';
      return '<div class="tech-badge" data-tech="' + t.id + '" style="left:' + (t.bx * 100) + '%;top:' + (t.by * 100) + '%">'
        + '<span class="tb-dot" style="background:' + esc(t.col) + ';box-shadow:0 2px 7px rgba(30,42,51,.35)"' + (editable ? ' data-techdrag="' + t.id + '" title="Verschieben"' : '') + '>' + techIconSvg(t.name) + '</span>'
        + '<span class="tb-name">' + esc(t.name) + '</span></div>';
    }).join('');
    return '<div class="tech-badge-layer">' + badges + '</div>';
  }
  function onTechDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    let x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    if (state.snapGrid) { x = clamp01(snapToGrid(x)); y = clamp01(snapToGrid(y)); }
    const o = (state.detail.objects || []).find((z) => z.id === state.techDrag.id); if (!o) return;
    o.points = [{ x, y }]; state.techDrag.moved = true; state.techDrag.fx = x; state.techDrag.fy = y; protectObj(o.id);
    const line = document.getElementById('tech-line-' + o.id);
    if (line) { const e = techLineEnds(o.x, o.y, x, y); line.setAttribute('x1', e.x1.toFixed(3)); line.setAttribute('y1', e.y1.toFixed(3)); line.setAttribute('x2', e.x2.toFixed(3)); line.setAttribute('y2', e.y2.toFixed(3)); }
    const badge = document.querySelector('.tech-badge[data-tech="' + o.id + '"]');
    if (badge) { badge.style.left = (x * 100) + '%'; badge.style.top = (y * 100) + '%'; }
  }

  // Schnelle Deselektion ohne Voll-Render: entfernt nur die Auswahl-Hervorhebung (Objekte + Resize-Griffe + Objektliste).
  // Ist eine Zone selektiert, wird sicherheitshalber voll gerendert (Zonen-Styling/Handles brauchen den Voll-Render).
  function deselectFast() {
    if (state.selectedZone) {
      state.selectedObj = null; state.selectedZone = null; state.selObjs = [];
      renderEditor(); return;
    }
    const had = state.selectedObj || (state.selObjs && state.selObjs.length);
    state.selectedObj = null; state.selObjs = [];
    if (!had) return;
    const doc = document.getElementById('canvasDoc');
    if (doc) {
      doc.querySelectorAll('.placed.sel').forEach((el) => el.classList.remove('sel'));
      doc.querySelectorAll('.sel-resize').forEach((el) => el.remove());
    }
    const cont = document.getElementById('content');
    if (cont) cont.querySelectorAll('.obj.sel').forEach((el) => el.classList.remove('sel'));
  }
  // renderEditor delegiert an renderEditorImpl (stabiler Einstiegspunkt; frueherer ?perf=1-Timing-Wrapper wurde entfernt).
  // Layout zuruecksetzen (nur Administrator): loescht ALLE Objekte dieser Anlage ueber alle
  // Ebenen hinweg. Das Layout-Bild bleibt erhalten. Keine automatische Versions-Sicherung
  // (bewusste Entscheidung); umkehrbar bleibt es direkt danach ueber Undo (Strg+Z),
  // das den Objektbestand auch serverseitig wiederherstellt.
  // Loescht Objekte in kleinen Gruppen statt alle gleichzeitig: ein Schwall paralleler Anfragen
  // laeuft sonst ins Anfragelimit des Servers, einzelne Loeschungen scheitern - genau daher blieben
  // beim Zuruecksetzen Reste stehen. Liefert die IDs zurueck, die NICHT geloescht werden konnten.
  async function deleteObjectsInBatches(ids) {
    const failedIds = [];
    for (let i = 0; i < ids.length; i += 6) {
      const part = ids.slice(i, i + 6);
      const res = await Promise.all(part.map(function (id) {
        return Api.deleteObject(id).then(function () { return null; }).catch(function () { return id; });
      }));
      res.forEach(function (id) { if (id) failedIds.push(id); });
    }
    return failedIds;
  }
  async function resetLayout() {
    if (!state.isAdmin || !state.detail || !state.detail.id) return;
    const sid = state.detail.id;
    const objs = (state.detail.objects || []).slice();
    if (!objs.length) { toast(t('Layout ist bereits leer')); return; }
    if (!window.confirm(t('Gesamtes Layout zurücksetzen?') + '\n\n'
      + t('{n} Objekte aller Ebenen werden gelöscht. Das Layout-Bild bleibt erhalten.', { n: objs.length }) + '\n'
      + t('Rückgängig nur direkt danach mit Strg+Z.'))) return;
    pushUndo();
    state.undoBusy = true; updateUndoBtns(); // waehrenddessen kein Abgleich und kein Undo dazwischen
    // Fläche SOFORT leeren und einmal zeichnen. Vorher stand alles bis zum Ende der Loeschungen
    // sichtbar da und verschwand dann in einem grossen Neuaufbau - das war das Flackern.
    state.detail.objects = [];
    state.selObjs = []; state.selectedObj = null; state.selectedZone = null;
    renderEditor();
    try {
      let rest = await deleteObjectsInBatches(objs.map(function (o) { return o.id; }));
      if (rest.length) { await new Promise(function (r) { setTimeout(r, 700); }); rest = await deleteObjectsInBatches(rest); } // zweiter Versuch
      // Nachkontrolle direkt am Server: erfasst auch Objekte, die lokal noch gar nicht bekannt waren
      // (z.B. parallel von jemand anderem angelegt) und alles, was beim ersten Durchgang haengen blieb.
      for (let pass = 0; pass < 2; pass++) {
        let left = [];
        try { const fresh = await Api.getObjects(sid); left = Array.isArray(fresh) ? fresh : []; } catch (e) { break; }
        if (!left.length) break;
        await deleteObjectsInBatches(left.map(function (o) { return o.id; }));
      }
      // Endstand vom Server holen - die Anzeige zeigt danach garantiert das, was wirklich gespeichert ist.
      let remaining = [];
      try { const after = await Api.getObjects(sid); remaining = Array.isArray(after) ? after : []; } catch (e) { remaining = []; }
      state.objRev = (state.objRev || 0) + 1;
      // Nur neu zeichnen, wenn wider Erwarten etwas uebrig blieb - sonst steht die leere Flaeche
      // schon seit dem ersten Durchgang und ein zweiter Aufbau wuerde nur unnoetig flackern.
      if (remaining.length) { state.detail.objects = remaining; renderEditor(); }
      const geloescht = objs.length - remaining.length;
      // Journaleintrag bewusst auf Deutsch (Journal ist Datenbestand, wie die Backend-Eintraege)
      try { await Api.addJournal(sid, 'Layout zurueckgesetzt (' + geloescht + ' Objekte geloescht)'); } catch (e) { /* best-effort */ }
      toast(remaining.length
        ? t('{n} Objekte konnten nicht gelöscht werden', { n: remaining.length })
        : t('Layout zurückgesetzt – {n} Objekte gelöscht', { n: geloescht }));
    } finally { state.undoBusy = false; updateUndoBtns(); }
  }
  function renderEditor() {
    return renderEditorImpl();
  }
  function renderEditorImpl() {
    _hoverZoneId = null; // DOM wird neu gebaut -> Hover-State verwerfen, damit Highlight/Cursor beim naechsten Mausruck neu greift
    const c = $('content'); c.style.padding = '0';
    let L = layerById(state.activeLayer);
    if (!L || !layerAllowed(L.code)) L = allowedLayers()[0] || (state.detail.layers || [])[0];
    if (L && state.activeLayer !== L.id) state.activeLayer = L.id;
    if (!L) { c.innerHTML = '<div class="pad">Keine Ebenen sichtbar.</div>'; return; }
    const meta = paletteMetaFor(L);

    const counts = {};
    (state.detail.objects || []).forEach((o) => { counts[o.layerId] = (counts[o.layerId] || 0) + 1; });

    const palItem = ([name, sym]) => {
      const mm = String(name).match(/^(\d+)\s+(.+)$/);
      const no = mm ? mm[1] : '';
      const label = mm ? mm[2] : name;
      return '<div class="pal-item" style="color:' + esc(L.color) + ';--lc:' + esc(L.color) + ';--lc-soft:' + esc(meta.soft) + '" draggable="true" data-sym="' + sym + '" data-name="' + esc(name) + '" data-color="' + esc(L.color) + '" data-act="pal-hint" title="Auf das Layout ziehen">'
        + '<div class="sym">' + symInner(sym, 24) + '</div>'
        + '<div class="pal-cap">' + (no ? '<span class="pal-no">' + no + '</span>' : '') + '<span class="pal-nm">' + esc(label) + '</span></div>'
        + '</div>';
    };
    // Eigene (hochgeladene) Symbole der aktiven Ebene + „+"-Kachel
    const customPalHtml = () => {
      const items = Object.keys(state.customSyms || {}).map((st) => state.customSyms[st]).filter((c) => c.layerCode === L.code);
      const manage = canManagePalette();
      const tiles = items.map((c) => '<div class="pal-item custom" style="color:' + esc(L.color) + ';--lc:' + esc(L.color) + ';--lc-soft:' + esc(meta.soft) + '" draggable="true" data-sym="custom:' + esc(c.id) + '" data-name="' + esc(c.name) + '" data-color="' + esc(L.color) + '" data-act="pal-hint" title="Auf das Layout ziehen">'
        + (manage ? '<button class="pal-edit" data-act="pal-edit" data-id="' + c.id + '" title="Symbol bearbeiten" draggable="false"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg></button>'
          + '<button class="pal-del" data-act="pal-del" data-id="' + c.id + '" title="Symbol löschen" draggable="false">×</button>' : '')
        + '<div class="sym">' + symInner('custom:' + c.id, 24) + '</div>'
        + '<div class="pal-cap"><span class="pal-nm">' + esc(c.name) + '</span></div></div>').join('');
      const add = manage ? '<div class="pal-item pal-add" data-act="pal-add" title="Eigenes Symbol hochladen"><div class="pal-add-plus">+</div><div class="pal-cap"><span class="pal-nm">Eigenes Symbol</span></div></div>' : '';
      return (tiles || add) ? '<div class="pal-grid pal-custom">' + tiles + add + '</div>' : '';
    };
    let pal;
    if (meta === PROCESS_META) {
      const activeTab = state.palTab || 'a';
      const tabs = PT_COLOR_GROUPS.map((gr) => {
        const n = (meta.palette || []).filter(([name, sym]) => ptColorGroup(sym) === gr.key).length;
        return '<button class="pal-tab' + (gr.key === activeTab ? ' active' : '') + '" data-act="pal-tab" data-ptab="' + gr.key + '">'
          + '<span class="pal-sw' + (gr.key === 's' ? ' ring' : '') + '" style="background:' + gr.swatch + '"></span>' + t(gr.label) + '<span class="pal-gc">' + n + '</span></button>';
      }).join('');
      const panels = PT_COLOR_GROUPS.map((gr) => {
        const items = (meta.palette || []).filter(([name, sym]) => ptColorGroup(sym) === gr.key);
        return '<div class="pal-grid" data-ppanel="' + gr.key + '"' + (gr.key === activeTab ? '' : ' style="display:none"') + '>' + items.map(palItem).join('') + '</div>';
      }).join('');
      pal = '<div class="pal-tabs">' + tabs + '</div>' + panels + customPalHtml();
    } else {
      pal = '<div class="pal-grid">' + (meta.palette || []).map(palItem).join('') + '</div>' + customPalHtml();
    }

    const layerStack = (state.detail.layers || []).slice().reverse().filter((l) => layerAllowed(l.code)).map((l) => {
      const act = l.id === L.id, vis = l.visible !== false;
      const eye = vis
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.2 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.2-1.5"/><path d="M4 4l16 16"/></svg>';
      const lmeta = paletteMetaFor(l);
      return '<div class="layer ' + (act ? 'active' : '') + ' ' + (vis ? '' : 'hidden') + '" style="--lc:' + esc(l.color) + ';--lc-soft:' + esc(lmeta.soft) + '" data-act="layer-select" data-layer="' + l.id + '">'
        + '<div class="lbar"></div><div class="lmeta"><span class="lid">' + esc(l.code) + '</span><span class="lcount" title="Objekte auf dieser Ebene">' + (counts[l.id] || 0) + '</span><span class="lname">' + esc(t(l.name)) + '</span></div>'
        + '<button class="eye ' + (vis ? '' : 'off') + '" data-act="layer-eye" data-layer="' + l.id + '" title="Sichtbarkeit">' + eye + '</button></div>';
    }).join('');

    // Objektliste der aktiven Ebene (flach, ohne Kategorien)
    const objs = objectsOfLayer(L.id);
    const objlist = objs.length ? objRowsHtml(objs) : '<div style="color:var(--muted);font-size:13px;padding:4px 2px">Noch keine Objekte auf dieser Ebene.</div>';

    c.innerHTML = '<div class="editor-wrap"><div class="canvas-col">'
      + '<div class="editor-topbar"><div class="ttl">' + esc((state.detail.anlagenname || '').split(' · ')[0])
      + '<span class="lyr-badge" style="background:' + esc(L.color) + '">' + esc(L.code) + ' ' + esc(t(L.name)) + '</span></div>'
      + '<div style="margin-left:auto;display:flex;align-items:center;gap:10px">'
      + '<div id="collabBar">' + presenceHtml() + '</div>'
      + (canEdit() ? '<button class="up-btn" data-act="editor-upload">' + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg> ' + (state.detail.hasLayout ? t('LAYOUT ERSETZEN') : t('LAYOUT HOCHLADEN')) + '</button>' : '')
      + (canEdit() ? '<div class="up-btn undo-ctl"><button id="btnUndo" data-act="undo" title="Rückgängig (Strg+Z)"' + ((state.undoStack && state.undoStack.length) ? '' : ' disabled') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg></button>'
      + '<button id="btnRedo" data-act="redo" title="Wiederholen (Strg+Umschalt+Z)"' + ((state.redoStack && state.redoStack.length) ? '' : ' disabled') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg></button></div>' : '')
      + '<div class="zoom-ctl"><button data-act="zoom-out" aria-label="' + t('Verkleinern') + '">−</button><span class="z" aria-hidden="true">' + Math.round((state.zoom || 1) * 100) + '%</span><button data-act="zoom-in" aria-label="' + t('Vergrößern') + '">+</button></div>'
      + (canEdit() ? '<button class="up-btn snap-toggle' + (state.snapGrid ? ' on' : '') + '" data-act="toggle-snap" title="' + t('Am Raster ausrichten') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg> ' + t('Raster') + '</button>' : '')
      + '</div></div>'
      + '<div class="canvas-stage" id="stage"><div class="canvas-inner">' + editorFloorplan() + '</div>' + flowLegendHtml()
      + (canEdit() ? '<div class="palette"><div class="pal-head"><span class="pal-dot" style="background:' + esc(L.color) + '"></span><span class="pal-ttl">' + esc(t(L.name)) + '</span><span class="pal-code">' + esc(L.code) + '</span></div>' + pal
        + (((meta.palette || []).some(function (pp) { return pp[1] === 'robot'; }) && state.layoutBlobUrl && window.RobotDetect) ? '<div class="tpl-lib"><button class="tpl-manage' + (state.tplPanel ? ' open' : '') + '" data-act="tpl-panel">' + t('Gelernte Vorlagen') + ': <b>' + posLib().length + '</b>' + (negLib().length ? ' · ' + t('Fehlbeispiele') + ': <b>' + negLib().length + '</b>' : '') + ' ▾</button>' + tplPanelHtml() + '</div>' : '')
        + '</div>' : '')
      + '<div class="sat-ctl"><label>Layout-Sättigung <span id="satVal">' + (state.sat || 100) + '%</span></label><input id="satRange" type="range" min="10" max="100" value="' + (state.sat || 100) + '"></div>'
      + '<div class="exp-ctl">'
      + stationNavHtml()
      + '<button class="btn" data-act="export-pdf"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v11M8 10l4 4 4-4M5 19h14"/></svg> PDF</button>'
      + '<button class="btn" data-act="export-csv"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M9 4v16"/></svg> CSV</button>'
      + (state.isAdmin ? '<button class="btn btn-danger" data-act="layout-reset" title="' + t('Alle Objekte dieser Anlage löschen') + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/></svg> ' + t('Reset') + '</button>' : '')
      + '<button class="btn tree-toggle" data-act="tree-toggle" title="Anlagenstruktur"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg> Struktur</button>'
      + '<button class="btn" data-act="editor-back"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 6l-6 6 6 6"/></svg> ' + t('ZURÜCK') + '</button>'
      + '</div></div></div>'
      + '<aside class="layers"><div class="lp-head"><h2>Ebenen-Stack</h2><p>Sichtbarkeit &amp; aktive Ebene</p></div>'
      + '<div class="layer-stack">' + layerStack + '</div>'
      + (canEdit() ? actionPanelHtml(L) : '')
      + '<div class="objlist"><div class="objlist-head"><h4>' + esc(L.code) + ' ' + esc(t(L.name)) + '</h4>' + (canEdit() && objs.length ? '<button class="cat-del-all" data-act="cat-del-all" data-cat="__all__" title="' + t('Alle Objekte dieser Ebene löschen') + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>' : '') + '<span class="objlist-cnt">' + objs.length + '</span></div>' + objlist + '</div>'
      + '</aside></div>';

    applyZoomSat();
    alignStateLines();
  }

  function actionPanelHtml(L) {
    const isL0 = L && L.name === 'Materialfluss';
    const isFG = L && L.name === 'Funktionsgruppen';
    const isSteuer = L && (L.name === 'Steuerungstechnik' || String(L.code || '').indexOf('L2.0') === 0);
    const isNotHalt = L && L.name === 'Not-Halt';
    const isRobotL = L && L.name === 'Saferobot / Technologie';
    // Zeichen-/Aktions-Werkzeuge nur fuer diese Ebenen. Auf allen anderen kein Werkzeug einblenden.
    if (!isL0 && !isFG && !isSteuer && !isNotHalt && !isRobotL) return '';
    const zoneActive = state.drawShape === 'zone';
    const routeActive = state.drawShape === 'route';
    let btn, hint, extra = '';
    if (isL0) {
      btn = '<button class="btn zone-btn ' + (routeActive ? 'active' : '') + '" data-act="toggle-route" style="width:100%">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h13M13 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg> '
        + (routeActive ? t('ZEICHNEN AKTIV') : t('FÖRDERWEG')) + '</button>';
      // Farbige Materialfluss-Typen zur Auswahl -> bestimmt die Pfeilfarbe des nächsten Förderwegs
      extra = '<div class="flow-pick">' + FLOW_TYPES.map((ft, i) =>
        '<button class="flow-chip ' + (state.flowType === i ? 'active' : '') + '" data-act="flow-type" data-flow="' + i + '" style="--fc:' + esc(ft.color) + '" title="' + esc(ft.name + ' – ' + ft.desc) + '">'
        + '<span class="fc-dot"></span>' + esc(ft.name) + '</button>').join('') + '</div>';
      hint = routeActive
        ? 'Klicken setzt Wegpunkte · Klick auf den letzten Punkt oder <b>Enter</b> beendet · <b>Esc</b> bricht ab. Farbe = gewählter Materialfluss-Typ; Doppelklick öffnet Typ &amp; Förderart.'
        : 'Erst Typ oben wählen (Farbe), dann zeichnen. Wegpunkte danach verschiebbar. Weg anklicken: <b>Entf</b> löscht, <b>R</b> kehrt die Richtung um.';
    } else if (isNotHalt) {
      const nSb = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3).length;
      const nhz = (state.detail.objects || []).filter((o) => o.symbolType === 'nh_zone');
      const nhAuto = nhz.filter((o) => (o.metatags || []).some((m) => m.label === 'SB-Stand')); // automatisch erzeugte Grenzen (mit SB-Stand); manuelle bleiben unberuehrt
      const fpNow = nSb ? sbFingerprint() : '';
      const stale = nhAuto.length && nhAuto.some((o) => { const m = (o.metatags || []).find((x) => x.label === 'SB-Stand'); return m.value !== fpNow; });
      const busy = !!state.nhGenerating;
      const nhActive = state.drawShape === 'nhzone';
      btn = '<button class="btn zone-btn" data-act="gen-nothalt" style="width:100%"' + ((nSb && !busy) ? '' : ' disabled') + '>'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></svg> '
        + (busy ? 'GENERIERE …' : 'NOT-HALT-GRENZE GENERIEREN') + '</button>'
        + '<div style="height:7px"></div>'
        + '<button class="btn zone-btn ' + (nhActive ? 'active' : '') + '" data-act="toggle-nhzone" style="width:100%">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v14H4z" stroke-dasharray="0.5 3" stroke-linecap="round"/></svg> '
        + (nhActive ? t('ZEICHNEN AKTIV') : 'NOT-HALT-GRENZE MANUELL') + '</button>';
      hint = nhActive
        ? 'Klicken setzt Stützpunkte · richtet <b>waagerecht/senkrecht</b> aus · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
        : (!nSb
          ? 'Noch keine Schutzbereiche (SB) vorhanden – zuerst SB einzeichnen und generieren, oder unten die Grenze <b>manuell</b> zeichnen.'
          : (stale ? '<b>Schutzbereiche wurden seit der Generierung geändert</b> – klicken, um die Grenze neu zu generieren.'
            : (nhAuto.length ? 'Grenze ist aktuell (' + nSb + ' SB umschlossen). Erneutes Klicken generiert sie neu.'
              : 'Generiert eine Not-Halt-Grenze als umschließende Umrisslinie aller ' + nSb + ' Schutzbereiche (SB).')));
    } else if (isRobotL) {
      const ready = state.layoutBlobUrl && window.RobotDetect;
      btn = '<button class="btn zone-btn' + (state.robotDetecting ? ' active' : '') + '" data-act="detect-robots" style="width:100%"' + (ready ? '' : ' disabled') + '>'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg> '
        + (state.robotDetecting ? t('Erkenne …') : t('Roboter erkennen')) + '</button>';
      hint = ready
        ? 'Findet Roboter im Layout automatisch und legt sie als Objekte an. Danach je Roboter „Safe Funktion" und „Technologie" setzen (Pflicht).'
        : 'Erkennung benötigt ein hinterlegtes Layout-Bild.';
    } else {
      const spsActive = state.drawShape === 'spszone';
      const zsvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4z" stroke-dasharray="3 2.5"/></svg> ';
      const zbtn = (a, on, label) => '<button class="btn zone-btn ' + (on ? 'active' : '') + '" data-act="' + a + '" style="width:100%">' + zsvg + label + '</button>';
      if (isSteuer) {
        // SPS-Bereich (1:1 zu einer SPS) ueber dem Schutzbereich-Button
        btn = zbtn('toggle-spszone', spsActive, spsActive ? 'ZEICHNEN AKTIV' : 'SPS BEREICH')
          + '<div style="height:7px"></div>'
          + zbtn('toggle-zone', zoneActive, zoneActive ? 'ZEICHNEN AKTIV' : 'SB SCHUTZBEREICH');
        hint = (spsActive || zoneActive)
          ? 'Klicken setzt Stützpunkte · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
          : '<b>SPS-Bereich:</b> genau eine SPS je Bereich (1:1) – nach dem Zeichnen SPS wählen. <b>Schutzbereich:</b> optionale SPS-Zuordnung.';
      } else {
        const kind = zoneKind(layerById(state.activeLayer));
        btn = zbtn('toggle-zone', zoneActive, zoneActive ? 'ZEICHNEN AKTIV' : kind.label);
        hint = zoneActive
          ? 'Klicken setzt Stützpunkte · Klick auf den Startpunkt oder <b>Enter</b> schließt · <b>Esc</b> bricht ab'
          : 'Polygon zeichnen; Stützpunkte danach verschiebbar. ' + kind.noun + ' anklicken &amp; <b>Entf</b> löscht ihn.';
      }
    }
    return '<div class="lp-action">' + btn + extra + '<div class="zone-hint">' + hint + '</div></div>';
  }

  // Objektzeile in der Objektliste sichtbar scrollen (nach Auswahl im Layout).
  function focusObjInList(id) {
    const row = document.querySelector('.objlist .obj[data-obj="' + id + '"]');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // Umgekehrt: Auswahl in der Objektliste -> Objekt im Layout selektieren und mit einem kurzen Puls hervorheben. Gilt fuer Icons, Polygone und Foerderstrecken.
  function focusObjInLayout(id) {
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === id);
    if (!o) return;
    if (o.layerId && layerById(o.layerId) && state.activeLayer !== o.layerId) state.activeLayer = o.layerId;
    if (isShape(o)) { state.selectedZone = id; state.selectedObj = null; }
    else { state.selectedObj = id; state.selectedZone = null; }
    renderEditor();
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    let cx, cy;
    if (isShape(o) && o.points && o.points.length) { cx = o.points.reduce((s, p) => s + p.x, 0) / o.points.length; cy = o.points.reduce((s, p) => s + p.y, 0) / o.points.length; }
    else { cx = o.x; cy = o.y; }
    if (cx == null || cy == null) return;
    const ring = document.createElement('div');
    ring.className = 'focus-ring';
    ring.style.left = (cx * 100) + '%'; ring.style.top = (cy * 100) + '%';
    doc.appendChild(ring);
    setTimeout(() => { ring.remove(); }, 1300);
  }
  function objRowsHtml(list) {
    const tools = canEdit();
    const rows = list.map((o, i) => '<div class="obj' + ((o.id === state.selectedObj || o.id === state.selectedZone) ? ' sel' : '') + '" data-act="obj-focus" data-obj="' + esc(o.id) + '"><span class="onum">' + (i + 1) + '</span><span class="odot" style="background:' + esc(isShape(o) ? zoneColor(o) : o.color) + '"></span>' + (o.id === state.editingObjId ? '<input class="oname-edit" data-oedit="' + esc(o.id) + '" value="' + esc(o.name) + '">' : '<span class="oname"' + (tools ? ' data-act="obj-name" data-obj="' + esc(o.id) + '" title="Doppelklick zum Umbenennen"' : '') + '>' + esc(o.name) + '</span>')
      + (tools ? ('<div class="obj-tools">'
      + '<button data-act="obj-edit" data-obj="' + o.id + '" title="Metatags"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12l8-8h6v6l-8 8z"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/></svg></button>'
      + '<button class="del" data-act="obj-del" data-obj="' + o.id + '" title="Löschen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>'
      + '</div>') : '') + '</div>').join('');
    return rows;
  }

  function applyZoomSat() { const doc = document.getElementById('canvasDoc'); if (doc) doc.style.transform = 'translate3d(' + (state.panX || 0) + 'px,' + (state.panY || 0) + 'px,0) scale(' + (state.zoom || 1) + ')'; }
  // Mitte des Icon-Symbols (.p-sym) eines Objekts als Bruchteil der Zeichenflaeche (zoom-invariant, da Symbol und Linien-SVG gemeinsam skalieren).
  function symFrac(oid) {
    const doc = document.getElementById('canvasDoc');
    const sym = document.querySelector('.placed[data-obj="' + oid + '"] .p-sym');
    if (!doc || !sym) return null;
    const dr = doc.getBoundingClientRect(), sr = sym.getBoundingClientRect();
    if (!dr.width || !dr.height) return null;
    return { x: (sr.left + sr.width / 2 - dr.left) / dr.width, y: (sr.top + sr.height / 2 - dr.top) / dr.height };
  }
  // Prozesstyp-Ende der Zustands-Verbindungslinien auf die Icon-Mitte legen (statt Spalten-Anker o.x/o.y).
  function alignStateLines() {
    document.querySelectorAll('.state-link-svg line[data-sline]').forEach((ln) => {
      const oid = (ln.getAttribute('data-sline') || '').split('__')[0];
      const f = symFrac(oid);
      if (f) { ln.setAttribute('x1', (f.x * 100).toFixed(3)); ln.setAttribute('y1', (f.y * 100).toFixed(3)); }
    });
  }
  function zoomStep(d) { state.zoom = Math.min(2.2, Math.max(0.5, (state.zoom || 1) + d)); applyZoomSat(); const z = document.querySelector('.zoom-ctl .z'); if (z) z.textContent = Math.round(state.zoom * 100) + '%'; }
  function onWheelZoom(e) {
    if (state.view !== 'editor') return;
    const stage = e.target.closest && e.target.closest('.canvas-stage');
    if (!stage) return;
    e.preventDefault();
    const d = Math.max(-0.2, Math.min(0.2, -e.deltaY * 0.0016));
    if (d) zoomStep(d);
  }
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

  // ===== Roboter-Erkennung (Vorschlag + Bestätigung) =====
  function loadLayoutGray() {
    return new Promise(function (resolve, reject) {
      if (!state.layoutBlobUrl) { reject(new Error('kein Layout')); return; }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, maxW = 900;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
        var d = cx.getImageData(0, 0, w, h);
        resolve(RobotDetect.grayFromRGBA(d.data, w, h));
      };
      img.onerror = reject; img.src = state.layoutBlobUrl;
    });
  }
  // --- Vorlagen-Bibliothek (browser-lokal): aus bestätigten/gesetzten Robotern lernen ---
  function tplLibKey() { return 'promodx_robot_templates'; }
  function loadTplLib() { try { return JSON.parse(localStorage.getItem(tplLibKey()) || '[]'); } catch (e) { return []; } }
  function saveTplLib(arr) { try { localStorage.setItem(tplLibKey(), JSON.stringify(arr)); } catch (e) { /* Speicher voll */ } }
  function urlToGray(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        var d = cx.getImageData(0, 0, cv.width, cv.height);
        resolve(RobotDetect.grayFromRGBA(d.data, cv.width, cv.height));
      };
      img.onerror = reject; img.src = url;
    });
  }
  function posLib() { return loadTplLib().filter(function (e) { return !e.neg; }); }
  function negLib() { return loadTplLib().filter(function (e) { return e.neg; }); }
  function delTplEntry(id) { saveTplLib(loadTplLib().filter(function (e) { return e.id !== id; })); }
  function loadPosNegGray() {
    var lib = loadTplLib();
    var posUrls = ['img/robot-template.png?v=0.25.52'].concat(lib.filter(function (e) { return !e.neg; }).map(function (e) { return e.url; }));
    var negUrls = lib.filter(function (e) { return e.neg; }).map(function (e) { return e.url; });
    function decode(urls) { return Promise.all(urls.map(function (u) { return urlToGray(u).catch(function () { return null; }); })).then(function (a) { return a.filter(Boolean); }); }
    // Fast identische Vorlagen nur einmal rechnen (NCC-Aehnlichkeit auf 132px) – spart ganze Erkennungslaeufe.
    function dedupe(list) {
      var out = [], small = [];
      for (var i = 0; i < list.length; i++) {
        var g = RobotDetect.resizeGray(list[i], 132, 132), dup = false;
        for (var k = 0; k < small.length; k++) { if (RobotDetect.similarity(small[k], g) >= 0.93) { dup = true; break; } }
        if (!dup) { small.push(g); out.push(list[i]); }
      }
      return out;
    }
    return Promise.all([decode(posUrls), decode(negUrls)]).then(function (a) { return { pos: dedupe(a[0]), neg: dedupe(a[1]) }; });
  }
  // Höchste Ähnlichkeit eines neuen 132er-Graubilds zu den angegebenen Vorlagen-URLs (für Dedupe/Vergiftungsschutz).
  function maxSimilarityTo(newGray, urls) {
    if (!urls.length) return Promise.resolve(0);
    return Promise.all(urls.map(function (u) {
      return urlToGray(u).then(function (g) { return RobotDetect.similarity(RobotDetect.resizeGray(g, 132, 132), newGray); }).catch(function () { return 0; });
    })).then(function (sc) { return sc.length ? Math.max.apply(null, sc) : 0; });
  }
  function captureRobotTemplate(nx, ny) {
    return new Promise(function (resolve, reject) {
      if (!state.layoutBlobUrl) { reject(); return; }
      var img = new Image();
      img.onload = function () {
        var W = img.naturalWidth, H = img.naturalHeight;
        var side = Math.max(24, Math.round(0.161 * W));
        var cx = Math.round(nx * W), cy = Math.round(ny * H);
        var x0 = Math.max(0, Math.min(W - side, cx - Math.round(side / 2)));
        var y0 = Math.max(0, Math.min(H - side, cy - Math.round(side / 2)));
        var out = document.createElement('canvas'); out.width = 132; out.height = 132;
        var o = out.getContext('2d'); o.drawImage(img, x0, y0, side, side, 0, 0, 132, 132);
        var d = o.getImageData(0, 0, 132, 132);
        for (var i = 0; i < d.data.length; i += 4) { var g = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]; d.data[i] = d.data[i + 1] = d.data[i + 2] = g; }
        o.putImageData(d, 0, 0);
        resolve(out.toDataURL('image/png'));
      };
      img.onerror = reject; img.src = state.layoutBlobUrl;
    });
  }
  function promptLearnTemplate(nx, ny) {
    if (!state.layoutBlobUrl || !window.RobotDetect) return;
    captureRobotTemplate(nx, ny).then(function (url) {
      state.learnPrompt = { url: url };
      renderEditor();
    }).catch(function () { /* kein Layout */ });
  }
  function learnPromptLayer() {
    var lp = state.learnPrompt;
    if (!lp) return '';
    return '<div class="learn-prompt">'
      + '<img class="lp-thumb" src="' + lp.url + '" alt="">'
      + '<div class="lp-body"><div class="lp-txt">' + t('Diesen Ausschnitt als Roboter-Vorlage lernen?') + '</div>'
      + '<div class="lp-btns"><button class="lp-yes" data-act="tpl-learn-yes">' + t('Als Vorlage lernen') + '</button>'
      + '<button class="lp-no" data-act="tpl-learn-no">' + t('Nein') + '</button></div></div></div>';
  }
  function confirmLearnPrompt() {
    var lp = state.learnPrompt; if (!lp) return;
    state.learnPrompt = null;
    urlToGray(lp.url).then(function (ng) {
      return maxSimilarityTo(ng, posLib().map(function (e) { return e.url; }));
    }).then(function (sim) {
      if (sim > 0.92) { toast(t('Ähnliche Vorlage bereits vorhanden – übersprungen.')); renderEditor(); return; }
      var lib = loadTplLib();
      lib.push({ id: 'tpl_' + Date.now(), url: lp.url, neg: false });
      if (lib.length > 24) lib = lib.slice(lib.length - 24);
      saveTplLib(lib);
      toast(t('Als Vorlage gelernt') + ' (' + posLib().length + ')');
      renderEditor();
    }).catch(function () { renderEditor(); });
  }
  function dismissLearnPrompt() { state.learnPrompt = null; renderEditor(); }
  function tplPanelHtml() {
    if (!state.tplPanel) return '';
    var pos = posLib(), neg = negLib();
    var thumbs = pos.length ? pos.map(function (e) {
      return '<div class="tp-item"><img src="' + e.url + '" alt=""><button class="tp-del" data-act="tpl-del" data-id="' + e.id + '" title="' + t('Löschen') + '">×</button></div>';
    }).join('') : '<div class="tp-empty">' + t('Noch keine gelernten Vorlagen.') + '</div>';
    return '<div class="tpl-panel">'
      + '<div class="tp-head">' + t('Positive Vorlagen') + ' (' + pos.length + ')</div>'
      + '<div class="tp-grid">' + thumbs + '</div>'
      + (neg.length ? '<div class="tp-neg">' + t('Fehlbeispiele') + ': ' + neg.length + ' · <button class="tpl-linkbtn" data-act="neg-reset">' + t('zurücksetzen') + '</button></div>' : '')
      + ((pos.length || neg.length) ? '<div class="tp-foot"><button class="tpl-linkbtn" data-act="tpl-reset">' + t('Alle zurücksetzen') + '</button></div>' : '')
      + '</div>';
  }
  // Aus einer Ablehnung lernen: Region als Fehlbeispiel (Negativ) merken – aber nicht, wenn sie einem bekannten Roboter ähnelt.
  function learnNegativeTemplate(nx, ny) {
    if (!state.layoutBlobUrl || !window.RobotDetect) return;
    captureRobotTemplate(nx, ny).then(function (url) {
      return urlToGray(url).then(function (ng) {
        return maxSimilarityTo(ng, posLib().map(function (e) { return e.url; }).concat(['img/robot-template.png?v=0.25.52'])).then(function (simPos) {
          if (simPos > 0.9) return; // ähnelt echtem Roboter -> nicht als Fehlbeispiel merken
          return maxSimilarityTo(ng, negLib().map(function (e) { return e.url; })).then(function (simNeg) {
            if (simNeg > 0.92) return; // schon ähnliches Fehlbeispiel vorhanden
            var lib = loadTplLib();
            lib.push({ id: 'neg_' + Date.now(), url: url, neg: true });
            if (lib.length > 24) lib = lib.slice(lib.length - 24);
            saveTplLib(lib);
            toast(t('Als Fehlbeispiel gemerkt') + ' (' + negLib().length + ')');
          });
        });
      });
    }).catch(function () { /* egal */ });
  }

  // Roboter-Erkennung im Web Worker ausfuehren (Hauptthread bleibt frei -> kein "Seite reagiert nicht").
  // Faellt bei fehlendem/fehlgeschlagenem Worker sauber auf synchrone Ausfuehrung zurueck.
  function runRobotDetect(layout, templates, opts) {
    return new Promise(function (resolve, reject) {
      function syncFallback() { setTimeout(function () { try { resolve((RobotDetect.detectMultiFast || RobotDetect.detectMulti)(layout, templates, opts)); } catch (e) { reject(e); } }, 30); }
      if (typeof Worker === 'undefined') { syncFallback(); return; }
      var w, done = false, dog = 0;
      try { w = new Worker('js/robotworker.js?v=1.2.38'); } catch (e) { syncFallback(); return; }
      // Watchdog: antwortet der Worker nicht (Haenger), sauber abbrechen statt fuer immer "gruen" zu bleiben.
      dog = setTimeout(function () {
        if (done) return; done = true;
        try { w.terminate(); } catch (_) { /* noop */ }
        reject(new Error('Zeitueberschreitung bei der Erkennung'));
      }, 60000);
      w.onmessage = function (ev) {
        if (done) return; done = true; clearTimeout(dog);
        var r = ev.data || {};
        try { w.terminate(); } catch (_) { /* noop */ }
        if (r.ok) resolve(r.found || []);
        else { try { resolve((RobotDetect.detectMultiFast || RobotDetect.detectMulti)(layout, templates, opts)); } catch (e2) { reject(e2); } }
      };
      w.onerror = function () {
        if (done) return; done = true; clearTimeout(dog);
        try { w.terminate(); } catch (_) { /* noop */ }
        try { resolve((RobotDetect.detectMultiFast || RobotDetect.detectMulti)(layout, templates, opts)); } catch (e2) { reject(e2); }
      };
      try { w.postMessage({ layout: layout, templates: templates, opts: opts }); }
      catch (e) { done = true; clearTimeout(dog); try { w.terminate(); } catch (_) { /* noop */ } syncFallback(); }
    });
  }
  function detectRobotsFlow() {
    if (!window.RobotDetect || !state.layoutBlobUrl) { toast(t('Kein Layout vorhanden.')); return; }
    if (state.robotDetecting) return;
    state.robotDetecting = true; toast(t('Erkenne Roboter …'));
    try { var _rb = document.querySelector('.zone-btn[data-act="detect-robots"]'); if (_rb) _rb.classList.add('active'); } catch (_) { /* noop */ }
    Promise.all([loadPosNegGray(), loadLayoutGray()]).then(function (arr) {
      var lib = arr[0], lay = arr[1];
      var opts = { workW: lib.pos.length > 1 ? 260 : 300, threshold: 0.55, combine: true, negatives: lib.neg };
      if (lib.pos.length > 3) opts.scales = [0.8, 1.0, 1.2];
      return runRobotDetect(lay, lib.pos, opts);
    }).then(function (found) {
      var existing = (state.detail.objects || []).filter(function (o) { return o.symbolType === 'robot'; });
      var sugg = found.filter(function (f) { return !existing.some(function (o) { return Math.hypot(o.x - f.x, o.y - f.y) < 0.05; }); });
      state.robotSuggestions = sugg; state.robotDetecting = false; renderEditor();
      toast(sugg.length ? (sugg.length + ' ' + t('Roboter erkannt – bitte bestätigen')) : t('Keine (neuen) Roboter erkannt.'));
    }).catch(function () { state.robotDetecting = false; renderEditor(); toast(t('Erkennung fehlgeschlagen.')); });
  }
  function robotSuggestionLayer() {
    var s = state.robotSuggestions || [];
    if (!s.length) return '';
    return '<div class="robot-sugg-layer">' + s.map(function (r, i) {
      return '<div class="robot-sugg" style="left:' + (r.x * 100) + '%;top:' + (r.y * 100) + '%">'
        + '<div class="rs-ic">' + symInner('robot', 22) + '</div>'
        + '<div class="rs-bar"><span class="rs-score" title="' + t('Konfidenz') + '">' + Math.round(r.score * 100) + '%</span>'
        + '<button class="rs-yes" data-act="rob-confirm" data-idx="' + i + '" title="' + t('Übernehmen') + '">✓</button>'
        + '<button class="rs-no" data-act="rob-dismiss" data-idx="' + i + '" title="' + t('Verwerfen') + '">×</button></div>'
        + '</div>';
    }).join('') + '<button class="rs-clear" data-act="rob-dismiss-all">' + t('Alle verwerfen') + '</button></div>';
  }
  function confirmRobotSuggestion(idx) {
    var s = state.robotSuggestions || []; var r = s[idx]; if (!r) return;
    var L = (state.detail.layers || []).find(function (l) { return l.name === 'Saferobot / Technologie'; });
    if (!L) { toast(t('Roboter-Ebene fehlt.')); return; }
    pushUndo();
    var num = String((state.detail.objects || []).filter(function (o) { return o.symbolType === 'robot'; }).length + 1).padStart(2, '0');
    Api.createObject(state.detail.id, { layerId: L.id, name: 'Roboter_' + num, symbolType: 'robot', color: L.color, x: r.x, y: r.y }).then(function (obj) {
      obj.metatags = obj.metatags || [];
      state.detail.objects.push(obj);
      state.robotSuggestions.splice(idx, 1);
      renderEditor();
    }).catch(function () { toast(t('Speichern fehlgeschlagen.')); });
  }
  function dismissRobotSuggestion(idx) {
    if (!state.robotSuggestions) return;
    var r = state.robotSuggestions[idx];
    if (r && state.layoutBlobUrl) learnNegativeTemplate(r.x, r.y);
    state.robotSuggestions.splice(idx, 1); renderEditor();
  }

  // ===== Kommentare (positionierte Chat-Fenster, Rechtsklick zum Anlegen) =====
  function commentsKey() { return 'promodx_comments_' + (state.detail && state.detail.id); }
  function ensureComments() {
    var sid = state.detail && state.detail.id;
    if (state.commentsStation === sid) return;
    state.commentsStation = sid;
    // Sofortiger lokaler Uebergangsstand (kein Flackern), dann Server drueber.
    try { state.comments = JSON.parse(localStorage.getItem(commentsKey()) || '[]'); } catch (e) { state.comments = []; }
    state.commentsServer = false;
    loadComments(sid);
  }
  async function loadComments(sid) {
    try {
      var list = await Api.getComments(sid);
      if (state.commentsStation !== sid) return;
      state.comments = Array.isArray(list) ? list : [];
      state.commentsServer = true;
      state.commentsSig = commentsSig(state.comments);
      renderEditor();
    } catch (e) { state.commentsServer = false; /* Backend (noch) nicht da -> lokaler Fallback bleibt aktiv */ }
  }
  const commentsSig = window.PMX.commentsSig;
  // Kommentare aus dem Poll uebernehmen, ohne die offene Eingabe/den Fokus zu verlieren.
  function applyCommentsUpdate(list) {
    var winMap = {}; (state.comments || []).forEach(function (c) { if (c.winX != null) winMap[c.id] = { winX: c.winX, winY: c.winY }; });
    state.comments = (list || []).map(function (c) { var w = winMap[c.id]; return w ? Object.assign({}, c, w) : c; });
    var inp = $('cwText'); var pending = inp ? inp.value : null; var hadFocus = inp && document.activeElement === inp;
    renderEditor();
    if (pending != null) { var ni = $('cwText'); if (ni) { ni.value = pending; if (hadFocus) ni.focus(); } var b = $('cwBody'); if (b) b.scrollTop = b.scrollHeight; }
  }
  function saveComments() { try { localStorage.setItem(commentsKey(), JSON.stringify(state.comments || [])); } catch (e) { /* voll */ } }
  function fmtCommentTime(ts) {
    try { return new Date(ts).toLocaleString(state.lang === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  async function createCommentAt(x, y) {
    ensureComments();
    if (state.commentsServer) {
      try {
        var sc = await Api.createComment(state.detail.id, { x: x, y: y, layerId: state.activeLayer || null });
        state.comments.push(sc); state.commentsSig = commentsSig(state.comments);
        state.openComment = sc.id; renderEditor();
        setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30);
      } catch (e) { toast(t('Speichern fehlgeschlagen.')); }
      return;
    }
    var c = { id: 'cm_' + Date.now(), x: x, y: y, messages: [], created: Date.now() };
    state.comments.push(c); saveComments();
    state.openComment = c.id; renderEditor();
    setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30);
  }
  function commentPinLayer() {
    ensureComments();
    var cs = state.comments || [];
    if (!cs.length) return '';
    return '<div class="comment-pin-layer">' + cs.map(function (c) {
      var n = (c.messages || []).length;
      return '<div class="comment-pin' + (c.id === state.openComment ? ' active' : '') + '" style="left:' + (c.x * 100) + '%;top:' + (c.y * 100) + '%" ' + (canEdit() ? '' : 'data-act="comment-open" ') + 'data-id="' + c.id + '" title="' + t('Kommentar (ziehen zum Verschieben)') + '">'
        + '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>'
        + (n ? '<span class="cp-badge">' + n + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function commentWindowLayer() {
    var c = (state.comments || []).find(function (x) { return x.id === state.openComment; });
    if (!c) return '';
    var left = c.winX != null ? Math.max(0, Math.min(96, c.winX * 100)) : Math.max(2, Math.min(60, c.x * 100));
    var top = c.winY != null ? Math.max(0, Math.min(92, c.winY * 100)) : Math.max(2, Math.min(48, c.y * 100));
    var me = (state.user && state.user.email) || '';
    var msgs = (c.messages || []).map(function (m) {
      var own = m.author === me;
      return '<div class="cm-msg' + (own ? ' own' : '') + '"><div class="cm-meta">' + esc(m.author || '') + ' · ' + fmtCommentTime(m.ts) + '</div><div class="cm-bubble">' + esc(m.text) + '</div></div>';
    }).join('') || '<div class="cm-empty">' + t('Noch keine Nachrichten – schreib den ersten Kommentar.') + '</div>';
    return '<div class="comment-window" style="left:' + left + '%;top:' + top + '%">'
      + '<div class="cw-head"><span class="cw-ttl">' + t('Kommentar') + '</span>'
      + '<button class="cw-del" data-act="comment-delete" data-id="' + c.id + '" title="' + t('Löschen') + '">🗑</button>'
      + '<button class="cw-x" data-act="comment-close" title="' + t('Schließen') + '">×</button></div>'
      + '<div class="cw-body" id="cwBody">' + msgs + '</div>'
      + '<div class="cw-input"><input id="cwText" type="text" placeholder="' + t('Nachricht …') + '" autocomplete="off" maxlength="1000">'
      + '<button class="cw-send" data-act="comment-send" data-id="' + c.id + '" title="' + t('Senden') + '">➤</button></div>'
      + '</div>';
  }
  async function sendCommentMsg() {
    var inp = $('cwText'); if (!inp) return;
    var text = inp.value.trim(); if (!text) return;
    var c = (state.comments || []).find(function (x) { return x.id === state.openComment; }); if (!c) return;
    if (state.commentsServer) {
      inp.value = '';
      try {
        var upd = await Api.addCommentMessage(c.id, text);
        var idx = state.comments.findIndex(function (x) { return x.id === c.id; });
        if (idx >= 0) { if (c.winX != null) { upd.winX = c.winX; upd.winY = c.winY; } state.comments[idx] = upd; }
        state.commentsSig = commentsSig(state.comments); renderEditor();
        setTimeout(function () { var b = $('cwBody'); if (b) b.scrollTop = b.scrollHeight; var i = $('cwText'); if (i) i.focus(); }, 20);
      } catch (e) { toast(t('Speichern fehlgeschlagen.')); inp.value = text; }
      return;
    }
    c.messages.push({ author: (state.user && state.user.email) || 'Ich', ts: Date.now(), text: text });
    saveComments(); renderEditor();
    setTimeout(function () { var b = $('cwBody'); if (b) b.scrollTop = b.scrollHeight; var i = $('cwText'); if (i) i.focus(); }, 20);
  }
  function closeCommentWindow() {
    var c = (state.comments || []).find(function (x) { return x.id === state.openComment; });
    state.openComment = null;
    if (c && (!c.messages || !c.messages.length)) {
      if (state.commentsServer) { Api.deleteComment(c.id).catch(function () { toast(t('Kommentar konnte nicht gelöscht werden')); }); }
      state.comments = state.comments.filter(function (x) { return x.id !== c.id; });
      if (!state.commentsServer) saveComments();
    }
    renderEditor();
  }
  async function deleteComment(id) {
    if (state.commentsServer) {
      try { await Api.deleteComment(id); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    }
    state.comments = (state.comments || []).filter(function (x) { return x.id !== id; });
    if (!state.commentsServer) saveComments();
    if (state.openComment === id) state.openComment = null; renderEditor();
  }

  // Platzieren zeigt das Symbol SOFORT an (optimistisch) und laesst den Server im Hintergrund
  // nachziehen. Vorher erschien es erst nach der Anlege-Antwort - bei Prozesstypen sogar erst
  // nach einem zweiten Aufruf fuer die Metadaten, was sich wie eine lange Verzoegerung anfuehlte.
  // Weil das Objekt sofort im Zustand steht, sieht auch der naechste Undo-Punkt es bereits -
  // die frueher noetige Serialisierung entfaellt, schnelles Platzieren ist wieder fluessig.
  async function placeFromDrop(clientX, clientY, sym, name, color) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    let x = Math.min(0.97, Math.max(0.03, (clientX - r.left) / r.width));
    let y = Math.min(0.96, Math.max(0.04, (clientY - r.top) / r.height));
    if (state.snapGrid) { x = Math.min(0.97, Math.max(0.03, snapToGrid(x))); y = Math.min(0.96, Math.max(0.04, snapToGrid(y))); }
    const L = layerById(state.activeLayer);
    const base = (name || 'Objekt').replace(/\s+/g, '_');
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === sym).length + 1).padStart(2, '0');
    const tmpId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const local = {
      id: tmpId, layerId: L.id, categoryId: null, name: base + '_' + num, symbolType: sym,
      color: color || L.color, x, y, rotation: 0, scale: 1, visible: true, points: null,
      plcConfigId: null, metatags: [],
    };
    pushUndo();
    state.detail.objects.push(local);
    protectObj(tmpId); // schuetzt das noch unbestaetigte Objekt vor dem Abgleich
    renderEditor();
    const finishPending = trackPendingOp(); // Undo/Redo wartet, bis das Anlegen durch ist
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: local.name, symbolType: sym, color: local.color, x, y });
      obj.metatags = obj.metatags || [];
      remapId(tmpId, obj.id); protectObj(obj.id); // vorlaeufige ID ueberall durch die echte ersetzen
      let cur = (state.detail.objects || []).find((o) => o.id === obj.id);
      // Dauerte das Anlegen laenger als der Schutz (6 s), hat der Abgleich das vorlaeufige
      // Objekt inzwischen weggeraeumt - dann den bestaetigten Stand wieder aufnehmen.
      if (!cur) { cur = Object.assign({}, obj); state.detail.objects.push(cur); }
      else Object.assign(cur, obj);
      const pt = processTypeByName(name);
      if (pt) {
        try {
          const fg = detectFgName(x, y);
          const tags = [
            { position: 0, label: 'Funktionsgruppen', value: fg },
            { position: 1, label: 'Prozesstyp', value: pt.ptyp },
            { position: 2, label: 'Hardware · Art', value: pt.hwart },
          ];
          let pos = 3;
          ptStateList(pt).forEach((s) => { tags.push({ position: pos++, label: s.kind + ' – ' + s.name, value: '' }); });
          const upd = await Api.setMetatags(obj.id, tags);
          if (cur) cur.metatags = (upd && upd.metatags) || tags;
          if (fg) toast(name + ' → Funktionsgruppe „' + fg + '" zugeordnet');
          else toast(name + ' ' + t('platziert'));
        } catch (e2) { toast(name + ' ' + t('platziert')); }
      } else if (/^custom:/.test(sym)) {
        const tags = symFields(sym).map((f, i) => ({ position: i + 1, label: f.label, value: '' }));
        try { const upd = await Api.setMetatags(obj.id, tags); if (cur) cur.metatags = (upd && upd.metatags) || tags; } catch (e2) { if (cur) cur.metatags = tags; }
        toast(name + ' ' + t('platziert'));
      } else { toast(name + ' ' + t('platziert')); }
      if (sym === 'robot' && state.layoutBlobUrl) promptLearnTemplate(x, y);
      renderEditor();
    } catch (e) {
      // Anlegen fehlgeschlagen -> vorlaeufiges Objekt wieder entfernen
      state.detail.objects = (state.detail.objects || []).filter((o) => o.id !== tmpId);
      renderEditor();
      toast('Platzieren fehlgeschlagen: ' + e.message);
    } finally { finishPending(); }
  }

  let dragMove = null;
  function startMove(e, oid) {
    if (e.button !== undefined && e.button !== 0) return;
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    // Element per Objekt-ID holen (render-fest: falls direkt vor dem Greifen neu gerendert wurde, ist e.target evtl. veraltet).
    let el = null; try { el = doc.querySelector('.placed[data-obj="' + (window.CSS && CSS.escape ? CSS.escape(oid) : oid) + '"]'); } catch (_) { el = null; }
    if (!el) el = e.target.closest('.placed');
    if (!el) return;
    state._preDrag = snapObjects();
    dragMove = { oid, el, doc, sx: e.clientX, sy: e.clientY, moved: false, nx: null, ny: null };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  function onIconDrag(e) {
    const doc = document.getElementById('canvasDoc'); if (!doc) return;
    const r = doc.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
    state.iconDrag.moved = true; state.iconDrag.nx = x; state.iconDrag.ny = y;
    if (state.iconDrag.el) { state.iconDrag.el.style.left = (x * 100) + '%'; state.iconDrag.el.style.top = (y * 100) + '%'; }
    const ln = document.querySelector('[data-sline="' + (window.CSS && CSS.escape ? CSS.escape(state.iconDrag.oid + '__' + state.iconDrag.st) : (state.iconDrag.oid + '__' + state.iconDrag.st)) + '"]');
    if (ln) { ln.setAttribute('x2', x * 100); ln.setAttribute('y2', y * 100); }
  }
  async function endIconDrag() {
    const id = state.iconDrag; state.iconDrag = null;
    if (!id || !id.moved || id.nx == null) return;
    const o = (state.detail.objects || []).find((x) => x.id === id.oid); if (!o) return;
    if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; }
    const map = iconPosMap(o); map[id.st] = { x: id.nx, y: id.ny };
    const metatags = (o.metatags || []).filter((m) => m.label !== 'Icon-Positionen')
      .concat([{ position: 90, label: 'Icon-Positionen', value: JSON.stringify(map) }]);
    protectObj(o.id);
    try { const upd = await Api.setMetatags(o.id, metatags); o.metatags = (upd && upd.metatags) || metatags; } catch (e) { toast('Icon-Position nicht gespeichert'); }
  }
  // Hover-Tooltip: beim Ueberfahren einer Zone Name (+ SPS bei FG/SB) anzeigen.
  let _hoverZoneId = null;
  function setZoneHoverClass(id, on, isRoute) {
    if (id == null) return;
    const p = document.getElementById('zone-poly-' + id);
    if (p) p.classList.toggle('zone-hover', on && !isRoute); // Routen bekommen kein Hover-Highlight
  }
  function updateZoneHoverTitle(e) {
    const doc = document.getElementById('canvasDoc');
    if (!doc) return;
    if (state.drawZone) { if (doc.style.cursor) doc.style.cursor = ''; if (_hoverZoneId !== null) { setZoneHoverClass(_hoverZoneId, false); _hoverZoneId = null; } return; } // Zeichen-Modus: .drawing-Klasse (crosshair) greifen lassen
    const r = doc.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      if (_hoverZoneId !== null) { setZoneHoverClass(_hoverZoneId, false); _hoverZoneId = null; doc.removeAttribute('title'); doc.style.cursor = ''; }
      return;
    }
    const z = zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    const id = z ? z.id : null;
    if (id === _hoverZoneId) return;
    if (_hoverZoneId !== null) setZoneHoverClass(_hoverZoneId, false);
    _hoverZoneId = id;
    setZoneHoverClass(id, true, z && z.symbolType === 'mf_route');
    doc.style.cursor = z ? 'move' : ''; // über einer Zone/Route: Verschiebe-Cursor; sonst Canvas-Standard (grab)
    if (z && (z.symbolType === 'fg_zone' || z.symbolType === 'sb_zone')) {
      const sps = plcNameOf(z);
      doc.title = z.name + (sps ? ' — SPS: ' + sps : '');
    } else if (z && z.symbolType === 'sps_zone') {
      doc.title = spsZoneLabel(z);
    } else { doc.removeAttribute('title'); }
  }

  function onCwDrag(e) {
    var win = document.querySelector('.comment-window'); var d = state.cwDrag; if (!win || !d) return;
    var wr = win.getBoundingClientRect();
    var wpct = wr.width / d.docW * 100, hpct = wr.height / d.docH * 100;
    var leftPct = (e.clientX - d.offx - d.docL) / d.docW * 100;
    var topPct = (e.clientY - d.offy - d.docT) / d.docH * 100;
    leftPct = Math.max(0, Math.min(100 - wpct, leftPct));
    topPct = Math.max(0, Math.min(100 - hpct, topPct));
    win.style.left = leftPct + '%'; win.style.top = topPct + '%';
    d.leftPct = leftPct; d.topPct = topPct;
  }
  function onPinDrag(e) {
    var d = state.pinDrag; if (!d) return;
    if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    var x = Math.max(0, Math.min(1, (e.clientX - d.docL) / d.docW));
    var y = Math.max(0, Math.min(1, (e.clientY - d.docT) / d.docH));
    d.x = x; d.y = y;
    if (d.moved) { var pin = document.querySelector('.comment-pin[data-id="' + d.id + '"]'); if (pin) { pin.style.left = x * 100 + '%'; pin.style.top = y * 100 + '%'; } }
  }
  // Ganze Zeichenfläche verschieben (Pan): rAF-gebündeltes translate3d auf #canvasDoc (GPU-Layer), sanft begrenzt.
  function applyPanFrame() {
    const d = state.panDrag; if (!d) return; d.raf = 0;
    d.doc.style.transform = 'translate3d(' + (state.panX || 0) + 'px,' + (state.panY || 0) + 'px,0) scale(' + d.z + ')';
  }
  function onPanDrag(e) {
    const d = state.panDrag;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    let nx = d.px0 + dx, ny = d.py0 + dy;
    nx = Math.max(-d.dw, Math.min(d.dw, nx)); ny = Math.max(-d.dh, Math.min(d.dh, ny));
    state.panX = nx; state.panY = ny;
    if (!d.raf) d.raf = requestAnimationFrame(applyPanFrame);
  }
  // Beendet einen evtl. laufenden Pan sauber (z. B. bei Fokusverlust des Fensters).
  function cleanupStuckPan() {
    const d = state.panDrag; if (!d) return;
    state.panDrag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.doc) { d.doc.style.cursor = ''; d.doc.style.transition = ''; d.doc.style.willChange = ''; }
    applyZoomSat();
  }
  function onMove(e) {
    if (state.panDrag) { onPanDrag(e); return; }
    if (state.scaleDrag) { onScaleDrag(e); return; }
    if (state.groupDrag) { onGroupDrag(e); return; }
    if (state.cwDrag) { onCwDrag(e); return; }
    if (state.pinDrag) { onPinDrag(e); return; }
    if (state.iconDrag) { onIconDrag(e); return; }
    if (state.techDrag) { onTechDrag(e); return; }
    if (state.zoneDrag) { onZoneDrag(e); return; }
    updateZoneHoverTitle(e);
    if (state.drawZone) {
      const doc = document.getElementById('canvasDoc');
      if (doc) { const r = doc.getBoundingClientRect(); const cxr = clamp01((e.clientX - r.left) / r.width), cyr = clamp01((e.clientY - r.top) / r.height); const sn = snapCursor(cxr, cyr); state.zoneCursor = { x: sn.x, y: sn.y }; state.zoneAlign = { x: sn.ax, y: sn.ay }; state.zoneSnap = sn.dock ? { x: sn.x, y: sn.y } : null; updateDraftDom(); }
    }
    if (!dragMove) return;
    if (!dragMove.moved && Math.hypot(e.clientX - dragMove.sx, e.clientY - dragMove.sy) < 4) return;
    dragMove.moved = true;
    const r = dragMove.doc.getBoundingClientRect();
    let x = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width));
    let y = Math.min(0.96, Math.max(0.04, (e.clientY - r.top) / r.height));
    if (state.snapGrid) { x = Math.min(0.97, Math.max(0.03, snapToGrid(x))); y = Math.min(0.96, Math.max(0.04, snapToGrid(y))); }
    dragMove.nx = x; dragMove.ny = y;
    dragMove.el.style.left = (x * 100) + '%'; dragMove.el.style.top = (y * 100) + '%'; dragMove.el.style.cursor = 'grabbing';
    // Skalier-Anfasser (Doppelpfeil) des Icons mitführen, falls sichtbar
    const _mh = document.querySelector('.sel-resize[data-obj="' + dragMove.oid + '"]');
    if (_mh) {
      const _mo = (state.detail.objects || []).find((z) => z.id === dragMove.oid);
      const _off = handleOff(_mo ? (_mo.scale || 1) : 1);
      _mh.style.left = (clamp01(x + _off) * 100) + '%'; _mh.style.top = (clamp01(y + _off) * 100) + '%';
    }
    // Zustands-Icon-Verbindungslinien live mitziehen (auf die Icon-Mitte, nicht den Spalten-Anker)
    const sf = symFrac(dragMove.oid);
    const slx = (sf ? sf.x : x) * 100, sly = (sf ? sf.y : y) * 100;
    document.querySelectorAll('[data-sline^="' + dragMove.oid + '__"]').forEach((ln) => {
      ln.setAttribute('x1', slx.toFixed(3)); ln.setAttribute('y1', sly.toFixed(3));
    });
    // Technologie-Linie live mitziehen (Roboter-Ende der Linie)
    const tline = document.getElementById('tech-line-' + dragMove.oid);
    if (tline) {
      const ro = (state.detail.objects || []).find((z) => z.id === dragMove.oid);
      let bx, by;
      if (ro && ro.points && ro.points.length >= 1 && ro.points[0]) { bx = ro.points[0].x; by = ro.points[0].y; }
      else {
        bx = Math.min(x + 0.12, 0.94); by = Math.max(y - 0.12, 0.07);
        const bd = document.querySelector('.tech-badge[data-tech="' + (ro ? ro.id : '') + '"]');
        if (bd) { bd.style.left = (bx * 100) + '%'; bd.style.top = (by * 100) + '%'; }
      }
      const e = techLineEnds(x, y, bx, by);
      tline.setAttribute('x1', e.x1.toFixed(3)); tline.setAttribute('y1', e.y1.toFixed(3));
      tline.setAttribute('x2', e.x2.toFixed(3)); tline.setAttribute('y2', e.y2.toFixed(3));
    }
  }
  async function endMove() {
    if (state.panDrag) {
      cleanupStuckPan();
      return;
    }
    if (state.pinDrag) {
      var d = state.pinDrag; state.pinDrag = null;
      var c = (state.comments || []).find(function (x) { return x.id === d.id; });
      if (c) {
        if (d.moved && d.x != null) {
          c.x = d.x; c.y = d.y;
          if (state.commentsServer) {
            // Schutz gegen Zurueckspringen: rein zeitbasiert (kann nie dauerhaft blockieren, auch wenn
            // der PATCH haengt): 15s ab Start, nach Abschluss noch 7s Nachlauf fuer den naechsten Poll.
            state.commentsHoldUntil = Date.now() + 15000;
            Api.moveComment(c.id, d.x, d.y)
              .catch(function () { toast(t('Kommentar-Position konnte nicht gespeichert werden')); })
              .finally(function () { state.commentsHoldUntil = Date.now() + 7000; });
            state.commentsSig = commentsSig(state.comments);
          } else { saveComments(); }
          renderEditor();
        }
        else { state.openComment = d.id; renderEditor(); setTimeout(function () { var i = $('cwText'); if (i) i.focus(); }, 30); }
      }
      return;
    }
    if (state.cwDrag) {
      var d = state.cwDrag; state.cwDrag = null;
      var c = (state.comments || []).find(function (x) { return x.id === d.id; });
      if (c && d.leftPct != null) { c.winX = d.leftPct / 100; c.winY = d.topPct / 100; if (!state.commentsServer) saveComments(); }
      return;
    }
    if (state.scaleDrag) { await endScaleDrag(); return; }
    if (state.groupDrag) { await endGroupDrag(); return; }
    if (state.iconDrag) { await endIconDrag(); return; }
    if (state.techDrag) {
      const td = state.techDrag; state.techDrag = null;
      const o = (state.detail.objects || []).find((z) => z.id === td.id);
      if (td.moved && o) { o.points = [{ x: td.fx, y: td.fy }]; if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; } protectObj(o.id); try { await Api.updateObject(o.id, { points: o.points }); } catch (e2) { toast(t('Position nicht gespeichert')); } }
      renderEditor(); return;
    }
    if (state.zoneDrag) {
      const zd = state.zoneDrag; state.zoneDrag = null;
      const z = (state.detail.objects || []).find((o) => o.id === zd.id);
      if ((zd.type === 'vertex' || zd.type === 'move') && zd.moved && z) {
        if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; }
        protectObj(z.id);
        state.geomPending[z.id] = { points: z.points.map(function (p) { return { x: p.x, y: p.y }; }), ts: Date.now() };
        updateZoneDom(z);
        const _rel = document.getElementById('zone-poly-' + z.id); if (_rel) _rel.setAttribute('stroke', esc(zoneColor(z))); // gruene Snap-Rueckmeldung nach dem Loslassen zuruecksetzen
        try {
          await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y });
        } catch (e2) { toast(t('Position nicht gespeichert')); }
        // SB-Polygon auf einen SPS-Bereich gezogen -> automatische SPS-Verknuepfung
        if (zd.type === 'move' && (z.symbolType === 'sb_zone' || z.symbolType === 'fg_zone')) { await autoLinkZoneToSps(z); }
        return;
      }
      // Klick ohne Bewegung: Auswahl bzw. Doppelklick (zeitbasiert, re-render-fest)
      if (z) {
        const now = Date.now();
        const dbl = state.lastZoneUp && state.lastZoneUp.id === z.id && (now - state.lastZoneUp.t) < 400;
        state.lastZoneUp = dbl ? null : { id: z.id, t: now };
        if (dbl) { if (z.symbolType === 'mf_route') openRouteModal(z.id); else if (z.symbolType === 'sb_zone' || z.symbolType === 'sps_zone') openZoneAssignModal(z.id); else if (z.symbolType === 'fg_zone') openTagModal(z.id); return; }
        let zRender = false;
        if (state.selectedZone !== z.id) { state.selectedZone = z.id; zRender = true; }
        if (z.layerId && layerById(z.layerId) && state.activeLayer !== z.layerId) { state.activeLayer = z.layerId; zRender = true; }
        if (zRender) renderEditor();
        focusObjInList(z.id);
        return;
      }
      return;
    }
    if (!dragMove) return;
    const dm = dragMove; dragMove = null;
    if (dm.el) dm.el.style.cursor = '';
    const clicked = (state.detail.objects || []).find((x) => x.id === dm.oid);
    let selRender = false;
    // Objekt anklicken/verschieben -> auswaehlen; zugehoerige Ebene rechts aktiv setzen (Prozesstyp hebt zudem die Funktionsgruppe hervor).
    if (clicked) {
      if (state.selectedObj !== dm.oid) { state.selectedObj = dm.oid; selRender = true; }
      if (clicked.layerId && layerById(clicked.layerId) && state.activeLayer !== clicked.layerId) { state.activeLayer = clicked.layerId; selRender = true; }
    } else if (state.selectedObj) { state.selectedObj = null; selRender = true; }
    if (dm.moved && dm.nx != null) {
      if (state._preDrag) { pushUndoSnap(state._preDrag); state._preDrag = null; }
      const o = clicked;
      if (o) {
        o.x = dm.nx; o.y = dm.ny;
        protectObj(o.id); try { await Api.updateObject(o.id, { x: dm.nx, y: dm.ny }); } catch (e) { toast('Verschieben nicht gespeichert'); }
        // Prozesstyp auf eine Funktionsgruppe gezogen -> automatisch zuordnen (Metatag „Funktionsgruppen")
        let fgChanged = false;
        if (/^ptk_/.test(o.symbolType)) {
          const fg = detectFgName(dm.nx, dm.ny);
          const cur = (o.metatags || []).find((m) => m.label === 'Funktionsgruppen');
          if (fg && (cur ? cur.value : '') !== fg) {
            o.metatags = o.metatags || [];
            if (cur) cur.value = fg; else o.metatags.unshift({ position: 0, label: 'Funktionsgruppen', value: fg });
            protectObj(o.id); try { await Api.setMetatags(o.id, o.metatags); } catch (e) { /* optional */ }
            toast(o.name + ' → Funktionsgruppe „' + fg + '" zugeordnet'); fgChanged = true;
          }
        }
        if (fgChanged || techInfo(o)) selRender = true;
      }
    }
    if (selRender) renderEditor();
    if (clicked && state.selectedObj === dm.oid) focusObjInList(dm.oid);
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
      if (v && v !== o.name) { pushUndo(); try { await Api.updateObject(oid, { name: v }); o.name = v; renderEditor(); } catch (e) { toast(t('Umbenennen fehlgeschlagen')); } }
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
  async function onLayoutFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Bitte eine Bilddatei wählen'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('Bild zu groß (max. 8 MB)'); return; }
    if (!state.detail) { toast('Bitte zuerst eine Anlage wählen'); return; }
    if (state.uploadingLayout) { return; } // Doppel-Upload verhindern (Rate-Limit)
    state.uploadingLayout = true;
    toast('Layout wird hochgeladen …');
    try {
      await Api.uploadLayout(state.detail.id, f);
      state.detail.hasLayout = true;
      state.layoutBlobStation = null;
      await ensureLayoutBlob();
      toast('Layout hochgeladen');
      if (state.view === 'editor') renderEditor(); else renderDetail();
    } catch (e2) {
      const msg = /429|too many/i.test(e2 && e2.message ? e2.message : '') ? 'Zu viele Uploads in kurzer Zeit – bitte kurz warten und erneut versuchen.' : ('Upload fehlgeschlagen: ' + (e2 && e2.message ? e2.message : e2));
      toast(msg);
    } finally { state.uploadingLayout = false; }
  }

  let _h2cPromise = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'js/html2canvas.min.js?v=1.2.38';
      sc.onload = () => resolve(window.html2canvas);
      sc.onerror = () => { _h2cPromise = null; reject(new Error('html2canvas nicht geladen')); };
      document.head.appendChild(sc);
    });
    return _h2cPromise;
  }
  // Nimmt die gerenderte Modellierung (#canvasDoc) 1:1 als PNG auf – fuer ein PDF, das exakt der App-Ansicht entspricht.
  async function captureMapImage() {
    const el = document.getElementById('canvasDoc');
    if (!el) throw new Error('Editor-Ansicht (canvasDoc) nicht gefunden');
    const h2c = await loadHtml2Canvas();
    if (typeof h2c !== 'function') throw new Error('html2canvas nicht verfuegbar');
    const prevTransform = el.style.transform;
    el.style.transform = 'none'; // Zoom fuer die Aufnahme neutralisieren
    try {
      const rect = el.getBoundingClientRect();
      const scale = Math.max(1, Math.min(3, 1600 / Math.max(1, rect.width)));
      // Roboter-Maske (grau: weisse Form auf schwarz = Luminanz-Maske) einmalig in eine Alpha-Maske umwandeln.
      let alphaMask = null, mw = 24, mh = 24;
      try {
        const maskImg = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('mask')); im.src = new URL('img/robot-mask.png', location.href).href; });
        mw = maskImg.naturalWidth || 24; mh = maskImg.naturalHeight || 24;
        const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
        const mx = mc.getContext('2d'); mx.drawImage(maskImg, 0, 0, mw, mh);
        const mid = mx.getImageData(0, 0, mw, mh); const md = mid.data;
        for (let i = 0; i < md.length; i += 4) { const lum = (md[i] + md[i + 1] + md[i + 2]) / 3; md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = lum; }
        mx.putImageData(mid, 0, 0); alphaMask = mc;
      } catch (e) { alphaMask = null; }
      const tintCache = {};
      const tintedRobot = function (color) {
        if (!alphaMask) return null;
        if (tintCache[color]) return tintCache[color];
        const c = document.createElement('canvas'); c.width = mw; c.height = mh;
        const cc = c.getContext('2d');
        cc.fillStyle = color; cc.fillRect(0, 0, mw, mh);
        cc.globalCompositeOperation = 'destination-in'; cc.drawImage(alphaMask, 0, 0);
        return (tintCache[color] = c.toDataURL('image/png'));
      };
      const canvas = await h2c(el, {
        scale: scale, backgroundColor: '#ffffff', useCORS: true, allowTaint: false, logging: false,
        onclone: function (doc) {
          try {
            // Editier-Raster (Snap-/Zeichenraster) nicht ins PDF aufnehmen
            doc.querySelectorAll('.snap-grid, .draw-grid').forEach(function (el) { el.style.display = 'none'; });
            const vw = doc.defaultView || window;
            doc.querySelectorAll('rect').forEach(function (r) {
              if ((r.getAttribute('mask') || '').indexOf('robotMask') < 0) return;
              let col = '#ffffff';
              try { const cs = vw.getComputedStyle(r); col = (cs.fill && cs.fill !== 'none' && cs.fill !== 'currentcolor') ? cs.fill : (cs.color || '#ffffff'); } catch (e) { /* ignore */ }
              const data = tintedRobot(col); if (!data) return;
              const img = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
              img.setAttribute('x', '0'); img.setAttribute('y', '0'); img.setAttribute('width', '24'); img.setAttribute('height', '24');
              img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', data); img.setAttribute('href', data);
              if (r.parentNode) r.parentNode.replaceChild(img, r);
            });
          } catch (e) { /* ignore */ }
        },
      });
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl || dataUrl.length < 100) throw new Error('leeres Bild erzeugt');
      return dataUrl;
    } finally {
      el.style.transform = prevTransform;
    }
  }
  async function exportFile(kind) {
    try {
      if (kind === 'pdf') {
        toast('PDF wird erstellt …');
        let mapImage = null;
        try { mapImage = await captureMapImage(); }
        catch (e) { toast('Modellierung nicht aufgenommen: ' + (e && e.message ? e.message : e)); }
        const res = await Api.raw('/stations/' + state.detail.id + '/export.pdf', { method: 'POST', body: { mapImage: mapImage } });
        if (!res.ok) { toast(t('Export fehlgeschlagen')); return; }
        const url = URL.createObjectURL(await res.blob());
        const fn = (state.detail.anlagenname || 'Anlage').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'Anlage';
        const a = document.createElement('a'); a.href = url; a.download = fn + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      const res = await Api.raw('/stations/' + state.detail.id + '/export.' + kind);
      if (!res.ok) { toast(t('Export fehlgeschlagen')); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = (state.detail.anlagenname || 'anlage').replace(/[^A-Za-z0-9_\-]+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(t('Export fehlgeschlagen')); }
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
    if (pl) { e.preventDefault(); openTagModal(pl.getAttribute('data-obj')); }
  }

  function openZoneAssignModal(zoneId) {
    closeZoneModal();
    const z = (state.detail.objects || []).find((o) => o.id === zoneId); if (!z) return;
    const isSps = z.symbolType === 'sps_zone';
    const plcs = state.detail.plcs || [];
    const cur = z.plcConfigId || null;
    // 1:1 – SPS, die bereits einem ANDEREN SPS-Bereich zugeordnet sind, sperren
    const usedBy = {};
    if (isSps) (state.detail.objects || []).forEach((o) => { if (o.symbolType === 'sps_zone' && o.id !== zoneId && o.plcConfigId) usedBy[o.plcConfigId] = o; });
    const rows = plcs.length
      ? plcs.map((p) => {
          const taken = isSps && !!usedBy[p.id];
          return '<button class="za-row ' + (cur === p.id ? 'sel ' : '') + (taken ? 'taken' : '') + '"'
            + (taken ? ' disabled' : ' data-plc="' + p.id + '" data-color="' + esc(p.color) + '"') + '>'
            + '<span class="za-swatch" style="background:' + esc(p.color) + '"></span><span class="za-name">' + esc(p.name) + '</span>'
            + (cur === p.id ? '<span class="za-check">✓</span>' : (taken ? '<span class="za-taken">bereits belegt</span>' : '')) + '</button>';
        }).join('')
      : '<div class="za-empty">Für diese Anlage sind noch keine SPS angelegt. Lege sie in der Detailansicht an (EDITIEREN › SPS hinzufügen).</div>';
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card" role="dialog" aria-modal="true" aria-label="SPS-Zuordnung">'
      + '<div class="za-head"><div><div class="za-title">' + (isSps ? 'SPS-Bereich zuordnen' : 'Schutzbereich zuordnen') + '</div><div class="za-sub">' + esc(z.name) + (isSps ? ' · genau eine SPS (1:1)' : '') + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen" aria-label="Schließen">×</button></div>'
      + '<div class="za-body">' + rows + '</div>'
      + '<div class="za-foot"><button class="btn ' + (cur ? 'del-btn' : '') + '" data-za="none">Keine Zuordnung</button>'
      + '<button class="btn" data-za="close">Schließen</button></div></div></div>';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('zaBackdrop');
    bd.addEventListener('mousedown', (ev) => { bd._downBackdrop = (ev.target.id === 'zaBackdrop'); });
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'zaBackdrop') { if (bd._downBackdrop) closeZoneModal(); bd._downBackdrop = false; return; }
      const za = ev.target.closest('[data-za]');
      if (za) { const a = za.getAttribute('data-za'); if (a === 'close') { closeZoneModal(); } else if (a === 'none') { assignZone(zoneId, null, null); } return; }
      const row = ev.target.closest('.za-row');
      if (row) assignZone(zoneId, row.getAttribute('data-plc'), row.getAttribute('data-color'));
    });
  }
  function closeZoneModal() { const b = document.getElementById('zaBackdrop'); if (b) b.remove(); }
  async function assignZone(zoneId, plcId, plcColor) {
    const z = (state.detail.objects || []).find((o) => o.id === zoneId); if (!z) { closeZoneModal(); return; }
    if (z.symbolType === 'sps_zone' && plcId) {
      const clash = (state.detail.objects || []).find((o) => o.symbolType === 'sps_zone' && o.id !== zoneId && o.plcConfigId === plcId);
      if (clash) { toast('Diese SPS ist bereits einem anderen SPS-Bereich zugeordnet'); return; }
    }
    pushUndo();
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
    const opts = '<option value="">' + t('— bitte wählen —') + '</option>'
      + ROUTE_ARTS.map((a) => '<option value="' + esc(a) + '"' + (a === art ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    const matOpts = '<option value="">— ohne —</option>'
      + FLOW_TYPES.map((f) => '<option value="' + esc(f.name) + '"' + (f.name === mat ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
    const html = '<div class="za-backdrop" id="zaBackdrop"><div class="za-card" role="dialog" aria-modal="true" aria-label="SPS-Zuordnung">'
      + '<div class="za-head"><div><div class="za-title">Förderweg</div><div class="za-sub">' + esc(z.name) + '</div></div>'
      + '<button class="za-x" data-za="close" title="Schließen" aria-label="Schließen">×</button></div>'
      + '<div class="za-body" style="display:flex;flex-direction:column;gap:12px;padding:16px">'
      + '<div class="m-field"><label>Materialfluss-Typ (Farbe)</label><select id="rfMat">' + matOpts + '</select></div>'
      + '<div class="m-field"><label>Förderart (Linienstil)</label><select id="rfArt">' + opts + '</select></div>'
      + '<div class="m-field"><label>Bezeichnung / Teil</label><input id="rfBez" placeholder="z. B. Karosserie-Seitenteil" value="' + esc(bez) + '"></div>'
      + '<button class="btn" data-za="reverse" style="justify-content:flex-start">⇄ Flussrichtung umkehren</button>'
      + '</div>'
      + '<div class="za-foot"><button class="btn" data-za="close">Abbrechen</button>'
      + '<button class="btn" data-za="save" style="background:' + esc(col) + ';border-color:' + esc(col) + ';color:#fff">Speichern</button></div></div></div>';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    const bd = document.getElementById('zaBackdrop');
    bd.addEventListener('mousedown', (ev) => { bd._downBackdrop = (ev.target.id === 'zaBackdrop'); });
    bd.addEventListener('click', (ev) => {
      if (ev.target.id === 'zaBackdrop') { if (bd._downBackdrop) closeZoneModal(); bd._downBackdrop = false; return; }
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
    pushUndo(); // Förderweg-Daten/-Farbe waren bisher kein eigener Undo-Schritt
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
    pushUndo();
    z.points = z.points.slice().reverse();
    protectObj(z.id);
    try { await Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }); }
    catch (e) { toast('Richtung nicht gespeichert'); }
    toast('Flussrichtung umgekehrt'); renderEditor();
  }

  function onContentPointerDown(e) {
    if (!canEdit()) return;
    // Sicherheitsnetz: einen evtl. haengengebliebenen Pan-Zustand vor jeder neuen Interaktion aufraeumen,
    // damit endMove nicht faelschlich im Pan-Zweig austeigt (sonst bliebe der Ebenenwechsel beim Greifen aus).
    if (state.panDrag) { cleanupStuckPan(); }
    // Zonen zeichnen: schon beim Aufsetzen einrasten + Snap-Ring zeigen (auch Touch / Klick ohne vorherige Bewegung).
    if (state.drawZone && e.target.closest('#canvasDoc')) {
      const doc0 = document.getElementById('canvasDoc');
      if (doc0) { const r = doc0.getBoundingClientRect(); const cxr = clamp01((e.clientX - r.left) / r.width), cyr = clamp01((e.clientY - r.top) / r.height); const sn = snapCursor(cxr, cyr); state.zoneCursor = { x: sn.x, y: sn.y }; state.zoneAlign = { x: sn.ax, y: sn.ay }; state.zoneSnap = sn.dock ? { x: sn.x, y: sn.y } : null; updateDraftDom(); }
    }
    // Kommentar-Fenster an der Kopfzeile verschieben (nicht auf X/Löschen)
    const cwh = e.target.closest('.cw-head');
    if (cwh && !e.target.closest('.cw-x, .cw-del')) {
      const win = cwh.closest('.comment-window'), doc0 = document.getElementById('canvasDoc');
      if (win && doc0) {
        e.preventDefault();
        const dr = doc0.getBoundingClientRect(), wr = win.getBoundingClientRect();
        state.cwDrag = { id: state.openComment, offx: e.clientX - wr.left, offy: e.clientY - wr.top, docW: dr.width, docH: dr.height, docL: dr.left, docT: dr.top };
        try { win.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      return;
    }
    // Kommentar-Nadel verschieben (Ziehen) bzw. bei Klick ohne Bewegung öffnen
    const pin = e.target.closest('.comment-pin');
    if (pin) {
      const doc0 = document.getElementById('canvasDoc');
      if (doc0) {
        e.preventDefault();
        const dr = doc0.getBoundingClientRect();
        state.pinDrag = { id: pin.getAttribute('data-id'), docL: dr.left, docT: dr.top, docW: dr.width, docH: dr.height, sx: e.clientX, sy: e.clientY, moved: false };
        try { pin.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      return;
    }
    // Klicks auf interaktive Overlays (Kommentar-Fenster/-Nadel, Vorschläge, Lern-/Vorlagen-UI)
    // nicht zur Zonen-Auswahl/Verschiebung durchschlagen lassen.
    if (e.target.closest('.comment-window, .comment-pin, .robot-sugg-layer, .learn-prompt, .pt-sugg-layer, .tpl-panel')) return;
    // Technologie-Blase greifen
    const td = e.target.closest('[data-techdrag]');
    if (td) { e.preventDefault(); state._preDrag = snapObjects(); state.techDrag = { id: td.getAttribute('data-techdrag'), moved: false }; protectObj(td.getAttribute('data-techdrag')); try { td.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } return; }
    // Mittelpunkt-Handle: neuen Stützpunkt an der Kante einfügen (danach frei ziehbar)
    const mid = e.target.closest('.zone-midpoint');
    if (mid) {
      e.preventDefault();
      const zid = mid.getAttribute('data-zone'), eidx = +mid.getAttribute('data-eidx');
      const z = (state.detail.objects || []).find((o) => o.id === zid);
      if (z && z.points) {
        const p = z.points[eidx], q = z.points[(eidx + 1) % z.points.length];
        pushUndo();
        z.points.splice(eidx + 1, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        protectObj(z.id);
        state.geomPending[z.id] = { points: z.points.map(function (pp) { return { x: pp.x, y: pp.y }; }), ts: Date.now() };
        Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }).catch(function () { toast(t('Position nicht gespeichert')); });
        renderEditor();
      }
      return;
    }
    // Stützpunkt eines Schutzbereichs greifen
    const v = e.target.closest('.zone-vertex');
    if (v) {
      e.preventDefault();
      state._preDrag = snapObjects();
      state.zoneDrag = { type: 'vertex', id: v.getAttribute('data-zone'), idx: +v.getAttribute('data-vidx'), moved: false };
      try { v.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    // Frei platziertes Zustands-Icon greifen
    const si = e.target.closest('.state-icon');
    if (si) {
      e.preventDefault();
      const doc = e.target.closest('#canvasDoc');
      state._preDrag = snapObjects();
      state.iconDrag = { oid: si.getAttribute('data-sicon-parent'), st: si.getAttribute('data-sicon-state'), el: si, moved: false, nx: null, ny: null };
      try { (doc || si).setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      return;
    }
    // Symbol verschieben
    // Skalier-Anfasser der Mehrfachauswahl
    const sh = e.target.closest('[data-scalehandle]');
    if (sh) { startScaleDrag(e); return; }
    const pl = e.target.closest('.placed');
    if (pl) {
      const oid = pl.getAttribute('data-obj');
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelObj(oid); renderEditor(); return; }
      if (state.selObjs && state.selObjs.length > 1 && state.selObjs.indexOf(oid) >= 0) { startGroupDrag(e); return; }
      if (state.selObjs && state.selObjs.length) { state.selObjs = []; }
      // Ebene des Objekts sofort aktiv setzen (robust – wie bei Zonen, unabhaengig von Klick/Bewegung/Render-Timing).
      {
        const _o = (state.detail.objects || []).find((x) => x.id === oid);
        let oNeedRender = false;
        if (state.selectedObj !== oid) { state.selectedObj = oid; oNeedRender = true; }
        if (_o && _o.layerId && layerById(_o.layerId) && state.activeLayer !== _o.layerId) { state.activeLayer = _o.layerId; oNeedRender = true; }
        if (oNeedRender) renderEditor();
      }
      startMove(e, oid); return;
    }
    // Schutzbereich auswählen / verschieben (nicht im Zeichenmodus)
    if (!state.drawZone) {
      const doc = e.target.closest('#canvasDoc');
      if (doc) {
        const r = doc.getBoundingClientRect();
        const x = clamp01((e.clientX - r.left) / r.width), y = clamp01((e.clientY - r.top) / r.height);
        const z = zoneAt(x, y);
        if (z) {
          // Jedes Ziehen verschiebt direkt; ein reiner Klick (keine Bewegung) wählt nur aus.
          state._preDrag = snapObjects();
          state.zoneDrag = { type: 'move', id: z.id, sx: x, sy: y, moved: false, orig: z.points.map((p) => ({ x: p.x, y: p.y })) };
          try { doc.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
          // Ebene der Zone sofort aktiv setzen (robust – unabhaengig von Klick/Bewegung/Render-Timing).
          let zNeedRender = false;
          if (state.selectedObj || (state.selObjs && state.selObjs.length)) { state.selectedObj = null; state.selObjs = []; zNeedRender = true; }
          if (state.selectedZone !== z.id) { state.selectedZone = z.id; zNeedRender = true; }
          if (z.layerId && layerById(z.layerId) && state.activeLayer !== z.layerId) { state.activeLayer = z.layerId; zNeedRender = true; }
          if (zNeedRender) renderEditor();
        } else {
          // Leere Fläche: Ziehen verschiebt das ganze Layout samt Objekten (Pan). Fokus eines zuvor
          // bearbeiteten Icons/Polygons dabei loesen (reiner Klick hebt die Auswahl ebenfalls auf).
          e.preventDefault();
          if (state.selectedObj || state.selectedZone || (state.selObjs && state.selObjs.length)) { deselectFast(); }
          const pdoc = document.getElementById('canvasDoc') || doc; // re-query: bei selektierter Zone kann deselectFast voll gerendert haben
          const z0 = state.zoom || 1;
          state.panDrag = { sx: e.clientX, sy: e.clientY, px0: state.panX || 0, py0: state.panY || 0, moved: false, doc: pdoc, dw: pdoc.offsetWidth * z0, dh: pdoc.offsetHeight * z0, z: z0, raf: 0 };
          pdoc.style.cursor = 'grabbing'; pdoc.style.transition = 'none'; pdoc.style.willChange = 'transform';
        }
      }
    }
  }

  // Snapping beim Verschieben eines ganzen Polygons: liefert einen Offset, der den naechstliegenden
  // Eckpunkt auf eine gleichartige Ecke (Vorrang) bzw. Kante legt - so rastet es z. B. wieder am Ursprung ein.
  function snapMovedPolygon(z, pts) {
    const dt = z.symbolType, ar = docAspect(), vth = 0.03, eth = 0.025;
    const targets = (state.detail.objects || []).filter((o) => o.id !== z.id && o.symbolType === dt && o.points && o.points.length >= 2);
    if (!targets.length) return null;
    let bV = null, bVD = vth, bE = null, bED = eth;
    pts.forEach((p) => {
      const pxx = p.x * ar, pyy = p.y;
      targets.forEach((o) => {
        const tp = o.points, n = tp.length;
        for (let i = 0; i < n; i++) {
          const a = tp[i];
          const dv = Math.hypot((p.x - a.x) * ar, p.y - a.y); if (dv < bVD) { bVD = dv; bV = { x: a.x - p.x, y: a.y - p.y }; }
          if (n >= 3) {
            const b = tp[(i + 1) % n];
            const axx = a.x * ar, ayy = a.y, dxx = b.x * ar - axx, dyy = b.y - ayy, l2 = dxx * dxx + dyy * dyy;
            let t = l2 ? ((pxx - axx) * dxx + (pyy - ayy) * dyy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = (axx + t * dxx) / ar, qy = ayy + t * dyy, de = Math.hypot((p.x - qx) * ar, p.y - qy);
            if (de < bED) { bED = de; bE = { x: qx - p.x, y: qy - p.y }; }
          }
        }
      });
    });
    return bV || bE;
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
      let mpts = state.zoneDrag.orig.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
      const off = snapMovedPolygon(z, mpts);
      if (off) mpts = mpts.map((p) => ({ x: clamp01(p.x + off.x), y: clamp01(p.y + off.y) }));
      z.points = mpts;
      updateZoneDom(z); highlightDropTarget(z);
      const _pel = document.getElementById('zone-poly-' + z.id);
      if (_pel) _pel.setAttribute('stroke', off ? '#16A34A' : esc(zoneColor(z)));
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
    // SB/FG ohne SPS-Zuordnung: neutral grau - die Farbe kommt erst mit der Zuordnung vom SPS-Bereich.
    if (z.symbolType === 'sb_zone' || z.symbolType === 'fg_zone') return '#9AA7B2';
    return z.color;
  }

  // Name/Label einer Funktionsgruppe: erster gesetzter Metatag, sonst der Objektname.
  const fgName = window.PMX.fgName;
  // Funktionsgruppen-Zone, in der der Punkt (x,y) liegt (oberste), sonst null.
  function fgZoneAt(x, y) {
    const visible = visibleMap();
    const zs = (state.detail.objects || []).filter((o) => o.symbolType === 'fg_zone' && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    for (let i = zs.length - 1; i >= 0; i--) { if (pointInZone(zs[i], x, y)) return zs[i]; }
    return null;
  }
  function detectFgName(x, y) { const z = fgZoneAt(x, y); return z ? fgName(z) : ''; }
  // fg_zone-ID, die hervorgehoben werden soll, wenn ein zugeordneter Prozesstyp ausgewählt ist.
  function highlightedFgZoneId() {
    if (!state.selectedObj) return null;
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === state.selectedObj);
    if (!o || !/^ptk_/.test(o.symbolType)) return null;
    const mt = (o.metatags || []).find((m) => m.label === 'Funktionsgruppen');
    const fgv = mt && mt.value && String(mt.value).trim();
    if (!fgv) return null;
    const z = (state.detail.objects || []).find((x) => x.symbolType === 'fg_zone' && fgName(x) === fgv);
    return z ? z.id : null;
  }
  const zoneCentroid = window.PMX.zoneCentroid;
  // Bounding-Box + Flaeche (Prozent der Layoutflaeche) eines Polygons/Drafts.
  const polyMetrics = window.PMX.polyMetrics;
  const fmtMetrics = window.PMX.fmtMetrics;
  // SPS-Bereich (sps_zone), der den Punkt enthaelt – oberster, sonst null.
  function spsZoneAt(x, y) {
    const visible = visibleMap();
    const zs = (state.detail.objects || []).filter((o) => o.symbolType === 'sps_zone' && o.points && o.points.length >= 3 && visible[o.layerId] !== false);
    for (let i = zs.length - 1; i >= 0; i--) { if (pointInZone(zs[i], x, y)) return zs[i]; }
    return null;
  }
  // Beim Anklicken eines Schutzbereichs den verknuepften SPS-Bereich (gleiche SPS, 1:1) hervorheben.
  function highlightedSpsZoneId() {
    if (!state.selectedZone) return null;
    const o = (state.detail && state.detail.objects || []).find((x) => x.id === state.selectedZone);
    if (!o || (o.symbolType !== 'sb_zone' && o.symbolType !== 'fg_zone') || !o.plcConfigId) return null;
    const sps = (state.detail.objects || []).find((z) => z.symbolType === 'sps_zone' && z.plcConfigId === o.plcConfigId);
    return sps ? sps.id : null;
  }
  // SB-/FG-Polygon auf einen SPS-Bereich gezogen -> automatisch dessen SPS uebernehmen (Verknuepfung ueber plcConfigId).
  async function autoLinkZoneToSps(z) {
    const c = zoneCentroid(z);
    const sps = spsZoneAt(c.x, c.y);
    const newPlc = sps && sps.plcConfigId ? sps.plcConfigId : null;
    if (newPlc && z.plcConfigId !== newPlc) {
      const plc = (state.detail.plcs || []).find((p) => p.id === newPlc);
      z.plcConfigId = newPlc; z.color = (plc && plc.color) || z.color;
      try { await Api.updateObject(z.id, { plcConfigId: newPlc, color: z.color }); } catch (e) { /* ignore */ }
      const kind = z.symbolType === 'fg_zone' ? 'Funktionsgruppe' : 'Schutzbereich';
      toast(kind + ' automatisch SPS „' + ((plc && plc.name) || '') + '" zugeordnet');
      renderEditor();
    }
  }
  // Live-Feedback beim Ziehen: SPS-Bereich unter dem Zonen-Zentroid hervorheben (Drop-Ziel).
  function highlightDropTarget(z) {
    let targetId = null;
    if (z && (z.symbolType === 'sb_zone' || z.symbolType === 'fg_zone')) {
      const c = zoneCentroid(z);
      const sps = spsZoneAt(c.x, c.y);
      if (sps && sps.plcConfigId) targetId = sps.id;
    }
    document.querySelectorAll('.sps-drop-target').forEach((el) => { if (el.id !== 'zone-poly-' + targetId) el.classList.remove('sps-drop-target'); });
    if (targetId) { const el = document.getElementById('zone-poly-' + targetId); if (el) el.classList.add('sps-drop-target'); }
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
  const pointInZone = window.PMX.pointInZone;

  function finishZone() { return withMutationLock(function () { return finishZoneImpl(); }); }
  async function finishZoneImpl() {
    if (!state.drawZone || state.zoneDraft.length < 3) { toast('Mindestens 3 Stützpunkte nötig'); return; }
    pushUndo();
    const pts = state.zoneDraft.slice();
    const L = layerById(state.activeLayer);
    const kind = zoneKind(L);
    const num = String((state.detail.objects || []).filter((o) => o.symbolType === kind.type).length + 1).padStart(2, '0');
    state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null;
    try {
      const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: kind.prefix + '_' + num, symbolType: kind.type, color: (kind.type === 'nh_zone' ? '#D9534F' : L.color), x: pts[0].x, y: pts[0].y, points: pts });
      state.detail.objects.push(obj); state.selectedZone = obj.id; protectObj(obj.id);
      toast(kind.noun + ' erstellt');
      renderEditor();
      if (kind.type === 'sps_zone') openZoneAssignModal(obj.id); // SPS-Bereich: sofort die (genau eine) SPS zuordnen
      else if (kind.type === 'sb_zone' || kind.type === 'fg_zone') await autoLinkZoneToSps(obj); // SB/FG: automatisch dem umschliessenden SPS-Bereich zuordnen (wie beim Verschieben)
      return;
    } catch (e) { toast('Erstellen fehlgeschlagen: ' + e.message); }
    renderEditor();
  }
  // ---- Not-Halt-Grenze: Umriss der SB-Vereinigung (Moore-Konturverfolgung auf Zellraster).
  // Nicht verbundene SB-Gruppen werden per morphologischem Closing (kleinster verbindender Radius,
  // leicht verbreitert) ueberbrueckt -> genau EINE Grenze je Layout.
  function nhRdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const dl = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; if (!L) return Math.hypot(p.x - a.x, p.y - a.y); let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); };
    const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
    const st = [[0, pts.length - 1]];
    while (st.length) { const seg = st.pop(); const a = seg[0], b = seg[1]; let idx = -1, dm = eps; for (let i = a + 1; i < b; i++) { const d = dl(pts[i], pts[a], pts[b]); if (d > dm) { dm = d; idx = i; } } if (idx !== -1) { keep[idx] = true; st.push([a, idx], [idx, b]); } }
    const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }
  function nhSimplifyClosed(loop, eps) {
    if (loop.length < 4) return loop;
    let s = 0; for (let i = 1; i < loop.length; i++) if (loop[i].x < loop[s].x || (loop[i].x === loop[s].x && loop[i].y < loop[s].y)) s = i;
    const rot = loop.slice(s).concat(loop.slice(0, s)); rot.push(rot[0]);
    const out = nhRdp(rot, eps); out.pop();
    return out;
  }
  function sbUnionOutlines() {
    const sbs = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3);
    if (!sbs.length) return [];
    const polys = sbs.map((s) => s.points);
    const pbb = polys.map((pts) => { let a = 1, b = 1, c = 0, d = 0; pts.forEach((p) => { if (p.x < a) a = p.x; if (p.y < b) b = p.y; if (p.x > c) c = p.x; if (p.y > d) d = p.y; }); return [a, b, c, d]; });
    const pnp = (pts, x, y) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) ins = !ins; } return ins; };
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    polys.forEach((pts) => pts.forEach((p) => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }));
    const pad = 0.02; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(1, maxX + pad); maxY = Math.min(1, maxY + pad);
    const W = maxX - minX, H = maxY - minY; if (W <= 0 || H <= 0) return [];
    const N = 300, nx = Math.max(12, Math.round(N * (W >= H ? 1 : W / H))), ny = Math.max(12, Math.round(N * (H >= W ? 1 : H / W)));
    const dx = W / nx, dy = H / ny;
    const mask = []; for (let i = 0; i < nx; i++) { const col = new Uint8Array(ny); for (let j = 0; j < ny; j++) { const x = minX + (i + 0.5) * dx, y = minY + (j + 0.5) * dy; let v = 0; for (let p = 0; p < polys.length; p++) { const bb = pbb[p]; if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue; if (pnp(polys[p], x, y)) { v = 1; break; } } col[j] = v; } mask[i] = col; }
    const NN = nx * ny;
    const inb = (i, j) => i >= 0 && i < nx && j >= 0 && j < ny;
    const countComps = (m) => {
      const seen = []; for (let i = 0; i < nx; i++) seen[i] = new Uint8Array(ny);
      const qi = new Int32Array(NN), qj = new Int32Array(NN); let n = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        if (!m[i][j] || seen[i][j]) continue; n++;
        let h = 0, tq = 0; qi[tq] = i; qj[tq] = j; tq++; seen[i][j] = 1;
        while (h < tq) {
          const ci = qi[h], cj = qj[h]; h++;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            if (!a && !b) continue; const ni = ci + a, nj = cj + b;
            if (inb(ni, nj) && m[ni][nj] && !seen[ni][nj]) { seen[ni][nj] = 1; qi[tq] = ni; qj[tq] = nj; tq++; }
          }
        }
      }
      return n;
    };
    const bfsDist = (seed) => {
      const INF = 1 << 29; const d = []; for (let i = 0; i < nx; i++) d[i] = new Int32Array(ny).fill(INF);
      const qi = new Int32Array(NN), qj = new Int32Array(NN); let tq = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (seed(i, j)) { d[i][j] = 0; qi[tq] = i; qj[tq] = j; tq++; }
      let h = 0;
      while (h < tq) {
        const ci = qi[h], cj = qj[h]; h++; const nd = d[ci][cj] + 1;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          if (!a && !b) continue; const ni = ci + a, nj = cj + b;
          if (inb(ni, nj) && d[ni][nj] === INF) { d[ni][nj] = nd; qi[tq] = ni; qj[tq] = nj; tq++; }
        }
      }
      return d;
    };
    if (countComps(mask) > 1) {
      const dIn = bfsDist((i, j) => mask[i][j] === 1);
      const closeMask = (r) => { const dOut = bfsDist((i, j) => dIn[i][j] > r); const cm = []; for (let i = 0; i < nx; i++) { const col = new Uint8Array(ny); for (let j = 0; j < ny; j++) col[j] = (mask[i][j] || dOut[i][j] > r) ? 1 : 0; cm[i] = col; } return cm; };
      let lo = 1, hi = Math.max(nx, ny), bestR = -1;
      while (lo <= hi) { const r = (lo + hi) >> 1; if (countComps(closeMask(r)) <= 1) { bestR = r; hi = r - 1; } else lo = r + 1; }
      if (bestR > 0) { const cm = closeMask(Math.min(Math.max(nx, ny), bestR + 2)); for (let i = 0; i < nx; i++) mask[i].set(cm[i]); }
    }
    // Leichter Aussen-Versatz (1 Zelle): die Grenze liegt knapp AUSSEN an den SB an,
    // statt deren Rand zu ueberdecken - und umschliesst die SB damit vollstaendig.
    { const dM = bfsDist((i, j) => mask[i][j] === 1); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (dM[i][j] <= 1) mask[i][j] = 1; }
    // Moore-Nachbarschafts-Konturverfolgung (im Uhrzeigersinn) -> eine geschlossene Aussenkontur
    let si = -1, sj = -1;
    for (let j = 0; j < ny && si < 0; j++) for (let i = 0; i < nx; i++) if (mask[i][j]) { si = i; sj = j; break; }
    if (si < 0) return [];
    const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    let loop = [[si, sj]];
    let ci = si, cj = sj, bIdx = 6; // Start-Rueckrichtung: Norden (Zeile darueber ist sicher leer)
    const seenSt = new Map(); let cut = -1; let guard = 0;
    while (guard++ < NN * 8) {
      const key = (ci * ny + cj) * 8 + bIdx;
      const prev = seenSt.get(key);
      if (prev !== undefined) { cut = prev; break; } // Zustand wiederholt -> genau ein voller Umlauf dazwischen
      seenSt.set(key, loop.length - 1);
      let found = -1;
      for (let k = 1; k <= 8; k++) { const idx = (bIdx + k) % 8; const ni = ci + DIRS[idx][0], nj = cj + DIRS[idx][1]; if (inb(ni, nj) && mask[ni][nj]) { found = idx; break; } }
      if (found < 0) break; // isolierte Einzelzelle
      const pIdx = (found + 7) % 8; // zuletzt geprueft (aussen) -> neue Rueckrichtung
      const px = ci + DIRS[pIdx][0], py = cj + DIRS[pIdx][1];
      ci += DIRS[found][0]; cj += DIRS[found][1];
      const rdx = px - ci, rdy = py - cj;
      for (let k = 0; k < 8; k++) if (DIRS[k][0] === rdx && DIRS[k][1] === rdy) { bIdx = k; break; }
      loop.push([ci, cj]);
    }
    if (cut >= 0) loop = loop.slice(cut, loop.length - 1);
    if (loop.length < 3) return [];
    const pts = loop.map((c) => ({ x: minX + (c[0] + 0.5) * dx, y: minY + (c[1] + 0.5) * dy }));
    const ded = []; for (const p of pts) { const q = ded[ded.length - 1]; if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) ded.push(p); }
    const simp = nhSimplifyClosed(ded, 0.0032);
    return simp.length >= 3 ? [simp] : [];
  }
  // Fingerabdruck der SB-Geometrie: erkennt, ob sich SB seit der Grenz-Erzeugung geaendert haben.
  function sbFingerprint() {
    const sbs = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3);
    const s = sbs.map((o) => o.id + ':' + o.points.map((p) => p.x.toFixed(4) + ',' + p.y.toFixed(4)).join(';')).sort().join('|');
    let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'v' + (h >>> 0).toString(16) + '-' + sbs.length;
  }
  async function generateNotHaltBoundary() {
    if (!canEdit() || state.nhGenerating) return;
    const L = layerById(state.activeLayer); if (!L || L.name !== 'Not-Halt') return;
    const sbs = (state.detail.objects || []).filter((o) => o.symbolType === 'sb_zone' && o.points && o.points.length >= 3);
    if (!sbs.length) { toast('Keine Schutzbereiche vorhanden.'); return; }
    state.nhGenerating = true; renderEditor();
    let created = 0;
    try {
      const outlines = sbUnionOutlines();
      if (!outlines.length) { toast('Umriss konnte nicht erzeugt werden.'); return; }
      pushUndo();
      const fp = sbFingerprint();
      const old = (state.detail.objects || []).filter((o) => o.symbolType === 'nh_zone' && (o.metatags || []).some((m) => m.label === 'SB-Stand')); // nur automatisch erzeugte Grenzen ersetzen; manuell gezeichnete bleiben erhalten
      for (const o of old) { try { await Api.deleteObject(o.id); } catch (e) { /* ignore */ } state.detail.objects = state.detail.objects.filter((x) => x.id !== o.id); }
      for (let k = 0; k < outlines.length; k++) {
        const pts = outlines[k];
        try {
          const obj = await Api.createObject(state.detail.id, { layerId: L.id, name: 'Not-Halt-Grenze generiert' + (outlines.length > 1 ? ' ' + (k + 1) : ''), symbolType: 'nh_zone', color: '#D9534F', x: pts[0].x, y: pts[0].y, points: pts });
          try { await Api.setMetatags(obj.id, [{ label: 'SB-Stand', value: fp, position: 1 }]); obj.metatags = [{ label: 'SB-Stand', value: fp, position: 1 }]; } catch (e) { /* ignore */ }
          state.detail.objects.push(obj); if (k === 0) state.selectedZone = obj.id; protectObj(obj.id); created++;
        } catch (e) { /* ignore */ }
      }
      toast(created ? ('Not-Halt-Grenze erzeugt (' + sbs.length + ' SB umschlossen)') : 'Erstellen fehlgeschlagen');
    } finally { state.nhGenerating = false; }
    renderEditor();
  }

  function finishRoute() { return withMutationLock(function () { return finishRouteImpl(); }); }
  async function finishRouteImpl() {
    if (state.drawShape !== 'route' || state.zoneDraft.length < 2) { toast('Mindestens 2 Wegpunkte nötig'); return; }
    pushUndo();
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
    pushUndo();
    const isRoute = z.symbolType === 'mf_route';
    state.selectedZone = null;
    try { await Api.deleteObject(id); } catch (e) { toast(t('Löschen fehlgeschlagen')); return; }
    state.detail.objects = state.detail.objects.filter((o) => o.id !== id);
    const freed = await unlinkDependentsOf(z);
    toast((isRoute ? 'Förderweg gelöscht' : 'Bereich gelöscht') + (freed ? ' · ' + freed + ' Zuordnung(en) aufgehoben' : '')); renderEditor();
  }

  function updateZoneDom(z) {
    const el = document.getElementById('zone-poly-' + z.id);
    if (el) {
      if (z.symbolType === 'mf_route') {
        const cv = buildRouteCurve(z.points); el.setAttribute('d', cv.d);
        const a = document.getElementById('route-arrow-' + z.id);
        if (a) a.setAttribute('d', routeArrowFromTan(z.points[z.points.length - 1], cv.tan, docAspect()));
      } else {
        el.setAttribute('d', roundedPolyPath(z.points.map((p) => ({ x: p.x * 100, y: p.y * 100 })), 1.5));
      }
    }
    if (z.symbolType === 'sb_zone') { const bp = document.getElementById('sb-bolts-' + z.id); if (bp) bp.setAttribute('d', sbBoltPath(z, docAspect())); }
    z.points.forEach((p, i) => {
      const h = document.querySelector('.zone-vertex[data-zone="' + z.id + '"][data-vidx="' + i + '"]');
      if (h) { h.style.left = (p.x * 100) + '%'; h.style.top = (p.y * 100) + '%'; }
    });
    if (z.symbolType === 'fg_zone' || z.symbolType === 'sb_zone' || z.symbolType === 'sps_zone' || z.symbolType === 'nh_zone') {
      const lbl = document.querySelector('.fg-label[data-zone="' + z.id + '"]');
      if (lbl) {
        let cx, cy;
        if (z.symbolType === 'nh_zone') { // Label sitzt am obersten Punkt (wie im Render), nicht im Schwerpunkt
          let ti = 0; z.points.forEach((p, i) => { if (p.y < z.points[ti].y) ti = i; });
          cx = z.points[ti].x; cy = z.points[ti].y;
        } else {
          cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
          cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
        }
        lbl.style.left = (cx * 100) + '%'; lbl.style.top = (cy * 100) + '%';
      }
    }
    // Mittelpunkt-Handles + Maß-Badge live nachziehen
    const zn = z.points.length, isRoute = z.symbolType === 'mf_route', ec = isRoute ? zn - 1 : zn;
    for (let i = 0; i < ec; i++) {
      const p = z.points[i], q = z.points[(i + 1) % zn];
      const mh = document.querySelector('.zone-midpoint[data-zone="' + z.id + '"][data-eidx="' + i + '"]');
      if (mh) { mh.style.left = ((p.x + q.x) / 2 * 100) + '%'; mh.style.top = ((p.y + q.y) / 2 * 100) + '%'; }
    }
    const mm = document.querySelector('.zone-handle-layer .zone-measure');
    if (mm) { const met = polyMetrics(z.points); if (met) { mm.style.left = (met.minx * 100) + '%'; mm.style.top = (met.miny * 100) + '%'; mm.textContent = fmtMetrics(met, !isRoute); } }
  }
  // Cursor/Stützpunkt an vorhandene Draft-Punkte ausrichten (gleiche x/y) -> gerade Kanten.
  function snapCursor(cx, cy) {
    const th = 0.012; let x = cx, y = cy, ax = false, ay = false;
    // Andocken an vorhandene Zonen: Ecke hat Vorrang, sonst naechster Punkt auf einer Kante. Aspektkorrigiert.
    // Ziele: SB/SPS/FG-Zonen - NICHT die auto-erzeugte Not-Halt-Grenze und keine Foerderwege.
    const ar = docAspect(); const px = cx * ar, py = cy;
    const vth = 0.03, eth = 0.025;
    // Nur an GLEICHARTIGE Polygone andocken: der Typ, der gerade gezeichnet wird (SB->SB, FG->FG, SPS->SPS).
    const dt = (state.drawShape === 'zone' || state.drawShape === 'spszone') ? zoneKind(layerById(state.activeLayer)).type : null;
    let best = null, bestD = vth, bestE = null, bestED = eth;
    if (dt) ((state.detail && state.detail.objects) || []).forEach((o) => {
      if (o.symbolType !== dt) return;
      const pts = o.points; if (!pts || pts.length < 2) return;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const dv = Math.hypot((cx - a.x) * ar, cy - a.y); if (dv < bestD) { bestD = dv; best = a; }
        if (n >= 3) {
          const b = pts[(i + 1) % n];
          const axx = a.x * ar, ayy = a.y, dxx = b.x * ar - axx, dyy = b.y - ayy, l2 = dxx * dxx + dyy * dyy;
          let t = l2 ? ((px - axx) * dxx + (py - ayy) * dyy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = axx + t * dxx, qy = ayy + t * dyy, de = Math.hypot(px - qx, py - qy);
          if (de < bestED) { bestED = de; bestE = { x: qx / ar, y: qy }; }
        }
      }
    });
    if (best) return { x: best.x, y: best.y, ax: true, ay: true, dock: true };
    if (bestE) return { x: bestE.x, y: bestE.y, ax: true, ay: true, dock: true };
    // Achsen-Ausrichtung an bereits gesetzten Stuetzpunkten des aktuellen Polygons.
    (state.zoneDraft || []).forEach((p) => {
      if (Math.abs(cx - p.x) < th) { x = p.x; ax = true; }
      if (Math.abs(cy - p.y) < th) { y = p.y; ay = true; }
    });
    return { x: x, y: y, ax: ax, ay: ay };
  }
  function updateDraftDom() {
    const cur = state.zoneCursor, al = state.zoneAlign || {};
    const gv = document.getElementById('guide-v'), gh = document.getElementById('guide-h');
    if (gv && cur) { gv.setAttribute('x1', cur.x * 100); gv.setAttribute('x2', cur.x * 100); gv.setAttribute('stroke', al.x ? '#E8663F' : '#0065A5'); }
    if (gh && cur) { gh.setAttribute('y1', cur.y * 100); gh.setAttribute('y2', cur.y * 100); gh.setAttribute('stroke', al.y ? '#E8663F' : '#0065A5'); }
    const ring = document.getElementById('snap-ring');
    if (ring) { if (state.zoneSnap) { ring.setAttribute('cx', state.zoneSnap.x * 100); ring.setAttribute('cy', state.zoneSnap.y * 100); } else { ring.setAttribute('cx', -20); ring.setAttribute('cy', -20); } }
    // Schliess-Anzeige: Polygon (nicht Foerderweg) mit mindestens 3 Punkten und Cursor nah am ersten Punkt.
    // Schwelle identisch zur Klick-Auswertung (12 px), damit der Ring genau dann zeigt, wenn ein Klick schliesst.
    const cring = document.getElementById('close-ring');
    if (cring) {
      let hit = null;
      if (cur && state.drawShape !== 'route' && (state.zoneDraft || []).length >= 3) {
        const docC = document.getElementById('canvasDoc');
        const rc = docC ? docC.getBoundingClientRect() : null;
        const f = state.zoneDraft[0];
        if (rc && Math.hypot((f.x - cur.x) * rc.width, (f.y - cur.y) * rc.height) < 12) hit = f;
      }
      if (hit) { cring.setAttribute('cx', hit.x * 100); cring.setAttribute('cy', hit.y * 100); }
      else { cring.setAttribute('cx', -20); cring.setAttribute('cy', -20); }
    }
    const meas = document.getElementById('draw-measure');
    if (meas) {
      const pts = cur ? state.zoneDraft.concat([cur]) : state.zoneDraft;
      const m = polyMetrics(pts);
      if (m && cur) {
        meas.textContent = state.drawShape === 'route'
          ? ('B ' + Math.round(m.w * 100) + '% × H ' + Math.round(m.h * 100) + '% · ' + pts.length + ' Pkt')
          : fmtMetrics(m, true);
        meas.style.left = (cur.x * 100) + '%'; meas.style.top = (cur.y * 100) + '%'; meas.style.display = 'block';
      } else { meas.style.display = 'none'; }
    }
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

  const _nudgeTimers = {};
  function nudgeZonePersist(z) {
    protectObj(z.id);
    const id = z.id;
    state.geomPending[id] = { points: z.points.map(function (p) { return { x: p.x, y: p.y }; }), ts: Date.now() };
    if (_nudgeTimers[id]) clearTimeout(_nudgeTimers[id]);
    _nudgeTimers[id] = setTimeout(function () {
      delete _nudgeTimers[id];
      const zz = (state.detail.objects || []).find(function (o) { return o.id === id; });
      if (!zz || !zz.points || !zz.points.length) return;
      Api.updateObject(id, { points: zz.points, x: zz.points[0].x, y: zz.points[0].y }).catch(function () { toast(t('Position nicht gespeichert')); });
    }, 400);
  }
  // Rechtsklick auf einen Stützpunkt entfernt ihn (Polygon bleibt >=3, Weg >=2 Punkte).
  function onContentContextMenu(e) {
    if (state.view !== 'editor' || !canEdit()) return;
    const v = e.target.closest('.zone-vertex');
    if (v) {
      e.preventDefault();
      const zid = v.getAttribute('data-zone'), idx = +v.getAttribute('data-vidx');
      const z = (state.detail.objects || []).find((o) => o.id === zid); if (!z || !z.points) return;
      const minPts = z.symbolType === 'mf_route' ? 2 : 3;
      if (z.points.length <= minPts) { toast('Mindestens ' + minPts + ' Stützpunkte nötig'); return; }
      pushUndo();
      z.points.splice(idx, 1);
      protectObj(z.id);
      state.geomPending[z.id] = { points: z.points.map(function (p) { return { x: p.x, y: p.y }; }), ts: Date.now() };
      Api.updateObject(z.id, { points: z.points, x: z.points[0].x, y: z.points[0].y }).catch(function () { toast(t('Position nicht gespeichert')); });
      renderEditor();
      return;
    }
    // sonst: Kommentar an dieser Stelle anlegen
    const doc = e.target.closest('#canvasDoc'); if (!doc) return;
    e.preventDefault();
    const r = doc.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    createCommentAt(x, y);
  }
  /* ---------- Undo / Redo (Editor, mit Server-Sync) ---------- */
  function snapObjects() { return JSON.parse(JSON.stringify(state.detail.objects || [])); }
  function updateUndoBtns() {
    const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
    if (u) u.disabled = !!state.undoBusy || !(state.undoStack && state.undoStack.length);
    if (r) r.disabled = !!state.undoBusy || !(state.redoStack && state.redoStack.length);
  }
  function pushUndoSnap(snap) {
    state.undoStack = state.undoStack || []; state.redoStack = state.redoStack || [];
    state.undoStack.push(snap);
    state.objRev = (state.objRev || 0) + 1; // Stand-Zaehler: entwertet noch laufende Abgleiche
    if (state.undoStack.length > 60) state.undoStack.shift();
    state.redoStack = [];
    updateUndoBtns();
  }
  function pushUndo() { if (state.detail) pushUndoSnap(snapObjects()); }
  // Anlegende Aktionen serialisieren: Der Undo-Schnappschuss wird VOR dem Server-Aufruf
  // genommen, das neue Objekt aber erst DANACH in den Zustand aufgenommen. Ohne Schlange
  // schnappt eine zweite, schnell folgende Aktion denselben Ausgangszustand - beide Objekte
  // landen dann in EINEM Undo-Schritt. Mit Schlange wartet sie, bis die vorige fertig ist.
  // Noch unbestaetigte Anlagen (optimistisches Platzieren). Undo/Redo wartet kurz darauf,
  // sonst wuerde es versuchen, ein Objekt mit vorlaeufiger ID auf dem Server zu loeschen -
  // und die parallel laufende Anlage haette danach eine Karteileiche hinterlassen.
  let _pendingOps = [];
  function trackPendingOp() {
    let done; const p = new Promise(function (r) { done = r; });
    _pendingOps.push(p);
    const fin = function () { _pendingOps = _pendingOps.filter(function (x) { return x !== p; }); };
    p.then(fin, fin);
    return done;
  }
  function settlePendingOps() { return _pendingOps.length ? Promise.allSettled(_pendingOps.slice()) : Promise.resolve(); }
  let _mutChain = Promise.resolve();
  function withMutationLock(fn) {
    const run = _mutChain.then(fn, fn);
    _mutChain = run.then(function () { }, function () { });
    return run;
  }
  const objPayload = window.PMX.objPayload;
  function remapId(oldId, newId) {
    const fix = (arr) => (arr || []).forEach((o) => { if (o.id === oldId) o.id = newId; });
    fix(state.detail.objects);
    (state.undoStack || []).forEach(fix); (state.redoStack || []).forEach(fix);
    if (state.selectedZone === oldId) state.selectedZone = newId;
    if (state.selectedObj === oldId) state.selectedObj = newId;
    if (state.geomPending && state.geomPending[oldId]) { state.geomPending[newId] = state.geomPending[oldId]; delete state.geomPending[oldId]; }
  }
  // Serverzustand von "from" nach "to" ueberfuehren (Loeschen/Anlegen/Aendern), IDs neu angelegter Objekte uebernehmen.
  async function applyObjectsState(from, to) {
    state.detail.objects = to; renderEditor();
    state.objRev = (state.objRev || 0) + 1;
    let failed = 0;
    const fromById = {}, toById = {};
    from.forEach((o) => { fromById[o.id] = o; }); to.forEach((o) => { toById[o.id] = o; });
    const sid = state.detail.id;
    let didCreate = false;
    for (const o of from) { if (!toById[o.id]) { try { await Api.deleteObject(o.id); } catch (e) { failed++; } } }
    for (const o of to) {
      if (!fromById[o.id]) {
        try {
          const created = await Api.createObject(sid, objPayload(o));
          const newId = created && created.id;
          if (newId) {
            // Die Anlege-Route kennt scale/visible nicht -> direkt nachziehen, sonst kommt das Objekt
            // beim Rueckgaengigmachen in Standardgroesse/-sichtbarkeit zurueck.
            const after = {};
            if (o.plcConfigId) { after.plcConfigId = o.plcConfigId; after.color = o.color; }
            if (o.scale != null && o.scale !== 1) after.scale = o.scale;
            if (o.visible === false) after.visible = false;
            if (Object.keys(after).length) { try { await Api.updateObject(newId, after); } catch (e) { failed++; } }
            if (o.metatags && o.metatags.length) { try { await Api.setMetatags(newId, o.metatags); } catch (e) { /* ignore */ } }
            remapId(o.id, newId); didCreate = true;
          }
        } catch (e) { failed++; }
      }
    }
    for (const o of to) {
      const f = fromById[o.id];
      if (f && objChanged(f, o)) {
        const patch = objPayload(o); patch.plcConfigId = o.plcConfigId || null;
        state.geomPending[o.id] = { points: (o.points || []).map((p) => ({ x: p.x, y: p.y })), ts: Date.now() };
        try { await Api.updateObject(o.id, patch); } catch (e) { failed++; }
        if (JSON.stringify(f.metatags || []) !== JSON.stringify(o.metatags || [])) { try { await Api.setMetatags(o.id, o.metatags || []); } catch (e) { /* ignore */ } }
      }
    }
    // Nur neu rendern, wenn sich IDs geaendert haben (Neuanlage) – sonst flackert das Layout unnoetig.
    if (didCreate) renderEditor(); else updateUndoBtns();
    state.objRev = (state.objRev || 0) + 1;
    if (failed) {
      // Sonst zeigt der Editor einen Stand, den der Server nicht hat (verschwundene Objekte kommen
      // beim naechsten Laden zurueck = die gemeldeten "Reste").
      try {
        const fresh = await Api.getObjects(state.detail.id);
        if (Array.isArray(fresh)) { state.detail.objects = fresh; renderEditor(); }
      } catch (e) { /* Abgleich nicht moeglich - beim naechsten Laden korrekt */ }
      toast(t('{n} Änderungen konnten nicht gespeichert werden', { n: failed }));
    }
  }
  // Wiedereintritt sperren: ein zweites Strg+Z waehrend der noch laufenden Uebertragung
  // wuerde einen halb angewandten Zwischenstand als Schnappschuss ablegen und die Server-
  // Aufrufe verschraenken (doppelte Neuanlagen, Loeschen bereits geloeschter Objekte).
  // Zwei Zustaende gleich? (gleiche Objekte, keine relevante Aenderung)
  function sameObjectsState(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const byId = {}; b.forEach(function (o) { byId[o.id] = o; });
    for (const o of a) { const p = byId[o.id]; if (!p || objChanged(o, p)) return false; }
    return true;
  }
  // Leerlauf-Schritte verwerfen: Schnappschuesse, die nichts aendern (z.B. weil die zugehoerige
  // Aktion fehlschlug), fuehlten sich wie ein Sprung an - Strg+Z tat scheinbar nichts.
  function nextDifferent(stack, curr) {
    while (stack.length) { const cand = stack.pop(); if (!sameObjectsState(curr, cand)) return cand; }
    return null;
  }
  async function doUndo() {
    if (state.undoBusy || !(state.undoStack && state.undoStack.length)) return;
    state.undoBusy = true; updateUndoBtns();
    try {
      await settlePendingOps(); // erst offene Anlagen abwarten, dann den Stand nehmen
      const curr = snapObjects();
      const target = nextDifferent(state.undoStack, curr);
      if (!target) return;
      (state.redoStack = state.redoStack || []).push(curr);
      await applyObjectsState(curr, target);
    } finally { state.undoBusy = false; updateUndoBtns(); }
  }
  async function doRedo() {
    if (state.undoBusy || !(state.redoStack && state.redoStack.length)) return;
    state.undoBusy = true; updateUndoBtns();
    try {
      await settlePendingOps();
      const curr = snapObjects();
      const target = nextDifferent(state.redoStack, curr);
      if (!target) return;
      (state.undoStack = state.undoStack || []).push(curr);
      await applyObjectsState(curr, target);
    } finally { state.undoBusy = false; updateUndoBtns(); }
  }
  function onEditorKey(e) {
    if (state.view !== 'editor' || !canEdit()) return;
    const t = document.activeElement;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if ((e.ctrlKey || e.metaKey) && !inField) {
      const k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); return; }
      if (k === 'c') { e.preventDefault(); copySelectedObjects(); return; }
      if (k === 'v') { e.preventDefault(); pasteObjects(); return; }
    }
    if (state.drawZone) {
      if (e.key === 'Enter') { e.preventDefault(); state.drawShape === 'route' ? finishRoute() : finishZone(); }
      else if (e.key === 'Escape') { e.preventDefault(); state.drawZone = false; state.drawShape = null; state.zoneDraft = []; state.zoneCursor = null; renderEditor(); }
      else if (e.key === 'Backspace' && !inField) { e.preventDefault(); state.zoneDraft.pop(); renderEditor(); }
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && state.selectedZone && !inField) {
      const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone);
      if (z && z.symbolType === 'mf_route') { e.preventDefault(); reverseRoute(z.id); return; }
    }
    if (state.selectedZone && !inField && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      const z = (state.detail.objects || []).find((o) => o.id === state.selectedZone && o.points);
      if (z) {
        e.preventDefault();
        if (!state._nudgeUndoActive) { pushUndo(); state._nudgeUndoActive = true; }
        if (state._nudgeTimer2) clearTimeout(state._nudgeTimer2);
        state._nudgeTimer2 = setTimeout(function () { state._nudgeUndoActive = false; }, 600);
        const step = e.shiftKey ? 0.02 : 0.004;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        z.points = z.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }));
        updateZoneDom(z); nudgeZonePersist(z);
        return;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && (state.selectedObj || (state.selObjs && state.selObjs.length))) {
      e.preventDefault(); deleteSelectedObjects(); return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedZone && !inField) {
      e.preventDefault(); deleteSelectedZone();
    }
  }

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
