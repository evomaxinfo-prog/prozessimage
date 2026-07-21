/* ProModXgOEM2 – API-Client
 * Kapselt Basis-URL, Token-Verwaltung (localStorage) und alle Endpunkt-Aufrufe.
 */
(function (global) {
  'use strict';

  const API_BASE = 'https://api.prozessimage.de/api/v1';
  const TOKEN_KEY = 'promodx_token';

  // Token PRO TAB in sessionStorage halten (nicht über Tabs geteilt). So können in mehreren
  // Tabs unterschiedliche Nutzer gleichzeitig angemeldet sein, ohne sich gegenseitig auszuloggen.
  // Einmalige Migration aus der früheren (geteilten) localStorage-Ablage; danach wird der
  // geteilte Slot entfernt, damit neue Tabs nicht denselben Token erben.
  let _token = null;
  try {
    _token = sessionStorage.getItem(TOKEN_KEY);
    if (!_token) {
      const legacy = localStorage.getItem(TOKEN_KEY);
      if (legacy) { _token = legacy; sessionStorage.setItem(TOKEN_KEY, legacy); }
    }
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) { _token = null; }

  class ApiError extends Error {
    constructor(status, message, data) {
      super(message || ('HTTP ' + status));
      this.status = status;
      this.data = data;
    }
  }

  const Api = {
    ApiError,

    get token() { return _token; },
    set token(v) {
      _token = v || null;
      try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    },
    get isAuthenticated() { return !!_token; },

    async request(path, opts) {
      opts = opts || {};
      const hasBody = opts.body !== undefined && opts.body !== null;
      const method = opts.method || 'GET';
      // Lese-Anfragen mit Einmal-Zeitstempel versehen -> kann nie aus einem (Browser-/Proxy-)Cache bedient werden
      let url = API_BASE + path;
      if (method === 'GET') url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const res = await fetch(url, {
        method: method,
        headers: Object.assign(
          { 'Accept': 'application/json' },
          hasBody ? { 'Content-Type': 'application/json' } : {},
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {},
          opts.headers || {}
        ),
        body: hasBody ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      if (res.status === 204) return null;

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(res.status, (data && data.message) || 'Serverfehler.', data);
      }
      return data;
    },

    /** Rohantwort (für Downloads/Bilder), gibt die fetch-Response zurück. */
    async raw(path, opts) {
      opts = opts || {};
      const rMethod = opts.method || 'GET';
      let rUrl = API_BASE + path;
      if (rMethod === 'GET') rUrl += (rUrl.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const hasBody = opts.body != null;
      const res = await fetch(rUrl, {
        method: rMethod,
        headers: Object.assign(
          { 'Accept': '*/*' },
          hasBody ? { 'Content-Type': 'application/json' } : {},
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {},
          opts.headers || {}
        ),
        body: hasBody ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
      });
      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      return res;
    },

    // ---- Auth ----
    login(email, password) { return this.request('/auth/login', { method: 'POST', body: { email, password } }); },
    me() { return this.request('/auth/me'); },
    logout() { return this.request('/auth/logout', { method: 'POST' }); },
    changePassword(currentPassword, newPassword) {
      return this.request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    },
    forgotPassword(email) { return this.request('/auth/forgot-password', { method: 'POST', body: { email } }); },
    resetPassword(email, token, newPassword) { return this.request('/auth/reset-password', { method: 'POST', body: { email, token, newPassword } }); },
    setLanguage(lang) {
      return this.request('/auth/language', { method: 'POST', body: { lang } });
    },

    // ---- Baum ----
    getTree() { return this.request('/tree'); },
    createNode(parentId, type, name) { return this.request('/nodes', { method: 'POST', body: { parentId, type, name } }); },
    updateNode(id, patch) { return this.request('/nodes/' + id, { method: 'PATCH', body: patch }); },
    getProjectData(nodeId) { return this.request('/nodes/' + nodeId + '/project-data'); },
    setProjectData(nodeId, data) { return this.request('/nodes/' + nodeId + '/project-data', { method: 'PUT', body: { data } }); },
    deleteNode(id) { return this.request('/nodes/' + id, { method: 'DELETE' }); },
    getWerkOverview(id) { return this.request('/nodes/' + id + '/overview'); },

    // ---- Anlage / Stammdaten (ab Schritt 2) ----
    getStationFull(id) { return this.request('/stations/' + id + '/full'); },
    updateStation(id, patch) { return this.request('/stations/' + id, { method: 'PATCH', body: patch }); },
    addJournal(stationId, text) { return this.request('/stations/' + stationId + '/journal', { method: 'POST', body: { text } }); },
    addPlc(stationId, plc) { return this.request('/stations/' + stationId + '/plcs', { method: 'POST', body: plc }); },
    updatePlc(id, patch) { return this.request('/plcs/' + id, { method: 'PATCH', body: patch }); },
    deletePlc(id) { return this.request('/plcs/' + id, { method: 'DELETE' }); },

    // ---- Editor / Objekte / Layout (ab Schritt 3) ----
    setLayerVisibility(stationId, layerId, visible) {
      return this.request('/stations/' + stationId + '/layers/' + layerId, { method: 'PATCH', body: { visible } });
    },
    createObject(stationId, obj) { return this.request('/stations/' + stationId + '/objects', { method: 'POST', body: obj }); },
    getObjects(stationId) { return this.request('/stations/' + stationId + '/objects'); },
    updateObject(id, patch) { return this.request('/objects/' + id, { method: 'PATCH', body: patch }); },
    deleteObject(id) { return this.request('/objects/' + id, { method: 'DELETE' }); },
    setMetatags(objectId, metatags) { return this.request('/objects/' + objectId + '/metatags', { method: 'PUT', body: { metatags } }); },
    getChanges(stationId, since) { return this.request('/stations/' + stationId + '/changes' + (since ? ('?since=' + encodeURIComponent(since)) : '')); },
    getComments(stationId) { return this.request('/stations/' + stationId + '/comments'); },
    createComment(stationId, c) { return this.request('/stations/' + stationId + '/comments', { method: 'POST', body: c }); },
    addCommentMessage(commentId, text) { return this.request('/comments/' + commentId + '/messages', { method: 'POST', body: { text: text } }); },
    moveComment(commentId, x, y) { return this.request('/comments/' + commentId, { method: 'PATCH', body: { x: x, y: y } }); },
    deleteComment(commentId) { return this.request('/comments/' + commentId, { method: 'DELETE' }); },
    async uploadLayout(stationId, file) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(API_BASE + '/stations/' + stationId + '/layout', {
        method: 'POST',
        headers: Object.assign(
          { 'Accept': 'application/json' },
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {}
        ),
        body: fd, // KEIN Content-Type setzen – Browser setzt multipart-Boundary
      });
      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data && data.message) || 'Upload fehlgeschlagen.', data);
      return data;
    },

    // ---- Dokumente je Anlage (PDF/Office) ----
    getDocuments(stationId) { return this.request('/stations/' + stationId + '/documents'); },
    async uploadDocument(stationId, file) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(API_BASE + '/stations/' + stationId + '/documents', {
        method: 'POST',
        headers: Object.assign(
          { 'Accept': 'application/json' },
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {}
        ),
        body: fd,
      });
      if (res.status === 401) {
        this.token = null;
        global.dispatchEvent(new CustomEvent('promodx:unauthorized'));
        throw new ApiError(401, 'Nicht angemeldet.');
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data && data.message) || 'Upload fehlgeschlagen.', data);
      return data;
    },
    documentResponse(stationId, docId) { return this.raw('/stations/' + stationId + '/documents/' + docId); },
    deleteDocument(stationId, docId) { return this.request('/stations/' + stationId + '/documents/' + docId, { method: 'DELETE' }); },

    // ---- Versionierung je Anlage (Snapshots) ----
    getVersions(stationId) { return this.request('/stations/' + stationId + '/versions'); },
    createVersion(stationId, body) { return this.request('/stations/' + stationId + '/versions', { method: 'POST', body: body || {} }); },
    getVersion(stationId, versionId) { return this.request('/stations/' + stationId + '/versions/' + versionId); },
    updateVersion(stationId, versionId, body) { return this.request('/stations/' + stationId + '/versions/' + versionId, { method: 'PATCH', body: body || {} }); },
    restoreVersion(stationId, versionId) { return this.request('/stations/' + stationId + '/versions/' + versionId + '/restore', { method: 'POST', body: {} }); },
    deleteVersion(stationId, versionId) { return this.request('/stations/' + stationId + '/versions/' + versionId, { method: 'DELETE' }); },
    getPaletteSymbols(werkId) { return this.request('/werke/' + werkId + '/palette'); },
    async createPaletteSymbol(werkId, name, layerCode, file, fields) {
      const fd = new FormData();
      fd.append('name', name); fd.append('layerCode', layerCode); fd.append('file', file);
      if (fields) fd.append('fields', JSON.stringify(fields));
      const res = await fetch(API_BASE + '/werke/' + werkId + '/palette', {
        method: 'POST',
        headers: Object.assign({ 'Accept': 'application/json' }, this.token ? { 'Authorization': 'Bearer ' + this.token } : {}),
        body: fd,
      });
      if (res.status === 401) { this.token = null; global.dispatchEvent(new CustomEvent('promodx:unauthorized')); throw new ApiError(401, 'Nicht angemeldet.'); }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data && data.message) || 'Upload fehlgeschlagen.', data);
      return data;
    },
    async updatePaletteSymbol(id, name, file, fields) {
      const fd = new FormData();
      fd.append('name', name); fd.append('_method', 'PATCH'); // Method-Spoofing (Multipart bei PATCH)
      if (file) fd.append('file', file);
      if (fields) fd.append('fields', JSON.stringify(fields));
      const res = await fetch(API_BASE + '/palette/' + id, {
        method: 'POST',
        headers: Object.assign({ 'Accept': 'application/json' }, this.token ? { 'Authorization': 'Bearer ' + this.token } : {}),
        body: fd,
      });
      if (res.status === 401) { this.token = null; global.dispatchEvent(new CustomEvent('promodx:unauthorized')); throw new ApiError(401, 'Nicht angemeldet.'); }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, (data && data.message) || 'Speichern fehlgeschlagen.', data);
      return data;
    },
    deletePaletteSymbol(id) { return this.request('/palette/' + id, { method: 'DELETE' }); },

    // ---- Benutzer- & Gruppenverwaltung (admin) ----
    getWerke() { return this.request('/werke'); },
    getGroups() { return this.request('/groups'); },
    getLayers() { return this.request('/layers'); },
    createLayer(body) { return this.request('/layers', { method: 'POST', body: body }); },
    updateLayerDef(id, body) { return this.request('/layers/' + id, { method: 'PATCH', body: body }); },
    deleteLayer(id) { return this.request('/layers/' + id, { method: 'DELETE' }); },
    reorderLayers(ids) { return this.request('/layers/reorder', { method: 'POST', body: { ids: ids } }); },
    createGroup(data) { return this.request('/groups', { method: 'POST', body: data }); },
    updateGroup(id, data) { return this.request('/groups/' + id, { method: 'PATCH', body: data }); },
    deleteGroup(id) { return this.request('/groups/' + id, { method: 'DELETE' }); },
    getUsers() { return this.request('/users'); },
    createUser(data) { return this.request('/users', { method: 'POST', body: data }); },
    updateUser(id, data) { return this.request('/users/' + id, { method: 'PATCH', body: data }); },
    resetUserPassword(id, newPassword) { return this.request('/users/' + id + '/reset-password', { method: 'POST', body: { newPassword } }); },
    resetUserLogins(id) { return this.request('/users/' + id + '/reset-logins', { method: 'POST' }); },
    deleteUser(id) { return this.request('/users/' + id, { method: 'DELETE' }); },
  };

  global.Api = Api;
})(window);
