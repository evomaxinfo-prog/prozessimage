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
    const chg = $('btnChanges'); if (chg) chg.hidden = !state.isAdmin; // zentrale Änderungsansicht
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
