/* ProModXgOEM – API-Client
 * Kapselt Basis-URL, Token-Verwaltung (localStorage) und alle Endpunkt-Aufrufe.
 */
(function (global) {
  'use strict';

  const API_BASE = 'https://api.prozessimage.de/api/v1';
  const TOKEN_KEY = 'promodx_token';

  // Token pro Fenster im Speicher halten (aus localStorage nur EINMAL beim Start gelesen).
  // So sind zwei Fenster desselben Browsers unabhängig: meldet sich eines ab, bleibt das
  // andere angemeldet. localStorage dient nur der Persistenz über ein Neuladen hinweg.
  let _token = null;
  try { _token = localStorage.getItem(TOKEN_KEY); } catch (e) { _token = null; }

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
      try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
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
      const res = await fetch(rUrl, {
        method: rMethod,
        headers: Object.assign(
          { 'Accept': '*/*' },
          this.token ? { 'Authorization': 'Bearer ' + this.token } : {},
          opts.headers || {}
        ),
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

    // ---- Baum ----
    getTree() { return this.request('/tree'); },
    createNode(parentId, type, name) { return this.request('/nodes', { method: 'POST', body: { parentId, type, name } }); },
    updateNode(id, patch) { return this.request('/nodes/' + id, { method: 'PATCH', body: patch }); },
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
    layoutUrl(stationId) { return API_BASE + '/stations/' + stationId + '/layout'; },

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
    deleteUser(id) { return this.request('/users/' + id, { method: 'DELETE' }); },
    exportCsvUrl(stationId) { return API_BASE + '/stations/' + stationId + '/export.csv'; },
    exportPdfUrl(stationId) { return API_BASE + '/stations/' + stationId + '/export.pdf'; },
  };

  global.Api = Api;
})(window);
